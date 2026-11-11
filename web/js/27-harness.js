/* ---------- 구성: harness map (graph + detail sheet; data from /api/harness) ---------- */
let HG = null, hSel = "", hLoading = false, hDirty = null, hEdgeRefs = [], hNodeEls = new Map(), hTimer = 0;
let FC = null, hGoto = null, hMapBox = null, hFcBox = null, hProjBox = null, fcSig = "", fcList = null, fcCount = null;
let HGB = null, hProjId = "";   // HGB = /api/harness as served; HG = what the map draws (HGB, or the open project's own map)
let hFeat = (() => { try { return localStorage.getItem("dotz-hfeat") === "1"; } catch { return false; } })();
let hDetail = (() => { try { return localStorage.getItem("dotz-hdetail") === "1"; } catch { return false; } })();
let hOv = null, hGeo = new Map();
const fcFilter = { q: "", form: "", trigger: "", strength: "", origin: "" }, fcCollapsed = new Set(["스킬", "__off"]);
const FC_ORIGIN = { shipped: "배포용", personal: "개인용" };
// 구성 커스텀 표시: HG.origin_view (config.json ui.origin_view) 가 켜졌을 때만 쓰여요. 꺼져 있으면 아래 함수는 모두 null/빈 문자열을 돌려줘요.
let hOnly = (() => { try { return localStorage.getItem("dotz-honly") === "1"; } catch { return false; } })();
const hCvOpen = new Set();
let fcOrig = false;
const FC_LINES = { "글 지시": true, "차단 명령": true };   // 내 프롬프트 파일(RULES·LESSONS·IDENTITY)의 줄: 파일 항목에 합쳐서 보여줘요
const hOrigin = () => !!(HG && HG.origin_view);
const hOnlyOn = () => hOrigin() && hOnly;
const hData = () => (HG && HG.data_dir) || "~/.dotz";
const hOwn = f => f.origin === "personal" && !FC_LINES[f.form];
const hScope = (kind, where) => (kind === "project" ? `범위: 프로젝트 (${where})` : hOrigin() ? `범위: ${kind === "shipped" ? "배포" : "개인"} (${where})` : "");
// `where` is the short form on screen; `full` (the absolute path) stays in the title.
const hScopeTag = (kind, where, short, full = where) => (kind === "project" ? el("span", { class: "tag scope project", title: hScope(kind, full), text: short ? "프로젝트" : hScope(kind, where) }) : hOrigin() ? el("span", { class: `tag scope ${kind}`, title: hScope(kind, full), text: short ? (kind === "shipped" ? "배포" : "개인") : hScope(kind, where) }) : null);
const hFmt = (v, unit) => (typeof v === "boolean" ? (v ? "켜짐" : "꺼짐") : v === "" ? "비움" : `${typeof v === "number" ? num(v) : v}${unit ? (unit.length === 1 ? unit : ` ${unit}`) : ""}`);
const hChanged = key => !!(hOrigin() && HG.nodes.some(n => (n.custom || []).some(c => c.key === key)));
function hMine(ids) {
  const set = new Set([].concat(ids)), nodes = HG.nodes.filter(n => set.has(n.id));
  const custom = nodes.reduce((a, n) => a + (n.custom ? n.custom.length : 0), 0);
  const files = nodes.filter(n => n.origin === "personal" && n.kind === "file").length;
  const feats = FC ? FC.features.filter(f => set.has(f.stage) && hOwn(f)).length : 0;
  return { custom, files, feats, any: custom + feats > 0 || nodes.some(n => n.origin === "personal") };
}
// "내 설정" badge: compact (chips, graph cards, rows) or with the counts (stage cards).
function hMark(ids, full) {
  if (!hOrigin()) return null;
  const m = hMine(ids);
  if (!m.any) return null;
  const parts = [m.custom ? `바꾼 값 ${m.custom}` : "", m.feats ? `내 기능 ${m.feats}` : "", m.files ? `내 파일 ${m.files}` : ""].filter(Boolean);
  const title = `내가 바꾼 것: ${parts.join(" · ") || "내 확장"}`;
  if (!full) return el("span", { class: "bd m", title, text: "내 설정" });
  return el("span", { class: "hm-mine", title }, el("span", { class: "bd m", text: "내 설정" }), parts.length ? el("span", { class: "mt", text: parts.join(" · ") }) : null);
}
// A result lands on the button that was pressed: its label swaps for a moment and swaps back (width kept), no toast.
function hFlash(b, label) {
  if (!b || !b.isConnected) return;
  const was = b.textContent;
  b.style.minWidth = `${b.offsetWidth}px`;
  motionSwap(b, () => { b.textContent = label; });
  setTimeout(() => { if (b.isConnected && b.textContent === label) motionSwap(b, () => { b.textContent = was; b.style.minWidth = ""; }); }, 1800);
}
const H_MQ = matchMedia("(max-width: 639px)");
const H_COLS = ["들어오는 곳", "게이트웨이", "어시스턴트", "세션", "서브에이전트"];
const H_TONE = { ok: "ok", busy: "pri", warn: "warn", err: "err", off: "" };
const H_STATE = { ok: "정상", busy: "작업 중", warn: "주의", err: "멈춤", off: "꺼짐" };
const H_APPLY = { live: ["바로 적용", ""], "next-turn": ["다음 메시지부터", ""], restart: ["재시작 후 적용", "warn"] };
const hNode = id => HG && HG.nodes.find(n => n.id === id);
const hSvg = (tag, attrs) => { const n = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v); return n; };

async function loadHarness(quiet) {
  if (hLoading) return;
  hLoading = true;
  try { if (!M) await loadModels(true); [HGB, FC] = await Promise.all([api("/api/harness"), api("/api/features").then(fcSplit).catch(() => FC)]); }
  catch (e) { hLoading = false; if (!quiet && current === "harness") clear($("#harness")).append(emptyNode("구성을 불러오지 못했어요")); return; }
  hLoading = false;
  if (current === "harness") { renderHarness(); hHead(); }
}

// Layered layout: flow nodes sit in the column of their longest path from an input; file and support nodes join the
// column of the node they attach to. Shared by the simple map (one stage per column) and the full graph.
function hColumns() {
  const byId = new Map(HG.nodes.map(n => [n.id, n]));
  const flow = HG.nodes.filter(n => n.group === "flow");
  const col = new Map(flow.map(n => [n.id, 0]));
  for (let i = 0; i < flow.length; i++) for (const e of HG.edges) if (col.has(e.from) && col.has(e.to)) col.set(e.to, Math.max(col.get(e.to), col.get(e.from) + 1));
  const colOf = n => { let x = n; for (let i = 0; i < 6 && x.group !== "flow"; i++) x = byId.get(x.anchor) || x; return col.get(x.id) || 0; };
  const key = n => { const a = byId.get(n.anchor); return a && a.group !== "flow" ? key(a) + 0.5 : n.order || 0; };
  return { flow, col, colOf, key, ncol: Math.max(...flow.map(n => col.get(n.id))) + 1 };
}

// Full graph: one flow node per column is centered on the middle line, files and support nodes above and below it.
function hLayout(avail) {
  const nodes = HG.nodes;
  const { flow, col, colOf, key, ncol } = hColumns();
  const cols = Array.from({ length: ncol }, () => ({ flow: [], att: [] }));
  for (const n of flow) cols[col.get(n.id)].flow.push(n);
  for (const n of nodes) if (n.group !== "flow") cols[colOf(n)].att.push(n);
  const GX = 56, HF = hFeat && !H_MQ.matches && FC ? 90 : 72, HA = hFeat && !H_MQ.matches && FC ? 78 : 60, VG = 10, HEAD = 26;
  const CW = Math.max(150, Math.min(200, Math.floor((avail - GX * (ncol - 1)) / ncol)));
  for (const c of cols) {
    c.att.sort((a, b) => key(a) - key(b));
    const up = c.flow.length === 1 ? Math.ceil(c.att.length / 2) : 0;
    c.above = c.att.slice(0, up); c.below = c.att.slice(up);
    c.aboveH = c.above.length * (HA + VG);
    c.blockH = c.flow.length * HF + (c.flow.length - 1) * VG;
  }
  const mid = Math.max(...cols.map(c => c.aboveH + c.blockH / 2));
  const rects = {};
  let bottom = 0;
  cols.forEach((c, i) => {
    let y = HEAD + mid - c.blockH / 2 - c.aboveH;
    const x = i * (CW + GX);
    for (const [list, h] of [[c.above, HA], [c.flow, HF], [c.below, HA]]) for (const n of list) { rects[n.id] = { x, y, w: CW, h, col: i }; y += h + VG; }
    bottom = Math.max(bottom, y - VG);
  });
  return { rects, cols, width: ncol * CW + (ncol - 1) * GX, height: bottom + 8, CW, GX };
}

// Edge paths: curves between columns (right side -> left side). Inside one column the helpers feed their flow node over
// a shared bus in the gutter (one line, one arrowhead); two stacked helpers are joined by a short straight arrow.
// Several curves on one side of a card are spread a few px apart so their arrowheads stay readable.
function hRoutes(L) {
  const rows = HG.edges.filter(e => L.rects[e.from] && L.rects[e.to]).map(e => {
    const a = L.rects[e.from], b = L.rects[e.to], same = a.col === b.col;
    return { e, a, b, same, sa: same || a.col < b.col ? "r" : "l", sb: same ? "r" : a.col < b.col ? "l" : "r" };
  });
  const ports = new Map();
  const add = (id, side, r, other, k) => { const key = id + side; if (!ports.has(key)) ports.set(key, []); ports.get(key).push({ r, k, y: other.y + other.h / 2 }); };
  for (const r of rows) if (!r.same) { add(r.e.from, r.sa, r, r.b, "oa"); add(r.e.to, r.sb, r, r.a, "ob"); }
  for (const list of ports.values()) { list.sort((p, q) => p.y - q.y); list.forEach((p, i) => { p.r[p.k] = Math.max(-26, Math.min(26, (i - (list.length - 1) / 2) * 8)); }); }
  for (const r of rows) {
    const y1 = r.a.y + r.a.h / 2 + (r.oa || 0), y2 = r.b.y + r.b.h / 2 + (r.ob || 0);
    if (r.same) {
      const gap = r.b.y > r.a.y ? r.b.y - (r.a.y + r.a.h) : r.a.y - (r.b.y + r.b.h);
      const cx = r.a.x + r.a.w / 2;
      if (hNode(r.e.to).group !== "flow" && gap <= 14) {
        const down = r.b.y > r.a.y;
        r.d = `M${cx} ${down ? r.a.y + r.a.h : r.a.y}V${down ? r.b.y : r.b.y + r.b.h}`; r.lx = cx; r.ly = (r.a.y + r.b.y + r.b.h) / 2;
      } else {
        const x1 = r.a.x + r.a.w, gx = x1 + 10;
        r.d = `M${x1} ${y1}H${gx}V${y2}H${x1}`; r.lx = gx; r.ly = (y1 + y2) / 2;
      }
    } else {
      const x1 = r.sa === "r" ? r.a.x + r.a.w : r.a.x, x2 = r.sb === "l" ? r.b.x : r.b.x + r.b.w;
      const dx = Math.max(24, Math.abs(x2 - x1) * 0.5) * (x2 > x1 ? 1 : -1);
      r.d = `M${x1} ${y1}C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`; r.lx = (x1 + x2) / 2; r.ly = (y1 + y2) / 2;
    }
  }
  return rows;
}

function hCard(n, mobile) {
  const sup = n.group === "support";
  const links = mobile && n.group !== "flow" ? HG.edges.filter(e => e.from === n.id).map(e => `${hNode(e.to).label}: ${e.label}`) : [];
  const b = el("button", { type: "button", class: `hm-n${sup ? " sup" : ""}${n.group === "files" ? " fl" : ""}${mobile ? " m" : ""}${hSel === n.id ? " on" : ""}${hMine(n.id).any && hOrigin() ? " mine" : ""}`, "data-id": n.id, "aria-label": `${n.label}: ${n.summary}` },
    el("span", { class: "t" }, el("span", { class: `dot ${H_TONE[n.status] || ""}` }), n.group === "files" ? icon("file") : null, el("span", { class: "l", text: n.label }), hMark(n.id)),
    el("span", { class: "s", text: n.summary }),
    fcBadges(n.id),
    links.length ? el("span", { class: "lk", text: `→ ${links.join(" · ")}` }) : null);
  b.addEventListener("click", () => openHSheet(n.id));
  b.addEventListener("mouseenter", () => hHot(n.id));
  b.addEventListener("mouseleave", () => hHot(hSel));
  b.addEventListener("focus", () => hHot(n.id));
  b.addEventListener("blur", () => hHot(hSel));
  hNodeEls.set(n.id, b);
  return b;
}

function hHot(id) {
  if (hOv) { hOverlay(id); return; }
  for (const r of hEdgeRefs) {
    const on = !!id && (r.e.from === id || r.e.to === id);
    r.path.classList.toggle("hot", on); r.label.classList.toggle("hot", on);
    r.path.setAttribute("marker-end", on ? "url(#hm-ah-hot)" : "url(#hm-ah)");
  }
}

function hUse() {
  const p = hPj();
  if (hProjId && HGB && !p) { hProjId = ""; if (current === "harness") routeReplace("harness"); }
  HG = p ? { ...HGB, origin_view: false, nodes: p.map.nodes, edges: p.map.edges } : HGB;
  if (hSel && !hNode(hSel)) { closeHSheet(); hSel = ""; }
}

function renderHarness() {
  const box = $("#harness");
  hUse();
  hNodeEls = new Map(); hEdgeRefs = []; hGeo = new Map(); hOv = null;
  if (!HG) { clear(box).append(emptyNode("불러오는 중…")); return; }
  const mobile = H_MQ.matches, pj = hPj();
  const onlySeg = hOrigin() ? el("div", { class: "seg", role: "group", "aria-label": "보기 범위" }, ...[[false, "전체", "기본과 내가 바꾼 것을 모두 보여줘요"], [true, `커스텀 ${hCustomCount()}`, "같은 단계 그대로, 내가 바꾼 것만 걸러 보여줘요"]].map(([v, t, tip]) => {
    const b = el("button", { type: "button", class: hOnly === v ? "on" : "", "aria-pressed": String(hOnly === v), title: tip, text: t });
    b.addEventListener("click", () => { hOnly = v; try { localStorage.setItem("dotz-honly", v ? "1" : "0"); } catch {} renderHarness(); });
    return b;
  })) : null;
  const bar = el("div", { class: "hm-bar" },
    pj ? hProjHead(pj) : null,
    el("div", { class: "sup", text: pj ? `이 프로젝트만의 지도예요. 전역 값과 다른 설정에는 '바꿈' 표시가 붙어요.` : hDetail ? "점선 카드는 곁에서 돕는 시스템이에요." : `큰 카드가 메시지가 흐르는 길이에요. 작은 칩은 함께 실행되는 시스템·파일이에요.` }),
    onlySeg,
    el("button", { class: "btn tonal sm", type: "button", "aria-pressed": String(hDetail), title: "모든 시스템과 연결선을 한 화면에 그려요", onclick: () => { hDetail = !hDetail; try { localStorage.setItem("dotz-hdetail", hDetail ? "1" : "0"); } catch {} renderHarness(); } }, "자세히"),
    FC && !pj ? el("button", { class: "btn tonal sm", type: "button", "aria-pressed": String(hFeat), title: "각 카드에 강제(실선)·권고(점선) 기능 수를 붙여요", onclick: () => { hFeat = !hFeat; try { localStorage.setItem("dotz-hfeat", hFeat ? "1" : "0"); } catch {} renderHarness(); } }, "기능 보기") : null,
    el("button", { class: "btn tonal sm", type: "button", "data-hm-refresh": "", title: "새로고침", "aria-label": "새로고침", onclick: ev => busy(ev.currentTarget, async () => { await loadHarness(); }) }, icon("refresh")),
    hOrigin() ? el("div", { class: "sup hm-legend" }, el("span", { class: "bd m", text: "내 설정" }), `내가 바꾼 값·파일·기능이에요. 표시가 없는 것은 기본값이에요 (${shortPath(hData())}).`) : null);
  const parts = [bar];
  const keep = box.querySelector(".hm-scroll");
  const left = keep ? keep.scrollLeft : 0;
  parts.push(hOnlyOn() ? hCustomView() : !hDetail ? hSimple() : mobile ? hFlowList() : hCanvas($("#views").clientWidth - 48));
  if (!hMapBox || hMapBox.parentNode !== box) { clear(box); hMapBox = el("div"); hProjBox = el("div", { class: "pj" }); hFcBox = el("div", { class: "fc" }); box.append(hMapBox, hProjBox, hFcBox); fcSig = ""; }
  clear(hMapBox).append(...parts);
  clear(hProjBox).hidden = !!pj;
  if (!pj) hProjBox.append(...hProjBand());
  const sc = box.querySelector(".hm-scroll");
  if (sc) sc.scrollLeft = left;
  hHot(hSel);
  if (pj) { clear(hFcBox); fcSig = ""; } else renderFeatures();
}
