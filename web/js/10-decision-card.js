/* ---------- decision card: a question that waits on the owner, docked above the composer ---------- */
// Choice block (MODE.md "Message layout"): `**1) name**`, then one description line; a `결정:` line titles a block.
// Several blocks = several decisions: the card walks them one at a time and sends the numbers as "1-2".
const CH_OPT = /^\s*(?:\*\*)?\s*(\d+)\)\s*(.+?)\s*(?:\*\*)?\s*$/;
// Older messages, and gateways on an older version, still mark one option as recommended. Mirrors stripRecommendMark in hub/choices.ts.
function stripRecMark(text) { return text.replace(/^([ \t]*>?[ \t]*(?:\*\*)?[ \t]*\d{1,2}(?:\)|\.[ \t]).*?)[ \t]*(?:(?:←|<-)[ \t]*(?:추천|recommended)|\([ \t]*(?:추천|권장|recommended)[ \t]*\))/gim, "$1"); }
const CH_HEAD = /^\s*(?:\*\*)?\s*(?:결정|decision(?: needed)?)(?:\s*#?\d{1,2})?\s*[:：]\s*(.*?)\s*(?:\*\*)?\s*$/i;
const CH_CLOSE = /번호(?:로|를).*(?:답|알려)/;
// An option that needs detail (tap opens a text field; the answer goes out as `n) label - <text>`): the bot marks it with a trailing ` …` on the name
// (stripped from the label), or it is guessed from a negative / edit label or a description that asks for text. Mirrors hub/choices.ts detailOf.
const DETAIL_MARK = /\s*…\s*$/, DETAIL_LABEL = /^(?:안\s*됨|안\s*돼|아니|아냐|고치기|수정|다른)/, DETAIL_DESC = /(?:적어|알려|써|말해)\s*(?:주|줘|달라|세요)|내용.*(?:적|알려|써)/;
const detailOf = o => !!o.detail || DETAIL_LABEL.test(o.label) || DETAIL_DESC.test(o.desc || "");
const CH_FENCE = /^\s*```/;
const isDescLine = nx => nx !== undefined && !!nx.trim() && !/^\s*\[file\]\s+\S/.test(nx) && !CH_OPT.test(nx) && !CH_HEAD.test(nx) && !CH_CLOSE.test(nx) && !CH_FENCE.test(nx);
// The message text without its option lines (and their description lines): the buttons show them, so the body must not repeat them.
function stripChoices(text) {
  const lines = stripRecMark(String(text ?? "")).split("\n"), out = [];
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    if (CH_FENCE.test(lines[i])) fence = !fence;
    if (fence || CH_FENCE.test(lines[i]) || !CH_OPT.test(lines[i])) { out.push(lines[i]); continue; }
    if (isDescLine(lines[i + 1])) i++;
  }
  return out.filter(l => !CH_CLOSE.test(l)).join("\n").replace(/\n{3,}/g, "\n\n");
}
// A body whose card shows the options: the question line loses its "결정:" label, and goes when `title` (the card's head) already says it. Text without an inline card reads as a sentence.
const choiceBody = (text, title) => stripChoices(text).split("\n").flatMap(l => { const q = (CH_HEAD.exec(l) || [])[1]; return q === undefined ? [l] : q && q !== title ? [q] : []; }).join("\n").trim();
// Text on a surface that holds no options (a notice that is no decision, a report card): a choice block goes whether or not its question is still open; any other numbered list stays.
function choiceFree(text) {
  const t = String(text ?? "").replace(/^[ \t]*\d{1,2}\.[ \t]+(?=(?:\*\*)?[ \t]*결정[ \t]*[:：])/gm, "");   // text that never passed the hub (a peer's message) can number its heads
  return parseChoices(t).blocks.length ? choiceBody(t) : text;
}
// The message body above its inline card (dcInline): the card holds the question and the options, so neither stays as text. Text outside the blocks stays, code fences whole.
function inlineBody(text) {
  const lines = stripRecMark(String(text ?? "")).split("\n"), out = [];
  let fence = false, block = false;
  for (let i = 0; i < lines.length; i++) {
    if (CH_FENCE.test(lines[i])) { fence = !fence; block = false; }
    else if (!fence && CH_HEAD.test(lines[i]) && CH_OPT.test(lines.slice(i + 1).find(l => l.trim()) || "")) { block = true; continue; }
    else if (!fence && block && CH_OPT.test(lines[i])) { if (isDescLine(lines[i + 1])) i++; continue; }
    else if (!fence && CH_CLOSE.test(lines[i])) continue;
    else if (lines[i].trim()) block = false;
    out.push(lines[i]);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
function parseChoices(text) {
  const OPT = CH_OPT, HEAD = CH_HEAD;
  const lines = stripRecMark(String(text ?? "")).replace(/^\s*\[[^\]\n]+\][ \t]*/, "").split("\n");
  let i = 0, question = "", cur = null;
  while (i < lines.length && !lines[i].trim()) i++;
  if (i < lines.length && !OPT.test(lines[i]) && !HEAD.test(lines[i])) question = lines[i++].trim();
  const blocks = [];
  let fence = false;
  for (; i < lines.length; i++) {
    if (CH_FENCE.test(lines[i])) { fence = !fence; continue; }
    if (fence) continue;
    const h = HEAD.exec(lines[i]);
    if (h) { cur = { title: h[1].trim(), options: [], headed: true }; blocks.push(cur); continue; }
    const m = OPT.exec(lines[i]);
    if (!m) continue;
    const n = Number(m[1]);
    if (!cur || (cur.options.length && n <= cur.options[cur.options.length - 1].n)) { cur = { title: "", options: [] }; blocks.push(cur); }
    let desc = "";
    const nx = lines[i + 1];
    if (isDescLine(nx)) { desc = nx.trim(); i++; }
    const raw = m[2].replace(/^\*+|\*+$/g, "").trim();
    cur.options.push({ n, label: raw.replace(DETAIL_MARK, "").trim(), desc, ...(DETAIL_MARK.test(raw) ? { detail: true } : {}) });
  }
  // Only a block a "결정:" line opened holds options (mirrors hub/choices.ts parseDecisions): a numbered or bold list in the body is text.
  return { question, blocks: blocks.filter(b => b.headed && b.options.length) };
}
// Buttons for a message with the [ask] marker, or with any other marker (or none) when it holds a "결정:" choice block of 2+ options
// (same rule as hub/notices.ts decisionsOf): a plain reply with a bare "1)" list stays text. The gateway's own alert keeps its looser rule.
const isChoiceMsg = pc => pc.blocks.some(b => b.options.length > 1);
const isHeadedChoice = pc => pc.blocks.some(b => b.headed && b.options.length > 1);
const choiceAsks = (e, tone, pc) => tone === "ask" || isHeadedChoice(pc) || (e.kind === "out" && e.source === "gateway" && e.target === "alert" && isChoiceMsg(pc));
const DC = { cur: null, picks: {}, step: {}, fold: {}, st: {}, edit: {}, fresh: "", note: {}, files: {}, fbusy: {}, undo: {} };   // files: uploads picked in 직접 수정 (sent as the answer's `files`), fbusy: one is going up
// A draft waiting for send approval (hub/draft-approval.ts): the notice carries it, the sheet shows it above 보내기 / 고치기 / 보내지 않기.
const DRAFT_EDIT = "고치기", DRAFT_OWN = "어떻게 보낼지 직접 입력";
// The draft options that carry the owner's text: 고치기 (what to change) and the send mode 직접 입력 (how to send). Mirrors hub draftNeedsText.
const draftAsksText = o => o.label === DRAFT_EDIT || o.label === DRAFT_OWN;
const hashOf = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };
// What the target waits on: a session's pendingAsk, else its last bot message when that is an [ask] with a choice block and no
// owner message came after it. Null when nothing waits (so the card goes away once the answer lands).
// Several decisions of one message are answered one by one (owner 2026-11-04): each open notice of the group is a block, a pick answers that
// notice at once and the block leaves the card; the rest wait. A newer question of the conversation takes the dock first.
// An open question with buttons stays here too once later messages pushed it up (decisionOne reads only the newest), until the owner answers its notice.
const dcGone = t => isLaneT(t) && (i => i.known && !i.alive && !i.resumable)(targetInfo(t));   // a session that ended takes no answer
const DC_GONE = "이 세션이 끝나서 답을 보낼 수 없어요";
function decisionGroup(t) {
  if (dcGone(t)) return null;
  const open = NT.items.filter(n => ntOpenDec(n) && !n.pc && !n.decision.draft && !n.decision.assumed && n.decision.options.length && n.decision.to === t && n.decision.reply_to);
  if (!open.length) return null;
  const at = open.map(n => n.decision.reply_to).sort().pop(), mine = open.filter(n => n.decision.reply_to === at), lone = mine.every(n => n.decision.group === 1);
  // A lone question keeps the key its message gave it (decisionOne): a later message hands the card over to here, and the reason being typed
  // (DC.edit/note, per key) stays, so its field is not rebuilt and the phone keyboard does not go down.
  const m = lone && ts(t).msgs.find(e => e.ts === at && !e.update_key);
  return { key: m ? `${t}|${hashOf(parseTone(noHandoff(String(m.text ?? ""))).text.trim())}` : `${t}|g:${at}`, t, sig: `g:${at}`, at, each: true, lone, question: mine.length === 1 ? ntPlain(mine[0].title) : "", blocks: mine.map(n => ({ title: ntPlain(n.title), options: n.decision.options, nd: n })) };
}
function decisionOf(t) {
  if (isRelayT(t)) return null;   // another computer's text never becomes a card to answer here
  const one = decisionOne(t), grp = decisionGroup(t);
  if (!grp || !one) return grp || one;
  return grp.lone || msOf(one.at) > msOf(grp.at) ? one : grp;
}
// A peer gateway's line (dotz_peer send, a handoff) sits in the conversation as a message, but the owner did not say it. Mirrors hub ownerReplied.
const ownerSaid = e => OWNER.has(e.kind) && !peerMsgOf(e);
function decisionOne(t) {
  if (!S) return null;
  const info = targetInfo(t), s = ts(t);
  if (dcGone(t)) return null;
  let raw = "", at = "";
  if (info.ask) { raw = String(info.ask.text); at = info.ask.at || ""; }
  else {
    for (let k = s.msgs.length - 1; k >= 0; k--) {
      const e = s.msgs[k];
      if (ownerSaid(e)) return null;
      // An alert or worklog post is not part of the conversation: it never cancels a question that still waits (the real case: a token-audit
      // alert and the night worklog landed after a decision, the card went away and the buttons greyed while the notice still held it open).
      if ((e.kind !== "out" && e.kind !== "lane_report") || e.update_key) continue;
      const p = parseTone(noHandoff(String(e.text ?? ""))), choice = choiceAsks(e, p.tone, parseChoices(p.text));
      // In 알림 / 작업 기록 an ordinary post is not a reply: it never cancels a question that still waits above it.
      if (isFixedT(t) && p.tone !== "ask" && !choice) continue;
      // A session's own message in its chat counts only as a choice block; its [ask] is the session's pendingAsk (above).
      if (typeof e.source === "string" && e.source.startsWith("lane:") && !(isLaneT(t) && p.tone !== "ask" && choice)) continue;
      if (p.tone !== "ask" && !choice) return null;
      raw = String(e.text ?? ""); at = e.ts; break;
    }
    if (!raw) return null;
  }
  const pt = parseTone(noHandoff(raw)), body = pt.text, pc = parseChoices(body);
  if (!info.ask && !pc.blocks.length) return null;
  if (at && s.msgs.some(e => ownerSaid(e) && msOf(e.ts) > msOf(at))) return null;
  // Its notices settle wherever it is answered (here, the 모니터링 queue, a draft sent or dropped there: hub/notices.ts settleHandledDrafts),
  // with no owner message in this conversation: once none of them is open the message no longer waits.
  if (at && !info.ask && dcSettledAt(t, at)) return null;
  const sig = hashOf(body.trim());
  // A status message ([done] ...) that ends in a choice block: its first line is the status, so the block's own title is the question.
  const question = !info.ask && pc.blocks.length === 1 && pc.blocks[0].title ? pc.blocks[0].title : pc.question;
  return { key: `${t}|${sig}`, t, sig, at, question, blocks: pc.blocks };
}
const dcSettledAt = (t, at) => {
  const ns = NT.items.filter(n => ntIsDec(n) && !n.pc && n.decision.to === t && n.decision.reply_to === at);
  return ns.length > 0 && !ns.some(ntOpenDec);
};
async function answerDecision(dc, text, opt, note) {
  const t = dc.t, lane = isLaneT(t) ? laneOf(t) : "";   // the card's own conversation: the notice sheet may answer for one that is not on screen
  const files = DC.files[dc.key] || []; delete DC.files[dc.key];
  DC.st[dc.key] = "sending"; paintDecision();
  try {
    // A card with one block whose question is a decision notice answers through the notice path (30-notices.js), so both stay in step.
    const nd = opt && dc.blocks.length === 1 ? ntFor(t, dc.at, opt) : null;
    const held = nd ? await ntPost(nd, opt.n, note, files, opt.label) : null;
    // The agent gets the question with each chosen option and the asking message (hub/intake.ts decisionLines); the bubble stays short.
    const pk = DC.picks[dc.key] || [], picks = dc.blocks.flatMap((b, i) => (pk[i] ? [{ q: b.title || dc.question || "", n: pk[i].n, label: pk[i].label, ...(pk[i].note && !dc.draft ? { note: pk[i].note } : {}) }] : []));
    const r = nd ? null : await api("/api/message", "POST", { text, ...(files.length ? { files } : {}), ...(picks.length ? { picks } : {}), ...(dc.at ? { reply_to: dc.at } : {}), ...(lane ? { lane } : {}), ...(isProjT(t) ? { project: projOf(t) } : {}), ...(isMailT(t) ? { mail: mailOf(t) } : {}), ...(isFixedT(t) ? { conv: t } : {}), ...(isWorking(t) ? { mode: "steer" } : {}) });
    if (r && r.queued) { QUEUE = QUEUE.filter(i => i.id !== r.queued.id).concat(r.queued); renderQueue(); }
    DC.st[dc.key] = held && held.state === "undo" && dc.draft ? dcUndoStart(dc, held) : "sent"; delete DC.edit[dc.key]; delete DC.note[dc.key];
    if (t === target) { chatStick = true; scrollChat(true); }
  } catch (e) { delete DC.st[dc.key]; if (dc.blocks.length === 1) delete DC.picks[dc.key]; toast(e.message, true); }   // a lone question lets go of the chosen row; several keep their picks, so a retry does not start the card over
  paintDecision();
}
// A draft asks for text on 고치기 only; any other decision on an option that needs detail (안 됨 …): what to change / why is typed first, nothing is sent before.
const needsNote = (dc, opt) => (dc.draft ? draftAsksText(opt) : detailOf(opt));
const pickSay = o => `${o.n}) ${o.label}${o.note ? ` - ${o.note}` : ""}`;
function pickOption(dc, bi, opt, note) {
  if (DC.st[dc.key]) return;
  // A mail whose files disagree with its words is not sent by 보내기: the owner is shown what is off and 이대로 보내기 is the pick that sends it (cancel keeps the card).
  const asIs = dc.draft && (dc.draft.attachIssues || []).length && dc.blocks[bi] && dc.blocks[bi].options.find(o => o.label === "이대로 보내기");
  if (asIs && opt.label === "보내기" && !opt.sure) { ask("첨부를 확인해 주세요", `${dc.draft.attachIssues.join(" · ")}. 이대로 보낼까요?`, "이대로 보내기").then(ok => { if (ok) pickOption(dc, bi, { ...asIs, sure: true }, note); }); return; }
  if (dc.draft && (dc.draft.warning || (dc.draft.attachments || []).length) && opt.label === "보내기" && !opt.sure) { drfSure(dc.draft, dc.t).then(ok => { if (ok) pickOption(dc, bi, { ...opt, sure: true }, note); }); return; }
  // fresh: the paint that draws the field this tap opened gives it the focus, once; a later live repaint never takes the focus
  if (!note && needsNote(dc, opt)) { DC.edit[dc.key] = { bi, opt }; DC.fresh = dc.key; paintDecision(); return; }
  const p = DC.picks[dc.key] || [];
  DC.picks[dc.key] = p;
  p[bi] = note ? { ...opt, note } : opt;
  delete DC.edit[dc.key]; delete DC.note[dc.key];
  if (dc.each) { answerEach(dc, bi, opt, note); return; }
  // Several decisions (owner 2026-11-01): a pick only marks that decision (and can be changed); nothing goes out until 보내기 (dcSendAll).
  if (dc.blocks.length > 1) { paintDecision(); return; }
  answerDecision(dc, pickSay(p[0]), p[0], note);
}
async function answerEach(dc, bi, opt, note) {
  DC.st[dc.key] = "sending"; paintDecision();
  try { await ntPost(dc.blocks[bi].nd, opt.n, note, DC.files[dc.key], opt.label); delete DC.files[dc.key]; } catch (e) { toast(e.message, true); }
  delete DC.picks[dc.key]; delete DC.step[dc.key];
  // The last question of the card answered: it leaves through dcLeave (fades, then goes) like any answered card; the others still wait on the card.
  if (decisionOf(dc.t)) delete DC.st[dc.key]; else DC.st[dc.key] = "sent";
  paintDecision();
}
function dcSendAll(dc) {
  const p = DC.picks[dc.key] || [];
  if (DC.st[dc.key] || dc.blocks.some((_, i) => !p[i])) return;
  answerDecision(dc, `결정 답: ${dc.blocks.map((_, i) => pickSay(p[i])).join(" · ")}`);
}
// Every decision of a several-decision card at once, each with its title and options, then one 보내기 that is on once each has a pick.
function multiNodes(dc, picks, st) {
  const got = dc.blocks.filter((_, i) => picks[i]).length, all = got === dc.blocks.length;
  return [...dc.blocks.flatMap((b, i) => [el("div", { class: "dc-sub", text: `${picks[i] ? "✓ " : ""}${b.title || `결정 ${i + 1}`}` }), ...b.options.map(o => choiceRow(dc, i, o, picks, st))]),
    dc.each ? null : el("button", { class: "btn dc-send", type: "button", disabled: !!st || !all, onclick: () => dcSendAll(dc) }, all ? "보내기" : `보내기 (${got}/${dc.blocks.length} 선택)`)].filter(Boolean);
}
// The files a draft sends along (hub/draft-approval.ts `> 첨부:` lines): one row per file, the row opens the file that will go out
// (GET /api/drafts/<ref>/files/<n>, hub/draft-files.ts; through the peer proxy for a peer's draft). `첨부 없음` = the mail it answers had
// files and this reply carries none; `warning` = the text says it sends a file but none is set (it goes away once a file is added).
// A mail reply draft of reply-drafts can change its files here (hub/draft-attach.ts): 파일 추가 = a file of this device or of the mail
// app's 첨부 파일 폴더, x = take one off. The live list (DRF.st) replaces the one written in the message. o.t = the draft's conversation
// (a peer's draft is changed on its own computer), o.edit false = read only, o.warn = a box the warning is drawn into instead of under the files.
const DR_IMG = /\.(png|jpe?g|gif|webp|avif|heic)$/i;
const DRF = { st: {}, pc: {}, menu: {}, lib: {}, busy: {}, add: {}, wait: {} };
const DRF_WIRE_MAX = 10 * 1024 * 1024;
const drfPath = (ref, tail) => `/api/drafts/${enc(ref)}/${tail}`;
const drfNone = { files: [], canAttach: false, library: false, editable: false, failed: true };
function drfLoad(ref) {
  return DRF.wait[ref] ||= api(drfPath(ref, "files")).then(r => { DRF.st[ref] = r && Array.isArray(r.files) ? r : drfNone; }, () => { DRF.st[ref] = drfNone; }).finally(() => { delete DRF.wait[ref]; });
}
async function drfWrite(ref, body) {
  const r = await api(drfPath(ref, "files"), "POST", body);
  DRF.st[ref] = { files: r.files, canAttach: r.canAttach, library: r.library, editable: r.editable, attachIssues: r.attachIssues };
}
const drfBase64 = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.onerror = () => no(r.error); r.readAsDataURL(f); });
async function drfUpload(ref, f) {
  if (DRF.pc[ref]) {
    if (f.size > DRF_WIRE_MAX) throw new Error("다른 컴퓨터의 초안에는 10MB 이하 파일만 붙일 수 있어요");
    return drfWrite(ref, { name: f.name, data: await drfBase64(f) });
  }
  return drfWrite(ref, { upload: await uploadFile(f) });
}
// One file to this gateway's uploads (hub/files.ts): the record that a draft's 첨부 or a message's `files` names.
async function uploadFile(f) {
  if (upTooBig(f.size)) throw new Error(upTooBig(f.size));
  return uploadXhr(f, f.name).done;
}
// 보내기 on a draft whose mail account cannot send files: the owner is asked once more (resolves true to go on).
async function drfSure(d, t) {
  const ref = d.ref;
  if (!ref || d.toLabel !== "받는이") return true;
  if (!DRF.st[ref]) { DRF.pc[ref] = t ? pqPc(t) : null; await drfLoad(ref); }
  const st = DRF.st[ref];
  if (st.tracked === false && (d.attachments || []).length) return ask("첨부를 확인하지 못했어요", `${iGa(botName)} 붙인 파일이 아니라서 실제로 가는지 몰라요. 보낼까요?`, "그래도 보내기");
  return !(st.editable && !st.canAttach && (st.files.length || d.warning)) || ask("첨부 없이 보낼까요?", "이 계정은 파일을 못 보내요. 본문만 가요.", "그래도 보내기");
}
function draftFilesNode(d, o = {}) {
  const ref = d.ref, box = el("div", { class: "dr-files" });
  if (ref) DRF.pc[ref] = o.t ? pqPc(o.t) : null;
  const pickers = el("input", { type: "file", multiple: true, hidden: true, "aria-label": "파일 고르기" });
  const run = async job => {
    DRF.busy[ref] = true; paint();
    try { await job(); } catch (e) { toast(e instanceof TypeError ? "연결이 끊겨 처리하지 못했어요" : e.message, true); }
    DRF.busy[ref] = false; paint();
  };
  const addAll = list => run(async () => { for (const f of list) await drfUpload(ref, f); DRF.menu[ref] = ""; });
  if (ref) DRF.add[ref] = addAll;   // 직접 수정 of the same card (editNode) stages its files through the newest list of this draft
  pickers.onchange = () => { const list = [...pickers.files]; pickers.value = ""; addAll(list); };
  const openLib = async () => {
    DRF.menu[ref] = DRF.menu[ref] === "lib" ? "" : "lib"; paint();
    if (DRF.menu[ref] !== "lib" || DRF.lib[ref]) return;
    try { DRF.lib[ref] = (await api(drfPath(ref, "library"))).items; } catch (e) { DRF.lib[ref] = []; toast(e.message, true); }
    paint();
  };
  function paint() {
    const st = ref ? DRF.st[ref] : null, live = !!st && !st.failed && st.tracked !== false;
    // Files named in the message that dotz did not stage itself: the names stand, with a plain line saying the session attaches them.
    const named = !!st && st.tracked === false && Array.isArray(d.attachments) && d.attachments.length > 0;
    const fl = live ? st.files : Array.isArray(d.attachments) ? d.attachments : [];
    const can = live && st.editable && o.edit !== false, busy = !!DRF.busy[ref];
    const warn = d.warning && !fl.length;
    const noSend = live && st.editable && !st.canAttach && (fl.length || d.warning);
    const issues = live && st.attachIssues ? st.attachIssues : d.attachIssues || [];
    const warns = [
      issues.length ? el("div", { class: "dr-warn", role: "alert" }, icon("clip"), el("span", { class: "dr-wt" }, el("span", { text: "첨부 확인" }), el("span", { class: "dr-wn", text: issues.join(" · ") }))) : null,
      warn && !issues.length ? el("div", { class: "dr-warn", role: "alert" }, icon("clip"), el("span", { class: "dr-wt" }, el("span", { text: d.warning }), d.note ? el("span", { class: "dr-wn", text: d.note }) : null)) : null,
      noSend ? el("div", { class: "dr-none" }, icon("clip"), el("span", { text: "이 계정은 파일을 못 보내요 · 본문만 가요" })) : null];
    const rows = fl.map((f, i) => {
      const ext = (String(f.name).match(/\.([A-Za-z0-9]{1,5})$/) || [0, ""])[1].toUpperCase(), meta = [ext, f.size].filter(Boolean).join(" · ");
      const kids = [el("span", { class: "dr-fi" }, icon(DR_IMG.test(f.name) ? "image" : "file")), el("span", { class: "dr-fn", text: f.name }), meta ? el("span", { class: "dr-fm", text: meta }) : null];
      const link = ref && !named ? el("a", { class: "dr-att", href: pqLink(drfPath(ref, `files/${i}`)), target: "_blank", rel: "noopener", title: `${f.name} 열기`, "aria-label": `${f.name} 열기${f.size ? ` (${f.size})` : ""}` }, ...kids, icon("open")) : el("div", { class: "dr-att" }, ...kids);
      return can ? el("div", { class: "dr-ar" }, link, el("button", { class: "dr-x", type: "button", disabled: busy, title: "첨부에서 빼기", "aria-label": `${f.name} 빼기`, onclick: () => run(() => drfWrite(ref, { remove: i })) }, icon("close"))) : link;
    });
    const items = DRF.lib[ref] || [];
    const lib = can && DRF.menu[ref] === "lib" ? el("div", { class: "dr-lib", role: "list" }, ...(items.length ? items.map(it => el("button", { class: "dr-li", type: "button", role: "listitem", disabled: busy, title: it.rel, onclick: () => run(async () => { await drfWrite(ref, { library: it.rel }); DRF.menu[ref] = ""; }) },
      el("span", { class: "dr-fn", text: it.rel }), it.match ? el("span", { class: "dr-hit", text: "맞음" }) : null, el("span", { class: "dr-fm", text: it.size }))) : [el("div", { class: "dr-none", text: DRF.lib[ref] ? "폴더가 비어 있어요" : "불러오는 중…" })])) : null;
    const menu = can && DRF.menu[ref] === "menu" ? el("div", { class: "dr-menu" },
      el("button", { class: "btn tonal", type: "button", onclick: () => pickers.click() }, "이 기기에서 고르기"),
      st.library ? el("button", { class: "btn tonal", type: "button", onclick: openLib }, "첨부 파일 폴더에서 고르기") : null) : null;
    const add = can && st.canAttach ? el("button", { class: "dr-add", type: "button", disabled: busy, "aria-expanded": String(!!DRF.menu[ref]), onclick: () => { if (!st.library) pickers.click(); else { DRF.menu[ref] = DRF.menu[ref] ? "" : "menu"; paint(); } } }, icon("clip"), el("span", { text: busy ? "붙이는 중…" : "파일 추가" })) : null;
    if (o.warn) { clear(o.warn).append(...warns.filter(Boolean)); o.warn.hidden = !warns.some(Boolean); }
    // A mail draft with no file shows no 첨부 band (owner 2026-11-10): the 파일 추가 button stands alone; a file, or a real problem, is still listed.
    const mailDraft = d.toLabel === "받는이";
    // o.live (the mail of a combined card, read only): the list is read from the staged files, so a ✓ says they are on the mail.
    clear(box).append(...[fl.length ? el("div", { class: o.live && live ? "dr-fh ok" : "dr-fh", text: o.live && live ? `✓ 첨부 ${fl.length}개 붙어 있어요` : `첨부 ${fl.length}개` }) : null, ...rows,
      named ? el("div", { class: "dr-note", text: "열람 불가" }) : null,
      !fl.length && d.noAttachments && !mailDraft ? el("div", { class: "dr-none" }, icon("clip"), el("span", { text: "첨부: 없음" })) : null,
      add, menu, lib, ...(o.warn ? [] : warns), pickers].filter(Boolean));
    box.hidden = !box.querySelector(".dr-fh, .dr-none, .dr-warn, .dr-add");
  }
  paint();
  if (ref && (o.edit !== false || o.live || (d.attachments || []).length) && d.toLabel === "받는이" && !DRF.st[ref]) drfLoad(ref).then(paint);
  return box;
}
/* ---------- 받는 사람·참조 of a mail reply draft (hub/draft-recipients.ts) ---------- */
// The rows above a mail draft's body: 답장 | 전체 답장, the 받는이 chips and the 참조 chips, a tap to edit one, its x to take it off, one add field
// per row. Only a pending draft is editable (o.edit false = read only, a sent draft keeps the lines it went with). The live list is
// GET /api/drafts/<ref>/recipients and each change is one POST to the same path - through the peer proxy for a draft of the other computer -
// and the hub rewrites the approval notice, so the card in every view shows the same list. o.t = the draft's conversation.
const DRR = { st: {}, pc: {}, busy: {}, add: {}, edit: {} };
const DRR_NONE = { to: [], cc: [], mode: "reply", editable: false, reply: false, failed: true };
const drrPath = ref => `/api/drafts/${enc(ref)}/recipients`;
const drrSplit = s => String(s || "").split(/\s*,\s*/).map(a => a.trim()).filter(Boolean);
async function drrLoad(ref) { try { const r = await api(drrPath(ref)); DRR.st[ref] = r && Array.isArray(r.to) ? r : DRR_NONE; } catch { DRR.st[ref] = DRR_NONE; } }
async function drrWrite(ref, body) {
  const r = await api(drrPath(ref), "POST", body);
  DRR.st[ref] = { to: r.to || [], cc: r.cc || [], mode: r.mode || "reply", editable: !!r.editable, reply: !!r.reply };
  DRR.add[ref] = ""; DRR.edit[ref] = "";
  return DRR.st[ref];
}
function draftToNode(d, o = {}) {
  const ref = d.ref;
  // Which computer holds the draft: a peer's rows change there (the same map the 첨부 줄 uses for its own requests).
  if (ref && o.t !== undefined) DRF.pc[ref] = DRR.pc[ref] = o.t ? pqPc(o.t) : null;
  const box = el("div", { class: "dr-recv" });
  const busy = () => !!DRR.busy[ref];
  const run = async job => {
    if (!ref || DRR.busy[ref]) return;
    DRR.busy[ref] = true; paint();
    try { const st = await job(); Object.assign(d, { to: st.to.join(", ") }); if (st.cc.length) d.cc = st.cc; else delete d.cc; d.mode = st.mode; }
    catch (e) { toast(e instanceof TypeError ? "연결이 끊겨 바꾸지 못했어요" : e.message, true); }
    DRR.busy[ref] = false; paint();
  };
  const change = (row, list) => run(() => drrWrite(ref, { [row]: list }));
  const field = (label, value, done) => {
    const i = el("input", { class: "dr-rc-in", type: "email", inputmode: "email", autocomplete: "off", placeholder: label, "aria-label": label, disabled: busy() });
    i.value = value || "";
    const go = () => { const v = i.value.trim(); if (v) done(v); };
    i.onkeydown = ev => { if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); go(); } };
    return { i, go };
  };
  const editor = (label, value, done) => {
    const f = field(label, value, done);
    return el("span", { class: "dr-rc-edit" }, f.i, el("button", { class: "btn text dr-rc-go", type: "button", disabled: busy(), text: "확인", onclick: f.go }),
      el("button", { class: "btn text", type: "button", disabled: busy(), text: "취소", onclick: () => { DRR.add[ref] = ""; DRR.edit[ref] = ""; paint(); } }));
  };
  const row = (name, label, list, editable) => {
    const editing = String(DRR.edit[ref] || "");
    const chips = list.map((a, i) => (editing === `${name}:${i}`
      ? editor(name === "to" ? "받는 사람 주소" : "참조 주소", a, v => change(name, list.map((x, n) => (n === i ? v : x))))
      : el("span", { class: "dr-chip dr-rc" },
        editable ? el("button", { class: "dr-rc-t", type: "button", title: "고치기", "aria-label": `${a} 고치기`, disabled: busy(), text: a, onclick: () => { DRR.add[ref] = ""; DRR.edit[ref] = `${name}:${i}`; paint(); } }) : el("span", { class: "dr-rc-t", text: a }),
        editable ? el("button", { class: "dr-rc-x", type: "button", title: "빼기", "aria-label": `${a} 빼기`, disabled: busy(), onclick: () => change(name, list.filter((_, n) => n !== i)) }, icon("close")) : null)));
    if (editable && DRR.add[ref] === name) chips.push(editor(name === "to" ? "메일 주소 추가" : "참조 주소 추가", "", v => change(name, [...list, v])));
    else if (editable) chips.push(el("button", { class: "dr-rc-add", type: "button", "aria-label": `${label} 추가`, disabled: busy(), onclick: () => { DRR.edit[ref] = ""; DRR.add[ref] = name; paint(); } }, icon("add"), el("span", { text: "추가" })));
    return el("div", { class: "dr-to dr-rcrow", "data-row": name }, el("span", { class: "dr-k", text: label }), chips.length ? el("div", { class: "dr-rc-list" }, ...chips) : el("span", { class: "dr-k", text: "-" }));
  };
  function paint() {
    const st = ref ? DRR.st[ref] : null;
    // No record of this draft (a block a session wrote): the hub has no list, the card's own 받는이 stands and nothing here can change it.
    const live = st && !st.failed && (st.to.length || st.editable) ? st : { to: drrSplit(d.to), cc: Array.isArray(d.cc) ? d.cc : [], mode: d.mode || "reply", editable: !!st && !!st.failed && !!ref && o.edit !== false, reply: !!d.mode };
    const editable = live.editable && o.edit !== false, off = busy();
    const seg = live.reply ? el("div", { class: "seg dr-seg", role: "group", "aria-label": "답장 범위" },
      ...[['reply', '답장'], ['all', '전체 답장']].map(([k, text]) => el("button", { class: live.mode === k ? "on" : "", type: "button", "data-k": `mode-${k}`, "aria-pressed": String(live.mode === k), disabled: off || !editable, text, onclick: () => { if (editable && !off && live.mode !== k) run(() => drrWrite(ref, { mode: k })); } }))) : null;
    const ccRow = live.cc.length || (live.reply && editable) ? row("cc", "참조", live.cc, editable) : null;
    clear(box).append(...[seg, live.reply || live.to.length || o.always ? row("to", "받는이", live.to, editable) : null, ccRow].filter(Boolean));
    box.hidden = !box.querySelector(".dr-rcrow");
    if (o.onpaint) o.onpaint(live);
  }
  paint();
  if (ref && o.edit !== false && !DRR.st[ref]) drrLoad(ref).then(paint);
  return box;
}
// The 자동 초안 규칙 that drafted a draft or a mail (hub/draft-approval.ts "> 규칙:", hub/mail.ts rule): its name as a plain tag, the same on the mail row,
// the reply card and the chat card.
const draftRuleTag = (name, cls) => el("span", { class: `tag ${cls}`, "data-rule": name, title: `자동 초안 규칙: ${name}`, text: name });
const draftRuleNode = d => d.rule ? el("div", { class: "dr-rulebar" }, draftRuleTag(d.rule, "dr-rule")) : null;
// "댓글 답글에 이어서" (+ the comment's link): a draft made as the follow-up of an approved action says where it came from (hub/draft-approval.ts 이어서).
function draftOriginNode(d) {
  const o = d.origin;
  if (!o || !o.text) return null;
  return el("div", { class: "dr-origin" }, icon("open"), o.link ? el("a", { href: o.link, target: "_blank", rel: "noopener", text: o.text }) : el("span", { text: o.text }));
}
// The mail that goes out right after a comment reply, in the same card (hub/draft-approval.ts "함께 보낼 메일"): recipient, subject, files, body.
// m.ref / m.id = the mail draft its files are staged under (GET /api/drafts/<id>/files/<n>), so each file row opens the file.
function draftMailNode(m, o = {}) {
  if (!m) return null;
  const ref = m.ref || m.id, part = ref ? { ...m, ref } : m;
  return el("div", { class: "dr-mailpart" },
    el("div", { class: "dr-mh" }, icon("mail"), el("span", { text: "함께 보낼 메일" })),
    el("div", { class: "dc-dr-h" }, el("span", { class: "dc-dr-k", text: m.toLabel || "받는이" }), el("span", { class: "dc-dr-v", text: m.to || "-" })),
    m.subject ? el("div", { class: "dc-dr-h" }, el("span", { class: "dc-dr-k", text: "제목" }), el("span", { class: "dc-dr-v sub", text: m.subject })) : null,
    draftBodyNode(m.body, "dc-dr-b", { tabindex: "0", role: "region", "aria-label": "함께 보낼 메일 내용" }),
    draftFilesNode(part, { edit: false, live: !!ref, t: o.t }));
}
// A combined card (comment reply + mail): the comment it answers on top, then 내 답글, then the mail (draftMailNode).
const replyHead = () => el("div", { class: "dr-mh" }, icon("chat"), el("span", { text: "내 답글" }));
// The body of a draft, drawn as chat draws a message (relayed: words to read, no run button or settings card on what someone else may have written).
const draftBodyNode = (text, cls, attrs = {}) => el("div", { ...attrs, class: `md ${cls}`, safeHtml: mdHtml(text, true) });
// The mail a draft answers, above the draft (hub/draft-approval.ts DraftBrief): the draft is added to the card and never stands in for it.
function draftBriefNode(b, seen) {
  if (!b) return null;
  const row = (k, v) => (v ? el("div", { class: "dc-dr-h" }, el("span", { class: "dc-dr-k", text: k }), el("span", { class: "dc-dr-v" }, mailInlineFrag(v))) : null);
  const rows = [row("보낸이", b.from), row("요약", b.summary), seen ? null : mailLinesNode(b.todo, b.questions)].filter(Boolean);
  return rows.length ? el("div", { class: "dc-brief", "data-k": "draft-brief" }, ...rows) : null;
}
function draftNode(d, o) {
  const both = !!d.mail && d.toLabel === "대상";
  return el("div", { class: "dc-draft" },
    draftBriefNode(d.brief),
    both ? orgInline(d, o.t) : null, both ? replyHead() : null,
    !d.toLabel || d.toLabel === "받는이" ? draftToNode(d, o) : el("div", { class: "dc-dr-h" }, el("span", { class: "dc-dr-k", text: d.toLabel }), el("span", { class: "dc-dr-v", text: d.to || "-" })),
    d.subject ? el("div", { class: "dc-dr-h" }, el("span", { class: "dc-dr-k", text: "제목" }), el("span", { class: "dc-dr-v", text: d.subject })) : null,
    draftRuleNode(d), draftOriginNode(d),
    draftBodyNode(d.body, "dc-dr-b", { tabindex: "0", role: "region", "aria-label": "보낼 내용" }), draftFilesNode(d, o), draftMailNode(d.mail, o));
}
// What the status line says after an answer: a 고치기 on a draft is the bot rewriting it.
const dcStText = (dc, st) => (st === "undo" ? dcUndoText(dc) : dc.draft && ((DC.picks[dc.key] || [])[0] || {}).label === DRAFT_EDIT ? "고치는 중…" : st === "sending" ? (((DC.picks[dc.key] || [])[0] || {}).label === "보내지 않기" ? "처리하는 중…" : "보내는 중…") : "보냈어요 · 처리하는 중");
// 고치기 on a draft, or an option that needs detail (안 됨 …): the owner types the change / reason, then the answer goes out with it.
// 고치기 on a draft asks "어떻게 고칠까요?" and the bot rewrites it; 직접 수정 (ed.manual) is the owner's own text, sent as the change "이 내용으로 고쳐 주세요: ...".
const DRAFT_HINT = "더 짧게, 존댓말로, 견적서도 첨부한다고 써 줘", MANUAL_LEAD = "이 내용으로 고쳐 주세요: ";
// The button under the typed text names what it does with the choice made, never a bare "보내기": after 고치기 on a draft a 내용 보내기 read as if
// the mail would go out (owner 2026-10-28). One rule for the chat card and the notice sheet.
const noteGoLabel = (opt, drf, man) => (man ? "이 내용으로 고치기" : drf && opt.label === DRAFT_OWN ? "이렇게 보내 달라고 하기" : drf ? "고쳐 달라고 하기" : `${opt.label}(으)로 답하기`);
// What the text box of a draft option asks: 고치기 = the change, 직접 입력 = how to send it.
const OWN_HINT = "메일 먼저 보내고 답글은 내일 올려 줘";
// A draft card's question without its "(<id>)", and what only the owner can decide (hub/draft-approval.ts decide) as a list of its own.
// A card made before the list kept the points in the question ("... 정할 것: a., b."); that tail is left out here, the list shows them.
const draftQ = t => String(t || "").replace(/\s*\([^()]*\)\s*$/, "").replace(/\s*정할 것\s*[:：][\s\S]*$/, "");
const decideNode = d => (d && d.decide && d.decide.length ? el("div", { class: "dc-decide" }, el("div", { class: "dc-decide-k", text: "정할 것" }), el("ul", {}, ...d.decide.map(q => el("li", { text: q })))) : null);
const draftNoteText = opt => (opt.label === DRAFT_OWN ? { hint: OWN_HINT, aria: "보내는 방법", ask: "어떻게 보낼까요?" } : { hint: DRAFT_HINT, aria: "고칠 내용", ask: "어떻게 고칠까요?" });
// 직접 수정 with files: the bot is told to attach them (the hub appends one [attachment] line per file with its path).
const manualNote = (text, files) => (files.length ? `첨부할 파일 ${files.length}개(${files.map(f => f.name).join(", ")})를 이 초안에 붙여 주세요. ` : "") + MANUAL_LEAD + text;
function editNode(dc, ed, st) {
  const opt = ed.opt, drf = !!dc.draft, man = !!ed.manual;
  const dt = draftNoteText(opt);
  const ta = el("textarea", { class: "dc-note", rows: man ? "7" : "2", maxlength: man ? "6000" : "500", placeholder: drf ? (man ? "보낼 내용을 직접 고쳐 주세요" : dt.hint) : "이유나 내용을 적어 주세요", "aria-label": man ? "직접 수정" : drf ? dt.aria : "자세한 내용", disabled: !!st, oninput: () => { DC.note[dc.key] = ta.value; go.disabled = !ta.value.trim(); } });
  ta.value = DC.note[dc.key] ?? (man ? dc.draft.body : "");
  const go = el("button", { class: "dc-go", type: "button", disabled: !!st || !ta.value.trim(), onclick: () => { const note = ta.value.trim(); if (note) pickOption(dc, ed.bi, opt, man ? manualNote(note, DC.files[dc.key] || []) : note); } }, noteGoLabel(opt, drf, man));
  const back = el("button", { class: "dc-back", type: "button", disabled: !!st, onclick: () => { delete DC.edit[dc.key]; delete DC.files[dc.key]; paintDecision(); } }, "돌아가기");
  return el("div", { class: "dc-edit" }, el("div", { class: "dc-ctx" }, el("span", { class: "dc-key", text: String(opt.n) }), el("span", { class: "dc-lb", text: man ? "직접 수정" : drf ? dt.ask : opt.label })), ta, man ? editFilesNode(dc, st) : null, el("div", { class: "dc-eb" }, back, go));
}
// 파일 첨부 in 직접 수정. A draft dotz tracks and can change (a reply-drafts mail draft) takes the file onto its 첨부 rows at once (the same
// drfUpload as 파일 추가); any other draft uploads it here and shows it as a chip, and the 고치기 answer goes out with it as the message's `files`.
function editFilesNode(dc, st) {
  const key = dc.key, ref = dc.draft.ref, files = DC.files[key] || [], busy = !!DC.fbusy[key];
  const pk = el("input", { type: "file", multiple: true, hidden: true, "aria-label": "파일 고르기" });
  pk.onchange = async () => {
    const list = [...pk.files]; pk.value = "";
    const s = ref ? DRF.st[ref] : null;
    if (!list.length || DC.st[key]) return;
    if (s && !s.failed && s.tracked !== false && s.editable && s.canAttach && DRF.add[ref]) { if (!DRF.busy[ref]) DRF.add[ref](list); return; }
    if (dc.t && pqPc(dc.t)) { toast("다른 컴퓨터의 이 초안에는 파일을 붙일 수 없어요", true); return; }
    DC.fbusy[key] = true; paintDecision();
    try { for (const f of list) { if ((DC.files[key] || []).length >= 10) break; DC.files[key] = (DC.files[key] || []).concat(await uploadFile(f)); } }
    catch (e) { toast(e instanceof TypeError ? "연결이 끊겨 올리지 못했어요" : e.message, true); }
    delete DC.fbusy[key]; paintDecision();
  };
  const chips = files.map(f => fileChip(f.name, [extOf(f.name), fsize(f.size)].filter(Boolean).join(" · "), { x: el("button", { class: "ax", type: "button", disabled: !!st, "aria-label": `${f.name} 빼기`, onclick: () => { DC.files[key] = (DC.files[key] || []).filter(x => x !== f); paintDecision(); } }, icon("close")) }));
  return el("div", { class: "dc-fl" }, el("button", { class: "dr-add", type: "button", disabled: !!st || busy, onclick: () => pk.click() }, icon("clip"), el("span", { text: busy ? "올리는 중…" : "파일 첨부" })), ...chips, pk);
}
// A decision in the full-screen overlay (30-notices.js dkOpen, 38-overlay.js): header = what it is, body = the draft or the question, sticky footer = the choices.
// A draft waiting for send approval shows who and what in the header and 보내기 / 고치기 / 보내지 않기 in the footer. Only the body scrolls.
// Where this send-approval card stands in its conversation: the progress line the hub keeps on the open card (hub/approval-queue.ts withLeft),
// "남은 N건 (k/T)" or "마지막 카드예요 (T/T)"; "" for a lone card.
const DRAFT_PROGRESS = /^-# ((?:남은 \d+건|마지막 카드예요)(?: \(\d+\/\d+\))?)$/m;
const draftProgress = text => (DRAFT_PROGRESS.exec(text || "") || [])[1] || "";
const draftIsLast = text => draftProgress(text).startsWith("마지막");
function renderSheet(box, dc, picks, step) {
  const st = DC.st[dc.key] || "", d = dc.draft, edit = DC.edit[dc.key] && !st.startsWith("sent") ? DC.edit[dc.key] : null, mail = !!d && d.toLabel === "받는이";
  const old = $(".fs-body", box), top = old && box.dataset.key === dc.key ? old.scrollTop : 0;
  const oldNote = $(".dc-note", box), refocus = !!oldNote && document.activeElement === oldNote, caret = refocus ? oldNote.selectionStart : 0;
  const qText = d ? draftQ(dc.blocks[0] && dc.blocks[0].title) : dc.question;
  // A mail draft's 받는이·참조 live in its own rows at the top of the body and change in place, so the head does not repeat them.
  const head = mail ? fsHead([el("div", { class: "fs-t" }, "답장 확인", dc.left ? el("span", { class: "fs-left", text: ` · ${dc.left}` }) : null)], { close: dc.close }) : fsHead(d ? [
    el("span", { class: "fs-ey" }, qText || "보내기 전에 확인해요", dc.left ? el("span", { class: "fs-left", text: ` · ${dc.left}` }) : null),
    !d.toLabel || d.toLabel !== "받는이" ? el("div", { class: "dc-dh" }, el("span", { class: "dc-dr-k", text: d.toLabel }), el("span", { class: "dc-dr-v", text: d.to || "-" })) : null,
    d.subject ? el("div", { class: "dc-dh" }, el("span", { class: "dc-dr-k", text: "제목" }), el("span", { class: "dc-dr-v sub", text: d.subject })) : null,
    // hub/draft-approval.ts recipientCheck: a likely typo or an address the source does not have; the address itself is never changed.
    d.recipientWarning ? el("div", { class: "dr-warn dc-rw", role: "alert" }, el("span", { text: `받는이 확인: ${d.recipientWarning}` })) : null]
    : [el("span", { class: "fs-ey", text: dc.blocks.length ? "결정이 필요해요" : "답변이 필요해요" })], { ignore: dc.ignore, close: dc.close });
  const warnBox = el("div", { class: "dr-warnbox", hidden: true });
  const orgDrawn = () => { delete box.dataset.sig; paintDecision(); };   // the sig does not hold the hub's answer, so the repaint is asked for
  const both = !!d && !!d.mail && d.toLabel === "대상" && orgHas(d.ref, dc.t, orgDrawn);   // a comment reply + mail: the original sits inline at the top (no room for the side panel beside the mail part)
  const body = mail ? mailSheetBody(dc, d, st, warnBox) : d ? el("div", { class: "fs-body panel", tabindex: "0", role: "region", "aria-label": "보낼 내용" }, draftBriefNode(d.brief), decideNode(d), (!d.toLabel || d.toLabel === "받는이" ? draftToNode(d, { t: dc.t, edit: !st }) : null), both ? orgInline(d, dc.t) : null, both ? replyHead() : null, draftRuleNode(d), draftOriginNode(d), draftBodyNode(d.body, "dc-dr-b"), draftFilesNode(d, { t: dc.t, edit: !st, warn: warnBox }), draftMailNode(d.mail, { t: dc.t }))
    : qText ? el("div", { class: "fs-body panel fit" }, mdNode(qText, "md dc-q")) : null;
  // 원문 보기 (10-draft-original.js): the original is its own panel beside the draft (a toggle on a phone); the draft side (body + footer) is the one that slides.
  box.classList.remove("od-host", "od-on");
  const col = d && d.ref && body && !d.mail && d.toLabel === "대상" && orgHas(d.ref, dc.t, orgDrawn) ? el("div", { class: "od-draftcol" }) : null;
  const org = col ? orgNodes(d, dc.t, box, col) : null;
  const foot = el("div", { class: "fs-ft" });
  foot.append(warnBox);
  if (edit) foot.append(editNode(dc, edit, st));
  else if (d && dcGone(dc.t)) foot.append(el("div", { class: "dc-gone", role: "status", text: DC_GONE }));
  else if (d) {
    // One compact row: the first choice (보내기) filled, 고치기 tonal, the rest as text, and 직접 수정 as a small link at the end.
    const opts = dc.blocks[0].options, oe = opts.find(o => o.label === DRAFT_EDIT);
    const manual = oe && !st ? () => { delete DC.note[dc.key]; DC.edit[dc.key] = { bi: 0, opt: oe, manual: true }; paintDecision(); } : null;
    if (mail) {   // the reply card's row: 보내기 filled, 고치기 tonal, the rest as text, 직접 수정 at the right end
      const bs = st === "undo" ? [dcUndoBtn(dc, "btn sm dr-send")] : opts.map((o, i) => el("button", { class: i === 0 ? "btn sm dr-send" : o.label === DRAFT_EDIT ? "btn tonal sm" : `btn text sm${o.label === "보내지 않기" ? " dr-drop" : ""}`, type: "button", "data-n": String(o.n), disabled: !!st, onclick: () => pickOption(dc, 0, o) }, o.label));
      foot.append(el("div", { class: "dr-act dr-row rq-acts" }, ...bs, ...(manual ? [rqManualBtn(manual)] : [])));
    } else {
    const btns = st === "undo" ? [dcUndoBtn(dc, "dc-act main")] : opts.map((o, i) => el("button", { class: `dc-act${i === 0 ? " main" : o.label === DRAFT_EDIT ? " alt" : ""}${picks[0] && picks[0].n === o.n ? " on" : ""}`, type: "button", disabled: !!st, onclick: () => pickOption(dc, 0, o) }, o.label));
    const man = manual ? el("button", { class: "dc-manual", type: "button", title: "직접 수정", "aria-label": "직접 수정", onclick: manual }, icon("pencil"), el("span", { text: "직접 수정" })) : null;
    foot.append(el("div", { class: "dc-acts" }, ...btns, ...(man ? [man] : [])));
    }
  } else if (dc.blocks.length > 1) foot.append(...multiNodes(dc, picks, st));
  else {
    const blk = dc.blocks[step];
    if (blk) {
      if (blk.title && dc.blocks.length > 1) foot.append(el("div", { class: "dc-sub", text: blk.title }));
      for (const o of blk.options) foot.append(choiceRow(dc, step, o, picks, st));
    }
  }
  const sn = dcStNode(dc, st); if (sn) foot.append(sn);
  if (org) col.append(body, foot);
  if (!paintKeep(box, org ? [head, org.bar, el("div", { class: "od-stage" }, org.orig, col)] : [head, ...(body ? [body] : []), foot], dcAgain(box))) return;
  if (body) body.scrollTop = top;
  const nn = $(".dc-note", box);
  if (nn && (refocus || (edit && !oldNote))) { nn.focus({ preventScroll: true }); nn.setSelectionRange(caret || nn.value.length, caret || nn.value.length); }
}
function choiceRow(dc, step, o, picks, st) {
  return el("button", { class: `dc-row${picks[step] && picks[step].n === o.n ? " on" : ""}`, type: "button", disabled: !!st, onclick: () => pickOption(dc, step, o) },
    el("span", { class: "dc-key", text: String(o.n) }),
    el("span", { class: "dc-tx" }, el("span", { class: "dc-lb" }, o.label), o.desc ? el("span", { class: "dc-ds", text: dcDesc(o) }) : null));
}
const dcDesc = o => o.desc.replace(/`/g, "");   // one plain line under the name: code marks would show raw
const dcAgain = box => () => (box === DK.box ? dkPaint() : paintDecision());   // the paint that owns a decision box, for a held repaint (paintKeep)
// From the tap until the card is gone it stays where it was, so the dock does not move under the thumb while the chosen row fades: its height is
// kept, and whatever arrives below it meanwhile (the working line) is taken out of its bottom margin.
function dcHold(box, on) {
  if (!on) { delete box.dataset.hold; box.style.height = ""; box.style.marginBottom = ""; return; }
  if (box.dataset.hold || !box.offsetHeight) return;
  box.dataset.hold = "1"; box.style.height = `${box.offsetHeight}px`;
  const top0 = box.getBoundingClientRect().top;
  const keep = () => {
    if (!box.dataset.hold) return;
    const drift = box.getBoundingClientRect().top - top0;
    if (Math.abs(drift) > 0.5) box.style.marginBottom = `${parseFloat(getComputedStyle(box).marginBottom) + drift}px`;
    requestAnimationFrame(keep);
  };
  requestAnimationFrame(keep);
}
function renderDecision(box, dc, picks, step) {
  if (dc.close) { renderSheet(box, dc, picks, step); return; }
  // Folded per conversation, not per question (owner 2026-11-04: the arrow did not lower it): the bot re-asks what is left as a new
  // message, and a fold kept on the old question let the next one cover the conversation again.
  const st = DC.st[dc.key] || "", fold = !!DC.fold[dc.t], old = $(".dc-body", box), top = old && box.dataset.key === dc.key ? old.scrollTop : 0;
  dcHold(box, !!st);
  // A draft message starts with its quoted draft, so the question is the block's own title without the draft's id.
  const qText = dc.draft ? draftQ(dc.blocks[0] && dc.blocks[0].title) : dc.question;
  // ONE tight header (owner 2026-11-03): the status 답 기다림 on one line, then the short question as the card's one lead (a 확인 필요 label said it twice); the card asks only what it must.
  const head = el("div", { class: "dc-hd" }, el("div", { class: "dc-tt" },
    el("div", { class: "dc-meta" }, el("span", { class: "tag warn dc-wt", text: "답 기다림" })),
    qText ? mdNode(qText, "md dc-q") : null, decideNode(dc.draft)),
    el("div", { class: "dc-hb" },
      el("button", { class: "dc-fold", type: "button", "aria-expanded": String(!fold), "aria-label": fold ? "펼치기" : "접기", onclick: () => { DC.fold[dc.t] = !fold; paintDecision(); } }, icon("drop"))));
  const kids = [head];
  if (!fold) {
    const body = el("div", { class: "dc-body" });
    if (dc.draft) body.append(draftNode(dc.draft, { t: dc.t, edit: !st }));
    if (DC.edit[dc.key] && !st.startsWith("sent")) { body.append(editNode(dc, DC.edit[dc.key], st)); kids.push(body); }
    else if (dc.blocks.length > 1) { body.append(...multiNodes(dc, picks, st)); kids.push(body); }
    else {
    const blk = dc.blocks[step];
    if (blk) {
      if (blk.title && dc.blocks.length > 1) body.append(el("div", { class: "dc-sub", text: blk.title }));
      // Once the answer goes out the card keeps only the chosen row (the others leave), so 보냈어요 reads in the same place.
      if (st === "undo" && dc.draft) body.append(dcUndoBtn(dc, "dc-row dc-undo"));
      else for (const o of st && !dc.draft && picks[step] ? blk.options.filter(x => x.n === picks[step].n) : blk.options) body.append(el("button", { class: `dc-row${picks[step] && picks[step].n === o.n ? " on" : ""}`, type: "button", disabled: !!st, onclick: () => pickOption(dc, step, o) },
        el("span", { class: "dc-key", text: String(o.n) }),
        el("span", { class: "dc-tx" }, el("span", { class: "dc-lb" }, o.label), o.desc ? el("span", { class: "dc-ds", text: dcDesc(o) }) : null)));
    }
    kids.push(body);
    }
  }
  const sn = dcStNode(dc, st); if (sn) kids.push(sn);
  if (!paintKeep(box, kids, dcAgain(box))) return;
  box.classList.toggle("fold", fold);
  const nb = $(".dc-body", box); if (nb) nb.scrollTop = top;
  const nn = $(".dc-note", box); if (nn && DC.fresh === dc.key) { DC.fresh = ""; nn.focus({ preventScroll: true }); }   // the field a tap just opened takes the focus
}
// In-message rows follow the same state: tappable only while their question is the pending one.
// Otherwise they follow the message's own decision notice (hub/notices.ts keeps it open until answered, however much was posted
// after the message): open = tappable, answered = greyed with the chosen row marked.
const dcNoticeAt = at => (at ? NT.items.find(n => ntIsDec(n) && n.decision.to === target && n.decision.group === 1 && n.decision.reply_to === at) || null : null);
const dcSending = new Set();
function syncInlineChoices() {
  const dc = DC.cur;
  for (const n of document.querySelectorAll(".dcm:not(.mon-dc)")) {
    const mine = !!dc && dc.sig === n.dataset.sig, nt = mine ? null : dcNoticeAt(n.dataset.at);
    const live = mine ? !DC.st[dc.key] : !!nt && nt.decision.state === "open" && !dcSending.has(nt.id), p = mine ? DC.picks[dc.key] || [] : [];
    const said = nt && nt.decision.state === "answered" ? String(nt.decision.answer || "") : "";
    for (const b of n.querySelectorAll(".dcm-row")) {
      b.disabled = !live;
      b.classList.toggle("on", mine ? !!p[b.dataset.b] && p[b.dataset.b].n === Number(b.dataset.n) : !!said && said.startsWith(`${b.dataset.n})`));
    }
  }
}
// A tap on a message that is no longer the pending card: answered through the notice path, so the notice and the buttons settle together.
async function answerInline(nd, opt) {
  // An option that needs detail opens the notice sheet with its text field; nothing is sent from the row. A draft's own sheet
  // (ntDraftSheet) is the decision card, so its 고치기 field is that card's edit state.
  if (ntNeedsNote(nd, opt)) {
    if (nd.decision.draft && !nd.pc) { DC.edit[`dk:${nd.id}`] = { bi: 0, opt }; ntDraftSheet(nd); return; }
    await noticeSheetOpen(nd.pc ? nd : nd.id); ntAnswer(nd, opt); return;
  }
  dcSending.add(nd.id); syncInlineChoices();
  try { dcAnswerToast(nd, opt, await ntPost(nd, opt.n, undefined, undefined, opt.label)); } catch (e) { toast(e.message, true); }
  dcSending.delete(nd.id); syncInlineChoices();
}
// What a draft answered in place did, with the next step: 보냈어요 · 메일 열기 (the mail it answered), 보내지 않았어요 · 되돌리기 (the draft waits again).
function dcAnswerToast(nd, opt, held) {
  const to = String(nd.decision.to || "");
  if (!nd.decision.draft) return;
  if (opt.label === "보내기" && held && held.state === "undo") toast("곧 보내요", false, { label: "보내기 취소", onclick: () => dcUndoPost(nd.decision.draft.ref) }, held.left);
  else if (opt.label === "보내기") toast("보냈어요", false, to.startsWith("mail:") ? { label: "메일 열기", onclick: () => go("monitoring", `c:${to}`) } : null);
  else if (opt.label === "보내지 않기") toast("보내지 않았어요", false, { label: "되돌리기", onclick: () => dcReopen(nd) });
}
async function dcReopen(nd) {
  try {
    if (nd.pc) await pqNotice(nd, "notice", { op: "reopen", id: String(nd.id) });
    else { const r = await api("/api/notices/reopen", "POST", { ids: [String(nd.id)] }); ntApply(null, r.unread); await loadNotices(); }
    toast("초안을 되돌렸어요");
  } catch (e) { toast(e.message, true); }
}
// Decision cards already docked: only one that really arrives rises in (not on the first paint, nor when another conversation opens).
const DC_SEEN = new Set(); let dcShownT = "", dcLast = null, dcOut = null;
// An answered card folds away at once: its record is already in the conversation (dcRecordNode), so nothing has to wait for the card to
// say 보냈어요 (owner 2026-11-03: no fixed 1.2s beat). motionOut ends it, and a question that arrives meanwhile cancels the leave.
function dcLeave(box, dc) {
  const picks = DC.picks[dc.key] || [], st = DC.st[dc.key];
  if (box.dataset.st !== st) { motionSwap(box, () => renderDecision(box, dc, picks, DC.step[dc.key] ?? Math.max(0, dc.blocks.findIndex((_, i) => !picks[i])))); box.dataset.st = st; }
  if (st !== "sent" || box.dataset.out) return;
  box.dataset.out = "1";
  void (async () => {
    if (DC.cur) { delete box.dataset.out; return; }
    dcOut = await motionOut(box);
    if (DC.cur) { if (dcOut && dcOut.cancel) dcOut.cancel(); dcOut = null; delete box.dataset.out; return; }
    if (dcOut && dcOut.cancel) dcOut.cancel();
    dcOut = null; dcLast = null; box.hidden = true; dcHold(box, false); if (dc.each) { delete DC.st[dc.key]; delete DC.picks[dc.key]; } delete box.dataset.sig; delete box.dataset.key; delete box.dataset.st; delete box.dataset.out; clear(box);
    paintDecision();
  })();
}
// The decision as a card in the message itself. It never fires on its own: open, it is the question that waits (the docked card's own, same key, so one answer closes
// both); closed, an old message's answered or passed question, its rows are disabled and the chosen one marked. The hub normalizes stored messages on the way here
// (hub/owner-text.ts shownEvent), so a message from before the rule gets this card without ever being able to answer twice.
const DCI = new WeakMap();
function dcInline(e, body, pc) {
  const box = el("div", { class: "dc-inl" });
  DCI.set(box, { e, t: target, body: body.trim(), question: pc.question, blocks: pc.blocks.filter(b => b.options.length > 1) });
  paintInline(box, isFixedT(target) ? null : decisionOf(target));
  return box;
}
const SEND_LABELS = /^보내기\|고치기\|보내지 않기/;
function inlineDc(i, live) {
  const sig = hashOf(i.body), at = i.e.ts, s = ts(i.t);
  if (live && live.t === i.t && (live.sig === sig || live.at === at)) return live;
  if (dcGone(i.t)) return null;
  if (s.msgs.some(e => ownerSaid(e) && msOf(e.ts) > msOf(at)) || dcSettledAt(i.t, at)) return null;
  // Only the newest question waits, and a send approval outside a session goes by its draft (the docked card or the notice), never by a bare answer.
  if (s.msgs.some(e => msOf(e.ts) > msOf(at) && (e.kind === "out" || e.kind === "lane_report") && !e.update_key && parseChoices(parseTone(noHandoff(String(e.text ?? ""))).text).blocks.some(b => b.options.length > 1))) return null;
  if (!isLaneT(i.t) && i.blocks.some(b => SEND_LABELS.test(b.options.map(o => o.label).join("|")))) return null;
  return { key: `${i.t}|${sig}`, t: i.t, sig, at, question: i.blocks.length === 1 ? i.blocks[0].title : i.question, blocks: i.blocks };
}
// What was answered, from the answer's own picks (hub/intake.ts keeps them on the owner's message).
function closedPicks(i) {
  const a = ts(i.t).msgs.find(e => ownerSaid(e) && Array.isArray(e.picks) && msOf(e.ts) > msOf(i.e.ts) && e.picks.some(p => i.blocks.some(b => b.title === p.q)));
  return i.blocks.map(b => a && a.picks.find(p => p.q === b.title));
}
function paintInline(box, live) {
  const i = DCI.get(box), dc = inlineDc(i, live), picks = dc ? DC.picks[dc.key] || [] : closedPicks(i), st = dc ? DC.st[dc.key] || "" : "closed";
  const docked = !!dc && dc === live && dc.at === i.e.ts, edit = dc && !docked ? DC.edit[dc.key] : null, sig = [dc ? dc.key : "", st, picks.map(p => (p ? p.n : 0)).join(), edit ? edit.opt.n : "", docked].join("|");
  if (box.dataset.sig === sig) return;
  // Answered: the owner's message is drawn as the record of it (dc-rec), options live only in the card.
  const hide = !dc && picks.some(Boolean), kids = [];
  let note = null;
  if (!hide) {
    // While the card is docked its rows are there: the message keeps the question, one set of buttons on screen.
    if (docked) kids.push(...i.blocks.map(b => mdNode(draftQ(b.title), "md dc-q")));
    else if (dc && i.blocks.length > 1) kids.push(...multiNodes(dc, picks, st));
    else for (const [bi, b] of i.blocks.entries()) kids.push(...[b.title ? mdNode(draftQ(b.title), "md dc-q") : null, ...b.options.map(o => choiceRow(dc || { key: "" }, bi, o, picks, st))].filter(Boolean));
    if (!dc && !picks.some(Boolean)) kids.push(el("div", { class: "dc-ds", text: "지난 결정이에요" }));
    // No docked card to type in (a session's mid-turn question): what to change is asked here. Its text outlives a repaint (DC.note).
    if (edit) {
      note = el("textarea", { class: "dc-note", rows: 2, placeholder: "내용을 적어 주세요", oninput: () => { DC.note[dc.key] = note.value; } });
      note.value = DC.note[dc.key] || "";
      kids.push(note, el("button", { class: "btn dc-send", type: "button", onclick: () => note.value.trim() && pickOption(dc, edit.bi, edit.opt, note.value.trim()) }, "보내기"));
    }
  }
  if (!paintKeep(box, kids, paintDecision)) return;
  box.dataset.sig = sig;
  box.hidden = hide;
  // The field a tap just opened takes the focus; a repaint for a new message never takes it from the field the owner types in.
  if (note && DC.fresh === dc.key) { DC.fresh = ""; note.focus({ preventScroll: true }); }
}
function paintDecision() {
  const box = $("#dcard");
  if (!box) return;
  const inlines = document.querySelectorAll("#timeline .dc-inl");
  if (inlines.length) { const live = isFixedT(target) ? null : decisionOf(target); for (const b of inlines) paintInline(b, live); }
  // 알림 / 작업내역 never dock the question: a decision there opens as the sheet (30-notices.js), whichever way the conversation was entered.
  // 2 or more send-approval cards waiting in this conversation: one line above the composer (dcLine) instead of the dock card or its pointer; a question that is not a draft keeps its card.
  const dc0 = isFixedT(target) ? null : decisionOf(target), askN = !isFixedT(target) && dcDraftRefs(target) >= 2 ? rqAskCount() : 0, line = askN > 0, dc = line && dc0 && dcDraftAsk(dc0) ? null : dc0, had = !!DC.cur;
  dcLine(askN);
  // A message that carries several of those drafts folds to its first paragraph while they wait: the drafts live in 답장 대기, not in the conversation.
  for (const m of document.querySelectorAll("#timeline .bm[data-dat]")) m.classList.toggle("q-fold", line && ntDecisions().filter(n => n.decision.draft && n.decision.to === target && n.decision.reply_to === m.dataset.dat).length > 1);
  DC.cur = dc;
  if (dc) { dcLast = dc; delete box.dataset.out; if (dcOut && dcOut.cancel) dcOut.cancel(); dcOut = null; }
  const arrived = S && freshKeys(DC_SEEN, dc ? [...DC_SEEN, dc.key] : [...DC_SEEN]).has(dc && dc.key) && dcShownT === target;
  if (S) dcShownT = target;
  const waiting = dc || line || isFixedT(target) ? null : dcWaitingCard(target);
  // The card whose answer is going out leaves first (the echo of the answer can arrive before it), then the pointer to the next waiting one takes its place.
  if (!dc && dcLast && !box.hidden && box.dataset.key === dcLast.key && DC.st[dcLast.key]) dcLeave(box, dcLast);
  else if (waiting) dcPointer(box, waiting);
  else if (!dc) { box.hidden = true; dcHold(box, false); delete box.dataset.sig; delete box.dataset.key; delete box.dataset.st; clear(box); }
  else {
    const picks = DC.picks[dc.key] || [], step = DC.step[dc.key] ?? Math.max(0, dc.blocks.findIndex((_, i) => !picks[i]));
    const sig = dcSig(dc, picks, step);
    box.hidden = false;
    if (box.dataset.sig !== sig) {
      // The answer goes out: this same card turns into 보내는 중 / 보냈어요 in place instead of being replaced.
      const st = DC.st[dc.key] || "", fresh = box.dataset.key !== dc.key, swap = box.dataset.key === dc.key && (box.dataset.st || "") !== st;
      const draw = () => renderDecision(box, dc, picks, step);
      if (swap) motionSwap(box, draw); else draw();
      box.dataset.sig = sig; box.dataset.key = dc.key; box.dataset.st = st;
      if (arrived) motionIn(box);
      if (fresh && dc.draft) dcShowDraft(dc);
    }
  }
  syncInlineChoices();
  dkPaint();
  if (had !== !!dc) updateComposerMeta();
}
// "이대로 보낼까요?" sits in the dock, so the draft it asks about must be on the screen with it: when a draft card docks and the end of the draft's message is out of
// the timeline's view (the dock took the room, or the owner was reading higher), the view moves just far enough to put that end right above the card.
function dcShowDraft(dc) {
  requestAnimationFrame(() => {
    const m = dc.at && [...document.querySelectorAll("#timeline .bm[data-ts]")].find(x => x.dataset.ts === dc.at);
    if (!m || target !== dc.t) return;
    const tb = timeline.getBoundingClientRect(), mb = m.getBoundingClientRect();
    if (mb.bottom <= tb.bottom && mb.bottom > tb.top) return;
    chatUnpin();
    timeline.scrollTop += mb.bottom - tb.bottom + 12;
    chatStick = timeline.scrollTop + timeline.clientHeight >= timeline.scrollHeight - 40;
    $("#chat-jump").hidden = chatStick;
  });
}
// A docked question that is a send approval: a draft notice was made from its message.
const dcDraftAsk = dc => !dc.each && ntDecisions().some(n => n.decision.draft && n.decision.to === dc.t && n.decision.reply_to === dc.at);
// The send-approval cards waiting in conversation t, open ones and held ones, one per draft.
function dcDraftRefs(t) {
  const refs = new Set();
  for (const n of typeof ntDecisions === "function" ? ntDecisions() : []) if (n.decision.draft && n.decision.to === t) refs.add(n.decision.draft.ref || n.id);
  try { for (const g of TR.groups) for (const c of g.cards) if (c.to === t) refs.add(c.ref); } catch { /* 30-triage.js has not run yet */ }
  return refs.size;
}
// 답장 초안 N건 기다려요 · 확인하기 (the prototype's .qline): N is the 답 필요 count of the 답장 대기 screen, a tap opens it.
function dcLine(n) {
  const q = $("#qline");
  if (!q) return;
  if (!n) { q.hidden = true; return; }
  const shown = !q.hidden;
  q.hidden = false;
  if (!q.firstChild) clear(q).append(el("span", { class: "dot warn" }), el("span", { class: "tx" }, "답장 초안 ", el("b", { "data-qn": "" }), "건 기다려요"), el("span", { class: "sep", text: "·" }), el("span", { class: "go", text: "확인하기" }));
  rollCount(q.querySelector("b"), String(n));
  q.onclick = () => rqOpen();
  if (!shown) motionIn(q);
}
// A send-approval card still open in this conversation although later posts pushed it up (decisionOf only docks the newest message's
// question): the dock keeps one row naming it, and a tap opens it as the sheet (2026-10-31: "19번 카드는 위에 있어" -> "어디에있음?").
const dcWaitingCard = t => (typeof ntDecisions === "function" ? ntDecisions().filter(n => n.decision.draft && n.decision.to === t).sort((a, b) => ntAt(a) - ntAt(b))[0] : null) || null;
function dcPointer(box, n) {
  const sig = `wait:${n.id}:${draftProgress(n.text)}`;
  box.hidden = false;
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig; box.dataset.key = sig;
  const title = draftQ(n.title), left = draftProgress(n.text);
  clear(box).append(el("button", { class: "dc-wait", type: "button", onclick: () => noticeSheetOpen(n.id) }, el("span", { class: "dc-wait-k", text: "답 대기" }), el("span", { class: "dc-wait-t", text: title || "보내기 확인" }), left ? el("span", { class: "dc-wait-n", text: left }) : null, el("span", { class: "dc-wait-go", text: "열기" })));
}
// What a decision card shows; the card (docked or in the sheet) is redrawn only when this changes. A redraw replaces the reason field, and on
// a phone the keyboard closes and reopens while the owner types (owner 2026-10-22), so a live update that changes none of it leaves the card alone.
function dcSig(dc, picks, step) {
  const dr = dc.draft ? [dc.draft.to, (dc.draft.cc || []).join(","), dc.draft.mode || ""] : 0;
  return JSON.stringify([dc.key, dc.question, dc.each ? dc.blocks.map(b => b.nd.id) : 0, picks.map(o => o && o.n), step, !!DC.fold[dc.t], DC.st[dc.key] || "", DC.edit[dc.key] ? DC.edit[dc.key].opt.n + (DC.edit[dc.key].manual ? "m" : "") : 0, dr, (DC.files[dc.key] || []).length, !!DC.fbusy[dc.key], dcBackNote(dc)]);
}
// What was decided stays in the conversation once the card is gone (owner 2026-11-03): the owner's answer message already carries the
// question and the chosen option (hub/intake.ts decisionLines, `picks`), so the record is drawn from it here and from history after a
// reload — the agent's message itself is unchanged. One row per block: 질문 <title> · 답: <n) label>. `files` = what a 직접 수정 answer
// attached, `mt` = the message's own meta line (the delivery state paints into it).
function dcRecordNode(e, files, mt) {
  const picks = (Array.isArray(e.picks) ? e.picks : []).filter(p => p && Number.isFinite(Number(p.n)));
  if (!picks.length) return null;
  const q = p => String(p.q ?? "").trim();
  return el("div", { class: "dc-rec", role: "note", "aria-label": "결정 기록" },
    picks.map(p => el("div", { class: "dc-rec-r" },
      q(p) ? el("span", { class: "dc-rec-k", text: "질문" }) : null, q(p) ? el("span", { class: "dc-rec-q", text: q(p) }) : null,
      el("span", { class: "dc-rec-k", text: "· 답:" }), el("span", { class: "dc-rec-a", text: `${p.n}) ${p.label}${p.note ? ` - ${p.note}` : ""}` }))),
    files || null, mt || null);
}
