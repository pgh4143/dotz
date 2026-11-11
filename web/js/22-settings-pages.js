/* ---------- settings: the short list and its sub-pages (prototype #settings and #settings/<page>) ---------- */
// 설정 is a short list of links in four groups; 앱과 알림, 표시, 업데이트 and 실행 하네스 are pages of their own. 04-state.js and
// 05-command-palette.js know the older views by name, so the pages join them here (the view list, the sub-screen set that keeps
// the 설정 tab lit and sends 뒤로 to 설정, the title and icon, the empty section) and go() loads their data on entry.
const SET_PAGE = {
  notifications: { title: "앱과 알림", ic: "bell", build: () => pushSection() },
  display: { title: "표시", ic: "settings", build: () => displayPage() },
  update: { title: "업데이트", ic: "download", build: () => updateSection() },
  runtime: { title: "작업 프로그램", ic: "term", build: () => { const s = hvSection(); return s.length ? s : [emptyNode(UPD.info && UPD.info.error ? "작업 프로그램을 확인하지 못했어요" : "작업 프로그램을 확인하는 중이에요")]; } },
};
for (const [id, p] of Object.entries(SET_PAGE)) {
  views.push(id); SUB.add(id); titles[id] = p.title; VIEW_ICON[id] = p.ic;
  $("#views").append(el("section", { class: "view", id: `v-${id}`, hidden: "" }, el("div", { id, class: "st-page" })));
}
const inSettings = () => current === "settings" || Object.hasOwn(SET_PAGE, current);
const goBeforeSettingPages = go;
go = function (name, tgt) {
  goBeforeSettingPages(name, tgt);
  if (current === "settings" && !ACC) loadAccounts();
  if (!Object.hasOwn(SET_PAGE, current)) return;
  if (current === "update" || current === "runtime") loadUpdate();
  if (current === "runtime") loadRuntimes();
  renderSettings();
};

/* ---------- the rows these pages share ---------- */
const stSec = title => el("div", { class: "sec", text: title });
const stList = (...rows) => el("div", { class: "list" }, ...rows.filter(Boolean));
// One link row: lead icon, a title with its one-line description, then the right slot (a status tag) and the chevron.
const stRow = (ic, title, sub, onclick, trail) => el("button", { class: "li tap", type: "button", onclick: ev => onclick(ev.currentTarget) },
  el("span", { class: "lead" }, icon(ic)),
  el("span", { class: "tx" }, el("div", { class: "hd", text: title }), sub ? el("div", { class: "sup", text: sub }) : null),
  trail === null ? null : el("span", { class: "li-end" }, trail === undefined ? null : trail, icon("chev", "chev")));
// A setting with exactly two values keeps its one right-hand control: the two-value pill (docs/ui-spec.md 두 값 설정), not a tag beside a chevron.
const stToggle = (ic, title, sub, label, opts, value, onPick) => el("div", { class: "li" },
  el("span", { class: "lead" }, icon(ic)),
  el("span", { class: "tx" }, el("div", { class: "hd", text: title }), sub ? el("div", { class: "sup", text: sub }) : null),
  liEnd(rowToggle({ label, opts, value, onPick: (v, btn) => onPick(v, btn) })));
const stTag = (text, tone = "warn") => el("span", { class: `tag ${tone}${tone === "warn" ? " upd-new" : ""}`, text });

/* ---------- one-line summaries under the link rows ---------- */
function stUsageSub() {
  const q = typeof SQ !== "undefined" && SQ ? SQ : null;
  const lims = q ? (q.providers || []).flatMap(p => (p.limits || []).filter(l => !l.scope).map(l => ({ l, f: limitFrac(l) }))).filter(x => x.f != null) : [];
  const low = lims.sort((a, b) => a.f - b.f)[0];
  return [low ? `${limitName(low.l)} ${pctText(low.l)}` : "", budgetSub()].filter(Boolean).join(" · ");
}
function stAccountSub() {
  const a = ACC && ACC.accounts ? ACC.accounts.find(x => x.current) : null;
  return a ? `${a.label || a.alias || a.name} 사용 중` : "";
}
const stUpdShort = v => (v && v.commit ? (v.release ? `v${v.release}` : v.commit.short) : "");
function stUpdateSub() {
  const i = UPD.info;
  if (!i) return "";
  if (i.error) return i.error;
  if (updRestartPending()) return `새 버전 ${stUpdShort(i.disk)} 받음 · 재시작하면 적용돼요`;
  const c = updState(i).c;
  return `지금 ${stUpdShort(i.running) || "알 수 없음"}${c && c.ok && !updAvailable() ? " · 최신" : ""}`;
}
// The main conversation's context share, from the figure the page already holds (no request); empty until it is loaded.
function stContextSub() {
  const p = typeof C !== "undefined" && C ? ctxSession(MAIN) : null;
  return p && p.running && p.percent != null ? `${Math.round(p.percent)}% 사용 중` : "";
}
function stRuntimeSub() {
  const names = [...new Set(hvRt().filter(r => (r.roles || []).length).map(r => r.label))];
  return names.join(" · ");
}
function stPushSub() {
  if (PWA.gw && PWA.gw.app) { const on = PWA.gw.gateways.filter(g => g.on).length; return on ? "푸시 알림 켬" : "푸시 알림 꺼짐"; }
  if (PWA.sub && PWA.info && PWA.info.subscribed) return "푸시 알림 켬";
  return pushCapable() ? "푸시 알림 꺼짐" : "이 브라우저는 알림을 지원하지 않아요";
}

/* ---------- 설정 (the list) ---------- */
// The first screen's groups (a .sec title + its .list) go into two .set-col boxes: 앱 and 시스템 on the right, every other group on the left. One column on a narrow window (18-app-settings.css).
function settingsCols(nodes) {
  const left = el("div", { class: "set-col" }), right = el("div", { class: "set-col" });
  let col = left;
  for (const n of nodes) {
    if (n.classList.contains("sec")) col = n.textContent === "앱" || n.textContent === "시스템" ? right : left;
    col.append(n);
  }
  return [left, right];
}
function settingsList(go) {
  const om = M && M.orchestrator;
  const connected = P ? P.providers.filter(isConnected).length : null;
  const nodes = [
    stSec("계정과 모델"), stList(
      stRow("key", "계정", [stAccountSub(), connected != null ? `${connected}개 연결` : ""].filter(Boolean).join(" · "), () => go("accounts")),
      stRow("model", "모델", om ? [modelName(om.model), thinkKo(om.thinking)].filter(Boolean).join(" · ") : "", () => openModels("orchestrator")),
      stRow("usage", "사용량과 월 한도", stUsageSub(), () => go("usage")),
      stRow("context", "컨텍스트", stContextSub(), () => go("context"))),
    stSec("연결"), stList(
      msHubRow(),
      webAccessRow(stRow),
      devicesRow(stRow),
      mnRow()),
    ...dskSettings(),
    stSec("앱"), stList(
      stRow("bell", "앱과 알림", stPushSub(), () => go("notifications")),
      navOff("apps") ? null : stRow("apps", "앱 관리", "", () => go("apps")),
      stRow("spark", "화면 안내 다시 보기", "화면 설명과 단축키", () => introOpen()),
      stRow(themeIc(), "표시", `${themeIs() === "dark" ? "다크" : "라이트"} · 대화 탭 ${chatTabMode() === "main" ? "메인" : "마지막"}`, () => go("display"))),
    stSec("시스템"), stList(
      stRow("download", "업데이트", stUpdateSub(), () => go("update"), updRestartPending() ? stTag("재시작 필요") : updAvailable() ? stTag("새 버전") : undefined),
      stRow("term", "작업 프로그램", stRuntimeSub(), () => go("runtime"), hvNew() ? stTag("새 버전") : undefined),
      stRow("harness", "구성", "시스템 지도", () => go("harness"))),
  ];
  return nodes;
}

/* ---------- 표시 ---------- */
function displayPage() {
  return [stList(
    stToggle(themeIc(), "화면 모드", "", "화면 모드", [["light", "라이트"], ["dark", "다크"]], themeIs(), v => { if (v !== themeIs()) toggleTheme(); renderSettings(); }),
    stToggle("chat", "대화 탭", chatTabMode() === "main" ? "채팅을 열면 메인 대화부터 시작해요" : "채팅을 열면 마지막으로 보던 대화부터 시작해요", "대화 탭", [["main", "메인"], ["last", "마지막"]], chatTabMode(), v => { chatTabModeSet(v); renderSettings(); })),
    stSec("진단"), stList(...kbdRows())];
}
