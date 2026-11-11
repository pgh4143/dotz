/* ---------- 프로젝트: level 2 overview (header, 확인 필요, four summary rows) and level 3 drill-in pages ---------- */
// PM.D = the detail; PM.open counts fields being edited (a refresh never repaints under them);
// PM.sheets = the open drill-in pages, repainted from the re-fetched detail after every write.
const pmReset = () => ({ key: "", D: null, fail: false, open: 0, flight: null, sheets: new Set() });
let PM = pmReset();
function pmOpen(key) {
  if (PM.key !== key) { for (const s of PM.sheets) s.h.close(false); PM = { ...pmReset(), key }; }
  pmPaint(); prjLoad(); pmLoad();
}
function pmLoad() {
  const st = PM;
  if (!st.key) return Promise.resolve(false);
  if (st.flight) return st.flight;
  st.flight = api(`/api/custom/project?key=${enc(st.key)}`).then(d => { st.D = d; st.fail = false; return true; }, () => { if (!st.D) st.fail = true; return false; })
    .then(ok => { st.flight = null; if (PM === st) pmPaint(); return ok; });
  return st.flight;
}
// A project turn changed this project's info (hub/outbound.ts noteProjectInfo): a fetch already out may predate it, so one follows it.
function pmLive(e) {
  if (current !== "project" || (e.key !== PM.key && e.key !== (pmProject() || {}).recordKey)) return;
  (PM.flight || Promise.resolve()).then(pmLoad);
}
// After a write: fetch again and repaint from what the gateway kept (the page never shows the typed value as saved).
async function pmReload() {
  const st = PM;
  if (st.flight) await st.flight;
  const root = $("#v-project");
  if (root) delete root.dataset.sig;
  st.open = 0;
  await Promise.all([pmLoad(), prjLoad()]);
}
// The record lives under the project's channel when it has one (hub/custom.ts recordKey).
const pmWrite = body => api("/api/projects", "PUT", { key: (pmProject() || {}).recordKey || PM.key, ...body });
// Runs a write; a failure stays as a calm note under the control, a success re-fetches.
async function pmDo(note, fn) {
  note.className = "note"; note.textContent = "";
  try { await fn(); } catch (e) { note.className = "note err"; note.textContent = `저장하지 못했어요 · ${e.message}`; return false; }
  await pmReload();
  return true;
}
const pmNames = {};   // project key -> the name last shown for it
function pmProject() {
  const found = ((PRJ && PRJ.projects) || []).find(x => x.key === PM.key || x.recordKey === PM.key);
  if (found) return found;
  const D = PM.D;
  return D ? { key: PM.key, name: (D.record && D.record.title) || (PM.key === "builtin:custom" ? "커스텀" : PM.key), lanes: D.lanes || [], record: D.record } : null;
}
function pmSessionRows(p, D) {
  const dl = (D && D.lanes) || [], all = (S && S.lanes) || [], names = new Set([...dl.map(l => l.name), ...(p.lanes || []).map(l => l.name)]);
  const chat = prjChat(p);
  if (chat) for (const l of all) if (laneChat(l) === chat) names.add(l.name);
  return [...names].map(n => {
    const s = all.find(l => l.name === n), d = dl.find(l => l.name === n) || (p.lanes || []).find(l => l.name === n) || {};
    return { project: (s && laneProject(s)) || prjTitle(p), at: Date.parse(d.finishedAt || d.lastReportAt || d.startedAt || (s && s.startedAt) || "") || 0, name: n, title: (s && s.title) || d.title || n, live: s ? laneAlive(s) : !!d.live, status: s ? s.status : d.status, waiting: s ? !!s.pendingAsk : !!d.waiting, ask: s && s.pendingAsk && s.pendingAsk.text ? oneLine(s.pendingAsk.text) : "", line: friendlyLine(d.line || d.lastText || "").slice(0, 140) };
  }).map(r => ({ r, rank: pmSessionRank(r) })).sort((a, b) => a.rank - b.rank || (a.rank === PM_DONE ? b.r.at - a.r.at : a.r.title.localeCompare(b.r.title))).map(x => x.r);
}
// The word of a project's session row, the same as its 진행 중 row (sessionState). Waiting on the owner, then running, then what stopped short; finished sink, newest first.
const pmLaneState = r => sessionState({ name: r.name, status: r.status, live: r.live, pendingAsk: r.waiting });
const PM_DONE = 3;
function pmSessionRank(r) {
  const s = pmLaneState(r);
  return s === SESSION_WORD.wait ? 0 : s === SESSION_WORD.run ? 1 : s === SESSION_WORD.done ? PM_DONE : 2;
}
// Level 2: the essentials only. Each section is one tappable summary row that opens its own page (level 3, pmSheet).
function pmPaint() {
  if (current !== "project" || PM.open > 0) return;
  const root = $("#v-project"), D = PM.D, p = pmProject();
  // The name stays in the app bar when the project cannot be read now: the last one seen, or the chat channel's own name.
  if (!p) { if (!ppWide()) $("#title").textContent = pmNames[PM.key] || (isProjT(PM.key) ? targetName(PM.key) : "프로젝트"); delete root.dataset.sig; clear(root).append(emptyNode(PM.fail || PRJ_FAIL ? "프로젝트를 불러오지 못했어요" : "불러오는 중…", PM.fail || PRJ_FAIL ? () => Promise.all([pmLoad(), prjLoad()]) : null)); return; }
  if (p.builtin) { cmPaint(root, p, D); return; }
  const q = { ...p, record: (D && D.record) || p.record }, rows = pmSessionRows(p, D);
  pmNames[PM.key] = prjTitle(q);
  // A phone shows one screen at a time, so its app bar carries the project's name (the prototype's detail); wide keeps the list beside it under "프로젝트".
  $("#title").textContent = ppWide() ? "프로젝트" : prjTitle(q);
  const sig = JSON.stringify([q, D, rows, botName, PM.fail]);
  if (root.dataset.sig === sig) return;
  root.dataset.sig = sig;
  // Not read yet is not empty: what is already known (확인 필요, the sessions) shows, and under it a pending load says so, a failed one offers 다시 시도.
  const o = pmOverview(q, D, rows);
  if (!D) o.append(emptyNode(PM.fail ? "나머지를 불러오지 못했어요" : "불러오는 중…", PM.fail ? () => { PM.fail = false; pmPaint(); pmLoad(); } : null));
  clear(root).append(pmHead(q), o);
  pmSheetsPaint();
}
// An open drill-in page follows the detail: a save or a 20 s refresh repaints it from the re-fetched data, never under a field being typed in.
// A row of one of these pages opens a conversation: the page must not stay over it.
const pmSheetsClose = () => { for (const s of [...PM.sheets]) s.h.close(); };
function pmSheetsPaint() {
  for (const s of PM.sheets) if (!(s.h.box.contains(document.activeElement) && document.activeElement.matches("input, textarea"))) s.paint();
}
// What needs the owner now: the prototype's 확인 필요 card (s-work.js project ask): the question, then one filled action. Nothing else needs a card of its own:
// a running session or job is already a row of the lists below.
function pmPrimary(rows) {
  const wait = rows.filter(r => r.waiting), ask = wait[0];
  if (!ask) return null;
  return el("div", { class: "card pm-need" },
    el("div", { class: "ch" }, el("h3", { text: "확인 필요" }), el("span", { class: "tag warn", text: "답 기다림" })),
    el("div", { class: "pm-need-t", text: ask.ask || ask.title }),
    wait.length > 1 ? el("div", { class: "pm-need-s", text: `외 ${wait.length - 1}개도 답을 기다려요` }) : null,
    el("div", { class: "cf" }, el("button", { class: "btn pm-need-a", type: "button", "data-k": "answer", onclick: () => openTarget(`lane:${ask.name}`, lastChatView()) }, "대화에서 답하기")));
}
// A monitor, routine or schedule of the project as a prototype 감시 row: health dot, name, one quiet line, and what kind it is.
function pmWatchRow(x) {
  const mins = x.every_minutes ?? (x.schedule && x.schedule.every_minutes) ?? 0, [tone, why] = pmHealth(x);
  const sub = [mins ? pmEvery(mins) : "", x.paused ? "일시 정지" : why || (x.lastRun ? `마지막 ${kstStamp(x.lastRun)}` : "")].filter(Boolean).join(" · ");
  // A monitor opens beside the other monitors, as in 모니터링; an app's own watch has no row there and stays in the sheet.
  const open = () => { const it = x.kind === "monitor" ? monItems().find(i => i.mon && i.mon.watch === x.id) : null; if (it) go("monitoring", monRowGo(it)); else pmSheet("routines"); };
  return el("button", { class: "li tap", type: "button", onclick: open },
    el("span", { class: "lead" }, el("span", { class: `dot ${tone}` })),
    el("span", { class: "tx" }, el("div", { class: "hd", text: pmRoutineName(x) }), sub ? el("div", { class: "sup", text: sub }) : null),
    el("span", { class: "li-end" }, el("span", { class: "tag", text: PM_KIND[x.kind] })));
}
function pmOverview(q, D, rows) {
  const work = (D && D.work) || [], results = (D && D.results) || [], items = pmRoutineItems(D);
  const works = [...work.filter(w => w.status === "running"), ...work.filter(w => w.status !== "running")];
  const info = (D && D.info) || {}, files = info.files || [];
  // A section with nothing in it is left out, title and all.
  return el("div", { class: "pm-o" },
    pmPrimary(rows),
    pmSection({ kind: "info", label: "지금 상황", count: "", action: D && D.info ? "전체" : "", head: info.summary ? el("div", { class: "pm-goal sup", text: info.summary }) : null,
      nodes: pmInfoRows(info) }),
    pmSection({ kind: "sessions", label: "세션", count: rows.length, action: rows.length ? "전체" : "", nodes: rows.slice(0, 5).map(pmLaneRow) }),
    pmSection({ kind: "sessions", label: "작업", count: work.length, nodes: works.slice(0, 4).map(pmWorkRow) }),
    pmSection({ kind: "results", label: "결과", count: results.length, action: results.length ? "전체" : "", nodes: results.slice(0, 4).map(pmResultRow) }),
    files.length ? pmSection({ kind: "info", label: "파일", count: files.length, action: files.length > 3 ? "전체" : "", nodes: files.slice(-3).toReversed().map(pmFileRow) }) : null,
    pmSection({ kind: "routines", label: "감시", count: items.length, action: items.length ? "전체" : "", nodes: items.slice(0, 4).map(pmWatchRow) }));
}
// A line of what the project's turns kept (hub/projectinfo.ts), with what kind of line it is.
const pmInfoRow = (text, tag, tone = "") => el("div", { class: "li" }, el("span", { class: "tx" }, el("div", { class: "hd pmv-clamp pmv-wrap", text })), tag ? el("span", { class: "li-end" }, el("span", { class: `tag ${tone}`, text: tag })) : null);
const pmInfoRows = i => [...(i.blocked || []).map(t => pmInfoRow(t, "막힘", "warn")), ...(i.next || []).slice(0, 3).map(t => pmInfoRow(t, "다음")), ...(i.decided || []).slice(-3).toReversed().map(d => pmInfoRow(d.text, "정함"))];
const pmFileRow = f => el("button", { class: "li tap", type: "button", onclick: () => openPath(f.path) }, el("span", { class: "tx" }, el("div", { class: "hd", text: f.label })));
function pmInfoBody(D) {
  const i = (D && D.info) || {}, part = (title, rows) => rows.length ? [el("div", { class: "pmv-day", text: title }), el("div", { class: "list" }, ...rows)] : [];
  const nodes = [
    ...(i.summary ? [el("div", { class: "pm-goal sup", text: i.summary })] : []),
    ...part("막힌 것", (i.blocked || []).map(t => pmInfoRow(t))),
    ...part("다음", (i.next || []).map(t => pmInfoRow(t))),
    ...part("정한 것", (i.decided || []).toReversed().map(d => pmInfoRow(d.text))),
    ...part("기억해 둔 말", (i.prefs || []).toReversed().map(p => pmInfoRow(p.text))),
    ...part("파일", (i.files || []).toReversed().map(pmFileRow)),
  ];
  return nodes.length ? el("div", {}, ...nodes) : emptyNode("대화하면서 정한 내용이 여기에 모여요");
}
// The prototype's section header + list (s-work.js project detail: 지금 상황 · 세션 · 작업 · 결과 · 감시); the header button opens the section's full page.
function pmSection({ kind, label, count, action, head, nodes }) {
  if (!nodes.length && !head) return null;
  return el("div", { class: "pm-block" },
    el("div", { class: "sec sec-act pm-sec" }, el("span", { text: `${label}${count !== "" ? ` ${count}` : ""}` }),
      action ? el("button", { class: "btn text sm", type: "button", "data-k": kind, onclick: () => pmSheet(kind), text: action }) : null),
    head,
    nodes.length ? el("div", { class: "list pm-sec-list" }, ...nodes) : null);
}
// Level 3: one section page over the overview. It is an overlay, so 32-history-nav gives it its own history entry: the back arrow
// (or the browser's back) returns to the overview. Every function of the old one-page layout lives here, unchanged.
const PM_PAGE = { info: ["지금 상황", "대화에서 정리된 내용이에요"], rules: ["내 규칙", "최근에 정한 순서예요"], sessions: ["세션 기록", "이 프로젝트의 세션과 백그라운드 작업"], results: ["결과 전체", "보고, 확인, 커밋"], routines: ["루틴과 모니터링", "주기적으로 도는 일"] };
function pmSheet(kind) {
  const [title, ey] = PM_PAGE[kind] || ["프로젝트", ""];
  let entry;
  const h = fsOpen({ cls: "pdv", labelledby: "pdv-t", onClose: () => PM.sheets.delete(entry) });
  entry = { h, paint: () => {
    const p = pmProject();
    if (!p) { clear(h.box).append(el("div", { class: "fs-body pdv-body" }, emptyNode("불러오는 중…"))); return; }
    const rows = pmSessionRows(p, PM.D);
    const body = kind === "info" ? pmInfoBody(PM.D) : kind === "rules" ? cmRulesBody() : kind === "sessions" ? pmSessions(PM.D, rows) : kind === "results" ? pmResults(PM.D) : pmRoutines(PM.D);
    clear(h.box).append(
      el("div", { class: "pdv-hd" },
        el("button", { class: "ib pdv-back", type: "button", "data-k": "back", "aria-label": "뒤로", title: "프로젝트로", onclick: () => h.close() }, icon("back")),
        el("div", { class: "pdv-tt" }, el("h2", { class: "pdv-t", id: "pdv-t", text: title }), el("div", { class: "pdv-ey", text: ey }))),
      el("div", { class: "fs-body pdv-body" }, ...(Array.isArray(body) ? body : [body])));
  } };
  PM.sheets.add(entry);
  entry.paint();
}

// A value that edits in place: tap -> field with 저장/취소; save() writes it, then the page shows the re-fetched value.
function pmEditable({ value, shown = value, placeholder = "비어 있어요", label, multiline, required, cls = "", save }) {
  const wrap = el("div", { class: "pmv-ed" });
  const show = () => clear(wrap).append(el("button", { type: "button", class: `pmv-edit ${cls}${shown ? "" : " empty"}`, title: "눌러서 고쳐요", "aria-label": `${label} 고치기`, onclick: edit, text: shown || placeholder }));
  const edit = () => {
    PM.open++;
    const f = multiline ? el("textarea", { class: "fi pmv-ta", rows: 3, "aria-label": label }) : input({ "aria-label": label });
    f.value = value || "";
    const err = el("div", { class: "note err" });
    const close = () => { PM.open = Math.max(0, PM.open - 1); show(); };
    const ok = el("button", { class: "btn sm", type: "button", text: "저장" });
    const commit = async () => {
      const v = f.value.trim();
      if (v === (value || "")) return close();
      if (required && !v) { err.textContent = "비워 둘 수 없어요"; return; }
      ok.disabled = true; err.textContent = "";
      try { await save(v); } catch (e) { err.textContent = `저장하지 못했어요 · ${e.message}`; ok.disabled = false; return; }
      await pmReload();
    };
    ok.onclick = commit;
    f.addEventListener("keydown", ev => {
      if (ev.isComposing || ev.keyCode === 229) return;
      if (ev.key === "Escape") { ev.stopPropagation(); close(); }
      else if (ev.key === "Enter" && (!multiline || ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); commit(); }
    });
    clear(wrap).append(el("div", { class: "pmv-form" }, f, err, el("div", { class: "pmv-acts" }, el("button", { class: "btn text sm", type: "button", text: "취소", onclick: close }), ok)));
    f.focus();
  };
  show();
  return wrap;
}

// The prototype's project header card: name + state tag + last activity, the purpose under it.
function pmHead(q) {
  const chat = prjChat(q), can = !!chat && validTarget(chat), st = prjState(q), tone = st.tone === "att" ? "warn" : st.tone, at = prjLastAt(q);
  return el("div", { class: "pmv-head" },
    el("div", { class: "pmv-hmain" },
      el("div", { class: "pmv-htop" },
        pmEditable({ value: prjTitle(q), label: "프로젝트 이름", required: true, cls: "pmv-title", save: v => pmWrite({ title: v }) }),
        st.k === "idle" && at ? null : el("span", { class: `tag ${tone}`, text: st.word }),
        at ? el("span", { class: "pmv-upd", text: `마지막 대화 ${prjAgo(at)}` }) : null),
      pmEditable({ value: prjPurpose(q), shown: prjBlurb(prjPurpose(q)), label: "프로젝트 설명", placeholder: "무엇을 하는 프로젝트인지 적어 주세요", multiline: true, cls: "pmv-purpose", save: v => pmWrite({ purpose: v }) })),
    // No work channel, nothing to chat with: the button is left out instead of showing a dead one.
    chat ? el("div", { class: "pmv-hact" }, el("div", { class: "pmv-hrow" },
      can ? el("button", { class: "btn tonal", type: "button", title: "이 프로젝트 전용 채팅을 열어요", onclick: () => openTarget(chat, lastChatView()), text: "프로젝트 채팅" }) : null,
      pmMenuButton(q))) : null);
}
// The project a chat target (ch:<id>) belongs to, from the list the 프로젝트 tab shows (null until it has loaded or once it is gone).
const pmOfTarget = t => ((PRJ && PRJ.projects) || []).find(x => !x.builtin && prjChat(x) === t) || null;

// 프로젝트 삭제 (hub/projectdelete.ts): the ⋯ menu opens a sheet that lists what goes; 삭제 sends DELETE /api/projects/<ch:id>,
// or POST /api/peer/act {action:"project"} for a project of another computer (q.pc = {name, url}).
// The ⋯ menu (수정 / 삭제) is shared: the project page and a project's chat header (31-conversations.js) both build it here. `q` is a project or a
// function that returns it; 수정 opens that project's page in the 프로젝트 tab (on the page itself it starts editing the name).
function pmMenuButton(q, cls = "pmv-more") {
  const b = el("button", { class: `ib ${cls}`, type: "button", "aria-label": "프로젝트 메뉴", title: "프로젝트 메뉴", "aria-haspopup": "listbox", "aria-expanded": "false" }, icon("more"));
  b.addEventListener("click", () => {
    const p = typeof q === "function" ? q() : q;
    if (!p) return toast("이 프로젝트를 찾을 수 없어요");
    showMenu(b, [{ value: "edit", label: "프로젝트 수정" }, { value: "delete", label: "프로젝트 삭제", danger: true }], { onPick: v => {
      if (v === "delete") return pmDeleteAsk(p);
      if (current === "project" && PM.key === p.key) { const t = $("#v-project .pmv-title"); if (t) t.click(); } else go("project", p.key);
    } });
  });
  return b;
}
function pmDeleteCall(q, op, args = {}) {
  const key = prjChat(q);
  if (q.pc) return api(pqProxy(q.pc, "/api/peer/act"), "POST", { action: "project", args: { op, key, ...args } });
  return op === "delete-plan" ? api(`/api/projects/${enc(key)}/delete-plan`) : api(`/api/projects/${enc(key)}`, "DELETE", args);
}
const pmDeleteLines = p => [
  `#${p.name} 채널을 Discord에서 지워요`,
  p.monitors.length ? `모니터링 ${p.monitors.length}개는 따로 남겨요: ${p.monitors.join(", ")}` : "",
  p.logins.length ? `로그인 유지 ${p.logins.length}개도 남겨요: ${p.logins.map(l => l.name).join(", ")}` : "",
  p.standing ? `자동 처리 설정을 지워요: ${p.standing}` : "",
  `알림 ${p.notices}개를 치워요`,
  `대화 ${p.messages}개는 보관 파일로 남겨요`].filter(Boolean);
async function pmDeleteAsk(q) {
  const fromChat = current === "chat";   // deleted from a project's chat header: land on the main chat, not the 프로젝트 list
  let p;
  try { p = await pmDeleteCall(q, "delete-plan"); } catch (e) { return toast(e.message || "지울 내용을 읽지 못했어요", true); }
  const st = { drop: false, busy: false }, err = el("div", { class: "note err" });
  const h = fsOpen({ labelledby: "pmd-t" });
  // The app's own switch row (as 설정), not a browser checkbox: the whole row is the tap target.
  const sw = el("button", { type: "button", class: "hs-sw", role: "switch", "aria-checked": "false", "aria-label": "보관 파일도 같이 지우기", "data-k": "drop-archive" });
  const drop = el("div", { class: "li tap", onclick: () => { st.drop = !st.drop; sw.setAttribute("aria-checked", String(st.drop)); } }, el("span", { class: "tx" }, el("div", { class: "hd", text: "보관 파일도 같이 지워요" })), liEnd(sw));
  const go1 = el("button", { class: "btn danger fill", type: "button", "data-k": "delete", disabled: p.running.length > 0, onclick: async () => {
    if (st.busy) return;
    st.busy = true; go1.disabled = true; err.textContent = "";
    try {
      const r = await pmDeleteCall(q, "delete", { archive: !st.drop });
      h.close(false);
      toast(r && r.discord && !r.discord.ok ? `프로젝트는 지웠지만 Discord 채널은 남아 있어요 · ${r.discord.error}` : `${(r && r.name) || p.name} 프로젝트를 지웠어요`, !!(r && r.discord && !r.discord.ok));
      PM = pmReset();
      if (fromChat) pickTarget(MAIN); else go("projects");
      prjLoad();
    } catch (e) { err.textContent = e.message || "지우지 못했어요"; st.busy = false; go1.disabled = false; }
  } }, "삭제");
  clear(h.box).append(
    fsHead([el("h2", { class: "fs-t", id: "pmd-t", text: `${p.name} 프로젝트를 삭제할까요?` })], { close: () => h.close() }),
    el("div", { class: "fs-body pmd" },
      p.running.length ? el("div", { class: "note err", text: `실행 중인 세션이 있어서 지울 수 없어요: ${p.running.join(", ")}` }) : null,
      el("ul", { class: "as-rml" }, ...pmDeleteLines(p).map(t => el("li", { text: t }))),
      el("div", { class: "list" }, drop)),
    el("div", { class: "fs-ft row pmd-ft" }, err, el("button", { class: "btn text", type: "button", onclick: () => h.close() }, "취소"), go1));
}

// 세션 기록 page: what runs now, then the ended sessions and finished background work, newest first.
function pmSessions(D, rows) {
  const live = rows.filter(r => r.live), past = rows.filter(r => !r.live), work = (D && D.work) || [];
  return el("div", { class: "pdv-stack" },
    el("div", { class: "sec", text: "진행 중" }), pmDoing(live, work.filter(w => w.status === "running")),
    el("div", { class: "sec", text: "최근 세션" }), pmRecent(past, work.filter(w => w.status !== "running")));
}

const PM_KIND = { monitor: "모니터링", routine: "루틴", schedule: "예약" };
const pmEvery = n => !(n > 0) ? "" : n % 60 === 0 ? `매 ${n / 60}시간` : `매 ${n}분`;
// Health dot: ok after a clean run, err after a failed one (failure is red, owner 2026-10-28); a paused item has none.
function pmHealth(x) {
  if (x.paused) return ["", ""];
  const n = x.fails || 0;
  if (x.lastOk === false) return n >= 3 ? ["err", `계속 실패 ${n}번`] : ["err", "마지막 실행 실패"];
  if (n > 0) return ["err", `실패 ${n}번`];
  return [x.lastRun ? "ok" : "", ""];
}
// The recurring work of a project, monitors first: scripts the gateway runs, then routines and one-off schedules that wake the model.
function pmRoutineItems(D) {
  if (!D) return [];
  const L = D.linked || {};
  return [...(D.monitors || L.watches || []).map(x => ({ ...x, kind: "monitor" })), ...(D.routines || L.routines || []).map(x => ({ ...x, kind: "routine" })), ...(D.schedules || L.schedules || []).map(x => ({ ...x, kind: "schedule" }))];
}
function pmRoutines(D) {
  if (!D) return emptyNode(PM.fail ? "불러오지 못했어요" : "불러오는 중…");
  const items = pmRoutineItems(D);
  return items.length ? el("div", { class: "list" }, ...items.map(pmRoutine)) : emptyNode("아직 루틴이나 모니터링이 없어요");
}
// A schedule's text starts with its internal target (ch:<id>, lane:<name>) for the orchestrator; the owner reads the words.
const pmRoutineName = x => x.name || String(x.text || "").replace(/^\s*(?:(?:ch|lane|th):\S+\s*)+/, "") || x.id;
function pmRoutine(x) {
  const mins = x.every_minutes ?? (x.schedule && x.schedule.every_minutes) ?? 0;
  const once = !mins && (x.at || (x.schedule && x.schedule.at));
  const next = x.nextAt || (x.kind === "schedule" ? x.at : "") || (x.schedule && x.schedule.at) || "";
  const [tone, why] = pmHealth(x);
  const url = x.kind === "monitor" ? `/api/watches/${enc(x.id)}` : x.kind === "schedule" ? `/api/schedules/${enc(x.id)}` : "";
  const name = pmRoutineName(x);
  const note = el("div", { class: "note" }), box = el("div", { class: "pmv-rt" });
  const meta = [PM_KIND[x.kind], mins ? pmEvery(mins) : once ? "한 번" : "", x.kind === "monitor" ? (x.on === "match" ? "패턴이 나오면 알려요" : "확인해서 알려요") : "", x.lastRun ? `마지막 ${kstStamp(x.lastRun)}` : x.kind === "monitor" ? "아직 안 돌았어요" : "", !x.paused && next ? `다음 ${kstStamp(next)}` : ""].filter(Boolean);
  const patch = body => pmDo(note, () => api(url, "PATCH", body));
  const view = () => {
    PM.open = Math.max(0, PM.open - (box.dataset.editing ? 1 : 0)); delete box.dataset.editing;
    const acts = el("div", { class: "pmv-rt-acts" });
    if (url) {
      const pause = el("button", { class: "btn tonal inrow", type: "button", text: x.paused ? "다시 시작" : "일시정지", onclick: () => { pause.disabled = true; patch({ paused: !x.paused }).then(ok => { if (!ok) pause.disabled = false; }); } });
      acts.append(mins || (x.kind === "monitor" && x.on === "match") ? el("button", { class: "btn text inrow", type: "button", text: "수정", onclick: form }) : "",
        x.script ? el("button", { class: "btn text inrow", type: "button", text: "스크립트", onclick: scriptEdit }) : "", pause);
    } else if (x.kind === "routine") {
      const run = el("button", { class: "btn tonal inrow", type: "button", text: "지금 실행", onclick: () => { run.disabled = true; pmDo(note, () => api("/api/custom/routine", "POST", { id: x.id })).then(() => { run.disabled = false; }); } });
      acts.append(run);
    }
    clear(box).append(
      el("div", { class: "pmv-rt-top" }, el("span", { class: `dot ${tone}`, role: "img", "aria-label": why || (tone === "ok" ? "정상" : "상태 없음"), title: why || (tone === "ok" ? "정상" : "") }),
        el("span", { class: "pmv-rt-name", text: name }),
        // How it runs (owner 2026-10-21: recurring work runs as scripts first): a monitor is a script the gateway runs with no
        // tokens, a routine or schedule wakes the model.
        el("span", { class: "tag", title: x.kind === "monitor" ? "게이트웨이가 직접 실행 · 토큰 없음" : "실행할 때마다 모델을 호출해요", text: x.kind === "monitor" ? "스크립트" : "모델" }),
        x.paused ? el("span", { class: "tag", text: "일시 정지" }) : null, why && tone ? el("span", { class: `tag ${tone}`, text: why }) : null),
      el("div", { class: "pmv-rt-meta" }, ...meta.map(t => el("span", { text: t }))),
      ...(x.pattern ? [el("div", { class: "pmv-rt-meta" }, el("span", { text: `패턴 · ${x.pattern}` }))] : []), acts, note);
  };
  // A script monitor's file (GET/PUT /api/watches/<id>/script): read, edit and save it in place; the next run uses it.
  const scriptEdit = async () => {
    PM.open++; box.dataset.editing = "1";
    const ta = el("textarea", { class: "fi pmv-ta pmv-code", rows: 12, spellcheck: "false", "aria-label": `${name} 스크립트` });
    const err = el("div", { class: "note err" }), ok = el("button", { class: "btn sm", type: "button", text: "저장", disabled: true });
    clear(box).append(el("div", { class: "pmv-rt-top" }, el("span", { class: "pmv-rt-name", text: name })), el("div", { class: "pmv-rt-meta" }, el("span", { text: x.script })), ta, err,
      el("div", { class: "pmv-acts" }, el("button", { class: "btn text sm", type: "button", text: "취소", onclick: view }), ok));
    try { ta.value = (await api(`/api/watches/${enc(x.id)}/script`)).text; ok.disabled = false; ta.focus(); }
    catch (e) { err.textContent = `스크립트를 읽지 못했어요 · ${e.message}`; }
    ok.onclick = async () => {
      ok.disabled = true; err.textContent = "";
      try { await api(`/api/watches/${enc(x.id)}/script`, "PUT", { text: ta.value }); } catch (e) { err.textContent = `저장하지 못했어요 · ${e.message}`; ok.disabled = false; return; }
      await pmReload();
    };
  };
  const form = () => {
    PM.open++; box.dataset.editing = "1";
    const hrs = mins > 0 && mins % 60 === 0, mul = hrs ? 60 : 1;   // the form counts in the unit the card says (매 12시간 -> 12 시간마다)
    const iv = mins ? input({ type: "number", min: "1", step: "1", inputmode: "numeric", value: String(mins / mul), "aria-label": hrs ? "간격(시간)" : "간격(분)" }) : null;
    const pt = x.kind === "monitor" && x.on === "match" ? input({ value: x.pattern || "", placeholder: "패턴", "aria-label": "패턴" }) : null;
    const err = el("div", { class: "note err" }), ok = el("button", { class: "btn sm", type: "button", text: "저장" });
    ok.onclick = async () => {
      const body = {};
      if (iv) { const r = Number(iv.value), n = r * mul; if (!Number.isInteger(r) || r < 1) { err.textContent = `간격은 1${hrs ? "시간" : "분"} 이상의 정수로 적어 주세요`; return; } if (n !== mins) body.every_minutes = n; }
      if (pt && pt.value.trim() !== (x.pattern || "")) body.pattern = pt.value.trim();
      if (!Object.keys(body).length) return view();
      ok.disabled = true; err.textContent = "";
      try { await api(url, "PATCH", body); } catch (e) { err.textContent = `저장하지 못했어요 · ${e.message}`; ok.disabled = false; return; }
      await pmReload();
    };
    const field = (label, node, unit) => [el("span", { class: "sup", text: label }), el("span", { class: "pmv-fld" }, node, unit ? el("span", { class: "sup", text: unit }) : null)];
    clear(box).append(el("div", { class: "pmv-rt-top" }, el("span", { class: "pmv-rt-name", text: name })),
      el("div", { class: "pmv-rt-form" }, ...(iv ? field("간격", iv, hrs ? "시간마다" : "분마다") : []), ...(pt ? field("패턴", pt) : [])),
      err, el("div", { class: "pmv-acts" }, el("button", { class: "btn text sm", type: "button", text: "취소", onclick: view }), ok));
    (iv || pt).focus();
  };
  view();
  return box;
}

// The same session row as home (sessionRow, 18-lanes.js).
const pmSessionRow = (r, open) => sessionRow({ name: r.name, title: r.title, status: r.status, live: r.live, pendingAsk: r.waiting }, { project: r.project, line: r.line, ...(typeof open === "function" ? { open } : {}) });
// The prototype's session row (s-work.js project 세션): a state dot, the title, the lane name, and the state tag at the right.
function pmLaneRow(r) {
  const [word, tone] = pmLaneState(r), sub = (r.waiting && r.ask) || r.line;   // what it does now, not its internal name
  return el("button", { class: "li tap", type: "button", onclick: () => openTarget(`lane:${r.name}`, lastChatView()), "aria-label": `${r.title} · ${word} · 대화 열기` },
    el("span", { class: "lead" }, el("span", { class: `dot ${tone}` })),
    el("span", { class: "tx" }, el("div", { class: "hd", text: r.title }), sub ? el("div", { class: "sup", text: sub }) : null),
    el("span", { class: "li-end" }, el("span", { class: `tag ${tone}`, text: word })));
}
// A background job of the main assistant that belongs to the project (asked in its chat, or briefed for its folder): tap lands on its result, or on the asking message while it runs.
const pmWorkRow = w => {
  const run = w.status === "running" && !w.queued, stall = w.status === "stalled", rec = workRecovering(w);
  const word = w.queued ? "순서 대기" : run ? "진행 중" : stall ? "멈춤" : w.status === "done" ? "완료" : w.cancelled ? "중단됨" : rec ? "이어서" : "실패";
  const tag = workTone(w), ok = run || w.status === "done";
  // Same as home's workRow: the dot says the state, the quiet line what or why, the right end a time; a stopped or failed one keeps its word.
  const sub = w.queued ? "순서를 기다려요" : ok ? w.model || "" : stall ? `${w.reason || "활동이 없어요"} · ${workAgo(w)}` : `${workFailText(w)} · ${workAgo(w)}`;
  return withResults(el("button", { class: "li tap", type: "button", onclick: () => workGo(w), "aria-label": `${friendlyLine(w.description)} · ${word}` },
    el("span", { class: "lead" }, el("span", { class: `dot ${tag}` })),
    el("span", { class: "tx" }, el("div", { class: "hd", text: friendlyLine(w.description) }), sub ? el("div", { class: "sup", text: sub }) : null),
    el("span", { class: "li-end" }, ok && !w.queued ? el("span", { class: "sup", text: run ? workElapsed(w) : workAgo(w) }) : el("span", { class: `tag ${tag}`, text: word }))), w.status === "done" ? resultChips(w) : null);
};
// 진행 중: sessions that are alive and background jobs that are running. 최근 세션: the ended ones, newest first.
function pmDoing(live, running) {
  if (!live.length && !running.length) return emptyNode("진행 중인 작업이 없어요");
  return el("div", { class: "list srows" }, ...live.map(pmSessionRow), ...running.map(pmWorkRow));
}
function pmRecent(past, done) {
  const items = [...past.map(r => ({ at: r.at, node: withResults(pmSessionRow(r, () => laneResultGo(r.name, r.at ? new Date(r.at).toISOString() : "")), resultChips(laneResult(`lane:${r.name}`))) })), ...done.map(w => ({ at: w.ended_at || w.started_at, node: pmWorkRow(w) }))].sort((a, b) => b.at - a.at).slice(0, 10);
  return items.length ? el("div", { class: "list" }, ...items.map(x => x.node)) : emptyNode("아직 끝난 세션이 없어요");
}

const PM_RES = { report: "보고", verify: "확인", commit: "커밋", note: "대화" };
const pmDay = at => { const d = kstDay(at), n = Date.now(); return d === kstDay(n) ? "오늘" : d === kstDay(n - 864e5) ? "어제" : d; };
const pmLaneTitle = n => (((S && S.lanes) || []).find(l => l.name === n) || {}).title || n;
// The prototype's result row (s-work.js project 결과): the title, the kind · hash · session · time line, and its state tag.
function pmResultRow(r) {
  const tap = r.kind === "report" && r.lane;
  const tag = r.kind === "report" ? (r.tone === "fail" ? ["err", "안 됨"] : r.verified ? ["ok", "확인됨"] : ["", "보고만 함"]) : r.kind === "verify" ? (r.ok ? ["ok", "통과"] : ["err", "안 됨"]) : ["", "커밋"];
  return withResults(el(tap ? "button" : "div", { class: `li${tap ? " tap" : ""}`, type: tap ? "button" : null, onclick: tap ? () => laneResultGo(r.lane, r.at) : null },
    el("span", { class: "tx" }, el("div", { class: `hd${r.kind === "note" ? " pmv-clamp pmv-wrap" : ""}`, title: r.title || null, text: r.title || PM_RES[r.kind] || "결과" }),
      el("div", { class: "sup", text: [PM_RES[r.kind] || r.kind, r.kind === "commit" ? r.hash : "", r.lane ? pmLaneTitle(r.lane) : "", kstHM(r.at)].filter(Boolean).join(" · ") })),
    tag ? el("span", { class: `tag ${tag[0]}`, text: tag[1] }) : null), r.kind === "report" && r.tone === "done" ? resultChips(pmOwnResult(r)) : null);
}
// A lane keeps one result notice, its last report's: an older report of the same lane is not given the newer one's chips.
function pmOwnResult(r) {
  const n = laneResult(`lane:${r.lane}`);
  return n && Math.abs(ntAt(n) - Date.parse(r.at)) < 10 * 60e3 ? n : null;
}
function pmResults(D) {
  if (!D || !D.results) return emptyNode(PM.fail ? "불러오지 못했어요" : "불러오는 중…");
  if (!D.results.length) return emptyNode("아직 결과가 없어요");
  const groups = [];
  for (const r of D.results) {
    const day = pmDay(r.at);
    if (!groups.length || groups[groups.length - 1].day !== day) groups.push({ day, rows: [] });
    groups[groups.length - 1].rows.push(r);
  }
  return el("div", {}, ...groups.flatMap(g => [el("div", { class: "pmv-day", text: g.day }), el("div", { class: "list" }, ...g.rows.map(pmResultRow))]));
}
// The built-in 커스텀 project (hub/custom.ts builtinDetail): what the owner has customized, each item with a plain line and a
// way to ask for a change. Asking opens the main chat with a draft tagged [프로젝트 커스텀 ...]; the orchestrator keeps those
// personal (MODE.md, Customization). No edit-in-place, no project chat: there is no channel behind it.
const CM_TAG = "[프로젝트 커스텀 · 개인 설정]";
function cmAsk(text) {
  openTarget(MAIN, lastChatView());
  ta.value = text; autosize(); saveDraft(); updateHints(); ta.focus();
}
const cmText = i => el("span", { class: "tx" }, el("div", { class: "hd", title: i.title, text: i.title }), i.line ? el("div", { class: "sup", text: i.line }) : null);
// 내 규칙: the newest few here, every rule behind the list's 더 보기 (hub/custom.ts newestRules sets the order). A row is one short title; a tap
// opens the same chat draft as the other groups' 수정, carrying the rule's full text, and hover shows that text too.
const CM_RULES_SHOWN = 5;
let cmRuleQ = "";
const cmRuleRow = i => el("button", { class: "li tap", type: "button", title: i.full, "aria-label": `${i.title} 수정`,
  onclick: () => { pmSheetsClose(); cmAsk(`${CM_TAG} 내 규칙 "${i.full || i.title}": `); } }, el("span", { class: "tx" }, el("div", { class: "hd", text: i.title })));
const cmRulesCard = g => [el("div", { class: "list" }, ...g.items.slice(0, CM_RULES_SHOWN).map(cmRuleRow),
  g.items.length > CM_RULES_SHOWN ? moreRow(`규칙 ${g.items.length - CM_RULES_SHOWN}개 더 보기`, () => { cmRuleQ = ""; pmSheet("rules"); }) : null)];
function cmRulesBody() {
  const items = ((PM.D && PM.D.groups) || []).find(g => g.id === "rules")?.items || [], found = el("div");
  const fill = () => {
    const q = cmRuleQ.trim().toLowerCase(), hit = items.filter(i => `${i.title} ${i.full}`.toLowerCase().includes(q));
    clear(found).append(hit.length ? el("div", { class: "list" }, ...hit.map(cmRuleRow)) : emptyNode("찾는 규칙이 없어요"));
  };
  fill();
  return [el("label", { class: "pl-search cm-rule-q" }, icon("search"),
    el("input", { id: "cm-q", type: "search", placeholder: "규칙 검색", "aria-label": "규칙 검색", autocomplete: "off", value: cmRuleQ, oninput: ev => { cmRuleQ = ev.target.value; fill(); } })), found];
}
function cmPaint(root, p, D) {
  const sig = JSON.stringify([p, D]);
  if (root.dataset.sig === sig) return;
  root.dataset.sig = sig;
  $("#title").textContent = "프로젝트";
  const ask = (label, text) => el("button", { class: "btn tonal inrow", type: "button", "aria-label": `${label} 수정`, onclick: () => cmAsk(text), text: "수정" });
  const group = g => el("section", { class: "pmv-sec" },
    el("div", { class: "sec sec-act" }, el("span", { text: g.label }), el("button", { class: "btn text sm", type: "button", onclick: () => cmAsk(`${CM_TAG} ${g.label}: `), text: "추가" })),
    ...(!g.items.length ? [emptyNode(g.empty)] : g.id === "rules" ? cmRulesCard(g)
    : [el("div", { class: "list" }, ...g.items.map(i => el("div", { class: "li" },
      cmText(i),
      i.bad ? el("span", { class: "tag warn", text: "확인 필요" }) : null,
      el("span", { class: "li-end" }, ask(g.label, `${CM_TAG} ${g.label} "${i.title}": `)))))]));
  clear(root).append(
    el("div", { class: "pmv-head" }, el("div", { class: "pmv-hmain" },
      el("div", { class: "pmv-htop" }, el("div", { class: "pmv-title", text: p.name }), el("span", { class: "pmv-upd", text: "내 설정" })),
      el("div", { class: "pmv-purpose", text: p.note || "" }))),
    D && D.groups ? el("div", { class: "pmv-cols" }, el("div", { class: "pmv-col" }, ...D.groups.slice(0, 3).map(group)), el("div", { class: "pmv-col" }, ...D.groups.slice(3).map(group))) : emptyNode(PM.fail ? "불러오지 못했어요" : "불러오는 중…"));
}

setInterval(() => {
  if (document.hidden) return;
  if (current === "projects") prjLoad();
  else if (current === "project" && !PM.open) { pmLoad(); prjLoad(); }
}, 20000);

/* ---------- context ---------- */
let C = null, ctxTimer;
const ctxTone = pct => pct != null && pct >= 60 ? "warn" : "";   // context running out needs the owner: orange, never red (owner 2026-10-28)
function compactState(c) {
  if (!c || !c.state) return null;
  const t = c.at ? kstTime(c.at) : "";
  if (c.state === "queued") return { tone: "pri", text: "압축 대기" };
  if (c.state === "compacting") return { tone: "pri", text: `압축 중 · ${t}` };
  if (c.state === "done") return { tone: "ok", text: `압축 완료 ${t}${c.tokensBefore ? ` · ${num(c.tokensBefore)} 토큰 전` : ""}` };
  return { tone: "err", text: `압축 실패 ${t}${c.error ? ` · ${c.error}` : ""}` };
}
function ctxBar(p) {
  const pct = p.percent;
  return el("div", {},
    el("div", { class: `bar ${ctxTone(pct)}`, role: "progressbar", "aria-label": `${p.name} 컨텍스트`, "aria-valuenow": Math.round(pct || 0), "aria-valuemin": 0, "aria-valuemax": 100 }, el("i", { style: `width:${Math.min(100, pct || 0).toFixed(1)}%` })),
    el("div", { class: "kv", style: "margin-top:var(--sp-1)" }, el("span", { class: "v", text: p.window ? `${num(p.tokens)} / ${num(p.window)} 토큰` : `${num(p.tokens)} 토큰` }), el("span", { class: "v", text: pct != null ? `${pct}%` : "–" })));
}
async function loadContext(quiet) {
  clearTimeout(ctxTimer);
  try { C = await api("/api/context"); }
  catch (e) { if (!quiet && current === "context") clear($("#context")).append(emptyNode("컨텍스트를 불러오지 못했어요")); return; }
  if (current === "context") { renderContext(); ctxTimer = setTimeout(() => loadContext(true), 4000); }
  if (current === "home") renderHome();
}
// "<model>:<thinking>" selector -> readable "model · thinking".
function selLabel(sel) {
  const i = sel.lastIndexOf(":"), level = sel.slice(i + 1);
  return i > 0 && ((M && M.thinking_levels) || []).includes(level) ? `${modelName(sel.slice(0, i))} · ${thinkKo(level)}` : modelName(sel);
}
function renderContext() {
  const box = $("#context");
  if (!C) { clear(box).append(emptyNode("불러오는 중…")); return; }
  const list = el("div", { class: "col" }), offList = el("div", { class: "list" });
  // Exited lanes leave this list at once, like the lanes board; the orchestrator always stays.
  // Then each conversation with its own session, by the same row; a parked one shows its last figure.
  const convRows = (C.conversations || []).map(x => ({ ...x, name: targetName(x.key) }));
  for (const p of [...C.processes.filter(x => x.kind !== "lane" || laneAlive(x)), ...convRows]) {
    const cs = compactState(p.compaction);
    const inFlight = p.compaction && (p.compaction.state === "queued" || p.compaction.state === "compacting");
    const btn = el("button", { class: "btn tonal sm", type: "button", disabled: !p.running || inFlight, onclick: ev => busy(ev.currentTarget, async () => {
      const r = await api("/api/compact", "POST", { target: p.key || p.name });
      toast(r.state === "queued" ? `${p.name}: 작업 중이라 끝나면 압축해요` : `${p.name}: 압축을 시작했어요`);
      loadContext(true);
    }) }, "압축");
    // A waiting session whose process is off (it starts again on its next message) keeps 대기 like every other screen, and says why it has no numbers.
    const off = !p.running && (p.status === "idle" || !!p.key);
    const t = p.key || (p.kind === "lane" ? `lane:${p.name}` : MAIN), [word, tone] = runStatus(t, off ? "idle" : p.status, targetInfo(t).ask);
    // A session that is not running is one plain list row (its display name, 꺼짐 said once at the right); only a running one keeps a card.
    if (!p.running) {
      offList.append(el("div", { class: "li", "data-cx-off": "1" }, el("span", { class: "tx" }, el("div", { class: "hd", text: p.kind === "orchestrator" ? botName : targetName(t) }), cs ? el("div", { class: "sup", text: cs.text }) : null),
        liEnd(el("span", { class: "cx-state" }, el("span", { class: "dot", "aria-hidden": "true" }), "꺼짐"))));
      continue;
    }
    list.append(el("div", { class: "card" },
      el("div", { class: "heads" }, el("span", { class: `dot ${tone}` }), el("span", { class: "t", text: p.kind === "orchestrator" ? botName : p.name }), el("span", { class: "sp" }), word === statusKo("") ? null : el("span", { class: `tag ${tone}`, text: word })),   // a state nobody knows is left out, not named 알 수 없음
      p.model ? el("div", { class: "sup sub", text: selLabel(p.model) }) : null,
      p.running || (p.key && p.tokens > 0) ? el("div", { class: "mt8" }, ctxBar(p)) : null,
      p.running ? null : el("div", { class: "sup mt8", text: off ? "꺼져 있어요. 다음 메시지가 오면 다시 시작해요" : "실행 중이 아니에요" }),
      el("div", { class: "row mt12", style: "justify-content:space-between" }, cs ? el("span", { class: `tag ${cs.tone}`, text: cs.text }) : el("span"), btn)));
  }
  clear(box).append(list, ...(offList.firstChild ? [offList] : []), ...ctxModels());
}
/* Per-model context window and auto-compaction point (PUT /api/context/model, stored in config context.models). */
const ctxUser = n => n === "orchestrator" ? botName : n === "lanes" ? "새 세션 기본" : n;
// "300000", "300,000", "300k", "1.5m" -> tokens; "80%" -> that share of `window`. "" -> null (default). NaN when unreadable.
function ctxParse(v, window) {
  const s = String(v || "").replace(/[\s,_]/g, "").toLowerCase();
  if (!s) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)(%|k|m)?$/);
  if (!m) return NaN;
  const n = Number(m[1]);
  if (m[2] === "%") return window ? Math.round(window * n / 100) : NaN;
  return Math.round(m[2] === "k" ? n * 1e3 : m[2] === "m" ? n * 1e6 : n);
}
function ctxModels() {
  const list = (C && C.models) || [];
  if (!list.length) return [];
  return [el("div", { class: "sec mt12", text: "모델별 컨텍스트 설정" }), el("div", { class: "col" }, ...list.map(m => {
    const win = m.window || m.window_default, at = m.compact_at || m.compact_at_default;
    const pct = win ? ` (${Math.round(at / win * 100)}%)` : "";
    return el("div", { class: "card ctx-model" },
      el("div", { class: "ch" }, el("h3", { text: modelName(m.model) }), el("button", { class: "btn text inrow", type: "button", onclick: () => ctxDialog(m) }, "설정")),
      el("div", { class: "kv" }, el("span", { class: "k", text: "컨텍스트 크기" }), el("span", { class: "v", text: win ? `${num(win)} 토큰${m.window ? " · 직접 설정" : " · 기본"}` : "아직 모름 (처음 응답 뒤 표시)" })),
      el("div", { class: "kv" }, el("span", { class: "k", text: "자동 압축" }), el("span", { class: "v", text: `${num(at)} 토큰${pct}${m.compact_at ? " · 직접 설정" : " · 기본"}` })),
      el("div", { class: "sup", text: `사용: ${m.used_by.map(ctxUser).join(", ")}` }));
  }))];
}
function ctxDialog(m) {
  const L = C.limits || {};
  const win = input({ type: "text", inputmode: "numeric", value: m.window ? String(m.window) : "", placeholder: m.window_default ? `기본 ${num(m.window_default)}` : "기본값" });
  const at = input({ type: "text", inputmode: "numeric", value: m.compact_at ? String(m.compact_at) : "", placeholder: `기본 ${num(m.compact_at_default)}` });
  const err = el("p", { class: "sup err-t", role: "alert" });
  const save = (c, btn, body, msg) => busy(btn, async () => {
    try { C = await api("/api/context/model", "PUT", { model: m.model, ...body }); }
    catch (e) { err.textContent = e.message; return; }
    c(); toast(msg); renderContext();
  });
  const actions = [{ label: "취소", onclick: c => c() }];
  if (m.window || m.compact_at) actions.push({ label: "기본값으로", onclick: (c, btn) => save(c, btn, { window: null, compact_at: null }, "기본값으로 되돌렸어요") });
  actions.push({ label: "저장", kind: "pri", onclick: (c, btn) => {
    const w = ctxParse(win.value, null);
    const a = ctxParse(at.value, w || m.window_default);
    if (Number.isNaN(w)) { err.textContent = "컨텍스트 크기는 토큰 수로 적어 주세요 (예: 1000000, 200k)"; return; }
    if (Number.isNaN(a)) { err.textContent = "자동 압축 시점은 토큰 수나 %로 적어 주세요 (예: 300k, 80%). %는 컨텍스트 크기를 알 때만 써요"; return; }
    return save(c, btn, { window: w, compact_at: a }, "저장했어요. 다음 턴부터 적용돼요");
  } });
  dialog({
    classic: true,
    title: `${modelName(m.model)} 컨텍스트`,
    body: el("div", { class: "col" },
      el("p", { class: "sup", text: `이 모델을 쓰는 모든 세션(${m.used_by.map(ctxUser).join(", ")})에 적용돼요.` }),
      textField("컨텍스트 크기 (토큰)", win),
      el("p", { class: "sup", text: L.window ? `${num(L.window.min)}~${num(L.window.max)} 토큰` : "" }),
      textField("자동 압축 시작 (토큰 또는 %)", at),
      el("p", { class: "sup", text: `${L.compact_at ? num(L.compact_at.min) : ""} 토큰 이상, 컨텍스트 크기보다 작게. 낮게 할수록 매 턴 다시 읽는 토큰과 비용이 줄어요.` }),
      el("p", { class: "sup", text: L.applies || "" }),
      err),
    actions,
  });
}
