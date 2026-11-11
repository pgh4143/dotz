/* ---------- 답장 초안 카드: one card for every reply draft (메일, 카카오톡, 댓글) of every computer ---------- */
// One component for the 답장 확인 queue (30-replies.js), the mail list's 확인 대기 (30-monitoring.js draftCardNode), the KakaoTalk room
// (30-kakao.js kkDraftCard) and a comment thread (30-monitoring-comments.js cmDraftCard): the same head (앱 · 계정 · 컴퓨터 · 모델 when known),
// the body clamped to about six lines with 펼치기, and the same three actions with the same words, 보내기 · 고치기 · 보내지 않기.
// Each caller passes what its actions do; the card never decides where a draft is sent.
const RQ_APPS = { mail: ["메일", "mail"], kakao: ["카카오톡", "chat"], instagram: ["인스타그램", "chat"], youtube: ["유튜브", "chat"], site: ["웹사이트 댓글", "chat"] };
const RQ_LINES = 6;
const RQ_OPEN = new Set();   // card keys whose long body was unfolded (펼치기); kept across repaints
// The app key of an instance id ("mail-2" -> "mail", a peer's "kakao~h1" -> "kakao").
const rqBase = app => String(app || "").split("~")[0].split("-")[0];
const rqAppName = app => (RQ_APPS[rqBase(app)] || [""])[0];
// h: { app (instance id), label (the instance's own name), pc (computer name), model, at (ms or ISO), tail (nodes at the end) }
// ONE tight line (owner 2026-11-03): who the draft answers and where it came from, the state at the right. The author's initial is a small
// 20px mark, so the head never takes a second line and the original below it is the only thing that reads as a quote.
function rqHeadNode(h) {
  const [name, ic] = RQ_APPS[rqBase(h.app)] || [h.appName || "답장", "send"];
  const at = h.at ? new Date(h.at) : null, when = at && !isNaN(at) ? rcWhen(at.toISOString()) : "";
  const to = h.who ? `${h.who}님께 답장` : name, src = h.who ? h.src ?? name : [h.label && h.label !== name ? h.label : "", h.model || ""].filter(Boolean).join(" · ");
  return el("div", { class: `rq-hd${h.who ? " rq-who" : ""}` },
    h.who && !h.ic ? el("span", { class: "rq-av", "aria-hidden": "true", text: [...h.who][0] || "?" }) : el("span", { class: "dr-ic" }, icon(h.ic || (ICONS[ic] ? ic : "send"))),   // h.ic (a mail draft): the app's icon, as on a card with no person
    el("span", { class: "rq-meta", title: [to, src].filter(Boolean).join(" · ") }, el("b", { class: "rq-wt", text: to }),
      src ? el("span", { class: "rq-src", text: ` · ${src}` }) : null, h.pc ? el("span", { class: "mon-pc", text: ` · ${h.pc}` }) : null),
    when ? el("span", { class: "rc-time", text: when }) : null, ...(h.tail || []));
}
// A body is long when it would take more than RQ_LINES lines at a phone's width (about 36 Korean characters a line).
const rqLong = text => String(text || "").split("\n").reduce((n, l) => n + Math.max(1, Math.ceil([...l].length / 36)), 0) > RQ_LINES;
// c.bare: a card with only its label, body and buttons (the room's draft card sits right under the chat it answers, 30-kakao.js); b.one: a single part is a bubble too.
// b: { text, parts (a KakaoTalk draft's messages: one bubble each, sentParts of them already in the room), node (the caller's own body), cls, partCls, full (never clamped: a sheet scrolls it) }
function rqBodyNode(key, b) {
  const parts = Array.isArray(b.parts) && b.parts.length > (b.one ? 0 : 1) ? b.parts : null, long = !b.full && rqLong(parts ? parts.join("\n") : b.text), open = RQ_OPEN.has(key);
  const inner = b.node || (parts ? el("div", { class: `${b.cls || "rq-text"} rq-parts` }, ...parts.map((p, i) => el("div", { class: `${b.partCls || "rq-part"}${i < (b.sentParts | 0) ? " sent" : ""}`, text: p }))) : el("div", { class: b.cls || "rq-text", text: b.text }));
  const box = el("div", { class: `rq-body${long && !open ? " clamp" : ""}` }, inner);
  if (!long) return box;
  const more = el("button", { class: "btn text rq-more", type: "button", "data-k": "more", "aria-expanded": String(open), text: open ? "접기" : "펼치기", onclick: ev => {
    ev.stopPropagation();
    if (RQ_OPEN.has(key)) RQ_OPEN.delete(key); else RQ_OPEN.add(key);
    const on = RQ_OPEN.has(key);
    box.classList.toggle("clamp", !on); more.textContent = on ? "접기" : "펼치기"; more.setAttribute("aria-expanded", String(on));
  } });
  return el("div", { class: "rq-bodywrap" }, box, more);
}
// The three actions, the same words everywhere. A missing handler leaves its button disabled; `busy` disables all three. a.manual (a mail draft's 직접 수정)
// stands at the right end of the row.
function rqActsNode(a) {
  const b = (cls, k, text, fn) => el("button", { class: cls, type: "button", "data-k": k, disabled: !!a.busy || !fn, text, onclick: fn });
  return el("div", { class: "dr-act dr-row rq-acts" }, b("btn sm dr-send", "send", "보내기", a.send), b("btn tonal sm", "edit", "고치기", a.edit), b("btn text sm dr-drop", "drop", a.dropText || "보내지 않기", a.drop), a.manual ? rqManualBtn(a.manual, a.busy) : null);
}
const rqManualBtn = (fn, busy) => el("button", { class: "btn text sm rq-manual", type: "button", "data-k": "manual", "aria-label": "직접 수정", disabled: !!busy, onclick: fn }, icon("pencil"), el("span", { text: "직접 수정" }));
// 고치기: what to change, typed once; the bot rewrites the draft. o: { go(change), cancel(), manual() (직접 수정, optional), pick (a node before the field, such
// as which part of a comment reply with a mail to change), value, onInput(text), busy }
function rqReviseNode(o) {
  const inp = el("input", { class: "kk-rv rq-rv", type: "text", maxlength: "500", placeholder: DRAFT_HINT, "aria-label": "고칠 내용", autocomplete: "off", disabled: !!o.busy });
  inp.value = o.value || "";
  const go = el("button", { class: "btn", type: "button", "data-k": "revise-go", text: "고쳐 달라고 하기", disabled: !!o.busy || !inp.value.trim(), onclick: () => { const change = inp.value.trim(); if (change) o.go(change); } });
  inp.oninput = () => { if (o.onInput) o.onInput(inp.value); go.disabled = !inp.value.trim(); };
  inp.onkeydown = ev => { if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); go.click(); } };
  return el("div", { class: "rq-edit" }, el("div", { class: "kk-rq", text: "어떻게 고칠까요?" }), o.pick || null, inp,
    el("div", { class: "btns" }, go,
      el("button", { class: "btn text", type: "button", "data-k": "revise-cancel", text: "취소", disabled: !!o.busy, onclick: o.cancel }),
      o.manual ? el("button", { class: "btn text kk-manual", type: "button", "data-k": "manual", "aria-label": "직접 수정", onclick: o.manual }, icon("pencil"), el("span", { text: "직접 수정" })) : null));
}
// The attachment line: every card says what goes with the draft before 보내기 - the files that go (name + size), or 첨부: 없음, or, for a source that cannot
// attach, the names of the files that stay behind (hub/draft-approval.ts attachments / attachmentsNone / cannotAttach); nothing when none stay behind.
function rqAttachNode(d = {}) {
  const fl = Array.isArray(d.attachments) ? d.attachments : [], left = Array.isArray(d.cannotAttach) ? d.cannotAttach.filter(n => n && String(n).trim()) : null;
  if (fl.length) return el("div", { class: "rq-att", "data-k": "files" }, el("div", { class: "dr-fh", text: `첨부 ${fl.length}개` }),
    ...fl.map(f => el("div", { class: "rq-af" }, icon("file"), el("span", { class: "rq-afn", text: f.name }), f.size ? el("span", { class: "dr-fm", text: f.size }) : null)));
  if (left && !left.length) return null;   // a place that cannot attach and leaves no file behind (a comment reply) says nothing
  return el("div", { class: "rq-att", "data-k": "none" }, el("div", { class: "dr-none", role: "status" }, icon("clip"),
    el("span", { text: left ? "첨부: 없음 · 파일을 붙일 수 없는 곳이에요" : "첨부: 없음" }),
    left && left.length ? el("span", { class: "dr-wn", text: `남는 파일: ${left.join(", ")}` }) : null));
}
// The original a draft answers, as a quiet quote (owner 2026-11-03): muted, behind one 2px left rule, two lines by default with a
// 원문 보기 toggle. It reads as someone else's words, plainly separate from the draft under it (원칙 5). Open state is kept per card key.
// When the draft has a ref (o.ref, o.t = its conversation), 원문 보기 always shows and opens the full original under the quote: a mail's sender, subject, date and
// whole body, or the original comment (owner 2026-11-04), loaded through the 원문 panel's own loader and pane (10-draft-original.js orgLoad / orgFill).
const RQ_OG = new Set();
function rqOrigNode(key, o) {
  const text = String(o.text || ""), long = [...text].length > 84 || text.includes("\n"), open = RQ_OG.has(key), full = !!o.ref;
  const box = el("div", { class: `rq-orig${long && !open ? " clamp" : ""}`, title: text },
    el("div", { class: "rq-oh" }, el("span", { class: "rq-ow", text: o.who || "원문" })),
    el("span", { class: "rq-ot", text }));
  if (!long && !full) return el("div", { class: "rq-og-wrap" }, box);
  const pane = full ? el("div", { class: "od-pane rq-op", role: "region", "aria-label": "원문", hidden: !open }) : null;
  const s = full ? orgSt(o.ref) : null;
  const paint = () => { if (!RQ_OG.has(key)) return; orgFill(pane, { ref: o.ref }, o.t, () => { s.load = ""; load(); }); };
  const load = () => { (s.subs ||= new Set()).add(paint); orgLoad(o.ref, o.t, paint); paint(); };
  const btn = el("button", { class: "btn text rq-og", type: "button", "aria-expanded": String(open), text: open ? "원문 접기" : "원문 보기", onclick: ev => {
    ev.stopPropagation();
    const on = !RQ_OG.has(key); if (on) RQ_OG.add(key); else RQ_OG.delete(key);
    box.classList.toggle("clamp", long && !on); btn.setAttribute("aria-expanded", String(on)); btn.textContent = on ? "원문 접기" : "원문 보기";
    if (pane) { pane.hidden = !on; if (on) load(); }
  } });
  if (pane && open) load();
  return el("div", { class: "rq-og-wrap" }, box, btn, pane);
}
// A mail draft's parts, the same on every screen that shows one (the notice's sheet, the 답장 대기 sheet, the mail's own card): the head line (who it answers, 메일,
// the time), the mail it answers as a quote, the subject, the 받는이 line folded to one button (draftRecvFold, below) and the 첨부 줄.
// o: { t (the mail's conversation), at, edit (the 받는이 and 첨부 rows can change), pc, tail (nodes at the head's end), warn (a box for the 첨부 warnings),
// seen (the brief lines were shown already: 11-mailtext.js mailLinesOpen), src (the head's source word; "" inside the 메일 screen, where it says nothing new) }
const rqRcptName = s => { const a = String(s || "").split(/\s*,\s*/)[0].trim(), m = /^"?([^"<]*?)"?\s*<([^>]*)>$/.exec(a); return m ? m[1].trim() || m[2] : a; };
function rqMailOriginal(dr, t) {
  const m = String(t || "").startsWith("mail:") ? MAILS.get(t) : null, src = { ref: dr.ref, t };   // ref: 원문 보기 loads the full original
  if (m) return { who: mailSender(m.from), text: m.subject || mailBrief(m, t), ...src };
  if (dr.origin && dr.origin.text) return { who: "", text: dr.origin.text, ...src };
  return dr.ref ? { who: "", text: dr.subject || "", ...src } : null;
}
function rqMailParts(dr, o) {
  const m = String(o.t || "").startsWith("mail:") ? MAILS.get(o.t) : null, b = dr.brief || {}, who = (m && mailSender(m.from)) || rqRcptName(dr.to);
  return { cls: "rq-ml", head: { app: "mail", who, src: o.src ?? "메일", ic: "mail", pc: o.pc || "", at: o.at || null, tail: o.tail || [] }, original: rqMailOriginal(dr, o.t),
    brief: b.summary || (!o.seen && (b.todo || b.questions)) ? el("div", { class: "rq-brief" }, b.summary ? el("div", { class: "rq-sumline", text: b.summary }) : null, o.seen ? null : mailLinesNode(b.todo, b.questions)) : null, recv: draftRecvFold(dr, { t: o.t, edit: o.edit }), subject: dr.subject,
    attach: draftFilesNode(dr, { t: o.t, edit: o.edit, warn: o.warn }) };
}
// The card. c: { key, cls, attrs, head (rqHeadNode), label + labelCls (a sub-head such as "답장 초안 · 메시지 2개"), to: [label, value],
// recv (a mail draft's own 받는이·참조 rows, 10-decision-card.js draftToNode; given instead of `to`), subject,
// original: {who, text} (what the draft answers), body, attach (a draft's attachments / attachmentsNone / cannotAttach, or the caller's own files node),
// extra (nodes under the body: the mail that goes along), then one of: status (a line such as 고치는 중…), revise (rqReviseNode or the caller's own),
// acts (rqActsNode) }.
function rqCard(c) {
  const foot = c.sent ? rqSentNode(c.sentAt) : c.status ? el("div", { class: "kk-st", role: "status", text: c.status }) : c.revise ? c.revise : c.acts ? rqActsNode(c.acts) : null;
  const att = c.bare ? null : c.attach && c.attach.nodeType ? c.attach : rqAttachNode(c.attach || {});
  const cm = !!(c.head && c.head.who);   // a comment card: its text quoted under the head, the post title a grey hint, the draft as the body
  return el("div", { class: `rq${cm ? " cm" : ""}${c.cls ? ` ${c.cls}` : ""}`, ...(c.attrs || {}) },
    c.bare ? null : rqHeadNode(c.head),
    !c.bare && c.original && c.original.text ? rqOrigNode(c.key, c.original) : null,
    c.brief || null,
    c.label ? el("div", { class: c.labelCls || "rq-lb", text: c.label }) : null,
    c.to ? (cm ? null : el("div", { class: "rq-to dr-to" }, el("span", { class: "dr-k", text: c.to[0] }), el("span", { class: "dr-chip", text: c.to[1] || "-" }))) : c.recv || null,   // a mail keeps its 받는이 rows
    c.subject ? el("div", { class: "dr-sub rq-sub", text: c.subject }) : null,
    rqBodyNode(c.key, c.body), att, ...(c.extra || []).filter(Boolean), foot);
}
// 보냈어요 in the card's own foot: the action row's place, so nothing below moves (the landing demo card's 보냈어요 · 방금).
const rqSentNode = (at = "방금") => el("div", { class: "rq-sent", role: "status", "data-state": "send" }, icon("check"), el("span", { text: "보냈어요" }), el("span", { class: "rq-sent-at", text: `· ${at}` }));
// What an answer did, in the same words everywhere: 보냈어요, and 보내지 않았어요 with 되돌리기 where the store can bring the draft back.
const rqSentToast = action => toast("보냈어요", false, action || null);
const rqDroppedToast = undo => toast("보내지 않았어요", false, undo ? { label: "되돌리기", onclick: undo } : null, undo ? 6000 : undefined);
// The 받는이 of a mail draft, folded to one text button under the body ("받는이 한서윤 · 답장"); it opens the rows of draftToNode in place. A draft with nobody to send to,
// or an address that is not one, stands open from the start. Once the owner presses the button, that choice stays.
const DR_ADDR = /^[^\s<>@,]+@[^\s<>@,]+\.[^\s<>@,]+$/;
const draftAddr = a => DR_ADDR.test(String(a).replace(/^.*<([^>]*)>\s*$/, "$1").trim());
function draftRecvFold(d, o = {}) {
  let open = null, bad = false, panel = null;   // open: null until the owner presses the button
  const text = el("span", { class: "rq-rs" }), btn = el("button", { class: "btn text sm rq-recv", type: "button", "aria-expanded": "false", onclick: () => { open = !(open ?? bad); sync(); } }, text, icon("drop"));
  const sync = () => { const on = open ?? bad; btn.setAttribute("aria-expanded", String(on)); if (panel) panel.hidden = !on; };
  const inner = draftToNode(d, { ...o, always: true, onpaint: live => {
    const first = rqRcptName(live.to[0]), more = live.to.length > 1 ? ` 외 ${live.to.length - 1}명` : "";
    bad = !live.to.length || live.to.some(a => !draftAddr(a));
    text.textContent = `받는이 ${first || "없음"}${more}${live.reply ? (live.mode === "all" ? " · 전체 답장" : " · 답장") : ""}${live.cc.length ? ` · 참조 ${live.cc.length}` : ""}`;
    sync();
  } });
  panel = el("div", { class: "rq-recvbox" }, inner);
  sync();
  return el("div", { class: "rq-recvfold" }, btn, panel);
}
// A mail draft's sheet (owner 2026-11-10): the same sheet as the 답장 확인 of a comment (30-replies.js rqSheetOpen) - one head, 답장 확인 and a close x - with the
// reply card's parts (10-reply-card.js rqMailParts) straight on the sheet and the choices in the footer. Only the body scrolls.
function mailSheetBody(dc, d, st, warnBox) {
  const open = String(dc.t || "").startsWith("mail:") ? el("button", { class: "btn text rq-open", type: "button", "data-k": "open", text: "열기", onclick: () => { dc.close(); go("monitoring", `c:${dc.t}`); } }) : null;
  const p = rqMailParts(d, { t: dc.t, at: dc.at, edit: !st, warn: warnBox, tail: [open] });
  return el("div", { class: "fs-body rq-sb", tabindex: "0", role: "region", "aria-label": "보낼 내용" },
    d.recipientWarning ? el("div", { class: "dr-warn dc-rw", role: "alert" }, el("span", { text: `받는이 확인: ${d.recipientWarning}` })) : null, decideNode(d), draftRuleNode(d),
    rqCard({ key: dc.key, ...p, body: { node: draftBodyNode(d.body, "dc-dr-b"), full: true }, extra: [draftOriginNode(d)] }));
}
