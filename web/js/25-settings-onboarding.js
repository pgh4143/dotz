// 연결 자동 설정 패널 (hub/onboarding.ts, /api/onboarding/<key>): every messenger screen and 웹 접속 share it. Start runs the
// automatic steps; the panel names the one owner action while it waits and offers continue/cancel. It polls GET while the
// flow runs, and only ever draws what the view holds: no token, no error the API did not send.
const OB = {};
const OB_POLL_MS = 1500;
const OB_AUTO_MS = 4000;
const OB_AUTO_MAX = 1;
const obKeyOk = key => key === "web-access" || key === "discord" || key === "jandi" || key === "slack" || key === "telegram";
const obVisible = key => key === "web-access" ? current === "webaccess" : current === key;
const OB_TONE = { running: "pri", waiting: "warn", done: "ok", failed: "err" };
const obLine = v => v.state === "waiting" ? "내가 할 일이 하나 남았어요." : v.state === "running" ? "자동으로 연결하는 중이에요." : v.state === "done" ? "연결했어요." : v.state === "failed" ? "연결하지 못했어요." : "아직 시작하지 않았어요.";
function obPaint(key) {
  if (key === "web-access") { if (current === "webaccess") renderWebAccess(); return; }
  if (current !== key) return;
  key === "discord" ? renderDiscord() : renderMessenger(key);
}
function obStop(o) { if (o && o.timer) clearTimeout(o.timer); if (o) o.timer = 0; }
function obAutoStop(o) { if (o && o.autoTimer) clearTimeout(o.autoTimer); if (o) o.autoTimer = 0; }
// Waiting is an owner action the flow can finish by itself once done: continue once after 4 s, and never
// after the panel left the screen or the flow moved on. A step that is still waiting after that keeps its button.
function obAuto(key) {
  const o = OB[key];
  if (!o || o.state !== "waiting" || !obVisible(key)) { obAutoStop(o); return; }
  if (o.manual || o.autoTries >= OB_AUTO_MAX) return;
  if (o.autoTimer || o.autoBusy) return;
  o.autoTimer = setTimeout(async () => {
    const cur = OB[key];
    if (!cur || cur.state !== "waiting" || !obVisible(key) || cur.autoBusy) { if (cur) cur.autoTimer = 0; return; }
    cur.autoTimer = 0;
    cur.autoBusy = true;
    cur.autoTries++;
    try { obApply(key, await api(`/api/onboarding/${enc(key)}/continue`, "POST")); }
    catch { obAutoStop(cur); }
    finally {
      const now = OB[key];
      if (now) { now.autoBusy = false; if (now.state === "waiting" && now.autoTries < OB_AUTO_MAX) obAuto(key); }
    }
  }, OB_AUTO_MS);
}
function obApply(key, next) {
  const before = OB[key] || {};
  const was = before.state;
  const sameWait = next.state === "waiting" && was === "waiting";
  obStop(before);
  if (!sameWait) obAutoStop(before);
  // When a run the owner started (or watched running) ends, the screen keeps the time: the status row says it after the panel is gone.
  const doneAt = next.state !== "done" ? 0 : before.doneAt || (OB_PRESSED.has(key) || (was && was !== "done") ? Date.now() : 0);
  OB[key] = { ...before, manual: undefined, choices: undefined, ...next, doneAt, timer: 0, swap: was != null && was !== next.state, ...(sameWait ? { autoTimer: before.autoTimer || 0 } : { autoTimer: 0 }) };
  if (next.state === "waiting" && !sameWait) { OB[key].autoTries = 0; OB[key].autoBusy = false; }
  obPaint(key);
  obPoll(key);
  if (next.state === "waiting" && !sameWait) obAuto(key);
  if (next.state === "done" && was && was !== "done" && !before.doneHandled) {
    OB[key].doneHandled = true;
    obAfterDone(key);
  }
}
// A finished flow reloads the index and the screen it belongs to, so the header and switches show the new state.
function obAfterDone(key) {
  loadMessengerIndex();
  if (key === "web-access") { WA.draft = null; loadWebAccess(); return; }
  if (key === "discord") { loadDiscord(); return; }
  loadMessengerSettings(key);
}
async function loadOnboarding(key) {
  if (!obKeyOk(key)) return;
  try { obApply(key, await api(`/api/onboarding/${enc(key)}`)); }
  catch { obPaint(key); }
}
// The keys whose start is on its way: the pressed row says 연결하는 중 until the answer comes (the start can take a while), and a failure says what to do.
const OB_WAIT = new Set();
const OB_PRESSED = new Set();
async function obStart(key) {
  if (OB_WAIT.has(key)) return;
  if (OB[key]) obAutoStop(OB[key]);
  delete OB[key];
  OB_WAIT.add(key); OB_PRESSED.add(key); obPaint(key);
  try {
    await busy(null, async () => {
      try { obApply(key, await api(`/api/onboarding/${enc(key)}/start`, "POST")); }
      catch (e) { throw new Error(`연결을 시작하지 못했어요 · ${e.message}. 잠시 뒤에 다시 눌러 주세요`); }
    });
  } finally { OB_WAIT.delete(key); OB_PRESSED.delete(key); obPaint(key); }
}
async function obPick(key, choice, btn) {
  await busy(btn, async () => { obApply(key, await api(`/api/onboarding/${enc(key)}/continue`, "POST", { choice })); });
}
async function obAct(key, action, btn) {
  await busy(btn, async () => { obApply(key, await api(`/api/onboarding/${enc(key)}/${action}`, "POST")); });
}
function obPoll(key) {
  const o = OB[key];
  if (!o || (o.state !== "running" && o.state !== "waiting")) { obStop(o); return; }
  if (!obVisible(key)) { obStop(o); obAutoStop(o); return; }
  if (o.timer) return;
  o.timer = setTimeout(async () => {
    o.timer = 0;
    if (OB[key] !== o || !obVisible(key)) { obStop(o); obAutoStop(o); return; }
    try { obApply(key, await api(`/api/onboarding/${enc(key)}`)); }
    catch { obPoll(key); }
  }, OB_POLL_MS);
}
// A live messenger has nothing left to connect, so its section goes; a run in progress or failed stays whatever the link says.
const obSection = (key, live) => {
  const s = OB[key] && OB[key].state;
  if (!OB_WAIT.has(key) && (!s || s === "idle")) return [];   // nothing started: the connect row's button is the way in, an empty panel only says so again
  return live && s !== "running" && s !== "waiting" && s !== "failed" ? [] : [el("div", { class: "sec", text: "자동 연결" }), onboardingPanel(key)];
};
// The panel: state, current step, error (only when the API sent one), the single owner line, and its actions.
function onboardingPanel(key) {
  const pend = OB_WAIT.has(key) && !OB[key];   // start pressed, no answer yet: shown as running, without a cancel (nothing to cancel yet)
  const v = OB[key] || { state: pend ? "running" : "idle", step: null, owner: null, error: null, url: null };
  const waiting = v.state === "waiting", failed = v.state === "failed", running = v.state === "running";
  // One state row: the dot (blue running, orange waiting, green done, red failed; never pulsing), the line, and the actions in .li-end.
  // A state change swaps in this same row.
  const acts = [
    ...((waiting && !v.choices) || failed ? [el("button", { type: "button", class: "btn inrow", "data-onb-continue": "1", onclick: ev => obAct(key, "continue", ev.currentTarget) }, "계속")] : []),
    ...(failed ? [el("button", { type: "button", class: "btn tonal inrow", "data-onb-start": "1", onclick: () => obStart(key) }, "다시 시작")] : []),
    ...((running && !pend) || waiting ? [el("button", { type: "button", class: "btn text inrow", "data-onb-cancel": "1", onclick: ev => obAct(key, "cancel", ev.currentTarget) }, "취소")] : []),
  ];
  const head = el("div", { class: "li" }, el("span", { class: "lead" }, el("span", { class: `dot ${OB_TONE[v.state] || ""}`, "aria-hidden": "true" })), el("span", { class: "tx" },
    el("div", { class: "hd", text: "자동 연결" }), el("div", { class: "sup", "data-onb-line": "1", text: obLine(v) })), acts.length ? liEnd(...acts) : null);
  const rows = [head];
  if (v.swap) requestAnimationFrame(() => motionSwap(head, () => {}));
  if (v.step && !((waiting || failed) && v.owner && v.owner.label === v.step.title)) rows.push(el("div", { class: "li" }, el("span", { class: "tx" }, el("div", { class: "hd", text: v.step.title }), el("div", { class: "sup", text: v.step.detail }))));
  if (v.error) rows.push(el("div", { class: "li" }, el("span", { class: "tx" }, el("div", { class: "dcs-err", role: "alert", "data-onb-error": "1", text: v.error }))));
  if ((waiting || failed) && v.owner) rows.push(el("div", { class: "li", "data-onb-owner": v.owner.label },
    el("span", { class: "tx" }, el("div", { class: "hd", text: v.owner.label }), el("div", { class: "sup", text: v.owner.hint }))));
  if (waiting && v.choices) for (const c of v.choices) rows.push(el("div", { class: "li", "data-onb-choice": c.id }, el("span", { class: "tx" }, el("div", { class: "hd", text: c.label })),
    liEnd(el("button", { type: "button", class: "btn tonal inrow", onclick: ev => obPick(key, c.id, ev.currentTarget) }, "고르기"))));
  if (v.url) rows.push(el("div", { class: "li" }, el("span", { class: "tx" }, el("a", { class: "ms-link", href: v.url, target: "_blank", rel: "noopener noreferrer", "data-onb-url": "1", text: v.url }))));
  return el("div", { class: "list ms-onb", "data-onb": key, "data-onb-state": v.state }, ...rows);
}
// A save ends in the button it was pressed on: the label swaps to "저장했어요" for a moment (the button keeps its width), with no toast.
function stFlash(sel, label = "저장했어요") {
  const b = document.querySelector(sel);
  if (!b) return;
  const was = b.textContent;
  motionSwap(b, () => { b.textContent = label; });
  setTimeout(() => { if (b.isConnected && b.textContent === label) motionSwap(b, () => { b.textContent = was; }); }, 1800);
}
// The closed disclosure that keeps manual fields out of the default view: its body is built only when opened.
function msAdvanced(attr, open, body, label = "직접 입력") {
  const box = el("div", { class: "ms-adv-body" });
  const d = el("details", { class: "ms-adv", [attr]: "1", ...(open ? { open: true } : {}) }, el("summary", { class: "ms-adv-sum", text: label }), box);
  let built = false;
  const fill = () => { if (!built) { built = true; box.append(body()); } };
  // A redraw can replace this element before its toggle event arrives; filling it then would pull shared inputs (the Discord form) out of the new one.
  d.addEventListener("toggle", () => { d.dataset.open = d.open ? "1" : ""; if (d.open && d.isConnected) fill(); });
  d.dataset.open = open ? "1" : "";
  if (open) fill();
  return d;
}
