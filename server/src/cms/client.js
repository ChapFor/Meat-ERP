// Authenticated HTTP client for Custom Meat Solutions.
//
// This reads OUR OWN account's data on the owner's behalf. It is deliberately
// gentle: one login, a cookie reused across requests, a pause between detail
// pages, and a 5 minute poll — not a crawler.
//
// Credentials come from the environment and are never logged, echoed in errors,
// or written to the database:
//   CMS_USERNAME, CMS_PASSWORD   required to sync
//   CMS_BASE_URL                 default https://custommeatsolutions.com
//
// Discovered from the live login page (2026-09): the form is a plain POST to
// /login with username, password and a hidden login-page=site. There is no CSRF
// token. /custommeats/login.odb 302s to /login. OTP is an alternative login,
// not a required second factor — if the account is ever switched to OTP-only,
// this stops working and the sync log will say so.
const UA = 'ChapelFordFarmERP/1.0 (+own-account integration; contact the farm office)';

export const cmsConfigured = () =>
  !!(process.env.CMS_USERNAME && process.env.CMS_PASSWORD);

export class CmsClient {
  constructor({ baseUrl, username, password, log = () => {} } = {}) {
    this.base = (baseUrl || process.env.CMS_BASE_URL || 'https://custommeatsolutions.com')
      .replace(/\/+$/, '');
    // Pasting into a hosting dashboard often carries a stray space or a pair of
    // quotes into the value. Strip both: "secret" and secret must behave alike.
    const tidy = (v) => {
      if (v === undefined || v === null) return v;
      let s = String(v).trim();
      if (s.length > 1 && ((s.startsWith('"') && s.endsWith('"')) ||
                           (s.startsWith("'") && s.endsWith("'")))) s = s.slice(1, -1).trim();
      return s;
    };
    this.username = tidy(username || process.env.CMS_USERNAME);
    this.password = tidy(password || process.env.CMS_PASSWORD);
    this.pin = tidy(process.env.CMS_PIN);
    this.jar = new Map();
    this.loggedIn = false;
    this.log = log;
  }

  url(path) {
    if (/^https?:/i.test(path)) return path;
    return this.base + (path.startsWith('/') ? path : '/' + path);
  }

  cookieHeader() {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  absorb(res) {
    const set = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie')].filter(Boolean);
    for (const c of set) {
      const [pair] = String(c).split(';');
      const i = pair.indexOf('=');
      if (i > 0) this.jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }

  async raw(path, { method = 'GET', body, headers = {}, redirect = 'manual' } = {}) {
    const res = await fetch(this.url(path), {
      method, body, redirect,
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        ...(this.jar.size ? { Cookie: this.cookieHeader() } : {}),
        ...headers,
      },
    });
    this.absorb(res);
    return res;
  }

  // Follows redirects by hand so cookies set on a 302 are kept.
  async follow(path, opts = {}, hops = 5) {
    let res = await this.raw(path, opts);
    let at = this.url(path);
    while (hops-- > 0 && res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) break;
      at = new URL(loc, at).toString();
      res = await this.raw(at, { method: 'GET' });
    }
    return { res, url: at };
  }

  looksLikeLogin(html, url) {
    return /\/login\b/.test(url || '') ||
      /name=["']password["']/i.test(html || '') ||
      /Business Authentication/i.test(html || '');
  }

  // CMS has TWO gates. The business login above yields a SITE-JWT; protected
  // pages then need an employee PIN, which refreshes that same JWT with an
  // empId claim. Without it every page renders as "CMS Employee Sign In" with
  // an empty body and a modal — a 200 that contains nothing.
  // Match the gate, not the plumbing: pin-modal-trigger.js is included in the
  // global layout on EVERY page, so keying off the script name reports a locked
  // door on pages that opened fine. The signed-out shell is identifiable by its
  // title, or by the modal's own form actually being present in the body.
  looksLikePinGate(html) {
    const h = html || '';
    return /<title>[^<]*Employee Sign In/i.test(h) || /id=["']pin-login-form["']/i.test(h);
  }

  async pinLogin() {
    const pin = this.pin || process.env.CMS_PIN;
    if (!pin) throw new Error(
      'CMS wants an employee PIN after the business login, but CMS_PIN is not set');
    const res = await this.raw('/custommeats/pin-login', {
      method: 'POST',
      body: new URLSearchParams({ pin }).toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'HX-Request': 'true',          // it is an htmx endpoint; 204 means accepted
      },
    });
    if (res.status !== 204 && !res.ok)
      throw new Error(`CMS rejected the employee PIN (HTTP ${res.status}) — check CMS_PIN`);
    this.pinOk = true;
    this.log('cms: employee PIN accepted');
    return true;
  }

  async login() {
    if (!this.username || !this.password)
      throw new Error('CMS_USERNAME and CMS_PASSWORD are not set on the server');
    this.jar.clear();
    await this.raw('/login', { method: 'GET' });        // pick up a session cookie
    const body = new URLSearchParams({
      username: this.username,
      password: this.password,
      'login-page': 'site',
    }).toString();
    const { res, url } = await this.follow('/login', {
      method: 'POST', body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const html = await res.text();
    // Spring-style failure comes back at /login?error, or simply renders the form again
    const explicitError = /[?&]error/i.test(url);
    if (explicitError || this.looksLikeLogin(html, url)) {
      this.loggedIn = false;
      // Say enough to tell a wrong password apart from a block page or a
      // false positive in the detector, without echoing any credential.
      throw new Error(
        `CMS login was rejected (${explicitError ? 'redirected to ?error — credentials refused'
          : 'response still looked like the sign-in form'}; ` +
        `HTTP ${res.status}, ${html.length}b, landed on ${url}; ` +
        `username ${this.username ? this.username.length + ' chars' : 'MISSING'}, ` +
        `password ${this.password ? this.password.length + ' chars' : 'MISSING'})`);
    }
    this.loggedIn = true;
    this.log('cms: logged in');
    if (this.pin) await this.pinLogin();
    return true;
  }

  // GET a page, logging in first (or again) if we get bounced to the login form.
  async getPage(path) {
    if (!this.loggedIn) await this.login();
    let { res, url } = await this.follow(path);
    let html = await res.text();
    if (res.status === 401 || this.looksLikeLogin(html, url)) {
      this.log('cms: session expired, logging in again');
      await this.login();
      ({ res, url } = await this.follow(path));
      html = await res.text();
      if (this.looksLikeLogin(html, url))
        throw new Error(`CMS redirected ${path} to the login page even after signing in`);
    }
    // The PIN expires on its own timer, so a page can come back as the employee
    // sign-in shell mid-run. Re-enter the PIN and fetch it again.
    if (this.looksLikePinGate(html)) {
      this.log('cms: employee PIN needed, re-entering');
      await this.pinLogin();
      ({ res, url } = await this.follow(path));
      html = await res.text();
      if (this.looksLikePinGate(html))
        throw new Error(`CMS still shows the employee PIN screen for ${path} — is CMS_PIN correct?`);
    }
    if (!res.ok) throw new Error(`CMS ${path} returned ${res.status}`);
    return { html, url };
  }

  async postPage(path, fields) {
    if (!this.loggedIn) await this.login();
    const { res, url } = await this.follow(path, {
      method: 'POST',
      body: new URLSearchParams(fields).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const html = await res.text();
    if (this.looksLikeLogin(html, url)) throw new Error(`CMS bounced POST ${path} to login`);
    return { html, url };
  }
}

export const pause = (ms) => new Promise((r) => setTimeout(r, ms));
