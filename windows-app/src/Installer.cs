using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Quest Mirror Setup")]
[assembly: AssemblyProduct("Quest Mirror")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace QuestMirror
{
    static class SetupProgram
    {
        [STAThread]
        static int Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            var form = new SetupForm(Array.IndexOf(args, "--quiet") >= 0);
            Application.Run(form);
            return form.Ok ? 0 : 1;
        }
    }

    /// <summary>One window, no wizard: it installs as soon as it opens, then starts Quest Mirror.</summary>
    sealed class SetupForm : Form
    {
        public static readonly string InstallDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Quest Mirror");
        const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\QuestMirror";

        readonly bool quiet;
        readonly Label title, status;
        readonly CheckBox autostart;
        readonly Button action;
        float progress;
        public bool Ok;

        public SetupForm(bool quiet)
        {
            this.quiet = quiet;
            Text = "Quest Mirror Setup";
            Icon = Brand.MakeIcon(32);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(620, 340);
            BackColor = Brand.Paper;
            DoubleBuffered = true;
            Font = Brand.Body(10);

            title = new Label { Text = "Installing…", Font = Brand.Display(22), ForeColor = Brand.Ink, AutoSize = true, Location = new Point(40, 118), BackColor = Color.Transparent };
            status = new Label { Text = "Getting ready", Font = Brand.Mono(9), ForeColor = Brand.Ink2, AutoSize = false, Size = new Size(540, 20), Location = new Point(42, 166), BackColor = Color.Transparent };
            autostart = new CheckBox
            {
                Text = "Start with Windows (waits quietly in the tray)",
                Checked = true,
                AutoSize = true,
                Location = new Point(40, 236),
                ForeColor = Brand.Ink,
                BackColor = Color.Transparent,
                FlatStyle = FlatStyle.Flat,
            };
            action = new Button
            {
                Text = "OPEN QUEST MIRROR  →",
                Font = Brand.Mono(10),
                Size = new Size(230, 46),
                Location = new Point(350, 270),
                FlatStyle = FlatStyle.Flat,
                BackColor = Brand.Ink,
                ForeColor = Brand.Paper2,
                Visible = false,
            };
            action.FlatAppearance.BorderSize = 0;
            action.FlatAppearance.MouseOverBackColor = Brand.Signal;
            action.Click += (s, e) => Finish();
            Controls.AddRange(new Control[] { title, status, autostart, action });
            Shown += (s, e) => new Thread(Install) { IsBackground = true }.Start();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            // drafting-paper dots
            using (var dot = new SolidBrush(Color.FromArgb(40, Brand.Ink)))
                for (int x = 12; x < ClientSize.Width; x += 24)
                    for (int y = 12; y < ClientSize.Height; y += 24) g.FillRectangle(dot, x, y, 1.6f, 1.6f);
            using (var logo = Brand.Logo(48)) g.DrawImage(logo, 40, 36, 48, 48);
            using (var f = Brand.Display(20))
            using (var ink = new SolidBrush(Brand.Ink))
            using (var sig = new SolidBrush(Brand.Signal))
            {
                float x = 102;
                g.DrawString("QUEST", f, ink, x, 44);
                x += g.MeasureString("QUEST", f).Width - 8;
                g.DrawString("/", f, sig, x, 44);
                x += g.MeasureString("/", f).Width - 8;
                g.DrawString("MIRROR", f, ink, x, 44);
            }
            using (var m = Brand.Mono(8))
            using (var b = new SolidBrush(Brand.Signal)) g.DrawString("■ SETUP // V" + Brand.Version, m, b, 104, 76);
            // progress rail with a signal-red fill
            var rail = new RectangleF(40, 200, ClientSize.Width - 80, 10);
            using (var bg = new SolidBrush(Brand.Paper2)) g.FillRectangle(bg, rail);
            using (var fill = new SolidBrush(Brand.Signal)) g.FillRectangle(fill, rail.X, rail.Y, rail.Width * progress, rail.Height);
            using (var pen = new Pen(Brand.Ink, 1.5f)) g.DrawRectangle(pen, rail.X, rail.Y, rail.Width, rail.Height);
        }

        void Step(string text, float p)
        {
            BeginInvoke((Action)(() =>
            {
                status.Text = text.ToUpperInvariant();
                if (p >= 0) progress = p;
                Invalidate(new Rectangle(0, 190, ClientSize.Width, 30));
            }));
        }

        void Install()
        {
            try
            {
                Step("Closing Quest Mirror if it's running", 0.02f);
                StopRunningCopy();

                Step("Copying files", 0.05f);
                Directory.CreateDirectory(InstallDir);
                using (var payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
                using (var zip = new ZipArchive(payload, ZipArchiveMode.Read))
                {
                    long total = 0, done = 0;
                    foreach (var en in zip.Entries) total += en.Length;
                    string root = Path.GetFullPath(InstallDir).TrimEnd('\\') + "\\";
                    foreach (var en in zip.Entries)
                    {
                        string dest = Path.GetFullPath(Path.Combine(InstallDir, en.FullName));
                        if (!dest.StartsWith(root, StringComparison.OrdinalIgnoreCase)) continue;
                        if (en.FullName.EndsWith("/"))
                        {
                            Directory.CreateDirectory(dest);
                            continue;
                        }
                        Directory.CreateDirectory(Path.GetDirectoryName(dest));
                        Extract(en, dest);
                        done += en.Length;
                        Step("Copying " + en.Name, 0.05f + 0.85f * done / Math.Max(1, total));
                    }
                }

                Step("Adding shortcuts", 0.93f);
                string exe = Path.Combine(InstallDir, "QuestMirror.exe");
                Shortcuts.Create(Shortcuts.StartMenu, exe, "", "Your PC in your Quest, your Quest on any screen");
                Shortcuts.Create(Shortcuts.Desktop, exe, "", "Your PC in your Quest, your Quest on any screen");
                bool auto = (bool)Invoke((Func<bool>)(() => autostart.Checked));
                Shortcuts.SetStartWithWindows(auto, exe);
                Register(exe);

                Step("Done", 1f);
                Ok = true;
                BeginInvoke((Action)(() =>
                {
                    title.Text = "Ready ✓";
                    status.Text = "IF WINDOWS ASKS ABOUT NETWORK ACCESS, PRESS ALLOW";
                    autostart.Enabled = false;
                    action.Visible = true;
                    var t = new System.Windows.Forms.Timer { Interval = quiet ? 200 : 2600 };
                    t.Tick += (s, e) =>
                    {
                        t.Stop();
                        Finish();
                    };
                    t.Start();
                }));
            }
            catch (Exception ex)
            {
                BeginInvoke((Action)(() =>
                {
                    title.Text = "Couldn't install";
                    title.ForeColor = Brand.Signal;
                    status.Text = ex.Message.ToUpperInvariant();
                    action.Text = "CLOSE";
                    action.Visible = true;
                }));
            }
        }

        void Finish()
        {
            if (Ok)
            {
                try
                {
                    Process.Start(new ProcessStartInfo(Path.Combine(InstallDir, "QuestMirror.exe")) { WorkingDirectory = InstallDir });
                }
                catch
                {
                }
            }
            Close();
        }

        static void StopRunningCopy()
        {
            try
            {
                using (var e = EventWaitHandle.OpenExisting("Local\\QuestMirror.Quit")) e.Set();
                for (int i = 0; i < 30; i++)
                {
                    Thread.Sleep(200);
                    Mutex m;
                    if (!Mutex.TryOpenExisting("Local\\QuestMirror.Tray", out m)) break;
                    m.Dispose();
                }
            }
            catch
            {
            }
            if (Directory.Exists(InstallDir)) Native.KillProcessesUnder(InstallDir);
        }

        static void Extract(ZipArchiveEntry en, string dest)
        {
            for (int attempt = 0; ; attempt++)
            {
                try
                {
                    using (var src = en.Open())
                    using (var dst = File.Create(dest)) src.CopyTo(dst);
                    File.SetLastWriteTime(dest, en.LastWriteTime.DateTime);
                    return;
                }
                catch (IOException)
                {
                    // A file still held by a closing process: wait a moment, stop stragglers, retry.
                    if (attempt >= 8) throw;
                    Thread.Sleep(500);
                    Native.KillProcessesUnder(InstallDir);
                }
            }
        }

        static void Register(string exe)
        {
            using (var k = Registry.CurrentUser.CreateSubKey(UninstallKey))
            {
                k.SetValue("DisplayName", "Quest Mirror");
                k.SetValue("DisplayVersion", Brand.Version);
                k.SetValue("Publisher", "Quest Mirror");
                k.SetValue("DisplayIcon", exe + ",0");
                k.SetValue("InstallLocation", InstallDir);
                k.SetValue("UninstallString", "\"" + exe + "\" --uninstall");
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                long bytes = 0;
                foreach (var f in new DirectoryInfo(InstallDir).GetFiles("*", SearchOption.AllDirectories)) bytes += f.Length;
                k.SetValue("EstimatedSize", (int)(bytes / 1024), RegistryValueKind.DWord);
            }
        }
    }
}
