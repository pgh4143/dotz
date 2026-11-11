/* ---------- 모니터링: a tab built like 채팅 - a list of what is watched, and a conversation per item ---------- */
// The list is the chat list's panel and row (31-conversations.js convRow); an item opens as a conversation: its notices and results as messages,
// an open decision answered in place with the same choice rows a chat message has (10-decision-card.js answerInline). Items: 알림, every
// integration enabled on this install (30-integrations.js: 메일, 카카오톡 ...) and every dotz_watch monitor or schedule.
// Only what a watch, a schedule or an integration produced is shown here (monMine). The 알림 channel's posts and the decisions asked there
// stay in 채팅's 알림 conversation and never show here; watch reports are not in that conversation (hub/events.ts eventTarget).
// Data: GET /api/monitors (hub/monitors.ts) -> {items: [{name, watch?, kind, channel?, last_run?, last_result?, next_run?, every?, connection?, since?, conn_reason?, paused?, last_summary?}]}, the notices (30-notices.js NT)
// and the integrations. It repaints when a notice arrives and once a minute while it is open.
const NM = { items: [], loaded: false, failed: false, at: 0 };
// Opening the monitoring screen reads the list again only when the last read is older than the 60 s refresh below (watch notices refresh it sooner).
const NM_FRESH_MS = 60000;
const monitorsFresh = () => NM.loaded && Date.now() - NM.at < NM_FRESH_MS;
// The list's groups after 감시 소식: app-type integrations (hub/integrations.ts kind "app"), then the plain monitors.
const MON_GROUP = { app: "앱", plain: "일반 모니터링" };
// sel: the open item's key ("notice", "i:<integration>", "m:<monitor name>"); list: the list is on screen instead of the item, on every width. An app's item has the whole column; a monitor opens beside the list of monitors (monListRows).
// filter: 전체 / 답 필요 / 실패 of the open item; open: the rows unfolded ("g:<source>", "n:<notice id>"); more: pages shown per list; grew: older reports were just added above.
const MON = { sel: "", list: true, shown: "", sig: "", side: "", seenT: 0, mailFilter: "all", mailIn: "all", filter: "all", open: new Set(), more: new Map(), grew: false, running: new Set(), autoArmed: false, olderBusy: false, want: "", hl: "", hlUntil: 0 };   // want: the notice a jump is reaching (monOpen in 30-notices.js); hl: the row it lit, lit again if a redraw replaces it
const monConv = () => current === "monitoring" && !MON.list;
const monHash = () => (!MON.list && MON.sel ? `monitoring/${enc(MON.sel)}${mxHash(MON.sel)}` : "monitoring");
// A mail is a conversation of 모니터링 (go() in 05-command-palette.js draws it with the chat view while the tab stays 모니터링); monItemOf: the list item it sits under.
const monOwned = t => isMailT(String(t || "")) || isSettingsT(String(t || ""));
const monItemOf = t => {
  if (!monOwned(t)) return "";
  if (isSettingsT(t)) {
    if (PQ.of.has(t)) return PQ.of.get(t).key;   // a peer monitor's conversation sits under its row
    const a = settingsApp(t), m = a.startsWith("w:") ? NM.items.find(x => x.watch === a.slice(2)) : null;
    return m ? `m:${m.name}` : `i:${a}`;
  }
  if (PQ.of.has(t)) return PQ.of.get(t).key;   // a peer's mail sits under that computer's item
  const it = INTG.items.find(x => intgHas(x, t));
  return it ? mxKeyOf(it.key) : "i:mail";
};
// go("monitoring", key) opens that item; without one the list shows.
function monRoute(tgt) {
  pqOpen();
  MON.miss = false; tgt = mxRoute(tgt);
  if (tgt && tgt !== "list") {
    if (tgt !== MON.sel) { MON.filter = "all"; MON.open.clear(); MON.more.clear(); }   // another item: its list starts whole and folded
    MON.autoArmed = false; MON.olderBusy = false;
    MON.sel = tgt; MON.list = false;
  } else MON.list = true;
}

async function loadMonitors() {
  try {
    const r = await api("/api/monitors");
    NM.items = Array.isArray(r.items) ? r.items : [];
    NM.loaded = true; NM.failed = false; NM.at = Date.now();
  } catch { NM.failed = !NM.loaded; }
  monSchedule();
  homeSoon();
}
// Failed ones first, then the soonest next run.
const ntMons = () => NM.items.slice().sort((a, b) => (b.last_result === "fail") - (a.last_result === "fail") || (Date.parse(a.next_run) || Infinity) - (Date.parse(b.next_run) || Infinity));
const monTime = t => kstDay(t) === kstDay(Date.now()) ? kstHM(t) : `${dayLabel(t)} ${kstHM(t)}`;
const ntMonRun = m => m.last_run ? `마지막 ${monTime(m.last_run)}` : "아직 실행 전이에요";
const ntMonNext = m => m.next_run ? `다음 ${monTime(m.next_run)}` : "";

/* ---- a monitor's own timeline: how far the wait between two runs has come ---- */
// '방금 전' / '3분 전' / '2시간 전' and '곧' / '12분 후'. The bar's two ends are the last run and the next one; the fill is the share of that
// wait already gone. One ticker (monTickStart at the bottom) moves every bar of the page, so a row never owns a timer of its own.
const monRel = (ms, past) => {
  const a = Math.max(0, ms), min = Math.floor(a / 60000);
  if (min < 1) return past ? "방금 전" : "곧";
  const t = min < 60 ? `${min}분` : min < 1440 ? `${Math.floor(min / 60)}시간` : `${Math.floor(min / 1440)}일`;
  return past ? `${t} 전` : `${t} 후`;
};
const MON_PTAG = { ok: ["정상", "ok"], changed: ["바뀜", "warn"], fail: ["실패", "err"], disconnected: ["연결 끊김", "err"], need: ["확인 필요", "warn"], off: ["꺼짐", "off"], late: ["늦어짐", "warn"], run: ["확인 중", "pri"] };
// A monitor's one status, read the same on every screen (the list row's badge, the detail's state line and tag, the home card, the app settings):
// connection > paused > fail > late > changed > ok > not run yet. key is a MON_PTAG key; text and tone are its words and colour.
function monStatus(m, now = Date.now()) {
  const key = m.connection === "disconnected" ? "disconnected" : m.paused ? "off" : m.last_result === "fail" ? "fail" : (Date.parse(m.next_run) || Infinity) <= now ? "late" : m.last_result === "changed" ? "changed" : m.last_run ? "ok" : "need";
  const [text, tone] = MON_PTAG[key];
  return { key, text, tone };
}
// Wording (one pair): a row, a tag or a badge says "연결 끊김"; the banner at the top of the conversation says "연결이 끊겼어요" plus why.
const monConnWhy = m => [m.since ? `${monTime(m.since)}부터` : "", m.conn_reason === "login" ? "다시 로그인 필요" : m.conn_reason ? "확인이 계속 실패해요" : ""].filter(Boolean).join(" · ");
const monConnLine = m => ["연결 끊김", monConnWhy(m)].filter(Boolean).join(" · ");
// The list row's status line has room for the start of the outage only; the banner and the overview add why.
const monConnShort = m => ["연결 끊김", m.since ? `${kstHM(m.since).replace(/^오[전후]\s*/, "")}부터` : ""].filter(Boolean).join(" · ");
// Empty for a paused or disconnected monitor: its one tag (꺼짐 / 연결 끊김) and, when down, the banner's single line already say it.
const monProgLine = (from, to, now, m, short) => {
  if (m && (m.paused || m.connection === "disconnected")) return "";
  if (m && m.watch && MON.running.has(m.watch)) return short ? "확인 중" : "지금 확인하고 있어요";
  if (short) return [from > 0 ? monRel(now - from, true) : "실행 전", to > 0 ? now >= to ? "늦어짐" : monRel(to - now, false) : "예정 없음"].join(" · ");
  return [from > 0 ? `지난 실행 ${monRel(now - from, true)}` : "아직 실행 전", to > 0 ? now >= to ? "다음 확인이 늦어졌어요" : `다음 ${monRel(to - now, false)}` : "예정 없음"].join(" · ");
};
// kind drives the fill: "" (accent, moving), warn (overdue, full), err (disconnected), off (paused, grey), run (indeterminate shimmer).
function monProgState(m, now) {
  if (m.watch && MON.running.has(m.watch)) return { kind: "run", pct: 0, tag: "run" };
  const tag = monStatus(m, now).key;
  if (tag === "disconnected") return { kind: "err", pct: 100, tag };
  if (tag === "off") return { kind: "off", pct: 100, tag };
  const from = Date.parse(m.last_run), to = Date.parse(m.next_run);
  if (!(to > 0)) return { kind: "none", pct: 0, tag };
  if (now >= to) return { kind: "warn", pct: 100, tag };
  const pct = from > 0 ? Math.max(0, Math.min(100, ((now - from) / (to - from)) * 100)) : 0;
  return { kind: "", pct, tag };
}
const monPTagOf = k => MON_PTAG[k] || ["", ""];
// The bar's colour is the result (owner 2026-10-27): green normal, yellow needs a look (changed, late, not run yet), red error or disconnected.
const MON_BAR_TONE = { ok: "ok", changed: "warn", late: "warn", need: "warn", fail: "err", disconnected: "err" };
// One progress block: a thin bar with its result tag on the same line and the two times in words under it. The bar carries data-from/data-to
// so the ticker can move it, and the tag is re-read on the way past next_run (늦어짐) without a repaint.
function monProgNode(m, opts = {}) {
  const now = Date.now(), st = monProgState(m, now), from = Date.parse(m.last_run), to = Date.parse(m.next_run), live = st.kind === "" || st.kind === "warn", line = monProgLine(from, to, now, m, opts.short);
  const [text, tone] = monPTagOf(st.tag);
  const width = st.kind === "run" ? 35 : st.pct;
  const barTone = st.kind === "" || st.kind === "none" ? MON_BAR_TONE[st.tag] || "" : st.kind === "warn" && st.tag === "fail" ? "err" : "";
  const bar = el("span", { class: `mon-prog${st.kind ? ` ${st.kind}` : ""}${barTone ? ` ${barTone}` : ""}`, "data-tone": barTone || null, role: "progressbar", "aria-label": `${monTitle(m)} 진행`, "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(st.pct)), "aria-valuetext": line }, el("i", { style: `width:${width}%` }));
  if (live && from > 0 && to > 0) { bar.dataset.from = String(from); bar.dataset.to = String(to); bar.dataset.short = opts.short ? "1" : ""; }
  // data-tag keeps the result the node was built with: the ticker only flips a live tag between it and 늦어짐, never to another result.
  const tag = text && opts.tag !== false ? el("span", { class: `mon-ptag${tone ? ` ${tone}` : ""}`, "data-tag": st.tag, "data-fixed": st.tag === "fail" || st.tag === "disconnected" || st.tag === "off" || st.tag === "run" ? "1" : null, text }) : null;
  const tx = line ? el("span", { class: "mon-prog-tx", text: line }) : null;
  return el("div", { class: `mon-prog-wrap${opts.compact ? " compact" : ""}` }, el("div", { class: "mon-prog-top" }, bar, tag), tx);
}

// A monitor's readable title: its label, else the [a-z0-9-] name in words ("node-security-updates" -> "node security updates"); the raw name
// is only the small text in the header. A watch's notices carry the label (hub notice) or the raw name (a gateway "[name] ..." post).
const monWords = s => /^[A-Za-z0-9][\w.-]*$/.test(s) && /[-_]/.test(s) ? s.replace(/[-_]+/g, " ") : s;
const monRaw = m => String(m.watch || m.name || "");
// A raw command never reaches the screen (owner 2026-11-04): a schedule's text is what it runs ("피드백 데일리 보고: ssh -o BatchMode=yes ... python3 - 24 < ~/.dotz/...").
// monHuman keeps the plain sentences before the first one that holds a command or a file path (a schedule's text can be the whole prompt it runs), stops at the
// colon before a command, and drops a bracket that holds one; a text that is only a command gives "" and the caller names the kind in words.
const MON_CMD = /\b[\w.-]+\.(?:md|jsonl?|ya?ml|toml|log|py|sh)\b|\b(?:ssh|scp|rsync|curl|wget|python3?|node|bun|npm|npx|bash|zsh|git|sudo|docker|osascript)\s+(?:-|[\w.-]*@|~|\.{0,2}\/|[\w.-]+\.(?:py|sh|js|ts|mjs)\b)|(?:^|\s)-{1,2}[A-Za-z][\w-]*(?:=|\s|$)|\s[<>|]{1,2}\s|\$\(|~\/|(?:^|\s)\.{0,2}\/[\w.-]+\/|@\d{1,3}(?:\.\d{1,3}){3}/;
const monSentences = s => s.split(/(?<=[.!?。])\s+/);
function monHuman(raw) {
  const s = String(raw ?? "").replace(/\s+/g, " ").replace(/\s*[(（][^()（）]*(?:[)）]|$)/g, m => MON_CMD.test(m) || /^\s*[(（]state\s/.test(m) ? "" : m).trim();
  if (!MON_CMD.test(s)) return s;
  const i = s.search(/[:：]\s/), keep = [];
  for (const t of monSentences(i > 0 ? s.slice(0, i) : s)) { if (MON_CMD.test(t)) break; keep.push(t); }
  return keep.join(" ").replace(/[.。]$/, "").trim();
}
const monClean = (s, fb = "") => monHuman(ntPlain(s)) || fb;
const MON_GENTLE = { watch: "지켜보는 일", schedule: "예약한 일" };
// A title stays one short phrase: a long prompt in plain words gives its first sentence.
const MON_TITLE_MAX = 40;
const monTitle = m => { const t = monWords(monHuman(ntPlain(m.name))); return (t.length > MON_TITLE_MAX ? monSentences(t)[0] : t) || MON_GENTLE[m.kind] || "모니터링"; };
// One or two plain sentences under the name, from what the monitor really is (its cadence), never from the command it runs.
const monDesc = m => m.kind === "schedule" ? (m.every ? `${m.every} 알아서 실행해요.` : "정해 둔 때에 한 번 실행해요.") : `바뀐 곳이 있는지 ${m.every ? `${m.every} ` : "알아서 "}확인해요.`;
const monNames = m => [...new Set([monTitle(m), String(m.name || ""), monRaw(m), monWords(monRaw(m))].filter(Boolean))];
const monHas = (m, n) => n.kind === "watch" && monNames(m).includes(String(n.title || ""));
// 모니터링's own notices: a watch's or a schedule's report (kind "watch"), or a notice living in an integration's own conversation (a mail).
const monMine = (n, it) => n.kind === "watch" || (!!it && intgHas(it, n.src || n.open || ""));
// Where a notice tap lands in 모니터링 (30-notices.js monOpen): the item that lists it, else its monitor, else 감시 소식.
function monKeyOf(n) {
  const it = monItems().find(i => i.notices.some(x => x.id === n.id));
  if (it) return it.key;
  const m = NM.items.find(x => monHas(x, n));
  return m ? `m:${m.name}` : "notice";
}
// The drawn row of a notice: its own, or the folded run or group that stands for it.
const monRowOf = id => [...$("#mon-tl").querySelectorAll("[data-nid], [data-nids]")].find(r => r.dataset.nid === id || String(r.dataset.nids || "").split(",").includes(id)) || null;
// The words of a report without the monitor's name in front ("node security updates: 결과가 바뀌었어요" -> "결과가 바뀌었어요").
function monStrip(s, names) {
  for (const x of names) if (s.startsWith(x)) { const r = s.slice(x.length).replace(/^\s*[:：]\s*/, ""); if (r !== s.slice(x.length)) return r; }
  // A first line that is only the title (bold or not) says it a second time under the title: the row's line and the opened card start after it.
  const nl = s.indexOf("\n"), first = nl < 0 ? "" : s.slice(0, nl).replace(/^[\s#*_]+|[\s*_]+$/g, "");
  return first && names.includes(first) ? s.slice(nl + 1).replace(/^\s*\n/, "") : s;
}
// 마지막 정상 only says something after a failure, when it is not the last run: a monitor that is fine already reads 정상 with its last run's time.
const monLastOk = m => (m.fails || m.last_result === "fail") && m.last_ok && m.last_ok !== m.last_run ? `마지막 정상 ${monTime(m.last_ok)}` : "";
const MON_RUN = { ok: "마지막 확인 결과 정상이에요", changed: "마지막 확인에서 바뀐 점이 있어요", fail: "마지막 확인이 실패했어요" };
const monRunLine = m => !m.last_run ? "아직 확인 전이에요" : m.kind === "schedule" ? "예약한 일을 실행했어요" : MON_RUN[m.last_result] || "확인했어요";
const monNewest = list => list.slice().sort((a, b) => ntAt(b) - ntAt(a))[0] || null;
const monNoticeAt = n => new Date(ntAt(n)).toISOString();
const monLine = n => convPreview(n.text) || ntPlain(n.title);
const monIcon = ic => el("span", { class: "cv-av nt", "aria-hidden": "true" }, icon(ic));
const monUnread = list => list.reduce((c, n) => c + (n.read ? 0 : 1), 0);

// What is watched, in list order: 감시 소식 (reports no row below owns), then the 앱 group (the integrations), then the 일반 모니터링 group (the monitors). Each item carries what
// its row and its conversation show.
const MON_FEED = "감시 소식";
// An app's row says what waits on the owner, never the latest item's title. `needs` = {drafts, unread, sentToday, unreplied} from GET /api/integrations (hub/integrations.ts):
// the line says what was sent today; the counts that wait on him (drafts, 미답장, 안 읽음) are the row's own, at its right (31-conversations.js), so the line never says them again (owner 2026-11-10).
// The badge is the count that waits on him (drafts first, else unread). A row with such a count says when the last item came (`when`, ntTime of the newest), else nothing.
// "확인할 것 없어요" only for a connected app with every count 0; `down` (the app is disconnected) says 연결 끊김 instead.
function monNeedLine(n, down, when) {
  const parts = [];
  if (n.sentToday) parts.push(`오늘 자동 답장 ${n.sentToday}건 보냄`);
  return parts.join(" · ") || (n.drafts || n.unreplied || n.unread ? (when ? `마지막 소식 ${when}` : "") : down ? "연결 끊김" : "확인할 것 없어요");
}
// A watch an app owns (it.watches / it.watchesNot of GET /api/integrations, hub/integrations.ts) belongs to that app: no row of its own in 일반 모니터링,
// its status is in the app's panel and a failing one marks the app's row.
const monNamed = (list, w) => (list || []).some(x => x.endsWith("-") ? w.startsWith(x) : w === x);
// `own` = the watch names the hub resolved for the app (names, instance filters and the site a login keeper keeps, hub/app-features.ts); the name rules answer for an older hub.
const monOwner = (apps, m) => m.kind === "watch" && m.watch ? apps.find(a => Array.isArray(a.own) ? a.own.includes(m.watch) : monNamed(a.watches, m.watch) && !monNamed(a.watchesNot, m.watch)) || (m.scope === "app" ? apps.find(a => a.key === m.app) : undefined) : undefined;
// The rest of the monitors by the hub's `scope` (hub/watch-scope.ts): a project's own go in a 프로젝트 · <이름> group between 앱 and 일반 모니터링, the gateway's own
// housekeeping stays out of sight while it is fine (a failing or disconnected one is listed in 일반 모니터링). A hub that sends no `scope` lists every monitor as plain.
const monProject = m => m.scope === "project" && m.project;
const monGroupOf = m => (monProject(m) ? `프로젝트 · ${m.project_title || "프로젝트"}` : MON_GROUP.plain);
const monHidden = m => m.scope === "internal" && m.last_result !== "fail" && m.connection !== "disconnected";
// Project items first (grouped by project, first seen first), then the plain ones.
const monGrouped = (proj, plain) => { const order = [...new Set(proj.map(i => i.group))]; return [...order.flatMap(g => proj.filter(i => i.group === g)), ...plain]; };
const monOwnedBy = (apps, mons) => { const by = new Map(); for (const m of mons) { const o = monOwner(apps, m); if (o) by.set(o.key, [...(by.get(o.key) || []), m]); } return by; };
const monFail = owned => owned.some(m => m.last_result === "fail") ? ["실패", "err"] : null;
function monItems() {
  intgWatch();
  const mons = ntMons(), shown = new Set(), items = [], proj = [], plain = [], owned = monOwnedBy(INTG.items, mons);
  for (const it of INTG.items) {
    const notices = (it.notices || []).map(ntById).filter(n => n && monMine(n, it)), mails = [...CONV.keys()].filter(t => !PQ.of.has(t) && intgHas(it, t) && (!isMailT(t) || MAILS.has(t)));   // a mail conversation without its mail (deleted) is no mail row
    for (const n of notices) shown.add(n.id);
    const cands = [...notices.map(n => ({ at: monNoticeAt(n), text: monLine(n) })), ...mails.filter(t => CONV.get(t)).map(t => ({ at: CONV.get(t).ts, text: (MAILS.get(t) || {}).subject || CONV.get(t).text }))].sort((a, b) => b.at.localeCompare(a.at));
    const needs = it.needs || { drafts: 0, unread: monUnread(notices.filter(n => !mails.includes(n.open) && !mails.includes(n.src))) + mails.filter(t => (ts(t).unread | 0) > 0).length, sentToday: 0 }, conn = it.state === "disconnected", own = owned.get(it.key) || [], bad = own.some(m => m.last_result === "fail");
    items.push({ key: `i:${it.key}`, group: MON_GROUP[it.kind || "app"] || MON_GROUP.app, name: it.label, ic: it.icon, notices, mails, app: true, conn, inst: it.key, drafts: needs.drafts | 0, unread: needs.drafts || needs.unread, unreplied: needs.unreplied | 0, hint: conn && it.hint ? it.hint : bad ? "확인이 실패했어요" : monNeedLine(needs, conn, cands[0] ? ntTime(cands[0].at) : ""), at: cands[0] ? cands[0].at : "", owned: own, msig: conn ? "conn" : bad ? "fail" : "",
      badge: conn ? ["연결 끊김", "err"] : monFail(owned.get(it.key) || []) });
  }
  const ownedNames = new Set([...owned.values()].flat());
  for (const m of mons) {
    if (monHidden(m)) continue;
    const notices = ntWithRepeats(NT.items).filter(n => monHas(m, n)), last = monNewest(notices), names = monNames(m);
    for (const n of notices) shown.add(n.id);
    if (ownedNames.has(m)) continue;
    // The row says the newest result in words: the newest report, unless a later run said nothing (an "ok" run posts no report).
    const fresh = last && (!m.last_run || ntAt(last) >= Date.parse(m.last_run) - 60_000);
    const need = notices.filter(monNeed).length, conn = m.connection === "disconnected", running = !!m.watch && MON.running.has(m.watch);
    (monProject(m) ? proj : plain).push({ key: `m:${m.name}`, group: monGroupOf(m), ...(monProject(m) ? { proj: true } : {}), name: monTitle(m), raw: monRaw(m), ic: "activity", notices, mails: [], mon: m, unread: monUnread(notices), need, chips: monNeedChips(need),
      hint: conn ? monConnShort(m) : running ? "지금 확인하고 있어요" : fresh ? monClean(monStrip(monLine(last), names), monRunLine(m)) : monRunLine(m), at: m.last_run || (last ? monNoticeAt(last) : ""),
      msig: [m.last_run, m.next_run, m.last_result, m.paused, m.connection, running].join("|"),
      badge: (st => [st.text, st.tone])(monStatus(m)) });
  }
  mxMerge(items); items.push(...monGrouped(proj, plain));
  // A report the hub marked as an app's (n.app, hub/notices.ts) is never here, even before the app list below has loaded.
  const feed = ntWithRepeats(NT.items).filter(n => n.kind === "watch" && !n.app && !shown.has(n.id)), need = feed.filter(monNeed).length;
  // The feed's row: what waits on the owner as its chip (counted apart from the plain reports, like an app row), the head line under the name (monFeedHead).
  items.unshift({ key: "notice", group: "", name: MON_FEED, ic: "list", notices: feed, mails: [], unread: monUnread(feed), need, chips: monNeedChips(need), ...monFeedHead(feed) });
  // 답장 대기 (30-replies.js): every reply that waits on the owner, of every app and computer, right under 감시 소식.
  const rq = rqMonItem();
  if (rq) items.splice(1, 0, rq);
  return pqMerge(items);
}
// The 감시 소식 row's line never passes an old report off as the current state: the newest UNREAD report (another computer's with its name),
// else only when the last one came ("마지막 소식 10월 26일"). A report of a watch that no longer exists (on the computer that wrote it) is skipped.
const monGone = n => {
  if (!n.watch) return false;
  const mons = n.pc ? ((((PQ.list.find(p => p && p.url === n.pc.url) || {}).items) || {}).monitors || null) : NM.loaded ? NM.items : null;
  return !!mons && !mons.some(m => m.watch === n.watch);
};
const monFeedDay = t => kstDay(t) === kstDay(Date.now()) ? `오늘 ${kstHM(t)}` : new Date(t).toLocaleDateString("ko-KR", { ...KST, month: "long", day: "numeric" });
function monFeedHead(list) {
  const live = list.filter(n => !monGone(n)), fresh = monNewest(live.filter(n => !n.read)), last = monNewest(live);
  if (fresh) return { hint: `${fresh.pc ? `${fresh.pc.name} · ` : ""}${monLine(fresh)}`, at: monNoticeAt(fresh) };
  return last ? { hint: `마지막 소식 ${monFeedDay(ntAt(last))}`, at: monNoticeAt(last) } : { hint: "새 감시 소식이 없어요", at: "" };
}
// 답 필요: waits on the owner and is answered from here (an open decision, an [ask] report), never read by looking; 실패: a report that could not check.
// A peer's open decision is answered here too (ntPost through the peer); a peer's loose [ask] waits in that computer's conversation.
const monNeed = n => ntNeeds(n) && (!n.pc || ntIsDec(n));
const monFailed = n => n.tone === "fail";
const monNeedChips = need => (need ? [[`답 필요 ${need}`, "warn"]] : undefined);
// The open item: the one picked, else on a wide screen the first (a phone shows its list until one is picked).
const monSel = items => items.find(i => i.key === MON.sel) || null;
const monName = () => { const it = monItems().find(i => i.key === MON.sel); return kkItem(it) && KK.open && KK.room ? KK.room.name : it ? mxsName() || it.name : titles.monitoring; };
function monState(it) {
  if (it.off) return "연결 안 됨";
  // The progress block under the name already carries the two runs in words, so the state line says only where it stands.
  if (it.mon) { const st = monStatus(it.mon); return st.key === "disconnected" ? "" : st.text; }
  if (it.rq) return it.unread ? `답장 ${it.unread}건 기다려요` : it.hint;
  if (it.key === "notice") return [it.need ? `답 필요 ${it.need}건` : "", it.unread ? `안 읽음 ${it.unread}개` : ""].filter(Boolean).join(" · ") || "감시와 예약 결과";
  return it.app ? it.mxLine || it.hint : it.unread ? `안 읽음 ${it.unread}개` : "연결돼 있어요";
}

/* ---- the list ---- */
function monRows(items, sel) {
  const rows = [];
  let group = null, added = false;
  // 앱 추가 is the last row of the 앱 group, right under the apps; with no app yet it is the group's only row.
  const addRow = () => { added = true; rows.push({ k: "add-app", name: "앱 관리", av: monIcon("add"), hint: asAddHint(), sel: false, open: () => asAddSheet() }); };
  for (const it of items) {
    if (group === MON_GROUP.app && it.group !== group && !added) addRow();
    if ((it.group === MON_GROUP.plain || it.proj) && !added) { rows.push({ header: MON_GROUP.app }); addRow(); }
    if (it.group && it.group !== group) rows.push({ header: it.group });
    group = it.group;
    rows.push({ k: it.key, name: it.name, av: monIcon(it.ic), hint: it.hint, unread: it.unread, unreplied: it.unreplied | 0, badge: it.badge || null, chips: it.chips, sel: !!sel && it.key === sel.key && !MON.list, open: () => go("monitoring", monRowGo(it)) });
  }
  if (!added) { if (group !== MON_GROUP.app) rows.push({ header: MON_GROUP.app }); addRow(); }
  if (!NM.loaded) rows.push({ header: NM.failed ? "모니터링을 불러오지 못했어요" : "모니터링 불러오는 중…" });
  return rows;
}

/* ---- the conversation ---- */
const MON_TONE = { fail: ["실패", "err"], warn: ["주의", "warn"], ask: ["답변 필요", "warn"], ok: ["정상", "ok"], changed: ["바뀜", "warn"] };
const monWhen = n => ntTime(n.updated || n.ts);
const monTag = tone => { const t = MON_TONE[tone]; return t ? el("span", { class: `tag ${t[1]}`, text: t[0] }) : null; };
// A send approval (hub/draft-approval.ts): drawn as the mail it would send - the one question, the mail being answered when known, the recipient chip,
// the subject in bold, the body in paragraphs - with its state as a badge with the time. 보내기 sends, 고치기 asks "어떻게 고칠까요?" (the bot rewrites it),
// 보내지 않기 is the quiet way out. The whole answer path is the notice's (answerInline / ntPost), so the chat card and this one stay in step.
const DR = { edit: new Set(), manual: new Set(), note: {} };
const DR_STATE = { open: ["확인 대기", "warn"], send: ["보냄", "ok"], edit: ["고침", "pri"], revising: ["고치는 중…", "pri"], drop: ["보내지 않음", ""], own: ["보낼 방법 전함", "pri"], expired: ["만료", ""], ignored: ["무시함", ""] };
function drState(d) {
  if (d.state === "open" || d.state === "ignored") return d.state;
  if (d.draft && ntRevising({ kind: "decision", decision: d })) return "revising";   // 고치기 answered, the new draft has not landed
  const m = /^\s*(\d+)\)/.exec(String(d.answer || "")), o = m && d.options.find(x => x.n === Number(m[1]));
  return d.resolved || !o ? "expired" : { 보내기: "send", 고치기: "edit", "보내지 않기": "drop", "답글만 보내기": "send", "메일만 보내기": "send", "이대로 보내기": "send", [DRAFT_OWN]: "own" }[o.label] || "expired";
}
const drParas = body => String(body ?? "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().split(/\n\n/);
function drOriginal(t) {
  const m = MAILS.get(t);
  if (!m) return null;
  const brief = mailBrief(m, t);
  return el("div", { class: "dr-orig" }, el("div", { class: "dr-ok", text: "답장할 메일" }), el("div", { class: "dr-os" }, el("b", { text: mailSender(m.from) }), m.subject ? ` · ${m.subject}` : ""), brief ? el("div", { class: "dr-ob", text: brief }) : null);
}
// The app instance that holds a conversation target, for the card's head (a peer's row first: PQ.of).
const monInstLabel = t => { const pe = PQ.of.get(t); if (pe) return pe.label || ""; const it = INTG.items.find(x => intgHas(x, t)); return it ? it.label : ""; };
// The send approval as the one reply card (web/js/10-reply-card.js): same head (앱 · 계정 · 컴퓨터 · 모델), same 첨부 줄, clamped body, and the same
// three actions as the 답장 확인 queue, the KakaoTalk room and a comment thread. The answer path is the notice's (answerInline / ntPost), so this
// card and the chat card stay in step.
// o.bare: only the mail it sends (a handled draft unfolded inside its mail's conversation, 30-mail-sent.js).
function draftCardNode(n, o = {}) {
  const d = n.decision, dr = d.draft, st = drState(d), open = st === "open", [stText, stTone] = DR_STATE[st], busy = dcSending.has(n.id);
  const opt = k => d.options.find(o => o.label === k) || null, oSend = opt("보내기"), oEdit = opt("고치기"), oDrop = opt("보내지 않기");
  const redraw = () => { const nn = draftCardNode(n); card.replaceWith(nn); };
  const when = ntTime(d.answered_at || n.updated || n.ts), mail = d.to.startsWith("mail:"), seen = mailLinesOpen(d.to);
  const q = ntPlain(n.title).replace(/\s*\([^()]*\)\s*$/, "");
  const editing = open && DR.edit.has(n.id), man = editing && DR.manual.has(n.id);
  let go2 = null;
  const ta = editing ? el("textarea", { class: man ? "dr-edit" : "dr-edit ask", rows: man ? "8" : "2", maxlength: man ? "6000" : "500", placeholder: man ? "" : DRAFT_HINT, "aria-label": man ? "직접 수정" : "고칠 내용", disabled: busy, oninput: () => { DR.note[n.id] = ta.value; if (go2) go2.disabled = !ta.value.trim(); } }) : null;
  if (ta) ta.value = DR.note[n.id] ?? (man ? drParas(dr.body).join("\n\n") : "");
  const leave = () => { DR.edit.delete(n.id); DR.manual.delete(n.id); delete DR.note[n.id]; };
  // The 받는이·참조 rows of a mail draft are its own (10-decision-card.js draftToNode): 답장 | 전체 답장, the chips, editable while it waits.
  const recv = dr.toLabel === "받는이" || !dr.toLabel ? draftToNode(dr, { t: d.to, edit: open }) : el("div", { class: "dr-to" }, el("span", { class: "dr-k", text: dr.toLabel || "받는이" }), el("span", { class: "dr-chip", text: dr.to || "-" }));
  if (o.bare) return el("div", { class: "dr-mail" }, draftBriefNode(dr.brief, seen), recv,
    dr.subject ? el("div", { class: "dr-sub", text: dr.subject }) : null,
    draftOriginNode(dr),
    man ? ta : draftBodyNode(dr.body, "dr-body"),
    draftFilesNode(dr, { t: d.to, edit: open }), draftMailNode(dr.mail));
  // A mail answered by this draft reads like the landing page's comment card: who wrote, where it came from, what they wrote, then the draft in a grey box.
  const om = mail ? MAILS.get(d.to) || {} : {}, who = mail ? mailSender(om.from) : "", sent = st === "send", b = dr.brief || {}, orig = b.summary || String(om.summary || om.preview || "").split("\n")[0];
  const head = { app: mail ? "mail" : d.to, label: mail ? monInstLabel(d.to) : pcTargetName(d.to, n.pc), pc: mail && pqPc(d.to) ? pqPc(d.to).name : pqSelf(), model: dr.model || "", at: null,   // the state tag carries the time once
    ...(who ? { who, src: monInstLabel(d.to) || "메일" } : {}),
    tail: [dr.rule ? draftRuleTag(dr.rule, "dr-rule") : null, sent ? null : el("span", { class: `tag dr-st${stTone ? ` ${stTone}` : ""}`, "data-state": st, text: `${stText} · ${when}` }),
      // 지우기 on a waiting draft is 보내지 않기: the same answer path, so the owning computer drops it once and nothing is sent
      open && !editing && oDrop ? el("button", { class: "ib dr-rm", type: "button", title: "지우기 (보내지 않아요)", "aria-label": "초안 지우기", disabled: busy, onclick: () => { if (!busy) answerInline(n, oDrop); } }, icon("close")) : null] };
  if (editing) {
    go2 = el("button", { class: "btn", type: "button", disabled: busy || !ta.value.trim(), text: man ? "이 내용으로 고치기" : "고쳐 달라고 하기", onclick: async () => {
      const text = ta.value.trim();
      if (!text || !oEdit) return;
      dcSending.add(n.id); syncInlineChoices(); redraw();
      try { await ntPost(n, oEdit.n, man ? MANUAL_LEAD + text : text, undefined, oEdit.label); leave(); } catch (e) { toast(e.message, true); }
      dcSending.delete(n.id); syncInlineChoices();
    } });
  }
  const gone = open && dcGone(d.to), acts = editing || gone ? null : open ? {
    send: () => { if (!oSend || busy) return; if (dr.warning || (dr.attachments || []).length) drfSure(dr, d.to).then(ok => ok && answerInline(n, oSend)); else answerInline(n, oSend); },
    edit: oEdit ? () => { DR.edit.add(n.id); redraw(); } : null,
    drop: oDrop ? () => { if (!busy) answerInline(n, oDrop); } : null,
    busy,
  } : null;
  // 직접 수정 (man) types the mail itself: the field stands where the body was, with only the two buttons below it.
  const revise = editing ? el("div", { class: "rq-edit" }, man ? null : el("div", { class: "dr-q2", text: "어떻게 고칠까요?" }), man ? null : ta,
    el("div", { class: "dr-act dr-row" }, go2, el("button", { class: "btn text", type: "button", disabled: busy, text: "취소", onclick: () => { leave(); redraw(); } }),
      man ? null : el("button", { class: "btn text dr-manual", type: "button", disabled: busy, onclick: () => { DR.manual.add(n.id); delete DR.note[n.id]; redraw(); } }, icon("pencil"), el("span", { text: "직접 수정" })))) : null;
  // A mail draft reads as the 답장 확인 sheet does (10-reply-card.js rqMailParts): the same head line, quote, subject, folded 받는이 and 첨부 줄, here in place.
  const mp = mail && dr.toLabel === "받는이" ? rqMailParts(dr, { t: d.to, pc: head.pc, edit: open, tail: head.tail, seen, src: "" }) : null;
  const card = rqCard({ key: `dr:${n.id}`, attrs: { "data-nid": n.id },
    ...(mp ? { ...mp, cls: `bm alert rc dr ${st} ${mp.cls}` } : { cls: `bm alert rc dr ${st}`, head, label: open ? null : q || null, labelCls: "rc-title dr-q",   // a waiting draft's title asks to confirm it: the state tag says so already
      recv, subject: dr.subject, ...(who && orig ? { original: { text: orig, ...(dr.ref ? { ref: dr.ref, t: d.to } : {}) } } : {}), brief: who ? (seen ? null : mailLinesNode(b.todo, b.questions)) : draftBriefNode(dr.brief, seen),
      // A draft always shows its 첨부 줄 right before 보내기; the files are editable while the draft waits.
      attach: draftFilesNode(dr, { t: d.to, edit: open }) }),
    sent, sentAt: when,
    body: { text: dr.body, node: man ? ta : draftBodyNode(dr.body, "dr-body"), cls: "dr-body" },
    extra: [mail && !who ? drOriginal(d.to) : null,   // the head already says who wrote and what
      gone ? el("div", { class: "dc-gone", role: "status", text: DC_GONE }) : null, draftOriginNode(dr), draftMailNode(dr.mail)],
    ...(revise ? { revise } : acts ? { acts } : {}) });
  return card;
}
// A decision: the question and the same choice rows a chat message has; an open one is answered here, an answered one shows what was chosen.
function monDecisionNode(n) {
  const d = n.decision, open = d.state === "open", said = d.state === "answered" ? String(d.answer || "") : "";
  if (d.draft) return ntRevising(n) && ntSuccessor(n) ? null : draftCardNode(n);   // the rewritten draft replaces the one that was sent back
  // The buttons show the options and the card's head the question (10-decision-card.js choiceBody).
  const fl = fileLines(d.options.length ? choiceBody(n.text, ntPlain(n.title)) : n.text);
  const rows = d.options.map(o => el("button", { class: `dcm-row${said.startsWith(`${o.n})`) ? " on" : ""}`, type: "button", disabled: !open || dcSending.has(n.id), "data-n": o.n,
    onclick: () => (d.draft || o.action === "form" ? noticeSheetOpen(n.pc ? n : n.id) : answerInline(n, o)) },
    el("span", { class: "dc-key", text: String(o.n) }),
    el("span", { class: "dc-tx" }, el("span", { class: "dc-lb" }, o.label), o.desc ? el("span", { class: "dc-ds", text: dcDesc(o) }) : null)));
  const end = open ? null : el("div", { class: "mt", text: d.state === "ignored" ? "무시했어요" : d.expired ? "기한 지남" : d.resolved ? "답 없이 끝났어요" : `답했어요${said ? ` · ${ntPlain(said)}` : ""}` });
  return el("div", { class: "bm alert", "data-nid": n.id }, el("div", { class: "mt" }, el("span", { class: "mn", text: ntPlain(n.title) || "답변이 필요해요" }), ` · ${monWhen(n)}`, open ? " " : null, open ? monTag("ask") : null),
    answerParts(fl, { lead: false }), el("div", { class: "dcm fx mon-dc" }, ...rows), end);
}
// Any other notice is a result card (11-resultcard.js): the monitor's name, the time, the result in words, the original folded.
// A monitor's own report drops the monitor's name in front of its first line (the card already says whose it is).
const monCard = (name, at, text, tone, title) => resultCard({ src: name, at, text, title, tag: monTag(tone) });
function monNoticeNode(n, names = []) {
// A report that points at an app item (n.item, hub/watchitem.ts) shows the item as the app draws it, the check's own output folded under it. This is the one
// place that resolves the reference: a mail this page holds, else the card the hub kept with the report; an item that is not found here (another gateway's)
// shows the subject and sender the check printed, and a report with nothing to show is a plain report.
function monItemNode(n) {
  const it = n.item, t = it && it.app === "mail" && it.key ? `mail:${it.key}` : "", c = it && it.card;
  if (t && !MAILS.has(t) && c && c.source) MAILS.set(t, c);
  const node = t && MAILS.has(t) ? monConvNode(t, "메일") : c && (c.subject || c.from) ? resultCard({ src: mailSender(c.from), at: n.updated || n.ts, title: c.subject }) : null;
  const raw = node ? rcSplit(n.text).raw : "";
  if (raw) { const d = rcRawFold(raw); d.addEventListener("click", e => e.stopPropagation()); node.append(d); }
  return node;
}
  if (ntIsDec(n)) return monDecisionNode(n);   // a peer's question too: the same card, its answer sent to that computer (ntPost)
  const node = monCard(monClean(names[0] || n.title) || "알림", n.updated || n.ts, monStrip(String(n.text || ""), [...names, ntPlain(n.title)]), n.tone);
  const card = n.item ? monItemNode(n) : null;
  if (card) { card.dataset.nid = n.id; return card; }
  if (!node) return null;
  for (const li of node.querySelectorAll(".rc-sec li")) { const c = nwChangeNode(li.textContent); if (c) li.replaceChildren(c); }   // 89,000원 → 72,000원: the old value struck, the new one bold
  node.dataset.nid = n.id;
  if (ntNeeds(n) && !n.pc) node.append(el("div", { class: "btns cc-act" }, el("button", { class: "btn tonal", type: "button", onclick: () => noticeOpen(n), text: "답하러 가기" })));
  return node;
}
// Runs the monitor once now, on the computer that owns it (a peer's through /api/peer/act). The route answers after the check with the new
// row, so the bar's right edge moves at once; a peer has no row to read here, so its list is re-read through pqSoon.
const monRunNow = (btn, m) => busy(btn, async () => {
  if (!m || !m.watch) return;
  MON.running.add(m.watch); MON.sig = ""; MON.side = ""; monSchedule();
  const was = btn && btn.textContent;
  if (btn) btn.textContent = "확인하는 중…";
  try {
    const r = await api(`/api/watches/${enc(m.watch)}/run`, "POST", {});
    if (r && r.item && r.item.watch) {
      const i = NM.items.findIndex(x => x.watch === r.item.watch);
      if (i >= 0) NM.items[i] = r.item; else NM.items.push(r.item);
    }
    await loadMonitors();
    if (m.pc) pqSoon();
    toast(r && r.approved ? MON_RECONNECT : r && r.item && r.item.connection === "disconnected" ? "확인했지만 아직 연결이 끊겨 있어요" : "확인했어요");
  } finally {
    MON.running.delete(m.watch); MON.sig = ""; MON.side = ""; monSchedule();
    if (btn) btn.textContent = was;
  }
});
// A down watch behind an approval gate is approved by the tap (hub/routes-lanes.ts run): its login may now ask the owner on his phone.
const MON_RECONNECT = "다시 연결을 요청했어요. 승인 요청이 오면 눌러 주세요";
// 다시 연결 on a disconnected app: every watch the app owns runs on this computer, then the app and the list are read again.
const monRecheckApp = (btn, it, names) => busy(btn, async () => {
  for (const n of names) MON.running.add(n);
  MON.sig = ""; MON.side = ""; monSchedule();
  // allSettled: one watch failing to run still lets the others finish, the data reload and the owner hear how it went.
  // A peer's app: its watches run (and a gated login is approved) on the computer that owns them.
  const runOne = n => it.pc ? api(pqProxy(it.pc, "/api/peer/act"), "POST", { action: "watch", args: { op: "run", name: n } }) : api(`/api/watches/${enc(n)}/run`, "POST", {});
  const res = await Promise.allSettled(names.map(runOne));
  for (const n of names) MON.running.delete(n);
  await Promise.allSettled([loadMonitors(), it.pc ? pqLoad() : loadIntegrations()]);
  MON.sig = ""; MON.side = ""; monSchedule();
  const bad = res.filter(r => r.status === "rejected").length, asked = res.some(r => r.status === "fulfilled" && r.value && r.value.approved);
  toast(bad ? `${names.length}개 중 ${bad}개는 확인하지 못했어요` : asked ? MON_RECONNECT : "지금 다시 확인했어요", !!bad);
});
// An item reads like a chat: its reports and mails oldest to newest, a monitor's latest run last. The 감시 소식 feed is a list, not a chat: newest on top.
const monFeed = it => it.key === "notice";

/* ---- a lot piled up: what waits first, one row per source, filters, 읽음 처리, pages ---- */
const MON_FILTERS = [["all", "전체", () => true], ["need", "답 필요", monNeed], ["fail", "실패", monFailed]];
const monFilterOf = () => MON_FILTERS.find(f => f[0] === MON.filter) || MON_FILTERS[0];
const MON_PAGE = 30;       // rows per page (더 보기 / 이전 소식 보기 bring the next)
// Enough pages of list `key` to show its entry number `i` (-1: nothing to reach).
const monPageTo = (key, i) => { if (i >= 0) MON.more.set(key, Math.max(MON.more.get(key) || MON_PAGE, (Math.floor(i / MON_PAGE) + 1) * MON_PAGE)); };
const MON_FOLD_MIN = 3;    // a run of this many same results in a row folds into its last one
// A row's summary: the report's first two lines (the monitor's name and the original dropped), 140 characters at most.
const monLines = (n, names) => monStrip(choiceFree(String(n.text || "").split(/\n(?:```원문|원문[ \t]*\n)/)[0]), [...names, ntPlain(n.title)]).split("\n").map(l => monClean(l)).filter(Boolean);
function monSummary(n, names) {
  const lines = monLines(n, names).filter(l => !/^(?:새로 생겼어요|사라졌어요)$/.test(l));   // a section heading of the card, not news
  const s = lines.slice(0, 2).join(" · ");
  return (s.length > 140 ? `${s.slice(0, 139)}…` : s) || ntPlain(n.title) || "알림";
}
// The row's second line, only when it says something its first line (the source) does not: a report that is one sentence is said once.
const monSumNode = (n, names, src) => { const s = monSummary(n, names); return s === src ? null : el("div", { class: "fr-sum", text: s }); };
const monFoldKey = (n, names) => `${n.tone}|${monSummary(n, names)}`;
// One source of the feed: the watch's name on one computer (a peer's report of the same name is its own row).
const monSrcKey = n => `${n.pc ? n.pc.name : ""}|${ntPlain(n.title)}`;
function monToggle(key) { if (MON.open.has(key)) MON.open.delete(key); else MON.open.add(key); MON.sig = ""; monSchedule(); }
const monMoreBtn = (key, left, text) => el("button", { class: "btn text mon-more", type: "button", "data-more": key, onclick: () => { MON.more.set(key, (MON.more.get(key) || MON_PAGE) + MON_PAGE); MON.grew = key !== "feed" && !key.startsWith("g:"); MON.sig = ""; monSchedule(); }, text: text || `${left}개 더 보기` });
// The top of an older page watches for the owner reaching it (monObserveOlder at the bottom): the reports above load themselves, and the button stays
// for a keyboard or a browser without the observer.
const monOlderSentinel = (key, left, end) => el("div", { class: "mon-sentinel", "data-older": key, "data-left": String(left), "data-end": end || null, "aria-hidden": "true" });
const monKey = (ev, fn) => { if (ev.target === ev.currentTarget && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); fn(); } };
// The bar above a long list: the three views with their counts, and 읽음 처리 for the plain reports in the view (what waits on the owner stays unread).
// It is drawn once the item holds more than a handful of reports, or any that waits or failed unread; a mail list has its own bar instead.
const monBarWanted = it => !it.mails.some(t => MAILS.has(t)) && (it.notices.length > 6 || it.notices.some(n => monNeed(n) || (monFailed(n) && !n.read)));
function monBar(it) {
  const cur = monFilterOf(), fyi = it.notices.filter(n => cur[2](n) && !n.read && !monNeed(n) && n.id);
  return segKeep(el("div", { class: "mr-filter mon-bar" },
    el("div", { class: "mon-tabs", role: "tablist", "aria-label": "소식 보기" }, ...MON_FILTERS.map(([k, label, ok]) => {
      const n = k === "all" ? it.notices.length : it.notices.filter(ok).length;
      return el("button", { class: `cchip mr-f${k === cur[0] ? " on" : ""}`, type: "button", role: "tab", "aria-selected": String(k === cur[0]), "data-filter": k, onclick: () => { MON.filter = k; MON.more.clear(); MON.sig = ""; monSchedule(); } }, label, n ? el("span", { class: "mr-fn", text: String(n) }) : null);
    })),
    el("button", { class: "btn text mon-read", type: "button", "data-k": "read", disabled: !fyi.length, title: "답이 필요한 것은 그대로 둬요", onclick: ev => monReadAll(ev.currentTarget, fyi), text: fyi.length ? `${fyi.length}개 읽음 처리` : "읽음 처리" })));
}
// 읽음 처리: the listed plain reports are read here at once and on the hub; a failure puts them back and says why (busy toasts it).
// A peer's reports are read on the computer that holds them (pqNoticesRead).
const monReadAll = (btn, list) => busy(btn, async () => {
  const mine = list.filter(n => !n.pc), ids = mine.map(n => String(n.id));
  try { await pqNoticesRead(list); } catch (err) { for (const n of list) if (n.pc) n.read = false; pqSoon(); throw err; }
  if (ids.length) {
    for (const n of mine) n.read = true;
    NT.unread = Math.max(0, NT.unread - ids.length); ntPaint(); homeSoon();
    let r;
    try { r = await api("/api/notices/read", "POST", { ids }); }
    catch (err) { for (const n of mine) n.read = false; NT.unread += ids.length; ntPaint(); homeSoon(); loadNotices(); throw err; }
    if (r && typeof r.unread === "number") NT.unread = r.unread;
    ntPaint();
  }
  toast(`${list.length}개를 읽음으로 표시했어요`);
});
// One report as a row: source, state, time and a two-line summary; a tap unfolds the whole card in place (sections, the original, 답하러 가기).
// A report that waits on the owner carries 답하러 가기 on the row itself. A decision is always the whole card: it is answered in place.
function monRowNode(n, names) {
  if (ntIsDec(n) || n.item) return monNoticeNode(n, names);   // a report about an app item shows the item (a mail row) as the app draws it
  const key = `n:${n.id}`, src = ntPlain(names[0] || n.title) || "알림";
  if (n.id === MON.want) MON.open.add(key);
  if (MON.open.has(key)) {
    const full = monNoticeNode(n, names);
    if (!full) return null;
    full.classList.add("fr-open");
    full.append(el("div", { class: "btns cc-act" }, el("button", { class: "btn text", type: "button", "aria-label": `${src} 소식 접기`, onclick: () => monToggle(key), text: "접기" })));
    return full;
  }
  const need = monNeed(n);
  return el("div", { class: `bm alert rc fr${n.read ? "" : " un"}`, "data-nid": n.id, role: "button", tabindex: "0", "aria-expanded": "false", "aria-label": `${src} 소식 펼치기`, onclick: () => monToggle(key), onkeydown: ev => monKey(ev, () => monToggle(key)) },
    el("div", { class: "rc-hd" }, el("span", { class: "rc-src", text: src }), n.pc ? el("span", { class: "tag", text: n.pc.name }) : null, need ? monTag("ask") : monTag(n.tone), el("span", { class: "rc-time", text: monWhen(n) })),
    monSumNode(n, names, src),
    need ? el("div", { class: "btns cc-act" }, el("button", { class: "btn tonal", type: "button", onclick: ev => { ev.stopPropagation(); noticeOpen(n); }, text: "답하러 가기" })) : null);
}
// A monitor's 확인 기록 is the prototype's detail list (#watch/price): ONE card of compact rows - a dot for the result, the report's first line (a price
// change as the old value struck, then the new one), a small second line, the time at the right. A tap unfolds the whole report in place (monRowNode's card).
// What waits on the owner, a decision or a report with an item stays a full card: it is answered or opened there.
const MON_LR_DOT = { fail: "err", changed: "pri", warn: "warn", ask: "warn", ok: "ok" };
const monAgo = at => { const ms = Date.now() - Date.parse(at); return ms < 86_400_000 ? monRel(ms, true) : monTime(at); };
const MON_ROWS = new WeakMap();   // a compact log row -> its small second line (a folded run rewrites it)
function monLogLine({ tone, main, sub, at, unread, nid, onclick, label }) {
  const l2 = el("span", { class: "mon-l2", title: typeof sub === "string" ? sub : null, text: sub || "" });
  const row = el("div", { class: `mon-lr${unread ? " un" : ""}`, "data-nid": nid || null, role: onclick ? "button" : null, tabindex: onclick ? "0" : null, "aria-label": label || null, onclick: onclick || null, onkeydown: onclick ? ev => monKey(ev, onclick) : null },
    el("span", { class: `dot${MON_LR_DOT[tone] ? ` ${MON_LR_DOT[tone]}` : ""}`, "aria-hidden": "true" }),
    el("span", { class: "mon-lb" }, el("span", { class: "mon-l1" }, main), l2),
    el("span", { class: "mon-lt", text: at ? monAgo(at) : "" }));
  MON_ROWS.set(row, l2);
  return row;
}
function monLogRow(n, names) {
  const key = `n:${n.id}`;
  if (n.id === MON.want) MON.open.add(key);
  if (ntIsDec(n) || n.item || monNeed(n) || MON.open.has(key)) return monRowNode(n, names);
  const lines = monLines(n, names);
  const chg = nwChangeNode(nwChangeLine(n.text)), plain = lines.filter(l => !l.includes("→")).map(l => l.replace(/^\[[^\]]*\]\s*/, ""));
  const main = chg || plain[0] || ntPlain(n.title) || "알림", sub = chg ? plain[0] || "" : plain[1] || "";
  const src = ntPlain(names[0] || n.title) || "알림";
  return monLogLine({ tone: chg ? "changed" : n.tone, main, sub, at: n.updated || n.ts, unread: !n.read, nid: n.id, onclick: () => monToggle(key), label: `${src} 소식 펼치기` });
}
// The monitor's own latest run as the newest row: how it last ended and when it checks next (hub/monitors.ts watchFacts).
function monRunRow(it) {
  const m = it.mon;
  if (!m.last_run) return null;
  const next = [m.next_run ? `다음 확인 ${monTime(m.next_run)}` : "", m.every || ""].filter(Boolean).join(" · ");
  const facts = [m.fails ? `연속 실패 ${m.fails}번` : "", monLastOk(m), monLastOut(m)].filter(Boolean);
  return monLogLine({ tone: m.kind === "watch" ? m.last_result : "ok", main: monRunLine(m), sub: [...facts, next].join(" · "), at: m.last_run });
}
// The question chips of a watch (asChipTexts): one row of small buttons under its log.
function monRunChips(it) {
  const m = it.mon, chips = m.kind === "watch" && m.watch ? asChipTexts(m) : [];
  return chips.length ? el("div", { class: "btns cc-act mon-chips" }, ...chips.map(c => el("button", { class: "as-tpl", type: "button", "data-chip": c, onclick: () => asAsk(`w:${m.watch}`, c) }, c))) : null;
}
// One source folded into one row: its newest line, how many reports and how many unread; a tap lists them, newest first, a page at a time.
// Folded, the row stands for its newest report (seeing it reads that one); the rest are read as they come into view or by 읽음 처리.
function monGroupNode(g, names) {
  if (g.length === 1) return [monRowNode(g[0], names)];
  const n0 = g[0], need = monNeed(n0), key = `g:${need ? `need|${monSummary(n0, names)}|` : ""}${monSrcKey(n0)}`, want = g.findIndex(n => n.id === MON.want);
  if (want >= 0) { MON.open.add(key); monPageTo(key, want); }
  const open = MON.open.has(key), unread = g.filter(n => !n.read).length, src = ntPlain(names[0] || n0.title) || "알림";
  const head = el("div", { class: `bm alert rc fr grp${unread ? " un" : ""}${open ? " open" : ""}`, "data-nid": open ? null : n0.id, "data-group": key, role: "button", tabindex: "0", "aria-expanded": String(open), "aria-label": `${src} 소식 ${g.length}건 ${open ? "접기" : "펼치기"}`, onclick: () => monToggle(key), onkeydown: ev => monKey(ev, () => monToggle(key)) },
    el("div", { class: "rc-hd" }, el("span", { class: "rc-src", text: src }), n0.pc ? el("span", { class: "tag", text: n0.pc.name }) : null, need ? monTag("ask") : monTag(n0.tone), el("span", { class: "tag fr-n", text: need ? `같은 질문 ${g.length}번` : `${g.length}건` }), unread ? el("span", { class: "nb", "aria-label": `안 읽음 ${unread}개`, text: unread > 99 ? "99+" : String(unread) }) : null, el("span", { class: "rc-time", text: monWhen(n0) }), el("span", { class: "fr-chev", "aria-hidden": "true" }, icon("drop"))),
    open ? null : monSumNode(n0, names, src),
    // the same question asked again: answered once from its newest one, the earlier ones listed when unfolded
    need && !open ? el("div", { class: "btns cc-act" }, el("button", { class: "btn tonal", type: "button", onclick: ev => { ev.stopPropagation(); noticeOpen(n0); }, text: "답하러 가기" })) : null);
  if (!open) return [head];
  const page = MON.more.get(key) || MON_PAGE;
  return [head, el("div", { class: "fr-list" }, ...g.slice(0, page).map(n => monRowNode(n, names)).filter(Boolean), g.length > page ? monMoreBtn(key, g.length - page) : null)];
}
// 감시 소식, newest first: what waits on the owner (each its own row), then the sources with an unread failure, then the rest, one row per source.
function monFeedNodes(it, names) {
  const ok = monFilterOf()[2], list = it.notices.filter(ok).sort((a, b) => ntAt(b) - ntAt(a));
  const asked = new Map(), by = new Map();
  for (const n of list) if (monNeed(n)) { const k = `${monSrcKey(n)}|${monSummary(n, names)}`; asked.set(k, [...(asked.get(k) || []), n]); }
  for (const n of list) if (!monNeed(n)) { const k = n.item ? `item|${n.id}` : monSrcKey(n); by.set(k, [...(by.get(k) || []), n]); }
  const groups = [...by.values()], bad = groups.filter(g => g.some(n => monFailed(n) && !n.read));
  const secs = [["답 필요", [...asked.values()]], ["실패", bad], ["소식", groups.filter(g => !bad.includes(g))]].filter(s => s[1].length);
  monPageTo("feed", secs.flatMap(s => s[1]).findIndex(g => g.some(n => n.id === MON.want)));
  const page = MON.more.get("feed") || MON_PAGE, out = [];
  let shown = 0, left = 0;
  for (const [label, gs] of secs) {
    if (shown >= page) { left += gs.length; continue; }
    if (secs.length > 1) out.push(el("div", { class: "mon-sh", role: "heading", "aria-level": "3", text: label }));
    let day = "";
    for (const g of gs) {
      if (shown >= page) { left++; continue; }
      shown++;
      // the plain sources under a day line (오늘 / 10월 25일 (토)), by their newest report; what waits stays one block on top
      const d = label === "답 필요" ? "" : dayLabel(ntAt(g[0]));
      if (d && d !== day) { day = d; out.push(el("div", { class: "mon-day", text: d })); }
      out.push(...monGroupNode(g, names));
    }
  }
  if (left) out.push(monMoreBtn("feed", left));
  return out.filter(Boolean);
}
// A monitor or an app, oldest to newest: the newest MON_PAGE reports (이전 소식 보기 brings the older ones above), a run of the same result folded into its
// last report, the mails, and the monitor's latest run last.
function monChronoNodes(it, names) {
  const ok = monFilterOf()[2], withMails = monMailList(it), mf = withMails ? mailFilterOf() : null, held = mf && mf[0] === "pending";
  // a mail list keeps the reply drafts awaiting the owner under 확인 대기 alone; every other view drops them. A draft answered 보내지 않기, and one a
  // newer draft of the same mail replaced, is gone from every view.
  const newestDraft = mailDraftLive(it.notices);
  // A message about one mail (the bot's note in its conversation, src/open = that mail) is read inside that mail, not as a card of its own between
  // the mail rows: every row of a mail list is a mail. Reply drafts keep their own place (확인 대기). A message about a mail this page does not hold
  // (a deleted one: mail-deleted.json takes it off /api/conversations, but its message stays in notices.json) is no card either: it would sit between
  // the rows as a mail without ☐, ☆ or ⋯ that nothing can select or delete. A report carrying its item's card (n.item) still draws that item.
  const rowMail = n => { const t = n.src || n.open; return !!mf && !(n.decision && n.decision.draft) && !!t && isMailT(t) && (MAILS.has(t) ? it.mails.includes(t) : !n.item); };
  const notices = it.notices.filter(n => ok(n) && !rowMail(n) && (!mf || (mailDraftHeld(n) === held && !mailDraftDone(n))) && !mailDraftGone(n, newestDraft));
  const runs = [];
  for (const n of notices.sort((a, b) => ntAt(a) - ntAt(b))) {
    const last = runs[runs.length - 1], k = monNeed(n) || ntIsDec(n) ? "" : monFoldKey(n, names);
    if (k && last && last.k === k) { last.all.push(n); last.n = n; } else runs.push({ k, n, all: [n] });
  }
  const wanted = runs.findIndex(r => r.all.some(n => n.id === MON.want));
  if (wanted >= 0) monPageTo(it.key, runs.length - 1 - wanted);
  const page = MON.more.get(it.key) || MON_PAGE, cut = Math.max(0, runs.length - page);
  const rep = r => {
    const draw = it.mon ? monLogRow : monNoticeNode;
    if (r.all.length < MON_FOLD_MIN) return r.all.map(n => ({ at: ntAt(n), node: () => draw(n, names) }));
    return [{ at: ntAt(r.n), node: () => {
      const x = draw(r.n, names);
      if (!x) return null;
      x.dataset.nids = r.all.map(n => n.id).join(",");
      const rep = `같은 결과 ${r.all.length}번 · 처음 ${monWhen(r.all[0])}`;
      if (MON_ROWS.has(x)) MON_ROWS.get(x).textContent = rep;
      else x.querySelector(".rc-hd").after(el("div", { class: "mon-rep", text: rep }));
      return x;
    } }];
  };
  const msgs = [...(it.mon && !held ? [{ at: Date.parse(it.mon.last_run) || 0, node: () => monRunRow(it) }] : []), ...runs.slice(cut).flatMap(rep), ...(held ? [] : mf ? it.mails.filter(t => MAILS.has(t) && mf[2](MAILS.get(t), t)) : it.mails).map(t => ({ at: Date.parse((CONV.get(t) || {}).ts) || Date.parse((MAILS.get(t) || {}).at) || 0, mail: true, node: () => withMails ? mbRow(t, it.name) : monConvNode(t, it.name) }))];
  // A mail app reads like a mailbox, newest on top (owner 2026-10-27); a monitor stays a chat, oldest to newest. Equal times keep their order.
  // A monitor's log reads like the prototype's list, newest on top; its latest run leads on a tie.
  const newestTop = monMailList(it) || !!it.mon;
  msgs.sort((a, b) => newestTop ? b.at - a.at : a.at - b.at);
  // A mail list draws the newest mbDrawn mails; the rest comes a page at a time (mbMoreNodes). Select-all and the count read MBOX.vis, not these rows.
  const hidden = withMails ? new Set(msgs.filter(x => x.mail).slice(mbDrawn(`${it.key}${it.mxk || ""}|${MON.mailFilter}`))) : null;
  let nodes = msgs.filter(x => !hidden || !hidden.has(x)).map(x => x.node()).filter(Boolean);
  if (it.mon) {   // the compact rows of one stretch share one card; an opened report or a decision card ends the stretch
    const out = [];
    let box = null;
    for (const x of nodes) {
      if (MON_ROWS.has(x)) { if (!box) out.push(box = el("div", { class: "mon-log" })); box.append(x); } else { box = null; out.push(x); }
    }
    const chips = monRunChips(it);
    nodes = chips ? [...out, chips] : out;
  }
  if (cut && newestTop) nodes.push(...(it.mon ? [monOlderSentinel(it.key, cut, "end")] : []), monMoreBtn(it.key, cut, `이전 소식 ${cut}개 보기`));
  else if (cut) nodes.unshift(monOlderSentinel(it.key, cut), monMoreBtn(it.key, cut, `이전 소식 ${cut}개 보기`));
  if (hidden && (hidden.size || CVP.more)) nodes.push(...mbMoreNodes(hidden.size));
  if (withMails) mbRowsPrune();
  if (withMails) return MX.scr ? mxScreen() : [...mxTop(it), ...mailFilterBar(it.mails, it.notices.filter(ok)), ...[mbList(held ? [] : it.mails.filter(t => MAILS.has(t) && mf[2](MAILS.get(t), t)))].filter(Boolean), ...(nodes.length ? nodes : [el("div", { class: "empty", text: held ? "확인할 초안이 없어요" : "이 보기에 해당하는 메일이 없어요" })]), el("div", { class: "mbox-fab-gap", "aria-hidden": "true" }), mbFab()];   // the gap keeps the last card, its 첨부 줄 included, clear of 메일 쓰기
  return nodes;
}
// A short feed (a handful of reports) reads best as the whole cards, newest first, with the machine of a peer's report; past MON_COMPACT
// reports it becomes the sections and folded rows of monFeedNodes.
const MON_COMPACT = 6;
const monFeedCards = (it, names) => it.notices.filter(monFilterOf()[2]).sort((a, b) => ntAt(b) - ntAt(a)).map(n => {
  const x = monNoticeNode(n, names), src = x && n.pc && x.querySelector(".rc-src");
  if (src) src.after(el("span", { class: "tag", text: n.pc.name }));
  return x;
}).filter(Boolean);
// A phone has no room for the wide head, so the same progress, connection banner and 지금 확인 open the conversation instead.
function monTopNodes(it) {
  if (!narrowChat()) return [];
  const out = [], banner = monBannerOf(it);
  if (it.mon) out.push(el("div", { class: "cv-p mon-desc", text: monDesc(it.mon) }), monProgNode(it.mon, { tag: !banner }));
  if (banner) out.push(banner);
  const acts = [...(it.mon && it.mon.watch && !banner ? [monRunBtn(it.mon)] : []), monConvBtn(it)].filter(Boolean);
  if (acts.length) out.push(el("div", { class: "mon-actions" }, ...acts));
  // The prototype's detail card opens the conversation on a phone too: the wait, a down banner and the actions in one card (never loose).
  return out.length ? [el("div", { class: "mon-topcard" }, ...out)] : [];
}
// 대화로 이어가기 (owner 2026-11-03): the item's own settings conversation (the same go() as the 대화 icon). A mail or KakaoTalk item is
// already a conversation, so it has no button of its own here.
function monConvBtn(it) {
  const app = monSettingsApp(it);
  if (!app || monMailList(it) || kkItem(it)) return null;
  return el("button", { class: "btn tonal sm mon-continue", type: "button", "data-k": "continue", title: "이 항목으로 대화를 이어가요", text: "대화로 이어가기", onclick: () => go("monitoring", `c:${asConv(app)}`) });
}
// 감시 소식 opens with every plain monitor at a glance: how far its wait has come, how it last ended, and the last line it said. Down and failed
// rows come first, so what needs the owner is at the top; a tap opens that monitor.
// Every plain monitor of the list, this computer's and the others' (monItems already drops an app's own watches and merges the peers): a peer row
// keeps its machine chip, and one whose hub sent no next run says '다른 컴퓨터' instead of drawing a bar from made-up times.
function monOverview(it) {
  if (it.key !== "notice") return null;
  const now = Date.now(), list = monItems().filter(i => i.mon);
  const rank = i => { const m = i.mon; return m.connection === "disconnected" ? 0 : m.last_result === "fail" ? 1 : m.paused ? 4 : (Date.parse(m.next_run) || Infinity) < now ? 2 : m.last_run ? 3 : 2; };
  const sorted = list.slice().sort((a, b) => rank(a) - rank(b) || (Date.parse(a.mon.next_run) || Infinity) - (Date.parse(b.mon.next_run) || Infinity));
  return el("div", { class: "mon-ov" }, el("div", { class: "mon-ov-h", text: "모니터링 상태" }),
    ...(sorted.length ? sorted.map(i => {
      const m = i.mon, peerBar = i.pc && !m.paused && !(Date.parse(m.next_run) > 0);   // a paused peer monitor draws the grey 꺼짐 bar like a local one
      return el("button", { class: "mon-ov-row", type: "button", "data-ov": i.key, onclick: () => go("monitoring", i.key) },
        el("span", { class: "mon-ov-hd" }, el("span", { class: "mon-ov-n", text: monTitle(m) }), i.pc ? el("span", { class: "tag", text: i.pc.name }) : null),
        peerBar ? el("span", { class: "mon-ov-peer", text: "다른 컴퓨터" }) : monProgNode(m, { compact: true }),
        el("span", { class: "mon-ov-s", text: m.connection === "disconnected" ? monConnLine(m) : monClean(m.last_summary || "", monRunLine(m)) }));
    }) : [el("div", { class: "mon-ov-empty", text: "아직 일반 모니터링이 없어요" })]));
}
function monTimeline(it) {
  if (it.off) return [el("div", { class: "empty", text: "연결 안 됨" })];
  const names = it.mon ? monNames(it.mon) : [];
  const bar = monBarWanted(it) ? [monBar(it)] : [], nodes = !monFeed(it) ? monChronoNodes(it, names) : it.notices.length > MON_COMPACT ? monFeedNodes(it, names) : monFeedCards(it, names);
  const ov = monOverview(it), head = [...monTopNodes(it), ...bar, ...(ov ? [ov] : [])];
  // A monitor's reports read as its 확인 기록, under a section label like the prototype's detail (its 지금 확인 stays in the head's actions).
  const sec = it.mon ? [el("div", { class: "mon-sec", role: "heading", "aria-level": "3", text: it.mon.kind === "schedule" ? "실행 기록" : "확인 기록" })] : [];
  if (nodes.length) return [...head, ...sec, ...nodes];
  if (head.length) return [...head, el("div", { class: "empty", text: "이 보기에 해당하는 소식이 없어요" })];
  const next = it.mon && it.mon.next_run ? ` · 다음 확인 ${monTime(it.mon.next_run)}` : "";
  return [el("div", { class: "empty", text: !NT.loaded && !NM.loaded ? "불러오는 중…" : it.mon ? `${monRunLine(it.mon)}${next}` : "아직 소식이 없어요" })];
}
// The settings an item has: a local app's, a watch's (local or a peer's, forwarded by pqAct), a local schedule's (s:<id>, the screen only, no
// conversation: 32-app-settings.js asEntry); none for a peer's app or schedule or an unreachable computer.
// The title of a settings conversation: the monitor's or the app's own name (a peer's monitor too), not "설정".
function monSettingsName(t) {
  const a = settingsApp(t);
  if (a.startsWith("s:")) { const m = NM.items.find(x => x.schedule === a.slice(2)); return m ? monTitle(m) : "예약"; }
  if (!a.startsWith("w:")) { const pe = PQ.of.get(t), it = pe && pe.app ? { label: pe.label } : INTG.items.find(x => x.key === a); return it ? it.label : "설정"; }
  const pe = PQ.of.get(t), m = pe ? pe.mon : NM.items.find(x => x.watch === a.slice(2));
  return m ? monTitle(m) : "설정";
}
// The status block of a settings panel: the monitor itself, or each watch the app owns. Same facts as the latest-run row of the monitor's detail (monRunRow).
const monStatMons = app => (asOwn(app) ? [asMon(app)] : (monItems().find(i => i.app && monSettingsApp(i) === app) || {}).owned || []).filter(Boolean);
function monStatNode(m) {
  const st = monStatus(m);
  const facts = [m.fails ? `연속 실패 ${m.fails}번` : "", monLastOk(m), monLastOut(m)].filter(Boolean);
  return el("div", { class: "as-row as-stat", "data-watch": m.watch || m.name },
    el("span", { class: "as-b" }, el("span", { class: "as-n", text: monTitle(m) }), el("span", { class: "as-h", text: [st.text, ntMonRun(m), ntMonNext(m)].filter(Boolean).join(" · ") }), ...facts.map(t => el("span", { class: "as-h", text: t }))),
    st.tone === "err" ? el("span", { class: "tag err", text: st.text }) : null);
}
// A peer's app is `<its key>~<computer hash>`: the same key may exist on this computer too (34-peer-monitoring.js pqApp).
const monSettingsApp = it => !it || it.off ? "" : it.app && !it.pc ? (it.accounts && MX.acct !== "all" ? MX.acct : it.key.slice(2)) : it.app && it.pc ? pqApp(it.inst, it.pc) : it.mon && it.mon.kind === "watch" && it.mon.watch ? `w:${it.mon.watch}` : it.mon && it.mon.kind === "schedule" && it.mon.schedule && !it.pc ? `s:${it.mon.schedule}` : "";
// A connection that is down says so at the top of the conversation, whether or not an alert went out, with the way to check again.
// Two states, two banners: kind "down" (the connection is gone: err tone, 연결이 끊겼어요) and "fail" (connected, the last check failed: err tone too,
// 확인 실패). The head is passed in, never guessed from the detail text.
function monBannerNode(kind, detail, btn) {
  const head = kind === "down" ? "연결이 끊겼어요" : "확인 실패", t = String(detail || "").trim();
  return el("div", { class: `mon-banner ${kind}`, role: kind === "down" ? "alert" : "status", "data-kind": kind }, icon("refresh"), el("span", { class: "mon-banner-tx" }, el("b", { text: head }), t ? ` · ${t}` : ""), btn);
}
// The app hint the hub writes for a down app starts with the row word ("연결 끊김 · ..."); the banner has its own head, so only the why is kept.
const monHintWhy = h => String(h || "").replace(/^\s*연결\s*(끊김|이 끊겼어요)\s*(·\s*)?/, "");
const monRunBtn = (m, text) => el("button", { class: "btn tonal sm mon-run", type: "button", "data-run": m.watch, text: text || "지금 확인", onclick: ev => monRunNow(ev.currentTarget, m) });
const monRecheckBtn = (watch, onclick, text = "지금 다시 확인") => el("button", { class: "btn tonal sm mon-recheck", type: "button", "data-watch": watch, text, onclick });
// One re-check control per conversation: a down or failing monitor, and a down app, get the banner and its button; a healthy one gets 지금 확인
// in the head (a phone at the top of the timeline). The latest-run card never repeats it.
function monBannerOf(it) {
  if (it.mon) {
    const m = it.mon, down = m.connection === "disconnected";
    if (!down && m.last_result !== "fail") return null;
    const detail = down ? monConnWhy(m) : [m.fails > 1 ? `${m.fails}번 연속 실패했어요` : "마지막 확인이 실패했어요", monClean(m.last_summary || "")].filter(Boolean).join(" · ");
    return monBannerNode(down ? "down" : "fail", detail, m.watch ? monRecheckBtn(m.watch, ev => monRunNow(ev.currentTarget, m), down ? "다시 연결" : undefined) : null);
  }
  if (!it.conn) return null;
  const names = (it.owned || []).map(m => m.watch).filter(Boolean);
  return monBannerNode("down", monHintWhy(it.hint), names.length ? monRecheckBtn(it.key, ev => monRecheckApp(ev.currentTarget, it, names), "다시 연결") : null);
}
// The title bar of an open item; the kakao pane puts the gear in its room head once a room is open.
// A monitor adds its own progress block and 지금 확인 under the name, so the conversation always says how far the wait has come.
// When the item last said anything, for the header's quiet right end (the prototype's .ch .ac): the monitor's last run, else its newest
// report or mail. "" when nothing has happened yet.
function monHeadTime(it) {
  const stamps = [it.mon && it.mon.last_run, ...it.notices.map(n => n.updated || n.ts), ...(it.mails || []).map(t => (CONV.get(t) || {}).ts || (MAILS.get(t) || {}).at)].filter(Boolean)
    .map(t => Date.parse(t)).filter(Number.isFinite);
  return stamps.length ? ntTime(new Date(Math.max(...stamps)).toISOString()) : "";
}
// The open item's header: the prototype's detail card composition - icon, name (and its machine), state, the moment at the right end,
// the actions at the end of that row and the state / wait / banner under it. A phone has no .cv-head, so monTopNodes draws the same card there.
const monHead = it => {
  const banner = monBannerOf(it), st = monState(it);
  // An app with reply drafts waiting opens the one 답장 대기 screen on its own drafts (30-replies.js).
  const rqBtn = it.app && it.drafts ? el("button", { class: "btn tonal sm rq-go", type: "button", "data-k": "replies", text: `답장 대기 ${it.drafts}`, onclick: () => rqOpen(it.inst, it.pc) }) : null;
  // 대화로 이어가기 (owner 2026-11-03): every item continues in its own chat - the conversation its settings talk in (asOpen's own go()).
  // A mail or KakaoTalk item is already a conversation, so the way in is its row and this button stays out of the way there.
  const convBtn = monConvBtn(it);
  const acts = [convBtn, rqBtn, it.mon && it.mon.watch && !banner ? monRunBtn(it.mon) : null, it.unreplied ? unrepCount(it.unreplied) : null, ...(kkItem(it) && KK.open ? [] : asEntry(monSettingsApp(it)))].filter(Boolean);
  const extra = [];
  if (it.mon) extra.push(monProgNode(it.mon, { compact: true, tag: !banner }));
  if (banner) extra.push(banner);
  // Compact (owner 2026-11-04): one row of icon, name, place, time and the actions; the state / progress line right under it, same for mail and watch.
  return [el("div", { class: "mon-hdwrap" },
    el("div", { class: "mon-hdrow" }, monIcon(it.ic), el("span", { class: "cv-b" }, el("span", { class: "cv-n" }, it.name, pqLabel(it))), el("span", { class: "mon-hd-time", text: monHeadTime(it) }),
      acts.length ? el("div", { class: "mon-hdacts" }, ...acts) : null),
    st && !it.mon ? el("div", { class: "cv-p", text: st }) : null,
    it.mon ? el("div", { class: "cv-p mon-desc", text: monDesc(it.mon) }) : null,
    ...extra)];
};
// The settings app of the detail open now (an item, or a conversation sitting under one), for the phone's app bar.
function monDetailApp() {
  if (current === "monitoring") return monConv() ? monSettingsApp(monSel(monItems())) : "";
  if (!(current === "chat" && monCtx && convOnPhone()) || isSettingsT(target)) return "";
  const k = monItemOf(target);
  return k ? monSettingsApp(monItems().find(i => i.key === k)) : "";
}

// The owner is looking at an open item: the plain reports on screen (a row, a card, a folded run) count as read after a moment; one folded away or
// below the fold is read when it comes into view, or by 읽음 처리. What waits on the owner keeps its unread (ntNeeds), like everywhere.
function monSeen() {
  clearTimeout(MON.seenT);
  MON.seenT = setTimeout(() => {
    if (current !== "monitoring" || MON.list || document.visibilityState !== "visible") return;
    const it = monSel(monItems()), box = $("#mon-timeline");
    if (!it || !box.clientHeight) return;
    const a = box.getBoundingClientRect(), seen = new Set();
    for (const m of box.querySelectorAll("[data-nid], [data-nids]")) {
      const r = m.getBoundingClientRect();
      if (r.bottom > a.top && r.top < a.bottom) for (const id of String(m.dataset.nids || m.dataset.nid || "").split(",")) if (id) seen.add(id);
    }
    // a peer's report is read on its computer (a failed read is re-read from the next snapshot)
    const fresh = it.notices.filter(n => n.id && !n.read && !ntNeeds(n) && seen.has(String(n.id)) && (n.pc ? pqNoticeOf(n) : ntById(n.id)));
    if (!fresh.length) return;
    const mine = fresh.filter(n => !n.pc);
    pqNoticesRead(fresh).catch(() => pqSoon());
    if (!mine.length) return;
    for (const n of mine) n.read = true;
    NT.unread = Math.max(0, NT.unread - mine.length);
    ntPaint(); homeSoon();
    ntMarkRead({ ids: mine.map(n => n.id) });
  }, 700);
}
// The list's place, kept while it is off screen (a hidden box forgets its scroll).
$("#mon-side").addEventListener("scroll", ev => { MON.top = ev.currentTarget.scrollTop; }, { passive: true });
let monRaf = 0;
const monSchedule = () => { monAttnSoon(); if (!monRaf) monRaf = requestAnimationFrame(renderMonitoring); };   // the nav badge reads the same data (09-needs-you.js)
function renderMonitoring() {
  monRaf = 0;
  if (current !== "monitoring") { mbSeenReset(); if (monCtx && current === "chat") { convSchedule(); monTickStart(); } return; }
  const items = monItems(), sel = mxScope(monSel(items)), side = $("#mon-side"), box = $("#mon-timeline"), tl = $("#mon-tl");
  // An address whose item is not here (gone, or not loaded yet) shows the list, never an empty pane; an item that arrives later still opens.
  if (!sel && !MON.list) { MON.miss = true; MON.list = true; convChrome(); }
  else if (sel && MON.miss) { MON.miss = false; MON.list = false; convChrome(); }
  $("#v-monitoring").classList.toggle("mon-two", !!sel && !!sel.mon && !MON.list);
  const rows = monListRows(items, sel), sideSig = JSON.stringify([rows.map(r => [r.k, r.name, r.hint, r.unread, r.unreplied, r.badge, r.header, r.sel, r.chips, r.msig])]);
  if (sideSig !== MON.side) {
    MON.side = sideSig;
    const top = side.scrollTop;
    clear(side).append(...monSideNodes(rows));
    monDecorateRows(side, items);
    side.scrollTop = top;
  }
  monTickStart();
  const kakao = kkItem(sel);
  const cm = !kakao && sel ? cmAppOf(sel.key) : "";
  kkMode(kakao, kakao && !MON.list, kakao ? sel.pc : null);
  cmMode(cm, !!cm && !MON.list, cm ? sel.pc : null);
  mailLand(sel); mxPaint(sel);
  if (!sel) { MON.sig = ""; MON.shown = ""; convTitle(); return; }
  if (kakao || cm) {   // 30-kakao.js / 30-monitoring-comments.js draw this item's pane (rooms and chat); only the head is the usual one
    const head = JSON.stringify([sel.name, monState(sel), sel.unreplied | 0, sel.drafts | 0, !!AS.by[monSettingsApp(sel)], !!KK.open, pqSig(sel)]);
    if (head !== MON.kkHead) { MON.kkHead = head; clear($("#mon-head")).append(...monHead(sel)); }
    MON.sig = ""; MON.shown = sel.key;
    convTitle();
    return;
  }
  MON.kkHead = "";
  $("#v-monitoring").classList.toggle("rq-on", !!sel.rq);   // the screen's own head is its tabs: no item head above them (the prototype's #queue)
  if (sel.rq) {   // 답장 대기: the rows of 30-replies.js, redrawn only when an item or the screen's own state changes
    const sig = rqSig();
    if (sig !== MON.sig) {
      const keep = MON.shown === sel.key ? box.scrollTop : 0, anchor = keep > 0 ? rqAnchor() : null;   // the first row in view stays where it was
      MON.sig = sig; MON.shown = sel.key;
      clear($("#mon-head")).append(...monHead(sel));
      clear(tl).append(...rqNodes());
      box.scrollTop = keep;
      rowHold(anchor);
      edgeFade(box);
    }
    convTitle();
    return;
  }
  const sig = JSON.stringify([sel.key, sel.name, monState(sel), sel.unreplied | 0, sel.conn | 0, sel.mon && !!sel.mon.watch && MON.running.has(sel.mon.watch), sel.notices.map(n => [n.id, n.updated, n.read, n.text, n.decision, n.tone, n.item, n.item && n.item.key ? MAILS.get(`mail:${n.item.key}`) : null]), sel.mails.map(t => [t, (CONV.get(t) || {}).ts, ts(t).unread, MAILS.get(t), MAILS.has(t) ? mailBrief(MAILS.get(t), t) : ""]), sel.mon, NM.loaded, NT.loaded, MON.mailFilter || "all", pqSig(sel), sel.mxk]);
  if (sig !== MON.sig) {
    MON.sig = sig;
    const again = MON.shown === sel.key, keep = box.scrollTop, was = box.scrollHeight, stick = !again || box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
    // The same mail list repainting keeps its row nodes in place and the first row in view where it was; anything else is drawn afresh.
    const same = again && monMailList(sel), anchor = same && keep > 0 && !MON.grew ? rowAnchor(tl, ":scope > .mr", "t") : null;
    MON.shown = sel.key;
    clear($("#mon-head")).append(...monHead(sel));
    if (same) listPlace(tl, monTimeline(sel)); else clear(tl).append(...monTimeline(sel));
    if (monMailList(sel)) mbFresh(`${sel.key}${sel.mxk || ""}|${MON.mailFilter || "all"}`, tl);
    // Older reports added above (이전 소식 보기) keep what was on screen where it is.
    if (MON.grew) { MON.grew = false; box.scrollTop = keep + (box.scrollHeight - was); }
    else box.scrollTop = monFeed(sel) || monMailList(sel) || sel.mon ? (again ? keep : 0) : stick ? box.scrollHeight : keep;
    rowHold(anchor);
    edgeFade(box);
    if (MON.hl && Date.now() < MON.hlUntil) { const r = monRowOf(MON.hl); if (r) ntFlash(r); }
  }
  MON.olderBusy = false;
  monObserveOlder();
  mbObserve();
  convTitle();
  monSeen();
}
// The list column as the prototype draws it (#monitoring): section labels sit between one card per section, never inside one long card.
// The first rows (감시 소식, 답장 대기) have no label and stand as their own cards; 앱 / 일반 모니터링 / 프로젝트·… each open a labeled card.
function monSideNodes(rows) {
  const out = [];
  let list = null;
  for (const r of rows) {
    if (r.header) { out.push(el("div", { class: "mon-sec", role: "presentation", text: r.header })); list = null; continue; }
    if (!list) { list = el("div", { class: "mon-grp" }); out.push(list); }
    list.append(convRow(r));
  }
  return out;
}
// A monitor row in the list carries the same bar under its status line; the row itself is the shared convRow, so the block is appended here.
// A monitor row carries its bar as the last child of the whole row (not of the text column), so the bar and its meta line take the full left-column
// width even when a peer row's machine chip and result badge leave the text column narrow.
// A row with no wait to show (paused, no next run, or on a computer that does not answer) has no bar: its subtitle says what there is instead.
// A peer row keeps its subtitle under the name, since that line names the computer it runs on.
function monDecorateRows(side, items) {
  for (const row of side.querySelectorAll(".cv-row[data-k]")) {
    const it = items.find(i => i.key === row.dataset.k);
    if (!it || !it.mon) continue;
    const kind = monProgState(it.mon, Date.now()).kind, bar = !it.hostOff && kind !== "none" && kind !== "off";
    row.classList.toggle("has-mon-prog", bar);
    const status = row.querySelector(".cv-b .cv-p"), old = row.querySelector(".mon-prog-wrap");
    if (old) old.remove();
    if (!bar) continue;
    // The bar's colour says the result; only a disconnected monitor keeps its words (연결 끊김 and since when).
    if (status && !it.pc && it.mon.connection === "disconnected") { status.classList.add("mon-row-status"); row.append(status); }
    else if (status && !it.pc) status.remove();
    row.append(monProgNode(it.mon, { compact: true, tag: false, short: true }));
  }
}
function monTick() {
  const now = Date.now();
  for (const bar of document.querySelectorAll(".mon-prog[data-from]")) {
    const from = Number(bar.dataset.from), to = Number(bar.dataset.to), fill = bar.firstElementChild;
    if (!(to > 0) || !fill) continue;
    const late = now >= to, pct = late ? 100 : Math.max(0, Math.min(100, ((now - from) / (to - from)) * 100));
    fill.style.width = `${pct}%`;
    bar.setAttribute("aria-valuenow", String(Math.round(pct)));
    bar.setAttribute("aria-valuetext", monProgLine(from, to, now));
    bar.classList.toggle("warn", late || bar.dataset.tone === "warn");
    const wrap = bar.parentElement && bar.parentElement.parentElement;
    if (!wrap) continue;
    const tx = wrap.querySelector(".mon-prog-tx");
    if (tx) tx.textContent = monProgLine(from, to, now, null, bar.dataset.short === "1");
    const tag = wrap.querySelector(".mon-ptag");
    if (tag && !tag.dataset.fixed) {
      const [text, tone] = monPTagOf(late ? "late" : tag.dataset.tag || "ok");
      if (tag.textContent !== text) tag.textContent = text;
      tag.className = `mon-ptag${tone ? ` ${tone}` : ""}`;
    }
  }
}
// Once a second is plenty: the words change once a minute and a bar moves under a pixel per frame. The timer stops itself when the tab or the
// page is not shown and the next paint of 모니터링 (or the page coming back) starts it again.
let monTickT = 0;
function monTickStop() { if (monTickT) clearInterval(monTickT); monTickT = 0; }
function monTickStart() {
  if (monTickT || !monTicks() || document.hidden) return;
  monTick();
  monTickT = setInterval(() => { if (document.hidden || !monTicks()) monTickStop(); else monTick(); }, 1000);
}
document.addEventListener("visibilitychange", () => { if (document.hidden) monTickStop(); else monTickStart(); });
let monOlderObs = null;
// The owner reached the top of an older page: the previous reports load themselves, one page per paint, and the anchored scroll keeps the reader
// where they were (the same keep + growth rule the button uses).
function monOlderLoad(sentinel) {
  if (!MON.autoArmed || MON.olderBusy) return;
  const key = sentinel && sentinel.dataset ? sentinel.dataset.older : "", left = Number(sentinel && sentinel.dataset ? sentinel.dataset.left : 0);
  if (!key || !(left > 0)) return;
  MON.olderBusy = true;
  MON.more.set(key, (MON.more.get(key) || MON_PAGE) + MON_PAGE);
  MON.grew = !(sentinel && sentinel.dataset && sentinel.dataset.end);   // older reports below (a monitor lists newest first) grow downward: nothing to anchor
  MON.sig = "";
  monSchedule();
}
function monObserveOlder() {
  const box = $("#mon-timeline");
  if (!box) return;
  if (!monOlderObs && typeof IntersectionObserver === "function") monOlderObs = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) monOlderLoad(e.target); }, { root: box, rootMargin: "48px 0px 48px 0px" });
  if (!monOlderObs) return;
  monOlderObs.disconnect();
  for (const s of box.querySelectorAll(".mon-sentinel[data-older]")) monOlderObs.observe(s);
}
$("#mon-timeline").addEventListener("scroll", () => {
  const box = $("#mon-timeline");
  MON.autoArmed = true;
  edgeFade(box);
  monSeen();
  if (box.scrollTop <= 0) monOlderLoad(box.querySelector(".mon-sentinel[data-older]:not([data-end])"));
}, { passive: true });
setInterval(() => { if ((current === "monitoring" || monCtx) && !document.hidden) loadMonitors(); }, 60_000);
loadMonitors();
