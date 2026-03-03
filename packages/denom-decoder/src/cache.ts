import Database from 'better-sqlite3'
import path from 'node:path'

export interface CachedTrace {
  chain_id: string
  denom_hash: string
  path: string
  base_denom: string
  resolved_at: string // ISO timestamp
}

const DB_PATH = process.env['DATA_DIR']
  ? path.join(process.env['DATA_DIR'], 'denom-cache.db')
  : './denom-cache.db'

let db: Database.Database | null = null

function getDb(): Database.Database {
  if (!db) {
    throw new Error('Cache has not been initialized. Call initCache() first.')
  }
  return db
}

/**
 * Initialize the SQLite cache. Creates the table if it does not exist.
 * Accepts an optional path override for testing (e.g. ':memory:').
 */
export function initCache(dbPath?: string): void {
  const resolvedPath = dbPath ?? DB_PATH
  db = new Database(resolvedPath)

  db.exec(`
    CREATE TABLE IF NOT EXISTS denom_traces (
      chain_id    TEXT NOT NULL,
      denom_hash  TEXT NOT NULL,
      path        TEXT NOT NULL,
      base_denom  TEXT NOT NULL,
      resolved_at TEXT NOT NULL,
      PRIMARY KEY (chain_id, denom_hash)
    )
  `)
}

/**
 * Look up a denom hash for a given chain. Returns null on cache miss.
 */
export function getCache(chainId: string, hash: string): CachedTrace | null {
  const row = getDb()
    .prepare<[string, string], CachedTrace>(
      'SELECT chain_id, denom_hash, path, base_denom, resolved_at FROM denom_traces WHERE chain_id = ? AND denom_hash = ?'
    )
    .get(chainId, hash)

  return row ?? null
}

/**
 * Persist a resolved denom trace to the cache.
 */
export function setCache(
  chainId: string,
  hash: string,
  tracePath: string,
  baseDenom: string
): void {
  const now = new Date().toISOString()

  getDb()
    .prepare(
      `INSERT INTO denom_traces (chain_id, denom_hash, path, base_denom, resolved_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(chain_id, denom_hash) DO UPDATE SET
         path        = excluded.path,
         base_denom  = excluded.base_denom,
         resolved_at = excluded.resolved_at`
    )
    .run(chainId, hash, tracePath, baseDenom, now)
}

/**
 * Return aggregate stats about the current cache contents.
 */
export function getCacheStats(): {
  total: number
  oldest: string | null
  newest: string | null
} {
  const row = getDb()
    .prepare<
      [],
      { total: number; oldest: string | null; newest: string | null }
    >(
      'SELECT COUNT(*) AS total, MIN(resolved_at) AS oldest, MAX(resolved_at) AS newest FROM denom_traces'
    )
    .get()

  return row ?? { total: 0, oldest: null, newest: null }
}
