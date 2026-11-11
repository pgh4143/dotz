// The owner's edit of a schedule (PATCH /api/schedules/<id>): persisted, re-armed, and paused without deleting.
import { afterEach, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { paths } from "./config.ts";
import { advance, clock } from "./runtime/test-clock.ts";
import { sessionKeyOf } from "./session-key.ts";
import { addSchedule, listSchedules, patchSchedule, removeSchedule, scheduleTarget, startSchedules } from "./schedule.ts";

const fired: string[] = [];
beforeAll(() => startSchedules(s => fired.push(s.id)));
afterEach(() => {
	for (const s of listSchedules()) removeSchedule(s.id);
	fired.length = 0;
});
const stored = (id: string) => JSON.parse(readFileSync(paths.schedules, "utf8")).find((s: { id: string }) => s.id === id);

test("an edit of text, time and interval is persisted and the timer follows the new time", async () => {
	const s = addSchedule({ text: "보고", in_minutes: 10 });
	const at = new Date(clock.now + 60 * 60_000).toISOString();
	const edited = patchSchedule(s.id, { text: " 새 보고 ", at, every_minutes: 120 });
	expect(edited).toMatchObject({ id: s.id, text: "새 보고", at, every_minutes: 120 });
	expect(stored(s.id)).toMatchObject({ text: "새 보고", at, every_minutes: 120 });
	await advance(30 * 60_000);
	expect(fired).toEqual([]);
	await advance(31 * 60_000);
	expect(fired).toEqual([s.id]);
	expect(stored(s.id).at).toBe(new Date(Date.parse(at) + 120 * 60_000).toISOString());
});

test("a paused schedule stays listed and persisted but never fires; resuming a recurring one waits for its next slot", async () => {
	const s = addSchedule({ text: "점검", in_minutes: 10, every_minutes: 30 });
	expect(patchSchedule(s.id, { paused: true }).paused).toBe(true);
	expect(stored(s.id).paused).toBe(true);
	await advance(95 * 60_000);
	expect(fired).toEqual([]);
	expect(listSchedules().map(x => x.id)).toEqual([s.id]);
	const resumed = patchSchedule(s.id, { paused: false });
	expect(resumed.paused).toBeUndefined();
	expect(Date.parse(resumed.at)).toBeGreaterThan(clock.now);
	expect(stored(s.id).paused).toBeUndefined();
	await advance(31 * 60_000);
	expect(fired).toEqual([s.id]);
});

test("a recurring timer that fires a few ms before its slot fires once and moves to the next slot", async () => {
	const s = addSchedule({ text: "보고", in_minutes: 10, every_minutes: 30 });
	const slot = Date.parse(s.at);
	const realNow = Date.now;
	Date.now = () => realNow() - 46;
	try {
		await advance(10 * 60_000);
	} finally {
		Date.now = realNow;
	}
	await advance(1000);
	expect(fired).toEqual([s.id]);
	expect(stored(s.id).at).toBe(new Date(slot + 30 * 60_000).toISOString());
});

test("bad values and unknown ids are refused and change nothing", () => {
	const s = addSchedule({ text: "그대로", in_minutes: 10, every_minutes: 30 });
	const before = JSON.stringify(stored(s.id));
	for (const bad of [{ every_minutes: 0 }, { every_minutes: 10081 }, { every_minutes: 1.5 }, { every_minutes: "5" }, { at: "not a time" }, { text: "  " }, { paused: "yes" }]) expect(() => patchSchedule(s.id, bad)).toThrow();
	expect(JSON.stringify(stored(s.id))).toBe(before);
	expect(() => patchSchedule("nope00", { paused: true })).toThrow("no schedule");
	expect(patchSchedule(s.id, { every_minutes: 10080 }).every_minutes).toBe(10080);
});

test("a schedule made in a conversation session fires into that conversation's session, one made in main (or without conv) into main's", async () => {
	const inCh = addSchedule({ text: "채널 일", in_minutes: 10, session: "ch:1" });
	const inMain = addSchedule({ text: "메인 일", in_minutes: 10, session: "main" });
	const plain = addSchedule({ text: "그냥", in_minutes: 10 });
	const named = addSchedule({ text: "지정", in_minutes: 10, project: "th:7" });
	expect(stored(inCh.id).conv).toBe("ch:1");
	expect(stored(named.id).conv).toBe("th:7");
	expect(inMain.conv).toBeUndefined();
	expect(plain.conv).toBeUndefined();
	const rules = { on: true };
	expect(sessionKeyOf(scheduleTarget(inCh, "chat"), rules)).toBe("ch:1");
	expect(sessionKeyOf(scheduleTarget(inMain, "chat"), rules)).toBe("main");
	expect(sessionKeyOf(scheduleTarget(plain, "web"), rules)).toBe("main");
	await advance(11 * 60_000);
	expect(fired.sort()).toEqual([inCh.id, inMain.id, plain.id, named.id].sort());
});

test("a schedule with an unknown conversation kind is rejected", () => {
	expect(() => addSchedule({ text: "x", in_minutes: 10, project: "lane:a" })).toThrow("project must be a conversation target");
	expect(() => addSchedule({ text: "x", in_minutes: 10, conv: "nope" })).toThrow("conv must be a conversation target");
	expect(listSchedules()).toEqual([]);
});

test("an item added without a kind is exactly as before: its own time", async () => {
	const a = addSchedule({ text: "그냥", in_minutes: 7 });
	const b = addSchedule({ text: "그냥 둘", in_minutes: 7 });
	expect(a.kind).toBeUndefined();
	expect(stored(a.id).kind).toBeUndefined();
	expect(Date.parse(a.at)).toBe(clock.now + 7 * 60_000);
	await advance(8 * 60_000);
	expect(fired.sort()).toEqual([a.id, b.id].sort());
});

test("PATCH changes the kind and refuses an unknown one", () => {
	const s = addSchedule({ text: "알림", in_minutes: 7 });
	expect(patchSchedule(s.id, { kind: "check" }).kind).toBe("check");
	expect(stored(s.id).kind).toBe("check");
	expect(() => patchSchedule(s.id, { kind: "quiet" })).toThrow("kind must be");
	expect(patchSchedule(s.id, { text: "고침" }).kind).toBe("check");
});
