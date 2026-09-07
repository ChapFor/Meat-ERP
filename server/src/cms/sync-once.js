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

try {
  const r = await syncOnce();
  console.log(`sync ok — ${r.orders_seen} active order(s), ${r.orders_read} detail page(s) read`);
  process.exitCode = 0;
} catch (e) {
  console.error(`sync FAILED — ${describe(e)}`);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
