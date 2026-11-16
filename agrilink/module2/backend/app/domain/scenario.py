"""Scenario lab: how much contracted supply is exposed to a weather or pest risk.

Loss factors are ILLUSTRATIVE (share of committed kg not expected to reach
contract grade). Replace with agronomy data before real use.
"""
from __future__ import annotations

RISK_TYPES = {
    "unseasonal_rain": {"label": "Unseasonal rain", "weather": True,
                        "loss": {"low": 0.10, "medium": 0.25, "high": 0.40},
                        "advice": ["Harvest fruit that is already mature before the rain.",
                                   "Keep harvested fruit covered and off wet ground.",
                                   "Expect anthracnose after rain: the farmer doctor will check."]},
    "heatwave": {"label": "Heatwave", "weather": True,
                 "loss": {"low": 0.05, "medium": 0.15, "high": 0.25},
                 "advice": ["Irrigate in the early morning where water is available.",
                            "Harvest in the cool hours and keep fruit in shade."]},
    "high_wind": {"label": "High wind", "weather": True,
                  "loss": {"low": 0.05, "medium": 0.15, "high": 0.30},
                  "advice": ["Harvest mature fruit before the wind peak.",
                             "Collect fallen fruit separately; it is not contract grade."]},
    "fruit_fly_outbreak": {"label": "Fruit fly outbreak", "weather": False,
                           "loss": {"low": 0.05, "medium": 0.15, "high": 0.30},
                           "advice": ["Collect and destroy fallen fruit daily.",
                                      "Set methyl eugenol traps as advised by the KVK."]},
    "anthracnose_risk": {"label": "Anthracnose risk", "weather": False,
                         "loss": {"low": 0.05, "medium": 0.12, "high": 0.25},
                         "advice": ["Follow the KVK spray advisory and respect the pre-harvest interval.",
                                    "Remove infected twigs and fruit."]},
}
SEVERITIES = ("low", "medium", "high")


def loss_factor(risk_type: str, severity: str) -> float:
    return RISK_TYPES[risk_type]["loss"][severity]


def assess(commitments: list, risk_type: str, severity: str, areas: list,
           order_kg_by_agreement: dict, threshold: float) -> dict:
    """commitments: [{id, agreement_id, farmer_id, taluka, committed_kg, projected_kg}]
    Returns exposed commitments and a per-agreement view."""
    f = loss_factor(risk_type, severity)
    exposed, by_agr = [], {}
    for c in commitments:
        base = c["projected_kg"]
        hit = c["taluka"] in areas
        new_proj = round(base * (1 - f), 1) if hit else base
        if hit:
            exposed.append({"commitment_id": c["id"], "agreement_id": c["agreement_id"],
                            "farmer_id": c["farmer_id"], "taluka": c["taluka"],
                            "committed_kg": c["committed_kg"], "projected_before_kg": base,
                            "projected_after_kg": new_proj})
        a = by_agr.setdefault(c["agreement_id"], {"agreement_id": c["agreement_id"],
                                                  "order_kg": order_kg_by_agreement[c["agreement_id"]],
                                                  "expected_before_kg": 0.0, "expected_after_kg": 0.0})
        a["expected_before_kg"] += base
        a["expected_after_kg"] += new_proj
    agreements = []
    for a in by_agr.values():
        a["expected_before_kg"] = round(a["expected_before_kg"], 1)
        a["expected_after_kg"] = round(a["expected_after_kg"], 1)
        a["shortfall_kg"] = round(max(0.0, a["order_kg"] - a["expected_after_kg"]), 1)
        a["fill_pct"] = round(100 * a["expected_after_kg"] / a["order_kg"], 1) if a["order_kg"] else 0
        a["supply_risk"] = a["expected_after_kg"] < threshold * a["order_kg"]
        if any(e["agreement_id"] == a["agreement_id"] for e in exposed):
            agreements.append(a)
    return {"loss_factor": f, "exposed": exposed, "agreements": agreements,
            "advice": RISK_TYPES[risk_type]["advice"], "illustrative": True}
