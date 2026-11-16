import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../api.js";
import { useApi } from "../../hooks/useApi.js";
import Icon from "../../components/Icon.jsx";
import PreSignCheck from "../../components/PreSignCheck.jsx";
import { ErrorBox, Loading, useToast } from "../../components/ui.jsx";
import { Hash, dt, fetchPdf, usd } from "../../components/trust/ui.jsx";

function SignaturePad({ onChange }) {
  const ref = useRef(null);
  const drawing = useRef(false);
  useEffect(() => {
    const c = ref.current, r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    c.width = r.width * dpr; c.height = r.height * dpr;
    const g = c.getContext("2d");
    g.scale(dpr, dpr); g.lineWidth = 2.2; g.lineCap = "round"; g.strokeStyle = "#0b1f3a";
  }, []);
  const pos = (e) => { const r = ref.current.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const down = (e) => { drawing.current = true; const g = ref.current.getContext("2d"); g.beginPath(); g.moveTo(...pos(e)); ref.current.setPointerCapture(e.pointerId); };
  const move = (e) => { if (!drawing.current) return; const g = ref.current.getContext("2d"); g.lineTo(...pos(e)); g.stroke(); };
  const up = () => { if (!drawing.current) return; drawing.current = false; onChange(ref.current.toDataURL("image/png")); };
  const clear = () => { const c = ref.current; c.getContext("2d").clearRect(0, 0, c.width, c.height); onChange(null); };
  return (<><canvas ref={ref} className="pad" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
    <button className="linkbtn" onClick={clear}>Clear signature</button></>);
}

/** E-signature workflow: review the exact document → verify identity (OTP) → sign with consent → certificate. */
export default function Sign() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const r = useApi(`/contracts/${id}`);
  const meta = useApi("/contracts/meta").data;
  const [step, setStep] = useState(1);
  const [pdf, setPdf] = useState(null);
  const [read, setRead] = useState(false);
  const [otpSent, setOtpSent] = useState(null);
  const [otp, setOtp] = useState("");
  const [mode, setMode] = useState("typed");
  const [typed, setTyped] = useState("");
  const [image, setImage] = useState(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [final, setFinal] = useState(null);
  const a = r.data;

  useEffect(() => { fetchPdf(`/contracts/${id}/document?kind=draft`).then(setPdf).catch(() => setPdf(null)); }, [id]);
  useEffect(() => { if (a && !typed) setTyped(a.signers.find((s) => s.role === a.myRole)?.name || ""); }, [a, typed]);
  if (r.loading && !a) return <Loading />;
  if (!a) return <ErrorBox error={r.error} />;
  const me = a.signers.find((s) => s.role === a.myRole);
  if (!final && (a.status !== "pending_signature" || me.status === "signed")) {
    return <div className="card"><p>{me.status === "signed" ? "You have already signed this agreement." : "This agreement is not awaiting your signature."}</p><Link to={`/contracts/${id}`}>Back to agreement</Link></div>;
  }
  const call = async (path, body) => { setBusy(true); try { return await api(`/contracts/${id}${path}`, { method: "POST", body }); } catch (e) { toast(e.message || "Failed"); throw e; } finally { setBusy(false); } };
  const sendOtp = async () => { const out = await call("/sign/start"); setOtpSent(out.result || {}); };
  const verify = async () => { await call("/sign/verify", { otp }); setStep(3); };
  const sign = async () => {
    const out = await call("/sign", mode === "typed" ? { type: "typed", typedName: typed, consent: true } : { type: "drawn", image, consent: true });
    setFinal(out); setStep(4); r.reload();
  };
  const STEPS = ["Review document", "Verify identity", "Sign", "Complete"];

  return (
    <>
      <Link to={`/contracts/${id}`} className="linkbtn" style={{ textDecoration: "none" }}><Icon name="arrowLeft" size={16} />Back to agreement</Link>
      <div className="page-head" style={{ marginTop: 6 }}>
        <div><h2>Sign {a.agreementId}</h2><p className="sub">Signing as <b>{me.name}</b> ({me.role === "buyer" ? "Buyer" : "Farmer / FPO"}) · {usd(a.terms.totalValueUsd)} · provider: {meta?.esign?.active}</p></div>
      </div>
      <div className="steps">{STEPS.map((l, i) => <div key={l} className={`st ${step === i + 1 ? "on" : step > i + 1 ? "ok" : ""}`}><b>{step > i + 1 ? "✓" : i + 1}</b>{l}</div>)}</div>

      {step === 1 && (
        <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1.6fr) minmax(260px, 1fr)", alignItems: "start" }}>
          <div className="card">
            <h3><Icon name="file" />Document to be signed</h3>
            {pdf ? <iframe className="pdfframe" src={pdf.url} title="Agreement PDF" /> : <p className="note">Loading document…</p>}
          </div>
          <div>
            <div className="card">
              <h3><Icon name="shield" />What you are signing</h3>
              <dl className="kv" style={{ gridTemplateColumns: "1fr" }}>
                <dt>Document SHA-256</dt><dd><Hash value={pdf?.sha256 ? "0x" + pdf.sha256 : null} /></dd>
                <dt>Version</dt><dd>{a.version}{a.amendmentOf ? ` (amends v${a.amendmentOf})` : ""}</dd>
                <dt>Quantity / price</dt><dd>{a.terms.quantityTons} t · {usd(a.terms.priceUsdPerKg)}/kg</dd>
              </dl>
              <p className="note">Your signature commits to this exact file. Any later change requires a new version signed by both parties.</p>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontWeight: 400 }}><input type="checkbox" style={{ width: "auto", marginTop: 3 }} checked={read} onChange={(e) => setRead(e.target.checked)} />I have read the full agreement.</label>
              <button className="btn cyan" style={{ width: "100%", marginTop: 12 }} disabled={!read} onClick={() => setStep(2)}>Continue to identity check</button>
            </div>
            {a.myRole === "farmer" && a.bond && <PreSignCheck bondId={a.bond} />}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="card" style={{ maxWidth: 520 }}>
          <h3><Icon name="phone" />Verify your identity</h3>
          <p className="note">A one-time password is sent to your registered mobile {me.maskedMobile}. The verification is recorded on the signature certificate.</p>
          {!otpSent ? <button className="btn" disabled={busy} onClick={sendOtp}>Send OTP</button> : (
            <>
              <p className="insight">OTP sent to {otpSent.sentTo}{otpSent.hint ? ` · ${otpSent.hint}` : ""}</p>
              <label>One-time password</label>
              <input inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="••••" />
              <div className="mrow"><button className="btn alt" disabled={busy} onClick={sendOtp}>Resend</button><button className="btn cyan" disabled={busy || otp.length < 4} onClick={verify}>Verify</button></div>
            </>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="card" style={{ maxWidth: 620 }}>
          <h3><Icon name="pen" />Apply your signature</h3>
          <div className="chips"><button className={`chip ${mode === "typed" ? "on" : ""}`} onClick={() => setMode("typed")}>Type</button><button className={`chip ${mode === "drawn" ? "on" : ""}`} onClick={() => setMode("drawn")}>Draw</button></div>
          {mode === "typed" ? (<>
            <label>Full legal name</label><input value={typed} onChange={(e) => setTyped(e.target.value)} />
            <div style={{ fontFamily: "Segoe Script, Brush Script MT, cursive", fontSize: 30, color: "#0b1f3a", padding: "14px 4px", borderBottom: "1px solid var(--line)" }}>{typed || " "}</div>
          </>) : <SignaturePad onChange={setImage} />}
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontWeight: 400, marginTop: 16 }}>
            <input type="checkbox" style={{ width: "auto", marginTop: 3 }} checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            I agree to sign this agreement electronically. I understand my electronic signature is legally binding, and that the signed document's hash will be recorded on a public blockchain.
          </label>
          <button className="btn cyan" style={{ width: "100%", marginTop: 14 }} disabled={busy || !consent || (mode === "typed" ? typed.trim().length < 3 : !image)} onClick={sign}>{busy ? "Signing…" : "Sign agreement"}</button>
        </div>
      )}

      {step === 4 && final && (() => {
        const mine = final.signers.find((s) => s.role === final.myRole);
        const reg = final.chain?.status === "registered";
        return (
          <div className="card" style={{ maxWidth: 720 }}>
            <div className="result ok" style={{ marginTop: 0 }}>
              <h2><Icon name="checkCircle" size={24} />Signature applied</h2>
              <p style={{ margin: 0 }}>Certificate <b className="mono">{mine.signature.certificateId}</b> · {dt(mine.signature.signedAt)}</p>
            </div>
            {reg ? (
              <div className="result ok">
                <h2><Icon name="shield" size={22} />Both parties signed — registered on {final.chain.network}</h2>
                <dl className="kv" style={{ gridTemplateColumns: "160px 1fr" }}>
                  <dt>Signed PDF SHA-256</dt><dd><Hash value={final.chain.docHash} /></dd>
                  <dt>Transaction</dt><dd><Hash value={final.chain.txHash} /></dd>
                  <dt>Block</dt><dd>{final.chain.blockNumber}</dd>
                </dl>
              </div>
            ) : <p className="insight">Waiting for the other party to sign. You will be notified, and the signed PDF will be registered on the blockchain automatically.</p>}
            <button className="btn" style={{ marginTop: 14 }} onClick={() => nav(`/contracts/${id}`)}>Open agreement</button>
          </div>
        );
      })()}
    </>
  );
}
