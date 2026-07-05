import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { collectRealData } from './collect-real-data.mjs'

const port = Number(process.env.OI_API_PORT ?? 5175)

const server = http.createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5174')
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
    return
  }

  const url = new URL(request.url ?? '/', 'http://127.0.0.1')

  if (request.method === 'GET' && url.pathname === '/api/snapshots') {
    sendJson(response, 200, { snapshots: readSnapshotsFromDisk() })
    return
  }

  if (request.method !== 'POST' || url.pathname !== '/api/fetch-data') {
    sendJson(response, 404, { error: 'Not found' })
    return
  }

  try {
    const body = await readJson(request)
    const tickers = Array.isArray(body.tickers) ? body.tickers : String(body.tickers ?? '').split(',')
    const snapshotDate = body.snapshotDate || undefined
    const result = await collectRealData({ tickers, snapshotDate, log: console.log })
    sendJson(response, 200, result)
  } catch (error) {
    sendJson(response, 500, { error: error.message })
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`OI Database API listening at http://127.0.0.1:${port}`)
})

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
      if (body.length > 1_000_000) {
        request.destroy()
        reject(new Error('Request body too large'))
      }
    })
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    request.on('error', reject)
  })
}

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(value))
}

function readSnapshotsFromDisk() {
  const dataDir = path.resolve('data')
  if (!fs.existsSync(dataDir)) return []

  return findJsonFiles(dataDir)
    .map((filePath) => {
      const snapshot = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      const csvPath = filePath.replace(/\.json$/i, '.csv')
      return {
        ...snapshot,
        data_path: path.relative(process.cwd(), filePath),
        csv_path: fs.existsSync(csvPath) ? path.relative(process.cwd(), csvPath) : '',
      }
    })
    .sort((a, b) => `${a.ticker}-${a.expiry_date}-${a.snapshot_sequence}`.localeCompare(`${b.ticker}-${b.expiry_date}-${b.snapshot_sequence}`))
}

function findJsonFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) return findJsonFiles(fullPath)
    return entry.isFile() && entry.name.endsWith('.json') ? [fullPath] : []
  })
}
