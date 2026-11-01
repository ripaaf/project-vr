# UTSUSHI-LINK firmware

Two small sketches that let you control a board from **DEVICES (機器)** in UTSUSHI Space. The board
plugs into the **PC** by USB. The host on the PC opens the serial port, and the space sends it one
line per command.

| Folder | Board | What it does |
|---|---|---|
| `utsushi-link/` | Any ESP32: classic, S3, C3 … | Built-in LED, RGB LED (if the board has one), any GPIO, analog read, PWM, buzzer |
| `utsushi-cardputer/` | M5Stack Cardputer and Cardputer ADV | Shows your messages on its screen, beeps, lights its RGB LED, and **its keyboard types into the space** |

## Flash

With [arduino-cli](https://arduino.github.io/arduino-cli/) and the `esp32:esp32` core installed:

```bash
arduino-cli compile -b esp32:esp32:esp32 utsushi-link
```

```bash
arduino-cli upload -b esp32:esp32:esp32 -p COM5 utsushi-link
```

For a Cardputer or Cardputer ADV, first install the M5Cardputer library (version 1.1 or newer, which also supports the ADV keyboard):

```bash
arduino-cli lib install M5Cardputer
```

```bash
arduino-cli compile -b esp32:esp32:m5stack_cardputer utsushi-cardputer
```

```bash
arduino-cli upload -b esp32:esp32:m5stack_cardputer -p COM5 utsushi-cardputer
```

Replace `COM5` with your board's port. Windows lists it in Device Manager under *Ports (COM & LPT)*, and the DEVICES panel shows it too.
Boards with a USB-serial chip appear as CP210x, CH340 or FTDI. Native-USB boards (S3 and the Cardputer) appear as an Espressif device.

## Use it

1. In the space, open the dock and choose **機器 devices**.
2. Pick the port. A ◆ marks the ports that look like a board.
3. Leave the speed at 115200 and press **connect**.
4. The panel sends `info`, and the core tells you which board answered.
5. Try the quick buttons: ping, led on/off, beep, the colour swatches, and hello.
6. On the Cardputer, whatever you type goes to the focused panel: the terminal, a PC screen, or the devices console.

## Protocol

There is one command per line at 115200 baud, and the board answers each one with one line.

```
ping                  -> pong
info                  -> info board=<name> fw=utsushi-link/1.0 caps=led,pin,...
led on|off|toggle     -> ok led on
rgb <r> <g> <b>       -> ok rgb 226 71 44
pin <n> high|low      -> ok pin 4 high
read <n>              -> val 4 1
aread <n>             -> aval 34 2048
pwm <n> <0..255>      -> ok pwm 4 128
beep <hz> <ms>        -> ok beep          (generic sketch: set BUZZER_PIN first)
print <text>          -> ok print ...
help                  -> cmds ...
```

The Cardputer also sends `key <c>` on its own, where `<c>` is a character or one of `space`, `del`
or `enter`. Any other firmware still works in the panel as a plain serial console.
