import { afterAll, beforeEach, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_FILE, NAME, paths } from "./config.ts";
import { decisionsOf, resetNoticesForTest } from "./notices.ts";
import { classOfNotice } from "./notice-class.ts";
import { shortTitle } from "./notice-title.ts";
import { DRAFT_SEND, draftApprovalBlock, draftVerdict } from "./draft-approval.ts";
import { emit, eventTarget, type HubEvent, lastEventId, recentEvents, replayAfter } from "./events.ts";
import { markRead } from "./reads.ts";
import { watchChoice } from "./watch.ts";
import { blockText, recoveryText } from "./limit-alert.ts";
import { watchLine } from "./watchtext.ts";
import { allNotices, answerDecision, answerReply, authRequested, authSettled, type DecisionSend, dismissNotice, dropChannelNotices, dropLaneNotices, handledNotice, ignoreNotice, laneVerified, listNotices, markDraftSend, markNoticesRead, NOTICE_CAP, needsAnswer, type Notice, onDecision, orchestratorAnswered, orchestratorTurnStarted, resolveNotices, readConversationNotices, reopenNotices, rewriteOpenDraft, setConvNameResolver, setLaneTitleResolver, setViewing, setWatchLabelResolver, ANSWER_WINDOW_MS, ALERT_ANSWER_WINDOW_MS, settleExpiredQuestions, UPDATE_NOTICE_KEY, undismissNotice, unignoreNotice, unreadCount, updateAvailable, updateResolved } from "./notices.ts";
import { sealLine } from "./approval-seal.ts";

const ts = () => new Date().toISOString();
const stored = (): Notice[] => JSON.parse(readFileSync(paths.notices, "utf8"));
const post = (target: string, text: string, extra: Record<string, unknown> = {}) => emit("outbox", { ts: ts(), kind: "out", source: "orchestrator", target, text, ...extra });
const byText = (text: string) => stored().filter(n => n.text === text);

setLaneTitleResolver(name => (name === "x" ? "로그인 고치기" : undefined));
beforeEach(resetNoticesForTest);

test("a worklog post becomes a persisted unread notice", () => {
	post("worklog", "[run] 첫 번째 작업 기록");
	const [n] = byText("첫 번째 작업 기록");
	expect(n).toMatchObject({ kind: "worklog", tone: "run", title: "작업 기록", open: "worklog", read: false });
	expect(n!.id).toHaveLength(8);
	expect(listNotices(300).items.find(i => i.id === n!.id)).toMatchObject({ wk: "note" });
	expect(unreadCount()).toBe(0);   // class log: stored unread, but the 알림 screen does not list it
});

test("a session's line in 작업내역 records where its message lives; the session's own report clears that", () => {
	post("worklog", "[done] 기록에 남긴 줄", { update_key: "lane:x" });
	expect(byText("기록에 남긴 줄")[0]).toMatchObject({ src: "lane:x", msg: "worklog" });
	emit("inbox", { ts: ts(), kind: "lane_report", lane: "x", text: "[done] 세션이 쓴 보고" });
	const [n] = byText("세션이 쓴 보고");
	expect(n).toMatchObject({ src: "lane:x" });
	expect(n!.msg).toBeUndefined();
});

test("the same update_key updates one item in place and reopens it only for a new result", () => {
	post("worklog", "[run] 진행 중이에요", { update_key: "lane:x" });
	const first = stored().filter(n => n.key === "lane:x");
	expect(first).toHaveLength(1);
	expect(first[0]).toMatchObject({ kind: "result", tone: "run", title: "로그인 고치기", open: "lane:x" });
	markNoticesRead({ ids: [first[0]!.id] });

	post("worklog", "[run] 진행 중이에요", { update_key: "lane:x" });
	expect(stored().find(n => n.key === "lane:x")!.read).toBe(true);

	post("worklog", "[done] 끝났어요", { update_key: "lane:x" });
	const after = stored().filter(n => n.key === "lane:x");
	expect(after).toHaveLength(1);
	expect(after[0]).toMatchObject({ id: first[0]!.id, tone: "done", text: "끝났어요", read: false, ts: first[0]!.ts });
});

test("an alert post is an alert, a restart notice is born read, progress notes and run reports are ignored", () => {
	post("alert", "[fail] 디스크가 거의 찼어요");
	expect(byText("디스크가 거의 찼어요")[0]).toMatchObject({ kind: "alert", tone: "fail", title: "알림", read: false });

	post("worklog", "게이트웨이 재시작했어요 (10:00 KST).\n- 이어서 하는 세션: x", { source: "gateway" });
	expect(stored().find(n => n.text.startsWith("게이트웨이 재시작했어요"))!.read).toBe(true);

	const before = stored().length;
	post("web", "처리 중이에요", { update_key: "progress", source: "gateway" });
	post("worklog", "[run] 진행 줄", { update_key: "progress" });
	emit("outbox", { ts: ts(), kind: "delivery", source: "gateway", target: "worklog", text: "x", ref: "r", state: "answered" });
	emit("inbox", { ts: ts(), kind: "lane_report", source: "lane:x", lane: "x", text: "[run] 아직 하는 중이에요" });
	expect(stored().length).toBe(before);
});

test("a done lane report upserts the session result; a watch post for a channel becomes a watch notice", () => {
	emit("inbox", { ts: ts(), kind: "lane_report", source: "lane:y", lane: "y", text: "Ask: a - wanted: b. For you: c. Now: d. Next: e.\n\n[fail] 테스트가 깨졌어요" });
	emit("inbox", { ts: ts(), kind: "lane_report", source: "lane:y", lane: "y", text: "[done] 고쳤어요" });
	const y = stored().filter(n => n.key === "lane:y");
	expect(y).toHaveLength(1);
	expect(y[0]).toMatchObject({ kind: "result", tone: "done", text: "고쳤어요", title: "세션", open: "lane:y", read: false });

	post("ch:123", "[주간 점검] 새 글이 올라왔어요", { source: "gateway" });
	expect(byText("새 글이 올라왔어요")[0]).toMatchObject({ kind: "watch", title: "주간 점검", open: "ch:123" });
	emit("inbox", { ts: ts(), kind: "watch", source: "watch:뉴스", watch: "뉴스", channels: [], reason: "바뀌었어요", text: "내용" });
	expect(byText("뉴스: 바뀌었어요\n내용")[0]).toMatchObject({ kind: "watch", title: "뉴스", open: "alert" });
});

test("mark read by id and mark all persist, and the list shows unread first", () => {
	post("worklog", "[done] 읽기 시험 A");
	post("worklog", "[done] 읽기 시험 B");
	const [a, b] = [byText("읽기 시험 A")[0]!, byText("읽기 시험 B")[0]!];
	const unread = unreadCount();
	expect(markNoticesRead({ ids: [a.id] }).unread).toBe(unread - 1);
	expect(byText("읽기 시험 A")[0]!.read).toBe(true);
	expect(byText("읽기 시험 B")[0]!.read).toBe(false);

	const view = listNotices(300);
	const firstRead = view.items.findIndex(n => n.read);
	expect(view.items.slice(firstRead).every(n => n.read)).toBe(true);
	expect(view.items.slice(0, 1)[0]!.read).toBe(false);
	expect(view.unread).toBe(unread - 1);

	expect(markNoticesRead({ all: true }).unread).toBe(0);
	expect(stored().every(n => n.read)).toBe(true);
	expect(b.id).toBeTruthy();
});

test("verifying a session reopens its result and puts one compact card into the main chat", () => {
	markNoticesRead({ all: true });
	post("worklog", "[done] 보고만 했어요", { update_key: "lane:x" });
	markNoticesRead({ all: true });
	const seen = lastEventId();
	const before = recentEvents(300).length;
	laneVerified("x", "[done] 무시되는 글");
	const item = stored().find(n => n.key === "lane:x")!;
	expect(item).toMatchObject({ tone: "done", text: "보고만 했어요", read: false });

	const card = recentEvents(300).at(-1)!;
	expect(recentEvents(300).length).toBe(Math.min(300, before + 1));
	expect(card).toMatchObject({ kind: "result", source: "gateway", target: "web", session: "x", title: "로그인 고치기", tone: "done", verified: true, open: "lane:x" });
	expect(eventTarget(card)).toBe("main");
	expect(replayAfter(seen)?.some(f => f.includes('"kind":"notice"'))).toBe(true);
});

test("notice broadcasts belong to no conversation", () => {
	expect(eventTarget({ ts: ts(), kind: "notice", source: "gateway", text: "" })).toBeUndefined();
	expect(eventTarget({ ts: ts(), kind: "notice_read", source: "gateway", text: "" })).toBeUndefined();
});

test("a notice links to its source message: the conversation and the event ts", () => {
	const at = ts();
	emit("outbox", { ts: at, kind: "out", source: "gateway", target: "ch:77", text: "[네이버] 링크 시험 글" });
	expect(byText("링크 시험 글")[0]).toMatchObject({ open: "ch:77", src: "ch:77", at });
	const alertAt = ts();
	emit("outbox", { ts: alertAt, kind: "out", source: "orchestrator", target: "alert", text: "[fail] 링크 경고" });
	expect(byText("링크 경고")[0]).toMatchObject({ src: "alert", at: alertAt });

	const card = (laneVerified("x", "[done] 무시"), recentEvents(300).at(-1)!);
	expect(stored().find(n => n.key === "lane:x")).toMatchObject({ open: "lane:x", src: "main", at: card.ts });
});

test("dismissing a notice reads it and removes it from the list and the count, and survives a reload from disk", () => {
	markNoticesRead({ all: true });
	post("worklog", "[done] 지울 글 A");
	post("worklog", "[done] 지울 글 B");
	const [a, b] = [byText("지울 글 A")[0]!, byText("지울 글 B")[0]!];
	expect(unreadCount()).toBe(2);
	const seen = lastEventId();

	expect(dismissNotice(a.id)).toEqual({ ok: true, unread: 1 });
	expect(dismissNotice(a.id)).toEqual({ ok: true, unread: 1 });
	expect(dismissNotice("nope")).toEqual({ ok: false, unread: 1 });
	expect(byText("지울 글 A")[0]).toMatchObject({ dismissed: true, read: true });
	expect(listNotices(300).items.map(n => n.id)).not.toContain(a.id);
	expect(listNotices(300)).toMatchObject({ unread: 1 });
	expect(listNotices(300).items.map(n => n.id)).toContain(b.id);
	expect(replayAfter(seen)?.filter(f => f.includes('"kind":"notice_dismiss"'))).toHaveLength(1);
	expect(eventTarget({ ts: ts(), kind: "notice_dismiss", source: "gateway", text: "" })).toBeUndefined();

	// A fresh process reads notices.json again: the dismissed item stays gone and uncounted.
	const script = `import { listNotices, unreadCount } from "./hub/notices.ts"; console.log(JSON.stringify({ ids: listNotices(300).items.map(n => n.id), unread: unreadCount() })); process.exit(0);`;
	const run = Bun.spawnSync([process.execPath, "-e", script], { cwd: join(import.meta.dir, ".."), env: process.env });
	expect(run.exitCode).toBe(0);
	const fresh = JSON.parse(run.stdout.toString().trim().split("\n").at(-1)!);
	expect(fresh.ids).not.toContain(a.id);
	expect(fresh.ids).toContain(b.id);
	expect(fresh.unread).toBe(1);
});

test("a dismissed session result stays gone on quiet progress and returns on a new result", () => {
	post("worklog", "[done] 끝났어요 하나", { update_key: "lane:dz" });
	const id = stored().find(n => n.key === "lane:dz")!.id;
	dismissNotice(id);
	post("worklog", "[done] 끝났어요 하나", { update_key: "lane:dz" });
	expect(listNotices(300).items.map(n => n.id)).not.toContain(id);
	post("worklog", "[done] 새 결과예요", { update_key: "lane:dz" });
	const back = listNotices(300).items.find(n => n.id === id);
	expect(back).toMatchObject({ read: false, text: "새 결과예요" });
	expect(back!.dismissed).toBeUndefined();
});

// Events get strictly increasing times so "later than the ask" is never a same-millisecond tie.
const T0 = new Date().getTime() - 600_000;
let tick = 0;
const rts = () => new Date(T0 + ++tick * 1000).toISOString();
const decision = (title: string) => stored().findLast(n => n.kind === "decision" && n.title === title)!;
const laneAsk = (lane: string, text: string) => emit("outbox", { ts: rts(), kind: "out", source: `lane:${lane}`, target: "alert", text });
const orchAsk = (text: string) => emit("outbox", { ts: rts(), kind: "out", source: "orchestrator", target: "alert", text });
const laneReport = (lane: string, text: string) => emit("inbox", { ts: rts(), kind: "lane_report", source: `lane:${lane}`, lane, text });
const open = (n: Notice) => n.decision!.state === "open" && !n.read;

test("a session's own [done] resolves what it asked: answered, read, off the badge, kept in history", () => {
	laneAsk("sudo1", "[ask] sudo killall trustd 를 터미널에서 실행해 주세요");
	const d = decision("sudo killall trustd 를 터미널에서 실행해 주세요");
	expect(open(d)).toBe(true);
	const before = unreadCount();
	// a progress line or another session's [done] does not close it
	laneReport("sudo1", "[run] 기다리는 중이에요");
	laneReport("other1", "[done] 다른 일을 끝냈어요");
	expect(open(decision(d.title))).toBe(true);
	const mid = unreadCount();
	expect(mid).toBe(before + 1);   // only the other session's own result item
	laneReport("sudo1", "[done] 인증 뒤 작업을 마쳤어요");
	const after = decision(d.title);
	expect(after).toMatchObject({ read: true, decision: { state: "answered", resolved: true } });
	// the session's result item is news (unread done), the ask is not
	expect(unreadCount()).toBe(mid + 1 - 1);
	expect(stored().some(n => n.id === after.id)).toBe(true);
});

test("the worklog line keyed lane:<name> with [done] also resolves that session's question", () => {
	laneAsk("keyed1", "[ask] 키 입력 단계를 해 주세요");
	emit("outbox", { ts: rts(), kind: "out", source: "orchestrator", target: "worklog", text: "[done] 끝났어요", update_key: "lane:keyed1" });
	expect(decision("키 입력 단계를 해 주세요")).toMatchObject({ read: true, decision: { state: "answered", resolved: true } });
});

test("a session [fail] resolves too; an [ask] of another session stays open", () => {
	laneAsk("fa1", "[ask] 첫 번째 질문이에요");
	laneAsk("fa2", "[ask] 두 번째 질문이에요");
	laneReport("fa1", "[fail] 중단됐어요");
	expect(decision("첫 번째 질문이에요").decision!.state).toBe("answered");
	expect(open(decision("두 번째 질문이에요"))).toBe(true);
});

const orchAskRef = (text: string, ref?: string) => emit("outbox", { ts: rts(), kind: "out", source: "orchestrator", target: "alert", text, ...(ref ? { reply_to: ref } : {}) });
const PHONE = "[ask] 폰에서 확인해 주세요\n결정: 폰 확인\n**1) 확인했어요**\n**2) 아직이에요**";

test("a turn's [done] never resolves an ask posted in that same turn, even for the same request", () => {
	orchestratorTurnStarted(rts());
	orchAskRef("[ask] 같은 턴에서 물어요", "req-same");
	orchAskRef(PHONE, "req-same");
	orchestratorAnswered("[done] 코드 작업을 마쳤어요", "req-same", rts());
	expect(open(decision("같은 턴에서 물어요"))).toBe(true);
	expect(open(decision("폰 확인"))).toBe(true);
});

test("an orchestrator [done] resolves an earlier turn's ask only for the same request, and not an unrelated one", () => {
	orchestratorTurnStarted(rts());
	orchAskRef("[ask] 이전 턴 질문 하나", "req-a");
	orchAskRef("[ask] 이전 턴 질문 둘", "req-b");
	orchAskRef("[ask] 이전 턴 요청 없는 질문");
	orchestratorAnswered("아직이에요", "req-a", rts());   // no result marker
	orchestratorTurnStarted(rts());
	orchestratorAnswered("[done] 전혀 다른 일이에요", "req-other", rts());
	orchestratorAnswered("[done] 요청 모름", undefined, rts());
	expect(open(decision("이전 턴 질문 하나")) && open(decision("이전 턴 질문 둘")) && open(decision("이전 턴 요청 없는 질문"))).toBe(true);
	orchestratorAnswered("[done] req-a 를 마쳤어요", "req-a", rts());
	const d = decision("이전 턴 질문 하나");
	expect(d).toMatchObject({ read: true, decision: { state: "answered", resolved: true } });
	expect(d.decision!.answer).toBeUndefined();   // marked resolved, no made-up answer text
	expect(open(decision("이전 턴 질문 둘"))).toBe(true);
	expect(open(decision("이전 턴 요청 없는 질문"))).toBe(true);
	orchestratorAnswered("[fail] req-b 가 실패했어요", "req-b", rts());
	expect(decision("이전 턴 질문 둘").decision!.state).toBe("answered");
});

test("a decision with options is the owner's: no [done] or sweep closes it, only the bot naming it", () => {
	orchestratorTurnStarted(rts());
	orchAskRef(PHONE.replace("폰 확인", "폰 확인 둘"), "req-c");
	laneAsk("phone1", "[ask] 세션이 묻는 선택\n결정: 세션 선택\n**1) 가**\n**2) 나**");
	orchestratorTurnStarted(rts());
	orchestratorAnswered("[done] 같은 요청을 마쳤어요", "req-c", rts());
	laneReport("phone1", "[done] 세션 일을 마쳤어요");
	resolveNotices({ all: true });
	resolveNotices({ conv: "lane:phone1" });
	expect(open(decision("폰 확인 둘"))).toBe(true);
	expect(open(decision("세션 선택"))).toBe(true);
	expect(resolveNotices({ match: "폰 확인 둘" }).resolved).toBeGreaterThanOrEqual(1);
	expect(decision("폰 확인 둘")).toMatchObject({ read: true, decision: { state: "answered", resolved: true } });
	expect(decision("폰 확인 둘").decision!.answer).toBeUndefined();
	expect(resolveNotices({ ids: [decision("세션 선택").id] }).resolved).toBe(1);
});

test("an ask that is the turn's own final answer stays open", () => {
	orchestratorTurnStarted(rts());
	orchestratorAnswered("[ask] 어느 쪽으로 할까요?", "req-d", rts());   // answer ends the turn ...
	orchAskRef("[ask] 어느 쪽으로 할까요?", "req-d");   // ... and is delivered after it
	expect(open(decision("어느 쪽으로 할까요?"))).toBe(true);
});

test("reopenNotices puts a wrongly closed question back: open, unread, no resolved flag or answer", () => {
	orchAskRef(PHONE.replace("폰 확인", "폰 확인 셋"), "req-e");
	const d = decision("폰 확인 셋");
	resolveNotices({ ids: [d.id] });
	expect(stored().find(n => n.id === d.id)!.decision!.state).toBe("answered");
	const r = reopenNotices([d.id, "nope"]);
	expect(r.reopened).toEqual([d.id]);
	const back = stored().find(n => n.id === d.id)!;
	expect(back).toMatchObject({ read: false, decision: { state: "open" } });
	expect(back.decision!.resolved).toBeUndefined();
	expect(back.decision!.answer).toBeUndefined();
});

test("a monitor passing again resolves its failure alert and is itself born read", () => {
	const fail = `[uptime] failed 2 times in a row (exit 1)\n출력\n${watchChoice("uptime")}`;
	emit("outbox", { ts: rts(), kind: "out", source: "gateway", target: "alert", text: fail });
	const d = stored().find(n => n.kind === "decision" && n.text.startsWith("[uptime]"))!;
	expect(open(d)).toBe(true);
	emit("outbox", { ts: rts(), kind: "out", source: "gateway", target: "alert", text: "[uptime] recovered\nok" });
	expect(stored().find(n => n.id === d.id)).toMatchObject({ read: true, decision: { state: "answered", resolved: true } });
	expect(stored().find(n => n.kind === "alert" && n.text.startsWith("[uptime] recovered"))!.read).toBe(true);
});

test("a watch wake event with reason recovered reads that watch's earlier notices", () => {
	emit("inbox", { ts: rts(), kind: "watch", source: "watch:cron1", watch: "cron1", reason: "output changed", text: "바뀌었어요" });
	const first = stored().find(n => n.kind === "watch" && n.title === "cron1")!;
	expect(first.read).toBe(false);
	emit("inbox", { ts: rts(), kind: "watch", source: "watch:cron1", watch: "cron1", reason: "recovered", text: "정상" });
	expect(stored().filter(n => n.kind === "watch" && n.title === "cron1").every(n => n.read)).toBe(true);
});

test("the owner answering by any channel still settles the ask", () => {
	laneAsk("own1", "[ask] 이어서 할까요?");
	const d = decision("이어서 할까요?");
	emit("inbox", { ts: rts(), kind: "lane_message", source: "web", lane: "own1", text: "네" });
	expect(stored().find(n => n.id === d.id)).toMatchObject({ read: true, decision: { state: "answered", answer: "네" } });
	expect(stored().find(n => n.id === d.id)!.decision!.resolved).toBeUndefined();
});

test("the bot resolves explicitly: by words in the question, by conversation, or all; unrelated questions stay open", () => {
	orchAsk("[ask] 비밀번호 보관함을 열어 주세요");
	orchAsk("[ask] 배포 시점을 정해 주세요");
	laneAsk("exp1", "[ask] 세션 쪽 확인을 해 주세요");
	const r = resolveNotices({ match: "보관함" });
	expect(r.resolved).toBeGreaterThanOrEqual(1);
	expect(decision("비밀번호 보관함을 열어 주세요")).toMatchObject({ read: true, decision: { state: "answered", resolved: true } });
	expect(open(decision("배포 시점을 정해 주세요"))).toBe(true);
	expect(resolveNotices({ match: "없는 말" }).resolved).toBe(0);
	expect(resolveNotices({}).resolved).toBe(0);   // no selector resolves nothing
	resolveNotices({ conv: "lane:exp1" });
	expect(decision("세션 쪽 확인을 해 주세요").decision!.state).toBe("answered");
	expect(open(decision("배포 시점을 정해 주세요"))).toBe(true);
	resolveNotices({ all: true });
	expect(decision("배포 시점을 정해 주세요").decision!.state).toBe("answered");
});

test("a login request keeps its own end: the bot's resolve never touches it", () => {
	authRequested({ id: "rz1", kind: "approve", title: "로그인 승인", site: "example.com", purpose: "승인해 주세요" });
	resolveNotices({ all: true });
	expect(stored().find(n => n.key === "auth:rz1")!.decision!.state).toBe("open");
	authSettled("rz1", "cancelled");
});

// ---- what waits on the owner stays unread however it is viewed; the x (무시) takes it off without answering ----
const waiting = (title: string) => ({ id: decision(title).id });
const stat = (id: string) => stored().find(n => n.id === id)!;
const FAR = "9999-12-31T00:00:00.000Z";

test("viewing a question that waits never reads it, on any path; a plain notice still clears on view", () => {
	orchAsk("[ask] 보기만 해서는 남아야 해요\n결정: 보기만 해서는 남아야 해요\n**1) 예**\n**2) 아니요**");
	const { id } = waiting("보기만 해서는 남아야 해요");
	post("worklog", "[done] 보면 읽히는 기록이에요");
	const info = byText("보면 읽히는 기록이에요")[0]!;
	markNoticesRead({ ids: [id, info.id] });   // the sheet, the chat scroll, a push click
	expect(stat(info.id).read).toBe(true);
	markNoticesRead({ all: true });   // read all
	readConversationNotices("alert", FAR);   // the conversation read position
	setViewing("tab-wait", "alert", Date.now());   // the page shows the conversation
	setViewing("tab-wait", "", Date.now());
	expect(stat(id)).toMatchObject({ read: false, decision: { state: "open" } });
	expect(unreadCount()).toBeGreaterThanOrEqual(1);
	expect(listNotices().items.slice(0, 1)[0]!.kind).toBe("decision");
});

test("answering a question that waits removes it from the unread count", async () => {
	orchAsk("[ask] 답하면 사라져요\n결정: 답하면 사라져요\n**1) 예**\n**2) 아니요**");
	const { id } = waiting("답하면 사라져요");
	const before = unreadCount();
	const r = await answerDecision(id, { n: 1 }, async () => {});
	expect(r.status).toBe(200);
	expect(stat(id)).toMatchObject({ read: true, decision: { state: "answered" } });
	expect(unreadCount()).toBe(before - 1);
});

test("a signal that the matter is over still clears a question that waits", () => {
	orchAsk("[ask] 해결되면 사라져요\n결정: 해결되면 사라져요\n**1) 예**\n**2) 아니요**");
	const { id } = waiting("해결되면 사라져요");
	resolveNotices({ ids: [id] });
	expect(stat(id)).toMatchObject({ read: true, decision: { state: "answered", resolved: true } });
});

test("ignoring takes a question off the count, keeps it in the history, answers nothing, and tells every page; undo brings it back", async () => {
	post("worklog", "[done] 무시할 수 없는 기록이에요");
	const plain = byText("무시할 수 없는 기록이에요")[0]!.id;
	orchAsk("[ask] 무시해 볼게요\n결정: 무시해 볼게요\n**1) 예**\n**2) 아니요**");
	const { id } = waiting("무시해 볼게요");
	let since = lastEventId();
	const frames = () => (replayAfter(since) ?? []).map(f => JSON.parse(/data: (.*)\n/.exec(f)![1]!) as HubEvent).filter(e => e.kind === "notice");
	const before = unreadCount();
	const r = ignoreNotice(id);
	expect(r.status).toBe(200);
	expect(stat(id)).toMatchObject({ read: true, decision: { state: "ignored" } });
	expect(stat(id).ignored).toBeString();
	expect(unreadCount()).toBe(before - 1);
	// live to every page: one notice frame per changed item, carrying the new count
	expect(frames().map(e => (e.item as Notice).id)).toEqual([id]);
	expect(frames().every(e => e.unread === before - 1)).toBe(true);
	// still listed (history), never an answer: a later owner message does not turn it into an answered one
	expect(listNotices().items.some(n => n.id === id && n.decision?.state === "ignored")).toBe(true);
	owner("아무 말");
	expect(stat(id).decision).toMatchObject({ state: "ignored" });
	expect(stat(id).decision!.answer).toBeUndefined();
	// the same ask arriving again soon does not bring it back
	orchAsk("[ask] 무시해 볼게요\n결정: 무시해 볼게요\n**1) 예**\n**2) 아니요**");
	expect(stat(id).decision!.state).toBe("ignored");
	expect(unreadCount()).toBe(before - 1);   // the repeat makes no item of its own
	// ignoring twice is harmless; an answered or plain notice cannot be ignored
	expect(ignoreNotice(id).body.already).toBe(true);
	expect(ignoreNotice(plain).status).toBe(409);
	expect(ignoreNotice("nope").status).toBe(404);
	// survives a restart as stored
	expect(JSON.parse(readFileSync(paths.notices, "utf8")).find((n: Notice) => n.id === id).decision.state).toBe("ignored");
	// undo
	since = lastEventId();
	expect(unignoreNotice(id).status).toBe(200);
	expect(stat(id)).toMatchObject({ read: false, decision: { state: "open" } });
	expect(stat(id).ignored).toBeUndefined();
	expect(unreadCount()).toBe(before);
	expect(frames()).toHaveLength(1);
	// it can be answered after the undo
	expect((await answerDecision(id, { n: 1 }, async () => {})).status).toBe(200);
	expect(stat(id).decision!.state).toBe("answered");
});

test("one [ask] with a choice block posted to alert is one notice, and answering it closes that one", async () => {
	const at = rts();
	emit("outbox", { ts: at, kind: "out", source: "orchestrator", target: "alert", text: "[ask] 탭을 바꿨어요. 폰에서 봐 주세요.\n\n결정: 폰 탭 하나\n**1) 확인됨**\n폰에서도 잘 보여요\n**2) 안 됨 …**\n어디가 이상한지 적어 주세요" });
	const made = stored().filter(n => n.at === at || n.decision?.reply_to === at);
	expect(made.map(n => n.kind)).toEqual(["decision"]);
	const [d] = made;
	expect(d).toMatchObject({ title: "폰 탭 하나", src: "alert", read: false, decision: { state: "open", reply_to: at } });
	expect(listNotices(NOTICE_CAP).items.filter(n => n.at === at)).toHaveLength(1);
	expect((await answerDecision(d!.id, { n: 1 }, async () => {})).status).toBe(200);
	const after = stored().filter(n => n.at === at || n.decision?.reply_to === at);
	expect(after).toHaveLength(1);
	expect(after[0]).toMatchObject({ id: d!.id, read: true, decision: { state: "answered", answer: "1) 확인됨" } });
	expect(listNotices(NOTICE_CAP).items.filter(n => n.at === at).map(n => n.id)).toEqual([d!.id]);
});

test("on load, an alert item stored next to the decision of the same message reads back as one notice; nothing else changes", () => {
	const dir = mkdtempSync(join(tmpdir(), "dotz-pair-"));
	copyFileSync(CONFIG_FILE, join(dir, "config.json"));
	const T1 = "2026-10-22T14:07:14.500Z", T2 = "2026-10-22T14:09:00.000Z";
	const base = { ts: T1, updated: T1, open: "alert", src: "alert", at: T1, read: false };
	const pair: Notice[] = [
		{ ...base, id: "dec00001", kind: "decision", tone: "ask", title: "폰 탭 구성 확인", text: "q", key: "dec:alert:x", decision: { options: [{ n: 1, label: "확인됨", desc: "" }, { n: 2, label: "안 됨", desc: "" }], to: "alert", reply_to: T1, group: 1, state: "open" } },
		{ ...base, id: "twin0001", kind: "alert", tone: "ask", title: "알림", text: "q" },
		{ ...base, id: "msg00001", kind: "message", tone: "", title: "알림", text: "q", key: "msg:alert" },
		{ ...base, id: "fail0001", kind: "alert", tone: "fail", title: "알림", text: "디스크가 찼어요", ts: T2, updated: T2, at: T2 },
	];
	writeFileSync(join(dir, "notices.json"), JSON.stringify(pair));
	const script = `import { listNotices, unreadCount } from "./hub/notices.ts"; console.log(JSON.stringify({ ids: listNotices(300).items.map(n => n.id), unread: unreadCount() })); process.exit(0);`;
	const run = Bun.spawnSync([process.execPath, "-e", script], { cwd: join(import.meta.dir, ".."), env: { ...process.env, DOTZ_DIR: dir } });
	expect(run.exitCode).toBe(0);
	const out = JSON.parse(run.stdout.toString().trim().split("\n").at(-1)!) as { ids: string[]; unread: number };
	expect(out.ids.sort()).toEqual(["dec00001", "fail0001", "msg00001"]);
	// The old open question (2026-10-22, alert) is past its 24 hour window and msg:alert is a conversation item: listed here, but neither is counted.
	expect(out.unread).toBe(1);
	// kept in the file, only folded away
	const after = JSON.parse(readFileSync(join(dir, "notices.json"), "utf8")) as Notice[];
	expect(after).toHaveLength(4);
	expect(after.find(n => n.id === "twin0001")).toMatchObject({ read: true, dismissed: true });
	expect(after.find(n => n.id === "dec00001")).toMatchObject({ read: false, decision: { state: "open" } });
	rmSync(dir, { recursive: true, force: true });
});

test("the store keeps at most 300 items, dropping read ones first and then the oldest", () => {
	resolveNotices({ ids: stored().filter(n => n.decision?.state === "open").map(n => n.id) });   // questions that wait are never read away: close them first so every item can be read
	markNoticesRead({ all: true });
	post("worklog", "읽지 않은 오래된 글");
	for (let i = 0; i < NOTICE_CAP - 1; i++) post("worklog", `채우기 ${i}`);
	let items = stored();
	expect(items).toHaveLength(NOTICE_CAP);
	expect(items.every(n => !n.read)).toBe(true);
	expect(items.some(n => n.text === "읽지 않은 오래된 글")).toBe(true);

	post("worklog", "채우기 마지막");
	items = stored();
	expect(items).toHaveLength(NOTICE_CAP);
	expect(items.some(n => n.text === "읽지 않은 오래된 글")).toBe(false);
	expect(items.some(n => n.text === "채우기 마지막")).toBe(true);
});

const draftCard = (i: number) => post("alert", `[ask] 초안 ${i}\n${draftApprovalBlock({ to: "owner@example.test", body: `본문 ${i}`, ref: `RC${i}`, question: "이 답장 보낼까요?" })}`);

test("every open card is found past the 300 cap: allNotices and GET /api/notices hold them all, listNotices(300) alone does not", () => {
	for (let i = 0; i < NOTICE_CAP + 158; i++) draftCard(i);
	const open = stored().filter(n => n.decision?.state === "open");
	expect(open).toHaveLength(NOTICE_CAP + 158);
	expect(allNotices()).toHaveLength(open.length);
	expect(listNotices(NOTICE_CAP).items).toHaveLength(NOTICE_CAP);
	const last = allNotices().at(-1)!;
	expect(listNotices(NOTICE_CAP).items.some(n => n.id === last.id)).toBe(false);
	expect(allNotices().some(n => n.id === last.id)).toBe(true);
	expect(listNotices(100, true).items).toHaveLength(open.length);
});

test("a closed card whose send failed outlives the cap until it is dismissed", async () => {
	draftCard(0);
	const card = stored().find(n => n.decision?.draft?.ref === "RC0")!;
	expect((await answerDecision(card.id, { n: 1 }, async () => {})).status).toBe(200);
	markDraftSend(card.decision!.to, "RC0", "failed", "보내지 못했어요");
	for (let i = 0; i < NOTICE_CAP + 20; i++) post("worklog", `[run] 채우기 ${i}`);
	expect(stored()).toHaveLength(NOTICE_CAP);
	expect(stored().find(n => n.id === card.id)?.decision?.send?.state).toBe("failed");
	expect(allNotices().some(n => n.id === card.id)).toBe(true);
	dismissNotice(card.id);
	post("worklog", "[run] 채우기 마지막");
	expect(stored().some(n => n.id === card.id)).toBe(false);
});

test("a found dotz update creates one notice, a later check reuses it, and applying it marks it read", () => {
	markNoticesRead({ all: true });
	updateAvailable("dotz 새 버전이 있어요: 커밋 2개 (첫 번째). 설정 → 업데이트에서 적용해요.");
	const first = stored().filter(n => n.key === UPDATE_NOTICE_KEY);
	expect(first).toHaveLength(1);
	expect(first[0]).toMatchObject({ kind: "alert", title: "새 버전", open: "settings", read: false });
	expect(first[0]!.text).toContain("커밋 2개");

	markNoticesRead({ ids: [first[0]!.id] });
	updateAvailable("dotz 새 버전이 있어요: 커밋 3개 (두 번째). 설정 → 업데이트에서 적용해요.");
	const second = stored().filter(n => n.key === UPDATE_NOTICE_KEY);
	expect(second).toHaveLength(1);
	expect(second[0]).toMatchObject({ id: first[0]!.id, read: false, ts: first[0]!.ts });
	expect(second[0]!.text).toContain("커밋 3개");

	updateResolved();
	expect(stored().find(n => n.key === UPDATE_NOTICE_KEY)!.read).toBe(true);
	expect(stored().filter(n => n.key === UPDATE_NOTICE_KEY)).toHaveLength(1);
});

test("live posts shaped like main.ts out() (gateway worklog, orchestrator alert, both with reply_to) each create a notice; the gateway's status line is born read", () => {
	const at = ts();
	emit("outbox", { ts: at, kind: "out", source: "gateway", target: "worklog", text: "계정을 a에서 b로 바꿨어요.", reply_to: null });
	emit("outbox", { ts: ts(), kind: "out", source: "orchestrator", target: "alert", text: "[fail] 라이브 경고 시험", reply_to: null });
	expect(byText("계정을 a에서 b로 바꿨어요.")[0]).toMatchObject({ kind: "worklog", open: "worklog", at, read: true });
	expect(byText("라이브 경고 시험")[0]).toMatchObject({ kind: "alert", tone: "fail", read: false });
});

// The backfill runs in a fresh process on a throwaway DOTZ_DIR holding sample persisted history (this process's store is not empty).
// Now, to the hour: a restart (module load) prunes old watch items by the wall clock, so the sample history is laid out back from it.
const NOW = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString();
const hoursAgo = (h: number) => new Date(Date.parse(NOW) - h * 3_600_000).toISOString();
const jsonl = (rows: Record<string, unknown>[]) => `${rows.map(r => JSON.stringify(r)).join("\n")}\n`;
const outRow = (h: number, target: string, text: string, extra: Record<string, unknown> = {}) => ({ ts: hoursAgo(h), kind: "out", source: "orchestrator", target, text, reply_to: null, ...extra });

function runBackfill(dir: string): { count: number; items: Notice[] } {
	const script = `import { backfillNotices } from "./hub/notices.ts"; console.log(JSON.stringify(backfillNotices(Date.parse(${JSON.stringify(NOW)})))); process.exit(0);`;
	const run = Bun.spawnSync([process.execPath, "-e", script], { cwd: join(import.meta.dir, ".."), env: { ...process.env, DOTZ_DIR: dir } });
	expect(run.exitCode).toBe(0);
	const file = join(dir, "notices.json");
	return { count: JSON.parse(run.stdout.toString().trim().split("\n").at(-1)!), items: existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [] };
}

test("backfill builds the store once from persisted history: last 7 days, one item per lane key, 24 h split read/unread, no second run", () => {
	const dir = mkdtempSync(join(tmpdir(), "dotz-backfill-"));
	copyFileSync(CONFIG_FILE, join(dir, "config.json"));
	// session aa still exists (a restart retires unread results of sessions that are gone); bb is finished and read
	mkdirSync(join(dir, "lanes", "aa"), { recursive: true });
	writeFileSync(join(dir, "lanes", "aa", "lane.json"), JSON.stringify({ name: "aa" }));
	writeFileSync(
		join(dir, "outbox.jsonl"),
		jsonl([
			outRow(200, "worklog", "일주일 전 기록"),
			outRow(36, "worklog", "오래된 기록"),
			outRow(14, "worklog", "[run] 하는 중이에요", { update_key: "lane:aa" }),
			outRow(5, "worklog", "[done] 끝났어요", { update_key: "lane:aa" }),
			outRow(4, "worklog", "[run] 진행 줄", { update_key: "progress" }),
			outRow(3, "alert", "[fail] 새 경고"),
			outRow(2, "worklog", "야간 정리\n- 정리했어요", { source: "gateway" }),
			{ ts: hoursAgo(2), kind: "delivery", source: "gateway", target: "worklog", ref: "r", state: "answered", text: "" },
			outRow(1, "web", "그냥 대화예요"),
		]),
	);
	writeFileSync(
		join(dir, "inbox.jsonl"),
		jsonl([
			{ ts: hoursAgo(50), kind: "lane_report", source: "lane:bb", lane: "bb", text: "[done] 두 번째 세션 끝" },
			{ ts: hoursAgo(1), kind: "schedule", source: "schedule", id: "s1", channel: "main", text: "예약 시작" },
			// the gateway's own wake (update carry-over) is an instruction to the assistant, never an owner notice (Mac mini 2026-10-29)
			{ ts: hoursAgo(1), kind: "schedule", source: "gateway", id: "self-update-local", channel: "web", text: "[dotz 업데이트] 보관됐어요" },
			{ ts: hoursAgo(1), kind: "message", source: "web", channel: "web", author: "local", text: "안녕" },
		]),
	);

	const first = runBackfill(dir);
	expect(first.count).toBe(6);
	expect(first.items.map(n => n.text).sort()).toEqual(["끝났어요", "두 번째 세션 끝", "새 경고", "야간 정리\n- 정리했어요", "예약 시작", "오래된 기록"].sort());

	// Lane keys are de-duplicated: the latest post wins, at its own ts.
	const aa = first.items.filter(n => n.key === "lane:aa");
	expect(aa).toHaveLength(1);
	expect(aa[0]).toMatchObject({ kind: "result", tone: "done", text: "끝났어요", open: "lane:aa", updated: hoursAgo(5), read: false });
	expect(first.items.find(n => n.key === "lane:bb")).toMatchObject({ tone: "done", updated: hoursAgo(50), read: true });

	// Original ts kept; older than 24 h is read, newer unread; kinds come from the live mapping.
	expect(first.items.find(n => n.text === "새 경고")).toMatchObject({ kind: "alert", tone: "fail", ts: hoursAgo(3), read: false });
	expect(first.items.find(n => n.text === "오래된 기록")).toMatchObject({ kind: "worklog", ts: hoursAgo(36), read: true });
	expect(first.items.find(n => n.text.startsWith("야간 정리"))).toMatchObject({ kind: "worklog", title: "야간 정리", read: false });
	expect(first.items.find(n => n.text === "예약 시작")).toMatchObject({ kind: "watch", title: "예약", read: false });
	expect(first.items.filter(n => !n.read)).toHaveLength(4);

	// A restart (a fresh process on the same files) must not add or change anything.
	const before = readFileSync(join(dir, "notices.json"), "utf8");
	const again = runBackfill(dir);
	expect(again.count).toBe(0);
	expect(readFileSync(join(dir, "notices.json"), "utf8")).toBe(before);
});

// A lane that is gone from the live map keeps its launch title: from its lane_start event or its lane.json record.
const titledDir = () => {
	const dir = mkdtempSync(join(tmpdir(), "dotz-titles-"));
	copyFileSync(CONFIG_FILE, join(dir, "config.json"));
	mkdirSync(join(dir, "lanes", "rec"), { recursive: true });
	writeFileSync(join(dir, "lanes", "rec", "lane.json"), JSON.stringify({ name: "rec", title: "기록에 남은 제목" }));
	writeFileSync(join(dir, "outbox.jsonl"), jsonl([{ ts: hoursAgo(30), kind: "lane_start", source: "hub", lane: "gone", title: "알림 모아보기", text: "lane gone started in /x" }]));
	return dir;
};
const titleOf = (items: Notice[], key: string) => items.find(n => n.key === key)?.title;

test("backfill titles a lane that is no longer live from its lane_start event or lane.json, else falls back to the generic title", () => {
	const dir = titledDir();
	writeFileSync(
		join(dir, "inbox.jsonl"),
		jsonl([
			{ ts: hoursAgo(5), kind: "lane_report", source: "lane:gone", lane: "gone", text: "[done] 끝났어요" },
			{ ts: hoursAgo(4), kind: "lane_report", source: "lane:rec", lane: "rec", text: "[done] 끝났어요" },
			{ ts: hoursAgo(3), kind: "lane_report", source: "lane:nowhere", lane: "nowhere", text: "[done] 끝났어요" },
		]),
	);
	const { items } = runBackfill(dir);
	expect(titleOf(items, "lane:gone")).toBe("알림 모아보기");
	expect(titleOf(items, "lane:rec")).toBe("기록에 남은 제목");
	expect(titleOf(items, "lane:nowhere")).toBe("세션");
});

test("on load, stored lane items titled 세션 are re-titled in place when a real title can be found; others are left alone", () => {
	const dir = titledDir();
	const item = (key: string, title: string, id: string): Notice => ({ id, ts: hoursAgo(5), updated: hoursAgo(5), kind: "result", tone: "done", title, text: "끝났어요", open: key, src: key, at: hoursAgo(5), key, read: true });
	writeFileSync(
		join(dir, "notices.json"),
		JSON.stringify([item("lane:gone", "세션", "aaaaaaa1"), item("lane:rec", "세션", "aaaaaaa2"), item("lane:nowhere", "세션", "aaaaaaa3"), item("lane:rec2", "직접 정한 제목", "aaaaaaa4")]),
	);
	const run = Bun.spawnSync([process.execPath, "-e", `import "./hub/notices.ts"; process.exit(0);`], { cwd: join(import.meta.dir, ".."), env: { ...process.env, DOTZ_DIR: dir } });
	expect(run.exitCode).toBe(0);
	const after: Notice[] = JSON.parse(readFileSync(join(dir, "notices.json"), "utf8"));
	expect(after).toHaveLength(4);
	expect(after.map(n => [n.key, n.title])).toEqual([["lane:gone", "알림 모아보기"], ["lane:rec", "기록에 남은 제목"], ["lane:nowhere", "세션"], ["lane:rec2", "직접 정한 제목"]]);
	expect(after.map(n => n.id)).toEqual(["aaaaaaa1", "aaaaaaa2", "aaaaaaa3", "aaaaaaa4"]);
});

test("backfill with no persisted history creates nothing and no file", () => {
	const dir = mkdtempSync(join(tmpdir(), "dotz-backfill-"));
	copyFileSync(CONFIG_FILE, join(dir, "config.json"));
	expect(runBackfill(dir)).toEqual({ count: 0, items: [] });
	expect(existsSync(join(dir, "notices.json"))).toBe(false);
});

/* ---------- decisions: a pending owner decision is its own pinned notice ---------- */
const decisions = (to: string) => stored().filter(n => n.kind === "decision" && n.decision?.to === to);
const owner = (text: string, extra: Record<string, unknown> = {}) => emit("inbox", { ts: ts(), kind: "message", source: "web", channel: "web", text, ...extra });
const laneOwner = (lane: string, text: string) => emit("inbox", { ts: ts(), kind: "lane_message", source: "web", lane, text });

test("a message with two choice blocks gives two decision notices that stay unread and cannot be dismissed", () => {
	const at = ts();
	const fresh: Notice[] = [];
	onDecision(n => fresh.push(n));
	post("web", "[ask] 두 가지를 정해 주세요\n결정: 먼저 고칠 것\n**1) 로그인 버그**\n세션이 자꾸 풀려요\n**2) 결제 버그**\n결제가 가끔 안 돼요\n결정: 배포 시점\n**1) 지금**\n**2) 내일**\n번호로 답해 주세요", { ts: at });
	const mine = decisions("main").filter(n => n.decision!.reply_to === at);
	expect(mine.map(n => n.title)).toEqual(["먼저 고칠 것", "배포 시점"]);
	expect(mine.every(n => !n.read && n.decision!.state === "open" && n.decision!.group === 2)).toBe(true);
	expect(mine[0]!.decision!.options).toEqual([
		{ n: 1, label: "로그인 버그", desc: "세션이 자꾸 풀려요" },
		{ n: 2, label: "결제 버그", desc: "결제가 가끔 안 돼요" },
	]);
	expect(mine[1]!.decision!.options.map(o => o.label)).toEqual(["지금", "내일"]);
	expect(fresh.map(n => n.title)).toEqual(["먼저 고칠 것", "배포 시점"]);
	// pinned: first in the list, not readable away, not dismissable
	expect(listNotices().items.slice(0, 2).every(n => n.kind === "decision")).toBe(true);
	markNoticesRead({ all: true });
	expect(stored().filter(n => n.id === mine[0]!.id)[0]!.read).toBe(false);
	expect(dismissNotice(mine[0]!.id)).toMatchObject({ ok: false, held: true });
	expect(stored().find(n => n.id === mine[0]!.id)!.dismissed).toBeUndefined();
});

test("a button answers one decision as a reply to the asking message; a plain owner reply settles the rest of that chat", async () => {
	const at = ts();
	post("web", "[ask] 순서를 정해 주세요\n결정: 첫째\n**1) 가**\n**2) 나**\n결정: 둘째\n**1) 다**\n**2) 라**", { ts: at });
	const [a, b] = decisions("main").filter(n => n.decision!.reply_to === at) as [Notice, Notice];
	const sent: Parameters<DecisionSend>[0][] = [];
	const send: DecisionSend = async x => {
		sent.push(x);
		owner(x.text, { reply_to: x.replyTo, decision: x.notice });
	};
	const r = await answerDecision(b.id, { n: 2 }, send);
	expect(r.status).toBe(200);
	// `picks` hands the agent the block's question with the chosen option, whichever conversation the button was pressed in.
	expect(sent).toEqual([{ to: "main", text: "둘째: 2) 라", replyTo: at, notice: b.id, picks: [{ q: "둘째", n: 2, label: "라" }] }]);
	const after = (id: string) => stored().find(n => n.id === id)!;
	expect(after(b.id)).toMatchObject({ read: true, decision: { state: "answered", answer: "2) 라" } });
	expect(after(a.id)).toMatchObject({ read: false, decision: { state: "open" } });
	// answering again does nothing; an option that does not exist is refused
	expect((await answerDecision(b.id, { n: 1 }, send)).body.already).toBe(true);
	expect(sent).toHaveLength(1);
	expect((await answerDecision(a.id, { n: 9 }, send)).status).toBe(400);
	// the owner replying in the chat settles what is still open there
	owner("1-1");
	expect(after(a.id)).toMatchObject({ read: true, decision: { state: "answered", answer: "1-1" } });
	expect(dismissNotice(a.id).ok).toBe(true);
});

test("a failed send leaves the decision open", async () => {
	post("web", "[ask] 하나만 골라 주세요\n결정: 하나만 골라 주세요\n**1) 예**\n**2) 아니요**");
	const n = decisions("main").find(x => x.title === "하나만 골라 주세요")!;
	const r = await answerDecision(n.id, { n: 1 }, async () => {
		throw new Error("세션이 끝났어요");
	});
	expect(r).toMatchObject({ status: 409, body: { error: "세션이 끝났어요" } });
	expect(stored().find(x => x.id === n.id)!.decision!.state).toBe("open");
	expect(n.decision!.group).toBe(1);
	owner("1");
});

test("a typed message does not close a waiting send-approval card; its button still answers it", async () => {
	post("web", `[ask] 댓글 답글 초안이에요 (19/28)\n${draftApprovalBlock({ to: "A 댓글", toLabel: "대상", body: "감사합니다", ref: "cm-typed", question: "이 답글 올릴까요?" })}`);
	const n = decisions("main").find(x => x.decision!.draft?.ref === "cm-typed")!;
	owner("19번 카드는 위에 있어");
	owner("마지막 카드 어디?");
	expect(stored().find(x => x.id === n.id)!.decision!.state).toBe("open");
	await answerDecision(n.id, { n: 1 }, async x => void owner(x.text, { reply_to: x.replyTo, decision: x.notice }));
	expect(stored().find(x => x.id === n.id)!.decision!.state).toBe("answered");
});

test("a card rewritten to a newer draft of the same mail switches the open notice to that draft and stays one card", () => {
	const bot = `[ask] 이 메일에 답장할까요\n${draftApprovalBlock({ to: "owner@example.test", body: "문서 첨부해 드립니다.", ref: "mail:1a1a", question: "이 답장 보낼까요?" })}`;
	post("mail:acct-1a1a", bot);
	const app = draftApprovalBlock({ to: "owner@example.test", body: "문서 첨부해 드립니다.", ref: "RAYVKXK", question: "이 답장 보낼까요?", attachments: [{ name: "문서.pdf", size: 2048 }] });
	expect(rewriteOpenDraft("mail:acct-1a1a", "mail:1a1a", `[ask] 답장 초안을 만들었어요\n${app}`)).toBe(1);
	const open = stored().filter(n => n.decision?.state === "open" && n.decision.to === "mail:acct-1a1a");
	expect(open).toHaveLength(1);
	expect(open[0]!.decision!.draft!.ref).toBe("RAYVKXK");
	expect(open[0]!.decision!.draft!.attachments?.map(a => a.name)).toEqual(["문서.pdf"]);
	// 보내기 on this card records its title as the pick: the send gate looks for the draft's own id there (features/reply-drafts/lib/flow.ts sendDraft).
	expect(open[0]!.title).toBe("이 답장 보낼까요? (RAYVKXK)");
	const inbox = join(mkdtempSync(join(tmpdir(), "notice-pick-")), "inbox.jsonl");
	writeFileSync(inbox, `${sealLine(inbox, { ts: new Date().toISOString(), kind: "message", source: "web", channel: "mail:acct-1a1a", text: "결정 답", picks: [{ q: open[0]!.title, n: 1, label: DRAFT_SEND }] })}\n`);
	expect(draftVerdict(inbox, "RAYVKXK", 0, { conv: "mail:acct-1a1a" }).verdict).toBe("send");
});

test("a session [ask] makes one decision for that session, a repeated copy adds none, and only a reply in that session settles it", () => {
	const line = "[ask] 이어서 진행할까요?";
	post("lane:x", line, { source: "lane:x" });
	emit("inbox", { ts: ts(), kind: "lane_report", source: "lane:x", lane: "x", text: line });
	const [d, ...rest] = decisions("lane:x");
	expect(rest).toHaveLength(0);
	expect(d).toMatchObject({ kind: "decision", title: "이어서 진행할까요?", open: "lane:x", read: false, decision: { options: [{ n: 1, label: "네" }, { n: 2, label: "아니요" }], assumed: true, state: "open", group: 1 } });
	owner("네");   // the main chat is another conversation
	expect(stored().find(n => n.id === d!.id)!.decision!.state).toBe("open");
	laneOwner("y", "아니요");
	expect(stored().find(n => n.id === d!.id)!.decision!.state).toBe("open");
	laneOwner("x", "네, 이어서 해 주세요");
	expect(stored().find(n => n.id === d!.id)!).toMatchObject({ read: true, decision: { state: "answered", answer: "네, 이어서 해 주세요" } });
	// the same words again right after the answer do not open it again
	emit("inbox", { ts: ts(), kind: "lane_report", source: "lane:x", lane: "x", text: line });
	expect(stored().find(n => n.id === d!.id)!.decision!.state).toBe("answered");
});

test("a session's budget question gets yes / no buttons that send words the budget gate understands", async () => {
	post("lane:b", "[ask] 한도가 빠듯해요. 진행하려면 /budget-ok 가 필요해요. 진행할까요?", { source: "lane:b" });
	const d = decisions("lane:b")[0]!;
	expect(d.decision!.options.map(o => o.label)).toEqual(["네, 진행해 주세요", "아니요, 하지 마세요"]);
	let sent = "";
	await answerDecision(d.id, { n: 1 }, async x => {
		sent = x.text;
		laneOwner("b", x.text);
	});
	expect(sent).toBe("진행해");
});

test("a login request is a decision that its approve button and its end both settle", async () => {
	authRequested({ id: "a1", kind: "approve", title: "로그인 승인", site: "example.com", purpose: "결제 페이지에 들어가요" });
	const n = decisions("auth:a1")[0]!;
	expect(n).toMatchObject({ title: "로그인 승인", read: false, decision: { options: [{ action: "approve" }, { action: "cancel" }] } });
	const sent: Parameters<DecisionSend>[0][] = [];
	await answerDecision(n.id, { n: 1 }, async x => void sent.push(x));
	expect(sent).toEqual([{ to: "auth:a1", text: "1) 승인", notice: n.id, action: "approve" }]);
	authSettled("a1", "approved");
	expect(stored().find(x => x.id === n.id)).toMatchObject({ read: true, decision: { state: "answered", answer: "1) 승인" } });
	authRequested({ id: "a2", kind: "secret", title: "로그인 정보", site: "example.com", purpose: "계정이 필요해요" });
	const form = decisions("auth:a2")[0]!;
	expect((await answerDecision(form.id, { n: 1 }, async () => {})).status).toBe(400);   // the form is the page's own
	authSettled("a2", "timeout");
	expect(stored().find(x => x.id === form.id)!.decision).toMatchObject({ state: "answered", answer: "시간이 지나 닫혔어요" });
});

test("an open decision survives the store's cap and a reload from disk", () => {
	post("web", "[ask] 오래 남을 질문\n**1) 하나**\n**2) 둘**");
	const id = decisions("main").find(n => n.title === "오래 남을 질문")!.id;
	for (let i = 0; i < NOTICE_CAP + 5; i++) post("worklog", `[run] 채우기 ${i}`);
	expect(stored().length).toBeLessThanOrEqual(NOTICE_CAP);
	expect(stored().find(n => n.id === id)!.decision!.state).toBe("open");
	owner("1");
});

test("a plain question waits 72 hours; past them the sweep closes it as expired, read and off the badge", () => {
	const at = new Date(Date.parse(ts()) - 4 * 86_400_000).toISOString();
	post("web", "[ask] 누나, 가능해?", { ts: at });
	const n = decisions("main").find(x => x.text === "누나, 가능해?")!;
	expect(n.decision!.expires_at).toBe(new Date(Date.parse(at) + ANSWER_WINDOW_MS).toISOString());
	// The gap before the sweep: already not open, not waiting, not counted by the badge.
	expect(needsAnswer(n)).toBe(false);
	expect(unreadCount()).toBe(0);
	expect(listNotices().items.some(i => i.id === n.id && needsAnswer(i))).toBe(false);
	expect(settleExpiredQuestions()).toBe(1);
	const after = stored().find(x => x.id === n.id)!;
	expect(after).toMatchObject({ read: true, decision: { state: "answered", resolved: true, expired: true } });
	expect(after.decision!.answer).toBeUndefined();
	expect(unreadCount()).toBe(0);
});

test("the expiry sweep is idempotent: a second pass changes nothing", () => {
	post("web", "[ask] 멈춘 Aside", { ts: new Date(Date.parse(ts()) - 4 * 86_400_000).toISOString() });
	expect(settleExpiredQuestions()).toBe(1);
	const file = readFileSync(paths.notices, "utf8");
	expect(settleExpiredQuestions()).toBe(0);
	expect(readFileSync(paths.notices, "utf8")).toBe(file);
});

test("a send-approval card and a login request carry no expiry: their own state closes them", () => {
	post("web", `[ask] 댓글 답글 초안이에요\n${draftApprovalBlock({ to: "A 댓글", toLabel: "대상", body: "감사합니다", ref: "cm-ttl", question: "이 답글 올릴까요?" })}`);
	const card = decisions("main").find(x => x.decision!.draft?.ref === "cm-ttl")!;
	expect(card.decision!.expires_at).toBeUndefined();
	authRequested({ id: "ttl1", kind: "approve", title: "로그인 승인", site: "example.com", purpose: "결제 페이지에 들어가요" });
	const login = decisions("auth:ttl1")[0]!;
	expect(login.decision!.expires_at).toBeUndefined();
	expect(settleExpiredQuestions(new Date(Date.parse(ts()) + 30 * 86_400_000).toISOString())).toBe(0);
	expect(stored().find(x => x.id === card.id)!.decision!.state).toBe("open");
	expect(stored().find(x => x.id === login.id)!.decision!.state).toBe("open");
});

test("a gateway alert question waits 24 hours, not 72", () => {
	const at = new Date(Date.parse(ts()) - 2 * 86_400_000).toISOString();
	emit("outbox", { ts: at, kind: "out", source: "gateway", target: "alert", text: "[ask] 토큰을 다시 확인할까요?" });
	const n = decisions("alert").find(x => x.text === "토큰을 다시 확인할까요?")!;
	expect(n.decision!.expires_at).toBe(new Date(Date.parse(at) + ALERT_ANSWER_WINDOW_MS).toISOString());
	expect(settleExpiredQuestions()).toBe(1);
	expect(stored().find(x => x.id === n.id)).toMatchObject({ read: true, decision: { state: "answered", resolved: true, expired: true } });
});

test("on load, a stored open question without an expiry gets one from its own time in memory, the file untouched; a login request stays without", () => {
	const dir = mkdtempSync(join(tmpdir(), "dotz-expiry-"));
	copyFileSync(CONFIG_FILE, join(dir, "config.json"));
	const at = new Date(Date.parse(ts()) - 5 * 3_600_000).toISOString();
	const base = { ts: at, updated: at, kind: "decision", tone: "ask", title: "이어서 할까요?", text: "[ask] 이어서 할까요?", open: "main", src: "main", at, read: false };
	writeFileSync(
		join(dir, "notices.json"),
		JSON.stringify([
			{ ...base, id: "aaaaaaa1", key: "dec:main:plain", decision: { options: [{ n: 1, label: "네" }], to: "main", group: 1, state: "open", assumed: true } },
			{ ...base, id: "aaaaaaa2", key: "dec:main:auth", decision: { options: [{ n: 1, label: "승인", action: "approve" }], to: "auth:z", group: 1, state: "open" } },
		]),
	);
	const file = readFileSync(join(dir, "notices.json"), "utf8");
	const run = Bun.spawnSync([process.execPath, "-e", `const m = await import("./hub/notices.ts"); console.log(JSON.stringify(m.listNotices().items.map(n => [n.id, n.decision?.expires_at ?? null]))); process.exit(0);`], { cwd: join(import.meta.dir, ".."), env: { ...process.env, DOTZ_DIR: dir } });
	expect(run.exitCode).toBe(0);
	const after = new Map<string, string | null>(JSON.parse(run.stdout.toString().trim().split("\n").at(-1)!));
	expect(after.get("aaaaaaa1")).toBe(new Date(Date.parse(at) + ANSWER_WINDOW_MS).toISOString());
	expect(after.get("aaaaaaa2")).toBeNull();
	expect(readFileSync(join(dir, "notices.json"), "utf8")).toBe(file);
	rmSync(dir, { recursive: true, force: true });
});

const CHOICE = "결정: 정리 세션 시작 전 쌓인 변경 처리\n**1) 먼저 커밋**\n지금 상태를 저장해요\n**2) 그대로 진행**\n설명 줄";

test("a plain reply with a numbered list is text: no decision, no notice, no push hook", () => {
	const fresh: Notice[] = [];
	onDecision(n => fresh.push(n));
	const at = ["2052-01-01T00:00:01.000Z", "2052-01-01T00:00:03.000Z"];
	post("web", "설치 방법은 두 가지예요\n1) 브루로 설치\n2) 직접 빌드", { ts: at[0] });
	emit("outbox", { ts: at[1], kind: "out", source: "lane:x", target: "lane:x", text: "[done] 끝났어요\n**1) 병합**\n**2) 보류**" });
	expect(stored().filter(n => n.kind === "decision" && at.includes(n.decision?.reply_to ?? ""))).toHaveLength(0);
	expect(fresh).toHaveLength(0);
});

test("a reply without a marker but with a 결정: choice block is a decision", () => {
	const at = "2052-01-01T00:00:02.000Z";
	post("web", "결정: 다른 질문\n**1) 가나**\n설명\n**2) 다라**\n설명", { ts: at });
	expect(decisions("main").filter(n => n.decision!.reply_to === at)).toHaveLength(1);
});

test("an [ask] with a choice block is a decision: notice, push hook and the answer path work", async () => {
	const fresh: Notice[] = [];
	onDecision(n => fresh.push(n));
	const at = ts();
	post("web", `[ask] 어떻게 할까요?\n${CHOICE}\n번호로 답해 주세요`, { ts: at });
	const [d] = decisions("main").filter(n => n.decision!.reply_to === at);
	expect(d).toMatchObject({ kind: "decision", read: false, title: "정리 세션 시작 전 쌓인 변경 처리", decision: { state: "open", group: 1 } });
	expect(d!.decision!.options.map(o => [o.n, o.label])).toEqual([[1, "먼저 커밋"], [2, "그대로 진행"]]);
	expect(fresh.filter(n => n.id === d!.id)).toHaveLength(1);
	// a decision message makes only the decision item, no message item
	expect(stored().filter(n => n.kind === "message" && n.text.includes("먼저 커밋"))).toHaveLength(0);
	const sent: Parameters<DecisionSend>[0][] = [];
	const r = await answerDecision(d!.id, { n: 1 }, async x => void sent.push(x));
	expect(r.status).toBe(200);
	expect(sent).toEqual([{ to: "main", text: "1) 먼저 커밋", replyTo: at, notice: d!.id, picks: [{ q: "정리 세션 시작 전 쌓인 변경 처리", n: 1, label: "먼저 커밋" }] }]);
	// a session's [ask] with a block is the same, addressed to that session; a one-option list is not a decision
	const lat = ts();
	emit("outbox", { ts: lat, kind: "out", source: "lane:x", target: "lane:x", text: "[ask] 어떻게 할까요?\n**1) 병합**\n**2) 보류**" });
	expect(decisions("lane:x").filter(n => n.decision!.reply_to === lat)).toHaveLength(1);
	const before = stored().filter(n => n.kind === "decision").length;
	post("web", "순서예요\n**1) 하나뿐인 항목**");
	expect(stored().filter(n => n.kind === "decision").length).toBe(before);
});

test("the reply to a choice-button answer is quiet: no message item, no push; an ask or fail reply still speaks", () => {
	const conv = "ch:4242", items = () => stored().filter(n => n.key === `msg:${conv}`);
	const button = (at: string) => emit("inbox", { ts: at, kind: "message", source: "web", channel: conv, text: "1) 먼저 커밋", picks: [{ q: "정리", n: 1, label: "먼저 커밋" }] });
	const reply = (at: string, text: string) => emit("outbox", { ts: at, kind: "out", source: "orchestrator", target: conv, text });
	button("2051-01-01T00:00:00.000Z");
	reply("2051-01-01T00:00:01.000Z", "[done] 먼저 커밋했어요");
	expect(items()).toHaveLength(0);
	expect(answerReply({ ts: "2051-01-01T00:00:01.000Z", kind: "out", source: "orchestrator", target: conv, text: "x" } as HubEvent)).toBe(true);   // push asks again for the same event
	reply("2051-01-01T00:00:02.000Z", "이어서 알려드릴게요");   // only the first reply is quiet
	expect(items()).toHaveLength(1);
	button("2051-01-01T00:01:00.000Z");
	reply("2051-01-01T00:01:01.000Z", "[fail] 커밋하지 못했어요");
	expect(items()[0]!.text).toContain("커밋하지 못했어요");
	const plain = { ts: "2051-01-01T00:02:00.000Z", kind: "message", source: "web", channel: conv, text: "그냥 말해요" } as HubEvent;
	answerReply(plain);
	expect(answerReply({ ts: "2051-01-01T00:02:01.000Z", kind: "out", source: "orchestrator", target: conv, text: "네" } as HubEvent)).toBe(false);   // an ordinary message is not a button answer
});

test("an answer to a conversation nobody views is one message item, updated in place by the next answer", () => {
	setConvNameResolver(conv => (conv === "ch:77" ? "프로젝트 엑스" : undefined));
	const items = () => stored().filter(n => n.key === "msg:ch:77");
	post("ch:77", "[done] ".concat("가".repeat(300)));
	const [first] = items();
	expect(first).toMatchObject({ kind: "message", title: "프로젝트 엑스", open: "ch:77", src: "ch:77", read: false });
	expect(first!.text.length).toBeLessThanOrEqual(120);
	markNoticesRead({ ids: [first!.id] });
	const at = ts();
	post("ch:77", "두 번째 답이에요", { ts: at });
	expect(items()).toHaveLength(1);
	expect(items()[0]).toMatchObject({ id: first!.id, text: "두 번째 답이에요", at, read: false });
	// keepalive "ok", "-", progress and the session's own [done] (it has a result item) add nothing
	for (const t of ["ok", "-"]) post("ch:77", t);
	post("ch:77", "진행 중", { update_key: "progress" });
	emit("outbox", { ts: ts(), kind: "out", source: "lane:m1", target: "lane:m1", text: "[done] 세션 끝" });
	expect(items()[0]!.text).toBe("두 번째 답이에요");
	expect(stored().filter(n => n.key === "msg:lane:m1")).toHaveLength(0);
	// a session's plain message is its own conversation's item, titled by the session
	emit("outbox", { ts: ts(), kind: "out", source: "lane:x", target: "lane:x", text: "중간 답이에요" });
	expect(stored().find(n => n.key === "msg:lane:x")).toMatchObject({ title: "로그인 고치기", open: "lane:x", read: false });
});

test("a session's untagged turn-end report (sent to its Discord channel) is that conversation's one message item", () => {
	const items = () => stored().filter(n => n.key === "msg:lane:x");
	const report = (text: string, extra: Record<string, unknown> = {}) => emit("inbox", { ts: ts(), kind: "lane_report", source: "lane:x", lane: "x", text, ...extra });
	report("리포트가 완성됐어요. index.html을 열면 돼요.", { answering: true });
	expect(items()).toHaveLength(1);
	expect(items()[0]).toMatchObject({ kind: "message", title: "로그인 고치기", open: "lane:x", read: false });
	// the mid-turn answer and the next report rewrite that item: one notice per conversation
	emit("outbox", { ts: ts(), kind: "out", source: "lane:x", target: "lane:x", text: "네, 볼게요" });
	report("가이드도 고쳤어요.");
	expect(items()).toHaveLength(1);
	expect(items()[0]!.text).toBe("가이드도 고쳤어요.");
	// a [run] report only edits the Discord progress line: nothing, unless it answers the owner
	report("[run] 아직 돌고 있어요");
	expect(items()[0]!.text).toBe("가이드도 고쳤어요.");
	report("[run] 재계산이 돌고 있어요, 끝나면 확인할게요", { answering: true });
	expect(items()[0]!.text).toBe("재계산이 돌고 있어요, 끝나면 확인할게요");
	// a [done] report keeps its result item only
	report("[done] 끝났어요");
	expect(items()[0]!.text).toBe("재계산이 돌고 있어요, 끝나면 확인할게요");
	expect(stored().filter(n => n.key === "lane:x")).toHaveLength(1);
});

test("a viewed conversation makes no message item; looking at one reads its item; a stale or hidden report no longer counts", () => {
	const items = () => stored().filter(n => n.key === "msg:ch:78");
	const t0 = Date.now();
	expect(setViewing("tab-a", "ch:78", t0)).toMatchObject({ ok: true });
	post("ch:78", "보고 있는 대화의 답이에요");
	expect(items()).toHaveLength(0);
	// hidden page: the answer is an unread item; the page coming back to that conversation reads it
	setViewing("tab-a", "", Date.now());
	post("ch:78", "숨겨졌을 때 온 답이에요");
	expect(items()[0]).toMatchObject({ kind: "message", read: false });
	setViewing("tab-a", "ch:78", Date.now());
	expect(items()[0]!.read).toBe(true);
	// a report older than 60 s counts as gone
	setViewing("tab-a", "ch:78", Date.now() - 61_000);
	post("ch:78", "오래된 신호 뒤의 답이에요");
	expect(items()[0]).toMatchObject({ text: "오래된 신호 뒤의 답이에요", read: false });
	// another conversation, and a bad report
	setViewing("tab-b", "main", Date.now());
	post("ch:78", "다른 대화를 보는 중이에요");
	expect(items()[0]).toMatchObject({ text: "다른 대화를 보는 중이에요", read: false });
	expect(setViewing("tab-b", "nope")).toEqual({ ok: false });
});

test("looking at a conversation reads its unread answer and a mail's notice, never a result, alert or monitor report; a tap reads those", () => {
	const mine = (key: string) => stored().find(n => n.key === key)!;
	// a session result whose card lives in lane:seen1: reading that conversation (POST /api/read, scope viewed) leaves the result unread
	emit("outbox", { ts: "2026-10-22T01:00:00.000Z", kind: "out", source: "lane:seen1", target: "worklog", text: "[done] 읽지 않은 결과", update_key: "lane:seen1" });
	expect(mine("lane:seen1")).toMatchObject({ kind: "result", src: "lane:seen1", read: false });
	const r = markRead({ target: "lane:seen1", ts: "2026-10-22T01:00:00.000Z" });
	if (r.ok) readConversationNotices(r.target, r.ts, "viewed");
	expect(mine("lane:seen1").read).toBe(false);
	markRead({ target: "lane:seen1", ts: "2026-10-22T03:00:00.000Z" });
	setViewing("tab-seen", "lane:seen1", Date.now());
	expect(mine("lane:seen1").read).toBe(false);
	markNoticesRead({ ids: [mine("lane:seen1").id] });
	expect(mine("lane:seen1").read).toBe(true);
	// the conversation's unread answer is read by the read position, and by viewing it
	emit("outbox", { ts: "2026-10-22T04:00:00.000Z", kind: "out", source: "orchestrator", target: "ch:9411", text: "보일 답이에요" });
	emit("outbox", { ts: "2026-10-22T04:00:00.000Z", kind: "out", source: "orchestrator", target: "ch:9412", text: "보일 답이에요 둘" });
	expect(mine("msg:ch:9411")).toMatchObject({ kind: "message", read: false });
	readConversationNotices("ch:9411", "2026-10-22T03:00:00.000Z", "viewed");
	expect(mine("msg:ch:9411").read).toBe(false);
	readConversationNotices("ch:9411", "2026-10-22T04:00:00.000Z", "viewed");
	expect(mine("msg:ch:9411").read).toBe(true);
	setViewing("tab-seen", "ch:9412", Date.now());
	expect(mine("msg:ch:9412").read).toBe(true);
	setViewing("tab-seen", "", Date.now());
});

// A throwaway data dir for a fresh process: config copy, optional stored notices / read positions, and the sessions that still exist on disk.
function storeDir(files: { notices?: Notice[]; reads?: Record<string, string>; lanes?: string[]; records?: Record<string, Record<string, unknown>>; channels?: Record<string, unknown> }): string {
	const dir = mkdtempSync(join(tmpdir(), "dotz-stale-"));
	copyFileSync(CONFIG_FILE, join(dir, "config.json"));
	if (files.channels) writeFileSync(join(dir, "channels.json"), JSON.stringify(files.channels));
	if (files.notices) writeFileSync(join(dir, "notices.json"), JSON.stringify(files.notices));
	if (files.reads) writeFileSync(join(dir, "reads.json"), JSON.stringify(files.reads));
	for (const l of files.lanes ?? []) {
		mkdirSync(join(dir, "lanes", l), { recursive: true });
		writeFileSync(join(dir, "lanes", l, "lane.json"), JSON.stringify({ title: l }));
	}
	for (const [l, rec] of Object.entries(files.records ?? {})) {
		mkdirSync(join(dir, "lanes", l), { recursive: true });
		writeFileSync(join(dir, "lanes", l, "lane.json"), JSON.stringify({ name: l, title: l, ...rec }));
	}
	return dir;
}
function loadIn(dir: string): { items: Notice[]; unread: number } {
	const script = `import { listNotices, unreadCount } from "./hub/notices.ts"; console.log(JSON.stringify({ items: listNotices(300).items, unread: unreadCount() })); process.exit(0);`;
	const run = Bun.spawnSync([process.execPath, "-e", script], { cwd: join(import.meta.dir, ".."), env: { ...process.env, DOTZ_DIR: dir } });
	expect(run.exitCode).toBe(0);
	return JSON.parse(run.stdout.toString().trim().split("\n").at(-1)!);
}
const stale = (id: string, key: string, at: string, extra: Partial<Notice> = {}): Notice => ({ id, ts: at, updated: at, kind: "result", tone: "done", title: "세션", text: `${id} 끝났어요`, open: key, src: key, at, key, read: false, ...extra });

test("deleting a session drops its notices: unread ones leave the badge and list, its open question is resolved, other sessions are untouched", () => {
	emit("inbox", { ts: ts(), kind: "lane_report", source: "lane:del1", lane: "del1", text: "[done] 지워질 세션의 결과" });
	emit("inbox", { ts: ts(), kind: "lane_report", source: "lane:keep1", lane: "keep1", text: "[done] 남는 세션의 결과" });
	emit("inbox", { ts: ts(), kind: "lane_report", source: "lane:del1", lane: "del1", text: "[ask] 어느 쪽으로 할까요?\n**1) 가\n**2) 나" });
	const open = stored().filter(n => n.decision?.to === "lane:del1" && n.decision.state === "open");
	expect(open.length).toBeGreaterThan(0);
	const before = unreadCount();
	const seen = lastEventId();

	const dropped = dropLaneNotices("del1");
	expect(dropped).toBeGreaterThan(0);
	const mine = stored().filter(n => n.key === "lane:del1" || n.decision?.to === "lane:del1");
	expect(mine.every(n => n.dismissed && n.read)).toBe(true);
	expect(stored().filter(n => n.decision?.to === "lane:del1").every(n => n.decision!.state !== "open")).toBe(true);
	expect(listNotices(300).items.some(n => n.key === "lane:del1")).toBe(false);
	expect(stored().find(n => n.key === "lane:keep1")).toMatchObject({ read: false });
	expect(unreadCount()).toBeLessThan(before);
	expect(replayAfter(seen)?.filter(f => f.includes('"kind":"notice_dismiss"')).length).toBe(dropped);
	expect(dropLaneNotices("del1")).toBe(0);
});

test("on load, unread and waiting notices of a session that no longer exists are retired; read history and living sessions stay", () => {
	const at = "2026-10-20T01:00:00.000Z";
	const asking: Notice = stale("bbbbbbb4", "lane:gone", at, { kind: "decision", tone: "ask", decision: { to: "lane:gone", reply_to: at, options: [{ n: 1, label: "가" }], state: "open" } as Notice["decision"] });
	const dir = storeDir({
		lanes: ["alive"],
		notices: [stale("bbbbbbb1", "lane:gone", at), stale("bbbbbbb2", "lane:alive", at), stale("bbbbbbb3", "lane:old", at, { read: true }), asking],
	});
	const fresh = loadIn(dir);
	expect(fresh.items.map(n => n.id).sort()).toEqual(["bbbbbbb2", "bbbbbbb3"]);
	expect(fresh.unread).toBe(1);
	const saved: Notice[] = JSON.parse(readFileSync(join(dir, "notices.json"), "utf8"));
	expect(saved.find(n => n.id === "bbbbbbb1")).toMatchObject({ dismissed: true, read: true });
	expect(saved.find(n => n.id === "bbbbbbb4")).toMatchObject({ dismissed: true, read: true, decision: { state: "answered", resolved: true } });
});

test("read state survives a reload: what the owner read (by position or by id) stays read, what came after stays unread", () => {
	const early = "2026-10-20T01:00:00.000Z", late = "2026-10-20T05:00:00.000Z";
	const dir = storeDir({
		lanes: ["rd"],
		reads: { "lane:rd": "2026-10-20T02:00:00.000Z" },
		notices: [stale("ccccccc1", "lane:rd", early, { kind: "message", key: "msg:lane:rd:a" }), stale("ccccccc2", "lane:rd", late), stale("ccccccc3", "lane:rd", early, { key: "msg:lane:rd", read: true }), stale("ccccccc4", "lane:rd", early, { key: "lane:rd:r" })],
	});
	const fresh = loadIn(dir);
	const by = (id: string) => fresh.items.find(n => n.id === id)!;
	// the read position covers a conversation's unread answer only; a result before it is still the owner's to tap
	expect(by("ccccccc1").read).toBe(true);
	expect(by("ccccccc2").read).toBe(false);
	expect(by("ccccccc3").read).toBe(true);
	expect(by("ccccccc4").read).toBe(false);
	expect(fresh.unread).toBe(2);
	// and the corrected state is what the file holds, so a second load agrees
	const again = loadIn(dir);
	expect(again.items.filter(n => !n.read).map(n => n.id).sort()).toEqual(["ccccccc2", "ccccccc4"]);
	expect((JSON.parse(readFileSync(join(dir, "notices.json"), "utf8")) as Notice[]).find(n => n.id === "ccccccc1")!.read).toBe(true);
});

test("on load, waiting items are redrawn from their source event by the current rules; ids, read and answer state stay, the rest is untouched", () => {
	const t1 = "2026-10-20T01:00:00.000Z", t2 = "2026-10-20T01:05:00.000Z", t3 = "2026-10-20T01:10:00.000Z";
	const ask: HubEvent = { ts: t1, kind: "out", source: "orchestrator", target: "main", text: "[ask] 배포할까요?\n\n결정: 배포 시점\n**1) 지금**\n**2) 내일**" };
	const alert: HubEvent = { ts: t2, kind: "out", source: "gateway", target: "alert", text: "[fail] 디스크가 거의 찼어요" };
	const done: HubEvent = { ts: t3, kind: "out", source: "gateway", target: "alert", text: "[fail] 이미 본 알림" };
	const old = (id: string, at: string, extra: Partial<Notice>): Notice => ({ id, ts: at, updated: at, kind: "alert", tone: "", title: "옛 제목", text: "옛 문구", open: "main", src: "main", at, read: false, ...extra });
	const dir = storeDir({
		notices: [
			old("ddddddd1", t1, { kind: "decision", tone: "ask", key: "dec:main:old", decision: { to: "main", reply_to: t1, options: [{ n: 1, label: "옛 선택지" }], group: 1, state: "open" } as Notice["decision"] }),
			old("ddddddd2", t2, { open: "alert", src: "alert" }),
			old("ddddddd3", t3, { open: "alert", src: "alert", read: true }),
		],
	});
	writeFileSync(join(dir, "outbox.jsonl"), [ask, alert, done].map(e => JSON.stringify(e)).join("\n") + "\n");
	const fresh = loadIn(dir);
	const by = (id: string) => fresh.items.find(n => n.id === id)!;
	const [want] = decisionsOf(ask);
	expect(by("ddddddd1")).toMatchObject({ title: want!.title, text: want!.detail, key: want!.key, read: false, decision: { state: "open", reply_to: t1, options: want!.options } });
	expect(by("ddddddd2")).toMatchObject({ tone: "fail", text: "디스크가 거의 찼어요", read: false });
	expect(by("ddddddd3")).toMatchObject({ tone: "", text: "옛 문구", read: true });
	// the redrawn form is what the file holds, so a second load changes nothing
	expect(loadIn(dir).items.find(n => n.id === "ddddddd1")).toEqual(by("ddddddd1"));
});

test("an answer that arrives after the owner already read that conversation past it is born read, a newer one is unread; a result is never born read that way", () => {
	markRead({ target: "lane:born1", ts: "2026-10-22T05:00:00.000Z" });
	emit("outbox", { ts: "2026-10-22T04:00:00.000Z", kind: "out", source: "lane:born1", target: "worklog", text: "[done] 이미 본 결과", update_key: "lane:born1" });
	expect(stored().find(n => n.key === "lane:born1")).toMatchObject({ read: false });
	markRead({ target: "ch:9421", ts: "2026-10-22T05:00:00.000Z" });
	emit("outbox", { ts: "2026-10-22T04:00:00.000Z", kind: "out", source: "orchestrator", target: "ch:9421", text: "이미 본 답이에요" });
	expect(stored().find(n => n.key === "msg:ch:9421")).toMatchObject({ read: true });
	emit("outbox", { ts: "2026-10-22T06:00:00.000Z", kind: "out", source: "orchestrator", target: "ch:9421", text: "새 답이에요" });
	expect(stored().find(n => n.key === "msg:ch:9421")).toMatchObject({ read: false });
});

test("on load, a notice of a channel the gateway no longer has is retired; known channels, a session's own channel and read history stay", () => {
	const at = "2026-10-20T01:00:00.000Z";
	const msg = (id: string, ch: string, extra: Partial<Notice> = {}) => stale(id, `ch:${ch}`, at, { kind: "message", title: `ch:${ch}`, key: `msg:ch:${ch}`, ...extra });
	const dir = storeDir({
		lanes: ["alive"],
		channels: { chat: "1", worklog: "2", alert: "3", lanes: { alive: "500" }, homes: {}, work: { "600": "프로젝트" }, threads: {}, archiveAt: {} },
		notices: [msg("ddddddd1", "700"), msg("ddddddd2", "600"), msg("ddddddd3", "500"), msg("ddddddd4", "701", { read: true })],
	});
	const fresh = loadIn(dir);
	expect(fresh.items.map(n => n.id).sort()).toEqual(["ddddddd2", "ddddddd3", "ddddddd4"]);
	expect(fresh.unread).toBe(0);   // conversation items are never counted
	const saved: Notice[] = JSON.parse(readFileSync(join(dir, "notices.json"), "utf8"));
	expect(saved.find(n => n.id === "ddddddd1")).toMatchObject({ dismissed: true, read: true });
	// a title that is only the raw channel id is replaced by a plain label (the session's title where the channel is a session's)
	expect(saved.find(n => n.id === "ddddddd2")!.title).toBe("채널");
	expect(saved.find(n => n.id === "ddddddd3")!.title).toBe("alive");
	expect(saved.every(n => !/^ch:\d+$/.test(n.title) || n.dismissed || n.read)).toBe(true);
});

test("a session's channel messages are titled by the session; stopping the session closes them, deleting the channel closes everything of it", () => {
	writeFileSync(paths.channels, JSON.stringify({ chat: "1", worklog: "2", alert: "3", lanes: { x: "8801" }, homes: {}, work: {}, threads: {}, archiveAt: {} }));
	try {
		const items = (conv: string) => stored().filter(n => n.src === conv && !n.dismissed);
		post("ch:8801", "세션 채널의 답이에요");
		expect(items("ch:8801")).toHaveLength(1);
		expect(items("ch:8801")[0]).toMatchObject({ kind: "message", title: "로그인 고치기", read: false });
		post("ch:8802", "이름을 모르는 채널의 답이에요");
		expect(items("ch:8802")[0]!.title).toBe("채널");
		// the session stops: its channel's message item goes, another channel's stays
		expect(dropChannelNotices("ch:8801", true)).toBe(1);
		expect(items("ch:8801")).toHaveLength(0);
		expect(stored().find(n => n.src === "ch:8801")).toMatchObject({ dismissed: true, read: true });
		expect(items("ch:8802")).toHaveLength(1);
		// the channel is deleted: everything of it goes, and the session's own channel notice is found by its lane too
		expect(dropChannelNotices("ch:8802")).toBe(1);
		expect(items("ch:8802")).toHaveLength(0);
		post("ch:8801", "다시 온 답이에요");
		expect(dropLaneNotices("x")).toBeGreaterThan(0);
		expect(items("ch:8801")).toHaveLength(0);
	} finally {
		rmSync(paths.channels, { force: true });
	}
});

test("on load, message and result notices of a session stopped before the stop hook existed are closed; a running session, a pending question and newer activity stay", () => {
	const last = "2026-10-20T01:00:00.000Z", at = "2026-10-20T02:00:00.000Z", later = "2026-10-20T03:00:00.000Z";
	const msg = (id: string, ch: string, extra: Partial<Notice> = {}) => stale(id, `ch:${ch}`, at, { kind: "message", title: "채널", key: `msg:ch:${ch}`, ...extra });
	const asking: Notice = stale("eeeeeee5", "lane:asking", at, { kind: "decision", tone: "ask", decision: { to: "lane:asking", reply_to: at, options: [{ n: 1, label: "가" }], state: "open" } as Notice["decision"] });
	const dir = storeDir({
		channels: { chat: "1", worklog: "2", alert: "3", lanes: { done: "500", busy: "501", active: "502" }, homes: {}, work: {}, threads: {}, archiveAt: {} },
		records: {
			done: { status: "exited", startedAt: last, lastReportAt: last },
			busy: { status: "working", startedAt: last, lastReportAt: last },
			active: { status: "exited", startedAt: last, lastReportAt: later },
			asking: { status: "exited", startedAt: last, lastReportAt: last, pendingAsk: { text: "어느 쪽으로 할까요?", at } },
		},
		notices: [msg("eeeeeee1", "500"), msg("eeeeeee2", "501"), msg("eeeeeee3", "502"), stale("eeeeeee4", "lane:done", at), asking],
	});
	const fresh = loadIn(dir);
	expect(fresh.items.map(n => n.id).sort()).toEqual(["eeeeeee2", "eeeeeee3", "eeeeeee5"]);
	const saved: Notice[] = JSON.parse(readFileSync(join(dir, "notices.json"), "utf8"));
	expect(saved.find(n => n.id === "eeeeeee1")).toMatchObject({ dismissed: true, read: true });
	expect(saved.find(n => n.id === "eeeeeee4")).toMatchObject({ dismissed: true, read: true });
	expect(saved.find(n => n.id === "eeeeeee5")).toMatchObject({ read: false, decision: { state: "open" } });
	// the closing is stored: a second load agrees
	expect(loadIn(dir).items.map(n => n.id).sort()).toEqual(["eeeeeee2", "eeeeeee3", "eeeeeee5"]);
});

// The notice store is one per process: leave no question that still waits behind for the next test file (ignoring needs no clock, unlike resolving).
// A session's closing report must not re-open a message notice the owner already read; a running session's new message still does.
const laneFile = (name: string, rec: Record<string, unknown>) => {
	mkdirSync(join(paths.lanes, name), { recursive: true });
	writeFileSync(join(paths.lanes, name, "lane.json"), JSON.stringify({ name, title: name, startedAt: ts(), ...rec }));
};

test("a closing report of an exited session keeps a read message notice read, while a running session's new message re-opens it", () => {
	laneFile("fin1", { status: "idle" });
	const item = () => stored().find(n => n.key === "msg:lane:fin1")!;
	emit("outbox", { ts: ts(), kind: "out", source: "lane:fin1", target: "lane:fin1", text: "첫 결과예요" });
	markNoticesRead({ ids: [item().id] });
	expect(item().read).toBe(true);
	// still running: a new result re-opens it
	emit("outbox", { ts: ts(), kind: "out", source: "lane:fin1", target: "lane:fin1", text: "새 결과예요" });
	expect(item()).toMatchObject({ text: "새 결과예요", read: false });
	markNoticesRead({ ids: [item().id] });
	// the session exits, then its closing report arrives: the text updates, the notice stays read
	laneFile("fin1", { status: "exited" });
	emit("outbox", { ts: ts(), kind: "out", source: "lane:fin1", target: "lane:fin1", text: "세션을 닫습니다" });
	expect(item()).toMatchObject({ text: "세션을 닫습니다", read: true });
	// a closing report with no earlier notice is still a normal unread notice
	laneFile("fin2", { status: "exited" });
	emit("outbox", { ts: ts(), kind: "out", source: "lane:fin2", target: "lane:fin2", text: "처음 오는 마지막 보고예요" });
	expect(stored().find(n => n.key === "msg:lane:fin2")).toMatchObject({ read: false });
	rmSync(join(paths.lanes, "fin1"), { recursive: true, force: true });
	rmSync(join(paths.lanes, "fin2"), { recursive: true, force: true });
});

test("a closing report posted to the session's own channel by the orchestrator keeps the channel notice read", () => {
	writeFileSync(paths.channels, JSON.stringify({ chat: "1", lanes: { fin3: "9301" } }));
	const item = () => stored().find(n => n.key === "msg:ch:9301")!;
	try {
		laneFile("fin3", { status: "idle" });
		post("ch:9301", "진행 결과예요");
		markNoticesRead({ ids: [item().id] });
		post("ch:9301", "새 질문 결과예요");
		expect(item().read).toBe(false);
		markNoticesRead({ ids: [item().id] });
		laneFile("fin3", { status: "exited" });
		post("ch:9301", "세션이 닫혔어요");
		expect(item()).toMatchObject({ text: "세션이 닫혔어요", read: true });
	} finally {
		rmSync(paths.channels, { force: true });
		rmSync(join(paths.lanes, "fin3"), { recursive: true, force: true });
	}
});

test("the owner's own message in a conversation (Discord or web) reads that conversation's earlier notices", () => {
	post("ch:9302", "읽을 답이에요");
	expect(stored().find(n => n.key === "msg:ch:9302")).toMatchObject({ read: false });
	emit("inbox", { ts: ts(), kind: "message", source: "discord", channel: "ch:9302", text: "확인했어요" });
	expect(stored().find(n => n.key === "msg:ch:9302")).toMatchObject({ read: true });
});

afterAll(() => {
	for (const n of listNotices(NOTICE_CAP).items) if (needsAnswer(n)) ignoreNotice(n.id);
});

test("a session's [ask] that only hands a chore to the orchestrator is no owner decision", () => {
	const mk = (lane: string, text: string) => ({ ts: rts(), kind: "lane_report", source: `lane:${lane}`, lane, text }) as HubEvent;
	const chore = mk("orch-only", `[ask] 확인해 보니 같은 11개가 실패해요(1448개 통과).\n\n${NAME} 몫: 고치게 하고 알려 주세요`);
	expect(decisionsOf(chore)).toEqual([]);
	emit("inbox", chore);
	expect(stored().filter(n => n.open === "lane:orch-only" && (n.decision || n.tone === "ask"))).toEqual([]);
	// a question to the owner, or a choice block, stays a decision
	expect(decisionsOf(mk("orch-only", `[ask] 이 방향으로 갈까요?\n\n${NAME} 몫: 알려 주세요`))).toHaveLength(1);
	const block = decisionsOf(mk("orch-only", `[ask] 방향을 골라 주세요\n결정: 방향\n**1) 가\n**2) 나\n\n${NAME} 몫: 알려 주세요`));
	expect(block.length).toBeGreaterThan(0);
	expect(decisionsOf(mk("orch-only", "[ask] 이 방향으로 진행할까요"))).toHaveLength(1);
});

test("a notice title is the first sentence, short, without its period", () => {
	expect(shortTitle("확인해 보니 origin/main(a9e15d3) 단독에서도 똑같이 11개가 실패해요(1448개 통과). 나머지는 뒤에 있어요.")).toBe("확인해 보니 origin/main(a9e15d3) 단독에서도 똑같이 11개가 실패해요(1448개 통과)");
	const long = shortTitle("가나다 라마바 사아자 차카타 파하 ".repeat(6));
	expect(long.length).toBeLessThanOrEqual(61);
	expect(long.endsWith("파하…") || long.endsWith("차카타…") || long.endsWith("사아자…") || long.endsWith("라마바…") || long.endsWith("가나다…")).toBe(true);
	expect(shortTitle("끝났어요.")).toBe("끝났어요");
});

test("an answer in a monitor's settings conversation is titled with the monitor's label, and viewing that conversation reads it", () => {
	setWatchLabelResolver(name => (name === "nas-php-node-patch" ? "NAS 패치 감시" : name));
	const conv = "settings:w:nas-php-node-patch", item = () => stored().find(n => n.key === `msg:${conv}`)!;
	post(conv, "네, 아직 새 버전이 없어요");
	expect(item()).toMatchObject({ kind: "message", title: "NAS 패치 감시", open: conv, src: conv, read: false });
	expect(setViewing("tab-settings", conv, Date.now())).toMatchObject({ ok: true });
	expect(item().read).toBe(true);
	setViewing("tab-settings", "", Date.now());
	setWatchLabelResolver(name => name);
});

test("the gateway's own worklog status lines are born read; a gateway failure and the assistant's worklog post there still wait", () => {
	post("worklog", "모델 폴백: anthropic/claude-opus-5-5 → anthropic/claude-sonnet-5", { source: "gateway" });
	post("worklog", "계정을 default에서 teammate-shared로 바꿨어요. 직접 골랐기 때문이에요.", { source: "gateway" });
	post("worklog", "게이트웨이 재시작을 기다리는 중이에요: orchestrator 작업이 끝나면 다시 시작해요", { source: "gateway" });
	post("worklog", "[fail] 자동 업데이트를 하지 못했어요", { source: "gateway" });
	post("worklog", "[run] 야간 정리 시작했어요");
	expect(byText("모델 폴백: anthropic/claude-opus-5-5 → anthropic/claude-sonnet-5")[0]!.read).toBe(true);
	expect(byText("계정을 default에서 teammate-shared로 바꿨어요. 직접 골랐기 때문이에요.")[0]!.read).toBe(true);
	expect(byText("게이트웨이 재시작을 기다리는 중이에요: orchestrator 작업이 끝나면 다시 시작해요")[0]!.read).toBe(true);
	expect(byText("자동 업데이트를 하지 못했어요")[0]!.read).toBe(false);
	expect(byText("야간 정리 시작했어요")[0]!.read).toBe(false);
	expect(unreadCount()).toBe(1);   // the [run] post waits in 작업내역, not in the count
});

test("an all-clear alert is born read; a repeat updates the first alert in place and does not raise it again", () => {
	post("alert", "땃쥐: 모델 제공자가 다시 연결됐어요. 멈춰 있던 일을 이어서 처리해요.", { source: "gateway" });
	post("alert", "땃쥐: API 키 사용 끝: 오케스트레이터가 anthropic/claude-opus-5-5(구독)으로 돌아왔어요.", { source: "gateway" });
	expect(stored().filter(n => n.kind === "alert").map(n => n.read)).toEqual([true, true]);
	post("alert", "땃쥐: 모델 제공자 오류(timeout after 30000ms)", { source: "gateway" });
	const [first] = byText("땃쥐: 모델 제공자 오류(timeout after 30000ms)");
	expect(first!.read).toBe(false);
	markNoticesRead({ ids: [first!.id] });
	post("alert", "땃쥐: 모델 제공자 오류(timeout after 45000ms)", { source: "gateway", repeat: true });
	const same = stored().filter(n => n.kind === "alert" && n.text.startsWith("땃쥐: 모델 제공자 오류"));
	expect(same).toHaveLength(1);
	expect(same[0]).toMatchObject({ id: first!.id, read: true, text: "땃쥐: 모델 제공자 오류(timeout after 45000ms)" });
	expect(unreadCount()).toBe(0);
});

/* ---------- the notices screen's rules: reading apart from handling, handled, repeats ---------- */
type Listed = Notice & { cls: string; waits?: string };
const listed = (id: string): Listed | undefined => listNotices(300).items.find(n => n.id === id) as Listed | undefined;
const later = (ms = 1000) => new Date(Date.parse(ts()) + ms).toISOString();
// Runs a script in a fresh process on a throwaway data dir (like loadIn) and returns its last output line as JSON.
function scriptIn(dir: string, script: string): Record<string, any> {
	const run = Bun.spawnSync([process.execPath, "-e", script], { cwd: join(import.meta.dir, ".."), env: { ...process.env, DOTZ_DIR: dir } });
	expect(run.exitCode).toBe(0);
	return JSON.parse(run.stdout.toString().trim().split("\n").at(-1)!);
}

test("a post from the web app reads no notice; an answer from a messenger reads that room's earlier notices", () => {
	// relative to now: a watch report older than WATCH_DAYS is dropped as it is written, so a fixed date would age out of this test
	const t0 = Date.now() - 3_600_000, at = (min: number) => new Date(t0 + min * 60_000).toISOString();
	emit("outbox", { ts: at(0), kind: "out", source: "gateway", target: "ch:9511", text: "[감시9511] 새 글이 올라왔어요" });
	const item = () => stored().find(n => n.open === "ch:9511" && n.kind === "watch")!;
	expect(item().read).toBe(false);
	emit("inbox", { ts: at(1), kind: "message", source: "web", channel: "ch:9511", text: "웹에서 쓴 글" });
	expect(item().read).toBe(false);
	emit("inbox", { ts: at(2), kind: "message", source: "discord", channel: "ch:9511", text: "디스코드에서 쓴 글" });
	expect(item().read).toBe(true);
});

test("opening a mail reads its new-mail notice; looking at any other conversation never reads a monitor report", () => {
	const t0 = Date.now() - 3_600_000, at = (min: number) => new Date(t0 + min * 60_000).toISOString();
	emit("inbox", { ts: at(0), kind: "mail", incoming: true, mail: "m9521", from: "홍길동 <a@x.kr>", subject: "견적 보내드려요", conv: "mail:m9521" });
	emit("outbox", { ts: at(0), kind: "out", source: "gateway", target: "ch:9522", text: "[감시9522] 가격이 바뀌었어요" });
	const mail = () => stored().find(n => n.key === "mail:m9521")!, report = () => stored().find(n => n.open === "ch:9522")!;
	expect([mail().read, report().read]).toEqual([false, false]);
	readConversationNotices("ch:9522", at(1), "viewed");
	readConversationNotices("mail:m9521", at(1), "viewed");
	expect([mail().read, report().read]).toEqual([true, false]);
	setViewing("tab-9522", "ch:9522", Date.now());
	expect(report().read).toBe(false);
	setViewing("tab-9522", "", Date.now());
});

test("handled: the ✕ on a waiting failure reads and closes it for good, only a failure that waits can be handled, undismiss lists a dismissed notice again", () => {
	post("alert", "[fail] 디스크 9531이 찼어요", { source: "gateway" });
	const n = byText("디스크 9531이 찼어요")[0]!;
	expect(listed(n.id)).toMatchObject({ cls: "alert", waits: "fail" });
	expect(n.handled).toBeNull();
	// reading it leaves it on the owner's list
	markNoticesRead({ ids: [n.id] });
	expect(listed(n.id)).toMatchObject({ read: true, waits: "fail" });
	const seen = lastEventId();
	const r = handledNotice(n.id);
	expect(r.status).toBe(200);
	expect(r.body.item).toMatchObject({ id: n.id, read: true, cls: "alert" });
	expect(typeof (r.body.item as Notice).handled).toBe("string");
	expect(listed(n.id)!.waits).toBeUndefined();
	expect(replayAfter(seen)?.some(f => f.includes('"kind":"notice"') && f.includes(n.id) && f.includes('"handled"'))).toBe(true);
	expect(handledNotice(n.id).status).toBe(409);
	expect(handledNotice("no-such-id").status).toBe(404);
	// a finished result and a lost login are not handled with the ✕
	post("worklog", "[done] 끝난 일 9531", { update_key: "lane:hd1" });
	expect(handledNotice(stored().find(x => x.key === "lane:hd1")!.id).status).toBe(409);
	post("alert", "카톡9531: 저장된 비밀번호가 없어 다시 로그인하지 못했어요", { source: "gateway" });
	const login = byText("카톡9531: 저장된 비밀번호가 없어 다시 로그인하지 못했어요")[0]!;
	expect(listed(login.id)!.waits).toBe("login");
	expect(handledNotice(login.id).status).toBe(409);
	// undismiss
	expect(dismissNotice(n.id).ok).toBe(true);
	expect(listed(n.id)).toBeUndefined();
	const u = undismissNotice(n.id);
	expect(u.status).toBe(200);
	expect(listed(n.id)).toMatchObject({ id: n.id, read: true });
	expect(stored().find(x => x.id === n.id)!.dismissed).toBeUndefined();
	expect(undismissNotice("no-such-id").status).toBe(404);
});

test("a rerun that passed closes a failure, a new failure waits again, and a repeat of a closed one does not reopen it", () => {
	emit("inbox", { ts: rts(), kind: "lane_report", source: "lane:wt1", lane: "wt1", text: "[fail] 첫 실패" });
	const row = () => stored().find(n => n.key === "lane:wt1")!;
	expect(row().handled).toBeNull();
	expect(listed(row().id)!.waits).toBe("fail");
	emit("inbox", { ts: rts(), kind: "lane_report", source: "lane:wt1", lane: "wt1", text: "[done] 다시 돌려 성공" });
	expect(typeof row().handled).toBe("string");
	expect(listed(row().id)!.waits).toBeUndefined();
	emit("inbox", { ts: rts(), kind: "lane_report", source: "lane:wt1", lane: "wt1", text: "[fail] 또 실패" });
	expect(row()).toMatchObject({ handled: null, read: false });
	expect(listed(row().id)!.waits).toBe("fail");
	// the ✕, then the same alert again within the gateway's repeat window: stays closed
	post("alert", "[fail] 반복되는 오류 100번", { source: "gateway" });
	const alert = byText("반복되는 오류 100번")[0]!;
	handledNotice(alert.id);
	post("alert", "[fail] 반복되는 오류 200번", { source: "gateway", repeat: true });
	const same = stored().filter(n => n.kind === "alert" && n.text.startsWith("반복되는 오류"));
	expect(same).toHaveLength(1);
	expect(same[0]).toMatchObject({ id: alert.id, text: "반복되는 오류 200번", read: true });
	expect(typeof same[0]!.handled).toBe("string");
	expect(listed(alert.id)!.waits).toBeUndefined();
});

test("notices stored before handled keep their meaning: an old unread failure waits, an old read one is a past notice and stays so", () => {
	const at = "2026-10-20T01:00:00.000Z";
	const old = (id: string, extra: Partial<Notice>): Notice => stale(id, "alert", at, { kind: "alert", open: "alert", src: "alert", key: undefined, ...extra });
	const dir = storeDir({
		notices: [
			old("eeeeeee1", { tone: "fail", text: "예전 실패 하나" }),
			old("eeeeeee2", { tone: "fail", text: "읽은 예전 실패", read: true }),
			old("eeeeeee3", { tone: "", text: watchLine("카톡예전", "stopped after a password failure"), title: "알림" }),
			old("eeeeeee4", { tone: "", text: watchLine("카톡예전", "stopped after a password failure"), title: "알림", read: true }),
		],
	});
	const out = scriptIn(dir, 'import { listNotices, markNoticesRead } from "./hub/notices.ts"; const w = () => Object.fromEntries(listNotices(300).items.map(n => [n.id, (n as any).waits ?? null])); const before = w(); markNoticesRead({ ids: ["eeeeeee1", "eeeeeee3"] }); console.log(JSON.stringify({ before, after: w() })); process.exit(0);');
	expect(out.before).toEqual({ eeeeeee1: "fail", eeeeeee2: null, eeeeeee3: "login", eeeeeee4: null });
	// reading an old unread failure keeps it waiting, like one made now; the read ones are never revived
	expect(out.after).toEqual({ eeeeeee1: "fail", eeeeeee2: null, eeeeeee3: "login", eeeeeee4: null });
	const saved: Notice[] = JSON.parse(readFileSync(join(dir, "notices.json"), "utf8"));
	const at_ = (id: string) => saved.find(n => n.id === id)!;
	expect([at_("eeeeeee1").handled, at_("eeeeeee3").handled]).toEqual([null, null]);
	expect("handled" in at_("eeeeeee2") || "handled" in at_("eeeeeee4")).toBe(false);
});

test("a lost login is an alert of any kind and waits for its recovery: the watch passing, the provider back; words that only mention a login are not one", () => {
	const seen = lastEventId();
	const lost = watchLine("카톡9541", "failed 3 times in a row (exit 1)", "DOTZ_FAIL login\n세션이 끊겼어요");
	post("alert", lost, { source: "gateway" });
	const a = byText(lost)[0]!;
	expect(listed(a.id)).toMatchObject({ cls: "alert", waits: "login" });
	expect(replayAfter(seen)?.some(f => f.includes('"kind":"notice"') && f.includes('"waits":"login"'))).toBe(true);
	// a monitor report of the orchestrator's watches (kind watch) is an alert too, not news
	emit("inbox", { ts: rts(), kind: "watch", watch: "w9542", label: "쿠팡9542", reason: "needs the owner's approval for a second factor (x)", text: "DOTZ_FAIL approval" });
	const w = stored().find(n => n.kind === "watch" && n.watch === "w9542")!;
	expect(listed(w.id)).toMatchObject({ cls: "alert", waits: "login" });
	// quoting the words is not a lost login
	emit("inbox", { ts: rts(), kind: "lane_report", source: "lane:wt2", lane: "wt2", text: "[done] 로그인이 풀렸어요 문구를 고쳤어요" });
	expect(listed(stored().find(n => n.key === "lane:wt2")!.id)).toMatchObject({ cls: "result" });
	emit("inbox", { ts: rts(), kind: "watch", watch: "w9543", label: "친구9543", reason: "output changed", text: "로그인이 풀렸어요" });
	expect(listed(stored().find(n => n.kind === "watch" && n.watch === "w9543")!.id)).toMatchObject({ cls: "news" });
	expect(listed(stored().find(n => n.kind === "watch" && n.watch === "w9543")!.id)!.waits).toBeUndefined();
	// the watch passes again: the outbox line and the orchestrator's wake event both close it, read or not
	markNoticesRead({ ids: [a.id] });
	expect(listed(a.id)!.waits).toBe("login");
	emit("outbox", { ts: later(), kind: "out", source: "gateway", target: "ch:9543", text: "카톡9541: 다시 정상이에요" });
	expect(listed(a.id)!.waits).toBeUndefined();
	expect(typeof stored().find(n => n.id === a.id)!.handled).toBe("string");
	emit("inbox", { ts: later(), kind: "watch", watch: "w9542", label: "쿠팡9542", reason: "recovered", text: "ok" });
	expect(listed(w.id)!.waits).toBeUndefined();
	// the model provider: its stop text waits, its recovery line closes it
	post("alert", "땃쥐: " + blockText("auth", "acct9544", "anthropic", 1_800_000), { source: "gateway" });
	const p = stored().find(n => n.kind === "alert" && n.text.includes("acct9544"))!;
	expect(listed(p.id)).toMatchObject({ cls: "alert", waits: "login" });
	post("alert", "땃쥐: " + recoveryText(), { source: "gateway" });
	expect(listed(p.id)!.waits).toBeUndefined();
	expect(stored().find(n => n.id === p.id)).toMatchObject({ read: true });
});

test("a monitor report with nothing new is a record (log), also when it was stored before; one with news is not", () => {
	const same = watchLine("감시9551", "output changed", "글 3개 123456789", { prev: "글 3개 987654321" });
	emit("inbox", { ts: rts(), kind: "watch", watch: "w9551", label: "감시9551", reason: "output changed", text: "글 3개 123456789", prev: "글 3개 987654321" });
	emit("inbox", { ts: rts(), kind: "watch", watch: "w9551", label: "감시9551", reason: "output changed", text: "글 3개 111111111", prev: "글 3개 123456789" });
	const rows = stored().filter(n => n.kind === "watch" && n.watch === "w9551");
	// log reports never fold, so both are their own rows
	expect(rows).toHaveLength(2);
	expect(rows.map(n => listed(n.id)!.cls)).toEqual(["log", "log"]);
	expect(rows[0]!.text).toContain("내용은 그대로이고");
	emit("inbox", { ts: rts(), kind: "watch", watch: "w9552", label: "감시9552", reason: "output changed", text: "글 4개 새로 올라옴", prev: "글 3개" });
	expect(listed(stored().find(n => n.watch === "w9552")!.id)!.cls).toBe("news");
	const dir = storeDir({ notices: [stale("fffffff1", "alert", new Date(Date.now() - 3_600_000).toISOString(), { kind: "watch", title: "감시9551", text: same, open: "alert", src: "alert", key: undefined })] });
	expect(loadIn(dir).items.map(n => (n as Listed).cls)).toEqual(["log"]);
});

test("reports stored before 2026-11-10 read as new ones do: a schedule by its short name, a match that lists items by its count", () => {
	const at = new Date(Date.now() - 3_600_000).toISOString();
	const dir = storeDir({
		notices: [
			stale("fffffff2", "main", at, { kind: "watch", title: "예약", text: "flaky-tests 3차: 맥이 한가한지(uptime load < 10) 보고 origin/main에서 …", key: undefined }),
			stale("fffffff3", "alert", at, { kind: "watch", title: "깃허브 PR·이슈 확인", text: "깃허브 PR·이슈 확인: 조건에 맞는 결과가 나왔어요\n새 PR: 새 저장소 목록 표시", open: "alert", src: "alert", key: undefined }),
		],
	});
	const text = Object.fromEntries(loadIn(dir).items.map(n => [n.id, n.text]));
	expect(text.fffffff2).toBe("flaky-tests 3차");
	expect(text.fffffff3).toBe("깃허브 PR·이슈 확인: 새 PR 1건\n새 저장소 목록 표시");
});

test("a report that found nothing new is a log, in the alert and the monitor paths alike; one that found something stays listed", () => {
	emit("outbox", { ts: ts(), kind: "out", source: "gateway", target: "ch:9571", text: "[감시9571] 확인했어요. 바뀐 곳은 없어요." });
	emit("outbox", { ts: ts(), kind: "out", source: "gateway", target: "alert", text: "[감시9572] 확인했어요. 바뀐 곳은 없어요." });
	emit("outbox", { ts: ts(), kind: "out", source: "gateway", target: "ch:9573", text: "[감시9573] 가격이 바뀌었어요" });
	const cls = (s: string) => (listNotices(300).items as Listed[]).find(n => n.title.includes(s) || n.text.includes(s))?.cls;
	expect([cls("감시9571"), cls("감시9572"), cls("감시9573")]).toEqual(["log", "log", "news"]);
});

test("a monitor failure the owner closed stays closed when the same failure folds into it again", () => {
	const fail = (text: string) => emit("outbox", { ts: ts(), kind: "out", source: "gateway", target: "ch:9581", text: "[fail] [감시9581] " + text });
	fail("페이지가 열리지 않아요");
	const n = stored().find(x => x.kind === "watch" && x.title === "감시9581")!;
	expect(listed(n.id)).toMatchObject({ waits: "fail" });
	expect(handledNotice(n.id).status).toBe(200);
	fail("페이지가 또 열리지 않아요");
	const row = stored().filter(x => x.kind === "watch" && x.title === "감시9581");
	expect(row).toHaveLength(1);
	expect(row[0]!.read).toBe(true);
	expect(row[0]!.repeats).toHaveLength(1);
	expect((listed(n.id) as Listed).waits).toBeUndefined();
});

test("monitor reports within a day fold into one unread row, newest first, 20 x 160 chars; a day later, or an alert repeat, keeps the same bounds", () => {
	const base = Date.now() - 3 * 3_600_000;
	const rep = (min: number, text: string) => emit("outbox", { ts: new Date(base + min * 60_000).toISOString(), kind: "out", source: "gateway", target: "ch:9561", text: "[감시9561] " + text });
	for (let i = 0; i < 25; i++) rep(i, "새 글 " + i + " " + "가".repeat(300));
	const rows = () => stored().filter(n => n.kind === "watch" && n.title === "감시9561");
	expect(rows()).toHaveLength(1);
	const row = rows()[0]!;
	expect(row.text.startsWith("새 글 24")).toBe(true);
	expect(row.repeats).toHaveLength(20);
	expect(row.repeats![0]!.text.startsWith("새 글 23")).toBe(true);
	expect(row.repeats!.every(r => r.text.length <= 160)).toBe(true);
	markNoticesRead({ ids: [row.id] });
	expect(rows()[0]!.read).toBe(true);
	rep(30, "또 새 글");
	expect(rows()).toHaveLength(1);
	expect(rows()[0]).toMatchObject({ read: false, text: "또 새 글" });
	// more than a day after the row's last report: its own row
	rep(26 * 60, "다음 날 새 글");
	expect(rows()).toHaveLength(2);
	// an alert repeat keeps the same cap and the read state
	post("alert", "땃쥐9562: 오류 0번 " + "나".repeat(400), { source: "gateway" });
	const first = stored().find(n => n.kind === "alert" && n.text.startsWith("땃쥐9562"))!;
	markNoticesRead({ ids: [first.id] });
	for (let i = 1; i <= 25; i++) post("alert", "땃쥐9562: 오류 " + i + "번 " + "나".repeat(400), { source: "gateway", repeat: true });
	const alerts = stored().filter(n => n.kind === "alert" && n.text.startsWith("땃쥐9562"));
	expect(alerts).toHaveLength(1);
	expect(alerts[0]).toMatchObject({ id: first.id, read: true });
	expect(alerts[0]!.repeats).toHaveLength(20);
	expect(alerts[0]!.repeats!.every(r => r.text.length <= 160)).toBe(true);
});

test("the count is what the 알림 screen lists: conversation and log items do not count, and reading the listed one reaches 0", () => {
	post("main", "대화 답변 하나");
	post("worklog", "[run] 기록 한 줄");
	const conv = stored().find(n => n.key === "msg:main")!;
	const log = byText("기록 한 줄")[0]!;
	expect([conv.read, log.read]).toEqual([false, false]);
	expect([classOfNotice(conv).cls, classOfNotice(log).cls]).toEqual(["conv", "log"]);
	expect(unreadCount()).toBe(0);

	post("worklog", "[done] 끝난 일");
	const done = byText("끝난 일")[0]!;
	expect(classOfNotice(done).cls).toBe("result");
	expect(unreadCount()).toBe(1);
	markNoticesRead({ ids: [done.id] });
	expect(unreadCount()).toBe(0);
	expect(stored().find(n => n.id === conv.id)!.read).toBe(false);   // nothing stored changes: the conversation item stays unread
});

// dotz_send `resolves` from one session closes only its own conversations' questions (a pick in one conversation answered another's question before).
const askIn = (target: string) => emit("outbox", { ts: rts(), kind: "out", source: "orchestrator", target, text: `[ask] 배포할까요?\n결정: 배포 ${target}\n**1) 네**\n**2) 아니오**` });
const openIn = (conv: string) => stored().some(n => n.decision?.state === "open" && n.open === conv);
const within = (session: string) => (conv: string | undefined) => (conv?.startsWith("ch:") || conv?.startsWith("mail:") ? conv : "main") === session;

test("a session's `resolves` closes only the questions of its own conversations; ids still name any, and no filter keeps the old reach", () => {
	for (const target of ["web", "ch:111", "mail:k1"]) askIn(target);
	expect(resolveNotices({ match: "배포" }, within("ch:111")).resolved).toBe(1);
	expect(openIn("ch:111")).toBe(false);
	// a web conversation's question is stored under main
	expect(openIn("main") && openIn("mail:k1")).toBe(true);
	expect(resolveNotices({ match: "배포" }, within("main")).resolved).toBe(1);
	expect(openIn("main")).toBe(false);
	expect(openIn("mail:k1")).toBe(true);
	const mail = stored().find(n => n.open === "mail:k1")!;
	expect(resolveNotices({ ids: [mail.id] }, within("ch:111")).resolved).toBe(1);
	expect(openIn("mail:k1")).toBe(false);
	for (const target of ["web", "ch:111"]) emit("outbox", { ts: rts(), kind: "out", source: "orchestrator", target, text: `[ask] 출시할까요?\n결정: 출시 ${target}\n**1) 네**\n**2) 아니오**` });
	expect(resolveNotices({ match: "출시" }).resolved).toBe(2);
});

test("a quiet check's inbox event (source gateway) makes no 예약 notice; an owner schedule still does", () => {
	emit("inbox", { ts: ts(), kind: "schedule", source: "gateway", channel: "web", id: "a1,b2", ids: ["a1", "b2"], quiet: true, text: "점검 하나 둘" });
	expect(byText("점검 하나 둘")).toEqual([]);
	emit("inbox", { ts: ts(), kind: "schedule", source: "schedule", channel: "web", id: "c3", text: "알려 줄 일" });
	expect(byText("알려 줄 일")).toMatchObject([{ kind: "watch", title: "예약" }]);
});
