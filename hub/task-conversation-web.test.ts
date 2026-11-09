import { afterAll, expect, test } from "bun:test";
import { fakeHub, json, waitFor, run, type View } from "./test-web.ts";

// A task conversation in the web app (web/js/08-home.js, 31-conversations.js): routing of its events, its rows in the list and the right column,
// and the close dialog's two answers, in a headless Bun.WebView against a stub gateway. Names are placeholders.
const T = "task:ab12cd34";
const posts: { path: string; body: unknown }[] = [];
const hub = fakeHub({
	stream: "fake",
	api: async (req, url) => {
		const p = url.pathname;
		if (p === "/api/state") return json({ name: "dotz", orchestrator: { status: "idle" }, lanes: [], terminals: {}, channels: { work: {} }, discord: {}, notices_unread: 0 });
		if (p === "/api/history") return json({ target: url.searchParams.get("target"), events: [] });
		if (p === "/api/conversations") return json({ items: [{ target: "main", last: null, read: null, unread: 0 }, { target: T, last: { ts: "2026-11-09T01:00:00.000Z", text: "견적서 정리", from: "bot" }, read: null, unread: 0, task: { title: "견적서" } }] });
		if (p === "/api/monitors") return json({ items: [] });
		if (p === "/api/notices") return json({ unread: 0, items: [] });
		if (p.startsWith("/api/tasks/") && req.method === "POST") {
			posts.push({ path: p, body: await req.json() });
			return json({ ok: true });
		}
	},
});

afterAll(() => { hub.stop(); });

const q = async <T = unknown>(v: View, code: string): Promise<T> => JSON.parse((await v.evaluate(`JSON.stringify((() => { ${code} })())`)) as string) as T;

async function boot(width: number): Promise<View> {
	const v = await hub.view({ width, height: 844 });
	const opened = hub.nextStream();
	await v.navigate(`${hub.origin}/`);
	await opened;
	await waitFor(v, `typeof S !== "undefined" && S && typeof TASKS !== "undefined" && TASKS.has(${JSON.stringify(T)})`);
	await run(v, `go("chat", ${JSON.stringify(T)})`);
	await waitFor(v, `target === ${JSON.stringify(T)} && current === "chat"`);
	return v;
}

test("eventTarget routes a task and a project named in conv", async () => {
	const v = await boot(1280);
	expect(await q(v, `return [{ kind: "out", conv: ${JSON.stringify(T)} }, { kind: "out", channel: ${JSON.stringify(T)} }, { kind: "out", conv: "ch:7001" }, { kind: "out", target: "web", task_ref: ${JSON.stringify(T)} }].map(eventTarget)`)).toEqual([T, T, "ch:7001", "main"]);
});

test("a task has its row in the list below 1280px and in the right column from 1280px", async () => {
	const phone = await boot(390);
	expect(await q(phone, `return document.querySelectorAll('#chat-convo .cv-row[data-t=${JSON.stringify(T)}]').length`)).toBe(1);
	expect(await q(phone, `return getComputedStyle(document.querySelector("#task-side")).display`)).toBe("none");
	const wide = await boot(1280);
	await waitFor(wide, `document.querySelector("#task-side:not([hidden]) .cv-row")`);
	expect(await q(wide, `return document.querySelector('#chat-convo .cv-row[data-t=${JSON.stringify(T)}]').getClientRects().length`)).toBe(0);
	expect(await q(wide, `return document.querySelector('#task-side .cv-row[data-t=${JSON.stringify(T)}]').getAttribute("aria-current")`)).toBe("true");
});

test("closing posts to: main, and to: delete after a second confirm", async () => {
	posts.length = 0;
	const v = await boot(1280);
	const click = (code: string) => run(v, code);
	const dlg = `[...document.querySelectorAll("dialog .dact .btn")]`;
	await waitFor(v, `document.querySelector('.cv-hd-a [data-k="task-close"]')`);
	await click(`document.querySelector('.cv-hd-a [data-k="task-close"]').click()`);
	await waitFor(v, `${dlg}.length === 3`);
	await click(`${dlg}[1].click()`);
	await waitFor(v, `target === "main"`);
	await run(v, `go("chat", ${JSON.stringify(T)})`);
	await waitFor(v, `target === ${JSON.stringify(T)} && document.querySelector('.cv-hd-a [data-k="task-close"]')`);
	await click(`document.querySelector('.cv-hd-a [data-k="task-close"]').click()`);
	await waitFor(v, `${dlg}.length === 3`);
	await click(`${dlg}[2].click()`);
	await waitFor(v, `${dlg}.length === 2`);
	await click(`${dlg}[1].click()`);
	await waitFor(v, `target === "main"`);
	expect(posts.map(p => [p.path, p.body])).toEqual([[`/api/tasks/ab12cd34/close`, { to: "main" }], [`/api/tasks/ab12cd34/close`, { to: "delete" }]]);
});
