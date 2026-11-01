// UTSUSHI-LINK — firmware for any ESP32 board, so the DEVICES panel in UTSUSHI Space can drive it.
//
// Plug the board into the PC, flash this, then in the space open DEVICES (機器), pick the port and
// press connect. One command per line at 115200 baud; every reply is one line too:
//
//   ping                  -> pong
//   info                  -> info board=<name> fw=utsushi-link/1.0 caps=...
//   led on|off|toggle     -> ok led on|off      (the on-board LED)
//   rgb <r> <g> <b>       -> ok rgb ...         (the on-board RGB LED, if the board has one)
//   pin <n> high|low      -> ok pin <n> high    (any free GPIO)
//   read <n>              -> val <n> 0|1        (digital input with pull-up)
//   aread <n>             -> aval <n> <0..4095> (analog input)
//   pwm <n> <0..255>      -> ok pwm <n> <duty>
//   beep <hz> <ms>        -> ok beep            (needs BUZZER_PIN below)
//   print <text>          -> ok print           (echoed back, handy for testing)
//   help                  -> the list above
//
// Board choices for arduino-cli: esp32:esp32:esp32 (classic), esp32:esp32:esp32s3, esp32:esp32:esp32c3 ...

#ifndef BUZZER_PIN
#define BUZZER_PIN -1  // set to the GPIO of a passive buzzer, e.g. 25
#endif

#if defined(LED_BUILTIN)
static const int LED_PIN = LED_BUILTIN;
#else
static const int LED_PIN = 2;  // most ESP32 dev boards
#endif

static const char *FW = "utsushi-link/1.0";
static bool ledOn = false;
static String line;

static void reply(const String &s) {
  Serial.println(s);
}

static void setLed(bool on) {
  ledOn = on;
  digitalWrite(LED_PIN, on ? HIGH : LOW);
}

static void setRgb(int r, int g, int b) {
#if defined(RGB_BUILTIN)
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  rgbLedWrite(RGB_BUILTIN, r, g, b);
#else
  neopixelWrite(RGB_BUILTIN, r, g, b);
#endif
  reply("ok rgb " + String(r) + " " + String(g) + " " + String(b));
#else
  (void)r;
  (void)g;
  (void)b;
  reply("err this board has no RGB LED");
#endif
}

static String caps() {
  String c = "led,pin,read,aread,pwm,print";
#if defined(RGB_BUILTIN)
  c += ",rgb";
#endif
  if (BUZZER_PIN >= 0) c += ",beep";
  return c;
}

static void handle(String cmd) {
  cmd.trim();
  if (!cmd.length()) return;
  int sp = cmd.indexOf(' ');
  String op = sp < 0 ? cmd : cmd.substring(0, sp);
  String rest = sp < 0 ? "" : cmd.substring(sp + 1);
  rest.trim();
  op.toLowerCase();

  if (op == "ping") {
    reply("pong");
  } else if (op == "info") {
#if defined(ARDUINO_BOARD)
    String board = ARDUINO_BOARD;
#else
    String board = "esp32";
#endif
    board.replace(' ', '-');
    reply("info board=" + board + " fw=" + FW + " caps=" + caps());
  } else if (op == "help") {
    reply("cmds ping info led rgb pin read aread pwm beep print help");
  } else if (op == "led") {
    if (rest == "on") setLed(true);
    else if (rest == "off") setLed(false);
    else if (rest == "toggle" || rest == "") setLed(!ledOn);
    else return reply("err led on|off|toggle");
    reply(String("ok led ") + (ledOn ? "on" : "off"));
  } else if (op == "rgb") {
    int r = 0, g = 0, b = 0;
    if (sscanf(rest.c_str(), "%d %d %d", &r, &g, &b) != 3) return reply("err rgb <r> <g> <b>");
    setRgb(constrain(r, 0, 255), constrain(g, 0, 255), constrain(b, 0, 255));
  } else if (op == "pin") {
    int n = -1;
    char lvl[8] = {0};
    if (sscanf(rest.c_str(), "%d %7s", &n, lvl) != 2 || n < 0) return reply("err pin <n> high|low");
    bool high = String(lvl) == "high" || String(lvl) == "1";
    pinMode(n, OUTPUT);
    digitalWrite(n, high ? HIGH : LOW);
    reply("ok pin " + String(n) + (high ? " high" : " low"));
  } else if (op == "read") {
    int n = rest.toInt();
    pinMode(n, INPUT_PULLUP);
    reply("val " + String(n) + " " + String(digitalRead(n)));
  } else if (op == "aread") {
    int n = rest.toInt();
    reply("aval " + String(n) + " " + String(analogRead(n)));
  } else if (op == "pwm") {
    int n = -1, duty = 0;
    if (sscanf(rest.c_str(), "%d %d", &n, &duty) != 2 || n < 0) return reply("err pwm <n> <0..255>");
    analogWrite(n, constrain(duty, 0, 255));
    reply("ok pwm " + String(n) + " " + String(duty));
  } else if (op == "beep") {
    if (BUZZER_PIN < 0) return reply("err no buzzer (set BUZZER_PIN in the sketch)");
    int hz = 880, ms = 120;
    sscanf(rest.c_str(), "%d %d", &hz, &ms);
    tone(BUZZER_PIN, hz, ms);
    reply("ok beep");
  } else if (op == "print") {
    reply("ok print " + rest);
  } else {
    reply("err unknown command: " + op + " (try help)");
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  setLed(false);
  delay(200);
  reply("hello utsushi-link");
}

void loop() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (line.length()) handle(line);
      line = "";
    } else if (line.length() < 200) {
      line += c;
    }
  }
  delay(1);
}
