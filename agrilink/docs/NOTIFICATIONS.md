# Advisory lifecycle, regional languages, WhatsApp and SMS

## Flow (implemented)
Farmer inspection (photo check / farmer-doctor visit / stage assessment) → engine finds gaps vs the buyer's grade →
recommendations (treatment advice on pests/disease = `pending_approval` until the farmer doctor approves) →
translated into the farmer's language → in-app + WhatsApp/SMS (simulated unless credentials are set) →
farmer acknowledges / marks done with note + photos / asks for help (works offline: queued and sent on reconnect) →
farmer doctor verifies (or "more work needed"), adds guidance, schedules and records the next inspection →
engine compares previous vs current inspection (blemish %, colour, pest/disease signs) → resolves, keeps or reopens recommendations.
History: every recommendation keeps its events, guidance, evidence photos and before/after comparisons; resolved items stay as history; inspection snapshots are kept per farmer.

## Languages
English, Hindi, Marathi, Gujarati, Tamil, Telugu, Kannada — advice content (`server/src/modules/advisory/knowledge*.js`),
messages (`server/src/modules/messaging/templates.js`) and farmer screens (`client/src/i18n/*.json`; gu/ta/te/kn cover farmer
advice, stages, profile and navigation and fall back to English elsewhere). Farmers choose the language in the picker or Profile;
it is saved to their account and used for WhatsApp/SMS. All translations need native-speaker and agronomist review before production.

## Channels
| Event | WhatsApp | SMS |
|---|---|---|
| New inspection result | ✓ | |
| Quality gaps (urgent) | | ✓ |
| New / approved recommendation | ✓ (+ voice note if enabled and in 24 h window) | |
| Crop-care reminder (due tomorrow) | ✓ | ✓ |
| Farmer-doctor visit in ≤ 2 days | ✓ | ✓ |
| Re-inspection reminder | ✓ | ✓ |
| Harvest readiness | ✓ | ✓ |
| Agreement / certificate / stage decision | ✓ | ✓ (agreement updates) |
| Harvest notice & photo-check due (from farm operations) | ✓ | ✓ |
| Storm / hail warning | ✓ | ✓ |

## Delivery tracking
`MessageLog`: queued → sent (accepted by provider) → delivered / read (webhook) or failed. Retryable failures (network, 5xx, 429)
retry after 2, 10, 30 min (max 3 attempts). `simulated` = development mode (nothing sent); `skipped` = not sent by design
(e.g. voice outside WhatsApp's 24-hour window, channel off). Operations: `/ops/messages`. Farmers: Advice → Messages.

## Production checklist
1. Meta WhatsApp Business account, phone number id, permanent token; create and get approval for templates `agrilink_<key>` in each language
   with the bodies from `templates.js` ({{1}}, {{2}} … in `params` order). Configure webhook `GET/POST /api/webhooks/whatsapp`.
2. SMS (India): DLT registration (entity, header, templates matching `templates.js`); put template ids in `SMS_DLT_TEMPLATE_IDS`.
3. Optional Google Cloud Text-to-Speech key for voice notes.
4. Set `MESSAGING_MODE=live` once credentials are in place so missing configuration fails visibly.
