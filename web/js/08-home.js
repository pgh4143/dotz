/* ---------- home: every status at a glance, each card navigates ---------- */
let HQ = null, homeTimer;
let HOME_READY = false;   // the first loadHomeData has landed: until then rows arriving in pieces are the first paint, and move nothing
async function loadHomeData() {
  clearTimeout(homeTimer);
  // the other computers' snapshot, read ahead for 모니터링 and a peer's item opened by link; 홈 draws none of it, so its first paint does not wait for a slow peer
  if (typeof pqLoad === "function") pqLoad().catch(() => {});
  await Promise.all([
    api("/api/quota").then(q => { HQ = q; noteQuota(q); }, () => { HQ = { error: true }; }),
    loadProviderData().catch(() => {}),
    loadMonitors(),
  ]);
  HOME_READY = true;
  if (current === "home") { renderHome(); homeTimer = setTimeout(loadHomeData, 60000); }
}
function tapCard(to, ...kids) {
  const open = () => typeof to === "function" ? to() : go(to);
  const c = el("div", { class: "card tap", role: "link", tabindex: "0", onclick: open, onkeydown: ev => { if ((ev.key === "Enter" || ev.key === " ") && ev.target === c) { ev.preventDefault(); open(); } } }, ...kids);
  return c;
}
// tone: "" | "warn" | "err" colours the whole card the same way for every kind of item that needs the owner.
const itemCard = (to, tone, ...kids) => { const c = tapCard(to, ...kids); if (tone) c.classList.add("att", ...(tone === "err" ? ["err"] : [])); return c; };
const menuBtn = id => el("button", { class: "ib", type: "button", "aria-label": "설정", title: "설정", "aria-haspopup": "listbox", "aria-expanded": "false", onclick: ev => { ev.stopPropagation(); homeMenu(ev.currentTarget, id); } }, icon("more"));

// The ⋯ menu of a home card: only what an existing endpoint already does for that item, built from the state at click time.
function homeMenu(anchor, id, inChat) {
  const acts = [];
  const add = (label, run) => acts.push({ value: acts.length, label, run });
  if (id.startsWith("group:")) {
    const kind = id.slice(6);
    add("카드로 나누기", () => setHomeGroup(kind, false));
    add(`${HOME_KINDS[kind][0]} 열기`, () => go(HOME_KINDS[kind][1]));
    homeMoveActs(id, inChat, add);
    return showMenu(anchor, acts, { onPick: i => acts[i].run(), end: true });
  }
  if (id.startsWith("notices:")) {
    const [label, to] = { alert: ["알림", nscGo], worklog: ["작업내역", () => openTarget("worklog", "chat")], watch: ["모니터링", () => go("monitoring")] }[id.slice(8)];
    add(`${label} 열기`, to);
    homeMoveActs(id, inChat, add);
    return showMenu(anchor, acts, { onPick: i => acts[i].run(), end: true });
  }
  if (id === MAIN || isLaneT(id)) {
    const key = id === MAIN ? "orchestrator" : id, name = targetName(id), restartNote = id === MAIN ? "어시스턴트가 다시 시작돼요." : "";
    const cur = M && (id === MAIN ? M.orchestrator : (M.lanes || []).find(l => `lane:${l.name}` === id));
    if (cur) {
      add("모델 변경…", () => showMenu(anchor, modelItems(key, cur.model, ""), { value: cur.model, onPick: v => busy(null, () => putModel(key, { model: v }, restartNote, `${modelName(v)} · ${cur.thinking}`)) }));
      add("추론 강도…", () => showMenu(anchor, effortItems(cur.model, cur.thinking), { value: cur.thinking, onPick: v => busy(null, () => putModel(key, { thinking: v }, restartNote, `${modelName(cur.model)} · ${thinkKo(v)}`)) }));
      add("모델 설정", () => openModels(key));
    }
    if (id === MAIN) {
      if (S && S.orchestrator && S.orchestrator.status === "working") add("중단", () => abortOrch(null));
      if (acts.length) acts.push({ sep: true });   // a restart stops what is running: set apart from the rest
      add("재시작", () => restartOrch(null));
    } else {
      const n = laneOf(id);
      add("중단", () => busy(null, async () => { await api(`/api/lanes/${enc(n)}/abort`, "POST", {}); toast("작업을 중단했어요"); refreshState(); }));
      if (acts.length) acts.push({ sep: true });
      add("재시작", () => busy(null, async () => { if (!await ask(`${n} 재시작`, "작업 중인 내용이 있으면 멈추고 세션을 다시 시작해요.", "재시작")) return; await api(`/api/lanes/${enc(n)}/restart`, "POST", {}); toast("재시작했어요"); refreshState(); }));
    }
  } else if (id.startsWith("prov:")) {
    const p = ((P && P.providers) || []).find(x => x.id === id.slice(5));
    if (p && p.can_login) add(isConnected(p) ? "다시 로그인" : "로그인", () => startLogin(p));
    if (p && (p.can_logout ?? p.removable)) add(p.auth === "api_key" ? "키 삭제" : "로그아웃", () => busy(null, () => logoutProvider(p)));
    add("계정 열기", () => go("accounts", p ? p.id : ""));
  } else if (id.startsWith("custom:")) {
    for (const a of window.dotzCustom ? dotzCustom.menuActs(id.slice(7)) : []) add(a.label, a.run);
  } else if (id.startsWith("ctx:")) {
    const c = ((C && C.processes) || []).find(x => x.name === id.slice(4));
    if (c && c.running && !(c.compaction && (c.compaction.state === "queued" || c.compaction.state === "compacting"))) add("압축", () => busy(null, async () => {
      const r = await api("/api/compact", "POST", { target: c.name });
      toast(r.state === "queued" ? `${c.name}: 작업 중이라 끝나면 압축해요` : `${c.name}: 압축을 시작했어요`);
      loadContext(true);
    }));
    add("컨텍스트 열기", () => go("context"));
  } else {
    add("사용량 열기", () => go("usage"));
    add("계정 열기", () => go("accounts"));
  }
  const kind = homeKind(id);
  if (kind && !inChat && !homeGroups.has(kind)) add(`${HOME_KINDS[kind][0]} 한 카드로 묶기`, () => setHomeGroup(kind, true));
  homeMoveActs(id, inChat, add);
  showMenu(anchor, acts, { onPick: i => acts[i].run(), end: true });
}
// 앞으로 / 뒤로 옮기기: the drag (a long press on a phone) said as a menu item, one place in the reading order per pick.
function homeMoveActs(id, inChat, add) {
  if (inChat || !homeBoard) return;
  const ids = homeBoard.order(), i = ids.indexOf(id);
  if (i < 0) return;
  if (i > 0) add("앞으로 옮기기", () => homeBoard.moveBefore(id, ids[i - 1]));
  if (i < ids.length - 1) add("뒤로 옮기기", () => homeBoard.moveBefore(id, ids[i + 2] || null));
}

// Last meaningful line of each running lane, kept from the live activity stream (fetched once per lane for the first sight).
const LAST = {}, LAST_ASKED = new Set();
let homeSoonT;
const homeSoon = () => { clearTimeout(homeSoonT); homeSoonT = setTimeout(() => { if (current === "home") renderHome(); }, 500); };
// A tool call said in Korean: the kind verb, plus the file's base name for a read or an edit ("파일 수정 · conversations.ts").
const TOOL_VERB = { 명령: "명령 실행", 수정: "파일 수정", 읽기: "읽기", 검색: "검색" };
function toolLineKo(a) {
  const k = kindOf(a.tool), verb = TOOL_VERB[k] || k;
  if (k !== "수정" && k !== "읽기") return verb;
  let p = "";
  try { const o = JSON.parse(a.args); if (o && typeof o === "object") p = [o.path, o.file_path, o.filePath, o.file].find(v => typeof v === "string" && v) || ""; } catch { /* args may be cut off */ }
  if (!p) { const l = laneToolLabel(a); if (/^[^\s]+$/.test(l) && /[./]/.test(l)) p = l; }
  const base = p.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  return base ? `${verb} · ${base}` : verb;
}
// The runtime's status rows are English internals ("compacting context", "retrying (attempt 2/3)", "orchestrator started (...)"):
// 홈 says the known ones in Korean and skips the rest; a quoted note ("> ...") is shown as written.
function statusLineKo(t) {
  const s = String(t ?? "");
  if (s.startsWith("> ")) return oneLine(s.slice(2));
  const k = [[/^compacting context/, "컨텍스트 압축 중"], [/^context compacted/, "컨텍스트 압축 완료"], [/^retrying/, "다시 시도 중"], [/^aborted/, "중단됨"], [/^model fallback/, "다른 모델로 전환"]].find(([re]) => re.test(s));
  return k ? k[1] : /[가-힣]/.test(s) ? oneLine(s) : "";
}
function actLine(a) {
  switch (a.type) {
    case "text": return friendlyLine(a.text);
    case "error": return oneLine(a.text ?? "");
    case "status": return statusLineKo(a.text);
    case "tool_call": return toolLineKo(a);
    default: return "";
  }
}
function laneLastFetch(name) {
  if (LAST[name] !== undefined || LAST_ASKED.has(name)) return;
  LAST_ASKED.add(name);
  api(`/api/activity?source=${enc(`lane:${name}`)}&limit=30`).then(r => {
    const items = (r && r.items) || [];
    for (let i = items.length - 1; i >= 0 && LAST[name] === undefined; i--) { const s = actLine(items[i]); if (s) LAST[name] = s; }
    if (LAST[name] === undefined) LAST[name] = "";
    homeSoon();
  }, () => {});
}

// The 알림 / 작업내역 / 모니터링 cards: data live in 30-notices.js and 30-monitoring.js; they repaint from its live frames (homeSoon) and open the conversation or screen.
const hcState = () => (NT.loaded ? "" : NT.failed ? "불러오지 못했어요" : "불러오는 중…");
// The same for what comes from the hub's state (세션 · 할일 · 지금 진행 중): not loaded yet says so, a failed load says so, and only a loaded empty one says 없어요.
const hmState = () => (S && !S.seeded ? "" : selfDown ? "불러오지 못했어요" : "불러오는 중…");
const hcCard = (open, ...kids) => { const c = tapCard(open, ...kids); c.classList.add("hc"); return c; };
const hcDot = tone => el("span", { class: `nt-dot tone-${tone || "none"}`, "aria-hidden": "true" });
// A generic title (작업 기록, 알림) says nothing in a card's row: the row shows the entry's first line instead.
const hcLine = n => { const t = ntPlain(n.title); return !t || t === "작업 기록" || t === "작업내역" || t === "알림" ? ntPlain(String(n.text || "").split("\n")[0]) || t || "알림" : t; };
// Each row opens its own item by kind (30-notices.js noticeOpen); a tap beside the rows still opens the card's conversation.
// The dot is the 알림 screen's (31-notices-screen.js nscTone): a login that waits or a warning is orange, not red.
const hcNotices = (list, cap) => el("div", { class: "hc-list", "data-cap": cap }, ...list.map(n => el("div", { class: "hc-row", role: "link", tabindex: "0", onclick: ev => { ev.stopPropagation(); noticeOpen(n); }, onkeydown: ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ev.stopPropagation(); noticeOpen(n); } } }, hcDot(n.waits === "login" || n.tone === "warn" ? "ask" : n.tone), el("span", { class: "tb" }, el("span", { class: "t", text: hcLine(n) }), ntLaneNote(n) ? el("span", { class: "n", text: ntLaneNote(n) }) : null), ...resultMarker(`n:${n.id}`, resultChips(n)), el("span", { class: "m", text: ntWhen(n) }), ntNeeds(n) ? ntIgnoreBtn(n) : null)));
// Gateway restarts are kept in the store (born read) but never shown on 홈 (owner 2026-10-19: restarts are not his news).
const hcRecent = pick => NT.items.filter(n => pick(n) && !/^게이트웨이(?: 재시작했어요|를 다시 시작했어요)/.test(String(n.text || ""))).sort((a, b) => ntAt(b) - ntAt(a));
// Only what is news: a question that waits is a row of 답변 필요 above, so it is not counted or listed here a second time; a gateway question it
// handles itself is not asked there (09-needs-you.js nyHandled), so it is news here.
const hcFyi = n => !n.read && ntHomeAlert(n) && (!ntNeeds(n) || nyHandled(n));
// One head for every home card: [status dot] title, an optional count, an optional grey note, in the quiet head step (.ch.lo) so 답변 필요 above is the one card title that leads. An empty card keeps the head and says why under it (hcNone); what is absent leaves no slot (docs/ui-principles.md 13).
const hcHead = (title, o = {}) => el("div", { class: "ch lo" }, o.dot ? el("span", { class: `dot ${o.dot}` }) : null, el("h3", { text: title }),
  o.n ? el("span", { class: "hc-n" }, ...[].concat(o.n)) : null, o.note ? el("span", { class: "hc-n", text: o.note }) : null, o.menu ? menuBtn(o.menu) : null);
const hcNone = text => el("div", { class: "hc-none", text });
// One rule for every list on 홈: a list marked data-cap holds all its rows, shows LIST_CAP of them and scrolls inside its card (.list-cap, 05-log.css).
// The height is read from the sixth row, since rows differ per list and per item. A refresh rebuilds the lists: capPlaces reads each one's place and
// focused row before that, and capLists hands them to the new list.
const LIST_CAP = 6, CAP_FOCUS = "button, [tabindex]";
function capPlaces() {
  const kept = new Map(), act = document.activeElement;
  for (const l of document.querySelectorAll("#v-home [data-cap]")) if (l.scrollTop || l.contains(act)) kept.set(l.dataset.cap, [l.scrollTop, [...l.querySelectorAll(CAP_FOCUS)].indexOf(act)]);
  return kept;
}
function capLists(root, kept) {
  const lists = [...root.querySelectorAll("[data-cap]")], long = lists.filter(l => l.classList.toggle("list-cap", l.childElementCount > LIST_CAP));
  const heights = long.map(l => { const r = l.children[LIST_CAP - 1]; return r.offsetTop + r.offsetHeight; });   // every read before any write: one layout, however many lists
  long.forEach((l, i) => { if (heights[i]) l.style.maxHeight = `${heights[i]}px`; });
  for (const l of kept ? lists : []) {
    const place = kept.get(l.dataset.cap);
    if (!place) continue;
    l.scrollTop = place[0];
    const row = l.querySelectorAll(CAP_FOCUS)[place[1]];
    if (row) row.focus({ preventScroll: true });
  }
}
// 알림 is a card only while it has something to say: a loaded, empty one is not drawn (a loading or failed one stays, and so does every card while one is being moved).
// taken: the notices that are already a row of 답변 필요 (homeLogins), so one notice is on 홈 once.
function homeAlertCard(taken) {
  const fresh = hcRecent(hcFyi).filter(n => !taken.has(n.id)), state = hcState(), none = !!state || !fresh.length;
  if (!state && !fresh.length && !homeEdit) return null;
  return hcCard(nscGo, hcHead("알림", { menu: "notices:alert", n: !state && fresh.length ? String(fresh.length) : null }),
    none ? hcNone(state || "새 알림이 없어요") : hcNotices(fresh, "alert"));
}
function homeWorklogCard() {
  const recent = hcRecent(n => n.kind === "worklog" || n.kind === "result"), state = hcState(), none = !!state || !recent.length;
  return hcCard(() => openTarget("worklog", "chat"), hcHead("작업내역", { menu: "notices:worklog" }), none ? hcNone(state || "아직 작업내역이 없어요") : hcNotices(recent, "worklog"));
}
function homeMonitorCard() {
  const list = ntMons(), bad = list.filter(m => monStatus(m).key === "fail").length;
  const state = NM.loaded ? "" : NM.failed ? "불러오지 못했어요" : "불러오는 중…", none = !!state || !list.length;
  return hcCard(() => go("monitoring"), hcHead("모니터링", { menu: "notices:watch", n: bad ? [el("span", { class: "dot err" }), `실패 ${bad}`] : null }),
    none ? hcNone(state || "모니터링 중인 항목이 없어요") : el("div", { class: "hc-list", "data-cap": "watch" }, ...list.map(m => {
      // The same status the 모니터링 row shows (30-monitoring.js monStatus); the dot's colour classes are the notice tones.
      const st = monStatus(m);
      return el("div", { class: "hc-mon", "data-status": st.key }, hcDot({ ok: "done", warn: "ask", err: "fail" }[st.tone]), el("div", { class: "b" }, el("span", { class: "n", text: monTitle(m) }),
        el("span", { class: "s", text: [ntMonRun(m), st.text, ntMonNext(m)].filter(Boolean).join(" · ") })));
    })),
    list.length > LIST_CAP ? el("div", { class: "hc-more", text: `더 보기 · ${list.length - LIST_CAP}개` }) : null);
}

let homeBoard = null;
let homeEdit = false;   // a card is being moved (07-board.js opts.onEdit): the cards that are hidden while empty show, so one can be placed too
// Every card is as tall as its content (07-board.js fit): only the width is sized, half of the 12 columns by default so the cards make the prototype's two-column grid.
const HOME_FIT = { fit: true, min: { w: 6, h: 1 }, max: { w: 12, h: 1 } };
// Kinds of home items that can be bundled into one card (title, view the card opens); the bundled kinds are kept per browser.
const HOME_KINDS = { ctx: ["컨텍스트", "context"], limit: ["사용량", "usage"], prov: ["계정", "accounts"] };
const HOME_GROUPS_KEY = "dotz-home-groups";
const homeKind = id => { const k = id.split(":")[0]; return HOME_KINDS[k] ? k : null; };
let homeGroups = (() => { const v = lsJson(HOME_GROUPS_KEY, null); return new Set(Array.isArray(v) ? v : ["ctx", "limit", "prov"]); })();
function setHomeGroup(kind, on) {
  if (on) homeGroups.add(kind); else homeGroups.delete(kind);
  try { localStorage.setItem(HOME_GROUPS_KEY, JSON.stringify([...homeGroups])); } catch {}
  setTimeout(renderHome, 0);
}
// The one accent of a home card is a status dot: orange when it needs the owner, red when it failed.
const hcTone = t => t === "err" ? "err" : t ? "att" : "";
const hcKDot = t => t ? el("span", { class: `dot ${hcTone(t)}` }) : null;
// One item inside a bundle card: clicking it opens the item, its own ⋯ menu keeps the item's actions.
function homeRow(e) {
  const r = el("div", { class: "grow", role: "link", tabindex: "0", onclick: ev => { ev.stopPropagation(); e.open(); }, onkeydown: ev => { if ((ev.key === "Enter" || ev.key === " ") && ev.target === r) { ev.preventDefault(); ev.stopPropagation(); e.open(); } } },
    el("div", { class: "gm" }, ...e.row()), menuBtn(e.id));
  return r;
}
// Every item is its own card (each context process, each usage limit, each provider), except kinds the owner bundled (the default):
// those share one card with a row per item. The assistant is the summary strip on top.
// The newest meaningful line of what a target is doing: its loaded activity, else the lane's last fetched line, else its last text.
function nowLine(t) {
  const acts = ts(t).acts;
  for (let i = acts.length - 1; i >= 0 && i >= acts.length - 40; i--) { const s = actLine(acts[i]); if (s) return s; }
  if (isLaneT(t) && LAST[laneOf(t)]) return LAST[laneOf(t)];
  const l = isLaneT(t) && S ? S.lanes.find(x => x.name === laneOf(t)) : null, last = t === MAIN ? (S && S.orchestrator && S.orchestrator.lastText) : l && l.lastText;
  return last ? friendlyLine(last) : "";
}
// A preview line shows what the owner may read: never the [later] sentinel (a turn handed to a background worker), the handoff
// block, or an "Ask: " label. Same rule as hub/tone.ts previewSource.
const LATER_LINE = "백그라운드 작업 중";
const isLaterText = s => /^\s*(`|\*\*)?\[later\]\1\s*$/i.test(String(s ?? ""));
function previewSrc(raw) {
  const s = noHandoff(peerMsgLine(raw)).replace(/^\s*Ask:[ \t]*/i, "");
  return isLaterText(s) ? LATER_LINE : s;
}
const friendlyLine = raw => oneLine(previewLines(choiceFree(raw), 3).join(" "));
// Same rule as hub/tone.ts stripHandoff: the agent's leading "Ask: ... For you: ... Next: ..." block is not shown.
function noHandoff(text) {
  const m = /^\s*Ask:[^\n]*(?:\n(?!\s*\n)[^\n]*)*/.exec(text);
  if (!m || !/\bFor you:/.test(m[0])) return text;
  const rest = text.slice(m[0].length).replace(/^\s+/, "");
  return rest || ((/\bFor you:\s*([\s\S]*?)(?:\s+Now:[\s\S]*)?$/.exec(m[0]) || [])[1] || "").trim() || text;
}
function askOf(t) {
  if (!isLaneT(t) || !S) return false;
  const l = S.lanes.find(x => x.name === laneOf(t));
  return !!(l && l.lastText && parseTone(noHandoff(String(l.lastText))).tone === "ask" && l.status !== "working");
}
// A row's preview is the conversation's state said in Korean (the run line above the composer, 41-runstate.js), not its last message.
const homeRunLine = t => { const r = S && S.runs && S.runs[t === MAIN ? "main" : t]; return r ? runText(r) : ""; };
// end: the right end of the row. Not given: the state word. A text: a time (the dot says the state; the aria-label keeps the word). "": nothing.
function homeNowRow(t, label, tone, head, end) {
  const i = targetInfo(t), st = tone === "att" ? "warn" : targetState(t)[1], subs = SUBS[subsSourceOf(t)] || [], done = subs.filter(s => s.status !== "running").length;
  const lane = isLaneT(t) && S ? S.lanes.find(x => x.name === laneOf(t)) : null;
  if (lane && !homeRunLine(t)) laneLastFetch(lane.name);
  // A session waiting on the owner says its question, so the row tells what to answer.
  const line = (tone === "att" && i.ask && friendlyLine(i.ask.text)) || homeRunLine(t) || nowLine(t) || modelChipText(String(liveModel(t).sel || "").split(":")[0]) || targetState(t)[0];
  // A session moved to a fallback model says so on its row (the board has no session card): the model it runs now and why.
  const lv = lane ? liveModel(t) : null, extra = lv && lv.fallback ? el("span", { class: "smodel" }, selText(lv.sel), fbTag(lv.fallback, lv.conf)) : null;
  // a session: title, project, status, one tap to its chat
  const row = lane ? sessionRow(lane, { line, extra, head, ...(tone === "att" ? { word: label, tone: "warn" } : {}) }) : el("button", { class: "hr", type: "button", onclick: () => openTarget(t, lastChatView()), "aria-label": `${targetName(t)} · ${label}` },
    el("span", { class: `dot ${st}` }),
    el("span", { class: "hb" }, el("span", { class: "hn1" }, el("span", { class: "nm", text: targetName(t) })), el("span", { class: "ha", text: line })),
    subs.length ? el("span", { class: "hp", title: "서브에이전트 끝난 수 / 전체", text: `서브에이전트 ${done}/${subs.length}` }) : null,
    el("span", { class: `hs ${st}`, text: label }));
  return end === undefined ? row : homeEnd(row, end);
}
function homeEnd(row, time) {
  const hs = row.querySelector(":scope > .hs");
  if (hs && time) hs.replaceWith(el("span", { class: "hs", text: time })); else if (hs) hs.remove();
  return row;
}
// How long a running conversation has run, and how long ago a finished one ended (the gateway's clock, 06-subagents.js workNow).
function homeSince(t) {
  const r = runOf(t), s = r && (r.kind === "working" || r.kind === "waiting") && r.since ? runSince(r.since) : "";
  return s === "방금" ? "방금 시작" : s ? `${s}째` : "";
}
function homeAgo(at) {
  const m = workMin(workNow() - at);
  return m < 1 ? "방금" : m < 60 ? `${m}분 전` : `${Math.floor(m / 60)}시간 전`;
}
const homeDoneAgo = t => { const r = runOf(t), at = r && Date.parse(r.since || ""); return at ? homeAgo(at) : ""; };
// An app conversation with a session of its own (a mail, a project channel, an app's settings: /api/state `convs`) runs apart from the
// assistant, so while its turn or its worker runs it is a row here: its title (the mail's subject, the app or project name), what it
// does now (its run line: the tool-call intent or plan task, elapsed), one tap to that conversation in its app view (go: a mail opens in 모니터링).
const convWebT = t => t === "web:alert" ? "alert" : t === "web:worklog" ? "worklog" : t;
const convRunning = c => { const r = runOf(c.target); return !!r && (r.kind === "working" || runBusy(c.target)); };
function homeConvRow(c) {
  const t = convWebT(c.target), r = runOf(c.target), name = c.name || targetName(t), state = r.kind === "working" ? "작업 중" : "진행 중", end = homeSince(c.target);
  return el("button", { class: "hr", type: "button", "data-t": t, onclick: () => go("chat", t), "aria-label": `${name} · ${state} · 대화 열기` },
    el("span", { class: "dot pri" }),
    el("span", { class: "hb" }, el("span", { class: "hn1" }, el("span", { class: "nm", text: name })), el("span", { class: "ha", text: runText(r) })),
    end ? el("span", { class: "hs", text: end }) : null);
}
// The two rows of 답변 필요 for what the apps hold: a title, the count per source under it (most first, none with 0) and the total as a badge at the right.
const countsLine = by => [...by].filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).map(([name, c]) => `${name} ${c}`).join(" · ");
function homeCountRow(k, title, by, n, open) {
  const sub = countsLine(by);
  return el("button", { class: "hr", type: "button", "data-k": k, onclick: open, "aria-label": `${title} · ${n}건` },
    el("span", { class: "hb" }, el("span", { class: "hn1" }, el("span", { class: "nm", text: title })), el("span", { class: "ha", text: sub })),
    el("span", { class: "nb unreplied", "aria-hidden": "true", text: n > 99 ? "99+" : String(n) }));
}
// 미답장 (hub/unreplied.ts): the comments the owner has not answered, per app; a tap opens the app when it is the only source, else 모니터링.
function homeOwedRow(owed) {
  const by = new Map(owed.map(it => [it.name, it.unreplied]));
  return homeCountRow("owed", "답 안 한 댓글", by, owed.reduce((c, it) => c + it.unreplied, 0), () => go("monitoring", owed.length === 1 ? owed[0].key : undefined));
}
// 답장 대기: the drafts that wait for the owner's check (a draft to send or a failed send, of every computer; rqRows, 30-replies.js), per source; a tap opens the screen.
function homeRepliesRow(rows) {
  const by = new Map();
  for (const r of rows) { const k = r.app || "기타"; by.set(k, (by.get(k) || 0) + 1); }
  return homeCountRow("replies", "답장 초안 확인", by, rows.length, () => rqOpen());
}
// 할일 (/api/state `waitlist`, hub/waitlist.ts): what was received but has not started, oldest first. A row is its place in line and a plain title;
// work deferred to the usage-limit reset also says when it resumes (resume_at). It leaves by itself once the work starts.
const limitBadge = t => { const d = new Date(t || NaN); return isNaN(d) ? "한도 리셋되면 재개" : `한도 리셋되면 재개 (${d.toLocaleTimeString("en-GB", { ...KST, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })})`; };
function homeTodoRow(d, i) {
  const open = d.target && validTarget(convWebT(d.target)) ? () => go("chat", convWebT(d.target)) : null;
  return el(open ? "button" : "div", { class: open ? "hr" : "hr st", "data-wait": d.id, ...(open ? { type: "button", onclick: open } : {}) },
    el("span", { class: "hq", text: `${i + 1}` }),
    el("span", { class: "hb" }, el("span", { class: "hn1" }, el("span", { class: "nm", text: d.title })), d.next ? el("span", { class: "ha", text: d.next }) : null),
    el("span", { class: "hs", text: d.kind === "limit" ? limitBadge(d.resume_at) : "순서 대기" }));
}
// Rows of 홈 already shown: only a row that newly appears rises in (not the first paint, nor before the lists have loaded).
const HOME_ROWS = new Set();
// A background task that finishes while 홈 is open stays in its row of 지금 진행 중 for a few seconds, and that same row changes to 완료 in place
// (motionSwap) before it moves to 최근 끝난 작업: no new card appears. HC_WST: work id -> the status last seen; HC_SETTLE: id -> { at, swapped }.
const HC_WST = new Map(), HC_SETTLE = new Map(), HC_KEEP = 6000;
function hcSettled() {
  const work = (S && S.work) || [];
  for (const w of work) {
    if (HC_WST.get(w.id) === "running" && w.status === "done" && workNow() - (w.ended_at || 0) < HC_KEEP) {
      HC_SETTLE.set(w.id, { at: Date.now(), swapped: false });
      setTimeout(() => { if (current === "home") renderHomeNow(); }, HC_KEEP + 100);
    }
    HC_WST.set(w.id, w.status);
  }
  const out = [];
  for (const [id, s] of HC_SETTLE) {
    const w = work.find(x => x.id === id);
    if (!w || w.status !== "done") HC_SETTLE.delete(id);
    else if (Date.now() - s.at >= HC_KEEP) { HC_SETTLE.delete(id); HOME_ROWS.add(`ended-work|${id}`); }   // it moves down without rising in again
    else out.push(w);
  }
  return out;
}
// What a finished job made, one chip each under its row (hub/result-refs.ts): a file (name + kind and size; a text file opens in the reader,
// another in a tab), a commit (its page) and a link (a new tab). A job that names none gets nothing. `x`: a work item, a notice or a report.
const linkName = u => { try { const x = new URL(u), p = x.pathname.split("/").filter(Boolean); return x.host.replace(/^www\./, "") + (p.length ? `/${p.slice(-2).join("/")}` : ""); } catch { return u; } };   // not a URL: its text as is
function resultChips(x) {
  const fs = x && Array.isArray(x.files) ? x.files.filter(f => f && f.path) : [], ls = x && Array.isArray(x.links) ? x.links.filter(l => l && /^https?:\/\//.test(l.url)) : [];
  if (!fs.length && !ls.length) return null;
  return el("div", { class: "hrx-f", onclick: ev => ev.stopPropagation(), onkeydown: ev => ev.stopPropagation() },   // a chip acts, not the row around it
    ...fs.map(f => { const name = f.name || String(f.path).split("/").pop(); return fileChip(name, fileMeta(name, f.size), VIEW_RE.test(name) ? { onclick: () => viewer(f.path, name, f.pc) } : { href: fileUrl(f.path, false, f.pc) }); }),
    ...ls.map(l => l.kind === "commit" ? fileChip(l.hash, "커밋", { href: l.url, icon: "code" }) : fileChip(linkName(l.url), "링크", { href: l.url, icon: "open" })));
}
// A finished row with its chips under it: a session row (.hr) takes a finished task's shape (workRow); a list row (.li) is wrapped as is.
// `key`: a 홈 row, which shows the count marker instead (resultMarker).
const laneResult = t => NT.items.find(n => n.kind === "result" && n.key === t);
function withResults(row, chips, key) {
  if (!chips) return row;
  if (!row.classList.replace("hr", "hrx-m")) return el("div", { class: "li-res" }, row, chips);
  const box = el("div", { class: "hr hrx", "data-t": row.dataset.t }, row);
  return key ? markerFirst(box, row, resultMarker(key, chips)) : (box.append(chips), box);
}
// The count marker sits before the row's state word (owner 2026-11-09, "결과물이 완료나 시간 앞에"): the word leaves the tap area (.hrx-m) for the row's
// end, after the marker, so it stays in one column with the rows without results; a tap on it still opens the row.
function markerFirst(box, m, marker) {
  const hs = m.querySelector(":scope > .hs");
  if (!hs || !marker.length) { box.append(...marker); return box; }
  hs.onclick = () => m.click();
  box.append(marker[0], hs, ...marker.slice(1));
  return box;
}
// 홈 shows how many results a finished row made, not the chips (owner 2026-11-09, "개수만 표시"): the marker (.hrx-n) puts the same chips under its row, one row
// at a time, and a second press or Escape takes them away. `key` names the row, so the open one stays open when 홈 repaints.
let homeResOpen = "";
function resultMarker(key, chips) {
  if (!chips) return [];
  const n = chips.childElementCount, open = homeResOpen === key;
  const b = el("button", { class: "hrx-n", type: "button", "aria-expanded": String(open), "aria-label": `결과 ${n}개 보기`,
    onclick: ev => { ev.stopPropagation(); if (b.getAttribute("aria-expanded") === "true") resultHide(b); else resultShow(b, chips, key); },
    onkeydown: ev => { if (ev.key !== "Escape") { ev.stopPropagation(); return; } if (b.getAttribute("aria-expanded") === "true") { ev.preventDefault(); ev.stopPropagation(); resultHide(b); } } },
    icon("clip"), el("span", { text: `결과 ${n}` }));
  chips.addEventListener("keydown", ev => { if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); resultHide(b); b.focus(); } }, true);
  return open ? [b, chips] : [b];
}
function resultShow(b, chips, key) {
  for (const o of document.querySelectorAll('.hrx-n[aria-expanded="true"]')) resultHide(o);
  homeResOpen = key;
  b.setAttribute("aria-expanded", "true");
  b.parentElement.append(chips);   // under the whole row, after its state word
}
function resultHide(b) {
  const f = b.parentElement && b.parentElement.querySelector(":scope > .hrx-f");
  if (f && f.classList.contains("hrx-f")) f.remove();
  b.setAttribute("aria-expanded", "false");
  homeResOpen = "";
}
/* The prototype's home (site/prototype/s-work.js): a full-width column of the greeting and 답변 필요, then the
   two-column card grid. Every card keeps the product's data, links and empty states; the board (07-board.js) still moves and sizes them. */
const homeGreetWord = () => { const h = new Date().getHours(); return h < 5 ? "편안한 밤이에요" : h < 12 ? "좋은 아침이에요" : h < 18 ? "좋은 오후예요" : "좋은 저녁이에요"; };
// What runs on this computer now: the rows of 지금 진행 중 and the greeting's word both read this, so they cannot disagree. ask: nothing may run while a
// conversation waits on the owner's answer. waitT: the sessions waiting on him, rows of the card on top that count as nothing running. A stored state lists nothing (sessionsNow).
function homeRunning() {
  if (S && S.seeded) return { all: [], runT: [], waitT: [], convWork: [], runW: [], n: 0, ask: false };
  const laneT = l => `lane:${l.name}`, now = sessionsNow(), waitT = now.wait.map(laneT);
  const all = [MAIN, ...((S && S.lanes) || []).filter(laneAlive).map(laneT)], runT = [...(targetState(MAIN)[1] === "pri" ? [MAIN] : []), ...now.run.map(laneT)];
  // A conversation's own workers are listed under its row; a mail with no session whose worker is the assistant's (S.work) is that worker's row alone.
  const runW = workRunning(), mainBg = new Set(runW.map(w => w.id)), convs = (S && S.convs) || [];
  const convT = convs.filter(c => validTarget(convWebT(c.target)) && convRunning(c) && !(runOf(c.target).work && mainBg.has(runOf(c.target).work)));
  const convWork = convT.flatMap(c => [c, ...(c.work || []).filter(w => !w.queued).map(w => ({ ...w, target: convWebT(c.target), conv: true }))]);
  const asks = t => { const r = runOf(t); return !!r && waitsOnOwner(r); };
  return { all, runT, waitT, convWork, runW, n: runT.length + convWork.length + runW.length, ask: all.some(t => targetInfo(t).ask || asks(t)) || convs.some(c => asks(c.target)) };
}
// 대기 중 holds what started and then stopped: stopped by the owner, blocked, or at a usage limit, and its row says why. Stopped workers come from homeWorkHeld.
function homeHeld(t) {
  const i = targetInfo(t), r = runOf(t);
  if (i.ask || (r && waitsOnOwner(r))) return true;
  if (i.status === "rate-limited" || i.status === "stopped") return true;
  return !!r && (r.kind === "limited" || r.kind === "stopped" || (r.kind === "error" && !r.cancelled) || (r.kind === "idle" && !!r.reason));
}
const homeWorkHeld = w => w.status === "stalled" || !!w.cancelled;
// A session whose work ended within the hour (the gateway keeps a finished worker as long, hub/bgwork.ts) is a row of 최근 끝난 작업; older ones just rest.
const homeLaneDone = t => { const r = runOf(t); return isLaneT(t) && !!r && r.kind === "done" && workNow() - (Date.parse(r.since) || 0) < 3600000; };
// The greeting's word: 일하는 중 while anything on 지금 진행 중 runs, 쉬는 중 only when nothing does; a conversation stuck on the owner or the main session's own state says so.
function homeWord(h) {
  if (!S || S.seeded) return "연결 중";
  if (h.n) return "일하는 중";
  if (h.ask) return RUN_LABEL.waiting;
  const s = (S.orchestrator || {}).status, r = runOf(MAIN);
  return s !== "idle" ? statusKo(s) : r && r.kind === "error" && !r.cancelled ? RUN_LABEL.error : "쉬는 중";
}
// The greeting names the assistant and says what it does now, on which model, with how many sessions, on which computer and at what time;
// the fallback tag says why the model changed, and the ⋯ menu keeps the assistant card's actions now that its summary card is gone.
function homeGreeting(h) {
  const om = M && M.orchestrator, live = liveModel(MAIN), [base, level] = String(live.sel || "").split(":");
  const modelText = om && base ? (modelName(base).includes("-") ? modelChipText(base) : modelName(base)) : "";
  const lanes = ((S && S.lanes) || []).filter(l => laneAlive(l) && !l.waiting).length, me = (typeof prSelf === "function" && (prSelf() || {}).name) || "";
  const line = [`${iGa(botName)} ${homeWord(h)}`, modelText && `${modelText}${level ? ` · ${thinkKo(level)}` : ""}`, lanes ? `세션 ${lanes}개` : "", me, kstHM(Date.now())].filter(Boolean).join(" · ");
  const more = el("button", { class: "ib hgreet-more", type: "button", "aria-label": "어시스턴트 메뉴", "aria-haspopup": "listbox", "aria-expanded": "false", onclick: ev => homeMenu(ev.currentTarget, MAIN) }, icon("more"));
  return el("div", { class: "hgreet" },
    el("div", { class: "bigrow" }, el("div", { class: "big", text: homeGreetWord() }), more),
    el("div", { class: "meta", text: line }),
    live.fallback ? el("div", { class: "hgreet-fb" }, fbTag(live.fallback, live.conf)) : null, subLine("orchestrator"));
}
// While no model account is connected the bot cannot answer: one line and one button to the settings accounts screen, on 홈 and in the empty chat.
// It waits for the first read of /api/providers (P), so it never flashes while the list loads.
function acctConnectRow() {
  if (!P || P.providers.some(isConnected)) return null;
  return el("div", { class: "li hstrip", "data-connect-account": "" },
    el("span", { class: "tx" }, el("span", { class: "hd", text: "계정을 연결해야 답할 수 있어요" })),
    liEnd(el("button", { class: "btn tonal inrow", type: "button", onclick: () => go("accounts") }, "계정 연결")));
}
function renderHomeNow() {
  const now = $("#home-now"), box = $("#home-cards");
  if (!now || !box) return;
  const kept = capPlaces(), needs = nyList(), crit = needs.filter(x => x.crit).length;   // 09-needs-you.js: what only the owner can do, critical first
  // 홈 is this computer's alone (owner 2026-10-31): the other computers' items live in 모니터링, and the computer chip's dot says they want something.
  // A login that dropped is the first row of 답변 필요 card, the notice itself is left out of 알림 (taken); the drafts and the unanswered comments close the list as one row each.
  const logins = nyLogins(), taken = new Set(logins.map(x => x.id));
  const owed = monItems().filter(i => i.app && i.unreplied && !i.pc), drafts = rqRows().filter(r => r.state !== "sent");
  const list = nyListNode(needs, logins.map(x => x.node), [...(drafts.length ? [homeRepliesRow(drafts)] : []), ...(owed.length ? [homeOwedRow(owed)] : [])]);
  const waiting = list.querySelectorAll(":scope > .hr").length;
  // Four groups, and an item sits in exactly one (the table in docs/ui-spec.md): 할일 was received and has not started; 지금 진행 중 runs now (a turn, a
  // background worker); 대기 중 started and stopped; 최근 끝난 작업 ended within the hour (실패 · 이유 · 다시 맡기기). A session resting with nothing left is in none.
  // A session the run line calls busy (41-runstate.js runBusy: waiting on its own worker) runs too, so its 진행 중 label sits in this section, and one waiting on the owner stays on top of it.
  const h = homeRunning(), { all, runT, waitT, convWork, runW, n: working } = h, restT = all.filter(t => !runT.includes(t) && !waitT.includes(t));
  const settled = hcSettled(), bg = [...runW, ...settled], over = workEnded().filter(w => !settled.includes(w)), todo = (S && S.waitlist) || [];
  const heldT = restT.filter(homeHeld), heldW = over.filter(homeWorkHeld), ended = over.filter(w => !homeWorkHeld(w)), doneT = restT.filter(t => !heldT.includes(t) && homeLaneDone(t));
  const restRow = t => homeNowRow(t, targetState(t)[0], ""), doneRow = t => withResults(homeNowRow(t, targetState(t)[0], "", undefined, homeDoneAgo(t)), resultChips(laneResult(t)), `t:${t}`);
  // Above the grid, the prototype's full-width column: the greeting and 답변 필요. The replies the owner owes are the last two rows of that
  // card (the drafts to check, the comments not answered), each with a count per source; every row still opens its own item.
  const running = el("div", { class: "hn", "data-k": "running", "data-cap": "running" }, ...waitT.map(t => homeNowRow(t, SESSION_WORD.wait[0], "att", true)), ...runT.map(t => homeNowRow(t, targetState(t)[0], "", true, homeSince(t))), ...convWork.map(x => x.conv ? workRow(x) : homeConvRow(x)), ...bg.map(workRow),
    ...(working || waitT.length || bg.length ? [] : [hcNone(hmState() || "진행 중인 작업이 없어요")]));
  clear(now).append(homeGreeting(h), ...[acctConnectRow()].filter(Boolean),
    el("div", { class: "hneeds" },
      el("div", { class: "hn-h hneeds-h" }, el("h2", { text: "답변 필요" }), waiting ? el("span", { class: "sup", text: `${waiting}` }) : null, crit ? el("span", { class: "tag warn", text: `중요 ${crit}` }) : null),
      list));
  for (const w of settled) { const s = HC_SETTLE.get(w.id), row = s && !s.swapped ? now.querySelector(`[data-work="${CSS.escape(w.id)}"]`) : null; if (row) { s.swapped = true; motionSwap(row, () => {}); } }
  if (S && NT.loaded && HOME_READY) {
    const rows = [...now.querySelectorAll(".hr")], keys = rows.map(r => `${(r.closest(".hn") || {}).dataset?.k || ""}|${r.dataset.t || r.dataset.wait || r.dataset.work || r.dataset.mon || r.dataset.id || r.dataset.k || (r.querySelector(".nm") || {}).textContent || ""}`);
    const fresh = freshKeys(HOME_ROWS, keys);
    rows.forEach((r, i) => { if (fresh.has(keys[i])) motionIn(r, "top"); });
  }
  const endBox = $("#home-ended");
  if (endBox) clear(endBox).append(...[endedGroup()].filter(Boolean));
  // The grid after it, two cards to a row (07-board.js): 할일 · 알림 · 지금 진행 중 · 대기 중 · 최근 끝난 작업 · 모니터링 · 작업내역 ·
  // 사용량 · 컨텍스트 · 공급자 · the owner's cards, each half the row and as tall as its content. 할일 is always there and stays first (pin).
  if (!homeBoard || (openMenu && box.contains(openMenu.anchor))) { capLists($("#v-home"), kept); return; }   // a ⋯ menu is open: repaint after it closes
  const items = [], seen = new Set();
  const add = (id, node) => { if (!seen.has(id)) { seen.add(id); items.push({ id, node, head: ".ch", def: { w: 6, h: 1 }, ...HOME_FIT }); } };
  // 할일 is drawn while it has rows, while it loads, and while a card is moved; it stays first (pin).
  const todoLoaded = !!S && !S.seeded;
  if (todo.length || !todoLoaded || homeEdit) {
    add("now:todo", el("div", { class: "card" }, hcHead("할일", { n: todo.length ? `${todo.length}개` : null }), el("div", { class: "hn", "data-k": "todo", "data-cap": "todo" }, ...todo.map(homeTodoRow), ...(todo.length ? [] : [hcNone(hmState() || "아직 시작 전인 일이 없어요")]))));
    items[0].pin = true;
  }
  const alertCard = homeAlertCard(taken);
  if (alertCard) add("notices:alert", alertCard);
  add("now:running", el("div", { class: "card" }, hcHead("지금 진행 중", { n: working ? `${working}개` : null }), running));
  if (heldT.length || heldW.length) add("now:waiting", el("div", { class: "card" }, hcHead("대기 중"), el("div", { class: "hn", "data-k": "waiting", "data-cap": "waiting" }, ...heldT.map(restRow), ...heldW.map(workRow))));
  if (ended.length || doneT.length) add("now:ended", el("div", { class: "card" }, hcHead("최근 끝난 작업"), el("div", { class: "hn", "data-k": "ended-work", "data-cap": "ended-work" }, ...doneT.map(doneRow), ...ended.map(workRow))));
  add("notices:watch", homeMonitorCard());
  add("notices:worklog", homeWorklogCard());

  // entries per kind: {id, tone, open, card() (own floating card), row() (contents of its row in a bundle)}. A session is a row of
  // 지금 진행 중 / 대기 중 above, so it has no card here as well.
  const E = { ctx: [], limit: [], prov: [] };
  for (const p of ((C && C.processes) || []).filter(x => x.running)) {
    const id = `ctx:${p.name}`, pct = p.percent, who = p.kind === "lane" ? targetName(`lane:${p.name}`) : botName, v = pct != null ? `${pct}%` : `${num(p.tokens)} 토큰`;
    const bar = () => el("div", { class: `bar ${ctxTone(pct)}`, role: "progressbar", "aria-valuenow": Math.round(pct || 0), "aria-valuemin": 0, "aria-valuemax": 100 }, el("i", { style: `width:${Math.min(100, pct || 0).toFixed(1)}%` }));
    E.ctx.push({ id, tone: pct >= 80 ? "warn" : "", open: () => go("context"),
      card: () => [hcHead(`컨텍스트 · ${who}`, { dot: hcTone(pct >= 80 ? "warn" : ""), note: v, menu: id }), bar()],
      row: () => [el("div", { class: "kv" }, el("span", { class: "k" }, hcKDot(pct >= 80 ? "warn" : ""), who), el("span", { class: "v", text: v })), bar()] });
  }
  if (HQ && !HQ.error) {
    const provs = (HQ.providers || []).filter(p => (p.limits || []).length), multi = provs.length > 1;
    for (const pr of provs) for (const l of pr.limits) {
      if (l.scope) continue;
      const id = `limit:${pr.provider}:${l.id}`, f = limitFrac(l), name = limitLabel(pr, l, multi);
      const tone = limitHit(l) || (f != null && f <= .2) ? "warn" : "";
      E.limit.push({ id, tone, open: () => go("usage"),
        card: () => [hcHead(name, { dot: hcTone(tone), note: pctText(l), menu: id }), bar(l)],
        row: () => [el("div", { class: "kv" }, el("span", { class: "k" }, hcKDot(tone), name), el("span", { class: "v", text: pctText(l) })), bar(l)] });
    }
  }
  for (const p of (P && P.providers) || []) {
    if (!isConnected(p) && !needsAttention(p)) continue;
    const id = `prov:${p.id}`, bad = needsAttention(p), st = bad ? "로그인 필요" : p.auth === "api_key" ? "API 키" : "로그인됨";
    E.prov.push({ id, tone: bad ? "warn" : "", open: () => go("accounts", p.id),
      card: () => [hcHead(p.name || p.id, { dot: bad ? "att" : "ok", note: st, menu: id }),
        p.account ? el("div", { class: "sup", text: p.account }) : null],
      row: () => [el("div", { class: "row" }, el("span", { class: `dot ${bad ? "att" : "ok"}` }), el("span", { class: "nm", text: p.name || p.id }), el("span", { class: "sup", text: bad ? st : p.account || st }))] });
  }
  const loaded = { ctx: !!C, limit: !!HQ, prov: !!P };
  // 사용량 comes first (the prototype's 사용량 card), then 컨텍스트 and 공급자.
  for (const kind of ["limit", "ctx", "prov"]) {
    const list = E[kind];
    if (!homeGroups.has(kind)) { for (const e of list) add(e.id, itemCard(e.open, "", ...e.card())); continue; }
    const [title, view] = HOME_KINDS[kind], nAtt = list.filter(e => e.tone).length, none = !list.length;
    const empty = !loaded[kind] ? "불러오는 중…" : kind === "limit" && HQ.error ? "사용량을 불러오지 못했어요" : "없어요";
    add(`group:${kind}`, itemCard(view, "",
      hcHead(title, { dot: nAtt ? hcTone(list.some(e => e.tone === "err") ? "err" : "warn") : "", menu: `group:${kind}` }),
      none ? hcNone(empty) : el("div", { class: "glist", "data-cap": `group:${kind}` }, ...list.map(homeRow))));
  }

  // the owner's custom cards (web/custom.js) are board items like the rest; a half row by default, their own size when changed
  for (const it of window.dotzCustom ? dotzCustom.items() : []) if (!seen.has(it.id)) { seen.add(it.id); items.push({ ...it, def: { ...it.def, w: 6 }, head: it.head || ".ch" }); }
  // cards of data that has not arrived yet keep their saved place
  homeBoard.set(items, id => id.startsWith("custom:") ? !window.dotzCustom || dotzCustom.keep(id) : id.startsWith("ctx:") ? !C : id.startsWith("limit:") ? !HQ || !!HQ.error : id.startsWith("prov:") ? !P : false);
  capLists($("#v-home"), kept);
  homeBoard.measure();   // the lists were full length when the board measured them, and a row is as tall as its taller card
}

// The home screen always opens at its top: on load, on the tab, and when the installed app comes back to the front (23-installable-app-web.js, 99-boot.js).
const homeTop = () => { if (current === "home") { $("#views").scrollTop = 0; $("#appbar").classList.remove("scrolled"); } };
function renderHome() {
  const box = $("#home-cards");   // not id="home": the address #home would scroll the page down to that element, not to the top
  if (!box || current !== "home") return;
  $("#title").textContent = titles.home;
  if (!homeBoard) homeBoard = makeBoard(box, "home", { px: true, rows: true, onEdit: on => { homeEdit = on; renderHomeNow(); }, actions: [{ label: "카드 추가", run: () => window.dotzCustom && dotzCustom.add() }], onReset: () => { if (window.dotzCustom) dotzCustom.unhide(); setTimeout(renderHome, 0); } });
  renderHomeNow();
  window.dotzCustom && dotzCustom.home();
}

/* ---------- assistant actions ---------- */
const restartOrch = btn => busy(btn, async () => {
  if (!await ask("어시스턴트 재시작", "작업 중인 내용이 있으면 멈춰요.", "재시작")) return;
  await api("/api/orchestrator/restart", "POST", {});
  toast("재시작을 요청했어요");
  refreshState();
});
const abortOrch = btn => busy(btn, async () => {
  await api("/api/orchestrator/abort", "POST", {});
  toast("작업을 중단했어요");
  refreshState();
});

/* ---------- target: the one selection shared by 대화 (chat) and 터미널 (terminal) ---------- */
const MAIN = "main", TARGET_KEY = "dotz-target";
const isLaneT = t => t.startsWith("lane:");
// The two fixed conversations next to the main chat (Discord's alert and worklog channels): the gateway's posts live there, not in the main chat.
const isFixedT = t => t === "alert" || t === "worklog";
const FIXED_NAME = { alert: "알림", worklog: "작업내역" };
const laneOf = t => t.slice(5);
// A project orchestrator (hub/projectchat.ts): the one orchestrator in a project's work channel, target ch:<id>. Its
// conversation is the channel's messages; its process, model and log are the orchestrator's.
const isProjT = t => /^ch:\d+$/.test(t);
const projOf = t => t.slice(3);
const projTargets = () => Object.keys((S && S.channels && S.channels.work) || {}).map(id => `ch:${id}`);
// A mail (hub/mail.ts): one conversation per mail, target mail:<key>, answered by the orchestrator. MAILS: target -> { subject, from,
// source, at }, from GET /api/conversations and live mail events (31-conversations.js).
const isMailT = t => t.startsWith("mail:");
const mailOf = t => t.slice(5);
const MAILS = new Map();
// The other computers' items (34-peer-monitoring.js). of: conversation target -> {pc, key: the list item it sits under}; seen: unread/read pair last taken from a snapshot.
const PQ = { list: [], loaded: false, busy: false, again: false, at: 0, t: 0, of: new Map(), apps: new Map(), seen: new Map() };
// An app's settings conversation (hub/app-settings.ts, 32-app-settings.js): target settings:<app>, answered by the orchestrator.
const isSettingsT = t => t.startsWith("settings:");
const settingsApp = t => t.slice(9);
// A computer reached only through a messenger (hub/messenger.ts relay): target relay:<adapter>:<key>, the normal chat view over another transport (42-relay-chat.js).
// RELAY.name / RELAY.note: target -> the row's name and the adapter's one line, kept from the computer list (33-peers.js) so the title names it before that list is drawn;
// RELAY.back: the target to return to.
const isRelayT = t => /^relay:[a-z0-9-]+:./.test(t);
const RELAY = { name: {}, note: {}, back: MAIN, on: false };
const mailSender = f => String(f || "").replace(/<[^>]*>/g, "").replace(/["']/g, "").trim() || String(f || "");
const validTarget = t => t === MAIN || isFixedT(t) || isProjT(t) || (isLaneT(t) && t.length > 5) || (isMailT(t) && t.length > 5) || (isSettingsT(t) && t.length > 9) || isRelayT(t);
// A conversation that can have an agent session of its own (hub/session-key.ts CONV_KINDS): its target is its session key.
// A conversation whose chips pick its own model: a project, or a mail while mail has sessions of its own (else it runs on main).
const isModelT = t => isProjT(t) || (isMailT(t) && !!C && (C.conversation_kinds || []).includes("mail"));
const isConvT = t => isProjT(t) || isFixedT(t) || isMailT(t) || isSettingsT(t);
const sourceOf = t => t === MAIN || isConvT(t) || isRelayT(t) ? "orchestrator" : t;
const targetOfSource = s => s === "orchestrator" ? MAIN : s.startsWith("conv:") ? s.slice(5) : s;
// Owner-facing names: a project by its title (else its channel name), a session by its title (else its key).
// The name of a target on the computer `pc` it belongs to (an item from another gateway carries pc = {name, url, bot}): there the main chat is
// that gateway's own bot, never this one's (owner 2026-10-31: 맥북's question read "땃쥐" on 회사). No pc: this computer's targetName.
const pcTargetName = (t, pc) => !pc ? targetName(t) : t === MAIN || t === "chat" ? pc.bot || pc.name : isLaneT(t) ? t.slice(5) : isProjT(t) ? t : targetName(t);
const targetName = t => {
  if (t === MAIN) return botName;
  if (isFixedT(t)) return FIXED_NAME[t];
  if (isMailT(t)) return (MAILS.get(t) || {}).subject || "메일";
  if (isSettingsT(t)) return monSettingsName(t);
  if (isRelayT(t)) return RELAY.name[t] || t.split(":").slice(2).join(":");
  if (isProjT(t)) {
    let list = [];
    try { list = (PRJ && PRJ.projects) || []; } catch { /* PRJ (the project list, declared further down) is not set up yet */ }
    const p = list.find(x => x.recordKey === t || x.key === t);
    return (p && ((p.record && p.record.title) || p.name)) || ((S && S.channels && S.channels.work) || {})[projOf(t)] || "프로젝트";
  }
  const l = S && (S.lanes || []).find(x => x.name === laneOf(t));
  return (l && l.title) || laneOf(t);
};
// Every target the switcher and the needs-you count list: the main assistant, the projects, the live lanes.
const liveTargets = () => S ? [MAIN, ...projTargets(), ...S.lanes.filter(laneAlive).map(l => `lane:${l.name}`)] : [MAIN];
const modeOf = () => current === "activity" ? "term" : "chat";
let target = MAIN;
try { const v = localStorage.getItem(TARGET_KEY); if (v && v !== "alert" && validTarget(v)) target = v; } catch {}
// A settings conversation (a monitor's or an app's) shows the orchestrator busy only for a turn its own message started: TURN = target -> when that message
// was sent, until the answer comes. A peer's monitor is answered on that computer, so this one's status never applies to it.
const TURN = new Map();
function targetInfo(t) {
  if (isRelayT(t)) return { status: "", alive: true, known: true };
  if (isSettingsT(t)) { const o = (S && S.orchestrator) || {}, busy = o.status === "working" || o.status === "starting"; return { status: busy && (!TURN.has(t) || PQ.of.has(t)) ? "idle" : o.status || "", alive: true, known: true }; }
  if (t === MAIN || isFixedT(t) || isMailT(t)) { const o = (S && S.orchestrator) || {}; return { status: o.status || "", alive: true, known: true }; }
  if (isProjT(t)) { const o = (S && S.orchestrator) || {}, known = projTargets().includes(t); return { status: o.status || "", alive: known || !S, known }; }
  const l = S && S.lanes.find(x => x.name === laneOf(t));
  return l ? { status: l.status, alive: laneAlive(l), known: true, resumable: !!l.resumable, ask: l.pendingAsk && l.pendingAsk.text ? l.pendingAsk : null } : { status: "", alive: true, known: false };
}
const isWorking = t => { const i = targetInfo(t); return i.alive && (i.status === "working" || i.status === "starting"); };
// A running one shows only its state (owner 2026-11-01: no 중단 on the list; the conversation's send button stops it, 14-slash-commands.js),
// one the owner stopped offers 다시 맡기기 (06-subagents.js workRetry); a failed one is the agent's to take up (blue 이어서 처리 중, no button);
// the rest of the row goes to the conversation, or to the result message of finished work (18-lanes.js workGo).
function workRow(w) {
  // stalled: OmO still says running but the worker stopped working (hub/bgwork.ts); its session was woken to take it over.
  const run = w.status === "running", done = w.status === "done", rec = workRecovering(w), stall = w.status === "stalled", tone = workTone(w);
  const state = run ? "작업 중" : stall ? "멈춤" : done ? "완료" : w.cancelled ? "중단됨" : rec ? "이어서 처리 중" : "실패";
  // The right end of a running or finished row is a time (the dot and the aria-label say the state); a stopped or failed one keeps its word.
  const line = run || done ? w.model || "" : stall ? `${w.reason || "활동이 없어요"} · ${workAgo(w)}` : `${workFailText(w)} · ${workAgo(w)}`;
  const end = run ? workElapsed(w) : done ? workAgo(w) : state;
  const act = w.cancelled ? ["다시 맡기기", b => workRetry(w.id, b)] : null;
  const m = el("button", { class: "hrx-m", type: "button", onclick: () => workGo(w), "aria-label": `${w.description} · ${state} · ${run || stall || rec ? "대화로 가기" : "결과 보기"}` },
    el("span", { class: `dot ${tone}` }),
    el("span", { class: "hb" }, el("span", { class: "hn1" }, el("span", { class: "nm", text: w.description })), el("span", { class: "ha", text: line })),
    el("span", { class: run || done ? "hs" : `hs ${tone}`, text: end }));
  const row = el("div", { class: "hr hrx", "data-work": w.id }, m,
    act ? el("button", { class: "btn text", type: "button", style: "flex:none;margin-right:var(--sp-2)", "data-act": "retry", onclick: ev => act[1](ev.currentTarget), text: act[0] }) : null);
  return done ? markerFirst(row, m, resultMarker(`w:${w.id}`, resultChips(w))) : row;
}
