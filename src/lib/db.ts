/**
 * PostgreSQL connection pool + schema initialization.
 *
 * Uses node-postgres (pg). The pool is global so serverless functions
 * reuse connections across warm invocations.
 *
 * DATABASE_URL must be set in the environment (e.g. Neon, Supabase, etc.).
 */

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { SCHEMA_STATEMENTS } from './schema';

declare global {
  var __oneMinytPool: Pool | undefined;
  var __oneMinytSchemaReady: Promise<void> | undefined;
}

function getPool(): Pool {
  if (global.__oneMinytPool) return global.__oneMinytPool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Missing DATABASE_URL — set it in your environment (e.g. .env.local)');
  }

  const pool = new Pool({
    connectionString,
    // Neon requires SSL. The connection string uses sslmode=verify-full
    // (which pg currently treats as verify-full). We still set rejectUnauthorized
    // to false because Neon's pooler certificate chain doesn't match the host,
    // so full verification would fail. This is safe in transit (TLS is used)
    // but doesn't pin the CA — acceptable for a serverless pooled connection.
    ssl: { rejectUnauthorized: false },
    // Conservative pool size for serverless — each function instance gets its own pool.
    max: 5,
    idleTimeoutMillis: 10_000,
    // Allow Neon up to 15s to wake a sleeping connection on cold-start before
    // giving up. The default 10s is too tight: Neon's compute can take ~12s to
    // resume after a long idle period, and a slow acquire here would cascade
    // into a route render timeout.
    connectionTimeoutMillis: 15_000,
    // Keep the TCP socket warm so we don't lose it to a middlebox idle reaper.
    // Neon's pooler is happy with this; for other Postgres hosts it's a no-op.
    keepAlive: true,
    // Bound any single statement so a runaway query can't burn the whole
    // 10-second synchronous-function budget Netlify gives us.
    statement_timeout: 8_000,
  });

  pool.on('error', (err) => {
    console.error('Unexpected error on idle pg client', err);
  });

  global.__oneMinytPool = pool;
  return pool;
}

/** Ensure the schema exists. Runs once per cold start; subsequent calls are no-ops. */
function ensureSchema(): Promise<void> {
  if (global.__oneMinytSchemaReady) return global.__oneMinytSchemaReady;

  global.__oneMinytSchemaReady = (async () => {
    const pool = getPool();
    const client = await pool.connect();
    try {
      for (const stmt of SCHEMA_STATEMENTS) {
        await client.query(stmt);
      }

      // Seed default folders if none exist.
      const { rows } = await client.query('SELECT COUNT(*) as n FROM folders');
      const count = Number(rows[0].n);
      if (count === 0) {
        const now = Math.floor(Date.now() / 1000);
        await client.query(
          `INSERT INTO folders (id, name, color, position, created_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (name) DO NOTHING`,
          ['seed-watch-later', 'Watch Later', '#5b9eff', 0, now],
        );
        await client.query(
          `INSERT INTO folders (id, name, color, position, created_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (name) DO NOTHING`,
          ['seed-reference', 'Reference', '#7c5cff', 1, now],
        );
      }
    } finally {
      client.release();
    }
  })();

  // Clear the cached promise on failure so the next request gets a clean
  // retry. Without this, a single transient Neon blip on the first schema
  // migration would poison every subsequent getDb() call on this function
  // instance until it cold-starts again — which on serverless is rare.
  global.__oneMinytSchemaReady.catch(() => {
    if (global.__oneMinytSchemaReady) {
      // Reassign to a rejected promise; the .catch above ensures we've already
      // observed the failure, so reassigning to undefined lets the next call
      // kick off a fresh attempt.
      global.__oneMinytSchemaReady = undefined;
    }
  });

  return global.__oneMinytSchemaReady;
}

/**
 * Get a pooled client. Ensures schema is initialized first.
 * The caller is responsible for calling client.release().
 */
export async function getDb(): Promise<PoolClient> {
  await ensureSchema();
  const pool = getPool();
  return pool.connect();
}

/** Run a single query with automatic client management. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  await ensureSchema();
  const pool = getPool();
  return pool.query<T>(text, params as unknown[]);
}

/** Run a callback inside a transaction. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getDb();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Close the pool — useful for scripts and tests. */
export async function closePool(): Promise<void> {
  if (global.__oneMinytPool) {
    await global.__oneMinytPool.end();
    global.__oneMinytPool = undefined;
    global.__oneMinytSchemaReady = undefined;
  }
}
