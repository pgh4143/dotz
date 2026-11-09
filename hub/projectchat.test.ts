import { describe, expect, test } from "bun:test";
import { emit, eventTarget, historyEvents } from "./events.ts";
import { isProjectTarget, outEvent, projectTarget } from "./projectchat.ts";
import { bundle } from "./webapp.ts";

const WORK = { "1500000000001908448": "dotz-개선" };
const CH = "ch:1500000000001908448";

// The conversations a web chat target shows: the owner's message in a project channel (from Discord or from the web
// switcher), the orchestrator's answers and progress there, and everything that stays in the main chat or a lane.
const EVENTS: Array<[string, Record<string, unknown>, string]> = [
	["discord message in the work channel", { kind: "message", source: "discord", channel: CH, channel_name: "dotz-개선", text: "hi" }, CH],
	["web message sent to the project", { kind: "message", source: "web", channel: CH, channel_name: "dotz-개선", text: "hi" }, CH],
	["answer to the work channel", { kind: "out", source: "orchestrator", target: CH, text: "ok" }, CH],
	["progress note in the work channel", { kind: "out", source: "orchestrator", target: CH, update_key: "progress", text: "…" }, CH],
	["command answer in the work channel", { kind: "out", source: "gateway", target: CH, text: "model" }, CH],
	["web message to the main assistant", { kind: "message", source: "web", channel: "web", text: "hi" }, "main"],
	["discord chat channel", { kind: "message", source: "discord", channel: "chat", text: "hi" }, "main"],
	["thread of a work channel", { kind: "message", source: "discord", channel: "th:42", parent: CH, text: "hi" }, "main"],
	["alert", { kind: "out", source: "gateway", target: "alert", text: "x" }, "alert"],
	["lane report", { kind: "lane_report", lane: "a", text: "done" }, "lane:a"],
	["delivery state of a message to a project", { kind: "delivery", source: "gateway", target: CH, ref: "a1", state: "steered" }, CH],
	["delivery state of a message to a session", { kind: "delivery", source: "gateway", target: "lane:a", ref: "a1", state: "answered" }, "lane:a"],
	["delivery state of a message to the main chat", { kind: "delivery", source: "gateway", target: "web", ref: "a1", state: "received" }, "main"],
	["session answer note (source and target are the session)", { kind: "out", source: "lane:a", target: "lane:a", text: "10분 안에 알려요.", answers: ["a1"] }, "lane:a"],
	["lane answer posted to the work channel", { kind: "out", source: "lane:a", target: CH, text: "x" }, "lane:a"],
	["a mail (hub/mail.ts) is its own conversation", { kind: "mail", source: "zele", channel: "mail:zele-1", conv: "mail:zele-1", mail: "zele-1", text: "x" }, "mail:zele-1"],
	["owner message in a mail's thread of a work channel", { kind: "message", source: "web", channel: "th:42", parent: CH, conv: "mail:zele-1", text: "ㅇㅇ" }, "mail:zele-1"],
	["answer to a mail's thread", { kind: "out", source: "orchestrator", target: "th:42", channel: CH, conv: "mail:zele-1", text: "x" }, "mail:zele-1"],
	["answer to a web-only mail", { kind: "out", source: "orchestrator", target: "mail:zele-1", text: "x" }, "mail:zele-1"],
	["delivery state of a web-only mail message", { kind: "delivery", source: "gateway", target: "mail:zele-1", ref: "a1", state: "received" }, "mail:zele-1"],
];

describe("what the orchestrator sends to Discord also shows in the web project chat", () => {
	const parentOf = (t: string) => (t === "42" ? "1500000000001908448" : undefined);
	const sendOnce = (target: string, text: string, ts: string) => emit("outbox", outEvent({ ts, kind: "out", source: "orchestrator", target, text, reply_to: "5eeba27e" }, parentOf));

	test("a dotz_send to a work channel is one event in that channel's conversation, with its reply link and files, not in the main chat", () => {
		const text = "답이에요\n[file] /tmp/a.png";
		sendOnce(CH, text, "2026-10-21T07:12:00.000Z");
		const got = historyEvents(CH, 50).filter(e => e.text === text);
		expect(got).toHaveLength(1);
		expect(got[0]).toMatchObject({ reply_to: "5eeba27e", source: "orchestrator" });
		expect(historyEvents("main", 50).some(e => e.text === text)).toBe(false);
	});

	test("a send to a thread of a work channel lands in that channel's conversation; a thread of no work channel does not", () => {
		sendOnce("th:42", "스레드 답", "2026-10-21T07:13:00.000Z");
		sendOnce("th:99", "모르는 스레드 답", "2026-10-21T07:14:00.000Z");
		expect(historyEvents(CH, 50).filter(e => e.text === "스레드 답")).toHaveLength(1);
		expect(historyEvents(CH, 50).some(e => e.text === "모르는 스레드 답")).toBe(false);
	});
});

describe("project orchestrator target", () => {
	test("a known work channel is a project target, by id or ch:<id>", () => {
		expect(projectTarget("1500000000001908448", WORK)).toEqual({ target: CH, name: "dotz-개선" });
		expect(projectTarget(CH, WORK)).toEqual({ target: CH, name: "dotz-개선" });
	});

	test("an unknown or malformed channel is refused", () => {
		expect(() => projectTarget("999", WORK)).toThrow();
		expect(() => projectTarget("ch:", WORK)).toThrow();
		expect(() => projectTarget("lane:a", WORK)).toThrow();
		expect(() => projectTarget("../1500000000001908448", WORK)).toThrow();
	});

	test("isProjectTarget takes ch:<digits> only", () => {
		expect(isProjectTarget(CH)).toBe(true);
		expect(["main", "lane:a", "ch:", "ch:abc", "th:1"].some(isProjectTarget)).toBe(false);
	});

	for (const [name, e, want] of EVENTS) test(`history: ${name} -> ${want}`, () => expect(eventTarget(e as never)).toBe(want));

	test("the web app sorts events into the same conversations as the hub", () => {
		const html = bundle("js").text;
		const fn = html.match(/\nfunction eventTarget\(e\) \{[\s\S]*?\n\}\n/)?.[0];
		const proj = html.match(/\nconst isProjT = .*\n/)?.[0];
		const task = html.match(/\nconst isTaskT = .*\n/)?.[0];
		expect(fn && proj && task).toBeTruthy();
		const webTarget = new Function("MAIN", `${proj}${task}${fn}return eventTarget;`)("main") as (e: unknown) => string;
		for (const [, e, want] of EVENTS) expect(webTarget(e)).toBe(want);
	});
});
