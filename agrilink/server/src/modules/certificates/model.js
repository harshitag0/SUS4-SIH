import mongoose from "mongoose";

/**
 * AgriLink Quality Certificate: one per collected lot (the consignment that ships), or one per approved crop stage
 * (kind "stage", issued only after an authorised consultant approves the stage assessment).
 * The PDF is stored write-once and its SHA-256 is registered on the AgreementRegistry contract under the
 * certificate id (version 1 = certificate, version 2 = revocation notice). Records are never edited in place:
 * status changes are appended to the hash-chained audit trail.
 */
const farmerSchema = new mongoose.Schema({
  m2Id: String, userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, name: String,
  kg: Number, grade: String,
  evidence: mongoose.Schema.Types.Mixed, // { review, doctor, photos }
}, { _id: false });

const docSchema = new mongoose.Schema({ version: Number, kind: String, key: String, sha256: String, size: Number, createdAt: Date }, { _id: false });

const certificateSchema = new mongoose.Schema({
  certificateId: { type: String, unique: true, index: true },
  kind: { type: String, enum: ["lot", "stage"], default: "lot" },   // lot = consignment certificate; stage = crop-stage certificate
  stage: { key: String, name: String, order: Number },              // stage certificates only
  cropId: { type: String, index: true },
  assessmentId: String,
  batchId: String,                                                  // stage certificates: Module 2 lot (batch) when known
  lotId: { type: String, index: true },
  agreementId: { type: String, index: true },
  buyer: { m2Id: String, userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, name: String },
  fpo: { id: String, name: String },
  product: { crop: String, variety: String, origin: String },
  requiredGrade: String,
  totalKg: Number,
  gradeMix: mongoose.Schema.Types.Mixed,
  farmers: [farmerSchema],
  trace: { headHash: String, intact: Boolean, events: Number, collectedAt: Date },
  issuedAt: Date,          // farm-operations season time
  validUntil: Date,
  issuedBy: { role: String, name: String, userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" } },
  status: { type: String, enum: ["issued", "revoked"], default: "issued" },
  revoked: { at: Date, reason: String, by: String },
  documents: [docSchema],
  chain: mongoose.Schema.Types.Mixed,
  revocationChain: mongoose.Schema.Types.Mixed,
  audit: [{ _id: false, at: Date, actorRole: String, actorName: String, action: String, details: mongoose.Schema.Types.Mixed, prevHash: String, hash: String }],
}, { timestamps: true });

certificateSchema.index({ lotId: 1, status: 1 });
certificateSchema.index({ "farmers.userId": 1 });
certificateSchema.index({ "buyer.userId": 1 });

export const Certificate = mongoose.models.Certificate || mongoose.model("Certificate", certificateSchema);
