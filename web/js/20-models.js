/* ---------- models ---------- */
const pending = {};
let providerFilter = "";
const applyKo = { live: "적용했어요", restarted: "적용했어요 · 재시작됨", "next-start": "다음 시작부터 적용돼요", "next-turn": "다음 턴부터 적용돼요" };
// A load that failed stays said until one succeeds: a later redraw (the providers arriving) must not turn it back into 불러오는 중.
let modelsFail = false;
const modelsFailNode = () => emptyNode("모델 정보를 불러오지 못했어요", () => loadModels());
async function loadModels(quiet) {
  try { M = await api("/api/models"); modelsFail = false; }
  catch (e) { modelsFail = true; if (!quiet && current === "models") clear($("#models")).append(modelsFailNode()); return; }
  if (current === "models") renderModels();
  if (current === "home") renderHome();
  if (current === "settings") renderSettings();
  if (current === "context") renderContext();
}
// Where a model is reached (owner 2026-10-29: two "Opus 5.5" rows could not be told apart): a subscription login says 구독 and the
// account name it is signed in as, an API key says API and the provider (/api/providers: auth, account, name).
function modelSource(provider) {
  const p = ((P && P.providers) || []).find(x => x.id === provider);
  if (!p) return "";
  if (p.auth === "oauth") return `구독 ${p.account || "계정"}`;
  if (p.auth === "api_key") return `API ${p.name || p.id}`;
  return "";
}
// Model picker rows from the server's choices: one "<Family> <version>" per model grouped by family, the latest two per
// family shown and the rest folded under '이전 모델' (the current selection is never folded).
function modelPickItems(avail, val) {
  const items = [], groups = new Map(), older = [];
  for (const a of avail) { const g = a.family || providerName(a.provider); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(a); }
  // Each row says where the model is reached when its group mixes sources (Opus over a subscription and over an API key); a group from
  // one source says it once, in its header.
  const one = list => new Set(list.map(a => a.provider)).size === 1;
  const row = (a, tag = true) => ({ value: a.selector, label: [a.name || a.selector, tag ? modelSource(a.provider) : ""].filter(Boolean).join(" · ") });
  for (const [g, list] of groups) {
    const now = list.filter(a => !a.older || a.selector === val), src = one(list) ? modelSource(list[0].provider) : "";
    if (now.length) items.push({ header: src ? (g === list[0].provider || g === providerName(list[0].provider) ? src : `${g} · ${src}`) : g }, ...now.map(a => row(a, !src)));
    older.push(...list.filter(a => a.older && a.selector !== val));
  }
  if (older.length) items.push({ fold: [{ header: "이전 모델" }, ...older.map(a => row(a))], label: `이전 모델 ${older.length}개` });
  return items;
}
function modelItems(key, curModel, filter = providerFilter) {
  const val = (pending[key] || {}).model ?? curModel;
  // Pickers list M.pickable (every connected model, one per version); a target on a model outside it still shows it under "현재".
  const avail = M.pickable || M.available || [];
  const shown = avail.filter(a => !filter || a.provider === filter);
  const items = [];
  if (val && !shown.some(a => a.selector === val)) items.push({ header: "현재" }, { value: val, label: modelName(val) });
  items.push(...modelPickItems(shown, val));
  return items;
}
// PUT /api/models for one target (the 모델 view and the 홈 card menus share it); confirms first when `confirmText` is set and again when the cache would be rewritten.
async function putModel(key, change, confirmText, label) {
  const body = { target: key, ...change };
  if (confirmText && !await ask("모델 설정을 적용할까요?", `${confirmText}\n${label}`, "적용")) return false;
  let r;
  try { r = await api("/api/models", "PUT", body); }
  catch (e) {
    if (!(e.data && e.data.requires_force)) throw e;
    if (!await ask("모델 설정을 적용할까요?", `캐시가 다시 쓰여요 · 컨텍스트 ${num(e.data.context_tokens)} 토큰\n${label}`, "적용")) return false;
    r = await api("/api/models", "PUT", { ...body, force: true });
  }
  delete pending[key];
  toast(applyKo[r.applied] || "적용했어요");
  await loadModels(true); refreshState();
  return true;
}
async function logoutProvider(p) {
  const name = p.name || p.id, key = p.auth === "api_key";
  if (!await ask(key ? `${name} 키 삭제` : `${name} 로그아웃`, key ? "저장된 API 키를 삭제할까요?" : "저장된 로그인 정보가 삭제돼요.", key ? "삭제" : "로그아웃", true)) return;
  await api(`/api/providers/${enc(p.id)}/logout`, "POST", {});
  toast(key ? "키를 삭제했어요" : "로그아웃했어요");
  await loadProviders(); loadModels(true);
  if (current === "home") renderHome();
}
// 모델 · 폴백 (owner 2026-11-11): one list of every place a model runs (hub/models-in-use.ts); pressing a row opens that target's editor right
// under it, one at a time: its model and effort on one row, which is step 1 of the fallback chain that target's harness walks where it has one
// (orchestrator, lane default, workers). The composer chips, the home card menu, 구성 and 설정 all open this screen on a row.
let modelsFocus = "", modelsOpen = "", modelsRefocus = "";
const openModels = key => { modelsFocus = key || ""; if (key) modelsOpen = key; if (current === "models") renderModels(); else go("models"); };
function targetEdit(key, title, cur, confirmText, extra = {}) {
  const p = pending[key] || {};
  const model = p.model ?? cur.model, thinking = p.thinking ?? cur.thinking;
  const dirty = (p.model != null && p.model !== cur.model) || (p.thinking != null && p.thinking !== cur.thinking);
  const modelField = selectField("모델", modelName(model), () => modelItems(key, cur.model), model, v => { (pending[key] ||= {}).model = v; renderModels(); });
  // Effort is a dropdown next to the model, not a row of eight buttons (owner 2026-10-20: "드랍다운으로 모델이랑 추론정도 각각"), and it
  // lists what this model accepts, so picking another model rebuilds it with that model's levels.
  // A model with no level to choose (only 'off') gets no effort cell at all, not an empty "–" one.
  const effItems = effortItems(model, thinking);
  const effField = effItems.length > 1 ? selectField("추론 강도", thinking ? thinkKo(thinking) : "–", effItems, thinking, v => { (pending[key] ||= {}).thinking = v; renderModels(); }) : null;
  const info = (M.available || []).find(a => a.selector === model);
  const apply = el("button", { class: "btn", type: "button", disabled: !dirty, onclick: ev => busy(ev.currentTarget, async () => {
    const change = {};
    if (p.model != null && p.model !== cur.model) change.model = p.model;
    if (p.thinking != null && p.thinking !== cur.thinking) change.thinking = p.thinking;
    await putModel(key, change, confirmText, `${modelName(model)} · ${thinkKo(thinking)}`);
  }) }, "적용");
  const pick = el("div", { class: "mt-pick" }, el("div", { class: "mt-model" }, modelField), effField ? el("div", { class: "mt-eff" }, effField) : null);
  const notes = [
    info && !info.reasoning && thinking && thinking !== "off" ? el("div", { class: "sup mt-note", text: "이 모델은 추론 강도를 쓰지 않아요" }) : null,
    dirty ? el("div", { class: "btns mt-apply" }, el("button", { class: "btn text", type: "button", onclick: () => { delete pending[key]; renderModels(); } }, "되돌리기"), apply) : null,
  ].filter(Boolean);
  return el("div", { class: "mt-list mt-edit", role: "group", "data-target": key, "aria-label": title }, ...(extra.chain ? [extra.chain(pick, notes)] : [pick, ...notes]));
}
function renderModels() {
  const box = $("#models");
  if (fbDragging) return;
  closeMenu(false);
  if (!M) { clear(box).append(modelsFail ? modelsFailNode() : emptyNode("불러오는 중…")); return; }
  const provs = [...new Set((M.available || []).map(a => a.provider))].sort((a, b) => providerName(a).localeCompare(providerName(b)));
  const filter = selectField("공급자", providerFilter ? providerName(providerFilter) : "공급자 전체", [{ value: "", label: "전체" }, ...provs.map(p => ({ value: p, label: providerName(p) }))], providerFilter, v => { providerFilter = v; renderModels(); });
  clear(box).append(
    el("div", { class: "col mt" },
      el("div", { class: "mt-top" }, el("p", { class: "mt-intro", text: "막히면 번호 순서대로 넘어가요." }), el("div", { class: "mt-filter" }, filter)),
      ...modelGroups()));
  if (modelsRefocus) {
    const r = box.querySelector(`[data-use="${CSS.escape(modelsRefocus)}"]`);
    modelsRefocus = "";
    if (r) r.focus();
  }
  if (modelsFocus) {
    const n = box.querySelector(`[data-target="${CSS.escape(modelsFocus)}"]`);
    modelsFocus = "";
    if (n) requestAnimationFrame(() => n.previousElementSibling.scrollIntoView({ block: "start" }));
  }
}

// The model a chat target (MAIN or "lane:<name>") answers on now: its running process's own (a fallback it moved to included), else the
// configured one. `fallback` is set when that is not the configured model, with why the configured one is out and until when (hub/control.ts primary_down).
const FB_DOWN_KO = { quota: "한도 소진", cap: "상한 도달", error: "오류" };
const runBaseOf = s => fbBase(s).replace(/^([^/]+)-apikey\//, "$1/");
const withLevel = (model, thinking) => model ? (thinking ? `${model}:${thinking}` : model) : "";
function fbWhy(layer) {
  const pd = ((M && M.fallbacks && M.fallbacks[layer]) || {}).primary_down;
  return { reason: pd ? FB_DOWN_KO[pd.down] || "" : "", until: pd && pd.until && isFinite(Date.parse(pd.until)) ? pd.until : "" };
}
function liveModel(t) {
  // A project or mail conversation: its own choice, else its kind's default (the mail app's), plus its session's model; main's as it is with neither.
  if (isModelT(t)) {
    const c = M && M.conversations && M.conversations[t], m = liveModel(MAIN), tv = TV.get(t);
    const kind = c ? c.kind : tv && tv.inherited_kind ? tv.inherited : "";
    if (!c && !kind) { const p = isMailT(t) && ctxSession(t); return p && p.model ? { sel: p.model, conf: "", fallback: null } : m; }
    const conf = (c && c.own) || kind || m.conf, act = c && c.active;
    return { sel: act || conf, conf, fallback: act && conf && runBaseOf(act) !== runBaseOf(conf) ? fbWhy("orchestrator") : null };
  }
  const main = t === MAIN, om = M && M.orchestrator;
  const lm = main ? null : ((M && M.lanes) || []).find(x => `lane:${x.name}` === t), sl = main || !S ? null : (S.lanes || []).find(x => `lane:${x.name}` === t);
  const conf = main ? (om ? withLevel(om.model, om.thinking) : "") : lm ? withLevel(lm.model, lm.thinking) : (sl && sl.model) || "";
  const act = main ? (S && S.orchestrator && S.orchestrator.status !== "stopped" && S.orchestrator.activeModel) || "" : (lm && lm.active_model) || "";
  const sel = act || conf;
  return { sel, conf, fallback: act && conf && runBaseOf(act) !== runBaseOf(conf) ? fbWhy(main ? "orchestrator" : "lanes") : null };
}
const fbTagText = f => ["대체 모델 사용 중", f.reason, f.until ? `${kstStamp(Date.parse(f.until))}에 복귀` : ""].filter(Boolean).join(" · ");
const selText = sel => { const [b, lv] = String(sel || "").split(":"); return b ? `${modelChipText(b)}${lv ? ` · ${thinkKo(lv)}` : ""}` : "–"; };
const fbTag = (f, conf) => el("span", { class: "tag warn", title: [fbTagText(f), conf ? `기본 모델 ${selText(conf)} 대신 쓰는 중` : ""].filter(Boolean).join(" · "), text: fbTagText(f) });
// 실제로 쓰는 모델 (owner 2026-10-27): every place a model runs and the model it runs on now (hub/models-in-use.ts), in three groups. A row
// that is changed on this screen opens its editor in place, one at a time; one that is changed in an app's settings opens that screen.
const MT_GROUPS = ["어시스턴트", "세션", "답장과 요약"];
const mtGroupOf = key => key === "main" || key === "background" || key === "lookups" ? 0 : key === "lanes" || key.startsWith("lane:") || key === "workers" || key.startsWith("workers:") ? 1 : 2;
// A hub that names no place to change a row (an older one, the demo's) still gets every row this screen edits, and a session that is alive
// but has no row from the hub its own.
const MT_OWN = { main: "orchestrator", lanes: "lanes", workers: "workers", replies: "replies" };
function mtRows() {
  const rows = (M.in_use || []).map(r => r.change || !MT_OWN[r.key] ? r : { ...r, change: { models: MT_OWN[r.key] } }), own = new Set(rows.map(r => (r.change || {}).models));
  for (const L of FB_LAYERS) if (!own.has(L.id) && L.cur()) rows.push({ key: L.id === "orchestrator" ? "main" : L.id, label: L.title(), sub: L.sub, model: withLevel(L.cur().model, L.cur().thinking), change: { models: L.id } });
  if (M.replies && !own.has("replies")) rows.push({ key: "replies", label: "답장 기본값", model: M.replies.value || "", change: { models: "replies" } });
  const have = new Set(rows.map(r => r.key));
  const extra = (M.lanes || []).filter(l => laneAlive(l) && !have.has(`lane:${l.name}`)).map(l => {
    const conf = withLevel(l.model, l.thinking), act = l.active_model;
    return { key: `lane:${l.name}`, label: `세션 · ${l.title || l.name}`, model: act || conf, ...(act && runBaseOf(act) !== runBaseOf(conf) ? { configured: conf, fallback: true } : {}), change: { models: `lane:${l.name}` } };
  });
  rows.splice(rows.findLastIndex(r => r.key === "lanes" || r.key.startsWith("lane:")) + 1, 0, ...extra);
  return rows;
}
function mtEditor(target, title) {
  const L = FB_LAYERS.find(x => x.id === target), lm = (M.lanes || []).find(x => `lane:${x.name}` === target);
  return L ? targetEdit(L.id, title, L.cur(), L.confirm, fbParts(L)) : target === "replies" ? repliesEdit(title) : lm ? targetEdit(target, title, lm, "") : null;
}
// `primary`: the first row that points at a target owns its editor; a later row on the same target (the background work, a session's subagents) only reads.
function mtRow(r, primary) {
  const ch = r.change || {}, target = primary ? ch.models : "", isOpen = Boolean(target) && modelsOpen === target;
  const lm = r.key.startsWith("lane:") ? (M.lanes || []).find(x => `lane:${x.name}` === r.key) : null;
  const run = lm ? runStatus(r.key, lm.status, targetInfo(r.key).ask) : null, sub = [run && run[0], r.sub].filter(Boolean).join(" · ");
  const why = r.fallback ? (r.key === "main" ? fbWhy("orchestrator") : r.key.startsWith("lane:") ? fbWhy("lanes") : { reason: "", until: "" }) : null;
  const chain = FB_LAYERS.some(L => L.id === target) ? ((M.fallbacks || {})[target] || {}).chain || [] : [];
  const model = selText(r.model);
  const act = target ? () => { modelsOpen = isOpen ? "" : target; modelsRefocus = r.key; renderModels(); } : ch.app ? () => asScreen(ch.app) : null;
  const attrs = { class: "mt-use-row", "data-use": r.key };
  if (act) Object.assign(attrs, { role: "button", tabindex: "0", onclick: act, onkeydown: ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); act(); } } });
  if (target) attrs["aria-expanded"] = String(isOpen);
  const end = ch.none ? el("span", { class: "mt-use-end sup", title: ch.none, text: "고정" }) : el("span", { class: "mt-use-end" }, target ? icon("drop") : ch.app ? icon("chev") : null);
  const row = el("div", attrs,
    el("div", { class: "mt-use-tx" }, el("span", { class: "nm", title: r.label }, run ? el("span", { class: `dot ${run[1]}` }) : null, r.label), sub ? el("span", { class: "sup", text: sub }) : null),
    el("div", { class: "mt-use-rest" }, el("span", { class: "mt-use-m", title: model, text: model }), chain.length ? el("span", { class: "sup mt-use-fb", text: `대체 ${chain.length}` }) : null, why ? fbTag(why, r.configured) : null),
    end);
  const editor = isOpen ? mtEditor(target, r.label) : null;
  return editor ? [row, editor] : [row];
}
function modelGroups() {
  const groups = MT_GROUPS.map(() => []), seen = new Set();
  for (const r of mtRows()) {
    const t = (r.change || {}).models;
    groups[mtGroupOf(r.key)].push(...mtRow(r, Boolean(t) && !seen.has(t)));
    if (t) seen.add(t);
  }
  return groups.map((nodes, i) => nodes.length ? el("section", { class: "mt-card", "aria-label": MT_GROUPS[i] }, el("div", { class: "mt-head" }, el("span", { class: "t", text: MT_GROUPS[i] })), el("div", { class: "list mt-use-list" }, ...nodes)) : null);
}
// 답장 기본값: the reply model of every app that has none of its own (hub/reply-model-choices.ts setReplyDefault).
function repliesEdit(title) {
  const R = M.replies;
  if (!R) return null;
  const items = R.options.map(v => ({ value: v, label: v ? R.labels[v] || v : R.default_label }));
  const pick = selectField("답장 모델", R.value ? R.labels[R.value] || R.value : R.default_label, items, R.value, v => busy(null, async () => {
    try { await api("/api/models", "PUT", { target: "replies", model: v }); toast("적용했어요"); await loadModels(true); }
    catch (e) { toast(e.message || "저장하지 못했어요", true); }
  }));
  return el("div", { class: "mt-list mt-edit", role: "group", "data-target": "replies", "aria-label": title },
    el("div", { class: "mt-pick" }, el("div", { class: "mt-model" }, pick)),
    el("div", { class: "sup mt-note", text: "답장 초안은 API 키로 넘어가지 않아요." }));
}
