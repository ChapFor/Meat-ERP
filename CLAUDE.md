# Chapel Ford Meat ERP

VistaTrac-style ERP for a pasture-raised poultry/meat farm doing wholesale.
Built: inventory, order entry, pack-to-order with GS1-128 case labels, the
weigh-label station itself, and customer/item master data.
Roadmap: batching + yield tracking, shipping docs (BOL/pack slip PDF), QuickBooks
invoice export (IIF/CSV first), simple auth (shared passcode).

## Architecture
- `server/` — Node/Express (ESM) + Postgres (`pg`). Serves `client/dist` in production.
- `client/` — React + Vite. Screens: Station, Scan-in, Inventory, Orders, Packing,
  Customers, Items.
- `station/bridge/` — local Node service on the station PC. The browser can't open
  a COM port or a raw socket, so the bridge does both: polls the Mettler Toledo BC
  scale over serial and sends ZPL to the Zebra ZT411 on tcp/9100. The Station
  screen talks to it at `http://localhost:9410`.
- Deployed on Railway: GitHub push → auto-deploy. Root `package.json` builds client
  then installs server; server serves everything on one service.

## Core domain rules (do not change without asking)
- Case lifecycle: station prints → **PENDING** → operator scans in → **IN_STOCK**
  → pack scan against an order → **ALLOCATED** → **SHIPPED**. Misprints stay
  PENDING and get voided; the Scan-in screen lists "printed, not yet scanned."
- PENDING is never sellable inventory.
- **Packs inside cases.** `cases.parent_id` self-references, so one table covers
  both levels: no parent and no children = a standalone unit (a whole chicken);
  no parent with children = a container case (a box of packs); parent set = a
  pack in that box. The station prints a label per pack, then "Close case"
  groups them and prints the case label (`POST /api/cases/container`; one
  product and one lot per case, since pack-to-order matches a line by product).
  Scanning a case label acts on its packs — scan-in admits them all, pack-to-order
  allocates the ones still IN_STOCK, un-pack releases only those that went out on
  that same order line. Scanning a single pack breaks the case open and allocates
  just that pack.
- **Counts are leaf-only.** A container and its packs both carry `order_line_id`,
  so every count and weight sum must exclude rows that have children
  (`NOT EXISTS (SELECT 1 FROM cases ch WHERE ch.parent_id = c.id)`), or shipped
  weight doubles. This applies to inventory, order lines, and customer history —
  the packs carry the catch weights that drive invoicing, the box does not.
- **Vocabulary is packs and cases**, and the API says so: `packs_in_stock` /
  `packs_allocated` / `packs_pending` and `pack_count` are leaf counts, while
  `cases_in_stock` counts containers that are still intact (nothing picked out).
  `order_lines.qty_cases` is the exception — it holds the quantity and
  `order_lines.qty_unit` (`pack` | `case`, default `pack`) says what it counts;
  the column keeps its old name to avoid a rename migration. A line ordered in
  cases is measured in **containers allocated to it**, not packs, so a case of 12
  advances a case-line by 1. `client/src/lineProgress.js` is the single place
  that decides which number a line is compared against — keep Orders and Packing
  using it rather than re-deriving. `packed_lb` is always the real leaf weight
  whatever the unit, since that is what invoicing bills.
- Lot = per batch within a day. Lot code format: `YYMMDD-B{n}` (e.g. `260812-B2`).
- Barcodes are GS1-128, internal-use only (no customer scanning). AIs:
  `(3202)` net wt lb, 6 digits, 2 implied decimals · `(91)` internal item code
  (PLU — used instead of GTINs; the farm's 11-digit GS1 prefix only allows 10
  GTINs, so we deliberately avoid GTINs) · `(10)` lot · `(21)` case serial suffix.
- **Compact encoding** (the full form is 9.3in at `^BY3` and will not fit a 4in
  label). The barcode drops `(13)` — the pack date is already the lot's YYMMDD
  prefix, and scan-in derives it from there — encodes the lot as digits
  (`260812-B2` → `2608122`) and carries only the serial suffix
  (`260812-B2-0001` → `0001`). The dash and `B` are what matter: they force Code
  128 out of numeric subset C and double their own cost. Database values keep
  their full readable forms; only the wire encoding shrinks. Measured 3.58in at
  `^BY2`, so the label prints at `^BY2` (9.85 mil, GS1 minimum).
- Item codes: numeric codes fit to 12+ chars, but **alphanumeric codes overflow
  the 4in label at 5 chars** (worst case: offline serial + batch ≥ 10). Keep
  PLUs numeric.
- Encode/parse lives in `server/src/gs1.js` — parser accepts `]C1` AIM prefix,
  ASCII GS separators, hand-typed parenthesized form, **and both the compact and
  the pre-2026-08 full encodings**, so labels already in the cooler still scan.
  It returns database-shaped values (full lot code, full serial) either way.
  Keep it that way.
- Scan-in is self-healing: if the station upload never arrived, the barcode alone
  can recreate the case (see `POST /api/scan/in`).
- Weights are lb throughout. Catch-weight business: invoicing will be driven by
  actual shipped case weights, not ordered quantities — so customer order history
  reports packed/shipped lb, not ordered qty.
- The Station screen prints offline when the cloud is down: serial generated
  locally, payload queued in localStorage, `POST /api/cases` self-heals unknown
  lots on upload. `client/src/station/gs1.js` mirrors the server encoders — keep
  the two in sync.
- Offline serial suffix must stay **numeric** (station digit + 5-digit counter
  keyed on the lot). An alphanumeric suffix pushes the symbol to 4.55in and off
  the label. 6 digits cannot collide with the server's 4-digit sequence.
- Item code (PLU) is restricted to `[A-Za-z0-9-]` because it is printed into both
  the ZPL stream (`^`/`~` are control chars) and the GS1 element string.
- Master data is editable in-app: Items (products) and Customers. Deactivating
  either is a soft flag; existing cases and orders keep their history.

## Conventions
- Migrations: numbered files in `server/migrations/`, additive only, never edited
  after being run. **Applied automatically on server boot** by `server/src/migrate.js`
  (ledger in `schema_migrations`, one transaction per file, advisory-locked). A
  failed migration aborts startup rather than serving a half-migrated schema, so
  a bad migration takes the app down — test one against a scratch database first.
  `npm run migrate` runs the same code by hand. Databases predating the runner are
  baselined at `001` automatically. Always tell the user explicitly when a change
  includes a migration.
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
bridge: cd station/bridge && npm install && cp config.example.json config.json
        (set scale.sim/printer.sim = true to run without hardware) && npm start
```

## Deploy notes
- Railway service **Root Directory must be empty** — the app lives at the repo
  root. Do not commit `node_modules/` or `client/dist/`.
