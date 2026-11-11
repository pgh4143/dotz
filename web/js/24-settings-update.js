/* ---------- settings: 업데이트 (hub/selfupdate.ts, /api/update*) ---------- */
// Version on disk vs the version this gateway runs, the last check, the running/finished update job, and the restart that
// applies it. After a restart request the page polls until the gateway answers with a new boot id.
const UPD = { info: null, wait: null, timer: 0, at: 0, checking: false };
// Opening settings reads both again only when the last read (boot, the 5 min tick, an update_available event) is older than that tick.
const UPD_FRESH_MS = 5 * 60000;
const updFresh = () => !!UPD.info && !UPD.info.error && !!HV.info && Date.now() - UPD.at < UPD_FRESH_MS;
// 실행 하네스 (hub/harness-update.ts, /api/harness/update): the harness binary itself, checked beside dotz's own version.
const HV = { info: null, timer: 0 };
const updWhen = iso => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }); };
// A released version is the version: the commit and the branch are printed only for a checkout that has no release.
const updVer = v => !v ? "알 수 없음" : v.kind === "git" ? (v.release ? `v${v.release}` : `${v.commit.short} · ${updWhen(v.commit.date)}${v.branch !== "main" ? ` · ${v.branch}` : ""}`) : v.kind === "tarball" ? (v.release ? `v${v.release} · 설치본` : `설치본 ${v.commit.short} · ${updWhen(v.installed)}${v.ref && v.ref !== "main" ? ` · ${v.ref}` : ""}`) : v.kind === "install" ? `설치본 · ${updWhen(v.installed)}` : "알 수 없음";
// Released versions (hub/selfupdate.ts compareReleases): numeric on date, N, then the forced part; missing sorts below any version.
const updRel = s => { const m = /^(\d{6})\.([1-3])(?:\.(\d+))?$/.exec(String(s || "").replace(/^v/, "")); return m ? [Number(m[1]), Number(m[2]), Number(m[3] || 0)] : null; };
const updRelNewer = (disk, available) => { const a = updRel(disk), b = updRel(available); if (!b) return false; if (!a) return true; for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };
// `cmd` spans in server hints become <code>.
const updCode = s => String(s || "").split("`").map((p, i) => i % 2 ? el("code", { text: p }) : p);
// A pulled-but-not-restarted update (running != disk), and the last check when it still describes the checkout. A check made
// before the checkout moved (an update just landed) no longer describes it.
function updState(i) {
  const { running: run, disk } = i || {};
  const pending = !!(run && disk && run.commit && disk.commit && run.commit.sha !== disk.commit.sha);
  const c = i && i.lastCheck && !(disk && disk.commit && i.lastCheck.version && i.lastCheck.version.commit && i.lastCheck.version.commit.sha !== disk.commit.sha) ? i.lastCheck : null;
  return { pending, c };
}
// A new version is waiting to be applied (from /api/update, not the toast).
function updAvailable() {
  const i = UPD.info;
  if (!i || i.error) return false;
  const { pending, c } = updState(i);
  if (!c || !c.ok || pending) return false;
  if (c.rewrite) return true;
  return c.available ? updRelNewer(c.version && c.version.release, c.available) : c.incomingTotal > 0;
}
const hvList = () => (HV.info && Array.isArray(HV.info.harnesses) ? HV.info.harnesses : []);
const hvNew = () => hvList().filter(h => h.available).length;
const hvJob = () => hvList().map(h => h.job).find(j => j && (j.status === "running" || j.status === "deferred")) || null;
// A new version was pulled and waits for the restart that applies it (running != disk).
function updRestartPending() {
  const i = UPD.info;
  return !!(i && !i.error && updState(i).pending);
}
// One badge for both: dotz's own version and every running harness, each named (owner 2026-11-09: an OmO update read as a dotz one). A pulled
// update that still waits for its restart keeps the badge as 재시작 필요 (it is the next step, ahead of a newer version), so it does not vanish half done.
function paintUpdBadge() {
  const b = $("#nav-upd");
  if (!b) return;
  const names = [...(updAvailable() ? ["dotz"] : []), ...hvList().filter(h => h.available).map(h => h.name)], restart = updRestartPending();
  b.hidden = !names.length && !restart;
  b.textContent = restart ? "재시작 필요" : `${names.join(" · ")} 새 버전`;
  b.title = restart ? "재시작하면 새 버전이 적용돼요" : `${names.join(", ")} 새 버전이 있어요`;
  paintUpdBar();
}
// The top update bar (hub/update-now.ts, owner 2026-11-01: "상단 알림바 누르고 나서 설정가서 다시 업뎃하는게 번거롭네"): a new version offers
// itself here and one tap runs the whole update: 받는 중 → 진행 중인 작업이 끝나면 적용 → 다시 켜는 중 → 완료 or 실패 with the reason.
// A dismissed offer (its remote head) or a seen result (its flow id) stays away (localStorage).
const UB = { tapped: false, down: false, busy: false, timer: 0, doneTimer: 0 };
const UB_KEY = "dotz-upd-bar", UB_ACTIVE = ["download", "waiting", "restarting"], UB_RESULT_MS = 60 * 60_000;
const ubSeen = () => { try { return localStorage.getItem(UB_KEY) || ""; } catch { return ""; } };
const ubSee = k => { try { localStorage.setItem(UB_KEY, k); } catch {} paintUpdBar(); };
function updBarState() {
  const i = UPD.info, f = i && !i.error ? i.flow : null;
  if (UB.down && (UB.tapped || (f && UB_ACTIVE.includes(f.phase)))) return { phase: "restarting", text: "다시 켜는 중이에요" };
  if (f && UB_ACTIVE.includes(f.phase)) return f;
  if (f && (f.phase === "done" || f.phase === "failed") && ubSeen() !== f.id && Date.now() - Date.parse(f.at) < UB_RESULT_MS) return f;
  if (updAvailable() && i.lastCheck.remoteHead && ubSeen() !== i.lastCheck.remoteHead) return { phase: "new", text: "새 버전이 있어요 · 눌러서 업데이트", id: i.lastCheck.remoteHead };
  return null;
}
// The bar wraps to two lines on a phone: the app below it starts at the bar's real height (03-base.css --upd-h).
function ubFit() {
  const b = $("#upd-bar"), root = document.documentElement.style;
  if (b) root.setProperty("--upd-h", `${b.offsetHeight}px`); else root.removeProperty("--upd-h");
}
addEventListener("resize", ubFit);
// A bar with nothing more to say leaves the way it came: it fades while its height folds (250 ms), then the app moves up; reduced motion = at once.
const UB_DONE_MS = 2400;
function ubOut(b) {
  b.removeAttribute("id");
  const gone = () => { b.remove(); ubFit(); };
  if (reducedMotion() || !b.animate) return gone();
  b.style.overflow = "hidden";
  b.animate([{ opacity: 1, height: `${b.offsetHeight}px` }, { opacity: 0, height: "0px", paddingTop: "0px", paddingBottom: "0px" }], { duration: 250, easing: "ease", fill: "forwards" }).finished.then(gone, gone);
}
function paintUpdBar() {
  const s = updBarState();
  let b = $("#upd-bar");
  if (!s) { if (b) ubOut(b); else ubFit(); return; }
  if (!b) { b = el("div", { id: "upd-bar", role: "status", "aria-live": "polite" }); document.body.append(b); }
  b.className = `upd-bar ${s.phase}`;
  const tap = s.phase === "new" || s.phase === "failed";
  const run = UPD.info && UPD.info.running && UPD.info.running.commit;
  const failHead = "업데이트하지 못했어요";
  const text = s.phase === "failed" ? `${!s.text || s.text.startsWith(failHead) ? s.text || failHead : `${failHead}: ${s.text}`}${tap ? " · 눌러서 다시 시도" : ""}` : s.phase === "done" && run ? `${s.text} · 지금 버전 ${run.short}` : s.text;
  b.replaceChildren(
    el(tap ? "button" : "span", { class: "ub-tx", ...(tap ? { type: "button", onclick: updNow } : {}), text }),
    ...(UB_ACTIVE.includes(s.phase) || s.phase === "done" ? [] : [el("button", { type: "button", class: "x", "aria-label": "닫기", text: "×", onclick: () => ubSee(s.id) })]));
  ubFit();
  // A finished update says 완료 for a moment and then goes by itself (owner 2026-11-03: no × to press); before that the bar stays as it is.
  if (s.phase === "done" && !UB.doneTimer) UB.doneTimer = setTimeout(() => { UB.doneTimer = 0; ubSee(s.id); }, UB_DONE_MS);
}
// The tap: the hub downloads, tests and restarts when idle; the page follows it until the restarted gateway answers.
async function updNow() {
  if (UB.busy) return;
  UB.busy = true;
  try {
    const r = await api("/api/update/now", "POST");
    UPD.info = { ...(UPD.info || {}), flow: r.flow };
    UB.tapped = true;
    paintUpdBar();
    updBarTick();
  } catch (e) { toast(e.message, true); } finally { UB.busy = false; }
}
async function updBarTick() {
  clearTimeout(UB.timer);
  UB.timer = 0;
  const r = await fetch("/api/update", { cache: "no-store" }).then(x => (x.ok ? x.json() : null), () => null);
  UB.down = !r;
  if (r) { UPD.info = r; paintUpdBadge(); if (inSettings()) renderSettings(); }
  paintUpdBar();
  const f = UPD.info && UPD.info.flow;
  if (UB.down || (f && UB_ACTIVE.includes(f.phase))) UB.timer = setTimeout(updBarTick, 2000);
  else UB.tapped = false;
}
async function loadUpdate() {
  clearTimeout(UPD.timer);
  clearTimeout(HV.timer);
  const [dotz, hv] = await Promise.all([api("/api/update").catch(e => ({ error: e.message })), api("/api/harness/update").catch(() => null)]);
  UPD.info = dotz;
  HV.info = hv;
  UPD.at = Date.now();
  paintUpdBadge();
  if (UPD.info.flow && UB_ACTIVE.includes(UPD.info.flow.phase) && !UB.timer) updBarTick();
  if (UPD.info.job && UPD.info.job.status === "running") UPD.timer = setTimeout(loadUpdate, 1500);
  else if (HV.info && (HV.info.checking || hvJob())) HV.timer = setTimeout(loadUpdate, 2000);
  if (inSettings()) renderSettings();
}
async function hvCheck(btn) {
  await busy(btn, async () => {
    HV.info = await api("/api/harness/update/check", "POST");
    const n = hvNew();
    toast(n ? `작업 프로그램 새 버전 ${n}개가 있어요` : "작업 프로그램은 최신이에요");
  });
  paintUpdBadge();
  renderSettings();
}
async function hvApply(btn, id) {
  await busy(btn, async () => { await api("/api/harness/update/apply", "POST", { id }); });
  loadUpdate();
}
// The pressed row says 확인하는 중… and keeps its card while the check runs; the result comes back into the same row.
async function updCheck(btn) {
  if (UPD.checking) return;
  UPD.checking = true;
  renderSettings();
  await busy(btn, async () => {
    const c = await api("/api/update/check", "POST");
    UPD.info = { ...UPD.info, lastCheck: c };
    paintUpdBadge();
    if (c.ok) toast(c.rewrite ? "저장소 기록이 바뀌어서 새 기록으로 옮겨요" : c.available && updRelNewer(c.version && c.version.release, c.available) ? `새 버전 ${c.available}이 있어요` : c.incomingTotal ? `새 커밋 ${c.incomingTotal}개가 있어요` : "최신 버전이에요");
  });
  UPD.checking = false;
  renderSettings();
}
// Local work the update carries as a local patch (hub/selfupdate.ts apply): one Korean line and what was saved; the update itself goes on.
function updKeepBox(k) {
  const sv = k.saved || {};
  const where = [sv.branch, sv.patch, sv.dirtyPatch].filter(Boolean).join(" · ");
  return el("div", { class: "upd-block" }, el("div", { text: k.line }),
    el("ul", { class: "upd-log" }, ...k.dirty.slice(0, 8).map(d => el("li", {}, el("code", { text: d.slice(0, 2).trim() || "?" }), el("span", { text: d.slice(3) }))), ...k.commits.slice(0, 8).map(a => el("li", {}, el("code", { text: a.short }), el("span", { text: a.subject, title: a.subject })))),
    where ? el("div", { class: "sup", text: `보관: ${where}` }) : null);
}
async function updSet(values) {
  try { UPD.info.settings = (await api("/api/update/settings", "PUT", values)).settings; } catch (e) { toast(e.message, true); }
  renderSettings();
}
function updRestart() {
  const working = (UPD.info && UPD.info.busy) || [];
  const fire = async when => {
    const boot = UPD.info.boot;
    try { await api("/api/update/restart", "POST", { when }); } catch (e) { return toast(e.message, true); }
    UPD.wait = { boot, when };
    renderSettings();
    updWaitTick();
  };
  if (!working.length) return fire("idle");
  dialog({ classic: true, title: "재시작", body: el("div", { class: "col" }, el("p", { class: "sup", text: `작업 중: ${working.join(", ")}` }), el("p", { class: "sup", text: "끊긴 요청은 다시 켜질 때 이어서 보내요." })), actions: [
    { label: "작업이 끝나면", onclick: c => { c(); fire("idle"); } },
    { label: "지금 재시작", kind: "pri", onclick: c => { c(); fire("now"); } }] });
}
async function updWaitTick() {
  if (!UPD.wait) return;
  const info = await fetch("/api/update", { cache: "no-store" }).then(r => r.ok ? r.json() : null, () => null);
  if (info && info.boot !== UPD.wait.boot) {
    UPD.wait = null;
    UPD.info = info;
    paintUpdBadge();
    toast(`다시 시작했어요 · 지금 버전 ${info.running && info.running.commit ? info.running.commit.short : "?"}`);
    if (inSettings()) renderSettings();
    return;
  }
  if (info) { UPD.info = info; paintUpdBadge(); if (inSettings()) renderSettings(); }
  setTimeout(updWaitTick, 2000);
}
const hvCanUpd = h => h.available && (h.installMethod === "bun-global" || h.installMethod === "omp-update");
// The runtime picker's data (web/js/26-settings-runtime.js): the same two rows, folded into this one section so the screen
// carries a single 실행 하네스 heading.
const hvRt = () => (typeof RT !== "undefined" && RT && Array.isArray(RT.runtimes) ? RT.runtimes : []);
const hvRoles = rt => (rt && rt.roles && rt.roles.length ? rt.roles.map(k => (typeof RT_ROLE !== "undefined" ? RT_ROLE[k] : "") || k).join("·") + " 사용 중" : "");
const hvSub = h => {
  if (!h.current) return h.error || "확인 중…";
  const rt = hvRt().find(r => r.id === h.id);
  const role = hvRoles(rt);
  const ver = `지금 ${h.current}${h.latest && h.latest !== h.current ? ` → ${h.latest}` : ""}`;
  const withRole = s => (role ? `${s} · ${role}` : s);
  if (h.installMethod === "managed") return withRole(`${ver} · ${h.managedBy || "다른 프로그램"}이 관리해요`);
  if (h.installMethod === "app") return withRole(`${ver} · 앱으로 설치됨`);
  if (h.error) return withRole(`${ver} · ${h.error}`);
  if (!h.latest && !h.checkedAt) return withRole(ver);
  return withRole(h.available ? ver : `${ver} · 최신`);
};
function hvSwitcher(h) {
  const rt = hvRt().find(r => r.id === h.id);
  // Every installed program is listed and the one in use carries the check, like any other choice menu.
  const all = hvRt().filter(r => r.installed).map(r => ({ value: r.id, label: r.label, sub: [r.version ? `v${r.version}` : "", hvRoles(r)].filter(Boolean).join(" · ") || undefined }));
  if (!rt || all.length < 2) return null;
  return el("button", { class: "btn tonal inrow", type: "button", "aria-label": `${h.name} 바꾸기`, "aria-haspopup": "listbox", "aria-expanded": "false", title: "작업 프로그램 바꾸기", onclick: ev => showMenu(ev.currentTarget, all, { value: rt.roles.length ? h.id : "", onPick: id => { if (id !== h.id) rtFlow(hvRt().find(x => x.id === id)); } }) }, icon("drop"));
}
const hvNote = text => el("div", { class: "note", text });
function hvJobLine(j) {
  if (j.status === "running" || j.status === "deferred") return el("div", { class: "li" }, el("span", { class: "lead" }, el("span", { class: "dot pri", "aria-hidden": "true" })), el("span", { class: "tx" }, el("div", { class: "hd", text: j.status === "deferred" ? "작업이 끝나면 업데이트해요" : `업데이트 중 · ${j.phase}` }), el("div", { class: "sup", text: j.message })));
  return el("div", { class: `upd-box ${j.status === "updated" ? "ok" : j.status === "failed" ? "err" : ""}` }, el("div", { class: "upd-msg", text: j.message }),
    j.steps.length ? el("ul", { class: "upd-log" }, ...j.steps.slice(-4).map(s => el("li", { class: "dim" }, el("span", { text: s.text })))) : null);
}
// 실행 하네스: the harness the agents run on, its version and update, and the picker that switches harnesses - one section.
// A busy gateway defers the install to idle.
function hvSection() {
  const hs = hvList();
  const running = hvRt().filter(r => (r.roles || []).length > 0);
  const ids = [...new Set([...hs.map(h => h.id), ...running.map(r => r.id)])];
  if (!ids.length) return [];
  const pending = hvJob();
  const list = ids.map(id => {
    const rt = hvRt().find(r => r.id === id);
    const h = hs.find(x => x.id === id) || { id, name: (rt && rt.label) || id, current: (rt && rt.version) || null, latest: null, available: false, installMethod: "unknown", checkedAt: null };
    const job = h.job;
    const mine = job && (job.status === "running" || job.status === "deferred");
    const state = mine
      ? el("span", { class: "tag pri", "aria-live": "polite" }, el("span", { class: "dot pri", "aria-hidden": "true" }), job.status === "deferred" ? "대기 중" : "진행 중")
      : h.available && h.installMethod !== "managed" && h.installMethod !== "app" ? el("button", { class: "btn inrow", type: "button", disabled: !hvCanUpd(h) || !!pending, onclick: ev => hvApply(ev.currentTarget, h.id) }, "업데이트") : null;
    return el("div", { class: "li" }, el("span", { class: "lead" }, icon("harness")), el("span", { class: "tx" }, el("div", { class: "hd", text: h.name }), el("div", { class: "sup", text: hvSub(h) })),
      liEnd(h.available && !mine ? el("span", { class: "tag warn upd-new", text: "새 버전" }) : null, state, hvSwitcher(h)));
  });
  if (pending) list.push(hvJobLine(pending));
  else for (const h of hs) if (h.job && h.job.status !== "current") list.push(hvJobLine(h.job));
  const notes = [hvNote("바꾼 뒤에는 어시스턴트와 세션을 다시 시작해야 적용돼요.")];
  return [el("div", { class: "sec sec-act" }, el("span", { text: "작업 프로그램 버전" }), hvNew() ? el("span", { class: "tag warn upd-new", text: "새 버전" }) : null,
    el("button", { class: "btn tonal sm", type: "button", disabled: !!(HV.info && HV.info.checking), onclick: ev => hvCheck(ev.currentTarget) }, "새 버전 확인")), el("div", { class: "list" }, ...list), ...notes];
}
function updateSection() {
  const i = UPD.info;
  const liDot = (title, sub) => el("div", { class: "li" }, el("span", { class: "lead" }, el("span", { class: "dot pri", "aria-hidden": "true" })), el("span", { class: "tx" }, el("div", { class: "hd", text: title }), sub ? el("div", { class: "sup", text: sub }) : null));
  const li = (title, sub, ...trail) => el("div", { class: "li" }, el("span", { class: "lead" }, icon("download")), el("span", { class: "tx" }, el("div", { class: "hd", text: title }), sub ? el("div", { class: "sup", text: sub }) : null), trail.length ? liEnd(...trail) : null);
  if (!i || i.error) return [el("div", { class: "list", id: "upd-sec" }, li("앱 버전", i ? i.error : "불러오는 중…"))];
  const { running: run, disk, job, settings: s } = i;
  const jobRunning = job && job.status === "running";
  const { pending, c } = updState(i);
  const off = jobRunning || UPD.wait || UPD.checking ? { disabled: true } : {};
  // One row says the version; after a check its sub line also says it is the latest and when it was checked.
  const latest = !!(c && c.ok && !updAvailable() && !pending);
  const sub = UPD.checking ? "확인하는 중…" : [`실행 중 ${updVer(run)}`, latest ? "최신 버전이에요" : "", latest ? `확인 ${updWhen(c.at)}` : "", latest && c.ahead.length ? `로컬 커밋 ${c.ahead.length}개 (아직 올리지 않음)` : "", latest && c.dirty.length ? `커밋 안 한 변경 ${c.dirty.length}개` : ""].filter(Boolean).join(" · ");
  const rows = [li("앱 버전", sub, el("button", { class: "btn tonal inrow", type: "button", ...off, onclick: ev => updCheck(ev.currentTarget) }, "새 버전 확인"))];
  if (c && !c.ok) rows.push(el("div", { class: "upd-box err" }, el("div", { class: "hd", text: c.error.reason }), el("div", { class: "sup" }, ...updCode(c.error.fix)), c.error.detail ? el("div", { class: "upd-detail", text: c.error.detail }) : null));
  else if (c && updAvailable()) {
    const more = c.incomingTotal - c.incoming.slice(0, 8).length;
    rows.push(el("div", { class: "upd-box" },
      el("div", { class: "hd", text: c.available ? `새 버전 ${c.version && c.version.release ? c.version.release : "설치본"} → ${c.available}` : `새 커밋 ${c.incomingTotal}개 · ${c.upstream}` }),
      el("ul", { class: "upd-log" }, ...c.incoming.slice(0, 8).map(x => el("li", {}, el("code", { text: x.short }), el("span", { text: x.subject, title: x.subject }))), more > 0 ? el("li", { class: "dim" }, el("span", { text: `외 ${more}개` })) : null),
      c.available ? el("a", { class: "sup", href: `https://github.com/ddotz/dotz/releases/tag/v${c.available}`, target: "_blank", rel: "noopener", text: "릴리스 노트 보기" }) : null,
      c.blocked.length ? el("div", { class: "upd-block" }, ...c.blocked.map(b => el("div", { text: b }))) : null,
      c.keep ? updKeepBox(c.keep) : null,
      c.ahead.length && !c.keep ? el("div", { class: "sup", text: `로컬 커밋 ${c.ahead.length}개는 새 버전 위에 자동으로 얹어요. 테스트가 실패하면 그대로 두고 알려요.` }) : null,
      el("div", { class: "upd-act" }, el("button", { class: "btn", type: "button", ...(c.blocked.length || pending ? { disabled: true } : off), onclick: () => updNow() }, "지금 업데이트"), el("span", { class: "sup", text: "테스트가 실패하면 그대로 있어요." }))));
  }
  if (jobRunning) rows.push(liDot(`업데이트 중 · ${job.phase}`, job.message));
  else if (job && job.status !== "current" && !(job.status === "updated" && !pending)) rows.push(el("div", { class: `upd-box ${job.status === "updated" ? "ok" : "err"}` }, el("div", { class: "upd-msg", text: job.keep && !(c && c.keep) ? job.keep.line : job.message }), job.keep && !(c && c.keep) ? updKeepBox(job.keep) : null));
  if (UPD.wait) rows.push(liDot("재시작 대기 중", UPD.wait.when === "now" ? "곧 다시 켜져요. 이 화면은 자동으로 다시 연결돼요." : `작업이 끝나면 다시 켜져요${i.busy.length ? ` (${i.busy.join(", ")})` : ""}. 이 화면은 자동으로 다시 연결돼요.`));
  else if (pending) rows.push(li(`새 버전 ${disk.commit.short} 받음`, "재시작하면 적용돼요", el("button", { class: "btn inrow", type: "button", onclick: () => updRestart() }, "재시작")));
  const prefs = [el("div", { class: "li" }, el("span", { class: "lead" }, icon("bell")), el("span", { class: "tx" }, el("div", { class: "hd", text: "자동 확인" }), el("div", { class: "sup", text: s.auto_apply ? "새 버전이 있으면 알려요." : "알림만 보내요. 적용은 직접 해요." })),
    liEnd(el("button", { type: "button", class: "hs-sw", role: "switch", "aria-checked": String(s.auto_check), "aria-label": "자동 확인", onclick: () => updSet({ auto_check: !s.auto_check }) }))),
    el("div", { class: "li" }, el("span", { class: "lead" }, icon("download")), el("span", { class: "tx" }, el("div", { class: "hd", text: "새 버전 자동 적용" }), el("div", { class: "sup", text: "새 버전을 받아 테스트하고, 하던 일이 끝나면 다시 시작해요." })),
    liEnd(el("button", { type: "button", class: "hs-sw", role: "switch", "aria-checked": String(!!s.auto_apply), "aria-label": "새 버전 자동 적용", onclick: () => updSet({ auto_apply: !s.auto_apply }) })))];
  return [el("div", { class: "list", id: "upd-sec" }, ...rows, ...prefs)];
}

/* ---------- settings: 앱 알림 per class (hub/notify-route.ts pushClasses; GET/PUT /api/push/classes) ---------- */
// The web app and the phone are one place, "앱 알림": one switch per notice class, the same on every device. The bell keeps every notice
// either way; a switch decides whether that class notifies. Each messenger has its own 알림 switches in its connection sheet (설정 → 메신저).
const NOTIFY_CLASSES = [["ask", "답변 필요", "질문 · 승인 · 로그인"], ["alert", "경고", "게이트웨이 오류 · 로그인 끊김 · 감시 반복 실패"], ["result", "결과", "세션 · 작업 완료 · 실패"],
  ["news", "새 소식", "메일 · 카톡 · 댓글 · 감시 · 예약"], ["conv", "대화", "보고 있지 않은 대화의 새 답"], ["log", "진행", "진행 중 보고 · 작업 기록"]];
// One plain row per class with a switch; `on(k)` reads a class's state, `set(k, on)` changes it, `only` limits the classes shown.
const notifyRows = (on, set, only) => NOTIFY_CLASSES.filter(([k]) => !only || only.includes(k)).map(([k, label, desc]) => el("div", { class: "li", "data-notify": k }, el("span", { class: "tx" }, el("div", { class: "hd", text: label }), el("div", { class: "sup", text: desc })),
  liEnd(el("button", { type: "button", class: "hs-sw", role: "switch", "aria-checked": String(on(k)), "aria-label": `${label} 알림`, "data-k": k, onclick: () => set(k, !on(k)) }))));
const APPN = { v: null, asked: false };
async function appNotifyLoad() { APPN.asked = true; try { APPN.v = (await api("/api/push/classes")).classes; } catch { APPN.v = null; } if (inSettings()) renderSettings(); }
// Only the switches change: the page is not drawn again, so no section blinks away while the answer is on its way.
const appNotifyFlip = v => { for (const [k] of NOTIFY_CLASSES) { const b = document.querySelector(`[data-notify="${k}"] .hs-sw`); if (b) b.setAttribute("aria-checked", String(v[k] === true)); } };
async function appNotifySet(k, on) {
  const was = APPN.v[k];
  APPN.v = { ...APPN.v, [k]: on }; appNotifyFlip(APPN.v);
  try { APPN.v = (await api("/api/push/classes", "PUT", { classes: { [k]: on } })).classes; } catch (e) { APPN.v = { ...APPN.v, [k]: was }; toast(e.message, true); }
  appNotifyFlip(APPN.v);
}
function appNotifyRows() {
  if (!APPN.v && !APPN.asked) appNotifyLoad();
  if (!APPN.v) return [];
  return [...notifyRows(k => APPN.v[k] === true, appNotifySet), el("div", { class: "li" }, el("span", { class: "tx" }, el("div", { class: "sup", text: "꺼도 목록에는 남아요." })))];
}

function renderSettings() {
  const page = Object.hasOwn(SET_PAGE, current) ? SET_PAGE[current] : null;
  const box = $(page ? `#${current}` : "#settings");
  if (box.contains(document.activeElement) && openMenu) return;
  clear(box).append(...(page ? page.build() : settingsCols(settingsList(go))));
}
