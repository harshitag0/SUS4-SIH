# Module 2 testing results (16 Nov 2026)

All three layers were run against a real MongoDB 8.2 instance.

| Layer | Command | Result |
|---|---|---|
| Backend domain + API journeys | `cd backend && ./.venv/bin/python -m pytest -q` | **52 passed** (database `agrilink_m2_test`, re-seeded per test) |
| Frontend production build | `cd frontend && npx vite build` | **Built** (42 modules) |
| Browser journeys (real Chrome, both servers running) | `cd e2e && npm test` | **18 of 18 passed. 0 console errors or warnings, 0 HTTP 5xx, 0 unexpected error toasts** |

## What the backend tests cover (`backend/tests`)
**Domain rules (23):**
- AI grading boundaries and blocking flags.
- AI alone is never final; low confidence asks for a retake.
- Doctor overrides AI, and the disagreement is recorded.
- Contract grade A versus B.
- Guidance matches the cause.
- Weather exemption, renormalised scores, smoothing.
- The 6-month switch and the 20% reserve for new candidates.
- Escrow transitions, the dispute window edge, refund on origin fault, no skipped funding.
- Pro-rata settlement and the advance excess.
- Scenario exposure and supply risk.

**API journeys on MongoDB (29):**
- **Access:** role and actor headers required; buyers see only their own agreements; farmers are blocked from agreements; notifications are scoped.
- **Intake from Module 1:** commitments, checks and escrow are created; only `system` can intake; duplicate, unknown farmer, unsigned and invalid bodies are rejected.
- **Quality loop:**
  - The farmer view shows only prompts.
  - Upload runs the AI and the review.
  - Another farmer's upload, non-image files and closed checks are rejected.
  - A blurry photo asks for a retake.
  - A second missed deadline escalates to a priority doctor visit.
  - The wrong doctor is rejected.
  - A doctor PASS and a doctor FAIL open an intervention.
  - Verifying needs an action and schedules a re-check.
  - Unknown flags are rejected.
- **Risk and recovery:**
  - The scenario lab finds supply risk and records weather-exempt losses; it runs once only.
  - Recommendations go out once, only after the scenario.
  - Recovery candidates exclude the affected taluka and are ordered first come, first served.
  - Duplicate requests, oversized offers, acceptance without signatures, wrong totals and the wrong FPO are rejected.
  - Acceptance adds commitments and a revision and reduces spare capacity.
  - Ranking switches to rating on 1 May 2027.
  - A withdrawal creates a shortfall.
- **Delivery and escrow:**
  - Lots are blocked before the harvest notice and for failing farmers; below-grade fruit is returned.
  - Funding is impossible before the order is ready, and handover is impossible before funding.
  - The wrong buyer is rejected.
  - Transit dispute → release. Automatic release after the window, and a late dispute is rejected. Origin fault → refund.
  - Reviews only after close, once each.
- **Ratings and trace:**
  - Monthly ratings are built from records, with history across months.
  - Future months are rejected; a farmer sees only their own rating.
  - The public lot trace works, and editing any stored event breaks the hash-chain check.

## Browser journeys (`e2e/run.mjs`)
The script follows the workflow diagram end to end through the UI, switching users:
1. **Operations:**
   - The board renders all three agreements.
   - The scenario lab on the Devgad rain alert shows supply risk.
   - Recommendations go out and supply recovery starts.
   - The shortfall is offered to the first-ranked FPO.
2. **Rajapur FPO:** accepts with in-person signatures and farmer allocations.
3. **Farmer:** uploads a photo file and sees the confirmation.
4. **Farmer doctor:**
   - Records an inspection, and the review passes.
   - A second doctor verifies an open intervention, and a re-check is scheduled.
5. **Ratnagiri FPO:**
   - Opens the harvest.
   - Records a lot in which one farmer's fruit is graded Reject and returned.
   - Marks the order ready.
6. **Buyer:** funds tranche 2.
7. **FPO:** hands over at the port.
8. **Buyer:** records receipt and disputes.
9. **Operations:** records the surveyor decision, and escrow is released.
10. **Reviews:** the buyer rates the supply; the FPO records a farmer's SMS reply.
11. **Trace:** the lot QR trace page shows the hash chain verified.
12. **Operations:** updates ratings and advances the clock.
13. **Role scoping:** the farmer's menu has no operations pages.
14. **UI validation:** the dispute button stays disabled without a reason.

## Defects found by testing and fixed
| Found by | Defect | Fix |
|---|---|---|
| Seed inspection | Hash would not verify after a round trip: MongoDB keeps milliseconds only | Time truncated to ms and data normalised before hashing |
| Screenshot review | Expected supply of a shipped order still showed planned kg (1,040 of 1,000) | Expected = delivered once fruit has left |
| Screenshot review | SMS/WhatsApp texts to farmers showed UTC times | Messages use IST |
| Browser journey | Farmer upload confirmation vanished when the prompt closed | Confirmation moved to the page |
| Browser journey (escrow screen) | The full contract value was released although only 13% of the order shipped | Pro-rata settlement: payable for shipped kg, tranche 2 = payable − advance, advance excess recorded |
| Screenshot review | Banner text broken into columns; filters stretched; loud withdraw buttons; "schedule" as a reason; overdue visits not flagged | Layout and wording fixes |

## Not covered
- **Real external services:** no real CV model, SMS gateway, bank or weather feed. The adapters are simulated, and only their interfaces are exercised.
- **Load, security and accessibility audits.** Auth is a header stand-in until Module 1 provides sign-in.
- **Narrow screens:** mobile layouts were not tested in a real device browser; the CSS has breakpoints at 720 px and 1000 px.
