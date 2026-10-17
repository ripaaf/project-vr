using System;
using System.IO;

namespace QuestMirror
{
    /// <summary>Start menu / desktop / "Start with Windows" shortcuts (.lnk through WScript.Shell).</summary>
    static class Shortcuts
    {
        public static string StartMenu
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Quest Mirror.lnk"); }
        }

        public static string Desktop
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Quest Mirror.lnk"); }
        }

        /// <summary>Same file the dashboard's "Start with Windows" switch uses, so both stay in sync.</summary>
        public static string Startup
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "Quest Mirror.lnk"); }
        }

        public static void Create(string link, string target, string args, string description)
        {
            Type t = Type.GetTypeFromProgID("WScript.Shell");
            dynamic shell = Activator.CreateInstance(t);
            dynamic s = shell.CreateShortcut(link);
            s.TargetPath = target;
            s.Arguments = args ?? "";
            s.WorkingDirectory = Path.GetDirectoryName(target);
            s.IconLocation = target + ",0";
            s.Description = description;
            if (args == "--background") s.WindowStyle = 7;
            s.Save();
        }

        public static void Remove(string link)
        {
            try
            {
                if (File.Exists(link)) File.Delete(link);
            }
            catch
            {
            }
        }

        public static bool StartsWithWindows
        {
            get { return File.Exists(Startup); }
        }

        public static void SetStartWithWindows(bool on, string exe)
        {
            if (on) Create(Startup, exe, "--background", "Quest Mirror (starts in the tray)");
            else Remove(Startup);
        }
    }
}
