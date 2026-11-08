# Customization layer (`~/.dotz/custom`)

Every install wants something different on its web app: one owner wants a disk-space card on 홈, another wants their
side projects and a morning routine pinned in the sidebar. The custom layer lets the bot add these for its owner by
writing files in the data folder. The repo is never forked, and no gateway restart is needed.

## Why it looks like this: comparison with OmO

- OmO splits work by project folder. Its conversations live in `~/.omo/agent/sessions/<cwd-encoded>/`, one folder per
  working directory, and it keeps per-cwd state in `~/.omo/agent/projects/`.
- OmO's gateway pins a chat to a conversation through bindings: `~/.omo/agent/gateway/gateway.sqlite`, table `bindings`
  (`platform` discord, `chat_id`/`thread_id` -> `session_durable_id`). On Discord the owner sees one channel per
  project, fixed in the server sidebar (for example `#💬-tern` for the tern project).
- dotz mirrors the parts that fit. A project is a folder: sessions are grouped by their `cwd`, and the work channel a session
  lives in (`channels.json` `homes` / `work`) is pinned with it. The web sidebar plays the role of the Discord channel
  list, and manual pins add projects that have no session yet.
- dotz does not copy OmO's long-lived conversation per project. dotz keeps one orchestrator and one session per goal, so a
  project page lists that folder's sessions and messages the orchestrator, tagged with the project.

## Folder layout

```
~/.dotz/custom/
  cards/<id>.json              a card, spec only
  cards/<id>/card.json         a card as a folder ...
  cards/<id>/render.js         ... with an optional render script
  apps/<id>/app.json           a whole app of the owner's own (docs/custom-apps.md)
  recipes/<id>/recipe.md       a saved recipe, with its script if it has one (see Recipes)
  pins.json                    sidebar: projects, routines, links
```

The gateway reads the folder on every `GET /api/custom`. A change shows up on the next page refresh: this is a hot
reload. Only new dotz code needs a gateway restart. A missing folder is an empty layer, not an error.

Templates: `docs/custom-examples/cards/disk-free/card.json` and `docs/custom-examples/pins.json`.

An app with its own web UI is a manifest at `apps/<id>/app.json`: it appears in the web's 앱 tab and its page is served
at `/apps/<id>/`. Reference: `docs/custom-apps.md`.

## Cards

`id` is the file or folder name and must match `^[a-z0-9][a-z0-9-]{0,39}$`. The gateway reads at most 30 cards and
rejects files over 16 KB.

| Key | Type | Meaning |
|---|---|---|
| `title` | string, 1-40, required | card title |
| `note` | string, max 120 | meta line under the title |
| `view` | `text` (default), `stat`, `list`, `kv` | how `data` is drawn |
| `text` | string | static content when there is no `command` |
| `command` | string | data command, run with `/bin/sh -c` |
| `cwd` | path | working folder of the command, `~` expanded |
| `every_minutes` | number >= 1, default 10 | how long the command output is cached |
| `timeout_seconds` | 1-60, default 10 | kill deadline of the command |
| `link` | `https://...` or `#view` | where a tap on the card goes |
| `order` | number | lower first, then by id |
| `actions` | array, max 4 | buttons on the card (2 show, the rest are in the `⋯` menu), see below |

Unknown keys are ignored.

### Actions: the card's own logic

A card can carry up to 4 actions. The first 2 are buttons in the card footer and the others are in the card's `⋯` menu. Each one has a `label` (1-20 characters) and exactly one of these:

- `command`: runs like the data command (same `cwd` and timeout). The page toasts the first output line, and the card
  re-runs its data command and redraws.
- `prompt`: goes to the orchestrator as an owner web message, `[카드 <title>] <prompt>`, so the bot does the work.

`confirm: true` makes the page ask before running. A bad action makes the whole card invalid. The command text
stays in the card file: the page only sends the card id and the action index, so the web can trigger only what the
file declares.

So one card covers content (`text`, or the `command` output drawn by a view or by `render.js`) and logic (`actions`).

### Data command

The command runs the way `dotz_watch` runs its checks: through the same `exec` helper (`hub/watch.ts`), with a
timeout, its output cached in memory. Its stdout is trimmed. If the output parses as JSON, `data` is the parsed value.
Otherwise `data` is the text, up to 4000 characters. A request returns the cached value and refreshes it in the
background once it is older than `every_minutes`. Only the very first request waits for the run. A non-zero exit or a
timeout sets `error` to the output tail, keeps the last good `data` and marks it `stale` (the card shows `오래된 값`).
One card never runs twice at the same time.

### Views

- `text`: a string, or `{ "text": string }`.
- `stat`: `{ "value": string|number, "label"?: string, "sub"?: string }`, or a plain string or number (the value).
- `list`: an array of strings, or of `{ "title": string, "sub"?: string, "url"?: string }`. Every row is kept: the card shows 6 and scrolls.
- `kv`: an object (key -> value), or an array of `[key, value]` pairs. Every row is kept: the card shows 6 and scrolls.

A card with a `link` adds `더 보기 · N개` under the list. Put the most important rows first.

### render.js

`render.js` is optional, for a card the four views cannot draw. It is a browser ES module:
`export default function render(data, ctx)`, where `ctx = { el, card }` and `el` is the page's `el(tag, props, ...kids)`
DOM helper. It returns a DOM node or a string, which is shown as text. The page loads it from
`/api/custom/render?id=<id>&v=<rev>`, where `rev` is the file's mtime. If the script throws or fails to load, only
that card turns into an error card.

## Card design

Every card is drawn with the same classes as the built-in home cards, so it looks like them. A card file cannot carry
HTML or CSS: only the fields below change what the page draws.

| card.json | Element |
|---|---|
| `title` | header: 16px semibold, one line, then the `⋯` menu |
| `stale` (set by the gateway) | `오래된 값` tag in the header |
| `note` | one gray 12px line under the header |
| `view: stat` | one 20px bold value, then gray 12px `label` and `sub` |
| `view: kv` | one row per key: label 14px left, value 12px gray right, one line each, 8px apart. Plain text is read line by line as `name: value` |
| `view: list` | one row per item: `title` left, `sub` gray right, one line each. Plain text gives one item per line |
| `view: text` | 14px text, at most 4 lines |
| `actions` | small buttons in one footer row, never wrapped |
| `link` | the whole card is tappable (also `열기` in the menu) |
| `render.js` | your own node inside the body, see below |

Limits:

- At most 2 action buttons show in the footer: the first 2 actions. Actions 3 and 4 move into the `⋯` menu, in order.
  A label is cut with an ellipsis when it does not fit, so keep it short (about 8 characters or less).
- `kv` and `list` show 6 rows and scroll inside the card; on a card with a `link`, a `더 보기 · N개` line follows.
- Values are plain text on one line. Write dates as ISO 8601 (the page shows them in local time), write an empty value
  as an empty string or `-` (the page shows `없음`), and put units in the value (`12개`, `42%`).
- The card is as tall as its content, so do not add blank lines or filler rows.
- Titles: 1 to 40 characters, a noun phrase (`카톡`, not `카톡 상태를 보여주는 카드`). No emoji.

A `render.js` body must use the same classes and tokens: `.kv` with `.k` and `.v`, `.row` with `.nm` and `.sup`, `.big`,
`.sup`, `.tag` (`ok`, `warn`, `err`), and the CSS variables (`var(--fg)`, `var(--fg-2)`, `var(--fg-3)`). No inline
colors, font sizes or fixed heights, and no buttons: logic goes in `actions`.

## Sidebar pins: `pins.json`

```json
{
  "projects": [{ "name": "dotz 게이트웨이", "path": "~/Code/dotz", "channel": "<discord channel id>", "note": "...", "computer": "office-pc" }],
  "hide_projects": ["dir:~/Code/old"],
  "routines": [{ "id": "morning-check", "name": "아침 점검", "prompt": "...", "target": "main", "schedule": { "at": "09:00" } }],
  "links": [{ "name": "Cloudflare", "url": "https://dash.cloudflare.com" }]
}
```

- Project: `name` (max 40) is required, plus `path` and/or `channel`. `note` is optional: one plain sentence the owner reads at the top of the project page, saying what the project is for in everyday words (e.g. "로직에서 만든 곡을 문서로 정리해요"). No file paths, rule files or internal terms; those belong in the project's own instructions. `computer` is optional (1-40 characters): the computer the project lives on, by its name in the computer switcher. Without it the project belongs to this computer.
- Routine: `id` (the card id rule), `name` (max 40) and `prompt` (1-4000 characters) are required. `target` is `main`
  (the default) or `lane:<name>`. `schedule` is optional and takes either `{ "every_minutes": >= 5 }` or
  `{ "at": "HH:MM" }` (daily, in the owner's time zone), not both.
- Link: `name` (max 40) and an `http(s)` `url`.

### Projects (auto plus manual)

- Each session belongs to the project `dir:<cwd>` (home shown as `~`), named after the folder. Sessions in temp folders are
  skipped.
- The work channel a session lives in (`homes[lane]`) is that project's channel. A work channel no session points to becomes
  its own project, `ch:<id>`.
- A manual pin merges into the auto project with the same path or channel. Otherwise it creates a new project. The
  pin's name wins, and pinned projects come first, in file order. Auto projects follow, newest session first, at most 12.
- `hide_projects` hides auto projects by key. It never hides a manual pin.

### Projects by computer

- Every project has a `computer`: this gateway's machine name (`web.machine_name`, else the one made from the hostname,
  `hub/machine-name.ts`), unless its pin names another one.
- `GET /api/custom/computers` returns the groups, this computer first, then the others by name:
  `[{ name, self, url?, online?, keys, remote }]`. `keys` are the keys of this gateway's projects in that group (a pin that
  names another computer joins that computer's group). `remote` are the other computer's own projects, `[{ key, name, note? }]`.
- The other computers are the computer switcher's list (`GET /api/peers`) without relay and public rows. Each online one is
  read at `GET /api/peer/projects` with the peer token (`docs/peer-monitoring.md`); it answers `{ name, projects }` with its
  own projects only, by key, name and purpose, and no folder, channel or session detail. A computer that cannot be read (an
  older gateway, no token) shows its header without rows. The answers are kept for a minute.
- The 프로젝트 list draws one folding header per computer only when there are two or more groups. A single computer with no
  pin naming another looks as before (고정 / 전체). Under a computer's header its rows come pinned first; the filters and the
  search apply to all of them, and other computers' rows show only under 전체. A tap on another computer's project opens
  that computer's web app at `#project/<key>`.
- An offline computer keeps its header, greyed and marked 연결 안 됨, with no rows: the computer switcher lists it the same
  way, and its projects would be stale.

The project page (`#project/<key>`) reads `GET /api/custom/project?key=<key>`: a summary strip (running sessions, sessions
waiting on the owner, last activity), the sessions with their last report line (from `lanes/<name>/report.md`, which
outlives a gateway restart), finished time, verified or reported-only, resume and clean-up; the latest results (session
`[done]`/`[fail]` reports, the folder's verification receipts, the newest commits, newest first); for a git folder the
branch, uncommitted file count, last 5 commits and `lane/*` branches not merged into main; the open tasks of
`state.json` that name the project (in the gateway's own checkout, also those that name no other project), a tap sends
one as a request; and the work channel, threads, session channels, routines, schedules and watches tied to it. Two
columns from 1100px, one on a phone. The request box sends to the orchestrator (prefixed
`[프로젝트 <name> · <path>]`), to a running session of the project, or asks the orchestrator for a new session.

### Routines

One click on a routine sends `[루틴 <name>] <prompt>` as an owner web message, to the orchestrator or to the session in
`target`. A routine with `schedule` keeps exactly one `dotz_schedule` entry whose text starts with
`[routine:<id>:<hash6>] ` (`hash6` = sha1 of the routine's JSON). The gateway syncs these entries at start and whenever
`pins.json` changes: it removes stale ones (the id is gone, the routine changed, or its schedule was removed) and adds
missing ones. Schedules without the `[routine:` tag are never touched.

## Validation: a broken file never breaks the page

Everything is validated at the boundary, in `hub/custom.ts`:

- A card with bad JSON, a bad id, a missing title or a wrong value comes back as `{ id, file, error }`. 홈 draws it as
  an error card and keeps rendering the rest.
- A `pins.json` that does not parse adds `{ file: "pins.json", error }` to `errors`, and the pins are empty. Auto
  projects are still listed.
- A single bad entry in `pins.json` is dropped with its own `errors` entry. The other entries stay. A project whose
  `computer` is not 1-40 characters of text is such an entry.

## HTTP API

All routes sit behind the same auth as every other `/api` route.

- `GET /custom.js`: the web side (`web/custom.js`).
- `GET /api/custom` returns `{ dir, cards, projects, routines, links, errors }`.
- `GET /api/custom/computers` returns the computer groups of the project list (see Projects by computer).
- `GET /api/custom/render?id=<id>` returns the card's `render.js`.
- `POST /api/custom/refresh {id}` re-runs a card's command now.
- `POST /api/custom/action {id, index}` runs a card action. It returns `{ ok, code, output, card }` for a command, or
  `{ ok }` for a prompt.
- `POST /api/custom/routine {id}` runs a routine now.

구성 lists every card, routine and the pins file under the form `웹 맞춤`.

## Recipes

Work that went well can be kept so it is not worked out again. The nightly reflection looks at sessions of the last 7 days that
passed the gateway's check: the same task shape at least twice, else one costly session (a session file of 20 MB or more). A night
with no such candidate, or with a card still open, adds nothing to the turn. With one, the turn drafts the steps and posts one
card: 레시피 저장 or 레시피 건너뛰기.

The gateway settles the answer with no model turn. Until a save, the draft stays in `recipe-choices.json`. A save writes
`recipes/<id>/recipe.md` (frontmatter `name` and `when`, then the steps) and the script next to it. A skip is remembered: the same
shape is never proposed again, even from new work. A candidate passed over or a card left unanswered may return after 30 days.

Every session prompt lists saved recipes in one line each (id, name, when), at most 700 characters, and the steps are read from the
file only when the work matches. A recipe never runs by itself and no watch comes with it. Delete the folder to drop one.

## Surviving updates

Changes made in the dotz source of an install are lost or conflict when an update lands. Everything an install changes on purpose lives
in the data folder instead, which an update never touches.

### Text overrides: `~/.dotz/custom/texts.json`

The texts the bot receives (wake prompts such as the new-mail prompt, notice templates) come from the message catalog
(`hub/i18n-ko.ts`, `hub/i18n-en.ts`). Any top-level string or function key of it can be overridden per install, read at use time (no
restart; the file is re-read when it changes):

```json
{ "inboxMail": { "text": "[dotz inbox] new mail ... ({1})", "default": "3fa91c02" } }
```

- The key is the catalog key. A key whose shipped value is a function takes its arguments as `{1}`, `{2}` ... in order.
- `default` is the hash of the shipped text when the override was written. `bun hub/texts-cli.ts show <key>` prints the shipped text and
  its hash, `set <key> <text>|--file <path>` writes the override with the right hash, `list` shows each override and whether it still
  fits, `remove <key>` deletes it. A plain string value works too, without the check.
- The leads the gateway matches later (`youAre`, `replayLead`, ... in `enLeads`) cannot be overridden.
- If a key no longer exists, or its shipped text changed since the override was written, the override still applies and the gateway
  wakes the bot once at start with the list (`texts-reported.json` in the data folder remembers what was reported). The bot compares the
  new shipped text with its override and rewrites or removes it.

### Carry-over of local changes

If the updater had to back up local commits or uncommitted changes (branch `dotz-local/<YYYYMMDD-HHMM>`, or a patch and copy folder
`dotz-local-<stamp>-dirty` in `<data dir>/logs`), the gateway wakes the bot once after the restart with the backup name, the changed files
and a short stat, not the diff. Backups older than 30 days, empty ones and all but the newest 3 are skipped. The backup is marked handled when
the wake is made (`<data dir>/self-update/carryover-handled.json`), so it is not repeated. The bot then:

1. reads the diff;
2. ports each change to the custom layer where it fits: texts to `texts.json`, features to `~/.dotz/features`, rules to `RULES.md`;
3. for a change that only makes sense in core, writes a Korean report for the dotz maintainer in the worklog, de-identified and generalised
   but still detailed (`CONTRIBUTING.md`), and offers to open a GitHub issue on `ddotz/dotz`;
4. tells the owner in one message what was carried over and what was not.

## Rule for the bot

Anything this layer can express goes to `~/.dotz/custom`, and the bot checks it with `GET /api/custom` (`errors` is
empty, the card has `data`). Only a need the layer cannot express (a new view type, a new API, gateway behavior) goes
to the dotz source, as a session on the dotz repo (MODE.md, Customization).
