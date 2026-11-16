"""Weather / pest risk feed adapter.

SimulatedRiskFeed returns fixed, clearly labelled demo alerts for Konkan
talukas. A real feed (IMD GKMS agromet advisories, KVK pest bulletins) should
implement `fetch(now) -> list[dict]` with the same fields.
"""
from __future__ import annotations

from datetime import datetime, timedelta


class SimulatedRiskFeed:
    name = "SIMULATED feed (IMD / KVK integration pending)"

    def fetch(self, now: datetime) -> list:
        return [
            {"type": "unseasonal_rain", "severity": "high", "areas": ["Devgad"],
             "starts_at": now + timedelta(days=2), "ends_at": now + timedelta(days=4),
             "summary": "Heavy pre-monsoon showers forecast over Devgad taluka."},
            {"type": "fruit_fly_outbreak", "severity": "medium", "areas": ["Ratnagiri"],
             "starts_at": now, "ends_at": now + timedelta(days=10),
             "summary": "Rising fruit fly trap counts reported around Ratnagiri."},
        ]


risk_feed = SimulatedRiskFeed()
