"""Monthly ratings and the ranking rule shared with Module 1.

Weights, smoothing and the "new" threshold are ILLUSTRATIVE.
"""
from __future__ import annotations

import math
from datetime import date
from typing import Callable, Optional

FARMER_WEIGHTS = {"fulfilment": 0.30, "quality": 0.25, "on_time_delivery": 0.15,
                  "responsiveness": 0.10, "commitment": 0.10, "buyer_review": 0.10}
BUYER_WEIGHTS = {"on_time_payment": 0.30, "order_commitment": 0.25, "fair_grading": 0.20,
                 "responsiveness": 0.10, "farmer_review": 0.15}
GRADE_SCORE = {"A": 1.0, "B": 0.7, "REJECT": 0.0}
SMOOTHING_ALPHA = 0.30
NEW_THRESHOLD_CYCLES = 2
PILOT_MONTHS = 6
NEUTRAL_START = 50.0


def ratio(num: float, den: float) -> Optional[float]:
    return None if den <= 0 else max(0.0, min(1.0, num / den))


def stars_to_unit(stars: Optional[float]) -> Optional[float]:
    return None if stars is None else max(0.0, min(1.0, (stars - 1.0) / 4.0))


def weighted(components: dict, weights: dict) -> Optional[float]:
    present = {k: v for k, v in components.items() if v is not None}
    total = sum(weights[k] for k in present)
    if total == 0:
        return None
    return round(100.0 * sum(weights[k] * v for k, v in present.items()) / total, 1)


def farmer_components(m: dict) -> dict:
    adjusted = max(m.get("committed_kg", 0) - m.get("exempt_shortfall_kg", 0), 0)
    grades = m.get("grades", [])
    return {
        "fulfilment": ratio(m.get("delivered_kg", 0), adjusted),
        "quality": (sum(GRADE_SCORE[g] for g in grades) / len(grades)) if grades else None,
        "on_time_delivery": ratio(m.get("deliveries_on_time", 0), m.get("deliveries", 0)),
        "responsiveness": ratio(m.get("prompts_on_time", 0), m.get("prompts", 0)),
        "commitment": ratio(m.get("commitments_honoured", 0), m.get("commitments_closed", 0)),
        "buyer_review": stars_to_unit(m.get("buyer_stars")),
    }


def buyer_components(m: dict) -> dict:
    receipts = m.get("receipts", 0)
    return {
        "on_time_payment": ratio(m.get("payments_on_time", 0), m.get("payments_due", 0)),
        "order_commitment": ratio(m.get("orders_kept", 0), m.get("orders", 0)),
        "fair_grading": None if receipts == 0 else max(0.0, 1 - m.get("unfounded_disputes", 0) / receipts),
        "responsiveness": ratio(m.get("responded_in_window", 0), receipts),
        "farmer_review": stars_to_unit(m.get("farmer_stars")),
    }


def smooth(prev_rating: Optional[float], prev_cycles: int, month_score: Optional[float],
           alpha: float = SMOOTHING_ALPHA) -> tuple:
    """Returns (rating, cycles). A month with no data leaves the rating unchanged."""
    if month_score is None:
        return (prev_rating if prev_rating is not None else NEUTRAL_START), prev_cycles
    if prev_cycles == 0 or prev_rating is None:
        return month_score, 1
    return round(prev_rating * (1 - alpha) + month_score * alpha, 1), prev_cycles + 1


def add_months(d: date, months: int) -> date:
    y, m = divmod(d.month - 1 + months, 12)
    year, month = d.year + y, m + 1
    leap = year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)
    last = [31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
    return date(year, month, min(d.day, last))


def ranking_live(pilot_start: date, today: date, months: int = PILOT_MONTHS) -> bool:
    return today >= add_months(pilot_start, months)


def order_candidates(items: list, live: bool, booked: Callable, score: Callable,
                     is_new: Callable, reserve_share: float, slots: Optional[int] = None) -> list:
    """Module 1's rule, reused for supply recovery.

    Pilot (not live): first come, first served.
    Live: by rating, with `reserve_share` of slots held for new candidates.
    Returns [(item, reason)].
    """
    n = len(items) if slots is None else min(slots, len(items))
    if n <= 0:
        return []
    if not live:
        return [(i, "first come, first served") for i in sorted(items, key=booked)[:n]]
    new = sorted([i for i in items if is_new(i)], key=booked)
    est = sorted([i for i in items if not is_new(i)], key=lambda i: (-score(i), booked(i)))
    reserved = min(math.ceil(n * reserve_share), len(new))
    chosen = [(i, "reserved slot for new") for i in new[:reserved]]
    chosen += [(i, "ranked by rating") for i in est[: n - len(chosen)]]
    if len(chosen) < n:
        chosen += [(i, "new (filled spare slot)") for i in new[reserved: reserved + n - len(chosen)]]
    return chosen
