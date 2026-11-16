import mongoose from "mongoose";

const { Mixed, ObjectId } = mongoose.Schema.Types;

// separate schema: a field literally named "type" must be declared inside a Schema, not a nested object
const signatureSchema = new mongoose.Schema({
  type: { type: String, enum: ["typed", "drawn"] }, typedName: String, image: String,
  signedAt: Date, ip: String, userAgent: String, certificateId: String, signedDocHash: String,
}, { _id: false });

const signerSchema = new mongoose.Schema({
  role: { type: String, enum: ["buyer", "farmer"], required: true },
  user: { type: ObjectId, ref: "User", required: true },
  name: String,
  organisation: String,
  maskedMobile: String,
  status: { type: String, enum: ["pending", "identity_verified", "signed", "declined"], default: "pending" },
  identity: { method: String, verifiedAt: Date, provider: String },
  signature: signatureSchema,
  sentAt: Date,
}, { _id: false });

const documentSchema = new mongoose.Schema({
  version: Number, kind: { type: String, enum: ["draft", "signed"] }, key: String, sha256: String, size: Number, createdAt: Date,
}, { _id: false });

const chainSchema = new mongoose.Schema({
  status: { type: String, enum: ["not_registered", "registered", "failed"], default: "not_registered" },
  network: String, chainId: Number, contract: String, agreementRef: String, docHash: String, version: Number,
  txHash: String, blockNumber: Number, registeredAt: Date, registrar: String, prevDocHash: String, error: String, reanchoredAt: Date,
}, { _id: false });

const auditSchema = new mongoose.Schema({
  at: Date, actorRole: String, actorName: String, action: String, details: Mixed, prevHash: String, hash: String,
}, { _id: false });

const milestoneSchema = new mongoose.Schema({ key: String, at: Date, byRole: String, byName: String, note: String }, { _id: false });

const versionSnapshot = new mongoose.Schema({
  version: Number, terms: Mixed, signers: [signerSchema], documents: [documentSchema], chain: chainSchema, supersededAt: Date, reason: String,
}, { _id: false });

const agreementSchema = new mongoose.Schema({
  agreementId: { type: String, unique: true, required: true }, // e.g. AGL-2026-00001
  ref: { type: String, index: true },                            // keccak256(agreementId) — the on-chain key
  bond: { type: ObjectId, ref: "Bond" },
  requirement: { type: ObjectId, ref: "Requirement" },
  buyer: { type: ObjectId, ref: "User", required: true },
  farmer: { type: ObjectId, ref: "User", required: true },
  version: { type: Number, default: 1 },
  status: { type: String, enum: ["draft", "pending_signature", "signed", "registered", "in_progress", "completed", "disputed"], default: "draft" },
  amendmentOf: Number,          // previous version number when this version is an amendment
  amendmentReason: String,
  disputed: { open: Boolean, reason: String, raisedBy: String, at: Date, prevStatus: String },
  parties: { buyer: Mixed, seller: Mixed },
  terms: Mixed,
  signers: [signerSchema],
  documents: [documentSchema],
  chain: { type: chainSchema, default: () => ({}) },
  milestones: [milestoneSchema],
  history: [versionSnapshot],    // previous versions, never modified after being superseded
  audit: [auditSchema],          // append-only, hash-chained
  module2: Mixed,                // handoff to Module 2 (farm management & supply assurance)
}, { timestamps: true });

export const Agreement = mongoose.models.Agreement || mongoose.model("Agreement", agreementSchema);
