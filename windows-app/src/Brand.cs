using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

namespace QuestMirror
{
    /// <summary>Colours and the UTSUSHI mark (an open ensō with a red seal), drawn in code so the app needs no image files.</summary>
    static class Brand
    {
        public const string Version = "1.0.0";
        public static readonly Color Ink = Color.FromArgb(15, 16, 18);
        public static readonly Color Ink2 = Color.FromArgb(69, 71, 77);
        public static readonly Color Ink3 = Color.FromArgb(138, 139, 144);
        public static readonly Color Paper = Color.FromArgb(231, 230, 225);
        public static readonly Color Paper2 = Color.FromArgb(243, 242, 237);
        public static readonly Color Signal = Color.FromArgb(255, 59, 31);

        /// <summary>The logo on an ink tile with cut corners: readable on light and dark taskbars.</summary>
        public static Bitmap Logo(int n)
        {
            var bmp = new Bitmap(n, n, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.Clear(Color.Transparent);
                float k = n * 0.22f;
                using (var tile = new GraphicsPath())
                {
                    tile.AddPolygon(new[] { new PointF(k, 0), new PointF(n, 0), new PointF(n, n - k), new PointF(n - k, n), new PointF(0, n), new PointF(0, k) });
                    using (var b = new SolidBrush(Ink)) g.FillPath(b, tile);
                }
                // an open brush circle (300°) and the seal in its gap
                float r = n * 0.27f, c = n * 0.47f;
                using (var pen = new Pen(Paper2, Math.Max(1.5f, n * 0.09f)) { StartCap = LineCap.Round, EndCap = LineCap.Round })
                    g.DrawArc(pen, c - r, c - r, 2 * r, 2 * r, 235, 300);
                using (var signal = new SolidBrush(Signal)) g.FillRectangle(signal, n * 0.6f, n * 0.6f, n * 0.18f, n * 0.18f);
            }
            return bmp;
        }

        public static Icon MakeIcon(int n)
        {
            using (var bmp = Logo(n)) return Icon.FromHandle(bmp.GetHicon());
        }

        /// <summary>Writes a multi-size .ico (PNG entries) for the .exe files.</summary>
        public static void WriteIco(string path, int[] sizes)
        {
            var pngs = new List<byte[]>();
            foreach (int n in sizes)
                using (var bmp = Logo(n))
                using (var ms = new MemoryStream())
                {
                    bmp.Save(ms, ImageFormat.Png);
                    pngs.Add(ms.ToArray());
                }
            using (var w = new BinaryWriter(File.Create(path)))
            {
                w.Write((short)0);
                w.Write((short)1);
                w.Write((short)sizes.Length);
                int offset = 6 + 16 * sizes.Length;
                for (int i = 0; i < sizes.Length; i++)
                {
                    w.Write((byte)(sizes[i] >= 256 ? 0 : sizes[i]));
                    w.Write((byte)(sizes[i] >= 256 ? 0 : sizes[i]));
                    w.Write((byte)0);
                    w.Write((byte)0);
                    w.Write((short)1);
                    w.Write((short)32);
                    w.Write(pngs[i].Length);
                    w.Write(offset);
                    offset += pngs[i].Length;
                }
                foreach (var p in pngs) w.Write(p);
            }
        }

        public static Font Display(float size)
        {
            return new Font(Installed("Bahnschrift") ? "Bahnschrift" : "Segoe UI", size, FontStyle.Bold, GraphicsUnit.Point);
        }

        public static Font Body(float size)
        {
            return new Font(Installed("Bahnschrift") ? "Bahnschrift" : "Segoe UI", size, FontStyle.Regular, GraphicsUnit.Point);
        }

        public static Font Mono(float size)
        {
            return new Font("Consolas", size, FontStyle.Bold, GraphicsUnit.Point);
        }

        static bool Installed(string family)
        {
            using (var f = new Font(family, 10)) return f.Name == family;
        }
    }

    /// <summary>build.ps1 runs this to make the .ico that goes into both .exe files.</summary>
    static class IconMaker
    {
        public static int Run(string path)
        {
            Brand.WriteIco(path, new[] { 16, 20, 24, 32, 40, 48, 64, 256 });
            return 0;
        }
    }
}
