"""Diagram sections 1-3: quality checks, photo uploads, reminders and escalation,
farmer doctor visits, the quality review, interventions and re-checks."""
from __future__ import annotations

import os
from datetime import datetime, timedelta
from typing import Optional

from pymongo.database import Database

from ..adapters import ledger, notify
from ..adapters.cv import CVUnavailable, cv_service
from ..config import get_settings
from ..domain import quality as q
from ..errors import Conflict, DomainError, Forbidden
from ..util import aware, ist, new_id
from . import common

OPEN_CHECK = ["DUE", "REMINDED", "RETAKE_REQUESTED"]
OPEN_VISIT = ["SCHEDULED"]
OPEN_INTERVENTION = ["OPEN", "IN_PROGRESS"]
IMAGE_MAGIC = {b"\x89PNG": "png", b"\xff\xd8\xff": "jpg", b"RIFF": "webp"}


# ---------------------------------------------------------------- checks
def create_check(db: Database, cm: dict, due_at: datetime, now: datetime, trigger: str) -> Optional[dict]:
    """One open check per commitment. Sends the photo prompt."""
    if db.quality_checks.find_one({"commitment_id": cm["_id"], "status": {"$in": OPEN_CHECK}}):
        return None
    s = get_settings()
    deadline = due_at + timedelta(hours=s.upload_grace_hours)
    chk = {"_id": new_id("QC"), "commitment_id": cm["_id"], "agreement_id": cm["agreement_id"],
           "farmer_id": cm["farmer_id"], "farmer_name": cm["farmer_name"], "fpo_id": cm["fpo_id"],
           "trigger": trigger, "due_at": due_at, "first_deadline": deadline, "deadline": deadline,
           "status": "DUE", "misses": 0, "reminders": [], "photos": [], "cv": None,
           "uploaded_at": None, "on_time": None, "created_at": now}
    db.quality_checks.insert_one(chk)
    f = common.farmer(db, cm["farmer_id"])
    notify.to_farmer(db, now, f, "Photo check due",
                     f"Please upload 3 photos of your Alphonso fruit in the AgriLink app by "
                     f"{ist(deadline)}.", {"check_id": chk["_id"]}, app_too=True)
    return chk


def _save_image(check_id: str, idx: int, data: bytes) -> str:
    s = get_settings()
    kind = next((v for k, v in IMAGE_MAGIC.items() if data.startswith(k)), None)
    if kind is None:
        raise DomainError("only JPEG, PNG or WebP images can be uploaded")
    if len(data) > s.max_upload_mb * 1024 * 1024:
        raise DomainError(f"each photo must be {s.max_upload_mb:g} MB or smaller")
    os.makedirs(s.upload_dir, exist_ok=True)
    name = f"{check_id}_{idx}.{kind}"
    with open(os.path.join(s.upload_dir, name), "wb") as fh:
        fh.write(data)
    return name


def upload_photos(db: Database, check_id: str, files: list, profile: Optional[str],
                  now: datetime, actor) -> dict:
    """files: [bytes]. The farmer the check belongs to (or ops) uploads; AI runs."""
    chk = common.get(db, "quality_checks", check_id, "quality check")
    if actor.role == "farmer" and actor.id != chk["farmer_id"]:
        raise Forbidden("farmers can only upload photos for their own checks")
    if chk["status"] not in OPEN_CHECK:
        raise Conflict(f"this check is {chk['status']} and no longer accepts photos")
    if not files:
        raise DomainError("upload at least one photo")
    if len(files) > 5:
        raise DomainError("upload at most 5 photos per check")
    names = [_save_image(check_id, len(chk["photos"]) + i, data) for i, data in enumerate(files)]
    try:
        cv = cv_service.analyze_many(files, profile)
    except ValueError as e:
        raise DomainError(str(e))
    except CVUnavailable:
        raise DomainError("photo grading is temporarily unavailable — please try again in a few minutes")
    on_time = chk["misses"] == 0 and chk["status"] == "DUE" and now <= aware(chk["first_deadline"])
    if chk["on_time"] is not None:          # a retake keeps the first answer's punctuality
        on_time = chk["on_time"]
    db.quality_checks.update_one({"_id": check_id}, {"$set": {
        "status": "ANALYSED", "cv": cv, "uploaded_at": now, "on_time": on_time,
        "analysed_at": now}, "$push": {"photos": {"$each": names}}})
    cm = common.commitment(db, chk["commitment_id"])
    ledger.append(db, now, "PHOTOS_ANALYSED",
                  f"{len(names)} photo(s) from {chk['farmer_name']} analysed by AI ({cv['model']})",
                  agreement_id=chk["agreement_id"], farmer_id=chk["farmer_id"], actor=actor.id,
                  data={"check_id": check_id, "defect_pct": cv["defect_pct"], "colour_score": cv["colour_score"],
                        "est_weight_g": cv["est_weight_g"], "confidence": cv["confidence"],
                        "flags": cv["flags"], "simulated": cv.get("simulated", True)})
    rv = run_review(db, cm, now, trigger=f"photos {check_id}")
    if rv["status"] == "RETAKE_PHOTO":
        s = get_settings()
        db.quality_checks.update_one({"_id": check_id}, {"$set": {
            "status": "RETAKE_REQUESTED", "deadline": now + timedelta(hours=s.upload_grace_hours)}})
        f = common.farmer(db, chk["farmer_id"])
        notify.to_farmer(db, now, f, "Please retake photos",
                         "The photos were not clear enough. Take them in daylight, close to the fruit, and upload again.",
                         {"check_id": check_id}, app_too=True)
    return {"check": db.quality_checks.find_one({"_id": check_id}), "review": rv}


def process_deadlines(db: Database, now: datetime) -> dict:
    """Missed upload -> reminder; second miss -> MISSED and farmer doctor flagged."""
    reminded = escalated = 0
    s = get_settings()
    for chk in db.quality_checks.find({"status": {"$in": OPEN_CHECK}, "deadline": {"$lt": now}}):
        misses = chk["misses"] + 1
        f = common.farmer(db, chk["farmer_id"])
        if misses >= 2:
            db.quality_checks.update_one({"_id": chk["_id"]}, {"$set": {
                "status": "MISSED", "misses": misses, "on_time": False, "closed_at": now}})
            v = schedule_visit(db, f, now, now, trigger="missed_uploads",
                               note=f"Two missed photo uploads for check {chk['_id']}")
            ledger.append(db, now, "CHECK_MISSED",
                          f"{f['name']} missed two photo deadlines; farmer doctor flagged",
                          agreement_id=chk["agreement_id"], farmer_id=f["_id"], data={"check_id": chk["_id"]})
            escalated += 1
        else:
            new_deadline = now + timedelta(hours=s.upload_grace_hours)
            db.quality_checks.update_one({"_id": chk["_id"]}, {
                "$set": {"status": "REMINDED", "misses": misses, "deadline": new_deadline, "on_time": False},
                "$push": {"reminders": {"at": now, "channel": f.get("channel", "sms")}}})
            notify.to_farmer(db, now, f, "Reminder: photo check overdue",
                             f"Your Alphonso photo check is overdue. Please upload in the AgriLink app by "
                             f"{ist(new_deadline)}.", {"check_id": chk["_id"]}, app_too=True)
            reminded += 1
    return {"reminded": reminded, "escalated": escalated}


def generate_due_checks(db: Database, now: datetime) -> int:
    """Create the next scheduled check for every monitored commitment."""
    interval = timedelta(days=get_settings().check_interval_days)
    agr_ids = [a["_id"] for a in db.agreements.find({"status": {"$in": list(common.MONITORED_AGREEMENT_STATUSES)}})]
    made = 0
    for cm in db.commitments.find({"agreement_id": {"$in": agr_ids}, "status": "ACTIVE"}):
        last = db.quality_checks.find_one({"commitment_id": cm["_id"]}, sort=[("due_at", -1)])
        if last is None or aware(last["due_at"]) + interval <= now:
            if create_check(db, cm, now, now, trigger="schedule"):
                made += 1
    return made


# ---------------------------------------------------------------- doctor visits
def doctor_for(db: Database, fpo_id: str) -> dict:
    d = db.farmer_doctors.find_one({"fpo_id": fpo_id, "active": True})
    if not d:
        raise Conflict(f"FPO '{fpo_id}' has no active farmer doctor")
    return d


def schedule_visit(db: Database, farmer: dict, due_at: datetime, now: datetime, trigger: str,
                   note: str = "", priority: Optional[bool] = None) -> dict:
    existing = db.doctor_visits.find_one({"farmer_id": farmer["_id"], "status": {"$in": OPEN_VISIT}})
    if existing:
        if trigger != "schedule":   # escalate an existing visit instead of duplicating it
            db.doctor_visits.update_one({"_id": existing["_id"]}, {
                "$set": {"priority": True, "due_at": min(aware(existing["due_at"]), due_at)},
                "$push": {"reasons": {"trigger": trigger, "note": note, "at": now}}})
        return db.doctor_visits.find_one({"_id": existing["_id"]})
    doc = doctor_for(db, farmer["fpo_id"])
    pr = priority if priority is not None else trigger != "schedule"
    v = {"_id": new_id("VIS"), "farmer_id": farmer["_id"], "farmer_name": farmer["name"],
         "fpo_id": farmer["fpo_id"], "village": farmer.get("village"), "doctor_id": doc["_id"],
         "doctor_name": doc["name"], "due_at": due_at, "status": "SCHEDULED", "trigger": trigger,
         "priority": pr, "reasons": [{"trigger": trigger, "note": note, "at": now}],
         "finding": None, "created_at": now}
    db.doctor_visits.insert_one(v)
    notify.send(db, now, "doctor", doc["_id"], "app",
                "Priority farm visit" if pr else "Farm visit scheduled",
                f"Visit {farmer['name']} ({farmer.get('village', '')}) by {ist(due_at)}."
                + (f" Reason: {note}" if note else ""), {"visit_id": v["_id"]})
    return v


def generate_due_visits(db: Database, now: datetime) -> int:
    agr_ids = [a["_id"] for a in db.agreements.find({"status": {"$in": list(common.MONITORED_AGREEMENT_STATUSES)}})]
    farmer_ids = db.commitments.distinct("farmer_id", {"agreement_id": {"$in": agr_ids}, "status": "ACTIVE"})
    made = 0
    for f in db.farmers.find({"_id": {"$in": farmer_ids}}):
        if db.doctor_visits.find_one({"farmer_id": f["_id"], "status": {"$in": OPEN_VISIT}}):
            continue
        interval = timedelta(days=common.fpo(db, f["fpo_id"]).get("visit_interval_days", 14))
        last = db.doctor_visits.find_one({"farmer_id": f["_id"], "status": "COMPLETED"},
                                         sort=[("completed_at", -1)])
        if last is None or aware(last["completed_at"]) + interval <= now:
            schedule_visit(db, f, now, now, trigger="schedule")
            made += 1
    return made


def complete_visit(db: Database, visit_id: str, finding: dict, now: datetime, actor) -> dict:
    v = common.get(db, "doctor_visits", visit_id, "visit")
    if actor.role == "doctor" and actor.id != v["doctor_id"]:
        raise Forbidden("only the assigned farmer doctor can record this visit")
    if v["status"] != "SCHEDULED":
        raise Conflict(f"visit is already {v['status']}")
    grade = q.Grade(finding["grade"]).value
    clean = {"grade": grade, "observed_defect_pct": finding.get("observed_defect_pct"),
             "pest_signs": sorted(set(finding.get("pest_signs", []))),
             "cleared_flags": sorted(set(finding.get("cleared_flags", []))),
             "observations": (finding.get("observations") or "").strip(),
             "recommendations": [r.strip() for r in finding.get("recommendations", []) if r.strip()],
             "fruit_inspected": finding.get("fruit_inspected")}
    unknown = set(clean["pest_signs"] + clean["cleared_flags"]) - set(q.FLAG_LABELS)
    if unknown:
        raise DomainError("unknown flag(s): " + ", ".join(sorted(unknown)))
    db.doctor_visits.update_one({"_id": visit_id}, {"$set": {
        "status": "COMPLETED", "completed_at": now, "finding": clean, "recorded_by": actor.id}})
    ledger.append(db, now, "DOCTOR_INSPECTION",
                  f"Farmer doctor {v['doctor_name']} graded {v['farmer_name']}'s fruit {grade}",
                  farmer_id=v["farmer_id"], actor=actor.id,
                  data={"visit_id": visit_id, "grade": grade, "pest_signs": clean["pest_signs"]})
    _teach_gallery(db, v, grade, visit_id, now)
    # Verify any open intervention through this visit is a separate step; here we re-run reviews.
    reviews = []
    for cm in db.commitments.find({"farmer_id": v["farmer_id"], "status": "ACTIVE"}):
        reviews.append(run_review(db, cm, now, trigger=f"visit {visit_id}"))
    return {"visit": db.doctor_visits.find_one({"_id": visit_id}), "reviews": reviews}


def _teach_gallery(db: Database, v: dict, grade: str, visit_id: str, now: datetime) -> None:
    """The doctor's grade labels the farmer's latest analysed photos: they join the AI's reference gallery."""
    s = get_settings()
    chk = db.quality_checks.find_one(
        {"farmer_id": v["farmer_id"], "status": "ANALYSED", "photos.0": {"$exists": True},
         "analysed_at": {"$gte": now - timedelta(days=s.cv_valid_days)}}, sort=[("analysed_at", -1)])
    if not chk or (chk.get("cv") or {}).get("simulated", True):
        return
    files = []
    for name in chk["photos"]:
        path = os.path.join(s.upload_dir, name)
        if os.path.exists(path):
            with open(path, "rb") as fh:
                files.append(fh.read())
    try:
        res = cv_service.learn(files, grade, ref=visit_id)
    except Exception:          # never block recording a visit because the AI service is down
        return
    if res:
        db.quality_checks.update_one({"_id": chk["_id"]}, {"$set": {"doctor_label": {"grade": grade, "visit_id": visit_id, "at": now}}})


# ---------------------------------------------------------------- review
def _latest_inputs(db: Database, cm: dict, now: datetime) -> tuple:
    s = get_settings()
    chk = db.quality_checks.find_one(
        {"commitment_id": cm["_id"], "cv": {"$ne": None},
         "analysed_at": {"$gte": now - timedelta(days=s.cv_valid_days)}}, sort=[("analysed_at", -1)])
    visit = db.doctor_visits.find_one(
        {"farmer_id": cm["farmer_id"], "status": "COMPLETED",
         "completed_at": {"$gte": now - timedelta(days=s.finding_valid_days)}}, sort=[("completed_at", -1)])
    return chk, visit


def run_review(db: Database, cm: dict, now: datetime, trigger: str) -> dict:
    """Quality Pass? gateway for one commitment."""
    agr = common.agreement(db, cm["agreement_id"])
    required = q.Grade(agr["required_grade"])
    chk, visit = _latest_inputs(db, cm, now)
    cv = chk["cv"] if chk else None
    finding = visit["finding"] if visit else None
    o = q.review(cv, finding, required)
    rv = {"_id": new_id("QR"), "commitment_id": cm["_id"], "agreement_id": cm["agreement_id"],
          "farmer_id": cm["farmer_id"], "farmer_name": cm["farmer_name"], "fpo_id": cm["fpo_id"],
          "status": o.status.value, "final_grade": o.final_grade.value if o.final_grade else None,
          "provisional_grade": o.provisional_grade.value if o.provisional_grade else None,
          "source": o.source, "disagree": o.disagree, "open_flags": o.open_flags, "reasons": o.reasons,
          "required_grade": required.value, "check_id": chk["_id"] if chk else None,
          "visit_id": visit["_id"] if visit else None, "trigger": trigger, "created_at": now}
    db.quality_reviews.insert_one(rv)
    db.commitments.update_one({"_id": cm["_id"]}, {"$set": {
        "quality_status": rv["status"], "final_grade": rv["final_grade"],
        "provisional_grade": rv["provisional_grade"], "last_review_at": now}})
    f = common.farmer(db, cm["farmer_id"])
    if o.status == q.ReviewStatus.PASS:
        ledger.append(db, now, "QUALITY_PASS",
                      f"{cm['farmer_name']}: grade {rv['final_grade']} meets contract grade {required.value}",
                      agreement_id=cm["agreement_id"], farmer_id=cm["farmer_id"],
                      data={"review_id": rv["_id"], "final_grade": rv["final_grade"], "disagree": o.disagree})
    elif o.status == q.ReviewStatus.FAIL:
        ledger.append(db, now, "QUALITY_FAIL",
                      f"{cm['farmer_name']}: grade {rv['final_grade']} below contract grade {required.value}",
                      agreement_id=cm["agreement_id"], farmer_id=cm["farmer_id"], data={"review_id": rv["_id"]})
        open_intervention(db, cm, rv, cv, finding, now)
    elif o.status == q.ReviewStatus.PENDING_DOCTOR and o.provisional_grade is not None \
            and not q.meets(o.provisional_grade, required):
        schedule_visit(db, f, now, now, trigger="ai_flag",
                       note=f"AI suggests grade {o.provisional_grade.value} (contract needs {required.value})")
    return rv


# ---------------------------------------------------------------- interventions
def open_intervention(db: Database, cm: dict, rv: dict, cv: Optional[dict], finding: Optional[dict],
                      now: datetime) -> Optional[dict]:
    existing = db.interventions.find_one({"commitment_id": cm["_id"], "status": {"$in": OPEN_INTERVENTION}})
    if existing:
        db.interventions.update_one({"_id": existing["_id"]}, {"$push": {"review_ids": rv["_id"]}})
        return existing
    recs = q.guidance_for(cv, finding)
    for r in (finding or {}).get("recommendations", []):
        recs.append({"key": "doctor", "text": r, "source": "farmer_doctor"})
    iv = {"_id": new_id("INT"), "commitment_id": cm["_id"], "agreement_id": cm["agreement_id"],
          "farmer_id": cm["farmer_id"], "farmer_name": cm["farmer_name"], "fpo_id": cm["fpo_id"],
          "review_ids": [rv["_id"]], "cause": rv["reasons"], "recommendations": recs,
          "status": "OPEN", "actions": [], "verification": None, "created_at": now,
          "verify_by": now + timedelta(days=7)}
    db.interventions.insert_one(iv)
    f = common.farmer(db, cm["farmer_id"])
    notify.to_farmer(db, now, f, "Steps to improve your fruit",
                     "Your last check was below the contract grade. Your farmer doctor will help. First steps: "
                     + " ".join(r["text"] for r in recs[:2]), {"intervention_id": iv["_id"]})
    notify.send(db, now, "fpo", cm["fpo_id"], "app", "Intervention opened",
                f"{cm['farmer_name']} is below contract grade; intervention {iv['_id']} opened.",
                {"intervention_id": iv["_id"]})
    return iv


def add_action(db: Database, iid: str, note: str, now: datetime, actor) -> dict:
    iv = common.get(db, "interventions", iid, "intervention")
    if iv["status"] not in OPEN_INTERVENTION:
        raise Conflict(f"intervention is {iv['status']}")
    if not note.strip():
        raise DomainError("describe the action taken")
    db.interventions.update_one({"_id": iid}, {"$set": {"status": "IN_PROGRESS"},
                                               "$push": {"actions": {"at": now, "note": note.strip(),
                                                                     "by": actor.id or actor.role}}})
    return db.interventions.find_one({"_id": iid})


def verify_intervention(db: Database, iid: str, effective: bool, note: str, now: datetime, actor) -> dict:
    """Track implementation & verify improvement -> re-check at the next scheduled check."""
    iv = common.get(db, "interventions", iid, "intervention")
    if iv["status"] not in OPEN_INTERVENTION:
        raise Conflict(f"intervention is {iv['status']}")
    if not iv["actions"]:
        raise Conflict("record at least one action before verifying")
    status = "VERIFIED" if effective else "NOT_EFFECTIVE"
    db.interventions.update_one({"_id": iid}, {"$set": {
        "status": status, "verification": {"at": now, "effective": effective, "note": note.strip(),
                                           "by": actor.id or actor.role}}})
    cm = common.commitment(db, iv["commitment_id"])
    chk = None
    if cm["status"] == "ACTIVE":
        chk = create_check(db, cm, now, now, trigger="re-check")
    ledger.append(db, now, "INTERVENTION_" + status,
                  f"Intervention for {iv['farmer_name']} marked {status.lower().replace('_', ' ')}; re-check scheduled",
                  agreement_id=iv["agreement_id"], farmer_id=iv["farmer_id"], actor=actor.id,
                  data={"intervention_id": iid})
    return {"intervention": db.interventions.find_one({"_id": iid}), "recheck": chk}
