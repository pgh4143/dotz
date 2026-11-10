/* ---------- state ---------- */
let S = null;          // /api/state (no events)
let M = null;          // /api/models
let P = null;          // /api/providers
// The assistant's own name (config identity.name): the page arrives with it in its title (hub/webapp.ts indexPage), /api/state keeps it current.
let botName = document.title || "비서";
// The name with 이/가 by its last syllable (땃쥐가, 단비가 / 하늘이), for a sentence the name starts.
const iGa = s => { const c = String(s).slice(-1).charCodeAt(0) - 0xac00; return `${s}${c >= 0 && c <= 11171 && c % 28 ? "이" : "가"}`; };
let current = "home", prevView = null;
// Narrow screens: 채팅 shows the chat list (31-conversations.js) until a row is opened; from 1100px the list always sits beside the conversation.
let chatList = false;
const narrowChat = () => matchMedia("(max-width: 1099px)").matches;
// From 1100px 프로젝트 shows the project list beside the open project, as 채팅 does with its list; ppCur is the open project's key.
const ppWide = () => !narrowChat();
let ppCur = "";
const convListing = () => current === "chat" && chatList && narrowChat();
// A conversation opened from 모니터링 (a mail, a monitor's project chat) is drawn by the chat view but belongs to the 모니터링 tab: its tab stays lit,
// its list is 모니터링's list and its address is #monitoring/c:<target> (go() in 05-command-palette.js sets it; 30-monitoring.js monOwned).
let monCtx = "";
// 채팅 is one tab: its 대화 | 터미널 toggle picks the "chat" or "activity" view, and the tab reopens the last one used.
const NAV = [["home", "홈"], ["chat", "채팅"], ["projects", "프로젝트"], ["monitoring", "모니터링"], ["apps", "앱"], ["settings", "설정"]];
// 앱 (user apps, 30-apps.js): the tab is hidden until user apps ship (owner 2026-10-27; the code stays); every way into it (shortcut, palette,
// address) goes home instead. true shows the tab and opens it (the 앱 tests switch it on).
let APPS_ON = false;
const navOff = id => id === "apps" && !APPS_ON;
const CHAT_MODE_KEY = "dotz-chat-mode";
// 로그 보기 (the "activity" view): kept in the code, off in the app. false hides the 대화/로그 toggle and sends every way into the log view
// (an old #activity address, a saved choice, a subagent row) to 대화 instead; true brings the toggle back.
const LOG_VIEW = false;
const navView = v => v === "activity" ? "chat" : v === "project" ? "projects" : v === "cardform" ? "home" : v;
// 대화 or 로그 for a target: the main chat and projects share one global choice; a session (lane:<name>) remembers its own and starts in 대화.
const viewFor = t => { if (!LOG_VIEW || t === "alert" || t === "worklog") return "chat"; try { return localStorage.getItem(t && t.startsWith("lane:") ? `dotz-lane-view:${t}` : CHAT_MODE_KEY) === "activity" ? "activity" : "chat"; } catch { return "chat"; } };
const lastChatView = () => viewFor(target);
const SUB = new Set(["models", "accounts", "usage", "context", "harness", "discord", "jandi", "slack", "telegram", "messengers", "devices", "webaccess"]);
const views = ["home", "chat", "activity", "harness", "settings", "models", "accounts", "usage", "context", "discord", "jandi", "slack", "telegram", "messengers", "devices", "webaccess", "project", "projects", "monitoring", "apps", "notices", "cardform"];
const titles = { home: "홈", chat: "채팅", activity: "채팅", harness: "구성", settings: "설정", models: "모델", accounts: "계정", usage: "사용량", context: "컨텍스트", discord: "Discord", jandi: "JANDI", slack: "Slack", telegram: "Telegram", messengers: "메신저", devices: "연결된 기기", webaccess: "웹 접속", project: "프로젝트", projects: "프로젝트", monitoring: "모니터링", apps: "앱", notices: "알림", cardform: "카드 추가" };
// 카드 추가·수정 (web/custom.js cardForm) has its section made here: go() needs one for every view, and the demo's own index.html has no custom layer.
$("#views").append(el("section", { class: "view cu-page", id: "v-cardform", hidden: true }));
// 알림 화면 (31-notices-screen.js): f filter, lim rows drawn per group, open unfolded repeats, keep/scroll = come back from a row to the same place,
// arm = the next go() was started by a row (ret: the way back is this screen), pass = ntGo lets the next go() open the alert record conversation, back = where ← goes when it was opened fresh.
const NSC = { f: "all", lim: { news: 50, past: 50 }, open: new Set(), seen: new Set(), busy: new Set(), keep: false, scroll: 0, arm: 0, pass: 0, ret: false, sig: "", raf: 0 };
// The gateway's one live-lane rule (lanes.ts laneLive: not exited, process up, not a temp test project) drives every list.
const laneAlive = l => !!l && (l.live ?? l.status !== "exited");
const endedLanes = () => ((S && S.lanes) || []).filter(l => !laneAlive(l)).sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")));
// Ended lanes fold into one "종료된 레인 n" row; opening one shows its history (and resume). Each row has a delete button,
// and 선택 turns the rows into checkboxes for deleting several at once. Delete moves the lane into the gateway's trash
// (lanetrash.ts, kept 7 days); the toast's 되돌리기 restores it.
let endedOpen = false, endedSel = null;
const UNDO_MS = 8000;
function refreshEnded() {
  document.querySelectorAll("details.ended").forEach(d => d.replaceWith(endedGroup() || ""));
}
// An ended session keeps 답변 필요 while a question waits there; its unread count is always 0 (hub/conversations.ts unreadOf), so it shows no dot.
const endedMark = l => { const t = `lane:${l.name}`; return { unread: ts(t).unread | 0, need: convNeeds(t) }; };
function endedGroup() {
  const list = endedLanes();
  const marks = new Map(list.map(l => [l.name, endedMark(l)]));
  const nUnread = list.filter(l => marks.get(l.name).unread > 0).length, nNeed = list.filter(l => marks.get(l.name).need).length;
  if (endedSel) for (const n of endedSel) if (!list.some(l => l.name === n)) endedSel.delete(n);
  if (!list.length) { endedSel = null; return null; }
  const sel = endedSel;
  const stop = fn => ev => { ev.preventDefault(); ev.stopPropagation(); fn(ev); };
  const tools = sel
    ? el("span", { class: "etools" },
        el("button", { type: "button", class: "btn text", onclick: stop(() => { endedSel = null; refreshEnded(); }) }, "취소"),
        el("button", { type: "button", class: "btn danger fill", disabled: !sel.size, onclick: stop(() => deleteEnded([...sel])) }, `삭제 ${sel.size}개`))
    : el("span", { class: "etools" }, el("button", { type: "button", class: "btn text", onclick: stop(() => { endedSel = new Set(); endedOpen = true; refreshEnded(); }) }, "선택"));
  const all = sel && el("label", { class: "er ck-all" },
    el("input", { type: "checkbox", class: "ck", checked: sel.size === list.length, onchange: ev => { endedSel = new Set(ev.currentTarget.checked ? list.map(l => l.name) : []); refreshEnded(); } }),
    el("span", { text: "전체 선택" }), el("span", { class: "sup", text: `${sel.size}/${list.length}` }));
  const row = l => sel
    ? el("label", { class: "er" },
        el("input", { type: "checkbox", class: "ck", checked: sel.has(l.name), onchange: ev => { if (ev.currentTarget.checked) sel.add(l.name); else sel.delete(l.name); refreshEnded(); } }),
        el("span", { class: "en", text: l.name }), el("span", { class: "sup", text: l.startedAt ? kstDay(l.startedAt) : "" }))
    : el("div", { class: "erow" },
        el("button", { class: "er", type: "button", onclick: () => openTarget(`lane:${l.name}`, lastChatView()) },
          el("span", { class: "dot" }), el("span", { class: "en", text: l.title || l.name }), el("span", { class: "sup", text: [laneProject(l), l.startedAt ? kstDay(l.startedAt) : ""].filter(Boolean).join(" · ") }),
          marks.get(l.name).need ? el("span", { class: "tag warn", text: "답변 필요" }) : null,
          marks.get(l.name).unread ? el("span", { class: "nb", "aria-label": `읽지 않은 메시지 ${marks.get(l.name).unread}개`, text: marks.get(l.name).unread > 99 ? "99+" : String(marks.get(l.name).unread) }) : null),
        el("button", { class: "ib edel", type: "button", "aria-label": `${l.name} 삭제`, title: "삭제", onclick: () => deleteEnded([l.name]) }, icon("trash")));
  const d = el("details", { class: `ended${sel ? " selecting" : ""}` }, el("summary", {}, icon("chev"), el("span", { class: "elabel", text: `끝난 세션 ${list.length}` }),
    nNeed || nUnread ? el("span", { class: "ecounts" }, nNeed ? el("span", { class: "ecount need", "data-k": "need", text: `답변 필요 ${nNeed}` }) : null,
      nUnread ? el("span", { class: "ecount", "data-k": "unread", text: `안 읽음 ${nUnread}` }) : null) : null, tools),
    ...(all ? [all] : []), ...list.map(row));
  d.open = endedOpen;
  d.addEventListener("toggle", () => { endedOpen = d.open; if (!d.open && endedSel) { endedSel = null; refreshEnded(); } });
  return d;
}
async function deleteEnded(names) {
  if (!names.length) return;
  const one = names.length === 1;
  const sure = await new Promise(res => {
    let v = false;
    dialog({ confirm: true, title: one ? `${names[0]} 삭제` : `세션 ${names.length}개 삭제`, onclose: () => res(v),
      body: el("div", { class: "dl-body" }, el("p", { text: "휴지통으로 옮겨요. 7일 안에는 되돌릴 수 있어요." }),
        el("ul", { class: "dl-list" }, ...names.map(n => el("li", { text: n })))),
      actions: [{ label: "취소", onclick: c => c() }, { label: one ? "삭제" : `${names.length}개 삭제`, kind: "danger fill", onclick: c => { v = true; c(); } }] });
  });
  if (!sure) return;
  try {
    // 409 = nothing could be deleted; its body carries the same per-lane results, shown as the calm note below.
    const r = await api("/api/lanes/delete", "POST", { names }).catch(e => { if (e.data && e.data.results) return e.data; throw e; });
    const ok = r.results.filter(x => x.ok), bad = r.results.filter(x => !x.ok);
    endedSel = null;
    if (S && S.lanes) S.lanes = S.lanes.filter(l => !ok.some(x => x.name === l.name));
    refreshEnded();
    refreshState();
    if (ok.length) toast(`${ok.length === 1 ? ok[0].name : `${ok.length}개`} 삭제했어요`, false, { label: "되돌리기", onclick: () => restoreEnded(ok.map(x => x.id)) }, UNDO_MS);
    if (bad.length) keptLanes(bad);
  } catch (e) { toast(e.message, true); }
}
// Lanes the gateway refused to delete: a calm note with the reason in plain words, not an error (lanetrash.ts reasons).
const keptWhy = err => /uncommitted/i.test(err) ? "아직 커밋하지 않은 변경이 있어요. 커밋하거나 정리하면 지울 수 있어요."
  : /live|running|working|busy|실행 중|작업 중/i.test(err) ? "아직 실행 중이에요. 멈춘 뒤에 지울 수 있어요."
  : "작업 폴더를 정리하지 못했어요. 잠시 뒤에 다시 해 보세요.";
function keptLanes(bad) {
  dialog({ title: bad.length === 1 ? `${bad[0].name} 세션은 그대로 뒀어요` : `세션 ${bad.length}개는 그대로 뒀어요`,
    body: el("div", { class: "dl-body" }, el("p", { text: "아무것도 지우지 않고 그대로 뒀어요." }),
      el("ul", { class: "dl-list" }, ...bad.map(x => el("li", { text: `${x.name} · ${keptWhy(String(x.error || ""))}` })))),
    actions: [{ label: "확인", kind: "fill", onclick: c => c() }] });
}
async function restoreEnded(ids) {
  try {
    const r = await api("/api/lanes/restore", "POST", { ids }).catch(e => { if (e.data && e.data.results) return e.data; throw e; });
    const bad = r.results.filter(x => !x.ok);
    toast(bad.length ? `${bad.length}개는 되돌리지 못했어요. 휴지통에 그대로 있어요` : "되돌렸어요", bad.length > 0);
    refreshState();
  } catch (e) { toast(e.message, true); }
}
// An exited or stopped lane is a normal end, so it gets the neutral dot; red is kept for real failures.
const statusTone = s => ({ working: "pri", starting: "pri", idle: "", "rate-limited": "warn" })[s] || (/dead|error|fail/.test(s || "") ? "err" : "");
const statusKo = s => ({ working: "작업 중", idle: "대기", starting: "시작 중", stopped: "멈춤", "rate-limited": "한도 걸림", exited: "종료됨" })[s] || s || "알 수 없음";
const providerName = id => { const p = ((P && P.providers) || []).find(x => x.id === id); return (p && p.name) || id; };
// Thinking levels said in Korean (the stored value stays the API id); every level has its own word (xhigh and max used to both say 최고).
const THINK_KO = { off: "끔", minimal: "최소", low: "낮음", medium: "보통", high: "높음", xhigh: "매우 높음", max: "최고", auto: "자동" };
const thinkKo = v => THINK_KO[String(v || "").toLowerCase()] || String(v || "");
// The levels one model accepts, from the hub's model list (`omp models --json` per-model `thinking`); a model the runtime did not describe
// gets the runtime's whole set. off is dotz's own switch, and a level already saved stays visible until the owner picks another.
const modelThinkLevels = sel => {
  const a = [...((M && M.available) || []), ...((M && M.pickable) || [])].find(x => x.selector === sel);
  return a && Array.isArray(a.thinking) ? a.thinking : ((M && M.thinking_levels) || []);
};
const effortLevels = (sel, cur) => [...new Set([...(modelThinkLevels(sel).includes("off") ? [] : ["off"]), ...modelThinkLevels(sel), ...(cur ? [cur] : [])])];
const effortItems = (sel, cur) => effortLevels(sel, cur).map(v => ({ value: v, label: thinkKo(v) }));
const modelName = sel => { if (!sel) return "–"; const a = ((M && M.pickable) || []).find(x => x.selector === sel) || ((M && M.available) || []).find(x => x.selector === sel); return a ? a.name || sel : modelShort(sel); };

/* ---------- chrome: nav, theme, back ---------- */
// Narrow screens: tapping 채팅 again while a conversation is open opens the chat list (rows: 대화, 알림, 작업내역, 진행 중인 세션, 프로젝트); tapping it once more closes the list
// and returns to that conversation where it was scrolled (the list sits below it in the history stack, so the conversation is pushed back like a pick); the first tap from elsewhere returns to the last conversation.
let chatListSnap = null;
// The place is kept as the first message in view and its distance from the top: the conversation is drawn again on return and its height
// still settles for a moment after, so a plain scrollTop lands elsewhere (live hub 2026-10-21: 571px off). The pin (31-conversations.js) holds that message there.
function chatAnchor() {
  const top = timeline.getBoundingClientRect().top;
  for (const m of tl.querySelectorAll("[data-ts]")) { const r = m.getBoundingClientRect(); if (r.bottom > top + 1) return { ts: m.dataset.ts, off: r.top - top }; }
  return null;
}
function openChatList() { chatListSnap = current === "chat" ? { key: target, top: timeline.scrollTop, stick: chatStick, at: chatAnchor() } : null; go("chat", "list"); }
function closeChatList() {
  const snap = chatListSnap; chatListSnap = null;
  go(lastChatView());
  if (snap && snap.key === target && current === "chat" && !snap.stick) {
    chatUnpin();
    if (snap.at) { CV.pinTs = snap.at.ts; CV.pinOff = snap.at.off; chatPin("at"); }
    else timeline.scrollTop = snap.top;
    chatStick = timeline.scrollTop + timeline.clientHeight >= timeline.scrollHeight - 40; $("#chat-jump").hidden = chatStick;
  }
}
// Setting (settings screen): what the 대화 tab opens when coming back from another tab - "last" (default) the conversation that was open, "main" the main chat.
const CHAT_TAB_KEY = "dotz-chat-tab";
const chatTabMode = () => { try { return localStorage.getItem(CHAT_TAB_KEY) === "main" ? "main" : "last"; } catch { return "last"; } };
const chatTabModeSet = v => { try { localStorage.setItem(CHAT_TAB_KEY, v); } catch {} };
// A relayed computer (42-relay-chat.js) has one conversation and none of this computer's: while it is picked, 채팅 stays on it (no switch to the main chat, no phone list of this computer's chats).
const chatTabEnter = () => { if ((chatTabMode() === "main" && !isRelayT(target)) || monOwned(target)) setTarget(MAIN); go(lastChatView()); };
const chatTabTap = () => (monCtx ? chatTabEnter() : convListing() ? closeChatList() : narrowChat() && !isRelayT(target) && (current === "chat" || current === "activity") ? openChatList() : current === "chat" || current === "activity" ? go(lastChatView()) : chatTabEnter());
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
// ⌘/Ctrl+1..6 open the shown tabs in NAV order (a hidden tab has no number); the browser may keep ⌘1..9 for its own tabs in a normal tab (it reaches the page in an installed app window).
const navTabs = () => NAV.filter(n => !navOff(n[0]));
const navKeyHint = id => { const i = navTabs().findIndex(n => n[0] === id); return i < 0 ? "" : isMac ? `⌘${i + 1}` : `Ctrl+${i + 1}`; };
function navShortcut(id) {
  if (navOff(id)) return;
  if (id !== "home" && PR.node) prClose(false);
  if (id === "chat") !monCtx && (current === "chat" || current === "activity") ? go(lastChatView()) : chatTabEnter();
  else go(id);
}
// The wide sidebar folds to an icon rail (22-shell.css :root.side-min); the saved choice is applied before first paint in index.html.
const SIDE_KEY = "dotz-side", SIDE_KEYS = isMac ? "⌘\\" : "Ctrl+\\";
function sideSync() {
  const min = document.documentElement.classList.contains("side-min"), b = $("#side-tog"), word = min ? "사이드바 펼치기" : "사이드바 접기";
  b.setAttribute("aria-label", word); b.setAttribute("aria-expanded", String(!min)); b.title = `${word} (${SIDE_KEYS})`;
}
function sideToggle() {
  const min = document.documentElement.classList.toggle("side-min");
  try { if (min) localStorage.setItem(SIDE_KEY, "min"); else localStorage.removeItem(SIDE_KEY); } catch { /* storage blocked: the choice lasts until reload */ }
  sideSync();
}
// The ⌘/Ctrl keys besides 1..6 and K (05-command-palette.js): one list drives the handler below and the keys the screen tour shows (42-intro.js).
const MOD_KEYS = [
  { code: "Slash", key: "/", label: "알림", run: () => { if (PR.node) prClose(false); $("#bell").click(); } },
  { code: "Period", key: ".", label: "메인 대화", run: () => { if (PR.node) prClose(false); openTarget("main", "chat"); } },
  { code: "Backslash", key: "\\", label: "사이드바 접기", wide: true, run: sideToggle },
];
const modKeyWide = k => !k.wide || matchMedia("(min-width: 1024px)").matches;
document.addEventListener("keydown", ev => {
  if (ev.isComposing || ev.altKey || ev.shiftKey || !(isMac ? ev.metaKey : ev.ctrlKey) || document.querySelector("dialog[open]:not([data-leaving])")) return;
  const mk = MOD_KEYS.find(k => ev.code === k.code || ev.key === k.key);
  if (mk) {
    if (modKeyWide(mk)) { ev.preventDefault(); mk.run(); }
    return;
  }
  const n = /^Digit([1-6])$/.exec(ev.code || "")?.[1] || (/^[1-6]$/.test(ev.key) ? ev.key : ""), tab = n && navTabs()[n - 1];
  if (!tab) return;
  ev.preventDefault();
  navShortcut(tab[0]);
});
// 모니터링's badge (#nav-mon) counts what waits there (09-needs-you.js paintMonAttn).
for (const [id, label] of navTabs()) $("#nav").append(el("button", { class: "ni", type: "button", "data-view": id, title: `${label} (${navKeyHint(id)})`, "aria-label": label, onclick: () => { if (id !== "home" && PR.node) prClose(false); id === "chat" ? chatTabTap() : id === "home" ? homeTabTap() : go(id); } }, icon(VIEW_ICON[id] || id), el("span", { class: "nl", text: label }), id === "chat" ? el("span", { class: "nb nnb", id: "nav-att", hidden: true }) : id === "monitoring" ? el("span", { class: "nb nnb att", id: "nav-mon", hidden: true }) : id === "settings" ? el("span", { class: "nb nub att", id: "nav-upd", hidden: true, text: "새 버전", title: "새 버전이 있어요" }) : null));
$("#side-tog").append(icon("side"));
$("#side-tog").onclick = sideToggle;
sideSync();
// Light<->dark switch (settings row and palette; the app bar has no theme button, so the system setting rules until one is picked).
const themeIs = () => dotzTheme.get();
const themeIc = () => themeIs() === "dark" ? "sun" : "moon";
const themeNext = () => themeIs() === "dark" ? "라이트" : "다크";
function toggleTheme() { dotzTheme.toggle(); if (current === "settings") renderSettings(); }
window.addEventListener("dotz-theme", () => { if (current === "settings") renderSettings(); });
$("#cmdk").append(icon("search"), el("span", { class: "tx", text: "명령" }), el("kbd", { text: isMac ? "⌘K" : "Ctrl K" }));
const setBrand = () => { $("#brand-name").textContent = relayBrand(); paintAttn(); };
$("#send-btn").append(icon("send"));
$("#back").append(icon("back"), el("span", { class: "bk-l", text: titles.monitoring }));
const backTarget = () => current === "cardform" ? "home" : NSC.ret && current !== "home" ? "notices" : current === "harness" ? "settings" : SUB.has(current) ? (prevView && !SUB.has(prevView) && prevView !== current ? prevView : ["discord", "jandi", "slack", "telegram"].includes(current) ? "messengers" : "settings") : current === "project" ? (ppWide() ? null : "projects") : monConv() || (monCtx && current === "chat") ? "monitoring" : null;
$("#back").onclick = () => (nscBack() || kkBack() || cmBack() || mxsBack() ? 0 : monCtx && current === "chat" ? go("monitoring", narrowChat() && !monChatIt() ? MON.sel : undefined) : convOnPhone() ? openChatList() : go(backTarget() || "home"));
