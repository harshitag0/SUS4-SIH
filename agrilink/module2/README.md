# AgriLink Module 2: Farm Management & Supply Assurance

Module 2 takes over an agreement once Module 1 has activated it (buyer order,
FPO-led paper signing, first 50% paid) and runs everything up to handover at
the Indian port and final payment:

1. **Quality monitoring**: weekly photo checks, AI computer vision, SMS/WhatsApp reminders, escalation after two misses.
2. **Farmer doctor verification**: FPO group lead visits, inspects and grades (human in the loop).
3. **Quality decision & intervention**: AI + doctor review against the contract grade; failures open interventions, verified and re-checked.
4. **Risk monitoring & supply recovery**: weather/pest alerts, scenario lab, advice to farmers, shortfall offered to FPOs outside the area.
5. **Delivery, payment & ratings**: harvest plan, graded lots with QR trace, handover at port, escrow tranche 2 with dispute window and surveyor, two-way reviews, monthly ratings.

Built from `SIH/workflowdiagrams/module2_workflow_farmer_doctor.png` and
`SIH/PROBLEM_STATEMENT.md`. See `docs/SPEC.md` for how each diagram step became a requirement.

```
module2/
├── backend/            Python · FastAPI · MongoDB (pymongo)
│   ├── app/
│   │   ├── main.py     entry point; all routes under /api/m2
│   │   ├── domain/     pure business rules (quality, ratings, escrow, scenario)
│   │   ├── services/   workflow logic that reads/writes MongoDB
│   │   ├── routers/    REST endpoints and access rules
│   │   ├── adapters/   CV, risk feed, SMS/WhatsApp, escrow bank, hash chain (simulated)
│   │   ├── seed.py     demo data produced by running the real services
│   │   └── config.py   M2_* environment variables
│   └── tests/          52 pytest tests (domain + API journeys on MongoDB)
├── frontend/           React 19 · Vite · react-router
│   └── src/
│       ├── module2/    the module: routes, pages, components, API client (embeddable)
│       └── standalone/ shell used only when Module 2 runs on its own
├── e2e/                18 browser journeys (puppeteer-core + Chrome)
└── docs/               SPEC, API, DATA_MODEL, INTEGRATION, TESTING
```

## Run it

Requirements: Python 3.11+, Node 20+, MongoDB 6+ running locally (`mongodb://localhost:27017`).

```bash
# 1. Backend
cd module2/backend
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
./.venv/bin/python -m app.seed                    # demo data into database agrilink_m2
./.venv/bin/uvicorn app.main:app --port 8000      # API docs: http://localhost:8000/api/m2/docs

# 2. Frontend (new terminal)
cd module2/frontend
npm install
npm run dev                                       # http://localhost:5173/m2
```

Use **Acting as** (top bar) to switch between AgriLink operations, an FPO
officer, a farmer doctor, a farmer and a buyer. Links can preselect a user:
`http://localhost:5173/m2?as=farmer:FRM-RTN-06`.

The demo runs on a **simulated clock** (14 Apr 2027, 09:00 IST, Konkan Alphonso season).
As operations, use **+6 h / +1 day / +1 week** to move time: deadlines,
reminders, escalations, routine visits and automatic escrow release run as time
passes. **Reset demo** restores the seed.

### Suggested demo path (about 5 minutes)
1. *Operations · Risks*: run the scenario lab on the Devgad rain alert → AGR-2027-001 drops to 83% → send recommendations → start supply recovery.
2. *Operations · Supply recovery*: offer the shortfall to Rajapur FPO (first come, first served in the pilot). *FPO officer (Rajapur)*: accept with in-person signatures.
3. *Farmer (Rekha Surve)*: upload photos. *Farmer doctor (Sunil Gawde)*: record the inspection; the review passes.
4. *FPO officer (Ratnagiri)* on AGR-2027-001: open harvest, record a lot (one farmer's fruit below grade is returned), mark ready.
5. *Buyer A*: fund tranche 2 for the shipped quantity. *FPO*: hand over at port. *Buyer*: record receipt, dispute. *Operations*: surveyor decides.
6. Open the lot's QR trace page; see the hash chain verified. *Operations · Monthly ratings*: update ratings.

## Tests
```bash
cd module2/backend && ./.venv/bin/python -m pytest -q          # 52 tests, uses database agrilink_m2_test
cd module2/e2e && npm install && npm test                       # 18 browser journeys (needs both servers)
```
Results and coverage: `docs/TESTING.md`.

## Configuration
Backend (`M2_*` environment variables; defaults in `backend/app/config.py`):

| Variable | Default | Meaning |
|---|---|---|
| `M2_MONGO_URI` | `mongodb://localhost:27017` | MongoDB connection |
| `M2_DB_NAME` | `agrilink_m2` | Database (tests use `agrilink_m2_test`) |
| `M2_CORS_ORIGINS` | `http://localhost:5173,…` | Allowed browser origins |
| `M2_PILOT_START` | `2026-11-01` | Ratings drive ranking 6 months after this |
| `M2_DISPUTE_WINDOW_HOURS` | `72` | Buyer dispute window (placeholder) |
| `M2_FUNDING_DUE_HOURS` | `24` | Buyer funding is "on time" within this |
| `M2_CHECK_INTERVAL_DAYS` | `7` | Photo check cadence |
| `M2_UPLOAD_GRACE_HOURS` | `48` | Time to upload before a reminder |
| `M2_CV_VALID_DAYS` / `M2_FINDING_VALID_DAYS` | `10` / `14` | How long an AI result / doctor finding counts |
| `M2_SUPPLY_RISK_THRESHOLD` | `0.95` | Supply risk if expected < 95% of order |
| `M2_RESERVE_NEW_SHARE` | `0.20` | Share of ranked slots kept for new farmers/FPOs |
| `M2_UPLOAD_DIR`, `M2_MAX_UPLOAD_MB` | `backend/uploads`, `8` | Photo storage |
| `M2_ALLOW_DEMO_CONTROLS` | `true` | Clock and reset endpoints; set `false` outside demos |
| `M2_PUBLIC_TRACE_BASE` | `http://localhost:5173/m2/trace` | URL encoded in lot QR codes |

Frontend: `VITE_M2_API_BASE` (default `http://localhost:8000/api/m2`), see `frontend/.env.example`.

## What is simulated (never presented as real)
Every simulated value is labelled in the UI (`SIMULATED`). Each sits behind an adapter so a real service can replace it without touching the workflow.

| Part | Now | Later |
|---|---|---|
| Computer vision | Deterministic measurements from the image bytes or a named demo profile | Trained Alphonso model (`adapters/cv.py`) |
| Weather / pest feed | Two fixed Konkan alerts | IMD GKMS / KVK (`adapters/risk_feed.py`) |
| SMS / WhatsApp | Outbox in MongoDB, status `SENT_SIMULATED` | Gateway (`adapters/notify.py`) |
| Escrow bank | `SIM-` references, no money moves | CIMB Singapore escrow, terms unconfirmed (`adapters/escrow_bank.py`) |
| Tamper-evident record | Local SHA-256 hash chain | Ethereum anchoring of the chain head (`adapters/ledger.py`) |
| People, FPOs, buyers | Synthetic, marked "(synthetic)" | Module 1 / platform data |

## Assumptions and limitations
- **Quality thresholds are illustrative.** No public Singapore buyer specification for Alphonso was found (`domain/quality.py`).
- **Scenario-lab loss factors, rating weights, smoothing (0.3) and the "new" threshold (2 months) are illustrative.**
- **Open business decisions:** dispute window length (72 h placeholder), surveyor identity, contract currency (SGD used), and how a new farmer's rating starts (neutral 50).
- **Settlement rule chosen:** the buyer pays pro rata for what is shipped at contract grade, capped at the contract value. If the 50% advance exceeds the shipped value, the excess is recorded as owed back by the FPO; recovering it is outside the escrow.
- **Weather and pest losses are rating-exempt** as soon as the scenario lab records them. Withdrawals are not exempt.
- **Identity:** role and actor come from `X-M2-Role` / `X-M2-Actor` headers until Module 1 provides sign-in. These headers are not secure on their own.
- **Not in Module 2 by design:** buyer requirements, feasibility, first allocation and contracting (Module 1); transit logistics, IoT and post-harvest loss tracking (later roadmap).
- **Not built:** the farmer chatbot (local-sales headroom) is not in the workflow diagram; Module 1 share caps are not applied in supply recovery.
- **Scheduler:** jobs run when the clock is advanced or via `POST /api/m2/system/run-due-jobs`; production needs a timer calling that endpoint (e.g. every 15 minutes).
