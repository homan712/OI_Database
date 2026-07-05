import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const baseUrl = process.env.SMOKE_URL ?? 'http://127.0.0.1:5174'
const expectedTabs = [
  'Open Interest',
  'Volume',
  'Max Pain',
  'Volatility Skew',
  'Greeks',
  'Expected Move',
  'Probability Distribution',
  'Gamma Exposure (GEX)',
  'Delta Exposure (DEX)',
  'Unusual Options',
]
const failures = []

assertFile('data/SPY/2026-07-06/snapshot_2026-07-06_01.json')
assertFile('data/SPY/2026-07-10/snapshot_2026-07-06_01.json')
assertFile('data/SPY/2026-07-10/snapshot_2026-07-10_02.json')
assertFile('data/AAPL/2026-07-10/snapshot_2026-07-06_01.json')
assertFile('data/AAPL/2026-07-10/snapshot_2026-07-08_02.json')
assertFile('data/AAPL/2026-07-10/snapshot_2026-07-10_03.json')

const spyFridaySnapshots = readSnapshots('data/SPY/2026-07-10')
if (spyFridaySnapshots.length < 2) {
  failures.push(`SPY 2026-07-10 expected at least 2 snapshots, found ${spyFridaySnapshots.length}`)
}
if (!spyFridaySnapshots.some((snapshot) => snapshot.snapshot_label === 'Jul 10, 2026 (1)')) {
  failures.push('SPY Friday snapshot 1 label missing')
}
if (!spyFridaySnapshots.some((snapshot) => snapshot.snapshot_label === 'Jul 10, 2026 (2)')) {
  failures.push('SPY Friday snapshot 2 label missing')
}

const aaplWeeklySnapshots = readSnapshots('data/AAPL/2026-07-10')
if (aaplWeeklySnapshots.length !== 3) {
  failures.push(`AAPL 2026-07-10 expected 3 snapshots, found ${aaplWeeklySnapshots.length}`)
}
for (const sequence of [1, 2, 3]) {
  if (!aaplWeeklySnapshots.some((snapshot) => snapshot.snapshot_label === `Jul 10, 2026 (${sequence})`)) {
    failures.push(`AAPL weekly snapshot ${sequence} label missing`)
  }
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })

page.on('console', (message) => {
  if (message.type() === 'error') failures.push(`Console error: ${message.text()}`)
})
page.on('pageerror', (error) => failures.push(`Page error: ${error.message}`))

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForSelector('.top-tab', { timeout: 15_000 })

  const tabLabels = await page.locator('.top-tab').evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim()))
  for (const tab of expectedTabs) {
    if (!tabLabels.includes(tab)) failures.push(`Missing top tab: ${tab}`)
  }
  if (tabLabels.some((label) => label?.includes('Comparison'))) {
    failures.push('Snapshot Comparison tab should not exist')
  }

  const noComparisonUi = await page.evaluate(() => ({
    compareSelector: Array.from(document.querySelectorAll('.filter-select span')).some((node) => node.textContent?.includes('Compare')),
    comparisonPanel: Boolean(document.querySelector('.comparison-panel')),
    comparisonTable: document.body.textContent?.includes('OI Change') ?? false,
  }))
  if (noComparisonUi.compareSelector) failures.push('Compare selector should not exist')
  if (noComparisonUi.comparisonPanel) failures.push('Comparison panel should not exist')
  if (noComparisonUi.comparisonTable) failures.push('Difference calculation UI should not exist')

  await selectValue(page, 'Ticker', 'SPY')
  await selectValue(page, 'Expiry', '2026-07-10')
  await selectValue(page, 'Snapshot', '2026-07-10_1')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await expectHeading(page, 'Jul 10, 2026 expiry')
  await selectValue(page, 'Snapshot', '2026-07-10_2')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await expectHeading(page, 'snapshot 2')

  await selectValue(page, 'Ticker', 'AAPL')
  await selectValue(page, 'Expiry', '2026-07-10')
  const snapshotOptions = await getOptionsForLabel(page, 'Snapshot')
  for (const label of ['Jul 10, 2026 (1)', 'Jul 10, 2026 (2)', 'Jul 10, 2026 (3)']) {
    if (!snapshotOptions.includes(label)) failures.push(`AAPL UI missing snapshot option: ${label}`)
  }

  for (const tab of expectedTabs) {
    await page.getByRole('button', { name: tab, exact: true }).click()
    await page.waitForTimeout(50)
    const state = await page.evaluate(() => ({
      active: document.querySelector('.top-tab.active')?.textContent?.trim(),
      charts: document.querySelectorAll('.chart-card').length,
      tables: document.querySelectorAll('table').length,
    }))
    if (state.active !== tab) failures.push(`${tab}: active tab mismatch, got ${state.active}`)
    if (state.charts < 1) failures.push(`${tab}: no chart cards rendered`)
    if (state.tables < 1) failures.push(`${tab}: no table rendered`)
  }
} finally {
  await browser.close()
}

if (failures.length > 0) {
  console.error('Smoke test failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Smoke test passed for ${baseUrl}`)
console.log('Verified stored snapshots, selectable snapshot versions, and no comparison UI.')

function assertFile(filePath) {
  if (!fs.existsSync(filePath)) failures.push(`Missing file: ${filePath}`)
}

function readSnapshots(dir) {
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')))
}

async function selectValue(page, label, value) {
  await page.locator('.filter-select').filter({ hasText: label }).locator('select').selectOption(value)
}

async function getOptionsForLabel(page, label) {
  return page.locator('.filter-select').filter({ hasText: label }).locator('option').evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim()))
}

async function expectHeading(page, text) {
  const content = await page.locator('.header-copy').textContent()
  if (!content?.includes(text)) failures.push(`Expected header to include "${text}", got "${content}"`)
}
