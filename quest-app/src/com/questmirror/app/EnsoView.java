package com.questmirror.app;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.os.SystemClock;
import android.view.View;

/**
 * The ensō that greets you on the home screen: one brush stroke painting itself round (thick where
 * the brush lands, thinning as it lifts, never quite closing), then the red seal 映 is pressed.
 * The same mark the space draws, so the app and the space feel like one place.
 */
final class EnsoView extends View {
    private final Paint ink = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint seal = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint sealText = new Paint(Paint.ANTI_ALIAS_FLAG);
    private long t0 = SystemClock.uptimeMillis();
    private static final long PAINT_MS = 1600;

    EnsoView(Context c) {
        super(c);
        ink.setStyle(Paint.Style.FILL);
        seal.setStyle(Paint.Style.FILL);
        sealText.setTextAlign(Paint.Align.CENTER);
        sealText.setTypeface(Typeface.create(Typeface.SERIF, Typeface.BOLD));
    }

    /** Paint it again (when the home screen comes back). */
    void restart() {
        t0 = SystemClock.uptimeMillis();
        invalidate();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        float w = getWidth();
        float h = getHeight();
        float cx = w / 2f;
        float cy = h / 2f;
        float r = Math.min(w, h) * 0.38f;
        float brush = Math.min(w, h) * 0.06f;
        float k = Math.min(1f, (SystemClock.uptimeMillis() - t0) / (float) PAINT_MS);
        float eased = 1f - (float) Math.pow(1f - k, 3);
        ink.setColor(Ui.INK);
        // the stroke: many overlapping dabs along an almost-closed circle, each a little different
        int n = 220;
        int shown = (int) (n * eased);
        double start = Math.toRadians(-100);
        double sweep = Math.toRadians(318);
        for (int i = 0; i < shown; i++) {
            float u = i / (float) n;
            double a = start + sweep * u;
            float wobble = 1f + 0.018f * (float) Math.sin(i * 0.37) + 0.01f * (float) Math.sin(i * 1.7);
            float x = cx + (float) Math.cos(a) * r * wobble;
            float y = cy + (float) Math.sin(a) * r * wobble;
            // heavy where the brush lands, thinning (and drying out) as it lifts
            float press = u < 0.08f ? 0.6f + u * 5f : 1f - Math.max(0f, u - 0.55f) * 1.6f;
            float dab = brush * Math.max(0.18f, press) * (0.9f + 0.1f * (float) Math.sin(i * 2.3));
            ink.setAlpha(u > 0.85f && (i % 3 == 0) ? 120 : 235);
            canvas.drawCircle(x, y, dab, ink);
        }
        // the seal, pressed once the stroke is done
        if (k >= 1f) {
            float s = Math.min(w, h) * 0.16f;
            float sx = cx + r * 0.62f;
            float sy = cy + r * 0.62f;
            seal.setColor(Ui.SIGNAL);
            canvas.drawRect(sx - s / 2, sy - s / 2, sx + s / 2, sy + s / 2, seal);
            sealText.setColor(0xFFFFFFFF);
            sealText.setTextSize(s * 0.62f);
            canvas.drawText("映", sx, sy + s * 0.22f, sealText);
        } else postInvalidateOnAnimation();
    }
}
