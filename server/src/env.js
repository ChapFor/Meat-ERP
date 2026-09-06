// Loads server/.env for the command-line tools.
//
// Done in code rather than with node's --env-file flag on purpose: the
// if-exists variant is not in every Node 20, and a missing file must not be an
// error (Railway supplies real environment variables instead of a file).
// Anything already set in the real environment wins, so Railway is never
// overridden by a stale local file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function loadEnv(file) {
  const target = file || path.join(path.dirname(fileURLToPath(import.meta.url)), '../.env');
  let text;
  try { text = fs.readFileSync(target, 'utf8'); }
  catch { return { loaded: false, keys: [] }; }

  const keys = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    // tolerate quoted values; a password may legitimately contain # or spaces
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (!val) continue;
    if (process.env[key] === undefined) { process.env[key] = val; keys.push(key); }
  }
  return { loaded: true, keys, file: target };
}
