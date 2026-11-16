# Quality grading module
Flow: farmer uploads photo (with a coin/ruler reference) -> CV model extracts size, length, colour index, blemish % -> `gradeFruit()` -> grade + reasons -> certificate for the stage.

**AI is never the only authority.** The FPO field consultant visits weekly, re-grades a sample, and can override; disagreements are logged to improve the model.

Status: rules implemented in `services/ml/app/modules/grading/service.py`, exposed as `POST /api/quality/assess`, used by the "Check fruit quality" card on the farmer home screen. Thresholds are placeholders to calibrate with buyers. CV model and photo upload are TODO (fine-tune a small image model on ~2k labelled Alphonso photos).

Certificates: stages = pre-harvest / harvest / packhouse / pre-ship. Each stores grade, photos, consultant ID, timestamp and a hash (same chaining as bonds).
