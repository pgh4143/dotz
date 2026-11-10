import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { appAsset, indexPage } from "./webapp.ts";

// 설정 → 계정 in a headless Bun.WebView against a stub gateway whose account pools hold two subscription providers plus two
// more: the one screen holds each provider's accounts, states and usage windows, 추가 opens a provider picker, and a pick
// starts that provider's own login (never only Claude's). Screenshots are written only when ACCOUNTS_SHOTS names a folder.
const SHOTS = process.env.ACCOUNTS_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const claudeAccounts = [
	{ name: "default", order: 1, alias: null, label: "개인 계정", current: true, blocked: null, blocked_until: null, blocked_tag: null, five_hour_left: 62, seven_day_left: 80 },
	{ name: "work", order: 2, alias: null, label: "회사 계정", current: false, blocked: null, blocked_until: null, blocked_tag: null, five_hour_left: null, seven_day_left: null },
	{ name: "spare", order: 3, alias: null, label: "예비 계정", current: false, blocked: null, blocked_until: null, blocked_tag: null, five_hour_left: null, seven_day_left: null },
];
const providers = () => [
	{
		id: "anthropic", name: "Claude 구독", auth: "oauth", multi: true, can_add: true, can_pin: true, can_delete: true,
		accounts: claudeAccounts.map(a => ({ ...a, pinned: a.name === "default", windows: [...(a.five_hour_left !== null ? [{ id: "5h", label: "5시간", left: 62, resets_at: null }] : []), ...(a.seven_day_left !== null ? [{ id: "7d", label: "7일", left: 80, resets_at: null }] : []), ...(a.name === "work" ? [{ id: "claude:5h", label: "5시간", left: 99, resets_at: Date.parse("2026-10-21T14:00:00+09:00") }] : [])] })),
	},
	{
		id: "chatgpt-subscription", name: "ChatGPT 구독", auth: "oauth", multi: true, can_add: true, can_pin: true, can_delete: true,
		accounts: [
			{ name: "default", label: "default", order: 1, current: false, pinned: false, blocked: "rate_limit", blocked_until: null, blocked_tag: "한도 걸림 · 내일 01:20까지", windows: [{ id: "5h", label: "5시간", left: 0, resets_at: null }] },
			{ name: "login-2", label: "회사용 GPT", order: 2, current: true, pinned: true, blocked: null, blocked_until: null, blocked_tag: null, windows: [{ id: "5h", label: "5시간", left: 62, resets_at: null }, { id: "7d", label: "7일", left: 74, resets_at: null }] },
		],
	},
	{
		id: "google", name: "Gemini", auth: "api_key", multi: false, can_add: false, can_pin: false, can_delete: false,
		accounts: [{ name: "default", label: "API 키", order: 1, current: true, pinned: false, blocked: null, blocked_until: null, blocked_tag: null, windows: [] }],
	},
	{
		id: "cursor", name: "Cursor", auth: "oauth", multi: true, can_add: true, can_pin: false, can_delete: false,
		accounts: [],
	},
];
const providerList = [
	{ id: "anthropic", name: "Claude 구독", auth: "oauth", can_login: true, can_add_account: true, in_use: true, accounts: 2 },
	{ id: "chatgpt-subscription", name: "ChatGPT 구독", auth: "oauth", can_login: true, accounts: 2 },
	{ id: "google", name: "Gemini", auth: "api_key", masked: "AIza…x9", can_logout: true },
	{ id: "cursor", name: "Cursor", auth: "none", can_login: true },
];
const loginProviders = () => [
	{ id: "anthropic", name: "Claude 구독", configured: true },
	{ id: "chatgpt-subscription", name: "ChatGPT 구독", configured: true },
	{ id: "cursor", name: "Cursor", configured: false },
];
const body = () => ({
	mode: "auto",
	chosen: { name: "default", label: "개인 계정", source: "auto", blocked: null, text: "" },
	accounts: claudeAccounts,
	rules: {},
	rules_text: [],
	script: { path: null, timeout_ms: 5000, every_minutes: 5, last: null },
	providers: providers(),
	login_providers: loginProviders(),
});

const calls: Array<[string, unknown]> = [];
let cancelSeen: (() => void) | undefined;
const te = new TextEncoder();
const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
let streamWaiters: (() => void)[] = [];
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
			const stream = new ReadableStream<Uint8Array>({
				start(c) { ctl = c; streams.add(c); c.enqueue(te.encode(": open\n\n")); const w = streamWaiters; streamWaiters = []; for (const f of w) f(); },
				cancel() { streams.delete(ctl); },
			});
			return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
		}
		if (p === "/api/state") return json({ name: "dotz", orchestrator: { status: "idle" }, lanes: [], terminals: {}, channels: { work: [] }, discord: {}, notices_unread: 0 });
		if (p === "/api/history") return json({ target: url.searchParams.get("target"), events: [] });
		if (p === "/api/activity") return json({ items: [], more: false, history: false });
		if (p === "/api/conversations") return json({ items: [] });
		if (p === "/api/notices") return json({ unread: 0, items: [] });
		if (p === "/api/monitors" || p === "/api/integrations") return json({ items: [] });
		if (p === "/api/kakao/rooms") return json({ on: true, rooms: [] });
		if (p === "/api/update" || p === "/api/runtimes") return json({ error: "stub" }, 500);
		if (p === "/api/accounts") return json(body());
		if (p === "/api/providers") return json({ providers: providerList });
		if (p === "/api/accounts/pin" && req.method === "PUT") {
			const b = (await req.json()) as unknown;
			calls.push(["pin", b]);
			return json(body());
		}
		if (p.startsWith("/api/providers/") && p.endsWith("/login") && req.method === "POST") {
			const provider = p.split("/")[3]!;
			calls.push(["login", provider]);
			return json({ login_id: "L1", url: "https://example.test/authorize", needs_code: true, prompt: "코드를 붙여 넣어 주세요" });
		}
		if (p.startsWith("/api/providers/") && p.endsWith("/login") && req.method === "DELETE") {
			calls.push(["cancel", p.split("/")[3]]);
			cancelSeen?.();
			return json({ ok: true });
		}
		return p.startsWith("/api/") ? json({}) : new Response("not found", { status: 404 });
	},
});

type View = InstanceType<typeof Bun.WebView>;
const views: View[] = [];
const errors: string[] = [];
const open = (width: number, height: number): View => { const v = new Bun.WebView({ width, height, console: (type: string, ...args: unknown[]) => { if (type === "error") errors.push(args.map(String).join(" ")); } } as ConstructorParameters<typeof Bun.WebView>[0]); views.push(v); return v; };
afterAll(() => { for (const v of views) v.close(); for (const c of streams) { try { c.close(); } catch { /* already closed */ } } server.stop(true); });

const waitFor = (v: View, expr: string, ms = 4000) =>
	v.evaluate(`new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("timeout: " + ${JSON.stringify(expr)})), ${ms}); const tick = () => { let ok = false; try { ok = !!(${expr}); } catch {} if (ok) { clearTimeout(t); res(true); } else requestAnimationFrame(tick); }; tick(); })`);
const q = async <T = unknown>(v: View, code: string): Promise<T> => JSON.parse((await v.evaluate(`JSON.stringify((() => { ${code} })())`)) as string) as T;
const run = (v: View, code: string) => v.evaluate(`(() => { ${code} })(), 0`);
const shot = async (v: View, name: string) => {
	if (!SHOTS) return;
	await waitFor(v, `document.getAnimations().every(a => a.playState !== "running")`);
	await Bun.write(join(SHOTS, name), await v.screenshot());
};
const boot = async (v: View, id = "anthropic") => {
	errors.length = 0;
	const opened = new Promise<void>(r => streamWaiters.push(r));
	await v.navigate(`http://127.0.0.1:${server.port}/`);
	await opened;
	await waitFor(v, `typeof NT !== "undefined" && NT.loaded && NM.loaded && S`);
	await run(v, `if (dotzTheme.get() === "dark") dotzTheme.toggle()`);
	await run(v, `go("accounts", ${JSON.stringify(id)})`);
	try {
		await waitFor(v, `current === "accounts" && ACC && P && document.querySelectorAll("#accounts .li").length > 1`);
	} catch (e) {
		const dbg = await v.evaluate(`(() => { try { return JSON.stringify({ acc: typeof ACC !== "undefined" && !!ACC, prov: typeof ACC !== "undefined" && ACC && ACC.providers && ACC.providers.length, cur: typeof current !== "undefined" ? current : null, secs: typeof accountSection === "function" ? accountSection().length : -1, views: document.querySelectorAll("#views > *").length }); } catch (err) { return "ERR " + err.message; } })()`);
		throw new Error(`${(e as Error).message}\nDBG ${dbg}\n${errors.join("\n")}`);
	}
	expect(errors).toEqual([]);
};
const sectionText = (v: View) => q<string[]>(v, `return [...document.querySelectorAll(".sec")].map(s => s.textContent)`);
const groupList = (name: string) => `[...document.querySelectorAll("#accounts .sec")].find(s => s.textContent.startsWith(${JSON.stringify(name)}))?.nextElementSibling`;
const addButton = `document.querySelector("#accounts .sec-act [data-acc-add]")`;

for (const [label, w, h] of [["phone", 390, 844], ["desktop", 1280, 900]] as const) {
	test(`${label} ${w}px: one screen holds every provider with its login or key and its own accounts, with states and usage windows, and no sideways scroll`, async () => {
		calls.length = 0;
		const v = open(w, h);
		await boot(v);
		// each login provider is a section with its 계정 추가; the rest share one list
		expect(await sectionText(v)).toEqual(["Claude 구독계정 추가", "ChatGPT 구독계정 추가", "Cursor계정 추가", "다른 공급자"]);
		expect(await q(v, `return document.querySelectorAll("#accounts .li.acc:not(.gen)").length`)).toBe(3);
		expect(await q(v, `return document.querySelectorAll("#accounts .li.acc.gen").length`)).toBe(2);
		await shot(v, `accounts-providers-${w}.png`);
		const gpt = await q<{ text: string; numbers: string[] }>(v, `const r = ${groupList("ChatGPT 구독")}; return { text: r.textContent, numbers: [...r.querySelectorAll(".acc-no")].map(n => n.textContent) }`);
		expect(gpt.numbers).toEqual(["1", "2"]);
		for (const part of ["한도 걸림 · 내일 01:20까지", "5시간 62% 남음", "7일 74% 남음", "회사용 GPT", "사용 중", "고정"]) expect(gpt.text).toContain(part);
		// an account not in use still shows its own windows, with when each resets
		const claude = await q<string>(v, `return ${groupList("Claude 구독")}.textContent`);
		for (const part of ["5시간 62% 남음", "5시간 99% 남음 (", "초기화)", "spare · 사용량 아직 확인 안 됨"]) expect(claude).toContain(part);
		expect(await q(v, `return ${groupList("다른 공급자")}.textContent.includes("Gemini")`)).toBe(true);
		expect(await q(v, `return ${groupList("Cursor")}.textContent.includes("Cursor 계정이 없어요")`)).toBe(true);
		const o = await q<{ doc: number; vw: number; wide: string[] }>(v, `const rows = [...document.querySelectorAll(".li.acc.gen")]; return { doc: document.documentElement.scrollWidth, vw: innerWidth, wide: rows.filter(r => r.scrollWidth > r.clientWidth + 1 || r.getBoundingClientRect().right > innerWidth).map(r => r.textContent) }`);
		expect(o.wide).toEqual([]);
		expect(o.doc).toBeLessThanOrEqual(o.vw);
	});

	test(`${label} ${w}px: 계정 추가 in the Claude section starts that provider's own login`, async () => {
		calls.length = 0;
		const v = open(w, h);
		await boot(v);
		await run(v, `(${addButton}).click()`);
		await waitFor(v, `document.querySelector('dialog[open] .dtitle')?.textContent.endsWith("계정 추가")`);
		expect(await q(v, `return document.querySelector('dialog[open] .dtitle').textContent`)).toBe("Claude 구독 계정 추가");
		expect(calls).toEqual([["login", "anthropic"]]);
		await shot(v, `accounts-login-claude-${w}.png`);
		const cancelled = new Promise<void>(ok => { cancelSeen = ok; });
		await run(v, `[...document.querySelectorAll('dialog[open] button')].find(b => b.textContent.trim() === "취소").click()`);
		await waitFor(v, `!document.querySelector("dialog[open]")`);
		// 취소 cancels the login; its call can land after the dialog's close fade, so wait for it here, not in the next test
		if (!calls.some(c => c[0] === "cancel")) await cancelled;
		expect(calls).toContainEqual(["cancel", "anthropic"]);
	});

	test(`${label} ${w}px: tapping another provider's account offers its pin, which is saved per provider`, async () => {
		calls.length = 0;
		const v = open(w, h);
		await boot(v, "chatgpt-subscription");
		const row = `[...${groupList("ChatGPT 구독")}.querySelectorAll(".li.acc.gen")].find(r => r.textContent.includes("default"))`;
		await run(v, `(${row}).querySelector(".acc-main").click()`);
		await waitFor(v, `document.querySelector('dialog[open] .dtitle')?.textContent.includes("ChatGPT 구독")`);
		expect(await q(v, `return document.querySelector('dialog[open] .dtitle').textContent`)).toBe("ChatGPT 구독 · default");
		await run(v, `[...document.querySelectorAll('dialog[open] button')].find(b => b.textContent.trim() === "이 계정으로 고정").click()`);
		await waitFor(v, `!document.querySelector("dialog[open]")`);
		expect(calls).toEqual([["pin", { provider: "chatgpt-subscription", account: "default" }]]);
	});
}
