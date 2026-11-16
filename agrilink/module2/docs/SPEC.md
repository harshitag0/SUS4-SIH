# AgriLink Module 2: Farm Management & Supply Assurance

Specification derived from the newest workflow diagram
(`SIH/workflowdiagrams/module2_workflow_farmer_doctor.png`, 16 Nov 2026) and the
decisions in `SIH/PROBLEM_STATEMENT.md`. Where the diagram is silent, this
document states the rule chosen and why; open questions are listed in §8.

Problem statement: *"How might we use technology to help smallholder farmers
improve produce quality and consistency, and supply reliability, so that they can
meet larger buyers' requirements and raise their incomes?"*

---

## 1. Where Module 2 starts and stops

| Boundary | Owner | What crosses it |
|---|---|---|
| **Start**: "Module 1 Complete: Digital Agreement Activated" | Module 1 | An activated agreement: buyer, order quantity, required grade, harvest window, dispatch deadline, contract value, the FPOs and each signed farmer commitment (signed on paper, recorded by the FPO), and the fact that the first 50% was funded and released at signing. |
| **Quality responsibility ends** | Module 2 | Handover at the Indian port. Transit is the buyer's risk in the initial phase. |
| **Money responsibility ends** | Module 2 | The buyer received the goods and is satisfied, or the dispute window passed, or a surveyor decided. |
| **Back to Module 1** | Module 2 provides | Monthly ratings (farmer and buyer) that drive Module 1 ranking after month 6, and supply-recovery shortfalls that use Module 1's allocation rules. |

Not in Module 2: buyer requirement capture, feasibility, first allocation,
contract generation and first signing, the first escrow tranche, transit
logistics, IoT, post-harvest loss tracking.

## 2. Actors and swimlanes

| Actor | Who in reality | Responsibilities in Module 2 |
|---|---|---|
| **Farmer** | Konkan Alphonso smallholder, FPO member | Uploads photos when prompted (sees only prompts). Receives reminders and recommendations by SMS/WhatsApp. Rates the buyer (reply relayed by the FPO). |
| **Farmer doctor** | FPO group lead, the human in the loop | Weekly/monthly farm visits, on-site inspection, records grade and findings, clears or confirms AI flags, gives expert recommendations, verifies interventions. |
| **FPO officer** | FPO staff | Runs harvest and collection, records lots against contracts, records commitment withdrawals, briefs farmers and signs recovery commitments in person, relays farmer replies. |
| **Buyer** | Singapore supermarket group (legal buyer) | Funds the second 50% at dispatch, records receipt, confirms origin quality or disputes inside the window, rates supply. |
| **AgriLink operations** | AgriLink staff | Runs the AI computer-vision service, monitors risks, runs the scenario lab, opens supply recovery, records the surveyor's decision, runs monthly ratings. |
| **Systems** | Adapters | Computer vision, weather/pest feed, SMS/WhatsApp gateway, escrow bank, tamper-evident record. All **simulated** in this build (§7). |

## 3. Workflow reconstruction: what the business must actually do

Each diagram activity is turned into data, rules, outcomes and the next step.

### Section 1: Quality monitoring (farmer upload + AI computer vision)
| Activity | What the business needs | Rule chosen |
|---|---|---|
| Scheduled quality check due | A schedule per active commitment. | A check is created every `M2_CHECK_INTERVAL_DAYS` (7) while the agreement is being monitored. Only one open check per commitment. |
| Farmer uploads photos | Photo files, who uploaded, when, against which check. Farmer view shows prompts only. | Only the farmer the check belongs to can upload. Images only (JPEG/PNG/WebP, ≤ 8 MB). |
| Gateway: uploaded on time? | A deadline. | Deadline = due + `M2_UPLOAD_GRACE_HOURS` (48). "On time" means before the first deadline with no reminder needed. |
| No → SMS/WhatsApp reminder; re-upload | A reminder record and a new deadline. | First miss: reminder + new deadline. Second miss: check marked MISSED, farmer doctor flagged (a priority visit is scheduled). Misses lower the farmer's responsiveness rating. |
| Yes → AI computer vision analysis | Measurements: defect %, colour score, estimated weight, confidence, visible flags (fruit fly signs, anthracnose). | Run by AgriLink. Result stored on the check, marked with the model name and `simulated: true`. |

### Section 2: Farmer doctor verification
| Activity | What the business needs | Rule chosen |
|---|---|---|
| Farmer doctor visits farm (weekly/monthly) | A visit schedule per farmer, an assigned doctor. | Interval comes from the FPO setting (7 or 14 days here). Extra visits are created by escalation (missed uploads) or by an AI flag. One open visit per farmer. |
| On-site quality inspection | Grade (A/B/Reject), observed defects, pest signs, which AI flags are false, notes, expert recommendations. | Only the assigned doctor (or AgriLink ops) can record it. |
| Doctor updates findings in system | A dated finding that the review can use. | A finding is valid for `M2_FINDING_VALID_DAYS` (14). |

### Section 3: Quality decision & intervention
| Activity | What the business needs | Rule chosen |
|---|---|---|
| Quality review (AI + doctor) | Both inputs, the contracted grade. | "AI sees, rules decide, human confirms." AI alone never gives a final grade (status PENDING_DOCTOR, provisional grade). The doctor's grade is final and overrides AI; disagreements are recorded. Low AI confidence → RETAKE (farmer asked for a new photo). |
| Gateway: quality pass? | Contracted minimum grade. | PASS if final grade ≥ required grade. |
| Yes → update traceability records | A stage record that cannot be silently edited. | Appended to a hash-chained trace log; lots get a QR that opens the trace page. |
| No → personalised farm intervention | Recommendations tied to the cause. | Opened automatically (one open per commitment) with rule-based guidance from the cause plus the doctor's own advice. Guidance text is generic and must be validated by an agronomist. |
| Track implementation & verify improvement | Action log, verification outcome. | FPO/doctor log actions; doctor verifies (effective / not effective). Either way a re-check is scheduled. |
| Re-check at next scheduled check | Loop back. | New check due immediately after verification. |

### Section 4: Risk monitoring & supply recovery
| Activity | What the business needs | Rule chosen |
|---|---|---|
| Monitor risks (weather, pest) | Alerts with type, affected talukas, severity, period, source. | From a feed adapter (simulated; IMD/KVK integration pending) or entered by AgriLink ops. |
| Gateway: risk detected? → run scenario lab | Which commitments are exposed and how much supply is at risk. | Commitments of farmers in the affected talukas get a projected quantity = committed × (1 − loss factor for type and severity). Factors are illustrative. |
| Send recommendations to farmers | Messages by each farmer's channel, copies to FPO and doctor. | Advice per risk type (e.g. rain: harvest mature fruit early, keep harvested fruit covered). |
| Gateway: supply risk? | A threshold. | Supply risk if expected supply < `M2_SUPPLY_RISK_THRESHOLD` (95%) of the order. |
| Supply recovery | Shortfall, candidate FPOs outside the affected area, offers, in-person signing. | Candidates = FPOs not in affected talukas with posted spare capacity, ordered with Module 1's rule: first come, first served for 6 months, then by rating with 20% kept for new FPOs. An FPO accepts only after briefing farmers and collecting paper signatures; it records farmer allocations. |
| Update agreement with revised supply | Revision history. | New commitments are added, the revision is logged, and weather/pest shortfalls of the original farmers become rating-exempt. |
| Withdrawal (exception not drawn but implied) | Farmers may still sell locally. A signed farmer who backs out creates a shortfall. | FPO records the withdrawal with a reason; it counts against the farmer's commitment score and can open supply recovery (not exempt). |

### Section 5: Delivery, payment & ratings
| Activity | What the business needs | Rule chosen |
|---|---|---|
| Coordinate harvest & collection | Who is eligible, suggested timing, notifications. | Only farmers whose latest review is PASS are eligible. Harvest notice goes to FPOs and eligible farmers. |
| Record delivered quantity & quality vs contract | Lots with per-farmer contributions and collection grade. | A contribution below the contracted grade is **diverted** to the local channel and not added to the lot. Delivered kg updates the commitment. |
| Hand over at export (quality responsibility ends) | Handover record at the Indian port. | Requires the second tranche funded. Lots marked HANDED_OVER. |
| Buyer funds second 50% into escrow at dispatch | Escrow instruction. | FPO marks "ready for dispatch" → buyer funds → handover allowed. Funding later than `M2_FUNDING_DUE_HOURS` (24) counts as late in the buyer rating. |
| Buyer receives goods in Singapore | Receipt time; dispute window opens. | Window = `M2_DISPUTE_WINDOW_HOURS` (72, placeholder). |
| Gateway: satisfied on origin quality? | Buyer decision. | Satisfied → release. Dispute must be inside the window and names a reason. No response → automatic release when the window closes (counts as buyer unresponsive). |
| Third-party surveyor decides | Cause. | Transit → buyer's risk → release to FPO (dispute counted as unfounded). Origin quality → refund to buyer. |
| Release remaining 50% & two-way reviews | Ledger entries; reviews. | Released to the FPO, which pays its farmers. Buyer rates the supply (applies to contributing farmers); farmer replies about the buyer are recorded by the FPO. |
| Update ratings (monthly) | Monthly snapshots. | Farmer: fulfilment, quality, on-time delivery, responsiveness, commitment, buyer review. Buyer: on-time payment, order commitment, fair grading, responsiveness, farmer review. Weather/pest exempt. Smoothed month to month. Recorded from day one; drive ranking after 6 months. |

## 4. Features, users and contribution to the problem

| Feature | Users | Workflow step | Output | Problem-statement contribution | Priority |
|---|---|---|---|---|---|
| Agreement intake & supply board | Ops, FPO, buyer | Entry | Per-agreement committed / expected / delivered, quality status, stage | Supply reliability: one view of fulfilment progress | MVP |
| Quality check schedule, reminders, escalation | Farmer, ops | §1 | Prompts, reminders, missed-check flags | Consistency: same check cadence for every farmer | MVP |
| Farmer photo upload + AI analysis | Farmer | §1 | AI measurements per check | Quality: early detection | MVP |
| Farmer doctor visits & findings | Doctor | §2 | Graded findings | Quality: human confirmation; farmer empowerment through advice | MVP |
| Quality review engine | System, ops | §3 | PASS/FAIL/PENDING/RETAKE with reasons | Consistency: one rule for all lots | MVP |
| Interventions & verification | Doctor, FPO | §3 | Action log, verified outcome | Quality: corrective action; empowerment | MVP |
| Risk alerts & scenario lab | Ops | §4 | Exposed commitments, expected shortfall | Supply reliability: early warning | MVP |
| Recommendations broadcast | Ops | §4 | SMS/WhatsApp messages | Empowerment, quality | MVP |
| Supply recovery & agreement revision | Ops, FPO | §4 | Offers, new commitments, revision log | Supply reliability | MVP |
| Withdrawal recording | FPO | §4 (exception) | Shortfall, rating effect | Reliability, integrity | MVP |
| Harvest plan & collection lots | FPO | §5 | Lots, diverted fruit, delivered kg | Quality gate; reliability | MVP |
| Escrow tranche 2, receipt, dispute, surveyor, auto-release | Buyer, ops | §5 | Ledger, payout status | Income: payment certainty for the FPO | MVP |
| Two-way reviews & monthly ratings | Buyer, FPO, ops | §5 | Rating snapshots, ranking preview | Consistency & reliability incentives; feeds Module 1 | MVP |
| Traceability log + lot QR page | Buyer, ops | §3, §5 | Hash-chained events, verification | Consistency, buyer trust | Supporting |
| Notification outbox | Ops | All | Every message sent (simulated) | Accountability | Supporting |
| Demo clock & scheduler control | Ops (demo) | All | Moves simulated time, runs due jobs | Lets a short demo show time-based rules | Supporting (demo) |
| Real CV model, real gateway, real bank, IMD feed | | | | | Enhancement (adapters ready) |

## 5. Data entities (MongoDB, database `agrilink_m2`)
`fpos`, `farmers`, `farmer_doctors`, `buyers` (reference data owned upstream),
`agreements`, `commitments`, `quality_checks`, `doctor_visits`,
`quality_reviews`, `interventions`, `risk_alerts`, `recovery_requests`, `lots`,
`escrow_accounts`, `feedback`, `rating_snapshots`, `trace_events`,
`notifications`, `system`. Field-level detail: `DATA_MODEL.md`.

## 6. State machines
- **Agreement**: `ACTIVE → HARVESTING → READY_FOR_DISPATCH → FUNDED → DISPATCHED → RECEIVED → (DISPUTED →) COMPLETE | REFUNDED`
- **Commitment**: `ACTIVE → DELIVERED`; `ACTIVE → WITHDRAWN`; partial delivery stays `ACTIVE` until the agreement is dispatched, then `SHORT`.
- **Quality check**: `DUE → (REMINDED →) ANALYSED`; `DUE/REMINDED → MISSED` (doctor flagged); `ANALYSED → RETAKE_REQUESTED → ANALYSED`.
- **Doctor visit**: `SCHEDULED → COMPLETED`.
- **Intervention**: `OPEN → IN_PROGRESS → VERIFIED | NOT_EFFECTIVE`.
- **Risk alert**: `OPEN → ASSESSED → CLOSED`.
- **Recovery request**: `OPEN → PARTIAL → FILLED`, or `CLOSED`.
- **Escrow**: `SIGNED (tranche 1 released) → FUNDED → RECEIVED → (DISPUTED →) RELEASED | REFUNDED`.

## 7. Simulated adapters (never presented as real)
| Adapter | Simulation | Real integration later |
|---|---|---|
| Computer vision | Deterministic measurements from the image bytes, or a named demo profile | Trained Alphonso model behind the same `analyze()` interface |
| Weather / pest feed | Fixed demo alerts for Konkan talukas | IMD GKMS / KVK advisories |
| SMS / WhatsApp | Messages written to the `notifications` outbox as `SENT_SIMULATED` | SMS / WhatsApp Business gateway |
| Escrow bank | Instructions recorded with `SIM-` references | CIMB Singapore escrow (terms not confirmed) |
| Tamper-evident record | Local SHA-256 hash chain | Ethereum smart-contract anchoring |
| Clock | Simulated time stored in `system.clock`, moved by a demo control | Real time |

## 8. Open questions (not invented)
1. Alphonso grade thresholds: no public Singapore buyer spec found; values are placeholders.
2. Dispute window length (72 h placeholder), surveyor identity, contract currency.
3. CIMB escrow terms (tranches, evidence-triggered release, payout to an Indian FPO).
4. How a new farmer's rating starts (neutral 50 used).
5. Loss factors in the scenario lab (illustrative).
6. Authentication: role headers stand in until the platform (Module 1) provides identity.
