# PulseStream (YTVADWN)

PulseStream is a Tauri 2 desktop application for downloading YouTube media streams and remuxing them without re-encoding.

This guide is the **clean Fedora installation checklist**. Start at the top and follow the steps in order. The setup script installs the tools that previously had to be configured manually, including Fedora's FFmpeg/FFprobe, a compatible Deno runtime, Rust, Node.js dependencies, and aria2.

> **Important:** Clone the repository with Git. Do not use GitHub's **Download ZIP** button for a complete setup. The bundled `src-tauri/resources/binaries/deno` is stored with Git LFS, and a ZIP download can contain only the LFS pointer instead of the real binary.

## 1. Install Git and Git LFS

Open a terminal with **Ctrl+Alt+T** and run:

```bash
sudo dnf install -y git git-lfs
git lfs install
```

## 2. Clone the repository and download its LFS files

The repository is public, so HTTPS cloning works without GitHub authentication:

```bash
mkdir -p ~/Downloads
cd ~/Downloads
git clone https://github.com/immasid/YTVADWN.git
cd YTVADWN
git lfs pull
```

If the folder already exists, do not clone over it. Enter the existing Git checkout and update it instead:

```bash
cd ~/Downloads/YTVADWN
git pull
git lfs pull
```

Confirm that Deno is a real Linux executable, not a text pointer:

```bash
file src-tauri/resources/binaries/deno
```

The output should identify an ELF executable. If it says `ASCII text`, run `git lfs pull` from the Git checkout and check again.

## 3. Run the one-time Fedora setup script

From the repository root (`~/Downloads/YTVADWN`), run this as your regular user — **do not put `sudo` before the script**:

```bash
bash scripts/setup-fedora.sh
```

The script uses `sudo` when it needs to install system packages. It installs or checks for:

- Fedora's Tauri/Linux build dependencies, including GTK, WebKitGTK, OpenSSL and compiler tools.
- Node.js and npm, then JavaScript packages locked in `package-lock.json` via `npm ci`.
- Stable Rust through rustup and Cargo.
- Fedora's `ffmpeg-free` package, which provides `ffmpeg` and `ffprobe`.
- `aria2`, used for supported parallel downloads.
- Git LFS, and the repository's LFS-managed files when running from a Git checkout.
- Deno at `~/.deno/bin/deno` if there is not already a working installation.
- Per-user executable overrides in `~/.local/share/pulsestream/bin/` for FFmpeg, FFprobe and Deno.

The per-user overrides are deliberate. The bundled FFmpeg binaries may require shared libraries not present on the installed Fedora release, and the bundled Deno may require a newer glibc. The local override lets PulseStream use compatible executables without replacing system glibc or altering the LFS-tracked file.

The script backs up existing override files before replacing them. Run it again if you need to repair the local setup.

## 4. Check the installation

```bash
bash scripts/check-fedora.sh
```

FFmpeg, FFprobe, Deno and yt-dlp should report as healthy. `aria2c` is optional to yt-dlp at runtime, but is installed by the setup script to enable its supported parallel-download path.

If a check fails, read the error printed underneath the failed binary and use the troubleshooting section below.

## 5. Launch PulseStream

```bash
bash scripts/run-dev-fedora.sh
```

The app will compile and open a desktop window. **Keep the terminal open** while developing. Press **Ctrl+C** in that terminal to stop the development process.

The launcher also saves terminal output to:

```text
~/pulsestream-dev.log
```

If the app fails to start or closes unexpectedly, inspect the latest log:

```bash
tail -n 200 ~/pulsestream-dev.log
```

To launch without the helper script, you can use:

```bash
npm run tauri -- dev
```

## 6. Optional: build a local release package

After the app launches successfully, you can build a local package:

```bash
npm run tauri -- build
```

Build artifacts are normally placed under `src-tauri/target/release/bundle/`. A successful local build does not by itself guarantee the app will work on every other Linux distribution; test packaged releases on the target systems.

Useful checks when changing the code:

```bash
npm run build
npm test
cargo check --manifest-path src-tauri/Cargo.toml
```

## Troubleshooting

### `git lfs pull` did not restore Deno

Make sure you are in the actual Git clone, then run:

```bash
git lfs install
git lfs pull
file src-tauri/resources/binaries/deno
```

If you extracted GitHub's ZIP archive, clone the repository as described in Step 2 instead. ZIP archives do not restore the actual Git LFS object in this repository.

### FFmpeg or FFprobe says `libavdevice.so.63` is missing

Re-run the setup script so it restores the Fedora-provided FFmpeg and FFprobe overrides:

```bash
bash scripts/setup-fedora.sh
bash scripts/check-fedora.sh
```

You can also inspect the expected override directory:

```bash
ls -l ~/.local/share/pulsestream/bin/ffmpeg
ls -l ~/.local/share/pulsestream/bin/ffprobe
```

### Deno says `GLIBC_2.44 not found`

This means the bundled Deno binary expects a newer glibc than the one on the current OS. Use the per-user Deno installed by the setup script and rerun the checker:

```bash
bash scripts/setup-fedora.sh
bash scripts/check-fedora.sh
~/.local/share/pulsestream/bin/deno --version
```

**Do not replace system glibc manually or create symlinks to fake glibc symbol versions.**

### The app exits or the terminal closes

Launch it from a terminal rather than double-clicking a script:

```bash
cd ~/Downloads/YTVADWN
bash scripts/run-dev-fedora.sh
```

Then examine `~/pulsestream-dev.log`. If a compiler error appears, copy the complete error text.

### Download speed is still slow

The downloader attempts to use aria2 for supported HTTP streams and can download separate audio/video tracks concurrently. This removes some avoidable waiting, but it cannot guarantee a speed increase if YouTube throttles the stream or the selected format has a limited transfer rate. Check the app's selected format and compare another video before increasing connection counts.

## Git setup (only if you plan to commit and push code)

You do **not** need GitHub authentication to clone this public repository over HTTPS. To push changes, an SSH key or another supported GitHub authentication method is required.

For commits that respect GitHub's private-email protection, configure the GitHub noreply address for this repository:

```bash
git config --local user.name "immasid"
git config --local user.email "220866029+immasid@users.noreply.github.com"
```

If you already use an SSH key registered with GitHub, switch the remote to SSH before pushing:

```bash
git remote set-url origin git@github.com:immasid/YTVADWN.git
ssh -T git@github.com
git push
```

On a clean OS install, your SSH private key must be safely restored from your own backup or a new key must be added to GitHub; registering the public key alone is not enough.

## Official references

- [Tauri 2 Linux prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Deno installation](https://docs.deno.com/runtime/getting_started/installation/)
- [Fedora `ffmpeg-free` package](https://packages.fedoraproject.org/pkgs/ffmpeg/ffmpeg-free/)
- [Git LFS documentation](https://git-lfs.com/)
