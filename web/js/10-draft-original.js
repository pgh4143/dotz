/* ---------- 원문 보기: the mail or comment a reply draft answers, as its own panel next to the draft (the send sheet, the comment view's draft card) ---------- */
// The draft stays as it was. A wide screen (>= 900px) opens the original as a SEPARATE panel (own header 원문 + x, own scroll) to the left while the draft slides to the
// right; a narrow one has a 2-segment toggle 초안 | 원문 above the draft and slides between the two (15-draft-original.css). One state (open) drives both. The original is
// fetched on the first open (GET /api/drafts/<ref>/original, hub/draft-attach.ts; through the peer proxy for a peer's draft, the same way as the draft's files) and kept per draft.
// The answer says what it is (kind "mail" | "comment"). A mail's body is the mail view's own (mailBodyNode: the sandboxed HTML frame or the laid-out text); a comment
// shows its author, time, text, the post it is under (title, thumbnail) and the comment above it in a thread. The state lives here, so a repaint keeps it open.
const ORG = { st: {} };
const orgSt = ref => ORG.st[ref] || (ORG.st[ref] = { open: false, load: "", data: null });
const ORG_WIDE = matchMedia("(min-width: 900px)");
ORG_WIDE.addEventListener("change", () => { for (const k in ORG.st) if (ORG.st[k].sync) ORG.st[k].sync(); });

// `get` replaces the draft route for an original that is not a draft's (orgMailRow: a mail of the list, keyed by its conversation).
async function orgLoad(ref, t, paint, get) {
  const s = orgSt(ref), go = () => {
    (s.paint || paint)();
    if (s.subs) { for (const f of [...s.subs]) f(); if (s.load !== "busy") s.subs.clear(); }   // inline blocks (orgInline) waiting on the same fetch
  };
  if (s.load === "busy" || s.load === "ok" || s.load === "missing") return;
  s.load = "busy"; go();
  if (!get) DRF.pc[ref] = t ? pqPc(t) : null;
  try { s.data = await (get ? get() : api(drfPath(ref, "original"))); s.load = "ok"; }
  catch (e) { s.load = /찾을 수 없|HTTP 404/.test(e.message) ? "missing" : "fail"; }
  go();
}
const ORG_POST = { youtube: "영상", instagram: "게시물" };
// A comment's pane: the post it is under, who wrote it and when, the comment above it when it is a reply, the text, and the way to the original.
function orgComment(pane, m) {
  const p = m.post || {};
  pane.append(...[p.title || p.thumb ? el("div", { class: "od-post" }, cmThumb(p.title || "", p.thumb), el("span", { class: "od-pt" }, el("span", { class: "dc-dr-k", text: ORG_POST[p.kind] || "글" }), p.title ? el("span", { class: "od-ptt", text: p.title }) : null)) : null,
    orgRow("작성자", m.author), orgRow("시간", m.date ? kstStamp(m.date) : ""),
    m.parent ? el("div", { class: "od-parent" }, el("span", { class: "dc-dr-k", text: `↳ ${m.parent.author}의 댓글` }), el("span", { class: "od-pc", text: m.parent.text })) : null,
    el("div", { class: "od-body od-ct", text: m.text }),
    p.link ? el("a", { class: "od-open", href: p.link, target: "_blank", rel: "noopener noreferrer" }, icon("open"), "원본 열기") : null].filter(Boolean));
}
const orgRow = (k, v) => v ? el("div", { class: "dc-dh" }, el("span", { class: "dc-dr-k", text: k }), el("span", { class: "dc-dr-v sub", text: v })) : null;
// The pane's content for the state it is in: loading, gone, failed (with a retry) or the mail.
function orgFill(pane, d, t, retry) {
  const s = orgSt(d.ref), note = (text, ...kids) => pane.append(el("div", { class: "od-note", role: "status" }, text, ...kids));
  clear(pane);
  if (s.load === "missing") { note("원문을 찾을 수 없어요"); return; }
  if (s.load === "fail") { note("원문을 불러오지 못했어요 ", el("button", { class: "btn text", type: "button", onclick: retry }, "다시 시도")); return; }
  if (s.load !== "ok") { note("원문을 불러와요…"); return; }
  const m = s.data, pc = t ? pqPc(t) : null;
  if (m.kind === "comment") { orgComment(pane, m); return; }
  if (pc) PQ.of.set(`mail:${m.key}`, { pc, key: m.key });   // its body and files are read from the computer that owns the mail
  const files = mailRealFiles(m.attachments);   // the body's own pictures are drawn in it, not listed as files
  // 보낸 사람 / 받는 사람 / 참조 come from the mail view's own header (30-mail-thread.js), so every place a mail is read names them the same way
  const pp = mailPeople(m, m.text, m.subject), blank = v => !String(v || "").replace(/[\s\-–—]+/g, "");   // a lone "-" names nobody
  const people = mailHeadNode({ ...m, from: blank(m.from) ? "" : m.from, to: blank(pp.to) ? "" : pp.to, cc: blank(pp.cc) ? "" : pp.cc });   // no 보낸 사람 / 받는 사람 / 참조 known: no box at all
  if (!people.childElementCount && !m.date && !m.subject && !m.html && !String(m.text || "").trim() && !files.length) { note("원문이 없어요"); return; }   // nothing known: say so, not a few empty rows
  pane.append(...[people.childElementCount ? people : null, orgRow("날짜", kstStamp(m.date)), orgRow("제목", m.subject),
    el("div", { class: "od-body" }, mailBodyNode(m.key, m.html, m.text, m.subject)),
    files.length ? el("div", { class: "od-files" }, ...files.map(({ f, i }) => el("a", { class: "dr-att", href: mailFileUrl(m.key, i), target: "_blank", rel: "noopener", title: `${f.name} 열기` },
      icon("clip"), el("span", { class: "dr-fn", text: f.name }), f.size ? el("span", { class: "dr-fs", text: mailSize(f.size) }) : null))) : null].filter(Boolean));
}
// Whether a draft has an original to open: the hub says so with its files (`original`), so a block a session wrote, with nothing behind it, offers no 원문.
// Until the answer is here the sheet shows no tab; `repaint` draws it once it is.
function orgHas(ref, t, repaint) {
  const st = ref ? DRF.st[ref] : null;
  if (st) return st.original !== false;
  if (ref) { DRF.pc[ref] = t ? pqPc(t) : null; drfLoad(ref).then(repaint); }
  return false;
}
// The comment a combined card (reply + mail) answers, as a compact block at the top of the card: the side panel has no room beside the mail part, so
// the same pane content (orgFill) is drawn inline under a 댓글 원문 header. Null unless `d` is a comment reply.
function orgInline(d, t) {
  if (!d.ref || d.toLabel !== "대상") return null;
  const s = orgSt(d.ref), pane = el("div", { class: "od-pane", role: "region", "aria-label": "댓글 원문" });
  const paint = () => orgFill(pane, d, t, () => { s.load = ""; (s.subs ||= new Set()).add(paint); orgLoad(d.ref, t, paint); });
  paint();
  if (s.load === "" || s.load === "busy") { (s.subs ||= new Set()).add(paint); orgLoad(d.ref, t, paint); }
  return el("div", { class: "od-inline" }, el("div", { class: "dr-mh" }, icon("chat"), el("span", { text: "댓글 원문" })), pane);
}
// A mail with no draft (a row of 모니터링 > 메일): the same answer as the draft route, read from the mail itself - its card (MAILS: sender, date, files, whether an
// HTML body is kept) and the body in its conversation's mail event (GET /api/history, hub/mail.ts mailText). Nothing kept at all is a 404, so the pane says 찾을 수 없어요.
async function orgMailOf(t) {
  const rec = MAILS.get(t) || {}, r = await api(`/api/history?target=${enc(t)}&limit=150`);
  const e = (r.events || []).filter(x => x.kind === "mail" && x.subject).pop();
  const text = e ? mailOrigOf(e.text) : rec.preview || "", html = !!(rec.html || (e && e.html));
  if (!e && !html && !text.trim()) throw new Error("HTTP 404");
  return { kind: "mail", key: t.slice(5), from: rec.from || (e && e.from) || "", to: rec.to || (e && e.to) || "", cc: rec.cc || (e && e.cc) || "", date: rec.at || (e && e.ts),
    subject: rec.subject || (e && e.subject) || "", text, html, attachments: rec.attachments || (e && e.attachments) || [] };
}
// 원문 보기 of a mail row (owner 2026-11-04): an item of the row's ⋯ menu (a row keeps no other right-side button, owner 2026-10-27) folds the original open under
// the summary, without leaving the list. Open rows are kept across repaints; the first open fetches once (orgLoad), and a click inside the original does not open the mail's conversation.
const MR_OG = new Set();
const orgMailItem = t => [{ value: "original", label: MR_OG.has(t) ? "원문 접기" : "원문 보기", run: () => { if (!MR_OG.delete(t)) MR_OG.add(t); MON.sig = ""; monSchedule(); } }];
function orgMailRow(t) {
  if (!MR_OG.has(t)) return [];
  const s = orgSt(t), stop = ev => ev.stopPropagation();
  const pane = el("div", { class: "od-pane mr-op", role: "region", "aria-label": "메일 원문", onclick: stop, onkeydown: stop });
  const paint = () => { if (MR_OG.has(t)) orgFill(pane, { ref: t }, t, () => { s.load = ""; load(); }); };
  const load = () => { (s.subs ||= new Set()).add(paint); orgLoad(t, t, paint, () => orgMailOf(t)); paint(); };
  load();
  return [pane];
}
// The bar (desktop: one 원문 보기 button; phone: the 초안 | 원문 toggle) and the original panel for `host`, the box both panels live in; `draftEl` is the draft's own
// side (it goes inert while the phone shows the original). The caller places bar above, orig and the draft in one stage. Nothing is fetched until the first open.
// `d` = { ref, to, toLabel }: toLabel "대상" is a comment reply, "받는이" a mail.
function orgNodes(d, t, host, draftEl) {
  const ref = d.ref, s = orgSt(ref), cm = d.toLabel === "대상";
  const tt = el("span", { class: "od-tt" }), tg = el("button", { class: "od-tg", type: "button", "aria-controls": `od-${ref}` }, icon(cm ? "chat" : "mail"), tt);
  const sg = (v, label) => el("button", { class: "od-sg", type: "button", "data-v": v, onclick: () => show(v === "orig") }, label);
  const sgDraft = sg("draft", "초안"), sgOrig = sg("orig", "원문");
  const bar = el("div", { class: "od-bar" }, tg, el("div", { class: "od-seg", role: "group", "aria-label": "초안과 원문 고르기" }, sgDraft, sgOrig));
  const pane = el("div", { class: "od-pane", tabindex: "0", role: "region", "aria-label": cm ? "댓글 원문" : "메일 원문" });
  const x = el("button", { class: "ib fs-x od-x", type: "button", "aria-label": "원문 닫기", onclick: () => { show(false); (ORG_WIDE.matches ? tg : sgDraft).focus({ preventScroll: true }); } }, icon("close"));
  const orig = el("section", { class: "od-orig", id: `od-${ref}`, "aria-label": "원문" }, el("div", { class: "od-oh" }, el("span", { class: "od-ot", text: "원문" }), x), pane);
  host.classList.add("od-host");
  const paint = () => { if (orig.isConnected || !s.open) orgFill(pane, d, t, () => { s.load = ""; orgLoad(ref, t, paint); }); };
  const sync = () => {
    host.classList.toggle("od-on", s.open);
    tg.setAttribute("aria-expanded", String(s.open)); tt.textContent = s.open ? "원문 접기" : "원문 보기";
    sgDraft.setAttribute("aria-pressed", String(!s.open)); sgOrig.setAttribute("aria-pressed", String(s.open));
    orig.toggleAttribute("inert", !s.open); draftEl.toggleAttribute("inert", s.open && !ORG_WIDE.matches);
  };
  const show = open => { s.open = open; sync(); if (open) orgLoad(ref, t, paint); };
  tg.onclick = () => show(!s.open);
  s.paint = paint; s.sync = sync;
  sync(); paint();
  if (s.open) orgLoad(ref, t, paint);
  return { bar, orig };
}
