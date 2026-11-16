"""Pure business rules (no database)."""
from datetime import date, datetime, timedelta, timezone

import pytest

from app.domain import escrow as esc
from app.domain import ratings as rt
from app.domain import scenario as sc
from app.domain.quality import Grade, ReviewStatus, cv_grade, guidance_for, review
from app.errors import Conflict, DomainError

GOOD = {"defect_pct": 3, "colour_score": 0.8, "est_weight_g": 230, "confidence": 0.9, "flags": []}
OK = {"defect_pct": 10, "colour_score": 0.6, "est_weight_g": 180, "confidence": 0.9, "flags": []}
BAD = {"defect_pct": 25, "colour_score": 0.8, "est_weight_g": 230, "confidence": 0.9, "flags": []}
T = datetime(2027, 4, 14, tzinfo=timezone.utc)


class TestQuality:
    def test_cv_grades(self):
        assert cv_grade(GOOD) == Grade.A and cv_grade(OK) == Grade.B and cv_grade(BAD) == Grade.REJECT

    def test_blocking_flag(self):
        assert cv_grade(dict(GOOD, flags=["fruit_fly_signs"])) == Grade.REJECT

    def test_boundaries_inclusive(self):
        assert cv_grade(dict(GOOD, defect_pct=5.0)) == Grade.A
        assert cv_grade(dict(OK, defect_pct=15.0)) == Grade.B
        assert cv_grade(dict(OK, defect_pct=15.01)) == Grade.REJECT

    def test_ai_alone_never_final(self):
        o = review(GOOD, None, Grade.B)
        assert o.status == ReviewStatus.PENDING_DOCTOR and o.final_grade is None and o.provisional_grade == Grade.A

    def test_low_confidence_retake(self):
        assert review(dict(GOOD, confidence=0.3), None, Grade.B).status == ReviewStatus.RETAKE_PHOTO

    def test_doctor_overrides_and_disagreement_recorded(self):
        o = review(BAD, {"grade": "B"}, Grade.B)
        assert o.status == ReviewStatus.PASS and o.disagree

    def test_contract_grade_a(self):
        assert review(OK, {"grade": "B"}, Grade.A).status == ReviewStatus.FAIL

    def test_uncleared_flag_reported(self):
        o = review(dict(GOOD, flags=["anthracnose"]), {"grade": "B", "cleared_flags": []}, Grade.B)
        assert o.status == ReviewStatus.PASS and o.open_flags == ["anthracnose"]

    def test_guidance_matches_cause(self):
        keys = [g["key"] for g in guidance_for(dict(BAD, flags=["fruit_fly_signs"]), None)]
        assert keys[0] == "fruit_fly_signs" and "high_defects" in keys


class TestRatings:
    def test_weather_exempt(self):
        c = rt.farmer_components({"committed_kg": 1000, "delivered_kg": 600, "exempt_shortfall_kg": 400})
        assert c["fulfilment"] == 1.0

    def test_missing_components_renormalised(self):
        assert rt.weighted(rt.farmer_components({"committed_kg": 10, "delivered_kg": 10}), rt.FARMER_WEIGHTS) == 100.0

    def test_smoothing_and_no_data(self):
        assert rt.smooth(None, 0, 80.0) == (80.0, 1)
        assert rt.smooth(80.0, 3, 50.0) == (71.0, 4)
        assert rt.smooth(70.0, 3, None) == (70.0, 3)

    def test_switch_after_six_months(self):
        assert not rt.ranking_live(date(2026, 11, 1), date(2027, 4, 30))
        assert rt.ranking_live(date(2026, 11, 1), date(2027, 5, 1))

    def test_order_candidates(self):
        items = [{"id": "late_star", "b": 9, "s": 95, "n": False}, {"id": "early_weak", "b": 1, "s": 45, "n": False},
                 {"id": "new", "b": 5, "s": 50, "n": True}, {"id": "mid", "b": 3, "s": 70, "n": False}]
        kw = dict(booked=lambda i: i["b"], score=lambda i: i["s"], is_new=lambda i: i["n"], reserve_share=0.2)
        fcfs = [i["id"] for i, _ in rt.order_candidates(items, False, slots=3, **kw)]
        live = [(i["id"], why) for i, why in rt.order_candidates(items, True, slots=3, **kw)]
        assert fcfs == ["early_weak", "mid", "new"]
        assert live == [("new", "reserved slot for new"), ("late_star", "ranked by rating"), ("mid", "ranked by rating")]


class TestEscrow:
    def _funded(self):
        st = esc.initial(1000, True, T)
        return esc.fund_tranche2(st, T, "ref", 500)

    def test_settlement_is_pro_rata_and_capped(self):
        full = esc.settlement(1000, 100, 100, 500)
        assert full["payable_value"] == 1000 and full["tranche2_due"] == 500 and full["advance_excess"] == 0
        part = esc.settlement(1000, 100, 80, 500)
        assert part["payable_value"] == 800 and part["tranche2_due"] == 300
        short = esc.settlement(1000, 100, 30, 500)
        assert short["tranche2_due"] == 0 and short["advance_excess"] == 200
        assert esc.settlement(1000, 100, 120, 500)["payable_value"] == 1000

    def test_tranche1_released_at_signing(self):
        st = esc.initial(1000, True, T)
        assert st["paid_to_fpo"] == 500 and st["held"] == 0

    def test_confirm_releases(self):
        st = esc.confirm(esc.receive(self._funded(), T, 72), T, "r")
        assert st["status"] == "RELEASED" and st["paid_to_fpo"] == 1000

    def test_dispute_after_window_rejected(self):
        st = esc.receive(self._funded(), T, 72)
        with pytest.raises(Conflict):
            esc.dispute(st, T + timedelta(hours=73), "bruised")

    def test_dispute_needs_reason(self):
        with pytest.raises(DomainError):
            esc.dispute(esc.receive(self._funded(), T, 72), T, "  ")

    def test_origin_fault_refunds(self):
        st = esc.dispute(esc.receive(self._funded(), T, 72), T, "mixed grade")
        st = esc.surveyor(st, T, "origin_quality", "r")
        assert st["status"] == "REFUNDED" and st["refunded_to_buyer"] == 500 and st["paid_to_fpo"] == 500

    def test_auto_release_only_after_window(self):
        st = esc.receive(self._funded(), T, 72)
        with pytest.raises(Conflict):
            esc.auto_release(st, T + timedelta(hours=72), "r")
        assert esc.auto_release(st, T + timedelta(hours=72, seconds=1), "r")["status"] == "RELEASED"

    def test_cannot_skip_funding(self):
        with pytest.raises(Conflict):
            esc.receive(esc.initial(1000, True, T), T, 72)


class TestScenario:
    def test_exposure_and_supply_risk(self):
        cms = [{"id": "c1", "agreement_id": "A", "farmer_id": "f1", "taluka": "Devgad", "committed_kg": 500, "projected_kg": 500},
               {"id": "c2", "agreement_id": "A", "farmer_id": "f2", "taluka": "Ratnagiri", "committed_kg": 500, "projected_kg": 500}]
        res = sc.assess(cms, "unseasonal_rain", "high", ["Devgad"], {"A": 1000}, 0.95)
        assert len(res["exposed"]) == 1 and res["exposed"][0]["projected_after_kg"] == 300
        assert res["agreements"][0]["shortfall_kg"] == 200 and res["agreements"][0]["supply_risk"]

    def test_unaffected_agreement_not_listed(self):
        cms = [{"id": "c1", "agreement_id": "A", "farmer_id": "f1", "taluka": "Ratnagiri", "committed_kg": 500, "projected_kg": 500}]
        assert sc.assess(cms, "heatwave", "low", ["Devgad"], {"A": 500}, 0.95)["agreements"] == []
