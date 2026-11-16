# Module 2 REST API

Base path: **`/api/m2`**. Interactive docs (OpenAPI): `http://localhost:8000/api/m2/docs`.

## Conventions
- **Caller identity**: headers `X-M2-Role` (`admin` | `fpo` | `doctor` | `farmer` | `buyer` | `system`) and `X-M2-Actor` (id, e.g. `FPO-RTN`, `DOC-RTN`, `FRM-RTN-06`, `BUY-A`). `admin` = AgriLink operations and passes every role check. Replaced by Module 1's sign-in on integration (see `INTEGRATION.md`).
- **Times** are ISO 8601 UTC. Business rules use the module clock (`GET /system/clock`).
- **Errors** always return `{"error": {"code", "message", "details?"}}`:

| HTTP | code | When |
|---|---|---|
| 400 | `invalid` | Business rule violated (e.g. lot from a farmer with no passing review) |
| 403 | `forbidden` | Role or actor not allowed (e.g. another FPO's members) |
| 404 | `not_found` | Unknown id |
| 409 | `invalid_state` | Action not allowed in the current workflow state (e.g. fund before ready) |
| 422 | `validation` | Body/query failed schema validation |
| 503 | `database_unavailable` | MongoDB unreachable |

## Agreements (entry from Module 1) and supply view
| Method | Path | Roles | Purpose |
|---|---|---|---|
| POST | `/agreements` | system | **Receive an activated agreement from Module 1.** Creates commitments, first photo checks, the escrow account (tranche 1 released), trace event. |
| GET | `/agreements?status=` | admin, fpo (own), buyer (own) | Agreements with supply summary (order, committed, expected, delivered, quality counts) |
| GET | `/agreements/{id}` | same | Detail: commitments with latest review, lots, escrow, recovery requests, reviews, settlement |
| GET | `/agreements/{id}/timeline` | same | Trace events for the agreement and its farmers |
| POST | `/commitments/{id}/withdraw` | fpo (own) | Signed farmer backs out. Body `{reason}`. Not weather-exempt. |

`POST /agreements` body:
```json
{"id": "AGR-2027-010", "buyer_id": "BUY-A", "quantity_kg": 6000, "required_grade": "B",
 "harvest_window_start": "2027-04-15", "harvest_window_end": "2027-05-02", "dispatch_deadline": "2027-05-05",
 "contract_value": 66000, "currency": "SGD", "tranche1_released": true,
 "commitments": [{"farmer_id": "FRM-RTN-01", "committed_kg": 800, "signed_on": "2027-03-26", "signed_in_person": true}]}
```
Rejected: duplicate id (409), unknown buyer/farmer (404), unsigned commitment, duplicate farmer, window/deadline order (400).

## Quality monitoring, farmer doctor, reviews, interventions
| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | `/quality-checks?status=&fpo_id=&agreement_id=&farmer_id=` | admin, fpo/doctor (own FPO), farmer (own) | Photo checks with AI results |
| POST | `/quality-checks/{id}/photos` | farmer (own check) | Multipart: `photos` (1–5 JPEG/PNG/WebP ≤ 8 MB), optional `simulation_profile` (`good`, `borderline`, `poor`, `pest`, `blurry`). Runs AI, then the quality review. Returns `{check, review}`. |
| GET | `/photos/{name}` | any | Stored photo |
| GET | `/farmer-view` | farmer | Prompts, recent checks and messages only |
| GET | `/doctor-visits?status=&doctor_id=&farmer_id=` | admin, doctor (own), fpo (own) | Visits (priority first) |
| POST | `/doctor-visits` | fpo, doctor (own FPO) | Schedule a visit `{farmer_id, due_at?, note}` |
| POST | `/doctor-visits/{id}/complete` | doctor (assigned) | Record inspection `{grade, observed_defect_pct?, fruit_inspected?, pest_signs[], cleared_flags[], observations, recommendations[]}`. Re-runs reviews. Returns `{visit, reviews}`. |
| GET | `/quality-reviews?status=&farmer_id=&agreement_id=&disagree=` | admin, fpo/doctor, farmer | Review log |
| GET | `/interventions?status=` | admin, fpo/doctor, farmer | Interventions |
| POST | `/interventions/{id}/actions` | fpo, doctor | `{note}` |
| POST | `/interventions/{id}/verify` | doctor | `{effective, note}`; needs ≥ 1 action; schedules a re-check |

Review outcome: `PASS` / `FAIL` need a doctor finding; AI alone gives `PENDING_DOCTOR` (with a provisional grade) or `RETAKE_PHOTO` (low confidence).

## Risks, scenario lab, supply recovery
| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | `/risks?status=` | admin, fpo, doctor | Alerts |
| POST | `/risks` | admin | `{type, severity, areas[], starts_at, ends_at, summary}` |
| POST | `/risks/ingest-feed` | admin | Pull from the (simulated) feed; de-duplicates |
| POST | `/risks/{id}/scenario` | admin | Once per alert: projected kg per exposed commitment, supply risk per agreement; losses become rating-exempt |
| POST | `/risks/{id}/recommendations` | admin | Once, after the scenario: SMS/WhatsApp to exposed farmers, FPOs, doctors |
| POST | `/risks/{id}/close` | admin | Close |
| GET | `/recovery-requests?agreement_id=` | admin, fpo (as candidate), buyer (own) | Requests with ranked candidates and offers |
| POST | `/recovery-requests` | admin | `{agreement_id, alert_id?, reason}`; shortfall = order − expected; candidates = FPOs outside affected talukas with spare capacity, ranked FCFS (pilot) or by rating with 20% for new |
| POST | `/recovery-requests/{id}/offers` | admin | `{fpo_id, kg}` (≤ remaining shortfall and spare capacity) |
| POST | `/recovery-requests/{id}/offers/{fpo_id}/response` | fpo (that FPO) | `{accepted, signed_in_person, allocations:[{farmer_id, kg}], note}`; acceptance needs signatures and allocations summing to the offer; adds commitments and an agreement revision |
| POST | `/recovery-requests/{id}/close` | admin | Close |

## Harvest, lots, handover, escrow, reviews
| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | `/agreements/{id}/harvest-plan` | admin, fpo, buyer | Per commitment: eligibility (latest review PASS), suggested pick date, remaining kg |
| POST | `/agreements/{id}/harvest-notice` | fpo | Opens harvest (`HARVESTING`), notifies eligible farmers |
| POST | `/agreements/{id}/lots` | fpo (own) | `{fpo_id, contributions:[{farmer_id, kg, grade}]}`; below-grade fruit is returned, not counted; QR generated |
| POST | `/agreements/{id}/ready-for-dispatch` | fpo | Computes the **settlement** (pro-rata payable, tranche 2 due, advance excess); asks the buyer to fund |
| POST | `/agreements/{id}/escrow/fund` | buyer (own) | Funds tranche 2 due; on time if within `M2_FUNDING_DUE_HOURS` |
| POST | `/agreements/{id}/handover` | fpo | `{port}`; requires funding; lots `HANDED_OVER`; quality responsibility ends |
| POST | `/agreements/{id}/receipt` | buyer | Opens the dispute window |
| POST | `/agreements/{id}/confirm` | buyer | Releases tranche 2 |
| POST | `/agreements/{id}/dispute` | buyer | `{reason, lot_ids[]}`; only inside the window |
| POST | `/agreements/{id}/surveyor-decision` | admin | `{cause: transit\|origin_quality, surveyor, note}`; transit → release, origin → refund buyer |
| GET | `/agreements/{id}/escrow` | admin, fpo, buyer | Escrow state and ledger |
| POST | `/agreements/{id}/feedback` | buyer, fpo | After close: `{direction: buyer_to_supply\|farmer_to_buyer, stars, comment, farmer_id?, channel}` |

Automatic release when the window closes runs in the scheduler.

## Ratings (read by Module 1)
| Method | Path | Roles | Purpose |
|---|---|---|---|
| POST | `/ratings/run` | admin | `{period: "2027-04"}`; computes snapshots from records; idempotent per period |
| GET | `/ratings/status` | any | Pilot start, switch date, whether ranking is live, weights |
| GET | `/ratings/{farmer\|buyer}` | scoped | Latest snapshot per subject: rating, month score, components, cycles, `is_new` |
| GET | `/ratings/{type}/{id}/history` | scoped | All monthly snapshots |

## Reference data, records, system
| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | `/health` | none | Liveness + DB ping |
| GET | `/meta` | none | Clock, quality spec, flags, risk types, talukas, adapters, demo actor list |
| GET | `/fpos`, `/farmers?fpo_id=`, `/farmers/{id}` | scoped | Reference data and farmer profile |
| GET | `/notifications?to_type=&to_id=&channel=` | admin all, others own | Message outbox |
| GET | `/trace/lots/{lot_id}` | none (QR page) | Lot, journey events, chain verification |
| GET | `/trace/verify` | none | Recompute the whole hash chain |
| GET | `/system/clock` | none | Current (simulated) time |
| POST | `/system/clock/advance` | admin, demo only | `{hours}`; then runs due jobs |
| POST | `/system/run-due-jobs` | system | Scheduler entry for production timers |
| POST | `/system/reset-demo` | admin, demo only | Re-seed |
