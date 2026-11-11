import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { ev, fakeHub, inbox, json, run, waitFor, type View } from "./test-web.ts";

// 설정의 메신저: four rows from the index, one screen per messenger (status + one action + onboarding + 알림 + read-only rooms),
// and manual fields only in the closed "직접 입력" disclosure. Headless Bun.WebView against a stub gateway.
const SHOTS = "/tmp/messenger-onboarding";
mkdirSync(SHOTS, { recursive: true });

const PROJECTS = [{ target: "ch:7", name: "결제" }, { target: "ch:8", name: "정산" }];
const baseItems = () => [
	{ id: "discord", label: "Discord", enabled: true, state: "ok", configured: true },
	{ id: "jandi", label: "JANDI", enabled: false, state: "off", configured: true },
	{ id: "slack", label: "Slack", enabled: false, state: "off", configured: false },
	{ id: "telegram", label: "Telegram", enabled: true, state: "error", configured: true, error: "토큰이 거절됐어요" },
];
const jandi = () => ({
	enabled: items.find(i => i.id === "jandi")!.enabled,
	help: ["JANDI 방마다 수신 웹훅을 만들고 URL을 붙여 넣어요"],
	fields: [{ key: "host", label: "받는 주소", type: "text", value: "0.0.0.0" }, { key: "port", label: "받는 포트", type: "number", value: 8765 },
		{ key: "incoming_url", label: "기본 수신 웹훅 URL", type: "secret", set: secretSet, hint: "방마다 따로 정하지 않은 방의 메시지가 모두 이 JANDI 방으로 가요" }],
	allow: { label: "말을 걸 수 있는 사람", hint: "이메일이나 JANDI 이름", items: allow },
	rooms: {
		label: "방", editable: true, hint: "JANDI는 웹훅을 API로 만들 수 없어요",
		fields: [{ key: "webhook", label: "발신 웹훅 URL", type: "copy" }],
		items: [
			{ id: "m1", name: "메인", kind: "main", values: { webhook: "http://192.168.0.5:8765/jandi/m1" }, set: { outgoing_token: true, incoming_url: true }, last_in: Date.now() - 120_000, last_out: Date.now() - 30_000 },
			{ id: "p1", name: "결제 프로젝트", kind: "project", project: { target: "ch:7", name: "결제" }, values: {}, set: {}, last_error: "HTTP 500" },
		],
	},
	projects: PROJECTS,
	notify: { ask: true, alert: true, result: true, news: true, conv: true, log: true },
	...(selfChat ? { self_chat: selfChat } : {}),
});
const slack = () => ({
	enabled: false,
	help: ["Slack 앱을 만들고 봇 토큰을 저장해요"],
	fields: [{ key: "token", label: "봇 토큰", type: "secret", set: false }],
	allow: { label: "말을 걸 수 있는 사람", hint: "Slack 사용자 ID", items: [] },
	rooms: { label: "채널", editable: true, hint: "연결하면 채널을 읽어요", fields: [], items: [] },
	projects: PROJECTS,
	notify: { ask: true, alert: true, result: true, news: true, conv: true, log: true },
});
const telegram = () => ({
	enabled: true,
	help: ["BotFather에서 봇을 만들어요"],
	fields: [{ key: "token", label: "봇 토큰", type: "secret", set: true }],
	allow: { label: "말을 걸 수 있는 사람", hint: "Telegram 사용자 ID", items: [] },
	rooms: { label: "대화", editable: true, fields: [], items: [{ id: "c1", name: "나", kind: "main", values: {}, set: {} }] },
	projects: PROJECTS,
	notify: { ask: true, alert: true, result: true, news: true, conv: true, log: true },
});
let items: any[];
let selfChat: { state: string; label: string; hint: string; connect: string } | undefined;
let secretSet = false;
let allow: string[];
let onboard: string[] = [];
let picks: string[] = [];
let startGate: Promise<void> | null = null;   // holds the answer of /start until a test lets it go
let startFail = false;
let testFail = false;
const puts = inbox<any>();
let ob: Record<string, any>;
const idle = key => ({ key, state: "idle", step: null, owner: null, error: null, url: null, updated_at: new Date(0).toISOString() });
const waiting = (key, label, hint) => ({ key, state: "waiting", step: { id: "owner", title: "로그인", detail: "브라우저에서 로그인해 주세요" }, owner: { label, hint }, error: null, url: null, updated_at: new Date(0).toISOString() });
const done = (key, url = null) => ({ key, state: "done", step: { id: "done", title: "완료", detail: "연결했어요" }, owner: null, error: null, url, updated_at: new Date(0).toISOString() });
function reset() {
	items = baseItems();
	selfChat = undefined;
	secretSet = false;
	allow = ["boss@corp.test"];
	puts.length = 0;
	onboard = [];
	startGate = null;
	startFail = false;
	testFail = false;
	ob = Object.fromEntries(["discord", "jandi", "slack", "telegram"].map(k => [k, idle(k)]));
}
reset();
const settingsFor = (id: string) => id === "jandi" ? jandi() : id === "slack" ? slack() : telegram();

const hub = fakeHub({
	slowTimers: true,
	api: async (req, url) => {
		const p = url.pathname;
		if (p === "/api/messengers" && req.method === "GET") return json({ items });
		const m = p.match(/^\/api\/messengers\/([^/]+)$/);
		if (m && req.method === "GET") return json(settingsFor(decodeURIComponent(m[1])));
		if (m && req.method === "PUT") {
			const b = (await req.json()) as any;
			puts.push(b);
			const id = decodeURIComponent(m[1]), s = settingsFor(id);
			if (b.notify) s.notify = { ...s.notify, ...b.notify };
			if (b.enabled !== undefined) {
				s.enabled = b.enabled;
				const it = items.find(i => i.id === id)!;
				it.enabled = b.enabled;
				it.state = b.enabled ? "ok" : "off";
			}
			if (b.values) for (const [k, v] of Object.entries(b.values)) {
				const f = s.fields.find(x => x.key === k);
				if (f && f.type === "secret") { f.set = true; secretSet = true; } else if (f) f.value = v;
			}
			if (b.allow) allow = b.allow;
			return json(s);
		}
		if (/^\/api\/messengers\/[^/]+\/test$/.test(p) && req.method === "POST") return testFail ? json({ error: "답이 없어요" }, 502) : json({ results: [{ name: "메인", ok: true }] });
		const o = p.match(/^\/api\/onboarding\/([^/]+)(?:\/(start|continue|cancel))?$/);
		if (o) {
			const key = o[1]!, action = o[2];
			if (!action) return json(ob[key]);
			onboard.push(`${key}/${action}`);
			if (action === "start" && startGate) await startGate;
			if (action === "start" && startFail) return json({ error: "게이트웨이가 답하지 않아요" }, 502);
			if (action === "start") ob[key] = waiting(key, key === "discord" ? "Discord 열기" : "관리자로 로그인", key === "telegram" ? "Telegram에서 시작을 눌러 주세요." : "브라우저에서 남은 한 가지를 마쳐 주세요.");
			else if (action === "continue") {
				const b = (await req.clone().json().catch(() => ({}))) as { choice?: string };
				if (b.choice) picks.push(b.choice);
				ob[key] = done(key, key === "telegram" ? "https://t.me/example" : null);
			}
			else ob[key] = idle(key);
			return json(ob[key]);
		}
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

const open = async (width: number, height: number, theme: "light" | "dark" = "light", view = "messengers"): Promise<View> => {
	const v = await hub.view({ width, height }, "/");
	await waitFor(v, `typeof go === "function" && typeof S !== "undefined" && S`);
	await run(v, `document.documentElement.dataset.theme = ${JSON.stringify(theme)}; go(${JSON.stringify(view)})`);
	if (view === "messengers") await waitFor(v, `document.querySelectorAll("#messengers [data-ms-row]").length === 4 && document.querySelector('#messengers [data-ms-row="telegram"] .tag')`);
	else if (view === "settings") await waitFor(v, `document.querySelector("#settings [data-ms-hub] .sup")`);
	else await waitFor(v, `document.querySelector("#${view} [data-ms-connect]") && document.querySelector("#${view} [data-ms-status]")`);
	return v;
};
const click = (v: View, sel: string) => run(v, `document.querySelector(${JSON.stringify(sel)}).click()`);
const type = (v: View, sel: string, text: string) => run(v, `const i = document.querySelector(${JSON.stringify(sel)}); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event("input", { bubbles: true }))`);
const noOverflow = (v: View, sel: string) => ev<boolean>(v, `document.documentElement.scrollWidth <= document.documentElement.clientWidth && [...document.querySelectorAll(${JSON.stringify(sel)})].every(l => l.scrollWidth <= l.clientWidth)`);

describe("메신저 설정", () => {
	beforeEach(reset);

	test("settings has one 메신저 row that summarizes the connections; its screen lists Discord/JANDI/Slack/Telegram and each opens its view", async () => {
		const v = await open(1280, 800, "light", "settings");
		await waitFor(v, `document.querySelector("#settings [data-ms-hub] .sup").textContent !== ""`);
		expect(await ev<number>(v, `document.querySelectorAll("#settings [data-ms-hub]").length`)).toBe(1);
		expect(await ev<number>(v, `document.querySelectorAll("#settings [data-ms-row]").length`)).toBe(0);
		// Discord and JANDI are connected: the summary names the first and counts the other
		const sum = await ev<string>(v, `document.querySelector("#settings [data-ms-hub] .sup").textContent`);
		expect(sum).toContain("Discord");
		expect(sum).toContain("1");
		await click(v, "#settings [data-ms-hub]");
		await waitFor(v, `current === "messengers" && document.querySelectorAll("#messengers [data-ms-row]").length === 4`);
		const rows = await ev<{ id: string; name: string; tag: string; sup: boolean }[]>(v, `[...document.querySelectorAll("#messengers [data-ms-row]")].map(r => ({ id: r.dataset.msRow, name: r.querySelector(".hd").textContent, tag: r.querySelector(".tag")?.textContent, sup: !!r.querySelector(".sup") }))`);
		expect(rows).toEqual([
			{ id: "discord", name: "Discord", tag: "연결됨", sup: false },
			{ id: "jandi", name: "JANDI", tag: "연결됨", sup: false },
			{ id: "slack", name: "Slack", tag: "설정 안 됨", sup: false },
			{ id: "telegram", name: "Telegram", tag: "연결 안 됨", sup: true },
		]);
		expect(await ev<number>(v, `document.querySelectorAll("#messengers [data-ms-row] .dot").length`)).toBe(0);   // the tag draws its own dot: no second one inside it
		for (const id of ["discord", "jandi", "slack", "telegram"]) {
			await run(v, `go("messengers")`);
			await waitFor(v, `document.querySelector("#messengers [data-ms-row=\\"${id}\\"] .tag")`);
			await click(v, `#messengers [data-ms-row="${id}"]`);
			await waitFor(v, `current === "${id}"`);
		}
		// the screen's own back lands on the 메신저 list
		await click(v, "#back");
		await waitFor(v, `current === "messengers"`);
	}, 30_000);

	test("every screen has one action, a closed 직접 입력, and no input outside it", async () => {
		const v = await open(1280, 800);
		const want = { discord: "다시 연결", jandi: "켜기", slack: "연결", telegram: "연결" } as const;
		for (const [id, text] of Object.entries(want)) {
			await run(v, `go("${id}")`);
			await waitFor(v, `document.querySelector("#${id} [data-ms-connect]") && document.querySelector("#${id} [data-ms-status]")`);
			expect(await ev<number>(v, `document.querySelectorAll("#${id} [data-ms-connect]").length`)).toBe(1);
			expect(await ev<string>(v, `document.querySelector("#${id} [data-ms-connect]").textContent`)).toBe(text);
			expect(await ev<boolean>(v, `document.querySelector("#${id} details[data-ms-advanced]").open`)).toBe(false);
			expect(await ev<string>(v, `document.querySelector("#${id} details[data-ms-advanced] summary").textContent`)).toContain("직접 입력");
			expect(await ev<number>(v, `document.querySelectorAll("#${id} input").length`)).toBe(0);
			await click(v, `#${id} details[data-ms-advanced] summary`);
			await waitFor(v, `document.querySelectorAll("#${id} details[data-ms-advanced] input").length > 0`);
			expect(await ev<boolean>(v, `[...document.querySelectorAll("#${id} input")].every(i => i.closest("details[data-ms-advanced]"))`)).toBe(true);
			expect(await ev<boolean>(v, `!!document.querySelector("#${id} details[data-ms-advanced] [data-ms-save]")`)).toBe(true);
		}
	}, 30_000);

	test("알림: a flip sends only that class", async () => {
		const v = await open(1280, 800, "light", "jandi");
		await waitFor(v, `document.querySelectorAll("#jandi [data-notify]").length === 6`);
		puts.length = 0;
		await click(v, '#jandi [data-notify="news"] .hs-sw');
		await waitFor(v, `document.querySelector('#jandi [data-notify="news"] .hs-sw').getAttribute("aria-checked") === "false"`);
		await puts.until(x => x.length === 1);
		expect(puts).toEqual([{ notify: { news: false } }]);
	}, 30_000);

	test("an open 직접 입력 stays open when the screen redraws before the toggle event arrives", async () => {
		const v = await open(1280, 800, "light", "slack");
		await waitFor(v, `document.querySelector("#slack details[data-ms-advanced] summary")`);
		await run(v, `document.querySelector("#slack details[data-ms-advanced] summary").click(); renderMessenger("slack")`);
		expect(await ev<boolean>(v, `document.querySelector("#slack details[data-ms-advanced]").open`)).toBe(true);
		await waitFor(v, `document.querySelector('#slack input[name="ms-token"]')`);
	}, 30_000);

	test("typing a token in 직접 입력 sends only that value, and the field is emptied after the save", async () => {
		const v = await open(390, 844, "light", "slack");
		await waitFor(v, `document.querySelector("#slack details[data-ms-advanced] summary")`);
		await click(v, "#slack details[data-ms-advanced] summary");
		const sel = '#slack details[data-ms-advanced] input[name="ms-token"]';
		await waitFor(v, `document.querySelector('${sel}')`);
		await type(v, sel, "xoxb-typed");
		await waitFor(v, `!document.querySelector("#slack [data-ms-save]").disabled`);
		puts.length = 0;
		await click(v, "#slack [data-ms-save]");
		await waitFor(v, `document.querySelector('#slack [data-set="token"]')`);
		expect(puts).toEqual([{ values: { token: "xoxb-typed" } }]);
		expect(await ev<string>(v, `document.querySelector('${sel}').value`)).toBe("");
	}, 30_000);

	test("켜기 sends enabled=true and reloads the row", async () => {
		const v = await open(1280, 800, "light", "jandi");
		puts.length = 0;
		await click(v, "#jandi [data-ms-connect]");
		await waitFor(v, `document.querySelector("#jandi [data-ms-connect]").textContent === "다시 연결"`);
		expect(puts).toEqual([{ enabled: true }]);
	}, 30_000);

	test("JANDI 나와의 대화 row: absent without self_chat; carries the settings words and starts the JANDI flow in every state", async () => {
		const v = await open(1280, 800, "light", "jandi");
		expect(await ev<number>(v, `document.querySelectorAll("#jandi [data-ms-selfchat]").length`)).toBe(0);
		const words = { off: ["잔디 나와의 대화", "아직 연결하지 않았어요.", "잔디 로그인으로 연결"], ok: ["잔디 나와의 대화", "연결돼 있어요.", "다시 연결"], lost: ["잔디 나와의 대화", "로그인이 끝났어요.", "다시 연결"] } as const;
		for (const state of ["off", "ok", "lost"] as const) {
			const [label, hint, connect] = words[state];
			selfChat = { state, label, hint, connect };
			await run(v, `MSS.page.s = null; renderMessenger("jandi")`);
			await waitFor(v, `document.querySelector('#jandi [data-ms-selfchat="${state}"]')`);
			const row = await ev<{ n: number; text: string; button: string; lead: boolean }>(v, `({ n: document.querySelectorAll("#jandi [data-ms-selfchat]").length, text: document.querySelector("#jandi [data-ms-selfchat] .tx").textContent, button: document.querySelector("#jandi [data-ms-selfchat-connect]").textContent, lead: !document.querySelector("#jandi [data-ms-selfchat-connect]").classList.contains("tonal") })`);
			expect(row).toEqual({ n: 1, text: label + hint, button: connect, lead: state === "lost" });
		}
		onboard = [];
		await click(v, "#jandi [data-ms-selfchat-connect]");
		await waitFor(v, `document.querySelector('#jandi [data-onb-state="waiting"]')`);
		expect(onboard).toEqual(["jandi/start"]);
	}, 30_000);

	test("a JANDI that connects by login shows one action, and a step the owner row repeats is drawn once", async () => {
		const j = items.find(i => i.id === "jandi")!;
		Object.assign(j, { enabled: false, configured: false, state: "off" });
		selfChat = { state: "off", label: "L", hint: "H", connect: "C" };
		const v = await open(1280, 800);
		await run(v, `go("jandi")`);
		await waitFor(v, `document.querySelector('#jandi [data-ms-selfchat="off"]')`);
		const count = (sel: string) => ev<number>(v, `document.querySelectorAll(${JSON.stringify("#jandi " + sel)}).length`);
		expect([await count("[data-ms-status]"), await count("[data-ms-connect]"), await count("[data-ms-selfchat-connect]")]).toEqual([0, 0, 1]);
		Object.assign(j, { enabled: true, configured: true, state: "ok" });
		selfChat = { state: "ok", label: "L", hint: "H", connect: "C" };
		await run(v, `MSS.page.s = null; loadMessengerIndex().then(() => renderMessenger("jandi"))`);
		await waitFor(v, `document.querySelector('#jandi [data-ms-selfchat="ok"]') && document.querySelector('#jandi [data-ms-status]')`);
		expect([await count("[data-ms-connect]"), await count("[data-ms-selfchat-connect]")]).toEqual([0, 1]);
		selfChat = { state: "lost", label: "L", hint: "H", connect: "C" };
		await run(v, `MSS.page.s = null; renderMessenger("jandi")`);
		await waitFor(v, `document.querySelector('#jandi [data-ms-selfchat="lost"]')`);
		expect(await count("[data-ms-status]")).toBe(0);
		ob.jandi = waiting("jandi", "로그인", "탭에서 로그인해 주세요.");
		await run(v, `loadOnboarding("jandi")`);
		await waitFor(v, `document.querySelector('#jandi [data-onb-owner]')`);
		expect(await ev<number>(v, `[...document.querySelectorAll("#jandi .hd")].filter(x => x.textContent === "로그인").length`)).toBe(1);
	}, 30_000);

	test("a question with choices shows one row each, no continue button, never auto-continues, and a pick posts the choice", async () => {
		const v = await open(1280, 800, "light", "jandi");
		onboard = [];
		picks = [];
		ob.jandi = { ...waiting("jandi", "팀 고르기", "연결할 팀을 골라 주세요."), manual: true, choices: [{ id: "11", label: "Alpha" }, { id: "12", label: "Beta" }] };
		await run(v, `loadOnboarding("jandi")`);
		await waitFor(v, `document.querySelectorAll('#jandi [data-onb-choice]').length === 2`);
		expect(await ev<number>(v, `document.querySelectorAll("#jandi [data-onb-continue]").length`)).toBe(0);
		expect(await ev<number>(v, `OB.jandi.autoTimer`)).toBe(0);
		await click(v, '#jandi [data-onb-choice="12"] button');
		await waitFor(v, `document.querySelector('#jandi [data-onb-state="done"]')`);
		expect(picks).toEqual(["12"]);
		expect(await ev<number>(v, `document.querySelectorAll("#jandi [data-onb-choice]").length`)).toBe(0);
	}, 30_000);

	test("연결 says 연결하는 중 on the pressed row until the start answers, and a failed start gives the button back", async () => {
		const v = await open(390, 844, "light", "slack");
		let free = () => {};
		startGate = new Promise<void>(r => { free = r; });
		await click(v, "#slack [data-ms-connect]");
		await waitFor(v, `document.querySelector('#slack [data-onb-state="running"]')`);
		expect(await ev<number[]>(v, `[document.querySelector("#slack [data-ms-connect]").disabled, document.querySelectorAll("#slack [data-onb-cancel]").length]`)).toEqual([true, 0]);
		startFail = true;
		free();
		await waitFor(v, `!document.querySelector("#slack [data-onb-state]") && !document.querySelector("#slack [data-ms-connect]").disabled`);
		expect(await ev<number>(v, `document.querySelectorAll("#slack [data-onb-error], #slack [data-onb-owner]").length`)).toBe(0);
	}, 30_000);

	test("연결 starts onboarding; waiting shows one owner line and continue posts /continue", async () => {
		const v = await open(1280, 800, "light", "telegram");
		onboard = [];
		await click(v, "#telegram [data-ms-connect]");
		await waitFor(v, `document.querySelector('#telegram [data-onb-state="waiting"]')`);
		expect(onboard).toEqual(["telegram/start"]);
		expect(await ev<number>(v, `document.querySelectorAll("#telegram [data-onb-owner]").length`)).toBe(1);
		expect(await ev<string>(v, `document.querySelector("#telegram [data-onb-owner]").textContent`)).toContain("Telegram에서 시작을 눌러 주세요.");
		expect(await ev<number>(v, `document.querySelectorAll("#telegram [data-onb-continue]").length`)).toBe(1);
		expect(await ev<number>(v, `document.querySelectorAll("#telegram [data-onb-cancel]").length`)).toBe(1);
		await click(v, "#telegram [data-onb-continue]");
		await waitFor(v, `document.querySelector('#telegram [data-onb-state="done"]')`);
		expect(onboard.filter(x => x === "telegram/continue").length).toBe(1);
		expect(await ev<string>(v, `document.querySelector("#telegram [data-onb-url]").textContent`)).toBe("https://t.me/example");
	}, 30_000);

	test("자동 연결 leaves a live messenger, stays for a failed run, and is not drawn while nothing has started", async () => {
		items.find(m => m.id === "jandi").state = "ok";
		ob.jandi = { ...idle("jandi"), state: "failed", error: "웹훅을 만들지 못했어요" };
		const v = await open(1280, 800, "light", "jandi");
		await waitFor(v, `document.querySelector('#jandi [data-onb-state="failed"]')`);
		ob.jandi = idle("jandi");
		await run(v, `loadOnboarding("jandi")`);
		await waitFor(v, `!document.querySelector("#jandi [data-onb]") && [...document.querySelectorAll("#jandi .sec")].every(x => x.textContent !== "자동 연결")`);
	}, 30_000);

	test("이미 연결된 JANDI: 다시 연결이 끝나면 그 줄이 연결한 때를 말하고, 연결 확인이 자기 줄에 결과를 남기고, 숫자 id는 어느 서비스 id인지 앞에 달고 있다", async () => {
		const it = items.find(m => m.id === "jandi");
		it.enabled = true; it.state = "ok";
		allow = ["123456789"];
		const v = await open(390, 844, "light", "jandi");
		await waitFor(v, `document.querySelector('#jandi [data-allow]')`);
		expect(await ev<string>(v, `document.querySelector('#jandi [data-allow="123456789"] .hd').textContent`)).toBe("JANDI ID 123456789");
		expect(await ev<string>(v, `document.querySelector("#jandi [data-ms-connect]").textContent`)).toBe("다시 연결");
		expect(await ev<number>(v, `document.querySelectorAll("#jandi [data-ms-test-sum]").length`)).toBe(0);
		await click(v, "#jandi [data-ms-test]");
		await waitFor(v, `document.querySelector('#jandi [data-ms-test-row] [data-ms-test-sum]')`);
		testFail = true;
		await click(v, "#jandi [data-ms-test]");
		await waitFor(v, `!document.querySelector("#jandi [data-ms-test-sum]") && document.querySelector('#jandi [data-ms-test-row] .dcs-err')`);
		await click(v, "#jandi [data-ms-connect]");
		await waitFor(v, `document.querySelector('#jandi [data-onb-state="waiting"]')`);
		await click(v, "#jandi [data-onb-continue]");
		await waitFor(v, `!document.querySelector("#jandi [data-onb]") && /연결했어요/.test(document.querySelector("#jandi [data-ms-status] .sup")?.textContent || "")`);
	}, 30_000);

	test("JANDI rooms stay read-only and 저장 sends only what changed", async () => {
		const v = await open(1280, 800, "light", "jandi");
		await waitFor(v, `document.querySelectorAll("#jandi [data-room]").length === 2`);
		expect(await ev<string[]>(v, `[...document.querySelectorAll("#jandi [data-room] .hd")].map(h => h.textContent)`)).toEqual(["메인", "결제 프로젝트"]);
		expect(await ev<string>(v, `document.querySelector('#jandi [data-room="p1"] .dcs-err').textContent`)).toBe("HTTP 500");
		expect(await ev<boolean>(v, `document.querySelector("[data-ms-test]") && document.querySelector("[data-ms-add]") === null`)).toBe(true);
		await click(v, "#jandi details[data-ms-advanced] summary");
		await waitFor(v, `document.querySelector('#jandi input[name="ms-port"]')`);
		puts.length = 0;
		await type(v, '#jandi input[name="ms-port"]', "9000");
		await click(v, "#jandi [data-ms-save]");
		await puts.until(x => x.length === 1);
		expect(puts).toEqual([{ values: { port: 9000 } }]);
		// The saved page is drawn: typing before that is wiped when the reply clears the edits (the field already shows 9000 as typed, so it proves nothing).
		await waitFor(v, `document.querySelector("#jandi [data-ms-save]").textContent === "저장했어요" && document.querySelector('#jandi input[name="ms-port"]').value === "9000"`);
		puts.length = 0;
		await type(v, '#jandi input[name="ms-incoming_url"]', "http://in/SECRET");
		await click(v, "#jandi [data-ms-save]");
		await puts.until(x => x.length === 1);
		expect(puts).toEqual([{ values: { incoming_url: "http://in/SECRET" } }]);
		await waitFor(v, `document.querySelector('#jandi input[name="ms-incoming_url"]').value === "" && document.querySelectorAll('#jandi [data-set=incoming_url]').length === 1`);
		expect(await ev<boolean>(v, `document.documentElement.outerHTML.includes("http://in/SECRET")`)).toBe(false);
		expect(await ev<number>(v, `document.querySelectorAll("#jandi [data-set=incoming_url]").length`)).toBe(1);
	}, 30_000);

	test("screenshots: settings 1280 light, 390 dark, and each messenger screen", async () => {
		const desk = await open(1280, 800, "light");
		await Bun.write(`${SHOTS}/after-1280.png`, await desk.screenshot());
		expect(await noOverflow(desk, "#messengers .list")).toBe(true);
		const phone = await open(390, 844, "dark");
		await run(phone, `document.querySelector("#messengers [data-ms-row=telegram]").scrollIntoView({ block: "center" })`);
		await Bun.write(`${SHOTS}/after-390.png`, await phone.screenshot());
		expect(await noOverflow(phone, "#messengers .list")).toBe(true);
		for (const id of ["discord", "jandi", "slack", "telegram"]) {
			const v = await open(1280, 800, "light", id);
			await waitFor(v, `document.querySelector("#${id} [data-ms-status]")`);
			await Bun.write(`${SHOTS}/messenger-${id}.png`, await v.screenshot());
			expect(await noOverflow(v, `#${id} .list`)).toBe(true);
		}
		for (const f of ["after-1280.png", "after-390.png", "messenger-discord.png", "messenger-jandi.png", "messenger-slack.png", "messenger-telegram.png"]) expect(await Bun.file(`${SHOTS}/${f}`).exists()).toBe(true);
	}, 60_000);
});
