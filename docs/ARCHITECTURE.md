# Module map

Paths only; each file's header comment says what it does. Tests sit next to their module as `*.test.ts`.

## Entry points

- `hub/main.ts` gateway process (startup, timers, shutdown, restart gate)
- `hub/dotz-command.ts` the `dotz` terminal command (loopback entry, any web.access mode); `hub/web-login-cli.ts` is what it runs
- `setup.ts` + `onboard/` install wizard (`harness.ts`, `service.ts`, `tailscale.ts`, `aside.ts`, `discord.ts`, `permissions.ts`)
- `firstrun/` first-run web onboarding between hub and onboard: the marker (`first-run.ts`, `first-run-boot.ts`), the gate and its jobs (`setup-gate.ts`, `setup-jobs.ts`, `setup-state.ts`, `setup-term.ts`, `setup-apply.ts`) and the shared answers/apply/scan/exec code; it may import hub and onboard, and only `hub/main.ts`, `hub/routes.ts`, `hub/routes-settings.ts` and `setup.ts` import it
- `extension/index.ts` agent-side extension (`guard.ts`, `guard-config.ts`, `harness-tools.ts`, `output-cap.ts`, `owner-values.ts`, `task-cap.ts`, `compact-kept.ts`, `schema.ts`, `token-audit.ts`, `connect-view.ts` (the `dotz_connect` tool's plain-text view of a messenger connection))

## Gateway core

- config and process: `hub/config.ts`, `hub/opener.ts` (browser opener, WSL detection), `hub/lock.ts`, `hub/file-lock.ts` (the lock directory OmO's auth.json writers take), `hub/shutdown.ts`, `hub/restart.ts`, `hub/live-guard.ts`, `hub/public-scrub.ts` (what may leave an install for public GitHub: the agent post check and the release-note scrub), `hub/release-note.ts` (the note of a GitHub Release, from commit bodies), `hub/systemdeny.ts`
- HTTP: `hub/routes.ts` -> `hub/routes-apps.ts` (apps, integrations, reply drafts) -> `hub/routes-notices.ts` (notices) and further `hub/routes-settings.ts` -> `hub/routes-lanes.ts`, helpers `hub/routes-util.ts`, web assets `hub/webapp.ts`, `hub/compress.ts`, files `hub/files.ts`, `hub/upload-stream.ts`
- message flow: inbound `hub/intake.ts`, outbound `hub/outbound.ts`, send ledger `hub/sendlog.ts`, prompt queue `hub/prompts.ts` (its types and limits `hub/prompts-model.ts`), web queue `hub/queue.ts`, background workers `hub/bgwork.ts`, event bus `hub/events.ts`
- request tracking: a worker is linked to its owner message at spawn (`hub/prompts.ts` WorkLink, `*-links.json` beside `pending.json`, survives a restart); each spawned worker gets its own line, its result answers exactly that message, a short todo-closing last message never replaces its report (`hub/bgwork.ts` reportOf), and `hub/waitcheck.ts` wakes the session once, bounded and with no model call before that, when a request stays open for 2 minutes with nothing running
- orchestrator: `hub/orchestrator.ts` (start prompt, handover and status record `hub/orchestrator-parts.ts`), `hub/context.ts`, `hub/fallback.ts`, `hub/rate-alert.ts`, `hub/outlang.ts`, `hub/tone.ts`
- text: `hub/i18n.ts` (+ catalogs `hub/i18n-en.ts`, `hub/i18n-ko.ts`), `hub/language.ts`, `hub/prompt-budget.ts`
- message shapes: `hub/message-spec.ts` (the fixed component catalog and its validator), `hub/message-spec-derive.ts` (text to spec: the one reader of an answer's shapes, and the dotz-spec fence), `hub/gen-message-spec-web.ts` (writes `web/js/01-message-spec.js`, the page's copy of both; `web/js/02-answer-shapes.js` draws the spec)

## Lanes (sessions)

- public facade `hub/lanes.ts` (re-exports; owns the stall/progress timers)
- state `hub/lanestate.ts`, lifecycle ops `hub/laneops.ts`, process run/recover `hub/lanerun.ts`, event reading `hub/laneevents.ts`, failover `hub/lanefailover.ts`, resume after a reconnect `hub/lanereconnect.ts`, the unfinished-work signal `hub/laneunfinished.ts` and the sweep that resumes on it `hub/laneresume.ts` (the orchestrator and conversation sessions on the same signal and bounds: `hub/sessionresume.ts`), reports `hub/lanereport.ts`, prompts `hub/laneprompt.ts`, worktrees `hub/lanetree.ts`, launch gates `hub/lanegates.ts`, views `hub/laneviews.ts`, launch limits `hub/lanelimits.ts` (machine limits `hub/limits.ts`)
- around lanes: `hub/lanewire.ts` (report handlers), `hub/lanerelay.ts`, `hub/lanevis.ts`, `hub/lanetrash.ts`, `hub/laneidle.ts`, `hub/asks.ts`, `hub/hygiene.ts`, `hub/cleanup.ts`, `hub/memguard.ts`, `hub/receipts.ts`

## Channels and notices

- send approvals: `hub/attach-check.ts` (does a mail draft's text match its files: the send gate and the card's 첨부 확인 line), `hub/auto-attach.ts` (one install's own rules for the files of automatic mail drafts), `hub/approval-queue.ts` (one card at a time per conversation), `hub/approval-send.ts` (the gateway sends an approved draft itself, in order per place), `hub/approval-batch.ts` + `hub/approval-wire.ts` (batch / triage answers, `/api/approvals`, grouped by app instance)
- Discord: `hub/discord.ts`, `hub/discord-format.ts`, `hub/threads.ts`, `hub/workchannels.ts`, `hub/livestatus.ts`, `hub/askbuttons.ts`, `hub/choices.ts`, `hub/owner-text.ts` (the one rule of what reaches the owner's screen; `hub/owner-text.fixture.ts` holds its cases)
- spec renderers: `hub/spec-inline.ts` (the inline marks of a spec string as tokens; only http(s) is a link), one renderer per surface from a MessageSpec (`hub/message-spec.ts`, read off a text by `specOf` in `hub/message-spec-of.ts`): `hub/spec-discord.ts` (content lines), `hub/spec-slack.ts` (Block Kit blocks beside `text`), `hub/spec-telegram.ts` (HTML parts, plain form kept for the 400 resend), `hub/spec-jandi.ts` (plain lines), `hub/spec-terminal.ts` (ANSI); a component without an entry uses `elementPlain`, and no spec means today's text. `dotz last` (`hub/dotz-last-cli.ts`, `hub/dotz-last.ts`) prints the newest main answer through the terminal renderer, read-only
- web state: `hub/notices.ts` (facade; the importers keep it, the code sits in `hub/notices-store.ts` (list, upsert, event feed, settle, replay), `hub/notices-types.ts`, `hub/notices-wiring.ts` (resolvers and hooks main.ts plugs in), `hub/notices-rules.ts`, `hub/notices-lanes.ts`, `hub/notices-read.ts`, `hub/notices-viewing.ts`, `hub/notices-decisions.ts`, `hub/notices-stored.ts` (runs once on load), `hub/notices-drafts.ts`, `hub/notices-answers.ts`, `hub/notices-signals.ts`, `hub/notices-bell.ts`), `hub/conversations.ts`, `hub/reads.ts`, `hub/projectchat.ts`, `hub/projects.ts`, `hub/todo.ts`, `hub/activity.ts`, `hub/custom.ts`
- notice classes: `hub/notice-class.ts` (`noticeClass`: 답변 필요 / 경고 / 결과 / 새 소식 / 대화 / 기록, with push, badge and pin), read by the bell tabs (`web/js/31-conversations.js`), web push and Discord's ping
- Discord connection: `hub/discord-connection.ts` (`/api/discord/connection` GET/PUT/DELETE and `/check`: bot token file, server and owner id, `restart_needed` until the gateway restarts; the token is never returned)
- Discord routing: `hub/discord-post.ts` (`<DATA_DIR>/discord-post.json`; kind and per-notice-class switches, `postClass` names a post's class, `/api/discord/post`; the web app always gets everything, 설정 → 앱 · 알림 adds "디스코드로도 보내기" per class)
- push: `hub/push.ts` (per-class switches in config `notify.push`, `/api/push/classes`; news also per app, `custom/apps.json <app>.push`), `hub/webpush.ts`
- per-install custom code (not part of the product): `hub/custom.ts` (cards, pins, routines), `hub/custom-computers.ts` (the 프로젝트 list's computer groups), `hub/peer-projects.ts` (the other computers' project lists over the peer token), `hub/custom-text.ts` (rule titles and report heads of the project pages), `hub/plugins.ts` (plugin hooks, see `docs/custom-plugins.md`; loaded from `<DATA_DIR>/custom/plugins/`)
- mail: `hub/mail-lines.ts` (a mail's 할 일 / 직접 답할 것 lines as fields of their own, and the brief a reply draft's card keeps)
- mail: `hub/mail-unanswered.ts` (답 없는 메일 다시 묻기: a sent mail with no answer after the days set on its mail app gets one follow-up draft; script check, no model call until due)
- mail: `hub/mail-move.ts` (moves a stored mail to another mail app, `/api/mail/move`)
- mailboxes (메일함): `hub/mailbox.ts` (`custom/mailboxes.json`, the placing rules `pickBox`, pins; contract `docs/mailbox.md`), `hub/routes-mailbox.ts` (`placeMail`, the card's box lookup, `/api/mailbox/move|learn|box|tone|suggest`; the web screens 메일함 설정 and 메일함 추가 are `web/js/30-mailboxes-set.js`), `hub/mailbox-cli.ts` (`fold`: per-source mail instances into mailboxes, as data)
- mail: `hub/mail-delete.ts` (삭제하면 원본도 삭제: the source adapters behind the owner's delete, `/api/mail/delete-original`)
- comment store: `hub/comments/absorb.ts` (what the comment engine stores from an adapter read: new comments, position-keyed Instagram replies renamed to their real ids, old twin rows merged; no engine state)
- messenger login: `hub/messenger-login.ts` (the browser login capture the messenger onboarding flows share: it reads one page value in the owner's background Aside tab, and the value reaches the flow in memory through a one-shot localhost inbox, never stdout, argv or logs), `hub/jandi-session.ts` (reads the owner's JANDI session: token exchange, team, member, bot and the 나와의 대화 room)
- Relay chat (a computer reached only through a messenger, the adapter's `relay`): `hub/relay-route.ts`, web `web/js/42-relay-chat.js`
- KakaoTalk rooms on the web: `hub/kakao/web.ts` (routes and caches), `hub/kakao/web-shape.ts` (unreplied scan, draft card, chat payload and watch lists built from their arguments)

## Accounts, providers, runtimes

- accounts: `hub/account-sticky.ts`, `hub/account-rules.ts`, `hub/account-alias.ts`, `hub/accounts-api.ts`, `hub/usage-account.ts`
- keys and providers: `hub/providers.ts`, `hub/apikey-store.ts`, `hub/apikey-policy.ts`, `hub/auth.ts`, `hub/auth-wait.ts` (the gateway's own replies while a session waits on dotz_auth, "취소" closes it), `hub/control.ts`
- runtimes: `hub/runtime/index.ts`, `hub/runtime/types.ts`, adapters `hub/runtime/omo.ts`, `hub/runtime/omp.ts`, `hub/runtime/claude.ts`, support `hub/runtime/detect.ts`, `hub/runtime/verify.ts`, `hub/runtime/omo-hosts.ts`, `hub/runtime/senpi-bin.ts`, `hub/runtime/claude-deny-hook.ts`, probes and test fixtures `hub/runtime/*-probes.ts`, `hub/runtime/scenario.ts`

## Background jobs

- code health gate: `hub/engineering-rules.ts` (detectors), `hub/engineering-rules.test.ts` (ceilings, `docs/engineering-standards.md`), `hub/git-hooks.ts` (points a clone at `.githooks`, whose pre-push runs that test), `hub/push-identity.ts` (the same hook: no personal address in commit identities pushed to the public repo)
- `hub/watch.ts`, `hub/monitors.ts`, `hub/schedule.ts`, `hub/reflect.ts`, `hub/recipes.ts` (work that went well, kept as a recipe only on the owner's save: one candidate a night from verified sessions, added to the existing reflection turn), `hub/token-audit.ts`, `hub/failure-report.ts` (the on-demand, watch-run counterpart: failed attempts and repeated work with a `--check` baseline), `hub/session-sources.ts`, `hub/recall-extract.ts` (context search: owner/answer pairs out of the session files, three eras, machine noise dropped), `hub/recall-index.ts` (the local SQLite + FTS5 index under `<data dir>/recall`, incremental by byte offset, vector slots), `hub/recall-search.ts` (keyword and vector rank fusion, `open` re-reads the raw text), `hub/recall-cli.ts` (`refresh`, `index`, `search`, `open`, `status`, `dump`; search is hybrid when vectors and the embedder exist), `hub/recall-embed.ts` (meaning vectors: fetches the ONNX runtime and the model into `<data dir>/recall` on first `refresh`, embeds the pending docs within a time budget, falls back to keyword search), `hub/recall-rerank.ts` (a small multilingual cross-encoder, fetched the same way, reorders the top 30 fused candidates; missing or failing leaves the fused order), `hub/recall-idle.ts` (every 5 minutes the gateway spawns `recall-cli.ts refresh` at low priority; it loads no model itself), `extension/recall-tool.ts` (`dotz_recall`, a deferred tool in the orchestrator, lane and worker sessions that runs the CLI), `hub/summaries.ts`, `hub/update.ts`, `hub/history-rewrite.ts` (the marker of a rewritten public history and the push guard), `hub/selfupdate.ts`, `hub/selfupdate-parse.ts` (its stateless readers: release version order, the update gate command, a failing test run's digest), `hub/update-now.ts` (the top update bar's one tap: download and test, restart when work ends, turns after the tap held on disk and delivered after the restart), `hub/backup.ts`, `hub/zele.ts`, `hub/aside.ts`
- harness views: `hub/harness.ts`, `hub/harnessprojects.ts`, `hub/features.ts`, `hub/featuredirs.ts`

## Web app

- `web/index.html`, `web/sw.js`, `web/custom.js`, `web/manifest.webmanifest`
- `web/js/NN-*.js` and `web/css/*.css`: classic scripts concatenated in filename order into one app.js by `hub/webapp.ts` (shared globals; `01-core.js` holds the common helpers)
