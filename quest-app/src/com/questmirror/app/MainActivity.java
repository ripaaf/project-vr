package com.questmirror.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Home panel, in a fixed order: (1) link with the PC — just look at its screen — then (2) choose
 * "show my PC here" or "share what I see". Every setting lives on one Settings page.
 */
public class MainActivity extends Activity {
    private static final int LINK = 0, HOME = 1, PC = 2, SHARE = 3, SETTINGS = 4;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private HostClient host;
    private SharedPreferences prefs;
    private JSONObject status;
    private JSONArray monitors = new JSONArray();
    private long monitorsAt;
    private boolean visible;
    private String pendingOpen;
    private int page = LINK;
    private int settingsFrom = HOME;
    private final View[] pages = new View[5];
    private final View[][] entrance = new View[5][];

    // header
    private TextView headerTag;
    private Button settingsBtn;

    // link page
    private TextView linkStatus;

    // home
    private TextView homeKicker;

    // home tiles
    private TextView tileAStatus, tileBStatus;
    private View tileADot, tileBDot;

    // PC page
    private TextView pcState, scanState;
    private android.view.TextureView camView;
    private Button scanBtn;
    private CameraScanner scanner;
    private long lastHintAt;
    private LinearLayout connectBox, nearbyList, scanRow, waitBox, screensBox, screenList;
    private Button openAllBtn;
    private TextView waitTitle, waitCode;
    private EditText codeField, addressField;
    private Ui.SwitchRow soundRow;

    // Share page
    private TextView shareState, shareUrl, watchersText;
    private View watchersDot;
    private LinearLayout setupBox, liveBox, findPcBox;
    private final TextView[] stepText = new TextView[3];
    private final View[] stepMark = new View[3];
    private Button pauseBtn;

    // Settings page
    private TextView panelState, linkState, linkedInfo, shareSettingsNote;
    private LinearLayout shareSettings;
    private Button panelBtn, wifiBtn, unlinkBtn;
    private Ui.SwitchRow controlRow, awakeRow, lensRow;
    private final Map<String, LinearLayout> segments = new HashMap<>();

    // one-tap pairing in progress
    private String pairBase, pairId, pairName;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Ui.loadTheme(this);
        host = HostClient.get(this);
        prefs = getSharedPreferences("questmirror", MODE_PRIVATE);
        Agent.ensureStarted(this);
        host.startDiscovery();
        setContentView(buildUi());
        page = b != null ? b.getInt("page", -1) : -1;
        if (page < 0) page = host.token() != null ? HOME : LINK;
        settingsFrom = b != null ? b.getInt("from", HOME) : HOME;
        for (int i = 0; i < pages.length; i++) Ui.show(pages[i], i == page);
        settingsBtn.setSelected(page == SETTINGS);
        playEntrance(page);
        pendingOpen = getIntent().getStringExtra("open");
        if (pendingOpen != null && host.token() != null) showPage(PC);
        if (getIntent().getData() != null) linkFromText(getIntent().getDataString());
        if (b == null && getIntent().getStringExtra("page") != null) goTo(getIntent().getStringExtra("page"));
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putInt("page", page);
        out.putInt("from", settingsFrom);
    }

    /** `am start ... --es open all` (or a screen id) opens screens as soon as they're known. */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String o = intent.getStringExtra("open");
        if (o != null) {
            pendingOpen = o;
            if (host.token() != null) showPage(PC);
            refreshNow();
        }
        if (intent.getData() != null) linkFromText(intent.getDataString());
        if (intent.getStringExtra("page") != null) goTo(intent.getStringExtra("page"));
    }

    /** The open panel, so the PC can grab a picture of it (headset captures can come out black). */
    private static java.lang.ref.WeakReference<MainActivity> live;

    /** PNG of this panel as drawn right now, or null when it isn't open. */
    static byte[] snapshot(boolean wholePage) {
        MainActivity a = live == null ? null : live.get();
        if (a == null) return null;
        final byte[][] out = new byte[1][];
        final java.util.concurrent.CountDownLatch done = new java.util.concurrent.CountDownLatch(1);
        a.ui.post(() -> {
            try {
                // The panel as seen, or the current page's whole scrolling content.
                View v = wholePage ? ((ViewGroup) a.pages[a.page]).getChildAt(0) : a.getWindow().getDecorView();
                android.graphics.Bitmap bmp = android.graphics.Bitmap.createBitmap(Math.max(1, v.getWidth()), Math.max(1, v.getHeight()), android.graphics.Bitmap.Config.ARGB_8888);
                android.graphics.Canvas cv = new android.graphics.Canvas(bmp);
                cv.drawColor(Ui.BG);
                v.draw(cv);
                java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
                bmp.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, bo);
                bmp.recycle();
                out[0] = bo.toByteArray();
            } catch (Exception ignored) {
            }
            done.countDown();
        });
        try {
            done.await(3, java.util.concurrent.TimeUnit.SECONDS);
        } catch (InterruptedException ignored) {
        }
        return out[0];
    }

    /** `am start ... --es page settings` jumps to a page (link, home, pc, share, settings). */
    private void goTo(String name) {
        int target = java.util.Arrays.asList("link", "home", "pc", "share", "settings").indexOf(name);
        if (target < 0) return;
        if (target == SETTINGS && page != SETTINGS) settingsFrom = page;
        showPage(target);
    }

    @Override
    protected void onResume() {
        super.onResume();
        live = new java.lang.ref.WeakReference<>(this);
        visible = true;
        refreshNow();
        if (page == LINK) startScanning(false);
    }

    @Override
    protected void onPause() {
        super.onPause();
        visible = false;
        ui.removeCallbacks(poll);
        ui.removeCallbacks(pairTick);
        stopScanning();
    }

    @Override
    public void onBackPressed() {
        if (page == SETTINGS) showPage(settingsFrom);
        else if (page == PC || page == SHARE) showPage(HOME);
        else super.onBackPressed();
    }

    private void toggleSettings() {
        if (page == SETTINGS) showPage(settingsFrom);
        else {
            settingsFrom = page;
            showPage(SETTINGS);
        }
    }

    // ------------------------------------------------------------------ navigation

    private void showPage(int target) {
        if (target == page) return;
        final View out = pages[page], in = pages[target];
        float dir = target > page ? 1 : -1;
        float d = Ui.dp(this, 48);
        out.animate().alpha(0f).translationX(-dir * d).setDuration(200).setInterpolator(Ui.EASE).withEndAction(() -> {
            out.setVisibility(View.GONE);
            out.setTranslationX(0);
            out.setAlpha(1f);
        }).start();
        in.setVisibility(View.VISIBLE);
        in.setAlpha(0f);
        in.setTranslationX(dir * d);
        in.animate().alpha(1f).translationX(0).setStartDelay(90).setDuration(320).setInterpolator(Ui.EASE).start();
        page = target;
        settingsBtn.setSelected(target == SETTINGS);
        playEntrance(target);
        if (target == LINK) startScanning(false);
        else stopScanning();
        render();
    }

    private void playEntrance(int p) {
        View[] views = entrance[p];
        if (views == null) return;
        for (int i = 0; i < views.length; i++) if (views[i] != null) Ui.fadeUp(views[i], 120 + i * 80L);
    }

    // ------------------------------------------------------------------ layout

    private View buildUi() {
        Context c = this;
        LinearLayout root = new LinearLayout(c);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackground(Ui.gridBackground(c));
        root.setPadding(Ui.dp(c, 34), Ui.dp(c, 22), Ui.dp(c, 34), Ui.dp(c, 16));

        LinearLayout header = Ui.row(c);
        header.addView(new Ui.Logo(c));
        TextView word = Ui.text(c, Ui.wordmark(), 28, Ui.INK, Ui.DISPLAY);
        word.setLetterSpacing(0.12f);
        word.setPadding(Ui.dp(c, 14), 0, 0, 0);
        header.addView(word, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        headerTag = Ui.tag(c);
        Ui.setTag(c, headerTag, "NOT LINKED", false);
        header.addView(headerTag);
        // The one way to every setting, always in the same corner.
        settingsBtn = Ui.button(c, "⚙  Settings", false);
        settingsBtn.setOnClickListener(v -> toggleSettings());
        Ui.pressable(settingsBtn);
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, Ui.dp(c, 64));
        tp.leftMargin = Ui.dp(c, 14);
        header.addView(settingsBtn, tp);
        root.addView(header);

        FrameLayout stack = new FrameLayout(c);
        pages[LINK] = scroll(buildLinkPage());
        pages[HOME] = scroll(buildHome());
        pages[PC] = scroll(buildPcPage());
        pages[SHARE] = scroll(buildSharePage());
        pages[SETTINGS] = scroll(buildSettingsPage());
        for (View p : pages) stack.addView(p, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1);
        sp.topMargin = Ui.dp(c, 14);
        root.addView(stack, sp);

        // "LINKED ✓" stamp that celebrates a successful link, on top of everything.
        FrameLayout frame = new FrameLayout(c);
        frame.addView(root);
        stamp = new LinearLayout(c);
        stamp.setOrientation(LinearLayout.VERTICAL);
        stamp.setGravity(Gravity.CENTER);
        stamp.setPadding(Ui.dp(c, 48), Ui.dp(c, 34), Ui.dp(c, 48), Ui.dp(c, 34));
        stamp.setBackground(new Ui.Cut(Ui.SIGNAL, Ui.SIGNAL, 0, Ui.dp(c, 24)));
        Ui.Glyph check = new Ui.Glyph(c, Ui.Glyph.CHECK, 120).tinted(Ui.ON_SIGNAL);
        stamp.addView(check);
        stampText = Ui.text(c, "LINKED", 40, Ui.ON_SIGNAL, Ui.DISPLAY);
        stampText.setLetterSpacing(0.12f);
        stamp.addView(stampText);
        frame.addView(stamp, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        stamp.setVisibility(View.GONE);
        return frame;
    }

    private LinearLayout stamp;
    private TextView stampText;

    /** Big red stamp that thuds in, holds, and fades: "LINKED ✓ WITH KANI". */
    private void celebrate(String text) {
        stampText.setText(text);
        stamp.setVisibility(View.VISIBLE);
        stamp.setAlpha(0f);
        stamp.setScaleX(1.8f);
        stamp.setScaleY(1.8f);
        stamp.setRotation(-8f);
        stamp.animate().alpha(1f).scaleX(1f).scaleY(1f).rotation(-3f).setDuration(420)
                .setInterpolator(new android.view.animation.OvershootInterpolator(1.6f))
                .withEndAction(() -> stamp.animate().alpha(0f).scaleX(0.94f).scaleY(0.94f).setStartDelay(1300).setDuration(380)
                        .withEndAction(() -> stamp.setVisibility(View.GONE)).start())
                .start();
    }

    private View scroll(View content) {
        ScrollView sv = new ScrollView(this);
        sv.setVerticalScrollBarEnabled(false);
        sv.setFillViewport(true);
        sv.addView(content);
        return sv;
    }

    private TextView title(String s, float sp) {
        TextView t = Ui.text(this, s.toUpperCase(), sp, Ui.INK, Ui.DISPLAY);
        t.setLetterSpacing(0.03f);
        return t;
    }

    private TextView body(String s) {
        return Ui.text(this, s, 18, Ui.INK2, Ui.UI);
    }

    private View dot() {
        View v = new View(this);
        v.setBackgroundColor(Ui.INK3);
        v.setLayoutParams(new LinearLayout.LayoutParams(Ui.dp(this, 12), Ui.dp(this, 12)));
        return v;
    }

    private void setDot(View dot, boolean live) {
        dot.setBackgroundColor(live ? Ui.SIGNAL : Ui.INK3);
        Object anim = dot.getTag();
        if (live && anim == null) Ui.pulse(dot);
        if (!live && anim instanceof android.animation.Animator) {
            ((android.animation.Animator) anim).cancel();
            dot.setTag(null);
            dot.setAlpha(1f);
        }
    }

    // ---------------- home: one question, two big answers

    private View buildHome() {
        Context c = this;
        LinearLayout col = new LinearLayout(c);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_VERTICAL);
        col.setPadding(0, Ui.dp(c, 8), 0, Ui.dp(c, 8));

        TextView kicker = homeKicker = Ui.mono(c, "■ STEP 2 OF 2 // LINKED", 13, Ui.SIGNAL);
        TextView hero = title("What do you want to do?", 40);
        TextView sub = body("Pick one. You can switch any time — just come back here.");
        col.addView(kicker);
        col.addView(hero);
        col.addView(sub);

        boolean wide = getResources().getConfiguration().screenWidthDp >= 820;
        LinearLayout tiles = new LinearLayout(c);
        tiles.setOrientation(wide ? LinearLayout.HORIZONTAL : LinearLayout.VERTICAL);
        LinearLayout tileA = tile(Ui.Glyph.MONITOR, "A // PC → QUEST", "Show my PC here", "Your PC screens float in front of you. Control them with your hands.", true);
        LinearLayout tileB = tile(Ui.Glyph.CAST, "B // QUEST → SCREENS", "Share what I see", "Watch your Quest on a TV, phone or laptop — just open a link.", false);
        tileA.setOnClickListener(v -> showPage(PC));
        tileB.setOnClickListener(v -> showPage(SHARE));
        // Side by side, both tiles take the taller one's height.
        LinearLayout.LayoutParams pa = wide ? new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1) : Ui.full(c, 0);
        LinearLayout.LayoutParams pb = wide ? new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1) : Ui.full(c, 14);
        tiles.setBaselineAligned(false);
        if (wide) pa.rightMargin = Ui.dp(c, 18);
        tiles.addView(tileA, pa);
        tiles.addView(tileB, pb);
        col.addView(tiles, Ui.full(c, 24));

        TextView tip = Ui.mono(c, "TIP // POINT AT A BUTTON, THEN PINCH TO PRESS IT", 12, Ui.INK3);
        tip.setPadding(0, Ui.dp(c, 22), 0, 0);
        col.addView(tip);
        entrance[HOME] = new View[]{kicker, hero, sub, tileA, tileB, tip};
        return col;
    }

    private LinearLayout tile(int glyph, String kicker, String name, String desc, boolean isA) {
        Context c = this;
        LinearLayout t = new LinearLayout(c);
        t.setOrientation(LinearLayout.VERTICAL);
        t.setPadding(Ui.dp(c, 30), Ui.dp(c, 28), Ui.dp(c, 30), Ui.dp(c, 26));
        t.setMinimumHeight(Ui.dp(c, 300));
        Ui.rowBackground(c, t);
        Ui.pressable(t);
        t.addView(new Ui.Glyph(c, glyph, 64));
        TextView k = Ui.mono(c, kicker, 12, Ui.SIGNAL);
        k.setPadding(0, Ui.dp(c, 18), 0, Ui.dp(c, 2));
        t.addView(k);
        t.addView(title(name, 32));
        TextView d = body(desc);
        d.setPadding(0, Ui.dp(c, 6), 0, Ui.dp(c, 18));
        t.addView(d, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        LinearLayout st = Ui.row(c);
        View dot = dot();
        st.addView(dot);
        TextView s = Ui.mono(c, "…", 13, Ui.INK2);
        s.setPadding(Ui.dp(c, 10), 0, 0, 0);
        st.addView(s);
        TextView go = Ui.text(c, "→", 30, Ui.INK, Ui.MONO_BOLD);
        st.addView(new View(c), new LinearLayout.LayoutParams(0, 1, 1));
        st.addView(go);
        t.addView(st);
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(c, 4));
        bp.topMargin = Ui.dp(c, 14);
        t.addView(Ui.accentBar(c, t), bp);
        if (isA) {
            tileAStatus = s;
            tileADot = dot;
        } else {
            tileBStatus = s;
            tileBDot = dot;
        }
        return t;
    }

    private LinearLayout backRow(String kicker, String name, Runnable onBack) {
        Context c = this;
        LinearLayout r = Ui.row(c);
        Button back = Ui.button(c, "←  Back", false);
        back.setOnClickListener(v -> onBack.run());
        Ui.pressable(back);
        r.addView(back);
        LinearLayout titles = new LinearLayout(c);
        titles.setOrientation(LinearLayout.VERTICAL);
        titles.setPadding(Ui.dp(c, 20), 0, 0, 0);
        titles.addView(Ui.mono(c, kicker, 12, Ui.SIGNAL));
        titles.addView(title(name, 30));
        r.addView(titles);
        return r;
    }

    // ---------------- step 1: link with the PC (just look at its screen)

    private View buildLinkPage() {
        Context c = this;
        LinearLayout col = new LinearLayout(c);
        col.setOrientation(LinearLayout.VERTICAL);
        Ui.autoAnimate(col);
        TextView kicker = Ui.mono(c, "■ STEP 1 OF 2 // LINK", 13, Ui.SIGNAL);
        TextView hero = title("Link your PC", 40);
        TextView sub = body("One time only. Then you choose: your PC in the Quest, or the Quest on a TV.");
        col.addView(kicker);
        col.addView(hero);
        col.addView(sub);
        linkStatus = Ui.mono(c, "", 13, Ui.INK2);
        linkStatus.setPadding(0, Ui.dp(c, 12), 0, 0);
        col.addView(linkStatus);

        connectBox = new LinearLayout(c);
        connectBox.setOrientation(LinearLayout.VERTICAL);
        Ui.autoAnimate(connectBox);
        LinearLayout card = Ui.card(c);
        Ui.autoAnimate(card);
        // Look at the PC: live camera view + scan frame; linking happens by itself.
        LinearLayout scanRowTop = Ui.row(c);
        scanRowTop.setGravity(Gravity.TOP);
        FrameLayout cam = new FrameLayout(c);
        cam.setBackground(new Ui.Cut(0xFF000000, Ui.INK, Ui.dp(c, 2), Ui.dp(c, 14)));
        cam.setPadding(Ui.dp(c, 3), Ui.dp(c, 3), Ui.dp(c, 3), Ui.dp(c, 3));
        camView = new android.view.TextureView(c);
        cam.addView(camView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        cam.addView(new Ui.Reticle(c), new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        scanRowTop.addView(cam, new LinearLayout.LayoutParams(Ui.dp(c, 300), Ui.dp(c, 225)));
        LinearLayout tt = new LinearLayout(c);
        tt.setOrientation(LinearLayout.VERTICAL);
        tt.setPadding(Ui.dp(c, 22), 0, 0, 0);
        tt.addView(title("Look at your PC", 28));
        tt.addView(body("Your PC pops up a big code. Look at its screen from about an arm's length. Linking happens by itself."));
        scanState = Ui.mono(c, "■ STARTING CAMERA…", 13, Ui.SIGNAL);
        scanState.setPadding(0, Ui.dp(c, 12), 0, 0);
        tt.addView(scanState);
        scanBtn = Ui.button(c, "◎  Start camera", true);
        scanBtn.setOnClickListener(v -> startScanning(true));
        Ui.pressable(scanBtn);
        tt.addView(scanBtn, Ui.full(c, 14));
        Ui.show(scanBtn, false);
        scanRowTop.addView(tt, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        card.addView(scanRowTop);

        waitBox = new LinearLayout(c);
        waitBox.setOrientation(LinearLayout.VERTICAL);
        waitBox.setPadding(Ui.dp(c, 22), Ui.dp(c, 16), Ui.dp(c, 22), Ui.dp(c, 18));
        waitBox.setBackground(new Ui.Cut(Ui.BG, Ui.SIGNAL, Ui.dp(c, 2), Ui.dp(c, 16)));
        View hatch = new View(c);
        hatch.setBackground(Ui.hatch(c, Ui.SIGNAL));
        waitBox.addView(hatch, new LinearLayout.LayoutParams(Ui.dp(c, 90), Ui.dp(c, 10)));
        LinearLayout wr = Ui.row(c);
        wr.setPadding(0, Ui.dp(c, 12), 0, 0);
        wr.addView(new Ui.Ring(c));
        LinearLayout wt = new LinearLayout(c);
        wt.setOrientation(LinearLayout.VERTICAL);
        wt.setPadding(Ui.dp(c, 18), 0, 0, 0);
        waitTitle = Ui.mono(c, "ALMOST THERE", 14, Ui.INK);
        wt.addView(waitTitle);
        wt.addView(body("Press ALLOW on the PC. It shows this same number:"));
        waitCode = Ui.text(c, "0000", 54, Ui.SIGNAL, Ui.MONO_BOLD);
        waitCode.setLetterSpacing(0.3f);
        wt.addView(waitCode);
        wr.addView(wt, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        waitBox.addView(wr);
        Button cancel = Ui.button(c, "Cancel", false);
        cancel.setOnClickListener(v -> stopPairing(null));
        waitBox.addView(cancel, Ui.full(c, 8));
        card.addView(waitBox, Ui.full(c, 16));
        Ui.show(waitBox, false);
        connectBox.addView(card, Ui.full(c, 14));

        connectBox.addView(Ui.section(c, "OR", "Tap your PC"));
        nearbyList = new LinearLayout(c);
        nearbyList.setOrientation(LinearLayout.VERTICAL);
        Ui.autoAnimate(nearbyList);
        connectBox.addView(nearbyList);
        scanRow = Ui.row(c);
        scanRow.setPadding(0, Ui.dp(c, 4), 0, Ui.dp(c, 4));
        scanRow.addView(new Ui.Ring(c));
        TextView scanText = Ui.mono(c, "LOOKING FOR PCS ON THIS WI-FI…", 13, Ui.INK2);
        scanText.setPadding(Ui.dp(c, 18), 0, 0, 0);
        scanRow.addView(scanText);
        connectBox.addView(scanRow);

        Ui.Fold other = new Ui.Fold(c, "Other ways (code / address)");
        other.body.addView(body("Type the 6-digit code from the PC (Settings → Link the Quest app):"));
        LinearLayout codeRow = Ui.row(c);
        codeField = field("123456", InputType.TYPE_CLASS_NUMBER);
        codeField.setTextSize(28);
        codeField.setLetterSpacing(0.3f);
        codeRow.addView(codeField, Ui.weight(c, 1, 4));
        Button pairBtn = Ui.button(c, "Link", true);
        pairBtn.setOnClickListener(v -> pairWithCode());
        codeRow.addView(pairBtn, Ui.weight(c, 0.5f, 4));
        other.body.addView(codeRow, Ui.full(c, 8));
        other.body.addView(body("PC not showing up? Type its address:"), Ui.full(c, 12));
        LinearLayout addrRow = Ui.row(c);
        addressField = field("192.168.1.10", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        addressField.setText(host.manualAddress());
        addrRow.addView(addressField, Ui.weight(c, 1, 4));
        Button saveAddr = Ui.button(c, "Save", false);
        saveAddr.setOnClickListener(v -> {
            host.setManualAddress(addressField.getText().toString());
            toast("Saved");
            refreshNow();
        });
        addrRow.addView(saveAddr, Ui.weight(c, 0.5f, 4));
        other.body.addView(addrRow);
        connectBox.addView(other, Ui.full(c, 18));
        col.addView(connectBox, Ui.full(c, 4));
        entrance[LINK] = new View[]{kicker, hero, sub, linkStatus, connectBox};
        return col;
    }

    // ---------------- page A: PC -> Quest

    private View buildPcPage() {
        Context c = this;
        LinearLayout col = new LinearLayout(c);
        col.setOrientation(LinearLayout.VERTICAL);
        Ui.autoAnimate(col);
        LinearLayout head = backRow("A // PC → QUEST", "Show my PC here", () -> showPage(HOME));
        col.addView(head);
        pcState = Ui.mono(c, "", 13, Ui.INK2);
        pcState.setPadding(0, Ui.dp(c, 12), 0, 0);
        col.addView(pcState);

        // The screens, big and obvious.
        screensBox = new LinearLayout(c);
        screensBox.setOrientation(LinearLayout.VERTICAL);
        Ui.autoAnimate(screensBox);
        screenList = new LinearLayout(c);
        screenList.setOrientation(LinearLayout.VERTICAL);
        screensBox.addView(screenList, Ui.full(c, 14));
        openAllBtn = Ui.button(c, "Open all screens", false);
        openAllBtn.setOnClickListener(v -> openAll());
        Ui.pressable(openAllBtn);
        screensBox.addView(openAllBtn, Ui.full(c, 10));

        Ui.Fold hands = new Ui.Fold(c, "✋  How to use your hands");
        TextView gestures = Ui.mono(c,
                "POINT ........ MOVE THE MOUSE\nPINCH ........ CLICK\nPINCH + HOLD . RIGHT-CLICK\nPINCH + DRAG . SCROLL\n⌨ KEYS ....... TYPE ON THE PC",
                14, Ui.INK2);
        gestures.setLineSpacing(Ui.dp(c, 5), 1f);
        gestures.setPadding(Ui.dp(c, 14), Ui.dp(c, 8), 0, 0);
        hands.body.addView(gestures);
        TextView win = body("Move a window: pinch the bar under it and drag. Resize: drag a corner.");
        win.setPadding(Ui.dp(c, 14), Ui.dp(c, 10), 0, 0);
        hands.body.addView(win);
        screensBox.addView(hands, Ui.full(c, 16));
        TextView where = Ui.mono(c, "QUALITY, SMOOTHNESS & SOUND → ⚙ SETTINGS", 12, Ui.INK3);
        where.setPadding(0, Ui.dp(c, 14), 0, 0);
        screensBox.addView(where);
        col.addView(screensBox);
        entrance[PC] = new View[]{head, pcState, screensBox};
        return col;
    }

    // ---------------- page B: Quest -> any screen

    private View buildSharePage() {
        Context c = this;
        LinearLayout col = new LinearLayout(c);
        col.setOrientation(LinearLayout.VERTICAL);
        Ui.autoAnimate(col);
        LinearLayout head = backRow("B // QUEST → ANY SCREEN", "Share what I see", () -> showPage(HOME));
        col.addView(head);
        shareState = Ui.mono(c, "", 13, Ui.INK2);
        shareState.setPadding(0, Ui.dp(c, 12), 0, 0);
        col.addView(shareState);

        // ---- PC not running
        findPcBox = Ui.card(c);
        LinearLayout fr = Ui.row(c);
        fr.addView(new Ui.Ring(c));
        LinearLayout ft = new LinearLayout(c);
        ft.setOrientation(LinearLayout.VERTICAL);
        ft.setPadding(Ui.dp(c, 18), 0, 0, 0);
        ft.addView(title("Start the PC app", 26));
        ft.addView(body("Run Quest Mirror (start.bat) on your PC, on the same Wi-Fi as this Quest."));
        fr.addView(ft, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        findPcBox.addView(fr);
        col.addView(findPcBox, Ui.full(c, 14));

        // ---- one-time cable setup, as 3 live steps
        setupBox = Ui.card(c);
        Ui.autoAnimate(setupBox);
        LinearLayout st = Ui.row(c);
        st.addView(new Ui.Glyph(c, Ui.Glyph.PLUG, 56));
        LinearLayout stt = new LinearLayout(c);
        stt.setOrientation(LinearLayout.VERTICAL);
        stt.setPadding(Ui.dp(c, 18), 0, 0, 0);
        stt.addView(title("One-time setup", 26));
        stt.addView(body("Takes 20 seconds. After this, no cable needed."));
        st.addView(stt);
        setupBox.addView(st);
        String[] steps = {"Plug this Quest into your PC with a USB cable", "Put the headset on and press “Allow”", "Done — it moves to Wi-Fi by itself. Unplug any time."};
        for (int i = 0; i < 3; i++) {
            LinearLayout r = Ui.row(c);
            r.setPadding(0, Ui.dp(c, 16), 0, 0);
            TextView num = Ui.text(c, String.valueOf(i + 1), 18, Ui.BG, Ui.MONO_BOLD);
            num.setGravity(Gravity.CENTER);
            num.setBackground(new Ui.Cut(Ui.INK3, Ui.INK3, 0, Ui.dp(c, 6)));
            r.addView(num, new LinearLayout.LayoutParams(Ui.dp(c, 40), Ui.dp(c, 40)));
            TextView t = body(steps[i]);
            t.setPadding(Ui.dp(c, 16), 0, 0, 0);
            r.addView(t, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            stepMark[i] = num;
            stepText[i] = t;
            setupBox.addView(r);
        }
        col.addView(setupBox, Ui.full(c, 14));

        // ---- ready: the address, big
        liveBox = new LinearLayout(c);
        liveBox.setOrientation(LinearLayout.VERTICAL);
        Ui.autoAnimate(liveBox);
        LinearLayout addr = Ui.card(c);
        addr.addView(Ui.mono(c, "OPEN THIS ON ANY SCREEN", 13, Ui.SIGNAL));
        shareUrl = Ui.text(c, "", 40, Ui.INK, Ui.MONO_BOLD);
        shareUrl.setPadding(0, Ui.dp(c, 6), 0, Ui.dp(c, 4));
        addr.addView(shareUrl);
        View underline = new View(c);
        underline.setBackgroundColor(Ui.SIGNAL);
        addr.addView(underline, new LinearLayout.LayoutParams(Ui.dp(c, 140), Ui.dp(c, 3)));
        addr.addView(body("Type it into the browser of a TV, phone or laptop on the same Wi-Fi."), Ui.full(c, 10));
        LinearLayout wr = Ui.row(c);
        wr.setPadding(0, Ui.dp(c, 16), 0, 0);
        watchersDot = dot();
        wr.addView(watchersDot);
        watchersText = Ui.mono(c, "", 14, Ui.INK);
        watchersText.setPadding(Ui.dp(c, 12), 0, 0, 0);
        wr.addView(watchersText);
        addr.addView(wr);
        pauseBtn = Ui.button(c, "Pause sharing", false);
        pauseBtn.setOnClickListener(v -> setSetting("paused", !optSetting("paused")));
        Ui.pressable(pauseBtn);
        addr.addView(pauseBtn, Ui.full(c, 18));
        liveBox.addView(addr, Ui.full(c, 14));
        TextView where = Ui.mono(c, "VIEW, QUALITY, CONTROL & PRIVACY → ⚙ SETTINGS", 12, Ui.INK3);
        where.setPadding(0, Ui.dp(c, 4), 0, 0);
        liveBox.addView(where);
        col.addView(liveBox);
        Ui.show(liveBox, false);
        Ui.show(setupBox, false);
        entrance[SHARE] = new View[]{head, shareState, findPcBox, setupBox, liveBox};
        return col;
    }

    // ---------------- settings: everything you can change, in one place

    private TextView label(String s, boolean first) {
        TextView t = Ui.mono(this, s, 12, Ui.INK3);
        t.setPadding(0, first ? 0 : Ui.dp(this, 14), 0, Ui.dp(this, 6));
        return t;
    }

    private View buildSettingsPage() {
        Context c = this;
        LinearLayout col = new LinearLayout(c);
        col.setOrientation(LinearLayout.VERTICAL);
        Ui.autoAnimate(col);
        LinearLayout head = backRow("SYS // SETTINGS", "Settings", () -> showPage(settingsFrom));
        col.addView(head);

        // A: the PC in the Quest
        LinearLayout secA = Ui.section(c, "A", "Your PC in the Quest");
        col.addView(secA);
        LinearLayout a = Ui.card(c);
        a.addView(label("PICTURE", true));
        a.addView(segment("pcQuality", new String[]{"Light", "Balanced", "Sharp"}, new String[]{"6000", "12000", "25000"},
                v -> prefs.edit().putString("pcQuality", v).apply()));
        a.addView(label("SMOOTHNESS", false));
        a.addView(segment("pcFps", new String[]{"30 fps", "60 fps", "72 fps"}, new String[]{"30", "60", "72"},
                v -> prefs.edit().putString("pcFps", v).apply()));
        selectSegment("pcQuality", prefs.getString("pcQuality", "12000"));
        selectSegment("pcFps", prefs.getString("pcFps", "60"));
        soundRow = new Ui.SwitchRow(c, "PC sound in the headset", on -> PcAudio.get(this).setMuted(!on));
        soundRow.setChecked(!PcAudio.get(this).muted());
        a.addView(soundRow, Ui.full(c, 16));
        TextView aNote = body("Picture changes apply the next time you open a screen. Need more screens? Add virtual monitors on the PC; they show up by themselves.");
        aNote.setPadding(0, Ui.dp(c, 12), 0, 0);
        a.addView(aNote);
        col.addView(a);

        // B: sharing the Quest view
        LinearLayout secB = Ui.section(c, "B", "Sharing what you see");
        col.addView(secB);
        LinearLayout b = Ui.card(c);
        Ui.autoAnimate(b);
        shareSettingsNote = body("Available after the one-time cable setup in “Share what I see”.");
        b.addView(shareSettingsNote);
        shareSettings = new LinearLayout(c);
        shareSettings.setOrientation(LinearLayout.VERTICAL);
        shareSettings.addView(label("VIEW", true));
        shareSettings.addView(segment("view", new String[]{"Left eye", "Right eye", "Both"}, new String[]{"left", "right", "both"}, v -> setSetting("view", v)));
        shareSettings.addView(label("QUALITY", false));
        shareSettings.addView(segment("quality", new String[]{"Low", "Medium", "High"}, new String[]{"low", "medium", "high"}, v -> setSetting("quality", v)));
        controlRow = new Ui.SwitchRow(c, "Let viewers control the headset", on -> setSetting("allowControl", on));
        awakeRow = new Ui.SwitchRow(c, "Keep awake when not worn", on -> setSetting("keepAwake", on));
        lensRow = new Ui.SwitchRow(c, "Straighten lens distortion", on -> setSetting("lensFix", on));
        shareSettings.addView(controlRow, Ui.full(c, 16));
        shareSettings.addView(awakeRow, Ui.full(c, 8));
        shareSettings.addView(lensRow, Ui.full(c, 8));
        panelState = body("");
        panelState.setPadding(0, Ui.dp(c, 14), 0, 0);
        shareSettings.addView(panelState);
        panelBtn = Ui.button(c, "Accessibility settings", false);
        panelBtn.setOnClickListener(v -> {
            try {
                startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
            } catch (Exception e) {
                toast("Turn it on from the PC: Settings → Turn on panel control");
            }
        });
        shareSettings.addView(panelBtn, Ui.full(c, 8));
        b.addView(shareSettings);
        col.addView(b);

        // C: connection & link
        LinearLayout secC = Ui.section(c, "C", "Connection");
        col.addView(secC);
        LinearLayout cc = Ui.card(c);
        linkedInfo = Ui.mono(c, "", 14, Ui.INK);
        cc.addView(linkedInfo);
        linkState = Ui.mono(c, "", 13, Ui.INK2);
        linkState.setPadding(0, Ui.dp(c, 8), 0, 0);
        linkState.setLineSpacing(Ui.dp(c, 4), 1f);
        cc.addView(linkState);
        wifiBtn = Ui.button(c, "Go wireless now", false);
        wifiBtn.setOnClickListener(v -> post("/api/wireless", obj("enable", true), "Wi-Fi on. You can unplug the cable."));
        cc.addView(wifiBtn, Ui.full(c, 12));
        unlinkBtn = Ui.button(c, "Unlink this PC", false);
        unlinkBtn.setOnClickListener(v -> io.execute(() -> {
            host.unlink(); // the PC revokes access and closes any open screens
            ui.post(() -> {
                monitors = new JSONArray();
                screenList.setTag(null);
                toast("Unlinked. Look at the PC again to link.");
                showPage(LINK);
                refreshNow();
            });
        }));
        cc.addView(unlinkBtn, Ui.full(c, 12));
        col.addView(cc);

        // D: look
        LinearLayout secD = Ui.section(c, "D", "Look");
        col.addView(secD);
        LinearLayout dd = Ui.card(c);
        dd.addView(segment("theme", new String[]{"☀  Paper", "☾  Night"}, new String[]{"paper", "night"}, v -> {
            boolean night = v.equals("night");
            if (night == Ui.night) return;
            prefs.edit().putBoolean("night", night).apply();
            recreate();
        }));
        selectSegment("theme", Ui.night ? "night" : "paper");
        col.addView(dd);
        entrance[SETTINGS] = new View[]{head, secA, a, secB, b, secC, cc, secD, dd};
        return col;
    }

    private EditText field(String hint, int type) {
        EditText e = new EditText(this);
        e.setHint(hint);
        e.setInputType(type);
        e.setSingleLine(true);
        e.setTextSize(20);
        e.setTypeface(Ui.MONO_BOLD);
        e.setTextColor(Ui.INK);
        e.setHintTextColor(Ui.INK3);
        e.setBackground(new Ui.Cut(Ui.BG3, Ui.INK, Ui.dp(this, 1.5f), Ui.dp(this, 10)));
        e.setPadding(Ui.dp(this, 16), Ui.dp(this, 14), Ui.dp(this, 16), Ui.dp(this, 14));
        e.setMinHeight(Ui.dp(this, 64));
        return e;
    }

    interface Pick {
        void on(String value);
    }

    private LinearLayout segment(String key, String[] labels, String[] values, Pick pick) {
        LinearLayout row = Ui.row(this);
        for (int i = 0; i < labels.length; i++) {
            Button b = Ui.button(this, labels[i], false);
            b.setTag(values[i]);
            final String value = values[i];
            b.setOnClickListener(v -> {
                selectSegment(key, value);
                pick.on(value);
            });
            Ui.pressable(b);
            LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
            p.setMargins(i == 0 ? 0 : Ui.dp(this, 4), 0, i == labels.length - 1 ? 0 : Ui.dp(this, 4), 0);
            row.addView(b, p);
        }
        segments.put(key, row);
        return row;
    }

    private void selectSegment(String key, String value) {
        LinearLayout row = segments.get(key);
        if (row == null) return;
        for (int i = 0; i < row.getChildCount(); i++) {
            View b = row.getChildAt(i);
            b.setSelected(value.equals(b.getTag()));
        }
    }

    // ------------------------------------------------------------------ polling

    private volatile boolean polling;

    private void refreshNow() {
        ui.removeCallbacks(poll);
        ui.post(poll);
    }

    private final Runnable poll = new Runnable() {
        @Override
        public void run() {
            if (visible) ui.postDelayed(this, 1500);
            if (polling) return; // previous check still trying addresses
            polling = true;
            io.execute(() -> {
                JSONObject s = host.status();
                JSONArray mons = null;
                if (s != null && host.token() != null && System.currentTimeMillis() - monitorsAt > 5000) {
                    try {
                        mons = host.get("/api/pc/monitors").getJSONArray("monitors");
                        monitorsAt = System.currentTimeMillis();
                    } catch (HostClient.HttpError e) {
                        // The PC revoked us (unlinked from the dashboard): show "not linked", don't auto re-link.
                        if (e.code == 401) {
                            host.forget();
                            mons = new JSONArray();
                        }
                    } catch (Exception ignored) {
                    }
                }
                final JSONArray m = mons;
                polling = false;
                ui.post(() -> {
                    status = s;
                    if (m != null) monitors = m;
                    render();
                });
            });
        }
    };

    private void render() {
        if (headerTag == null) return;
        boolean found = status != null;
        boolean paired = host.token() != null;
        String via = HostClient.LOCAL.equals(host.base) ? "CABLE" : "WI-FI";

        // The order is fixed: link first, then choose. Unlinked → back to step 1; just linked → step 2.
        if (!paired && (page == HOME || page == PC || page == SHARE)) {
            showPage(LINK);
            return;
        }
        if (paired && page == LINK) {
            showPage(pendingOpen != null ? PC : HOME);
            return;
        }

        if (paired && found) Ui.setTag(this, headerTag, "LINKED // " + nameOrPc().toUpperCase(), true);
        else if (paired) Ui.setTag(this, headerTag, "PC OFFLINE", false);
        else Ui.setTag(this, headerTag, "NOT LINKED", false);

        JSONObject dev = found ? status.optJSONObject("device") : null;
        boolean questLinked = dev != null && dev.optBoolean("connected");
        JSONObject cap = found ? status.optJSONObject("capture") : null;
        JSONObject set = found ? status.optJSONObject("settings") : null;
        int viewers = cap != null ? cap.optInt("viewers") : 0;
        boolean paused = set != null && set.optBoolean("paused");

        // ---------------- step 1: link
        if (paired) stopScanning();
        else if (page == LINK && visible) {
            if (scanner == null) startScanning(false);
            else sendScanHint();
        }
        if (!paired) {
            boolean anyPc = found || !host.nearbyPcs().isEmpty();
            Ui.setTextSoft(linkStatus, pairId != null ? "■ WAITING FOR " + (pairName == null ? "THE PC" : pairName.toUpperCase())
                    : anyPc ? "■ NOT LINKED YET" : "■ NO PC FOUND YET — START QUEST MIRROR ON YOUR PC (SAME WI-FI)");
            renderNearby();
            Ui.show(waitBox, pairId != null);
        }

        // ---------------- step 2: choose
        Ui.setTextSoft(homeKicker, "■ STEP 2 OF 2 // LINKED TO " + nameOrPc().toUpperCase());
        if (!found) {
            Ui.setTextSoft(tileAStatus, "PC OFFLINE — START QUEST MIRROR ON IT");
            setDot(tileADot, false);
        } else {
            Ui.setTextSoft(tileAStatus, monitors.length() + (monitors.length() == 1 ? " SCREEN READY" : " SCREENS READY"));
            setDot(tileADot, monitors.length() > 0);
        }
        if (!found) {
            Ui.setTextSoft(tileBStatus, "PC OFFLINE");
            setDot(tileBDot, false);
        } else if (!questLinked) {
            Ui.setTextSoft(tileBStatus, "ONE-TIME CABLE SETUP");
            setDot(tileBDot, false);
        } else if (paused) {
            Ui.setTextSoft(tileBStatus, "PAUSED");
            setDot(tileBDot, false);
        } else {
            Ui.setTextSoft(tileBStatus, viewers > 0 ? "LIVE · " + viewers + " WATCHING" : "READY TO SHARE");
            setDot(tileBDot, viewers > 0);
        }

        // ---------------- page A
        Ui.show(screensBox, found && paired);
        if (paired && !found) {
            Ui.setTextSoft(pcState, "■ " + nameOrPc().toUpperCase() + " IS OFFLINE — START QUEST MIRROR ON THE PC");
        } else if (paired) {
            Ui.setTextSoft(pcState, "■ LINKED TO " + nameOrPc().toUpperCase() + " · " + via + " · PICK A SCREEN TO OPEN");
            renderMonitors();
            Ui.show(openAllBtn, monitors.length() > 1);
            if (pendingOpen != null && monitors.length() > 0) {
                String want = pendingOpen;
                pendingOpen = null;
                if (want.equals("all")) openAll();
                else for (int i = 0; i < monitors.length(); i++) {
                    JSONObject m = monitors.optJSONObject(i);
                    if (m != null && want.equals(m.optString("id"))) openScreen(m);
                }
            }
        }

        renderSettings(found, paired, via, dev, set, questLinked);

        // ---------------- page B
        Ui.show(findPcBox, !found);
        Ui.show(setupBox, found && !questLinked);
        Ui.show(liveBox, found && questLinked);
        if (!found) {
            Ui.setTextSoft(shareState, "■ WAITING FOR THE PC APP");
            return;
        }
        if (!questLinked) {
            boolean unauthorized = dev != null && dev.optBoolean("unauthorized");
            int current = unauthorized ? 1 : 0;
            Ui.setTextSoft(shareState, unauthorized ? "■ PRESS ALLOW IN THE HEADSET" : "■ WAITING FOR THE CABLE");
            for (int i = 0; i < 3; i++) {
                boolean done = i < current;
                boolean now = i == current;
                stepMark[i].setBackground(new Ui.Cut(done ? Ui.INK : now ? Ui.SIGNAL : Ui.INK3, 0, 0, Ui.dp(this, 6)));
                ((TextView) stepMark[i]).setText(done ? "✓" : String.valueOf(i + 1));
                stepText[i].setTextColor(now ? Ui.INK : Ui.INK2);
                if (now && stepMark[i].getTag() == null) Ui.pulse(stepMark[i]);
                if (!now && stepMark[i].getTag() instanceof android.animation.Animator) {
                    ((android.animation.Animator) stepMark[i].getTag()).cancel();
                    stepMark[i].setTag(null);
                    stepMark[i].setAlpha(1f);
                }
            }
            return;
        }
        Ui.setTextSoft(shareState, paused ? "■ PAUSED — NOBODY CAN SEE YOUR VIEW" : "■ READY — IT STARTS WHEN SOMEONE OPENS THE LINK");
        JSONArray urls = status.optJSONArray("urls");
        String url = "";
        if (urls != null) {
            for (int i = 0; i < urls.length(); i++) {
                JSONObject u = urls.optJSONObject(i);
                if (u != null && !u.optBoolean("virtual")) {
                    url = u.optString("url").replace("http://", "");
                    break;
                }
            }
        }
        Ui.setTextSoft(shareUrl, url.isEmpty() ? "(PC has no network)" : url);
        watchersText.setText(paused ? "PAUSED" : viewers > 0 ? viewers + (viewers == 1 ? " SCREEN WATCHING" : " SCREENS WATCHING") + " · " + cap.optInt("fps") + " FPS" : "NOBODY WATCHING YET");
        setDot(watchersDot, viewers > 0 && !paused);
        pauseBtn.setText(paused ? "▶  Resume sharing" : "❚❚  Pause sharing");
        Ui.setPrimary(this, pauseBtn, paused);
    }

    /** Fills the one Settings page from the PC's status (sections that need something show why). */
    private void renderSettings(boolean found, boolean paired, String via, JSONObject dev, JSONObject set, boolean questLinked) {
        soundRow.setChecked(!PcAudio.get(this).muted());
        boolean shareReady = found && questLinked;
        Ui.show(shareSettings, shareReady);
        Ui.show(shareSettingsNote, !shareReady);
        Ui.setTextSoft(shareSettingsNote, !found ? "Available when the PC app is running." : "Available after the one-time cable setup in “Share what I see”.");
        if (set != null) {
            selectSegment("view", set.optString("view"));
            selectSegment("quality", set.optString("quality"));
            controlRow.setChecked(set.optBoolean("allowControl"));
            awakeRow.setChecked(set.optBoolean("keepAwake"));
            lensRow.setChecked(set.optBoolean("lensFix"));
        }
        JSONObject agent = found ? status.optJSONObject("agent") : null;
        boolean panelOn = ControlService.get() != null || (agent != null && agent.optBoolean("accessibility"));
        panelState.setText(panelOn
                ? "Panel control is on: viewers can click and type inside 2D apps (when you allow control)."
                : "Panel control is off (optional). Turn it on from the PC to let viewers click inside 2D apps.");
        Ui.show(panelBtn, !panelOn);

        Ui.setTextSoft(linkedInfo, !paired ? "■ NOT LINKED" : found ? "■ LINKED TO " + nameOrPc().toUpperCase() + " · " + via : "■ LINKED TO " + nameOrPc().toUpperCase() + " · OFFLINE");
        Ui.show(unlinkBtn, paired);
        if (dev != null) {
            boolean usb = "usb".equals(dev.optString("transport"));
            boolean wifiUp = dev.optBoolean("wifiPresent");
            boolean connected = dev.optBoolean("connected");
            linkState.setText("HEADSET LINK . " + (!connected ? "NOT SET UP (CABLE ONCE)" : usb ? "USB CABLE" : "WI-FI") + "\n"
                    + "WIRELESS ..... " + (wifiUp ? "READY · CABLE OPTIONAL" : dev.optBoolean("switching") ? "SWITCHING…" : "OFF") + "\n"
                    + "BATTERY ...... " + (dev.isNull("battery") ? "—" : dev.optInt("battery") + "%"));
            boolean autoWifi = set != null && set.optBoolean("autoWireless");
            Ui.show(wifiBtn, connected && usb && !wifiUp && !autoWifi);
        } else {
            linkState.setText(found ? "HEADSET LINK . NOT SET UP (CABLE ONCE)" : "PC APP ....... NOT RUNNING");
            Ui.show(wifiBtn, false);
        }
    }

    private String nameOrPc() {
        return host.hostName == null || host.hostName.isEmpty() ? "your PC" : host.hostName;
    }

    private void renderNearby() {
        List<String[]> pcs = host.nearbyPcs();
        StringBuilder key = new StringBuilder();
        for (String[] p : pcs) key.append(p[0]).append('=').append(p[1]).append(';');
        Ui.show(scanRow, pcs.isEmpty());
        if (key.toString().equals(nearbyList.getTag())) return;
        nearbyList.setTag(key.toString());
        nearbyList.removeAllViews();
        int i = 0;
        for (String[] p : pcs) {
            final String base = p[0];
            final String name = p[1].isEmpty() ? "PC" : p[1];
            LinearLayout row = Ui.row(this);
            row.setPadding(Ui.dp(this, 20), Ui.dp(this, 12), Ui.dp(this, 10), Ui.dp(this, 12));
            row.setBackground(new Ui.Cut(Ui.BG2, Ui.INK, Ui.dp(this, 1.5f), Ui.dp(this, 14)));
            row.addView(new Ui.Glyph(this, Ui.Glyph.MONITOR, 40));
            LinearLayout texts = new LinearLayout(this);
            texts.setOrientation(LinearLayout.VERTICAL);
            texts.setPadding(Ui.dp(this, 16), 0, 0, 0);
            texts.addView(Ui.text(this, name.toUpperCase(), 24, Ui.INK, Ui.DISPLAY));
            texts.addView(Ui.mono(this, base.replace("http://", ""), 12, Ui.INK3));
            row.addView(texts, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            Button connect = Ui.button(this, "Connect →", true);
            connect.setOnClickListener(v -> startPairing(base, name));
            Ui.pressable(connect);
            row.addView(connect);
            nearbyList.addView(row, Ui.full(this, i++ == 0 ? 0 : 10));
            Ui.fadeUp(row, i * 60L);
        }
    }

    private void renderMonitors() {
        String key = monitors.toString();
        if (key.equals(screenList.getTag())) return;
        screenList.setTag(key);
        screenList.removeAllViews();
        for (int i = 0; i < monitors.length(); i++) {
            JSONObject m = monitors.optJSONObject(i);
            if (m == null) continue;
            LinearLayout row = Ui.row(this);
            row.setPadding(Ui.dp(this, 22), Ui.dp(this, 16), Ui.dp(this, 14), Ui.dp(this, 16));
            row.setBackground(new Ui.Cut(Ui.BG2, Ui.INK, Ui.dp(this, 2), Ui.dp(this, 18)));
            row.addView(new Ui.Glyph(this, Ui.Glyph.MONITOR, 52));
            LinearLayout texts = new LinearLayout(this);
            texts.setOrientation(LinearLayout.VERTICAL);
            texts.setPadding(Ui.dp(this, 18), 0, 0, 0);
            texts.addView(Ui.text(this, m.optString("name").toUpperCase(), 28, Ui.INK, Ui.DISPLAY));
            texts.addView(Ui.mono(this, m.optInt("w") + " × " + m.optInt("h"), 12, Ui.INK3));
            row.addView(texts, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            Button open = Ui.button(this, "Open  →", true);
            open.setTextSize(18);
            open.setMinHeight(Ui.dp(this, 72));
            open.setOnClickListener(v -> openScreen(m));
            Ui.pressable(open);
            row.addView(open);
            screenList.addView(row, Ui.full(this, i == 0 ? 0 : 12));
            Ui.fadeUp(row, 80 + i * 90L);
        }
    }

    // ------------------------------------------------------------------ linking

    private static final int REQ_CAMERA = 43;
    private static final String HEADSET_CAMERA = "horizonos.permission.HEADSET_CAMERA";

    private boolean hasCameraPermission() {
        return checkSelfPermission(android.Manifest.permission.CAMERA) == android.content.pm.PackageManager.PERMISSION_GRANTED
                && checkSelfPermission(HEADSET_CAMERA) == android.content.pm.PackageManager.PERMISSION_GRANTED;
    }

    /** Starts the passthrough camera and asks nearby PCs to show their big link code. */
    private void startScanning(boolean userAsked) {
        if (host.token() != null || page != LINK || linking) return;
        if (!hasCameraPermission()) {
            if (userAsked || !prefs.getBoolean("askedCamera", false)) {
                prefs.edit().putBoolean("askedCamera", true).apply();
                requestPermissions(new String[]{android.Manifest.permission.CAMERA, HEADSET_CAMERA}, REQ_CAMERA);
            }
            scanState.setText("■ CAMERA IS OFF — PRESS START CAMERA");
            Ui.show(scanBtn, true);
            return;
        }
        Ui.show(scanBtn, false);
        if (scanner != null && scanner.running()) return;
        if (!camView.isAvailable()) {
            camView.setSurfaceTextureListener(new android.view.TextureView.SurfaceTextureListener() {
                public void onSurfaceTextureAvailable(android.graphics.SurfaceTexture s, int w, int h) {
                    startScanning(false);
                }

                public void onSurfaceTextureSizeChanged(android.graphics.SurfaceTexture s, int w, int h) {
                }

                public boolean onSurfaceTextureDestroyed(android.graphics.SurfaceTexture s) {
                    return true;
                }

                public void onSurfaceTextureUpdated(android.graphics.SurfaceTexture s) {
                }
            });
            return;
        }
        scanner = new CameraScanner(this, new CameraScanner.Listener() {
            @Override
            public void onCode(String text) {
                if (!linkFromText(text)) Ui.setTextSoft(scanState, "■ THAT CODE ISN'T FROM QUEST MIRROR — LOOK AT THE PC");
            }

            @Override
            public void onScanError(String message) {
                scanState.setText("■ CAMERA: " + message.toUpperCase());
                Ui.show(scanBtn, true);
            }
        });
        scanner.start(camView);
        Ui.setTextSoft(scanState, "■ CAMERA ON — LOOK AT YOUR PC SCREEN");
        sendScanHint();
    }

    private void stopScanning() {
        if (scanner != null) scanner.stop();
        scanner = null;
    }

    /** "I'm looking for you": PCs that hear this pop up their big link code on screen. */
    private void sendScanHint() {
        if (System.currentTimeMillis() - lastHintAt < 15000) return;
        lastHintAt = System.currentTimeMillis();
        List<String> targets = new java.util.ArrayList<>();
        for (String[] p : host.nearbyPcs()) targets.add(p[0]);
        if (host.base != null && !targets.contains(host.base)) targets.add(host.base);
        if (!targets.contains(HostClient.LOCAL)) targets.add(HostClient.LOCAL);
        io.execute(() -> {
            for (String b : targets) {
                try {
                    host.request(b, "POST", "/api/pc/scan-hint", obj("device", Build.MODEL), 1500);
                } catch (Exception ignored) {
                }
            }
        });
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != REQ_CAMERA) return;
        if (hasCameraPermission()) startScanning(false);
        else {
            scanState.setText("■ NO CAMERA ACCESS — USE “TAP YOUR PC” BELOW");
            Ui.show(scanBtn, true);
        }
    }

    private volatile boolean linking;

    /**
     * Accepts QM:IP:PORT:CODE (the big on-screen code), http://PC:8765/link?c=CODE and
     * questmirror://pair?h=PC:8765&c=CODE, and links with it.
     */
    private boolean linkFromText(String text) {
        if (text == null) return false;
        String base = null, code = null;
        java.util.regex.Matcher qm = java.util.regex.Pattern.compile("QM:([0-9.]+):(\\d+):(\\d{6})").matcher(text.toUpperCase());
        if (qm.find()) {
            base = "http://" + qm.group(1) + ":" + qm.group(2);
            code = qm.group(3);
        } else {
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("(questmirror://\\S+|https?://\\S+/link\\?\\S+)").matcher(text);
            if (!m.find()) return false;
            Uri u = Uri.parse(m.group(1));
            code = u.getQueryParameter("c");
            if ("questmirror".equals(u.getScheme())) base = u.getQueryParameter("h") == null ? null : "http://" + u.getQueryParameter("h");
            else base = u.getScheme() + "://" + u.getAuthority();
        }
        if (base == null || code == null || !code.matches("\\d{6}")) return false;
        if (linking) return true; // the camera keeps seeing the code while we link
        linking = true;
        final String b = base, c = code;
        Ui.setTextSoft(scanState, "■ CODE FOUND — LINKING…");
        io.execute(() -> {
            try {
                try {
                    host.pairAt(b, c);
                } catch (HostClient.HttpError rejected) {
                    throw rejected; // the PC answered and said no: the cable won't change that
                } catch (java.io.IOException unreachable) {
                    // The Wi-Fi address in the code doesn't answer (Quest on another network, or Wi-Fi off):
                    // the same PC may still be right there over the USB cable.
                    host.pairAt(HostClient.LOCAL, c);
                }
                ui.post(() -> {
                    linking = false;
                    stopScanning();
                    celebrate("LINKED · " + nameOrPc().toUpperCase());
                    stopPairing(null);
                    monitorsAt = 0;
                    refreshNow();
                });
            } catch (HostClient.HttpError e) {
                ui.post(() -> {
                    linking = false;
                    Ui.setTextSoft(scanState, "■ THAT CODE WAS USED UP — KEEP LOOKING, THE PC SHOWS A NEW ONE");
                });
            } catch (Exception e) {
                final String where = b.replace("http://", "");
                ui.post(() -> {
                    linking = false;
                    Ui.setTextSoft(scanState, "■ CAN'T REACH THE PC AT " + where + " — PUT THIS QUEST ON THE SAME WI-FI");
                });
            }
        });
        return true;
    }

    private void startPairing(String base, String name) {
        io.execute(() -> {
            try {
                JSONObject r = host.requestPair(base, Build.MODEL);
                ui.post(() -> {
                    pairBase = base;
                    pairId = r.optString("id");
                    pairName = r.optString("hostName", name);
                    waitCode.setText(r.optString("check"));
                    waitTitle.setText("ALMOST THERE — CHECK " + pairName.toUpperCase());
                    render();
                    ui.removeCallbacks(pairTick);
                    ui.postDelayed(pairTick, 1000);
                });
            } catch (Exception e) {
                ui.post(() -> toast("Can't reach that PC: " + e.getMessage()));
            }
        });
    }

    private final Runnable pairTick = new Runnable() {
        @Override
        public void run() {
            final String base = pairBase, id = pairId;
            if (id == null) return;
            io.execute(() -> {
                String state;
                try {
                    state = host.pollPair(base, id);
                } catch (Exception e) {
                    state = "pending"; // keep trying while the network blips
                }
                final String st = state;
                ui.post(() -> {
                    if (!id.equals(pairId)) return;
                    switch (st) {
                        case "approved":
                            stopPairing(null);
                            celebrate("LINKED · " + nameOrPc().toUpperCase());
                            monitorsAt = 0;
                            refreshNow();
                            break;
                        case "denied":
                            stopPairing("The PC said no");
                            break;
                        case "expired":
                            stopPairing("Request timed out. Try again.");
                            break;
                        default:
                            ui.postDelayed(this, 1000);
                    }
                });
            });
        }
    };

    private void stopPairing(String message) {
        pairId = null;
        pairBase = null;
        ui.removeCallbacks(pairTick);
        if (message != null) toast(message);
        if (nearbyList != null) nearbyList.setTag(null);
        render();
    }

    private void pairWithCode() {
        String code = codeField.getText().toString().trim();
        if (code.length() != 6) {
            toast("Enter the 6 digits shown on the PC");
            return;
        }
        if (addressField.getText().length() > 0) host.setManualAddress(addressField.getText().toString());
        io.execute(() -> {
            try {
                host.pair(code);
                ui.post(() -> {
                    celebrate("LINKED · " + nameOrPc().toUpperCase());
                    monitorsAt = 0;
                    refreshNow();
                });
            } catch (Exception e) {
                ui.post(() -> toast(e.getMessage()));
            }
        });
    }

    // ------------------------------------------------------------------ actions

    private void openScreen(JSONObject m) {
        String id = m.optString("id");
        Intent i = new Intent(this, ScreenActivity.class);
        // One task per monitor: Horizon OS shows each task as its own floating window.
        i.setData(Uri.parse("questmirror://screen/" + id));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_DOCUMENT | Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_LAUNCH_ADJACENT);
        i.putExtra(ScreenActivity.EXTRA_BASES, host.streamBases());
        i.putExtra(ScreenActivity.EXTRA_TOKEN, host.token());
        i.putExtra(ScreenActivity.EXTRA_ID, id);
        i.putExtra(ScreenActivity.EXTRA_NAME, m.optString("name"));
        i.putExtra(ScreenActivity.EXTRA_INDEX, m.optInt("index"));
        i.putExtra(ScreenActivity.EXTRA_KBPS, Integer.parseInt(prefs.getString("pcQuality", "12000")));
        i.putExtra(ScreenActivity.EXTRA_FPS, Integer.parseInt(prefs.getString("pcFps", "60")));
        i.putExtra(ScreenActivity.EXTRA_MAXW, 1920);
        startActivity(i);
    }

    private void openAll() {
        for (int i = 0; i < monitors.length(); i++) {
            final JSONObject m = monitors.optJSONObject(i);
            if (m != null) ui.postDelayed(() -> openScreen(m), i * 700L);
        }
    }

    private boolean optSetting(String key) {
        JSONObject set = status != null ? status.optJSONObject("settings") : null;
        return set != null && set.optBoolean(key);
    }

    private void setSetting(String key, Object value) {
        post("/api/settings", obj(key, value), null);
    }

    private void post(String path, JSONObject body, String okMessage) {
        io.execute(() -> {
            try {
                host.post(path, body);
                if (okMessage != null) ui.post(() -> toast(okMessage));
            } catch (Exception e) {
                ui.post(() -> toast(e.getMessage()));
            }
            ui.post(this::refreshNow);
        });
    }

    private static JSONObject obj(String k, Object v) {
        JSONObject o = new JSONObject();
        try {
            o.put(k, v);
        } catch (Exception ignored) {
        }
        return o;
    }

    private void toast(String s) {
        Toast.makeText(this, s, Toast.LENGTH_LONG).show();
    }
}
