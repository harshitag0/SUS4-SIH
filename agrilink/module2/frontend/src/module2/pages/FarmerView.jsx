import { useState } from 'react'
import { useAction, useLoad, useM2 } from '../context.jsx'
import { Async, Banner, Button, Empty, Field, PageHeader, Sim, StatusBadge } from '../components/ui.jsx'
import { fmtDateTime, relHours } from '../format.js'

/** What a farmer sees: only photo prompts, the result of their own uploads and messages.
 *  Buyer, FPO and contract details are deliberately not shown (decision 16 Nov 2026). */
export default function FarmerView() {
  const { api, auth, meta } = useM2()
  const state = useLoad(() => api.get('/farmer-view'), [auth.actorId])
  // Kept here, not in the prompt card: after a successful upload the prompt disappears.
  const [last, setLast] = useState(null)
  if (auth.role !== 'farmer') {
    return <div className="m2-page"><PageHeader title="Farmer view" /><Banner tone="info">Switch "Acting as" to a farmer to see the farmer's app view.</Banner></div>
  }
  return (
    <div className="m2-page">
      <div className="m2-phone">
        <Async state={state}>{(v) => (
          <div className="m2-stack">
            <PageHeader title={`Namaskar, ${v.farmer.name.split(' ')[0]}`} crumb={`${v.farmer.village} · ${v.farmer.language}`}>
              Upload photos when AgriLink asks. Your farmer doctor will also visit.
            </PageHeader>
            {last && <Banner tone={last.review.status === 'RETAKE_PHOTO' ? 'warn' : 'ok'}>
              {last.review.status === 'RETAKE_PHOTO' ? 'Photos were not clear. Please take them again (see below).'
                : `Thank you, ${last.check.photos.length} photo(s) received. Your farmer doctor will confirm the grade.`}
              {last.check.cv?.notes?.length > 0 && <ul className="m2-small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {last.check.cv.notes.map((n) => <li key={n}>{n}</li>)}</ul>}</Banner>}
            {v.prompts.length === 0 ? <Empty title="No photo check due">You will get an SMS or WhatsApp message when the next one is due.</Empty>
              : v.prompts.map((p) => <Prompt key={p.check_id} p={p} now={meta?.now} profiles={meta?.cv_profiles || []} onDone={setLast} />)}
            {v.recent.length > 0 && (
              <section>
                <h2 style={{ marginBottom: 8 }}>Earlier checks</h2>
                <div className="m2-stack" style={{ gap: 6 }}>{v.recent.map((r) => (
                  <div key={r.check_id} className="m2-row m2-small"><StatusBadge status={r.status} />
                    <span className="m2-muted">{r.uploaded_at ? `Uploaded ${fmtDateTime(r.uploaded_at)} · ${r.photos} photo(s)` : 'No upload'}</span></div>))}</div>
              </section>)}
            {v.messages.length > 0 && (
              <section>
                <h2 style={{ marginBottom: 8 }}>Messages (SMS / WhatsApp)</h2>
                <div className="m2-stack" style={{ gap: 8 }}>{v.messages.map((m, i) => (
                  <div key={i} className="m2-prompt"><div className="m2-small m2-muted">{fmtDateTime(m.at)} · {m.channel}</div>
                    <strong>{m.subject}</strong><div className="m2-small">{m.body}</div></div>))}</div>
              </section>)}
          </div>
        )}</Async>
      </div>
    </div>
  )
}

function Prompt({ p, now, profiles, onDone }) {
  const { api } = useM2()
  const { run, busy } = useAction()
  const [files, setFiles] = useState([])
  const [profile, setProfile] = useState('')
  const submit = async () => {
    const fd = new FormData()
    files.forEach((f) => fd.append('photos', f))
    if (profile) fd.append('simulation_profile', profile)
    const r = await run(() => api.upload(`/quality-checks/${p.check_id}/photos`, fd), 'Photos sent')
    if (r) { onDone(r); setFiles([]) }
  }
  return (
    <div className="m2-prompt m2-due">
      <div className="m2-row"><strong>{p.is_retake ? 'Please retake your photos' : 'Photo check due'}</strong><div className="m2-spacer" /><StatusBadge status={p.status} /></div>
      <div className="m2-small m2-muted" style={{ margin: '4px 0 12px' }}>Upload by {fmtDateTime(p.deadline)} ({relHours(p.deadline, now)}).
        {p.reminders > 0 && ` Reminder ${p.reminders} sent.`} Take 3 photos in daylight, close to the fruit.</div>
      <div className="m2-form">
        <Field label="Photos (JPEG, PNG or WebP, up to 5)">
          <input className="m2-input" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, 5))} />
        </Field>
        <Button variant="primary" busy={busy} disabled={!files.length} onClick={submit}>Send photos</Button>
      </div>
    </div>
  )
}
