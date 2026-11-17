#!/bin/sh
set -eu
marketplace=hacker-news-codex-plugin
source_url=https://github.com/2skydev/hacker-news-codex-plugin.git

for cli in "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex" \
  "/Applications/Codex.app/Contents/Resources/codex-cli/bin/codex" \
  "$HOME/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex" \
  "$HOME/Applications/Codex.app/Contents/Resources/codex-cli/bin/codex" \
  "$(command -v codex || true)"
do
  if [ -x "$cli" ]; then
    "$cli" plugin marketplace add "$source_url" --ref main
    "$cli" plugin marketplace upgrade "$marketplace"
    "$cli" plugin add hacker-news@hacker-news-codex-plugin
    echo "설치했습니다. 왼쪽 …에서 Hacker News를 여세요. 업데이트 전 화면이 보이면 리더를 닫고 다시 여세요. 그래도 이전 화면이면 Codex를 재시작하세요."
    exit 0
  fi
done
echo "호환되는 ChatGPT 또는 Codex 데스크톱 앱을 찾지 못했습니다. 앱을 설치하거나 업데이트한 뒤 다시 실행해 주세요." >&2
exit 1
