import { Router } from "express";
import { z } from "zod";
import { HttpError, wrap } from "../../lib/http.js";
import { requireAuth } from "../../middleware/auth.js";
import { currentWeather } from "../alerts/routes.js";
import { m2Id } from "../module2/handoff.js";
import { desk as deskOf } from "../stages/service.js";
import { User } from "../users/model.js";
import * as svc from "./service.js";

const LANG = z.enum(["en", "hi", "mr", "gu", "ta", "te", "kn"]);
const M2 = () => (process.env.M2_API_URL || "http://127.0.0.1:8100/api/m2").replace(/\/$/, "");

/** Write to farm operations as the farmer doctor (Module 2 checks the doctor belongs to the farmer's FPO). */
async function m2AsDoctor(method, path, body, actor) {
  const res = await fetch(M2() + path, { method, headers: { "content-type": "application/json", "X-M2-Role": "doctor", "X-M2-Actor": actor }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) })
    .catch(() => { throw new HttpError(502, "Farm operations (Module 2) is not reachable", "m2_down"); });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status === 404 ? 404 : 400, j?.error?.message || j?.detail || `Module 2 ${res.status}`, "m2_error");
  return j;
}

/**
 * Advisory API.
 *   Farmers:     /me (dashboard data), /me/items/:id (detail), /me/items/:id/actions (acknowledge / complete / reopen / request_help),
 *                /me/items/:id/evidence/:n (their photos)
 *   Agronomist:  /agronomist (queues), /items/:id/review (approve / reject / guidance), /items/:id/verify, /items/:id/help,
 *                /farmers/:id/inspections (schedule), /farmers/:id/inspections/:visitId (record result)
 *   Operations:  /farmers, /farmers/:id (read-only for FPO and admin desks), /run (admin)
 */
export default function advisoryModule({ ml, weather, notifier, messenger }) {
  const r = Router();
  r.use(requireAuth());
  const deps = () => ({ ml, weather: weather || currentWeather, notifier, messenger });
  const farmerOnly = (req) => { if (req.auth.role !== "farmer") throw new HttpError(403, "Farmers only", "forbidden"); };
  const langOf = async (req) => LANG.catch((await User.findById(req.auth.id).select("lang"))?.lang || "en").parse(req.query.lang);

  // ---------- farmer
  r.get("/me", wrap(async (req, res) => {
    farmerOnly(req);
    const a = await svc.forFarmer(req.auth.id, deps(), { refresh: req.query.refresh === "1" });
    res.json(svc.present(a, await langOf(req)));
  }));
  r.get("/me/items/:itemId", wrap(async (req, res) => {
    farmerOnly(req);
    const a = await svc.Advisory.findOne({ farmer: req.auth.id });
    const p = svc.present(a || { items: [] }, await langOf(req));
    const it = p.items.find((i) => i.itemId === req.params.itemId);
    if (!it) throw new HttpError(404, "Recommendation not found", "not_found");
    res.json({ item: it, history: p.items.filter((i) => i.key === it.key && i.itemId !== it.itemId), snapshots: p.snapshots });
  }));
  r.post("/me/items/:itemId/actions", wrap(async (req, res) => {
    farmerOnly(req);
    const b = z.object({ action: z.enum(["acknowledge", "complete", "reopen", "request_help"]), note: z.string().max(500).optional(),
      photos: z.array(z.object({ dataBase64: z.string() })).max(3).optional() }).parse(req.body);
    const a = await svc.farmerAction(req.auth.id, req.params.itemId, b, deps());
    res.json(svc.present(a, await langOf(req)));
  }));
  // compatibility with the first advisory version
  r.patch("/me/items/:key", wrap(async (req, res) => {
    farmerOnly(req);
    const a = await svc.Advisory.findOne({ farmer: req.auth.id });
    const it = a?.items.find((i) => i.key === req.params.key && ["open", "acknowledged", "completed"].includes(i.status));
    if (!it) throw new HttpError(404, "Recommendation not found", "not_found");
    const action = req.body?.status === "done" ? "complete" : "reopen";
    res.json(svc.present(await svc.farmerAction(req.auth.id, it.itemId, { action }, deps()), await langOf(req)));
  }));
  r.get("/items/:itemId/evidence/:n", wrap(async (req, res) => {
    const { a, it } = await svc.findItem(req.params.itemId);
    if (req.auth.role === "farmer" && String(a.farmer) !== req.auth.id) throw new HttpError(404, "Not found", "not_found");
    if (req.auth.role === "operations") { const d = await deskOf(req.auth); if (d.role !== "admin" && d.fpoId !== a.fpoId) throw new HttpError(404, "Not found", "not_found"); }
    if (req.auth.role === "buyer") throw new HttpError(403, "Forbidden", "forbidden");
    const e = (it.farmerEvidence || []).find((x) => x.n === Number(req.params.n));
    if (!e) throw new HttpError(404, "Photo not found", "not_found");
    res.set({ "content-type": e.mime, "x-sha256": e.sha256, "cache-control": "private, max-age=3600" }).send(await svc.evidenceStore().get(e.key));
  }));

  // ---------- operations desks
  const opsDesk = async (req) => {
    if (req.auth.role !== "operations") throw new HttpError(403, "Operations only", "forbidden");
    return deskOf(req.auth);
  };
  const scopedFarmers = async (d) => (await User.find({ role: "farmer", farm: { $exists: true } }).select("name farm lang mobile notify"))
    .filter((f) => d.role === "admin" || m2Id.fpo(f.farm) === d.fpoId);

  r.get("/farmers", wrap(async (req, res) => {
    const d = await opsDesk(req);
    const farmers = await scopedFarmers(d);
    const ads = await svc.Advisory.find({ farmer: { $in: farmers.map((f) => f._id) } });
    res.json(farmers.map((f) => {
      const a = ads.find((x) => String(x.farmer) === String(f._id));
      const its = a?.items || [];
      return { id: f._id, name: f.name, village: f.farm.village, district: f.farm.district, lang: f.lang, generatedAt: a?.generatedAt || null,
        active: its.filter((i) => ["open", "acknowledged"].includes(i.status)).length, awaitingApproval: its.filter((i) => i.status === "pending_approval").length,
        toVerify: its.filter((i) => i.status === "completed").length, help: its.filter((i) => (i.assistance || []).some((x) => x.status === "open")).length,
        high: its.filter((i) => ["open", "acknowledged", "pending_approval"].includes(i.status) && i.severity === "high").length,
        nextVisit: a?.status?.visits?.[0]?.at || null };
    }));
  }));
  r.get("/farmers/:id", wrap(async (req, res) => {
    const d = await opsDesk(req);
    const f = (await scopedFarmers(d)).find((x) => String(x._id) === req.params.id);
    if (!f) throw new HttpError(404, "Farmer not found", "not_found");
    const a = await svc.forFarmer(f._id, deps(), { refresh: req.query.refresh === "1" });
    res.json({ farmer: { id: f._id, name: f.name, village: f.farm.village, district: f.farm.district, lang: f.lang, notify: f.notify },
      canAct: d.role === "doctor", ...svc.present(a, LANG.catch("en").parse(req.query.lang), { role: "agronomist" }) });
  }));

  /** Agronomist workspace: everything waiting for this farmer doctor. */
  r.get("/agronomist", wrap(async (req, res) => {
    const d = await opsDesk(req);
    const farmers = await scopedFarmers(d);
    const ads = await svc.Advisory.find({ farmer: { $in: farmers.map((f) => f._id) } });
    const name = (id) => farmers.find((f) => String(f._id) === String(id))?.name;
    const pick = (pred) => ads.flatMap((a) => a.items.filter(pred).map((i) => ({ ...svc.present({ items: [i] }, "en", { role: "agronomist" }).items[0], farmerId: a.farmer, farmer: name(a.farmer) })));
    res.json({
      desk: { role: d.role, name: d.name, canAct: d.role === "doctor" },
      approvals: pick((i) => i.status === "pending_approval"),
      verifications: pick((i) => i.status === "completed"),
      help: pick((i) => (i.assistance || []).some((x) => x.status === "open")),
      visits: ads.flatMap((a) => (a.status?.visits || []).map((v) => ({ ...v, farmerId: a.farmer, farmer: name(a.farmer) }))).sort((x, y) => new Date(x.at) - new Date(y.at)),
      farmers: farmers.length,
    });
  }));
  r.post("/items/:itemId/review", wrap(async (req, res) => {
    const d = await opsDesk(req);
    const b = z.object({ decision: z.enum(["approve", "reject", "guidance"]), note: z.string().max(1000).optional(), guidance: z.string().max(1500).optional(),
      dueDate: z.string().optional(), followUpDate: z.string().optional() }).parse(req.body);
    await svc.review(req.params.itemId, d, b, deps());
    res.json({ ok: true });
  }));
  r.post("/items/:itemId/verify", wrap(async (req, res) => {
    const d = await opsDesk(req);
    const b = z.object({ result: z.enum(["verified", "not_effective"]), note: z.string().max(1000).optional() }).parse(req.body);
    await svc.verify(req.params.itemId, d, b, deps());
    res.json({ ok: true });
  }));
  r.post("/items/:itemId/help", wrap(async (req, res) => {
    const d = await opsDesk(req);
    await svc.answerHelp(req.params.itemId, d, z.object({ response: z.string().min(3).max(1000) }).parse(req.body), deps());
    res.json({ ok: true });
  }));
  r.post("/farmers/:id/inspections", wrap(async (req, res) => {
    const d = await opsDesk(req);
    if (d.role !== "doctor") throw new HttpError(403, "Only a farmer doctor schedules inspections", "forbidden");
    const f = (await scopedFarmers(d)).find((x) => String(x._id) === req.params.id);
    if (!f) throw new HttpError(404, "Farmer not found", "not_found");
    const b = z.object({ dueAt: z.string().optional(), note: z.string().max(300).optional() }).parse(req.body);
    const v = await m2AsDoctor("POST", "/doctor-visits", { farmer_id: m2Id.farmer(String(f._id)), due_at: b.dueAt || undefined, note: b.note || "Follow-up inspection for advisory" }, d.actor);
    await svc.generate(f._id, deps());
    res.status(201).json(v);
  }));
  r.post("/farmers/:id/inspections/:visitId", wrap(async (req, res) => {
    const d = await opsDesk(req);
    if (d.role !== "doctor") throw new HttpError(403, "Only a farmer doctor records inspections", "forbidden");
    const f = (await scopedFarmers(d)).find((x) => String(x._id) === req.params.id);
    if (!f) throw new HttpError(404, "Farmer not found", "not_found");
    const b = z.object({ grade: z.enum(["A", "B", "REJECT"]), observed_defect_pct: z.number().min(0).max(100).optional(), pest_signs: z.array(z.string()).optional(),
      cleared_flags: z.array(z.string()).optional(), observations: z.string().max(1000).optional(), recommendations: z.array(z.string().max(300)).max(10).optional(),
      fruit_inspected: z.number().int().min(0).max(10000).optional() }).parse(req.body);
    const out = await m2AsDoctor("POST", `/doctor-visits/${encodeURIComponent(req.params.visitId)}/complete`, b, d.actor);
    const a = await svc.generate(f._id, { ...deps(), latestVisitId: req.params.visitId });   // new inspection -> compare -> update recommendations
    res.json({ visit: out.visit, snapshot: a.snapshots[a.snapshots.length - 1], comparisons: a.items.flatMap((i) => i.comparisons || []).slice(-3) });
  }));
  r.post("/run", wrap(async (req, res) => {
    const d = await opsDesk(req);
    if (d.role !== "admin") throw new HttpError(403, "AgriLink operations only", "forbidden");
    res.json({ farmers: await svc.generateAll(deps()), reminders: await svc.runReminders(deps()) });
  }));
  return { path: "/advisory", router: r };
}
