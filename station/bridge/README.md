# Station bridge — setup (one-time, on the station PC)

Tiny local service that gives the ERP's **Station** tab access to the hardware:
reads the Mettler Toledo BC scale over serial and sends raw ZPL to the ZT411.
Runs at `http://localhost:9410`. No cloud dependency — it works identically
when the internet is down.

## Install

1. Install Node 18+ on the station PC.
2. Copy this `station/bridge/` folder to the PC (e.g. `C:\meat-erp-bridge`).
3. `npm install`
4. `copy config.example.json config.json` and edit:
   - `scale.port` — the scale's COM port (Device Manager → Ports). BC scale
     should be in a polled serial mode (NCI is the usual default: 9600 7E1,
     responds to `W`+CR). If yours is set to a different protocol, adjust
     `pollCmd`, or switch the scale to NCI.
   - `printer.host` — the ZT411's IP address (print a network config label
     from the printer menu to find it). Give the printer a DHCP reservation
     in the router so the IP never moves.
5. `npm start` — you should see `scale: open on COM3` and the bridge URL.
6. Open the ERP in Chrome → Station tab. Bridge / Scale / Printer dots go green.

## Testing without hardware

Set `"sim": true` under `scale` and/or `printer` in config.json. The sim scale
cycles empty → ramp → stable hold; the sim printer logs the ZPL to the console.

## Auto-start on boot

Task Scheduler → Create Task:
- Trigger: At log on. Action: Start a program —
  Program: `node`, Arguments: `bridge.js`, Start in: `C:\meat-erp-bridge`.
- Settings: restart every 1 minute if the task fails.

(Or use `nssm install meat-erp-bridge` to run it as a Windows service.)

## Troubleshooting

- **Bridge dot red in the ERP**: bridge not running, or Chrome blocked the
  local request — bridge answers the private-network preflight, so this
  normally just means the process is down.
- **Scale dot red**: wrong COM port, port in use by the old station app, or
  wrong protocol/baud. Close anything else that opens the COM port.
- **Printer dot red**: wrong IP, printer asleep/off, or port 9100 disabled in
  the printer's network settings.
- No scale? The Station tab falls back to manual weight entry automatically.
