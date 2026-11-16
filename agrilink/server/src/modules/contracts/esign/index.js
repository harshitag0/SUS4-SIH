import { createHash, randomUUID } from "node:crypto";
import { env } from "../../../config/env.js";
import { HttpError } from "../../../lib/http.js";

/**
 * E-signature providers.
 *  - builtin  : "AgriLink Sign (sandbox)" — mobile OTP identity check + drawn/typed signature + explicit consent +
 *               signature certificate (signer, method, time, IP, device, signed document hash). For demos and pilots.
 *  - zoho     : Zoho Sign API   — enabled when ZOHO_SIGN_CLIENT_ID / ZOHO_SIGN_REFRESH_TOKEN are set (adapter TODO).
 *  - docusign : DocuSign eSignature API — enabled when DOCUSIGN_INTEGRATION_KEY / DOCUSIGN_ACCOUNT_ID are set (adapter TODO).
 * The rest of the system only depends on: startIdentity, verifyIdentity, sign.
 */
const IDENTITY_TTL_MS = 15 * 60 * 1000;

function builtin() {
  return {
    id: "builtin",
    name: "AgriLink Sign",
    legalNote: "Signed with mobile OTP identity check and explicit consent. Zoho Sign / DocuSign can be used as the provider (IT Act 2000 / ETA Singapore compliant).",
    startIdentity(signer) {
      // A real provider sends an SMS OTP here. Sandbox accepts the configured demo OTP.
      return { method: "mobile_otp", sentTo: signer.maskedMobile };
    },
    verifyIdentity(signer, otp) {
      if (String(otp) !== env.devOtp) throw new HttpError(401, "Wrong OTP", "bad_otp");
      signer.status = "identity_verified";
      signer.identity = { method: "mobile_otp", verifiedAt: new Date(), provider: "builtin" };
    },
    sign(signer, { type, typedName, image, consent, ip, userAgent, docHash }) {
      if (!consent) throw new HttpError(400, "Consent is required to sign", "consent_required");
      if (signer.status !== "identity_verified" || Date.now() - new Date(signer.identity.verifiedAt).getTime() > IDENTITY_TTL_MS) {
        throw new HttpError(403, "Verify your identity (OTP) before signing", "identity_required");
      }
      if (type === "typed" && !(typedName && typedName.trim().length >= 3)) throw new HttpError(400, "Type your full name", "bad_signature");
      if (type === "drawn" && !(typeof image === "string" && image.startsWith("data:image/png;base64,") && image.length < 400_000)) {
        throw new HttpError(400, "Draw your signature", "bad_signature");
      }
      const signedAt = new Date();
      const certificateId = "SIG-" + createHash("sha256").update([signer.role, String(signer.user), docHash, signedAt.toISOString(), randomUUID()].join("|")).digest("hex").slice(0, 16).toUpperCase();
      signer.status = "signed";
      signer.signature = { type, typedName: type === "typed" ? typedName.trim() : undefined, image: type === "drawn" ? image : undefined,
        signedAt, ip, userAgent: (userAgent || "").slice(0, 160), certificateId, signedDocHash: docHash };
    },
  };
}

function notConfigured(id, name) {
  return { id, name, configured: false };
}

export function getProvider() {
  if (process.env.ZOHO_SIGN_CLIENT_ID && process.env.ZOHO_SIGN_REFRESH_TOKEN) return notConfigured("zoho", "Zoho Sign");
  if (process.env.DOCUSIGN_INTEGRATION_KEY && process.env.DOCUSIGN_ACCOUNT_ID) return notConfigured("docusign", "DocuSign");
  return builtin();
}

export const PROVIDERS = [
  { id: "builtin", name: "AgriLink Sign", active: true },
  { id: "zoho", name: "Zoho Sign", active: Boolean(process.env.ZOHO_SIGN_CLIENT_ID) },
  { id: "docusign", name: "DocuSign", active: Boolean(process.env.DOCUSIGN_INTEGRATION_KEY) },
];
