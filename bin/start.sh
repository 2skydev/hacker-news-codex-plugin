#!/bin/sh
set -eu

root=$(CDPATH= cd "$(dirname "$0")/.." && pwd)
for runtime in "$(command -v node || true)" \
  "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node" \
  "/Applications/Codex.app/Contents/Resources/cua_node/bin/node" \
  "$HOME/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node" \
  "$HOME/Applications/Codex.app/Contents/Resources/cua_node/bin/node" \
  "/opt/homebrew/bin/node" "/usr/local/bin/node"
do
  if [ -x "$runtime" ] && "$runtime" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'; then
    exec "$runtime" "$root/server.mjs"
  fi
done
echo "해커뉴스를 실행할 Node.js 24 이상을 찾지 못했습니다. 데스크톱 앱을 업데이트하거나 Node.js 24 이상을 설치해 주세요." >&2
exit 1
