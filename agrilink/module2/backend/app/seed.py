"""Demo data for Module 2.

    python -m app.seed

All people, FPOs and buyers are SYNTHETIC (fictional names, or are
invented). The state is produced by running the real services along a
simulated timeline (30 Mar -> 14 Apr 2027, Konkan Alphonso season), so every
record obeys the same rules as live use. Only the Module 2 database is touched.
"""
from __future__ import annotations

import struct
import zlib
from datetime import date, datetime, timedelta, timezone

from pymongo.database import Database

from . import clock
from .auth import Actor
from .db import COLLECTIONS, ensure_indexes, get_db
from .services import agreements, delivery, quality, risks
from .services import ratings as ratings_svc
from .services.scheduler import run_due_jobs

T0 = datetime(2027, 3, 30, 4, 0, tzinfo=timezone.utc)      # 09:30 IST
SYS = Actor("system", "MODULE1")
OPS = Actor("admin", "OPS-1")


def _png(rgb: tuple, size: int = 48) -> bytes:
    """A small solid-colour PNG used as a stand-in photo."""
    raw = b"".join(b"\x00" + bytes(rgb) * size for _ in range(size))

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


PHOTO = {"good": _png((232, 168, 40)), "borderline": _png((198, 170, 60)), "poor": _png((150, 120, 50)),
         "pest": _png((210, 150, 45)), "blurry": _png((200, 180, 140))}

FPOS = [
    # id, name, taluka, district, registered, newly formed, visit days, spare kg, capacity posted
    ("FPO-RTN", "Ratnagiri Hapus Producer Co.", "Ratnagiri", "Ratnagiri", "2025-07-14", True, 7, 0, None),
    ("FPO-DVG", "Devgad Amba Growers FPC", "Devgad", "Sindhudurg", "2025-02-03", True, 14, 0, None),
    ("FPO-RJP", "Rajapur Konkan Fruit FPC", "Rajapur", "Ratnagiri", "2024-11-20", False, 14, 2500, "2027-03-20"),
    ("FPO-VNG", "Vengurla Mango Collective", "Vengurla", "Sindhudurg", "2026-01-09", True, 14, 1800, "2027-03-25"),
    ("FPO-GHR", "Guhagar Coastal Growers FPC", "Guhagar", "Ratnagiri", "2026-06-30", True, 7, 1200, "2027-03-28"),
]
DOCTORS = [("DOC-RTN", "Sunil Gawde", "FPO-RTN"), ("DOC-DVG", "Meera Sawant", "FPO-DVG"),
           ("DOC-RJP", "Prakash Joshi", "FPO-RJP"), ("DOC-VNG", "Anita Parab", "FPO-VNG"),
           ("DOC-GHR", "Rohan Kadam", "FPO-GHR")]
FARMERS = [
    # id, name, fpo, village, orchard ha, trees, channel, language
    ("FRM-RTN-01", "Vasant Patil", "FPO-RTN", "Pawas", 1.2, 110, "whatsapp", "Marathi"),
    ("FRM-RTN-02", "Sushila Desai", "FPO-RTN", "Gaonkhadi", 0.8, 70, "sms", "Marathi"),
    ("FRM-RTN-03", "Ganesh Shinde", "FPO-RTN", "Kasarveli", 1.5, 140, "whatsapp", "Marathi"),
    ("FRM-RTN-04", "Lata Mhatre", "FPO-RTN", "Purnagad", 0.6, 55, "sms", "Marathi"),
    ("FRM-RTN-05", "Dattatray Kulkarni", "FPO-RTN", "Bhatye", 1.0, 95, "whatsapp", "Marathi"),
    ("FRM-RTN-06", "Rekha Surve", "FPO-RTN", "Nevare", 0.9, 80, "sms", "Marathi"),
    ("FRM-RTN-07", "Mahesh Naik", "FPO-RTN", "Golap", 1.1, 100, "whatsapp", "Marathi"),
    ("FRM-RTN-08", "Prabha Joshi", "FPO-RTN", "Pawas", 0.7, 60, "sms", "Marathi"),
    ("FRM-DVG-01", "Ramesh Sawant", "FPO-DVG", "Wada", 1.4, 130, "whatsapp", "Marathi"),
    ("FRM-DVG-02", "Kamal Rane", "FPO-DVG", "Mithbav", 0.9, 85, "sms", "Marathi"),
    ("FRM-DVG-03", "Santosh Wadekar", "FPO-DVG", "Kunkeshwar", 1.6, 150, "whatsapp", "Marathi"),
    ("FRM-DVG-04", "Sharada Gaonkar", "FPO-DVG", "Jamsande", 0.8, 72, "sms", "Marathi"),
    ("FRM-DVG-05", "Vijay Malandkar", "FPO-DVG", "Girye", 1.3, 120, "whatsapp", "Marathi"),
    ("FRM-DVG-06", "Anjali Tirlotkar", "FPO-DVG", "Padel", 0.7, 64, "sms", "Marathi"),
    ("FRM-RJP-01", "Narayan Pawar", "FPO-RJP", "Jaitapur", 1.2, 105, "whatsapp", "Marathi"),
    ("FRM-RJP-02", "Sunita Kadam", "FPO-RJP", "Nate", 1.0, 90, "sms", "Marathi"),
    ("FRM-RJP-03", "Ashok Bhide", "FPO-RJP", "Tulsunde", 1.4, 125, "whatsapp", "Marathi"),
    ("FRM-VNG-01", "Mohan Parab", "FPO-VNG", "Shiroda", 1.1, 98, "whatsapp", "Marathi"),
    ("FRM-VNG-02", "Pooja Kubal", "FPO-VNG", "Redi", 0.8, 70, "sms", "Marathi"),
    ("FRM-GHR-01", "Shankar More", "FPO-GHR", "Hedavi", 0.9, 82, "sms", "Marathi"),
    ("FRM-GHR-02", "Vaishali Jadhav", "FPO-GHR", "Velneshwar", 1.0, 88, "whatsapp", "Marathi"),
]
BUYERS = [("BUY-A", "Singapore Supermarket Group A"),
          ("BUY-B", "Singapore Supermarket Group B")]


def _reference(db: Database) -> None:
    fpo_taluka = {}
    for fid, name, taluka, district, reg, new, visit, spare, posted in FPOS:
        fpo_taluka[fid] = (taluka, district)
        db.fpos.insert_one({
            "_id": fid, "name": name, "taluka": taluka, "district": district,
            "registered_on": reg, "newly_formed": new, "visit_interval_days": visit,
            "spare_capacity_kg": float(spare),
            "capacity_posted_at": datetime.fromisoformat(posted).replace(tzinfo=timezone.utc) if posted else None,
            "synthetic": True})
    for did, name, fpo in DOCTORS:
        db.farmer_doctors.insert_one({"_id": did, "name": name, "fpo_id": fpo, "active": True, "synthetic": True})
    for fid, name, fpo, village, ha, trees, ch, lang in FARMERS:
        taluka, district = fpo_taluka[fpo]
        db.farmers.insert_one({
            "_id": fid, "name": name, "fpo_id": fpo, "village": village, "taluka": taluka,
            "district": district, "orchard_ha": ha, "trees": trees, "channel": ch, "language": lang,
            "phone": "+91 9XXXX XXXXX", "consent_recorded": True, "registered_at": T0 - timedelta(days=120),
            "synthetic": True})
    for bid, name in BUYERS:
        db.buyers.insert_one({"_id": bid, "name": name, "country": "SG", "synthetic": True})


def _agreement(aid, buyer, qty, grade, w0, w1, deadline, value, commits):
    return {"id": aid, "buyer_id": buyer, "quantity_kg": qty, "required_grade": grade,
            "harvest_window_start": w0, "harvest_window_end": w1, "dispatch_deadline": deadline,
            "contract_value": value, "currency": "SGD", "tranche1_released": True, "source": "seed",
            "commitments": [{"farmer_id": f, "committed_kg": kg, "signed_on": date(2027, 3, 26)} for f, kg in commits]}


def _upload(db, farmer_id, profile, now):
    chk = db.quality_checks.find_one({"farmer_id": farmer_id, "status": {"$in": quality.OPEN_CHECK}})
    if chk:
        quality.upload_photos(db, chk["_id"], [PHOTO[profile]], profile, now, Actor("farmer", farmer_id))


def _visit(db, farmer_id, grade, now, **finding):
    v = db.doctor_visits.find_one({"farmer_id": farmer_id, "status": "SCHEDULED"})
    if not v:
        v = quality.schedule_visit(db, db.farmers.find_one({"_id": farmer_id}), now, now, trigger="schedule")
    quality.complete_visit(db, v["_id"], dict({"grade": grade}, **finding), now, Actor("doctor", v["doctor_id"]))


def seed(db: Database | None = None) -> dict:
    db = db if db is not None else get_db()
    for c in COLLECTIONS:
        db[c].delete_many({})
    ensure_indexes(db)
    _reference(db)
    now = T0
    clock.set_now(db, now)

    agreements.intake(db, _agreement(
        "AGR-2027-000", "BUY-A", 1000, "B", date(2027, 4, 3), date(2027, 4, 10), date(2027, 4, 12), 11000,
        [("FRM-RTN-07", 520), ("FRM-RTN-08", 520)]), now, "MODULE1")
    agreements.intake(db, _agreement(
        "AGR-2027-001", "BUY-A", 6000, "B", date(2027, 4, 15), date(2027, 5, 2), date(2027, 5, 5), 66000,
        [("FRM-RTN-01", 800), ("FRM-RTN-02", 800), ("FRM-RTN-03", 800), ("FRM-RTN-04", 800),
         ("FRM-DVG-01", 750), ("FRM-DVG-02", 750), ("FRM-DVG-03", 750), ("FRM-DVG-04", 750)]), now, "MODULE1")
    agreements.intake(db, _agreement(
        "AGR-2027-002", "BUY-B", 2400, "A", date(2027, 4, 20), date(2027, 5, 10), date(2027, 5, 12), 31200,
        [("FRM-RTN-05", 600), ("FRM-RTN-06", 600), ("FRM-DVG-05", 600), ("FRM-DVG-06", 600)]), now, "MODULE1")
    run_due_jobs(db, now)                                       # schedules farmer doctor visits

    # --- Day 0-1: farmers upload, AI runs ---------------------------------------------------
    now = T0 + timedelta(hours=6)
    for f, p in [("FRM-RTN-07", "good"), ("FRM-RTN-08", "good"), ("FRM-RTN-01", "good"), ("FRM-RTN-02", "borderline"),
                 ("FRM-RTN-03", "good"), ("FRM-DVG-01", "good"), ("FRM-DVG-02", "poor"), ("FRM-DVG-03", "good"),
                 ("FRM-RTN-05", "good"), ("FRM-RTN-06", "good"), ("FRM-DVG-05", "pest"), ("FRM-DVG-06", "blurry")]:
        _upload(db, f, p, now)
    # FRM-RTN-04 and FRM-DVG-04 do not upload: they will get reminders.

    # --- Day 1: farmer doctors visit ---------------------------------------------------------
    now = T0 + timedelta(days=1, hours=2)
    _visit(db, "FRM-RTN-07", "A", now, fruit_inspected=40, observations="Even colour, firm fruit.")
    _visit(db, "FRM-RTN-08", "B", now, fruit_inspected=40, observations="Minor skin marks on a few fruit.")
    _visit(db, "FRM-RTN-01", "A", now, fruit_inspected=50)
    _visit(db, "FRM-RTN-02", "B", now, fruit_inspected=40, observations="Size slightly small; acceptable for B.")
    _visit(db, "FRM-RTN-03", "A", now, fruit_inspected=50)
    _visit(db, "FRM-DVG-01", "A", now, fruit_inspected=45)
    _visit(db, "FRM-DVG-02", "REJECT", now, fruit_inspected=40, observed_defect_pct=24, pest_signs=["anthracnose"],
           observations="Dark lesions on many fruit after last week's dew.",
           recommendations=["Remove and destroy infected fruit and twigs this week."])
    _visit(db, "FRM-DVG-03", "B", now, fruit_inspected=45, observations="AI said A; some sap marks, so B.")
    _visit(db, "FRM-RTN-05", "A", now, fruit_inspected=40)
    _visit(db, "FRM-DVG-05", "A", now, fruit_inspected=40, cleared_flags=["fruit_fly_signs"],
           observations="Marks are old hail scars, not fruit fly stings. Traps show low counts.")

    # --- Day 3: first missed deadline -> reminders ----------------------------------------------
    now = T0 + timedelta(days=2, hours=8)
    run_due_jobs(db, now)
    iv = db.interventions.find_one({"farmer_id": "FRM-DVG-02"})
    quality.add_action(db, iv["_id"], "Infected fruit removed and destroyed; KVK advisory spray done on 1 Apr.",
                       now, Actor("fpo", "FPO-DVG"))
    _upload(db, "FRM-DVG-06", "good", now)                       # retake after the blurry photo

    # --- AGR-2027-000: early-season order goes through harvest, lots, dispatch ------------------
    now = datetime(2027, 4, 3, 2, 0, tzinfo=timezone.utc)
    delivery.notify_harvest(db, "AGR-2027-000", now, "FPO-RTN")
    now = datetime(2027, 4, 5, 3, 0, tzinfo=timezone.utc)
    fpo = Actor("fpo", "FPO-RTN")
    delivery.record_lot(db, "AGR-2027-000", "FPO-RTN", [
        {"farmer_id": "FRM-RTN-07", "kg": 515, "grade": "A"},
        {"farmer_id": "FRM-RTN-08", "kg": 470, "grade": "B"}], now, fpo)
    run_due_jobs(db, now)                                        # second miss -> escalation
    now = datetime(2027, 4, 9, 4, 0, tzinfo=timezone.utc)
    delivery.mark_ready(db, "AGR-2027-000", now, "FPO-RTN")
    now += timedelta(hours=5)
    delivery.fund_tranche2(db, "AGR-2027-000", now, Actor("buyer", "BUY-A"))
    now = datetime(2027, 4, 11, 1, 0, tzinfo=timezone.utc)
    delivery.handover(db, "AGR-2027-000", "Mumbai air cargo terminal (CSMIA)", now, "FPO-RTN")
    run_due_jobs(db, now)                                        # weekly checks + visits fall due

    # --- 12 Apr: most farmers answer the weekly prompt; three stay silent -----------------------
    now = datetime(2027, 4, 12, 2, 30, tzinfo=timezone.utc)
    for f, p in [("FRM-RTN-01", "good"), ("FRM-RTN-02", "borderline"), ("FRM-RTN-03", "good"),
                 ("FRM-DVG-01", "good"), ("FRM-DVG-02", "borderline"), ("FRM-DVG-03", "good"),
                 ("FRM-RTN-05", "good"), ("FRM-DVG-05", "good"), ("FRM-DVG-06", "good")]:
        _upload(db, f, p, now)
    now = datetime(2027, 4, 12, 9, 0, tzinfo=timezone.utc)
    _visit(db, "FRM-RTN-01", "A", now, fruit_inspected=50, observations="Fruit sizing well; harvest from 15 Apr.")
    _visit(db, "FRM-RTN-03", "A", now, fruit_inspected=50)

    # --- Up to 14 Apr: routine jobs, ratings for March, risk feed --------------------------------
    now = datetime(2027, 4, 13, 10, 0, tzinfo=timezone.utc)
    delivery.receive(db, "AGR-2027-000", now, Actor("buyer", "BUY-A"))
    now = datetime(2027, 4, 14, 3, 30, tzinfo=timezone.utc)     # 09:00 IST
    clock.set_now(db, now)
    run_due_jobs(db, now)
    ratings_svc.run_month(db, "2027-03", now)
    risks.ingest_feed(db, now)
    return {"seeded_at": now, "agreements": db.agreements.count_documents({}),
            "farmers": db.farmers.count_documents({}), "checks": db.quality_checks.count_documents({}),
            "reviews": db.quality_reviews.count_documents({}), "trace_events": db.trace_events.count_documents({}),
            "notifications": db.notifications.count_documents({})}


if __name__ == "__main__":
    print(seed())
