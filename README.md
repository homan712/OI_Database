# OI Database

Dark options analytics dashboard for stored option open-interest snapshots.

## Current Flow

```text
data/{ticker}/{expiry}/snapshot_{snapshot_date}_{sequence}.json
  -> local API reads all JSON snapshots from disk
  -> app loads snapshots from /api/snapshots
  -> user selects ticker
  -> user selects expiry
  -> user selects snapshot version
  -> Apply loads that exact stored snapshot
  -> tabs render charts and tables from that snapshot
```

If the local API is not running, the app falls back to bundled JSON snapshots included at build/dev-server start.

Old snapshots are not overwritten. If the same expiry is collected multiple times, it gets multiple files:

```text
data/SPY/2026-07-10/
  snapshot_2026-07-06_01.json
  snapshot_2026-07-06_01.csv
  snapshot_2026-07-10_02.json
  snapshot_2026-07-10_02.csv
```

## Views

- Open Interest
- Volume
- Max Pain
- Volatility Skew
- Greeks
- Expected Move
- Probability Distribution
- Gamma Exposure (GEX)
- Delta Exposure (DEX)
- Unusual Options

No comparison selector, comparison table, difference calculation, or Snapshot Comparison tab exists right now.

## Generate Demo Data

```bash
node scripts/generate-demo-data.mjs
```

## Collect Real Data

This collects real option-chain data from Yahoo Finance through `yahoo-finance2` and writes new JSON + CSV snapshot files without overwriting old snapshots.

```bash
npm run collect:real
```

Optional:

```bash
npm run collect:real -- --tickers SPY,QQQ,NVDA,SPCX --date 2026-07-06
```

The dashboard's **Fetch Data** button calls the local API, writes fresh JSON + CSV files into `data/`, then reloads the snapshot list from disk.

## Local Data API

```bash
npm run api
```

Endpoints:

- `GET /api/snapshots` reads all snapshot JSON files from `data/` and includes CSV paths.
- `POST /api/fetch-data` fetches real option-chain data and writes new JSON + CSV snapshots.

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Smoke Test

Start the dev server, then run:

```bash
npm run smoke
```

## GitHub Pipeline

This project includes GitHub Actions workflows in `.github/workflows/`:

- `ci.yml` runs lint, build, and smoke tests on push or pull request.
- `deploy-pages.yml` builds `dist/` and deploys the static dashboard to GitHub Pages.
- `collect-data.yml` runs the real option data collector on a weekday schedule and commits new JSON + CSV snapshots under `data/`.

For GitHub Pages, set the repository Pages source to **GitHub Actions**.

The deployed GitHub Pages site is static. It can display committed snapshot data, but the local **Fetch Data** button only works when running `start_OI_Database.bat` because it needs the local Node API.
