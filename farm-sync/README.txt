====================================================================
  CMS SYNC - RUNS FROM THE FARM PC
====================================================================

  WHY THIS EXISTS

  Custom Meat Solutions answers 403 to our cloud server on Railway -
  its firewall does not accept logins from data centres. It does
  accept them from the farm's own connection.

  So this PC reads the orders from CMS every 5 minutes and writes
  them straight into the cloud database. The floor screen, which
  only ever reads that database, then shows the cut list exactly as
  it would have done otherwise.

  Consequence worth knowing: if this PC is off or offline, the cut
  list stops updating. It does not go blank - it keeps showing the
  last good data and turns the header red with SYNC STALE once the
  data is over 30 minutes old.


--------------------------------------------------------------------
  WHAT YOU NEED FIRST
--------------------------------------------------------------------

  server\.env on this PC must contain four things:

      CMS_USERNAME=...       your CMS login
      CMS_PASSWORD=...       your CMS password
      CMS_PIN=...            the read-only employee PIN
      DATABASE_URL=...       the Railway Postgres connection string

  The first three are already set. For DATABASE_URL, open Railway,
  click the Postgres service, go to Variables (or Connect), and copy
  the PUBLIC connection URL - the one starting postgresql:// that
  contains a hostname ending in .proxy.rlwy.net or similar. The
  internal .railway.internal address will NOT work from here.

  That file is gitignored and never leaves this PC.


--------------------------------------------------------------------
  SETUP
--------------------------------------------------------------------

  install-farm-sync.bat
        Registers the task, then runs one sync so you can see it
        work. Run it once.

  remove-farm-sync.bat
        Stops the syncing again.


--------------------------------------------------------------------
  CHECKING IT
--------------------------------------------------------------------

  sync.log in this folder gets a line per run, newest at the bottom:

      Fri 09/07/2026 08:31:02.11  sync ok

  In the ERP, the Cut list tab shows when the last successful sync
  happened. The floor screen shows "Last synced HH:MM" in its header.

  A run that reads no detail pages is normal and good - it means
  nothing changed in CMS since the last poll, so it skipped them.


--------------------------------------------------------------------
  IF IT STOPS WORKING
--------------------------------------------------------------------

  Open sync.log and read the last few lines.

  "CMS login was rejected"
        The password or PIN changed, or the account was locked.
        Fix server\.env.

  "could not load the CMS order list page"
        CMS changed its pages, or is down. If it is down, it will
        recover on its own; if the pages changed, the log says what
        it could not find.

  "connect ETIMEDOUT" / "ENOTFOUND"
        This PC cannot reach the database or the internet. Check the
        connection, and that DATABASE_URL is the public URL.

  Nothing in the log at all
        The scheduled task is not running. Open Task Scheduler and
        look for "Chapel Ford CMS Sync", or run
        install-farm-sync.bat again.


--------------------------------------------------------------------
  LONGER TERM
--------------------------------------------------------------------

  This is a workaround for the 403. If CMS support will allowlist the
  server's address, the sync can move back to the cloud and this PC
  stops mattering. Railway can provide a fixed outbound IP to give
  them. Ask for that, and once it works, run remove-farm-sync.bat.

====================================================================
