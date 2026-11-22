export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
export const bad = (msg, extra) => new HttpError(400, msg, extra);
export const notFound = (msg = 'not found') => new HttpError(404, msg);
export const conflict = (msg, extra) => new HttpError(409, msg, extra);

// Wrap an async handler so thrown errors reach the error middleware.
export const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// The plant's calendar day (lots are dated in local time, not UTC).
export const TZ = process.env.PLANT_TZ || 'America/New_York';
export function todayISO(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export const round2 = (n) => Math.round(Number(n) * 100) / 100;
