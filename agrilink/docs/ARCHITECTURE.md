# Architecture decision: MERN core + Python ML services

## Decision
| Layer | Choice | Why |
|---|---|---|
| Frontend | **React 18 + Vite**, React Router | Component reuse across farmer/buyer/FPO/consultant apps; easy PWA later for low-end Android phones |
| API / core backend | **Node.js + Express** (MERN) | One language with the frontend; fast I/O for many small requests (dashboards, polling, WhatsApp webhooks) |
| Database | **MongoDB** (Mongoose) | Farm profiles, requirements and agreements are document-shaped and evolve per crop; flexible schema helps scaling to new crops |
| ML / analytics | **Python + FastAPI** | Forecasting, image grading and weather rules live in the Python ecosystem (numpy, statsmodels/Prophet, PyTorch/YOLO) |

The browser only talks to the Express API. Express owns auth, data and business rules (capacity limits, signing). It calls the Python service over HTTP for anything model-based, with caching and a 5 s timeout (returns 502 `ml_unavailable` if Python is down, and the UI shows a friendly message).

```
React (5173) ──/api────────▶ Express (4000) ──▶ MongoDB (27017)
     ▲        ──/socket.io──▶      │  │
     │                             │  └──HTTP──▶ FastAPI ML (8000): /forecast /grading /alerts /mandi
     └──── live push ──────────────┘          │
           (notification, data:changed)       └──▶ data.gov.in Agmarknet (live mandi prices, needs key)
                                   └──▶ Open-Meteo (live weather per district, no key)
```

## Real-time notifications
- Socket.IO runs on the same port as the API. Each browser joins rooms `all`, `user:<id>`, `role:<role>` (JWT checked on connect).
- `notifier` (`server/src/modules/notifications/notifier.js`) **saves** every notification in MongoDB and **pushes** it live. Offline users get them on next login (`GET /api/notifications`).
- Events: buyer posts requirement → all onboarded farmers (`req_new`); farmer drafts agreement → buyer (`bond_new`); one side signs → other side (`bond_signed`); both signed → both (`bond_active`); decline → other side; severe weather → that farmer (`weather`, background job every 3 h, max once per alert per day).
- `data:changed` events make open screens reload instantly (polling is only a 60 s fallback).
- SMS / WhatsApp later = one more channel inside `notifier`.

## Data sources
| Data | Source | Status |
|---|---|---|
| Buyer demand on platform | MongoDB requirements (`GET /api/market/live`) | **live** |
| Weather + alerts | Open-Meteo by district (`server/src/lib/weather.js`), cached 30 min | **live** (falls back to sample, labelled) |
| Mandi prices | data.gov.in Agmarknet (`services/ml/app/modules/mandi`), cached 1 h | **live when `DATA_GOV_IN_API_KEY` is set**, else shown as "not connected" |
| Demand/supply forecast by market × grade × month | Trained model (`services/ml/app/modules/supply_demand`) on `services/ml/data/*.csv` | **model is real; training data is sample** until APEDA CSVs are loaded (see `DATA.md`) |
| Weekly market price forecast + offer advice | Trained model (`services/ml/app/modules/price`) on `services/ml/data/prices_weekly.csv` | **model is real; training data is sample** until Agmarknet history is loaded |

## Supply–Demand engine
- **Model:** scikit-learn GradientBoostingRegressor predicting log growth vs the same month last year (+ 10%/90% quantile models for an 80% range). Predicting growth instead of volume lets the trees extrapolate to next season.
- **Features:** last year's volume, market growth, COVID shock/rebound, weather shock (this/last/2 years ago, supply), month, grade, market factors (Indian-diaspora share, premium market, air hours, irradiation/VHT).
- **Validation:** trained on years before the holdout year, tested on the holdout, compared with "same as last year" and "last year × last growth". Results are stored in the model card and shown to farmers.
- **Outputs:** per market: demand by month × grade with range; Singapore corridor: FPO supply, shortage, need level (high ≥15% shortage, medium 0–15%, low = oversupply), most-needed grade. Per farmer: plan sized to free Grade A/B capacity inside the district's harvest months, plus top markets ranked by growth, price and grade mix.
- **Live signal:** the Express gateway adds how much of the Grade A forecast real AgriLink buyers have already confirmed.

## Price (cost) prediction engine
- **Model:** GradientBoostingRegressor on log price change vs the same district/week/grade last year, + 10%/90% quantile models.
- **Features:** last year's price, season week, grade, district, change in market arrivals (supply), Singapore demand-supply gap and its change (demand pull), weather shock this/last year.
- **Linked to the Supply–Demand engine:** next season's arrivals change = forecast FPO supply growth; demand pull = forecast shortage. A demand scenario (±10/20%) recomputes the shortage, so farmers see how price reacts to demand.
- **Offer advice** (`POST /price/evaluate`, used by `/api/requirements`): for each offer and its delivery week — farmer keeps = offer − export costs (₹45/kg); local market net = market price − 6% commission − ₹5/kg; fair offer = market price + export costs → **accept** (within 3% of fair or better), **negotiate** with a counter-offer, or **sell locally** if the market pays more. Escalation clauses show the best case.
- **Validation:** holdout year vs "same as last year" and "last year × recent inflation"; shown on the Price screen.

## Cost & Profit engine
- **Model:** one linear regression per cost component on log change vs last year, with agronomic drivers (labour ← wages, fertilizer ← fertilizer index, sprays ← bad-weather year, irrigation ← diesel, harvest & transport ← diesel + wages, yield ← weather). Coefficients are elasticities shown to the farmer; intercepts are underlying inflation.
- **Comparative study** (`POST /cost/analysis`, via `GET /api/farmers/me/costs`): year-by-year cost / yield / cost-per-kg / price-per-kg / profit / margin (district, per acre, + next-season forecast); my farm's cost by component with range and break-even price; selling channels — AgriLink plan (open offers filled up to what each buyer still needs, rest at fair export price; Grade C to processing if better) vs all at the local market; what-if (wages / diesel / fertilizer); my actual costs vs district average with saving tips.
- Uses the Price engine for next-season prices, so cost, price and demand stay consistent.
- **Price thresholds:** baseline = break-even (farm cost ÷ marketable kg); target = baseline + profit margin (default 20%, farmer can pick 10/20/30%). Minimum AgriLink offer = (baseline + ₹45 handling) ÷ USD/INR.
- **Local vs countries:** per grade, what the farmer keeps per kg in the local mandi (− commission, transport), a processing unit (Grade B/C), and each export country. Country prices are last season's delivered (CIF) USD/kg rolled forward with the Price engine trend, minus handling, assumed air freight (₹20 + ₹13 × flight hours) and treatment (irradiation USA ₹30, VHT Japan ₹40). Each row: net, vs local, loss / low profit / above target, and the minimum CIF price to ask for baseline and target.

## Check before you sign
`GET /api/bonds/precheck?requirementId&tons` (new commitment) and `GET /api/bonds/:id/precheck` (draft agreement) combine all engines for ONE deal:
demand (Supply–Demand: grade need, delivery month) · price (Price: accept / negotiate / sell locally) · profit (Cost: farmer net vs growing cost per kg, profit on these tons vs selling locally) · capacity (free Grade A after other agreements) · weather (live severe-weather alerts). Each is ok / warn / bad; the worst is the overall verdict. Shown in the commit dialog on Offers and on every draft agreement before the farmer signs.

## Why this scales to more modules
- **Express modules** live in `server/src/modules/<name>/` and export `(deps) => ({ path, router })`. Adding chatbot, logistics or payments = new folder + one line in `modules/index.js`.
- **Python modules** live in `services/ml/app/modules/<name>/{service,router}.py`, registered in `main.py`. A heavy module (photo CV model) can be split into its own container without touching the API contract.
- **New crops**: grade specs, price series and yield tables are data, not code paths. Add rows for Kesar / pomegranate etc.
- **i18n**: all farmer strings are keys in `client/src/i18n/{en,hi,mr}.json`; the server returns codes (alert `code`, tip keys), never sentences, so new languages need no backend change.

## Production gaps (deliberately not done in the demo)
- OTP is a fixed demo code (`DEV_OTP`). Plug in an SMS provider and rate-limit `/auth/otp`.
- Signatures are server-side SHA-256 hash chains. Legal validity needs an e-sign provider (Aadhaar e-Sign) and/or anchoring hashes on a ledger.
- Export history and the season price forecast still use sample data; real APEDA/APMC history replaces `services/ml/app/data.py` (see `DATA.md`).
- Notifications are in-app (and browser notifications when allowed). SMS/WhatsApp for farmers without the app open is next.
- Socket.IO runs in one process; with several API instances add the Redis adapter.
