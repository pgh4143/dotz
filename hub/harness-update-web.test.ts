// 설정 → 업데이트 → 작업 프로그램 at phone and desktop width against a stub gateway: the row, its badge and its buttons,
// and the nav badge naming which of dotz and the harness has a new version. Nothing is installed (the stub only records the POST).
import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { appAsset, indexPage } from "./webapp.ts";

const SHOTS = process.env.HARNESS_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const calls: string[] = [];
const SHA = "aaaaaaa1111111";
const commit = { sha: SHA, short: "aaaaaaa", date: "2026-10-26T01:00:00.000Z", subject: "이전 커밋" };
const dotz = (incomingTotal: number) => ({
	boot: "b1",
	running: { kind: "git", commit, branch: "main" },
	disk: { kind: "git", commit, branch: "main" },
	lastCheck: {
		at: "2026-10-26T02:00:00.000Z",
		version: { kind: "git", commit, branch: "main" },
		ok: true,
		upstream: "origin/main",
		incoming: incomingTotal ? [{ sha: "bbbbbbb2222222", short: "bbbbbbb", date: "2026-10-26T01:30:00.000Z", subject: "새 커밋" }] : [],
		incomingTotal,
		ahead: [],
		dropped: [],
		dirty: [],
		blocked: [],
	},
	job: null,
	busy: [],
	settings: { auto_check: true, auto_apply: false, at: "10:00" },
});
const harness = (available: boolean, extra: object = {}) => ({
	id: "omo",
	name: "OmO",
	current: "5.1.48",
	latest: available ? "5.1.49" : "5.1.48",
	available,
	checkedAt: "2026-10-26T02:00:00.000Z",
	installMethod: "bun-global",
	path: "/Users/fake/.bun/bin/omo",
	...extra,
});
let state = { dotzIncoming: 0, harnesses: [harness(true)] };
let checkGate: Promise<void> | null = null;   // holds the answer of POST /api/update/check until a test lets it go

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
		if (p === "/api/events") return new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(": open\n\n")); } }), { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
		if (p === "/api/state") return json({ name: "dotz", orchestrator: { status: "idle" }, lanes: [], terminals: {}, channels: { work: [] }, discord: {}, notices_unread: 0 });
		if (p === "/api/history") return json({ target: url.searchParams.get("target"), events: [] });
		if (p === "/api/activity") return json({ items: [], more: false, history: false });
		if (p === "/api/conversations") return json({ items: [] });
		if (p === "/api/notices") return json({ unread: 0, items: [] });
		if (p === "/api/monitors" || p === "/api/integrations") return json({ items: [] });
		if (p === "/api/kakao/rooms") return json({ on: true, rooms: [] });
		if (p === "/api/providers") return json({ providers: [] });
		if (p === "/api/models") return json({});
		if (p === "/api/runtimes")
			return json({
				current: { orchestrator: "omo", lanes: "omo" },
				checklist: [],
				runtimes: [
					{ id: "omo", label: "OmO", installed: true, hasAdapter: true, version: "5.1.48", roles: ["orchestrator", "lanes"] },
					{ id: "omp", label: "omp", installed: true, hasAdapter: true, version: "18.12.6", roles: [] },
				],
			});
		if (p === "/api/accounts")
			return json({
				mode: "pinned",
				chosen: { name: "default", label: "default", source: "manual", blocked: null, text: "" },
				accounts: [{ name: "default", order: 1, alias: null, label: "default", current: true, blocked: null, blocked_until: null, blocked_tag: null, five_hour_left: null, seven_day_left: null }],
				rules: {},
				rules_text: [],
				script: { path: null, timeout_ms: 5000, every_minutes: 5, last: null },
			});
		if (p === "/api/update") return json(dotz(state.dotzIncoming));
		if (p === "/api/update/check" && req.method === "POST") {
			if (checkGate) await checkGate;
			return json(dotz(state.dotzIncoming).lastCheck);
		}
		if (p === "/api/harness/update" && req.method === "GET") return json({ harnesses: state.harnesses, busy: [], checking: false });
		if (p === "/api/harness/update/check" && req.method === "POST") {
			calls.push("POST check");
			return json({ harnesses: state.harnesses, busy: [], checking: false });
		}
		if (p === "/api/harness/update/apply" && req.method === "POST") {
			const b = (await req.json()) as { id: string };
			calls.push(`POST apply ${b.id}`);
			state.harnesses = state.harnesses.map(h => (h.id === b.id ? harness(true, { job: { id: 1, harness: h.id, startedAt: "2026-10-26T02:01:00.000Z", status: "running", phase: "설치", message: "OmO 5.1.48 → 5.1.49 설치 중", steps: [{ at: "2026-10-26T02:01:00.000Z", text: "설치를 시작해요" }] } }) : h));
			return json({ job: state.harnesses[0]!.job }, 202);
		}
		return p.startsWith("/api/") ? json({}) : new Response("not found", { status: 404 });
	},
});

type View = InstanceType<typeof Bun.WebView>;
const views: View[] = [];
afterAll(() => { for (const v of views) v.close(); server.stop(true); });
const waitFor = (v: View, expr: string, ms = 10_000) =>
	v.evaluate(`new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("timeout: " + ${JSON.stringify(expr)})), ${ms}); const tick = () => { let ok = false; try { ok = !!(${expr}); } catch {} if (ok) { clearTimeout(t); res(true); } else requestAnimationFrame(tick); }; tick(); })`);
const q = async <T = unknown>(v: View, code: string): Promise<T> => JSON.parse((await v.evaluate(`JSON.stringify((() => { ${code} })())`)) as string) as T;
const run = (v: View, code: string) => v.evaluate(`(() => { ${code} })(), 0`);
const shot = async (v: View, name: string) => { if (SHOTS) await Bun.write(join(SHOTS, name), await v.screenshot()); };

async function open(w: number, h: number): Promise<View> {
	const v = new Bun.WebView({ width: w, height: h });
	views.push(v);
	await v.navigate(`http://127.0.0.1:${server.port}/`);
	await waitFor(v, `typeof NT !== "undefined" && NT.loaded && NM.loaded && S && typeof UPD !== "undefined" && UPD.info && typeof HV !== "undefined" && HV.info`);
	await run(v, `if (dotzTheme.get() === "dark") dotzTheme.toggle()`);
	await run(v, `go("runtime")`);
	await waitFor(v, `RT && document.querySelector("#runtime").textContent.includes("작업 프로그램 버전")`);
	return v;
}
const ROW = `[...document.querySelectorAll("#runtime .li")].find(r => r.querySelector(".hd") && r.querySelector(".hd").textContent === "OmO")`;
const SEC = `[...document.querySelectorAll("#runtime .sec")].find(s => s.textContent.startsWith("작업 프로그램 버전"))`;

test("phone 390px: the harness row shows current → latest, updates, and the settings tab badge counts both", async () => {
	state = { dotzIncoming: 1, harnesses: [harness(true)] };
	calls.length = 0;
	const v = await open(390, 844);
	const s = await q<{ badge: string; hidden: boolean; sub: string; tags: string[]; upd: boolean; check: boolean; heads: number; switcher: boolean; note: boolean }>(v, `const b = document.querySelector("#nav-upd"), row = ${ROW}, secs = [...document.querySelectorAll("#runtime .sec")].filter(s => s.textContent.startsWith("작업 프로그램 버전")); return { badge: b.textContent, hidden: b.hidden, sub: row.querySelector(".sup").textContent, tags: [...row.querySelectorAll(".tag")].map(t => t.textContent), upd: [...row.querySelectorAll("button")].some(x => x.textContent.trim() === "업데이트"), check: [...${SEC}.querySelectorAll("button")].some(x => x.textContent.trim() === "새 버전 확인"), heads: secs.length, switcher: !!row.querySelector("button[aria-label='OmO 바꾸기']"), note: document.querySelectorAll("#runtime .note").length === 1 }`);
	expect(s.hidden).toBe(false);
	expect(s.badge).toBe("dotz · OmO 새 버전");
	expect(s.sub).toContain("지금 5.1.48 → 5.1.49");
	expect(s.sub).toContain("어시스턴트·세션 사용 중");
	expect(s.tags).toContain("새 버전");
	expect(s.upd).toBe(true);
	expect(s.check).toBe(true);
	expect(s.heads).toBe(1);
	expect(s.switcher).toBe(true);
	expect(s.note).toBe(true);
	await run(v, `[...${SEC}.querySelectorAll("button")].find(b => b.textContent.trim() === "새 버전 확인").click()`);
	await waitFor(v, `document.querySelector(".snack") && document.querySelector(".snack").textContent.includes("작업 프로그램")`);
	await run(v, `[...${ROW}.querySelectorAll("button")].find(b => b.textContent.trim() === "업데이트").click()`);
	await waitFor(v, `document.querySelector("#runtime").textContent.includes("업데이트 중")`);
	const busy = await q<{ label: string; upd: boolean; faded: boolean }>(v, `const row = ${ROW}; const tag = [...row.querySelectorAll(".tag")].find(t => t.textContent.includes("진행 중")); return { label: tag ? tag.textContent : "", upd: [...row.querySelectorAll("button")].some(b => b.textContent.trim() === "업데이트"), faded: !!row.querySelector("button[disabled]") && !tag }`);
	expect(busy.label).toBe("진행 중");
	expect(busy.upd).toBe(false);
	expect(busy.faded).toBe(false);
	expect(calls).toContain("POST check");
	expect(calls).toContain("POST apply omo");
	await run(v, `${SEC}.scrollIntoView({ block: "start" })`);
	await shot(v, "harness-update-390.png");
	state = { dotzIncoming: 0, harnesses: [harness(true)] };
}, 20_000);

test("desktop 1280px: only the harness has a new version, the badge still shows it", async () => {
	state = { dotzIncoming: 0, harnesses: [harness(true)] };
	const v = await open(1280, 900);
	const s = await q<{ badge: string; hidden: boolean; overflow: number; heads: number }>(v, `const b = document.querySelector("#nav-upd"); return { badge: b.textContent, hidden: b.hidden, overflow: document.documentElement.scrollWidth - innerWidth, heads: [...document.querySelectorAll("#runtime .sec")].filter(s => s.textContent.startsWith("작업 프로그램 버전")).length }`);
	expect(s.hidden).toBe(false);
	expect(s.badge).toBe("OmO 새 버전");
	expect(s.overflow).toBeLessThanOrEqual(0);
	expect(s.heads).toBe(1);
	await run(v, `${SEC}.scrollIntoView({ block: "start" })`);
	await shot(v, "harness-update-1280.png");
});

test("a harness with no new version shows 최신 and no update button", async () => {
	state = { dotzIncoming: 0, harnesses: [harness(false)] };
	const v = await open(390, 844);
	const s = await q<{ sub: string; upd: boolean; hidden: boolean }>(v, `const row = ${ROW}; return { sub: row.querySelector(".sup").textContent, upd: [...row.querySelectorAll("button")].some(x => x.textContent.trim() === "업데이트"), hidden: document.querySelector("#nav-upd").hidden }`);
	expect(s.sub).toContain("지금 5.1.48 · 최신");
	expect(s.upd).toBe(false);
	expect(s.hidden).toBe(true);
});

test("a managed harness says who owns it and offers no update button", async () => {
	state = { dotzIncoming: 0, harnesses: [harness(false, { installMethod: "managed", managedBy: "Tern", latest: null })] };
	const v = await open(390, 844);
	const s = await q<{ sub: string; upd: boolean }>(v, `const row = ${ROW}; return { sub: row.querySelector(".sup").textContent, upd: [...row.querySelectorAll("button")].some(x => x.textContent.trim() === "업데이트") }`);
	expect(s.sub).toContain("Tern이 관리해요");
	expect(s.upd).toBe(false);
});

// Owner 2026-11-09: an OmO-only update also marked dotz's own 업데이트 row. Each row and the tab badge name only what really has a new version.
test("settings: an OmO update marks only 작업 프로그램, a dotz update only 업데이트, both name both", async () => {
	const cases = [
		{ dotzIncoming: 0, omo: true, upd: [], rt: ["새 버전"], title: "OmO 새 버전이 있어요" },
		{ dotzIncoming: 1, omo: false, upd: ["새 버전"], rt: [], title: "dotz 새 버전이 있어요" },
		{ dotzIncoming: 1, omo: true, upd: ["새 버전"], rt: ["새 버전"], title: "dotz, OmO 새 버전이 있어요" },
	];
	for (const c of cases) {
		state = { dotzIncoming: c.dotzIncoming, harnesses: [harness(c.omo)] };
		const v = await open(390, 844);
		await run(v, `go("settings")`);
		await waitFor(v, `document.querySelector("#settings").textContent.includes("작업 프로그램")`);
		const tags = (hd: string) => `[...([...document.querySelectorAll("#settings .li")].find(r => r.querySelector(".hd") && r.querySelector(".hd").textContent === "${hd}") || document.createElement("i")).querySelectorAll(".tag")].map(t => t.textContent)`;
		const s = await q<{ upd: string[]; rt: string[]; title: string; hidden: boolean }>(v, `const b = document.querySelector("#nav-upd"); return { upd: ${tags("업데이트")}, rt: ${tags("작업 프로그램")}, title: b.title, hidden: b.hidden }`);
		expect(s).toEqual({ upd: c.upd, rt: c.rt, title: c.title, hidden: false });
		await run(v, `[...document.querySelectorAll("#settings .li")].find(r => r.textContent.includes("작업 프로그램")).scrollIntoView({ block: "center" })`);
		await waitFor(v, `document.getAnimations().every(a => a.playState !== "running")`);
		await shot(v, `settings-${c.dotzIncoming}${c.omo ? 1 : 0}-390.png`);
	}
}, 30_000);

test("update screen: 확인 turns the pressed row into 확인하는 중 and the card stays, then the result comes back into it", async () => {
	state = { dotzIncoming: 0, harnesses: [harness(false)] };
	const v = await open(390, 844);
	await run(v, `go("update")`);
	const ROWBTN = `document.querySelector("#update #upd-sec .li button")`;
	await waitFor(v, ROWBTN);
	let free = () => {};
	checkGate = new Promise<void>(r => { free = r; });
	await run(v, `${ROWBTN}.click()`);
	await waitFor(v, `document.querySelector("#update #upd-sec .li .sup").textContent === "확인하는 중…"`);
	expect(await q(v, `return [${ROWBTN}.disabled, !!document.querySelector("#update #upd-sec")]`)).toEqual([true, true]);
	checkGate = null;
	free();
	await waitFor(v, `document.querySelector("#update #upd-sec .li .sup").textContent.startsWith("실행 중") && !${ROWBTN}.disabled`);
	expect(await q<number>(v, `return document.querySelectorAll("#update #upd-sec .li").length`)).toBeGreaterThan(1);
}, 30_000);
