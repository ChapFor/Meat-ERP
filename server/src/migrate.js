// Migration runner. Applies every un-applied file in server/migrations/ in
// filename order, inside a transaction each, and records them in
// schema_migrations. Runs on boot (see index.js) so a Railway deploy migrates
// itself — no psql on the operator's machine required.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pool } from './db.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../migrations');
const LOCK_KEY = 8412266; // any constant; serialises concurrent boots

export async function migrate() {
  const client = await pool.connect();
  try {
    // Hold the lock across the whole run so two instances can't both apply.
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const done = new Set((await client.query('SELECT filename FROM schema_migrations')).rows
      .map((r) => r.filename));

    // Baseline: databases created before this runner existed already have 001
    // applied but no ledger, and 001 is not re-runnable (bare CREATE TABLE).
    if (done.size === 0 && files.length) {
      const present = (await client.query(
        `SELECT to_regclass('public.products') IS NOT NULL AS ok`)).rows[0].ok;
      if (present) {
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [files[0]]);
        done.add(files[0]);
        console.log(`migrate: baselined ${files[0]} (schema already present)`);
      }
    }

    const pending = files.filter((f) => !done.has(f));
    if (!pending.length) {
      console.log(`migrate: up to date (${files.length} applied)`);
      return;
    }
    for (const f of pending) {
      console.log(`migrate: applying ${f}`);
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [f]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`migration ${f} failed: ${e.message}`);
      }
    }
    console.log(`migrate: applied ${pending.length} migration(s)`);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  }
}

// also runnable directly: npm run migrate
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrate()
    .then(() => pool.end())
    .catch((e) => { console.error(e.message); process.exit(1); });
}
