/* ---------- 세션: a session's last report and chat link, and the 프로젝트 list below (sessions live in their project's 세션 section; 진행 중 on 홈 and 채팅 is a shortcut to what runs now) ---------- */
const LP = {};                  // lane name -> { acts: oldest-first {ts, text} lines in Korean, rev, loaded, loading, failedAt }
const LANE_ACTS = 12;           // lines kept per session
const laneKey = a => `${a.ts}|${a.type}|${a.call_id ?? ""}|${(a.text ?? "").length}|${(a.text ?? "").slice(0, 40)}`;
function laneToolLabel(a) {
  const pre = `${a.tool}: `;
  const fromText = a.tool && typeof a.text === "string" && a.text.startsWith(pre) ? a.text.slice(pre.length) : "";
  const s = a.intent || fromText;
  if (s) return oneLine(s);
  try {
    const o = JSON.parse(a.args);
    if (o && typeof o === "object") for (const k of ["i", "intent", "command", "cmd", "path", "pattern", "query", "url"]) if (typeof o[k] === "string" && o[k]) return oneLine(o[k]);
  } catch { /* args may be cut off */ }
  return "";
}
// A session's last report or answer (not a progress note), from the conversation events this page has seen.
const isLaneReport = e => e.kind === "lane_report" || (e.kind === "out" && !e.update_key && typeof e.source === "string" && e.source.startsWith("lane:"));
// A finished session's result: its report nearest to `at` (a report row's time is the lane's, a moment before the event), else its last one; with none, the end of its conversation and the jump's toast.
async function laneResultGo(name, at) {
  pmSheetsClose();
  const t = `lane:${name}`, want = Date.parse(at || "");
  if (!(ts(t).hLoaded && ts(t).aLoaded)) await loadTarget(t).catch(() => {});
  if (want) await ntReach(t, at);
  const gap = e => Math.abs(Date.parse(e.ts) - want), reps = ts(t).msgs.filter(isLaneReport);
  const rep = want ? reps.reduce((best, e) => (!best || gap(e) < gap(best) ? e : best), null) : reps.at(-1);
  ntJump({ src: t, at: rep ? rep.ts : at || new Date().toISOString() });
}
// The main assistant's background work (S.work): running first, then what ended in the last hour.
// Tap on finished work: the message holding its result (hub/bgwork.ts result_at), flashed; with none, the conversation at the time it ended and the jump's short toast.
// Tap on work still going: the conversation that asked for it (its waiting message, flashed). Message unknown or not drawn: the work's own detail, never another message.
async function workGo(row) {
  pmSheetsClose();
  const w = ((S && S.work) || []).find(x => x.id === row.id) || row, t = w.target && validTarget(w.target) ? w.target : MAIN;   // the row may be older than the answer
  if (w.result_at) return ntJump({ src: w.result_conv || t, at: w.result_at });
  if ((w.status === "done" || w.status === "failed") && !workRecovering(w) && w.ended_at) return ntJump({ src: t, at: new Date(w.ended_at).toISOString() });
  // Work for a monitor's / app's settings chat or a project is that conversation's: with the message unknown the row still opens it, never the worker sheet.
  const fallback = () => t === MAIN ? openSub("orchestrator", w.id, null, w.description) : ntGo(t);
  if (!w.reply_to) return fallback();
  if (!(ts(t).hLoaded && ts(t).aLoaded)) await loadTarget(t).catch(() => {});
  const asked = ts(t).msgs.find(e => e.mid === w.reply_to);
  if (!asked) return fallback();
  ntJump({ src: t, at: asked.ts });
}
// One short Korean sentence out of a free-form message: code, links, hashes and markup dropped; English-only lines are not shown.
function plainKo(text) {
  const s = String(text ?? "").replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ").replace(/https?:\/\/\S+/g, " ").replace(/\b[0-9a-f]{7,40}\b/gi, " ").replace(/[*_#>\[\]|]/g, " ");
  const line = s.split("\n").map(oneLine).find(x => /[가-힣]/.test(x));
  if (!line) return "";
  const cut = line.match(/^.*?(?:[요다죠음함]\.|[.!?])(?=\s|$)/);
  const t = (cut ? cut[0] : line).replace(/[.!]$/, "");
  return t.length > 50 ? `${t.slice(0, 48)}…` : t;
}
const LANE_TOOL_KO = { 명령: "명령을 실행했어요", 수정: "파일을 고쳤어요", 읽기: "파일을 읽어봤어요", 검색: "코드를 찾아봤어요" };
function laneActKo(a) {
  switch (a.type) {
    case "tool_call": return LANE_TOOL_KO[kindOf(a.tool)] || "";
    case "text": return plainKo(parseTone(String(a.text ?? "")).text);
    case "status": return plainKo(statusLineKo(a.text));
    case "error": return "오류가 있었어요";
    case "turn_end": return "이번 작업을 마쳤어요";
    default: return "";
  }
}
function laneRefresh(p) { p.rev++; }
function laneIngest(p, a) {
  const k = laneKey(a);
  if (p.seen.has(k)) return;
  p.seen.add(k);
  if (p.seen.size > 200) p.seen = new Set([...p.seen].slice(-100));
  const text = laneActKo(a);
  if (text) { p.acts.push({ ts: Date.parse(a.ts) || Date.now(), text }); if (p.acts.length > LANE_ACTS) p.acts.shift(); }
  laneRefresh(p);
}
// SSE "activity": keep every loaded session live, even while another view is open.
function laneActivity(a) {
  const name = typeof a.source === "string" && a.source.startsWith("lane:") ? a.source.slice(5) : null;
  if (name) { const s = actLine(a); if (s && LAST[name] !== s) { LAST[name] = s; homeSoon(); } }
  const p = name && LP[name];
  if (!p) return;
  if (p.loading) p.queue.push(a);
  else if (p.loaded) laneIngest(p, a);
}
function laneTailsStale() {
  for (const p of Object.values(LP)) p.loaded = false;
}
/* ---------- 프로젝트 (docs/layers.md §5): the list (GET /api/custom) and the main view (GET /api/custom/project?key=) ---------- */
let PRJ = null, PRJ_FAIL = false, prjFlight = null, prjRev = 0;
const prjTitle = p => (p.record && p.record.title) || p.title || p.name;
const prjPurpose = p => (p.record && p.record.purpose) || p.purpose || p.note || "";
// A purpose as the owner reads it: its first one or two plain sentences. A sentence that names a path, link, port, file or repo stays in the raw
// text, which the editor still shows.
const PRJ_TECH = /https?:\/\/|(?:^|[\s(])~?\/[\w.-]+|\b[a-z][\w.-]*\/[a-z][\w.-]*|\b[\w-]+\.(?:md|ts|js|json|toml|ya?ml|sh|py|html|css)\b|\b\d{4,5}\b|\b(?:github|gitlab|tailnet|localhost)\b|`/i;
function prjBlurb(text) {
  const out = [];
  for (const s of String(text || "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/)) {
    if (!/[가-힣]/.test(s) || PRJ_TECH.test(s)) continue;
    out.push(s.replace(/[.]$/, ""));
    if (out.length === 2) break;
  }
  const t = out.join(". ");
  return t.length > 90 ? `${out[0].length <= 90 ? out[0] : out[0].slice(0, 88)}…` : t;
}
const prjChat = p => p.key.startsWith("ch:") ? p.key : p.channel ? `ch:${p.channel.id}` : "";
const prjPaused = p => !!(p.paused || (p.record && p.record.paused));
function prjLoad() {
  if (prjFlight) return prjFlight;
  prjFlight = api("/api/custom").then(d => { PRJ = d; PRJ_FAIL = false; }, () => { if (!PRJ) PRJ_FAIL = true; }).then(() => {
    prjFlight = null; prjRev++;
    prjPcLoad();
    if (current === "project") { if (ppWide()) renderProjects(); pmPaint(); }
    else if (current === "projects") renderProjects();
    else if (current === "home") homeSoon();   // a 진행 중 row names the session's project
  });
  return prjFlight;
}
// The computer groups (GET /api/custom/computers, hub/custom.ts computerGroups): this computer first, then the others, each with its own
// projects. Read behind the project list, at most once a minute (another computer's answer can take seconds). One group: no headers.
let PRJ_PC = null, prjPcAt = 0, prjPcFlight = null;
function prjPcLoad() {
  if (prjPcFlight || Date.now() - prjPcAt < 55000) return;
  prjPcFlight = api("/api/custom/computers").then(d => { PRJ_PC = Array.isArray(d) ? d : null; prjPcAt = Date.now(); }, () => {}).then(() => {
    prjPcFlight = null;
    if (current === "projects" || (current === "project" && ppWide())) pjPaintRows();
  });
}
// The work channel a session was started in (ch:<id>): the hub's lane list carries it as `home` (hub/laneviews.ts withHomes); the gateway's channel map is the fallback.
const laneHome = l => l.home || (S && S.channels && S.channels.homes && S.channels.homes[l.name] ? `ch:${S.channels.homes[l.name]}` : "");
// The project row holding a session. The hub decides (hub/custom.ts projectsView, docs/layers.md §1: the home channel, the folder only without one); every surface reads it here.
const laneProjectRow = l => ((PRJ && PRJ.projects) || []).find(p => (p.lanes || []).some(x => x.name === l.name));
// The chat of a session's project, "" when it has none.
const laneChat = l => { const p = laneProjectRow(l); return (p && prjChat(p)) || laneHome(l); };
// The project a session belongs to, by name. A session the list does not hold yet (just started, or the list is still loading) goes by its home.
function laneProject(l) {
  const row = laneProjectRow(l);
  if (row) return prjTitle(row);
  const home = laneHome(l);
  if (!home) return "";
  const p = ((PRJ && PRJ.projects) || []).find(x => x.key === home || x.recordKey === home || (x.channel && `ch:${x.channel.id}` === home));
  if (p) return prjTitle(p);
  const work = (S && S.channels && S.channels.work) || {};
  return l.project || work[home.slice(3)] || "";
}
// The one session row (home, project screen): title, parent project, status word; one tap opens the session's chat.
function sessionStatus(l) {
  if (!laneAlive(l)) return ["끝남", ""];
  return runStatus(`lane:${l.name}`, l.status, l.pendingAsk);
}
// The owner's words for a session, on every list of sessions: sessionStatus still decides, this only says it. What stopped short of finishing keeps its own word.
const SESSION_WORD = { run: ["진행 중", "pri"], wait: ["답을 기다림", "warn"], done: ["완료", ""] };
function sessionState(l) {
  const st = sessionStatus(l), t = `lane:${l.name}`;
  if (st[1] === "pri") return SESSION_WORD.run;
  if (st[0] === RUN_LABEL.waiting) return SESSION_WORD.wait;
  return laneAlive(l) && (laneQueued(t) || homeHeld(t)) ? st : SESSION_WORD.done;
}
// 진행 중, the one list 홈 and 채팅 read: S.lanes as this one status says, so a session leaves both by itself when it finishes. Oldest first: a new session
// joins at the end and no row jumps when a message lands. A stored state (13-snapshot.js) says nothing about now, so it lists nothing until the real one lands.
function sessionsNow() {
  const of = word => ((S && !S.seeded && S.lanes) || []).filter(l => sessionState(l) === word).sort((a, b) => String(a.startedAt || "").localeCompare(String(b.startedAt || "")));
  return { wait: of(SESSION_WORD.wait), run: of(SESSION_WORD.run) };
}
// A 진행 중 row's name: `기획팀 · 분기 안건 검토`, the title alone for a session with no project.
const sessionHead = l => { const p = laneProject(l), n = l.title || l.name; return p && p !== n ? `${p} · ${n}` : n; };
// o.project: the project name when the caller knows it better than the lane's own home; o.line: a short activity line after it;
// o.word / o.tone: a status the caller knows better ("답변 필요"); o.head: the project stands in the name (sessionHead), not under it.
function sessionRow(l, o = {}) {
  const proj = o.project !== undefined ? o.project : laneProject(l), [word, tone] = o.word ? [o.word, o.tone || ""] : sessionState(l), name = l.title || l.name, t = `lane:${l.name}`;
  const subs = SUBS[t] || [], done = subs.filter(s => s.status !== "running").length;
  return el("button", { class: "hr srow", type: "button", "data-t": t, onclick: o.open || (() => openTarget(t, lastChatView())), "aria-label": `${name} · ${proj ? `프로젝트 ${proj}` : "프로젝트 없음"} · ${word} · 대화 열기` },
    el("span", { class: `dot ${tone}` }),
    el("span", { class: "hb" }, el("span", { class: "hn1" }, el("span", { class: "nm", text: o.head ? sessionHead(l) : name })),
      el("span", { class: "ha" }, o.head ? null : el("span", { class: `sproj${proj ? "" : " none"}`, text: proj || "프로젝트 없음" }), o.line ? el("span", { class: "sline", text: o.line }) : null, o.extra || null)),
    subs.length ? el("span", { class: "hp", title: "서브에이전트 끝난 수 / 전체", text: `서브에이전트 ${done}/${subs.length}` }) : null,
    el("span", { class: `hs ${tone}`, text: word }));
}

// The project a wide screen opens first: the first pinned one (the list shows 고정 on top), else the top of the list.
const prjFirst = () => { const r = projRows((PRJ && PRJ.projects) || []); return ((r.find(x => x.p.pinned) || r[0] || {}).p || {}).key || ""; };
/* ---------- 프로젝트 level 1: a compact list (name, one status line, last activity), filtered and paged ----------
   Rows sort by what needs the owner, then what runs, then the most recent. A row opens the project's overview (level 2); the overview's
   sections open one drill-in page each (level 3). The built-in 커스텀 project is a settings page, so it sits at the end, outside the filters. */
const PJ_PAGE = 12, PJ_VIEWS = [["all", "전체"], ["run", "진행 중"], ["need", "확인 필요"]];
const PJ = { view: "all", q: "", more: PJ_PAGE };
// What the owner should do with a project now: a waiting session first, then work running, then a resting one.
function prjState(p) {
  const ls = p.lanes || [];
  if (prjPaused(p)) return { k: "paused", tone: "", word: "일시 정지" };
  // The same verdict as the session's own row, so a session on handed-off work runs here too.
  const open = ls.filter(l => l.live).map(l => ({ l, st: sessionStatus({ ...l, pendingAsk: l.waiting }) })), at = t => open.find(x => x.st[1] === t), work = at("pri");
  const ask = ls.find(l => l.waiting);
  if (ask) return { k: "need", tone: "att", word: "답을 기다려요", lane: ask, run: !!work };   // run: it also counts under the 진행 중 filter
  if (work) return { k: "run", tone: "pri", word: SESSION_WORD.run[0], lane: work.l };
  const stuck = at("err") || at("warn");
  if (stuck) return { k: "need", tone: stuck.st[1], word: stuck.st[0], lane: stuck.l };
  const queued = open.find(x => x.st[0] === "순서 대기");
  if (queued) return { k: "run", tone: "", word: queued.st[0], lane: queued.l };
  return { k: "idle", tone: "", word: ls.length ? "쉬는 중" : "세션 없음" };
}
// The newest thing that happened in the project: a session's report or start, or the record's last save.
function prjLastAt(p) {
  const at = x => Date.parse(x || "") || 0;
  return Math.max(0, ...(p.lanes || []).map(l => at(l.lastReportAt) || at(l.startedAt)), at(p.record && p.record.updated));
}
// A short, calm time: 방금 · 12분 전 · 3시간 전 · 어제 · 4일 전 · 9/30.
function prjAgo(at) {
  if (!at) return "기록 없음";
  const m = Math.max(0, Math.floor((Date.now() - at) / 60000));
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  return d === 1 ? "어제" : d < 7 ? `${d}일 전` : kstDay(at);
}
const prjRank = s => (s.k === "need" ? 0 : s.k === "run" ? 1 : 2);
// The projects as data rows, in reading order: need -> running -> recent.
function projRows(list) {
  return list.filter(p => !p.builtin).map(p => ({ p, st: prjState(p) }))
    .sort((a, b) => prjRank(a.st) - prjRank(b.st) || prjLastAt(b.p) - prjLastAt(a.p) || String(prjTitle(a.p)).localeCompare(String(prjTitle(b.p)), "ko", { numeric: true }));
}
const pjRuns = r => r.st.k === "run" || !!r.st.run;
function pjChipCounts(rows) {
  return { all: rows.length, need: rows.filter(r => r.st.k === "need").length, run: rows.filter(pjRuns).length };
}
function pjFiltered() {
  const q = PJ.q.trim().toLowerCase(), rows = projRows((PRJ && PRJ.projects) || []);
  return rows.filter(r => (PJ.view === "all" || (PJ.view === "run" ? pjRuns(r) : r.st.k === PJ.view)) && (!q || `${prjTitle(r.p)} ${prjPurpose(r.p)}`.toLowerCase().includes(q)));
}
// One row, the prototype's list row (s-work.js 프로젝트): a folder tile, the name with one quiet line under it, then the state tag at the right.
function prjRow(r) {
  const { p, st } = r;
  const chat = prjChat(p), unread = chat ? ts(chat).unread : 0, at = prjLastAt(p), sel = current === "project" && ppCur === p.key;
  const line = prjBlurb(prjPurpose(p)) || (st.lane ? (st.lane.title || st.lane.name) : ""), full = [line, prjAgo(at)].filter(Boolean).join(" · ");
  const tone = st.tone === "att" ? "warn" : st.tone;
  return el("button", { class: `pl-row${sel ? " on" : ""}${unread ? " unread" : ""}`, type: "button", "data-key": p.key, "aria-label": `${prjTitle(p)} · ${full} · 열기`, onclick: () => go("project", p.key) },
    el("span", { class: "ico" }, icon("projects")),
    el("span", { class: "pl-b" },
      el("span", { class: "pl-1" }, el("span", { class: "pl-n", text: prjTitle(p) })),
      el("span", { class: "pl-s" }, el("span", { class: "pl-sw", text: line }))),
    el("span", { class: "li-end" }, unread ? el("span", { class: "pl-nb", "aria-label": `읽지 않은 메시지 ${unread}개`, text: unread > 99 ? "99+" : String(unread) }) : null,
      el("span", { class: `tag ${tone}`, text: st.word })));
}
// The prototype's section headers: 고정 first, then 프로젝트 (not 전체: that is the filter chip's word), the same rows sorted by what needs the owner (projRows).
const prjGroups = rows => [["고정", rows.filter(r => r.p.pinned)], ["프로젝트", rows.filter(r => !r.p.pinned)]].filter(g => g[1].length);
// With two or more computers: one folding header per computer (이 컴퓨터 first), its rows pinned first. Another computer's project opens
// that computer's own web app at the project page; an offline computer keeps its header, marked 연결 안 됨, like the computer switcher.
const PJ_FOLD = new Set((() => { try { const l = JSON.parse(localStorage.getItem("dotz-pj-fold") || "[]"); return Array.isArray(l) ? l : []; } catch { return []; } })());
function pcFold(name) {
  if (PJ_FOLD.has(name)) PJ_FOLD.delete(name); else PJ_FOLD.add(name);
  try { localStorage.setItem("dotz-pj-fold", JSON.stringify([...PJ_FOLD])); } catch { /* private mode: the fold lasts until reload */ }
  pjPaintRows();
}
function pcHead(g, n) {
  const open = !PJ_FOLD.has(g.name), mark = g.self ? "이 컴퓨터" : g.online === false ? "연결 안 됨" : "";
  return el("button", { class: `sec pl-sec pl-pc${g.online === false ? " off" : ""}`, type: "button", "aria-expanded": String(open), "aria-label": `${g.name}${mark ? ` · ${mark}` : ""} · 프로젝트 ${n}개 · ${open ? "접기" : "펼치기"}`, onclick: () => pcFold(g.name) },
    el("span", { class: "pl-pcn", text: g.name }), mark ? el("span", { class: "tag", text: mark }) : null, n ? el("span", { class: "pl-pcc", text: String(n) }) : null, icon("chev", "chev"));
}
function pcOpen(g, x) {
  if (!g.online || !g.url) { toast(`${g.name}에 연결할 수 없어요`, true); return; }
  toast(`${g.name}(으)로 넘어가요`);
  prGo(`${g.url}/?did=${enc(DEVICE_ID)}#project/${enc(x.key)}`);
}
function pcRow(g, x) {
  const line = prjBlurb(x.note || "");
  return el("button", { class: "pl-row", type: "button", "data-key": x.key, "aria-label": `${g.name} · ${x.name} · 열기`, onclick: () => pcOpen(g, x) },
    el("span", { class: "ico" }, icon("projects")),
    el("span", { class: "pl-b" }, el("span", { class: "pl-1" }, el("span", { class: "pl-n", text: x.name })), el("span", { class: "pl-s" }, el("span", { class: "pl-sw", text: line }))),
    el("span", { class: "li-end" }, icon("chev", "chev")));
}
// The rows of one page split by computer: [group, its local rows, its other-computer rows]. A filtered view hides groups with nothing in them.
function pcSplit(pcs, page) {
  const q = PJ.q.trim().toLowerCase(), owner = {};
  for (const g of pcs) for (const k of g.keys || []) owner[k] = g.name;
  const me = pcs.find(g => g.self) || pcs[0], filtered = !!q || PJ.view !== "all";
  return pcs.map(g => {
    const mine = page.filter(r => (owner[r.p.key] || me.name) === g.name);
    const remote = PJ.view === "all" ? (g.remote || []).filter(x => !q || `${x.name} ${x.note || ""}`.toLowerCase().includes(q)) : [];
    return [g, [...mine.filter(r => r.p.pinned), ...mine.filter(r => !r.p.pinned)], remote];
  }).filter(([, mine, remote]) => !filtered || mine.length || remote.length);
}
function pjSearch() {
  return el("label", { class: "pl-search" }, icon("search"),
    el("input", { id: "pl-q", type: "search", placeholder: "프로젝트 검색", "aria-label": "프로젝트 검색", autocomplete: "off", value: PJ.q, oninput: ev => { PJ.q = ev.target.value; pjPaintRows(); } }));
}
function pjChips(counts) {
  return segKeep(el("div", { class: "pl-chips", role: "tablist", "aria-label": "프로젝트 보기" }, ...PJ_VIEWS.map(([k, label]) =>
    el("button", { class: `cchip mr-f${PJ.view === k ? " on" : ""}`, type: "button", role: "tab", "aria-selected": String(PJ.view === k), "data-view": k, onclick: () => { PJ.view = k; PJ.more = PJ_PAGE; pjPaintChips(); pjPaintRows(); } },
      label, counts[k] ? el("span", { class: "mr-fn", text: String(counts[k]) }) : el("span", { class: "mr-fn", hidden: true })))));
}
function pjShell() {
  return el("div", { class: "pl", id: "pl-shell" }, el("div", { class: "pl-top" }, pjSearch(), el("div", { id: "pl-chips" })), el("div", { class: "pl-groups", id: "pl-list" }));
}
function pjPaintChips() {
  const box = $("#pl-chips");
  if (!box) return;
  const counts = pjChipCounts(projRows((PRJ && PRJ.projects) || [])), had = $(".mr-f", box);
  if (!had) { clear(box).append(pjChips(counts)); return; }
  // The chips stay put (a refresh never steals focus); only their state and counts follow the data.
  for (const b of box.querySelectorAll(".mr-f")) {
    const k = b.dataset.view, n = $(".mr-fn", b), c = counts[k] || 0;
    b.classList.toggle("on", PJ.view === k); b.setAttribute("aria-selected", String(PJ.view === k));
    n.textContent = c ? String(c) : ""; n.hidden = !c;
  }
}
function pjPaintRows() {
  const box = $("#pl-list");
  if (!box) return;
  const rows = pjFiltered(), page = rows.slice(0, PJ.more), rest = rows.length - page.length;
  const builtin = ((PRJ && PRJ.projects) || []).find(p => p.builtin), searching = !!PJ.q.trim();
  const showBuiltin = !!builtin && PJ.view === "all" && (!searching || "커스텀".includes(PJ.q.trim().toLowerCase()));
  const pcs = PRJ_PC && PRJ_PC.length > 1 ? PRJ_PC : null;
  const sig = JSON.stringify([rows.map(r => [r.p.key, r.st.k, r.st.word, r.st.lane && r.st.lane.name, prjLastAt(r.p), prjChat(r.p) ? ts(prjChat(r.p)).unread : 0]), PJ.more, PJ.view, PJ.q, current === "project" ? ppCur : "", showBuiltin, pcs, pcs ? [...PJ_FOLD] : 0]);
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  // Section headers and one card per group, as the prototype's 프로젝트 list; a group with no row after the filter is left out.
  const nodes = [];
  let card = null;
  if (pcs) {
    for (const [g, mine, remote] of pcSplit(pcs, page)) {
      nodes.push(pcHead(g, mine.length + remote.length));
      if (PJ_FOLD.has(g.name) || !(mine.length + remote.length)) continue;
      const box = el("div", { class: "pl-list" }, ...mine.map(prjRow), ...remote.map(x => pcRow(g, x)));
      nodes.push(box);
      if (mine.length) card = box;
    }
  } else {
    for (const [label, group] of prjGroups(page)) {
      nodes.push(el("div", { class: "sec pl-sec", text: label }));
      nodes.push(card = el("div", { class: "pl-list" }, ...group.map(prjRow)));
    }
  }
  if (rest > 0 && card) card.append(moreRow(`프로젝트 ${rest}개 더 보기`, () => { PJ.more += PJ_PAGE; pjPaintRows(); }));
  if (!rows.length && !(pcs && nodes.length)) nodes.push(el("div", { class: "empty pl-empty", text: searching ? "찾는 프로젝트가 없어요" : PJ.view === "need" ? "확인할 프로젝트가 없어요" : PJ.view === "run" ? "지금 진행 중인 프로젝트가 없어요" : PJ.view === "done" ? "끝낸 프로젝트가 없어요" : "아직 프로젝트가 없어요" }));
  // The built-in 커스텀 page is the owner's settings list: always reachable, never part of the filters.
  if (showBuiltin) {
    nodes.push(el("div", { class: "sec pl-sec pl-gh", role: "presentation", text: "내 설정" }));
    nodes.push(el("div", { class: "pl-list" },
      el("button", { class: `pl-row sub${current === "project" && ppCur === builtin.key ? " on" : ""}`, type: "button", "data-key": builtin.key, onclick: () => go("project", builtin.key) },
        el("span", { class: "ico" }, icon("projects")),
        el("span", { class: "pl-b" }, el("span", { class: "pl-1" }, el("span", { class: "pl-n", text: builtin.name })), el("span", { class: "pl-s" }, el("span", { class: "pl-sw", text: "내가 바꾼 것을 봐요" }))),
        el("span", { class: "li-end" }, icon("chev", "chev")))));
  }
  clear(box).append(...nodes);
}
function renderProjects() {
  const box = $("#v-projects");
  if (!PRJ) { delete box.dataset.sig; clear(box).append(emptyNode(PRJ_FAIL ? "프로젝트를 불러오지 못했어요" : "불러오는 중…", PRJ_FAIL ? () => prjLoad() : null)); return; }
  const list = PRJ.projects || [];
  if (!list.length) {
    delete box.dataset.sig;
    const none = emptyNode("아직 프로젝트가 없어요. 채팅에서 오래 걸리는 작업을 맡기면 여기에 생겨요");
    none.append(el("div", { class: "pl-empty-a" }, el("button", { class: "btn tonal sm", type: "button", "data-k": "chat", onclick: () => openTarget(MAIN, lastChatView()) }, "채팅 열기")));
    clear(box).append(none);
    return;
  }
  // The shell (search box, chip and list slots) is built once: rebuilding it on a data refresh would drop the search box's focus and caret.
  // The chips and rows below follow the data on their own.
  if (!box.querySelector("#pl-shell")) clear(box).append(pjShell());
  pjPaintChips();
  pjPaintRows();
}
