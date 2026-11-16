# Module 2 inside AgriLink

Module 2 (Farm management & supply assurance) is the teammate's module, cloned unchanged into `module2/`
(from https://github.com/aalricc/agrilink-module2). AgriLink (Module 1) hosts it; its own docs are in `module2/docs/`.

## How the two modules connect
```
Module 1 (AgriLink)                                           Module 2 (module2/)
requirement → commitment → digital agreement → both sign → SHA-256 on Polygon
                                                    │
                                                    └─ handoff ─▶ POST /api/m2/agreements (role system)
                                                                  quality checks · farmer-doctor visits · reviews
                                                                  risks & scenario lab · supply recovery
                                                                  harvest lots + QR trace · escrow tranche 2 · ratings
```
- **Handoff** (`server/src/modules/module2/handoff.js`): runs when an agreement is registered on-chain (version 1), and at API start-up for any registered agreement not yet received. It syncs the shared entities into Module 2's database with stable ids — farmer `AGL-F-<userId>`, buyer `AGL-B-<userId>`, FPO `AGL-FPO-<name>`, farmer doctor `DOC-<fpoId>` — then posts the activated agreement (quantity, grade, harvest window = delivery − 21…−3 days, dispatch deadline = delivery date, contract value in USD, the farmer's signed commitment). Status and errors are stored on the agreement (`module2`) and in its audit trail; retry with `POST /api/contracts/:id/handoff`.
- **UI**: Module 2's React module (`module2/frontend/src/module2`, Vite alias `@module2`) renders inside each AgriLink portal — `/farmer/ops/*`, `/buyer/ops/*`, `/ops/farm/*` — with its pages in the same sidebar (`m2NavFor`). `m2-theme.css` re-skins its `m2-` classes. The only change to the teammate's files is an optional `getHeaders` prop on `M2Provider`.
- **Identity (one sign-in)**: the browser sends only the AgriLink token. `server/src/modules/module2/gateway.js` verifies it, drops any browser `X-M2-*` headers and sets them server-side: farmer → `AGL-F-<id>`, buyer → `AGL-B-<id>`, operations → the desk chosen in the top bar (AgriLink operations / FPO officer / farmer doctor, saved via `PUT /api/ops/me`). Successful changes push a live `farmops` refresh.
- **Photo grading**: with `M2_CV_URL` set, `adapters/cv.py` (`AgriLinkVisionCV`) sends each photo check to the ML service (`/vision/analyze`); a farmer doctor's grade sends those photos to `/vision/gallery`. Without it, Module 2 falls back to its original simulated adapter (used by its tests and named scenario profiles).
- **API**: Module 2's FastAPI runs on port **8100**; the browser never calls it directly — `/api/m2/*` goes to the AgriLink API (4000), which forwards it. Set `M2_API_URL` on the API if Module 2 runs elsewhere.

## Run
```bash
cd module2/backend && pip install -r requirements.txt
cd module2/backend && python -m app.seed                          # demo data (database agrilink_m2)
cd module2/backend && M2_CV_URL=http://127.0.0.1:8000 python -m uvicorn app.main:app --port 8100
```
Then sign in at http://localhost:5173 as farmer, buyer or **FPO / Operations** (demo `9000000001`, OTP 1234); Module 2 pages are in the sidebar under **Farm operations**, and **AI decisions** shows each deal's full pipeline. Module 2's tests: `cd module2/backend && python -m pytest -q` (52 tests).

## Known gaps (to agree with the Module 2 owner)
- Module 2 itself still trusts `X-M2-*` headers, so in production port 8100 must only be reachable from the AgriLink API.
- Payment terms differ: Module 1 agreements use 30/40/30 milestones; Module 2's escrow assumes 50% at signing + 50% at dispatch. `tranche1_released` is sent as true.
- Module 2 expects commitments "signed in person with the FPO"; AgriLink's commitment is an OTP-verified e-signature on the registered agreement (sent as signed).
- Module 2 runs on its own simulated season clock (14 Apr 2027); Module 1 dates are real dates.
- Grade C agreements are not handed over (Module 2 monitors A and B).
- `module2/` keeps its own `.git` folder (cloned repository).
