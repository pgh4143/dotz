/* ---------- todo strip: the target's plan (GET /api/todo), one line above the timeline ---------- */
const TD = { by: {}, open: {}, timer: 0, calls: new Set() };
async function loadTodo(t = target) {
  if (isFixedT(t) || isMailT(t) || isRelayT(t)) { TD.by[t] = []; if (t === target) { paintTodo(); if (CV.key && !CV.placed) renderAll(); } return; }   // no plan in 알림 / 작업 기록
  let r;
  try { r = await api(`/api/todo?target=${enc(t)}`); } catch { TD.by[t] = TD.by[t] || []; r = null; }
  if (r) TD.by[t] = Array.isArray(r.phases) ? r.phases : [];
  if (t === target) { paintTodo(); paintRunState(); if (CV.key && !CV.placed) renderAll(); }   // the first paint of an opening waits for the plan (chatReady)
}
const todoState = x => x.status === "in_progress" ? "act" : x.status === "completed" ? "done" : x.status === "abandoned" ? "drop" : "pend";
function paintTodo() {
  const box = $("#todo");
  if (!box) return;
  const phases = TD.by[target] || [], all = phases.flatMap(p => p.tasks || []);
  if (!all.length || all.every(x => todoState(x) === "done" || todoState(x) === "drop")) { box.hidden = true; delete box.dataset.sig; delete box.dataset.ph; clear(box); return; }
  const open = !!TD.open[target], sig = JSON.stringify([phases, open]);
  box.hidden = false;
  if (box.dataset.sig === sig) return;
  // A step finishing changes the strip in place (the new look fades up); opening the list or the first paint just draws.
  const ph = JSON.stringify(phases), swap = box.dataset.ph !== undefined && box.dataset.ph !== ph;
  box.dataset.sig = sig; box.dataset.ph = ph;
  const live = all.filter(x => todoState(x) !== "drop"), done = live.filter(x => todoState(x) === "done").length;
  const cur = all.find(x => todoState(x) === "act") || all.find(x => todoState(x) === "pend"), g = x => el("span", { class: `td-g tg-${todoState(x)}`, "aria-hidden": "true" });
  const bar = el("button", { class: "td-bar", type: "button", "aria-expanded": String(open), onclick: () => { TD.open[target] = !open; paintTodo(); } },
    g(cur), el("span", { class: "td-cur", text: cur.content }), el("span", { class: "td-n", text: `${done}/${live.length}` }), icon("drop", "td-ch"));
  const kids = [bar];
  if (open) kids.push(el("div", { class: "td-list" }, ...phases.flatMap(p => [
    p.name ? el("div", { class: "td-ph", text: p.name }) : null,
    ...(p.tasks || []).map(x => el("div", { class: `td-r tr-${todoState(x)}` }, g(x), el("span", { class: "td-tx", text: x.content })))])));
  const keep = $(".td-list", box), top = keep ? keep.scrollTop : 0;
  const draw = () => { clear(box).append(...kids); const nl = $(".td-list", box); if (nl) nl.scrollTop = top; };
  if (swap) motionSwap(box, draw); else draw();
}
// A todo tool call finishing means the plan changed: refetch (debounced) when it belongs to the open target.
function todoActivity(a) {
  const isTodo = /(^|__)todo/i.test(String(a.tool || ""));
  if (a.type === "tool_call" && isTodo && a.call_id) { TD.calls.add(a.call_id); return; }
  if (a.type !== "tool_result" || !(isTodo || (a.call_id && TD.calls.delete(a.call_id)))) return;
  const own = targetOfSource(a.source);
  if (own === target || (own === MAIN && isProjT(target))) { clearTimeout(TD.timer); TD.timer = setTimeout(() => loadTodo(target), 250); }
}
// The top of the timeline is the older-messages loader: it sits above the messages (the observer in 09-needs-you.js loads when it comes
// into view) and holds the button for a click. Kept across redraws, never counted as a message or trimmed with the oldest ones.
const TL_TOP_NODE = $("#tl-top"), TL_MORE_BTN = TL_TOP_NODE && $("#tl-more", TL_TOP_NODE);
function paintOlderTop() {
  if (!TL_TOP_NODE) return;
  const more = !!(ts(target).hmore && ts(target).hLoaded);
  TL_TOP_NODE.hidden = !more;
  TL_MORE_BTN.hidden = !more;
}
if (TL_MORE_BTN) TL_MORE_BTN.onclick = () => loadOlderMsgs();
function resetChat() { clear(tl); CV.drawn = ""; if (TL_TOP_NODE) tl.append(TL_TOP_NODE); CV.divNode = null; CS = { day: "", group: null, empty: null, prog: new Map(), who: "", whoT: 0 }; paintOlderTop(); }
function dayDiv(t) { const d = kstDay(t); if (d && d !== CS.day) { CS.day = d; CS.who = ""; tl.append(el("div", { class: "a-div", text: dayLabel(t) })); } }
// Who said a message, for the meta line: shown once per run of messages from the same speaker (a gap over 10 minutes starts a new run).
function speakerOf(e) {
  const peer = peerMsgOf(e);
  if (peer) return `peer|${peer.from}`;
  if (e.kind === "message" || e.kind === "lane_message" || e.kind === "_cmd") return `owner|${e.kind === "_cmd" ? "cmd" : e.source ?? ""}`;
  if (e.kind === "lane_report") return `lane|${e.lane ?? ""}`;
  if (e.kind === "out" && (e.target === "alert" || e.target === "worklog")) return e.target;
  if (e.kind === "out") return "bot";
  return "";
}
const SYS_LABEL = { schedule: "예약", watch: "모니터링", mail: "메일" };
// Gateway restart notices: a clean one (nothing was cut off) leaves the chat and only counts toward the top banner.
const isRestart = e => e.kind === "out" && e.source === "gateway" && /^게이트웨이(?: 재시작했어요|를 다시 시작했어요)/.test(String(e.text ?? ""));
const cleanRestart = e => isRestart(e) && /끊긴 작업은 없어요/.test(String(e.text ?? ""));
const BAN_KEY = "dotz-restart-seen";
function paintRestartBanner() {
  const today = kstDay(Date.now()), list = ts(MAIN).msgs.filter(e => isRestart(e) && kstDay(e.ts) === today);
  const b = $("#gban"), last = list.length ? list[list.length - 1].ts : "";
  // Closing it silences today's count; it comes back today only when a later restart cut work off.
  const cut = list.filter(e => !cleanRestart(e)).length;
  const seen = lsJson(BAN_KEY, null);
  b.hidden = !last || (!!seen && seen.day === today && cut <= (seen.cut || 0));
  if (b.hidden) return;
  $("#gban-dot").className = `dot ${cut ? "warn" : ""}`;
  $("#gban-tx").innerHTML = `오늘 재시작 <b>${list.length}회</b> · 끊긴 작업 <b>${cut}</b>`;
  b.title = `오늘 게이트웨이 재시작 ${list.length}회, 끊긴 작업 ${cut}, 마지막 ${kstHM(last)}`;
  $("#gban-x").onclick = () => { try { localStorage.setItem(BAN_KEY, JSON.stringify({ day: today, cut })); } catch {} b.hidden = true; };
}
// Alerts: one plain Korean line; the raw text (provider error strings, report lines) folds under 자세히.
function humanAlert(text) {
  const m = text.match(/^(.+?): 모델 제공자 오류\(([\s\S]*)\)가 (\d+)번 재시도해도 계속돼서 멈췄(?:습니다|어요)/);
  if (m) {
    const c = m[2];
    const why = /timed out|timeout/i.test(c) ? "모델 응답이 너무 오래 없어서" : /ENOTFOUND|reach|network|ECONN|fetch failed/i.test(c) ? "모델 서버에 연결되지 않아서" : /rate|limit|429/i.test(c) ? "사용 한도에 걸려서" : /overload|529|50\d/i.test(c) ? "모델 서버가 바빠서" : "모델 오류가 계속돼서";
    const last = m[1].charCodeAt(m[1].length - 1) - 0xac00, josa = last >= 0 && last < 11172 && last % 28 ? "이" : "가";
    return `${m[1]}${josa} ${why} ${m[3]}번 다시 해 보다가 멈췄어요. 다음 메시지부터 다시 해요.`;
  }
  return text.split("\n")[0].replace(/\s*\([^()]*[A-Za-z]{4,}[^()]*\)/g, "").trim() || text;
}
// A reply that just arrived fades in as one piece (the harness sends only finished messages, no token deltas): no text is hidden or
// retyped, so nothing reflows and the height is final from the first frame. History, re-renders and reduced motion show it at once.
const STREAMED = new Set();
function streamIn(root, key, ts) {
  if (STREAMED.has(key) || Date.now() - Date.parse(ts) > 15000) return;
  STREAMED.add(key);
  motionIn(root, "fade", 300);
}
// Delivery state of an owner message (hub/events.ts emitDelivery), shown in its meta line: received (steered into the running step /
// received by an idle session / waited in the queue / resumed a stopped session / held on a limit), answered, or not delivered.
const DELIV = { nodes: new Map(), state: new Map() };
const DELIV_RANK = { steered: 1, received: 1, queued: 1, held: 1, update: 1, resumed: 1, answered: 2, failed: 2 };
const DELIV_LABEL = { steered: "받음 · 지금 작업에 전달", received: "받음 · 바로 전달", queued: "받음 · 기다렸다 전달", held: "받음 · 한도가 풀리면 전달", update: "받음 · 업데이트 뒤 전달", resumed: "다시 시작해서 전달", answered: "답함" };
const delivLabel = d => d.state === "failed" ? `전달하지 못했어요${d.text ? ` · ${d.text}` : ""}` : DELIV_LABEL[d.state] || "";
function paintDelivery(mid) {
  const n = DELIV.nodes.get(mid), d = DELIV.state.get(mid);
  if (!n || !d) return;
  const rq = n.mt.querySelector(".rp-btn");   // the hover quote button (39-reply.js) lives in the meta line
  n.mt.textContent = [n.base, delivLabel(d)].filter(Boolean).join(" · ");
  if (rq) n.mt.append(rq);
  n.mt.classList.add("dv"); n.mt.classList.toggle("dv-fail", d.state === "failed");
}
function applyDelivery(e) {
  const old = DELIV.state.get(e.ref);
  if (old && DELIV_RANK[old.state] > DELIV_RANK[e.state]) return;
  DELIV.state.set(e.ref, e);
  if (DELIV.state.size > 600) DELIV.state.delete(DELIV.state.keys().next().value);
  paintDelivery(e.ref);
}
// A command answer: title with a tone dot, label/value rows, a note, and buttons that send a command like the composer does.
function cardNode(c) {
  const dot = el("span", { class: `dot${c.tone ? ` ${c.tone === "busy" ? "pri" : c.tone}` : ""}` });
  const rows = (c.facts || []).flatMap(f => [el("dt", { text: f.label }), el("dd", { text: f.value })]);
  const acts = (c.actions || []).map(a => {
    const b = el("button", { class: "btn tonal", type: "button", title: a.send, text: a.label });
    b.onclick = () => sendCommand(a.send);
    return b;
  });
  return el("div", { class: "ccard" }, el("div", { class: "cc-hd" }, dot, el("span", { text: c.title })),
    rows.length ? el("dl", { class: "cc-facts" }, ...rows) : null, c.note ? el("div", { class: "cc-note", text: c.note }) : null,
    acts.length ? el("div", { class: "btns cc-act" }, ...acts) : null);
}
// A gateway system line (hub/outbound.ts `system`, e.g. "백그라운드 작업으로 맡겼어요: …"): one small muted line in the style of the
// 여기까지 읽음 divider, no bubble or author. With a `worker` it opens that worker (its result once there is one), and its job's state is painted in place.
// The state is the gateway's (hub/workrows.ts), never the event's: `work` on /api/history for what a load finds, a stream frame when a job changes, and S.work.
// The first frame comes with the next sweep, seconds after the row: a row that just arrived starts as running, so its card is whole at once, and any word from the gateway replaces that.
const SYS_NODES = new Map();   // worker id -> every line drawn for it: { st, at, w } (a follow-up joined to a job writes a second line)
const WORK_ROWS = new Map();   // worker id -> the gateway's newest word on its job
const WORK_ROWS_MAX = 600, SYS_SLACK_MS = 5000, SYS_FRESH_MS = 60_000;
const SYS_ST = { running: ["pri", "진행 중"], stalled: ["warn", "멈춤"], done: ["ok", "완료"], failed: ["err", "실패"], gone: ["off", "끝남"] };
const SYS_STOPPED = ["off", "중단됨"];
function workRowNote(w, at) {
  const o = WORK_ROWS.get(w.id);
  if (o && o.at > at) return;
  WORK_ROWS.delete(w.id);   // newest last: the oldest word goes first
  WORK_ROWS.set(w.id, { ...w, at, created_at: w.created_at ?? o?.created_at, cancelled: w.cancelled || (o?.cancelled && o.status === w.status) });   // S.work does not know every stop a row does
  if (WORK_ROWS.size > WORK_ROWS_MAX) WORK_ROWS.delete(WORK_ROWS.keys().next().value);
}
function workRowsOf(events) { for (const e of events) if (e.work) workRowNote(e.work, e.work.at); queueMicrotask(paintSysLines); }
function workRowsLive(e) { for (const w of e.items || []) workRowNote(w, e.at); paintSysLines(); }
function paintSysLines() {
  for (const w of (S && S.work) || []) workRowNote(w, S.work_now || 0);
  for (const [id, rows] of SYS_NODES) {
    for (const row of rows) if (row.st.isConnected) paintSysLine(row, WORK_ROWS.get(id)); else rows.delete(row);
    if (!rows.size) SYS_NODES.delete(id);
  }
}
function paintSysLine(row, job) {
  // A row older than the job's record was written for the job that held this id before: that one was given up.
  const st = row.st, w = job && row.at < job.created_at - SYS_SLACK_MS ? { id: job.id, status: "failed", cancelled: true } : job, s = w && (w.cancelled ? SYS_STOPPED : SYS_ST[w.status]);
  row.w = w;
  st.hidden = !s;
  if (!s) return;
  const open = st.closest("button");
  if (open) open.title = w.result_at ? "결과 보기" : "작업 열기";
  if (st.dataset.s === s[1]) return;
  const was = st.dataset.s, card = st.classList.contains("ct-pill"), paint = () => {
    if (card) { st.className = `cv-sys-st ct-pill ${s[0]}`; st.replaceChildren(s[0] === "ok" ? icon("check") : el("span", { class: `dot ${s[0]}` }), el("span", { text: s[1] })); }
    else { st.firstChild.className = `dot ${s[0]}`; st.lastChild.textContent = s[1]; }
    hcSysFiles(st, w);
  };
  st.dataset.s = s[1];
  if (was) motionSwap(st.closest(".cv-sys") || st, paint); else paint();   // running -> 완료 changes in place (with the result file as a chip under the line); the first paint just draws
}
function sysRow(id, st, e) {
  const row = { st, at: Date.parse(e.ts) || 0, w: null };
  if (!SYS_NODES.has(id)) SYS_NODES.set(id, new Set());
  SYS_NODES.get(id).add(row);
  queueMicrotask(paintSysLines);
  return row;
}
// A tap: the message holding the job's result, else the worker.
function sysOpen(row, id, title, e) {
  const w = row.w;
  if (w && w.result_at) ntJump({ src: w.result_conv || eventTarget(e) || MAIN, at: w.result_at });
  else openSub("orchestrator", id, null, title);
}
// The result file of a finished worker: one chip row right under its line, replaced when the state is painted again.
function hcSysFiles(st, w) {
  const line = st.closest(".cv-sys");
  if (!line) return;
  if (line.classList.contains("cv-task")) { hcTaskBody(line, w); return; }
  const old = line.nextElementSibling;
  if (old && old.classList.contains("cv-sys-f")) old.remove();
  const files = w.status === "done" && !w.cancelled && Array.isArray(w.files) ? w.files.filter(f => f && f.path) : [];
  if (files.length) line.after(el("div", { class: "cv-sys-f" }, ...files.map(f => { const name = f.name || String(f.path).split("/").pop(); return fileChip(name, fileMeta(name, f.size), VIEW_RE.test(name) ? { onclick: () => viewer(f.path, name, f.pc) } : { href: fileUrl(f.path, false, f.pc) }); })));
}
// The same line as the landing page's 작업 card (hcTaskBody fills what is under the title): label, title, state pill, then the result files and a full bar once done.
const SYS_TASK = /^백그라운드 작업으로 맡겼어요:\s*(\S[\s\S]*)$/;
function hcTaskBody(line, w) {
  const old = line.querySelector(":scope > .ct-body");
  const files = w.status === "done" && !w.cancelled && Array.isArray(w.files) ? w.files.filter(f => f && f.path) : [];
  const chips = files.map(f => { const name = f.name || String(f.path).split("/").pop(), size = f.size ? fsize(f.size) : "", opt = VIEW_RE.test(name) ? { onclick: () => viewer(f.path, name, f.pc) } : { href: fileUrl(f.path, false, f.pc) };
    return el(opt.href ? "a" : "button", { class: "ct-file", ...(opt.href ? { href: opt.href, target: "_blank", rel: "noopener" } : { type: "button", onclick: opt.onclick }), title: `${name} · 열기` },
      icon("file"), el("span", { class: "ct-ft" }, el("b", { text: name }), size ? el("span", { text: size }) : null)); });
  const done = w.status === "done" && !w.cancelled;
  const body = chips.length || done ? el("div", { class: "ct-body" }, ...chips, done ? el("div", { class: "ct-bar" }, el("span")) : null) : null;
  if (old) old.remove();
  if (body) line.append(body);
}
// A row's place in the chat: a work card joins the run of cards that ends the chat, or starts one. A chat message ends a run; a folded tool group does not (the orchestrator's calls land between the rows it deferred).
function tlHome(n) {
  if (!n.classList.contains("cv-task")) return tl;
  let last = tl.lastElementChild;
  while (last && last.matches("details.work")) last = last.previousElementSibling;
  return last && last.classList.contains("cv-tasks") ? last : tl.appendChild(el("div", { class: "cv-tasks" }));
}
function sysTaskLine(e, title, hm, id) {
  const st = el("span", { class: "cv-sys-st ct-pill", hidden: true }, el("span", { class: "dot" }), el("span"));
  const row = sysRow(id, st, e);
  const hd = el("button", { class: "ct-hd", type: "button", title: "작업 열기", onclick: () => sysOpen(row, id, title, e) },
    el("span", { class: "ct-nm" }, el("span", { class: "ct-lb" }, el("span", { class: "ct-kind", text: hm ? "백그라운드 작업 · " : "백그라운드 작업" }), hm ? el("span", { text: hm }) : null), el("span", { class: "cv-sys-tx ct-t", text: title })), st);
  return el("div", { class: "cv-sys cv-task", role: "group" }, hd);
}
function sysLine(e, text, hm) {
  const id = typeof e.worker === "string" ? e.worker : "", task = id && SYS_TASK.exec(text);
  if (e.work) workRowNote(e.work, e.work.at);
  else if (id && Date.now() - Date.parse(e.ts) < SYS_FRESH_MS) workRowNote({ id, status: "running" }, Date.parse(e.ts));
  if (task) return sysTaskLine(e, task[1].trim(), hm, id);
  const st = el("span", { class: "cv-sys-st", hidden: true }, el("span", { class: "dot" }), el("span"));
  const kids = [icon("lanes"), el("span", { class: "cv-sys-tx", text }), st, hm ? el("span", { class: "cv-sys-mt", text: hm }) : null];
  // The pointer to a task conversation opens it while it is open; a closed one stays plain text.
  if (e.task_ref && TASKS.has(e.task_ref)) return el("button", { class: "cv-sys", type: "button", title: "작업 열기", onclick: () => go("chat", e.task_ref) }, ...kids);
  if (!id) return el("div", { class: "cv-sys", role: "note" }, ...kids);
  const row = sysRow(id, st, e);
  return el("button", { class: "cv-sys", type: "button", title: "작업 열기", onclick: () => sysOpen(row, id, text.replace(/^[^:]*:\s*/, ""), e) }, ...kids);
}
function msgNode(e) {
  const text = String(e.text ?? ""), hm = kstHM(e.ts);
  // Nothing to read: an outbox record with no text and no card is not a bubble (a deferral note must never look like an empty one).
  if (!text.trim() && !e.card && !(Array.isArray(e.files) && e.files.length) && e.kind !== "result" && e.kind !== "lane_start") return null;
  if (e.kind === "out" && e.system) return sysLine(e, text.trim(), hm);
  const peer = peerMsgOf(e);
  if (peer) return peerMsgCard(e, peer, hm);
  switch (e.kind) {
    case "message": case "lane_message": case "_cmd": {
      const via = e.kind === "_cmd" ? "명령" : e.source === "discord" ? "Discord" : e.source === "terminal" ? "터미널" : "";
      const ub = el("div", { class: "ub" }, ...atkParts(text, e.files, e)), long = text.length > 420 || text.split("\n").length > 6;
      if (long) ub.classList.add("clamp");
      const more = long ? el("button", { class: "ubm", type: "button", onclick: () => { const c = ub.classList.toggle("clamp"); more.textContent = c ? "더 보기" : "접기"; } }, "더 보기") : null;
      const base = [hm, via].filter(Boolean).join(" · "), mt = el("div", { class: "mt", text: base }), mid = e.mid || e.message_id || "";
      if (mid) { DELIV.nodes.set(mid, { mt, base }); if (DELIV.nodes.size > 600) DELIV.nodes.delete(DELIV.nodes.keys().next().value); paintDelivery(mid); }
      // The owner's files are uploads of the computer that holds the conversation: a peer's open there (15-attachments.js fileUrl).
      const pc = Array.isArray(e.files) && e.files.length ? pqPc(eventTarget(e) || "") : null;
      // An answered decision is a quiet record of what was decided, not a "1) …" bubble (10-decision-card.js dcRecordNode); the options
      // themselves stay only in the card/sheet that asked (owner 2026-11-03).
      if (e.kind !== "_cmd" && Array.isArray(e.picks) && e.picks.length) return dcRecordNode(e, filesNode(pc ? e.files.map(f => ({ ...f, pc })) : e.files, true), mt);
      return el("div", { class: "um" }, filesNode(pc ? e.files.map(f => ({ ...f, pc })) : e.files, true), rpQuote(e), text && !atkOnly(text, e.files) ? ub : null, more, mt);
    }
    case "_cmdout": return el("div", { class: `cmdbox${e.is_error ? " err" : ""}` }, e.card ? cardNode(e.card) : el("pre", { text }), el("div", { class: "mt", text: hm }));
    case "notice": case "notice_read": return null;
    case "result": {
      const go = el("button", { class: "btn tonal", type: "button", text: "세션 열기" });
      go.onclick = () => pickTarget(e.open || "main");
      // The hub stores a report's first three lines (hub/notices-read.ts summary), which can end on a heading with nothing below it.
      const body = parseTone(previewSrc(choiceBody(text))).text.replace(/\n\*\*[^*\n]+\*\*$/, "").trim();
      return el("div", { class: "bm res" }, el("div", { class: "mt", text: ["세션 결과", hm].filter(Boolean).join(" · ") }),
        el("div", { class: "ccard" }, el("div", { class: "cc-hd" }, el("span", { class: "dot ok" }), el("span", { text: `${e.title || "세션"} 끝났어요` }), e.verified ? el("span", { class: "tag ok", text: "확인됨" }) : null),
          body ? answerParts(fileLines(body), { lead: false }) : null, el("div", { class: "btns cc-act" }, go)));
    }
    case "lane_start": return el("div", { class: "a-div", text: `세션 시작 · ${hm}` });
    case "mail": {
      // A mail conversation's first message (hub/mail.ts postMail): sender, subject, then the summary and the body (원문).
      if (e.subject) {
        const key = e.mail || (isMailT(e.conv || "") ? mailOf(e.conv) : ""), html = !!(e.html || (MAILS.get(`mail:${key}`) || {}).html);
        // The summary slot holds a real summary only: a sent mail has none (the collector gives its body's start, hub/mail.ts sentMailEvent), and a
        // "summary" that is only the start of the mail's own body is drawn once, as the body.
        // The hub summarizes after the mail is posted (hub/mail-summary.ts), so the summary is often on the record and not in the event's text.
        const rec = MAILS.get(`mail:${key}`) || {}, sp = rcSplit(text.split("\n").slice(1).join("\n").trim()), sum = sp.text || rec.summary || "";
        const noSum = e.dir === "out" || rec.dir === "out" || mailSumIsBody(sum, e.preview, rec.preview, sp.raw);
        const card = resultCard({ src: mailSender(e.from) || SYS_LABEL.mail, at: e.ts, title: e.subject, text: noSum ? "" : sum, raw: sp.raw, rawOpen: !!key, rawNode: key ? raw => mailBodyNode(key, html, raw, e.subject) : undefined });
        // Gmail-like, top to bottom: the bar of icons (30-mail-box.js mailOpenBar, every action of the mail in it), the subject, the sender and time,
        // one muted line of 받는 사람 / 참조 that opens the full header (30-mail-thread.js), the summary, the attachments, then the original.
        if (card && key) {
          const hd = card.querySelector(".rc-hd"), title = card.querySelector(".rc-title"), meta = mailMetaNode(`mail:${key}`, e);
          card.classList.add("mopen");
          if (hd) { if (title) hd.before(title); hd.after(meta); } else card.append(meta);
          card.prepend(mailOpenBar(`mail:${key}`, card));
          if (MT_READY) mailThreadSync();
        }
        const files = card && key && Array.isArray(e.attachments) ? mailFilesNode(key, e.attachments) : null;
        if (files) card.querySelector(":scope > .rc-raw").before(files);
        return card;
      }
      const f = k => (text.match(new RegExp(`^${k}: ?(.*)$`, "m")) || [])[1] || "";
      const subj = f("subject"), acct = (text.match(/^new mail \(([^)]*)\)/m) || [])[1] || "";
      const snip = (text.match(/^snippet: ?([\s\S]*)$/m) || [])[1] || "";
      const from = f("from").replace(/\s*<[^>]+>\s*$/, "").replace(/^"|"$/g, "") || f("from");
      if (subj) return resultCard({ src: from || acct || SYS_LABEL.mail, at: e.ts, title: subj, text: snip.trim() });
    }
    // falls through: a mail without a subject line shows as plain text
    case "schedule": case "watch": {
      // the gateway's own wake (hub/main.ts wakeOnce: update carry-over, text overrides) is an instruction to the assistant: no card
      if (e.kind === "schedule" && e.source === "gateway") return null;
      // Same card as any other assistant message: who, when, then the plain line; the raw output folds under 원문.
      const body = e.kind === "watch" ? watchLine(e.label || e.watch, e.reason, text, { prev: e.prev }) : scheduleLine(text);
      return resultCard({ src: e.kind === "watch" ? humanLabel(e.label || e.watch) : SYS_LABEL[e.kind], at: e.ts, text: e.kind === "watch" ? body : body.replace(/^[^\n]*\n?/, ""), title: e.kind === "watch" ? undefined : body.split("\n")[0] });
    }
    default: {
      const fromLane = typeof e.source === "string" && e.source.startsWith("lane:");
      // A session's report or answer is a full message; its mid-turn progress line (update_key), new or stored, reads as the live status.
      const { tone: mark, claim, text: parsed, emoji } = e.kind === "out" || e.kind === "lane_report" ? statedTone(noHandoff(text), true) : { tone: "", text };
      const isNote = e.kind === "out" && !!e.update_key && !e.live && (fromLane || (typeof e.target === "string" && e.target.startsWith("lane:"))) && !parseChoices(parsed).blocks.length;
      // A stored [run] or [wait] draws no tag of its own: syncLiveTags gives the newest report the state of now.
      const parked = parkedTone(mark) && !e.live && !isNote, tone = parked ? "" : isNote ? mark || "run" : mark;
      // The marker is a status tag in front of the first line (02-basic-markdown.js toneLead), for the orchestrator and a session alike.
      const body = isNote ? noteText(parsed.replace(/^진행 중:\s*/, "")) : parsed;
      const name = e.kind === "lane_report" ? String(e.lane ?? "") : fromLane ? targetName(e.source) : e.target === "alert" ? "알림" : e.target === "worklog" ? "작업내역" : isRestart(e) ? "게이트웨이" : e.relay ? targetName(e.target) : botName;
      if (e.kind === "out" && e.card && Array.isArray(e.card.facts)) return el("div", { class: "bm" }, el("div", { class: "mt" }, name ? el("span", { class: "mn", text: name }) : null, hm ? `${name ? " · " : ""}${hm}` : null), rpQuote(e), cardNode(e.card));
      const card = e.kind === "lane_report" && !isLaneT(target) ? " rep" : e.target === "alert" ? " alert" : "";
      const head = el("div", { class: "mt" }, name ? el("span", { class: "mn", text: name }) : null, hm ? `${name ? " · " : ""}${hm}` : null);
      if (e.live || isNote) return el("div", { class: `bm${card}` }, head, liveNode(body, tone, isNote));
      const liveAttr = parked ? { "data-live-tone": "1", "data-live-of": fromLane ? e.source : e.kind === "lane_report" ? `lane:${e.lane}` : "" } : {};
      const pc0 = !e.relay && (e.kind === "out" || e.kind === "lane_report") ? parseChoices(parsed) : null, pc = pc0 && choiceAsks(e, tone, pc0) ? pc0 : null;
      // A plain alert is one human line with the raw text folded; an alert that asks (a choice block) shows whole, and a tap on it opens
      // the decision sheet (30-notices.js) — the options themselves live there, never in the message body.
      if (e.target === "alert" && !(pc && pc.blocks.length)) {
        const shown = noticeKo(body, NK);
        if (/```원문\n/.test(body)) return el("div", { class: `bm${card}` }, head, toneLead(mdNode(shown), tone));
        const line = humanAlert(shown);
        // A watch's change line (89,000원 → 72,000원) stands under the sentence with the old value struck, not only folded in the raw text.
        const chg = nwChangeNode(nwChangeLine(body));
        return el("div", { class: `bm${card}` }, head, toneLead(mdNode(line), tone), chg ? el("div", { class: "nw-line" }, chg) : null, line.trim() === shown.trim() ? null : el("details", { class: "more" }, el("summary", { text: "자세히" }), el("pre", { text: shown })));
      }
      // A result file of another computer's conversation lives on that computer: its chips and paths open through the peer proxy.
      // A relayed line is another computer's text, not this gateway's: no file chips, no path chips, no choice card; its `[file]` lines stay text (e.relay, 42-relay-chat.js).
      const fl = e.relay ? { text: body, files: [] } : fileLines(body), host = pqPc(eventTarget(e) || "");
      // Shapes are for an answer, a report or a "started" note of the assistant: never a line the next one replaces (a progress note, a session's [run]), a gateway line or a relayed line.
      // A worklog post is keyed only to show its newest version (13-data.js dedupKeyed), so it stays an answer.
      const answer = (e.kind === "out" || e.kind === "lane_report") && !e.relay && (!e.update_key || e.target === "worklog") && e.source !== "gateway" && (mark !== "run" || (e.kind === "out" && !fromLane));
      const inl = pc && !isFixedT(target) && pc.blocks.some(b => b.options.length > 1);   // the card in the message (10-decision-card.js dcInline); in 알림 / 작업내역 a tap opens the sheet
      const shown = inl ? inlineBody(fl.text) : pc && pc.blocks.length ? choiceBody(fl.text) : fl.text;
      // A spec stored before the hub read an emoji mark holds that mark in its first line: such an answer is drawn from its text, the mark read above.
      const stale = emoji && !Object.values(e.spec?.elements ?? {}).some(x => x?.type === "Status");
      const md = answer ? answerNode(shown, { shaped: fl.files.length > 0, spec: (pc && pc.blocks.length) || stale ? null : e.spec }) : mdNode(shown, "md", !!e.relay), files = e.relay ? null : pathFiles(md, host);
      // A briefing-shaped answer (schedule rows, a mail line, counts) is drawn as a card of rows and chips (11-resultcard.js hcBriefNode).
      const brief = e.kind === "out" && !e.relay && !(pc && pc.blocks.length) ? hcBriefNode(fl.text) : null;
      if (e.kind === "out" && !isRestart(e)) streamIn(brief || md, `${e.ts}|${text.length}`, e.ts);
      const ev = answer && fl.files.length ? md.querySelector(":scope > .ans-ev:last-child") : null;   // the evidence line stays the last thing, under the files
      return el("div", { class: `bm${card}`, ...liveAttr, ...(pc && pc.blocks.length > 1 ? { "data-dat": e.ts } : {}) }, head, rpQuote(e), brief ? (tone || parked || claim ? [toneLead(el("div", { class: "md" }), tone, claim), brief] : brief) : toneLead(md, tone, claim), inl ? dcInline(e, parsed, pc) : null, (answer ? ansFiles : filesNode)(host ? fl.files.map(f => ({ ...f, pc: host })) : fl.files), files, ev);
    }
  }
}
// The gateway's status while a turn runs (hub/livestatus.ts, e.live) and a session's progress note: the head line, one row per fact, then recent steps muted.
// Every row stays on one line, so a long step never wraps on a phone and an update keeps the note's shape. A note is free text, so a tap (`tap`) opens what was cut.
// A note is a model's text, so its marks are drawn (`code`, **bold**); a line of the gateway's status stays as written.
function liveNode(body, tone, tap) {
  const [lead, ...rows] = body.split("\n").filter(l => l.trim()), words = s => (tap ? { safeHtml: inline(s) } : { text: s });
  const lv = toneLead(el("div", { class: "lv", ...(tap ? { tabindex: "0", role: "button" } : {}) }, el("p", words(lead)), ...rows.map(l =>
    /^- /.test(l) ? el("div", { class: "lv-s", ...words(l.slice(2)) }) : l.endsWith(":") ? el("div", { class: "lv-s lv-h", ...words(l.slice(0, -1)) }) : el("div", { class: "lv-r", ...words(l) }))), tone);
  if (tap) lv.onclick = () => { if (!getSelection().toString()) lv.classList.toggle("open"); };
  return lv;
}
// A progress note as rows: no file line, code fence, table rule, small-line or quote mark of a full message.
const noteText = t => fileLines(t).text.split("\n").filter(l => !/^\s*```/.test(l) && !isSep(l)).map(l => l.replace(/^\s*(?:-#|>)\s+/, "")).join("\n");
const WORK = new Set(["tool_call", "tool_result", "thinking", "text", "error"]);
function newGroup(a) {
  const wsum = el("span", { class: "wsum" }), body = el("div", { class: "wbody" });
  // A fold's rows are built when it opens: a conversation holds hundreds of them and drawing them took most of a chat switch. Its summary counts stay live.
  const waiting = [];
  const fill = () => { for (const w of waiting.splice(0)) { const n = actNode(w, g.ctx); if (n) g.body.append(n); } };
  const node = el("details", { class: "work" }, el("summary", { onclick: () => fill() }, el("span", { class: "wdot" }), wsum), body);
  const g = { node, body, ctx: { calls: new Map() }, kinds: new Map(), tools: 0, think: 0, errs: 0, t0: Date.parse(a.ts), t1: Date.parse(a.ts), live: false };
  g.update = () => {
    const parts = [g.t1 - g.t0 >= 1000 ? `${fmtDur(g.t1 - g.t0)} 작업` : g.tools ? "작업" : g.think ? "생각" : "작업"];
    if (g.live) { const d = Math.max(g.t1, Date.now()) - g.t0; parts[0] = `작업 중${d >= 1000 ? ` ${fmtDur(d)}` : ""}`; }
    for (const [k, v] of g.kinds) parts.push(`${k} ${v}`);
    if (g.errs) parts.push(`오류 ${g.errs}`);
    wsum.textContent = parts.join(" · ");
    node.classList.toggle("bad", g.errs > 0);
  };
  g.add = a => {
    waiting.push(a);
    if (node.open) fill();
    if (a.type === "tool_call") { g.tools++; const k = kindOf(a.tool); g.kinds.set(k, (g.kinds.get(k) || 0) + 1); }
    else if (a.type === "thinking") g.think++;
    if (a.type === "error" || (a.type === "tool_result" && a.is_error)) g.errs++;
    const t = Date.parse(a.ts);
    if (t > g.t1) g.t1 = t;
    g.update();
  };
  return g;
}
function dropProgress(key) { const p = CS.prog.get(key); if (p) { p.node.remove(); CS.prog.delete(key); } }
// entry: {m: conversation event} or {a: activity item}. Work between messages folds into one collapsed group.
function chatPush(en, bulk) {
  let fresh = null;   // an incoming message node: a tall one is scrolled to by its top (scrollChat)
  if (en.m && en.m.kind === "delivery") { applyDelivery(en.m); return; }
  if (CS.empty) { CS.empty.remove(); CS.empty = null; }
  if (en.m) {
    if (cleanRestart(en.m)) return;
    dayDiv(en.m.ts);
    if (CS.group) workDone(CS.group);
    CS.group = null;
    const e = en.m;
    if (isSettingsT(target) && eventTarget(e) === target) { if (e.kind === "message") TURN.set(target, Date.parse(e.ts) || Date.now()); else if (e.kind === "out" && !e.update_key) TURN.delete(target); }
    const pkey = e.kind === "out" && e.update_key ? `${e.target ?? ""}|${e.update_key}` : "";
    const et = eventTarget(e) || "", laneT = isLaneT(et) ? et : "";
    // One progress note per target+key (newest text at the newest position; a session keeps only its newest note);
    // the answer to that target (or its lane report) drops them.
    // A status that updates stays where it is: no rise, and it never shrinks while the wait lasts.
    const held = e.live && !bulk ? CS.prog.get(pkey)?.node.offsetHeight || 0 : 0;
    if (pkey) { dropProgress(pkey); if (laneT) for (const [k, v] of CS.prog) if (v.target === laneT) dropProgress(k); }
    else if (!isFixedT(target) && (e.kind === "lane_report" || (e.kind === "out" && !e.system))) {
      const t = e.kind === "lane_report" || laneT ? et : String(e.target ?? "");
      for (const [k, v] of CS.prog) if (v.target === t) dropProgress(k);
    }
    // Repeated [run]/[wait] reports are one message, as on Discord (hub/lanewire.ts): the newest takes the place of the one before it, until another message stands between.
    const parked = e.kind === "lane_report" && !e.answering && parkedTone(statedTone(noHandoff(String(e.text ?? ""))).tone);
    if (parked && CS.parked) { if (!CS.parked.classList.contains("cont")) CS.who = ""; CS.parked.remove(); CS.parked = null; }
    const n = msgNode(e);
    if (n) {
      if (!pkey) CS.parked = parked ? n : null;
      n.dataset.ts = e.ts;   // the notice jump finds its source message by this (30-notices.js ntFind)
      rpMark(n, e);
      if (CV.div && !CV.divNode && convIncoming(e) && e.ts > CV.div) { CV.divNode = tl.appendChild(convDivider()); CS.who = ""; }
      // A status goes when the answer comes, so it never carries a run of speaker heads: the answer keeps its own.
      const who = n.matches(".um, .bm") && !n.querySelector(":scope > .lv") ? speakerOf(e) : "", t = Date.parse(e.ts) || 0;
      if (who && who === CS.who && t - CS.whoT < 600000 && !(e.target === "alert" && n.querySelector(":scope > .mt > .tag"))) n.classList.add("cont");   // an 알림 row that carries a status tag keeps its head, so the tag shows
      CS.who = who; CS.whoT = t;
      if (convIncoming(e)) fresh = n;
      if (held) n.style.minHeight = `${held}px`;
      tlHome(n).append(n); if (!bulk && !held) motionIn(n, "rise", M_MS.fast);   // a message that arrives live rises in (150ms); the drawn history never moves
      if (pkey) CS.prog.set(pkey, { node: n, target: laneT || String(e.target ?? "") });
    }
  } else {
    if (!WORK.has(en.a.type) || isMailT(target) || (isSettingsT(target) && !(TURN.get(target) <= (Date.parse(en.a.ts) || 0)))) return;
    if (!CS.group) { dayDiv(en.a.ts); CS.group = newGroup(en.a); tl.append(CS.group.node); }
    CS.group.add(en.a);
  }
  if (!bulk) syncLiveTags();
  const fixed = TL_TOP_NODE && TL_TOP_NODE.parentNode === tl ? 1 : 0;
  while (tl.children.length > ts(target).cap + fixed) (fixed ? tl.children[1] : tl.firstElementChild)?.remove();
  markLive();
  if (!bulk) scrollChat(false, fresh);
}
// A work group that stops running: its summary line changes from 작업 중 to the finished count in place, once.
function workDone(g) {
  const end = () => { g.live = false; g.node.classList.remove("live"); g.update(); };
  if (g.live) motionSwap(g.node.firstElementChild, end); else end();
}
function markLive() {
  const g = CS.group;
  if (!g) return;
  const live = isWorking(target) && tl.lastElementChild === g.node;
  if (g.live === live) return;
  if (live) { g.live = true; g.node.classList.add("live"); g.update(); } else workDone(g);
}
