/* ---------- the mailbox of the mail app: read / unread, star, 완료(보관), 삭제 on one mail or a selection, the floating 메일 쓰기 and the inline reply ---------- */
// The page asks the hub, never the mail account: POST /api/mail/<key>/action {action} -> {ok, synced, note?} for one mail and POST /api/mail/actions {keys, action}
// -> {ok, results:[{key, ok, synced, note?}]} for a selection (action = read | unread | archive | unarchive | trash | star | unstar). Every action is optimistic:
// the row changes at once and goes back when the hub says ok:false (or cannot be reached); the hub's note is told once.
// A mail card says what its mailbox can do in `can` (GET /api/conversations items[].mail); an action it does not list still works here. `trashOriginal`: 삭제 takes the
// original too (the app's 삭제하면 원본도 삭제 is on and the source can): POST /api/mail/delete-original, hub/mail-delete.ts.
// A card with no `can` at all (a hub that does not know the field) can only be deleted, through the old DELETE /api/mail/<key>.
// Nothing here sends a mail: 메일 쓰기 and the inline reply save a draft (POST /api/mail/compose) and the owner's 보내기 stays on its approval card.
ICONS.star = "M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z";
ICONS.archive = "M4 6.5h16V10H4zM5.5 10v8a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-8M10 13.5h4";
ICONS.minus = "M6 12h12";
ICONS.inbox = "M4 13l2.2-7h11.6L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 13h4.5l1 2h5l1-2H20";
ICONS.forward = "M15 7l5 5-5 5M20 12h-9a7 7 0 0 0-7 7";
ICONS.replyall = "M8 7l-5 5 5 5M13 7l-5 5 5 5M8 12h5a8 8 0 0 1 8 7";
ICONS.mailopen = "M3 10l9-6 9 6v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM3 10l9 6 9-6";
ICONS.replyoff = "M10 7l-5 5 5 5M5 12h9a6 6 0 0 1 6 6M4 4l16 16";
ICONS.flag = "M6 21V4h12l-2.5 4 2.5 4H6";
const MBOX = { sel: new Set(), vis: [], boxes: new Map(), cs: null, drawn: 100, fk: "", rows: new Map(), pass: new Set() };
const mbKey = t => t.slice(5);
// Whether the mail's mailbox will follow an action. Every action still works in dotz either way: `can` only says what the hub can repeat in the
// real mailbox (owner 2026-11-02: read/unread must always be there). A card with no `can` at all is an older hub, which knows only the delete route.
const mailCan = (t, a) => { const m = MAILS.get(t); return !!m && Array.isArray(m.can) && m.can.includes(a); };
const mailOldHub = t => { const m = MAILS.get(t); return !!m && !Array.isArray(m.can); };
// Unread: the hub's read flag when the card has one (the real mailbox's, two-way); else dotz's own read position (ts(t).unread). A sent mail is never unread.
const mailUnread = (t, m = MAILS.get(t)) => !!m && m.dir !== "out" && (typeof m.read === "boolean" ? !m.read : (ts(t).unread | 0) > 0);
const mbRefresh = () => { MON.sig = ""; MON.side = ""; monSchedule(); mbPaintBar(); };

/* ---------- what moves, and why (web/DESIGN.md Motion) ---------- */
// A count badge that was drawn again (a list row, a tab) keeps what it last said, so only the digit that changed rolls (rollCount, 01-motion.js).
// A count of 0 draws no badge at all and forgets, so it appears whole the next time. `key` names the one badge; `attrs` go on the span.
const CNT_LAST = new Map();
function cntSpan(key, cls, n, attrs = {}) {
  if (!n) { CNT_LAST.delete(key); return null; }
  const now = n > 99 ? "99+" : String(n), was = CNT_LAST.get(key);
  CNT_LAST.set(key, now);
  const sp = el("span", { class: cls, ...attrs, text: was && was !== now ? was : now });
  rollCount(sp, now);
  return sp;
}
// A mail that arrived since the list was last drawn slides in at the top; the first draw of a list, another folder and a plain redraw move nothing.
const MBOX_SEEN = new Set();
const mbSeenReset = () => { MBOX_SEEN.clear(); MBOX_SEEN.seeded = false; MBOX_SEEN.scope = ""; };
function mbFresh(scope, box) {
  if (scope !== MBOX_SEEN.scope) { mbSeenReset(); MBOX_SEEN.scope = scope; }
  const rows = [...box.querySelectorAll(":scope > .mr[data-t]")];
  if (!NT.loaded || !rows.length) return;
  const fresh = freshKeys(MBOX_SEEN, rows.map(r => r.dataset.t));
  for (const r of rows) if (fresh.has(r.dataset.t)) motionIn(r, "top");
}
// Rows an action takes out of the list (done, deleted, no longer unread in 안 읽음) leave first; the list is drawn again without them after.
function mbRowsOut(keys) {
  const keep = mailFilterOf()[2], gone = keys.filter(t => !MAILS.has(t) || !keep(MAILS.get(t), t));
  const rows = [...document.querySelectorAll("#mon-tl > .mr[data-t]")].filter(r => gone.includes(r.dataset.t));
  for (const r of rows) MBOX.rows.delete(r.dataset.t);   // a row that fades out is not kept
  return rows.length ? Promise.all(rows.map(r => motionOut(r))) : null;
}

// The change an action makes to the page's copy of the mail; the returned function puts it back.
function mbApply(t, a) {
  const m = MAILS.get(t);
  if (!m) return () => {};
  const was = { read: m.read, archived: m.archived, starred: m.starred }, unread = ts(t).unread, conv = CONV.get(t);
  if (a === "read") { m.read = true; ts(t).unread = 0; }
  else if (a === "unread") m.read = false;
  else if (a === "archive" || a === "unarchive") m.archived = a === "archive";
  else if (a === "star" || a === "unstar") m.starred = a === "star";
  else if (a === "trash") { MAILS.delete(t); CONV.delete(t); MBOX.sel.delete(t); }
  return () => { Object.assign(m, was); ts(t).unread = unread; if (a === "trash") { MAILS.set(t, m); if (conv) CONV.set(t, conv); } };
}
const MB_DONE = { read: "읽음으로 표시했어요", unread: "안 읽음으로 표시했어요", archive: "보관했어요", unarchive: "받은편지함으로 옮겼어요", trash: "삭제했어요", star: "별표를 달았어요", unstar: "별표를 뺐어요" };
const MB_BACK = { archive: "unarchive", unarchive: "archive", read: "unread", unread: "read", star: "unstar", unstar: "star" };
// Runs one action on `keys` (mail targets). Resolves the keys that went through.
async function mbRun(keys, action, quiet = false) {
  keys = keys.filter(t => MAILS.has(t));
  if (!keys.length) return [];
  // An older hub (no `can` on the card) has no action route: there only 삭제 works, through the old DELETE.
  const legacy = action === "trash" && keys.some(mailOldHub);
  const todo = legacy ? keys : keys.filter(t => !mailOldHub(t));
  if (!todo.length) return [];
  const undo = new Map(todo.map(t => [t, mbApply(t, action)]));
  const leaving = mbRowsOut(todo);
  if (leaving) leaving.then(mbRefresh); else mbRefresh();
  let res;
  try {
    if (legacy) { res = []; for (const t of todo) { await api(`/api/mail/${mbKey(t)}`, "DELETE"); res.push({ key: t, ok: true, synced: false }); } }
    else if (todo.length === 1) { const r = await api(`/api/mail/${mbKey(todo[0])}/action`, "POST", { action }); res = [{ ...r, key: todo[0] }]; }
    else {
      const r = await api("/api/mail/actions", "POST", { keys: todo.map(mbKey), action });
      const by = new Map((r && r.results || []).map(x => [String(x.key).startsWith("mail:") ? x.key : `mail:${x.key}`, x]));
      res = todo.map(t => by.get(t) || { key: t, ok: !!(r && r.ok !== false) });
    }
  } catch (e) { res = todo.map(t => ({ key: t, ok: false, note: (e && e.data && e.data.error) || (e && /^HTTP 404/.test(e.message) ? "서버가 아직 이 작업을 지원하지 않아요" : (e && e.message) || "처리하지 못했어요") })); }
  const done = res.filter(x => x.ok !== false).map(x => x.key);
  for (const x of res) if (x.ok === false && undo.has(x.key)) undo.get(x.key)();
  mbRefresh();
  const said = (res.find(x => x.ok === false && x.note) || res.find(x => x.note) || {}).note;
  if (!quiet && said) toast(said, res.some(x => x.ok === false));
  else if (!quiet && res.some(x => x.ok === false)) toast("처리하지 못했어요", true);
  else if (!quiet && done.length && MB_DONE[action]) toast(`${done.length > 1 ? `${done.length}개를 ${MB_DONE[action]}` : MB_DONE[action]}`, false, MB_BACK[action] && action !== "trash" && !/star$/.test(action) ? { label: "되돌리기", onclick: () => mbRun(done, MB_BACK[action]) } : undefined);
  if (legacy) for (const t of done) PQ.of.delete(t);
  Promise.allSettled([convLoad(), loadIntegrations()]);
  return done;
}
// 삭제 with the app's 삭제하면 원본도 삭제 on: the confirm is his yes for the original (owner 11-05), and the mail leaves only when its source did it (hub/mail-delete.ts).
// A mail that failed stays in the list and the toast offers it again. A peer's mail is deleted on its own computer and goes on as before, in dotz only.
const mailOriginal = t => { const m = MAILS.get(t); return !!m && m.trashOriginal === true && !pqPc(t); };
async function mbTrashOriginal(keys, orig) {
  const n = keys.length, rest = keys.filter(t => !orig.includes(t));
  const what = n > 1 ? `메일 ${n}개를 삭제할까요? ${orig.length === n ? "원본" : `그중 ${orig.length}개는 원본`}도 메일함 휴지통으로 옮겨요. 휴지통에서 되살릴 수 있어요` : "이 메일을 삭제할까요? 원본도 메일함 휴지통으로 옮겨요. 휴지통에서 되살릴 수 있어요";
  if (!await ask("메일 삭제", what, n > 1 ? `${n}개 삭제` : "삭제", true)) return [];
  mbDeleting();
  let res;
  try { res = (await api("/api/mail/delete-original", "POST", { keys: orig.map(mbKey) })).results.map(x => ({ ...x, key: `mail:${x.key}` })); }
  catch (e) { const note = (e && e.data && e.data.error) || (e && e.message) || "원본을 지우지 못했어요"; res = orig.map(key => ({ key, ok: false, note })); }
  const done = res.filter(x => x.ok).map(x => x.key), bad = res.filter(x => !x.ok);
  for (const t of done) mbApply(t, "trash");
  const leaving = mbRowsOut(done);
  if (leaving) leaving.then(mbRefresh); else mbRefresh();
  mbPaintBar();
  mbLeave(done);
  const local = rest.length ? await mbRun(rest, "trash", true) : [];
  const gone = done.length + local.length;
  if (bad.length) toast(orig.length > 1 ? `${orig.length}개 중 ${bad.length}개는 지우지 못했어요 · ${bad[0].note}` : bad[0].note, true, { label: "다시 시도", onclick: () => mbTrash(bad.map(x => x.key)) });
  else toast(gone > 1 ? `${gone}개를 삭제했어요` : "삭제했어요");
  Promise.allSettled([convLoad(), loadIntegrations(), loadNotices()]);
  return [...done, ...local];
}
// 삭제 into the mailbox's trash can be undone: the mail leaves at once and 되돌리기 brings it back; the trash is sent when the toast's
// time is up or the page goes away (Gmail's way, owner 11-03). A mailbox that will not follow, or an older hub, only drops the row from
// dotz and cannot bring it back, so that asks first in the small confirm box.
const MB_UNDO_MS = 6000;
// The one sentence under both 삭제 confirms (a row's ⋯ and an open mail): dotz drops the mail from its list. One mail that its mailbox will not trash stays there, so the box says so plainly;
// of several, the ones a mailbox can trash go and the rest stay.
// The answer to a 삭제 confirm can take a moment (the mailbox is asked): say at once that it is going on; the toast of the result replaces this one.
const mbDeleting = () => toast("삭제하는 중이에요");
const mailStays = n => n > 1 ? "메일함에는 남아 있을 수 있어요." : "메일함에는 그대로 남아 있어요.";
async function mbTrash(keys) {
  keys = keys.filter(t => MAILS.has(t));
  if (!keys.length) return [];
  const orig = keys.filter(mailOriginal);
  if (orig.length) return mbTrashOriginal(keys, orig);
  if (!keys.every(t => mailCan(t, "trash"))) {
    if (!await ask("메일 삭제", `${keys.length > 1 ? `메일 ${keys.length}개를` : "이 메일을"} 목록에서 지워요. ${mailStays(keys.length)}`, "삭제", true)) return [];
    mbDeleting();
    const done = await mbRun(keys, "trash");
    mbLeave(keys);
    return done;
  }
  const back = keys.map(t => mbApply(t, "trash"));
  const leaving = mbRowsOut(keys);
  if (leaving) leaving.then(mbRefresh); else mbRefresh();
  mbPaintBar();
  mbLeave(keys);
  const undone = await new Promise(res => {
    const end = v => { clearTimeout(timer); removeEventListener("pagehide", send); res(v); };
    const send = () => end(false), timer = setTimeout(send, MB_UNDO_MS);
    addEventListener("pagehide", send);
    toast(keys.length > 1 ? `${keys.length}개를 삭제했어요` : "삭제했어요", false, { label: "되돌리기", onclick: () => end(true) }, MB_UNDO_MS);
  });
  for (const f of back) f();
  if (undone) { mbRefresh(); mbPaintBar(); return []; }
  const done = await mbRun(keys, "trash", true);
  if (done.length < keys.length) toast("처리하지 못했어요", true);
  return done;
}
// 답장 안 함 on a selection or on the whole 답장 필요 list: mailSetFyi for many mails, one POST /api/mail/fyi {keys, on} per computer (a peer's mails go to
// the computer that holds them). It stays in dotz: nothing is sent, the read state and the mailbox do not change. Only mails that owe a reply are marked, so
// 되돌리기 (on = false) brings each back to 답장 필요. More than MB_FYI_ASK mails ask first. The rows change at once and go back when the hub refuses them.
const MB_FYI_ASK = 5;
const mbOwed = keys => keys.filter(t => MAILS.has(t) && mailOwed(MAILS.get(t)));
async function mbFyi(keys, on = true) {
  keys = on ? mbOwed(keys) : keys.filter(t => MAILS.has(t));
  if (!keys.length) return [];
  if (on && keys.length > MB_FYI_ASK && !await ask("답장 안 함", `메일 ${keys.length}개를 답장 안 함으로 표시할까요? 메일을 보내지는 않아요`, `${keys.length}개 표시`)) return [];
  const was = new Map(keys.map(t => { const m = MAILS.get(t); return [t, { reply: m.reply, unreplied: m.unreplied }]; })), byPc = new Map();
  for (const t of keys) {
    Object.assign(MAILS.get(t), { reply: on ? "fyi" : "needs", unreplied: !on });
    MBOX.sel.delete(t);
    const pc = pqPc(t), k = pc ? pc.url : "";
    if (!byPc.has(k)) byPc.set(k, { pc, keys: [] });
    byPc.get(k).keys.push(t);
  }
  const leaving = mbRowsOut(keys);
  if (leaving) leaving.then(mbRefresh); else mbRefresh();
  const bad = new Set(), notes = await Promise.all([...byPc.values()].map(async g => {
    const body = { keys: g.keys.map(mbKey), on };
    try {
      const r = await (g.pc ? api(pqProxy(g.pc, "/api/peer/act"), "POST", { action: "fyi", args: body }) : api("/api/mail/fyi", "POST", body));
      for (const x of r.results) if (!x.ok) bad.add(`mail:${x.key}`);
    } catch (e) { g.keys.forEach(t => bad.add(t)); return e.message; }
  }));
  for (const t of bad) if (MAILS.has(t)) Object.assign(MAILS.get(t), was.get(t));
  const done = keys.filter(t => !bad.has(t));
  if (bad.size) mbRefresh();
  if (bad.size) toast(done.length ? `${keys.length}개 중 ${bad.size}개는 표시하지 못했어요` : notes.find(Boolean) || "표시하지 못했어요", true);
  else toast(`${done.length > 1 ? `${done.length}개를 ` : ""}${on ? "답장 안 함으로" : "답장 필요로"} 표시했어요`, false, on ? { label: "되돌리기", onclick: () => mbFyi(done, false) } : undefined);
  await Promise.allSettled([byPc.has("") ? convLoad() : null, byPc.size > (byPc.has("") ? 1 : 0) ? pqLoad() : null, loadIntegrations(), byPc.has("") ? loadNotices() : null]);
  return done;
}
// An action on the open mail takes the owner back to the list (like the mailbox does) when the mail left it.
const mbLeave = keys => { if (monCtx && keys.includes(monCtx) && current === "chat" && !MAILS.has(monCtx)) go("monitoring", MON.sel); };

/* ---------- the row: checkbox, star, the bold of an unread mail ---------- */
// `o.short`: the visible word when the full label (kept as aria-label and title) is longer than the button needs.
// `count` stays beside the icon on the phone, where the label is hidden.
const mbBtn = (label, ic, onclick, o = {}) => el("button", { class: `mbox-b${o.cls ? ` ${o.cls}` : ""}`, type: "button", "data-k": o.k, title: label, "aria-label": label, onclick }, icon(ic), el("span", { class: "mbox-bt", text: o.short || label }), o.count ? el("span", { text: ` ${o.count}` }) : null);
const MB_SHORT = { read: "읽음", unread: "안 읽음", archive: "보관", unarchive: "받은편지함" };
// Star: always a button (a star works in dotz whatever the mailbox does); the mailbox's refusal comes back as the hub's one line.
function mbStar(t) {
  const m = MAILS.get(t) || {}, on = !!m.starred;
  const mark = icon("star", on ? "on" : "");
  return el("button", { class: `mr-star${on ? " on" : ""}`, type: "button", "data-k": "mail-star", "aria-pressed": String(on), "aria-label": on ? "별표 빼기" : "별표 달기", title: on ? "별표 빼기" : "별표 달기",
    onclick: ev => { ev.stopPropagation(); mbRun([t], on ? "unstar" : "star", true).then(() => {}); }, onkeydown: ev => ev.stopPropagation() }, mark);
}
// The leading cells of a mail row's header: ☐ and ☆. Ticking a row repaints the bar only, never the list.
function mbLead(t, title) {
  const chk = el("input", { class: "mr-chk", type: "checkbox", "data-k": "mail-select", "aria-label": `${title} 선택`, checked: MBOX.sel.has(t),
    onclick: ev => ev.stopPropagation(), onkeydown: ev => ev.stopPropagation(), onchange: ev => { if (ev.target.checked) MBOX.sel.add(t); else MBOX.sel.delete(t); const row = ev.target.closest(".mr"); if (row) row.classList.toggle("mr-sel", ev.target.checked); mbPaintBar(); } });
  return el("span", { class: "mr-lead" }, chk, mbStar(t));
}

/* ---------- the bar above the list: select all, and the actions of the selection. One line of one height in every state, so ticking a mail moves nothing. ---------- */
const mbBar = () => el("div", { class: "mbox-bar", id: "mbox-bar" });
function mbPaintBar() {
  const bar = document.getElementById("mbox-bar");
  if (!bar) return;
  const keys = [...MBOX.sel].filter(t => MAILS.has(t)), all = MBOX.vis.length > 0 && MBOX.vis.every(t => MBOX.sel.has(t));
  const chk = el("input", { class: "mbox-all", type: "checkbox", "aria-label": "모두 선택", "data-k": "mail-select-all", checked: all, disabled: !MBOX.vis.length, onchange: ev => {
    if (ev.target.checked) MBOX.vis.forEach(t => MBOX.sel.add(t)); else MBOX.sel.clear();
    document.querySelectorAll("#mon-tl .mr .mr-chk").forEach(c => { c.checked = ev.target.checked; c.closest(".mr").classList.toggle("mr-sel", ev.target.checked); });
    mbPaintBar();
  } });
  chk.indeterminate = !all && keys.length > 0;
  if (!keys.length) {
    clear(bar).append(chk, el("span", { class: "mbox-n", text: MBOX.vis.length ? `메일 ${MBOX.vis.length}개` : "" }));
    bar.classList.remove("on");
    if (mailFilterOf()[0] === "owed" && MBOX.vis.length) bar.append(mbBtn("이 목록 전부 답장 안 함", "replyoff", () => mbFyi(MBOX.vis), { k: "mail-fyi-all" }));
    return;
  }
  const arch = mailFilterOf()[0] === "archived";
  // The two used most stand as words (읽음, 보관); the rest is in the ⋯, so 삭제 is never the button beside the × that clears the choice.
  const owed = mbOwed(keys).length, run = a => (a === "trash" ? mbTrash(keys) : mbRun(keys, a)).then(() => mbPaintBar());
  const btns = [["read", "읽음으로 표시", "check"], arch ? ["unarchive", "받은편지함으로", "inbox"] : ["archive", "완료(보관)", "archive"]].map(([a, label, ic]) => mbBtn(label, ic, () => run(a), { k: `mail-${a}`, short: MB_SHORT[a], cls: "mbox-w" }));
  const items = [{ value: "unread", label: "안 읽음으로 표시" }, ...(keys.some(mxCanMove) ? [{ value: "move", label: "메일함 옮기기" }] : []), ...(owed ? [{ value: "fyi", label: `답장 안 함${owed < keys.length ? ` ${owed}개` : ""}` }] : []), { value: "trash", label: "삭제", danger: true }];
  btns.push(el("button", { class: "mbox-b mbox-ic", type: "button", "data-k": "mail-more", title: "더 보기", "aria-label": "더 보기", "aria-haspopup": "listbox",
    onclick: ev => { const b = ev.currentTarget; showMenu(b, items, { onPick: v => (v === "move" ? mxMoveOpen(b, keys) : v === "fyi" ? mbFyi(keys).then(() => mbPaintBar()) : run(v)) }); } }, icon("more")));
  bar.classList.add("on");
  clear(bar).append(chk, el("span", { class: "mbox-n", "aria-live": "polite", text: `${keys.length}개 선택` }), ...btns,
    el("button", { class: "mbox-b mbox-x", type: "button", "aria-label": "선택 해제", title: "선택 해제", onclick: () => { MBOX.sel.clear(); document.querySelectorAll("#mon-tl .mr.mr-sel").forEach(r => { r.classList.remove("mr-sel"); const c = r.querySelector(".mr-chk"); if (c) c.checked = false; }); mbPaintBar(); } }, icon("close")));
}
// The visible mails of the list (select all) and the bar itself, at the head of the rows.
const MB_PAGE = 100;   // mail rows drawn at first and added per step
let mbObs = null;
// How many mail rows the list draws: MB_PAGE, grown by each step, and back to MB_PAGE when the list (app, folder) changes. A live update keeps it.
function mbDrawn(scope) {
  if (MBOX.fk !== scope) { MBOX.fk = scope; MBOX.drawn = MB_PAGE; MBOX.rows.clear(); }
  return MBOX.drawn;
}
// A mail row's node is kept while everything the row shows is the same (its signature): the mail card, its conversation, the unread count, the tick,
// an open decision, the opened original, the summary line and the time text. Only rows drawn by the last repaint are kept (mbRowsPrune).
function mbRow(t, label) {
  const m = MAILS.get(t), last = CONV.get(t), when = (m ? mailRowWhen : rcWhen)(last ? last.ts : m && m.at);
  const sig = JSON.stringify([label, m, last, ts(t).unread, MBOX.sel.has(t), ntHasDecision(t), MR_OG.has(t), m ? mailBrief(m, t) : "", when, mxSig(t)]), hit = MBOX.rows.get(t);
  MBOX.pass.add(t);
  if (hit && hit.sig === sig) return hit.node;
  const node = monConvNode(t, label);
  if (node) MBOX.rows.set(t, { sig, node }); else MBOX.rows.delete(t);
  return node;
}
function mbRowsPrune() {
  for (const t of [...MBOX.rows.keys()]) if (!MBOX.pass.has(t)) MBOX.rows.delete(t);
  MBOX.pass.clear();
}
// A step draws MB_PAGE more of the loaded mails; when the hub has older ones, the next page is asked for too, and the list draws again when it lands.
function mbMore() {
  MBOX.drawn += MB_PAGE;
  if (CVP.more) convMore().then(() => { MON.sig = ""; monSchedule(); });
  MON.sig = ""; monSchedule();
}
// After the drawn rows: a sentinel that adds a page when it reaches the viewport, and the plain button for a browser without IntersectionObserver.
function mbMoreNodes(left) {
  const btn = moreRow(left ? `${left}개 더 보기` : "메일 더 보기", mbMore);
  btn.dataset.mbMore = "1";
  return [el("div", { class: "mon-sentinel", "data-mb": "1", "aria-hidden": "true" }), btn];
}
function mbObserve() {
  const box = $("#mon-timeline"), s = box && box.querySelector(".mon-sentinel[data-mb]");
  if (mbObs) mbObs.disconnect();
  if (!s || typeof IntersectionObserver !== "function") return;
  if (!mbObs) mbObs = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) mbMore(); }, { root: box, rootMargin: "240px 0px" });
  mbObs.observe(s);
}
// No bar over a list with no mail rows (확인 대기, an empty folder): there is nothing to select.
function mbList(vis) {
  MBOX.vis = vis;
  for (const t of [...MBOX.sel]) if (!vis.includes(t)) MBOX.sel.delete(t);
  if (!vis.length) return null;
  const bar = mbBar();
  queueMicrotask(mbPaintBar);
  return bar;
}

/* ---------- the open mail: one slim bar of icons at its top, like Gmail ---------- */
// 보관, 삭제, 읽음 / 안 읽음, 답장, 전체답장, 전달, 초안 작성, 답장 안 함 / 답장 필요로 표시, 원문 보기 / 접기: every action of the open mail once, no ⋯ (owner 11-05). The way
// back is the bar's (#back); the row's ⋯ keeps 삭제 from dotz only. Icons only: the name is the aria-label and the title. The bar sticks while
// the mail scrolls. A mailbox that will not follow an action says so in the action's toast, not in a standing line.
const mbIco = (label, ic, onclick, k) => el("button", { class: "ib mtop-b", type: "button", "data-k": k, title: label, "aria-label": label, onclick }, icon(ic));
// The mark a tap sets now names the button, and mailSetFyi turns it to the other one.
function mailFyiPaint(b) {
  const a = mailOwed(MAILS.get(b.dataset.t) || {}) ? "no" : "need";
  b.dataset.a = a; b.dataset.k = `mail-open-${a}`; b.title = MAIL_ACT[a]; b.setAttribute("aria-label", MAIL_ACT[a]);
  clear(b).append(icon(a === "no" ? "replyoff" : "flag"));
  return b;
}
function mailFyiBtn(t) {
  const b = mbIco("", "flag", ev => busy(ev.currentTarget, () => mailActRun(t, b.dataset.a, null)));
  b.classList.add("mtop-fyi"); b.dataset.t = t;
  return mailFyiPaint(b);
}
// 원문 보기 / 접기 of the mail's own .rc-raw: the name follows the fold.
function mailRawBtn(d) {
  const b = mbIco("", "file", () => { d.open = !d.open; }, "mail-open-raw"), paint = () => { const label = d.open ? "원문 접기" : "원문 보기"; b.title = label; b.setAttribute("aria-label", label); b.setAttribute("aria-expanded", String(d.open)); };
  d.addEventListener("toggle", paint);
  paint();
  return b;
}
function mailOpenBar(t, card) {
  const m = MAILS.get(t) || {}, unread = mailUnread(t, m), arch = !!m.archived, out = m.dir === "out";
  // 삭제 is the last button of the bar, away from the ones used most.
  const acts = [arch ? ["unarchive", "받은편지함으로", "inbox"] : ["archive", "보관", "archive"], out ? null : unread ? ["read", "읽음으로 표시", "mailopen"] : ["unread", "안 읽음으로 표시", "mail"]].filter(Boolean);
  const act = ([a, label, ic]) => mbIco(label, ic, ev => busy(ev.currentTarget, async () => {
    const done = a === "trash" ? await mbTrash([t]) : await mbRun([t], a);
    if (done.length && a !== "trash" && a !== "read") { MBOX.sel.delete(t); if (monCtx === t && current === "chat") go("monitoring", MON.sel); }
  }), `mail-open-${a}`);
  const raw = card && card.querySelector(":scope > .rc-raw");
  if (card) mailOpenSummary(t, card);
  return el("div", { class: "mtop", role: "toolbar", "aria-label": "메일 처리" },
    ...acts.map(act),
    ...MB_MODES.map(([k, label, ic]) => el("button", { class: "ib mtop-b mbox-mode", type: "button", "data-mode": k, title: label, "aria-label": label, onclick: () => { mbOpenReply(t, k); const s = tl.querySelector(":scope > .mbox-reply"); if (s) s.scrollIntoView({ block: "nearest" }); } }, icon(ic))),
    out ? null : mailDraftButton(t, "ib mtop-b mr-draft"),
    out ? null : mailFyiBtn(t),
    raw ? mailRawBtn(raw) : null,
    act(["trash", "삭제", "trash"]));
}

/* ---------- 메일 쓰기: the floating button and its sheet ---------- */
const mbFab = () => el("button", { class: "mbox-fab", type: "button", "data-k": "mail-compose", "aria-label": "메일 쓰기", title: "메일 쓰기", onclick: () => mbCompose() }, icon("pencil"), el("span", { class: "mbox-fab-t", text: "메일 쓰기" }));
const mbSize = f => mailSize(f.size) || "";
// The attachments as chips: name and size, a × to take one off. `files` is the draft's own list, so the chips survive a failed save and a reopen.
function mbChips(files, onRemove, busyNames = []) {
  return el("div", { class: "mbox-files", "aria-label": "첨부파일" }, ...files.map((f, i) => el("span", { class: "mbox-chip", "data-name": f.name, title: f.name },
    icon("clip"), el("span", { class: "mbox-cn", text: f.name }), mbSize(f) ? el("span", { class: "mbox-cs", text: mbSize(f) }) : null,
    el("button", { class: "mbox-cx", type: "button", "aria-label": `${f.name} 빼기`, onclick: () => onRemove(i) }, icon("close")))),
    ...busyNames.map(n => el("span", { class: "mbox-chip wait", title: n }, icon("clip"), el("span", { class: "mbox-cn", text: n }), el("span", { class: "mbox-cs", text: "올리는 중…" }))));
}
// A form state {to, cc, subject, body, files, up:[names being uploaded]} painted into `host`; the fields write straight into the state, so a repaint keeps them.
function mbForm(st, host, o) {
  const field = (k, label, ph, extra = {}) => el("label", { class: `mbox-f mbox-f-${k}` }, el("span", { class: "mbox-fk", text: label }),
    el("input", { class: "mbox-in", type: "text", value: st[k], placeholder: ph, "data-k": `mail-${k}`, "aria-label": label, autocomplete: "off", spellcheck: "false", oninput: ev => { st[k] = ev.target.value; }, ...extra }));
  const picker = el("input", { type: "file", multiple: true, hidden: true, "aria-label": "파일 고르기" });
  const files = el("div", { class: "mbox-fw" });
  const paintFiles = () => clear(files).append(mbChips(st.files, i => { st.files.splice(i, 1); paintFiles(); }, st.up));
  const add = async list => {
    for (const f of list) {
      st.up.push(f.name); paintFiles();
      try { const u = await uploadFile(f); st.files.push({ name: u.name, ...(u.original ? { original: u.original } : {}), path: u.path, size: u.size, type: u.type }); }
      catch (e) { toast(e.message || "올리지 못했어요", true); }
      st.up.splice(st.up.indexOf(f.name), 1); paintFiles();
    }
  };
  picker.onchange = () => { const list = [...picker.files]; picker.value = ""; add(list); };
  const body = el("textarea", { class: "mbox-ta fi", rows: o.rows || "7", placeholder: o.placeholder || "내용", "data-k": "mail-body", "aria-label": "내용", oninput: ev => { st.body = ev.target.value; } });
  body.value = st.body;
  const ccRow = field("cc", "참조", "쉼표로 여러 명");
  ccRow.hidden = !st.cc && !st.showCc;
  const ccBtn = el("button", { class: "mbox-cc", type: "button", "aria-label": "참조 추가", onclick: () => { st.showCc = true; ccRow.hidden = false; ccBtn.hidden = true; ccRow.querySelector("input").focus(); } }, "참조");
  ccBtn.hidden = !ccRow.hidden;
  const to = field("to", "받는 사람", "쉼표로 여러 명");
  to.append(ccBtn);
  // a missing 받는 사람 is said under its row and stays until something is typed there
  const err = el("div", { class: "mbox-err", role: "alert", text: "받는 사람을 적어 주세요", hidden: true });
  const toIn = to.querySelector("input");
  toIn.addEventListener("input", () => { err.hidden = true; });
  st.needTo = () => { err.hidden = false; toIn.focus(); };
  paintFiles();
  // append(null) would print the word "null": the quote block is added only when there is an original
  clear(host).append(to, err, ccRow, field("subject", "제목", "제목"), body, files, picker);
  if (o.quote) host.insertBefore(o.quote, files);
  return { pick: () => picker.click(), body, files: paintFiles };
}
const mbPayload = (st, extra = {}) => ({ to: st.to.trim(), cc: st.cc.trim(), subject: st.subject.trim(), body: st.body, attachments: st.files.map(f => ({ name: f.name, path: f.path, size: f.size })), ...extra });
const mbEmpty = st => !st.to.trim() && !st.cc.trim() && !st.subject.trim() && !st.body.trim() && !st.files.length;
async function mbSave(st, extra, btn) {
  if (!st.to.trim()) { st.needTo(); return null; }
  if (st.up.length) { toast("파일을 올리는 중이에요", true); return null; }
  let r = null;
  await busy(btn, async () => {
    try { r = await api("/api/mail/compose", "POST", mbPayload(st, extra)); }
    catch (e) { toast(e && /^HTTP 404/.test(e.message) ? "서버가 아직 새 메일 초안을 지원하지 않아요" : (e && e.message) || "초안을 만들지 못했어요", true); }
  });
  if (r) { toast("초안을 만들었어요 · 승인 카드에서 보내요"); loadNotices(); }
  return r;
}
// The floating sheet: docked at the bottom right of a wide screen (minimize / close), the whole screen on a phone. Closing a sheet with text asks first.
// Folded or open. A folded bar on a phone sits right above the tab bar (--mbox-lift = the room under it), and its button says which way it goes.
function mbFold(node, min) {
  node.classList.toggle("min", min);
  const b = node.querySelector(".mbox-min"), word = min ? "펼치기" : "최소화";
  b.setAttribute("aria-label", word); b.title = word; b.replaceChildren(icon(min ? "drop" : "minus"));
  // folded, the bar names the mail (its subject, else who it goes to) instead of "새 메일"
  const st = MBOX.cs && MBOX.cs.node === node ? MBOX.cs.st : null;
  node.querySelector(".mbox-st").textContent = min && st ? st.subject.trim() || st.to.trim() || "새 메일" : "새 메일";
  const nr = $("#nav").getBoundingClientRect();
  node.style.setProperty("--mbox-lift", min && nr.height > 0 && nr.top > innerHeight / 2 ? `${Math.ceil(innerHeight - nr.top)}px` : "0px");
}
function mbCompose(init = {}) {
  if (MBOX.cs && MBOX.cs.node.isConnected) { mbFold(MBOX.cs.node, false); MBOX.cs.node.querySelector(".mbox-in").focus(); return; }
  const st = { to: "", cc: "", subject: "", body: "", files: [], up: [], showCc: false, ...init };
  const host = el("div", { class: "mbox-sb" });
  const form = mbForm(st, host, { rows: "10" });
  const node = el("div", { class: "mbox-sheet", role: "dialog", "aria-label": "새 메일" });
  // The sheet fades down and away before it is removed; it is no longer the open one from the first moment.
  const leave = async () => { MBOX.cs = null; refit.disconnect(); node.inert = true; await motionOut(node, "rise"); node.remove(); };
  const close = async () => { if (!mbEmpty(st) && !await ask("작성 중인 메일", "쓰던 내용을 버릴까요?", "버리기", true)) return; leave(); };
  const save = ev => mbSave(st, {}, ev.currentTarget).then(r => { if (r) leave(); });
  node.append(
    el("div", { class: "mbox-sh", onclick: ev => { if (node.classList.contains("min") && !ev.target.closest("button")) mbFold(node, false); } }, el("span", { class: "mbox-st", text: "새 메일" }),
      el("button", { class: "ib mbox-min", type: "button", "aria-label": "최소화", title: "최소화", onclick: () => mbFold(node, !node.classList.contains("min")) }, icon("minus")),
      el("button", { class: "ib mbox-close", type: "button", "aria-label": "닫기", title: "닫기", onclick: close }, icon("close"))),
    host,
    el("div", { class: "mbox-sf" }, el("button", { class: "btn pri mbox-save", type: "button", "data-k": "mail-compose-save", onclick: save }, "초안 만들기"),
      el("button", { class: "ib mbox-attach", type: "button", "aria-label": "파일 붙이기", title: "파일 붙이기", onclick: () => form.pick() }, icon("clip"))));
  document.body.append(node);
  // the tab bar comes and goes with the screen and the window: a folded bar follows it
  const refit = new ResizeObserver(() => { if (node.classList.contains("min")) mbFold(node, true); });
  refit.observe($("#nav")); refit.observe(document.documentElement);
  motionIn(node, "rise", 240);
  MBOX.cs = { node, st };
  node.querySelector(".mbox-in").focus();
}

/* ---------- the inline reply at the bottom of the open mail ---------- */
const MB_MODES = [["reply", "답장", "reply"], ["all", "전체답장", "replyall"], ["forward", "전달", "forward"]];
const mbRe = (p, s) => (new RegExp(`^\\s*${p}\\s*:`, "i").test(s) ? s : `${p}: ${s}`);
const mbAddrs = v => mailAddrList(v).map(a => a.addr || a.name);
// To / Cc / subject of a mode, from the mail's card.
function mbDefaults(t, mode) {
  const m = MAILS.get(t) || {}, subj = m.subject || "";
  if (mode === "forward") return { to: "", cc: "", subject: mbRe("Fwd", subj) };
  const to = m.dir === "out" ? mbAddrs(m.to) : mbAddrs(m.from);
  const cc = mode === "all" ? [...mbAddrs(m.dir === "out" ? "" : m.to), ...mbAddrs(m.cc)].filter(a => !to.includes(a)) : [];
  return { to: to.join(", "), cc: [...new Set(cc)].join(", "), subject: mbRe("Re", subj) };
}
// The original, as the quote under the reply: the 원문 of the mail's first message the page holds.
function mbQuoteText(t) {
  const e = ts(t).msgs.find(x => x.kind === "mail");
  return mailOwnBody(mailOrigOf(e ? e.text : ""), e && e.subject).trim();
}
function mbBox(t) {
  let b = MBOX.boxes.get(t);
  if (!b) { b = { open: false, mode: "reply", st: null }; MBOX.boxes.set(t, b); }
  return b;
}
function mbOpenReply(t, mode) {
  const b = mbBox(t), m = MAILS.get(t) || {};
  const keep = b.st ? { body: b.st.body, files: b.st.files } : { body: "", files: [] }, opening = !b.open;
  b.open = true; b.mode = mode;
  b.st = { ...mbDefaults(t, mode), showCc: mode === "all", up: [], ...keep };
  if (mode === "forward" && !b.st.body) b.st.body = `\n\n---------- 전달한 메일 ----------\n보낸 사람: ${m.from || ""}\n제목: ${m.subject || ""}\n\n${mbQuoteText(t)}`;
  mbReplyPaint(true);
  if (opening && typeof tl !== "undefined" && tl) motionIn(tl.querySelector(":scope > .mbox-reply"));   // the reply box opens; a change of mode inside it moves nothing
}
function mbReplyPaint(force) {
  if (typeof tl === "undefined" || !tl) return;
  const t = target, ok = current === "chat" && isMailT(t) && MAILS.has(t) && !!tl.querySelector(".mhd-wrap");
  let slot = tl.querySelector(":scope > .mbox-reply");
  if (!ok) { if (slot) slot.remove(); return; }
  const b = mbBox(t), sig = JSON.stringify([t, b.open, b.mode]);
  if (slot && slot.dataset.sig === sig && !force && slot.isConnected && slot === tlTail()) return;
  if (slot) slot.remove();
  slot = el("section", { class: `mbox-reply${b.open ? " open" : ""}`, "aria-label": "답장 쓰기", "data-sig": sig });
  // closed, the slot stays empty (and hidden): 답장 / 전체답장 / 전달 are icons in the mail's top bar
  if (b.open) {
    const host = el("div", { class: "mbox-rb" }), quote = mbQuoteText(t);
    const q = quote ? el("details", { class: "mbox-quote" }, el("summary", { text: "이전 메일" }), el("pre", { class: "mbox-qt", text: quote })) : null;
    const form = mbForm(b.st, host, { rows: "6", placeholder: "답장 내용", quote: q });
    slot.append(
      el("div", { class: "mbox-modes" }, ...MB_MODES.map(([k, label, ic]) => el("button", { class: `cchip mbox-mode${k === b.mode ? " on" : ""}`, type: "button", "data-mode": k, "aria-pressed": String(k === b.mode), onclick: () => mbOpenReply(t, k) }, icon(ic), label))),
      host,
      el("div", { class: "mbox-sf" },
        el("button", { class: "btn pri mbox-save", type: "button", "data-k": "mail-reply-save", onclick: ev => mbSave(b.st, { reply_to: mbKey(t), mode: b.mode }, ev.currentTarget).then(r => { if (r) { MBOX.boxes.delete(t); mbReplyPaint(true); } }) }, "초안 만들기"),
        el("button", { class: "ib mbox-attach", type: "button", "aria-label": "파일 붙이기", title: "파일 붙이기", onclick: () => form.pick() }, icon("clip")),
        el("button", { class: "btn text mbox-cancel", type: "button", onclick: () => { b.open = false; mbReplyPaint(true); } }, "접기")));
  }
  tl.append(slot);
}
