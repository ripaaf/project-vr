# Builds quest-linux\build\utsushi-linux.apk (UTSUSHI Linux, the Terminal's Alpine) with the plain
# Android SDK tools, signed with the same key as UTSUSHI (it only lets UTSUSHI start it).
#   powershell -ExecutionPolicy Bypass -File quest-linux\build.ps1 [-Install]
param([switch]$Install)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$out = Join-Path $here 'build'
$app = Join-Path $here '..\quest-app'

function Find-Sdk {
    foreach ($p in @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, "$env:LOCALAPPDATA\Android\Sdk")) {
        if ($p -and (Test-Path "$p\build-tools")) { return $p }
    }
    throw 'Android SDK not found. Install Android Studio (or the command-line tools) or set ANDROID_HOME.'
}
function Find-Jdk {
    $cands = @($env:JAVA_HOME) + (Get-ChildItem 'C:\Program Files\Java', 'C:\Program Files\Android\Android Studio' -Directory -ErrorAction SilentlyContinue |
        ForEach-Object { $_.FullName; Join-Path $_.FullName 'jbr' })
    foreach ($c in $cands) {
        if ($c -and (Test-Path "$c\bin\javac.exe")) {
            $v = & "$c\bin\javac.exe" -version 2>&1
            if ("$v" -match 'javac (\d+)' -and [int]$Matches[1] -ge 11) { return $c }
        }
    }
    throw 'JDK 11 or newer not found. Install one (or Android Studio) or set JAVA_HOME.'
}

$sdk = Find-Sdk
$bt = Get-ChildItem "$sdk\build-tools" -Directory | Where-Object { Test-Path "$($_.FullName)\d8.bat" } |
    Sort-Object { [version]($_.Name -replace '[^0-9.].*$', '') } | Select-Object -Last 1
if (-not $bt) { throw 'No usable build-tools in the Android SDK.' }
$bt = $bt.FullName
$platform = Get-ChildItem "$sdk\platforms" -Directory | Where-Object { [int]($_.Name -replace 'android-', '') -ge 34 } | Select-Object -First 1 -ExpandProperty FullName
if (-not $platform) { throw 'Android platform 34 or newer is required (SDK Manager -> Android 14).' }
$androidJar = "$platform\android.jar"
$jdk = Find-Jdk
$env:JAVA_HOME = $jdk
$env:PATH = "$jdk\bin;$env:PATH"

Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$out\gen", "$out\classes", "$out\dex" | Out-Null

function Run($exe, [string[]]$argv) {
    & $exe @argv
    if ($LASTEXITCODE -ne 0) { throw "$([IO.Path]::GetFileName($exe)) failed ($LASTEXITCODE)" }
}

Write-Host '1/5 resources'
# target 28 (Android 9) on purpose: newer targets may not run programs from their own storage,
# and Linux packages are exactly that
Run "$bt\aapt2.exe" @('compile', '--dir', "$here\res", '-o', "$out\res.zip")
Run "$bt\aapt2.exe" @('link', '-o', "$out\base.apk", '-I', $androidJar, '--manifest', "$here\AndroidManifest.xml",
    '--java', "$out\gen", '--min-sdk-version', '28', '--target-sdk-version', '28',
    '--version-code', '1', '--version-name', '1.0.0', "$out\res.zip")

Write-Host '2/5 compile'
$sources = Get-ChildItem "$here\src", "$out\gen" -Recurse -Filter *.java | ForEach-Object { $_.FullName }
$sources | Set-Content "$out\sources.txt" -Encoding ascii
Run "$jdk\bin\javac.exe" @('--release', '11', '-classpath', $androidJar, '-d', "$out\classes", '-encoding', 'UTF-8', '-Xlint:-options', "@$out\sources.txt")
$classes = Get-ChildItem "$out\classes" -Recurse -Filter *.class | ForEach-Object { $_.FullName }
$classes | Set-Content "$out\classes.txt" -Encoding ascii
Run "$bt\d8.bat" @('--release', '--min-api', '28', '--lib', $androidJar, '--output', "$out\dex", "@$out\classes.txt")

Write-Host '3/5 package'
Copy-Item "$out\base.apk" "$out\unsigned.apk"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::Open("$out\unsigned.apk", 'Update')
[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, "$out\dex\classes.dex", 'classes.dex') | Out-Null
# proot (Termux) and its libraries, copied out and run by the app (forward slashes for Android)
$assetRoot = (Resolve-Path "$here\assets").Path
Get-ChildItem $assetRoot -Recurse -File | ForEach-Object {
    $name = 'assets/' + $_.FullName.Substring($assetRoot.Length + 1).Replace('\', '/')
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $name) | Out-Null
}
$zip.Dispose()
Run "$bt\zipalign.exe" @('-p', '-f', '4', "$out\unsigned.apk", "$out\aligned.apk")

Write-Host '4/5 sign'
$ks = Join-Path $app 'questmirror-debug.keystore'
if (-not (Test-Path $ks)) { throw 'Build UTSUSHI (quest-app) first: both apps share its signing key.' }
Run "$bt\apksigner.bat" @('sign', '--ks', $ks, '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--out', "$out\utsushi-linux.apk", "$out\aligned.apk")
Write-Host "5/5 done: $out\utsushi-linux.apk"

if ($Install) {
    Write-Host 'Installing on the connected Quest...'
    & adb install -r -g "$out\utsushi-linux.apk"
}
