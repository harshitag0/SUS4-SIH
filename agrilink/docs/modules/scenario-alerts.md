# Scenario & alert module (replaces the "what-if lab" for farmers)
Problem: in a storm or flood, farmers act from experience and will not stop to query a tool.
So the module is **proactive**, not interactive:
1. Pull forecasts (IMD / Open-Meteo) per plot location every few hours.
2. Rule engine: heavy rain, wind, heat, hail in the next 48 h -> severity.
3. Compute impact on signed bonds (tons of Grade A at risk, harvest-ready fraction).
4. Push SMS/WhatsApp in the local language with 2-3 concrete actions and a one-tap force-majeure notice to the buyer.
5. Collect geo-tagged damage photos as insurance / dispute evidence.

What-if sliders remain for FPO season planning only.
Status: spec only.
