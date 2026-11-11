/* ---------- computers: switch between this owner's gateways (맥북, 맥미니) ---------- */
// Data: GET /api/peers (hub/peers.ts) -> [{name, url, self, online, unread?, need?, via?}]. A row with key and via (hub/messenger.ts relay, today "jandi") is a computer reached only through that messenger: picking it keeps this app's chat view and only changes the transport (42-relay-chat.js); its url is only a unique string. `public: true`: the computer has a public address and opens as its own web app.
// With 2 or more the bot name opens the switch sheet (owner 2026-11-04: one row, no separate computer row): the logo + name + one chevron at the top left on a wide screen, the page title on the
// phone (there the brand is hidden; on 홈 the title is the bot name). A small dot says another computer has something unread (warn: a question waits): at the chevron's bottom right on a wide
// screen, at the name's bottom right on the phone. The computer in use is named in the sheet, with its check.
// The sheet is one row per computer: name, its own dot, and ✓ / 연결됨 / 연결 안 됨. An offline computer stays listed, greyed; choosing it says it cannot connect. Choosing one opens that computer's own address (its own PWA, login and push).
// The last list that arrived is kept in localStorage and drawn at once: coming back from the other computer the page starts from the service worker's
// cached shell before the phone's network is up, and a first /api/peers that failed left the switcher off until the next minute. A failed fetch is retried within seconds.
// One order on every computer: each gateway lists itself first, so "the one after me" from its own list sent A to B and B back to A
// with three or more (owner 2026-10-31). The list is ordered by address (unique and the same everywhere), for the sheet and Ctrl+` alike.
function prOrder(list) { return [...list].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0)); }
const prCached = () => { const l = lsJson("dotz-peers", []); return Array.isArray(l) ? prOrder(l.filter(p => p && typeof p.name === "string" && typeof p.url === "string")) : []; };
const PR = { list: prCached(), node: null, ov: null, opener: null, tries: 0, timer: 0, fresh: false };
const PR_RETRY_MS = [2000, 5000, 15000];
const prSelf = () => PR.list.find(p => p.self);
const prOthers = () => PR.list.filter(p => !p.self);
/** The computer to switch to when this one is down: a relay row needs this gateway and a public row opens its own app, so only a direct one counts. */
const prFailover = () => prOthers().find(p => !p.via && !p.public);
const prText = p => [p.need > 0 ? `답변 필요 ${p.need}` : "", p.unread > 0 ? `새 알림 ${p.unread}` : ""].filter(Boolean).join(" · ");

async function prLoad() {
  try {
    const r = await api("/api/peers"); PR.list = Array.isArray(r) ? prOrder(r) : []; PR.tries = 0; PR.fresh = true;
    try { localStorage.setItem("dotz-peers", JSON.stringify(PR.list.map(({ name, url, self, online, via, key, note, public: open }) => ({ name, url, self, online, via, key, note, public: open })))); } catch {}
  } catch {
    clearTimeout(PR.timer);
    if (PR.tries < PR_RETRY_MS.length) PR.timer = setTimeout(prLoad, PR_RETRY_MS[PR.tries++]);
    return;
  }
  prPaint();
  if (typeof paintPause === "function") paintPause();   // the pause line names this computer, which the list gives
}

// A tapped notice relayed from another computer arrives as ?pc=<that computer's origin>[&n=<decision id>|&m=<message ts>]#<route> (cold start:
// PUSH_FOLLOW in 23-installable-app-web.js; open app: a {follow} message from sw.js). Only an origin in this gateway's own computer list is followed
// (never a free URL); the page then continues on that computer at the item. Unknown after a fresh list, or offline: it stays here.
let prFollowHref = typeof PUSH_FOLLOW === "string" ? PUSH_FOLLOW : "";
function prTryFollow() {
  if (!prFollowHref) return;
  let u; try { u = new URL(prFollowHref, location.href); } catch { prFollowHref = ""; return; }
  const p = prOthers().find(x => x.url === u.searchParams.get("pc"));
  if (!p && !PR.fresh) return;   // the cached list may predate this computer; wait for the fresh one
  prFollowHref = "";
  if (!p || !p.online) { toast(p ? `${p.name}에 연결할 수 없어요` : "그 컴퓨터를 찾지 못했어요", true); history.replaceState(history.state, "", location.pathname + location.hash); return; }
  const q = new URLSearchParams(p.public ? {} : { did: DEVICE_ID });   // a public computer is its own web app: no device id goes to it
  for (const k of ["n", "m"]) if (u.searchParams.has(k)) q.set(k, u.searchParams.get(k));
  prGo(`${p.url}/${q.size ? `?${q}` : ""}${u.hash}`, true);
}

if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", ev => { const d = ev.data || {}; if (typeof d.follow === "string") { pushTapGot(ev); prFollowHref = d.follow; prTryFollow(); pushTapReport(d.tap, "follow"); } });

// Frames this gateway forwards from the other computers' event streams (hub/peer-stream.ts), so the page hears them without leaving its own origin:
// peer_counts updates that computer's numbers (and the bot name's dot) at once; peer_notice is a new notice there. It toasts (tap = that computer, at the item, like a
// push tap) only in 모니터링 and while this page is visible: a hidden page gets the push instead, and the hub quiets the push while the page is open (hub/push.ts presence).
const prSeen = new Set();
// A conversation of the other computer this page just acted in (a draft sent, fixed or dropped through it): what that computer says about it next is
// already in front of the owner, so it does not toast here (owner 2026-10-28: a mail sent from 맥북 still raised 맥미니 toasts).
const PR_ACTED = new Map(), PR_ACTED_MS = 5 * 60_000;
const prActed = t => { if (t) PR_ACTED.set(t, Date.now()); };
// The open conversation counts only when it is the other computer's one open in 모니터링 (names repeat across computers: "main" is on both).
const prQuiet = t => !!t && (Date.now() - (PR_ACTED.get(t) || 0) < PR_ACTED_MS || (t === monCtx && typeof pqPc === "function" && !!pqPc(t)));
function prLive(e) {
  if (e.kind === "peer_notice_done") {   // answered or read over there: its toast here goes away
    for (const s of document.querySelectorAll(".snack[data-peer-nid]")) if ((e.ids || []).includes(s.dataset.peerNid)) s.remove();
    return;
  }
  if (current === "monitoring" || monCtx) pqSoon();   // the snapshot is read only by 모니터링
  const p = PR.list.find(x => !x.self && x.url === (e.kind === "peer_counts" ? e.url : e.peer && e.peer.url));
  if (e.kind === "peer_counts") {
    if (!p) return;
    p.online = e.online !== false; p.unread = e.unread; p.need = e.need;
    prPaint();
    return;
  }
  // Outside 모니터링 each tab is this computer's alone (owner 2026-10-31): there the bot name's dot (peer_counts above) is the only sign.
  if (!p || document.hidden || prQuiet(e.to) || (current !== "monitoring" && !monCtx)) return;
  const key = `${p.url}|${e.key || e.id}`;
  if (prSeen.has(key)) return;
  prSeen.add(key);
  p.online = true;
  const ask = e.notice === "decision" || e.tone === "ask";
  const text = e.title ? (ask ? `답변이 필요해요 · ${e.title}` : e.title) : ask ? "답변이 필요해요" : "새 알림";
  toast(`${p.name} · ${text}`, false, { label: "열기", onclick: () => prOpenItem(p, e.id) }, 8000);
  const s = document.querySelector(".snack:last-of-type");
  if (s) s.dataset.peerNid = String(e.id);
}
// The same hand-over as a tapped push: ?pc= names the computer, ?n= the notice, which opens there by its kind (a decision opens its sheet).
function prOpenItem(p, id) {
  prFollowHref = `${location.origin}/?pc=${enc(p.url)}&n=${enc(id)}`;
  prTryFollow();
}

const prTrig = () => !!prSelf() && PR.list.length >= 2;
function prPaint() {
  prTryFollow();
  relayNames();
  relayPaint();   // a chat opened by address before the list came: the note line and the title wait for its names
  const me = prSelf(), on = prTrig(), chev = $("#brand-c"), names = [chev, $("#title")], brand = $("#brand"), title = $("#title");
  $("#appbar").classList.toggle("hasp", on);
  chev.hidden = !on;
  if (!on) {
    for (const n of names) n.classList.remove("pdot", "p-need");
    brand.setAttribute("aria-label", "홈으로"); brand.title = "홈으로"; brand.removeAttribute("aria-haspopup");
    title.removeAttribute("tabindex"); title.removeAttribute("aria-haspopup");
    prClose(false); return;
  }
  // The TLS handshake to the other computer is paid now, not when the owner taps it.
  for (const p of prOthers()) if (p.online && !p.via && !document.head.querySelector(`link[rel=preconnect][href="${p.url}"]`)) document.head.append(el("link", { rel: "preconnect", href: p.url }));
  const others = prOthers(), more = others.some(p => p.unread > 0 || p.need > 0), need = others.some(p => p.need > 0);
  for (const n of names) { n.classList.toggle("pdot", more); n.classList.toggle("p-need", need); }
  const label = `컴퓨터 바꾸기, 지금은 ${relayOn() ? targetName(target) : me.name}${more ? ", 다른 컴퓨터에 새 알림" : ""}`;
  brand.setAttribute("aria-label", label); brand.setAttribute("aria-haspopup", "dialog");
  brand.title = `컴퓨터 바꾸기 (${prKeyHint}, 다음 컴퓨터로)`;
  title.tabIndex = 0; title.setAttribute("aria-haspopup", "dialog");
  if (PR.node) prSheet();
}

// The same screen on the other computer where it makes sense: the page (home, sessions, settings...) but not a conversation, whose name exists only here.
function prUrl(p, extra = "") {
  const v = parseHash().view;
  return `${p.url}/${extra}${v && v !== "chat" && views.includes(v) ? `#${v}` : ""}`;
}
// The installed app (iPhone / Android home-screen app) cannot leave its own address: the phone opens any other origin in a browser view
// with its own bar, outside the app, and the layout breaks. So there the other computer opens inside this app, in a full-screen frame
// (same tailnet login, no cookies involved); the back gesture or picking this computer again closes it. A browser tab keeps going to
// the other address as before (its own tab, login and push).
const PR_EMBED = () => typeof isStandalone === "function" && isStandalone() && window.top === window.self;
const prEmbedded = window.top !== window.self;
const PRF = { node: null, ov: null };
function prGo(href, replace = false) {
  if (!PR_EMBED()) { if (replace) location.replace(href); else location.href = href; return; }
  if (!PRF.node) {
    PRF.node = el("div", { class: "pr-frame" }, el("iframe", { title: "다른 컴퓨터", allow: "clipboard-write; fullscreen" }));
    document.body.append(PRF.node);
    PRF.ov = ovOpen(() => prFrameClose(false));
  }
  PRF.node.firstElementChild.src = href;
}
function prFrameClose(viaHistory = true) {
  if (!PRF.node) return;
  PRF.node.remove(); PRF.node = null;
  if (viaHistory && PRF.ov) ovDone(PRF.ov);
  PRF.ov = null;
  prLoad();
}
// From the computer opened in the frame: its own switcher asks this app to change the frame or close it. Only computers in this
// gateway's own list are followed (never a free URL).
window.addEventListener("message", ev => {
  const d = ev.data || {};
  if (!PRF.node || d.dotz !== "peer-pick" || typeof d.url !== "string") return;
  if (!PR.list.some(p => p.url === ev.origin)) return;
  const p = PR.list.find(x => x.url === d.url);
  if (!p) return;
  if (p.self) prFrameClose(); else prGo(prUrl(p, `?did=${enc(DEVICE_ID)}`));
});

function prPick(p, o = {}) {
  // a computer reached only through a messenger has no gateway of its own: this app's chat view stays and talks to it (42-relay-chat.js)
  if (isRelayRow(p)) { prClose(false); relayEnter(p); return; }
  // inside another computer's app frame: the app around it does the switch (back to itself, or to a third computer)
  if (prEmbedded && !p.self && !p.public) { prClose(false); window.parent.postMessage({ dotz: "peer-pick", url: p.url }, "*"); return; }
  if (p.self) { prClose(); if (isRelayT(target)) relayLeave(); return; }
  // the online flags come from this computer's gateway: while it is unreachable they are stale, so the switch is tried anyway
  if (!p.online && !selfDown) { toast(`${p.name}에 연결할 수 없어요`, true); return; }
  if (!o.quiet) toast(`${p.name}(으)로 넘어가요`);
  prClose(false);
  // a public address is the real web app there (its own login, no device id to hand over): the installed app opens it in the browser, never in the frame
  if (p.public) { const href = prUrl(p); if (PR_EMBED() || prEmbedded) window.open(href, "_blank", "noopener"); else prGo(href); return; }
  prGo(prUrl(p, `?did=${enc(DEVICE_ID)}${o.auto ? "&auto=1" : ""}`));   // the device id goes along: the push subscriptions on both computers become one device
}

// 지우기: an offline computer that paired with this one can be forgotten (DELETE /api/peers); an online, relay or public row never gets the button.
function prForgetBtn(p, off) {
  if (!off || p.via || p.public) return null;
  return el("button", { type: "button", class: "btn tonal inrow pr-forget", text: "제거", "aria-label": `내 컴퓨터에서 ${p.name} 제거`, onclick: async () => {
    if (!await ask(`내 컴퓨터에서 ${p.name} 제거`, "내 컴퓨터 목록에서만 제거해요. 그 컴퓨터는 그대로이고, 다시 켜면 목록에 돌아와요.", "제거", true)) return;
    try { await api(`/api/peers?url=${enc(p.url)}`, "DELETE"); toast(`${p.name}을(를) 제거했어요`); } catch (e) { toast(`${p.name}을(를) 제거하지 못했어요`, true); }
    prLoad();
  } });
}

function prSheet() {
  const rows = PR.list.map(p => {
    // while this computer's gateway is unreachable the other rows' flags are stale: "확인 못 함", still selectable (prPick tries anyway)
    const here = relayOn() ? isRelayRow(p) && target === relayTargetOf(p) : p.self;
    const off = !p.self && !p.online && !selfDown, alert = !p.self && (p.unread > 0 || p.need > 0);
    const st = p.self ? (selfDown ? "연결 안 됨" : "") : selfDown ? "확인 못 함" : p.online ? "연결됨" : "연결 안 됨";
    // the prototype's switcher row: a status dot, the name over one quiet line, and at the right the check (this one) or the count of what waits there
    // a computer that cannot be reached says so at the right as a dot and one word (row anatomy: the status is last), not as the quiet line
    const bad = !alert && !isRelayRow(p) && (st === "연결 안 됨" || st === "확인 못 함");
    const sub = p.self ? (bad ? "이 컴퓨터" : st || "이 컴퓨터") : isRelayRow(p) ? [p.note, p.online ? "" : st].filter(Boolean).join(" · ") : alert ? prText(p) : bad ? "" : st;
    const row = el("button", { type: "button", class: `pr-row${here ? " on" : ""}${off ? " off" : ""}`, "aria-current": here ? "true" : null, "aria-disabled": off ? "true" : null,
      "aria-label": [p.name, here ? "지금 보고 있어요" : "", st, alert ? prText(p) : ""].filter(Boolean).join(", "), onclick: () => prPick(p) },
      el("span", { class: `dot${(p.self ? !selfDown : p.online && !selfDown) ? " ok" : ""}` }),
      el("span", { class: "pr-tx" }, el("span", { class: "pr-t", text: p.name }), sub ? el("span", { class: "pr-sub", text: sub }) : null),
      bad ? el("span", { class: "tag off", text: st }) : alert ? el("span", { class: `pr-n${p.need > 0 ? " need" : ""}`, text: String((p.need || 0) + (p.unread || 0)) }) : here ? icon("check", "pr-ck") : null);
    const screen = dskRowBtn(p) || prForgetBtn(p, off);
    return screen ? el("div", { class: "pr-line" }, row, screen) : row;
  });
  const manage = el("button", { type: "button", class: "pr-row pr-manage", onclick: () => { prClose(false); go("settings"); } }, icon("settings"), el("span", { class: "pr-t", text: "컴퓨터 관리" }));
  clear(PR.node.firstElementChild).append(el("div", { class: "pr-hd", id: "pr-t", text: "내 컴퓨터" }), el("div", { class: "pr-list" }, rows, manage));
}

function prKey(ev) {
  if (!PR.node) return;
  if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); prClose(); return; }
  if (ev.key !== "Tab") return;
  const f = [...PR.node.querySelectorAll("button:not([disabled])")];
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1], at = document.activeElement;
  if (!PR.node.contains(at)) { ev.preventDefault(); first.focus(); }
  else if (ev.shiftKey && at === first) { ev.preventDefault(); last.focus(); }
  else if (!ev.shiftKey && at === last) { ev.preventDefault(); first.focus(); }
}

function prOpen() {
  if (PR.node) return;
  PR.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  PR.node = el("div", { class: "ds-bd", onpointerdown: ev => { if (ev.target === PR.node) prClose(); } }, el("div", { class: "ds-sheet pr-sheet", role: "dialog", "aria-modal": "true", "aria-labelledby": "pr-t" }));
  document.body.append(PR.node);
  // On the phone the tab bar stays free below the sheet, so tapping 홈 again (homeTabTap) can close it, as the 채팅 tab does with its list.
  const nr = $("#nav").getBoundingClientRect();
  if (nr.top > innerHeight / 2 && nr.height < innerHeight / 4) PR.node.style.bottom = `${Math.max(0, innerHeight - nr.top)}px`;
  // With the sidebar's brand row on screen the switcher opens under it as a popover (no scrim), as the prototype draws it; the phone keeps its bottom sheet.
  const brand = $("#brand");
  if (brand.offsetParent) {
    const r = brand.getBoundingClientRect(), sh = PR.node.firstElementChild;
    PR.node.classList.add("anch"); sh.style.left = `${Math.max(12, Math.round(r.left - 8))}px`; sh.style.top = `${Math.round(r.bottom + 6)}px`;
  }
  PR.ov = ovOpen(() => prClose(false));
  document.addEventListener("keydown", prKey, true);
  prSheet();
  // the sidebar popover fades in 8px under its row (150ms); the phone sheet and the centered dialog use the sheet motion
  if (PR.node.classList.contains("anch")) motionIn(PR.node.firstElementChild, "top", M_MS.fast); else motionSheet(PR.node.firstElementChild, PR.node);
  const cur = PR.node.querySelector(".pr-row.on") || PR.node.querySelector(".pr-row");
  if (cur) cur.focus({ preventScroll: true });
  prLoad();
}

function prClose(restore = true) {
  if (!PR.node) return;
  const gone = PR.node; PR.node = null;
  gone.style.pointerEvents = "none"; motionSheetOut(gone).then(() => gone.remove());
  ovDone(PR.ov); PR.ov = null;
  document.removeEventListener("keydown", prKey, true);
  if (restore && PR.opener && PR.opener.isConnected) PR.opener.focus({ preventScroll: true });
  PR.opener = null;
}

// This computer's own name (settings -> 이 컴퓨터 이름): GET/PUT /api/machine -> {name, custom, default}; empty = the hostname-derived default.
// The other computers read it from this gateway's public /api/peer-info, so a rename shows up on their switcher within a minute.
const MN = { info: null };
async function mnLoad() {
  try { MN.info = await api("/api/machine"); } catch { return; }
  if (current === "settings") renderSettings();
}
function mnDialog() {
  const i = MN.info;
  const inp = el("input", { class: "fi", type: "text", value: i.custom || "", maxlength: "24", autocomplete: "off", placeholder: i.default, "aria-label": "컴퓨터 이름" });
  const save = (v, msg) => (btn, close) => busy(btn, async () => { MN.info = await api("/api/machine", "PUT", { name: v }); close(); toast(msg); prLoad(); renderSettings(); });
  const d = dialog({ title: "이 컴퓨터 이름", mid: true, body: el("div", { class: "col" }, inp), actions: [
    i.custom ? { label: "기본 이름으로", kind: "text", onclick: (c, b) => save("", "기본 이름으로 돌렸어요")(b, c) } : null,
    { label: "저장", kind: "pri", onclick: (c, b) => save(inp.value.trim(), "이름을 저장했어요")(b, c) }].filter(Boolean) });
  inp.addEventListener("keydown", ev => { if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); d.node.querySelector(".dact .btn:last-child").click(); } });
  inp.focus();
}
const mnRow = () => MN.info && el("button", { class: "li tap", type: "button", onclick: mnDialog },
  el("span", { class: "lead" }, icon("term")),
  el("span", { class: "tx" }, el("div", { class: "hd", text: "이 컴퓨터 이름" }), MN.info.name ? el("div", { class: "sup", text: MN.info.name }) : null),
  el("span", { class: "li-end" }, icon("chev", "chev")));
mnLoad();

$("#brand").append(el("span", { class: "brand-c", id: "brand-c", hidden: true }, icon("drop")));
$("#brand").onclick = () => (prTrig() ? prOpen() : (H.tab = true, go("home")));
// The phone's page title, on a page without a back arrow (there the title names the conversation or sub-page and the arrow leads back).
const prTitleTap = () => { if (prTrig() && !$("#appbar").classList.contains("back")) prOpen(); };
$("#title").addEventListener("click", prTitleTap);
$("#title").addEventListener("keydown", ev => { if ((ev.key === "Enter" || ev.key === " ") && !ev.isComposing) { ev.preventDefault(); prTitleTap(); } });
// ⌘` (Ctrl+` elsewhere) goes straight to the next computer in the sheet's order, wrapping round, skipping ones that are offline, with no sheet;
// with Shift it goes the other way. macOS keeps ⌘` for cycling an app's windows, so Ctrl+` also works on a Mac.
const prKeyHint = isMac ? "⌘` · Ctrl+`" : "Ctrl+`";
function prNext(step = 1) {
  const l = prOrder(PR.list), n = l.length, at = l.findIndex(p => p.self);
  if (n < 2 || at < 0) return false;
  const next = Array.from({ length: n - 1 }, (_, i) => l[(((at + step * (1 + i)) % n) + n) % n]).find(p => p.online || selfDown);
  if (next) prPick(next); else toast("다른 컴퓨터에 연결할 수 없어요", true);
  return true;
}
document.addEventListener("keydown", ev => {
  if (ev.isComposing || ev.altKey || !(ev.ctrlKey || (isMac && ev.metaKey)) || (ev.code !== "Backquote" && ev.key !== "`" && ev.key !== "~")) return;
  if (document.querySelector("dialog[open]:not([data-leaving])")) return;
  if (prNext(ev.shiftKey ? -1 : 1)) ev.preventDefault();
});
// Tapping 홈 again while on 홈 opens the computer sheet (like the 채팅 tab's re-tap, 04-state.js chatTabTap) and the next tap closes it; with one gateway the tab behaves as before.
const homeTabTap = () => { if (PR.node) prClose(); else if (current === "home" && PR.list.length >= 2) prOpen(); else { H.tab = true; go("home"); } };
if (PR.list.length) prPaint();
prLoad();
setInterval(() => { if (!document.hidden) prLoad(); }, 60_000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) prLoad(); });
