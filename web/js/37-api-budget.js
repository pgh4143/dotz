/* ---------- API 월 한도: usage card and settings dialog (/api/quota budget, /api/api-budget) ---------- */
let AB;
const abUsd = n => `$${n.toFixed(2)}`;
function budgetCard(B) {
  const card = el("div", { class: "card" }, el("div", { class: "ch lo" }, el("h3", { text: "API 월 한도" }),
    el("button", { class: "btn text inrow", type: "button", onclick: () => budgetDialog() }, "설정")));
  const src = B.source === "admin" ? "콘솔 기준 (관리자 키)" : "이 앱 사용분 추정";
  if (B.limit_usd) {
    const pct = B.pct || 0, tone = pct >= 80 ? "warn" : "", left = Math.max(0, Math.min(100, 100 - pct));   // the bar says what is left, as the subscription cards do
    card.append(el("div", { class: "lim" },
      el("div", { class: "kv" }, el("span", { class: "k", text: `${abUsd(B.spent_usd)} / ${abUsd(B.limit_usd)}` }), el("span", { style: "font-weight:500", text: `${Math.round(left)}% 남음` })),
      el("div", { class: `bar ${tone}`, role: "progressbar", "aria-valuenow": Math.round(left), "aria-valuemin": 0, "aria-valuemax": 100 }, el("i", { style: `width:${left.toFixed(1)}%` })),
      el("div", { class: "kv", style: "margin-top:var(--sp-1)" }, el("span", { class: "v", text: `${kstStamp(B.resets_at)} (KST)` }), el("span", { class: "v", text: rel(B.resets_at) }))));
  } else {
    card.append(el("div", { class: "lim" }, el("div", { class: "kv" }, el("span", { class: "k", text: `이번 달 ${abUsd(B.spent_usd)}` }), el("span", { class: "v", text: "월 한도 없음" })),
      el("div", { class: "sup", text: "콘솔에서 정한 월 한도를 설정에 입력하면 사용 비율을 보여줘요." })));
  }
  card.append(el("div", { class: "sup", text: `${B.month} · ${src}` }));
  if (B.error) card.append(el("div", { class: "sup warn", text: B.error }));
  if (B.hint) card.append(el("div", { class: "sup", text: B.hint }));
  return card;
}
// Without a console limit the usage page still carries the way in: one row that opens the same dialog.
function budgetRow() {
  return el("button", { class: "li tap budget-row", type: "button", onclick: () => budgetDialog() },
    el("span", { class: "tx" }, el("div", { class: "hd", text: "API 월 한도" }), el("div", { class: "sup", text: budgetSub() || "정하지 않았어요" })),
    el("span", { class: "li-end" }, el("span", { class: "btn tonal inrow", text: "월 한도 바꾸기" })));
}
function budgetSub() {
  if (AB === undefined) {
    AB = null;
    // a failed read is tried again on the next render instead of leaving the row blank for the session
    api("/api/api-budget").then(r => { AB = r; if (inSettings()) renderSettings(); }).catch(() => { AB = undefined; });
  }
  return AB && AB.monthly_usd ? `월 ${abUsd(AB.monthly_usd)}` : "";
}
async function budgetDialog() {
  try { AB = await api("/api/api-budget"); } catch (e) { toast(e.message, true); return; }
  const limit = input({ type: "number", inputmode: "decimal", min: "0", step: "any", placeholder: "예: 100", value: AB.monthly_usd == null ? "" : String(AB.monthly_usd) });
  const key = input({ type: "password", autocomplete: "new-password", name: "admin-key", placeholder: "관리자 키 붙여 넣기" });
  const has = AB.admin_key && AB.admin_key.present;
  const done = (c, msg) => { c(); toast(msg); renderSettings(); if (current === "usage") loadQuota(); };
  const send = (c, btn, body, msg) => busy(btn, async () => {
    try { AB = await api("/api/api-budget", "PUT", body); } finally { key.value = ""; }
    done(c, msg);
  });
  const actions = [{ label: "취소", onclick: c => c() }];
  if (has) actions.push({ label: "관리자 키 삭제", onclick: (c, btn) => send(c, btn, { clear_admin_key: true }, "관리자 키를 지웠어요") });
  actions.push({ label: "저장", kind: "pri", onclick: (c, btn) => {
    const body = { monthly_usd: limit.value.trim() === "" ? null : limit.value.trim() };
    if (key.value.trim()) body.admin_key = key.value;
    return send(c, btn, body, "저장했어요");
  } });
  dialog({
    classic: true,
    title: "API 월 한도",
    body: el("div", { class: "col" },
      el("p", { class: "sup", text: "Anthropic 콘솔에서 정한 월 한도(달러)예요. 비우면 사용액만 보여줘요." }),
      textField("월 한도 (달러)", limit),
      el("p", { class: "sup", text: has ? `관리자 키: ${AB.admin_key.masked}` : "관리자 키가 없어요. 콘솔 설정의 관리자 키 메뉴에서 만들어 붙여 넣어요." }),
      textField("관리자 키", key),
      el("p", { class: "sup", text: "저장한 키는 다시 보여 주지 않아요." })),
    actions,
  });
}
