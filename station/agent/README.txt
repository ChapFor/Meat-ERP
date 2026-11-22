CHAPEL FORD STATION AGENT  (scale PC, e.g. Chapel-Ford-Scale01)
=================================================================

The agent drives the Mettler Toledo scale and the Zebra ZT411 and runs the
whole print cycle locally, so a label prints within a second of the weight
settling. The Label screen in the browser talks to it at http://localhost:9410.

SETUP (once)
 1. Install Node.js LTS from https://nodejs.org
 2. Put the repo on the PC (git clone, or copy the whole repo folder).
    The agent needs both  station\agent  and  shared  from the repo.
 3. Double-click install.bat. It opens config.json; set:
      server     https://<your-app>.up.railway.app
      passcode   same as APP_PASSCODE on the server
      scale.port the scale's COM port (was COM6)
      printer.name  exact Windows printer name (list-printers.bat shows it),
                    currently "ZEBRA ZT411-203dpi ZPL"
 4. Double-click start.bat and check the window says the agent is running.
 5. run-at-startup.bat makes it start hidden at every login.

TEST WITHOUT HARDWARE
 start-sim.bat runs a simulated scale and printer. The Label screen then shows
 a "Simulated scale" panel to place cases.

PRINT SPEED CHECKLIST (target: label out < 1 s after the weight settles)
 - The agent logs "printed ... in N ms" for every label: time from stable
   weight until the printer accepted the job. Expect ~20-80 ms on USB.
 - Then the printer itself: a 4x3 label takes ~0.3 s at 8 in/s.
   preamble.zpl (copied from preamble.example.zpl) sets ^PR8 = 8 in/s. Raise to
   ^PR10 or ^PR12 if print quality stays good (darkness may need +1 or +2).
 - Printer menu: if the printer backfeeds before each label in tear-off mode,
   that adds ~0.2-0.4 s. Try Tear-off with backfeed set to "After" (~JSA in
   preamble.zpl) and check the first label lines up.
 - Windows printer properties > Advanced: "Print directly to the printer"
   skips spooling to disk and shaves a little more.
 - Network option: if the ZT411 is on Ethernet, set printer.mode = "network"
   and printer.host = its IP. That skips the Windows spooler entirely.
 - Scale: stable = 3 readings within 0.02 lb (config "stable"). pollMs 40.
   If your scale answers slower, the log will show it.

LABEL LAYOUT
 Default layout: shared\case-label.zpl. To customize for this station, copy it
 to station\agent\label.zpl and edit (placeholders in {CURLY_CAPS}).
 Graphics such as the USDA legend: upload once with ~DG in preamble.zpl and
 reference them with ^XG in label.zpl, so each label stays a few hundred bytes.

FILES
 upload-queue.json  cases printed but not yet confirmed by the server (do not delete)
 agent.log          output when started by run-at-startup.bat
