import { afterAll, afterEach, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { appAsset, indexPage } from "./webapp.ts";

// 공급자 and 설정 → 계정 in a headless Bun.WebView against a stub gateway on an OmO install: the signed-in Claude row offers 계정 추가,
// 추가 lists login providers again, and a login (URL, the sign-in's own prompt, pasted code) ends with one more account on the row and in
// 설정 → 계정. Screenshots are written only when PROVIDERS_SHOTS names a folder.
const SHOTS = process.env.PROVIDERS_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let accounts = ["default", "work"];
const calls: string[] = [];
let onAccounts: (() => void) | undefined;
const PROMPT = "Complete login in your browser, or paste the authorization code / redirect URL here:";
// OmO's Claude sign-in asks questions first and names the page in a later step (stepped = true)
let stepped = false, step = 0, sameAccount = false;
// a login still open elsewhere (a closed tab, /login in the chat): a plain start answers 409 with it, `pending` picks resume or restart
let openLogin = false;
const METHODS = ["Browser login (default)", "Copy code login (headless)"];
const NAME_Q = "Name for this account (existing: default, work; press Enter to add account-3, or type an existing name to refresh it)";
const MANUAL = "https://claude.ai/oauth/authorize?redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&state=stub";
const providers = () => ({
	providers: [
		{ id: "anthropic", name: "Anthropic Subscription (Claude Pro/Max)", auth: "oauth", account: "work", accounts: accounts.length, models: 3, in_use: true, can_login: true, can_add_account: true, can_logout: true },
		{ id: "openrouter", name: "openrouter", auth: "api_key", masked: "or-…ijkl", models: 1, in_use: false, can_login: true, can_logout: true },
	],
	addable: [{ id: "anthropic", name: "Anthropic Subscription (Claude Pro/Max)", kind: "oauth", add_account: true }, { id: "github-copilot", name: "GitHub Copilot", kind: "oauth" }, { id: "xai", name: "xAI (Grok/X subscription)", kind: "oauth" }, { id: "openai", name: "openai", kind: "api_key" }],
});
const accountsBody = () => ({
	mode: "pinned",
	chosen: { name: "work", label: "work", source: "manual", blocked: null, text: "" },
	accounts: accounts.map((name, i) => ({ name, order: i + 1, alias: null, label: name, current: name === "work", blocked: null, blocked_until: null, blocked_tag: null, five_hour_left: null, seven_day_left: null })),
	rules: {},
	rules_text: [],
	script: { path: null, timeout_ms: 5000, every_minutes: 5, last: null },
});

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
		if (p === "/api/monitors" || p === "/api/integrations") return json({ items: [] });
		if (p === "/api/kakao/rooms") return json({ on: true, rooms: [] });
		if (p === "/api/update" || p === "/api/runtimes") return json({ error: "stub" }, 500);
		if (p === "/api/providers") return json(providers());
		if (p === "/api/accounts") {
			calls.push("GET /api/accounts");
			onAccounts?.();
			return json(accountsBody());
		}
		if (p === "/api/providers/anthropic/login" && req.method === "POST") {
			const b = (await req.json().catch(() => ({}))) as { pending?: string };
			calls.push(b.pending ? `POST login ${b.pending}` : "POST login");
			if (openLogin && !b.pending) return json({ error: "이미 진행 중인 로그인이 있어요 (anthropic). 먼저 취소해 주세요", pending: { provider: "anthropic", same: true } }, 409);
			step = 0;
			if (stepped) return json({ ok: true, login_id: "L1", url: "", needs_code: true, prompt: NAME_Q, placeholder: "account-3" });
			return json({ ok: true, login_id: "L1", url: "https://claude.ai/oauth/authorize?state=stub", needs_code: true, prompt: PROMPT });
		}
		if (p === "/api/providers/anthropic/login/complete" && req.method === "POST") {
			const b = (await req.json()) as { login_id: string; code: string };
			calls.push(`complete ${b.login_id} ${b.code}`);
			if (stepped && step === 0) { step++; return json({ ok: true, provider: "anthropic", status: "waiting", url: "", needs_code: true, prompt: "Select Anthropic login method:", options: METHODS }); }
			if (stepped && step === 1) { step++; return json({ ok: true, provider: "anthropic", status: "waiting", url: MANUAL, needs_code: true, prompt: "Paste the code Anthropic shows after you sign in:" }); }
			if (sameAccount) return json({ ok: true, provider: "anthropic", status: "done", outcome: "refreshed", account: "work" });
			accounts = [...accounts, `login-${accounts.length + 1}`];
			return json({ ok: true, provider: "anthropic", status: "done" });
		}
		if (p === "/api/providers/anthropic/login" && req.method === "GET") return json({ status: "waiting" });
		if (p === "/api/providers/anthropic/login" && req.method === "DELETE") {
			calls.push("DELETE login");
			return json({ ok: true });
		}
		return p.startsWith("/api/") ? json({}) : new Response("not found", { status: 404 });
	},
});

type View = InstanceType<typeof Bun.WebView>;
const views: View[] = [];
const open = (width: number, height: number): View => { const v = new Bun.WebView({ width, height }); views.push(v); return v; };
// Every view reads the same fake hub and pushes to the shared `calls`: an earlier test's page still open (its login success reloads
// 설정 → 계정 after the test ends) would land a GET /api/accounts in the next test's list, so each test's views close when it ends.
afterEach(() => { for (const v of views.splice(0)) v.close(); });
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
// the same view in both themes; the page is back in light afterwards
const shotThemes = async (v: View, name: string) => {
	if (!SHOTS) return;
	await shot(v, `${name}-light.png`);
	await run(v, `dotzTheme.toggle()`);
	await shot(v, `${name}-dark.png`);
	await run(v, `dotzTheme.toggle()`);
};
const boot = async (v: View) => {
	const opened = new Promise<void>(r => streamWaiters.push(r));
	await v.navigate(`http://127.0.0.1:${server.port}/`);
	await opened;
	await waitFor(v, `typeof NT !== "undefined" && NT.loaded && NM.loaded && S`);
	await run(v, `if (dotzTheme.get() === "dark") dotzTheme.toggle()`);
	await run(v, `go("accounts")`);
	await waitFor(v, `document.querySelector("#accounts [data-acc-add]") && document.querySelector("#accounts .li.acc")`);
};
const anthropicRow = `document.querySelector('[data-prov-conn="anthropic"]')`;
const button = (scope: string, label: string) => `[...${scope}.querySelectorAll("button")].find(b => b.textContent.trim().endsWith(${JSON.stringify(label)}))`;
const overflow = (v: View) => q<{ vw: number; doc: number }>(v, `return { vw: innerWidth, doc: document.documentElement.scrollWidth }`);

for (const [label, w, h] of [["phone", 390, 844], ["desktop", 1280, 860]] as const) {
	test(`${label} ${w}px: the Claude screen's 추가 adds an account; 추가 lists login providers; the account list refreshes`, async () => {
		accounts = ["default", "work"];
		calls.length = 0;
		const v = open(w, h);
		await boot(v);
		expect(await q(v, `const r = ${anthropicRow}; return [r.querySelectorAll(".li.acc").length, !!${button("r", "계정 추가")}, !!${button("r", "다시 로그인")}]`)).toEqual([2, true, false]);
		const o = await overflow(v);
		expect(o.doc).toBeLessThanOrEqual(o.vw);
		await shot(v, `providers-${w}.png`);

		await run(v, `${button("document.querySelector('#accounts .tools-bar')", "추가")}.click()`);
		await waitFor(v, `document.querySelector(".pickbox")`);
		expect(await q(v, `const secs = [...document.querySelectorAll(".pickbox .sec")].map(s => s.textContent); const login = document.querySelector(".pickbox .list").textContent; return [secs, login.includes("GitHub Copilot"), login.includes("xAI")]`)).toEqual([["로그인", "API 키"], true, true]);
		await shot(v, `providers-add-${w}.png`);
		// a list to pick from has no button row: the ✕ is its one way out
		expect(await q(v, `return document.querySelectorAll("dialog[open] .dact button").length`)).toBe(0);
		await run(v, `document.querySelector('dialog[open] [aria-label="닫기"]').click()`);
		await waitFor(v, `!document.querySelector("dialog[open]")`);

		await run(v, `document.querySelector("#accounts [data-acc-add]").click()`);
		await waitFor(v, `[...document.querySelectorAll(".sup")].some(s => s.textContent.includes("authorization code"))`);
		expect(await q(v, `const t = document.querySelector("dialog[open] .dtitle")?.textContent ?? ""; return t.endsWith("계정 추가")`)).toBe(true);
		expect(await q(v, `return [...document.querySelectorAll("a.btn")].find(a => a.textContent.includes("로그인 페이지 열기"))?.getAttribute("href")`)).toBe("https://claude.ai/oauth/authorize?state=stub");
		expect(await q(v, `return [...document.querySelectorAll("a.btn")].find(a => a.textContent.includes("로그인 페이지 열기")).classList.contains("tonal")`)).toBe(false);
		await shot(v, `providers-login-${w}.png`);
		const refetched = new Promise<void>((res, rej) => { const t = setTimeout(() => rej(new Error("설정 → 계정 was not read again")), 4000); onAccounts = () => { clearTimeout(t); res(); }; });
		await run(v, `const i = [...document.querySelectorAll("input")].find(x => x.type === "text" && x.offsetParent); i.value = "code-abc"; ${button("document.querySelector('dialog[open]')", "완료")}.click()`);
		await waitFor(v, `document.querySelectorAll("#accounts .li.acc").length === 3`);
		await refetched;
		onAccounts = undefined;
		// The page may read 설정 → 계정 once or twice while it opens, so only the login and what follows it are pinned.
		expect(calls.filter(c => c !== "GET /api/accounts")).toEqual(["POST login", "complete L1 code-abc"]);
		expect(calls.slice(calls.indexOf("complete L1 code-abc") + 1)).toEqual(["GET /api/accounts"]);
		expect(await q(v, `const r = ${anthropicRow}; return [r.querySelectorAll(".li.acc").length, !!${button("r", "계정 추가")}]`)).toEqual([3, true]);
		const s = await overflow(v);
		expect(s.doc).toBeLessThanOrEqual(s.vw);
		await shot(v, `provider-accounts-${w}.png`);
	}, 20_000);

	test(`${label} ${w}px: a Claude sign-in that asks its questions first shows each step: the name as the field, the method as rows, then the page and code`, async () => {
		accounts = ["default", "work"];
		stepped = true;
		calls.length = 0;
		try {
			const v = open(w, h);
			await boot(v);
			const link = `[...document.querySelectorAll("dialog[open] a.btn")].find(a => a.textContent.includes("로그인 페이지 열기"))`;
			const state = `const a = ${link}; return a ? [a.getAttribute("href"), a.offsetParent !== null] : null`;
			// what the open dialog shows: the visible field's label and value, the visible choice rows, and its buttons
			const seen = `const d = document.querySelector("dialog[open]"); const f = [...d.querySelectorAll(".tf")].find(x => x.offsetParent);
				return { label: f ? f.querySelector("label").textContent : null, value: f ? f.querySelector("input").value : null,
					rows: [...d.querySelectorAll(".list .li")].filter(x => x.offsetParent).map(x => x.textContent.trim()), acts: [...d.querySelectorAll(".dact button")].map(b => b.textContent.trim()) }`;
			await run(v, `document.querySelector("#accounts [data-acc-add]").click()`);
			await waitFor(v, `document.querySelector("dialog[open] .tf label")?.textContent.includes("Name for this account")`);
			expect(await q(v, seen)).toEqual({ label: NAME_Q, value: "account-3", rows: [], acts: ["취소", "완료"] });
			expect(await q(v, state)).toEqual([null, false]);
			await shotThemes(v, `login-name-${w}`);
			await run(v, `${button("document.querySelector('dialog[open]')", "완료")}.click()`);
			await waitFor(v, `[...document.querySelectorAll("dialog[open] .list .li")].some(x => x.offsetParent)`);
			expect(await q(v, seen)).toEqual({ label: null, value: null, rows: METHODS, acts: ["취소"] });
			expect(await q(v, `return document.querySelector("dialog[open]").textContent.includes("Select Anthropic login method:")`)).toBe(true);
			expect(await q(v, state)).toEqual([null, false]);
			await shotThemes(v, `login-method-${w}`);
			await run(v, `[...document.querySelectorAll("dialog[open] .list .li")].find(x => x.textContent.includes("Copy code")).click()`);
			await waitFor(v, `[...document.querySelectorAll("dialog[open] .sup")].some(s => s.textContent.includes("Paste the code"))`);
			expect(await q(v, state)).toEqual([MANUAL, true]);
			expect(await q(v, seen)).toEqual({ label: "코드 또는 주소", value: "", rows: [], acts: ["취소", "완료"] });
			expect(calls.filter(c => c.startsWith("complete"))).toEqual(["complete L1 account-3", "complete L1 Copy code login (headless)"]);
			const o = await overflow(v);
			expect(o.doc).toBeLessThanOrEqual(o.vw);
			await shot(v, `providers-login-stepped-${w}.png`);
			await run(v, `const i = [...document.querySelectorAll("input")].find(x => x.type === "text" && x.offsetParent); i.value = "code-xyz"; ${button("document.querySelector('dialog[open]')", "완료")}.click()`);
			await waitFor(v, `document.querySelectorAll("#accounts .li.acc").length === 3`);
		} finally {
			stepped = false;
		}
	}, 20_000);

	test(`${label} ${w}px: a login still open offers to pick it up or start over instead of only a toast`, async () => {
		accounts = ["default", "work"];
		openLogin = true;
		stepped = true;
		try {
			for (const [choice, sent] of [["이어서 하기", "resume"], ["새로 시작", "restart"]] as const) {
				calls.length = 0;
				const v = open(w, h);
				await boot(v);
				await run(v, `document.querySelector("#accounts [data-acc-add]").click()`);
				await waitFor(v, `document.querySelector("dialog[open] .dtitle")?.textContent === "끝나지 않은 로그인이 있어요"`);
				expect(await q(v, `return [...document.querySelectorAll("dialog[open] .dact button")].map(b => b.textContent.trim())`)).toEqual(["닫기", "새로 시작", "이어서 하기"]);
				if (choice === "이어서 하기") await shot(v, `login-open-${w}.png`);
				await run(v, `${button("document.querySelector('dialog[open]')", choice)}.click()`);
				await waitFor(v, `document.querySelector("dialog[open] .tf label")?.textContent.includes("Name for this account")`);
				expect(calls.filter(c => c.startsWith("POST login"))).toEqual(["POST login", `POST login ${sent}`]);
				await run(v, `document.querySelector("dialog[open]").close()`);
			}
		} finally {
			openLogin = false;
			stepped = false;
		}
	}, 20_000);

	test(`${label} ${w}px: 공급자 추가 lists the connected Claude, and a login of a stored account says so`, async () => {
		accounts = ["default", "work"];
		sameAccount = true;
		calls.length = 0;
		try {
			const v = open(w, h);
			await boot(v);
			await run(v, `${button("document.querySelector('#accounts .tools-bar')", "추가")}.click()`);
			await waitFor(v, `document.querySelector(".pickbox")`);
			const claude = `[...document.querySelectorAll(".pickbox button")].find(b => b.textContent.includes("Claude Pro/Max"))`;
			expect(await q(v, `return ${claude}.textContent.includes("계정 추가")`)).toBe(true);
			await run(v, `${claude}.click()`);
			await waitFor(v, `document.querySelector("dialog[open] .dtitle")?.textContent.endsWith("계정 추가")`);
			await run(v, `const i = [...document.querySelectorAll("input")].find(x => x.type === "text" && x.offsetParent); i.value = "code-same"; ${button("document.querySelector('dialog[open]')", "완료")}.click()`);
			await waitFor(v, `document.querySelector(".snack")?.textContent.includes("이미 등록된 계정이에요 (work)")`);
			expect(await q(v, `return document.querySelectorAll("#accounts .li.acc").length`)).toBe(2);
			expect(calls).toContain("POST login");
		} finally {
			sameAccount = false;
		}
	}, 20_000);
}
