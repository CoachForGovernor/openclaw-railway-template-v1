#!/bin/bash
set -e

OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-/data/.openclaw}"
OPENCLAW_WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-/data/workspace}"
OPENCLAW_ENTRY="${OPENCLAW_ENTRY:-/usr/local/lib/node_modules/openclaw/dist/entry.js}"
OPENCLAW_NODE="${OPENCLAW_NODE:-node}"
INSTALL_GOOGLE_WORKSPACE_PLUGIN="${INSTALL_GOOGLE_WORKSPACE_PLUGIN:-0}"
GOOGLE_WORKSPACE_PLUGIN_ID="${GOOGLE_WORKSPACE_PLUGIN_ID:-openclaw-google-workspace}"
GOOGLE_WORKSPACE_PLUGIN_SPEC="${GOOGLE_WORKSPACE_PLUGIN_SPEC:-npm:@tensorfold/openclaw-google-workspace@0.2.1}"

run_openclaw() {
  gosu openclaw env \
    OPENCLAW_STATE_DIR="$OPENCLAW_STATE_DIR" \
    OPENCLAW_WORKSPACE_DIR="$OPENCLAW_WORKSPACE_DIR" \
    "$OPENCLAW_NODE" "$OPENCLAW_ENTRY" "$@"
}

chown -R openclaw:openclaw /data
chmod 700 /data
mkdir -p "$OPENCLAW_STATE_DIR" "$OPENCLAW_WORKSPACE_DIR"
chown -R openclaw:openclaw "$OPENCLAW_STATE_DIR" "$OPENCLAW_WORKSPACE_DIR"

if [ ! -d /data/.linuxbrew ]; then
  cp -a /home/linuxbrew/.linuxbrew /data/.linuxbrew
fi

rm -rf /home/linuxbrew/.linuxbrew
ln -sfn /data/.linuxbrew /home/linuxbrew/.linuxbrew

if [ "$INSTALL_GOOGLE_WORKSPACE_PLUGIN" = "1" ]; then
  if ! run_openclaw plugins inspect "$GOOGLE_WORKSPACE_PLUGIN_ID" >/dev/null 2>&1; then
    run_openclaw --yes plugins install "$GOOGLE_WORKSPACE_PLUGIN_SPEC" --pin --force
  fi
fi

exec gosu openclaw env \
  OPENCLAW_STATE_DIR="$OPENCLAW_STATE_DIR" \
  OPENCLAW_WORKSPACE_DIR="$OPENCLAW_WORKSPACE_DIR" \
  OPENCLAW_ENTRY="$OPENCLAW_ENTRY" \
  OPENCLAW_NODE="$OPENCLAW_NODE" \
  node src/server.js
