# QUEST/MIRROR

Dua arah, satu aplikasi:

1. **PC kamu melayang di Quest**: layar PC (plus suaranya) muncul sebagai jendela melayang di headset. Bisa dipindah & di-resize pakai tangan, dan PC-nya dikontrol pakai tangan (tunjuk = mouse, pinch = klik).
2. **Quest ke layar apa pun**: apa yang kamu lihat di Quest bisa ditonton di HP / TV / laptop lewat browser, dan bisa dikontrol dari sana.

Semua jalan **tanpa controller** dan **tanpa kabel** setelah setup awal. Tampilan bergaya *technical paper / HUD* (referensi di `contoh_gambar/`), ada mode **PAPER** (terang) dan **NIGHT** (gelap).

```
┌──────────── PC (Windows) ─────────────┐        Wi-Fi / USB        ┌──────── Meta Quest ────────┐
│ Quest Mirror (tray) → host (Node.js)  │ ── layar PC (H.264) ─────▶ │ App "Quest Mirror"         │
│  • layar PC: GPU (ddagrab + NVENC)    │ ── suara PC (PCM) ───────▶ │  • jendela "Screen 1, 2…"  │
│  • suara PC: WASAPI loopback          │ ◀── mouse/keyboard ─────── │  • panel kontrol (tangan)  │
│  • tampilan Quest (adb screenrecord)  │ ◀── tampilan Quest ─────── │  • link: lihat layar PC    │
│  • dashboard + viewer untuk HP/TV     │                            └────────────────────────────┘
└───────────────┬───────────────────────┘
                └──▶ browser di HP / TV / laptop: http://IP-PC:8765
```

---

## Install di PC: satu file

Dobel-klik **`QuestMirror-Setup.exe`** (ada di `windows-app\build\`). Tidak ada wizard dan tidak butuh admin: langsung terpasang, lalu Quest Mirror terbuka.

Yang dipasang:
- **Semuanya sudah di dalam**: Node.js, ffmpeg, adb, host, dan app Quest. Tidak perlu install apa pun lagi.
- **Jendela app sendiri** "Quest Mirror" (tanpa tab, tanpa address bar).
- **Ikon di tray**. Klik untuk membuka. Klik kanan untuk *Start with Windows*, *Restart*, *Show log*, *Quit*. Tray juga memberi notifikasi tiap ada langkah berikutnya (Quest tercolok, tekan Allow, app terpasang, linked).
- **Mulai bersama Windows** (bisa dimatikan dari tray atau dashboard), dan shortcut di Start Menu + Desktop.
- Lokasi: `%LOCALAPPDATA%\Programs\Quest Mirror`. Pengaturan disimpan di `%APPDATA%\QuestMirror` (tetap ada walau di-install ulang).
- Hapus lewat **Settings Windows → Apps → Quest Mirror → Uninstall**.

> Satu-satunya prompt yang tidak bisa dilewati: saat pertama jalan, **Windows Firewall** bertanya soal akses jaringan. Tekan **Allow**, supaya Quest dan TV bisa menjangkau PC lewat Wi-Fi.

Membuat ulang `QuestMirror-Setup.exe` (misalnya setelah mengubah kode): dobel-klik **`build-windows-app.bat`**. Yang dipakai hanya compiler C# bawaan Windows (.NET 4.8), plus Node.js / ffmpeg / adb yang ada di PC ini, dan semuanya ikut dibungkus.

Di Quest: **Developer Mode** aktif (app Meta Horizon di HP → Devices → Developer Mode).

---

## Setup pertama kali (± 1 menit, sekali saja)

1. Jalankan **`QuestMirror-Setup.exe`**. Kalau Windows Firewall bertanya → **Allow**.
2. Colok Quest ke PC pakai USB → di headset tekan **Allow** (centang *Always allow*).
3. **App Quest terpasang sendiri** ke headset dalam beberapa detik, tanpa tombol. Kalau nanti ada versi baru, app di headset juga ter-update sendiri.
4. Di Quest buka **Library → Unknown Sources → Quest Mirror** → **lihat layar PC**. PC memunculkan kode besar di depan, dan app langsung ter-link.

Selesai (*READY TO GO*). Selama kabel tercolok, host **otomatis pindah ke Wi-Fi**. Cabut kabel kapan saja.

> ⚠️ Setelah Quest **restart**, Wi-Fi ADB mati (aturan Android). Colok kabel sekali → otomatis pindah lagi ke Wi-Fi → cabut. Tidak perlu klik apa pun.
> Fitur **PC di Quest** tidak butuh ADB sama sekali, jadi tetap jalan lewat Wi-Fi biasa.

### Tanpa installer (untuk pengembangan)

| Di PC | Keterangan |
|---|---|
| Windows 10/11 | Fitur "PC di Quest" + suara butuh Windows. Mirroring Quest→layar juga jalan di Mac/Linux. |
| [Node.js](https://nodejs.org) 18+ | Menjalankan host. Tanpa `npm install`, tanpa dependency. |
| [ffmpeg](https://www.gyan.dev/ffmpeg/builds/) 6+ | Butuh `ddagrab`. Taruh di PATH atau `C:\ffmpeg\bin`. |
| [adb (platform-tools)](https://developer.android.com/tools/releases/platform-tools) | Untuk install app & fitur Quest→layar. Taruh di PATH atau `C:\adb`. |

Lalu dobel-klik **`start.bat`**, dan dashboard terbuka di browser. Android SDK + JDK hanya perlu kalau mau **build ulang** app Quest (`build-quest-app.bat`).

---

## Link app Quest ke PC (pilih salah satu, tanpa ngetik)

| Cara | Langkah |
|---|---|
| **◎ Lihat layar PC** (paling cepat) | App Quest → **Show my PC here**. Kamera headset langsung menyala dan memberi tahu PC. PC memunculkan **kode besar** di depan semua jendela. Cukup lihat layar PC dari jarak ±0,5–1,5 m, link terjadi sendiri (✓ *LINKED*). Kode besar juga bisa dibuka manual: kartu *NEXT STEP* → **Show the big code**, atau SETTINGS → *Link the Quest app*. |
| **Connect → Allow** | Di bawahnya (*OR TAP YOUR PC*) muncul PC yang ada di Wi-Fi yang sama. Tekan **Connect →**, lalu di PC muncul *INCOMING LINK REQUEST*. Cocokkan kode 4 digit, klik **Allow**. |
| Kabel | Kalau Quest tercolok/terhubung ADB, app ter-link sendiri, kecuali kamu pernah **Unlink** (setelah itu link ulang harus disengaja). |
| Kode 6 digit | Cadangan: ketik kode dari dashboard di app Quest. Bisa juga isi alamat PC manual. |

Kode besar & kode 6 digit **sekali pakai**, langsung berganti setelah dipakai. Kamera hanya menyala selama app belum ter-link dan halaman *Show my PC here* terbuka; begitu ter-link, kamera langsung mati.

### Putuskan (Unlink)
Dari app Quest (**⚙ Settings → Connection → Unlink this PC**) atau dashboard (**SETTINGS → Link the Quest app → Unlink the Quest**). Putusnya beneran:
- token lama langsung tidak berlaku, termasuk lewat kabel;
- video, suara, dan input PC berhenti saat itu juga;
- jendela PC di Quest menampilkan *Unlinked* lalu menutup sendiri;
- dashboard langsung menampilkan *not linked*;
- tidak ada link ulang otomatis.

---

## App di Quest: link dulu, baru pilih

Alurnya selalu sama:

1. **STEP 1 // Link your PC**: muncul selama app belum ter-link. Kamera menyala, kamu cukup melihat layar PC. Cadangannya **Tap your PC** (Connect → Allow) atau kode 6 digit. Belum ada pilihan lain sebelum ter-link.
2. **STEP 2 // What do you want to do?**: muncul otomatis setelah *LINKED ✓*.
   - **Show my PC here**: layar PC melayang di depanmu.
   - **Share what I see**: dapat link untuk ditonton di TV / HP / laptop.

Kalau link diputus (dari app atau dari PC), app kembali ke step 1 dengan sendirinya. Tombol **← Back** kembali ke step 2.

**⚙ Settings** (pojok kanan atas, selalu di tempat yang sama) adalah satu-satunya tempat pengaturan:

| Bagian | Isi |
|---|---|
| **A · Your PC in the Quest** | kualitas gambar, 30/60/72 fps, suara PC di headset |
| **B · Sharing what you see** | mata kiri/kanan/keduanya, kualitas, izin kontrol penonton, keep awake, koreksi lensa, panel control |
| **C · Connection** | PC yang ter-link, status kabel/Wi-Fi/baterai, **Unlink this PC** |
| **D · Look** | ☀ Paper / ☾ Night |

## 1) PC di Quest

App Quest → **Show my PC here** → **Open →** (atau **Open all screens** kalau monitornya lebih dari satu). Tiap monitor jadi jendela sendiri. Pertama kali dibuka, muncul petunjuk singkat cara pakai tangan.

| Tangan di jendela PC | Hasil di PC |
|---|---|
| Menunjuk | Kursor mouse ikut |
| Pinch | Klik kiri |
| Pinch & tahan ±0,6 detik | Klik kanan |
| Pinch & geser | Scroll (**↕ Scroll**) / drag-and-drop (**✥ Drag**) |
| **◩ R-Click** | Pinch berikutnya = klik kanan |
| **⌨ Keys** | Ketik langsung ke PC + Enter, ⌫, Tab, Esc, panah, Win, Ctrl+C/V/Z, Alt+Tab |
| **♪ Sound** | Suara PC di headset on/off |

Pindah jendela: pinch bar di bawah jendela lalu geser. Resize: tarik sudutnya. Horizon OS mengingat posisi jendela (taruh misalnya di dinding di atas meja). Keyboard Bluetooth yang di-pair ke Quest langsung ngetik ke PC.

**Kualitas** (⚙ Settings → A): Light / Balanced / Sharp (6 / 12 / 25 Mbps) dan 30 / 60 / 72 fps. Untuk hotspot HP / Wi-Fi 2.4 GHz pakai *Balanced* atau *Light*.

**Suara PC**: otomatis main di headset selama ada jendela PC terbuka (latensi ±100–150 ms). Volume ikut volume Windows. Matikan lewat **♪** atau *PC sound in the headset* di app.

### Mau banyak layar (layar virtual)?
Windows butuh *driver monitor virtual*. Pasang sendiri salah satu:
- **Virtual Display Driver** (gratis, open source): https://github.com/VirtualDrivers/Virtual-Display-Driver
- atau **Parsec VDD**.

Tambah 1–3 monitor virtual (mis. 1920×1080), atur posisinya di *Settings → Display* Windows, lalu di app Quest tekan **Open all screens**. Monitor baru muncul otomatis.

---

## 2) Quest ke layar apa pun

Di HP / TV / laptop satu Wi-Fi, buka alamat di dashboard / app Quest (contoh `10.191.76.13:8765`) atau scan QR di *03 Watch on another screen*.

- **SETTINGS → Picture**: L-EYE / R-EYE / STEREO, kualitas, zoom & geser framing, *Straighten lens distortion*. Bar atas hanya berisi aksi cepat (screenshot, fullscreen, Remote, Settings).
- 📷 screenshot, ⛶ fullscreen (`F`). Bar atas & HUD hilang sendiri setelah 3,5 detik (bersih di TV).
- **🎮 Remote**: dial D-pad, Back, Home, volume, play/pause (keyboard laptop juga bisa). Volume diatur lewat app Quest (Horizon OS mengabaikan tombol volume dari luar), jadi app Quest perlu terpasang.
- **Apps** buka/tutup aplikasi Quest · **Type** kirim teks / buka URL · **Panels** kontrol app 2D (klik/scroll/ketik) dengan gambar datar & tajam (butuh *panel control*).

Catatan: di dalam game VR, Quest hanya mendengar tangan/controller asli; kontrol jarak jauh paling berguna di menu & app 2D.

### Privasi
- App Quest: *Let viewers control the headset* bisa dimatikan kapan saja.
- **Pause sharing** menghentikan capture total.
- Dashboard → *Viewer PIN*: penonton wajib masukkan PIN.

---

## Tampilan
- Dashboard / viewer: **SETTINGS** → paling bawah **LOOK: ☀ PAPER / ☾ NIGHT** (tersimpan per perangkat).
- App Quest: **⚙ Settings → D · Look**.
- Semua bergerak halus: panel & menu meluncur masuk/keluar, bagian lipat membuka dengan animasi, status “live” berdenyut, langkah setup tercentang otomatis.
- Dashboard: **SETTINGS** berisi kartu *NEXT STEP / READY TO GO* di atas, sisanya dilipat (**Link the Quest app**, **Share link**, **Picture**, **Privacy**, **Connection**) dengan ringkasan satu baris.

---

## Keamanan
- Layar, suara & input PC hanya untuk app Quest yang sudah di-link (token rahasia di `host/config.json`). Link butuh salah satu: kamu klik **Allow** di PC, scan QR dari layar PC, kode sekali pakai, atau kabel/ADB. Kode salah dibatasi 8×/menit.
- Agent di Quest hanya mendengar `127.0.0.1` (lewat `adb forward`).
- Semua lalu lintas di jaringan lokal, tanpa cloud. Jangan dipakai di Wi-Fi publik.
- Jendela "Run as administrator" / UAC tidak bisa dikontrol dari Quest (pembatasan Windows).

---

## Troubleshooting

| Masalah | Solusi |
|---|---|
| *Allow USB debugging* | Pakai headset, centang *Always allow*, tekan Allow. |
| Gambar Quest hitam / *RESTING* | Quest berhenti menggambar kalau tidak dipakai atau diam di meja. Ini bukan bug, dan software tidak bisa memaksanya. Dashboard lalu menampilkan *THE HEADSET IS RESTING*. Pakai atau angkat headset, gambar kembali sendiri. |
| *NO SIGNAL* | Headset tidur total. Pakai headset, atau nyalakan **Keep awake**. |
| App Quest tidak menemukan PC | `start.bat` jalan? Satu Wi-Fi? Izinkan Node.js di firewall. Atau pakai **Scan QR** / alamat manual. |
| Gambar Quest hitam / *HIDDEN* (headset sedang dipakai) | Horizon OS menghitamkan seluruh rekaman selama ada panel sistem yang privat, misalnya notifikasi, dialog izin, atau keyboard. Kadang panel itu "nyangkut" walau sudah tidak terlihat. Tutup panelnya. Kalau tetap hitam, **restart Quest** (tahan tombol power → Restart); host otomatis menyambung lagi. |
| *CAN'T REACH THE PC* waktu link | Quest dan PC beda Wi-Fi. Samakan Wi-Fi-nya, atau colok kabel USB (link otomatis lewat kabel). |
| Kamera tidak menemukan kode | Izin kamera sudah diberikan? Kalau belum, tekan **Start camera**. Pastikan kode besar terlihat penuh (tidak tertutup kabel atau pantulan lampu), dari jarak ±0,5–1,5 m. Kalau masih gagal, pakai **Connect → Allow**. |
| Dashboard terlihat aneh setelah update | Tab dashboard yang terbuka me-reload sendiri saat host diperbarui. Kalau tidak, tekan F5. |
| Layar PC patah-patah | *Light* / 30 fps, atau Wi-Fi 5/6 GHz. |
| Suara PC tidak ada | Volume Windows tidak mute? Tombol **♪** aktif? Output default Windows = speaker yang kamu pakai. |
| Setelah Quest restart tidak connect | Colok kabel sekali (pindah ke Wi-Fi otomatis), lalu cabut. |
| `ffmpeg not found` / `adb not found` | Install, atau set `FFMPEG` / `ADB` ke path exe-nya. |

---

## Struktur project

```
start.bat                 jalankan host + buka dashboard (mode pengembangan)
build-quest-app.bat       build ulang & install app Quest
build-windows-app.bat     buat windows-app\build\QuestMirror-Setup.exe
windows-app/
  src/App.cs              QuestMirror.exe: tray, menjalankan host, jendela app, notifikasi, uninstall
  src/Installer.cs        QuestMirror-Setup.exe: install satu klik (tanpa admin), shortcut, Start with Windows
  src/Brand.cs            logo & warna (digambar dari kode, juga jadi ikon .exe)
  build.ps1               compile (csc bawaan Windows) + bungkus Node/ffmpeg/adb/host/APK
contoh_gambar/            referensi gaya visual
host/
  server.js               HTTP server, API, halaman /link (QR)
  lib/adb.js              deteksi Quest (USB/Wi-Fi), auto Wi-Fi, tunnel, input
  lib/capture.js          screenrecord Quest → ffmpeg (crop mata + koreksi lensa) → MJPEG
  lib/mjpeg.js            kirim frame ke banyak penonton (frame lama di-skip)
  lib/control.js          tombol, teks, app, URL, keep-awake, jembatan ke agent Quest
  lib/pcscreen.js         layar PC → Quest (ddagrab + NVENC/AMF/QSV/x264), input, pairing, discovery
  lib/pcaudio.js          suara PC → Quest (satu capture, dibagi ke semua pendengar)
  lib/winaudio.ps1        helper Windows: WASAPI loopback → PCM 16-bit
  lib/wininput.ps1        helper Windows: daftar monitor (DXGI), SendInput, memunculkan jendela kode ke depan
  lib/autostart.js        shortcut "Start with Windows"
  public/                 dashboard/viewer (HTML/CSS/JS tanpa library) + QR generator
quest-app/
  src/…/MainActivity      panel utama (link PC, layar, share Quest)
  src/…/CameraScanner     kamera passthrough headset → QrDecoder (pembaca QR tanpa library)
  src/…/ScreenActivity    jendela per monitor PC (decoder H.264 hardware + input tangan)
  src/…/PcStream/PcAudio  video & suara PC
  src/…/Ui                design system: cut corners, grid, switch, ring, tema PAPER/NIGHT
  src/…/ControlService    accessibility: klik/scroll/ketik di app 2D, screenshot panel
  build.ps1               build APK pakai Android SDK (tanpa Gradle)
```

Port: `8765` (HTTP), `8766` (agent Quest via adb forward), `8767/udp` (PC mengumumkan diri di Wi-Fi).
