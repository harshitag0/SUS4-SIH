// UI end-to-end journeys for Module 2, driven in a real browser (Chrome via puppeteer-core).
// Needs the backend (port 8000) and frontend (port 5173) running. Resets the demo data first.
//   npm install && npm test
import fs from 'node:fs'
import puppeteer from 'puppeteer-core'

const BASE = process.env.M2_WEB || 'http://localhost:5173'
const API = process.env.M2_API || 'http://localhost:8000/api/m2'
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const OUT = new URL('./out/', import.meta.url).pathname
fs.mkdirSync(OUT, { recursive: true })
const problems = []
await fetch(`${API}/system/reset-demo`, { method: 'POST', headers: { 'X-M2-Role': 'admin', 'X-M2-Actor': 'OPS-1' } })
const log = (...a) => console.log('  ', ...a)

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new', args: ['--window-size=1440,1000'], defaultViewport: { width: 1440, height: 1000 },
})
const page = await browser.newPage()
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`console.${m.type()}: ${m.text()}`) })
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
page.on('response', (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`) })
page.on('dialog', (d) => d.accept())

async function go(path, as) {
  await page.goto(`${BASE}${path}${path.includes('?') ? '&' : '?'}as=${as}`, { waitUntil: 'networkidle0' })
}
async function waitText(text, timeout = 8000) {
  await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text)
}
async function click(text, scope) {
  const finder = (t, s) => {
    const match = (b) => !b.disabled && (b.innerText.trim() === t || (b.getAttribute('role') === 'tab' && b.innerText.trim().startsWith(t)))
    // Prefer the smallest element (modal, row, panel) that contains the scope text.
    const roots = s ? [...document.querySelectorAll('.m2-modal, tr, .m2-panel')].filter((p) => p.innerText.includes(s))
      .sort((a, b) => a.innerText.length - b.innerText.length) : [document]
    for (const r of roots) {
      const b = [...r.querySelectorAll('button, a')].find(match)
      if (b) return b
    }
    return null
  }
  await page.waitForFunction(`(${finder})(${JSON.stringify(text)}, ${JSON.stringify(scope || null)}) !== null`, { timeout: 8000 })
  await page.evaluate(`(${finder})(${JSON.stringify(text)}, ${JSON.stringify(scope || null)}).click()`)
}
async function toast(text) {
  await page.waitForFunction((t) => [...document.querySelectorAll('.m2-toast')].some((x) => x.innerText.includes(t)), { timeout: 8000 }, text)
  const bad = await page.$$eval('.m2-toast-bad', (xs) => xs.map((x) => x.innerText))
  if (bad.length) problems.push(`error toast: ${bad.join(' | ')}`)
}
async function typeIn(selector, value, index = 0) {
  const els = await page.$$(selector)
  await els[index].click({ clickCount: 3 })
  await els[index].type(String(value))
}
async function shot(name) { await page.screenshot({ path: `${OUT}${name}.png`, fullPage: true }) }

async function step(name, fn) {
  process.stdout.write(`- ${name} ... `)
  try { await fn(); console.log('ok') } catch (e) { console.log('FAILED'); problems.push(`${name}: ${e.message.split('\n')[0]}`); await shot(`fail-${name.replace(/\W+/g, '-')}`) }
}

const OPS = 'admin:OPS-1'

await step('Board renders all agreements', async () => {
  await go('/m2', OPS)
  for (const t of ['AGR-2027-000', 'AGR-2027-001', 'AGR-2027-002', 'Needs attention: quality']) await waitText(t)
})

await step('Ops runs the scenario lab on the Devgad rain alert', async () => {
  await go('/m2/risks', OPS)
  await click('Run scenario lab', 'Unseasonal rain')
  await toast('Scenario assessed')
  await waitText('Yes · short')
  await shot('risk-assessed')
})

await step('Ops sends recommendations and starts supply recovery', async () => {
  await click('Send recommendations', 'Unseasonal rain')
  await toast('Advice sent')
  await click('Start supply recovery')
  await toast('Supply recovery opened')
})

await step('Ops offers the shortfall to the first-ranked FPO', async () => {
  await go('/m2/recovery', OPS)
  await waitText('first come, first served')
  await click('Offer', 'Rajapur')
  await waitText('Send offer')
  await click('Send offer')
  await toast('Offer sent')
})

await step('Rajapur FPO accepts with in-person signatures', async () => {
  await go('/m2/recovery', 'fpo:FPO-RJP')
  await click('Respond')
  await waitText('Accept with signatures')
  const offered = await page.$eval('.m2-modal-head h2', (h) => Number(h.innerText.replace(/[^\d.]/g, '')))
  const half = Math.floor(offered / 2)
  await typeIn('.m2-modal input[type=number]', half, 0)
  await typeIn('.m2-modal input[type=number]', offered - half, 1)
  await page.click('.m2-modal input[type=checkbox]')
  await click('Accept with signatures')
  await toast('Accepted; agreement updated')
  await shot('recovery-filled')
})

await step('Farmer uploads photos in the farmer view', async () => {
  fs.writeFileSync(`${OUT}fruit.png`, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPgO8gAAAKBAUnKpHzYAAAAAElFTkSuQmCC', 'base64'))
  await go('/m2/farmer', 'farmer:FRM-RTN-06')
  await waitText('Photo check due')
  const input = await page.$('input[type=file]')
  await input.uploadFile(`${OUT}fruit.png`)
  await page.select('.m2-prompt select', 'good')
  await click('Send photos')
  await toast('Photos sent')
  await waitText('Your farmer doctor will confirm the grade')
  await shot('farmer-uploaded')
})

await step('Farmer doctor records an inspection; review passes', async () => {
  await go('/m2/visits', 'doctor:DOC-RTN')
  await click('Record inspection', 'Rekha Surve')
  await waitText('Latest AI result')
  await click('Save inspection')
  await toast('Inspection recorded')
  await waitText('PASS')
  await shot('doctor-inspection')
  await click('Done')
})

await step('Doctor verifies the open intervention (re-check scheduled)', async () => {
  await go('/m2/reviews', 'doctor:DOC-DVG')
  await click('Verify', 'Kamal Rane')
  await waitText('Save and schedule re-check')
  await click('Save and schedule re-check')
  await toast('Verified; re-check scheduled')
})

const AGR = '/m2/agreements/AGR-2027-001'
await step('FPO opens harvest, records a lot (with below-grade fruit) and marks ready', async () => {
  await go(AGR, 'fpo:FPO-RTN')
  await click('Harvest & lots')
  await click('Open harvest & notify eligible farmers')
  await toast('Harvest notice sent')
  await click('Record collected lot')
  await waitText('Weighed kg')
  await typeIn('.m2-modal input[type=number]', 800, 0)
  await typeIn('.m2-modal input[type=number]', 300, 1)
  const selects = await page.$$('.m2-modal select')
  await selects[selects.length >= 2 ? 1 : 0].select('REJECT')
  await click('Record lot')
  await toast('Lot recorded')
  await waitText('Returned (below grade)')
  await click('Mark ready for dispatch')
  await toast('Buyer asked to fund tranche 2')
  await shot('lot-recorded')
})

await step('Buyer funds tranche 2 into escrow', async () => {
  await go(AGR, 'buyer:BUY-A')
  await click('Escrow & receipt')
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.innerText.startsWith('Fund tranche 2')))
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.startsWith('Fund tranche 2')).click())
  await toast('Tranche 2 funded')
})

await step('FPO hands over at the Indian port', async () => {
  await go(AGR, 'fpo:FPO-RTN')
  await click('Harvest & lots')
  await click('Hand over at port')
  await toast('Handed over at port')
  await waitText('Quality responsibility ended there')
})

await step('Buyer records receipt and disputes origin quality', async () => {
  await go(AGR, 'buyer:BUY-A')
  await click('Escrow & receipt')
  await click('Record receipt in Singapore')
  await toast('Receipt recorded')
  await waitText('Dispute window closes')
  await click('Dispute origin quality')
  await page.type('.m2-modal textarea', 'Several cartons show soft fruit and skin marks')
  await click('Raise dispute')
  await toast('Dispute raised')
})

await step('Ops records the surveyor decision (transit) and escrow releases', async () => {
  await go(AGR, OPS)
  await click('Escrow & receipt')
  await click('Record surveyor decision')
  await page.type('.m2-modal input.m2-input', 'Independent cargo surveyor (simulated)')
  await click('Record decision')
  await toast('Decision recorded')
  await waitText('Tranche 2 released to FPO')
  await shot('escrow-closed')
})

await step('Buyer rates the supply; FPO records a farmer reply', async () => {
  await go(AGR, 'buyer:BUY-A')
  await click('Escrow & receipt')
  await click('Rate this supply')
  await toast('Review saved')
  await go(AGR, 'fpo:FPO-RTN')
  await click('Escrow & receipt')
  await page.waitForSelector('select[aria-label=Farmer]')
  const opt = await page.$eval('select[aria-label=Farmer] option:nth-child(2)', (o) => o.value)
  await page.select('select[aria-label=Farmer]', opt)
  await click("Record farmer's SMS reply")
  await toast('Farmer review recorded')
})

await step('Lot QR trace page verifies the hash chain', async () => {
  const lots = await (await fetch(`${API}/agreements/AGR-2027-001`, { headers: { 'X-M2-Role': 'admin' } })).json()
  await go(`/m2/trace/${lots.lots[0].id}`, OPS)
  await waitText('Hash chain verified')
  await waitText('HANDOVER AT PORT')
  await shot('trace')
})

await step('Ops updates ratings and moves the clock', async () => {
  await go('/m2/ratings', OPS)
  await click('Update ratings for 2027-04')
  await toast('Ratings updated for 2027-04')
  await click('+1 day')
  await toast('Clock moved +1 day')
  await waitText('15 Apr')
})

await step('Role scoping: farmer menu only shows farmer pages', async () => {
  await go('/m2', 'farmer:FRM-RTN-04')
  await waitText('My photo checks')
  const links = await page.$$eval('.sh-link', (ls) => ls.map((l) => l.innerText))
  if (links.includes('Supply assurance') || links.includes('Risks & scenario lab')) throw new Error(`farmer sees ${links}`)
})

await step('Validation: dispute without enough text is blocked in the UI', async () => {
  await go('/m2/agreements/AGR-2027-000', 'buyer:BUY-A')
  await click('Escrow & receipt')
  await click('Dispute origin quality')
  const disabled = await page.$$eval('.m2-modal button', (bs) => bs.find((b) => b.innerText === 'Raise dispute').disabled)
  if (!disabled) throw new Error('Raise dispute should be disabled with an empty reason')
})

await browser.close()
console.log(`\nProblems (${problems.length}):`)
problems.forEach((p) => console.log(' *', p))
process.exit(problems.length ? 1 : 0)
