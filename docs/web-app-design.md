# dotz 웹앱 디자인 문서

웹앱의 모든 화면, 기능, 상태, 토큰, 애니메이션을 실제 코드에서 재서 한곳에 모은 문서예요. 그리고 Tailscale 없이 Cloudflare로 들어오는 경로를 메신저와 무관한 공용 구조로 바꾸는 설계를 담았어요.

## 이 문서의 자리

같은 내용이 여러 문서에 있으면 아래 순서로 원본을 정해요. 어긋나면 위쪽이 맞고, 아래쪽을 고쳐요.

| 무엇 | 원본 | 이 문서의 역할 |
|---|---|---|
| 토큰 값 | `web/css/01-tokens.css` | 재서 옮긴 표. 값을 새로 정하지 않아요 |
| 토큰 뜻, 색 규칙, 모션 규칙 | `web/DESIGN.md` | 인용만 해요 |
| 형태별 숫자(행, 카드, 시트, 버튼 등) | `docs/ui-spec.md` | 인용만 해요 |
| 왜 그렇게 그리는가 | `docs/ui-principles.md` | 인용만 해요 |
| 모션 도우미 동작 | `web/js/01-motion.js` | 재서 옮긴 표 |
| 화면 전수, 기능, 상태, 애니메이션 전수표 | **이 문서** | 원본이에요. 화면을 더하거나 바꾸면 여기를 같이 고쳐요 |
| 외부 접속 구조 | **이 문서** | 원본이에요. 사용자 설정 안내는 `docs/web-access-cloudflare.ko.md` |

`site/prototype/INVENTORY.md`는 시제품 위치를 찾는 표로 남겨요. 재서 적은 값은 코드가 바뀌면 낡으니, 숫자가 다르면 코드를 믿고 이 문서를 고쳐요.

실측 기준은 커밋 `d8506e32`이에요. 화면과 모션 표의 줄 번호는 그 커밋 기준이고, 뒤 커밋에서 조금 밀릴 수 있어요.

## 외부 접속 공용 구조

목표는 하나예요. Tailscale 대신 Cloudflare 워커로 들어와도, 잔디, Discord, Telegram, Slack 어디서 링크를 열어도, 항상 같은 웹앱이 떠요. 메신저별 임시 대화 페이지는 남기지 않아요.

### 고치기 전에 무엇이 왜 떴는가 (실측 커밋 기준)

`extras/cf-worker/worker.ts`는 요청을 그대로 게이트웨이에 넘겨요. 워커 자체는 화면을 만들지 않아요. 그래서 문제는 워커가 아니라 그 뒤의 앱 쪽에 있어요.

| 문제 | 근거 | 결과 |
|---|---|---|
| 잔디 컴퓨터를 고르면 앱을 떠나 단독 페이지로 가요 | `web/js/33-peers.js:155` `location.href = p.url` | 앱 셸, 토큰, 입력창이 전부 사라져요 |
| 그 페이지는 게이트웨이가 HTML 문자열로 찍어 내요 | `hub/jandi-peers.ts:59` `page()`, `web/sw.js:75` | 글꼴 `system-ui`, 파랑 `#2f6fed`, 모서리 14px. 토큰 0개, 모션 0개예요. 이게 그 허접한 대화창이에요 |
| 컴퓨터 목록이 Tailscale을 전제로 해요 | `hub/peers.ts` `discover()` | Tailscale이 없으면 자기 행조차 없어 전환 시트가 안 열려요(`prTrig`는 자기 행이 필요). 있어도 다른 컴퓨터 주소는 tailnet이라 밖에서는 못 열어요. 같은 주소로 열리는 건 잔디 행뿐이에요 |
| `/pair`도 앱 밖 페이지예요 | `hub/pair-page.ts:13` | 파랑 `#2563eb`, 토큰 0개. 외부 경로의 첫 화면이 앱과 달라 보여요 |
| 연결 뒤 깊은 링크가 사라져요 | `hub/pair-page.ts:92,103` `location.replace("/")` | 메신저의 `#chat/...` 링크가 홈으로 떨어져요 |
| 미연결 기기가 파일 링크를 열면 글자 한 줄이에요 | `hub/devices.ts:410-411` | `/api/...`는 화면 요청이어도 `forbidden` 평문이에요 |
| 메신저에서 누른 첫 요청에 쿠키가 안 실려요 | `hub/devices.ts:155` `SameSite=Strict` | 다른 사이트에서 넘어온 첫 탐색에는 쿠키가 없어, 서비스 워커가 없는 브라우저는 연결된 기기인데도 `/pair`로 가요 |
| 서비스 워커가 `/pair`를 앱 셸로 바꿔요 | `web/sw.js:78-81`, 제외 목록은 `/jandi-peer`, `/desk`뿐 | 해제되거나 만료된 기기는 `/pair` 주소에 빈 앱 셸만 보여요 |
| 웹 링크를 잔디만 전달해요 | `msg.link` 사용처는 `hub/messenger-jandi.ts:433` 하나 | `docs/web-access-cloudflare.ko.md`는 "웹에서 보기" 링크가 붙는다고 적었지만 Telegram, Slack, Discord에는 안 붙어요 |

이 근거는 코드 경로로 확정한 것이고, 형이 본 화면을 그 컴퓨터에서 재현한 것은 아니에요. 이 맥은 `web-access.json`이 `tailscale`이고 `messengers/jandi.json`이 없어요.

### 공용 구조

층을 다섯으로 나누고, 메신저마다 다른 것은 맨 아래 어댑터에만 둬요.

| 층 | 하는 일 | 원본 코드 | 메신저별 차이 |
|---|---|---|---|
| 주소 | 공개 주소 하나, 모든 링크가 여기서 나와요 | `hub/weblink.ts` `webBase`, `webLink`, `convPath` | 없음 |
| 문 | 미연결 기기를 앱과 같은 모양의 `/pair`로 보내고, 가려던 곳을 기억해요 | `hub/devices.ts`, `hub/pair-page.ts` | 없음 |
| 앱 셸 | 화면은 전부 셸 안에 있어요. 앱 밖 대화 페이지는 없어요 | `web/index.html`, `web/js/*` | 없음 |
| 다른 컴퓨터 | 연결 방식 세 가지를 같은 목록, 같은 전환으로 보여 줘요 | `hub/peers.ts`, `web/js/33-peers.js` | 중계 어댑터 |
| 메신저 어댑터 | 링크를 그 메신저 모양으로 싣고, 중계가 되는 메신저는 대화를 읽고 보내요 | `hub/messenger-*.ts` | 여기에만 있어요 |

### 다른 컴퓨터를 고를 때

| 그 컴퓨터의 주소 | 고르면 | 표시 | 필요한 것 |
|---|---|---|---|
| tailnet 주소 | 지금처럼 그 주소의 웹앱으로 가요 | 연결됨 / 연결 안 됨, 새 알림 수 | 이 브라우저가 tailnet 안 |
| 공개 주소(자기 Cloudflare 워커나 터널) | **그 주소의 진짜 웹앱**으로 가요. 그 주소에서 기기를 한 번 연결해요 | 연결됨 / 연결 안 됨. 새 알림 수는 없어요 | `web.peers`에 주소 |
| 주소 없음(메신저 중계만) | **이 앱의 평소 채팅 화면**에서 그 컴퓨터와 주고받아요 | 메신저 이름 표시 | 중계 어댑터 |

공개 주소 행의 연결 여부는 공개된 `GET /manifest.webmanifest`(`isDotz`)로만 재요. 새 알림 수는 `x-dotz-peer`와 tailnet 출처가 둘 다 있어야 읽히는데(`hub/peer-auth.ts`), 이 문을 넓히지 않아요.

자기 행은 Tailscale이 없으면 `webBase()`로 만들어요. 그래야 전환 시트가 열려요.

설치한 앱(PWA)은 다른 주소를 프레임으로 띄우지 않아요. `/pair`가 `frame-ancestors 'none'`이고 기기 쿠키가 `SameSite=Strict`라서, 공개 주소는 브라우저 탭으로 열어요. 이 둘을 풀지 않아요.

### 앱 안 대화 화면 (중계 컴퓨터)

`/jandi-peer/<keyword>` 페이지를 지워요. 예비로도 남기지 않아요. 별도 화면을 새로 만들지도 않고, **평소 채팅 화면에서 주고받는 길만 바꿔요.** 이 방식은 PR #46에서 가져왔어요.

- 대상: `relay:<어댑터>:<키워드>`, 주소는 `#chat/relay:jandi:work`. 마지막 대상으로 저장하지 않아요. 옛 주소 `/jandi-peer/<키워드>`는 이 주소로 넘겨요.
- 모양: `renderAll`, `msgNode`, 입력창을 그대로 써요. 내 글은 `message`, 그쪽 답은 `out`으로 그려요. 새 색이나 말풍선을 만들지 않아요.
- 머리: 컴퓨터 이름이 제목이 되고, 어댑터가 준 한 줄(`잔디로 주고받아요`)이 상태 자리에 와요.
- 없는 것: 작업 중 표시, 도구 카드, 할 일 띠, 첨부, 모델 칩, 세션 바꾸기는 그리지 않고, 입력창 위에 짧은 안내 한 줄을 둬요. `/명령`은 글자 그대로 보내요.
- 상태: 불러오는 중, 빈 대화(`아직 대화가 없어요`), 읽기 실패(`a-error` 줄), 보내는 중(흐린 내 글 + `보내는 중…`), 보내기 실패(오류 줄, 글은 입력창으로 돌아와요), 연결 안 됨(보내기는 돼요).
- 돌아오기: 컴퓨터 목록에서 이 컴퓨터를 다시 고르면 들어오기 전 대화로 가요.
- 모션: 새로 쓰지 않아요. 평소 채팅의 도착, 화면 전환 모션을 그대로 받아요.
- 갱신: 화면이 보일 때만 4초마다 읽어요. 게이트웨이의 2초 캐시를 그대로 써요.
- 알림: 새 답은 기존 웹 푸시로 와요. 이 방식은 PR #45에서 가져왔고, 누르면 위 채팅 주소가 열려요. `[ask]`는 답변 필요, `[done]`/`[fail]`은 결과, `[run]`은 알리지 않아요. 컴퓨터별 `notify: false`로 꺼요.

**외부 글은 믿지 않아요.** 그쪽 답은 이 게이트웨이가 쓴 글이 아니에요. 그대로 `out`으로 넘기면 `[file] /경로` 줄이 **이 컴퓨터의** `/api/file`을 묻는 파일 칩이 되고(`web/js/15-attachments.js`), `결정:` 블록이 선택 카드가 돼요. 그래서 중계 글에는 표시(`relay: true`)를 달아 파일 칩과 선택 카드를 만들지 않고 글자로 둬요. 마크다운과 링크는 평소 렌더러 그대로예요.

### PR #45, #46 판단

| PR | 살리는 것 | 바꾸거나 버리는 것 |
|---|---|---|
| #46 평소 채팅 화면 | 대상 방식, `msgNode` 재사용, 보내는 중 표시, 오류 줄, 돌아오기, `/api/viewing` 제외, 4초 갱신 | `jandi:` 이름은 `relay:<어댑터>:`로 일반화. 옛 페이지 `page()`는 예비로 두지 않고 삭제. `.jpnote`의 px 값은 토큰으로(`space` 검사 실패). `url`을 잘라 키워드를 얻는 `jpKeyOf` 대신 목록 행에 키를 실어요. `[file]`, 선택 카드 위험을 막아요 |
| #45 새 답 푸시 | `peerReplyPush` 분류, 알리기 전 위치 저장, `notify: false` | 눌렀을 때 주소를 `/#chat/relay:jandi:<키워드>`로. `startsWord` 중복 제거. `setJandiPeerReply` 전역 대신 어댑터 쪽 연결 |

두 PR 모두 main과 충돌하고 CI 기록이 없어서 그대로 머지하지 않고, 위 내용을 공용 구조 위에 다시 얹어요. 인증 쪽 변경은 두 PR 모두 없어요.

### 문 (기기 연결)

- `/pair`는 앱 토큰과 같은 값(색, 글꼴, 모서리, 버튼 높이, 라이트와 다크)으로 다시 그려요. 스크립트는 지금처럼 `/pair.js` 하나이고 CSP는 넓히지 않아요.
- 가려던 곳은 `/pair?next=<같은 주소의 경로>`로 들고 가고, 해시는 브라우저가 리디렉션에서 유지해요. `next`는 `/`로 시작하고 `//`, `\`, 제어 문자가 없을 때만 써요. 아니면 `/`로 가요.
- 미연결 기기가 `/api/file` 같은 링크를 화면으로 열면 `forbidden` 평문 대신 `/pair`로 가요. `fetch`는 지금처럼 403이에요.
- 메신저에서 넘어온 첫 탐색은 메신저가 실제로 거는 `/`와 `/api/file`에 한해서만, 고정된 작은 페이지(`/pair-hop.js`)가 같은 주소를 한 번 다시 열어요. 같은 사이트 탐색이 되어 쿠키가 실려요. 다른 주소는 다시 열지 않고 바로 `/pair?next=`로 보내요. 다른 사이트의 링크가 로그인 상태로 GET을 실행하면 안 되기 때문이에요. `SameSite=Strict`는 그대로 둬요.
- `/pair?next`는 게이트를 통과할 요청만 `next`로 보내요. Access를 쓰면 기기 세션과 Access 토큰이 둘 다 있어야 해요. 그래서 문과 `/pair` 사이에서 반복되지 않아요.
- 세션이 끊긴 앱 셸(캐시에서 뜬 경우)도 `web/js/01-forbidden-pair.js`가 주소와 해시를 들고 `/pair`로 가요.
- 서비스 워커는 `/pair`, `/pair.js`를 건드리지 않아요. 옛 `/jandi-peer/*`도 서버 리다이렉트에 맡겨요.

### 메신저 어댑터

어댑터에 두 가지만 더해요. 둘 다 선택이에요.

```ts
type Adapter = {
	// 기존 필드 그대로
	/** deliver()가 msg.link를 직접 싣는다. 없으면 공용 기본값: 본문 끝에 한 줄. */
	ownsLink?: true;
	/** 주소 없는 컴퓨터와 이 메신저로 주고받는다. */
	relay?: {
		rows(): Promise<Peer[]>;
		lines(key: string): Promise<Line[]>;
		send(key: string, text: string): Promise<void>;
		note: string;
	};
};
```

| 메신저 | 링크 전달 | 중계 |
|---|---|---|
| 잔디 | `connectInfo`의 `웹에서 보기` (지금 그대로) | 있음: `hub/jandi-peers.ts`의 나와의 대화 |
| Discord | 결정 메시지와 알림에만 링크 버튼. 일반 메시지에는 없음 | 없음 |
| Telegram | 인라인 URL 버튼 | 없음 |
| Slack | `<url\|웹에서 보기>` 링크 | 없음 |

Discord, Telegram, Slack에 중계를 지금 만들지는 않아요. 같은 규격으로 붙일 수 있게만 둬요. API는 `/api/relay/<어댑터>/<키워드>/messages|send` 하나로 묶고 기존 게이트 뒤에 둬요.

### 바뀌지 않는 것

- 게이트 순서, `cloudflareGate`, Access 요구, `x-dotz-token`, 기기 세션 쿠키 속성(`HttpOnly; Secure; SameSite=Strict`), 코드 한도.
- 새로 인증 없이 열리는 경로는 없어요. 고정 페이지와 `/pair` 말고는 미연결 기기가 받는 내용이 없어요.
- `hub/peer-auth.ts`의 경로 목록과 tailnet 조건. 중계 API는 그 목록에 넣지 않아요.
- 주소에 토큰을 넣지 않아요. `next`에는 경로만 들어가고, 값이 잘못되면 버려요. 로그에 쿠키, 토큰 값을 남기지 않아요.
- 워커는 지금처럼 아무것도 검사하지 않고 넘겨요.

### 메모리, 토큰, 속도

| 항목 | 지금 | 바뀐 뒤 |
|---|---|---|
| 메모리 | 대화를 열 때마다 별도 페이지를 새로 띄워요 | 이미 뜬 앱의 채팅 화면을 그대로 써요. 100줄을 메시지로 들고 있어요 |
| 토큰(모델) | 0 | 0. 모델을 부르지 않아요 |
| 속도 | 페이지 이동, 앱으로 돌아오면 앱 전체 재시작 | 앱 안 전환이에요. 목록은 잔디를 최대 1.5초 기다려요(`LIST_WAIT_MS`, 그대로) |
| 잔디 호출 | 3초 폴링, 2초 캐시 | 4초 폴링, 2초 캐시로 줄어요. 숨겨진 화면에서는 멈춰요 |

이전 비서와 대조: 이전 비서는 웹 화면이 없고 게이트웨이 저장소(`~/.omo/agent/gateway`)와 세션 기록만 있어요. 그래서 이 구조에서 따라갈 선례는 없고, 메신저를 얇은 입구로 두고 대화의 원본을 한곳에 두는 방식만 같아요.

### 남은 일

이 절의 구조는 모두 구현했어요. 남은 일은 하나예요.

- 후속 작업: Ovis식 끝간 암호화 릴레이. 오너가 후속으로 예약했어요. 지금 Cloudflare 경로는 TLS가 Cloudflare에서 끝나서 Cloudflare가 평문을 볼 수 있고, 이 사실을 설정 화면과 `docs/web-access-cloudflare.ko.md`에 적었어요. 추정 비용은 20~28일이에요.

## 화면 지도

dotz 웹앱의 `views` 배열(`web/js/04-state.js:36`)은 23개예요. 설정 하위 4개(`notifications`, `display`, `update`, `runtime`)는 `web/js/22-settings-pages.js:5-14`가 실행 시점에 `views`, `SUB`, `titles`에 더해서 실제로는 27개 뷰가 돌아요. 주소는 `#<뷰>/<대상>` 꼴이고 `parseHash`(`web/js/05-command-palette.js:99`)가 나누고 `go()`(같은 파일 :109)가 해시를 만들어요(:143). 제목은 `titles`(`04-state.js:37`), 뒤로 가는 곳은 `backTarget`(`04-state.js:235`)이에요. 아래 "SUB"는 설정 하위 화면 집합(`04-state.js:35`)이에요: 이 화면에서 뒤로는 직전 비-SUB 화면이고, 없으면 `provider`는 `providers`, 메신저 넷은 `messengers`, 나머지는 `settings`예요.

| 뷰 이름 | 경로(해시) | DOM id | 화면에 보이는 제목 | 부모 / 뒤로 | web/js | web/css |
|---|---|---|---|---|---|---|
| `home` | `#home` | `#v-home` (`#home-now`, `#home-cards`, `#home-ended`) | `botName` (제목칸은 비서 이름, `titles.home`은 `홈`) | 탭 루트. 뒤로는 `home` | 08-home.js, 09-needs-you.js, 07-board.js, 06-subagents.js, 18-lanes.js(세션 행) | 22-shell.css, 05-log.css, 09-notices.css, 02-cards-lists-tags.css, 04-files.css |
| `chat` | `#chat/<대화 키>`, 폰 목록 `#chat/list`, 모니터링에서 열면 `#monitoring/c:<키>` | `#v-chat` (`#timeline`, `#composer`, `#dcard`, `#todo`) | `채팅` (대화 머리 `convChrome`가 대화 이름으로 바꿈) | 폰: 대화에서 뒤로는 `openChatList`, 모니터링 소속이면 `monitoring` | 31-conversations.js, 16-target-switcher-conversation.js, 13-data.js, 14-slash-commands.js, 10-decision-card.js, 10-reply-card.js, 15-attachments.js, 15-picker.js, 39-reply.js, 41-runstate.js | 07-chat.css, 10-conversations.css, 04-files.css, 03-base.css, 12-composer-phone.css, 15-reply-card.css, 16-result-card.css, 21-picker.css |
| `activity` | `#activity/<대화 키>` (`LOG_VIEW=false`라 항상 `chat`으로 바뀜) | `#v-activity` (`#term`, `#act-jump`) | `채팅` | chat과 같음 | 12-terminal-view.js, 13-data.js | 05-log.css, 04-files.css |
| `harness` | `#harness`, `#harness/project/<id>` | `#v-harness` > `#harness`, 시트 `#hsheet` | `구성` | `settings` (`backTarget`이 harness를 먼저 settings로 보냄) | 27-harness.js, 28-harness-project.js, 29-harness-features.js | 06-harness.css, 05-log.css |
| `settings` | `#settings` | `#v-settings` > `#settings` | `설정` | 탭 루트(뒤로는 `home`) | 22-settings-pages.js(settingsList), 24-settings-update.js(renderSettings), 22-settings.js | 15-settings-pages.css, 15-settings-phone.css, 02-cards-lists-tags.css |
| `models` | `#models` | `#v-models` > `#models` | `모델 · 폴백` | `prevView`가 SUB가 아니면 그 화면, 아니면 `settings` | 20-models.js, 22-settings.js(폴백 편집기) | 03-base.css, 15-settings-pages.css, 15-settings-phone.css |
| `providers` | `#providers` (`#providers/<id>`는 `provider`로 바뀜) | `#v-providers` > `#providers` | `공급자` | `settings`(위와 같은 규칙) | 21-providers.js | 02-cards-lists-tags.css, 15-settings-pages.css |
| `usage` | `#usage` | `#v-usage` > `#usage` | `사용량` | `settings` | 21-providers.js(loadQuota), 37-api-budget.js | 02-cards-lists-tags.css, 15-settings-pages.css |
| `context` | `#context` | `#v-context` > `#context` | `컨텍스트` | `settings` | 19-project-main.js:514-526(loadContext, renderContext) | 02-cards-lists-tags.css, 15-settings-pages.css |
| `discord` | `#discord` | `#v-discord` > `#discord` | `Discord` | `messengers` | 25-settings-discord.js, 25-settings-onboarding.js | 06-harness.css, 07-messengers.css |
| `jandi` | `#jandi` | `#v-jandi` > `#jandi` | `JANDI` | `messengers` | 25-settings-messengers.js(renderMessenger), 25-settings-onboarding.js | 07-messengers.css, 06-harness.css |
| `slack` | `#slack` | `#v-slack` > `#slack` | `Slack` | `messengers` | 25-settings-messengers.js, 25-settings-onboarding.js | 07-messengers.css, 06-harness.css |
| `telegram` | `#telegram` | `#v-telegram` > `#telegram` | `Telegram` | `messengers` | 25-settings-messengers.js, 25-settings-onboarding.js | 07-messengers.css, 06-harness.css |
| `messengers` | `#messengers` | `#v-messengers` > `#messengers` | `메신저` | `settings` | 25-settings-messengers.js(renderMessengers) | 07-messengers.css, 02-cards-lists-tags.css |
| `provider` | `#provider/<공급자 id>` (`#accounts`, `#settings/accounts`는 `provider/anthropic`) | `#v-provider` > `#provider` | 공급자 이름 (`providerName(provCur)`) | `providers` | 21-providers.js(renderProvider), 25-settings-accounts.js | 02-cards-lists-tags.css, 15-settings-pages.css |
| `devices` | `#devices` | `#v-devices` > `#devices` | `연결된 기기` | `settings` | 25-settings-devices.js | 02-cards-lists-tags.css, 06-harness.css |
| `webaccess` | `#webaccess` | `#v-webaccess` > `#webaccess` | `웹 접속` | `settings` | 25-settings-web-access.js, 25-settings-onboarding.js | 06-harness.css, 07-messengers.css |
| `project` | `#project/<프로젝트 키>` | `#v-project` | `프로젝트` | 폰: `projects`. 1100px 이상: 없음(목록이 옆에 같이 떠 있음) | 19-project-main.js(pmOpen:6) | 08-project-sessions.css, 20-projects.css, 14-overlay.css |
| `projects` | `#projects` (1100px 이상이면 `project`로 바뀌어 열림) | `#v-projects` | `프로젝트` | 탭 루트 | 18-lanes.js(renderProjects:307, prjLoad:141) | 20-projects.css, 08-project-sessions.css |
| `monitoring` | `#monitoring`, `#monitoring/m:<이름>`, `#monitoring/i:<앱>`, `#monitoring/c:<대화 키>` | `#v-monitoring` (`#mon-side`, `#mon-head`, `#mon-tl`) | `모니터링` | `c:` 대화에서 뒤로는 `monitoring`(폰은 선택 항목 유지) | 30-monitoring.js, 30-integrations.js, 30-monitoring-comments.js, 30-monitoring-comments-dm.js, 30-mail-box.js, 30-mail-thread.js, 30-mail-sent.js, 30-replies.js, 30-triage.js, 30-kakao.js, 34-peer-monitoring.js | 20-monitoring.css, 10-conversations.css, 19-volume.css, 20-mail-box.css, 20-mail-thread.css, 17-kakao.css, 18-comments.css, 15-triage.css, 15-reply-card.css |
| `apps` | `appsHash()` 결과 (`APPS_ON=false`라 `home`으로 바뀜) | `#v-apps` (`#apps-side`, `#apps-pane`) | `앱` | 탭 루트 | 30-apps.js, 23-installable-app-web.js(설치 안내만) | 20-apps.css, 10-conversations.css |
| `notices` | `#notices` (`#chat/alert`, `#activity/alert`도 여기로) | `#v-notices` | `알림` | `NSC.ret`이면 `notices`로 돌아옴, 새로 열면 `nscBack` | 31-notices-screen.js, 30-notices.js, 01-notice-ko.js | 09-notices-screen.css, 09-notices.css |
| `cardform` | `#cardform/<id>` | `#v-cardform` (`04-state.js:39`에서 만든 빈 section) | `카드 추가` | `home` | web/custom.js(cardForm:382) | web/custom.js 안의 `CSS` 문자열(`.cu-*`, `.pv-*`) |
| `notifications` | `#notifications` | `#v-notifications` > `#notifications.st-page` | `앱과 알림` | `settings` | 22-settings-pages.js:6, 23-installable-app-web.js(pushSection) | 15-settings-pages.css, 06-harness.css |
| `display` | `#display` | `#v-display` > `#display.st-page` | `표시` | `settings` | 22-settings-pages.js:7,101 | 02-cards-lists-tags.css, 15-settings-phone.css |
| `update` | `#update` | `#v-update` > `#update.st-page` | `업데이트` | `settings` | 24-settings-update.js(updateSection), 22-settings-pages.js:8 | 06-harness.css, 03-base.css(`.upd-bar`) |
| `runtime` | `#runtime` | `#v-runtime` > `#runtime.st-page` | `실행 하네스` | `settings` | 26-settings-runtime.js(hvSection), 22-settings-pages.js:9 | 06-harness.css, 02-cards-lists-tags.css |

### 주소 별칭과 보조 주소
| 입력 | 실제로 여는 곳 | 근거 |
|---|---|---|
| `#chat/alert`, `#activity/alert` | `notices` (`ntGo`가 `NSC.pass`를 세우면 기록 대화) | 05-command-palette.js:107-108 |
| `#lanes` | `chat/list` | 05-command-palette.js:105,108 |
| `#providers/<id>` | `provider/<id>` | 05-command-palette.js:108 |
| `#accounts`, `#settings/accounts` | `provider/anthropic` | 05-command-palette.js:108 |
| `#monitoring/c:<키>`, 모니터링 소유 대화 | 대화 화면을 그리되 탭, 목록, 주소는 모니터링 쪽 | 05-command-palette.js:117-124 |
| `#chat/list` | 폰(1099px 이하)에서만 대화 목록, 넓은 화면은 대화 | 05-command-palette.js:133 |
| `#projects` (1100px 이상) | `project/<ppCur 또는 builtin:custom>` | 05-command-palette.js:126 |
| `#project` (대상 없음), `#provider` (대상 없음) | 각각 `projects`, `providers` | 05-command-palette.js:127-128 |
| 모르는 뷰, 꺼진 앱 탭 | `home` | 05-command-palette.js:125 |

탭(NAV, `04-state.js:22`)은 `home`, `chat`, `projects`, `monitoring`, `apps`(숨김), `settings`예요. `activity`는 `chat`, `project`는 `projects`, `cardform`은 `home` 탭이 켜져요(`navView`, `04-state.js:31`). SUB 화면은 `settings` 탭이 켜져요(`05-command-palette.js:149`).

## 화면별 명세

이 절의 `###`는 화면(뷰) 또는 화면 안의 구성 요소 하나예요. 앱 셸 밖 페이지는 다음 절에 따로 있어요.

### 홈 화면 (`#v-home`)
- 목적: 이 컴퓨터의 상태를 한 화면에 모으고, 카드마다 눌러서 해당 화면이나 대화로 가요.
- 구성: `#v-home` 안에 위에서 아래로 `#home-now`(인사, 답변 필요), `#home-cards`(보드 카드 격자, 위에 `.bbar` 막대), `#home-ended`(끝난 세션 그룹). 카드 격자 순서는 할일(줄이 있을 때), 알림(새 알림이 있을 때), 지금 진행 중, 대기 중(있을 때), 최근 끝난 작업(있을 때), 모니터링, 작업내역, 사용량, 컨텍스트, 공급자, 오너 커스텀 카드예요.
- 기능: 카드 전체가 `tapCard`(role=link, Enter/Space로도 열림)라서 눌러 이동해요. 카드 머리의 ⋯ 버튼은 `menuBtn`/`homeMenu`예요. 화면에 들어올 때 `go("home")`가 `renderHome()`과 `loadHomeData()`를 불러요. 홈이 열려 있으면 60초마다 `loadHomeData` 재실행. 홈 맨 위로 스크롤은 `homeTop`.
- 상태: 제목은 `titles.home` = `홈`. 첫 `loadHomeData`가 끝나기 전에는 `HOME_READY=false`라서 새로 생기는 행에 올라오는 모션을 안 줘요. 상태(`S`)가 아직 없으면 인사말 상태 단어가 `연결 중`. 메뉴가 열려 있으면(`openMenu`가 카드 안) 카드 격자는 닫힐 때까지 다시 그리지 않아요. 폰/데스크톱: 22-shell.css의 `@media (max-width: 1023px)`에서 `#v-home` 안쪽 여백이 줄어요. 카드 격자는 폭 719px 이하(또는 coarse 포인터이면서 767px 이하)에서 한 열로 바뀌어요(`narrowMQ`, 07-board.js 항목 참고). 다른 컴퓨터(peer) 항목은 홈에 안 그려요: `!i.pc`, `!x.pc` 필터(08-home.js:361)이고 다른 컴퓨터는 모니터링 화면 담당이에요.
- 데이터: `GET /api/quota`, `loadProviderData()`(공급자), `loadMonitors()`(모니터링), `pqLoad()`(다른 컴퓨터 스냅샷을 미리 읽기만 함). 상태는 `S`(`/api/state`의 `orchestrator`, `lanes`, `runs`, `work`, `deferred`, `convs`), `C`(컨텍스트 프로세스), `P`(공급자), `M`(모델), `NT`(알림), `NM`(모니터), `INTG`(앱 연동). SSE는 `activity`, `subagents`, `quota`, `notice` 계열을 받아 홈을 다시 그려요(`homeSoon`, `subsChanged`, `quotaLive`).
- 근거: web/js/08-home.js:4 `loadHomeData`, 08-home.js:356 `renderHomeNow`, 08-home.js:448 `renderHome`, 08-home.js:447 `homeTop`, 08-home.js:16 `tapCard`, 08-home.js:94 `homeSoon`; web/index.html:95 (`#v-home`).
- css: 22-shell.css(`#v-home`, `.hgreet`, `.hstrip`, `.hneeds`, `.hn`, `.hr`, `.hrx`), 05-log.css(`.hn`, `.hr`, `.board`, `.bi`, `.glist`, `.grow`), 09-notices.css(`.hc-*`, `.nt-dot`), 02-cards-lists-tags.css(`.card`, `.ch`).

### 홈 인사 영역 (`homeGreeting`)
- 목적: 어시스턴트가 지금 뭘 하는지, 어떤 모델로, 세션 몇 개로, 어느 컴퓨터에서 몇 시인지 한 줄로 알려요.
- 구성: `.hgreet` 안에 `.bigrow`(큰 인사말 `.big` + ⋯ 버튼 `.hgreet-more`), `.meta` 한 줄, 모델이 폴백이면 `.hgreet-fb`, 서브에이전트가 돌면 `.subline`(`subLine("orchestrator")`).
- 기능: ⋯ 버튼은 `homeMenu(btn, MAIN)`(aria-label `어시스턴트 메뉴`). 메뉴: `모델 변경…`, `추론 강도…`, `모델 · 폴백 설정`(`openModels`), `중단`(작업 중일 때만, `abortOrch`), `재시작`(`restartOrch`). `서브에이전트 N개 진행 중` 줄을 누르면 서브에이전트 시트가 열려요(`openSubs`).
- 상태: 인사말은 시간대별 `편안한 밤이에요`(5시 전), `좋은 아침이에요`(12시 전), `좋은 오후예요`(18시 전), `좋은 저녁이에요`. 메타 줄 = `{봇이름}이/가 {상태 단어}` · 모델과 추론 강도 · `세션 {n}개`(살아 있는 세션이 있을 때) · 컴퓨터 이름 · KST 시각. 상태 단어(`homeWord`): `S` 없음 `연결 중`, 지금 진행 중 항목이 있으면 `일하는 중`, 답을 기다리는 대화가 있으면 `답을 기다려요`, 오케스트레이터 상태가 idle이 아니면 `statusKo` 값(`작업 중` `대기` `시작 중` `멈춤` `한도 걸림` `종료됨`), 실행 오류면 `오류로 멈췄어요`, 그 외 `쉬는 중`. 메뉴의 `중단`은 `S.orchestrator.status === "working"`일 때만 나와요. `재시작` 확인 대화상자: 제목 `어시스턴트 재시작`, 본문 `작업 중인 내용이 있으면 멈춰요.`, 버튼 `재시작`, 완료 토스트 `재시작을 요청했어요`. 중단 토스트 `작업을 중단했어요`.
- 데이터: `S.orchestrator`, `S.runs.main`, `M.orchestrator`(모델), `POST /api/orchestrator/restart`, `POST /api/orchestrator/abort`, `PUT` 모델 변경(`putModel`, 이 파일 밖).
- 근거: web/js/08-home.js:330 `homeGreeting`, 08-home.js:321 `homeWord`, 08-home.js:308 `homeGreetWord`, 08-home.js:311 `homeRunning`, 08-home.js:458 `restartOrch`, 08-home.js:464 `abortOrch`.
- css: 22-shell.css(`.hgreet`, `.hgreet-fb`), 03-base.css(`.smodel`), 05-log.css(`.subline`).

### 홈 로그인 풀림 줄 (`nyLogins`)
- 목적: 로그인이 풀린 것을 카드 위 띠가 아니라 답변 필요 카드의 첫 줄로 한 번만 보여요.
- 구성: 답변 필요 목록의 맨 앞 `.hr.hrx` 줄. 제목 `{앱} 로그인이 풀렸어요`, 부제 `{앱} · {시각}`, 오른쪽 글자 `다시 로그인`. 앞 점과 `경고` 태그는 없어요.
- 기능: 알림에서 온 줄은 `noticeOpen(n)`, 앱 연동에서 온 줄은 `go("monitoring", "i:{앱키}")`.
- 상태: 허브가 로그인을 기다린다고 한 알림(`n.waits === "login"`, hub/notices-rules.ts)이 먼저예요. 읽어도 로그인이 돌아올 때까지 남아요. 그런 알림이 없는데 `INTG.items`에 `state === "disconnected"`인 앱이 있으면 그 앱 줄(부제 `다시 로그인해야 이어서 볼 수 있어요`). 이 줄이 된 알림은 알림 카드에서 빠져요.
- 데이터: `NT.items`, `INTG.items`.
- 근거: web/js/09-needs-you.js `nyLogins`, `nyLoginRow`, `nyDownRow`; 08-home.js `renderHomeNow`, `homeAlertCard`.

### 홈 답변 필요 (`nyList`, `nyListNode`)
- 목적: 오너만 할 수 있는 일을 중요한 순서로 모아요.
- 구성: `.hneeds` 안에 머리(`h2` `답변 필요`, 개수 `.sup`, 중요 개수 `.tag.warn` `중요 {n}`), 목록 `.hn[data-k=needs]`, 더 보기 버튼 `.ny-more`, 뒤에 답장 대기 블록(아래 별도 항목).
- 기능: 행을 누르면 각 항목 종류대로 열려요(알림은 `ntHomeRow`/`noticeOpen`, 세션 질문은 `homeNowRow`로 세션 대화, 모니터 실패는 `go("monitoring", key)`). 보내기 승인(rank 1)은 앱별로 묶여 한 행이에요(`ntHomeRows`). 목록은 처음 `NY.top`=5행만 보이고 `더 보기 · {n}개` / `접기`로 펼쳐요(`NY.more` 토글 후 `renderHomeNow`).
- 상태: 정렬 rank 0 중요(로그인, 게이트웨이 실패), 1 보내기 확인, 2 결정/모니터 3번 연속 실패, 3 세션 질문, 4 일반 질문. 우측 라벨(`act`)은 `로그인`, `보내기 확인`, `선택`, `답변`, `확인 필요`. 중요 행은 `.crit`, 실패 톤은 빨강. 다른 컴퓨터 알림이면 행에 컴퓨터 이름 태그(`.tag.mon-pc`). 모니터 실패 행 문구 `{n}번 연속 실패했어요 · {마지막 요약}`, 제목은 모니터 이름, `NY_FAILS=3`회 이상이고 `paused` 아닌 이 컴퓨터 모니터만. 게이트웨이가 스스로 처리하는 질문은 여기에 안 나오고(`nyHandled`) 알림 카드 뉴스로 가요. 비어 있으면 `답변할 항목이 없어요`. 접근성: 행 aria-label 끝의 `답변 필요`가 `중요 · {act}` 또는 `{act}`로 바뀌어요.
- 데이터: `S.lanes`(세션 `pendingAsk`), `ntDecisions()`, `ntLooseAsks()`, `monItems()`(`m.fails`, `m.paused`, `m.last_run`, `m.last_summary`), `NT`, `DONE`/`SEEN`(localStorage `dotz-done`, `dotz-seen`).
- 근거: web/js/09-needs-you.js:154 `NY`, 09-needs-you.js:156 `nyOf`, 09-needs-you.js:170 `nyMonFails`, 09-needs-you.js:177 `nyList`, 09-needs-you.js:186 `nyRows`, 09-needs-you.js:210 `nyMonRow`, 09-needs-you.js:219 `nyListNode`; 08-home.js:373 (머리 렌더).
- css: 22-shell.css(`.hneeds`, `.ny-more`), 05-log.css(`.hn-h`, `.hn`, `.hr`, `.ny-more`), 02-cards-lists-tags.css(`.tag`).

### 홈 답장 두 줄 (`homeRepliesRow`, `homeOwedRow`)
- 목적: 확인을 기다리는 답장 초안과 답하지 않은 댓글이 있다는 걸 답변 필요 카드의 마지막 두 줄로 알려요.
- 구성: 답변 필요 목록 끝의 `.hr[data-k=replies]`(`답장 초안 확인`)와 `.hr[data-k=owed]`(`답 안 한 댓글`). 부제는 출처별 수(많은 순, 0은 빼요: `메일 1 · 유튜브 1`), 오른쪽 `.nb` 배지는 합계(99 넘으면 `99+`). 따로 머리는 없어요.
- 기능: 초안 줄은 `rqOpen()`. 댓글 줄은 출처가 하나면 `go("monitoring", 앱키)`, 둘 이상이면 `go("monitoring")`.
- 상태: 수가 0인 줄은 그리지 않아요. 답변 필요 머리의 숫자는 카드 안 줄 수라 이 두 줄도 세요. 이 컴퓨터 것만(`!i.pc`).
- 데이터: `rqRows()`(보낸 것 제외), `monItems()`(`i.app`, `i.unreplied`).
- 근거: web/js/08-home.js `homeCountRow`, `homeRepliesRow`, `homeOwedRow`, `renderHomeNow`.
- css: 05-log.css(`.hr`), 22-shell.css(`.hneeds`).

### 홈 지금 진행 중 (카드 `now:running`)
- 목적: 지금 돌고 있는 것만 보여요: 세션 턴, 앱 대화의 작업, 백그라운드 작업, 한도 리셋을 기다리는 작업.
- 구성: 카드 머리(`지금 진행 중`, 개수 `{n}개`)와 `.hn[data-k=running]`. 세션은 `sessionsNow`가 정해요: 답을 기다리는 세션이 맨 위(`답을 기다림`), 나머지는 오래된 순서이고 행 이름은 `프로젝트 · 제목`이에요. 저장해 둔 상태(`S.seeded`)로는 아무것도 올리지 않아요. 행 종류는 (1) 세션/어시스턴트 행(`homeNowRow`), (2) 앱 대화 행(`homeConvRow`), (3) 백그라운드 작업 행(`workRow`), (4) 한도 대기 행(`homeLimitRow`).
- 기능: 어시스턴트 행은 `openTarget(t, lastChatView())`로 대화 열기. 세션 행은 `sessionRow`(아래 세션 행 항목). 앱 대화 행은 `go("chat", target)`. 작업 행은 `workGo`(진행 중이면 대화로, 끝났으면 결과 메시지로). 새로 생기는 행은 위에서 올라오는 모션(`motionIn`).
- 상태: 허브 상태를 받기 전엔 `불러오는 중…`(연결이 끊겼으면 `불러오지 못했어요`), 받은 뒤 비어 있으면 `진행 중인 작업이 없어요`(할일·답변 필요 카드도 같은 규칙). 행 미리보기 우선순위: 답변 필요일 때 질문 문구, 런 상태 줄(`runText`), 최신 활동 줄(`nowLine`), 모델 칩, 상태 단어. 서브에이전트가 있으면 `서브에이전트 {끝남}/{전체}`(title `서브에이전트 끝난 수 / 전체`). 폴백 모델이면 세션 행에 모델과 폴백 태그. 앱 대화 행 상태 `작업 중` 또는 `진행 중`, aria-label `{이름} · {상태} · 대화 열기`. 한도 대기 행: 배지 `한도 리셋되면 재개 ({HH:MM})`, 시각을 못 읽으면 `한도 리셋되면 재개`. 방금 끝난 작업은 `HC_KEEP`=6초 동안 이 카드에 `완료`로 남았다가 모션(`motionSwap`)으로 최근 끝난 작업으로 가요.
- 데이터: `S.orchestrator`, `S.lanes`, `S.runs`, `S.work`, `S.convs`, `S.deferred`, `SUBS`, `LAST`(세션별 마지막 활동 줄), `GET /api/activity?source=lane:{name}&limit=30`(처음 한 번), `S.work_skew`.
- 근거: web/js/08-home.js:311 `homeRunning`, 08-home.js:230 `homeNowRow`, 08-home.js:250 `homeConvRow`, 08-home.js:271 `homeLimitRow`, 08-home.js:283 `hcSettled`, 08-home.js:371-372, 08-home.js:393.
- css: 05-log.css(`.hr`, `.hn`, `.hrx`), 22-shell.css(`.hr`, `.hn`), 10-conversations.css(`.hr`).

### 홈 대기 중 / 최근 끝난 작업 (카드 `now:waiting`, `now:ended`)
- 목적: 쉬는 중인 대화와 최근 1시간 안에 끝난 백그라운드 작업을 따로 모아요.
- 구성: 카드 머리 `대기 중` + `.hn[data-k=waiting]`, 카드 머리 `최근 끝난 작업` + `.hn[data-k=ended-work]`. 항목이 없으면 카드 자체를 안 만들어요.
- 기능: 대기 행은 `homeNowRow`와 같아요(세션 대화로). 끝난 작업 행은 `workRow`: 결과 파일 칩(텍스트 파일이면 `viewer`, 아니면 새 탭 링크), `다시 맡기기` 버튼(사용자가 중단한 작업만, `workRetry`).
- 상태: 끝난 작업 목록은 `workEnded()`: 실패했지만 에이전트가 이미 넘겨받은 것(`handled`)은 빠져요. 행 상태 문구는 `작업 중`, `멈춤`, `완료`, `중단됨`, `이어서 처리 중`(실패 후 에이전트가 처리 중), `실패`. 부제: 진행 중 `{N분째 또는 방금 시작} · {모델}`, 멈춤 `{이유 또는 활동이 없어요} · {시간}`, 완료 `끝남 · {방금/N분 전/N시간 전}`, 실패 `실패 · {이유 또는 이유가 기록되지 않았어요} · {시간}`(중단됨이면 `중단됨 · {시간}`). 톤: 진행/처리 중 파랑(pri), 멈춤 주황(warn), 완료 초록(ok), 실패 빨강(err), 중단/넘겨받음 회색. aria-label은 `{설명} · {상태} · 대화로 가기` 또는 `결과 보기`.
- 데이터: `S.work`(`id`, `status`, `description`, `model`, `started_at`, `ended_at`, `reason`, `cancelled`, `handled`, `files`, `target`, `reply_to`, `result_at`, `result_conv`). `POST /api/workers/{id}/retry`(다시 맡기기), `POST /api/workers/{id}/cancel`(중단, 확인 대화상자 `백그라운드 작업 중단` / `하던 작업을 멈춰요. 필요하면 다시 맡길 수 있어요.`, 이 홈에서는 안 쓰고 입력창 중단 버튼에서 호출). 15초마다 작업이 돌면 `refreshState()`.
- 근거: web/js/08-home.js:533 `workRow`, 08-home.js:302 `hcWorkFiles`, 08-home.js:394-395; web/js/06-subagents.js:11 `workEnded`, 06-subagents.js:13-17 (`workRecovering`, `workTone`, `workFailText`), 06-subagents.js:25 `workRetry`, 06-subagents.js:43 (15초 타이머); web/js/18-lanes.js:34 `workGo`.
- css: 05-log.css(`.hrx`, `.hrx-f`), 22-shell.css(`.hrx`, `.hrx-f`), 09-notices.css(`.hrx`).

### 홈 알림 / 작업내역 / 모니터링 카드
- 목적: 최근 알림, 작업 기록, 모니터링 상태를 카드마다 3~4줄 미리 보여요.
- 구성: `hcCard`(`.card.tap.hc`)에 머리(`hcHead`: 상태 점, `h3` 제목, 개수/메모, ⋯ 버튼)와 `.hc-list`. 알림/작업내역 행 `.hc-row`(점 `.nt-dot`, 제목과 세션 메모, 시각, 필요하면 무시 버튼). 모니터링 행 `.hc-mon[data-status]`(점, 이름, `실행 · 상태 · 다음` 문구).
- 기능: 카드 전체 탭은 알림 `nscGo`, 작업내역 `openTarget("worklog","chat")`, 모니터링 `go("monitoring")`. 각 행은 `noticeOpen(n)`로 그 항목을 열고 이벤트 전파를 막아요. ⋯ 메뉴: `알림 열기`/`작업내역 열기`/`모니터링 열기` + `앞으로 옮기기`/`뒤로 옮기기`.
- 상태: 알림 카드 머리에 안 읽은 수. 불러오기 전 `불러오는 중…`, 실패 `불러오지 못했어요`, 알림 비어 있음 `새 알림이 없어요`, 작업내역 비어 있음 `아직 작업내역이 없어요`, 모니터링 비어 있음 `모니터링 중인 항목이 없어요`. 모니터링은 4개까지, 더 있으면 `더 보기 · {n}개`, 실패가 있으면 머리에 빨간 점과 `실패 {n}`. 알림 카드는 안 읽은 새 소식만 최대 3개(게이트웨이 재시작 알림 제외, 이미 답변 필요에 있는 질문 제외). 제목이 `작업 기록`/`작업내역`/`알림`처럼 일반적이면 본문 첫 줄을 대신 보여요.
- 데이터: `NT`(`loaded`, `failed`, `items`), `NM`(`loaded`, `failed`), `ntMons()`, `monStatus(m)`. 갱신은 알림/모니터링 SSE 후 `homeSoon`(500ms 디바운스).
- 근거: web/js/08-home.js:153 `homeAlertCard`, 08-home.js:158 `homeWorklogCard`, 08-home.js:162 `homeMonitorCard`, 08-home.js:136-152 (헬퍼), 08-home.js:144 `hcRecent`, 08-home.js:147 `hcFyi`.
- css: 09-notices.css(`.hc-list`, `.hc-row`, `.hc-mon`, `.hc-none`, `.hc-more`, `.hc-n`, `.nt-dot`), 02-cards-lists-tags.css(`.ch`), 05-log.css(`.ch`).

### 홈 사용량 / 컨텍스트 / 공급자 카드
- 목적: 사용량 한도, 컨텍스트 사용률, 모델 공급자 로그인 상태를 카드로 보여요. 기본은 종류별로 한 카드에 묶여 있어요.
- 구성: 종류 `limit`(사용량), `ctx`(컨텍스트), `prov`(공급자). 묶음 카드 `group:{kind}`는 머리(제목, 개수, ⋯)와 `.glist` 안 `.grow` 행들. 묶지 않으면 항목마다 카드(`limit:{공급자}:{id}`, `ctx:{프로세스}`, `prov:{id}`), 안에 `.bar` 진행 막대(`role=progressbar`, `aria-valuenow`).
- 기능: 카드/행 탭은 `go("usage")`, `go("context")`, `go("provider", id)`. 묶음 카드 탭은 `usage`, `context`, `providers`. 행의 ⋯ 메뉴(아래 항목). 묶을지 여부는 localStorage `dotz-home-groups`(기본 `["ctx","limit","prov"]`)에 저장(`setHomeGroup`).
- 상태: 컨텍스트 값 `{percent}%` 또는 `{토큰수} 토큰`, 80% 이상이면 주황 점. 사용량은 한도에 닿았거나 남은 비율이 20% 이하이면 주황. 공급자: 로그인 필요면 `로그인 필요`(주황 점), 아니면 `API 키` 또는 `로그인됨`(초록 점), 계정이 있으면 `.sup`에 계정. 연결 안 됐고 주의도 필요 없는 공급자는 안 보여요. 묶음 빈 상태: 데이터 전 `불러오는 중…`, 사용량 읽기 실패 `사용량을 불러오지 못했어요`, 그 외 `없어요`. 묶음 카드 머리 점은 하나라도 주의면 주황, `err`가 있으면 빨강. 컨텍스트는 실행 중인 프로세스만(`x.running`). 아직 데이터가 안 온 카드는 저장된 자리를 유지해요(보드 `keep`).
- 데이터: `GET /api/quota`(`HQ.providers[].limits`), `C.processes`, `P.providers`, `POST /api/compact`.
- 근거: web/js/08-home.js:402-438 (`E` 구성과 `add`), 08-home.js:179 `HOME_KINDS`, 08-home.js:183 `setHomeGroup`, 08-home.js:192 `homeRow`.
- css: 05-log.css(`.glist`, `.grow`, `.gm`, `.kv`), 02-cards-lists-tags.css(`.kv`, `.card`, `.ch`), 22-shell.css(`.card`).

### 홈 카드 ⋯ 메뉴 (`homeMenu`)
- 목적: 카드/행마다 이미 있는 엔드포인트로 할 수 있는 동작만 메뉴로 보여줘요.
- 구성: `menuBtn`(aria-label/title `설정`, `aria-haspopup=listbox`)이 `showMenu`를 열어요. 항목은 클릭 시점의 상태로 만들어요.
- 기능: 묶음 카드 `카드로 나누기`, `{제목} 열기`. 알림류 `{알림|작업내역|모니터링} 열기`. 어시스턴트/세션 `모델 변경…`, `추론 강도…`, `모델 · 폴백 설정`, `중단`, `재시작`. 세션 `중단` = `POST /api/lanes/{n}/abort`(토스트 `작업을 중단했어요`), `재시작` = 확인 `{n} 재시작` / `이 세션을 다시 시작할까요?` / 버튼 `재시작`, `POST /api/lanes/{n}/restart`(토스트 `재시작했어요`). 공급자 `다시 로그인`/`로그인`, `키 삭제`/`로그아웃`, `공급자 열기`. 컨텍스트 `압축`(`POST /api/compact`, 토스트 `{name}: 압축을 시작했어요` 또는 큐에 들어가면 `{name}: 작업 중이라 끝나면 압축해요`), `컨텍스트 열기`. 사용량 `사용량 열기`, `공급자 열기`. 개별 카드에서 `{종류} 한 카드로 묶기`. 공통 `앞으로 옮기기`, `뒤로 옮기기`(`homeBoard.moveBefore`). 커스텀 카드는 `dotzCustom.menuActs`.
- 상태: 컨텍스트 압축은 프로세스가 실행 중이고 압축이 대기/진행 중이 아닐 때만. 어시스턴트의 `중단`은 작업 중일 때만. 대화(`inChat`) 모드에서는 이동/묶기 항목 숨김.
- 데이터: `POST /api/lanes/{n}/abort`, `POST /api/lanes/{n}/restart`, `POST /api/compact`, `POST /api/orchestrator/restart|abort`.
- 근거: web/js/08-home.js:26 `homeMenu`, 08-home.js:83 `homeMoveActs`, 08-home.js:23 `menuBtn`.
- css: 02-cards-lists-tags.css(`.ib`), 03-base.css(`.mi` 메뉴 항목).

### 홈 보드 (`makeBoard`)
- 목적: 홈 카드를 끌어서 옮기고 크기를 바꾸고 배치를 저장해요(12열 격자).
- 구성: 컨테이너 `#home-cards.board.rows`, 위에 `.bbar`(버튼 `카드 추가`, `배치 초기화`), 카드 래퍼 `.bi[data-id]`(리사이즈 핸들 `.brz.e/.s/.se`), 드래그 자리표시 `.bph`. 카드 머리 `.ch`가 드래그 손잡이(`.bhead`, tabindex=0, title `끌거나 방향키로 옮기고, Shift+방향키로 크기를 바꿔요`).
- 기능: 마우스는 머리를 4px 이상 끌면 이동, 가장자리 핸들로 크기 조절. 키보드는 방향키 이동, Shift+방향키 크기. 폰/좁은 화면은 한 열이고, 터치로 450ms 길게 눌러(`B_PRESS`) 들어 올려 순서를 바꿔요(8px 이상 움직이면 스크롤로 취급). Esc는 들어 올린 카드를 되돌려요. 끌 때 가장자리 56px에서 자동 스크롤. `reorder`, `moveBefore`(⋯ 메뉴의 `앞으로 옮기기`/`뒤로 옮기기`), `resize`. `카드 추가`는 `dotzCustom.add()`, `배치 초기화`는 `reset()`(커스텀 카드 숨김 해제 후 다시 그림).
- 상태: 홈은 `px`+`rows` 모드라서 모든 카드가 내용 높이(`fit`)이고 폭만 정해져요(기본 6칸=절반, 최소 6, 최대 12). 한 줄 두 장이 짝이면 둘이 더 큰 높이로 맞춰져요(`measureRows`). 저장은 localStorage `dotz-board-home`(`_u:"px"`, `_g:"rows"`, `_order`); `_g`가 없는 옛 배치는 한 번 초기화돼요. 좁은 화면(`narrowMQ` = `(max-width: 719px), (pointer: coarse) and (max-width: 767px)`)에서는 위치 대신 순서(`style.order`)로만 쌓여요. coarse 포인터에서 리사이즈 핸들은 `.se`만 보이고 카드 머리 ⋯ 버튼이 40px로 커져요(05-log.css:193, 230). 카드가 하나도 없으면 `.bbar` 숨김. 드래그 중에 들어온 갱신은 `pending`으로 미뤘다가 놓은 뒤 반영해요. `prefers-reduced-motion`이면 전환 없음.
- 데이터: localStorage `dotz-board-home`. 서버 호출 없음.
- 근거: web/js/07-board.js:62 `makeBoard`, 07-board.js:10 `narrowMQ`, 07-board.js:151 `measureRows`, 07-board.js:175 `set`, 07-board.js:211 `reset`, 07-board.js:281 `reorder`, 07-board.js:356 (pointerdown), 07-board.js:371 (keydown), 07-board.js:394 `resize`, 07-board.js:404 `moveBefore`; web/js/08-home.js:448 (`makeBoard(box, "home", ...)`), 08-home.js:177 `HOME_FIT`.
- css: 05-log.css(`.board`, `.bi`, `.bph`, `.bhead`, `.brz`, `.bbar`), 22-shell.css(`.bbar`, `.bi`).

### 끝난 세션 그룹 (`details.ended`, `endedGroup`)
- 목적: 끝난 세션(레인)을 한 줄로 접어 두고 열어서 다시 열람/삭제해요. 홈 아래와 채팅 목록에 같이 쓰여요.
- 구성: `details.ended`(선택 모드면 `.selecting`)의 `summary`에 화살표, 라벨 `끝난 세션 {n}`, 개수 `.ecounts`(`답변 필요 {n}`, `안 읽음 {n}`), 도구 `.etools`(`선택`). 안에 행 `.erow`(`button.er` 세션 열기 + 삭제 `button.ib.edel`). 선택 모드는 `label.er` 체크박스 행과 맨 위 `전체 선택`(`{선택}/{전체}`).
- 기능: 행 탭은 `openTarget("lane:{name}", lastChatView())`. 삭제 아이콘(aria-label `{name} 삭제`, title `삭제`) 또는 `선택` 후 `삭제 {n}개` 버튼 → `deleteEnded`. `취소`는 선택 모드 해제. 접힘 상태는 `endedOpen`에 기억하고, 닫으면 선택 모드도 풀려요.
- 상태: 끝난 세션이 없으면 그룹이 없어요(null). 행 표시: 세션 제목(없으면 이름), `.sup`에 `프로젝트 · 시작일`, 답변이 남은 세션이면 `답변 필요` 태그, 안 읽은 수 배지(99 넘으면 `99+`, aria-label `읽지 않은 메시지 {n}개`; 끝난 세션의 안 읽음은 서버가 항상 0으로 줘서 사실상 안 뜸). 삭제 확인 대화상자: 제목 `{name} 삭제` 또는 `세션 {n}개 삭제`, 본문 `휴지통으로 옮겨요. 7일 안에는 되돌릴 수 있어요.`, 버튼 `취소`, `삭제`/`{n}개 삭제`. 성공 토스트 `{name} 삭제했어요` 또는 `{n}개 삭제했어요`에 `되돌리기` 버튼(8초, `UNDO_MS`)이 붙고, 복구 성공 `되돌렸어요`, 일부 실패 `{n}개는 되돌리지 못했어요. 휴지통에 그대로 있어요`. 일부가 거부되면 대화상자 `{name} 세션은 그대로 뒀어요` / `세션 {n}개는 그대로 뒀어요`, 본문 `아무것도 지우지 않고 그대로 뒀어요.`, 이유(미커밋 변경 `아직 커밋하지 않은 변경이 있어요. 커밋하거나 정리하면 지울 수 있어요.`, 실행 중 `아직 실행 중이에요. 멈춘 뒤에 지울 수 있어요.`, 그 외 `작업 폴더를 정리하지 못했어요. 잠시 뒤에 다시 해 보세요.`), 버튼 `확인`. 터치 기기에서 도구 버튼 36px(04-files.css:64).
- 데이터: `S.lanes`(`live`, `status`, `startedAt`, `title`), `POST /api/lanes/delete` `{names}`, `POST /api/lanes/restore` `{ids}`(게이트웨이 휴지통 7일 보관).
- 근거: web/js/04-state.js:44 `laneAlive`, 04-state.js:45 `endedLanes`, 04-state.js:51 `refreshEnded`, 04-state.js:55 `endedMark`, 04-state.js:56 `endedGroup`, 04-state.js:90 `deleteEnded`, 04-state.js:114 `keptWhy`, 04-state.js:117 `keptLanes`, 04-state.js:123 `restoreEnded`; 호출처 08-home.js:386-387 (`#home-ended`), 31-conversations.js:352.
- css: 04-files.css(`.ended`, `.erow`, `.etools`, `.ecount`), 22-shell.css(`.ended`).

### 세션 행 (`sessionRow`)와 세션 상태 (18-lanes.js)
- 목적: 세션(레인)을 제목, 소속 프로젝트, 상태 단어로 한 행에 보여요. 탭하면 그 세션 대화로 가요.
- 구성: `button.hr.srow[data-t=lane:{name}]` 안에 상태 점, `.hb`(`.hn1 .nm` 제목, `.ha`에 `.sproj` 프로젝트, 있으면 `.sline` 활동 줄과 모델 `.smodel`), 서브에이전트 `.hp`, 상태 `.hs`.
- 기능: 기본 클릭은 `openTarget("lane:{name}", lastChatView())`(`o.open`으로 바꿀 수 있음). 홈의 지금 진행 중/대기 중/답변 필요가 이 행을 써요. `openLaneChat(name)`은 채팅 대화로 열기.
- 상태: 프로젝트 이름은 세션이 시작된 작업 채널(`laneHome`)로만 찾고, 없으면 `프로젝트 없음`(`.sproj.none`). aria-label `{이름} · 프로젝트 {proj} 또는 프로젝트 없음 · {상태} · 대화 열기`. 상태 단어(`sessionState`: `진행 중`/`답을 기다림`/`완료`, 멈춘 세션은 제 단어. `sessionStatus` -> `runStatus`): 끝났으면 `종료됨`이 아니라 이 행에서는 `끝남`(회색), 실행 중 `작업 중`(파랑), `답을 기다려요`(주황), `순서 대기`/`진행 중`(핸드오프 작업, 파랑), `한도 걸림`(주황), `오류`(빨강), 그 외 `statusKo`(`대기` 등). 답변 필요 행은 `word: "답변 필요"`, 주황으로 덮어써요.
- 데이터: `S.lanes`(`name`, `title`, `status`, `live`, `home`, `project`, `pendingAsk`, `lastText`), `S.channels.homes`/`S.channels.work`, `PRJ`(프로젝트 목록), `S.runs`, `SUBS`.
- 근거: web/js/18-lanes.js:168 `sessionRow`, 18-lanes.js:162 `sessionStatus`, 18-lanes.js:151 `laneHome`, 18-lanes.js:153 `laneProject`, 18-lanes.js:30 `openLaneChat`; web/js/41-runstate.js:20 `runStatus`.
- css: 03-base.css(`.srow`), 05-log.css(`.sproj`, `.sline`, `.hr`), 08-project-sessions.css(세션 관련).

### 세션 마지막 보고와 활동 줄 (`LP`, `laneRecent`)
- 목적: 세션의 최근 활동과 마지막 보고를 한국어 문장 3줄로 요약해요.
- 구성: 화면 요소는 이 파일에 없고 데이터 계층이에요. `LP[name]`에 `acts`(최대 12줄, `LANE_ACTS`), `rev`, `loaded`, `loading`, `failedAt`.
- 기능: `laneLoad(p)`로 활동/히스토리를 읽고, `laneActivity(a)`가 SSE `activity`마다 이미 불러온 세션을 갱신하며 홈용 마지막 줄(`LAST[name]`)도 갱신해요. `laneResultGo(name, at)`는 끝난 세션의 결과(해당 시각에 가장 가까운 보고)로 점프해요. `laneRecent`는 최신 3줄, 같은 줄 반복은 `{문장} ({n}번)`, 보고는 `보고 · {문장}`(없으면 `내용을 남겼어요`).
- 상태: 도구 호출 한국어 `명령을 실행했어요`, `파일을 고쳤어요`, `파일을 읽어봤어요`, `코드를 찾아봤어요`, 오류 `오류가 있었어요`, 턴 종료 `이번 작업을 마쳤어요`. 읽기 실패면 `failedAt` 기록. 재연결 시 `laneTailsStale()`이 `loaded=false`로 되돌려요.
- 데이터: `GET /api/activity?source=lane:{name}&limit=40`, `GET /api/history?target=lane:{name}&limit=30`, SSE `activity`.
- 근거: web/js/18-lanes.js:2 `LP`, 18-lanes.js:57 `laneActKo`, 18-lanes.js:68 `laneRecent`, 18-lanes.js:95 `laneLoad`, 18-lanes.js:109 `laneActivity`, 18-lanes.js:21 `laneResultGo`; web/js/99-boot.js:43.
- css: 해당 없음(화면 요소 없음).

### 프로젝트 목록 (`#v-projects`, 18-lanes.js)
- 목적: 프로젝트를 상태 순서로 훑고 열어요. 파일은 세션 쪽 18-lanes.js에 있지만 프로젝트 화면 담당과 겹치므로 요약만 적어요.
- 구성: `#pl-shell` 안에 검색 `#pl-q`(placeholder `프로젝트 검색`), 칩 `전체`/`진행 중`/`확인 필요`/`끝남`(탭, 개수 표시), 목록 `#pl-list`(섹션 `고정`, `프로젝트`, 맨 뒤 `세션`, 있으면 `내 설정`).
- 기능: 행 탭은 `go("project", key)`. `프로젝트 {n}개 더 보기`(12개씩, `PJ_PAGE`). `세션과 채널` 행은 `go("chat","list")`, 부제 `일하는 세션 {n}개 · 작업 채널 {n}개`. 내 설정 행 부제 `내가 바꾼 것을 봐요`.
- 상태: 프로젝트 상태 태그 `일시 정지`, `답을 기다려요`, `끝남`, `쉬는 중`, `세션 없음` 또는 세션 상태 단어. 로드 전 `불러오는 중…`, 실패 `프로젝트를 불러오지 못했어요`. 프로젝트가 없으면 `아직 프로젝트가 없어요. 채팅에서 오래 걸리는 작업을 맡기면 여기에 생겨요` + `채팅 열기` 버튼. 필터 결과 없음: `찾는 프로젝트가 없어요`, `확인할 프로젝트가 없어요`, `지금 진행 중인 프로젝트가 없어요`, `끝낸 프로젝트가 없어요`, `아직 프로젝트가 없어요`. 읽지 않은 수 배지(`읽지 않은 메시지 {n}개`).
- 데이터: `GET /api/custom`(`PRJ`), `S.lanes`.
- 근거: web/js/18-lanes.js:141 `prjLoad`, 18-lanes.js:185 `prjState`, 18-lanes.js:230 `prjRow`, 18-lanes.js:269 `pjPaintRows`, 18-lanes.js:307 `renderProjects`.
- css: 20-projects.css, 08-project-sessions.css.

### 서브에이전트 줄과 시트 (`#sheet`)
- 목적: 돌고 있는 서브에이전트를 목록으로 보고, 하나의 기록(트랜스크립트)을 읽어요.
- 구성: 채팅에서는 입력창 위 상태 줄 오른쪽 끝의 `button.rs-subs`(`서브에이전트 N ›`, 상태 글이 없으면 줄 전체가 `서브에이전트 N개 진행 중 ›`), 활동 화면의 `.subs`(`button.subsum`)와 홈의 `.subline`. 시트 `aside#sheet`(role=dialog, aria-label `서브에이전트`) 안에 머리(`#sh-back`, `#sh-name`, `#sh-sub`, `#sh-tag`, `#sh-close`)와 본문 `#sh-body`.
- 기능: 줄을 누르면 `openSubs([source])`. 목록 행(`button.subrow`)을 누르면 `openSub(source, id, sources)`로 하나의 기록. 뒤로(`#sh-back`, aria-label `목록으로`)는 목록으로, 닫기 `#sh-close`(aria-label `닫기`) 또는 Esc. 닫으면 열었던 요소로 포커스 복귀. 실행 중인 서브에이전트만 목록에 나와요(생성 순서). 기록 열린 상태에서 상태가 `running`이면 3초마다 다시 읽고, 스크롤은 바닥에 붙어 있을 때만 따라가요. 펼쳐 둔 항목은 다시 그려도 유지.
- 상태: 서브에이전트는 대화마다 따로 세어요(`subsSourceOf`: 메인은 `orchestrator`, 자기 세션이 있는 대화는 `conv:<대상>`이라 메일·프로젝트 대화에 메인의 서브에이전트가 비치지 않아요). 활동 화면 줄 문구 `서브에이전트 {n}개 진행 중`. 목록 제목 `서브에이전트 {n}개 진행 중`, 부제는 출처 이름들, 비었으면 `진행 중인 서브에이전트가 없어요`. 행: 설명(없으면 agent, 없으면 `서브에이전트`), 의도/도구 한 줄, 출처가 여럿이면 출처 태그, 경과 시간 `N분째`/`방금 시작`. 기록 화면 제목은 설명(또는 agent), 부제 `{대상 이름} · 서브에이전트`, 상태 태그 `진행 중`, `완료`, `실패`, `중단됨`(톤 pri/ok/err/없음). 로딩 `불러오는 중…`, 오류 `기록을 불러오지 못했어요`, 비어 있음 `기록이 없어요`. 로그 보기(`mode term`)이면 본문이 터미널 노드 모양(`sh-body term`), 아니면 대화 모양(`actNode`). 폰: 폭 639px 이하에서 시트가 `100vw`, 테두리 없음(05-log.css:121).
- 데이터: `GET /api/subagents`(`{sources}`), `GET /api/subagents/{id}?source={source}`, SSE `subagents`(`setSubs(source, items)`).
- 근거: web/js/06-subagents.js:44 `setSubs`, 06-subagents.js:49 `loadSubs`, 06-subagents.js:53 `subsChanged`, 06-subagents.js:58 `subLine`, 06-subagents.js:71 `renderSubs`, 06-subagents.js:92 `showSheet`, 06-subagents.js:102-104 (`openSubs`, `openSub`, `closeSheet`), 06-subagents.js:113 `loadSub`, 06-subagents.js:124 `renderSubSheet`; web/index.html:167-174 (`#sheet`).
- css: 05-log.css(`.sheet`, `.sh-body`, `.subrow`, `.subsum`, `.subline`), 07-chat.css(`.subsum`), 01-tokens.css(`.sheet`).

### 활동 / 터미널 로그 보기 (`#v-activity`, `LOG_VIEW`)
- 목적: 한 대화의 에이전트 활동을 명령/출력 줄로 보는 로그 화면. 코드에는 있지만 지금은 꺼져 있어요(`LOG_VIEW = false`).
- 구성: `#v-activity` 안에 `.subs`, `.termbox`(`#term`, 맨 아래로 `#act-jump`). `#term` 안에 턴 카드 `section.lg`(머리 `.lg-h`: 점, 제목 `.lg-t`, 시각/길이 `.lg-m`; 본문 `.lg-b`), 접힌 작업 묶음 `details.ls`(요약 `.ls-s`), 행 `.lr`(종류 `.lr-k`, 라벨 `.lr-l`, 소요 `.lr-d`, 점, 출력 `.lr-o`), 서브에이전트 행 `.lw`와 아래 `.lw-s`/`.lw-r`.
- 기능: 행을 누르면 펼침/접힘(`toggleOpen`, Enter/Space 지원, 글을 드래그해서 선택 중이면 무시). 서브에이전트 하위 행을 누르면 그 기록 시트(`openSub`, title `서브에이전트 기록 열기`). `이전 기록 더 보기`(`.tmore`)는 이전 300개 로드(`loadOlder`). 맨 아래로 `#act-jump`.
- 상태: `LOG_VIEW`가 꺼져 있어서 `viewFor`가 항상 `chat`을 돌려주고 `go("activity")`는 채팅으로 바뀌며(`05-command-palette.js:136`), 대화/로그 전환 토글 `#vtog`가 숨겨져요(`05-command-palette.js:152`, `16-target-switcher-conversation.js:93`). 켜지면: 세션별 선택은 localStorage `dotz-lane-view:{target}`, 그 외는 `dotz-chat-mode`. 점 색: 진행 중 파랑, 오류 빨강, 도구를 쓴 턴 초록. 요약 `{N초 작업 | 작업} · 명령 3 · 읽기 2 · 오류 {n}`(종류 `명령` `읽기` `수정` `검색` `서브에이전트` `웹` `기록` `도구`, 생각은 `생각`). 도구 결과 출력이 없으면 `(출력 없음)`. 오류 한 줄 아래 `자세히` 펼침. 게이트웨이 프롬프트는 짧은 라벨로 줄여요: `작업 중에 온 메시지`, `작업 중에 온 세션 보고`, `재시작 뒤 다시 처리`, `답을 기다리는 중`, `사용량 한도 풀림`, `모델 제공자 복구`, `일시 오류 뒤 다시 시도`, `대화 정리 뒤 지침 다시 읽기`, `첫 시작`, `캐시 유지 신호`, `야간 자기 점검`, `이전 대화 이어받기`, `세션 보고`, `모니터링 · {이름}`, `새 메일`, `예약 작업`, 빈 제목은 `메시지`. 런타임 상태는 한국어(`컨텍스트 압축 중`, `컨텍스트 압축 완료`, `다시 시도 중 (N/M)`, `모델 전환 · {모델}`, `{이름} 대화 기록 이어서|새로 시작 · {모델}`). 로드 전 `불러오는 중…`, 활동 없음 `활동이 없어요`, 과거 기록 구분선 `지난 기록`. 폰: 639px 이하에서 `.lg` 패딩 축소(05-log.css:40), `.lw-s` 들여쓰기(03-base.css:282).
- 데이터: `GET /api/activity?source={source}&limit=300`(`before=` 로 이전 300개), SSE `activity`(`ingestAct` -> `termPush`).
- 근거: web/js/04-state.js:30 `LOG_VIEW`, 04-state.js:33 `viewFor`; web/js/12-terminal-view.js:127 `termNode`, 12-terminal-view.js:29 `logGroup`, 12-terminal-view.js:41 `logSteps`, 12-terminal-view.js:54 `logRow`, 12-terminal-view.js:20 `statusKoLine`, 12-terminal-view.js:93 `promptOf`, 12-terminal-view.js:184 `paintWorkers`, 12-terminal-view.js:194 `termPush`; web/index.html:139-145.
- css: 05-log.css(`.lg`, `.lg-h`, `.ls`, `.lr`, `.lg-q`, `.lg-e`, `.tdv`), 04-files.css(`.lg-note`, `.tdv`, `.tmore`), 03-base.css(`.tmore`, `.jump`, `.lw-s`), 04-files.css(`.jump`).

### 활동 / 대화 데이터 계층 (`13-data.js`)
- 목적: 홈과 대화/로그가 쓰는 대화별 메시지와 활동 저장소를 읽고 SSE로 갱신해요.
- 구성: 화면 요소 없음. `TS[target]`(메시지 `msgs`, 활동 `acts`, `hLoaded`, `aLoaded`, `hmore`, `amore`, `herr`)에 쌓아요.
- 기능: `loadTarget(t, quiet)`는 history 150개와 activity 300개를 동시에 읽어요(알림/작업내역/메일은 activity 생략). `ingestMsg`/`ingestAct`가 SSE 이벤트를 대화별로 나눠 넣고(`eventTarget`), 답이 끝난 대화는 `noteDone`으로 안 본 표시를 만들어요. `loadOlderMsgs`(150개씩), `loadOlder`(300개씩). `resync()`는 앱이 다시 보일 때 상태/대화/서브에이전트/큐를 다시 읽어요. `setTarget`, `enterTarget`으로 대화 전환.
- 상태: 그리기 전 `불러오는 중…`(대화와 로그 둘 다), 읽기 실패 `대화를 불러오지 못했어요`, 비었으면 `아직 대화가 없어요`, 로그 보기가 켜졌고 비었으면 `활동이 없어요`. 이전 기록 실패 토스트 `이전 기록을 불러오지 못했어요`, 이전 대화 실패 `이전 대화를 불러오지 못했어요`. 긴 대화는 최근 `CHAT_WINDOW`=50개만 그리고(로그 보기가 켜지면 전부) 맨 위에 닿으면 더 불러와요. 서버가 모델에게 보낸 `[later]` 턴 종료는 채팅 줄로 안 그려요. 선택 응답 직후 첫 답은 조용한 응답(`quietReply`)이라 알림 토스트 안 나와요.
- 데이터: `GET /api/history?target=&limit=150&before=`, `GET /api/activity?source=&limit=300&before=`, SSE 이벤트는 99-boot.js에서 분기: `activity`(`onActivity`+`laneActivity`), `subagents`, `quota`, `notice` 계열, `lanes`, 그 외 `ingestMsg`+`scheduleState`.
- 근거: web/js/13-data.js:15 `ingestMsg`, 13-data.js:48 `ingestAct`, 13-data.js:64 `loadTarget`, 13-data.js:90 `resync`, 13-data.js:96 `loadOlder`, 13-data.js:114 `loadOlderMsgs`, 13-data.js:169 `renderAll0`, 13-data.js:208 `onActivity`, 13-data.js:217 `setTarget`, 13-data.js:237 `enterTarget`; web/js/99-boot.js:41-66.
- css: 해당 없음.

### 실행 상태 줄 (`#runstate`)
- 목적: 입력창 위 한 줄로 이 대화의 에이전트가 지금 뭘 하는지 알려요.
- 구성: `#runstate`(role=status) 안에 점 `#runstate-dot`, 글 `#runstate-tx`, 버튼 `#runstate-act`(`.rs-go`). 보일 때 `#composer`에 `.rs-on`.
- 기능: 버튼은 상태에 따라 하나: 답을 기다리는 질문이면 `질문으로 가기`(`runAskGo`: 입력창 위 결정 카드로 포커스, 없으면 알림의 결정 시트), 백그라운드 작업 실패면 `다시 맡기기`(`workRetry`), 세션이 오류/멈춤이면 `다시 시작`(`runLaneRestart`), 어시스턴트가 한도/오류면 `지금 다시 시도`(`orchResume`), 멈춤이면 `다시 시작`(`runRestart`). 중단은 이 줄이 아니라 입력창 보내기 버튼이 해요. 계속하기 버튼은 의도적으로 없음.
- 상태: 라벨 `작업 중`, `답을 기다려요`, `쉬는 중`, `한도에 걸렸어요`, `오류로 멈췄어요`, `멈춤`, `끝났어요`. 대기 사유별 `순서를 기다려요`, `이어서 처리 중`, `맡긴 작업 진행 중`. 본문 조합: 작업 중 `작업 중 · {세부} · {경과}`; 대기 `{라벨} · {세부} · {경과} · 할 일 {n}개 남음`(`recover`면 `{작업} 실패`); 쉬는 중 `쉬는 중 · 할 일 {n}개 남음 · 이번 턴이 끝났는데 할 일이 남아 있어요` 또는 `마지막 턴이 끝나기 전에 멈췄어요`; 한도 `한도에 걸렸어요 · {시각}까지` 또는 `잠시 쉬어요`; 오류 `실패`/`중단됨`/`오류로 멈췄어요 · {세부}`; 멈춤 `멈춤 · 직접 멈췄어요`; 끝남 `끝났어요 · {세부} · {시각}`. 경과는 `방금`, `N분`, `N시간 M분`, 게이트웨이 시계(`workNow`) 기준으로 1초마다 갱신. 색: 답을 기다림/한도 주황(`.warn`), 오류 빨강(`.err`, 오너가 직접 중단한 작업은 회색), 일하는 중/맡긴 작업 파랑. 같은 대화에서 상태가 바뀌면 제자리 전환 모션. 한도 시각이 지났으면 5초 간격으로 상태를 다시 물어요. 알림/작업내역/설정 대화에서는 줄이 없고, 메일 대화는 그 메일의 백그라운드 작업 상태를 보여요(다른 컴퓨터 메일이면 그 컴퓨터 스냅샷, 버튼 없음).
- 데이터: `S.runs`(`main` 또는 대화 키: `kind`, `reason`, `since`, `detail`, `todos`, `work`, `cancelled`), `POST /api/orchestrator/restart`, `POST /api/orchestrator/resume`, `POST /api/lanes/{name}/restart`, `POST /api/workers/{id}/retry`.
- 근거: web/js/41-runstate.js:6 `RUN_LABEL`, 41-runstate.js:11 `waitLabel`, 41-runstate.js:20 `runStatus`, 41-runstate.js:32 `runStateOf`, 41-runstate.js:47 `runText`, 41-runstate.js:67 `runAction`, 41-runstate.js:83 `paintRunState`, 41-runstate.js:113 (1초 타이머), 41-runstate.js:118 `runAskGo`, 41-runstate.js:136 `runRestart`, 41-runstate.js:142 `runLaneRestart`; web/index.html:115. 질문을 못 찾으면 토스트 `질문을 찾지 못했어요. 알림에서 확인해 주세요`.
- css: 04-files.css(`.runstate`, `.runstate.warn/.err`), 07-chat.css(`.runstate`), 12-composer-phone.css(639px 이하 입력창).

### 봇 멈춤 줄 (`#pausenote`)
- 목적: 이 대화에 답하는 봇이 한도나 로그인 때문에 멈췄을 때 입력창 위에 한 줄로 알려요.
- 구성: `#pausenote`(role=status) 안에 글과 버튼 `.pn-go`.
- 기능: `지금 다시 시도` -> `orchResume`(`POST /api/orchestrator/resume`, 토스트 `다시 시도해요. 멈춘 동안 온 메시지도 이어서 처리해요`). 다른 컴퓨터 대화에는 버튼이 없어요(그 컴퓨터에서 해야 함).
- 상태: 문구 `{컴퓨터 이름} 봇이 멈춰 있어요: 로그인 필요`(`pauseKind === "owner"`) 또는 `...: 사용량 한도`. 세션(레인) 대화에서는 안 나와요. 대상이 다른 컴퓨터 대화면 그 컴퓨터의 모니터링 스냅샷(`PQ.list`)에서 상태를 읽어요. `status === "rate-limited"`일 때만 표시.
- 데이터: `S.orchestrator.status`/`pauseKind`, `PQ.list[].items.orchestrator`(peer), `POST /api/orchestrator/resume`.
- 근거: web/js/40-orch-error.js:4 `paintPause`, 40-orch-error.js:24 `orchResume`; web/index.html:116; 호출 web/js/17-state-refresh.js:43.
- css: 04-files.css(`.pausenote`).

### 오케스트레이터 오류 배너 (`#oerr`)
- 목적: 자동 재시도가 끝내 실패하면 모든 화면 위에 이유와 시작 시각을 띄우고 재시작 버튼을 줘요.
- 구성: `#oerr`(role=alert) 안에 점, 글 `#oerr-tx`, 버튼 `#oerr-btn`(`오케스트레이터 다시 시작`). 글은 굵게 `{봇이름}이/가 멈췄어요`, 뒤에 ` · {쉬운 한국어 이유} · {HH:MM}부터`. title에 원문(`e.raw`).
- 기능: 버튼은 `orchResume`(`POST /api/orchestrator/resume`). 다음 상태에서 오류가 사라지면 배너가 숨겨져요(`S.orchestrator.error`가 없을 때).
- 상태: 오류 있음 표시/없음 숨김 두 가지뿐. 폭 600px 이하에서 배너가 `calc(100% - 24px)`, 버튼 전체 폭(04-files.css:78).
- 데이터: `S.orchestrator.error`(`text`, `since`, `raw`).
- 근거: web/js/40-orch-error.js:33 `paintOrchError`; web/index.html:93; 호출 web/js/17-state-refresh.js:43.
- css: 04-files.css(`.oerr`), 01-tokens.css(`.oerr`), 22-shell.css(`.oerr`).

### 게이트웨이 재시작 배너 (`#gban`)
- 목적: 오늘 게이트웨이가 몇 번 재시작했고 끊긴 작업이 몇 개인지 한 줄로 알려요.
- 구성: `#gban`(role=status) 안에 점 `#gban-dot`, 글 `#gban-tx`, 닫기 `#gban-x`(aria-label `재시작 알림 닫기`, 글자 `×`).
- 기능: 닫으면 오늘 개수를 저장하고(localStorage `dotz-restart-seen`) 숨겨요. 그 뒤 끊긴 작업이 더 늘어난 재시작이 생길 때만 다시 나와요.
- 상태: 글 `오늘 재시작 {n}회 · 끊긴 작업 {m}`, title `오늘 게이트웨이 재시작 {n}회, 끊긴 작업 {m}, 마지막 {HH:MM}`. 끊긴 작업이 있으면 점 주황. 오늘 재시작이 없으면 숨김. 깨끗한 재시작(`끊긴 작업은 없어요`)은 채팅 줄에서 빠지고 이 숫자에만 세요. 폭 639px 이하에서 `calc(100% - 24px)`(04-files.css:83).
- 데이터: 메인 대화의 `게이트웨이를 다시 시작했어요`/`게이트웨이 재시작했어요`로 시작하는 `out` 이벤트(`ts(MAIN).msgs`).
- 근거: web/js/11-todo-strip.js:64-67 (`isRestart`, `cleanRestart`, `paintRestartBanner`), 13-data.js:20 (ingestMsg에서 호출); web/index.html:91.
- css: 04-files.css(`.gban`), 01-tokens.css(`.gban`), 22-shell.css(`.gban`).

### 분할 칸 (`#split`, 43-panes*.js)
- 목적: 넓은 창(1100px 이상)에서 대화와 프로젝트를 좌우 두 칸으로 나란히 봐요(최대 2칸, 위아래 분할 없음). 설계와 상태 목록은 docs/split-panes.md.
- 구성: `#views` 안 `#split` = 왼쪽 목록 단(`.pane-side`: 대화 목록 `#chat-convo` 또는 `#v-projects`) + 두 칸 줄(`.pane-row`, 경계선 `.pane-bar`, 칸 `.pane`). 활성 칸(`.pane.on`)은 진짜 `#v-chat`/`#v-project`(`.in-pane`)를 담고, 비활성 칸은 거울(`.pane-mir`: `.pane-hd`, `.pane-tl`, `.pane-cmp`)이에요.
- 기능: 목록 행·칸 머리줄 끌기(왼쪽·오른쪽 가장자리=나누기, 가운데와 두 칸일 때=바꾸기, 머리줄=자리 바꾸기), 경계선 끌기와 두 번 눌러 반반, ⌥⌘\ ⌥⌘1·2 ⌥⌘W(나누기는 Ctrl+Shift+\로도), 명령 팔레트의 이름 붙인 배치, 칸 머리줄 점.
- 상태: 칸이 하나거나 창이 1100px 미만이면 `#split`이 없고 모든 노드가 원래 자리에 있어요. 마지막 배치는 `localStorage dotz-panes`, 이름 붙인 배치는 `dotz-pane-layouts`.
- 데이터: 실시간 연결은 하나(99-boot.js), `paneEvent`가 비활성 칸에 나눠요.
- 근거: web/js/43-panes.js, 43-panes-view.js, 43-panes-mirror.js, 43-panes-drag.js, 43-panes-keys.js, 43-panes-layouts.js; 테스트 hub/split-panes-web.test.ts, hub/split-panes-drag-web.test.ts.
- css: 26-panes.css.

### 할 일 줄 (`#todo`)
- 목적: 입력창 위 한 줄로 대화의 계획(지금 단계와 `완료/전체`)을 보여주고, 눌러서 전체 목록을 펼쳐요.
- 구성: `#todo` 안에 `button.td-bar`(상태 아이콘 `.td-g`, 현재 할 일 `.td-cur`, 진행 `.td-n`, 화살표 `.td-ch`), 펼치면 `.td-list`(단계 이름 `.td-ph`, 항목 `.td-r.tr-{act|done|drop|pend}`).
- 기능: 줄을 누르면 펼침/접힘(대화마다 `TD.open[target]` 기억, `aria-expanded`). 플랜이 바뀌면 todo 도구 호출이 끝난 뒤 250ms 디바운스로 `loadTodo`.
- 상태: 모든 항목이 완료/취소이거나 항목이 없으면 줄이 숨겨져요. 알림/작업내역/메일 대화는 플랜이 없어 항상 빈 목록(요청도 안 함). 표시: `{완료}/{취소 제외 전체}`. 현재 항목은 진행 중 우선, 없으면 첫 대기 항목. 항목 상태 `in_progress`=act, `completed`=done, `abandoned`=drop, 나머지 pend. 단계가 바뀌면 줄이 제자리 전환 모션(`motionSwap`). 로드 실패는 이전 값을 유지(없으면 빈 배열). 터치 기기에서 `.td-bar` 최소 높이 확대(07-chat.css:173).
- 데이터: `GET /api/todo?target={t}`(`phases[].name`, `phases[].tasks[]`: `content`, `status`), SSE `activity`의 todo 도구 호출/결과.
- 근거: web/js/11-todo-strip.js:3 `loadTodo`, 11-todo-strip.js:10 `todoState`, 11-todo-strip.js:11 `paintTodo`, 11-todo-strip.js:35 `todoActivity`; web/index.html:106.
- css: 07-chat.css(`.todo`, `.td-bar`, `.td-list`, `.td-ch`), 10-conversations.css(`.todo`).

### 웹 터미널 (셸, `openShell`)
- 목적: 이 페이지를 서비스하는 컴퓨터의 진짜 셸(xterm.js)을 대화상자로 열어요.
- 구성: 대화상자 `dialog`(wide, 클래스 `shell`, 제목 `터미널 · {컴퓨터 이름}`, 이름이 없으면 `이 컴퓨터`). 헤더 `.fs-hb`에 상태 `.sh-st`(role=status, aria-live=polite), 암호 버튼 `.sh-k-pw`(title/aria-label `암호 입력`), ⋯ 버튼 `.sh-more`(title/aria-label `더 보기`). 본문 `.sh-wrap` 안에 터미널 `.sh-term`(aria-label `터미널`), 암호 상자 `.sh-pw`(안내 `암호를 입력해요. 화면에 보이지도, 저장되지도 않아요.`, 입력 aria-label/placeholder `암호`, 버튼 `보내기`, `닫기`), 터치 기기면 특수 키 줄 `.sh-keys`(role=toolbar, aria-label `특수 키`).
- 기능: 키 입력은 터미널 안에서 그대로 PTY로 가요(`shInput` -> `shSend`, 16000자 단위, 전송 중이면 모아서 순서대로). ⋯ 메뉴 `셸 다시 시작`(`shRestart`). 암호는 별도 상자로 보내고(`shSendPw`, `secret: true`) 보낸 뒤 입력을 비워요. 마지막 줄이 `password/passphrase/암호/비밀번호/패스워드 ... :`로 끝나면 암호 버튼이 강조(`.hot`)돼요. 특수 키 줄 `Esc`, `Tab`, `Ctrl`(누른 채 고정, 다음 글자를 제어 코드로 바꿈), `↑ ↓ ← →`, `^C`, `^D`. 열린 뒤 `openShell({command})`가 다시 불리면 새로 열지 않고 명령만 입력해 둬요(`shSetCommand`). 크기가 바뀌면 `POST /api/pty/resize`.
- 호출처: 명령 팔레트 `셸 터미널 열기`(05-command-palette.js:56), 슬래시 명령(14-slash-commands.js:254), 코드 블록의 `터미널에서 실행`(35-code-blocks.js:63). 홈 화면에서 직접 여는 버튼은 이 범위에서 못 찾음.
- 상태: 상태 글자 `불러오는 중…`(xterm 로드), 구성요소 로드 실패는 머리 대신 본문(`.sh-fail`)에 `터미널 구성요소를 불러오지 못했어요`와 `다시 시도` 단추, `연결 중…`, `연결됨`(ok), `셸이 꺼져 있어요`(err, 터미널에 `셸이 꺼져 있어요. Enter를 누르면 다시 시작해요.`), `셸이 끝났어요`(err, `셸이 끝났어요. Enter를 누르면 다시 시작해요.`), `연결이 끊겼어요`(err, `연결이 끊겼어요. Enter를 누르면 다시 연결해요.`), `연결하지 못했어요`(err, `연결하지 못했어요. Enter를 누르면 다시 연결해요.`). 연결이 끊긴 상태에서 Enter 입력 시 `shConnect`로 다시 연결. 명령을 미리 넣으면 토스트 `명령을 입력해 뒀어요. Enter를 누르면 실행돼요`. 입력 전송 실패 토스트는 서버 메시지. 터치 기기(`pointer: coarse`)에서만 특수 키 줄이 생기고 글자 크기 14(데스크톱 13). coarse에서 xterm 숨은 입력 16px(13-code-shell.css:25), 639px 이하 레이아웃은 13-code-shell.css:42에서 별도 규칙(내용 못 읽음). 아무것도 저장하지 않아요.
- 데이터: `GET /api/pty/stream?cols=&rows=`(SSE 스타일 스트림, 이벤트 `reset`{data, alive}, `out`{data}, `exit`), `POST /api/pty/input` `{data}` 또는 `{data, secret:true}`, `POST /api/pty/restart`, `POST /api/pty/resize` `{cols, rows}`, 정적 `/vendor/xterm.css`, `/vendor/xterm.js`, `/vendor/addon-fit.js`. 서버는 hub/pty.ts.
- 근거: web/js/36-shell.js:148 `openShell`, 36-shell.js:21 `shLib`, 36-shell.js:59 `shFrame`, 36-shell.js:74 `shConnect`, 36-shell.js:101 `shPost`, 36-shell.js:105 `shSend`, 36-shell.js:113 `shRestart`, 36-shell.js:118 `shInput`, 36-shell.js:128 `shSendPw`, 36-shell.js:137 `shResize`, 36-shell.js:141 `shSetCommand`, 36-shell.js:15 `SH_KEYS`, 36-shell.js:11 `isPasswordPrompt`.
- css: 13-code-shell.css(`.shell`, `.sh-term`, `.sh-pw`, `.sh-keys`, `.sh-st`, `.sh-wrap`), 01-tokens.css 터미널 색 변수(`--tb`, `--tf`, `--tac`).

### 헤더 사용량 띠, 종, 탭 배지, 답변 필요 토스트 (09-needs-you.js)
- 목적: 홈 밖에서도 보이는 요약: 가장 빡빡한 한도, 안 읽은 알림 수, 채팅/모니터링 탭 배지, 새로 답이 필요한 대화 토스트.
- 구성: 사용량 띠 `#ustrip`(헤더)와 사이드바 `#sf-usage`, 종 `#bell`+`#bell-n`, 탭 배지 `#nav-att`(채팅), `#nav-mon`(모니터링), 페이지 제목의 `(n) {봇이름}`.
- 기능: 사용량 띠/사이드바 행은 `go("usage")`. 가장 빡빡한 한도 하나(Anthropic/Claude 우선, 없으면 전체 공급자)를 `{N시간|N일|N주} {남은%}% 남음` 형태로 보여요(title `사용량 · {단위} {n}% 남음`). 40% 이하면 주황. `loadStrip`은 보일 때 3분에 한 번만 `GET /api/quota`.
- 상태: 한도 정보가 없으면 띠와 사이드바 행이 숨겨져요. 종 배지는 안 읽은 알림 수(99 넘으면 `99+`), aria-label `알림, 안 읽은 알림 {n}개` 또는 `알림`. 채팅 배지는 안 읽은 대화 수(메인, 작업내역, 프로젝트 기준; 세션은 제외), title `읽지 않은 대화 {n}개`. 모니터링 배지는 확인할 것 개수(실패/연결 끊긴 앱·모니터 + 보낼 초안), title `확인할 것 {n}개`, 개수가 없고 새 소식만 있으면 점과 title `새 소식`. 세션 질문/한도/끝난 턴이 새로 생기면 토스트 `{이름} · 답변 필요|한도 걸림|확인 필요`, 본문 질문 / `사용량 한도로 대기 중이에요` / `답을 마쳤어요. 확인해 주세요`. 페이지 로드 직후엔 열린 질문만 알리고, 여러 개면 한 토스트 `답변 필요 {n}개`(본문 `{이름들} 외 {n}개가 답을 기다려요`)가 홈을 열어요. 숫자가 바뀌면 숫자 롤링, 0에서 올라올 때 팝 모션.
- 데이터: `GET /api/quota`, SSE `quota`(`quotaLive`), `NT`, `NM`, `INTG`, localStorage `dotz-seen`/`dotz-done`. 다른 탭에서는 60초마다 `loadMonitors()`(홈/모니터링 제외).
- 근거: web/js/09-needs-you.js:243 `paintStrip`, 09-needs-you.js:261 `paintBell`, 09-needs-you.js:54 `paintAttn`, 09-needs-you.js:71 `monAttnCount`, 09-needs-you.js:87 `paintMonAttn`, 09-needs-you.js:100 (60초 타이머), 09-needs-you.js:106 `toastAttn`, 09-needs-you.js:130 `attnHomeClick`, 09-needs-you.js:141 `attnToast`, 09-needs-you.js:277 `quotaLive`, 09-needs-you.js:285 `loadStrip`, 09-needs-you.js:42 `attnRaw`; web/index.html:77, 88-89.
- css: 01-tokens.css(`.ustrip`), 22-shell.css(`.ustrip`, `.bellbtn`, 사이드바 `#sf-usage`).

### 채팅 목록 (대화 목록)
- 목적: 카카오톡식으로 모든 대화(비서, 알림, 작업 기록, 세션, 프로젝트, 메일/카카오톡 대기)를 한 목록에서 고르고 안 읽음 수를 봐요.
- 구성: `aside#chat-convo.cv-side`(목록 패널, `#v-chat` 맨 앞에 붙음) 안에 `.cv-sec`(섹션 라벨) 다음 `.cv-card`(행 묶음)이 이어져요. 행은 `button.cv-row`(아이콘 `.cv-av`, 이름 `.cv-n`, 미리보기 `.cv-p`, 시각 `.cv-t`, 배지 `.cv-m2`). `진행 중` 구역의 진행 중 줄은 낱말 없이 파란 점(`.dot.pri`, aria-label `진행 중`)만 달고, 답을 기다리는 줄은 `답을 기다림` 표식을 그대로 써요. 맨 아래에 `.cv-foot`의 읽음 처리 버튼이 와요.
- 기능: 행 탭으로 `go("chat", t)`(대화 열기). `프로젝트 N개 더 보기` 버튼으로 `CVF.more`를 40개씩 늘려요(`convRow`). 읽음 처리 버튼은 `convReadAll`로 답이 필요 없는 안 읽은 대화를 일괄 읽음으로 보내요. 메일/카카오톡 카드 행은 `go("monitoring", "c:<mail>")` 또는 `go("monitoring","i:kakao")`+`kkOpen`으로 모니터링을 열어요. 목록은 `convRows`(순서: 세션이 돌거나 답을 기다릴 때만 맨 위 `진행 중`(`sessionsNow`, 홈 카드와 같은 목록, 행 이름 `프로젝트 · 제목`, 답을 기다리는 세션 먼저), 비서, `worklog`, `프로젝트`, 열려 있거나 안 읽은 것·답할 것이 남은 종료 세션, 종료 세션 묶음, `메일 · 카카오톡`)로 짜고 `convCards`가 카드로 묶어요.
- 상태: 섹션 라벨 `진행 중`, `프로젝트`, `메일 · 카카오톡`. 더 보기 `프로젝트 ${n}개 더 보기`. 읽음 처리 `${n}개 읽음 처리`(title `답이 필요한 대화는 그대로 둬요`), 성공 토스트 `대화 ${n}개를 읽음으로 표시했어요`, 실패 `${n}개를 읽음으로 표시하지 못했어요: ...`(카운트는 되돌리고 `convLoad`로 다시 읽음). 행 상태: 안 읽음(`.unread`, 배지 `nb` aria `읽지 않은 메시지 ${n}개`), 선택(`.on`, `aria-current`), 마지막 글 없음(`.none`), 답변 필요 점(`dot warn` aria `답변 필요`). 세션 행은 `sessionStatus` 배지. 메일 카드 행: 이름 없으면 `(제목 없음)`, 힌트 `${보낸이} · 답장 초안이 기다려요`, 칩 `미답장`, 최대 5개. 목록 로딩 실패 시 문구 없이 5초 뒤 `/api/conversations` 재시도(`CV.failed`). 모니터링에서 연 대화는 같은 `#chat-convo`가 `모니터링 목록`(aria)으로 바뀌고 `monSideNodes`가 그려요. 폰(`max-width:1099px`)은 `chatList`가 켜진 때만 목록 전체 화면(`convListing`), 데스크톱(`>=1100px`)은 목록이 왼쪽 패널로 항상 보여요. 다른 컴퓨터 변형: 메일은 `!PQ.of.has(t)`인 것만 대기 카드에 넣어요. 종료 세션 묶음 행(`endedGroup`)과 `r.empty`(`.cv-empty`) 문구는 이 파일 밖이라 코드에서 확인 못 함.
- 데이터: `GET /api/conversations`(items: target, last, read, unread, mail). 목록은 한 쪽씩 와요(`hub/conversations-page.ts`): 처음 응답은 세션·프로젝트 대화 전부와 가장 최근 메일 `limit`개(기본 100, 최대 500)를 최근 글 순으로 주고, 답장이나 초안이 기다리는 메일(보관·보낸 메일 제외)은 더 오래됐어도 가장 최근 5개까지 함께 줘요(메일 · 카카오톡 카드가 이 행으로 그려져요. 카드는 5줄까지만 보여요). `page: {limit, more, next}`와 모든 메일에 대한 `counts`를 함께 줘요. `counts = {rows, mail: {total, unread(안 읽은 글 합), filters: {all, unread, owed, replied, archived, sent}, sources: {<계정>: {total, unread}}}}`는 첫 응답에만 있어요. `more`가 true면 `?before=<next>&limit=`로 더 오래된 메일만 받고(`counts` 없음), `next`가 없을 때까지 이어 가면 모든 행을 만나요(첫 응답에 실린 기다리는 메일은 제 차례의 뒤 쪽에서 한 번 더 올 수 있고, 웹은 대화 키로 담아 한 줄만 그려요). 한 줄만 필요하면 `?target=<대화>`(여러 번 가능, 50개까지), 전부 필요하면 `?all=1`(피어 스냅샷이 써요). 틀린 `before`는 400. 웹은 첫 쪽을 `convLoad`가 읽고, 메일 목록 끝의 센티널(`mbMore`)이 다음 쪽을 `convMore`로 받아요. 필터 칩 숫자는 `counts.mail.filters`(`mailChipCount`), 열려 있는 오래된 메일은 `convPin`이 키로 가져와요. `POST /api/read {target, ts}`, 이벤트 스트림 `{kind:"read"}`(`convOnRead`), 새 메시지 이벤트(`convNote`가 `message, lane_message, out, lane_report, result, mail, schedule, watch` 종류를 미리보기/안 읽음에 반영).
- 근거: web/js/31-conversations.js:264(convRows), :288(convWaiting), :298(convCards), :348(convRow), :320(convReadBtn), :326(convReadAll), :341(convAvatar), :392(convPaint), :62(convLoad), :40(convNote), :91(convOnRead). 상태 선언 web/js/09-needs-you.js:369-371. 폰/데스크톱 판정 web/js/04-state.js:13,17.
- css: web/css/10-conversations.css(`.cv-*`, 미디어쿼리 :13, :114 `max-width:1099px`, :128 `min-width:1100px`), 모니터링 공용 행은 web/css/20-monitoring.css, 17-kakao.css, 20-projects.css, 20-mail-thread.css도 `.cv-row`를 써요.

### 대화 머리와 앱바 (대화 화면 상단)
- 목적: 열린 대화의 이름, 상태, 그 대화의 동작(세션 메뉴, 프로젝트 메뉴, 설정 앱 더보기)을 보여 줘요.
- 구성: 넓은 화면은 `#cv-head.cv-head`(`.cv-hd-b`의 `.cv-hd-t` 제목 + `.cv-hd-s` 상태, 오른쪽 `.cv-hd-a` 동작). 폰은 앱바 `#title`에 대화 이름, `#back` 뒤로, `#cvmenu`(세션 메뉴), `#pjmenu`(프로젝트 메뉴). 모니터링에서 연 대화(`monCtx`)는 아바타+이름+상태 줄 형태예요. 넓은 화면의 뒤로 화살표는 앱바의 `‹ 모니터링`(`#back.mon-up`) 하나뿐이에요.
- 기능: 앱바의 `‹ 모니터링`(`#back`, aria `모니터링 목록으로`)은 보던 목록(`MON.sel`)으로 돌아가요. 세션 메뉴 `button.cvmenu`(aria `세션 메뉴`)는 `homeMenu`를 열어요. 프로젝트 메뉴는 `pmMenuButton`. 설정 대화는 `asMoreBtn`. 알림 종은 `#bell`(title `알림 (⌘/)` 또는 `알림 (Ctrl+/)`)이 `nscGo`로 알림 화면을 열어요.
- 상태: 상태 줄 문구는 `알림`=`경고와 결정 요청`, `작업 기록`=`야간 정리와 세션 진행 기록`(`FIXED_DESC`), 메일 대화는 보낸 사람 또는 `메일`, 설정 대화는 `말로 설정을 바꾸고 적용을 눌러요`, 살아 있는 세션은 `statusKo(status)`, 종료된 세션은 `종료됨`. 알림 대화(`target==="alert"`)는 `#v-chat.no-composer`로 입력창이 사라져요. 폰에서 대화 안(`convOnPhone`)일 때만 `#cvmenu`/`#pjmenu`가 보이고 앱바는 `back`/`cvconv` 클래스를 가져요. 넓은 화면의 모니터링 대화는 `#back`이 `‹ 모니터링 목록으로`(aria `모니터링 목록으로`) 모양(`mon-up`)이에요. 미디어쿼리 변화(`max-width:1099px`)에서 `convChrome`이 다시 그려요.
- 데이터: 읽는 것은 `targetInfo`, `MAILS`, `S.lanes` 등 메모리 상태뿐이에요. 프로젝트 대화면 `prjLoad`(프로젝트 목록)를 한 번 불러와요.
- 근거: web/js/31-conversations.js:366(convPaintHead), :383-390(메뉴 버튼), :418(convOnPhone), :419(convTitle), :429(convChrome), :447(미디어쿼리 리스너), :456-460(종).
- css: web/css/10-conversations.css(`.cv-head`, `.cv-hd-*`), web/css/16-result-card.css:84(`.appbar.cvconv h1` 2줄 말줄임, `max-width:1099px`), 18-app-settings.css.

### 대화 타임라인 열림과 읽음 위치
- 목적: 대화를 열 때 안 읽은 첫 글에 `여기까지 읽음` 구분선을 두고, 화면에 보인 글까지만 읽음으로 보내요(디스코드식).
- 구성: `#timeline > #tl`(`.tl-in`), 구분선 `div.cv-new[role=separator]`(안의 `span`), `#chat-jump`(맨 아래로 버튼), 최상단 `#tl-top`/`#tl-more`.
- 기능: 열 때 `convSync`가 대화 키를 갈고 `convCapture`가 읽음 시점을 잡아요. `chatOpen`이 첫 그림에서 구분선, 맨 아래, 또는 메일이면 맨 위에 고정(`chatPin`)해요. 점프 대상(알림, 토스트, 푸시, `?m=`)은 `chatJump`로 앱바 아래에 두고 `ntFlash`로 깜박여요. 사용자가 wheel/touchstart/pointerdown/keydown 하면 `chatUnpin`. `convMaybeRead`가 화면에 하단이 보이는 마지막 글(`convSeenTs`)까지 읽음으로 올리고 150ms 모아서 `convFlush`가 보내요. 페이지가 다시 보이면 `convLoad`. 20초마다(바뀔 때 즉시) 지금 보는 대화를 `viewReport`로 서버에 알려 알림에서 제외시켜요.
- 상태: 로딩 중 `불러오는 중…`(`a-div`, 역사+읽음 위치+할 일 계획 셋이 오기 전, 계획은 0.7초, 읽음 위치는 3초 후 포기해서 구분선 없이 그려요 `chatReady`). 비었을 때 `아직 대화가 없어요`, 불러오기 실패 `대화를 불러오지 못했어요`(`a-error`), 로그 보기 비었을 때 `활동이 없어요`, 이전 활동 구분 `지난 기록`(위 4개는 web/js/13-data.js). 구분선 aria `여기부터 읽지 않은 메시지`, 보이는 글자는 `여기까지 읽음`. 메일 대화는 하단 조건 없이 화면에 올라오면 즉시 읽음(`mailReadPainted`). 안 읽음 수는 서버 수를 따르고 보고 있는 하단이 아니면 라이브 이벤트마다 +1(`convNote`). 읽음 POST가 실패하면 로컬 읽음 위치를 되돌리고 `convLoad`. 시스템 줄(`system`)은 안 읽음에 안 세요. 다른 컴퓨터 대화는 `pqPc(t)`면 읽음 뒤 `pqSoon()`으로 스냅샷을 다시 읽어요.
- 데이터: `POST /api/read`, `GET /api/conversations`, `POST /api/viewing {id, conv}`(페이지 숨김/종료 시 `keepalive` fetch), 스트림 `{kind:"read"}`.
- 근거: web/js/31-conversations.js:103(convSync), :111(convCapture), :120(convDivider), :125(chatReady), :135(chatOpen), :158(chatJump), :167(chatPlace), :202(convMaybeRead), :223(convFlush), :231(convSeenTs), :249(viewReport). 빈/로딩 문구 web/js/13-data.js:176,193,194.
- css: web/css/10-conversations.css(`.cv-new`), 03-base.css(`.tl-in`, :269 `max-width:639px`), 07-chat.css.

### 대화 대상 전환 칩과 대화/로그 토글
- 목적: 헤더에서 대화 대상(비서, 알림, 작업 기록, 프로젝트, 세션)을 바꾸고 같은 세션을 대화 또는 로그로 봐요.
- 구성: 각 `.thead`(`#thead` 등) 안에 `div.tsw[role=group][aria-label=대화 대상]`(칩 `button.tchip`: `.dot`, `.tx`, `.sb`, `.nb`; 구분선 `.tsep`; 접힘 `.tmore`)와 `button.sel.tdrop`(드롭다운), 오른쪽 `#vtog`(대화/로그 아이콘 버튼).
- 기능: 칩 탭은 `pickTarget`. 칩 끌어다 놓기로 순서 변경(`dragItem`/`moveInOrder`, `localStorage dotz-order`; 비서와 고정 대상은 안 끌려요). 드롭다운은 `showMenu`(프로젝트 아래 그 세션을 들여쓰기). `종료된 세션 N` 항목은 `endedOpen=true; go("chat","list")`. 넓은 화면은 칩이 넘치면 `fitChips`가 선택된 칩만 남기고 `더 보기 N` 칩으로 접어요. `#vtog` 탭은 `go("activity")`/`go("chat")`.
- 상태: 칩 title은 확인 필요면 `${attnLabel} · ${status}`. 서브에이전트 `서브 ${n}`(title `서브에이전트`). 안 읽음 `99+` 상한. 드롭다운 aria `대화 대상: ${이름}`, 다른 대상 안 읽음 합계 title `다른 대상의 새 메시지`, 확인 필요 `다른 대상 확인 필요 ${n}개`. 접힘 칩 `더 보기 ${n}`(확인 필요 개수 title `확인 필요 ${n}개`). 메뉴 헤더 `프로젝트`, `프로젝트 없음`, 항목 `종료된 세션 ${n}`(sub `기록 보기 · 재개`). 토글 title/aria `대화 보기` 또는 `로그 보기`, 로그 보기 중 안 읽음 점 `.ud`. 토글은 `LOG_VIEW` 꺼짐, `.tv` 없음, 목록 보기, 고정 대상(알림/작업 기록)이면 숨겨요. 폰은 칩을 숨기고 드롭다운을 써요(`.thead.lanev .tdrop.sel`이 `max-width:639px`에서 112px 상한). 데스크톱 터치(`pointer:coarse`)는 칩 36px.
- 데이터: 상태 `S.lanes`, 이벤트로 오는 안 읽음 수. 따로 API 없음.
- 근거: web/js/16-target-switcher-conversation.js:30(renderBars), :98(fitChips), :7(moveInOrder), :18(dragItem).
- css: web/css/03-base.css(`.tchip`, `.tsw`, `.tdrop`, `.tmore`; :244, :247, :249), 10-conversations.css(`.tsw`/`.tdrop`), 22-shell.css 및 07-chat.css(`#vtog`).

### 로그인 요청 시트 (dotz_auth)
- 목적: 에이전트가 요청한 자격 증명을 입력하거나 승인하는 전체화면 시트예요. 값은 게이트웨이의 0600 비밀 파일로만 가고 페이지에 안 남아요.
- 구성: `fsOpen` 시트 안 `form.au`: 머리(`.fs-ey` + `h3.fs-t` + 닫기), 본문 `.fs-body.abd`(목적 문단 `p`, 필드 `.fld` = label + `.ctl`(input + `.eye`) + `.ferr`, `.rem` 체크박스, `.note`), 바닥 `.fs-ft.row`(취소/보내기).
- 기능: `보기`/`숨기기` 토글(비밀번호), 제출 `done("submit")`, 취소 `done("cancel")`, 승인형은 `승인`, 닫기(x/뒤로)는 숨기기만(`AUTH_HID`, 알림의 `입력 창으로 가기`로 다시 열어요). 필드가 비면 포커스만 가고 전송 안 해요.
- 상태: 머리 `승인 요청` 또는 `입력 요청`, 제출 버튼 `승인` 또는 `보내기`, `취소`. 선택 필드 라벨 뒤 `(선택)`. 기억 스위치 줄 `다음에도 쓰게 저장해 두기` / `끄면 한 번 쓰고 지워요`(브라우저 기본 체크박스가 아니라 설정과 같은 `.hs-sw` 스위치, 줄 전체가 눌려요). 안내 `입력한 값은 이 컴퓨터의 비밀 파일에만 저장되고, 대화나 기록에는 남지 않아요.`(승인형은 안 보임). 필드 오류 `비워 둘 수 없어요`, `형식을 확인해 주세요`. 저장 실패 토스트 `게이트웨이가 값을 저장하지 못했어요(봇에게도 알렸어요): ...`, 그 밖의 실패 `전달하지 못했어요. 다시 시도해 주세요`. 성공 `전달했어요`, 취소 `요청을 취소했어요`. 폰/터치는 input 높이 키움(`pointer:coarse` 또는 `max-width:639px`).
- 데이터: `S.auth`(상태 폴링/푸시), `POST /api/auth/:id {action, values?, remember?}`.
- 근거: web/js/16-target-switcher-conversation.js:123(paintAuth), :136(authCard).
- css: web/css/07-chat.css(`.au`, :72), 04-files.css(`.au`), 14-overlay.css(시트 틀).

### 뒤로가기 레이어 (브라우저 히스토리 스택)
- 목적: 시트, 메뉴, 대화창, 화면을 히스토리 엔트리로 쌓아 안드로이드 뒤로가기/데스크톱 뒤로가기로 한 겹씩 닫아요.
- 구성: 화면이 아니라 상태 모듈이에요. 엔트리마다 `{dz:1, c: 쌓인 순서, ov: 열린 오버레이 수, w: 홈부터의 길, sy?: 스크롤 위치, a?, g?}`. `OV[]`가 열린 오버레이.
- 기능: `go()`가 `navSync`로 원하는 체인(`H.want`)을 계산하고 `histSync`가 push(깊이와 옆 이동: 탭을 옮기거나 목록의 다른 항목을 누르면 보던 화면 위에 칸을 올려요), `history.go(-n)`(폰에서 위로, 아래 칸이 부모일 때만)로 맞춰요. 뒤로 가기는 탭을 옮기기 전에 보던 화면(같은 탭, 같은 항목, 같은 스크롤. 홈만은 늘 맨 위에서 열려요)이나 넓은 화면에서 직전에 누른 항목으로 돌아가요. 홈 탭도 다른 탭과 같아서 누르면 보던 화면 위에 올라가고(`H.tab`), 채팅 목록과 메일 목록의 다른 줄도 한 칸씩 올라가요(`setTarget(t, true)`: `go()`가 칸을 올림). 대화 전환 메뉴(`pickTarget`)와 분할 칸을 앞으로 가져오는 것은 지금 칸의 주소만 바꿔요(`routeReplace`). 같은 탭이나 같은 항목을 다시 누르면 칸을 더하지 않고, 목록이 스스로 연 첫 프로젝트(`a`)는 다른 항목을 누르면 그 자리를 대신해요. `ovOpen/ovDone`으로 오버레이가 엔트리를 하나씩 차지, `dialogHist(d)`가 `<dialog>`를 오버레이로 등록. 설치 앱(standalone)은 홈 아래 종료 가드: 홈에서 뒤로가면 토스트 `한 번 더 누르면 닫혀요`(2초), 다시 누르면 앱이 닫혀요(`guardHit`, 가드 엔트리는 `histSeed`가 만들어요).
- 상태: 폰(`narrowChat`)에서 채팅 체인은 `home > chat/list > chat/<대상>`, 넓은 화면은 `home > chat/<대상>`. 모니터링에서 연 대화는 `home > monitoring > monitoring/<항목> > <대화>`, 감시 대화는 왼쪽 목록이 있어 `home > monitoring > <대화>`(`monChatIt`). 알림에서 온 이동(`NSC.ret`)은 `home > notices > ...`. 넓은 화면은 오버레이가 엔트리를 안 쓰고 위로 가는 이동은 현재 엔트리를 replace해요(`histFlat`, 주소창 깜박임 방지). 넓은 화면에서 앱은 `history.go`를 부르지 않아요. 체인이 6번 시도로 안 맞으면 원하는 경로로 그냥 맞춰요.
- 데이터: 없음(브라우저 History API, 해시 `#chat/...`).
- 근거: web/js/32-history-nav.js:14(routeChain), :33(navSync), :40(routeReplace), :48(histMove), :55(histSeed), :67(histSync), :90-94(ovOpen/ovDone/dialogHist), :96(guardHit), :104(popstate).
- css: 없음(코드에서 확인 못 함: 이 모듈은 DOM을 그리지 않아요).

### 폰 키보드에 맞춘 입력창 (visualViewport)
- 목적: 폰 키보드가 올라와도 입력창이 보이는 영역 안에 있게 해요.
- 구성: DOM 없음. 숨은 `div`(`height:100dvh`)를 프로브로 달고 CSS 변수 `--vvh`(보이는 높이)와 `--kb`(키보드가 보이는 영역 아래를 가린 높이)를 `<html>`에 써요.
- 기능: `visualViewport`의 resize/scroll마다 한 프레임에 한 번 `apply`. 키보드 높이는 프로브 높이에서 `offsetTop + height`를 뺀 값이라, iOS가 화면을 키보드만큼 밀어 올려 보여 주면 0이고 줌(`scale>1.01`)이어도 0. 같은 프레임에 키보드가 올라와 있으면 `<html data-kb>`를 달아요(줌을 띐 보이는 높이가 이 페이지 폭에서 본 가장 큰 높이보다 150px 넘게 작을 때, 안드로이드는 `--kb`가 0이라 따로 재요). 아래 탭 바는 포커스가 아니라 이 속성으로 숨어, 도킹된 결정 카드의 이유 칸이 키보드와 함께 한 번만 움직여요.
- 상태: `visualViewport` 없으면 아무것도 안 해요. 레이아웃은 이 변수를 CSS가 써서 잡아요(스크립트가 위치를 직접 정하지 않음).
- 데이터: 없음.
- 근거: web/js/34-composer-viewport.js:1-32.
- css: web/css/12-composer-phone.css(`--kb`, `--vvh`; `@media (max-width:639px)` :6), 01-tokens.css(`:root[data-kb]` 탭 바 숨김), 13-code-shell.css, 14-overlay.css(`--vvh`), 20-mail-box.css(폰 메일 쓰기 시트: 아래 끝 `--kb`, 높이 `--vvh`).

### 입력창 (메시지 보내기와 중단)
- 목적: 현재 대화 대상에 글/파일/요소를 보내고, 작업 중이면 끼워넣기, 대기열, 중단을 해요.
- 구성: `#composer` 안 위에서 아래로 `#dcard`(결정 카드), `#hints`(슬래시/멘션 메뉴), `#runline`(작업 상태 줄), `form#send.sendrow`(`#atray` 첨부 트레이, `#c-attach` + `textarea#text` + `#send-btn`), 그 아래 `#cbar`(모델/강도/컨텍스트 칩), `#working`(`#working-tx`, `#working-stop`). 인용 바 `#replybar`가 `#send` 앞에 들어와요.
- 기능: 글자 수에 맞춰 높이 자동(최대 140px, `autosize`). 단어 `ulw`를 쓰면 그라디언트 가장자리+키워드 마크(`paintUlw`). 초안 자동 저장(`saveDraft`). Enter 전송, Shift+Enter 줄바꿈(터치 기기는 Enter가 줄바꿈), 작업 중 Enter는 steer, `⌘/Ctrl+Enter`는 다음 턴 큐, `Alt+Enter`는 중단 후 전송(`sendChat(how)`), 작업 중 Esc는 중단(`stopTarget`). `/terminal <명령>`은 터미널 시트, `/screen`은 화면 공유, 그 밖의 `/명령`은 `sendCommand`로 게이트웨이에 가고 답은 카드로 대화에 붙어요. 보내기 버튼이 `stop` 모양이면 입력이 비었을 때 중단으로 동작해요. 붙여넣기/끌어놓기/`+`는 첨부 트레이 참조.
- 상태: placeholder 종료된 세션 `종료된 세션이에요`(입력 비활성), 결정 카드 있을 때 `번호를 누르거나 직접 입력해 주세요`, 재개 가능한 종료 세션 `재개하면서 보내기`, 로그 보기 `메시지 또는 /명령`, 프로젝트 `${이름} 프로젝트의 ${bot}에게 메시지 · /명령`, 메일 `이 메일 답장·전달은 ${bot}에게 · /명령`, 기본 `${이름}에게 메시지 · /명령`. 작업 줄(`#runline.runstate`, 한 줄) 왼쪽은 `작업 중…` 또는 `사용량 한도로 대기 중`(rate-limited, 경고색), 백그라운드 작업이면 `workLine`(`설명 · 경과`, 둘 이상이면 ` · 외 N개`; 앞말과 모델 이름은 없어요). 오른쪽 끝은 서브에이전트가 있을 때 `서브에이전트 N ›`(줄이 좁으면 왼쪽만 말줄임). 상태 글 없이 서브에이전트만 있으면 `서브에이전트 N개 진행 중 ›` 한 줄이에요. 전송 버튼 aria `보내기`/`중단`(stop 모드 title `지금 하는 일 중단`). 토스트: `파일을 올리는 중이에요`, `명령에는 파일을 붙일 수 없어요`, `명령에는 요소를 붙일 수 없어요`, `이 컴퓨터에서는 화면 공유를 쓸 수 없어요`, `터미널에서 실행할 명령을 /terminal 뒤에 적어 주세요`, 큐에 들어가면 `작업이 끝나면 전달할게요`, 중단하고 전송 `중단하고 보냈어요`, 중단 성공 `작업을 중단했어요`. 전송 실패는 글/첨부/인용/요소를 되돌리고 오류를 토스트(다른 대화로 옮겼으면 원래 대화에 초안을 남겨 `... · 보내지 못한 글은 원래 대화에 남겨 뒀어요`(파일이면 `(파일은 다시 붙여 주세요)`)). 다른 컴퓨터 대화는 파일을 그 컴퓨터로 먼저 올리고(`pqUpload`) 전송 뒤 `loadTarget`.
- 데이터: `POST /api/message`(text, cid, reply, lane, project, mail, settings, conv, mode, files, elements, refs; 같은 `cid`로 다시 보내면 한 번만 저장되고 처음과 같은 응답이 와요. 공백뿐인 글은 파일이나 요소가 없으면 400), `POST /api/command`, `POST /api/lanes/:name/abort` 또는 `POST /api/orchestrator/abort`, `GET /api/queue`.
- 근거: web/js/14-slash-commands.js:135(taFloor), :152(paintUlw), :169(autosize), :183,:193(keydown), :208(stopTarget), :221(sendCommand), :232(sendChat), :280(updateComposerMeta), :294(tickWorking), :302(renderWorking).
- css: web/css/04-files.css(`.working`, `.runline`, `.sendrow`, :211, :272 `pointer:coarse`), 07-chat.css(`#c-attach` :51), 03-base.css(`.ta-hl`), 12-composer-phone.css(`max-width:639px`).

### 슬래시 명령 및 @멘션 메뉴
- 목적: 입력창에서 `/`나 `@`를 치면 입력창 위에 명령/인자/진행 중 작업 후보를 보여 줘요(디스코드식).
- 구성: `div#hints.hintrow` 안에 인자 칩 줄 `.sl-args`(`.sl-c`, `.sl-a`), 머리 `.sl-hd`, 목록 `.sl-list[role=listbox]`의 `button.sl-i`(`.c`, `.ar`, `.d`). 목록 줄의 인자(`.ar`)는 인자마다 칩 `.sl-a` 하나이고, 없어도 되는 인자는 이름 끝에 `?`가 붙어요.
- 기능: ↑↓ 이동, Tab/Enter 선택, Esc 닫기(`SL.hide`로 같은 글에서는 다시 안 열려요), 탭/클릭은 포커스를 안 뺏어요. 명령 단계(`/` 시작)는 접두 일치 먼저, 포함 일치 뒤. 명령 뒤 공백이면 그 인자 후보(`opts()`)를 라이브 상태에서 만들고 선택 시 `/cmd 값 `으로 채워요. `@` 후보는 `mnItems()`(백그라운드 작업, 진행 중 대화+그 작업, 살아 있는 세션)이고 선택하면 `@제목 `이 들어가고 전송 시 남아 있는 토큰만 `refs`로 가요(`mnRefs`).
- 상태: 명령 목록(`CMDS`): `/status` 봇·세션·Discord 상태와 컨텍스트, `/context` 프로세스별 컨텍스트 사용량과 압축 상태, `/compact` 컨텍스트 압축 (작업 중이면 끝난 뒤), `/lanes` 세션마다 상태·모델·폴더, `/model` 모델 보기, 또는 대상의 모델 바꾸기, `/effort` 추론 강도 바꾸기, `/restart` 에이전트 재시작 · 게이트웨이는 전체 재시작, `/stop` 세션 멈추기 (나중에 다시 시작할 수 있어요), `/resume` 멈춘 세션 이어가기, 실행 중이면 메시지 보내기, `/abort` 지금 하는 일 취소 (비우면 봇), `/providers` 로그인·API 키·공급자별 모델, `/login` 공급자 로그인 (링크가 열려요), `/logout` 공급자 로그아웃, `/quota` 공급자·모델별 사용 한도, `/terminal` 이 컴퓨터 터미널에서 명령 실행, `/screen` 이 컴퓨터 화면 열기(`S.desk`가 있을 때만), `/help` 명령 전체 설명. 머리 문구: 명령 단계 `명령`(봇 이름+로고), 멘션 `지금 진행 중 · 골라서 지칭하기`, 인자 `${인자명}`(선택이면 ` · 비워도 돼요`). 선택 인자는 미리 선택되지 않아 Enter가 입력 그대로 전송해요. 모델 후보에서 Haiku, Fable, 날짜 붙은 스냅샷은 빼요. 폰(`max-width:639px`)은 항목 높이 44px, 인자 표기(`.ar`) 숨김. 후보가 없으면 메뉴가 닫혀요. 자유 입력 인자(`free`)는 후보 없이 닫혀요.
- 데이터: 후보는 상태(`S.lanes`, `M.available`, `P.providers`, `S.convs`)에서 만들어요. 실행은 `POST /api/command {text}`(성공하면 `/model|effort|compact|restart|resume|stop|abort`일 때 `refreshState`, `loadModels`, `loadContext`).
- 근거: web/js/14-slash-commands.js:10(CMDS), :35(SL), :38(mnItems), :49(mnParse), :55(slParse), :64(updateHints), :113(slMark), :119(slPick), :183-192(키 처리). 명령 팔레트가 같은 목록 `hintList`를 써요(:33).
- css: web/css/04-files.css(`.sl-*` :249 `max-width:639px`, `#hints` 위치는 JS가 `bottom`을 정함).

### 대기열 (작업이 끝나면 전달할 메시지)
- 목적: 작업 중에 `⌘/Ctrl+Enter`로 쌓은 메시지를 다음 턴에 보낼 때까지 보여 줘요.
- 구성: 대기 카드는 없어요. 타임라인 `#tl` 맨 끝에 대기 순서대로 `div.um.qd`(흐린 말풍선 `.ub`와 그 아래 작은 줄 `.qd-ln`: `작업이 끝나면 전달 · 지금 끼워넣기 · 취소`). 보낸 메시지가 일반 말풍선으로 그려지면 대기 말풍선은 사라지고, 대기가 늘면 맨 아래로 스크롤해요.
- 기능: `지금 끼워넣기`(`POST /api/queue/:id/send`), `취소`(`DELETE /api/queue/:id`로 글을 입력창에 되돌림, `takeBack`).
- 상태: 입력창에 글이 있으면 취소가 `입력창을 비운 뒤 취소해 주세요`(오류 토스트). 현재 대상의 항목만 보여요. 분할 화면의 비활성 칸도 같은 말풍선을 자기 타임라인 끝에 그려요(`paintQueue(list, t)`).
- 데이터: `GET /api/queue`, `POST /api/queue/:id/send`, `DELETE /api/queue/:id`. `answerDecision`/`sendChat` 응답의 `queued`로 갱신.
- 근거: web/js/14-slash-commands.js `loadQueue`, `renderQueue`, `paintQueue`, `qdBubble`, `takeBack`.
- css: web/css/04-files.css(`.um.qd`, `.qd-ln`).

### 입력창 아래 칩 (모델, 강도, 컨텍스트)
- 목적: 대상의 모델, 추론 강도, 컨텍스트 사용률을 보고 바로 바꿔요.
- 구성: `#cbar` 안 `#c-own`(소유자 라벨), `#c-model`, `#c-effort`, `#c-worker`(세션의 서브에이전트 모델), `#c-api`, `#c-fb`(폴백), `#ctx-ring`. 첨부(+)는 글 상자 왼쪽, 칩은 상자 아래 줄.
- 기능: `#c-model`/`#c-effort`/`#c-worker` 탭은 `chipMenu`로 캐시된 `/api/target` 목록 메뉴를 먼저 열고 다시 불러와 다르면 갱신. 선택은 `targetChange`. 모델 메뉴 마지막 `모델 · 폴백 설정`(sub `폴백 순서까지`)은 `openModels`. `#ctx-ring` 메뉴: `지금 압축`(sub `작업이 끝나면 압축해요` 또는 `캐시가 한 번 다시 쓰여요`), `압축 진행 중`, `컨텍스트 화면 열기`. 15초마다 컨텍스트 새로고침(chat/activity 화면에서, 15-attachments.js:206).
- 상태: 칩은 모델이 없으면 숨김. 라벨은 `modelChipText`(예 `Opus 5.5 · medium`, 최대 20자). 컨텍스트 칩 `컨텍스트 ${n}%` 또는 `컨텍스트 ${kfmt} `, 80% 이상 경고색. 소유자 라벨은 비서/프로젝트면 봇 이름, 세션이면 `세션 ${제목}`. 서브에이전트 칩 `서브에이전트 ${모델}`. 작업 중 세션에서 모델을 바꾸면 확인창(`ask`)이 `작업 중인 세션이라 컨텍스트 ${n} 토큰이 캐시에 다시 쓰여요` + 적용 버튼 `적용`. 성공 토스트 `작업이 끝나면 압축해요`/`압축을 시작했어요`/`적용했어요`(또는 `applyKo`의 문구). 폰(`max-width:600px`)에서 `.cchip.cown` 숨김.
- 데이터: `GET/PUT /api/target?target=main|lane:<이름>`, 컨텍스트는 `loadContext`, 모델 목록은 `loadModels`.
- 근거: web/js/14-slash-commands.js:355-490(kfmt, modelShort, modelChipText, renderCtxRing :387, chipMenu :436, targetChange :443, 칩 핸들러).
- css: web/css/04-files.css(`.cbar`, `.cchip`, :257, :263).

### 인용 답장 (메시지 인용)
- 목적: 메시지를 인용해 다음 메시지에 붙여 보내요(디스코드 답장처럼).
- 구성: 메시지 행 메타줄(`.mt`)의 `button.rp-btn`(호버 시 보임, aria/title `인용`), 입력창 위 `div#replybar.rpbar`(`.rp-tg` 상태 태그, `.rp-ct` 본문 `button.rp-tx`, `.rp-x` 취소), 보낸 글 위 `button.rpq`(`.rpq-au` 작성자, `.rpq-ct`), 스와이프 중 `.rp-ind`.
- 기능: 호버 버튼 또는 터치/펜으로 오른쪽에서 왼쪽 스와이프(60px에서 고정, 최대 92px, 햅틱 8ms)로 `rpStart`. 바의 본문 탭은 인용 원문으로 스크롤(`rpJump`, `rp-flash`). `인용 취소`는 `rpClear`. 전송 시 `rpTake`로 `{id, author, content}`가 `reply`로 가고 실패하면 `rpRestore`. 세로 스크롤, 화면 가장자리 24px 시작, 링크/버튼/입력/`pre`/`table` 위 시작은 무시해요.
- 상태: 바 aria `인용할 메시지`, 본문 aria `인용한 메시지로 이동`, 취소 aria/title `인용 취소`. 인용 본문은 300자까지. 인용 글쓴이 라벨은 봇 답이나 내 글이면 `나`, 아니면 작성자. 마우스 기기만 호버 버튼(`hover:hover and pointer:fine`)이고 터치 기기에서는 버튼을 숨기고 스와이프만 써요. 카드형 글(`e.card`)과 텍스트 없는 글은 인용 불가. 인용 바는 현재 대상 것만 보여요.
- 데이터: `POST /api/message`의 `reply` 필드. 봇 글이 답하는 원문은 서버가 주는 `reply`, 없으면 `reply_to`로 로드된 메시지에서 찾아요.
- 근거: web/js/39-reply.js:14(rpMark), :23(rpStart), :32(rpPaint), :45(rpTake), :52(rpJump), :61(rpAsked), :70(rpQuote), :79(rpDown), :86(rpMove), :115(rpEnd), :127-146(리스너).
- css: web/css/15-reply.css(`.rp-btn`, `.rpbar`, `.rpq`, `.rp-pull`, `.rp-ind`; :29 `hover:hover`, :30 `hover:none`).

### 답장 확인 (모니터링 > 답장 확인 큐)
- 목적: 모든 앱, 모든 컴퓨터의 보내기 대기 답장 초안을 한 목록에서 보내기, 고치기, 보내지 않기 해요.
- 구성: 모니터링의 항목 `답장 확인`(키 `replies`, 아이콘 `send`) 상세 안: 앱 선택 중일 때만 `div.mr-filter.rq-filter[role=tablist][aria-label=앱별 답장]`(칩 `전체` + 앱별), 출처별 `div.mon-sec`(heading) + `div.rq-q` 안 답장 초안 카드들(`rqCard`).
- 기능: 카드 `열기`(`rqGoTo`: 메일은 `c:<mail>`, 그 밖은 앱 패널), 보내기/고치기/보내지 않기. 저장소 초안(카카오톡, 댓글)은 앱 라우트로, 알림형 초안(메일 등)은 `answerInline`/`ntPost`로, 다른 컴퓨터 것은 `/api/peer/act`로 그 컴퓨터에서 한 번 실행해요. 고치기는 입력 한 줄(`어떻게 고칠까요?`) 후 봇이 다시 써요. 보낸 저장소 초안은 큐를 다시 열 때까지 `보냈어요 · 방금`으로 남아요.
- 상태: 항목 힌트 `${앱이름 최대3} 답장 ${n}건`, 없으면 `확인할 답장이 없어요`(열려 있을 때만 항목이 보임). 본문 비었을 때 `확인할 답장이 없어요`, 로딩 `불러오는 중…`. 앱 필터 칩에 개수. 처리 중이면 카드 `busy` 클래스+버튼 비활성. 고친 뒤 토스트 `고쳐 달라고 했어요. 새 초안이 오면 여기 다시 떠요`. 보내지 않기 후 토스트 `보내지 않았어요` + `되돌리기`(6초, 댓글+메일 동반은 되돌리기 없음). 되돌림 `초안을 되돌렸어요`. 연결 끊김 `연결이 끊겨 처리하지 못했어요`. 보내기 시 경고/첨부가 있으면 `drfSure` 확인. 같은 메일의 초안은 최신 것 하나만, 같은 키는 중복 제거, 알림이 이미 보여 주는 저장소 초안은 허브가 빼요.
- 데이터: `GET /api/replies`(items), 카카오톡 `POST /api/kakao/chat/:chatId/draft`(revise)와 `/api/kakao/drafts/:code/{send|drop|restore}`, 댓글 `POST /api/comments/drafts/:code/{revise|send|drop|restore}`, 다른 컴퓨터 `POST /api/peer/act`(action `kakao` 또는 `comments`), 알림 경로(`ntPost`, `answerInline`). 갱신 `rqLoad`, `pqLoad`, `loadIntegrations`.
- 근거: web/js/30-replies.js:10(rqLoad), :34(rqAll), :56(rqMonItem), :64(rqOpen), :68(rqRun), :75(rqStoreCall), :93(rqStoreActs), :106(rqNoticeActs), :114(rqRevise), :130(rqCardOf), :152(rqGoTo), :158(rqFilterBar), :165(rqNodes), :174(rqSig).
- css: web/css/15-reply-card.css(`.rq-q`, `.rq-filter`, :49 `pointer:coarse or max-width:639px`), 16-result-card.css/20-mail-box.css(`.mr-filter`).

### 답장 초안 카드 (공통 컴포넌트)
- 목적: 메일, 카카오톡, 댓글의 답장 초안을 같은 모양과 같은 세 동작으로 보여 줘요.
- 구성: `div.rq`(댓글이면 `.rq.cm`): 머리 `.rq-hd`(아이콘 `.dr-ic` 또는 이니셜 `.rq-av`, `.rq-meta`의 `b.rq-wt` + `.rq-src` + `.mon-pc`(출처와 컴퓨터 이름은 한 줄에 통째로 들어갈 때만 보이고, 안 들어가면 잘린 글 없이 빠져요), 시각 `.rc-time`, 꼬리 `열기`), 원문 인용 `.rq-og-wrap > .rq-orig`(+ 토글), 소제목 `.rq-lb`, 받는이 `.rq-to`(또는 `recv` 행), 제목 `.rq-sub`, 본문 `.rq-body`(6줄 접힘, `.rq-more`), 첨부 `.rq-att`, 추가 노드, 바닥(동작 `.rq-acts` / 고치기 `.rq-edit` / 상태 `.kk-st` / `.rq-sent`).
- 기능: 본문 `펼치기`/`접기`(키별로 유지 `RQ_OPEN`). 원문 `원문 보기`/`원문 접기`(`RQ_OG`). 동작 세 개 `보내기`(`.dr-send`), `고치기`, `보내지 않기`는 호출자가 준 핸들러를 쓰고 없으면 비활성(`disabled`). 고치기 입력은 Enter로 제출(IME 조합 중 제외), 최대 500자, 보조 `직접 수정`(호출자가 줄 때).
- 상태: 머리 `${이름}님께 답장`(원문 작성자가 있을 때) 아니면 앱 이름(`메일`, `카카오톡`, `인스타그램`, `유튜브`, `웹사이트 댓글`), 출처 줄은 계정 라벨+모델+`· 컴퓨터 이름`. 긴 본문은 36자/줄로 세서 6줄 넘으면 접고 `펼치기`. 첨부 줄은 항상 보이고 `첨부 ${n}개`+파일명(크기), 없으면 `첨부: 없음`, 못 붙이는 곳이면 남는 파일이 있을 때만 `첨부: 없음 · 파일을 붙일 수 없는 곳이에요` + `남는 파일: ...`(남는 파일이 없으면 줄 없음). 고치기 필드 placeholder `더 짧게, 존댓말로, 견적서도 첨부한다고 써 줘`(aria `고칠 내용`), 질문 `어떻게 고칠까요?`, 버튼 `고쳐 달라고 하기`, `취소`. 보냄 표시 `보냈어요 · 방금`(role=status). 카카오톡 새 대화 초안은 소제목 `새 메시지 초안`, 받는이 라벨 `대화방`, 댓글은 `댓글`. 처리 중이면 `busy` 클래스. 터치(`pointer:coarse`/`max-width:639px`)는 버튼 높이를 키움.
- 데이터: 직접 데이터 호출 없음. 호출자(`30-replies.js`, `30-monitoring.js` draftCardNode, `30-kakao.js` kkDraftCard, `30-monitoring-comments.js` cmDraftCard)가 넘겨요.
- 근거: web/js/10-reply-card.js:15(rqHeadNode), :26(rqLong), :28(rqBodyNode), :42(rqActsNode), :48(rqReviseNode), :61(rqAttachNode), :72(rqOrigNode), :90(rqCard), :103-106(rqSentNode, 토스트).
- css: web/css/15-reply-card.css(`.rq-*`; :49, :63 `pointer:coarse or max-width:639px`), 03-base.css(`.rq-body`, `.rq-orig`).

### 결정 카드 (입력창 위에 붙는 질문 카드)
- 목적: 오너의 답을 기다리는 질문(세션의 `pendingAsk`, `[ask]` 메시지, `결정:` 선택 블록)을 입력창 위에 붙여 번호를 눌러 답하게 해요.
- 구성: `section#dcard.dcard`(`aria-label=답변 필요`): 머리 `.dc-hd`(`.dc-meta`의 `확인 필요`(`.dc-ey`) + `답 기다림`(`tag warn dc-wt`), 질문 `mdNode .dc-q`, 정할 것 `.dc-decide`, 접기 버튼 `.dc-fold`), 본문 `.dc-body`(초안 `.dc-draft`, 선택지 `button.dc-row`(`.dc-key` 번호, `.dc-lb`, `.dc-tag 추천`, `.dc-ds` 설명), 여러 결정이면 `.dc-sub` 소제목과 `button.dc-send`, 직접 입력 `.dc-edit`), 상태 줄 `.dc-st`.
- 기능: 선택지 탭은 `pickOption`. 결정이 하나면 바로 답(`answerDecision`: 알림 경로 `ntPost` 또는 `POST /api/message` with `picks`, `reply_to`). 결정이 여럿이면 선택만 표시(`✓`)하고 모두 고른 뒤 `보내기`(`dcSendAll`, 문장 `결정 답: 1) ... · 2) ...`). 알림 그룹(`decisionGroup`)은 하나씩 즉시 답하고 그 블록이 빠져요(`answerEach`). 이유가 필요한 선택지(이름 끝 ` …`, `안됨/아니/고치기/수정/다른` 시작, 설명이 글을 요구)는 입력칸(`editNode`)을 먼저 열어요. 접기 `.dc-fold`(aria `접기`/`펼치기`). 보낸 뒤 카드는 바로 접혀 사라지고 기록은 대화에 남아요(`dcLeave`, `motionOut`).
- 상태: 상태 줄 `보내는 중…`, `보냈어요 · 처리하는 중`, 초안 고치기 선택 뒤 `고치는 중…`. 보낸 뒤에는 고른 행만 남아요(초안 카드 제외). 입력칸 placeholder `이유나 내용을 적어 주세요`(aria `자세한 내용`), 버튼 `돌아가기`와 `${옵션}(으)로 답하기`. 초안 카드 전용 버튼은 아래 시트 항목 참조. 실패 시 토스트로 오류, 고른 값은 유지(`DC.picks`). 알림/작업 기록 대화에서는 카드를 붙이지 않고 시트로 열어요(`isFixedT`). 세션이 종료되고 재개 불가면 카드 없음. 같은 대화 안에서 이미 답이 있는 질문은 카드 없음. 새로 도착한 카드만 위로 올라오는 애니메이션(`motionIn`), 첫 그림과 대화 전환 직후는 없음. 입력창 placeholder가 `번호를 누르거나 직접 입력해 주세요`로 바뀌어요.
- 데이터: `POST /api/message`(text, picks, reply_to, lane/project/mail/conv, mode), 알림 경로 `ntPost`, 읽는 쪽 `NT.items`(알림), 세션 `pendingAsk`.
- 근거: web/js/10-decision-card.js:22(parseChoices), :63(decisionGroup), :69(decisionOf), :73(decisionOne), :104(answerDecision), :124(pickOption), :137(answerEach), :143(dcSendAll), :149(multiNodes), :453(renderDecision), :536(dcLeave), :549(paintDecision), :592(dcSig). 정규식 :3-12.
- css: web/css/07-chat.css(`#dcard`, `.dc-*` :135 `pointer:coarse`, :173), 14-overlay.css(`.dc-row` 시트용), 01-tokens.css.

### 결정/발송 승인 시트 (전체 화면 결정 카드)
- 목적: 알림에서 열거나 초안 보내기 승인(보내기/고치기/보내지 않기)을 전체화면 시트에서 처리해요.
- 구성: 메일 답장 초안(받는이 행이 있는 것)의 시트는 댓글 답글 확인과 같은 `답장 확인` 시트예요(`mid rq-sheet`: 폰은 내용 높이 바텀시트, 넓은 화면은 가운데 창). 머리는 `답장 확인`과 닫기 ✕ 하나(`무시` 없음; 뒤에 기다리는 카드가 더 있으면 제목 옆에 옅은 글 `· 남은 N건 (1/2)`을 `.fs-left`로 보여요, 값이 없으면 자리도 없어요; 닫으면 나중에 확인, 버리기는 `보내지 않기`), 본문 `.fs-body.rq-sb`는 `rqMailParts`(10-reply-card.js)의 부품을 `rqCard`로 그리고(한 줄 머리 `${이름}님께 답장 · 메일 · 시각` + 오른쪽 `열기`, 받은 글 인용 + `원문 보기`, 굵은 제목(카드와 같은 굵기), 본문, 접힌 받는이 줄, 첨부 줄), 메일 화면의 목록 카드는 출처 글 ` · 메일`을 붙이지 않고(알림 시트와 `답장 대기`에는 남아요) 이미 본 줄은 `seen`으로 한 번만 보여요. 바닥 `.fs-ft`는 `.rq-acts`(`보내기`, `고치기`, `보내지 않기`, 맨 오른쪽 `직접 수정`). 그 밖의 초안은 아래 구성: `fsOpen` 시트: 머리(`.fs-ey` 질문/`보내기 전에 확인해요` + `.fs-left`, 받는이 줄 `.dc-dh`, 제목, `받는이 확인: ...`, 무시/닫기), 본문 `.fs-body.panel`(정할 것, 받는이·참조 행, 규칙 태그, 출처, 본문 `.dc-dr-b`, 첨부 줄, 동반 메일), 바닥 `.fs-ft`(한 줄 동작 `.dc-acts` 또는 선택지 행). 원문이 있으면 `.od-stage`로 원문 패널과 나란히.
- 기능: 초안 동작 `보내기`(첫 선택지, main)/`고치기`(alt)/`보내지 않기`(+ 선택지 라벨 그대로). `직접 수정`(연필)은 본문을 직접 고쳐 `이 내용으로 고쳐 주세요: ...`로 보내요(첨부 파일은 `첨부할 파일 N개(...)를 이 초안에 붙여 주세요.`가 앞에 붙음). `직접 수정`에서 `파일 첨부`로 최대 10개 업로드. 선택지 행은 `choiceRow`. 보내기 시 경고/첨부가 있으면 `drfSure` 확인.
- 상태: 머리 `결정이 필요해요`/`답변이 필요해요`(초안 아닐 때), 진행 `남은 N건 (k/T)` 또는 `마지막 카드예요 (T/T)`. 입력칸: 고치기 `어떻게 고칠까요?`(placeholder 같은 `더 짧게, 존댓말로, 견적서도 첨부한다고 써 줘`), 보내는 방법 `어떻게 보낼까요?`(placeholder `메일 먼저 보내고 답글은 내일 올려 줘`), 직접 수정 placeholder `보낼 내용을 직접 고쳐 주세요`, 버튼 `고쳐 달라고 하기`/`이렇게 보내 달라고 하기`/`이 내용으로 고치기`. 파일 올리는 중 `올리는 중…`. 다른 컴퓨터 초안 파일 오류 `다른 컴퓨터의 이 초안에는 파일을 붙일 수 없어요`. 처리 후 인라인 답 토스트 `보냈어요`(+`메일 열기`) 또는 `보내지 않았어요`(+`되돌리기`, 성공 `초안을 되돌렸어요`). 스크롤/입력 포커스와 캐럿은 다시 그려도 유지해요.
- 데이터: 알림 경로(`ntPost`, `/api/notices/reopen`), `POST /api/message`, 파일 `POST /api/upload`, 초안 파일/받는이/원문 API(아래 항목), 다른 컴퓨터는 `pqNotice`.
- 근거: web/js/10-decision-card.js:403(renderSheet), :448(choiceRow), :368(editNode), :379(editFilesNode), :355-367(문구 상수), :507(answerInline), :519(dcAnswerToast), :525(dcReopen).
- css: web/css/14-overlay.css(`.fs-*`, `.dc-row`), 07-chat.css(`.dc-edit`, `.dc-acts`).

### 답 대기 포인터와 결정 기록
- 목적: 위로 밀린 열린 발송 승인 카드를 가리키고, 답한 결정을 대화에 기록으로 남겨요.
- 구성: 포인터 `button.dc-wait`(`.dc-wait-k`, `.dc-wait-t`, `.dc-wait-n`, `.dc-wait-go`)가 `#dcard`에 들어가요. 기록 `div.dc-rec[role=note][aria-label=결정 기록]`(행 `.dc-rec-r`: `.dc-rec-k` 질문, `.dc-rec-q`, `.dc-rec-k` `· 답:`, `.dc-rec-a`).
- 기능: 포인터 탭은 `noticeSheetOpen(n.id)`로 시트 열기. 기록은 내 답 메시지의 `picks`에서 그려요(`질문 <제목> · 답: <n) 라벨 - 메모>`), 파일/메타줄 포함.
- 상태: 포인터 문구 `답 대기`, 제목(초안 질문 또는 `보내기 확인`), 진행 `남은 N건 (k/T)`, 버튼 `열기`. 결정 카드가 없고 해당 대화에 열린 초안 승인이 있으면 가장 오래된 것 하나를 가리켜요. 기록은 `picks`가 비면 안 그려요. 기록 행은 폰(`max-width:639px`)에서 `max-width:90%`.
- 데이터: `NT.items`(열린 승인 알림), 내 메시지 이벤트의 `picks`.
- 근거: web/js/10-decision-card.js:581(dcWaitingCard), :582(dcPointer), :600(dcRecordNode).
- css: web/css/07-chat.css(`.dc-wait*`, `.dc-rec` :146).

### 메시지 속 선택지 (인라인 `dcm`)
- 목적: 에이전트 메시지 안의 선택지 버튼을 지금 대기 중인 질문일 때만 누를 수 있게 하고, 답한 뒤에는 고른 행을 표시해요.
- 구성: 메시지 안 `.dcm`(행 `.dcm-row`, `data-b`, `data-n`, 모니터링용 `.mon-dc`는 제외).
- 기능: `syncInlineChoices`가 도킹 카드(`DC.cur`) 또는 그 메시지의 결정 알림 상태로 `disabled`와 `on`을 맞춰요. 대기 중이 아닌 메시지의 탭은 `answerInline`(알림 경로)로 답하고, 이유가 필요한 선택지는 알림 시트를 열어요.
- 상태: 열림=누를 수 있음, 답함=비활성+고른 행 `on`, 전송 중(`dcSending`)=비활성.
- 데이터: `NT.items`, 알림 응답 경로(`ntPost`).
- 근거: web/js/10-decision-card.js:492(dcNoticeAt), :494(syncInlineChoices), :507(answerInline).
- css: web/css/07-chat.css(`.dcm`).

### 초안 첨부 줄
- 목적: 발송 전에 초안에 어떤 파일이 같이 가는지 보여 주고, 메일 답장 초안이면 파일을 더하고 뺄 수 있게 해요.
- 구성: `.dr-files`: 개수 줄 `.dr-fh`, 파일 행(`a.dr-att` + 빼기 `.dr-x`), `파일 추가`(`.dr-add`) 메뉴(`.dr-menu`), 폴더 목록 `.dr-lib`, 경고 `.dr-warn`/`.dr-none`.
- 기능: 파일 행은 새 탭에서 열기. `파일 추가`는 `이 기기에서 고르기` 또는 `첨부 파일 폴더에서 고르기`. 빼기 x(aria `${이름} 빼기`, title `첨부에서 빼기`). 메일 초안(`받는이`)은 열릴 때 `drfLoad`.
- 상태: `첨부 ${n}개`(읽기 전용 동반 메일은 `✓ 첨부 ${n}개 붙어 있어요`), 없으면 줄을 그리지 않아요(메일 초안은 `첨부: 없음` 띠 없이 `파일 추가`만 보여요; 다른 카드의 `첨부: 없음`은 띠가 아니라 `--fg-3` 작은 한 줄이고, 띠는 `.dr-warn`과 파일을 못 붙이는 곳의 안내뿐이에요). 추가 중 `붙이는 중…`. 폴더 `불러오는 중…`/`폴더가 비어 있어요`, 일치 표시 `맞음`. 계정이 파일을 못 보내면 `이 계정은 파일을 못 보내요 · 본문만 가요`. 파일을 확인하지 못했으면 `첨부가 실제로 붙었는지 몰라요`+`보내기 전에 확인해 주세요`. 본문이 파일을 보낸다고 하는데 없으면 `d.warning`. 보내기 전 확인창: `첨부를 확인하지 못했어요`(`그래도 보내기`), `첨부 없이 보낼까요?`/`이 계정은 파일을 못 보내요. 본문만 가요.`. 다른 컴퓨터 초안 10MB 초과 `다른 컴퓨터의 초안에는 10MB 이하 파일만 붙일 수 있어요`. 연결 끊김 `연결이 끊겨 처리하지 못했어요`. 업로드 한도 오류 `올리지 못했어요 (HTTP n)`.
- 데이터: `GET/POST /api/drafts/:ref/files`, `GET /api/drafts/:ref/library`, `GET /api/drafts/:ref/files/:n`(파일 열기), `POST /api/upload`. 다른 컴퓨터는 프록시(`pqLink`).
- 근거: web/js/10-decision-card.js:163-194(drf*, uploadFile :179, drfSure :187), :195(draftFilesNode).
- css: web/css/16-result-card.css(`.dr-files`, `.dr-warn`, `.dr-add`), 07-chat.css(`.dr-add`).

### 초안 받는이와 참조 행 (메일 답장)
- 목적: 메일 답장 초안의 답장 범위와 받는이/참조 주소를 확인하고 고쳐요.
- 구성: 메일 답장 시트와 모니터링 메일 항목에서는 이 행들이 접힌 한 줄 `button.rq-recv`(`받는이 한서윤 외 1명 · 전체 답장 · 참조 1 ⌄`, 왼쪽 정렬, aria-expanded) 안에 있고, 누르면 그 자리에서 아래 필드로 펼쳐져요(`draftRecvFold`, 10-reply-card.js; 받는이가 비었거나 주소가 틀리면 처음부터 펼침). `.dr-recv`: 구분 버튼(`.seg.dr-seg`, aria `답장 범위`: `답장`, `전체 답장`), 행 `.dr-rcrow`(`받는이`, `참조`; 칩 `.dr-chip.dr-rc`: 주소 버튼 `.dr-rc-t` + 빼기 `.dr-rc-x`; 추가 `.dr-rc-add`; 편집 `.dr-rc-edit`).
- 기능: 주소 탭은 고치기, x는 빼기, `추가`는 입력칸(`확인`/`취소`), Enter 제출. 변경은 서버가 승인 알림을 다시 써서 모든 화면이 같아져요.
- 상태: 칩 title `고치기`, 빼기 title `빼기`, aria `${주소} 고치기/빼기`, `${라벨} 추가`. 입력 placeholder `받는 사람 주소`/`참조 주소`/`메일 주소 추가`/`참조 주소 추가`. 저장 중에는 전부 비활성. 실패 `연결이 끊겨 바꾸지 못했어요`. 읽기 전용(`edit:false`, 보낸 초안, 동반 카드)이면 버튼 없이 텍스트. 초안에 `cc`가 없고 편집 불가면 참조 행 생략.
- 데이터: `GET/POST /api/drafts/:ref/recipients`(to, cc, mode). 다른 컴퓨터 초안은 프록시.
- 근거: web/js/10-decision-card.js:256-318(DRR, drrLoad/Write, draftToNode :267).
- css: web/css/16-result-card.css(`.dr-rc*`, `.dr-recv`; :168 `pointer:coarse`).

### 초안 부속 블록 (규칙 태그, 출처, 함께 보낼 메일, 정할 것)
- 목적: 초안 카드에 어떤 자동 초안 규칙으로 썼는지, 어디서 이어졌는지, 같이 가는 메일, 오너가 정할 것을 붙여요.
- 구성: `.dr-rulebar > .tag.dr-rule`(규칙 이름), `.dr-origin`(`icon open` + 링크/텍스트), `.dr-mailpart`(머리 `함께 보낼 메일`, 받는이/제목/본문 `.dc-dr-b[aria-label=함께 보낼 메일 내용]`, 첨부), `.dc-decide`(`정할 것` + 목록), 결합 카드의 `내 답글`(`.dr-mh`).
- 기능: 규칙 태그 title `자동 초안 규칙: ${이름}`. 출처 링크는 새 탭. 동반 메일 파일은 열기만(읽기 전용).
- 상태: 규칙/출처/동반 메일/정할 것은 값이 있을 때만 보여요. 댓글 답글+메일 결합 카드는 위에서 댓글 원문 인라인(`댓글 원문`), `내 답글`, 메일 순.
- 데이터: 초안 객체(`rule`, `origin`, `mail`, `decide`)만 읽어요.
- 근거: web/js/10-decision-card.js:320(draftRuleTag), :323(draftOriginNode), :330(draftMailNode), :341(replyHead), :342(draftNode), :364(decideNode).
- css: web/css/07-chat.css(`.dc-draft`), 16-result-card.css(`.dr-*`).

### 원문 보기 패널 (초안이 답하는 메일/댓글 원문)
- 목적: 답장 초안 옆에 답하려는 메일이나 댓글 원문을 따로 보여 줘요.
- 구성: 메일 답장 시트와 모니터링 메일 항목은 이 패널 대신 인용 아래 `button.rq-og`(`원문 보기`/`원문 접기`)가 `.od-pane`을 그 자리에서 펼쳐요(탭·막대 없음). 아래는 댓글 답글 시트. 호스트에 `od-host`/`od-on` 클래스. 막대 `.od-bar`(데스크톱 `button.od-tg` `원문 보기`/`원문 접기`, 폰 `.od-seg` 구분 `초안` | `원문`), 원문 패널 `section.od-orig`(머리 `원문` + 닫기 `.od-x`, 본문 `.od-pane`), 초안 쪽 `.od-draftcol`, 스테이지 `.od-stage`. 결합 카드는 `.od-inline`(`댓글 원문`).
- 기능: 열 때 처음 한 번 원문을 가져와 초안별로 보관. 데스크톱(>=900px)은 원문이 왼쪽 독립 패널로 열리고 초안이 오른쪽으로 밀려요. 폰(<=899px)은 구분 버튼으로 두 면을 밀어 바꾸고, 원문이 보이는 동안 초안 쪽은 `inert`. 댓글 패널은 게시물(`영상`/`게시물`/`글` + 제목, 썸네일), 작성자, 시간, 부모 댓글(`↳ ${작성자}의 댓글`), 본문, `원본 열기` 링크. 메일 패널은 메일 헤더, 날짜, 제목, 본문(`mailBodyNode`), 첨부(`mailFileUrl`) 목록.
- 상태: 불러오는 중 `원문을 불러와요…`, 없음 `원문을 찾을 수 없어요`(404), 실패 `원문을 불러오지 못했어요 ` + `다시 시도`. 패널 aria `메일 원문`/`댓글 원문`, 닫기 aria `원문 닫기`, 그룹 aria `초안과 원문 고르기`. 감소 모션 설정이면 애니메이션 없음. 다른 컴퓨터 초안이면 파일/원문을 프록시로 읽고 메일은 `PQ.of`에 등록.
- 데이터: `GET /api/drafts/:ref/original`(kind `mail` 또는 `comment`, 본문 `mailBodyNode`는 `GET /api/mail/:key/body`).
- 근거: web/js/10-draft-original.js:12(orgLoad), :26(orgComment), :36(orgFill), :54(orgInline), :65(orgNodes).
- css: web/css/15-draft-original.css(`.od-*`; :48 `min-width:900px`, :59 `max-width:899px`, :78 `prefers-reduced-motion`), 18-comments.css(`.od-bar`).

### 결과 카드 (메일/감시/예약 결과)
- 목적: 메일이나 모니터링 결과(감시 보고, 예약 실행, 서비스 글)를 머리글, 제목, 라벨 붙은 요약, 접힌 원문으로 그려요(채팅과 모니터링 공통).
- 구성: `div.bm.alert.rc`: `.rc-hd`(`.rc-src` 출처, 태그, `.rc-time` KST 시각), `.rc-title`, 섹션 `.rc-sec`(`.rc-sh` 라벨, 본문 마크다운 또는 `.rc-rows`), 파일 칩, 접힘 `details.rc-raw`(`summary` + `.rc-rawbody`), 동작 `.btns.cc-act`.
- 기능: 라벨 인식(`요약`, `할 일`, `할일`, `다음 할 일`, `핵심`, `결과`, `변경`, `참고`, `상세`, `확인할 것`)로 섹션을 나눠요. `<시각|답장|가격|재고|새 글|확인|변경> 내용 · 상세` 줄 목록은 열 정렬 행(`.rc-row`)이 되고 가격 변경은 이전 값 취소선 → 새 값. 원문은 `원문` 줄 또는 ` ```원문 ` 울타리에서 떼어 내 파이프 줄을 표로 바꿔 보여요. `[file]` 줄은 파일 칩으로.
- 상태: 원문 접힘 `원문 보기`/펼침 `원문 접기`(`rawOpen`이면 처음부터 열림). 내용이 전혀 없으면 `null`(카드 안 그림). 시각은 오늘이면 `HH:MM`, 아니면 `날짜 HH:MM`.
- 데이터: 없음(호출자가 text/at/title/raw/tag/actions를 줌).
- 근거: web/js/11-resultcard.js:6(rcLabel), :11(rcSplit), :20(rcSections), :33(rcRawMd), :52(rcRawFold), :62(rcRowsNode), :82(resultCard).
- css: web/css/16-result-card.css(`.rc-*`; :122 `pointer:coarse or max-width:639px`), 20-mail-box.css, 04-files.css(`.bm.res` :110).

### 아침 점검 브리핑 카드
- 목적: 봇의 아침 브리핑 형태 답(`- 10:00 제목` 줄 묶음 + 개수/메일 줄)을 행과 칩으로 그려요.
- 구성: `div.hcb`: 앞글 마크다운, `.hcb-card`(머리 `.hcb-hd`: 태그 `아침 점검`(본문에 `브리핑` 또는 `아침`이 있을 때) + `.hcb-h`, 행: `.rc-rows`, `timeRowsHtml`), `.hcb-chip`(메일 N통 줄), `.hcb-ln`(`N개/통/건/명` 짧은 줄), 나머지 마크다운.
- 기능: 읽기 전용. 숫자만 `.hcb-n`로 강조. 모양이 안 맞으면 `null`을 돌려 일반 마크다운으로 그려요.
- 상태: 본문에 `브리핑`, `아침`이나 메일 줄이 있고 행이 2개 이상 연속이어야 카드가 돼요. 머리 줄은 24자 이하이고 문장 부호로 안 끝나야 해요. 그 밖의 답은 마크다운이 시각 목록만 같은 행 카드(`.hcb-card` + `.rc-rows`, 02-basic-markdown.js `timeRowsHtml`)로 그려요. 섞인 목록과 한 줄은 그대로고, 사용자 말풍선과 메신저는 바뀌지 않아요. 복사하면 원래 줄이 나와요.
- 데이터: 없음.
- 근거: web/js/11-resultcard.js:109(hcBriefParse), :126(hcBriefNode).
- css: web/css/16-result-card.css(`.hcb-*`), 01-tokens.css.

### 채팅 답 모양
- 목적: 봇이 끝낸 답을 글의 모양대로 행과 카드로 그려요. 글자는 그대로이고 모델을 더 부르지 않아요. 시안은 `site/prototype`의 `#answers`예요.
- 구성: `.ans-card` 안에 결과 카드와 같은 `.rc-rows`/`.rc-row`. 라벨 행(`.ans-keys`), 묶음 보고(`.ans-secs`, `.ans-li`), 단계(`.ans-steps`), 시각 행, 표(`.ans-tb`), 파일 행(`.ans-files`), 끝의 근거 줄(`.ans-ev`). 모양이 있는 답은 첫 문장만 진해요(`.ans-lead`).
- 기능: 읽기 전용. 카드의 글자는 끌어서 고르고 복사할 수 있어요. 고른 만큼 화면의 글자로 복사되고, 표는 칸이 탭, 줄이 줄바꿈이에요. 파일 행은 링크나 버튼이 아닌 행이라 이름도 고를 수 있고, 글자를 고른 채 뗀 클릭은 파일을 열지 않아요.
- 상태: 항목 둘 이상이고 하위 목록이 없을 때만 카드가 돼요. 맞는 모양이 없으면 평소 글이에요. 표는 머리 줄이 있고 다섯 칸 이하일 때만, 근거 줄은 답의 마지막 줄일 때만이에요. 진행 메모, 게이트웨이 글, 다른 컴퓨터의 글, 시작 알림은 그리지 않아요. 세션 보고, 결정을 묻는 보고, 알림 시트, 모니터링 카드도 같은 `answerNode`로 그려요. 제목이 따로 있는 시트와 카드는 첫 문장을 진하게 하지 않아요. 모델 글을 그리는 새 화면은 `mdNode`를 직접 부르면 `hub/answer-surfaces-web.test.ts`가 실패해요. 답은 끝난 뒤 한 번에 오기 때문에 글에서 카드로 바뀌는 일이 없어요.
- 숫자 요약과 전후 변경: 지침 줄만 있어요. 그리는 건 실제 답을 며칠 본 뒤에 정해요.
- 데이터: 없음.
- 근거: web/js/02-answer-shapes.js, web/js/02-basic-markdown.js(blocks, mdHtml), web/js/11-todo-strip.js(msgNode).
- css: web/css/16-answer-shapes.css.

### 감시/예약 알림 문구 (watchtext)
- 목적: 감시(watch)와 예약(schedule) 이벤트를 사람이 읽는 한국어로 바꾸고 기계 출력은 접힌 `원문`에 둬요(hub/watchtext.ts와 같은 규칙).
- 구성: 화면 없음. 문자열을 만들어 마크다운으로 넘겨요(`원문` 울타리는 접힌 `details.more.raw`로 렌더).
- 기능: `watchLine(label, reason, output, opts)`: `${라벨}: ${사유}` + 읽을 수 있는 요약 + 원문 울타리(최대 5줄, 줄당 160자, 600자 상한). `scheduleLine`: `예약한 일이 시작됐어요` + 첫 줄 + 원문. `describeOutput`: JSON/키=값/시각 포함 출력은 요약(예 `새 소식 N건 · 시각`), 변경 비교는 한 줄에 한 항목(`- ...`, 3개 뒤 `외 N건`)과 `사라졌어요` 아래 사라진 항목이고, 같은 항목(`owner/repo#n` 또는 `<종류>:` 뒤 글)이 종류만 바뀌었으면 사라진 것으로 치지 않아요(`새 이슈 → 이슈 갱신: ...`). 첫 줄 사유는 셀 수 있으면 `이슈 갱신 4건 · 사라진 항목 1건`처럼 센 제목이 돼요.
- 상태: 사유 문구 `결과가 바뀌었어요`, `조건에 맞는 결과가 나왔어요`, `점검에 실패했어요`, `다시 정상이에요`, `${n}번 연속 실패했어요`, `저장된 비밀번호가 없어 다시 로그인하지 못했어요. 맥 암호에 저장하고 다시 연결을 눌러 주세요`, `실패가 이어져 멈췄어요. 승인하면 다시 확인해요`, `2차 인증이 필요해요. 다시 연결을 누르면 휴대폰으로 승인 요청을 보내요`, `승인이 필요해요`. 실패 코드(`DOTZ_FAIL`) 문구 예: `로그인이 풀렸어요`, `승인이 필요해요`, `내용을 가져오지 못했어요`, `네트워크에 연결하지 못했어요`, `시간이 너무 오래 걸렸어요`, `보안 확인(캡차)이 필요해요`, `연동이 꺼져 있어요`, `앱이 꺼져 있어요`, `브라우저를 열지 못했어요`, `화면 구조가 바뀌어 읽지 못했어요`, `요청이 너무 잦아 잠시 막혔어요`. 라벨이 영문 슬러그면 공백으로 풀고 비면 `모니터링`. 읽을 수 없는 출력이면 요약 없이 원문만. 사라짐/추가 비교 값이 시각 같은 것만이면 `내용은 그대로이고 시각 같은 값만 바뀌었어요`.
- 데이터: 웹이 날것으로 받는 인박스 이벤트 `watch`, `schedule`(`convReal`이 대화 미리보기에도 써요). 확인 스크립트가 찍은 표식(`repo-gone`, `READY` 같은 토큰 한 줄)은 본문에 안 나오고, 일치 감시의 출력이 표식뿐이면 사유 문장만 보여요(`sentinelMatch`). 비서로 보내는 1회 감시의 변경·일치는 비서만 깨워요. 오너는 비서의 보고로 듣고, 실패했거나 비서가 멈췄을 때만 알림을 직접 받아요(`wakeOnly`, 깨우는 말은 `inboxWatchOnce`).
- 근거: web/js/11-watchtext.js:4(watchReasonKo), :18(humanLabel), :24(isMachineOutput), :30(clockKo), :38(watchSummary), :42(rawFence), :52(WT_FAIL), :77(describeOutput), :116(watchLine), :127(scheduleLine).
- css: 없음(문자열 모듈). 렌더된 `원문` 접힘은 web/css/16-result-card.css/04-files.css 쪽 마크다운 스타일.

### 첨부 트레이 (입력창의 파일 첨부)
- 목적: 입력창에 파일을 붙여 메시지와 함께 보내요(최대 10개).
- 구성: `#c-attach`(`+` 아이콘 버튼, aria `파일 첨부`, title `파일 첨부 · 끌어다 놓거나 붙여넣기도 돼요`), 숨은 `input#c-file`, `input#c-photo`, 트레이 `#atray`(이미지 썸네일 `.fatt.img`, 파일 칩 `.fatt`, 빼기 `.ax`, 이미지 번호 `.tag.img-no`), 끌어놓기 존 `#v-chat`(`#composer.dropping`).
- 기능: 클릭(데스크톱은 파일 선택기 바로), 터치 기기는 먼저 `사진`/`파일` 메뉴(`showMenu`, 폰은 시트). 파일 끌어놓기, 클립보드 붙여넣기(이미지는 이름이 `붙여넣은 이미지.png`). 올리는 즉시 업로드. 파일별 x로 빼기.
- 상태: 0.7초 안에 끝나는 업로드는 처음부터 `확장자 · 크기` 칩 그대로, 더 걸리면 원형 링(`.pring`)과 퍼센트, 메타 `12MB / 340MB`(이미지도 같은 칩). 실패는 칩에 이유와 다시 올리기, ×는 업로드 취소. 대화를 옮겨도 이어지고(`web/js/15-upload.js` `UPS`), 새로고침하면 끊겨요(올리는 동안만 `beforeunload`로 물어요). 허브 한도(`web.upload_max_mb`, 기본 50MB)를 넘으면 올리기 전에 토스트로 알려요. 완료 후 `확장자 · 크기`. 한 번에 10개 초과 시 토스트 `한 번에 10개까지 보낼 수 있어요`(10개로 자름). 업로드 실패 `${이름}: ...`(연결 끊김은 `연결이 끊겨 올리지 못했어요`, 서버 오류 또는 `올리지 못했어요 (HTTP n)`)로 해당 파일만 트레이에서 제거. 이미지가 둘 이상이면 각각 `이미지 1`, `이미지 2`(보낸 순서). 대화를 옮기면 첨부는 그 대화에 남아요(`ts(t).att`). 전송 직전 업로드 중이면 `파일을 올리는 중이에요`. 입력이 비활성(종료 세션)이면 끌어놓기 무시. 트레이에 첨부나 요소가 있으면 전송 버튼이 `has-att`.
- 데이터: `POST /api/upload`(multipart `file`, 응답 `files[0]`), 전송은 `POST /api/message`의 `files`.
- 근거: web/js/15-attachments.js:12-16(`#c-attach`), :17(addFiles), :38(dropAtt), :39(fileChip), :43(renderAtt), :59(paste), :66-75(드롭 존).
- css: web/css/03-base.css(`.atray`, `.fatt`), 21-picker.css(`.atray`), 04-files.css(`.fatt` :19), 07-chat.css(`#c-attach` :51 `pointer:coarse`), 10-conversations.css.

### 메시지 속 파일 칩, 뷰어, 라이트박스
- 목적: 메시지에 붙은 파일/`[file]` 줄/본문 속 경로를 칩, 썸네일, 미리보기로 열어요.
- 구성: `.mfiles > .fitem`(`.fbox`: 칩 `a/button .fatt` 또는 썸네일 `button.thumb`, 다운로드 `a.fdl`; 번호 `.tag.img-no`; 경로 `button.fpath`). 뷰어 `dialog.tbox`(`.tv-bar`: `.tv-n`, `다운로드`, 닫기 x; `.tv-body.md`). 라이트박스 `dialog.lbox`(`.lb-bar`: `새 탭`, `다운로드`, 닫기; `.lb-p`; `.lb-img`).
- 기능: 이미지는 라이트박스, 텍스트류(`md, markdown, txt, log, json, yml/yaml, csv, tsv`)는 뷰어(마크다운은 렌더, 그 밖은 `pre`), HTML(이 컴퓨터)은 캔버스(`canvasOpen`), 나머지는 새 탭. 칩마다 `다운로드`(title `${이름} 다운로드`). 경로 버튼은 짧은 경로(`~/…/폴더/파일`)를 보이고 탭하면 전체 경로를 복사(`경로를 복사했어요` 또는 `복사하지 못했어요`). 본문의 ``code.path`` 경로는 `미리보기`(title)로 열고 이미지는 최대 4개 인라인 미리보기. `[file]` 줄(`check`)은 HEAD로 먼저 확인해 크기를 채우거나 비활성 칩으로.
- 상태: 확인 실패 칩 문구 `원본이 지워졌어요`(404), `열 수 없는 파일이에요`, `확인하지 못했어요`(네트워크), 서버가 `x-file-note`를 주면 그 문구. 뷰어 `불러오는 중…`, 200KB 초과 시 `앞부분만 보여요. 전체는 다운로드해 주세요`, 열기 실패 `열 수 없어요`. 경로 열기 실패는 토스트(같은 문구). 폰(`max-width:639px`)에서 `dialog.tbox`가 전체 화면. 터치는 다운로드 버튼 36px. 다른 컴퓨터 대화 파일은 `/api/peer/file`을 프록시로 읽어요.
- 데이터: `GET /api/file?path=...[&download=1]`(HEAD 확인 포함), 다른 컴퓨터 `GET /api/peer/file?path=...`.
- 근거: web/js/15-attachments.js:84(fileItem), :106(shortPath), :124(pathCopy), :129(filesNode), :137(fileLines), :148(mdFiles), :153(viewer), :175(lightbox), :189(openPath), :194(pathFiles).
- css: web/css/04-files.css(`.fitem`, `.fbox`, `.fdl`, `.fpath`, `.tbox`, `.lbox`; :19, :299 `max-width:639px`), 20-mail-box.css, 07-chat.css.

### 요소 고르기 (앱/캔버스 프레임의 요소를 메시지에 첨부)
- 목적: 앱 화면이나 캔버스 안의 요소를 눌러 골라 그 요소 정보를 다음 메시지와 함께 보내요.
- 구성: `#pick-box.pk-box`(호버 윤곽+라벨 `.pk-lab`), `#pick-marks`(번호 마커 `.pk-mark`), 트레이 칩 `.fatt.pk-chip`(`.pk-n`, `.fi-n`, `.fi-m`, 빼기 `.ax`), 앱 머리의 힌트 `.pk-hint`. 대상 프레임은 `iframe.apps-frame`(앱 화면)과 캔버스 프레임이에요. 고르기 버튼은 없어요.
- 기능: 프레임 안에서 `⌘`(Mac) 또는 `Ctrl`을 누르면 요소 윤곽, `⌘+클릭`이 선택. 폰은 길게 누르기(500ms, 10px 넘게 움직이면 스크롤로 간주). 선택 이벤트는 캡처 단계에서 취소해 요소 자체 핸들러가 안 돌아요. 칩 x로 `pkDrop`. 전송 시 `elements`(번호, 태그, 선택자, 텍스트, html 600자, 보는 화면, 제목)로 가요.
- 상태: 힌트 문구 `길게 눌러 요소 고르기`(터치) / `⌘+클릭으로 요소 고르기`(Mac) / `Ctrl+클릭으로 요소 고르기`. 10개 초과 토스트 `요소는 한 번에 10개까지 보낼 수 있어요`. 칩 aria `${n}번 요소 빼기`. 비밀번호 input은 텍스트를 안 담아요. 보이지 않거나 크기 0 요소는 마커 숨김. 스크립트 캔버스(불투명 출처)는 `remote`로 별도 브리지(`canvasPick`)에서 오고 마커는 그 페이지가 그려요. 대화별로 고른 목록이 따로 보관돼요(`ts(t).pick`). 전송 실패 시 `pkRestore`. 교차 출처 프레임은 건너뛰어요. 폰(`max-width:639px`)에서 칩 `max-width:100%`.
- 데이터: `POST /api/message`의 `elements`.
- 근거: web/js/15-picker.js:27(pkText), :39(pkSel), :62(pkView), :76(pkHover), :132(pkChip), :140(renderPicks), :164(pkDo), :193(pkBind), :260(pkFrame), :271(pkHint), :279(MutationObserver).
- css: web/css/21-picker.css(`.pk-*`, `.atray`; :19 `pointer:coarse`, :20 `max-width:639px`).

### 코드 블록 (복사와 터미널 실행)
- 목적: 모든 코드 블록에 복사 버튼을, 셸 명령처럼 보이는 블록에는 `터미널에서 실행`을 붙여요.
- 구성: `div.cb > .cb-bar`(`data-lang` 언어, `button.cb-btn[data-cb=copy]`, 셸이면 `button.cb-btn.run[data-cb=run]`) + `pre > code`. 버튼 글자는 CSS `data-label`이라 복사 텍스트에 안 섞여요.
- 기능: 복사(`copyText`: 보안 컨텍스트면 `navigator.clipboard`, 아니면 숨은 textarea + `execCommand`). 실행은 `openShell({command})`로 터미널 시트에 명령을 넣어요(`$ ` 프롬프트와 끝 공백 제거, 주석은 유지). 셸 판정: 언어 태그가 셸류거나, 태그 없이 12줄 이하이고 첫 줄이 `$ `, 알려진 명령어, 경로.
- 상태: 버튼 라벨 `복사`, `터미널에서 실행`(aria `코드 복사`/`터미널에서 실행`), 클릭 후 1.6초간 `복사했어요` 또는 `복사하지 못했어요`. 빈 블록은 버튼 없이 `pre`만.
- 데이터: 없음.
- 근거: web/js/35-code-blocks.js:13(isShellBlock), :25(codeBlockHtml), :35(copyText), :50(cbFlash), :57(cbClick), :66.
- css: web/css/13-code-shell.css(`.cb-bar`, `.cb-btn`).

### 마크다운 렌더와 메시지 상태 태그
- 목적: 채팅/알림 글을 안전하게 마크다운으로 그리고(입력은 먼저 이스케이프) 메시지의 상태 표시를 태그로 바꿔요.
- 구성: `mdNode(src, cls)` = `div.md`. 지원: 굵게, 기울임, 취소선, 인라인 코드(경로 모양이면 `code.path`), http(s) 링크(새 탭 `rel=noopener noreferrer`), 제목(굵은 문단), 목록(들여쓰기 하위), 인용, 표(`.tbl`, 두 번째 줄 `---` 구분선이면 머리), 메타 줄(`근거:`, `출처:`, `Evidence:`, `Source:`, `For <봇>:`, `<봇> 몫:`, `-# ` 줄은 작고 흐리게 `p.meta`), 선택지 인용 해제, ` ```목록 `(`.mlist` 행: 이니셜, 제목/부제/시각/개수 배지), ` ```원문 `(접힌 `details.more.raw`), ` ```dotz-settings `(설정 카드), 그 밖의 코드 블록(위 항목).
- 기능: 첫 줄 상태 표시 `[done]/[완료]`, `[run]/[진행]`, `[ask]/[결정]`, `[fail]/[실패]/[warn]/[경고]`를 `parseTone`이 떼어 태그로 보여 줘요(`완료`=ok, `진행 중`=pri, `확인 필요`=warn, `실패`=err). 기계용 마커(`[lane ...]`, `[dotz ...]`, `[system]`, `[attachment]`, `[10-23]` 등)는 줄 시작에서만 제거(코드 울타리 안은 그대로, `[file]` 줄은 `keepFiles`일 때만 남김).
- 상태: 울타리 여는 줄은 줄 시작에서만 인식. 닫는 울타리가 없으면 끝까지 코드.
- 데이터: 없음. 같은 파일의 `api()`는 모든 호출의 공통 래퍼예요(아래 공통 항목).
- 근거: web/js/02-basic-markdown.js:3(inline), hub/message-spec-derive.ts(blocks, unquoteChoices), web/js/02-answer-shapes.js(specHtml, specRowsHtml), 02-basic-markdown.js(mdHtml, mdNode), :85-101(TONE_TAGS, toneTag, toneLead), :105(stripMarkers), :120(parseTone).
- css: web/css/13-code-shell.css(`.mlist-*`), 04-files.css/16-result-card.css(`.tbl`), 01-tokens.css, 03-base.css(`.md`, `.st-tag`).

### 공통 요청 래퍼와 처리 중 버튼 (api, busy)
- 목적: 모든 화면의 서버 호출을 한 곳에서 처리하고 버튼을 호출 동안 잠가요.
- 구성: 화면 없음.
- 기능: `api(path, method, body)`: 다른 컴퓨터 항목이면 `pqRoute`로 `/api/peer/proxy`를 거쳐요. 같은 GET이 진행 중이면 하나로 합치고, 부팅 때 `index.html`이 미리 시작한 응답을 한 번 이어받아요. `busy(btn, fn)`은 호출 동안 버튼 비활성, 오류는 토스트.
- 상태: 오류 문구는 서버 `error` 필드, 없으면 `HTTP ${status}`, 다른 컴퓨터 프록시 503이면 사유 또는 `이 컴퓨터에서는 읽기만 돼요`.
- 데이터: 모든 `/api/*`.
- 근거: web/js/02-basic-markdown.js:130(api), :152(busy).
- css: 없음.

### 토스트 (하단 스낵바)
- 목적: 짧은 결과/오류를 하단에 띄우고 필요하면 되돌리기 같은 동작 버튼을 줘요.
- 구성: `div.snack[role=status]`(`.bad` 오류, `.act` 동작 있음): 텍스트 `span` + `button.sa`.
- 기능: 새 토스트가 이전 것을 바로 대체. 열린 `dialog`가 있으면 그 안에 붙여요. 문구는 `noticeKo`로 한국어화. 동작 버튼은 누르면 토스트를 지우고 `action.onclick`.
- 상태: 기본 3.5초, 오류 또는 동작 있음 6초, `ms` 지정 가능. 사라질 때 150ms 페이드. 폰(`max-width:639px`)은 탭바 위로 올림.
- 데이터: 없음.
- 근거: web/js/02-basic-markdown.js:160-178(toast, toastGone).
- css: web/css/03-base.css(`.snack`; :197 `max-width:639px`).

### 떠다니는 알림 카드 (우상단 `.ntf`)
- 목적: 새 알림/세션 보고/작업 기록을 우상단 카드로 잠깐 띄워요.
- 구성: `.ntf-box[aria-live=polite]` 안 `.ntf`(점 `.dot`, 이름 `.nm`, 시각 `.tm`, 본문 첫 줄 `.bd2` 240자, 닫기 `button.x` `×`).
- 기능: 카드 탭은 `noticeOpen`으로 해당 항목 열기. x는 닫기. 최대 3개(넘치면 가장 오래된 것 닫음). 닫힌 카드는 `localStorage dotz-ntf-done`(최대 300)에 저장해 재접속/새로고침에 다시 안 떠요.
- 상태: 제목은 `e.title`, 없으면 세션 제목 또는 `세션`, 알림 대화(`alert`)는 `알림`, 그 밖은 `${봇} 작업 기록`. 4초 뒤 자동으로 닫히는데, 탭이 안 보이거나 창 포커스가 없으면 멈추고(복귀하면 남은 시간만큼) 카드에 호버해도 멈춰요. 알림 카드는 `role=alert`. `needs` 종류는 그 대화가 더 이상 오너를 필요로 하지 않으면 바로 사라져요. 폰(`max-width:639px`)은 `top: 8px + safe-area`.
- 데이터: 라이브 이벤트(`notify(e)`).
- 근거: web/js/02-basic-markdown.js:180-239(notify).
- css: web/css/03-base.css(`.ntf-box`, `.ntf`; :219).

### 대화창 (dialog, ask 확인 상자)
- 목적: 네이티브 `<dialog>` 기반 모달 하나(큰 시트형, 작은 클래식형, 확인 상자형).
- 구성: `dialog.dlg`(`.fs-card`, `.cl` 클래식, `.cf` 확인; `wide` 옵션): 머리(`h2.dtitle` + 닫기), `.dbody`, 바닥 `.dact`(버튼). `ask(title, text, ok, danger)`는 취소/확인 두 버튼 확인 상자. `mid` 옵션을 주면 `.fs-card.mid`(폰은 아래에서 올라오는 시트, PC는 그대로 가운데 상자)로 열려요. 칸이 둘 이하이거나 글만 있는 창에 써요.
- 기능: Esc, x, 상자 밖 누르기, 뒤로가기가 모두 닫기(`dialogHist`). 메뉴가 열려 있으면 Esc는 메뉴만 닫음. `ask`는 `true/false`로 resolve(기본 확인 라벨 `확인`, `취소`).
- 상태: 확인 상자(`confirm`)는 PC에서 직전 클릭 위치 옆 작은 상자(2초 안의 클릭이 없으면 가운데), 폰(`max-width:639px`)은 아래 낮은 시트. 위험한 확인은 `danger fill` 버튼.
- 데이터: 없음.
- 근거: web/js/02-basic-markdown.js:242(CF_PT), :243(cfPlace), :250(dialog), :278(ask).
- css: web/css/03-base.css(`dialog.dlg.cf`, `dialog.dlg.cl`, `.dtitle`), 15-settings-phone.css(`dialog.dlg.cl`), 14-overlay.css(`.fs-card`).

### 전체화면 오버레이 (시트 프레임 fsOpen)
- 목적: 앱 위에 뜨는 모든 팝업(결정 카드 시트, 알림 시트, 컴퓨터 시트, 로그인 요청)의 공통 틀이에요.
- 구성: `div.fs-bd`(배경) 안 `section.fs-card[role=dialog][aria-modal=true]`. 머리 `fsHead`: `.fs-hd > .fs-tt`(제목 노드들) + `.fs-hb`(`무시`(`.fs-ign`, 호출자가 줄 때) + 닫기 `.ib.fs-x` aria `닫기`). 본문 `.fs-body`, 바닥 `.fs-ft`.
- 기능: 뒤로가기 스택에 올라가요(`ovOpen`). 맨 위 오버레이가 Esc와 Tab을 받고(포커스 트랩), 배경 `pointerdown`이 닫기. 닫으면 열었던 요소로 포커스 복귀. 소유자가 직접 닫으면 페이드아웃 시트 애니메이션, 프로그램이 닫으면 즉시 제거.
- 상태: 키보드가 올라오면(보이는 높이 차 120px 초과) 배경 높이를 보이는 영역에 맞추고 `.kb` 클래스. 모션 감소 설정이면 애니메이션 없음. 열린 `<dialog>`가 있으면 Esc/Tab을 가로채지 않아요. 폰(`max-width:639px`)은 아래서 올라오는 시트, `>=640px`은 중앙 대화창(바닥 패딩 조정).
- 데이터: 없음.
- 근거: web/js/38-overlay.js:6(fsOpen), :53(fsHead).
- css: web/css/14-overlay.css(`.fs-*`; :27, :69, :81 `max-width:639px`, :62 `min-width:640px`).

### 팝오버 메뉴 (showMenu)
- 목적: 모든 드롭다운/선택 메뉴 하나의 컴포넌트예요.
- 구성: `div.menu[role=listbox]`(폰 시트형은 `.msheet`), 항목 `button.mi`(체크 `.ck`, 점 `.dot`, 라벨 `.ml` + 보조 `small`(라벨과 같은 줄이면 오른쪽 끝, 줄이 모자라 아래로 내려가면 라벨과 같은 왼쪽에서 시작), 플래그 `.sb.warn`, 배지 `.nb`), 머리 `.mh`, 접힘 행 `.mi.more`. 폰 시트형은 누른 단추 위로 열리고, 단추가 화면 위쪽(앱바)에 있어 위에 자리가 없으면 그 단추 아래로 열려요.
- 기능: 같은 앵커를 다시 누르면 닫기. ↑↓/Home/End 이동, Esc, Tab 닫기, 글자 입력으로 라벨 접두 이동(700ms), 바깥 포인터다운/앵커를 움직이는 스크롤/리사이즈로 닫기. 열릴 때 선택된 항목에 포커스+스크롤. `fold` 항목은 누르면 그 자리에서 펼쳐져요. 선택은 메뉴를 닫은 뒤 `onPick(value)`. 보조 컨트롤 `selectField`(라벨+선택 버튼), `textField`, `input`.
- 상태: 선택된 항목은 체크(`sel-on`, `aria-selected`), 들여쓰기 `ind`. 터치(`pointer:coarse`)는 항목 높이 40px.
- 데이터: 없음.
- 근거: web/js/03-menu.js:3(closeMenu), :14(showMenu), :97(selectField), :103(textField), :107(input).
- css: web/css/03-base.css(`.menu`, `.mi`; :119 `pointer:coarse`), 14-overlay.css(`.msheet`), 01-tokens.css.

### 메일 대화의 본문과 요약 (채팅 안 메일 보기)
- 목적: 메일 대화(`mail:` 대상)에서 메일 요약 줄과 원문(HTML 또는 정리된 텍스트)을 보여 줘요.
- 구성: 열린 메일 카드의 요약 `div.msum[data-k=mail-summary]`(번개 아이콘 + `요약 · ` + 굵은 할 일), 그 아래 첨부 `.mr-files`(본문 위, 요약이 없으면 받는 사람 줄 바로 아래), 본문 `.mb-txt`(정리된 텍스트: 머리 줄, 키-값, 목록, 표, 인용 접기) 또는 `.mb`(HTML: `.mb-bar` + 샌드박스 `iframe.mb-frame`).
- 할 일·직접 답할 것: 메일 기록의 `todo`, `questions` 필드를 요약 아래 자기 칸에 따로 보여 줘요. 답장 초안 카드도 같은 칸을 초안 위에 두어서, 초안이 보낸이·요약·이 줄들을 덮지 않아요. 열린 메일이 이 칸을 그린 화면에서는 초안 카드가 이 칸만 빼고, 초안 카드만 보이는 화면(답장 대기, 빠른 처리, 초안 시트, 메신저)에서는 한 번 보여 줘요.
- 기능: HTML 메일은 `sandbox="allow-popups allow-popups-to-escape-sandbox"`, `referrerpolicy=no-referrer`의 iframe에 줄인 HTML을 넣고 폭에 맞춰 높이를 재서 맞춰요(넓은 표는 축소). 바깥 이미지는 기본 차단, `이미지 보기`/`이미지 숨기기` 토글. 열면 `mailOpenSummary`가 결과 카드의 요약 섹션을 요약 블록으로 갈아 끼워요(요약이 본문과 같으면 본문만 보임, `mailSumIsBody`).
- 상태: 바깥 이미지 차단 `바깥 이미지 ${n}개를 막았어요`, 켠 뒤 `바깥 이미지를 보고 있어요` 또는 `바깥 이미지 ${n}개는 이 기기에서 열리지 않아요`. 본문 불러오기 실패 `원문을 불러오지 못했어요`(`.mb-fail`). iframe title `메일 원문`. 폰(`max-width:520px`)에서 메일 표 셀 패딩 축소. 메일 대화는 맨 위에서 열리고 화면에 보이면 읽음이에요(위 읽음 위치 항목). 다른 컴퓨터 메일은 `pqLink`로 그 컴퓨터의 본문을 읽어요.
- 데이터: `GET /api/mail/:key/body`(HTML 본문), 요약은 메일 기록(`MAILS`, `GET /api/conversations`)의 `summary`(허브가 게시 뒤에 요약하면 이벤트 `text`에는 없어요), 텍스트는 메일 이벤트의 `text`.
- 근거: web/js/11-mailtext.js:227(mailTextNode), :239(mailSumSplit), :258(mailSumBlock), :267(mailOpenSummary); web/js/11-mailbody.js:115(mailHtmlNode), :172(mailSumIsBody), :174(mailBodyNode).
- css: web/css/20-mail-thread.css(`.msum`, `.mb-txt`, `.mb`), 16-result-card.css(`.mb-txt` :55, :72 `max-width:520px`).

### 핵심 헬퍼 (아이콘, 포맷, rowToggle)
- 목적: 모든 화면이 쓰는 DOM 빌더, 아이콘 세트, 시간/수 포맷, 두 값 토글을 줘요.
- 구성: 화면 없음. `el(tag, props, ...kids)`(텍스트는 텍스트 노드, `safeHtml`은 이스케이프된 마크업에만), `clear`, `icon(name, cls)`(24px 선 아이콘 `ICONS`), `rowToggle`(두 값 설정을 `button.chip.tgl` 하나로: 누르면 다음 값, `aria-pressed`는 둘째 값일 때 true, aria-label `${라벨}: ${현재} · 누르면 ${다음}`, 값이 없으면 `정하기`), `liEnd`.
- 기능: 시간은 KST(`kstTime`, `kstStamp`), `rel(ms)`는 `초기화됨`/`곧 초기화`/`${n}분 후 초기화` 등, `thinkLine`은 영어 생각을 `생각을 정리하는 중`으로 대체, `lsJson`은 localStorage JSON 읽기.
- 상태: 없음.
- 데이터: 없음.
- 근거: web/js/01-core.js:5(el), :25(rowToggle), :28-78(ICONS), :79(icon), :83-97(포맷 함수).
- css: web/css/03-base.css(`.chip.tgl`), 01-tokens.css.

### 프로젝트 목록 (`#v-projects`, 뷰 `projects`)
- 목적: 프로젝트를 확인 필요, 진행 중, 최근 순으로 훑고 눌러서 개요로 가요.
- 구성: `#pl-shell` 안에 `.pl-top`(검색 `#pl-q` `.pl-search`, 필터 칩 `#pl-chips` `.pl-chips`)과 `#pl-list` `.pl-groups`. 목록은 `.sec.pl-sec` 머리글(`고정`, `프로젝트`) 아래 `.pl-list` 카드 안의 `.pl-row`(폴더 아이콘 `.ico`, 이름 `.pl-n`, 한 줄 `.pl-sw`, 안 읽음 `.pl-nb`, 상태 태그). 맨 아래에 `더 보기` 줄 `.cv-more`, `세션` 섹션의 행 1개(`세션과 채널`), `내 설정` 섹션의 행 1개(내장 커스텀 프로젝트).
- 기능: 검색 입력은 `pjSearch`의 oninput이 `PJ.q`를 바꾸고 `pjPaintRows`로 다시 그려요. 칩 4개 `전체 / 진행 중 / 확인 필요 / 끝남`(`PJ_VIEWS`)은 `pjChips`가 만들고 누르면 `PJ.view`를 바꾸고 12개씩 보이도록(`PJ_PAGE`) 되돌려요. 행을 누르면 `go("project", key)`. `프로젝트 N개 더 보기`는 `PJ.more`를 12 늘려요. `세션과 채널` 행은 `go("chat","list")`, `내 설정` 행은 `go("project", builtin.key)`. 빈 목록의 `채팅 열기`는 `openTarget(MAIN, lastChatView())`.
- 상태:
  - 불러오는 중: `불러오는 중…`. 실패(첫 로드): `프로젝트를 불러오지 못했어요`.
  - 프로젝트 0개: `아직 프로젝트가 없어요. 채팅에서 오래 걸리는 작업을 맡기면 여기에 생겨요` + 버튼 `채팅 열기`.
  - 필터 결과 없음: 검색 중 `찾는 프로젝트가 없어요`, 확인 필요 `확인할 프로젝트가 없어요`, 진행 중 `지금 진행 중인 프로젝트가 없어요`, 끝남 `끝낸 프로젝트가 없어요`, 전체 `아직 프로젝트가 없어요`.
  - 행 상태 태그(`prjState`): `일시 정지`, `답을 기다려요`, 세션 상태 단어(`runStatus`가 주는 단어), `끝남`, `쉬는 중`, `세션 없음`. 정렬은 확인 필요, 진행 중, 최근 활동 순이고 `pinned`는 `고정` 그룹으로 먼저 나와요.
  - 안 읽음 배지 aria `읽지 않은 메시지 N개`, 99 넘으면 `99+`. 현재 보는 프로젝트 행은 `.on`.
  - `세션` 섹션은 칩이 `전체`이고 검색어가 없을 때만, `내 설정` 행은 `전체`이면서 검색어가 없거나 `커스텀`에 포함될 때만 나와요. 줄은 `일하는 세션 N개 · 작업 채널 N개`와 `내가 바꾼 것을 봐요`.
  - 폰 vs 데스크톱: 폭 1100px 이상(`ppWide`=`!narrowChat`, `04-state.js:13-15`)에서는 `go("projects")`가 곧바로 `project`로 바뀌고 목록은 왼쪽 304px 칸에 남아요. 1099px 이하(폰)에서는 목록이 한 화면이에요.
  - 20초마다 `prjLoad`로 새로고침(`19-project-main.js:490`).
- 데이터: `GET /api/custom`(`prjLoad`), 상태 `S.lanes`, 채널별 안 읽음 `ts(chat).unread`. SSE는 이 화면 코드에서 확인 못 함.
- 근거: `web/js/18-lanes.js:307`(renderProjects), `:269`(pjPaintRows), `:230`(prjRow), `:185`(prjState), `:218`(projRows), `:141`(prjLoad); 진입 `web/js/05-command-palette.js:126,161`.
- css: `web/css/20-projects.css`(`.pl-*`, 칩 가로 스크롤). 미디어쿼리 `20-projects.css:105`(min-width 1100px: `.views.pp` 304px 칸, `.pl-chips` 끝 페이드).

### 프로젝트 개요 (`#v-project`, 뷰 `project`, 2단계)
- 목적: 프로젝트 하나의 이름, 설명, 진행, 확인 필요, 단계, 세션, 작업, 결과, 감시를 한 화면에 요약해요.
- 구성: 위에서 아래로 `pmHead`(`.pmv-head`: 이름 `.pmv-title`, 상태 태그, 마지막 활동 `.pmv-upd`, 설명 `.pmv-purpose`, 버튼줄 `프로젝트 채팅` + ⋯ `.pmv-more`, 진행 막대 `.pmv-hprog`)와 `.pm-o`. `.pm-o` 안은 `pmPrimary`(`.pm-need` 카드, 있을 때만), 이어서 `.pm-block` 5개: `단계 n/m`, `세션 n`, `작업 n`, `결과 n`, `감시 n`. 각 블록은 머리글 `.sec.pm-sec`(오른쪽 버튼) + `.pm-sec-list` 행들.
- 기능:
  - 이름과 설명 인라인 편집: `pmEditable`(눌러서 입력칸, `저장`/`취소`, Enter 저장, Esc 취소, 여러 줄은 Cmd/Ctrl+Enter). 이름은 필수. `PUT /api/projects {key: recordKey||key, title|purpose}`.
  - 단계 줄 `pmStepRow`: 눌러서 완료 토글(role=checkbox, 낙관적 표시 후 `PUT milestones`, 실패하면 되돌리고 토스트).
  - 블록 머리글 버튼 `편집`(단계), `전체`(세션, 결과, 감시)는 `pmSheet(kind)`로 3단계 페이지를 열어요(작업 블록은 버튼 없음).
  - `대화에서 답하기`는 `openTarget("lane:<name>")`. 세션 줄 `pmLaneRow`은 그 세션 대화로, 작업 줄 `pmWorkRow`는 `workGo`, 결과 줄은 보고이고 세션이 있을 때만 눌러서 `laneResultGo`. 감시 줄 `pmWatchRow`는 모니터링 목록에 있는 감시면 그 감시 대화(`monRowGo`), 앱이 소유한 감시와 루틴은 `pmSheet("routines")`.
  - `프로젝트 채팅`은 채널이 있고 `validTarget(chat)`일 때만 보여요(없으면 버튼 자체를 뺌).
  - ⋯ 메뉴와 삭제는 아래 별도 항목.
- 상태:
  - 프로젝트를 못 찾음: 로드 중 `불러오는 중…`, 실패(`PM.fail` 또는 `PRJ_FAIL`) `프로젝트를 불러오지 못했어요`.
  - 앱바 제목: 폰은 프로젝트 이름, 넓은 화면은 `프로젝트`(`pmPaint`).
  - 빈 구역은 제목째 접어요(`pmSection`이 null). 상세를 아직 못 읽었으면 이미 아는 것(확인 필요 카드, 세션) 아래에 `불러오는 중…`, 못 읽었으면 `나머지를 불러오지 못했어요` + `다시 시도`. 작업 줄은 홈 `workRow`처럼 왼쪽 점, 제목, 조용한 줄(모델 또는 이유), 오른쪽 시각이고, 멈춤·실패만 단어를 둬요. 세션 줄 조용한 줄은 기다리는 질문이나 마지막 한 줄이에요. 넓은 화면은 처음에 고정한 프로젝트(없으면 목록 맨 위)를 열어요(`prjFirst`). 목록이 오기 전에 열었으면 커스텀으로 열었다가 목록이 오면 옮기고, 그 기록 칸은 직접 고르지 않은 화면(`a`)으로 남아요.
  - 확인 필요 카드: 제목 `확인 필요`, 태그 `답 기다림`, 질문 또는 세션 제목, 둘 이상이면 `외 N개도 답을 기다려요`, 버튼 `대화에서 답하기`. 답 기다리는 세션이 없으면 카드 없음.
  - 머리 진행 막대 텍스트 `N/M 단계 끝났어요`(aria `마일스톤 진행 N/M`), 마일스톤이 없으면 막대 없음. 설명 비었을 때 자리표시자 `무엇을 하는 프로젝트인지 적어 주세요`, 이름/설명 버튼 title `눌러서 고쳐요`, 다른 필드 기본 자리표시자 `비어 있어요`.
  - 편집 실패: 필드 아래 `저장하지 못했어요 · <메시지>`(이름 비움은 `비워 둘 수 없어요`). 단계 토글 실패는 토스트로 같은 문구.
  - 작업 줄 단어 `진행 중`/`멈춤`/`완료`/`중단됨`/`이어서`/`실패`, 부제 `작업 중 · <경과>`, `멈춤 · <사유 또는 활동이 없어요>`, `끝남`, `중단됨`, `이어서 처리 중`, `실패 · 이어서 처리함`.
  - 감시 줄 부제는 `매 N분`/`매 N시간` · `일시 정지` 또는 상태 사유 또는 `마지막 <시각>`, 오른쪽 태그 `모니터링`/`루틴`/`예약`. 건강 점 `ok`/`err`(`pmHealth`).
  - 필드를 편집 중(`PM.open>0`)이면 다시 그리지 않아요. 데이터 시그니처가 같으면 그대로 둬요. 20초마다 `pmLoad`+`prjLoad`(편집 중 제외).
  - 내장 `builtin:custom`이면 이 화면 대신 `cmPaint`(아래 `내 설정` 항목).
- 데이터: `GET /api/custom/project?key=`(`pmLoad`), `GET /api/custom`(`prjLoad`), `PUT /api/projects`. 쓰기 뒤에는 둘 다 다시 읽어서 서버가 보관한 값으로 그려요(`pmReload`). SSE는 코드에서 확인 못 함.
- 근거: `web/js/19-project-main.js:53`(pmPaint), `:107`(pmOverview), `:122`(pmSection), `:184`(pmHead), `:152`(pmEditable), `:75`(pmPrimary), `:85`(pmStepRow), `:99`(pmWatchRow), `:398`(pmLaneRow), `:406`(pmWorkRow), `:6`(pmOpen), `:19`(pmReload); 진입 `05-command-palette.js:163`.
- css: `web/css/08-project-sessions.css`(`.pmv-*`), `web/css/20-projects.css`(`.pm-*`, 목록 열). 미디어쿼리 `08-project-sessions.css:4`(max 639: 머리 패딩), `:14`(max 479: 진행 막대 순서), `:37`(min 640), `:59`(coarse 또는 max 639: 단계 추가 입력 높이), `20-projects.css:110`(min 1100: `.pm-o` 최대 760px).

### 프로젝트 ⋯ 메뉴 (`pmMenuButton`)
- 목적: 프로젝트 수정/삭제 진입. 프로젝트 페이지 머리와 프로젝트 채팅 머리(주석에 `31-conversations.js`로 적혀 있음)가 같이 써요.
- 구성: 아이콘 버튼 `.ib.pmv-more`(aria/title `프로젝트 메뉴`, `aria-haspopup="listbox"`) → `showMenu` 항목 2개.
- 기능: `프로젝트 수정`: 지금 그 프로젝트 페이지면 이름 편집을 시작(`.pmv-title` 클릭), 아니면 `go("project", p.key)`. `프로젝트 삭제`: `pmDeleteAsk(p)`.
- 상태: 프로젝트를 못 찾으면 토스트 `이 프로젝트를 찾을 수 없어요`.
- 데이터: 없음(삭제는 아래).
- 근거: `web/js/19-project-main.js:210`.
- css: `08-project-sessions.css`(`.pmv-more`).

### 프로젝트 삭제 시트 (`pmDeleteAsk`)
- 목적: 프로젝트를 지우기 전에 무엇이 같이 지워지는지 보여 주고 확인받아요.
- 구성: `fsOpen` 시트. 머리 제목 `<이름> 프로젝트를 삭제할까요?`, 본문(`.pmd`): 실행 중 경고 노트, 목록 `.as-rml`(줄: `#<이름> 채널을 Discord에서 지워요`, 모니터링 N개는 따로 남겨요, 로그인 유지 N개도 남겨요, `자동 처리 설정을 지워요: …`, `알림 N개를 치워요`, `대화 N개는 보관 파일로 남겨요`), 설정과 같은 스위치 줄 `보관 파일도 같이 지워요`(줄 전체가 탭 영역, 꺼짐이 기본), 오류 줄. 푸터는 같은 폭 두 단추 `취소`, `삭제`(danger).
- 기능: `삭제`는 `pmDeleteCall(q,"delete",{archive: !스위치})`. 성공하면 시트를 닫고 토스트 `<이름> 프로젝트를 지웠어요`(Discord 실패면 `프로젝트는 지웠지만 Discord 채널은 남아 있어요 · <오류>`), 프로젝트 채팅에서 지웠으면 `pickTarget(MAIN)`, 아니면 `go("projects")`.
- 상태: 계획을 못 읽으면 토스트 `<메시지>` 또는 `지울 내용을 읽지 못했어요`. 실행 중인 세션이 있으면 `실행 중인 세션이 있어서 지울 수 없어요: <목록>` 노트 + `삭제` 버튼 disabled. 삭제 실패는 오류 줄에 `<메시지>` 또는 `지우지 못했어요`. 다른 컴퓨터 프로젝트(`q.pc`)는 상대 게이트웨이로 보내요.
- 데이터: `GET /api/projects/<ch:id>/delete-plan`, `DELETE /api/projects/<ch:id>`, 다른 컴퓨터는 `POST <pqProxy>/api/peer/act {action:"project", args:{op,key,...}}`.
- 근거: `web/js/19-project-main.js:234`(pmDeleteAsk), `:222`(pmDeleteCall), `:227`(pmDeleteLines).
- css: `web/css/14-overlay.css`(`.fs-*`), `.as-rml`은 `web/css/18-app-settings.css:27`.

### 프로젝트 3단계 페이지: 목표와 진행 (`pmSheet("goal")`)
- 목적: 목표 글과 마일스톤을 고쳐요.
- 구성: `fsOpen({cls:"pdv"})` 페이지. 머리 `.pdv-hd`(뒤로 `.pdv-back` aria `뒤로`/title `프로젝트로`, 제목 `목표와 진행`, 보조 `목표와 단계를 고쳐요`), 본문 `.pdv-body` 안 카드 `.pmv-goal`: 목표(편집), `N/M` + 막대, 마일스톤 줄 `.pmv-ms`, 입력줄 `.pmv-add`, 노트.
- 기능: 목표/마일스톤 문구 인라인 편집, 체크(aria `<문구> 완료 표시`), 삭제(aria/title `<문구> 삭제`/`삭제`), `마일스톤 추가` 입력(Enter 또는 `추가`, 최대 200자, 비면 `추가` disabled). 모두 `PUT /api/projects {milestones|goal}` 뒤 재조회. 한 줄 쓰는 중 초안은 `PM.draft`로 보존.
- 상태: 목표 자리표시자 `아직 목표가 없어요 · 눌러서 적어 주세요`. 단계 없고 목표만 있으면 `단계를 더하면 진행률이 보여요`. 쓰기 실패는 노트 `저장하지 못했어요 · <메시지>`. 프로젝트 데이터가 없으면 `불러오는 중…`. 포커스가 입력칸에 있으면 자동 새로고침이 그 페이지를 안 덮어써요(`pmSheetsPaint`). 오버레이라 뒤로가기 한 번에 닫혀요(주석: `32-history-nav`).
- 데이터: `PUT /api/projects`. 읽기는 개요와 같은 `PM.D`.
- 근거: `web/js/19-project-main.js:132`(pmSheet), `:131`(PM_PAGE), `:265`(pmGoalBody).
- css: `web/css/20-projects.css`(`.pdv-*`, `.fs-card.pdv`), `08-project-sessions.css`(`.pmv-goal/.pmv-ms/.pmv-add`). 미디어쿼리 `20-projects.css:98`(min 640: 폭 760px, 높이 86dvh), `:99`(max 639: 좌우 패딩).

### 프로젝트 3단계 페이지: 세션 기록 (`pmSheet("sessions")`)
- 목적: 지금 도는 세션과 끝난 세션, 백그라운드 작업을 봐요.
- 구성: 제목 `세션 기록`, 보조 `이 프로젝트의 세션과 백그라운드 작업`. `.pdv-stack` 안에 `진행 중`(`pmDoing`) 와 `최근 세션`(`pmRecent`).
- 기능: 행(`sessionRow`)을 누르면 그 세션 대화로. 최근 세션 행은 `laneResultGo`로 결과 위치로. 작업 행은 `workGo`.
- 상태: 진행 중이 없으면 `진행 중인 작업이 없어요`, 최근이 없으면 `아직 끝난 세션이 없어요`(최근은 최대 10개, 시각 내림차순).
- 데이터: `PM.D.lanes`, `PM.D.work`, `S.lanes`(`GET /api/custom/project`).
- 근거: `web/js/19-project-main.js:295`(pmSessions), `:416`(pmDoing), `:420`(pmRecent), `:42`(pmSessionRows); 행 `18-lanes.js:168`(sessionRow).
- css: `20-projects.css`(`.pdv-*`), `.srows`/`.hr`는 홈 공용 행.

### 프로젝트 3단계 페이지: 결과 전체 (`pmSheet("results")`)
- 목적: 보고, 확인, 커밋을 날짜별로 봐요.
- 구성: 제목 `결과 전체`, 보조 `보고, 확인, 커밋`. 날짜 머리 `.pmv-day`(`오늘`/`어제`/날짜) 아래 `.list` 행(`pmResultRow`: 제목 `.pmv-clamp`, 부제 `보고|확인|커밋 · 해시 · 세션 · 시각`, 오른쪽 태그).
- 기능: 보고이면서 세션이 있는 행만 눌러서 `laneResultGo(lane, at)`.
- 상태: 태그 보고 `안 됨`(err) / `확인됨`(ok) / `보고만 함`, 확인 `통과`/`안 됨`, 커밋 `커밋`. 빈 목록 `아직 결과가 없어요`. 데이터 없음 `불러오지 못했어요`(실패) 또는 `불러오는 중…`.
- 데이터: `PM.D.results`.
- 근거: `web/js/19-project-main.js:437`(pmResults), `:429`(pmResultRow), `:425`(PM_RES).
- css: `08-project-sessions.css`(`.pmv-day`, `.pmv-clamp`).

### 프로젝트 3단계 페이지: 루틴과 모니터링 (`pmSheet("routines")`)
- 목적: 프로젝트에 묶인 모니터링, 루틴, 예약을 보고 고치고 멈춰요.
- 구성: 제목 `루틴과 모니터링`, 보조 `주기적으로 도는 일`. 항목 카드 `.pmv-rt`: 상단 줄(건강 점 + 이름 + 태그), 메타 줄 `.pmv-rt-meta`, 패턴 줄, 버튼줄 `.pmv-rt-acts`, 노트.
- 기능: `일시정지`/`다시 시작`(`PATCH /api/watches/<id>` 또는 `/api/schedules/<id>` `{paused}`); `수정`(간격 분, 매치형 모니터링은 패턴; `{every_minutes|pattern}`); `스크립트`(`GET`/`PUT /api/watches/<id>/script`, textarea에서 저장/취소); 루틴은 `지금 실행`(`POST /api/custom/routine {id}`).
- 상태: 태그 `스크립트`(title `게이트웨이가 직접 실행 · 토큰 없음`) 또는 `모델`(title `실행할 때마다 모델을 호출해요`), `일시 정지`, 실패 `계속 실패 N번`/`마지막 실행 실패`/`실패 N번`. 메타: 종류, `매 N분`/`매 N시간` 또는 `한 번`, 스크립트 파일명, `마지막 <시각>` 또는(모니터링) `아직 안 돌았어요`, `다음 <시각>`, `패턴 · <값>`. 점 aria `정상`/`상태 없음`. 간격 오류 `간격은 1분 이상의 정수로 적어 주세요`, 스크립트 읽기 실패 `스크립트를 읽지 못했어요 · <메시지>`, 저장 실패 `저장하지 못했어요 · <메시지>`. 빈 목록 `아직 루틴이나 모니터링이 없어요`, 데이터 없음 `불러오지 못했어요`/`불러오는 중…`. 편집 중은 `PM.open`으로 새로고침 막음.
- 데이터: `PM.D.monitors|routines|schedules`(또는 `linked.*`), 위의 PATCH/PUT/POST.
- 근거: `web/js/19-project-main.js:318`(pmRoutines), `:325`(pmRoutine), `:305`(pmHealth), `:313`(pmRoutineItems), `:302`(PM_KIND).
- css: `08-project-sessions.css`(`.pmv-rt*`, `.pmv-fld`, `.pmv-code`).

### 내 설정 (내장 프로젝트 `builtin:custom`, `cmPaint`)
- 목적: 오너가 바꾼 설정(규칙, 기능 등)을 읽기 전용으로 모아 보고, 변경은 채팅으로 부탁해요.
- 구성: 앱바 제목 `프로젝트`. 머리(`.pmv-head`: 이름, 태그 `내 설정`, 설명 `p.note`), 그 아래 2열 `.pmv-cols`(그룹 앞 3개 / 나머지). 그룹 `.pmv-sec`: 머리글 + `추가` 버튼, 행 `.li`(제목 `.pmv-clamp`, 한 줄, 태그 `확인 필요`, `수정`).
- 기능: `추가`는 `cmAsk("[프로젝트 커스텀 · 개인 설정] <그룹>: ")`, `수정`은 `cmAsk('… <그룹> "<제목>": ')`: 메인 채팅을 열고 입력창에 초안만 채워요(보내지 않음). 규칙 행은 눌러서 전체 글 펼침(`aria-expanded`, Enter/Space).
- 상태: 로드 전 `불러오는 중…`, 실패 `불러오지 못했어요`. 그룹이 비면 서버가 준 `g.empty` 문구(리터럴은 코드에서 확인 못 함). 일부만 보이면 `그 밖에 N개가 더 있어요`. 편집/프로젝트 채팅 없음.
- 데이터: `GET /api/custom/project?key=builtin:custom`(`D.groups`).
- 근거: `web/js/19-project-main.js:470`(cmPaint), `:452`(cmAsk), `:457`(cmText), `:451`(CM_TAG).
- css: `08-project-sessions.css`(`.pmv-cols/.pmv-col/.pmv-sec`).

### 구성 화면 (`#v-harness`, 뷰 `harness`, 설정 하위)
- 목적: 메시지가 흐르는 길(입력, 게이트웨이, 어시스턴트, 세션, 서브에이전트)과 각 단계의 상태, 설정, 기능을 보고, 수정은 어시스턴트에게 요청으로 보내요.
- 구성: `#harness` 안에 `hMapBox`(툴바 `.hm-bar` + 본문), `hProjBox`(`.pj` 프로젝트 띠), `hFcBox`(`.fc` 기능 목록)가 위에서 아래로. 오른쪽에 `#hsheet` 상세 시트(아래 별도 항목). 본문 모드는 4가지: 기본 `hSimple`(단계 카드), `자세히`+데스크톱 `hCanvas`(그래프), `자세히`+폰 `hFlowList`(세로 흐름), 커스텀 보기 `hCustomView`.
- 기능(툴바): `보기 범위` 분할 버튼 `전체`/`커스텀 N`(config `ui.origin_view`가 켜졌을 때만), `기능 보기`(카드에 강제/권고 수 붙임; 프로젝트 지도에서는 숨김), `자세히`(모든 시스템과 연결선), `새로고침`(새로고침 아이콘 단추, 이름 `새로고침`, `busy`; `자세히` 바로 뒤에 있어요). 선택은 `localStorage` `dotz-honly`/`dotz-hfeat`/`dotz-hdetail`에 저장.
- 상태: 로드 전 `불러오는 중…`, 첫 로드 실패 `구성을 불러오지 못했어요`(조용한 갱신은 숨김). 안내문: 기본 `큰 카드가 메시지가 흐르는 길이에요. 카드 안의 작은 칩은 함께 실행되는 시스템·파일이고, 칩에 마우스를 올리거나 눌러서(폰: 눌러서) 이어진 곳과 설정을 봐요. 고칠 때는 <봇>에게 요청이 가요.`, 자세히 `카드를 누르면 설명과 설정이 열려요. 점선 카드는 곁에서 돕는 시스템이에요.`. 상태 단어(`H_STATE`) `정상`/`작업 중`/`주의`/`멈춤`/`꺼짐`. origin_view가 켜지면 범례 `내 설정` + `내가 바꾼 값·파일·기능이에요. 표시가 없는 것은 기본값이에요 (<경로>).`. 폰(`H_MQ` 최대 639px)에서는 연결선 오버레이를 안 그리고 카드 모양이 달라져요.
- 갱신: 열려 있는 동안 15초마다 `loadHarness(true)`, `lanes` SSE 이벤트의 라이브 상태가 바뀌면 `loadHarness(true)`(`99-boot.js:58`), 자세히 모드에서 폭이 40px 넘게 바뀌면 150ms 뒤 다시 그림.
- 데이터: `GET /api/harness`, `GET /api/features`(`fcSplit`), 모델 목록(`loadModels`). 쓰기는 `POST /api/message`(수정 요청).
- 근거: `web/js/27-harness.js:172`(renderHarness), `:57`(loadHarness), `:165`(hUse), `:49-53`(H_MQ, H_COLS, H_TONE, H_STATE, H_APPLY); 진입 `05-command-palette.js:142,158`; 상위 `04-state.js:35`(SUB에 포함), `32-history-nav.js:21`(홈 > 설정 > 구성).
- css: `web/css/06-harness.css`(`.hm-*`, `.hs-*`, `.fc-*`), `05-log.css`(`.hm-*`, `.pj-*`도 일부). 미디어쿼리 `06-harness.css:56`(max 1199: 단계 카드 2열), `:61`(max 699: 1열, 툴바 줄바꿈), `:145`(min 640: `#harness.hs-open`일 때 시트 너비만큼 오른쪽 패딩).

### 구성 지도: 기본 보기 (`hSimple`, 단계 카드)
- 목적: 흐름의 주 줄기를 카드 한 장씩(단계) 보여 줘요.
- 구성: `.hm-simple` 격자 안에 단계별 `.hm-st`: 앞 연결부(`hFrom`: 첫 카드 `여기서 시작해요`, 이후 `<이전 단계>에서` + 연결 라벨), 머리 `.hm-sh`(번호 `.hm-no`, 상태 점, 단계 이름, 개수 칩 `.hm-ct`, 상태 태그, `주의 N`, 요약 한 줄, 강제/권고 배지, `내 설정` 배지), 목록 `.hm-list`(입력 단계처럼 주 노드가 여럿이면 행 `.hm-row`, 그리고 `함께 실행되는 항목 · N` 아래 칩 `.hm-chip`). 단계 이름은 `H_COLS`: `들어오는 곳`/`게이트웨이`/`어시스턴트`/`세션`/`서브에이전트`. 단계 사이 연결 라벨이 여럿이면 `들어온 글`로 합쳐요(`H_MANY`).
- 기능: 카드, 행, 칩을 누르면 `openHSheet(id)`. 마우스 올림/포커스는 `hHot`/`hOverlay`로 이어진 곳을 테두리로 밝히고 선을 그림(폰 제외). 칩의 상태 `warn`/`err`는 강조, `off`는 흐리게.
- 상태: 단계 상태가 정상이 아니면 태그(`H_STATE`), 칩 중 주의/멈춤이 있으면 `주의 N`(title에 이름들). 그 외는 위 구성 화면 항목과 같음.
- 데이터: `HG.nodes`, `HG.edges`(`/api/harness`), 강제/권고 수는 `FC.features`.
- 근거: `web/js/28-harness-project.js:195`(hSimple), `:166`(hStageCard), `:132`(hStages), `:156`(hFrom), `:147`(hChip), `:279`(hOverlay), `:128`(H_MANY); `27-harness.js:68`(hColumns).
- css: `06-harness.css`(`.hm-simple`, `.hm-st`, `.hm-chip`), `05-log.css`.

### 구성 지도: 자세히 (`hCanvas`, `hFlowList`)
- 목적: 모든 시스템과 연결선을 한 화면에 그려요.
- 구성: 데스크톱은 `.hm-scroll > .hm-canvas`에 SVG 연결선(`.hm-edge`, 라벨 `.hm-lb`)과 열 머리 `.hm-ch`, 카드 `.hm-n`(점선은 곁에서 돕는 시스템 `.sup`, 파일은 `.fl`). 폰은 `.hm-flow`: 열마다 `.sec` 제목 + `.hm-stack` 카드, 열 사이 화살표 줄 `.hm-down`(연결 라벨 최대 3개).
- 기능: 카드 클릭은 `openHSheet`, 호버/포커스는 `hHot`로 연결선 강조. 폰 카드는 `→ <대상>: <라벨>` 줄도 보여요.
- 상태: `기능 보기`가 켜져 있으면 카드가 더 커져요(`hLayout`의 `HF`/`HA`). 열 너비 150~200px, 간격 56px.
- 데이터: `HG.nodes`/`HG.edges`.
- 근거: `web/js/28-harness-project.js:78`(hCanvas), `:108`(hFlowList); `27-harness.js:79`(hLayout), `:109`(hRoutes), `:139`(hCard), `:156`(hHot).
- css: `06-harness.css`.

### 구성 지도: 커스텀 보기 (`hCustomView`)
- 목적: 오너가 바꾼 것만 단계별로 걸러 보여 줘요(`ui.origin_view` 켜짐 + `커스텀 N` 선택 시).
- 구성: 같은 단계 카드 `.hm-simple.only`. 바뀐 게 없으면 `기본 그대로`. 있으면 섹션: `내 파일·확장 · N`, `바꾼 설정 · N`(`<라벨>: <값>` + `기본 <기본값> · <노드>`), `내 기능 · N`(이름, 형식 태그, `꺼짐`, 출처 경로).
- 기능: 행 클릭은 `openHSheet`/`fcOpenFeature`. 내 기능이 4개를 넘으면 `N개 더 보기`/`접기`(카드 안 스크롤 유지).
- 상태: 파일 메타 `N자 · <시각> 수정` 또는 `아직 없는 파일`, `글 N줄`, `차단 N줄`.
- 데이터: `HG.nodes[].custom`, `FC.features`(`origin`).
- 근거: `web/js/28-harness-project.js:271`(hCustomView), `:227`(hCustomCard), `:215`(hCustomParts), `:226`(hCustomCount), `:214`(H_CV_CAP).
- css: `06-harness.css`(`.hm-cr`, `.hm-cs`, `.hm-none`).

### 구성 프로젝트 띠 (`.pj`, 프로젝트별 비교)
- 목적: 작업 채널과 홈 채널에 묶인 세션을 프로젝트별로 나란히 비교해요.
- 구성: 기본 지도 아래(`hProjBox`), 프로젝트 지도에서는 숨김. 머리 `프로젝트 · N`, 설명, 범례(`바뀜` `전역과 다른 값` / `전역 기본` `전역 그대로`), 카드 가로줄 `.pj-row`. 카드 `.pj-card`: 이름 + 상태 태그(`p.status_text`) + `전역과 다름 N` 또는 `전부 전역 기본`, 채널 칩 `#<이름>` + 종류, 경로 복사(`pathCopy`), 값 비교 7줄(모델, 강도, 서브에이전트 모델, 서브에이전트 강도, 런타임, 폴백, 서브에이전트 폴백), `지침 파일`, `채널 설정`, `이 프로젝트에만 적용`.
- 기능: 카드 클릭/Enter/Space는 `hOpenProject(id)`(주소 `#harness/project/<id>`). 값이 전역과 다르면 `바뀜` 배지 + 취소선 전역값 → 프로젝트값.
- 상태: 프로젝트 0개이면 `작업 채널이나 홈 채널에 묶인 세션이 아직 없어요. 세션을 채널에 묶으면 여기서 프로젝트별로 비교해 볼 수 있어요.`, 있으면 `작업 채널·홈 채널에 묶인 세션이에요. 나란히 놓고 비교해 보고, 카드를 누르면 그 프로젝트만의 지도가 열려요.`. 빈 값 `없음`, 채널 설정 없음 `설정 없음`, 폴백 체인은 `A → B` 형태(`pjChain`).
- 데이터: `HGB.projects`(`/api/harness`의 `projects`).
- 근거: `web/js/28-harness-project.js:37`(hProjBand), `:18`(hProjCard), `:10`(pjField), `:5`(pjChain), `:6`(PJ_ROWS), `:53`(hOpenProject).
- css: `web/css/05-log.css`(`.pj-*`), `20-projects.css`(1건).

### 구성 프로젝트 지도 (`#harness/project/<id>`)
- 목적: 한 프로젝트만의 흐름 지도와 설정 값(전역과 비교).
- 구성: 툴바 맨 위 `hProjHead`(`전체 구성` 뒤로 버튼, 상태 점 + 프로젝트 이름 + 채널 칩 + 범위 태그 `프로젝트`). 안내문 `이 프로젝트만의 지도예요. 카드를 누르면 값과 설명이 열리고, 고칠 때는 프로젝트 범위를 붙여 <봇>에게 요청이 가요. 전역 값과 다른 설정에는 '바꿈' 표시가 붙어요.` 본문은 일반 지도와 같은 렌더(`HG`가 프로젝트 지도로 바뀜), 기능 목록과 프로젝트 띠는 숨김.
- 기능: `전체 구성`은 `hOpenProject("")`. 카드를 누르면 시트에 `이 카드에 대한 요청`(`hProjAsk`: 자리표시자 `이 프로젝트에 바라는 변경을 적어 주세요`, 버튼 `<봇>에게 수정 요청`, 성공 `요청 보냄 · <시각>` + 버튼 글자 `요청했어요`, 실패는 노트와 토스트). 시트 설정 줄에 `바꿈 · 전역 <값>`.
- 상태: 저장 안 한 변경이 있으면 이동 전 확인 `저장하지 않은 변경` / `열려 있는 항목에 저장하지 않은 변경이 있어요. 버리고 넘어갈까요?` / 버튼 `버리기`. 그 프로젝트가 목록에서 사라지면 `hProjId`를 비우고 `#harness`로 바꿔요(`routeReplace`).
- 데이터: `HGB.projects[].map.nodes|edges`, `POST /api/message`(`[구성 탭 수정 요청] 범위: 프로젝트 (<채널> · <경로>)\n<내용>`).
- 근거: `web/js/28-harness-project.js:45`(hProjHead), `:63`(hProjAsk), `:2`(hPj); `27-harness.js:165`(hUse); 주소 `05-command-palette.js:142-143`.
- css: `05-log.css`(`.pj-bk`, `.pj-title`), `06-harness.css`.

### 구성 상세 시트 (`#hsheet`)
- 목적: 카드 하나의 설명, 지금 상태, 작동하는 기능, 설정, 파일, 이어진 곳을 보여 주고 수정 요청을 보내요.
- 구성: `<aside class="sheet" id="hsheet" role="dialog" aria-label="구성 상세">`: 머리 `.sh-head`(`#hs-name`, `#hs-sub`, 상태 태그 `#hs-tag`, 닫기 `#hs-close` aria `닫기`), 본문 `#hs-body`: 설명 `.hs-desc`(머리 부제와 같은 말로 시작하면 그 부분은 빼고, 남는 말이 없으면 그리지 않아요), (origin_view면) 출처 줄 `.hs-or`, `지금 상태`(`.hs-facts`), `여기서 작동하는 기능 · 강제 N · 권고 M`, 안내 노트 `이 화면에서는 직접 고치지 않아요. 수정 요청을 보내면 <봇> 쪽에서 적용해요.`(편집 가능 설정이나 파일이 있을 때), `설정`, `파일 · <이름>`, `이어진 곳`(`← 이전`/`다음 →` 칩), 프로젝트 지도에서는 `이 카드에 대한 요청`.
- 기능: 닫기 ✕, Esc(메뉴나 `dialog[open]`이 없을 때), 오버레이 닫기(`ovOpen`). 다른 카드로 넘어갈 때 저장 안 한 변경이 있으면 위의 `저장하지 않은 변경` 확인. 열릴 때 고른 카드가 가려지지 않도록 지도가 스크롤(`hReveal`). `이어진 곳` 칩은 그 카드 시트로 이동. 기능 행에 줄 번호가 있으면 파일 편집기가 그 줄로 이동(`hGoto`).
- 상태: 출처 줄(origin_view): 개인이면 `내 파일이에요`/`내 확장이에요 (<경로>)`, 배포면 `기본으로 함께 오는 거예요`(+ ` (저장소 파일 · 읽기 전용)`, ` · 설정값 N개는 내가 바꿨어요 (<config>)` 등). 폰 vs 데스크톱: 넓은 화면(640px 이상)에서는 `#harness.hs-open`이 시트 폭만큼 오른쪽 패딩을 줘서 지도와 나란히 보이고, 그보다 좁으면 시트가 덮어요(`06-harness.css:145`; 시트 자체의 폰 레이아웃 규칙은 `05-log.css`, 세부는 코드에서 확인 못 함).
- 데이터: `HG.nodes[]`(`desc`, `facts`, `settings`, `file`, `fileEditable`), `FC.features`, 파일 `GET /api/harness/file/<경로>`.
- 근거: `web/js/28-harness-project.js:340`(openHSheet), `:326`(closeHSheet), `:333`(hHead), `:384`(hOriginLine), `:317`(hReveal); `29-harness-features.js:200-207`(닫기/Esc/리사이즈/15초 갱신 리스너); `index.html:176-184`(#hsheet 마크업).
- css: `web/css/06-harness.css`(`.hs-*`), `05-log.css`(`.sheet`, `.sh-head`).

### 구성 설정 항목 (`hSetting`, 시트 안)
- 목적: 설정 값 하나를 형식에 맞는 입력으로 보여 주고 어시스턴트에게 바꿔 달라고 요청해요(화면에서 직접 쓰지 않음).
- 구성: `.hs-set`: 제목 줄(`.lb` 라벨, `바꿈 · 기본 X`/`바꿈 · 전역 X` 태그, 적용 시점 태그), 입력(`.ctl`), 버튼줄(`기본값`, 범위 태그, `<봇>에게 수정 요청`), 노트. 입력 형식: 스위치(`켜짐`/`꺼짐`), 선택 메뉴(select, effort, model), 숫자(+ 단위), 여러 줄, 한 줄 글.
- 기능: 값을 바꾸면 `<봇>에게 수정 요청`이 켜져요. 누르면 `hRequest`가 `POST /api/message`로 `[구성 탭 수정 요청] <범위>\n<라벨> (<출처>): <이전> -> <새 값>. 적용 시점: <…>.`를 보내요. `기본값`은 기본값으로 되돌림(모델/effort 제외).
- 상태: 적용 시점 태그 `바로 적용`, `다음 메시지부터`, `재시작 후 적용`(warn), 대기 중이면 `재시작 대기 중`. 읽기 전용: 태그 `읽기 전용` + 값 + 힌트 또는 `보안·연결 정보라 화면에서 바꿀 수 없어요.`. 오케스트레이터/세션/서브에이전트의 모델과 강도는 입력 대신 값 + 버튼 `모델 · 폴백에서 바꾸기`(`openModels`; 프로젝트 지도에서는 일반 입력). 성공 `요청 보냄 · <시각>`(버튼 `요청했어요`), 실패 노트 + 토스트.
- 데이터: `POST /api/message`.
- 근거: `web/js/28-harness-project.js:397`(hSetting), `:379`(hRequest), `:393`(H_MODEL_TARGET); `27-harness.js:53`(H_APPLY), `:19`(hScope).
- css: `06-harness.css`(`.hs-set`, `.hs-sw`, `.hs-ro`).

### 구성 파일 편집기 (`hFileEditor`, 시트 안)
- 목적: 프롬프트 파일(RULES, LESSONS, IDENTITY 등)을 초안으로 고치고 어시스턴트에게 반영을 요청해요(파일은 여기서 안 써요).
- 구성: `.hs-fw`: textarea(`.hs-mono`, 18줄), (편집 가능 파일이면) 메모 입력 `수정 요청 메모`, 버튼줄(`되돌리기`, 범위 태그, `<봇>에게 수정 요청`), 정보 줄, 변경 줄.
- 기능: 입력하면 250ms 뒤 `변경 +N줄 -M줄`. `<봇>에게 수정 요청`은 diff(`lineDiff`, 앞뒤 3줄 맥락; 6000자 초과면 바뀐 줄 범위만)와 메모를 `POST /api/message`로 보냄. 본문을 안 바꾸고 메모만 보내도 돼요.
- 상태: 읽기 전용 파일은 textarea만. 자리표시자 `무엇을 왜 바꾸는지 (선택) · 글은 두고 메모만 보내도 돼요`. 정보 줄 `N자 (시작 지침에는 앞 N자까지) · <시각> 수정 · <노트>` 또는 `아직 없는 파일`. 큰 변경은 `많이 바뀌어서 diff 대신 바뀐 줄 범위만 보내요. 메모에 무엇을 바꾸는지 적어 주세요`. 성공 `요청 보냄 · <시각>`, 읽기/전송 실패는 `.note.err`에 메시지.
- 데이터: `GET /api/harness/file/<경로>`(`text`, `cap`, `modified`, `note`, `name`, `label`), `POST /api/message`.
- 근거: `web/js/28-harness-project.js:532`(hFileEditor), `:520`(hFileRequest), `:471`(lineDiff), `:519`(H_DIFF_CAP).
- css: `06-harness.css`(`.hs-fw`, `.hs-ta`, `.hs-mono`).

### 구성 기능 목록 (`.fc`, `renderFeatures`)
- 목적: 오너가 더한 기능을 구현 형식별(글 지시, 차단 명령, 기능 폴더, 스킬, 확장 등)로 모아 강제/권고로 구분해요.
- 구성: `기능 목록` 제목, 설명, 필터줄 `.fc-bar`(검색, `형식`/`트리거`/`출처` 메뉴 버튼, 분할 버튼 `전체`/`강제`/`권고`), 개수 줄 `.fc-count`, 형식별 그룹(`.fc-gh` 접기 머리 + `.fc-grid` 카드 `.fc-card`). 마지막에 `이 하네스에선 꺼짐` 그룹.
- 기능: 검색 입력(placeholder `기능 검색 (이름·내용·파일)`), 필터 메뉴(`showMenu`), 그룹 머리 눌러 접기/펼치기(필터 중에는 접기 무시; 기본 접힘 `스킬`, `__off`), 카드 클릭/Enter/Space는 `fcOpenFeature`(해당 노드 시트, 줄 번호가 있으면 파일 편집기 그 줄). 스위치는 아래 항목.
- 상태: 개수 `N개 · 강제 e · 권고 a`(필터 중 `N / M개 · …`). 결과 없음 `조건에 맞는 기능이 없어요`. 카드 태그 `강제`/`권고`(안 불러오는 확장은 `안 불러옴`), 트리거, `배포용`/`개인용`(origin_view), 노드 이름, `꺼짐`, `중복`(+ `같은 일을 코드(강제)로도 적어 뒀어요: …` 또는 `글(권고)`). 꺼진 카드는 흐리게. 요약이 있으면 사용자 언어 요약, 원문은 title. 데이터가 같으면(`fcSig`) 다시 안 그려서 15초 갱신 중에도 입력이 안 끊겨요. 그룹 설명은 `FC_NOTE` 문구(형식별), 확장은 하네스 이름이 들어가요.
- 데이터: `GET /api/features`(`features`, `forms`, `triggers`, `harness`, `off`).
- 근거: `web/js/29-harness-features.js:170`(renderFeatures), `:146`(fcBuild), `:118`(fcPaintList), `:93`(fcCard), `:112`(fcMatch), `:79`(fcOpenFeature), `:184`(fcSheetSection), `:2`(FC_NOTE); `27-harness.js:8`(fcFilter).
- css: `web/css/06-harness.css`(`.fc-*`, `.hs-ft`).

### 기능 스위치 (`fcSwitch`, 카드와 시트 안)
- 목적: 기능 켜기/끄기를 어시스턴트에게 요청해요(실제 상태는 목록이 바뀐 뒤에야 따라가요).
- 구성: `.fc-sw` 안에 범위 태그, 요청 보냄 태그(`.tag.pri`), 스위치 `.hs-sw`(role=switch, aria `<이름> 끄기|켜기 요청`, title `<봇>에게 끄기|켜기 요청`).
- 기능: 누르면 `POST /api/message`로 `<이름> 끄기|켜기 (<출처>)`(+ 범위). origin_view에서 배포용 기능 폴더면 메뉴 `개인 설정으로 덮어쓰기 (기본)`/`배포 파일 변경 요청`(부제 `features/<id>/feature.md · 모든 사용자에게 바뀌어요`) 중 고름.
- 상태: 보낸 뒤 `요청 보냄 · <시각>`을 보이고 카탈로그가 요청과 같은 상태가 되면 지워요. 스위치는 `f.toggleable`이거나(origin_view에서) 기능 폴더일 때만 있어요.
- 데이터: `POST /api/message`.
- 근거: `web/js/29-harness-features.js:47`(fcSwitch), `:39`(fcCanToggle), `:40`(fcScopeOf).
- css: `06-harness.css`(`.fc-sw`, `.hs-sw`).

### 앱 화면 (`#v-apps`, 뷰 `apps`, `APPS_ON` 플래그)
- 목적: 오너의 앱(매니페스트)과 기본 모니터링 앱을 한곳에서 열어요.
- 구성: `#v-apps` 안에 왼쪽 목록 `#apps-side`(`.cv-side`)와 오른쪽 `#apps-pane`(`.apps-pane`). 목록은 `convRow`로 그린 줄들(`.cv-av.app-av` 아바타 + 상태 점 `.app-dot`), 상세는 머리 `.apps-hd` + 본문.
- 기능: 줄을 누르면 `go("apps", id)`(사용자 앱), `go("monitoring","i:<id>")`(모니터링 앱), 오류 줄은 대화상자, 빈 줄은 `go("chat")`. 폰에서는 목록이 한 화면(`cv-listing`), 앱을 고르면 상세, 머리 뒤로 버튼(aria/title `앱 목록`)으로 돌아옴. 데스크톱은 첫 도구 앱이 기본 선택.
- 상태:
  - **플래그**: `APPS_ON = false`가 기본이라 탭이 안 보이고 `go()`가 `navOff`에서 `home`으로 보내요(`04-state.js:25-26`, `05-command-palette.js:125`). 코드에서 `APPS_ON`을 true로 바꾸는 곳은 찾지 못했어요(`grep APPS_ON js/*.js index.html`: 선언과 `navOff`뿐).
  - 목록 머리 `사용자 앱`, `모니터링 앱`, `불러오지 못한 앱`. 로딩 `앱 불러오는 중…`, 실패 `앱을 불러오지 못했어요`(머리글 줄로 표시). 사용자 앱이 없으면 줄 `아직 내 앱이 없어요` + 힌트 `채팅에서 앱을 추가해 달라고 하면 돼요`.
  - 상태 단어(`APP_STATUS`) `실행 중`/`응답 없음`/`상태 모름`/`꺼짐`. 상태는 오른쪽 배지 한 번만(점 + 단어, `appsBadge`; 아바타 모서리 점은 없어요, 아이콘이 비면 `file` 아이콘). 줄 힌트는 정상·꺼짐이면 비고, 끊기면 `a.hint`, 응답 없음이면 사유(`a.reason`), 모니터링형 `상태만 확인하는 앱이에요`.
  - 상세 본문: 정상 도구 앱은 `<iframe class="apps-frame" src=a.web.href>`(상태가 같으면 프레임 유지). 꺼진 앱 `꺼 둔 앱이에요. 켜면 화면이 다시 열려요.` + `켜기`. 응답 없음 `<이름>이(가) 응답하지 않아요 (<사유>).` + (시작 명령이 있으면) `앱이 떠 있는지 확인해 주세요.` + `다시 확인`. 화면 없는 앱 `이 앱은 모니터링에서 소식을 모아 보여 줘요.`/`이 앱은 자체 화면이 없어요.`(+ 모니터링 앱은 `모니터링에서 열기`). 선택 없음 머리 `앱`/`내 앱을 한곳에서 열어요`, 본문 `왼쪽에서 앱을 골라 주세요.`.
  - 머리 버튼: `새 탭에서 열기`(도구 앱이고 꺼지지 않았을 때), `앱 메뉴`(⋯: `설정`, 내 앱만 `끄기`/`켜기`, `제거`). 상단 상태 줄 `<상태> · <사유>`. 폰에서는 선택 힌트(`pkHint`)가 이름 아래 줄.
  - 30초마다 `loadApps`(화면이 열려 있고 숨김 아닐 때), 표시 중인 탭만 그림.
- 데이터: `GET /api/apps`(`items`, `errors`), `PATCH /api/apps/<id> {off}`, `DELETE /api/apps/<id>`, iframe `/apps/<id>/`. 모니터링 쪽 연결은 `window.appsMonItems`(`30-apps.js:164`). SSE는 코드에서 확인 못 함.
- 근거: `web/js/30-apps.js:139`(appsRender), `:35`(appsRows), `:73`(appsHeader), `:119`(appsBody), `:60`(appsPicked), `:66`(appsOpen), `:15`(loadApps), `:8`(APP_STATUS); `index.html:146-149`; 진입 `05-command-palette.js:139`.
- css: `web/css/20-apps.css`(`.apps-*`, `.app-av`), `10-conversations.css`(`.cv-*`). 미디어쿼리 `20-apps.css:38`(min 1100: 목록 + 상세 2열 격자).

### 앱 설정 대화상자와 제거 확인 (`appsSettings`, `appsRemove`)
- 목적: 앱의 주소, 상태, 실행 명령, 감시, 설정 값을 읽기 전용으로 보여 주고, 제거를 확인받아요.
- 구성: `dialog` 제목 `<이름> 설정`: 표(`주소`, `상태`), `앱 실행` 블록(`이 앱은 스스로 실행되지 않아요. 아래 명령으로 띄워 주세요.` + `cd <폴더>`와 `KEY=VAL <명령>`), `감시`, `설정`(키/값), 노트 `이 값들은 채팅에서 바꿔 달라고 하면 돼요.`, 버튼 `닫기`.
- 기능: `끄기`/`켜기`는 `PATCH /api/apps/<id>`, 성공 토스트 `<이름>을(를) 켰어요`/`껐어요`. `제거`는 확인(`<이름> 제거`, `목록에서 빼요. 파일은 남아서 되돌릴 수 있어요.`, 버튼 `제거`) 뒤 `DELETE`, 토스트 `<이름>을(를) 제거했어요`, 목록으로 돌아가요.
- 상태: 실패는 토스트(`e.message`). 모니터링 앱의 주소 칸은 `모니터링에서 확인해요`.
- 데이터: `PATCH`/`DELETE /api/apps/<id>`.
- 근거: `web/js/30-apps.js:86`(appsSettings), `:95`(appsMenu), `:100`(appsToggle), `:107`(appsRemove).
- css: `20-apps.css`(`.apps-kv`, `.apps-pre`, `.apps-block`).

### 캔버스 (`#canvas`, 채팅 화면 옆 패널)
- 목적: 봇이 만든 HTML 페이지를 파일 칩에서 바로 열어 보고, 요소를 골라 메시지에 첨부해요.
- 구성: `#v-chat` 안 `<section id="canvas" class="cvs-pane apps-pane" aria-label="캔버스">`: 머리 `.apps-hd`(폰: 뒤로 버튼 aria/title `캔버스 닫기`/`닫기`, 파일 아이콘, 이름 `CVS.name`, 보조 `화면 파일`(title=경로), 선택 힌트 `pkHint`, `새 탭에서 열기` 링크, 넓은 화면은 ✕ `캔버스 닫기`) + `<iframe class="apps-frame cvs-frame">`.
- 기능: 채팅의 `.html/.htm` 파일 칩(다른 컴퓨터 파일 제외)을 누르면 `canvasOpen(path,name)`(채팅이 아니면 `go("chat")`부터; 같은 경로면 그대로). 스크립트 없는 페이지는 정리해서(`canvasDoc`: script/iframe/on* 제거, CSP, 링크는 새 탭) `srcdoc`로, `<script`가 있으면 `sandbox="allow-scripts"`로 `/api/canvas?path=…&pick=1`을 불러요. 스크립트 페이지의 요소 선택은 postMessage(`dotz-pick`)로 와서 `canvasPick`이 선택 목록에 넣고(`PICK`), 같은 방식으로 번호 배지를 동기화해요(`pkRemoteSync`).
- 상태: 열기 실패 `열 수 없는 파일이에요`(`fileNote`) 또는 연결 끊김 `연결이 끊겨 열지 못했어요`(카드 `.apps-card`로 교체). 선택이 10개면 토스트 `요소는 한 번에 10개까지 보낼 수 있어요`. 폰(1099px 이하): 전체 화면 고정(`z-index:60`), 넓은 화면(1100px 이상): 대화 목록 + 대화 + 캔버스 3열. 폭이 바뀌면 머리만 갈아 끼워요(프레임 유지). 닫으면 패널이 숨겨지고 선택은 대화에 남아요.
- 데이터: `GET /api/canvas?path=`(`canvasUrl`), postMessage `dotz-pick`.
- 근거: `web/js/30-canvas.js:47`(canvasOpen), `:31`(canvasHeader), `:41`(canvasHead), `:20`(canvasDoc), `:70`(canvasClose), `:78`(canvasPick), `:88`(pkRemoteSync); 진입 `15-attachments.js:88`.
- css: `web/css/20-canvas.css`(`#canvas`, `.cvs-*`), `20-apps.css`(`.apps-hd`, `.apps-frame`). 미디어쿼리 `20-canvas.css:5`(max 1099: 고정 전체 화면), `:8`(min 1100: 3열).

### 카드 추가·수정 (`#v-cardform`, 뷰 `cardform`, `web/custom.js`)
- 목적: 홈에 올릴 커스텀 카드를 만들고 고치면서, 만들어질 카드를 바로 옆에서 미리 봐요.
- 구성: `#v-cardform.view.cu-page`(`04-state.js:39`가 만들어 둠). 안에 `.cu-fp` 두 칸: 미리보기 `aside.cu-pv`(`홈에서 이렇게 보여요` 문구 + 실제 카드 그림, 컨트롤은 `inert`)과 폼 `form.cu-form`: `제목`, `보기` 썸네일 4개(`글`/`숫자`/`목록`/`항목별 값`), `내용`(분할 `직접 입력`/`명령 실행`), 명령 모드 추가칸(`폴더`, `갱신 주기`, `제한 시간`), `더 보기` details(`설명`, `링크`, `동작`, 새 카드는 `아이디`, 수정 시 `파일 · <경로>`), 오류 줄, `취소`/`저장`.
- 기능: 입력할 때마다 한 프레임에 한 번 미리보기를 다시 그림(`schedule`). `보기`를 바꾸면 내용 자리표시자와 힌트가 바뀌고 미리보기가 모션 전환. `동작 추가`(최대 4개, 앞 2개가 카드 버튼): 줄마다 `버튼 이름`, 분할 `명령`/`요청`, 내용, 체크 `누르기 전에 확인`, `빼기`. `저장`은 새 카드 `POST /api/custom/cards`, 수정 `PUT /api/custom/cards/<id>`. `취소`는 `go("home")`.
- 상태:
  - 제목: 새 카드 `카드 추가`, 수정 `카드 수정`. 수정 진입은 `GET /api/custom/cards/<id>`, 실패하면 토스트 + 홈으로.
  - 자리표시자: 제목 `예: 디스크 남은 공간`, 설명 `제목 아래 한 줄`, 아이디 `비우면 제목으로 만들어요`, 폴더 `~/Code/… (선택)`, 링크 `https://… 또는 #화면`, 명령 `예: df -h ~ | tail -1   (출력이 JSON이면 그대로 읽어요)`, 보기별 내용 예(`카드에 보일 글`, `예: 128GB`, `우유 사기`…, `남은 공간: 128GB`…). 힌트 `숫자나 짧은 값 하나를 적어요.`/`한 줄에 하나씩 적어요.`/`한 줄에 이름: 값으로 적어요.`, 명령 모드 `갱신 주기는 분, 제한 시간은 초(1~60). 출력은 <보기> 보기로 그려요.`. 동작 안내 `최대 4개, 앞의 2개는 카드에 버튼으로 보여요.`. 더 보기 요약 `설명 · 링크 · 동작 · 아이디 · N개 채움`.
  - 미리보기: 내용이 비면 흐린 예시(`cu-ghost`), 제목이 비면 `카드 제목`(흐림), 명령 모드는 `저장하면 명령을 실행해 결과를 그려요`.
  - 오류: `제목을 적어 주세요`, `영어 소문자, 숫자, 빼기(-)만 쓸 수 있어요`, 서버 검증 메시지는 앞 단어(필드 키)에 맞는 칸 아래에 붙고 그 칸이 포커스(`더 보기` 안이면 펼침), 그 외 `저장하지 못했어요`. 기존 파일이 깨져 있으면 맨 위 `지금 파일에 문제가 있어요: <오류>. 저장하면 이 내용으로 바꿔 써요.`. 저장 버튼은 `busy`로 중복 방지.
  - 성공: 토스트 `<제목|id> 카드를 저장했어요`/`추가했어요`, 홈으로 가고 새 카드는 보드의 빈 자리로 스크롤 + 머리에 포커스(`reveal`).
  - 폰 vs 데스크톱: 1100px 이상은 폼 + 380px 미리보기(미리보기가 오른쪽 sticky), 1099px 이하는 한 열(최대 560px)이고 미리보기가 위에 붙어 sticky. 899px 이하/coarse는 입력 글자 16px, 899px 이하는 `취소`/`저장`이 가로로 꽉 참.
- 데이터: `GET/POST/PUT /api/custom/cards[/<id>]`. 진입: 홈 카드 ⋯ 메뉴 `수정…`, `window.dotzCustom.add/edit`(`go("cardform", id)`); 주소 `#cardform/<id>`(`05-command-palette.js:143`). 탭 강조는 홈(`navView`).
- 근거: `web/custom.js:382`(cardForm), `:492`(openForm), `:512`(formDone), `:506`(reveal), `:764`(view 훅), `:773-`(pins); `04-state.js:31,37-39`.
- css: 스타일은 `web/custom.js:7-195`의 `CSS` 문자열을 `<style>`로 넣어요(`.cu-*`, `.pv-*`; `web/css/*.css`에서 `.cu-`/`.pv-`는 검색되지 않음), 공용 `.fi`, `.tf`, `.seg`는 `03-base.css`(주석과 INVENTORY 기준, 직접 확인은 못 함). 미디어쿼리는 같은 CSS 문자열 안: `(pointer:coarse), (max-width:899px)`, `(max-width:1099px)`, `(max-width:899px)`, `(min-width:1100px)`, `(max-width:639px)`.

### 홈 커스텀 카드 (`cardNode`, 홈 보드와 카드 편집 미리보기가 같이 써요)
- 목적: 오너/봇이 만든 카드를 홈 카드 규격으로 그려요.
- 구성: `.card`(`.ch` 머리: 제목 `h3`, 태그, ⋯ `menuBtn`), 설명 `.sup`, 본문, 오류 원인 `.cu-cause`, 푸터 `.cf`(버튼 최대 2개). 본문은 보기별: 글(`.clamp.c4`), 숫자(`.big` + 라벨/부제), 목록(최대 5줄), 항목별 값(최대 6쌍), 또는 `render.js` 모듈.
- 기능: 카드 전체 탭은 `link`가 있을 때 `openLink`(http/https는 새 탭, `#…`는 해시 이동). 버튼은 `runAction`(`confirm`이면 `ask(<라벨>, "실행할까요?", "실행")`; 명령은 `POST /api/custom/action`, 요청은 `<봇>에게 보냈어요` 토스트). ⋯ 메뉴(`menuActs`): `새로고침`, `열기`, 나머지 동작, `수정…`, `작게`/`보통`/`크게`(홈 보드 크기), `숨기기`, `삭제…`(`ask("카드 삭제", "<이름> 카드와 그 파일(<경로>)을 지워요. 되돌릴 수 없어요.", "삭제")`).
- 상태: 파일을 못 읽은 카드는 태그 `오류` + 본문 `카드를 그리지 못했어요`(또는 서버 오류). 값 새로고침 실패: 오래된 값이면 태그 `오래된 값`, 값이 없으면 `실패`. 빈 값 `값 없음`(서버 `empty` 우선), 데이터 오류 `값을 받지 못했어요`, 빈 목록 `비어 있어요`, 더 있으면 `더 보기 · N개`. 값은 날짜시각을 로컬 시각으로(`방금`, `N분 전`, `어제 HH:MM`…) 바꾸고 빈 값은 `없음`. `render.js` 로딩 `불러오는 중…`, 실패는 카드 교체 `render.js 오류`. 숨긴 카드는 `localStorage dotz-home-hidden-custom`. 결과 토스트 `끝냈어요`, `실패했어요 · <첫 줄>`, 삭제 `<이름> 카드를 지웠어요`.
- 데이터: `GET /api/custom`(`cards`), `POST /api/custom/refresh {id}`, `POST /api/custom/action {id,index}`, `DELETE /api/custom/cards/<id>`, `import /api/custom/render?id=&v=`.
- 근거: `web/custom.js:282`(cardNode), `:239`(viewBody), `:276`(actionButton), `:342`(menuActs), `:324`(homeSize), `:522`(remove), `:196`(localTime).
- css: `web/custom.js:7-195` 안 CSS + 홈 카드 공용 클래스(`02-cards-lists-tags.css`).

### 옛 프로젝트 페이지 (`web/custom.js` `paintProject`, 지금은 쓰이지 않음)
- 목적: `19-project-main.js`가 오기 전의 프로젝트 화면(개요 카드, 요청 상자, 레인, 결과, 할 일).
- 구성/기능/상태: `paintProject`는 `typeof pmPaint === "function"`이면 맨 앞에서 바로 return하고(`custom.js:728-731`), `view()`도 `pmPaint`가 있으면 `paintProject`/`loadDetail`을 호출하지 않아요(`:764-772`, 30초 타이머 `:780-`). 따라서 실제 앱(`19-project-main.js` 로드)에서는 이 경로가 그려지지 않아요. 안에 있는 문구(`레인`, `최근 결과`, `할 일과 연결`, `이 프로젝트에 맡길 일을 적어 주세요` 등)는 화면에 나오지 않음.
- 데이터: `GET /api/custom/project`는 `loadDetail`이 부르지만 위 이유로 호출되지 않음.
- 근거: `web/custom.js:728`(paintProject), `:764`(view), `:537`(loadDetail).
- css: `web/custom.js:7-195`(`.pv-*`).

### 알림 화면 (`#v-notices`, 뷰 `notices`)
- 목적: 알림을 `처리할 것`, `새 소식`, `지난 알림` 세 묶음으로 보고, 눌러서 해당 화면이나 결정 시트로 가요.
- 구성: 위에서 아래로 필터 탭 `.nsc-f`(`전체`, `답변 필요`, `결과`, `새 소식`, `경고`; 각 탭에 안 읽음 수 `.n`), 메타 줄 `.nsc-m`(읽을 것이 있을 때만 `모두 읽음`; 안 읽은 수는 탭의 `.n`만 말해요), 목록 `.nsc-l`: 묶음마다 `.sec` 제목 + `.list`(`data-g`) 안에 행 `.li.nsc-r`(점 `.dot`, 본문 버튼 `.nsc-tx`: 1줄 제목 + 시각, 2줄 요약 + 태그, 끝 버튼). 반복 알림은 접힌 자식 행 `.nsc-r[data-child]`.
- 기능: 탭 `nscFilter`(거르기만 하고 읽음 상태는 안 바꿈, 한 번에 50개씩 `NSC_PAGE`). 행 탭 `nscTap`: 결정은 시트(`noticeSheetOpen`), `[ask]`는 질문 시트(`ntAskSheet`, 없으면 대화로), 실패는 상세 시트(`ntDetailOpen`), 나머지는 읽음 처리 후 그 곳으로(`nscNav` → `noticeOpen`, 돌아오면 같은 필터와 스크롤 유지). 끝 버튼 ✕: `처리할 것`은 `처리했어요`(`/handled`), `새 소식`은 `읽음으로 표시`, `지난 알림`은 `지우기`(`/dismiss`). 접힘 버튼 `반복 알림 펼치기`. `모두 읽음`은 현재 필터에서 읽을 수 있는 것만 `ntMarkRead`.
- 상태:
  - 로딩 `불러오는 중이에요`, 실패 `알림을 불러오지 못했어요`, 비었음 `새 알림이 없어요`, 묶음 더 보기 `N개 더 보기`.
  - 행 태그(`nscTag`): `카카오톡`/`답장 확인`/`결정`, `로그인`, `실패`, `질문`, `작업 완료`/`결과`, `가격 변경`, 앱별 `메일`/`카카오톡`/`댓글`, `일정`, `아침 점검`, `감시`, `경고`, 앱 이름, 기본 `새 소식`. 점 색은 처리할 것/로그인/주의는 warn, 실패는 err, 완료/결과는 ok. 반복이면 요약 앞에 `N번 · `. 가격 변경은 이전 값 취소선 → 새 값. 시각은 `방금`/`HH:MM`/`어제`/날짜.
  - `처리할 것`은 ✕ 대신 화살표(`nsc-tr`)를 보여 주는 경우가 있어요(실패 알림만 ✕ 유지).
  - 지운 알림 토스트 `알림을 지웠어요`(버튼 `되돌리기`, 6초; `undismiss`). 답이 필요한 알림이 있는 필터에서 `모두 읽음` 뒤 토스트 `답이 필요한 알림은 그대로 뒀어요`.
  - 벨, 팔레트, 주소로 열면 필터와 펼침이 초기화되고, 행에서 돌아오면 유지(`NSC.keep`). 새 알림은 묶음 위로 슬라이드 인(`motionIn`).
  - 폰 vs 데스크톱: `09-notices-screen.css`에는 `@media` 규칙이 없어요(`grep ^@media` 결과 없음). 폭별 차이는 코드에서 확인 못 함.
- 데이터: `GET /api/notices?limit=300`(`loadNotices`), `POST /api/notices/read {ids}`, `POST /api/notices/<id>/handled|dismiss|undismiss`. SSE `notice`, `notice_dismiss`, `notice_read`(`noticeLive`, `99-boot.js`로 라우팅된다고 주석에 적힘), `/api/state`의 `notices_unread`가 어긋나면 다시 읽음(`ntSync`).
- 근거: `web/js/31-notices-screen.js:102`(nscPaint), `:73`(nscList), `:54`(nscRow), `:21`(nscTag), `:165`(nscTap), `:123`(nscOpen), `:189`(nscX), `:204`(nscDismiss), `:228`(nscReadAll); `30-notices.js:40`(loadNotices), `:77`(noticeLive), `:62`(ntSync); 상태 `04-state.js:42`(NSC); 진입 `05-command-palette.js:115,164`.
- css: `web/css/09-notices-screen.css`(`.nsc-*`), 알림 공용 `09-notices.css`.

### 알림 결정 시트 (`ntSheetPaint`, `dkOpen`)
- 목적: 오너의 답을 기다리는 질문(결정)과 보낼 내용 확인(답장 초안)에 답해요.
- 구성: `fsOpen` 시트. 일반 결정: 머리(`fsHead`: 눈썹 `.fs-ey` = `<위치> · 답변 필요|무시함|기한 지남|해결됨|답함`, 무시 ✕, 닫기), 본문(`.ds-t` 제목 `답변이 필요해요`가 기본, `.ds-m` 시각, 마크다운 본문 `ds-md`, 묻는 글의 `[file]` 줄은 위치와 상관없이 모두 그림 미리 보기(누르면 크게 보기)나 파일 칩, 미리 보기는 본문 안에서 스크롤돼 선택지를 밀어내지 않아요), 푸터 `.fs-ft`. 한 글에 질문이 여럿(`decision.group` > 1, 같은 `to`·`reply_to`)이면 눈썹에 `· 1/3`(`[data-k=count]`)이 붙고, 푸터에 `다음 질문 보기`(`[data-k=next]`)가 떠요. 초안(`draft`)이면 도킹 결정 카드를 같은 시트에 띄우고 라벨 `보낼 내용 확인`, 그 외 `결정이 필요해요`(`dkOpen`).
- 기능: 선택지 버튼마다 `ntAnswer`(`추천` 태그, 설명 `.ds-ds`). 이유가 필요한 선택지는 입력칸(`.dc-note`, 자리표시자 `이유나 내용을 적어 주세요`, aria `자세한 내용`)이 열리고 `돌아가기`/보내기. `직접 답하기`(`입력 창으로 가기`: 로그인 요청)는 대화의 그 메시지로. 헤더 ✕는 `ntIgnore`(답 없이 넘김). 답하면 다음 초안 카드가 3분 안에 오면 이어서 열려요(`dkNext`, `dkFollowOn`). 같은 글의 질문이 더 남았으면 답한 뒤 시트가 열린 채로 다음 열린 질문으로 넘어가고(`ntAfterAnswer`, 토스트 `답을 보냈어요 · 다음 질문이에요`), 마지막 질문이면 `답을 보냈어요`와 함께 닫혀요. 질문 사이를 옮겨도 쓰던 이유는 질문마다 남고(`NS.stash`), 답은 그 질문의 알림 id로만 가요. 무시는 지금 보는 질문 하나만 넘겨요.
- 상태:
  - 보내는 중 `보내는 중…`, 선택지 disabled. 실패는 토스트(허브 사유).
  - 무시됨: `무시했어요` + `답하지 않고 넘겼어요`, 버튼 `되돌리기`, `대화에서 보기`, `닫기`. 답함/종료: `이렇게 답했어요`(답 본문) / `답 없이 끝났어요` + `일이 끝나서 닫혔어요` / `기한 지남` + `답할 시간이 지나 닫혔어요`.
  - 토스트: 새 결정이 오면 `답변이 필요해요`(`열기`, 8초), 이미 처리됐으면 `이 알림은 이미 처리됐어요`, 답한 뒤 `답을 보냈어요`/`답을 보냈어요 · 다음 카드예요`/`답을 보냈어요 · 마지막 카드였어요`, 무시 `무시했어요`(`되돌리기`)와 `다시 답변 필요로 돌렸어요`. 다른 컴퓨터 질문(`n.pc`)은 그 컴퓨터로 답해요(`pqNotice`).
  - 시트는 알림 이벤트마다 다시 그리되 내용이 같으면(`sig`) 입력 중인 칸을 안 건드려요. 답한 초안 시트는 900ms 뒤 자동으로 닫혀요.
- 데이터: `POST /api/notices/<id>/answer {n,note,files}`, `/ignore`, `/unignore`; 알림의 `text`에 묻는 글의 `[file]` 줄이 질문마다 모두 실리고(`hub/notices-decisions.ts` `messageFiles`), 그림은 `/api/file?path=…&thumb=1`(크게 보기는 `/api/file?path=…`)로 와요; 같은 가공은 `GET /api/notices`와 SSE `notice` 이벤트.
- 근거: `web/js/30-notices.js:639`(ntSheetPaint), `:687`(noticeSheetOpen), `:697`(ntSheetShow), `:580`(ntAnswer), `:588`(ntEditNode), `:379`(dkOpen), `:338`(dkPaint), `:365`(dkNext), `:404`(ntDraftSheet), `:390`(ntAskSheet), `:474`(ntIgnore).
- css: `web/css/09-notices.css`(`.ds-*`), `14-overlay.css`(`.fs-*`), `07-chat.css`/`14-overlay.css`(`.dc-*`). 미디어쿼리 `09-notices.css:83`(min 700: 시트 가운데 정렬, 둥근 모서리, 최대 높이 min(80vh,760px)).

### 실패 알림 상세 시트 (`ntDetailOpen`, `ntDetailPaint`)
- 목적: 실패 알림 전문을 현재 화면 위에서 읽어요.
- 구성: `fsOpen` 시트: 눈썹 `문제가 생겼어요`(err), 제목(알림 제목, 기본 `알림`), 시각, 본문(`[file]` 줄은 파일 칩), 푸터 버튼 `대화에서 보기`, `닫기`.
- 기능: `대화에서 보기`는 시트를 닫고 `ntJump`(원문 메시지로 스크롤 + 강조). `닫기`.
- 상태: 이 시트 자체의 로딩/빈 상태는 없어요(이미 있는 알림으로 열림).
- 데이터: `NT.items` 항목(`GET /api/notices`).
- 근거: `web/js/30-notices.js:624`(ntDetailOpen), `:628`(ntDetailPaint), `:178`(ntJump).
- css: `09-notices.css`(`.ds-*`).

### 답변 필요 행과 묶음 (홈과 알림 탭에서 쓰는 알림 행, `ntHomeRow`/`ntGroupRow`)
- 목적: 홈의 `답변 필요`, 알림 대화 탭 등에서 쓰는 알림 한 줄과 답장 확인 묶음.
- 구성: 행 `.hr.hrx`: 본문 버튼 `.hrx-m`(점 `.dot att` 또는 가격 변경 아이콘 `.nt-wi`, 제목 `.nm`, 보조 줄: 위치 · 시각 또는 가격 변경 줄, 오른쪽 `답변 필요` 또는 시각/태그) + 무시 ✕ `.nt-x`(aria `<제목> 무시`, title `무시`; 라벨이 있을 때만). 묶음 `.ntg`: 머리 `<앱> 답장 확인|댓글 답글 N건`, 보조 `<받는이들> 외` 또는 `하나씩 확인해 주세요`, 오른쪽 `펼치기`/`접기`.
- 기능: 행 클릭은 `noticeOpen(n)`. 묶음 머리는 펼침 토글(`NT_OPEN`), 펼치면 항목별 행. 한 종류 승인이 둘 이상일 때만 묶음, 하나면 일반 행.
- 상태: `NT_TONE_TAG` 실패 `실패`(err), 주의 `주의`(warn)를 시각 옆에. 가격 변경은 이전 값 취소선과 굵은 새 값.
- 데이터: `NT.items`.
- 근거: `web/js/30-notices.js:524`(ntHomeRow), `:547`(ntGroupRow), `:556`(ntHomeRows), `:502`(ntIgnoreBtn), `:511`(nwChangeNode), `:519`(NT_TONE_TAG).
- css: `web/css/09-notices.css`(`.nt-*`, `.ntg*`), `10-conversations.css`, `11-peers.css`.

### 알림 문구 한글화 (`01-notice-ko.js`, 화면 없음)
- 목적: 알림과 오류 문장 속 영어 도구 이름, 명령, 경로, cron 식을 한국어로 바꿔 보여 줘요(`hub/notice-ko.ts`에서 생성된 파일이라 직접 고치지 않음).
- 구성/기능: `noticeKo`, `errorKo`, `cronKo`를 내보내요. 표 `NAMES`(예: `watch`→`모니터링`, `lane`→`세션`, `kakao`→`카카오톡`), `TOOLS`(예: `bash`→`명령 실행`), `SLASH`(예: `/compact`→`대화 정리`), `CMD_FIRST`, `SUB`, 조사 처리 `josa`, `cronKo`, `commandKo`, `pathKo`.
- 상태: 화면 상태는 없음. 변환 규칙 전체(`noticeKo`/`errorKo` 본문)는 줄 120 이후를 부분만 읽어서 코드에서 확인 못 함.
- 데이터: 없음. 사용처: `ntPlain`, `ntBody`(`30-notices.js:15,597`).
- 근거: `web/js/01-notice-ko.js:3`(NAMES), `:137`(cronKo), `:166`(commandKo), 끝 `return { noticeKo, errorKo, cronKo }`.
- css: 없음.

### 화면 공유 (원격 데스크톱 진입, 앱바 알약, 설정 행)
- 목적: 이 컴퓨터 화면을 다른 기기의 브라우저 탭(`/desk/`)에서 봐요. `S.desk`가 있을 때만 모든 진입점이 나와요.
- 구성: (1) 진입: 명령 팔레트 `화면 공유 열기`, 입력창 슬래시 `/screen`(`이 컴퓨터 화면 열기`), 다른 컴퓨터 시트의 버튼 `화면 공유 열기`(`.pr-screen`). (2) 앱바 알약 `#dsk-pill`(`#ustrip` 앞, `.tag.pri.dsk-pill`). (3) 설정 `화면 공유` 섹션(`이 컴퓨터 이름` 옆): 줄 `화면 공유`, `조작 허용`, `지금 보는 사람`, `공개 주소`.
- 기능: `openScreen()`: 진짜 Chrome이면 `POST /api/desk/open {chrome, phone}` 답을 기다린 뒤 `/desk/`를 새 탭으로 열고, 다른 브라우저는 클릭 안에서 빈 탭을 먼저 열어 두었다가 주소를 넣거나 닫아요. 알약을 누르면 `go("settings")`. 설정 스위치는 `PUT /api/desk/settings`(`on`, `control`, `allow_public`).
- 상태:
  - 토스트: `새 탭이 막혔어요. 팝업을 허용해 주세요`, 다른 컴퓨터 Chrome에서 열면 `<이름|그 컴퓨터>의 크롬에서 열었어요`, 막힘 `<사유>` 또는 `지금은 화면을 열 수 없어요`, 실패 `화면을 열지 못했어요`. 슬래시에서 `S.desk`가 없으면 `이 컴퓨터에서는 화면 공유를 쓸 수 없어요`(입력은 그대로 두고 전송 안 함). 서버 `note`가 있으면 토스트.
  - 알약: 보는 사람이 있을 때만 보이고 글자는 한 명 `<기기>에서 보는 중`, 여럿 `N곳에서 보는 중`(기기명이 없으면 `기기`), aria `<글자>. 설정에서 보기`. 없으면 숨김(모션).
  - 설정 줄 문구: `화면 공유` / `이 컴퓨터 화면을 내 다른 기기에서 봐요`, `조작 허용` / `켜면 화면을 보는 사람이 이 컴퓨터를 직접 조작해요`, `지금 보는 사람` / `<기기 · 기기>` 또는 `아무도 보고 있지 않아요`(+ 인원 태그), `공개 주소` / `Cloudflare 주소로 들어온 기기도 화면을 볼 수 있어요`(웹 접속 모드가 cloudflare일 때만). 토스트 `화면 공유를 켰어요`/`껐어요`, `조작을 허용했어요`/`보기만 할 수 있어요`, `공개 주소로도 열었어요`/`공개 주소로는 막았어요`. `조작 허용`과 `지금 보는 사람`은 공유가 켜졌을 때만.
  - 폰 vs 데스크톱: 알약은 1099px 이하에서 왼쪽 마진 0, 639px 이하에서 폭 제한(`23-remote-desktop.css:6-7`). 키보드 잠금은 데스크톱 Chrome 최상위 탭에서만 동작한다고 주석에 있음. `/desk/` 뷰어 화면 자체는 `web/js`에 없어 코드에서 확인 못 함.
- 데이터: `S.desk`(`/api/state`), `POST /api/desk/open`, `GET /api/desk/status`, `PUT /api/desk/settings`. SSE는 알약이 `17-state-refresh.js` 갱신을 따른다고 주석에 있고, 직접 구독은 코드에서 확인 못 함.
- 근거: `web/js/37-remote-desktop.js:25`(openScreen), `:83`(dskPaint), `:75`(dskPillNode), `:102`(dskSettings), `:54`(dskTake), `:64`(dskSet), `:11`(deskIsChrome); 진입 `05-command-palette.js:57`, `14-slash-commands.js:28,246-248`, `33-peers.js:180`, `22-settings-pages.js:87`.
- css: `web/css/23-remote-desktop.css`(`.dsk-pill`).

### API 월 한도 (사용량 카드, 행, 대화상자)
- 목적: Anthropic API 월 한도(달러)와 사용액을 보고 한도와 관리자 키를 설정해요.
- 구성: (1) 카드 `budgetCard`(사용량 화면 격자 맨 앞, `21-providers.js:210`): 제목 `API 월 한도` + `설정` 버튼, 한도가 있으면 `$사용 / $한도` + `N% 남음` + 남은 만큼 채우는 막대(쓴 몫이 80% 이상이면 warn) + `<초기화 시각> (KST)` + 상대 시각 `N일 후 초기화`, 한도가 없으면 `이번 달 $사용` + `월 한도 없음` + 안내 `콘솔에서 정한 월 한도를 설정에 입력하면 사용 비율을 보여줘요.`, 아래 줄 `<월> · 콘솔 기준 (관리자 키)|이 앱 사용분 추정`, `B.error`(warn), `B.hint`. (2) 서버 `budget`이 없으면 행 `budgetRow`(`API 월 한도` + `월 $N`|`정하지 않았어요` + 버튼 `월 한도 바꾸기`). (3) `dialog` `API 월 한도`: 안내, `월 한도 (달러)` 숫자 입력(자리표시자 `예: 100`), 관리자 키 안내, `관리자 키` 비밀번호 입력(`관리자 키 붙여 넣기`), 보안 안내 `키는 저장하기 전에 한 번 확인하고, 다시 보여주거나 기록에 남기지 않아요.`
- 기능: 버튼 `취소`, (키가 있으면) `관리자 키 삭제`, `저장`(`PUT /api/api-budget {monthly_usd|null, admin_key?}`; 입력을 비우면 한도 없음). 성공 토스트 `저장했어요`/`관리자 키를 지웠어요`, 사용량 화면이면 `loadQuota` 갱신, 설정 다시 그림.
- 상태: 관리자 키가 있으면 `관리자 키: <마스킹>. 새 키를 붙여 넣으면 바꿔요.`, 없으면 `관리자 키가 없어요. 콘솔 설정의 관리자 키 메뉴에서 만들어 붙여 넣으면 콘솔 기준 사용액을 보여줘요. 없으면 이 앱 사용분 추정만 보여줘요.`. 읽기 실패는 토스트. 행의 부제는 첫 렌더에 `GET /api/api-budget`을 불러오고 실패하면 다음 렌더에 다시 시도.
- 데이터: `GET/PUT /api/api-budget`, 카드는 `/api/quota`의 `budget` 필드.
- 근거: `web/js/37-api-budget.js:4`(budgetCard), `:24`(budgetRow), `:29`(budgetSub), `:37`(budgetDialog); 사용처 `21-providers.js:210-211`.
- css: `web/css/02-cards-lists-tags.css`(1건), `15-settings-pages.css`(`.budget-row` 등 3건).

### 앱 설치와 푸시 알림 (설정 `앱과 알림`, 새 버전 칩)
- 목적: 홈 화면 앱 설치 안내, 이 기기의 푸시 알림 켜기/끄기, 새 버전 적용, 공유 시트로 받은 사진과 글을 입력창에 붙이기.
- 구성: 설정 페이지 `notifications`(`22-settings-pages.js:6`의 `앱과 알림`)가 `pushSection`을 그려요: 섹션 `이 기기`(줄들), 섹션 `알림 종류`(`appNotifyRows`는 이 범위 밖이라 코드에서 확인 못 함). 그 밖에 `body`에 붙는 칩 `.shell-chip`(`새 버전 · 눌러서 적용`), 설치 안내 `dialog`.
- 기능: `앱 설치`(`installApp`: Chrome/Edge는 `beforeinstallprompt` 프롬프트, 없으면 안내 대화상자 `앱 설치` + 단계 목록 + `확인`), `알림 켜기`(`pushEnable`: 권한 요청, 구독, `POST /api/push/subscribe`), `테스트 알림`(`POST /api/push/test`), `끄기`(`pushDisable`), 게이트웨이별 스위치 `<이름|이 컴퓨터> 알림`(`pushGw` → `PUT /api/push/gateways`). 새 버전 칩은 눌러서 `shellApply`(페이지 새로고침). `?shared=1`로 열리면 캐시에 둔 공유 파일/글을 채팅 입력창에 붙임(`sharedIntake`, 전송 안 함).
- 상태:
  - 줄: 설치 안 된 상태에서만 `홈 화면에 추가` 줄(오른쪽 버튼 `앱 설치`). 앱이 있는 기기는 게이트웨이마다 스위치, 응답 없는 게이트웨이는 `연결 안 됨`. 알림 미지원 `이 브라우저는 알림을 지원하지 않아요`(iOS 일반 탭은 `iPhone은 홈 화면에 추가한 앱에서 알림을 켤 수 있어요`), 권한 거부 `알림 권한이 막혀 있어요`, 미구독 `알림` + `알림 켜기`, 구독 중 `알림 확인` + `테스트 알림` + `끄기`.
  - 토스트 `알림을 켰어요`, `알림을 껐어요`, `테스트 알림을 보냈어요`, 권한 거부 `알림 권한이 꺼져 있어요. 기기 설정에서 <봇> 알림을 허용해 주세요`, 설치 완료 `앱을 설치했어요. 홈 화면의 <봇> 아이콘으로 열어 주세요`, 공유 `사진 N장을 붙였어요`/`파일 N개를 붙였어요`.
  - 설치 안내 단계: iOS(Safari 또는 다른 브라우저별 공유 버튼, `'홈 화면에 추가'`, `'웹 앱으로 열기'`), Android(`브라우저 메뉴(⋮)`, `'앱 설치'`, `'바로가기 만들기'`는 고르지 말 것), 그 밖(`주소창 오른쪽의 설치 아이콘`, `'앱 설치'`) + 노트 `전에 추가한 <봇> 아이콘이 브라우저로 열리면 지우고 다시 추가해 주세요.`
  - 새 버전: 페이지가 숨겨져 있고 입력/첨부/시트/대화상자가 없으면 자동 새로고침(1분에 한 번 이하), 아니면 칩만 보여요. 구독이 서버에서 사라졌고 권한이 있으면 10분에 한 번 조용히 다시 구독.
- 데이터: `GET /api/push[?endpoint=]`, `POST /api/push/subscribe|unsubscribe|test|presence|claim`, `GET`/`PUT /api/push/gateways`, 서비스 워커 `/sw.js`(`shell-updated`, `refresh-shell` 메시지), 공유 캐시 `dotz-share`.
- 근거: `web/js/23-installable-app-web.js:226`(pushSection), `:209`(installApp), `:158`(pushEnable), `:172`(pushDisable), `:151`(pushGw), `:116`(pushLoad), `:62`(shellUpdated), `:15`(sharedIntake), `:109`(pwaInit); 설정 연결 `22-settings-pages.js:6`.
- css: 칩 `web/css/03-base.css`(`.shell-chip` 2건), 줄은 설정 공용 `02-cards-lists-tags.css`/`15-settings-pages.css`.

### 모니터링 화면 (뷰 monitoring)

- 목적: 감시, 예약, 앱(메일, 카카오톡, 댓글 등), 답장 확인, 다른 컴퓨터의 항목을 한 목록으로 보고, 항목 하나를 대화처럼 여는 탭이에요.
- 구성: `#v-monitoring` 안에 `aside#mon-side.cv-side`(목록, aria-label `모니터링 목록`), `div#mon-head.cv-head`(열린 항목 머리), `.chatbox > #mon-timeline > #mon-tl`(열린 항목 본문). 카카오톡과 댓글 창(`#cm`, `.kk`)은 같은 `#v-monitoring` 뒤에 붙고 열리면 `.chatbox`를 대신해요. 감시 항목은 채팅과 같은 두 칸으로 열려요(`web/js/30-monitor-chat.js`): 행을 누르면 `go("monitoring", "c:settings:w:<감시>")`로 `#v-chat.mon-ctx.mon-two`가 서고, 왼쪽 `#chat-convo`에 감시 행만(`monListRows`: 감시 소식, 답장 확인, 앱, 앱 관리, 앱이 소유한 감시는 빠져요), 오른쪽에 대화, 그 위 `#mon-chat-top`에 진행 막대, 끊김 안내, `지금 확인`, `소식`이 있어요. `소식`(`m:<이름>`, 알림과 홈에서 오는 주소, 대화가 없는 예약, 이 컴퓨터 감시와 이름이 같은 다른 컴퓨터 감시)은 `#v-monitoring.mon-two`로 같은 칸 폭에 확인 기록을 보여요. 앱 항목(메일, 카카오톡, 댓글 등 앱 화면이 있는 것)은 이 두 칸을 쓰지 않아요.
- 기능: 항목 열기 `go("monitoring", key)` (key는 `notice`, `replies`, `i:<앱>`, `m:<이름>`, `p:<url>|...`), 목록으로 돌아가기(`MON.list = true`), 메일/설정 대화는 `go("monitoring", "c:<target>")`로 채팅 뷰를 모니터링 탭 안에서 그려요.
- 상태: `MON.list`가 true면 목록만 보여요(`#v-monitoring.cv-listing`, 폭과 상관없이 목록이 `.cv-side`만 남기고 나머지는 숨김). 항목이 열려 있으면 `MON.list=false`, `MON.sel`이 열린 키예요. 데스크톱(1100px 이상)도 앱 항목과 목록은 한 번에 한 층만 서고 최대 폭 920px로 가운데 정렬해요(카카오 채팅이 열린 경우 제외). 감시 항목은 채팅과 같은 `--cv-w:340px` 두 칸이에요. 폰은 채팅처럼 목록, 대화, 뒤로 순서예요(`#back`이 목록으로). 폰/태블릿은 `narrowChat()`가 `max-width:1099px`이고, 이때만 `monTopNodes`가 머리 대신 본문 맨 위에 카드를 그려요. 항목을 못 찾으면(`sel` 없음) 아무것도 그리지 않고 제목만 갱신해요. 모니터링 탭이 아니면 렌더하지 않고 `mbSeenReset()`만 해요.
- 상태(주소): 목록은 `#monitoring`, 항목은 `#monitoring/<encodeURIComponent(key)>`(`monHash`), 메일이나 설정 대화는 `#monitoring/c:<target>`. 기록 뒤로가기는 항목 위 단계를 `home > monitoring > monitoring/<key> > 현재`로 쌓아요. INVENTORY의 `#comments`, `#watch/price` 같은 주소는 프로토타입 주소이고 코드에는 없어요.
- 상태(갱신): 알림이 도착하면 다시 그려요(`monSchedule` = requestAnimationFrame, `renderMonitoring`). 모니터링 탭이 열려 있거나 `monCtx`가 있고 화면이 보이면 60초마다 `loadMonitors()`를 다시 불러요. 화면을 열 때(`go`)는 마지막으로 읽은 지 60초가 안 됐으면(`monitorsFresh`) 모니터 목록을 다시 읽지 않고 가진 것을 써요(앱 목록 `/api/integrations`는 늘 읽어요). 탭이 숨겨지면 1초 틱 타이머를 멈추고 다시 보이면 재개해요. 안 읽은 알림은 항목이 열린 채 700ms 보이면 읽음 처리해요(`monSeen`).
- 데이터: `GET /api/monitors` (`{items:[{name, watch?, kind, channel?, last_run?, last_result?, next_run?, every?, connection?, since?, conn_reason?, paused?, last_summary?, scope?, project?, project_title?, app?, fails?, last_ok?, last_output?}]}`), `GET /api/integrations`, 알림(`NT.items`, SSE `notice`, `notice_read`, `notice_dismiss`), 대화(`CONV`, `MAILS`).
- css: web/css/20-monitoring.css(대부분의 `mon-*`), web/css/10-conversations.css(`#v-monitoring` 그리드 2~7행, 114~137행), web/css/01-tokens.css:188(1100px 이상 여백), web/css/19-volume.css(`mon-bar`, `mon-tabs`, `fr-*`, `mon-more`, `mon-day`, `mon-sh`).
- css(반응형): 10-conversations.css:6-7 목록 단계, :114 `max-width:1099px`, :128 `min-width:1100px`(`--cv-w:240px`, `#v-monitoring` 한 열 그리드, `max-width:920px`), 20-monitoring.css:107 `min-width:1100px`(열린 앱 대화는 목록 칸 없이 채팅 대화창 폭으로 가운데: `#v-chat.mon-ctx:not(.mon-two)`, 감시는 `.mon-two`로 채팅의 두 칸).
- 근거: web/index.html:99-103(마크업), web/js/30-monitoring.js:9-18(상태와 `monHash`), :33(`monRoute`), :1032(`renderMonitoring`), :1031(`monSchedule`), :1179-1180(60초 갱신, 첫 로드), web/js/05-command-palette.js:117-143,162(`go`), web/js/31-conversations.js:438-441(`cv-listing`), web/js/32-history-nav.js:19-23.

### 모니터링 목록 (좌측 목록, list)

- 목적: 보고 있는 것 전체를 한 줄씩 보여주고 항목을 고르게 해요.
- 구성: `#mon-side` 안에 섹션 라벨(`.mon-sec`, role presentation)과 그룹 카드(`.mon-grp`) 번갈아 나와요. 순서: 감시 소식(라벨 없음), 답장 확인(있을 때, 라벨 없음), `앱` 그룹(앱 행들 + 마지막에 `앱 관리` 행), `프로젝트 · <이름>` 그룹들, `일반 모니터링` 그룹, 다른 컴퓨터 행. 행은 공용 `convRow`예요. 감시/예약 행은 마지막 자식으로 진행 막대 블록이 붙어요(`has-mon-prog`).
- 기능: 행 탭으로 `go("monitoring", key)`. `앱 관리` 행은 `asAddSheet()`(앱 추가 시트)를 열어요. 목록 스크롤 위치를 `MON.top`에 기억하고 목록으로 돌아오면 복원해요.
- 상태: 데이터 로딩 전 `모니터링 불러오는 중…`, 불러오기 실패(첫 로드) `모니터링을 불러오지 못했어요` (둘 다 헤더 행 `rows.push({header})`). `앱 관리` 행 힌트는 꺼 둔 앱이 있으면 `꺼 둔 앱 <이름들> · 새로 추가`, 없으면 `새로 추가하기`. 선택된 행은 `sel`로 표시(목록 모드이면 선택 표시 없음). 행 배지: 앱이 끊김이면 `연결 끊김`(err), 앱 소유 감시가 실패면 `실패`(err); 감시/예약은 `monStatus` 배지(아래 상태 표). 감시/예약 행이 끊김이면 상태줄에 `연결 끊김 · <HH:MM>부터`(`monConnShort`), 아니면 상태줄은 지우고 막대만 둬요. 같은 방식으로 집약된 칩: `답 필요 <n>`(warn). 숨김 규칙: `scope:"internal"`이고 실패도 끊김도 아닌 감시는 목록에 안 나와요(`monHidden`). 앱이 소유한 감시(`own`/`watches`/`scope:"app"`)는 일반 모니터링에 행이 없고 앱 행 안에서 보여요.
- 상태(모니터 상태 표, `MON_PTAG`): `정상`(ok), `바뀜`(warn), `실패`(err), `연결 끊김`(err), `확인 필요`(warn, 아직 실행 전), `꺼짐`(paused), `늦어짐`(warn, 다음 실행 시각이 지남), `확인 중`(pri, 지금 확인 실행 중). 우선순위: 연결 > 꺼짐 > 실패 > 늦어짐 > 바뀜 > 정상 > 확인 필요(`monStatus`).
- 상태(행 힌트): 앱 행은 `monNeedLine`(`오늘 자동 답장 <n>건 보냄`; 개수는 행 오른쪽 숫자 한 번만 말하니 줄에 다시 쓰지 않아요. 없으면 답장·안 읽음이 있을 때 `마지막 소식 <시각>`(시각을 모르면 빈 줄), 그 외 `확인할 것 없어요`, 끊김이면 `연결 끊김` 또는 허브가 준 `hint`, 소유 감시가 실패면 `확인이 실패했어요`). 감시/예약 행은 지금 확인 중이면 `지금 확인하고 있어요`, 최신 소식 요약, 없으면 `monRunLine`(아래).
- 상태(그룹 이름): `MON_GROUP` = `앱`, `일반 모니터링`; 프로젝트 감시는 `프로젝트 · <project_title 또는 "프로젝트">`.
- 데이터: `GET /api/monitors`(60초마다와 탭 진입 시), `GET /api/integrations`, 알림. 다른 컴퓨터 행은 `PQ.list`(`34-peer-monitoring.js`).
- css: web/css/20-monitoring.css, web/css/10-conversations.css(`.cv-row`, `.cv-gh`).
- 근거: web/js/30-monitoring.js:253(`monRows`), :187-221(`monItems`), :1093(`monSideNodes`), :1106(`monDecorateRows`), :164-186(`monNeedLine`, `monOwner`, `monHidden`), :66-74(`monStatus`), web/js/32-app-settings.js:226,231(`asAddHint`, `asAddSheet`).

### 항목: 감시 소식 (key `notice`)

- 목적: 어떤 행도 소유하지 않은 감시와 예약 결과 소식을 모아서 보여주고, 모든 일반 모니터링 상태를 한눈에 보여줘요. 알림 채널의 글과 거기서 묻는 결정은 여기 안 나와요(채팅의 알림 대화에 있어요).
- 구성: 필터 바 `.mon-bar`(소식이 7건 이상이거나 답 필요/안 읽은 실패가 있을 때만), `모니터링 상태` 개요(`.mon-ov`; 폰에서는 머리 한 줄 `button.mon-ov-h`(이름 + 상태별 개수 `.mon-ov-sum` + 화살표)로 접혀 있고 누르면 행이 펼쳐져요, 넓은 화면은 펼쳐진 채), 소식 본문. 머리는 `monHead`.
- 기능: 개요 행 탭으로 해당 모니터링 열기(`go("monitoring", i.key)`). 소식은 6건 이하면 전체 카드 최신순(`monFeedCards`), 7건 이상이면 구역 + 접힌 행(`monFeedNodes`). 필터 `전체 / 답 필요 / 실패`와 읽음 처리(아래 `소식 필터 바`). 더 보기, 접기, 답하러 가기.
- 상태: 목록 행 힌트는 읽지 않은 최신 소식(다른 컴퓨터 것이면 `<컴퓨터> · 요약`), 없으면 마지막 소식이 있을 때 `마지막 소식 <오늘 HH:MM 또는 M월 D일>`, 아예 없으면 `새 감시 소식이 없어요`. 헤더 상태줄은 `답 필요 <n>건 · 안 읽음 <n>개`, 둘 다 없으면 `감시와 예약 결과`. 개요 정렬: 끊김, 실패, 늦어짐, 확인 전, 정상, 꺼짐 순이고 같은 순위에서는 다음 실행이 가까운 것 먼저. 개요가 비면 `아직 일반 모니터링이 없어요`. 개요 행의 다른 컴퓨터 항목이 다음 실행 시각을 안 보내면 막대 대신 `다른 컴퓨터`. 개요 한 줄 요약은 끊김이면 `연결 끊김 · <since>부터 · <다시 로그인 필요 또는 확인이 계속 실패해요>`, 아니면 `last_summary` 또는 `monRunLine`. 구역 제목(소식이 둘 이상 구역일 때): `답 필요`, `실패`, `소식`; 날짜 줄은 `dayLabel`(오늘 / 10월 25일 (토) 형식). 소식이 없고 불러오는 중이면 `불러오는 중…`, 없으면 `아직 소식이 없어요`, 필터 결과 없음은 `이 보기에 해당하는 소식이 없어요`. 항목 자체 힌트의 `monGone`: 사라진 감시의 소식은 힌트에서 제외.
- 데이터: 알림 `NT.items`(kind `watch`, app 소속 아님), 다른 컴퓨터 알림(`pqMerge`가 `feed.notices`에 합침), 읽음 처리 `POST /api/notices/read`.
- css: web/css/20-monitoring.css(`mon-ov*`), web/css/19-volume.css(`mon-bar`, `mon-tabs`, `mon-sh`, `mon-day`, `fr-*`).
- 근거: web/js/30-monitoring.js:216(항목 생성), :230(`monFeedHead`), :891(`monOverview`), :905(`monTimeline`), :781(`monFeedNodes`), :864(`monFeedCards`), :863(`MON_COMPACT=6`), :243(`monState`).

### 항목: 답장 확인 (key `replies`)

- 목적: 모든 앱과 컴퓨터에서 보내기를 기다리는 답장 초안을 한 목록으로 모아요.
- 구성: 목록 행(그룹 라벨 없이 감시 소식 바로 아래, 초안이 있거나 열려 있을 때만), 머리 `monHead`, 본문 `rqNodes()` (30-replies.js).
- 기능: 머리의 `빠른 처리` 버튼(`trOpen("*")`, 대기 초안이 `TR.min` 이상일 때만); 앱 머리의 `답장 확인 <n>` 버튼은 이 큐를 그 앱 기준으로 연다(`rqOpen`). 카드 동작은 30-replies.js 범위(코드 위치만 표기).
- 상태: 행 이름 `답장 확인`, 힌트 `<앱 이름 최대 3개 · 구분> 답장 <n>건`, 큐가 비면 `확인할 답장이 없어요`; 행 배지(안 읽음 수)는 대기 초안 수. 열린 항목 상태줄은 `기다리는 초안 <n>개`. 본문은 `rqSig()`가 바뀔 때만 다시 그려요(스크롤 위치 유지).
- 데이터: 알림의 초안 결정, `comment_draft` / `comment_send` SSE로 `rqSoon()`.
- css: web/css/15-reply-card.css, web/css/15-triage.css.
- 근거: web/js/30-replies.js:56-64(`rqMonItem`, `rqOpen`), web/js/30-monitoring.js:218-219,247,981,1059-1070.

### 항목: 앱 (key `i:<앱 키>`, 메일, 카카오톡, 댓글 앱을 뺀 일반 앱)

- 목적: 앱(통합)이 만든 소식과 상태를 대화처럼 보여주고, 끊김이면 다시 연결하게 해요.
- 구성: 머리 `monHead`(아이콘, 이름과 컴퓨터 이름표 `.mon-pc`, 마지막 소식 시각 `.mon-hd-time`, 동작 버튼들 `.mon-hdacts`, 상태줄 `.cv-p`), 끊김이면 연결 배너, 필터 바(조건부), 소식 노드(`monChronoNodes`: 오래된 것 위, 새 것 아래, 처음 열면 맨 아래로 스크롤).
- 기능: `대화로 이어가기`(`go("monitoring", "c:" + asConv(app))`, 앱 설정 대화), `답장 확인 <n>`(초안이 있을 때, `rqOpen`), `미답장 <n>` 알약, 앱 설정 진입(`asEntry`), 끊김일 때 `다시 연결`(`monRecheckApp`: 앱이 소유한 감시를 모두 실행). 같은 결과가 3번 이상 이어지면 한 줄로 접고 `같은 결과 <n>번 · 처음 <시각>`.
- 상태: 끊김이면 목록 배지 `연결 끊김`, 배너 `연결이 끊겼어요 · <이유>`와 `다시 연결` 버튼(소유 감시가 없으면 버튼 없음). 상태줄(`monState`)은 `it.hint`(위 `monNeedLine` 문구). 다시 연결 결과 토스트: 일부 실패 `<전체>개 중 <실패>개는 확인하지 못했어요`, 승인 요청이 간 경우 `다시 연결을 요청했어요. 승인 요청이 오면 눌러 주세요`, 그 외 `지금 다시 확인했어요`. 소식이 없고 불러오는 중이면 `불러오는 중…`, 없으면 `아직 소식이 없어요`. 필터 결과 없음 `이 보기에 해당하는 소식이 없어요`.
- 데이터: `GET /api/integrations`(`{items:[{key,label,icon,iconPath?,conv,convNot?,unread,notices,needs:{drafts,unread,sentToday,unreplied},state,hint,own,watches,watchesNot,kind}],available:[...]}`), 소유 감시 실행 `POST /api/watches/<이름>/run`(다른 컴퓨터 앱은 `/api/peer/act`로 `{action:"watch",args:{op:"run",name}}`).
- css: web/css/20-monitoring.css, web/css/18-app-settings.css(`mon-chips`).
- 근거: web/js/30-monitoring.js:187-200(`monItems` 앱 부분), :639(`monRecheckApp`), :809(`monChronoNodes`), :882(`monConvBtn`), :951(`monBannerOf`), :973(`monHead`), web/js/30-integrations.js:23(`loadIntegrations`).

### 항목: 메일 앱 (key `i:mail`, 메일함 목록)
- 메일함(`web/js/30-mailboxes.js`, `30-mailboxes-set.js`, 계약 `docs/mailbox.md`): 메일 앱 인스턴스가 여러 개여도 모니터링의 한 줄과 한 화면이에요(계정이 둘 이상이면 이름은 `메일`, 앱 바에 계정 칩). 1100px부터 왼쪽에 `전체`와 메일함 칸, 그보다 좁으면 목록 맨 위 칩 줄이에요. 주소는 `monitoring/i%3Amail/<계정>/<메일함>[/set|/new]`이고 옛 주소도 열려요. 행의 폴더 버튼과 선택 막대의 `옮기기`로 같은 계정 안에서 옮기고, 옮긴 뒤 `앞으로는 어떻게 할까요?` 상자에서 고른 것만 학습해요(`되돌리기`는 고르기 전까지). 옮겨도 초안, 승인, 발송은 그대로예요.

- 목적: 받은 메일을 받은편지함처럼 최신순 행으로 보여주고 답장 초안을 관리해요.
- 구성: 머리, 메일 머리 두 줄(자리 탭 `.mx-tabs.mr-place`, role tablist, aria-label `메일 위치` / `받은 메일`에서만 걸러 보기 `.mr-filter.mr-mail`, aria-label `메일 보기`), 메일 행 목록(`mbList`, 30-mail-box.js), 메일에 속하지 않는 소식 카드, 새 메일 버튼(`mbFab`, 30-mail-box.js).
- 기능: 머리는 두 줄. 윗줄은 자리 탭(밑줄 탭) `받은 메일 / 보낸 메일 / 보관함`(`보낸 메일`·`보관함`만 개수, 0이면 숨김), 아랫줄은 `받은 메일`에서만 보이는 걸러 보기 `전체 / 안 읽음 / 답장 필요 / 확인 대기 / 답장함`(각 개수 표시, `전체`는 개수 없음, `확인 대기`는 대기 초안 수). `받은 메일`로 돌아오면 직전에 보던 걸러 보기가 켜져요. 행 탭이면 `go("monitoring", "c:<mail:...>")`로 메일 대화 열기. 행의 연필 `초안 작성`: 대화상자 `답장 초안`(`어떻게 답할까요?`, 안내 `비워 두면 알아서 써요`, 버튼 `초안 만들기`, Cmd/Ctrl+Enter로 제출, `POST /api/mail/<key>/draft`, 토스트 `답장 초안을 만드는 중이에요`, 버튼 `만드는 중…`). `⋯` 메뉴(aria-label `메일 메뉴`): `초안 작성`, `답장 안 함`(답장이 필요한 상태일 때) 또는 `답장 필요로 표시`(그 외), `삭제`; 보낸 메일은 `삭제`만. `답장 안 함` `POST /api/mail/<key>/fyi`, 되돌리기 `DELETE`, 토스트 `답장 안 함으로 표시했어요`(되돌리기 버튼) / `답장 필요로 표시했어요`. 삭제는 확인창 `메일 삭제` / `이 메일을 목록에서 지워요. 메일함에는 그대로 남아 있어요.` / `삭제`, `DELETE /api/mail/<key>`, 토스트 `메일을 목록에서 지웠어요`.
- 상태: 열 때 대기 초안이 있으면 `확인 대기` 필터로 시작(한 번만), 없는데 남아 있으면 `전체`로 되돌려요(`mailLand`). `확인 대기` 필터는 메일 행 없이 초안 카드만. 빈 목록 문구: `확인할 초안이 없어요`(확인 대기) / `이 보기에 해당하는 메일이 없어요`. 메일 상태 표시(`MAIL_STATE`): `답장 필요`(warn), `초안 있음`(warn), `답장함`(ok), `답장 안 함`, 보낸 메일 `내가 보냄`; 미답장이면 주황 `미답장` 알약. 답장 칩(`MAIL_REPLY`): `답장 초안 있음`, `자동 답장 보냄`, `답장 대기`. 행 표시: `안 읽음`(또는 `안 읽음 <n>`), 첨부 개수(클립), 규칙 이름표, 제외 이유(`m.why`), 제목 없으면 `(제목 없음)`, 보낸이 없으면 `받는 사람`, 시각은 오늘이면 HH:MM 아니면 `M월 D일`. 첨부는 `첨부 <n>개` 목록과 내려받기 링크(라벨 `<파일명> 내려받기`). 대화에 묶인 메일이 삭제돼 없으면 행이 없어요.
- 데이터: `MAILS`, `CONV`(`/api/conversations`), `POST /api/mail/<key>/draft`, `POST` `DELETE /api/mail/<key>/fyi`, `DELETE /api/mail/<key>`, `GET /api/mail/<key>/files/<i>[?dl=1]`, 알림.
- css: web/css/20-mail-box.css, web/css/16-result-card.css(`mr-*`, `md-ctx`), web/css/02-cards-lists-tags.css(`.mr`; 터치/640px 이하에서 `button.cchip.mr-act` 높이 32px, :40).
- 근거: web/js/30-monitoring.js:452-457(`monMailList`, `MAIL_FILTERS`), :479(`mailLand`), :486(`mailFilterBar`), :500(`monConvNode`), :554(`mailDraftDialog`), :575(`mailSetFyi`), :592(`mailDelete`), :607(`mailMenuBtn`), :858(`withMails` 반환). 메일 상세 대화 화면은 다른 범위예요.

### 항목: 감시 (key `m:<이름>`, kind watch)

- 목적: 주기적으로 바뀐 곳을 확인하는 감시 하나의 상태와 확인 기록을 보여줘요.
- 구성: 머리 `monHead`(아이콘 `activity`, 이름, 컴퓨터 이름표, 마지막 실행 시각, 동작, 설명 한 줄 `monDesc`, 진행 블록, 배너). 폰이면 본문 맨 위에 `.mon-topcard`(설명, 진행 블록, 배너, 동작 `.mon-actions`)를 한 장 더 그려요. 섹션 제목 `확인 기록`(`.mon-sec`, heading level 3), 확인 기록 카드(`.mon-log` 한 장에 압축 행들), 질문 칩(`.mon-chips`).
- 기능: `지금 확인`(`monRunNow`, `POST /api/watches/<watch>/run`; 다른 컴퓨터 감시는 그 컴퓨터에서 실행하고 `pqSoon()`), `대화로 이어가기`, 설정(`asEntry("w:<watch>")`), 압축 행 탭으로 펼치기/접기(`접기` 버튼), `답하러 가기`, 질문 칩 탭이면 `asAsk("w:<watch>", 칩)`. 맨 위 행은 감시의 마지막 실행(`monRunRow`).
- 상태: 설명 `바뀐 곳이 있는지 <every> 확인해요.`(every 없으면 `알아서`). 실행 중 버튼 `확인하는 중…`, 끝나면 토스트 `확인했어요`; 끊김이 계속이면 `확인했지만 아직 연결이 끊겨 있어요`; 승인 게이트이면 `다시 연결을 요청했어요. 승인 요청이 오면 눌러 주세요`. 마지막 실행 줄(`monRunLine`): 실행 전 `아직 확인 전이에요`, `마지막 확인 결과 정상이에요` / `마지막 확인에서 바뀐 점이 있어요` / `마지막 확인이 실패했어요`, 그 외 `확인했어요`. 부가 줄: `연속 실패 <n>번`, `마지막 정상 <시각>`, `마지막 결과: <출력>`(명령처럼 보이면 숨김), `다음 확인 <시각> · <every>`. 배너: 끊김이면 `연결이 끊겼어요 · <시각>부터 · 다시 로그인 필요 | 확인이 계속 실패해요`와 `다시 연결` 버튼, 마지막 확인 실패면 `확인 실패 · 마지막 확인이 실패했어요 | <n>번 연속 실패했어요 · <요약>`과 `지금 다시 확인` 버튼(이때 머리의 `지금 확인`은 안 나와요). 꺼짐(paused)이면 막대 회색과 태그 `꺼짐`. 소식이 없으면 `<monRunLine>[ · 다음 확인 <시각>]`, 필터 결과 없음 `이 보기에 해당하는 소식이 없어요`. 원시 명령은 화면에 안 나오고(`monHuman`), 영문 하이픈 이름은 공백으로 풀어 보여줘요(`monWords`), 이름이 없으면 `지켜보는 일`. 오래된 소식은 30개씩: 스크롤이 끝에 닿으면 자동으로 더 불러오고(`monOlderLoad`, IntersectionObserver) 버튼 `이전 소식 <n>개 보기`도 있어요.
- 데이터: `GET /api/monitors`, `POST /api/watches/<watch>/run`(응답 `{item, approved}`), 알림(kind `watch`), SSE `notice`.
- css: web/css/20-monitoring.css(`mon-prog*`, `mon-lr`, `mon-log`, `mon-banner`, `mon-topcard`, `mon-hdwrap`, `mon-hdrow`, `mon-hdacts`, `mon-sentinel`, `mon-continue`, `mon-chips`).
- 근거: web/js/30-monitoring.js:187-210(`monItems` 감시 부분), :617(`monRunNow`), :752(`monRunRow`), :760(`monRunChips`), :809(`monChronoNodes`), :870(`monTopNodes`), :905-916(`monTimeline`), :951(`monBannerOf`), :973(`monHead`), :1154-1178(이전 소식 자동 로드).

### 항목: 예약 (key `m:<이름>`, kind schedule)

- 목적: 정해진 때에 도는 작업의 실행 상태와 기록을 감시와 같은 틀로 보여줘요.
- 구성: 감시 항목과 같아요. 섹션 제목이 `실행 기록`이고, `m.watch`가 없으면 `지금 확인` 버튼이 없어요.
- 기능: `대화로 이어가기`, 설정은 `s:<id>`(화면만, 대화 없음, `asEntry`).
- 상태: 설명 `<every> 알아서 실행해요.`(every 없으면 `정해 둔 때에 한 번 실행해요.`). 마지막 실행 줄 `예약한 일을 실행했어요`(실행 전 `아직 확인 전이에요`). 이름이 명령뿐이면 `예약한 일`. 설정 이름은 예약 이름 또는 `예약`. 다른 컴퓨터 예약의 목록 배지는 `예약`(`MON_KIND.schedule`), 끊김, 꺼짐, 실패 배지가 우선.
- 데이터: `GET /api/monitors`(`kind:"schedule"`, `schedule` id).
- css: 감시와 같아요.
- 근거: web/js/30-monitoring.js:11(`MON_KIND`), :132(`monDesc`), :152(`monRunLine`), :911(`실행 기록`), :920-925(`monSettingsName`), :937(`monSettingsApp`), web/js/34-peer-monitoring.js:234.

### 항목: 프로젝트 모니터링 (그룹 `프로젝트 · <이름>`)

- 목적: 프로젝트가 소유한 감시를 일반 모니터링 위에 따로 묶어요.
- 구성: 감시/예약 행과 같고, 목록에서 `앱`과 `일반 모니터링` 사이에 `프로젝트 · <project_title>` 섹션으로 나와요(프로젝트가 처음 나온 순서).
- 상태: `scope:"project"`와 `project`가 있을 때만. 허브가 `scope`를 안 보내면 모두 일반으로 나와요.
- 데이터: `/api/monitors`의 `scope`, `project`, `project_title`.
- css: web/css/20-monitoring.css.
- 근거: web/js/30-monitoring.js:180-184,207,212.

### 항목: 다른 컴퓨터 (peer 항목, key `p:<url>|<원래 키>` 또는 `p:<url>|off`)

- 목적: 다른 게이트웨이의 앱, 감시, 예약, 소식, 메일을 이 목록에 같이 보여줘요.
- 구성: 목록에서 이 컴퓨터 항목 뒤에 이어 붙어요(앱 그룹 끝, 프로젝트 그룹, 일반 모니터링 끝, 마지막에 연결 안 됨 행). 행마다 컴퓨터 이름 칩, 열면 머리에 컴퓨터 이름표(`pqLabel`, `.mon-pc`; 이 컴퓨터 항목도 `pqSelf()` 이름이 있으면 같은 이름표를 달아요).
- 기능: 이 컴퓨터 항목과 같은 화면과 동작이에요. 지금 확인은 `/api/peer/act` `{action:"watch",args:{op:"run",name}}`, 읽음 처리는 `{action:"notice",args:{op:"read",ids}}`, 메일 답장 안 함/삭제는 `{action:"fyi"}`, `{action:"mail-delete"}`, 파일 업로드 `{action:"upload"}`, 카카오/댓글은 `{action:"kakao"|"comments"}`. 읽기는 `pqProxy(pc, path)`. 열린 앱 설정 대화는 그 컴퓨터에 있어요(`PQ.of`).
- 상태: 연결 안 됨(`p.items` 없음) 행 이름 `<컴퓨터 이름> · 연결 안 됨`, 열면 본문 `연결 안 됨`. 컴퓨터가 오프라인(`p.online` false)이면 행 칩 `연결 안 됨`(warn). 다른 컴퓨터 감시의 배지: `연결 끊김`(err) > `꺼짐` > `실패`(err) > 예약이면 `예약`; 그 외 배지 없음. 안 읽음 수는 0으로 둬요. 다음 실행 시각이 없으면 막대 대신 `다른 컴퓨터`(개요에서). 열린 항목 상태 확인을 위해 탭 진입 때 `pqOpen()`이 5초 넘게 지났으면 `pqLoad()`로 다시 읽어요. 감시가 이 컴퓨터에도 같은 이름이면 설정은 로컬 우선. 다른 컴퓨터 알림은 감시 소식에 합쳐요(해당 행이 소유한 것 제외). 사라진 감시의 소식은 힌트에서 제외(`monGone`).
- 데이터: `PQ.list`(다른 컴퓨터별 `items`: `monitors`, `integrations`, `notices`, `conversations`), `/api/peer/proxy`, `/api/peer/act`.
- css: web/css/10-conversations.css(`mon-pc`), web/css/11-peers.css는 이 화면 요소에서 확인 못 함.
- 근거: web/js/34-peer-monitoring.js:12-13,170,204-246(`pqMerge`), web/js/30-monitoring.js:21-31(`monItemOf`), :898-901.

### 항목: 카카오톡 (key `i:kakao`, 또는 다른 컴퓨터의 카카오 앱)

- 목적: 카카오톡 방 목록과 대화를 모니터링 항목으로 열어요.
- 구성: 모니터링 렌더가 `kkMode(...)`로 카카오 창을 대신 그리고 머리만 `monHead`예요. 본문 상세 화면은 30-kakao.js 소관이라 여기서는 연결 지점만 적어요.
- 상태: 열릴 때 `.chatbox` 숨김(`#v-monitoring.kk-on`), 머리는 방이 열리면 설정 버튼이 방 머리로 가요(`kkItem(it) && KK.open`이면 `asEntry`를 안 넣어요). 폰에서 방이 열려 있으면 뒤로가기는 `kkBack()`.
- 데이터: 30-kakao.js 소관(코드에서 확인 안 함).
- css: web/css/17-kakao.css(`#v-monitoring.kk-on > .chatbox {display:none}`, `#v-monitoring > .kk` 그리드).
- 근거: web/js/30-kakao.js:9-11(`kkItem`, `kkItemNow`), web/js/30-monitoring.js:1045-1057, :982, :242, web/js/04-state.js:236.

### 열린 항목 머리 (monHead, `#mon-head`)

- 목적: 열린 항목의 이름, 상태, 마지막 소식 시각, 동작을 한 줄(컴팩트)과 그 아래 상태줄로 보여줘요.
- 구성: `.mon-hdwrap` 안 `.mon-hdrow`(아이콘 `.cv-av.nt`, 이름 `.cv-n` + 컴퓨터 이름표, 시각 `.mon-hd-time`, 동작 `.mon-hdacts`), 아래에 상태줄 `.cv-p`(감시/예약이면 대신 `.mon-desc` 설명), 감시/예약이면 진행 블록, 배너.
- 기능: 동작 순서(있는 것만): `대화로 이어가기`, `답장 확인 <n>`(앱에 대기 초안이 있을 때, `rqOpen`), `빠른 처리`(답장 확인 항목에서 대기 초안이 `TR.min` 이상, `trOpen("*")`), `지금 확인`(감시이고 배너가 없을 때), `미답장 <n>`(알약), 앱 설정 진입(`asEntry`). 시각은 감시의 마지막 실행, 아니면 가장 최근 소식이나 메일(`monHeadTime`).
- 상태: 상태줄 `monState`: 앱 꺼짐(peer off) `연결 안 됨`; 감시/예약은 설명만; 답장 확인은 `기다리는 초안 <n>개` 또는 힌트; 감시 소식은 위 표; 앱은 힌트; 그 외 안 읽음이 있으면 `안 읽음 <n>개`, 없으면 `연결돼 있어요`. 폰에서는 이 머리가 보이지 않고(주석: `A phone has no .cv-head`) 같은 내용이 `monTopNodes`의 `.mon-topcard`로 본문 위에 나와요. 앱바 제목은 폰에서 항목 이름(`monName`), 아니면 `모니터링`.
- 데이터: 위 항목들과 같음.
- css: web/css/20-monitoring.css(`mon-hdwrap`, `mon-hdrow`, `mon-hdacts`, `mon-topcard`, `mon-continue`), web/css/17-kakao.css:90(좁은 폭에서 `.kk-head` 숨김).
- 근거: web/js/30-monitoring.js:973-993(`monHead`), :966(`monHeadTime`), :870-879(`monTopNodes`), :243-250(`monState`), :242(`monName`), :882(`monConvBtn`), web/js/31-conversations.js:421-422.

### 연결 배너 (monBannerNode)

- 목적: 연결이 끊겼거나 마지막 확인이 실패한 항목 맨 위에서 한 번에 다시 확인하게 해요.
- 구성: `.mon-banner.down|fail`(role `alert`는 down, `status`는 fail), 새로고침 아이콘, `<b>제목</b> · 이유`, 버튼.
- 기능: 감시이고 `watch` 이름이 있으면 `monRunNow`로 `다시 연결`(끊김) 또는 `지금 다시 확인`(실패); 앱이면 `monRecheckApp`.
- 상태: 제목 `연결이 끊겼어요`(down) 또는 `확인 실패`(fail). down 이유: `<시각>부터`(`monTime`), `다시 로그인 필요` 또는 `확인이 계속 실패해요`. fail 이유: `<n>번 연속 실패했어요`(2번 이상) 또는 `마지막 확인이 실패했어요`, 요약이 있으면 ` · <요약>`. 앱 down 이유는 허브 힌트에서 앞의 `연결 끊김 ·` 말머리를 뗀 나머지(`monHintWhy`). 배너가 있으면 진행 블록의 태그는 감춰요(중복 방지).
- 데이터: `/api/monitors`의 `connection`, `since`, `conn_reason`, `fails`, `last_summary`; `/api/integrations`의 `state`, `hint`.
- css: web/css/20-monitoring.css(`mon-banner`).
- 근거: web/js/30-monitoring.js:941-961,75-79,946-948.

### 진행 막대 (monProgNode, 감시/예약의 다음 확인까지)

- 목적: 마지막 실행에서 다음 실행까지 얼마나 왔는지와 결과 태그를 한 블록으로 보여줘요.
- 구성: `.mon-prog-wrap`(compact 변형) 안 `.mon-prog-top`(막대 `.mon-prog` role progressbar + 태그 `.mon-ptag`) 아래 글줄 `.mon-prog-tx`.
- 기능: 없음(표시용). 1초마다 `monTick`이 막대 폭, aria 값, 글줄, 태그를 직접 고쳐요(재그리기 없음). 화면이나 탭이 숨겨지면 멈춰요.
- 상태: 막대 종류: 기본(진행), `warn`(다음 실행 시각 지남, 100%), `err`(연결 끊김, 100%), `off`(꺼짐, 100% 회색), `run`(지금 확인 중, 35% 폭 반짝임), `none`(다음 실행 없음). 막대 색은 결과: 정상 초록, 바뀜/늦어짐/확인 필요 노랑, 실패/끊김 빨강. 글줄: 평소 `지난 실행 <방금 전|n분 전|n시간 전|n일 전> · 다음 <곧|n분 후...>`, 실행 전이면 `아직 실행 전`, 다음 없음 `예정 없음`, 늦음 `다음 확인이 늦어졌어요`, 확인 중 `지금 확인하고 있어요`; 목록 행(short)은 `<방금 전...> · <곧...>`, `실행 전`, `늦어짐`, `예정 없음`, `확인 중`. 꺼짐이나 끊김이면 글줄 비움. aria-label `<이름> 진행`.
- 데이터: `last_run`, `next_run`, `last_result`, `paused`, `connection`(`/api/monitors`), `MON.running`.
- css: web/css/20-monitoring.css(`mon-prog*`, `mon-ptag`).
- 근거: web/js/30-monitoring.js:60-116(`monRel`, `monProgLine`, `monProgState`, `monProgNode`), :1119-1149(`monTick`, `monTickStart`).

### 소식 카드와 행 (알림 표현 종류)

- 목적: 감시, 예약, 앱의 알림 하나를 상태에 맞는 모양으로 보여줘요.
- 구성(종류): (1) 결과 카드 `monNoticeNode`: 감시 이름, 시각, 결과 태그(`정상`ok, `바뀜`, `실패`err, `주의`, `답변 필요`), 섹션, 원문 접기; 가격 변경 줄은 이전 값 취소선과 새 값 굵게(`nwChangeNode`). (2) 압축 행 `monLogRow`/`monLogLine`: 결과 점, 첫 줄, 둘째 줄, 오른쪽 시각(`방금 전...`, 하루 지나면 날짜), 탭하면 펼침. (3) 접힌 소식 행 `monRowNode`(`.fr`): 출처, 컴퓨터 이름표, 태그, 시각, 두 줄 요약(140자 제한), 답 필요면 `답하러 가기`. (4) 같은 출처 묶음 `monGroupNode`(`.grp`): 건수 `<n>건`(질문이면 `같은 질문 <n>번`), 안 읽음 수, 펼침 화살표, 펼치면 `.fr-list`. (5) 결정 카드 `monDecisionNode`: 제목(없으면 `답변이 필요해요`), 시각, 선택 행(`추천` 태그), 열린 결정은 그 자리에서 `answerInline`, 끝난 결정은 `무시했어요` / `기한 지남` / `답 없이 끝났어요` / `답했어요 · <답>`. (6) 앱 항목 카드 `monItemNode`: 메일을 알림이 가리키면 메일 행처럼, 아니면 제목과 보낸이만 보여주고 점검 원문을 접어 붙여요.
- 기능: 펼쳐서 더 볼 것이 있는 행만 눌려요(`monHasMore`: 요약 두 줄보다 줄이 많거나, 요약이 잘렸거나, 접힌 원문이 있을 때). 볼 것이 없는 행은 단추가 아니고 글을 자르지 않고 다 보여 줘요(`.fr-all`, 확인 기록 줄도 같음). 행 탭 `monToggle`로 펼치기/접기(`접기` 버튼, aria `<출처> 소식 펼치기|접기`), 키보드 Enter/Space, `답하러 가기`(`noticeOpen`), 더 보기 `<n>개 더 보기`(페이지 30), 이전 소식 `이전 소식 <n>개 보기`. 알림에서 점프하면(`MON.want`) 해당 행을 펼치고 페이지를 맞추고 `ntFlash`로 강조(`MON.hl`).
- 상태: 묶음 `monFoldKey`(결과와 요약이 같은 연속 3건 이상), 안 읽음(`.un`), 폰/데스크톱 차이 없음. 한 건짜리 묶음은 그냥 행.
- 데이터: `NT.items`, SSE `notice` / `notice_read` / `notice_dismiss`; 답하기 `ntPost`; 읽음 `pqNoticesRead`, `POST /api/notices/read`.
- css: web/css/20-monitoring.css(`mon-lr`, `mon-log`), web/css/19-volume.css(`fr-*`, `grp`, `mon-more`, `mon-day`, `mon-sh`), web/css/16-result-card.css, web/css/07-chat.css(`dcm`).
- 근거: web/js/30-monitoring.js:271-273(`MON_TONE`, `monTag`), :354(`monDecisionNode`), :370-391(`monNoticeNode`), :374(`monItemNode`), :708(`monRowNode`), :731-750(`monLogLine`, `monLogRow`), :766(`monGroupNode`), :661-677.

### 답장 초안 카드 (draftCardNode, 보내기 승인)

- 목적: 보낼 메일 답장 초안을 보고 승인, 수정, 폐기하게 해요(메일 앱 소식, 메일 대화, 답장 확인 큐에서 같은 카드).
- 구성: 응답 카드(`rqCard`): 머리(앱, 계정, 컴퓨터, 모델, 규칙 태그, 상태 태그 `<상태> · <시각>`, 지우기 `x`), 질문 라벨, 받는이/참조, 제목, 받는 메일 원문 요약, 본문 단락, 첨부 줄, 동작. `bare` 모드는 보낸 초안만(`dr-mail`).
- 기능: `보내기`(경고나 첨부가 있으면 `drfSure` 확인 뒤 `answerInline`), `고치기`(입력 `어떻게 고칠까요?`, 버튼 `고쳐 달라고 하기`, 또는 `직접 수정` 후 `이 내용으로 고치기`, `취소`), `보내지 않기`, 머리의 지우기 버튼(title `지우기 (보내지 않아요)`, aria `초안 지우기`)은 `보내지 않기`와 같아요.
- 상태: `DR_STATE`: `확인 대기`(warn, 대기 초안 카드는 상태 태그가 말하니 같은 뜻의 굵은 제목 줄을 그리지 않아요), `보냄`(ok), `고침`(pri), `고치는 중…`(pri), `보내지 않음`, `보낼 방법 전함`(pri), `만료`, `무시함`. 처리 중(`dcSending`)이면 버튼 비활성. 직접 수정 칸 aria `직접 수정`, 고치기 칸 placeholder는 `DRAFT_HINT`, aria `고칠 내용`, 최대 6000/500자. 입력이 비면 이동 버튼 비활성. 보내기 완료 시 상태 태그 대신 보냄 표시. 사라지는 조건: `보내지 않기` 답, 같은 메일의 더 새 초안, 처리됨(메일 대화 안으로 접힘).
- 데이터: 알림 `decision`(`draft`, `to`, `options`), 답하기 `ntPost`, 메일 `MAILS`.
- css: web/css/15-reply-card.css, web/css/16-result-card.css(`dr-orig`), web/css/15-draft-original.css, web/css/07-chat.css.
- 근거: web/js/30-monitoring.js:277-352(`DR_STATE`, `drState`, `draftCardNode`), :459-485(대기/완료 판정).

### 소식 필터 바 (monBar)

- 목적: 소식이 많을 때 전체, 답 필요, 실패로 좁히고 한꺼번에 읽음 처리해요.
- 구성: `.mr-filter.mon-bar`: 탭 묶음 `.mon-tabs`(role tablist, aria `소식 보기`)와 읽음 처리 버튼.
- 기능: 탭 `전체 / 답 필요 / 실패`(개수 표시, 전환 시 페이지 초기화), `읽음 처리`(`monReadAll`; 답 필요가 아닌 보이는 안 읽은 소식만).
- 상태: 메일 목록이 아니고 소식이 7건 이상이거나 답 필요 또는 안 읽은 실패가 있을 때만 나와요. 버튼 글자 `<n>개 읽음 처리`, 없으면 `읽음 처리`(비활성, title `답이 필요한 것은 그대로 둬요`). 완료 토스트 `<n>개를 읽음으로 표시했어요`, 실패는 되돌리고 오류 토스트.
- 데이터: `POST /api/notices/read`(`{ids}`), 다른 컴퓨터는 `{action:"notice"}`.
- css: web/css/19-volume.css(`mon-bar`, `mon-tabs`), web/css/16-result-card.css(`mr-filter`).
- 근거: web/js/30-monitoring.js:656-660,680-705.

### 앱 설정 패널의 상태 블록 (monStatNode)

- 목적: 앱 설정 화면 안에서 해당 감시나 앱이 소유한 감시의 상태를 보여줘요.
- 구성: `.as-row.as-stat`: 이름, 상태 한 줄(`상태 · 마지막 <시각> · 다음 <시각>`), 부가 줄(연속 실패, 마지막 정상, 마지막 결과), 오류 태그.
- 상태: 시각은 오늘이면 HH:MM, 아니면 `<날짜> HH:MM`. 상태가 err 톤이면 우측 태그. 실행 전은 `아직 실행 전이에요`.
- 데이터: `/api/monitors`.
- css: web/css/18-app-settings.css.
- 근거: web/js/30-monitoring.js:927-935(`monStatMons`, `monStatNode`), :53-55.

### 통합 목록 로더와 미답장 표시 (30-integrations.js)

- 목적: 이 설치에서 켜진 앱(메일, 카카오톡, 인스타그램, 유튜브 등)을 모니터링 목록의 `앱` 그룹으로 공급하고 미답장 알약과 `답장 안 함` 칩을 제공해요.
- 구성: 화면 없음(데이터와 공용 노드 하나). `unrepPill(text="미답장")` = 주황 `.tag.unreplied`.
- 기능: 알림 수나 대화 안 읽음 수, 미답장 메일 수가 바뀌면 300ms 뒤 다시 읽어요(`intgWatch`). 켜 둔 앱의 아이콘 경로는 `ICONS`에 등록. 꺼진 앱의 메일도 보존해서 다른 컴퓨터 복사본에서 쓸 수 있어요(`intgHidden`). `답장 안 함` 탭은 알약과 버튼을 바로 숨기고 `POST <path>` 실패 시 되돌려요.
- 상태: 성공 토스트 `답장 안 함으로 표시했어요`, 실패는 오류 토스트. 불러오기 실패는 조용히 이전 목록 유지.
- 데이터: `GET /api/integrations`(위), `POST <path>`(호출자 지정, 예: 댓글 `/api/comments/comment/<id>/no-reply`).
- css: web/css/02-cards-lists-tags.css, web/css/20-mail-box.css, web/css/18-comments.css, web/css/17-kakao.css, web/css/05-log.css, web/css/01-tokens.css(`unreplied` 계열).
- 근거: web/js/30-integrations.js:5-42.

### 댓글 앱 화면 (유튜브, 인스타그램, 웹사이트 댓글, key `i:youtube|instagram|site[-...]`)

- 목적: 댓글 답글을 켜 둔 앱의 글(게시물) 목록과 글 하나의 댓글 대화를 보여주고, 답글 초안을 승인하게 해요.
- 구성: `#cm.kk.cm` (`#v-monitoring` 끝에 붙음, 카카오 창과 같은 클래스 재사용): 왼쪽 `#cm-rooms.kk-rooms`(aria `댓글을 지켜보는 글`)에 인스타그램 전용 탭 `.cm-tabs`(댓글/DM), `section.kk-watch`(aria `댓글이 있는 글`) 안 라벨 `글`과 글 행 `.cv-row.kk-row`; 오른쪽 `#cm-chat.kk-chat`: `#cm-head.kk-head`, `.kk-box > #cm-tl.kk-tl > #cm-in.kk-in`, `#cm-foot.composer`(항상 숨김, 초안은 댓글 밑에 들어감).
- 기능: 글 행 탭 `cmOpen`; 댓글 탭 `댓글` / `DM` 전환 `cmTab`; 폰에서 뒤로가기 `cmBack`(댓글이면 `cmClose`, DM이면 `dmClose`); 댓글별 `답글 초안`(`cmMakeDraft`, `POST /api/comments/comment/<id>/draft`), `답장 안 함`(`cmNoReply`, `POST /api/comments/comment/<id>/no-reply`); 초안 카드 `보내기` / `고치기` / `보내지 않기`; 실패한 답글 `다시 보내기` / `지우기`; 지우기 토스트의 되돌리기(`cmRestore`, `POST /api/comments/drafts/<code>/restore`, 토스트 `초안을 되돌렸어요`). 글 본문 링크 `영상 열기`(유튜브) / `원본 글 열기`. 자동 읽음 `cmMarkRead`(`POST .../read`, 대화가 보일 때, 마지막 댓글 시각 기준).
- 상태(목록): 아직 안 불러왔으면 목록 비움, 실패 `댓글 목록을 불러오지 못했어요`, 켜 둔 곳 없음 `켜 둔 곳이 없어요. 채팅에서 댓글 답글을 켜 달라고 요청해 주세요`, 켜 둔 곳은 있는데 댓글 없음 `아직 받은 댓글이 없어요` + 버튼 `지켜볼 글 고르기`. 글 행: 썸네일(없거나 실패하면 제목 이니셜), 제목, `<마지막 작성자>: <마지막 댓글>`, 오른쪽 위 시각, 오른쪽 아래 표식 하나(`cmMark`, 가장 급한 것만: 실패 `실패 <n>`(빨간 점 + 글자, aria `메일 실패 <n>건`) > 미답장 `미답장 <n>` 알약 > 초안 `초안 <n>` 알약(aria `답장 확인 <n>건`), 없으면 비움). 글 줄은 두 줄이고 안 읽음 숫자와 메일 보냄/초안/실패 줄은 없어요(안 읽은 글은 제목이 진해요, 댓글별 상태는 열린 글의 진행 트랙이 말해요). 줄의 미답장 합은 앱 머리의 `미답장` 수와 같아요. 시각은 목록 갱신 시 자리에서 만 바뀜.
- 상태(댓글 대화): 열린 글 없음 `글을 골라 주세요`, 로딩 `불러오는 중…`, 실패 `<오류 또는 댓글을 불러오지 못했어요>`. 댓글 행(`.cm-c`): 작성자(내 댓글이면 `나` 또는 `나 · 내 답글`), 시각, 미답장 알약, 답글이면 `↳ <부모 작성자>`(중첩 시 생략), 본문, 진행 트랙, 동작. `답글 초안`(답이 필요하고 초안 없을 때; 만드는 중에는 비활성 `초안 만드는 중…`, 2분 뒤 초안이 안 오면 토스트 `초안이 아직 오지 않았어요`), `답장 안 함`(미답장일 때). 날짜 구분선 `kk-date`. 진행 트랙(`cmFlow`, 답글이면 `답글`, 메일이 따라가면 `메일`): 답글 단계 `초안`, `확인 대기`(ask), `보내는 중`(busy), `보냄` / `보냄 · 자동`, `실패[ · 이유]`(err), `답글 보냄`(플랫폼에서 직접 답한 경우), `초안 만드는 중`, `초안 필요`(ask), `확인`, `보냄`; 메일 단계 `초안`, `답글과 함께 보내요`, `보냄`, 실패 라벨(`메일 초안 작성됨` 등 허브 라벨). 답글 전송 기록 말풍선(`cmSendNode`): `보내는 중` / `보냄`(2분 동안만) / `실패[ · 이유]`+`다시 보내기`+`지우기`. 초안 카드(`cmDraftCard`): 라벨 `답글 초안`, 받는이 `댓글 <작성자>`, 메일이 따라가면 `보내기를 누르면 답글을 올린 뒤 메일을 보내요`, 고치기에서 고칠 곳 선택 `답글` / `메일`(aria `고칠 곳`), 보내는 중이면 `보내기` 비활성. 지우기 후 토스트는 되돌리기 제공(메일이 따라간 초안은 제외). 소스 행이 읽지 못했을 때 `읽지 못했어요 · <오류>`.
- 상태(실시간, 다른 컴퓨터): SSE `comment`, `comment_draft`, `comment_send`, `comment_sources`로 즉시 갱신; 초안 실패 시 오류 토스트, 답글은 올렸지만 메일 실패 `답글은 올렸지만 메일은 보내지 못했어요: <이유|알 수 없는 이유>`. 다른 컴퓨터의 댓글 앱이면(`p:<url>|i:<인스턴스>~<해시>`) 모든 호출이 `cmApi`를 거쳐 그 컴퓨터로 가고(`GET` = `/api/peer/proxy`, 변경 = `/api/peer/act`) SSE가 아니라 15초마다 다시 읽어요(이 컴퓨터는 60초마다 폴백). 화면이 다시 보일 때도 즉시 다시 읽어요(`visibilitychange`).
- 상태(폰/데스크톱): `.cm-post`(글 카드: 썸네일, 제목, 원본 링크)는 대화 맨 위에 그려지는데 1100px 이상에서는 숨김(18-comments.css:35, 머리가 대신 보이기 때문). 1099px 이하에서 머리 `.kk-head`는 숨김(17-kakao.css:90). 639px 이하 여백 조정 18-comments.css:25.
- 데이터: `GET /api/comments/sources`, `PUT /api/comments/sources/<key>` (`{watch, autoDraft, autoMail}`), `GET /api/comments/sources/<key>/posts`, `GET /api/comments/threads?app=<앱>`, `GET /api/comments/thread/<source>/<thread>`(응답 `{thread, source, comments, drafts, sends, read}`), `POST .../read`, `POST /api/comments/comment/<id>/draft`, `.../no-reply`, `POST /api/comments/drafts/<code>/send|revise|drop|restore`, `POST /api/comments/sends/<id>/retry|dismiss`. SSE `comment`, `comment_draft`, `comment_send`, `comment_sources`(99-boot.js:52).
- css: web/css/18-comments.css(`cm-*`, `kk-pick`), web/css/17-kakao.css(`kk-*`), web/css/15-reply-card.css(`rq-*`), web/css/15-draft-original.css, web/css/01-tokens.css.
- 근거: web/js/30-monitoring-comments.js:6-36(상태와 요소), :15-20(`cmAppOf`), :60(`cmLoad`), :132-146(글 행), :155-165(탭), :166(`cmPaintRooms`), :191(`cmOpen`), :218(`cmMarkRead`), :232-253(`cmFlow`, `cmProgress`), :262(`cmCommentNode`), :280(`cmSendNode`), :287(`cmPaintChat`), :312(`cmThreadNodes`), :342(`cmMakeDraft`), :354(`cmDraftCard`), :379(`cmLive`), :393(`cmMode`), web/js/30-monitoring.js:1046-1048(연결), web/js/99-boot.js:52.

### 지켜볼 글 고르기 (댓글 소스 시트)

- 목적: 어느 소스의 어떤 글을 지켜볼지, 자동 초안과 메일을 켜고 끌 수 있어요.
- 구성: `dialog#cm-pick.kk-pd.kk-add`(aria `지켜볼 글`, 제목 `지켜볼 글`, 닫기 버튼 aria `닫기`), 안내 `자동 초안은 새 댓글마다 답글 초안을 만들어서 토큰이 들어요.`, 소스마다 스위치 3개(`<라벨> 전부 지켜보기`, `자동 초안`, `파일 요청 메일 초안`)와 누르는 줄 `지켜볼 글 고르기`(오른쪽 화살표), 글별 스위치 목록(`data-post`).
- 기능: 열기 `cmPickOpen(app)`(앱 설정 행 `asPickRow` 또는 빈 목록의 `지켜볼 글 고르기`; 제목은 `지켜볼 대화방`과 같은 `fsHead`의 `h2.fs-t`, `지켜볼 글 고르기`는 설정 화면의 누르는 줄 `button.li.tap`과 화살표), 스위치는 `PUT /api/comments/sources/<key>` (`cmUpdate`), 글 목록 `cmPosts`로 한 번만 `GET .../posts`. 배경 탭이나 닫기로 닫아요.
- 상태: 소스 없음 `켜 둔 곳이 없어요. 채팅에서 댓글 답글을 켜 달라고 요청해 주세요`, 글 목록 로딩 `불러오는 중…`, 글 목록 오류는 그 메시지, 소스 오류 `읽지 못했어요 · <오류>`. 스위치 변경 실패는 오류 토스트 후 소스 다시 읽음. 전부 지켜보기가 켜져 있으면 글별 스위치는 같이 켜집니다. 폰(639px 이하)에서는 시트가 전체 폭.
- 데이터: 위 댓글 소스 API.
- css: web/css/18-comments.css(`kk-pick*`), web/css/17-kakao.css(`kk-pd`, :270-271 폰 전체 폭, 데스크톱 오른쪽 시트).
- 근거: web/js/30-monitoring-comments.js:76-131(`cmUpdate`, `cmPosts`, `cmSourceNode`, `cmPickPaint`, `cmPickOpen`).

### 인스타그램 DM (댓글 앱 `instagram`의 DM 탭, 읽기만)

- 목적: 받은 인스타그램 DM 대화와 메시지를 읽기만 해요(답장 없음, 작성창 없음).
- 구성: 댓글 패널과 같은 `#cm-rooms`, `#cm-head`, `#cm-in`에 그려요. 목록: (댓글과 DM 둘 다 쓸 때) `.cm-tabs`, `.dm-bar`(안내 `여기서는 DM에 답장할 수 없어요` + 버튼 `#dm-refresh`), `section.kk-watch`(aria `DM 대화`) 안 라벨 `대화`와 대화 행. 대화: 머리(아바타, 상대 이름 한 줄; 제목줄도 상대 이름), 날짜 구분선, 메시지들(카카오톡 방의 `kkMsgNode`로 그린 `.kk-m` 말풍선: 내 것은 오른쪽, 상대 것은 왼쪽, 시각은 묶음 끝), 맨 아래 작성창 자리에 한 줄 `#dm-ro.kk-ro` `여기서는 DM에 답장할 수 없어요`.
- 기능: 대화 행 탭 `dmOpen`; `새로고침`(`dmRefresh`, `POST /api/ig-dm/refresh`로 한 번 가져온 뒤 목록을 다시 읽음; 바뀐 대화만 가져옴); 폰에서 뒤로가기 `dmClose`.
- 상태: 새로고침 중 버튼 `불러오는 중…`(비활성), 평소 `새로고침`. 권한 없음(`perm: "missing"`)이면 허브가 준 `line` 문구(`#dm-perm`), 읽기 실패 `DM 목록을 불러오지 못했어요`(목록) / `DM을 불러오지 못했어요`(새로고침 오류 기본) 또는 서버 메시지, 대화 없음 `아직 받은 DM이 없어요`(`#dm-empty`, 권한 문제가 아닐 때). 대화 했 없음 `대화를 골라 주세요`, 로딩 `불러오는 중…`, 실패 메시지, 메시지 0개 `메시지가 없어요`. 본문 없을 때: 사진 `(사진)`, 동영상 `(동영상)`, 음성 `(음성 메시지)`, 파일 `(파일)`, 아무것도 없으면 `(내용 없음)`. DM 탭 자체는 DM이 켜져 있고 연결되어 있고 댓글도 지켜보는 소스가 있을 때만 보여요(`cmHasTabs`); 댓글 소스가 없고 DM만 있으면 열자마자 DM 탭으로 시작하고 탭 표시는 없어요. 다른 컴퓨터의 댓글 앱에서는 DM 탭이 없고 댓글만 보여요.
- 데이터: `GET /api/ig-dm`(`{on, connected, perm, line, convs:[{id, peer, last, lastAt}]}`), `POST /api/ig-dm/refresh`, `GET /api/ig-dm/<id>`(`{peer, messages:[{id, mine, text, attach, at}]}`).
- css: web/css/20-monitoring.css(`dm-*`), web/css/18-comments.css(`dm-*`), web/css/17-kakao.css(`kk-*`).
- 근거: web/js/30-monitoring-comments-dm.js:5-100(`DM`, `dmLoadList`, `dmRefresh`, `dmRow`, `dmPaintRooms`, `dmOpen`, `dmReload`, `dmClose`, `dmAsKk`, `dmPaintChat`), web/js/30-monitoring-comments.js:154-165(`cmHasTabs`, `cmTabs`, `cmTab`), :403(DM만 있을 때 기본 탭).

### 메일함 목록 도구줄 (선택 막대, 별표, 체크박스)
- 목적: 모니터링의 메일 목록 위에서 여러 메일을 골라 읽음, 보관, 삭제, 답장 안 함으로 한 번에 처리해요.
- 구성: `#mbox-bar.mbox-bar`(모두 선택 체크박스 `.mbox-all`, 개수 `.mbox-n`, 동작 버튼 `.mbox-b`, 선택 해제 `.mbox-x`). 각 메일 행 머리에 `.mr-lead`(체크박스 `.mr-chk` + 별표 `.mr-star`). 목록 머리(자리 탭 줄 `.mr-place`와 `받은 메일`의 걸러 보기 줄 `.mr-filter.mr-mail`, role=tablist, aria-label `메일 보기`)는 30-monitoring-mail.js의 `mailFilterBar`가 두 줄로 그리고 이 파일은 막대만 그려요.
- 기능:
  - 행 체크박스 켜기/끄기: `mbLead` onchange가 `MBOX.sel`을 바꾸고 막대만 다시 그려요(`mbPaintBar`).
  - 모두 선택: `mbPaintBar`의 `.mbox-all` onchange(전체 선택/해제, 일부만 고르면 indeterminate).
  - 선택 동작 4개: `읽음으로 표시`(짧은 글 `읽음`), `안 읽음으로 표시`(`안 읽음`), `완료(보관)`(`보관`) 또는 보관함 보기에서는 `받은편지함으로`, `삭제`. 처리는 `mbRun`, 삭제는 `mbTrash`.
  - `답장 안 함`: 고른 메일 중 답장이 필요한 것이 있을 때만 삭제 앞에 나와요(`mbFyi`). 일부만 해당하면 `답장 안 함 N`처럼 개수를 붙여요.
  - `이 목록 전부 답장 안 함`: 아무것도 안 골랐고 필터가 `owed`(답장 필요)이고 목록이 비어 있지 않을 때만 나와요(`mbFyi(MBOX.vis)`).
  - 별표: `mbStar`가 `mbRun([t], star|unstar, quiet)`. 항상 버튼이고 메일함이 거부하면 허브 한 줄 메시지가 토스트로 와요.
  - `선택 해제` X 버튼.
- 상태:
  - 선택 0개: 막대는 `메일 N개`(목록 개수, 0이면 빈 글) 표시, `.on` 클래스 없음. 목록에 메일 행이 없으면(확인 대기, 빈 폴더) 막대 자체를 그리지 않아요(`mbList`).
  - 선택 1개 이상: `N개 선택`(aria-live polite), 막대에 `.on`.
  - `삭제하면 원본도 삭제`가 켜진 앱의 메일(`trashOriginal`)은 되돌리기 대신 확인 창이 떠요: `이 메일을 삭제할까요? 원본도 메일함 휴지통으로 옮겨요`, 여러 건이면 `메일 N개를 삭제할까요? 원본도 메일함 휴지통으로 옮겨요`. 원본을 지우지 못한 메일은 목록에 남고 토스트에 `다시 시도`가 붙어요.
  - 별표 상태: on이면 aria-label/title `별표 빼기`, 아니면 `별표 달기`, `aria-pressed`.
  - 행 선택 시 `.mr-sel` 클래스.
  - 안 읽음 판단(`mailUnread`): 카드에 `read` 불리언이 있으면 그 값, 없으면 dotz 자체 읽음 위치(`ts(t).unread`). 보낸 메일(`dir:"out"`)은 안 읽음이 아니에요.
  - 필터 정의(`MAIL_FILTERS`, 30-monitoring.js:456): `전체`(받은 메일, 보관 제외), `안 읽음`, `답장 필요`(reply가 needs 또는 draft), `확인 대기`(메일 행 없음, 답장 초안 승인 카드만), `답장함`, `보관함`, `보낸 메일`. 일곱 값은 그대로이고, 보관함·보낸 메일은 자리 탭(`data-filter="archived"`/`"sent"`)이 고르며 받은 메일 탭은 `data-filter="in"`이에요(`MON.mailIn`이 직전 걸러 보기).
  - 새 메일 도착 행은 위에서 미끄러져 들어와요(`mbFresh`/`motionIn`, 첫 그림이나 다른 폴더 전환은 움직임 없음). 처리로 목록에서 빠지는 행은 먼저 사라져요(`mbRowsOut`/`motionOut`). 개수 배지는 바뀐 숫자만 굴러요(`cntSpan`/`rollCount`).
- 데이터: `POST /api/mail/<key>/action {action}`(1건, 응답 `{ok, synced, note?}`), `POST /api/mail/actions {keys, action}`(여러 건, 응답 `{ok, results:[{key, ok, synced, note?}]}`), action은 read, unread, archive, unarchive, trash, star, unstar. 옛 허브(카드에 `can` 없음)는 삭제만 `DELETE /api/mail/<key>`. 처리 뒤 `convLoad()`와 `loadIntegrations()`. SSE 이벤트는 이 파일에서 코드에서 확인 못 함.
- 근거: web/js/30-mail-box.js:191 `mbPaintBar`, :220 `mbList`, :176 `mbStar`, :183 `mbLead`, :73 `mbRun`, :58 `mbApply`, :51 `mbRowsOut`, :43 `mbFresh`; 호출처 web/js/30-monitoring.js:858, :456.
- css: web/css/20-mail-box.css (`.mbox-*`, `.mr-star`, `.mr-lead`), 필터 줄은 web/css/15-reply-card.css 쪽 `.mr-filter` 계열과 20-monitoring.css도 같이 쓴다는 점은 코드에서 확인 못 함(rq grep 결과에 20-monitoring.css 포함). 폭 분기: 20-mail-box.css `@media (max-width: 639px)` (:101, :124, :130), `@media (min-width: 1100px)` (:180).

### 메일 처리 동작 (삭제 되돌리기, 낙관적 반영, 답장 안 함)
- 목적: 메일 동작을 즉시 화면에 반영하고, 허브가 거부하면 되돌려요.
- 구성: 토스트(`toast`) 한 줄과 선택 버튼(되돌리기), 확인 상자(`ask`).
- 기능:
  - `mbRun(keys, action, quiet, note)`: 바로 화면 반영 후 API 호출, 실패 항목만 원복(`mbApply`가 되돌리는 함수를 돌려줘요).
  - `mbTrash(keys)`: 메일함이 삭제를 따라주면(모든 키가 `can`에 trash) 먼저 목록에서 빼고 6초(`MB_UNDO_MS`) 안에 `되돌리기`를 누를 수 있고, 시간이 끝나거나 `pagehide`면 실제 삭제를 보내요. 따라주지 않거나 옛 허브면 확인 상자가 먼저 떠요.
  - `mbFyi(keys, on)`: 답장 안 함 표시 또는 `되돌리기`(답장 필요로). 컴퓨터별로 묶어 `POST /api/mail/fyi {keys,on}`(다른 컴퓨터 메일은 `/api/peer/act` action fyi). 5개 초과(`MB_FYI_ASK`)면 먼저 확인.
  - `mbLeave`: 열려 있던 메일이 사라지면 모니터링 목록으로 돌아가요.
- 상태(정확한 문구):
  - 완료 토스트(`MB_DONE`): `읽음으로 표시했어요`, `안 읽음으로 표시했어요`, `보관했어요`, `받은편지함으로 옮겼어요`, `삭제했어요`, `별표를 달았어요`, `별표를 뺐어요`. 여러 건이면 `N개를 ...`. 메일함에 닿지 않는 소스(웹메일, 플러그인이 지원하지 않는 소스)도 서버가 `{ok: true, synced: false}`만 돌려줘서 같은 토스트가 떠요. `dotz에서만 바뀌어요` 같은 안내는 없어요. 메일함 호출이 실제로 실패하면(`FAILED`) 그 `note`는 그대로 토스트로 보여요. 읽음/안 읽음/보관/받은편지함에는 `되돌리기` 버튼(별표와 삭제는 없음).
  - 실패: 허브 `note`가 있으면 그 글, 없으면 `처리하지 못했어요`. 서버가 모르는 경로(HTTP 404)면 `서버가 아직 이 작업을 지원하지 않아요`.
  - 삭제 취소 토스트: `삭제했어요` 또는 `N개를 삭제했어요` + `되돌리기`. 실제 삭제가 일부 실패하면 `처리하지 못했어요`.
  - 삭제 확인 상자: 제목 `메일 삭제`, 본문 `이 메일을 목록에서 지워요. 메일함에는 그대로 남아 있어요.`(여러 건은 `메일 N개를 목록에서 지워요. 메일함에는 남아 있을 수 있어요.`: 메일함이 지울 수 있는 것은 지워지니까요. 뒷문장은 `mailStays` 한 곳), 버튼 `삭제`.
  - 답장 안 함 확인 상자: 제목 `답장 안 함`, 본문 `메일 N개를 답장 안 함으로 표시할까요? 메일을 보내지는 않아요`, 버튼 `N개 표시`.
  - 답장 안 함 결과: `답장 안 함으로 표시했어요`/`답장 필요로 표시했어요`(여러 건은 `N개를 `), 일부 실패 `N개 중 M개는 표시하지 못했어요`, 전부 실패 시 오류 글 또는 `표시하지 못했어요`.
  - 공통 낙관적 반영: 실패 시 `read/archived/starred/reply` 값과 `ts(t).unread`를 되돌려요.
- 데이터: 위 막대 항목과 같음. 추가로 `/api/mail/fyi`, `/api/peer/act`(args `{action:"fyi"}`), 후속 `convLoad`, `pqLoad`, `loadIntegrations`, `loadNotices`.
- 근거: web/js/30-mail-box.js:73 `mbRun`, :108 `mbTrash`, :139 `mbFyi`, :169 `mbLeave`, :69 `MB_DONE`, :19 `MB_NOTE`.
- css: 토스트와 확인 상자는 이 범위 밖 공용 컴포넌트(스타일 위치는 코드에서 확인 못 함).

### 열린 메일 상단 도구줄 (mtop)
- 목적: 메일 대화 화면 맨 위에서 열린 메일의 동작을 전부 한 줄 아이콘으로 해요. 동작마다 한 번씩이고 ⋯ 메뉴는 없어요.
- 구성: `.mtop`(role=toolbar, aria-label `메일 처리`) 안에 아이콘 버튼 `.ib.mtop-b`: 보관(또는 받은편지함으로), 삭제, 읽음/안 읽음, 답장, 전체답장, 전달(`.mbox-mode`), 초안 작성(`mailDraftButton`, 받은 메일만), 답장 안 함/답장 필요로 표시(`mailFyiBtn`, 받은 메일만), 원문 보기/접기(`mailRawBtn`). 호출처 web/js/11-todo-strip.js:241(카드 앞에 prepend). 돌아가기는 앱바의 `#back`이 맡아요. 폰에서는 아홉 개가 `.ib` 터치 크기 36px로 들어가요.
- 기능:
  - 보관/받은편지함으로: 보관된 메일이면 `받은편지함으로`(unarchive), 아니면 `보관`(archive). `mbRun`.
  - `삭제`: `mbTrash([t])`.
  - `읽음으로 표시`(unread 상태일 때, 아이콘 mailopen) 또는 `안 읽음으로 표시`(읽은 상태일 때). 보낸 메일(`dir:"out"`)은 이 버튼 없음.
  - 보관/삭제/안 읽음 성공 뒤 열린 메일이면 목록으로 돌아가요(읽음은 그대로).
  - `답장`/`전체답장`/`전달`: `mbOpenReply(t, mode)` 후 답장 칸으로 스크롤.
  - `답장 안 함`/`답장 필요로 표시`: 답장이 남았으면 앞의 것, 아니면 뒤의 것이고 누른 뒤 바로 바뀌어요. `mailSetFyi`.
  - `원문 보기`/`원문 접기`: 원문 카드(`.rc-raw`)가 있을 때만 있고, 열린 메일의 `.rc-raw` 머리는 숨겨요.
  - 목록에서만 지우는 삭제(`mailDelete`)는 목록 행의 ⋯에 있어요.
- 상태: 버튼은 `busy()` 동안 진행 표시. 메일함이 동작을 따라주지 않아도 평소 완료 토스트만 떠요(`dotz에서만 바뀌어요` 꼬리 없음, 실제 동기화 실패 `note`만 예외). 열린 메일이 이미 사라지면 `monCtx`면 모니터링 목록으로. 보낸 메일이면 읽음 토글과 초안 작성 없음. phone/desktop 분기는 이 도구줄에는 코드에서 확인 못 함(아이콘만 있음).
- 데이터: 위 `mbRun`/`mbTrash` API와 같음.
- 근거: web/js/30-mail-box.js:232 `mailOpenBar`, :231 `mbIco`, :244 모드 버튼; web/js/11-todo-strip.js:238-242.
- css: web/css/20-mail-box.css (`.mtop`, `.mtop-b`; 폭 분기 `@media (max-width: 639px)` :34는 `.tl-in > .bm.rc.mopen`).

### 메일 쓰기 시트 (새 메일 초안)
- 목적: 새 메일의 받는 사람, 제목, 본문, 첨부를 적어 초안을 만들어요. 메일을 직접 보내지는 않아요.
- 구성: 모니터링 목록의 떠 있는 버튼 `.mbox-fab`(`메일 쓰기`, `data-k=mail-compose`, 호출 `mbFab`), 시트 `.mbox-sheet`(role=dialog, aria-label `새 메일`): 머리 `.mbox-sh`(제목 `새 메일`, `최소화`, `닫기`), 본문 `.mbox-sb`(`mbForm`: 받는 사람, 참조, 제목, 내용, 첨부 칩), 하단 `.mbox-sf`(`초안 만들기` `data-k=mail-compose-save`, 클립 `파일 붙이기`).
- 기능:
  - `mbCompose(init)`: 이미 열려 있으면 최소화를 풀고 받는 사람에 포커스.
  - 폼(`mbForm`): 입력은 상태 객체에 바로 써요. 받는 사람 placeholder `쉼표로 여러 명`, 참조 줄은 숨김이다가 `참조` 버튼으로 열림, 제목 placeholder `제목`, 내용 placeholder `내용`(기본 7행, 시트는 10행). 파일 선택 시 `uploadFile`로 올리고 칩에 이름과 크기, `×`(aria-label `<이름> 빼기`)로 제거.
  - `초안 만들기`: `mbSave`가 `POST /api/mail/compose`.
  - `닫기`: 내용이 있으면 확인 상자.
- 상태:
  - 받는 사람 비어 있음: 토스트 `받는 사람을 적어 주세요`.
  - 업로드 중 저장 시도: 토스트 `파일을 올리는 중이에요`. 업로드 중 칩은 `.wait`에 `올리는 중…`. 업로드 실패는 토스트(서버 메시지 또는 `올리지 못했어요`).
  - 저장 성공: 토스트 `초안을 만들었어요 · 승인 카드에서 보내요`, 알림 새로 읽고(`loadNotices`) 시트가 아래로 사라짐.
  - 저장 실패: 404면 `서버가 아직 새 메일 초안을 지원하지 않아요`, 아니면 서버 메시지 또는 `초안을 만들지 못했어요`. 저장 중 버튼은 `busy`.
  - 닫기 확인: 제목 `작성 중인 메일`, 본문 `쓰던 내용을 버릴까요?`, 버튼 `버리기`.
  - 최소화: `.min` 클래스, 머리만 남음. 접힌 동안 단추는 펼침 화살표와 `펼치기`(aria-label과 title)이고, 열리면 `최소화`예요(`mbFold`). 아래 탭 줄이 아래에 있으면 접힌 막대는 그 바로 위에 앉아요(`--mbox-lift`, `#nav` 위쪽을 재서 정해요). 실패 시 첨부 칩과 입력은 상태 객체에 남아요.
  - phone vs desktop: 데스크톱은 오른쪽 아래 도킹(최소화/닫기), 폰(639px 이하)은 전체 화면 시트(`inset:0`), FAB은 56px 원형이고 글자 `.mbox-fab-t`는 숨김, 위치 `bottom: calc(72px + env(safe-area-inset-bottom))`.
- 데이터: `POST /api/mail/compose {to, cc, subject, body, attachments:[{name,path,size}], (reply_to, mode)}`, 파일 업로드 `uploadFile`(경로는 이 범위에서 코드에서 확인 못 함).
- 근거: web/js/30-mail-box.js:250 `mbFab`, :303 `mbCompose`, :260 `mbForm`, :291 `mbSave`, :253 `mbChips`.
- css: web/css/20-mail-box.css (`.mbox-fab` :66, `.mbox-sheet` :73-75, 폰 :101-103, :70).

### 메일 인라인 답장 칸 (답장 / 전체답장 / 전달)
- 목적: 열린 메일 맨 아래에서 답장 초안을 만들어요(보내기는 승인 카드에서).
- 구성: `section.mbox-reply`(aria-label `답장 쓰기`, `.open`), 모드 칩 `.cchip.mbox-mode`(답장, 전체답장, 전달), 폼(`mbForm`), `이전 메일` 접이식 인용(`details.mbox-quote`, `pre.mbox-qt`), 하단 `초안 만들기`(`data-k=mail-reply-save`), 클립 `파일 붙이기`, `접기`.
- 기능: `mbOpenReply(t, mode)`가 받는 사람, 참조, 제목을 채워요(`mbDefaults`). 제목은 `Re: `/`Fwd: `(이미 있으면 안 붙임). 전체답장은 원래 받는 사람과 참조를 참조로 넣어요. 전달은 본문에 `---------- 전달한 메일 ----------`, `보낸 사람:`, `제목:`과 원문을 넣어요. 모드 칩 전환은 본문과 첨부는 유지. `mbReplyPaint`가 슬롯을 그려요. `접기`는 칸만 접고 내용은 남아요.
- 상태: 닫혀 있으면 슬롯은 비어 있고 숨김. 메일 대화가 아니거나 메일 헤더(`.mhd-wrap`)가 없으면 슬롯 제거. 내용 placeholder `답장 내용`(6행). 저장 성공 시 그 메일의 답장 상자 상태를 지움. 오류 문구는 `mbSave`와 동일.
- 데이터: `POST /api/mail/compose` 에 `reply_to: <key>`, `mode: reply|all|forward` 추가.
- 근거: web/js/30-mail-box.js:327 `MB_MODES`, :331 `mbDefaults`, :343 `mbBox`, :348 `mbOpenReply`, :357 `mbReplyPaint`; 호출 web/js/31-conversations.js:397.
- css: web/css/20-mail-box.css (`.mbox-reply`, `.mbox-modes`, `.mbox-quote`; 폭 분기 :101, :124, :130).

### 메일 사람 헤더 (보낸 사람 / 받는 사람 / 참조)
- 목적: 메일 대화 카드에서 누가 보내고 누가 받는지 한 줄로 보여주고 펼쳐요.
- 구성: `.mhd-wrap` 안에 `.mhd-line`(토글 `.mhd-tog` + 같은 사람 메일 칩), 숨김 `.mhd`(role=group, aria-label `보낸 사람과 받는 사람`; 줄 `보낸 사람`, `받는 사람`, 있으면 `참조`).
- 기능: `mailMetaNode(t, e)`; 토글 클릭으로 `.mhd`를 열고 닫음(`aria-expanded`). 주소 목록 `mailAddrNode`: 2명까지 보이고 `외 N명` 버튼으로 전체를 펼치고 `접기`로 다시 접어요.
- 상태: 받는 사람 한 줄 요약은 `받는 사람 A, B 외 N명 · 참조 ...`, 둘 다 없으면 `보낸 사람과 받는 사람`. 토글 title `보낸 사람·받는 사람 자세히`. 사람이 없는 줄은 그리지 않고, 셋 다 없으면 원문 보기에 상자도 없어요. 본문 머리에 있는 To/Cc가 추출값에 없으면 합쳐요(`mailPeople`). 이름만 있고 주소가 없는 항목도 이름으로 표시.
- 데이터: MAILS 맵(`GET /api/conversations` 의 mail 카드)과 메시지 `e`. 별도 API 없음.
- 근거: web/js/30-mail-thread.js:149 `mailMetaNode`, :69 `mailHeadNode`, :39 `mailAddrNode`, :17 `mailAddrList`, :60 `mailPeople`, 목록 한 줄 버전 :77 `mailToText`.
- css: web/css/20-mail-thread.css.

### 같은 사람과 주고받은 메일 (스레드 패널 / 폰 목록)
- 목적: 같은 상대와 주고받은 다른 메일로 빠르게 이동해요.
- 구성: 넓은 화면(>=1024px) `aside#mail-thread.mth`(aria-label `같은 사람과 주고받은 메일`; 머리 `.mth-h` = `이 사람과 주고받은 메일` + 개수 `.mth-n` + 접기 X `.mth-x`; 목록 `ol.mth-list`). 폰과 좁은 창: 헤더 줄 끝의 칩 `.mth-mb`(메일 아이콘 + 개수 + 화살표, `data-k=mail-thread-toggle`)가 헤더 아래 `ol.mth-list`를 펼쳐요. 각 행 `.mth-row`: 상태 태그, 시각(`rcWhen`), 제목, 요약.
- 기능: `mailThreadToggle()`이 패널을 열고 닫고 `localStorage dz-mth-open`에 저장(`mailThreadSync`로 제자리 갱신). 칩: 넓은 화면이면 패널 토글, 좁으면 목록 펼침/접힘. 행 클릭: `mailThreadOpen(k)`(모니터링 맥락이면 `go("monitoring", "c:<t>")`, 아니면 `go("chat", t)`). 현재 열린 행은 `.on`, `aria-current=true`, 클릭 불가.
- 상태: 관련 메일이 2개 미만이면 칩과 패널 모두 없음. 패널은 기본 접힘이고 선택은 세션 사이에 유지. `#v-chat`에 `.mail-open`(관련 메일 있음)과 `.mail-thr`(패널 열림) 클래스. 최대 20개(`MT_MAX`), 최신순. 제목이 없으면 `(제목 없음)`. 태그는 모니터링 행과 같은 상태 태그이고 미답장이면 채워진 미답장 알약(`unrepPill`). 칩 이름/aria-label `이 사람과 주고받은 메일 N`. 상대 판정: 받은 메일은 보낸 사람, 보낸 메일(`dir:"out"`)은 받는 사람 주소(`mailPeers`).
- 데이터: MAILS 맵만 사용(`GET /api/conversations`), 별도 라우트 없음. 갱신 호출: web/js/05-command-palette.js:154, web/js/11-todo-strip.js:242.
- 근거: web/js/30-mail-thread.js:89 `mailRelated`, :110 `mailThreadRows`, :124 `mailThreadMobile`, :141 `mailThreadToggle`, :166 `mailThreadSync`, :105 `mailThreadOpen`.
- css: web/css/20-mail-thread.css. 폭 분기: `@media (max-width: 1023px)` :50, `@media (min-width: 1024px)` :56 (JS도 `matchMedia("(min-width: 1024px)")`).

### 보낸 답장 / 처리된 답장 초안 (메일 대화 안, 접힌 줄)
- 목적: 이미 처리된 답장 초안(보냄, 만료, 무시, 고침)을 그 메일 아래 접힌 한 줄로 모아요.
- 구성: `.ms-slot`(role=group, aria-label `처리된 답장 초안`)이 메일 카드 바로 아래. 초안이 2개 이상이면 머리 `.ms-hd`(`처리된 초안 N개` + `모두 지우기` `data-k=ms-clear`). 각 `.ms-card`: 접힌 줄 `.ms-line`(아이콘, `<라벨> · <시각>`, `<받는이 라벨> <주소>`, 화살표), 펼치면 `.ms-body`(초안 카드 `draftCardNode(n,{bare:true})` + `지우기` `.ms-rm`).
- 기능: 줄 클릭으로 펼침/접힘(`MS.open`). `지우기`(`mailSentRemove`): 카드가 사라지고 `POST /api/notices/<id>/dismiss`(다른 컴퓨터는 `pqNotice` op dismiss). `모두 지우기`(`mailSentClear`): 전부 같은 방식으로 지움. 지운 것은 이 컴퓨터에서만 숨김이고 메일을 보내지는 않아요.
- 상태: 라벨(`MS_LABEL`) `보낸 답장`, `만료된 초안`, `무시한 초안`, `고친 초안`, 그 외 `처리된 초안`. 받는이 라벨이 없으면 `받는이`, 주소 없으면 `-`. 보낸 것은 send 아이콘, 나머지는 mail 아이콘. 표시 대상: 보낸 초안 전부와 보내지 않은 것 중 최신(대기 중이거나 버린 것은 제외). 다른 컴퓨터 메일은 그 컴퓨터 스냅샷(`PQ.list`)에서 읽어요. 지우기 중 버튼 disabled. 성공 `초안을 지웠어요`(모두 지우기는 `초안 N개를 지웠어요`), 실패 시 되돌리고 `지우지 못했어요`(서버 메시지가 있으면 그 글), 일부 실패 `N개 중 M개를 지우지 못했어요`. 응답 `ok` 거짓이면 `지우지 못했어요`.
- 데이터: `POST /api/notices/<id>/dismiss`(응답 `unread` 숫자 반영), `/api/peer/act` action notice op dismiss. 알림 목록 `NT.items`, 다른 컴퓨터 `PQ.list`. SSE 이벤트는 코드에서 확인 못 함(`convPaint`가 알림/스냅샷 변경마다 호출한다고 주석에 있음).
- 근거: web/js/30-mail-sent.js:68 `mailSentPaint`, :57 `mailSentNode`, :18 `mailSentList`, :27 `mailSentRemove`, :50 `mailSentClear`; 호출 web/js/31-conversations.js:396.
- css: web/css/16-result-card.css:228-232 (`.ms-slot`, `.ms-card`, `.ms-line`), web/css/01-tokens.css:118.

### 답장 확인 목록 (모니터링 > 답장 확인)
- 목적: 모든 앱과 모든 컴퓨터에서 `보내기`를 기다리는 답장 초안을 한 목록에서 처리해요.
- 구성: 모니터링 목록의 행 `답장 확인`(아이콘 send, 안 읽음 수 = 대기 건수, 힌트). 화면은 선택된 앱이 있을 때만 필터 줄 `.mr-filter.rq-filter`(role=tablist, aria-label `앱별 답장`; 칩 `전체`와 앱별 칩 + 개수), 앱(메일, 카카오톡, 댓글 등)별 소제목 `.mon-sec`(role=heading level 3), 카드 목록 `.rq-q`(카드는 10-reply-card.js `rqCard`).
- 기능:
  - 카드 `열기`(`rqGoTo`): 메일 초안이면 `go("monitoring","c:<mail key>")`, 아니면 앱 화면(`i:<앱>` 또는 `p:<pc url>|i:<앱>`).
  - 알림 초안 동작(`rqNoticeActs`): `보내기`(첨부나 경고가 있으면 `drfSure` 확인 후 `answerInline`), `고치기`, `보내지 않기`.
  - 저장소 초안(카카오톡/댓글) 동작(`rqStoreActs`): 보내기, 고치기, 보내지 않기, `rqStoreCall`이 해당 컴퓨터로 보내요.
  - 고치기 입력(`rqRevise`): 고쳐 달라는 말을 적어 보냄, 취소 가능.
  - 보내지 않기 후 `되돌리기`(`rqRestore`).
  - 앱 행의 `답장 확인` 버튼은 `rqOpen(inst, pc)`로 그 앱만 필터해 열어요.
- 상태:
  - 빈 목록: `확인할 답장이 없어요`, 아직 안 불러왔으면 `불러오는 중…`.
  - 행 힌트: 대기 있으면 `<앱들> 답장 N건`(앱 이름 최대 3개를 ` · `로 이음), 없으면 `확인할 답장이 없어요`. 대기가 없으면 열려 있을 때만 행이 보여요.
  - 카드 busy: 동작 중이면 카드 `.busy`(투명도 낮춤, 중복 실행 막음).
  - 보낸 저장소 초안은 보내기 영역이 `보냈어요`(`rqSentNode`)로 바뀌고, 목록을 다시 열 때까지 카드가 남아요.
  - 에러 토스트: 네트워크 오류는 `연결이 끊겨 처리하지 못했어요`, 그 외 서버 메시지. 고치기 성공 `고쳐 달라고 했어요. 새 초안이 오면 여기 다시 떠요`. 복구 `초안을 되돌렸어요`. 보내지 않기 `보내지 않았어요`(+ 되돌리기, 댓글에 딸린 메일 초안이면 되돌리기 없음).
  - 다른 컴퓨터 변형: 소제목과 칩에 ` · <컴퓨터 이름>`이 붙고 동작은 `/api/peer/act`로 그 컴퓨터에서 실행. 카드 머리에 컴퓨터 이름.
  - 카카오톡 초안이 새 메시지 의도면 카드 라벨 `새 메시지 초안`. 수신 표기 `대화방`, 댓글은 `댓글`, 메일 초안은 `받는이`.
  - 원문 표시: 메일 초안은 보낸 사람과 제목, 저장소 초안은 `original`.
  - 목록은 `rqSig()`가 바뀔 때만 다시 그려요(고치기 입력 중 타이핑은 다시 그리지 않음).
  - 폰/터치(`pointer: coarse` 또는 639px 이하): 카드 패딩 축소, 작은 버튼 터치 영역 확대.
- 데이터: `GET /api/replies`(응답 `items`, `rqLoad`), 다른 컴퓨터 스냅샷 `PQ.list[].items.replies/notices/integrations`, 알림 `NT`, `INTG.items`. 저장소 초안 동작: `POST /api/kakao/drafts/<code>/<op>`, `POST /api/kakao/chat/<chatId>/draft`(revise), `POST /api/comments/drafts/<code>/<op>`, `POST /api/comments/drafts/<code>/revise`, 다른 컴퓨터 `POST /api/peer/act`(action kakao 또는 comments). 알림 초안 응답 `answerInline`/`ntPost`(경로는 이 범위 밖). SSE 이벤트는 코드에서 확인 못 함. `rqSoon`이 400ms 지연 재조회.
- 근거: web/js/30-replies.js:34 `rqAll`, :56 `rqMonItem`, :64 `rqOpen`, :130 `rqCardOf`, :158 `rqFilterBar`, :165 `rqNodes`, :174 `rqSig`, :10 `rqLoad`, :68 `rqRun`, :93 `rqStoreActs`, :106 `rqNoticeActs`, :114 `rqRevise`, :152 `rqGoTo`; 카드는 web/js/10-reply-card.js:90 `rqCard`, :103 `rqSentNode`, :106 `rqDroppedToast`.
- css: web/css/15-reply-card.css (`.rq-q` :44, `.rq-filter` :47, `.rq-sent` :38, 폰 :49, :63), 필터 칩 `.mr-filter`/`.cchip`는 20-monitoring.css 등 공용.

### 빠른 처리 배너 (#trban)
- 목적: 한 곳에 답장 승인 카드가 많이 쌓이면 빠른 처리로 들어가는 입구를 보여줘요.
- 구성: 화면 위쪽의 `button#trban.trban`(web/index.html:92, 기본 hidden). 안에 목록 아이콘, 글 `.tx`, `.go` 글 `빠르게 처리`.
- 기능: 클릭하면 `trOpen("*")`(모든 그룹의 카드를 한 번에 훑는 검토 큐). 같은 입구가 모니터링 답장 확인 머리의 버튼 `빠른 처리`(`data-k=triage`, 대기 총합이 `TR.min` 이상일 때만, web/js/30-monitoring.js:981)로도 있어요. 승인 카드를 열 때 그 카드가 속한 그룹이 충분히 크면 한 장짜리 시트 대신 빠른 처리가 열려요(web/js/30-notices.js:407 `trGroupFor`).
- 상태: 대기 합계가 `TR.min`(서버 `triageMin`, 기본 3) 미만이거나 빠른 처리 창이 열려 있으면 숨김. 글: 그룹이 여러 곳이면 `답장 대기 N건 · M곳`, 한 곳이면 `<그룹 라벨> 대기 N건`. 새로 읽기 실패 시 이전 화면을 유지하고 다음 알림 이벤트 때 다시 시도해요.
- 데이터: `GET /api/approvals`(응답 `groups[]`, `triageMin`, `results[]`). SSE: `notice` 이벤트 시 `trSoon()`(300ms 지연 재조회), `approvals` 이벤트 시 `trSoon()`, `approval_send` 이벤트 시 `trLive(e)`(web/js/99-boot.js:46-48).
- 근거: web/js/30-triage.js:12 `trLoad`, :32 `trBanner`, :24 `trBig`, :30 `trGroupFor`.
- css: web/css/15-triage.css:4 (`.trban`), web/css/01-tokens.css:134, :203(좁은 화면에서 grid 위치 해제). 폭 분기: 15-triage.css `@media (max-width: 639px)`에서 `.trban` 너비 `calc(100% - 24px)`.

### 빠른 처리 한 장씩 보기 (전체화면 시트)
- 목적: 카드 한 장씩 초안을 확인하고 보내기, 고치기, 보내지 않기로 바로 넘겨요.
- 구성: `fsOpen({label: "<라벨> 빠른 처리", cls: "tall tr"})` 시트. 머리(`fsHead`): 작은 글 `<라벨> · 빠른 처리`, 제목 `.tr-pos`(`i/N` + ` · 처리 N건`), 진행 막대 `.tr-bar`(role=progressbar, aria-label `처리한 카드`), 오른쪽에 `목록` 토글 `.tr-tog`. 본문 `.tr-body`: 질문 줄 `.tr-q`(질문 + 진행 칩), 결정 노드 `decideNode`, 메타 `.tr-meta`(받는이 라벨/주소, `제목`, `규칙: ...`, `봇이 보내요`), 원문 블록(`.tr-org`), 안내 목록 `.tr-info`, 경고 `.tr-warn`, 라벨 `보낼 글`(메일 동반이면 `답글`)과 `textarea.tr-ta`, 첨부 `.tr-files`, 동반 메일 `.tr-mail`. 발 `.tr-ft`: 버튼 줄 `.tr-acts`, 힌트, 이전/다음 `.tr-nav`, 단축키 안내 `.tr-keys`.
- 기능:
  - `보내기`(`trAnswer(c,1)`): 고친 글을 먼저 저장(`trSaveEdits`) 후 `POST /api/approvals`. 글이 바뀌었으면 버튼 글이 `고쳐서 보내기`로 바뀜(`trSendLabel`).
  - `고치기 …`(`TR.noting`): 고칠 내용 입력 칸이 열리고 `고쳐 달라고 하기`(`trEditSubmit`, n=2)와 `취소`.
  - `보내지 않기`(n=3).
  - `‹ 이전` `다음 ›`(`trStep`, 답하지 않고 보기만; 마지막을 넘으면 요약 화면).
  - 단축키(`trKey`, 시트가 맨 위일 때만): Enter 또는 1 보내기, 2 또는 E 고치기, 3 또는 X 보내지 않기, ← → 또는 K J 이전/다음, L 목록 전환, Ctrl/Cmd+Enter는 목록에서 `trSendPicked`, 고치기 입력 중 `trEditSubmit`, 아니면 보내기. 글자 입력 중에는 무시.
  - 답하면 바로 다음 안 한 카드로 넘어가고(`trNext`) 요청은 뒤에서 실행.
  - 원문 `trOriginal`: `GET /api/drafts/<ref>/original`로 지연 로드.
- 상태(정확한 문구):
  - 질문이 없으면 `이대로 보낼까요?`. 안내 힌트 `보내거나 보내지 않으면 다음 초안으로 넘어가요.`. 단축키 줄 `Enter·1 보내기 · 2·E 고치기 · 3·X 보내지 않기 · ← → 이전·다음 · L 목록`.
  - 진행 칩(`TR_ST`): `보내지 않았어요`, `보낼 차례를 기다려요`, `보내는 중…`, `보냈어요`, `보내지 못했어요`, `봇이 보내요`, `봇이 고치는 중이에요`, `다른 곳에서 처리됐어요`, `답을 보내지 못했어요`. 처리한 카드는 본문 textarea와 버튼이 disabled(오류 `err` 상태는 다시 시도 가능).
  - 오류: 카드에 `답을 보내지 못했어요: <서버 글>`(`.tr-warn`)과 토스트 `<질문 또는 카드>: <서버 글>`.
  - 고치기 빈 입력: 토스트 `무엇을 고칠지 적어 주세요`. 고치기 placeholder `어떻게 고칠까요? 봇이 고쳐서 다시 물어봐요`, aria-label `어떻게 고칠지`.
  - 원문 로딩 `원문을 불러오는 중…`(`.tr-org.muted`), 불러오기 실패면 원문 블록 없음. 메일 원문 머리 `받은 메일`(본문 600자까지), 댓글이면 `원댓글`(2000자). 댓글 초안이면 `답하는 댓글` 블록(게시물, 작성자, KST 시각, 메일 연동 표시 `.tag[data-mail]`).
  - 동반 메일: 라벨 `함께 보낼 메일`, `받는이`, `제목`, aria-label `함께 보낼 메일 본문`. 글 칸 aria-label `보낼 글`.
  - 카드가 다른 곳(다른 창, 디스코드, 봇)에서 처리되면 진행 중 목록에서 빠짐. 새 카드는 끝에 붙음(`trMerge`). 처리할 카드가 없으면 시트를 안 열고 토스트 `처리할 카드가 없어요`.
  - 폰(639px 이하): 시트 전체 너비/높이, 버튼 높이 44px, 질문 17px. 터치(`pointer: coarse`)와 폰에서는 단축키 안내 `.tr-keys` 숨김.
- 데이터: `POST /api/approvals {items:[{ref, to, n, note?}]}`(n 1 보내기, 2 고치기, 3 보내지 않기), `POST /api/drafts/<ref>/body {text, part?:"mail"}`, `GET /api/drafts/<ref>/original`. SSE `approval_send`로 카드별 진행(`TR.results[ref]`)이 칩에 반영돼요.
- 근거: web/js/30-triage.js:42 `trOpen`, :167 `trPaint`, :204 `trOneView`, :117 `trAnswer`, :137 `trKey`, :160 `trEditSubmit`, :73 `trState`, :83 `trChip`, :87 `trLive`, :182 `trOriginal`, :194 `trCommentCtx`.
- css: web/css/15-triage.css (`.tr-*`), 폭 분기 :68-76, 터치 :77.

### 빠른 처리 목록 보기 (여러 장 한꺼번에)
- 목적: 모든 카드의 초안을 한 화면에서 훑고 카드마다 보내기, 고치기, 건너뛰기를 골라 한 번에 보내요.
- 구성: 머리 제목 `목록 N건`, 토글 글 `한 장씩`. 본문 `.tr-list`의 각 `.tr-row`: 머리 버튼 `.tr-rh`(번호, `<받는이> · <질문>`, 칩), 초안 `.tr-rb`(눌러서 전체 보기, title `눌러서 전체 보기`), 동반 메일 `.tr-rb.mail`(`함께 보낼 메일 → <받는이> · <제목>`), 선택 막대 `.tr-seg`(role=radiogroup, aria-label `N번 카드`; 버튼 `보내기` `고치기` `건너뛰기`, role=radio), 고치기 선택 시 입력 `.tr-rn`(placeholder `어떻게 고칠까요?`, aria-label `N번 고칠 내용`). 발: `확인한 것 보내기` `.tr-batch` + 안내 `카드마다 보내기·고치기·건너뛰기를 골라요. 고르지 않은 카드는 그대로 남아요`.
- 기능: 행 머리 클릭은 그 카드의 한 장씩 보기로 이동. 선택 기본값은 건너뛰기(3). `확인한 것 보내기`(`trSendPicked`)는 보내기로 고른 것과, 고치기로 고르고 내용을 적은 것만 한 번에 `POST /api/approvals`. L 키로 목록 전환.
- 상태: 고른 것이 없으면 `확인한 것 보내기` disabled, 있으면 `확인한 것 보내기 (N)`(입력 중에도 `trListCount`로 갱신). 보내기로 고른 행은 초안이 펼쳐짐. 처리된 행은 `.locked`로 선택 막대 없음. 결과 토스트 `N건 답했어요`(+ ` · M건 보내는 중`), 실패 시 모든 선택 카드에 `err` 표시와 토스트 `보내지 못했어요: <서버 글>`. 목록에서는 한 장씩 단축키가 꺼져요.
- 데이터: 위와 같음.
- 근거: web/js/30-triage.js:253 `trListView`, :267 `trListCount`, :275 `trSendPicked`.
- css: web/css/15-triage.css (`.tr-list`, `.tr-row`, `.tr-seg`, `.tr-sg`); 폰에서 `.tr-sg` min-height 44px, `.tr-list .tr-seg` stretch.

### 빠른 처리 마무리 화면
- 목적: 끝까지 본 결과를 요약해요.
- 구성: `.tr-empty` 본문(`.tr-done-t` 제목, 요약 목록 `.tr-sumlist`: 줄 라벨 + `N건`), 발에 버튼.
- 기능: `건너뛴 것 다시 보기`(건너뛴 카드가 있을 때만, 첫 건너뛴 카드로 이동), `닫기`.
- 상태: 제목은 건너뛴 카드가 있으면 `끝까지 봤어요`, 없으면 `모두 답했어요`. 요약 줄(0건은 숨김): `보냈어요`, `보내지 않았어요`, `보내는 중`, `보내지 못했어요`, `봇이 고치거나 보내요`, `건너뛰었어요`.
- 데이터: 로컬 상태 `TR.done`, `TR.results`(SSE `approval_send`).
- 근거: web/js/30-triage.js:241 `trDoneView`.
- css: web/css/15-triage.css (`.tr-sumlist`, `.tr-done-t`).

### 카카오톡 화면 (모니터링 > 카카오톡 앱 패널)
- 목적: 지켜볼 대화방을 고르고, 방마다 카카오톡 같은 대화 화면과 답장 초안 카드를 한 패널에서 써요.
- 구성: `#kk.kk`(`#v-monitoring` 안, 평소 hidden)가 왼쪽 방 열 `#kk-rooms`(aria-label `카카오톡 대화방`)와 오른쪽 대화 `#kk-chat`로 나뉘어요. 대화 안은 위에서 아래로 `#kk-head`(방 머리), `#kk-owed`(상태 줄: 왼쪽 미답장, 오른쪽 자동 초안 `#kk-auto`), `.kk-box`(`#kk-tl` 타임라인 + `#kk-pill`, 남은 높이를 채우고 안에서 스크롤), `#kk-ro`(읽기 전용 막대), `#kk-foot`(초안 카드 `#kk-drafts`, 그 밑에 요청 입력줄).
- 기능: `kkMode(item, shown, pc)`(web/js/30-monitoring.js가 호출)가 패널을 켜고 끄고 `#v-monitoring`에 `kk-on` 클래스를 줘요. 패널이 보이면 방 목록을 읽고 60초마다 다시 맞춰요(`kkResync`). 다른 컴퓨터 패널이면 2초마다 `kkPeerPoll`.
- 상태:
  - 넓은 화면(>=1100px)은 방 열 옆에 대화가 같이 보이고, 그보다 좁으면(`narrowChat()` = max-width 1099px) 두 화면으로 나뉘어 `KK.open`에 따라 `.chat-open`이 바뀌고 앱바의 뒤로 화살표(`kkBack`)가 방 목록으로 돌아가요.
  - 다른 컴퓨터 변형: `KK.pc`가 있으면 모든 GET이 `pqLink`/`/api/peer/proxy`를 거치고, 컴퓨터를 바꾸면 패널을 비우고 처음부터 시작해요.
  - 미답장 알약과 자동 초안 스위치는 폭과 관계없이 머리 밑 `#kk-owed` 한 줄에 있어요. 초안이 없고 답장이 남았을 때만 알약 옆에 `답장 안 함`이 있고, 초안이 있으면 그 카드의 `답장 안 함`이 대신해요.
- 데이터: 아래 하위 화면 항목 참고. SSE는 `kakao`, `kakao_send`, `kakao_draft`, `kakao_rooms`, `kakao_unreplied`, `kakao_read`(web/js/99-boot.js -> `kkLive`).
- 근거: web/js/30-kakao.js:433-465 (요소 조립), :1173 `kkMode`, :604 `kkPaintAll`, :766 `kkBack`.
- css: web/css/17-kakao.css (주 파일), 일부 web/css/07-chat.css, 15-reply-card.css, 15-draft-original.css, 18-app-settings.css, 18-comments.css, 01-tokens.css가 `kk-` 클래스를 같이 써요. 폭 분기: 17-kakao.css `@media (max-width: 1099px)` :11, `(min-width: 1100px)` :15, :56, `(max-width: 1099px)` :90, :92, `(max-width: 639px)` :127, :145, :39-40, :271, `(min-width: 640px)` :270, `(pointer: coarse), (max-width: 639px)` :39, `prefers-reduced-motion` :85, :198.

### 카카오톡 방 목록 (지켜보는 대화방)
- 목적: 지켜보기로 한 방을 최근 순으로 나열하고, 안 읽음과 미답장을 보여줘요.
- 구성: `#kk-rooms` 안에 (있으면) 감시 상태 `section.kk-own`(aria-label `감시 상태`, `monStatNode`), 머리 `.kk-lh`(보기 알약 `.kk-views .mr-f`: `전체`·`안 읽음`·`미답장`과 개수, 방이 없으면 `지켜보는 대화방`; 버튼 `#kk-add-btn` `추가`), 목록 `section.pl-list.kk-watch`(aria-label `지켜보는 대화방`). 행 `button.cv-row.kk-row`: 아바타(이름 첫 글자, 이름으로 색), 이름, 단체/오픈채팅 표시 `.kk-grp`(`단체` 또는 `오픈채팅`), 한 줄 힌트, 오른쪽에 시각 `.kk-t`, 미답장 알약(`unrepPill`), 안 읽음 배지 `.nb.warn`.
- 기능: 행 클릭 `kkOpen(chatId)`. `추가` 버튼 `kkAddOpen()`. 방 목록은 `kkPaintRooms`가 그리고 스크롤 위치를 유지해요.
- 상태(정확한 문구):
  - 불러오는 중: `불러오는 중…`
  - 연동 꺼짐(`r.on === false`): `카카오톡 연동이 꺼져 있어요`
  - 서버가 준 오류 문자열(`r.error`)이 있으면 그 글을 그대로 보여줘요. 불러오기 실패는 `대화방 목록을 불러오지 못했어요`.
  - 지켜보는 방이 없고 고를 방이 있으면 `지켜볼 대화방을 추가해 주세요`(`#kk-empty`), 고를 방 자체가 없으면 `고를 수 있는 대화방이 없어요`.
  - 정상일 때만 개수와 `추가` 버튼이 보여요(`추가`는 방이 1개 이상일 때).
  - 행: 열려 있는 방은 `.on`과 `aria-current=true`, 안 읽은 방은 `.unread`. 안 읽음 배지 aria-label `읽지 않은 메시지 N개`(99 초과는 `99+`). 시각은 오늘이면 시:분, 어제는 `어제`, 올해는 `M월 D일`, 이전 해는 `YYYY.M.D`(`kkListTime`).
  - 힌트 줄: 서버 hint, 없고 단체/오픈이 아니면 종류 글(`단체 대화방`, `1:1 대화`, `오픈채팅`). 32자 넘으면 말줄임.
  - 방 목록 갱신: 열린 방에 새 메시지가 붙으면 그 행의 힌트, 시각, 안 읽음을 같이 갱신. 다른 방에 새 메시지가 오면 `GET /api/kakao/rooms/<id>/latest`로 그 행만 갱신(실패하면 전체 다시 읽기).
- 데이터: `GET /api/kakao/rooms`(응답 `on`, `error`, `rooms[]`: chatId, name, kind, watched, autoDraft, unread, unreplied, hint, lastAt), `GET /api/kakao/rooms/<chatId>/latest`, `PUT /api/kakao/rooms/<chatId>`. 후속 `loadIntegrations`(500ms 지연, `kkIntgSoon`). SSE `kakao_rooms`, `kakao_unreplied`는 방 목록 전체 재조회, `kakao`는 위 latest.
- 근거: web/js/30-kakao.js:580 `kkPaintRooms`, :570 `kkRow`, :505 `kkLoadRooms`, :413-418 `kkKindLine`/`kkTag`/`kkSubLine`, :27 `kkListTime`, :1118 `kkRoomLatest`.
- css: web/css/17-kakao.css (`.kk-rooms`, `.kk-row`, `.kk-lh`; 데스크톱 아바타 32px는 :56).

### 지켜볼 대화방 추가 대화상자
- 목적: 모든 방 중에서 지켜볼 방을 눌러 추가하거나 빼요.
- 구성: `dialog#kk-add.kk-pd.kk-add`(aria-label `지켜볼 대화방`): 머리 `fsHead`(제목 `지켜볼 대화방`, 부제 `누르면 추가되고, 다시 누르면 빠져요`, 닫기), 검색 입력 `#kk-q`(type=search, placeholder `대화방 검색`, aria-label `대화방 검색`), 목록 `#kk-pl.pl-list.kk-pl`.
- 기능: 행(`button.pl-row.kk-pr`, role=checkbox, aria-checked) 클릭이 `kkSetRoom(r, {watched: !r.watched})`. 지켜보는 행은 `.on`과 체크 아이콘. 검색은 이름 부분 일치(대소문자 무시)이고 자음만 입력하면 초성 일치(`kkMatch`). 입력해도 목록만 다시 그려 입력 포커스와 IME를 유지해요. 배경 클릭으로 닫기.
- 상태: 검색 결과가 없으면 `찾는 대화방이 없어요`(`#kk-nomatch`). 낙관적 반영 후 PUT 실패 시 값을 되돌리고 서버 메시지 토스트. 방을 지켜보지 않기로 하면 `autoDraft`도 꺼져요. 폰/터치(`pointer: coarse` 또는 639px 이하): 검색 입력 높이 40px, 글자 16px, 안전 영역 패딩(17-kakao.css:39-40).
- 데이터: `PUT /api/kakao/rooms/<chatId> {watched?, autoDraft?}`.
- 근거: web/js/30-kakao.js:558 `kkAddOpen`, :550 `kkPickRow`, :554 `kkPickRows`, :525 `kkSetRoom`, :545 `kkSearch`, :422 `kkMatch`.
- css: web/css/17-kakao.css (`.kk-pd`, `.kk-add`, `.kk-pr`; :39-40, :270-271).

### 카카오톡 방 대화 화면 (머리, 읽기 전용, 자동 초안)
- 목적: 고른 방의 메시지를 읽고 방 설정을 해요.
- 구성: 방 머리 `#kk-head`(아바타, 이름, 종류 글, 앱 설정 진입 `asEntry(app)`), 상태 줄 `#kk-owed`(왼쪽 `.kk-owed-l`: 미답장 알약 + 초안이 없을 때만 `답장 안 함` 칩, 오른쪽 `#kk-auto`: 글자 `자동 초안`과 스위치 `button.kk-sw` role=switch aria-label `자동 초안`, 둘레 카드 없음), 읽기 전용 막대 `#kk-ro`.
- 기능:
  - `답장 안 함`(`kkNoReply`, 상태 줄): 알약이 바로 사라지고 `POST /api/kakao/chat/<id>/no-reply`. 성공 토스트 `답장 안 함으로 표시했어요`, 실패하면 알약 복귀와 서버 메시지 토스트.
  - 자동 초안 스위치: `kkSetRoom(r, {autoDraft: !r.autoDraft})`. 지켜보는 방에서만 보여요.
  - `감시 시작`(`data-k=watch`): 지켜보지 않는 방을 읽기 전용으로 열었을 때 `kkSetRoom(room,{watched:true})`.
  - `kkClose`: 방 닫기(방이 목록에서 사라지면 자동).
- 상태(정확한 문구):
  - 방을 안 골랐을 때 본문 `대화방을 골라 주세요`.
  - 로딩 `불러오는 중…`, 로딩 실패 `.kk-note` role=status에 서버 글, 없으면 `대화를 불러오지 못했어요`. 로딩 중이나 오류 중에는 아래 입력줄 숨김.
  - 지켜보지 않는 방: 입력줄 숨기고 `감시하지 않는 방이에요. 읽기만 할 수 있어요` + `감시 시작` 버튼(role=status).
  - 방 머리 종류 글: `단체 대화방`, `1:1 대화`, `오픈채팅`.
  - 메시지가 없으면 `아직 받은 메시지가 없어요`.
  - 맨 아래가 아니면 새 메시지 알림 버튼 `#kk-pill` `새 메시지`(클릭 시 맨 아래로).
  - 방을 열면 마지막으로 쓰던 입력 내용을 방별로 복원(`KK.typed`).
- 데이터: 방 열기 `GET /api/kakao/chat/<id>?limit=50`(응답 room, messages, read, drafts, sends, ask, kakaoUnread). `POST /api/kakao/chat/<id>/read {logId}`(맨 아래 도달 + 화면이 보이는 동안만, 성공 시 방 안 읽음 0). 갱신 `kkTail`(`?after=<마지막 logId>` 반복, 이어 최신 페이지 병합). SSE `kakao`(열린 방이면 `kkTail`), `kakao_read`(`kkReads`: `GET /api/kakao/chat/<id>/reads?from=<첫 logId>`로 읽음 숫자만 갱신).
- 근거: web/js/30-kakao.js:608 `kkPaintChat`, :736 `kkOpen`, :760 `kkClose`, :638 `kkNoReply`, :454 `kkPaintAuto`, :633 `kkWatching`, :808 `kkTail`, :854 `kkMaybeRead`, :867 `kkReads`.
- css: web/css/17-kakao.css (`.kk-head`, `.kk-owed`, `.kk-auto`, `.kk-ro`, `.kk-sw`, `#kk-chat .kk-drafts`); 좁은 폭에서 머리 숨김.

### 카카오톡 타임라인과 말풍선
- 목적: 카카오톡처럼 날짜 구분, 보낸 사람 묶음, 읽지 않은 사람 수와 함께 메시지를 그려요.
- 구성: `#kk-in` 안 위에서 아래로: (더 있으면) `#kk-top` 버튼 `이전 메시지 더 보기`, 날짜 줄 `.kk-date`, 읽은 위치 줄 `.kk-new`, 메시지 `.kk-m.in`/`.kk-m.me`(아바타, 이름 `.kk-name`, 말풍선 `.kk-bub`, 시간 `.kk-time`, 노란 숫자 `.kk-rd`), 시스템 줄 `.kk-sys`, 빈틈 줄 `.kk-gap`, 전송 중 메시지 `.kk-m.me.pend`.
- 기능:
  - 위로 스크롤하면 맨 위 `#kk-top`이 보일 때 자동으로 이전 페이지(`kkOlder`, IntersectionObserver), 버튼은 대체 수단. 읽던 위치는 유지.
  - 보낸 사람 아바타나 이름 클릭은 `kkPerson(authorId)`(사용자별 분석).
  - 주소(URL)는 링크, 최대 3개의 미리보기 카드를 화면 근처에서 지연 로드(`kkLpLoad`).
  - 답장 인용 클릭은 원래 메시지로 점프(`kkJump`).
  - `사이 메시지 불러오기`(`data-k=gap`, `kkFillGap`).
- 상태(정확한 문구):
  - 날짜 줄: `오늘`, `어제`, 그 외 `YYYY년 M월 D일 요일`.
  - 읽은 위치 줄: `여기까지 읽었어요`(aria-label `여기부터 읽지 않은 메시지`). 방은 항상 최신 메시지 위치에서 열려요.
  - 읽지 않은 사람 수: 0보다 크면 숫자만, aria-label `아직 안 읽은 사람 N명`. 시간은 같은 분의 묶음 마지막 메시지에만.
  - 그룹/오픈채팅 방에서만 상대 아바타를 표시(같은 사람 연속이면 첫 줄에만, 나머지는 빈 칸). 보낸 사람 이름이 없으면 `알 수 없음`.
  - 일반 텍스트가 아닌 메시지 자리표시(`KK_TYPE`): `(사진)`, `(동영상)`, `(음성 메시지)`, `(이모티콘)`, `(파일)`, `(위치)`, 그 외 `(지원하지 않는 메시지)`. JSON 기록 문자열은 절대 그대로 보이지 않음. 시스템 줄 글: `가려진 메시지예요`, `<이름>님이 들어왔어요`, `<이름>님이 나갔어요`, `<이름>님을 내보냈어요`(그 외 기록은 그리지 않음).
  - 미디어 만료: `기간이 지나 볼 수 없어요`(`KK_GONE`).
  - 링크 미리보기: 로딩 중 자리 글 `링크 미리보기`, 실패하면 카드가 사라지고 링크만 남음.
  - 전송 중 메시지(`kkSendNode`): `보내는 중`, 성공 `보냄`(이후 `보냈어요` 칩 `rqSentNode`), 실패 `실패 · <사유>`(role=alert) + 버튼 `다시 보내기`(`kkRetry`), `지우기`(`kkDeleteSend`). 방에 실제 메시지로 나타나면 대기 항목은 사라지고, 보냄 상태는 2분 뒤 사라짐.
  - 원래 메시지 이동: 못 찾으면 토스트 `원래 메시지를 찾지 못했어요 · 대화에서 지워졌거나 아주 오래된 메시지예요`, 찾는 동안 인용 버튼에 `찾는 중…`. 이동하면 `원래 메시지` 라벨로 3.2초 강조하고 12초 동안 `답장으로 돌아가기` 알약(`data-k=kk-back-reply`).
- 데이터: `GET /api/kakao/chat/<id>?limit=50&before=<logId>`(이전), `&after=<logId>`(이후/빈틈), `&around=<logId>`(점프), `GET /api/link-preview?url=`(응답 ok, image, site, title, description), 미디어 `/api/kakao/media/<chatId>/<logId>?i=<n>&v=thumb|full`, 파일 `.../file`(둘 다 `pqLink`로 다른 컴퓨터 대응).
- 근거: web/js/30-kakao.js:685 `kkTimeline`, :652 `kkMsgNode`, :706 `kkPaintTl`, :773 `kkOlder`, :667 `kkPending`, :677 `kkSendNode`, :231 `kkJump`, :270 `kkMergeGap`, :283 `kkFillGap`, :295 `kkGapNode`, :96 `kkLpLoad`, :50 `kkBody`, :61 `kkSysText`.
- css: web/css/17-kakao.css (`.kk-m`, `.kk-bub`, `.kk-date`, `.kk-new`, `.kk-lp`, `.kk-gap`); 폰 말풍선 최대폭 `--kk-maxw: 200px`(:145).

### 카카오톡 미디어 말풍선과 사진·동영상 뷰어
- 목적: 사진, 동영상, 음성, 파일, 이모티콘, 답장 인용, 위치 메시지를 종류별로 그려요.
- 구성/기능:
  - 사진(`kkPhotoNode`): 1장은 비율 유지 썸네일, 2장 이상은 앨범 격자(5장 이상 3열, 최대 6칸, 넘치면 마지막 칸에 `+N`). 클릭하면 뷰어.
  - 동영상(`kkVideoNode`): 썸네일 + 재생 표시 + 길이(`m:ss`), aria-label `동영상 재생`.
  - 음성(`kkVoiceNode`): `audio controls`(preload none) + 길이.
  - 파일(`kkFileNode`): 아이콘, 파일명, 크기(B, KB, MB), PC에 있으면 `열기`(다운로드 링크), 없으면 `PC에 없음`, 만료면 `기간이 지나 볼 수 없어요`.
  - 이모티콘(`kkEmoticonNode`): 이미지, 없거나 못 불러오면 이름 칩(`이모티콘` 또는 alt), 함께 쓴 글은 아래 말풍선.
  - 답장(`kkReplyNode`): `<보낸 사람>에게 답장`(없으면 `답장`) + 원문 일부, 원문 id가 있으면 `원문 보기` 점프 버튼(없으면 disabled), 아래에 답장 본문.
  - 위치(`kkLocationNode`): `위치: <이름>` + `지도에서 보기`, 링크 `https://map.kakao.com/link/map/...`(새 탭).
  - 뷰어(`kkViewer`): `dialog.lbox.kk-vwd`, aria-label `사진 보기`/`동영상 보기`, 제목 `사진 i / N`, `사진`, `동영상`, 버튼 `이전 사진`, `다음 사진`, `닫기`, 키보드 ← →, 배경 클릭으로 닫기.
- 상태: 미디어 만료(`md.expired`)면 `기간이 지나 볼 수 없어요` 카드. 이미지 로딩 실패면 그 칸에 같은 글(동영상 썸네일 실패는 글 없이 조용히 `.gone`). 뷰어 안 로딩 실패는 `p.tv-st`(role=status)에 같은 글. 폰(639px 이하)에서 스티커 100px(17-kakao.css:127).
- 데이터: 미디어 URL은 서버가 내려주지 않고 `/api/kakao/media/<chatId>/<logId>?i=&v=`로 바이트를 가져와요(위 참고).
- 근거: web/js/30-kakao.js:126-345 (`kkMediaNode` :311, `kkViewer` :324, `kkReplyNode` :200).
- css: web/css/17-kakao.css (`.kk-media`, `.kk-album`, `.kk-photo`, `.kk-play`, `.kk-sticker`, `.kk-quote`); 뷰어는 공용 `.lbox`(15-attachments.js 쪽 lightbox, 스타일 위치는 코드에서 확인 못 함).

### 카카오톡 사용자별 분석 패널
- 목적: 한 사람의 활동 통계와 요약 분석을 방 안에서 봐요.
- 구성: `dialog.kk-pd`(aria-label `<이름> 사용자별 분석`, data-uid): 머리(아바타, 이름, 부제 `사용자별 분석`, 닫기), 본문 `.kk-pd-b`: 섹션 `메시지`(`이 방 N개 · 지켜보는 방 N개 (M곳)`), `기간`, `답장 (N일)`(`상대 → 나 ..` ` · ` `나 → 상대 ..`), `나를 부른 메시지`(`N% (M개)`), `활동 시간` 막대(0, 6, 12, 18, 24시 눈금), `요일` 막대(일월화수목금토). 값이 모두 0인 구역(숫자 줄, 두 막대)은 그리지 않고, 요약 구역은 요약 글이 있을 때만 제목 `요약`을 달아요(없으면 단추만), `답장을 기다리는 메시지` 목록, `요약 분석` 영역.
- 기능: 타임라인의 아바타나 이름 클릭으로 열기(`kkPerson`). `요약 분석`/`다시 분석` 버튼(`data-k=analyze`, `kkAnalyze`)이 모델 분석을 요청. 닫기 X, 배경 클릭, 닫히면 DOM에서 제거.
- 상태: 로딩 `불러오는 중…`, 로딩 실패는 서버 글. 이름을 못 찾으면 `상대`. 답장 시간을 못 재면 `아직 잴 수 없어요`. 기다리는 메시지가 없으면 `없어요`. 분석 있으면 본문과 `<시각>에 만든 요약`. 분석 중 버튼 disabled와 `분석 중…`, 실패 시 `요약 분석`으로 복귀하고 토스트. 응답 시간 단위는 초, 분, 시간(`kkMin`). 폰(639px 이하)은 전체 화면, 640px 이상은 오른쪽에 붙은 패널(17-kakao.css:270-271).
- 데이터: `GET /api/kakao/person/<uid>?room=<chatId>`(응답 stats, analysis), `POST /api/kakao/person/<uid>/analyze {room}`(응답 analysis).
- 근거: web/js/30-kakao.js:354 `kkPerson`, :370 `kkPersonPaint`, :397 `kkAnalyze`, :350 `kkBars`, :349 `kkMin`.
- css: web/css/17-kakao.css (`.kk-pd`, `.kk-prow`, `.kk-hist`, `.kk-hb`, `.kk-sum`; :270-271).

### 카카오톡 요청 입력줄 (답장 초안 요청, 직접 보내기)
- 목적: 방 아래 입력줄에 쓴 말은 방에 곧바로 가지 않고 어시스턴트에게 가는 요청이에요. 직접 보내기만 방에 그대로 나가요.
- 구성: `#kk-foot`(`.composer.kk-composer`): 고치는 중 막대 `#kk-edit`(`답장 초안을 고치는 중이에요` + `취소`), 폼 `#kk-form`(`textarea#kk-text` 최대 500자, aria-label `답장 요청`, 칩 `#kk-draft-btn`(`답장 초안`), 칩 `#kk-direct-btn`(`직접 보내기`), 전송 버튼 `#kk-send-btn`(submit, aria-label/title `요청 보내기`)), 초안 카드 영역 `#kk-drafts`는 이 줄 위(대화 바로 밑)에 있어요.
- 기능:
  - 전송(`kkSend`): 초안 수정 중이 아니면 `kkAskBot`: 대기 중인 초안이 있으면 가장 최신 초안을 입력대로 고치고(`kkMakeDraft(undefined,{code,change})`), 없으면 새 메시지 의도로 초안을 만들어요(`kkComposeMake`). 입력은 500자까지.
  - `답장 초안` 칩: `kkMakeDraft()`로 자동 초안 요청.
  - `직접 보내기`: `kkSendDirect`가 입력을 그대로 `POST /api/kakao/chat/<id>/send {text}`. 실패하면 입력을 복원.
  - 초안 직접 수정(`kkEdit`): 입력줄에 초안 글을 채우고 이때 전송 버튼은 `보내기`(초안 경로 `POST /api/kakao/drafts/<code>/send {text}`)로 바뀜. `취소`는 `kkEditCancel`.
  - 키보드: 데스크톱은 Enter 전송, Shift+Enter 줄바꿈, 폰과 터치(`pointer: coarse` 또는 639px 이하)는 Enter가 줄바꿈. IME 조합 중 Enter는 전송 안 함. 입력창은 140px까지 자동 높이.
- 상태(정확한 문구):
  - placeholder `요청을 입력하세요 · 예: 좀 더 짧게`, 초안이 있으면 `초안을 어떻게 고칠까요? · 예: 좀 더 짧게`, 초안 수정 중 `고친 메시지`.
  - 초안 만드는 중: 칩 글 `초안 만드는 중…`(disabled), 카드 자리에 `답장 초안을 만드는 중이에요…`(role=status). 만드는 중 다시 요청하면 토스트 `초안을 만드는 중이에요 · 끝나면 다시 요청해 주세요`. 120초 안에 안 오면 `초안이 아직 오지 않았어요`.
  - 다른 컴퓨터 방에서 초안이 없을 때 요청: 토스트 `다른 컴퓨터의 방에서는 초안을 만든 뒤에 고쳐 달라고 요청할 수 있어요`. 그 방에서는 `직접 보내기` 칩이 숨어요(`KK.pc`). 칩은 입력이 비었거나 초안 수정 중이어도 숨어요.
  - 입력 내용은 방별로 보관해 방을 바꿔도 복원돼요.
  - 입력줄은 전송 중(`KK.sending`)이면 중복 전송을 막아요.
- 데이터: `POST /api/kakao/chat/<id>/draft`(본문 `{intent}` 새 메시지, `{revise:{code,change}}` 고치기, `{choice}` 선택, `{}` 자동), `POST /api/kakao/chat/<id>/send {text}`, `POST /api/kakao/drafts/<code>/send {text}`, `DELETE /api/kakao/chat/<id>/send/<sendId>`, `POST /api/kakao/chat/<id>/send/<sendId>/retry`. SSE `kakao_send`(전송 상태 `sending`, `sent`, `failed`, `deleted`; 모르는 id면 `kkTail`), `kakao_draft`(열린 방의 초안 완료, `e.error`가 있으면 토스트).
- 근거: web/js/30-kakao.js:441-450 (요소), :913 `kkAskBot`, :924 `kkSendDirect`, :931 `kkSend`, :891 `kkSendText`, :1080 `kkComposeMake`, :1099 `kkMakeDraft`, :972 `kkSendEvent`, :942 `kkDeleteSend`, :955 `kkRetry`, :1056 `kkPaintFoot`, :481 키 처리.
- css: web/css/17-kakao.css (`.kk-composer`, `.kk-send`, `.kk-dbtn`, `.kk-edit`), 12-composer-phone.css와의 관계는 코드에서 확인 못 함.

### 카카오톡 답장 초안 카드와 질문 카드
- 목적: 어시스턴트가 만든 초안을 확인하고 보내기, 고치기, 보내지 않기를 골라요. 질문이 있으면 먼저 고르게 해요.
- 구성: `#kk-drafts` 안에 (있으면) 질문 카드 `.kk-draft.kk-ask`, 만드는 중 표시 `.kk-mk`, 초안마다 `rqCard`(web/js/10-reply-card.js 공용 답장 카드, `bare`, `.kk-draft`, data-code): 머리·근거 원문·첨부 줄 없이 라벨 `.kk-dh`(`답장 초안 · 메시지 N개`), 본문(메시지마다 노란 말풍선 `.kk-dp`, 하나여도 말풍선), 동작 `보내기` `고치기` `답장 안 함`. 카드는 화면 높이의 40%까지이고 넘으면 말풍선 부분만 스크롤, 버튼은 늘 보여요.
- 기능:
  - 질문 카드: 제목 `답장 전에 골라 주세요`, 질문 글, 선택 버튼마다 `kkMakeDraft(choice)`, `직접 쓸게`(`POST /api/kakao/chat/<id>/ask/drop` 후 입력창 포커스).
  - 초안 카드 `보내기`: `POST /api/kakao/drafts/<code>/send`, 여러 메시지 초안은 한 번에 모두 보내요. 보내면 카드가 사라지고 타임라인에 전송 중 메시지가 붙어요.
  - `고치기`: 카드 안에 고칠 내용 입력(`kkReviseBox`, `rqReviseNode`)이 열리고 `go`는 `kkMakeDraft(undefined,{code,change})`(새 초안이 오기 전까지 기존 초안 유지), `취소`, `직접 수정`(`kkEdit`)도 제공.
  - `답장 안 함`(답장 초안의 카드): `POST /api/kakao/drafts/<code>/drop`으로 초안을 버리고, 방이 미답장이면 `POST /api/kakao/chat/<id>/no-reply`까지 해서 미답장도 끝내요. 토스트 `답장 안 함으로 표시했어요` + `되돌리기`(`DELETE /api/kakao/chat/<id>/no-reply` 뒤 `kkRestore`: `POST /api/kakao/drafts/<code>/restore`, 토스트 `초안을 되돌렸어요`). 방이 미답장이 아니면 초안만 버리고 토스트 `보내지 않았어요` + `되돌리기`예요.
  - `보내지 않기`(새 메시지 초안의 카드, 답장이 아니라서 이름이 달라요): 초안만 버려요. 토스트 `보내지 않았어요` + `되돌리기`.
- 상태: 카드 라벨(`kkDraftLabel`): `답장 초안` 또는 `새 메시지 초안`(의도로 만든 것), 여러 메시지면 `· 메시지 N개` 덧붙임. 고치는 중에는 카드가 `고치는 중…`(status). 버튼은 처리 중 disabled, 실패 시 서버 글 토스트 후 `kkTail`로 상태 재확인. 새 초안이 도착하면 카드 영역이 화면에 스크롤돼 들어와요. 다른 컴퓨터 방의 카드는 컴퓨터 이름을 머리에 표시하고 앱 라벨은 생략.
- 데이터: 위 API, 응답 `drafts[]`(code, text, parts, sentParts, created, intent, basisLogId), `ask`({question, choices}), `sends[]`. 같은 초안은 답장 확인 목록(30-replies.js)에도 나타나요(`kakao_draft`, `kakao_send` 이벤트에서 `rqSoon`).
- 근거: web/js/30-kakao.js:1015 `kkDraftCard`, :985 `kkAskCard`, :1003 `kkReviseBox`, :1011 `kkRestore`, :1046 `kkEdit`, :1052 `kkEditCancel`, :1008-1009 `kkDraftParts`/`kkDraftLabel`.
- css: web/css/17-kakao.css (`.kk-draft`, `.kk-ask`, `.kk-dh`, `.kk-dt`, `.kk-dp`, `.kk-choices`), web/css/15-reply-card.css (공용 카드).

### 카카오톡 실시간 갱신과 다른 컴퓨터 변형 (눈에 안 보이는 상태)
- 목적: 화면 상태가 서버와 맞게 유지되는 규칙이에요.
- 구성/기능:
  - 이벤트 처리 `kkLive`: 다른 컴퓨터 패널이면 이벤트를 무시(그 스트림은 이 컴퓨터 것), 단 `kakao_draft`/`kakao_send`는 먼저 `rqSoon()`으로 답장 확인 큐도 새로 읽어요.
  - 패널이 숨겨져 있으면 `kakao_rooms`/`kakao_unreplied`만 (패널이 보이거나 채팅 탭이 열려 있을 때) 방 목록을 새로 읽어요.
  - 다른 컴퓨터 방은 열려 있는 동안 2초마다 `GET /api/kakao/chat/<id>/head`로 최신 logId만 확인하고 바뀐 때만 `kkTail`(head를 지원하지 않으면 바로 `kkTail`).
  - 페이지가 다시 보이면(`visibilitychange`) 방 목록, 꼬리, 읽음 숫자를 다시 맞추고 60초 타이머도 같은 일을 해요.
  - 방 목록 갱신 뒤 채팅 탭의 `메일 · 카카오톡` 카드도 갱신(`convSig` 초기화).
- 상태: 오프라인/재연결 전용 문구는 이 파일에서 코드에서 확인 못 함(실패는 조용히 무시하고 다음 이벤트나 타이머 때 재시도). 동시에 여러 번 호출되면 하나만 실행하고 끝나면 한 번 더(`KK.again`, `readAgain`, `olderAgain`).
- 데이터: SSE `kakao`, `kakao_send`, `kakao_draft`, `kakao_rooms`, `kakao_unreplied`, `kakao_read`; `GET /api/kakao/chat/<id>/head`.
- 근거: web/js/30-kakao.js:1134 `kkLive`, :1155 `kkPeerPoll`, :1168 `kkResync`, :1173 `kkMode`; 이벤트 분기 web/js/99-boot.js.
- css: 해당 없음.

### 설정 목록 (`#v-settings`, `settingsList`)
- 목적: 설정 화면들의 입구예요. 네 묶음(모델, 연결, 앱, 시스템)의 링크 행과 한 줄 요약을 보여 줘요.
- 구성: `#v-settings > #settings` 안에 `div.set-col` 둘(`settingsCols`, 22-settings-pages.js)이 있어요. 왼쪽 상자에는 `앱`과 `시스템`이 아닌 묶음(`모델` `연결` `화면 공유`), 오른쪽 상자에는 `앱`과 `시스템`이 들어가요. 창 폭 1100px부터는 `#settings`가 두 칸 격자(칸 사이 `--sp-6`, 위 맞춤)가 되어 두 상자가 나란히 서고(18-app-settings.css), 그 아래에서는 한 단으로 쌓여 예전 한 단 때와 같아요. 상자 안에서 위아래로 `.sec` `모델` + 목록(`공급자`, `모델 · 폴백`, `계정`, `사용량과 월 한도`, `컨텍스트`), `.sec` `연결` + 목록(`메신저`, `웹 접속`, `연결된 기기`, `이 컴퓨터 이름`은 `MN.info`가 있을 때만), `화면 공유` 묶음(`dskSettings`, 이 컴퓨터에 `S.desk`가 있을 때만), `.sec` `앱` + 목록(`앱과 알림`, `앱 관리`, `표시`), `.sec` `시스템` + 목록(`업데이트`, `실행 하네스`, `구성`).
- 기능: 행을 누르면 `go("providers")`, `openModels("orchestrator")`(모델 · 폴백), `go("provider","anthropic")`(계정), `go("usage")`, `go("context")`, `go("messengers")`, `go("webaccess")`, `go("devices")`, `mnDialog`(컴퓨터 이름 바꾸기 대화창, 33-peers.js), `go("notifications")`, `go("apps")`, `go("display")`, `go("update")`, `go("runtime")`, `go("harness")`로 가요. 화면 공유 묶음에는 스위치 `화면 공유`, `조작 허용`(켜져 있을 때), 읽기 전용 행 `지금 보는 사람`, `공개 주소`(Cloudflare 모드이고 상태를 읽었을 때)가 있어요(37-remote-desktop.js:102).
- 상태: 행의 오른쪽 한 줄 요약은 코드가 채워요. `공급자`는 `{n}개 연결`(`P` 로드 전에는 빈 줄), `모델 · 폴백`은 `{모델 이름} · {추론 강도}`, `계정` 행은 `ACC.accounts`가 1개 이상일 때만 나오고 `{라벨} 사용 중`, `사용량과 월 한도`는 가장 낮게 남은 한도 `{한도 이름} {퍼센트}` + `월 $N`, `메신저`는 `{첫 연결 이름} 외 {n}개 연결됨` 또는 `설정 안 됨`, `웹 접속`은 `Tailscale` `Cloudflare` `이 컴퓨터만`, `연결된 기기`는 `{n}대`(Cloudflare 모드에서 `/api/devices`가 답할 때만 행이 생겨요, 아니면 행 자체가 없어요), `앱과 알림`은 `푸시 알림 켬` `푸시 알림 꺼짐` `이 브라우저는 알림을 지원하지 않아요`, `앱 관리` 행은 `navOff("apps")`(앱 기능이 꺼짐)이면 숨겨요, `표시`는 `다크 · 대화 탭 메인` 같은 조합, `업데이트`는 `stUpdateSub` 문구와 오른쪽 태그 `재시작 필요` `새 버전` `업데이트`(하네스만 새 버전일 때), `실행 하네스`는 역할을 맡은 하네스 이름들을 ` · `로 이어 붙인 줄과 태그 `새 버전`, `구성`은 부제 `시스템 지도`. 폰 vs 데스크톱: 목록 구조는 같고, 639px 이하 또는 터치 포인터에서 `.ib`와 스위치 터치 영역이 커져요(15-settings-phone.css:19). 설정 탭에 들어올 때 `go`가 `loadUpdate`, `loadMessengerIndex`, `loadProviderData`, `loadRuntimes`, `loadDevices`, `loadWebAccess`, `loadAccounts`(ACC 없을 때)를 한꺼번에 불러요.
- 데이터: `GET /api/update`, `/api/harness/update`, `/api/messengers`, `/api/providers`, `/api/runtimes`, `/api/devices`, `/api/web-access`, `/api/accounts`, `/api/api-budget`, `/api/quota`(`SQ`), `/api/push*`. SSE는 이 화면 전용이 없어요. 전역 SSE `update_available`이 `loadUpdate`를 불러 이 화면의 업데이트 요약을 바꿔요(99-boot.js:56). 화면을 열 때 `/api/update`와 `/api/harness/update`는 마지막으로 읽은 지 5분(부팅이 쓰는 주기, `updFresh`)이, `/api/providers`는 1분(`provFresh`)이 안 됐으면 다시 읽지 않고 가진 값으로 그려요.
- 근거: web/js/22-settings-pages.js:72 `settingsList`, :42-70 요약 함수들(`stUsageSub` `stAccountSub` `stUpdateSub` `stRuntimeSub` `stPushSub`), :17 `go` 덮어쓰기, web/js/24-settings-update.js:302 `renderSettings`, web/js/05-command-palette.js:165 (설정 진입 시 로드), web/js/04-state.js:35-37 (`views` `SUB` `titles`).
- css: 02-cards-lists-tags.css(`.li` `.tap` `.sec` `.list` `.tag`), 15-settings-pages.css, 15-settings-phone.css(`@media (max-width: 639px), (pointer: coarse)` 터치 크기), 06-harness.css(`.hs-sw`).

### 설정 행 부품 (`stRow`, `stToggle`, `stTag`, `stSec`, `stList`)
- 목적: 설정 페이지가 같이 쓰는 행 모양을 한곳에 둔 부품이에요. 화면은 아니지만 모든 설정 행의 상태가 여기서 나와요.
- 구성: `stRow` = 버튼 `.li.tap`(앞 아이콘 `.lead`, 제목 `.hd`, 한 줄 설명 `.sup`, 끝 `.li-end` 안의 상태 태그 + 화살표). `stToggle` = 값이 정확히 둘인 설정용으로 오른쪽에 두 값 알약(`rowToggle`, 01-core.js:25). `stTag` = 경고 톤 태그(`tag warn upd-new`).
- 기능: `stRow`의 `onclick`이 클릭된 버튼을 인자로 받아요. `stToggle`의 `onPick(v, btn)`.
- 상태: `trail === null`이면 화살표와 끝 영역이 없어요. `trail === undefined`이면 화살표만 있어요.
- 데이터: 없음(순수 렌더 부품).
- 근거: web/js/22-settings-pages.js:27 `stSec`, :28 `stList`, :30 `stRow`, :35 `stToggle`, :39 `stTag`.
- css: 02-cards-lists-tags.css, 06-harness.css(`.upd-new`는 코드에서 클래스만 확인, 규칙 위치는 코드에서 확인 못 함).

### 표시 (`#display`, `displayPage`)
- 목적: 화면 모드(라이트/다크)와 채팅을 열 때 먼저 보일 대화를 정해요.
- 구성: `#v-display > #display.st-page` 안에 목록 하나, 두 행(둘 다 `stToggle`).
- 기능: `화면 모드` 두 값 알약 `라이트` / `다크`(`toggleTheme` 후 `renderSettings`). `대화 탭` 두 값 알약 `메인` / `마지막`(`chatTabModeSet`가 localStorage `CHAT_TAB_KEY`에 저장).
- 상태: 행 설명은 대화 탭 값에 따라 `채팅을 열면 메인 대화부터 시작해요` 또는 `채팅을 열면 마지막으로 보던 대화부터 시작해요`. 화면 모드 행은 설명 줄이 없어요(오른쪽 값이 말해요). 행 아이콘은 테마에 따라 해/달. 서버 호출 없이 브라우저에만 저장해요. 제목은 `titles.display` = `표시`. 로딩, 오류, 빈 상태는 코드에 없어요.
- 데이터: 없음(localStorage).
- 근거: web/js/22-settings-pages.js:101 `displayPage`, :5-10 `SET_PAGE.display`, web/js/04-state.js:172-173 `chatTabMode` `chatTabModeSet`, :226-229 `themeIs` `themeIc` `toggleTheme`.
- css: 02-cards-lists-tags.css(`.seg`/알약), 15-settings-phone.css. `.st-page` 규칙은 web/css에서 못 찾음.

### 앱과 알림 (`#notifications`, `pushSection`)
- 목적: 이 기기의 푸시 알림 켜기/끄기, 앱 설치, 알림 종류별 스위치를 한 화면에서 정해요.
- 구성: `#notifications.st-page` 안에 `.sec` `이 기기` + 목록, `.sec` `알림 종류` + 목록(`appNotifyRows`가 데이터를 받은 뒤에만).
- 기능: `홈 화면에 추가` 줄의 `앱 설치` 버튼(`installApp`, 설치된 앱이 아닐 때만). 앱이 설치된 기기는 게이트웨이마다 `{이름 또는 이 컴퓨터} 알림` 스위치(`pushGw` -> `PUT /api/push/gateways`). 앱이 없는 브라우저는 `알림 켜기`(`pushEnable`). 구독 중이면 `알림 확인` 행에 `테스트 알림`(`pushTest`)과 `끄기`(`pushDisable`). 알림 종류 6개 스위치(`notifyRows`, `appNotifySet` -> `PUT /api/push/classes`): `답변 필요`(질문 · 승인 · 로그인), `경고`(게이트웨이 오류 · 로그인 끊김 · 감시 반복 실패), `결과`(세션 · 작업 완료 · 실패), `새 소식`(메일 · 카톡 · 댓글 · 감시 · 예약), `대화`(보고 있지 않은 대화의 새 답), `진행`(진행 중 보고 · 작업 기록).
- 상태: 푸시 불가 브라우저 `이 브라우저는 알림을 지원하지 않아요`, iPhone이면서 설치 전 `iPhone은 홈 화면에 추가한 앱에서 알림을 켤 수 있어요`. 권한 거부 `알림 권한이 막혀 있어요`. 게이트웨이가 응답하지 않으면 스위치 대신 `연결 안 됨`. 토스트: `알림을 켰어요`, `알림을 껐어요`, `테스트 알림을 보냈어요`, 권한이 꺼져 있으면 `알림 권한이 꺼져 있어요. 기기 설정에서 {봇 이름} 알림을 허용해 주세요`. `알림 종류` 구역은 `/api/push/classes` 응답이 오기 전과 실패했을 때 아예 안 그려요(`APPN.v` null이면 빈 배열). 스위치를 누르면 먼저 값을 바꿔 보여 주고 실패하면 되돌리며 토스트로 오류를 보여요. 알림 종류 아래 설명 줄: `웹앱과 휴대폰에 같이 적용돼요. 꺼도 알림 목록에는 남아요. 메신저 알림은 설정 → 메신저의 각 연결에서 따로 정해요.` 폰 vs 데스크톱 전용 분기는 코드에 없어요(설치 방법만 UA로 iOS/Android/그 외로 갈라요).
- 데이터: `GET /api/push[?endpoint=]`, `POST /api/push/subscribe`, `POST /api/push/unsubscribe`, `POST /api/push/test`, `POST /api/push/presence`, `GET|PUT /api/push/gateways`, `POST /api/push/claim`, `GET|PUT /api/push/classes`. SSE 직접 구독은 없어요.
- 근거: web/js/23-installable-app-web.js:226 `pushSection`, :116 `pushLoad`, :140 `pushGateways`, :151 `pushGw`, :158 `pushEnable`, :172 `pushDisable`, :183 `pushTest`; web/js/24-settings-update.js:283-296 `NOTIFY_CLASSES` `notifyRows` `appNotifyLoad` `appNotifySet` `appNotifyRows`; web/js/22-settings-pages.js:5-10 `SET_PAGE.notifications`.
- css: 06-harness.css(`.hs-sw` 스위치), 15-settings-pages.css, 15-settings-phone.css(`#settings .hs-sw::before` 터치 영역은 `#settings` 안에서만 적용, 이 화면은 `#notifications`라서 적용 여부는 코드에서 확인 못 함).

### 앱 설치 안내 대화창 (`installApp`)
- 목적: 홈 화면에 앱으로 설치하는 방법을 알려 줘요.
- 구성: 대화창 `앱 설치`, 번호 목록 `.steps`와 주의 문구, 버튼 `확인`.
- 기능: 브라우저가 `beforeinstallprompt`를 줬으면 대화창 없이 바로 설치 프롬프트를 띄워요. 아니면 안내 대화창.
- 상태: iOS는 Chrome/Firefox/Edge이면 `주소창의 공유 버튼을 눌러요`, Safari이면 `Safari 아래쪽(또는 주소창)의 공유 버튼을 눌러요`, 이어서 `'홈 화면에 추가'를 골라요`, `'웹 앱으로 열기'가 켜져 있는지 보고 '추가'를 눌러요`. Android는 `브라우저 메뉴(⋮)를 열어요`, `'앱 설치'를 골라요. '홈 화면에 추가'라면 다음 창에서 '설치'를 골라요`, `'바로가기 만들기'는 브라우저로 열려요. 고르지 마세요`. 그 외는 `주소창 오른쪽의 설치 아이콘을 눌러요`, `없으면 브라우저 메뉴에서 '앱 설치'를 골라요`. 하단 문구 `전에 추가한 {봇 이름} 아이콘이 브라우저로 열리면 지우고 다시 추가해 주세요.` 설치 후 토스트 `앱을 설치했어요. 홈 화면의 {봇 이름} 아이콘으로 열어 주세요`.
- 데이터: 없음.
- 근거: web/js/23-installable-app-web.js:209 `installApp`.
- css: 03-base.css(`.steps`), 14-overlay.css(대화창, 파일명만 확인하고 해당 규칙은 코드에서 확인 못 함).

### 업데이트 (`#update`, `updateSection`)
- 목적: 앱 버전 확인, 새 버전 적용, 재시작, 자동 확인과 자동 적용 설정을 한 화면에서 해요.
- 구성: `#update.st-page` 안에 목록 `#upd-sec` 하나. 행 순서: `앱 버전` + `새 버전 확인` 버튼, (확인 결과 블록), (진행/결과 블록), (재시작 대기 또는 받은 버전 행), `자동 확인` 스위치, `새 버전 자동 적용` 스위치.
- 기능: `확인`(`updCheck` -> `POST /api/update/check`), `지금 업데이트`(`updNow` -> `POST /api/update/now`), `재시작`(`updRestart` -> `POST /api/update/restart` with `when: idle|now`), 스위치 두 개(`updSet` -> `PUT /api/update/settings`, 키 `auto_check` `auto_apply`).
- 상태: 로딩/오류 `앱 버전` 행에 `불러오는 중…` 또는 서버 오류 문구. `확인`을 누르면 그 행이 `확인하는 중…`(단추 잠김)이 되고 목록은 그대로 남아요(`UPD.checking`). 실행 버전 `실행 중 {버전}` (`updVer`: git이면 `v{릴리스} · {짧은 해시} · {날짜} · {브랜치}`, tarball이면 `설치본 {해시} · {날짜}`, install이면 `설치본 · {날짜}`, 모르면 `알 수 없음`). 확인 실패 시 `.upd-box.err`에 이유, 해결 방법(백틱은 `<code>`), 상세. 최신이면 행 `최신 버전이에요`(`{버전} · {upstream} · 확인 {시각}` + 로컬 커밋 `{n}개 (아직 올리지 않음)` + `커밋 안 한 변경 {n}개`). 새 버전이 있으면 상자: 제목 `새 버전 {현재} → {새 버전} · {upstream}` 또는 `새 커밋 {n}개 · {upstream}`, 커밋 목록(8개까지, `외 {n}개`), 막힘 사유, 로컬 변경 보관 상자(`updKeepBox`, `보관: {브랜치 · 패치}`), 로컬 커밋 안내 `로컬 커밋 {n}개는 새 버전 위에 자동으로 얹어요. 테스트가 실패하면 그대로 두고 알려요.`, 버튼 `지금 업데이트`(막힘이거나 재시작 대기이면 disabled; 작업 중이거나 재시작 대기 중이면 `확인`도 disabled), 설명 `새로 받기 → 테스트 → 폴더 교체 → 재시작. 테스트가 실패하면 그대로 있어요.`(tarball) 또는 `fast-forward → 테스트 → 재시작. 테스트가 실패하면 그대로 있어요.`. 진행 중 `업데이트 중 · {단계}`; 끝난 작업은 `.upd-box.ok|err`. 받았지만 미적용: `새 버전 {짧은 해시} 받음` / `재시작하면 적용돼요` + `재시작`. 재시작 대기: `재시작 대기 중` / `곧 다시 켜져요. 이 화면은 자동으로 다시 연결돼요.` 또는 `작업이 끝나면 다시 켜져요 ({작업들}). 이 화면은 자동으로 다시 연결돼요.` 재시작 대화창(`dialog`) `작업 중: {목록}` / `작업이 끝난 뒤 재시작하거나, 지금 끊고 재시작할 수 있어요. 끊긴 요청은 다시 켜질 때 이어서 보내요.` 버튼 `작업이 끝나면` `지금 재시작`. 재시작이 끝나면 토스트 `다시 시작했어요 · 지금 버전 {해시}`(2초마다 `/api/update`를 폴링해 boot id가 바뀌면). `자동 확인` 설명: 자동 적용이 꺼져 있으면 `새 버전이 있으면 알림만 보내요. 적용은 직접 해요.`, 켜져 있으면 `새 버전이 있으면 알리고, 아래 자동 적용으로 바로 적용해요.` `새 버전 자동 적용` 설명: `새 버전을 받아 테스트하고, 하던 일이 끝나면 다시 시작해요. 테스트가 실패하면 지금 버전을 그대로 두고 알려요. 이 컴퓨터에서 고친 코드는 새 버전 위에 다시 얹고, 안 되면 따로 보관해요.` 확인 토스트 `새 버전 {버전}이 있어요` / `새 커밋 {n}개가 있어요` / `최신 버전이에요`. 폰: 커밋 제목과 경로가 줄바꿈돼요(15-settings-phone.css:3-17 블록의 `#settings .upd-log span` 규칙. 선택자가 `#settings` 하위라서 `#update` 화면에도 적용되는지는 코드에서 확인 못 함). 600px 이하에서 `.upd-box` 왼쪽 여백이 `--sp-4`(06-harness.css:141).
- 데이터: `GET /api/update`(5분마다 + 진입 시 + 작업 중 1.5초), `POST /api/update/check`, `POST /api/update/now`, `POST /api/update/restart`, `PUT /api/update/settings`. SSE `update_available`.
- 근거: web/js/24-settings-update.js:247 `updateSection`, :118 `loadUpdate`, :143 `updCheck`, :96 `updNow`, :160 `updSet`, :164 `updRestart`, :178 `updWaitTick`, :153 `updKeepBox`, :16 `updState`, :23 `updAvailable`; web/js/22-settings-pages.js:5-10 `SET_PAGE.update`, :17-25 (`update` 또는 `runtime` 진입 시 `loadUpdate`).
- css: 06-harness.css(`.upd-box` `.upd-log` `.upd-act` `.upd-block`, 이름은 코드에서 확인하고 규칙은 `.upd-box` `.upd-log`만 파일에서 확인), 15-settings-phone.css, 06-harness.css(`.hs-sw`).

### 상단 업데이트 바와 새 버전 배지 (`#upd-bar`, `#nav-upd`)
- 목적: 설정까지 가지 않아도 한 번 눌러 전체 업데이트를 돌려요. 진행과 결과도 여기서 봐요.
- 구성: `body` 맨 위에 `#upd-bar.upd-bar.{phase}`(`role="status"` `aria-live="polite"`), 안에 `.ub-tx`(누를 수 있으면 `button`, 아니면 `span`)와 닫기 `×`. 내비게이션의 배지 `#nav-upd`.
- 기능: `new`, `failed` 단계에서 문구를 누르면 `updNow`. `×`는 `ubSee`로 이 제안(원격 head) 또는 이 결과(flow id)를 localStorage `dotz-upd-bar`에 기억해 숨겨요. 2초 간격 `updBarTick` 폴링.
- 상태: 문구는 `새 버전이 있어요 · 눌러서 업데이트`(new), 서버가 준 진행 문구(download, waiting, restarting; 이때 `×` 없음), 게이트웨이가 응답하지 않으면 `다시 켜는 중이에요`, 끝나면 서버 문구 + ` · 지금 버전 {해시}`(done, 2.4초 뒤 스스로 사라짐), 실패 `업데이트하지 못했어요: {이유} · 눌러서 다시 시도`(이유가 이미 `업데이트하지 못했어요`로 시작하면 한 번만). 결과는 1시간 안의 것만, 이미 본 것은 안 보여요. 사라질 때 높이 접힘 250ms(모션 줄이기 설정이면 즉시). 폰에서 두 줄로 접히면 `--upd-h`를 바 높이로 설정해 앱을 아래로 밀어요(`ubFit`). `#nav-upd` 배지: 재시작 대기 `재시작 필요`, 둘 이상 `업데이트 {n}`, 그 외 `새 버전`(제목 `재시작하면 새 버전이 적용돼요` / `새 버전이 있어요`).
- 데이터: `GET /api/update`, `POST /api/update/now`, SSE `update_available`.
- 근거: web/js/24-settings-update.js:40 `paintUpdBadge`, :52-64 `UB` `ubSeen` `ubSee` `updBarState`, :65 `ubFit`, :72 `ubOut`, :79 `paintUpdBar`, :96 `updNow`, :107 `updBarTick`; web/js/99-boot.js:56, :80.
- css: 03-base.css(`.upd-bar`, `--upd-h`).

### 실행 하네스 (`#runtime`, `hvSection`)
- 목적: 에이전트가 올라타는 하네스(실행 프로그램)의 버전, 업데이트, 바꾸기를 한 화면에서 해요.
- 구성: `#runtime.st-page`: 구역 머리 `하네스 버전`(새 버전 태그 `새 버전` + `확인` 버튼, `.sec-act`), 하네스별 행 목록(앞 아이콘, 이름, 한 줄 상태, 오른쪽에 `새 버전` 태그, `업데이트` 버튼 또는 진행 태그, 바꾸기 드롭다운 버튼), 진행/결과 줄, 안내 문구 하나.
- 기능: `확인`(`hvCheck` -> `POST /api/harness/update/check`), `업데이트`(`hvApply` -> `POST /api/harness/update/apply` `{id}`), 바꾸기 버튼(`hvSwitcher`, 메뉴에서 설치된 다른 하네스를 골라 `rtFlow`).
- 상태: 하네스 정보가 없으면 `emptyNode` `실행 하네스를 확인하는 중이에요`. 상태 줄(`hvSub`): 버전 미확인 `확인 중…` 또는 에러, `지금 {현재}` + ` → {최신}`, 관리형 `{버전} · {관리 주체 또는 다른 프로그램}이 관리해요`, 앱 설치 `· 앱으로 설치됨`, 최신 `· 최신`, 역할 `어시스턴트·세션 사용 중` 같은 접미. `업데이트` 버튼은 `bun-global` 또는 `omp-update` 설치일 때만 enabled이고, 진행 중 작업이 있으면 disabled. 진행 태그 `대기 중` / `진행 중`, 줄 `작업이 끝나면 업데이트해요` / `업데이트 중 · {단계}`. `확인`은 검사 중이면 disabled. 토스트 `실행 하네스 새 버전 {n}개가 있어요` / `실행 하네스는 최신이에요`. 안내는 한 줄 `설치가 실패하면 지금 버전을 그대로 써요.` 진행 중이면 `loadUpdate`가 2초마다 다시 읽어요. `rtSection`(26-settings-runtime.js:10)은 정의만 있고 어디서도 호출하지 않아요(grep 결과 정의 1건).
- 데이터: `GET /api/harness/update`, `POST /api/harness/update/check|apply`, `GET /api/runtimes[?refresh=1]`. SSE `runtime_check`(검사 중일 때 `rtLive`).
- 근거: web/js/24-settings-update.js:223 `hvSection`, :197 `hvSub`, :209 `hvSwitcher`, :216 `hvJobLine`, :130 `hvCheck`, :139 `hvApply`; web/js/26-settings-runtime.js:6 `loadRuntimes`; web/js/22-settings-pages.js:5-10 `SET_PAGE.runtime`.
- css: 06-harness.css(`.upd-box`), 02-cards-lists-tags.css(`.sec-act`는 01-tokens/06-harness/18-app-settings에서도 선언), 15-settings-pages.css.

### 하네스 바꾸기 대화창 (`rtFlow`)
- 목적: 다른 하네스로 바꾸기 전에 호환성을 검사하고 적용 대상을 골라요.
- 구성: 넓은 대화창 `{하네스 이름}로 바꾸기`: 본문(안내, 진행 막대 또는 검사 보고서 `rtReportView`), `적용 대상` 한 줄 고르기(`seg`: `둘 다` `어시스턴트` `세션`), 하단 버튼 `취소` / `호환성 검사`(또는 `다시 검사`) / `바꾸기`.
- 기능: `check` -> `POST /api/runtimes/{id}/verify` `{real:true}` 후 1초 폴링(`GET /api/runtimes/{id}`). 적용 `POST /api/runtimes/{id}/use` `{roles}`(성공 토스트는 서버가 준 `applies` 문구).
- 상태: 검사 중 `호환성을 검사하는 중이에요 · {현재 항목}` + 막대 + `{done}/{total} 항목` 또는 `시작하는 중…`. 보고서 요약: `이 하네스용 어댑터가 없어서 바꿀 수 없어요.` / `핵심 항목이 통과하지 못해서 바꿀 수 없어요: {항목}` / `검사한 뒤 버전이 바뀌었어요 (v{전} → v{후}). 다시 검사해 주세요.` / `핵심 항목은 모두 통과했어요. {n}개 기능은 게이트웨이가 대신 처리하거나 꺼요.` / `모든 항목이 통과했어요.` 항목 배지 `통과` `대체` `끔` `미지원` `실패`, 핵심 항목은 `핵심` 태그. 검사 전 안내: omo `OmO는 기본 하네스라서 검사 없이 돌아갈 수 있어요. 호환성 검사로 항목별 상태도 볼 수 있어요.`, 그 외 `바꾸기 전에 호환성을 검사해요. 짧은 실행을 실제로 해 보기 때문에 1~2분쯤 걸릴 수 있어요.` 또는 어댑터 없음 `이 하네스용 어댑터가 없어서 이 하네스로는 바꿀 수 없어요. 호환성 검사를 하면 어떤 항목이 막히는지 볼 수 있어요.` omp는 `omp는 옵션 하네스예요. 처음 기준이었던 하네스라 검사 없이 바꿀 수 있어요.` 사용 버튼은 검사 중, 사용 불가(blocked 또는 버전 불일치), 적용 대상 0개이면 disabled. 닫으면 폴링을 멈추고 `loadRuntimes(true)`.
- 데이터: `GET /api/runtimes/{id}`, `POST .../verify`, `POST .../use`, SSE `runtime_check`.
- 근거: web/js/26-settings-runtime.js:43 `rtFlow`, :28 `rtReportView`, :24 `rtBadge`, :5 `RT_RESULT`.
- css: 02-cards-lists-tags.css(`.rt-row`). `.rt-rep` `.rt-roles` 규칙은 web/css에서 못 찾음(인라인 style로 배치).

### 모델 · 폴백 (`#v-models`, `renderModels`)
- 목적: 모델이 도는 모든 자리(어시스턴트, 세션, 답장과 요약)를 한 목록으로 보고, 행을 눌러 그 자리의 모델, 추론 강도, 막혔을 때 넘어갈 폴백 순서를 그 자리에서 고쳐요.
- 구성: `#models > .col.mt`: 맨 위 `.mt-top`(설명 `막히면 번호 순서대로 넘어가요.` + 공급자 필터 `공급자` 드롭다운 `.mt-filter`), 그 아래 `section.mt-card` 세 묶음 `어시스턴트`(메인 어시스턴트, 대화 백그라운드 작업, 조회 작업) / `세션`(새로 시작하는 세션, 실행 중 세션마다 한 줄, 세션 서브에이전트) / `답장과 요약`(답장 기본값, 앱별 답장, 출력 언어 · 요약). 묶음마다 `.mt-head` 제목 + `.list.mt-use-list` 안에 `.mt-use-row`(`modelGroups`, `mtRow`). 행: 이름과 부제(세션은 상태 점과 실행 상태 문구), 오른쪽에 모델 · 추론 강도, 폴백 체인이 있으면 `대체 {n}`, 폴백 중이면 경고 태그, 맨 끝 표시. 눌러서 열린 행 바로 아래에 그 자리의 편집기(`.mt-list.mt-edit[data-target]`: `모델` 드롭다운 + `추론 강도` 드롭다운, `적용`/`되돌리기`, 폴백 순서 `.mt-fb`)가 붙어요. 한 번에 하나만 열려요.
- 기능: 모델/추론 강도 선택은 `pending[key]`에 담고 `적용`(`putModel` -> `PUT /api/models` `{target, model, thinking}`)을 눌러야 저장. 폴백은 `fbParts` 안에서 바로 저장(`PUT /api/fallbacks`). 공급자 필터 `전체` + 공급자들. 다른 화면에서 들어올 때 `openModels(key)`가 해당 행을 펼치고 그 행으로 스크롤(`modelsOpen`, `modelsFocus`). 이 화면을 눌러 고치는 행(`change.models`)은 행 전체가 버튼(`role="button"`, Enter/Space, `aria-expanded`)이고 맨 끝에 아래 화살표(열리면 위로 뒤집힘). 앱 설정에서 바꾸는 행(`change.app`)은 오른쪽 화살표이고 눌러 그 앱의 설정 화면(`asScreen`)을 열어요. 고정된 행(`change.none`)은 `고정` 글자만 있고 눌리지 않아요. 같은 자리를 가리키는 두 번째 행(대화 백그라운드 작업, 세션 서브에이전트)은 읽기 전용이에요.
- 상태: 처음 `M` 없으면 `불러오는 중…`. 로드 실패(조용 모드가 아닐 때) `모델 정보를 불러오지 못했어요`와 `다시 시도` 단추(뒤이어 다시 그려져도 남고, 다시 불러오기에 성공하면 사라져요). `적용`은 바뀐 것이 있을 때만 enabled, `되돌리기` 같이 보임. 어시스턴트 카드 적용 시 확인창(제목 카드명, 본문 `어시스턴트가 다시 시작돼요.` + `{모델} · {추론}`, 버튼 `적용`), 캐시가 다시 쓰이면 `캐시가 다시 쓰여요 · 컨텍스트 {n} 토큰`으로 한 번 더 물어요(`requires_force`). 토스트 `적용했어요` / `적용했어요 · 재시작됨` / `다음 시작부터 적용돼요`. 추론 강도를 안 쓰는 모델은 `이 모델은 추론 강도를 쓰지 않아요`. 세션 카드 상태 점/문구는 `runStatus`(41-runstate.js:20). 드래그 중(`fbDragging`)에는 다시 그리지 않아요. 폰 vs 데스크톱: 639px 이하에서 폴백 줄이 격자로 재배치되고 전환 스위치가 태그 줄 앞으로 와요(15-settings-phone.css:3-17), 드롭다운 폭 `min(58%, 200px)`(15-settings-pages.css:42), 터치/639px 이하에서 필드 높이 확대(15-settings-pages.css:43, 15-settings-phone.css:19-23), 640px 이하에서 `.mt-model` `.mt-eff` 폭 제한 해제(03-base.css:42). 이 화면은 60초마다와 탭 복귀 시 `loadModels(true)`로 조용히 다시 읽어요. 바꾼 값이 있는 편집기(`pending`)는 다시 그려도 열린 채로 있고, 폴백 행을 끄는 중(`fbDragging`)에는 다시 그리지 않아요. 실행 중이지만 `M.in_use`에 행이 없는 세션도 `M.lanes`로 한 줄을 만들어요.
- 데이터: `GET /api/models`(`M`), `PUT /api/models`, `GET /api/providers`(공급자 이름, 구독/API 구분), `PUT /api/fallbacks`, `GET /api/apikeys`. SSE는 없고 폴링만 있어요(99-boot.js:95).
- 근거: web/js/20-models.js `renderModels`, `modelGroups`, `mtRow`, `mtRows`, `mtEditor`, `targetEdit`, `repliesEdit`, `putModel`, `loadModels`, `openModels`, `modelSource`, `modelPickItems`, `modelItems`; web/js/05-command-palette.js:166; web/js/22-settings.js `FB_LAYERS`.
- css: 03-base.css(`.mt-*` `.fb-*` `.fbe*`), 15-settings-pages.css(`#models`), 15-settings-phone.css.

### 모델 선택 메뉴 (`modelItems`, `modelPickItems`)
- 목적: 모델 드롭다운 목록을 어떻게 묶어 보여 줄지 정해요.
- 구성: 계열(family)별 머리글 아래 모델 행. 같은 계열이 둘 이상의 경로(구독/API)를 섞으면 행마다 경로를 붙이고, 한 경로뿐이면 머리글에 한 번만 써요. 오래된 모델은 `이전 모델 {n}개` 접힘.
- 기능: 값은 `selector`. 현재 선택은 접히지 않아요.
- 상태: 경로 표기 `구독 {계정}`(oauth, 계정이 없으면 `구독 계정`) / `API {공급자 이름}`(api_key). 목록에 없는 현재 값은 `현재` 머리글 아래 따로. 공급자 필터가 걸려 있으면 그 공급자만. 선택 가능한 목록은 `M.pickable`(없으면 `M.available`).
- 데이터: `M.pickable`, `M.available`, `P.providers`.
- 근거: web/js/20-models.js:15, :24, :39.
- css: 03-base.css(메뉴 `.mi`), 파일 내 전용 규칙은 코드에서 확인 못 함.

### 폴백 순서 목록 (`fbParts`)
- 목적: 한 대상의 모델이 막혔을 때 순서대로 넘어갈 모델 목록을 보고 고쳐요.
- 구성: `.mt-fb`: 머리(`폴백 순서` + `기본 포함 {n}단계` 또는 `기본 모델만`), 번호 목록 `ol.fb-list`(1번은 `기본` 칩이 붙은 대상 자신의 모델, 이후 단계마다 번호, 이름, `사용 중` 표시, 태그 줄, 사용 상한 막대), 버튼 `폴백 모델 추가`, `구독 소진 시 API 키로 계속`, 설명 줄.
- 기능: 단계 클릭 또는 `편집` 버튼 = 편집기 열기(`fbOpenStep`), `켜짐/꺼짐` 스위치(`role="switch"`), `위로` `아래로` 버튼과 포인터 드래그(6px 넘게 움직이면 `fbDrag`)로 순서 변경, `빼기`. 기본 단계를 누르면 카드의 모델 드롭다운이 열려요. 모든 변경은 즉시 `fbSave` -> `PUT /api/fallbacks` `{target, chain}`.
- 상태: 태그: `API 키`, `서브에이전트·세션도 사용`, `구독 소진 시` / `오류 시`, 상한 `월 $N까지` / `일 N 토큰까지`, `복귀 안 함`, 경고 태그 `상한 도달` `한도 소진` `공유 계정 사용 중이라 꺼짐` `API 키 사용 안 함(설정)` `쓸 수 없음`(툴팁 `풀리는 때: {시각}`), `{하네스 이름 또는 이 하네스}에서 못 써요`. 사용 상한 막대 라벨 `오늘|이번 달 $사용 / $상한` 또는 `... N / N 토큰`. 추가는 `최대 개수`(`M.fallbacks.max`, 기본 6)에 닿으면 `더 넣을 수 없어요`로 바뀌고 disabled. 중복이면 토스트 `이미 있는 모델이에요`. 저장 토스트: `바로 적용돼요` / `지금 하던 일이 끝나면 적용돼요` / `다음에 시작될 때부터 적용돼요`, 실패 시 서버 메시지 또는 `저장하지 못했어요`(그 후 다시 읽어요). 설명 줄은 서브에이전트이면 `서브에이전트 폴백은 순서대로 넘어가요. API 키 단계는 세션이 시작될 때 정해져요. 이미 실행 중인 서브에이전트는 모델을 그대로 쓰고, 상한·복귀는 다음 시작부터 반영돼요.`, 하네스가 claude이면 `Claude Code는 Anthropic 모델만, 조건 없이 순서대로 넘어가요.`, 그 외 `단계를 누르면 바로 수정해요(모델·추론 강도·구독/API 키·넘어가는 때·복귀·상한). 끌거나 화살표로 순서를 바꿔요.` `구독 소진 시 API 키로 계속` 버튼은 허브가 조건을 지원하고 같은 모델의 API 키 단계가 아직 없을 때만 나와요. 기본 칩 툴팁 `{모델} · 눌러서 모델 바꾸기`, 단계 툴팁 `{모델} · 눌러서 편집`. 접근성: 단계별 `aria-label` (`{이름} 위로` `아래로` `편집` `빼기` `끄기` `켜기`).
- 데이터: `M.fallbacks[대상]`(chain, active, harness, providers, conditions, max), `PUT /api/fallbacks`.
- 근거: web/js/22-settings.js:159 `fbParts`, :18 `fbTags`, :28 `fbBar`, :37 `fbSave`, :127 `fbDrag`, :50 `fbOpenStep`.
- css: 03-base.css(`.fb-list` `.fb-item` `.fb-acts` `.fb-bar`), 15-settings-pages.css, 15-settings-phone.css:3-17.

### 폴백 단계 편집기 (`fbEditor`)
- 목적: 단계 하나의 모델, 추론 강도, 켜기, 구독/API 키, 넘어가는 조건, 복귀, 사용 상한을 한곳에서 고쳐요. 저장 전까지는 초안(`fbOpen.draft`)이에요.
- 구성: 단계 바로 아래 `li.fbe`: `.fbe-grid`(`모델` `추론 강도` 드롭다운, 추론 강도 기본 항목 `기본 모델과 같게`), 알약 그룹 `사용`(`켜기`/`끄기`), `서브에이전트·세션`(`API 키 사용 안 함`/`같은 키 사용`, 키 단계이면서 서브에이전트 체인이 아닐 때), `사용 방식`(`구독 (로그인)`/`API 키`, anthropic/openai/openrouter만), 키 상태 줄 + `키 바꾸기`, `넘어가는 때`(`앞 모델이 안 될 때`/`한도 소진 시 (429)`/`제공자 오류 시`), `기본 모델 복귀`(`한도가 풀리면 복귀`/`계속 이 모델`), `.fbe-cap`(`사용 상한 (KST)` 월/일, `금액 (USD)`, `토큰`, placeholder `없음`), 하단 `삭제` / `취소` / `저장`.
- 기능: 값 변경은 `redraw`(초안만 바뀜). `저장`(`save`)은 체인 전체를 `PUT /api/fallbacks`로 보내고 성공하면 닫아요. `삭제`는 그 단계를 빼요.
- 상태: 조건/복귀/상한 항목은 허브가 체인을 직접 돌릴 때(`F.conditions`)만 나오고, 서브에이전트 체인에서는 API 키 단계에만 나와요. 키 상태 `저장된 키 {마스크}` / `저장된 키가 없어요`(경고 톤) / `키 파일 {이름}`. 560px 이하(`@media (max-width: 560px)`)에서 격자가 한 열(03-base.css:55). 639px 이하에서 알약 버튼이 줄바꿈 허용(15-settings-phone.css:3-17 블록). 편집기가 열린 동안 `GET /api/apikeys`로 키 목록을 한 번 읽어요.
- 데이터: `GET /api/apikeys`, `PUT /api/fallbacks`.
- 근거: web/js/22-settings.js:55 `fbEditor`, :48-49 `fbSplit` `fbDraftOf`.
- css: 03-base.css(`.fbe` `.fbe-grid` `.fbe-cap` `.fbe-key`), 15-settings-pages.css, 15-settings-phone.css.

### API 키 대화창 (`fbKeyDialog`)
- 목적: 폴백 단계가 구독 대신 쓸 API 키를 붙여 넣고 확인해서 저장해요.
- 구성: 대화창 `API 키`: 설명, 저장 상태 줄, `API 키` 비밀번호 입력(placeholder `sk-ant-…` `sk-or-…` `sk-…`), 접힘 `고급: 키 파일 이름으로 지정`(안에 `파일 이름` 입력). 버튼 `취소`, (anthropic이고 OmO 키가 있으면) `OmO 키 쓰기`, (이미 키 단계이면) `키 끄기`, `저장`.
- 기능: 값이 있으면 `PUT /api/apikeys` `{provider, key}`로 한 번 확인하고 저장, 아니면 파일 이름 또는 이미 저장된 키 사용.
- 상태: 설명 `구독 대신 API 키로 쓸 때 키를 붙여 넣어요. 저장하기 전에 한 번 확인하고, 키 값은 다시 보여주거나 기록에 남기지 않아요. 비워 두면 저장된 키를 써요.` 상태 줄 `저장된 키: {마스크} (사용 중)` / `저장된 키가 없어요`. 지원하지 않는 공급자는 토스트 `{공급자} 모델은 API 키를 쓸 수 없어요`. 입력이 모두 비면 토스트 `API 키를 붙여 넣어 주세요`. 성공 토스트 `키를 확인하고 저장했어요 ({마스크})`.
- 데이터: `GET|PUT /api/apikeys`(`{from:"omo"}` 포함).
- 근거: web/js/22-settings.js:101 `fbKeyDialog`.
- css: 14-overlay.css(대화창, 규칙 이름은 코드에서 확인 못 함), 06-harness.css.

### 모델 목록의 행 (`mtRow`)
- 목적: 지금 모델이 실제로 도는 모든 자리와 그 모델을 한눈에 보고, 그 자리에서 바로 고쳐요.
- 구성: `.mt-use-row[data-use]`: `.mt-use-tx`(`.nm` 이름, `.sup` 부제), `.mt-use-rest`(`.mt-use-m` 모델 · 추론 강도, `대체 {n}`, 폴백 태그), `.mt-use-end`(아래 화살표 / 오른쪽 화살표 / `고정`). 높이는 44px 이상.
- 기능: `change.models` 행은 눌러 편집기를 펼치고 접어요(한 번에 하나). `change.app` 행은 그 앱의 설정 화면(`asScreen`)을 열어요.
- 상태: 폴백 중이면 경고 태그 `대체 모델 사용 중 · {이유} · {시각}에 복귀`(툴팁에 `기본 모델 {...} 대신 쓰는 중`). 이유는 `한도 소진` `상한 도달` `오류`. 출력 언어 행은 설정 파일에서만 바꾸고 이 앱에는 고치는 자리가 없어서 `고정`으로 보여요.
- 데이터: `M.in_use`, `M.lanes`, `M.fallbacks[...]`(`chain`, `primary_down`).
- 근거: web/js/20-models.js `mtRow`, `modelGroups`, `fbWhy`, `fbTagText`, `selText`, `fbTag`.
- css: 03-base.css(`.mt-use*`), 15-settings-pages.css.

### 답장 기본값 편집기 (`repliesEdit`)
- 목적: 앱마다 따로 고르지 않은 답장 초안의 기본 모델을 정해요.
- 구성: `답장 기본값` 행을 열면 나오는 `.mt-list.mt-edit[data-target="replies"]`: `답장 모델` 드롭다운, 설명 `답장 초안은 API 키로 넘어가지 않아요.`
- 기능: 선택 즉시 `PUT /api/models` `{target:"replies", model}`.
- 상태: `M.replies`가 없으면 편집기를 안 그려요. 토스트 `적용했어요` / 서버 메시지 또는 `저장하지 못했어요`. 기본 항목 라벨은 `R.default_label`.
- 데이터: `M.replies`, `PUT /api/models`.
- 근거: web/js/20-models.js `repliesEdit`.
- css: 03-base.css, 15-settings-pages.css.

### 공급자 목록 (`#v-providers`, `renderProviders`)
- 목적: 연결된 구독/API 키 공급자를 보고 추가하거나 상세로 들어가요.
- 구성: `#providers`: 머리 `.sec.sec-act` `공급자` + `추가` 버튼, 목록(공급자 행 `.prow`: 상태 점, 이름, 부제, 한도 막대들, 오른쪽 상태 태그), 하단 설명.
- 기능: 행을 누르면 `go("provider", id)`. `추가`는 `addProviderDialog`. 정렬은 로그인 방식 공급자가 먼저, 그다음 API 키와 미연결.
- 상태: 로딩 `불러오는 중…`, 실패 `공급자를 불러오지 못했어요`, 빈 목록 `공급자가 없어요`. 부제는 `{계정 또는 마스크 또는 연결 안 됨} · 지금 사용 중 · 계정 {n}개`. 오른쪽 태그 `로그인됨` / `API 키` / `연결 안 됨`(연결됨은 초록, 쓰고 있는데 미연결이면 주황 점). 한도 막대는 `SQ`에서 가져와요(5시간 한도는 `5시간 한도`, 7일은 `7일 한도 Opus`처럼 `limitName`). 하단 설명 `공급자를 누르면 로그인과 API 키, 계정과 한도를 바꿔요. 모델은 어느 경로로 쓰는지 공급자 줄에서 구분해요.`
- 데이터: `GET /api/providers`(`providers`, `addable`).
- 근거: web/js/21-providers.js:41 `renderProviders`, :7 `loadProviders`, :2 `loadProviderData`, :37 `limitName`; web/js/05-command-palette.js:167.
- css: 02-cards-lists-tags.css(`.prow`), 15-settings-pages.css(`.prow` `.prow-lim`), 15-settings-phone.css(`:is(#settings,#models,#providers,#usage,#context) .ib`).

### 공급자 추가 대화창 (`addProviderDialog`)
- 목적: 새 공급자를 로그인으로 또는 API 키로 연결해요.
- 구성: 대화창 `공급자 추가`: `로그인` 묶음(`계정으로 로그인`), `API 키` 묶음(`키 입력`), 선택한 API 키 공급자의 `{이름} API 키` 입력. 버튼 `취소` / `저장`.
- 기능: 로그인 항목을 누르면 대화창을 닫고 `startLogin`. API 키 항목을 누르면 입력 칸이 생겨요. `저장` -> `POST /api/providers` `{provider, key}`.
- 상태: `addable`이 있는 서버는 목록으로 고르고, 목록이 비면 `추가할 공급자가 없어요` + `닫기`. `addable`이 없는 서버(구버전)는 `공급자` 이름과 `API 키`를 직접 입력. 입력이 비면 토스트 `공급자와 API 키를 입력해 주세요`. 성공 토스트 `저장했어요`.
- 데이터: `POST /api/providers`.
- 근거: web/js/21-providers.js:67 `addProviderDialog`.
- css: 14-overlay.css(대화창), 02-cards-lists-tags.css(`.li` `.avatar`는 코드에서 클래스만 확인).

### 공급자 상세 (`#v-provider`, `renderProvider`)
- 목적: 공급자 하나의 로그인 또는 API 키 상태를 보고, 구독이면 그 계정들을 관리해요.
- 구성: `#provider`: 계정이 없거나 API 키인 공급자는 목록 한 줄 `.li[data-prov-conn]`(제목 `로그인` 또는 `API 키` + 상태 태그 `로그인됨` / `연결됨` / `연결 안 됨`, 부제, 오른쪽 버튼). 계정이 있는 구독 공급자는 이 줄이 없고 카드 하나가 `accountSection()`(anthropic) / `accProviderSections`(그 외)의 `[data-prov-conn]` 목록이에요.
- 기능: `로그인` / `다시 로그인`(`startLogin`, 계정이 있는 공급자는 이 버튼이 없고 계정 블록 맨 아래 `계정 추가` 행으로 해요), 휴지통 버튼(API 키 공급자의 `키 삭제`, 계정이 없는 공급자의 `로그아웃`, `logoutProvider` -> 확인창 -> `POST /api/providers/{id}/logout`).
- 상태: 화면 제목은 공급자 이름(`providerName(provCur)`). 로딩 `불러오는 중…`, 못 찾으면 `공급자를 찾지 못했어요`. 부제는 `{계정 또는 마스크 또는 연결 안 됨} · 계정 {n}개`. 로그아웃 확인 `{이름} 로그아웃` / `저장된 로그인 정보가 삭제돼요.`(버튼 `로그아웃`), 키는 `{이름} 키 삭제` / `저장된 API 키를 삭제할까요?`(버튼 `삭제`), 토스트 `로그아웃했어요` / `키를 삭제했어요`. 뒤로 가기는 `providers`(04-state.js:235).
- 데이터: `GET /api/providers`, `POST /api/providers/{id}/logout`, `GET /api/accounts`.
- 근거: web/js/21-providers.js:17 `renderProvider`; web/js/20-models.js:65 `logoutProvider`; web/js/05-command-palette.js:168; web/js/04-state.js:235 `backTarget`.
- css: 02-cards-lists-tags.css, 15-settings-pages.css, 15-settings-phone.css.

### 로그인 대화창 (`startLogin`)
- 목적: 공급자 로그인을 대화창에서 끝내요(주소 열기, 코드 붙여 넣기, 선택지 응답).
- 구성: 대화창 `{이름} 로그인` 또는 `{이름} 계정 추가`. 로그인이 지금 묻는 단계만 보여요. 질문(Claude 계정 이름): 질문 문구가 입력 칸 이름이고 기본값(`account-N`)이 미리 채워져요. 선택(로그인 방식): 질문 문구 아래 선택지마다 누를 수 있는 행, 버튼은 `취소`만. 주소 단계: `로그인 페이지 열기` 링크 버튼, `코드 또는 주소` 입력, 로그인이 묻는 문구. 오류 줄. 버튼 `취소` / `완료`.
- 이미 열린 로그인(닫은 탭, 대화의 `/login`): 시작이 409로 돌아오면 `끝나지 않은 로그인이 있어요` 확인 창에서 `닫기` / `새로 시작` / `이어서 하기`(같은 공급자일 때만)를 골라요. 본문은 다른 공급자의 로그인이 열려 있을 때만 `지금 {공급자} 로그인이 열려 있어요.` 한 줄이고, 같은 공급자면 본문이 없어요. 각각 `{pending: "restart"}`, `{pending: "resume"}`로 다시 시작해요.
- 기능: 시작 `POST /api/providers/{id}/login`, 2초마다 `GET .../login?login_id=`, 완료 `POST .../login/complete` `{login_id, code}`(여러 단계이면 다음 질문을 받아 계속), 닫으면 `DELETE .../login`. 입력 칸에서 Enter = `완료`.
- 상태: 성공 토스트 `계정을 추가했어요` 또는 `{이름} 로그인했어요`. 실패 오류 줄 `로그인에 실패했어요`(서버 오류 문구가 있으면 그것), 입력 없음 `코드나 주소를 붙여 넣어 주세요`. 시작 자체가 실패하면 토스트로 오류.
- 데이터: `POST|GET|DELETE /api/providers/{id}/login`, `POST /api/providers/{id}/login/complete`.
- 근거: web/js/21-providers.js `startLogin`, `pendingLoginAsk`.
- css: 14-overlay.css(대화창), 02-cards-lists-tags.css(선택지 행 `.list .li`).

### 사용량 (`#v-usage`, `loadQuota`)
- 목적: 공급자별 사용 한도 소진율, 사용 중인 Claude 계정과 전환 기록을 봐요.
- 구성: `#usage`: 맨 위 `.tools-bar`(조회 시각 + `새로고침`), (API 월 한도 카드 또는 행), 카드 격자 `.grid`(공급자마다 `.card`: 제목, 한도 줄 `.lim`에 이름, 퍼센트, 막대, 초기화 시각), `.sec` `사용 계정`(계정 라벨, 시작 시각 + 설명, 전환 기록 행 5개, 더 보기 버튼, `기록 모두 지우기`), `.sec` `정보가 없어요`(공급자와 사유).
- 기능: `새로고침`(`loadQuota(true)` -> `GET /api/quota?fresh=1`). 전환 기록 행의 `×`(`이 기록 지우기`, `DELETE /api/accounts/switches?at=`), `이전 기록 {n}개 더 보기` / `이전 기록 접기`, `기록 모두 지우기` 확인창 `기록을 모두 지울까요?` / `계정 전환 기록 {n}개를 지워요. 되돌릴 수 없어요.`(버튼 `모두 지우기`).
- 상태: 실패 `사용량을 불러오지 못했어요`. 한도 없는 공급자 카드는 `없어요`. 전부 비면 `사용량 정보가 없어요`. 한도 이름은 `5시간 한도` 같은 한글화(`limitName`), 퍼센트와 막대 `pctText` `bar`(05-command-palette.js:186-194). 계정 설명: 고정 `고정한 계정이에요. 한도에 걸리면 다른 계정 대신 폴백 순서를 따라요`, 아니면 `규칙이나 한도로 바뀌기 전까지 이 계정을 계속 써요`. 전환 종류 `처음 선택` `한도` `직접 변경` `계정 사라짐`. 토스트 `기록을 지웠어요` / `기록을 모두 지웠어요` / 실패 `지우지 못했어요`. 화면이 열려 있는 동안 60초마다 자동 새로고침. 폰 vs 데스크톱 분기는 코드에 없어요(`.ib` 터치 크기만).
- 데이터: `GET /api/quota[?fresh=1]`, `GET /api/providers`, `DELETE /api/accounts/switches`. SSE `quota`(`quotaLive`가 사용량 화면이면 `loadQuota`, 09-needs-you.js:281).
- 근거: web/js/21-providers.js:185 `loadQuota`; web/js/09-needs-you.js:275-281 `noteQuota` `quotaLive`; web/js/99-boot.js:49; web/js/05-command-palette.js:170.
- css: 02-cards-lists-tags.css(`.tools-bar` `.lim` `.card`), 15-settings-pages.css(`.lim`).

### API 월 한도 (사용량 카드, 행, 대화창)
- 목적: Anthropic 콘솔의 월 한도(달러)를 입력해 이번 달 API 사용 비율을 보여 줘요.
- 구성: 한도가 있는 응답이면 격자 맨 앞 `API 월 한도` 카드(제목, `설정` 버튼, `$사용 / $한도` + `{n}% 남음`, 남은 만큼 채우는 막대, `{초기화 시각} (KST)` + 상대 시간 `N일 후 초기화`, `{월} · {출처}`). 없으면 사용량 화면에 행(`API 월 한도`, 부제 `정하지 않았어요` 또는 `월 $N`, 버튼 모양 `월 한도 바꾸기`).
- 기능: `budgetDialog`: 대화창 `API 월 한도`(월 한도 달러 입력, 관리자 키 입력, 설명 문구), 버튼 `취소` / (키가 있으면) `관리자 키 삭제` / `저장`. `PUT /api/api-budget` `{monthly_usd, admin_key | clear_admin_key}`.
- 상태: 출처 `콘솔 기준 (관리자 키)` 또는 `이 앱 사용분 추정`. 80% 이상이면 막대가 경고 톤. 한도 없음일 때 `이번 달 $N` / `월 한도 없음` / `콘솔에서 정한 월 한도를 설정에 입력하면 사용 비율을 보여줘요.` 서버가 준 `error`(경고)와 `hint`를 그대로 보여요. 대화창 설명 `Anthropic 콘솔에서 정한 월 한도(달러)예요. API로는 읽을 수 없어서 직접 입력해요. 비우면 한도 없이 사용액만 보여줘요.`, 키 있음 `관리자 키: {마스크}. 새 키를 붙여 넣으면 바꿔요.`, 키 없음 `관리자 키가 없어요. 콘솔 설정의 관리자 키 메뉴에서 만들어 붙여 넣으면 콘솔 기준 사용액을 보여줘요. 없으면 이 앱 사용분 추정만 보여줘요.` `키는 저장하기 전에 한 번 확인하고, 다시 보여주거나 기록에 남기지 않아요.` 저장 토스트 `저장했어요` / `관리자 키를 지웠어요`. 읽기 실패는 다음 렌더에서 다시 시도해요(`AB` 상태).
- 데이터: `GET|PUT /api/api-budget`, `GET /api/quota`의 `budget`.
- 근거: web/js/37-api-budget.js:4 `budgetCard`, :24 `budgetRow`, :29 `budgetSub`, :37 `budgetDialog`; web/js/21-providers.js:210-211 호출(`q.budget`이 있으면 `budgetCard`, 없으면 `budgetRow`).
- css: 02-cards-lists-tags.css(`.card` `.lim` `.bar`). `.budget-row` 전용 규칙은 web/css에서 못 찾음.

### 컨텍스트 (`#v-context`, `renderContext`)
- 목적: 어시스턴트와 세션 프로세스마다 컨텍스트가 얼마나 찼는지 보고, 압축하고, 모델별 크기와 자동 압축 시점을 정해요.
- 구성: `#context`: 프로세스 카드들(`.card`: 상태 점 + 이름(어시스턴트는 봇 이름) + 상태 태그, 모델 줄 `{모델} · {추론}`, 막대 + `{tokens} / {window} 토큰`과 퍼센트, 압축 상태 태그 + `압축` 버튼), `.sec` `모델별 컨텍스트 설정` + 모델 카드(`.card.ctx-model`: 모델 이름 + `설정`, `컨텍스트 크기`, `자동 압축`, `사용: {대상들}`).
- 기능: `압축`(`POST /api/compact` `{target}`), `설정`(`ctxDialog`). 열려 있는 동안 4초마다 `loadContext(true)`.
- 상태: 로딩 `불러오는 중…`, 실패 `컨텍스트를 불러오지 못했어요`. 실행 중이 아니면 막대 대신 `실행 중이 아니에요`, 대기 중이고 프로세스가 꺼져 있으면 `꺼져 있어요. 다음 메시지가 오면 다시 시작해요`. 60% 이상이면 막대가 주황(`ctxTone`, 빨강은 안 써요). 압축 상태 `압축 대기` / `압축 중 · {시각}` / `압축 완료 {시각} · {n} 토큰 전` / `압축 실패 {시각} · {오류}`. `압축` 버튼은 프로세스가 안 돌거나 압축 진행 중이면 disabled. 토스트 `{이름}: 작업 중이라 끝나면 압축해요` / `{이름}: 압축을 시작했어요`. 끝난 세션은 목록에서 빠지고 어시스턴트는 항상 남아요. 모델 카드: 값이 있으면 `{N} 토큰 · 직접 설정`, 없으면 `· 기본`, 크기를 모르면 `아직 모름 (처음 응답 뒤 표시)`, 자동 압축 `{N} 토큰 ({퍼센트}%) · 직접 설정|기본`, 사용처 이름은 `{봇 이름}` `새 세션 기본` 또는 세션 이름.
- 데이터: `GET /api/context`(`C`), `POST /api/compact`, `PUT /api/context/model`. SSE 직접 구독은 없고 `/model|effort|compact|restart...` 명령 후 `loadContext(true)`(05-command-palette.js:39), 홈 카드와 `renderCtxRing`도 같은 `C`를 써요.
- 근거: web/js/19-project-main.js:526 `renderContext`, :514 `loadContext`, :508 `ctxBar`, :500 `compactState`, :562 `ctxModels`; web/js/05-command-palette.js:171.
- css: 02-cards-lists-tags.css(`.card` `.heads` `.dot` `.bar` `.kv`), 15-settings-pages.css. `.ctx-model` 규칙은 web/css에서 못 찾음.

### 모델별 컨텍스트 설정 대화창 (`ctxDialog`)
- 목적: 한 모델의 컨텍스트 크기와 자동 압축 시작점을 직접 정해요(그 모델을 쓰는 모든 대상에 적용).
- 구성: 대화창 `{모델} 컨텍스트`: 설명, `컨텍스트 크기 (토큰)`, `자동 압축 시작 (토큰 또는 %)`, 범위 안내, 오류 줄. 버튼 `취소` / (직접 설정값이 있을 때) `기본값으로` / `저장`.
- 기능: `PUT /api/context/model` `{model, window, compact_at}`(`null` = 기본). 입력은 `300000` `300,000` `300k` `1.5m`, 압축 시점은 `80%`도 허용(`ctxParse`, %는 컨텍스트 크기를 알 때만).
- 상태: 오류 문구 `컨텍스트 크기는 토큰 수로 적어 주세요 (예: 1000000, 200k)`, `자동 압축 시점은 토큰 수나 %로 적어 주세요 (예: 300k, 80%). %는 컨텍스트 크기를 알 때만 써요`, 서버 오류는 같은 줄에. 성공 토스트 `저장했어요. 다음 턴부터 적용돼요` / `기본값으로 되돌렸어요`.
- 데이터: `PUT /api/context/model`, 한계값은 `C.limits`.
- 근거: web/js/19-project-main.js:575 `ctxDialog`, :553 `ctxParse`.
- css: 14-overlay.css, 03-base.css(`.fi`).

### 계정 블록 (Claude 구독, `accountSection`)
- 목적: Claude 구독 계정들을 순서, 자동 전환/고정, 한도에 걸렸을 때 동작, 전환 규칙으로 관리해요. 공급자 상세 `anthropic` 화면에 들어가요.
- 구성: `.sec.sec-act` 공급자 이름(쓰고 있으면 오른쪽에 `● 사용 중` 태그), 목록 한 카드: 맨 위 남은 한도 줄(`5시간`·`7일` 막대 + `64% 남음`, 공급자가 한도를 안 주면 없음), 작은 이름 `계정`, 계정 행들(잡고 끄는 손잡이 `.acc-grip`, 순번, 이름, 부제 `기본 · 5시간 62% · 7일 80% 남음`, 쓰는 계정은 `사용 중` 태그, 로그인이 풀린 계정만 오른쪽 `다시 로그인`), 맨 아래 `+ 계정 추가` 행, 작은 이름 `한도에 걸리면`, `자동 전환` 스위치 행, `물어보기` 두 값 알약(`기다리기` / `자동 전환`, 안 정했으면 `정하기`), 자동 전환 모드일 때 `전환 규칙`(부제는 규칙 요약) + `편집` 버튼, 스크립트 행, `마지막 결과` 행, 마지막 줄 `답장 초안은 API 키로 넘어가지 않아요.` 계정이 없는 공급자는 머리의 `계정 추가` 버튼과 로그인 행을 그대로 둬요.
- 기능: 스위치 `자동 전환`(`PUT /api/accounts/mode` `{mode:"pinned"|"auto"}`), 고정 모드에서 행을 누르면 그 계정으로 고정(`{mode:"pinned", account}`), 자동 모드에서 행을 누르면 `accDialog`, 손잡이 끌기 또는 ArrowUp/ArrowDown 또는 터치 길게 누르기(450ms)로 순서 변경(`PUT /api/accounts/order`), `한도에 걸렸을 때`(`PUT /api/accounts/on-limit`), `전환 규칙` `편집`(`rulesDialog`), 스크립트 행 누르면 경로 복사(`accCopy`), `계정 추가`(`startLogin({..., add_account:true})`), `다시 로그인`(`startLogin(공급자)`). 계정 행을 누르면 계정 창이 열리고 거기서 `계정 삭제`를 해요(카드에는 휴지통이 없어요). 저장된 이름 `default`는 화면에서 `기본`으로만 보여요.
- 상태: 태그 `사용 중`, `사용 중 · 고정`, 한도로 막힌 계정은 `{blocked_tag}` 또는 `쓸 수 없음`(주황), 로그인이 풀린 계정은 태그 대신 `다시 로그인` 버튼, 그 밖에는 태그 없음. 부제 `5시간 {n}% 남음 · 7일 {n}% 남음`. `자동 전환` 설명: 고정이면 `{라벨}만 써요. 한도에 걸리면 다른 계정으로 넘어가지 않고, 폴백 순서에 다른 단계(API 키 포함)가 있으면 그 단계로 이어 가요. 답장 초안은 API 키로 넘어가지 않아 한도가 풀릴 때까지 멈춰요.`, 자동이면 `규칙과 한도에 따라 계정을 골라요. 쓰던 계정이 막히면 다른 계정으로 넘어가고, 모두 막히면 폴백 순서(API 키 포함)를 따라요. 답장 초안은 API 키로 넘어가지 않아요.` `물어보기` 부제 `한도에 걸리면 자동 전환으로 넘어가요` / `한도에 걸린 동안 기다려요` / `아직 정하지 않았어요`. 규칙이 없으면 `전환 규칙` 부제 `계정이 막힐 때만 자동으로 바꿔요.` 스크립트 부제 `{n}초 안에 끝나요 · {n}분마다`, 마지막 결과 `마지막 결과 · {라벨 또는 고르지 않음}` / `마지막 실행이 실패했어요`. 토스트 `고정 계정을 바꿨어요`, `자동 전환으로 바꿨어요`, `고정했어요`, `한도에 걸렸을 때 기다리기로 정했어요`, `한도에 걸렸을 때 자동 전환으로 넘어가기로 정했어요`, `복사했어요` / `복사하지 못했어요`. `ACC`가 없으면 블록 자체가 없어요(빈 배열). 드래그 직후의 클릭은 무시(`accSwallow`).
- 데이터: `GET /api/accounts`(`ACC`), `PUT /api/accounts/mode|order|on-limit|rules|alias`, `DELETE /api/accounts?name=`.
- 근거: web/js/25-settings-accounts.js:66 `accountSection`, :16 `accTags`, :28 `accDrag`, :7 `loadAccounts`, :14 `accMut`.
- css: 02-cards-lists-tags.css(`.acc` `.acc-grip` `.acc-main`), 01-tokens.css/06-harness.css/18-app-settings.css(`.sec-act`).

### 계정 상세 대화창 (`accDialog`, `accProviderDialog`)
- 목적: 계정 하나의 별칭을 바꾸거나 고정/삭제해요.
- 구성: 대화창(제목 = 계정 라벨, 이름이 `default`면 `기본`, 타 공급자는 `{공급자} · {라벨}`): 계정 이름 코드 표시, `별칭` 입력(placeholder `별칭 (예: 회사, 개인)`). 버튼 `계정 삭제`(왼쪽 끝), `이 계정으로 고정` / `고정 풀기`(타 공급자), `저장`. 별칭은 칸을 비우고 저장하면 지워져요(따로 지우는 단추는 없어요).
- 기능: 별칭 `PUT /api/accounts/alias`, 삭제 확인창 `{라벨} 삭제`(삭제 뒤 토스트 `{라벨}을(를) 삭제했어요`) / `OmO에서 이 계정의 로그인 정보를 지워요. 다시 쓰려면 다시 로그인해야 해요.`(`DELETE /api/accounts?name=` 또는 `?provider=&name=`), 고정 `PUT /api/accounts/mode` 또는 `/api/accounts/pin`. Enter = 저장.
- 상태: `계정 삭제`는 Claude 쪽은 계정이 2개 이상일 때만. 하나뿐이면 그 자리에 `로그아웃`이 있어요(`logoutProvider`, 카드에 휴지통이 없어서 설정에서 나가는 길은 여기예요). 이미 고정된 계정이면 `이 계정으로 고정`이 disabled. 토스트 `별칭을 저장했어요` `별칭을 지웠어요` `{라벨}을(를) 지웠어요` `{라벨}로 고정했어요` `고정을 풀었어요`.
- 데이터: 위 API들.
- 근거: web/js/25-settings-accounts.js:160 `accDialog`, :145 `accProviderDialog`.
- css: 14-overlay.css(`dialog.dlg.cl`).

### 전환 규칙 대화창 (`rulesDialog`)
- 목적: 계정 자동 전환 규칙(요일, 시간, 조건, 동작)을 폼 또는 JSON으로 고쳐요.
- 구성: 넓은 대화창 `전환 규칙`: 규칙 카드마다 이름 입력(placeholder `규칙 {n} 이름 (선택)`), `위로` `아래로` `삭제`(한 묶음 `.rl-ord`), `요일 (선택)` 칩(월~일, `.rl-days`. 폰에서는 일곱 개가 같은 폭으로 한 줄), `시간 (선택)` 시작 ~ 끝, `조건` 드롭다운(`없음` `5시간 남은 % 밑` `주간 남은 % 밑` `한도 걸림` `로그인 풀림` `특정 계정 못 씀`)과 값, `동작` 드롭다운(`계정 고정` `순서대로 우선` `자동`)과 계정 선택/칩, 하단 `규칙 추가`. 버튼 `취소` / `JSON으로 편집`(또는 `폼으로 보기`) / `저장`.
- 기능: 저장 `PUT /api/accounts/rules` `{rules}`.
- 상태: 규칙이 없으면 `규칙이 없어요. 계정이 막힐 때만 자동으로 바꿔요.` 조건이 여러 개인 규칙은 `조건이 여러 개예요. 모두 바꾸려면 채팅에서 말해 주세요.` JSON 모드에서 잘못된 입력은 토스트 `JSON 모양이 맞지 않아요`. 성공 토스트 `규칙을 저장했어요`.
- 데이터: `PUT /api/accounts/rules`.
- 근거: web/js/25-settings-accounts.js:172 `rulesDialog`, :4-6 `ACC_COND` `ACC_DO` `ACC_DAYS`.
- css: 14-overlay.css, 03-base.css(`.fi`, `.chip`는 클래스만 확인).

### 다른 공급자 계정 블록 (`accProviderSections`)
- 목적: Claude 외 공급자(OmO가 계정 풀을 가진 곳)의 계정과 한도 창을 공급자 상세에서 보여 줘요.
- 구성: `.sec` `계정` + 목록: 계정 행(순번, 라벨, 한도 창 `{라벨} {n}% 남음 · ...`, 태그 `사용 중` `고정` `쓸 수 있음` 등).
- 기능: 행을 누르면 `accProviderDialog`. 계정이 없고 `can_add`이면 `추가`(`startLogin({..., add_account:true})`).
- 상태: 계정이 없으면 `{이름} 계정이 없어요` / `계정을 하나 넣으면 여기 보여요.`(추가 불가이면 `공급자 화면에서 키를 넣어 주세요.`). 막힘 태그는 `blocked_tag`, 없으면 로그인 풀림이면 `로그인 필요`, 그 외 `쓸 수 없음`.
- 데이터: `ACC.providers[]`.
- 근거: web/js/25-settings-accounts.js:122 `accProviderSections`.
- css: 02-cards-lists-tags.css(`.acc`).

### 메신저 목록 (`#v-messengers`, `renderMessengers`)
- 목적: Discord, JANDI, Slack, Telegram 중 어느 것이 연결됐는지 보고 각 화면으로 들어가요.
- 구성: `#messengers`: 목록(행 4개: 아이콘, 이름, 부제, 상태 점 + 화살표), 하단 설명 `메신저로도 같은 대화를 받을 수 있어요. 웹 앱은 항상 모두 받아요.`
- 기능: 행을 누르면 `go(id)`.
- 상태: 부제는 에러가 있을 때만 그 문구예요. 상태는 오른쪽에 점 + 낱말 하나(`연결됨` / `연결 안 됨` / `설정 안 됨`, 점 색 초록/빨강/주황)로 한 번만 말해요. 인덱스를 아직 못 읽으면 상태가 비어요. 인덱스는 화면에 들어올 때 한 번 읽고 렌더마다 다시 읽지 않아요.
- 데이터: `GET /api/messengers`(`items`).
- 근거: web/js/25-settings-messengers.js:32 `renderMessengers`, :50 `loadMessengerIndex`, :10 `msTag`; web/js/05-command-palette.js:169.
- css: 07-messengers.css, 02-cards-lists-tags.css.

### JANDI / Slack / Telegram 설정 (`#v-jandi` `#v-slack` `#v-telegram`, `renderMessenger`)
- 목적: 일반 메신저 하나의 연결, 알림 종류, 방 목록, 허용 목록, 연결 확인, 직접 입력 값을 한 화면에서 다뤄요(셋이 같은 렌더러).
- 구성: `.sec` `연결`(상태 행: 아이콘, 이름, 한 줄 설명, 태그, 버튼 `연결` / `켜기`), `.sec` `자동 연결` + 온보딩 패널(실행 중/대기/실패일 때, 또는 아직 연결 전일 때), `.sec` `알림`(서버가 `notify`를 주면 6종 스위치 + 설명), `s.rooms.label` 구역(방별 점, 이름, `→ {메인 대화|프로젝트|알림|작업내역} · {프로젝트}`, `받음 {시각}` `보냄 {시각}`, 방 오류), `s.allow.label` 구역(허용 목록 읽기 전용), 목록 `연결 확인`(행 + `확인` 버튼), 접힘 `직접 입력`.
- 기능: `연결`/`켜기`(`msConnect`: 설정은 됐지만 꺼져 있고 오류가 없으면 `PUT /api/messengers/{id}` `{enabled:true}`, 아니면 온보딩 시작 `obStart`), 알림 스위치 즉시 저장(`msNotifySet` -> `PUT` `{notify:{k:on}}`, 실패하면 되돌리고 토스트), `확인`(`msTest` -> `POST /api/messengers/{id}/test`), `직접 입력`의 값 폼과 `사용` 스위치와 허용 목록 추가/빼기와 `저장`(`msSave` -> `PUT` `{enabled, values, allow}`, 바뀐 것이 있어야 enabled, 저장 후 버튼이 잠깐 `저장했어요`).
- 상태: 로딩 `불러오는 중`, 실패 `메신저 설정을 불러오지 못했어요`. 상태 문구(`msLine`): 에러면 그 문구, `연결을 누르면 자동으로 설정해요.`, `설정은 돼 있어요. 켜기를 누르면 알림을 보내요.`, JANDI는 `방 {n}개`, 그 외 연결된 상태는 줄 없이 태그만 (연결 전에는 연결 줄과 `직접 입력`만 보이고 알림·방·사람·연결 확인은 숨겨요). 단추는 연결돼 있으면 `다시 연결`. 허용한 사람은 같은 id의 방 이름이 있으면 이름 + id 부제. 태그 `설정 안 됨` / `연결 안 됨` / `연결됨`. 알림 설명 `끄면 그 알림은 여기로 보내지 않고 앱에만 와요.` 연결 확인 결과 줄 `{방}: 보냈어요` / `{방}: {오류 또는 보내지 못했어요}` / 방이 없으면 `방이 없어요`. 필드: 읽기 전용, 비밀(저장돼 있으면 태그 `저장됨`, placeholder `바꾸려면 새로 붙여 넣기`, 계정 대행이면 태그 `내 계정으로 보냅니다`), 숫자, 텍스트. 허용 목록 행의 `빼기`는 `aria-label` `{값} 빼기`, 추가 버튼 `추가`. 방 점: 오류 빨강, 오가는 메시지가 있으면 초록.
- 데이터: `GET /api/messengers`, `GET|PUT /api/messengers/{id}`, `POST /api/messengers/{id}/test`, `/api/onboarding/{id}*`. SSE 구독 없음(온보딩은 폴링).
- 근거: web/js/25-settings-messengers.js:174 `renderMessenger`, :59 `loadMessengerSettings`, :70 `msLine`, :78 `msConnect`, :92 `msNotifySet`, :116 `msSave`, :135 `msTest`, :141 `msFieldInput`, :153 `msAllowEditor`, :161 `msAdvancedBody`, :105 `msDirty`; web/js/05-command-palette.js:173; web/index.html `#v-jandi` `#v-slack` `#v-telegram`.
- css: 07-messengers.css(`.ms-adv`), 06-harness.css(`.dcs-*` `.ms-copy` `.ms-link`), 02-cards-lists-tags.css, 15-settings-phone.css.

### Discord 설정 (`#v-discord`, `renderDiscord`)
- 목적: 디스코드 봇 연결(토큰, 서버 ID, 내 사용자 ID)과 어떤 알림과 대화를 디스코드로도 보낼지 정해요.
- 구성: `.sec` `연결`(상태 행 `Discord 봇`: 봇 이름 부제, 태그, 버튼 `다시 연결`/`켜기`), `자동 연결` 패널, `.sec` `알림`(5종 스위치: 답변 필요, 경고, 결과, 새 소식, 대화), `.sec` `대화별로 디스코드에도 보내기`(`대화 답장` `세션 보고` `작업내역` `웹에서 시작한 세션`), `연결하는 방법` 안내(연결 전만), 접힘 `직접 입력`(서버 ID, 내 사용자 ID, 봇 토큰, `저장`, `연결 확인`, `토큰 지우기`).
- 기능: `dcSave`(`PUT /api/discord/connection`), `dcCheck`(`POST /api/discord/connection/check`), `dcClear`(`DELETE /api/discord/connection`, 확인창 `봇 토큰 삭제` / `저장된 봇 토큰을 삭제해요. 게이트웨이를 다시 시작하면 디스코드 연결이 끊겨요.`, 버튼 `삭제`, 열기 버튼 `토큰 삭제`), `dcRestart`(`POST /api/update/restart` -> 토스트 `작업이 끝나면 다시 켜져요. 이 화면은 자동으로 다시 연결돼요`), 스위치 `dpSet`(`PUT /api/discord/post` 즉시, 실패 시 되돌림).
- 상태: 로딩 `불러오는 중`, 실패 `Discord 설정을 불러오지 못했어요`. 상태(`dcStatus`): 꺼져 있으면 `설정 안 됨`(토큰만 있으면 `토큰은 저장돼 있어요. 서버 ID와 내 사용자 ID까지 저장하고 게이트웨이를 다시 시작하면 연결돼요.`, 없으면 `아직 Discord 봇이 연결되지 않았어요.`), 연결됨 `{사용자}`(봇 이름만, 없으면 줄 없음), 오류 `연결 안 됨` + 오류 문구, 아니면 `연결 중` / `연결하는 중이에요.` 스위치 영역은 연결되기 전(또는 `/api/discord/post` 실패)에는 `연결하면 고를 수 있어요`로 대신해요. 스위치 설명 `끄면 그 알림은 디스코드로 가지 않고 앱에만 와요. 디스코드에서 직접 물은 것의 답은 디스코드에도 가요.` / `끄면 웹에만 와요. 디스코드에서 직접 물은 것의 답은 디스코드에도 가요.` `웹에서 시작한 세션`만 기본 꺼짐(`=== true`일 때 켜짐). 연결 확인 결과: 실패 `확인하지 못했어요` 또는 서버 오류 + 인텐트 안내, 성공 `봇 {이름 또는 이름 없음}`, `관리자 권한 확인됨` / `관리자 권한이 없어요.` + `봇 권한 다시 승인` 링크 / `서버 ID를 저장하면 관리자 권한도 확인해요`. 바꾼 값이 없으면 `바꾼 값이 없어요`. `restart_needed`이면 행 `게이트웨이를 다시 시작하면 적용돼요` + `다시 시작`. 안내 3단계(`연결하는 방법`): `디스코드 개발자 포털(discord.com/developers)에서 새 앱을 만들고 Bot 탭에서 MESSAGE CONTENT를 켠 뒤 봇 토큰을 복사해요` / `초대 링크로 내 서버에 봇을 초대해요 (위에서 저장한 뒤 연결 확인을 누르면 초대 링크가 나와요)` / `봇 토큰, 서버 ID, 내 사용자 ID를 ‘직접 입력’에 붙여 넣고 저장해요`.
- 데이터: `GET|PUT|DELETE /api/discord/connection`, `POST /api/discord/connection/check`, `GET|PUT /api/discord/post`, `GET /api/messengers`, `/api/onboarding/discord*`.
- 근거: web/js/25-settings-discord.js:112 `renderDiscord`, :17 `loadDiscord`, :30 `dcSave`, :49 `dcCheck`, :56 `dcClear`, :61 `dcRestart`, :65 `dcStatus`, :75 `dcSwitches`, :89 `dcChecked`, :101 `dcAdvanced`, :24 `dpSet`, :5 `DP_KINDS`; web/js/05-command-palette.js:172.
- css: 06-harness.css(`.dcs-form` `.dcs-res` `.dcs-ok` `.dcs-err` `.dcs-acts` `.dcs-saved`), 07-messengers.css(`.ms-adv`).

### 연결 자동 설정 패널 (`onboardingPanel`)
- 목적: 메신저와 웹 접속의 자동 연결 단계를 돌리고, 오너가 해야 할 한 가지만 알려 줘요. 토큰이나 서버가 주지 않은 오류는 그리지 않아요.
- 구성: 목록 `.list.ms-onb[data-onb][data-onb-state]`: 상태 행(점 + `자동 연결` + 한 줄 + 오른쪽 버튼들), 단계 행(제목, 상세), 오류 행, 오너 할 일 행, 링크 행. 구역 머리 `자동 연결`(`obSection`).
- 기능: `연결`(`obStart` -> `POST /api/onboarding/{key}/start`), `계속`(`obAct` `continue`), `다시 시작`, `취소`(`cancel`). 실행 중/대기 중에는 1.5초 폴링(`GET /api/onboarding/{key}`), 화면을 떠나면 멈춰요. 대기 상태에서 4초 뒤 한 번 자동 `continue`(최대 1회).
- 상태: `연결`을 누르면 답이 오기 전에도 그 단추가 `연결하는 중`으로 잠기고 이 줄이 진행 중(취소 없음)이 돼요(`OB_WAIT`). 시작이 실패하면 `연결을 시작하지 못했어요 · … 잠시 뒤에 다시 눌러 주세요` 띠와 함께 단추가 돌아와요. 한 줄 `아직 시작하지 않았어요.` / `자동으로 연결하는 중이에요.` / `내가 할 일이 하나 남았어요.` / `연결했어요.` / `연결하지 못했어요.` 점 색 파랑(running), 주황(waiting), 초록(done), 빨강(failed), 깜박이지 않음. 대기/실패이면 `계속`, 실패이면 `다시 시작`, 실행/대기이면 `취소`. 오류는 `role="alert"`. 이미 연결된 메신저는 실행 중/대기/실패가 아니면 이 구역을 숨겨요. 상태가 바뀌면 같은 행이 부드럽게 교체(`motionSwap`). 완료되면 인덱스와 해당 화면을 다시 읽어요(`obAfterDone`). 키는 `web-access` `discord` `jandi` `slack` `telegram`만 허용.
- 데이터: `GET /api/onboarding/{key}`, `POST /api/onboarding/{key}/start|continue|cancel`.
- 근거: web/js/25-settings-onboarding.js:94 `onboardingPanel`, :40 `obApply`, :21 `obAuto`, :76 `obPoll`, :68 `obStart`, :73 `obAct`, :89 `obSection`, :57 `obAfterDone`, :63 `loadOnboarding`, :11 `obLine`; 보조 `stFlash` :116, `msAdvanced` :124.
- css: `.ms-onb` 전용 규칙은 web/css에서 못 찾음(`.li` `.dot` 재사용), 07-messengers.css(`.ms-adv`), 06-harness.css(`.ms-link`).

### 연결된 기기 (`#v-devices`, `renderDevices`)
- 목적: Cloudflare 모드에서 패스키로 연결한 브라우저들을 보고 이름 바꾸기, 해제, 새 기기 연결을 해요.
- 구성: `#devices`: `.sec` `이 웹앱을 쓸 수 있는 기기` + 목록(기기 행: 이름, `{날짜 = 올해는 `9월 30일`처럼 연도 없이} 연결 · 마지막 사용 {n}분 전|아직 쓰지 않음`, 이 기기 태그 `이 기기`), 패스키 없는 브라우저에는 행 `이 기기에 패스키 추가` / `이 브라우저는 패스키 없이 들어왔어요`, 행 `새 기기 연결` / `코드를 만들어 다른 기기를 연결해요`.
- 기능: 기기 행 -> `dvOpen`, `새 기기 연결` -> `dvNew(false)`, `이 기기에 패스키 추가` -> `dvNew(true)`.
- 상태: 로딩 `불러오는 중`, 실패 `연결된 기기를 불러오지 못했어요`, 없으면 `연결된 기기가 없어요`. `/api/devices`가 응답하지 않는 설치(Cloudflare 모드 아님)에서는 설정 목록에 이 항목이 없어요. 시간 표기 `방금` `{n}분 전` `{n}시간 전` `{n}일 전`.
- 데이터: `GET /api/devices`, `PATCH|DELETE /api/devices/{id}`, `POST /api/devices/code`.
- 근거: web/js/25-settings-devices.js:20 `renderDevices`, :8 `loadDevices`, :15 `devicesRow`, :5-6 `dvDate` `dvUsed`; web/js/25-settings-messengers.js:13 `msAgo`; web/js/05-command-palette.js:174.
- css: 02-cards-lists-tags.css(`.li`), 06-harness.css(`.dv-code` `.dcs-saved`).

### 기기 이름/해제 대화창 (`dvOpen`)
- 목적: 기기 하나의 이름을 바꾸거나 해제해요.
- 구성: 대화창(제목 = 기기 이름): `기기 이름` 입력(최대 60자), 연결 정보 줄, 지금 쓰는 기기이면 태그 `지금 쓰고 있는 기기`. 버튼 `해제`(빨간 채움, 확인창의 삭제 단추와 같은 종류) / `저장`; 닫기는 머리의 ✕ 하나.
- 기능: `PATCH /api/devices/{id}` `{name}`, `DELETE /api/devices/{id}`.
- 상태: 이름이 비면 토스트 `이름을 적어 주세요`, 같으면 그냥 닫아요. 해제 확인창 `기기 해제`: 이 기기면 `지금 쓰고 있는 이 기기를 해제해요. 바로 로그아웃되고, 다시 쓰려면 메신저로 받은 코드로 새로 연결해야 해요.`(해제 후 `/pair`로 이동), 다른 기기면 `{이름}의 로그인이 바로 끊겨요. 다시 쓰려면 코드로 새로 연결해야 해요.`(버튼 `해제`). 토스트 `저장했어요` / `기기를 해제했어요`(행이 150ms 나가는 모션 후 목록 다시 읽기).
- 데이터: `PATCH|DELETE /api/devices/{id}`.
- 근거: web/js/25-settings-devices.js:39 `dvOpen`.
- css: 14-overlay.css, 06-harness.css(`.dcs-saved`).

### 새 기기 연결 대화창 (`dvNew`)
- 목적: 새 기기를 연결하는 방법을 알려 주고 여기서 바로 6자리 코드를 만들어요.
- 구성: 대화창 `새 기기 연결` 또는 `이 기기에 패스키 추가`: 제한 안내, 채운 버튼 `여기서 코드 만들기`, 결과 영역(QR과 큰 코드 `.dv-code` 뒤에 번호 단계 목록 — 코드를 만들기 전에는 단계도 QR 안내도 안 보여요, 유효 시간 안내, `연결 화면 주소` 읽기 전용 입력 + `복사` 또는 `연결 화면 열기` 링크). 버튼 `닫기`.
- 기능: `POST /api/devices/code` -> `{code, url, minutes}`. 닫으면 목록을 다시 읽어요.
- 상태: 안내 `코드는 10분 동안 한 번만 쓸 수 있고, 메신저와 이 화면을 합쳐 한 시간에 3번까지 만들 수 있어요.` 결과 안내 `{n}분 동안 한 번만 쓸 수 있어요. 새 코드를 만들면 이 코드는 사라져요.` 단계(다른 기기): `새 기기의 브라우저에서 이 웹앱 주소를 열어요. '기기 연결' 화면이 나와요.` / `'코드 받기'를 누르면 6자리 코드가 메신저 알림으로 와요. 메신저를 볼 수 없으면 아래에서 바로 만들 수 있어요.` / `코드와 기기 이름을 넣고 패스키(Face ID, 지문, Windows Hello 등)로 확인하면 끝나요.` 단계(이 기기): `아래에서 코드를 만들어요.` / `'연결 화면 열기'를 눌러 코드와 이 기기 이름을 넣어요.` / `패스키(Face ID, 지문, Windows Hello 등)로 확인하면 끝나요.` 복사 토스트 `복사했어요`.
- 데이터: `POST /api/devices/code`.
- 근거: web/js/25-settings-devices.js:69 `dvNew`.
- css: 06-harness.css(`.dv-code` `.ms-copy` `.dcs-acts` `.dcs-res`), 03-base.css(`.steps`).

### 웹 접속 (`#v-webaccess`, `renderWebAccess`)
- 목적: 웹앱을 어떻게 여는지(Tailscale, Cloudflare, 이 컴퓨터만) 고르고 Cloudflare 터널 상태와 직접 입력 값을 관리해요.
- 구성: `.sec` `접속 방식` + 라디오 목록 3행(`Tailscale` `Cloudflare` `이 컴퓨터만`, 각 설명, 선택은 체크), `.sec` `자동 연결` + 온보딩 패널(`web-access`), Cloudflare이면 `.sec` `상태` + 목록(`터널` 행, `연결된 기기 (패스키)` 행 + 대수 태그), 터널 프로그램이 없으면 안내 행, 접힘 `직접 입력`(주소, 팀 이름 (선택), 확인 번호 (선택), 터널 토큰, `저장`, `되돌리기`).
- 기능: `Tailscale` 선택은 즉시 `PUT /api/web-access` `{mode:"tailscale"}`(`waPickTailscale`). `Cloudflare` 또는 `이 컴퓨터만`은 `POST /api/web-access/onboard` `{mode[, hostname]}`로 자동 연결 시작(`waOnboard`, 모드를 먼저 화면에 반영). `저장`(`waSave` -> `PUT /api/web-access`, 바뀐 값만). `연결된 기기 (패스키)` -> `go("devices")`.
- 상태: 로딩 `불러오는 중`, 실패 `웹 접속 설정을 불러오지 못했어요`. 설명: `Tailscale로 연결한 내 기기에서 열어요. 기본값이에요.` / `Cloudflare 터널로 고정 주소를 열어요. 연결은 자동으로 진행하고, 필요한 한 가지 동작만 알려드려요.` / `이 컴퓨터에서만 열어요.` 터널 상태 `연결됨`(초록) `연결 중`(주황) `연결 안 됨`(빨강) `꺼짐`, 부제 `터널이 열려 있어요` / 터널 오류 / 프로그램 없음 `터널 프로그램이 없어요. 채팅에서 ‘웹 접속 설치해 줘’라고 말해 주세요.`. 직접 입력 도움말 `터널에 연결해 둔 주소예요. 주소를 바꾸면 기기를 다시 연결해야 해요.` `Cloudflare Access로 한 번 더 확인할 때만 적어요. 확인 번호와 함께 적어요.` `Access 앱 화면의 Audience Tag 값이에요.` 토큰 placeholder `eyJ…`, 저장돼 있으면 `바꾸려면 새로 붙여 넣기` + 태그 `저장됨` + `저장하면 이 컴퓨터에만 보관하고, 화면에는 다시 보여 주지 않아요.` `저장`은 바뀐 값이 있을 때만 enabled, `되돌리기`는 바뀐 값이 있을 때만 보여요. Cloudflare에서 주소를 비우고 저장하면 토스트 `주소를 적어 주세요`. 저장 후 버튼이 잠깐 `저장했어요`. 완료되면 인덱스와 이 화면을 다시 읽어요.
- 데이터: `GET|PUT /api/web-access`, `POST /api/web-access/onboard`, `/api/onboarding/web-access*`, `GET /api/devices`.
- 근거: web/js/25-settings-web-access.js:78 `renderWebAccess`, :13 `loadWebAccess`, :32 `waTunnel`, :44 `waOnboard`, :52 `waPickTailscale`, :62 `waAdvanced`, :101 `waSave`, :28 `webAccessRow`, :4 `WA_MODES`; web/js/05-command-palette.js:175-176.
- css: 06-harness.css(`.dcs-*`), 07-messengers.css(`.ms-adv`), 02-cards-lists-tags.css.

### 앱 설정 화면 (`asScreen`, `asPaint`)
- 목적: 모니터링 앱(또는 감시, 예약) 하나의 설정을 스위치와 값으로 바로 바꾸고, 연결 상태, 기능, 승인 대기, 감시 상태를 봐요. 모니터링의 앱/감시 상세의 `⋯` 버튼으로 열려요(설정 탭 목록에서 직접 들어가는 항목은 없고, 모니터링 상세의 `⋯` 버튼 `asMoreBtn`과 모델 · 폴백의 `실제로 쓰는 모델` 카드 연필 버튼이 `asScreen`을 열어요).
- 구성: 큰 시트(`fsOpen`, `tall as-screen`): 머리(뒤로 버튼 `뒤로`, 눈썹 `설정`, 제목 = 앱/감시 이름), 본문 `#app-sw`: 맨 위 연결 행(`연결됨`/`연결 끊김`/`연결 상태를 확인 중이에요`, 점 색), 그리고 구역 `알림` `자동 초안과 승인` `감시` `기타 기능` `고급`(행이 있는 구역만). 구역 안 행 순서: 기능을 켜는 스위치, 기능 행, 다른 값, 목록, 대기/실행 중인 것.
- 기능: 값 행마다 컨트롤(`asControl`: 스위치, 두 값 `seg`, 선택, 숫자 − + 스테퍼, 텍스트)이 바꾸는 즉시 `PATCH`(`asPatch`). 기능 스위치(`asFeatSet` -> `PATCH /api/integrations/{app}/features` `{id,on}`), 승인 대기는 수와 `›`가 있는 한 줄(`asWaitRow`)이고 누르면 설정을 닫고 그 앱의 답장 대기(`rqOpen`)를 열어요(보내기·버리기는 거기서), 감시 주기 숫자(`asEvery`, 1~10080분), `다시 시도` / `다시 연결`(`asRetry` -> `POST .../retry`), `지켜볼 글` + `고르기`, 자동 초안 규칙, 제거/삭제.
- 상태: 로딩 `불러오는 중…`, 실패 `설정을 불러오지 못했어요`. 연결 끊김 부제 `{시각}부터 연결이 끊겼어요` 또는 서버 힌트 또는 `다시 로그인해 주세요`; 정상은 `마지막 확인 {시각}`; 다른 컴퓨터 앱은 `{컴퓨터}에서 쓰는 앱이에요`. 값 형식: bool `켜짐`/`꺼짐`, 목록 `{n}개`/`없음`, 열거는 라벨. 목록 값은 여기서 고치지 않고 개수만 보여 줘요(대화에서 바꿔요). 기억 항목은 `기억해 둔 것` 행에 읽기 전용(`{라벨}: {값}` 또는 `아직 없어요`, 안내 `대화에서 알려 주면 봇이 기억하고 참고해요. 바꾸려면 대화에서 말해 주세요`). 승인 대기 행 `승인 대기` + `{n}건` + `›`(없으면 행이 없어요). 감시 상태 행: 점(초록/빨강/회색), 이름, 상태 줄, `연속 실패 {n}번`, `마지막 정상 {시각}`, `마지막 결과: {...}`, `이유: {...}`, 주기 `{n}분마다`(다른 컴퓨터는 읽기 전용, 이 컴퓨터는 입력 + `분`). 주기 범위 밖이면 토스트 `1분에서 7일 사이로 정해 주세요`. 오류 토스트 `기능을 바꾸지 못했어요` `다시 시도하지 못했어요` `답하지 못했어요` `감시 주기를 바꾸지 못했어요` `설정을 바꾸지 못했어요`. 다른 컴퓨터 앱(`<앱>~<컴퓨터>`)은 같은 화면이 그 컴퓨터의 프록시로 읽고 써요(`pqPc`, `pqProxy`). 재그림은 서명(`sig`) 비교로 같으면 건너뛰어요.
- 데이터: `GET|PATCH /api/integrations/{app}/settings`, `/api/watches/{name}/settings`, `/api/schedules/{id}/settings`, `GET|PATCH /api/integrations/{app}/features`, `POST /api/integrations/{app}/retry`, `POST /api/integrations/{app}/approve`(다른 컴퓨터) 또는 `POST /api/notices/{id}/answer`, `POST /api/peer/act`. SSE는 이 화면 전용이 없고 모니터링/알림의 갱신에 따라 `asPaint`가 다시 그려져요.
- 근거: web/js/32-app-settings.js:499 `asScreen`, :445 `asPaint`, :421 `asConnNode`, :432 `asSettingRow`, :338 `asControl`, :80 `asStatRow`, :60 `asWaitRow`, :69 `asEvery`, :105 `asPickRow`, :110 `asFeatRow`, :115 `asPatch`, :14 `asLoad`, :27 `asFeatLoad`, :413 `AS_SECTIONS`.
- css: 18-app-settings.css(`.as-row` `.as-screen` `.as-sec` `.as-card`), 01-tokens.css/06-harness.css(`.sec-act`).

### 앱 설정 변경 카드 (`settingsCardHtml`)
- 목적: 대화 답이 준 설정 변경 제안(코드 블록 `dotz-settings`)을 이전 값 -> 새 값 카드로 그려 `적용`/`취소`를 받아요.
- 구성: `.as-card`: 제목 `설정 바꾸기 제안`, 행(이름, 값), 하단 `적용` / `취소`.
- 기능: `적용` -> `asPatch(app, changes)`. `취소`는 로컬 기록만. 결과는 localStorage `dotz.settings.cards`에 저장.
- 상태: 읽기 실패 `변경 제안을 읽지 못했어요`. 바뀌는 값은 이전 값을 회색 취소선, 새 값을 굵게. 목록은 `추가 ... · 뺌 ...` 또는 `달라지는 것 없음`. 기억 항목만이면 `기억해 뒀어요`(적용 버튼 없음). 처리 후 `적용했어요` / `취소했어요`로 같은 자리에서 교체. 적용 실패 토스트 `설정을 바꾸지 못했어요`.
- 데이터: `PATCH` 위 설정 API.
- 근거: web/js/32-app-settings.js:579 `settingsCardHtml`(바로 아래 `document` click 위임 처리), :331 `asChange`, :324 `asFmt`.
- css: 18-app-settings.css(`.as-card` `.as-cr` `.as-old` `.as-now`).

### 앱 관리 시트 (`asAddSheet`)
- 목적: 꺼 둔 앱을 다시 켜거나 지우고, 새 앱을 연결해 달라는 요청을 메인 대화에 보내요. 설정 목록의 `앱 관리` 행(`go("apps")`)과 별개로 모니터링 쪽에서 열려요.
- 구성: 중간 시트(`fsOpen` `mid`, 폰은 아래에서 올라오는 시트): 머리 `앱 관리`, 본문 상단 `.as-sec` `새 앱 추가` 아래 입력 상자(크기 조절 손잡이 없음, placeholder `어떤 앱을 연결하거나 만들까요?`), `.as-sec` `꺼 둔 앱` 행(아이콘, 이름, `{컴퓨터}`(다른 컴퓨터의 앱일 때만, 구역 이름이 이미 꺼 둔 앱이라 "꺼져 있어요"는 쓰지 않아요), `다시 켜기`, `삭제`), 삭제 확인 블록, 하단 `취소` / `맡기기`.
- 기능: `맡기기`(Enter, Shift+Enter 줄바꿈) = 메인 대화로 `연결할 앱: {입력}`을 보내요(`asNewSend`). `다시 켜기`(`asAdd` -> `POST /api/integrations/{key}/add`, 다른 컴퓨터는 `POST /api/peer/act`), `삭제`(`asDelAsk` -> 확인 -> `DELETE /api/apps/{key}[?data=1]`).
- 상태: 입력이 비어 있으면 `맡기기`는 꺼 두고(Enter는 입력 상자로 포커스만), `삭제`는 지우는 줄 단추(`btn danger`)예요. 삭제 확인: `{컴퓨터에서 }{라벨} 앱을 완전히 지워요. 되돌릴 수 없어요` / `이름과 설정을 지우고, 앱 목록에서 빠져요` / `감시 {n}개를 지워요: ...` 또는 `지울 감시는 없어요`, 체크박스 `저장된 데이터(...)도 지우기. 체크하지 않으면 남겨요`, 버튼 `삭제 확인`(지우는 동작용 `btn danger fill`) / `취소`. 다시 켜기 토스트 `{라벨}을(를) 다시 켰어요` / `{컴퓨터}에서 {라벨}을(를) 다시 켰어요` / 재연결 필요 `{라벨}을(를) 켰어요. 다시 연결할 내용을 채워 두었어요`(그 앱 요청 템플릿을 채팅 입력에 채워 줘요), 실패 `앱을 추가하지 못했어요`, 템플릿 못 읽음 `템플릿을 불러오지 못했어요`. 채팅 입력 위 줄 안내 `{{ }} 칸은 그대로 보내도 돼요. 보내면 보안 입력 양식으로 물어봐요`(닫기 버튼 `앱 추가 닫기`). 설정 목록의 `앱 관리` 행 부제는 `asAddHint`(`꺼 둔 앱 ... · 새로 추가` 또는 `새로 추가하기`)지만, 설정 목록 쪽은 `stRow("apps","앱 관리","", ...)`로 부제를 비워 둬요.
- 데이터: `GET /api/app-templates`, `GET /api/integrations/{app}/remove`, `POST /api/integrations/{app}/add`, `DELETE /api/apps/{key}`, `POST /api/peer/act`.
- 근거: web/js/32-app-settings.js:231 `asAddSheet`, :238 `asAddPaint`, :262 `asNewSend`, :273 `asNewApp`, :304 `asAdd`, :188 `asOffApps`, :196 `asDelAsk`, :203 `asDelGo`, :216 `asDelNode`, :226 `asAddHint`, :290 `asTplPaint`.
- css: 18-app-settings.css(`.as-new-in` `.as-del` `.as-rm` `.as-sec`), 14-overlay.css(시트).

### 자동 초안 규칙 (메일 앱 설정, `arNodes`)
- 목적: 메일 앱이 답장 초안을 쓸 때 조건별 규칙과 기본 규칙을 설정 화면에서 고쳐요.
- 구성: `자동 초안과 승인` 구역 안: 구역 소제목(서버 라벨), 설명 행, `기본 규칙` 텍스트 상자, 규칙 행들(이름 배지, `언제: ...`, `어떻게: ...`, `붙일 파일: ...`, 스위치, `고치기`, `지우기`), `규칙 추가`.
- 기능: 기본 규칙은 입력을 벗어나면 저장(`PATCH` `{draft_default}`, 토스트 `기본 규칙을 저장했어요`). 규칙 저장은 목록 전체를 `PATCH` `{draft_rules}`(`arSave`). 규칙 폼(`arForm`)의 `저장` / `취소`. 최대 20개(`규칙 추가` disabled).
- 상태: 폼 placeholder는 `이름: 메일 옆 뱃지에 보일 짧은 이름 (예: 자료 요청)`, `언제: 이 규칙을 쓸 메일 (예: 자료나 양식을 보내 달라는 메일)`, `어떻게: 초안에 바라는 것 (예: 요청한 자료를 첨부하고 짧게 인사)`, `붙일 파일: ...`. 이름 또는 언제가 비면 토스트 `이름과 언제를 적어 주세요`. 지우기 토스트 `규칙 {이름}을(를) 지웠어요`, 실패 `규칙을 저장하지 못했어요` / `기본 규칙을 저장하지 못했어요`.
- 데이터: `PATCH /api/integrations/{app}/settings` `{draft_rules | draft_default}`.
- 근거: web/js/32-app-settings.js:399 `arNodes`, :374 `arForm`, :388 `arRow`, :367 `arSave`, :360 `AR_PH`.
- css: 18-app-settings.css(`.as-rule` `.as-rform` `.as-rtag` 계열은 파일명만 확인, 이름 단위 대조는 코드에서 확인 못 함).

### 앱 제거와 감시/예약 삭제 (`asRemoveNode`, `asWatchRmNode`)
- 목적: 앱을 이 기기에서 제거하거나, 감시/예약 하나를 지워요(앱 설정 화면 `고급` 구역 맨 끝).
- 구성: 앱은 `앱 제거` 행(`이 기기에서만 지워요. 다른 컴퓨터는 그대로예요` + `제거`), 감시는 `감시 삭제`, 예약은 `예약 삭제`(부제 코드 문구 `이 {감시|예약}을 완전히 지워요`). `제거`/`삭제`를 누르면 확인 블록이 펼쳐지고 `제거 확인`·`삭제 확인` / `취소`.
- 기능: `asRemoveAsk` -> `GET /api/integrations/{app}/remove`로 무엇이 지워지는지 읽고 `asRemoveGo` -> `POST .../remove` `{deleteData}`. 감시/예약은 `DELETE /api/watches/{name}` / `DELETE /api/schedules/{id}`.
- 상태: 제거 확인 `{라벨}을(를) 이 기기에서 제거할까요?` + `이 기기의 앱 목록에서 빼고, 알림과 푸시를 멈춰요`, `감시 {n}개를 지워요: ...` 또는 `지울 감시는 없어요`, `기능을 이 기기에서 꺼요: ...` 또는 `끌 기능은 없어요`, `다른 컴퓨터의 같은 앱은 그대로예요`. 다른 컴퓨터 앱은 `이 앱을 그 컴퓨터에서 제거할까요?` + 일반 문구. 감시 삭제: `{이름}을(를) 삭제할까요?` + `{컴퓨터에서 }확인을 멈추고 목록에서 빼요. 되돌릴 수 없어요` / `지금까지 온 감시 소식은 그대로 남아요` / `잠깐 멈추려면 삭제 대신 감시 켜기를 끄세요`(예약은 `다시 실행하지 않고 목록에서 빼요. 되돌릴 수 없어요` / `잠깐 멈추려면 삭제 대신 예약 켜기를 끄세요`). 프로젝트의 작업 채널에 묶인 감시는 거부되어 토스트 `이 감시는 프로젝트의 작업 채널 설정에 묶여 있어요. 그 프로젝트에서 빼 주세요`. 제거 성공 토스트 `{라벨}을(를) 이 기기에서|그 컴퓨터에서 제거했어요`, 삭제 `{이름}을(를) 삭제했어요`, 실패 `제거할 내용을 읽지 못했어요` `제거하지 못했어요` `삭제하지 못했어요`. 끝나면 모니터링으로 돌아가요.
- 데이터: 위 API들.
- 근거: web/js/32-app-settings.js:172 `asRemoveNode`, :159 `asRemoveAsk`, :164 `asRemoveGo`, :146 `asWatchRmNode`, :129 `asWatchRmGo`.
- css: 18-app-settings.css(`.as-rm` `.as-rml` `.as-act` `.as-del`).

### 앱 셸 프레임 (사이드바, 하단 탭바, 화면 영역)
- 목적: 모든 화면을 담는 바깥 틀. 넓은 화면은 왼쪽 사이드바, 좁은 화면은 같은 `#nav`가 하단 탭바가 돼요.
- 구성: `.app#app` 안에 `aside.side`(`button.brand#brand` 로고+`#brand-name`+`#brand-c` 쉐브론, `nav.rail#nav` 탭 버튼들, `.sfoot` 안 `button.sf-row#sf-usage`), `button.side-tog#side-tog`(접기 단추), `.main`(`header.appbar#appbar`, `#gban`, `#trban`, `#oerr`, `.views#views`). `.views` 안에 화면별 `section.view#v-<이름>` 23개(`v-home`, `v-chat`, `v-monitoring`, `v-settings`, `v-webaccess` 등)와 04-state.js:39가 만드는 `#v-cardform`. 본문 밖에 `aside.sheet#sheet`(서브에이전트)와 `aside.sheet#hsheet`(구성 상세)가 있어요.
- 기능: 탭 전환 `go(id)`, 채팅 탭 재탭 `chatTabTap`(좁은 화면에서 대화 열려 있으면 `openChatList`, 목록이 열려 있으면 `closeChatList`), 홈 탭 재탭 `homeTabTap`(컴퓨터가 2대 이상이면 전환 시트), 사이드바 접기 `sideToggle`(`localStorage dotz-side=min`, 첫 페인트 전에 index.html:67이 `side-min` 클래스를 먼저 붙여요), 브랜드 클릭 `#brand.onclick`(컴퓨터 2대 이상이면 `prOpen`, 아니면 `go("home")`). 탭 목록 `NAV`는 홈, 채팅, 프로젝트, 모니터링, 앱, 설정이고 앱 탭은 `APPS_ON=false`라 숨겨져요(`navOff`).
- 상태: 사이드바 폭 232px, 접으면 60px 아이콘 레일(`:root.side-min`). 접기 단추 `aria-label`은 `사이드바 접기` 또는 `사이드바 펼치기`, title에 단축키(`⌘\` 또는 `Ctrl+\`). 탭 배지: `#nav-att`(채팅, 숫자, title `읽지 않은 대화 n개`), `#nav-mon`(모니터링, 숫자 title `확인할 것 n개`, 숫자 없고 새 소식만 있으면 점과 title `새 소식`), `#nav-upd`(설정, 텍스트 `새 버전`, `업데이트 n`, `재시작 필요`). 99+는 `99+`로 표시해요. 탭 title은 `홈 (⌘1)` 꼴. 1024px 이상에서 배지는 글자 오른쪽 아래 6px 점이고 숫자는 `aria-label`로만 읽혀요(22-shell.css:33-34). 폰(1023px 이하)은 탭 높이 56px, `.sfoot` 숨김. 채팅 목록 전환 기준은 1099px(`narrowChat`, 04-state.js:13), 프로젝트 목록 병렬 표시도 같은 기준(`ppWide`).
- 데이터: `/api/state`(botName 등), 배지는 알림, 모니터링, 업데이트 상태에서 와요(`paintAttn`, `paintMonAttn`, `paintUpdBadge`). 주소 해시 라우팅은 `go()`, `parseHash`, `routeAlias`(`#lanes`는 `#chat/list`, `#accounts`는 `#provider/anthropic`, `#chat/alert`는 `#notices`).
- 근거: web/index.html:73-166, web/js/04-state.js:10-37,178-224, web/js/05-command-palette.js:99-181(go), web/js/09-needs-you.js:54-66,87-97, web/js/24-settings-update.js:40-48.
- css: web/css/22-shell.css(1024px 이상 사이드바 격자, 1023px 이하 탭바), web/css/01-tokens.css:128-222(앱바 격자, 1100px 레이아웃 주석), web/css/03-base.css. 메모: 01-tokens.css:129의 주석은 1100px을 말하지만 22-shell.css는 1024px에서 사이드바 격자로 덮어써요. 어느 쪽이 최종인지는 두 파일 모두 읽었고 22-shell.css가 뒤 파일이라 그쪽이 이긴다고 봐요(로드 순서 파일명 순, 04-state는 99-boot 앞).


### 앱바 (#appbar)
- 목적: 화면 제목, 뒤로, 대화 머리줄, 연결 줄, 명령 검색, 알림 종, 사용량 스트립을 한 줄에 담아요.
- 구성: `#back`(`‹` + `.bk-l` 텍스트), `h1#title`, `.thead#thead`(대화 전환 칩, `data-mode` chat 또는 term), `button.conn#conn`, `#vtog`, `button.cmdk#cmdk`(돋보기 + `명령` + `kbd`), `button.bellbtn#bell`(종 + `#bell-n` 배지), `button.ustrip#ustrip`. 화면 공유 알약 `#dsk-pill`이 `#ustrip` 앞에 끼어들어요.
- 기능: 뒤로 `#back.onclick`(알림 화면, 카카오, 댓글 화면의 자체 뒤로 우선, 모니터링 안 대화면 `go("monitoring")`, 폰 대화면 `openChatList`, 아니면 `go(backTarget() || "home")`), 제목 클릭 `prTitleTap`(폰에서 컴퓨터가 2대 이상이고 뒤로 없을 때 전환 시트), `#cmdk` 클릭 `openPalette`.
- 상태: 제목은 홈이면 `botName`, 공급자 상세면 공급자 이름, 나머지는 `titles[name]`. 뒤로 버튼은 `backTarget()` 또는 폰 대화에서만 보여요(`convChrome`). 넓은 화면의 모니터링 안 앱에서는 `‹ 모니터링`이 제목 자리에 서고 `aria-label`이 `모니터링 목록으로`(`mon-up`). 대화 화면(`tv`)이면 `#thead`가 보여요. `LOG_VIEW=false`라 `#vtog`(대화/로그 토글)은 항상 숨겨요. `.appbar.hasp`는 컴퓨터가 2대 이상일 때(제목 쉐브론, 폰), `.appbar.back`은 뒤로가 있을 때, `.appbar.cvconv`는 대화 화면. `.scrolled` 클래스는 화면 이동 때 지워요. 넓은 화면(1024px 이상) 높이 60px, 폰 `56px + safe-area`. 1024px 이상에서 `#cmdk`는 텍스트와 `kbd`가 보이고, `.ustrip`은 숨기고 사이드바 `#sf-usage`가 대신해요.
- 데이터: 별도 API 없음.
- 근거: web/index.html:81-90, web/js/04-state.js:231-236, web/js/05-command-palette.js:141-157, web/js/31-conversations.js:429-446, web/js/33-peers.js:256-258.
- css: web/css/01-tokens.css:128-222, web/css/22-shell.css:10-99, web/css/03-base.css:224-256, web/css/10-conversations.css:56-57, web/css/16-result-card.css:84(1099px 이하 `.cvconv h1` 두 줄 제한).


### 연결 상태 줄 (#conn, 오프라인 / 재연결)
- 목적: 이 컴퓨터 게이트웨이와 연결이 끊긴 것을 앱바에 알리고, 다른 컴퓨터가 있으면 그쪽으로 넘어가게 해요.
- 구성: `button.conn#conn`(앱바 안, 평소 `hidden`).
- 기능: 다른 컴퓨터가 있으면 클릭으로 `prPick(other)`, 없으면 `disabled`. 처음부터 게이트웨이에 닿지 못한 페이지는 안내 없이 자동으로 다른 컴퓨터로 가요(`autoSwitch`, `prPick(other, {quiet:true, auto:true})`, 주소에 `?auto=1`). `?auto=1`로 도착한 페이지, 이미 한 번 시도한 페이지, 한 번이라도 연결된 적 있는 페이지는 다시 자동 전환하지 않아요(`cameByAuto`, `autoTried`, `everConnected`).
- 상태: 정상이면 숨김. 끊김이 2초 넘게 이어지면(`setConn(false)`의 타이머 2000ms) 표시. 상태 요청이 `STATE_WAIT_MS`(4000ms) 안에 안 오면 끊김으로 쳐요(2000ms 뒤 `setConn(false)`). 문구: 다른 컴퓨터가 있으면 `연결 끊김 · <이름>(으)로 전환`, 없으면 `연결 끊김 · 다시 연결 중`(index.html:85 기본 텍스트도 `연결 끊김 · 다시 연결 중`). 짧은 끊김(2초 이내)은 아무것도 안 보여요. 대화 화면에서는 폭이 좁으면 말줄임(`.appbar.tv .conn`). `.conn`이 보이는 동안 화면 공유 알약은 숨겨요(23-remote-desktop.css:5). 연결이 돌아오면(`es.onopen`이나 상태 응답 성공) `setConn(true)`로 숨겨요.
- 데이터: `/api/state?limit=0`(15초 주기, 보이는 페이지만), SSE `/api/events`의 `onopen`(`setConn(true)`)과 `onerror`(`setConn(false)`).
- 근거: web/js/17-state-refresh.js:8-50, web/js/99-boot.js:33,39,78, web/index.html:85, web/css/01-tokens.css:169-172, web/css/03-base.css:256.
- css: web/css/01-tokens.css:169,172(`.conn` 알약, `--err` 14% 배경), web/css/03-base.css:256, web/css/23-remote-desktop.css:5.


### 오케스트레이터 멈춤 배너 (#oerr)
- 목적: 자동 재시도가 끝나 어시스턴트가 멈췄을 때 모든 화면 위에 이유와 재시작 단추를 보여요.
- 구성: `.oerr#oerr[role=alert]` 안 `.dot.warn`, `#oerr-tx`(굵은 이름 + 이유 + 시각), `button.btn#oerr-btn`.
- 기능: `오케스트레이터 다시 시작` 클릭이 `orchResume` (`POST /api/orchestrator/resume`), 성공하면 토스트 `다시 시도해요. 멈춘 동안 온 메시지도 이어서 처리해요`와 `refreshState()`.
- 상태: `S.orchestrator.error`가 있을 때만 보임. 본문 `<봇 이름>이(가) 멈췄어요 · <이유> · <HH:MM>부터`(이/가는 `iGa`로 받침에 따라), `title`에 원문(`e.raw`). 에러가 없으면 숨김.
- 데이터: `/api/state`의 `orchestrator.error`, `POST /api/orchestrator/resume`.
- 근거: web/js/40-orch-error.js:30-40, 24-28, web/index.html:93.
- css: web/css/04-files.css:73-77.


### 재시작 알림줄 (#gban)
- 목적: 오늘 게이트웨이가 몇 번 재시작했고 끊긴 작업이 몇 개인지 한 줄로 알려요.
- 구성: `.gban#gban[role=status]` 안 `#gban-dot`, `#gban-tx`, `button.x#gban-x`(`×`, `aria-label` `재시작 알림 닫기`).
- 기능: `×`로 오늘 분을 닫으면 `localStorage dotz-restart-seen={day, cut}` 저장. 닫은 뒤 오늘 안에 끊긴 작업이 더 늘 때만 다시 나타나요.
- 상태: 오늘 재시작 메시지가 하나도 없으면 숨김. 있으면 `오늘 재시작 <b>n회</b> · 끊긴 작업 <b>m</b>`, `m>0`이면 점이 `warn`. title `오늘 게이트웨이 재시작 n회, 끊긴 작업 m, 마지막 HH:MM`. 깨끗한 재시작(`끊긴 작업은 없어요` 포함)은 채팅에서 빼고 이 줄 횟수에만 세요.
- 데이터: 메인 대화 기록(`ts(MAIN).msgs`)에서 출처 gateway의 `게이트웨이 재시작했어요` 계열 메시지를 세요. 별도 API 없음.
- 근거: web/js/11-todo-strip.js:63-79, web/index.html:91.
- css: web/css/04-files.css:71,79.


### 빠른 처리 배너 (#trban)
- 목적: 보내기를 기다리는 답장 초안이 `triageMin`(기본 3) 이상 쌓이면 빠른 처리 화면으로 부르는 배너.
- 구성: `button.trban#trban` 안 `list` 아이콘, `.tx`, `.go`(`빠르게 처리`).
- 기능: 클릭이 `trOpen("*")`(전체 대기 카드 순회). 빠른 처리 화면 자체(`fsOpen` 시트, 키 `l`, `j`/`k`, 방향키, `1`/`2`/`3`, `e`, `x`, ⌘/Ctrl+Enter)는 모니터링 범위 파일이라 여기서는 키 목록만 적어요(아래 키보드 단축키 표).
- 상태: 합계가 `TR.min` 미만이거나 빠른 처리 시트가 열려 있으면 숨김. 문구: 그룹이 2곳 이상이면 `답장 대기 <합계>건 · <곳 수>곳`, 1곳이면 `<그룹 라벨> 대기 <n>건`. 카드가 없으면 클릭 시 토스트 `처리할 카드가 없어요`.
- 데이터: `GET /api/approvals`(`trLoad`, SSE `reset`, `notice`, `approvals` 때 `trSoon`으로 300ms 뒤 갱신), SSE `approval_send`는 `trLive`.
- 근거: web/js/30-triage.js:12-54, 137-158, web/js/99-boot.js:35,46-48, web/index.html:92.
- css: web/css/15-triage.css:4-10.


### 사용량 스트립 (#ustrip)과 사이드바 사용량 줄 (#sf-usage)
- 목적: 제일 빡빡한 한도(Anthropic 계열 우선)의 남은 비율을 앱바와 사이드바 아래에 항상 보여요.
- 구성: `#ustrip`은 `.ulab`, `.ubar>i`, `.uring`, `.upct`. `#sf-usage`는 `usage` 아이콘, `.sf-k`(`사용량`), `.sf-bar>i`, `.sf-v`, `.sf-ring`(접힌 레일용 링과 숫자).
- 기능: 둘 다 클릭하면 `go("usage")`(사용량 화면).
- 상태: 한도 정보가 없으면 둘 다 숨김. 있으면 `<기간> <p>% 남음`(예 `5시간 62% 남음`, 기간은 `limitWord`가 5h는 `5시간`, d는 `n일`, w는 `n주`로). 남은 비율 40% 이하면 `warn`(주황). title/`aria-label` `사용량 · <기간> <p>% 남음`. 폰에서는 앱바 `#ustrip`(`upct` 축약 포함), 1024px 이상에서는 `#ustrip` 숨기고 `#sf-usage`만. 접은 사이드바는 링만.
- 데이터: `GET /api/quota`(`loadStrip`, 페이지가 보일 때만, 최소 3분 간격, 60초 타이머와 `visibilitychange`), SSE `quota` 이벤트(`quotaLive`)는 바로 갱신하고 사용량 또는 홈 화면이 열려 있으면 다시 그려요.
- 근거: web/js/09-needs-you.js:229-289, web/js/99-boot.js:83-84, web/index.html:77,89.
- css: web/css/01-tokens.css:175-183,198-202(앱바 스트립), web/css/22-shell.css:36-47,55-67(사이드바 줄, 링).


### 알림 종 (#bell)
- 목적: 안 읽은 알림 수를 앱바 종에 보여주고 알림 화면으로 가요.
- 구성: `button.bellbtn#bell`(종 아이콘 + `span.bd#bell-n` 배지).
- 기능: 클릭이 `nscGo`(`go("notices")`), 단축키 ⌘/Ctrl+/ 도 `#bell.click()`.
- 상태: 안 읽은 수가 0이면 배지 숨김, 있으면 숫자(100 이상 `99+`), `aria-label`은 `알림` 또는 `알림, 안 읽은 알림 n개`, title `알림 (⌘/)` 또는 `알림 (Ctrl+/)`. 0에서 n으로 바뀔 때 팝 애니메이션, 숫자만 바뀌면 `rollCount`로 바뀐 자리만 굴러요. 알림 로드 전에는 `NT.unread`를 써요.
- 데이터: 알림 스토어(`NT`, `/api/notices`는 30-notices.js), SSE `notice`, `notice_read`, `notice_dismiss`.
- 근거: web/js/09-needs-you.js:260-273, web/js/31-conversations.js:456-460, web/js/31-notices-screen.js:135, web/js/04-state.js:199-204.
- css: web/css/22-shell.css:84-87.


### 명령 팔레트 (⌘K)
- 목적: 화면 이름이나 `/명령`을 입력해 바로 가거나 실행해요.
- 구성: 네이티브 `dialog.pal`: `.pal-head`(입력 `.pal-in`, 플레이스홀더 `도구 또는 명령`), `.pal-list`(그룹 머리 `.ph` 도구, 화면, 명령 + 버튼 `.pal-i`), `.pal-out`(명령 결과), `.pal-ft`(`↑↓ 이동`, `↵ 열기`, `esc 닫기`).
- 기능: 열기 `openPalette`(앱바 `#cmdk` 클릭 또는 ⌘/Ctrl+K), 목록 이동 방향키 위아래(순환), `Tab`은 명령 항목이면 입력을 `<명령> `으로 채움, `Enter`는 선택 실행(`/`로 시작하고 공백이 있으면 그대로 `runCmd`), 항목 클릭 `exec`. 항목 종류: 이동(`go(it.go)`), 동작(`it.act()`), 명령(`/api/command`로 실행). 결과 카드의 버튼은 다음 명령을 같은 팔레트에서 실행해요. `/model`, `/effort`, `/compact`, `/restart`, `/resume`, `/stop`, `/abort` 실행 뒤에는 `refreshState`, `loadModels(true)`, `loadContext(true)`.
- 상태: 입력이 비면 도구(화면 이동, `activity`, `project`, `provider`, `cardform`, 숨긴 탭 제외, 각 줄 오른쪽에 `⌘n` 힌트), 화면 동작(`종료된 세션 n` 한 줄, 질의가 있으면 세션 이름별 `종료된 세션 · <이름>`, `셸 터미널 열기`, `S.desk`가 있을 때 `화면 공유 열기`, `라이트 모드로 전환` 또는 `다크 모드로 전환`), 명령 순서. 질의가 `/`로 시작하면 명령만. 결과 없음 `결과가 없어요`. 실행 중 `실행 중`, 결과 태그 `완료`, `진행 중`, `주의`, `실패`(`PAL_TONE`), 오류 응답 카드는 `실패` 제목에 오류 메시지(`.pal-res.err`). 텍스트 응답만 오면 첫 줄이 제목이고 나머지는 노트. IME 조합 중(`isComposing`, keyCode 229)에는 키를 무시해요. 폰(639px 이하)에서 `.pal` 위쪽 12vh, 항목 높이 44px, 코스 포인터에서 입력 글자 16px.
- 데이터: `POST /api/command` `{text}`, 슬래시 힌트 `hintList`(14-slash-commands.js), `S.lanes`(종료된 세션), `S.desk`.
- 근거: web/js/05-command-palette.js:4-96, web/js/01-motion.js:28-40(`motionDialog` "pop"), web/js/04-state.js:225-231.
- css: web/css/03-base.css:130,153-181, web/css/14-overlay.css:16-29.


### 키보드 단축키 (web/js 전체 keydown 핸들러)
- 목적: 앱 전역과 화면별 키 동작을 한곳에 모아요. 수식어 키는 Mac이면 ⌘, 그 외 Ctrl(`isMac`).
- 구성: 전역 `document` 핸들러 3종(04-state.js:197, 05-command-palette.js:96, 33-peers.js:269)과 화면별 핸들러들.
- 기능(전역):
  - ⌘/Ctrl+/ : 알림 화면(`#bell.click()`). 04-state.js:199-204
  - ⌘/Ctrl+. : 메인 대화로(`openTarget("main","chat")`). 04-state.js:205-210
  - ⌘/Ctrl+\ : 사이드바 접기/펴기, 화면 폭 1024px 이상일 때만. 04-state.js:211-214
  - ⌘/Ctrl+1..5 : 보이는 탭을 `NAV` 순서로 열기(홈, 채팅, 프로젝트, 모니터링, 설정). 앱 탭이 숨겨져 있어 6은 비어 있어요. 1부터 6까지 키를 받고 탭이 없으면 무시. 04-state.js:178-185,215-218
  - ⌘/Ctrl+K : 명령 팔레트. 05-command-palette.js:96
  - Ctrl+` 또는 ⌘+` (Shift 추가 시 반대 방향) : 다음 컴퓨터로 바로 전환, 꺼진 컴퓨터는 건너뛰고 다 꺼져 있으면 토스트 `다른 컴퓨터에 연결할 수 없어요`. 33-peers.js:259-273
  - 위 전역 키는 `isComposing`, Alt, 열린 `dialog`가 있으면 무시해요(04-state.js:198, 33-peers.js:270-271은 Alt만 무시하고 Shift는 허용).
- 기능(팔레트 안, 05-command-palette.js:75-86): 위아래, Tab, Enter. Esc는 `motionDialog`가 가로채 부드럽게 닫아요(01-motion.js:39).
- 기능(컴퓨터 전환 시트, 33-peers.js:184-194): Esc 닫기, Tab 포커스 가둠. 제목 `#title`에 Enter 또는 Space로 시트 열기(33-peers.js:258).
- 기능(입력창 `ta`): 슬래시 메뉴가 열려 있으면 위아래, Tab, Enter(`Shift`/⌘/Ctrl/Alt 없이)로 선택, Esc로 닫음(14-slash-commands.js:183-191). 그 외 Enter 전송(작업 중이면 진행 중인 턴에 끼워 넣기), ⌘/Ctrl+Enter 다음 턴 대기열, Alt+Enter 중단 후 전송, Shift+Enter 줄바꿈, 작업 중 Esc 중단. 터치 기기(`pointer: coarse`)에서는 Enter가 줄바꿈. 14-slash-commands.js:193-199
- 기능(공통 시트/메뉴): `fsOpen` 시트는 맨 위일 때 Esc 닫기와 Tab 가둠(38-overlay.js:16-26, 47). 팝오버 메뉴 `03-menu.js:73-86`은 Esc, 위아래, Home, End, Tab(닫기), 글자 입력 접두 이동(700ms). 서브에이전트 시트와 구성 상세 시트는 Esc로 닫기(06-subagents.js:170, 29-harness-features.js:203).
- 기능(빠른 처리 시트, 30-triage.js:137-158): ⌘/Ctrl+Enter 전송 또는 고치기 제출, `l` 목록/카드 전환, `→`/`j` 다음, `←`/`k` 이전, `Enter`/`1` 보내기, `2`/`e` 고치기, `3`/`x` 보내지 않기. 입력칸 안에서는 ⌘/Ctrl+Enter만.
- 기능(그 밖): 카카오 방 입력 Enter 전송, Shift+Enter 줄바꿈(30-kakao.js:481-485), 라이트박스 좌우 방향키(30-kakao.js:340), 요소 고르기에서 ⌘/Ctrl을 누르고 있는 동안 고르기 모드(15-picker.js:177-178,253-258), 보드 카드 머리줄 방향키 이동과 드래그 중 Esc 취소(07-board.js:221,371-385), 인라인 편집 Esc 취소와 Enter 확정(19-project-main.js:171-175, 285), 모니터링 글상자 ⌘/Ctrl+Enter 확정(30-monitoring.js:566), 웹 셸 비밀번호 Enter(36-shell.js:176), 앱 설정 대화 Enter 전송(32-app-settings.js:245), 답장 카드와 결정 카드 입력 Enter(10-reply-card.js:53, 10-decision-card.js:285), 컴퓨터 이름과 공급자 코드, 계정 입력 대화창 Enter로 마지막 버튼(33-peers.js:244, 21-providers.js:179, 25-settings-accounts.js:157,169). `role=link`/`button` 행의 Enter와 Space 활성화는 08-home.js:18,142,193, 06-subagents.js:61, 12-terminal-view.js:12, 29-harness-features.js:108, 28-harness-project.js:33, 30-monitoring.js:515,720,733,771, 19-project-main.js:466, web/custom.js:255,636에 있고, 30-mail-box.js:180,185, 30-notices.js:504, 30-monitoring.js:613은 행 클릭으로 번지지 않게 keydown을 막아요. 대화 타임라인과 카카오 타임라인은 keydown 등으로 자동 따라가기를 풀어요(31-conversations.js:194, 30-kakao.js:489). web/custom.js:712 Enter 전송(터치가 아닐 때).
- 상태: 단축키 힌트 문구가 코드에 그대로 박힌 곳: 탭 title `홈 (⌘1)`, 사이드바 접기 title, 종 title `알림 (⌘/)`, 컴퓨터 브랜드 title `컴퓨터 바꾸기 (⌘` · Ctrl+`, 다음 컴퓨터로)`, 팔레트 `kbd` `⌘K` 또는 `Ctrl K`. 설정에 단축키 도움말 화면은 코드에서 확인 못 함. 25-settings-accounts.js:52-84(드래그 key, `onkeydown`)의 세부 키는 라인만 확인하고 내용은 읽지 않았어요.
- 데이터: 없음.
- 근거: 위 각 줄.


### 컴퓨터 전환 시트 (내 컴퓨터)
- 목적: 한 사람의 게이트웨이들(맥북, 맥미니 등)을 오가요. 컴퓨터가 2대 이상일 때만 켜져요(`prTrig`).
- 구성: `.ds-bd`(+넓은 화면 `.anch`) 안 `.ds-sheet.pr-sheet[role=dialog]`: 머리 `.pr-hd#pr-t` `내 컴퓨터`, `.pr-list`에 컴퓨터마다 `button.pr-row`(상태 점 `.dot`, 이름 `.pr-t`, 한 줄 `.pr-sub`, 오른쪽 체크 `.pr-ck` 또는 대기 수 `.pr-n`. 연결이 안 되는 컴퓨터는 한 줄 대신 오른쪽에 `.tag.off` `연결 안 됨` 또는 `확인 못 함`), 이어서 `화면 공유 열기`(`S.desk`일 때, `.pr-screen`), `컴퓨터 관리`(`.pr-manage`, 설정으로).
- 기능: 열기는 사이드바 브랜드 클릭, 폰 제목 탭, 홈 탭 재탭(`homeTabTap`), 닫기는 같은 탭 재탭 또는 바깥, Esc. 행 선택 `prPick`. 단축키 Ctrl+` 로 시트 없이 순환 `prNext`. 설정의 `이 컴퓨터 이름` 행 `mnRow`(부제가 지금 이름, 오른쪽에는 화살표만)가 이름 변경 대화창 `mnDialog`(`maxlength 24`, 저장 `PUT /api/machine`, 버튼 `저장`, `기본 이름으로`, 토스트 `이름을 저장했어요`, `기본 이름으로 돌렸어요`).
- 상태: 목록은 주소 순으로 정렬해 모든 컴퓨터에서 같은 순서. 행 한 줄: 이 컴퓨터는 `이 컴퓨터`(게이트웨이가 안 닿으면 `연결 안 됨`), 다른 컴퓨터는 `연결됨` 또는 `연결 안 됨`, 안 닿는 동안에는 `확인 못 함`(그래도 선택 가능), 안 본 것이 있으면 `답변 필요 n · 새 알림 n`. 꺼진 컴퓨터는 회색(`.off`, `aria-disabled`)이고 선택하면 토스트 `<이름>에 연결할 수 없어요`. 컴퓨터를 고르면 토스트 `<이름>(으)로 넘어가요`(자동 전환은 조용히). 점: 브랜드 쉐브론 또는 폰 제목 오른쪽 아래의 작은 점이 다른 컴퓨터에 안 본 것이 있음(`pdot`, accent), 질문 대기면 `p-need`(warn). 브랜드 `aria-label` `컴퓨터 바꾸기, 지금은 <이름>`(+`, 다른 컴퓨터에 새 알림`). 컴퓨터 1대면 `홈으로`. 넓은 화면은 브랜드 줄 아래 240px 팝오버(스크림 없음), 폰은 하단 시트이고 탭바를 가리지 않게 `bottom`을 띄워요(탭바 위 공간이 있으면). JANDI로만 닿는 컴퓨터(`via:"jandi"`)는 이 앱 안 주소(`/jandi-peer/<keyword>`)로 이동해요. 다른 컴퓨터 프레임 안에서는 상위 앱에 `postMessage({dotz:"peer-pick"})`.
- 데이터: `GET /api/peers`(60초 주기, 보일 때, 실패하면 2초, 5초, 15초 뒤 재시도, 마지막 목록은 `localStorage dotz-peers`에 캐시), SSE `peer_counts`, `peer_notice`, `peer_notice_done`(`prLive`), `GET/PUT /api/machine`, `GET /api/peers`가 주는 `{name,url,self,online,unread,need,via}`.
- 근거: web/js/33-peers.js:11-30(목록), 91-112(`prPaint`), 153-164(`prPick`), 166-182(`prSheet`), 184-228(열기/닫기), 253-279, web/index.html:75.
- css: web/css/11-peers.css:1-47, web/css/09-notices.css:78-79(`.ds-bd`, `.ds-sheet`).


### 다른 컴퓨터 알림 따라가기 (푸시 탭, 토스트)
- 목적: 다른 컴퓨터가 보낸 알림을 탭하거나 모니터링에서 받으면 그 컴퓨터의 해당 항목으로 이어줘요.
- 구성: 화면 없음(토스트와 주소 처리).
- 기능: 주소 `?pc=<origin>[&n=<결정 id>|&m=<메시지 ts>]#<경로>`로 시작하거나 열린 앱이 서비스 워커의 `{follow}` 메시지를 받으면 `prTryFollow`가 그 컴퓨터로 이동(목록에 있는 origin만). 모니터링을 보는 중이고 페이지가 보일 때만 `peer_notice`를 토스트로 띄우고 `열기` 버튼이 `prOpenItem`.
- 상태: 컴퓨터 목록에 없으면 `그 컴퓨터를 찾지 못했어요`, 꺼져 있으면 `<이름>에 연결할 수 없어요`(토스트, 오류 톤). 알림 토스트 `<컴퓨터> · <제목>`, 질문이면 `답변이 필요해요 · <제목>`, 제목이 없으면 `새 알림`, 8초. 방금 이쪽에서 처리한 대화는 5분간 토스트를 쓰지 않아요(`PR_ACTED`). 다른 곳에서 답하거나 읽으면 그 토스트는 사라져요(`peer_notice_done`).
- 데이터: SSE `peer_notice`, `peer_counts`, `peer_notice_done`, 서비스 워커 `follow` 메시지.
- 근거: web/js/33-peers.js:32-89, web/sw.js:183-200, web/js/23-installable-app-web.js:103-106.
- css: 토스트 `.snack`(web/css/03-base.css:181-197).


### 다른 컴퓨터 전체 화면 프레임 (.pr-frame)
- 목적: 홈 화면에 설치한 앱(PWA)은 다른 주소로 못 나가므로 다른 컴퓨터를 앱 안 전체 화면 iframe으로 열어요.
- 구성: `.pr-frame`(고정, 전체, safe-area 패딩)과 `iframe[title="다른 컴퓨터"]`(`allow="clipboard-write; fullscreen"`).
- 기능: 열기 `prGo(href)`(설치형 앱이고 최상위 창일 때만, 아니면 `location.href`나 `replace`), 닫기 `prFrameClose`(뒤로 제스처, 또는 이 컴퓨터를 다시 고르기), 프레임 안 컴퓨터의 전환 시트가 보내는 `postMessage({dotz:"peer-pick", url})`로 프레임 교체 또는 닫기(내 목록에 있는 origin만).
- 상태: 프레임 안 페이지(`prEmbedded`)는 다른 컴퓨터를 고를 때 상위 앱에 맡겨요. 닫으면 `prLoad()`로 목록 갱신. 브라우저 탭에서는 프레임 없이 그냥 그 주소로 이동하고 `?did=<기기 id>`를 붙여요(두 컴퓨터의 푸시 구독을 한 기기로 묶으려고).
- 데이터: 없음(`DEVICE_ID`는 localStorage `dotz-did`).
- 근거: web/js/33-peers.js:119-151, 123-124(`PR_EMBED`, `prEmbedded`), web/js/23-installable-app-web.js:93-102.
- css: web/css/11-peers.css:49-51.


### 다른 컴퓨터 모니터링 병합 (모니터링 안 다른 컴퓨터 항목)
- 목적: 다른 게이트웨이의 감시, 앱, 메일, 카카오방, 알림을 이 컴퓨터 모니터링 목록에 같은 모양으로 섞어 보여요.
- 구성: 별도 화면 없음. 같은 렌더러를 쓰고 항목에 `pc={name,url,bot}`이 붙어요. 머리줄에 `.mon-pc` 작은 컴퓨터 이름, 항목 칩 `[컴퓨터 이름]`과 `연결 안 됨`(warn). 연결 안 된 컴퓨터는 `<이름> · 연결 안 됨` 행 하나.
- 기능: 읽기는 `/api/peer/proxy?pc=<url>&p=<경로>`, 쓰기는 `POST /api/peer/act`(액션 message, watch, app, answer, read, fyi, mail-delete, mail-draft, no-reply, draft-files, draft-recipients, comments, kakao, notice, upload). 파일 첨부는 컴퓨터마다 50MB 이하.
- 상태: 파일 크기 초과 `<이름>: 다른 컴퓨터의 대화에는 50MB 이하 파일만 보낼 수 있어요`, 원본이 없으면 `<이름>: 파일을 다시 붙여 주세요`, 올리기 실패 `<컴퓨터>에 <파일>을(를) 올리지 못해서 보내지 않았어요 (<사유>)`, 카카오 설정 중 지원 안 되는 쓰기는 오류 `<컴퓨터>에서 바꿔 주세요`. 열린 상대 대화는 4초마다 기록을 다시 읽어요(메일과 설정 대화만). 목록은 모니터링이 열릴 때(5초 넘게 안 읽었으면), SSE 이벤트 뒤 1초 디바운스, 60초 타이머로 읽어요.
- 데이터: `GET /api/monitoring/peers`, `/api/peer/proxy`, `POST /api/peer/act`, SSE `peer_*`.
- 근거: web/js/34-peer-monitoring.js:1-246(`pqRoute` 111, `pqLoad` 152, `pqMerge` 204, `pqUpload` 97).
- css: 모니터링 css 재사용, `.mon-pc`는 web/css/10-conversations.css:26.


### 화면 공유 알약 (#dsk-pill)
- 목적: 누군가 이 컴퓨터 화면을 보는 중임을 앱바에 알려요.
- 구성: `button.tag.pri.dsk-pill#dsk-pill`(`#ustrip` 앞에 삽입).
- 기능: 클릭하면 `go("settings")`(보는 사람 목록이 설정에 있어요). 팔레트와 컴퓨터 시트의 `화면 공유 열기`가 `openScreen`(`POST /api/desk/open`).
- 상태: 보는 사람이 없으면 숨김. 1명이면 `<기기 또는 사람>에서 보는 중`, 2명 이상이면 `n곳에서 보는 중`, `aria-label` `<문구>. 설정에서 보기`. `#conn`이 보이는 동안 숨겨요. 열기 실패: 토스트 `새 탭이 막혔어요. 팝업을 허용해 주세요`, `지금은 화면을 열 수 없어요`, `화면을 열지 못했어요`, 성공 시 `<이름>의 크롬에서 열었어요`.
- 데이터: `/api/state`의 `S.desk.viewers`, `POST /api/desk/open`, `GET /api/desk/status`, `PUT /api/desk/settings`.
- 근거: web/js/37-remote-desktop.js:25-47,72-95.
- css: web/css/23-remote-desktop.css:2-7(1099px 이하 `margin-left:0`, 639px 이하 최대 폭 40%).


### PWA 설치 (앱 설치 버튼과 안내)
- 목적: 홈 화면에 앱으로 설치하는 길을 안내해요(23-installable-app-web.js의 설치 부분만).
- 구성: 설정의 `이 기기` 섹션 한 행 `앱 설치` + 버튼 `앱 설치`(설치형이 아닐 때만), 안내 대화창 `앱 설치`(`.steps` 순서 목록 + 노트 + `확인`).
- 기능: `installApp()`. Chrome, Edge, Samsung은 `beforeinstallprompt`를 보관했다가 버튼으로 진짜 설치 프롬프트(`e.prompt()`). 그 이벤트가 없으면 안내 대화창.
- 상태: iOS 단계 3개(`Safari 아래쪽(또는 주소창)의 공유 버튼을 눌러요`, CriOS/FxiOS/EdgiOS이면 `주소창의 공유 버튼을 눌러요`, `'홈 화면에 추가'를 골라요`, `'웹 앱으로 열기'가 켜져 있는지 보고 '추가'를 눌러요`), Android 3개(`브라우저 메뉴(⋮)를 열어요`, `'앱 설치'를 골라요. '홈 화면에 추가'라면 다음 창에서 '설치'를 골라요`, `'바로가기 만들기'는 브라우저로 열려요. 고르지 마세요`), 데스크톱 2개(`주소창 오른쪽의 설치 아이콘을 눌러요`, `없으면 브라우저 메뉴에서 '앱 설치'를 골라요`). 노트 `전에 추가한 <봇 이름> 아이콘이 브라우저로 열리면 지우고 다시 추가해 주세요.` 설치 완료 토스트 `앱을 설치했어요. 홈 화면의 <봇 이름> 아이콘으로 열어 주세요`. 설치형 판정 `isStandalone`(display-mode standalone 또는 `navigator.standalone`). 푸시 행 상태(이 파일의 알림 부분은 범위 밖이라 문구 일부만): `iPhone은 홈 화면에 추가한 앱에서 알림을 켤 수 있어요`, `이 브라우저는 알림을 지원하지 않아요`, `알림 권한이 막혀 있어요`.
- 데이터: `/api/push` 계열(범위 밖). 설치 부분은 로컬 브라우저 이벤트만.
- 근거: web/js/23-installable-app-web.js:204-225, 226-246(`pushSection`의 앱 설치 행 230).
- css: web/css/03-base.css:132(`.steps`), 대화창 공통은 web/css/03-base.css:130.


### 서비스 워커와 오프라인 셸 (web/sw.js)
- 목적: 앱 셸을 캐시해서 알림 탭으로 앱이 바로 뜨게 하고, 웹 푸시를 보여줘요.
- 구성: 캐시 `dotz-shell-v12`(셸 `/`, `/app.js`, `/app.css`, `/custom.js`와 아이콘 4개), 공유 캐시 `dotz-share`, IndexedDB `dotz-snap`.
- 기능: 설치 시 셸을 캐시하고 `skipWaiting`, 활성화 시 옛 캐시 삭제와 `clients.claim`. 탐색 요청이나 셸 파일 요청은 캐시 우선 응답 후 백그라운드 갱신(`refreshShell`, 셸 파일 셋이 모두 성공했을 때만 저장, ETag 또는 본문 비교로 변경 감지). 바뀌었으면 열린 창에 `{type:"shell-updated"}`. 페이지가 `{type:"refresh-shell"}`을 보내면 갱신 뒤 포트로 `done`. 공유 대상: `POST /share-target`이면 사진을 `dotz-share`에 저장하고 `/?shared=1#chat`으로 303. 푸시: `push`(알림 표시, 결정 옵션 버튼 최대 2개, `withdraw`로 처리된 알림 닫기, 화면에 같은 대화가 열려 있으면 억제하고 Apple 엔드포인트는 조용한 알림을 띄웠다 닫음), `pushsubscriptionchange`(재구독 `/api/push/subscribe`), `notificationclick`(열린 창에 `{open, ts, nid, notice}`를 보내거나 새 창을 `?m=`, `?i=`, `?n=`로 엶, 옵션 버튼은 `POST /api/notices/<id>/answer`, 성공 시 `답변을 보냈어요` 알림 3.5초).
- 상태: 가로채지 않는 경로: `/api/*`, 다른 origin, GET이 아닌 요청, `/manifest.webmanifest`, `/jandi-peer/*`, `/pair`, `/pair.js`, `/desk`, `/desk/*`. 푸시 표시 제목 기본 `알림`, 정리 알림 `알림 정리`(본문 `처리한 알림을 정리했어요`), 푸시 때 대화 기록 60개를 미리 읽어 스냅샷에 넣어요(`warmConv`, 403이고 `x-dotz-pair` 헤더가 있으면 스냅샷 DB 삭제).
- 데이터: `/api/history?target=...&limit=60`, `/api/push`, `/api/push/subscribe`, `/api/notices/<id>/answer`.
- 근거: web/sw.js:1-225(캐시 5-11, 갱신 36-58, fetch 67-85, push 121-163, click 183-225), 페이지 쪽 등록 web/js/23-installable-app-web.js:109-115,203.
- css: 해당 없음.


### 새 버전 칩과 셸 자동 갱신
- 목적: 새 웹 번들이 오면 사용자 입력을 잃지 않는 때에 다시 불러와요.
- 구성: `button.shell-chip`(화면 맨 위 고정 칩, 칩이 있으면 `.app`이 34px 아래로 밀려요).
- 기능: 칩 클릭이 `shellApply`(스크롤 위치와 대화 위치를 sessionStorage `dotz-shell-reload`에 저장하고 `location.reload()`). 페이지가 숨겨졌고 입력창, 첨부, 시트, 다이얼로그가 비어 있고 마지막 자동 갱신이 1분보다 오래면 자동으로 새로고침. 3분 넘게 자리를 비웠다 돌아오면 서비스 워커에 갱신 확인을 요청. `/api/state`의 `web_build`가 페이지의 `WEB_BUILD`와 다르면 `webBuildCheck`가 서비스 워커 갱신 후 같은 절차.
- 상태: 자동 조건이 아니면 칩 문구 `새 버전 · 눌러서 적용`. 1분 안에 이미 갱신했으면 자동은 건너뛰고 칩만(루프 방지).
- 데이터: SW 메시지 `shell-updated`, `/api/state`의 `web_build`.
- 근거: web/js/23-installable-app-web.js:43-91, web/sw.js:36-61.
- css: web/css/03-base.css:184-185.


### 웹 앱 매니페스트 (web/manifest.webmanifest)
- 목적: 설치 이름, 시작 주소, 공유 대상, 아이콘을 브라우저에 알려요.
- 구성: `name`/`short_name` `dotz`, `id`/`start_url`/`scope` `/`, `display` `standalone`, `lang` `ko`, `background_color`/`theme_color` `#f2f4f6`, `share_target`(POST `/share-target`, multipart, 필드 title, text, url, files는 `image/*`, `video/*`), 아이콘 6개(svg, 192, 512, maskable-512, monochrome 192와 512, 모두 `?v=6`).
- 기능: index.html이 `<link rel="manifest" href="/manifest.webmanifest?v=6">`로 연결하고 `apple-mobile-web-app-*`, `mobile-web-app-capable`, apple-touch-icon을 둬요. 서비스 워커는 매니페스트를 캐시에서 주지 않아요(오래된 매니페스트가 설치를 결정하지 않도록).
- 상태: `theme-color` 메타는 라이트 `#f2f4f6`, 다크 `#121214`이고 테마를 바꾸면 둘 다 선택한 테마 색으로 맞춰요(index.html:7-8,59-60). 매니페스트의 `theme_color`는 라이트 값 하나뿐이에요.
- 데이터: 없음.
- 근거: web/manifest.webmanifest:1-31, web/index.html:5-9,42-47, web/sw.js:72-73.
- css: 해당 없음.


### 부팅과 상태 새로고침, SSE 재연결
- 목적: 첫 화면을 빨리 그리고 `/api/events` 스트림으로 계속 최신으로 유지해요.
- 구성: index.html 인라인 스크립트(첫 요청 선발송 `window.__early`, 마지막 대화 스냅샷 `window.__snap`, 테마 선적용), `web/js/99-boot.js`(맨 마지막에 실행), `17-state-refresh.js`.
- 기능: 인라인 스크립트가 `/api/state?limit=0`, `/api/history?target=...&limit=150`, `/api/todo`, `/api/conversations`, `/api/activity`(알림 화면이면 `/api/notices?limit=300`)를 JS 다운로드 전에 요청. 부팅은 `go(h.view || "home", h.t)` 후 `refreshState`, 스냅샷 시드 `snapSeed` 뒤 `loadTarget`, `loadTodo`, `prjLoad`, 1.5초 뒤 `worklog` 선읽기, 첫 상태 후 `loadModels`, `loadProviderData`, `loadSubs`, `loadQueue`, `loadContext`. `EventSource("/api/events")`를 `openStream()`으로 열고 `reset` 이벤트(처음 연결, 못 따라잡았을 때)에서만 전체를 다시 읽어요. 이벤트 종류별 분기: `activity`, `subagents`, `queue`, `notice`/`notice_read`/`notice_dismiss`, `approval_send`, `approvals`, `quota`, `peer_notice`/`peer_counts`/`peer_notice_done`, `read`, `comment*`, `kakao*`, `mail_unreplied`, `runtime_check`, `update_available`, `lanes`, 나머지는 메시지(`ingestMsg` + `scheduleState`, 60초 안의 새 알림이나 레인 보고는 `notify`). 타이머: 상태 15초(`document.hidden`이면 건너뛰고 복귀 때 따라잡기), `loadUpdate` 5분, 할 일 20초(작업 중인 채팅만), `loadStrip` 60초, `loadModels` 60초. 복귀(`visibilitychange`, `focus`): 5초 넘게 자리를 비웠으면 `resync`, 스트림이 닫혔으면(`readyState===2`) 다시 열기. `pagehide`에서 스트림 닫고, 뒤로가기 캐시(bfcache)에서 돌아오면(`pageshow` persisted) 새 스트림과 `resync`, `prLoad`, `loadStrip`, `loadUpdate`.
- 상태: 연결 끊김 표시는 위 `#conn` 섹션. 상태 응답이 오면 이름 변경 반영(`setBrand`), 사라진 세션/프로젝트 채널이면 메인으로(`setTarget(MAIN)`), 그리고 `paintAuth`, `paintDecision`, `paintOrchError`, `paintPause`, `paintRunState`, `renderBars`, `renderWorking`, `dskPaint`를 다시 그려요. 푸시로 시작하면 `pushOpen`으로 해당 메시지로 이동. `custom.js`는 문서가 다 로드된 뒤 추가 로드(게이트웨이가 안 답해도 서비스 워커 등록이 막히지 않게).
- 데이터: 위 요청들과 SSE `/api/events`(`Last-Event-ID` 자동 재전송으로 놓친 것만 재생).
- 근거: web/index.html:10-40, web/js/99-boot.js:1-96, web/js/17-state-refresh.js:1-50.
- css: 해당 없음.


### 대화 스냅샷 (기기에 저장된 마지막 대화)
- 목적: 콜드 스타트에서 네트워크 전에 마지막으로 본 대화를 바로 그려요.
- 구성: IndexedDB `dotz-snap`(store `conv`, 대화당 1개, 최근 8개 `SNAP_KEEP`, 목록은 `localStorage dotz-snap-mru`).
- 기능: `snapSave`(대화 기록 60개와 활동 120개, 할 일, 읽은 위치를 1.5초 디바운스, 페이지가 숨겨질 때도 저장), `snapSeed`(150ms 안에 읽히면 먼저 그림), `snapSettle`(첫 실제 응답이 오면 지워진 행 제거), `snapForget`(기기 접근이 끊기면 전체 삭제).
- 상태: 메일과 다른 컴퓨터 대화, 로컬 명령 행은 저장하지 않아요(`snapOk`).
- 데이터: `/api/history`(서비스 워커가 푸시 때 같은 DB에 써요).
- 근거: web/js/13-snapshot.js:1-58, web/index.html:31-39, web/sw.js:101-119.
- css: 해당 없음.


### 모션 (01-motion.js)
- 목적: 원인이 있는 움직임만 쓰고, `prefers-reduced-motion`이면 즉시 바꿔요.
- 구성: Web Animations(transform, opacity만), 토큰과 같은 값(`--m-fast` 150ms, `--m-base` 220ms, `--m-slow` 300ms, 곡선 `cubic-bezier(.2,.7,.2,1)`).
- 기능: `motionIn`(rise 8px, top, fade, side), `motionSheet`(폰은 아래에서 슬라이드 280ms, 넓은 화면은 16px 아래에서 페이드), `motionDialog`(팔레트는 scale .98에서 1, 180ms, 닫을 때 150ms 페이드 후 실제 `close`), `motionPop`(배지 scale .6에서 1, 200ms), `motionView`(다른 화면으로 갈 때만 화면과 첫 8행이 12ms 간격으로 올라옴, 첫 페인트와 같은 화면 재렌더, 나중에 로드되는 데이터는 재생 안 함), `motionOut`, `motionSwap`, `rollCount`(바뀐 자릿수만 굴림), `freshKeys`(새로 생긴 항목만). 폰 판정 639px(`phoneWide`).
- 상태: `reducedMotion()`이면 모든 헬퍼가 즉시 변경. 03-base/01-tokens의 CSS에도 `prefers-reduced-motion: reduce`에서 전체 transition, animation을 끄는 규칙이 있어요(01-tokens.css:126).
- 데이터: 없음.
- 근거: web/js/01-motion.js:1-99, web/js/05-command-palette.js:91, web/js/04-state.js(`motionView` 호출 05-command-palette.js:179).
- css: web/css/01-tokens.css:64-65,125-126(motion 토큰과 감소 규칙).


### 테마 (라이트/다크, dotzTheme)
- 목적: 라이트와 다크를 저장해서 첫 페인트 전에 적용해요.
- 구성: index.html 인라인 `dotzTheme`(`get`, `toggle`), `<html data-theme="light|dark">`, 두 `theme-color` 메타.
- 기능: 저장값 `localStorage dotz-theme`(`light` 또는 `dark`), 없으면 시스템 설정(`prefers-color-scheme`)을 따르고 시스템 변경도 따라가요(저장값이 없을 때). 전환은 설정의 `화면 모드` 두 칸 토글(`라이트`, `다크`, 부제 `밝게 또는 어둡게`)과 팔레트의 `라이트 모드로 전환` 또는 `다크 모드로 전환`(`toggleTheme`). 앱바에는 테마 단추가 없어요. 변경 때 `dotz-theme` 이벤트로 설정 화면을 다시 그려요.
- 상태: 다크는 `:root[data-theme="dark"]` 토큰 세트(배경 `#121214`, 카드 `#1d1d21` 등)이고 `color-scheme`도 함께 바뀌어요. 자세한 토큰 값은 web/css/01-tokens.css:4-92.
- 데이터: localStorage만.
- 근거: web/index.html:49-69, web/js/04-state.js:225-230, web/js/22-settings-pages.js:103, web/js/05-command-palette.js:58.
- css: web/css/01-tokens.css:4-92.


### docs/web-access-cloudflare.ko.md 와의 관련성
- 목적: 앱 셸이 Cloudflare 접속 방식에서 어떻게 달라지는지 확인해요.
- 구성: 문서 84줄: 동작 방식, 관리자 설정 순서(설정, 웹 접속에서 Cloudflare 선택), workers.dev, 문제 해결, 기기 연결(패스키), 기기 해제.
- 기능/상태: 이 문서와 직접 이어지는 앱 셸 쪽은 세 곳이에요. 1) `/pair` 화면(문서 64-84줄의 기기 연결 순서와 같아요: `코드 받기`, 6자리 코드, 기기 이름, `이 기기 연결`, 이후 `패스키로 들어가기`; 문서는 코드를 10분, 5회 오입력, 시간당 3회 받기로 제한한다고 적어요. 앱 셸 밖: /pair 페이지 섹션 참고). 2) 서비스 워커는 `/api`를 가로채지 않으므로 SSE `/api/events`가 Worker를 거쳐도 그대로 스트리밍돼요(문서 52줄, sw.js:71). 3) 푸시 알림 주소와 링크가 `https://<hostname>`이 되는 것(문서 10줄)은 서버 쪽이라 이 범위에서 확인한 코드는 없어요. 문서 53줄의 WebSocket 제한은 사용자 앱(`/apps/<id>/`)에만 영향이라 웹앱 셸의 SSE와 무관해요. 설정 화면의 `웹 접속`, `연결된 기기` 화면은 다른 범위 파일(25-settings-web-access.js, 25-settings-devices.js)이에요.
- 데이터: 문서가 언급하는 `/api/devices`, `/api/devices/code`, `/api/pair/*`는 hub/devices.ts에 있고 이 범위에서는 `/api/pair/*`만 확인(hub/devices.ts:338-349).
- 근거: docs/web-access-cloudflare.ko.md:10,52-53,64-84, hub/devices.ts:338-349, web/sw.js:71.
- css: 해당 없음.


## 앱 셸 밖 페이지 (outside the app shell)

`web/index.html`, `web/js`, `web/css`를 쓰지 않는 단독 HTML이에요. 아래 두 페이지는 인라인 `<style>`만 써요.

### 앱 셸 밖 | /pair 페이지

이 페이지는 앱 토큰 값으로 다시 그렸어요(`hub/pair-page.ts`, 값 일치는 `hub/devices.test.ts`가 검사해요). 카드 진입 모션은 `--m-base` 220ms 하나이고, 줄임 모션 설정이면 꺼져요. 아래 값은 고치기 전 실측이에요.

- 목적: Cloudflare 접속(`web.access = "cloudflare"`)에서 아직 연결되지 않은 기기가 패스키로 기기를 연결하거나 로그인해요. 앱 셸(web/index.html, app.css, 토큰, 서비스 워커 셸)을 쓰지 않는 단독 페이지예요.
- 구성: `main`(폭 `min(360px, 92vw)`) 안 `h1` `기기 연결`, `p#lead`, `section#login`(`button#go` `패스키로 들어가기`), `section#pairing`(`button#get.alt` `코드 받기`, `div#enter`: `input#code`(`inputmode=numeric`, `maxlength 6`, 플레이스홀더 `6자리 코드`), `input#name`(`maxlength 60`, 플레이스홀더 `기기 이름`), `button#join` `이 기기 연결`), `div#msg[role=status]`. 스크립트 `/pair.js`.
- 기능: `코드 받기`가 `POST /api/pair/code`, `이 기기 연결`이 `POST /api/pair/begin {code}`, `navigator.credentials.create`(패스키 만들기), `POST /api/pair/register`(성공하면 `연결되었습니다.` 후 `location.replace("/")`), `패스키로 들어가기`가 `POST /api/pair/login-begin`, `navigator.credentials.get`, `POST /api/pair/login`(성공하면 `/`로). 기기 이름 입력은 `navigator.userAgentData.platform` 또는 `navigator.platform`으로 미리 채워요.
- 상태: 연결된 기기가 있는 서버(`data-devices` > 0)면 안내 `이 기기는 아직 연결되지 않았습니다. 패스키로 들어가거나, 새 기기라면 코드를 받아 연결해 주세요.`와 `패스키로 들어가기` 단추가 보이고, 하나도 없으면 안내 `처음 한 번만 이 기기를 연결합니다. 코드는 메신저 알림으로 옵니다.`만 보이고 로그인 단추는 숨김. 패스키 미지원(보안 컨텍스트 아님 포함) `이 브라우저는 패스키를 쓸 수 없습니다 (HTTPS 주소와 최신 브라우저가 필요합니다)`(오류색, `#go`와 `#get` 비활성). 코드 받기 성공 시 입력 영역이 열리고 `메신저로 6자리 코드를 보냈습니다. 10분 안에 입력해 주세요.`(포커스는 코드 입력). 처리 중에는 눌린 단추가 `disabled`(opacity .5). 오류: 사용자가 패스키 확인을 취소하면 `기기 확인이 취소되었습니다`, 서버 오류는 서버가 준 `error` 문구 또는 `요청에 실패했습니다 (<상태코드>)`(오류색 `#dc2626`). 라이트/다크는 `color-scheme: light dark`와 시스템 색 `Canvas`/`CanvasText`가 자동으로 따라가고(앱의 `dotz-theme` 저장값은 읽지 않아요), 반응형은 뷰포트 메타와 `min(360px, 92vw)`뿐이에요.
- 데이터: `GET /pair`, `GET /pair.js`(둘 다 로그인 없이, `__DEVICES__`가 연결 기기 수로 치환), `POST /api/pair/code`, `/api/pair/begin`, `/api/pair/register`, `/api/pair/login-begin`, `/api/pair/login`.
- 근거: hub/pair-page.ts:4-46(HTML과 CSS), 48-106(JS), hub/devices.ts:338-349(경로와 치환).
- css: 인라인 `<style>`만(hub/pair-page.ts:11-24), web/css 미사용.
- 하드코딩 값과 대응 토큰(web/css/01-tokens.css):

| 항목 | /pair 페이지 값 (hub/pair-page.ts) | 대응 토큰 (이름, 값) |
|---|---|---|
| 글꼴 | `system-ui,-apple-system,sans-serif`(:12) | `--font`: Pretendard, "Pretendard Variable", -apple-system, BlinkMacSystemFont, system-ui, "Apple SD Gothic Neo", "Noto Sans KR", "Segoe UI", sans-serif |
| 본문 크기/행간 | `16px/1.5`(:12) | `--fs-body`/`--lh-body` 14px/22px, `--fs-row`/`--lh-row` 15px/22px |
| 제목 크기 | h1 `22px`(:14) | `--fs-page` 22px/`--lh-page` 30px(앱바 제목) |
| 배경 | `Canvas`(시스템 색, :12) | `--bg` #f2f4f6(라이트) / #121214(다크) |
| 글자색 | `CanvasText`(:12) | `--fg` #191f28(라이트) / #ececf0(다크) |
| 보조 글자 | `opacity:.75`(p, :15) | `--fg-2` #4e5968 / #b0b4bc, `--fg-3` #616b78 / #8e939c |
| 주요 단추 배경/테두리 | `#2563eb`(:17) | `--accent` #3182f6(라이트) / #6ca7ff(다크), 글자 `--on-accent` #ffffff / #121214(다크) |
| 주요 단추 글자 | `#fff`(:17) | `--on-accent` #ffffff |
| 보조 단추/입력 테두리 | `#8886`(8자리 hex, 회색 약 53% 불투명, :16,18) | `--line` #e5e8eb / #2b2b31, `--line-2` #d1d6db / #3d3d45 |
| 오류 글자 | `#dc2626`(:22) | `--err` #e32435(라이트) / #ff6369(다크) |
| 비활성 | `opacity:.5`(:19) | 전역 `button:disabled` opacity .4 (01-tokens.css:123) |
| 단추/입력 모서리 | `10px`(:16) | `--r-ctl` 10px (같은 값) |
| 단추/입력 안쪽 여백 | `12px`, 간격 `10px`(:16) | `--sp-3` 12px, `--sp-2` 8px, `--sp-15` 6px (10px에 정확히 맞는 토큰은 없음) |
| 본문 폭 | `min(360px,92vw)`, 위아래 `24px`(:13) | `--sheet-w` 480px, `--view-w` 920px, `--sp-6` 24px |


### 앱 셸 밖 | /jandi-peer/<keyword> 페이지 (삭제함)

이 페이지는 지웠어요. 옛 주소는 게이트 뒤에서 `/#chat/relay:jandi:<keyword>`로 넘겨요(`hub/relay-route.ts`). 지금 화면은 "앱 안 대화 화면 (중계 컴퓨터)"이고, 아래는 고치기 전 실측이에요.

- 목적: JANDI "나와의 대화"로만 닿는 다른 컴퓨터(`self_chat.peers`)와 주고받는 단독 채팅 페이지예요. 컴퓨터 전환 시트에서 `via:"jandi"` 행을 고르면 이 앱의 같은 origin 안에서 열려요(`prPick`의 `location.href = p.url`).
- 구성: `header`(`a[href="/"]` `←` `aria-label` `돌아가기`, 컴퓨터 이름, `small` `잔디 나와의 대화로 주고받아요`), `#log`(말풍선 `.m.me`와 `.m.it`, 시각 `.t`), `#err`, `form#f`(`textarea#t`(`maxlength 4000`, 플레이스홀더 `<이름>에 시킬 일을 적어 주세요`, `required`)와 `button#b` `보내기`).
- 기능: 3초마다 `GET /api/jandi-peer/<keyword>/messages`로 새로 읽어 바뀐 id 목록일 때만 다시 그려요(페이지가 보일 때만, 맨 아래에 붙어 있었으면 따라 내려감). 전송은 `POST /api/jandi-peer/<keyword>/send {text}`(Enter 전송, Shift+Enter 줄바꿈, IME 조합 중이면 무시), 성공하면 입력을 비우고 다시 읽고 맨 아래로. 시각 표시 `ko-KR`, 24시간제, `월/일 시:분`.
- 상태: 빈 로그는 별도 문구 없이 비어 있어요. 읽기 실패 `불러오지 못했어요: <사유>`, 전송 실패 `보내지 못했어요: <사유>`(`#err`, 빨강 `#d33`), 전송 중에는 단추 `disabled`. 서버 오류 문구: `잔디 나와의 대화가 꺼져 있어요`, `잔디에 연결하지 못했어요`(502, 그 외 JANDI 오류는 `SelfChatError` 메시지), `JSON으로 보내 주세요`(415), `너무 길어요`(413, 본문 64KB 초과), `1~4000자로 적어 주세요`(400), `not found`(404, 설정 안 된 keyword나 꺼진 상태), `method not allowed`(405). 내 글은 오른쪽 파란 말풍선(`.me`), 상대 답은 왼쪽 회색(`.it`). 온라인 판정은 이 페이지가 아니라 컴퓨터 목록 쪽이에요(상대 답이 최근 24시간 안에 있으면 online, 목록은 JANDI를 최대 1.5초 기다리고 그 뒤엔 마지막으로 알던 메시지로 답해요). 라이트/다크는 `color-scheme` 메타 없이 `Canvas`/`CanvasText`만 써서 브라우저 기본 따라가요(`<meta name="color-scheme">` 선언은 없어요). 폰 전용 미디어 쿼리는 없고 `100vh` 세로 flex 하나로 모든 폭에 같이 그려요.
- 데이터: `GET /jandi-peer/<keyword>`(HEAD 허용, `Cache-Control: no-store`), `GET /api/jandi-peer/<keyword>/messages`, `POST /api/jandi-peer/<keyword>/send`. 모두 소유자 또는 기기 인증 뒤에 있고(jandi-peers.ts:9 주석), 서비스 워커는 `/jandi-peer/` 경로를 가로채지 않아요(sw.js:75).
- 근거: hub/jandi-peers.ts:57-88(`page`), 91-92(경로 정규식), 149-189(`route`), hub/jandi-peers.ts:55(`pagePath`).
- css: 인라인 `<style>`만(hub/jandi-peers.ts:60-69), web/css 미사용.
- 하드코딩 값과 대응 토큰(web/css/01-tokens.css):

| 항목 | /jandi-peer 페이지 값 (hub/jandi-peers.ts) | 대응 토큰 (이름, 값) |
|---|---|---|
| 글꼴 | `system-ui,sans-serif`(:61) | `--font` Pretendard, "Pretendard Variable", -apple-system, BlinkMacSystemFont, system-ui, "Apple SD Gothic Neo", "Noto Sans KR", "Segoe UI", sans-serif |
| 본문 크기/행간 | `15px/1.5`(:61) | `--fs-row` 15px / `--lh-row` 22px, `--fs-chat` 15px / `--lh-chat` 24px |
| 시각 글자 | `11px`, `opacity:.6`(.t, :66) | `--fs-tag` 11px / `--lh-tag` 16px, `--fg-3` #616b78 / #8e939c |
| 머리줄 글자 | 굵기 `600`, small `400`, `opacity:.7`(:62) | `--fg` / `--fg-3`(위와 같음) |
| 배경/글자 | `Canvas`, `CanvasText`(:61, textarea :67) | `--bg` #f2f4f6 / #121214, `--fg` #191f28 / #ececf0, 카드 `--card` #ffffff / #1d1d21 |
| 머리줄/입력줄 구분선 | `#8884`(회색 약 27% 불투명, :62,67) | `--line` #e5e8eb / #2b2b31 |
| 내 말풍선 | 배경 `#2f6fed`, 글자 `#fff`(:65) | `--accent` #3182f6 / #6ca7ff, `--on-accent` #ffffff / #121214 (앱 채팅 말풍선 토큰은 이 범위에서 읽지 않음) |
| 상대 말풍선 | 배경 `#8882`(회색 약 13% 불투명, :65) | `--layer` #f2f4f6 / #26262b |
| 오류 글자 | `#d33`(:66) | `--err` #e32435 / #ff6369 (이 페이지는 /pair의 `#dc2626`과도 값이 달라요) |
| 말풍선 모서리 | `14px`(:64) | `--r-menu` 14px (같은 값), 앱의 `--r-card` 18px, `--r-sheet` 20px |
| 입력창/단추 모서리 | `10px`(:67,68) | `--r-ctl` 10px (같은 값) |
| 입력 테두리 | `1px solid #8886`(:67) | `--line-2` #d1d6db / #3d3d45 (앱 필드는 테두리 없는 채움, `--ff-ring`은 포커스 때만) |
| 단추 | 배경 `#2f6fed`, 글자 `#fff`, `padding 0 16px`(:68) | `--accent`, `--on-accent`, `--sp-4` 16px, 높이 토큰 `--btn-h` 36px |
| 입력창 높이 | `44px`(:67) | `--row-h` 44px, `--field-h` 36px, `--field-h-touch` 40px |
| 말풍선 최대 폭 | `85%`(:64) | 대응 토큰 코드에서 확인 못 함 |

## 인벤토리와 어긋남

기준은 `site/prototype/INVENTORY.md`예요. 아래는 web/js, web/index.html, web/custom.js를 직접 grep해서 확인한 것과 범위별 조사에서 나온 것이에요.

### 코드에서 못 찾은 것
- **알림 문체(일상 / 간결 / STE)**: `알림 문체`, `STE` 문자열이 web/js에 없어요(`STE`는 `BSTEP` 변수 이름 안에서만 걸려요, `web/js/07-board.js:6`). 표시 화면은 `화면 모드`와 `대화 탭` 두 줄뿐이에요(`web/js/22-settings-pages.js:101-105`).
- **입력 중 표시(`쓰고 있어요` 줄)**: 문자열이 web/js, web/index.html, web/custom.js 어디에도 없어요. 실행 상태 줄은 `41-runstate.js`가 따로 그려요(화면별 명세의 `실행 상태 줄` 참고). 진행 메시지가 제자리에서 바뀌는 동작은 web/js에서 확인 못 했어요.
- **홈의 아침 점검 카드**: `web/js/08-home.js`에는 없어요. `아침 점검` 태그는 채팅 답이 브리핑 모양일 때 `web/js/11-resultcard.js:131`이 카드로 그리고, 알림 화면 라벨로 `web/js/31-notices-screen.js:31`에 한 번 더 나와요.
- **앱 추가 시트의 `#apps/add` 주소**: 이런 라우트는 없어요. 시트 본체 `asAddSheet`는 `web/js/32-app-settings.js:231`에 있고, 모니터링 목록의 `앱 관리` 행(`web/js/30-monitoring.js:257`)에서 열려요. 인벤토리가 적은 출처 `30-apps.js`에는 시트가 없어요.
- **시제품 주소 전부**: `#watch/price`, `#schedule/*`, `#comments*`, `#kakao*`, `#mail*`, `#replies`, `#triage`, `#peers`, `#settings/<page>`는 앱 라우트가 아니에요. `#watch/price`는 `web/js/30-monitoring.js:725` 주석에만 나와요. 앱의 실제 주소는 `#monitoring/m:<이름>`, `#monitoring/i:<앱>`, `#monitoring/c:<대화 키>`, 설정 하위는 `#models`, `#update`처럼 뷰 이름 그대로예요(`web/js/05-command-palette.js:143`).

### 코드와 다르게 적힌 것
- **보낸 편지함의 출처**: `30-mail-sent.js`는 처리된 답장 초안을 메일 대화 안에 접어 두는 파일이에요(`web/js/30-mail-sent.js:1-8`). 보낸 메일 목록은 모니터링 메일 앱의 `보낸 메일` 필터예요(`web/js/30-monitoring.js:456`).
- **메일 쓰기와 `보냈어요`**: `mbCompose`는 초안만 만들고 토스트가 `초안을 만들었어요 · 승인 카드에서 보내요`예요(`web/js/30-mail-box.js`, D2 조사). `보냈어요`는 빠른 처리의 상태 문구로만 있어요(`web/js/30-triage.js:82,244`).
- **빠른 처리 기준**: 인벤토리는 "기본 3개 넘게"인데 코드는 `count >= TR.min`, `total < TR.min`이고 기본값이 3이에요. 서버가 `triageMin`을 주면 그 값을 써요(`web/js/30-triage.js:8,17,24,36`). 즉 3개부터예요.
- **프로젝트 목록의 출처**: 목록은 `18-lanes.js`(`renderProjects:307`)에 있고 `19-project-main.js`는 상세(`pmOpen:6`)예요.
- **알림 목록**: 인벤토리는 "실제 앱은 아직 알림 대화"라고 하지만 코드에는 독립 `notices` 뷰가 있고(`web/js/04-state.js:36`, `31-notices-screen.js:123`), `#chat/alert`는 이 뷰로 바뀌어요(`web/js/05-command-palette.js:107-108`).
- **`#sessions`, 세션 탭**: 세션 탭은 없어요. `#lanes`는 `chat/list`로 바뀌어요(`web/js/05-command-palette.js:105,108`).
- **`#settings/accounts`**: `provider/anthropic`으로 바뀌어요(`web/js/05-command-palette.js:108`).
- **대화/터미널 전환과 터미널 보기**: `LOG_VIEW = false`라 토글(`#vtog`)이 숨고 `activity`는 항상 `chat`이 돼요(`web/js/04-state.js:30`, `05-command-palette.js:136,152`).
- **앱 탭**: `APPS_ON = false`라 탭이 없고 모든 진입이 홈으로 가요(`web/js/04-state.js:25-26`, `05-command-palette.js:125`). `APPS_ON`을 true로 바꾸는 코드는 못 찾았어요(C 조사).
- **단축키 개수**: 코드는 `Digit1`부터 `Digit6`까지 보이는 탭 수만큼 받아요(`web/js/04-state.js:215`). 앱 탭이 숨겨진 지금은 5개예요.

### 인벤토리에 없는데 코드에 있는 것
사이드바 접기(`⌘/Ctrl+\`), 전역 단축키(`⌘/Ctrl+/` 알림, `+.` 메인 대화, `+1..6` 탭), 컨텍스트 화면(`web/js/19-project-main.js:526`), 화면 공유(`37-remote-desktop.js`), 재시작 알림줄 `#gban`, 오케스트레이터 멈춤 배너 `#oerr`, 새 버전 칩과 셸 자동 갱신, 서비스 워커 셸 캐시와 공유 대상, 대화 스냅샷, 설치형 앱 종료 가드(`web/js/32-history-nav.js:96-110`), 모션 시스템, `/pair`와 `/jandi-peer/<keyword>` 단독 페이지(F 조사).

### 조사 중 확인 못 한 것
- `web/js/26-settings-runtime.js`의 `rtSection`은 정의만 있고 호출이 없어요(E 조사).
- `.st-page`, `.ms-onb`, `.rt-rep`, `.ctx-model`, `.budget-row` 규칙은 web/css에서 못 찾았어요(E 조사).
- `/desk/` 뷰어 화면은 web/js에 없어요(C 조사). 카카오 설정 전용 화면과 카카오 오프라인 문구는 확인 못 했어요(D2 조사).
- `docs/peer-monitoring.md`, `docs/notifications.md`는 열지 않았어요(F 조사).
- `web/custom.js`의 옛 `paintProject`는 `19-project-main.js`가 올라오면 쓰이지 않아요(C 조사).

## 토큰

측정 방법: `bun /tmp/cf-webapp/extract.js`가 `web/css/01-tokens.css`의 `:root`(라이트)와 `:root[data-theme="dark"]`(다크) 블록에서 커스텀 프로퍼티를 줄 단위로 읽었어요. 선언은 라이트 114개, 다크 37개로 합계 151행이고, 이름은 114개예요. 다크 칸이 "같음"이면 다크 블록이 그 토큰을 다시 선언하지 않아요. 사용처는 `var(--이름)`을 `web/css`, `web/js`, `web/custom.js`, `web/index.html`, `hub/pair-page.ts`, `hub/jandi-peers.ts`에서 센 값이에요(토큰 파일 안의 파생 참조는 따로 적었어요). `getPropertyValue`로 읽는 경우는 세지 않았어요.

### 색 (39개)

| 토큰 | 라이트 | 다크 | 선언 줄 | 사용처 (var() 횟수, 상위 파일) |
|---|---|---|---|---|
| `--bg` | `#f2f4f6` | `#121214` | 8 / 다크 74 | 45회: css/03-base.css x8, css/20-mail-box.css x4, css/04-files.css x3 외 18개 파일; 토큰 파일 내 파생 3회 |
| `--side` | `#f2f4f6` | `#121214` | 8 / 다크 74 | 0회 |
| `--card` | `#ffffff` | `#1d1d21` | 9 / 다크 75 | 136회: css/03-base.css x16, css/05-log.css x10, css/10-conversations.css x10 외 24개 파일; 토큰 파일 내 파생 6회 |
| `--pop` | `#ffffff` | `#26262b` | 9 / 다크 75 | 8회: css/03-base.css x4, css/04-files.css x2, css/09-notices.css x1 외 1개 파일 |
| `--ff-fill` | `var(--card)` | 같음 | 11 | 15회: css/07-chat.css x3, css/04-files.css x2, css/15-triage.css x2 외 7개 파일 |
| `--ff-pop` | `var(--layer)` | `var(--active)` | 11 / 다크 76 | 0회; 토큰 파일 내 파생 1회 |
| `--layer` | `#f2f4f6` | `#26262b` | 13 / 다크 77 | 114회: css/04-files.css x15, css/06-harness.css x13, css/16-result-card.css x12 외 24개 파일; 토큰 파일 내 파생 6회 |
| `--hover` | `#e9ecf0` | `#2b2b31` | 13 / 다크 77 | 68회: css/16-result-card.css x11, css/03-base.css x10, css/05-log.css x9 외 21개 파일; 토큰 파일 내 파생 6회 |
| `--active` | `#e5e8eb` | `#303036` | 13 / 다크 77 | 24회: css/06-harness.css x6, css/09-notices.css x4, css/20-mail-box.css x4 외 8개 파일; 토큰 파일 내 파생 1회 |
| `--track` | `#e5e8eb` | `#34343b` | 13 / 다크 77 | 8회: css/22-shell.css x2, css/02-cards-lists-tags.css x1, css/06-harness.css x1 외 4개 파일; 토큰 파일 내 파생 4회 |
| `--card-hover` | `#f9fafb` | `#232328` | 14 / 다크 78 | 35회: css/06-harness.css x7, custom.js x5, css/02-cards-lists-tags.css x4 외 12개 파일; 토큰 파일 내 파생 1회 |
| `--line` | `#e5e8eb` | `#2b2b31` | 17 / 다크 80 | 69회: css/16-result-card.css x9, css/05-log.css x8, css/03-base.css x5 외 21개 파일; 토큰 파일 내 파생 1회 |
| `--line-2` | `#d1d6db` | `#3d3d45` | 17 / 다크 80 | 33회: css/16-result-card.css x8, css/03-base.css x3, css/15-draft-original.css x3 외 12개 파일; 토큰 파일 내 파생 2회 |
| `--fg` | `#191f28` | `#ececf0` | 18 / 다크 81 | 197회: css/16-result-card.css x25, css/04-files.css x23, css/03-base.css x22 외 27개 파일; 토큰 파일 내 파생 9회 |
| `--fg-2` | `#4e5968` | `#b0b4bc` | 18 / 다크 81 | 253회: css/16-result-card.css x32, css/04-files.css x28, css/05-log.css x21 외 29개 파일; 토큰 파일 내 파생 9회 |
| `--fg-3` | `#616b78` | `#8e939c` | 18 / 다크 81 | 326회: css/05-log.css x39, css/16-result-card.css x31, css/04-files.css x19 외 30개 파일; 토큰 파일 내 파생 3회 |
| `--accent` | `#3182f6` | `#6ca7ff` | 19 / 다크 82 | 154회: css/03-base.css x14, css/17-kakao.css x12, css/05-log.css x11 외 25개 파일; 토큰 파일 내 파생 8회 |
| `--on-accent` | `#ffffff` | `#ffffff` | 19 / 다크 82 | 9회: css/03-base.css x4, css/09-notices.css x1, css/15-reply.css x1 외 3개 파일; 토큰 파일 내 파생 2회 |
| `--ok` | `#0a8754` | `#3ecf8e` | 20 / 다크 83 | 34회: css/20-monitoring.css x4, css/20-projects.css x4, css/02-cards-lists-tags.css x3 외 12개 파일 |
| `--warn` | `#ae5900` | `#f5a524` | 20 / 다크 83 | 58회: css/04-files.css x8, css/03-base.css x6, css/20-monitoring.css x6 외 12개 파일; 토큰 파일 내 파생 6회 |
| `--warn-ink` | `#8f4900` | `#f5a524` | 라이트 20 / 다크 83 | 1회: css/02-cards-lists-tags.css `.tag.warn` 글자. `--warn`을 같은 색상으로 어둡게 한 값으로, 호버·고른 줄을 포함한 모든 면 위에서 4.5:1(점은 `--warn` 그대로) |
| `--err` | `#e32435` | `#ff6369` | 20 / 다크 83 | 67회: css/05-log.css x14, css/04-files.css x8, css/20-monitoring.css x7 외 15개 파일; 토큰 파일 내 파생 5회 |
| `--unreplied` | `#c2410c` | `#ff9a4d` | 22 / 다크 84 | 9회: css/02-cards-lists-tags.css x4, css/17-kakao.css x3, css/05-log.css x1 외 1개 파일 |
| `--on-unreplied` | `#ffffff` | `#1b1206` | 22 / 다크 84 | 1회: css/17-kakao.css x1 |
| `--kk-bg` | `#dbe5ee` | `#161c23` | 24 / 다크 85 | 1회: css/17-kakao.css x1 |
| `--kk-in` | `#ffffff` | `#2b2f36` | 24 / 다크 85 | 5회: css/17-kakao.css x5 |
| `--kk-in-fg` | `#191f28` | `#ececf0` | 24 / 다크 85 | 3회: css/17-kakao.css x3 |
| `--kk-own` | `#fee500` | `#d9bd00` | 24 / 다크 85 | 2회: css/17-kakao.css x2 |
| `--kk-own-fg` | `#191919` | `#1b1b1b` | 24 / 다크 85 | 2회: css/17-kakao.css x2 |
| `--kk-time` | `#5b6877` | `#8e98a5` | 24 / 다크 85 | 13회: css/17-kakao.css x13 |
| `--kk-chip` | `rgb(25 31 40 / .38)` | `rgb(255 255 255 / .12)` | 24 / 다크 85 | 3회: css/17-kakao.css x3 |
| `--kk-chip-fg` | `#ffffff` | `#b0b4bc` | 24 / 다크 85 | 2회: css/17-kakao.css x2 |
| `--scrim` | `rgb(0 0 0 / .4)` | `rgb(0 0 0 / .6)` | 25 / 다크 86 | 4회: css/14-overlay.css x3, css/03-base.css x1 |
| `--tb` | `#101012` | 같음 | 27 | 2회: css/04-files.css x1, css/13-code-shell.css x1 |
| `--tf` | `#e6e6ea` | 같음 | 27 | 1회: css/04-files.css x1 |
| `--td` | `#8d8d96` | 같음 | 27 | 6회: css/05-log.css x5, css/04-files.css x1 |
| `--tl2` | `#2b2b30` | 같음 | 27 | 1회: css/04-files.css x1 |
| `--tok` | `#4ade80` | 같음 | 27 | 1회: css/05-log.css x1 |
| `--terr` | `#ff7b7b` | 같음 | 27 | 4회: css/05-log.css x4 |
| `--tac` | `#a9a9ff` | 같음 | 27 | 1회: css/05-log.css x1 |

### 글자 (22개)

| 토큰 | 라이트 | 다크 | 선언 줄 | 사용처 (var() 횟수, 상위 파일) |
|---|---|---|---|---|
| `--fs-page` | `22px` | 같음 | 30 | 0회; 토큰 파일 내 파생 1회 |
| `--lh-page` | `30px` | 같음 | 30 | 0회; 토큰 파일 내 파생 1회 |
| `--fs-page-sm` | `20px` | 같음 | 31 | 1회: css/14-overlay.css x1; 토큰 파일 내 파생 1회 |
| `--lh-page-sm` | `28px` | 같음 | 31 | 1회: css/14-overlay.css x1; 토큰 파일 내 파생 1회 |
| `--fs-big` | `20px` | 같음 | 32 | 1회: css/02-cards-lists-tags.css x1 |
| `--lh-big` | `28px` | 같음 | 32 | 1회: css/02-cards-lists-tags.css x1 |
| `--fs-card` | `16px` | 같음 | 33 | 2회: css/02-cards-lists-tags.css x1, css/05-log.css x1 |
| `--lh-card` | `22px` | 같음 | 33 | 2회: css/02-cards-lists-tags.css x1, css/05-log.css x1 |
| `--fs-sec` | `14px` | 같음 | 34 | 3회: css/02-cards-lists-tags.css x1, css/15-settings-pages.css x1, css/20-projects.css x1 |
| `--lh-sec` | `20px` | 같음 | 34 | 3회: css/02-cards-lists-tags.css x1, css/15-settings-pages.css x1, css/20-projects.css x1 |
| `--fs-row` | `15px` | 같음 | 35 | 5회: css/15-settings-pages.css x2, css/02-cards-lists-tags.css x1, css/03-base.css x1 외 1개 파일 |
| `--lh-row` | `22px` | 같음 | 35 | 6회: css/09-notices-screen.css x2, css/02-cards-lists-tags.css x1, css/03-base.css x1 외 2개 파일 |
| `--fs-chat` | `15px` | 같음 | 36 | 1회: css/03-base.css x1 |
| `--lh-chat` | `24px` | 같음 | 36 | 2회: css/03-base.css x2 |
| `--fs-body` | `14px` | 같음 | 37 | 2회: css/07-chat.css x1, css/20-monitoring.css x1; 토큰 파일 내 파생 1회 |
| `--lh-body` | `22px` | 같음 | 37 | 1회: css/20-monitoring.css x1; 토큰 파일 내 파생 1회 |
| `--fs-meta` | `12px` | 같음 | 38 | 16회: css/15-reply-card.css x5, css/05-log.css x4, css/09-notices-screen.css x3 외 4개 파일 |
| `--lh-meta` | `16px` | 같음 | 38 | 14회: css/05-log.css x4, css/15-reply-card.css x4, css/09-notices-screen.css x2 외 4개 파일 |
| `--fs-tag` | `11px` | 같음 | 39 | 3회: css/02-cards-lists-tags.css x1, css/15-reply-card.css x1, css/20-monitoring.css x1 |
| `--lh-tag` | `16px` | 같음 | 39 | 2회: css/02-cards-lists-tags.css x1, css/20-monitoring.css x1 |
| `--font` | `Pretendard, "Pretendard Variable", -apple-system, BlinkMacSystemFont, system-ui, "Apple SD Gothic Neo", "Noto Sans KR", "Segoe UI", sans-serif` | 같음 | 67 | 303회: css/17-kakao.css x42, css/09-notices.css x24, css/10-conversations.css x21 외 27개 파일; 토큰 파일 내 파생 5회 |
| `--mono` | `ui-monospace, "SF Mono", "Geist Mono", SFMono-Regular, Menlo, Consolas, monospace` | 같음 | 68 | 17회: css/06-harness.css x5, css/05-log.css x3, css/03-base.css x2 외 4개 파일; 토큰 파일 내 파생 1회 |

### 간격 (11개)

| 토큰 | 라이트 | 다크 | 선언 줄 | 사용처 (var() 횟수, 상위 파일) |
|---|---|---|---|---|
| `--sp-05` | `2px` | 같음 | 42 | 177회: css/07-chat.css x17, css/16-result-card.css x17, css/17-kakao.css x17 외 26개 파일; 토큰 파일 내 파생 5회 |
| `--sp-1` | `4px` | 같음 | 42 | 314회: css/05-log.css x26, css/04-files.css x22, css/03-base.css x20 외 32개 파일; 토큰 파일 내 파생 7회 |
| `--sp-15` | `6px` | 같음 | 42 | 303회: css/03-base.css x33, css/04-files.css x32, css/05-log.css x32 외 30개 파일; 토큰 파일 내 파생 5회 |
| `--sp-2` | `8px` | 같음 | 42 | 643회: css/04-files.css x64, css/03-base.css x62, css/05-log.css x61 외 35개 파일; 토큰 파일 내 파생 14회 |
| `--sp-3` | `12px` | 같음 | 42 | 459회: css/16-result-card.css x52, css/04-files.css x46, css/05-log.css x36 외 31개 파일; 토큰 파일 내 파생 11회 |
| `--sp-4` | `16px` | 같음 | 42 | 215회: css/17-kakao.css x17, css/04-files.css x16, css/03-base.css x15 외 27개 파일; 토큰 파일 내 파생 6회 |
| `--sp-5` | `20px` | 같음 | 42 | 60회: css/22-shell.css x17, css/03-base.css x6, css/04-files.css x6 외 17개 파일 |
| `--sp-6` | `24px` | 같음 | 42 | 42회: css/04-files.css x5, css/10-conversations.css x4, custom.js x4 외 15개 파일; 토큰 파일 내 파생 5회 |
| `--sp-8` | `32px` | 같음 | 42 | 11회: css/10-conversations.css x2, css/02-cards-lists-tags.css x1, css/03-base.css x1 외 7개 파일; 토큰 파일 내 파생 1회 |
| `--sp-10` | `40px` | 같음 | 42 | 4회: css/22-shell.css x3, css/03-base.css x1 |
| `--sp-12` | `48px` | 같음 | 42 | 3회: css/20-monitoring.css x2, css/04-files.css x1 |

### 모서리 (7개)

| 토큰 | 라이트 | 다크 | 선언 줄 | 사용처 (var() 횟수, 상위 파일) |
|---|---|---|---|---|
| `--r-card` | `18px` | 같음 | 45 | 57회: css/17-kakao.css x9, css/05-log.css x6, css/10-conversations.css x6 외 18개 파일 |
| `--r-sheet` | `20px` | 같음 | 45 | 10회: css/03-base.css x4, css/09-notices.css x3, css/14-overlay.css x3 |
| `--r-menu` | `14px` | 같음 | 45 | 3회: css/03-base.css x2, css/17-kakao.css x1 |
| `--r-ctl` | `10px` | 같음 | 45 | 101회: css/16-result-card.css x19, css/07-chat.css x9, css/03-base.css x7 외 24개 파일; 토큰 파일 내 파생 3회 |
| `--r-seg` | `8px` | 같음 | 45 | 1회: css/03-base.css x1 |
| `--r-seg-in` | `6px` | 같음 | 45 | 1회: css/03-base.css x1 |
| `--r-pill` | `999px` | 같음 | 45 | 4회: css/02-cards-lists-tags.css x2, css/07-chat.css x1, css/20-monitoring.css x1 |

### 높이 (19개)

| 토큰 | 라이트 | 다크 | 선언 줄 | 사용처 (var() 횟수, 상위 파일) |
|---|---|---|---|---|
| `--row-sel` | `#e8ebee` | `#2b2b31` | 16 / 다크 79 | 10회: css/10-conversations.css x2, css/02-cards-lists-tags.css x1, css/04-files.css x1 외 6개 파일 |
| `--row-h` | `44px` | 같음 | 49 | 12회: css/16-result-card.css x2, css/17-kakao.css x2, css/02-cards-lists-tags.css x1 외 7개 파일 |
| `--row-py` | `8px` | 같음 | 49 | 8회: css/02-cards-lists-tags.css x1, css/09-notices.css x1, css/10-conversations.css x1 외 5개 파일 |
| `--row-px` | `16px` | 같음 | 49 | 18회: css/15-settings-pages.css x10, css/05-log.css x3, css/02-cards-lists-tags.css x1 외 4개 파일; 토큰 파일 내 파생 1회 |
| `--menu-h` | `30px` | 같음 | 50 | 1회: css/03-base.css x1 |
| `--menu-py` | `4px` | 같음 | 50 | 1회: css/03-base.css x1 |
| `--menu-px` | `8px` | 같음 | 50 | 2회: css/03-base.css x2 |
| `--menu-h-sheet` | `44px` | 같음 | 50 | 1회: css/03-base.css x1 |
| `--sheet-h` | `44px` | 같음 | 51 | 1회: css/09-notices.css x1 |
| `--btn-h` | `36px` | 같음 | 52 | 3회: css/16-result-card.css x2, css/09-notices-screen.css x1; 토큰 파일 내 파생 1회 |
| `--btn-h-sm` | `32px` | 같음 | 52 | 10회: css/15-reply-card.css x3, css/07-chat.css x2, css/17-kakao.css x2 외 3개 파일; 토큰 파일 내 파생 1회 |
| `--btn-h-row` | `28px` | 같음 | 52 | 5회: css/17-kakao.css x3, css/09-notices-screen.css x2; 토큰 파일 내 파생 2회 |
| `--btn-hit` | `44px` | 같음 | 52 | 2회: css/08-project-sessions.css x1, css/16-result-card.css x1; 토큰 파일 내 파생 1회 |
| `--ctl-h` | `32px` | 같음 | 53 | 1회: css/15-settings-pages.css x1; 토큰 파일 내 파생 1회 |
| `--field-h` | `36px` | 같음 | 54 | 4회: css/07-chat.css x2, css/03-base.css x1, css/08-project-sessions.css x1 |
| `--field-h-touch` | `40px` | 같음 | 54 | 4회: css/07-chat.css x2, css/03-base.css x1, css/15-settings-pages.css x1; 토큰 파일 내 파생 1회 |
| `--chip-h` | `28px` | 같음 | 55 | 3회: css/03-base.css x2, css/02-cards-lists-tags.css x1 |
| `--tag-h` | `20px` | 같음 | 55 | 2회: css/02-cards-lists-tags.css x1, css/18-app-settings.css x1 |
| `--tag-px` | `6px` | 같음 | 55 | 2회: css/02-cards-lists-tags.css x1, css/20-monitoring.css x1 |

### 그림자 (6개)

| 토큰 | 라이트 | 다크 | 선언 줄 | 사용처 (var() 횟수, 상위 파일) |
|---|---|---|---|---|
| `--ff-ring` | `inset 0 0 0 1.5px var(--accent)` | 같음 | 12 | 12회: css/07-chat.css x2, css/15-triage.css x2, css/16-result-card.css x2 외 6개 파일 |
| `--float` | `0 8px 24px rgb(0 0 0 / .10), 0 1px 3px rgb(0 0 0 / .06)` | `0 8px 24px rgb(0 0 0 / .5), 0 1px 3px rgb(0 0 0 / .4)` | 58 / 다크 87 | 8회: css/03-base.css x1, css/05-log.css x1, css/09-notices.css x1 외 5개 파일 |
| `--shadow-menu` | `0 8px 24px rgb(0 0 0 / .14)` | `0 8px 24px rgb(0 0 0 / .5)` | 59 / 다크 88 | 1회: css/03-base.css x1 |
| `--shadow-sheet` | `0 -4px 28px rgb(0 0 0 / .22)` | `0 -4px 28px rgb(0 0 0 / .55)` | 60 / 다크 89 | 1회: css/03-base.css x1 |
| `--shadow-dialog` | `0 16px 48px rgb(0 0 0 / .22)` | `0 16px 48px rgb(0 0 0 / .6)` | 61 / 다크 90 | 1회: css/03-base.css x1 |
| `--shadow-panel` | `0 6px 24px rgba(0, 0, 0, .06)` | `0 6px 24px rgba(0, 0, 0, .35)` | 62 / 다크 91 | 2회: css/15-draft-original.css x1, css/17-kakao.css x1 |

### 모션 (4개)

| 토큰 | 라이트 | 다크 | 선언 줄 | 사용처 (var() 횟수, 상위 파일) |
|---|---|---|---|---|
| `--m-fast` | `150ms` | 같음 | 65 | 47회: css/05-log.css x17, css/03-base.css x5, css/06-harness.css x4 외 10개 파일; 토큰 파일 내 파생 2회 |
| `--m-base` | `220ms` | 같음 | 65 | 18회: css/03-base.css x5, css/05-log.css x5, custom.js x2 외 6개 파일 |
| `--m-slow` | `300ms` | 같음 | 65 | 10회: css/15-draft-original.css x9, css/02-cards-lists-tags.css x1 |
| `--m-ease` | `cubic-bezier(.2, .7, .2, 1)` | 같음 | 65 | 75회: css/05-log.css x22, css/03-base.css x9, css/15-draft-original.css x9 외 14개 파일; 토큰 파일 내 파생 2회 |

### 레이아웃 (6개)

| 토큰 | 라이트 | 다크 | 선언 줄 | 사용처 (var() 횟수, 상위 파일) |
|---|---|---|---|---|
| `--edge` | `28px` | 같음 | 46 | 3회: css/20-apps.css x2, css/10-conversations.css x1; 토큰 파일 내 파생 2회 |
| `--view-w` | `920px` | 같음 | 46 | 0회; 토큰 파일 내 파생 3회 |
| `--sheet-w` | `480px` | 같음 | 46 | 2회: css/05-log.css x1, css/06-harness.css x1 |
| `--lead-ind` | `calc(var(--row-px) + var(--sp-6) + var(--sp-3))` | 같음 | 46 | 2회: css/03-base.css x1, css/06-harness.css x1 |
| `--back-x` | `calc(var(--sp-6) - var(--sp-15))` | 같음 | 46 | 0회; 토큰 파일 내 파생 2회 |
| `--back-w` | `calc(var(--sp-8) + var(--sp-05))` | 같음 | 46 | 0회; 토큰 파일 내 파생 1회 |

## 모션 규칙

### 모션 토큰

| 토큰 | 값 (01-tokens.css) | JS 짝 (01-motion.js) | 일치 | CSS var() 횟수 | JS 사용 횟수 |
|---|---|---|---|---|---|
| `--m-fast` | 150ms (줄 65) | `M_MS.fast` = 150 (줄 5) | 일치 | 47 | 8 |
| `--m-base` | 220ms (줄 65) | `M_MS.base` = 220 (줄 5) | 일치 | 18 | 4 |
| `--m-slow` | 300ms (줄 65) | `M_MS.slow` = 300 (줄 5) | 일치 | 10 | 0 |
| `--m-ease` | `cubic-bezier(.2, .7, .2, 1)` (줄 65) | `M_EASE` = `cubic-bezier(.2, .7, .2, 1)` (줄 4) | 일치 | 75 | 9 |

JS 사용 횟수는 `web/js`, `web/custom.js`, `web/index.html`, `hub/*.ts` 전체에서 `M_MS.<이름>`과 `M_EASE`를 센 값이에요(01-motion.js의 정의 줄 포함).

### 공통 상수

| 상수 | 값 | 줄 |
|---|---|---|
| `M_FROM.rise` | `translateY(8px)` | web/js/01-motion.js:7 |
| `M_FROM.top` | `translateY(-8px)` | web/js/01-motion.js:7 |
| `M_FROM.fade` | `none` (이동 없음) | web/js/01-motion.js:7 |
| `M_FROM.side` | `translateX(12px)` | web/js/01-motion.js:7 (이 키를 쓰는 호출은 원시 행에 없음) |
| `reducedMotion()` | `matchMedia("(prefers-reduced-motion: reduce)").matches` | web/js/01-motion.js:6 |
| `phoneWide()` | `matchMedia("(max-width: 639px)").matches` | web/js/01-motion.js:15 |

### 헬퍼

| 헬퍼 | 키프레임 (from → to) | 길이(ms) | 지연 | 이징 | fill | 동작 줄이기 | 근거 | 원시 ID |
|---|---|---|---|---|---|---|---|---|
| `motionIn(el, from="rise", ms=M_MS.base, delay=0)` | `{opacity 0, transform M_FROM[from]}` → `{opacity 1, transform none}` | 기본 220 (--m-base), 인자로 바꿈 | 인자 `delay`, 기본 0 | M_EASE | backwards | `reducedMotion()`이면 반환 (애니메이션 없이 최종 상태) | web/js/01-motion.js:10-13 | J001, J002 |
| `motionSheet(box, scrim)` | 폰: `translateY(100%)` → `none`. 넓은 화면: `{opacity 0, translateY(16px)}` → `{opacity 1, none}`. 뒷막: `opacity 0` → `1` | 시트 280 (리터럴), 뒷막 220 (M_MS.base) | 0 | M_EASE | 없음 (기본) | `reducedMotion()`이면 반환 | web/js/01-motion.js:19-23 | J003, J004, J005 |
| `motionSheetOut(...els)` | 각 요소에 `motionOut(e, "fade", M_MS.fast)` | 150 (--m-fast) | 0 | M_EASE | forwards (motionOut) | motionOut의 가드를 따름 | web/js/01-motion.js:24 | J006 |
| `motionDialog(d, enter="sheet")` | enter="pop": `{opacity 0, scale(.98)}` → `{opacity 1, scale(1)}`. 그 외: motionSheet(d). close(): motionOut(d, "fade", M_MS.fast) 뒤 실제 close | pop 180 (리터럴), sheet 280, close 150 (--m-fast) | 0 | M_EASE | pop/sheet: 없음, close: forwards | `reducedMotion()` 또는 `!d.animate`이면 반환, close를 가로채지도 않아 바로 닫힘 | web/js/01-motion.js:28-40 | J007, J008, J009, J010 |
| `motionPop(el)` | `{opacity 0, scale(.6)}` → `{opacity 1, scale(1)}` | 200 (리터럴) | 0 | M_EASE | 없음 | `reducedMotion()`이면 반환 | web/js/01-motion.js:43-46 | J011, J012 |
| `motionView(name, boxes, rows=true)` | 박스마다 motionIn(b, "rise", M_MS.fast). rows면 보이는 `.li, .card, .rc, .cv-row, .hr, .pj-card` 앞 8개에 motionIn(r, "rise", M_MS.fast, i*12) | 150 (--m-fast) | 행 i번째 i x 12 (0~84) | M_EASE | backwards | `reducedMotion()`이거나 처음 그리기, 같은 화면이면 반환 | web/js/01-motion.js:51-60 | J013, J014, J015 |
| `motionOut(el, to="fade", ms=M_MS.fast)` | `{opacity 1, transform none}` → `{opacity 0, transform M_FROM[to] \|\| none}`. Promise를 돌려줌 | 기본 150 (--m-fast) | 0 | M_EASE | forwards | `reducedMotion()`이면 즉시 resolve (바로 사라진 것처럼) | web/js/01-motion.js:62-66 | J016, J017 |
| `motionSwap(el, change, ms=M_MS.base)` | change()를 먼저 실행하고 `{opacity .35}` → `{opacity 1}` | 기본 220 (--m-base) | 0 | M_EASE | 없음 | change()는 실행하고 애니메이션만 건너뜀 | web/js/01-motion.js:69-73 | J018, J019 |
| `rollCount(el, next)` | 바뀐 자릿수 span `.m-dg`만 `{opacity 0, translateY(+60% 증가 / -60% 감소)}` → `{opacity 1, none}` | 220 (M_MS.base) | 0 | M_EASE | 없음 | `reducedMotion()`이거나 숫자가 아니면 textContent만 바꿈 | web/js/01-motion.js:76-89 | J020, J021 |
| `freshKeys(store, keys)` | 애니메이션 없음. store에 없던 키 집합을 돌려주고 첫 그리기는 빈 집합 | - | - | - | - | 해당 없음 (motionIn 호출 쪽이 가드) | web/js/01-motion.js:93-99 | J022 |

### 동작 줄이기 가드 전수 (22행)

| ID | 근거 | 종류 | 내용 |
|---|---|---|---|
| R001 | web/css/01-tokens.css:126 | 미디어 쿼리 또는 matchMedia | CSS 전역: transition, animation, scroll-behavior를 모두 끔 (가상 요소와 ::backdrop 포함) |
| R002 | web/css/05-log.css:184 | 미디어 쿼리 또는 matchMedia | 보드 `.bi`, `.bph` 전환 끔 (전역 규칙과 중복) |
| R003 | web/css/07-chat.css:174 | 미디어 쿼리 또는 matchMedia | `.dc-fold .ic`, `.td-ch` 전환 끔 (전역과 중복) |
| R004 | web/css/09-notices.css:27 | 미디어 쿼리 또는 matchMedia | `.nt-hl::after`는 `nt-hl-still` 1.4s step-end 로 정지 색조만 보임 (!important로 전역을 이김) |
| R005 | web/css/11-peers.css:46 | 미디어 쿼리 또는 matchMedia | `.pr-row` 전환 끔 (전역과 중복) |
| R006 | web/css/15-draft-original.css:78 | 미디어 쿼리 또는 matchMedia | 초안 원문 패널 전환 끔 (전역과 중복) |
| R007 | web/css/17-kakao.css:85 | 미디어 쿼리 또는 matchMedia | `.kk-sw, .kk-knob` 전환 끔 (전역과 중복) |
| R008 | web/css/17-kakao.css:198 | 미디어 쿼리 또는 matchMedia | `.kk-hl` animation-duration .01s (전역 `animation: none !important`가 이기므로 효과 없음) |
| R009 | web/css/19-volume.css:37 | 미디어 쿼리 또는 matchMedia | `.fr-chev` 전환 끔 (전역과 중복) |
| R010 | web/js/01-motion.js:3 | 미디어 쿼리 또는 matchMedia | 주석 (01-motion.js 머리말) |
| R011 | web/js/01-motion.js:6 | 미디어 쿼리 또는 matchMedia | reducedMotion() 정의 |
| R012 | web/js/01-motion.js:11 | reducedMotion() 호출 | motionIn 가드 |
| R013 | web/js/01-motion.js:20 | reducedMotion() 호출 | motionSheet 가드 |
| R014 | web/js/01-motion.js:29 | reducedMotion() 호출 | motionDialog 가드 |
| R015 | web/js/01-motion.js:44 | reducedMotion() 호출 | motionPop 가드 |
| R016 | web/js/01-motion.js:53 | reducedMotion() 호출 | motionView 가드 |
| R017 | web/js/01-motion.js:63 | reducedMotion() 호출 | motionOut 가드 (즉시 resolve) |
| R018 | web/js/01-motion.js:71 | reducedMotion() 호출 | motionSwap 가드 |
| R019 | web/js/01-motion.js:80 | reducedMotion() 호출 | rollCount 가드 |
| R020 | web/js/24-settings-update.js:75 | reducedMotion() 호출 | ubOut 가드 (바로 제거) |
| R021 | web/js/38-overlay.js:35 | reducedMotion() 호출 | 38-overlay 닫기: 가드가 있어도 없어도 motionSheetOut이 같은 가드를 가짐 (중복) |
| R022 | web/custom.js:509 | 미디어 쿼리 또는 matchMedia | custom.js scrollIntoView: reduced면 behavior auto |

CSS 쪽 반응(위 R001~R009에 속한 선언)은 C001, C002, C003 (전역), C025, C040, C047, C060, C071, C075 (중복 `transition: none`), C043 (nt-hl-still), C073 (kk-hl .01s)이에요. 모두 전수표와 아래 표에도 나와요.

### 가드 없이 남는 모션

`.animate()` 9행은 모두 가드가 있어요: web/js/01-motion.js의 8행은 각 헬퍼 안 가드(위 표), web/js/24-settings-update.js:75의 1행은 `reducedMotion() || !b.animate`예요. CSS animation과 transition은 전역 규칙(web/css/01-tokens.css:126)이 꺼요. WAAPI와 `scrollIntoView({ behavior: "smooth" })`는 CSS 규칙이 못 끄는데, web/js/39-reply.js:55는 가드가 없어요(아래 어긋남 참고).

## 애니메이션 전수표

열: 대상, 트리거, 진입/이탈/제자리, 속성, 길이(ms), 지연, 이징, 근거(path:line), 원시 ID. `var()`는 실제 값으로 풀고 토큰 이름을 옆에 적었어요. CSS 행의 속성, 길이, 지연, 이징은 `motion-raw.json`을 스크립트가 풀어서 채웠고, JS 행은 `01-motion.js`의 코드 값에서 옮겼어요.

### 화면 전환 (web/js/05-command-palette.js go)

| 대상 | 트리거 | 구분 | 속성 | 길이(ms) | 지연(ms) | 이징 | 근거 | 원시 ID |
|---|---|---|---|---|---|---|---|---|
| 보이는 화면 박스 (#views 자식 중 hidden 아닌 것) | go()로 다른 화면으로 이동. 첫 그리기, 같은 화면, 늦게 도착한 데이터는 제외 | 진입 | opacity 0→1, transform translateY(8px)→none | 150 (M_MS.fast = --m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease); fill backwards | web/js/05-command-palette.js:179, web/js/01-motion.js:54 | J027 |
| 그 화면 안 `.li, .card, .rc, .cv-row, .hr, .pj-card` 중 보이는 앞 8개 (채팅 화면은 rows=false) | 같은 go() 호출, 박스 다음에 한 줄씩 어긋나게 | 진입 | opacity 0→1, transform translateY(8px)→none | 150 (M_MS.fast = --m-fast) | i x 12 (0, 12 ... 84) | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease); fill backwards | web/js/05-command-palette.js:179, web/js/01-motion.js:58 | J027 |

### 토스트와 플로팅 알림 (web/js/02-basic-markdown.js, web/css/03-base.css)

| 대상 | 트리거 | 구분 | 속성 | 길이(ms) | 지연(ms) | 이징 | 근거 | 원시 ID |
|---|---|---|---|---|---|---|---|---|
| `.snack` 토스트 | toast() 호출 | 진입 | opacity 0→1, transform translateY(8px)→none | 220 (M_MS.base = --m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease); fill backwards | web/js/02-basic-markdown.js:172 | J024 |
| `.snack` 토스트 | 3500ms(오류나 되돌리기 있으면 6000ms) 타이머, 또는 되돌리기 누름 | 이탈 | opacity 1→0 (fade, 끝나면 fill forwards) | 150 (M_MS.fast = --m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease); fill forwards | web/js/02-basic-markdown.js:165 | J023 |
| `.ntf` 플로팅 알림 카드 `.ntf.in` | 카드 생성 시 클래스 `ntf in` (02-basic-markdown.js:201) | 진입 | ntf-in: opacity, transform | 220 (--m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (--m-ease); 반복 1, fill none | web/css/03-base.css:206, web/css/03-base.css:218 | C012, K001 |
| `.ntf` 플로팅 알림 카드, 호버 배경 `.ntf`, `.ntf.out` | `.out` 클래스가 붙을 때(NTF_MS 4000 뒤 또는 X 클릭, 3장 초과 시 가장 오래된 것), 호버 | 이탈 / 제자리 | transform, opacity, background, (transition-duration) | transform 220 (--m-base); opacity 220 (--m-base); background 150 (--m-fast); 덮어씀 150 (--m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/03-base.css:201, web/css/03-base.css:207 | C011, C013 |

### 오버레이: 메뉴, 시트, 대화상자, 팔레트 (web/css/14-overlay.css, web/js/01-motion.js)

| 대상 | 트리거 | 구분 | 속성 | 길이(ms) | 지연(ms) | 이징 | 근거 | 원시 ID |
|---|---|---|---|---|---|---|---|---|
| `.menu` 팝업 메뉴 `.menu` | openMenu로 노드 생성 (03-menu.js:17) | 진입 | menu-in: opacity, transform | 150 (--m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (--m-ease); 반복 1, fill none | web/css/14-overlay.css:3, web/css/14-overlay.css:4 | C048, K004 |
| `.menu.msheet` 폰 메뉴 시트 `.menu.msheet` | 폰 폭에서 openMenu (03-menu.js:17) | 진입 | menu-sheet-in: transform | 280 | 0 | cubic-bezier(.2, .7, .2, 1) (--m-ease); 반복 1, fill none | web/css/14-overlay.css:5, web/css/14-overlay.css:6 | C049, K005 |
| `dialog[open]::backdrop` 뒷막 (팔레트는 180) `dialog[open]::backdrop`, `dialog.pal[open]::backdrop` | dialog open | 진입 | m-scrim-in: opacity, (animation-duration) | 220 (--m-base); 덮어씀 180 | 0 | cubic-bezier(.2, .7, .2, 1) (--m-ease); 반복 1, fill none | web/css/14-overlay.css:8, web/css/14-overlay.css:9, web/css/14-overlay.css:11 | C050, C051, K006 |
| `dialog[data-leaving]::backdrop` 뒷막 `dialog[data-leaving][open]::backdrop` | motionDialog의 close()가 data-leaving을 붙일 때 | 이탈 | m-scrim-out: opacity | 150 (--m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (--m-ease); 반복 1, fill forwards | web/css/14-overlay.css:10, web/css/14-overlay.css:12 | C052, K007 |
| `dialog` 본체 (dialog() 헬퍼) | dialog 생성 후 motionDialog(d) (02-basic-markdown.js:275). 폰: 아래에서 올라옴, 넓은 화면: 16px 아래에서 페이드 | 진입 | 폰: transform translateY(100%)→none. 넓은 화면: opacity 0→1, translateY(16px)→none | 280 (리터럴) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease) | web/js/02-basic-markdown.js:275 | J025 |
| `dialog` 본체 (close, Esc, 뒤로가기 포함) | d.close() 가로채기 (01-motion.js:34-38) | 이탈 | opacity 1→0 (fade, 끝나면 fill forwards) | 150 (M_MS.fast = --m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease); fill forwards | web/js/01-motion.js:34-38 | - |
| 명령 팔레트 dialog | 팔레트 생성 (05-command-palette.js:91, motionDialog(d, "pop")) | 진입 | opacity 0→1, transform scale(.98)→scale(1) | 180 (리터럴) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease) | web/js/05-command-palette.js:91 | J026 |
| 전체화면 시트 `.fs-card` 등 (overlay 프레임) | 시트 생성 (38-overlay.js:44, motionSheet(box, node)) | 진입 | 폰: transform translateY(100%)→none. 넓은 화면: opacity 0→1, translateY(16px)→none. 뒷막: opacity 0→1 | 시트 280 (리터럴), 뒷막 220 (M_MS.base) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease) | web/js/38-overlay.js:44 | J120 |
| 전체화면 시트와 뒷막 | 소유자가 닫음(X, Esc, 뒷막). 프로그램 close(restore=false)는 즉시 제거 | 이탈 | opacity 1→0 (fade, 끝나면 fill forwards) | 150 (M_MS.fast = --m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease); fill forwards | web/js/38-overlay.js:35 | J119 |
| 컴퓨터 전환기 `.ds-sheet.pr-sheet` (폰: 시트, 넓은 화면: `.anch` 팝오버) | prOpen (33-peers.js:214). CSS의 기본 애니메이션은 `animation: none`으로 꺼 둠 | 진입 | 팝오버: opacity 0→1, translateY(-8px)→none. 시트: 폰 translateY(100%)→none, 넓은 화면 opacity 0→1 + translateY(16px)→none | 팝오버 150 (M_MS.fast), 시트 280 (리터럴), 뒷막 220 (M_MS.base) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease) | web/js/33-peers.js:214, web/css/11-peers.css:23, web/css/11-peers.css:25 | J111, J112, C044, C045 |
| 컴퓨터 전환기와 뒷막 | prClose (33-peers.js:223) | 이탈 | opacity 1→0 (fade, 끝나면 fill forwards) | 150 (M_MS.fast = --m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease); fill forwards | web/js/33-peers.js:223 | J113 |
| 컴퓨터 전환기 행 `.pr-row` 배경 `.pr-row` | CSS 상태 변화 (호버 등) | 제자리 | background-color, (전환 끔) | background-color 220 (--m-base); 0 | 0 / - | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/11-peers.css:31, web/css/11-peers.css:46 | C046, C047 |
| 업데이트 알림 바 `#upd-bar` | 끝낼 말이 없을 때 ubOut (24-settings-update.js:72). 이 바는 진입 모션이 없음 | 이탈 | opacity 1→0, height 현재높이→0px, paddingTop/Bottom →0px (fill forwards) | 250 (리터럴) | 0 | ease (리터럴) | web/js/24-settings-update.js:77 | J067 |

### 홈, 보드 (web/js/08-home.js, web/js/07-board.js, web/css/05-log.css)

| 대상 | 트리거 | 구분 | 속성 | 길이(ms) | 지연(ms) | 이징 | 근거 | 원시 ID |
|---|---|---|---|---|---|---|---|---|
| 홈 진행 행 (`restRow`) | 새 행이 처음 보일 때 (freshKeys HOME_ROWS, 08-home.js:383-384) | 진입 | opacity 0→1, transform translateY(-8px)→none | 220 (M_MS.base = --m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease); fill backwards | web/js/08-home.js:383, web/js/08-home.js:384 | J041, J042 |
| 홈 끝난 일 행 | 일이 끝나 settle될 때 (08-home.js:380) | 제자리 | opacity .35→1 | 220 (M_MS.base = --m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease) | web/js/08-home.js:380 | J040 |
| 홈 카드 `.card.tap` 배경 `.card.tap` | CSS 상태 변화 (호버 등) (08-home.js) | 제자리 | background | 150 (--m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/02-cards-lists-tags.css:5 | C005 |
| 보드 항목 노드 (07-board.js set) | freshKeys 'shown'에 없던 id가 도착 (07-board.js:180, 201) | 진입 | opacity 0→1, transform translateY(8px)→none | 220 (M_MS.base = --m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease); fill backwards | web/js/07-board.js:180, web/js/07-board.js:201 | J028, J029 |
| 보드 카드 `.bi` 위치와 크기 `.bi`, `.board.bnt .bi`, `.bi, .board.narrow .bi, .bph` | 카드가 재배치, 크기 변경될 때 (드래그 중에는 `.bnt`가 전환을 끔) | 제자리 | left, top, width, height, box-shadow, (전환 끔) | left 220 (--m-base); top 220 (--m-base); width 220 (--m-base); height 220 (--m-base); box-shadow 150 (--m-fast); 0 | 0 / - | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/05-log.css:172, web/css/05-log.css:177, web/css/05-log.css:184 | C020, C021, C025 |
| 보드 카드 `.bi.bdrag`, 좁은 폭 `.board.narrow .bi` `.bi.bdrag`, `.board.narrow .bi`, `.board.narrow .bi.bdrag` | 드래그 시작, 좁은 보드에서 순서 이동 | 제자리 | box-shadow, transform | box-shadow 150 (--m-fast); transform 220 (--m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/05-log.css:178, web/css/05-log.css:181, web/css/05-log.css:182 | C022, C023, C024 |
| 보드 자리표시 `.bph` `.bph` | 드래그 중 놓일 자리 | 제자리 | left, top, width, height | 150 (--m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/05-log.css:185 | C026 |
| 보드 크기 손잡이 `.brz.se::after` `.brz.se::after` | CSS 상태 변화 (호버 등) | 제자리 | opacity | 150 (--m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/05-log.css:196 | C027 |
| 보드 드래그 자동 스크롤 (tick) | 카드를 끌어 가장자리에 둘 때, 드래그가 끝날 때까지 프레임마다 scrollTop 이동 (07-board.js:230-239) | 제자리 | scrollTop += sign x min(B_SCROLL, ceil(\|d\| / B_EDGE x B_SCROLL)) (애니메이션 아님, 프레임 루프) | 프레임당 | 0 | - | web/js/07-board.js:231, web/js/07-board.js:247 | J030, J031 |
| 보드 순서 바꾸기 드래그 (trackOrder, endOrder) | 카드 끌기: 끄는 카드와 밀리는 행에 translateY 인라인 쓰기. 드롭 때 transition을 잠시 none으로 | 제자리 | style.transform translateY(px), style.transition none/비움 | 즉시 (포인터를 따라감), 정착 시 CSS 전환에 맡김 | 0 | - | web/js/07-board.js:261, web/js/07-board.js:262, web/js/07-board.js:267, web/js/07-board.js:275, web/js/07-board.js:276, web/js/07-board.js:277 | J032, J033, J034, J035, J036, J037, J038, J039 |
| 프로젝트 카드 `.pj-card` 배경 `.pj-card` | CSS 상태 변화 (호버 등) (28-harness-project.js) | 제자리 | background | 150 (--m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/05-log.css:254 | C028 |
| 하니스 지도 `.hm-edge` 선, `.hm-lb` 라벨, `.hm-n` 노드, `.hm-st` 상태 `.hm-edge`, `.hm-lb`, `.hm-n`, `.hm-st` | 하니스 지도 호버, 선택 (28-harness-project.js, 27-harness.js) | 제자리 | stroke, opacity, border-color, background | 150 (--m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/05-log.css:291, web/css/05-log.css:296, web/css/05-log.css:299, web/css/06-harness.css:10 | C029, C030, C031, C032 |

### 배지와 숫자 (web/js/09-needs-you.js, 31-notices-screen.js, 30-mail-box.js)

| 대상 | 트리거 | 구분 | 속성 | 길이(ms) | 지연(ms) | 이징 | 근거 | 원시 ID |
|---|---|---|---|---|---|---|---|---|
| 내비 채팅 탭 배지 숫자, 모니터링 탭 배지 숫자 | paintAttn, paintMonAttn: 숫자가 바뀜 | 제자리 | opacity 0→1, transform translateY(±60%)→none (바뀐 자릿수만) | 220 (M_MS.base = --m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease) | web/js/09-needs-you.js:58, web/js/09-needs-you.js:93 | J043, J045 |
| 내비 채팅 탭, 모니터링 탭 배지 | 배지가 0에서 1 이상으로 나타남 (rise 조건) | 진입 | opacity 0→1, transform scale(.6)→scale(1) | 200 (리터럴) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease) | web/js/09-needs-you.js:59, web/js/09-needs-you.js:94 | J044, J046 |
| 종 알림 배지 | paintBell: 숫자 변화, 0에서 n으로 | 제자리 / 진입 | opacity 0→1, transform translateY(±60%)→none (바뀐 자릿수만); 팝 opacity 0→1, transform scale(.6)→scale(1) | 롤 220 (M_MS.base), 팝 200 (리터럴) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease) | web/js/09-needs-you.js:268, web/js/09-needs-you.js:269 | J047, J048 |
| 알림 화면 필터별 개수, 안 읽은 수 | nscPaint: 값이 바뀜 | 제자리 | opacity 0→1, transform translateY(±60%)→none (바뀐 자릿수만) | 220 (M_MS.base = --m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease) | web/js/31-notices-screen.js:109, web/js/31-notices-screen.js:112 | J096, J097 |
| 메일함 개수 `cntSpan` | 개수가 바뀜 | 제자리 | opacity 0→1, transform translateY(±60%)→none (바뀐 자릿수만) | 220 (M_MS.base = --m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease) | web/js/30-mail-box.js:37 | J080 |

### 결정 카드 (web/js/10-decision-card.js, web/css/07-chat.css)

| 대상 | 트리거 | 구분 | 속성 | 길이(ms) | 지연(ms) | 이징 | 근거 | 원시 ID |
|---|---|---|---|---|---|---|---|---|
| 결정 카드 박스 | 새 결정이 도착 (freshKeys DC_SEEN, 10-decision-card.js:556, 572) | 진입 | opacity 0→1, transform translateY(8px)→none | 220 (M_MS.base = --m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease); fill backwards | web/js/10-decision-card.js:556, web/js/10-decision-card.js:572 | J053, J055 |
| 결정 카드 박스 | 상태가 바뀜 (swap, 10-decision-card.js:538, 570) | 제자리 | opacity .35→1 | 220 (M_MS.base = --m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease) | web/js/10-decision-card.js:538, web/js/10-decision-card.js:570 | J051, J054 |
| 결정 카드 박스 | 답한 뒤 사라짐 (dcLeave, 10-decision-card.js:543) | 이탈 | opacity 1→0 (fade, 끝나면 fill forwards) | 150 (M_MS.fast = --m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease); fill forwards | web/js/10-decision-card.js:543 | J052 |
| 결정 카드 행 `.dc-row, .dcm-row` 배경 `.dc-row, .dcm-row` | CSS 상태 변화 (호버 등) | 제자리 | background-color | 150 (--m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/07-chat.css:107 | C038 |
| 결정 카드 접기 화살표 `.dc-fold .ic` `.dc-fold .ic`, `.dc-fold .ic, .td-ch` | 접기, 펼치기 | 제자리 | transform, (전환 끔) | transform 150 (--m-fast); 0 | 0 / - | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/07-chat.css:97, web/css/07-chat.css:174 | C037, C040 |

### 채팅과 할 일 줄 (web/js/11-todo-strip.js, 41-runstate.js, web/css/07-chat.css, 03-base.css)

| 대상 | 트리거 | 구분 | 속성 | 길이(ms) | 지연(ms) | 이징 | 근거 | 원시 ID |
|---|---|---|---|---|---|---|---|---|
| 채팅 타임라인의 새 메시지 행 | 실시간으로 도착한 메시지 (11-todo-strip.js:357, bulk가 아닐 때) | 진입 | opacity 0→1, transform translateY(8px)→none | 150 (M_MS.fast = --m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease); fill backwards | web/js/11-todo-strip.js:357 | J061 |
| 스트림 도착 메시지 root | 15초 안에 도착한 새 스트림 (streamIn, 11-todo-strip.js:97) | 진입 | opacity 0→1 | 300 (리터럴, --m-slow와 같은 값) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease); fill backwards | web/js/11-todo-strip.js:97 | J059 |
| 할 일 줄 박스 | 할 일 단계 갱신 draw (11-todo-strip.js:32) | 제자리 | opacity .35→1 | 220 (M_MS.base = --m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease) | web/js/11-todo-strip.js:32 | J058 |
| 시스템 줄 `.cv-sys` (running에서 완료로) | paintSysLines (11-todo-strip.js:149) | 제자리 | opacity .35→1 | 220 (M_MS.base = --m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease) | web/js/11-todo-strip.js:149 | J060 |
| 작업 묶음 끝 표시 | g.live 묶음이 끝남 (11-todo-strip.js:373) | 제자리 | opacity .35→1 | 220 (M_MS.base = --m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease) | web/js/11-todo-strip.js:373 | J062 |
| 실행 상태 줄 (runstate) | paintRunState에서 swap=true (41-runstate.js:107) | 제자리 | opacity .35→1 | 220 (M_MS.base = --m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease) | web/js/41-runstate.js:107 | J122 |
| 할 일 접기 화살표 `.td-ch` `.td-ch` | 접기, 펼치기 | 제자리 | transform | 150 (--m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/07-chat.css:157 | C039 |
| 채팅창, 터미널 박스 가장자리 그림자 `.chatbox::before/::after`, `.termbox::before/::after` `.chatbox::before, .chatbox::after, .termbox::before, .termbox::after` | 스크롤 위치에 따라 가장자리 표시 | 제자리 | opacity | 150 (--m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/03-base.css:319 | C014 |
| 파일 요약, 작업 요약 화살표 (`.ended > summary svg`, `details.work > summary::before`) `.ended > summary svg`, `details.work > summary::before` | 접기, 펼치기 (04-files.css) | 제자리 | transform | 150 (--m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/04-files.css:36, web/css/04-files.css:153 | C015, C016 |

### 메일 (web/js/30-mail-box.js, 30-mail-sent.js, 30-mail-thread.js, web/css/16-result-card.css, 20-mail-thread.css)

| 대상 | 트리거 | 구분 | 속성 | 길이(ms) | 지연(ms) | 이징 | 근거 | 원시 ID |
|---|---|---|---|---|---|---|---|---|
| 메일함 새 행 | freshKeys MBOX_SEEN (30-mail-box.js:47-48) | 진입 | opacity 0→1, transform translateY(-8px)→none | 220 (M_MS.base = --m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease); fill backwards | web/js/30-mail-box.js:47, web/js/30-mail-box.js:48 | J081, J082 |
| 메일함 행 (삭제, 보관) | mbRowsOut (30-mail-box.js:54) | 이탈 | opacity 1→0 (fade, 끝나면 fill forwards) | 150 (M_MS.fast = --m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease); fill forwards | web/js/30-mail-box.js:54 | J083 |
| 메일 작성 카드 | 함수 save 안 (30-mail-box.js:321) | 진입 | opacity 0→1, transform translateY(8px)→none | 240 (리터럴) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease); fill backwards | web/js/30-mail-box.js:321 | J085 |
| 메일 작성 카드 | leave (30-mail-box.js:310, motionOut(node, "rise")) | 이탈 | opacity 1→0, transform none→translateY(8px) | 150 (M_MS.fast = --m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease); fill forwards | web/js/30-mail-box.js:310 | J084 |
| 메일 답장 박스 `.mbox-reply` | 답장 모드가 새로 열림 (30-mail-box.js:355) | 진입 | opacity 0→1, transform translateY(8px)→none | 220 (M_MS.base = --m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease); fill backwards | web/js/30-mail-box.js:355 | J086 |
| 보낸 메일 초안 카드 | mailSentRemove (30-mail-sent.js:32) | 이탈 | opacity 1→0 (fade, 끝나면 fill forwards) | 150 (M_MS.fast = --m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease); fill forwards | web/js/30-mail-sent.js:32 | J087 |
| 보낸 메일 접기 화살표 `.ms-ch` `.ms-ch` | 접기, 펼치기 (30-mail-sent.js) | 제자리 | transform | 150 (--m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/16-result-card.css:235 | C068 |
| 메일 스레드 화살표 `.mhd-ch`, `.mth-ch` `.mhd-ch`, `.mth-ch` | 접기, 펼치기 (30-mail-thread.js) | 제자리 | transform | 150 (--m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/20-mail-thread.css:16, web/css/20-mail-thread.css:27 | C076, C077 |
| 결과 카드 원문 `.rc-raw > summary::before`, 메일 본문 `.mb-txt details > summary::before` `.rc-raw > summary::before`, `.mb-txt details > summary::before` | 접기, 펼치기 | 제자리 | transform | 150 (--m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/16-result-card.css:23, web/css/16-result-card.css:79 | C066, C067 |

### 알림 화면과 알림 하이라이트 (web/js/30-notices.js, 31-notices-screen.js, web/css/09-notices.css)

| 대상 | 트리거 | 구분 | 속성 | 길이(ms) | 지연(ms) | 이징 | 근거 | 원시 ID |
|---|---|---|---|---|---|---|---|---|
| 알림 정렬 목록의 새 행 (`ntAlertMarks`) | 새 알림 행이 도착, 이전보다 최신 (30-notices.js:322-325) | 진입 | opacity 0→1, transform translateY(8px)→none | 220 (M_MS.base = --m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease); fill backwards | web/js/30-notices.js:322, web/js/30-notices.js:325 | J090, J091 |
| 알림 행 (무시) | ntIgnore (30-notices.js:481) | 이탈 | opacity 1→0 (fade, 끝나면 fill forwards) | 150 (M_MS.fast = --m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease); fill forwards | web/js/30-notices.js:481 | J092 |
| 알림 화면 새 행 | freshKeys NSC.seen (31-notices-screen.js:117-119) | 진입 | opacity 0→1, transform translateY(-8px)→none | 220 (M_MS.base = --m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease); fill backwards | web/js/31-notices-screen.js:117, web/js/31-notices-screen.js:119 | J098, J099 |
| 알림 화면 목록 (필터 바꿈) | nscFilter (31-notices-screen.js:144) | 제자리 | opacity .35→1 | 220 (M_MS.base = --m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease) | web/js/31-notices-screen.js:144 | J101 |
| 알림 화면 접힌 반복 행 | nscFold: 접힘 시 이탈, 펼침 시 진입 (31-notices-screen.js:154, 159) | 이탈 / 진입 | 이탈: opacity 1→0 (fade, 끝나면 fill forwards); 진입: opacity 0→1, transform translateY(-8px)→none | 150 (M_MS.fast = --m-fast) (이탈), 220 (M_MS.base = --m-base) (진입) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease) | web/js/31-notices-screen.js:154, web/js/31-notices-screen.js:159 | J102, J103 |
| 알림 화면 행 (처리, 읽음) | nscLeave (31-notices-screen.js:183-187): 이탈 뒤 이동한 행이 진입 | 이탈 / 진입 | 이탈: opacity 1→0 (fade, 끝나면 fill forwards); 진입: opacity 0→1, transform translateY(-8px)→none | 150 (M_MS.fast = --m-fast) (이탈), 220 (M_MS.base = --m-base) (진입) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease) | web/js/31-notices-screen.js:183, web/js/31-notices-screen.js:187 | J104, J105 |
| 알림 화면 되돌린 행 (nscUndo) | 되돌리기 (31-notices-screen.js:224, rAF 두 번 뒤) | 진입 | opacity 0→1, transform translateY(-8px)→none | 220 (M_MS.base = --m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease); fill backwards | web/js/31-notices-screen.js:224 | J106, J107, J108 |
| 알림 화면 모두 읽음 | nscReadAll (31-notices-screen.js:233) | 이탈 | opacity 1→0 (fade, 끝나면 fill forwards) | 150 (M_MS.fast = --m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease); fill forwards | web/js/31-notices-screen.js:233 | J109 |
| 알림 접기 화살표 `.nsc-fold .ic` `.nsc-fold .ic` | 접기, 펼치기 | 제자리 | transform | 150 (--m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/09-notices-screen.css:35 | C041 |
| 알림 하이라이트 `.nt-hl::after` (JS 클래스는 30-notices.js:171에서 붙이고 2300ms 뒤 제거) `.nt-hl::after` | 알림에서 해당 메시지로 이동했을 때 1회 | 제자리 | nt-hl: opacity | 1800 | 200 | ease-in-out; 반복 1, fill both | web/css/09-notices.css:20, web/css/09-notices.css:25 | C042, K002 |
| 알림 하이라이트, 동작 줄이기 `.nt-hl::after` | prefers-reduced-motion: reduce | 제자리 | nt-hl-still: opacity | 1400 | 0 | step-end; 반복 1, fill both !important | web/css/09-notices.css:28, web/css/09-notices.css:30 | C043, K003 |

### 답장, 인용, 트리아지 (web/js/39-reply.js, 30-replies.js, 30-triage.js, web/css/15-reply.css, 15-triage.css)

| 대상 | 트리거 | 구분 | 속성 | 길이(ms) | 지연(ms) | 이징 | 근거 | 원시 ID |
|---|---|---|---|---|---|---|---|---|
| 답장 스와이프 행 `[data-rid].rp-snap` `[data-rid].rp-snap` | 손을 뗐을 때 제자리로 복귀 (39-reply.js:123) | 제자리 | transform | 220 (--m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/15-reply.css:4 | C061 |
| 답장 표시 `.rp-ind` `.rp-ind` | 스와이프로 기준을 넘음 | 제자리 | background, color | 150 (--m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/15-reply.css:6 | C062 |
| 인용된 메시지 하이라이트 `[data-rid].rp-flash` `[data-rid].rp-flash` | 인용 줄을 눌러 원문으로 이동 (39-reply.js:56, animationend에서 클래스 제거) | 제자리 | rp-flash: background | 1200 | 0 | ease-out; 반복 1, fill none | web/css/15-reply.css:9, web/css/15-reply.css:8 | C063, K008 |
| 답장 버튼 `.rp-btn` `.rp-btn` | 행 호버, 키보드 포커스 | 제자리 | opacity, background-color | 150 (--m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/15-reply.css:12 | C064 |
| 인용 원문으로 스크롤 (rpJump) | scrollIntoView({ behavior: "smooth" }) (39-reply.js:55) | 제자리 | 스크롤 위치 (브라우저 smooth) | 브라우저 기본 | 0 | 브라우저 기본 | web/js/39-reply.js:55 | J121 |
| 답장 큐 하단 액션 `foot` | rqStoreActs (30-replies.js:99) | 제자리 | opacity .35→1 | 220 (M_MS.base = --m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease) | web/js/30-replies.js:99 | J093 |
| 트리아지 진행 막대 `.tr-bar > span` `.tr-bar > span` | 처리된 개수가 바뀜 | 제자리 | width | 220 (--m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/15-triage.css:17 | C065 |

### 카카오 (web/js/30-kakao.js, web/css/17-kakao.css)

| 대상 | 트리거 | 구분 | 속성 | 길이(ms) | 지연(ms) | 이징 | 근거 | 원시 ID |
|---|---|---|---|---|---|---|---|---|
| 카카오 말풍선 하이라이트 `.kk-m.kk-hl` (클래스는 30-kakao.js:213에서 붙이고 3200ms 뒤 제거) `.kk-m.kk-hl .kk-bub, .kk-m.kk-hl .kk-media, .kk-m.kk-hl .kk-sticker` | 원문 메시지로 이동했을 때 1회 | 제자리 | kk-hl: background, box-shadow | 3200 | 0 | ease; 반복 1, fill none | web/css/17-kakao.css:196, web/css/17-kakao.css:197 | C072, K009 |
| 카카오 하이라이트, 동작 줄이기 `.kk-m.kk-hl .kk-bub, .kk-m.kk-hl .kk-media, .kk-m.kk-hl .kk-sticker` | prefers-reduced-motion: reduce | 제자리 | (animation-duration) | 10 | 0 |  | web/css/17-kakao.css:198 | C073 |
| 카카오 스위치 `.kk-sw` 배경, `.kk-knob` 손잡이 `.kk-sw`, `.kk-knob`, `.kk-sw, .kk-knob` | 스위치 켜고 끔 | 제자리 | background, transform, (전환 끔) | background 150 (--m-fast); transform 220 (--m-base); 0 | 0 / - | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/17-kakao.css:80, web/css/17-kakao.css:82, web/css/17-kakao.css:85 | C069, C070, C071 |

### 초안 원문 패널 (web/js/10-draft-original.js, web/css/15-draft-original.css)

| 대상 | 트리거 | 구분 | 속성 | 길이(ms) | 지연(ms) | 이징 | 근거 | 원시 ID |
|---|---|---|---|---|---|---|---|---|
| `.od-orig` 원문 패널 (opacity, transform, visibility) `.od-orig`, `.od-orig[inert]`, `.od-orig, .od-draftcol, .od-cwrap .kk-draft, .fs-card.tall.od-host, .od-cwrap .od-orig` | host의 `od-on` 토글 (10-draft-original.js:77) | 제자리 | opacity, transform, visibility, (transition-delay), (전환 끔) | opacity 300 (--m-slow); transform 300 (--m-slow); visibility 0; 0 | 0 / 0, 0, 250 / - | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/15-draft-original.css:14, web/css/15-draft-original.css:15, web/css/15-draft-original.css:79 | C053, C054, C060 |
| `.fs-card.tall.od-host` 카드 폭과 이동 (900px 이상) `.fs-card.tall.od-host` | od-on 토글 | 제자리 | transform, width | 300 (--m-slow) | 0 | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/15-draft-original.css:49 | C055 |
| `.od-cwrap .od-orig` 원문 칸 너비, 여백 (900px 이상) `.od-cwrap .od-orig`, `.od-cwrap .od-orig[inert]` | od-on 토글 | 제자리 | flex-basis, margin, opacity, transform, visibility, (transition-delay) | flex-basis 300 (--m-slow); margin 300 (--m-slow); opacity 300 (--m-slow); transform 300 (--m-slow); visibility 0 | 0 / 0, 0, 0, 0, 250 | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/15-draft-original.css:54, web/css/15-draft-original.css:56 | C056, C057 |
| `.od-draftcol`, `.od-cwrap .kk-draft` 초안 칸 이동 (899px 이하) `.od-draftcol, .od-cwrap .kk-draft`, `.od-draftcol[inert], .od-cwrap .kk-draft[inert]` | od-on 토글 | 제자리 | transform, visibility, (transition-delay) | transform 300 (--m-slow); visibility 0 | 0 / 0, 250 | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/15-draft-original.css:66, web/css/15-draft-original.css:67 | C058, C059 |

### 설정과 기기 (web/js/22-settings.js, 25-settings-*.js, 24-settings-update.js, 27-harness.js, 29-harness-features.js, 32-app-settings.js, web/css/03-base.css, 06-harness.css)

| 대상 | 트리거 | 구분 | 속성 | 길이(ms) | 지연(ms) | 이징 | 근거 | 원시 ID |
|---|---|---|---|---|---|---|---|---|
| 설정 계정 순서 드래그 `.li.acc` | 행을 끌 때 (25-settings-accounts.js:32-45) | 제자리 | transform translateY(px) (행마다 style.transform 쓰기), CSS transition transform | 150 (--m-fast), 끄는 행은 none | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease) | web/css/02-cards-lists-tags.css:86, web/css/02-cards-lists-tags.css:87, web/js/25-settings-accounts.js:33 | C007, C008, J068 |
| 필드 순서 칩 드래그 (fbDrag) | 칩을 끌 때 (22-settings.js:141, 150) | 제자리 | style.transform translate(dx, dy) | 즉시 (포인터를 따라감) | 0 | - | web/js/22-settings.js:141, web/js/22-settings.js:150 | J065, J066 |
| 필드 스위치 `.fb-sw` `.fb-sw` | 선택 변경 | 제자리 | background-color, color | 150 (--m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/03-base.css:58 | C009 |
| 두 칸 토글 `.seg button` `.seg button` | 선택 변경 | 제자리 | background-color, color | 220 (--m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/03-base.css:124 | C010 |
| 하니스 스위치 `.hs-sw` 배경, `.hs-sw::after` 손잡이 `.hs-sw`, `.hs-sw::after` | 켜고 끔 | 제자리 | background, transform | background 150 (--m-fast); transform 220 (--m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/06-harness.css:95, web/css/06-harness.css:96 | C033, C034 |
| 하니스 기능 카드 `.fc-card` 배경, `.fc-gh .ic` 화살표 `.fc-gh .ic`, `.fc-card` | CSS 상태 변화 (호버 등), 접기 | 제자리 | transform, background | 150 (--m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/06-harness.css:164, web/css/06-harness.css:169 | C035, C036 |
| 연결된 기기 행 `[data-dev]` | 기기 빼기 (25-settings-devices.js:55). 진입 모션은 없음 | 이탈 | opacity 1→0 (fade, 끝나면 fill forwards) | 150 (M_MS.fast = --m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease); fill forwards | web/js/25-settings-devices.js:55 | J069 |
| 온보딩 머리글 (v.swap) | 다음 단계로 바뀔 때, rAF 한 번 뒤 (25-settings-onboarding.js:107) | 제자리 | opacity .35→1 | 220 (M_MS.base = --m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease) | web/js/25-settings-onboarding.js:107 | J070, J071 |
| 온보딩 버튼 라벨 (stFlash) | 누른 직후와 1800ms 뒤 원래 글자로 (25-settings-onboarding.js:120-121) | 제자리 | opacity .35→1 | 220 (M_MS.base = --m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease) | web/js/25-settings-onboarding.js:120, web/js/25-settings-onboarding.js:121 | J072, J073 |
| 하니스 버튼 라벨 (hFlash) | 누른 직후와 1800ms 뒤 (27-harness.js:46-47) | 제자리 | opacity .35→1 | 220 (M_MS.base = --m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease) | web/js/27-harness.js:46, web/js/27-harness.js:47 | J074, J075 |
| 하니스 프로젝트 스위치 컨트롤 | 초안 토글 (28-harness-project.js:429) | 제자리 | opacity .35→1 | 220 (M_MS.base = --m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease) | web/js/28-harness-project.js:429 | J076 |
| 하니스 기능 요청 보냄 표시 | post (29-harness-features.js:65) | 제자리 | opacity .35→1 | 220 (M_MS.base = --m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease) | web/js/29-harness-features.js:65 | J077 |
| 앱 설정 카드 다시 그림 | redraw (32-app-settings.js:606) | 제자리 | opacity .35→1 | 220 (M_MS.base = --m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease) | web/js/32-app-settings.js:606 | J110 |
| 공급자, 모니터링 접기 화살표 `.fr-chev`, 로그 접기 `.ls > summary::after`, `details.box > summary::before`, `.subsum .chev` `.fr-chev`, `.ls > summary::after`, `details.box > summary::before`, `.subsum .chev` | 접기, 펼치기 (19-volume.css, 05-log.css) | 제자리 | transform, (전환 끔) | transform 150 (--m-fast); 0 | 0 / - | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/19-volume.css:24, web/css/19-volume.css:37, web/css/05-log.css:26, web/css/05-log.css:81, web/css/05-log.css:100 | C074, C075, C017, C018, C019 |

### 공통 컴포넌트 (web/css/01-tokens.css, 02-cards-lists-tags.css)

| 대상 | 트리거 | 구분 | 속성 | 길이(ms) | 지연(ms) | 이징 | 근거 | 원시 ID |
|---|---|---|---|---|---|---|---|---|
| `.btn, .dc-act, .dc-go, .dc-back, .dc-manual` 버튼 `.btn, .dc-act, .dc-go, .dc-back, .dc-manual` | CSS 상태 변화 (호버 등) | 제자리 | opacity, background-color | 150 (--m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/01-tokens.css:254 | C004 |
| 진행 막대 `.bar i` `.bar i` | `--p` 값이 바뀜 | 제자리 | width | 300 (--m-slow) | 0 | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/css/02-cards-lists-tags.css:51 | C006 |
| 동작 줄이기 전역 규칙 `*, *::before, *::after, ::backdrop` | prefers-reduced-motion: reduce | 제자리 | transition: none !important, animation: none !important, scroll-behavior: auto !important | 0 | - | - | web/css/01-tokens.css:126 | C001, C002, C003 |

### 원격 데스크톱 pill, 카드 양식 (web/js/37-remote-desktop.js, web/custom.js)

| 대상 | 트리거 | 구분 | 속성 | 길이(ms) | 지연(ms) | 이징 | 근거 | 원시 ID |
|---|---|---|---|---|---|---|---|---|
| 원격 데스크톱 접속자 pill `p` | 처음 나타남 (37-remote-desktop.js:89) | 진입 | opacity 0→1 | 220 (M_MS.base = --m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease); fill backwards | web/js/37-remote-desktop.js:89 | J116 |
| 원격 데스크톱 pill 글자 | 접속자 글이 바뀜 (37-remote-desktop.js:90) | 제자리 | opacity .35→1 | 220 (M_MS.base = --m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease) | web/js/37-remote-desktop.js:90 | J117 |
| 원격 데스크톱 pill | 접속자가 없어짐 (37-remote-desktop.js:92) | 이탈 | opacity 1→0 (fade, 끝나면 fill forwards) | 150 (M_MS.fast = --m-fast) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease); fill forwards | web/js/37-remote-desktop.js:92 | J118 |
| 카드 양식 미리보기 `pvBox` | swapPreview 호출 (custom.js:456) | 제자리 | opacity .35→1 | 220 (M_MS.base = --m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (M_EASE = --m-ease) | web/custom.js:456 | J124 |
| `.cu-vt-c` 보기 방식 카드 배경 (custom.js 안 CSS 문자열) | 호버, 선택 (custom.js:44) | 제자리 | background-color | 220 (--m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/custom.js:44 | I001 |
| `.cu-more summary svg.ic` 화살표 (custom.js 안 CSS 문자열) | 접기, 펼치기 (custom.js:66) | 제자리 | transform | 220 (--m-base) | 0 | cubic-bezier(.2, .7, .2, 1) (--m-ease) | web/custom.js:66 | I002 |

### 움직임 없는 rAF 배치와 스크롤 (묶음)

| 대상 | 트리거 | 구분 | 속성 | 길이(ms) | 지연(ms) | 이징 | 근거 | 원시 ID |
|---|---|---|---|---|---|---|---|---|
| rAF 프레임 한 번 뒤로 미루는 다시 그리기, 측정, 즉시 스크롤 (animate 없음, style 쓰기 없음) | 데이터 갱신, 크기 변화 | 제자리 | 없음 (페인트와 측정 시점만 조정; J064, J079는 `scrollIntoView`를 smooth 없이 호출) | 프레임 1개 (J056은 같은 높이가 3프레임 연속일 때까지, 최대 120프레임) | 0 | - | web/js/09-needs-you.js:335, web/js/09-needs-you.js:348, web/js/11-mailbody.js:106, web/js/11-mailbody.js:166, web/js/15-picker.js:124, web/js/20-models.js:122, web/js/30-apps.js:138, web/js/30-kakao.js:1068, web/js/30-monitoring.js:1031, web/js/30-notices.js:123, web/js/31-conversations.js:242, web/js/31-conversations.js:414, web/js/31-notices-screen.js:122, web/js/34-composer-viewport.js:20, web/js/36-shell.js:57, web/custom.js:455 | J049, J050, J056, J057, J063, J064, J078, J079, J088, J089, J094, J095, J100, J114, J115, J123 |

전수표 행 수: 108행 (위 묶음 행 1개 포함). 모션 규칙의 헬퍼 22행(J001~J022), 동작 줄이기 22행(R001~R022), 키프레임 9행(K001~K009, 아래 표)은 각각 그 절에서 셌어요.

### @keyframes 전수 (9블록, 15스톱)

| ID | 이름 | 스톱 | 근거 | 쓰는 선언 |
|---|---|---|---|---|
| K001 | `ntf-in` | from { opacity: 0; transform: translateX(16px) scale(.98) } | web/css/03-base.css:218 | C012 |
| K002 | `nt-hl` | 0% { opacity: 0 } ; 14% { opacity: 1 } ; 50% { opacity: 1 } ; 100% { opacity: 0 } | web/css/09-notices.css:25 | C042 |
| K003 | `nt-hl-still` | 0% { opacity: 1 } ; 100% { opacity: 0 } | web/css/09-notices.css:30 | C043 |
| K004 | `menu-in` | from { opacity: 0; transform: translateY(-8px) } | web/css/14-overlay.css:4 | C048 |
| K005 | `menu-sheet-in` | from { transform: translateY(100%) } | web/css/14-overlay.css:6 | C049 |
| K006 | `m-scrim-in` | from { opacity: 0 } | web/css/14-overlay.css:11 | C050 |
| K007 | `m-scrim-out` | to { opacity: 0 } | web/css/14-overlay.css:12 | C052 |
| K008 | `rp-flash` | from { background: color-mix(in srgb, var(--accent) 16%, transparent) } ; to { background: transparent } | web/css/15-reply.css:8 | C063 |
| K009 | `kk-hl` | 0%, 75% { background: color-mix(in srgb, var(--accent) 22%, transparent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 22%, transparent) } ; 100% { background: transparent; box-shadow: none } | web/css/17-kakao.css:197 | C072 |

CSS 선언 77행(transition 62, animation 14, scroll-behavior 1) 중 @media 안에 있는 것은 16행이에요.

## 진입·이탈 짝

판정은 원시 행에서 찾은 호출과 CSS 선언만 근거로 했어요. 이탈 호출이 원시 행에 없으면 "이탈 없음"이라고 적었어요.

| 표면 | 진입 | 이탈 | 판정 |
|---|---|---|---|
| 전체화면 시트, 프레임 (38-overlay.js) | motionSheet 280 (J120) | motionSheetOut 150 fade (J119), 소유자가 닫을 때만. 프로그램 close는 즉시 | 짝 있음 (진입 280, 이탈 150, 비대칭 의도) |
| dialog (02-basic-markdown.js:275) | motionDialog sheet 280 (J025), 뒷막 m-scrim-in 220 (C050) | close() 가로채기 fade 150 + 뒷막 m-scrim-out 150 (C052) | 짝 있음 |
| 명령 팔레트 | motionDialog pop 180 (J026), 뒷막 180 (C051) | close() fade 150 + 뒷막 150 (C052) | 짝 있음 |
| 컴퓨터 전환기 (33-peers.js) | 팝오버 150 / 시트 280 (J111, J112) | motionSheetOut 150 (J113) | 짝 있음 |
| 메뉴 `.menu` (03-menu.js) | menu-in 150 (C048), 폰 menu-sheet-in 280 (C049) | closeMenu는 `m.node.remove()`로 즉시 제거 (03-menu.js:7) | 진입만 있고 이탈 없음 |
| 토스트 `.snack` (02-basic-markdown.js) | motionIn rise 220 (J024) | motionOut fade 150 (J023) | 짝 있음 |
| 플로팅 알림 `.ntf` | ntf-in 220, translateX(16px) scale(.98) (C012, K001) | `.out` 전환 150, translateX(12px) scale(.98) (C011, C013) | 짝 있음 (이동량 16px과 12px이 서로 다름) |
| 업데이트 바 `#upd-bar` | 없음 (24-settings-update.js:83에서 생성하고 바로 붙임) | 높이 접힘 + 페이드 250 (J067) | 이탈만 있고 진입 없음 |
| 결정 카드 | motionIn rise 220 (J055) | motionOut fade 150 (J052) | 짝 있음 |
| 알림 행 (30-notices.js) | motionIn rise 220 (J091) | motionOut fade 150 (J092) | 짝 있음 |
| 알림 화면 행 (31-notices-screen.js) | motionIn top 220 (J099, J103, J105, J106) | motionOut fade 150 (J102, J104, J109) | 짝 있음 |
| 메일함 행 | motionIn top 220 (J082) | motionOut fade 150 (J083) | 짝 있음 |
| 메일 작성 카드 | motionIn rise 240 (J085) | motionOut rise 150 (J084) | 짝 있음 (진입 240이 리터럴) |
| 메일 답장 박스 `.mbox-reply` | motionIn rise 220 (J086) | 원시 행에 이탈 호출 없음 | 진입만 있고 이탈 없음 |
| 보낸 메일 초안 카드 | 없음 | motionOut fade 150 (J087) | 이탈만 있고 진입 없음 |
| 연결된 기기 행 | 없음 | motionOut fade 150 (J069) | 이탈만 있고 진입 없음 |
| 원격 데스크톱 pill | motionIn fade 220 (J116) | motionOut fade 150 (J118) | 짝 있음 |
| 홈 행 (08-home.js) | motionIn top 220 (J042) | 원시 행에 이탈 호출 없음 | 진입만 있고 이탈 없음 |
| 보드 항목 (07-board.js) | motionIn rise 220 (J029) | 원시 행에 이탈 호출 없음 | 진입만 있고 이탈 없음 |
| 채팅 메시지 행 | motionIn rise 150 (J061) | 원시 행에 이탈 호출 없음 (기록은 사라지지 않음) | 진입만 있고 이탈 없음 |
| 스트림 메시지 (11-todo-strip.js:97) | motionIn fade 300 (J059) | 없음 | 진입만 있고 이탈 없음 |
| 화면 전환 (motionView) | rise 150 + 행 12ms 간격 (J027) | 없음 (이전 화면은 hidden) | 진입만 있고 이탈 없음 |
| 배지 (내비, 종) | motionPop 200 (J044, J046, J048), rollCount 220 | 0이 되면 textContent를 비움, 모션 없음 | 진입만 있고 이탈 없음 |
| 초안 원문 패널 `.od-orig` | transition 300 (C053 등), 열릴 때 | 같은 transition이 닫힐 때도 적용, visibility는 .25s 지연 (C054, C057, C059) | 짝 있음 (한 선언이 양방향) |
| 접기 화살표, 스위치, 호버 배경 (CSS transition 전부) | 같은 transition 선언 | 같은 transition 선언 | 짝 있음 (양방향 자동) |
| 하이라이트 `.nt-hl`, `.kk-hl`, `[data-rid].rp-flash` | 한 번 재생되고 스스로 끝남 (C042, C072, C063) | 클래스를 JS가 제거 (30-notices.js:174, 30-kakao.js:216, 39-reply.js:57) | 해당 없음 (단방향 하이라이트) |

## 무한 반복

측정 결과: CSS `infinite` 애니메이션 0개, `animation-iteration-count` 선언 0개, JS `iterations: Infinity` 0개예요. 앱에는 끝없이 반복하는 모션이 없어요.

| 반복 | 원인 | 멈추는 조건 | 근거 |
|---|---|---|---|
| 보드 드래그 자동 스크롤 `tick` (rAF 루프) | 카드를 끌어 스크롤러 가장자리에 둠 | `act`가 null이거나 `act.on`이 false이면 return, 드래그 finish에서 `cancelAnimationFrame(act.raf)` | web/js/07-board.js:230-239 (J030, J031), finish 줄 224 |
| 메일 본문 높이 측정 `settle` (rAF 루프) | iframe 본문 높이가 안정될 때까지 | 같은 높이가 3프레임 연속이면 settled, 120프레임 넘으면 강제 종료 | web/js/11-mailbody.js:98-106 (J056) |
| 상태 글자 `tickWorking` 1000ms 간격 | tickWorking 호출 (함수 이름 기준으로 적음) | 탭이 숨겨지면 건너뜀. 인터벌 자체는 멈추지 않음 | web/js/14-slash-commands.js:301 |
| 실행 상태 `paintRunState` 1000ms 간격 | paintRunState 호출 (함수 이름 기준으로 적음) | 탭이 숨겨지면 건너뜀. 인터벌 자체는 멈추지 않음 | web/js/41-runstate.js:113 |
| 모니터링 `monTick` 1000ms 간격 | monTick 호출 (함수 이름 기준으로 적음) | 화면이 모니터링이 아니거나 숨겨지면 `monTickStop()` | web/js/30-monitoring.js:1148 |

위 3개 인터벌은 글자를 다시 쓰는 갱신이지 transform이나 opacity를 움직이는 애니메이션이 아니에요. 그 밖의 `setInterval`(폴링)은 화면을 움직이지 않으므로 이 표에서 뺐어요(web/js와 web/custom.js에서 `setInterval(`이 있는 줄 27개). 하이라이트 3종(`nt-hl` 1.8s, `kk-hl` 3.2s, `rp-flash` 1.2s)은 모두 반복 1회예요.

## 규칙과 어긋남

기준은 `web/DESIGN.md` Motion(56~71줄), `docs/ui-spec.md` 97~101줄과 397줄이에요. 아무것도 고치지 않았어요.

### 1. 토큰이 아닌 길이, 지연, 곡선 (CSS)

| ID | 근거 | 선언 | 어긋난 부분 |
|---|---|---|---|
| C042 | web/css/09-notices.css:20 | `animation: nt-hl 1.8s ease-in-out .2s both` | 길이 1.8s (1800ms); 지연 .2s (200ms); 곡선 ease-in-out |
| C043 | web/css/09-notices.css:28 | `animation: nt-hl-still 1.4s step-end both !important` | 길이 1.4s (1400ms); 곡선 step-end |
| C049 | web/css/14-overlay.css:5 | `animation: menu-sheet-in 280ms var(--m-ease)` | 길이 280ms (280ms) |
| C051 | web/css/14-overlay.css:9 | `animation-duration: 180ms` | 길이 180ms (180ms) |
| C054 | web/css/15-draft-original.css:15 | `transition-delay: 0s, 0s, .25s` | 지연 .25s (250ms) |
| C057 | web/css/15-draft-original.css:56 | `transition-delay: 0s, 0s, 0s, 0s, .25s` | 지연 .25s (250ms) |
| C059 | web/css/15-draft-original.css:67 | `transition-delay: 0s, .25s` | 지연 .25s (250ms) |
| C063 | web/css/15-reply.css:9 | `animation: rp-flash 1.2s ease-out` | 길이 1.2s (1200ms); 곡선 ease-out |
| C072 | web/css/17-kakao.css:196 | `animation: kk-hl 3.2s ease` | 길이 3.2s (3200ms); 곡선 ease |
| C073 | web/css/17-kakao.css:198 | `animation-duration: .01s` | 길이 .01s (10ms) |

### 2. 토큰이 아닌 길이, 지연, 곡선 (JS)

| ID | 근거 | 내용 |
|---|---|---|
| J004 | web/js/01-motion.js:21 | 시트 열림 280ms 리터럴. DESIGN.md:61은 "sheet opens"를 `--m-base` 220으로 적었어요 (같은 280이 web/css/14-overlay.css:5 `menu-sheet-in`에도 있음, C049) |
| J008 | web/js/01-motion.js:30 | 팔레트 pop 180ms 리터럴 (뒷막 180ms 리터럴과 짝: web/css/14-overlay.css:9, C051) |
| J012 | web/js/01-motion.js:45 | 배지 pop 200ms 리터럴 |
| J059 | web/js/11-todo-strip.js:97 | `motionIn(root, "fade", 300)`: 값은 `--m-slow`와 같지만 `M_MS.slow`를 안 씀 |
| J085 | web/js/30-mail-box.js:321 | `motionIn(node, "rise", 240)`: 240은 어떤 토큰과도 다름 |
| J067 | web/js/24-settings-update.js:77 | 250ms 리터럴, 곡선 `"ease"` 리터럴 (`M_EASE`가 아님). ui-spec.md:173에는 250ms로 적혀 있음 |

### 3. transform, opacity 밖 속성 전환

DESIGN.md:56은 "transform/opacity only"이고 ui-spec.md:397은 `.bar i` 너비만 예외로 두어요. 아래는 transition 선언에서 읽은 속성이에요.

| 속성 | 선언 수 | ID | 근거 |
|---|---|---|---|
| `background` | 9 | C005, C011, C028, C031, C032, C033, C036, C062, C069 | web/css/02-cards-lists-tags.css:5, web/css/03-base.css:201, web/css/05-log.css:254, web/css/05-log.css:299, web/css/06-harness.css:10, web/css/06-harness.css:95, web/css/06-harness.css:169, web/css/15-reply.css:6, web/css/17-kakao.css:80 |
| `background-color` | 6 | C004, C009, C010, C038, C046, C064 | web/css/01-tokens.css:254, web/css/03-base.css:58, web/css/03-base.css:124, web/css/07-chat.css:107, web/css/11-peers.css:31, web/css/15-reply.css:12 |
| `width` | 5 | C006, C020, C026, C055, C065 | web/css/02-cards-lists-tags.css:51, web/css/05-log.css:172, web/css/05-log.css:185, web/css/15-draft-original.css:49, web/css/15-triage.css:17 |
| `box-shadow` | 4 | C020, C022, C023, C024 | web/css/05-log.css:172, web/css/05-log.css:178, web/css/05-log.css:181, web/css/05-log.css:182 |
| `color` | 3 | C009, C010, C062 | web/css/03-base.css:58, web/css/03-base.css:124, web/css/15-reply.css:6 |
| `visibility` | 3 | C053, C056, C058 | web/css/15-draft-original.css:14, web/css/15-draft-original.css:54, web/css/15-draft-original.css:66 |
| `left` | 2 | C020, C026 | web/css/05-log.css:172, web/css/05-log.css:185 |
| `top` | 2 | C020, C026 | web/css/05-log.css:172, web/css/05-log.css:185 |
| `height` | 2 | C020, C026 | web/css/05-log.css:172, web/css/05-log.css:185 |
| `stroke` | 1 | C029 | web/css/05-log.css:291 |
| `border-color` | 1 | C031 | web/css/05-log.css:299 |
| `flex-basis` | 1 | C056 | web/css/15-draft-original.css:54 |
| `margin` | 1 | C056 | web/css/15-draft-original.css:54 |

추가로 JS는 web/js/24-settings-update.js:77에서 `height`, `paddingTop`, `paddingBottom`을 WAAPI로 움직여요(J067). `.bar i`의 `width`(C006, 02-cards-lists-tags.css:51)는 ui-spec.md:397의 예외지만, `.tr-bar > span`의 `width`(C065, web/css/15-triage.css:17)는 예외 목록에 없어요.

### 4. 같은 종류인데 길이가 다른 것

| 항목 | 값 | 근거 |
|---|---|---|
| 진행 막대 너비 | `.bar i`는 `--m-slow` 300, `.tr-bar > span`은 `--m-base` 220 | web/css/02-cards-lists-tags.css:51 (C006), web/css/15-triage.css:17 (C065) |
| 팝업 메뉴 폰 시트 | 280 리터럴, 전체화면 시트도 280, DESIGN.md의 "sheet opens"는 220 | web/css/14-overlay.css:5, web/js/01-motion.js:21, web/DESIGN.md:61 |
| 150ms 미만 또는 300ms 초과 (ui-spec.md:397 금지) | `nt-hl` 1800ms (지연 200), `nt-hl-still` 1400ms, `rp-flash` 1200ms, `kk-hl` 3200ms, `kk-hl` 동작 줄이기 .01s | web/css/09-notices.css:20, 28; web/css/15-reply.css:9; web/css/17-kakao.css:196, 198 (C042, C043, C063, C072, C073) |

### 5. 동작 줄이기 경로

| 항목 | 내용 | 근거 |
|---|---|---|
| 가드 없는 smooth 스크롤 | `scrollIntoView({ block: "center", behavior: "smooth" })`가 `reducedMotion()` 확인 없이 호출돼요. 전역 `scroll-behavior: auto`는 명시된 `behavior` 옵션을 못 이겨요. 같은 종류인 web/custom.js:509는 `matchMedia(...) ? "auto" : "smooth"`로 가드해요 | web/js/39-reply.js:55 (J121), web/custom.js:509 (R022) |
| 효과 없는 규칙 | `.kk-hl`의 `animation-duration: .01s`는 전역 `animation: none !important`(01-tokens.css:126)에 가려져 적용되지 않는 것으로 읽혀요(캐스케이드를 읽은 판단이고 브라우저에서 확인하지 않았어요) | web/css/17-kakao.css:198 (C073, R008) |
| 하이라이트가 사라지는 경로 | `nt-hl`은 reduced에서 정지 색조(`nt-hl-still`)가 남지만, `kk-hl`(K009)과 `rp-flash`(K008)은 reduced에서 하이라이트 자체가 없어요 | web/css/09-notices.css:28-30, web/css/17-kakao.css:196-198, web/css/15-reply.css:8-9 |
| 전역과 중복인 개별 규칙 | R002, R003, R005, R006, R007, R009의 `transition: none`은 전역 규칙과 같은 결과예요(C025, C040, C047, C060, C071, C075) | web/css/05-log.css:184 외 |

### 6. M_MS, M_EASE와 CSS 토큰

`M_MS` = { fast: 150, base: 220, slow: 300 }(web/js/01-motion.js:5), CSS 토큰 = 150, 220, 300(web/css/01-tokens.css:65). 세 값이 모두 같아요. `M_EASE` 문자열도 토큰 값과 같아요 (`cubic-bezier(.2, .7, .2, 1)` 대 `cubic-bezier(.2, .7, .2, 1)`). 어긋남 없음.

### 7. 문서끼리, 문서와 코드

| 항목 | 문서 | 코드 | 근거 |
|---|---|---|---|
| 곡선 상수 이름 | DESIGN.md는 `EASE` | `M_EASE` | web/DESIGN.md:63, web/js/01-motion.js:4 |
| 화면 전환 길이 | ui-spec.md는 "200ms", MOTION.md는 220ms | `motionView`는 150ms (`M_MS.fast`) | docs/ui-spec.md:100, site/prototype/MOTION.md:13, web/js/01-motion.js:54 |
| 목록 순차 등장 간격 | MOTION.md는 35ms, 220ms | 12ms, 150ms | site/prototype/MOTION.md:14, web/js/01-motion.js:58 |
| 상태 점 깜박임 | MOTION.md는 `.dot.work`가 1.6초 무한 반복 (`@keyframes pulse`) | web/css에 `pulse` 키프레임 없음, `infinite` 0개 (`10-conversations.css:174` 주석에 "a running line does not pulse") | site/prototype/MOTION.md:30, web/css/10-conversations.css:174 |
| 모션 켜기/끄기 | MOTION.md는 툴바 스위치 | DESIGN.md:71은 설정 없음, 시스템 설정만 | site/prototype/MOTION.md:7, web/DESIGN.md:71 |

## 앱 밖 페이지

| 파일 | 줄 수 | transition | animation, keyframes, animate, rAF | prefers-reduced-motion | var(--) | 커스텀 프로퍼티 선언 | app.css 등 링크 |
|---|---|---|---|---|---|---|---|
| hub/pair-page.ts | 107 | 0 | 0 | 0 | 0 | 0 | 0 |
| hub/jandi-peers.ts | 195 | 0 | 0 | 0 | 0 | 0 | 0 |

고치기 전 결론: `/pair`(hub/pair-page.ts)와 `/jandi-peer`(hub/jandi-peers.ts)는 모션이 없고 디자인 토큰도 쓰지 않아요. 둘 다 `<style>` 안에 리터럴 값을 직접 적었어요(pair-page.ts:12-22, jandi-peers.ts:61-68: 글자 크기, `#2563eb`와 `#2f6fed` 같은 색, `border-radius:10px`). 정적인 상태 변화는 `button:disabled{opacity:.5}`(jandi-peers.ts:68)뿐이에요. jandi-peers.ts:86의 `setInterval(()=>{if(!document.hidden)load()},3000);`는 3초마다 목록을 다시 받는 폴링이고 화면을 움직이지 않아요.

원시 JSON에서 이 두 파일에 걸린 모션 행은 JS 호출 0행, 인라인 CSS 0행, 동작 줄이기 0행이에요.
