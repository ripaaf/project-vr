using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: System.Reflection.AssemblyTitle("Quest Mirror")]
[assembly: System.Reflection.AssemblyProduct("Quest Mirror")]
[assembly: System.Reflection.AssemblyDescription("Your PC in your Quest, your Quest on any screen")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("1.0.0.0")]

namespace QuestMirror
{
    static class Paths
    {
        public const int Port = 8765;
        public static readonly string AppDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        public static readonly string Exe = Application.ExecutablePath;
        public static readonly string Data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "QuestMirror");
        public static readonly string Local = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "QuestMirror");

        public static string Node { get { return Path.Combine(AppDir, "runtime", "node.exe"); } }
        public static string HostDir { get { return Path.Combine(AppDir, "host"); } }
        public static string Adb { get { return Path.Combine(AppDir, "tools", "platform-tools", "adb.exe"); } }
        public static string Ffmpeg { get { return Path.Combine(AppDir, "tools", "ffmpeg", "bin", "ffmpeg.exe"); } }
        public static string Apk { get { return Path.Combine(AppDir, "quest-app", "build", "quest-mirror.apk"); } }
        public static string Config { get { return Path.Combine(Data, "config.json"); } }
        public static string Log { get { return Path.Combine(Local, "host.log"); } }

        public static string Url(string hash)
        {
            return "http://localhost:" + Port + "/" + (hash ?? "");
        }
    }

    static class Program
    {
        public const string QuitEvent = "Local\\QuestMirror.Quit";

        [STAThread]
        static int Main(string[] args)
        {
            string cmd = args.Length > 0 ? args[0] : "";
            if (cmd == "--make-icon") return IconMaker.Run(args[1]);
            if (cmd == "--show") return AppWindow.Show(args.Length > 1 ? args[1] : "") ? 0 : 1;
            if (cmd == "--uninstall") return Uninstaller.Run();
            if (cmd == "--quit")
            {
                SignalQuit();
                return 0;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            bool first;
            using (var mutex = new Mutex(true, "Local\\QuestMirror.Tray", out first))
            {
                if (!first)
                {
                    // Already running in the tray: a second launch just opens the window.
                    if (cmd != "--background") AppWindow.Show("");
                    return 0;
                }
                Application.Run(new Tray(cmd == "--background"));
                GC.KeepAlive(mutex);
            }
            return 0;
        }

        /// <summary>Asks the running tray app to quit (installer, uninstaller).</summary>
        public static bool SignalQuit()
        {
            try
            {
                using (var e = EventWaitHandle.OpenExisting(QuitEvent)) e.Set();
                return true;
            }
            catch
            {
                return false;
            }
        }
    }

    /// <summary>The dashboard in its own app window (Edge app mode), never a pile of browser tabs.</summary>
    static class AppWindow
    {
        public static bool Show(string hash)
        {
            IntPtr h = Native.FindDashboardWindow();
            if (h != IntPtr.Zero) return Native.Raise(h);

            string url = Paths.Url(hash);
            string edge = FindBrowser("msedge.exe", @"Microsoft\Edge\Application\msedge.exe");
            string chrome = edge == null ? FindBrowser("chrome.exe", @"Google\Chrome\Application\chrome.exe") : null;
            string browser = edge ?? chrome;
            try
            {
                if (browser != null)
                {
                    // Its own profile: no tabs, extensions or sign-in prompts — it looks and behaves like an app.
                    string profile = Path.Combine(Paths.Local, "window");
                    string a = "--app=\"" + url + "\" --user-data-dir=\"" + profile + "\" --no-first-run --no-default-browser-check " +
                               "--disable-sync --disable-features=msEdgeSidebarV2,msHubApps,msImplicitSignin --window-size=1280,860";
                    Process.Start(new ProcessStartInfo(browser, a) { UseShellExecute = false });
                }
                else Process.Start(url);
            }
            catch
            {
                Process.Start(url);
            }
            // Windows keeps windows opened from the background behind others; pull it forward once it exists.
            for (int i = 0; i < 40; i++)
            {
                Thread.Sleep(200);
                h = Native.FindDashboardWindow();
                if (h != IntPtr.Zero)
                {
                    Thread.Sleep(150);
                    return Native.Raise(h);
                }
            }
            return false;
        }

        static string FindBrowser(string exe, string rel)
        {
            foreach (var hive in new[] { Registry.CurrentUser, Registry.LocalMachine })
            {
                try
                {
                    using (var k = hive.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" + exe))
                    {
                        string p = k == null ? null : k.GetValue("") as string;
                        if (!string.IsNullOrEmpty(p) && File.Exists(p.Trim('"'))) return p.Trim('"');
                    }
                }
                catch
                {
                }
            }
            foreach (var root in new[] { "ProgramFiles(x86)", "ProgramFiles", "LocalAppData" })
            {
                string b = Environment.GetEnvironmentVariable(root);
                if (b != null && File.Exists(Path.Combine(b, rel))) return Path.Combine(b, rel);
            }
            return null;
        }
    }

    /// <summary>Runs the Node host hidden, restarts it if it dies, logs to %LOCALAPPDATA%\QuestMirror\host.log.</summary>
    sealed class Host
    {
        Process proc;
        bool stopping;
        int crashes;
        StreamWriter log;
        readonly object logLock = new object();
        public bool External { get; private set; }
        public event Action<string> Failed;

        public static bool Answers(int timeoutMs)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + Paths.Port + "/api/status");
                req.Timeout = timeoutMs;
                using (var res = (HttpWebResponse)req.GetResponse()) return res.StatusCode == HttpStatusCode.OK;
            }
            catch
            {
                return false;
            }
        }

        public void Start()
        {
            stopping = false;
            // Someone already runs a host on this PC (start.bat while developing): use it.
            if (Answers(800))
            {
                External = true;
                return;
            }
            External = false;
            if (!File.Exists(Paths.Node) || !File.Exists(Path.Combine(Paths.HostDir, "server.js")))
            {
                if (Failed != null) Failed("Quest Mirror files are missing. Please run the setup again.");
                return;
            }
            Directory.CreateDirectory(Paths.Local);
            Directory.CreateDirectory(Paths.Data);
            OpenLog();
            var psi = new ProcessStartInfo(Paths.Node, "\"" + Path.Combine(Paths.HostDir, "server.js") + "\"")
            {
                WorkingDirectory = Paths.HostDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            psi.EnvironmentVariables["ADB"] = Paths.Adb;
            psi.EnvironmentVariables["FFMPEG"] = Paths.Ffmpeg;
            psi.EnvironmentVariables["QM_APK"] = Paths.Apk;
            psi.EnvironmentVariables["QM_CONFIG"] = Paths.Config;
            psi.EnvironmentVariables["QM_APP_EXE"] = Paths.Exe;
            var p = new Process { StartInfo = psi, EnableRaisingEvents = true };
            p.OutputDataReceived += (s, e) => Write(e.Data);
            p.ErrorDataReceived += (s, e) => Write(e.Data);
            p.Exited += (s, e) => OnExit(p);
            p.Start();
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            proc = p;
            Write("[app] host started (pid " + p.Id + ")");
        }

        void OnExit(Process p)
        {
            if (p != proc) return;
            Write("[app] host exited with code " + p.ExitCode);
            if (stopping) return;
            crashes++;
            int wait = Math.Min(15000, 1500 * crashes);
            ThreadPool.QueueUserWorkItem(_ =>
            {
                Thread.Sleep(wait);
                if (!stopping && proc == p) Start();
            });
            if (crashes == 3 && Failed != null) Failed("The Quest Mirror host keeps stopping. Open the log from the tray menu to see why.");
        }

        public void Stop()
        {
            stopping = true;
            var p = proc;
            proc = null;
            if (p == null || p.HasExited) return;
            try
            {
                // The host starts adb, ffmpeg and PowerShell helpers: end the whole tree.
                var k = Process.Start(new ProcessStartInfo("taskkill", "/PID " + p.Id + " /T /F") { CreateNoWindow = true, UseShellExecute = false });
                k.WaitForExit(5000);
            }
            catch
            {
            }
        }

        public void Restart()
        {
            Stop();
            Thread.Sleep(800);
            crashes = 0;
            Start();
        }

        void OpenLog()
        {
            lock (logLock)
            {
                if (log != null) return;
                try
                {
                    if (File.Exists(Paths.Log) && new FileInfo(Paths.Log).Length > 2 * 1024 * 1024) File.Delete(Paths.Log);
                    log = new StreamWriter(new FileStream(Paths.Log, FileMode.Append, FileAccess.Write, FileShare.ReadWrite), Encoding.UTF8) { AutoFlush = true };
                }
                catch
                {
                }
            }
        }

        void Write(string line)
        {
            if (line == null) return;
            lock (logLock)
            {
                try
                {
                    if (log != null) log.WriteLine(DateTime.Now.ToString("HH:mm:ss") + " " + line);
                }
                catch
                {
                }
            }
        }
    }

    /// <summary>Tray icon: keeps the host running, opens the window, and tells you what happens next.</summary>
    sealed class Tray : ApplicationContext
    {
        readonly NotifyIcon icon;
        readonly Host host = new Host();
        readonly Control ui = new Control();
        readonly System.Windows.Forms.Timer poll = new System.Windows.Forms.Timer { Interval = 3000 };
        readonly EventWaitHandle quit = new EventWaitHandle(false, EventResetMode.AutoReset, Program.QuitEvent);
        readonly ToolStripMenuItem autoItem;
        Dictionary<string, object> last;
        bool fetching;

        public Tray(bool background)
        {
            ui.CreateControl();
            icon = new NotifyIcon
            {
                Icon = Brand.MakeIcon(Math.Max(16, SystemInformation.SmallIconSize.Width)),
                Text = "Quest Mirror — starting…",
                Visible = true,
            };
            var menu = new ContextMenuStrip();
            var open = new ToolStripMenuItem("Open Quest Mirror", null, (s, e) => OpenWindow(""));
            open.Font = new Font(open.Font, FontStyle.Bold);
            menu.Items.Add(open);
            menu.Items.Add(new ToolStripSeparator());
            autoItem = new ToolStripMenuItem("Start with Windows", null, (s, e) => ToggleAutostart());
            menu.Items.Add(autoItem);
            menu.Items.Add(new ToolStripMenuItem("Restart", null, (s, e) => ThreadPool.QueueUserWorkItem(_ => host.Restart())));
            menu.Items.Add(new ToolStripMenuItem("Show log", null, (s, e) => ShowLog()));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(new ToolStripMenuItem("Quit", null, (s, e) => Quit()));
            menu.Opening += (s, e) => autoItem.Checked = Shortcuts.StartsWithWindows;
            icon.ContextMenuStrip = menu;
            icon.MouseClick += (s, e) =>
            {
                if (e.Button == MouseButtons.Left) OpenWindow("");
            };
            icon.BalloonTipClicked += (s, e) => OpenWindow("");

            host.Failed += msg => ui.BeginInvoke((Action)(() => Notify("Quest Mirror", msg, ToolTipIcon.Warning)));
            ThreadPool.RegisterWaitForSingleObject(quit, (s, timedOut) => ui.BeginInvoke((Action)Quit), null, -1, true);
            SystemEvents.SessionEnding += (s, e) => host.Stop();

            ThreadPool.QueueUserWorkItem(_ =>
            {
                host.Start();
                // Open the window as soon as the host answers (not when Windows starts us in the tray).
                for (int i = 0; i < 60 && !Host.Answers(500); i++) Thread.Sleep(500);
                ui.BeginInvoke((Action)(() =>
                {
                    if (!background) OpenWindow("");
                    string welcomed = Path.Combine(Paths.Local, "welcomed");
                    if (!File.Exists(welcomed))
                    {
                        // First run: the one prompt we can't skip is Windows' own firewall question.
                        Notify("Quest Mirror is ready", "If Windows asks about network access, press Allow — that's how your Quest and TV reach this PC.", ToolTipIcon.Info);
                        try
                        {
                            File.WriteAllText(welcomed, DateTime.Now.ToString("o"));
                        }
                        catch
                        {
                        }
                    }
                    else if (background) Notify("Quest Mirror is running", "It's in the tray. Plug in your Quest or open Quest Mirror in the headset.", ToolTipIcon.None);
                }));
            });
            poll.Tick += (s, e) => Poll();
            poll.Start();
        }

        void OpenWindow(string hash)
        {
            ThreadPool.QueueUserWorkItem(_ => AppWindow.Show(hash));
        }

        void ToggleAutostart()
        {
            try
            {
                Shortcuts.SetStartWithWindows(!Shortcuts.StartsWithWindows, Paths.Exe);
            }
            catch (Exception e)
            {
                Notify("Quest Mirror", "Could not change that: " + e.Message, ToolTipIcon.Warning);
            }
        }

        void ShowLog()
        {
            if (File.Exists(Paths.Log)) Process.Start("notepad.exe", "\"" + Paths.Log + "\"");
            else Notify("Quest Mirror", host.External ? "Another Quest Mirror window is running the host on this PC." : "No log yet.", ToolTipIcon.None);
        }

        void Quit()
        {
            poll.Stop();
            icon.Visible = false;
            Native.CloseDashboardWindow();
            host.Stop();
            ExitThread();
        }

        void Notify(string title, string text, ToolTipIcon kind)
        {
            icon.ShowBalloonTip(6000, title, text, kind);
        }

        // ---------------------------------------------------------------- status → guidance

        void Poll()
        {
            if (fetching) return;
            fetching = true;
            ThreadPool.QueueUserWorkItem(_ =>
            {
                Dictionary<string, object> s = null;
                try
                {
                    using (var wc = new WebClient { Encoding = Encoding.UTF8 })
                        s = new JavaScriptSerializer().DeserializeObject(wc.DownloadString("http://127.0.0.1:" + Paths.Port + "/api/status")) as Dictionary<string, object>;
                }
                catch
                {
                }
                ui.BeginInvoke((Action)(() =>
                {
                    fetching = false;
                    Apply(s);
                }));
            });
        }

        static object Get(Dictionary<string, object> d, params string[] path)
        {
            object o = d;
            foreach (var k in path)
            {
                var m = o as Dictionary<string, object>;
                if (m == null || !m.ContainsKey(k)) return null;
                o = m[k];
            }
            return o;
        }

        static bool B(Dictionary<string, object> d, params string[] path)
        {
            return d != null && Get(d, path) is bool && (bool)Get(d, path);
        }

        void Apply(Dictionary<string, object> s)
        {
            string tip;
            if (s == null) tip = "Quest Mirror — starting…";
            else if (!B(s, "device", "connected")) tip = B(s, "device", "unauthorized") ? "Quest Mirror — press Allow in the headset" : "Quest Mirror — waiting for your Quest";
            else tip = "Quest Mirror — Quest connected" + (B(s, "pc", "appLinked") ? " · linked" : "");
            icon.Text = tip.Length > 63 ? tip.Substring(0, 63) : tip;

            if (s != null && last != null)
            {
                // Say what just happened and what to do next — once, when it changes.
                if (B(s, "device", "unauthorized") && !B(last, "device", "unauthorized"))
                    Notify("Put your Quest on", "Press “Allow” on the USB debugging prompt (tick “Always allow”).", ToolTipIcon.Info);
                if (B(s, "device", "connected") && !B(last, "device", "connected"))
                    Notify("Quest connected", B(s, "device", "appInstalled") ? "Ready. Open Quest Mirror in the headset." : "Installing the Quest app on it…", ToolTipIcon.None);
                if (B(s, "device", "appInstalled") && !B(last, "device", "appInstalled"))
                    Notify("Quest app installed", "In the headset: Library → Unknown Sources → Quest Mirror, then look at this PC's screen.", ToolTipIcon.Info);
                if (B(s, "pc", "appLinked") && !B(last, "pc", "appLinked"))
                    Notify("Linked ✓", "Your Quest can show this PC now.", ToolTipIcon.None);
            }
            if (s != null) last = s;
        }
    }

    static class Uninstaller
    {
        public static int Run()
        {
            bool quiet = Array.IndexOf(Environment.GetCommandLineArgs(), "--quiet") >= 0;
            if (!quiet && MessageBox.Show("Remove Quest Mirror from this PC?\n\nThe app on your Quest stays; your settings are kept in case you install it again.",
                    "Quest Mirror", MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK) return 1;
            Program.SignalQuit();
            Thread.Sleep(1500);
            Native.KillProcessesUnder(Paths.AppDir);
            Shortcuts.Remove(Shortcuts.StartMenu);
            Shortcuts.Remove(Shortcuts.Desktop);
            Shortcuts.Remove(Shortcuts.Startup);
            try
            {
                Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\QuestMirror", false);
            }
            catch
            {
            }
            if (Array.IndexOf(Environment.GetCommandLineArgs(), "--quiet") < 0)
                MessageBox.Show("Quest Mirror was removed.", "Quest Mirror", MessageBoxButtons.OK, MessageBoxIcon.Information);
            // This .exe lives in the folder being removed: let cmd delete it once we've exited.
            Process.Start(new ProcessStartInfo("cmd.exe", "/c ping 127.0.0.1 -n 3 >nul & rmdir /s /q \"" + Paths.AppDir + "\"")
            {
                CreateNoWindow = true,
                UseShellExecute = false,
                WorkingDirectory = Path.GetTempPath(),
            });
            return 0;
        }
    }
}
