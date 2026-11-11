/* ---------- 분할 창: an inactive pane is a mirror (docs/split-panes.md) ----------
   A chat pane's mirror is the open chat's frame under .pane-chat (the same rules as #v-chat): the head, the conversation's own todo and subagent strips,
   a copy of the timeline taken when the pane went inactive plus the messages that came since (the one event stream, 99-boot.js calls paneEvent),
   and the composer's markup with the pane's draft, queue, run line and the model / effort / context line. Nothing here exists with one pane. */
const PNM = new Map();   // pane id -> its mirror {p, node, list, wrap, keys, q, dot, state, todo, subs, k (the composer's parts)}
const PNS = new Map();   // pane id -> what it showed when it went inactive {n, keys}
const paneDirty = new Set();
let paneRaf = 0;

function paneForget(id) { PNM.delete(id); PNS.delete(id); }
function paneMirrorsClear() { PNM.clear(); PNS.clear(); paneDirty.clear(); }
function paneLeave(p) {
  PNM.delete(p.id);
  if (p.kind === "chat" && current === "chat" && target === p.t) {
    p.at = chatAnchor(); p.stick = chatStick;
    PNS.set(p.id, { n: tl.cloneNode(true), keys: new Set(ts(p.t).mk) });
  } else if (p.kind === "app" && current === "monitoring") PNS.set(p.id, { n: $("#v-monitoring").cloneNode(true) });
  else PNS.delete(p.id);
}

// An app pane is a KakaoTalk room: named by it, the state line says where it is from.
const paneName = p => (p.kind === "app" ? (KK.rooms.find(r => r.chatId === paneKkId(p.t)) || {}).name || "대화방" : targetName(p.t));
function paneState(p) {
  if (p.kind === "app") return "카카오톡";
  const i = targetInfo(p.t);
  return isRelayT(p.t) ? RELAY.note[p.t] || "" : isFixedT(p.t) ? FIXED_DESC[p.t] : i.alive ? statusKo(i.status) : "종료됨";
}
// A copy that lives on its own: no id twice on the page, no hidden or in-pane marks of the real section.
function paneBare(n) {
  n.removeAttribute("id"); n.hidden = false; n.classList.remove("in-pane");
  for (const x of n.querySelectorAll("[id]")) x.removeAttribute("id");
  return n;
}

function paneMirror(p) {
  const had = PNM.get(p.id);
  if (had) return had.node;
  const snap = PNS.get(p.id);
  PNS.delete(p.id);
  const { head, dot, state } = paneHeadEl(p);
  const m = { p, dot, state, keys: new Set(), q: [] };
  if (p.kind === "chat") {
    m.list = snap ? paneBare(snap.n) : el("div", { class: "tl-in" });
    m.wrap = el("div", { class: "timeline pane-tl" }, m.list);
    m.wrap.addEventListener("scroll", () => edgeFade(m.wrap), { passive: true });
    if (snap) m.keys = snap.keys; else paneFill(m);
    m.todo = el("div", { class: "todo", hidden: true });
    m.node = el("div", { class: `pane-mir pane-chat${p.t === "alert" ? " no-composer" : ""}` }, head, m.todo, el("div", { class: "chatbox" }, m.wrap), paneComposerEl(m));
    if (!TD.by[p.t]) loadTodo(p.t);
  } else {
    m.node = el("div", { class: "pane-mir" }, head, el("div", { class: "pane-pj" }, snap ? paneBare(snap.n) : el("div", { class: "empty", text: "이 창을 누르면 대화방이 열려요" })));
  }
  PNM.set(p.id, m);
  if (m.k) paneStrip(m);
  return m.node;
}
// The composer of an inactive pane is the open composer's own markup (no id twice, nothing live in it), so the box, the line under it and the send button
// sit where they sit in the open pane. A click on it activates the pane and puts the caret in the box (43-panes-view.js).
function paneComposerEl(m) {
  const c = PNV.cmp.cloneNode(true), id = x => c.querySelector(`#${x}`);
  m.k = { own: id("c-own"), model: id("c-model"), effort: id("c-effort"), worker: id("c-worker"), ring: id("ctx-ring"), api: id("c-api"), fb: id("c-fb"), bar: id("cbar"),
    run: id("runline"), runTx: id("runline-tx"), subs: id("runline-subs"), send: id("send-btn"), ta: id("text") };
  id("c-attach").dataset.c = "c-attach"; m.k.send.dataset.c = "send-btn";
  for (const x of c.querySelectorAll("#qline, #dcard, #hints, #runstate, #pausenote, #relaynote, #atray, input[type=file], .ta-hl, .ta-tok")) x.remove();
  id("send").className = "sendrow"; id("send").removeAttribute("style");
  c.classList.remove("rs-on", "dropping");
  m.k.ta.removeAttribute("style"); m.k.ta.value = String(ts(m.p.t).draft || ""); m.k.ta.readOnly = true;
  // Inert but not `disabled` (that dims it): it looks as this conversation's button does in the open pane; the pane's pointerdown activates the pane.
  m.k.send.removeAttribute("disabled"); m.k.send.type = "button"; m.k.send.setAttribute("aria-disabled", "true");
  for (const b of c.querySelectorAll("button, textarea")) b.tabIndex = -1;
  return paneBare(c);
}
// Everything the open pane draws from its own conversation, drawn from this pane's: strips, queue, run line, chips. Never from the open target.
function paneStrip(m) {
  const t = m.p.t, k = m.k, r = runLineOf(t), working = r.on && r.st !== "rate-limited";
  paintTodo(m.todo, t);
  if (paintQueue(m.list, t) && m.p.stick) m.wrap.scrollTop = m.wrap.scrollHeight;
  k.run.hidden = !r.show; k.run.classList.toggle("warn", r.st === "rate-limited"); k.run.classList.toggle("only-subs", !r.has); k.runTx.textContent = r.text;
  paintSubsBtn(k.subs, subsSourceOf(t), r.subs, r.has);
  const stop = (working || r.bg.length > 0) && !k.ta.value.trim();
  k.send.classList.toggle("stop", stop); k.send.setAttribute("aria-label", stop ? "중단" : "보내기"); k.send.title = stop ? "지금 하는 일 중단" : "";
  k.ta.placeholder = composerHint(t, false);
  paintChips(t, k);
  k.model.classList.toggle("run", working);
}
// All mirrors, or the ones of conversation t.
function paneStrips(t) {
  for (const m of PNM.values()) if (m.k && (t === undefined || m.p.t === t)) paneStrip(m);
}
// A todo tool call of conversation own finished: its mirror reloads the plan (debounced like the open one's, 11-todo-strip.js todoActivity).
function paneTodoTouch(own) {
  for (const m of PNM.values()) {
    if (!m.k || !(own === m.p.t || (own === MAIN && isProjT(m.p.t)))) continue;
    clearTimeout(m.todoTimer);
    m.todoTimer = setTimeout(() => loadTodo(m.p.t), 250);
  }
}
// The head of a mirror, and of the active pane when it holds a screen (which has no head of its own): name, state line, close.
// A chat pane's head is the chat head (.cv-head) with its ⋯ in the same place; its close button sits on the pane itself, like the open pane's.
function paneHeadEl(p) {
  const name = paneName(p), s = paneState(p), dot = el("span", { class: `dot ${p.dot}` }), state = el("span", { class: "cv-hd-s", text: s }), chat = p.kind === "chat";
  dot.hidden = !p.dot;
  const x = chat ? null : el("button", { class: "ib pane-x", type: "button", "aria-label": "창 닫기", title: "창 닫기", onclick: () => paneClose(p.id) }, icon("close"));
  const acts = chat && (isLaneT(p.t) || (isProjT(p.t) && pmOfTarget(p.t))) ? el("span", { class: "cv-hd-a" }, el("button", { class: "ib cvmenu", type: "button", tabindex: "-1", "aria-label": "세션 메뉴" }, icon("more"))) : null;
  return { head: el("div", { class: chat ? "cv-head pane-hd" : "pane-hd" }, el("span", { class: "cv-hd-b" }, el("span", { class: "cv-hd-t", title: name }, dot, name), state), acts, x), dot, state };
}
// A mirror without a copy (the page was reloaded, or the pane lost its screen to another pane): drawn from the messages the page holds.
function paneFill(m) {
  const t = m.p.t, s = ts(t);
  clear(m.list);
  m.keys = new Set(s.mk);
  for (const e of s.msgs.slice(-60)) paneAppend(m, e);
  if (!s.hLoaded && !s.loading) loadTarget(t, true).then(() => { if (PNM.get(m.p.id) === m) { paneFill(m); m.wrap.scrollTop = m.wrap.scrollHeight; } }, () => { /* the pane shows what it has */ });
}
// msgNode reads the global target (a lane report's look), so it is the pane's own for the call.
function paneAppend(m, e) {
  const was = target;
  let n = null;
  target = m.p.t;
  try { n = msgNode(e); } finally { target = was; }
  if (!n) return;
  n.dataset.ts = e.ts;
  const key = e.kind === "out" && e.update_key ? `${e.target ?? ""}|${e.update_key}` : "";
  if (key) {
    for (const old of m.list.querySelectorAll("[data-pk]")) if (old.dataset.pk === key) old.remove();
    n.dataset.pk = key;
  }
  m.list.append(n);
  paintQueue(m.list, m.p.t);
}
function paneMirrorsPlace() {
  for (const m of PNM.values()) {
    if (!m.wrap) continue;
    const box = m.k && m.k.ta;
    if (box) { box.style.height = "auto"; box.style.height = `${Math.max(taFloor(), Math.min(box.scrollHeight, 140))}px`; }   // autosize(), for the draft
    const at = m.p.stick ? null : m.p.at, n = at && [...m.list.querySelectorAll("[data-ts]")].find(x => x.dataset.ts === at.ts);
    m.wrap.scrollTop = n ? n.getBoundingClientRect().top - m.wrap.getBoundingClientRect().top + m.wrap.scrollTop - at.off : m.wrap.scrollHeight;
    edgeFade(m.wrap);
  }
}

// The one event stream (99-boot.js): a message of an inactive pane's target is added to its mirror, one frame's worth at a time.
function paneEvent(e) {
  if (!PNM.size) return;
  const t = eventTarget(e);
  if (!t) return;
  const k = msgKey(e);
  for (const m of PNM.values()) {
    if (m.p.kind !== "chat" || m.p.t !== t || !ts(t).mk.has(k) || m.keys.has(k)) continue;
    m.keys.add(k); m.q.push(e); paneDirty.add(m);
  }
  if (paneDirty.size && !paneRaf) paneRaf = requestAnimationFrame(paneFlush);
}
function paneFlush() {
  paneRaf = 0;
  for (const m of paneDirty) {
    const w = m.wrap, stuck = w.scrollTop + w.clientHeight >= w.scrollHeight - 40;
    for (const e of m.q.splice(0)) paneAppend(m, e);
    if (stuck) w.scrollTop = w.scrollHeight;
  }
  paneDirty.clear();
}
// notify() (02-basic-markdown.js): a notice for a target an inactive pane shows is that pane's head dot, not a toast.
function paneNotify(e) {
  if (!PNV.el || PNV.el.hidden) return false;
  const t = e.kind === "lane_report" ? `lane:${e.lane || ""}` : String(e.target || "");
  const p = paneLeaves().find(x => x.t === t && x.id !== PN.active);
  if (!p) return false;
  p.dot = e.tone || (e.kind === "lane_report" ? "ok" : e.target === "alert" ? "err" : "att");
  const m = PNM.get(p.id);
  if (m) { m.dot.className = `dot ${p.dot}`; m.dot.hidden = false; }
  panePersist();
  return true;
}
// convPaint (31-conversations.js) keeps the state line of every mirror's head current.
function paneHeads() {
  for (const m of PNM.values()) {
    const s = paneState(m.p);
    if (m.state.textContent !== s) m.state.textContent = s;
  }
}
