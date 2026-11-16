import http from "node:http";
import mongoose from "mongoose";
import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { createMl } from "./lib/ml.js";
import { attachRealtime } from "./realtime.js";
import { createNotifier } from "./modules/notifications/notifier.js";
import { scheduleWeatherAlerts } from "./jobs/weatherAlerts.js";
import { scheduleAdvisory } from "./jobs/advisory.js";
import { createMessenger } from "./modules/messaging/service.js";
import { createChain } from "./modules/contracts/chain.js";
import { createStore } from "./modules/contracts/storage.js";
import { reanchorAll } from "./modules/contracts/service.js";
import { reanchorCertificates } from "./modules/certificates/service.js";
import { seedIfEmpty } from "./seed.js";

await mongoose.connect(env.mongo);
console.log("MongoDB connected");
if (env.seedOnStart && (await seedIfEmpty())) console.log("Seeded demo buyer requirements");

// Blockchain + document store for digital agreements
const chain = createChain();
try {
  const d = await chain.ensureDeployed();
  if (d.redeployed) {
    console.log(`Local chain was reset: AgreementRegistry redeployed at ${d.address}; re-anchoring recorded agreements…`);
    console.log(`Re-anchored ${await reanchorAll(chain)} agreement version(s)`);
    console.log(`Re-anchored ${await reanchorCertificates(chain)} certificate record(s)`);
  }
  const i = await chain.info();
  console.log(`Blockchain: ${i.network} · registry ${i.contract} · block ${i.block}`);
} catch (e) {
  console.warn(`Blockchain unavailable (${e.shortMessage || e.message}). Agreements will be signed and stored; registration can be retried.`);
}

// Module 1 → Module 2: hand over registered agreements that Module 2 has not received yet (e.g. it was offline)
import("./modules/module2/handoff.js").then(async ({ handToModule2 }) => {
  const { Agreement } = await import("./modules/contracts/model.js");
  const { appendAudit } = await import("./modules/contracts/audit.js");
  const pending = await Agreement.find({ "chain.status": "registered", $or: [{ module2: null }, { "module2.status": "failed" }] });
  for (const a of pending) {
    try { a.module2 = await handToModule2(a); } catch (e) { a.module2 = { status: "failed", at: new Date(), error: String(e.message).slice(0, 200) }; }
    a.markModified("module2");
    appendAudit(a, { actorRole: "system", actorName: "AgriLink", action: `module2_${a.module2.status}`, details: null });
    await a.save();
    console.log(`Module 2 handoff ${a.agreementId}: ${a.module2.status}${a.module2.error ? " — " + a.module2.error : ""}`);
  }
}).catch((e) => console.warn("Module 2 handoff sweep skipped:", e.message));

// Express handles HTTP; Socket.IO intercepts only /socket.io on the same server.
const deps = { ml: createMl(env.mlUrl), notifier: createNotifier(), contractDeps: { chain, store: createStore() }, messenger: createMessenger() };
console.log("Messaging:", JSON.stringify(deps.messenger.status()));
const server = http.createServer(createApp(deps));
deps.notifier.attach(attachRealtime(server));
server.listen(env.port, () => console.log(`API + realtime on http://localhost:${env.port}  (ML at ${env.mlUrl})`));

scheduleWeatherAlerts(deps);
scheduleAdvisory(deps);
