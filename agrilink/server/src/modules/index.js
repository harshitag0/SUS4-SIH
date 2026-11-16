import auth from "./auth/routes.js";
import farmers from "./farmers/routes.js";
import requirements from "./requirements/routes.js";
import bonds from "./bonds/routes.js";
import market from "./market/routes.js";
import quality from "./quality/routes.js";
import alerts from "./alerts/routes.js";
import notifications from "./notifications/routes.js";
import contracts from "./contracts/routes.js";
import journey, { opsModule as ops } from "./journey/routes.js";
import contact from "./contact/routes.js";
import certificates, { publicCertificatesModule as publicCertificates } from "./certificates/routes.js";
import advisory from "./advisory/routes.js";
import messages, { webhooksModule as webhooks } from "./messaging/routes.js";
import assistant from "./assistant/routes.js";
import live from "./live/routes.js";
import crops, { stageAssessmentsModule as stageAssessments, stageConfigModule as stageConfig } from "./stages/routes.js";

/**
 * Module registry. Each module is a factory (deps) => ({ path, router }).
 * To add a module (chatbot, logistics, payments...): create src/modules/<name>/routes.js and list it here.
 */
export const modules = [auth, farmers, requirements, bonds, market, quality, alerts, notifications, contracts, journey, ops, contact, certificates, publicCertificates, crops, stageAssessments, stageConfig, advisory, messages, webhooks, assistant, live];
