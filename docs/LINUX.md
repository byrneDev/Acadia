# Acadia on Ubuntu

The Linux release targets **Ubuntu 24.04 LTS or newer, x86-64**, with a graphical desktop. ARM Linux and other distributions are not release targets yet. Use the `.deb` package for normal Ubuntu installation; an AppImage is also provided for environments with the required desktop libraries and sandbox support.

Download packages and checksums from [Acadia releases](https://github.com/byrneDev/Acadia/releases). Verify the filename and SHA-256 checksum before installation. A checksum confirms file integrity; it is not a publisher signature.

## Install the Debian package

For version 0.3.0, run these commands in the download directory:

```sh
sudo apt install ./Acadia-0.3.0-linux-x64.deb
acadia
```

Launch Acadia as your normal user. Installation supplies desktop integration and declares the GTK, NSS, secret-service, audio, graphics, and font libraries required by the desktop application. Ubuntu's package manager resolves these dependencies. The installer includes Electron Builder's application-specific AppArmor profile for `/opt/Acadia/acadia`, allowing the user namespaces required by Chromium's sandbox on supported Ubuntu installations.

To update, quit Acadia and install the newer `.deb` with the same command. Removing the application with `sudo apt remove acadia` does not intentionally delete your research library. Export important investigations to portable `.acadia` files before updates or system changes.

## Run the AppImage

Ubuntu 24.04 names the FUSE 2 compatibility library `libfuse2t64`; install it alongside the existing FUSE 3 packages. See the [AppImage FUSE guidance](https://docs.appimage.org/user-guide/troubleshooting/fuse.html).

```sh
sudo apt install libfuse2t64
chmod +x Acadia-0.3.0-linux-x64.AppImage
./Acadia-0.3.0-linux-x64.AppImage
```

An AppImage does not install dependency packages or a system AppArmor profile. Ubuntu can restrict user namespaces for an unrecognized portable executable. If startup reports a namespace or sandbox error, install the `.deb` instead, or ask your administrator to supply a narrowly scoped AppArmor profile for the exact application path. Do not disable AppArmor globally, run Acadia as root, or add `--no-sandbox`. Acadia's AppImage launcher explicitly retains Electron's sandbox. [Ubuntu's AppArmor documentation](https://documentation.ubuntu.com/security/security-features/privilege-restriction/apparmor/) explains the per-application permission model.

For an environment without FUSE, `./Acadia-0.3.0-linux-x64.AppImage --appimage-extract` creates `squashfs-root`; the executable is `squashfs-root/acadia`. Extraction alone does not resolve namespace restrictions or missing desktop libraries.

## Local data, AI, and desktop integration

The application stores projects in Electron's per-user application-data directory, normally `~/.config/Acadia/workspace` on Ubuntu. Both package formats use the same application identity. Keep backups independently of the installed application.

Ollama remains a separate optional service; see [local AI setup](LOCAL-AI.md). English OCR and its language data ship with Acadia. PDF rendering uses the bundled `@napi-rs/canvas-linux-x64-gnu` native library, matching the canvas package version. Local mode, source versions, reports, and explicit external-search approval work the same way across platforms.

Credential storage uses Electron's operating-system facilities when available. A functioning Secret Service/keyring is needed for protected credential persistence on a Linux desktop. For display, touch, or scaling issues, include your Ubuntu version, X11/Wayland session, graphics hardware, monitor arrangement, and reproduction steps in the issue report.

## Build and validate

Use a native Ubuntu 24.04 x64 machine with Node.js 24 and npm. Install the desktop/build dependencies needed by Electron, plus `libopenjp2-tools`, `fakeroot`, and `dpkg`. In a checkout:

```sh
npm ci
npm test
npm run package:linux
```

The Linux preparation script checks the matching GNU/Linux x64 canvas package and ELF architecture. On Linux x64 it also loads the native canvas before packaging. Outputs are `release/v0.3.0/Acadia-0.3.0-linux-x64.deb`, `release/v0.3.0/Acadia-0.3.0-linux-x64.AppImage`, and `release/v0.3.0/linux-unpacked/acadia`. Packaging does not publish a release.

Native Ubuntu CI is the primary build route. A Linux container can produce artifacts on macOS, but does not establish that a real Ubuntu desktop, graphics driver, keyring, or dual-display setup works. Do not reuse macOS `node_modules` inside a Linux container. See [Electron Builder's cross-platform guidance](https://www.electron.build/docs/features/multi-platform-build/).

Release validation should include package installation, launch with the sandbox enabled, PDF import, scanned-page OCR, cited report export, and project reopen. Test physical displays and touch separately from automated UI checks. Consult each release's validation notes for completed checks; packaging configuration alone is not a claim of native runtime validation.
