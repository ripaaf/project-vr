using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

namespace QuestMirror
{
    /// <summary>Colours and the [ :] logo, drawn in code so the app needs no image files.</summary>
    static class Brand
    {
        public const string Version = "1.0.0";
        public static readonly Color Ink = Color.FromArgb(15, 16, 18);
        public static readonly Color Ink2 = Color.FromArgb(69, 71, 77);
        public static readonly Color Ink3 = Color.FromArgb(138, 139, 144);
        public static readonly Color Paper = Color.FromArgb(231, 230, 225);
        public static readonly Color Paper2 = Color.FromArgb(243, 242, 237);
        public static readonly Color Signal = Color.FromArgb(255, 59, 31);

        // The logo on a 32-unit grid: two brackets and two bars, the right one in signal red.
        static readonly float[][] LeftBracket = { new float[] { 3, 3 }, new float[] { 12, 3 }, new float[] { 12, 6 }, new float[] { 6, 6 }, new float[] { 6, 26 }, new float[] { 12, 26 }, new float[] { 12, 29 }, new float[] { 3, 29 } };

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
                float s = n * 0.74f / 32f, o = (n - 32 * s) / 2f;
                using (var paper = new SolidBrush(Paper2))
                using (var signal = new SolidBrush(Signal))
                {
                    g.FillPolygon(paper, Shape(LeftBracket, s, o, false));
                    g.FillPolygon(paper, Shape(LeftBracket, s, o, true));
                    g.FillRectangle(paper, o + 11 * s, o + 12 * s, 4 * s, 8 * s);
                    g.FillRectangle(signal, o + 17 * s, o + 12 * s, 4 * s, 8 * s);
                }
            }
            return bmp;
        }

        static PointF[] Shape(float[][] pts, float s, float o, bool mirror)
        {
            var list = new List<PointF>();
            foreach (var p in pts) list.Add(new PointF(o + (mirror ? 32 - p[0] : p[0]) * s, o + p[1] * s));
            return list.ToArray();
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
