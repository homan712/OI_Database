import { useEffect, useState } from 'react'
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  BarChart3,
  CalendarDays,
  ChevronDown,
  Gauge,
  LineChart,
  Search,
  Table2,
  TrendingUp,
} from 'lucide-react'
import './App.css'

type SnapshotRow = {
  strike: number
  call_oi: number
  put_oi: number
  call_gex: number
  put_gex: number
  total_gex: number
  volume: number
  probability: number
}

type Snapshot = {
  ticker: string
  expiry_date: string
  snapshot_date: string
  snapshot_sequence: number
  snapshot_label: string
  days_to_expiry: number
  expiry_type: 'daily' | 'weekly' | 'monthly'
  expiration_cadence?: 'daily' | 'weekly'
  underlying_price: number
  total_call_oi: number
  total_put_oi: number
  total_oi: number
  gex_total: number
  max_pain: number
  expected_move: number
  source?: string
  collected_at?: string
  data_path?: string
  csv_path?: string
  rows: SnapshotRow[]
}

type TabId =
  | 'open-interest'
  | 'volume'
  | 'max-pain'
  | 'volatility-skew'
  | 'greeks'
  | 'expected-move'
  | 'probability'
  | 'gex'
  | 'dex'
  | 'unusual-options'

type Selection = {
  ticker: string
  expiryDate: string
  snapshotKey: string
}

const snapshotModules = import.meta.glob('../data/**/*.json', { eager: true, import: 'default' })
const bundledSnapshots = Object.values(snapshotModules)
  .map((snapshot) => snapshot as Snapshot)
  .sort((a, b) => `${a.ticker}-${a.expiry_date}-${a.snapshot_sequence}`.localeCompare(`${b.ticker}-${b.expiry_date}-${b.snapshot_sequence}`))

const tabs: { id: TabId; label: string; icon: typeof BarChart3 }[] = [
  { id: 'open-interest', label: 'Open Interest', icon: BarChart3 },
  { id: 'volume', label: 'Volume', icon: BarChart3 },
  { id: 'max-pain', label: 'Max Pain', icon: Gauge },
  { id: 'volatility-skew', label: 'Volatility Skew', icon: LineChart },
  { id: 'greeks', label: 'Greeks', icon: TrendingUp },
  { id: 'expected-move', label: 'Expected Move', icon: TrendingUp },
  { id: 'probability', label: 'Probability Distribution', icon: LineChart },
  { id: 'gex', label: 'Gamma Exposure (GEX)', icon: BarChart3 },
  { id: 'dex', label: 'Delta Exposure (DEX)', icon: BarChart3 },
  { id: 'unusual-options', label: 'Unusual Options', icon: BarChart3 },
]

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const initialDefaultSnapshot = newestSnapshot(bundledSnapshots.filter((snapshot) => snapshot.source)) ?? newestSnapshot(bundledSnapshots.filter((snapshot) => snapshot.ticker === 'SPY')) ?? bundledSnapshots[0]
const removedTickersKey = 'oi-database-removed-tickers'

function App() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>(bundledSnapshots)
  const [activeTab, setActiveTab] = useState<TabId>('open-interest')
  const [selection, setSelection] = useState<Selection>(() => selectionFromSnapshot(initialDefaultSnapshot))
  const [draft, setDraft] = useState<Selection>(() => selectionFromSnapshot(initialDefaultSnapshot))
  const [removedTickers, setRemovedTickers] = useState<string[]>(() => loadRemovedTickers())
  const [fetchStatus, setFetchStatus] = useState('')
  const [isFetching, setIsFetching] = useState(false)

  const defaultSnapshot = newestSnapshot(snapshots.filter((snapshot) => snapshot.source)) ?? newestSnapshot(snapshots.filter((snapshot) => snapshot.ticker === 'SPY')) ?? snapshots[0] ?? initialDefaultSnapshot
  const visibleSnapshotCandidates = snapshots.filter((snapshot) => !removedTickers.includes(snapshot.ticker))
  const visibleSnapshots = visibleSnapshotCandidates.length > 0 ? visibleSnapshotCandidates : snapshots
  const fallbackSnapshot = newestSnapshot(visibleSnapshots.filter((snapshot) => snapshot.source)) ?? newestSnapshot(visibleSnapshots) ?? defaultSnapshot
  const activeSnapshot = findSnapshot(selection, visibleSnapshots) ?? fallbackSnapshot
  const tickerSnapshots = visibleSnapshots.filter((snapshot) => snapshot.ticker === draft.ticker)
  const expiryOptions = uniqueBy(tickerSnapshots, (snapshot) => snapshot.expiry_date)
  const snapshotOptions = tickerSnapshots.filter((snapshot) => snapshot.expiry_date === draft.expiryDate)
  const tickerOptions = unique(visibleSnapshots.map((snapshot) => snapshot.ticker))

  const applySelection = () => setSelection(draft)
  const loadSnapshots = async () => {
    const response = await fetch('/api/snapshots')
    if (!response.ok) throw new Error('Snapshot API unavailable')
    const result = await response.json()
    const nextSnapshots = (result.snapshots ?? []) as Snapshot[]
    if (nextSnapshots.length === 0) throw new Error('No snapshots found in data folder')
    setSnapshots(nextSnapshots)
    return nextSnapshots
  }

  useEffect(() => {
    loadSnapshots().catch(() => {
      setFetchStatus('Using bundled data. Start with start_OI_Database.bat to enable live data folder integration.')
    })
  }, [])

  useEffect(() => {
    if (tickerOptions.includes(draft.ticker)) return
    const next = selectionFromSnapshot(fallbackSnapshot)
    setDraft(next)
    setSelection(next)
  }, [draft.ticker, fallbackSnapshot, tickerOptions])

  const clearSelection = () => {
    const next = selectionFromSnapshot(fallbackSnapshot)
    setDraft(next)
    setSelection(next)
  }
  const removeTicker = () => {
    if (tickerOptions.length <= 1) return
    const nextRemovedTickers = unique([...removedTickers, draft.ticker])
    const nextVisibleSnapshots = visibleSnapshots.filter((snapshot) => snapshot.ticker !== draft.ticker)
    const nextSnapshot = newestSnapshot(nextVisibleSnapshots.filter((snapshot) => snapshot.source)) ?? newestSnapshot(nextVisibleSnapshots) ?? defaultSnapshot
    const nextSelection = selectionFromSnapshot(nextSnapshot)
    saveRemovedTickers(nextRemovedTickers)
    setRemovedTickers(nextRemovedTickers)
    setDraft(nextSelection)
    setSelection(nextSelection)
  }
  const restoreTickers = () => {
    saveRemovedTickers([])
    setRemovedTickers([])
    const next = selectionFromSnapshot(defaultSnapshot)
    setDraft(next)
    setSelection(next)
  }
  const fetchData = async () => {
    setIsFetching(true)
    setFetchStatus(`Fetching real data for ${tickerOptions.join(', ')}...`)
    try {
      const response = await fetch('/api/fetch-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: tickerOptions }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'Fetch failed')
      const warningText = result.warnings?.length ? ` Warnings: ${result.warnings.join('; ')}` : ''
      const nextSnapshots = await loadSnapshots()
      const nextVisibleSnapshots = nextSnapshots.filter((snapshot) => !removedTickers.includes(snapshot.ticker))
      const nextSnapshot = newestSnapshot(nextVisibleSnapshots.filter((snapshot) => snapshot.source)) ?? newestSnapshot(nextVisibleSnapshots) ?? defaultSnapshot
      const nextSelection = selectionFromSnapshot(nextSnapshot)
      setDraft(nextSelection)
      setSelection(nextSelection)
      setFetchStatus(`Fetched ${result.written.length} snapshot files and refreshed the dashboard.${warningText}`)
    } catch (error) {
      setFetchStatus(`Fetch failed: ${error instanceof Error ? error.message : 'unknown error'}. Start with start_OI_Database.bat so the local API is running.`)
    } finally {
      setIsFetching(false)
    }
  }

  return (
    <main className="dashboard-shell">
      <Header snapshot={activeSnapshot} />
      <section className="global-filters" aria-label="Top controls">
        <FilterSelect icon={Search} label="Ticker" value={draft.ticker} options={tickerOptions} onChange={(ticker) => {
          const nextSnapshot = visibleSnapshots.find((snapshot) => snapshot.ticker === ticker) ?? fallbackSnapshot
          setDraft(selectionFromSnapshot(nextSnapshot))
        }} />
        <FilterSelect icon={CalendarDays} label="Expiry" value={draft.expiryDate} options={expiryOptions.map((snapshot) => snapshot.expiry_date)} optionLabels={Object.fromEntries(expiryOptions.map((snapshot) => [snapshot.expiry_date, expiryLabel(snapshot)]))} onChange={(expiryDate) => {
          const nextSnapshot = visibleSnapshots.find((snapshot) => snapshot.ticker === draft.ticker && snapshot.expiry_date === expiryDate) ?? activeSnapshot
          setDraft(selectionFromSnapshot(nextSnapshot))
        }} />
        <FilterSelect label="Snapshot" value={draft.snapshotKey} options={snapshotOptions.map(snapshotKey)} optionLabels={Object.fromEntries(snapshotOptions.map((snapshot) => [snapshotKey(snapshot), snapshot.snapshot_label]))} onChange={(snapshotKeyValue) => setDraft({ ...draft, snapshotKey: snapshotKeyValue })} />
        <button className="control-button primary" type="button" onClick={applySelection}>Apply</button>
        <button className="control-button" type="button" onClick={clearSelection}>Clear</button>
        <button className="control-button fetch" type="button" onClick={fetchData} disabled={isFetching || tickerOptions.length === 0}>{isFetching ? 'Fetching...' : 'Fetch Data'}</button>
        <button className="control-button danger" type="button" onClick={removeTicker} disabled={tickerOptions.length <= 1}>Remove Ticker</button>
        {removedTickers.length > 0 && <button className="control-button" type="button" onClick={restoreTickers}>Restore Tickers</button>}
        {fetchStatus && <p className="fetch-status">{fetchStatus}</p>}
      </section>
      <TopTabBar activeTab={activeTab} setActiveTab={setActiveTab} />
      <section className="tab-surface">
        <TabContent activeTab={activeTab} snapshot={activeSnapshot} />
      </section>
    </main>
  )
}

function Header({ snapshot }: { snapshot: Snapshot }) {
  return (
    <header className="hero-header">
      <div>
        <p className="eyebrow">OI Database</p>
        <h1>{snapshot.ticker} Options Analytics</h1>
        <p className="header-copy">{formatDate(snapshot.expiry_date)} expiry, {snapshot.days_to_expiry} days to expiry, snapshot {snapshot.snapshot_sequence} collected {formatDate(snapshot.snapshot_date)}.</p>
      </div>
      <div className="market-strip">
        <SummaryStatCard label="Underlying" value={currency.format(snapshot.underlying_price)} tone="teal" />
        <SummaryStatCard label="Total OI" value={compact.format(snapshot.total_oi)} tone="blue" />
        <SummaryStatCard label="GEX Total" value={compact.format(snapshot.gex_total)} tone={snapshot.gex_total >= 0 ? 'green' : 'red'} />
        <SummaryStatCard label="Cadence" value={snapshot.expiration_cadence ?? snapshot.expiry_type} tone="green" />
      </div>
    </header>
  )
}

function TopTabBar({ activeTab, setActiveTab }: { activeTab: TabId; setActiveTab: (tab: TabId) => void }) {
  return (
    <nav className="top-tabs" aria-label="Analytics tabs">
      {tabs.map((tab) => {
        const Icon = tab.icon
        return (
          <button className={tab.id === activeTab ? 'top-tab active' : 'top-tab'} key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}>
            <Icon size={16} />
            <span>{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

function TabContent({ activeTab, snapshot }: { activeTab: TabId; snapshot: Snapshot }) {
  switch (activeTab) {
    case 'open-interest':
      return <OpenInterestTab snapshot={snapshot} />
    case 'volume':
      return <VolumeTab snapshot={snapshot} />
    case 'max-pain':
      return <MaxPainTab snapshot={snapshot} />
    case 'volatility-skew':
      return <VolatilitySkewTab snapshot={snapshot} />
    case 'greeks':
      return <GreeksTab snapshot={snapshot} />
    case 'expected-move':
      return <ExpectedMoveTab snapshot={snapshot} />
    case 'probability':
      return <ProbabilityTab snapshot={snapshot} />
    case 'gex':
      return <GammaExposureTab snapshot={snapshot} />
    case 'dex':
      return <DeltaExposureTab snapshot={snapshot} />
    case 'unusual-options':
      return <UnusualOptionsTab snapshot={snapshot} />
  }
}

function OpenInterestTab({ snapshot }: { snapshot: Snapshot }) {
  const contextLabel = `${snapshot.ticker}, ${snapshot.expiry_date}(${snapshot.expiry_type.charAt(0)}), calls & puts`
  const putCallRatio = snapshot.total_put_oi / Math.max(snapshot.total_call_oi, 1)
  const contracts = snapshot.rows
    .flatMap((row) => [
      {
        contract: `${snapshot.ticker}   ${shortDateSlashes(snapshot.expiry_date)}   ${row.strike.toFixed(1)}C`,
        openInterest: row.call_oi,
        side: 'Call',
      },
      {
        contract: `${snapshot.ticker}   ${shortDateSlashes(snapshot.expiry_date)}   ${row.strike.toFixed(1)}P`,
        openInterest: row.put_oi,
        side: 'Put',
      },
    ])
    .sort((a, b) => b.openInterest - a.openInterest)
    .slice(0, 18)

  return (
    <TabFrame title="Open Interest" description={`${snapshot.snapshot_label} loaded from stored snapshot ${snapshot.snapshot_sequence}.`}>
      <section className="oi-report table-card">
        <div className="oi-report-heading">
          <h2>Open Interest Stats</h2>
          <p>Showing results for <strong>{contextLabel}</strong></p>
        </div>
        <table className="oi-stats-table">
          <tbody>
            <tr>
              <th>Call Open Interest Total</th>
              <td>{integer.format(snapshot.total_call_oi)}</td>
            </tr>
            <tr>
              <th>Put Open Interest Total</th>
              <td>{integer.format(snapshot.total_put_oi)}</td>
            </tr>
            <tr>
              <th>Open Interest Total</th>
              <td>{integer.format(snapshot.total_oi)}</td>
            </tr>
            <tr>
              <th>Put-Call Open Interest Ratio</th>
              <td>{number.format(putCallRatio)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="oi-report chart-card">
        <div className="oi-report-heading">
          <h2>Highest Open Interest Options</h2>
          <p>Showing results for <strong>{contextLabel}</strong></p>
        </div>
        <div className="oi-chart-body">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={contracts} layout="vertical" margin={{ top: 8, right: 72, bottom: 26, left: 24 }}>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(value) => compact.format(Number(value))} />
              <YAxis type="category" dataKey="contract" width={214} tick={{ fill: '#cbd5e1', fontSize: 11 }} tickLine={false} axisLine={false} interval={0} />
              <Tooltip cursor={false} contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }} formatter={(value) => integer.format(Number(value))} />
              <Bar dataKey="openInterest" barSize={8} radius={[0, 3, 3, 0]}>
                {contracts.map((row) => <Cell key={row.contract} fill={row.side === 'Call' ? '#14b8a6' : '#fb7185'} />)}
                <LabelList dataKey="openInterest" position="right" formatter={(value: unknown) => integer.format(Number(value))} fill="#e2e8f0" fontSize={11} fontWeight={700} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <RowsTable snapshot={snapshot} />
    </TabFrame>
  )
}

function VolumeTab({ snapshot }: { snapshot: Snapshot }) {
  const data = snapshot.rows.map((row) => ({ strike: row.strike, volume: row.volume, total_oi: row.call_oi + row.put_oi }))
  return (
    <TabFrame title="Volume" description="Volume and volume-to-open-interest data for the selected stored snapshot.">
      <SummaryGrid stats={[
        ['Total Volume', compact.format(sumRows(snapshot.rows, 'volume')), 'teal'],
        ['Top Strike', String([...data].sort((a, b) => b.volume - a.volume)[0]?.strike ?? 'n/a'), 'blue'],
        ['Avg Vol/OI', `${number.format(averageValue(data.map((row) => row.volume / Math.max(row.total_oi, 1))) * 100)}%`, 'green'],
        ['Rows', String(snapshot.rows.length), 'red'],
      ]} />
      <ChartGrid>
        <ChartCard title="Highest Volume By Strike" subtitle="Most active strikes in this snapshot">
          <HorizontalBar data={[...data].sort((a, b) => b.volume - a.volume).slice(0, 10)} dataKey="volume" nameKey="strike" color="#38bdf8" />
        </ChartCard>
        <ChartCard title="Volume vs OI" subtitle="Fresh activity compared with stored OI">
          <Composed data={data}>
            <Bar dataKey="total_oi" fill="#334155" barSize={30} />
            <Line dataKey="volume" stroke="#facc15" strokeWidth={2} dot={false} />
          </Composed>
        </ChartCard>
      </ChartGrid>
      <MiniTable rows={data} columns={['strike', 'volume', 'total_oi']} />
    </TabFrame>
  )
}

function GammaExposureTab({ snapshot }: { snapshot: Snapshot }) {
  return (
    <TabFrame title="Gamma Exposure" description="Strike-level GEX for the selected stored snapshot.">
      <ChartGrid>
        <ChartCard title="GEX By Strike" subtitle="Positive and negative gamma exposure">
          <Composed data={snapshot.rows}>
            <Bar dataKey="total_gex" barSize={30}>
              {snapshot.rows.map((row) => <Cell key={row.strike} fill={row.total_gex >= 0 ? '#22c55e' : '#fb7185'} />)}
            </Bar>
            <ReferenceLine y={0} stroke="#64748b" />
            <ReferenceLine x={snapshot.underlying_price} stroke="#f8fafc" strokeDasharray="4 4" label="Price" />
          </Composed>
        </ChartCard>
        <ChartCard title="Call GEX vs Put GEX" subtitle="Side-specific exposure by strike">
          <Composed data={snapshot.rows}>
            <Line dataKey="call_gex" stroke="#14b8a6" strokeWidth={2} dot={false} />
            <Line dataKey="put_gex" stroke="#fb7185" strokeWidth={2} dot={false} />
          </Composed>
        </ChartCard>
      </ChartGrid>
      <RowsTable snapshot={snapshot} />
    </TabFrame>
  )
}

function VolatilitySkewTab({ snapshot }: { snapshot: Snapshot }) {
  const data = snapshot.rows.map((row) => {
    const distance = Math.abs(row.strike - snapshot.underlying_price)
    return {
      strike: row.strike,
      call_iv: Number((18 + distance / 8 + row.call_oi / 9000).toFixed(2)),
      put_iv: Number((20 + distance / 7 + row.put_oi / 8500).toFixed(2)),
    }
  })
  return (
    <TabFrame title="Volatility Skew" description="Derived IV skew view for the selected stored snapshot.">
      <SummaryGrid stats={[
        ['Avg Call IV', `${number.format(averageValue(data.map((row) => row.call_iv)))}%`, 'green'],
        ['Avg Put IV', `${number.format(averageValue(data.map((row) => row.put_iv)))}%`, 'red'],
        ['Skew Width', `${number.format(Math.max(...data.map((row) => row.put_iv - row.call_iv)))} pts`, 'teal'],
        ['Expiry', snapshot.expiry_type, 'blue'],
      ]} />
      <ChartGrid>
        <ChartCard title="Call IV vs Put IV" subtitle="Synthetic skew from stored OI distribution">
          <Composed data={data}>
            <Line dataKey="call_iv" stroke="#14b8a6" strokeWidth={2} dot={false} />
            <Line dataKey="put_iv" stroke="#fb7185" strokeWidth={2} dot={false} />
            <ReferenceLine x={snapshot.underlying_price} stroke="#f8fafc" strokeDasharray="4 4" label="Price" />
          </Composed>
        </ChartCard>
        <ChartCard title="Skew Table" subtitle="Strike-level IV values">
          <MiniTable rows={data.filter((_, index) => index % 2 === 0)} columns={['strike', 'call_iv', 'put_iv']} />
        </ChartCard>
      </ChartGrid>
    </TabFrame>
  )
}

function GreeksTab({ snapshot }: { snapshot: Snapshot }) {
  const data = snapshot.rows.map((row) => {
    const distance = snapshot.underlying_price - row.strike
    const moneyness = Math.max(0, 1 - Math.abs(distance) / 75)
    return {
      strike: row.strike,
      delta_call: Number(Math.max(0.03, Math.min(0.97, 0.5 + distance / 115)).toFixed(3)),
      delta_put: Number(Math.max(-0.97, Math.min(-0.03, -0.5 + distance / 115)).toFixed(3)),
      gamma: Number((0.006 + moneyness * 0.066).toFixed(4)),
      theta: Number((-0.025 - moneyness * 0.18).toFixed(3)),
      vega: Number((0.16 + moneyness * 1.45).toFixed(3)),
    }
  })
  return (
    <TabFrame title="Greeks" description="Delta, gamma, theta, and vega derived from the selected snapshot strikes.">
      <ChartGrid>
        <ChartCard title="Delta By Strike" subtitle="Call and put delta curves">
          <Composed data={data}>
            <Line dataKey="delta_call" stroke="#14b8a6" strokeWidth={2} dot={false} />
            <Line dataKey="delta_put" stroke="#fb7185" strokeWidth={2} dot={false} />
            <ReferenceLine x={snapshot.underlying_price} stroke="#f8fafc" strokeDasharray="4 4" label="Price" />
          </Composed>
        </ChartCard>
        <ChartCard title="Gamma / Theta / Vega" subtitle="Core greek metrics by strike">
          <Composed data={data}>
            <Line dataKey="gamma" stroke="#60a5fa" strokeWidth={2} dot={false} />
            <Line dataKey="theta" stroke="#fb7185" strokeWidth={2} dot={false} />
            <Line dataKey="vega" stroke="#facc15" strokeWidth={2} dot={false} />
          </Composed>
        </ChartCard>
      </ChartGrid>
      <MiniTable rows={data} columns={['strike', 'delta_call', 'delta_put', 'gamma', 'theta', 'vega']} />
    </TabFrame>
  )
}

function ExpectedMoveTab({ snapshot }: { snapshot: Snapshot }) {
  const lower = snapshot.underlying_price - snapshot.expected_move
  const upper = snapshot.underlying_price + snapshot.expected_move
  const data = [
    { label: 'Lower', price: lower },
    { label: 'Current', price: snapshot.underlying_price },
    { label: 'Upper', price: upper },
  ]
  return (
    <TabFrame title="Expected Move" description="Expected range around current price for the selected snapshot.">
      <SummaryGrid stats={[
        ['Expected Move', currency.format(snapshot.expected_move), 'teal'],
        ['Lower Range', currency.format(lower), 'red'],
        ['Upper Range', currency.format(upper), 'green'],
        ['Days To Expiry', String(snapshot.days_to_expiry), 'blue'],
      ]} />
      <ChartGrid>
        <ChartCard title="Expected Range" subtitle="Lower, current, and upper range">
          <SimpleBar data={data} dataKey="price" xKey="label" color="#14b8a6" />
        </ChartCard>
        <ChartCard title="Expected Move Table" subtitle="Stored on snapshot metadata">
          <MiniTable rows={[{ expected_move: snapshot.expected_move, lower, current: snapshot.underlying_price, upper }]} columns={['expected_move', 'lower', 'current', 'upper']} />
        </ChartCard>
      </ChartGrid>
    </TabFrame>
  )
}

function DeltaExposureTab({ snapshot }: { snapshot: Snapshot }) {
  const data = snapshot.rows.map((row) => {
    const distance = snapshot.underlying_price - row.strike
    const callDelta = Math.max(0.03, Math.min(0.97, 0.5 + distance / 115))
    const putDelta = Math.max(-0.97, Math.min(-0.03, -0.5 + distance / 115))
    const call_dex = Math.round(row.call_oi * callDelta * 100)
    const put_dex = Math.round(row.put_oi * putDelta * 100)
    return { strike: row.strike, call_dex, put_dex, total_dex: call_dex + put_dex }
  })
  return (
    <TabFrame title="Delta Exposure (DEX)" description="Strike-level delta exposure derived from selected snapshot OI.">
      <SummaryGrid stats={[
        ['Net DEX', compact.format(sumGeneric(data, 'total_dex')), sumGeneric(data, 'total_dex') >= 0 ? 'green' : 'red'],
        ['Call DEX', compact.format(sumGeneric(data, 'call_dex')), 'green'],
        ['Put DEX', compact.format(sumGeneric(data, 'put_dex')), 'red'],
        ['Snapshot', String(snapshot.snapshot_sequence), 'blue'],
      ]} />
      <ChartGrid>
        <ChartCard title="DEX By Strike" subtitle="Positive and negative delta exposure">
          <Composed data={data}>
            <Bar dataKey="total_dex" barSize={30}>
              {data.map((row) => <Cell key={row.strike} fill={row.total_dex >= 0 ? '#22c55e' : '#fb7185'} />)}
            </Bar>
            <ReferenceLine y={0} stroke="#64748b" />
          </Composed>
        </ChartCard>
        <ChartCard title="DEX Table" subtitle="Call, put, and total DEX">
          <MiniTable rows={data} columns={['strike', 'call_dex', 'put_dex', 'total_dex']} />
        </ChartCard>
      </ChartGrid>
    </TabFrame>
  )
}

function UnusualOptionsTab({ snapshot }: { snapshot: Snapshot }) {
  const data = snapshot.rows
    .map((row) => {
      const total_oi = row.call_oi + row.put_oi
      return {
        strike: row.strike,
        volume: row.volume,
        total_oi,
        volume_oi_ratio: Number((row.volume / Math.max(total_oi, 1)).toFixed(3)),
        activity_score: Math.round(row.volume * 0.6 + total_oi * 0.08 + Math.abs(row.total_gex) / 120),
      }
    })
    .sort((a, b) => b.activity_score - a.activity_score)
  return (
    <TabFrame title="Unusual Options" description="Activity ranking derived from volume, OI, and GEX in the stored snapshot.">
      <SummaryGrid stats={[
        ['Top Strike', String(data[0]?.strike ?? 'n/a'), 'teal'],
        ['Top Score', compact.format(data[0]?.activity_score ?? 0), 'blue'],
        ['Top Vol/OI', number.format(data[0]?.volume_oi_ratio ?? 0), 'green'],
        ['Contracts', String(data.length), 'red'],
      ]} />
      <ChartGrid>
        <ChartCard title="Unusual Activity Ranking" subtitle="Highest composite activity score">
          <HorizontalBar data={data.slice(0, 10)} dataKey="activity_score" nameKey="strike" color="#facc15" />
        </ChartCard>
        <ChartCard title="Volume / OI Ratio" subtitle="Fresh activity against existing positioning">
          <SimpleBar data={data.slice(0, 12)} dataKey="volume_oi_ratio" xKey="strike" color="#fb7185" />
        </ChartCard>
      </ChartGrid>
      <MiniTable rows={data.slice(0, 14)} columns={['strike', 'volume', 'total_oi', 'volume_oi_ratio', 'activity_score']} />
    </TabFrame>
  )
}

function ProbabilityTab({ snapshot }: { snapshot: Snapshot }) {
  const data = snapshot.rows.map((row) => ({ price: row.strike, probability: row.probability }))
  return (
    <TabFrame title="Probability Distribution" description="Modeled probability curve by price level.">
      <ChartGrid>
        <ChartCard title="Probability Curve" subtitle="Current price is shown as a dashed line">
          <Composed data={data}>
            <Area dataKey="probability" fill="#60a5fa" stroke="#60a5fa" fillOpacity={0.28} />
            <ReferenceLine x={snapshot.underlying_price} stroke="#f8fafc" strokeDasharray="4 4" label="Current" />
          </Composed>
        </ChartCard>
        <ChartCard title="Probability Levels" subtitle="Sampled directly from stored snapshot rows">
          <MiniTable rows={data.filter((_, index) => index % 3 === 0)} columns={['price', 'probability']} />
        </ChartCard>
      </ChartGrid>
    </TabFrame>
  )
}

function MaxPainTab({ snapshot }: { snapshot: Snapshot }) {
  const data = snapshot.rows.map((row) => ({
    strike: row.strike,
    payout: Math.abs(row.strike - snapshot.max_pain) * (row.call_oi + row.put_oi),
  }))
  return (
    <TabFrame title="Max Pain" description="Max pain is stored per snapshot and visualized against payout distance.">
      <SummaryGrid stats={[
        ['Max Pain', currency.format(snapshot.max_pain), 'teal'],
        ['Current Price', currency.format(snapshot.underlying_price), 'blue'],
        ['Distance', currency.format(Math.abs(snapshot.underlying_price - snapshot.max_pain)), 'red'],
        ['Snapshot', String(snapshot.snapshot_sequence), 'green'],
      ]} />
      <ChartGrid>
        <ChartCard title="Max Pain Payout Curve" subtitle="Lower area near the stored max pain point">
          <Composed data={data}>
            <Area dataKey="payout" fill="#0f766e" stroke="#14b8a6" fillOpacity={0.28} />
            <ReferenceLine x={snapshot.max_pain} stroke="#facc15" strokeDasharray="4 4" label="Max pain" />
          </Composed>
        </ChartCard>
        <ChartCard title="Max Pain Metadata" subtitle="Snapshot-specific max pain value">
          <MiniTable rows={[metadataRow(snapshot)]} columns={['ticker', 'expiry_date', 'snapshot_label', 'max_pain', 'expected_move']} />
        </ChartCard>
      </ChartGrid>
    </TabFrame>
  )
}

function TabFrame({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="tab-frame">
      <div className="tab-heading">
        <div>
          <p className="eyebrow">Analytics view</p>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

function FilterSelect({ label, value, options, onChange, optionLabels, icon: Icon }: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
  optionLabels?: Record<string, string>
  icon?: typeof Search
}) {
  return (
    <label className="filter-select">
      <span>{Icon && <Icon size={14} />} {label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option} value={option}>{optionLabels?.[option] ?? option}</option>)}
      </select>
      <ChevronDown size={14} className="select-chevron" />
    </label>
  )
}

function SummaryGrid({ stats }: { stats: [string, string, string][] }) {
  return <div className="summary-grid">{stats.map(([label, value, tone]) => <SummaryStatCard key={label} label={label} value={value} tone={tone} />)}</div>
}

function SummaryStatCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className={`summary-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function ChartGrid({ children }: { children: React.ReactNode }) {
  return <div className="chart-grid">{children}</div>
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <article className="chart-card">
      <div className="chart-title">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
      </div>
      <div className="chart-body">{children}</div>
    </article>
  )
}

function Composed({ data, children }: { data: unknown[]; children: React.ReactNode }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 12, right: 12, bottom: 8, left: 0 }}>
        <CartesianGrid stroke="#243044" strokeDasharray="3 3" />
        <XAxis dataKey={detectXKey(data)} tick={{ fill: '#94a3b8', fontSize: 11 }} />
        <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(value) => compact.format(Number(value))} />
        <Tooltip cursor={false} contentStyle={{ background: '#101827', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0' }} />
        <Legend wrapperStyle={{ color: '#cbd5e1', fontSize: 12 }} />
        {children}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function HorizontalBar({ data, dataKey, nameKey, color }: { data: Record<string, number | string>[]; dataKey: string; nameKey: string; color: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 18, bottom: 8, left: 20 }}>
        <CartesianGrid stroke="#243044" strokeDasharray="3 3" />
        <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(value) => compact.format(Number(value))} />
        <YAxis type="category" dataKey={nameKey} tick={{ fill: '#94a3b8', fontSize: 11 }} width={48} />
        <Tooltip cursor={false} contentStyle={{ background: '#101827', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0' }} />
        <Bar dataKey={dataKey} fill={color} barSize={18} maxBarSize={18} radius={[0, 6, 6, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function SimpleBar({ data, dataKey, xKey, color }: { data: Record<string, number | string>[]; dataKey: string; xKey: string; color: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
        <CartesianGrid stroke="#243044" strokeDasharray="3 3" />
        <XAxis dataKey={xKey} tick={{ fill: '#94a3b8', fontSize: 11 }} />
        <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(value) => compact.format(Number(value))} />
        <Tooltip cursor={false} contentStyle={{ background: '#101827', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0' }} />
        <Bar dataKey={dataKey} fill={color} barSize={42} maxBarSize={42} radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function MiniTable({ rows, columns }: { rows: Record<string, unknown>[]; columns: string[] }) {
  return (
    <section className="table-card">
      <div className="table-heading">
        <Table2 size={17} />
        <h3>Detailed Data</h3>
      </div>
      <div className="table-scroll">
        <table>
          <thead><tr>{columns.map((column) => <th key={column}>{humanize(column)}</th>)}</tr></thead>
          <tbody>
            {rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column}>{formatCell(row[column])}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function RowsTable({ snapshot }: { snapshot: Snapshot }) {
  return <MiniTable rows={snapshot.rows} columns={['strike', 'call_oi', 'put_oi', 'call_gex', 'put_gex', 'total_gex', 'volume']} />
}

function findSnapshot(selection: Selection, sourceSnapshots: Snapshot[]) {
  return sourceSnapshots.find((snapshot) => snapshot.ticker === selection.ticker && snapshot.expiry_date === selection.expiryDate && snapshotKey(snapshot) === selection.snapshotKey)
}

function selectionFromSnapshot(snapshot: Snapshot): Selection {
  return { ticker: snapshot.ticker, expiryDate: snapshot.expiry_date, snapshotKey: snapshotKey(snapshot) }
}

function snapshotKey(snapshot: Snapshot) {
  return `${snapshot.expiry_date}_${snapshot.snapshot_sequence}`
}

function expiryLabel(snapshot: Snapshot) {
  return `${formatDate(snapshot.expiry_date)} (${snapshot.days_to_expiry} days) (${snapshot.expiry_type.charAt(0)})`
}

function metadataRow(snapshot: Snapshot) {
  return {
    ticker: snapshot.ticker,
    expiry_date: snapshot.expiry_date,
    snapshot_date: snapshot.snapshot_date,
    snapshot_sequence: snapshot.snapshot_sequence,
    snapshot_label: snapshot.snapshot_label,
    days_to_expiry: snapshot.days_to_expiry,
    expiry_type: snapshot.expiry_type,
    expiration_cadence: snapshot.expiration_cadence ?? 'n/a',
    data_path: snapshot.data_path ?? 'bundled',
    csv_path: snapshot.csv_path ?? 'bundled',
    max_pain: snapshot.max_pain,
    expected_move: snapshot.expected_move,
  }
}

function unique(values: string[]) {
  return Array.from(new Set(values)).sort()
}

function loadRemovedTickers() {
  try {
    const value = window.localStorage.getItem(removedTickersKey)
    return value ? JSON.parse(value) as string[] : []
  } catch {
    return []
  }
}

function saveRemovedTickers(tickers: string[]) {
  window.localStorage.setItem(removedTickersKey, JSON.stringify(tickers))
}

function newestSnapshot(values: Snapshot[]) {
  return [...values].sort((a, b) => `${b.snapshot_date}-${String(b.snapshot_sequence).padStart(4, '0')}`.localeCompare(`${a.snapshot_date}-${String(a.snapshot_sequence).padStart(4, '0')}`))[0]
}

function uniqueBy<T>(values: T[], getKey: (value: T) => string) {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = getKey(value)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function sumRows(rows: SnapshotRow[], key: keyof SnapshotRow) {
  return rows.reduce((total, row) => total + Number(row[key]), 0)
}

function sumGeneric(rows: Record<string, number>[], key: string) {
  return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0)
}

function averageValue(values: number[]) {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
}

function shortDateSlashes(value: string) {
  return new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: '2-digit', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
}

function detectXKey(data: unknown[]) {
  const first = data[0] as Record<string, unknown> | undefined
  if (!first) return 'strike'
  if ('strike' in first) return 'strike'
  if ('expiry_date' in first) return 'expiry_date'
  if ('price' in first) return 'price'
  if ('label' in first) return 'label'
  if ('side' in first) return 'side'
  return Object.keys(first)[0]
}

function humanize(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatCell(value: unknown) {
  if (typeof value !== 'number') return String(value)
  if (Math.abs(value) >= 100000) return compact.format(value)
  if (Math.abs(value) > 1000) return number.format(value)
  return number.format(value)
}

export default App
