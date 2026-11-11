"use strict";
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// A .btn whose click handler returns a promise (it sends a request) is disabled until the answer comes, so a second press sends nothing.
function holdWhileSending(btn, fn) {
  return ev => {
    const r = fn.call(btn, ev);
    if (r && typeof r.then === "function" && !btn.disabled) {
      btn.disabled = true;
      const free = () => { btn.disabled = false; };
      r.then(free, e => { free(); throw e; });
    }
    return r;
  };
}
// DOM builder: strings become text nodes; safeHtml is used only with already-escaped markup.
function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "safeHtml") n.innerHTML = v;
    else if (k === "onclick" && tag === "button" && /(^| )btn( |$)/.test(props.class || "")) n.addEventListener("click", holdWhileSending(n, v));
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
const clear = n => { while (n.firstChild) n.removeChild(n.firstChild); return n; };
// A filter or tab row that scrolls sideways keeps its chosen item in view after it is drawn (a repaint starts the row at its left end).
// Only the row scrolls, never the page. Returns the row.
function segKeep(row) {
  requestAnimationFrame(() => {
    const on = row.isConnected && row.querySelector(".on"), box = on && on.parentElement;
    if (!box || box.scrollWidth <= box.clientWidth) return;
    const b = box.getBoundingClientRect(), r = on.getBoundingClientRect();
    if (r.left < b.left) box.scrollLeft += r.left - b.left; else if (r.right > b.right) box.scrollLeft += r.right - b.right;
  });
  return row;
}
// The text field the owner is typing in (on a phone its keyboard is up), or null.
function typingIn() {
  const a = document.activeElement;
  return a && (a.isContentEditable || a.matches("textarea, input:not([type=button], [type=checkbox], [type=radio], [type=range], [type=file], [type=submit], [type=reset], [type=color])")) ? a : null;
}
// A live repaint that rebuilds the field being typed in drops a phone's keyboard (the focused node leaves the page) and the refocus raises
// it again. So `box` takes `kids` unless it holds that field and the new paint keeps it (same kind of field, still editable); a paint that
// ends the field (sent, closed) goes through, and so does one whose `subject` (what the field belongs to, e.g. the card on screen) changed.
// A held box stays as it is and `again` repaints once the field is left, after the tap that left it, so that tap's click still lands on
// the button it pressed. Returns false when held.
const HELD = new WeakMap(), SUBJ = new WeakMap();
let ptrDown = false;
addEventListener("pointerdown", () => { ptrDown = true; }, true);
for (const t of ["pointerup", "pointercancel"]) addEventListener(t, () => { ptrDown = false; }, true);
function afterTap(fn) {
  if (!ptrDown) { setTimeout(fn); return; }
  const go = () => { removeEventListener("pointerup", go, true); removeEventListener("pointercancel", go, true); setTimeout(fn); };
  addEventListener("pointerup", go, true); addEventListener("pointercancel", go, true);
}
function paintKeep(box, kids, again, subject = "") {
  const a = typingIn(), same = f => f.tagName === a.tagName && f.className === a.className && f.dataset.k === a.dataset.k && !f.disabled && !f.readOnly;
  if (!a || !box.contains(a) || (SUBJ.get(box) || "") !== subject || !kids.some(k => k instanceof Element && (same(k) || [...k.getElementsByTagName(a.tagName)].some(same)))) { clear(box).append(...kids); SUBJ.set(box, subject); return true; }
  if (!HELD.has(a)) a.addEventListener("focusout", () => afterTap(() => { const h = HELD.get(a); HELD.delete(a); delete h.box.dataset.sig; h.again(); }), { once: true });
  HELD.set(a, { box, again });
  return false;
}
const enc = encodeURIComponent;
// The one right-hand slot of a settings row (.li > .li-end, docs/ui-spec.md 설정 행): a 행 안 button, a switch, a field or a value.
const liEnd = (...kids) => el("span", { class: "li-end" }, ...kids);
// A setting with exactly two values (docs/ui-spec.md 두 값 설정): one small pill showing the current value; a tap, Enter or Space moves to the
// other one. Unset shows `unset` and the first tap picks the first value. An on/off setting uses the switch (.hs-sw); three or more values a menu.
// aria-pressed is true on the second value, so the state reads like a switch; the label always names the value now in force.
function rowToggle({ label, opts, value, unset = "정하기", onPick }) {
  const i = opts.findIndex(([v]) => v === value), next = opts[i < 0 ? 0 : (i + 1) % opts.length];
  return el("button", { type: "button", class: `chip tgl${i < 0 ? " unset" : ""}`, "data-v": i < 0 ? "" : value, "aria-pressed": String(i === 1),
    "aria-label": `${label}: ${i < 0 ? unset : opts[i][1]} · 누르면 ${next[1]}`, text: i < 0 ? unset : opts[i][1], onclick: ev => onPick(next[0], ev.currentTarget) });
}

/* ---------- icons (24px stroke set) ---------- */
const ICONS = {
  home: "M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  chat: "M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-5.4A8 8 0 1 1 21 12z",
  projects: "M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  lanes: "M5 4h14a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM5 14h14a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0",
  list: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  settings: "M4 7h9M17 7h3M4 17h3M11 17h9M13 7a2 2 0 1 0 4 0a2 2 0 1 0-4 0M7 17a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
  back: "M15 5l-7 7 7 7",
  send: "M12 19V5M5 12l7-7 7 7",
  refresh: "M20 11a8 8 0 1 0-2.3 6.3M20 4v7h-7",
  check: "M5 12.5l4.5 4.5L19 7",
  drop: "M6 9l6 6 6-6",
  chev: "M9 6l6 6-6 6",
  grip: "M6 9.5h12M6 14.5h12",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3",
  add: "M12 5v14M5 12h14",
  sun: "M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
  usage: "M5 20v-9M12 20V4M19 20v-6",
  context: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6",
  model: "M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4",
  key: "M4.5 15a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M10.5 12.5L20 3M16 7l3 3M13.5 9.5l2 2",
  open: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  down: "M12 5v14M5 12l7 7 7-7",
  search: "M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14zM20 20l-4-4",
  discord: "M5 7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-3l-3 3v-3H8a3 3 0 0 1-3-3zM9.5 11h.01M14.5 11h.01",
  close: "M6 6l12 12M18 6L6 18",
  harness: "M4 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0M16 5a2 2 0 1 0 4 0a2 2 0 1 0-4 0M16 19a2 2 0 1 0 4 0a2 2 0 1 0-4 0M8 11l8-5M8 13l8 5",
  pencil: "M4 20h4L19.5 8.5a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4",
  clip: "M20 11.5l-8.6 8.6a5 5 0 0 1-7-7L13.3 4.7a3.4 3.4 0 0 1 4.8 4.8l-8.5 8.5a1.8 1.8 0 0 1-2.5-2.5l7.8-7.8",
  mail: "M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM3.5 7.5L12 13l8.5-5.5",
  image: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 16l-5-5-8 8",
  file: "M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  // three small rings: with the 1.75 stroke each dot is about 3.5 units wide, so the ⋯ reads at a glance (a bare h.01 dot was 1.75 wide and faint)
  more: "M4.15 12a0.85 0.85 0 1 0 1.7 0a0.85 0.85 0 1 0 -1.7 0M11.15 12a0.85 0.85 0 1 0 1.7 0a0.85 0.85 0 1 0 -1.7 0M18.15 12a0.85 0.85 0 1 0 1.7 0a0.85 0.85 0 1 0 -1.7 0",
  term: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM7 10l3 2-3 2M12 15h4",
  desktop: "M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8 20h8M12 16v4",
  spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18 16l.7 1.8L20.5 18.5l-1.8.7L18 21l-.7-1.8-1.8-.7 1.8-.7z",
  code: "M9 8l-4 4 4 4M15 8l4 4-4 4M13.5 6l-3 12",
  braces: "M9 4C7 4 6 5 6 7v3c0 1-1 2-2 2 1 0 2 1 2 2v3c0 2 1 3 3 3M15 4c2 0 3 1 3 3v3c0 1 1 2 2 2-1 0-2 1-2 2v3c0 2-1 3-3 3",
  apps: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  side: "M14 6.4 10.5 12l3.5 5.6",
  pick: "M6 3l13 8-5.6 1.6L10 19zM13 13l4 6",
};
const VIEW_ICON = { home: "home", chat: "chat", activity: "activity", projects: "projects", project: "projects", lanes: "lanes", monitoring: "activity", apps: "apps", notices: "bell", harness: "harness", settings: "settings", models: "model", accounts: "key", usage: "usage", context: "context", discord: "discord", jandi: "chat", slack: "chat", telegram: "chat", messengers: "chat", devices: "key", webaccess: "open" };
const icon = (n, cls = "") => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", `ic ${cls}`.trim()); s.setAttribute("aria-hidden", "true"); const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", ICONS[n]); s.append(p); return s; };

/* ---------- formatting ---------- */
const KST = { timeZone: "Asia/Seoul" };
const kstTime = ts => { const d = new Date(ts); return isNaN(d) ? "" : d.toLocaleTimeString("ko-KR", KST); };
const kstStamp = ts => { const d = new Date(ts); return isNaN(d) ? "" : d.toLocaleString("ko-KR", { ...KST, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }); };
// A time left, rounded down to its two largest units (6일 23시간 59분 reads 6일 23시간, never 7일): 6일 23시간, 3시간 12분, 12분.
function leftText(ms) {
  const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d ? `${d}일${h ? ` ${h}시간` : ""}` : h ? `${h}시간${mm ? ` ${mm}분` : ""}` : `${mm}분`;
}
// When a usage window or budget resets (epoch ms): the time left until then with the browser's local clock time
// ("3시간 38분 후 초기화 (오후 2시 18분)", the date first when it is not today), or that it is resetting now.
function rel(ms) {
  const now = Date.now(), d = ms - now;
  if (d <= 0) return "초기화 중";
  if (d < 60000) return "1분 안에 초기화";
  const at = new Date(ms), t = new Date(now), h = at.getHours(), m = at.getMinutes();
  const day = at.toDateString() === t.toDateString() ? "" : `${at.getMonth() + 1}월 ${at.getDate()}일 `;
  return `${leftText(d)} 후 초기화 (${day}${h < 12 ? "오전" : "오후"} ${h % 12 || 12}시${m ? ` ${m}분` : ""})`;
}
const oneLine = s => String(s).replace(/\s+/g, " ").trim().slice(0, 160);
// The one line a 생각 row shows: the model's thinking when it is Korean, else a Korean label (the raw English stays in the row's fold).
const thinkLine = (s, max = 80) => { const t = oneLine(s ?? ""); return /[가-힣]/.test(t) ? t.slice(0, max) : "생각을 정리하는 중"; };
const num = n => Number(n || 0).toLocaleString("ko-KR");
// JSON kept in localStorage, or `fallback` when the key is missing, unparsable or storage is blocked.
const lsJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; } };
