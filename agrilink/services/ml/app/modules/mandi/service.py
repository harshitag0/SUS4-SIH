"""Live mandi (APMC) prices from Agmarknet via the data.gov.in API.

Needs a free API key from https://data.gov.in (env DATA_GOV_IN_API_KEY). Without a key, or if the API
is unreachable, returns source="unavailable" with a reason - the app then falls back to the model price.
Prices in the feed are Rs/quintal; we convert to Rs/kg.
"""
import os
import time
import httpx

RESOURCE = "9ef84268-d588-465a-a308-a864a43d0070"  # Current daily price of commodities from mandis
URL = f"https://api.data.gov.in/resource/{RESOURCE}"
TTL_S = 3600
_cache: dict = {}


def parse_records(records: list[dict]) -> dict:
    """Pure: data.gov.in records -> summary in Rs/kg. Keeps rows with a positive modal price."""
    rows = []
    for r in records:
        try:
            modal = float(r.get("modal_price") or 0)
        except ValueError:
            continue
        if modal <= 0:
            continue
        rows.append({
            "market": r.get("market"), "district": r.get("district"), "state": r.get("state"),
            "variety": r.get("variety"), "date": r.get("arrival_date"),
            "modal_kg": round(modal / 100, 1),
            "min_kg": round(float(r.get("min_price") or 0) / 100, 1),
            "max_kg": round(float(r.get("max_price") or 0) / 100, 1),
        })
    avg = round(sum(x["modal_kg"] for x in rows) / len(rows), 1) if rows else None
    return {"records": rows, "avg_modal_kg": avg}


def latest(commodity: str = "Mango", state: str = "Maharashtra", client: httpx.Client | None = None) -> dict:
    key = os.getenv("DATA_GOV_IN_API_KEY")
    if not key:
        return {"source": "unavailable", "reason": "no_api_key", "records": [], "avg_modal_kg": None}
    ck = (commodity, state)
    hit = _cache.get(ck)
    if hit and time.time() - hit[0] < TTL_S:
        return hit[1]
    params = {"api-key": key, "format": "json", "limit": 100,
              "filters[commodity]": commodity, "filters[state]": state}
    try:
        c = client or httpx.Client(timeout=15)
        res = c.get(URL, params=params)
        res.raise_for_status()
        out = {"source": "agmarknet", "commodity": commodity, "state": state, **parse_records(res.json().get("records", []))}
        if not out["records"]:
            out = {**out, "source": "unavailable", "reason": "no_records_today"}
    except Exception as e:  # network, auth, schema
        return {"source": "unavailable", "reason": f"fetch_failed: {type(e).__name__}", "records": [], "avg_modal_kg": None}
    _cache[ck] = (time.time(), out)
    return out
