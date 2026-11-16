import { Router } from "express";
import { z } from "zod";
import QRCode from "qrcode";
import { HttpError, wrap } from "../../lib/http.js";
import { requireAuth } from "../../middleware/auth.js";
import { Certificate } from "./model.js";
import * as svc from "./service.js";

/** Notify the buyer and every grower (Module 1 users) about a certificate event. */
function makeNotify(notifier) {
  return async (cert, type) => {
    const to = [cert.buyer?.userId, ...cert.farmers.map((f) => f.userId)].filter(Boolean);
    if (to.length) await notifier?.toUsers?.(to, type, { certificateId: cert.certificateId, lotId: cert.lotId, agreementId: cert.agreementId });
    notifier?.changed?.("certificates");
  };
}

const scopeFor = (auth) => (auth.role === "farmer" ? { "farmers.userId": auth.id } : auth.role === "buyer" ? { "buyer.userId": auth.id } : {});

/** Signed-in: farmers and buyers see their own certificates; operations issue, revoke and see all. */
export { makeNotify };

export default function certificatesModule({ notifier, contractDeps, certDeps }) {
  const r = Router();
  r.use(requireAuth());
  const deps = () => ({ chain: contractDeps?.chain, store: svc.certStore(certDeps), notify: makeNotify(notifier) });
  const ops = (req) => { if (req.auth.role !== "operations") throw new HttpError(403, "Operations only", "forbidden"); };
  const load = async (req) => {
    const c = await Certificate.findOne({ certificateId: req.params.id, ...scopeFor(req.auth) });
    if (!c) throw new HttpError(404, "Certificate not found", "not_found");
    return c;
  };

  r.get("/", wrap(async (req, res) => {
    const list = await Certificate.find(scopeFor(req.auth)).sort({ createdAt: -1 }).limit(200);
    const now = new Date();
    const items = await Promise.all(list.map(async (c) => ({
      certificateId: c.certificateId, kind: c.kind || "lot", stage: c.stage?.key ? c.stage : null, cropId: c.cropId, batchId: c.batchId, lotId: c.lotId, agreementId: c.agreementId, buyer: c.buyer.name, fpo: c.fpo.name,
      product: c.product, totalKg: c.totalKg, gradeMix: c.gradeMix, growers: c.farmers.length, issuedAt: c.issuedAt, validUntil: c.validUntil,
      status: c.status, liveStatus: await svc.statusOf(c), chain: c.chain?.status || "pending",
      myKg: req.auth.role === "farmer" ? c.farmers.find((f) => String(f.userId) === req.auth.id)?.kg : undefined,
    })));
    res.json({ items, at: now });
  }));

  r.get("/lots", wrap(async (req, res) => { ops(req); res.json(await svc.lotsOverview(await svc.opsActor(req.auth))); }));

  r.get("/eligibility/:lotId", wrap(async (req, res) => {
    ops(req);
    const { _gathered, ...e } = await svc.eligibility(req.params.lotId);
    res.json(e);
  }));

  r.post("/", wrap(async (req, res) => {
    ops(req);
    const { lotId } = z.object({ lotId: z.string().min(3) }).parse(req.body);
    const c = await svc.issue(lotId, req.auth, deps());
    res.status(201).json(await svc.view(c));
  }));

  r.get("/:id", wrap(async (req, res) => res.json(await svc.view(await load(req)))));

  r.get("/:id/document", wrap(async (req, res) => {
    const c = await load(req);
    const v = Number(req.query.version || 1);
    const d = c.documents.find((x) => x.version === v);
    if (!d) throw new HttpError(404, "Document not found", "not_found");
    const buf = await deps().store.get(d.key);
    res.set({ "content-type": "application/pdf", "content-disposition": `inline; filename="${c.certificateId}-v${v}.pdf"`, "x-sha256": d.sha256 }).send(buf);
  }));

  r.post("/:id/revoke", wrap(async (req, res) => {
    ops(req);
    const { reason } = z.object({ reason: z.string().trim().min(5).max(500) }).parse(req.body);
    res.json(await svc.view(await svc.revoke(await load(req), reason, req.auth, deps())));
  }));

  r.post("/:id/retry-chain", wrap(async (req, res) => { ops(req); res.json(await svc.view(await svc.retryChain(await load(req), deps()))); }));

  return { path: "/certificates", router: r };
}

/** Public (no login): what a buyer, customs agent or retailer sees after scanning the QR code. */
export function publicCertificatesModule({ contractDeps, certDeps }) {
  const r = Router();
  r.get("/", wrap(async (req, res) => {
    const lotId = z.string().min(3).max(40).parse(req.query.lot);
    const list = await Certificate.find({ lotId, kind: { $ne: "stage" } }).sort({ createdAt: -1 }).limit(5);
    res.json(await Promise.all(list.map(async (c) => ({ certificateId: c.certificateId, status: await svc.statusOf(c) }))));
  }));
  r.post("/verify", wrap(async (req, res) => {
    const { sha256 } = z.object({ sha256: z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/) }).parse(req.body);
    res.json(await svc.verifyHash(sha256.replace(/^0x/, "").toLowerCase(), contractDeps?.chain));
  }));
  r.get("/:id", wrap(async (req, res) => {
    const c = await Certificate.findOne({ certificateId: req.params.id });
    if (!c) throw new HttpError(404, "Certificate not found", "not_found");
    res.json(await svc.publicView(c));
  }));
  r.get("/:id/qr.svg", wrap(async (req, res) => {
    const c = await Certificate.findOne({ certificateId: req.params.id });
    if (!c) throw new HttpError(404, "Certificate not found", "not_found");
    res.type("image/svg+xml").send(await QRCode.toString(svc.verifyUrl(c.certificateId), { type: "svg", margin: 1, color: { dark: "#0f2419", light: "#ffffff" } }));
  }));
  r.get("/:id/document", wrap(async (req, res) => {
    const c = await Certificate.findOne({ certificateId: req.params.id });
    const d = c?.documents.find((x) => x.version === 1);
    if (!d) throw new HttpError(404, "Certificate not found", "not_found");
    const buf = await svc.certStore(certDeps).get(d.key);
    res.set({ "content-type": "application/pdf", "content-disposition": `inline; filename="${c.certificateId}.pdf"`, "x-sha256": d.sha256 }).send(buf);
  }));
  return { path: "/public/certificates", router: r };
}
