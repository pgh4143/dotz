/* ---------- 메일함 설정과 메일함 추가: the two screens of the mail app that replace the list in the same view (docs/mailbox.md "Web", prototype s-mailbox.js) ---------- */
// MX.scr ("", "set", "new") is part of the address: `monitoring/i%3Amail/<account>/<box>/set` (30-mailboxes.js mxRoute, mxHash). In a screen mxScope hands the timeline no mails, so
// its signature stays put and the one node MXS.root is drawn by mxsPaint only when something here changes; a live mail update never redraws a field being typed in.
// A change saves at once with PUT /api/mailbox/box (the whole box, so `alone`, `rules` and the source conditions the hub keeps come back unchanged), optimistic: the box object of
// INTG is changed first and put back from the last answer the hub gave when a save fails. Nothing here polls; the tone and the suggestions are read when their item or screen opens.
const MXS = { root: null, open: "", more: new Set(), add: "", blank: 0, reply: "", note: "", tone: new Map(), ack: new Map(), q: Promise.resolve(), d: null, sug: null, sugFor: "" };
const MXS_MODES = { auto: ["자동 초안", "메일이 오면 초안을 써 둬요. 보내기 전에 확인해요."], ask: ["확인 먼저", "답장할지 먼저 물어요. 쓰라고 하면 그때 초안을 써요."], notify: ["알림만", "새 메일을 알려 줘요. 초안은 쓰지 않아요."], quiet: ["조용히 모으기", "알리지 않고 여기 모아 둬요."] };
const MXS_KINDS = [["from", "보낸 사람", "주소나 @도메인"], ["subj", "제목", "제목에 든 말"], ["body", "내용", "내용에 든 말"]];
const MXS_ICONS = [["mail", "편지"], ["folder", "폴더"], ["file", "문서"], ["tag", "태그"], ["users", "사람"], ["bell", "종"]];
const MXS_CAP = 4, MXS_FIX = 2;
const mxsErr = e => (e && e.data && e.data.error) || (e && e.message) || "저장하지 못했어요";
const mxsFind = (app, id) => { const a = MX.accts.get(app); return a ? a.byId.get(id) : undefined; };
const mxsList = (o, path) => path.split(".").reduce((x, k) => x[k], o);
const mxsMails = (a, b) => [...MX.of].filter(([t, k]) => k === a.key && mxBoxOf(t) === b).map(([t]) => t);
const mxsBlank = acct => ({ acct, step: "start", name: "", icon: "folder", mode: "ask", conds: { from: [], subj: [], body: [] }, judge: { on: false, text: "" }, how: "", greets: [], folders: [], bans: [], keys: [], count: 0, bring: false, copied: "", busy: false });
// The address of the screen the state says; the box list is the same address without the last part.
const mxsGo = scr => go("monitoring", `${MX.key}/${enc(MX.acct)}/${enc(MX.box)}${scr ? `/${scr}` : ""}`);
// The browser's back from a screen lands on the box list (32-history-nav.js routeChain).
const mxChain = hash => (MX.scr && MON.sel === MX.key ? [hash.slice(0, hash.lastIndexOf("/")), hash] : [hash]);
// The screens name the app bar (monName) and its back arrow returns to the box list (#back, 04-state.js).
const mxsName = () => (MON.sel === MX.key && MX.scr ? (MX.scr === "set" ? "메일함 설정" : "메일함 추가") : "");
const mxsBack = () => { if (current !== "monitoring" || !MX.it || !MX.scr) return false; MX.scr = ""; mxsGo(""); return true; };
function mxsEnter(scr, note = "") { MXS.note = note; MXS.open = ""; MXS.add = ""; MXS.blank = 0; MXS.reply = ""; MXS.more.clear(); MXS.tone.clear(); MXS.d = null; MXS.sug = null; MXS.sugFor = ""; mxsGo(scr); }
// box "n:<name>" (the merged entry) opens the first account's box of that name.
function mxOpenSet(id) {
  const name = mxGroup(id) ? id.slice(2) : "", merged = !!name || (MX.acct === "all" && MX.accts.size > 1);
  for (const a of MX.accts.values()) {
    const b = name ? a.boxes.find(x => x.name === name) : (MX.acct === "all" || MX.acct === a.key) && a.byId.get(id);
    if (!b) continue;
    MX.acct = a.key; MX.box = b.id;
    mxsEnter("set", merged ? `계정마다 있는 메일함이라 ${a.label} 계정의 설정을 열었어요.` : "");
    return;
  }
}
function mxOpenNew() { mxsEnter("new"); }

/* ---- saving ---- */
// Changes the box (`change`, on the live object), draws it again unless `paint` is false (a text field keeps its focus), and sends the whole box. The saves go one after another;
// a refused one puts the box back to the last state the hub confirmed and says why.
function mxsSave(app, id, change, paint = true) {
  const k = `${app}|${id}`, b = mxsFind(app, id);
  if (!b) return;
  if (!MXS.ack.has(k)) MXS.ack.set(k, structuredClone(b));
  change(b);
  if (paint) mxsPaint();
  monSchedule();
  MXS.q = MXS.q.then(async () => {
    try { MXS.ack.set(k, structuredClone((await api("/api/mailbox/box", "PUT", { app, box: mxsFind(app, id) })).box)); } catch (e) {
      const now = mxsFind(app, id);
      if (now) { for (const key of Object.keys(now)) delete now[key]; Object.assign(now, structuredClone(MXS.ack.get(k))); }
      toast(mxsErr(e), true); mxsPaint(); monSchedule();
    }
  });
}
const mxsSetApply = (app, id) => (fn, paint = true) => mxsSave(app, id, fn, paint);
const mxsNewApply = () => (fn, paint = true) => { fn(MXS.d); if (paint) mxsPaint(); };

/* ---- parts both screens use ---- */
const mxsSw = (on, label, onclick, off) => el("button", { class: "hs-sw", type: "button", role: "switch", "aria-checked": String(on), "aria-label": label, disabled: off ? true : null, onclick });
const mxsRow = (head, sup, end) => el("div", { class: "li" }, el("span", { class: "tx" }, el("span", { class: "hd", text: head }), sup ? el("span", { class: "sup", text: sup }) : null), end ? liEnd(end) : null);
const mxsHead = (b, sup) => el("div", { class: "mxs-hd" }, el("span", { class: "av" }, mxIc(b.icon)), el("span", { class: "tx" }, el("span", { class: "hd" }, b.name, b.base ? el("span", { class: "tag", text: "기본" }) : null), el("span", { class: "sup", text: sup })),
  el("button", { class: "btn tonal sm", type: "button", text: "메일 보기", onclick: mxsBack }));
const mxsSec = text => el("div", { class: "sec", text });
function mxsTiles(cur, pick) {
  return el("div", { class: "mxs-modes", role: "radiogroup", "aria-label": "처리 방식" }, ...Object.entries(MXS_MODES).map(([k, [l, t]]) => el("button", { class: `mxs-mode${cur === k ? " on" : ""}`, type: "button", role: "radio", "aria-checked": String(cur === k), "data-m": k, onclick: () => pick(k) },
    el("span", { class: "mxs-mt" }, el("span", { text: l }), cur === k ? icon("check") : null), el("span", { class: "mxs-md", text: t }))));
}
// A list of short texts as chips: each one has an x, an input opens at the end (Enter adds and stays, Esc closes), more than MXS_CAP fold.
function mxsChips(o, path, add, ph, apply) {
  const l = mxsList(o, path), more = MXS.more.has(path), shown = more ? l : l.slice(0, MXS_CAP);
  const input = () => el("input", { class: "fi mxs-ci", "data-mxs-add": path, placeholder: ph, "aria-label": add, onkeydown: ev => {
    if (ev.key === "Escape") { MXS.add = ""; mxsPaint(); } else if (ev.key === "Enter") { ev.preventDefault(); mxsChipAdd(path, ev.target.value, apply); }
  } });
  return el("div", { class: "mxs-chips" }, ...shown.map(v => el("span", { class: "chip mxs-c" }, el("span", { class: "tx", text: v }), el("button", { class: "mxs-cx", type: "button", "aria-label": `${v} 지우기`, onclick: () => apply(x => { const q = mxsList(x, path), at = q.indexOf(v); if (at >= 0) q.splice(at, 1); }) }, icon("close")))),
    l.length > shown.length ? el("button", { class: "chip", type: "button", onclick: () => { MXS.more.add(path); mxsPaint(); } }, `더 보기 · ${l.length - shown.length}개`) : null,
    MXS.add === path ? input() : el("button", { class: "chip mxs-c2", type: "button", onclick: () => { MXS.add = path; mxsPaint(); mxsFocus(); } }, icon("add"), add));
}
const mxsFocus = () => { const i = MXS.root && MXS.root.querySelector("[data-mxs-add]"); if (i) i.focus(); };
function mxsChipAdd(path, raw, apply) {
  const v = raw.trim();
  MXS.more.add(path);
  if (v) apply(x => { const q = mxsList(x, path); if (!q.includes(v)) q.push(v); });
  mxsFocus();
}
function mxsConds(o, apply) {
  return [...MXS_KINDS.map(([k, l, ph]) => el("div", { class: "mxs-kv" }, el("div", { class: "mxs-k", text: l }), mxsChips(o, `conds.${k}`, "추가", ph, apply))),
    ...(o.not ? [el("div", { class: "mxs-kv" }, el("div", { class: "mxs-k", text: "넣지 않을 보낸 사람" }), mxsChips(o, "not.from", "추가", "주소나 @도메인", apply))] : [])];
}
const mxsJudge = (o, apply) => [el("div", { class: "mxs-jr" }, mxsSw(o.judge.on, "내용을 보고 판단", () => apply(x => { x.judge.on = !x.judge.on; }))),
  o.judge.on ? el("input", { class: "fi", value: o.judge.text, placeholder: "예: 강의 자료를 달라는 메일", "aria-label": "판단 설명", onchange: ev => apply(x => { x.judge.text = ev.target.value.trim(); }, false) }) : null];
const mxsIcons = (o, apply) => el("div", { class: "mxs-chips", role: "radiogroup", "aria-label": "아이콘" }, ...MXS_ICONS.map(([n, label]) => el("button", { class: `chip mxs-ic${o.icon === n ? " on" : ""}`, type: "button", role: "radio", "aria-checked": String(o.icon === n), "aria-label": label, onclick: () => apply(x => { x.icon = n; }) }, mxIc(n))));
function mxsGreets(o, apply) {
  const row = (g, i) => el("div", { class: "mxs-g" }, el("div", { class: "tx" }, el("input", { class: "mxs-in", value: g.who, placeholder: "이름", "aria-label": "이름" }), el("input", { class: "mxs-in s", value: g.addr, placeholder: "주소나 @도메인", "aria-label": "주소" })),
    el("input", { class: "fi", value: g.hello, placeholder: "첫 인사", "aria-label": "첫 인사" }), el("button", { class: "ib", type: "button", "aria-label": "지우기", onclick: () => { if (i < o.greets.length) apply(x => { x.greets.splice(i, 1); }); else { MXS.blank--; mxsPaint(); } } }, icon("close")));
  const rows = [...o.greets, ...Array.from({ length: MXS.blank }, () => ({ who: "", addr: "", hello: "" }))].map(row);
  // A row is saved as a whole when any of its fields changes; an empty row stays on screen only until it gets a text.
  rows.forEach((r, i) => r.addEventListener("change", () => {
    const [who, addr, hello] = [...r.querySelectorAll("input")].map(x => x.value.trim());
    if (i >= o.greets.length) { if (!(who || addr || hello)) return; MXS.blank--; }
    apply(x => { if (i < x.greets.length) x.greets[i] = { who, addr, hello }; else x.greets.push({ who, addr, hello }); }, false);
  }));
  return [el("div", { class: "mxs-gl" }, ...rows), el("button", { class: "chip mxs-c2", type: "button", onclick: () => { MXS.blank++; mxsPaint(); const f = MXS.root.querySelectorAll(".mxs-g .mxs-in:not(.s)"); if (f.length) f[f.length - 1].focus(); } }, icon("add"), "받는 사람 추가")];
}

/* ---- the settings screen ---- */
function mxsItem(key, label, sum, body) {
  const open = MXS.open === key;
  return el("div", { class: `mxs-ac${open ? " open" : ""}` }, el("button", { class: "mxs-ah", type: "button", "aria-expanded": String(open), "data-k": key, onclick: () => mxsToggle(key) }, el("span", { class: "mxs-al", text: label }), el("span", { class: "mxs-av", text: open ? "" : sum }), icon("drop")),
    open ? el("div", { class: "mxs-ab" }, ...body()) : null);
}
const mxsToneUrl = (app, box) => `/api/mailbox/tone?app=${enc(app)}&box=${enc(box)}`;
function mxsToggle(key) {
  MXS.open = MXS.open === key ? "" : key; MXS.add = "";
  mxsPaint();
  if (MXS.open !== "tone") return;
  const a = MX.accts.get(MX.acct), k = `${a.key}|${MX.box}`;
  MXS.tone.set(k, { busy: true });
  api(mxsToneUrl(a.key, MX.box)).then(r => MXS.tone.set(k, r), e => { MXS.tone.set(k, { failed: true }); toast(mxsErr(e), true); }).then(mxsPaint);
}
// 말투 of a mailbox among several: where its voice comes from, what 다시 배우기 and 예시 보기 reach (docs/mailbox.md "Voice").
const mxsVoiceText = v => ({
  own: `보낸 글 ${v.texts}개로 따로 배웠어요`,
  kept: "이 메일함에 따로 적어 둔 말투를 써요",
  ready: `보낸 글 ${v.count}개가 모였어요. 곧 따로 배워요`,
  few: `이 메일함에서 보낸 글이 ${v.count}개라 계정 말투를 써요. ${v.need}개부터 따로 배워요`,
})[v.state];
const MXS_LEARNT = { learned: "말투를 다시 배웠어요", few: "보낸 메일을 더 읽어 볼게요. 모이면 알아서 배워요", busy: "이미 배우고 있어요", empty: "말투를 찾지 못해 그대로 뒀어요" };
async function mxsRelearn(a, b) {
  const k = `${a.key}|${b.id}`, was = MXS.tone.get(k);
  MXS.tone.set(k, { ...was, learning: true }); mxsPaint();
  try {
    const r = await api("/api/mailbox/relearn", "POST", { app: a.key, box: b.id });
    MXS.tone.set(k, await api(mxsToneUrl(a.key, b.id)));
    toast(MXS_LEARNT[r.result]);
  } catch (e) { MXS.tone.set(k, was); toast(mxsErr(e), true); }
  mxsPaint();
}
async function mxsExamples(a, b) {
  let list;
  try { list = (await api(`/api/mailbox/examples?app=${enc(a.key)}&box=${enc(b.id)}`)).examples; } catch (e) { toast(mxsErr(e), true); return; }
  const h = fsOpen({ label: "예시 보기", cls: "mid" });
  h.box.append(fsHead([el("div", { class: "fs-t", text: "예시 보기" })], { close: () => h.close() }), el("div", { class: "mxs-ex" }, ...list.map(x => el("div", { class: "mxs-exi" }, el("div", { class: "mxs-k", text: "받은 메일" }), el("div", { class: "mxs-h", text: x.received }), el("div", { class: "mxs-k", text: "내가 쓴 답장" }), el("div", { class: "mxs-sum", text: x.reply })))));
}
function mxsVoiceRow(a, b, t) {
  const v = t.voice;
  return [el("div", { class: "mxs-rowb" }, el("span", { class: "mxs-h", text: t.learning ? "지난 메일을 다시 읽고 있어요" : mxsVoiceText(v) }),
    el("span", { class: "mxs-vb" }, el("button", { class: "btn tonal sm mxs-vx", type: "button", disabled: !v.count, onclick: () => mxsExamples(a, b) }, "예시 보기"),
      el("button", { class: "btn tonal sm mxs-vl", type: "button", disabled: !!t.learning, onclick: () => mxsRelearn(a, b) }, "다시 배우기"))),
    b.how ? el("div", { class: "mxs-h", text: "기본 지시가 배운 말투보다 먼저예요" }) : null];
}
function mxsToneBody(a, b) {
  const t = MXS.tone.get(`${a.key}|${b.id}`) || { busy: true }, more = MXS.more.has("fix");
  if (t.busy) return [el("div", { class: "mxs-h", text: "불러오는 중이에요" })];
  if (t.failed) return [el("div", { class: "mxs-h", text: "말투를 읽지 못했어요" })];
  const fixes = more ? t.corrections : t.corrections.slice(0, MXS_FIX);
  // No tone yet: say how one comes to exist (the sent mails are read by themselves); a single mailbox has no voice row, so 다시 배우기 comes with the line.
  return [t.summary ? el("div", { class: "mxs-sum", text: t.summary }) : el("div", { class: "mxs-h", text: "아직 정리된 말투가 없어요. 보낸 메일이 모이면 알아서 배워요." }),
    !t.summary && t.voice.state === "single" ? el("button", { class: "btn tonal sm mxs-vl", type: "button", disabled: !!t.learning, onclick: () => mxsRelearn(a, b) }, "다시 배우기") : null,
    ...(t.voice.state !== "single" ? mxsVoiceRow(a, b, t) : [t.own || !t.summary ? null : el("div", { class: "mxs-h", text: "이 메일함만의 말투는 아직 없어요." })]),
    t.corrections.length ? el("div", { class: "mxs-k", text: "고친 점" }) : null, t.corrections.length ? el("ul", { class: "mxs-fx" }, ...fixes.map(f => el("li", { text: f }))) : null,
    t.corrections.length > MXS_FIX && !more ? el("button", { class: "chip mxs-c2", type: "button", onclick: () => { MXS.more.add("fix"); mxsPaint(); } }, `더 보기 · ${t.corrections.length - MXS_FIX}개`) : null];
}
const mxsCondSum = b => [...MXS_KINDS.filter(([k]) => b.conds[k].length).map(([k, l]) => `${l} ${b.conds[k].length}`), b.not.from.length ? `제외 ${b.not.from.length}` : ""].filter(Boolean).join(" · ") || "기준 없음";
const mxsFirst = (l, none = "없음") => (l.length ? l[0] + (l.length > 1 ? ` 외 ${l.length - 1}개` : "") : none);
function mxsSetNodes() {
  const a = MX.accts.get(MX.acct), b = a && a.byId.get(MX.box);
  if (!b) return [el("div", { class: "empty", text: "지운 메일함이에요" })];
  const ap = mxsSetApply(a.key, b.id), mails = mxsMails(a, b), unread = mails.filter(t => mailUnread(t, MAILS.get(t))).length, drafts = !b.mode || b.mode === "auto" || b.mode === "ask";
  const text = (get, set, ph, label, rows) => el(rows ? "textarea" : "input", { class: `fi${rows ? " mxs-ta" : ""}`, ...(rows ? { rows } : { value: get }), placeholder: ph, "aria-label": label, onchange: ev => ap(x => set(x, ev.target.value.trim()), false) }, rows ? get : null);
  const nameBody = () => [el("input", { class: "fi", value: b.name, "aria-label": "메일함 이름", onchange: ev => {
    const v = ev.target.value.trim();
    if (v) ap(x => { x.name = v; }, false); else { ev.target.value = b.name; toast("이름을 비워 둘 수 없어요", true); }
  } }), mxsIcons(b, ap)];
  const tt = MXS.tone.get(`${a.key}|${b.id}`), toneSum = tt && tt.voice ? (tt.summary ? "있음" : "없음") : "보기";
  const reply = [["tone", "말투", toneSum, () => mxsToneBody(a, b)], ["how", "기본 지시", b.how ? b.how.slice(0, 24) : "없음", () => [text(b.how, (x, v) => { x.how = v; }, "이 메일함의 초안을 쓸 때마다 지킬 말", "기본 지시", 3)]],
    ["greet", "받는 사람별 인사", b.greets.length ? `${b.greets.length}명` : "없음", () => mxsGreets(b, ap)],
    ["files", "첨부 폴더", mxsFirst(b.folders), () => [mxsChips(b, "folders", "폴더 추가", "~/폴더", ap)]],
    ["bans", "금지 문구", b.bans.length ? `${b.bans.length}개` : "없음", () => [mxsChips(b, "bans", "문구 추가", "쓰지 않을 말", ap)]]];
  const quiet = b.mode === "quiet", srcs = b.conds.src.length;
  const match = b.base ? mxsRow("분류 기준", `기준이 없어요. ${MX.accts.size > 1 ? `${a.label} 계정의 ` : ""}다른 메일함에 맞지 않는 메일이 모두 여기로 와요.`, el("span", { class: "tag", text: "기본" }))
    : mxsItem("match", "분류 기준", mxsCondSum(b), () => [...mxsConds(b, ap), srcs ? el("div", { class: "mxs-h", text: `처음부터 정해진 분류 기준 ${srcs}개도 함께 쓰여요. 여기서는 바꾸지 않아요.` }) : null]);
  return [mxsHead(b, `메일 ${mails.length}통 · 안 읽음 ${unread}`), MXS.note ? el("div", { class: "mxs-note", text: MXS.note }) : null,
    mxsSec("처리 방식"), mxsTiles(b.mode, m => ap(x => { if (x.mode === "quiet" && m !== "quiet") x.notify = true; x.mode = m; })),
    b.base && b.mode ? el("button", { class: "btn text sm mxs-inh", type: "button", onclick: () => ap(x => { delete x.mode; }) }, "앱 설정대로 되돌리기") : null,
    mxsSec("이 메일함"), el("div", { class: "list" }, MX.accts.size > 1 ? mxsRow("계정", a.account ? `답장은 메일을 받은 주소 ${a.account}에서 나가요` : "", el("span", { class: "mxs-am2" }, mxMark(a), a.label)) : null, mxsItem("name", "이름", b.name, nameBody), match,
      b.base ? null : mxsItem("judge", "판단 조건", b.judge.on ? b.judge.text || "켜짐" : "꺼짐", () => mxsJudge(b, ap))),
    mxsSec("답장 쓸 때"), drafts || MXS.reply === b.id ? el("div", { class: "list" }, ...reply.map(([k, l, s, body]) => mxsItem(k, l, s, body)))
      : el("div", { class: "list" }, el("button", { class: "li", type: "button", onclick: () => { MXS.reply = b.id; mxsPaint(); } }, el("span", { class: "tx" }, el("span", { class: "hd", text: "말투와 기본 지시" }), el("span", { class: "sup", text: `${MXS_MODES[b.mode][0]} 메일함은 초안을 쓰지 않아서 접어 뒀어요` })), icon("drop"))),
    mxsSec("알림"), el("div", { class: "list" }, mxsRow("알림 켜기", quiet ? "조용히 모으는 메일함은 알리지 않아요" : "", mxsSw(!quiet && b.notify !== false, "알림 켜기", () => ap(x => { x.notify = x.notify === false; }), quiet))),
    b.base ? null : el("div", { class: "mxs-del" }, el("button", { class: "btn danger sm", type: "button", onclick: () => mxsDelete(a, b) }, "메일함 삭제"))];
}
async function mxsDelete(a, b) {
  const n = mxsMails(a, b).length;
  if (!(await ask(`${b.name} 삭제`, `${n ? `메일 ${n}통은` : "이 메일함의 메일은"} 일반으로 옮겨요. 메일은 지워지지 않아요.`, "삭제", true))) return;
  try { await api("/api/mailbox/box", "DELETE", { app: a.key, id: b.id }); } catch (e) { toast(mxsErr(e), true); return; }
  await Promise.allSettled([loadIntegrations(), convLoad()]);
  MX.box = a.base.id;
  MX.scr = "";
  mxsGo("");
  toast(`${b.name} 메일함을 삭제했어요`);
}

/* ---- 메일함 추가 ---- */
function mxsSuggest(app) {
  if (MXS.sugFor === app) return;
  MXS.sugFor = app; MXS.sug = null;
  api(`/api/mailbox/suggest?app=${enc(app)}`).then(r => r.groups || [], e => { toast(mxsErr(e), true); return []; }).then(g => { if (MXS.sugFor === app) { MXS.sug = g; mxsPaint(); } });
}
const mxsStart = (d, patch) => { Object.assign(d, patch, { step: "setup" }); mxsPaint(); };
const mxsAcctRow = d => { const a = MX.accts.get(d.acct); return MX.accts.size > 1 && a ? [mxsSec("계정"), el("div", { class: "list" }, mxsRow(a.label, a.account, el("button", { class: "btn text sm", type: "button", onclick: () => { d.acct = ""; d.step = "start"; MXS.sugFor = ""; mxsPaint(); } }, "바꾸기")))] : []; };
function mxsPickNodes(d) {
  return [mxsSec("어느 계정에 만들까요?"), el("div", { class: "list" }, ...[...MX.accts.values()].map(a => a.conn ? mxsRow(a.label, `${a.account} · 로그인이 풀렸어요`) : el("button", { class: "li", type: "button", onclick: () => { d.acct = a.key; mxsPaint(); } },
    el("span", { class: "tx" }, el("span", { class: "hd", text: a.label }), el("span", { class: "sup", text: `${a.account} · 메일함 ${a.boxes.length}개` })), icon("chev"))))];
}
function mxsStartNodes(d) {
  mxsSuggest(d.acct);
  const groups = MXS.sug, row = (title, sup, onclick, n) => el("button", { class: n ? "li mxs-sg" : "li", type: "button", onclick }, el("span", { class: "tx" }, el("span", { class: "hd", text: title }), el("span", { class: "sup", text: sup })), n ? el("span", { class: "mxs-cnt", text: n }) : null, icon("chev"));
  const copyable = [...MX.accts.values()].flatMap(a => a.boxes.filter(b => !b.base).map(b => ({ a, b })));
  return [...mxsAcctRow(d), mxsSec("메일을 보니 이런 묶음이 있어요"), el("div", { class: "list" }, ...(groups === null ? [el("div", { class: "empty", text: "묶음을 찾는 중이에요" })] : groups.length ? groups.map(g => row(g.label, `${g.domain} · ${g.senders.join(", ")}`,
    () => mxsStart(d, { name: g.label, conds: { from: [g.domain], subj: [], body: [] }, keys: g.keys, count: g.count }), `메일 ${g.count}통`)) : [el("div", { class: "empty", text: "지금은 눈에 띄는 묶음이 없어요" })])),
  mxsSec("직접 만들기"), el("div", { class: "list" }, row("빈 메일함으로 시작", "이름과 조건을 직접 정해요", () => mxsStart(d, {})),
    copyable.length ? row("다른 메일함 설정 복사", "같은 처리 방식과 기본 지시를 다시 적지 않아도 돼요", () => { d.step = "copy"; mxsPaint(); }) : null)];
}
function mxsCopyNodes(d) {
  return [...mxsAcctRow(d), mxsSec("어느 메일함 설정을 가져올까요?"), el("div", { class: "list" }, ...[...MX.accts.values()].flatMap(a => a.boxes.filter(b => !b.base).map(b => el("button", { class: "li", type: "button", onclick: () => mxsStart(d, structuredClone({ name: b.name, icon: b.icon, mode: b.mode || "ask", conds: { from: b.conds.from, subj: b.conds.subj, body: b.conds.body }, judge: b.judge, how: b.how, greets: b.greets, folders: b.folders, bans: b.bans, copied: b.name })) },
    el("span", { class: "tx" }, el("span", { class: "hd", text: b.name }), el("span", { class: "sup", text: `${MX.accts.size > 1 ? `${a.label} · ` : ""}${b.mode ? MXS_MODES[b.mode][0] : "기본 방식"} · ${mxsCondSum(b)}` })), icon("chev"))))),
  el("div", { class: "mxs-h", text: "원래 메일함은 바뀌지 않아요." })];
}
function mxsSetupNodes(d) {
  const ap = mxsNewApply(), base = MX.accts.get(d.acct).base.name, fix = (node, f) => node.addEventListener("input", f);
  const name = el("input", { class: "fi", value: d.name, placeholder: "예: 강의 자료", "aria-label": "메일함 이름" });
  fix(name, () => { d.name = name.value; const go0 = MXS.root.querySelector("[data-mxs-go]"); if (go0) go0.disabled = !d.name.trim() || d.busy; });
  return [...mxsAcctRow(d), mxsSec("이름"), el("div", { class: "list mxs-pad" }, name, mxsIcons(d, ap)), mxsSec("처리 방식"), mxsTiles(d.mode, m => ap(x => { x.mode = m; })),
    mxsSec("분류 기준"), el("div", { class: "list mxs-pad" }, ...mxsConds(d, ap), ...mxsJudge(d, ap)),
    d.keys.length ? mxsSec("지금 있는 메일") : null, d.keys.length ? el("div", { class: "list" }, mxsRow(`메일 ${d.keys.length}통도 옮기기`, d.count > d.keys.length ? `보낸 사람이 같은 메일 ${d.count}통 중 최근 ${d.keys.length}통만 옮겨요` : "옮기지 않으면 지금 있는 메일은 그대로 있어요", mxsSw(d.bring, "지금 있는 메일도 옮기기", () => ap(x => { x.bring = !x.bring; })))) : null,
    el("div", { class: "mxs-h", text: `${d.copied ? `${d.copied} 설정을 가져왔어요. 분류 기준이 이 계정에 맞는지만 봐 주세요. ` : "말투와 기본 지시는 만든 뒤 설정에서 정해요. "}맞지 않는 메일은 계속 ${base}으로 가요.` }),
    el("div", { class: "mxs-foot" }, el("button", { class: "btn text", type: "button", onclick: () => { MXS.d = mxsBlank(d.acct); mxsPaint(); } }, "취소"), el("button", { class: "btn", type: "button", "data-mxs-go": "", disabled: d.name.trim() && !d.busy ? null : true, onclick: mxsCreate }, "메일함 만들기"))];
}
async function mxsCreate() {
  const d = MXS.d, name = d.name.trim();
  if (!name || d.busy) return;
  d.busy = true; mxsPaint();
  let made;
  try { made = (await api("/api/mailbox/box", "PUT", { app: d.acct, box: { name, icon: d.icon, mode: d.mode, notify: d.mode !== "quiet", conds: d.conds, judge: d.judge, how: d.how, greets: d.greets, folders: d.folders, bans: d.bans } })).box; } catch (e) { d.busy = false; toast(mxsErr(e), true); mxsPaint(); return; }
  let moved = true;
  if (d.bring && d.keys.length) try { await api("/api/mailbox/move", "POST", { keys: d.keys, box: made.id }); } catch (e) { moved = false; toast(`${name} 메일함은 만들었지만 메일은 옮기지 못했어요`, true); }
  await Promise.allSettled([loadIntegrations(), convLoad()]);
  MX.acct = d.acct; MX.box = made.id; MX.scr = "";
  mxsGo("");
  if (moved) toast(`${name} 메일함을 만들었어요`);
}
function mxsNewNodes() {
  const d = MXS.d ??= mxsBlank(MX.acct !== "all" ? MX.acct : MX.accts.size === 1 ? [...MX.accts.keys()][0] : "");
  if (d.acct && !MX.accts.has(d.acct)) d.acct = "";
  return [...(!d.acct ? mxsPickNodes(d) : d.step === "setup" ? mxsSetupNodes(d) : d.step === "copy" ? mxsCopyNodes(d) : mxsStartNodes(d))];
}

/* ---- the node in the timeline ---- */
function mxsPaint() {
  if (!MXS.root || !MX.scr) return;
  clear(MXS.root).append(...(MX.scr === "set" ? mxsSetNodes() : mxsNewNodes()).filter(Boolean));
}
function mxScreen() {
  MXS.root ??= el("div", { class: "mxs" });
  mxsPaint();
  return [MXS.root];
}
