import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { viewOf } from "./app-settings.ts";
import { WATCH_FIELDS } from "./watch-settings.ts";
import { fakeHub, json, waitFor, run, type View } from "./test-web.ts";

// Monitoring follow-ups in a headless Bun.WebView against a stub gateway (the peer is a fixture): a watch an app owns has no row of its own and shows its
// status in the app's panel, the quick chips are real chips above the composer, a monitor's conversation is titled with the monitor's own name and shows its
// status, and the orchestrator's busy line only appears for a turn that conversation started. Screenshots go to SETTINGS_SHOTS when it is set.
const SHOTS = process.env.SETTINGS_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const MINI = "http://mini.test";
const at = (min: number) => new Date(Date.UTC(2026, 9, 23, 3, min)).toISOString();
// The page labels a time by its day relative to Date.now(); the fixtures are dated, so the page clock runs from this fixed "now" (same KST day as at()), not the real date.
const PAGE_NOW = Date.UTC(2026, 9, 23, 3, 40);
const watch = (name: string, label: string, extra: object = {}) => ({ name: label, watch: name, kind: "watch", last_run: at(30), last_result: "ok", next_run: at(60), every: "30분마다", fails: 0, last_ok: at(30), ...extra });
const failing = (name: string, label: string, fails: number, extra: object = {}) => watch(name, label, { last_result: "fail", fails, last_ok: at(2), last_output: "로그인이 풀렸어요", ...extra });
const need = { drafts: 0, unread: 0, sentToday: 0 };
const app = (key: string, label: string, icon: string, extra: object = {}) => ({ key, label, icon, kind: "app", conv: [], notices: [], needs: need, ...extra });
const fields = () => WATCH_FIELDS.map(f => viewOf(f, f.key === "enabled" ? true : f.key === "every_minutes" ? 30 : f.key === "to" ? "alert" : "이름"));
const peers = [{ name: "맥미니", url: MINI, online: true, stale: false, items: { name: "맥미니", rev: "r1",
	monitors: [failing("acme-login", "카톡 로그인", 4, { keeper: true }), failing("login-boutique-com", "부티크 로그인 유지", 3, { keeper: true }), failing("webmail-naver", "웹메일 확인", 2)],
	notices: [], integrations: [app("kakao", "카카오톡", "chat", { watches: ["acme-login"] }), app("mail", "메일", "mail", { conv: ["mail:"], watches: ["webmail-"] })], conversations: [] } }];

const PEER_KAKAO = `p:${MINI}|i:kakao`;
const PEER_MAIL = `p:${MINI}|i:mail`;
const PEER_MON = `p:${MINI}|m:부티크 로그인 유지`;
let orchStatus = "idle";
const messages: Record<string, { ts: string }[]> = {};
const hub = fakeHub({
	api: (_req, url) => {
		const p = url.pathname;
		if (p === "/api/state") return json({ name: "dotz", orchestrator: { status: orchStatus }, lanes: [], terminals: {}, channels: { work: [] }, discord: {}, notices_unread: 0 });
		if (p === "/api/peers") return json([{ name: "맥북", url: `${hub.origin}`, self: true, online: true }, ...peers.map(x => ({ name: x.name, url: x.url, self: false, online: x.online }))]);
		if (p === "/api/machine") return json({ name: "맥북", custom: "", default: "맥북" });
		if (p === "/api/monitors") return json({ items: [failing("kakao-new", "카카오 새 글 확인", 2), failing("login-local", "로컬 로그인 유지", 3, { keeper: true }), watch("plain-watch", "일반 감시")] });
		if (p === "/api/notices") return json({ unread: 0, items: [] });
		if (p === "/api/integrations") return json({ items: [app("mail", "메일", "mail", { conv: ["mail:"] }), app("kakao", "카카오톡", "chat", { watches: ["kakao-new"] })] });
		if (p === "/api/conversations") return json({ items: [] });
		if (p === "/api/history") {
			const t = url.searchParams.get("target") ?? "";
			return json({ target: t, events: (messages[t] ?? []).map(m => ({ ts: m.ts, kind: "message", source: "web", channel: t, author: "local", text: "원인 찾아 줘" })) });
		}
		if (p === "/api/activity") return json({ items: [], more: false, history: false });
		if (p === "/api/kakao/rooms") return json({ on: true, rooms: [] });
		if (p === "/api/monitoring/peers") return json(peers);
		if (p === "/api/peer/proxy") return json(/^\/api\/(?:watches|integrations)\/[a-z-]+\/settings$/.test(url.searchParams.get("p") ?? "") ? { key: "x", fields: fields() } : {});
		if (/^\/api\/(?:integrations|watches)\/[a-z0-9-]+\/settings$/.test(p)) return json({ key: "x", fields: fields() });
	},
});

afterAll(() => hub.stop());
const q = async <T = unknown>(v: View, code: string): Promise<T> => JSON.parse((await v.evaluate(`JSON.stringify((() => { ${code} })())`)) as string) as T;
const shot = async (v: View, name: string) => { if (SHOTS) await Bun.write(join(SHOTS, name), await v.screenshot()); };
const boot = async (width: number, height: number) => {
	const v = await hub.view({ width, height });
	await v.navigate(`${hub.origin}/`);
	await run(v, `const off = ${PAGE_NOW} - Date.now(), real = Date.now.bind(Date); Date.now = () => real() + off`);
	await waitFor(v, `S && NM.loaded && NT.loaded && PR.fresh`);
	await run(v, `if (dotzTheme.get() === "dark") dotzTheme.toggle()`);
	await run(v, `go("monitoring")`);
	await waitFor(v, `PQ.loaded && PQ.list.length && INTG.items.length && monItems().some(i => i.key === "m:로컬 로그인 유지") && monItems().some(i => i.key === ${JSON.stringify(PEER_MON)}) && monItems().some(i => i.key === ${JSON.stringify(PEER_KAKAO)}) && monItems().some(i => i.key === ${JSON.stringify(PEER_MAIL)})`);
	return v;
};
// The options and the status live in the settings screen the conversation's ⋯ button pushes; `#app-sw` exists only while it is open.
const MORE = `[...document.querySelectorAll("[data-as-more]")].find(b => b.offsetParent && !b.hidden)`;
const openScreen = async (v: View) => {
	await waitFor(v, MORE);
	await run(v, `${MORE}.click()`);
	await waitFor(v, `document.querySelector("#app-sw .as-row")`);
};
const rowNames = async (v: View) => { await waitFor(v, `document.querySelector('#mon-side [data-k^="p:"]')`); return q<string[]>(v, `return [...document.querySelectorAll("#mon-side .cv-row .cv-n")].map(n => n.textContent)`); };

describe("a watch an app owns belongs to the app", () => {
	for (const [label, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
		test(`${label}: no row in 일반 모니터링, the app row fails, the panel has its status (local)`, async () => {
			const v = await boot(w, h);
			if (w < 1100) await run(v, `go("monitoring", "list")`);
			const names = await rowNames(v);
			expect(names).not.toContain("카카오 새 글 확인");
			expect(names).toContain("로컬 로그인 유지");
			expect(names).toContain("일반 감시");
			expect(await q(v, `return !!document.querySelector('#mon-side [data-k="i:kakao"] .tag.err')`)).toBe(true);
			expect(await q(v, `return !!document.querySelector('#mon-side [data-k="i:mail"] .tag.err')`)).toBe(false);
			await run(v, `go("monitoring", "c:settings:kakao")`);
			await waitFor(v, `target === "settings:kakao"`);
			await openScreen(v);
			await waitFor(v, `document.querySelector('#app-sw .as-stat[data-watch="kakao-new"]')`);
			const t = await q<string>(v, `return document.querySelector('#app-sw .as-stat[data-watch="kakao-new"]').textContent`);
			for (const s of ["카카오 새 글 확인", "연속 실패 2번", "마지막 정상"]) expect(t).toContain(s);
			expect(t).toMatch(/다음.*오후/);
			await shot(v, `owned-watch-panel-${w}.png`);
		});
		test(`${label}: a peer's owned watch is no row either, its app row fails and the app shows the status`, async () => {
			const v = await boot(w, h);
			if (w < 1100) await run(v, `go("monitoring", "list")`);
			const names = await rowNames(v);
			expect(names).not.toContain("카톡 로그인");
			expect(names).not.toContain("웹메일 확인");
			expect(names).toContain("부티크 로그인 유지");
			expect(await q(v, `return !!document.querySelector('#mon-side [data-k=${JSON.stringify(PEER_KAKAO)}] .tag.err')`)).toBe(true);
			await run(v, `go("monitoring", ${JSON.stringify(PEER_KAKAO)})`);
			await waitFor(v, `document.querySelector('.kk-rooms .as-stat[data-watch="acme-login"]')`);
			expect(await q<string>(v, `return document.querySelector('.kk-rooms .as-stat[data-watch="acme-login"]').textContent`)).toContain("연속 실패 4번");
			await shot(v, `owned-watch-peer-${w}.png`);
			await run(v, `go("monitoring", ${JSON.stringify(PEER_MAIL)})`);
			// The app's status is in its settings screen, opened from the title-bar gear.
			const gear = `document.querySelector("#as-bar:not([hidden]), #mon-head .as-hd[data-as-open]")`;
			await waitFor(v, gear);
			await run(v, `${gear}.click()`);
			await waitFor(v, `/^settings:mail~/.test(target)`);
			await openScreen(v);
			await waitFor(v, `document.querySelector("#app-sw .as-stat") && document.querySelector("#app-sw .as-stat").textContent.includes("연속 실패 2번")`);
		});
	}
});

describe("a monitor's conversation", () => {
	test("390px: the quick chips are real chips above the composer", async () => {
		const v = await boot(390, 844);
		await run(v, `go("monitoring", "c:settings:w:login-local")`);
		await waitFor(v, `target === "settings:w:login-local" && document.querySelectorAll("#mon-chips .as-tpl").length === 3`);
		const s = await q<{ minH: number; bg: string; border: number; wrap: string; above: boolean; inComposer: boolean; n: number }>(v, `const row = document.querySelector("#mon-chips"), chips = [...row.querySelectorAll(".as-tpl")], c = document.querySelector("#composer");
			return { minH: Math.min(...chips.map(x => x.getBoundingClientRect().height)), bg: getComputedStyle(chips[0]).backgroundColor, border: parseFloat(getComputedStyle(chips[0]).borderTopWidth), wrap: getComputedStyle(row).flexWrap, above: row.getBoundingClientRect().bottom <= c.querySelector("#send").getBoundingClientRect().top + 1, inComposer: c.contains(row), n: chips.length }`);
		expect(s.minH).toBeGreaterThanOrEqual(28);
		expect(s.bg).not.toBe("rgba(0, 0, 0, 0)");
		expect(s.wrap).toBe("wrap");
		expect(s.above && s.inComposer).toBe(true);
		await shot(v, "monitor-chips-390.png");
	});

	test("390px: a peer monitor's conversation is titled with its own name and the machine, with its status", async () => {
		const v = await boot(390, 844);
		await run(v, `go("monitoring", "c:settings:w:login-boutique-com")`);
		await waitFor(v, `target === "settings:w:login-boutique-com"`);
		const conv = await q<{ title: string; chip: string; sw: boolean }>(v, `return { title: document.querySelector("#title").textContent, chip: document.querySelector("#title .mon-pc").textContent, sw: !!document.querySelector("#app-sw") }`);
		expect(conv.sw).toBe(false);
		// the computer beside the title never makes a second row: the bar is as tall as the title's own row
		expect(await q<boolean>(v, `const h = document.querySelector("#title"); return h.getBoundingClientRect().height === h.querySelector(".ttx").getBoundingClientRect().height`)).toBe(true);
		await openScreen(v);
		await waitFor(v, `document.querySelector('#app-sw .as-stat')`);
		const s = { ...conv, stat: await q<string>(v, `return document.querySelector("#app-sw .as-stat").textContent`) };
		expect(s.title).toContain("부티크 로그인 유지");
		expect(s.title).not.toContain("설정");
		expect(s.chip).toBe("맥미니");
		for (const t of ["연속 실패 3번", "마지막 정상"]) expect(s.stat).toContain(t);
		expect(s.stat).toMatch(/다음.*오후/);
		await shot(v, "peer-monitor-conversation-390.png");
	});

	test("1280px: the head says the monitor's name, then the machine", async () => {
		const v = await boot(1280, 800);
		await run(v, `go("monitoring", "c:settings:w:login-boutique-com")`);
		await waitFor(v, `target === "settings:w:login-boutique-com" && document.querySelector("#cv-head .cv-n")`);
		const t = await q<string>(v, `return document.querySelector("#cv-head .cv-n").textContent`);
		expect(t).toBe("부티크 로그인 유지맥미니");
	});

	test("390px: the busy line shows only for a turn this conversation started", async () => {
		orchStatus = "working";
		const v = await boot(390, 844);
		await run(v, `go("monitoring", "c:settings:w:plain-watch")`);
		await waitFor(v, `target === "settings:w:plain-watch" && ${MORE}`);
		expect(await q(v, `return [isWorking(target), document.querySelector("#runline").hidden, document.querySelector("#working").hidden]`)).toEqual([false, true, true]);
		await run(v, `chatPush({ a: { type: "tool_call", tool: "Bash", ts: new Date().toISOString(), input: {} } })`);
		expect(await q(v, `return document.querySelectorAll("#tl .work").length`)).toBe(0);
		await shot(v, "monitor-busy-other-390.png");
		await run(v, `TURN.set(target, Date.now() - 1000); renderWorking(); chatPush({ a: { type: "tool_call", tool: "Bash", ts: new Date().toISOString(), input: {} } })`);
		expect(await q(v, `return [isWorking(target), document.querySelector("#runline").hidden, document.querySelectorAll("#tl .work").length]`)).toEqual([true, false, 1]);
		await shot(v, "monitor-busy-own-390.png");
		await run(v, `go("chat", MAIN)`);
		expect(await q(v, `return isWorking(MAIN)`)).toBe(true);
		orchStatus = "idle";
		messages["settings:w:plain-watch"] = [];
	});
});
