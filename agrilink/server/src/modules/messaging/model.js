import mongoose from "mongoose";

/**
 * Notification log: one row per message per channel. Status meanings:
 *   queued    created, not yet attempted
 *   sent      accepted by the provider (has providerId) — NOT yet confirmed delivered
 *   delivered / read   confirmed by the provider's webhook
 *   failed    provider rejected or all retries exhausted (lastError explains)
 *   simulated development/testing mode: no provider was called, nothing reached the farmer
 *   skipped   not sent by design (channel off, outside WhatsApp 24-h window for voice, no DLT template…)
 */
const eventSchema = new mongoose.Schema({ at: Date, status: String, detail: String }, { _id: false });

const logSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  channel: { type: String, enum: ["whatsapp", "sms", "voice"], index: true },
  template: String,
  lang: String,
  to: String,                         // masked number for display
  body: String,
  params: [String],
  provider: String,
  mode: { type: String, enum: ["live", "simulated"] },
  status: { type: String, enum: ["queued", "sent", "delivered", "read", "failed", "simulated", "skipped"], index: true },
  providerId: { type: String, index: true },
  attempts: { type: Number, default: 0 },
  retryable: Boolean,
  nextRetryAt: { type: Date, index: true },
  lastError: String,
  dedupeKey: { type: String, index: true },
  source: { kind: String, ref: String },   // advisory item, notification, module2 message, reminder…
  events: [eventSchema],
}, { timestamps: true });

export const MessageLog = mongoose.models.MessageLog || mongoose.model("MessageLog", logSchema);
