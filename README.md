# PulseStream (YTVADWN)

PulseStream is a Tauri 2 desktop application for downloading YouTube media streams and remuxing them without re-encoding.

This repository supports **Arch Linux (including CachyOS)** and **Fedora**. The application code is shared; use the setup script for your distribution.

> **Important: clone with Git.** Do not use GitHub's **Download ZIP** button for a complete development setup. `src-tauri/resources/binaries/deno` is stored with Git LFS, and a ZIP download may contain only the LFS pointer instead of the actual binary.

## Arch Linux / CachyOS

### 1. Install Git and Git LFS

Open a terminal and run:

```bash
sudo pacman -Syu
sudo pacman -S --needed git git-lfs
git lfs install
```

### 2. Clone the repository

```bash
mkdir -p ~/Projects
cd ~/Projects
git clone https://github.com/immasid/YTVADWN.git
cd YTVADWN
git lfs pull
```

If you already have a Git checkout, enter that directory and update it instead of cloning over it:

```bash
cd ~/Projects/YTVADWN
git pull
git lfs pull
```

Confirm the bundled Deno file is a real executable:

```bash
file src-tauri/resources/binaries/deno
```

It should identify an ELF executable. If it says `ASCII text`, run `git lfs pull` from the Git checkout and check again.

### 3. Run the Arch setup script

Run this as your regular desktop user; **do not put `sudo` before the script**:

```bash
bash scripts/setup-arch.sh
```

The script installs or checks the Arch packages required for Tauri, Node.js/npm, Rust, FFmpeg/FFprobe, Deno, Git LFS and aria2. It also creates per-user overrides in `~/.local/share/pulsestream/bin/` for FFmpeg, FFprobe and Deno, and installs the locked JavaScript dependencies with `npm ci`.

### 4. Check and launch

```bash
bash scripts/check-arch.sh
bash scripts/run-dev-arch.sh
```

The app will compile and open a desktop window. Keep the terminal open while developing; press **Ctrl+C** there to stop the process. The launcher appends terminal output to `~/pulsestream-dev.log`.

Inspect the latest log if startup fails:

```bash
tail -n 200 ~/pulsestream-dev.log
```

## Fedora

### 1. Install Git and Git LFS

```bash
sudo dnf install -y git git-lfs
git lfs install
```

### 2. Clone the repository

```bash
mkdir -p ~/Projects
cd ~/Projects
git clone https://github.com/immasid/YTVADWN.git
cd YTVADWN
git lfs pull
```

If you already have a Git checkout, enter that directory and update it instead of cloning over it:

```bash
cd ~/Projects/YTVADWN
git pull
git lfs pull
```

Confirm the bundled Deno file is a real executable:

```bash
file src-tauri/resources/binaries/deno
```

It should identify an ELF executable. If it says `ASCII text`, run `git lfs pull` from the Git checkout and check again.

### 3. Run the Fedora setup script

Run this as your regular user; **do not put `sudo` before the script**:

```bash
bash scripts/setup-fedora.sh
```

The script installs Fedora's Tauri/Linux build dependencies, Node.js/npm, stable Rust, `ffmpeg-free`, aria2 and Git LFS. It installs a working Deno under `~/.deno/bin/deno` if required, configures per-user binary overrides under `~/.local/share/pulsestream/bin/`, and installs the locked JavaScript dependencies with `npm ci`.

The local overrides are deliberate. Bundled FFmpeg binaries may require libraries not present on a given Fedora release, and the bundled Deno may require a newer glibc. The overrides use working local executables without replacing system glibc or changing the LFS-tracked file. The script backs up existing overrides before replacing them, and can be run again to repair the setup.

### 4. Check and launch

```bash
bash scripts/check-fedora.sh
bash scripts/run-dev-fedora.sh
```

The app will compile and open a desktop window. Keep the terminal open while developing; press **Ctrl+C** there to stop the process. The launcher appends terminal output to `~/pulsestream-dev.log`.

Inspect the latest log if startup fails:

```bash
tail -n 200 ~/pulsestream-dev.log
```

## Shared development commands

Run these from the repository root after the setup script has completed.

Launch without a helper script:

```bash
npm run tauri -- dev
```

Build a local release package:

```bash
npm run tauri -- build
```

Release artifacts are normally placed under `src-tauri/target/release/bundle/`. A successful local build does not guarantee the package will work on every Linux distribution; test packaged releases on the target system.

Useful checks when changing the code:

```bash
npm run build
npm test
cargo check --manifest-path src-tauri/Cargo.toml
```

## Troubleshooting

### Git LFS did not restore Deno

Make sure you are in the actual Git checkout, then run:

```bash
git lfs install
git lfs pull
file src-tauri/resources/binaries/deno
```

If you extracted GitHub's ZIP archive, clone the repository with Git as described above. ZIP archives do not reliably restore the actual Git LFS object.

### FFmpeg or FFprobe fails to start

Run the setup and check scripts for your distribution again:

Arch Linux / CachyOS:

```bash
bash scripts/setup-arch.sh
bash scripts/check-arch.sh
```

Fedora:

```bash
bash scripts/setup-fedora.sh
bash scripts/check-fedora.sh
```

Inspect the per-user overrides if necessary:

```bash
ls -l ~/.local/share/pulsestream/bin/ffmpeg
ls -l ~/.local/share/pulsestream/bin/ffprobe
```

### Deno reports a GLIBC version error

Do not replace system glibc manually or create symlinks to fake glibc symbol versions.

On Fedora, rerun `bash scripts/setup-fedora.sh`; it configures a working per-user Deno and then check it with:

```bash
bash scripts/check-fedora.sh
~/.local/share/pulsestream/bin/deno --version
```

On Arch Linux / CachyOS, rerun `bash scripts/setup-arch.sh` and then `bash scripts/check-arch.sh` to restore the per-user Deno override from the system package.

### The app exits or fails to compile

Launch from a terminal rather than double-clicking a script. Run the distribution-specific launcher and inspect `~/pulsestream-dev.log`. If a compiler error appears, capture the complete error text.

### Download speed is still slow

PulseStream attempts to use aria2 for supported HTTP streams and can download separate audio/video tracks concurrently. This avoids some unnecessary waiting, but cannot guarantee higher speed if YouTube throttles the stream or the selected format has a limited transfer rate. Compare another video and its selected format before changing connection counts.

## Git setup (only if you plan to commit and push code)

You do not need GitHub authentication to clone this public repository over HTTPS. To push changes, use an SSH key or another supported GitHub authentication method.

For commits that respect GitHub's private-email protection, configure the repository's Git identity:

```bash
git config --local user.name "immasid"
git config --local user.email "220866029+immasid@users.noreply.github.com"
```

If you already have an SSH key registered with GitHub, switch the remote to SSH before pushing:

```bash
git remote set-url origin git@github.com:immasid/YTVADWN.git
ssh -T git@github.com
git push
```

On a clean OS install, restore your SSH private key from your own backup or register a new key with GitHub. Registering only the public key is not enough.

## Official references

- [Tauri 2 Linux prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Deno installation](https://docs.deno.com/runtime/getting_started/installation/)
- [Arch Linux package database](https://archlinux.org/packages/)
- [Fedora `ffmpeg-free` package](https://packages.fedoraproject.org/pkgs/ffmpeg/ffmpeg-free/)
- [Git LFS documentation](https://git-lfs.com/)
