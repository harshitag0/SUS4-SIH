import { Router } from "express";
import { z } from "zod";
import { HttpError, wrap } from "../../lib/http.js";
import { requireAuth } from "../../middleware/auth.js";
import { Agreement } from "./model.js";
import { Bond } from "../bonds/model.js";
import { Requirement } from "../requirements/model.js";
import { verifyAudit } from "./audit.js";
import { PROVIDERS, getProvider } from "./esign/index.js";
import * as svc from "./service.js";
import { handToModule2 } from "../module2/handoff.js";
import { appendAudit } from "./audit.js";

/**
 * Digital agreements: create → edit (draft) → send → OTP identity + e-signature (both parties) → signed PDF (write-once)
 * → SHA-256 registered on Polygon → lifecycle milestones → amendments (new version, re-sign) → verify integrity.
 */
export default function contractsModule({ notifier, contractDeps }) {
  const r = Router();
  r.use(requireAuth());
  const deps = () => contractDeps; // { store, chain }
  const meta = (req) => ({ ip: req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress, userAgent: req.headers["user-agent"] });
  const other = (a, role) => (role === "buyer" ? a.farmer : a.buyer);
  const notify = (users, type, a, extra = {}) => notifier.toUsers(users, type, { agreementId: a.agreementId, version: a.version, ...extra });

  /** When both signed and on-chain: the commitment becomes binding (bond active, requirement filled) — first version only. */
  const onRegistered = async (a) => {
    if (a.version === 1 && a.bond) {
      const bond = await Bond.findById(a.bond);
      if (bond && bond.status !== "active") {
        bond.status = "active";
        await bond.save();
        await Requirement.updateOne({ _id: bond.requirement }, { $inc: { filled: bond.tons } });
      }
    }
    await notify([a.buyer, a.farmer], "contract_registered", a, { txHash: a.chain.txHash, block: a.chain.blockNumber });
    if (a.version === 1) await handoff(a);
    notifier.changed("bonds", "requirements", "contracts");
  };

  /** Module 1 → Module 2: activated agreement goes to farm management & supply assurance. Never blocks signing. */
  async function handoff(a) {
    try { a.module2 = await (contractDeps.handoff || handToModule2)(a); }
    catch (e) { a.module2 = { status: "failed", at: new Date(), error: String(e.message).slice(0, 200) }; }
    a.markModified("module2");
    appendAudit(a, { actorRole: "system", actorName: "AgriLink", action: `module2_${a.module2.status}`, details: a.module2.error ? { error: a.module2.error } : { m2AgreementId: a.module2.m2AgreementId } });
  }

  r.get("/", wrap(async (req, res) => {
    const scope = req.auth.role === "operations" ? {} : { [req.auth.role === "farmer" ? "farmer" : "buyer"]: req.auth.id };
    const list = await Agreement.find(scope).sort({ updatedAt: -1 });
    const activity = list.flatMap((a) => a.audit.slice(-6).map((e) => ({ agreementId: a.agreementId, at: e.at, action: e.action, actorName: e.actorName, actorRole: e.actorRole })))
      .sort((x, y) => new Date(y.at) - new Date(x.at)).slice(0, 12);
    res.json({ stats: svc.stats(list, req.auth.id), activity, items: list.map(svc.publicView) });
  }));

  r.get("/meta", wrap(async (_req, res) => {
    let chain = null;
    try { chain = await deps().chain.info(); } catch (e) { chain = { error: String(e.message).slice(0, 200) }; }
    res.json({ chain, esign: { active: getProvider().name, providers: PROVIDERS }, lifecycle: svc.LIFECYCLE, manual: svc.MANUAL,
      storage: { kind: process.env.AWS_S3_BUCKET ? "AWS S3 (versioned, Object Lock)" : "Local write-once store (S3 stand-in)" } });
  }));

  // Hash-only verification: the browser computes SHA-256 locally, the file never leaves the device
  r.post("/verify", wrap(async (req, res) => {
    const { sha256, agreementId } = z.object({ sha256: z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/), agreementId: z.string().optional() }).parse(req.body);
    res.json(await svc.verifyHash(sha256.replace(/^0x/, "").toLowerCase(), agreementId, deps().chain));
  }));

  r.post("/from-bond/:bondId", wrap(async (req, res) => {
    const bond = await Bond.findById(req.params.bondId);
    if (!bond || ![String(bond.buyer), String(bond.farmer)].includes(req.auth.id)) throw new HttpError(404, "Commitment not found");
    res.status(201).json(svc.publicView(await svc.createFromBond(bond._id)));
  }));

  r.get("/:id", wrap(async (req, res) => {
    const a = await svc.loadFor(req.params.id, req.auth, { read: true });
    res.json({ ...svc.publicView(a), myRole: req.auth.role });
  }));

  r.get("/:id/audit", wrap(async (req, res) => {
    const a = await svc.loadFor(req.params.id, req.auth, { read: true });
    res.json({ ...verifyAudit(a.audit), entries: a.audit });
  }));

  r.get("/:id/document", wrap(async (req, res) => {
    const a = await svc.loadFor(req.params.id, req.auth, { read: true });
    const version = Number(req.query.version || a.version), kind = req.query.kind === "draft" ? "draft" : "signed";
    const docs = [...a.documents, ...a.history.flatMap((h) => h.documents)].filter((d) => d.version === version && d.kind === kind);
    const doc = docs[docs.length - 1];
    if (!doc) throw new HttpError(404, "Document not available yet", "no_document");
    const buf = await deps().store.get(doc.key);
    res.set({ "content-type": "application/pdf", "content-disposition": `inline; filename="${a.agreementId}-v${version}-${kind}.pdf"`, "x-sha256": doc.sha256 });
    res.send(buf);
  }));

  const mutate = (fn) => wrap(async (req, res) => {
    const a = await svc.loadFor(req.params.id, req.auth);
    const out = await fn(a, req);
    await a.save();
    notifier.changed("contracts");
    res.json({ ...svc.publicView(a), myRole: req.auth.role, ...(out && typeof out === "object" ? { result: out } : {}) });
  });

  r.put("/:id/terms", mutate((a, req) => svc.updateTerms(a, req.auth, req.body || {})));

  r.post("/:id/send", mutate(async (a, req) => {
    const put = await svc.sendForSignature(a, req.auth, deps().store);
    await notify([a.buyer, a.farmer], "contract_sign_request", a);
    return { draftSha256: put.sha256 };
  }));

  r.post("/:id/sign/start", mutate((a, req) => svc.startIdentity(a, req.auth)));
  r.post("/:id/sign/verify", mutate((a, req) => svc.verifyIdentity(a, req.auth, z.object({ otp: z.string() }).parse(req.body).otp)));
  r.post("/:id/sign", mutate(async (a, req) => {
    const body = z.object({
      type: z.enum(["typed", "drawn"]), typedName: z.string().optional(), image: z.string().optional(), consent: z.literal(true),
    }).parse(req.body);
    await svc.sign(a, req.auth, body, meta(req), { ...deps(), onRegistered });
    if (a.status === "pending_signature") await notify([other(a, req.auth.role)], "contract_signed_by", a, { by: req.auth.role });
  }));
  r.post("/:id/decline", mutate(async (a, req) => {
    svc.decline(a, req.auth, req.body?.reason);
    await notify([other(a, req.auth.role)], "contract_declined", a, { by: req.auth.role });
  }));
  r.post("/:id/retry-chain", mutate(async (a) => {
    const signed = a.documents.find((d) => d.version === a.version && d.kind === "signed");
    if (!signed || a.chain?.status === "registered") throw new HttpError(409, "Nothing to register", "nothing");
    await svc.registerOnChain(a, signed, { ...deps(), onRegistered });
  }));
  r.post("/:id/handoff", mutate(async (a) => {
    if (a.chain?.status !== "registered" && !a.history.length) throw new HttpError(409, "Register the agreement first", "not_registered");
    await handoff(a);
  }));
  r.post("/:id/amend", mutate(async (a, req) => {
    const { changes, reason } = z.object({ changes: z.record(z.any()).default({}), reason: z.string() }).parse(req.body);
    svc.amend(a, req.auth, changes, reason);
    await notify([other(a, req.auth.role)], "contract_amended", a, { by: req.auth.role });
  }));
  r.post("/:id/milestones", mutate(async (a, req) => {
    const { key, note } = z.object({ key: z.string(), note: z.string().max(300).optional() }).parse(req.body);
    svc.recordMilestone(a, req.auth, key, note);
    await notify([other(a, req.auth.role)], "contract_milestone", a, { key });
  }));
  r.post("/:id/dispute", mutate(async (a, req) => {
    svc.raiseDispute(a, req.auth, req.body?.reason);
    await notify([other(a, req.auth.role)], "contract_disputed", a, { by: req.auth.role });
  }));
  r.post("/:id/dispute/resolve", mutate((a, req) => svc.resolveDispute(a, req.auth, req.body?.note)));

  return { path: "/contracts", router: r };
}
