# Hacker News

Codex 데스크톱 왼쪽 사이드바에서 Hacker News 인기 글과 최신 글을 읽는 개인용 로컬 플러그인입니다. 사용자에게 권한을 받은 로컬 프로세스가 ChatGPT 구독으로 한국어 번역을 요청합니다.

## 설치

이 비공개 저장소의 `main` 브랜치를 Codex 플러그인 마켓플레이스로 등록합니다. 설치할 Mac에서 Git이 이 저장소를 읽을 수 있어야 합니다.

Mac에서는 저장소의 **해커뉴스 설치.command**를 내려받아 `sh "해커뉴스 설치.command"`로 실행하면 데스크톱 앱에 포함된 Codex로 마켓플레이스 등록과 설치를 진행합니다. 터미널에서 같은 작업을 하려면 다음 명령을 실행하세요.

```sh
codex plugin marketplace add https://github.com/2skydev/hacker-news-codex-plugin.git --ref main
codex plugin add hacker-news@hacker-news-codex-plugin
```

설치 후 왼쪽 **…** 메뉴에서 **Hacker News**를 열고 사이드바에 고정할 수 있습니다. [피드 직접 열기](codex://plugins/hacker-news@hacker-news-codex-plugin/app/open_reader)

업데이트하려면 Codex의 **플러그인 → 관리 → 마켓플레이스**에서 **Hacker News** 행의 **업그레이드**를 누르세요. Codex가 GitHub의 `main`을 가져와 설치된 플러그인에도 새 버전을 적용합니다. 리더가 열려 있었다면 닫았다가 다시 열어 새 화면을 확인하세요.

터미널에서도 같은 업데이트를 실행할 수 있습니다.

```sh
codex plugin marketplace upgrade hacker-news-codex-plugin
```

기존 로컬 마켓플레이스에서 전환하는 경우, GitHub 마켓플레이스 등록 후 아래 명령으로 이전 설치를 해제하고 새 출처에서 설치하세요.

```sh
codex plugin remove hacker-news@hacker-news-local
codex plugin marketplace remove hacker-news-local
codex plugin add hacker-news@hacker-news-codex-plugin
```

## 사용

1. 리더에서 **ChatGPT로 계속하기**를 눌러 브라우저에서 사용할 계정을 선택하고 플랜 사용을 허용합니다. 연결 후 리더로 돌아오면 새 제목을 한국어로 번역합니다. 자동 모드는 계정이 제공하면 GPT-6 Luna를 우선 선택합니다. 플러그인 설정에서 다른 모델을 선택하면 새 번역부터 적용됩니다. 설치 후 플러그인의 설정 시작 안내에서도 연결 방법을 볼 수 있습니다.
2. **인기 글**은 Hacker News 순위, **최신 글**은 게시 순서로 읽습니다. 기본으로 새 글과 순위 변경을 자동 반영합니다. 설정에서 실시간 갱신을 끄면 변경 안내를 눌러 반영합니다. 외부 기사 제목은 해당 기사로 이동합니다.
3. **댓글**을 눌러 토론을 읽고 답글을 펼쳐 번역합니다. **영문 함께 보기**로 번역과 영문을 대조할 수 있습니다.
4. 플랜 한도에 도달하면 저장된 번역과 영문으로 계속 읽을 수 있습니다. **플러그인 설정**에서 연결을 해제하거나 저장된 번역문 크기를 확인하고 종류와 저장 기간별로 캐시를 비울 수 있습니다. 저장 시각이 없는 이전 버전의 번역은 전체 기간에 포함됩니다.

ChatGPT 계정에서 해당 앱의 플랜 사용을 허용해야 번역이 작동합니다. 플랜 제공량과 허용한 크레딧은 [ChatGPT 사용량 관리](https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites)를 따릅니다. 이 프로젝트의 배포 형태는 개인 Mac에서 실행하는 로컬 플러그인입니다. [OpenAI 로컬 앱 가이드](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)

## 로컬 데이터와 개발

HN 공개 데이터는 공식 Firebase API에서 읽습니다. 현재 목록에 불러온 글의 미번역 제목과 펼쳐서 불러온 본문 또는 댓글을 OpenAI로 보냅니다. 최근에 본 목록과 댓글의 공개 원문을 최대 64페이지까지 로컬에 보관합니다. 24시간 이내의 페이지는 저장된 번역을 먼저 표시하고 HN에서 최신 내용을 확인합니다. 번역 캐시와 플러그인 전용 계정 자격 증명은 기본적으로 `~/.local/share/hacker-news/`에 저장합니다. 계정 파일은 소유자만 읽고 쓸 수 있습니다. `HN_DATA_DIR`로 저장 위치를 바꿀 수 있습니다.

```sh
npm ci
npm test
```

설치본의 데스크톱 등록 상태는 실제 앱에 포함된 실행 파일로 확인합니다.

```sh
node scripts/check-desktop.mjs "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
```

Node.js 24 이상에서 `npm test`를 실행하면 설치 패키지를 빌드한 뒤 테스트합니다. 새 버전을 배포할 때는 소스와 빌드 결과인 `dist/hacker-news/`를 함께 커밋하고 `main`에 푸시하세요. 설치하는 Mac은 이 패키지를 그대로 사용합니다.
