import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSettings, viewOf, writeSettings, type SettingValue } from "./app-settings.ts";
import { featuresOf } from "./app-features.ts";
import { WATCH_FIELDS } from "./watch-settings.ts";
import { appAsset, indexPage } from "./webapp.ts";
import type { Watch } from "./watch.ts";

// Every app's settings screen (web/js/32-app-settings.js), as shipped, against a stub gateway whose routes call the real hub modules on a temp data
// dir: one control per concept, the sections in one order (연결 상태 -> 알림 -> 자동 초안과 승인 -> 감시 -> 기타 기능 -> 고급), and no feature
// switch drawn twice. A plain monitor (settings:w:<watch>) goes through the same screen. Screenshots only when SETTINGS_SHOTS names a folder.
const SHOTS = process.env.SETTINGS_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "as-apps-web-"));
mkdirSync(join(data, "custom/sns"), { recursive: true });
writeFileSync(join(data, "custom/sns/config.json"), JSON.stringify({ instagram: {}, youtube: {} }));

const RUN = "2026-10-23T03:00:00.000Z";
const watch = (name: string, extra: Partial<Watch> = {}): Watch => ({ name, command: "true", every_minutes: 10, state: { fails: 0, lastRun: RUN, lastOk: RUN }, ...extra }) as unknown as Watch;
const WATCHES = [
	watch("webmail-inbox"),
	watch("kakao-new"),
	watch("sns-ig-comments"),
	watch("ig-site-login", { session: { url: "https://www.instagram.com/", refresh_hours: 6 } }),
	watch("sns-yt-bulk", { label: "유튜브 다국어 설명 적용" }),
	watch("disk-check", { label: "디스크 점검" }),
];
const LABEL: Record<string, string> = { "webmail-inbox": "메일 확인", "kakao-new": "카카오 확인", "sns-ig-comments": "댓글 확인", "ig-site-login": "인스타그램 로그인", "sns-yt-bulk": "유튜브 다국어 설명 적용", "disk-check": "디스크 점검" };
const OWN: Record<string, string[]> = { mail: ["webmail-inbox"], kakao: ["kakao-new"], instagram: ["sns-ig-comments", "ig-site-login"], youtube: ["sns-yt-bulk"], site: [] };
const APPS = [
	{ key: "mail", label: "메일", icon: "mail" },
	{ key: "kakao", label: "카카오톡", icon: "chat" },
	{ key: "instagram", label: "인스타그램", icon: "instagram" },
	{ key: "youtube", label: "유튜브", icon: "youtube" },
	{ key: "site", label: "웹사이트 댓글", icon: "comment" },
];
const monitors = WATCHES.map(w => ({ name: LABEL[w.name], watch: w.name, kind: "watch", every: "10분마다", last_run: RUN, last_result: "ok", fails: 0, ...(w.session ? { keeper: true } : {}) }));
// The monitor's own settings read as fields (the real watch-settings labels); the route is read only from this screen.
const WATCH_VALUES: Record<string, SettingValue> = { enabled: true, every_minutes: 10, to: "orchestrator", label: "디스크 점검" };
const WATCH_FIELDS_VIEW = WATCH_FIELDS.map(f => viewOf(f, WATCH_VALUES[f.key]!));

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
		if (p === "/api/state") return json({ name: "dotz", orchestrator: { status: "idle" }, lanes: [], terminals: {}, channels: { work: [] }, discord: {}, notices_unread: 0 });
		if (p === "/api/history") return json({ target: url.searchParams.get("target"), events: [] });
		if (p === "/api/activity") return json({ items: [], more: false, history: false });
		if (p === "/api/conversations") return json({ items: [] });
		if (p === "/api/notices") return json({ unread: 0, items: [] });
		if (p === "/api/monitors") return json({ items: monitors });
		if (p === "/api/kakao/rooms") return json({ on: true, rooms: [] });
		if (p === "/api/integrations") {
			return json({ items: APPS.map(a => ({ ...a, kind: "app", conv: [], notices: [], needs: { drafts: 0, unread: 0, sentToday: 0 }, own: OWN[a.key] ?? [], ...(a.key === "site" ? { state: "disconnected", since: "2026-10-20T03:00:00.000Z" } : { state: "connected" }) })), available: [] });
		}
		const ws = /^\/api\/watches\/([a-z0-9-]+)\/settings$/.exec(p);
		if (ws) return json({ key: `w:${ws[1]}`, fields: WATCH_FIELDS_VIEW });
		const f = /^\/api\/integrations\/([a-z0-9-]+)\/features$/.exec(p);
		if (f) {
			try { return json(featuresOf(data, f[1]!, WATCHES, [])); } catch (e) { return json({ error: (e as Error).message }, 404); }
		}
		const m = /^\/api\/integrations\/([a-z0-9-]+)\/settings$/.exec(p);
		if (m) {
			try {
				if (req.method === "PATCH") {
					const b = (await req.json()) as { values: unknown };
					return json({ key: m[1], fields: writeSettings(data, m[1]!, b.values) });
				}
				return json({ key: m[1], fields: readSettings(data, m[1]!) });
			} catch (e) { return json({ error: (e as Error).message }, 400); }
		}
		return p.startsWith("/api/") ? json({}) : new Response("not found", { status: 404 });
	},
});

type View = InstanceType<typeof Bun.WebView>;
const views: View[] = [];
const open = (width: number, height: number): View => { const v = new Bun.WebView({ width, height }); views.push(v); return v; };
afterAll(() => { for (const v of views) v.close(); for (const c of streams) { try { c.close(); } catch { /* already closed */ } } server.stop(true); rmSync(data, { recursive: true, force: true }); });

const waitFor = (v: View, expr: string, ms = 4000) =>
	v.evaluate(`new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("timeout: " + ${JSON.stringify(expr)})), ${ms}); const tick = () => { let ok = false; try { ok = !!(${expr}); } catch {} if (ok) { clearTimeout(t); res(true); } else requestAnimationFrame(tick); }; tick(); })`);
const q = async <T = unknown>(v: View, code: string): Promise<T> => JSON.parse((await v.evaluate(`JSON.stringify((() => { ${code} })())`)) as string) as T;
const run = (v: View, code: string) => v.evaluate(`(() => { ${code} })(), 0`);
const shot = async (v: View, name: string) => { if (!SHOTS) return; await waitFor(v, `document.getAnimations().every(a => a.playState !== "running")`); await Bun.write(join(SHOTS, name), await v.screenshot()); };
const boot = async (v: View, route: string) => {
	const opened = new Promise<void>(r => streamWaiters.push(r));
	await v.navigate(`http://127.0.0.1:${server.port}/`);
	await opened;
	await waitFor(v, `typeof NT !== "undefined" && NT.loaded && S`);
	await run(v, `if (dotzTheme.get() === "dark") dotzTheme.toggle()`);
	await run(v, `go("monitoring", ${JSON.stringify(route)})`);
};
const openScreen = async (v: View, app: string) => {
	const more = `[...document.querySelectorAll('[data-as-more="${app}"]')].find(b => b.offsetParent && !b.hidden)`;
	await waitFor(v, more);
	await run(v, `${more}.click()`);
	await waitFor(v, `document.querySelector("#app-sw [data-setting]")`);
};
const closeScreen = async (v: View) => { await run(v, `const b = document.querySelector('[data-k="as-back"]'); if (b) b.click()`); await waitFor(v, `!document.querySelector("#app-sw")`); };

// What the screen shows, as machine values: the connection state, the section keys in drawing order, one row per setting key and per non-setting feature.
type Inv = { conn: string; secs: string[]; settings: string[]; features: string[]; keys: string[]; labels: string[]; text: string; stats: string[]; internals: string[] };
const inventory = (v: View) => q<Inv>(v, `
	const box = document.querySelector("#app-sw");
	return {
		conn: box.firstElementChild.dataset.conn,
		secs: [...box.querySelectorAll("[data-sec]")].map(e => e.dataset.sec),
		settings: [...box.querySelectorAll("[data-setting]")].map(e => e.dataset.setting),
		features: [...box.querySelectorAll("[data-feature]")].map(e => e.dataset.feature),
		keys: [...box.querySelectorAll("[data-k]")].map(e => e.dataset.k),
		labels: [...box.querySelectorAll("[data-setting] .as-n")].map(e => e.textContent),
		text: box.textContent,
		stats: [...box.querySelectorAll(".as-stat[data-watch]")].map(e => e.dataset.watch),
		internals: [...box.querySelectorAll("[data-internal]")].map(e => e.dataset.internal)
	};`);
const SECTION_ORDER = ["notify", "draft", "watch", "more", "advanced"];
const EXPECTED_SECS: Record<string, string[]> = {
	mail: ["notify", "draft", "watch", "advanced"],
	kakao: ["notify", "draft", "watch", "advanced"],
	instagram: ["notify", "draft", "watch", "more", "advanced"],
	youtube: ["notify", "draft", "watch", "advanced"],
	site: ["notify", "draft", "advanced"],
	"w:disk-check": ["notify", "watch", "advanced"],
};
const RAW = /[a-z]+-[0-9]|_|\b(?:sns|ig|yt|webmail|each|batch|comments|login|disk-check)\b/;

const suite = (label: string, width: number, height: number, tag: string) => describe(`every app's settings screen at ${label}`, () => {
	const v = open(width, height);
	const seen: Record<string, Inv> = {};
	const appInventory = async (app: string) => {
		if (app.startsWith("w:")) {
			const w = app.slice(2);
			await boot(v, "monitoring");
			await waitFor(v, `monItems().some(i => i.mon && i.mon.watch === ${JSON.stringify(w)})`);
			await run(v, `go("monitoring", monItems().find(i => i.mon && i.mon.watch === ${JSON.stringify(w)}).key)`);
		} else await boot(v, `i:${app}`);
		await openScreen(v, app);
		if (!app.startsWith("w:")) await waitFor(v, `!!AS.feat[${JSON.stringify(app)}]`);
		const inv = await inventory(v);
		seen[app] = inv;
		await shot(v, `${tag}-${app.replace(/[^a-z0-9]/gi, "-")}-settings.png`);
		await closeScreen(v);
		return inv;
	};

	test("mail: 연결됨 first, then 알림 (새 메일), 자동 초안과 승인, 감시, 고급; no second 자동 초안 switch", async () => {
		const inv = await appInventory("mail");
		expect(inv.secs).toEqual(EXPECTED_SECS.mail!);
		expect(inv.settings).toEqual(["notify", "push", "auto_draft", "to_only", "unanswered_days", "skip_senders", "only_senders", "draft_rules", "draft_default", "use_here", "label", "delete_original", "reply_model", "conv_model", "memory"]);
		expect(inv.features).toEqual(["new_mail"]);
		expect(inv.labels.slice(0, 3)).toEqual(["새 소식 알림", "휴대폰 알림", "자동 초안"]);
		expect(inv.stats).toEqual(["webmail-inbox"]);
		expect(inv.internals).toEqual(["webmail-inbox"]);
	});

	test("kakao: the 감시 switch, the rooms and the owned sync are the 감시 section; drafts and their rooms are 자동 초안과 승인", async () => {
		const inv = await appInventory("kakao");
		expect(inv.secs).toEqual(EXPECTED_SECS.kakao!);
		// 방 감시 was the same control as 카카오톡 감시: only the setting row remains.
		expect(inv.features).toEqual(["reply_draft"]);
		expect(inv.settings).toEqual(["notify", "push", "auto_draft_chats", "exclude_chats", "enabled", "open_chats", "watch_chats", "use_here", "label", "reply_model", "memory"]);
		expect(inv.labels).toContain("감시할 방");
		expect(inv.labels).toContain("초안을 만들 방");
	});

	test("instagram: 자동 초안 is one row, the reels approval sits with it, DM 읽기 is 기타 기능, the watches are 감시", async () => {
		const inv = await appInventory("instagram");
		expect(inv.secs).toEqual(EXPECTED_SECS.instagram!);
		expect(inv.features).toEqual(["reels_approval", "dm_read"]);
		expect(inv.settings.filter(k => k === "auto_draft").length).toBe(1);
		expect(inv.stats).toEqual(["sns-ig-comments", "ig-site-login"]);
		expect(inv.internals).toEqual(["sns-ig-comments", "ig-site-login"]);
	});

	test("youtube: one 자동 초안 row and the metadata/upload approvals with it", async () => {
		const inv = await appInventory("youtube");
		expect(inv.secs).toEqual(EXPECTED_SECS.youtube!);
		expect(inv.features).toEqual(["metadata", "upload_approval"]);
		expect(inv.settings.filter(k => k === "auto_draft").length).toBe(1);
	});

	test("site: its only switch is 자동 초안, under 자동 초안과 승인", async () => {
		const inv = await appInventory("site");
		expect(inv.secs).toEqual(EXPECTED_SECS.site!);
		expect(inv.features).toEqual(["comment_reply"]);
		expect(inv.text).toContain("자동 초안");
		// A disconnected app says so at the top, with since when; the same screen never fakes 정상.
		expect(inv.conn).toBe("disconnected");
		expect(inv.text).toContain("연결 끊김");
		expect(inv.text).toContain("부터 연결이 끊겼어요");
	});

	test("a plain monitor: 연결 first, then 알림 방식, 감시 켜기/감시 주기, 이름", async () => {
		const inv = await appInventory("w:disk-check");
		expect(inv.secs).toEqual(EXPECTED_SECS["w:disk-check"]!);
		expect(inv.settings).toEqual(["to", "enabled", "every_minutes", "label"]);
		expect(inv.labels).toEqual(["알림 방식", "감시 켜기", "감시 주기", "이름"]);
		expect(inv.features).toEqual([]);
		expect(inv.stats).toEqual(["disk-check"]);
		expect(inv.internals).toEqual([]);
	});

	test("no control key is drawn twice for any app, no setting-bound feature is drawn again, and the sections keep one order", async () => {
		for (const app of Object.keys(seen)) {
			const inv = seen[app]!;
			expect(new Set(inv.keys).size).toBe(inv.keys.length);
			expect(new Set(inv.settings).size).toBe(inv.settings.length);
			expect(inv.secs).toEqual(EXPECTED_SECS[app]!);
			expect(inv.secs.every((s, i) => i === 0 || SECTION_ORDER.indexOf(s) > SECTION_ORDER.indexOf(inv.secs[i - 1]!))).toBe(true);
			// One row per watch: the same element is both the status row and the app's internal row, never two rows for one watch.
			expect(new Set(inv.stats).size).toBe(inv.stats.length);
			expect(inv.internals.every(id => inv.stats.includes(id))).toBe(true);
			expect(inv.stats.length).toBeGreaterThanOrEqual(inv.internals.length);
			expect(inv.text).not.toMatch(RAW);
			if (!app.startsWith("w:")) {
				const bound = featuresOf(data, app, WATCHES, []).features.filter(f => f.setting).map(f => f.id);
				for (const id of bound) expect(inv.features).not.toContain(id);
			}
		}
	});
});

suite("390px", 390, 844, "apps-phone");
suite("1280px", 1280, 800, "apps-desktop");
