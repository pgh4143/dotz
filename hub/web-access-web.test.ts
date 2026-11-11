import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { ev, fakeHub, json, run, waitFor, type View } from "./test-web.ts";

// 설정 → 웹 접속: Tailscale stays the default PUT, Cloudflare and 이 컴퓨터만 start POST /api/web-access/onboard, and the
// manual hostname/team/aud/token + tunnel status live only in the closed "직접 입력" disclosure.
const SHOTS = process.env.MESSENGER_SHOTS ?? "/tmp/dotz-messenger-shots";
mkdirSync(SHOTS, { recursive: true });
mkdirSync("/tmp/messenger-onboarding", { recursive: true });

const TOKEN = "eyJ-secret-tunnel-token-value";
let wa: Record<string, any>;
let found = true;
let puts: any[] = [];
let onboards: any[] = [];
let onb: any;
const idle = { key: "web-access", state: "idle", step: null, owner: null, error: null, url: null, updated_at: new Date(0).toISOString() };
const done = (url: string | null) => ({ key: "web-access", state: "done", step: { id: "done", title: "완료", detail: "연결했어요" }, owner: null, error: null, url, updated_at: new Date(0).toISOString() });
const view = () => ({ ...wa, cloudflared_found: found });
function reset() {
	wa = { mode: "tailscale", hostname: "", team: "", aud: "", token_set: false, tunnel: { state: "off" }, devices: 0 };
	found = true;
	puts = [];
	onboards = [];
	onb = idle;
}
reset();

const hub = fakeHub({
	api: async (req, url) => {
		const p = url.pathname;
		if (p === "/api/web-access" && req.method === "GET") return json(view());
		if (p === "/api/web-access" && req.method === "PUT") {
			const b = (await req.json()) as any;
			puts.push(b);
			const { token, ...rest } = b;
			wa = { ...wa, ...rest };
			if (token !== undefined) wa.token_set = token !== "";
			wa.tunnel = wa.mode === "cloudflare" ? (found ? { state: "running" } : { state: "error", error: "cloudflared를 찾을 수 없습니다" }) : { state: "off" };
			return json(view());
		}
		if (p === "/api/web-access/onboard" && req.method === "POST") {
			const b = (await req.json()) as any;
			onboards.push(b);
			if (b.mode === "local") {
				wa = { ...wa, mode: "local" };
				onb = done(null);
			} else {
				const hostname = b.hostname || "dotz.example.com";
				wa = { ...wa, mode: "cloudflare", hostname, tunnel: found ? { state: "running" } : { state: "error", error: "cloudflared를 찾을 수 없습니다" } };
				onb = done(`https://${hostname}`);
			}
			return json(onb);
		}
		if (p === "/api/onboarding/web-access") return json(onb);
		if (p === "/api/messengers") return json({ items: [
			{ id: "discord", label: "Discord", enabled: false, state: "off", configured: false },
			{ id: "jandi", label: "JANDI", enabled: false, state: "off", configured: false },
			{ id: "slack", label: "Slack", enabled: false, state: "off", configured: false },
			{ id: "telegram", label: "Telegram", enabled: false, state: "off", configured: false },
		] });
		if (p === "/api/devices") return json([]);
		if (p === "/api/accounts") return json({ error: "no accounts here" }, 404);
		if (p === "/api/update") {
			const at = { sha: "a".repeat(40), short: "a".repeat(7), date: new Date(0).toISOString() };
			return json({ running: { kind: "git", branch: "main", commit: at }, disk: { kind: "git", branch: "main", commit: at }, settings: { auto_check: false, auto_apply: false, at: "09:00" }, busy: [] });
		}
	},
});
afterAll(() => hub.stop());

const open = async (width = 1280, height = 800, theme: "light" | "dark" = "light"): Promise<View> => {
	const v = await hub.view({ width, height }, "/");
	await waitFor(v, `typeof go === "function" && typeof S !== "undefined" && S`);
	await run(v, `document.documentElement.dataset.theme = ${JSON.stringify(theme)}; WA.draft = null; go("webaccess")`);
	await waitFor(v, `document.querySelector("#webaccess [role=radiogroup]") && document.querySelector("#webaccess [data-onb]")`);
	return v;
};
const click = (v: View, sel: string) => run(v, `document.querySelector(${JSON.stringify(sel)}).click()`);
const type = (v: View, sel: string, text: string) => run(v, `const i = document.querySelector(${JSON.stringify(sel)}); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event("input", { bubbles: true }))`);
const text = (v: View, sel: string) => ev<string>(v, `document.querySelector(${JSON.stringify(sel)}).textContent`);
const noOverflow = (v: View) => ev<boolean>(v, `document.documentElement.scrollWidth <= document.documentElement.clientWidth`);

describe("웹 접속 화면", () => {
	beforeEach(reset);

	test("the settings row shows Tailscale and opens the screen without any write", async () => {
		const v = await hub.view({ width: 1280, height: 800 }, "/");
		await waitFor(v, `typeof go === "function" && S`);
		await run(v, `go("settings")`);
		await waitFor(v, `[...document.querySelectorAll("#settings .li")].some(x => x.querySelector(".hd")?.textContent === "웹 접속" && x.querySelector(".sup")?.textContent === "Tailscale")`);
		await run(v, `[...document.querySelectorAll("#settings .li")].find(x => x.querySelector(".hd")?.textContent === "웹 접속").click()`);
		await waitFor(v, `current === "webaccess" && document.querySelector("#webaccess [role=radiogroup]")`);
		expect(puts).toEqual([]);
		expect(onboards).toEqual([]);
	}, 30_000);

	test("Tailscale is the default, no fields outside directly 입력, and no POST", async () => {
		const v = await open();
		expect(await ev<{ on: string; fields: string[]; open: boolean; summary: string; help: string }>(v, `({ on: document.querySelector("#webaccess [role=radiogroup] [aria-checked=true]").dataset.v, fields: [...document.querySelectorAll("#webaccess input")].map(i => i.name), open: document.querySelector("#webaccess details[data-wa-advanced]").open, summary: document.querySelector("#webaccess details[data-wa-advanced] summary").textContent, help: document.querySelector("[data-wa-help]").textContent })`)).toMatchObject({ on: "tailscale", fields: [], open: false });
		expect(await ev<string>(v, `document.querySelector("#webaccess details[data-wa-advanced] summary").textContent`)).toContain("직접 입력");
		expect(await text(v, "[data-wa-help]")).toContain("기본값");
		expect(await ev<number>(v, `document.querySelectorAll("#webaccess [role=radiogroup] .dot").length`)).toBe(0);
		expect(puts).toEqual([]);
		expect(onboards).toEqual([]);
		await click(v, "#webaccess details[data-wa-advanced] summary");
		await waitFor(v, `document.querySelector('#webaccess input[name="wa-hostname"]')`);
		expect(await ev<string[]>(v, `[...document.querySelectorAll("#webaccess input")].map(i => i.name)`)).toEqual(["wa-hostname", "wa-team", "wa-aud", "wa-token"]);
		expect(await ev<boolean>(v, `[...document.querySelectorAll("#webaccess input")].every(i => i.closest("details[data-wa-advanced]"))`)).toBe(true);
	}, 30_000);

	test("Cloudflare posts /api/web-access/onboard once and shows the panel and URL", async () => {
		const v = await open();
		await click(v, '#webaccess [role=radiogroup] [data-v="cloudflare"]');
		await waitFor(v, `document.querySelector('#webaccess [data-onb-state="done"]') && document.querySelector("#webaccess [data-onb-url]")`);
		expect(onboards).toEqual([{ mode: "cloudflare" }]);
		expect(await text(v, "#webaccess [data-onb-url]")).toBe("https://dotz.example.com");
		expect(await ev<string>(v, `document.querySelector("#webaccess [role=radiogroup] [aria-checked=true]").dataset.v`)).toBe("cloudflare");
		expect(await ev<number>(v, `document.querySelectorAll("#webaccess input").length`)).toBe(0);
		expect(puts).toEqual([]);
	}, 30_000);

	test("이 컴퓨터만 posts {mode:local} and needs no address", async () => {
		const v = await open();
		await click(v, '#webaccess [role=radiogroup] [data-v="local"]');
		await waitFor(v, `document.querySelector('#webaccess [data-onb-state="done"]')`);
		expect(onboards).toEqual([{ mode: "local" }]);
		expect(await ev<boolean>(v, `!!document.querySelector("#webaccess [data-onb-url]")`)).toBe(false);
		expect(puts).toEqual([]);
	}, 30_000);

	test("manual fields save inside 직접 입력 and the token never reaches the HTML", async () => {
		const v = await open();
		await click(v, '#webaccess [role=radiogroup] [data-v="cloudflare"]');
		await waitFor(v, `document.querySelector('#webaccess [data-onb-state="done"]')`);
		await click(v, "#webaccess details[data-wa-advanced] summary");
		await waitFor(v, `document.querySelector('#webaccess input[name="wa-token"]')`);
		await type(v, '#webaccess input[name="wa-hostname"]', "dotz2.example.com");
		await type(v, '#webaccess input[name="wa-team"]', "myteam");
		await type(v, '#webaccess input[name="wa-aud"]', "A".repeat(24));
		await type(v, '#webaccess input[name="wa-token"]', TOKEN);
		await click(v, "#webaccess [data-wa-save]");
		await waitFor(v, `document.querySelector("[data-wa-token-set]") && document.querySelector('#webaccess input[name="wa-token"]')?.value === ""`);
		expect(puts).toEqual([{ mode: "cloudflare", hostname: "dotz2.example.com", team: "myteam", aud: "A".repeat(24), token: TOKEN }]);
		expect(await ev<boolean>(v, `document.documentElement.outerHTML.includes(${JSON.stringify(TOKEN)})`)).toBe(false);
		expect(await ev<string>(v, `document.querySelector('#webaccess input[name="wa-token"]').value`)).toBe("");
		expect(await ev<boolean>(v, `!!document.querySelector("[data-wa-token-set]") && !!document.querySelector("[data-wa-tunnel]")`)).toBe(true);
		expect(await text(v, "[data-wa-devices]")).toContain("0대");
		await click(v, "[data-wa-devices]");
		await waitFor(v, `current === "devices"`);
	}, 30_000);

	test("an open 직접 입력 stays open when the screen redraws before the toggle event arrives", async () => {
		const v = await open();
		await run(v, `document.querySelector("#webaccess details[data-wa-advanced] summary").click(); renderWebAccess()`);
		expect(await ev<boolean>(v, `document.querySelector("#webaccess details[data-wa-advanced]").open`)).toBe(true);
		await waitFor(v, `document.querySelector('#webaccess input[name="wa-token"]')`);
	}, 30_000);

	test("switching back to Tailscale sends only the mode, with no confirm", async () => {
		wa = { ...wa, mode: "cloudflare", hostname: "dotz.example.com", token_set: true, tunnel: { state: "running" } };
		const v = await open();
		await click(v, '#webaccess [role=radiogroup] [data-v="tailscale"]');
		await waitFor(v, `WA.data.mode === "tailscale"`);
		expect(puts).toEqual([{ mode: "tailscale" }]);
		expect(onboards).toEqual([]);
		expect(await ev<unknown>(v, `document.querySelector("dialog[open]")`)).toBeNull();
		expect(await ev<unknown>(v, `document.querySelector("[data-wa-tunnel]")`)).toBeNull();
	}, 30_000);

	test("a missing cloudflared shows the install hint", async () => {
		reset();
		found = false;
		wa = { ...wa, mode: "cloudflare", hostname: "dotz.example.com", token_set: true, tunnel: { state: "error", error: "cloudflared를 찾을 수 없습니다" } };
		const v = await open();
		expect(await text(v, "[data-wa-cf-missing]")).toContain("웹 접속 설치해 줘");
		found = true;
	}, 30_000);

	test("screenshots: Cloudflare on, desktop and phone, light and dark", async () => {
		for (const [name, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
			for (const theme of ["light", "dark"] as const) {
				reset();
				wa = { ...wa, mode: "cloudflare", hostname: "dotz.example.com", team: "myteam", aud: "a".repeat(64), token_set: true, tunnel: { state: "running" }, devices: 2 };
				onb = done("https://dotz.example.com");
				const v = await open(w, h, theme);
				await Bun.write(`${SHOTS}/web-access-${name}-${theme}.png`, await v.screenshot());
				if (name === "desktop" && theme === "light") await Bun.write("/tmp/messenger-onboarding/web-access.png", await v.screenshot());
				expect(await noOverflow(v)).toBe(true);
			}
		}
		for (const d of ["desktop", "phone"]) for (const t of ["light", "dark"]) expect(await Bun.file(`${SHOTS}/web-access-${d}-${t}.png`).exists()).toBe(true);
		expect(await Bun.file("/tmp/messenger-onboarding/web-access.png").exists()).toBe(true);
	}, 60_000);
});
