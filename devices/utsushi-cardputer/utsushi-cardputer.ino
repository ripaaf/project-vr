// UTSUSHI-LINK for the M5Stack Cardputer and Cardputer ADV.
//
// The same line protocol as utsushi-link.ino (ping, info, rgb, beep, print ...), plus:
//   - its keyboard types into whatever is focused in UTSUSHI Space (sends "key <c>" lines)
//   - "print <text>" shows the text big on its screen
//   - "led on|off" lights the RGB LED white / off
//
// Board for arduino-cli: esp32:esp32:m5stack_cardputer  (library: M5Cardputer ≥ 1.1, which also
// drives the ADV's keyboard). Set "USB CDC On Boot: Enabled" so it talks over the USB-C cable.

#include <M5Cardputer.h>

static const char *FW = "utsushi-link/1.0";
static const int RGB_PIN = 21;  // the WS2812 next to the screen on both Cardputers

// the space's palette (RGB565 via color888)
static uint16_t C_BG, C_INK, C_INK2, C_INK3, C_SEAL, C_GOLD, C_MOSS;

static String line;          // incoming serial line
static String shown = "";    // the last "print"
static String log4[4];       // last replies, newest last
static String typed;         // what you are typing here (echo only)
static bool linked = false;  // heard from the PC at least once
static uint32_t lastHeard = 0;

static void addLog(const String &s) {
  for (int i = 0; i < 3; i++) log4[i] = log4[i + 1];
  log4[3] = s;
}

static void draw() {
  auto &d = M5Cardputer.Display;
  d.startWrite();
  d.fillScreen(C_BG);
  // title row: seal square, wordmark, link state
  d.fillRect(8, 9, 7, 7, C_SEAL);
  d.setFont(&fonts::Font0);
  d.setTextSize(1);
  d.setTextColor(C_INK, C_BG);
  d.setTextDatum(top_left);
  d.drawString("UTSUSHI  LINK", 21, 9);
  bool fresh = linked && millis() - lastHeard < 15000;
  d.setTextColor(fresh ? C_MOSS : C_INK3, C_BG);
  d.setTextDatum(top_right);
  d.drawString(fresh ? "linked" : "waiting for the space", d.width() - 8, 9);
  d.drawFastHLine(8, 24, 60, C_GOLD);
  // the message
  d.setTextDatum(middle_left);
  d.setTextColor(C_INK, C_BG);
  if (shown.length()) {
    d.setFont(&fonts::FreeSerifBold12pt7b);
    String s = shown.length() > 18 ? shown.substring(0, 17) + "~" : shown;
    d.drawString(s, 10, 50);
  } else {
    d.setFont(&fonts::FreeSerif9pt7b);
    d.setTextColor(C_INK2, C_BG);
    d.drawString("open DEVICES in the space", 10, 50);
  }
  // log
  d.setFont(&fonts::Font0);
  d.setTextDatum(top_left);
  for (int i = 0; i < 4; i++) {
    d.setTextColor(i == 3 ? C_INK2 : C_INK3, C_BG);
    d.drawString(log4[i].substring(0, 38), 10, 72 + i * 10);
  }
  // typing line
  d.drawFastHLine(8, 117, d.width() - 16, C_INK3);
  d.setTextColor(C_SEAL, C_BG);
  d.drawString(">", 10, 122);
  d.setTextColor(C_INK, C_BG);
  String t = typed.length() > 34 ? typed.substring(typed.length() - 34) : typed;
  d.drawString(t + "_", 20, 122);
  d.endWrite();
}

static void reply(const String &s) {
  Serial.println(s);
  addLog(s);
}

static void rgb(int r, int g, int b) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  rgbLedWrite(RGB_PIN, r, g, b);
#else
  neopixelWrite(RGB_PIN, r, g, b);
#endif
}

static void handle(String cmd) {
  cmd.trim();
  if (!cmd.length()) return;
  linked = true;
  lastHeard = millis();
  int sp = cmd.indexOf(' ');
  String op = sp < 0 ? cmd : cmd.substring(0, sp);
  String rest = sp < 0 ? "" : cmd.substring(sp + 1);
  rest.trim();
  op.toLowerCase();

  if (op == "ping") {
    reply("pong");
  } else if (op == "info") {
    reply(String("info board=cardputer fw=") + FW + " caps=print,beep,rgb,led,keys,screen");
  } else if (op == "help") {
    reply("cmds ping info led rgb beep print help");
  } else if (op == "led") {
    bool on = rest != "off";
    rgb(on ? 60 : 0, on ? 60 : 0, on ? 60 : 0);
    reply(String("ok led ") + (on ? "on" : "off"));
  } else if (op == "rgb") {
    int r = 0, g = 0, b = 0;
    if (sscanf(rest.c_str(), "%d %d %d", &r, &g, &b) != 3) return reply("err rgb <r> <g> <b>");
    // the LED is very bright: a quarter is plenty
    rgb(constrain(r, 0, 255) / 4, constrain(g, 0, 255) / 4, constrain(b, 0, 255) / 4);
    reply("ok rgb " + rest);
  } else if (op == "beep") {
    int hz = 880, ms = 120;
    sscanf(rest.c_str(), "%d %d", &hz, &ms);
    M5Cardputer.Speaker.tone(hz, ms);
    reply("ok beep");
  } else if (op == "print") {
    shown = rest;
    M5Cardputer.Speaker.tone(1320, 40);
    reply("ok print");
  } else {
    reply("err unknown command: " + op);
  }
  draw();
}

static void sendKey(const String &k) {
  Serial.println("key " + k);
}

void setup() {
  auto cfg = M5.config();
  M5Cardputer.begin(cfg, true);
  auto &d = M5Cardputer.Display;
  d.setRotation(1);
  C_BG = d.color888(14, 14, 15);
  C_INK = d.color888(236, 229, 214);
  C_INK2 = d.color888(169, 162, 150);
  C_INK3 = d.color888(109, 104, 95);
  C_SEAL = d.color888(226, 71, 44);
  C_GOLD = d.color888(208, 170, 95);
  C_MOSS = d.color888(140, 152, 116);
  M5Cardputer.Speaker.setVolume(90);
  Serial.begin(115200);
  rgb(0, 0, 0);
  addLog("hello utsushi-link");
  draw();
  Serial.println("hello utsushi-link");
}

void loop() {
  M5Cardputer.update();
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (line.length()) handle(line);
      line = "";
    } else if (line.length() < 200) {
      line += c;
    }
  }
  // keyboard → the space
  if (M5Cardputer.Keyboard.isChange() && M5Cardputer.Keyboard.isPressed()) {
    auto st = M5Cardputer.Keyboard.keysState();
    bool spaceSent = false;
    for (char c : st.word) {
      if (c == ' ') {
        sendKey("space");
        spaceSent = true;
        typed += ' ';
      } else {
        sendKey(String(c));
        typed += c;
      }
    }
    if (st.space && !spaceSent) {
      sendKey("space");
      typed += ' ';
    }
    if (st.del) {
      sendKey("del");
      if (typed.length()) typed.remove(typed.length() - 1);
    }
    if (st.enter) {
      sendKey("enter");
      typed = "";
    }
    M5Cardputer.Speaker.tone(2200, 6);
    draw();
  }
  // refresh the link badge now and then
  static uint32_t lastDraw = 0;
  if (millis() - lastDraw > 5000) {
    lastDraw = millis();
    draw();
  }
  delay(2);
}
