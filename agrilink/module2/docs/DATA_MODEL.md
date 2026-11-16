# Module 2 data model (MongoDB)

Database: `agrilink_m2` (tests: `agrilink_m2_test`). IDs are strings with a prefix
(`AGR-`, `CMT-`, `QC-`, …) so they read well in logs and can be shared with Module 1.
Times are UTC (`tz_aware` client). Indexes are created on start-up (`app/db.py`).

## Reference data (owned upstream; Module 2 keeps a copy)
| Collection | Key fields | Notes |
|---|---|---|
| `fpos` | `_id`, `name`, `taluka`, `district`, `registered_on`, `newly_formed`, `visit_interval_days`, `spare_capacity_kg`, `capacity_posted_at` | Spare capacity and its posting time drive supply-recovery ranking (FCFS) |
| `farmers` | `_id`, `name`, `fpo_id`→fpos, `village`, `taluka`, `district`, `orchard_ha`, `trees`, `channel` (sms/whatsapp), `language`, `phone`, `consent_recorded` | `phone` is never returned by the API |
| `farmer_doctors` | `_id`, `name`, `fpo_id`→fpos, `active` | One active doctor per FPO assumed |
| `buyers` | `_id`, `name`, `country` | Singapore supermarket groups (legal buyer) |

## Workflow data
| Collection | Key fields | References / rules |
|---|---|---|
| `agreements` | `_id` (Module 1 id), `buyer_id`, `quantity_kg`, `required_grade` (A/B), `harvest_window{start,end}`, `dispatch_deadline`, `contract_value`, `currency`, `status`, `fpo_ids[]`, `revisions[]`, `settlement{shipped_kg, payable_value, tranche2_due, advance_excess,…}`, `dispute{reason, lot_ids, decision}`, `buyer_response`, stage timestamps (`activated_at`, `ready_at`, `funded_at`, `dispatched_at`, `received_at`, `closed_at`) | Status: `ACTIVE → HARVESTING → READY_FOR_DISPATCH → FUNDED → DISPATCHED → RECEIVED → (DISPUTED) → COMPLETE/REFUNDED` |
| `commitments` | `_id`, `agreement_id`, `farmer_id`, `fpo_id`, `taluka`, `committed_kg`, `projected_kg`, `delivered_kg`, `diverted_kg`, `exempt_shortfall_kg`, `status`, `quality_status`, `final_grade`, `provisional_grade`, `source` (module1/seed/recovery), `risk_exposure[]`, `withdrawal{reason, at}`, `deliveries`, `deliveries_on_time` | Status: `ACTIVE`, `DELIVERED`, `SHORT` (after handover), `WITHDRAWN`. Index: (agreement_id, status), farmer_id |
| `quality_checks` | `_id`, `commitment_id`, `agreement_id`, `farmer_id`, `fpo_id`, `trigger`, `due_at`, `first_deadline`, `deadline`, `status`, `misses`, `reminders[]`, `photos[]`, `cv{defect_pct, colour_score, est_weight_g, confidence, flags, model, simulated}`, `on_time` | One open check per commitment. Status: `DUE`, `REMINDED`, `RETAKE_REQUESTED`, `ANALYSED`, `MISSED`, `CANCELLED` |
| `doctor_visits` | `_id`, `farmer_id`, `fpo_id`, `doctor_id`, `due_at`, `status`, `trigger`, `priority`, `reasons[]`, `finding{grade, observed_defect_pct, pest_signs, cleared_flags, observations, recommendations, fruit_inspected}`, `completed_at` | One open visit per farmer; escalations raise priority instead of duplicating |
| `quality_reviews` | `_id`, `commitment_id`, `agreement_id`, `farmer_id`, `status`, `final_grade`, `provisional_grade`, `source`, `disagree`, `open_flags`, `reasons[]`, `required_grade`, `check_id`, `visit_id`, `trigger`, `created_at` | Append-only history; the latest per commitment is copied onto the commitment |
| `interventions` | `_id`, `commitment_id`, `agreement_id`, `farmer_id`, `review_ids[]`, `cause[]`, `recommendations[{key, text, source}]`, `status`, `actions[]`, `verification`, `verify_by` | One open per commitment. Status: `OPEN → IN_PROGRESS → VERIFIED/NOT_EFFECTIVE` |
| `risk_alerts` | `_id`, `type`, `severity`, `areas[]` (talukas), `starts_at`, `ends_at`, `source`, `status`, `scenario{loss_factor, exposed[], agreements[], advice, supply_risk}`, `recommendations_sent_at` | Scenario applied once. Status: `OPEN → ASSESSED → CLOSED` |
| `recovery_requests` | `_id`, `agreement_id`, `alert_id`, `reason`, `affected_areas`, `shortfall_kg`, `filled_kg`, `ranking_mode`, `candidates[{fpo_id, rank, reason, rating, is_new, spare_capacity_kg}]`, `offers[{fpo_id, kg, status, allocations}]`, `status` | One open per agreement. Status: `OPEN`, `PARTIAL`, `FILLED`, `UNFILLED`, `CLOSED` |
| `lots` | `_id`, `agreement_id`, `fpo_id`, `contributions[{farmer_id, commitment_id, kg, grade}]`, `diverted[]`, `total_kg`, `grade_mix`, `status`, `collected_at`, `handed_over_at`, `handover_port`, `qr_svg` | Status: `COLLECTED → HANDED_OVER → RECEIVED` |
| `escrow_accounts` | `_id` = agreement id, `status`, `contract_value`, `tranche1`, `tranche2`, `paid_to_fpo`, `held`, `refunded_to_buyer`, `received_at`, `window_ends_at`, `ledger[{at, step, amount, ref}]`, `settlement`, `provider` | Status: `SIGNED → FUNDED → RECEIVED → (DISPUTED) → RELEASED/REFUNDED` |
| `feedback` | `_id`, `agreement_id`, `direction` (buyer_to_supply / farmer_to_buyer), `stars`, `comment`, `farmer_ids[]` or `from_id`, `buyer_id`, `channel` | One buyer review per order; one per farmer |
| `rating_snapshots` | `subject_type` (farmer/buyer), `subject_id`, `period` (YYYY-MM), `metrics`, `components`, `month_score`, `rating`, `cycles`, `is_new`, `used_for_ranking`, `fpo_id` | Unique (subject_type, subject_id, period); recomputing a month replaces it |
| `trace_events` | `_id` (`TRC-000001`), `seq`, `at`, `stage`, `summary`, `agreement_id`, `farmer_id`, `lot_ids[]`, `data`, `actor`, `prev_hash`, `hash` | Append-only SHA-256 chain; unique `seq` |
| `notifications` | `_id`, `to_type`, `to_id`, `channel` (sms/whatsapp/app), `subject`, `body`, `related`, `status`, `gateway`, `created_at` | Outbox; the simulated gateway marks `SENT_SIMULATED` |
| `system` | `_id: "clock"`, `sim_now` | Simulated clock for demos |

## Relationships
```
buyers 1─* agreements 1─* commitments *─1 farmers *─1 fpos 1─* farmer_doctors
agreements 1─1 escrow_accounts      agreements 1─* lots ─* contributions → commitments
commitments 1─* quality_checks       farmers 1─* doctor_visits
commitments 1─* quality_reviews ─→ (check_id, visit_id)
commitments 1─* interventions ─→ review_ids
risk_alerts 1─* recovery_requests *─1 agreements
trace_events ─→ agreement_id / farmer_id / lot_ids (hash-chained in seq order)
```
