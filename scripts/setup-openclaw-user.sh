#!/usr/bin/env bash
set -euo pipefail

#
# Setup script for dedicated OpenClaw user (Linux only).
#
# This script creates an isolated system user 'openclaw' with:
#   - No login shell
#   - No sudo access
#   - Dedicated home directory at /home/openclaw
#   - Runtime sandbox for FORGE execution
#
# REQUIRES: sudo privileges to run.
# This script is NOT automated -- review each step before executing.
#

OPENCLAW_USER="openclaw"
OPENCLAW_HOME="/home/${OPENCLAW_USER}"
RUNTIME_DIR="${OPENCLAW_HOME}/runtime"
SANDBOX_DIR="${RUNTIME_DIR}/sandbox/forge"

echo "=== OpenClaw User Setup ==="
echo ""
echo "This script will:"
echo "  1. Create system user '${OPENCLAW_USER}' (no login shell, no sudo)"
echo "  2. Create runtime directory at ${RUNTIME_DIR}"
echo "  3. Create sandbox directory at ${SANDBOX_DIR}"
echo ""
read -rp "Continue? (y/N): " confirm
if [[ "${confirm}" != "y" && "${confirm}" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

echo ""
echo "[1/4] Checking if user '${OPENCLAW_USER}' already exists..."
if id "${OPENCLAW_USER}" &>/dev/null; then
  echo "  User '${OPENCLAW_USER}' already exists. Skipping creation."
else
  echo "  Creating system user '${OPENCLAW_USER}'..."
  sudo useradd \
    --system \
    --shell /usr/sbin/nologin \
    --home-dir "${OPENCLAW_HOME}" \
    --create-home \
    "${OPENCLAW_USER}"
  echo "  User created."
fi

echo ""
echo "[2/4] Verifying user has NO sudo access..."
if groups "${OPENCLAW_USER}" 2>/dev/null | grep -qw "sudo\|wheel\|admin"; then
  echo "  WARNING: User '${OPENCLAW_USER}' is in a privileged group!"
  echo "  Remove with: sudo gpasswd -d ${OPENCLAW_USER} sudo"
  exit 1
else
  echo "  Confirmed: '${OPENCLAW_USER}' has no sudo/wheel/admin group."
fi

echo ""
echo "[3/4] Creating runtime directories..."
sudo mkdir -p "${SANDBOX_DIR}"
sudo chown -R "${OPENCLAW_USER}:${OPENCLAW_USER}" "${RUNTIME_DIR}"
sudo chmod 750 "${RUNTIME_DIR}"
sudo chmod 750 "${SANDBOX_DIR}"
echo "  ${RUNTIME_DIR} -> owned by ${OPENCLAW_USER}, mode 750"
echo "  ${SANDBOX_DIR} -> owned by ${OPENCLAW_USER}, mode 750"

echo ""
echo "[4/4] Setup complete."
echo ""
echo "To start OpenClaw as the dedicated user:"
echo "  sudo -u ${OPENCLAW_USER} openclaw gateway"
echo ""
echo "To verify isolation:"
echo "  sudo -u ${OPENCLAW_USER} whoami"
echo "  sudo -u ${OPENCLAW_USER} ls /home/rafael  # should fail (permission denied)"
echo ""
