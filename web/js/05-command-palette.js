/* ---------- command palette: jump to a view or run a /command ---------- */
// A command's answer (the card /api/command returns) in the app's own components: a status line, the facts as list rows,
// a note, and buttons that run the next command in the palette. Never a text dump.
const PAL_TONE = { ok: "완료", busy: "진행 중", warn: "주의", err: "실패" };
const PAL_LINE = /^(\/\S+)\s{2,}(.+)$/;
function palFact(f) {
  const lines = String(f.value ?? "").split("\n").filter(l => l !== "");
  const multi = lines.length > 1;
  const val = el("div", { class: "pal-v" }, ...lines.map(l => { const m = PAL_LINE.exec(l); return m ? el("div", { class: "pal-vl" }, el("code", { text: m[1] }), el("span", { text: m[2] })) : el("div", { class: "pal-vl", text: l }); }));
  return el("div", { class: `li pal-f${multi ? " multi" : ""}` }, el("div", { class: "tx" }, el("div", { class: "hd", text: f.label }), multi ? val : null), multi ? null : val);
}
function palResult(c, run) {
  const tone = c.tone || "";
  const head = el("div", { class: "pal-rh" }, el("span", { class: `dot${tone ? ` ${tone === "busy" ? "pri" : tone}` : ""}` }), el("span", { class: "pal-rt", text: c.title }), PAL_TONE[tone] ? el("span", { class: `tag ${tone === "busy" ? "pri" : tone}`, text: PAL_TONE[tone] }) : null);
  const facts = c.facts || [], acts = c.actions || [];
  return el("div", { class: `pal-res${tone === "err" ? " err" : ""}`, role: "status" }, head,
    facts.length ? el("div", { class: "list pal-facts" }, ...facts.map(palFact)) : null,
    c.note ? el("div", { class: "cc-note", text: c.note }) : null,
    acts.length ? el("div", { class: "btns cc-act" }, ...acts.map(a => el("button", { type: "button", class: "btn tonal sm", title: a.send, text: a.label, onclick: () => run(a.send) }))) : null);
}
// Words a 도구 row is also found by: the names a screen used to have and the commands it replaced in this list.
const PAL_WORDS = { accounts: "공급자 provider 로그인", usage: "한도 quota" };
// A command row: one that cannot run without its first argument opens that argument's choices instead of failing.
const palCmd = x => ({ kind: "cmd", ic: "chev", label: x.c, desc: x.d, run: x.c, fill: !!(x.args && x.args[0] && !x.args[0].opt) });
function openPalette() {
  if (document.querySelector("dialog.pal")) return;
  closeMenu(false);
  const inp = el("input", { class: "pal-in", type: "text", placeholder: "도구 또는 명령", autocomplete: "off", autocapitalize: "off", spellcheck: "false", "aria-label": "명령" });
  const list = el("div", { class: "pal-list", role: "listbox" });
  const out = el("div", { class: "pal-out", hidden: true });
  const d = el("dialog", { class: "pal", "aria-label": "명령" }, el("div", { class: "pal-head" }, inp), list, out,
    el("div", { class: "pal-ft", "aria-hidden": "true" }, el("span", { text: "↑↓ 이동" }), el("span", { text: "↵ 열기" }), el("span", { text: "esc 닫기" })));
  let items = [], idx = 0;
  const mark = () => {
    [...list.querySelectorAll(".pal-i")].forEach((n, i) => { n.classList.toggle("on", i === idx); n.setAttribute("aria-selected", i === idx ? "true" : "false"); if (i === idx) n.scrollIntoView({ block: "nearest" }); });
  };
  const runCmd = async text => {
    // /terminal and /screen live in this page, not in the gateway: the same way the composer opens them.
    const sh = SH_CMD.exec(text);
    if (sh) { d.close(); openShell(sh[1] && sh[1].trim() ? { command: sh[1].trim() } : undefined); return; }
    if (SCR_CMD.test(text) && S && S.desk) { d.close(); openScreen(); return; }
    list.hidden = true; out.hidden = false;
    clear(out).append(el("div", { class: "pal-res", role: "status" }, el("div", { class: "pal-rh" }, el("span", { class: "dot pri" }), el("span", { class: "pal-rt", text: "실행 중" }))));
    try {
      const r = await api("/api/command", "POST", { text });
      clear(out).append(palResult(r.card || { title: firstLine(String(r.output ?? "")) || "완료", tone: "ok", facts: [], note: String(r.output ?? "").split("\n").slice(1).join("\n").trim() }, runCmd));
      if (/^\/(model|effort|compact|restart|resume|stop|abort)\b/i.test(text)) { refreshState(); loadModels(true); loadContext(true); }
    } catch (e) { clear(out).append(palResult(e.data && e.data.card ? e.data.card : { title: "실패", tone: "err", facts: [], note: e.message }, runCmd)); }
  };
  const exec = it => { if (it.kind === "nav") { d.close(); go(it.go); } else if (it.kind === "act") { d.close(); it.act(); } else if (it.fill) { inp.value = `${it.run} `; build(); inp.focus(); } else runCmd(it.run); };
  // The choices of the argument being typed, each a row with the whole command; /logout's come from the providers, which no screen may have asked for yet.
  const argRows = p => {
    const args = p.cmd.args || [], a = args[p.i], next = args[p.i + 1], q = p.q.toLowerCase();
    if (!a || a.free) return;
    if (a.opts === slProviders && !P) loadProviderData().then(() => { if (d.open) build(); }, () => {});
    const base = `${p.cmd.c} ${p.done.length ? `${p.done.join(" ")} ` : ""}`;
    for (const [val, lab] of a.opts()) if (!q || val.toLowerCase().includes(q) || (lab || "").toLowerCase().includes(q)) items.push({ kind: "cmd", ic: "chev", label: `${base}${val}`, desc: lab, run: `${base}${val}`, fill: !!(next && !next.opt) });
  };
  const build = () => {
    const raw = inp.value.trim(), v = raw.toLowerCase();
    items = [];
    let pick = 0;
    if (v.startsWith("/")) {
      const p = slParse(inp.value.trimStart()), args = p && p.stage === "arg" ? p.cmd.args || [] : [], spaced = /\s/.test(v);
      if (spaced || (args[0] && args[0].opt)) items.push({ kind: "cmd", ic: "send", label: raw, run: raw });
      // Choosing an argument can act at once (/restart, /stop), so a command that still needs one preselects nothing: one more Enter never runs the first choice.
      else if (args.length) pick = -1;
      if (args.length) argRows(p);
      else if (!spaced) for (const x of hintList) if (x.c.startsWith(v)) items.push(palCmd(x));
    } else {
      for (const x of hintList) if (!x.dup && (!v || x.c.includes(v))) items.push(palCmd(x));
      for (const id of views) if (id !== "activity" && id !== "project" && id !== "cardform" && !navOff(id) && (!v || titles[id].toLowerCase().includes(v) || id.includes(v) || (PAL_WORDS[id] || "").includes(v))) items.push({ kind: "nav", ic: VIEW_ICON[id], label: titles[id], desc: navKeyHint(id), go: id === "chat" ? lastChatView() : id });
      // Ended lanes stay folded: one row without a query, each lane once the query names it (or "종료").
      const ended = endedLanes();
      if (ended.length && !v) items.push({ kind: "act", ic: "lanes", label: `끝난 세션 ${ended.length}`, act: () => { endedOpen = true; go("chat", "list"); } });
      else for (const l of ended) if (v && (l.name.toLowerCase().includes(v) || "끝난 세션 종료된 세션".includes(v))) items.push({ kind: "act", ic: "lanes", label: `끝난 세션 · ${l.name}`, act: () => openTarget(`lane:${l.name}`, lastChatView()) });
      if (!v || "셸 터미널 명령줄 shell terminal".includes(v)) items.push({ kind: "act", ic: "shell", label: "터미널 열기", act: () => openShell() });
      if (S && S.desk && (!v || "화면 공유 원격 데스크톱 screen desktop remote".includes(v))) items.push({ kind: "act", ic: "desktop", label: "화면 공유 열기", act: () => openScreen() });
      if (!v || "화면 모드 전환 라이트 다크 theme dark light".includes(v)) items.push({ kind: "act", ic: themeIc(), label: `${themeNext()} 모드로 전환`, act: toggleTheme });
      items.push(...paneLayoutItems(v));
    }
    const rank = { nav: 0, act: 1, cmd: 2 };   // 도구 first, 명령 last; the arrow keys walk the list in this order
    items.sort((a, b) => rank[a.kind] - rank[b.kind]);
    idx = pick;
    clear(list);
    let last = "";
    items.forEach((it, i) => {
      const g = it.kind === "nav" ? "도구" : it.kind === "act" ? "화면" : "명령";
      if (g !== last) { list.append(el("div", { class: "ph", role: "presentation", text: g })); last = g; }
      list.append(el("button", { type: "button", role: "option", tabindex: "-1", class: `pal-i${it.kind === "cmd" ? " cmd" : ""}`, onmouseenter: () => { idx = i; mark(); }, onclick: () => exec(it) },
        icon(it.ic), el("span", { class: "nm", text: it.label }), it.desc ? el("span", { class: it.kind === "nav" ? "pd key" : "pd", text: it.desc }) : null));
    });
    if (!items.length) list.append(el("div", { class: "a-div", text: "결과가 없어요" }));
    mark();
  };
  inp.addEventListener("input", () => { out.hidden = true; list.hidden = false; build(); });
  inp.addEventListener("keydown", ev => {
    if (ev.isComposing || ev.keyCode === 229) return;
    if (ev.key === "ArrowDown") { ev.preventDefault(); if (items.length) { idx = (idx + 1) % items.length; mark(); } }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); if (items.length) { idx = (Math.max(idx, 0) - 1 + items.length) % items.length; mark(); } }
    else if (ev.key === "Tab") { const it = items[idx]; if (it && it.kind === "cmd") { ev.preventDefault(); inp.value = `${it.run} `; build(); } }
    else if (ev.key === "Enter") {
      ev.preventDefault();
      if (items[idx]) exec(items[idx]);
    }
  });
  d.addEventListener("click", ev => { if (ev.target === d) d.close(); });
  d.addEventListener("close", () => d.remove());
  document.body.append(d);
  d.showModal(); dialogHist(d);
  motionDialog(d, "pop");
  build();
  inp.focus();
}
$("#cmdk").onclick = openPalette;
document.addEventListener("keydown", ev => { if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && ev.key.toLowerCase() === "k") { ev.preventDefault(); openPalette(); } });


function parseHash(hash = location.hash) {
  const h = hash.slice(1), i = h.indexOf("/");
  let t = i < 0 ? "" : h.slice(i + 1);
  try { t = decodeURIComponent(t); } catch {}
  return { view: i < 0 ? h : h.slice(0, i), t };
}
// The 세션 tab is gone: an old #lanes address opens the chat (its list on a phone), where running sessions sit under 진행 중.
// #chat/alert is the 알림 screen now; only ntGo (a row's way to its source message) sets NSC.pass, which lets one go() open the record conversation.
const alertAddr = (name, tgt) => (name === "chat" || name === "activity") && tgt === "alert" && !(NSC.pass > Date.now());
const routeAlias = (name, tgt) => (alertAddr(name, tgt) ? ["notices", undefined] : name === "lanes" ? ["chat", "list"] : name === "providers" || name === "provider" ? ["accounts", tgt] : name === "settings" && tgt === "accounts" ? ["accounts", undefined] : [name, tgt]);
function go(name, tgt) {
  closeMenu(false);
  // A toast belongs to the screen it was raised on: moving on takes it down. One that offers 되돌리기 stays until its time is up, and so
  // does one raised together with the move ("프로젝트를 지웠어요" and then the list).
  document.querySelectorAll("body > .snack:not(.act)").forEach(n => { if (n !== toastNew) toastGone(n); });
  [name, tgt] = routeAlias(name, tgt);
  NSC.pass = 0;
  if (!PN.going) PN.app = false;   // 모니터링 is a pane's screen only while the pane machinery lends it (43-panes.js paneGoApp)
  const viaRow = NSC.arm > Date.now();
  NSC.arm = 0;
  if (name === "notices") NSC.ret = false;
  else { NSC.ret = viaRow; if (!viaRow) NSC.keep = false; }
  // A mail (or any "monitoring/c:<target>") opens inside 모니터링: the chat view is drawn, the tab, the list and the address stay 모니터링's.
  const inChat = name === "chat" || name === "activity";
  let mc = false;
  if (name === "monitoring" && tgt && tgt.startsWith("c:")) { if (validTarget(tgt.slice(2))) { name = "chat"; tgt = tgt.slice(2); mc = true; } else tgt = undefined; }
  else if (inChat && !paneKeeps(tgt && tgt !== "list" ? tgt : target) && (tgt ? tgt !== "list" && monOwned(tgt) : monOwned(target))) { name = "chat"; mc = true; }
  else if (inChat && !tgt && monCtx && target === monCtx && !paneKeeps(target)) mc = true;
  monCtx = mc ? tgt || target : "";
  if (mc) { const k = monItemOf(tgt || target); if (k) MON.sel = k; MON.list = false; }
  if (!views.includes(name) || navOff(name)) name = "home";
  if (name === "projects" && ppWide()) { H.auto = true; name = "project"; tgt = ppCur && (!PRJ || PRJ.projects.some(p => p.key === ppCur)) ? ppCur : prjFirst() || "builtin:custom"; if (!PRJ) prjLoad().then(() => { if (current === "project" && ppCur === "builtin:custom" && prjFirst()) { H.auto = true; go("project", prjFirst()); } }); }
  if (name === "project" && !tgt) name = "projects";
  if (name === "accounts") accFocus = tgt || "";
  if (name === "project") ppCur = tgt;
  if (name === "monitoring") monRoute(tgt);
  // "chat/list" is the phone's chat list; any other way into 채팅 opens a conversation.
  chatList = name === "chat" && tgt === "list" && narrowChat();
  if (name === "chat" && tgt === "list") tgt = undefined;
  if (tgt && name !== "project" && name !== "accounts" && name !== "cardform" && tgt !== target && validTarget(tgt)) setTarget(tgt, !PN.going);   // a pane coming forward changes the address in place
  if (name === "activity" && (!LOG_VIEW || isFixedT(target) || isRelayT(target))) name = "chat";   // 알림 / 작업 기록 have no terminal view; LOG_VIEW off: no log view at all
  if (name !== current) prevView = current;
  if (current === "chat" && name !== "chat") paneStash();
  current = name;
  relayPaint();
  if (name === "apps") appsOpen(tgt);   // after current is set: appsRender draws only the shown 앱 tab
  if (convSync()) renderAll();
  const tv = name === "chat" || name === "activity";
  if (name === "harness") hProjId = tgt && tgt.startsWith("project/") ? tgt.slice(8) : "";
  const hash = tv ? (chatList ? "chat/list" : mc ? `monitoring/c:${enc(target)}` : `${name}/${target}`) : name === "harness" && hProjId ? `harness/project/${enc(hProjId)}` : name === "project" && tgt ? `project/${enc(tgt)}` : name === "cardform" && tgt ? `cardform/${enc(tgt)}` : name === "monitoring" ? monHash() : name === "apps" ? appsHash() : name;
  navSync(name, hash);
  const pp = name === "project" && ppWide();
  for (const v of views) $(`#v-${v}`).hidden = v !== name && !(pp && v === "projects");
  $("#views").classList.toggle("pp", pp);
  paneSync();
  if ((name === "chat" || name === "activity") && !chatList) try { localStorage.setItem(isLaneT(target) ? `dotz-lane-view:${target}` : CHAT_MODE_KEY, name); } catch {}
  document.querySelectorAll("#nav .ni").forEach(b => { const on = b.dataset.view === navView(SUB.has(name) ? "settings" : mc ? "monitoring" : paneLit(name) ? "chat" : name); b.classList.toggle("on", on); b.setAttribute("aria-current", on ? "page" : "false"); });
  $("#appbar").classList.toggle("tv", tv);
  const th = $("#thead"), mode = name === "chat" ? "chat" : "term";
  th.hidden = !tv; $("#vtog").hidden = !tv || !LOG_VIEW;
  if (tv && th.dataset.mode !== mode) { th.dataset.mode = mode; th.dataset.sig = ""; }
  if (MT_READY) mailThreadSync();   // the same-sender mail panel belongs to the mail conversation that is open (30-mail-thread.js)
  $("#title").textContent = name === "home" ? botName : titles[name];
  convChrome();
  $("#views").scrollTop = 0; $("#appbar").classList.remove("scrolled");
  if (name === "harness") loadHarness(); else closeHSheet();
  if (tv) { enterTarget(); if (!(ts(target).hLoaded && ts(target).aLoaded) && !ts(target).loading) loadTarget(target, hasCached(ts(target))); }
  if (name === "home") { renderHome(); loadHomeData(); }
  if (name === "projects" || pp) { renderProjects(); prjLoad(); }
  if (name === "monitoring" || mc) { renderMonitoring(); if (!monitorsFresh()) loadMonitors(); if (!noticesFresh()) loadNotices(); if (name === "monitoring" || !INTG.loaded) loadIntegrations(); }   // opening a conversation reads the app list kept fresh already; the read it sends asks again
  if (name === "project") pmOpen(tgt);
  if (name === "notices") nscOpen();
  if (name === "settings") { if (!updFresh()) loadUpdate(); renderSettings(); loadMessengerIndex(); if (!provFresh()) loadProviderData().then(() => current === "settings" && renderSettings(), () => {}); loadRuntimes(); }
  if (name === "models") { renderModels(); loadModels(); loadProviderData().then(() => current === "models" && renderModels(), () => {}); }
  if (name === "accounts") { renderAccounts(); loadProviders(); loadAccounts(); if (!SQ) api("/api/quota").then(q => { noteQuota(q); if (current === "accounts") renderAccounts(); }, () => {}); }
  if (name === "messengers") { renderMessengers(); loadMessengerIndex(); }
  if (name === "usage") loadQuota();
  if (name === "context") loadContext();
  if (name === "discord") { loadMessengerIndex(); loadDiscord(); loadOnboarding("discord"); }
  if (name === "jandi" || name === "slack" || name === "telegram") { loadMessengerIndex(); loadMessengerSettings(name); loadOnboarding(name); }
  if (name === "devices" || name === "settings") loadDevices();
  if (name === "webaccess" || name === "settings") loadWebAccess();
  if (name === "webaccess") loadOnboarding("web-access");
  // No screen is empty on its first frame: one whose loader has not drawn yet (사용량, 컨텍스트, 구성 ...) says so, and the loader replaces this line.
  const body = $(`#v-${name} > #${name}`);
  if (body && !body.firstChild) body.append(emptyNode("불러오는 중…"));
  // A different view rises in; the same view drawn again, and the first paint, do not move. Moving inside 모니터링 (a list to its item) is one screen,
  // and a mail opening is plain content: neither replays the rise (owner 2026-11-04).
  motionView(mc ? "monitoring" : tv ? "chat" : name, tv && isMailT(target) ? [] : [...$("#views").children].filter(v => !v.hidden), !tv);
  window.dotzCustom && dotzCustom.view(name, tgt);
}
// Entries the app made are handled by popstate; this is for a hash typed into the address bar or an old foreign entry.
window.addEventListener("hashchange", () => { if (history.state && history.state.dz) return; const h = parseHash(); go(h.view, h.t); });

/* ---------- shared bits ---------- */
const limitFrac = l => l.limit ? Math.max(0, Math.min(1, l.remaining != null ? l.remaining / l.limit : 1 - (l.used || 0) / l.limit)) : null;
// A limit hit or running out pauses work until the owner switches account or waits: orange, never red (owner 2026-10-28).
const limitHit = l => { const f = limitFrac(l); return /exhaust|reach|over|critical|block|deni|limit_hit|full/.test(String(l.status || "").toLowerCase()) || (f != null && f <= .1); };
function limitTone(l) {
  const f = limitFrac(l);
  return limitHit(l) || /warn|low|near|high/.test(String(l.status || "").toLowerCase()) || (f != null && f <= .3) ? "warn" : "";
}
const bar = l => { const f = limitFrac(l); return f == null ? null : el("div", { class: `bar ${limitTone(l)}`, role: "progressbar", "aria-valuenow": Math.round(f * 100), "aria-valuemin": 0, "aria-valuemax": 100 }, el("i", { style: `width:${(f * 100).toFixed(1)}%` })); };
const pctText = l => { const f = limitFrac(l); return f == null ? "–" : `${Math.round(f * 100)}% 남음`; };
// "Claude 5 Hour" -> "5시간", "Claude 7 Day" -> "7일", "Claude 7 Day (Opus)" -> "주간 Opus" (the label comes from the provider in English; ids stay as they are).
const limitKo = s => String(s).replace(/^Claude\s+/i, "").replace(/^7\s*Day\s*\((.+)\)$/i, "주간 $1").replace(/(\d+)\s*Hours?\b/i, "$1시간").replace(/(\d+)\s*Days?\b/i, "$1일");
const limitLabel = (p, l, multi) => `${multi ? `${p.name || providerName(p.provider)} · ` : ""}${limitKo(l.label || l.id)}`;
const isConnected = p => p.auth && p.auth !== "none";
const needsAttention = p => p.in_use && !isConnected(p);
// A card that failed to load passes `retry`: its 다시 시도 button asks again (a load that gave no data is never a dead end).
const emptyNode = (t, retry) => (retry ? el("div", { class: "card empty" }, el("div", { text: t }), el("button", { class: "btn tonal", type: "button", "data-k": "retry", text: "다시 시도", onclick: ev => busy(ev.currentTarget, async () => retry()) })) : el("div", { class: "card empty", text: t }));
// The one 더 보기 of a list: the card's own last line, inside the card, never a control floating under it (.cv-more, 19-volume.css).
const moreRow = (text, onclick) => el("button", { class: "cv-more", type: "button", "data-k": "more", onclick, text });

