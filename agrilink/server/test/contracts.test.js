// Digital agreement lifecycle: create from commitment → edit → send → OTP + sign (both) → signed PDF → chain → verify.
// Uses an in-memory chain with the same rules as AgreementRegistry.sol and a temp write-once store.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { createApp } from "../src/app.js";
import { seedIfEmpty } from "../src/seed.js";
import { createNotifier } from "../src/modules/notifications/notifier.js";
import { createStore } from "../src/modules/contracts/storage.js";
import { agreementRef } from "../src/modules/contracts/chain.js";

function fakeChain() {
  const versions = new Map(), byHash = new Map();
  let block = 100;
  const h = (x) => "0x" + x.replace(/^0x/, "");
  return {
    async info() { return { chainId: 31337, network: "Test chain", contract: "0xC0FFEE", registrar: "0xREG", explorer: null, block }; },
    async ensureDeployed() { return { redeployed: false }; },
    async register(id, sha, version) {
      const ref = agreementRef(id), list = versions.get(ref) || [];
      if (version !== list.length + 1) throw new Error("WrongVersion");
      if (byHash.has(h(sha))) throw new Error("HashAlreadyRegistered");
      const rec = { docHash: h(sha), prevDocHash: list.length ? list[list.length - 1].docHash : "0x" + "0".repeat(64), version, registeredAt: new Date(), registrar: "0xREG" };
      list.push(rec); versions.set(ref, list); byHash.set(h(sha), { agreementRef: ref, version });
      block++;
      return { status: "registered", network: "Test chain", chainId: 31337, contract: "0xC0FFEE", agreementRef: ref, docHash: h(sha), version,
        txHash: "0x" + createHash("sha256").update(sha).digest("hex"), blockNumber: block, registeredAt: rec.registeredAt, registrar: "0xREG", prevDocHash: rec.prevDocHash };
    },
    async lookup(sha) { return byHash.get(h(sha)) || null; },
    async latest(id) { const l = versions.get(agreementRef(id)); return l?.length ? l[l.length - 1] : null; },
    async getVersion(id, v) { return versions.get(agreementRef(id))[v - 1]; },
  };
}

const fakeMl = {
  price: async () => ({ season_avg: 430, mandi_price: 344, harvest_window: { start: "Mar W4", end: "May W1", avg_price: 470, drop_pct: 22 } }),
  evaluate: async (d, offers) => offers.map((o) => ({ id: o.id, offer_inr: 440, fair_offer_inr: 430, farmer_net_inr: 395, market_net_inr: 300,
    verdict: { status: "fair", pct: 1 }, vs_mandi_pct: 30, decision: "accept", week_label: "May W2", market_price_inr: 345, market_range_inr: [300, 400] })),
  mandi: async () => ({ source: "unavailable" }),
};

let server, base, tmp;
const handed = [];
const api = async (p, { method = "GET", token, body } = {}) => {
  const res = await fetch(base + "/api" + p, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  const ct = res.headers.get("content-type") || "";
  return { status: res.status, body: ct.includes("pdf") ? Buffer.from(await res.arrayBuffer()) : await res.json(), headers: res.headers };
};
const login = async (mobile, role, extra = {}) => (await api("/auth/verify", { method: "POST", body: { mobile, otp: "1234", role, ...extra } })).body;

before(async () => {
  await mongoose.connect((process.env.MONGO_URI || "mongodb://127.0.0.1:27017/agrilink_test").replace(/agrilink_test$/, "agrilink_test_contracts"));
  await mongoose.connection.dropDatabase();
  await seedIfEmpty();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agl-"));
  server = createApp({ ml: fakeMl, notifier: createNotifier(null), contractDeps: { chain: fakeChain(), store: createStore(tmp), handoff: async (a) => { handed.push(a.agreementId); return { status: "handed_over", at: new Date(), m2AgreementId: a.agreementId }; } } }).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await mongoose.disconnect(); fs.rmSync(tmp, { recursive: true, force: true }); });

test("full agreement lifecycle with tamper detection", async () => {
  const f = await login("9876543210", "farmer");
  await api("/farmers/me", { method: "PUT", token: f.token, body: { name: "Ramesh Patil", farm: { village: "Devgad", district: "Sindhudurg", acres: 6, trees: 300, age: 15, irrigation: "drip", fpo: "Devgad Growers FPO" } } });
  const reqs = (await api("/requirements?grade=A", { token: f.token })).body;
  const target = reqs.find((r) => r.buyerName.startsWith("FairPrice"));

  // commitment → draft agreement created automatically
  const bond = (await api("/bonds", { method: "POST", token: f.token, body: { requirementId: target._id, tons: 2 } })).body;
  const list = (await api("/contracts", { token: f.token })).body;
  assert.equal(list.items.length, 1);
  const a0 = list.items[0];
  assert.match(a0.agreementId, /^AGL-\d{4}-\d{5}$/);
  assert.equal(a0.status, "draft");
  assert.equal(a0.terms.totalValueUsd, 2 * 1000 * target.priceUsd);
  const id = a0.agreementId;

  // buyer edits terms (draft only), milestones must sum to 100
  const buyer = await login("6500000001", "buyer");
  assert.equal((await api(`/contracts/${id}/terms`, { method: "PUT", token: buyer.token, body: { paymentMilestones: [{ label: "x", pct: 50 }] } })).status, 400);
  const ed = await api(`/contracts/${id}/terms`, { method: "PUT", token: buyer.token, body: { quantityTons: 1.5, packaging: "Custom 4 kg cartons" } });
  assert.equal(ed.body.terms.totalValueUsd, 1.5 * 1000 * target.priceUsd);

  // outsiders cannot see it
  const stranger = await login("6511111111", "buyer", { company: "Other" });
  assert.equal((await api(`/contracts/${id}`, { token: stranger.token })).status, 404);

  // send → draft PDF stored write-once
  const sent = await api(`/contracts/${id}/send`, { method: "POST", token: buyer.token });
  assert.equal(sent.body.status, "pending_signature");
  assert.equal((await api(`/contracts/${id}/terms`, { method: "PUT", token: buyer.token, body: { packaging: "x" } })).status, 409);
  const draftPdf = await api(`/contracts/${id}/document?kind=draft`, { token: f.token });
  assert.equal(draftPdf.body.subarray(0, 5).toString(), "%PDF-");

  // signing requires OTP identity + consent; a plain "accept" is rejected
  assert.equal((await api(`/contracts/${id}/sign`, { method: "POST", token: buyer.token, body: { type: "typed", typedName: "Buyer Name", consent: true } })).body.error, "identity_required");
  await api(`/contracts/${id}/sign/start`, { method: "POST", token: buyer.token });
  assert.equal((await api(`/contracts/${id}/sign/verify`, { method: "POST", token: buyer.token, body: { otp: "0000" } })).status, 401);
  await api(`/contracts/${id}/sign/verify`, { method: "POST", token: buyer.token, body: { otp: "1234" } });
  assert.equal((await api(`/contracts/${id}/sign`, { method: "POST", token: buyer.token, body: { type: "typed", typedName: "Buyer Name" } })).status, 400);
  const b1 = await api(`/contracts/${id}/sign`, { method: "POST", token: buyer.token, body: { type: "typed", typedName: "Buyer Name", consent: true } });
  assert.equal(b1.body.status, "pending_signature");
  assert.match(b1.body.signers.find((s) => s.role === "buyer").signature.certificateId, /^SIG-/);

  await api(`/contracts/${id}/sign/start`, { method: "POST", token: f.token });
  await api(`/contracts/${id}/sign/verify`, { method: "POST", token: f.token, body: { otp: "1234" } });
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const done = (await api(`/contracts/${id}/sign`, { method: "POST", token: f.token, body: { type: "drawn", image: png, consent: true } })).body;
  assert.equal(done.status, "registered");
  assert.equal(done.chain.status, "registered");
  assert.ok(done.chain.txHash && done.chain.blockNumber);
  assert.ok(done.auditIntact);
  assert.deepEqual(handed, [id]);                       // handed to Module 2 once registered
  assert.equal(done.module2.status, "handed_over");

  // commitment became binding
  const r2 = (await api("/requirements?grade=A", { token: f.token })).body.find((r) => r._id === target._id);
  assert.equal(r2.filled, target.filled + 2);

  // verify: the real signed PDF matches; a modified copy does not
  const signedPdf = await api(`/contracts/${id}/document`, { token: buyer.token });
  const sha = createHash("sha256").update(signedPdf.body).digest("hex");
  assert.equal(signedPdf.headers.get("x-sha256"), sha);
  const ok = (await api("/contracts/verify", { method: "POST", token: stranger.token, body: { sha256: sha } })).body;
  assert.equal(ok.result, "verified");
  assert.equal(ok.agreementId, id);
  assert.equal(ok.version, 1);
  const tampered = Buffer.concat([signedPdf.body, Buffer.from(" ")]);
  const bad = (await api("/contracts/verify", { method: "POST", token: buyer.token, body: { sha256: createHash("sha256").update(tampered).digest("hex"), agreementId: id } })).body;
  assert.equal(bad.result, "mismatch");
  assert.equal(bad.expected.docHash, "0x" + sha);

  // milestones in order, by the right role
  assert.equal((await api(`/contracts/${id}/milestones`, { method: "POST", token: f.token, body: { key: "packing_completed" } })).body.error, "out_of_order");
  assert.equal((await api(`/contracts/${id}/milestones`, { method: "POST", token: buyer.token, body: { key: "harvest_completed" } })).status, 403);
  const m1 = await api(`/contracts/${id}/milestones`, { method: "POST", token: f.token, body: { key: "harvest_completed", note: "Picked 1.5 t" } });
  assert.equal(m1.body.status, "in_progress");

  // amendment: new version, re-sign, original preserved and still verifiable
  const am = (await api(`/contracts/${id}/amend`, { method: "POST", token: buyer.token, body: { reason: "Price revised after escalation clause", changes: { priceUsdPerKg: 5.4 } } })).body;
  assert.equal(am.version, 2);
  assert.equal(am.status, "draft");
  assert.equal(am.history[0].chain.status, "registered");
  await api(`/contracts/${id}/send`, { method: "POST", token: buyer.token });
  for (const t of [buyer.token, f.token]) {
    await api(`/contracts/${id}/sign/start`, { method: "POST", token: t });
    await api(`/contracts/${id}/sign/verify`, { method: "POST", token: t, body: { otp: "1234" } });
    await api(`/contracts/${id}/sign`, { method: "POST", token: t, body: { type: "typed", typedName: "Signer Name", consent: true } });
  }
  const v2 = (await api(`/contracts/${id}`, { token: f.token })).body;
  assert.equal(v2.status, "registered");
  assert.equal(v2.chain.version, 2);
  assert.equal(v2.chain.prevDocHash, "0x" + sha);       // amendment linked to the original on-chain
  const old = (await api("/contracts/verify", { method: "POST", token: f.token, body: { sha256: sha } })).body;
  assert.equal(old.result, "verified");
  assert.equal(old.isLatest, false);                    // original still provable, but superseded
  const v1pdf = await api(`/contracts/${id}/document?version=1`, { token: f.token });
  assert.equal(createHash("sha256").update(v1pdf.body).digest("hex"), sha); // never overwritten

  // audit trail is hash-chained and intact
  const audit = (await api(`/contracts/${id}/audit`, { token: f.token })).body;
  assert.equal(audit.intact, true);
  assert.ok(audit.entries.some((e) => e.action === "registered_on_chain"));

  // dashboard stats
  const st = (await api("/contracts", { token: buyer.token })).body.stats;
  assert.equal(st.total, 1);
  assert.equal(st.verified, 1);
});

test("write-once store refuses to overwrite", async () => {
  const s = createStore(tmp);
  await s.putOnce("X/v1-signed.pdf", Buffer.from("a"));
  await assert.rejects(() => s.putOnce("X/v1-signed.pdf", Buffer.from("b")), /EEXIST/);
});
