# Stage-wise Crop Quality Assessment

Farmers record each crop lifecycle stage with photos; AgriLink checks what photos can show; the farmer doctor of the
farmer's FPO (authorised consultant) decides; approval issues a **stage certificate** through the existing certificate pipeline.

## Links
- **Crop** (`CRP-<season>-nnnnn`, `Crop` model): farmer (user id + Module 2 id `AGL-F-<id>`), FPO, variety, season, optional procurement agreement.
- **Assessment** (`SA-<season>-nnnnn`, `StageAssessment`): cropId + farmer + FPO + stage + version + batchId (Module 2 lot) when the fruit is in a lot.
- **Certificate** (`AGL-SC-<year>-nnnnn`): the existing `Certificate` collection with `kind: "stage"`, `stage`, `cropId`, `assessmentId`, `batchId`.

## Stages (`server/src/modules/stages/config.js`)
Seed Selection · Sowing and Planting · Crop Growth · Flowering and Fruiting · Harvesting · Post-Harvest Handling · Grading and Packaging.
Each stage has fields, checks (source: farmer record / AI image / photo measurement), minimum photos, whether a batch is required,
and the parameters a photo cannot verify. AgriLink operations (admin desk) can rename, reorder, enable/disable stages and edit guidance
(`/ops/stage-settings`). Thresholds are starting values for Alphonso and need an agronomist's validation.

## AI — what is and is not assessed
- All stages: photo-quality gate (`POST /vision/photo-quality`: brightness, over-exposure, sharpness, vegetation share). No plant-health verdict.
- Flowering/Fruiting, Harvesting, Post-harvest, Grading: existing fruit analysis (`POST /vision/analyze`: blemish %, colour, confidence, lesions).
- Seed, Sowing, Growth: no crop image model exists, so the consultant reviews the photos; the report says so.
- If the ML service is down or no clear fruit is found, image checks are reported as **not assessed** and excluded from the score.

## Report
Quality score (weighted over assessed checks only, with coverage "n of m"), provisional compliance (likely compliant / minor issues /
issues found / insufficient evidence), detected issues, remarks, image evidence (stored write-once with SHA-256), not-verifiable list.
The report is **provisional**; only the consultant's decision sets the result.

## Review workflow
`pending_review` → `approved` | `rejected` | `requires_correction` (farmer resubmits a new version linked by `previousId`).
Only the farmer doctor of the farmer's FPO (desk `doctor`, actor `DOC-<fpoId>`) can decide; approval requires confirming the
non-photo parameters; rejection/correction require remarks. Approval → `issueStageCertificate` (PDF + QR, write-once store,
SHA-256 on `AgreementRegistry`, audit, notifications). A certificate failure is recorded and can be retried; the approval stands.

## API
`GET/POST /api/crops`, `GET /api/crops/:id`, `GET /api/crops/:id/batches`, `POST /api/crops/:id/stages/:stage/assessments` (JSON, photos base64, 25 MB route limit);
`GET /api/stage-assessments[?status]`, `GET /:id`, `GET /:id/photos/:n`, `POST /:id/decision`, `POST /:id/retry-certificate`;
`GET/PUT /api/stages/config`. Certificates and public verification: see `docs/CERTIFICATION.md`.
