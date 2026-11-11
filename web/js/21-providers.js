/* ---------- providers ---------- */
async function loadProviderData() {
  const r = await api("/api/providers");
  P = { providers: r.providers || [], addable: Array.isArray(r.addable) ? r.addable : null, at: Date.now() };
  return P;
}
// Opening settings reads the providers again only when the last read is older than a minute.
const provFresh = () => !!P && Date.now() - P.at < 60000;
let provFail = false;
async function loadProviders() {
  try { await loadProviderData(); provFail = false; }
  catch (e) { provFail = !P; }
  if (current === "accounts") renderAccounts();
}
// A usage window in plain Korean: the report's "Claude 5 Hour" / "Claude 7 Day Opus" read as 5시간 한도 / 7일 한도 Opus.
function limitName(l) {
  const m = /^Claude\s+(\d+)\s+(Hour|Day)s?\b\s*(.*)$/i.exec(l.label || "");
  return m ? `${m[1]}${/hour/i.test(m[2]) ? "시간" : "일"} 한도${m[3] ? ` ${m[3]}` : ""}` : l.label || l.id;
}
// The window name without the word 한도, for the usage lines at the top of an account card: 5시간, 7일, 7일 Opus.
const limitShort = l => (/^Claude\s/i.test(l.label || "") ? limitName(l).replace(" 한도", "") : limitName(l));
// The usage windows the report holds for one provider (the ones with a figure).
function provLimits(p) {
  const q = typeof SQ !== "undefined" && SQ ? (SQ.providers || []).find(x => x.provider === p.id || (p.id === "anthropic" && x.provider === "claude")) : null;
  return q ? (q.limits || []).filter(l => limitFrac(l) != null) : [];
}
// One provider's row on the 계정 screen: its way in (login or key), status, usage windows and actions. In a provider's own section
// (`own`) the section head names it; in 다른 공급자 the row does, and a key with a pool entry opens its alias.
function provRow(p, g, own) {
  const on = isConnected(p), key = p.auth === "api_key", tone = on ? "ok" : needsAttention(p) ? "warn" : "";
  const out = key ? "키 삭제" : "로그아웃";
  const act = p.can_add_account ? null
    : p.can_login ? el("button", { class: `btn inrow ${on ? "text" : "tonal"}`, type: "button", onclick: () => startLogin(p) }, on ? "다시 로그인" : "로그인") : null;
  const rm = (p.can_logout ?? p.removable) ? el("button", { class: "ib", type: "button", title: out, "aria-label": out, onclick: ev => busy(ev.currentTarget, () => logoutProvider(p)) }, icon("trash")) : null;
  const slot = key && g ? g.accounts[0] : null;
  const sub = [slot && slot.label !== "API 키" ? slot.label : "", p.account ? accName(p.account) : p.masked || "", p.in_use ? "지금 사용 중" : "", p.accounts > 1 ? `계정 ${p.accounts}개` : ""].filter(Boolean).join(" · ");
  const tx = el("div", { class: "tx" }, el("div", { class: "heads" }, el("span", { class: "hd", text: own ? (key ? "API 키" : "로그인") : p.name || p.id }),
      own && on ? null : el("span", { class: `tag ${tone}`, text: p.auth === "oauth" ? "로그인됨" : key ? "API 키" : "연결 안 됨" })),
    sub ? el("div", { class: "sup", text: sub }) : null,
    ...provLimits(p).map(l => el("div", { class: "prow-lim" }, el("span", { class: "k", text: limitName(l) }), bar(l), el("span", { class: "v", text: pctText(l) }))));
  return el("div", { class: "li prow", "data-prov": own ? null : p.id, "data-prov-conn": p.id },
    slot ? el("button", { class: "acc-main", type: "button", onclick: () => accProviderDialog(g, slot) }, tx) : tx, liEnd(act, rm));
}
// 계정: one screen for what used to be 공급자, each provider's screen and the accounts block. OmO keeps a pool per provider, so the
// provider is the group: a login provider has its own section with its accounts, and the rest (keys, not set up) share one list.
function renderAccounts() {
  const box = $("#accounts");
  if (!P) { clear(box).append(emptyNode(provFail ? "계정을 불러오지 못했어요" : "불러오는 중…", provFail ? () => loadProviders() : null)); return; }
  const groupOf = p => ((ACC && ACC.providers) || []).find(x => x.id === p.id);
  const own = p => p.auth === "oauth" || (p.id === "anthropic" && ACC && ACC.accounts.length > 0) || (groupOf(p) || {}).multi;
  const list = P.providers, rest = list.filter(p => !own(p));
  const wrap = el("div", {}, el("div", { class: "tools-bar" }, el("span", { class: "sup", text: `${list.filter(isConnected).length}개 연결` }),
    el("button", { class: "btn tonal sm", type: "button", onclick: () => addProviderDialog() }, icon("add"), "공급자 추가")));
  if (!list.length) wrap.append(emptyNode("공급자가 없어요"));
  for (const p of list.filter(own)) wrap.append(...accSection(p, groupOf(p), provRow(p, groupOf(p), true)));
  // the ones that can log in come first, then the API keys and the providers not set up yet
  const canLogin = p => p.auth === "none" && p.can_login;
  if (rest.length) wrap.append(el("div", { class: "sec", text: "다른 공급자" }), el("div", { class: "list" }, ...[...rest.filter(canLogin), ...rest.filter(p => !canLogin(p))].map(p => provRow(p, groupOf(p), false))));
  clear(box).append(wrap);
  // an old provider address or a home card lands on that provider, once both lists are in
  if (accFocus && ACC) { const n = box.querySelector(`[data-prov="${CSS.escape(accFocus)}"]`); accFocus = ""; if (n) n.scrollIntoView({ block: "start" }); }
}
function addProviderDialog() {
  const addable = P && P.addable;
  let pick = null, keyIn = null, free = null;
  const body = el("div", { class: "col", style: "gap:var(--sp-4)" });
  const keyBox = el("div", { class: "col kb" });
  const rowsByKey = new Map();
  let dlg;
  function paintKey() {
    clear(keyBox); keyIn = null;
    for (const [id, n] of rowsByKey) { n.classList.toggle("on", !!pick && pick.id === id); n.setAttribute("aria-pressed", pick && pick.id === id ? "true" : "false"); }
    if (pick && pick.kind === "api_key") { keyIn = input({ type: "password", autocomplete: "new-password" }); keyBox.append(textField(free ? "API 키" : `${pick.name || pick.id} API 키`, keyIn)); if (!free) keyIn.focus(); }
    const actions = pick && pick.kind === "api_key" ? [{ label: "취소", kind: "tonal", onclick: c => c() }] : [];   // only a list to pick from: the ✕ is the one way out
    if (pick && pick.kind === "api_key") actions.push({ label: "저장", kind: "pri", onclick: (c, btn) => busy(btn, async () => {
      const provider = free ? free.value.trim() : pick.id, key = keyIn.value;
      if (!provider || !key.trim()) { toast("공급자와 API 키를 입력해 주세요", true); return; }
      try { await api("/api/providers", "POST", { provider, key }); } finally { keyIn.value = ""; }
      c(); toast("저장했어요"); loadProviders(); loadModels(true);
    }) });
    dlg && dlg.setActions(actions);
  }
  const group = (title, items) => {
    const box = el("div", {}, el("div", { class: "sec", text: title }), el("div", { class: "list" }));
    for (const a of items) {
      const n = el("button", { type: "button", class: "li tap", "aria-pressed": "false", onclick: () => {
        if (a.kind === "oauth") { dlg.close(); startLogin(a); return; }
        pick = a; paintKey();
      } }, el("span", { class: "avatar", text: [...(a.name || a.id)][0] || "?" }), el("span", { class: "tx" }, el("div", { class: "hd", text: a.name || a.id })),
        liEnd(a.add_account ? el("span", { class: "sup", text: "계정 추가" }) : null, icon("chev")));   // the whole row is the tap target: the section says login or key, the arrow says it opens
      rowsByKey.set(a.id, n); box.lastChild.append(n);
    }
    return box;
  };
  if (addable) {
    const login = addable.filter(a => a.kind === "oauth"), keys = addable.filter(a => a.kind !== "oauth");
    if (!addable.length) body.append(el("p", { text: "추가할 공급자가 없어요" }));
    else {
      const pk = el("div", { class: "pickbox" });
      if (login.length) pk.append(group("로그인", login));
      if (keys.length) pk.append(group("API 키", keys));
      body.append(pk, keyBox);
    }
  } else { free = input({ type: "text" }); pick = { kind: "api_key" }; body.append(textField("공급자", free), keyBox); }
  dlg = dialog({ title: "공급자 추가", body, mid: true });
  if (addable && !addable.length) dlg.setActions([]);
  else paintKey();
}
// A login still open (a closed tab, /login in the chat) blocks a new one: pick it up where it stopped, or drop it and start over.
function pendingLoginAsk(p, pending) {
  const same = pending.provider === p.id;
  const go = mode => c => { c(); startLogin(p, mode); };
  dialog({ confirm: true, title: "끝나지 않은 로그인이 있어요",
    body: same ? null : el("p", { text: `지금 ${providerName(pending.provider)} 로그인이 열려 있어요.` }),
    actions: [{ label: "닫기", onclick: c => c() }, ...(same
      ? [{ label: "새로 시작", onclick: go("restart") }, { label: "이어서 하기", kind: "pri", onclick: go("resume") }]
      : [{ label: "새로 시작", kind: "pri", onclick: go("restart") }])] });
}
async function startLogin(p, pending) {
  let r;
  try { r = await api(`/api/providers/${enc(p.id)}/login`, "POST", pending ? { pending } : {}); }
  catch (e) {
    if (!pending && e.data && e.data.pending) pendingLoginAsk(p, e.data.pending);
    else toast(e.message, true);
    return;
  }
  const name = p.name || p.id;
  let finished = false, timer, dlg;
  const code = input({ type: "text" });
  const msg = el("p", { class: "err-t", hidden: true });
  // A sign-in can ask its questions first (Claude: account name, then method) and name the page only in a later step, so the
  // dialog shows the step it is on: a question is the field's label with its default filled in, a choice is a list of rows,
  // and the page link and the code field come with the URL.
  const label = el("label", { for: code.id });
  const field = el("div", { class: "tf" }, label, code);
  const intro = el("p", { hidden: true });
  const picks = el("div", { class: "list", hidden: true });
  const ask = el("div", { class: "sup", hidden: true });
  // One filled button at a time: the page link leads until it was opened, then 완료 does.
  const open = el("a", { class: "btn", target: "_blank", rel: "noopener noreferrer" }, icon("open"), "로그인 페이지 열기");
  const openBox = el("div", {}, open);
  let lastUrl = "", opened = false, choosing = false;
  const paintActs = () => dlg.setActions([{ label: "취소", kind: "tonal", onclick: c => c() },
    ...(choosing ? [] : [{ label: "완료", kind: openBox.hidden || opened ? "pri" : "tonal", onclick: (c, btn) => submit(btn) }])]);
  open.addEventListener("click", () => { opened = true; open.className = "btn tonal"; paintActs(); });
  const paintStep = v => {
    if (/^https?:\/\//.test(v.url || "")) { if (v.url !== lastUrl) opened = false; lastUrl = v.url; }
    const choose = !!(v.options && v.options.length), url = !choose && !!lastUrl, question = !choose && !url && !!v.prompt;
    intro.textContent = choose ? v.prompt || "" : ""; intro.hidden = !choose || !v.prompt;
    clear(picks); picks.hidden = !choose;
    for (const o of choose ? v.options : []) picks.append(el("button", { type: "button", class: "li tap", onclick: ev => { code.value = o; submit(ev.currentTarget); } },
      el("span", { class: "tx" }, el("div", { class: "hd", text: o })), icon("chev", "lead")));
    field.hidden = choose;
    label.textContent = question ? v.prompt : "코드 또는 주소";
    code.value = question && v.placeholder ? v.placeholder : "";
    code.placeholder = question && v.placeholder ? v.placeholder : "";
    ask.textContent = url ? v.prompt || "" : ""; ask.hidden = !url || !v.prompt;
    if (url) open.href = lastUrl; else open.removeAttribute("href");
    openBox.hidden = !url;
    open.className = opened ? "btn tonal" : "btn";
    choosing = choose;
    paintActs();
  };
  const stop = () => { clearTimeout(timer); };
  // the hub says what the login did to the pool: a new account, or one it already held and refreshed (hub/providers.ts loginResult)
  const success = async s => {
    finished = true; stop(); dlg.close();
    toast(s.outcome === "refreshed" ? `이미 등록된 계정이에요 (${accLabel(s.account)}). 로그인을 새로 고쳤어요` : s.outcome === "added" ? `계정을 추가했어요 (${s.account})` : `${name} 로그인했어요`);
    try { await loadProviderData(); } catch {}
    if (current === "accounts") renderAccounts();
    if (current === "home") renderHome();
    loadModels(true);
    loadAccounts();
  };
  const fail = text => { msg.textContent = text; msg.hidden = false; };
  const poll = async () => {
    try {
      const s = await api(`/api/providers/${enc(p.id)}/login?login_id=${enc(r.login_id)}`);
      if (finished) return;
      if (s.status === "done") { success(s); return; }
      if (s.status === "failed") { stop(); fail(s.error || "로그인에 실패했어요"); return; }
    } catch {}
    if (!finished) timer = setTimeout(poll, 2000);
  };
  const submit = btn => busy(btn, async () => {
    const v = code.value.trim() || code.placeholder;
    if (!v) { fail("코드나 주소를 붙여 넣어 주세요"); return; }
    msg.hidden = true;
    stop();
    try {
      const s = await api(`/api/providers/${enc(p.id)}/login/complete`, "POST", { login_id: r.login_id, code: v });
      // a sign-in with more than one step answers with the next question instead of finishing
      if (s.status === "waiting") { paintStep(s); code.focus(); timer = setTimeout(poll, 2000); return; }
      await success(s);
    }
    catch (e) { fail(e.message); if (!finished) timer = setTimeout(poll, 2000); }
  });
  dlg = dialog({
    title: p.can_add_account || p.add_account ? `${name} 계정 추가` : `${name} 로그인`,
    body: [intro, openBox, field, ask, picks, msg], mid: true,
    onclose: () => { stop(); if (!finished) api(`/api/providers/${enc(p.id)}/login`, "DELETE").catch(() => {}); },
  });
  paintStep(r);
  code.addEventListener("keydown", ev => { if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); const b = dlg.node.querySelector(".dact .btn:last-child"); if (b) b.click(); } });
  timer = setTimeout(poll, 2000);
}

/* ---------- usage ---------- */
let quotaTimer;
// 리셋권 of one account (hub/codex-usage.ts, Claude: hub/usage-account.ts claudeResets): how many it holds (Claude: by kind) and the nearest
// expiry. 사용 works only with one usable, and asks first, naming the pass (Claude) or the limits it refills and how many stay; only that
// confirm sends POST /api/quota/reset-credit with confirm: true.
// A Claude account draws one row per kind (주간, Fable, ...), each with its own count, expiry and grant; without kinds, and for Codex, one row.
function resetRow(p, name) {
  const ks = p.provider === "anthropic" && p.resets.kinds && p.resets.kinds.length ? p.resets.kinds : [null];
  return ks.map(k => resetLine(p, name, k));
}
function resetLine(p, name, k) {
  const r = p.resets, claude = p.provider === "anthropic", wins = (p.limits || []).map(limitName).join("와 ");
  const held = k ? k.left : r.held, usable = k ? k.usable : r.usable, expires = k ? k.expires_at : r.expires_at, grant = k ? (k.grant_id ? { id: k.grant_id, kind: k.kind } : null) : r.grant;
  const label = k ? `${k.kind} 리셋권` : "리셋권";
  const why = !claude && r.held && !r.usable ? "한도에 걸리면 쓸 수 있어요" : "";
  const sub = [held && expires ? `${dayLabel(expires)} 만료` : "", why].filter(Boolean).join(" · ");
  const say = { reset: "한도를 다시 채웠어요", nothing_to_reset: "다시 채울 한도가 없어서 쓰지 않았어요", not_limited: "다시 채울 한도가 없어서 쓰지 않았어요", no_credit: "남은 리셋권이 없어요", already_redeemed: "이미 쓴 리셋권이에요", already_used: "이미 쓴 리셋권이에요", cooldown: "조금 뒤에 다시 쓸 수 있어요" };
  const what = claude ? `${p.account_label || p.account}의 ${grant ? `${grant.kind} ` : ""}리셋권으로 한도를` : `${p.account}의 ${wins || "한도"}를`;
  const send = claude ? { provider: "anthropic", account: p.account, grant_id: grant && grant.id, confirm: true } : { account: p.account, confirm: true };
  const use = () => dialog({ confirm: true, title: "리셋권을 쓸까요?",
    body: el("div", { class: "sup", text: `${name} ${what} 지금 다시 채워요. 쓰고 나면 ${label}이 ${held - 1}개 남아요. 되돌릴 수는 없어요.` }),
    actions: [{ label: "취소", onclick: c => c() }, { label: "리셋권 쓰기", kind: "pri", onclick: (c, b) => busy(b, async () => {
      // whatever the answer, the usage is read again so the percent and the 리셋권 count on screen are the server's
      try { const out = await api("/api/quota/reset-credit", "POST", send); c(); toast(say[out.outcome] || "리셋권을 썼어요"); }
      catch (e) { c(); toast(e.message || "리셋권을 쓰지 못했어요", true); }
      finally { loadQuota(true); }
    }) }] });
  return el("div", { class: "lim rc" },
    el("div", { class: "kv" }, el("span", { class: "k", text: label }),
      el("span", { class: "rc-end" }, el("b", { text: `${held}개` }), el("button", { class: "btn tonal inrow", type: "button", disabled: !(held > 0 && usable), "aria-label": `${name} ${label} 사용`, onclick: use }, "사용"))),
    sub ? el("div", { class: "sup", text: sub }) : null);
}
// The bar above the cards: when it was read, and the one 새로고침 (also the way out of a failed read: no second retry button).
const quotaBar = at => el("div", { class: "tools-bar" }, el("span", { class: "sup", text: at ? monTime(at) : "" }),
  el("button", { class: "btn text sm", type: "button", onclick: ev => busy(ev.currentTarget, () => loadQuota(true)) }, icon("refresh"), "새로고침"));
async function loadQuota(fresh) {
  clearTimeout(quotaTimer);
  const box = $("#usage");
  if (!box.firstChild) box.append(emptyNode("불러오는 중…"));
  let q;
  // the cards are titled by provider name (providerName reads P), so a direct open of 사용량 loads the providers too
  try { [q] = await Promise.all([api(fresh === true ? "/api/quota?fresh=1" : "/api/quota"), P ? null : loadProviderData().catch(() => null)]); }
  catch (e) { clear(box).append(quotaBar(""), emptyNode("사용량을 불러오지 못했어요")); return; }
  noteQuota(q);
  if (current === "usage") quotaTimer = setTimeout(loadQuota, 60000);
  clear(box);
  box.append(quotaBar(q.fetched_at));
  const grid = el("div", { class: "grid" });
  for (const p of q.providers || []) {
    // a subscription names its plan as Anthropic does (Pro, Max 5x, Max 20x, Ultra, ...; hub/usage-account.ts planName)
    const name = p.name || providerName(p.provider);
    const card = el("div", { class: "card" }, el("div", { class: "ch lo" }, el("h3", { text: p.plan ? `${name} · ${p.plan}` : name })));
    for (const l of p.limits || []) {
      card.append(el("div", { class: "lim" },
        el("div", { class: "kv" }, el("span", { class: "k", text: limitName(l) }), el("b", { text: pctText(l) })),
        bar(l),
        l.resets_at ? el("div", { class: "sup", text: rel(l.resets_at) }) : null));
    }
    if (!(p.limits || []).length) card.append(el("div", { class: "sup", text: "없어요" }));
    if (p.resets) card.append(...resetRow(p, name));
    grid.append(card);
  }
  // The monthly API spend limit the owner set on the platform console, and how much of it is used (hub/api-budget.ts).
  if (q.budget) grid.prepend(budgetCard(q.budget));
  else box.append(el("div", { class: "list" }, budgetRow()));
  if (grid.children.length) box.append(grid);
  // The one Claude account the assistant and its lanes run on, and every switch with its reason (hub/account-sticky.ts).
  if (q.account && q.account.account) {
    const A = q.account, KIND = { start: "처음 선택", limit: "한도", owner: "직접 변경", gone: "계정 사라짐" };
    box.append(el("div", { class: "sec", text: "사용 계정" }));
    // The latest 5 switches (newest first); the older ones (the hub keeps 20) fold behind a toggle.
    const SHOWN = 5, all = A.switches || [];
    // Entries older than 3 days are pruned by the hub; the X deletes one entry, 모두 지우기 (confirmed) all of them (DELETE /api/accounts/switches).
    const drop = async (at, msg) => { try { await api(`/api/accounts/switches${at ? `?at=${enc(at)}` : ""}`, "DELETE"); toast(msg); loadQuota(); } catch (e) { toast("지우지 못했어요", true); } };
    // the why is said once: the reason line, or the kind when there is no reason
    const row = s => el("div", { class: "li" }, el("span", { class: "tx" },
      el("div", { class: "hd", text: `${s.from ? `${s.from_label || s.from} → ` : ""}${s.to_label || s.to}` }),
      el("div", { class: "sup", text: `${monTime(Date.parse(s.at))} · ${s.reason || s.kind_text || KIND[s.kind] || s.kind}` })),
      el("button", { class: "ib", type: "button", "aria-label": "이 기록 지우기", onclick: () => drop(s.at, "기록을 지웠어요") }, icon("close")));
    const older = all.slice(SHOWN).map(row);
    older.forEach(n => { n.hidden = true; });
    const more = older.length ? el("button", { class: "btn text", type: "button", text: `이전 기록 ${older.length}개 더 보기`, onclick: ev => {
      const open = older[0].hidden;
      older.forEach(n => { n.hidden = !open; });
      ev.currentTarget.textContent = open ? "이전 기록 접기" : `이전 기록 ${older.length}개 더 보기`;
    } }) : null;
    const cur = [A.since ? `${monTime(Date.parse(A.since))}부터` : "", A.pinned ? "고정한 계정이에요" : ""].filter(Boolean).join(" · ");
    box.append(el("div", { class: "list" },
      el("div", { class: "li", style: "display:block" }, el("div", { class: "hd", text: A.account_label || A.account }), cur ? el("div", { class: "sup", text: cur }) : null),
      ...all.slice(0, SHOWN).map(row), ...older));
    if (more) box.append(more);
    if (all.length) box.append(el("button", { class: "btn text danger", type: "button", text: "기록 모두 지우기", onclick: () => dialog({ confirm: true, title: "기록을 모두 지울까요?", body: el("div", { class: "sup", text: `계정 전환 기록 ${all.length}개를 지워요. 되돌릴 수 없어요.` }), actions: [{ label: "취소" , onclick: c => c() }, { label: "모두 지우기", kind: "danger fill", onclick: c => { c(); drop("", "기록을 모두 지웠어요"); } }] }) }));
  }
  if ((q.unavailable || []).length) {
    box.append(el("div", { class: "sec", text: "정보가 없어요" }));
    box.append(el("div", { class: "list" }, ...q.unavailable.map(u => el("div", { class: "li", style: "display:block" }, el("div", { class: "hd", text: u.name || providerName(u.provider) }), el("div", { class: "sup", text: u.reason })))));
  }
  if (!(q.providers || []).length && !(q.unavailable || []).length && !q.budget) box.append(emptyNode("사용량 정보가 없어요"));
}
