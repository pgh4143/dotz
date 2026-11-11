/* ---------- subagents: live progress per source ---------- */
let SUBS = {};
const subKo = { running: "진행 중", done: "완료", failed: "실패", aborted: "중단됨" };
const subTone = s => ({ running: "pri", done: "ok", failed: "err", aborted: "" })[s] || "";
// Subagents are listed per agent session (hub/convsessions.ts): a conversation of its own has `conv:<its target>`, the main chat `orchestrator`. A conversation never shows another's.
const subsSourceOf = t => (isConvT(t) ? `conv:${t}` : sourceOf(t));
const runningSubs = src => (SUBS[src] || []).filter(s => s.status === "running");

/* ---------- 백그라운드 작업: S.work from /api/state (hub/bgwork.ts). A request answered with [later] keeps working after its turn ended. ---------- */
// A worker still queued (hub/bgwork.ts) has not started: it is a row of 할일, and no list of running work names it.
const workRunning = () => ((S && S.work) || []).filter(w => w.status === "running" && !w.queued);
// What ended within the last hour (the gateway keeps it that long, hub/bgwork.ts FINISHED_KEEP_MS), newest first.
// A failure the agent already took up (hub/bgwork.ts handled) is over for the owner: it leaves the ended list.
const workEnded = () => ((S && S.work) || []).filter(w => w.status !== "running" && !(w.status === "failed" && !w.cancelled && w.handled));
// A failure no turn took up yet is being taken up by the agent itself (owner 2026-10-29), so it reads as progress, never as a retry request.
const workRecovering = w => w.status === "failed" && !w.cancelled && !w.handled;
// One background task's colour on every list; the table is in docs/ui-spec.md. A failure the agent took up, or work the owner stopped, is over: gray.
const workTone = w => w.queued ? "" : w.status === "running" || workRecovering(w) ? "pri" : w.status === "stalled" ? "warn" : w.status === "done" ? "ok" : w.cancelled || w.handled ? "" : "err";
// 실패 · <이유> (중단됨 for one the owner stopped): the reason is the gateway's own Korean line (hub/runstate.ts failureText).
const workFailText = w => (w.cancelled ? "중단됨" : `실패 · ${w.reason || "이유가 기록되지 않았어요"}`);
// 중단: the worker's process ends (POST /api/workers/:id/cancel); 다시 맡기기: its request goes to the orchestrator again in its own conversation.
const workCancel = (id, btn) => busy(btn, async () => {
  if (!await ask("백그라운드 작업 중단", "하던 작업을 멈춰요. 필요하면 다시 맡길 수 있어요.", "중단", true)) return;
  await api(`/api/workers/${enc(id)}/cancel`, "POST", {});
  toast("작업을 중단했어요");
  refreshState();
});
const workRetry = (id, btn) => busy(btn, async () => {
  await api(`/api/workers/${enc(id)}/retry`, "POST", {});
  toast("다시 맡겼어요");
  refreshState();
});
// A chat's own work: what was started for its open message; work no message claimed belongs to the main chat.
const workOfTarget = t => workRunning().filter(w => (w.target ? (t === MAIN ? w.target === "web" : w.target === t) : t === MAIN));
// The gateway's clock, not this device's, measures how long work has run (S.work_skew is set on every state refresh).
const workNow = () => Date.now() + ((S && S.work_skew) || 0);
const workMin = ms => Math.max(0, Math.floor(ms / 60000));
const workElapsed = w => (workNow() - w.started_at < 60000 ? "방금 시작" : `${workMin(workNow() - w.started_at)}분째`);
function workAgo(w) {
  const m = workMin(workNow() - (w.ended_at || w.started_at));
  return m < 1 ? "방금" : m < 60 ? `${m}분 전` : `${Math.floor(m / 60)}시간 전`;
}
// The left of the status line above the composer: what the background work is and how long it has run. The model is in the chip under the box, so the line does not say it.
const workLine = ws => `${ws[0].description} · ${workElapsed(ws[0])}${ws.length > 1 ? ` · 외 ${ws.length - 1}개` : ""}`;
// Re-read the state while work runs, so a finished or failed one leaves the line without waiting for another event.
setInterval(() => { if (!document.hidden && (workRunning().length || Object.values((S && S.runs) || {}).some(runMoving))) refreshState(); }, 15000);
function setSubs(source, items) {
  if (!source) return;
  SUBS[source] = Array.isArray(items) ? items : [];
  subsChanged(source);
}
async function loadSubs() {
  try { const r = await api("/api/subagents"); SUBS = (r && r.sources) || {}; } catch { return; }
  subsChanged();
}
function subsChanged(source) {
  if (current === "home") renderHome();
  renderSubs(); renderBars(); renderWorking(); paintWorkers();
  if (SUBD && (!source || (SUBD.id ? SUBD.source === source : SUBD.sources.includes(source)))) renderSubSheet();
}
function subLine(src) {
  const n = runningSubs(src).length;
  if (!n) return null;
  return el("div", { class: "subline", role: "button", tabindex: "0", onclick: ev => { ev.stopPropagation(); openSubs([src]); }, onkeydown: ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ev.stopPropagation(); openSubs([src]); } } }, el("span", { class: "dot pri" }), `서브에이전트 ${n}개 진행 중`);
}
function openTarget(t, view) { setTarget(t, true); go(isLaneT(t) && (view === "chat" || view === "activity") ? viewFor(t) : view); }
// A switcher pick: the chat/log view follows the picked target's own choice.
function pickTarget(t) { setTarget(t); const v = viewFor(t); if ((current === "chat" || current === "activity") && v !== current) go(v); }
// The subagents of the selected target: one summary line; clicking it (or any subagent count) opens the side panel,
// which lists them and shows one subagent's own transcript.
const spawnOrder = list => list.sort((a, b) => (a.started_at || 0) - (b.started_at || 0) || String(a.id).localeCompare(String(b.id)));
// Running ones only, in spawn order (oldest first, the newest added at the bottom); rows never reorder on progress.
function renderSubs() {
  const src = subsSourceOf(target);
  for (const box of document.querySelectorAll(".subs")) if (!box.closest(".pane-chat")) paintSubs(box, src);
  paneStrips();
}
// The line of source src in box: the open conversation's, or the one in an inactive pane (43-panes-mirror.js).
function paintSubs(box, src) {
  const run = spawnOrder(runningSubs(src)).length;
  const sig = JSON.stringify([src, run]);
  box.hidden = !run;
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  clear(box);
  if (!run) return;
  box.append(el("button", { class: "subsum", type: "button", onclick: () => openSubs([src]) },
    el("span", { class: "dot pri" }),
    el("span", { class: "nm", text: `서브에이전트 ${run}개 진행 중` }),
    icon("chev", "chev")));
}
let SUBD = null;
const sheet = $("#sheet"), shBody = $("#sh-body");
// SUBD: {sources} lists the running subagents of those sources; {source, id} shows one (with a way back when it was
// opened from a list).
function showSheet(d) {
  if (SUBD) clearTimeout(SUBD.timer);
  SUBD = { data: null, err: "", timer: 0, opener: SUBD ? SUBD.opener : document.activeElement, ov: SUBD ? SUBD.ov : null, ...d };
  if (!SUBD.ov) SUBD.ov = ovOpen(closeSheet);
  shBody.dataset.init = "";
  sheet.hidden = false;
  renderSubSheet();
  $("#sh-close").focus();
  if (SUBD.id) loadSub();
}
function openSubs(sources) { showSheet({ sources }); }
function openSub(source, id, from, title) { showSheet({ source, id, from, title }); }
function closeSheet() {
  if (!SUBD) return;
  clearTimeout(SUBD.timer);
  const o = SUBD.opener, ov = SUBD.ov;
  SUBD = null; sheet.hidden = true; clear(shBody);
  ovDone(ov);
  if (o && o.isConnected && o.focus) o.focus();
}
const subNow = d => (SUBS[d.source] || []).find(s => s.id === d.id) || {};
async function loadSub() {
  const d = SUBD;
  if (!d) return;
  try { d.data = await api(`/api/subagents/${enc(d.id)}?source=${enc(d.source)}`); d.err = ""; }
  catch (e) { d.err = e.message || "error"; }
  if (SUBD !== d) return;
  renderSubSheet();
  const st = (d.data && d.data.status) || subNow(d).status;
  clearTimeout(d.timer);
  if (st === "running") d.timer = setTimeout(loadSub, 3000);
}
function renderSubSheet() {
  const d = SUBD;
  if (!d) return;
  $("#sh-back").hidden = !d.from;
  if (!d.id) {
    const rows = d.sources.flatMap(s => spawnOrder(runningSubs(s)).map(x => [s, x]));
    $("#sh-name").textContent = `서브에이전트 ${rows.length}개 진행 중`;
    $("#sh-sub").textContent = d.sources.map(s => targetName(targetOfSource(s))).join(", ");
    $("#sh-tag").hidden = true;
    shBody.className = "sh-body";
    clear(shBody);
    if (!rows.length) shBody.append(el("div", { class: "a-div", text: "진행 중인 서브에이전트가 없어요" }));
    for (const [s, x] of rows) shBody.append(el("button", { class: "subrow", type: "button", onclick: () => openSub(s, x.id, d.sources) },
      el("span", { class: "dot pri" }),
      el("span", { class: "nm" }, el("b", { text: x.description || x.agent || "서브에이전트" }), x.intent || x.tool ? el("span", { class: "muted", text: firstLine(x.intent || x.tool) }) : null),
      d.sources.length > 1 ? el("span", { class: "tag", text: targetName(targetOfSource(s)) }) : null,
      x.started_at ? el("span", { class: "cc2-tm", text: workElapsed(x) }) : null));
    return;
  }
  const l = subNow(d), data = d.data || {};
  const st = data.status || l.status || "";
  $("#sh-name").textContent = data.description || l.description || d.title || data.agent || l.agent || "서브에이전트";
  $("#sh-sub").textContent = `${targetName(targetOfSource(d.source))} · 서브에이전트`;
  const tag = $("#sh-tag");
  tag.hidden = !st; tag.className = `tag ${subTone(st)}`; tag.textContent = subKo[st] || st;
  const m = modeOf(), items = data.items || [];
  const stick = !shBody.dataset.init || shBody.scrollTop + shBody.clientHeight >= shBody.scrollHeight - 40;
  const top = shBody.scrollTop;
  const opened = new Set();
  [...shBody.children].forEach((c, i) => { if (c.open || c.classList.contains("open")) opened.add(i); });
  shBody.className = `sh-body${m === "term" ? " term" : ""}`;
  clear(shBody);
  if (!d.data && !d.err) shBody.append(el("div", { class: "a-div", text: "불러오는 중…" }));
  else if (!items.length) shBody.append(el("div", { class: d.err ? "a-error" : "a-div", text: d.err ? "기록을 불러오지 못했어요" : "기록이 없어요" }));
  else {
    const ctx = { calls: new Map() };
    for (const a of items) { const n = m === "term" ? termNode(a, ctx) : actNode(a, ctx); if (n) shBody.append(n); }
    [...shBody.children].forEach((c, i) => { if (!opened.has(i)) return; if (c.tagName === "DETAILS") c.open = true; else { c.classList.add("open"); c.setAttribute("aria-expanded", "true"); } });
  }
  shBody.scrollTop = stick ? shBody.scrollHeight : top;
  shBody.dataset.init = "1";
}
$("#sh-close").append(icon("close"));
$("#sh-close").onclick = closeSheet;
$("#sh-back").append(icon("back"));
$("#sh-back").onclick = () => { if (SUBD && SUBD.from) openSubs(SUBD.from); };
document.addEventListener("keydown", ev => { if (ev.key === "Escape" && SUBD && !openMenu && !document.querySelector("dialog[open]:not([data-leaving])")) closeSheet(); });
