// The mail side of 모니터링 (30-monitoring.js): a mail's row, its summary lines, files, reply state, the list filters, the 초안 작성 box and the ⋯ actions.
// Everything here is a declaration (functions and constants read later by the screen), so loading before 30-monitoring.js is fine; nothing runs at load.
// A mail's short text for its row: the poster's summary, else the first lines of its body (hub/mail.ts keeps both), else the same taken from
// the conversation's first message the web already holds (a plugin that posts only sender and subject: the 요약 section the lane wrote, else
// the original's first lines; hub/mail.ts mailBriefOf does the same for the list), else nothing.
// It never repeats the sender or the subject: with nothing to summarize the row shows no third line.
const mailSkip = m => new Set([rcPlain(m.subject), rcPlain(`${m.from} · ${m.subject}`), rcPlain(m.from), rcPlain(mailSender(m.from))].filter(Boolean));
const mailLines = (s, skip) => String(s ?? "").split("\n").map(l => rcPlain(l).replace(/^(?:[-*•]|\d+[.)])\s+/, "").trim()).filter(l => l && !rcLabel(l) && !skip.has(l));
function mailFromMsg(text, skip) {
  const sp = rcSplit(text), sec = rcSections(sp.text).find(s => s.h === "요약"), own = sec ? mailLines(sec.body, skip).slice(0, 3) : [];
  return own.length ? own : mailLines(sp.raw, skip).slice(0, 3);
}
// The row's summary as parts: up to two points of 요약 when the summary is a bulleted list (else the first lines as one text), and the
// first thing to do from 할 일 unless it says 없음. 첨부 is the paperclip count, never repeated here.
const MAIL_BULLET = /^\s*(?:[-*•·]|\d+[.)])\s+/;
function mailParts(text, skip) {
  const secs = rcSections(String(text ?? "")), sum = secs.find(s => s.h === "요약") || secs.find(s => !s.h), todo = secs.find(s => s.h === "할 일" || s.h === "할일" || s.h === "다음 할 일");
  const bullets = sum ? sum.body.split("\n").filter(l => MAIL_BULLET.test(l)) : [];
  const points = bullets.length ? mailLines(bullets.join("\n"), skip).slice(0, 2) : [];
  const first = todo ? mailLines(todo.body, skip)[0] || "" : "";
  return { points, todo: /^없음/.test(first) ? "" : first, more: todo ? Math.max(0, mailLines(todo.body, skip).length - 1) : 0 };
}
const mailBrief = (m, t) => {
  const skip = mailSkip(m), own = mailLines(m.summary || m.preview, skip);
  if (own.length || !t) return own.join(" ");
  for (const e of ts(t).msgs) {
    if (!convIncoming(e)) continue;
    const lines = mailFromMsg(e.text, skip);
    if (lines.length) return lines.join(" ");
  }
  return "";
};
const mailSize = b => b >= 1048576 ? `${(b / 1048576).toFixed(1)}MB` : b >= 1024 ? `${Math.round(b / 1024)}KB` : b > 0 ? `${b}B` : "";
// The authenticated hub route of one attached file (hub/mail.ts mailFileRoute); dl=1 answers with Content-Disposition: attachment.
const mailFileUrl = (key, i, dl) => pqLink(`/api/mail/${enc(key)}/files/${i}${dl ? "?dl=1" : ""}`);
// The attachments of a mail in its original view: one row per file (name, size); the row itself is the download link, so it also saves
// in an installed app / on a phone, where a new tab would not.
// A mail's files without the pictures its body shows (hub/mail.ts inline: drawn in the original, not files); each keeps its own index.
const mailRealFiles = files => (files || []).map((f, i) => ({ f, i })).filter(x => !x.f.inline);
function mailFilesNode(key, files) {
  const real = mailRealFiles(files);
  if (!real.length) return null;
  return el("div", { class: "mr-files" }, el("div", { class: "mr-fh", text: `첨부 ${real.length}개` }), ...real.map(({ f, i }) =>
    el("a", { class: "mr-file", href: mailFileUrl(key, i, true), download: f.name, title: `${f.name} 내려받기`, "aria-label": `${f.name} 내려받기${f.size ? ` (${mailSize(f.size)})` : ""}` },
      icon("file"), el("span", { class: "mr-fname", text: f.name }), f.size ? el("span", { class: "mr-fsize", text: mailSize(f.size) }) : null, icon("download"))));
}
// The reply state of a mail's row. `m.suggest` is written by the reply-draft lane (hub/mail.ts setMailSuggest; stays absent while the install's
// reply-draft option is off or nothing was offered): { kind: "reply-draft", label, ref, state? }, `ref` = the draft id and `state` =
// "draft" (default: a draft waits for approval) | "sent" (the reply went out by itself) | "waiting" (a reply is expected, no draft yet).
// Without suggest nothing is drawn.
const MAIL_REPLY = { draft: ["답장 초안 있음", "warn"], sent: ["자동 답장 보냄", "ok"], waiting: ["답장 대기", ""] };
const mailReplyChip = sg => {
  if (!sg || typeof sg !== "object" || (sg.kind && sg.kind !== "reply-draft")) return null;
  const [text, tone] = MAIL_REPLY[sg.state || "draft"] || [];
  return text ? el("span", { class: `tag mr-reply${tone ? ` ${tone}` : ""}`, "data-slot": "suggest", text }) : null;
};
// The reply-state tag of a mail (hub/mail-state.ts mailLabel): an incoming mail's reply state (m.reply: needs | draft | replied | skipped | fyi),
// else none. Read / unread is never a state (a row has its own 안 읽음 N pill), and skipped / fyi are the same mark to the owner: 답장 안 함.
// An outgoing mail is 내가 보냄 in the thread list of a mail (30-mail-thread.js), where both directions sit together; a list row has no tag for it.
const MAIL_STATE = { needs: ["답장 필요", "warn"], draft: ["초안 있음", "warn"], replied: ["답장함", "ok"], skipped: ["답장 안 함", ""], fyi: ["답장 안 함", ""] };
const mailStateOf = m => m.dir === "out" ? ["내가 보냄", ""] : MAIL_STATE[m.reply] || ["", ""];
// An app whose conversation is a list of mails (메일 and its instances): newest on top, opened at the top.
const monMailList = it => !!(it && it.app && !it.mon && (it.listed || it.mails.some(t => MAILS.has(t))));
// The filter of the mail list: 전체 / 안 읽음 / 답장 필요 / 확인 대기 / 답장함 / 보낸 메일. A filter gets the mail and its conversation target.
// 확인 대기 holds no mail rows: it is the reply drafts waiting on the owner (owner 2026-10-27), and those approval cards show only there.
// 전체 is the received mail; what was sent is only under 보낸 메일 (owner 2026-10-28).
const MAIL_FILTERS = [["all", "전체", m => m.dir !== "out" && !m.archived], ["unread", "안 읽음", (m, t) => !m.archived && mailUnread(t, m)], ["owed", "답장 필요", m => m.dir !== "out" && !m.archived && (m.reply === "needs" || m.reply === "draft")], ["pending", "확인 대기", () => false], ["replied", "답장함", m => m.dir !== "out" && !m.archived && m.reply === "replied"], ["archived", "보관함", m => m.dir !== "out" && !!m.archived], ["sent", "보낸 메일", m => m.dir === "out"]];
// While the hub still holds older mails the loaded rows undercount; the whole mail app (all accounts) then shows the hub's count over every mail
// (GET /api/conversations counts.mail.filters). One account's list counts what is loaded until its pages are in.
const mailChipCount = (k, loaded) => {
  const all = CVP.more && CVP.counts && (typeof MX === "undefined" || MX.acct === "all") ? CVP.counts.mail.filters[k] : undefined;
  return typeof all === "number" ? Math.max(all, loaded) : loaded;
};
const mailFilterOf = () => MAIL_FILTERS.find(f => f[0] === MON.mailFilter) || MAIL_FILTERS[0];
// A reply draft still in the owner's hands: waiting for 보내기 / 고치기 / 보내지 않기, or being rewritten after 고치기 (a peer's too, as its plain report).
const mailDraftOpen = n => !!(n.decision && n.decision.draft) && drState(n.decision) === "open";
const mailDraftHeld = n => !!(n.decision && n.decision.draft) && ["open", "revising"].includes(drState(n.decision));
// The newest reply draft of each mail (and of each computer): a draft a newer one replaced for the same mail is stale and asks nothing.
// A draft of anything that is not a mail (an id-keyed decision) is its own.
const mailDraftKey = n => `${n.pc ? n.pc.url : ""}|${String(n.decision.to || "").startsWith("mail:") ? n.decision.to : `#${n.id}`}`;
function mailDraftLive(notices) {
  const newest = new Map();
  for (const n of notices) {
    if (!n.decision || !n.decision.draft) continue;
    const k = mailDraftKey(n), cur = newest.get(k);
    if (!cur || ntAt(n) > ntAt(cur) || (ntAt(n) === ntAt(cur) && String(n.ts) > String(cur.ts))) newest.set(k, n);
  }
  return newest;
}
// 보내지 않기 was answered: the card leaves every view, like a stale one. A sent or otherwise handled mail draft leaves the list too and is
// folded inside its mail's conversation (30-mail-sent.js).
const mailDraftDone = n => !!(n.decision && n.decision.draft) && String(n.decision.to || "").startsWith("mail:") && !mailDraftHeld(n);
const mailDraftGone = (n, newest) => !!(n.decision && n.decision.draft) && String(n.decision.to || "").startsWith("mail:") && (drState(n.decision) === "drop" || newest.get(mailDraftKey(n)) !== n);
// Opening a mail app while reply drafts wait lands on 확인 대기 (once per opening, so a filter the owner picks stays); with none waiting a
// left-over 확인 대기 goes back to 전체. It waits for the notices, so a draft that loads late still decides the landing.
function mailLand(sel) {
  if (!monMailList(sel)) { MON.land = ""; return; }
  if (MON.land === sel.key || !NT.loaded) return;
  MON.land = sel.key;
  const waiting = [...mailDraftLive(sel.notices).values()].some(mailDraftOpen);
  if (waiting) MON.mailFilter = "pending"; else if (MON.mailFilter === "pending") MON.mailFilter = "all";
}
// The head of the mail list is two rows (owner 2026-11-11): where the mail sits (받은 메일 / 보낸 메일 / 보관함, screen tabs) and, only in 받은 메일,
// the five ways to sift it. MON.mailFilter keeps its seven values; the place is read from it, and MON.mailIn is the sift 받은 메일 comes back to.
const MAIL_PLACES = [["in", "받은 메일"], ["sent", "보낸 메일"], ["archived", "보관함"]];
function mailFilterBar(mails, notices) {
  const cur = mailFilterOf()[0], place = cur === "sent" || cur === "archived" ? cur : "in";
  if (place === "in") MON.mailIn = cur;
  const count = (k, ok) => k === "all" ? 0 : k === "pending" ? [...mailDraftLive(notices).values()].filter(mailDraftOpen).length : mailChipCount(k, mails.filter(t => MAILS.has(t) && ok(MAILS.get(t), t)).length);
  const pick = k => () => { MON.mailFilter = k; MON.sig = ""; monSchedule(); };
  const tabs = segKeep(el("div", { class: "mx-tabs mr-place", role: "tablist", "aria-label": "메일 위치" }, ...MAIL_PLACES.map(([k, label]) =>
    el("button", { class: `mx-tab${k === place ? " on" : ""}`, type: "button", role: "tab", "aria-selected": String(k === place), "data-filter": k, onclick: pick(k === "in" ? MON.mailIn || "all" : k) },
      label, k === "in" ? null : cntSpan(`mail-filter:${k}`, "mr-fn", count(k, MAIL_FILTERS.find(f => f[0] === k)[2]))))));
  if (place !== "in") return [tabs];
  return [tabs, segKeep(el("div", { class: "mr-filter mr-mail", role: "tablist", "aria-label": "메일 보기" }, ...MAIL_FILTERS.filter(f => f[0] !== "archived" && f[0] !== "sent").map(([k, label, ok]) =>
    el("button", { class: `cchip mr-f${k === cur ? " on" : ""}`, type: "button", role: "tab", "aria-selected": String(k === cur), "data-filter": k, onclick: pick(k) }, label, cntSpan(`mail-filter:${k}`, "mr-fn", count(k, ok))))))];
}
// A mail or chat of an integration is its own conversation in 채팅. A mail is a Gmail-like flat row: sender and time on one line (with
// a paperclip and the file count when it has files), the subject with the reply-draft state beside it, and a one-line summary. The
// whole card is the way in: it opens the mail's conversation, where the original and its files are (11-todo-strip.js "mail").
// Every mail row has one layout: sender · reply-state tag (only when there is a reply state; the orange 미답장 pill while one is owed) · 안 읽음 N ·
// paperclip · time · ⋯. A mail conversation whose mail is gone (deleted) is no row at all.
// A mail row's time: today's clock, else the day alone ("1월 15일"); the open mail keeps the full date and time.
const mailRowWhen = t => !t || !Number.isFinite(Date.parse(t)) ? "" : kstDay(t) === kstDay(Date.now()) ? kstHM(t) : new Date(t).toLocaleDateString("ko-KR", { ...KST, month: "long", day: "numeric" });
function monConvNode(t, label) {
  const m = MAILS.get(t), last = CONV.get(t), n = m ? mailUnread(t, m) : ts(t).unread, open = () => go("monitoring", `c:${t}`);
  if (!m && isMailT(t)) return null;
  const [stateText, stateTone] = m && m.dir !== "out" ? mailStateOf(m) : ["", ""];
  // A mail is one item: unread is one mark, however many messages (the mail, the bot's note on it) its conversation holds unread.
  const tag = m ? (n ? el("span", { class: "tag warn mr-unread", text: "안 읽음" }) : null) : n ? el("span", { class: "tag warn", text: `안 읽음 ${n}` }) : ntHasDecision(t) ? el("span", { class: "tag warn", text: "답변 필요" }) : null;
  const stateTag = stateText ? (m.unreplied ? unrepPill(stateText) : el("span", { class: `tag mr-state${stateTone ? ` ${stateTone}` : ""}`, "data-state": stateText, text: stateText })) : null;
  // The 자동 초안 규칙 that drafted this mail (hub/mail.ts MailRecord.rule): its name, as a plain tag beside the reply state.
  const ruleTag = m && m.rule && m.dir !== "out" ? draftRuleTag(m.rule, "mr-rule") : null;
  // Why a mail is not 답장 필요: he is not its main recipient (hub/mail-state.ts replyExclusion: 참조로 받음, 단체 메일, 자동 발송, 다른 사람 앞).
  const whyTag = m && m.why && m.dir !== "out" && m.reply !== "replied" ? el("span", { class: "tag mr-why", "data-why": m.why, text: m.why }) : null;
  const files = m ? mailRealFiles(m.attachments).map(x => x.f) : [], brief = m ? mailBrief(m, t) : "", when = (m ? mailRowWhen : rcWhen)(last ? last.ts : m && m.at), chip = m && (m.dir === "out" || !m.reply || (m.suggest && m.suggest.state === "sent")) ? mailReplyChip(m.suggest) : null;
  const title = m ? m.subject || "(제목 없음)" : rcPlain(String(last ? last.text : "").split("\n").find(l => l.trim() && !/^\s*>/.test(l)) || "") || label;
  const clip = files.length ? el("span", { class: "mr-clip", title: `첨부파일 ${files.length}개`, "aria-label": `첨부파일 ${files.length}개` }, icon("clip"), String(files.length)) : null;
  return el("div", { class: `bm alert rc mr${m && n ? " mr-new" : ""}${m && MBOX.sel.has(t) ? " mr-sel" : ""}`, role: "button", tabindex: "0", "data-t": m ? t : null, "aria-label": `${m && n ? "안 읽음, " : ""}${title} ${m ? "원문 열기" : "대화 열기"}`, onclick: open,
    onkeydown: e => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(); } } },
    m && n ? el("span", { class: "dot pri mr-dot", "aria-hidden": "true" }) : null,
    el("div", { class: "rc-hd" }, m ? mbLead(t, title) : null, el("span", { class: "rc-src", text: m ? m.dir === "out" ? `나 → ${mailSender(m.to) || "받는 사람"}` : mailSender(m.from) || label : label }), ...mxSender(t), stateTag, whyTag, ruleTag, tag, clip, when ? el("span", { class: "rc-time", text: when }) : null, m && m.dir !== "out" ? mailDraftButton(t, "ib mr-draft") : null, mxMoveBtn(t), m ? mailMenuBtn(t, () => orgMailItem(t)) : null),
    el("div", { class: "rc-title", text: title }), chip,
    m && m.to ? el("div", { class: "mr-to", text: mailToText(m) }) : null,
    ...mailSumNodes(m, t, brief), ...(m ? orgMailRow(t) : []));
}
// The summary lines of a mail row: a bulleted 요약 as a two-point list, else the brief as one clamped text; then the first 할 일.
function mailSumNodes(m, t, brief) {
  if (!m) return brief ? [el("div", { class: "mr-sum", text: brief })] : [];
  const p = mailParts(m.summary || "", mailSkip(m));
  const sum = p.points.length ? el("ul", { class: "mr-sum mr-pts" }, ...p.points.map(x => el("li", { text: x }))) : brief ? el("div", { class: "mr-sum", text: brief }) : null;
  const todo = p.todo ? el("div", { class: "mr-todo" }, el("b", { text: "할 일" }), el("span", { text: p.more ? `${p.todo} 외 ${p.more}건` : p.todo })) : null;
  return [sum, todo].filter(Boolean);
}
// 초안 작성: the owner asks for a reply draft of this mail (POST /api/mail/<key>/draft, made behind the request); the draft arrives as the send-approval
// card in the mail's conversation. In a row and in the open mail's head.
const mailDraftAsk = async (t, btn, instruction = "") => {
  await api(`/api/mail/${t.slice(5)}/draft`, "POST", instruction ? { instruction } : {});
  toast("답장 초안을 만드는 중이에요");
  if (btn) { btn.disabled = true; if (!btn.classList.contains("ib")) btn.textContent = "만드는 중…"; }
};
// The sample in the 초안 작성 box, made from the summary the mail already has (hub/mail.ts MailRecord.summary: 요약, 할 일), no model call:
// the first 할 일, else the first point of 요약, decides which short example fits - one line of the box, with no clipped quote of the mail. "" without a summary (the fixed hint then).
function mailDraftSample(m) {
  if (!m || !m.summary) return "";
  const skip = mailSkip(m), p = mailParts(m.summary, skip), lead = p.todo || p.points[0] || mailLines(m.summary, skip)[0] || "";
  if (!lead) return "";
  if (p.todo) return "예: 이번 주 안에 처리하겠다고 써 줘";
  if (/일정|회의|미팅|약속|방문|참석/.test(lead)) return "예: 그 시간 괜찮다고 써 줘";
  if (/요청|문의|부탁|검토|확인|회신|답변|제안/.test(lead)) return "예: 확인하고 금요일까지 답한다고 써 줘";
  return "예: 잘 받았다고 짧게 써 줘";
}
// 초안 작성 asks first what the reply should say (owner 2026-10-28); an empty box makes the draft on its own, as before. Above the box: the mail
// it answers (sender, subject, the row's summary lines), so the owner writes the instruction without going back to the mail.
function mailDraftDialog(t, btn) {
  const m = MAILS.get(t), sample = mailDraftSample(m);
  const ta = el("textarea", { class: "fi", rows: "3", maxlength: "500", "data-k": "draft-instruction", "aria-label": "초안에 넣을 내용",
    placeholder: sample || "예: 금요일까지 보내 드린다고 써 줘" });
  const ctx = m ? el("div", { class: "md-ctx", "data-k": "draft-mail" },
    el("div", { class: "md-from" }, icon("mail"), el("span", { text: mailSender(m.from) || m.from || "보낸 사람 없음" })),
    el("div", { class: "md-subj", text: m.subject || "(제목 없음)" }),
    ...mailSumNodes(m, t, mailBrief(m, t))) : null;
  const go = (close, b) => busy(b, async () => { close(); await mailDraftAsk(t, btn, ta.value.trim()).catch(e => toast(e.message || "초안을 요청하지 못했어요", true)); });
  const d = dialog({ title: "답장 초안", body: el("div", { class: "col md-dlg" }, ctx,
      el("div", { class: "md-ask" }, el("div", { class: "md-lbl", text: "어떻게 답할까요?" }), ta, el("div", { class: "sup", text: "비워 두면 알아서 써요" }))),
    actions: [{ label: "초안 만들기", kind: "pri", onclick: (close, b) => go(close, b) }] });
  d.node.classList.add("md-d");
  ta.addEventListener("keydown", ev => { if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey) && !ev.isComposing) { ev.preventDefault(); d.node.querySelector(".dact .btn:last-child").click(); } });
  ta.focus();
}
const mailDraftRun = (t, b) => mailDraftDialog(t, b);
// A row has the icon alone (cls "ib mr-draft", its name in aria-label and title); the open mail's head keeps the word.
const mailDraftButton = (t, cls = "cchip mr-act mr-draft") => { const bare = /\bib\b/.test(cls); return el("button", { class: cls, type: "button", "data-k": "mail-draft", "aria-label": "초안 작성", title: "초안 작성", onclick: ev => { ev.stopPropagation(); mailDraftDialog(t, ev.currentTarget); }, onkeydown: ev => ev.stopPropagation() }, icon("pencil"), bare ? null : "초안 작성"); };
// 답장 안 함 / 답장 필요로 표시: the owner's own mark (POST / DELETE /api/mail/<key>/fyi, recorded as his with the time; a peer's mail on the computer
// that holds it: 34-peer-monitoring.js pqRoute). The row, its tag, the filter counts and the app badges change at once; 답장 안 함 drops the mail's
// waiting reply draft (확인 대기). 답장 필요로 표시 works from no state, from 답장 안 함 and from 답장함 (it needs another answer).
async function mailSetFyi(t, on) {
  const pc = pqPc(t);
  await api(`/api/mail/${t.slice(5)}/fyi`, on ? "POST" : "DELETE", on ? {} : undefined);
  const m = MAILS.get(t);
  if (m) { m.reply = on ? "fyi" : m.reply === "draft" ? "draft" : "needs"; m.unreplied = !on; }
  document.querySelectorAll(".mtop-fyi").forEach(mailFyiPaint);
  MON.sig = ""; MON.side = ""; monSchedule();
  toast(on ? "답장 안 함으로 표시했어요" : "답장 필요로 표시했어요", false, on ? { label: "되돌리기", onclick: () => busy(null, () => mailSetFyi(t, false)) } : undefined);
  await Promise.allSettled([pc ? pqLoad() : convLoad(), loadIntegrations(), pc ? null : loadNotices()]);
}
// The actions of a mail, one list for the ⋯ of every mail card and for the buttons of every row. Incoming: 초안 작성, then 답장 안 함 while a reply
// is owed (답장 필요 / 초안 있음) or 답장 필요로 표시 in any other state, then 삭제. Outgoing: 삭제. The one rule for a row's buttons: every incoming row
// has the 초안 작성 pencil beside its ⋯, without a tap on the ⋯ (owner 2026-10-29); the row stays one Gmail-like row (owner 2026-11-03), so the rest is in the ⋯.
const MAIL_ACT = { draft: "초안 작성", no: "답장 안 함", need: "답장 필요로 표시", delete: "삭제" };
const mailOwed = m => m.dir !== "out" && (m.reply === "needs" || m.reply === "draft");
const mailActs = m => m.dir === "out" ? ["delete"] : ["draft", mailOwed(m) ? "no" : "need", "delete"];
const mailActRun = (t, a, b) => a === "draft" ? mailDraftRun(t, b) : a === "delete" ? mailDelete(t) : mailSetFyi(t, a === "no");
// 삭제: the mail leaves dotz on the computer that holds it (DELETE /api/mail/<key>); the real mailbox keeps it, unless the app's 삭제하면 원본도 삭제 is on (mbTrash). A newer message of the thread brings it back.
async function mailDelete(t) {
  if (mailOriginal(t)) return mbTrash([t]);
  if (!await ask("메일 삭제", `이 메일을 목록에서 지워요. ${mailStays(1)}`, "삭제", true)) return;
  const pc = pqPc(t);
  await api(`/api/mail/${t.slice(5)}`, "DELETE");
  MAILS.delete(t); CONV.delete(t);
  const p = pc && PQ.list.find(x => x && x.url === pc.url);
  if (p && p.items) p.items.conversations = (p.items.conversations || []).filter(c => String(c.target) !== t);
  if (monCtx === t && current === "chat") go("monitoring", MON.sel);   // deleted from its open conversation: back to the list
  PQ.of.delete(t); MON.sig = ""; MON.side = ""; monSchedule();
  toast("메일을 목록에서 지웠어요");
  await Promise.allSettled([pc ? pqLoad() : convLoad(), loadIntegrations(), pc ? null : loadNotices()]);
}
// The ⋯ at the top right of a mail row: mailActs, built from the mail's state at the tap. `extra()`: more items ({ value, label, run }) after them,
// as the row's 원문 보기.
function mailMenuBtn(t, extra = () => []) {
  return el("button", { class: "ib mr-more", type: "button", "aria-label": "메일 메뉴", title: "메일 메뉴", "aria-haspopup": "listbox", "aria-expanded": "false", "data-k": "mail-menu", onclick: ev => {
    ev.stopPropagation();
    const b = ev.currentTarget, m = MAILS.get(t) || {};
    const more = extra();
    showMenu(b, [...mailActs(m).map(a => ({ value: a, label: MAIL_ACT[a] })), ...more.map(x => ({ value: x.value, label: x.label }))], { onPick: v => { const x = more.find(i => i.value === v); if (x) x.run(); else busy(null, () => mailActRun(t, v, null)); } });
  }, onkeydown: ev => ev.stopPropagation() }, icon("more"));
}
