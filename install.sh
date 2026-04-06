#!/bin/bash
set -e

# LastMile CLI installer (binary name: lastmile; GitHub org: GoLastMile)
# Usage: curl -fsSL https://raw.githubusercontent.com/GoLastMile/cli/main/install.sh | bash

REPO="GoLastMile/cli"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"
BINARY_NAME="lastmile"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info() {
    echo -e "${GREEN}[info]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[warn]${NC} $1"
}

error() {
    echo -e "${RED}[error]${NC} $1"
    exit 1
}

# Detect OS
detect_os() {
    local os
    os="$(uname -s)"
    case "$os" in
        Darwin) echo "darwin" ;;
        Linux) echo "linux" ;;
        MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
        *) error "Unsupported operating system: $os" ;;
    esac
}

# Detect architecture
detect_arch() {
    local arch
    arch="$(uname -m)"
    case "$arch" in
        x86_64|amd64) echo "x64" ;;
        arm64|aarch64) echo "arm64" ;;
        *) error "Unsupported architecture: $arch" ;;
    esac
}

# Get the download URL for the latest release
get_download_url() {
    local os=$1
    local arch=$2
    local suffix=""

    if [ "$os" = "windows" ]; then
        suffix=".exe"
    fi

    # Handle the case where Linux only has x64 builds
    if [ "$os" = "linux" ] && [ "$arch" = "arm64" ]; then
        warn "Linux ARM64 binaries not available yet, trying x64..."
        arch="x64"
    fi

    # macOS x64 is only available, not arm64 natively might need Rosetta
    local binary_name="lastmile-${os}-${arch}${suffix}"

    # Get latest release tag
    local latest_tag
    latest_tag=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')

    if [ -z "$latest_tag" ]; then
        error "Could not determine latest release"
    fi

    echo "https://github.com/${REPO}/releases/download/${latest_tag}/${binary_name}"
}

# Main installation
main() {
    info "Installing LastMile CLI..."

    local os arch download_url tmp_dir
    os=$(detect_os)
    arch=$(detect_arch)

    info "Detected OS: $os, Architecture: $arch"

    download_url=$(get_download_url "$os" "$arch")
    info "Downloading from: $download_url"

    tmp_dir=$(mktemp -d)
    trap 'rm -rf "$tmp_dir"' EXIT

    local binary_path="$tmp_dir/$BINARY_NAME"
    if [ "$os" = "windows" ]; then
        binary_path="$tmp_dir/${BINARY_NAME}.exe"
    fi

    if ! curl -fsSL "$download_url" -o "$binary_path"; then
        error "Failed to download binary"
    fi

    chmod +x "$binary_path"

    # Install to INSTALL_DIR
    if [ -w "$INSTALL_DIR" ]; then
        mv "$binary_path" "$INSTALL_DIR/$BINARY_NAME"
    else
        info "Installing to $INSTALL_DIR (requires sudo)..."
        sudo mv "$binary_path" "$INSTALL_DIR/$BINARY_NAME"
    fi

    info "LastMile CLI installed successfully!"
    info "Run 'lastmile --help' to get started"

    # Verify installation
    if command -v lastmile &> /dev/null; then
        echo ""
        lastmile --version
    fi
}

main "$@"
