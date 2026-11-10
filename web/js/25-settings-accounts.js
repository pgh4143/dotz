/* ---------- settings: 계정 (/api/accounts: aliases, current account and why, switch rules, script) ---------- */
let ACC = null;
const ACC_DAYS = [["mon", "월"], ["tue", "화"], ["wed", "수"], ["thu", "목"], ["fri", "금"], ["sat", "토"], ["sun", "일"]];
const ACC_COND = [["", "없음"], ["five_hour_left_below", "5시간 남은 % 밑"], ["seven_day_left_below", "주간 남은 % 밑"], ["rate_limited", "한도 걸림"], ["auth_error", "로그인 풀림"], ["unavailable", "특정 계정 못 씀"]];
const ACC_DO = [["pin", "계정 고정"], ["prefer", "순서대로 우선"], ["auto", "자동"]];
const accTx = (hd, ...sup) => el("span", { class: "tx" }, hd ? el("div", { class: "hd", text: hd }) : null, sup.length ? el("div", { class: "sup" }, ...sup) : null);
async function loadAccounts() {
  try { ACC = await api("/api/accounts"); } catch { ACC = null; }
  accPaint();
}
let accFocus = "";   // the provider an old address or a home card asked for (21-providers.js renderAccounts)
const accPaint = () => { if (current === "accounts") renderAccounts(); else if (current === "settings") renderSettings(); };
// A provider's section head on the 계정 screen; `add` starts one more login for its pool.
const accHead = (p, g, add) => el("div", { class: "sec sec-act", "data-prov": p.id }, (g || p).name || p.id, add ? el("button", { class: "btn tonal sm", type: "button", "data-acc-add": "", onclick: () => startLogin({ id: p.id, name: (g || p).name || p.id, add_account: true }) }, icon("add"), "계정 추가") : null);
const accSection = (p, g, conn) => (p.id === "anthropic" ? accountSection(p, g, conn) : accProviderSection(p, g, conn));
const accLabel = id => { const a = ACC && ACC.accounts.find(x => x.name === id || x.alias === id); return a ? a.label || a.alias || a.name : id; };
const accMut = (btn, call, msg, close) => busy(btn, async () => { ACC = await call(); if (close) close(); if (msg) toast(msg); accPaint(); if (current === "usage") loadQuota(); });
async function accCopy(text) { try { await navigator.clipboard.writeText(text); toast("복사했어요"); } catch { toast("복사하지 못했어요", true); } }
function accTags(a, pin) {
  const t = [];
  // a.current: the account requests really use (OmO skips a blocked one); blocked_tag: "한도 걸림 · 01:00까지"
  // 고정: the fixed account (pin) carries the badge instead
  if (pin ? a.name === pin : a.current) t.push([pin ? "사용 중 · 고정" : "사용 중", "pri"]);
  if (a.blocked) t.push([a.blocked_tag || "쓸 수 없음", "warn"]);   // a limit or a login only the owner can fix: orange
  else if (!(pin ? a.name === pin : a.current)) t.push(["쓸 수 있음", "ok"]);
  return t;
}
// Drag a 계정 row to reorder: from its grip at once (after a 4px move), or after a long press on the row (touch; a move before that is a scroll).
// The row lifts, the rows it passes shift, and the drop calls onDrop(newIndex). The listeners live on the document, so a pointer that leaves the row keeps dragging.
let accSwallow = false; // the click that follows a drop must not pick the row; the next pointerdown clears it
function accDrag(ev, row, longPress, onDrop) {
  if (!row || !ev.isPrimary || (ev.pointerType === "mouse" && ev.button !== 0)) return;
  const list = row.parentNode, rows = [...list.querySelectorAll(":scope > .li.acc")], from = rows.indexOf(row);
  const rects = rows.map(r => r.getBoundingClientRect()), h = rects[from].height, y0 = ev.clientY, id = ev.pointerId;
  let to = from, dragging = false, timer = 0;
  const shift = (r, dy) => { r.style.transform = dy ? `translateY(${dy}px)` : ""; };
  const begin = () => { dragging = true; row.classList.add("drag"); list.classList.add("acc-dragging"); };
  const move = e => {
    if (e.pointerId !== id) return;
    const dy = e.clientY - y0;
    if (!dragging) {
      if (Math.abs(dy) < (longPress ? 8 : 4) && Math.abs(e.clientX - ev.clientX) < (longPress ? 8 : 4)) return;
      if (longPress) return end(false);
      begin();
    }
    const c = rects[from].top + h / 2 + dy;
    to = rects.filter((r, i) => i !== from && r.top + r.height / 2 < c).length;
    shift(row, dy);
    rows.forEach((r, i) => { if (i !== from) shift(r, from < to && i > from && i <= to ? -h : from > to && i < from && i >= to ? h : 0); });
  };
  const touch = e => { if (dragging) e.preventDefault(); };
  const key = e => { if (e.key === "Escape") end(false); };
  function end(drop) {
    clearTimeout(timer);
    for (const [t, fn, o] of [["pointermove", move], ["pointerup", up], ["pointercancel", cancel], ["touchmove", touch, { passive: false }], ["keydown", key]]) document.removeEventListener(t, fn, o);
    if (dragging) { accSwallow = true; document.addEventListener("pointerdown", () => { accSwallow = false; }, { capture: true, once: true }); rows.forEach(r => shift(r, 0)); row.classList.remove("drag"); list.classList.remove("acc-dragging"); }
    if (dragging && drop && to !== from) onDrop(to);
  }
  function up(e) { if (e.pointerId === id) end(true); }
  function cancel(e) { if (e.pointerId === id) end(false); }
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
  document.addEventListener("pointercancel", cancel);
  document.addEventListener("touchmove", touch, { passive: false });
  document.addEventListener("keydown", key);
  if (longPress) timer = setTimeout(begin, 450);
  else ev.preventDefault();
}
function accountSection(p, g, conn) {
  const head = accHead(p, g, p.can_add_account);
  if (!ACC) return [head, el("div", { class: "list" }, conn)];
  const dec = ACC.decision, sc = ACC.script, lines = ACC.rules_text || [], pct = n => `${Math.round(n)}%`;
  const tx = (hd, ...sup) => el("span", { class: "tx" }, hd ? el("div", { class: "hd", text: hd }) : null, sup.length ? el("div", { class: "sup" }, ...sup) : null);
  // two modes: 자동 전환 (rules, and a switch when the account is blocked) or 고정 (one account, requests never move to another)
  const pinned = ACC.mode === "pinned", ch = ACC.chosen, pin = pinned && ch ? ch.name : "";
  const setMode = (btn, body, msg) => accMut(btn, () => api("/api/accounts/mode", "PUT", body), msg);
  // the order is the fallback order of 자동 전환: the first usable account by number takes over when the current one is blocked
  const reorder = (btn, from, to) => { const names = ACC.accounts.map(x => x.name); names.splice(to, 0, names.splice(from, 1)[0]); return accMut(btn, () => api("/api/accounts/order", "PUT", { order: names })); };
  const rows = ACC.accounts.map((a, i) => {
    const label = a.label || a.alias || a.name;
    // every account's own windows with their reset time (the group mirrors OmO's usage file), else the two numbers dotz read
    const wins = ((g && g.accounts.find(x => x.name === a.name)) || {}).windows || [];
    const sub = [a.name !== label ? a.name : "", ...(wins.length ? wins.map(accWin) : a.five_hour_left != null || a.seven_day_left != null ? [a.five_hour_left != null ? `5시간 ${pct(a.five_hour_left)} 남음` : "", a.seven_day_left != null ? `주간 ${pct(a.seven_day_left)} 남음` : ""] : [ACC_NO_USAGE])].filter(Boolean).join(" · ");
    // 고정: tapping a row fixes that account; 자동 전환: tapping it opens its name and details (not the click right after a drag)
    const onclick = ev => { if (accSwallow) { accSwallow = false; return; } if (pinned) { if (a.name !== pin) setMode(ev.currentTarget, { mode: "pinned", account: a.name }, "고정 계정을 바꿨어요"); } else accDialog(a); };
    const rowOf = ev => ev.currentTarget.closest(".li.acc");
    // the grip drags at once; a long press on the row drags too (touch); ArrowUp/ArrowDown on the focused grip moves it one place
    const grip = el("button", { class: "acc-grip", type: "button", "data-acc": a.name, "aria-label": `${label} 순서 바꾸기. 끌거나 위아래 화살표를 눌러요`, "aria-keyshortcuts": "ArrowUp ArrowDown",
      onpointerdown: ev => accDrag(ev, rowOf(ev), false, to => reorder(ev.target.closest(".acc-grip"), i, to)),
      onkeydown: ev => {
        const to = i + (ev.key === "ArrowUp" ? -1 : ev.key === "ArrowDown" ? 1 : 0);
        if (to === i || to < 0 || to >= ACC.accounts.length) return;
        ev.preventDefault();
        Promise.resolve(reorder(ev.currentTarget, i, to)).then(() => globalThis.document?.querySelector(`.acc-grip[data-acc="${CSS.escape(a.name)}"]`)?.focus());
      } });
    return el("div", { class: `li acc${pinned && a.name === pin ? " on" : ""}` }, grip,
      el("button", { class: "acc-main", type: "button", ...(pinned ? { role: "radio", "aria-checked": String(a.name === pin) } : {}), onclick,
        onpointerdown: ev => { if (ev.pointerType !== "mouse") accDrag(ev, rowOf(ev), true, to => reorder(ev.target.closest(".acc-main"), i, to)); } },
        el("span", { class: "lead acc-no", text: String(a.order || i + 1) }), tx(label, sub), ...accTags(a, pin).map(([t, tone]) => el("span", { class: `tag ${tone}`, text: t }))),
      pinned ? el("button", { class: "acc-mv", type: "button", "aria-label": `${label} 이름 바꾸기`, onclick: () => accDialog(a) }, icon("chev", "lead")) : null);
  });
  const caption = pinned ? (ch && ch.blocked ? `${ch.text}.` : `${ch ? ch.label : "고른 계정"}만 써요. 한도에 걸리면 다른 계정으로 넘어가지 않고, 폴백 순서에 다른 단계(API 키 포함)가 있으면 그 단계로 이어 가요. 답장 초안은 API 키로 넘어가지 않아 한도가 풀릴 때까지 멈춰요.`) : "규칙과 한도에 따라 계정을 골라요. 쓰던 계정이 막히면 다른 계정으로 넘어가고, 모두 막히면 폴백 순서(API 키 포함)를 따라요. 답장 초안은 API 키로 넘어가지 않아요.";
  // on = 자동 전환, off = 고정 (the account to fix is the row tapped below)
  rows.unshift(el("div", { class: "li" }, tx("자동 전환", caption),
    liEnd(el("button", { type: "button", class: "hs-sw", role: "switch", "aria-checked": String(!pinned), "aria-label": "자동 전환", onclick: ev => setMode(ev.currentTarget, { mode: pinned ? "auto" : "pinned" }, pinned ? "자동 전환으로 바꿨어요" : "고정했어요") }))));
  // What a 고정 account at its limit does next: unset asks once (the alert's question), then this is followed quietly.
  const onLimit = (ACC.rules && ACC.rules.on_limit) || "";
  const onLimitSub = onLimit === "switch" ? "한도에 걸리면 자동 전환으로 넘어가요" : onLimit === "wait" ? "한도에 걸린 동안 기다려요" : "아직 안 정했어요 · 한도에 걸리면 한 번 물어봐요";
  const setOnLimit = (btn, value) => accMut(btn, () => api("/api/accounts/on-limit", "PUT", { on_limit: value }), value === "wait" ? "한도에 걸렸을 때 기다리기로 정했어요" : "한도에 걸렸을 때 자동 전환으로 넘어가기로 정했어요");
  rows.splice(1, 0, el("div", { class: "li" }, tx("한도에 걸렸을 때", onLimitSub),
    liEnd(rowToggle({ label: "한도에 걸렸을 때", opts: [["wait", "기다리기"], ["switch", "자동 전환"]], value: onLimit, onPick: (v, btn) => setOnLimit(btn, v) }))));
  if (!pinned) {
    rows.push(el("div", { class: "li" }, tx("전환 규칙", lines.length ? "" : "규칙이 없어요. 계정이 막힐 때만 자동으로 바꿔요."), liEnd(el("button", { class: "btn tonal inrow", type: "button", onclick: () => rulesDialog() }, "편집"))));
    for (const [i, r] of lines.entries()) rows.push(el("div", { class: "li" }, el("span", { class: "lead", text: String(i + 1) }), tx(r.text)));
  }
  const run = sc && [sc.timeout_ms ? `${Math.round(sc.timeout_ms / 1000)}초 안에 끝나요` : "", sc.every_minutes ? `${sc.every_minutes}분마다` : ""].filter(Boolean).join(" · ");
  if (!pinned && sc && sc.path) rows.push(el("button", { class: "li tap", type: "button", title: sc.path, onclick: () => accCopy(sc.path) }, tx("스크립트", el("code", { class: "path-short", text: shortPath(sc.path) }), run ? ` · ${run}` : "")));
  const last = sc && sc.last;
  if (!pinned && last) rows.push(el("div", { class: "li" }, tx(last.error || last.error_text ? "마지막 실행이 실패했어요" : `마지막 결과 · ${last.label || (last.account ? accLabel(last.account) : "고르지 않음")}`, [last.error_text || last.reason, last.at ? kstStamp(Date.parse(last.at)) : ""].filter(Boolean).join(" · "))));
  return [head, el("div", { class: "list" }, conn, ...rows)];
}
// One usage window: what is left and, when OmO knows it, when it resets (KST).
// A logged-in subscription account whose usage has not been read yet (it has made no request so far).
const ACC_NO_USAGE = "사용량 아직 확인 안 됨";
const accWin = w => `${w.label} ${Math.round(w.left)}% 남음${w.resets_at ? ` (${kstStamp(w.resets_at)} 초기화)` : ""}`;
// A provider OmO holds accounts for besides Claude 구독 (its own block above): its login row, then its accounts with their state and usage
// windows, and an empty state when the pool has none.
function accProviderSection(p, g, conn) {
  const rows = [conn];
  if (g && !g.accounts.length) rows.push(el("div", { class: "li" }, accTx(`${g.name} 계정이 없어요`, g.can_add ? "계정을 하나 넣으면 여기 보여요." : "로그인이나 API 키를 넣어 주세요.")));
  for (const a of g ? g.accounts : []) {
    const sub = (a.windows || []).map(accWin).join(" · ") || (g.auth === "oauth" ? ACC_NO_USAGE : "");
    const tags = [];
    if (a.current) tags.push(["사용 중", "pri"]);
    if (a.pinned) tags.push(["고정", "ok"]);
    if (a.blocked) tags.push([a.blocked_tag || (a.blocked === "auth_error" ? "로그인 필요" : "쓸 수 없음"), "warn"]);
    else if (!a.current && !a.pinned) tags.push(["쓸 수 있음", "ok"]);
    const label = a.label || a.name;
    rows.push(el("div", { class: `li acc gen${a.current ? " on" : ""}` },
      el("button", { class: "acc-main", type: "button", onclick: () => accProviderDialog(g, a) },
        el("span", { class: "lead acc-no", text: String(a.order) }), accTx(label, sub), ...tags.map(([t, tone]) => el("span", { class: `tag ${tone}`, text: t })))));
  }
  return [accHead(p, g, p.can_add_account || (g && g.can_add)), el("div", { class: "list" }, ...rows)];
}
// One account of another provider: its alias (kept per provider so two pools can hold the same account name), OmO's pin, deletion.
function accProviderDialog(g, a) {
  const label = a.label || a.name;
  const key = `${g.id}:${a.name}`;
  const inp = el("input", { class: "fi", type: "text", value: a.label !== a.name ? a.label : "", maxlength: "40", autocomplete: "off", placeholder: "별칭 (예: 회사, 개인)", "aria-label": "별칭" });
  const alias = (v, msg) => (btn, close) => accMut(btn, () => api("/api/accounts/alias", "PUT", { key, alias: v }), msg, close);
  const actions = [
    a.label !== a.name ? { label: "지우기", kind: "danger", onclick: (c, b) => alias("", "별칭을 지웠어요")(b, c) } : null,
    g.can_delete ? { label: "계정 삭제", kind: "danger", onclick: async (c, b) => { if (!await ask(`${label} 삭제`, "OmO에서 이 계정의 로그인 정보를 지워요. 다시 쓰려면 다시 로그인해야 해요.", "삭제", true)) return; accMut(b, () => api(`/api/accounts?provider=${enc(g.id)}&name=${enc(a.name)}`, "DELETE"), `${label}을(를) 지웠어요`, c); } } : null,
    g.can_pin ? (a.pinned ? { label: "고정 풀기", kind: "tonal", onclick: (c, b) => accMut(b, () => api("/api/accounts/pin", "PUT", { provider: g.id, account: null }), "고정을 풀었어요", c) } : { label: "이 계정으로 고정", kind: "tonal", onclick: (c, b) => accMut(b, () => api("/api/accounts/pin", "PUT", { provider: g.id, account: a.name }), `${label}로 고정했어요`, c) }) : null,
    { label: "저장", kind: "pri", onclick: (c, b) => alias(inp.value.trim(), inp.value.trim() ? "별칭을 저장했어요" : "별칭을 지웠어요")(b, c) },
  ].filter(Boolean);
  const d = dialog({ classic: true, title: `${g.name} · ${label}`, body: el("div", { class: "col" }, a.name !== label ? el("div", { class: "sup" }, "계정 ", el("code", { text: a.name })) : null, el("div", {}, el("div", { class: "lbl", style: "margin:0 0 var(--sp-15)", text: "별칭" }), inp)), actions });
  inp.addEventListener("keydown", ev => { if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); d.node.querySelector(".dact .btn:last-child").click(); } });
  inp.focus();
}
function accDialog(a) {
  const label = a.label || a.alias || a.name;
  const inp = el("input", { class: "fi", type: "text", value: a.alias || "", maxlength: "40", autocomplete: "off", placeholder: "별칭 (예: 회사, 개인)", "aria-label": "별칭" });
  const alias = (v, msg) => (btn, close) => accMut(btn, () => api("/api/accounts/alias", "PUT", { key: a.name, alias: v }), msg, close);
  const d = dialog({ classic: true, title: label, body: el("div", { class: "col" }, a.name !== label ? el("div", { class: "sup" }, "계정 ", el("code", { text: a.name })) : null, el("div", {}, el("div", { class: "lbl", style: "margin:0 0 var(--sp-15)", text: "별칭" }), inp)), actions: [
    a.alias ? { label: "지우기", kind: "danger", onclick: (c, b) => alias("", "별칭을 지웠어요")(b, c) } : null,
    ACC.accounts.length > 1 ? { label: "계정 삭제", kind: "danger", onclick: async (c, b) => { if (!await ask(`${label} 삭제`, "OmO에서 이 계정의 로그인 정보를 지워요. 다시 쓰려면 다시 로그인해야 해요.", "삭제", true)) return; accMut(b, () => api(`/api/accounts?name=${enc(a.name)}`, "DELETE"), `${label}을(를) 지웠어요`, c); } } : null,
    { label: "이 계정으로 고정", kind: "tonal", disabled: ACC.mode === "pinned" && ACC.chosen && ACC.chosen.name === a.name, onclick: (c, b) => accMut(b, () => api("/api/accounts/mode", "PUT", { mode: "pinned", account: a.name }), `${label}로 고정했어요`, c) },
    { label: "저장", kind: "pri", onclick: (c, b) => alias(inp.value.trim(), inp.value.trim() ? "별칭을 저장했어요" : "별칭을 지웠어요")(b, c) }].filter(Boolean) });
  inp.addEventListener("keydown", ev => { if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); d.node.querySelector(".dact .btn:last-child").click(); } });
  inp.focus();
}
function rulesDialog() {
  const accts = ACC.accounts;
  let R = JSON.parse(JSON.stringify(ACC.rules || {})), json = false;
  const list = () => (Array.isArray(R.rules) ? R.rules : (R.rules = []));
  const clean = o => {
    const c = JSON.parse(JSON.stringify(o));
    if (Array.isArray(c.rules)) { for (const r of c.rules) { if (!r.name) delete r.name; if (r.when && !Object.keys(r.when).length) delete r.when; } if (!c.rules.length) delete c.rules; }
    return c;
  };
  const acctPairs = cur => { const p = accts.map(a => [a.name, a.label || a.alias || a.name]); if (cur && !p.some(([v]) => v === cur)) p.push([cur, accLabel(cur)]); return p; };
  const select = (pairs, cur, label, onPick) => selectButton({ label, items: pairs.map(([value, text]) => ({ value, label: text })), value: cur, onPick });
  const field = (label, ...ctrl) => el("div", {}, el("div", { class: "lbl", style: "margin:0 0 var(--sp-15)", text: label }), el("div", { class: "row", style: "flex-wrap:wrap" }, ...ctrl));
  const ta = el("textarea", { class: "fi hs-ta hs-mono", rows: 14, spellcheck: "false", "aria-label": "규칙 JSON" });
  const box = el("div", { class: "col" });
  const move = (i, to) => { const l = list(); [l[i], l[to]] = [l[to], l[i]]; paint(); };
  function card(r, i, n) {
    r.do = r.do || { auto: true };
    const w = r.when || {}, cond = ACC_COND.find(([k]) => k && k in w), ck = cond ? cond[0] : "";
    const set = (k, v) => { r.when = r.when || {}; if (v === "" || v == null) delete r.when[k]; else r.when[k] = v; };
    const nm = el("input", { class: "fi", type: "text", style: "flex:1 1 200px", value: r.name || "", maxlength: "40", placeholder: `규칙 ${i + 1} 이름 (선택)`, "aria-label": "규칙 이름" });
    nm.addEventListener("input", () => { r.name = nm.value; });
    const time = (k, label) => { const t = el("input", { class: "fi", type: "time", value: w[k] || "", "aria-label": label, style: "flex:1;min-width:96px" }); t.addEventListener("change", () => set(k, t.value)); return t; };
    const days = ACC_DAYS.map(([k, t]) => { const on = (w.days || []).includes(k); return el("button", { type: "button", class: `chip${on ? " on" : ""}`, "aria-pressed": String(on), text: t, onclick: () => { const s = new Set(w.days || []); on ? s.delete(k) : s.add(k); set("days", ACC_DAYS.map(([x]) => x).filter(x => s.has(x))); if (!(r.when.days || []).length) delete r.when.days; paint(); } }); });
    const condCtl = [select(ACC_COND, ck, "조건", v => {
      if (ck) delete r.when[ck];
      if (v === "five_hour_left_below" || v === "seven_day_left_below") set(v, 20);
      else if (v === "rate_limited" || v === "auth_error") set(v, true);
      else if (v === "unavailable") set(v, accts[0] ? accts[0].name : "");
      paint();
    })];
    if (ck === "five_hour_left_below" || ck === "seven_day_left_below") {
      const num = el("input", { class: "fi", type: "number", min: "0", max: "100", value: String(w[ck]), "aria-label": "남은 %", style: "width:96px;flex:none" });
      num.addEventListener("input", () => { if (num.value !== "") r.when[ck] = Number(num.value); });
      condCtl.push(num, el("span", { class: "sup", text: "% 밑" }));
    } else if (ck === "unavailable") condCtl.push(select(acctPairs(w.unavailable), w.unavailable, "계정", v => { r.when.unavailable = v; }));
    const dk = "pin" in r.do ? "pin" : "prefer" in r.do ? "prefer" : "auto";
    const doCtl = [select(ACC_DO, dk, "동작", v => { r.do = v === "pin" ? { pin: accts[0] ? accts[0].name : "" } : v === "prefer" ? { prefer: [] } : { auto: true }; paint(); })];
    if (dk === "pin") doCtl.push(select(acctPairs(r.do.pin), r.do.pin, "계정", v => { r.do.pin = v; }));
    if (dk === "prefer") {
      const pref = Array.isArray(r.do.prefer) ? r.do.prefer : (r.do.prefer = []);
      for (const [v, t] of acctPairs()) { const at = pref.indexOf(v); doCtl.push(el("button", { type: "button", class: `chip${at >= 0 ? " on" : ""}`, "aria-pressed": String(at >= 0), text: at >= 0 ? `${at + 1} ${t}` : t, onclick: () => { at >= 0 ? pref.splice(at, 1) : pref.push(v); paint(); } })); }
    }
    const many = Object.keys(w).filter(k => ACC_COND.some(([c]) => c === k)).length > 1;
    return el("div", { class: "list" }, el("div", { class: "li", style: "flex-direction:column;align-items:stretch;gap:var(--sp-3)" },
      el("div", { class: "row", style: "flex-wrap:wrap" }, nm,
        el("button", { type: "button", class: "btn text", disabled: i === 0, onclick: () => move(i, i - 1) }, "위로"),
        el("button", { type: "button", class: "btn text", disabled: i === n - 1, onclick: () => move(i, i + 1) }, "아래로"),
        el("button", { type: "button", class: "btn danger", onclick: () => { list().splice(i, 1); paint(); } }, "삭제")),
      field("요일 (선택)", ...days),
      field("시간 (선택)", time("from", "시작"), el("span", { class: "sup", text: "~" }), time("to", "끝")),
      field("조건", ...condCtl), many ? el("div", { class: "sup", text: "조건이 여러 개예요. 모두 바꾸려면 채팅에서 말해 주세요." }) : null,
      field("동작", ...doCtl)));
  }
  function paint() {
    clear(box);
    if (json) { box.append(ta); return; }
    const l = Array.isArray(R.rules) ? R.rules : [];
    if (!l.length) box.append(el("div", { class: "sup", text: "규칙이 없어요. 계정이 막힐 때만 자동으로 바꿔요." }));
    l.forEach((r, i) => box.append(card(r, i, l.length)));
    box.append(el("div", {}, el("button", { type: "button", class: "btn tonal", onclick: () => { list().push({ do: { auto: true } }); paint(); } }, "규칙 추가")));
  }
  const parse = () => { let o; try { o = JSON.parse(ta.value || "{}"); } catch { throw new Error("JSON 모양이 맞지 않아요"); } if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error("JSON 모양이 맞지 않아요"); return o; };
  const toggle = () => {
    if (!json) { ta.value = JSON.stringify(clean(R), null, 2); json = true; }
    else { try { R = parse(); } catch (e) { return toast(e.message, true); } json = false; }
    d.setActions(acts()); paint();
  };
  const acts = () => [
    { label: "취소", onclick: c => c() },
    { label: json ? "폼으로 보기" : "JSON으로 편집", onclick: toggle },
    { label: "저장", kind: "pri", onclick: (c, b) => accMut(b, () => api("/api/accounts/rules", "PUT", { rules: json ? parse() : clean(R) }), "규칙을 저장했어요", c) }];
  const d = dialog({ classic: true, title: "전환 규칙", body: box, wide: true, actions: acts() });
  paint();
}
