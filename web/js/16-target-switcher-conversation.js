/* ---------- target switcher + 대화/터미널 toggle (rendered into the header of both views) ---------- */
// Manual order from dragging the chips; 레인 panes and 홈 cards have their own free layout (makeBoard) and do not use it. Never-dragged targets keep spawn order after the ordered ones.
const ORDER_KEY = "dotz-order";
let ORDER = (() => { const v = lsJson(ORDER_KEY, []); return Array.isArray(v) ? v : []; })();
const byOrder = list => list.map((t, i) => [t, ORDER.indexOf(t), i]).sort((a, b) => (a[1] < 0 ? 1e9 + a[2] : a[1]) - (b[1] < 0 ? 1e9 + b[2] : b[1])).map(x => x[0]);
// Move `from` to just before `to` (or after it when `after`), given the list as currently shown.
function moveInOrder(shown, from, to, after) {
  if (from === to) return;
  const next = shown.filter(t => t !== from);
  next.splice(next.indexOf(to) + (after ? 1 : 0), 0, from);
  ORDER = [...next, ...ORDER.filter(t => !next.includes(t))];
  try { localStorage.setItem(ORDER_KEY, JSON.stringify(ORDER)); } catch {}
  document.querySelectorAll(".thead").forEach(b => { b.dataset.sig = ""; });
  renderBars();
}
// HTML5 drag: `handle` starts the drag (defaults to the node), `node` takes drops for target `t` within `shown()`;
// it lands before or after `t` by which half the pointer is in.
function dragItem(node, t, shown, horizontal, handle = node) {
  handle.draggable = true;
  handle.addEventListener("dragstart", ev => { ev.dataTransfer.setData("text/x-dotz-target", t); ev.dataTransfer.effectAllowed = "move"; node.classList.add("dragging"); });
  handle.addEventListener("dragend", () => node.classList.remove("dragging"));
  node.addEventListener("dragover", ev => { if (ev.dataTransfer.types.includes("text/x-dotz-target")) { ev.preventDefault(); node.classList.add("dropon"); } });
  node.addEventListener("dragleave", () => node.classList.remove("dropon"));
  node.addEventListener("drop", ev => {
    ev.preventDefault(); node.classList.remove("dropon");
    const from = ev.dataTransfer.getData("text/x-dotz-target"), r = node.getBoundingClientRect();
    if (from) moveInOrder(shown(), from, t, horizontal ? ev.clientX > r.left + r.width / 2 : ev.clientY > r.top + r.height / 2);
  });
}
function renderBars() {
  paintAttn(); convSchedule();
  const lanes = S ? S.lanes : [];
  // Three groups in this order: the main assistant, 프로젝트 (project orchestrators), 레인. Dragging reorders within a group.
  const projs = byOrder(projTargets()), live = byOrder(lanes.filter(laneAlive).map(l => `lane:${l.name}`)), dead = byOrder(lanes.filter(l => !laneAlive(l)).map(l => `lane:${l.name}`));
  if (isLaneT(target) && !live.includes(target) && !dead.includes(target)) live.push(target);
  const alive = [MAIN, "worklog", ...projs, ...live];   // 알림 is the screen (#notices), not a conversation to pick
  const view = t => {
    const i = targetInfo(t);
    const k = attnKind(t);
    if (isFixedT(t)) return { t, name: targetName(t), tone: "", attn: "", status: "", unread: ts(t).unread, subs: 0 };
    return { t, name: targetName(t), tone: k ? "warn" : targetState(t)[1], attn: k, status: targetState(t)[0], unread: ts(t).unread, subs: runningSubs(subsSourceOf(t)).length };
  };
  const A = alive.map(view), D = dead.map(view), FA = A.filter(v => isFixedT(v.t)), PA = A.filter(v => isProjT(v.t)), LA = A.filter(v => isLaneT(v.t));
  const cur = view(target), others = [...A, ...D].reduce((n, v) => n + (v.t === target ? 0 : v.unread), 0);
  const othersAttn = [...A, ...D].filter(v => v.t !== target && v.attn).length;
  const sig = JSON.stringify([A, D, cur, others, target, ORDER]);
  const chip = v => { const b = el("button", { class: `tchip${v.t === target ? " on" : ""}`, type: "button", "data-t": v.t, "aria-pressed": v.t === target ? "true" : "false", title: v.attn ? `${attnLabel(v.attn)} · ${v.status}` : v.status, onclick: () => pickTarget(v.t) },
    el("span", { class: `dot ${v.tone}` }), el("span", { class: "tx", text: v.name }),
    v.attn ? el("span", { class: "sb warn", text: attnLabel(v.attn) }) : null,
    v.subs ? el("span", { class: "sb", title: "서브에이전트", text: `서브 ${v.subs}` }) : null,
    v.unread ? el("span", { class: "nb", text: v.unread > 99 ? "99+" : String(v.unread) }) : null);
    if (v.t !== MAIN && !isFixedT(v.t)) dragItem(b, v.t, () => (D.some(d => d.t === v.t) ? D : isProjT(v.t) ? PA : LA).map(x => x.t), true);
    return b; };
  const sep = () => el("span", { class: "tsep", "aria-hidden": "true" });
  const menuItem = v => ({ value: v.t, label: v.name, tone: v.tone, sub: [v.status, v.subs ? `서브 ${v.subs}` : ""].filter(Boolean).join(" · "), flag: v.attn ? attnLabel(v.attn) : "", badge: v.unread || "" });
  const homeOfT = t => { const l = lanes.find(x => `lane:${x.name}` === t); return l ? laneChat(l) : ""; };
  const sesItem = v => { const l = lanes.find(x => `lane:${x.name}` === v.t); return { ...menuItem(v), indent: true, sub: [l ? sessionStatus(l)[0] : v.status, v.subs ? `서브 ${v.subs}` : ""].filter(Boolean).join(" · ") }; };
  for (const bar of document.querySelectorAll(".thead")) {
    const mode = bar.dataset.mode, msig = `${sig}|${mode}`;
    if (bar.dataset.sig === msig || (openMenu && bar.contains(openMenu.anchor))) continue;
    bar.dataset.sig = msig; bar.classList.toggle("lanev", isLaneT(target));
    // Exited lanes are not shown; one opened from the palette shows as a chip only while it is the selected target.
    const shownV = [...A, ...D.filter(v => v.t === target)], laneV = shownV.filter(v => isLaneT(v.t));
    const sw = el("div", { class: "tsw", role: "group", "aria-label": "대화 대상" }, chip(A[0]), ...FA.map(chip),
      ...(PA.length ? [sep(), ...PA.map(chip)] : []), ...(laneV.length ? [sep(), ...laneV.map(chip)] : []),
      el("button", { type: "button", class: "tchip tmore", hidden: true, "aria-haspopup": "listbox", "aria-expanded": "false" }));
    sw._views = shownV;
    const drop = el("button", { type: "button", class: "sel tdrop", "aria-haspopup": "listbox", "aria-expanded": "false", "aria-label": `대화 대상: ${cur.name}` },
      el("span", { class: `dot ${cur.tone}` }), el("span", { class: "val", text: cur.name }),
      cur.attn ? el("span", { class: "sb warn", text: attnLabel(cur.attn) }) : null,
      cur.subs ? el("span", { class: "sb", text: `서브 ${cur.subs}` }) : null,
      othersAttn ? el("span", { class: "nb warn", title: `다른 대상 확인 필요 ${othersAttn}개`, text: String(othersAttn) })
        : others ? el("span", { class: "nb", title: "다른 대상의 새 메시지", text: others > 99 ? "99+" : String(others) }) : null,
      icon("drop"));
    drop._items = () => [
      menuItem(A[0]), ...FA.map(menuItem),
      // each project followed by its sessions (indented, with the session's status); sessions started from chat close the list
      ...(PA.length ? [{ header: "프로젝트" }] : []),
      ...PA.flatMap(p => [menuItem(p), ...LA.filter(v => homeOfT(v.t) === p.t).map(sesItem)]),
      ...(LA.some(v => !PA.some(p => p.t === homeOfT(v.t))) ? [{ header: "프로젝트 없음" }, ...LA.filter(v => !PA.some(p => p.t === homeOfT(v.t))).map(sesItem)] : []),
      ...D.filter(v => v.t === target).map(v => ({ value: v.t, label: v.name, tone: v.tone, sub: v.status, badge: v.unread || "" })),
      ...(D.length ? [{ value: "__ended", label: `끝난 세션 ${D.length}`, sub: "기록 보기 · 재개" }] : [])];
    drop._pick = v => { if (v === "__ended") { endedOpen = true; go("chat", "list"); } else pickTarget(v); };
    drop.onclick = () => showMenu(drop, drop._items(), { value: target, onPick: drop._pick });
    const ud = mode === "term" && ts(target).unread > 0;
    clear(bar).append(sw, drop);
    fitChips(sw);
    // 대화/로그: one icon button for the main chat, a project and a session (phone and desktop); the icon is the view a tap switches to
    const vt = $("#vtog"), to = mode === "chat" ? "term" : "chat";
    clear(vt).append(...[icon(to), ud ? el("i", { class: "ud" }) : null].filter(Boolean));
    vt.title = vt.ariaLabel = to === "chat" ? "대화 보기" : "로그 보기";
    vt.onclick = () => go(to === "chat" ? "chat" : "activity");
    vt.hidden = !LOG_VIEW || !$("#appbar").classList.contains("tv") || convListing() || isFixedT(target);
  }
}
// Desktop: target chips that do not fit fold into one "더보기 n" chip at the end (the selected one always stays visible;
// its badge counts the folded sessions that need the owner). Phones hide the chips and use the picker instead.
function fitChips(sw) {
  const more = sw.querySelector(".tmore"), chips = [...sw.querySelectorAll(".tchip[data-t]")];
  for (const c of chips) c.hidden = false;
  more.hidden = true;
  // A group divider shows only while a chip of its group is visible after it.
  const seps = () => { for (const s of sw.querySelectorAll(".tsep")) { let n = s.nextElementSibling, vis = false; for (; n && !n.matches(".tsep, .tmore"); n = n.nextElementSibling) if (!n.hidden) { vis = true; break; } s.hidden = !vis; } };
  seps();
  if (!sw.clientWidth || sw.scrollWidth <= sw.clientWidth) return;
  const label = vs => { const n = vs.filter(v => v.attn).length; clear(more).append(...[el("span", { class: "tx", text: `더 보기 ${vs.length}` }), n ? el("span", { class: "nb warn", title: `확인 필요 ${n}개`, text: String(n) }) : null, icon("drop")].filter(Boolean)); };
  more.hidden = false;
  label(sw._views.filter(v => v.attn));   // widest likely label first, so the fold leaves it room
  const hid = [];
  for (let i = chips.length - 1; i >= 0 && sw.scrollWidth > sw.clientWidth; i--) if (!chips[i].classList.contains("on")) { chips[i].hidden = true; hid.unshift(chips[i].dataset.t); }
  seps();
  const vs = sw._views.filter(v => hid.includes(v.t));
  label(vs);
  more.onclick = () => showMenu(more, vs.map(v => ({ value: v.t, label: v.name, tone: v.tone, sub: [v.status, v.subs ? `서브 ${v.subs}` : ""].filter(Boolean).join(" · "), flag: v.attn ? attnLabel(v.attn) : "", badge: v.unread || "" })), { value: target, onPick: pickTarget });
}
new ResizeObserver(() => { const sw = $("#thead .tsw"); if (sw) fitChips(sw); }).observe($("#thead"));

/* ---------- login requests (dotz_auth) ---------- */
// A credential the agent asked for: answered here or on Discord. Values go straight to the gateway, which stores them in a
// 0600 secrets file; they are never kept in the page.
const AUTH_DONE = new Set(), AUTH_HID = new Set(), AUTH_CARDS = new Map();   // AUTH_HID: closed with the x or back, still waiting (the notice's 입력 창으로 가기 shows it again)
let authH = null, authId = "", authWaits = false;
// `force` = the owner asked for it (the notice's 입력 창으로 가기); otherwise a request that arrives while a text field has the focus waits until the field is left, so its sheet does not take the focus (and a phone's keyboard) from what is being typed.
function paintAuth(force) {
  const list = ((S && S.auth) || []).filter(a => !AUTH_DONE.has(a.id));
  for (const id of [...AUTH_CARDS.keys()]) if (!list.some(a => a.id === id)) { AUTH_CARDS.get(id).remove(); AUTH_CARDS.delete(id); }
  for (const a of list) if (!AUTH_CARDS.has(a.id)) AUTH_CARDS.set(a.id, authCard(a));
  const cur = list.find(a => !AUTH_HID.has(a.id));
  if (!cur) { if (authH) { authId = ""; authH.close(false); } return; }
  const typing = !authH && !force && typingIn();
  if (typing) {
    if (!authWaits) { authWaits = true; typing.addEventListener("focusout", () => { authWaits = false; afterTap(() => paintAuth()); }, { once: true }); }
    return;
  }
  if (!authH) { const h = fsOpen({ onClose: () => { if (authId) AUTH_HID.add(authId); authId = ""; if (authH === h) authH = null; } }); authH = h; }
  if (authId === cur.id) return;
  authId = cur.id;
  authH.box.setAttribute("aria-labelledby", `au-t-${cur.id}`);
  clear(authH.box).append(AUTH_CARDS.get(cur.id));
}
// One login request as a form: header (title, close), body (the fields), footer (취소 / 보내기).
function authCard(a) {
  const isForm = a.kind === "form";
  const mkInput = f => isForm
    ? el("input", { type: f.mask ? "password" : f.type, id: `au-${a.id}-${f.name}`, name: f.name, inputmode: f.inputmode, autocomplete: f.autocomplete, maxlength: f.maxlength, placeholder: f.placeholder || "", autocapitalize: "off", autocorrect: "off", spellcheck: "false" })
    : el("input", { type: f.name === "username" ? "text" : "password", name: f.name, placeholder: f.label, "aria-label": f.label, autocomplete: f.name === "username" ? "username" : f.name === "code" ? "one-time-code" : "current-password" });
  const inputs = (a.fields || []).map(mkInput);
  const wrap = (f, inp) => {
    const err = el("div", { class: "ferr", role: "alert" });
    const eye = f.mask ? el("button", { class: "eye", type: "button", "aria-label": `${f.label} 보기`, text: "보기", onclick: () => { const hidden = inp.type === "password"; inp.type = hidden ? "text" : "password"; eye.textContent = hidden ? "숨기기" : "보기"; } }) : null;
    inp.addEventListener("input", () => { inp.classList.remove("bad"); err.textContent = ""; });
    return el("div", { class: "fld" }, el("label", { for: inp.id, text: f.label + (f.optional ? "(선택)" : "") }), el("div", { class: "ctl" }, inp, eye), err);
  };
  // The app's own switch row (as 설정), not a browser checkbox: the whole row is the tap target.
  const rem = isForm ? el("button", { type: "button", class: "hs-sw", role: "switch", "aria-checked": String(!!a.remember), "aria-label": "다음에도 쓰게 저장해 두기", id: `au-${a.id}-remember` }) : null;
  const remRow = rem ? el("div", { class: "list" }, el("div", { class: "li tap", onclick: () => rem.setAttribute("aria-checked", String(rem.getAttribute("aria-checked") !== "true")) }, el("span", { class: "tx" }, el("div", { class: "hd", text: "다음에도 쓰게 저장해 두기" }), el("div", { class: "sup", text: "끄면 한 번 쓰고 지워요" })), liEnd(rem))) : null;
  const done = async (action, values) => {
    try { await api(`/api/auth/${encodeURIComponent(a.id)}`, "POST", { action, ...(values ? { values } : {}), ...(rem && action === "submit" ? { remember: rem.getAttribute("aria-checked") === "true" } : {}) }); }
    catch (e) {
      const bad = e && e.data && inputs.find(i => i.name === e.data.field);
      if (bad) { bad.classList.add("bad"); bad.closest(".fld").querySelector(".ferr").textContent = e.data.error === "required" ? "비워 둘 수 없어요" : "형식을 확인해 주세요"; bad.focus(); return; }
      // A store failure finishes the request on the gateway (the bot is told); say so instead of offering a retry that cannot work.
      if (e && e.data && typeof e.data.error === "string" && e.data.error.startsWith("store failed")) { AUTH_DONE.add(a.id); paintAuth(); toast(`게이트웨이가 값을 저장하지 못했어요(봇에게도 알렸어요): ${e.data.error.replace(/^store failed: /, "")}`, true); return; }
      toast("전달하지 못했어요. 다시 시도해 주세요"); return;
    }
    AUTH_DONE.add(a.id); paintAuth();
    toast(action === "cancel" ? "요청을 취소했어요" : "전달했어요");
  };
  const ok = el("button", { class: "btn", type: "submit", text: a.kind === "approve" ? "승인" : "보내기" });
  const no = el("button", { class: "btn tonal", type: "button", text: "취소", onclick: () => done("cancel") });
  const card = el("form", { class: "au", "data-id": a.id },
    fsHead([el("span", { class: "fs-ey", text: a.kind === "approve" ? "승인 요청" : "입력 요청" }), el("h3", { class: "fs-t", id: `au-t-${a.id}`, text: a.title })], { close: () => { AUTH_HID.add(a.id); paintAuth(); } }),
    el("div", { class: "fs-body abd" }, el("p", { text: a.purpose }), ...(isForm ? a.fields.map((f, k) => wrap(f, inputs[k])) : inputs),
    remRow,
    a.kind === "approve" ? null : el("div", { class: "note", text: "입력한 값은 이 컴퓨터의 비밀 파일에만 저장되고, 대화나 기록에는 남지 않아요." })),
    el("div", { class: "fs-ft row" }, no, ok));
  card.addEventListener("submit", ev => {
    ev.preventDefault();
    if (a.kind === "approve") return done("approve");
    const values = Object.fromEntries(inputs.map(i => [i.name, i.value]));
    const miss = inputs.find((i, k) => !i.value.trim() && !(a.fields[k] && a.fields[k].optional));
    if (miss) { miss.focus(); return; }
    done("submit", values);
  });
  return card;
}
