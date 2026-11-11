/* ---------- installable app + web push (web/sw.js, /api/push in hub/push.ts) ---------- */
const PWA = { reg: null, sub: null, info: null, gw: null, claimed: false };
// Set when the owner turns notifications on here, cleared when he turns them off: a subscription the push service dropped (404/410) is then made again quietly.
const PUSH_ON = "dotz-push-on";
// Set only when the owner turns notifications off here: the installed app otherwise keeps itself subscribed while permission is granted (owner 2026-11-02:
// no manual step), also when it was subscribed before PUSH_ON existed or the platform dropped the subscription (getSubscription() null, 2026-11-03).
const PUSH_OFF = "dotz-push-off";
const pushWanted = () => Boolean(PWA.sub) || localStorage.getItem(PUSH_ON) === "1" || (isStandalone() && localStorage.getItem(PUSH_OFF) !== "1");
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const pushCapable = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const b64uBytes = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
// Photos shared from the phone's gallery arrive through the service worker (sw.js stashShare) and a redirect to /?shared=1#chat:
// they join the composer like picked files, and any shared text goes into the input box. Nothing is sent.
async function sharedIntake() {
  if (!new URLSearchParams(location.search).has("shared")) return;
  history.replaceState(history.state, "", location.pathname + location.hash);
  if (!("caches" in window)) return;
  try {
    const c = await caches.open("dotz-share");
    const mr = await c.match("/share/meta");
    if (!mr) return;
    const meta = await mr.json(), files = [];
    for (let i = 0; i < meta.n; i++) {
      const r = await c.match(`/share/file/${i}`);
      if (r) files.push(new File([await r.blob()], decodeURIComponent(r.headers.get("X-Name") || ""), { type: r.headers.get("Content-Type") || "" }));
    }
    await caches.delete("dotz-share");
    go("chat");
    if (meta.text) { ta.value = ta.value.trim() ? `${ta.value.replace(/\s+$/, "")}\n${meta.text}` : meta.text; ta.dispatchEvent(new Event("input")); ta.focus(); }
    if (!files.length) return;
    const n = Math.min(files.length, Math.max(0, 10 - ATT.length));
    toast(files.every(f => /^image\//.test(f.type)) ? `사진 ${n}장을 붙였어요` : `파일 ${n}개를 붙였어요`);
    addFiles(files);
  } catch (e) { console.warn("shared files", e); }
}
window.addEventListener("load", sharedIntake);
// a tapped notification asks an open window to show its conversation; listened for as the script runs (not after the page's load
// event) so a tap that lands while the page is still starting is not dropped
// A tap the worker hands an open window says how it got here ({tap}: path, tag) and brings a port: the page answers on it that it got the tap (else sw.js opens the
// address instead), and reports where it landed (POST /api/push/tap, one line in the gateway log).
const pushTapGot = ev => { try { ev.ports[0].postMessage(1); } catch { /* no port (an older sw) or it stopped waiting: sw.js opens the address itself */ } };
function pushTapReport(tap, reason) {
  if (!tap || !tap.path) return;
  const screen = current === "chat" ? `chat:${target}` : current;
  fetch("/api/push/tap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tag: tap.tag || "", path: tap.path, why: tap.why || "", screen, reason: typeof reason === "string" ? reason : "" }), keepalive: true }).catch(e => console.warn("push tap report", e));
}
if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", ev => { const d = ev.data || {}, h = d.open ? new URL(d.open, location.href).hash : "";
  if (d.open && !d.notice) pushTapGot(ev);   // a decision push (d.notice) is answered and opened by its id (30-notices.js)
  if (!h || d.notice) { if (d.open && !d.notice) pushTapReport(d.tap, "no-address"); return; }
  ovCloseAll();   // nothing left open covers the landing
  const landed = d.ts ? pushOpen(h, d.ts, d.nid) : location.hash !== h ? (p => go(p.view, p.t))(parseHash(h)) : "";
  Promise.resolve(landed).then(r => pushTapReport(d.tap, r), () => pushTapReport(d.tap, "error"));
});
// A new shell version: sw.js refreshShell posts {type:"shell-updated"} when its background fetch brought a changed page, script or styles.
// The page reloads onto it only while it is hidden and nothing would be lost (empty composer, no attachment, sheet, dialog, or viewer open): a reload
// under a visible page closes the phone keyboard, even with an empty box. Otherwise a chip offers it, and the reload comes when the page is next hidden. The route is the hash and survives the reload; the scroll place is kept in sessionStorage and put back (chatOpen, shellRestoreViews).
// One automatic reload per minute at most, so a shell that keeps changing cannot loop.
const SHELL_KEY = "dotz-shell-reload", SHELL_LOOP_MS = 60000, SHELL_AWAY_MS = 3 * 60000;
const shellMem = () => { try { return JSON.parse(sessionStorage.getItem(SHELL_KEY) || "null") || {}; } catch { return {}; } };
let SHELL_RESTORE = (() => { const m = shellMem(); if (!m.at || m.used || Date.now() - m.at > 30000) return null; try { sessionStorage.setItem(SHELL_KEY, JSON.stringify({ ...m, used: true })); } catch {} return m; })();
if (SHELL_RESTORE) setTimeout(() => { SHELL_RESTORE = null; }, 15000);
const shellSafe = () => !ta.value.trim() && !ATT.length && !OV.length && !SUBD && !document.querySelector("dialog[open]:not([data-leaving])");
function shellApply() {
  shellPending = false;
  const s = { at: Date.now(), hash: location.hash, views: $("#views").scrollTop };
  if (current === "chat" && !convListing()) Object.assign(s, { key: target, stick: chatStick, anchor: chatAnchor() });
  try { sessionStorage.setItem(SHELL_KEY, JSON.stringify(s)); } catch {}
  reloadPage();
}
function reloadPage() { location.reload(); }
const shellIdle = () => document.visibilityState === "hidden" && shellSafe() && Date.now() - (shellMem().at || 0) > SHELL_LOOP_MS;
let shellPending = false;
function shellUpdated() {
  if (shellIdle()) return shellApply();
  shellPending = true;
  if (!document.querySelector(".shell-chip")) document.body.append(el("button", { class: "shell-chip", type: "button", text: "새 버전 · 눌러서 적용", onclick: shellApply }));
}
if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", ev => { if (ev.data && ev.data.type === "shell-updated") shellUpdated(); });
// Back after a while away: ask the worker to look for a new shell now (a notification tap or a long sleep leaves the open page behind).
let shellHiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") { shellHiddenAt = Date.now(); if (shellPending && shellIdle()) shellApply(); return; }
  const away = shellHiddenAt ? Date.now() - shellHiddenAt : 0;
  shellHiddenAt = 0;
  homeTop();
  const sw = away > SHELL_AWAY_MS && "serviceWorker" in navigator && (navigator.serviceWorker.controller || (PWA.reg && PWA.reg.active));
  if (sw) sw.postMessage({ type: "refresh-shell" });
});
// The hub reports the build id of the shell it serves (/api/state web_build). A page that runs another one, however long it stayed open,
// has the worker store the new shell, then reloads onto it (or shows the chip). One try per build and page life.
let webBuildAsked = "";
async function webBuildCheck(b) {
  if (!b || b === WEB_BUILD || webBuildAsked === b) return;
  webBuildAsked = b;
  const sw = "serviceWorker" in navigator && (navigator.serviceWorker.controller || (PWA.reg && PWA.reg.active));
  if (sw) await new Promise(res => { const ch = new MessageChannel(); ch.port1.onmessage = res; setTimeout(res, 8000); sw.postMessage({ type: "refresh-shell" }, [ch.port2]); });
  shellUpdated();
}
// Views other than a conversation have no anchor: put their scroll back once they are drawn.
if (SHELL_RESTORE && !SHELL_RESTORE.key && SHELL_RESTORE.views) for (const ms of [300, 1200]) setTimeout(() => { const v = $("#views"); if (SHELL_RESTORE && current !== "home" && !v.scrollTop) v.scrollTop = SHELL_RESTORE.views; }, ms);
// A tap that had to start the app carries the message as ?m=<ts>: 99-boot.js opens it once the state is in. A decision carries ?n=<id> (its sheet,
// 30-notices.js), with ?m= only as the place to land when that decision is no longer listed.
const pushQ = new URLSearchParams(location.search), PUSH_HREF = location.href;
// The device id: every subscription this device makes, on any computer, carries it, so the computers know they are one device (hub/push.ts fanOut).
// It is minted once here; opening another computer from this app (33-peers.js) hands it on as ?did=, and the page that arrives with one keeps that one.
let DEVICE_ID = "";
try {
  const incoming = pushQ.get("did") || "";
  if (/^[\w-]{8,64}$/.test(incoming)) localStorage.setItem("dotz-did", incoming);
  DEVICE_ID = localStorage.getItem("dotz-did") || "";
  if (!DEVICE_ID) localStorage.setItem("dotz-did", DEVICE_ID = crypto.randomUUID());
} catch {}
if (pushQ.has("did")) { pushQ.delete("did"); const rest = pushQ.toString(); history.replaceState(history.state, "", location.pathname + (rest ? `?${rest}` : "") + location.hash); }
// An address a tap already spent, come back with the app: its landing is over, and only the route stays.
const PUSH_SPENT = "dotz-push-spent", PUSH_SPENT_MAX = 30;
const pushSpent = () => { try { return JSON.parse(localStorage.getItem(PUSH_SPENT) || "[]"); } catch { return []; } };
const PUSH_REPLAY = pushSpent().includes(PUSH_HREF);
if (PUSH_REPLAY) { for (const k of ["m", "i", "n", "pc"]) pushQ.delete(k); const rest = pushQ.toString(); history.replaceState(history.state, "", location.pathname + (rest ? `?${rest}` : "") + location.hash); }
// ?pc=<origin> (a notice relayed from another computer): the page switches to that computer (33-peers.js prFollow), with ?n / ?m as its own item.
const PUSH_FOLLOW = pushQ.has("pc") ? location.href : "";
let pushOpenTs = pushQ.has("n") || PUSH_FOLLOW ? "" : pushQ.get("m") || "";
const pushOpenNid = pushQ.get("i") || "", pushDecisionAt = pushQ.has("n") ? pushQ.get("m") || "" : "";
const PUSH_HASH = location.hash;   // the tapped address: the first go() rewrites it (#chat/alert to #notices, a mail to #monitoring/c:...)
if (pushQ.has("m") && !PUSH_FOLLOW) { pushQ.delete("m"); pushQ.delete("i"); const rest = pushQ.toString(); history.replaceState(history.state, "", location.pathname + (rest ? `?${rest}` : "") + location.hash); }
// The tap that started the app wins over the address it started at (web/sw.js openAt: a phone may bring back an older one), and that address is then spent.
// Runs on load and on coming back: a window that never opened leaves its tap to the page it brought forward.
const PUSH_TAP_MS = 60000;
async function pushTapCheck() {
  try {
    const c = await caches.open("dotz-share"), hit = await c.match("/push/tap"), tap = hit && await hit.json();
    if (!tap || tap.used || Date.now() - tap.at > PUSH_TAP_MS) return;
    const spent = pushSpent().filter(h => h !== tap.href);
    if (tap.href === PUSH_HREF && !PUSH_REPLAY) {
      await c.put("/push/tap", new Response(JSON.stringify({ ...tap, used: true })));
      localStorage.setItem(PUSH_SPENT, JSON.stringify([...spent, tap.href].slice(-PUSH_SPENT_MAX)));
      return;
    }
    localStorage.setItem(PUSH_SPENT, JSON.stringify(spent));
    history.replaceState(null, "", tap.href);
    reloadPage();
  } catch (e) { console.warn("push tap", e); }
}
// The tap that started this page (its record in the cache, web/sw.js openAt) reports where the page landed, once; `landing`: the open's result, awaited.
let PUSH_REPORTED = false;
async function pushTapCold(landing) {
  if (PUSH_REPORTED || PUSH_REPLAY) return;   // a spent address reloads at the real tap (pushTapCheck), and that page reports
  PUSH_REPORTED = true;
  try {
    const hit = await (await caches.open("dotz-share")).match("/push/tap"), tap = hit && await hit.json();
    if (!tap || tap.href !== PUSH_HREF || Date.now() - tap.at > 5 * PUSH_TAP_MS) return;
    const reason = await landing;
    pushTapReport(tap, PUSH_FOLLOW && !reason ? "follow" : reason);
  } catch (e) { console.warn("push tap", e); }
}
async function pwaInit() {
  if (!("serviceWorker" in navigator)) return;
  try { PWA.reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" }); } catch (e) { console.warn("service worker", e); return; }
  if (pushCapable()) PWA.sub = await PWA.reg.pushManager.getSubscription().catch(() => null);
  await pushLoad();
  presence();
}
async function pushLoad() {
  PWA.checked = Date.now();
  try { PWA.info = await api(`/api/push${PWA.sub ? `?endpoint=${enc(PWA.sub.endpoint)}` : ""}`); } catch {}
  // This computer learns which device the subscription is (the id) and whether it is the installed app's (hub/push.ts): once per change.
  if (PWA.sub && PWA.info && PWA.info.subscribed && (PWA.info.did !== DEVICE_ID || (!PWA.info.app && isStandalone()))) {
    try { await api("/api/push/subscribe", "POST", { subscription: PWA.sub.toJSON(), did: DEVICE_ID, ...(isStandalone() ? { app: true } : {}) }); PWA.info.did = DEVICE_ID; if (isStandalone()) PWA.info.app = true; } catch {}
  }
  // The gateway dropped this device's subscription (the push service answered 404/410, hub/push.ts deliver) while permission is still granted: subscribe
  // again (at most every 10 minutes), with a fresh subscription, so the phone does not go silent until someone opens the settings (2026-10-30).
  if (Date.now() - (PWA.resubAt || 0) > 600000 && pushCapable() && Notification.permission === "granted" && PWA.info && PWA.info.publicKey && !PWA.info.subscribed && pushWanted()) {
    PWA.resubAt = Date.now();
    try {
      if (PWA.sub) await PWA.sub.unsubscribe().catch(() => {});
      PWA.sub = await PWA.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBytes(PWA.info.publicKey) });
      await api("/api/push/subscribe", "POST", { subscription: PWA.sub.toJSON(), app: isStandalone(), did: DEVICE_ID });
      localStorage.setItem(PUSH_ON, "1");
      PWA.info = await api(`/api/push?endpoint=${enc(PWA.sub.endpoint)}`);
    } catch (e) { console.warn("push resubscribe", e); }
  }
  await pushGateways();
  if (inSettings()) renderSettings();
}
// One delivery channel per device: the installed app. GET /api/push/gateways (hub/push.ts) answers with every gateway and whether its notices reach this device;
// the page on any gateway's origin shows and edits the same list. A browser subscription of THIS origin for a device that has the app is a second channel: it goes.
async function pushGateways() {
  if (!DEVICE_ID) return;
  if (isStandalone() && PWA.sub && PWA.info && PWA.info.app && !PWA.claimed) { PWA.claimed = true; api("/api/push/claim", "POST", { did: DEVICE_ID }).catch(() => {}); }
  try { PWA.gw = await api(`/api/push/gateways?did=${enc(DEVICE_ID)}`); } catch { PWA.gw = null; }
  if (PWA.gw && PWA.gw.app && PWA.sub && PWA.info && !PWA.info.app) {
    const sub = PWA.sub;
    PWA.sub = null; PWA.info.subscribed = false;
    try { await api("/api/push/unsubscribe", "POST", { endpoint: sub.endpoint }); } catch {}
    await sub.unsubscribe().catch(() => {});
  }
}
async function pushGw(g, on) {
  const was = g.on;
  g.on = on; renderSettings();
  try { await api("/api/push/gateways", "PUT", { did: DEVICE_ID, url: g.url, on }); } catch (e) { g.on = was; toast(e.message, true); }
  await pushGateways();
  renderSettings();
}
async function pushEnable(btn) {
  await busy(btn, async () => {
    localStorage.removeItem(PUSH_OFF);
    if ((await Notification.requestPermission()) !== "granted") throw new Error(`알림 권한이 꺼져 있어요. 기기 설정에서 ${botName} 알림을 허용해 주세요`);
    const reg = PWA.reg || await navigator.serviceWorker.ready;
    const info = PWA.info || await api("/api/push");
    PWA.sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBytes(info.publicKey) });
    await api("/api/push/subscribe", "POST", { subscription: PWA.sub.toJSON(), app: isStandalone(), did: DEVICE_ID });
    localStorage.setItem(PUSH_ON, "1");
    toast("알림을 켰어요");
  });
  await pushLoad();
  presence();
}
async function pushDisable(btn) {
  await busy(btn, async () => {
    const sub = PWA.sub;
    PWA.sub = null;
    localStorage.removeItem(PUSH_ON);
    localStorage.setItem(PUSH_OFF, "1");
    if (sub) { await api("/api/push/unsubscribe", "POST", { endpoint: sub.endpoint }); await sub.unsubscribe().catch(() => {}); }
    toast("알림을 껐어요");
  });
  await pushLoad();
}
const pushTest = btn => busy(btn, async () => { await api("/api/push/test", "POST", { endpoint: PWA.sub.endpoint }); toast("테스트 알림을 보냈어요"); });
// The gateway skips a push to this device while its page is visible and focused on the same conversation (heartbeat every 25s, stale after 60s);
// a push about another conversation still shows.
let presTimer = 0;
function presence() {
  clearTimeout(presTimer);
  if (!PWA.sub) return;
  const active = document.visibilityState === "visible" && document.hasFocus();
  fetch("/api/push/presence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: PWA.sub.endpoint, active, conv: current === "chat" ? target : "" }), keepalive: true }).catch(() => {});
  if (active) presTimer = setTimeout(presence, 25000);
}
document.addEventListener("visibilitychange", presence);
// An installed app is resumed far more often than it is reloaded (iOS keeps it suspended): its subscription is checked again on return, at most every 10 minutes.
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && PWA.reg && pushCapable() && Date.now() - (PWA.checked || 0) > 600000) pwaRecheck(); });
async function pwaRecheck() {
  PWA.sub = await PWA.reg.pushManager.getSubscription().catch(() => PWA.sub);
  await pushLoad();
  presence();
}
["focus", "blur", "pagehide", "hashchange"].forEach(t => window.addEventListener(t, presence));
window.addEventListener("load", pwaInit);
// Install: Chrome/Edge/Samsung hand over beforeinstallprompt (a real app install, never the menu's shortcut);
// iOS has no prompt, so the button opens the Share -> 홈 화면에 추가 steps.
let installEvt = null;
window.addEventListener("beforeinstallprompt", ev => { ev.preventDefault(); installEvt = ev; if (inSettings()) renderSettings(); });
window.addEventListener("appinstalled", () => { installEvt = null; toast(`앱을 설치했어요. 홈 화면의 ${botName} 아이콘으로 열어 주세요`); if (inSettings()) renderSettings(); });
async function installApp() {
  if (installEvt) {
    const e = installEvt;
    installEvt = null;
    await e.prompt();
    await e.userChoice.catch(() => null);
    if (inSettings()) renderSettings();
    return;
  }
  const ua = navigator.userAgent;
  const steps = isIOS()
    ? [/CriOS|FxiOS|EdgiOS/.test(ua) ? "주소창의 공유 버튼을 눌러요" : "Safari 아래쪽(또는 주소창)의 공유 버튼을 눌러요", "'홈 화면에 추가'를 골라요", "'웹 앱으로 열기'가 켜져 있는지 보고 '추가'를 눌러요"]
    : /Android/.test(ua)
      ? ["브라우저 메뉴(⋮)를 열어요", "'앱 설치'를 골라요. '홈 화면에 추가'라면 다음 창에서 '설치'를 골라요", "'바로가기 만들기'는 브라우저로 열려요. 고르지 마세요"]
      : ["주소창 오른쪽의 설치 아이콘을 눌러요", "없으면 브라우저 메뉴에서 '앱 설치'를 골라요"];
  dialog({ classic: true, title: "앱 설치", body: el("div", {}, el("ol", { class: "steps" }, ...steps.map(s => el("li", { text: s }))), el("p", { class: "note", text: `전에 추가한 ${botName} 아이콘이 브라우저로 열리면 지우고 다시 추가해 주세요.` })), actions: [{ label: "확인", kind: "pri", onclick: c => c() }] });
}
function pushSection() {
  const li = (ic, title, ...trail) => el("div", { class: "li" }, el("span", { class: "lead" }, icon(ic)), el("span", { class: "tx" }, el("div", { class: "hd", text: title })), trail.length ? liEnd(...trail) : null);
  const ios = isIOS(), standalone = isStandalone();
  const rows = [];
  if (!standalone) rows.push(li("home", "홈 화면에 추가", el("button", { class: "btn tonal inrow", type: "button", onclick: () => installApp() }, "앱 설치")));
  const subscribed = PWA.sub && PWA.info && PWA.info.subscribed;
  if (PWA.gw && PWA.gw.app) {
    // The device has the app: one row per gateway, whichever gateway's page this is. A gateway that does not answer cannot be switched.
    for (const g of PWA.gw.gateways) {
      const label = `${g.name || "이 컴퓨터"} 알림`;
      rows.push(li("bell", label, g.online ? el("button", { type: "button", class: "hs-sw", role: "switch", "aria-checked": String(g.on), "aria-label": label, onclick: () => pushGw(g, !g.on) }) : el("span", { class: "sup", text: "연결 안 됨" })));
    }
  } else if (!pushCapable()) rows.push(li("bell", ios && !standalone ? "iPhone은 홈 화면에 추가한 앱에서 알림을 켤 수 있어요" : "이 브라우저는 알림을 지원하지 않아요. Chrome이나 설치한 앱에서 켤 수 있어요"));
  else if (Notification.permission === "denied") rows.push(li("bell", "알림 권한이 막혀 있어요"));
  else if (!subscribed) rows.push(li("bell", "알림", el("button", { class: "btn inrow", type: "button", onclick: ev => pushEnable(ev.currentTarget) }, "알림 켜기")));
  const kinds = appNotifyRows();
  if (subscribed) {
    rows.push(li("bell", "알림 확인", el("button", { class: "btn tonal inrow", type: "button", onclick: ev => pushTest(ev.currentTarget) }, "테스트 알림"), el("button", { class: "btn text inrow", type: "button", onclick: ev => pushDisable(ev.currentTarget) }, "끄기")));
  }
  return [...(rows.length ? [el("div", { class: "sec", text: "이 기기" }), el("div", { class: "list" }, ...rows)] : []), ...(kinds.length ? [el("div", { class: "sec", text: "알림 종류" }), el("div", { class: "list" }, ...kinds)] : [])];
}
