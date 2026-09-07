// One CMS sync from the command line. Used by the farm PC's scheduled task
// (farm-sync/run-sync.bat) and for testing:
//   cd server && npm run cms:sync
import { loadEnv } from '../env.js';
loadEnv();
const { syncOnce } = await import('./sync.js');
const { pool } = await import('../db.js');

// Set exitCode and let the process end on its own rather than calling
// process.exit(): exit() does not flush piped stdio on Windows, which silently
// swallowed the reason for every failure — the scheduled task's log showed a
// failure with nothing above it saying why.
// A failed database connection arrives as an AggregateError whose message is
// literally "AggregateError" — useless in a log. Unwrap it to the real causes.
const describe = (e) => {
  if (!e) return 'unknown error';
  if (Array.isArray(e.errors) && e.errors.length)
    return e.errors.map((x) => x?.message || String(x)).join('; ');
  return `${e.message || e}${e.code ? ` (${e.code})` : ''}`;
};

// Check the connection string's shape before dialling. Railway shows the proxy
// host, the internal host and the full URL in different places, and pasting the
// wrong one otherwise surfaces as an opaque driver error.
function databaseUrlProblem(u) {
  if (!u) return 'DATABASE_URL is not set in server\\.env';
  if (/^\$\{\{.*\}\}$/.test(u.trim()))
    return 'DATABASE_URL is a Railway variable reference (${{...}}), which only resolves inside Railway — paste the actual URL';
  if (!/^postgres(ql)?:\/\//i.test(u))
    return `DATABASE_URL is missing the postgresql:// prefix — it looks like just a host and port ("${u.slice(0, 40)}"). ` +
      'In Railway open the Postgres service > Variables and copy DATABASE_PUBLIC_URL in full';
  if (!u.includes('@'))
    return 'DATABASE_URL has no user:password@ part — copy DATABASE_PUBLIC_URL from Railway in full';
  if (/railway\.internal/i.test(u))
    return 'DATABASE_URL is the internal address, which only works from inside Railway — use DATABASE_PUBLIC_URL (the ...proxy.rlwy.net one)';
  return null;
}

const dbProblem = databaseUrlProblem(process.env.DATABASE_URL);
if (dbProblem) {
  console.error(`sync FAILED — ${dbProblem}`);
  process.exitCode = 1;
  await pool.end().catch(() => {});
} else try {
  const r = await syncOnce();
  console.log(`sync ok — ${r.orders_seen} active order(s), ${r.orders_read} detail page(s) read`);
  process.exitCode = 0;
} catch (e) {
  console.error(`sync FAILED — ${describe(e)}`);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
