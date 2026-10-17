# Builds the Windows app: windows-app\build\QuestMirror-Setup.exe (one file, installs without admin).
# Uses the C# compiler that ships with Windows (.NET Framework 4.8) — nothing extra to install.
# Node.js, ffmpeg and adb are copied from this PC into the package, so the target PC needs none of them.
param(
    [string]$Node = $(try { (Get-Command node -ErrorAction Stop).Source } catch { '' }),
    [string]$Ffmpeg = $(if ($env:FFMPEG) { $env:FFMPEG } else { try { (Get-Command ffmpeg -ErrorAction Stop).Source } catch { 'C:\ffmpeg\bin\ffmpeg.exe' } }),
    [string]$Adb = $(if ($env:ADB) { $env:ADB } else { try { (Get-Command adb -ErrorAction Stop).Source } catch { 'C:\adb\adb.exe' } })
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$root = Split-Path $here -Parent
$src = Join-Path $here 'src'
$out = Join-Path $here 'build'
$stage = Join-Path $out 'QuestMirror'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$apk = Join-Path $root 'quest-app\build\quest-mirror.apk'

function Need($path, $what) { if (-not $path -or -not (Test-Path $path)) { throw "$what not found ($path)" } }
Need $csc 'C# compiler (.NET Framework 4.x)'
Need $Node 'node.exe'
Need $Ffmpeg 'ffmpeg.exe'
Need $Adb 'adb.exe'

if (-not (Test-Path $apk)) {
    Write-Host '0/5 building the Quest app first'
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'quest-app\build.ps1')
    Need $apk 'quest-mirror.apk'
}

function Csc([string[]]$csArgs) {
    & $csc /nologo /optimize+ /platform:anycpu @csArgs
    if ($LASTEXITCODE -ne 0) { throw 'C# compile failed' }
}
$refs = @('/r:System.dll', '/r:System.Core.dll', '/r:System.Drawing.dll', '/r:System.Windows.Forms.dll', '/r:System.Web.Extensions.dll', '/r:Microsoft.CSharp.dll')

Write-Host '1/5 app icon'
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Force $stage | Out-Null
$appSrc = @('App.cs', 'Brand.cs', 'Native.cs', 'Shortcuts.cs') | ForEach-Object { Join-Path $src $_ }
$iconTool = Join-Path $out 'icon-tool.exe'
Csc (@('/target:winexe', "/out:$iconTool") + $refs + $appSrc)
$ico = Join-Path $out 'questmirror.ico'
$p = Start-Process -FilePath $iconTool -ArgumentList @('--make-icon', "`"$ico`"") -Wait -PassThru
if ($p.ExitCode -ne 0 -or -not (Test-Path $ico)) { throw 'icon failed' }

Write-Host '2/5 QuestMirror.exe'
Csc (@('/target:winexe', "/out:$(Join-Path $stage 'QuestMirror.exe')", "/win32icon:$ico") + $refs + $appSrc)

Write-Host '3/5 bundling Node.js, ffmpeg, adb, host, Quest app'
$dirs = @('runtime', 'tools\ffmpeg\bin', 'tools\platform-tools', 'host', 'quest-app\build')
foreach ($d in $dirs) { New-Item -ItemType Directory -Force (Join-Path $stage $d) | Out-Null }
Copy-Item $Node (Join-Path $stage 'runtime\node.exe')
Copy-Item $Ffmpeg (Join-Path $stage 'tools\ffmpeg\bin\ffmpeg.exe')
$adbDir = Split-Path $Adb
foreach ($f in @('adb.exe', 'AdbWinApi.dll', 'AdbWinUsbApi.dll', 'libwinpthread-1.dll')) {
    if (Test-Path (Join-Path $adbDir $f)) { Copy-Item (Join-Path $adbDir $f) (Join-Path $stage 'tools\platform-tools') }
}
# The host without anything personal (config.json holds this PC's link secret).
Copy-Item (Join-Path $root 'host\server.js') (Join-Path $stage 'host')
if (Test-Path (Join-Path $root 'host\package.json')) { Copy-Item (Join-Path $root 'host\package.json') (Join-Path $stage 'host') }
Copy-Item (Join-Path $root 'host\lib') (Join-Path $stage 'host\lib') -Recurse
Copy-Item (Join-Path $root 'host\public') (Join-Path $stage 'host\public') -Recurse
Copy-Item $apk (Join-Path $stage 'quest-app\build\quest-mirror.apk')

Write-Host '4/5 packing'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$payload = Join-Path $out 'payload.zip'
[IO.Compression.ZipFile]::CreateFromDirectory($stage, $payload, [IO.Compression.CompressionLevel]::Optimal, $false)

Write-Host '5/5 QuestMirror-Setup.exe'
$setupSrc = @('Installer.cs', 'Brand.cs', 'Native.cs', 'Shortcuts.cs') | ForEach-Object { Join-Path $src $_ }
$setup = Join-Path $out 'QuestMirror-Setup.exe'
Csc (@('/target:winexe', "/out:$setup", "/win32icon:$ico", "/resource:$payload,payload.zip", '/r:System.IO.Compression.dll') + $refs + $setupSrc)
Remove-Item $iconTool, $payload -Force

$mb = [math]::Round((Get-Item $setup).Length / 1MB, 1)
Write-Host "done: $setup ($mb MB)"
