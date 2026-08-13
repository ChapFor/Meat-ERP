# Weigh-label station — integrated

The station is part of the ERP itself: the **Station** tab in the web client is
the operator screen, and a small local bridge (`station/bridge/`) on the station
PC handles the hardware. There is no separate station app anymore.

```
Browser (Station tab, served from the cloud)
  ├─ https → ERP API          POST /api/cases, /api/lots  (case records)
  └─ http://localhost:9410 → bridge
       ├─ serial → Mettler Toledo BC scale   (live weight, polled)
       └─ tcp 9100 → Zebra ZT411             (raw ZPL)
```

## Flow (per case)
1. Operator picks product + lot on the Station tab (lot = pack date + batch,
   `YYMMDD-B{n}`; find-or-create via `POST /api/lots`).
2. Case on scale → live weight shows STABLE. Operator hits PRINT (or enables
   auto-print: fires on stable weight ≥ 1 lb, re-arms when the scale empties).
3. The tab POSTs `/api/cases` → gets `serial`, `zpl_field_data`,
   `human_readable`; fills the label template; sends ZPL to the bridge → ZT411.
4. Case is now PENDING. It becomes sellable inventory only when scanned in on
   the Scan-in screen. Misprints are voided from the Station or Scan-in screen.

## Offline mode (built into the Station tab)
If the cloud is unreachable the tab still prints:
- Serial generated locally: `{lot_code}-{stationId}{epochSecondsBase36}`.
- Barcode fields built client-side (`client/src/station/gs1.js` mirrors the
  server encoders).
- The case payload is queued in the browser (localStorage) and retried every
  30 s; `POST /api/cases` self-heals unknown lots on upload.
- Even if the queued upload is lost entirely, Scan-in recreates the case from
  the barcode alone — the label carries product, weight, date, lot, serial.

## Label template
Live template: `client/src/station/label.js` (filled in the browser).
`station/gs1128_label.zpl` is the same layout kept as a plain-ZPL reference —
keep the two in sync if the label changes.

## Barcode content (GS1-128)
| AI | Field | Format |
|----|-------|--------|
| 13 | Pack date | YYMMDD |
| 3202 | Net weight lb | 6 digits, 2 implied decimals (14.50 → 001450) |
| 91 | Internal item code | your PLU |
| 10 | Lot | e.g. 260812-B2 |
| 21 | Case serial | unique |

Internal-use only — (91) replaces a GTIN, so the 10-GTIN prefix limit never applies.

## Scanner setup
Keyboard-wedge mode. Ideally configure the scanner to transmit the AIM ID (`]C1`)
and FNC1 as ASCII GS (29) — the API parses both, and also accepts the
parenthesized human-readable string typed by hand.

## Bridge setup
See `station/bridge/README.md` (COM port, printer IP, sim mode, auto-start).
