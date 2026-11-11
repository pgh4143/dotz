/* ---------- decisions and notices: the data behind 홈's 답변 필요 / 알림 / 작업내역 cards and the decision sheet ---------- */
// Data: GET /api/notices, POST /api/notices/read, POST /api/notices/:id/answer; live frames {kind:"notice"} / {kind:"notice_read"} from the event stream
// (routed here by 99-boot.js, never into the chat timeline or the corner toasts). There is no notice list screen: 알림 and 작업내역 are their own
// conversations (chat list), 모니터링 is its own screen (30-monitoring.js); what waits on the owner shows on 홈 and in the decision sheet below.
const ntTabOf = n => n.kind === "worklog" ? "worklog" : n.kind === "watch" ? "watch" : "alert";
const NT = { items: [], unread: 0, loaded: false, failed: false, gone: new Set(), mut: 0, at: 0 };   // gone: event times of 알림 messages whose notice was dismissed (GET /api/notices gone)
// The 홈 알림 card lists alerts only: a reply in a conversation or a session's report (kind message / result) is not a notice there; it is
// unread in its own conversation, which the 채팅 tab and the session list lead to (owner 2026-10-23).
const ntHomeAlert = n => ntTabOf(n) === "alert" && n.kind !== "message" && n.kind !== "result";

const ntAt = n => Date.parse(n.updated || n.ts) || 0;
const ntTime = t => kstDay(t) === kstDay(Date.now()) ? kstHM(t) : `${dayLabel(t)} ${kstHM(t)}`;
const ntWhen = n => ntTime(n.updated || n.ts);
// Row text is plain: markdown marks (links, headings, bullets, emphasis, code) are dropped.
const ntPlain = s => plainTable(noticeKo(peerMsgLine(s), NK))
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/^\s{0,3}(?:#{1,6}|>|-#|[-*+]|\d+\.)\s+/gm, "")
  .replace(/\*+|~~|`+/g, "")
  .replace(/^\s*결정\s*[:：]\s*/gm, "")
  .replace(/(^|\s)_+([^_\s][^_]*)_+(?=\s|$)/g, "$1$2")
  .replace(/\s+/g, " ").trim();

// Phone: the count is part of the chat tab badge.
function ntPaint() {
  monAttnSoon();
  convSchedule();
  paintAttn();
  if (current === "monitoring") monSchedule();
  if (current === "notices") nscSchedule();
}

// A watch's report carries its monitor's name as the title; a schedule whose text is a command line never shows it (30-monitoring.js monHuman / monTitle).
function ntClean(n) {
  if (n && n.kind === "watch" && typeof n.title === "string" && MON_CMD.test(n.title)) {
    const m = NM.items.find(x => monNames(x).includes(n.title));
    n.title = m ? monTitle(m) : monClean(n.title) || "예약한 일";
  }
  return n;
}
async function loadNotices() {
  try {
    // The hub keeps 300 (hub/notices.ts NOTICE_CAP) and lists open decisions, then unread, then newest: reading only 100 left a busy day's
    // reports out of 감시 소식 and the monitors' counts. The lists page what they draw, so the whole set is cheap to hold.
    const m = NT.mut;
    const r = await api("/api/notices?limit=300");
    // A dismiss that landed while this list was on its way makes it stale (it would bring the alert back): read it again.
    if (NT.mut !== m) return loadNotices();
    NT.items = (Array.isArray(r.items) ? r.items : []).map(ntClean);
    NT.unread = r.unread | 0; NT.loaded = true; NT.failed = false; NT.at = Date.now();
    if (Array.isArray(r.gone)) NT.gone = new Set(r.gone);
  } catch { NT.failed = !NT.loaded; }
  ntPaint();
  homeSoon();
  syncInlineChoices();
  snapHomeSoon();
  ntAlertMarks();
}

// 모니터링 opened again soon after: the list (300 notices, about 300 KB) stands; the stream keeps it live and ntSync catches a missed frame.
const NOTICES_FRESH_MS = 60000;
const noticesFresh = () => NT.loaded && Date.now() - NT.at < NOTICES_FRESH_MS;
// /api/state carries notices_unread: a count that disagrees with ours means a frame was missed, so refetch.
function ntSync(s) {
  if (!s || typeof s.notices_unread !== "number" || s.notices_unread === NT.unread) return;
  NT.unread = s.notices_unread; ntPaint(); loadNotices();
}

// A decision answered or dismissed (here, on another device or by the bot): its "답변이 필요해요" toast and this device's notification go at once
// (owner 2026-10-28: a finished item still saying it needs checking is confusing). The hub also takes the notification back on other devices (hub/push.ts).
function ntHandled(id) {
  for (const s of document.querySelectorAll(".snack[data-nid]")) if (s.dataset.nid === String(id)) s.remove();
  closePushTags([`decision:${id}`]);
}
function closePushTags(tags) {
  if (!("serviceWorker" in navigator) || !tags.length) return;
  navigator.serviceWorker.ready.then(r => r.getNotifications()).then(ns => { for (const n of ns) if (tags.includes(n.tag)) n.close(); }).catch(e => console.warn(`notifications not closed: ${e.message}`));
}
function noticeLive(e) {
  if (e.kind === "notice" && e.item && e.item.id != null) {
    ntClean(e.item);
    const i = NT.items.findIndex(x => x.id === e.item.id);
    if (e.item.dismissed) { if (i >= 0) NT.items.splice(i, 1); }
    else if (i < 0) NT.items.push(e.item); else NT.items[i] = e.item;
    if (i < 0 && ntOpenDec(e.item) && NT.loaded && dkFollowOn(e.item)) { /* opened as the next card */ }
    else if (i < 0 && ntOpenDec(e.item) && NT.loaded) {
      toast("답변이 필요해요", false, { label: "열기", onclick: () => noticeOpenId(e.item.id) }, 8000);
      const s = document.querySelector(".snack:last-of-type");
      if (s) s.dataset.nid = String(e.item.id);
    }
    if (!ntOpenDec(e.item) || e.item.dismissed) ntHandled(e.item.id);
    // The dock's row for a card pushed up this conversation (10-decision-card.js dcPointer) follows it; an open sheet is left alone, since a
    // repaint would drop the change it is making (its 받는이 edit) and the sheet's own update path repaints it. Any decision of this conversation:
    // a block of a several-draft card settles without `draft` when its draft is sent from 모니터링, and the docked card drops it here.
    if (ntIsDec(e.item) && e.item.decision.to === target && !DK.h) paintDecision();
    if (e.item.kind === "watch") monitorsLive();
  } else if (e.kind === "notice_dismiss") {
    ntHandled(e.id);
    const g = NT.items.find(x => x.id === e.id);
    if (g && g.at && (g.src || g.open) === "alert") NT.gone.add(g.at);
    NT.items = NT.items.filter(x => x.id !== e.id);
    NT.mut++;
    ntAlertMarks();
  } else if (e.kind === "notice_read") {
    const ids = new Set(e.ids || []);
    for (const n of NT.items) if (ids.has(n.id)) n.read = true;   // the hub names the ids it read (never "all"): what waits on the owner stays unread
  }
  if (typeof e.unread === "number") NT.unread = e.unread;
  ntPaint();
  ntSheetPaint();
  homeSoon();
  syncInlineChoices();
}

async function ntMarkRead(body) {
  try {
    const r = await api("/api/notices/read", "POST", body);
    if (r && typeof r.unread === "number") { NT.unread = r.unread; ntPaint(); }
  } catch (err) { toast(err.message, true); loadNotices(); }
}

/* ---- tap: go to the source message ---- */
// The conversation holding the notice's message (n.src; older items fall back to n.open) is opened on its chat view, older history
// is fetched until the message's time is covered, the message is scrolled to the top of the timeline and flashed. A message the chat does not
// show lands on the nearest one in time. Alert and worklog posts are messages of the 알림 / 작업 기록 conversations. Nothing here ever reports an error.
const ntRaf = () => new Promise(r => requestAnimationFrame(() => r()));
function ntGo(t) {
  if (t === "settings") { go("settings"); return ""; }   // the 새 버전 notice: 설정 → 업데이트
  if (isLaneT(t) && S && !S.lanes.some(l => `lane:${l.name}` === t)) t = MAIN;   // the session is gone: its result card is in the main chat
  if (t !== MAIN && isProjT(t) && S && !projTargets().includes(t)) { toast("이 프로젝트를 찾을 수 없어요"); go("projects"); return ""; }
  if (!validTarget(t)) { toast("이 화면을 찾을 수 없어요"); go("home"); return ""; }
  if (t === "alert") NSC.pass = Date.now() + 1000;   // the one way into the record conversation: a row's source message (#chat/alert alone is the 알림 screen)
  if (current !== "chat" || target !== t || convListing()) go("chat", t);   // already open (a cold start draws the address first): no second draw
  return t;
}
// The rendered message of an event ts (data-ts is set in chatPush): the exact one, else the nearest in time.
function ntFind(at) {
  const want = Date.parse(at);
  let best = null, gap = Infinity;
  for (const m of tl.querySelectorAll("[data-ts]")) {
    if (m.dataset.ts === at) return m;
    const d = Math.abs(Date.parse(m.dataset.ts) - want);
    if (d < gap) { gap = d; best = m; }
  }
  return best;
}
// Older messages, 300 at a time (up to four rounds), until the loaded history reaches back to `at`; a message further back comes in with the page around it
// (GET /api/history?around=, joined by chatMerge as a quote's original is, rpJump). Only a message the gateway no longer holds is left to the caller's toast.
async function ntReach(t, at) {
  const s = ts(t);
  for (let i = 0; i < 4 && s.msgs.length && s.msgs[0].ts > at; i++) {
    let r;
    try { r = await api(`/api/history?target=${enc(t)}&limit=300&before=${enc(s.msgs[0].ts)}`); } catch { return; }
    const add = (r.events || []).filter(e => !s.mk.has(msgKey(e)));
    if (!add.length) return;
    for (const e of add) { s.mk.add(msgKey(e)); s.msgs.push(e); }
    s.msgs.sort(byTs); s.cap += add.length;
    if (isFixedT(t)) dedupKeyed(s);
    if (t === target) renderAll(true);
  }
  if (!s.msgs.length || s.msgs.some(e => e.ts === at)) return;
  try {
    const r = await api(`/api/history?target=${enc(t)}&limit=150&around=${enc(at)}`);
    if (!r.at || t !== target) return;
    chatMerge(s, r);
    renderAll(true);
  } catch (e) { console.warn("history around", e); }
}
// The element that carries the highlight: the card or bubble inside the message when there is one, else the message itself. Anything that paints
// its own fill keeps the glow on its own rounded shape; plain text gets the tint alone ("nt-bar"). ~2s soft fade (a brief still tint under reduced motion: 09-notices.css).
function ntHlHost(node) {
  const card = node.matches(".um") ? node.querySelector(":scope > .ub") : node.matches(".bm, .cmdbox") ? node.querySelector(":scope > .ccard") : null;
  return { host: card || node, bar: !card && /(\d, ){3}0\)$/.test(getComputedStyle(node).backgroundColor) };   // alpha 0: no fill of its own
}
function ntFlash(node) {
  const { host, bar } = ntHlHost(node);
  if (host.classList.contains("nt-hl")) return;   // the first draw lit it and the notice list confirmed it: the glow does not restart
  for (const x of document.querySelectorAll(".nt-hl")) x.classList.remove("nt-hl", "nt-bar");
  void host.offsetWidth;
  host.classList.add("nt-hl");
  host.classList.toggle("nt-bar", bar);
  clearTimeout(host._hl);
  host._hl = setTimeout(() => host.classList.remove("nt-hl", "nt-bar"), 2300);
}
let ntJumpSeq = 0;
let ntKeep = "";   // the session a tapped notice opened: it may end while its report is on screen, and the view then stays (refreshState)
// `quiet`: a sheet is opening over the conversation and says what the notice is about itself, so a message that is gone needs no toast.
async function ntJump(n, quiet = false) {
  const seq = ++ntJumpSeq, at = n.at || n.updated || n.ts, want = n.msg || n.src || n.open || "main";
  // A session this page has not read yet (it began and ended while the page slept) is not gone: ask the gateway before ntGo sends the tap to the main chat.
  if (isLaneT(want) && S && !S.lanes.some(l => `lane:${l.name}` === want)) { await refreshState(); if (seq !== ntJumpSeq) return; }
  const t = ntGo(want);
  if (!t) return "no-conversation";
  if (isLaneT(want) && t === MAIN) { toast("이 세션은 이미 지워졌어요"); return "session-gone"; }   // the main chat has no message of it: say so instead of landing on the nearest one
  chatUnpin();
  ntKeep = isLaneT(t) ? t : "";
  CV.jump = at;   // set after ntGo (a new opening resets it): the opening's first draw lands on this message, not on the "새 메시지" divider (chatOpen)
  try {
    const s = ts(t), stored = s.msgs.some(e => e.ts === at);
    if (!(s.hLoaded && s.aLoaded)) { if (stored) loadTarget(t, true).catch(() => {}); else await loadTarget(t); }   // the message is here: land now, refresh behind it
    await ensureMsg(t, at);   // a stale stream may not have the message yet: fetch it before jumping
    await ntReach(t, at);
    for (let i = 0; i < 300 && seq === ntJumpSeq && !CV.placed; i++) await ntRaf();   // the opening's first draw waits for the read position (chatReady)
    if (seq !== ntJumpSeq || target !== t || current !== "chat") return "moved-on";
    chatShow(at);
    const m = ntFind(at), exact = !!m && m.dataset.ts === at;
    if (m) chatJump(m);
    if (exact) ntFlash(m);
    else {
      if (n.at && !quiet) toast(m ? "그 메시지가 없어서 가까운 곳을 열었어요" : "그 메시지를 찾을 수 없어요");
      return m ? "near-message" : "no-message";   // what a tap on a push reports to the gateway (23-installable-app-web.js pushTapReport)
    }
  } catch {}
}
// The conversation behind a sheet (a decision, an [ask], a failure): the same jump, without one for a question that has no conversation (a login request) or lives on another computer.
const ntUnder = n => { if (!n.pc && validTarget(n.src || n.open || "")) ntJump(n, true); };

// A tapped push: open its notice, or its conversation at the message it is about (loaded first when the stream missed it).
async function pushOpen(hash, at, nid) {
  const p = parseHash(hash), t = p.t || MAIN;
  if (!at || p.view !== "chat") { go(p.view, p.t); return ""; }
  const find = () => (NT.loaded && ntById(nid)) || ntMsgFor(t, at);
  if (!find()) await loadNotices();   // a cold start, or a page that slept through it: the notice decides where this lands (a monitor's row, a failure's sheet)
  const n = find();
  if (!n && t === "alert") { go("notices"); return "no-notice"; }   // no notice behind it: the 알림 screen, not the record conversation
  return noticeOpen(n || { kind: "message", tone: "", src: t, open: t, at });
}

/* ---- one handler for every notice entry point ---- */
// The corner toast, a tapped push, a row of 답변 필요, a row of the 홈 notice cards and a message tapped in the 알림 / 작업내역 conversations all end in
// noticeOpen: the item opens by the kind of thing it links to, never by where it was tapped.
//   sheet    a decision notice (hub/notices.ts kind "decision")           -> its conversation at the asking message, the decision sheet over it
//   ask      an [ask] message whose question still waits                    -> the same, with the sheet while the question waits
//   detail   a failure alert                                                -> the 알림 message, a detail sheet over it
//   session  a session's report                                             -> that session, on the report
//   worklog  a 작업내역 post                                                 -> 작업내역, on that item
//   monitor  a 모니터링 notice (a watch or schedule report)              -> 모니터링, on that report's row in its monitor, app or 감시 소식
//   message  anything else (plain message, result, a mail)                 -> the conversation, on that message
// `here`: tapped on the message itself (the 알림 / 작업내역 timeline), so the sheet opens without moving the list under it.
function noticeKindAction(n, mons = NM.items) {
  if (ntIsDec(n) || ntLinkedDec(n)) return "sheet";
  if (n.tone === "ask") return "ask";
  if (n.kind === "alert" && n.tone === "fail") return "detail";
  if (String(n.src || n.open || "").startsWith("mail:")) return "message";   // a new mail is a watch-kind notice, but it has its own conversation
  if (n.kind === "result" || String(n.src || n.open || "").startsWith("lane:")) return "session";
  if (String(n.src || n.open || "").startsWith("settings:")) return "app";   // a monitor's or app's settings conversation: it lives in 모니터링, not in 채팅
  if ((n.src || n.open) === "settings") return "settings";   // an account / update alert: 설정
  if (n.kind === "worklog") return "worklog";
  if (n.kind === "watch") return "monitor";
  return "message";
}
async function noticeOpen(n, here = false) {
  if (!n) return;
  const a = noticeKindAction(n);
  if (a === "detail" || a === "session" || a === "monitor" || a === "settings" || a === "app") ntRead(n);   // no chat view follows these, so nothing else would mark them seen
  switch (a) {
    case "sheet": {
      const d = ntLinkedDec(n) || n;
      if (!here) ntUnder(d);
      return noticeSheetOpen(n.pc ? n : d.id);   // a peer's question is not in NT: the notice itself
    }
    case "ask":
      if (!here) ntUnder(n);
      if ((await ntAskSheet(n)) || !here) return;
      return ntJump(n);   // answered or gone: the conversation
    case "detail":
      if (!here) ntUnder(n);
      return ntDetailOpen(n);
    case "session": return ntJump(n);
    case "monitor": return monOpen(n);
    case "app": return ntJump(n);   // a monitor's or app's settings conversation opens inside 모니터링 (go)
    case "settings": return void go("settings");
    default: return ntJump(n);
  }
}
// `quiet`: a page load, not a tap, asked (?n=): a stale link just stays on the route it loaded. `hash`, `at`: where its push pointed, the landing when the notice is gone.
async function noticeOpenId(id, quiet, hash, at) {
  let n = ntById(id);
  if (!n) { await loadNotices(); n = ntById(id); }
  if (!n && at) return pushOpen(hash, at, "");
  if (!n) { if (!quiet) toast("이 알림은 이미 처리됐어요"); return "notice-gone"; }
  return noticeOpen(n);
}
function ntRead(n) {
  if (!n.id || n.read || ntNeeds(n) || !ntById(n.id)) return;
  n.read = true; NT.unread = Math.max(0, NT.unread - 1); ntPaint(); homeSoon();
  ntMarkRead({ ids: [n.id] });
}
// The stored notice of a message (its decision first), by conversation and event time; a 작업내역 line of a session is stored under the session, so time alone is the fallback.
const ntMsgFor = (src, at) => NT.items.find(x => ntIsDec(x) && x.decision.to === src && x.decision.reply_to === at)
  || NT.items.find(x => (x.src || x.open) === src && x.at === at) || NT.items.find(x => x.at === at) || null;
// A conversation event (toast, a message of the 알림 / 작업내역 conversations) as a notice: the stored one, else one drawn from the event itself.
function ntOfEvent(e) {
  const own = e.kind === "out" && (e.target === "alert" || e.target === "worklog") ? e.target : "";
  const lane = e.kind === "lane_report" ? String(e.lane || "") : "";
  const src = e.ask && e.target ? e.target : own || (lane ? `lane:${lane}` : e.open || MAIN);
  const real = ntMsgFor(src, e.ts);
  if (real) return real;
  const p = parseTone(noHandoff(peerMsgLine(e.text)), true);
  return { id: "", kind: own === "alert" ? "alert" : own === "worklog" ? "worklog" : lane ? "result" : "message", tone: e.ask ? "ask" : own || lane ? p.tone : "",
    title: e.title || (own === "alert" ? "알림" : own === "worklog" ? "작업 기록" : lane ? `세션 ${lane}` : botName), text: p.text, src, open: src, at: e.ts, ts: e.ts };
}
// A 모니터링 report: its screen, on its own row. MON.want makes the draw reach that row (unfolded, whatever page and group it is in); the draw is synchronous inside
// go(). KakaoTalk and comments draw their own rooms, not report rows, so those land on the app's pane (a report naming a Kakao room opens that room).
async function monOpen(n) {
  const seq = ++ntJumpSeq;
  await Promise.all([NM.loaded || loadMonitors(), INTG.loaded || loadIntegrations()]);
  if (seq !== ntJumpSeq) return;
  const key = monKeyOf(n);
  MON.want = String(n.id || ""); MON.filter = "all"; MON.sig = "";
  go("monitoring", key);
  MON.want = "";
  const it = monItems().find(i => i.key === key);
  if (it && kkItem(it)) { if (n.item && n.item.app === "kakao") kkOpen(n.item.id); return; }
  if (it && cmAppOf(key)) return;
  const row = n.id ? monRowOf(n.id) : null;
  if (!row) { toast("그 소식을 찾을 수 없어요"); return; }
  row.scrollIntoView({ block: "center" });
  ntFlash(row);
  MON.hl = String(n.id); MON.hlUntil = Date.now() + 2300;
}
// A message tapped in the 알림 / 작업내역 conversations opens like its notice does (capture phase: the choice rows inside it do not answer in place there).
// A file row (.fatt, a plain element so its name can be selected: 15-attachments.js fileChipRow) keeps its own job: it opens the file.
timeline.addEventListener("click", ev => {
  if (current !== "chat" || !isFixedT(target) || !(ev.target instanceof Element)) return;
  const m = ev.target.closest(".bm[data-ts]");
  if (!m || !tl.contains(m) || ev.target.closest("a, summary, details[open] pre, input, textarea, button:not(.dcm-row), .fatt") || getSelection().toString()) return;
  const e = ts(target).msgs.find(x => x.ts === m.dataset.ts);
  if (!e) return;
  ev.stopPropagation(); ev.preventDefault();
  noticeOpen(ntOfEvent(e), true);
}, true);

/* ---- the 알림 conversation is the record behind the 알림 screen (31-notices-screen.js): a message of it is reached from a row and has no reading or deleting of its own ---- */
// A notification that arrives while this conversation is open eases in, and a message whose notice was dismissed stays hidden. The first draw, a redraw and older messages loaded above move nothing:
// only a row that was not there and is newer than the newest one drawn before is new.
const NT_SEEN = new Set();
let ntNewest = "";
function ntAlertMarks() {
  if (current !== "chat" || target !== "alert") { NT_SEEN.clear(); NT_SEEN.seeded = false; ntNewest = ""; return; }
  const rows = [...tl.querySelectorAll(":scope > [data-ts]")], fresh = rows.length ? freshKeys(NT_SEEN, rows.map(r => r.dataset.ts)) : new Set(), was = ntNewest;
  for (const r of rows) if (r.dataset.ts > ntNewest) ntNewest = r.dataset.ts;
  for (const row of rows) {
    if (fresh.has(row.dataset.ts) && row.dataset.ts > was && was) motionIn(row, "rise");
    if (NT.gone.has(row.dataset.ts)) { row.hidden = true; continue; }
  }
}
new MutationObserver(ntAlertMarks).observe(tl, { childList: true });

/* ---- decision sheet: the docked decision card (10-decision-card.js) over the current screen ---- */
// Same card and same answer path as the one above the composer, for the conversation the notice came from; no navigation, no scroll.
const DK = { h: null, node: null, box: null, dc: null, seq: 0, timer: 0, nid: "", ign: "" };   // ign: the notice its x (무시) ignores
function dkClose(restore = true) {
  ++DK.seq; clearTimeout(DK.timer); DK.timer = 0;
  if (DK.h) DK.h.close(restore);
}
function dkPaint() {
  if (!DK.node) return;
  let dc = DK.dc;
  if (DK.nid) {   // a draft sheet follows its own notice, whose draft (받는이·참조) may have changed since it opened
    const n = ntById(DK.nid), rv = n ? ntRevising(n) : null;
    if (n && n.decision?.draft) { DK.dc = { ...DK.dc, draft: n.decision.draft }; dc = DK.dc; }
    if (rv) {   // 고치기 was answered: the sheet keeps the old draft with 고치는 중… until the new one lands, then shows that one
      const nx = ntSuccessor(n);
      if (nx && ntOpenDec(nx)) { ntDraftSheet(nx); return; }
      if (nx) { dkClose(false); return; }
      if (!DC.picks[dc.key]) { DC.picks[dc.key] = [rv]; DC.st[dc.key] = "sent"; delete DC.edit[dc.key]; }
    } else if (DC.st[dc.key] !== "undo" && DC.st[dc.key] !== "sending" && (!n || !ntOpenDec(n))) { const answered = !!n && ntIsDec(n) && !ntIgnoredDec(n); dkClose(false); if (answered) dkNext(n); return; }
  } else {
    dc = decisionOf(DK.dc.t);
    if (!dc || dc.sig !== DK.dc.sig) { dkClose(false); return; }   // answered, here or elsewhere
    DK.dc = { ...dc, close: dkClose, ignore: DK.dc.ignore };
  }
  const picks = DC.picks[dc.key] || [], step = DC.step[dc.key] ?? Math.max(0, dc.blocks.findIndex((_, i) => !picks[i]));
  const sig = dcSig(dc, picks, step);
  if (DK.box.dataset.sig !== sig) { DK.box.dataset.key = dc.key; renderDecision(DK.box, DK.dc, picks, step); DK.box.dataset.sig = sig; }
  if (DC.st[dc.key] === "sent" && !DK.timer && !(dc.draft && dcStText(dc, "sent") === "고치는 중…")) DK.timer = setTimeout(() => { dkClose(false); toast("답을 보냈어요"); }, 900);
}
// Several cards in one conversation are answered one after another (2026-10-31: "차례로 보여줘야지", "마지막 카드 어디?"): once a draft card
// is answered, the next open draft card of the same conversation opens in its place, at once when it is already there, else when it
// arrives within DK_FOLLOW_MS (the bot posts it in its answer turn, or the hub's queue posts the next held one).
const DK_FOLLOW_MS = 3 * 60000;
let dkFollow = null;   // { to, until }
function dkNext(n) {
  const nx = ntDecisions().filter(x => x.id !== n.id && x.decision.draft && x.decision.to === n.decision.to).sort((a, b) => ntAt(a) - ntAt(b))[0];
  if (nx) { toast("답을 보냈어요 · 다음 카드예요"); ntDraftSheet(nx); return; }
  dkFollow = { to: n.decision.to, until: Date.now() + DK_FOLLOW_MS };
  toast(draftIsLast(n.text) ? "답을 보냈어요 · 마지막 카드였어요" : "답을 보냈어요");
}
// A new open draft card in the conversation whose card was just answered: it opens unless another sheet is up. True when it opened.
function dkFollowOn(item) {
  const f = dkFollow;
  if (!f || Date.now() > f.until || !item.decision.draft || item.decision.to !== f.to || DK.h || NS.h) return false;
  dkFollow = null;
  ntDraftSheet(item);
  return true;
}
function dkOpen(dc, draft, nid, ign) {
  dkClose(false);
  DK.nid = nid || "";
  const waits = !!ign && !!ign.id && ntNeeds(ign);
  DK.ign = waits ? String(ign.id) : "";
  DK.dc = { ...dc, close: dkClose, draft: draft || null, ignore: waits ? () => ntIgnore(ign) : null };
  const h = fsOpen({ label: draft ? "보낼 내용 확인" : "결정이 필요해요", cls: draft ? (draft.toLabel === "받는이" ? "mid rq-sheet" : "tall") : "", onClose: () => { if (DK.h === h) { DK.h = DK.node = DK.box = DK.dc = null; DK.nid = DK.ign = ""; } } });
  DK.h = h; DK.node = h.node; DK.box = h.box;
  dkPaint();   // the card itself holds the focus, not a row: a focus ring on the first option would read as a pick
}
// Opens the sheet for an [ask] notice whose question still waits in its conversation; false when it does not (answered, gone): the caller jumps.
async function ntAskSheet(n) {
  const t = n.src || n.open || "main", at = n.at || n.updated || n.ts, seq = ++DK.seq;
  if (!validTarget(t)) return false;
  try {
    if (!(ts(t).hLoaded && ts(t).aLoaded)) await loadTarget(t);
    await ensureMsg(t, at);
  } catch { return false; }
  if (seq !== DK.seq) return true;   // another tap or a close came meanwhile
  const dc = decisionOf(t);
  if (!dc || !dc.blocks.length || (n.at && dc.at && dc.at !== n.at)) return false;
  dkOpen(dc, null, "", n);
  return true;
}
// A draft waiting for send approval (hub/draft-approval.ts): the same sheet, built from the notice itself, with the draft above the three choices.
function ntDraftSheet(n) {
  // Many waiting cards of this one's kind: it opens in 빠른 처리 (30-triage.js), unless a row asked for its 고치기 field.
  const tg = n.decision.draft && n.decision.draft.ref && !DC.edit[`dk:${n.id}`] ? trGroupFor(n.decision.draft.ref) : null;
  if (tg) { trOpen(tg.key, n.decision.draft.ref); return; }
  const d = n.decision;
  dkOpen({ key: `dk:${n.id}`, t: d.to, sig: `dk:${n.id}`, at: d.reply_to || n.at || "", question: "", blocks: [{ title: n.title, options: d.options }], left: draftProgress(n.text) }, d.draft, String(n.id), n);
}
// An entry that comes from a session names its parent project and status, in the words of sessionRow.
function ntLaneNote(n) {
  const name = typeof n.key === "string" && n.key.startsWith("lane:") ? n.key.slice(5) : "", l = name && S && S.lanes.find(x => x.name === name);
  return l ? `${laneProject(l) || "프로젝트 없음"} · ${sessionStatus(l)[0]}` : "";
}

/* ---------- decisions: a question that waits on the owner ---------- */
// Hub: kind "decision" notices (hub/notices.ts) carry decision = { options, to, reply_to, group, state, answer }. An open one stays unread and
// shown on 홈 and cannot be dismissed; tapping it opens a sheet with the whole text and one button per option. A
// button posts /api/notices/:id/answer: the hub sends the answer to the chat, session or login request the question came from.
const ntIsDec = n => n.kind === "decision" && !!n.decision;
const ntOpenDec = n => ntIsDec(n) && n.decision.state === "open";
// A draft whose 고치기 was answered: its 고치기 option, until the new draft of the same conversation arrives (the successor).
const ntRevising = n => {
  if (!ntIsDec(n) || !n.decision.draft || n.decision.state !== "answered") return null;
  const m = /^\s*(\d+)\)/.exec(String(n.decision.answer || "")), o = m && n.decision.options.find(x => x.n === Number(m[1]));
  return o && o.label === DRAFT_EDIT ? o : null;
};
const ntSuccessor = n => (n.pc ? (((PQ.list.find(p => p && p.url === n.pc.url) || {}).items || {}).notices || []) : NT.items).find(x => x.id !== n.id && ntIsDec(x) && x.decision.draft && x.decision.to === n.decision.to && String(x.ts) > String(n.ts)) || null;
// Waits on the owner's action: an open decision or an [ask] item (the alert / message twin of one), unread and not ignored. Same rule as
// hub/notices.ts needsAnswer, which keeps these unread however they are viewed: only an answer, a resolving signal or the x (무시) clears them.
const ntNeeds = n => !n.read && !n.ignored && !n.dismissed && (ntOpenDec(n) || n.tone === "ask");
const ntIgnoredDec = n => ntIsDec(n) && n.decision.state === "ignored";
// The open decision a notice carries or links to: itself, or the one asked in the same conversation at the same time (the [ask] alert twin the hub
// stores beside it), or the newest one of the conversation for that conversation's latest-message item (key msg:<conversation>).
const ntLinkedDec = n => {
  if (ntOpenDec(n)) return n;
  const t = n.src || n.open;
  return NT.items.find(d => ntOpenDec(d) && d.decision.to === t && n.at && d.decision.reply_to === n.at)
    || (n.kind === "message" && n.key === `msg:${t}` ? ntDecisions().find(d => d.decision.to === t) : null) || null;
};
const ntById = id => NT.items.find(x => String(x.id) === String(id));
// A watch report that folded earlier ones into its repeats (hub/notices.ts) is its own line again for 모니터링's report lists and counts: nothing it recorded is lost.
const ntWithRepeats = list => list.flatMap(n => n.kind === "watch" && n.repeats && n.repeats.length ? [n, ...n.repeats.map((r, i) => ({ ...n, id: `${n.id}~${i}`, text: r.text, ts: r.at, updated: r.at, repeats: undefined, read: true }))] : [n]);
const ntDecisions = () => NT.items.filter(ntOpenDec).sort((a, b) => ntAt(b) - ntAt(a));
// Loose [ask] notices: waiting on the owner, but not carrying (or linked to) an open decision, so ntDecisions() never lists them.
const ntLooseAsks = () => NT.items.filter(n => ntNeeds(n) && !ntOpenDec(n) && !ntLinkedDec(n)).sort((a, b) => ntAt(b) - ntAt(a));
const ntHasDecision = t => NT.items.some(n => ntOpenDec(n) && n.decision.to === t);
// pc: the computer a peer's notice came from (n.pc), so its main chat reads that gateway's bot name (08-home.js pcTargetName).
const ntDecWhere = (d, pc) => d.to.startsWith("auth:") ? "로그인 요청" : pcTargetName(d.to, pc);
// What a question is about: the project of the session that asks, then the session (or the place it was asked).
function ntDecCtx(n) {
  const d = n.decision, l = !n.pc && d.to.startsWith("lane:") && S && S.lanes.find(x => `lane:${x.name}` === d.to), proj = l ? laneProject(l) : "";
  return [proj, ntDecWhere(d, n.pc)].filter(Boolean).join(" · ");
}
function ntApply(item, unread) {
  if (item) { const i = NT.items.findIndex(x => x.id === item.id); if (i >= 0) NT.items[i] = item; else NT.items.push(item); }
  if (typeof unread === "number") NT.unread = unread;
  ntPaint();
  ntSheetPaint();
  dkPaint();
  homeSoon();
  syncInlineChoices();
}
// Throws with the hub's reason when the answer could not be delivered.
// `files` (uploads, 10-decision-card.js uploadFile) go with a draft's 직접 수정 answer to the bot; a peer's question takes none.
// `label` is the button text the owner saw for `num` (default: the option of that number on the card as shown); the hub refuses it when the card's options changed since,
// and the list is read again so the new options show (the error is thrown to the caller's toast like any other).
const NT_STALE = "카드 선택지가 바뀌었어요. 다시 확인하고 골라 주세요";
async function ntPost(n, num, note, files, label) {
  const seen = label || ((n.decision && n.decision.options || []).find(o => o.n === num) || {}).label;
  try {
    if (n.pc) { await pqNotice(n, "answer", { id: String(n.id), n: num, ...(seen ? { label: seen } : {}), ...(note ? { note } : {}) }); return; }   // a peer's question: answered on that computer (34-peer-monitoring.js)
    const r = await api(`/api/notices/${enc(n.id)}/answer`, "POST", { n: num, ...(seen ? { label: seen } : {}), ...(note ? { note } : {}), ...(files && files.length ? { files } : {}) });
    ntApply(r.item, r.unread);
    return r.send;   // set while the gateway holds the send for its cancel window (hub/approval-send.ts)
  } catch (e) {
    if (e && e.message === NT_STALE) await loadNotices();
    throw e;
  }
}
// The open decision that is this chat card's question (a card with one block), so the card and the notice answer through the same path.
function ntFor(t, at, opt) {
  return NT.items.find(n => ntOpenDec(n) && n.decision.to === t && n.decision.group === 1 && n.decision.reply_to === at && n.decision.options.some(o => o.n === opt.n && o.label === opt.label)) || null;
}

// The x (무시) on a question that waits: off the badge and 답변 필요, kept in the history as 무시함, nothing is sent to the bot. The toast undoes it.
async function ntIgnore(n) {
  if (!n || !n.id || !ntNeeds(n)) return;
  const id = String(n.id);
  try {
    if (n.pc) await pqNotice(n, "notice", { op: "ignore", id });
    else {
      const r = await api(`/api/notices/${enc(id)}/ignore`, "POST", {});
      await Promise.all([...document.querySelectorAll(`.hr[data-nid="${CSS.escape(id)}"]`)].map(row => motionOut(row)));   // the ignored row leaves (150ms) before the lists redraw
      ntApply(r.item, r.unread);
      if (r.ids && r.ids.length > 1) loadNotices();   // its alert / message twins changed too; their live frames follow, the refetch makes sure
    }
  } catch (err) { toast(err.message, true); return; }
  if (NS.node && NS.id === id) ntSheetClose(false);
  if (DK.node && DK.ign === id) dkClose(false);
  toast("무시했어요", false, { label: "되돌리기", onclick: () => ntUnignore(id, n) }, 6000);
}
async function ntUnignore(id, n) {
  try {
    if (n && n.pc) await pqNotice(n, "notice", { op: "unignore", id: String(id) });
    else {
      const r = await api(`/api/notices/${enc(id)}/unignore`, "POST", {});
      ntApply(r.item, r.unread);
      if (r.ids && r.ids.length > 1) loadNotices();
    }
    toast("다시 답변 필요로 돌렸어요");
  } catch (err) { toast(err.message, true); }
}
// The 44px x of a row. It stops the click and key events so the row behind it does not open.
function ntIgnoreBtn(n) {
  return el("button", { type: "button", class: "ib nt-x", title: "무시", "aria-label": `${ntPlain(n.title) || "알림"} 무시`,
    onclick: ev => { ev.stopPropagation(); ntIgnore(n); }, onkeydown: ev => ev.stopPropagation() }, icon("close"));
}

// A watch alert's "<what> 89,000원 → 72,000원" line drawn like the 가격 알림 card of the landing page: the old value grey and struck, the new one bold.
// The characters stay exactly as the watch wrote them (only wrapped in <s> / <em>); a line of another shape is not matched and renders as before.
const NW_CHANGE = /^(.*?)(\d[\d,.]*\s?[^\d\s→>-]{0,3}) → (\d[\d,.]*\s?[^\d\s→>-]{0,3})$/;
const nwChangeLine = text => String(text || "").split("\n").map(l => l.replace(/^\s*[-*•]\s+/, "").trim()).find(l => NW_CHANGE.test(l)) || "";
function nwChangeNode(line) {
  const m = NW_CHANGE.exec(String(line || "").trim());
  return m ? el("span", { class: "nw-chg" }, m[1], el("s", { text: m[2] }), " → ", el("em", { text: m[3] })) : null;
}
// One row of the home card 답변 필요 (same markup as 08-home.js homeNowRow): tap = the detail sheet, x = ignore.
// `label` "" is a row that no longer waits (the 알림 tabs, 31-conversations.js bellPaint): no 답변 필요, no x.
// An 알림 tab row (`label` "") ends with a tag when the notice has a state worth a tag (a failure, a warning) and its time, as the prototype's notice
// row does; the tab already names the kind, so a plain notice shows only the time. Its second line is the place only.
const NT_TONE_TAG = { fail: ["실패", "err"], warn: ["주의", "warn"] };
function ntEndNode(n) {
  const k = NT_TONE_TAG[n.tone];
  return el("span", { class: "nt-end" }, k ? el("span", { class: `tag ${k[1]}`, text: k[0] }) : null, el("span", { class: "nt-time", text: ntWhen(n) }));
}
function ntHomeRow(n, label = "답변 필요") {
  const title = n.decision ? ntPlain(n.title) : hcLine(n), src = n.src || n.open, chg = n.kind === "watch" ? nwChangeNode(nwChangeLine(n.text)) : null;   // a loose [ask] notice has no decision: its conversation names where it waits
  // A watch change is the landing page's 가격 알림 row: a 32px round icon tile, the title, the change line under it, the time at the right.
  const lead = chg ? el("span", { class: `nt-wi${n.read ? "" : " new"}`, "aria-hidden": "true" }, icon("bell")) : el("span", { class: label ? "dot att" : `dot${n.read ? "" : n.cls === "alert" ? " err" : " un"}` });
  return el("div", { class: `hr hrx${chg ? " nt-w" : ""}${n.read ? "" : " un"}`, "data-nid": n.id },
    el("button", { class: "hrx-m", type: "button", onclick: () => noticeOpen(n), "aria-label": label ? `${title} · ${label}` : title },
      lead,
      el("span", { class: "hb" }, el("span", { class: "hn1" }, el("span", { class: "nm", text: title })), el("span", { class: "ha" }, ...(chg ? [chg] : [[n.decision ? ntDecCtx(n) : ntLaneNote(n) || (src ? pcTargetName(src, n.pc) : "알림"), label === "" && !chg ? "" : ntWhen(n)].filter(Boolean).join(" · ")]))),
      chg ? el("span", { class: "nt-wt", text: ntWhen(n) }) : null,
      label === "" && !chg ? ntEndNode(n) : null,
      label ? el("span", { class: "hs warn", text: label }) : null),
    label ? ntIgnoreBtn(n) : null);
}

/* ---- detail sheet ---- */
const NS = { id: "", det: null, h: null, node: null, busy: false, edit: null, pn: null, stash: new Map() };   // pn: a peer's notice (it is not in NT; drawn from the snapshot, 34-peer-monitoring.js)   // edit: { id, opt, text, fresh } while the owner writes the detail an option asks for   // det: a notice shown read-only (a failure alert), not looked up by id
function ntSheetClose(restore = true) { if (NS.h) NS.h.close(restore); }
// "직접 답하기": to the asking message in its chat (a login request: its own form), where the composer quotes that message as the answer to this question:
// what the owner writes next carries the question's id and settles it (hub/notices-store.ts ownerReplied). A send approval stays a plain jump.
async function ntDirect(n) {
  ntSheetClose(false);
  if (n.pc) { const t = n.decision.to; if (pqPc(t)) go("monitoring", `c:${t}`); else toast(`${n.pc.name}에서 답해 주세요`); return; }   // a peer's question: its conversation as this page shows it
  if (n.decision.to.startsWith("auth:")) { AUTH_HID.clear(); paintAuth(true); const f = document.querySelector(".au input"); if (f) { f.scrollIntoView({ block: "center" }); f.focus(); } else toast("입력 창이 이미 닫혔어요"); return; }
  if (await ntJump(n) !== undefined || n.decision.draft || n.decision.state !== "open") return;
  const m = ntFind(n.at);
  if (m && m.dataset.ts === n.at && RP.src.has(m)) rpStart(m, String(n.id));
}
// Same rule as the hub (hub/notices.ts answerDecision): an option that needs detail is answered only with the owner's text.
const ntNeedsNote = (n, o) => !o.say && !o.action && (n.decision.draft ? draftAsksText(o) : detailOf(o));
async function ntAnswer(n, opt, note) {
  if (opt.action === "form") { ntDirect(n); return; }
  if (!note && ntNeedsNote(n, opt)) { NS.edit = { id: String(n.id), opt, text: "", fresh: true }; ntSheetPaint(); return; }
  NS.busy = true; ntSheetPaint();
  let sent = false;
  try { await ntPost(n, opt.n, note, undefined, opt.label); NS.edit = null; sent = true; }
  catch (err) { toast(err.message, true); }
  NS.busy = false;
  if (sent && NS.id === String(n.id) && ntAfterAnswer(n)) return;
  ntSheetPaint();
}
// The questions one message asked (same conversation, same asking message), in the order they were made; a lone question has none to move between.
function ntSibs(n) {
  const d = n.decision;
  if (n.pc || d.draft || !(d.group > 1) || !d.reply_to) return [];
  const all = NT.items.filter(x => ntIsDec(x) && !x.decision.draft && x.decision.to === d.to && x.decision.reply_to === d.reply_to && x.decision.group === d.group);
  return all.length > 1 ? all : [];
}
// The question that waits next after `n` (then the ones before it), or null.
function ntNextOpen(n) {
  const all = ntSibs(n), at = all.findIndex(x => x.id === n.id);
  return [...all.slice(at + 1), ...all.slice(0, Math.max(at, 0))].find(x => x.id !== n.id && ntOpenDec(x)) || null;
}
// Shows another question of the same message in the open sheet; what was typed or picked in the one left stays for when it is back.
function ntSheetGo(id) {
  if (NS.edit) NS.stash.set(NS.edit.id, NS.edit);
  NS.id = String(id); NS.edit = NS.stash.get(NS.id) || null; NS.stash.delete(NS.id); NS.pn = null;
  NS.h.box.dataset.sig = "";
  ntSheetPaint();
  const b = $(".fs-body", NS.h.box); if (b) b.scrollTop = 0;
  NS.h.box.focus({ preventScroll: true });   // the sheet holds the focus, not an option: a ring on the first one would read as a pick
}
// After an answer: a question of a several-question message moves the sheet to the next one that waits, the last one closes it. False for a lone question (its sheet shows the answer).
function ntAfterAnswer(n) {
  if (!ntSibs(n).length) return false;
  const nx = ntNextOpen(n);
  if (nx) { toast("답을 보냈어요 · 다음 질문이에요"); ntSheetGo(nx.id); }
  else { ntSheetClose(); toast("답을 보냈어요"); }
  return true;
}
function ntEditNode(n, ed) {
  const drf = !!n.decision.draft, dt = draftNoteText(ed.opt);
  const ta = el("textarea", { class: "dc-note", rows: "3", maxlength: "500", placeholder: drf ? dt.hint : "이유나 내용을 적어 주세요", "aria-label": drf ? dt.aria : "자세한 내용", disabled: NS.busy, oninput: () => { ed.text = ta.value; go.disabled = !ta.value.trim(); } });
  ta.value = ed.text;
  const go = el("button", { class: "dc-go", type: "button", "data-k": "send", disabled: NS.busy || !ta.value.trim(), onclick: () => { const note = ta.value.trim(); if (note) ntAnswer(n, ed.opt, note); } }, noteGoLabel(ed.opt, drf, false));
  const back = el("button", { class: "dc-back", type: "button", "data-k": "back", disabled: NS.busy, onclick: () => { NS.edit = null; ntSheetPaint(); } }, "돌아가기");
  return el("div", { class: "dc-edit" }, el("div", { class: "dc-ctx" }, el("span", { class: "dc-key", text: String(ed.opt.n) }), el("span", { class: "dc-lb", text: drf ? dt.ask : ed.opt.label })), ta, el("div", { class: "dc-eb" }, back, go));
}
// A notice sheet's body: the text without its `[file]` lines, then those files as the same image / file chips a chat message shows (15-attachments.js).
function ntBody(n, text) {
  const fl = fileLines(text == null ? n.text : text);
  return answerParts({ text: ntCode(noticeKo(fl.text, NK)), files: fl.files }, { cls: "md ds-md", lead: false });
}
// Ids, hashes and paths in the body read as `code` (they wrap anywhere); text already in backticks stays as it is.
function ntCode(text) {
  return String(text).split(/(`[^`]*`)/).map((s, i) => i % 2 ? s : s.replace(/(?<![\w:/.@(-])[\w.-]+\/[\w./-]*\w|\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g, m => `\`${m}\``)).join("");
}
// The first sentence of a line, 60 characters at most (cut at a word boundary with "…"), without its closing period (hub/notice-title.ts).
function ntShort(line, max = 60) {
  const one = String(line).replace(/\s+/g, " ").trim();
  const base = (/^.*?[.!?。？！](?=\s|$)/.exec(one) || [one])[0].replace(/[.。]+$/, "");
  if (base.length <= max) return base;
  const cut = base.slice(0, max), sp = cut.lastIndexOf(" ");
  return `${(sp > max / 2 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}
// A notice sheet's title is one short line and its body the rest. A title that is not the text's own first sentence (a question, a block title)
// keeps the whole text as the body; a first sentence that had to be cut stays in the body in full.
function ntParts(n) {
  const text = stripMarkers(noticeKo(peerMsgLine(n.text), { ...NK, keepFiles: true }), true).replace(/^\s*\[[^\]\n]{1,10}\][ \t]*/, "").trim(), title0 = ntPlain(n.title);
  const first = (text.split("\n").find(l => l.trim()) || "").trim();
  const m = /^.*?[.!?。？！](?=\s|$)/.exec(first), sent = m ? m[0] : first;
  const head = ntShort(sent.replace(/[*`#>]|(?<![A-Za-z0-9])_|_(?![A-Za-z0-9])/g, "")), a = head.replace(/…$/, ""), b = title0.replace(/…$/, "");
  if (!title0 || !a || !(a.startsWith(b) || b.startsWith(a))) return { title: ntShort(title0), rest: text };
  return { title: head, rest: head.endsWith("…") ? text : text.replace(sent, "").trim() };
}
// A failure alert: its whole text in the same sheet over the current screen, with the way into the conversation.
function ntDetailOpen(n) {
  ntSheetClose(false);
  ntSheetShow(String(n.id || ""), n);
}
function ntDetailPaint(n) {
  clear(NS.h.box).append(
    fsHead([el("span", { class: "fs-ey err", text: "문제가 생겼어요" })], { close: () => ntSheetClose() }),
    el("div", { class: "fs-body" },
      el("h2", { class: "ds-t", id: "ds-t", text: ntPlain(n.title) || "알림" }),
      el("div", { class: "ds-m", text: ntWhen(n) }),
      ...ntBody(n)),
    el("div", { class: "fs-ft" },
      el("button", { type: "button", class: "ds-direct", "data-k": "go", onclick: () => { ntSheetClose(false); ntJump(n); }, text: "대화에서 보기" }),
      el("button", { type: "button", class: "ds-opt rec c", "data-k": "close", onclick: () => ntSheetClose(), text: "닫기" })));
}
function ntSheetPaint() {
  if (!NS.node) return;
  if (NS.det) { ntDetailPaint(NS.det); return; }
  const n = NS.pn ? pqNoticeNow(NS.pn) : ntById(NS.id);
  if (!n || !ntIsDec(n)) { ntSheetClose(false); return; }
  const d = n.decision, open = d.state === "open", ignd = d.state === "ignored", parts = ntParts(n), sibs = ntSibs(n), keep = NS.node.contains(document.activeElement) ? document.activeElement.dataset.k : "";
  const kids = [
    fsHead([el("span", { class: `fs-ey ${open ? "warn" : ignd ? "ign" : "done"}`, text: `${ntDecCtx(n)} · ${open ? "답변 필요" : ignd ? "무시함" : d.expired ? "기한 지남" : d.resolved ? "해결됨" : "답변함"}` }, sibs.length ? el("span", { class: "fs-left", "data-k": "count", text: ` · ${sibs.findIndex(x => x.id === n.id) + 1}/${d.group}` }) : null)],
      { ignore: open ? () => ntIgnore(n) : null, ignoreOff: NS.busy, close: () => ntSheetClose() }),
    el("div", { class: "fs-body" },
      el("h2", { class: "ds-t", id: "ds-t", text: parts.title || "답변이 필요해요" }),
      el("div", { class: "ds-m", text: ntWhen(n) }),
      // The buttons show the options; a "결정:" line that only repeats the title goes too.
      ...ntBody(n, d.options.length && !d.draft ? choiceBody(parts.rest, ntPlain(n.title)) : parts.rest))];
  const foot = el("div", { class: "fs-ft" }), ed = open && NS.edit && NS.edit.id === String(n.id) ? NS.edit : null;
  // Every notice event repaints the open sheet; one that changes nothing it shows leaves it alone, so the reason field being typed in is not
  // replaced (a new field takes the focus and a phone closes and reopens its keyboard).
  const sig = JSON.stringify([n.title, n.text, d, ntWhen(n), NS.busy, ed ? ed.opt.n : 0, sibs.map(x => [x.id, x.decision.state])]);
  if (NS.h.box.dataset.sig === sig) return;
  NS.h.box.dataset.sig = sig;
  const hadNote = !!NS.node.querySelector(".dc-note:focus");
  if (ed) foot.append(ntEditNode(n, ed));
  else if (open) {
    for (const o of d.options) foot.append(el("button", { type: "button", class: "ds-opt", "data-k": `o${o.n}`, disabled: NS.busy, onclick: () => ntAnswer(n, o) },
      el("span", { class: "ds-lb" }, o.label),
      o.desc ? el("span", { class: "ds-ds", text: o.desc }) : null));
    foot.append(el("button", { type: "button", class: "ds-direct", "data-k": "direct", disabled: NS.busy, onclick: () => ntDirect(n), text: d.to.startsWith("auth:") ? "입력 창으로 가기" : "직접 답하기" }));
    const nx = ntNextOpen(n);
    if (nx) foot.append(el("button", { type: "button", class: "ds-direct", "data-k": "next", disabled: NS.busy, onclick: () => ntSheetGo(nx.id), text: "다음 질문 보기" }));
    if (NS.busy) foot.append(el("div", { class: "ds-st", role: "status", text: "보내는 중…" }));
  } else if (ignd) {
    foot.append(el("div", { class: "ds-res", role: "status" }, el("span", { class: "ds-rl ign", text: "무시했어요" }), el("span", { class: "ds-ra", text: "답하지 않고 넘겼어요" })));
    foot.append(el("button", { type: "button", class: "ds-direct", "data-k": "undo", onclick: () => ntUnignore(n.id, n), text: "되돌리기" }));
    if (!d.to.startsWith("auth:")) foot.append(el("button", { type: "button", class: "ds-direct", "data-k": "go", onclick: () => { ntSheetClose(false); ntJump(n); }, text: "대화에서 보기" }));
    foot.append(el("button", { type: "button", class: "ds-opt rec c", "data-k": "close", onclick: () => ntSheetClose(), text: "닫기" }));
  } else {
    foot.append(el("div", { class: "ds-res", role: "status" }, el("span", { class: "ds-rl", text: d.expired ? "기한 지남" : d.resolved ? "답 없이 끝났어요" : "이렇게 답했어요" }), el("span", { class: "ds-ra", text: d.expired ? "답할 시간이 지나 닫혔어요" : d.resolved ? "일이 끝나서 닫혔어요" : ntPlain(d.answer || "") || "답했어요" })));
    if (!d.to.startsWith("auth:")) foot.append(el("button", { type: "button", class: "ds-direct", "data-k": "go", onclick: () => { ntSheetClose(false); ntJump(n); }, text: "대화에서 보기" }));
    foot.append(el("button", { type: "button", class: "ds-opt rec c", "data-k": "close", onclick: () => ntSheetClose(), text: "닫기" }));
  }
  kids.push(foot);
  const box = NS.h.box, top = $(".fs-body", box) ? $(".fs-body", box).scrollTop : 0;
  if (!paintKeep(box, kids, ntSheetPaint)) return;
  $(".fs-body", box).scrollTop = top;
  const again = keep ? box.querySelector(`[data-k="${keep}"]`) : null;
  if (again) again.focus({ preventScroll: true });
  const ta = ed ? box.querySelector(".dc-note") : null;
  if (ta && (ed.fresh || hadNote)) { ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); ed.fresh = false; }
}
// `id` is a notice id, or a peer's notice itself (n.pc): that one is not in NT and is answered on its computer.
async function noticeSheetOpen(id) {
  const pn = id && typeof id === "object" && id.pc ? id : null;
  let n = pn ? pqNoticeNow(pn) : ntById(id);
  if (!n && !pn) { await loadNotices(); n = ntById(id); }
  if (!n || !ntIsDec(n)) { toast("이 알림은 이미 처리됐어요"); return; }
  if (NS.node && NS.id === String(n.id) && !NS.pn === !pn) return;
  ntSheetClose(false);
  if (!pn && n.decision.draft && n.decision.state === "open") { ntDraftSheet(n); return; }
  ntSheetShow(String(n.id), null, pn);
}
function ntSheetShow(id, det, pn = null) {
  NS.id = id; NS.det = det; NS.pn = pn; NS.busy = false;
  const h = fsOpen({ labelledby: "ds-t", onClose: () => { if (NS.h === h) { NS.h = NS.node = null; NS.id = ""; NS.det = null; NS.edit = null; NS.pn = null; NS.stash.clear(); } } });
  NS.h = h; NS.node = h.node;
  ntSheetPaint();   // fsOpen already put the focus on the sheet itself: no option shows a ring until the keyboard moves to it
}

// A tapped notification (or an option button on it) asks an open window to show the decision; a cold start carries it as ?n=<id>.
if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", ev => { const d = ev.data || {}; if (d.notice) { pushTapGot(ev); ovCloseAll(); noticeOpenId(d.notice, false, new URL(d.open, location.href).hash, d.ts).then(r => pushTapReport(d.tap, r), () => pushTapReport(d.tap, "error")); } });
{
  const want = PUSH_FOLLOW ? "" : new URLSearchParams(location.search).get("n") || "";   // a relayed notice's ?n names an item on the other computer (prFollow)
  if (want) {
    const u = new URL(location.href);
    u.searchParams.delete("n");
    history.replaceState(history.state, "", u.pathname + u.search + u.hash);
    setTimeout(() => pushTapCold(noticeOpenId(want, true, PUSH_HASH, pushDecisionAt)), 500);
  }
}

ntPaint();
loadNotices();
