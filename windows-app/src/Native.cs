using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace QuestMirror
{
    static class Native
    {
        public delegate bool EnumProc(IntPtr h, IntPtr l);
        [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
        [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
        [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
        [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
        [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);

        /// <summary>Closes the app window (on Quit / uninstall) so it doesn't sit there saying "Lost the PC".</summary>
        public static void CloseDashboardWindow()
        {
            for (int i = 0; i < 5; i++)
            {
                IntPtr h = FindDashboardWindow();
                if (h == IntPtr.Zero) return;
                PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero); // WM_CLOSE
                System.Threading.Thread.Sleep(150);
            }
        }

        /// <summary>
        /// The app window: an Edge/Chrome app-mode window (class Chrome_WidgetWin_1) titled exactly "Quest Mirror".
        /// Browser tabs ("Quest Mirror - Google Chrome") don't count — the app keeps its own window.
        /// </summary>
        public static IntPtr FindDashboardWindow()
        {
            IntPtr found = IntPtr.Zero;
            EnumWindows((h, l) =>
            {
                if (!IsWindowVisible(h)) return true;
                var cls = new StringBuilder(64);
                GetClassName(h, cls, 64);
                if (cls.ToString() != "Chrome_WidgetWin_1") return true;
                var sb = new StringBuilder(256);
                GetWindowText(h, sb, 256);
                string t = sb.ToString();
                if (t == "Quest Mirror")
                {
                    found = h;
                    return false;
                }
                return true;
            }, IntPtr.Zero);
            return found;
        }

        /// <summary>
        /// Brings a window to the front. Windows only lets the app that produced the last input do that,
        /// so send a harmless key-up (F24) first and borrow the foreground thread's input state.
        /// </summary>
        public static bool Raise(IntPtr h)
        {
            if (IsIconic(h)) ShowWindow(h, 9);
            keybd_event(0x87, 0, 2, UIntPtr.Zero);
            uint fg = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero), me = GetCurrentThreadId();
            bool attached = fg != 0 && fg != me && AttachThreadInput(me, fg, true);
            BringWindowToTop(h);
            bool ok = SetForegroundWindow(h);
            if (attached) AttachThreadInput(me, fg, false);
            return ok;
        }

        /// <summary>Stops every process started from inside a folder (host, adb, ffmpeg from this install).</summary>
        public static void KillProcessesUnder(string dir)
        {
            dir = Path.GetFullPath(dir).TrimEnd('\\') + "\\";
            int me = Process.GetCurrentProcess().Id;
            foreach (var p in Process.GetProcesses())
            {
                try
                {
                    if (p.Id == me) continue;
                    string file = p.MainModule.FileName;
                    if (file.StartsWith(dir, StringComparison.OrdinalIgnoreCase)) p.Kill();
                }
                catch
                {
                    // no access (other users' / system processes): not ours anyway
                }
            }
        }
    }
}
