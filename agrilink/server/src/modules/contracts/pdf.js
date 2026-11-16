import PDFDocument from "pdfkit";

/**
 * Renders the formal procurement agreement as PDF.
 *  - draft  : the document both parties review and sign (its SHA-256 is what each signature commits to)
 *  - signed : the same content + filled signature blocks + a Signature Certificate page; its SHA-256 goes on-chain
 */
const NAVY = "#0b1f3a", CYAN = "#0891b2", GREY = "#5b6b7f", LINE = "#d5dde8";
const money = (v) => "USD " + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "—");
const ts = (d) => (d ? new Date(d).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "—");

export function renderAgreementPdf(a, { signed = false, draftHash = null } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: 56, bottom: 56, left: 56, right: 56 },
      info: { Title: `${a.agreementId} v${a.version} — Procurement Agreement`, Author: "AgriLink", Subject: "Alphonso mango procurement agreement" } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const W = doc.page.width - 112, t = a.terms, b = a.parties.buyer, s = a.parties.seller;

    const footer = () => {
      // draw in the bottom margin without triggering a page break, then restore the cursor
      const { x, y } = doc, bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font("Helvetica").fontSize(7.5).fillColor(GREY).text(`${a.agreementId} · Version ${a.version} · ${signed ? "SIGNED" : "DRAFT FOR SIGNATURE"}${draftHash ? ` · Draft SHA-256 ${draftHash.slice(0, 16)}…` : ""}`, 56, doc.page.height - 40, { width: W, align: "center", lineBreak: false });
      doc.page.margins.bottom = bottom;
      doc.x = x; doc.y = y;
    };
    doc.on("pageAdded", footer);
    footer(); // first page (later pages get it from pageAdded)

    // header
    doc.rect(0, 0, doc.page.width, 8).fill(NAVY);
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(18).text("PROCUREMENT AGREEMENT", 56, 40);
    doc.font("Helvetica").fontSize(10).fillColor(GREY).text("Fresh Alphonso Mangoes · India → Singapore", 56, 62);
    doc.font("Helvetica-Bold").fontSize(10).fillColor(NAVY).text(a.agreementId, 56, 40, { width: W, align: "right" });
    doc.font("Helvetica").fontSize(9).fillColor(GREY).text(`Version ${a.version}${a.amendmentOf ? ` (amends v${a.amendmentOf})` : ""}`, 56, 54, { width: W, align: "right" })
      .text(`Date: ${date(a.createdAt || new Date())}`, 56, 66, { width: W, align: "right" });
    doc.moveTo(56, 86).lineTo(56 + W, 86).strokeColor(LINE).stroke();
    doc.y = 98;

    const h = (n, title) => { doc.moveDown(0.6); doc.font("Helvetica-Bold").fontSize(11).fillColor(NAVY).text(`${n}. ${title}`); doc.moveDown(0.25); };
    const p = (text) => doc.font("Helvetica").fontSize(9.5).fillColor("#1f2a37").text(text, { width: W, align: "justify", lineGap: 1.5 });
    const kv = (rows) => {
      for (const [k, v] of rows) {
        const y = doc.y;
        doc.font("Helvetica").fontSize(9).fillColor(GREY).text(k, 56, y, { width: 150 });
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#1f2a37").text(String(v ?? "—"), 210, y, { width: W - 154 });
        doc.y = Math.max(doc.y, y + 13);
      }
    };

    // parties
    const colW = (W - 16) / 2, top = doc.y + 4;
    const party = (x, title, rows) => {
      doc.roundedRect(x, top, colW, 96, 6).strokeColor(LINE).stroke();
      doc.font("Helvetica-Bold").fontSize(8).fillColor(CYAN).text(title, x + 10, top + 9);
      let y = top + 22;
      for (const [k, v] of rows) { doc.font("Helvetica").fontSize(8.5).fillColor(GREY).text(k, x + 10, y, { width: 70 }); doc.font("Helvetica-Bold").fillColor("#1f2a37").text(v || "—", x + 80, y, { width: colW - 90 }); y += 14; }
    };
    party(56, "BUYER", [["Company", b.company], ["Contact", b.contactName], ["Country", b.country], ["Mobile", b.maskedMobile], ["Address", b.address]]);
    party(56 + colW + 16, "SELLER (FARMER / FPO)", [["Farmer", s.farmerName], ["FPO", s.fpo], ["Location", `${s.village}, ${s.district}`], ["Mobile", s.maskedMobile], ["State", "Maharashtra, India"]]);
    doc.y = top + 108;

    h(1, "Product and quantity");
    kv([["Product", t.product], ["Variety", t.variety], ["Grade", t.grade], ["Quantity", `${t.quantityTons} metric tons`],
      ["Price", `${money(t.priceUsdPerKg)} per kg (${t.incoterm})`], ["Total contract value", money(t.totalValueUsd)]]);
    h(2, "Quality specifications");
    p(t.qualitySpec);
    h(3, "Packaging requirements");
    p(t.packaging);
    h(4, "Pickup and delivery");
    kv([["Pickup location", t.pickupLocation], ["Delivery location", t.deliveryLocation], ["Delivery date", date(t.deliveryDate)]]);
    h(5, "Inspection and acceptance");
    p(t.inspection);
    h(6, "Payment milestones");
    for (const [i, m] of (t.paymentMilestones || []).entries()) p(`${String.fromCharCode(97 + i)}) ${m.label} — ${m.pct}% (${money((t.totalValueUsd * m.pct) / 100)})`);
    if (t.escalation?.enabled) p(`Price escalation: the price may be revised upward by up to ${t.escalation.pct}% if export supply is tight, by written notice before dispatch.`);
    h(7, "Rejection");
    p(t.rejectionTerms);
    h(8, "Dispute resolution");
    p(t.disputeTerms);
    h(9, "Integrity and records");
    p("The SHA-256 hash of the final signed version of this agreement is registered on a public blockchain (Polygon PoS) by AgriLink. The document and personal data remain stored off-chain. Any amendment creates a new version that must be signed again by both parties; earlier versions and their hashes are preserved.");

    // signature blocks
    doc.moveDown(1);
    if (doc.y > doc.page.height - 190) doc.addPage();
    const sy = doc.y;
    const sigBox = (x, label, signer) => {
      doc.roundedRect(x, sy, colW, 92, 6).strokeColor(LINE).stroke();
      doc.font("Helvetica-Bold").fontSize(8).fillColor(CYAN).text(label, x + 10, sy + 9);
      const sig = signer?.signature;
      if (signed && sig?.signedAt) {
        if (sig.type === "drawn" && sig.image) {
          try { doc.image(Buffer.from(sig.image.split(",")[1], "base64"), x + 10, sy + 22, { fit: [colW - 20, 34] }); } catch { /* ignore bad image */ }
        } else {
          doc.font("Times-Italic").fontSize(17).fillColor(NAVY).text(sig.typedName || signer.name, x + 10, sy + 26, { width: colW - 20 });
        }
        doc.font("Helvetica").fontSize(7.5).fillColor(GREY)
          .text(`${signer.name} · ${signer.organisation || ""}`, x + 10, sy + 60, { width: colW - 20 })
          .text(`Signed ${ts(sig.signedAt)} · ${sig.certificateId}`, x + 10, sy + 72, { width: colW - 20 });
      } else {
        doc.moveTo(x + 10, sy + 58).lineTo(x + colW - 10, sy + 58).strokeColor(LINE).stroke();
        doc.font("Helvetica").fontSize(8).fillColor(GREY).text(`${signer?.name || ""} — awaiting signature`, x + 10, sy + 64, { width: colW - 20 });
      }
    };
    const bySigner = (role) => a.signers.find((x) => x.role === role);
    sigBox(56, "SIGNED FOR THE BUYER", bySigner("buyer"));
    sigBox(56 + colW + 16, "SIGNED FOR THE SELLER (FARMER / FPO)", bySigner("farmer"));
    doc.y = sy + 104;

    // certificate
    if (signed) {
      doc.addPage();
      doc.rect(0, 0, doc.page.width, 8).fill(NAVY);
      doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(15).text("SIGNATURE CERTIFICATE", 56, 40);
      doc.font("Helvetica").fontSize(9).fillColor(GREY).text(`${a.agreementId} · Version ${a.version}`, 56, 60);
      doc.y = 84;
      kv([["Document signed (draft) SHA-256", draftHash], ["E-signature provider", a.signers[0]?.identity?.provider === "builtin" ? "AgriLink Sign" : a.signers[0]?.identity?.provider],
        ["Completed", ts(Math.max(...a.signers.map((x) => new Date(x.signature.signedAt).getTime())))]]);
      for (const sg of a.signers) {
        doc.moveDown(0.6);
        doc.font("Helvetica-Bold").fontSize(10).fillColor(NAVY).text(`${sg.role === "buyer" ? "Buyer" : "Seller (Farmer / FPO)"} — ${sg.name}`);
        doc.moveDown(0.2);
        kv([["Organisation", sg.organisation], ["Identity verification", `${sg.identity?.method === "mobile_otp" ? "Mobile OTP" : sg.identity?.method} to ${sg.maskedMobile} at ${ts(sg.identity?.verifiedAt)}`],
          ["Signature", sg.signature.type === "drawn" ? "Hand-drawn" : `Typed: ${sg.signature.typedName}`], ["Signed at", ts(sg.signature.signedAt)],
          ["IP address", sg.signature.ip], ["Device", sg.signature.userAgent], ["Certificate ID", sg.signature.certificateId], ["Committed to SHA-256", sg.signature.signedDocHash]]);
      }
      doc.moveDown(1);
      p("Both signers verified their identity and consented to sign this document electronically. The SHA-256 hash of this complete signed PDF is registered on the blockchain; recomputing the hash of an unmodified copy will match the on-chain record.");
    }
    doc.end();
  });
}
