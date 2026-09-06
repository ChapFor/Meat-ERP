# Chapel Ford Meat ERP

VistaTrac-style ERP for a pasture-raised poultry/meat farm doing wholesale.
Built: inventory, order entry, pack-to-order with GS1-128 case labels, the
weigh-label station itself, and customer/item master data.
Roadmap: batching + yield tracking, shipping docs (BOL/pack slip PDF), QuickBooks
invoice export (IIF/CSV first), simple auth (shared passcode).

## Architecture
- `server/` — Node/Express (ESM) + Postgres (`pg`). Serves `client/dist` in production.
- `client/` — React + Vite. Two shells chosen by a header switch (`cf_shell`):
  **plant** is the floor terminal (Station, Scan-in, Inventory, Packing — no
  costing, no master data) and **admin** adds Batches, Orders, Customers, Items.
  This is a display split, **not a security boundary** — there is no auth yet, so
  the API still serves costs to anyone who asks. Revisit when the shared passcode
  lands.
- `station/bridge/` — local Node service on the station PC. The browser can't open
  a COM port, a printer queue or a raw socket, so the bridge does all of it: polls
  the Mettler Toledo BC scale over serial and sends ZPL to the Zebra ZT411. The
  Station screen talks to it at `http://localhost:9410`.
- **The ZT411 is on USB.** ZPL goes through the Windows spooler with the RAW
  datatype (`print-raw.ps1` P/Invokes `winspool`, run via `-EncodedCommand` so the
  execution policy never applies) — that keeps the driver from rendering ZPL as
  text, and avoids a native npm module on the station. `printer.mode` in
  `config.json` switches between `usb` (needs `printer.name`, the exact Windows
  printer name) and `network` (tcp/9100, `printer.host`). The driver must be a
  ZPL ZDesigner one; an EPL driver prints pages of text.
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
- **Batches own lots.** `production_batches` (CUT | FORMULATE) holds one lot; the
  station picks an OPEN batch and prints into that lot, so every case is
  attributable to the run that made it. Inputs are scanned in (`batch_inputs`,
  which marks the consumed case SHIPPED and sets `lots.parent_lot_id` for
  traceability back to the carcass lot) or entered by hand. **Closing a batch
  freezes its output**: `POST /api/cases` refuses a closed lot, because a final
  yield somebody has costed must not move afterwards. Scan-in *self-heal* is
  deliberately still allowed on a closed batch — a label printed before the
  close is real product — and returns a warning saying the yield changed.
- **Cost allocation is by relative market value, never by weight.** A pound of
  breast carries more of the carcass cost than a pound of backs:
  `share = (out_lb × products.market_value_per_lb) / Σ same`. Shares need only
  prices; dollars also need `production_batches.input_cost`. If any output
  product has no market value the report returns `allocatable:false` with the
  offending names and every `allocated_cost` null — never a partial allocation
  that silently loads all the cost onto the priced items.
- Yield = output lb / input lb per product; the unaccounted line is
  `input − Σ output` (bone, trim, drip, loss) and goes negative when the
  declared carcass weight is wrong, which the report says out loud.
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
- **Scanners that drop FNC1.** Many keyboard-wedge scanners send nothing for
  FNC1 unless configured to send ASCII GS, which runs the variable-length fields
  together and makes `(91)` swallow the rest of the line. `parseScan` falls back
  to anchored patterns that pull the compact and legacy forms apart, accepted
  only when the recovered lot is a valid `YYMMDD-Bn`. Configuring the scanner is
  still the right fix — an item code containing `10` could split wrong.
  `POST /api/scan/debug` (Scanner test panel on Scan-in) shows the raw bytes,
  whether GS arrived, and how it parsed, without touching any case.
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

## CMS cut list (`server/src/cms/`)
- Pulls open wholesale orders from Custom Meat Solutions and turns them into the
  plant-floor cut list. CMS stays the system of record; `cms_*` tables are a
  **cache** and we never write back. The Floor screen reads only our database, so
  a CMS outage degrades to stale data, not a blank wall display.
- Credentials are env vars only — `CMS_USERNAME`, `CMS_PASSWORD`, optional
  `CMS_BASE_URL`. Sync stays disabled (and says so) when they are unset, so a
  deploy without them is quiet rather than erroring every five minutes.
- Login is a plain form POST to `/login` with `username`, `password` and hidden
  `login-page=site`; no CSRF token. `/custommeats/login.odb` 302s there. OTP is
  an alternative login, not a second factor — if the account is ever moved to
  OTP-only this integration stops working.
- **"Each" means a retail pack, not a piece.** 50 Each Boneless Breast = 50 packs
  = 100 breasts = 50 birds. Pack contents live in `cms_products`; quantities
  ordered in Each and in lb are never added together, and a product ordered both
  ways is reported as two rows rather than one wrong number. Unmapped products
  still appear on the floor, flagged, so nothing silently disappears.
- Parsing is **header-driven** (`parse.js`): columns are found by header text, so
  a reordered or inserted column cannot shift the data, and an unrecognisable
  page throws rather than guessing. Tests: `src/cms/parse.test.mjs`,
  `src/cms/aggregate.test.mjs` — both run with plain `node`, no database.
- Pre-Order Mode ON is demand, OFF is the cart (what is packed);
  `remaining = preorder − packed` matched on product name + order UOM. The toggle
  mechanism is a discovery item, so it is configured by `CMS_PREORDER_ON` /
  `CMS_PREORDER_OFF` URL fragments rather than hard-coded; with neither set the
  sync falls back to classifying lines by their own Item Status.
- `npm run cms:discover` dumps real HTML to `server/fixtures/` (gitignored — it
  is live order data) so the parser can be finished against actual pages.
- A `DATE` column comes back from pg as a **JS Date at local midnight**. Use
  `isoDate()` from `aggregate.js`; slicing the string gives "Wed Sep 09" and
  quietly drops every order into Upcoming, and `toISOString()` shifts the day.

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
