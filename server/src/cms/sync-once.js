// One sync from the command line, for testing on the office PC:
//   cd server && npm run cms:sync
import { syncOnce } from './sync.js';
import { pool } from '../db.js';

try {
  const r = await syncOnce({ force: process.argv.includes('--force') });
  console.log(r);
  await pool.end();
  process.exit(0);
} catch (e) {
  console.error(e.message);
  await pool.end().catch(() => {});
  process.exit(1);
}
