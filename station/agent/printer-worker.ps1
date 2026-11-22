# Long-running raw-print worker for a USB Zebra printer.
# Started ONCE by agent.js and kept alive, so the C# below is compiled once at
# startup instead of on every label (that compile was the ~1-3 s per-label
# delay in the old station).
#
# Protocol on stdin, one line per command:
#   PRINT <id> <base64 zpl>   -> "OK <id>" or "ERR <id> <message>"
#   PING <id>                 -> "OK <id>" when the printer can be opened
# The printer name comes from the CF_PRINTER environment variable.
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class CfRaw {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool OpenPrinter(string src, out IntPtr h, IntPtr pd);
  [DllImport("winspool.Drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool StartDocPrinter(IntPtr h, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);
  [DllImport("winspool.Drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.Drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", SetLastError = true)] public static extern bool WritePrinter(IntPtr h, IntPtr p, int n, out int w);

  static IntPtr handle = IntPtr.Zero;
  static string openName = null;

  static IntPtr Handle(string printer) {
    if (handle != IntPtr.Zero && openName == printer) return handle;
    if (handle != IntPtr.Zero) { ClosePrinter(handle); handle = IntPtr.Zero; }
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero))
      throw new Exception("cannot open printer '" + printer + "' (error " + Marshal.GetLastWin32Error() + ")");
    handle = h; openName = printer;
    return h;
  }

  public static void Ping(string printer) { Handle(printer); }

  // The printer handle stays open between labels; each label is one RAW job.
  public static void Send(string printer, byte[] bytes) {
    for (int attempt = 0; attempt < 2; attempt++) {
      IntPtr h = Handle(printer);
      DOCINFO di = new DOCINFO();
      di.pDocName = "ERP label"; di.pDataType = "RAW";
      if (!StartDocPrinter(h, 1, di)) {
        // a stale handle (printer unplugged and replugged): reopen once
        ClosePrinter(h); handle = IntPtr.Zero;
        if (attempt == 0) continue;
        throw new Exception("StartDocPrinter failed (error " + Marshal.GetLastWin32Error() + ")");
      }
      try {
        StartPagePrinter(h);
        IntPtr p = Marshal.AllocCoTaskMem(bytes.Length);
        try {
          Marshal.Copy(bytes, 0, p, bytes.Length);
          int written;
          if (!WritePrinter(h, p, bytes.Length, out written) || written != bytes.Length)
            throw new Exception("WritePrinter failed (error " + Marshal.GetLastWin32Error() + ")");
        } finally { Marshal.FreeCoTaskMem(p); }
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
      return;
    }
  }
}
'@

$printer = $env:CF_PRINTER
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $parts = $line.Split([char[]]@(' '), 3)
  $cmd = $parts[0]; $id = $parts[1]
  try {
    if ($cmd -eq 'PRINT') { [CfRaw]::Send($printer, [Convert]::FromBase64String($parts[2])) }
    elseif ($cmd -eq 'PING') { [CfRaw]::Ping($printer) }
    else { throw "unknown command $cmd" }
    [Console]::Out.WriteLine("OK $id")
  } catch {
    $msg = $_.Exception.Message -replace "[\r\n]+", ' '
    [Console]::Out.WriteLine("ERR $id $msg")
  }
  [Console]::Out.Flush()
}
