/* ---------- settings: 실행 하네스 (runtime menu + compatibility check; data from /api/runtimes) ---------- */
let RT = null, rtLive = null;
const RT_ICON = { omp: "term", claude: "spark", codex: "code", omo: "braces" };
const RT_ROLE = { orchestrator: "어시스턴트", lanes: "세션" };
const RT_RESULT = { ok: ["통과", "ok"], adapted: ["대체", "pri"], disabled: ["끔", ""], unsupported: ["미지원", "warn"], fail: ["실패", "err"] };
async function loadRuntimes(refresh) {
  try { RT = await api(`/api/runtimes${refresh ? "?refresh=1" : ""}`); } catch { return; }
  if (current === "settings" || current === "runtime") renderSettings();
}
function rtSection() {
  if (!RT) return [];
  // Only the running harness is listed (two rows when the assistant and the sessions run on different ones); tapping a row opens the
  // shared menu with the other installed harnesses, and picking one starts the existing compatibility-check + switch flow.
  const others = RT.runtimes.filter(r => r.installed).map(r => ({ value: r.id, label: r.label, sub: [r.version ? `v${r.version}` : "", r.roles.length ? "현재 쓰는 중" : ""].filter(Boolean).join(" · ") || undefined }));
  const rows = RT.runtimes.filter(r => r.roles.length > 0).map(r => {
    const sub = [r.version ? `v${r.version}` : "", r.roles.length === 2 ? "사용 중" : `${r.roles.map(k => RT_ROLE[k]).join("·")} 사용 중`].filter(Boolean).join(" · ");
    const b = el("button", { class: "li tap", type: "button", "data-runtime": r.id, "aria-haspopup": "listbox", "aria-expanded": "false", "aria-label": `작업 프로그램: ${r.label}. 눌러서 바꾸기` },
      el("span", { class: "lead" }, icon(RT_ICON[r.id] || "harness")), el("span", { class: "tx" }, el("div", { class: "hd", text: r.label }), el("div", { class: "sup", text: sub })), icon("drop"));
    b.addEventListener("click", () => showMenu(b, others.filter(o => o.value !== r.id), { onPick: id => rtFlow(RT.runtimes.find(x => x.id === id)) }));
    return b;
  });
  return [el("div", { class: "sec", text: "작업 프로그램" }), el("div", { class: "list" }, ...rows), el("div", { class: "note", text: "바꾼 뒤에는 어시스턴트와 세션을 다시 시작해야 적용돼요." })];
}
function rtBadge(it) {
  const [label, tone] = RT_RESULT[it.result] || [it.result, ""];
  return el("span", { class: `tag ${it.core && it.result !== "ok" && tone === "warn" ? "err" : tone}`, text: label });
}
function rtReportView(r, report) {
  const core = report.items.filter(i => i.core && (i.result === "fail" || i.result === "unsupported"));
  const changed = report.items.filter(i => i.result === "adapted" || i.result === "disabled").length;
  const stale = !!(r.version && report.version !== r.version);
  const sum = !r.hasAdapter ? "dotz가 아직 지원하지 않아서 바꿀 수 없어요."
    : report.verdict === "blocked" ? `핵심 항목이 통과하지 못해서 바꿀 수 없어요: ${core.map(i => i.label).join(", ")}`
    : stale ? `검사한 뒤 버전이 바뀌었어요 (v${report.version || "?"} → v${r.version}). 다시 검사해 주세요.`
    : report.verdict === "adjusted" ? `핵심 항목은 모두 통과했어요. ${changed}개 기능은 게이트웨이가 대신 처리하거나 꺼요.` : "모든 항목이 통과했어요.";
  const meta = `${new Date(report.at).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}${report.version ? ` · v${report.version}` : ""}`;
  return el("div", { class: "rt-rep", style: "display:flex;flex-direction:column;gap:var(--sp-2)" },
    el("p", { text: sum }), el("div", { class: "note", text: `검사 ${meta}` }),
    el("div", { class: "list rt-rows" }, ...report.items.map(i => el("div", { class: "rt-row" },
      el("div", { class: "top" }, el("span", { class: "nm", title: i.label, text: i.label }), i.core ? el("span", { class: "tag", text: "핵심" }) : null, el("span", { class: "sp" }), rtBadge(i)),
      i.note ? el("div", { class: "sup", text: i.note }) : null))));
}
function rtFlow(r) {
  const roles = new Set(["orchestrator", "lanes"]);
  let report = null, st = null, timer = 0, checking = false;
  const box = el("div", { style: "display:flex;flex-direction:column;gap:var(--sp-3)" });
  const d = dialog({ classic: true, title: `${r.label}로 바꾸기`, body: box, wide: true, onclose: () => { clearInterval(timer); rtLive = null; loadRuntimes(true); } });
  const usable = () => r.hasAdapter && (r.id === "omp" || (r.id === "omo" && r.installed !== false) || (report && report.verdict !== "blocked" && !(r.version && report.version !== r.version)));
  async function pull() {
    try { const x = await api(`/api/runtimes/${r.id}`); report = x.report; st = x.state; } catch { return; }
    if (checking && !(st && st.running)) { checking = false; clearInterval(timer); rtLive = null; }
    paint();
  }
  const roleBar = () => el("div", { class: "rt-roles" }, el("span", { class: "sup", text: "적용 대상" }),
    el("div", { class: "seg", role: "radiogroup", "aria-label": "적용 대상" }, ...[["all", "둘 다"], ...Object.entries(RT_ROLE)].map(([k, v]) => { const on = k === "all" ? roles.size === 2 : roles.size === 1 && roles.has(k); return el("button", { type: "button", role: "radio", class: on ? "on" : "", "aria-checked": String(on), text: v, onclick: () => { roles.clear(); for (const x of k === "all" ? Object.keys(RT_ROLE) : [k]) roles.add(x); paint(); } }); })));
  async function check() {
    try { await api(`/api/runtimes/${r.id}/verify`, "POST", { real: true }); } catch (e) { toast(e.message, true); return; }
    checking = true; st = { running: true, done: 0, total: 0 }; rtLive = pull; clearInterval(timer); timer = setInterval(pull, 1000); paint();
  }
  function paint() {
    clear(box);
    const running = checking || (st && st.running);
    if (r.id !== "omp") {
      if (running) box.append(el("div", {}, el("p", { text: `작동을 검사하는 중이에요${st && st.current ? ` · ${st.current}` : ""}` }), el("div", { class: "bar" }, el("i", { style: `width:${st && st.total ? Math.round((st.done / st.total) * 100) : 4}%` })), el("div", { class: "note", text: st && st.total ? `${st.done}/${st.total} 항목` : "시작하는 중…" })));
      else if (report) box.append(rtReportView(r, report));
      else if (r.id === "omo" && r.hasAdapter) box.append(el("p", { text: "OmO는 기본 작업 프로그램이라서 검사 없이 쓸 수 있어요. 작동 검사로 항목별 상태도 볼 수 있어요." }));
      else box.append(el("p", { text: r.hasAdapter ? "바꾸기 전에 잘 작동하는지 검사해요. 짧은 작업을 실제로 돌려 보기 때문에 1~2분쯤 걸릴 수 있어요." : "dotz가 아직 지원하지 않아서 바꿀 수 없어요. 작동 검사를 하면 어떤 항목이 막히는지 볼 수 있어요." }));
    } else box.append(el("p", { text: "omp는 선택해서 쓰는 작업 프로그램이에요. 처음에 쓰던 것이라 검사 없이 바꿀 수 있어요." }));
    if (r.hasAdapter) box.append(roleBar());
    const acts = [{ label: "취소", onclick: c => c() }];
    if (r.id !== "omp" && !running) acts.push({ label: report ? "다시 검사" : "작동 검사", kind: report ? "text" : "tonal", onclick: () => check() });
    acts.push({ label: "바꾸기", kind: "pri", disabled: running || !usable() || !roles.size, onclick: (c, btn) => busy(btn, async () => {
      try { const res = await api(`/api/runtimes/${r.id}/use`, "POST", { roles: [...roles] }); toast(res.applies); c(); }
      catch (e) { await pull(); throw e; } }) });
    d.setActions(acts);
  }
  pull().then(() => { if (st && st.running) { checking = true; rtLive = pull; timer = setInterval(pull, 1000); paint(); } });
  paint();
}
