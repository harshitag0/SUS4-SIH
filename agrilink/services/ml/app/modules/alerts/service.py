"""Proactive weather/season alerts. Pure rules; weather input comes from a feed (IMD/Open-Meteo, TODO)."""


def evaluate(rain_mm_48h: float, wind_kmh: float, temp_c: float, hail: bool,
             grade_a_tons_ready: float = 0.0, committed_tons: float = 0.0) -> list[dict]:
    alerts = []

    def add(code, severity, actions, **params):
        alerts.append({"code": code, "severity": severity, "actions": actions, "params": params})

    at_risk = round(min(grade_a_tons_ready, committed_tons) * 0.2, 1)
    if hail:
        add("hail", "high", ["harvest_ripe_now", "photo_evidence", "notify_buyer"], tons_at_risk=at_risk)
    if rain_mm_48h >= 50 or wind_kmh >= 60:
        add("storm", "high", ["harvest_ripe_now", "cover_crates", "notify_buyer", "photo_evidence"],
            tons_at_risk=at_risk)
    elif rain_mm_48h >= 20:
        add("rain", "medium", ["harvest_ripe_early", "cover_crates"], tons_at_risk=round(at_risk / 2, 1))
    if temp_c >= 40:
        add("heat", "medium", ["irrigate_morning", "harvest_early_morning"], tons_at_risk=0)
    return alerts
