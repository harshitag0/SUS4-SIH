import path from "node:path";
import { fileURLToPath } from "node:url";
import { HttpError } from "../../lib/http.js";
import { appendAudit, verifyAudit } from "../contracts/audit.js";
import { Agreement } from "../contracts/model.js";
import { createStore } from "../contracts/storage.js";
import { m2Get } from "../certificates/m2.js";
import { issueStageCertificate, certStore } from "../certificates/service.js";
import { m2Id } from "../module2/handoff.js";
import { User } from "../users/model.js";
import { buildReport, validateEntries } from "./assess.js";
import { loadStages, stageByKey } from "./config.js";
import { Crop, StageAssessment } from "./model.js";

/**
 * Stage-wise crop quality assessment.
 *   farmer submits (entries + photos) -> AI + rules build a PROVISIONAL report -> status pending_review
 *   -> the farmer doctor of the farmer's FPO (authorised consultant) approves / rejects / requests correction
 *   -> approval triggers the existing certificate pipeline (stage certificate). Correction -> farmer resubmits a new version.
 * Every record links farmer (user id + Module 2 id), crop (cropId) and batch (Module 2 lot id, when the fruit is in a lot).
 */
const DEFAULT_PHOTO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../storage/stage-photos");
export const photoStore = (deps) => deps?.photoStore || createStore(process.env.STAGE_PHOTO_DIR || DEFAULT_PHOTO_DIR);
const MAGIC = [[[0xff, 0xd8, 0xff], "jpg", "image/jpeg"], [[0x89, 0x50, 0x4e, 0x47], "png", "image/png"], [[0x52, 0x49, 0x46, 0x46], "webp", "image/webp"]];
const MAX_PHOTO = 6 * 1024 * 1024;
const DECISIONS = ["approved", "rejected", "requires_correction"];

async function nextId(prefix, Model, field) {
  const last = await Model.findOne({ [field]: { $regex: `^${prefix}` } }).sort({ [field]: -1 });
  return prefix + String(last ? Number(last[field].slice(prefix.length)) + 1 : 1).padStart(5, "0");
}

/** Who is asking, in farm-operations terms. Consultants are farmer doctors (Module 2 desk "doctor"). */
async function desk(auth) {
  if (auth.role === "farmer") return { role: "farmer", userId: auth.id };
  if (auth.role !== "operations") return { role: auth.role, userId: auth.id };
  const u = await User.findById(auth.id);
  const role = u?.m2Role || "admin", actor = u?.m2Actor || "OPS-1";
  let name = role === "doctor" ? `Farmer doctor ${actor}` : role === "fpo" ? `FPO officer ${actor}` : "AgriLink operations";
  if (role === "doctor") {
    try { name = (await m2Get("/meta"))?.actors?.doctor?.find((d) => d.id === actor)?.name || name; } catch { /* keep id-based name */ }
  }
  return { role, actor, name, userId: u?._id, fpoId: role === "doctor" ? actor.replace(/^DOC-/, "") : role === "fpo" ? actor : null };
}

/** Which assessments/crops a desk may see. */
function scope(d, field = "fpoId") {
  if (d.role === "farmer") return { farmer: d.userId };
  if (d.role === "admin") return {};
  if (d.role === "doctor" || d.role === "fpo") return { [field]: d.fpoId };
  return { _id: null };
}

export async function listCrops(auth) {
  const d = await desk(auth);
  return Crop.find(scope(d, "fpo.id")).sort({ createdAt: -1 }).limit(200);
}

export async function loadCrop(cropId, auth) {
  const d = await desk(auth);
  const c = await Crop.findOne({ cropId, ...scope(d, "fpo.id") });
  if (!c) throw new HttpError(404, "Crop record not found", "not_found");
  return c;
}

export async function createCrop(auth, body) {
  if (auth.role !== "farmer") throw new HttpError(403, "Only farmers create crop records", "forbidden");
  const u = await User.findById(auth.id);
  if (!u?.farm) throw new HttpError(409, "Complete your farm profile first", "no_farm");
  const season = Number(body.season) || new Date().getFullYear();
  let agreementId = null;
  if (body.agreementId) {
    const a = await Agreement.findOne({ agreementId: body.agreementId, farmer: u._id });
    if (!a) throw new HttpError(400, "That agreement is not yours", "bad_agreement");
    agreementId = a.agreementId;
  }
  const fpoId = m2Id.fpo(u.farm);
  for (let i = 0; i < 3; i++) {
    try {
      return await Crop.create({
        cropId: await nextId(`CRP-${season}-`, Crop, "cropId"), farmer: u._id, m2FarmerId: m2Id.farmer(String(u._id)),
        fpo: { id: fpoId, name: u.farm.fpo || u.farm.village }, variety: body.variety || u.farm.variety || "Alphonso",
        season, plot: String(body.plot || "").trim().slice(0, 60) || `${u.farm.village} orchard`, trees: u.farm.trees, district: u.farm.district, agreementId,
      });
    } catch (e) { if (e.code !== 11000) throw e; }
  }
  throw new HttpError(500, "Could not allocate a crop id");
}

/** Batches = Module 2 lots of this crop's agreement that contain this farmer's fruit. */
export async function cropBatches(crop) {
  if (!crop.agreementId) return [];
  let d = null;
  try { d = await m2Get(`/agreements/${encodeURIComponent(crop.agreementId)}`); } catch { return []; }
  return (d?.lots || []).flatMap((l) => {
    const mine = (l.contributions || []).find((c) => c.farmer_id === crop.m2FarmerId);
    return mine ? [{ batchId: l.id, kg: mine.kg, grade: mine.grade, collectedAt: l.collected_at, totalKg: l.total_kg, status: l.status }] : [];
  });
}

/** Crop with every enabled stage, its latest assessment and certificate. */
export async function cropView(crop) {
  const [stages, all] = await Promise.all([loadStages(), StageAssessment.find({ cropId: crop.cropId }).sort({ version: -1 })]);
  return {
    ...crop.toObject(),
    stages: stages.filter((s) => s.enabled).map((s) => {
      const hist = all.filter((a) => a.stage.key === s.key);
      const latest = hist[0];
      return { key: s.key, name: s.name, order: s.order, aiMode: s.aiMode, guidance: s.guidance, minPhotos: s.minPhotos, requiresBatch: s.requiresBatch,
        fields: s.fields, notAssessable: s.notAssessable,
        latest: latest ? summary(latest) : null, versions: hist.length };
    }),
  };
}

const summary = (a) => ({ assessmentId: a.assessmentId, version: a.version, status: a.status, batchId: a.batchId || null,
  qualityScore: a.report?.qualityScore ?? null, provisionalCompliance: a.report?.provisionalCompliance, submittedAt: a.createdAt,
  review: a.review?.decision ? { decision: a.review.decision, remarks: a.review.remarks, by: a.review.by, at: a.review.at } : null,
  certificateId: a.certificateId || null });

function decodePhotos(photos, min) {
  if (!Array.isArray(photos) || photos.length < min) throw new HttpError(400, `Upload at least ${min} photo(s) for this stage`, "photos_required");
  if (photos.length > 5) throw new HttpError(400, "Upload at most 5 photos", "too_many_photos");
  return photos.map((p, i) => {
    const buf = Buffer.from(String(p.dataBase64 || "").replace(/^data:[^;]+;base64,/, ""), "base64");
    const m = MAGIC.find(([sig]) => sig.every((b, j) => buf[j] === b));
    if (!m) throw new HttpError(400, `Photo ${i + 1} is not a JPEG, PNG or WebP image`, "bad_photo");
    if (buf.length > MAX_PHOTO) throw new HttpError(413, `Photo ${i + 1} is larger than 6 MB`, "photo_too_large");
    return { buf, ext: m[1], type: m[2] };
  });
}

export async function submit(crop, stageKey, body, auth, { vision, photoStore: store, notifyUsers, changed }) {
  if (auth.role !== "farmer" || String(crop.farmer) !== auth.id) throw new HttpError(403, "Only the grower submits stage assessments", "forbidden");
  const stage = await stageByKey(stageKey);
  if (!stage || !stage.enabled) throw new HttpError(404, "Unknown or disabled stage", "unknown_stage");
  const latest = await StageAssessment.findOne({ cropId: crop.cropId, "stage.key": stageKey }).sort({ version: -1 });
  if (latest?.status === "pending_review") throw new HttpError(409, "This stage is already waiting for consultant review", "pending_review");
  if (latest?.status === "approved") throw new HttpError(409, "This stage is already approved", "already_approved");
  const entries = validateEntries(stage, body.entries || {});
  const photos = decodePhotos(body.photos, stage.minPhotos);

  let batchId = body.batchId || null;
  const batches = await cropBatches(crop);
  if (stage.requiresBatch && !batchId) throw new HttpError(400, "Choose the batch (lot) this fruit belongs to", "batch_required");
  if (batchId && !batches.some((b) => b.batchId === batchId)) throw new HttpError(400, "That batch does not contain your fruit for this crop", "bad_batch");

  const assessmentId = await nextId(`SA-${crop.season}-`, StageAssessment, "assessmentId");
  const saved = [];
  for (const [i, p] of photos.entries()) {
    const s = await store.putOnce(`${assessmentId}/${i + 1}.${p.ext}`, p.buf);
    saved.push({ n: i + 1, key: s.key, sha256: s.sha256, size: s.size, type: p.type });
  }
  const v = await vision.assess(stage, photos);
  const report = buildReport(stage, entries, v, saved.map(({ n, sha256, size }) => ({ n, sha256, size })));
  const u = await User.findById(auth.id).select("name");
  const a = new StageAssessment({
    assessmentId, cropId: crop.cropId, farmer: crop.farmer, m2FarmerId: crop.m2FarmerId, fpoId: crop.fpo.id, batchId,
    stage: { key: stage.key, name: stage.name, order: stage.order }, version: (latest?.version || 0) + 1, previousId: latest?.assessmentId,
    entries, photos: saved, report, status: "pending_review", audit: [],
  });
  appendAudit(a, { actorRole: "farmer", actorName: u?.name || "Farmer", action: "submitted", details: { version: a.version, photos: saved.length, provisionalCompliance: report.provisionalCompliance } });
  appendAudit(a, { actorRole: "system", actorName: "AgriLink AI", action: "assessed", details: { score: report.qualityScore, aiAvailable: report.ai.available } });
  await a.save();
  const consultants = await User.find({ role: "operations", m2Role: "doctor", m2Actor: `DOC-${crop.fpo.id}` }).select("_id");
  await notifyUsers(consultants.map((c) => c._id), "stage_review_request", { assessmentId, cropId: crop.cropId, stage: stage.name, farmer: u?.name });
  changed("stages");
  return a;
}

export async function listAssessments(auth, { status } = {}) {
  const d = await desk(auth);
  const q = { ...scope(d), ...(status ? { status } : {}) };
  return StageAssessment.find(q).sort({ createdAt: -1 }).limit(200).select("-audit -report.imageEvidence");
}

export async function loadAssessment(id, auth) {
  const d = await desk(auth);
  const a = await StageAssessment.findOne({ assessmentId: id, ...scope(d) });
  if (!a) throw new HttpError(404, "Assessment not found", "not_found");
  return { a, d };
}

export async function view(a, d) {
  const crop = await Crop.findOne({ cropId: a.cropId });
  const farmer = await User.findById(a.farmer).select("name farm.village farm.district");
  const history = await StageAssessment.find({ cropId: a.cropId, "stage.key": a.stage.key }).sort({ version: -1 }).select("assessmentId version status review createdAt");
  const stage = await stageByKey(a.stage.key);
  return { ...a.toObject(), crop, farmer, fields: stage?.fields || [], history, auditIntact: verifyAudit(a.audit).intact,
    canDecide: d.role === "doctor" && d.fpoId === a.fpoId && a.status === "pending_review" };
}

export async function decide(a, d, body, deps) {
  if (d.role !== "doctor") throw new HttpError(403, "Only a farmer doctor (consultant) can review stage assessments", "forbidden");
  if (d.fpoId !== a.fpoId) throw new HttpError(403, "You are not the consultant for this farmer's FPO", "forbidden");
  if (a.status !== "pending_review") throw new HttpError(409, `Assessment is already ${a.status.replace("_", " ")}`, "already_decided");
  const decision = String(body.decision);
  if (!DECISIONS.includes(decision)) throw new HttpError(400, "Decision must be approved, rejected or requires_correction", "bad_decision");
  const remarks = String(body.remarks || "").trim().slice(0, 1000);
  if (decision !== "approved" && remarks.length < 5) throw new HttpError(400, "Explain the decision to the farmer (remarks)", "remarks_required");
  if (decision === "approved" && body.confirmNotAssessable !== true)
    throw new HttpError(400, "Confirm the parameters photos cannot verify before approving", "confirm_required");
  a.status = decision;
  a.review = { decision, remarks, confirmedNotAssessable: decision === "approved", by: d.name, byUser: d.userId, at: new Date() };
  appendAudit(a, { actorRole: "doctor", actorName: d.name, action: `review_${decision}`, details: { remarks } });
  await a.save();
  if (decision === "approved") await certify(a, d, deps);
  await deps.notifyUsers([a.farmer], "stage_decision", { assessmentId: a.assessmentId, cropId: a.cropId, stage: a.stage.name, decision, certificateId: a.certificateId || null });
  deps.changed("stages", "certificates");
  return a;
}

/** Approval -> existing certificate pipeline. A failure is recorded and can be retried; the approval stands. */
export async function certify(a, d, deps) {
  const crop = await Crop.findOne({ cropId: a.cropId });
  const farmer = await User.findById(a.farmer).select("name");
  try {
    const cert = await issueStageCertificate({ assessment: a, crop, consultant: { name: d.name, userId: d.userId }, farmerName: farmer?.name },
      { chain: deps.chain, store: deps.certStore, notify: deps.notifyCert });
    a.certificateId = cert.certificateId;
    a.certificateError = undefined;
    appendAudit(a, { actorRole: "system", actorName: "AgriLink", action: "certificate_issued", details: { certificateId: cert.certificateId } });
  } catch (e) {
    a.certificateError = String(e.message).slice(0, 200);
    appendAudit(a, { actorRole: "system", actorName: "AgriLink", action: "certificate_failed", details: { error: a.certificateError } });
  }
  await a.save();
  return a;
}

export { desk, certStore };
