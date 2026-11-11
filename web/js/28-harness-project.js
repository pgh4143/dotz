/* ---------- 구성: 프로젝트 (작업 채널·홈 채널에 묶인 레인마다 한 장; data: /api/harness 의 projects) ---------- */
const hPj = () => (HGB && hProjId && (HGB.projects || []).find(p => p.id === hProjId)) || null;
const hProjWhere = (p, full) => `${(p.channels[0] || {}).name || p.name} · ${full ? p.cwd : shortPath(p.cwd)}`;
const pjSize = b => (b < 1024 ? `${b}B` : `${(b / 1024).toFixed(1)}KB`);
const pjChain = c => (c.length ? c.map(e => [modelName(fbBase(e.model)) + (e.key_file ? " (API 키)" : ""), e.when ? FB_WHEN[e.when] : "", e.cap ? fbCapText(e.cap) : "", e.revert ? "리셋되면 복귀" : ""].filter(Boolean).join(" · ")).join(" → ") : "없음");
const PJ_ROWS = [["모델", "model", modelName], ["강도", "effort", thinkKo], ["서브에이전트 모델", "worker_model", modelName], ["서브에이전트 강도", "worker_effort", thinkKo], ["런타임", "runtime", v => v || "–"], ["폴백", "fallback", pjChain], ["서브에이전트 폴백", "worker_fallback", pjChain]];

// One field: the project's value against the global one. A differing value is emphasised like the 내 설정 marker (바뀜 badge,
// --mine) and shows global → project; an equal one is muted with "전역 기본".
function pjField(label, f, fmt) {
  const diff = f.source === "project";
  return el("div", { class: `pj-f${diff ? " diff" : ""}` }, el("span", { class: "k", text: label }),
    el("span", { class: "v" }, ...(diff
      ? [el("span", { class: "bd m", text: "바뀜" }), el("s", { class: "was", title: "전역 기본", text: fmt(f.global) }), el("span", { class: "ar", text: "→" }), el("b", { text: fmt(f.value) })]
      : [el("span", { class: "dim", text: fmt(f.value) }), el("span", { class: "pj-g", text: "전역 기본" })])));
}

function hProjCard(p) {
  const tone = statusTone(p.status), s = p.setup;
  const feat = [p.features.length ? `기능 ${p.features.length}: ${p.features.slice(0, 3).map(f => f.name).join(", ")}${p.features.length > 3 ? " …" : ""}` : "", p.deny.length ? `차단 규칙 ${p.deny.length}줄` : ""].filter(Boolean).join(" · ");
  const b = el("div", { class: `pj-card${p.overrides ? " diff" : ""}`, role: "button", tabindex: "0", "aria-label": `${p.name} 프로젝트 지도 열기` },
    el("div", { class: "pj-top" }, el("span", { class: `dot ${tone}` }), el("span", { class: "pj-nm", text: p.name }), el("span", { class: `tag ${tone}`, text: p.status_text }),
      p.overrides ? el("span", { class: "bd m", title: "전역 기본과 다른 값의 수", text: `전역과 다름 ${p.overrides}` }) : el("span", { class: "pj-g", text: "전부 전역 기본" })),
    el("div", { class: "pj-chs" }, ...p.channels.map(c => el("span", { class: "pj-tg", title: `${c.kind_text}: ${c.name}` }, `#${c.name}`, el("span", { class: "kd", text: c.kind_text })))),
    pathCopy(p.cwd, "pj-cwd"),
    el("div", { class: "pj-fs" }, ...PJ_ROWS.map(([label, key, fmt]) => pjField(label, p.fields[key], fmt))),
    el("div", { class: "pj-sc" }, el("div", { class: "cl", text: "지침 파일" }),
      p.files.length ? el("div", { class: "pj-chs" }, ...p.files.map(f => el("span", { class: "pj-tg", title: f.dir ? f.name : `${f.name} · ${num(f.bytes)}바이트 · ${kstStamp(f.modified)} 수정${f.heading ? ` · ${f.heading}` : ""}` }, f.name, f.dir ? null : el("span", { class: "kd", text: pjSize(f.bytes) })))) : el("div", { class: "tx dim", text: "없음" })),
    el("div", { class: "pj-sc" }, el("div", { class: "cl", text: "채널 설정" }),
      s ? [el("div", { class: "tx", text: s.purpose }), el("div", { class: "tx dim", text: `로그인 ${s.logins.length}${s.logins.length ? ` (${s.logins.map(l => l.name).join(", ")})` : ""} · 모니터링 ${s.monitors.length}${s.standing ? ` · 상시 처리: ${s.standing}` : ""}` })] : el("div", { class: "tx dim", text: "설정 없음" })),
    el("div", { class: "pj-sc" }, el("div", { class: "cl", text: "이 프로젝트에만 적용" }), el("div", { class: `tx${feat ? "" : " dim"}`, text: feat || "없음" })));
  b.addEventListener("click", () => hOpenProject(p.id));
  b.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); hOpenProject(p.id); } });
  return b;
}

function hProjBand() {
  const list = HGB.projects || [];
  const head = el("div", { class: "pj-hd" }, el("span", { class: "t", text: `프로젝트 · ${list.length}` }),
    el("span", { class: "sup", text: list.length ? "작업 채널·홈 채널에 묶인 세션이에요." : "작업 채널이나 홈 채널에 묶인 세션이 아직 없어요." }),
    list.length ? el("span", { class: "pj-lg" }, el("span", { class: "bd m", text: "바뀜" }), "전역과 다른 값", el("span", { class: "pj-g", text: "전역 기본" }), "전역 그대로") : null);
  return list.length ? [head, el("div", { class: "pj-row" }, ...list.map(hProjCard))] : [head];
}

function hProjHead(p) {
  const back = el("button", { class: "btn tonal sm", type: "button", onclick: () => hOpenProject("") }, icon("back"), "전체 구성");
  return el("div", { class: "pj-bk" }, back,
    el("span", { class: "pj-title" }, el("span", { class: `dot ${statusTone(p.status)}` }), p.name, ...p.channels.filter(c => c.kind !== "thread").map(c => el("span", { class: "pj-tg" }, `#${c.name}`, el("span", { class: "kd", text: c.kind_text })))),
    hScopeTag("project", hProjWhere(p), false, hProjWhere(p, true)));
}

// Opens a project's own map (or the main map with ""); the hash `#harness/project/<id>` restores it on reload.
async function hOpenProject(id) {
  if (hDirty && hDirty() && !await ask("저장하지 않은 변경", "열려 있는 항목에 저장하지 않은 변경이 있어요. 버리고 넘어갈까요?", "버리기", true)) return;
  closeHSheet(); hSel = "";
  hProjId = id;
  routeReplace(id ? `harness/project/${enc(id)}` : "harness");
  renderHarness();
  $("#views").scrollTop = 0;
}

// Free-text request about one card of the project map; always carries the 범위: 프로젝트 line.
function hProjAsk(p, n, drafts) {
  const where = hProjWhere(p, true);
  const ta = el("textarea", { class: "fi hs-ta", rows: 3, spellcheck: "false", placeholder: "이 프로젝트에 바라는 변경을 적어 주세요", "aria-label": "프로젝트 수정 요청" });
  const send = el("button", { class: "btn tonal sm", type: "button", disabled: true }, `${botName}에게 수정 요청`);
  const note = el("div", { class: "note" });
  ta.addEventListener("input", () => { send.disabled = !ta.value.trim(); });
  send.onclick = async () => {
    send.disabled = true;
    try { const at = await hRequest(`${n.label}: ${ta.value.trim()}`, hScope("project", where)); note.className = "note ok"; note.textContent = `요청 보냄 · ${at}`; ta.value = ""; hFlash(send, "요청했어요"); }
    catch (e) { note.className = "note err"; note.textContent = e.message; toast(e.message, true); send.disabled = false; }
  };
  drafts.push(() => ta.value.trim() !== "");
  return el("div", { class: "hs-set" }, ta, el("div", { class: "btns hs-act" }, hScopeTag("project", hProjWhere(p), false, where), send), note);
}

function hCanvas(avail) {
  const L = hLayout(avail || 1000);
  const canvas = el("div", { class: "hm-canvas", style: `width:${L.width}px;height:${L.height}px` });
  const svg = hSvg("svg", { class: "hm-svg", width: L.width, height: L.height, viewBox: `0 0 ${L.width} ${L.height}` });
  const defs = hSvg("defs");
  for (const [id, cls] of [["hm-ah", "hm-ah"], ["hm-ah-hot", "hm-ah hot"]]) {
    const m = hSvg("marker", { id, viewBox: "0 0 8 8", refX: "7", refY: "4", markerWidth: "7", markerHeight: "7", orient: "auto" });
    m.append(hSvg("path", { d: "M0 0L8 4L0 8z", class: cls })); defs.append(m);
  }
  svg.append(defs);
  const labels = hSvg("g");
  for (const r of hRoutes(L)) {
    const sup = hNode(r.e.from).group !== "flow" || hNode(r.e.to).group !== "flow";
    const path = hSvg("path", { d: r.d, class: `hm-edge${sup ? " sup" : ""}`, "marker-end": "url(#hm-ah)" });
    const tip = hSvg("title");
    tip.textContent = `${hNode(r.e.from).label} → ${hNode(r.e.to).label}: ${r.e.label}`;
    path.append(tip);
    const label = hSvg("text", { x: r.lx, y: r.ly + 3.5, class: "hm-lb", "text-anchor": "middle" });
    label.textContent = r.e.label;
    svg.append(path); labels.append(label);
    hEdgeRefs.push({ e: r.e, path, label });
  }
  svg.append(labels);
  canvas.append(svg);
  L.cols.forEach((c, i) => canvas.append(el("div", { class: "hm-ch", style: `left:${i * (L.CW + L.GX)}px;width:${L.CW}px`, text: H_COLS[i] || "" })));
  for (const n of HG.nodes) { const r = L.rects[n.id]; const b = hCard(n, false); b.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`; canvas.append(b); }
  return el("div", { class: "hm-scroll" }, canvas);
}

// Phone: the same nodes as a vertical flow, one step per column, with the edge labels as the arrows between steps.
function hFlowList() {
  const L = hLayout(1000);
  const wrap = el("div", { class: "hm-flow" });
  L.cols.forEach((c, i) => {
    wrap.append(el("div", { class: "sec", text: H_COLS[i] || "" }));
    const stack = el("div", { class: "hm-stack" });
    for (const n of [...c.flow, ...c.att]) stack.append(hCard(n, true));
    wrap.append(stack);
    const next = L.cols[i + 1];
    if (next) {
      const from = new Set(c.flow.map(n => n.id)), to = new Set(next.flow.map(n => n.id));
      const labels = [...new Set(HG.edges.filter(e => from.has(e.from) && to.has(e.to)).map(e => e.label))];
      wrap.append(el("div", { class: "hm-down" }, icon("down"), el("span", { text: labels.slice(0, 3).join(" · ") })));
    }
  });
  return wrap;
}

// Simple map: the main line only. One card per stage (the inputs share one card of rows); the prompt files and support
// systems of a stage are chips on its card. A support node's edges are not drawn until a chip or card is hovered/focused.
const H_MANY = "들어온 글";
const hShort = n => n.label.replace(/\s*\(.*\)$/, "");
const hSick = n => n.status === "warn" || n.status === "err";

function hStages() {
  const { flow, col, colOf, key, ncol } = hColumns();
  const st = Array.from({ length: ncol }, (_, i) => ({ label: H_COLS[i] || "", main: [], chips: [] }));
  for (const n of flow) st[col.get(n.id)].main.push(n);
  for (const n of HG.nodes) if (n.group !== "flow") st[colOf(n)].chips.push(n);
  for (const s of st) s.chips.sort((a, b) => key(a) - key(b));
  return st;
}

function hStageLabel(a, b) {
  const from = new Set(a.main.map(n => n.id)), to = new Set(b.main.map(n => n.id));
  const labels = [...new Set(HG.edges.filter(e => from.has(e.from) && to.has(e.to)).map(e => e.label))];
  return labels.length > 1 ? H_MANY : labels[0] || "";
}

function hChip(n) {
  const b = el("button", { type: "button", class: `hm-chip${hSick(n) ? ` ${n.status}` : n.status === "off" ? " off" : ""}${hOrigin() && hMine(n.id).any ? " mine" : ""}`, "data-id": n.id, title: `${n.label}: ${n.summary}`, "aria-label": `${n.label}: ${n.summary}` },
    el("span", { class: `dot ${H_TONE[n.status] || ""}` }), el("span", { class: "l", text: hShort(n) }), hMark(n.id), fcBadges(n.id, true));
  hNodeEls.set(n.id, b); hGeo.set(n.id, b);
  return b;
}

// Stage card frame shared by 전체 and 커스텀: the connector from the previous stage (a chevron in the gap, drawn by CSS for the
// breakpoint) and a "<previous stage>에서 · <edge label>" line, then a header with the step number, title and a count chip.
function hFrom(stages, i) {
  if (!i) return [el("div", { class: "hm-from", text: "여기서 시작해요" })];
  const p = stages[i - 1], lb = hStageLabel(p, stages[i]), from = p.main.length === 1 ? hShort(p.main[0]) : p.label;
  return [el("span", { class: "hm-ar", "aria-hidden": "true" }, icon("chev")), el("div", { class: "hm-from", title: `${from}에서${lb ? ` · ${lb}` : ""}` }, `${from}에서`, lb ? el("b", { text: lb }) : null)];
}
const hNo = i => el("span", { class: "hm-no", "aria-hidden": "true", text: String(i + 1) });
const hCount = (n, title) => (n ? el("span", { class: "tag hm-ct", title, text: `항목 ${n}` }) : null);
// A source path as people read it (like custom.js shortPath): the last two names, the full path in the title.
const hPath = p => { const parts = String(p).split("/").filter(Boolean); return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : String(p); };

function hStageCard(s, i, stages) {
  const one = s.main.length === 1 ? s.main[0] : null;
  const bad = (one ? s.chips : s.main).filter(hSick);
  const ids = [...s.main, ...s.chips].map(n => n.id);
  const kids = [
    el("span", { class: "t" },
      hNo(i),
      one ? el("span", { class: `dot ${H_TONE[one.status] || ""}` }) : null,
      el("span", { class: "l", text: one ? one.label : s.label }),
      one ? null : hCount(s.main.length + s.chips.length, "이 단계의 항목 수"),   // a one-item stage says its extras below (함께 실행되는 항목 · N)
      one && one.status !== "ok" ? el("span", { class: `tag ${H_TONE[one.status] || ""}`, text: H_STATE[one.status] || "" }) : null,
      bad.length ? el("span", { class: `tag ${bad.some(n => n.status === "err") ? "err" : "warn"}`, title: bad.map(n => n.label).join(", "), text: `주의 ${bad.length}` }) : null),
    one ? el("span", { class: "s", text: one.summary }) : null,
    fcBadges(ids), hMark(ids, true)];
  const head = one ? el("button", { type: "button", class: "hm-sh", "aria-label": `${one.label}: ${one.summary}` }, ...kids) : el("div", { class: "hm-sh" }, ...kids);
  const card = el("div", { class: `hm-st${one ? " one" : ""}${hOrigin() && hMine(ids).any ? " mine" : ""}`, "data-id": one ? one.id : null }, ...hFrom(stages, i), head);
  const list = el("div", { class: "hm-list" });
  if (one) { hNodeEls.set(one.id, card); hGeo.set(one.id, head); }
  else list.append(el("div", { class: "hm-rows" }, ...s.main.map(n => {
    const r = el("button", { type: "button", class: "hm-row", "data-id": n.id, title: `${n.label}: ${n.summary}`, "aria-label": `${n.label}: ${n.summary}` },
      el("span", { class: `dot ${H_TONE[n.status] || ""}` }), el("span", { class: "tx" }, el("span", { class: "l", text: n.label }), el("span", { class: "s", text: n.summary })), hMark(n.id));
    hNodeEls.set(n.id, r); hGeo.set(n.id, r);
    return r;
  })));
  if (s.chips.length) list.append(el("div", { class: "hm-with" }, el("div", { class: "wl", text: `함께 실행되는 항목 · ${s.chips.length}` }), el("div", { class: "hm-chips" }, ...s.chips.map(hChip))));
  if (list.firstChild) card.append(list);
  return card;
}

function hSimple() {
  const stages = hStages(), wrap = el("div", { class: "hm-simple" });
  stages.forEach((s, i) => wrap.append(hStageCard(s, i, stages)));
  const svg = hSvg("svg", { class: "hm-ov", "aria-hidden": "true" });
  const m = hSvg("marker", { id: "hm-ov-ah", viewBox: "0 0 8 8", refX: "7", refY: "4", markerWidth: "7", markerHeight: "7", orient: "auto" });
  m.append(hSvg("path", { d: "M0 0L8 4L0 8z", class: "hm-ah hot" }));
  svg.append(hSvg("defs")); svg.firstChild.append(m);
  hOv = svg; wrap.append(svg);
  const idOf = ev => { const t = ev.target.closest("[data-id]"); return t ? t.dataset.id : ""; };
  wrap.addEventListener("click", ev => { const id = idOf(ev); if (id) openHSheet(id); });
  wrap.addEventListener("mouseover", ev => hHot(idOf(ev) || hSel));
  wrap.addEventListener("mouseleave", () => hHot(hSel));
  wrap.addEventListener("focusin", ev => { const id = idOf(ev); if (id) hHot(id); });
  wrap.addEventListener("focusout", () => hHot(hSel));
  return wrap;
}

// 커스텀: the same stage cards, order and arrows as 전체, each card filtered to what this user changed (personal
// files/extensions, settings that differ from their default, personal features) with its count; untouched stages say so.
const H_CV_CAP = 4;
function hCustomParts(stages) {
  const where = new Map();
  stages.forEach((s, i) => { for (const n of [...s.main, ...s.chips]) where.set(n.id, i); });
  const feats = FC ? FC.features.filter(f => hOwn(f) && where.has(f.stage)) : [];
  const lines = FC ? FC.features.filter(f => f.origin === "personal" && FC_LINES[f.form]) : [];
  return { lines, at: stages.map((s, i) => {
    const nodes = [...s.main, ...s.chips];
    const mine = nodes.filter(n => n.origin === "personal"), sets = nodes.flatMap(n => (n.custom || []).map(c => ({ n, c }))), fl = feats.filter(f => where.get(f.stage) === i);
    return { mine, sets, fl, n: mine.length + sets.length + fl.length };
  }) };
}
const hCustomCount = () => { if (!HG || !hOrigin()) return 0; return hCustomParts(hStages()).at.reduce((a, x) => a + x.n, 0); };
function hCustomCard(s, i, cv, stages) {
  const { mine, sets, fl, n } = cv.at[i], one = s.main.length === 1 ? s.main[0] : null;
  const card = el("div", { class: `hm-st${n ? " mine" : " none"}` }, ...hFrom(stages, i),
    el("div", { class: "hm-sh" }, el("span", { class: "t" }, hNo(i), el("span", { class: "l", text: one ? one.label : s.label }), n ? el("span", { class: "bd m hm-ct", title: "이 단계에서 바꾼 것", text: String(n) }) : null)));
  if (!n) { card.append(el("div", { class: "hm-none", text: "기본 그대로" })); return card; }
  const row = (onclick, top, sub, mono) => {
    const b = el("button", { type: "button", class: "hm-cr" }, el("span", { class: "m1" }, ...top), sub ? el("span", { class: `m2${mono ? " mono" : ""}`, text: mono ? hPath(sub) : sub, title: sub }) : null);
    b.addEventListener("click", onclick);
    return b;
  };
  // A list long enough for 더 보기 keeps one fixed height, so opening or folding it scrolls inside the card instead of resizing it.
  const sec = el("div", { class: `hm-cs hm-list${fl.length > H_CV_CAP ? " fix" : ""}` });
  if (mine.length) {
    sec.append(el("div", { class: "cl", text: `내 파일·확장 · ${mine.length}` }));
    for (const m of mine) {
      const own = cv.lines.filter(f => f.stage === m.id), rules = own.filter(f => f.form === "글 지시").length, deny = own.filter(f => f.form === "차단 명령").length;
      const meta = m.file ? [m.fileMeta ? `${num(m.fileMeta.bytes)}자 · ${kstStamp(m.fileMeta.modified)} 수정` : "아직 없는 파일", rules ? `글 ${rules}줄` : "", deny ? `차단 ${deny}줄` : ""].filter(Boolean).join(" · ") : m.summary;
      sec.append(row(() => openHSheet(m.id), [hShort(m)], meta));
    }
  }
  if (sets.length) {
    sec.append(el("div", { class: "cl", text: `바꾼 설정 · ${sets.length}` }));
    for (const { n: m, c } of sets) sec.append(row(() => openHSheet(m.id), [`${c.label}: ${hFmt(c.value, c.unit)}`], `기본 ${hFmt(c.default, c.unit)} · ${hShort(m)}`));
  }
  if (fl.length) {
    const all = hCvOpen.has(i), shown = all ? fl : fl.slice(0, H_CV_CAP);
    sec.append(el("div", { class: "cl", text: `내 기능 · ${fl.length}` }));
    for (const f of shown) sec.append(row(() => fcOpenFeature(f), [monClean(f.name, f.form), el("span", { class: "tag", text: f.form }), f.enabled ? null : el("span", { class: "tag", text: "꺼짐" })], f.source.label, true));
    if (fl.length > H_CV_CAP) {
      const more = el("button", { type: "button", class: "btn text hm-more", text: all ? "접기" : `${fl.length - H_CV_CAP}개 더 보기` });
      more.addEventListener("click", () => {
        if (all) hCvOpen.delete(i); else hCvOpen.add(i);
        const top = sec.scrollTop;
        renderHarness();
        const again = $("#harness").querySelectorAll(".hm-simple.only > .hm-st")[i];
        const box = again && again.querySelector(".hm-cs");
        if (box) box.scrollTop = all ? 0 : top;
      });
      sec.append(more);
    }
  }
  card.append(sec);
  return card;
}
function hCustomView() {
  const stages = hStages(), cv = hCustomParts(stages), wrap = el("div", { class: "hm-simple only" });
  stages.forEach((s, i) => wrap.append(hCustomCard(s, i, cv, stages)));
  return wrap;
}

// Lights up what a node connects to: the other ends get an outline, and (pointer devices) its edges are drawn over the
// cards with their labels. Called with the hovered/focused node, or the selected one when nothing is hovered.
function hOverlay(id) {
  const svg = hOv;
  if ((svg.dataset.hot || "") === (id || "")) return;
  svg.dataset.hot = id || "";
  for (const c of [...svg.querySelectorAll("path.hm-edge, text")]) c.remove();
  for (const b of hNodeEls.values()) b.classList.remove("rel");
  if (!id) return;
  const box = svg.parentNode.getBoundingClientRect();
  const at = e => { const r = e.getBoundingClientRect(); return { l: r.left - box.left, t: r.top - box.top, r: r.right - box.left, b: r.bottom - box.top }; };
  for (const e of HG.edges) {
    if (e.from !== id && e.to !== id) continue;
    const other = hNodeEls.get(e.from === id ? e.to : e.from);
    if (other) other.classList.add("rel");
    const ea = hGeo.get(e.from), eb = hGeo.get(e.to);
    if (H_MQ.matches || !ea || !eb) continue;
    const a = at(ea), b = at(eb);
    let x1, y1, x2, y2, d;
    if (a.r < b.l - 6 || b.r < a.l - 6) {
      const fwd = a.r < b.l - 6;
      x1 = fwd ? a.r : a.l; x2 = fwd ? b.l : b.r; y1 = (a.t + a.b) / 2; y2 = (b.t + b.b) / 2;
      const dx = Math.max(24, Math.abs(x2 - x1) / 2) * (x2 > x1 ? 1 : -1);
      d = `M${x1} ${y1}C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`;
    } else {
      const down = a.t < b.t;
      x1 = (a.l + a.r) / 2; x2 = (b.l + b.r) / 2; y1 = down ? a.b : a.t; y2 = down ? b.t : b.b;
      const dy = Math.max(16, Math.abs(y2 - y1) / 2) * (down ? 1 : -1);
      d = `M${x1} ${y1}C${x1} ${y1 + dy} ${x2} ${y2 - dy} ${x2} ${y2}`;
    }
    svg.append(hSvg("path", { d, class: "hm-edge hot", "marker-end": "url(#hm-ov-ah)" }));
    if (a.r >= b.l - 6 && b.r >= a.l - 6) continue;   // inside one card: the line speaks for itself (the sheet's 이어진 곳 has the label)
    const t = hSvg("text", { x: (x1 + x2) / 2, y: (y1 + y2) / 2 + 3.5, class: "hm-lb hot", "text-anchor": "middle" });
    t.textContent = e.label;
    svg.append(t);
  }
}

function paintHSel() { for (const [id, b] of hNodeEls) b.classList.toggle("on", id === hSel); hHot(hSel); }
// The side sheet covers the right part of the map; keep the picked card scrolled into the visible left part.
function hReveal(id) {
  const sc = $(".hm-scroll"), b = hNodeEls.get(id);
  if (!sc || !b) return;
  const s = sc.getBoundingClientRect(), r = b.getBoundingClientRect();
  if (r.left - 16 < s.left) sc.scrollLeft -= s.left - (r.left - 16);
  else if (r.right + 16 > s.right) sc.scrollLeft += r.right + 16 - s.right;
}

let hSheetOv = null;
function closeHSheet() {
  const s = $("#hsheet");
  if (!s || s.hidden) return;
  const ov = hSheetOv; hSheetOv = null; ovDone(ov);
  s.hidden = true; hSel = ""; hDirty = null; hGoto = null; $("#harness").classList.remove("hs-open"); paintHSel();
}

function hHead() {
  const n = hNode(hSel);
  if (!n || $("#hsheet").hidden) return;
  $("#hs-name").textContent = n.label; $("#hs-sub").textContent = n.summary;
  const t = $("#hs-tag"); t.className = `tag ${H_TONE[n.status] || ""}`; t.textContent = H_STATE[n.status] || "";
}

async function openHSheet(id, focus = {}) {
  if (id === hSel && focus.line && hGoto) { hGoto(focus.line); return; }
  if (id !== hSel && hDirty && hDirty() && !await ask("저장하지 않은 변경", "열려 있는 항목에 저장하지 않은 변경이 있어요. 버리고 넘어갈까요?", "버리기", true)) return;
  const n = hNode(id);
  if (!n) return;
  hSel = id; hGoto = null; paintHSel();
  const drafts = [];
  hDirty = () => drafts.some(f => f());
  $("#hsheet").hidden = false;
  if (!hSheetOv) hSheetOv = ovOpen(closeHSheet);
  $("#harness").classList.add("hs-open");
  hReveal(id);
  hHead();
  const body = clear($("#hs-body"));
  body.scrollTop = 0;
  const more = n.desc.startsWith(n.summary) ? n.desc.slice(n.summary.length).trim() : n.desc;   // the head already says the summary
  if (more) body.append(el("p", { class: "hs-desc", text: more }));
  if (hOrigin()) body.append(hOriginLine(n));
  if (n.facts.length) body.append(el("div", { class: "sec", text: "지금 상태" }), el("div", { class: "hs-facts" }, ...n.facts.map(f => el("div", { class: "hs-fact" }, el("span", { class: "k", text: f.label }), el("span", { class: "v", text: f.value })))));
  body.append(...(hPj() ? [] : fcSheetSection(n, focus.feature)));
  if (n.settings.some(s => s.editable) || n.fileEditable) body.append(el("div", { class: "note", text: `수정 요청은 ${botName}에게 가요.` }));
  if (n.settings.length) body.append(el("div", { class: "sec", text: "설정" }), ...n.settings.map(s => hSetting(s, drafts)));
  if (n.file) body.append(el("div", { class: "sec", text: `파일 · ${n.file.split("/").pop()}` }), hFileEditor(n, drafts, focus.line));
  const near = [...HG.edges.filter(e => e.to === id).map(e => ({ id: e.from, t: `← ${hNode(e.from).label}`, l: e.label })), ...HG.edges.filter(e => e.from === id).map(e => ({ id: e.to, t: `${hNode(e.to).label} →`, l: e.label }))];
  if (near.length) body.append(el("div", { class: "sec", text: "이어진 곳" }), el("div", { class: "hs-chips" }, ...near.map(x => el("button", { class: "chip", type: "button", title: x.l, onclick: () => openHSheet(x.id) }, el("span", { class: "tx", text: `${x.t} · ${x.l}` })))));
  if (hPj()) body.append(el("div", { class: "sec", text: "이 카드에 대한 요청" }), hProjAsk(hPj(), n, drafts));
  if (focus.feature && !focus.line) { const row = body.querySelector(`[data-fid="${CSS.escape(focus.feature)}"]`); if (row) row.scrollIntoView({ block: "center" }); }
}

function hModelItems(cur) {
  const avail = (M && (M.pickable || M.available)) || [];
  const items = [];
  if (cur && !avail.some(a => a.selector === cur)) items.push({ header: "현재" }, { value: cur, label: modelName(cur) });
  items.push(...modelPickItems(avail, cur));
  return items;
}

// The 구성 tab writes nothing itself: every change is a message to the main orchestrator (the same POST the chat composer
// sends to MAIN, default mode), which applies it.
const hNow = () => new Date().toLocaleTimeString("ko-KR", { ...KST, hour: "2-digit", minute: "2-digit" });
async function hRequest(text, scope) {
  await api("/api/message", "POST", { text: `[구성 탭 수정 요청] ${scope ? `${scope}\n` : ""}${text}` });
  return hNow();
}
// Which side a node is on, shown at the top of its sheet (only with ui.origin_view).
function hOriginLine(n) {
  const mine = n.origin === "personal";
  const where = n.file ? `${hData()}/${n.file}` : mine && FC && FC.harness ? FC.harness.dirs.join(", ") : "";
  const tags = [el("span", { class: `tag${mine ? " m" : ""}`, text: mine ? "개인" : "배포" })];
  const text = mine ? `내 ${n.file ? "파일" : "확장"}이에요${where ? ` (${shortPath(where)})` : ""}` : `기본으로 함께 오는 거예요${n.file ? " (저장소 파일 · 읽기 전용)" : ""}`;
  const extra = !mine && n.custom && n.custom.length ? ` · 설정값 ${n.custom.length}개는 내가 바꿨어요 (${shortPath(`${hData()}/config.json`)})` : !mine && n.settings.some(s => s.editable) ? ` · 설정값은 ${shortPath(`${hData()}/config.json`)}에 저장돼요` : "";
  return el("div", { class: "hs-or" }, ...tags, el("span", { text: text + extra }));
}
// 구성's model and effort settings (config.json models.<target>) open the 모델 · 폴백 screen instead of a change request.
const H_MODEL_TARGET = { "orchestrator.model": "orchestrator", "orchestrator.thinking": "orchestrator", "lanes.model": "lanes", "lanes.thinking": "lanes", "lanes.worker_model": "workers", "lanes.worker_effort": "workers" };
const hVal = v => (typeof v === "string" ? JSON.stringify(v) : String(v));

// One setting: an editor matching its type, an apply-timing tag and a request button (nothing is written here).
function hSetting(s, drafts) {
  const box = el("div", { class: "hs-set", title: s.source });
  const pj = hPj(), sk = pj ? "project" : "personal", sw = pj ? hProjWhere(pj) : s.source;
  const [applyText, applyTone] = H_APPLY[s.applies] || ["", ""];
  const tag = el("span", { class: `tag ${s.pending ? "warn" : applyTone}`, text: s.pending ? "재시작 대기 중" : applyText });
  const note = el("div", { class: "note", text: s.hint || "" });
  const mkey = !pj && (s.type === "model" || s.type === "effort") && H_MODEL_TARGET[s.key];
  if (mkey) {
    box.append(el("div", { class: "top" }, el("span", { class: "lb", text: s.label }), el("span", { class: `tag ${applyTone}`, text: applyText })),
      el("div", { class: "ctl" }, el("span", { class: "hs-ro", text: s.type === "model" ? modelName(s.value) : String(s.value) }), el("button", { class: "btn tonal sm", type: "button", onclick: () => openModels(mkey) }, "모델 · 폴백에서 바꾸기")));
    return box;
  }
  if (!s.editable) {
    box.append(el("div", { class: "top" }, el("span", { class: "lb", text: s.label }), el("span", { class: "tag", text: "읽기 전용" })), el("div", { class: "hs-ro", text: String(s.value) }), s.hint ? note : el("div", { class: "note", text: "보안·연결 정보라 화면에서 바꿀 수 없어요." }));
    return box;
  }
  const cur = s.value;
  let draft = s.value, sent;
  const ctl = el("div", { class: "ctl" });
  const send = el("button", { class: "btn tonal sm", type: "button", disabled: true }, `${botName}에게 수정 요청`);
  const reset = el("button", { class: "btn text sm", type: "button", hidden: true }, "기본값");
  const dirty = () => draft !== cur && !(typeof draft === "number" && Number.isNaN(draft));
  const asked = () => sent !== undefined && Object.is(sent, draft);
  const mark = () => {
    send.disabled = !dirty() || asked();
    reset.hidden = s.default === undefined || s.type === "model" || s.type === "effort" || draft === s.default;
    if (!asked() && note.classList.contains("ok")) { note.className = "note"; note.textContent = s.hint || ""; }
  };
  const paint = () => {
    clear(ctl);
    if (s.type === "bool") {
      const sw = el("button", { type: "button", class: "hs-sw", role: "switch", "aria-checked": String(!!draft), "aria-label": s.label });
      sw.onclick = () => { draft = !draft; paint(); motionSwap(ctl.lastElementChild, () => {}); };
      ctl.append(sw, el("span", { class: "sup", text: draft ? "켜짐" : "꺼짐" }));
    } else if (s.type === "select" || s.type === "effort" || s.type === "model") {
      const opts = s.type === "model" ? null : s.options || [];
      const text = s.type === "model" ? modelName(draft) : ((opts.find(o => o.value === draft) || {}).label ?? String(draft));
      ctl.append(selectButton({ label: s.label, text, items: () => opts || hModelItems(draft), value: draft, onPick: v => { draft = v; paint(); } }));
    } else if (s.type === "number") {
      const inp = el("input", { class: "fi", type: "number", inputmode: "numeric", min: s.min, max: s.max, value: Number.isNaN(draft) ? "" : String(draft), "aria-label": s.label });
      inp.addEventListener("input", () => { draft = inp.value.trim() === "" ? NaN : Number(inp.value); mark(); });
      ctl.append(inp, s.unit ? el("span", { class: "unit", text: s.unit }) : null);
    } else if (s.multiline) {
      const ta = el("textarea", { class: "fi hs-ta", rows: 4, spellcheck: "false", "aria-label": s.label }); ta.value = String(draft);
      ta.addEventListener("input", () => { draft = ta.value; mark(); });
      ctl.append(ta);
    } else {
      const inp = el("input", { class: "fi", type: "text", autocomplete: "off", autocapitalize: "off", spellcheck: "false", value: String(draft), "aria-label": s.label });
      inp.addEventListener("input", () => { draft = inp.value; mark(); });
      ctl.append(inp);
    }
    mark();
  };
  reset.onclick = () => { draft = s.default; paint(); };
  send.onclick = async () => {
    send.disabled = true;
    try {
      const at = await hRequest(`${s.label} (${s.source}): ${hVal(cur)} -> ${hVal(draft)}. 적용 시점: ${applyText}.${s.hint ? ` ${s.hint}` : ""}`, hScope(sk, sw));
      sent = draft; note.className = "note ok"; note.textContent = `요청 보냄 · ${at}`; hFlash(send, "요청했어요");
    } catch (e) { note.className = "note err"; note.textContent = e.message; toast(e.message, true); }
    finally { mark(); }
  };
  drafts.push(() => dirty() && !asked());
  const shown = v => (s.type === "model" ? modelName(v) : hFmt(v, s.unit));
  const chg = pj ? (s.default !== undefined && !Object.is(s.default, s.value) ? el("span", { class: "tag m", title: "전역 기본과 다른 값이에요", text: `바꿈 · 전역 ${shown(s.default)}` }) : null) : hChanged(s.key) ? el("span", { class: "tag m", title: "기본값과 다른 값이에요", text: `바꿈 · 기본 ${hFmt(s.default, s.unit)}` }) : null;
  box.append(el("div", { class: "top" }, el("span", { class: "lb", text: s.label }), chg, tag), ctl, el("div", { class: "btns hs-act" }, reset, hScopeTag(sk, sw), send), note);
  paint();
  return box;
}

// Compact line diff (LCS on the lines between the common head and tail) as unified-diff hunks with `ctx` lines of context,
// plus the changed spans in old-file line numbers for the oversize summary.
function lineDiff(oldText, newText, ctx = 3) {
  const a = oldText.replace(/\r\n/g, "\n").split("\n"), b = newText.replace(/\r\n/g, "\n").split("\n");
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let q = 0;
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
  const am = a.slice(p, a.length - q), bm = b.slice(p, b.length - q), n = am.length, m = bm.length, mid = [];
  if (n * m <= 2_000_000) {
    const w = m + 1, L = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i * w + j] = am[i] === bm[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (am[i] === bm[j]) { mid.push([" ", am[i]]); i++; j++; }
      else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) mid.push(["-", am[i++]]);
      else mid.push(["+", bm[j++]]);
    }
    while (i < n) mid.push(["-", am[i++]]);
    while (j < m) mid.push(["+", bm[j++]]);
  } else {
    for (const s of am) mid.push(["-", s]);
    for (const s of bm) mid.push(["+", s]);
  }
  const ops = [...a.slice(0, p).map(s => [" ", s]), ...mid, ...a.slice(a.length - q).map(s => [" ", s])];
  const ob = [], nb = [], ch = [];
  let o = 0, w2 = 0, add = 0, del = 0;
  ops.forEach(([t], i) => { ob.push(o); nb.push(w2); if (t !== "+") o++; if (t !== "-") w2++; if (t !== " ") ch.push(i); if (t === "+") add++; if (t === "-") del++; });
  const groups = [];
  for (const i of ch) {
    const lo = Math.max(0, i - ctx), hi = Math.min(ops.length - 1, i + ctx), g = groups[groups.length - 1];
    if (g && lo <= g[1] + 1) g[1] = Math.max(g[1], hi); else groups.push([lo, hi]);
  }
  const text = groups.map(([lo, hi]) => {
    const seg = ops.slice(lo, hi + 1), oc = seg.filter(x => x[0] !== "+").length, nc = seg.filter(x => x[0] !== "-").length;
    return [`@@ -${oc ? ob[lo] + 1 : ob[lo]},${oc} +${nc ? nb[lo] + 1 : nb[lo]},${nc} @@`, ...seg.map(([t, s]) => t + s)].join("\n");
  }).join("\n");
  const spans = [];
  for (let k = 0; k < ch.length;) {
    let e = k;
    while (e + 1 < ch.length && ch[e + 1] === ch[e] + 1) e++;
    const seg = ops.slice(ch[k], ch[e] + 1), d = seg.filter(x => x[0] === "-").length, ad = seg.length - d, s0 = ob[ch[k]];
    spans.push(d ? `${d === 1 ? `${s0 + 1}줄` : `${s0 + 1}-${s0 + d}줄`}${ad ? ` (${ad}줄로 교체)` : " 삭제"}` : `${s0}줄 뒤에 ${ad}줄 추가`);
    k = e + 1;
  }
  return { add, del, text, spans };
}

// The message for a prompt-file edit: a compact diff (or, past H_DIFF_CAP characters, only the changed line ranges),
// the optional note, and a note-only form when the draft is unchanged.
const H_DIFF_CAP = 6000;
function hFileRequest(r, orig, draft, note) {
  const head = `${r.label} (${r.path || r.name}) 수정${note ? `\n메모: ${note}` : ""}`;
  if (orig.replace(/\r\n/g, "\n") === draft.replace(/\r\n/g, "\n")) return `${head}\n파일 내용은 바꾸지 않았어요. 메모대로 파일을 직접 고쳐 주세요. 적용 시점: ${r.note}`;
  const d = lineDiff(orig, draft);
  const body = d.text.length <= H_DIFF_CAP
    ? `아래 diff 대로 파일을 고쳐 주세요 (줄 단위, 앞뒤 3줄 맥락 포함).\n\`\`\`diff\n--- ${r.name}\n+++ ${r.name} (수정안)\n${d.text}\n\`\`\``
    : `변경이 커서 diff 는 생략했어요 (+${d.add}줄 -${d.del}줄). 바뀐 곳(원본 줄 기준): ${d.spans.slice(0, 20).join(", ")}${d.spans.length > 20 ? ` 외 ${d.spans.length - 20}곳` : ""}. 파일을 직접 열어 확인하고 메모대로 고쳐 주세요.`;
  return `${head}\n${body}\n적용 시점: ${r.note}`;
}

// Prompt-file editor: the owner edits a draft and asks the orchestrator to apply it (diff + optional note), or sends only
// a note. The file itself is never written from here.
function hFileEditor(n, drafts, line) {
  const ta = el("textarea", { class: "fi hs-ta hs-mono", rows: 18, spellcheck: "false", "aria-label": n.file });
  ta.readOnly = !n.fileEditable;
  const note = n.fileEditable ? el("input", { class: "fi", type: "text", autocomplete: "off", maxlength: 500, placeholder: "무엇을 왜 바꾸는지 (선택) · 글은 두고 메모만 보내도 돼요", "aria-label": "수정 요청 메모" }) : null;
  const info = el("div", { class: "note" }), stat = el("div", { class: "note" });
  const send = el("button", { class: "btn sm", type: "button", disabled: true }, `${botName}에게 수정 요청`);
  const undo = el("button", { class: "btn text sm", type: "button", disabled: true }, "되돌리기");
  let file = null, orig = "", sentKey = "", dt = 0;
  const key = () => `${ta.value}\u0000${note ? note.value.trim() : ""}`;
  const dirty = () => ta.value !== orig;
  const unsent = () => (dirty() || (!!note && note.value.trim() !== "")) && key() !== sentKey;
  const mark = () => { send.disabled = !file || !n.fileEditable || !unsent(); undo.disabled = !dirty(); };
  const paintStat = () => {
    if (sentKey && key() === sentKey) return;
    stat.className = "note";
    if (!dirty()) { stat.textContent = ""; return; }
    const d = lineDiff(orig, ta.value);
    stat.textContent = `변경 +${d.add}줄 -${d.del}줄${d.text.length > H_DIFF_CAP ? " · 많이 바뀌어서 diff 대신 바뀐 줄 범위만 보내요. 메모에 무엇을 바꾸는지 적어 주세요" : ""}`;
  };
  const edited = () => { mark(); clearTimeout(dt); dt = setTimeout(paintStat, 250); };
  const url = `/api/harness/file/${n.file.split("/").map(enc).join("/")}`;
  ta.addEventListener("input", edited);
  if (note) note.addEventListener("input", edited);
  undo.onclick = () => { ta.value = orig; edited(); };
  send.onclick = async () => {
    send.disabled = true;
    try {
      const at = await hRequest(hFileRequest(file, orig, ta.value, note.value.trim()), hScope("personal", `${hData()}/${file.name}`));
      sentKey = key(); stat.className = "note ok"; stat.textContent = `요청 보냄 · ${at}`; hFlash(send, "요청했어요");
    } catch (e) { stat.className = "note err"; stat.textContent = e.message; toast(e.message, true); }
    finally { mark(); }
  };
  drafts.push(unsent);
  // Puts the caret on a 1-based line and scrolls the editor there (a hidden copy of the text measures wrapped lines).
  const gotoLine = ln => {
    const lines = ta.value.split("\n"), start = lines.slice(0, ln - 1).reduce((s, l) => s + l.length + 1, 0), end = start + (lines[ln - 1] || "").length;
    const cs = getComputedStyle(ta);
    const mir = el("div", { style: `position:absolute;visibility:hidden;left:-9999px;top:0;box-sizing:border-box;width:${ta.clientWidth}px;padding:${cs.padding};font-family:${cs.fontFamily};font-size:${cs.fontSize};line-height:${cs.lineHeight};white-space:pre-wrap;overflow-wrap:break-word` });
    const at = el("span", { text: "\u200b" });
    mir.append(ta.value.slice(0, start), at); document.body.append(mir);
    const top = at.offsetTop; mir.remove();
    ta.closest(".hs-fw").scrollIntoView({ block: "start" });
    ta.focus({ preventScroll: true }); ta.setSelectionRange(start, end);
    ta.scrollTop = Math.max(0, top - 60);
  };
  hGoto = gotoLine;
  api(url).then(r => {
    file = r; orig = r.text; ta.value = r.text;
    info.textContent = `${num(r.text.length)}자${r.cap ? ` (시작 지침에는 앞 ${num(r.cap)}자까지)` : ""} · ${r.modified ? `${kstStamp(r.modified)} 수정` : "아직 없는 파일"} · ${r.note}`;
    mark();
    if (line) gotoLine(line);
  }, e => { info.className = "note err"; info.textContent = e.message; });
  return el("div", { class: "hs-fw" }, ta, note, el("div", { class: "btns hs-act" }, n.fileEditable ? undo : null, n.fileEditable ? hScopeTag("personal", shortPath(`${hData()}/${n.file}`)) : null, n.fileEditable ? send : null), info, stat);
}
