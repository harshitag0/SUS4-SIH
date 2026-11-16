import mongoose from "mongoose";

const farmSchema = new mongoose.Schema(
  {
    village: String,
    district: { type: String, enum: ["Sindhudurg", "Ratnagiri", "Raigad", "Palghar"] },
    acres: Number,
    variety: { type: String, default: "Alphonso" },
    trees: Number,
    age: Number,
    irrigation: { type: String, enum: ["drip", "well", "rain"] },
    fpo: String,
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    mobile: { type: String, required: true, unique: true },
    role: { type: String, enum: ["farmer", "buyer", "operations"], required: true },
    m2Role: { type: String, enum: ["admin", "fpo", "doctor"] }, // operations users: which farm-operations role they act in
    m2Actor: String,                                             // e.g. OPS-1, FPO-RTN, DOC-RTN
    name: String,
    company: String, // buyers
    farm: farmSchema, // farmers; absent until onboarding is done
    lang: { type: String, enum: ["en", "hi", "mr", "gu", "ta", "te", "kn"], default: "en" },
    // farmer's message channels (WhatsApp / SMS / voice notes). In-app notifications are always on.
    notify: { whatsapp: { type: Boolean, default: true }, sms: { type: Boolean, default: true }, voice: { type: Boolean, default: false } },
    waLastInboundAt: Date, // farmer's last WhatsApp message to us (opens WhatsApp's 24-hour window for free-form voice notes)
    costs: [{ _id: false, year: Number, components: mongoose.Schema.Types.Mixed }], // farmer's actual spend per season (Rs per component)
  },
  { timestamps: true }
);

export const User = mongoose.models.User || mongoose.model("User", userSchema);
