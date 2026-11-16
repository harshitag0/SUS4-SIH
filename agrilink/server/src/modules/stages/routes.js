import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { HttpError, wrap } from "../../lib/http.js";
import { requireAuth } from "../../middleware/auth.js";
import { makeNotify } from "../certificates/routes.js";
import { certStore } from "../certificates/service.js";
import { createVision } from "./assess.js";
import { DEFAULT_STAGES, StageConfig, loadStages } from "./config.js";
import * as svc from "./service.js";
import { generate as refreshAdvice } from "../advisory/service.js";
import { currentWeather } from "../alerts/routes.js";

const depsFor = ({ notifier, contractDeps, certDeps, stageDeps }) => ({
  vision: stageDeps?.vision || createVision(env.mlUrl),
  photoStore: svc.photoStore(stageDeps),
  chain: contractDeps?.chain,
  certStore: certStore(certDeps),
  notifyCert: makeNotify(notifier),
  notifyUsers: (ids, type, data) => (ids.length ? notifier?.toUsers?.(ids, type, data) : null),
  changed: (...r) => notifier?.changed?.(...r),
});

/** Crop records and stage submissions (farmers), read access for FPO / consultants / operations. */
export default function cropsModule(deps) {
  const r = Router();
  r.use(requireAuth());
  const d = () => depsFor(deps);
  r.get("/", wrap(async (req, res) => res.json(await svc.listCrops(req.auth))));
  r.post("/", wrap(async (req, res) => {
    const b = z.object({ season: z.coerce.number().int().min(2020).max(2100).optional(), plot: z.string().max(60).optional(),
      agreementId: z.string().max(40).optional().nullable(), variety: z.string().max(40).optional() }).parse(req.body || {});
    res.status(201).json(await svc.createCrop(req.auth, b));
  }));
  r.get("/:id", wrap(async (req, res) => res.json(await svc.cropView(await svc.loadCrop(req.params.id, req.auth)))));
  r.get("/:id/batches", wrap(async (req, res) => res.json(await svc.cropBatches(await svc.loadCrop(req.params.id, req.auth)))));
  r.post("/:id/stages/:stage/assessments", wrap(async (req, res) => {
    const crop = await svc.loadCrop(req.params.id, req.auth);
    const a = await svc.submit(crop, req.params.stage, req.body || {}, req.auth, d());
    refreshAdvice(crop.farmer, { ml: deps.ml, weather: deps.weather || currentWeather, notifier: deps.notifier }).catch(() => {});
    res.status(201).json(await svc.view(a, await svc.desk(req.auth)));
  }));
  return { path: "/crops", router: r };
}

/** Assessments: review queue, report, photos, consultant decision. */
export function stageAssessmentsModule(deps) {
  const r = Router();
  r.use(requireAuth());
  const d = () => depsFor(deps);
  r.get("/", wrap(async (req, res) => res.json(await svc.listAssessments(req.auth, { status: req.query.status }))));
  r.get("/:id", wrap(async (req, res) => { const { a, d: desk } = await svc.loadAssessment(req.params.id, req.auth); res.json(await svc.view(a, desk)); }));
  r.get("/:id/photos/:n", wrap(async (req, res) => {
    const { a } = await svc.loadAssessment(req.params.id, req.auth);
    const p = a.photos.find((x) => x.n === Number(req.params.n));
    if (!p) throw new HttpError(404, "Photo not found", "not_found");
    res.set({ "content-type": p.type, "cache-control": "private, max-age=3600", "x-sha256": p.sha256 }).send(await d().photoStore.get(p.key));
  }));
  r.post("/:id/decision", wrap(async (req, res) => {
    const { a, d: desk } = await svc.loadAssessment(req.params.id, req.auth);
    await svc.decide(a, desk, req.body || {}, d());
    refreshAdvice(a.farmer, { ml: deps.ml, weather: deps.weather || currentWeather, notifier: deps.notifier }).catch(() => {});
    res.json(await svc.view(a, desk));
  }));
  r.post("/:id/retry-certificate", wrap(async (req, res) => {
    const { a, d: desk } = await svc.loadAssessment(req.params.id, req.auth);
    if (desk.role !== "doctor" && desk.role !== "admin") throw new HttpError(403, "Consultant or operations only", "forbidden");
    if (a.status !== "approved" || a.certificateId) throw new HttpError(409, "Nothing to retry", "nothing_to_retry");
    await svc.certify(a, desk, d());
    res.json(await svc.view(a, desk));
  }));
  return { path: "/stage-assessments", router: r };
}

/** Stage configuration: everyone reads; AgriLink operations (admin desk) edits names, order, guidance, on/off. */
export function stageConfigModule() {
  const r = Router();
  r.use(requireAuth());
  r.get("/config", wrap(async (_req, res) => res.json(await loadStages())));
  r.put("/config", wrap(async (req, res) => {
    const desk = await svc.desk(req.auth);
    if (desk.role !== "admin") throw new HttpError(403, "Only AgriLink operations can change the stage configuration", "forbidden");
    const keys = DEFAULT_STAGES.map((s) => s.key);
    const b = z.object({ stages: z.array(z.object({ key: z.enum(keys), name: z.string().trim().min(3).max(60), enabled: z.boolean(),
      order: z.number().int().min(1).max(50), guidance: z.string().trim().max(400).optional() })).min(1) }).parse(req.body);
    if (!b.stages.some((s) => s.enabled)) throw new HttpError(400, "Keep at least one stage enabled", "no_stage");
    await StageConfig.findByIdAndUpdate("stages", { overrides: b.stages, updatedBy: desk.name }, { upsert: true });
    res.json(await loadStages());
  }));
  return { path: "/stages", router: r };
}
