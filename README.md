# UTSUSHI/写し

*Utsushi* (写し) artinya "pantulan / salinan". Dulu namanya **Quest Mirror**; nama internal (folder install, package `com.questmirror.app`) tetap sama supaya update tidak memutus apa pun.

Tiga hal dalam satu aplikasi:

1. **PC kamu melayang di Quest**: layar PC (plus suaranya) muncul sebagai jendela melayang di headset. Bisa dipindah & di-resize pakai tangan, dan PC-nya dikontrol pakai tangan (tunjuk = mouse, pinch = klik).
2. **Quest ke layar apa pun**: apa yang kamu lihat di Quest bisa ditonton di HP / TV / laptop lewat browser, dan bisa dikontrol dari sana.
3. **UTSUSHI Space**: ruang imersif ala "Jarvis" di sekelilingmu. Isinya layar PC, terminal Linux ke headset, kontrol ESP32 / Cardputer, objek 3D, dan foto yang diambil dengan gerakan jari (⌜⌟ atau 👈👉). Ada 13 gesture tangan. Lihat [bagian 3](#3-utsushi-space-ruang-imersif).

Semua jalan **tanpa controller** dan **tanpa kabel** setelah setup awal. Tampilan bergaya *technical paper / HUD* (referensi visual di `contoh_gambar/`, hanya lokal, tidak ikut di repo), ada mode **PAPER** (terang) dan **NIGHT** (gelap).

```
┌──────────── PC (Windows) ─────────────┐        Wi-Fi / USB        ┌──────── Meta Quest ────────┐
│ UTSUSHI (tray) → host (Node.js)       │ ── layar PC (H.264) ─────▶ │ App "UTSUSHI"              │
│  • layar PC: GPU (ddagrab + NVENC)    │ ── suara PC (PCM) ───────▶ │  • jendela "Screen 1, 2…"  │
│  • suara PC: WASAPI loopback          │ ◀── mouse/keyboard ─────── │  • panel kontrol (tangan)  │
│  • tampilan Quest (adb screenrecord)  │ ◀── tampilan Quest ─────── │  • link: lihat layar PC    │
│  • dashboard + viewer untuk HP/TV     │                            └────────────────────────────┘
└───────────────┬───────────────────────┘
                └──▶ browser di HP / TV / laptop: http://IP-PC:8765
```

---

## Install di PC: satu file

Dobel-klik **`UTSUSHI-Setup.exe`** (ada di `windows-app\build\`). Tidak ada wizard dan tidak butuh admin: langsung terpasang, lalu UTSUSHI terbuka. Kalau versi lama (Quest Mirror) sudah terpasang, installer ini meng-update-nya di tempat dan mengganti shortcut lamanya.

Yang dipasang:
- **Semuanya sudah di dalam**: Node.js, ffmpeg, adb, host, dan app Quest. Tidak perlu install apa pun lagi.
- **Jendela app sendiri** "UTSUSHI" (tanpa tab, tanpa address bar).
- **Ikon di tray** (ensō dengan cap merah). Klik untuk membuka. Klik kanan untuk *Open the space on the headset*, *Start with Windows*, *Restart*, *Show log*, *Quit*. Tray juga memberi notifikasi tiap ada langkah berikutnya (Quest tercolok, tekan Allow, app terpasang, linked).
- **Mulai bersama Windows** (bisa dimatikan dari tray atau dashboard), dan shortcut di Start Menu + Desktop.
- Lokasi: `%LOCALAPPDATA%\Programs\Quest Mirror`. Pengaturan disimpan di `%APPDATA%\QuestMirror` (tetap ada walau di-install ulang).
- Hapus lewat **Settings Windows → Apps → UTSUSHI → Uninstall**.

> Satu-satunya prompt yang tidak bisa dilewati: saat pertama jalan, **Windows Firewall** bertanya soal akses jaringan. Tekan **Allow**, supaya Quest dan TV bisa menjangkau PC lewat Wi-Fi.

Membuat ulang `UTSUSHI-Setup.exe` (misalnya setelah mengubah kode): dobel-klik **`build-windows-app.bat`**. Yang dipakai hanya compiler C# bawaan Windows (.NET 4.8), plus Node.js / ffmpeg / adb yang ada di PC ini, dan semuanya ikut dibungkus.

Di Quest: **Developer Mode** aktif (app Meta Horizon di HP → Devices → Developer Mode).

---

## Setup pertama kali (± 1 menit, sekali saja)

1. Jalankan **`UTSUSHI-Setup.exe`**. Kalau Windows Firewall bertanya → **Allow**.
2. Colok Quest ke PC pakai USB → di headset tekan **Allow** (centang *Always allow*).
3. **App Quest terpasang sendiri** ke headset dalam beberapa detik, tanpa tombol. Kalau nanti ada versi baru, app di headset juga ter-update sendiri.
4. Di Quest buka **Library → Unknown Sources → UTSUSHI** → **lihat layar PC**. PC memunculkan kode besar di depan, dan app langsung ter-link.

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
| **◎ Lihat layar PC** (paling cepat) | Buka app Quest (belum ter-link = langsung *STEP 1 // Link*). Kamera headset langsung menyala dan memberi tahu PC. PC memunculkan **kode besar** di depan semua jendela. Cukup lihat layar PC dari jarak ±0,5–1,5 m, link terjadi sendiri (✓ *LINKED*). Kode besar juga bisa dibuka manual: kartu *NEXT STEP* → **Show the big code**, atau SETTINGS → *Link the Quest app*. |
| **Connect → Allow** | Di bawahnya (*OR TAP YOUR PC*) muncul PC yang ada di Wi-Fi yang sama. Tekan **Connect →**, lalu di PC muncul *INCOMING LINK REQUEST*. Cocokkan kode 4 digit, klik **Allow**. |
| Kabel | Kalau Quest tercolok/terhubung ADB, app ter-link sendiri, kecuali kamu pernah **Unlink** (setelah itu link ulang harus disengaja). |
| Kode 6 digit | Cadangan: ketik kode dari dashboard di app Quest. Bisa juga isi alamat PC manual. |

Kode besar & kode 6 digit **sekali pakai**, langsung berganti setelah dipakai. Kamera hanya menyala selama app belum ter-link dan halaman *Link your PC* terbuka; begitu ter-link, kamera langsung mati.

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
   - **Enter UTSUSHI Space** (baris lebar di bawahnya): membuka ruang imersif di Quest Browser. Lewat kabel.

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

## 3) UTSUSHI Space (ruang imersif)

Ruang di sekelilingmu dengan gaya yang sama seperti halaman web-nya: gelap, bersih, label mono, cap merah, dan ensō. Jendela bergerak dengan pegas (cepat di awal, halus saat berhenti), tajam (foveation dimatikan, teks digambar 1,6× lebih rapat), dan suaranya disintesis serta terdengar dari arah benda yang berbunyi. Semua yang diucapkan juga muncul sebagai teks.

### Cara masuk
Dari app UTSUSHI di Quest, **Enter UTSUSHI Space** membuka gerbang space: taman malam yang hidup dengan charm app-mu melayang di depan dan satu ajakan, **Step into your space**. Pinch di mana saja dan kamu masuk; panel app UTSUSHI menyingkir sendiri. (Browser hanya boleh memulai space imersif dari satu ketukan di halamannya, jadi gerbang inilah ketukan itu. Jalur PWA imersif dari Meta butuh domain https terverifikasi dan saat ini dilaporkan bermasalah di Quest Browser terbaru.)

- **Di headset**: app UTSUSHI → **Enter UTSUSHI Space**.
- **Dari PC**: dashboard → tombol **SPACE** di bar atas, atau tray → *Open the space on the headset*. Quest Browser terbuka sendiri. Pakai headset, lalu tekan **Enter space**.
- **Coba di PC tanpa headset**: buka `http://localhost:8765/space/` → **Preview here**. Seret ruang kosong untuk menoleh, klik untuk menekan, scroll untuk menggulir. `Alt+1…0` mensimulasikan gesture (`Alt+7` = kamera, `Alt+8` = push ke jendela di depan, `Alt+9` = swipe, `Alt+0` = center). `Esc` untuk keluar.

Space butuh **kabel USB** (atau wireless ADB). WebXR hanya jalan di halaman yang dianggap aman, dan `http://localhost` termasuk. Kabel membuat `localhost` di headset tersambung ke PC. Kalau koneksi USB sempat putus (misalnya headset tidur lalu bangun), host memasang jalurnya lagi dalam 5 detik.

Kunjungan pertama dibuka dengan tur singkat (bisa di-skip, bisa diulang dari **設定 Settings → replay tour**).

### Jendela (seperti di Quest / Vision Pro)
- **Tekan**: dari jauh tunjuk lalu pinch; dari dekat **sentuh langsung dengan ujung jari**. Saat jari dekat, sinar tangan hilang dan muncul cincin kecil di titik yang akan kamu sentuh.
- **Pindah**: pinch bar di bawah jendela lalu geser. Jendela tetap terlihat sama besar saat ditarik mendekat atau didorong menjauh. Dengan sinar, gerakkan tangan maju atau mundur untuk mendorong atau menarik jendela.
- **Ubah ukuran**: tarik salah satu sudut bawah jendela (lengkungnya muncul saat kamu menunjuk ke sana).
- **Tutup**: titik ✕ di sebelah kiri bar.
- Jendela baru terbuka **1 m** di depanmu (layar PC 1,25 m), cukup dekat untuk dibaca tanpa terasa jauh, dan berjajar sesuai lebarnya masing-masing, jadi tidak saling tumpuk. Jendela yang kamu pindahkan tetap di tempatnya. **🙌 kedua telapak ke atas**, **◉◉ double pinch**, atau **⟲ center** di launcher mengembalikan semuanya ke depan.

### Launcher (Apps)
Tab kecil **Apps** diam di bawah jendela-jendelamu, 1 m jauhnya, jadi tidak pernah tersentuh tangan tanpa sengaja. Tab ini tidak ikut bergerak; ia baru pindah saat kamu center. Pinch tab itu, angkat satu telapak (🤲), atau sentuh jam tangan, lalu launcher terbuka di depanmu dalam jangkauan jari. Isinya delapan app, masing-masing dengan ikon garis, nama, dan satu kalimat tentang gunanya. Di kepalanya ada ikon kecil: tampilkan/sembunyikan ruangan, bawa jendela ke depan, Guide, dan tutup. **Sudut merah kanan bawah** mengubah ukuran menu (sedikit lebih kecil sampai sedikit lebih besar dari biasanya; ukurannya diingat). Menu menutup sendiri setelah memilih app atau 20 detik tidak disentuh, kecuali **Settings → Display → Keep Apps open** dinyalakan.

### App charms (space yang hidup)
App-app kamu juga melayang di sekitarmu sebagai **charm**: ubin kecil (6,4 cm) setinggi dada, di kiri dan kanan, dalam jangkauan tangan. Mereka sedikit naik-turun, menghadap ke kamu, dan sesekali melompat kecil sambil berputar.
- **Pinch** sebuah charm untuk membuka app-nya; kalau sudah terbuka, jendelanya dibawa ke depanmu.
- **Pinch dan geser** untuk menaruhnya di mana saja (di meja, di samping jendela). Tempatnya diingat, relatif terhadap posisimu (seperti jendela).
- Saat app-nya terbuka, charm bercahaya merah dan ada **benang tipis** ke jendelanya. Charm berdenyut saat app-nya menyimpan sesuatu (foto baru → Photos, catatan tersimpan → Notes, scan tersimpan → Studio).
- Sentuh charm dengan **ujung jari** (dorong masuk dari depan) atau **pinch tepat di charm** untuk membuka app-nya; pinch lalu geser tetap memindahkannya.
- Sesekali sebuah charm mengeluarkan **benda 3D kecil** lalu menyimpannya lagi: pesawat kertas dari Notes, lembaran dari Files, polaroid dari Photos, kilat dari Camera, kubus kawat dari Studio, bola dunia dari Web, blok huruf dari Terminal, roda gigi dari Settings. Ini juga terjadi saat kamu membukanya, dan saat app-nya menyimpan foto atau scan.
- **Gather charms** (tile baru di quick ring, atau **Settings → Space → Gather**) menerbangkan semuanya kembali ke tempat awal, satu per satu dalam lengkungan, bukan teleport. Center juga membawa mereka terbang ke sekitarmu.
- **Settings → Space**: **App charms** (nyala/mati).

| App | Isi |
|---|---|
| **Notes** | Catatan 3D: ketik dengan keyboard, tulis/sketsa dengan **pensil** di halaman, **gambar di udara** (pinch lalu gerakkan; garis tinta tetap melayang di sekitar jendela catatan itu), tempel foto, atau **snap** langsung ke catatan. Tersimpan otomatis di PC (`%APPDATA%\QuestMirror\notes`); catatan yang dihapus masuk Recycle Bin. Di tool **3D**: **Draw** untuk menggambar, **Select** untuk memilih satu gambar di udara (pinch): sudutnya ditandai, bawa lewat garisnya atau grip di bawahnya, tarik sudut merah untuk resize, ✕ untuk menghapus gambar itu saja. Warna: 12 swatch, plus bar warna untuk warna apa pun: tekan lalu geser (setengah atas terang, bawah gelap); kotak **custom** di ujungnya menyimpan warnamu sendiri. Ujung pensil ikut berwarna sesuai tinta. Kartu teks punya ✕ dan sudut merah untuk resize. |
| **Files** | File explorer untuk penyimpanan Quest **dan** PC: tempat-tempat cepat, ← → ↑, path yang bisa diketuk, list/grid dengan thumbnail, cari, folder baru, rename, salin / potong / tempel (juga Quest ⇄ PC), hapus (file PC masuk Recycle Bin). Membuka gambar, teks/kode, video, musik, dan model `.glb`. |
| **Photos** | Semua foto dalam grid. Ketuk satu untuk melihatnya besar beserta tanggalnya, lalu ‹ › untuk berpindah, **Add to note**, atau **Delete** (dengan konfirmasi; masuk Recycle Bin). |
| **Camera** | Bingkai kamera di depanmu (lihat Foto) |
| **Studio** (Models + Scan) | Model 3D dari dekat: **GLB, glTF, OBJ, STL, PLY** (taruh di folder `models` PC, buka dari Files, atau hasil Scan), contoh bawaan, dan **"Your room"**: miniatur ruanganmu sendiri dari Space Setup (live: jendela dan posisimu ikut bergerak). Model diletakkan di **stage** (piringan kecil di meja/depanmu): tarik tepinya untuk memutar, pinch modelnya untuk mengangkat dan memutar dengan tangan (dilepas = kembali), dua tangan = perbesar/perkecil, **1:1** = ukuran asli. Tanda sudut dan label menunjukkan ukuran nyata dan jumlah segitiga/titik. |
| ↳ **Scan** (tombol di Studio) | Ubah benda nyata jadi 3D memakai depth sensor headset: kotak muncul di meja, taruh bendanya di dalam, tekan **Scan** lalu berjalan pelan mengelilinginya. Cincin di bawah kotak terisi sesuai sisi yang sudah terlihat. Setiap titik diberi **warna asli** dari kamera passthrough Quest (lewat aplikasi UTSUSHI; buka aplikasinya sekali agar kamera boleh dipakai). Depth dibaca hanya di area kotak (96 × 96) dan setiap sinar digabung ke volume fusi (TSDF), jadi bentuknya rata-rata dari banyak sudut, bukan satu lapis yang berisik; warna diambil dari kamera pada saat yang sama dengan posisi kepala ketika foto itu diambil. **Dots / Mesh**: tampil sebagai titik-titik atau sebagai permukaan padat berwarna (marching cubes dari volume fusi). Setelah Save, scanner kosong lagi untuk scan berikutnya. **Save** menyimpan `.ply` (titik atau mesh) di Models dan menaruhnya di stage. Di mode Void, ruanganmu muncul sendiri selama Scan dan Camera terbuka. |
| **Web** | Situs dan YouTube di dalam space: halaman berjalan di Edge (headless) di PC lalu dialirkan ke headset, suaranya ikut. Pinch = klik, geser atas/bawah = scroll, geser samping = drag (misalnya progress bar video); keyboard muncul sendiri saat mengetuk kolom teks. Login situs tersimpan di folder `web-profile` di samping pengaturan. Tanpa PC: aplikasi UTSUSHI menjalankan browsernya sendiri di layar tersembunyi dan menampilkannya di space (suara langsung dari headset). |
| **Guide** (ikon buku di kepala menu Apps) | Pengenalan: satu halaman singkat per fitur, masing-masing dengan tombol **Try it**. Saat pertama masuk, Guide memandu dasar-dasarnya dan menunggu kamu mencobanya. |
| **Terminal** | Tarik output (pinch lalu geser) atau pakai scrollbar merah di kanan untuk melihat baris lama; **↓ newer** kembali ke bawah; **A− / A+** mengubah ukuran teks (diingat), supaya output panjang muat. Shell Linux sungguhan di headset (`adb shell`, toybox), dengan perintah bawaan `help`, `sysinfo`, `snap`, `matrix`, `open <app>`, `ports`, `dev <baris>`, `ip`, `sudo`. **`linux`** masuk ke Linux sungguhan (Alpine) yang bisa memasang paket: `apk add python3 git nodejs …` (lihat *Linux di Terminal*). |
| **PC screen** | Layar PC di dalam space: tunjuk = mouse, pinch = klik, tahan = klik kanan, suara PC. Tombol ✕ / Scroll / Keyboard ada di bar kecil **di atas** layar, jadi tidak menutupi desktop. |
| **Devices** | ESP32 / Cardputer / board USB-serial apa pun di PC: konsol serial plus tombol cepat. Firmware ada di [`devices/`](devices/README.md). |
| **Settings** | **Space** (room/void, night/paper, **transparansi jendela**, **App charms**, Gather), **Display** (ketajaman, Hz, **ukuran jendela** Compact/Normal/Large, **Keep Apps open**, garis tangan), **Sound**, **Gestures** (saklar on/off tiap gesture, lampu menyala saat gesture dilakukan), **Status** (baterai, memori, suhu, CPU PC, board), **About** |

**Refine on PC (LingBot-Map).** Dengan PC terhubung, Scan juga menyimpan foto kamera beserta posisi kameranya. Kalau [LingBot-Map](https://github.com/robbyant/lingbot-map) terpasang di PC (butuh GPU NVIDIA; RTX 4060 8 GB cukup), tombol **Refine** muncul di bar Scan. PC menyusun ulang benda itu secara padat dan berwarna dari foto-foto tersebut, menyesuaikan jalur kameranya dengan posisi kamera Quest yang sebenarnya (ukuran asli), lalu memotongnya sesuai kotak scan. Hasilnya masuk Studio sebagai `scan-…-refined.ply`. Pemasangan (sekali, sekitar 8 GB), di PowerShell:

```powershell
$L = "$env:LOCALAPPDATA\UTSUSHI\lingbot"; mkdir $L -Force; cd $L
git clone --depth 1 https://github.com/robbyant/lingbot-map.git
python -m venv venv
.\venv\Scripts\python -m pip install torch==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cu128
.\venv\Scripts\python -m pip install -e .\lingbot-map
curl.exe -L -C - -o lingbot-map.pt https://huggingface.co/robbyant/lingbot-map/resolve/main/lingbot-map.pt
```

**Tanpa PC (standalone).** Aplikasi UTSUSHI di Quest membawa salinan space di dalamnya dan menyajikannya sendiri di `http://localhost:8770/space/`. Buka UTSUSHI → **Enter UTSUSHI Space** tanpa kabel: Notes, Models, Scan (berwarna), Photos (kamera Quest), Web, Files (penyimpanan Quest; aktifkan *All files access* sekali saat aplikasi memintanya), Terminal (shell di headset plus toolbox Linux BusyBox: `vi`, `wget`, `awk`, `tar`, `nc`, ~300 perintah), Guide dan Settings tetap jalan, dan semuanya disimpan di headset. Aplikasi menjaga dirinya tetap hidup dengan notifikasi kecil "UTSUSHI Space". Hanya PC screen dan Devices yang butuh PC; tile-nya tampil redup dengan tulisan "Needs your PC". Halaman masuk space memakai desain dan tema yang sama dengan aplikasi; dibuka dari aplikasi, cukup satu ketukan untuk masuk. Pertama kali, Quest menanyakan izin *spatial data and hand tracking* untuk alamat ini; pilih **Allow**.

### Linux di Terminal (paket bisa dipasang)
Android tidak mengizinkan app modern menjalankan program yang ia unduh sendiri, padahal itulah kerja package manager. Karena itu Linux berjalan di app pendamping kecil, **UTSUSHI Linux** (`quest-linux/`, dibuat untuk Android 9 seperti Termux): ia menjalankan **Alpine Linux** lewat **proot** (root palsu, jadi `apk` jalan) dan hanya mau dipakai oleh UTSUSHI (izin bertanda tangan sama + kunci rahasia; tidak bisa dipakai situs lain).

Installer Windows membawanya, dan PC memasangnya sendiri ke Quest (sebelum UTSUSHI) setiap kali headset tersambung, sama seperti app UTSUSHI. Untuk pengembangan, `build-quest-app.bat` membangun dan memasang keduanya:

```powershell
powershell -ExecutionPolicy Bypass -File quest-linux\build.ps1 -Install   # lalu quest-app\build.ps1 -Install
```

Di Terminal:

| Perintah | Hasil |
|---|---|
| `linux install` | Unduh Alpine (± 4 MB) langsung dari alpinelinux.org, dicek dengan SHA-256 resminya |
| `linux` | Masuk; prompt jadi `#`. `apk add <paket>`, `apk search`, `apk del`; `exit` keluar |
| `apk …` | Dari luar Linux: langsung masuk lalu menjalankannya |
| `linux status` · `linux remove --yes` | Ukuran dan versi · hapus Linux beserta isinya |

Di dalam Linux kamu root, file headset ada di `/sdcard`, dan tidak ada TTY (perintah interaktif penuh layar seperti `vi` atau `htop` tidak cocok di sini; `top`/`ping` otomatis diberi batas). Bekerja dengan atau tanpa PC.

Tampilan semua jendela memakai satu sistem: tinta di atas kertas gelap, satu warna aksen (merah cap), garis tipis (bukan dekorasi), sudut terpotong kecil (bukan pil bulat), dan judul jendela tanpa kanji besar, supaya yang menonjol adalah isinya. Tidak ada warna pelangi; emoji gesture pun digambar abu-abu.

### Keyboard
Muncul saat sebuah app butuh ketikan. Mengambang di depanmu dalam jangkauan, dan tiap tombol langsung menyala begitu jarimu menyentuhnya. Bisa juga ditunjuk dari jauh. Geser lewat bar di bawahnya. Tombol **desk** membuatnya rebah di **mejamu yang asli**: meja diambil dari Space Setup headset, dan tanpa meja keyboard rebah di tempatnya. Keyboard Bluetooth dan Cardputer juga bisa dipakai.

### Gesture
Gesture hanya dihitung kalau tanganmu **terangkat di depan**, **diam sebentar**, dan **tidak sedang memakai UI**, jadi tidak terpicu sendiri. Tiap gesture bisa dimatikan di **Settings → Gestures**.

| Gesture | Cara | Hasil | Awal |
|---|---|---|---|
| ⌜⌟ Frame | Dua tangan membentuk L | Bingkai kamera muncul di antara tanganmu | on |
| 👈👉 Point at each other | Dua telunjuk saling menunjuk | Foto seluruh pandangan | on |
| 🤲 Palm up | Telapak terbuka menghadap ke atas, tahan | Launcher terbuka di tanganmu | on |
| ⌚ Check watch | Angkat pergelangan kiri dan lihat | Jam kecil di pergelangan: waktu, tanggal, baterai (sentuh = Apps) | on |
| ✌ Peace | Telunjuk + jari tengah, tahan | room ⇄ void | on |
| 🤘 Horns | Telunjuk + kelingking, tahan | Hacker mode | on |
| 👍 Thumbs up / 👏 Clap | Tahan jempol / tepuk sekali | Status di caption | on |
| 🙌 Both palms up | Angkat kedua telapak terbuka menghadap ke atas, tahan | Semua jendela kembali ke depanmu, berjajar rapi | on |
| ◉◉ Double pinch | Pinch dua kali di ruang kosong | Sama: semua jendela kembali ke depan | on |
| 🫸 Push away | Telapak terbuka menghadap jendela, dorong | Jendela yang kamu dorong melayang menjauh lalu tertutup | on |
| ⇆ Swipe | Tangan datar menyapu cepat ke samping | Semua jendela berputar satu langkah di sekelilingmu (termasuk yang sudah kamu pindahkan) | off |

Gesture "lihat telapak lalu pinch" sengaja tidak dipakai karena dicadangkan Meta untuk menu sistem.

### Foto
1. Buat huruf L dengan kedua tangan. Bingkai langsung muncul dan mengikuti tanganmu: sudut tebal, garis sepertiga, dan bagian di luar bingkai digelapkan, jadi kamu tahu persis apa yang akan terfoto.
2. **Jepret**: tekuk satu telunjuk (jempol tetap tegak), seperti menekan shutter.
3. Atau lepas tanganmu: bingkai tetap di tempatnya. Tarik sudutnya untuk mengubah ukuran, geser lewat tepi atasnya, lalu tekan **◉**. Tombol **all** memfoto seluruh pandangan, **✕** menutup bingkai.

Foto diambil dari tampilan headset (termasuk passthrough), dipotong sesuai bingkai, lengkung lensanya diluruskan, dan tersimpan di PC: `%APPDATA%\QuestMirror\photos` (mode pengembangan: `host\photos`). Model 3D: taruh `.glb` di `%APPDATA%\QuestMirror\models`, atau buka langsung dari **書庫 Files**.

### Istilah
| Istilah | Artinya |
|---|---|
| WebXR | Standar browser untuk VR/AR. Space berjalan di Quest Browser lewat standar ini, jadi tidak perlu install app terpisah. |
| Passthrough / room | Kamera headset menampilkan ruanganmu yang asli di belakang jendela |
| Void | Ruang virtual: langit malam dan taman batu karesansui |
| Launcher | Pil kecil di bawah pandangan yang membuka semua app |
| Foveation | Trik headset yang menurunkan resolusi di tepi pandangan. Dimatikan supaya teks tetap tajam. |
| Space Setup | Pemindaian ruangan oleh headset (meja, dinding). Dipakai untuk menaruh keyboard di meja. |
| Charm | Ubin kecil sebuah app yang melayang di sekitarmu; pinch untuk membuka, geser untuk memindah |
| Alpine | Distribusi Linux yang sangat kecil; package manager-nya `apk` |
| proot | Program yang menjalankan Linux di dalam folder biasa, dengan root palsu, tanpa root sungguhan |
| ADB / kabel | Jalur USB ke headset. Space memakainya supaya `localhost` di headset tersambung ke PC. |

---|---|
| WebXR | Standar browser untuk VR/AR. Space berjalan di Quest Browser lewat standar ini, jadi tidak perlu install app terpisah. |
| Passthrough / room | Kamera headset menampilkan ruanganmu yang asli di belakang panel |
| Void | Ruang virtual: langit malam dan taman batu karesansui |
| Dock | Baris app di bawah pandangan |
| Core | Bola melayang yang berbicara, memberi status, dan menampilkan teks |
| ADB / kabel | Jalur USB ke headset. Space memakainya supaya `localhost` di headset tersambung ke PC. |

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
| Gambar Quest hitam / *HIDDEN* (headset sedang dipakai) | Horizon OS sengaja menghitamkan **seluruh** rekaman selama ada pop-up sistem yang privat. Pemicu yang sudah terbukti: **membuka app yang dikunci sehingga muncul permintaan PIN** (supaya PIN tidak ikut terekam). Pop-up lain yang mirip: dialog izin, keyboard, peringatan sistem. Kadang pop-up itu "nyangkut" walau sudah tidak terlihat. Tutup pop-up-nya. Kalau tetap hitam, **restart Quest** (tahan tombol power → Restart); host otomatis menyambung lagi. Toast biasa dari app (termasuk UTSUSHI) **tidak** memicunya — sudah dites. |
| *CAN'T REACH THE PC* waktu link | Quest dan PC beda Wi-Fi. Samakan Wi-Fi-nya, atau colok kabel USB (link otomatis lewat kabel). |
| Kamera tidak menemukan kode | Izin kamera sudah diberikan? Kalau belum, tekan **Start camera**. Pastikan kode besar terlihat penuh (tidak tertutup kabel atau pantulan lampu), dari jarak ±0,5–1,5 m. Kalau masih gagal, pakai **Connect → Allow**. |
| Dashboard terlihat aneh setelah update | Tab dashboard yang terbuka me-reload sendiri saat host diperbarui. Kalau tidak, tekan F5. |
| Layar PC patah-patah | *Light* / 30 fps, atau Wi-Fi 5/6 GHz. |
| Suara PC tidak ada | Volume Windows tidak mute? Tombol **♪** aktif? Output default Windows = speaker yang kamu pakai. |
| Setelah Quest restart tidak connect | Colok kabel sekali (pindah ke Wi-Fi otomatis), lalu cabut. |
| `ffmpeg not found` / `adb not found` | Install, atau set `FFMPEG` / `ADB` ke path exe-nya. |
| Space: tombol *Enter space* tidak muncul | Halaman harus dibuka sebagai `http://localhost:8765/space/` lewat kabel. Kalau dibuka lewat alamat IP Wi-Fi, WebXR tidak tersedia. |
| Space: "No photo" | Headset tidur, atau ada pop-up privat (lihat baris *HIDDEN*). Foto juga butuh kabel / ADB. |
| Space: port board tidak muncul | Colok board ke **PC** (bukan ke Quest), lalu tekan ↻ di **機器 Devices**. Kalau perlu, pasang driver CP210x / CH340. |

---

## Struktur project

```
start.bat                 jalankan host + buka dashboard (mode pengembangan)
build-quest-app.bat       build ulang & install app Quest
build-windows-app.bat     buat windows-app\build\UTSUSHI-Setup.exe
windows-app/
  src/App.cs              QuestMirror.exe: tray, menjalankan host, jendela app, notifikasi, uninstall
  src/Installer.cs        UTSUSHI-Setup.exe: install satu klik (tanpa admin), shortcut, Start with Windows
  src/Brand.cs            logo & warna (digambar dari kode, juga jadi ikon .exe)
  build.ps1               compile (csc bawaan Windows) + bungkus Node/ffmpeg/adb/host/APK
contoh_gambar/            referensi gaya visual (lokal saja, di-.gitignore)
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
  lib/space.js            API untuk space: statistik PC + Quest, shell di headset, foto (screencap → potong → luruskan lensa), model
  lib/serial.js + .ps1    jembatan USB-serial ke ESP32 / Cardputer (System.IO.Ports)
  public/                 dashboard/viewer (HTML/CSS/JS tanpa library) + QR generator
  lib/files.js            API file explorer: Quest (adb) dan PC (fs), thumbnail, salin antar sisi, Recycle Bin
  public/space/           UTSUSHI Space: three.js (vendor/, tanpa build step) + js/ (surface, panels, input, hands, camera, keyboard, apps/)
devices/
  utsushi-link/           firmware ESP32 apa pun (LED, RGB, GPIO, PWM, buzzer)
  utsushi-cardputer/      firmware Cardputer & Cardputer ADV (layar, beep, RGB, keyboard → space)
quest-app/
  src/…/MainActivity      panel utama (link PC, layar, share Quest)
  src/…/CameraScanner     kamera passthrough headset → QrDecoder (pembaca QR tanpa library)
  src/…/ScreenActivity    jendela per monitor PC (decoder H.264 hardware + input tangan)
  src/…/PcStream/PcAudio  video & suara PC
  src/…/Ui                design system: cut corners, grid, switch, ring, tema PAPER/NIGHT
  src/…/ControlService    accessibility: klik/scroll/ketik di app 2D, screenshot panel
  build.ps1               build APK pakai Android SDK (tanpa Gradle)
quest-linux/              UTSUSHI Linux: Alpine + proot untuk Terminal (target Android 9), lihat THIRD_PARTY.md
  src/…/LinuxService      layanan latar depan + server kecil di 127.0.0.1:8771 (hanya dengan kunci dari UTSUSHI)
  src/…/Linux             unduh/cek/pasang Alpine, shell proot
  build.ps1               build APK (kunci tanda tangan sama dengan quest-app)
```

Port: `8765` (HTTP), `8766` (agent Quest via adb forward), `8767/udp` (PC mengumumkan diri di Wi-Fi), `8770` (space di headset, tanpa PC), `8771` (UTSUSHI Linux, hanya di headset).
