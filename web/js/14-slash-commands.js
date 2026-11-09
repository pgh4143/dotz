/* ---------- slash commands: Discord-style menu above the composer (hub/control.ts COMMANDS) ---------- */
// Each arg: n = placeholder, opts() = [value, label?] choices from live state, opt = may be left out, free = any text.
const SL_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max", "auto"];
const slLanes = () => ((S && S.lanes) || []).filter(laneAlive).map(l => [l.name, `세션 · ${statusKo(l.status)}`]);
const slProcs = () => [["orchestrator", botName], ...slLanes()];
const slModelTargets = () => [["orchestrator", botName], ["lanes", "세션 기본값"], ["workers", "서브에이전트"], ...slLanes()];
// Every connected model except dated snapshots; newest versions first.
const slModels = () => ((M && M.available) || []).filter(m => !/-\d{8}$/.test(m.selector)).sort((a, b) => b.selector.localeCompare(a.selector, "en", { numeric: true })).map(m => [m.selector, m.name || ""]);
const slProviders = () => ((P && P.providers) || []).map(p => [p.id, p.name || ""]);
const slAccounts = () => [["auto", "자동으로 고르기"], ...((ACC && ACC.accounts) || []).map(a => [a.name, a.label || a.alias || ""])];
// dup: a 도구 row of the palette does the same job, so the palette shows this one only after "/" (one row per job); the composer always lists it.
const CMDS = [
  { c: "/status", d: "봇·세션·Discord 상태와 컨텍스트" },
  { c: "/context", d: "프로세스별 컨텍스트 사용량과 압축 상태", dup: true },
  { c: "/compact", d: "컨텍스트 압축 (작업 중이면 끝난 뒤)", args: [{ n: "대상", opts: slProcs, get opt() { return isConvT(target); } }] },
  { c: "/lanes", d: "세션마다 상태와 모델" },
  { c: "/model", d: "모델 보기, 또는 대상의 모델 바꾸기", args: [{ n: "대상", opts: slModelTargets, opt: true }, { n: "모델", opts: slModels, opt: true }, { n: "강도", opts: () => SL_LEVELS.map(v => [v]), opt: true }] },
  { c: "/effort", d: "추론 강도 바꾸기", args: [{ n: "대상", opts: slModelTargets }, { n: "강도", opts: () => SL_LEVELS.map(v => [v]) }] },
  { c: "/restart", d: "에이전트 재시작 · 게이트웨이는 전체 재시작", args: [{ n: "대상", opts: () => [["orchestrator", botName], ["gateway", "게이트웨이 전체 (한가할 때)"], ...slLanes()] }] },
  { c: "/stop", d: "세션 멈추기 (나중에 다시 시작할 수 있어요)", args: [{ n: "세션", opts: slLanes }] },
  { c: "/resume", d: "멈춘 세션 이어가기, 실행 중이면 메시지 보내기", args: [{ n: "세션", opts: slLanes }, { n: "글", free: true, opt: true }] },
  { c: "/abort", d: "지금 하는 일 취소 (비우면 봇)", args: [{ n: "대상", opts: slProcs, opt: true }] },
  { c: "/providers", d: "연결된 공급자와 모델 수", dup: true },
  { c: "/account", d: "지금 Claude 계정 보기, 또는 바꾸기", args: [{ n: "계정", opts: slAccounts, opt: true }] },
  { c: "/login", d: "공급자 로그인 (링크가 열려요)", args: [{ n: "공급자", opts: slProviders, opt: true }] },
  { c: "/logout", d: "공급자 로그아웃", args: [{ n: "공급자", opts: slProviders }] },
  { c: "/quota", d: "공급자·계정별 사용 한도", dup: true },
  // 이 컴퓨터의 셸 (owner 2026-11-03): typed here, run in the terminal sheet - the composer's own way to the shell, not a gateway command.
  { c: "/terminal", d: "이 컴퓨터 터미널에서 명령 실행", args: [{ n: "명령", free: true }], dup: true, page: true },
  // 화면 공유 (owner 2026-11-04): opens this computer's screen in a tab, not a gateway command; listed only while S.desk exists, and not in the palette (which has its own item).
  { c: "/screen", d: "이 컴퓨터 화면 열기", desk: true, page: true },
  { c: "/help", d: "명령 전체 설명" },
];
// The command palette lists the same commands.
const hintList = CMDS.filter(x => !x.desk);
let SL = { items: [], idx: -1, hide: "" };
// @ in the same menu: what runs now (홈 지금 진행 중, from S: the assistant's background work, a conversation's session and its workers,
// live sessions). A pick writes "@<title> " and is kept in MENTIONS; the message sends {kind, id, label} for every token still in the text
// (hub/mentions.ts turns them into [지칭] lines), so "이거 멈춰" names one id.
let MENTIONS = [];
let sendCid = null;   // {text, id}: the id of the send in flight or failed, see sendChat
function mnItems() {
  const work = w => ({ kind: "task", id: w.id, label: w.description || w.id, sub: `백그라운드 작업${w.model ? ` · ${w.model}` : ""}` });
  const convs = ((S && S.convs) || []).filter(c => convRunning(c));
  const lanes = ((S && S.lanes) || []).filter(laneAlive).sort((a, b) => (b.status === "working") - (a.status === "working"));
  return [
    ...workRunning().map(work),
    ...convs.flatMap(c => [{ kind: "conv", id: c.target, label: c.name || targetName(convWebT(c.target)), sub: "대화 · 진행 중" }, ...(c.work || []).map(work)]),
    ...lanes.map(l => ({ kind: "lane", id: l.name, label: l.title || l.name, sub: `세션 · ${statusKo(l.status)}` })),
  ];
}
// The "@query" right before the caret (start of the box or after a space, so an e-mail address opens nothing).
function mnParse() {
  const at = ta.selectionStart ?? ta.value.length, m = ta.value.slice(0, at).match(/(^|\s)@([^\s@]*)$/);
  return m ? { from: at - m[2].length - 1, to: at, q: m[2].toLowerCase() } : null;
}
const mnRefs = text => MENTIONS.filter(r => text.includes(`@${r.label}`)).map(({ kind, id, label }) => ({ kind, id, label }));
// Where the caret is in "/cmd a b c": which command, which args are done, and the partial token being typed.
function slParse(v) {
  const m = v.match(/^\/(\S*)(\s+([\s\S]*))?$/);
  if (!m) return null;
  if (m[2] === undefined) return { stage: "cmd", q: `/${m[1]}`.toLowerCase() };
  const cmd = CMDS.find(x => x.c === `/${m[1].toLowerCase()}`);
  if (!cmd) return null;
  const rest = m[3], toks = rest.split(/\s+/), done = toks.slice(0, -1).filter(Boolean), q = toks[toks.length - 1] || "";
  return { stage: "arg", cmd, done, q, i: done.length };
}
function updateHints() {
  const box = $("#hints"), v = ta.value, p = slParse(v) || (() => { const m = mnParse(); return m && { stage: "mn", ...m }; })();
  const off = () => { box.hidden = true; clear(box); SL.items = []; SL.idx = -1; };
  if (!p || v === SL.hide || document.activeElement !== ta) return off();
  SL.hide = "";
  let head, items = [], chips = null, idx = 0;
  if (p.stage === "mn") {
    const all = mnItems(), hit = it => it.label.toLowerCase().includes(p.q) || it.id.toLowerCase().includes(p.q);
    items = all.filter(hit).sort((x, y) => (y.label.toLowerCase().startsWith(p.q) ? 1 : 0) - (x.label.toLowerCase().startsWith(p.q) ? 1 : 0)).slice(0, 40)
      .map(it => { const tok = `@${it.label} `; return { kind: "mn", it, fill: `${v.slice(0, p.from)}${tok}${v.slice(p.to)}`, caret: p.from + tok.length }; });
    head = el("div", { class: "sl-hd" }, el("span", { class: "tx", text: "지금 진행 중 · 골라서 지칭하기" }));
  } else if (p.stage === "cmd") {
    const pool = CMDS.filter(x => !x.desk || (S && S.desk));
    const pre = pool.filter(x => x.c.startsWith(p.q)), sub = pool.filter(x => !x.c.startsWith(p.q) && x.c.includes(p.q.slice(1)));
    items = [...pre, ...sub].map(x => ({ kind: "cmd", x, fill: `${x.c} ` }));
    head = el("div", { class: "sl-hd" }, el("span", { class: "logo" }), el("span", { class: "nm", text: botName }), el("span", { class: "tx", text: "명령" }));
  } else {
    const args = p.cmd.args || [], a = args[p.i];
    if (!a || a.free) return off();
    const q = p.q.toLowerCase(), base = `${p.cmd.c} ${p.done.length ? `${p.done.join(" ")} ` : ""}`;
    items = a.opts().filter(([val, lab]) => !q || val.toLowerCase().includes(q) || (lab || "").toLowerCase().includes(q)).sort((x, y) => (y[0].toLowerCase().startsWith(q) ? 1 : 0) - (x[0].toLowerCase().startsWith(q) ? 1 : 0)).slice(0, 40)
      .map(([val, lab]) => ({ kind: "arg", val, lab, fill: `${base}${val} ` }));
    if (!items.length) return off();
    // An optional arg is not preselected, so Enter still sends the command as typed.
    idx = a.opt && !q ? -1 : 0;
    chips = el("div", { class: "sl-args" }, el("span", { class: "sl-c", text: p.cmd.c }),
      ...args.map((x, i) => el("span", { class: `sl-a${i < p.i ? " done" : i === p.i ? " on" : ""}`, text: i < p.i ? p.done[i] : `${x.n}${x.opt ? "?" : ""}` })));
    head = el("div", { class: "sl-hd" }, el("span", { class: "tx", text: `${a.n}${a.opt ? " · 비워도 돼요" : ""}` }));
  }
  if (!items.length) return off();
  SL.items = items; SL.idx = idx;
  const list = el("div", { class: "sl-list", role: "listbox", id: "sl-list" }, ...items.map((it, i) => {
    const b = el("button", { type: "button", role: "option", class: "sl-i", id: `sl-${i}`, tabindex: "-1" },
      it.kind === "cmd"
        ? [el("span", { class: "c", text: it.x.c }), (it.x.args || []).length ? el("span", { class: "ar", text: it.x.args.map(x => x.opt ? `[${x.n}]` : `<${x.n}>`).join(" ") }) : null, el("span", { class: "d", text: it.x.d })]
        : it.kind === "mn" ? [el("span", { class: "c", text: `@${it.it.label}` }), el("span", { class: "d", text: it.it.sub })]
        : [el("span", { class: "c", text: it.val }), it.lab ? el("span", { class: "d", text: it.lab }) : null]);
    // Taps and clicks must not take focus from the textarea (the phone keyboard stays up).
    b.addEventListener("pointerdown", ev => ev.preventDefault());
    b.addEventListener("click", () => slPick(i));
    b.addEventListener("mousemove", () => { if (SL.idx !== i) { SL.idx = i; slMark(); } });
    return b;
  }));
  clear(box).append(...[chips, head, list].filter(Boolean));
  box.hidden = false;
  const sr = $("#send");
  box.style.bottom = `${$("#composer").offsetHeight - sr.offsetTop + 8}px`;
  slMark();
}
function slMark() {
  const items = [...$("#hints").querySelectorAll(".sl-i")];
  items.forEach((n, i) => { n.classList.toggle("on", i === SL.idx); n.setAttribute("aria-selected", i === SL.idx ? "true" : "false"); });
  if (items[SL.idx]) items[SL.idx].scrollIntoView({ block: "nearest" });
  ta.setAttribute("aria-activedescendant", SL.idx >= 0 ? `sl-${SL.idx}` : "");
}
function slPick(i) {
  const it = SL.items[i];
  if (!it) return;
  if (it.kind === "mn") MENTIONS = MENTIONS.filter(r => !(r.kind === it.it.kind && r.id === it.it.id)).concat(it.it);
  const at = it.caret ?? it.fill.length;
  ta.value = it.fill; ta.focus(); ta.setSelectionRange(at, at);
  autosize(); saveDraft(); updateHints();
}
const ta = $("#text");
ta.setAttribute("aria-controls", "sl-list");
// The box itself is measured (the same "auto" then scrollHeight as ever, so the default height and the 140px cap are the original ones), but the
// composer row is pinned to its current height for that instant: collapsing it used to shrink the composer, the timeline grew for a moment,
// the browser clamped its scrollTop and the view slid on every keystroke. Pinned, nothing around the box moves and no frame sees the dip.
const sendRow = $("#send");
// The height never goes below one full line of the box's own computed font plus its vertical padding (CSS min-height says the same; this keeps
// a JS-set px height from ever sitting under it, e.g. after the text scale changed). "normal" line-height resolves from the font size.
function taFloor() {
  const cs = getComputedStyle(ta);
  const fs = parseFloat(cs.fontSize) || 16;
  const lh = parseFloat(cs.lineHeight) || fs * 1.5;
  const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  const border = cs.boxSizing === "border-box" ? (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0) : 0;
  return Math.ceil(Math.max(lh + pad + border, parseFloat(cs.minHeight) || 0));
}
// "ulw" written as a word anywhere in the message: the box takes the ultrawork gradient edge (owner 2026-10-28), with no explanation line.
// autosize runs on every change of the text (typing, a restored draft, a cleared box), so the edge follows it.
const ULW_RE = /(^|[^a-z0-9])ulw(?![a-z0-9])/i;
// The keyword itself is marked too: a backdrop under the (transparent) textarea repeats the text with the keyword wrapped, same box and
// font, scrolled with it; only the mark is visible.
const ULW_ALL = /(^|[^a-z0-9])(ulw)(?![a-z0-9])/gi;
const ulwHl = el("div", { class: "ta-hl", "aria-hidden": "true" });
ta.before(ulwHl);
ta.addEventListener("scroll", () => { ulwHl.scrollTop = ta.scrollTop; atkLay.scrollTop = ta.scrollTop; });
function paintUlw(on) {
  ulwHl.hidden = !on;
  if (!on) { clear(ulwHl); return; }
  const cs = getComputedStyle(ta);
  for (const k of ["font", "letterSpacing", "padding", "lineHeight", "textIndent"]) ulwHl.style[k] = cs[k];
  ulwHl.style.height = cs.height;
  const parts = [], v = ta.value;
  let at = 0;
  for (const m of v.matchAll(ULW_ALL)) {
    const s = m.index + m[1].length;
    parts.push(v.slice(at, s), el("mark", { class: "ulw-kw", text: m[2] }));
    at = s + m[2].length;
  }
  parts.push(v.slice(at), "\n");
  clear(ulwHl).append(...parts);
  ulwHl.scrollTop = ta.scrollTop;
}
function autosize() {
  const ulw = ULW_RE.test(ta.value);
  sendRow.classList.toggle("ulw", ulw);
  paintUlw(ulw);
  const keep = sendRow.offsetHeight;
  sendRow.style.height = `${keep}px`;
  ta.style.height = "auto";
  ta.style.height = `${Math.max(taFloor(), Math.min(ta.scrollHeight, 140))}px`;
  sendRow.style.height = "";
  atkPaint();
}
ta.addEventListener("input", ev => { atkSync(ev); autosize(); saveDraft(); updateHints(); });
ta.addEventListener("focus", () => updateHints());
ta.addEventListener("blur", () => { const box = $("#hints"); box.hidden = true; });
// Registered before the send/stop key handler: while the menu is open, arrows move, Tab/Enter pick, Esc closes it.
ta.addEventListener("keydown", ev => {
  if ($("#hints").hidden || !SL.items.length || ev.isComposing || ev.keyCode === 229) return;
  const n = SL.items.length, stop = () => { ev.preventDefault(); ev.stopImmediatePropagation(); };
  if (ev.key === "ArrowDown") { stop(); SL.idx = (SL.idx + 1) % n; slMark(); }
  else if (ev.key === "ArrowUp") { stop(); SL.idx = SL.idx <= 0 ? n - 1 : SL.idx - 1; slMark(); }
  else if (ev.key === "Tab" && !ev.shiftKey) { stop(); slPick(Math.max(0, SL.idx)); }
  else if (ev.key === "Enter" && !ev.shiftKey && !ev.metaKey && !ev.ctrlKey && !ev.altKey && SL.idx >= 0) { stop(); slPick(SL.idx); }
  else if (ev.key === "Escape") { stop(); SL.hide = ta.value; updateHints(); }
});
// While the target works: Enter steers into the running turn, ⌘/Ctrl+Enter queues it for the next turn, ⌥/Alt+Enter stops it and sends, Esc stops it.
ta.addEventListener("keydown", ev => {
  if (ev.key === "Escape" && isWorking(target) && !document.querySelector("dialog[open]:not([data-leaving])") && !openMenu) { ev.preventDefault(); stopTarget(); return; }
  if (ev.key !== "Enter" || ev.shiftKey || ev.isComposing || ev.keyCode === 229) return;
  if (matchMedia("(pointer: coarse)").matches) return;
  ev.preventDefault();
  sendChat(ev.altKey ? "interrupt" : ev.metaKey || ev.ctrlKey ? "queue" : undefined);
});
// A tap on send must not take focus from the textarea: otherwise the phone keyboard closes on pointerdown, the composer re-lays out
// and the click never lands (owner 2026-10-21: the first tap only hid the keyboard). The click then submits once; sendChat clears the box,
// so a repeat is a no-op, and the box is refocused so the keyboard stays up like a messenger.
$("#send-btn").addEventListener("pointerdown", ev => ev.preventDefault());
$("#send").onsubmit = ev => { ev.preventDefault(); if ($("#send-btn").classList.contains("stop") && !ta.value.trim() && !ATT.length && !pkCount()) stopTarget(); else sendChat(); if (!ta.disabled) ta.focus({ preventScroll: true }); };
// With no turn running, the line is a background worker's (renderWorking): 중단 ends that worker (06-subagents.js workCancel).
$("#working-stop").onclick = ev => (workingBg.length ? workCancel(workingBg[0].id, ev.currentTarget) : stopTarget());
ta.addEventListener("input", () => { if (!$("#working").hidden) renderWorking(); });
async function stopTarget() {
  if (workingBg.length && !$("#c-model").classList.contains("run")) return workCancel(workingBg[0].id, $("#send-btn"));
  try {
    await api(isLaneT(target) ? `/api/lanes/${enc(laneOf(target))}/abort` : "/api/orchestrator/abort", "POST", isLaneT(target) ? {} : { target });
    toast("작업을 중단했어요");
    scheduleState();
  } catch (e) { toast(e.message, true); }
}
// 컴포저에서 셸로 (owner 2026-11-03): "/terminal <명령>" is not a gateway command - it opens this computer's terminal sheet with the command in it
// (36-shell.js openShell). Keep a bare "/terminal" in the box and say what is missing instead of sending it anywhere.
const SH_CMD = /^\/(?:terminal|셸|shell)(?:\s+([\s\S]*))?$/;
const SCR_CMD = /^\/(?:screen|화면)\s*$/;
// Is this text a command? The page's own, or a gateway one (hub/control.ts parseCommand, same list by hub/palette-routes-web.test.ts).
// Any other "/" text, a path or a typo, is an ordinary message.
const isSlashCommand = text => SH_CMD.test(text) || SCR_CMD.test(text) || CMDS.some(x => !x.page && x.c === text.split(/\s/, 1)[0].toLowerCase());
// A slash command (typed, or a card button) goes to the gateway for the current target; its answer joins the chat as a card.
async function sendCommand(text) {
  const t = target, lane = isLaneT(t) ? laneOf(t) : "";
  const mk = (kind, extra) => ({ ts: new Date().toISOString(), kind, source: "local", ...(lane ? { lane } : {}), ...extra });
  chatStick = true; termStick = true;
  ingestMsg(mk("_cmd", { text }));
  try {
    const r = await api("/api/command", "POST", { text, ...(isConvT(t) ? { from: t } : {}) });
    ingestMsg(mk("_cmdout", { text: String(r.output ?? "") || "✓", ...(r.card ? { card: r.card } : {}) }));
    if (/^\/(model|effort|compact|restart|resume|stop|abort)\b/i.test(text)) { refreshState(); loadModels(true); loadContext(true); }
  } catch (e) { ingestMsg(mk("_cmdout", { text: e.message, is_error: true, ...(e.data && e.data.card ? { card: e.data.card } : {}) })); }
}
async function sendChat(how) {
  const text = ta.value.trim();
  if (isRelayT(target)) { if (text && !ta.disabled) relaySend(text); return; }
  if (ATT.some(a => !a.file)) { toast(ATT.some(a => (upJob(target, a.id) || {}).error) ? "못 올린 파일을 다시 올리거나 빼 주세요" : "파일을 올리는 중이에요"); return; }
  const files = ATT.map(a => ({ ...a.file, label: a.no })), picks = pkItems();
  if ((!text && !files.length && !picks.length) || ta.disabled) return;
  const isCommand = isSlashCommand(text);
  if (files.length && isCommand) { toast("명령에는 파일을 붙일 수 없어요", true); return; }
  if (picks.length && isCommand) { toast("명령에는 요소를 붙일 수 없어요", true); return; }
  const refs = isCommand ? [] : mnRefs(text), sentMentions = MENTIONS;
  const sentAtt = ATT, sentPicks = PICK; ATT = []; atkForget(); renderAtt(); pkClear(); MENTIONS = [];
  const t = target, lane = isLaneT(t) ? laneOf(t) : "";
  ta.value = ""; ts(t).draft = ""; try { localStorage.removeItem(DRAFT_KEY(t)); } catch {} autosize(); updateHints(); renderWorking();
  if (typeof asTplEnd === "function") asTplEnd();
  chatStick = true; termStick = true;
  if (isCommand) {
    if (SCR_CMD.test(text)) {
      if (!(S && S.desk)) { toast("이 컴퓨터에서는 화면 공유를 쓸 수 없어요", true); ta.value = text; autosize(); return; }
      openScreen(); return;
    }
    const m = SH_CMD.exec(text);
    if (m) {
      const command = (m[1] || "").trim();
      if (!command) { toast("터미널에서 실행할 명령을 /terminal 뒤에 적어 주세요", true); ta.value = text; autosize(); return; }
      openShell({ command }); return;
    }
    sendCommand(text); return;
  }
  const mode = how || (isWorking(t) ? "steer" : undefined), reply = rpTake();
  if (isSettingsT(t) && !TURN.has(t)) TURN.set(t, Date.now() - 5000);
  try {
    // One id per send, kept while it fails, so a retry of the same text is the same send to the hub (hub/routes.ts cid).
    if (!sendCid || sendCid.text !== text) sendCid = { text, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 10) };
    const body = { text, cid: sendCid.id, ...(reply ? { reply } : {}), ...(lane ? { lane } : {}), ...(isProjT(t) ? { project: projOf(t) } : {}), ...(isMailT(t) ? { mail: mailOf(t) } : {}), ...(isSettingsT(t) ? { settings: settingsApp(t) } : {}), ...(isTaskT(t) ? { task: taskOf(t) } : {}), ...(isFixedT(t) ? { conv: t } : {}), ...(mode ? { mode } : {}), ...(files.length ? { files } : {}), ...(picks.length ? { elements: picks } : {}), ...(refs.length ? { refs } : {}) };
    // A conversation of another computer gets the files uploaded there first (34-peer-monitoring.js pqUpload); a failed upload sends nothing.
    const owner = pqAct("/api/message", body);
    if (owner && owner.pc && files.length) body.files = (await pqUpload(owner.pc, sentAtt)).map((f, i) => ({ ...f, label: sentAtt[i].no }));
    const r = await api("/api/message", "POST", body);
    sendCid = null;
    // A peer's conversation is not on this computer's event stream: its history is read again now, so the sent bubble shows at once.
    if (owner && owner.pc) loadTarget(t, true);
    scrollChat(true); scrollTerm(true);
    if (r && r.queued) { QUEUE = QUEUE.filter(i => i.id !== r.queued.id).concat(r.queued); renderQueue(); toast("작업이 끝나면 전달할게요"); }
    // Steering is the default for a message sent mid-turn, so it gets no toast (owner 2026-10-20); interrupting still does.
  else if (mode === "interrupt") toast("중단하고 보냈어요");
  }
  catch (e) {
    // a failed send goes back to the conversation it came from, even when the owner has moved to another one meanwhile
    if (t !== target) { ts(t).draft = text; ts(t).att = sentAtt.concat(ts(t).att || []); ts(t).pick = sentPicks.concat(ts(t).pick || []); try { localStorage.setItem(DRAFT_KEY(t), text); } catch {} atkStore(t, ts(t).att); toast(`${e.message} · 보내지 못한 글은 원래 대화에 남겨 뒀어요`, true); return; }
    toast(e.message, true); ta.value = text; MENTIONS = sentMentions.concat(MENTIONS); autosize(); ATT = sentAtt.concat(ATT); renderAtt(); pkRestore(sentPicks); rpRestore(reply);
  }
}
// The composer follows the selected target and the view mode.
function updateComposerMeta() {
  const info = targetInfo(target), isTerm = modeOf() === "term";
  const gone = isLaneT(target) && info.known && !info.alive;
  const off = gone && !info.resumable;
  ta.disabled = off; $("#send-btn").disabled = off;
  ta.placeholder = off ? "종료된 세션이에요" : DC.cur ? "번호를 누르거나 직접 입력해 주세요" : gone ? "재개하면서 보내기" : isWorking(target) ? "메시지 보내기" : isTerm ? "메시지 또는 /명령" : isProjT(target) ? `${targetName(target)} 프로젝트의 ${botName}에게 메시지 · /명령` : isMailT(target) ? `이 메일 답장·전달은 ${botName}에게 · /명령` : `${targetName(target)}에게 메시지 · /명령`;
  $("#composer").classList.toggle("tmode", isTerm);
  paintPause();
  rpPaint();
  if (typeof asTplSync === "function") asTplSync();
  relayPaint();
}
// The elapsed time ticks every second on its own; events only arrive when a tool runs, so a time drawn only on events
// froze (owner 2026-10-20: stuck at 18s until the answer came).
let workingLabel = "", workingSubs = 0, workingBg = [];
function tickWorking() {
  if ($("#working").hidden) return;
  // The bottom line shows only the state (owner 2026-10-20); elapsed time lives on the work card.
  const g = CS.group;
  $("#working-tx").textContent = $("#runline-tx").textContent = workingBg.length ? workLine(workingBg) : `${workingLabel}${workingSubs ? ` · 서브에이전트 ${workingSubs}` : ""}`;
  if (g && g.live) g.update();
}
setInterval(() => { if (!document.hidden) tickWorking(); }, 1000);
function renderWorking() {
  const info = targetInfo(target), box = $("#working");
  const st = info.alive ? info.status : "";
  const on = st === "working" || st === "starting" || st === "rate-limited";
  // A request answered with [later] has no running turn, but its background work is still going: the line stays with that work.
  const bg = on ? [] : workOfTarget(target), show = on || bg.length > 0;
  workingBg = bg;
  box.hidden = !show;
  // Only while the gateway reports this target running: status line, and stop in place of send
  // (with text typed the button sends it into the running turn instead).
  // The send button is the one stop control (owner 2026-10-28): it stops the running turn, or, with no turn running, this conversation's background worker.
  const line = $("#runline"), stopMode = ((on && st !== "rate-limited") || bg.length > 0) && !ta.value.trim() && !ATT.length && !pkCount();
  line.hidden = !show; line.classList.toggle("warn", st === "rate-limited");
  $("#c-model").classList.toggle("run", on && st !== "rate-limited");
  const sb = $("#send-btn"); sb.classList.toggle("stop", stopMode); sb.setAttribute("aria-label", stopMode ? "중단" : "보내기"); sb.title = stopMode ? "지금 하는 일 중단" : "";
  if (on) {
    const n = runningSubs(sourceOf(target)).length;
    $(".dot", box).className = `dot ${st === "rate-limited" ? "warn" : "pri"}`;
    workingLabel = `${st === "rate-limited" ? "사용량 한도로 대기 중" : "작업 중…"}`; workingSubs = n;
    tickWorking();
    $("#working-stop").hidden = true;
  } else if (bg.length) {
    $(".dot", box).className = "dot pri";
    $("#working-stop").hidden = true;
    tickWorking();
  }
  renderQueue(); renderCtxRing();
  markLive();
}

/* ---------- queued messages (server queue, sent when the target's turn ends) + context ring ---------- */
let QUEUE = [];
async function loadQueue() {
  try { QUEUE = (await api("/api/queue")).items || []; } catch { return; }
  renderQueue();
}
function renderQueue() {
  const box = $("#queue"), mine = QUEUE.filter(i => i.target === target);
  box.hidden = !mine.length;
  if (!mine.length) { clear(box); return; }
  clear(box).append(...mine.map(i => el("div", { class: "qitem" },
    el("div", { class: "qb" }, el("div", { class: "qt", text: i.text }), el("div", { class: "qm", text: "작업이 끝나면 전달" })),
    el("div", { class: "qa" },
      el("button", { class: "btn text inrow", type: "button", onclick: ev => busy(ev.currentTarget, async () => { await api(`/api/queue/${enc(i.id)}/send`, "POST", {}); QUEUE = QUEUE.filter(x => x.id !== i.id); renderQueue(); scheduleState(); }) }, "지금 끼워넣기"),
      el("button", { class: "btn text inrow", type: "button", onclick: ev => busy(ev.currentTarget, () => takeBack(i)) }, "취소")))));
}
// Taking a queued message back puts its text into the box; a box with a draft keeps it and the message stays queued.
async function takeBack(i) {
  if (ta.value.trim()) { toast("입력창을 비운 뒤 취소해 주세요", true); return; }
  const r = await api(`/api/queue/${enc(i.id)}`, "DELETE");
  QUEUE = QUEUE.filter(x => x.id !== i.id); renderQueue();
  ta.value = r.text; autosize(); renderWorking(); ta.focus();
}
const kfmt = n => n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n);
// A model id as the composer chip shows it (owner 2026-11-03: a long id was cut in the bar on a phone): the vendor word is dropped
// when the id repeats it, a version pair becomes 5.5, and the remaining words are kept only while the label stays in MODEL_CHIP_MAX
// characters. A catalog name (M.pickable/available) is shown as it is; the full id stays in the chip's title and the picker.
const MODEL_CHIP_MAX = 20;
const chipCut = s => (s.length > MODEL_CHIP_MAX ? `${s.slice(0, MODEL_CHIP_MAX - 1)}…` : s);
function modelShort(sel) {
  const seg = String(sel || "").split("/"), model = seg.pop() || "", prov = (seg.pop() || "").toLowerCase();
  const words = model.replace(/^claude[-_]?/i, "").split(/[-_]/).filter(w => w && w.toLowerCase() !== prov);
  const label = [];
  for (const w of words) {
    const next = [...label, w].join(" ");
    if (label.length && next.length > MODEL_CHIP_MAX) break;
    label.push(w);
  }
  const joined = chipCut((label.length ? label.join(" ") : model).replace(/(\d+) (\d+)$/, "$1.$2"));
  return /^[a-z]/.test(joined) ? joined.replace(/^./, c => c.toUpperCase()) : joined;
}
// The chip's label: the models list's own name when it is a name, and the id-derived short form when that "name" is just the id
// (the deepseek entry in the catalog names itself after its selector) or there is no entry at all.
function modelLabel(base, a) {
  const named = a && a.name ? String(a.name).replace(/^Claude\s+/i, "") : "";
  return named && !named.includes("/") ? chipCut(named) : modelShort(base);
}
// "anthropic/claude-opus-5-5:medium" -> "Opus 5.5 · medium" (the models list name when it is loaded).
function modelChipText(sel) {
  const [base, level] = String(sel || "").split(":");
  if (!base) return "";
  const a = [...((M && M.pickable) || []), ...((M && M.available) || [])].find(x => x.selector === base || x.selector === sel);
  const nm = modelLabel(base, a);
  return level ? `${nm} · ${thinkKo(level)}` : nm;
}
// The session whose context the chip shows: the conversation on screen's own (GET /api/context conversations, already loaded: a repaint fetches nothing).
// Never main's for a conversation with its own session; only a project whose kind has none really runs on main.
function ctxSession(t) {
  const procs = (C && C.processes) || [], main = () => procs.find(x => x.name === "orchestrator");
  if (t === MAIN) return main();
  if (isLaneT(t)) return procs.find(x => x.name === laneOf(t));
  if (projOnMain(t)) return main();
  return ((C && C.conversations) || []).find(x => x.key === t);
}
function renderCtxRing() {
  const mb = $("#c-model"), lane = isLaneT(target) && S ? S.lanes.find(x => x.name === laneOf(target)) : null;
  const orchT = target === MAIN || isProjT(target);
  // The model it answers on now, a fallback included (20-models.js liveModel), with 폴백 중 beside it when that is not the configured one.
  const live = orchT ? liveModel(target) : lane ? liveModel(`lane:${lane.name}`) : null, sel = live && live.sel;
  // The chips say whose they are: the orchestrator and a lane often run the same model with a similar context, and
  // unlabeled they read as one (owner 2026-10-20: "오케스트레이터와 레인별로 구분 안되는거 같은데").
  const owner = orchT ? botName : lane ? `세션 ${lane.title || lane.name}` : "";
  const ob = $("#c-own"), wb = $("#c-worker"), wsel = lane && lane.worker_model;
  // The row reads as in main; a project's own choice shows in the tooltips and in the menus' first row (inheritRow).
  const chipOwner = isProjT(target) ? "이 프로젝트" : owner;
  ob.hidden = !(sel && owner); ob.textContent = owner;
  wb.hidden = !wsel;
  if (wsel) { const [wbase, wlevel] = String(wsel).split(":"); wb.textContent = `서브에이전트 ${modelChipText(wbase)}${wlevel ? ` · ${thinkKo(wlevel)}` : ""}`; wb.title = `이 세션의 서브에이전트 모델`; }
  // model and effort are separate chips, each with its own popover
  const [base, level] = String(sel || "").split(":"), eb = $("#c-effort");
  mb.hidden = !sel; eb.hidden = !level;
  if (sel) prefetchTV();
  if (sel) { const t = modelChipText(base); mb.textContent = t; mb.title = `${chipOwner} 모델 · ${t}${base && base !== t ? ` (${base})` : ""}`; }
  if (level) { eb.textContent = thinkKo(level); eb.title = `${chipOwner} 추론 강도 · ${thinkKo(level)}`; }
  const keyed = !!(orchT ? S && S.orchestrator && S.orchestrator.key_fallback : lane && lane.key_fallback);
  $("#c-api").hidden = !keyed;
  const fbc = $("#c-fb"), fb = live && live.fallback;
  fbc.hidden = !fb;
  if (fb) { fbc.textContent = fbTagText(fb); fbc.title = `${owner} 기본 모델 ${selText(live.conf)} 대신 쓰는 중`; }
  $("#cbar").classList.toggle("api", keyed);
  const b = $("#ctx-ring"), p = ctxSession(target);
  // A parked conversation keeps its last figure; a session with no figure yet has no chip.
  b.hidden = !(p && (p.kind === "conversation" ? p.tokens > 0 : p.running && p.tokens != null));
  if (b.hidden) return;
  const pct = p.percent != null ? Math.min(100, Math.max(0, p.percent)) : 0;
  const who = isProjT(target) ? chipOwner : isConvT(target) ? "이 대화" : owner;
  const label = `${who} 컨텍스트 ${p.percent != null ? `${Math.round(p.percent)}% · ${kfmt(p.tokens)}/${kfmt(p.window)}` : `${kfmt(p.tokens)} 토큰`}${p.running ? "" : " · 쉬는 중이라 마지막 값이에요"}`;
  b.title = label; b.setAttribute("aria-label", label);
  b.textContent = p.percent != null ? `컨텍스트 ${Math.round(p.percent)}%` : `컨텍스트 ${kfmt(p.tokens)}`;
  b.classList.toggle("warn", pct >= 80);
}
/* ---------- composer chips: model / effort / context of the current target (GET/PUT /api/target) ---------- */
// The chips are quick switches; the last row of each opens the 모델 · 폴백 screen at this target (fallback order lives there).
const MODELS_LINK = { value: "__models", label: "모델 · 폴백 설정", sub: "폴백 순서까지" };
const targetParam = () => isLaneT(target) || isProjT(target) ? target : "main";
// The context ring and its 압축 stay on the session they read; the hub maps the target to it (hub/control.ts convOf).
const ctxParam = () => target;
// A project conversation's way back: the first row of its menus, checked while it made no choice (T.own is absent elsewhere).
const INHERIT = "__inherit";
const inheritRow = T => T.own === undefined ? [] : [{ value: INHERIT, label: "메인 대화와 같게", sub: selText(T.inherited) }];
const chipValue = (T, v) => T.own === false ? INHERIT : v;
// GET /api/target per target, kept so a chip opens its menu at once; the server builds it from the CLI model list, which is slow while cold.
// The first click used to wait for that response (owner 2026-10-22: first click on the model/effort chip felt slow).
const TV = new Map(), TV_BUSY = new Set();
async function fetchTV(k) { const T = await api(`/api/target?target=${enc(k)}`); TV.set(k, T); return T; }
// Fills the cache at idle once the chips render, so even the first click finds it.
function prefetchTV() {
  const k = targetParam();
  if (TV.has(k) || TV_BUSY.has(k)) return;
  TV_BUSY.add(k);
  (window.requestIdleCallback || (f => setTimeout(f, 300)))(() => fetchTV(k).catch(() => {}).finally(() => TV_BUSY.delete(k)), { timeout: 3000 });
}
// Opens a chip menu from the cached view without waiting, then refetches; the menu is rebuilt only when the fresh view differs.
async function chipMenu(anchor, build) {
  const k = targetParam(), hit = TV.get(k);
  if (!hit) return build(await fetchTV(k));
  build(hit);
  const sig = T => JSON.stringify([T.model, T.thinking, T.own, T.inherited, T.models.map(m => m.selector)]);
  fetchTV(k).then(T => { if (openMenu && openMenu.anchor === anchor && targetParam() === k && sig(T) !== sig(hit)) { closeMenu(false); build(T); } }).catch(() => {});
}
async function targetChange(title, change, label, t = targetParam()) {
  const body = { target: t, ...change };
  let r;
  try { r = await api("/api/target", "PUT", body); }
  catch (e) {
    if (!(e.data && e.data.requires_force)) throw e;
    if (!await ask(title, `작업 중인 세션이라 컨텍스트 ${num(e.data.context_tokens)} 토큰이 캐시에 다시 쓰여요\n${label}`, "적용")) return;
    r = await api("/api/target", "PUT", { ...body, force: true });
  }
  toast(change.compact ? (r.compaction === "queued" ? "작업이 끝나면 압축해요" : "압축을 시작했어요") : (applyKo[r.applied] || "적용했어요"));
  TV.delete(body.target);
  await Promise.all([loadModels(true), loadContext(true), fetchTV(body.target).catch(() => {})]); refreshState();
}
$("#c-model").onclick = ev => busy(null, () => {
  const anchor = ev.currentTarget;
  return chipMenu(anchor, T => {
    const name = targetName(target), items = [...inheritRow(T), ...modelPickItems(T.models, T.model), MODELS_LINK];
    showMenu(anchor, items, { value: chipValue(T, T.model), onPick: v => v === MODELS_LINK.value ? openModels(T.key) : busy(null, () => targetChange(name, v === INHERIT ? { inherit: true } : { model: v }, `${modelName(v)} · ${T.thinking}`)) });
  });
});
// A session's subagent model: the same model list, saved as the lane's worker_model (its effort is kept).
$("#c-worker").onclick = ev => busy(null, () => {
  const anchor = ev.currentTarget, lane = S && S.lanes.find(x => x.name === laneOf(target));
  const [base, level] = String((lane && lane.worker_model) || "").split(":");
  return chipMenu(anchor, T => showMenu(anchor, modelPickItems(T.models, base), { value: base, onPick: v => busy(null, () => targetChange(targetName(target), { worker_model: level ? `${v}:${level}` : v }, `서브에이전트 ${modelName(v)}`)) }));
});
// Effort only: the levels this target's model accepts (04-state.js effortItems), the model is never touched.
$("#c-effort").onclick = ev => busy(null, () => {
  const anchor = ev.currentTarget;
  return chipMenu(anchor, T => {
    const name = targetName(target);
    showMenu(anchor, [...inheritRow(T), { header: "추론 강도" }, ...effortItems(T.model, T.thinking), MODELS_LINK], { value: chipValue(T, T.thinking), onPick: v => v === MODELS_LINK.value ? openModels(T.key) : busy(null, () => targetChange(name, v === INHERIT ? { inherit: true } : { thinking: v }, `${modelName(T.model)} · ${thinkKo(v)}`)) });
  });
});
$("#ctx-ring").setAttribute("aria-haspopup", "listbox");
$("#ctx-ring").onclick = ev => busy(null, async () => {
  const anchor = ev.currentTarget, T = await api(`/api/target?target=${enc(ctxParam())}`), c = T.context || {};
  const inFlight = c.compaction && (c.compaction.state === "queued" || c.compaction.state === "compacting");
  const items = [{ header: c.percent != null ? `컨텍스트 ${Math.round(c.percent)}% · ${kfmt(c.tokens)}/${kfmt(c.window)}` : `컨텍스트 ${kfmt(c.tokens || 0)} 토큰` }];
  if (T.running && !inFlight) items.push({ value: "compact", label: "지금 압축", sub: T.busy ? "작업이 끝나면 압축해요" : "캐시가 한 번 다시 쓰여요" });
  else if (inFlight) items.push({ value: "none", label: "압축 진행 중" });
  else items.push({ value: "none", label: "쉬는 중이에요", sub: "다음 메시지가 오면 다시 시작해요" });
  items.push({ value: "open", label: "컨텍스트 화면 열기" });
  showMenu(anchor, items, { onPick: v => v === "open" ? go("context") : v === "compact" ? busy(null, () => targetChange(targetName(target), { compact: true }, "", ctxParam())) : null });
});
// 시제품 .cmp의 모양 (proto.css "/* composer *\/"): 첨부(+)는 글 상자의 왼쪽, 모델·컨텍스트 칩은 상자 아래 힌트 줄에 서요.
// 칩을 폼 밖으로 옮겨도 각 칩의 클릭은 그대로예요 (이벤트는 요소에 붙어 있어요).
$("#send").insertBefore($("#c-attach"), $("#text"));
$("#send").after($("#cbar"));
