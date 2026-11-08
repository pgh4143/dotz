import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { appAsset, indexPage } from "./webapp.ts";

// 프로젝트 list by computer (web/js/18-lanes.js pcSplit, docs/customization.md Projects by computer): a headless Bun.WebView against a
// stub gateway. Screenshots are written only when PROJECTS_SHOTS names a folder. Computer names are placeholders.
const SHOTS = process.env.PROJECTS_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const AT = "2026-10-25T09:00:00.000Z";
const proj = (key: string, name: string, computer: string, pinned = false) => ({ key, name, computer, pinned, lanes: [], record: { title: name, purpose: `${name} 정리`, updated: AT } });
const builtin = { key: "builtin:custom", name: "커스텀", note: "내 취향대로 바꾼 것", pinned: true, builtin: true, lanes: [] };
const projects = [proj("dir:~/Code/blog", "블로그", "home-pc", true), proj("dir:~/Code/notes", "메모 정리", "home-pc"), proj("dir:~/Code/report", "주간 보고", "office-pc", true)];
const SINGLE = [{ name: "home-pc", self: true, online: true, keys: ["dir:~/Code/blog", "dir:~/Code/notes"], remote: [] }];
const TWO = [
	{ name: "home-pc", self: true, online: true, keys: ["dir:~/Code/blog", "dir:~/Code/notes"], remote: [] },
	{ name: "laptop", self: false, url: "https://laptop.example:7420", online: false, keys: [], remote: [] },
	{ name: "office-pc", self: false, url: "https://office-pc.example:7420", online: true, keys: ["dir:~/Code/report"], remote: [{ key: "dir:~/Code/site", name: "회사 사이트", note: "회사 홈페이지를 고쳐요" }] },
];
let computers: unknown[] = SINGLE;
let listed = projects.slice(0, 2);

const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
let streamWaiters: (() => void)[] = [];
const te = new TextEncoder();
const json = (v: unknown, status = 200) => Response.json(v, { status });
const server = Bun.serve({
	port: 0,
	hostname: "127.0.0.1",
	idleTimeout: 0,
	async fetch(req) {
		const url = new URL(req.url), p = url.pathname;
		if (p === "/") return indexPage(req);
		const asset = appAsset(req, p);
		if (asset) return asset;
		if (p === "/api/events") {
			let ctl: ReadableStreamDefaultController<Uint8Array>;
			const body = new ReadableStream<Uint8Array>({
				start(c) { ctl = c; streams.add(c); c.enqueue(te.encode(": open\n\n")); const w = streamWaiters; streamWaiters = []; for (const f of w) f(); },
				cancel() { streams.delete(ctl); },
			});
			return new Response(body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
		}
		if (p === "/api/state") return json({ name: "dotz", orchestrator: { status: "idle" }, lanes: [], terminals: {}, channels: { work: {}, homes: {}, lanes: {}, threads: {} }, discord: {}, notices_unread: 0 });
		if (p === "/api/custom") return json({ dir: "~/.dotz/custom", cards: [], projects: [builtin, ...listed], routines: [], links: [] });
		if (p === "/api/custom/computers") return json(computers);
		if (p === "/api/history") return json({ target: url.searchParams.get("target"), events: [] });
		if (p === "/api/conversations" || p === "/api/monitors") return json({ items: [] });
		if (p === "/api/notices") return json({ unread: 0, items: [] });
		if (p === "/api/todo" || p === "/api/activity") return json({ items: [] });
		return p.startsWith("/api/") ? json({}) : new Response("not found", { status: 404 });
	},
});

type View = InstanceType<typeof Bun.WebView>;
const views: View[] = [];
afterAll(() => { for (const v of views) v.close(); for (const c of streams) { try { c.close(); } catch { /* already closed */ } } server.stop(true); });

const waitFor = (v: View, expr: string, ms = 4000) =>
	v.evaluate(`new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("timeout: " + ${JSON.stringify(expr)})), ${ms}); const tick = () => { let ok = false; try { ok = !!(${expr}); } catch {} if (ok) { clearTimeout(t); res(true); } else requestAnimationFrame(tick); }; tick(); })`);
const q = async <T = unknown>(v: View, code: string): Promise<T> => JSON.parse((await v.evaluate(`JSON.stringify((() => { ${code} })())`)) as string) as T;
const run = (v: View, code: string) => v.evaluate(`(() => { ${code} })(), 0`);
const shot = async (v: View, name: string) => { if (SHOTS) { await waitFor(v, `document.getAnimations().every(a => a.playState !== "running" || (a.effect && a.effect.getTiming().iterations === Infinity))`); await Bun.write(join(SHOTS, name), await v.screenshot()); } };
const heads = `[...document.querySelectorAll("#pl-list .sec")].map(h => h.textContent)`;
const names = `[...document.querySelectorAll("#pl-list .pl-row:not([data-key='builtin:custom']) .pl-n")].map(n => n.textContent)`;

async function boot(width: number, height: number, ready: string): Promise<View> {
	const v = new Bun.WebView({ width, height });
	views.push(v);
	const opened = new Promise<void>(r => streamWaiters.push(r));
	await v.navigate(`http://127.0.0.1:${server.port}/`);
	await opened;
	await waitFor(v, `typeof S !== "undefined" && S`);
	await run(v, `localStorage.removeItem("dotz-pj-fold"); if (dotzTheme.get() === "dark") dotzTheme.toggle()`);
	await run(v, `go("projects")`);
	await waitFor(v, ready);
	return v;
}

for (const [w, h] of [[390, 844], [1280, 800]] as const) {
	test(`at ${w}px one computer keeps the list as it was: 고정, 전체 and 내 설정, no computer headers`, async () => {
		computers = SINGLE;
		listed = projects.slice(0, 2);
		const v = await boot(w, h, `document.querySelector(".pl-row") && typeof PRJ_PC !== "undefined" && PRJ_PC`);
		await shot(v, `single-${w}.png`);
		expect(await q(v, `return ${heads}`)).toEqual(["고정", "전체", "내 설정"]);
		expect(await q(v, `return document.querySelectorAll(".pl-pc").length`)).toBe(0);
	});

	test(`at ${w}px two or more computers: a folding header each, this computer first, an offline one marked, another's project opens there`, async () => {
		computers = TWO;
		listed = projects;
		const v = await boot(w, h, `document.querySelector(".pl-pc")`);
		await shot(v, `computers-${w}.png`);
		expect(await q(v, `return [...document.querySelectorAll(".pl-pc")].map(b => [b.querySelector(".pl-pcn").textContent, b.querySelector(".tag")?.textContent ?? "", b.getAttribute("aria-expanded")])`))
			.toEqual([["home-pc", "이 컴퓨터", "true"], ["laptop", "연결 안 됨", "true"], ["office-pc", "", "true"]]);
		expect(await q(v, `return ${names}`)).toEqual(["블로그", "메모 정리", "주간 보고", "회사 사이트"]);
		await run(v, `window.prGo = h => { window.__went = h; }; document.querySelector('.pl-row[data-key="dir:~/Code/site"]').click()`);
		expect(await q<string>(v, `return window.__went`)).toStartWith("https://office-pc.example:7420/?did=");
		expect(await q<string>(v, `return window.__went`)).toEndWith(`#project/${encodeURIComponent("dir:~/Code/site")}`);
		await run(v, `document.querySelector(".pl-pc").click()`);
		await waitFor(v, `document.querySelector(".pl-pc").getAttribute("aria-expanded") === "false"`);
		expect(await q(v, `return ${names}`)).toEqual(["주간 보고", "회사 사이트"]);
		expect(await q(v, `return JSON.parse(localStorage.getItem("dotz-pj-fold"))`)).toEqual(["home-pc"]);
		await run(v, `const s = document.querySelector(".pl-search input"); s.value = "보고"; s.dispatchEvent(new Event("input", { bubbles: true }))`);
		await waitFor(v, `document.querySelectorAll(".pl-pc").length === 1`);
		expect(await q(v, `return [document.querySelector(".pl-pc .pl-pcn").textContent, ${names}]`)).toEqual(["office-pc", ["주간 보고"]]);
	});
}
