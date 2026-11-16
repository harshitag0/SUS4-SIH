# Integrating Module 2 into AgriLink (Module 1)

Module 2 is self-contained: its own routes (`/m2/*`), API prefix (`/api/m2`),
database (`agrilink_m2`), `M2_*` settings and `m2-` CSS classes. Nothing below
assumes how Module 1 is built; the contracts are what Module 2 needs and offers.

## 1. Entry points
| Layer | Entry point | How to mount |
|---|---|---|
| Frontend | `frontend/src/module2/index.js` exports `M2Provider`, `Module2Routes`, `m2NavFor(role)`, `m2HomeFor(role)` | See §2 |
| Backend | `backend/app/main.py`: `m2_router`, `M2_PREFIX = "/api/m2"`, `install_error_handlers(app)`; or run as its own service (`uvicorn app.main:app`) | See §3 |
| Database | `backend/app/db.py`: `COLLECTIONS`, `ensure_indexes(db)` | Separate database or the same cluster |

The `frontend/src/standalone/` folder (sidebar, "Acting as", demo clock) is **only** for running Module 2 alone. Module 1 replaces it.

## 2. Frontend: mount inside Module 1's router
```jsx
import { M2Provider, Module2Routes, m2NavFor } from '<path>/module2'

// inside Module 1's <BrowserRouter>
<Route path="/m2/*" element={
  <M2Provider apiBase={import.meta.env.VITE_M2_API_BASE} basePath="/m2"
              auth={{ role: user.m2Role, actorId: user.m2ActorId }}>
    <Module2Routes />
  </M2Provider>} />

// Module 1's menu can show Module 2 items for the signed-in role:
m2NavFor(user.m2Role)   // → [{group:'Quality', items:[{path:'quality-checks', label:'Photo checks'}, …]}]
```
- Dependencies: `react` ≥ 18 and `react-router-dom` 6/7. No UI library.
- All styles are in `module2/m2.css`, scoped to `.m2-root` with `m2-` class names.
- The QR code on each lot opens `/m2/trace/{lotId}`; set `M2_PUBLIC_TRACE_BASE` to the public URL.

## 3. Backend: two options
**A. Separate service (simplest).** Run Module 2's FastAPI app; Module 1 calls it over HTTP. Put both behind one gateway so the browser sees one origin, or set `M2_CORS_ORIGINS`.

**B. Mount in a Python backend.** If Module 1 also uses FastAPI:
```python
from app.main import m2_router, M2_PREFIX, install_error_handlers
parent.include_router(m2_router, prefix=M2_PREFIX)
install_error_handlers(parent)           # Module 2 error format; or map DomainError yourself
```
Call `ensure_indexes(get_db())` at start-up and run `run_due_jobs` on a timer (§6).

## 4. Identity (replace the demo headers)
Module 2 authorises on `Actor(role, id)` from `app/auth.py::current_actor`, today read from `X-M2-Role` / `X-M2-Actor`. On integration, replace `current_actor` with Module 1's token check and map the user to:

| Module 2 role | Actor id must be | Used for |
|---|---|---|
| `admin` | AgriLink operations user | Everything (risk, recovery, surveyor, ratings) |
| `fpo` | the FPO's id | Own members, lots, withdrawals, recovery replies |
| `doctor` | the farmer doctor's id | Own visits; interventions in own FPO |
| `farmer` | the farmer's id | Own photo checks only |
| `buyer` | the buyer organisation's id | Own agreements, funding, receipt, disputes |
| `system` | Module 1 service | `POST /agreements`, `POST /system/run-due-jobs` |

Frontend: pass the same `{role, actorId}` as `auth` to `M2Provider`; the API client sends it on every call. Swap the header logic in `context.jsx` for a bearer token if Module 1 prefers.

## 5. Data contracts to agree with Module 1
**Module 1 → Module 2: activated agreement** (`POST /api/m2/agreements`, role `system`). Sent when all commitments are signed on paper and tranche 1 is funded. The body is in `API.md`. Module 2 needs:
- the agreement id (kept as Module 2's `_id`), buyer id, quantity, contract grade (A/B), harvest window, dispatch deadline, contract value and currency;
- every signed farmer commitment: farmer id, kg, date signed, signed in person;
- whether tranche 1 was released at signing.

**Module 2 → Module 1: ratings for ranking.** After the 6-month pilot, Module 1's allocation reads `GET /api/m2/ratings/farmer` (and `/buyer`): `rating`, `cycles`, `is_new` per subject, plus `GET /api/m2/ratings/status` (`live`, `switch_on`, `reserve_new_share`). The ordering rule is `domain/ratings.py::order_candidates`; both modules should use the same one.

**Module 2 → Module 1: revised supply.** Supply recovery adds commitments and a `revisions[]` entry on the agreement. If Module 1 keeps its own agreement record, it should read `GET /api/m2/agreements/{id}` or agree on an event/webhook later.

**Shared entities to align** (Module 2 keeps copies seeded locally today): FPO (`id, name, taluka, newly_formed, spare_capacity_kg, capacity_posted_at, visit_interval_days`), farmer (`id, name, fpo_id, village, taluka, channel, language`), farmer doctor (`id, fpo_id`), buyer (`id, name`). Either Module 1 owns them and Module 2 syncs, or both read one shared collection. Ids must be the same strings in both modules.

**Not yet decided (do not hard-code):** currency, dispute-window length, surveyor, escrow bank terms, how a new farmer's rating starts, share caps (Module 1 rule not applied in recovery yet).

## 6. Operations
- Scheduler: call `POST /api/m2/system/run-due-jobs` (role `system`) every 10–15 minutes. It creates weekly checks, sends reminders, escalates second misses, schedules routine visits and releases escrow after the dispute window.
- Set `M2_ALLOW_DEMO_CONTROLS=false` in shared environments; this disables the simulated clock control and reset. Remove the `clock` document from `system` to use real time.
- Replace the simulated adapters in `backend/app/adapters/` one at a time; the services do not change.
