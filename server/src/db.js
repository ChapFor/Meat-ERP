import pg from 'pg';
const { Pool, types } = pg;
// DATE columns come back as 'YYYY-MM-DD' strings, never as local-midnight Date objects.
types.setTypeParser(1082, (v) => v);
// numeric → JS number (all our numerics are small weights and prices)
types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

const url = process.env.DATABASE_URL;
export const pool = new Pool({
  connectionString: url,
  ssl: !url || /localhost|127\.0\.0\.1|\/var\/run/.test(url) ? false : { rejectUnauthorized: false },
});
export const q = (text, params) => pool.query(text, params);

// Run fn inside a transaction with a dedicated client.
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
