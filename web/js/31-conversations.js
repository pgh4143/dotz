/* ---------- 채팅: the chat list (KakaoTalk-style) and the read position (Discord-style) ---------- */
// Data: GET /api/conversations (hub/conversations.ts) gives every conversation's newest real message, the owner's read position
// and the unread count; POST /api/read moves the position forward and every device hears {kind:"read"} on the event stream.
// ts(t).unread (the counter the switcher and the nav already use) is that server count, kept current by convNote.
// CONV: target -> { ts, text, from } | null, READ: target -> ISO read position | null (state is declared in 09-needs-you.js).
const CONV_KINDS = new Set(["message", "lane_message", "out", "lane_report", "result", "mail", "schedule", "watch"]);

// A message the conversation shows (same rule as hub/conversations.ts isRealMessage), and one that can be unread: not the owner's own, no restart note.
// A post edited in place (update_key) is a message only in 알림 / 작업 기록; elsewhere it is a progress note.
const convKeyedOk = e => e.update_key !== "progress" && isFixedT(eventTarget(e) || "");
const convReal = e => CONV_KINDS.has(e.kind) && !(e.kind === "out" && e.update_key && !convKeyedOk(e));
// A gateway system line (`system`, 11-todo-strip.js sysLine) is a status, never unread (hub/conversations.ts countIncoming).
const convIncoming = e => convReal(e) && !OWNER.has(e.kind) && !cleanRestart(e) && !e.system;

// Same rule as hub/conversations.ts previewOf: the first meaningful lines, plain text. convPreview: the first, 120 chars.
function previewLines(raw, max) {
  const text = plainTable(noticeKo(parseTone(previewSrc(raw)).text, NK)), out = [];
  let fence = false;
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const plain = line.replace(/^\s*-#\s+/, "").replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, "").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_~`]+/g, "").replace(/\s+/g, " ").trim();
    if (plain && out.push(plain) >= max) break;
  }
  return out;
}
function convPreview(raw) {
  const [plain = ""] = previewLines(raw, 1);
  return plain.length > 120 ? `${plain.slice(0, 119)}…` : plain;
}
function convLastOf(e) {
  if (!convReal(e) || typeof e.ts !== "string") return null;
  const title = e.card && typeof e.card.title === "string" ? e.card.title : "";
  const text = convPreview(e.text) || convPreview(title) || (Array.isArray(e.files) && e.files.length ? "파일" : "");
  if (!text) return null;
  const from = e.kind === "message" || e.kind === "lane_message" ? "owner" : e.kind === "lane_report" || (typeof e.source === "string" && e.source.startsWith("lane:")) ? "session" : "bot";
  return { ts: e.ts, text, from };
}

// An ended session never counts unread (server rule: hub/conversations.ts unreadOf); a lane the state does not list yet is live.
const convEnded = t => { const l = isLaneT(t) && ((S && S.lanes) || []).find(x => `lane:${x.name}` === t); return !!l && !laneAlive(l); };
// A live message (called by ingestMsg once per new event): moves the row's preview and, unless the owner is looking at that
// conversation's bottom right now, adds to its unread count (server rule: hub/conversations.ts).
function convNote(e, t, was) {
  if (isMailT(t) && e.kind === "mail" && !MAILS.has(t)) MAILS.set(t, { subject: e.subject || "", from: e.from || "", source: e.source || "", at: e.ts, summary: e.summary || "", ...(e.todo ? { todo: e.todo } : {}), ...(e.questions ? { questions: e.questions } : {}), preview: e.preview || "", attachments: e.attachments || [], html: !!e.html });
  const last = convLastOf(e);
  if (!last) return;
  const prev = CONV.get(t);
  if (!prev || prev.ts <= last.ts) CONV.set(t, last);
  // `was`: the older version of an edited post, still unread = this one is the same unread message (counted once, like the hub does)
  const again = !!was && !(READ[t] && READ[t] >= was.ts);
  if (convIncoming(e) && !again && !convEnded(t) && !(READ[t] && READ[t] >= e.ts) && !(CV.key === t && chatStick && document.visibilityState === "visible")) { ts(t).unread++; renderBars(); }
  convSchedule();
}
// A mail the hub listed before and no longer does was deleted (on another device, or by the mailbox's own sync): it leaves this page too, and a view
// of it goes back to the list instead of answering "이 메일을 찾지 못했어요" on the next tap. A mail that only arrived live, or another computer's, is not touched.
// The list comes a page of mails at a time (hub/conversations-page.ts): CVP.next is the cursor of the older ones (empty = all loaded), CVP.counts the hub's
// counts over every mail, from the first page. A refresh of the first page only judges the mails inside its range; the older ones stay as loaded.
const CVP = { next: "", more: false, counts: null, busy: null };
let convHadMail = new Set();
const convInRange = (t, cursor) => {
  if (!cursor) return true;
  const at = cursor.indexOf("|"), ts0 = cursor.slice(0, at), last = CONV.get(t), ts1 = last ? last.ts : "";
  return ts1 > ts0 || (ts1 === ts0 && t <= cursor.slice(at + 1));
};
function convDropGone(items, cursor, whole) {
  const now = new Set(items.filter(it => it.mail).map(it => it.target)), gone = [...convHadMail].filter(t => !now.has(t) && !PQ.of.has(t) && (whole ? true : convInRange(t, cursor)));
  convHadMail = whole ? now : new Set([...convHadMail].filter(t => !gone.includes(t)).concat([...now]));
  if (!gone.length) return;
  for (const t of gone) { MAILS.delete(t); CONV.delete(t); MBOX.sel.delete(t); ts(t).unread = 0; }
  if (current === "chat" && gone.includes(target)) go("monitoring", MON.sel || "i:mail");
  mbRefresh();
}
// One load at a time: a call that comes while one runs makes it read again once it ends, and both callers get the same promise.
let convFlight = null, convAgain = false;
function convLoad() {
  if (convFlight) { convAgain = true; return convFlight; }
  convFlight = (async () => { do { convAgain = false; await convLoadNow(); } while (convAgain); })().finally(() => { convFlight = null; });
  return convFlight;
}
// A live event (one per mail) refreshes through this: the first runs at once; events during the load or the next LIVE_GAP ms collapse into one trailing run.
let LIVE_GAP = 2000;
function coalesced(fn) {
  let busy = false, queued = false;
  const run = async () => {
    busy = true; queued = false;
    try { await fn(); } finally { setTimeout(() => { busy = false; if (queued) run(); }, LIVE_GAP); }
  };
  const live = () => { if (busy) queued = true; else run(); };
  live.busy = () => busy;
  return live;
}
const mailLive = coalesced(() => Promise.allSettled([convLoad(), loadIntegrations()]));
const monitorsLive = coalesced(() => loadMonitors());
// The rows of one answer into the stores.
function convApply(items) {
  for (const it of items) {
    const t = it.target, prev = CONV.get(t);
    if (it.mail) MAILS.set(t, it.mail);
    if (it.last && (!prev || prev.ts <= it.last.ts)) CONV.set(t, it.last);
    else if (!CONV.has(t)) CONV.set(t, null);
    let unread = it.unread | 0;
    const local = READ[t], last = CONV.get(t);
    // Our own read post may be ahead of what the server has answered with.
    if (local && (!it.read || local > it.read)) { if (last && last.ts <= local) unread = 0; }
    else READ[t] = it.read || null;
    ts(t).unread = unread;
  }
}
async function convLoadNow() {
  clearTimeout(convRetry);
  try {
    const r = await api("/api/conversations"), items = r.items || [], pg = r.page;
    convApply(items);
    if (r.counts) CVP.counts = r.counts;
    // Keep the cursor of the furthest page loaded; a refresh of the first page must not walk it back.
    if (!pg || !pg.more) { CVP.more = false; CVP.next = ""; }
    else if (!CVP.next || !CVP.more) { CVP.more = true; CVP.next = pg.next; }
    convDropGone(items, pg && pg.more ? pg.next : "", !pg || !pg.more);
    await convPin(CV.key || (typeof monCtx === "string" ? monCtx : ""));
    CV.loaded = true; CV.failed = false;
    renderBars();
    if (convCapture() || (CV.key && !CV.placed)) renderAll();   // the first paint of an opening waits for this (chatReady)
    convMaybeRead();
  } catch {
    convRetry = setTimeout(convLoad, 5000);
    CV.failed = true;
    if (CV.key && !CV.placed) renderAll();
  }
  convSchedule();
}
// A mail that is open but older than the pages loaded: asked for by its key, so its header and thread draw (hub: GET /api/conversations?target=).
async function convPin(t) {
  if (!CVP.more || !t || !isMailT(t) || MAILS.has(t)) return;
  try {
    const r = await api(`/api/conversations?target=${encodeURIComponent(t)}`);
    convApply(r.items || []);
    for (const it of r.items || []) if (it.mail) convHadMail.add(it.target);
  } catch { /* the mail just draws without its header */ }
}
// The next page of mails (older ones), when the hub says there are more. The mail list asks for it as the owner scrolls to its end; one at a time.
function convMore() {
  if (!CVP.more || !CVP.next) return Promise.resolve();
  if (CVP.busy) return CVP.busy;
  const from = CVP.next;
  CVP.busy = (async () => {
    try {
      const r = await api(`/api/conversations?before=${encodeURIComponent(from)}`), items = r.items || [];
      convApply(items);
      for (const it of items) if (it.mail) convHadMail.add(it.target);
      const pg = r.page || {};
      CVP.more = !!pg.more; CVP.next = pg.more ? pg.next : "";
      renderBars();
    } catch { /* the sentinel asks again at the next scroll */ }
  })().finally(() => { CVP.busy = null; });
  return CVP.busy;
}
// Another device (or this one) moved a read position.
function convOnRead(e) {
  const t = e.target, at = e.ts;
  if (typeof t !== "string" || typeof at !== "string" || (READ[t] && READ[t] >= at)) return;
  READ[t] = at;
  const last = CONV.get(t);
  if (last && last.ts <= at) { ts(t).unread = 0; renderBars(); }
  else { clearTimeout(convReadT); convReadT = setTimeout(convLoad, 300); }
}

/* ---- read position of the open conversation ---- */
// Which conversation is on screen right now, and what was already read when it was opened: the "새 메시지" divider goes before the
// first unread message of that moment and stays until the owner leaves. A mail without a divider opens at its top, not at the bottom. Opening again after reading shows no divider.
function convSync() {
  const key = current === "chat" && !convListing() ? target : "";
  if (key === CV.key) return false;
  chatUnpin(); clearTimeout(CV.gateT);
  Object.assign(CV, { key, div: "", divNode: null, jump: "", seeded: false, captured: false, failed: false, placed: false, full: false, snap: null, openAt: performance.now() });
  convCapture();
  return !!key;   // the caller draws the conversation: the divider is in it from the first paint
}
function convCapture() {
  if (!CV.key || CV.captured || !CV.loaded) return false;
  CV.captured = true;
  const at = READ[CV.key];
  if (!at || !(ts(CV.key).unread > 0)) return false;   // never opened before: nothing to compare with
  CV.div = at;
  if (CV.seeded) CV.placed = false;
  return true;
}
const convDivider = () => el("div", { class: "cv-new", role: "separator", "aria-label": "여기부터 읽지 않은 메시지" }, el("span", { text: "여기까지 읽음" }));
/* ---- where the timeline sits while an opening settles ---- */
// The first paint of an opening needs three answers: the history, the read position (/api/conversations, which decides the divider)
// and the todo plan (its strip pushes the timeline down). Until then "불러오는 중…" stays, so nothing is drawn at the wrong place
// first. A slow answer cannot hold it forever: the plan gives up after 0.7 s, the read position after 3 s (no divider then).
function chatReady() {
  if (!CV.key || CV.jump || CV.seeded) return true;   // a jump lands on its message and a stored copy (13-snapshot.js) shows at once: the plan's strip re-places them (chatPlace), a divider re-opens it (convCapture)
  const age = performance.now() - CV.openAt, convOk = CV.loaded || CV.failed || age > 3000, todoOk = TD.by[target] !== undefined || age > 700;
  if (convOk && todoOk) return true;
  clearTimeout(CV.gateT);
  CV.gateT = setTimeout(() => { if (CV.key && !CV.placed) renderAll(); }, Math.max(30, (todoOk ? 3000 : 700) - age));
  return false;
}
// After the timeline is drawn (renderAll0): the first drawing of an opening anchors the view to the divider (or the bottom when nothing is
// unread) in the same task, before any paint; later drawings keep the owner's place.
function chatOpen() {
  const snap = CV.snap; CV.snap = null;
  CV.full = true;
  if (!CV.key) { scrollChat(true); return; }
  if (!CV.placed) {
    CV.placed = true;
    if (CV.jump) {   // a jump target wins over the divider (ntJump)
      const m = ntFind(CV.jump);
      if (m) { chatJump(m); if (m.dataset.ts === CV.jump) ntFlash(m); return; }
      chatUnpin(); scrollChat(true); return;
    }
    // reloaded onto a new shell (23-installable-app-web.js): the place the owner was at, unless they were at the bottom
    const r = SHELL_RESTORE;
    if (r && r.key === CV.key && !r.stick && r.anchor) { SHELL_RESTORE = null; CV.pinTs = r.anchor.ts; CV.pinOff = r.anchor.off; chatPin("at"); return; }
    chatPin(CV.divNode ? "div" : isMailT(CV.key) ? "top" : "bottom");   // a mail reads top-down: the first unread, else the start of the mail
    return;
  }
  if (CV.pin) chatPlace();
  else if (snap && !snap.stick) { timeline.scrollTop = snap.top; chatStick = timeline.scrollTop + timeline.clientHeight >= timeline.scrollHeight - 40; $("#chat-jump").hidden = chatStick; }
  else scrollChat(true);
}
// A jump target (notice, toast, push, 답변 필요, ?m=) sits with its top just under the app bar, wherever the divider is, and stays there while
// images and code blocks settle (the pin re-places it before paint) until the owner touches the timeline.
function chatJump(node) {
  const a = timeline.getBoundingClientRect(), bar = $("#appbar").getBoundingClientRect();
  CV.pinTs = node.dataset.ts; CV.pinOff = Math.max(0, bar.bottom - a.top) + 20;
  chatPin("at");
}
function chatPin(kind) { CV.pin = kind; chatPlace(); }
function chatUnpin() { CV.pin = ""; }
// Put the view where the pin says. Runs right after the draw and again whenever the timeline or its content changes size (images,
// code blocks, the todo strip, the composer growing) - a ResizeObserver runs after layout and before paint, so no shift is ever shown.
function chatPlace() {
  if (!CV.pin || !timeline.clientHeight) return;   // the view is hidden: the observer places it once it shows
  let want = timeline.scrollHeight;
  if (CV.pin === "top") want = 0;
  else if (CV.pin === "div") {
    if (!CV.divNode || !CV.divNode.isConnected) return;
    want = timeline.scrollTop + CV.divNode.getBoundingClientRect().top - timeline.getBoundingClientRect().top - 12;
  } else if (CV.pin === "at") {   // a message found again by its ts (the timeline is redrawn, so no node is held), at its old distance from the top
    const n = [...tl.querySelectorAll("[data-ts]")].find(m => m.dataset.ts === CV.pinTs);
    if (n) want = timeline.scrollTop + n.getBoundingClientRect().top - timeline.getBoundingClientRect().top - CV.pinOff;   // gone from the history: the bottom
  }
  if (Math.abs(timeline.scrollTop - want) > 1) timeline.scrollTop = want;
  chatStick = timeline.scrollTop + timeline.clientHeight >= timeline.scrollHeight - 40;
  $("#chat-jump").hidden = chatStick;
  convMaybeRead();   // what this placement put on screen is read now
}
new ResizeObserver(chatPlace).observe(timeline);
// The timeline's own box changes when the composer grows a line, the todo strip or the keyboard resizes the page. A view that sat at the
// bottom stays there (one write, before paint); any other view keeps its scrollTop, so what the owner reads never moves while typing.
let followH = 0;
new ResizeObserver(() => {
  const h = timeline.clientHeight, grew = followH && h !== followH;
  followH = h;
  if (grew && !CV.pin && chatStick && timeline.scrollHeight - timeline.scrollTop - h > 1) timeline.scrollTop = timeline.scrollHeight;
}).observe(timeline);
new ResizeObserver(chatPlace).observe(tl);
// The owner takes over by touching the timeline: the anchor lets go, the normal stick-to-bottom rules apply from there.
for (const ev of ["wheel", "touchstart", "pointerdown", "keydown"]) timeline.addEventListener(ev, chatUnpin, { passive: true });

// The open conversation counts as read (page visible): a chat up to the last message whose bottom edge is on screen (owner 2026-10-31: "들어가서
// 해당 메시지 하단까지 내 화면에 보이면 숫자 사라지게"), a mail as soon as it is on screen. It runs whenever what is on screen can change - the opening's
// placement, a scroll, the timeline or its content changing size (a new message, an image or card loading, a resize), the page showing again -
// so no scroll is ever needed, and nothing waits for the view to hold still. A mail opens at its top and reads top-down (chatOpen), so waiting
// for the bottom left a long mail unread however it was read (owner 2026-10-27); its unread is dotz's own read position (hub/reads.ts), never
// the real mailbox's flag, so a newer message of that mail still makes it unread again.
function convMaybeRead() {
  const t = CV.key;
  if (!t || t !== target || isRelayT(t) || !CV.placed || document.visibilityState !== "visible") return;
  const mail = isMailT(t);
  if (!mail && !CV.captured) return;
  const s = ts(t), last = s.hLoaded && s.msgs.findLast(convReal);
  if (!last) return;
  if (READ[t] && READ[t] >= last.ts) { if (s.unread) { s.unread = 0; renderBars(); if (mail) mailReadPainted(); } return; }
  const at = mail ? last.ts : convSeenTs(last.ts);
  if (!at || (READ[t] && READ[t] >= at)) return;
  READ[t] = at;
  s.unread = at >= last.ts ? 0 : Math.min(s.unread, s.msgs.filter(e => e.ts > at && convIncoming(e)).length);   // the hub recounts it on the next load
  convPend.set(t, at);
  if (!convPendT) convPendT = setTimeout(convFlush, 150);
  renderBars();
  if (mail) mailReadPainted();
}
// A mail read on the page moves its row, the app's badge and the 안 읽음 filter now; once the hub holds the position its app counts raise
// (needs.unread, GET /api/integrations), and a peer's mail has its snapshot read again (34-peer-monitoring.js).
function mailReadPainted() { const m = MAILS.get(CV.key); if (m && m.read === false) m.read = true; MON.sig = ""; monSchedule(); }
function mailReadSynced(t) { if (typeof pqPc === "function" && pqPc(t)) pqSoon(); else loadIntegrations(); }
function convFlush() {
  convPendT = 0;
  for (const [t, at] of convPend) api("/api/read", "POST", { target: t, ts: at }).then(() => { if (isMailT(t)) mailReadSynced(t); }, () => { if (READ[t] === at) READ[t] = null; convLoad(); });
  convPend.clear();
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { convMaybeRead(); convLoad(); } });
// The newest drawn message whose bottom edge is inside the timeline's visible box (never past `newest`), "" when none is. Walks from the end, so
// it measures only the few messages at the bottom of the view.
function convSeenTs(newest) {
  if (!timeline.clientHeight) return "";
  const bottom = timeline.getBoundingClientRect().bottom + 1, nodes = tl.querySelectorAll("[data-ts]");
  for (let i = nodes.length - 1; i >= 0; i--) {
    const r = nodes[i].getBoundingClientRect();
    if (r.height && r.bottom <= bottom) return nodes[i].dataset.ts > newest ? newest : nodes[i].dataset.ts;
  }
  return "";
}
// A layout change can bring a message's bottom on screen without a scroll (content settling after the pin let go, the window growing): one
// check per frame, after layout.
function convReadSoon() { if (!convReadF) convReadF = requestAnimationFrame(() => { convReadF = 0; convMaybeRead(); }); }
const convReadRO = new ResizeObserver(convReadSoon);
convReadRO.observe(timeline); convReadRO.observe(tl);

// Which conversation this page shows ("" = hidden or not a chat), so the hub keeps that conversation's answers out of the notices (POST /api/viewing).
// Sent when it changes and every 20 s while it stays (the hub counts a report older than 60 s as gone).
const VIEW = { id: Math.random().toString(36).slice(2) + Date.now().toString(36), sent: "", at: 0 };
function viewReport(unload) {
  const conv = !unload && document.visibilityState === "visible" && current === "chat" ? target : "";
  if (conv === VIEW.sent && (!conv || Date.now() - VIEW.at < 20000)) return;
  VIEW.sent = conv; VIEW.at = Date.now();
  if (unload) fetch("/api/viewing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: VIEW.id, conv }), keepalive: true }).catch(() => {});
  else api("/api/viewing", "POST", { id: VIEW.id, conv }).catch(() => { VIEW.sent = "?"; });
}
document.addEventListener("visibilitychange", () => viewReport());
addEventListener("pagehide", () => viewReport(true));
setInterval(viewReport, 2000);

/* ---- the list ---- */
// The main assistant and 작업내역 on top, then 진행 중 while a session runs or waits on the owner (sessionsNow, the 홈 card's own list; no header when none does),
// the projects by their newest message (silent ones after, in project order). A session out of 진행 중 keeps a row only while it is open or still
// has something unread or asked; the ended ones fold into one group after that, and the mails and rooms that wait on the owner close the list. 모니터링 has its
// own tab (30-monitoring.js) and uses this same row.
function convRows() {
  const at = t => (CONV.get(t) || {}).ts || "";
  const projects = projTargets().map((t, i) => ({ t, i })).sort((a, b) => at(b.t).localeCompare(at(a.t)) || a.i - b.i).map(x => x.t);
  const mk = t => { const last = CONV.get(t) || null; return { t, last, name: targetName(t), hint: last ? convPreview(last.text) : "", unread: ts(t).unread, need: convNeeds(t) }; };
  const all = (S && S.lanes) || [];
  const { wait, run } = sessionsNow(), now = [...wait, ...run];
  const sess = l => { const t = `lane:${l.name}`; const m = mk(t); const badge = sessionState(l); return { ...m, badge, dotOnly: badge === SESSION_WORD.run, hint: convPreview(l.lastText) || m.hint || homeRunLine(t) }; };
  // A card per group, and last the 메일 · 카카오톡 card of what waits there.
  const projs = projects.map(mk), page = projs.filter((r, i) => i < CVF.more || r.t === target);
  const out = [MAIN, "worklog"].map(mk);
  if (now.length) out.push({ header: "진행 중", sec: true }, ...now.map(l => ({ ...sess(l), name: sessionHead(l) })), { split: true });
  if (page.length) out.push({ header: "프로젝트", sec: true }, ...page);
  if (projs.length > page.length) out.push({ more: projs.length - page.length });
  const listed = new Set(now);
  out.push(...all.filter(l => { const t = `lane:${l.name}`; return !listed.has(l) && (t === target || (laneAlive(l) && (ts(t).unread || convNeeds(t)))); }).map(sess));
  const ended = endedLanes();
  if (ended.length) out.push({ ended: true, key: `${ended.map(l => { const m = endedMark(l); return `${l.name}:${m.unread}:${m.need ? 1 : 0}`; }).join("|")}|${endedOpen}` });
  const waits = convWaiting();
  if (waits.length) out.push({ header: "메일 · 카카오톡", sec: true }, ...waits);
  out.push({ read: true });
  return out;
}
// The 메일 · 카카오톡 card: this computer's mails with a draft or a reply owed and the watched rooms that owe one, newest first; a tap opens them in 모니터링.
function convWaiting() {
  const letter = name => el("span", { class: "cv-av", "aria-hidden": "true", text: [...String(name || "?").trim()][0] || "?" });
  const mails = [...MAILS].filter(([t, m]) => !PQ.of.has(t) && m.dir !== "out" && !m.archived && (m.reply === "draft" || m.unreplied)).map(([t, m]) => {
    const who = mailSender(m.from), owed = !!m.unreplied;
    return { at: Date.parse(m.at) || 0, k: `w:${t}`, name: m.subject || "(제목 없음)", hint: m.reply === "draft" ? `${who} · 답장 초안이 기다려요` : who, last: { ts: m.at }, bold: mailUnread(t, m), need: true, sel: current === "chat" && target === t, av: letter(who), chips: owed ? [["미답장", "unreplied"]] : undefined, open: () => paneRowOpen("chat", t) || go("monitoring", `c:${t}`) };
  });
  const rooms = KK.rooms.filter(r => r.watched && r.unreplied).map(r => ({ at: r.lastAt || 0, k: `w:kk:${r.chatId}`, name: r.name, hint: kkSubLine(r), last: r.lastAt ? { ts: new Date(r.lastAt).toISOString() } : null, bold: r.unread > 0, need: true, av: letter(r.name), chips: [["미답장", "unreplied"]], open: () => { if (paneRowOpen("app", paneKkT(r.chatId))) return; go("monitoring", "i:kakao"); kkOpen(r.chatId); } }));
  return [...mails, ...rooms].sort((a, b) => b.at - a.at).slice(0, 5);
}
// Rows in their cards: a section label stands on the page, every run of rows between them is one card.
function convCards(rows) {
  const nodes = [];
  let box = null;
  for (const r of rows) {
    if (r.read) { const b = convReadBtn(); if (b) nodes.push(b); continue; }
    if (r.split) { box = null; continue; }
    if (r.header) { nodes.push(el("div", { class: "cv-sec", role: "presentation", text: r.header })); box = null; continue; }
    if (!box) nodes.push(box = el("div", { class: "cv-card" }));
    box.append(convRow(r));
    if (r.more) box = null; // 더 보기 is its card's last line: rows after it start their own card
  }
  return nodes;
}
// The two fixed rows alone cannot tell a list still loading, or one that failed, from a settled one: the line under them says which (never both, never before the first load).
const cvState = () => CV.loaded ? null : CV.failed ? emptyNode("대화 목록을 불러오지 못했어요", () => convLoad()) : emptyNode("불러오는 중…");
const FIXED_DESC = { alert: "경고와 결정 요청", worklog: "야간 정리와 세션 진행 기록" };

/* ---- a long list: a page of projects, 읽음 처리 ---- */
// more: projects drawn (CVF_PAGE more per 더 보기). What waits on an answer is on the 알림 screen's 처리할 것.
const CVF_PAGE = 40;
const CVF = { more: CVF_PAGE };
// A conversation waits on the owner: an open decision asked there, a loose [ask] notice of it, or a session's question (same rules as 30-notices.js ntNeeds).
// the same rule as the home 답변 필요 list: a gateway question it handles itself (nyHandled) is news there, not a need here
const convNeeds = t => ntHasDecision(t) || NT.items.some(n => ntNeeds(n) && !nyHandled(n) && (n.src || n.open) === t) || !!(isLaneT(t) && targetInfo(t).ask);
const convListed = () => [MAIN, "worklog", ...((S && S.lanes) || []).filter(laneAlive).map(l => `lane:${l.name}`), ...projTargets()];
// 읽음 처리, under the list: it takes only what needs no answer, so a conversation waiting on the owner keeps its unread.
function convReadBtn() {
  const fyi = convListed().filter(t => ts(t).unread > 0 && !convNeeds(t) && CONV.get(t));
  return fyi.length ? el("div", { class: "cv-foot" }, el("button", { class: "btn text cv-read", type: "button", "data-k": "read", title: "답이 필요한 대화는 그대로 둬요", onclick: ev => convReadAll(ev.currentTarget, fyi), text: `${fyi.length}개 읽음 처리` })) : null;
}
// The listed conversations are read up to their newest message here at once and on the hub (POST /api/read, one per conversation); a failure
// re-reads the counts from the hub and says why (busy toasts it).
const convReadAll = (btn, list) => busy(btn, async () => {
  const was = list.map(t => [t, READ[t], ts(t).unread]);
  for (const t of list) { READ[t] = CONV.get(t).ts; ts(t).unread = 0; }
  renderBars(); convSig = ""; convSchedule();
  const res = await Promise.allSettled(list.map(t => api("/api/read", "POST", { target: t, ts: READ[t] })));
  const bad = res.filter(r => r.status === "rejected");
  if (bad.length) {
    for (const [t, r, u] of was) if (res[list.indexOf(t)].status === "rejected") { READ[t] = r; ts(t).unread = u; }
    renderBars(); convSig = ""; convSchedule(); convLoad();
    throw new Error(`${bad.length}개를 읽음으로 표시하지 못했어요: ${bad[0].reason.message}`);
  }
  toast(`대화 ${list.length}개를 읽음으로 표시했어요`);
});
// Every row has an icon, never a letter (so any name reads the same): the app's own mark for the main assistant, a bell / list for the fixed
// feeds, the folder the 프로젝트 tab uses for a project, the session icon for a session.
function convAvatar(t) {
  if (isFixedT(t)) return el("span", { class: "cv-av nt", "aria-hidden": "true" }, icon(t === "alert" ? "bell" : "list"));
  return el("span", { class: "cv-av", "aria-hidden": "true" }, t === MAIN ? el("span", { class: "logo" }) : icon(isLaneT(t) ? "lanes" : isProjT(t) ? "projects" : "chat"));
}
// The one list row of 채팅, 프로젝트 and 모니터링. A chat target (r.t) opens its conversation; r.open / r.sel / r.av let another list say what a tap opens,
// which row is open and which icon it wears. A row is { header } for a group label, { ended } for the folded ended sessions, or
// { name, badge: [word, tone], unread }, with an optional one-line preview (hint) under the name. A row never shows a time: the name and the content tell what it is.
function convRow(r) {
  if (r.header) return el("div", { class: "cv-gh", role: "presentation", text: r.header });
  if (r.empty) return el("div", { class: "cv-empty", text: r.empty });
  if (r.more) return moreRow(`프로젝트 ${r.more}개 더 보기`, () => { CVF.more += CVF_PAGE; convSig = ""; convSchedule(); });
  if (r.ended) return endedGroup() || "";
  const sel = r.sel !== undefined ? r.sel : r.t === target && current === "chat";
  // 채팅 목록은 시제품의 채팅 행 (proto .li): 아이콘, 제목·미리보기, 오른쪽에 시각과 대기 표시. 모니터링 목록은 시각 없이 그대로예요.
  const when = !monCtx && r.last && r.last.ts ? prjAgo(Date.parse(r.last.ts)) : "";
  return el("button", { class: `cv-row${r.sub ? " sub" : ""}${r.hint ? " pv" : ""}${r.unread || r.bold ? " unread" : ""}${sel ? " on" : ""}${r.last || r.hint ? "" : " none"}`, type: "button", "data-t": r.t || null, "data-k": r.k || null, "aria-current": sel ? "true" : null, onclick: r.open || (() => go("chat", r.t)) },
    r.av || convAvatar(r.t),
    el("span", { class: "cv-b" }, el("span", { class: "cv-n", title: r.name, text: r.name }), r.hint ? el("span", { class: "cv-p", text: r.hint }) : null),
    el("span", { class: "cv-m" }, when ? el("span", { class: "cv-t", text: when }) : null, el("span", { class: "cv-m2" }, r.need && !r.chips && !r.k ? el("span", { class: "dot warn", role: "img", "aria-label": "답변 필요" }) : null, ...(r.chips || []).map(c => el("span", { class: `tag ${c[1]}`, text: c[0] })), cntSpan(`cv-row:${r.t || r.k || r.name}`, "nb", r.unread, { "aria-label": `읽지 않은 메시지 ${r.unread}개` }), r.unreplied ? unrepCount(r.unreplied) : null, r.badge ? (r.dotOnly ? el("span", { class: `dot ${r.badge[1]}`, role: "img", "aria-label": r.badge[0] }) : el("span", { class: `tag ${r.badge[1]}`, text: r.badge[0] })) : null)));
}
const convSide = el("aside", { id: "chat-convo", class: "cv-side", "aria-label": "채팅 목록" });
// Wide screens: the name and state of the open conversation above its timeline (phones put the name in the app bar).
const convHead = el("div", { id: "cv-head", class: "cv-head" });
$("#v-chat").prepend(convSide, convHead);
// Over a monitor's conversation (monChatTopNodes in 30-monitoring.js).
const monChatTop = el("div", { id: "mon-chat-top", class: "mon-chat-top", hidden: true });
convHead.after(monChatTop);

function convPaintHead() {
  asSync();
  if (isProjT(target) && !PRJ && !PRJ_FAIL) prjLoad().then(convSchedule);
  const i = targetInfo(target), state = isRelayT(target) ? RELAY.note[target] || "" : isFixedT(target) ? FIXED_DESC[target] : isMailT(target) ? mailSender((MAILS.get(target) || {}).from) || "메일" : isSettingsT(target) ? "말로 설정을 바꾸고 적용을 눌러요" : targetState(target)[0], k = monCtx && !isSettingsT(target) ? monItemOf(target) : "", app = k ? monSettingsApp(monItems().find(x => x.key === k)) : "", sig = `${target}|${targetName(target)}|${state}|${monCtx ? pqSelf() : ""}|${!!pjMenuOn()}|${app}|${!!AS.by[app]}|${monCtx ? MON.sel : ""}`;
  if (sig === convHeadSig) return;
  convHeadSig = sig;
  // 시제품의 대화 머리 (proto .cv-hd): 제목 16/22 600 한 줄, 그 아래 상태 한 줄, 오른쪽에 그 대화의 동작.
  const acts = [isLaneT(target) ? cvMenuBtn() : null, pjMenuOn() ? pmMenuButton(() => pmOfTarget(target), "cvmenu") : null, isSettingsT(target) ? asMoreBtn(settingsApp(target)) : null, ...asEntry(app)].filter(Boolean);
  // 모니터링에서 연 대화(메일·설정)는 그 목록의 머리 그대로 아바타와 이름·상태 줄을 둬요.
  if (monCtx) clear(convHead).append(...[convAvatar(target), el("span", { class: "cv-b" }, el("span", { class: "cv-n" }, targetName(target), pqLabel({ pc: pqPc(target) })), el("span", { class: "cv-p", text: state })), ...acts].filter(Boolean));
  else clear(convHead).append(...[el("span", { class: "cv-hd-b" }, el("span", { class: "cv-hd-t", title: targetName(target) }, targetName(target)), el("span", { class: "cv-hd-s", text: state })),
    acts.length ? el("span", { class: "cv-hd-a" }, ...acts) : null].filter(Boolean));
}
// A project's conversation gets the project page's ⋯ menu (수정 / 삭제, built by pmMenuButton in 19-project-main.js) once the project is known.
const pjMenuOn = () => isProjT(target) && !!pmOfTarget(target);
// A session's actions (stop, restart, model) are the home card's ⋯ menu (08-home.js homeMenu), here in the conversation's header: in the head on wide screens, in the app bar on a phone.
const cvMenuBtn = () => el("button", { class: "ib cvmenu", type: "button", "aria-label": "세션 메뉴", title: "세션 메뉴", "aria-haspopup": "listbox", "aria-expanded": "false", onclick: ev => homeMenu(ev.currentTarget, target, true) }, icon("more"));
const cvAppMenu = cvMenuBtn();
cvAppMenu.id = "cvmenu"; cvAppMenu.hidden = true;
$("#vtog").before(cvAppMenu);
const pjAppMenu = pmMenuButton(() => pmOfTarget(target), "cvmenu");
pjAppMenu.id = "pjmenu"; pjAppMenu.hidden = true;
cvAppMenu.before(pjAppMenu);
function convPaint() {
  convRaf = 0;
  if (current !== "chat") return;
  convTitle();
  mailSentPaint();
  mbReplyPaint();
  if (monCtx && isSettingsT(target)) MON.sel = monItemOf(target) || MON.sel;   // the monitor list may have loaded after this conversation opened
  const items = monCtx ? monItems() : null, rows = items ? monListRows(items, items.find(i => i.key === MON.sel) || null) : convRows(), sig = JSON.stringify([rows.map(r => [r.t, r.k, r.key, r.name, r.last, r.unread, r.badge, r.dotOnly, r.header, r.hint, r.sel, r.need, r.more, r.empty]), target, current, !!monCtx, CV.loaded, CV.failed]);
  if (!monCtx && !KK.loaded && !KK.asked && typeof INTG !== "undefined" && INTG.items.some(i => i.key === "kakao")) { KK.asked = true; kkLoadRooms(); }
  if (sig !== convSig) {
    convSig = sig;
    convSide.setAttribute("aria-label", monCtx ? "모니터링 목록" : "채팅 목록");
    // 진행 중 grows and shrinks under 작업내역: a list read further down stays where it is when a session starts or ends, held by where 진행 중 (or, without it, 작업내역) ends.
    // Measured in fractions and rounded once at the end: offsetTop rounds each place and scrollTop truncates, which moved the list by a pixel or more.
    const end = () => { const n = ([...convSide.querySelectorAll(".cv-sec")].find(s => s.textContent === "진행 중") || {}).nextElementSibling || convSide.querySelector('.cv-row[data-t="worklog"]'); return n ? n.getBoundingClientRect().bottom + convSide.scrollTop : 0; };
    const top = convSide.scrollTop, was = end();
    // A conversation opened from 모니터링 keeps 모니터링's own panel (sections, cards, bars: 30-monitoring.js), never the chat list's rows.
    clear(convSide).append(...(monCtx ? monSideNodes(rows) : [...convCards(rows), cvState()].filter(Boolean)));
    if (monCtx) monDecorateRows(convSide, items);
    convSide.scrollTop = top && Math.round(top + end() - was);
  }
  convSide.classList.toggle("mon-side", !!monCtx);
  $("#v-chat").classList.toggle("mon-ctx", !!monCtx);
  const mit = items ? monChatIt(items) : null, topSig = mit ? JSON.stringify([mit.key, mit.msig, mit.unread]) : "";
  $("#v-chat").classList.toggle("mon-two", !!mit);
  monChatTop.hidden = !mit;
  if (topSig !== monChatTop.dataset.sig) { monChatTop.dataset.sig = topSig; clear(monChatTop); if (mit) monChatTop.append(...monChatTopNodes(mit).filter(Boolean)); }
  $("#v-chat").classList.toggle("no-composer", target === "alert");
  convPaintHead();
  paneHeads();
}
function convSchedule() { if (!convRaf) convRaf = requestAnimationFrame(convPaint); }

/* ---- app bar ---- */
// Phone, inside a conversation: back arrow to the list and the conversation's name as the title.
function convOnPhone() { return current === "chat" && narrowChat() && !chatList; }
function convTitle() {
  if (current === "chat") $("#title").textContent = convOnPhone() ? targetName(target) : monCtx ? titles.monitoring : titles.chat;
  else if (current === "monitoring") $("#title").textContent = monConv() && narrowChat() ? monName() : titles.monitoring;
  if (current === "monitoring") $("#back .bk-l").textContent = monConv() && (MON.sel === RQ_KEY || MX.it) ? monName() : titles.monitoring;   // 답장 대기 has no item head: the bar names it (the prototype's ‹ 대기함)
  const tag = (current === "chat" && monCtx && convOnPhone()) || (monConv() && narrowChat()) ? pqLabel(monItems().find(i => i.key === MON.sel)) : null;
  if (tag) $("#title").replaceChildren(el("span", { class: "ttx", text: $("#title").textContent }), tag);
  cvAppMenu.hidden = !(convOnPhone() && isLaneT(target));
  pjAppMenu.hidden = !(convOnPhone() && pjMenuOn());
  if (asBar) asBarSync(narrowChat() ? monDetailApp() : "");
  if (asMoreBar) asMoreSync(convOnPhone() && isSettingsT(target) ? settingsApp(target) : narrowChat() ? monDetailApp() : "");
}
function convChrome() {
  const conv = convOnPhone() || (monConv() && narrowChat()), back = !!backTarget() || conv, bar = $("#appbar"), up = !narrowChat() && (monConv() || (!!monCtx && current === "chat"));
  $("#back").hidden = !back;
  // Inside an app on a wide screen the bar's back button reads ‹ 모니터링 in the title's place; the app's own name stands in its head.
  $("#back").classList.toggle("mon-up", up);
  $("#back").setAttribute("aria-label", up ? (MX.it && MX.scr ? "메일 목록으로" : "모니터링 목록으로") : "뒤로");
  bar.classList.toggle("back", back);
  bar.classList.toggle("cvconv", conv);
  bar.classList.toggle("mon-in", narrowChat() && (monConv() || (!!monCtx && current === "chat")));   // an app, a mail or a room of 모니터링 on a phone: no usage ring, the title gets the room (20-monitoring.css)
  $("#v-chat").classList.toggle("cv-listing", convListing());
  const listing = current === "monitoring" && MON.list, was = $("#v-monitoring").classList.contains("cv-listing");
  $("#v-monitoring").classList.toggle("cv-listing", listing);
  if (listing && !was) $("#mon-side").scrollTop = MON.top | 0;
  if (current === "monitoring") monSchedule();
  if (convListing()) $("#vtog").hidden = true;
  convTitle();
  convSig = ""; convHeadSig = "";
  convSchedule();
}
matchMedia("(max-width: 1099px)").addEventListener("change", () => {
  if (current === "projects" || current === "project") go(current, current === "project" ? ppCur : undefined);
  convChrome();
  if (convSync()) renderAll();
  document.querySelectorAll(".thead").forEach(b => { b.dataset.sig = ""; });
  renderBars();
});
convLoad();

/* ---- shell: the notice bell and the sidebar's computer row (22-shell.css) ---- */
// The bell opens the 알림 screen (31-notices-screen.js); its count comes from paintBell (09-needs-you.js), fed by every notice change.
$("#bell").prepend(icon("bell"));
$("#bell").title = `알림 (${isMac ? "⌘/" : "Ctrl+/"})`;
$("#bell").onclick = nscGo;
