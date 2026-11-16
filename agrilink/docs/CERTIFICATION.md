# Crop Quality Certification & Traceability

One **AgriLink Quality Certificate per collected lot** (the consignment that ships), issued by AgriLink operations or the lot's FPO desk.

## Flow
1. FPO records a lot at collection (Module 2, unchanged).
2. Operations → **Certificates → Certify lots** shows each lot with an evidence checklist read from farm operations:
   quality review PASS per grower (blocking), farmer-doctor inspection at contract grade within 30 days (blocking),
   AI photo check (warning), trace log intact (blocking), procurement agreement on blockchain (warning), no active certificate (blocking).
3. **Issue**: PDF with QR code (pdfkit + qrcode) → write-once store (`server/storage/certificates/`) → SHA-256 registered on the
   existing `AgreementRegistry` contract under the certificate id (version 1) → hash-chained audit → buyer and growers notified.
   Valid 14 days (season time from farm operations).
4. **Revoke**: revocation notice PDF stored and registered as version 2; the public page shows "revoked". The lot can then be certified again.
5. **Public, no login**: `/verify/:id` (status, consignment, growers and evidence, blockchain record, PDF check by fingerprint in the browser),
   `/verify` (lookup / file check), `/trace/:lotId` and `/m2/trace/:lotId` (the lot QR target: journey, tamper check, certificate link).

## Code
- Server: `server/src/modules/certificates/` — `model.js`, `m2.js` (read-only Module 2 client), `service.js` (eligibility, issue, revoke, verify, re-anchoring), `pdf.js`, `routes.js`.
- API: `GET /api/certificates`, `GET /api/certificates/lots`, `GET /api/certificates/eligibility/:lotId`, `POST /api/certificates`, `GET /api/certificates/:id`, `/:id/document`, `POST /:id/revoke`, `/:id/retry-chain`;
  public `GET /api/public/certificates/:id`, `/:id/document`, `/:id/qr.svg`, `GET /api/public/certificates?lot=`, `POST /api/public/certificates/verify`.
- Client: `pages/certificates/` (list, detail, issue), `pages/public/` (verify, trace); nav item "Certificates" for every role; AI Decision Center step "Quality certificate".
- Tests: `server/test/certificates.test.js` (fake Module 2 + fake chain).

## Wording
It is an AgriLink platform certificate, not an APEDA, AGMARK or GI certificate, and does not replace phytosanitary certification — stated on the PDF and the public page.
