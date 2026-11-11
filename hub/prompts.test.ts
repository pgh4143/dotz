// The prompt queue: a steered owner message that was answered (dotz_send reply_to, or the turn's own answer) is never
// delivered again as a turn, a reply_to settles the prompt it names, and a finished prompt is answered once.
import { expect, test } from "bun:test";
import { emit, answeredIds, historyEvents } from "./events.ts";
import { outEvent } from "./projectchat.ts";
import { createPrompts, type OwnerMessage, type Pending, type PromptDeps, type WorkLink, type WorkRow } from "./prompts.ts";
import { eventsFromFrame } from "./runtime/omp.ts";
import { createWaitCheck, QUIET_MS } from "./waitcheck.ts";
import { isOpenNudge } from "./i18n.ts";
import { en } from "./i18n-en.ts";
import { ko } from "./i18n-ko.ts";

function setup(answered: string[] = [], recent: OwnerMessage[] = [], extra: Partial<PromptDeps> = {}) {
	const state = { working: false, steerFails: false, delivered: [] as string[], steered: [] as string[], posts: [] as { target: string; text: string; replyTo?: string }[], saved: [] as Pending[][] };
	const q = createPrompts({
		deliver: text => state.delivered.push(text),
		steer: text => (state.steered.push(text), !state.steerFails),
		working: () => state.working,
		note: (_t, _r, text) => `[note] ${text}`,
		isNote: text => text.startsWith("[note]"),
		post: async (target, text, replyTo) => (state.posts.push({ target, text, replyTo }), { delivered: true }),
		clearProgress: () => {},
		persist: open => state.saved.push(open),
		log: () => {},
		answered,
		recent: () => recent,
		...extra,
	});
	const open = () => state.saved.at(-1) ?? [];
	// omp starts a turn with prompt X, then a message arrives while it works.
	const startTurn = (text: string, reply: { target: string; replyTo?: string }) => {
		q.deliver(text, reply);
		state.working = true;
		q.onPrompt(text);
	};
	return { q, state, open, startTurn };
}

const chat = (replyTo: string) => ({ target: "chat", replyTo });

test("a steered message answered with dotz_send reply_to is not delivered again, at turn end or on replay", async () => {
	const { q, state, open, startTurn } = setup();
	startTurn("first", chat("m1"));
	q.deliver("second", chat("m2"));
	expect(state.steered).toEqual(["[note] second"]);

	q.sent("chat", "quick answer", "m2");
	expect(open().map(p => p.text)).toEqual(["first"]);
	q.markAnswered("m1"); // the turn's own answer to the first one
	q.onAnswer("done with first");
	state.working = false;
	q.redeliverSteered();
	expect(state.delivered).toEqual(["first"]);

	// A restart replays what pending.json still holds: the answered message is not in it, and would be skipped anyway.
	const replayed = q.replay([{ text: "second", at: Date.now(), target: "chat", replyTo: "m2" }], t => t);
	expect(replayed).toBe(0);
	expect(state.delivered).toEqual(["first"]);
});

test("a harness reminder injected mid-turn does not drop the turn's answer", async () => {
	const { q, state, startTurn } = setup();
	startTurn("fix it", { target: "web" });
	q.onPrompt("<system-reminder>Detached eval cell x (js) completed.</system-reminder>");
	q.onAnswer("fixed");
	expect(state.posts).toEqual([{ target: "web", text: "fixed", replyTo: undefined }]);
});

test("a turn that ends without a stop answer sends its last text once", () => {
	const { q, state, startTurn } = setup();
	startTurn("fix it", { target: "web" });
	q.onText("half done, here is where it stands");
	q.settleTurn();
	q.settleTurn();
	expect(state.posts).toEqual([{ target: "web", text: "half done, here is where it stands", replyTo: undefined }]);
	// A real text that comes after is not lost: it answers no one and still reaches the conversation.
	q.onAnswer("late stop");
	expect(state.posts.slice(1)).toEqual([{ target: "web", text: "late stop", replyTo: undefined }]);
});

test("a turn answered normally gets nothing more at idle", () => {
	const { q, state, startTurn } = setup();
	startTurn("fix it", { target: "web" });
	q.onText("fixed");
	q.onAnswer("fixed");
	q.settleTurn();
	expect(state.posts).toHaveLength(1);
});

test("a message whose steer finds no running turn goes in as a normal prompt", () => {
	const { q, state, startTurn } = setup();
	startTurn("first", chat("m1"));
	state.steerFails = true;
	q.deliver("second", chat("m2"));
	expect(state.delivered).toEqual(["first", "second"]);
	q.redeliverSteered();
	expect(state.delivered).toEqual(["first", "second"]);
});

test("restart replay skips messages the outbox log shows as answered", () => {
	const { q, state } = setup(["old1"]);
	const n = q.replay(
		[
			{ text: "answered", at: Date.now(), target: "chat", replyTo: "old1" },
			{ text: "open", at: Date.now(), target: "chat", replyTo: "old2" },
			{ text: "stale", at: Date.now() - 13 * 3600_000, target: "chat", replyTo: "old3" },
		],
		t => `replay ${t}`,
	);
	expect(n).toBe(1);
	expect(state.delivered).toEqual(["replay open"]);
});

test("answered ids are read back from the outbox log tail", () => {
	emit("outbox", { ts: new Date().toISOString(), kind: "out", source: "orchestrator", target: "chat", text: "hi", reply_to: "seed-msg-1" });
	emit("outbox", { ts: new Date().toISOString(), kind: "out", source: "orchestrator", target: "chat", text: "no reply", reply_to: null });
	emit("outbox", { ts: new Date().toISOString(), kind: "out", source: "orchestrator", target: "chat", text: "progress", update_key: "k" });
	const ids = answeredIds();
	expect(ids).toContain("seed-msg-1");
	expect(ids.every(id => typeof id === "string" && id.length > 0)).toBe(true);
});

test("with two steered messages on a channel, a reply_to answer to the second settles the second", () => {
	const { q, state, open, startTurn } = setup();
	startTurn("first", chat("m1"));
	q.deliver("one", chat("s1"));
	q.deliver("two", chat("s2"));
	q.sent("chat", "answer to two", "s2");
	expect(open().map(p => p.text)).toEqual(["first", "one"]);

	// Without a reply_to it falls back to the first steered prompt of the channel the model has seen.
	q.onPrompt(state.steered[0]!);
	q.sent("chat", "plain note");
	expect(open().map(p => p.text)).toEqual(["first"]);

	// A reply_to that names no steered prompt settles nothing.
	q.deliver("three", chat("s3"));
	q.sent("chat", "about something else", "unrelated");
	expect(open().map(p => p.text)).toEqual(["first", "three"]);
	expect(state.delivered).toEqual(["first"]);
});

test("steered prompts are redelivered when the orchestrator goes idle, not at each assistant stop", () => {
	const { q, state, startTurn } = setup();
	startTurn("first", chat("m1"));
	q.deliver("second", chat("m2"));
	q.onAnswer("answer one");
	expect(state.delivered).toEqual(["first"]);
	q.redeliverSteered();
	expect(state.delivered).toEqual(["first", "second"]);
});

test("a prompt whose final answer was posted gets no further auto posts from later stops of the same turn", async () => {
	const { q, state, open, startTurn } = setup();
	startTurn("first", chat("m1"));
	q.onAnswer("final");
	// omp continues with a steered note (ignored as a prompt) and stops again.
	q.onPrompt("[note] second");
	q.onAnswer("continued");
	q.onAnswer("continued again");
	await Promise.resolve();
	expect(state.posts).toEqual([{ target: "chat", text: "final", replyTo: "m1" }]);
	expect(open()).toEqual([]);
});

test("answer only when ready: an early send to the asking channel is held and goes out ahead of the final answer", () => {
	const { q, state, startTurn } = setup();
	startTurn("fix the build", chat("m1"));
	expect(q.holdEarly("chat", "몇 분 안에 끝내고 알려 드릴게요")).toBe(true);
	expect(q.holdEarly("ch:9", "elsewhere")).toBe(false); // another channel is not this turn's answer
	expect(state.posts).toEqual([]);
	q.onAnswer("고쳤어요. 테스트 통과.");
	expect(state.posts).toEqual([{ target: "chat", text: "몇 분 안에 끝내고 알려 드릴게요\n\n고쳤어요. 테스트 통과.", replyTo: "m1" }]);
});

test("the final answer of a turn started from a work channel lands in that project's web chat once", () => {
	const CH = "ch:1500000000001908448";
	const post: PromptDeps["post"] = async (target, text, replyTo) => (emit("outbox", outEvent({ ts: new Date().toISOString(), kind: "out", source: "orchestrator", target, text, reply_to: replyTo ?? null }, () => undefined)), { delivered: true });
	const { q, startTurn } = setup([], [], { post });
	startTurn("web msg in the project", { target: CH, replyTo: "5eeba27e" });
	q.onAnswer("프로젝트 최종 답");
	q.onAnswer("프로젝트 최종 답"); // a later stop of the same turn adds nothing
	expect(historyEvents(CH, 50).filter(e => e.text === "프로젝트 최종 답")).toHaveLength(1);
});

test("a full answer to a message steered in mid-turn is not held", () => {
	const { q, startTurn } = setup();
	startTurn("long work", chat("m1"));
	q.deliver("quick question", chat("m2"));
	expect(q.holdEarly("chat", "answer to the quick one", "m2")).toBe(false);
	expect(q.holdEarly("chat", "answer without reply_to")).toBe(false);
});

test("a held text repeated as the final answer is posted once", () => {
	const { q, state, startTurn } = setup();
	startTurn("q", chat("m1"));
	q.holdEarly("chat", "the answer");
	q.onAnswer("the answer");
	expect(state.posts.map(p => p.text)).toEqual(["the answer"]);
});

test("a web message steered mid-turn through the queue keeps the running turn's answer paired (raw text would unpair it)", async () => {
	const { q, state, startTurn } = setup();
	startTurn("[inbox] notifications only for start/done/ask", { target: "web" });
	q.deliver("[inbox] label the context chips", { target: "web" });
	expect(state.steered).toEqual(["[note] [inbox] label the context chips"]);
	q.onPrompt("[note] [inbox] label the context chips");
	q.onAnswer("both fixed");
	await Promise.resolve();
	expect(state.posts).toEqual([{ target: "web", text: "both fixed", replyTo: undefined }]);

});

// 2026-10-20 10:43Z and 10:52Z: the old web steer path sent raw inbox text past the queue; admitted mid-turn it was a user frame
// that matched nothing, it replaced the running turn's prompt with nothing, and the finished answer had no prompt to go to.
test("a user frame that matches nothing delivered leaves the running turn's prompt in place", async () => {
	const { q, state, startTurn } = setup();
	startTurn("[inbox] first", { target: "web" });
	q.onPrompt("[inbox] steered raw");
	q.onPrompt("[inbox] and another raw one");
	q.onAnswer("both fixed");
	await Promise.resolve();
	expect(state.posts).toEqual([{ target: "web", text: "both fixed", replyTo: undefined }]);
});

// The OmO session of 2026-10-20 12:49Z: the gateway restarted mid-delegation, the resumed session was woken by the dead task
// worker's completion, and its report (a run no delivered prompt started) was dropped.
test("an answer to a run no prompt started goes home, however recent the owner's messages", async () => {
	const now = Date.now();
	// A new process: the prompts are gone, the inbox log tail names the owner's messages.
	const { q, state } = setup([], [{ target: "web", at: now - 3 * 60_000 }]);
	q.onAnswer("README is updated and pushed: 2359b25");
	await Promise.resolve();
	expect(state.posts).toEqual([{ target: "web", text: "README is updated and pushed: 2359b25", replyTo: undefined }]);

	// The same process: the owner's message was answered ("a worker is on it"), the turn went idle, a wake starts a new run.
	const live = setup();
	live.q.deliver("[inbox] update the README", { target: "web", owner: true });
	live.q.onPrompt("[inbox] update the README");
	live.q.onAnswer("a worker is on it");
	live.q.settleTurn();
	live.q.onAnswer("The README is done and pushed.");
	await Promise.resolve();
	expect(live.state.posts.map(p => p.text)).toEqual(["a worker is on it", "The README is done and pushed."]);
});

test("an answer without a prompt goes home, not to an unanswered owner message's conversation, and names no message", async () => {
	const now = Date.now();
	const { q, state } = setup(["b"], [
		{ target: "ch:1", replyTo: "a", at: now - 10 * 60_000 },
		{ target: "web", replyTo: "b", at: now - 5 * 60_000 },
	]);
	q.onAnswer("for the unanswered one");
	await Promise.resolve();
	expect(state.posts).toEqual([{ target: "web", text: "for the unanswered one", replyTo: undefined }]);
});

test("a real answer no label explains is never dropped: it goes home whatever owner messages exist", async () => {
	const now = Date.now();
	const old = setup([], [
		{ target: "web", replyTo: "a", at: now - 90 * 60_000 },
		{ target: "ch:1", replyTo: "b", at: now - 31 * 60_000 },
	]);
	old.q.onAnswer("a late report");
	await Promise.resolve();
	expect(old.state.posts).toEqual([{ target: "web", text: "a late report", replyTo: undefined }]);

	const none = setup();
	none.q.onAnswer("a report with no message at all");
	await Promise.resolve();
	expect(none.state.posts).toEqual([{ target: "web", text: "a report with no message at all", replyTo: undefined }]);

	for (const quiet of ["-", "ok", "[later]"]) none.q.onAnswer(quiet);
	await Promise.resolve();
	expect(none.state.posts).toHaveLength(1);
});

test("keepalive replies and very short texts go nowhere, and an answer already sent with dotz_send is not sent again", async () => {
	const { q, state } = setup([], [{ target: "web", at: Date.now() }]);
	for (const t of ["ok", "-", "abc", "  "]) q.onAnswer(t);
	q.sent("web", "the report is ready");
	q.onAnswer("the report is ready");
	await Promise.resolve();
	expect(state.posts).toEqual([]);
});

// The same cases through OmO's frames: agent_start, a delivered prompt, a message admitted into the run, the answer, agent_end.
test("OmO frames of a run with a raw mid-run message still deliver the answer", async () => {
	const { q, state } = setup();
	q.deliver("[dotz inbox] web\nfirst", { target: "web", owner: true });
	const frames = [
		{ type: "agent_start" },
		{ type: "message_end", message: { role: "user", content: "[dotz inbox] web\nfirst" } },
		{ type: "message_end", message: { role: "user", content: [{ type: "text", text: "[dotz inbox] web\nsecond, admitted mid-run" }] } },
		{ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "both are done" }] } },
		{ type: "agent_end" },
	];
	for (const f of frames)
		for (const ev of eventsFromFrame(f, new Map())) {
			if (ev.type === "user") q.onPrompt(ev.text);
			else if (ev.type === "assistant" && ev.text && ev.stop === "stop") q.onAnswer(ev.text);
			else if (ev.type === "turn_end") q.settleTurn();
		}
	await Promise.resolve();
	expect(state.posts).toEqual([{ target: "web", text: "both are done", replyTo: undefined }]);
});

test("words around [later] reach the owner as a note, and the request stays open until the worker's answer", async () => {
	for (const said of ["`[later]` 이동이 끝나면 등록할게요.\n\n[later]", "이동이 끝나면 등록할게요.\n\n`[later]`", "이동이 끝나면 등록할게요. [later]"]) {
		const notes: { target: string; text: string }[] = [];
		const { q, state, startTurn } = setup([], [], { interim: (target, text) => notes.push({ target, text }) });
		startTurn("옮겨 줘", { target: "web", replyTo: "m1" });
		q.workersSpawned([{ id: "st_move" }]);
		q.onAnswer(said);
		state.working = false;
		q.settleTurn();
		expect(notes).toEqual([{ target: "web", text: "이동이 끝나면 등록할게요." }]);
		expect(state.posts).toEqual([]);
		expect(q.deferredOpen().map(d => d.replyTo)).toEqual(["m1"]);
		q.workersDone(["st_move"]);
		q.onAnswer("`[later]` 복사 중이에요.\n\n[later]");
		expect(notes.at(-1)).toEqual({ target: "web", text: "복사 중이에요." });
		expect(q.deferredOpen().map(d => d.replyTo)).toEqual(["m1"]);
		q.onAnswer("다 옮겼어요");
		await Promise.resolve();
		expect(state.posts).toEqual([{ target: "web", text: "다 옮겼어요", replyTo: "m1" }]);
		expect(q.deferredOpen()).toEqual([]);
	}
});

test("a dotz_send that holds [later] leaves the request open, a sentence about the word answers as usual", async () => {
	const { q, state, startTurn } = setup();
	startTurn("옮겨 줘", { target: "web", replyTo: "m1" });
	q.workersSpawned([{ id: "st_move" }]);
	q.onAnswer("[later]");
	state.working = false;
	q.settleTurn();
	q.sent("web", "복사 중이에요. [later]", "m1");
	expect(q.deferredOpen().map(d => d.replyTo)).toEqual(["m1"]);
	const about = setup();
	about.startTurn("왜 그래?", { target: "web", replyTo: "m2" });
	about.q.onAnswer("그 턴은 `[later]`로 끝나요.");
	await Promise.resolve();
	expect(about.state.posts).toEqual([{ target: "web", text: "그 턴은 `[later]`로 끝나요.", replyTo: "m2" }]);
	expect(about.q.deferredOpen()).toEqual([]);
});

test("a turn that defers to a background worker sends nothing; the run the worker's result wakes answers that request", async () => {
	const { q, state, open, startTurn } = setup([], []);
	startTurn("fix the sidebar", { target: "web" });
	q.workersSpawned([{ id: "st_sidebar" }]);
	q.onAnswer("[later]");
	state.working = false;
	q.settleTurn();
	expect(state.posts).toEqual([]);
	expect(open().map(p => p.text)).toEqual(["fix the sidebar"]);
	expect(q.waitingOnWorkers()).toBe(1);
	expect(q.deferredOpen().map(d => d.target)).toEqual(["web"]);
	// A wake before the result is in: still waiting, nothing sent.
	q.workersDone(["st_sidebar"]);
	q.onAnswer("[later]");
	expect(state.posts).toEqual([]);
	// The worker's result wakes a run with no user prompt of ours.
	q.onAnswer("sidebar fixed, tests pass");
	expect(state.posts).toEqual([{ target: "web", text: "sidebar fixed, tests pass", replyTo: undefined }]);
	expect(q.waitingOnWorkers()).toBe(0);
	expect(q.deferredOpen()).toEqual([]);
	// A later promptless answer reopens nothing: it reaches the conversation and the settled request stays settled.
	q.onAnswer("another unrelated note");
	expect(state.posts.slice(1)).toEqual([{ target: "web", text: "another unrelated note", replyTo: undefined }]);
	expect(q.waitingOnWorkers()).toBe(0);
	expect(q.deferredOpen()).toEqual([]);
});

test("a deferred turn posts one short note naming the worker, so its conversation is not silent", () => {
	const announced: { target: string; text: string; worker?: string }[] = [];
	const { q, state, startTurn } = setup([], [], { announce: (target, text, worker) => announced.push({ target, text, ...(worker ? { worker } : {}) }), workFor: () => ({ id: "w1", description: "샘플 연결 스크립트 흐름도 HTML" }) });
	startTurn("이거 파일 전부 흐름도로 재구성해", { target: "th:1500000000005057364" });
	q.onAnswer("[later]");
	// The worker's id rides along: the web's system line opens that worker and shows its state.
	expect(announced).toEqual([{ target: "th:1500000000005057364", text: "백그라운드 작업으로 맡겼어요: 샘플 연결 스크립트 흐름도 HTML", worker: "w1" }]);
	// The note is not the answer: nothing was posted to the request and it still waits for the worker.
	expect(state.posts).toEqual([]);
	expect(q.deferredOpen().map(d => d.target)).toEqual(["th:1500000000005057364"]);
	// A worker the store does not list yet still gets a readable note, never an empty message.
	const bare = setup([], [], { announce: (target, text) => announced.push({ target, text }) });
	bare.startTurn("메일 답장 써 줘", { target: "mail:k1" });
	bare.q.onAnswer("[later]");
	expect(announced.at(-1)).toEqual({ target: "mail:k1", text: "백그라운드 작업으로 맡겼어요" });
	expect(announced.at(-1)?.text.trim()).not.toBe("");
});

// Join-note wiring as outbound.ts makeQueue does it: one line led by JOIN, found again by a line scan.
const JOIN = "[join]";
const joinDeps = (running: { id: string; description: string } | undefined) => ({
	workFor: () => running,
	joinNote: (w: { id: string; description: string }) => `${JOIN} ${w.description} (${w.id})`,
	hasJoinNote: (text: string) => text.split("\n").some(l => l.startsWith(JOIN)),
});
const worker = { id: "t1", description: "유튜브 답글 게시" };

test("a new owner turn for a conversation with a running worker starts with a note naming it, and pairs by the delivered text", () => {
	const { q, state, startTurn } = setup([], [], joinDeps(worker));
	const th = { target: "th:1", replyTo: "m1", owner: true };
	q.deliver("그거 2번으로 해줘", th);
	expect(state.delivered).toEqual(["[join] 유튜브 답글 게시 (t1)\n\n그거 2번으로 해줘"]);
	// omp starts the delivered text: it pairs with the stored prompt, so the turn's answer still goes to the message.
	q.onPrompt(state.delivered[0]!);
	q.onAnswer("됐어요");
	expect(state.posts).toEqual([{ target: "th:1", text: "됐어요", replyTo: "m1" }]);
	// Not for a message steered into a running turn, a non-owner delivery, or a conversation without a running worker.
	startTurn("running", { target: "th:1", replyTo: "m0" });
	q.deliver("steer me", { target: "th:1", replyTo: "m2", owner: true });
	expect(state.steered).toEqual(["[note] steer me"]);
	const mail = setup([], [], joinDeps(worker));
	mail.q.deliver("mail", { target: "th:1" });
	expect(mail.state.delivered).toEqual(["mail"]);
	const idle = setup([], [], joinDeps(undefined));
	idle.q.deliver("plain", { target: "th:2", replyTo: "m3", owner: true });
	expect(idle.state.delivered).toEqual(["plain"]);
});

test("a restart replay does not stack a second join note on a text that already carries it", () => {
	const { q, state, open } = setup([], [], joinDeps(worker));
	q.deliver("그거 2번으로 해줘", { target: "th:1", replyTo: "m1", owner: true });
	const stored = open();
	expect(stored.map(p => p.text)).toEqual(["[join] 유튜브 답글 게시 (t1)\n\n그거 2번으로 해줘"]);
	const again = setup([], [], joinDeps(worker));
	again.q.replay(stored, t => `[replay]\n${t}`);
	expect(again.state.delivered).toEqual(["[replay]\n[join] 유튜브 답글 게시 (t1)\n\n그거 2번으로 해줘"]);
	// Even a replayed owner delivery whose text carries the note gets no second one.
	again.q.deliver(stored[0]!.text, { target: "th:1", replyTo: "m9", owner: true });
	expect(again.state.delivered.at(-1)).toBe(stored[0]!.text);
});

test("repeated deferrals announce one receipt per worker, a new worker gets its own, and the plain note is sent once until a real answer", () => {
	const announced: string[] = [];
	let running: { id: string; description: string } | undefined = worker;
	const { q, state, startTurn } = setup([], [], { announce: (_t, text) => announced.push(text), workFor: () => running });
	const defer = (id: string) => {
		startTurn(`follow-up ${id}`, { target: "th:1", replyTo: id });
		q.onAnswer("[later]");
		state.working = false;
		q.settleTurn();
	};
	defer("m1");
	defer("m2");
	defer("m3");
	expect(announced).toEqual(["백그라운드 작업으로 맡겼어요: 유튜브 답글 게시"]);
	expect(q.deferredOpen().length).toBe(3);
	running = { id: "t2", description: "다른 일" };
	defer("m4");
	defer("m5");
	expect(announced.at(-1)).toBe("백그라운드 작업으로 맡겼어요: 다른 일");
	expect(announced.length).toBe(2);
	// Another conversation has its own receipt.
	startTurn("elsewhere", { target: "th:2", replyTo: "m6" });
	q.onAnswer("[later]");
	expect(announced.length).toBe(3);

	// No worker listed: the plain note once, again only after a non-deferred answer there (or when a worker shows up).
	running = undefined;
	announced.length = 0;
	const plain = (id: string) => {
		state.working = false;
		startTurn(`p ${id}`, { target: "th:3", replyTo: id });
		q.onAnswer("[later]");
	};
	plain("n1");
	plain("n2");
	expect(announced).toEqual(["백그라운드 작업으로 맡겼어요"]);
	running = worker;
	plain("n3");
	expect(announced.length).toBe(2);
	running = undefined;
	startTurn("quick", { target: "th:3", replyTo: "n4" });
	q.onAnswer("done");
	plain("n5");
	expect(announced.length).toBe(3);
});

test("a deferred request answered with dotz_send reply_to from another turn is settled", async () => {
	const { q, state, startTurn } = setup();
	startTurn("fix it", chat("m1"));
	q.onAnswer("[later]");
	state.working = false;
	q.settleTurn();
	startTurn("what time is it", chat("m2"));
	q.sent("chat", "fix done", "m1");
	q.onAnswer("it is noon");
	expect(state.posts).toEqual([{ target: "chat", text: "it is noon", replyTo: "m2" }]);
	expect(q.waitingOnWorkers()).toBe(0);
});

const web = (replyTo?: string) => ({ target: "web", replyTo });

test("an answered web prompt is not replayed after a restart, an unanswered one is replayed exactly once", async () => {
	const before = setup();
	before.startTurn("hello", web("wq-1"));
	before.q.deliver("still open", web("wq-2"));
	before.q.onAnswer("hi");
	await Promise.resolve();
	expect(before.state.posts).toEqual([{ target: "web", text: "hi", replyTo: "wq-1" }]);
	expect(before.q.isAnswered("wq-1")).toBe(true);
	// pending.json as the gateway left it: the answered message was still listed when the process died.
	const pending = [
		{ text: "hello", at: Date.now(), target: "web", replyTo: "wq-1" },
		{ text: "still open", at: Date.now(), target: "web", replyTo: "wq-2" },
	];
	// The restart reads the answers back from the outbox log, as main.ts does (answeredIds).
	emit("outbox", { ts: new Date().toISOString(), kind: "out", source: "orchestrator", target: "web", text: "hi", reply_to: "wq-1" });
	const after = setup(answeredIds());
	expect(after.q.replay(pending, t => `replay ${t}`)).toBe(1);
	expect(after.state.delivered).toEqual(["replay still open"]);
	expect(after.open()).toEqual([{ text: "replay still open", at: expect.any(Number), target: "web", replyTo: "wq-2" }]);
});

test("a steered prompt the model saw is covered by the turn's final answer and is not delivered again", async () => {
	const { q, state, open, startTurn } = setup();
	startTurn("first", web("wc-1"));
	q.deliver("second", web("wc-2"));
	q.deliver("other channel", chat("wc-3"));
	expect(state.steered).toHaveLength(2);
	q.onPrompt(state.steered[0]!);
	q.onAnswer("answers both");
	await Promise.resolve();
	expect(q.isAnswered("wc-2")).toBe(true);
	state.working = false;
	q.redeliverSteered();
	// Only the message whose note the model never got comes back.
	expect(state.delivered).toEqual(["first", "other channel"]);
	expect(open().map(p => p.replyTo)).toEqual(["wc-3"]);
});

test("a steered web prompt the final answer did not cover is delivered again at idle", () => {
	const { q, state, startTurn } = setup([], [], { covers: target => target === "web" });
	startTurn("first", web("wu-1"));
	q.deliver("second", web("wu-2"));
	q.onAnswer("-");
	state.working = false;
	q.redeliverSteered();
	expect(state.delivered).toEqual(["first", "second"]);
});

test("stored web prompts without an id count as answered when an answer to their target came after them", () => {
	const now = Date.now();
	const { q, state } = setup([], [], { answeredSince: (target, at) => target === "web" && at < now - 1000 });
	const n = q.replay(
		[
			{ text: "old web, answered since", at: now - 5000, target: "web" },
			{ text: "new web, no answer yet", at: now, target: "web" },
			{ text: "old chat, no answer", at: now - 5000, target: "chat" },
		],
		t => t,
	);
	expect(n).toBe(2);
	expect(state.delivered).toEqual(["new web, no answer yet", "old chat, no answer"]);
});

test("a message redelivered at idle and answered with dotz_send before its turn starts does not post a second answer", () => {
	const { q, state, startTurn } = setup();
	startTurn("first", web("w1"));
	q.deliver("second", web("w2"));
	expect(state.steered).toHaveLength(1);
	q.onAnswer("-");
	state.working = false;
	q.settleTurn();
	// Idle: the unanswered steered message goes in as a normal prompt and waits in the runtime's queue ...
	q.redeliverSteered();
	expect(state.delivered).toEqual(["first", "second"]);
	// ... the model answers it with dotz_send meanwhile ...
	q.sent("web", "quick answer", "w2");
	// ... then its queued turn starts: its answer repeats the first one and goes nowhere.
	q.onPrompt("second");
	q.onAnswer("the same answer once more");
	q.settleTurn();
	expect(state.posts).toEqual([]);
	// The next owner message is a new turn and is answered as usual.
	startTurn("third", web("w3"));
	q.onAnswer("fresh answer");
	expect(state.posts).toEqual([{ target: "web", text: "fresh answer", replyTo: "w3" }]);
});

test("a final answer that starts like a text the turn already posted to the same conversation is dropped", () => {
	const { q, state, startTurn } = setup();
	const a = "Claude Duet is a new app Anthropic released on October 21 as a research preview. Pro and Max only.";
	const b = "Claude Duet is a new app, Anthropic released on October 21 as a research preview; waitlist only.";
	// "chat" and "web" are both the main web conversation: the schedule's channel and the target its text names.
	startTurn("schedule", { target: "chat" });
	q.sent("web", a);
	q.onAnswer(b);
	expect(state.posts).toEqual([]);

	// Another conversation, or a different text, is still posted.
	state.working = false;
	startTurn("schedule 2", { target: "chat" });
	q.sent("alert", a);
	q.onAnswer(b);
	state.working = false;
	startTurn("schedule 3", { target: "chat" });
	q.sent("web", a);
	q.onAnswer("Short and different answer that says something else entirely.");
	expect(state.posts.map(p => p.text)).toEqual([b, "Short and different answer that says something else entirely."]);
});

test("a worker spawned in turn B belongs to B's message, not to the earlier turn's or a steered one", () => {
	const { q, state, startTurn } = setup();
	const real = Date.now;
	let clock = 1_000_000;
	Date.now = () => clock;
	try {
		startTurn("a", { target: "web", replyTo: "msg-a" });
		q.onAnswer("[later]"); // turn A defers: msg-a stays an open deferred message
		state.working = false;
		q.settleTurn();
		clock += 60_000;
		startTurn("b", { target: "web", replyTo: "msg-b" });
		clock += 10_000;
		const spawnedInB = clock;
		q.deliver("c", { target: "web", replyTo: "msg-c" }); // steered into B
		clock += 1000;
		q.sent("web", "quick answer to c", "msg-c"); // answered by reply_to: B is still the turn
		q.sent("web", "ack for b", "msg-b"); // msg-b is answered, so it is not an open deferred message
		expect(q.turnAt(spawnedInB)).toEqual({ target: "web", replyTo: "msg-b" });
		expect(q.turnAt(1_000_000 + 1000)).toEqual({ target: "web", replyTo: "msg-a" });
		q.onAnswer("[later]");
		state.working = false;
		q.settleTurn();
		clock += 600_000;
		// No turn of ours was running then (a run a worker's result woke): no answer here.
		expect(q.turnAt(clock - 300_000)).toBeUndefined();
		expect(q.deferredOpen().map(d => d.replyTo)).toEqual(["msg-a"]);
	} finally {
		Date.now = real;
	}
});

test("an answer that came without a prompt settles the deferred settings request it went to: nothing stays open or waiting, and a restart does not replay it", async () => {
	const SETTINGS = "settings:w:login-boutique-com";
	const { q, state, open, startTurn } = setup();
	startTurn("원인 찾아 줘", { target: SETTINGS, replyTo: "m1" });
	q.workersSpawned([{ id: "st_login" }]);
	q.onAnswer("[later]");
	q.settleTurn();
	expect(q.deferredOpen()).toEqual([expect.objectContaining({ target: SETTINGS, replyTo: "m1" })]);
	expect(open().map(p => p.target)).toEqual([SETTINGS]);

	// A run a worker's result woke answers with no prompt of ours: it goes to the owner's message, which is then answered.
	q.workersDone(["st_login"]);
	q.onAnswer("원인을 찾았어요. 로그인 화면이 바뀌었어요.");
	await Bun.sleep(0);
	expect(state.posts).toEqual([{ target: SETTINGS, text: "원인을 찾았어요. 로그인 화면이 바뀌었어요.", replyTo: "m1" }]);
	expect(q.isAnswered("m1")).toBe(true);
	expect(q.deferredOpen()).toEqual([]);
	expect(open()).toEqual([]);
	expect(q.waitingOnWorkers()).toBe(0);
});

test("a turn pairs with its own prompt when older prompts without a message are dropped first", async () => {
	const later = setup();
	later.q.deliver("[dotz inbox] 세션 보고");
	later.q.deliver("첫째", chat("m1"));
	later.q.deliver("둘째", chat("m2"));
	later.q.deliver("셋째", chat("m3"));
	later.q.onPrompt("둘째");
	later.q.onAnswer("둘째 답");
	await Bun.sleep(0);
	expect(later.state.posts).toEqual([{ target: "chat", text: "둘째 답", replyTo: "m2" }]);

	const last = setup();
	last.q.deliver("[dotz inbox] 세션 보고");
	last.q.deliver("첫째", chat("m1"));
	last.q.onPrompt("첫째");
	last.q.onAnswer("첫째 답");
	await Bun.sleep(0);
	expect(last.state.posts).toEqual([{ target: "chat", text: "첫째 답", replyTo: "m1" }]);
});

test("a worker spawned in a turn a note started serves the owner message steered into it: its result closes that message and nothing asks again", async () => {
	const { q, state, open, startTurn } = setup();
	startTurn("[dotz gateway] This conversation is new. Reply with - now.", { target: "web:worklog" });
	q.deliver("한계 고쳐", { target: "web:worklog", replyTo: "m1" });
	q.workersSpawned([{ id: "st_fix" }]);
	q.onAnswer("[later]");
	q.settleTurn();
	state.working = false;
	q.redeliverSteered();

	q.workersDone(["st_fix"]);
	q.onAnswer("고쳐서 올렸어요.");
	await Bun.sleep(0);
	expect(state.posts).toEqual([{ target: "web:worklog", text: "고쳐서 올렸어요.", replyTo: "m1" }]);
	expect(q.isAnswered("m1")).toBe(true);
	expect(open().filter(p => p.replyTo)).toEqual([]);
});

test("an answer no label explains goes to the session's home, names no message and answers none", async () => {
	const SETTINGS = "settings:w:login-boutique-com";
	const { q, state, open } = setup([], [{ target: SETTINGS, replyTo: "m7", at: Date.now() - 60_000 }], { home: SETTINGS });
	q.onAnswer("다시 로그인했어요. 다음 확인 때 정상으로 바뀌는지 볼게요.");
	await Bun.sleep(0);
	expect(state.posts.map(p => [p.target, p.replyTo])).toEqual([[SETTINGS, undefined]]);
	expect(q.isAnswered("m7")).toBe(false);
	expect(open()).toEqual([]);
});

// 2026-10-23: three answered web messages came back after a restart. The outbox showed them answered, but no `out` carried their
// own id as reply_to (the answer named the last message of a burst), so neither the deferred set nor pending.json nor the replay knew.
const deliveryAnswered = (target: string, ref: string) => emit("outbox", { ts: new Date().toISOString(), kind: "delivery", source: "gateway", target, ref, state: "answered", text: "" });

test("a message the outbox shows as answered is read back as answered and skipped on replay, with a log line", () => {
	deliveryAnswered("web", "burst-first");
	const logs: string[] = [];
	const { q, state } = setup(answeredIds(), [], { log: m => logs.push(m) });
	const n = q.replay(
		[
			{ text: "answered by the burst", at: Date.now(), target: "web", replyTo: "burst-first" },
			{ text: "never answered", at: Date.now(), target: "web", replyTo: "burst-open" },
		],
		t => `replay ${t}`,
	);
	expect(n).toBe(1);
	expect(state.delivered).toEqual(["replay never answered"]);
	expect(logs.some(l => l.includes("burst-first") && l.includes("already answered"))).toBe(true);
});

test("a batch answer that settles every message of a burst leaves none in the deferred set or pending.json", () => {
	const { q, open, startTurn } = setup();
	startTurn("first", web("b1"));
	q.onAnswer("[later]");
	q.deliver("second", web("b2"));
	q.settleTurn();
	expect(q.deferredOpen().map(d => d.replyTo)).toEqual(["b1"]);
	// handOver: the answer named b2, the delivery state settled b1 and b2 (hub/outbound.ts).
	for (const ref of ["b1", "b2"]) q.markAnswered(ref);
	expect(q.deferredOpen()).toEqual([]);
	expect(open()).toEqual([]);
	const { q: after, state } = setup(["b1", "b2"]);
	expect(after.replay(open(), t => t)).toBe(0);
	expect(state.delivered).toEqual([]);
});

test("a dotz_send reply_to to a deferred prompt leaves nothing to replay", () => {
	const { q, open, startTurn } = setup();
	startTurn("work", chat("d1"));
	q.onAnswer("[later]");
	q.settleTurn();
	expect(open().map(p => p.replyTo)).toEqual(["d1"]);
	q.sent("chat", "result", "d1");
	expect(q.deferredOpen()).toEqual([]);
	expect(open()).toEqual([]);
});

test("an answer without a prompt that a worker's link names leaves no earlier answered message to replay", async () => {
	const { q, open, startTurn } = setup();
	startTurn("one", web("n1"));
	q.workersSpawned([{ id: "st_n" }]);
	q.onAnswer("[later]");
	q.settleTurn();
	q.deliver("two", web("n2"));
	q.onPrompt("two");
	q.workersSteered(["st_n"]);
	q.onAnswer("[later]");
	q.settleTurn();
	q.workersDone(["st_n"]);
	q.onAnswer("the worker finished: everything is done");
	await Promise.resolve();
	// the outbox shows both as answered (the answer named n1; n2 was in the same web conversation)
	q.markAnswered("n2");
	expect(open()).toEqual([]);
});

test("a lane report a turn already took is not replayed after a restart, an unanswered owner prompt and a report no turn took still are", () => {
	const logs: string[] = [];
	const { q, state, open } = setup([], [], { log: m => logs.push(m) });
	q.deliver("[dotz inbox] session report 1: [done] old result", undefined);
	q.deliver("owner asks", web("o1"));
	// omp ran the report first (its text was changed on the way, so it never paired), then the owner's prompt.
	q.onPrompt("owner asks");
	expect(open().map(p => p.text)).toEqual(["owner asks"]);
	expect(logs.some(l => l.includes("consumed by a turn"))).toBe(true);
	const { q: after, state: s2 } = setup();
	expect(after.replay(open(), t => `replay ${t}`)).toBe(1);
	expect(s2.delivered).toEqual(["replay owner asks"]);
	// a report no turn started yet is still open
	const lone = setup();
	lone.q.deliver("[dotz inbox] session report 1: [done] fresh", undefined);
	expect(lone.open().map(p => p.text)).toEqual(["[dotz inbox] session report 1: [done] fresh"]);
	expect(state.delivered.length).toBe(2);
});

test("the owner's 중단 closes the request: nothing steered into it is delivered again, its partial text is not sent, a late answer is dropped", async () => {
	const { q, state, open, startTurn } = setup();
	startTurn("analyse the files", { target: "web", replyTo: "m1" });
	q.deliver("also check the mail", { target: "web", replyTo: "m2", owner: true });
	expect(state.steered).toEqual(["[note] also check the mail"]);
	q.onText("looking at the first file");
	expect(q.cancel()).toBe("web");
	// the runtime still holds the steered note and starts a turn with it after the abort: that turn is stopped too
	expect(q.onPrompt("[note] also check the mail")).toBe(true);
	expect(q.onPrompt("[note] also check the mail")).toBe(false);
	state.working = false;
	expect(state.delivered).toEqual(["analyse the files"]);
	q.settleTurn();
	q.redeliverSteered();
	q.settleTurn();
	q.redeliverSteered();
	expect(state.delivered).toEqual(["analyse the files"]);
	expect(state.posts).toEqual([]);
	expect(open().map(p => p.text)).toEqual([]);
	q.onAnswer("here is the analysis you asked for");   // a run with no prompt of ours and no link: no label names the cancelled request, so it goes home
	expect(state.posts).toEqual([{ target: "web", text: "here is the analysis you asked for", replyTo: undefined }]);
	expect(q.cancel()).toBeUndefined();
});

test("a message queued as the next prompt while the cancelled turn ran is stopped when the runtime starts it, and is not replayed", () => {
	const { q, state, open, startTurn } = setup();
	startTurn("analyse the files", { target: "web", replyTo: "m1" });
	state.working = false;   // the gateway's queue mode: the second message goes to the runtime as the next prompt, not steered
	q.deliver("count the commits too", { target: "web", replyTo: "m2" });
	state.working = true;
	expect(state.delivered).toEqual(["analyse the files", "count the commits too"]);
	expect(q.cancel()).toBe("web");
	expect(open()).toEqual([]);
	expect(q.onPrompt("count the commits too")).toBe(true);
	q.onAnswer("390 commits");
	expect(state.posts).toEqual([]);
	expect(q.onPrompt("an unrelated later message")).toBe(false);
});

// 2026-10-28 21:44 KST (Mac mini): a mail thread's question arrived while the web conversation's KTX run worked. It was steered into
// that run, and the run's promptless KTX answer went to the owner's newest message, the mail thread.
test("a message of another conversation is never steered into a running turn; only the same conversation's is", () => {
	const { q, state, startTurn } = setup();
	startTurn("ktx", { target: "web", replyTo: "w1" });
	expect(q.deliver("file question", { target: "th:9", replyTo: "t1", owner: true })).toBe(false);
	expect(state.steered).toEqual([]);
	expect(state.delivered).toEqual(["ktx", "file question"]);
	expect(q.deliver("ktx follow-up", { target: "web", replyTo: "w2", owner: true })).toBe(true);
	expect(state.steered).toEqual(["[note] ktx follow-up"]);
	// a run no prompt of ours started (the turn was settled): nothing is steered into it, not even the same conversation's
	q.onAnswer("ktx answer");
	q.settleTurn();
	expect(q.deliver("mail again", { target: "mail:k", replyTo: "m1", owner: true })).toBe(false);
	expect(state.steered).toEqual(["[note] ktx follow-up"]);
});

test("a promptless answer stays in the last turn's conversation and never goes to another conversation's waiting message", async () => {
	const { q, state, startTurn } = setup();
	q.deliver("ktx", { target: "web", replyTo: "w1", owner: true });
	state.working = true;
	q.onPrompt("ktx");
	q.settleTurn(); // the turn ended without an answer; the runtime keeps running on its own
	q.deliver("? 이거 파일 어디감?", { target: "th:9", replyTo: "t1", owner: true });
	q.onAnswer("KTX 쪽은 예약을 걸려면 값이 필요해요. 날짜와 구간을 주세요.");
	await Promise.resolve();
	expect(state.posts.map(p => [p.target, p.replyTo])).toEqual([["web", undefined]]);
	// the mail question's own turn answers it in its own conversation
	q.onPrompt("? 이거 파일 어디감?");
	q.onAnswer("파일은 그대로 있어요.");
	await Promise.resolve();
	expect(state.posts.map(p => [p.target, p.replyTo])).toEqual([["web", undefined], ["th:9", "t1"]]);
});

// 2026-10-28 13:25Z (Mac mini): the pinned account was rate-limited at the start of the turn; the turn ended with no text and the owner's
// message was closed as answered-with-nothing, so the run that resumed after the limit had no request to answer.
test("a turn stopped by a provider error before writing anything keeps its request open, and the resumed run answers it there", async () => {
	const { q, state, open, startTurn } = setup();
	startTurn("A: sleep 후 답해 줘", { target: "web", replyTo: "a1" });
	q.settleTurn(true);
	expect(open().map(p => p.replyTo)).toEqual(["a1"]);
	expect(q.deferredOpen().map(d => d.replyTo)).toEqual(["a1"]);
	q.onAnswer("A 작업이 끝났어요");
	await Promise.resolve();
	expect(state.posts).toEqual([{ target: "web", text: "A 작업이 끝났어요", replyTo: "a1" }]);
	expect(open()).toEqual([]);
	// without the error the same textless turn is closed as before
	const plain = setup();
	plain.startTurn("B", { target: "web", replyTo: "b1" });
	plain.q.settleTurn();
	expect(plain.open()).toEqual([]);
});

// 2026-11-11 08:01 KST: scheduled items (no message id) were stopped by a usage limit; every silent-wait nudge failed too and became
// an id-less request of its own, and the answers that came after the pause closed none of them, so the nudge kept coming back.
test("a failed nudge is no request of its own, and an answer in the conversation closes its requests that have no message id", async () => {
	const { q, startTurn } = setup([], [], { regenerated: isOpenNudge });
	startTurn("[dotz inbox] 예약 항목: morning brief", { target: "chat" });
	q.settleTurn(true);
	expect(q.openRequests().length).toBe(1);
	startTurn(ko.openRequests(q.openRequests(), false), { target: "chat" });
	q.settleTurn(true);
	expect(q.openRequests().length).toBe(1);
	startTurn(ko.openRequests(q.openRequests(), true), { target: "chat" });
	q.onAnswer("오늘 캘린더에는 잡힌 일정이 없어요.");
	q.settleTurn();
	await Promise.resolve();
	expect(q.openRequests()).toEqual([]);
});

test("an answer with no message id from another scheduled item or a quiet check leaves a stopped scheduled item open, and a restart still replays it", async () => {
	const { q, state, startTurn } = setup([], [], { regenerated: isOpenNudge, quietNote: () => {} });
	startTurn("[dotz inbox] 예약 항목: morning brief", { target: "chat" });
	q.settleTurn(true);
	startTurn("[dotz inbox] 예약 항목: weather", { target: "chat" });
	q.onAnswer("비가 와요.");
	q.settleTurn();
	startTurn("[dotz inbox] 점검", { target: "chat", quiet: true });
	q.onAnswer("모두 정상이에요");
	q.settleTurn();
	await Promise.resolve();
	expect(state.posts.map(p => p.text)).toEqual(["비가 와요."]);
	expect(q.openRequests().length).toBe(1);
	expect(q.reopen(t => t).texts).toEqual(["[dotz inbox] 예약 항목: morning brief"]);
});

test("the answer to a reminder closes only the id-less requests a provider error stopped, not a deferred one with a message id or one waiting on a worker", async () => {
	const { q, startTurn } = setup([], [], { regenerated: isOpenNudge });
	startTurn("[dotz inbox] 예약 항목: morning brief", { target: "chat" });
	q.settleTurn(true);
	startTurn("owner question", { target: "chat", replyTo: "m1" });
	q.onAnswer("[later]");
	q.settleTurn();
	startTurn(ko.openRequests(q.openRequests(), false), { target: "chat" });
	q.onAnswer("브리핑은 오늘 건너뛰었어요.");
	q.settleTurn();
	expect(q.openRequests().map(r => r.replyTo)).toEqual(["m1"]);
});

test("only the reminder's own text is a regenerated nudge: an owner message or a schedule that quotes it stays a request when its turn is stopped", () => {
	const { q, startTurn } = setup([], [], { regenerated: isOpenNudge });
	const nudge = ko.openRequests([{ target: "chat", workers: [] }], false);
	startTurn(`왜 이런 알림이 왔어?\n${nudge}`, { target: "chat", replyTo: "m1" });
	q.settleTurn(true);
	startTurn(`[dotz inbox] 예약 항목: ${nudge}`, { target: "chat" });
	q.settleTurn(true);
	expect(q.openRequests().map(r => r.replyTo)).toEqual(["m1", undefined]);
});

test("a request the silent-wait check dropped is no longer listed and a restart does not replay it", () => {
	const { q, startTurn } = setup();
	startTurn("[dotz inbox] 예약 항목: morning brief", { target: "chat" });
	q.settleTurn(true);
	const [r] = q.openRequests();
	q.dropOpen([r!]);
	expect(q.openRequests()).toEqual([]);
	expect(q.reopen(t => t).replayed).toBe(0);
});

// 2026-10-31 06:36 UTC: a channel-A worker was still running when the owner's channel-B message started a turn. OmO injected the
// worker's completion into that turn and B posted A's answer. The prompt for B must say where another conversation's answer goes.
test("a prompt for one conversation is told that another conversation's worker is still running", () => {
	const works = [{ id: "wA", description: "발표 자료", status: "running", target: "ch:A", replyTo: "a1", startedAt: 0 }];
	const FOREIGN = "[foreign]";
	const { q, state, startTurn } = setup([], [], {
		work: () => works,
		foreignNote: (w: { id: string }, target: string) => `${FOREIGN} ${w.id} ${target}`,
		hasForeignNote: (text: string) => text.includes(FOREIGN),
	});
	startTurn("A 요청", { target: "ch:A", replyTo: "a1" });
	q.onAnswer("[later]");
	state.working = false;
	q.settleTurn();
	expect(q.deferredOpen().map(d => d.target)).toEqual(["ch:A"]);

	// B's owner message becomes its own prompt: the note names A's worker and A's target.
	q.deliver("B 요청", { target: "ch:B", replyTo: "b1", owner: true });
	expect(state.delivered.at(-1)).toBe("B 요청\n\n[foreign] wA ch:A");
	q.onPrompt(state.delivered.at(-1)!);
	state.working = true;
	// A message steered into B's running turn carries the note too.
	q.deliver("B 후속", { target: "ch:B", replyTo: "b2", owner: true });
	expect(state.steered).toEqual(["[note] B 후속\n\n[foreign] wA ch:A"]);
	state.working = false;
	// A's own message carries none, a text that already has it gets no second line, and a finished worker warns about nothing.
	q.deliver("A 후속", { target: "ch:A", replyTo: "a2", owner: true });
	expect(state.delivered.at(-1)).toBe("A 후속");
	q.deliver("[foreign] wA ch:A\n\nB 요청", { target: "ch:B", replyTo: "b9", owner: true });
	expect(state.delivered.at(-1)).toBe("[foreign] wA ch:A\n\nB 요청");
	q.onPrompt(state.delivered.at(-1)!);
	q.settleTurn();
	works[0] = { ...works[0]!, status: "done", endedAt: Date.now() };
	q.deliver("B 또", { target: "ch:B", replyTo: "b3", owner: true });
	expect(state.delivered.at(-1)).toBe("B 또");
});

// 2026-10-31: the worker of A finished while B's turn ran and its result was read there. A's request still waited, so A must be asked
// again with its own request text instead of staying silently open behind B's answer.
test("a worker of another conversation finishing during a turn asks that conversation again", () => {
	const works = [{ id: "wA", description: "PPT", status: "running", target: "ch:A", replyTo: "a1", startedAt: 0 }];
	const logs: string[] = [];
	const { q, state, startTurn } = setup([], [], {
		work: () => works,
		readElsewhereNote: (w: { id: string }, readIn: string) => `[elsewhere] ${w.id} ${readIn}`,
		log: m => logs.push(m),
	});
	startTurn("A 요청", { target: "ch:A", replyTo: "a1" });
	q.onAnswer("[later]");
	state.working = false;
	q.settleTurn();

	startTurn("B 요청", { target: "ch:B", replyTo: "b1" });
	works[0] = { ...works[0]!, status: "done", endedAt: Date.now() };
	q.onText("A의 작업 결과를 B 턴에서 읽었어요");
	q.onAnswer("B 요청 처리했어요");
	state.working = false;
	q.settleTurn();
	expect(state.posts).toEqual([{ target: "ch:B", text: "B 요청 처리했어요", replyTo: "b1" }]);
	expect(state.delivered.at(-1)).toBe("[elsewhere] wA ch:B\n\nA 요청");
	expect(q.deferredOpen().map(d => d.target)).toEqual(["ch:A"]);
	expect(logs.some(l => l === "the result of wA for ch:A was read in a turn for ch:B; ch:A is asked again")).toBe(true);

	// Once per worker: a later turn of B asks nothing again.
	startTurn("B2 요청", { target: "ch:B", replyTo: "b2" });
	q.onAnswer("B2 답");
	state.working = false;
	q.settleTurn();
	expect(state.delivered.filter(t => t.includes("[elsewhere]"))).toHaveLength(1);
});

// 2026-10-31 06:36: a worker's result woke a run with no prompt of ours while two deferred requests were open; the answer went to the
// oldest one (channel A) though the worker of channel B was the one that just finished.
test("an answer with no prompt and no wake goes home, not to the conversation whose worker finished last", async () => {
	const now = Date.now();
	const works = [
		{ id: "wA", description: "A", status: "done", target: "ch:A", replyTo: "a1", startedAt: now - 100_000, endedAt: now - 50_000 },
		{ id: "wB", description: "B", status: "done", target: "ch:B", replyTo: "b1", startedAt: now - 40_000, endedAt: now - 10_000 },
	];
	const { q, state, startTurn } = setup([], [], { work: () => works });
	startTurn("A 요청", { target: "ch:A", replyTo: "a1" });
	q.onAnswer("[later]");
	state.working = false;
	q.settleTurn();
	startTurn("B 요청", { target: "ch:B", replyTo: "b1" });
	q.onAnswer("[later]");
	state.working = false;
	q.settleTurn();
	expect(q.deferredOpen().map(d => d.target)).toEqual(["ch:A", "ch:B"]);

	q.onAnswer("작업 결과예요");
	await Promise.resolve();
	expect(state.posts.map(p => [p.target, p.replyTo])).toEqual([["web", undefined]]);

	// With no finished worker either, the oldest open request's conversation is not picked: it goes home, on no message.
	const plain = setup();
	plain.startTurn("A 요청", { target: "ch:A", replyTo: "a1" });
	plain.q.onAnswer("[later]");
	plain.state.working = false;
	plain.q.settleTurn();
	plain.startTurn("B 요청", { target: "ch:B", replyTo: "b1" });
	plain.q.onAnswer("[later]");
	plain.state.working = false;
	plain.q.settleTurn();
	plain.q.onAnswer("작업 결과예요");
	await Promise.resolve();
	expect(plain.state.posts.map(p => [p.target, p.replyTo])).toEqual([["web", undefined]]);
});

const defer = (t: ReturnType<typeof setup>, id: string, target = "web") => {
	t.startTurn("request " + id, { target, replyTo: id });
	t.q.onAnswer("[later]");
	t.state.working = false;
	t.q.settleTurn();
};

test("every worker spawned in one conversation gets its own line, and a follow-up to a running worker gets none (2026-11-04 02:22)", () => {
	const announced: { text: string; worker?: string }[] = [];
	const rows: { id: string; description: string; status: "running"; target: string; startedAt: number }[] = [];
	const t = setup([], [], {
		announce: (_t, text, worker) => announced.push({ text, ...(worker ? { worker } : {}) }),
		work: () => rows,
		workFor: () => rows[0],
	});
	t.startTurn("first", { target: "web", replyTo: "m1" });
	rows.push({ id: "st_old", description: "old job", status: "running", target: "web", startedAt: Date.now() });
	t.q.onAnswer("[later]");
	t.state.working = false;
	t.q.settleTurn();
	rows[0]!.startedAt -= 60_000;

	// The store already lists the new worker, behind the older one.
	t.startTurn("second", { target: "web", replyTo: "m2" });
	rows.push({ id: "st_new", description: "new job", status: "running", target: "web", startedAt: Date.now() });
	t.q.onAnswer("[later]");
	t.state.working = false;
	t.q.settleTurn();
	rows[1]!.startedAt -= 60_000;

	// The store does not list it yet: the spawn event names it.
	t.startTurn("third", { target: "web", replyTo: "m3" });
	t.q.workersSpawned([{ id: "st_third", description: "third job" }]);
	t.q.onAnswer("[later]");
	t.state.working = false;
	t.q.settleTurn();

	// No new worker: the owner's 2026-10-30 rule, silence.
	t.startTurn("follow-up", { target: "web", replyTo: "m4" });
	t.q.onAnswer("[later]");
	expect(announced.map(a => a.worker)).toEqual(["st_old", "st_new", "st_third"]);
	expect(announced.map(a => a.text)).toEqual(["old job", "new job", "third job"].map(d => "백그라운드 작업으로 맡겼어요: " + d));
});

test("a batch spawn gets one line per worker, and a worker spawned by a woken run gets its line in that request's conversation", () => {
	const announced: string[] = [];
	const t = setup([], [], { announce: (target, _text, worker) => announced.push(target + " " + worker) });
	t.startTurn("batch", { target: "web", replyTo: "m1" });
	t.q.workersSpawned([{ id: "st_a" }, { id: "st_b" }]);
	t.q.onAnswer("[later]");
	t.state.working = false;
	t.q.settleTurn();
	expect(announced).toEqual(["web st_a", "web st_b"]);
	t.q.workersDone(["st_a"]);
	t.q.workersSpawned([{ id: "st_c" }]);
	expect(announced.at(-1)).toBe("web st_c");
	expect(t.q.linkOf("st_c")).toMatchObject({ target: "web", replyTo: "m1" });
});

test("three open requests whose workers finish out of order are each answered at their own message", async () => {
	const t = setup();
	for (const [id, worker] of [["a", "st_a"], ["b", "st_b"], ["c", "st_c"]] as const) {
		t.startTurn("request " + id, { target: "web", replyTo: id });
		t.q.workersSpawned([{ id: worker }]);
		t.q.onAnswer("[later]");
		t.state.working = false;
		t.q.settleTurn();
	}
	for (const id of ["c", "a", "b"]) {
		t.q.workersDone(["st_" + id]);
		t.q.onAnswer("[later]"); // a woken run that still waits spends nothing
		t.q.onAnswer("result of " + id);
		await Promise.resolve();
	}
	expect(t.state.posts.map(p => [p.replyTo, p.text])).toEqual([["c", "result of c"], ["a", "result of a"], ["b", "result of b"]]);
	expect(t.q.deferredOpen()).toEqual([]);
});

test("two results read in one run go to their own requests in the order they finished, by the store when no wake was seen", async () => {
	const now = Date.now();
	const rows = [
		{ id: "st_b", description: "b", status: "done" as const, startedAt: now - 9_000, endedAt: now - 1_000 },
		{ id: "st_a", description: "a", status: "done" as const, startedAt: now - 9_000, endedAt: now - 2_000 },
	];
	const t = setup([], [], { work: () => rows });
	for (const id of ["a", "b"]) {
		t.startTurn("request " + id, { target: "web", replyTo: id });
		t.q.link("st_" + id, { target: "web", replyTo: id });
		t.q.onAnswer("[later]");
		t.state.working = false;
		t.q.settleTurn();
	}
	t.q.onAnswer("first result");
	t.q.onAnswer("second result");
	await Promise.resolve();
	expect(t.state.posts.map(p => p.replyTo)).toEqual(["a", "b"]);
});

test("a dotz_send from a woken run with no reply_to settles the request of the worker that woke it, not the oldest one", () => {
	const t = setup();
	for (const id of ["a", "b"]) {
		t.startTurn("request " + id, { target: "web", replyTo: id });
		t.q.workersSpawned([{ id: "st_" + id }]);
		t.q.onAnswer("[later]");
		t.state.working = false;
		t.q.settleTurn();
	}
	t.q.workersDone(["st_b"]);
	expect(t.q.resultFor("web")).toBe("b");
	t.q.sent("web", "result of b");
	expect(t.q.deferredOpen().map(d => d.replyTo)).toEqual(["a"]);
});

test("a result for a request the owner cancelled is dropped, not guessed onto another message", async () => {
	const t = setup();
	t.startTurn("request a", { target: "web", replyTo: "a" });
	t.q.workersSpawned([{ id: "st_a" }]);
	t.q.onAnswer("[later]");
	t.startTurn("request b", { target: "web", replyTo: "b" });
	t.q.cancel();
	t.state.working = false;
	t.q.settleTurn();
	t.q.workersDone(["st_a"]);
	t.q.onAnswer("late result");
	await Promise.resolve();
	expect(t.state.posts).toEqual([]);
});

test("a restart keeps the link and the wait: the request is not run again, and the result reaches its message", async () => {
	let stored: WorkLink[] = [];
	const first = setup([], [], { persistLinks: l => (stored = JSON.parse(JSON.stringify(l))) });
	defer(first, "x");
	for (const id of ["a", "b"]) {
		first.startTurn("request " + id, { target: "web", replyTo: id });
		first.q.workersSpawned([{ id: "st_" + id }]);
		first.q.onAnswer("[later]");
		first.state.working = false;
		first.q.settleTurn();
	}
	const pending: Pending[] = JSON.parse(JSON.stringify(first.open()));

	const second = setup([], [], { links: stored });
	expect(second.q.replay(pending, text => "[replay] " + text)).toBe(1); // x has no worker: it runs again, as before
	expect(second.state.delivered).toEqual(["[replay] request x"]);
	expect(second.q.deferredOpen().map(d => d.replyTo)).toEqual(["a", "b"]);
	expect(second.q.openRequests().map(r => r.workers.map(w => w.id))).toEqual([["st_a"], ["st_b"]]);
	expect(second.open().filter(p => p.deferred).map(p => p.replyTo)).toEqual(["a", "b"]);
	second.q.onPrompt("[replay] request x");
	second.q.onAnswer("x answered");
	second.state.working = false;
	second.q.settleTurn();

	second.q.workersDone(["st_b"]);
	second.q.onAnswer("result of b");
	await Promise.resolve();
	expect(second.state.posts.at(-1)).toMatchObject({ replyTo: "b", text: "result of b" });
	expect(second.q.deferredOpen().map(d => d.replyTo)).toEqual(["a"]);
});

test("a receipt survives a restart, and a request whose worker failed runs again after it", () => {
	const announced: (string | undefined)[] = [];
	const links: WorkLink[] = [{ id: "st_a", target: "web", replyTo: "a", at: Date.now(), receipted: true }];
	const pending: Pending[] = [{ text: "request a", at: Date.now(), target: "web", replyTo: "a", deferred: true }];
	const running = setup([], [], { links, announce: (_t, _x, w) => announced.push(w), work: () => [{ id: "st_a", description: "a", status: "running", target: "web", startedAt: Date.now() }] });
	running.q.replay(pending, text => text);
	running.startTurn("follow-up", { target: "web", replyTo: "m2" });
	running.q.onAnswer("[later]");
	expect(announced).toEqual([]);

	const failed = setup([], [], { links, work: () => [{ id: "st_a", description: "a", status: "failed", target: "web", startedAt: 0, endedAt: 1 }] });
	expect(failed.q.replay(pending, text => text)).toBe(1);
});

test("a gateway wake for a waiting request that ends in [later] adds no second wait and no line", () => {
	const announced: string[] = [];
	const t = setup([], [], { announce: (_t, text) => announced.push(text) });
	t.startTurn("request a", { target: "web", replyTo: "a" });
	t.q.workersSpawned([{ id: "st_a" }]);
	t.q.onAnswer("[later]");
	t.state.working = false;
	t.q.settleTurn();
	t.startTurn("[dotz gateway] open requests", { target: "web", replyTo: "a" });
	t.q.onAnswer("[later]");
	t.state.working = false;
	t.q.settleTurn();
	expect(t.q.deferredOpen().map(d => d.replyTo)).toEqual(["a"]);
	expect(announced.length).toBe(1);
});

test("the real report follows a housekeeping result into the run, and that note is no prompt", () => {
	const t = setup([], [], { report: id => (id === "st_a" ? "the whole report" : undefined), isNote: () => false });
	t.startTurn("request a", { target: "web", replyTo: "a" });
	t.q.workersDone(["st_a", "st_b"]);
	expect(t.state.steered).toEqual(['<dotz-worker-report task="st_a">\nthe whole report\n</dotz-worker-report>']);
	t.q.onPrompt(t.state.steered[0]!);
	expect(t.q.current()?.replyTo).toBe("a");
});

test("the task tool's results and OmO's wake frame name the workers", () => {
	const end = (text: string) => eventsFromFrame({ type: "tool_execution_end", toolName: "task", toolCallId: "c", result: { content: [{ type: "text", text }] } }, new Map());
	expect(end("Started task 웹앱 화면 (전환) 개선 (st_01a1a465, running), the task host is still admitting it; Completion is automatically delivered.").at(-1)).toEqual({ type: "workers_spawned", workers: [{ id: "st_01a1a465", description: "웹앱 화면 (전환) 개선" }] });
	expect(end('Batch running.\n1. home st_01a1a439 (running)\n\n[task_id: st_01a1a439 - continue]\n2. lane st_01a1a43a (running)').at(-1)).toEqual({ type: "workers_spawned", workers: [{ id: "st_01a1a439" }, { id: "st_01a1a43a" }] });
	expect(end("no worker here").some(e => e.type === "workers_spawned")).toBe(false);
	const wake = (content: unknown) => eventsFromFrame({ type: "message_end", message: { role: "custom", customType: "omo-senpi:wake", content } as never }, new Map());
	expect(wake('task completion name:recent-done-jump id:st_01a1a45c category:deep-low status:completed result:"x"\ntask completion name:b id:st_01a1a45d status:failed').at(-1)).toEqual({ type: "workers_done", ids: ["st_01a1a45c", "st_01a1a45d"] });
	expect(wake([{ type: "text", text: "task completion name:a id:st_01a1a459 status:completed" }]).at(-1)).toEqual({ type: "workers_done", ids: ["st_01a1a459"] });
	const steer = (text: string, isError = false) => eventsFromFrame({ type: "tool_execution_end", toolName: "task_send", toolCallId: "c", isError, result: { content: [{ type: "text", text }] } }, new Map());
	expect(steer("Delivered to st_01a1a6be as steer.").at(-1)).toEqual({ type: "workers_steered", ids: ["st_01a1a6be"] });
	expect(steer("Unknown task st_01a1a6be", true).filter(e => e.type === "workers_steered")).toEqual([]);
});

// 2026-11-04 13:22-13:38 UTC: a result landed inside a prompted turn and stayed at the head of the wake list, so each later answer took the previous worker's request.
function deferTo(t: ReturnType<typeof setup>, replyTo: string, how: { spawned?: string; steered?: string }) {
	t.startTurn("request " + replyTo, { target: "web", replyTo });
	if (how.spawned) t.q.workersSpawned([{ id: how.spawned }]);
	if (how.steered) t.q.workersSteered([how.steered]);
	t.q.onAnswer("[later]");
	t.state.working = false;
	t.q.settleTurn();
}
const answerWake = async (t: ReturnType<typeof setup>, id: string, text: string) => {
	t.q.workersDone([id]);
	t.q.onAnswer(text);
	await Promise.resolve();
	t.q.settleTurn();
};

test("the 2026-11-04 sequence: each result reaches its own request, follow-ups close with it, and a restart replays nothing", async () => {
	let stored: WorkLink[] = [];
	const t = setup([], [], { persistLinks: l => (stored = JSON.parse(JSON.stringify(l))), readHereNote: id => "[read here] " + id });
	deferTo(t, "0397177d", { spawned: "st_ac" });
	t.startTurn("push question", { target: "web", replyTo: "b8065c69" });
	t.q.workersDone(["st_ac"]); // read inside a turn that answers another message
	t.q.onAnswer("push answer");
	await Promise.resolve();
	t.state.working = false;
	t.q.settleTurn();
	// That result is asked again once, at its own message, and that turn answers it.
	const again = t.state.delivered.at(-1)!;
	expect(again).toStartWith("[read here] st_ac");
	t.q.onPrompt(again);
	t.q.onAnswer("aside result");
	await Promise.resolve();
	t.q.settleTurn();
	expect(t.state.posts.at(-1)).toMatchObject({ replyTo: "0397177d", text: "aside result" });
	deferTo(t, "dd2c54f2", { spawned: "st_bb" });
	deferTo(t, "9e445436", { steered: "st_bb" });
	deferTo(t, "de7dd2a3", { spawned: "st_be" });
	deferTo(t, "ca853833", { steered: "st_be" });
	t.startTurn("schedule: check the restart", { target: "chat" });
	t.q.onAnswer("-");
	t.state.working = false;
	t.q.settleTurn();
	expect(t.q.deferredOpen().map(d => d.replyTo)).toEqual(["dd2c54f2", "9e445436", "de7dd2a3", "ca853833"]);

	await answerWake(t, "st_be", "note result");
	await answerWake(t, "st_bb", "card result");
	expect(t.state.posts.slice(2).map(p => [p.replyTo, p.text])).toEqual([["de7dd2a3", "note result"], ["dd2c54f2", "card result"]]);
	expect(t.q.deferredOpen()).toEqual([]);

	const pending: Pending[] = JSON.parse(JSON.stringify(t.open()));
	expect(pending).toEqual([]);
	expect(setup([], [], { links: stored }).q.replay(pending, text => text)).toBe(0);
});

test("a worker with two requests answers the oldest and closes the other, across a restart too", async () => {
	let stored: WorkLink[] = [];
	const first = setup([], [], { persistLinks: l => (stored = JSON.parse(JSON.stringify(l))) });
	deferTo(first, "m1", { spawned: "st_a" });
	deferTo(first, "m2", { steered: "st_a" });
	const second = setup([], [], { links: stored });
	expect(second.q.replay(JSON.parse(JSON.stringify(first.open())), text => text)).toBe(0);
	expect(second.q.openRequests().map(r => r.workers.map(w => w.id))).toEqual([["st_a"], ["st_a"]]);
	await answerWake(second, "st_a", "done");
	expect(second.state.posts).toEqual([{ target: "web", text: "done", replyTo: "m1" }]);
	expect(second.q.deferredOpen()).toEqual([]);
	expect(second.open()).toEqual([]);
});

test("two workers finishing in reverse order each answer their own request", async () => {
	const t = setup();
	deferTo(t, "m1", { spawned: "st_a" });
	deferTo(t, "m2", { spawned: "st_b" });
	await answerWake(t, "st_b", "result b");
	await answerWake(t, "st_a", "result a");
	expect(t.state.posts.map(p => [p.replyTo, p.text])).toEqual([["m2", "result b"], ["m1", "result a"]]);
});

test("a follow-up steered to the second worker is not taken for the oldest running one", () => {
	const logs: string[] = [];
	const running = (id: string) => ({ id, description: id });
	const t = setup([], [], { log: m => logs.push(m), workFor: () => running("st_a"), announce: () => {} });
	deferTo(t, "m1", { spawned: "st_a" });
	deferTo(t, "m2", { spawned: "st_b" });
	deferTo(t, "m3", { steered: "st_b" });
	expect(t.q.linkOf("st_b")).toMatchObject({ replyTo: "m2", also: ["m3"] });
	expect(t.q.linkOf("st_a")?.also).toBeUndefined();
	expect(logs.at(-1)).toContain("worker st_b");
});

test("a run no worker woke leaves deferred requests open and links to no answered message", async () => {
	const t = setup();
	t.startTurn("older question", { target: "web", replyTo: "old" });
	t.q.onAnswer("older answer");
	await Promise.resolve();
	t.state.working = false;
	t.q.settleTurn();
	deferTo(t, "m1", { spawned: "st_a" });
	t.q.onAnswer("a monitor run's note");
	t.q.sent("web", "a progress line from that run");
	await Promise.resolve();
	expect(t.state.posts.at(-1)).toEqual({ target: "web", text: "a monitor run's note", replyTo: undefined });
	expect(t.q.deferredOpen().map(d => d.replyTo)).toEqual(["m1"]);
});

test("a turn that started from an unpaired frame takes no deferred request, even one whose worker finished", async () => {
	const now = Date.now();
	const t = setup([], [], { work: () => [{ id: "st_a", description: "a", status: "done", target: "web", replyTo: "m1", startedAt: now - 9_000, endedAt: now - 1_000 }] });
	deferTo(t, "m1", { spawned: "st_a" });
	deferTo(t, "m2", {});
	t.q.onPrompt("schedule: morning check");
	t.q.onAnswer("the morning check is fine");
	await Promise.resolve();
	expect(t.state.posts).toEqual([{ target: "web", text: "the morning check is fine", replyTo: undefined }]);
	expect(t.q.deferredOpen().map(d => d.replyTo)).toEqual(["m1", "m2"]);
	t.q.settleTurn();
	await answerWake(t, "st_a", "result");
	expect(t.state.posts.at(-1)).toEqual({ target: "web", text: "result", replyTo: "m1" });
});

// A worker no turn of ours spawned is listed by bgwork.ts in the conversation that waits, on no message; `rows` stands for that list.
function listedWorkers(rows: () => WorkRow[], link: () => (id: string, to: { target: string }, description?: string) => unknown): Pick<PromptDeps, "work" | "workFor"> {
	return {
		work: rows,
		workFor: target => {
			const w = rows().find(w => w.status === "running" && w.target === target);
			if (w) link()(w.id, { target }, w.description);
			return w && { id: w.id, description: w.description ?? "" };
		},
	};
}

test("the 2026-11-05 web:worklog sequence: a message that came during the session start gets one answer and no nudge", async () => {
	const target = "web:worklog";
	const id = "st_01a1aa4c";
	const worker: WorkRow = { id, description: "이슈 52 남은 한계 수정", status: "running", target, startedAt: Date.now() - 2_000 };
	let rows: WorkRow[] = [];
	const t = setup([], [], listedWorkers(() => rows, () => t.q.link));
	const inbox = "[dotz inbox] web:worklog msg=4f205ede\n한계 부분 바로 검토해서 수정해";
	t.q.deliver(inbox, { target, replyTo: "4f205ede", owner: true });
	// The session's first run, on its start prompt, spawned the worker before the message had its own turn.
	t.state.working = true;
	t.q.onPrompt("[dotz gateway] start prompt");
	rows = [worker];
	t.q.workersSpawned([{ id, description: worker.description }]);
	t.q.onAnswer("[later]");
	t.q.settleTurn();
	// The message's own turn defers to the worker that already runs.
	t.q.onPrompt(inbox);
	t.q.onAnswer("[later]");
	t.state.working = false;
	t.q.settleTurn();
	expect(t.q.openRequests().map(r => r.workers.map(w => w.id))).toEqual([[id]]);
	// The worker's result wakes a run, whose answer is the request's answer.
	rows = [{ ...worker, status: "failed", endedAt: Date.now() }];
	await answerWake(t, id, "남은 한계 두 가지를 고쳤어요");
	expect(t.state.posts).toEqual([{ target, text: "남은 한계 두 가지를 고쳤어요", replyTo: "4f205ede" }]);
	expect(t.q.isAnswered("4f205ede")).toBe(true);
	expect(t.open()).toEqual([]);
	// The silent-wait check, with nothing running.
	let clock = 0;
	const wakes: unknown[] = [];
	const check = createWaitCheck({ sessions: () => [{ key: "worklog", open: t.q.openRequests, busy: () => false, workers: () => 0, armed: () => false, lastTurnEndAt: () => 0, wake: open => wakes.push(open) }], restarting: () => false, log: () => {}, now: () => clock });
	check.tick();
	clock += QUIET_MS + 1;
	check.tick();
	expect(wakes).toEqual([]);
});

test("a [later] does not take a worker another request owns: that request keeps its answer and this one stays open", async () => {
	const worker: WorkRow = { id: "st_a", description: "a", status: "running", target: "web", replyTo: "m1", startedAt: Date.now() - 2_000 };
	const t = setup([], [], listedWorkers(() => [worker], () => () => {}));
	deferTo(t, "m1", { spawned: "st_a" });
	deferTo(t, "m2", {});
	await answerWake(t, "st_a", "result");
	expect(t.state.posts.at(-1)).toEqual({ target: "web", text: "result", replyTo: "m1" });
	expect(t.q.deferredOpen().map(d => d.replyTo)).toEqual(["m2"]);
});

test("a result with no link reaches the conversation on no message and closes no request", async () => {
	const t = setup();
	deferTo(t, "m1", {});
	deferTo(t, "m2", {});
	await answerWake(t, "st_unknown", "result");
	expect(t.state.posts).toEqual([{ target: "web", text: "result", replyTo: undefined }]);
	expect(t.q.deferredOpen().map(d => d.replyTo)).toEqual(["m1", "m2"]);
});

test("a woken run that said [later] does not leave its wake for the next run", async () => {
	const t = setup();
	deferTo(t, "m1", { spawned: "st_a" });
	deferTo(t, "m2", { spawned: "st_b" });
	await answerWake(t, "st_a", "[later]");
	await answerWake(t, "st_b", "result b");
	expect(t.state.posts).toEqual([{ target: "web", text: "result b", replyTo: "m2" }]);
});

test("a no-op answer wrapped in a short note posts nothing, with or without a prompt, and is logged", async () => {
	const logs: string[] = [];
	const { q, state, startTurn } = setup([], [{ target: "web", at: Date.now() }], { log: l => logs.push(l) });
	q.onAnswer("Already posted. -");
	startTurn("first", chat("m1"));
	q.onAnswer("Already posted.\n-");
	await Promise.resolve();
	expect(state.posts).toEqual([]);
	expect(logs.filter(l => l.includes("no-op answer"))).toHaveLength(2);
	startTurn("second", chat("m2"));
	q.onAnswer("- first item\n- second item");
	await Promise.resolve();
	expect(state.posts.map(p => p.text)).toEqual(["- first item\n- second item"]);
});

test("a restart does not replay the gateway's silent-wait nudge, in any language, wrapped or not", () => {
	const nudge = (c: typeof en) => c.openRequests([{ target: "web", workers: [] }], false);
	for (const c of [en, ko]) {
		expect(isOpenNudge(nudge(c))).toBe(true);
		expect(isOpenNudge(c.openRequests([{ target: "web", workers: [] }], true))).toBe(true);
	}
	const quoted = `왜 이런 알림이 왔어?\n${nudge(ko)}`;
	const { q, state } = setup([], [], { regenerated: isOpenNudge });
	const at = Date.now();
	const n = q.replay(
		[
			{ text: nudge(ko), at, target: "web" },
			{ text: `${ko.replay}\n${nudge(en)}`, at, target: "web" },
			{ text: "upload today's episode", at, target: "web" },
			{ text: quoted, at, target: "web" },
		],
		t => `[replay] ${t}`,
	);
	expect(n).toBe(2);
	expect(state.delivered).toEqual(["[replay] upload today's episode", `[replay] ${quoted}`]);
});

test("a worker's result and its restatement in the same wake go to the worker's conversation, not to a [later] request that spawned no worker", async () => {
	const t = setup();
	t.startTurn("request R", { target: "web", replyTo: "R" });
	t.q.workersSpawned([{ id: "st_w" }]);
	t.q.onAnswer("[later]");
	t.state.working = false;
	t.q.settleTurn();
	// A conversation session hands main a request; the turn ends [later] without spawning a worker.
	t.startTurn("request C", { target: "ch:1", replyTo: "C" });
	t.q.onAnswer("[later]");
	t.state.working = false;
	t.q.settleTurn();
	t.q.workersDone(["st_w"]);
	t.q.onAnswer("the result of the worker");
	t.q.onAnswer("the same outcome, worded another way");
	await Promise.resolve();
	expect(t.state.posts.filter(p => p.replyTo === "R").length).toBe(1);
	expect(t.state.posts.filter(p => p.target !== "web")).toEqual([]);
});

test("a quiet check's plain answer is kept as a note and not posted; [ask], [fail] and an item with no quiet mark are delivered as today", () => {
	const notes: { target: string; text: string }[] = [];
	const { q, state } = setup([], [], { quietNote: (target, text) => void notes.push({ target, text }) });
	const run = (reply: { target: string; quiet?: true }, answer: string) => {
		q.deliver("check", reply);
		state.working = true;
		q.onPrompt("check");
		q.onAnswer(answer);
		state.working = false;
	};
	run({ target: "chat", quiet: true }, "모두 정상이에요");
	expect(notes).toEqual([{ target: "chat", text: "모두 정상이에요" }]);
	expect(state.posts).toEqual([]);
	run({ target: "chat", quiet: true }, "-");
	expect(notes).toHaveLength(1);
	expect(state.posts).toEqual([]);
	run({ target: "chat", quiet: true }, "[ask] 계속할까요?");
	run({ target: "chat", quiet: true }, "[fail] 서버가 멈췄어요");
	expect(state.posts.map(p => p.text)).toEqual(["[ask] 계속할까요?", "[fail] 서버가 멈췄어요"]);
	run({ target: "chat" }, "모두 정상이에요");
	expect(state.posts.at(-1)).toMatchObject({ target: "chat", text: "모두 정상이에요" });
	expect(notes).toHaveLength(1);
});

test("a quiet check is not steered into the running turn of its conversation and keeps its mark through the saved queue", () => {
	const { q, state, open, startTurn } = setup();
	startTurn("first", { target: "chat", replyTo: "m1" });
	q.deliver("check", { target: "chat", quiet: true } as never);
	expect(state.steered).toEqual([]);
	expect(open().find(p => p.text === "check")?.quiet).toBe(true);
});

test("an owner message steered into a running quiet check makes that turn's answer a normal one", () => {
	const notes: string[] = [];
	const { q, state, open } = setup([], [], { quietNote: (_target, text) => void notes.push(text) });
	q.deliver("check", { target: "chat", quiet: true });
	state.working = true;
	q.onPrompt("check");
	q.deliver("그것도 봐줘", { target: "chat", replyTo: "m1", owner: true });
	expect(state.steered).toHaveLength(1);
	expect(open().find(p => p.text === "check")?.quiet).toBeUndefined();
	q.onAnswer("둘 다 정상이에요");
	expect(state.posts.map(p => p.text)).toEqual(["둘 다 정상이에요"]);
	expect(notes).toEqual([]);
});
