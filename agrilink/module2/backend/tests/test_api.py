"""End-to-end API journeys against MongoDB (test database), starting from the seed
state (simulated clock: 14 Apr 2027 03:30 UTC)."""
from conftest import GOOD_PNG, OPS, SYSTEM, as_

FPO_RTN = as_("fpo", "FPO-RTN")
FPO_DVG = as_("fpo", "FPO-DVG")
BUY_A = as_("buyer", "BUY-A")


def err(r):
    return r.json()["error"]["message"]


def advance(client, hours):
    r = client.post("/api/m2/system/clock/advance", json={"hours": hours}, headers=OPS)
    assert r.status_code == 200, r.text
    return r.json()


# ------------------------------------------------------------------ access
class TestAccess:
    def test_role_header_required(self, client):
        assert client.get("/api/m2/agreements").status_code == 403

    def test_actor_required_for_non_admin(self, client):
        assert client.get("/api/m2/agreements", headers={"X-M2-Role": "buyer"}).status_code == 403

    def test_buyer_sees_only_own(self, client):
        ids = {a["id"] for a in client.get("/api/m2/agreements", headers=as_("buyer", "BUY-B")).json()}
        assert ids == {"AGR-2027-002"}
        assert client.get("/api/m2/agreements/AGR-2027-001", headers=as_("buyer", "BUY-B")).status_code == 403

    def test_farmer_cannot_list_agreements(self, client):
        assert client.get("/api/m2/agreements", headers=as_("farmer", "FRM-RTN-04")).status_code == 403

    def test_health_and_meta(self, client):
        assert client.get("/api/m2/health").json()["status"] == "ok"
        m = client.get("/api/m2/meta").json()
        assert m["clock_simulated"] and "FPO-RTN" in [x["id"] for x in m["actors"]["fpo"]]


# ------------------------------------------------------------------ intake (Module 1 boundary)
class TestIntake:
    BODY = {"id": "AGR-T-1", "buyer_id": "BUY-B", "quantity_kg": 500, "required_grade": "B",
            "harvest_window_start": "2027-04-20", "harvest_window_end": "2027-04-30",
            "dispatch_deadline": "2027-05-02", "contract_value": 6000,
            "commitments": [{"farmer_id": "FRM-RJP-01", "committed_kg": 500}]}

    def test_intake_creates_commitments_checks_escrow(self, client, db):
        r = client.post("/api/m2/agreements", json=self.BODY, headers=SYSTEM)
        assert r.status_code == 201, r.text
        assert db.commitments.count_documents({"agreement_id": "AGR-T-1"}) == 1
        assert db.quality_checks.count_documents({"agreement_id": "AGR-T-1", "status": "DUE"}) == 1
        e = db.escrow_accounts.find_one({"_id": "AGR-T-1"})
        assert e["status"] == "SIGNED" and e["paid_to_fpo"] == 3000

    def test_only_system_can_intake(self, client):
        assert client.post("/api/m2/agreements", json=self.BODY, headers=FPO_RTN).status_code == 403

    def test_rejections(self, client):
        client.post("/api/m2/agreements", json=self.BODY, headers=SYSTEM)
        assert client.post("/api/m2/agreements", json=self.BODY, headers=SYSTEM).status_code == 409
        bad = dict(self.BODY, id="AGR-T-2", commitments=[{"farmer_id": "NOPE", "committed_kg": 5}])
        assert client.post("/api/m2/agreements", json=bad, headers=SYSTEM).status_code == 404
        unsigned = dict(self.BODY, id="AGR-T-3", commitments=[{"farmer_id": "FRM-RJP-02", "committed_kg": 5,
                                                                "signed_in_person": False}])
        assert "signing" in err(client.post("/api/m2/agreements", json=unsigned, headers=SYSTEM))
        assert client.post("/api/m2/agreements", json=dict(self.BODY, id="AGR-T-4", quantity_kg=-1),
                           headers=SYSTEM).status_code == 422


# ------------------------------------------------------------------ section 1-3
class TestQualityLoop:
    def _open_check(self, db, farmer):
        return db.quality_checks.find_one({"farmer_id": farmer, "status": {"$in": ["DUE", "REMINDED", "RETAKE_REQUESTED"]}})

    def test_farmer_view_shows_only_prompts(self, client):
        v = client.get("/api/m2/farmer-view", headers=as_("farmer", "FRM-RTN-04")).json()
        assert v["prompts"] and set(v["prompts"][0]) == {"check_id", "due_at", "deadline", "status", "is_retake", "reminders"}

    def test_upload_runs_ai_and_review(self, client, db):
        chk = self._open_check(db, "FRM-RTN-06")
        r = client.post(f"/api/m2/quality-checks/{chk['_id']}/photos", headers=as_("farmer", "FRM-RTN-06"),
                        files=[("photos", ("a.png", GOOD_PNG, "image/png"))], data={"simulation_profile": "good"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["check"]["status"] == "ANALYSED" and body["check"]["cv"]["simulated"] is True
        assert body["review"]["status"] == "PENDING_DOCTOR" and body["review"]["provisional_grade"] == "A"

    def test_upload_rules(self, client, db):
        chk = self._open_check(db, "FRM-RTN-06")
        url = f"/api/m2/quality-checks/{chk['_id']}/photos"
        other = client.post(url, headers=as_("farmer", "FRM-RTN-01"), files=[("photos", ("a.png", GOOD_PNG, "image/png"))])
        assert other.status_code == 403
        txt = client.post(url, headers=as_("farmer", "FRM-RTN-06"), files=[("photos", ("a.txt", b"hello", "text/plain"))])
        assert txt.status_code == 400 and "JPEG" in err(txt)
        closed = db.quality_checks.find_one({"farmer_id": "FRM-RTN-01", "status": "ANALYSED"})
        assert client.post(f"/api/m2/quality-checks/{closed['_id']}/photos", headers=as_("farmer", "FRM-RTN-01"),
                           files=[("photos", ("a.png", GOOD_PNG, "image/png"))]).status_code == 409

    def test_blurry_photo_asks_for_retake(self, client, db):
        chk = self._open_check(db, "FRM-RTN-06")
        r = client.post(f"/api/m2/quality-checks/{chk['_id']}/photos", headers=as_("farmer", "FRM-RTN-06"),
                        files=[("photos", ("a.png", GOOD_PNG, "image/png"))], data={"simulation_profile": "blurry"})
        assert r.json()["check"]["status"] == "RETAKE_REQUESTED"

    def test_second_miss_escalates_to_doctor(self, client, db):
        # FRM-RTN-06 already has one miss; the next deadline passing escalates.
        jobs = advance(client, 49)["jobs"]
        assert jobs["escalated"] >= 1
        assert db.quality_checks.find_one({"farmer_id": "FRM-RTN-06", "status": "MISSED"})
        v = db.doctor_visits.find_one({"farmer_id": "FRM-RTN-06", "status": "SCHEDULED"})
        assert v["priority"] and any(x["trigger"] == "missed_uploads" for x in v["reasons"])

    def test_doctor_visit_confirms_pass(self, client, db):
        v = db.doctor_visits.find_one({"farmer_id": "FRM-RTN-06", "status": "SCHEDULED"})
        wrong = client.post(f"/api/m2/doctor-visits/{v['_id']}/complete", json={"grade": "A"}, headers=as_("doctor", "DOC-DVG"))
        assert wrong.status_code == 403
        r = client.post(f"/api/m2/doctor-visits/{v['_id']}/complete", json={"grade": "A", "fruit_inspected": 30},
                        headers=as_("doctor", "DOC-RTN"))
        assert r.status_code == 200, r.text
        assert r.json()["reviews"][0]["status"] == "PASS"
        assert db.commitments.find_one({"farmer_id": "FRM-RTN-06"})["quality_status"] == "PASS"
        again = client.post(f"/api/m2/doctor-visits/{v['_id']}/complete", json={"grade": "A"}, headers=as_("doctor", "DOC-RTN"))
        assert again.status_code == 409

    def test_fail_opens_intervention_then_verify_rechecks(self, client, db):
        v = db.doctor_visits.find_one({"farmer_id": "FRM-RTN-06", "status": "SCHEDULED"})
        r = client.post(f"/api/m2/doctor-visits/{v['_id']}/complete", headers=as_("doctor", "DOC-RTN"),
                        json={"grade": "REJECT", "pest_signs": ["fruit_fly_signs"], "recommendations": ["Bag the fruit."]})
        assert r.json()["reviews"][0]["status"] == "FAIL"
        iv = db.interventions.find_one({"farmer_id": "FRM-RTN-06"})
        assert iv["status"] == "OPEN" and any(x["source"] == "farmer_doctor" for x in iv["recommendations"])
        url = f"/api/m2/interventions/{iv['_id']}"
        assert client.post(url + "/verify", json={"effective": True}, headers=as_("doctor", "DOC-RTN")).status_code == 409
        assert client.post(url + "/actions", json={"note": "Traps set, fallen fruit removed"}, headers=FPO_RTN).status_code == 200
        res = client.post(url + "/verify", json={"effective": True, "note": "Trap counts down"}, headers=as_("doctor", "DOC-RTN")).json()
        assert res["intervention"]["status"] == "VERIFIED"
        assert self._open_check(db, "FRM-RTN-06") is not None     # re-check scheduled

    def test_bad_flag_rejected(self, client, db):
        v = db.doctor_visits.find_one({"farmer_id": "FRM-RTN-06", "status": "SCHEDULED"})
        r = client.post(f"/api/m2/doctor-visits/{v['_id']}/complete", json={"grade": "A", "pest_signs": ["dragon"]},
                        headers=as_("doctor", "DOC-RTN"))
        assert r.status_code == 400


# ------------------------------------------------------------------ section 4
class TestRiskAndRecovery:
    def _rain(self, db):
        return db.risk_alerts.find_one({"type": "unseasonal_rain"})

    def test_scenario_finds_supply_risk_and_exempts_farmers(self, client, db):
        a = self._rain(db)
        r = client.post(f"/api/m2/risks/{a['_id']}/scenario", headers=OPS).json()
        assert r["status"] == "ASSESSED" and r["scenario"]["supply_risk"]
        agr = next(x for x in r["scenario"]["agreements"] if x["agreement_id"] == "AGR-2027-001")
        assert agr["supply_risk"] and agr["shortfall_kg"] > 0
        assert all(e["taluka"] == "Devgad" for e in r["scenario"]["exposed"])
        cm = db.commitments.find_one({"farmer_id": "FRM-DVG-01", "agreement_id": "AGR-2027-001"})
        assert cm["exempt_shortfall_kg"] == 300 and cm["projected_kg"] == 450
        assert client.post(f"/api/m2/risks/{a['_id']}/scenario", headers=OPS).status_code == 409

    def test_recommendations_once(self, client, db):
        a = self._rain(db)
        assert client.post(f"/api/m2/risks/{a['_id']}/recommendations", headers=OPS).status_code == 409
        client.post(f"/api/m2/risks/{a['_id']}/scenario", headers=OPS)
        before = db.notifications.count_documents({})
        assert client.post(f"/api/m2/risks/{a['_id']}/recommendations", headers=OPS).status_code == 200
        assert db.notifications.count_documents({}) > before
        assert client.post(f"/api/m2/risks/{a['_id']}/recommendations", headers=OPS).status_code == 409

    def test_recovery_offer_and_in_person_acceptance(self, client, db):
        a = self._rain(db)
        client.post(f"/api/m2/risks/{a['_id']}/scenario", headers=OPS)
        req = client.post("/api/m2/recovery-requests", headers=OPS,
                          json={"agreement_id": "AGR-2027-001", "alert_id": a["_id"]}).json()
        assert req["ranking_mode"] == "first_come_first_served"
        assert [c["fpo_id"] for c in req["candidates"]] == ["FPO-RJP", "FPO-VNG", "FPO-GHR"]   # by capacity posted
        assert "FPO-DVG" not in [c["fpo_id"] for c in req["candidates"]]
        assert client.post("/api/m2/recovery-requests", headers=OPS,
                           json={"agreement_id": "AGR-2027-001", "alert_id": a["_id"]}).status_code == 409
        url = f"/api/m2/recovery-requests/{req['id']}"
        assert client.post(url + "/offers", json={"fpo_id": "FPO-RJP", "kg": 99999}, headers=OPS).status_code == 400
        assert client.post(url + "/offers", json={"fpo_id": "FPO-RJP", "kg": 900}, headers=OPS).status_code == 200
        resp = url + "/offers/FPO-RJP/response"
        rjp = as_("fpo", "FPO-RJP")
        assert "signatures" in err(client.post(resp, headers=rjp, json={"accepted": True, "allocations": []}))
        bad = {"accepted": True, "signed_in_person": True, "allocations": [{"farmer_id": "FRM-RJP-01", "kg": 100}]}
        assert "add up" in err(client.post(resp, headers=rjp, json=bad))
        assert client.post(resp, headers=as_("fpo", "FPO-VNG"), json=bad).status_code == 403
        ok = {"accepted": True, "signed_in_person": True,
              "allocations": [{"farmer_id": "FRM-RJP-01", "kg": 500}, {"farmer_id": "FRM-RJP-02", "kg": 400}]}
        r = client.post(resp, headers=rjp, json=ok).json()
        assert r["filled_kg"] == 900
        assert db.commitments.count_documents({"agreement_id": "AGR-2027-001", "source": "recovery"}) == 2
        assert db.fpos.find_one({"_id": "FPO-RJP"})["spare_capacity_kg"] == 1600
        assert db.agreements.find_one({"_id": "AGR-2027-001"})["revisions"][0]["added_kg"] == 900

    def test_ranking_switches_to_rating_after_six_months(self, client, db):
        assert client.get("/api/m2/ratings/status", headers=OPS).json()["mode"] == "first_come_first_served"
        advance(client, 24 * 17)                    # to 1 May 2027
        assert client.get("/api/m2/ratings/status", headers=OPS).json()["live"] is True

    def test_withdrawal_creates_shortfall(self, client, db):
        cm = db.commitments.find_one({"farmer_id": "FRM-RTN-04", "agreement_id": "AGR-2027-001"})
        assert client.post(f"/api/m2/commitments/{cm['_id']}/withdraw", json={"reason": "Sold to a local trader"},
                           headers=FPO_DVG).status_code == 403
        r = client.post(f"/api/m2/commitments/{cm['_id']}/withdraw", json={"reason": "Sold to a local trader"}, headers=FPO_RTN)
        assert r.status_code == 200 and r.json()["supply"]["withdrawn"] == 1
        req = client.post("/api/m2/recovery-requests", headers=OPS, json={"agreement_id": "AGR-2027-001", "reason": "withdrawal"})
        assert req.status_code == 201 and req.json()["shortfall_kg"] > 0


# ------------------------------------------------------------------ section 5
class TestDeliveryAndEscrow:
    def test_full_order_with_transit_dispute(self, client, db):
        aid = "AGR-2027-001"
        base = f"/api/m2/agreements/{aid}"
        assert client.post(base + "/lots", headers=FPO_RTN, json={"fpo_id": "FPO-RTN", "contributions": [
            {"farmer_id": "FRM-RTN-01", "kg": 100, "grade": "A"}]}).status_code == 409        # no harvest notice yet
        assert client.post(base + "/harvest-notice", headers=FPO_RTN).json()["sent"] >= 1
        blocked = client.post(base + "/lots", headers=FPO_DVG, json={"fpo_id": "FPO-DVG", "contributions": [
            {"farmer_id": "FRM-DVG-02", "kg": 100, "grade": "B"}]})
        assert blocked.status_code == 400 and "no passing quality review" in err(blocked)
        lot = client.post(base + "/lots", headers=FPO_RTN, json={"fpo_id": "FPO-RTN", "contributions": [
            {"farmer_id": "FRM-RTN-01", "kg": 800, "grade": "A"},
            {"farmer_id": "FRM-RTN-02", "kg": 300, "grade": "REJECT"},
            {"farmer_id": "FRM-RTN-03", "kg": 790, "grade": "B"}]}).json()
        assert lot["total_kg"] == 1590 and lot["diverted"][0]["kg"] == 300 and "<svg" in lot["qr_svg"]
        assert db.commitments.find_one({"farmer_id": "FRM-RTN-01", "agreement_id": aid})["status"] == "DELIVERED"
        assert client.post(base + "/escrow/fund", headers=BUY_A).status_code == 409           # not ready yet
        assert client.post(base + "/ready-for-dispatch", headers=FPO_RTN).status_code == 200
        assert client.post(base + "/handover", headers=FPO_RTN, json={"port": "JNPA"}).status_code == 409   # not funded
        assert client.post(base + "/escrow/fund", headers=as_("buyer", "BUY-B")).status_code == 403
        assert client.post(base + "/escrow/fund", headers=BUY_A).status_code == 200
        assert client.post(base + "/handover", headers=FPO_RTN, json={"port": "Mumbai air cargo (CSMIA)"}).json()["status"] == "DISPATCHED"
        assert client.post(base + "/receipt", headers=BUY_A).json()["status"] == "RECEIVED"
        assert client.post(base + "/dispute", headers=BUY_A, json={"reason": "Bruised fruit in two cartons"}).status_code == 200
        assert client.post(base + "/surveyor-decision", headers=BUY_A, json={"cause": "transit", "surveyor": "X"}).status_code == 403
        done = client.post(base + "/surveyor-decision", headers=OPS,
                           json={"cause": "transit", "surveyor": "Independent surveyor (simulated)"}).json()
        assert done["status"] == "COMPLETE"
        e = client.get(base + "/escrow", headers=BUY_A).json()
        # Paid for what shipped: 1,590 of 6,000 kg -> 17,490; the 33,000 advance exceeds it.
        assert e["status"] == "RELEASED" and e["paid_to_fpo"] == 33000 and e["held"] == 0
        assert e["settlement"]["payable_value"] == 17490 and e["settlement"]["advance_excess"] == 15510
        assert db.lots.find_one({"_id": lot["id"]})["status"] == "RECEIVED"

    def test_dispute_window_and_auto_release(self, client, db):
        base = "/api/m2/agreements/AGR-2027-000"
        advance(client, 54)                                           # 16 Apr 09:30; window ends 10:00
        assert db.agreements.find_one({"_id": "AGR-2027-000"})["status"] == "RECEIVED"
        advance(client, 24)
        a = db.agreements.find_one({"_id": "AGR-2027-000"})
        assert a["status"] == "COMPLETE" and a["buyer_response"] == "none_in_window"
        assert client.post(base + "/dispute", headers=BUY_A, json={"reason": "late complaint"}).status_code == 409

    def test_origin_fault_refunds_buyer(self, client):
        base = "/api/m2/agreements/AGR-2027-000"
        client.post(base + "/dispute", headers=BUY_A, json={"reason": "Grade B fruit packed as A"})
        r = client.post(base + "/surveyor-decision", headers=OPS, json={"cause": "origin_quality", "surveyor": "Surveyor (simulated)"}).json()
        assert r["status"] == "REFUNDED"
        e = client.get(base + "/escrow", headers=OPS).json()
        # 985 of 1,000 kg shipped: payable 10,835; advance 5,500; tranche 2 = 5,335 refunded.
        assert e["refunded_to_buyer"] == 5335 and e["paid_to_fpo"] == 5500

    def test_reviews_after_close(self, client, db):
        base = "/api/m2/agreements/AGR-2027-000"
        fb = {"direction": "buyer_to_supply", "stars": 5, "comment": "Consistent colour"}
        assert client.post(base + "/feedback", headers=BUY_A, json=fb).status_code == 409    # still open
        client.post(base + "/confirm", headers=BUY_A)
        assert client.post(base + "/feedback", headers=BUY_A, json=fb).status_code == 201
        assert client.post(base + "/feedback", headers=BUY_A, json=fb).status_code == 409
        fr = {"direction": "farmer_to_buyer", "stars": 4, "farmer_id": "FRM-RTN-07"}
        assert client.post(base + "/feedback", headers=FPO_DVG, json=fr).status_code == 403
        assert client.post(base + "/feedback", headers=FPO_RTN, json=fr).status_code == 201


# ------------------------------------------------------------------ ratings & trace
class TestRatingsAndTrace:
    def test_monthly_ratings_from_records(self, client, db):
        client.post("/api/m2/agreements/AGR-2027-000/confirm", headers=BUY_A)
        client.post("/api/m2/agreements/AGR-2027-000/feedback", headers=BUY_A,
                    json={"direction": "buyer_to_supply", "stars": 5})
        r = client.post("/api/m2/ratings/run", json={"period": "2027-04"}, headers=OPS).json()
        assert r["farmers_rated"] > 0 and r["buyers_rated"] >= 1
        hist = client.get("/api/m2/ratings/farmer/FRM-RTN-07/history", headers=OPS).json()
        assert [h["period"] for h in hist] == ["2027-03", "2027-04"] and hist[-1]["cycles"] == 2
        apr = hist[-1]["components"]
        assert apr["buyer_review"] == 1.0 and apr["fulfilment"] is not None
        assert client.post("/api/m2/ratings/run", json={"period": "2027-09"}, headers=OPS).status_code == 400
        own = client.get("/api/m2/ratings/farmer", headers=as_("farmer", "FRM-RTN-07")).json()
        assert {x["subject_id"] for x in own} == {"FRM-RTN-07"}

    def test_public_lot_trace_and_tamper_detection(self, client, db):
        lot = db.lots.find_one({"agreement_id": "AGR-2027-000"})
        t = client.get(f"/api/m2/trace/lots/{lot['_id']}").json()
        stages = [e["stage"] for e in t["events"]]
        assert "LOT_COLLECTED" in stages and "HANDOVER_AT_PORT" in stages and t["chain"]["ok"]
        db.trace_events.update_one({"stage": "LOT_COLLECTED"}, {"$set": {"summary": "edited"}})
        assert client.get("/api/m2/trace/verify").json()["ok"] is False

    def test_notifications_scoped(self, client):
        own = client.get("/api/m2/notifications", headers=as_("farmer", "FRM-RTN-04")).json()
        assert own and all(n["to_id"] == "FRM-RTN-04" for n in own)
