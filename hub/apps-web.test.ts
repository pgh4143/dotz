// 앱 (web/js/30-apps.js): the list shows a user app with its running dot and the monitoring apps, and opening it puts the
// gateway-proxied page in the frame under the dotz header (back, name, status, 새 탭, ⋯), at 390 and 1280.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appAsset, indexPage } from "./webapp.ts";

const SHOTS = process.env.T7_SHOTS ?? join(tmpdir(), "dotz-shots", "apps");
mkdirSync(SHOTS, { recursive: true });
const json = (v: unknown) => Response.json(v);
const items = [
	{ id: "mydocs", label: "문서 도구", kind: "tool", source: "manifest", icon: "file", status: "running", off: false, health: "/", watches: [], settings: { port: 4417 }, web: { url: "http://127.0.0.1:4417", path: "/", mode: "rewrite", href: "/apps/mydocs/" }, start: { command: "bun src/server.ts", cwd: "~/Code/my-docs" } },
	{ id: "kakao", label: "카카오톡", kind: "monitor", source: "registry", icon: "chat", status: "running" },
];
const errors = [{ id: "broken", dir: "/tmp/custom/apps/broken", reason: "app.json을 읽을 수 없어요: Unexpected token" }];
const PAGE = `<!doctype html><html><head><title>fake docs tool</title></head><body><h1>가짜 문서 앱</h1><button id="appbtn">앱 안의 버튼</button></body></html>`;
const server = Bun.serve({
	port: 0,
	hostname: "127.0.0.1",
	idleTimeout: 0,
	fetch(req) {
		const url = new URL(req.url);
		if (url.pathname === "/") return indexPage(req);
		const asset = appAsset(req, url.pathname);
		if (asset) return asset;
		if (url.pathname === "/api/apps") return json({ items, errors });
		if (url.pathname === "/apps/mydocs/" || url.pathname === "/apps/mydocs/index.html") return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
		if (url.pathname === "/api/state") return json({ name: "dotz", orchestrator: { status: "idle" }, lanes: [], terminals: {}, channels: { work: [] }, discord: {} });
		if (url.pathname === "/api/history") return json({ target: url.searchParams.get("target"), events: [] });
		if (url.pathname === "/api/activity") return json({ items: [], more: false, history: false });
		if (url.pathname === "/api/conversations") return json({ items: [] });
		if (url.pathname === "/api/notices") return json({ unread: 0, items: [] });
		if (url.pathname === "/api/monitors") return json({ items: [] });
		if (url.pathname === "/api/integrations") return json({ items: [{ key: "kakao", app: "kakao", label: "카카오톡", kind: "app", icon: "chat", conv: [], unread: 0, unreplied: 0, notices: [], needs: { drafts: 0, unread: 0, sentToday: 0 } }], available: [] });
		return url.pathname.startsWith("/api/") ? json({}) : new Response("not found", { status: 404 });
	},
});

const errorsSeen: string[] = [];
const view = new Bun.WebView({ width: 390, height: 844, console: (type: string, ...args: unknown[]) => { if (type === "error") errorsSeen.push(args.map(String).join(" ")); } } as ConstructorParameters<typeof Bun.WebView>[0]);
afterAll(() => { view.close(); server.stop(true); });

const waitFor = (expr: string, ms = 10_000) =>
	view.evaluate(`new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("timeout: " + ${JSON.stringify(expr)})), ${ms}); const tick = () => { let ok = false; try { ok = !!(${expr}); } catch {} if (ok) { clearTimeout(t); res(true); } else requestAnimationFrame(tick); }; tick(); })`);

async function boot() {
	await view.navigate(`http://127.0.0.1:${server.port}/`);
	await waitFor(`typeof current !== "undefined" && typeof APPS !== "undefined" && APPS.loaded && S`);
	await view.evaluate(`(APPS_ON = true, go("apps"), 0)`);
	await waitFor(`current === "apps" && APPS.loaded && $("#apps-side").children.length`);
}

describe("앱 at 390px", () => {
	test("lists the user app with its status and the monitoring app, and opens it in a frame under the header", async () => {
		await view.resize?.(390, 844);
		errorsSeen.length = 0;
		await boot();
		const list = await view.evaluate(`(() => $("#apps-side").innerText)()`) as string;
		expect(list).toContain("사용자 앱");
		expect(list).toContain("문서 도구");
		expect(list).toContain("실행 중");
		expect(list).toContain("모니터링 앱");
		expect(list).toContain("카카오톡");
		expect(list).toContain("불러오지 못한 앱");
		expect(list).toContain("broken");
		expect(await view.evaluate(`(() => document.querySelectorAll("#apps-side .cv-row").length)()`)).toBe(3);
		// the state is said once, at the row's right as dot + word; no corner dot on the icon
		expect(await view.evaluate(`(() => !!document.querySelector("#apps-side .cv-row .tag.ok") && !document.querySelector("#apps-side .app-dot"))()`)).toBe(true);
		await Bun.write(join(SHOTS, "apps-list-390.png"), await view.screenshot());
		await view.evaluate(`(() => { [...document.querySelectorAll("#apps-side .cv-row")].find(b => b.dataset.k === "mydocs").click(); return 0; })()`);
		await waitFor(`!!document.querySelector("#apps-pane .apps-frame")`);
		expect(await view.evaluate(`(() => $("#apps-pane .apps-n").textContent)()`)).toBe("문서 도구");
		expect(await view.evaluate(`(() => $("#apps-pane .apps-p").textContent)()`)).toContain("실행 중");
		expect(await view.evaluate(`(() => $("#apps-pane .apps-frame").getAttribute("src"))()`)).toBe("/apps/mydocs/");
		expect(await view.evaluate(`(() => !!$("#apps-pane a[target=_blank]"))()`)).toBe(true);
		expect(await view.evaluate(`(() => [...$("#apps-pane").querySelectorAll("button[aria-label='앱 메뉴'], button.apps-menu")].length)()`)).toBe(1);
		await waitFor(`(() => { try { return document.querySelector("#apps-pane .apps-frame").contentDocument.body.innerText.includes("가짜 문서 앱"); } catch { return false; } })()`);
		await Bun.write(join(SHOTS, "apps-open-390.png"), await view.screenshot());
		expect(await view.evaluate(`(location.hash)`)).toBe("#apps/mydocs");
		expect(errorsSeen).toEqual([]);
	}, 25_000);

	test("the menu shows 설정 / 끄기 / 제거, and 설정 shows the start command and the app's settings", async () => {
		await view.evaluate(`(() => { $("#apps-pane button[aria-label='앱 메뉴']").click(); return 0; })()`);
		await waitFor(`document.querySelector(".menu") && document.querySelector(".menu").innerText.includes("제거")`);
		const menu = await view.evaluate(`(() => document.querySelector(".menu").innerText)()`) as string;
		expect(menu).toContain("설정");
		expect(menu).toContain("끄기");
		expect(menu).toContain("제거");
		await view.evaluate(`(() => { [...document.querySelectorAll(".menu .mi")].find(b => b.textContent.trim() === "설정").click(); return 0; })()`);
		await waitFor(`document.querySelector("dialog[open]") && document.querySelector("dialog[open]").innerText.includes("bun src/server.ts")`);
		const dl = await view.evaluate(`(() => document.querySelector("dialog[open]").innerText)()`) as string;
		expect(dl).toContain("~/Code/my-docs");
		expect(dl).toContain("4417");
		await view.evaluate(`(() => { document.querySelector("dialog[open]").close(); return 0; })()`);
	}, 25_000);
});

describe("앱 at 1280px", () => {
	test("keeps the list beside the open app, the same row style as 모니터링", async () => {
		await view.resize?.(1280, 900);
		errorsSeen.length = 0;
		await view.evaluate(`(APPS_ON = true, go("apps"), 0)`);
		await waitFor(`current === "apps" && !!document.querySelector("#apps-pane .apps-frame")`);
		expect(await view.evaluate(`(() => { const s = $("#apps-side").getBoundingClientRect(), p = $("#apps-pane").getBoundingClientRect(); return s.right <= p.left + 1 && s.width > 120; })()`)).toBe(true);
		expect(await view.evaluate(`(() => $("#apps-pane .apps-frame").getBoundingClientRect().height > 300)()`)).toBe(true);
		await waitFor(`(() => { try { return document.querySelector("#apps-pane .apps-frame").contentDocument.body.innerText.includes("가짜 문서 앱"); } catch { return false; } })()`);
		expect(await view.evaluate(`(() => !!$("#apps-pane button[aria-label='앱 목록']"))()`)).toBe(false);
		await Bun.write(join(SHOTS, "apps-open-1280.png"), await view.screenshot());
		expect(errorsSeen).toEqual([]);
	}, 25_000);
});

// The 앱 tab is drawn only while it is shown: no app frame (its page, sockets, CPU) loads behind 홈, entering 앱 draws at once, and a phone
// coming back to 앱 from another tab gets the list, not the app it had open.
describe("앱 is drawn only while shown", () => {
	const fresh: InstanceType<typeof Bun.WebView>[] = [];
	afterAll(() => { for (const v of fresh) v.close(); });
	const waitOn = (v: InstanceType<typeof Bun.WebView>, expr: string, ms = 10_000) =>
		v.evaluate(`new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("timeout: " + ${JSON.stringify(expr)})), ${ms}); const tick = () => { let ok = false; try { ok = !!(${expr}); } catch {} if (ok) { clearTimeout(t); res(true); } else requestAnimationFrame(tick); }; tick(); })`);
	const open = async (width: number, height: number) => {
		const v = new Bun.WebView({ width, height });
		fresh.push(v);
		await v.navigate(`http://127.0.0.1:${server.port}/`);
		// APPS.loaded and the scheduled paint are set together, so !appsRaf means that paint has run.
		await waitOn(v, `typeof APPS !== "undefined" && APPS.loaded && S && current === "home" && !appsRaf`);
		return v;
	};

	test("until user apps ship, the 앱 tab is hidden from the nav, and no way leads into it", async () => {
		const v = await open(1280, 900);
		const got = JSON.parse(await v.evaluate(`JSON.stringify({ order: [...document.querySelectorAll("#nav .ni")].map(b => b.dataset.view), tab: !!document.querySelector('#nav .ni[data-view="apps"]'), landed: (go("apps"), current) })`) as string);
		expect(got).toEqual({ order: ["home", "chat", "projects", "monitoring", "settings"], tab: false, landed: "home" });
		expect(await v.evaluate(`!!document.querySelector("#apps-pane .apps-frame")`)).toBe(false);
	}, 25_000);

	test("wide: nothing is built behind 홈, and 앱 draws its frame as soon as it is entered", async () => {
		const v = await open(1280, 900);
		expect(await v.evaluate(`!!document.querySelector("#apps-pane .apps-frame")`)).toBe(false);
		expect(await v.evaluate(`(APPS_ON = true, go("apps"), !!document.querySelector("#apps-pane .apps-frame"))`)).toBe(true);
		await v.evaluate(`(go("home"), 0)`);
		// Leaving 앱 does not schedule another paint of it.
		await waitOn(v, `!appsRaf`);
		expect(await v.evaluate(`current`)).toBe("home");
	}, 25_000);

	test("phone: an open app, then 홈, then 앱 shows the list", async () => {
		const v = await open(390, 844);
		expect(await v.evaluate(`!!document.querySelector("#apps-pane .apps-frame")`)).toBe(false);
		await v.evaluate(`(APPS_ON = true, go("apps", "mydocs"), 0)`);
		await waitOn(v, `!!document.querySelector("#apps-pane .apps-frame") && !document.querySelector("#v-apps").classList.contains("cv-listing")`);
		await v.evaluate(`(go("home"), 0)`);
		const got = JSON.parse(await v.evaluate(`(go("apps"), JSON.stringify({ listing: document.querySelector("#v-apps").classList.contains("cv-listing"), list: APPS.list, hash: location.hash, side: document.querySelector("#apps-side").getBoundingClientRect().width > 0 }))`) as string);
		expect(got).toEqual({ listing: true, list: true, hash: "#apps", side: true });
	}, 25_000);
});
