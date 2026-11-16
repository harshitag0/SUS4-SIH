import { useState } from 'react'
import { useLoad, useM2 } from '../context.jsx'
import { Async, Badge, PageHeader, Panel, Sim, StatusBadge, Table } from '../components/ui.jsx'
import { fmtDateTime } from '../format.js'

/** Outbox of every SMS / WhatsApp / in-app message the workflow sent. */
export default function Messages() {
  const { api, auth } = useM2()
  const [channel, setChannel] = useState('')
  const [toType, setToType] = useState('')
  const state = useLoad(() => api.get('/notifications', { channel, to_type: toType }), [channel, toType, auth.role, auth.actorId])
  return (
    <div className="m2-page">
      <PageHeader title="Messages" crumb="Records">
        {auth.role === 'admin' ? 'Every message the workflow sent: prompts, reminders, alerts, offers and payment notices.'
          : 'Messages sent to you by Module 2.'}
      </PageHeader>
      <Panel flush actions={auth.role === 'admin' && <div className="m2-row">
        <select className="m2-select m2-select-inline" value={toType} onChange={(e) => setToType(e.target.value)} aria-label="Recipient type">
          <option value="">All recipients</option>{['farmer', 'fpo', 'doctor', 'buyer', 'admin'].map((x) => <option key={x}>{x}</option>)}</select>
        <select className="m2-select m2-select-inline" value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Channel">
          <option value="">All channels</option>{['sms', 'whatsapp', 'app'].map((x) => <option key={x}>{x}</option>)}</select></div>} title="Outbox">
        <Async state={state}>{(rows) => (
          <Table rows={rows} empty="No messages." columns={[
            { key: 'at', label: 'Sent', render: (m) => <span className="m2-nowrap">{fmtDateTime(m.created_at)}</span> },
            { key: 'to', label: 'To', render: (m) => <><Badge tone="neutral">{m.to_type}</Badge> <span className="m2-small">{m.to_id}</span></> },
            { key: 'ch', label: 'Channel', render: (m) => m.channel },
            { key: 'msg', label: 'Message', render: (m) => <><strong>{m.subject}</strong><div className="m2-small">{m.body}</div></> },
            { key: 'st', label: 'Status', render: (m) => <StatusBadge status={m.status} /> },
          ]} />
        )}</Async>
      </Panel>
    </div>
  )
}
