// End-to-end against the RUNNING API + local Polygon-compatible chain (manual check, not part of npm test):
// farmer commits → agreement draft → buyer sends → both verify OTP and sign → signed PDF hash registered on-chain → verify.
import { createHash } from "node:crypto";

const BASE = process.env.API || "http://127.0.0.1:4000";
const call = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + "/api" + path, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  const ct = res.headers.get("content-type") || "";
  const out = ct.includes("pdf") ? Buffer.from(await res.arrayBuffer()) : await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(out)}`);
  return out;
};
const login = (mobile, role) => call("/auth/verify", { method: "POST", body: { mobile, otp: "1234", role } });

const farmer = await login("9876543210", "farmer");
const buyer = await login("6500000001", "buyer");
const reqs = await call("/requirements?grade=A", { token: farmer.token });
const target = reqs.find((r) => r.buyerName.startsWith("FairPrice") && r.left >= 2);
const summary = await call("/farmers/me/summary", { token: farmer.token });
const tons = Math.min(2, summary.freeTons);
await call("/bonds", { method: "POST", token: farmer.token, body: { requirementId: target._id, tons } });
const { items } = await call("/contracts", { token: buyer.token });
const id = items.find((a) => a.status === "draft").agreementId;
console.log("draft agreement", id);

await call(`/contracts/${id}/terms`, { method: "PUT", token: buyer.token, body: { packaging: "5-ply CFB cartons, 3 kg net, foam nets, lot QR labels; pallets shrink-wrapped for air freight." } });
await call(`/contracts/${id}/send`, { method: "POST", token: buyer.token });
for (const [who, t] of [["buyer", buyer.token], ["farmer", farmer.token]]) {
  await call(`/contracts/${id}/sign/start`, { method: "POST", token: t });
  await call(`/contracts/${id}/sign/verify`, { method: "POST", token: t, body: { otp: "1234" } });
  await call(`/contracts/${id}/sign`, { method: "POST", token: t, body: { type: "typed", typedName: who === "buyer" ? "Lim Wei Ling" : "Ramesh Patil", consent: true } });
}
const a = await call(`/contracts/${id}`, { token: farmer.token });
console.log("status", a.status, "| network", a.chain.network, "| block", a.chain.blockNumber, "| tx", a.chain.txHash);

const pdf = await call(`/contracts/${id}/document`, { token: buyer.token });
const sha = createHash("sha256").update(pdf).digest("hex");
const ok = await call("/contracts/verify", { method: "POST", token: buyer.token, body: { sha256: sha } });
const tampered = Buffer.from(pdf); tampered[Math.floor(tampered.length / 2)] ^= 1;
const bad = await call("/contracts/verify", { method: "POST", token: buyer.token, body: { sha256: createHash("sha256").update(tampered).digest("hex"), agreementId: id } });
console.log("original →", ok.result, "| on-chain", ok.onChain.docHash.slice(0, 18), "| tampered →", bad.result);
