/* ---------- run state: one line above the composer saying what this conversation's agent is doing ---------- */
// /api/state `runs` (hub/runstate.ts, derived from real hub state) carries {kind, reason, since, detail, todos} for the main
// conversation and every lane. The line always says one of 작업 중 / 답을 기다려요 / 쉬는 중 / 한도에 걸렸어요 / 오류로 멈췄어요 /
// 멈춤 / 끝났어요. An idle conversation with plan tasks left names the reason (no button): the owner's complaint was
// "todo는 남아있는데 아무것도 안하고 있을때 왜 안하는지 모르는 경우가 많음", so "쉬는 중" alone is never the answer.
const RUN_LABEL = { working: "작업 중", waiting: "답을 기다려요", idle: "쉬는 중", limited: "한도에 걸렸어요", error: "오류로 멈췄어요", stopped: "멈춤", done: "끝났어요" };
const RUN_DOT = { working: "pri", waiting: "warn", idle: "", limited: "warn", error: "err", stopped: "", done: "ok" };
// "답을 기다려요" only when the owner's answer is awaited (a question); work the agent handed off reads as its own progress and is not
// colored as needing him (owner 2026-10-28: "답을 기다려요" read as waiting on him; he picked "맡긴 작업 진행 중").
// recover: a background worker failed and the agent takes it up itself (hub/runstate.ts failedRun) - its progress, not a request to the owner.
const waitLabel = r => waitsOnOwner(r) ? RUN_LABEL.waiting : runQueued(r) ? "순서를 기다려요" : r.reason === "recover" || r.reason === "resume" ? "이어서 처리 중" : "맡긴 작업 진행 중";
// standby: no question, but nothing moves until the owner writes (a [wait] report, hub/runstate.ts waitsForOwner).
const waitsOnOwner = r => r.kind === "waiting" && (r.reason === "ask" || r.reason === "standby");
// A conversation waiting on work it handed off is progressing: blue on every row that shows it, like this line. One whose turn or whose
// only worker is still queued has not started, so it is gray and counts as running nowhere; a session held by the limits is the same (S.lanes waiting).
const runOf = t => (S && S.runs && S.runs[t === MAIN ? "main" : t]) || null;
const runQueued = r => !!r && r.kind === "waiting" && (!!r.queued || r.reason === "capacity");
const laneQueued = t => ((S && S.lanes) || []).some(l => l.waiting && `lane:${l.name}` === t);
const runBusy = t => { const r = runOf(t); return !!r && r.kind === "waiting" && !waitsOnOwner(r) && !runQueued(r); };
// Anything still moving, seen or not: 06-subagents.js keeps the state fresh while one is, so no row or word is left behind when no event comes.
const runMoving = r => r.kind === "working" || (r.kind === "waiting" && !waitsOnOwner(r));
// The word and the tone of one conversation or session, the only place a row turns state into colour (the table in docs/ui-spec.md):
// blue runs or progresses, orange needs the owner or sits at a limit, red failed, gray rests or ended. The word differs for every tone, so colour never speaks alone.
function runStatus(t, status, ask) {
  const r = runOf(t);
  if (laneQueued(t)) return ["순서 대기", ""];
  if (status === "working" || status === "starting") return [statusKo(status), "pri"];
  if (ask || (r && waitsOnOwner(r))) return [RUN_LABEL.waiting, "warn"];
  if (r && r.kind === "working") return [RUN_LABEL.working, "pri"];
  if (runQueued(r)) return ["순서 대기", ""];
  if (runBusy(t)) return ["진행 중", "pri"];
  if (status === "rate-limited" || (r && r.kind === "limited")) return [statusKo("rate-limited"), "warn"];
  if (r && r.kind === "error" && !r.cancelled) return ["오류", "err"];
  if (r && r.kind === "done") return ["끝남", ""];
  return [statusKo(status), statusTone(status)];
}
const targetState = t => { const i = targetInfo(t); return i.alive ? runStatus(t, i.status, i.ask) : ["종료됨", ""]; };
const RUN_MEMO = { sig: "" };
const runStateOf = () => {
  if (isFixedT(target) || isSettingsT(target) || isRelayT(target)) return null;
  const runs = (S && S.runs) || {};
  // A mail conversation's run state is the background worker its request was deferred to (hub/routes.ts stateRuns): this
  // computer's under /api/state `runs`, the other computer's in its monitoring snapshot (34-peer-monitoring.js pqRuns).
  if (isMailT(target)) return (typeof pqRuns === "function" && pqRuns(target)) || runs[target] || null;
  // A project channel or thread with a session of its own (hub/convsessions.ts) has its own line: main's work is not its work.
  return runs[target] || (isLaneT(target) || isTaskT(target) || (isProjT(target) && !projOnMain(target)) ? null : runs.main) || null;
};
// The only project that runs on main: one whose kind has no sessions of its own, known once GET /api/context is in.
const projOnMain = t => isProjT(t) && !!C && !(C.conversation_kinds || []).includes("ch");
// The gateway's clock, not this device's, so the elapsed time ticks every second between state refreshes (workNow, 06-subagents.js).
const runClock = () => (typeof workNow === "function" ? workNow() : Date.now());
function runSince(iso) {
  const d = runClock() - (Date.parse(iso) || 0);
  return !(d >= 0) ? "" : d < 60000 ? "방금" : d < 3600000 ? `${Math.floor(d / 60000)}분` : `${Math.floor(d / 3600000)}시간 ${Math.floor((d % 3600000) / 60000)}분`;
}
function runText(r) {
  const label = RUN_LABEL[r.kind] || "알 수 없음", left = r.todos ? `할 일 ${r.todos}개 남음` : "";
  switch (r.kind) {
    case "working": return [label, r.detail, r.since ? runSince(r.since) : ""].filter(Boolean).join(" · ");
    case "waiting": return [waitLabel(r), r.reason === "later" ? "" : r.reason === "recover" && r.detail ? `${r.detail.split(" · ")[0]} 실패` : r.detail, r.reason === "work" && r.since ? runSince(r.since) : "", left].filter(Boolean).join(" · ");
    case "idle": {
      const why = r.reason === "unfinished" ? "이번 턴이 끝났는데 할 일이 남아 있어요" : r.reason === "interrupted" || r.reason === "unknown" ? "마지막 턴이 끝나기 전에 멈췄어요" : "";
      return [label, left, why].filter(Boolean).join(" · ");
    }
    case "limited": return [label, r.detail ? `${kstTime(r.detail)}까지` : "잠시 쉬어요"].join(" · ");
    case "error": return [r.reason === "work" ? (r.cancelled ? "중단됨" : "실패") : label, r.detail].filter(Boolean).join(" · ");
    case "stopped": return [label, r.reason === "owner" ? "직접 멈췄어요" : "", left].filter(Boolean).join(" · ");
    case "done": return [label, r.detail, r.since ? kstHM(r.since) : ""].filter(Boolean).join(" · ");
    default: return label;
  }
}
// The one thing the owner can do about that state, when there is one, for the conversation it is shown in: a background worker is
// stopped (중단) or handed over again (다시 맡기기) on its own; a session restarts itself, never the assistant; a mail conversation has no
// session to resume or restart; a feed (알림, 작업내역) gets nothing that stops or restarts anything. The other computer's worker is
// that computer's to act on, so its line offers no button here.
function runAction(r, t = target) {
  if (r.kind === "waiting" && r.reason === "ask") return { label: "질문으로 가기", run: () => runAskGo() };
  if (isFixedT(t)) return null;
  const peer = isMailT(t) && typeof pqPc === "function" && !!pqPc(t);
  if (r.work && !peer) {
    // 중단 is the send button itself while work runs (14-slash-commands.js renderWorking: send turns into stop), not a second button here.
    if (r.kind === "working" || (r.kind === "waiting" && (r.reason === "work" || r.reason === "recover"))) return null;
    if (r.kind === "error" && r.reason === "work") return { label: "다시 맡기기", run: ev => workRetry(r.work, ev.currentTarget) };
  }
  if (isMailT(t)) return null;
  // idle with tasks left only says why; no 계속하기 button (owner 2026-10-28: "계속하기 버튼 너무 거슬린다") - a message continues it.
  if (isLaneT(t)) return r.kind === "error" || r.kind === "stopped" ? { label: "다시 시작", run: ev => runLaneRestart(laneOf(t), ev.currentTarget) } : null;
  if (r.kind === "limited" || r.kind === "error") return { label: r.kind === "limited" ? "지금 다시 시도" : "다시 시도", run: ev => orchResume(ev.currentTarget) };
  if (r.kind === "stopped") return { label: "다시 시작", run: ev => runRestart(ev.currentTarget) };
  return null;
}
// The live tag of a report: the conversation's state now. `of` is the session the report came from, else the open conversation.
const liveTone = of => {
  const r = of ? runOf(of) : runStateOf();
  return !r || runQueued(r) ? "" : runMoving(r) ? "run" : waitsOnOwner(r) ? "wait" : "";
};
// Only the newest message may carry one, so an older [run] and a finished, stopped or exited session show none. Called on every
// state paint and new message; nothing polls for it.
function syncLiveTags() {
  const all = tl.querySelectorAll(".bm"), last = all[all.length - 1];
  for (const n of tl.querySelectorAll(".bm[data-live-tone]")) {
    const tone = n === last ? liveTone(n.dataset.liveOf) : "";
    if ((n.dataset.liveShown || "") === tone) continue;
    n.dataset.liveShown = tone;
    const root = n.querySelector(":scope > .md"), old = root.querySelector(".st-tag:not(.claim-tag)"), p = old && old.parentNode;
    if (old) old.remove();
    if (p && p !== root && !p.textContent.trim()) p.remove();
    toneLead(root, tone);
  }
  // The gateway's live status of a turn that has ended, and a session's last progress note, also of a session that is gone.
  if ((runStateOf() || (S && isLaneT(target))) && liveTone() !== "run") for (const t of tl.querySelectorAll(".lv .st-tag")) t.remove();
}
function paintRunState() {
  syncLiveTags();
  const box = $("#runstate");
  if (!box) return;
  const r = runStateOf();
  box.hidden = !r;
  $("#composer").classList.toggle("rs-on", !!r);
  if (!r) { RUN_MEMO.sig = ""; return; }
  const sig = JSON.stringify([target, r]), act = runAction(r);
  if (RUN_MEMO.sig !== sig) {
    RUN_MEMO.sig = sig;
    // The same conversation changing what it is doing (작업 중 -> 끝났어요) changes in place; opening another conversation just draws.
    const state = `${r.kind}|${r.reason || ""}`, swap = RUN_MEMO.t === target && !!RUN_MEMO.state && RUN_MEMO.state !== state;
    RUN_MEMO.t = target; RUN_MEMO.state = state;
    const paint = () => {
    const mine = r.kind === "error" && r.cancelled;   // work the owner stopped himself is neutral, not a failure
    $("#runstate-dot").className = `dot ${r.kind === "waiting" && !waitsOnOwner(r) ? "pri" : mine ? "" : RUN_DOT[r.kind] || ""}`.trim();
    box.classList.toggle("warn", waitsOnOwner(r) || r.kind === "limited");
    box.classList.toggle("err", r.kind === "error" && !mine);
    const b = $("#runstate-act");
    b.hidden = !act;
    b.dataset.kind = r.kind;
    if (act) { b.textContent = act.label; b.onclick = act.run; }
    $("#runstate-tx").textContent = runText(r);
    };
    if (swap) motionSwap(box, paint); else paint();
  }
  $("#runstate-tx").textContent = runText(r);
  // A pause whose time has passed: the gateway has moved on, so the line asks instead of staying on 한도 until the next event (a phone that slept missed it).
  if (r.kind === "limited" && Date.parse(r.detail) <= runClock() && Date.now() - (RUN_MEMO.asked || 0) > 5000) { RUN_MEMO.asked = Date.now(); scheduleState(); }
}
setInterval(() => { if (!document.hidden) paintRunState(); }, 1000);

// 질문으로 가기: the open question for this conversation. The card docked above the composer first: a session's own [ask] is docked
// there and has no notice (hub/notices.ts laneTone), so a notice-only lookup said 질문을 찾지 못했어요 under a visible question.
// Then the decision sheet of its notice.
async function runAskGo() {
  const box = $("#dcard");
  if (DC.cur && DC.cur.t === target && box && !box.hidden) {
    if (DC.fold[DC.cur.t]) { DC.fold[DC.cur.t] = false; paintDecision(); }
    box.scrollIntoView({ block: "nearest" });
    const row = $(".dc-row:not(:disabled), .dc-note, .dc-act:not(:disabled)", box);
    (row || box).focus({ preventScroll: true });
    return;
  }
  if (!NT.loaded) await loadNotices();
  const d = ntDecisions().find(n => {
    const to = n.decision && n.decision.to;
    return to === target || (target === MAIN && (to === "main" || String(to).startsWith("auth:")));
  });
  if (d) return noticeOpenId(d.id);
  toast("질문을 찾지 못했어요. 알림에서 확인해 주세요");
}
// 다시 시작 (a stopped session): the gateway's restart, the same as the stopped banner (08-home.js).
const runRestart = btn => busy(btn, async () => {
  await api("/api/orchestrator/restart", "POST", {});
  toast("다시 시작할게요");
  scheduleState();
});
// 다시 시작 (a session that stopped or failed): that session's own restart, the same as its ⋯ menu on 홈 (08-home.js).
const runLaneRestart = (name, btn) => busy(btn, async () => {
  await api(`/api/lanes/${enc(name)}/restart`, "POST", {});
  toast("다시 시작할게요");
  scheduleState();
});
