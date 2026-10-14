# PulseStream (YTVADWN)

PulseStream is a Tauri 2 desktop application for downloading YouTube media streams and remuxing them without re-encoding.

## Fedora: setup after a clean OS install

**Preferred: use a Git clone rather than GitHub's “Download ZIP”.** `src-tauri/resources/binaries/deno` is stored with Git LFS. The Fedora setup script restores LFS objects (when run from a clone) and installs per-user FFmpeg, FFprobe, and Deno overrides. If you already downloaded a ZIP, the script can still prepare local development, but GitHub ZIPs contain only the Deno LFS pointer; clone with Git LFS before preparing a distributable build.

### 1. Install Git and Git LFS, then clone

```bash
sudo dnf install -y git git-lfs
git lfs install
mkdir -p ~/Downloads
cd ~/Downloads
git clone https://github.com/immasid/YTVADWN.git
cd YTVADWN
git lfs pull
```

If you already cloned the repository, run `cd ~/Downloads/YTVADWN` (or your actual clone path) and `git lfs pull`.

### 2. Run the one-time Fedora setup

```bash
bash scripts/setup-fedora.sh
```

The script installs the Fedora Tauri build dependencies, Node/npm, `ffmpeg-free`, `aria2`, and Git LFS; restores LFS objects if this is a Git clone; installs or selects stable Rust through rustup; installs Deno if there isn't a runnable Deno already; creates app-priority symlinks in `~/.local/share/pulsestream/bin`; and runs `npm ci` from `package-lock.json`.

Why those binary overrides exist:

- **FFmpeg/FFprobe:** the bundled binaries may expect shared libraries that don't match your Fedora release. Fedora's `ffmpeg-free` package supplies system executables and matching libraries.
- **Deno:** the bundled LFS binary may require a newer glibc than the installed OS provides. The official Deno installer provides a runnable version for the machine, and PulseStream checks `~/.local/share/pulsestream/bin` before bundled resources.
- **aria2c:** enables the optional parallel HTTP downloader path. Downloads can still be throttled by YouTube or by the selected stream.

The script backs up existing files in the override directory instead of silently deleting them. Run it as your normal user; it calls `sudo` only for DNF packages. It is intended for Fedora desktop development, not as a production package installer for other distributions.

### 3. Check the tools and run PulseStream

```bash
bash scripts/check-fedora.sh
bash scripts/run-dev-fedora.sh
```

The app will open in a desktop window. Keep the terminal open while developing. The run script appends terminal output to `~/pulsestream-dev.log`, which is useful when the app or build exits with an error.

### Build a local package

After setup, you can try:

```bash
npm run tauri -- build
```

A local package build is not the same as validating a distributable release. Release builds should be tested on a clean machine because bundled sidecar compatibility can differ between Linux distributions and glibc versions.

## Git identity (optional)

Set the identity used for new Git commits on this machine:

```bash
git config --global user.name "immasid"
git config --global user.email "mesiddarthh@outlook.com"
```

These values identify commits; they do not authenticate you to GitHub.

## Download speed changes

The updated download pipeline tries yt-dlp first, uses aria2c for supported HTTP streams when available, retries through yt-dlp's native downloader if aria2c fails, and retains the existing direct-HTTP fallback. Separate audio and video streams are downloaded concurrently. This can reduce avoidable waiting but cannot guarantee a speed increase when YouTube itself limits throughput.

## Troubleshooting

- Check installed binaries with `bash scripts/check-fedora.sh`.
- Restore LFS assets with `git lfs pull` from the repository clone.
- Re-run setup with `bash scripts/setup-fedora.sh` if FFmpeg/FFprobe/Deno overrides are missing or broken.
- Capture app output with `bash scripts/run-dev-fedora.sh`; inspect `~/pulsestream-dev.log` if the build fails.
- Do not replace system glibc manually or create compatibility symlinks for missing glibc symbol versions.

## References

- [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Deno installation](https://docs.deno.com/runtime/getting_started/installation/)
- [Fedora ffmpeg-free package](https://packages.fedoraproject.org/pkgs/ffmpeg/ffmpeg-free/)
