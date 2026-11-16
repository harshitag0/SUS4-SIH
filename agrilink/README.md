# AgriLink
Trade-and-trust platform for perishable Alphonso mango exports, India -> Singapore.
Stack: **React (Vite) + Node/Express + MongoDB** (MERN) with **Python FastAPI** for forecasting, grading and alerts. See `docs/ARCHITECTURE.md`.

## Run locally (no Docker)
Needs Node 20+, Python 3.10+, MongoDB running on `127.0.0.1:27017`.

```bash
# 1. ML service (port 8000)
cd services/ml && pip install -r requirements.txt && python -m uvicorn app.main:app --port 8000

# 0. Local blockchain (port 8545) + registry contract — see docs/BLOCKCHAIN.md
cd blockchain && npm install && npm run node        # keep running
cd blockchain && npm run deploy:local

# 2. API (port 4000) - seeds demo buyer requirements on first start
cd server && npm install && npm start

# 3. Web app (port 5173) - proxies /api to the API
cd client && npm install && npm run dev
```
Open http://localhost:5173. Farmer: any 10-digit number + OTP `1234`, or "Try demo farmer". Buyer: "Try demo buyer", or seeded buyers `6500000001`–`6500000004` with OTP `1234`.

> Windows: if `npm install` in `client/` fails with missing `esbuild.exe`, the folder path is too long. Move the project to a short path (e.g. `C:\dev\agrilink`).

## Live features
- **Notifications:** a buyer posting a requirement notifies every farmer instantly (🔔 in the header, toast, browser notification if allowed). Agreement steps notify the other side. Open two browser tabs — farmer in one, buyer in the other — each tab keeps its own login.
- **Weather:** live from Open-Meteo for the farm's district; severe weather triggers a notification.
- **Demand:** the "Live demand on AgriLink" card is computed from real requirements.
- **Mandi prices (optional):** get a free API key at https://data.gov.in, then start the ML service with it:
  ```bash
  set DATA_GOV_IN_API_KEY=your-key   # PowerShell: $env:DATA_GOV_IN_API_KEY="your-key"
  ```
  Without a key the Price screen says "not connected" and comparisons use the price model.
- Trained ML models: Supply–Demand engine (Demand tab), Price engine (Price tab, accept / negotiate advice on every offer) and Cost & Profit engine (Profit tab). A "Check before you sign" panel combines them for every deal. All three are trained on labelled sample data until real APEDA / Agmarknet files are loaded (docs/DATA.md).

## Module 2 — Farm management & supply assurance
The teammate's module lives in `module2/` and runs inside each AgriLink portal (sidebar: Farm operations) behind one sign-in; **AI decisions** runs every deal as one pipeline across both modules. Agreements registered on-chain are handed over automatically. Run its API on port 8100 (`M2_CV_URL` sends photo checks to the AgriLink vision grader in the ML service):
```bash
cd module2/backend && pip install -r requirements.txt && python -m app.seed && M2_CV_URL=http://127.0.0.1:8000 python -m uvicorn app.main:app --port 8100
```
Details: `docs/MODULE2.md`.

## Digital agreements (AgriLink Trust)
Every farmer commitment becomes a formal agreement: structured terms with a live legal preview, OTP-verified e-signatures from both parties, a signed PDF stored write-once, and its SHA-256 registered on Polygon (local Polygon-compatible chain in development). Anyone can verify a PDF in **Agreement Registry → Verify document**. Details: `docs/BLOCKCHAIN.md`.

## Run with Docker
```bash
docker compose up --build
```

## Tests
```bash
cd services/ml && python -m pytest -q        # forecasting, grading, alerts
cd server && npm test                         # API integration (needs MongoDB; ML is faked)
```

## Layout
```
agrilink/
├── client/                      React + Vite (port 5173)
│   └── src/
│       ├── api.js               fetch wrapper (JWT)
│       ├── context/             AuthContext (login session)
│       ├── hooks/               useApi (fetch + live polling)
│       ├── i18n/                en.json · hi.json · mr.json
│       ├── components/          Layout, BondCard, FarmForm, charts/ui
│       └── pages/
│           ├── Landing, Login, Onboarding
│           ├── farmer/          Home · Offers · Demand · Price · Agreements · Profile
│           └── buyer/           BuyerDashboard
├── server/                      Node + Express + MongoDB (port 4000)
│   ├── src/
│   │   ├── modules/             auth · users · farmers · requirements · bonds · market · quality · alerts
│   │   │   └── index.js         module registry (add new modules here)
│   │   ├── lib/                 ml client, http errors
│   │   ├── middleware/          JWT auth + roles
│   │   ├── config/              env
│   │   └── seed.js              demo buyers + requirements
│   └── test/                    API integration tests
├── services/ml/                 Python FastAPI (port 8000)
│   ├── app/modules/             supply_demand + price + cost (trained models) · grading · alerts · mandi
│   ├── data/ · scripts/         training CSVs + sample-data generator
│   ├── app/data.py              dummy APEDA/APMC-shaped data
│   └── tests/
├── docs/                        FLOW · ARCHITECTURE · BUSINESS · ROADMAP · DATA
│   └── modules/                 specs: chatbot · logistics · quality-grading · scenario-alerts
└── docker-compose.yml
```

## Request flow
```
Farmer / Buyer (browser)
   │  React page ──/api──▶ Express module ──▶ MongoDB (users, requirements, bonds)
   │                            │
   │                            └──HTTP──▶ Python ML (forecast · grading · alerts)
   ◀── JSON (codes, numbers) ── translated in the browser (en/hi/mr)
```
