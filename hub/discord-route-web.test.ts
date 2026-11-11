import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ev, fakeHub, inbox, json, run, waitFor, type View } from "./test-web.ts";

// 설정 → Discord: the screen now carries the index-derived status, one 연결 action, the onboarding panel, the existing
// 5 알림 and 4 conversation switches, and every ID/token input inside the closed "직접 입력" disclosure.
const SHOTS = process.env.DISCORD_SHOTS ?? join(tmpdir(), "dotz-discord-screen");
mkdirSync(SHOTS, { recursive: true });

const STORED_TOKEN = "STORED-TOKEN-NEVER-IN-THE-PAGE";
const NEW_TOKEN = "AAAAAAAAAAAAAAAAAAAAAAAA.BBBBBB.CCCCCCCCCCCCCCCCCCCCCCCCCCC";
const INVITE = "https://discord.com/oauth2/authorize?client_id=999000111222333444&scope=bot&permissions=8&guild_id=111111111111111111";
const NOTE = "개발자 포털 > Bot > Privileged Gateway Intents > MESSAGE CONTENT를 켜 주세요";
const POST = { chat: true, lanes: true, alert: true, worklog: true, web_lanes: false, ask: true, result: false, news: true, conv: true };

let configured = true;
let post: Record<string, boolean> = { ...POST };
let conn: Record<string, unknown> = {};
let puts = inbox<Record<string, boolean>>();
let saves: Record<string, string>[] = [];
let restarts = inbox<unknown>();
let checks = 0;
let onboard: string[] = [];
let onb: Record<string, any>;
const idle = () => ({ key: "discord", state: "idle", step: null, owner: null, error: null, url: null, updated_at: new Date(0).toISOString() });
const waiting = () => ({ key: "discord", state: "waiting", step: { id: "invite", title: "봇 초대", detail: "브라우저에서 초대를 확인해 주세요" }, owner: { label: "Discord에서 승인", hint: "열린 Discord 화면에서 승인을 눌러 주세요." }, error: null, url: null, updated_at: new Date(0).toISOString() });
const done = () => ({ key: "discord", state: "done", step: { id: "done", title: "완료", detail: "연결했어요" }, owner: null, error: null, url: null, updated_at: new Date(0).toISOString() });
function reset(conf = true) {
	configured = conf;
	conn = conf
		? { enabled: true, connected: true, user: "dotz-bot", error: "", guild: "111111111111111111", owner_id: "222222222222222222", app_id: "999000111222333444", has_token: true, restart_needed: false }
		: { enabled: false, connected: false, user: "", error: "", guild: "", owner_id: "", app_id: "", has_token: false, restart_needed: false };
	post = { ...POST };
	puts.length = 0; saves = []; restarts.length = 0; checks = 0; onboard = [];
	onb = idle();
}

const hub = fakeHub({
	slowTimers: true,
	api: async (req, url) => {
		const p = url.pathname;
		if (p === "/api/messengers") return json({ items: [
			{ id: "discord", label: "Discord", enabled: configured, state: configured ? "ok" : "off", configured },
			{ id: "jandi", label: "JANDI", enabled: true, state: "ok", configured: true },
			{ id: "slack", label: "Slack", enabled: false, state: "off", configured: false },
			{ id: "telegram", label: "Telegram", enabled: false, state: "off", configured: false },
		] });
		if (p === "/api/push/classes") return json({ classes: { ask: true, alert: true, result: true, news: true, conv: true, log: false } });
		if (p === "/api/discord/post") {
			if (req.method !== "GET") {
				const b = (await req.json()) as Record<string, boolean>;
				puts.push(b);
				post = { ...post, ...b };
			}
			return json(post);
		}
		if (p === "/api/discord/connection") {
			if (req.method === "PUT") {
				const b = (await req.json()) as Record<string, string>;
				saves.push(b);
				if (b.guild !== undefined && !/^\d{17,20}$/.test(b.guild)) return json({ error: "서버 ID는 17~20자리 숫자여야 해요" }, 400);
				conn = { ...conn, ...(b.guild ? { guild: b.guild } : {}), ...(b.owner_id ? { owner_id: b.owner_id } : {}), ...(b.token ? { has_token: true } : {}), restart_needed: true };
			}
			return json(conn);
		}
		if (p === "/api/discord/connection/check") {
			checks++;
			return json({ ok: true, app_id: "999000111222333444", bot_name: "dotz-bot", admin: false, invite_url: INVITE, intent_note: NOTE });
		}
		if (p === "/api/onboarding/discord" && req.method === "POST" && url.pathname.endsWith("/start")) { onboard.push("start"); onb = waiting(); return json(onb); }
		if (p === "/api/onboarding/discord/start") { onboard.push("start"); onb = waiting(); return json(onb); }
		if (p === "/api/onboarding/discord/continue") { onboard.push("continue"); onb = done(); return json(onb); }
		if (p === "/api/onboarding/discord/cancel") { onboard.push("cancel"); onb = idle(); return json(onb); }
		if (p === "/api/onboarding/discord") return json(onb);
		if (p === "/api/update/restart") { restarts.push(await req.json()); return json({ ok: true }); }
		if (p === "/api/update") {
			const at = { sha: "a".repeat(40), short: "a".repeat(7), date: new Date(0).toISOString() };
			return json({ running: { kind: "git", branch: "main", commit: at }, disk: { kind: "git", branch: "main", commit: at }, settings: { auto_check: false, auto_apply: false, at: "09:00" }, busy: [] });
		}
		if (p === "/api/web-access") return json({ mode: "tailscale", hostname: "", team: "", aud: "", token_set: false, tunnel: { state: "off" }, devices: 0, cloudflared_found: true });
		if (p === "/api/devices") return json([]);
		if (p === "/api/accounts") return json({ error: "no accounts here" }, 404);
	},
});
afterAll(() => hub.stop());

const waitForView = (v: View, expr: string) => waitFor(v, expr);
const q = <T = unknown>(v: View, expr: string) => ev<T>(v, expr);
const click = (v: View, sel: string) => run(v, `document.querySelector(${JSON.stringify(sel)}).click()`);
const type = (v: View, sel: string, value: string) => run(v, `const i = document.querySelector(${JSON.stringify(sel)}); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event("input", { bubbles: true }))`);
const clickText = (v: View, sel: string, text: string) => run(v, `[...document.querySelectorAll(${JSON.stringify(sel)})].find(b => b.textContent === ${JSON.stringify(text)}).click()`);
async function settings(width: number, height: number) {
	const v = await hub.view({ width, height }, "/");
	await waitForView(v, `typeof S !== "undefined" && S && S.discord !== undefined`);
	await run(v, `go("settings")`);
	await waitForView(v, `document.querySelector("#settings [data-ms-hub] .sup").textContent !== ""`);
	await click(v, "#settings [data-ms-hub]");
	await waitForView(v, `current === "messengers" && document.querySelectorAll("#messengers [data-ms-row]").length === 4 && document.querySelector('#messengers [data-ms-row="discord"] .tag')`);
	return v;
}
const openScreen = async (v: View) => {
	await click(v, '#messengers [data-ms-row="discord"]');
	await waitForView(v, `current === "discord" && DCS.v && document.querySelector("#discord [data-ms-connect]")`);
};
const shot = async (v: View, name: string) => Bun.write(join(SHOTS, name), await v.screenshot());
const noOverflow = (v: View) => q<boolean>(v, `document.documentElement.scrollWidth <= document.documentElement.clientWidth && [...document.querySelectorAll("#discord .list")].every(l => l.scrollWidth <= l.clientWidth)`);

describe.each([[390, 844], [1280, 900]] as const)("at %ipx", (width, height) => {
	beforeEach(() => reset(true));

	test("connected: the row opens the screen, switches stay, and manual fields wait in 직접 입력", async () => {
		const v = await settings(width, height);
		expect(await q<number>(v, `document.querySelectorAll("#settings [data-dc], #settings [data-dc-hint]").length`)).toBe(0);
				expect(await q<string>(v, `document.querySelector('#messengers [data-ms-row="discord"] .tag').textContent`)).toBe("연결됨");
		if (width === 390) {
			await run(v, `document.querySelector('#messengers [data-ms-row="discord"]').scrollIntoView({ block: "center" })`);
			await shot(v, "settings-390.png");
		}
		await openScreen(v);
		await waitForView(v, `document.querySelectorAll("#discord .hs-sw[data-k]").length === 5 && document.querySelectorAll("#discord .hs-sw[data-dc]").length === 4`);
		expect(await q<string>(v, `document.querySelector("#discord [data-ms-status], #discord .li").querySelector(":scope .tag").textContent`)).toBe("연결됨");
		expect(await q<string>(v, `document.querySelector("#discord .li .sup").textContent`)).toBe("dotz-bot");
		expect(await q<string>(v, `document.querySelector("#discord [data-ms-connect]").textContent`)).toBe("다시 연결");
		expect(await q<boolean>(v, `document.querySelector("#discord details[data-ms-advanced]").open`)).toBe(false);
		expect(await q<number>(v, `document.querySelectorAll("#discord input").length`)).toBe(0);
		await click(v, "#discord details[data-ms-advanced] summary");
		await waitForView(v, `document.querySelector("#discord input[name=discord-guild]")`);
		expect(await q<string[]>(v, `[DCS.guild.value, DCS.owner.value, DCS.tok.value, document.querySelector("#discord .dcs-saved").textContent]`)).toEqual(["111111111111111111", "222222222222222222", "", "저장됨"]);
		expect(await q<string[][]>(v, `[...document.querySelectorAll("#discord .hs-sw[data-k]")].map(b => [b.dataset.k, b.getAttribute("aria-checked")])`)).toEqual([
			["ask", "true"], ["alert", "true"], ["result", "false"], ["news", "true"], ["conv", "true"]]);
		expect(await q<string[][]>(v, `[...document.querySelectorAll("#discord .hs-sw[data-dc]")].map(b => [b.dataset.dc, b.getAttribute("aria-checked")])`)).toEqual([
			["chat", "true"], ["lanes", "true"], ["worklog", "true"], ["web_lanes", "false"]]);
		expect(await q<number>(v, `document.querySelectorAll("#discord [data-k=alert], #discord [data-dc=alert]").length`)).toBe(1);
		expect(await q<boolean>(v, `!document.documentElement.outerHTML.includes(${JSON.stringify(STORED_TOKEN)})`)).toBe(true);

		await click(v, `#discord .hs-sw[data-k="result"]`);
		await puts.until(x => x.length === 1);
		expect(puts).toEqual([{ result: true }]);
		await click(v, `#discord .hs-sw[data-dc="web_lanes"]`);
		await puts.until(x => x.length === 2);
		expect(puts[1]).toEqual({ web_lanes: true });

		await clickText(v, "#discord .btn", "연결 확인");
		await waitForView(v, `document.querySelector("#discord .dcs-res a")`);
		expect(await q<string[]>(v, `(() => { const a = document.querySelector("#discord .dcs-res a"); return [document.querySelector("#discord .dcs-ok").textContent, a.textContent, a.href, document.querySelector("#discord .dcs-res").textContent.includes(${JSON.stringify(NOTE)})]; })()`)).toEqual(["봇 dotz-bot", "봇 권한 다시 승인", INVITE, true]);

		await type(v, "#discord input[name=discord-guild]", "123");
		await clickText(v, "#discord .btn", "저장");
		await waitForView(v, `document.querySelector("#discord .dcs-err")`);
		expect(await q<string>(v, `document.querySelector("#discord .dcs-err").textContent`)).toBe("서버 ID는 17~20자리 숫자여야 해요");
		expect(saves).toEqual([{ guild: "123" }]);

		await type(v, "#discord input[name=discord-guild]", "333333333333333333");
		await type(v, "#discord input[name=discord-token]", NEW_TOKEN);
		await clickText(v, "#discord .btn", "저장");
		await waitForView(v, `!document.querySelector("#discord .dcs-err") && [...document.querySelectorAll("#discord .btn")].some(b => b.textContent === "다시 시작")`);
		expect(saves[1]).toEqual({ token: NEW_TOKEN, guild: "333333333333333333" });
		expect(await q<string[]>(v, `document.querySelector("#discord .dcs-saved") && [DCS.tok.value, document.querySelector("#discord .dcs-saved").textContent]`)).toEqual(["", "저장됨"]);
		expect(await q<boolean>(v, `!document.documentElement.outerHTML.includes(${JSON.stringify(NEW_TOKEN)})`)).toBe(true);
		await shot(v, `discord-on-${width}.png`);
		expect(await noOverflow(v)).toBe(true);
		await clickText(v, "#discord .btn", "다시 시작");
		await restarts.until(x => x.length === 1);
		expect(restarts).toEqual([{}]);
	}, 60_000);

	test("an open 직접 입력 stays open when the screen redraws before the toggle event arrives", async () => {
		const v = await settings(width, height);
		await openScreen(v);
		await waitForView(v, `document.querySelector("#discord details[data-ms-advanced] summary")`);
		await run(v, `document.querySelector("#discord details[data-ms-advanced] summary").click(); renderDiscord()`);
		expect(await q<boolean>(v, `document.querySelector("#discord details[data-ms-advanced]").open`)).toBe(true);
		await waitForView(v, `document.querySelector("#discord input[name=discord-guild]")`);
	}, 30_000);

	test("not configured: the row and screen say 설정 안 됨, and 연결 starts onboarding", async () => {
		reset(false);
		const v = await settings(width, height);
		expect(await q<string>(v, `document.querySelector('#messengers [data-ms-row="discord"] .tag').textContent`)).toBe("설정 안 됨");
		await openScreen(v);
		expect(await q<string>(v, `document.querySelector("#discord .li .tag").textContent`)).toBe("설정 안 됨");
		expect(await q<string>(v, `document.querySelector("#discord [data-ms-connect]").textContent`)).toBe("연결");
		expect(await q<number>(v, `document.querySelectorAll("#discord [data-dc-guide] li").length`)).toBeGreaterThanOrEqual(3);
		expect(await q<number>(v, `document.querySelectorAll("#discord .hs-sw").length`)).toBe(0);
		expect(await q<number>(v, `[...document.querySelectorAll("#discord .sup")].filter(s => s.textContent === "연결하면 고를 수 있어요").length`)).toBe(2);
		expect(await q<number>(v, `document.querySelectorAll("#discord input").length`)).toBe(0);
		await click(v, "#discord [data-ms-connect]");
		await waitForView(v, `document.querySelector('#discord [data-onb-state="waiting"]')`);
		expect(onboard).toEqual(["start"]);
		expect(await q<number>(v, `document.querySelectorAll("#discord [data-onb-owner]").length`)).toBe(1);
		expect(await q<string>(v, `document.querySelector("#discord [data-onb-owner]").textContent`)).toContain("열린 Discord 화면에서 승인을 눌러 주세요.");
		await click(v, "#discord [data-onb-continue]");
		await waitForView(v, `document.querySelector('#discord [data-onb-state="done"]')`);
		expect(onboard).toEqual(["start", "continue"]);
		await shot(v, `discord-off-${width}.png`);
		expect(await noOverflow(v)).toBe(true);
		await run(v, `document.querySelector("#back").click()`);
		await waitForView(v, `current === "messengers"`);
		expect(puts.length + saves.length + restarts.length).toBe(0);
	}, 60_000);
});
