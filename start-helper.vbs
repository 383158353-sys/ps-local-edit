Option Explicit
Dim fso, shell, root, nodePath, scriptPath
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
nodePath = fso.BuildPath(root, "runtime\node.exe")
scriptPath = fso.BuildPath(root, "scripts\helper-supervisor.cjs")
If fso.FileExists(nodePath) And fso.FileExists(scriptPath) Then
  shell.Run """" & nodePath & """ """ & scriptPath & """", 0, False
End If
