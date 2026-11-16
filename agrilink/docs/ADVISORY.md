# Personalised Farmer Advisory

One advisory per farmer, regenerated every 6 hours, after stage submissions / consultant decisions, and on demand.

## Inputs (gathered concurrently) — `server/src/modules/advisory/engine.js`
Farmer profile and language · crop records and stage assessments (farmer entries, AI report, consultant decision) ·
Module 2 photo checks (AI blemish / colour / flags), quality reviews, farmer-doctor visits (findings, pest signs, recommendations,
scheduled visits), interventions · buyer's contracted grade and Module 2 quality spec · harvest window · live weather alerts.

## Gaps (only from evidence)
blemish_high, colour_low (harvest stages only), fruit_fly, anthracnose, sap_burn, hopper_mildew, pest_pressure, disease_signs,
no_spray_log, harvest_practice, post_harvest_delay, photo_quality, missed_checks, quality_failed, stage_correction,
harvest_readiness, weather_rain / weather_storm / weather_heat. Each carries its evidence (source, value, date).
Also a "your fruit vs buyer grade" table per contract; weight is shown as not measurable from photos.

## Recommendation
Problem · reason (from the evidence) · corrective action · steps · complete-by date (season time + playbook days) ·
expected improvement (an aim, never a guarantee) · follow-up inspection date (a scheduled farmer-doctor visit when one falls in the window) ·
agronomist feedback quoted verbatim · sources. Playbook in English, Hindi, Marathi (`knowledge.js`, `localize.js`); no pesticide names or
doses — those come from the KVK / farmer doctor.

## Lifecycle
open → done (farmer's report) → resolved (gap no longer detected). Progress survives regeneration; weather items expire.
New urgent/important gaps notify the farmer in their language (`advisory_new`).

## API
`GET /api/advisory/me?lang&refresh=1`, `PATCH /api/advisory/me/items/:key` (open/done); operations desks:
`GET /api/advisory/farmers`, `GET /api/advisory/farmers/:id?lang&refresh=1` (FPO / farmer doctor see their FPO), `POST /api/advisory/run` (admin).
Client: `/farmer/advice`, `/ops/advisory`, `/ops/advisory/:id`.
