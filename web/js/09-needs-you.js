/* ---------- needs-you: a target whose last finished turn this browser has not looked at yet ---------- */
// SEEN: when this browser last had the target open in 채팅 (대화 or 터미널) while the page was visible. DONE: the newest finished turn
// of the target: for a lane its turn_end or working->idle change; for the main chat and a project the orchestrator's answer stored in it (ingestMsg). Both are ISO strings kept in localStorage.
const SEEN_KEY = "dotz-seen", DONE_KEY = "dotz-done";
const readMap = k => { try { const o = JSON.parse(localStorage.getItem(k) || "null"); return o && typeof o === "object" && !Array.isArray(o) ? o : {}; } catch { return {}; } };
const SEEN = readMap(SEEN_KEY), DONE = readMap(DONE_KEY), PREV = {};
const saveMap = (k, m) => { try { localStorage.setItem(k, JSON.stringify(m)); } catch {} };
const msOf = s => Date.parse(s) || 0;
const watching = t => t === target && (current === "chat" || current === "activity") && !convListing() && document.visibilityState === "visible";
// Looking at the open target counts it as seen up to now (or up to its newest finished turn when the clocks differ).
function markSeen() {
  if (!watching(target)) return;
  SEEN[target] = new Date(Math.max(Date.now(), msOf(DONE[target]))).toISOString();
  saveMap(SEEN_KEY, SEEN);
}
function noteDone(t, at, live) {
  const m = msOf(at);
  if (!m || m <= msOf(DONE[t])) return;
  if (SEEN[t] === undefined) SEEN[t] = new Date(live ? m - 1 : Date.now()).toISOString();   // first sight of a target: only turns after this one count
  DONE[t] = new Date(m).toISOString();
  saveMap(SEEN_KEY, SEEN); saveMap(DONE_KEY, DONE);
  markSeen();
  attnChanged();
}
// From /api/state: first sight of a target starts as seen; a working->idle change is a finished turn; gone lanes are forgotten.
function noteStatus() {
  if (!S) return;
  // Only a lane's working->idle is a finished turn: the main chat's and a project's turns count when their answer lands (ingestMsg).
  const now = new Date().toISOString(), all = [[MAIN, (S.orchestrator || {}).status], ...S.lanes.map(l => [`lane:${l.name}`, l.status])], names = new Set([...all.map(x => x[0]), ...projTargets()]);
  let dirty = false;
  for (const t of projTargets()) if (SEEN[t] === undefined) { SEEN[t] = now; dirty = true; }
  for (const k of [...Object.keys(SEEN), ...Object.keys(DONE)]) if (!names.has(k)) { delete SEEN[k]; delete DONE[k]; delete PREV[k]; dirty = true; }
  for (const [t, st] of all) {
    if (SEEN[t] === undefined) { SEEN[t] = now; dirty = true; }
    if (PREV[t] === "working" && st === "idle" && isLaneT(t)) noteDone(t, now, true);
    PREV[t] = st;
  }
  if (dirty) { saveMap(SEEN_KEY, SEEN); saveMap(DONE_KEY, DONE); }
}
// "limit": rate-limited; "done": finished while this browser was not looking; "": nothing. Looking at the target clears both.
// "ask" (checked first): a lane question waiting for the owner's answer (lane.json pendingAsk, cleared when answered).
function attnRaw(t) {
  const i = targetInfo(t);
  if (i.alive && i.ask) return "ask";
  if (i.alive && i.status === "rate-limited" && !isProjT(t)) return "limit";
  return msOf(DONE[t]) > msOf(SEEN[t]) ? "done" : "";
}
const attnKind = t => watching(t) ? "" : attnRaw(t);
const attnLabel = k => ({ ask: "답변 필요", limit: "한도 걸림" })[k] || "확인 필요";
// The 채팅 nav badge and the page title count what the chat list shows and the owner can clear there: the listed conversations (the main
// chat, 알림, 작업내역 and the projects) that have unread messages, by the hub's read position (synced across devices). A session lives under
// 세션; its question, rate limit and finished turn keep their own marks (home, 세션, toasts) and never hold this badge.
const chatUnreadCount = (targets, unreadOf) => targets.filter(t => unreadOf(t) > 0).length;
function paintAttn() {
  const n = S ? chatUnreadCount([MAIN, "worklog", ...projTargets()], t => ts(t).unread) : 0, b = $("#nav-att");
  const say = n ? `읽지 않은 대화 ${n}개` : "", rise = n && b.hidden && b.dataset.seen;
  b.hidden = !n; b.title = say;
  if (n) rollCount(b, n > 99 ? "99+" : String(n)); else b.textContent = "";   // the digit that changed rolls; a hidden badge forgets, so it appears whole
  if (rise) motionPop(b);   // 0 -> n pops in; the first paint (before the state has loaded) only learns the number
  if (S) b.dataset.seen = "1";
  b.parentElement.setAttribute("aria-label", n ? `채팅, ${say}` : "채팅");
  document.title = n ? `(${n}) ${botName}` : botName;
  paintBell();
  toastAttn();
  monAttnSoon();
}
// The 모니터링 nav badge is the ONE number of 답장 대기 (30-replies.js rqWaiting: 답 필요 + 실패 as the screen shows them, of every computer). A monitor or an app
// that failed or lost its connection is not in that number: it shows as the small dot (nub) titled "확인할 것 N개" while the number is 0. monAttnCount counts those
// faults: each list row whose monitor or app failed or lost its connection (a watch an app owns counts as that app's row, as the list shows it).
// srcs: [{apps (GET /api/integrations items), mons (GET /api/monitors items)}].
function monAttnCount(srcs) {
  let n = 0;
  for (const { apps, mons } of srcs) {
    const bad = new Set();
    for (const a of apps) if (a.state === "disconnected") bad.add(`i:${a.key}`);
    for (const m of mons) { const k = monStatus(m).key; if (k === "fail" || k === "disconnected") { const o = monOwner(apps, m); bad.add(o ? `i:${o.key}` : `m:${m.name}`); } }
    n += bad.size;
  }
  return n;
}
// Deferred: paintAttn runs while the page's later files (INTG, NM) are still loading, and one paint per frame of changes is enough.
let monAttnT = 0;
const monAttnSoon = () => { if (!monAttnT) monAttnT = setTimeout(() => { monAttnT = 0; paintMonAttn(); }, 0); };
// 모니터링 has news when nothing waits but something new came in there: an unread watch report, or an app with unread items (its row's badge).
// The tab then carries the small dot, like the other tabs; reading them there clears it.
const monNews = () => NT.items.some(n => n.kind === "watch" && n.cls !== "log" && !n.read && !n.dismissed) || INTG.items.some(it => ((it.needs || {}).unread | 0) > 0);
function paintMonAttn() {
  const b = $("#nav-mon");
  if (!b) return;
  const n = rqWaiting(), faults = monAttnCount([{ apps: INTG.items, mons: NM.items }]), news = !n && !faults && monNews();
  const say = n ? `확인할 것 ${n}개` : faults ? `확인할 것 ${faults}개` : news ? "새 소식" : "", rise = n && b.hidden && b.dataset.seen;
  b.hidden = !say; b.title = say;
  b.classList.toggle("nnb", !!n); b.classList.toggle("nub", !n && !!say);
  if (n) rollCount(b, n > 99 ? "99+" : String(n)); else b.textContent = "";
  if (rise) motionPop(b);
  if (NM.loaded && NT.loaded && INTG.loaded) b.dataset.seen = "1";
  b.parentElement.setAttribute("aria-label", say ? `모니터링, ${say}` : "모니터링");
}
// The badge and 답변 필요 read this computer's monitors on every tab: 홈 and 모니터링 refresh them themselves, any other tab here.
// The other computers' snapshot (pqLoad) is read only by 모니터링.
setInterval(() => { if (!document.hidden && current !== "home" && current !== "monitoring" && !monCtx) loadMonitors(); }, 60_000);
// A target that starts needing the owner pops one toast (tap = switch to it): a lane question, a rate limit, or the main chat
// finishing unseen (a lane's finished turn already has its report toast). On page load only open questions pop, and several of them are
// one toast with their count that opens 홈 (they are all rows of 답변 필요 there), not a stack of cards over the screen.
const ATTN_LAST = {};
let attnPainted = false;
function toastAttn() {
  if (!S) return;
  const first = [];
  for (const t of liveTargets()) {
    const k = attnRaw(t), was = ATTN_LAST[t] || "";
    ATTN_LAST[t] = k;
    // Answered, read or opened: its "확인 필요" card no longer stands (owner 2026-10-28: a finished item still asking to be checked confuses).
    if (was && (k !== was || watching(t))) ntfDropFor(t);
    if (!k || k === was || watching(t) || (k === "done" && isLaneT(t)) || (!attnPainted && k !== "ask")) continue;
    if (!attnPainted) { first.push(t); continue; }
    attnToast(t, k);
  }
  if (first.length === 1) attnToast(first[0], "ask");
  else if (first.length) {
    const box = document.querySelector(".ntf-box"), before = box && box.firstElementChild;
    const names = first.map(targetName), newest = first.map(t => targetInfo(t).ask.at).sort().pop();
    notify({ kind: "needs", target: "home", tone: "warn", title: `답변 필요 ${first.length}개`, ts: newest, text: `${names.slice(0, 2).join(", ")}${names.length > 2 ? ` 외 ${names.length - 2}개` : ""}가 답을 기다려요` });
    const c = document.querySelector(".ntf-box .ntf");
    if (c && c !== before) { c.dataset.ny = "home"; attnHomeClick(); }
  }
  attnPainted = true;
}
// The bundled toast opens 홈 instead of one conversation (capture phase: before the card's own open-by-notice handler). Installed with the first one.
let attnHomeOn = false;
function attnHomeClick() {
  if (attnHomeOn) return;
  attnHomeOn = true;
  document.addEventListener("click", ev => {
    const c = ev.target.closest && ev.target.closest('.ntf[data-ny="home"]');
    if (!c || ev.target.closest(".x")) return;
    ev.stopPropagation();
    c.querySelector(".x").click();
    go("home");
  }, true);
}
function attnToast(t, k) {
    const ask = targetInfo(t).ask;
    notify({ kind: "needs", target: t, open: t, ask: k === "ask", tone: "warn", title: `${targetName(t)} · ${attnLabel(k)}`,
      ts: k === "ask" ? ask.at : k === "done" ? DONE[t] : new Date().toISOString(),
      text: k === "ask" ? ask.text : k === "limit" ? "사용량 한도로 대기 중이에요" : "답을 마쳤어요. 확인해 주세요" });
}

/* ---------- 홈 답변 필요: only what the owner must do, the most important first ---------- */
// Owner 2026-10-26: what to do comes first, system notices mostly run on their own, ask as little as possible and only critical ones loudly.
// Each item: { rank, crit, act, n (a notice) | t (a session with a question) }. rank 0 critical (a login only the owner can do, a gateway
// failure that needs his choice), 2 another decision, 3 a session question, 4 a loose question of the assistant.
// A gateway [ask] that is not critical is a system notice it handles: not asked here, it is news in the 알림 card (08-home.js hcFyi).
// A finished turn (결과 확인) and a rate limit (한도 걸림) are not decisions: the assistant card and 지금 진행 중 show them.
const NY_LOGIN = /로그인|인증|2단계|OTP|비밀번호/i;
function nyOf(n) {
  const d = ntOpenDec(n) ? n.decision : null, gw = n.by === "gateway", text = `${n.title || ""}\n${n.text || ""}`;
  if (d && d.to.startsWith("auth:")) return { n, rank: 0, crit: true, act: "로그인" };
  if (d && d.draft) return null;   // a send approval is a row of 답장 대기 (30-replies.js), not of 답변 필요
  if (gw && NY_LOGIN.test(text)) return { n, rank: 0, crit: true, act: "로그인" };
  if (gw && (d || n.tone === "fail")) return { n, rank: 0, crit: true, act: "선택" };
  if (gw) return null;
  return d ? { n, rank: 2, crit: n.tone === "fail", act: "선택" } : { n, rank: 4, crit: false, act: "답변" };
}
// A question waiting on the owner that is a gateway notice it handles itself (not listed in 답변 필요).
const nyHandled = n => ntNeeds(n) && !ntOpenDec(n) && !ntLinkedDec(n) && !nyOf(n);
// A monitor of this computer that failed NY_FAILS times in a row (about an hour) waits on the owner too: 확인 필요, with the count,
// opening its row in 모니터링 (an app's watch opens the app). Only here: no push or Discord alert is sent for it.
const NY_FAILS = 3;
function nyMonFails() {
  const out = [];
  for (const i of monItems()) if (!i.pc) for (const m of i.mon ? [i.mon] : i.owned || [])
    if (!m.paused && (m.fails | 0) >= NY_FAILS) out.push({ m, key: i.key, pc: i.pc || null, rank: 2, crit: false, act: "확인 필요", at: m.last_run || "" });
  return out;
}
// Only this computer's: another computer's question is listed in 모니터링, and here only the computer chip's dot says it waits (owner 2026-10-31).
function nyList() {
  const lanes = ((S && S.lanes) || []).filter(laneAlive).map(l => `lane:${l.name}`);
  const asks = lanes.filter(t => (askOf(t) || attnKind(t) === "ask") && !ntHasDecision(t)).map(t => ({ t, rank: 3, crit: false, act: "답변", at: (targetInfo(t).ask || {}).at || "" }));
  const loose = ntLooseAsks().filter(n => !asks.some(x => x.t === (n.src || n.open)));
  const items = [...ntDecisions(), ...loose].map(nyOf).filter(Boolean).concat(asks, nyMonFails());
  const when = x => x.n ? ntAt(x.n) : Date.parse(x.at) || 0;
  return items.sort((a, b) => a.rank - b.rank || when(b) - when(a));
}
// One row per item. The label on the right is the action.
function nyRows(items) {
  const out = [];
  const mark = (node, it) => {
    if (it.n && it.n.pc) for (const h of node.querySelectorAll(".hrx-m .hn1")) h.append(el("span", { class: "tag mon-pc", text: it.n.pc.name }));   // another computer's question names it
    for (const hs of node.querySelectorAll(".hrx-m .hs")) hs.textContent = it.act;
    for (const b of node.querySelectorAll(".hrx-m")) b.setAttribute("aria-label", b.getAttribute("aria-label").replace(/답변 필요$/, it.crit ? `중요 · ${it.act}` : it.act));
    if (it.crit) { node.classList.add("crit"); if (it.n && it.n.tone === "fail") for (const e of node.querySelectorAll(".hs")) e.classList.add("err"); }   // a login stays orange; only a failure is red
    return nyBare(node);
  };
  for (const it of items) out.push({ node: it.n ? mark(ntHomeRow(it.n), it) : it.m ? nyMonRow(it) : nyBare(homeNowRow(it.t, it.act, "att")), count: 1 });
  return out;
}
// The rows of 답변 필요 have no dot in front, so every title starts at the same left line.
function nyBare(node) {
  for (const d of node.querySelectorAll(":scope > .dot, :scope > .hrx-m > .dot")) d.remove();
  return node;
}
// A login that dropped is the first row of 답변 필요, not a strip above it: the notice the hub says still waits on a login (waits, hub/notices-rules.ts;
// id: the notice, which 알림 then leaves out), else an app whose login is gone. The word at the right opens what the strip used to open.
// A notice the hub has not classed (the demo's fixtures) is told by its unread title.
const NY_LOGIN_LOST = /로그인이 풀렸어요/;
const nyLoginLost = n => n.waits === "login" || (!n.read && n.cls === "alert" && n.tone !== "done" && NY_LOGIN_LOST.test(`${n.title || ""}\n${n.text || ""}`));
function nyLogins() {
  const ns = NT.items.filter(n => n.id && !n.ignored && !n.dismissed && ntHomeAlert(n) && !ntNeeds(n) && nyLoginLost(n)).sort((a, b) => ntAt(b) - ntAt(a));
  const out = ns.map(n => ({ id: n.id, node: nyLoginRow(n) }));
  for (const i of typeof INTG !== "undefined" ? INTG.items : []) if (i.state === "disconnected" && !ns.some(n => i.label && hcLine(n).includes(i.label))) out.push({ id: `i:${i.key}`, node: nyDownRow(i) });
  return out;
}
function nyLoginRow(n) {
  const node = nyBare(ntHomeRow(n, "다시 로그인")), app = (/^(.*?)\s*로그인이 풀렸어요/.exec(hcLine(n)) || [])[1], ha = node.querySelector(".ha");
  if (app && ha) ha.textContent = `${app} · ${ntWhen(n)}`;
  return node;
}
function nyDownRow(i) {
  const title = `${i.label || "앱"} 로그인이 풀렸어요`;
  return el("div", { class: "hr hrx", "data-login": i.key },
    el("button", { class: "hrx-m", type: "button", onclick: () => go("monitoring", `i:${i.key}`), "aria-label": `${title} · 다시 로그인` },
      el("span", { class: "hb" }, el("span", { class: "hn1" }, el("span", { class: "nm", text: title })), el("span", { class: "ha", text: "다시 로그인해야 이어서 볼 수 있어요" })),
      el("span", { class: "hs warn", text: "다시 로그인" })));
}
// A monitor failing again and again: its name, the computer, how many times in a row; a tap opens it in 모니터링.
function nyMonRow(it) {
  const m = it.m, who = it.pc ? it.pc.name : pqSelf(), title = monTitle(m);
  return el("button", { class: "hr", type: "button", "data-mon": it.key, onclick: () => go("monitoring", it.key), "aria-label": `${title} · ${it.act}` },
    el("span", { class: "hb" }, el("span", { class: "hn1" }, el("span", { class: "nm", text: title }), who ? el("span", { class: "tag mon-pc", text: who }) : null),
      el("span", { class: "ha", text: [`${m.fails}번 연속 실패했어요`, monClean(m.last_summary || "")].filter(Boolean).join(" · ") })),
    el("span", { class: "hs warn", text: it.act }));
}
// The list of the 홈 card: every row, six in sight (08-home.js capLists). lead: the login rows above what is asked; tail: the rows that close it.
function nyListNode(items, lead = [], tail = []) {
  const rows = [...lead, ...nyRows(items).map(r => r.node), ...tail];
  return el("div", { class: "hn", "data-k": "needs", "data-cap": "needs" }, ...rows, ...(rows.length ? [] : [hcNone(hcState() || hmState() || "답변할 항목이 없어요")]));
}
function attnChanged() {
  renderBars();
  if (current === "home") renderHome();
}

/* ---------- usage strip in the app header: the tightest Anthropic-like limit ---------- */
let SQ = null, stripAt = 0;
const limitWord = l => {
  const m = `${l.id} ${l.window} ${l.label}`.match(/(\d+)\s*(h|d|w)/i);
  if (!m) return l.label || l.id;
  const n = Number(m[1]), u = m[2].toLowerCase();
  return u === "h" ? `${n}시간` : u === "d" ? `${n}일` : `${n}주`;
};
function tightLimit(q) {
  const provs = (q.providers || []).filter(p => (p.limits || []).length), an = provs.filter(p => /anthropic|claude/i.test(p.provider));
  let best = null;
  for (const p of an.length ? an : provs) for (const l of p.limits) { if (l.scope) continue; const f = limitFrac(l); if (f != null && (!best || f < best.f)) best = { l, f }; }
  return best;
}
function paintStrip() {
  const b = $("#ustrip"), t = SQ && tightLimit(SQ), side = $("#sf-usage");
  b.hidden = !t;
  if (side) side.hidden = !t;
  if (!t) return;
  const pct = Math.round(t.f * 100), word = limitWord(t.l);
  b.className = `ustrip${pct <= 40 ? " warn" : ""}`;
  b.style.setProperty("--p", pct);
  b.title = `사용량 · ${word} ${pct}% 남음`; b.setAttribute("aria-label", b.title);
  clear(b).append(el("span", { class: "ulab", text: `${word} ${pct}% 남음` }), el("span", { class: "ubar" }, el("i", { style: `width:${pct}%` })), el("span", { class: "uring" }), el("span", { class: "upct", text: `${word} ${pct}%` }));
  // the sidebar's lower area says the same in a row (22-shell.css): the tightest limit, its bar, and the share left; the folded rail shows only the ring
  if (side) {
    side.classList.toggle("warn", pct <= 40);
    clear(side).append(icon("usage"), el("span", { class: "sf-k", text: "사용량" }), el("span", { class: "sf-bar" }, el("i", { style: `width:${pct}%` })), el("span", { class: "sf-v", text: `${word} ${pct}%` }), el("span", { class: "sf-ring pring", style: `--p:${pct}`, text: String(pct) }));
    side.title = `사용량 · ${word} ${pct}% 남음`; side.setAttribute("aria-label", side.title);
  }
}
// 헤더의 종: the unread notice count, kept current by every notice change (30-notices.js ntPaint -> paintAttn).
function paintBell() {
  const n0 = $("#bell-n");
  if (!n0) return;
  let n = 0;
  try { n = NT.loaded ? nscUnreadIn("all") : NT.unread | 0; } catch { /* 30-notices.js has not run yet */ }
  const direct = !n || n0.hidden || !n0.dataset.seen, txt = n > 99 ? "99+" : String(n);
  n0.hidden = !n;
  if (direct) n0.textContent = txt; else rollCount(n0, txt);
  if (n && direct && n0.dataset.seen) motionPop(n0);   // 0 -> n pops; the first draw, before the notices have loaded, only learns the number
  try { if (NT.loaded) n0.dataset.seen = "1"; } catch {}
  const b = $("#bell");
  if (b) b.setAttribute("aria-label", n ? `알림, 안 읽은 알림 ${n}개` : "알림");
}
$("#sf-usage").onclick = () => go("usage");
function noteQuota(q) { SQ = q; stripAt = Date.now(); paintStrip(); }
// A pushed usage read: the strip, and the 사용량 / 홈 view on screen, show it without asking again.
function quotaLive(q) {
  if (!q) return;
  noteQuota(q);
  HQ = q;
  if (current === "usage") loadQuota();
  else if (current === "home") renderHome();
}
// At most one fetch per 3 minutes, and only while the page is visible (the home and usage views feed it through noteQuota too).
async function loadStrip() {
  if (document.visibilityState !== "visible" || Date.now() - stripAt < 180000) return;
  stripAt = Date.now();
  try { noteQuota(await api("/api/quota")); } catch {}
}

// Per-target data, shared by both views: conversation events (msgs) and what the agent did (acts).
const TS = {};
const ts = t => TS[t] || (TS[t] = { msgs: [], mk: new Set(), acts: [], ak: new Set(), hLoaded: false, aLoaded: false, unread: 0, draft: "", loading: null, ahist: false, amore: false, older: false, cap: 600, gaps: new Set() });
const byTs = (a, b) => a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0;
const msgKey = e => `${e.ts}|${e.kind}|${e.lane ?? ""}|${e.ref ?? ""}${e.state ?? ""}|${String(e.text ?? "").slice(0, 60)}`;
const actKey = a => `${a.ts}|${a.type}|${a.call_id ?? ""}|${(a.text ?? "").length}|${(a.text ?? "").slice(0, 40)}`;
const OWNER = new Set(["message", "lane_message", "_cmd"]);
const ownerish = e => OWNER.has(e.kind) || e.kind === "_cmdout";
const ownerAct = e => ({ type: e.kind === "_cmdout" ? "cmdout" : "owner", ts: e.ts, text: e.text, is_error: e.is_error });
// Same rule as the hub's eventTarget (hub/events.ts): which conversation an event belongs to.
function eventTarget(e) {
  if (e.kind === "activity" || e.kind === "subagents" || e.kind === "notice" || e.kind === "notice_read" || e.kind === "read") return null;
  const mail = [e.conv, e.channel, e.target].find(v => typeof v === "string" && v.startsWith("mail:"));
  if (mail) return mail;
  const settings = [e.conv, e.channel, e.target].find(v => typeof v === "string" && v.startsWith("settings:"));
  if (settings) return settings;
  let lane = typeof e.lane === "string" ? e.lane : "";
  if (!lane) for (const v of [e.source, e.target, e.channel]) if (typeof v === "string" && v.startsWith("lane:")) { lane = v.slice(5); break; }
  if (lane) return `lane:${lane}`;
  const proj = [e.channel, e.target].find(v => typeof v === "string" && isProjT(v));
  if (proj) return proj;
  for (const v of [e.channel, e.target]) { const m = typeof v === "string" && /^(?:web:)?(alert|worklog)$/.exec(v); if (m) return m[1]; }
  return e.kind === "watch" ? null : MAIN;   // a watch report is 모니터링's, not a message of 알림
}

/* ---------- conversation view (대화) ---------- */
const timeline = $("#timeline"), tl = $("#tl"), term = $("#term");
let chatStick = true, termStick = true;
timeline.addEventListener("scroll", () => { chatStick = timeline.scrollTop + timeline.clientHeight >= timeline.scrollHeight - 40; $("#chat-jump").hidden = chatStick; convReadSoon(); if (timeline.scrollTop < 80) loadOlderMsgs(); });
timeline.addEventListener("scroll", () => edgeFade(timeline), { passive: true });
term.addEventListener("scroll", () => edgeFade(term), { passive: true });
term.addEventListener("scroll", () => { termStick = term.scrollTop + term.clientHeight >= term.scrollHeight - 40; $("#act-jump").hidden = termStick; if (term.scrollTop < 80) loadOlder(); });
$("#chat-jump").prepend(icon("down")); $("#act-jump").prepend(icon("down"));
$("#chat-jump").onclick = () => scrollChat(true);
$("#act-jump").onclick = () => scrollTerm(true);
// Older messages load by themselves when the owner reaches the top: the sentinel sits above them inside the scrolling
// timeline (11-todo-strip.js keeps it across redraws), so the observer fires without a scroll event; its button stays the fallback.
if ("IntersectionObserver" in window && $("#tl-top"))
  new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) loadOlderMsgs(); }, { root: timeline, threshold: 0 }).observe($("#tl-top"));
// Messages read top-down: `top` = a message that just arrived while the owner sits at the bottom. When it is taller than the visible area
// its TOP goes to the top of the view (leaving the bottom, so the "new message" jump button shows); a short one keeps sticking to the bottom.
function scrollChat(force, top) {
  if (!force && !chatStick) return;
  if (force) chatUnpin();   // an explicit jump to the bottom ends the opening's anchor (31-conversations.js)
  requestAnimationFrame(() => {
    if (CV.pin && CV.pin !== "bottom") return;   // a place chosen after this call (the divider, a jump target) wins; the owner letting go clears the pin first
    if (!force && !chatStick) return;   // an earlier message of this frame already put the view at its top
    if (!force && top && top.isConnected && top.offsetHeight > timeline.clientHeight - 24) {
      chatUnpin();
      timeline.scrollTop += top.getBoundingClientRect().top - timeline.getBoundingClientRect().top - 12;
      chatStick = timeline.scrollTop + timeline.clientHeight >= timeline.scrollHeight - 40;
      $("#chat-jump").hidden = chatStick;
    } else { timeline.scrollTop = timeline.scrollHeight; chatStick = true; $("#chat-jump").hidden = true; }
    convMaybeRead();
  });
}
function scrollTerm(force) {
  if (force || termStick) requestAnimationFrame(() => { term.scrollTop = term.scrollHeight; termStick = true; $("#act-jump").hidden = true; });
}
// One formatter each: toLocale*String builds a new one per call, and a conversation asks for these on every row (a fifth of the time of opening one).
const KST_HM = new Intl.DateTimeFormat("ko-KR", { ...KST, hour: "numeric", minute: "2-digit" });
const KST_DAY = new Intl.DateTimeFormat("ko-KR", { ...KST, year: "numeric", month: "numeric", day: "numeric" });
const KST_LABEL = new Intl.DateTimeFormat("ko-KR", { ...KST, month: "long", day: "numeric", weekday: "short" });
const kstHM = t => { const d = new Date(t); return isNaN(d) ? "" : KST_HM.format(d); };
const kstDay = t => { const d = new Date(t); return isNaN(d) ? "" : KST_DAY.format(d); };
const dayLabel = t => { const d = new Date(t); return isNaN(d) ? "" : kstDay(t) === kstDay(Date.now()) ? "오늘" : KST_LABEL.format(d); };
function fmtDur(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}분 ${s % 60}초` : `${m}분`;
  return m % 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${Math.floor(m / 60)}시간`;
}
let CS = { day: "", group: null, empty: null, prog: new Map(), who: "", whoT: 0 };
// The open conversation's read state (31-conversations.js): key = the target being looked at, div = the read position when it was opened
// (the "새 메시지" divider goes before the first message after it), divNode = that divider in the timeline.
// pin = what the view is anchored to while the opening settles (late images, the todo strip, an SSE frame): "div" (the divider at the top),
// "top" (a mail's start), "bottom", or "" once the owner took over; placed = the opening has been positioned.
const CV = { key: "", drawn: "", div: "", divNode: null, jump: "", from: "", low: "", seeded: false, loaded: false, captured: false, failed: false, placed: false, full: false, snap: null, pin: "", openAt: 0, gateT: 0 };
// 31-conversations.js state; declared here because the boot code calls go() before that file has run.
const CONV = new Map(), READ = {}, convPend = new Map();
let convRaf = 0, convSig = "", convHeadSig = "", convRetry = 0, convReadT = 0, convPendT = 0, convReadF = 0;
