package com.questmirror.app;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.ColorFilter;
import android.graphics.DashPathEffect;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.StateListDrawable;
import android.os.SystemClock;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * "Technical paper" look: paper / ink / signal-red, cut corners, mono data labels, dot grid.
 * Every control is big and has clear hover (hand ray) and pressed (pinch) states.
 */
final class Ui {
    // Current palette (set by applyTheme).
    static int BG, BG2, BG3, INK, INK2, INK3, DOT, SIGNAL;
    static final int ON_SIGNAL = 0xFFFFFFFF;
    static boolean night;

    static final Typeface DISPLAY = Typeface.create("sans-serif-condensed", Typeface.BOLD);
    static final Typeface UI = Typeface.create("sans-serif-condensed", Typeface.NORMAL);
    static final Typeface MONO = Typeface.MONOSPACE;
    static final Typeface MONO_BOLD = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD);

    static {
        applyTheme(false);
    }

    private Ui() {
    }

    static void applyTheme(boolean nightTheme) {
        night = nightTheme;
        if (night) {
            BG = 0xFF0C0C0E; BG2 = 0xFF141417; BG3 = 0xFF1F1F23;
            INK = 0xFFECEBE6; INK2 = 0xFFB6B5B0; INK3 = 0xFF6F6F74; DOT = 0x26ECEBE6; SIGNAL = 0xFFFF4A2E;
        } else {
            BG = 0xFFE7E6E1; BG2 = 0xFFF3F2ED; BG3 = 0xFFDAD9D3;
            INK = 0xFF0F1012; INK2 = 0xFF45474D; INK3 = 0xFF8A8B90; DOT = 0x330F1012; SIGNAL = 0xFFFF3B1F;
        }
    }

    static void loadTheme(Context c) {
        applyTheme(c.getSharedPreferences("questmirror", Context.MODE_PRIVATE).getBoolean("night", false));
    }

    static int dp(Context c, float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, c.getResources().getDisplayMetrics()));
    }

    // ------------------------------------------------------------------ drawables

    /** Rectangle with the top-left and bottom-right corners cut at 45°. */
    static final class Cut extends Drawable {
        private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final float cut, sw;
        private final Path path = new Path();

        Cut(int fillColor, int strokeColor, float strokeWidth, float cut) {
            fill.setColor(fillColor);
            stroke.setColor(strokeColor);
            stroke.setStyle(Paint.Style.STROKE);
            stroke.setStrokeWidth(strokeWidth);
            stroke.setStrokeJoin(Paint.Join.MITER);
            this.sw = strokeWidth;
            this.cut = cut;
        }

        @Override
        public void draw(Canvas c) {
            Rect b = getBounds();
            float h = sw / 2f, l = b.left + h, t = b.top + h, r = b.right - h, bt = b.bottom - h;
            float k = Math.min(cut, Math.min(b.width(), b.height()) / 2f);
            path.reset();
            path.moveTo(l + k, t);
            path.lineTo(r, t);
            path.lineTo(r, bt - k);
            path.lineTo(r - k, bt);
            path.lineTo(l, bt);
            path.lineTo(l, t + k);
            path.close();
            if ((fill.getColor() >>> 24) != 0) c.drawPath(path, fill);
            if (sw > 0) c.drawPath(path, stroke);
        }

        @Override
        public void setAlpha(int a) {
        }

        @Override
        public void setColorFilter(ColorFilter cf) {
        }

        @Override
        public int getOpacity() {
            return PixelFormat.TRANSLUCENT;
        }
    }

    /** Paper with a dot grid and "+" crosshairs, like a drafting sheet. */
    static Drawable gridBackground(Context c) {
        int cell = dp(c, 24), tile = cell * 5;
        Bitmap bmp = Bitmap.createBitmap(tile, tile, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(bmp);
        cv.drawColor(BG);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(DOT);
        float r = dp(c, 1.1f);
        for (int x = 0; x < tile; x += cell) for (int y = 0; y < tile; y += cell) cv.drawCircle(x + 1, y + 1, r, p);
        p.setStrokeWidth(dp(c, 1));
        p.setColor(INK3);
        float m = tile / 2f, a = dp(c, 6);
        cv.drawLine(m - a, m, m + a, m, p);
        cv.drawLine(m, m - a, m, m + a, p);
        final Paint shader = new Paint();
        final BitmapShader bs = new BitmapShader(bmp, Shader.TileMode.REPEAT, Shader.TileMode.REPEAT);
        shader.setShader(bs);
        final android.graphics.Matrix m2 = new android.graphics.Matrix();
        return new Drawable() {
            private long lastFrame;

            @Override
            public void draw(Canvas canvas) {
                // The drafting grid drifts very slowly diagonally — alive, never distracting.
                // X travels two tiles while Y travels one, so both wrap on a whole tile: no visible jump.
                long t = SystemClock.uptimeMillis();
                float shift = (t % (120L * tile)) / 60f;
                m2.setTranslate(shift, shift * 0.5f);
                bs.setLocalMatrix(m2);
                canvas.drawRect(getBounds(), shader);
                if (t - lastFrame > 0) {
                    lastFrame = t;
                    scheduleSelf(this::invalidateSelf, t + 50); // ~20 fps is plenty for a drift
                }
            }

            @Override
            public void setAlpha(int alpha) {
            }

            @Override
            public void setColorFilter(ColorFilter cf) {
            }

            @Override
            public int getOpacity() {
                return PixelFormat.OPAQUE;
            }
        };
    }

    /** Diagonal warning stripes. */
    static Drawable hatch(Context c, int color) {
        final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(color);
        p.setStrokeWidth(dp(c, 3));
        final float gap = dp(c, 7);
        return new Drawable() {
            @Override
            public void draw(Canvas cv) {
                Rect b = getBounds();
                cv.save();
                cv.clipRect(b);
                for (float x = b.left - b.height(); x < b.right; x += gap) cv.drawLine(x, b.bottom, x + b.height(), b.top, p);
                cv.restore();
            }

            @Override
            public void setAlpha(int alpha) {
            }

            @Override
            public void setColorFilter(ColorFilter cf) {
            }

            @Override
            public int getOpacity() {
                return PixelFormat.TRANSLUCENT;
            }
        };
    }

    // ------------------------------------------------------------------ text

    static TextView text(Context c, CharSequence s, float sp, int color, Typeface tf) {
        TextView t = new TextView(c);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        t.setTypeface(tf);
        t.setLineSpacing(0, 1.12f);
        return t;
    }

    static TextView mono(Context c, CharSequence s, float sp, int color) {
        TextView t = text(c, s, sp, color, MONO_BOLD);
        t.setLetterSpacing(0.08f);
        t.setAllCaps(true);
        return t;
    }

    /** "UTSUSHI/写し" with the slash in signal red. */
    static CharSequence wordmark() {
        SpannableString s = new SpannableString("UTSUSHI/写し");
        s.setSpan(new ForegroundColorSpan(SIGNAL), 7, 8, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        return s;
    }

    /** Section header: "01 // TITLE ————————". */
    static LinearLayout section(Context c, String num, String title) {
        LinearLayout row = row(c);
        row.setPadding(0, dp(c, 20), 0, dp(c, 10));
        SpannableString s = new SpannableString(num + "  " + title.toUpperCase());
        s.setSpan(new ForegroundColorSpan(SIGNAL), 0, num.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        TextView t = mono(c, s, 13, INK);
        t.setLetterSpacing(0.14f);
        row.addView(t);
        View rule = new View(c);
        rule.setBackgroundColor(INK);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, dp(c, 1.5f), 1);
        p.leftMargin = dp(c, 12);
        row.addView(rule, p);
        return row;
    }

    // ------------------------------------------------------------------ buttons

    private static Drawable outlineStates(Context c, float cutDp) {
        float k = dp(c, cutDp), s1 = dp(c, 1.5f), s2 = dp(c, 2.5f);
        StateListDrawable d = new StateListDrawable();
        d.addState(new int[]{-android.R.attr.state_enabled}, new Cut(BG3, INK3, s1, k));
        d.addState(new int[]{android.R.attr.state_pressed}, new Cut(SIGNAL, SIGNAL, s1, k));
        d.addState(new int[]{android.R.attr.state_selected, android.R.attr.state_hovered}, new Cut(INK, SIGNAL, s2, k));
        d.addState(new int[]{android.R.attr.state_selected}, new Cut(INK, INK, s1, k));
        d.addState(new int[]{android.R.attr.state_hovered}, new Cut(BG2, SIGNAL, s2, k));
        d.addState(new int[]{android.R.attr.state_focused}, new Cut(BG2, SIGNAL, s2, k));
        d.addState(new int[]{}, new Cut(BG2, INK, s1, k));
        d.setEnterFadeDuration(140); // states cross-fade instead of snapping
        d.setExitFadeDuration(220);
        return d;
    }

    private static Drawable primaryStates(Context c, float cutDp) {
        float k = dp(c, cutDp), s1 = dp(c, 1.5f);
        StateListDrawable d = new StateListDrawable();
        d.addState(new int[]{-android.R.attr.state_enabled}, new Cut(INK3, INK3, s1, k));
        d.addState(new int[]{android.R.attr.state_pressed}, new Cut(INK, SIGNAL, dp(c, 3), k));
        d.addState(new int[]{android.R.attr.state_hovered}, new Cut(SIGNAL, SIGNAL, s1, k));
        d.addState(new int[]{android.R.attr.state_focused}, new Cut(SIGNAL, SIGNAL, s1, k));
        d.addState(new int[]{}, new Cut(INK, INK, s1, k));
        d.setEnterFadeDuration(140);
        d.setExitFadeDuration(220);
        return d;
    }

    private static ColorStateList outlineText() {
        return new ColorStateList(new int[][]{
                {-android.R.attr.state_enabled}, {android.R.attr.state_pressed}, {android.R.attr.state_selected},
                {android.R.attr.state_hovered}, {android.R.attr.state_focused}, {}},
                new int[]{INK3, ON_SIGNAL, BG, SIGNAL, SIGNAL, INK});
    }

    private static ColorStateList primaryText() {
        return new ColorStateList(new int[][]{{android.R.attr.state_hovered}, {android.R.attr.state_pressed}, {}},
                new int[]{ON_SIGNAL, SIGNAL, BG2});
    }

    static Button button(Context c, String label, boolean primary) {
        Button b = new Button(c);
        b.setText(label);
        b.setAllCaps(true);
        b.setTypeface(MONO_BOLD);
        b.setLetterSpacing(0.1f);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        b.setMinHeight(dp(c, 64));
        b.setMinimumHeight(dp(c, 64));
        b.setMinWidth(dp(c, 64));
        b.setMinimumWidth(dp(c, 64));
        b.setPadding(dp(c, 18), dp(c, 8), dp(c, 18), dp(c, 8));
        b.setStateListAnimator(null);
        setPrimary(c, b, primary);
        return b;
    }

    static void setPrimary(Context c, Button b, boolean primary) {
        // Re-setting the same style restarts its fade-in (a grey flicker), so only switch on a change.
        if (Boolean.valueOf(primary).equals(b.getTag(R_PRIMARY))) return;
        b.setTag(R_PRIMARY, primary);
        b.setBackground(primary ? primaryStates(c, 12) : outlineStates(c, 12));
        b.setTextColor(primary ? primaryText() : outlineText());
    }

    /** Clickable card-like row: hover outlines it in signal red. */
    static void rowBackground(Context c, View v) {
        v.setBackground(outlineStates(c, 14));
        v.setClickable(true);
        v.setFocusable(true);
    }

    static LinearLayout card(Context c) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setPadding(dp(c, 28), dp(c, 22), dp(c, 28), dp(c, 26));
        l.setBackground(new Cut(BG2, INK, dp(c, 2), dp(c, 26)));
        return l;
    }

    static LinearLayout row(Context c) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.HORIZONTAL);
        l.setGravity(Gravity.CENTER_VERTICAL);
        return l;
    }

    static LinearLayout.LayoutParams weight(Context c, float w, int marginDp) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, w);
        p.setMargins(dp(c, marginDp), dp(c, marginDp), dp(c, marginDp), dp(c, marginDp));
        return p;
    }

    static LinearLayout.LayoutParams full(Context c, int topDp) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        p.topMargin = dp(c, topDp);
        return p;
    }

    static void show(View v, boolean visible) {
        v.setVisibility(visible ? View.VISIBLE : View.GONE);
    }

    // ------------------------------------------------------------------ custom views

    /** Square on/off switch: [■   ] off, [   ■] on (red knob on ink). */
    static final class SquareSwitch extends View {
        private boolean checked;
        private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);

        SquareSwitch(Context c) {
            super(c);
        }

        void setChecked(boolean v) {
            if (v != checked) {
                checked = v;
                invalidate();
            }
        }

        @Override
        protected void onMeasure(int w, int h) {
            setMeasuredDimension(dp(getContext(), 60), dp(getContext(), 30));
        }

        @Override
        protected void onDraw(Canvas c) {
            float s = dp(getContext(), 2), w = getWidth(), h = getHeight(), in = dp(getContext(), 5);
            p.setStyle(Paint.Style.FILL);
            p.setColor(checked ? INK : BG);
            c.drawRect(s / 2, s / 2, w - s / 2, h - s / 2, p);
            p.setStyle(Paint.Style.STROKE);
            p.setStrokeWidth(s);
            p.setColor(INK);
            c.drawRect(s / 2, s / 2, w - s / 2, h - s / 2, p);
            p.setStyle(Paint.Style.FILL);
            p.setColor(checked ? SIGNAL : INK3);
            float k = h - in * 2;
            float x = checked ? w - in - k : in;
            c.drawRect(x, in, x + k, in + k, p);
        }
    }

    interface Toggle {
        void on(boolean value);
    }

    /** Full-width row "LABEL ............ [switch]" that toggles on pinch. */
    static final class SwitchRow extends LinearLayout {
        final SquareSwitch sw;
        final TextView label;
        private boolean value;

        SwitchRow(Context c, String text, Toggle onToggle) {
            super(c);
            setOrientation(HORIZONTAL);
            setGravity(Gravity.CENTER_VERTICAL);
            setPadding(dp(c, 18), dp(c, 12), dp(c, 16), dp(c, 12));
            setMinimumHeight(dp(c, 64));
            rowBackground(c, this);
            label = text(c, text, 18, INK, UI);
            addView(label, new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1));
            sw = new SquareSwitch(c);
            addView(sw);
            setOnClickListener(v -> {
                setChecked(!value);
                onToggle.on(value);
            });
        }

        void setChecked(boolean v) {
            value = v;
            sw.setChecked(v);
        }
    }

    /** Busy indicator: dashed ring slowly turning, red arc spinning, red core. */
    static final class Ring extends View {
        private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF oval = new RectF();
        private boolean busy = true;

        Ring(Context c) {
            super(c);
            p.setStyle(Paint.Style.STROKE);
        }

        void setBusy(boolean b) {
            busy = b;
            invalidate();
        }

        @Override
        protected void onMeasure(int w, int h) {
            int s = dp(getContext(), 84);
            setMeasuredDimension(s, s);
        }

        @Override
        protected void onDraw(Canvas c) {
            float w = getWidth(), cx = w / 2f, r = w / 2f - dp(getContext(), 3);
            long t = SystemClock.uptimeMillis();
            p.setStrokeWidth(dp(getContext(), 1.5f));
            p.setColor(INK);
            p.setPathEffect(new DashPathEffect(new float[]{dp(getContext(), 3), dp(getContext(), 5)}, 0));
            c.save();
            c.rotate(busy ? (t / 25f) % 360 : 0, cx, cx);
            c.drawCircle(cx, cx, r, p);
            c.restore();
            p.setPathEffect(null);
            float r2 = r * 0.74f;
            oval.set(cx - r2, cx - r2, cx + r2, cx + r2);
            p.setStrokeWidth(dp(getContext(), 3));
            p.setColor(busy ? SIGNAL : INK3);
            if (busy) c.drawArc(oval, (t / 3f) % 360, 100, false, p);
            else c.drawCircle(cx, cx, r2, p);
            p.setStyle(Paint.Style.FILL);
            p.setColor(SIGNAL);
            c.drawCircle(cx, cx, dp(getContext(), 4), p);
            p.setStyle(Paint.Style.STROKE);
            if (busy && isShown()) postInvalidateOnAnimation();
        }
    }

    /** Logo: two brackets holding an ink bar and a signal bar. */
    static final class Logo extends View {
        private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);

        Logo(Context c) {
            super(c);
        }

        @Override
        protected void onMeasure(int w, int h) {
            int s = dp(getContext(), 40);
            setMeasuredDimension(s, s);
        }

        @Override
        protected void onDraw(Canvas c) {
            float u = getWidth() / 32f;
            p.setColor(INK);
            c.drawRect(3 * u, 3 * u, 12 * u, 6 * u, p);
            c.drawRect(3 * u, 3 * u, 6 * u, 29 * u, p);
            c.drawRect(3 * u, 26 * u, 12 * u, 29 * u, p);
            c.drawRect(20 * u, 3 * u, 29 * u, 6 * u, p);
            c.drawRect(26 * u, 3 * u, 29 * u, 29 * u, p);
            c.drawRect(20 * u, 26 * u, 29 * u, 29 * u, p);
            c.drawRect(11 * u, 12 * u, 15 * u, 20 * u, p);
            p.setColor(SIGNAL);
            c.drawRect(17 * u, 12 * u, 21 * u, 20 * u, p);
        }
    }

    // ------------------------------------------------------------------ motion

    static final android.view.animation.Interpolator EASE = new android.view.animation.DecelerateInterpolator(2.2f);

    /** Fade + rise into place (used for staggered entrances). */
    static void fadeUp(View v, long delayMs) {
        v.setAlpha(0f);
        v.setTranslationY(dp(v.getContext(), 22));
        v.animate().alpha(1f).translationY(0).setStartDelay(delayMs).setDuration(420).setInterpolator(EASE).start();
    }

    /**
     * Hover = the outline fades to signal red (drawable state) and, if the view has an accent
     * bar, it slides in. No growing or lifting: that pushed the outline past the parent's edge,
     * where it got clipped ("the line pops out and vanishes"). Pinch = a small squash inwards.
     */
    static void pressable(View v) {
        v.setOnHoverListener((view, e) -> {
            int a = e.getActionMasked();
            Object bar = view.getTag(R_ACCENT);
            if (bar instanceof View) {
                View b = (View) bar;
                if (a == android.view.MotionEvent.ACTION_HOVER_ENTER) b.animate().scaleX(1f).setDuration(260).setInterpolator(EASE).start();
                else if (a == android.view.MotionEvent.ACTION_HOVER_EXIT) b.animate().scaleX(0f).setDuration(200).setInterpolator(EASE).start();
            }
            return false;
        });
        v.setOnTouchListener((view, e) -> {
            int a = e.getActionMasked();
            if (a == android.view.MotionEvent.ACTION_DOWN) view.animate().scaleX(0.97f).scaleY(0.97f).setDuration(90).start();
            else if (a == android.view.MotionEvent.ACTION_UP || a == android.view.MotionEvent.ACTION_CANCEL) view.animate().scaleX(1f).scaleY(1f).setDuration(240).setInterpolator(new android.view.animation.OvershootInterpolator(2.5f)).start();
            return false;
        });
    }

    /** Tag key for a view's hover accent bar. */
    static final int R_ACCENT = 0x7f0f0001;
    static final int R_PRIMARY = 0x7f0f0002; // tag key: whether a button currently wears the primary style

    /** A red bar along the bottom of a card that sweeps in on hover (see pressable). */
    static View accentBar(Context c, View owner) {
        View bar = new View(c);
        bar.setBackgroundColor(SIGNAL);
        bar.setPivotX(0);
        bar.setScaleX(0f);
        owner.setTag(R_ACCENT, bar);
        return bar;
    }

    /** Slow breathing, for "live" dots. */
    static void pulse(View v) {
        android.animation.ObjectAnimator a = android.animation.ObjectAnimator.ofFloat(v, "alpha", 1f, 0.25f);
        a.setDuration(900);
        a.setRepeatMode(android.animation.ValueAnimator.REVERSE);
        a.setRepeatCount(android.animation.ValueAnimator.INFINITE);
        a.start();
        v.setTag(a);
    }

    /** Children appearing/disappearing animate the container's height instead of jumping. */
    static void autoAnimate(android.view.ViewGroup g) {
        android.animation.LayoutTransition lt = new android.animation.LayoutTransition();
        lt.enableTransitionType(android.animation.LayoutTransition.CHANGING);
        lt.setDuration(260);
        g.setLayoutTransition(lt);
    }

    /** Swap text with a quick cross-fade (only when it actually changes). */
    static void setTextSoft(TextView t, CharSequence s) {
        if (s.toString().equals(t.getText().toString())) return;
        t.animate().alpha(0f).setDuration(110).withEndAction(() -> {
            t.setText(s);
            t.animate().alpha(1f).setDuration(180).start();
        }).start();
    }

    /** Fold-out section: "⚙ MORE OPTIONS ▾". Keeps rarely-used settings out of the way. */
    static final class Fold extends LinearLayout {
        final LinearLayout body;
        private final TextView chevron;
        private boolean open;

        Fold(Context c, String title) {
            super(c);
            setOrientation(VERTICAL);
            autoAnimate(this);
            LinearLayout head = row(c);
            head.setPadding(dp(c, 18), dp(c, 14), dp(c, 18), dp(c, 14));
            head.setMinimumHeight(dp(c, 60));
            rowBackground(c, head);
            pressable(head);
            TextView t = mono(c, title, 14, INK);
            head.addView(t, new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1));
            chevron = text(c, "▾", 22, SIGNAL, MONO_BOLD);
            head.addView(chevron);
            addView(head);
            body = new LinearLayout(c);
            body.setOrientation(VERTICAL);
            body.setPadding(dp(c, 4), dp(c, 6), dp(c, 4), dp(c, 4));
            autoAnimate(body);
            addView(body);
            body.setVisibility(GONE);
            head.setOnClickListener(v -> setOpen(!open));
        }

        void setOpen(boolean o) {
            open = o;
            chevron.animate().rotation(o ? 180 : 0).setDuration(240).setInterpolator(EASE).start();
            if (o) {
                body.setVisibility(VISIBLE);
                body.setAlpha(0f);
                body.setTranslationY(-dp(getContext(), 8));
                body.animate().alpha(1f).translationY(0).setDuration(280).setInterpolator(EASE).start();
            } else {
                body.setVisibility(GONE);
            }
        }
    }

    /** Expanding rings where a pinch landed on the PC screen: proof the click registered. */
    static final class Ripples extends View {
        private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final java.util.ArrayList<float[]> rings = new java.util.ArrayList<>(); // x, y, start, kind

        Ripples(Context c) {
            super(c);
            p.setStyle(Paint.Style.STROKE);
        }

        /** kind 0 = click, 1 = right-click (double ring), 2 = drag/scroll start. */
        void add(float x, float y, int kind) {
            rings.add(new float[]{x, y, SystemClock.uptimeMillis(), kind});
            invalidate();
        }

        @Override
        protected void onDraw(Canvas c) {
            long now = SystemClock.uptimeMillis();
            float max = dp(getContext(), 34);
            for (int i = rings.size() - 1; i >= 0; i--) {
                float[] r = rings.get(i);
                float t = (now - r[2]) / 420f;
                if (t >= 1f) {
                    rings.remove(i);
                    continue;
                }
                float e = 1f - (1f - t) * (1f - t);
                p.setColor(SIGNAL);
                p.setAlpha((int) (255 * (1f - t)));
                p.setStrokeWidth(dp(getContext(), 3) * (1f - t) + 1);
                c.drawCircle(r[0], r[1], max * (0.25f + 0.75f * e), p);
                if (r[3] == 1) c.drawCircle(r[0], r[1], max * 0.55f * (0.25f + 0.75f * e), p);
                if (r[3] == 2) c.drawRect(r[0] - max * 0.3f * e, r[1] - max * 0.3f * e, r[0] + max * 0.3f * e, r[1] + max * 0.3f * e, p);
            }
            if (!rings.isEmpty()) postInvalidateOnAnimation();
        }
    }

    /** Camera viewfinder overlay: red corner brackets and a scan line sweeping up and down. */
    static final class Reticle extends View {
        private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);

        Reticle(Context c) {
            super(c);
        }

        @Override
        protected void onDraw(Canvas c) {
            float w = getWidth(), h = getHeight(), m = dp(getContext(), 14), L = dp(getContext(), 26);
            p.setColor(SIGNAL);
            p.setStrokeWidth(dp(getContext(), 3));
            p.setStyle(Paint.Style.STROKE);
            c.drawLine(m, m, m + L, m, p);
            c.drawLine(m, m, m, m + L, p);
            c.drawLine(w - m, m, w - m - L, m, p);
            c.drawLine(w - m, m, w - m, m + L, p);
            c.drawLine(m, h - m, m + L, h - m, p);
            c.drawLine(m, h - m, m, h - m - L, p);
            c.drawLine(w - m, h - m, w - m - L, h - m, p);
            c.drawLine(w - m, h - m, w - m, h - m - L, p);
            long t = SystemClock.uptimeMillis() % 2400;
            float phase = t < 1200 ? t / 1200f : 2 - t / 1200f;
            float y = m + (h - 2 * m) * (0.5f - 0.5f * (float) Math.cos(phase * Math.PI));
            p.setStrokeWidth(dp(getContext(), 2));
            p.setAlpha(170);
            c.drawLine(m + dp(getContext(), 6), y, w - m - dp(getContext(), 6), y, p);
            p.setAlpha(255);
            if (isShown()) postInvalidateOnAnimation();
        }
    }

    /** Simple line icons drawn in ink + signal red (no emoji, so they match the style). */
    static final class Glyph extends View {
        static final int MONITOR = 0, CAST = 1, QR = 2, PLUG = 3, CHECK = 4, ENSO = 5;
        private final int kind;
        private final int sizeDp;
        private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        private int tint;

        Glyph(Context c, int kind, int sizeDp) {
            super(c);
            this.kind = kind;
            this.sizeDp = sizeDp;
            p.setStrokeCap(Paint.Cap.SQUARE);
        }

        /** Draw the whole icon in one colour (e.g. white on a red stamp). */
        Glyph tinted(int color) {
            tint = color;
            return this;
        }

        @Override
        public void draw(Canvas c) {
            if (tint != 0) p.setColorFilter(new android.graphics.PorterDuffColorFilter(tint, android.graphics.PorterDuff.Mode.SRC_IN));
            super.draw(c);
        }

        @Override
        protected void onMeasure(int w, int h) {
            int s = dp(getContext(), sizeDp);
            setMeasuredDimension(s, s);
        }

        @Override
        protected void onDraw(Canvas c) {
            float u = getWidth() / 48f;
            p.setStyle(Paint.Style.STROKE);
            p.setStrokeWidth(3 * u);
            p.setColor(INK);
            switch (kind) {
                case MONITOR:
                    c.drawRect(5 * u, 8 * u, 43 * u, 33 * u, p);
                    c.drawLine(24 * u, 33 * u, 24 * u, 40 * u, p);
                    c.drawLine(15 * u, 41 * u, 33 * u, 41 * u, p);
                    p.setStyle(Paint.Style.FILL);
                    p.setColor(SIGNAL);
                    c.drawRect(11 * u, 14 * u, 22 * u, 21 * u, p);
                    break;
                case CAST:
                    c.drawRect(5 * u, 10 * u, 33 * u, 30 * u, p);
                    p.setColor(SIGNAL);
                    c.drawArc(new RectF(28 * u, 20 * u, 44 * u, 36 * u), 270, 90, false, p);
                    c.drawArc(new RectF(22 * u, 14 * u, 50 * u, 42 * u), 270, 90, false, p);
                    p.setStyle(Paint.Style.FILL);
                    c.drawCircle(36 * u, 38 * u, 3 * u, p);
                    break;
                case QR:
                    c.drawRect(6 * u, 6 * u, 20 * u, 20 * u, p);
                    c.drawRect(28 * u, 6 * u, 42 * u, 20 * u, p);
                    c.drawRect(6 * u, 28 * u, 20 * u, 42 * u, p);
                    p.setStyle(Paint.Style.FILL);
                    p.setColor(SIGNAL);
                    c.drawRect(29 * u, 29 * u, 35 * u, 35 * u, p);
                    c.drawRect(36 * u, 36 * u, 42 * u, 42 * u, p);
                    break;
                case PLUG:
                    c.drawRect(14 * u, 6 * u, 34 * u, 24 * u, p);
                    c.drawLine(20 * u, 24 * u, 20 * u, 30 * u, p);
                    c.drawLine(28 * u, 24 * u, 28 * u, 30 * u, p);
                    p.setColor(SIGNAL);
                    c.drawLine(24 * u, 30 * u, 24 * u, 44 * u, p);
                    break;
                case CHECK:
                    p.setColor(SIGNAL);
                    p.setStrokeWidth(4 * u);
                    c.drawLine(10 * u, 25 * u, 20 * u, 35 * u, p);
                    c.drawLine(20 * u, 35 * u, 39 * u, 14 * u, p);
                    break;
                case ENSO:
                    // UTSUSHI's mark: an open brush circle with a red seal
                    p.setStrokeCap(Paint.Cap.ROUND);
                    p.setStrokeWidth(4 * u);
                    c.drawArc(new RectF(6 * u, 6 * u, 40 * u, 40 * u), 235, 300, false, p);
                    p.setStrokeCap(Paint.Cap.SQUARE);
                    p.setStyle(Paint.Style.FILL);
                    p.setColor(SIGNAL);
                    c.drawRect(33 * u, 33 * u, 43 * u, 43 * u, p);
                    break;
            }
        }
    }

    /** Small status tag, e.g. "■ LINKED". Live = filled signal red. */
    static TextView tag(Context c) {
        TextView t = mono(c, "", 13, INK);
        t.setPadding(dp(c, 12), dp(c, 7), dp(c, 12), dp(c, 7));
        return t;
    }

    static void setTag(Context c, TextView t, String text, boolean live) {
        String key = text + "|" + live;
        if (key.equals(t.getTag())) return;
        t.setTag(key);
        t.setText("■ " + text);
        t.setTextColor(live ? ON_SIGNAL : INK);
        t.setBackground(live ? new Cut(SIGNAL, SIGNAL, 0, dp(c, 6)) : new Cut(0, INK, dp(c, 1.5f), dp(c, 6)));
    }
}
