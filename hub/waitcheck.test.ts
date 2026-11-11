// The silent-wait check: one bounded wake when an owner request is open and nothing runs; never while something does.
import { expect, test } from "bun:test";
import type { OpenRequest } from "./prompts.ts";
import { createWaitCheck, MAX_WAKES, QUIET_MS, RETRY_MS, type WaitSession } from "./waitcheck.ts";

const TICK = 20_000;
const request = (replyTo: string, at = 0): OpenRequest => ({ target: "web", replyTo, at, workers: [] });

function setup(open: OpenRequest[]) {
	const s = { t: 0, open, busy: false, down: false, workers: 0, armed: false, restarting: false, turnEnd: 0, wakes: [] as { ids: (string | undefined)[]; last: boolean }[], dropped: [] as string[] };
	const session: WaitSession = {
		key: "main",
		open: () => s.open,
		busy: () => s.busy,
		down: () => s.down,
		workers: () => s.workers,
		armed: () => s.armed,
		lastTurnEndAt: () => s.turnEnd,
		wake: (list, last) => s.wakes.push({ ids: list.map(r => r.replyTo), last }),
		drop: list => {
			s.dropped.push(...list.map(r => r.replyTo ?? "-"));
			s.open = s.open.filter(r => !list.includes(r));
		},
	};
	const check = createWaitCheck({ sessions: () => [session], restarting: () => s.restarting, log: () => {}, now: () => s.t });
	const run = (ms: number) => {
		for (const end = s.t + ms; s.t < end; s.t += TICK) check.tick();
	};
	return { s, check, run };
}

test("an open request with nothing running wakes the session once after two quiet minutes, naming every open request", () => {
	const { s, run } = setup([request("a"), request("b")]);
	run(QUIET_MS - TICK);
	expect(s.wakes).toEqual([]);
	run(TICK * 3);
	expect(s.wakes).toEqual([{ ids: ["a", "b"], last: false }]);
	run(RETRY_MS - TICK * 4);
	expect(s.wakes.length).toBe(1);
});

test("the wake repeats a bounded number of times, the last one says so, and then the request is left alone", () => {
	const { s, run } = setup([request("a")]);
	run(RETRY_MS * 10);
	expect(s.wakes.length).toBe(MAX_WAKES);
	expect(s.wakes.map(w => w.last)).toEqual([false, true]);
});

test("a request with no message id still open a retry interval after its last reminder is dropped, so no reminder follows the last one", () => {
	const { s, run } = setup([{ target: "web", at: 0, workers: [] }]);
	run(QUIET_MS + RETRY_MS + TICK * 2);
	expect(s.wakes.map(w => w.last)).toEqual([false, true]);
	expect(s.dropped).toEqual([]);
	run(RETRY_MS);
	expect(s.dropped).toEqual(["-"]);
	expect(s.open).toEqual([]);
});

test("a request with a message id, or one linked to a worker, is never dropped: its answer still has to reach that message", () => {
	const { s, run } = setup([request("a"), { target: "web", at: 0, workers: [{ id: "st_a" }] }]);
	run(RETRY_MS * 10);
	expect(s.wakes.length).toBe(MAX_WAKES);
	expect(s.dropped).toEqual([]);
	expect(s.open.length).toBe(2);
});

test("no wake while a worker, a turn, an armed watch or a restart runs, and the quiet time starts over when it ends", () => {
	for (const running of ["workers", "busy", "armed", "restarting"] as const) {
		const { s, run } = setup([request("a")]);
		if (running === "workers") s.workers = 1;
		else s[running] = true;
		run(QUIET_MS * 5);
		expect(s.wakes).toEqual([]);
		if (running === "workers") s.workers = 0;
		else s[running] = false;
		run(QUIET_MS - TICK);
		expect(s.wakes).toEqual([]);
		run(TICK * 2);
		expect(s.wakes.length).toBe(1);
	}
});

test("a turn that ended a moment ago restarts the quiet time, and no open request means no wake", () => {
	const { s, run } = setup([request("a")]);
	run(QUIET_MS - TICK);
	s.turnEnd = s.t;
	run(QUIET_MS - TICK);
	expect(s.wakes).toEqual([]);
	run(TICK * 2);
	expect(s.wakes.length).toBe(1);

	const idle = setup([]);
	idle.run(QUIET_MS * 5);
	expect(idle.s.wakes).toEqual([]);
});

test("a new request gets its own wake even after an older one used up its bound", () => {
	const { s, run } = setup([request("a")]);
	run(RETRY_MS * 5);
	s.open = [...s.open, request("b", s.t)];
	run(QUIET_MS + TICK * 2);
	expect(s.wakes.at(-1)!.ids).toEqual(["b"]);
});

test("a session down on errors spends no wake while it waits for the model host; the wakes are all there once it answers", () => {
	const { s, run } = setup([request("m1")]);
	s.down = true;
	run(QUIET_MS + RETRY_MS * 3);
	expect(s.wakes).toEqual([]);
	s.down = false;
	run(QUIET_MS + TICK);
	expect(s.wakes).toHaveLength(1);
	expect(s.wakes[0]!.last).toBe(false);
});
