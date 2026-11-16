import { useState } from "react";
import { getToken } from "../../api.js";
import Icon from "../Icon.jsx";

export const STATUS_LABEL = {
  draft: "Draft", pending_signature: "Pending signature", signed: "Signed", registered: "Blockchain registered",
  in_progress: "In progress", completed: "Completed", disputed: "Disputed", amended: "Amended",
};
export const StatusBadge = ({ status }) => <span className={`badge b-${status}`}>{STATUS_LABEL[status] || status}</span>;

export const usd = (v) => "USD " + Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const dt = (d) => (d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
export const day = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

/** Monospace hash with copy button; `short` truncates the middle. */
export function Hash({ value, short = true }) {
  const [ok, setOk] = useState(false);
  if (!value) return <span className="note">—</span>;
  const v = String(value);
  const shown = short && v.length > 22 ? `${v.slice(0, 12)}…${v.slice(-8)}` : v;
  const copy = async () => { try { await navigator.clipboard.writeText(v); setOk(true); setTimeout(() => setOk(false), 1200); } catch { /* ignore */ } };
  return <span className="hash mono" title={v}>{shown}<button onClick={copy} aria-label="Copy">{ok ? <Icon name="check" size={13} /> : <Icon name="file" size={13} />}</button></span>;
}

/** Fetch a protected PDF as a blob URL (bearer auth). */
export async function fetchPdf(path) {
  const res = await fetch(`/api${path}`, { headers: { authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error("not available");
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), sha256: res.headers.get("x-sha256"), blob };
}

export async function downloadPdf(path, filename) {
  const { url } = await fetchPdf(path);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function sha256Hex(buffer) {
  const d = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const ACTION_LABEL = {
  agreement_created: "Agreement created", terms_updated: "Terms updated", sent_for_signature: "Sent for signature",
  identity_otp_sent: "Identity OTP sent", identity_verified: "Identity verified", signed: "Signed", declined: "Declined",
  signed_pdf_stored: "Signed PDF stored (write-once)", registered_on_chain: "Registered on blockchain", chain_registration_failed: "Blockchain registration failed",
  amendment_created: "Amendment created", dispute_raised: "Dispute raised", dispute_resolved: "Dispute resolved", reanchored_after_chain_reset: "Re-anchored on chain",
};
export const MILESTONE_LABEL = {
  created: "Agreement created", sent: "Sent for signing", buyer_signed: "Buyer signed", fpo_signed: "Farmer / FPO signed",
  registered: "Registered on Polygon", harvest_completed: "Harvest completed", quality_inspected: "Quality inspection completed",
  packing_completed: "Packing completed", shipment_dispatched: "Shipment dispatched", goods_received: "Buyer received goods", payment_completed: "Payment completed",
};
export const actionLabel = (a) => (a.startsWith("milestone:") ? MILESTONE_LABEL[a.slice(10)] || a : ACTION_LABEL[a] || a);
