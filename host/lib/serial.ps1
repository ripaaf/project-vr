# UTSUSHI - serial port helper (ESP32, M5Stack Cardputer, any USB-serial board).
# Commands on stdin, one per line:
#   list                    -> "ports <json>"  (port, name, vid, pid)
#   open COM5 115200        -> "opened COM5" or "error <message>"
#   write BASE64            -> sends those bytes
#   close                   -> "closed"
# While a port is open, received bytes arrive as "data BASE64" lines.
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.IO.Ports;
using System.Text;
using System.Threading;

public static class QMSerial {
    static SerialPort port;
    static readonly object outLock = new object();

    public static void Say(string line) {
        lock (outLock) { Console.Out.WriteLine(line); Console.Out.Flush(); }
    }

    public static void Open(string name, int baud) {
        Close(false);
        var p = new SerialPort(name, baud, Parity.None, 8, StopBits.One);
        p.Handshake = Handshake.None;
        p.DtrEnable = true;    // USB-CDC boards (ESP32-S3 / Cardputer) only send once DTR is up
        p.RtsEnable = false;   // keep RTS low: on many ESP32 dev boards RTS is wired to reset
        p.ReadTimeout = 500;
        p.Open();
        port = p;
        var t = new Thread(ReadLoop);
        t.IsBackground = true;
        t.Start(p);
        Say("opened " + name);
    }

    static void ReadLoop(object o) {
        var p = (SerialPort)o;
        var buf = new byte[4096];
        while (p == port && p.IsOpen) {
            try {
                int n = p.BaseStream.Read(buf, 0, buf.Length);
                if (n > 0) Say("data " + Convert.ToBase64String(buf, 0, n));
            } catch (TimeoutException) {
            } catch (Exception e) {
                if (p == port) { Say("error " + e.Message.Replace("\r", " ").Replace("\n", " ")); Close(true); }
                return;
            }
        }
    }

    public static void Write(string b64) {
        if (port == null || !port.IsOpen) { Say("error Not connected"); return; }
        var bytes = Convert.FromBase64String(b64);
        port.Write(bytes, 0, bytes.Length);
    }

    public static void Close(bool announce) {
        var p = port;
        port = null;
        if (p != null) { try { p.Close(); } catch { } }
        if (announce) Say("closed");
    }
}
'@

function Get-Ports {
    $names = [System.IO.Ports.SerialPort]::GetPortNames()
    $pnp = @(Get-CimInstance Win32_PnPEntity -Filter "Name LIKE '%(COM%'" -ErrorAction SilentlyContinue)
    $list = foreach ($n in ($names | Sort-Object -Unique)) {
        $dev = $pnp | Where-Object { $_.Name -match "\($n\)" } | Select-Object -First 1
        $vid = ''; $prod = ''
        if ($dev -and $dev.PNPDeviceID -match 'VID_([0-9A-F]{4})') { $vid = $Matches[1] }
        if ($dev -and $dev.PNPDeviceID -match 'PID_([0-9A-F]{4})') { $prod = $Matches[1] }
        [pscustomobject]@{ port = $n; name = $(if ($dev) { $dev.Name } else { $n }); vid = $vid; pid = $prod }
    }
    return ConvertTo-Json -Compress -InputObject @($list)
}

[QMSerial]::Say('ready')
while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    $p = $line.Trim().Split(' ')
    try {
        switch ($p[0]) {
            'list'  { [QMSerial]::Say('ports ' + (Get-Ports)) }
            'open'  { [QMSerial]::Open($p[1], [int]$p[2]) }
            'write' { [QMSerial]::Write($p[1]) }
            'close' { [QMSerial]::Close($true) }
        }
    } catch {
        [QMSerial]::Say('error ' + ($_.Exception.Message -replace '[\r\n]+', ' '))
    }
}
[QMSerial]::Close($false)
