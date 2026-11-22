# Chapel Ford ERP v2

Plant-floor inventory, labeling, pack-to-order and shipping, with orders and
invoicing in QuickBooks Online.

| Where | What |
|---|---|
| QuickBooks Online | Enter orders as **Estimates** (qty in cases, rate in $/lb). They appear in the ERP within a minute. |
| Scale station | Weigh → label prints in under a second → case is in inventory, or packed straight onto an order. |
| Shipping dock | Scan the pick ticket, scan the cases. Wrong / duplicate / void cases are refused. **Finish & manifest**. |
| Back in QuickBooks | The estimate now shows shipped pounds per line, priced per lb, with "Ordered 10 cs, shipped 10 cs, 412.60 lb". |

## Deploy on Railway
1. Railway service → Settings → Root Directory **empty**; build `npm run build`, start `npm start`.
2. Add a Postgres database and set variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | from the Railway Postgres |
| `APP_PASSCODE` | shared passcode for the web app and the station agent |
| `PUBLIC_URL` | `https://<your-app>.up.railway.app` |
| `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET` | from developer.intuit.com → your app → Keys |
| `QBO_ENVIRONMENT` | `sandbox` first, then `production` |
| `QBO_CREATE_INVOICE` | `true` to also create the invoice at manifest (default `false`) |

3. In the Intuit app, add the redirect URI `https://<your-app>.up.railway.app/qbo/callback`.
4. Open the app → Office → QuickBooks → **Connect to QuickBooks**.
5. Office → Items: add your PLUs (tare, min/max weight, shelf life) and link each to its QuickBooks item.

v2 keeps its tables in its own Postgres schema (`erp_v2`), so it can use the
same database as v1 without touching v1's data. Labels printed by v1 still scan.

## Station PC setup
See `station/agent/README.txt`.
