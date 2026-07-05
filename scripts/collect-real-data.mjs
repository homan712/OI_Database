import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import YahooFinance from 'yahoo-finance2'

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] })

export async function collectRealData({ tickers = ['SPY', 'QQQ', 'NVDA', 'SPCX'], snapshotDate = todayIso(), log = console.log } = {}) {
  const normalizedTickers = tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean)
  const written = []
  const warnings = []

  log(`Collecting real option data for ${normalizedTickers.join(', ')} on ${snapshotDate}`)

  for (const ticker of normalizedTickers) {
    try {
      const initial = await yahooFinance.options(ticker)
      const expiries = (initial.expirationDates ?? []).map(toIsoDate).sort()
      const quote = initial.quote ?? {}
      const expiryPlan = chooseExpiries(expiries, snapshotDate)
      const selectedExpiries = expiryPlan.expiries
      log(`${ticker}: detected ${expiryPlan.cadence} expirations; collecting ${selectedExpiries.join(', ')}`)

      if (selectedExpiries.length === 0) {
        warnings.push(`${ticker}: no available expiries on or after ${snapshotDate}`)
        continue
      }

      for (const expiry of selectedExpiries) {
        const chain = await yahooFinance.options(ticker, { date: new Date(`${expiry}T00:00:00Z`) })
        const option = chain.options?.[0]

        if (!option || ((option.calls?.length ?? 0) === 0 && (option.puts?.length ?? 0) === 0)) {
          warnings.push(`${ticker} ${expiry}: no option rows returned`)
          continue
        }

        const snapshot = buildSnapshot({
          ticker,
          expiry,
          snapshotDate,
          expirationCadence: expiryPlan.cadence,
          quote: chain.quote ?? quote,
          calls: option.calls ?? [],
          puts: option.puts ?? [],
        })

        const files = writeSnapshot(snapshot)
        written.push({ ticker, expiry, expiration_cadence: expiryPlan.cadence, snapshot_sequence: snapshot.snapshot_sequence, ...files })
        log(`Wrote ${files.json}`)
      }
    } catch (error) {
      warnings.push(`${ticker}: ${error.message}`)
    }
  }

  return { snapshotDate, tickers: normalizedTickers, written, warnings }
}

if (isCliRun()) {
  const args = parseArgs(process.argv.slice(2))
  const tickers = (args.tickers ?? 'SPY,QQQ,NVDA,SPCX').split(',')
  const snapshotDate = args.date ?? todayIso()
  const result = await collectRealData({ tickers, snapshotDate })
  for (const warning of result.warnings) console.warn(warning)
}

function chooseExpiries(expiries, date) {
  const available = expiries.filter((expiry) => expiry >= date)
  const cadence = detectExpirationCadence(expiries, date)
  const selected = new Set()
  const todayExpiry = available.find((expiry) => expiry === date)
  const fridayExpiry = fridayOfWeek(date)

  if (cadence === 'daily') {
    if (todayExpiry && isTradingDay(date)) selected.add(todayExpiry)
    if (isFirstAvailableTradingDayOfWeek(expiries, date) && available.includes(fridayExpiry)) selected.add(fridayExpiry)
  } else if (available[0]) {
    selected.add(available[0])
  }

  return { cadence, expiries: Array.from(selected).sort() }
}

function buildSnapshot({ ticker, expiry, snapshotDate, expirationCadence, quote, calls, puts }) {
  const underlyingPrice = numberOrZero(quote.regularMarketPrice ?? quote.postMarketPrice ?? quote.preMarketPrice)
  const rows = buildRows(calls, puts, underlyingPrice, snapshotDate, expiry)
  const totalCallOi = rows.reduce((sum, row) => sum + row.call_oi, 0)
  const totalPutOi = rows.reduce((sum, row) => sum + row.put_oi, 0)
  const totalOi = totalCallOi + totalPutOi
  const gexTotal = rows.reduce((sum, row) => sum + row.total_gex, 0)
  const maxPain = calculateMaxPain(rows)
  const expectedMove = estimateExpectedMove(rows, underlyingPrice, daysBetween(snapshotDate, expiry))
  const sequence = nextSequence(ticker, expiry)

  return {
    ticker,
    expiry_date: expiry,
    snapshot_date: snapshotDate,
    snapshot_sequence: sequence,
    snapshot_label: `${formatDate(expiry)} (${sequence})`,
    days_to_expiry: daysBetween(snapshotDate, expiry),
    expiry_type: expiryType(expiry),
    expiration_cadence: expirationCadence,
    underlying_price: underlyingPrice,
    total_call_oi: totalCallOi,
    total_put_oi: totalPutOi,
    total_oi: totalOi,
    gex_total: gexTotal,
    max_pain: maxPain,
    expected_move: expectedMove,
    source: 'Yahoo Finance via yahoo-finance2',
    collected_at: new Date().toISOString(),
    rows,
  }
}

function buildRows(calls, puts, underlyingPrice, snapshotDate, expiry) {
  const byStrike = new Map()
  for (const call of calls) {
    const strike = numberOrZero(call.strike)
    const row = getRow(byStrike, strike)
    row.call_symbol = call.contractSymbol ?? ''
    row.call_oi = numberOrZero(call.openInterest)
    row.call_volume = numberOrZero(call.volume)
    row.call_iv = numberOrZero(call.impliedVolatility)
    row.call_bid = numberOrZero(call.bid)
    row.call_ask = numberOrZero(call.ask)
    row.call_last = numberOrZero(call.lastPrice)
  }

  for (const put of puts) {
    const strike = numberOrZero(put.strike)
    const row = getRow(byStrike, strike)
    row.put_symbol = put.contractSymbol ?? ''
    row.put_oi = numberOrZero(put.openInterest)
    row.put_volume = numberOrZero(put.volume)
    row.put_iv = numberOrZero(put.impliedVolatility)
    row.put_bid = numberOrZero(put.bid)
    row.put_ask = numberOrZero(put.ask)
    row.put_last = numberOrZero(put.lastPrice)
  }

  const days = Math.max(1, daysBetween(snapshotDate, expiry))
  return Array.from(byStrike.values())
    .filter((row) => row.call_oi > 0 || row.put_oi > 0 || row.call_volume > 0 || row.put_volume > 0)
    .sort((a, b) => a.strike - b.strike)
    .map((row) => {
      const iv = averagePositive([row.call_iv, row.put_iv])
      const gamma = estimateGamma(row.strike, underlyingPrice, iv, days)
      const callGex = Math.round(row.call_oi * gamma * underlyingPrice * 100)
      const putGex = -Math.round(row.put_oi * gamma * underlyingPrice * 100)
      return {
        ...row,
        call_gex: callGex,
        put_gex: putGex,
        total_gex: callGex + putGex,
        volume: row.call_volume + row.put_volume,
        probability: estimateProbability(row.strike, underlyingPrice, iv, days),
      }
    })
}

function getRow(byStrike, strike) {
  if (!byStrike.has(strike)) {
    byStrike.set(strike, {
      strike,
      call_symbol: '',
      put_symbol: '',
      call_oi: 0,
      put_oi: 0,
      call_volume: 0,
      put_volume: 0,
      call_iv: 0,
      put_iv: 0,
      call_bid: 0,
      put_bid: 0,
      call_ask: 0,
      put_ask: 0,
      call_last: 0,
      put_last: 0,
    })
  }
  return byStrike.get(strike)
}

function writeSnapshot(snapshot) {
  const dir = path.join('data', snapshot.ticker, snapshot.expiry_date)
  const base = `snapshot_${snapshot.snapshot_date}_${String(snapshot.snapshot_sequence).padStart(2, '0')}`
  const json = path.join(dir, `${base}.json`)
  const csv = path.join(dir, `${base}.csv`)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(json, `${JSON.stringify(snapshot, null, 2)}\n`)
  fs.writeFileSync(csv, snapshotToCsv(snapshot))
  return { json, csv }
}

function nextSequence(ticker, expiry) {
  const dir = path.join('data', ticker, expiry)
  if (!fs.existsSync(dir)) return 1
  const sequences = fs.readdirSync(dir)
    .map((file) => file.match(/_(\d+)\.json$/)?.[1])
    .filter(Boolean)
    .map(Number)
  return Math.max(0, ...sequences) + 1
}

function snapshotToCsv(snapshot) {
  const header = [
    'strike',
    'call_symbol',
    'put_symbol',
    'call_oi',
    'put_oi',
    'call_volume',
    'put_volume',
    'call_iv',
    'put_iv',
    'call_bid',
    'put_bid',
    'call_ask',
    'put_ask',
    'call_last',
    'put_last',
    'call_gex',
    'put_gex',
    'total_gex',
    'volume',
    'probability',
  ]
  const rows = snapshot.rows.map((row) => header.map((key) => csvCell(row[key])).join(','))
  return `${header.join(',')}\n${rows.join('\n')}\n`
}

function calculateMaxPain(rows) {
  if (rows.length === 0) return 0
  let bestStrike = rows[0].strike
  let bestPain = Number.POSITIVE_INFINITY

  for (const candidate of rows) {
    const pain = rows.reduce((sum, row) => {
      const callPain = Math.max(0, candidate.strike - row.strike) * row.call_oi
      const putPain = Math.max(0, row.strike - candidate.strike) * row.put_oi
      return sum + callPain + putPain
    }, 0)
    if (pain < bestPain) {
      bestPain = pain
      bestStrike = candidate.strike
    }
  }

  return bestStrike
}

function estimateExpectedMove(rows, underlyingPrice, days) {
  const nearMoney = rows
    .filter((row) => row.call_iv > 0 || row.put_iv > 0)
    .sort((a, b) => Math.abs(a.strike - underlyingPrice) - Math.abs(b.strike - underlyingPrice))
    .slice(0, 6)
  const iv = averagePositive(nearMoney.flatMap((row) => [row.call_iv, row.put_iv]))
  if (!iv || !underlyingPrice) return 0
  return Number((underlyingPrice * iv * Math.sqrt(Math.max(1, days) / 365)).toFixed(2))
}

function estimateGamma(strike, underlyingPrice, iv, days) {
  if (!underlyingPrice || !iv) return 0
  const sigmaMove = underlyingPrice * iv * Math.sqrt(Math.max(1, days) / 365)
  const distance = Math.abs(strike - underlyingPrice)
  return Math.exp(-0.5 * (distance / Math.max(sigmaMove, 1)) ** 2) / Math.max(underlyingPrice * iv * Math.sqrt(Math.max(1, days) / 365), 1)
}

function estimateProbability(strike, underlyingPrice, iv, days) {
  if (!underlyingPrice || !iv) return 0
  const expectedMove = underlyingPrice * iv * Math.sqrt(Math.max(1, days) / 365)
  const z = (strike - underlyingPrice) / Math.max(expectedMove, 1)
  return Number((Math.exp(-0.5 * z * z) * 100).toFixed(2))
}

function averagePositive(values) {
  const positives = values.filter((value) => Number.isFinite(value) && value > 0)
  return positives.length === 0 ? 0 : positives.reduce((sum, value) => sum + value, 0) / positives.length
}

function detectExpirationCadence(expiries, date) {
  const weekExpiries = expiries.filter((expiry) => isSameTradingWeek(expiry, date))
  const nonFridayWeekExpiries = weekExpiries.filter((expiry) => new Date(`${expiry}T00:00:00Z`).getUTCDay() !== 5)

  if (weekExpiries.length >= 3 || nonFridayWeekExpiries.length > 0) return 'daily'
  return 'weekly'
}

function expiryType(expiry) {
  const date = new Date(`${expiry}T00:00:00Z`)
  const day = date.getUTCDay()
  const dayOfMonth = date.getUTCDate()
  if (day === 5 && dayOfMonth >= 15 && dayOfMonth <= 21) return 'monthly'
  return day === 5 ? 'weekly' : 'daily'
}

function isFirstAvailableTradingDayOfWeek(expiries, date) {
  const firstExpiryThisWeek = expiries
    .filter((expiry) => isSameTradingWeek(expiry, date))
    .filter(isTradingDay)
    .sort()[0]
  return firstExpiryThisWeek === date
}

function isTradingDay(date) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return day >= 1 && day <= 5
}

function isSameTradingWeek(expiry, date) {
  const monday = mondayOfWeek(date)
  const friday = fridayOfWeek(date)
  return expiry >= monday && expiry <= friday
}

function mondayOfWeek(date) {
  const value = new Date(`${date}T00:00:00Z`)
  const day = value.getUTCDay()
  const offset = day === 0 ? 1 : day === 6 ? 2 : -(day - 1)
  value.setUTCDate(value.getUTCDate() + offset)
  return toIsoDate(value)
}

function fridayOfWeek(date) {
  const value = new Date(`${date}T00:00:00Z`)
  const day = value.getUTCDay()
  const offset = day === 6 ? 6 : day === 0 ? 5 : 5 - day
  value.setUTCDate(value.getUTCDate() + offset)
  return toIsoDate(value)
}

function daysBetween(start, end) {
  const ms = new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()
  return Math.max(0, Math.round(ms / 86400000))
}

function todayIso() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

function toIsoDate(value) {
  return new Date(value).toISOString().slice(0, 10)
}

function formatDate(value) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
}

function numberOrZero(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}

function csvCell(value) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--tickers') parsed.tickers = argv[++index]
    if (arg === '--date') parsed.date = argv[++index]
  }
  return parsed
}

function isCliRun() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
}
