import fs from 'node:fs'
import path from 'node:path'

const scenarios = [
  { ticker: 'SPY', expiry: '2026-07-06', snapshotDate: '2026-07-06', sequence: 1, expiryType: 'daily', price: 630.25 },
  { ticker: 'SPY', expiry: '2026-07-07', snapshotDate: '2026-07-07', sequence: 1, expiryType: 'daily', price: 631.1 },
  { ticker: 'SPY', expiry: '2026-07-08', snapshotDate: '2026-07-08', sequence: 1, expiryType: 'daily', price: 629.8 },
  { ticker: 'SPY', expiry: '2026-07-09', snapshotDate: '2026-07-09', sequence: 1, expiryType: 'daily', price: 632.4 },
  { ticker: 'SPY', expiry: '2026-07-10', snapshotDate: '2026-07-06', sequence: 1, expiryType: 'weekly', price: 630.25 },
  { ticker: 'SPY', expiry: '2026-07-10', snapshotDate: '2026-07-10', sequence: 2, expiryType: 'weekly', price: 634.2 },
  { ticker: 'QQQ', expiry: '2026-07-06', snapshotDate: '2026-07-06', sequence: 1, expiryType: 'daily', price: 558.2 },
  { ticker: 'QQQ', expiry: '2026-07-10', snapshotDate: '2026-07-06', sequence: 1, expiryType: 'weekly', price: 558.2 },
  { ticker: 'QQQ', expiry: '2026-07-10', snapshotDate: '2026-07-10', sequence: 2, expiryType: 'weekly', price: 563.4 },
  { ticker: 'AAPL', expiry: '2026-07-10', snapshotDate: '2026-07-06', sequence: 1, expiryType: 'weekly', price: 214.0 },
  { ticker: 'AAPL', expiry: '2026-07-10', snapshotDate: '2026-07-08', sequence: 2, expiryType: 'weekly', price: 216.2 },
  { ticker: 'AAPL', expiry: '2026-07-10', snapshotDate: '2026-07-10', sequence: 3, expiryType: 'weekly', price: 218.1 },
  { ticker: 'TSLA', expiry: '2026-07-10', snapshotDate: '2026-07-06', sequence: 1, expiryType: 'weekly', price: 329.0 },
  { ticker: 'TSLA', expiry: '2026-07-10', snapshotDate: '2026-07-08', sequence: 2, expiryType: 'weekly', price: 337.5 },
  { ticker: 'TSLA', expiry: '2026-07-10', snapshotDate: '2026-07-10', sequence: 3, expiryType: 'weekly', price: 342.8 },
]

fs.rmSync('data', { recursive: true, force: true })

for (const scenario of scenarios) {
  const snapshot = buildSnapshot(scenario)
  const dir = path.join('data', scenario.ticker, scenario.expiry)
  const base = `snapshot_${scenario.snapshotDate}_${String(scenario.sequence).padStart(2, '0')}`
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${base}.json`), `${JSON.stringify(snapshot, null, 2)}\n`)
  fs.writeFileSync(path.join(dir, `${base}.csv`), snapshotToCsv(snapshot))
  console.log(`Wrote ${dir}/${base}.json`)
}

function buildSnapshot({ ticker, expiry, snapshotDate, sequence, expiryType, price }) {
  const rows = buildRows(ticker, price, sequence)
  const totalCallOi = rows.reduce((sum, row) => sum + row.call_oi, 0)
  const totalPutOi = rows.reduce((sum, row) => sum + row.put_oi, 0)
  const gexTotal = rows.reduce((sum, row) => sum + row.total_gex, 0)
  const maxPain = rows.reduce((best, row) => Math.abs(row.strike - price) < Math.abs(best - price) ? row.strike : best, rows[0].strike)
  const expectedMove = Number((price * (0.012 + sequence * 0.004)).toFixed(2))

  return {
    ticker,
    expiry_date: expiry,
    snapshot_date: snapshotDate,
    snapshot_sequence: sequence,
    snapshot_label: `${formatDate(expiry)} (${sequence})`,
    days_to_expiry: daysBetween(snapshotDate, expiry),
    expiry_type: expiryType,
    underlying_price: price,
    total_call_oi: totalCallOi,
    total_put_oi: totalPutOi,
    total_oi: totalCallOi + totalPutOi,
    gex_total: gexTotal,
    max_pain: maxPain,
    expected_move: expectedMove,
    rows,
  }
}

function buildRows(ticker, price, sequence) {
  const tickerShift = ticker.charCodeAt(0) % 7
  return Array.from({ length: 23 }, (_, index) => {
    const strike = Math.round(price - 55 + index * 5)
    const distance = Math.abs(strike - price)
    const moneyness = Math.max(0, 1 - distance / 75)
    const wave = Math.abs(Math.sin(index * 0.75 + tickerShift + sequence * 0.25))
    const callOi = Math.round((900 + moneyness * 7200 + wave * 1800) * (1 + sequence * 0.06))
    const putOi = Math.round((850 + moneyness * 6800 + Math.abs(Math.cos(index * 0.7)) * 1700) * (1 + sequence * 0.045))
    const callGex = Math.round(callOi * moneyness * 18)
    const putGex = -Math.round(putOi * (1 - moneyness * 0.35) * 11)
    const z = (strike - price) / 28
    return {
      strike,
      call_oi: callOi,
      put_oi: putOi,
      call_gex: callGex,
      put_gex: putGex,
      total_gex: callGex + putGex,
      volume: Math.round((callOi + putOi) * (0.16 + wave * 0.22)),
      probability: Number((Math.exp(-0.5 * z * z) * 100).toFixed(2)),
    }
  })
}

function snapshotToCsv(snapshot) {
  const header = ['strike', 'call_oi', 'put_oi', 'call_gex', 'put_gex', 'total_gex', 'volume', 'probability']
  const rows = snapshot.rows.map((row) => header.map((key) => row[key]).join(','))
  return `${header.join(',')}\n${rows.join('\n')}\n`
}

function daysBetween(start, end) {
  const ms = new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()
  return Math.max(0, Math.round(ms / 86400000))
}

function formatDate(value) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
}
