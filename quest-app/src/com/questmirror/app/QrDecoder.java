package com.questmirror.app;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Small, dependency-free QR code reader (versions 1-10, all error-correction levels,
 * byte/alphanumeric/numeric data) for grayscale camera frames. Plain Java on purpose,
 * so it can be tested on a PC. Structure follows the well-known ZXing pipeline:
 * binarize -> find the three finder patterns -> perspective-sample the grid ->
 * read format info -> unmask -> de-interleave -> Reed-Solomon correct -> parse.
 */
public final class QrDecoder {

    /**
     * Tries several thresholdings (local windows of a few sizes, then global) and returns
     * the decoded text, or null. Local windows handle a small white QR card on a dark screen.
     */
    public static String decode(byte[] gray, int w, int h) {
        long[] integ = integral(gray, w, h);
        int minSide = Math.min(w, h);
        int[] radii = {Math.max(10, minSide / 40), Math.max(16, minSide / 20), Math.max(30, minSide / 10)};
        for (int r : radii) {
            String s = decodeBinary(binarizeLocal(gray, integ, w, h, r), w, h);
            if (s != null) return s;
        }
        return decodeBinary(binarizeOtsu(gray, w, h), w, h);
    }

    // ------------------------------------------------------------------ binarization

    static boolean[] binarizeOtsu(byte[] g, int w, int h) {
        int[] hist = new int[256];
        for (int i = 0; i < w * h; i++) hist[g[i] & 0xff]++;
        long total = (long) w * h, sum = 0;
        for (int i = 0; i < 256; i++) sum += (long) i * hist[i];
        long sumB = 0, wB = 0;
        double best = -1;
        int thr = 128;
        for (int t = 0; t < 256; t++) {
            wB += hist[t];
            if (wB == 0) continue;
            long wF = total - wB;
            if (wF == 0) break;
            sumB += (long) t * hist[t];
            double mB = (double) sumB / wB, mF = (double) (sum - sumB) / wF;
            double between = (double) wB * wF * (mB - mF) * (mB - mF);
            if (between > best) {
                best = between;
                thr = t;
            }
        }
        boolean[] out = new boolean[w * h];
        for (int i = 0; i < w * h; i++) out[i] = (g[i] & 0xff) <= thr;
        return out;
    }

    static long[] integral(byte[] g, int w, int h) {
        long[] integ = new long[(w + 1) * (h + 1)];
        for (int y = 0; y < h; y++) {
            long row = 0;
            for (int x = 0; x < w; x++) {
                row += g[y * w + x] & 0xff;
                integ[(y + 1) * (w + 1) + x + 1] = integ[y * (w + 1) + x + 1] + row;
            }
        }
        return integ;
    }

    static boolean[] binarizeLocal(byte[] g, int w, int h) {
        return binarizeLocal(g, integral(g, w, h), w, h, Math.max(12, Math.min(w, h) / 8));
    }

    /** Pixel is dark if clearly below the mean of its (2r+1)² neighbourhood. */
    static boolean[] binarizeLocal(byte[] g, long[] integ, int w, int h, int r) {
        boolean[] out = new boolean[w * h];
        for (int y = 0; y < h; y++) {
            int y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
            for (int x = 0; x < w; x++) {
                int x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
                long s = integ[y1 * (w + 1) + x1] - integ[y0 * (w + 1) + x1] - integ[y1 * (w + 1) + x0] + integ[y0 * (w + 1) + x0];
                int area = (x1 - x0) * (y1 - y0);
                int mean = (int) (s / area);
                out[y * w + x] = (g[y * w + x] & 0xff) < mean - Math.max(6, mean / 12);
            }
        }
        return out;
    }

    // ------------------------------------------------------------------ finder patterns

    static final class Pt {
        float x, y, size;
        int count;

        Pt(float x, float y, float size) {
            this.x = x;
            this.y = y;
            this.size = size;
            this.count = 1;
        }
    }

    private static final class Img {
        final boolean[] b;
        final int w, h;

        Img(boolean[] b, int w, int h) {
            this.b = b;
            this.w = w;
            this.h = h;
        }

        boolean black(int x, int y) {
            return x >= 0 && y >= 0 && x < w && y < h && b[y * w + x];
        }
    }

    static String decodeBinary(boolean[] bits, int w, int h) {
        Img img = new Img(bits, w, h);
        List<Pt> centers = findFinders(img);
        if (centers.size() < 3) return null;
        // Try the most likely triples first (strongest candidates, consistent size, right-angle layout).
        centers.sort((a, b) -> b.count - a.count);
        int n = Math.min(centers.size(), 12);
        List<Pt[]> triples = new ArrayList<>();
        List<Float> scores = new ArrayList<>();
        for (int i = 0; i < n; i++)
            for (int j = i + 1; j < n; j++)
                for (int k = j + 1; k < n; k++) {
                    Pt[] t = order(centers.get(i), centers.get(j), centers.get(k));
                    float s = tripleScore(t);
                    if (s < 0) continue;
                    int pos = 0;
                    while (pos < scores.size() && scores.get(pos) <= s) pos++;
                    scores.add(pos, s);
                    triples.add(pos, t);
                }
        for (int i = 0; i < Math.min(triples.size(), 8); i++) {
            String r = decodeTriple(img, triples.get(i));
            if (r != null) return r;
        }
        return null;
    }

    private static List<Pt> findFinders(Img img) {
        List<Pt> centers = new ArrayList<>();
        int[] sc = new int[5];
        for (int y = 0; y < img.h; y += 2) {
            java.util.Arrays.fill(sc, 0);
            int state = 0;
            for (int x = 0; x < img.w; x++) {
                if (img.black(x, y)) {
                    if ((state & 1) == 1) state++;
                    sc[state]++;
                } else {
                    if ((state & 1) == 0) {
                        if (state == 4) {
                            if (crossRatio(sc)) handleCenter(img, centers, sc, y, x);
                            sc[0] = sc[2];
                            sc[1] = sc[3];
                            sc[2] = sc[4];
                            sc[3] = 1;
                            sc[4] = 0;
                            state = 3;
                        } else {
                            sc[++state]++;
                        }
                    } else {
                        sc[state]++;
                    }
                }
            }
            if (state == 4 && crossRatio(sc)) handleCenter(img, centers, sc, y, img.w);
        }
        List<Pt> good = new ArrayList<>();
        for (Pt p : centers) if (p.count >= 2) good.add(p);
        return good.size() >= 3 ? good : centers;
    }

    /** 1:1:3:1:1 dark-light-dark-light-dark run lengths. */
    private static boolean crossRatio(int[] s) {
        int total = 0;
        for (int v : s) {
            if (v == 0) return false;
            total += v;
        }
        if (total < 7) return false;
        float m = total / 7f, var = m / 1.6f;
        return Math.abs(m - s[0]) < var && Math.abs(m - s[1]) < var && Math.abs(3 * m - s[2]) < 3 * var
                && Math.abs(m - s[3]) < var && Math.abs(m - s[4]) < var;
    }

    private static float centerFromEnd(int[] s, int end) {
        return end - s[4] - s[3] - s[2] / 2f;
    }

    private static void handleCenter(Img img, List<Pt> centers, int[] sc, int y, int xEnd) {
        int total = sc[0] + sc[1] + sc[2] + sc[3] + sc[4];
        float cx = centerFromEnd(sc, xEnd);
        float cy = crossCheck(img, (int) cx, y, sc[2], total, true);
        if (Float.isNaN(cy)) return;
        cx = crossCheck(img, (int) cx, (int) cy, sc[2], total, false);
        if (Float.isNaN(cx)) return;
        float size = total / 7f;
        for (Pt p : centers) {
            if (Math.abs(cy - p.y) <= size && Math.abs(cx - p.x) <= size) {
                float d = Math.abs(size - p.size);
                if (d <= 1f || d <= p.size) {
                    int c = p.count;
                    p.x = (c * p.x + cx) / (c + 1);
                    p.y = (c * p.y + cy) / (c + 1);
                    p.size = (c * p.size + size) / (c + 1);
                    p.count++;
                    return;
                }
            }
        }
        centers.add(new Pt(cx, cy, size));
    }

    /** Re-measures the 1:1:3:1:1 runs along a column (vertical) or row through the candidate centre. */
    private static float crossCheck(Img img, int cx, int cy, int maxCount, int originalTotal, boolean vertical) {
        int[] s = new int[5];
        int limit = vertical ? img.h : img.w;
        int i = vertical ? cy : cx;
        while (i >= 0 && px(img, cx, cy, i, vertical)) {
            s[2]++;
            i--;
        }
        if (i < 0) return Float.NaN;
        while (i >= 0 && !px(img, cx, cy, i, vertical) && s[1] <= maxCount) {
            s[1]++;
            i--;
        }
        if (i < 0 || s[1] > maxCount) return Float.NaN;
        while (i >= 0 && px(img, cx, cy, i, vertical) && s[0] <= maxCount) {
            s[0]++;
            i--;
        }
        if (s[0] > maxCount) return Float.NaN;
        i = (vertical ? cy : cx) + 1;
        while (i < limit && px(img, cx, cy, i, vertical)) {
            s[2]++;
            i++;
        }
        if (i == limit) return Float.NaN;
        while (i < limit && !px(img, cx, cy, i, vertical) && s[3] < maxCount) {
            s[3]++;
            i++;
        }
        if (i == limit || s[3] >= maxCount) return Float.NaN;
        while (i < limit && px(img, cx, cy, i, vertical) && s[4] < maxCount) {
            s[4]++;
            i++;
        }
        if (s[4] >= maxCount) return Float.NaN;
        int total = s[0] + s[1] + s[2] + s[3] + s[4];
        if (5 * Math.abs(total - originalTotal) >= 2 * originalTotal) return Float.NaN;
        return crossRatio(s) ? centerFromEnd(s, i) : Float.NaN;
    }

    private static boolean px(Img img, int cx, int cy, int i, boolean vertical) {
        return vertical ? img.black(cx, i) : img.black(i, cy);
    }

    /** Returns {bottomLeft, topLeft, topRight}. */
    static Pt[] order(Pt a, Pt b, Pt c) {
        float ab = dist(a, b), bc = dist(b, c), ac = dist(a, c);
        Pt A, B, C;
        if (bc >= ab && bc >= ac) {
            B = a;
            A = b;
            C = c;
        } else if (ac >= bc && ac >= ab) {
            B = b;
            A = a;
            C = c;
        } else {
            B = c;
            A = a;
            C = b;
        }
        if ((C.x - B.x) * (A.y - B.y) - (C.y - B.y) * (A.x - B.x) < 0) {
            Pt t = A;
            A = C;
            C = t;
        }
        return new Pt[]{A, B, C};
    }

    /** Lower is better; negative = not a plausible QR (sizes must match, legs equal-ish, ~90°). */
    private static float tripleScore(Pt[] t) {
        Pt bl = t[0], tl = t[1], tr = t[2];
        float s1 = bl.size, s2 = tl.size, s3 = tr.size;
        float avg = (s1 + s2 + s3) / 3;
        float sizeVar = (Math.abs(s1 - avg) + Math.abs(s2 - avg) + Math.abs(s3 - avg)) / avg;
        if (sizeVar > 0.6f) return -1;
        float d1 = dist(tl, tr), d2 = dist(tl, bl);
        if (d1 < 10 * avg * 0.7f || d2 < 10 * avg * 0.7f) return -1; // closer than a version-1 code
        float legRatio = Math.max(d1, d2) / Math.min(d1, d2);
        if (legRatio > 1.6f) return -1;
        float cos = ((tr.x - tl.x) * (bl.x - tl.x) + (tr.y - tl.y) * (bl.y - tl.y)) / (d1 * d2);
        if (Math.abs(cos) > 0.45f) return -1;
        return sizeVar + (legRatio - 1) + Math.abs(cos);
    }

    static float dist(Pt a, Pt b) {
        float dx = a.x - b.x, dy = a.y - b.y;
        return (float) Math.sqrt(dx * dx + dy * dy);
    }

    // ------------------------------------------------------------------ sampling

    private static String decodeTriple(Img img, Pt[] t) {
        Pt bl = t[0], tl = t[1], tr = t[2];
        float module = (bl.size + tl.size + tr.size) / 3f;
        int dim = (Math.round(dist(tl, tr) / module) + Math.round(dist(tl, bl) / module)) / 2 + 7;
        switch (dim & 3) {
            case 0: dim++; break;
            case 2: dim--; break;
            case 3: dim -= 2; break;
        }
        int[] dims = {dim, dim + 4, dim - 4};
        for (int d : dims) {
            int version = (d - 17) / 4;
            if (version < 1 || version > 10) continue;
            String r = sampleAndDecode(img, tl, tr, bl, module, d);
            if (r != null) return r;
        }
        return null;
    }

    private static String sampleAndDecode(Img img, Pt tl, Pt tr, Pt bl, float module, int dim) {
        float brx = tr.x - tl.x + bl.x, bry = tr.y - tl.y + bl.y;
        float srcBr = dim - 3.5f;
        float ax = brx, ay = bry;
        if (dim > 21) {
            float corr = 1f - 3f / (dim - 7);
            float ex = tl.x + corr * (brx - tl.x), ey = tl.y + corr * (bry - tl.y);
            float[] found = null;
            for (int allowance : new int[]{4, 8, 16}) {
                found = findAlignment(img, ex, ey, module, allowance);
                if (found != null) break;
            }
            ax = found != null ? found[0] : ex;
            ay = found != null ? found[1] : ey;
            srcBr = dim - 6.5f;
        }
        Persp p = Persp.q2q(3.5f, 3.5f, dim - 3.5f, 3.5f, srcBr, srcBr, 3.5f, dim - 3.5f,
                tl.x, tl.y, tr.x, tr.y, ax, ay, bl.x, bl.y);
        boolean[][] m = new boolean[dim][dim];
        float[] pt = new float[2];
        for (int y = 0; y < dim; y++)
            for (int x = 0; x < dim; x++) {
                p.map(x + 0.5f, y + 0.5f, pt);
                m[y][x] = img.black(Math.round(pt[0] - 0.5f), Math.round(pt[1] - 0.5f));
            }
        try {
            return decodeMatrix(m);
        } catch (Exception e) {
            // Maybe it's mirrored (rare) — try the transpose.
            boolean[][] tm = new boolean[dim][dim];
            for (int y = 0; y < dim; y++) for (int x = 0; x < dim; x++) tm[y][x] = m[x][y];
            try {
                return decodeMatrix(tm);
            } catch (Exception e2) {
                return null;
            }
        }
    }

    /** Looks for the small alignment pattern (dark centre, light ring) near its expected spot. */
    private static float[] findAlignment(Img img, float ex, float ey, float module, int allowance) {
        int r = (int) (allowance * module);
        int x0 = Math.max(0, (int) ex - r), x1 = Math.min(img.w - 1, (int) ex + r);
        int y0 = Math.max(0, (int) ey - r), y1 = Math.min(img.h - 1, (int) ey + r);
        if (x1 - x0 < module * 3 || y1 - y0 < module * 3) return null;
        float best = Float.MAX_VALUE;
        float[] res = null;
        for (int dy = 0; dy <= (y1 - y0) / 2; dy++) {
            for (int sign = -1; sign <= 1; sign += 2) {
                int y = (int) ey + sign * dy;
                if (y < y0 || y > y1) continue;
                int[] s = new int[3];
                int state = 0;
                for (int x = x0; x <= x1 + 1; x++) {
                    boolean b = x <= x1 && img.black(x, y);
                    // looking for light(0) dark(1) light(2)
                    if (state == 0 && b) {
                        if (s[0] > 0) state = 1;
                    } else if (state == 1 && !b) state = 2;
                    else if (state == 2 && b) {
                        if (alignRatio(s, module)) {
                            float cx = x - s[2] - s[1] / 2f;
                            float cy = alignCross(img, (int) cx, y, module);
                            if (!Float.isNaN(cy)) {
                                float dd = Math.abs(cx - ex) + Math.abs(cy - ey);
                                if (dd < best) {
                                    best = dd;
                                    res = new float[]{cx, cy};
                                }
                            }
                        }
                        s[0] = s[2];
                        s[1] = 0;
                        s[2] = 0;
                        state = 1;
                    }
                    if (state <= 2) s[state]++;
                }
            }
            if (res != null) return res;
        }
        return res;
    }

    private static boolean alignRatio(int[] s, float module) {
        float var = module / 1.4f;
        return Math.abs(module - s[1]) < var && s[0] > 0 && s[2] > 0 && Math.abs(module - Math.min(s[0], module * 2)) < var * 1.6f;
    }

    private static float alignCross(Img img, int cx, int cy, float module) {
        int up = 0, down = 0, y = cy;
        while (y >= 0 && img.black(cx, y) && up < module * 2) {
            up++;
            y--;
        }
        int lightUp = 0;
        while (y >= 0 && !img.black(cx, y) && lightUp < module * 2) {
            lightUp++;
            y--;
        }
        y = cy + 1;
        while (y < img.h && img.black(cx, y) && down < module * 2) {
            down++;
            y++;
        }
        int lightDown = 0;
        while (y < img.h && !img.black(cx, y) && lightDown < module * 2) {
            lightDown++;
            y++;
        }
        float dark = up + down;
        if (Math.abs(dark - module) > module * 0.75f || lightUp < module * 0.4f || lightDown < module * 0.4f) return Float.NaN;
        return cy - up + dark / 2f;
    }

    /** Perspective transform (quadrilateral -> quadrilateral), as in ZXing. */
    static final class Persp {
        float a11, a12, a13, a21, a22, a23, a31, a32, a33;

        Persp(float a11, float a21, float a31, float a12, float a22, float a32, float a13, float a23, float a33) {
            this.a11 = a11;
            this.a12 = a12;
            this.a13 = a13;
            this.a21 = a21;
            this.a22 = a22;
            this.a23 = a23;
            this.a31 = a31;
            this.a32 = a32;
            this.a33 = a33;
        }

        static Persp q2q(float x0, float y0, float x1, float y1, float x2, float y2, float x3, float y3,
                         float x0p, float y0p, float x1p, float y1p, float x2p, float y2p, float x3p, float y3p) {
            Persp qToS = s2q(x0, y0, x1, y1, x2, y2, x3, y3).adjoint();
            Persp sToQ = s2q(x0p, y0p, x1p, y1p, x2p, y2p, x3p, y3p);
            return sToQ.times(qToS);
        }

        static Persp s2q(float x0, float y0, float x1, float y1, float x2, float y2, float x3, float y3) {
            float dx3 = x0 - x1 + x2 - x3, dy3 = y0 - y1 + y2 - y3;
            if (dx3 == 0f && dy3 == 0f) return new Persp(x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0f, 0f, 1f);
            float dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
            float den = dx1 * dy2 - dx2 * dy1;
            float a13 = (dx3 * dy2 - dx2 * dy3) / den, a23 = (dx1 * dy3 - dx3 * dy1) / den;
            return new Persp(x1 - x0 + a13 * x1, x3 - x0 + a23 * x3, x0, y1 - y0 + a13 * y1, y3 - y0 + a23 * y3, y0, a13, a23, 1f);
        }

        Persp adjoint() {
            return new Persp(a22 * a33 - a23 * a32, a23 * a31 - a21 * a33, a21 * a32 - a22 * a31,
                    a13 * a32 - a12 * a33, a11 * a33 - a13 * a31, a12 * a31 - a11 * a32,
                    a12 * a23 - a13 * a22, a13 * a21 - a11 * a23, a11 * a22 - a12 * a21);
        }

        Persp times(Persp o) {
            return new Persp(
                    a11 * o.a11 + a21 * o.a12 + a31 * o.a13, a11 * o.a21 + a21 * o.a22 + a31 * o.a23, a11 * o.a31 + a21 * o.a32 + a31 * o.a33,
                    a12 * o.a11 + a22 * o.a12 + a32 * o.a13, a12 * o.a21 + a22 * o.a22 + a32 * o.a23, a12 * o.a31 + a22 * o.a32 + a32 * o.a33,
                    a13 * o.a11 + a23 * o.a12 + a33 * o.a13, a13 * o.a21 + a23 * o.a22 + a33 * o.a23, a13 * o.a31 + a23 * o.a32 + a33 * o.a33);
        }

        void map(float x, float y, float[] out) {
            float d = a13 * x + a23 * y + a33;
            out[0] = (a11 * x + a21 * y + a31) / d;
            out[1] = (a12 * x + a22 * y + a32) / d;
        }
    }

    // ------------------------------------------------------------------ matrix -> text

    // Error-correction tables, versions 0..10 (index 0 unused). Order: L, M, Q, H.
    private static final int[][] ECC_PER_BLOCK = {
            {-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18},
            {-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26},
            {-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24},
            {-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28},
    };
    private static final int[][] NUM_BLOCKS = {
            {-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4},
            {-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5},
            {-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8},
            {-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8},
    };

    static int rawModules(int ver) {
        int r = (16 * ver + 128) * ver + 64;
        if (ver >= 2) {
            int na = ver / 7 + 2;
            r -= (25 * na - 10) * na - 55;
            if (ver >= 7) r -= 36;
        }
        return r;
    }

    static int[] alignPositions(int ver, int size) {
        if (ver == 1) return new int[0];
        int na = ver / 7 + 2;
        int step = (int) Math.ceil((ver * 4 + 4) / (double) (na * 2 - 2)) * 2;
        int[] r = new int[na];
        r[0] = 6;
        for (int i = na - 1, pos = size - 7; i >= 1; i--, pos -= step) r[i] = pos;
        return r;
    }

    private static boolean maskBit(int mask, int x, int y) {
        switch (mask) {
            case 0: return (x + y) % 2 == 0;
            case 1: return y % 2 == 0;
            case 2: return x % 3 == 0;
            case 3: return (x + y) % 3 == 0;
            case 4: return (x / 3 + y / 2) % 2 == 0;
            case 5: return x * y % 2 + x * y % 3 == 0;
            case 6: return (x * y % 2 + x * y % 3) % 2 == 0;
            default: return ((x + y) % 2 + x * y % 3) % 2 == 0;
        }
    }

    private static int formatBits(int data) {
        int rem = data;
        for (int i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
        return ((data << 10) | rem) ^ 0x5412;
    }

    static String decodeMatrix(boolean[][] m) throws Exception {
        int size = m.length;
        int ver = (size - 17) / 4;
        // ---- format info (two copies, pick the closest valid code)
        int f1 = 0, f2 = 0;
        for (int i = 0; i <= 5; i++) if (m[i][8]) f1 |= 1 << i;
        if (m[7][8]) f1 |= 1 << 6;
        if (m[8][8]) f1 |= 1 << 7;
        if (m[8][7]) f1 |= 1 << 8;
        for (int i = 9; i < 15; i++) if (m[8][14 - i]) f1 |= 1 << i;
        for (int i = 0; i < 8; i++) if (m[8][size - 1 - i]) f2 |= 1 << i;
        for (int i = 8; i < 15; i++) if (m[size - 15 + i][8]) f2 |= 1 << i;
        int bestD = 99, fmt = -1;
        for (int d = 0; d < 32; d++) {
            int code = formatBits(d);
            int dist = Math.min(Integer.bitCount(code ^ f1), Integer.bitCount(code ^ f2));
            if (dist < bestD) {
                bestD = dist;
                fmt = d;
            }
        }
        if (bestD > 3) throw new Exception("format");
        int eclBits = fmt >> 3, mask = fmt & 7;
        int ecl = eclBits == 1 ? 0 : eclBits == 0 ? 1 : eclBits == 3 ? 2 : 3; // L M Q H

        // ---- which modules are data
        boolean[][] fn = new boolean[size][size];
        for (int y = 0; y < size; y++) for (int x = 0; x < size; x++) {
            if (x < 9 && y < 9) fn[y][x] = true;
            if (x >= size - 8 && y < 9) fn[y][x] = true;
            if (x < 9 && y >= size - 8) fn[y][x] = true;
            if (x == 6 || y == 6) fn[y][x] = true;
        }
        int[] al = alignPositions(ver, size);
        for (int i = 0; i < al.length; i++)
            for (int j = 0; j < al.length; j++) {
                if ((i == 0 && j == 0) || (i == 0 && j == al.length - 1) || (i == al.length - 1 && j == 0)) continue;
                for (int dy = -2; dy <= 2; dy++) for (int dx = -2; dx <= 2; dx++) fn[al[j] + dy][al[i] + dx] = true;
            }
        if (ver >= 7) {
            for (int i = 0; i < 6; i++) for (int k = 0; k < 3; k++) {
                fn[i][size - 11 + k] = true;
                fn[size - 11 + k][i] = true;
            }
        }

        // ---- read codewords (zig-zag), unmasking as we go
        int rawCw = rawModules(ver) / 8;
        int[] cw = new int[rawCw];
        int bit = 0;
        for (int right = size - 1; right >= 1; right -= 2) {
            if (right == 6) right = 5;
            for (int vert = 0; vert < size; vert++) {
                for (int j = 0; j < 2; j++) {
                    int x = right - j;
                    boolean upward = ((right + 1) & 2) == 0;
                    int y = upward ? size - 1 - vert : vert;
                    if (fn[y][x] || bit >= rawCw * 8) continue;
                    boolean v = m[y][x] ^ maskBit(mask, x, y);
                    if (v) cw[bit >>> 3] |= 1 << (7 - (bit & 7));
                    bit++;
                }
            }
        }

        // ---- de-interleave + Reed-Solomon correct each block
        int nb = NUM_BLOCKS[ecl][ver], eccLen = ECC_PER_BLOCK[ecl][ver];
        int numShort = nb - rawCw % nb, shortLen = rawCw / nb;
        int[][] blocks = new int[nb][shortLen + 1];
        int k = 0;
        for (int i = 0; i <= shortLen; i++)
            for (int j = 0; j < nb; j++)
                if (i != shortLen - eccLen || j >= numShort) blocks[j][i] = cw[k++];
        List<Integer> data = new ArrayList<>();
        for (int j = 0; j < nb; j++) {
            int dataLen = shortLen - eccLen + (j < numShort ? 0 : 1);
            int[] word = new int[dataLen + eccLen];
            System.arraycopy(blocks[j], 0, word, 0, dataLen);
            System.arraycopy(blocks[j], shortLen + 1 - eccLen, word, dataLen, eccLen);
            ReedSolomon.correct(word, eccLen);
            for (int i = 0; i < dataLen; i++) data.add(word[i]);
        }
        return parse(data, ver);
    }

    private static final String ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

    private static String parse(List<Integer> data, int ver) throws Exception {
        BitReader r = new BitReader(data);
        StringBuilder out = new StringBuilder();
        java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
        while (r.available() >= 4) {
            int mode = r.read(4);
            if (mode == 0) break;
            if (mode == 4) { // byte
                int n = r.read(ver < 10 ? 8 : 16);
                for (int i = 0; i < n; i++) bytes.write(r.read(8));
            } else if (mode == 2) { // alphanumeric
                flush(bytes, out);
                int n = r.read(ver < 10 ? 9 : 11);
                for (; n >= 2; n -= 2) {
                    int v = r.read(11);
                    out.append(ALNUM.charAt(v / 45)).append(ALNUM.charAt(v % 45));
                }
                if (n == 1) out.append(ALNUM.charAt(r.read(6)));
            } else if (mode == 1) { // numeric
                flush(bytes, out);
                int n = r.read(ver < 10 ? 10 : 12);
                for (; n >= 3; n -= 3) out.append(String.format("%03d", r.read(10)));
                if (n == 2) out.append(String.format("%02d", r.read(7)));
                else if (n == 1) out.append(r.read(4));
            } else if (mode == 7) { // ECI: skip the designator
                int b = r.read(8);
                if ((b & 0x80) != 0) r.read((b & 0x40) != 0 ? 16 : 8);
            } else {
                throw new Exception("mode " + mode);
            }
        }
        flush(bytes, out);
        if (out.length() == 0) throw new Exception("empty");
        return out.toString();
    }

    private static void flush(java.io.ByteArrayOutputStream bytes, StringBuilder out) {
        if (bytes.size() == 0) return;
        out.append(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
        bytes.reset();
    }

    private static final class BitReader {
        private final List<Integer> d;
        private int pos;

        BitReader(List<Integer> d) {
            this.d = d;
        }

        int available() {
            return d.size() * 8 - pos;
        }

        int read(int n) throws Exception {
            if (n > available()) throw new Exception("eof");
            int v = 0;
            for (int i = 0; i < n; i++, pos++) v = (v << 1) | ((d.get(pos >>> 3) >>> (7 - (pos & 7))) & 1);
            return v;
        }
    }

    // ------------------------------------------------------------------ Reed-Solomon over GF(256), poly 0x11D

    static final class ReedSolomon {
        static final int[] EXP = new int[512], LOG = new int[256];

        static {
            int x = 1;
            for (int i = 0; i < 255; i++) {
                EXP[i] = x;
                LOG[x] = i;
                x <<= 1;
                if (x >= 256) x ^= 0x11D;
            }
            for (int i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
        }

        static int mul(int a, int b) {
            return a == 0 || b == 0 ? 0 : EXP[LOG[a] + LOG[b]];
        }

        static int inv(int a) {
            return EXP[255 - LOG[a]];
        }

        // Polynomials: coefficient arrays, highest degree first.
        static int[] trim(int[] p) {
            int i = 0;
            while (i < p.length - 1 && p[i] == 0) i++;
            return i == 0 ? p : java.util.Arrays.copyOfRange(p, i, p.length);
        }

        static int deg(int[] p) {
            return p.length - 1;
        }

        static boolean zero(int[] p) {
            return p[0] == 0;
        }

        static int coef(int[] p, int degree) {
            return p[p.length - 1 - degree];
        }

        static int eval(int[] p, int a) {
            if (a == 0) return coef(p, 0);
            int r = 0;
            for (int c : p) r = mul(r, a) ^ c;
            return r;
        }

        static int[] add(int[] a, int[] b) {
            if (zero(a)) return b;
            if (zero(b)) return a;
            int[] small = a, large = b;
            if (small.length > large.length) {
                small = b;
                large = a;
            }
            int[] s = new int[large.length];
            int diff = large.length - small.length;
            System.arraycopy(large, 0, s, 0, diff);
            for (int i = diff; i < large.length; i++) s[i] = small[i - diff] ^ large[i];
            return trim(s);
        }

        static int[] mulPoly(int[] a, int[] b) {
            if (zero(a) || zero(b)) return new int[]{0};
            int[] r = new int[a.length + b.length - 1];
            for (int i = 0; i < a.length; i++) for (int j = 0; j < b.length; j++) r[i + j] ^= mul(a[i], b[j]);
            return trim(r);
        }

        static int[] mulMono(int[] p, int degree, int c) {
            if (c == 0) return new int[]{0};
            int[] r = new int[p.length + degree];
            for (int i = 0; i < p.length; i++) r[i] = mul(p[i], c);
            return trim(r);
        }

        static int[] mono(int degree, int c) {
            if (c == 0) return new int[]{0};
            int[] r = new int[degree + 1];
            r[0] = c;
            return r;
        }

        /** Corrects `word` (data then `ecc` check bytes) in place; throws if it can't. */
        static void correct(int[] word, int ecc) throws Exception {
            int[] poly = trim(word.clone());
            int[] synd = new int[ecc];
            boolean clean = true;
            for (int i = 0; i < ecc; i++) {
                int v = eval(poly, EXP[i]);
                synd[ecc - 1 - i] = v;
                if (v != 0) clean = false;
            }
            if (clean) return;
            int[] s = trim(synd);
            // Euclidean algorithm -> error locator sigma and evaluator omega
            int[] rLast = mono(ecc, 1), r = s, tLast = new int[]{0}, t = new int[]{1};
            if (deg(rLast) < deg(r)) {
                int[] tmp = rLast;
                rLast = r;
                r = tmp;
            }
            while (deg(r) >= ecc / 2) {
                int[] rLastLast = rLast, tLastLast = tLast;
                rLast = r;
                tLast = t;
                if (zero(rLast)) throw new Exception("rs");
                r = rLastLast;
                int[] q = new int[]{0};
                int dlt = inv(coef(rLast, deg(rLast)));
                while (deg(r) >= deg(rLast) && !zero(r)) {
                    int dd = deg(r) - deg(rLast);
                    int scale = mul(coef(r, deg(r)), dlt);
                    q = add(q, mono(dd, scale));
                    r = add(r, mulMono(rLast, dd, scale));
                }
                t = add(mulPoly(q, tLast), tLastLast);
                if (deg(r) >= deg(rLast)) throw new Exception("rs");
            }
            int sigma0 = coef(t, 0);
            if (sigma0 == 0) throw new Exception("rs");
            int invS = inv(sigma0);
            int[] sigma = mulMono(t, 0, invS), omega = mulMono(r, 0, invS);
            // Chien search
            int ne = deg(sigma);
            int[] locs = new int[ne];
            if (ne == 1) locs[0] = coef(sigma, 1);
            else {
                int e = 0;
                for (int i = 1; i < 256 && e < ne; i++) if (eval(sigma, i) == 0) locs[e++] = inv(i);
                if (e != ne) throw new Exception("rs");
            }
            // Forney
            for (int i = 0; i < ne; i++) {
                int xi = inv(locs[i]);
                int den = 1;
                for (int j = 0; j < ne; j++) {
                    if (i == j) continue;
                    int term = mul(locs[j], xi);
                    den = mul(den, (term & 1) == 0 ? term | 1 : term & ~1);
                }
                int mag = mul(eval(omega, xi), inv(den));
                int pos = word.length - 1 - LOG[locs[i]];
                if (pos < 0) throw new Exception("rs");
                word[pos] ^= mag;
            }
        }
    }
}
