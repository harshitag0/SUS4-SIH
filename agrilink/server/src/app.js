import express from "express";
import cors from "cors";
import { modules } from "./modules/index.js";
import { errorHandler } from "./lib/http.js";
import { nullNotifier } from "./modules/notifications/notifier.js";
import { m2Gateway } from "./modules/module2/gateway.js";
import { createMessenger } from "./modules/messaging/service.js";
import { bridgeNotifications } from "./modules/messaging/bridge.js";

/** Build the Express app. `deps` lets tests inject a fake ML client. */
export function createApp(injected) {
  const deps = { notifier: nullNotifier, ...injected };
  // WhatsApp / SMS: real providers when credentials exist, otherwise clearly-marked simulated delivery
  if (!deps.messenger) deps.messenger = createMessenger();
  if (!deps.noMessageBridge) bridgeNotifications(deps.notifier, deps.messenger);
  const app = express();
  app.use(cors());
  // Module 2 gateway first: it streams raw bodies (photo uploads) and sets identity from the AgriLink login
  app.use("/api/m2", m2Gateway(deps));
  // stage assessments carry up to 5 photos (resized in the browser) as base64: larger limit on that route only
  app.use("/api/crops", express.json({ limit: "25mb" }));
  app.use("/api/advisory", express.json({ limit: "20mb" }));          // farmer evidence photos
  // rawBody kept for webhook signature checks (WhatsApp X-Hub-Signature-256)
  app.use(express.json({ limit: "1mb", verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.use("/api/webhooks", express.urlencoded({ extended: false }));   // Twilio status callbacks
  app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "api" }));
  for (const make of modules) {
    const { path, router } = make(deps);
    app.use(`/api${path}`, router);
  }
  app.use((_req, res) => res.status(404).json({ error: "not_found" }));
  app.use(errorHandler);
  return app;
}
