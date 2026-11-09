import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { setupEnv } from "../features/reply-drafts/test/helpers.ts";
import { cfg, HUB_TOKEN } from "./config.ts";
import * as discord from "./discord.ts";
import { emit } from "./events.ts";
import { makeRoute } from "./routes.ts";
import { sessionKeyOf } from "./session-key.ts";
import { reloadTasks } from "./task-conversation.ts";

// Task conversations: real routes and logs, read back through GET /api/history and GET /api/conversations.
const env = setupEnv();
afterAll(env.cleanup);

const route = makeRoute({ busyNow: () => [], restartGateway: () => "", restartGatewayNow: () => "" });
const call = (method: string, path: string, body?: object) => route(new Request(`http://hub.test${path}`, { method, headers: { "x-dotz-token": HUB_TOKEN, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }));
type Row = { ts?: string; kind?: string; text?: string; mid?: string; task_ref?: string };
const rows = async (target: string): Promise<Row[]> => ((await (await call("GET", `/api/history?target=${encodeURIComponent(target)}&limit=500`)).json()) as { events: Row[] }).events;
const texts = async (target: string) => (await rows(target)).filter(e => !e.task_ref).map(e => e.text);
const open = async (title: string, refs: string[]) => call("POST", "/api/tasks", { title, refs });
const openId = async (title: string, refs: string[]) => ((await (await open(title, refs)).json()) as { id: string }).id;
const list = async () => ((await (await call("GET", "/api/tasks")).json()) as { enabled: boolean; items: { id: string }[] });
const convTargets = async () => ((await (await call("GET", "/api/conversations")).json()) as { items: { target: string; task?: { title: string } }[] }).items;

// One owner message and one answer per call, each a second apart, so the ts order is the order of the calls.
let tick = Date.parse("2030-01-01T00:00:00.000Z");
const stamp = () => new Date((tick += 1000)).toISOString();
let n = 0;
function owner(text: string, extra: object = {}): string {
	const mid = `m${++n}`;
	emit("inbox", { ts: stamp(), kind: "message", source: "web", channel: "web", author: "local", text, mid, ...extra });
	return mid;
}
function answer(text: string, replyTo: string): string {
	const ts = stamp();
	emit("outbox", { ts, kind: "out", target: "web", text, reply_to: replyTo });
	return ts;
}

const split = (on: boolean) => {
	cfg.conversations = { ...cfg.conversations, task_split: on };
};
beforeEach(() => {
	split(true);
	discord.status.enabled = false; // another test file in this process may have left Discord on
});

describe("task conversations", () => {
	test("off by default: refused and nothing moves", async () => {
		split(false);
		const m = owner("끔 시험 하나");
		answer("끔 시험 답", m);
		const r = await open("끔", [m]);
		expect(r.status).toBe(403);
		expect((await list()).enabled).toBe(false);
		expect(await texts("main")).toEqual(expect.arrayContaining(["끔 시험 하나", "끔 시험 답"]));
	});

	test("open moves the earlier messages and their answers out of main, in ts order; main keeps one pointer", async () => {
		const m1 = owner("A 작업 처음");
		const a1 = answer("A 작업 답 1", m1);
		owner("관계 없는 말");
		const m2 = owner("A 작업 또");
		answer("A 작업 답 2", m2);
		const r = await open("A 작업", [m1, m2]);
		expect(r.status).toBe(200);
		const { id, target } = (await r.json()) as { id: string; target: string };
		expect(target).toBe(`task:${id}`);
		expect(await texts(target)).toEqual(["A 작업 처음", "A 작업 답 1", "A 작업 또", "A 작업 답 2"]);
		const main = await texts("main");
		expect(main).toContain("관계 없는 말");
		expect(main).not.toContain("A 작업 처음");
		expect(main).not.toContain("A 작업 답 2");
		expect((await rows("main")).filter(e => e.task_ref === target)).toHaveLength(1);
		expect(a1 < (await rows(target)).find(e => e.text === "A 작업 또")!.ts!).toBe(true);
		const items = await convTargets();
		expect(items.find(c => c.target === target)?.task).toBeTruthy();
		expect((await list()).items.map(t => t.id)).toContain(id);
	});

	test("a later answer to a moved message lands in the task, and a quoted answer pulls its owner message in", async () => {
		const m1 = owner("B 작업 처음");
		const a1 = answer("B 작업 답", m1);
		const m2 = owner("B 작업 인용", { reply_to: a1 });
		const id = await openId("B 작업", [m1]);
		expect(await texts(`task:${id}`)).toEqual(["B 작업 처음", "B 작업 답", "B 작업 인용"]);
		answer("B 작업 나중 답", m2);
		expect(await texts(`task:${id}`)).toContain("B 작업 나중 답");
		expect(await texts("main")).not.toContain("B 작업 나중 답");
	});

	test("add moves one more message in; a follow-up through /api/message {task} stays in the task", async () => {
		const m1 = owner("C 작업 처음");
		const id = await openId("C 작업", [m1]);
		const m2 = owner("C 작업 추가");
		const added = await call("POST", `/api/tasks/${id}/add`, { refs: [m2] });
		expect(added.status).toBe(200);
		expect(await texts(`task:${id}`)).toContain("C 작업 추가");
		const sent = await call("POST", "/api/message", { text: "C 작업 이어서", task: id });
		expect(sent.status).toBe(200);
		expect(await texts(`task:${id}`)).toContain("C 작업 이어서");
		expect(await texts("main")).not.toContain("C 작업 이어서");
		expect(sessionKeyOf(`task:${id}`, { on: true })).toBe(`task:${id}`);
		expect((await call("POST", "/api/message", { text: "x", task: "zzzz0000" })).status).toBe(404);
		expect((await call("POST", "/api/message", { text: "x", task: id, lane: "any" })).status).toBe(400);
	});

	test("save makes a project holding everything and the task leaves the list", async () => {
		const m1 = owner("D 작업 처음");
		answer("D 작업 답", m1);
		const id = await openId("D 작업", [m1]);
		const r = await call("POST", `/api/tasks/${id}/save`, {});
		expect(r.status).toBe(200);
		const { project } = (await r.json()) as { project: string };
		expect(project).toMatch(/^ch:/);
		// a local project id may already hold rows another test file in this process wrote to it
		expect((await texts(project)).filter(t => t?.startsWith("D 작업"))).toEqual(["D 작업 처음", "D 작업 답"]);
		expect(await texts("main")).not.toContain("D 작업 처음");
		expect((await list()).items.map(t => t.id)).not.toContain(id);
	});

	test("a failed project channel answers 502 and the task stays open", async () => {
		const id = await openId("저장 실패", [owner("저장 실패 시험")]);
		const category = discord.channels.workCategory;
		discord.status.enabled = true;
		discord.channels.workCategory = "";
		const r = await call("POST", `/api/tasks/${id}/save`, {});
		discord.channels.workCategory = category;
		expect(r.status).toBe(502);
		expect((await list()).items.map(x => x.id)).toContain(id);
	});
	test("close to main restores the order in main; close to delete leaves them nowhere", async () => {
		const m1 = owner("E 작업 처음");
		answer("E 작업 답", m1);
		const e = await openId("E 작업", [m1]);
		const f1 = owner("F 작업 처음");
		answer("F 작업 답", f1);
		const f = await openId("F 작업", [f1]);
		expect((await call("POST", `/api/tasks/${e}/close`, { to: "main" })).status).toBe(200);
		const main = await texts("main");
		expect(main.indexOf("E 작업 처음")).toBeGreaterThan(-1);
		expect(main.indexOf("E 작업 답")).toBe(main.indexOf("E 작업 처음") + 1);
		expect((await call("POST", `/api/tasks/${f}/close`, { to: "delete" })).status).toBe(200);
		expect(await texts("main")).not.toContain("F 작업 처음");
		expect(await texts(`task:${f}`)).toEqual([]);
		expect((await list()).items.map(t => t.id)).not.toContain(f);
		expect((await convTargets()).map(c => c.target)).not.toContain(`task:${f}`);
	});

	test("records survive a reload", async () => {
		const m1 = owner("G 작업 처음");
		const id = await openId("G 작업", [m1]);
		reloadTasks();
		expect((await list()).items.map(t => t.id)).toContain(id);
		expect(await texts(`task:${id}`)).toEqual(["G 작업 처음"]);
	});

	test("bad refs, bad `to`, a double close and an unknown id are refused", async () => {
		const m1 = owner("H 작업 처음");
		expect((await open("H", ["nope"])).status).toBe(400);
		expect((await open("H", [])).status).toBe(400);
		expect((await open("", [m1])).status).toBe(400);
		const id = await openId("H 작업", [m1]);
		expect((await open("H 또", [m1])).status).toBe(400); // already moved out of main
		expect((await call("POST", `/api/tasks/${id}/close`, { to: "elsewhere" })).status).toBe(400);
		expect((await call("POST", `/api/tasks/${id}/close`, { to: "main" })).status).toBe(200);
		expect((await call("POST", `/api/tasks/${id}/close`, { to: "main" })).status).toBe(404);
		expect((await call("POST", "/api/tasks/zzzz0000/add", { refs: [m1] })).status).toBe(404);
		expect((await call("POST", "/api/tasks/zzzz0000/save", {})).status).toBe(404);
	});

	test("switching off afterwards keeps the moved messages where they are", async () => {
		const m1 = owner("I 작업 처음");
		const id = await openId("I 작업", [m1]);
		split(false);
		expect(await texts(`task:${id}`)).toEqual(["I 작업 처음"]);
		expect(await texts("main")).not.toContain("I 작업 처음");
		expect((await call("POST", `/api/tasks/${id}/add`, { refs: [m1] })).status).toBe(403);
	});
});
