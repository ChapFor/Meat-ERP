# Chapel Ford Meat ERP — Phase 1

Inventory + order entry + pack-to-order with GS1-128 case labels.
VistaTrac-style foundation; batching/yields and QuickBooks export bolt on next.

## Layout
- `server/` — Node/Express API + Postgres schema (migrations, seed)
- `client/` — React app: Station (weigh + print), Scan-in, Inventory, Orders,
  Packing, Customers, Items
- `station/` — local hardware bridge for the station PC (scale serial + ZT411
  raw ZPL) + label reference and integration notes

## Case lifecycle
PRINT (station) → **PENDING** → scan-in → **IN_STOCK** → pack scan → **ALLOCATED**
→ ship → **SHIPPED**. Misprints stay PENDING and get voided; the Scan-in screen
shows a live "printed, not yet scanned" list so nothing goes missing.

## Run locally
1. Postgres running; copy `server/.env.example` → `server/.env`, set `DATABASE_URL`.
2. `cd server && npm install && npm run migrate && npm run seed && npm run dev`
   (`npm run migrate` applies `001`; apply later migrations with
   `psql "$DATABASE_URL" -f migrations/NNN_*.sql`)
3. `cd client && npm install && npm run dev` → http://localhost:5173

## Deploy (Railway or similar)
- Provision Postgres, set `DATABASE_URL`, run `npm run migrate && npm run seed` once.
- `cd client && npm run build`, then `cd server && npm start` — the API serves
  `client/dist` itself, so one service hosts everything.
- On the station PC: open the deployed app in Chrome (Station tab) and run the
  local bridge — see `station/bridge/README.md`.

## Next phases
- Batching + yield tracking (live weight in → cut weights out per lot)
- Shipping confirmation + BOL / pack slip PDF
- QuickBooks invoice export (IIF/CSV first, QBO API later) driven by shipped case weights
