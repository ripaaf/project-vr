package com.questmirror.app;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.util.Base64;
import android.view.Gravity;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * One PC monitor shown as its own floating Horizon OS window. Hands work like a touchpad
 * you point at: hovering moves the PC cursor, a pinch clicks, pinch-and-hold right-clicks,
 * and pinch-and-drag scrolls (or drags, after switching mode).
 */
public class ScreenActivity extends Activity implements SurfaceHolder.Callback, PcStream.Listener {
    static final String EXTRA_BASES = "bases", EXTRA_TOKEN = "token", EXTRA_ID = "id", EXTRA_NAME = "name";
    static final String EXTRA_FPS = "fps", EXTRA_KBPS = "kbps", EXTRA_MAXW = "maxw", EXTRA_INDEX = "index";

    private static final long LONG_PRESS_MS = 600;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private String[] bases;
    private String token, monId, monName;
    private boolean refused;
    private int fps, kbps, maxW;

    private int index;
    private AspectLayout aspect;
    private SurfaceView surface;
    private LinearLayout overlay;
    private TextView overlayText, statusText;
    private Ui.Ring overlayRing;
    private LinearLayout hint;
    private Ui.Ripples ripples;
    private boolean everConnected;
    private Button modeBtn, rightBtn, kbBtn, soundBtn;
    private final PcAudio.Listener audioListener = (muted, playing) -> updateSoundLabel();
    private LinearLayout keyboardBar;
    private EditText typeField;

    private PcStream stream;
    private InputSender input;

    private boolean dragMode = false;   // false: pinch-drag scrolls, true: pinch-drag drags
    private boolean rightNext = false;  // next pinch is a right click
    private String lastTyped = "";
    private boolean ignoreTextChange;

    // touch gesture state
    private float downX, downY, lastY, lastX;
    private boolean moved, dragging, longFired;
    private float scrollAccY, scrollAccX;
    private long lastMoveSent;
    private final Runnable longPress = () -> {
        if (!moved && !dragging) {
            longFired = true;
            click("r");
            ripples.add(downX, downY, 1);
            surface.performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS);
        }
    };

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Ui.loadTheme(this);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        index = getIntent().getIntExtra(EXTRA_INDEX, 0);
        bases = getIntent().getStringArrayExtra(EXTRA_BASES);
        if (bases == null || bases.length == 0) bases = new String[]{HostClient.LOCAL};
        token = getIntent().getStringExtra(EXTRA_TOKEN);
        monId = getIntent().getStringExtra(EXTRA_ID);
        monName = getIntent().getStringExtra(EXTRA_NAME);
        fps = getIntent().getIntExtra(EXTRA_FPS, 60);
        kbps = getIntent().getIntExtra(EXTRA_KBPS, 12000);
        maxW = getIntent().getIntExtra(EXTRA_MAXW, 1920);
        setTaskDescription(new ActivityManager.TaskDescription(monName == null ? "PC screen" : monName));
        buildUi();
        input = new InputSender(bases, token);
    }

    // ------------------------------------------------------------------ UI

    private void buildUi() {
        Context c = this;
        LinearLayout root = new LinearLayout(c);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xFF000000);

        LinearLayout bar = Ui.row(c);
        bar.setBackgroundColor(Ui.BG);
        bar.setPadding(Ui.dp(c, 18), Ui.dp(c, 8), Ui.dp(c, 10), Ui.dp(c, 8));
        LinearLayout titles = new LinearLayout(c);
        titles.setOrientation(LinearLayout.VERTICAL);
        titles.addView(Ui.mono(c, String.format(Locale.US, "SCR-%02d // PC FEED", index + 1), 11, Ui.SIGNAL));
        TextView title = Ui.text(c, (monName == null ? "PC screen" : monName).toUpperCase(), 20, Ui.INK, Ui.DISPLAY);
        titles.addView(title);
        bar.addView(titles);
        statusText = Ui.mono(c, "", 13, Ui.INK3);
        statusText.setPadding(Ui.dp(c, 18), 0, 0, 0);
        bar.addView(statusText, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        kbBtn = toolButton("⌨ Keys", v -> toggleKeyboard());
        modeBtn = toolButton("", v -> {
            dragMode = !dragMode;
            updateModeLabel();
        });
        rightBtn = toolButton("◩ R-Click", v -> {
            rightNext = !rightNext;
            rightBtn.setSelected(rightNext);
        });
        Button close = toolButton("✕", v -> finishAndRemoveTask());
        soundBtn = toolButton("", v -> PcAudio.get(this).setMuted(!PcAudio.get(this).muted()));
        bar.addView(soundBtn);
        bar.addView(kbBtn);
        bar.addView(modeBtn);
        bar.addView(rightBtn);
        bar.addView(close);
        updateModeLabel();
        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        View rule = new View(c);
        rule.setBackgroundColor(Ui.INK);
        root.addView(rule, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(c, 2)));

        FrameLayout stage = new FrameLayout(c);
        aspect = new AspectLayout(c);
        surface = new SurfaceView(c);
        surface.getHolder().addCallback(this);
        aspect.addView(surface, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        ripples = new Ui.Ripples(c); // shows where each pinch landed (touch passes through)
        aspect.addView(ripples, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        stage.addView(aspect, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.CENTER));
        overlay = Ui.row(c);
        overlay.setPadding(Ui.dp(c, 26), Ui.dp(c, 20), Ui.dp(c, 30), Ui.dp(c, 20));
        overlay.setBackground(new Ui.Cut(Ui.BG2, Ui.INK, Ui.dp(c, 2), Ui.dp(c, 18)));
        overlayRing = new Ui.Ring(c);
        overlay.addView(overlayRing);
        LinearLayout ot = new LinearLayout(c);
        ot.setOrientation(LinearLayout.VERTICAL);
        ot.setPadding(Ui.dp(c, 20), 0, 0, 0);
        ot.addView(Ui.mono(c, "FEED // LINKING", 12, Ui.SIGNAL));
        overlayText = Ui.text(c, "Connecting to your PC…", 22, Ui.INK, Ui.DISPLAY);
        ot.addView(overlayText);
        overlay.addView(ot);
        stage.addView(overlay, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));

        // First-time hint: how hands drive the PC. Shown once, fades away on its own.
        hint = Ui.row(c);
        hint.setPadding(Ui.dp(c, 22), Ui.dp(c, 14), Ui.dp(c, 12), Ui.dp(c, 14));
        hint.setBackground(new Ui.Cut(Ui.BG2, Ui.SIGNAL, Ui.dp(c, 2), Ui.dp(c, 14)));
        TextView ht = Ui.mono(c, "✋ POINT = MOUSE   ·   PINCH = CLICK   ·   HOLD = RIGHT-CLICK   ·   DRAG = SCROLL", 14, Ui.INK);
        hint.addView(ht);
        Button gotIt = Ui.button(c, "Got it", true);
        gotIt.setOnClickListener(v -> dismissHint());
        LinearLayout.LayoutParams gp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        gp.leftMargin = Ui.dp(c, 16);
        hint.addView(gotIt, gp);
        FrameLayout.LayoutParams hp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        hp.bottomMargin = Ui.dp(c, 24);
        stage.addView(hint, hp);
        hint.setVisibility(View.GONE);
        root.addView(stage, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        keyboardBar = buildKeyboardBar();
        keyboardBar.setVisibility(View.GONE);
        root.addView(keyboardBar);

        surface.setOnTouchListener(this::onSurfaceTouch);
        surface.setOnHoverListener((v, e) -> {
            if (e.getActionMasked() == MotionEvent.ACTION_HOVER_MOVE || e.getActionMasked() == MotionEvent.ACTION_HOVER_ENTER) {
                sendMove(e.getX(), e.getY(), false);
            }
            return true;
        });
        surface.setOnGenericMotionListener((v, e) -> {
            if (e.getActionMasked() == MotionEvent.ACTION_SCROLL) {
                float vs = e.getAxisValue(MotionEvent.AXIS_VSCROLL);
                float hs = e.getAxisValue(MotionEvent.AXIS_HSCROLL);
                if (vs != 0) input.send(String.format(Locale.US, "w %.2f", vs));
                if (hs != 0) input.send(String.format(Locale.US, "h %.2f", hs));
                return true;
            }
            return false;
        });
        setContentView(root);
    }

    private Button toolButton(String label, View.OnClickListener l) {
        Button b = Ui.button(this, label, false);
        b.setTextSize(14);
        b.setMinHeight(Ui.dp(this, 54));
        b.setMinimumHeight(Ui.dp(this, 54));
        b.setPadding(Ui.dp(this, 14), Ui.dp(this, 6), Ui.dp(this, 14), Ui.dp(this, 6));
        b.setOnClickListener(l);
        Ui.pressable(b);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.leftMargin = Ui.dp(this, 6);
        b.setLayoutParams(p);
        return b;
    }

    private void maybeShowHint() {
        if (getSharedPreferences("questmirror", MODE_PRIVATE).getBoolean("gestureHintSeen", false)) return;
        hint.setVisibility(View.VISIBLE);
        Ui.fadeUp(hint, 300);
        ui.postDelayed(this::dismissHint, 9000);
    }

    private void dismissHint() {
        getSharedPreferences("questmirror", MODE_PRIVATE).edit().putBoolean("gestureHintSeen", true).apply();
        if (hint.getVisibility() != View.VISIBLE) return;
        hint.animate().alpha(0f).translationY(Ui.dp(this, 20)).setDuration(300).withEndAction(() -> hint.setVisibility(View.GONE)).start();
    }

    private void updateSoundLabel() {
        PcAudio a = PcAudio.get(this);
        soundBtn.setText(a.muted() ? "♪ Muted" : a.playing() ? "♪ Sound" : "♪ …");
        soundBtn.setSelected(!a.muted());
    }

    private void updateModeLabel() {
        modeBtn.setText(dragMode ? "✥ Drag" : "↕ Scroll");
    }

    private LinearLayout buildKeyboardBar() {
        Context c = this;
        LinearLayout box = new LinearLayout(c);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setBackgroundColor(Ui.BG);
        box.setPadding(Ui.dp(c, 14), Ui.dp(c, 12), Ui.dp(c, 14), Ui.dp(c, 12));

        LinearLayout r1 = Ui.row(c);
        typeField = new EditText(c);
        typeField.setHint("TYPE HERE — LETTERS GO STRAIGHT TO THE PC");
        typeField.setTextColor(Ui.INK);
        typeField.setHintTextColor(Ui.INK3);
        typeField.setTypeface(Ui.MONO_BOLD);
        typeField.setTextSize(20);
        typeField.setSingleLine(true);
        typeField.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD);
        typeField.setImeOptions(EditorInfo.IME_ACTION_SEND | EditorInfo.IME_FLAG_NO_EXTRACT_UI);
        typeField.setBackground(new Ui.Cut(Ui.BG3, Ui.INK, Ui.dp(c, 1.5f), Ui.dp(c, 10)));
        typeField.setMinHeight(Ui.dp(c, 56));
        typeField.setPadding(Ui.dp(c, 14), Ui.dp(c, 12), Ui.dp(c, 14), Ui.dp(c, 12));
        typeField.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int a, int b, int d) {
            }

            public void onTextChanged(CharSequence s, int a, int b, int d) {
            }

            public void afterTextChanged(Editable s) {
                if (!ignoreTextChange) sendTypingDiff(s.toString());
            }
        });
        typeField.setOnEditorActionListener((v, actionId, ev) -> {
            tapKey(0x0D);
            resetTypeField();
            return true;
        });
        // Backspace on an empty field still deletes on the PC.
        typeField.setOnKeyListener((v, code, ev) -> {
            if (code == KeyEvent.KEYCODE_DEL && ev.getAction() == KeyEvent.ACTION_DOWN && typeField.length() == 0) {
                tapKey(0x08);
                return true;
            }
            return false;
        });
        r1.addView(typeField, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        r1.addView(toolButton("Enter ⏎", v -> {
            tapKey(0x0D);
            resetTypeField();
        }));
        r1.addView(toolButton("⌫", v -> tapKey(0x08)));
        box.addView(r1);

        LinearLayout r2 = Ui.row(c);
        r2.setPadding(0, Ui.dp(c, 6), 0, 0);
        r2.addView(toolButton("Tab", v -> tapKey(0x09)));
        r2.addView(toolButton("Esc", v -> tapKey(0x1B)));
        r2.addView(toolButton("←", v -> tapKey(0x25)));
        r2.addView(toolButton("↑", v -> tapKey(0x26)));
        r2.addView(toolButton("↓", v -> tapKey(0x28)));
        r2.addView(toolButton("→", v -> tapKey(0x27)));
        r2.addView(toolButton("⊞ Win", v -> tapKey(0x5B)));
        r2.addView(toolButton("Ctrl+C", v -> combo(0xA2, 0x43)));
        r2.addView(toolButton("Ctrl+V", v -> combo(0xA2, 0x56)));
        r2.addView(toolButton("Ctrl+Z", v -> combo(0xA2, 0x5A)));
        r2.addView(toolButton("Alt+Tab", v -> combo(0xA4, 0x09)));
        HorizontalScrollView hs = new HorizontalScrollView(c);
        hs.addView(r2);
        box.addView(hs);
        return box;
    }

    private void toggleKeyboard() {
        boolean show = keyboardBar.getVisibility() != View.VISIBLE;
        Ui.show(keyboardBar, show);
        kbBtn.setSelected(show);
        InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        if (show) {
            resetTypeField();
            typeField.requestFocus();
            imm.showSoftInput(typeField, InputMethodManager.SHOW_IMPLICIT);
        } else {
            imm.hideSoftInputFromWindow(typeField.getWindowToken(), 0);
        }
    }

    private void resetTypeField() {
        ignoreTextChange = true;
        typeField.setText("");
        ignoreTextChange = false;
        lastTyped = "";
    }

    /** Mirrors edits in the text box onto the PC: new characters are typed, removed ones backspaced. */
    private void sendTypingDiff(String now) {
        int common = 0;
        int max = Math.min(now.length(), lastTyped.length());
        while (common < max && now.charAt(common) == lastTyped.charAt(common)) common++;
        for (int i = common; i < lastTyped.length(); i++) tapKey(0x08);
        String added = now.substring(common);
        if (!added.isEmpty()) {
            input.send("t " + Base64.encodeToString(added.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP));
        }
        lastTyped = now;
        if (now.length() > 60) resetTypeField();
    }

    private void tapKey(int vk) {
        input.send("k " + vk + " 1");
        input.send("k " + vk + " 0");
    }

    private void combo(int mod, int vk) {
        input.send("k " + mod + " 1");
        tapKey(vk);
        input.send("k " + mod + " 0");
    }

    // ------------------------------------------------------------------ pointer input

    private void sendMove(float x, float y, boolean force) {
        long now = System.currentTimeMillis();
        if (!force && now - lastMoveSent < 12) return;
        lastMoveSent = now;
        float fx = x / Math.max(1, surface.getWidth());
        float fy = y / Math.max(1, surface.getHeight());
        input.move(String.format(Locale.US, "m %s %.4f %.4f", monId, fx, fy));
    }

    private void click(String button) {
        input.send("d " + button);
        input.send("u " + button);
    }

    private boolean onSurfaceTouch(View v, MotionEvent e) {
        float slop = Ui.dp(this, 14);
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                downX = lastX = e.getX();
                downY = lastY = e.getY();
                moved = dragging = longFired = false;
                scrollAccX = scrollAccY = 0;
                sendMove(e.getX(), e.getY(), true);
                if (!rightNext) ui.postDelayed(longPress, LONG_PRESS_MS);
                return true;
            case MotionEvent.ACTION_MOVE: {
                if (!moved && Math.hypot(e.getX() - downX, e.getY() - downY) > slop) {
                    moved = true;
                    ui.removeCallbacks(longPress);
                    if (dragMode && !longFired) {
                        dragging = true;
                        input.send("d l");
                        ripples.add(downX, downY, 2);
                    }
                }
                if (moved && dragging) {
                    sendMove(e.getX(), e.getY(), false);
                } else if (moved && !longFired) {
                    // Natural scrolling: moving the content up scrolls down, like a phone.
                    float notch = Ui.dp(this, 36);
                    scrollAccY += (e.getY() - lastY) / notch;
                    scrollAccX += (lastX - e.getX()) / notch;
                    if (Math.abs(scrollAccY) >= 0.25f) {
                        input.send(String.format(Locale.US, "w %.2f", scrollAccY));
                        scrollAccY = 0;
                    }
                    if (Math.abs(scrollAccX) >= 0.25f) {
                        input.send(String.format(Locale.US, "h %.2f", scrollAccX));
                        scrollAccX = 0;
                    }
                }
                lastX = e.getX();
                lastY = e.getY();
                return true;
            }
            case MotionEvent.ACTION_UP:
                ui.removeCallbacks(longPress);
                if (dragging) {
                    sendMove(e.getX(), e.getY(), true);
                    input.send("u l");
                } else if (!moved && !longFired) {
                    click(rightNext ? "r" : "l");
                    ripples.add(e.getX(), e.getY(), rightNext ? 1 : 0);
                    if (rightNext) {
                        rightNext = false;
                        Ui.setPrimary(this, rightBtn, false);
                    }
                }
                dragging = false;
                return true;
            case MotionEvent.ACTION_CANCEL:
                ui.removeCallbacks(longPress);
                if (dragging) input.send("u l");
                dragging = false;
                return true;
        }
        return true;
    }

    /** A Bluetooth keyboard paired with the Quest types on the PC while this window is focused. */
    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        boolean typing = keyboardBar.getVisibility() == View.VISIBLE && typeField.hasFocus();
        boolean fromKeyboard = e.getDevice() != null && (e.getSource() & InputDevice.SOURCE_KEYBOARD) == InputDevice.SOURCE_KEYBOARD
                && e.getDevice().getKeyboardType() == InputDevice.KEYBOARD_TYPE_ALPHABETIC;
        int vk = KeyMap.toVk(e.getKeyCode());
        if (!typing && fromKeyboard && vk != 0 && (e.getAction() == KeyEvent.ACTION_DOWN || e.getAction() == KeyEvent.ACTION_UP)) {
            if (e.getRepeatCount() == 0 || e.getAction() == KeyEvent.ACTION_DOWN) {
                input.send("k " + vk + (e.getAction() == KeyEvent.ACTION_DOWN ? " 1" : " 0"));
            }
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    // ------------------------------------------------------------------ stream lifecycle

    @Override
    public void surfaceCreated(SurfaceHolder holder) {
        if (refused) return;
        String path = "/api/pc/stream?id=" + monId + "&fps=" + fps + "&kbps=" + kbps + "&maxw=" + maxW;
        stream = new PcStream(bases, path, token, holder.getSurface(), this);
        stream.start();
        ui.post(statsTick);
        holdAudio(true);
        updateSoundLabel();
    }

    private boolean audioHeld;

    /** Each screen window holds the shared PC sound while it's alive (once, never twice). */
    private void holdAudio(boolean hold) {
        if (hold == audioHeld) return;
        audioHeld = hold;
        PcAudio audio = PcAudio.get(this);
        if (hold) {
            audio.addListener(audioListener);
            audio.acquire(bases, token);
        } else {
            audio.removeListener(audioListener);
            audio.release();
        }
    }

    @Override
    public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {
    }

    @Override
    public void surfaceDestroyed(SurfaceHolder holder) {
        ui.removeCallbacks(statsTick);
        if (stream != null) stream.stop();
        stream = null;
        holdAudio(false);
    }

    /** The PC revoked our access (unlinked) or turned sharing off: say so clearly, stop everything. */
    @Override
    public void onFatal(String message) {
        ui.post(() -> {
            refused = true;
            holdAudio(false);
            if (input != null) input.close();
            overlay.animate().cancel();
            overlay.setAlpha(1f);
            overlay.setVisibility(View.VISIBLE);
            overlayRing.setBusy(false);
            overlayText.setText("Unlinked from the PC.\nLink again in the Quest Mirror app.");
            statusText.setText("■ " + (message == null ? "REFUSED" : message.toUpperCase()));
            statusText.setTextColor(Ui.SIGNAL);
            Ui.fadeUp(overlay, 0);
            ui.postDelayed(this::finishAndRemoveTask, 6000);
        });
    }

    private final Runnable statsTick = new Runnable() {
        @Override
        public void run() {
            PcStream s = stream;
            if (s != null && overlay.getVisibility() != View.VISIBLE) {
                statusText.setText("■ LIVE // " + s.fps() + " FPS");
                statusText.setTextColor(Ui.SIGNAL);
            }
            ui.postDelayed(this, 1000);
        }
    };

    @Override
    public void onState(String message, boolean connected) {
        ui.post(() -> {
            if (connected && overlay.getVisibility() == View.VISIBLE) {
                // Picture arrived: fade the "linking" card away instead of cutting it.
                overlay.animate().alpha(0f).scaleX(0.96f).scaleY(0.96f).setDuration(260).withEndAction(() -> {
                    overlay.setVisibility(View.GONE);
                    overlay.setAlpha(1f);
                    overlay.setScaleX(1f);
                    overlay.setScaleY(1f);
                }).start();
                if (!everConnected) {
                    everConnected = true;
                    maybeShowHint();
                }
            } else if (!connected && overlay.getVisibility() != View.VISIBLE) {
                overlay.setVisibility(View.VISIBLE);
                Ui.fadeUp(overlay, 0);
            }
            if (message != null) overlayText.setText(message);
            overlayRing.setBusy(!connected);
            if (!connected) {
                statusText.setText("■ LINKING…");
                statusText.setTextColor(Ui.INK3);
            }
        });
    }

    @Override
    public void onVideoSize(int width, int height) {
        ui.post(() -> aspect.setAspect(width, height));
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (stream != null) stream.stop();
        holdAudio(false);
        if (input != null) input.close();
    }

    /** Keeps the video at its real aspect ratio inside whatever size the user drags the window to. */
    static final class AspectLayout extends FrameLayout {
        private float aspect = 16f / 9f;

        AspectLayout(Context c) {
            super(c);
        }

        void setAspect(int w, int h) {
            if (w > 0 && h > 0) {
                aspect = (float) w / h;
                requestLayout();
            }
        }

        @Override
        protected void onMeasure(int wSpec, int hSpec) {
            int w = MeasureSpec.getSize(wSpec), h = MeasureSpec.getSize(hSpec);
            if (w / (float) h > aspect) w = Math.round(h * aspect);
            else h = Math.round(w / aspect);
            super.onMeasure(MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY));
        }
    }
}
