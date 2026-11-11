/* ---------- 알림 화면 (#notices): the bell opens it, it is its own screen (prototype site/prototype/s-notices.js) ---------- */
// Three groups of one row shape: 처리할 것 (an answer, a failure or a lost login that still waits), 새 소식 (unread) and 지난 알림. The filter only hides
// rows. Unread changes by a tap on a row, the x and 모두 읽음, never by looking (the old ntSeen is gone). Data: NT.items (30-notices.js); API:
// POST /api/notices/read {ids}, /:id/handled, /:id/dismiss, /:id/undismiss. State NSC lives in 04-state.js (go() needs it before this file runs).
const NSC_FILTERS = [["all", "전체"], ["ask", "답변 필요"], ["result", "결과"], ["news", "새 소식"], ["alert", "경고"]];
const NSC_GROUPS = [["need", "처리할 것"], ["news", "새 소식"], ["past", "지난 알림"]];
const NSC_PAGE = 50;   // 새 소식 / 지난 알림 rows drawn at a time (NSC.lim starts at the same 50, 04-state.js)
const NSC_X = { need: "처리했어요", news: "읽음으로 표시", past: "지우기" };

// The list: a notice with an id that is neither a quiet watch check (log) nor a chat message (conv). Every count is this list's unread.
const nscListed = n => !!n.id && n.cls !== "log" && n.cls !== "conv" && !n.dismissed;
const nscIn = k => NT.items.filter(n => nscListed(n) && (k === "all" || n.cls === k));
const nscUnreadIn = k => NT.items.reduce((c, n) => c + (nscListed(n) && !n.read && (k === "all" || n.cls === k) ? 1 : 0), 0);
const nscGroup = n => (ntNeeds(n) || n.waits ? "need" : n.read ? "past" : "news");
const nscReadable = () => nscIn(NSC.f).filter(n => !n.read && !ntNeeds(n));
const nscTone = n => ntNeeds(n) || n.waits === "login" || n.tone === "warn" ? "warn" : n.tone === "fail" ? "err" : n.tone === "done" || n.cls === "result" ? "ok" : "";
// The tag word of the prototype's D.notices, from the notice's own kind, tone and app: the app is the integration key (mail, kakao, instagram/youtube/site = 댓글)
// or the prefix of the conversation it lives in. A word the data does not give is not made up: the rest is 감시 / 경고 / the app's name / 새 소식.
const NSC_APP_TAG = { mail: "메일", kakao: "카카오톡", instagram: "댓글", youtube: "댓글", site: "댓글" };
const nscApp = n => String(n.app || (n.item && n.item.app) || n.src || n.open || "").split(/[-:]/)[0];
function nscTag(n) {
  const app = nscApp(n);
  if (ntIsDec(n)) return n.decision.draft ? (app === "kakao" ? "카카오톡" : "답장 대기") : "결정";
  if (n.waits === "login") return "로그인";
  if (n.waits === "fail" || n.tone === "fail") return "실패";
  if (n.tone === "ask") return "질문";
  if (n.cls === "result") return n.tone === "done" ? "작업 완료" : "결과";
  if (n.kind === "watch" && nwChangeLine(n.text)) return "가격 변경";
  if (NSC_APP_TAG[app]) return NSC_APP_TAG[app];
  if (n.kind === "watch" && n.title === "예약") return "일정";
  if (/아침/.test(n.title || "")) return "아침 점검";
  if (n.kind === "watch") return "감시";
  if (n.cls === "alert" && /^[^\n]*: 다시 정상이에요/.test(n.text || "")) return "복구";
  if (n.cls === "alert") return "경고";
  return ntPlain(n.app || "") || "새 소식";
}
// A decision's second line follows its state: waiting says so, an answer says what was chosen, the rest say how it ended (the words of monDecisionNode).
function nscDecLine(n) {
  const d = n.decision, ctx = ntDecCtx(n);
  if (d.state === "open") return `${ctx} · 답을 기다리고 있어요`;
  if (d.state === "ignored") return `${ctx} · 무시했어요`;
  if (d.expired) return `${ctx} · 기한 지남`;
  if (d.resolved) return `${ctx} · 답 없이 끝났어요`;
  const m = /^\s*(\d+)\)/.exec(String(d.answer || "")), o = m && (d.options || []).find(x => x.n === Number(m[1]));
  return `${ctx} · 답했어요${o ? ` · ${o.label}` : ""}`;
}
// The second line: a price change as the old value struck and the new one bold, else the first line of the text that is not the title, else the place.
function nscSummary(n, text = n.text) {
  const chg = NW_CHANGE.exec(nwChangeLine(text));
  if (chg) return el("span", {}, el("s", { text: chg[2] }), " → ", chg[3]);
  if (n.decision) return n.decision.draft ? ntPlain(n.decision.draft.body.split("\n").find(l => l.trim()) || "") : nscDecLine(n);
  if (n.kind === "watch" && n.item) return (n.item.card && n.item.card.subject) || ntPlain(hcLine(n));   // a mail report says the mail
  const title = ntPlain(hcLine(n)), src = n.src || n.open;
  // the feed's own summary: the name is not said twice, nor the title when the summary opens with it
  if (n.kind === "watch") { const s = monSummary({ ...n, text }, []); return typeof s === "string" && title && s.startsWith(title) ? s.slice(title.length).replace(/^[.\s·]+/, "") || s : s; }
  return String(text || "").split("\n").map(ntPlain).find(l => l && l !== title) || ntLaneNote(n) || (src ? pcTargetName(src, n.pc) : "알림");
}
// The time at the row's end stays short: 방금, the hour today, 어제, then the date.
function nscWhen(t) {
  if (Date.now() - Date.parse(t) < 60000) return "방금";
  if (kstDay(t) === kstDay(Date.now())) return kstHM(t);
  return kstDay(t) === kstDay(Date.now() - 86400000) ? "어제" : dayLabel(t).replace(/ \(.\)$/, "");
}
function nscLines(n, group, summary, when, tag, prefix = "") {
  return [el("span", { class: "ln" }, el("span", { class: "hd", title: ntPlain(hcLine(n)), text: ntPlain(hcLine(n)) }), el("span", { class: "t", text: when })),
    el("span", { class: "ln" }, el("span", { class: "nsc-s" }, prefix, summary), el("span", { class: "tag", text: tag }))];
}
function nscRow(n, group) {
  const tone = group === "past" ? "" : nscTone(n), rep = n.repeats && n.repeats.length ? n.repeats : null, open = rep && NSC.open.has(n.id);
  // One cell at the end; a repeated failure or past notice keeps its ✕ beside the fold, or it could not be handled or cleared.
  const fold = rep ? el("button", { class: "ib nsc-fold", type: "button", "aria-expanded": String(!!open), "aria-label": "반복 알림 펼치기", onclick: ev => { ev.stopPropagation(); nscFold(n); } }, icon("chev")) : null;
  const end = group === "need" && n.waits !== "fail" ? (fold || el("span", { class: "nsc-tr", "aria-hidden": "true" }, icon("chev")))
    : fold && group === "news" ? fold
    : el("button", { class: "ib nsc-x", type: "button", "aria-label": NSC_X[group], title: NSC_X[group], onclick: ev => { ev.stopPropagation(); nscX(n, group); } }, icon("close"));
  return el("div", { class: `li nsc-r${n.read ? "" : " unread"}`, "data-nid": n.id },
    el("span", { class: "lead" }, el("span", { class: `dot ${tone}` })),
    el("button", { class: "tx nsc-tx", type: "button", onclick: () => nscTap(n) }, ...nscLines(n, group, nscSummary(n), nscWhen(n.updated || n.ts), nscTag(n), rep ? `${rep.length + 1}번 · ` : "")),
    end === fold ? null : fold, end);
}
// An older occurrence folded into the head row: the same title, its own time and text; a tap opens the head's notice.
const nscChild = (n, r) => el("div", { class: "li nsc-r", "data-nid": n.id, "data-child": "1" },
  el("span", { class: "lead" }, el("span", { class: "dot" })),
  el("button", { class: "tx nsc-tx", type: "button", onclick: () => nscTap(n) }, ...nscLines(n, "past", nscSummary(n, r.text), nscWhen(r.at), nscTag(n))),
  el("span", { class: "nsc-tr", "aria-hidden": "true" }, icon("chev")));
const nscRows = (n, group) => [nscRow(n, group), ...(n.repeats && n.repeats.length && NSC.open.has(n.id) ? n.repeats.map(r => nscChild(n, r)) : [])];

function nscList(rows) {
  if (!NT.loaded) return [el("div", { class: "list" }, el("div", { class: "empty", text: NT.failed ? "알림을 불러오지 못했어요" : "불러오는 중이에요" }))];
  if (!rows.length) return [el("div", { class: "list" }, el("div", { class: "empty", text: "새 알림이 없어요" }))];
  const out = [];
  for (const [g, label] of NSC_GROUPS) {
    const all = rows.filter(n => nscGroup(n) === g);
    if (!all.length) continue;
    const shown = g === "need" ? all : all.slice(0, NSC.lim[g]);   // 새 소식 and 지난 알림 draw 50 at a time: 300 rows are never all in the page
    const more = all.length > shown.length ? moreRow(`${all.length - shown.length}개 더 보기`, () => { NSC.lim[g] += NSC_PAGE; nscPaint(true); }) : null;
    out.push(el("div", { class: "sec", text: label }), el("div", { class: "list", "data-g": g }, ...shown.flatMap(n => nscRows(n, g)), more));
  }
  return out;
}

let nscBox = null;
function nscInit() {
  if (nscBox) return;
  const v = $("#v-notices");
  nscBox = {
    tabs: segKeep(el("div", { class: "nsc-f", role: "tablist", "aria-label": "알림 종류" }, ...NSC_FILTERS.map(([k, l]) =>
      el("button", { class: "nsc-fb", type: "button", role: "tab", "data-f": k, onclick: () => nscFilter(k) }, l, el("span", { class: "n", "data-n": k }))))),
    all: el("button", { class: "btn text sm", type: "button", "data-k": "read-all", hidden: true, text: "모두 읽음", onclick: ev => nscReadAll(ev.currentTarget) }),
    list: el("div", { class: "nsc-l" }),
  };
  nscBox.meta = el("div", { class: "nsc-m" }, el("span", { class: "sp" }), nscBox.all);
  v.append(nscBox.tabs, nscBox.meta, nscBox.list);
}
// One paint per frame at most, and only when what it shows changed (ntPaint calls nscSchedule on every notice change).
function nscPaint(force) {
  if (current !== "notices") return;
  nscInit();
  const rows = nscIn(NSC.f).sort((a, b) => ntAt(b) - ntAt(a)), readable = nscReadable().length;
  for (const b of nscBox.tabs.children) {
    const on = b.dataset.f === NSC.f, c = NT.loaded ? nscUnreadIn(b.dataset.f) : 0, el0 = b.lastChild;
    b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on));
    if (el0.dataset.c !== String(c)) { el0.dataset.c = String(c); rollCount(el0, c ? String(c) : ""); }
  }
  nscBox.meta.hidden = !(NT.loaded && readable);   // the unread count is the tabs' own; this row is only 모두 읽음
  nscBox.all.hidden = !readable;
  const sig = JSON.stringify([NSC.f, NT.loaded, NT.failed, NSC.lim, [...NSC.open], rows.map(n => [n.id, n.read ? 1 : 0, n.tone, n.updated || n.ts, n.waits || "", n.decision ? n.decision.state : "", (n.repeats || []).length])]);
  if (!force && sig === NSC.sig) return;
  NSC.sig = sig;
  const first = !nscBox.list.firstChild, fresh = NT.loaded ? freshKeys(NSC.seen, rows.map(n => n.id)) : new Set();
  const anchor = force || first ? null : rowAnchor(nscBox.list, ".nsc-r:not([data-child])", "nid", $("#views"));   // a live update leaves the reader's place alone
  nscBox.list.replaceChildren(...nscList(rows));
  rowHold(anchor);
  if (!first) for (const id of fresh) { const r = nscRowOf(id); if (r) motionIn(r, "top"); }   // a notification that arrives slides in at the top of its group
}
const nscRowOf = id => nscBox && nscBox.list.querySelector(`.nsc-r[data-nid="${CSS.escape(String(id))}"]:not([data-child])`);
function nscSchedule() { if (!NSC.raf) NSC.raf = requestAnimationFrame(() => { NSC.raf = 0; nscPaint(false); }); }
function nscOpen() {
  nscInit();
  const keep = NSC.keep;
  NSC.keep = false;
  if (!keep) {   // opened from the bell, the palette or the address: every filter shows, nothing is unfolded
    NSC.f = "all"; NSC.open.clear(); NSC.lim = { news: NSC_PAGE, past: NSC_PAGE }; NSC.seen.clear(); NSC.seen.seeded = false;
  }
  nscPaint(true);
  if (keep) $("#views").scrollTop = NSC.scroll;   // back from a row: the filter and the place in the list stay
  if (!noticesFresh()) loadNotices();
}
// The bell and the 홈 card: a fresh opening (전체, top).
function nscGo() { NSC.keep = false; go("notices"); }
function nscBack() {
  if (!NSC.ret || current === "notices" || current === "home") return false;
  NSC.keep = true; go("notices");
  return true;
}

function nscFilter(k) {
  if (k === NSC.f) return;
  motionSwap(nscBox.list, () => { NSC.f = k; NSC.lim = { news: NSC_PAGE, past: NSC_PAGE }; NSC.seen.clear(); NSC.seen.seeded = false; NSC.sig = ""; nscPaint(true); });
}
function nscFold(n) {
  const open = NSC.open.has(n.id), row = nscRowOf(n.id);
  if (open) NSC.open.delete(n.id); else NSC.open.add(n.id);
  const btn = row && row.querySelector(".nsc-fold");
  if (btn) btn.setAttribute("aria-expanded", String(!open));
  if (!row) return;
  if (open) {
    const kids = [...nscBox.list.querySelectorAll(`.nsc-r[data-nid="${CSS.escape(String(n.id))}"][data-child]`)];
    Promise.all(kids.map(k => motionOut(k))).then(() => { kids.forEach(k => k.remove()); NSC.sig = ""; nscSchedule(); });
    return;
  }
  const kids = n.repeats.map(r => nscChild(n, r));
  row.after(...kids);
  kids.forEach(k => motionIn(k, "top"));
  NSC.sig = "";
}

// A tap on a row: what waits on an answer opens its sheet over this screen; anything else opens where it leads, and the way back comes here.
// A tap reads a row that needs no answer; a question stays unread until it is answered.
function nscTap(n) {
  const a = noticeKindAction(n);
  if (a === "sheet") { const d = ntLinkedDec(n) || n; noticeSheetOpen(n.pc ? n : d.id); return; }
  if (a === "ask") { ntAskSheet(n).then(shown => { if (!shown) nscNav(n); }); return; }
  if (a === "detail") { ntRead(n); ntDetailOpen(n); return; }
  ntRead(n);
  nscNav(n);
}
function nscNav(n) {
  NSC.keep = true; NSC.scroll = $("#views").scrollTop; NSC.arm = Date.now() + 5000;
  noticeOpen(n);
}

// Rows leave (motionOut) and then change group; the one that stays comes in at the top of its new group.
async function nscLeave(n, change) {
  if (NSC.busy.has(n.id)) return;
  NSC.busy.add(n.id);
  const rows = [...nscBox.list.querySelectorAll(`.nsc-r[data-nid="${CSS.escape(String(n.id))}"]`)];
  await Promise.all(rows.map(r => motionOut(r)));
  try { await change(); } finally { NSC.busy.delete(n.id); }
  nscPaint(true);
  const row = nscRowOf(n.id);
  if (row) motionIn(row, "top");
}
function nscX(n, group) {
  if (group === "news") return nscLeave(n, () => ntRead(n));
  if (group === "need") return nscLeave(n, () => nscHandled(n));
  return nscLeave(n, () => nscDismiss(n));
}
// ✕ on a failure: "확인했어요". It leaves 처리할 것 and stays as a past notice.
async function nscHandled(n) {
  const was = { read: n.read, waits: n.waits, handled: n.handled, unread: NT.unread };
  n.read = true; n.waits = undefined; n.handled = new Date().toISOString();
  if (!was.read) NT.unread = Math.max(0, NT.unread - 1);
  ntPaint(); homeSoon();
  try { const r = await api(`/api/notices/${enc(n.id)}/handled`, "POST", {}); ntApply(r.item, r.unread); }
  catch (err) { Object.assign(n, { read: was.read, waits: was.waits, handled: was.handled }); NT.unread = was.unread; ntPaint(); homeSoon(); toast(err.message, true); }
}
// ✕ on a past notice: gone from every list and count, and the toast takes it back.
async function nscDismiss(n) {
  const at = NT.items.indexOf(n);
  NT.items = NT.items.filter(x => x.id !== n.id); NT.mut++;
  if (n.at) NT.gone.add(n.at);
  ntPaint(); homeSoon();
  try {
    const r = await api(`/api/notices/${enc(n.id)}/dismiss`, "POST", {});
    if (!r || !r.ok) throw new Error("지우지 못했어요");
    if (typeof r.unread === "number") { NT.unread = r.unread; ntPaint(); }
    toast("알림을 지웠어요", false, { label: "되돌리기", onclick: () => nscUndo(n) }, 6000);
  } catch (err) {
    NT.items.splice(Math.max(0, at), 0, n); NT.mut++; if (n.at) NT.gone.delete(n.at);
    ntPaint(); homeSoon(); toast(err.message, true);
  }
}
async function nscUndo(n) {
  try {
    const r = await api(`/api/notices/${enc(n.id)}/undismiss`, "POST", {});
    NT.mut++; if (n.at) NT.gone.delete(n.at);
    ntApply(r.item, r.unread);
    if (current === "notices") requestAnimationFrame(() => requestAnimationFrame(() => { const row = nscRowOf(n.id); if (row) motionIn(row, "top"); }));
  } catch (err) { toast(err.message, true); }
}
// 모두 읽음: only what this filter shows, and a question that waits keeps its unread (the toast says so). Only /api/notices/read is called.
async function nscReadAll(btn) {
  const rows = nscReadable(), kept = nscIn(NSC.f).some(ntNeeds), ids = rows.map(n => n.id);
  if (!ids.length) return;
  btn.disabled = true;
  const gone = new Set(ids);
  await Promise.all([...nscBox.list.querySelectorAll(".nsc-r[data-nid]")].filter(r => gone.has(Number(r.dataset.nid)) || gone.has(r.dataset.nid)).map(r => motionOut(r)));
  for (const n of rows) n.read = true;
  NT.unread = Math.max(0, NT.unread - ids.length);
  ntPaint(); homeSoon(); nscPaint(true);
  btn.disabled = false;
  await ntMarkRead({ ids });
  if (kept) toast("답이 필요한 알림은 그대로 뒀어요");
}
