# Chapel Ford Meat ERP

VistaTrac-style ERP for a pasture-raised poultry/meat farm doing wholesale.
Phase 1 (built): inventory, order entry, pack-to-order with GS1-128 case labels.
Roadmap: batching + yield tracking, shipping docs (BOL/pack slip PDF), QuickBooks
invoice export (IIF/CSV first), simple auth (shared passcode), station integration.

## Architecture
- `server/` — Node/Express (ESM) + Postgres (`pg`). Serves `client/dist` in production.
- `client/` — React + Vite. Four screens: Scan-in, Inventory, Orders, Packing.
- `station/` — ZPL GS1-128 template + integration notes for the Zebra ZT411
  weigh-label station (Mettler Toledo BC scale, Windows PC, keyboard-wedge scanners).
- Deployed on Railway: GitHub push → auto-deploy. Root `package.json` builds client
  then installs server; server serves everything on one service.

## Core domain rules (do not change without asking)
- Case lifecycle: station prints → **PENDING** → operator scans in → **IN_STOCK**
  → pack scan against an order → **ALLOCATED** → **SHIPPED**. Misprints stay
  PENDING and get voided; the Scan-in screen lists "printed, not yet scanned."
- PENDING is never sellable inventory.
- Lot = per batch within a day. Lot code format: `YYMMDD-B{n}` (e.g. `260812-B2`).
- Barcodes are GS1-128, internal-use only (no customer scanning). AIs:
  `(13)` pack date YYMMDD · `(3202)` net wt lb, 6 digits, 2 implied decimals ·
  `(91)` internal item code (PLU — used instead of GTINs; the farm's 11-digit GS1
  prefix only allows 10 GTINs, so we deliberately avoid GTINs) · `(10)` lot ·
  `(21)` case serial (`{lot}-{seq}`, or station-generated when offline).
- Encode/parse lives in `server/src/gs1.js` — parser accepts `]C1` AIM prefix,
  ASCII GS separators, and hand-typed parenthesized form. Keep it that way.
- Scan-in is self-healing: if the station upload never arrived, the barcode alone
  can recreate the case (see `POST /api/scan/in`).
- Weights are lb throughout. Catch-weight business: invoicing will be driven by
  actual shipped case weights, not ordered quantities.

## Conventions
- Migrations: numbered files in `server/migrations/`, additive only, never edited
  after being run. Applied manually: `psql "$DATABASE_URL" -f server/migrations/NNN_*.sql`.
  Always tell the user explicitly when a change includes a migration.
- No ORM — plain SQL via `q()` helper in `server/src/db.js`.
- API routes under `server/src/routes/`, one file per resource.
- Frontend: no router lib (tab state in `App.jsx`), no CSS framework — all styles
  in `client/src/styles.css` using the existing CSS variables. Plant-floor UI:
  big touch targets (≥48px), mono font for serials/weights, status chips.
- No webfonts or CDN dependencies — the app must work on flaky rural internet.
- User preferences: concise tables, tools matched to actual operational
  specifics, quantitative and action-oriented.

## Local dev
```
server: cp .env.example .env  → npm install && npm run migrate && npm run seed && npm run dev
client: npm install && npm run dev   (proxies /api to :3001)
```
