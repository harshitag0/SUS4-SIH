// Crop Quality Certification: eligibility from farm-operations evidence, issue (PDF + write-once store + chain),
// role scoping, public verification by id and by file hash, revocation, and who may issue.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createHash } from "node:crypto";
import mongoose from "mongoose";

const LOT = "LOT-TEST0001", AID = "AGL-2027-00042";
let farmerUser, buyerUser, passStatus = "PASS";

// fake Module 2: one agreement with one lot from one grower whose quality passed
const m2 = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const json = (code, b) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
  const p = u.pathname.replace(/^\/api\/m2/, "");
  const lot = { id: LOT, agreement_id: AID, fpo_id: "FPO-DEV", status: "COLLECTED", total_kg: 1800, grade_mix: { A: 1800 }, collected_at: "2027-04-20T05:00:00Z",
    contributions: [{ farmer_id: `AGL-F-${farmerUser}`, farmer_name: "Ramesh Patil", commitment_id: "CMT-1", kg: 1800, grade: "A" }] };
  if (p === "/system/clock") return json(200, { now: "2027-04-21T05:00:00Z", simulated: true });
  if (p === `/trace/lots/${LOT}`) return json(200, { lot, agreement: { id: AID, buyer: "FairPrice Fresh", crop: "Mango", variety: "Alphonso", required_grade: "A" },
    fpo: "Devgad Growers FPO", events: [{ stage: "QUALITY_PASS" }, { stage: "DOCTOR_INSPECTION" }], chain: { ok: true, checked: 40, head: "ab".repeat(32) } });
  if (p.startsWith("/trace/lots/")) return json(404, { error: "not found" });
  if (p === `/agreements/${AID}`) return json(200, { id: AID, buyer_id: `AGL-B-${buyerUser}`, buyer_name: "FairPrice Fresh", required_grade: "A", lots: [lot],
    fpos: [{ id: "FPO-DEV", name: "Devgad Growers FPO" }], commitments: [{ id: "CMT-1", quality_status: passStatus, final_grade: "A" }] });
  if (p === "/agreements") return json(200, [{ id: AID }]);
  if (p === "/quality-reviews") return json(200, passStatus === "PASS" ? [{ id: "QR-1", status: "PASS", final_grade: "A", source: "doctor", created_at: "2027-04-15T05:00:00Z" }] : []);
  if (p === "/doctor-visits") return json(200, [{ id: "VIS-1", doctor_name: "Dr. Kadam", completed_at: "2027-04-15T05:00:00Z", finding: { grade: "A", fruit_inspected: 20 } }]);
  if (p === "/quality-checks") return json(200, [{ id: "QC-1", analysed_at: "2027-04-14T05:00:00Z", photos: ["a", "b", "c"], cv: { grade_hint: "A", defect_pct: 0.8, colour_score: 0.9, confidence: 0.93, model: "agrilink-vision-v1" } }]);
  return json(404, {});
});

function fakeChain() {
  const byRef = new Map(), byHash = new Map();
  let block = 10;
  return {
    async register(id, sha, version) {
      const list = byRef.get(id) || [];
      if (version !== list.length + 1) throw new Error("WrongVersion");
      list.push(sha); byRef.set(id, list); byHash.set(sha, { id, version });
      return { status: "registered", network: "Test chain", chainId: 31337, contract: "0xC0FFEE", docHash: "0x" + sha, version, txHash: "0x" + sha.slice(0, 16), blockNumber: ++block, registeredAt: new Date() };
    },
    async lookup(sha) { return byHash.get(sha) ? { agreementRef: "x", version: byHash.get(sha).version } : null; },
    versions: (id) => byRef.get(id) || [],
  };
}

let server, base, tmp, chain;
const api = async (p, { method = "GET", token, body } = {}) => {
  const res = await fetch(base + "/api" + p, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  const ct = res.headers.get("content-type") || "";
  return { status: res.status, body: ct.includes("pdf") ? Buffer.from(await res.arrayBuffer()) : await res.json(), headers: res.headers };
};
const login = async (mobile, role) => (await api("/auth/verify", { method: "POST", body: { mobile, otp: "1234", role } })).body;

before(async () => {
  await new Promise((r) => m2.listen(0, "127.0.0.1", r));
  process.env.M2_API_URL = `http://127.0.0.1:${m2.address().port}/api/m2`;
  process.env.PUBLIC_APP_URL = "https://agrilink.example";
  const { createApp } = await import("../src/app.js");
  const { createNotifier } = await import("../src/modules/notifications/notifier.js");
  const { createStore } = await import("../src/modules/contracts/storage.js");
  await mongoose.connect((process.env.MONGO_URI || "mongodb://127.0.0.1:27017/agrilink_test").replace(/agrilink_test$/, "agrilink_test_certificates"));
  await mongoose.connection.dropDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aglcert-"));
  chain = fakeChain();
  const fake = { ml: {}, notifier: createNotifier(null), contractDeps: { chain }, certDeps: { store: createStore(tmp) } };
  server = createApp(fake).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); m2.close(); await mongoose.disconnect(); fs.rmSync(tmp, { recursive: true, force: true }); });

test("issue, scope, verify, revoke", async () => {
  const f = await login("9876543210", "farmer"); farmerUser = f.user._id;
  const b = await login("6500000001", "buyer"); buyerUser = b.user._id;
  const other = await login("6500000004", "buyer");
  const o = await login("9000000001", "operations");

  // only operations see lots and eligibility
  assert.equal((await api(`/certificates/eligibility/${LOT}`, { token: f.token })).status, 403);
  const lots = (await api("/certificates/lots", { token: o.token })).body;
  assert.equal(lots[0].lotId, LOT);
  assert.equal(lots[0].certificate, null);

  const e = (await api(`/certificates/eligibility/${LOT}`, { token: o.token })).body;
  assert.equal(e.eligible, true, JSON.stringify(e.checks.filter((c) => !c.ok)));
  assert.ok(e.checks.some((c) => c.key.startsWith("doctor:") && c.ok));
  assert.equal(e.checks.find((c) => c.key === "agreement").blocking, false);   // warning only

  // issue: PDF stored write-once, hash on chain, buyer + grower notified
  const issued = await api("/certificates", { method: "POST", token: o.token, body: { lotId: LOT } });
  assert.equal(issued.status, 201, JSON.stringify(issued.body));
  const c = issued.body;
  assert.match(c.certificateId, /^AGL-QC-2027-\d{5}$/);
  assert.equal(c.liveStatus, "valid");
  assert.equal(c.chain.status, "registered");
  assert.equal(c.verifyUrl, `https://agrilink.example/verify/${c.certificateId}`);
  assert.equal(new Date(c.validUntil) - new Date(c.issuedAt), 14 * 86400000);
  assert.equal(c.farmers[0].evidence.doctor.grade, "A");
  assert.equal(c.auditIntact, true);
  const sha = c.documents[0].sha256;
  assert.deepEqual(chain.versions(c.certificateId), [sha]);

  // a second certificate for the same lot is refused
  assert.equal((await api("/certificates", { method: "POST", token: o.token, body: { lotId: LOT } })).status, 409);

  // scoping: grower and buyer see it, an unrelated buyer does not
  assert.equal((await api("/certificates", { token: f.token })).body.items[0].myKg, 1800);
  assert.equal((await api("/certificates", { token: b.token })).body.items.length, 1);
  assert.equal((await api("/certificates", { token: other.token })).body.items.length, 0);
  assert.equal((await api(`/certificates/${c.certificateId}`, { token: other.token })).status, 404);
  const notes = (await api("/notifications", { token: f.token })).body;
  assert.ok((notes.items || notes).some((n) => n.type === "certificate_issued"));

  // the PDF the buyer downloads is exactly the one registered
  const pdf = await api(`/certificates/${c.certificateId}/document`, { token: b.token });
  assert.equal(createHash("sha256").update(pdf.body).digest("hex"), sha);

  // public: no login needed; no internal ids of people
  const pub = (await api(`/public/certificates/${c.certificateId}`)).body;
  assert.equal(pub.status, "valid");
  assert.equal(pub.growers[0].name, "Ramesh Patil");
  assert.ok(!JSON.stringify(pub).includes(String(farmerUser)));
  assert.deepEqual((await api(`/public/certificates?lot=${LOT}`)).body, [{ certificateId: c.certificateId, status: "valid" }]);
  assert.equal((await api("/public/certificates/verify", { method: "POST", body: { sha256: sha } })).body.result, "verified");
  const tampered = createHash("sha256").update(Buffer.concat([pdf.body, Buffer.from(" ")])).digest("hex");
  assert.equal((await api("/public/certificates/verify", { method: "POST", body: { sha256: tampered } })).body.result, "unknown");

  // FPO desk of another FPO may not revoke; AgriLink operations may
  await api("/ops/me", { method: "PUT", token: o.token, body: { m2Role: "fpo", m2Actor: "FPO-OTHER" } });
  assert.equal((await api(`/certificates/${c.certificateId}/revoke`, { method: "POST", token: o.token, body: { reason: "Wrong lot weight recorded" } })).status, 403);
  await api("/ops/me", { method: "PUT", token: o.token, body: { m2Role: "admin", m2Actor: "OPS-1" } });
  const rv = (await api(`/certificates/${c.certificateId}/revoke`, { method: "POST", token: o.token, body: { reason: "Wrong lot weight recorded" } })).body;
  assert.equal(rv.liveStatus, "revoked");
  assert.equal(chain.versions(c.certificateId).length, 2);                 // revocation notice anchored as version 2
  assert.equal((await api(`/public/certificates/${c.certificateId}`)).body.status, "revoked");
  assert.equal((await api("/public/certificates/verify", { method: "POST", body: { sha256: sha } })).body.status, "revoked");

  // after revocation the lot can be certified again
  assert.equal((await api("/certificates", { method: "POST", token: o.token, body: { lotId: LOT } })).status, 201);
});

test("lot without a passing quality review is blocked", async () => {
  passStatus = "PENDING_DOCTOR";
  const o = await login("9000000001", "operations");
  await api("/ops/me", { method: "PUT", token: o.token, body: { m2Role: "admin", m2Actor: "OPS-1" } });
  const certs = (await api("/certificates", { token: o.token })).body.items.filter((x) => x.status === "issued");
  for (const x of certs) await api(`/certificates/${x.certificateId}/revoke`, { method: "POST", token: o.token, body: { reason: "Test reset of certificate" } });
  const e = (await api(`/certificates/eligibility/${LOT}`, { token: o.token })).body;
  assert.equal(e.eligible, false);
  assert.equal((await api("/certificates", { method: "POST", token: o.token, body: { lotId: LOT } })).status, 409);
  assert.equal((await api("/certificates/eligibility/LOT-NOPE", { token: o.token })).status, 404);
  passStatus = "PASS";
});
