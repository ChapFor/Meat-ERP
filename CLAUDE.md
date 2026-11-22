# Chapel Ford Meat ERP — v2

VistaTrac-style plant-floor system for a pasture-raised poultry farm doing
wholesale. QuickBooks Online holds orders and accounting; this app runs
everything that touches a scale, a label printer or a scanner, and writes the
actual shipped pounds back to QuickBooks.

v2 is a ground-up rebuild (branch `v2`). v1 lives in git history on `main`.

## Layout
- `server/` — Node/Express (ESM) + Postgres (`pg`), plain SQL, no ORM. Serves `client/dist`.
- `client/` — React + Vite, no router (tab state in `App.jsx`), no CSS framework
  (`styles.css`). Two shells: **Plant** (Label, Ship, Lookup/Void) and **Office**
  (Orders, Inventory, Items, Lots, QuickBooks). Display split only.
- `station/agent/` — local Node service on the scale PC (port 9410). Owns the
  scale, the printer and the whole print cycle.
- `shared/` — `gs1.js` (encode/parse) and `label.js` + `case-label.zpl`, used by
  both server and agent so labels are identical wherever they are built.

## Decisions (do not change without asking)
- **No offline mode.** If the server is unreachable the station keeps printing
  only until its leased serial block runs out, then refuses.
- **Orders originate in QuickBooks Online as Estimates**: qty in cases, rate in
  $/lb. Pulled every 60 s (`server/src/qbo/sync.js`). Lines map to products by
  `products.qbo_item_id` (auto-linked when the QBO item SKU equals the PLU).
- **Write-back on manifest**: each mapped estimate line gets Qty = shipped lb,
  UnitPrice unchanged, Amount recomputed, and the description suffix
  "— Ordered X cs, shipped Y cs, Z lb". Always re-fetch the live estimate first
  (SyncToken), send the full Line list (sparse update replaces it), drop
  SubTotal lines. `QBO_CREATE_INVOICE=true` also creates a linked invoice.
  A manifested order is final locally; later QBO changes never reopen it.
- **Sub-1-second printing.** Nothing on the network sits between stable weight
  and the printer: serials are leased in blocks (`/api/station/lease`), product
  data is cached in the agent, the printer channel stays open (USB: one
  long-lived `printer-worker.ps1`, compiled once; network: one persistent
  socket on 9100), the scale is polled request/response every ~40 ms.
  The case is uploaded after the label is out (`/api/station/cases`, idempotent,
  queue persisted to `upload-queue.json`). Never add a server call to the print path.
- **Case lifecycle**: printed → `IN_STOCK` (or `ALLOCATED` when packed to order)
  → `ALLOCATED` (scanned onto an order) → `SHIPPED` (manifest). `VOID` by scan.
  The label *is* the inventory record — there is no scan-in step.
- **Scan refusals** (409 with a reason, three beeps): voided, already shipped,
  already on this order, on another order, product not on the order, line full.
  Allocation updates use `WHERE status = 'IN_STOCK'` so two scanners cannot
  double-allocate.
- A scan whose upload has not landed yet self-heals from the barcode
  (`caseFromScan`), since the barcode carries item, weight, lot and serial.
- Tare, min/max weight and shelf life live on the product (server), applied by
  the agent: scales run in gross mode.
- Lines are counted in cases (`ceil(qty_ordered)`); pounds are always the real
  catch weight.

## Barcode (unchanged from v1 — labels in the cooler still scan)
GS1-128, internal use. AIs `(3202)` net lb ×100, `(91)` PLU (numeric — GTINs
deliberately avoided), `(10)` lot as digits (`261122-B2` → `2611222`), `(21)`
serial suffix only. Serial = `{lot}-{4-digit suffix}`; suffixes are leased per lot
(max 9,999). `parseScan` accepts `]C1`, GS separators, parenthesized form,
scanners that drop FNC1, and the pre-2026-08 full encoding. Keep it that way.

## Conventions
- Migrations: numbered files in `server/migrations/`, additive, never edited
  after running; applied on boot. Tell the user when a change adds one.
- Weights in lb. Dates of lots are the plant's local day (`PLANT_TZ`, default America/New_York).
- No webfonts or CDNs. Plant UI: ≥44 px targets, mono for serials and weights.
- User preferences: concise tables, operational specifics over generic templates.

## Run and test
```
server:  cp .env.example .env && npm install && npm run dev
client:  npm install && npm run dev          (proxies /api → :3001)
agent:   cd station/agent && npm install && node agent.js --sim
tests:   cd server && TEST_DATABASE_URL=postgres://… npm test   (wipes that database)
```
The e2e test runs a mock QuickBooks, the real server and the agent in sim mode.
