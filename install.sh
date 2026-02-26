#!/bin/sh
# tx installer — downloads the latest (or pinned) tx binary for your platform.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/jamesaphoenix/tx/main/install.sh | sh
#
# Environment variables:
#   TX_VERSION      Pin a specific version (e.g. "0.5.9"). Default: latest.
#   TX_INSTALL_DIR  Install location. Default: ~/.local/bin

set -e

REPO="jamesaphoenix/tx"

main() {
  # -- Detect platform --
  OS=$(uname -s | tr '[:upper:]' '[:lower:]')
  case "$OS" in
    darwin) ;;
    linux)  ;;
    *)
      echo "Error: unsupported OS '$OS'. tx binaries are available for macOS and Linux." >&2
      exit 1
      ;;
  esac

  ARCH=$(uname -m)
  case "$ARCH" in
    arm64|aarch64) ARCH="arm64" ;;
    x86_64|amd64)  ARCH="x64"  ;;
    *)
      echo "Error: unsupported architecture '$ARCH'. tx binaries are available for x64 and arm64." >&2
      exit 1
      ;;
  esac

  # -- Resolve version --
  if [ -n "$TX_VERSION" ]; then
    VERSION="$TX_VERSION"
  else
    VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
      | grep '"tag_name"' \
      | head -1 \
      | sed 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/')
    if [ -z "$VERSION" ]; then
      echo "Error: could not determine latest version from GitHub. Set TX_VERSION to install a specific version." >&2
      exit 1
    fi
  fi

  # -- Validate version looks like semver --
  case "$VERSION" in
    [0-9]*.[0-9]*.[0-9]*) ;;
    *)
      echo "Error: extracted version '$VERSION' does not look like a valid version." >&2
      exit 1
      ;;
  esac

  # -- Build download URL --
  ARTIFACT="tx-${OS}-${ARCH}"
  URL="https://github.com/${REPO}/releases/download/v${VERSION}/${ARTIFACT}"

  # -- Install directory --
  INSTALL_DIR="${TX_INSTALL_DIR:-$HOME/.local/bin}"
  mkdir -p "$INSTALL_DIR"

  # -- Download --
  TMPFILE=$(mktemp)
  trap 'rm -f "$TMPFILE"' EXIT INT TERM
  echo "Downloading tx v${VERSION} (${OS}/${ARCH})..."
  HTTP_CODE=$(curl -fSL -w '%{http_code}' -o "$TMPFILE" "$URL" 2>/dev/null) || true

  if [ "$HTTP_CODE" != "200" ] || [ ! -s "$TMPFILE" ]; then
    rm -f "$TMPFILE"
    echo "Error: failed to download ${URL}" >&2
    echo "  HTTP status: ${HTTP_CODE}" >&2
    echo "  Check that v${VERSION} exists and has a ${ARTIFACT} binary at:" >&2
    echo "  https://github.com/${REPO}/releases/tag/v${VERSION}" >&2
    exit 1
  fi

  # -- Install --
  mv "$TMPFILE" "${INSTALL_DIR}/tx"
  chmod +x "${INSTALL_DIR}/tx"

  echo "Installed tx v${VERSION} to ${INSTALL_DIR}/tx"

  # -- PATH check --
  case ":$PATH:" in
    *":${INSTALL_DIR}:"*) ;;
    *)
      echo ""
      echo "Note: ${INSTALL_DIR} is not in your PATH."
      echo "Add it by appending this line to your shell profile (~/.bashrc, ~/.zshrc, etc.):"
      echo ""
      echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
      ;;
  esac
}

main
