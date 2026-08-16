# Sends a file to a Windows printer as RAW bytes, so ZPL reaches the ZT411
# untouched instead of being rendered as text by the driver.
# Inputs come from the environment so nothing has to be quoted on a command line:
#   CF_PRINTER   the Windows printer name
#   CF_ZPL_FILE  the file to send
# bridge.js runs this through -EncodedCommand, so the PowerShell execution
# policy never applies.
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class CfRawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool OpenPrinter(string src, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);
  [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

  public static void Send(string printer, byte[] bytes) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero))
      throw new Exception("cannot open printer '" + printer + "' (error " + Marshal.GetLastWin32Error() + ")");
    try {
      DOCINFO di = new DOCINFO();
      di.pDocName = "Chapel Ford label";
      di.pDataType = "RAW";
      if (!StartDocPrinter(h, 1, di))
        throw new Exception("StartDocPrinter failed (error " + Marshal.GetLastWin32Error() + ")");
      try {
        if (!StartPagePrinter(h))
          throw new Exception("StartPagePrinter failed (error " + Marshal.GetLastWin32Error() + ")");
        IntPtr buf = Marshal.AllocCoTaskMem(bytes.Length);
        try {
          Marshal.Copy(bytes, 0, buf, bytes.Length);
          int written;
          if (!WritePrinter(h, buf, bytes.Length, out written))
            throw new Exception("WritePrinter failed (error " + Marshal.GetLastWin32Error() + ")");
          if (written != bytes.Length)
            throw new Exception("printer accepted only " + written + " of " + bytes.Length + " bytes");
        } finally { Marshal.FreeCoTaskMem(buf); }
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
'@

# Report on stdout, not the error stream: PowerShell serialises stderr as CLIXML
# when it is redirected, which would turn a useful message into noise.
try {
  $bytes = [System.IO.File]::ReadAllBytes($env:CF_ZPL_FILE)
  [CfRawPrint]::Send($env:CF_PRINTER, $bytes)
  Write-Output "OK sent $($bytes.Length) bytes"
} catch {
  # a static .NET call arrives wrapped in MethodInvocationException; the inner
  # message is the one worth showing
  $m = $_.Exception.Message
  if ($_.Exception.InnerException) { $m = $_.Exception.InnerException.Message }
  if ($m -match 'error 1801') { $m = "no Windows printer named '$env:CF_PRINTER' - run list-printers.bat to see the exact names" }
  Write-Output ("ERR " + $m)
  exit 1
}
