import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSettings, writeSettings } from "./app-settings.ts";
import { removalPlan, removeApp } from "./app-off.ts";
import { readAppTemplates } from "./app-templates.ts";
import { integrationAvailable, integrationContext, integrationItems, readAppOff } from "./integrations.ts";
import { fakeHub, inbox, json, run, waitFor, type View } from "./test-web.ts";

// 모니터링 > 앱 > 설정 (web/js/32-app-settings.js) as shipped, in a headless Bun.WebView against a stub gateway whose settings routes call the real
// hub/app-settings.ts on a temp data dir. Screenshots are written only when SETTINGS_SHOTS names a folder. Names and ids are placeholders.
const SHOTS = process.env.SETTINGS_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "as-web-"));
const cfgFile = (rel: string) => join(data, rel);

const ts = (m: number) => new Date(Date.UTC(2026, 9, 23, 3, m)).toISOString();
const PROPOSAL = { app: "mail", changes: { skip_senders: ["promo@shop.example"], auto_draft: true } };
const history = (target: string) => target === "settings:mail" ? [
	{ ts: ts(1), kind: "message", source: "web", channel: target, author: "local", text: "광고 메일은 답장 초안에서 빼 주고 자동 초안은 켜 줘" },
	{ ts: ts(2), kind: "out", source: "orchestrator", target, text: `광고 보내는 곳 하나를 빼고 자동 초안을 켜는 변경이에요.\n\`\`\`dotz-settings\n${JSON.stringify(PROPOSAL)}\n\`\`\`` },
] : [];

const sent = inbox<Record<string, unknown>>();
const patches = inbox<Record<string, unknown>>();
const removes: Record<string, unknown>[] = [];
const hub = fakeHub({
	stream: "fake",
	api: async (req, url) => {
		const p = url.pathname;
		if (p === "/api/history") return json({ target: url.searchParams.get("target"), events: history(url.searchParams.get("target") ?? "") });
		if (p === "/api/activity") return json({ items: [], more: false, history: false });
		if (p === "/api/conversations") return json({ items: [] });
		if (p === "/api/notices") return json({ unread: 0, items: [] });
		if (p === "/api/monitors") return json({ items: [] });
		if (p === "/api/integrations") {
			const all = ["mail", "kakao", "youtube"].map(key => ({ key, label: { mail: "메일", kakao: "카카오톡", youtube: "유튜브" }[key]!, icon: key === "kakao" ? "chat" : key, kind: "app", conv: key === "mail" ? ["mail:"] : [], notices: [], needs: { drafts: 0, unread: 0, sentToday: 0 } }));
			const off = readAppOff(data);
			return json({ items: all.filter(i => !off.has(i.key)), available: [...all.filter(i => off.has(i.key)).map(i => ({ ...i, off: true }))] });
		}
		if (p === "/api/app-templates") return json({ items: readAppTemplates(data) });
		const life = /^\/api\/integrations\/([a-z0-9-]+)\/(remove|add)$/.exec(p);
		if (life) {
			const app = life[1]!;
			if (life[2] === "remove" && req.method === "GET") return json(removalPlan(data, app, ["kakao-new"]));
			if (life[2] === "remove") {
				const b = (await req.json()) as { deleteData?: boolean };
				removes.push({ app, deleteData: b.deleteData });
				removeApp(data, app, { deleteStored: b.deleteData === true }, { watchNames: () => ["kakao-new"], removeWatch: () => {} });
				return json({ ok: true });
			}
			writeSettings(data, app, { use_here: true });
			return json({ ok: true, ready: integrationItems(integrationContext(data, ["zele"]), [], {}).some(i => i.key === app) });
		}
		if (p === "/api/kakao/rooms") return json({ on: true, rooms: [] });
		const m = /^\/api\/integrations\/([a-z0-9-]+)\/settings$/.exec(p);
		if (m) {
			try {
				if (req.method === "PATCH") {
					const b = (await req.json()) as { values: unknown };
					patches.push({ app: m[1], values: b.values });
					return json({ key: m[1], fields: writeSettings(data, m[1]!, b.values) });
				}
				return json({ key: m[1], fields: readSettings(data, m[1]!) });
			} catch (e) {
				return json({ error: (e as Error).message }, 400);
			}
		}
		if (p === "/api/message") { sent.push((await req.json()) as Record<string, unknown>); return json({ ok: true }); }
	},
});

const open = (width: number, height: number): Promise<View> => hub.view({ width, height });
afterAll(() => { hub.stop(); rmSync(data, { recursive: true, force: true }); });

const q = async <T = unknown>(v: View, code: string): Promise<T> => JSON.parse((await v.evaluate(`JSON.stringify((() => { ${code} })())`)) as string) as T;
const shot = async (v: View, name: string) => { if (SHOTS) await waitFor(v, `document.getAnimations().every(a => a.playState !== "running")`); if (SHOTS) await Bun.write(join(SHOTS, name), await v.screenshot()); };
// The options live in the settings screen the conversation's ⋯ button pushes; `#app-sw` exists only while it is open.
const openScreen = async (v: View, app = "") => {
	const more = `[...document.querySelectorAll("[data-as-more]")].find(b => b.offsetParent && !b.hidden && (!${JSON.stringify(app)} || b.dataset.asMore === ${JSON.stringify(app)}))`;
	await waitFor(v, more);
	await run(v, `${more}.click()`);
	await waitFor(v, `document.querySelector("#app-sw .as-row")`);
};
const closeScreen = async (v: View) => {
	await run(v, `const b = document.querySelector('[data-k="as-back"]'); if (b) b.click()`);
	await waitFor(v, `!document.querySelector("#app-sw")`);
};
const boot = async (v: View, route: string) => {
	const opened = hub.nextStream();
	await v.navigate(`${hub.origin}/`);
	await opened;
	await waitFor(v, `typeof NT !== "undefined" && NT.loaded && S`);
	await run(v, `if (dotzTheme.get() === "dark") dotzTheme.toggle()`);
	await run(v, `go("monitoring", ${JSON.stringify(route)})`);
};

describe("설정 대화 at desktop width (1280x800)", async () => {
	const v = await open(1280, 800);

	test("the mail detail header has a 대화 button (no row on top of the list) that opens the settings conversation", async () => {
		await boot(v, "i:mail");
		await waitFor(v, `document.querySelector("#mon-head .as-hd")`);
		expect(await q(v, `return [document.querySelector("#mon-head .as-hd").getAttribute("aria-label"), document.querySelector("#mon-head .as-more").getAttribute("aria-label"), document.querySelectorAll(".as-pin").length]`)).toEqual(["대화", "설정", 0]);
		await shot(v, "01-desktop-pinned-row.png");
		await run(v, `document.querySelector("#mon-head .as-hd").click()`);
		await waitFor(v, `target === "settings:mail" && [...document.querySelectorAll("[data-as-more]")].some(b => b.offsetParent && !b.hidden)`);
		expect(await q(v, `return document.querySelector("#cv-body #app-sw, #tl #app-sw")`)).toBe(null);
		expect(await q(v, `return document.querySelector("#app-sw")`)).toBe(null);
		await openScreen(v);
		expect(await q(v, `return document.querySelector(".as-screen #app-sw") !== null`)).toBe(true);
	});

	test("the switch PATCHes the same route with no message to the bot, and writes the custom file", async () => {
		await run(v, `document.querySelector('#app-sw [data-k="auto_draft"]').click()`);
		await waitFor(v, `document.querySelector('#app-sw [data-k="auto_draft"]').getAttribute("aria-checked") === "true"`);
		expect(patches).toEqual([{ app: "mail", values: { auto_draft: true } }]);
		expect(sent).toEqual([]);
		expect(JSON.parse(readFileSync(cfgFile("custom/reply-drafts/config.json"), "utf8")).apps.mail.auto).toBe(true);
		await run(v, `document.querySelector('#app-sw [data-k="auto_draft"]').click()`);
		await waitFor(v, `document.querySelector('#app-sw [data-k="auto_draft"]').getAttribute("aria-checked") === "false"`);
		expect(patches.length).toBe(2);
		await closeScreen(v);
	});

	test("an answer with a dotz-settings block is a change card; nothing is written until 적용", async () => {
		await waitFor(v, `document.querySelector("#tl .as-card")`);
		const card = await q<{ rows: string[]; buttons: string[] }>(v, `const c = document.querySelector("#tl .as-card"); return { rows: [...c.querySelectorAll(".as-cr")].map(r => r.textContent), buttons: [...c.querySelectorAll("button")].map(b => b.textContent) }`);
		expect(card.buttons).toHaveLength(2);
		expect(card.rows.some(r => r.includes("자동 초안") && r.includes("꺼짐 → 켜짐"))).toBe(true);
		expect(card.rows.some(r => r.includes("추가 promo@shop.example"))).toBe(true);
		expect(patches.length).toBe(2);
		expect(JSON.parse(readFileSync(cfgFile("custom/reply-drafts/config.json"), "utf8")).senders).toBeUndefined();
		await shot(v, "02-desktop-settings-conversation.png");
		await run(v, `document.querySelector('#tl .as-card [data-as="apply"]').click()`);
		await waitFor(v, `document.querySelector("#tl .as-done.applied")`);
		expect(patches[2]).toEqual({ app: "mail", values: PROPOSAL.changes });
		expect(JSON.parse(readFileSync(cfgFile("custom/reply-drafts/config.json"), "utf8")).senders.skip).toEqual(["promo@shop.example"]);
		await openScreen(v);
		await waitFor(v, `document.querySelector('#app-sw [data-k="auto_draft"]').getAttribute("aria-checked") === "true"`);
		await closeScreen(v);
	});

	test("the composer sends settings:<app> to the orchestrator", async () => {
		await run(v, `ta.value = "답장 말투 더 짧게"; sendChat()`);
		await sent.until(() => !(!sent.length));
		expect(sent[0]).toMatchObject({ text: "답장 말투 더 짧게", settings: "mail" });
	});

	test("a card the owner cancels writes nothing", async () => {
		const before = patches.length;
		await run(v, `localStorage.removeItem("dotz.settings.cards"); AS.done = {}; renderAll()`);
		await waitFor(v, `document.querySelector('#tl .as-card [data-as="cancel"]')`);
		await run(v, `document.querySelector('#tl .as-card [data-as="cancel"]').click()`);
		await waitFor(v, `document.querySelector("#tl .as-done.cancelled")`);
		expect(patches.length).toBe(before);
	});

	test("kakao: the 설정 button is in the app head, none on top of the room list, and its conversation has the 감시 switch", async () => {
		await run(v, `go("monitoring", "i:kakao")`);
		await waitFor(v, `document.querySelector("#mon-head .as-hd")`);
		expect(await q(v, `return document.querySelectorAll(".as-pin").length`)).toBe(0);
		await run(v, `document.querySelector("#mon-head .as-hd").click()`);
		await waitFor(v, `target === "settings:kakao"`);
		await openScreen(v, "kakao");
		await waitFor(v, `document.querySelector('#app-sw [data-k="enabled"]')`);
		await shot(v, "03-desktop-kakao-settings.png");
		expect(existsSync(cfgFile("custom/kakao/config.json"))).toBe(false);
		await closeScreen(v);
	});
	test("앱 관리 at desktop width: a middle box, not full screen, with the request box on top and focused", async () => {
		await run(v, `go("monitoring"); asAddSheet()`);
		await waitFor(v, `document.querySelector('.fs-card.mid [data-k="new-app-text"]')`);
		expect(await q(v, `return document.activeElement.dataset.k`)).toBe("new-app-text");
		const r = await q<{ w: number; h: number; vh: number }>(v, `const b = document.querySelector(".fs-card.mid").getBoundingClientRect(); return { w: b.width, h: b.height, vh: innerHeight }`);
		expect(r.w).toBeLessThanOrEqual(560);
		expect(r.h).toBeLessThan(r.vh / 2);
		await shot(v, "12-desktop-add-sheet.png");
		await run(v, `AT.h.close(false)`);
	});

});

describe("설정 대화 at phone width (390x844)", async () => {
	const v = await open(390, 844);

	test("switches above the conversation and the change card fit the screen", async () => {
		writeSettings(data, "mail", { auto_draft: false, skip_senders: [] });
		await boot(v, "c:settings:mail");
		await waitFor(v, `target === "settings:mail" && document.querySelector("#tl .as-card")`);
		await run(v, `localStorage.removeItem("dotz.settings.cards"); AS.done = {}; renderAll()`);
		await waitFor(v, `document.querySelector('#tl .as-card [data-as="apply"]')`);
		expect(await q(v, `return document.querySelector("#app-sw")`)).toBe(null);
		const card = await q<number>(v, `return document.querySelector("#tl .as-card").scrollWidth`);
		const vw = await q<number>(v, `return innerWidth`);
		expect(card).toBeLessThanOrEqual(vw);
		await shot(v, "04-phone-settings-conversation.png");
		await openScreen(v);
		expect(await q<number>(v, `return document.querySelector("#app-sw").scrollWidth`)).toBeLessThanOrEqual(vw);
		await shot(v, "04b-phone-settings-screen.png");
		await closeScreen(v);
	});
});

describe("이 기기에서 쓰기, 제거 and 앱 추가 at phone width (390x844)", async () => {
	const v = await open(390, 844);
	const rows = (sel: string) => q<string[]>(v, `return [...document.querySelectorAll(${JSON.stringify(sel)})].map(e => e.textContent.trim())`);

	test("연결됨 sits at the top, then 자동 초안과 승인 and 고급 with 이 기기에서 쓰기 on", async () => {
		await boot(v, "c:settings:mail");
		await waitFor(v, `target === "settings:mail"`);
		await openScreen(v);
		await waitFor(v, `document.querySelector('#app-sw [data-k="auto_draft"]')`);
		expect(await q(v, `return { conn: document.querySelector("#app-sw").firstElementChild.dataset.conn, secs: [...document.querySelectorAll("#app-sw [data-sec]")].map(e => e.dataset.sec) }`)).toEqual({ conn: "connected", secs: ["notify", "draft", "advanced"] });
		expect(await q(v, `return document.querySelector('#app-sw [data-k="use_here"]').getAttribute("aria-checked")`)).toBe("true");
		expect((await rows("#app-sw .as-row .as-n"))[0]).toBeTruthy();
		expect(await q(v, `return [...document.querySelectorAll("#app-sw [data-sec='draft'] ~ [data-setting]")].map(e => e.dataset.setting)`)).toEqual(["auto_draft", "to_only", "unanswered_days", "skip_senders", "only_senders", "draft_rules", "draft_default", "use_here", "label", "delete_original", "reply_model", "conv_model", "memory"]);
		await shot(v, "05-phone-switch-and-remove.png");
		await closeScreen(v);
	});

	test("제거 shows plainly what goes, with the data kept by default, before anything is removed", async () => {
		writeSettings(data, "kakao", { enabled: true });
		await run(v, `go("monitoring", "c:settings:kakao")`);
		await waitFor(v, `target === "settings:kakao"`);
		await openScreen(v, "kakao");
		await waitFor(v, `document.querySelector('#app-sw [data-k="enabled"]') && document.querySelector('#app-sw [data-as-rm="ask"]')`);
		await run(v, `document.querySelector('#app-sw [data-as-rm="ask"]').click()`);
		await waitFor(v, `document.querySelector("#app-sw .as-rm")`);
		const text = (await rows("#app-sw .as-rm li")).join("|");
		expect(text).toContain("kakao-new");
		expect(await q(v, `return document.querySelector('#app-sw [data-k="delete-data"]').checked`)).toBe(false);
		expect(removes).toEqual([]);
		const fit = await q<{ w: number; vw: number }>(v, `return { w: document.querySelector("#app-sw").scrollWidth, vw: innerWidth }`);
		expect(fit.w).toBeLessThanOrEqual(fit.vw);
		await shot(v, "06-phone-remove-confirm.png");
	});

	test("취소 closes the confirm; 제거 확인 with the box unticked removes the app and keeps its data", async () => {
		await run(v, `document.querySelector('#app-sw [data-as-rm="cancel"]').click()`);
		await waitFor(v, `!document.querySelector("#app-sw .as-rm")`);
		await run(v, `document.querySelector('#app-sw [data-as-rm="ask"]').click()`);
		await waitFor(v, `document.querySelector('#app-sw [data-as-rm="go"]')`);
		await run(v, `document.querySelector('#app-sw [data-as-rm="go"]').click()`);
		await waitFor(v, `INTG.available.some(a => a.key === "kakao" && a.off)`);
		expect(removes).toEqual([{ app: "kakao", deleteData: false }]);
		expect(readAppOff(data).has("kakao")).toBe(true);
		expect(existsSync(cfgFile("custom/kakao/config.json"))).toBe(true);
		await closeScreen(v);
	});

	const closeSheet = (v: View) => run(v, `if (AT.h) AT.h.close(false)`);
	// 새로 추가 asks one plain question; the app templates stay in docs/app-templates for the bot to read when the owner names an app (owner 2026-10-26).
	const NEW_DRAFT = "연결할 앱: ";

	test("앱 추가 is the last row of the 앱 group, right under the apps", async () => {
		await run(v, `go("monitoring")`);
		await waitFor(v, `document.querySelector('#mon-side [data-k="add-app"]')`);
		expect(await q(v, `return document.querySelector('#mon-side [data-k="i:kakao"]')`)).toBe(null);
		const keys = await q<string[]>(v, `return monRows(monItems(), null).map(r => r.header ? "#" + r.header : r.k)`);
		expect(keys.slice(-3)).toEqual(["i:mail", "i:youtube", "add-app"]);
		expect(keys.indexOf("#앱")).toBeLessThan(keys.indexOf("add-app"));
		await shot(v, "07-phone-add-app-row.png");
	});

	test("the sheet is a bottom sheet with the request box on top and only the apps that are off; 다시 켜기 refills that app's request", async () => {
		await run(v, `document.querySelector('#mon-side [data-k="add-app"]').click()`);
		await waitFor(v, `document.querySelector('.fs-card [data-k="new-app-text"]')`);
		expect(await q<string[]>(v, `return [...document.querySelectorAll(".fs-card [data-app]")].map(e => e.dataset.app)`)).toEqual(["kakao"]);
		expect(await q(v, `return document.querySelectorAll(".fs-card [data-app] .as-h").length`)).toBe(0);
		expect(await q(v, `return document.querySelectorAll(".fs-card [data-tpl]").length`)).toBe(0);
		await waitFor(v, `Math.round(document.querySelector(".fs-card").getBoundingClientRect().bottom) === innerHeight`);
		const fit = await q<{ w: number; vw: number; top: number; bottom: number; vh: number }>(v, `const b = document.querySelector(".fs-card").getBoundingClientRect(); return { w: document.querySelector(".fs-card").scrollWidth, vw: innerWidth, top: b.top, bottom: b.bottom, vh: innerHeight }`);
		expect(fit.w).toBeLessThanOrEqual(fit.vw);
		expect(fit.top).toBeGreaterThan(0);
		expect(Math.round(fit.bottom)).toBe(fit.vh);
		await shot(v, "08-phone-add-sheet.png");
		sent.length = 0;
		await run(v, `document.querySelector('.fs-card [data-k="on:kakao"]').click()`);
		await waitFor(v, `!AT.h && target === "main" && ta.value.includes("카카오톡 앱을 만들어")`);
		expect(await q(v, `return document.querySelectorAll("#app-tpl [data-tpl]").length`)).toBe(0);
		expect(await q(v, `return document.querySelector("#app-tpl-note").textContent`)).toContain("{{ }}");
		expect(readAppOff(data).has("kakao")).toBe(false);
		expect(sent).toEqual([]);
	});

	test("what the owner types on top is sent to the main orchestrator at once and the main chat opens on it; an empty box sends nothing", async () => {
		await run(v, `ta.value = ""; asTplEnd(); go("monitoring")`);
		await waitFor(v, `INTG.available.length === 0 && document.querySelector('#mon-side [data-k="add-app"]')`);
		await run(v, `document.querySelector('#mon-side [data-k="add-app"]').click()`);
		await waitFor(v, `document.querySelector('.fs-card [data-k="new-app-text"]')`);
		expect(await q(v, `return document.querySelectorAll(".fs-card [data-app]").length`)).toBe(0);
		await shot(v, "08b-phone-add-sheet-empty.png");
		sent.length = 0;
		await run(v, `document.querySelector('.fs-card [data-k="new-app"]').click()`);
		expect(await q(v, `return !!AT.h && document.activeElement.dataset.k`)).toBe("new-app-text");
		await run(v, `const b = document.querySelector('[data-k="new-app-text"]'); b.value = "노션 연결해 줘"; b.dispatchEvent(new Event("input"))`);
		await run(v, `document.querySelector('.fs-card [data-k="new-app"]').click()`);
		await sent.until(() => sent.length > 0);
		expect(sent.map(s => s.text)).toEqual([`${NEW_DRAFT}노션 연결해 줘`]);
		await waitFor(v, `!AT.h && target === "main" && current === "chat" && ta.value === ""`);
		await shot(v, "09-phone-new-app-sent.png");
	});

	test("another computer's off apps are listed under its own name", async () => {
		await run(v, `PQ.list = [{ name: "Mac mini", url: "http://mini.example", online: true, items: { monitors: [], notices: [], conversations: [], integrations: [], available: [{ key: "instagram", label: "인스타그램", icon: "instagram", off: true, conv: [] }] } }]; go("monitoring"); asAddSheet()`);
		try {
			await waitFor(v, `document.querySelector(".fs-card [data-app]")`);
			expect(await rows(".fs-card [data-app] .as-h")).toEqual(["Mac mini"]);
			await shot(v, "11-phone-add-sheet-peer.png");
		} finally {
			await run(v, `PQ.list = []`);
			await closeSheet(v);
		}
	});

	test("the switch turns an app off here; 앱 추가 turns it back on and opens it", async () => {
		await run(v, `go("monitoring", "c:settings:mail")`);
		await waitFor(v, `target === "settings:mail"`);
		await openScreen(v);
		await waitFor(v, `document.querySelector('#app-sw [data-k="auto_draft"]')`);
		await run(v, `document.querySelector('#app-sw [data-k="use_here"]').click()`);
		await waitFor(v, `INTG.available.some(a => a.key === "mail" && a.off)`);
		expect(patches.at(-1)).toEqual({ app: "mail", values: { use_here: false } });
		await closeScreen(v);
		await run(v, `go("monitoring")`);
		await waitFor(v, `document.querySelector('#mon-side [data-k="add-app"]') && !document.querySelector('#mon-side [data-k="i:mail"]')`);
		await run(v, `asAdd("mail")`);
		await waitFor(v, `INTG.items.some(i => i.key === "mail") && !INTG.available.some(a => a.key === "mail")`);
		expect(readAppOff(data).has("mail")).toBe(false);
	});

	test("a peer's mail stays in the list while this computer's own mail is off, labeled with the machine", async () => {
		const peer = (off: boolean) => q<{ apps: number; mails: number; pc: string }>(v, `
			INTG.available = ${off ? '[{ key: "mail", label: "메일", off: true, conv: ["mail:"] }]' : "[]"};
			CONV.set("mail:shared-1", { ts: "2026-10-23T03:00:00.000Z", text: "견적 문의" });
			PQ.of.delete("mail:shared-1");
			PQ.list = [{ name: "Mac mini", url: "http://mini.example", online: true, items: { monitors: [], notices: [], conversations: [{ target: "mail:shared-1", unread: 1, read: null, last: { ts: "2026-10-23T03:00:00.000Z", text: "견적 문의" }, mail: { subject: "견적 문의", from: "a@example.com" } }],
				integrations: [{ key: "mail", label: "메일", icon: "mail", conv: ["mail:"], unread: 1, notices: [], needs: { drafts: 0, unread: 1, sentToday: 0 } }] } }];
			const it = pqMerge([]).find(i => i.pc && i.app);
			return { apps: it ? 1 : 0, mails: it ? it.mails.length : 0, pc: it ? it.pc.name : "" };`);
		expect(await peer(true)).toEqual({ apps: 1, mails: 1, pc: "Mac mini" });
		expect(await peer(false)).toEqual({ apps: 1, mails: 0, pc: "Mac mini" });
	});
});
