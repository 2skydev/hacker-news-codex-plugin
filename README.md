# Hacker News

Codex 데스크톱 왼쪽 사이드바에서 Hacker News 인기 글과 최신 글을 읽는 개인용 로컬 플러그인입니다. 사용자에게 권한을 받은 로컬 프로세스가 ChatGPT 구독으로 한국어 번역을 요청합니다.

## 설치

이 저장소는 비공개입니다. 설치할 Mac의 Git에 저장소 읽기 권한이 있는 GitHub 계정이 연결되어 있어야 합니다.

1. Codex 앱의 **플러그인** 화면에서 **추가 → 마켓플레이스 추가**를 선택합니다.
2. **출처**에 `https://github.com/2skydev/hacker-news-codex-plugin.git`을 붙여넣고 **Git ref**에 `main`을 입력합니다. **Sparse 경로**는 비워 둡니다.
3. **마켓플레이스 추가**를 누른 뒤 플러그인 목록에서 **Hacker News**를 열고 **설치**를 누릅니다.
4. 왼쪽 **…** 메뉴에서 **Hacker News**를 엽니다. 자주 사용한다면 사이드바에 고정할 수 있습니다. [피드 직접 열기](codex://plugins/hacker-news@hacker-news-codex-plugin/app/open_reader)

## 업데이트

Codex 앱의 **플러그인 → 관리 → 마켓플레이스**에서 **Hacker News** 행의 **업그레이드**를 누릅니다. Codex가 GitHub의 `main`을 가져와 설치된 플러그인에 새 버전을 적용합니다. 리더가 열려 있었다면 닫았다가 다시 엽니다.

## 사용

1. 리더 오른쪽 위 **설정 → ChatGPT로 로그인**를 눌러 브라우저에서 사용할 계정을 선택하고 플랜 사용을 허용합니다. 연결 후 리더로 돌아오면 새 제목을 한국어로 번역합니다. 자동 모드는 계정이 제공하면 GPT-6 Luna를 우선 선택합니다. 리더 설정에서 다른 모델을 선택하면 새 번역부터 적용됩니다. 설치 후 플러그인의 설정 시작 안내에서도 연결 방법을 볼 수 있습니다.
2. **인기 글**은 Hacker News 순위, **최신 글**은 게시 순서로 읽습니다. 기본으로 새 글과 순위 변경을 자동 반영합니다. 설정에서 실시간 갱신을 끄면 변경 안내를 눌러 반영합니다. 외부 기사 제목은 해당 기사로 이동합니다.
3. **댓글**을 눌러 토론을 읽고 답글을 펼쳐 번역합니다. **영문 함께 보기**로 번역과 영문을 대조할 수 있습니다.
4. 플랜 한도에 도달하면 저장된 번역과 영문으로 계속 읽을 수 있습니다. **리더 설정**에서 연결을 해제하거나 저장된 번역문 크기를 확인하고 종류와 저장 기간별로 캐시를 비울 수 있습니다. 저장 시각이 없는 이전 버전의 번역은 전체 기간에 포함됩니다.

개인 Mac에서 실행하는 이 플러그인은 첫 로그인 때 OpenAI가 Client ID를 발급하므로 별도 신청이나 API 키 입력이 필요하지 않습니다. 번역을 사용하려면 해당 앱의 플랜 사용을 승인해야 합니다. [로컬 앱 등록 절차](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) 플랜 제공량과 허용한 크레딧은 [ChatGPT 사용량 관리](https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites)를 따릅니다. 이 프로젝트의 배포 형태는 개인 Mac에서 실행하는 로컬 플러그인입니다. [OpenAI 로컬 앱 가이드](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)

## 로컬 데이터와 개발

HN 공개 데이터는 공식 Firebase API에서 읽습니다. 현재 목록에 불러온 글의 미번역 제목과 펼쳐서 불러온 본문 또는 댓글을 OpenAI로 보냅니다. 최근에 본 목록과 댓글의 공개 원문을 최대 64페이지까지 로컬에 보관합니다. 24시간 이내의 페이지는 저장된 번역을 먼저 표시하고 HN에서 최신 내용을 확인합니다. 번역 캐시와 플러그인 전용 계정 자격 증명은 기본적으로 `~/.local/share/hacker-news/`에 저장합니다. 리더가 계정 자격 증명을 암호화하며 암호화 키는 macOS 키체인에 저장합니다. 이전 버전의 연결은 첫 사용 시 이 형식으로 옮깁니다. `HN_DATA_DIR`로 저장 위치를 바꿀 수 있습니다.

```sh
npm ci
npm run typecheck
npm test
```

설치본의 데스크톱 등록 상태는 실제 앱에 포함된 실행 파일로 확인합니다.

```sh
node scripts/check-desktop.mjs "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
```

Node.js 24 이상에서 `npm run dev`를 실행하고 터미널의 로컬 주소를 브라우저에서 열면 플러그인 설치 없이 실제 피드, 댓글, 설정과 ChatGPT 연결을 사용할 수 있습니다. 개발 서버는 저장소에 포함된 MCP 서버를 실행하며, 기본적으로 설치된 플러그인과 같은 `~/.local/share/hacker-news/`의 번역 캐시, 설정, 로그인 정보를 사용합니다.

React와 TypeScript로 작성한 UI는 Vite가 변경 즉시 반영합니다. 서버 소스를 수정했다면 `npm run build` 후 개발 서버를 다시 시작하세요. `npm test`는 단일 HTML 리더와 설치 패키지를 빌드한 뒤 테스트합니다.

로컬 MCP 서버가 OAuth 로그인, 토큰 갱신, 모델 조회와 Responses API 호출을 직접 처리합니다. React 리더에는 Codex UI Kit의 테마와 컴포넌트를 포함합니다. 새 버전을 배포할 때는 소스와 빌드 결과인 `dist/hacker-news/`를 함께 커밋하고 `main`에 푸시하세요. 설치하는 Mac은 이 패키지를 그대로 사용합니다.
