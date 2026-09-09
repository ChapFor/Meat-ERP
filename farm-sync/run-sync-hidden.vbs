' Launch run-sync.bat with no console window.
'
' Task Scheduler runs this task with an interactive token (the farm PC signs in
' as one user and stays signed in), so a .bat action flashes a CMD window on the
' desktop every five minutes. Handing the batch file to WScript.Shell.Run with
' window style 0 keeps it completely off screen.
'
' Run() waits (True) rather than returning straight away, so the task keeps
' behaving the way it did before: Last Result still reports whether the sync
' worked, and "IgnoreNew" still stops a slow run from overlapping the next one.

Dim sh, fso, here, rc
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)

rc = sh.Run("""" & here & "\run-sync.bat""", 0, True)
WScript.Quit rc
