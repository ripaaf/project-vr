# Third-party programs in UTSUSHI Linux

The helper runs these unchanged binaries (aarch64, built by the Termux project) from `assets/usr/`:

| File | Package | Licence | Source |
| --- | --- | --- | --- |
| `usr/bin/proot`, `usr/libexec/proot/loader` | proot 5.1.107.101 | GPL-2.0 | https://github.com/termux/proot |
| `usr/lib/libtalloc.so.2` | libtalloc 2.5.0 | LGPL-3.0 | https://talloc.samba.org |
| `usr/lib/libandroid-shmem.so` | libandroid-shmem 0.7 | BSD-3-Clause | https://github.com/termux/libandroid-shmem |

They come from `https://packages.termux.dev/apt/termux-main/` (the `.deb` checksums matched Termux's
package index):

```
a28355e9be257e1f87f4e9294b3118470d4fd7a5442fed8b278f4443c83407d7  proot_5.1.107.101_aarch64.deb
556591f43bb773ad8777e1a29522640866a55f95dab71914418b94a8c58ad5a7  libtalloc_2.5.0_aarch64.deb
0da3a24d558b93c92bcf8d611e0826a99ff96e396b148e6cdf33b47c47c57ff6  libandroid-shmem_0.7_aarch64.deb
```

Alpine Linux itself is not bundled. `linux install` in the Terminal downloads Alpine's mini root
filesystem from `https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/aarch64/` and checks it
against the SHA-256 that Alpine publishes in `latest-releases.yaml`.
