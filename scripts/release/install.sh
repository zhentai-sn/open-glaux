#!/bin/sh
# Glaux installer for macOS and Linux (SDD 24 §7.7).
#
#   curl -fsSL https://zhentai-sn.github.io/open-glaux/install.sh | sh
#
# What this script does, and nothing else:
#   1. checks the OS, CPU architecture and free disk space;
#   2. downloads the Glaux package from GitHub Releases and verifies its SHA256;
#   3. unpacks it into ~/.local/share/glaux (Linux) or ~/Library/Application Support/Glaux (macOS);
#   4. downloads a private copy of Node.js and uv into that directory's runtime/ folder;
#   5. lets uv download Python 3.12 and the pinned, hash-checked Python packages;
#   6. adds the `glaux` command to ~/.local/bin and an app entry, then starts Glaux.
# It needs no sudo and does not change your system Python, Node.js or shell profile.
# Data lives in ~/.glaux and is kept on upgrade and uninstall.
#
# Environment variables: GLAUX_VERSION, GLAUX_INSTALL_DIR, GLAUX_HOME, GLAUX_DOWNLOAD_BASE,
# GLAUX_MIRROR (auto | cn | none), GLAUX_NO_BROWSER=1, GLAUX_NO_START=1,
# GLAUX_PACKAGE (a local glaux-<version>.tar.gz, for testing).
set -eu

REPO="zhentai-sn/open-glaux"
PAGES="https://zhentai-sn.github.io/open-glaux"
NODE_VERSION="22.22.0"
MIN_FREE_KB=$((3 * 1024 * 1024))

say() { printf '%s\n' "$*"; }
step() { printf '\n→ %s\n' "$*"; }
die() {
  printf '\nglaux install failed: %s\n' "$1" >&2
  printf 'Re-run the same command to retry; finished steps are skipped.\n' >&2
  exit 1
}

fetch() { # url output
  if command -v curl >/dev/null 2>&1; then
    curl -fL --retry 3 --connect-timeout 15 -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$2" "$1"
  else
    die "curl or wget is required"
  fi
}

fetch_text() { # url
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 3 --connect-timeout 15 "$1"
  else
    wget -q -O - "$1"
  fi
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

# ---------------------------------------------------------------- 1. system checks
os=$(uname -s)
arch=$(uname -m)
case "$os" in
  Linux) node_os=linux; default_dir="${XDG_DATA_HOME:-$HOME/.local/share}/glaux" ;;
  Darwin) node_os=darwin; default_dir="$HOME/Library/Application Support/Glaux" ;;
  *) die "unsupported OS: $os (use install.ps1 on Windows)" ;;
esac
case "$arch" in
  x86_64 | amd64) node_arch=x64 ;;
  arm64 | aarch64) node_arch=arm64 ;;
  *) die "unsupported CPU architecture: $arch" ;;
esac
if [ "$node_os" = darwin ] && [ "$node_arch" = x64 ]; then
  die "Intel Macs are not supported yet: a required package (lancedb) has no Intel macOS build"
fi
command -v tar >/dev/null 2>&1 || die "tar is required"

INSTALL_DIR="${GLAUX_INSTALL_DIR:-$default_dir}"
export GLAUX_HOME="${GLAUX_HOME:-$HOME/.glaux}"
mkdir -p "$INSTALL_DIR" "$GLAUX_HOME" || die "cannot create $INSTALL_DIR"

free_kb=$(df -Pk "$INSTALL_DIR" | awk 'NR==2 {print $4}')
if [ -n "$free_kb" ] && [ "$free_kb" -lt "$MIN_FREE_KB" ]; then
  die "at least 3 GB of free disk space is needed in $INSTALL_DIR"
fi

mirror="${GLAUX_MIRROR:-auto}"
if [ "$mirror" = auto ]; then
  if command -v curl >/dev/null 2>&1 && ! curl -fsS -o /dev/null --max-time 8 https://github.com; then
    mirror=cn
    say "GitHub is slow or unreachable; using mirrors in China for Node.js, Python and PyPI."
  else
    mirror=none
  fi
fi
export GLAUX_MIRROR="$mirror"

# ---------------------------------------------------------------- 2. package
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

if [ -n "${GLAUX_PACKAGE:-}" ]; then
  package="$GLAUX_PACKAGE"
  [ -f "$package" ] || die "GLAUX_PACKAGE not found: $package"
  version=$(basename "$package" | sed -n 's/^glaux-\([0-9][0-9.]*\)\.tar\.gz$/\1/p')
  [ -n "$version" ] || die "GLAUX_PACKAGE must be named glaux-<version>.tar.gz"
  sums="$(dirname "$package")/SHA256SUMS"
else
  version="${GLAUX_VERSION:-}"
  if [ -z "$version" ]; then
    step "Looking up the latest version"
    version=$(fetch_text "$PAGES/latest.json" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
    [ -n "$version" ] || die "cannot read $PAGES/latest.json"
  fi
  base="${GLAUX_DOWNLOAD_BASE:-https://github.com/$REPO/releases/download/v$version}"
  step "Downloading Glaux $version"
  package="$work/glaux-$version.tar.gz"
  sums="$work/SHA256SUMS"
  fetch "$base/glaux-$version.tar.gz" "$package" || die "download failed: $base/glaux-$version.tar.gz"
  fetch "$base/SHA256SUMS" "$sums" || die "download failed: $base/SHA256SUMS"
fi

if [ -f "$sums" ]; then
  expected=$(grep " glaux-$version.tar.gz\$" "$sums" | cut -d' ' -f1)
  actual=$(sha256_of "$package")
  [ -n "$expected" ] && [ "$expected" = "$actual" ] || { rm -f "$package"; die "SHA256 mismatch for glaux-$version.tar.gz"; }
  say "SHA256 verified."
elif [ -z "${GLAUX_PACKAGE:-}" ]; then
  die "SHA256SUMS is missing"
fi

target="$INSTALL_DIR/versions/$version"
if [ ! -f "$target/VERSION" ]; then
  step "Unpacking into $target"
  rm -rf "$target"
  mkdir -p "$target"
  tar -xzf "$package" -C "$target" --strip-components=1 || die "cannot unpack the package"
fi

# ---------------------------------------------------------------- 3. Node.js
node_dir="$INSTALL_DIR/runtime/node"
if [ ! -x "$node_dir/bin/node" ] || [ "$("$node_dir/bin/node" --version 2>/dev/null)" != "v$NODE_VERSION" ]; then
  step "Downloading Node.js $NODE_VERSION"
  if [ "$mirror" = cn ]; then node_base="https://npmmirror.com/mirrors/node/v$NODE_VERSION"
  else node_base="https://nodejs.org/dist/v$NODE_VERSION"
  fi
  node_name="node-v$NODE_VERSION-$node_os-$node_arch"
  fetch "$node_base/$node_name.tar.gz" "$work/node.tar.gz" || die "cannot download Node.js"
  fetch "$node_base/SHASUMS256.txt" "$work/node.sums" || die "cannot download Node.js checksums"
  expected=$(grep " $node_name.tar.gz\$" "$work/node.sums" | cut -d' ' -f1)
  [ "$expected" = "$(sha256_of "$work/node.tar.gz")" ] || die "Node.js SHA256 mismatch"
  rm -rf "$node_dir"
  mkdir -p "$node_dir"
  tar -xzf "$work/node.tar.gz" -C "$node_dir" --strip-components=1 || die "cannot unpack Node.js"
fi

# ---------------------------------------------------------------- 4. uv
uv_dir="$INSTALL_DIR/runtime/uv"
if [ ! -x "$uv_dir/uv" ]; then
  step "Installing uv"
  fetch "https://astral.sh/uv/install.sh" "$work/uv-install.sh" || die "cannot download the uv installer"
  UV_INSTALL_DIR="$uv_dir" UV_NO_MODIFY_PATH=1 sh "$work/uv-install.sh" >/dev/null || die "cannot install uv"
fi

# ---------------------------------------------------------------- 5–6. Python, command, start
step "Setting up Glaux $version"
"$node_dir/bin/node" "$target/launcher/glaux.mjs" install || die "setup failed (see the messages above)"

case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) say ""
     say "Add ~/.local/bin to your PATH to use the glaux command in new terminals:"
     say "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.profile" ;;
esac

if [ "${GLAUX_NO_START:-0}" != 1 ]; then
  "$node_dir/bin/node" "$INSTALL_DIR/current/launcher/glaux.mjs" start || die "Glaux did not start; run glaux doctor"
fi
say ""
say "Done. Commands: glaux start | stop | status | open | update | uninstall | doctor"
