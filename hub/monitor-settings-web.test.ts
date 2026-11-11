import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSettings, writeSettings } from "./app-settings.ts";
import { paths } from "./config.ts";
import { readWatchSettings, writeWatchSettings } from "./watch-settings.ts";
import { addWatch, allWatches, removeWatch, startWatches } from "./watch.ts";
import { fakeHub, inbox, json, run, waitFor, type View } from "./test-web.ts";

// The settings conversation of an app and of a monitor (web/js/32-app-settings.js) in a headless Bun.WebView against a stub gateway whose settings
// routes call the real hub code: the control panel has the conversation's width, a monitor's switches PATCH, a change card writes only on 적용.
// Screenshots are written only when SETTINGS_SHOTS names a folder.
const SHOTS = process.env.SETTINGS_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "ms-web-"));
startWatches(() => {});
addWatch({ name: "t-web", command: "true", every_minutes: 60, on: "change", to: "alert", label: "웹 감시" }, "");
const stored = () => JSON.parse(readFileSync(paths.watches, "utf8")).find((w: { name: string }) => w.name === "t-web");

const ts = (m: number) => new Date(Date.UTC(2026, 9, 23, 3, m)).toISOString();
const PROPOSAL = { app: "w:t-web", changes: { every_minutes: 15, to: "chat" } };
const history = (target: string) => target === "settings:w:t-web" ? [
	{ ts: ts(1), kind: "message", source: "web", channel: target, author: "local", text: "15분마다로 하고 알림은 채팅으로 줘" },
	{ ts: ts(2), kind: "out", source: "orchestrator", target, text: `확인 간격과 알림 방식을 바꾸는 변경이에요.\n\`\`\`dotz-settings\n${JSON.stringify(PROPOSAL)}\n\`\`\`` },
] : [];

const sent = inbox<Record<string, unknown>>();
const patches = inbox<Record<string, unknown>>();
const deletes: string[] = [];
const hub = fakeHub({
	stream: "fake",
	api: async (req, url) => {
		const p = url.pathname;
		if (p === "/api/history") return json({ target: url.searchParams.get("target"), events: history(url.searchParams.get("target") ?? "") });
		if (p === "/api/activity") return json({ items: [], more: false, history: false });
		if (p === "/api/conversations") return json({ items: [] });
		if (p === "/api/notices") return json({ unread: 0, items: [] });
		if (p === "/api/monitors") return json({ items: [{ name: "웹 감시", watch: "t-web", kind: "watch", every: "60분마다", last_run: ts(0), next_run: ts(60), last_result: "ok" }] });
		if (p === "/api/integrations") return json({ items: [{ key: "mail", label: "메일", icon: "mail", kind: "app", conv: ["mail:"], notices: [], needs: { drafts: 0, unread: 0, sentToday: 0 }, ...(mailDown ? { state: "disconnected", since: ts(-600), hint: DOWN } : { state: "connected" }) }] });
		if (p === "/api/kakao/rooms") return json({ on: true, rooms: [] });
		const m = /^\/api\/(?:integrations|watches)\/([a-z0-9-]+)\/settings$/.exec(p), isWatch = p.startsWith("/api/watches/");
		if (m) {
			try {
				if (req.method === "PATCH") {
					const b = (await req.json()) as { values: unknown };
					patches.push({ app: isWatch ? `w:${m[1]}` : m[1], values: b.values });
					return json({ key: m[1], fields: isWatch ? writeWatchSettings(m[1]!, b.values) : writeSettings(data, m[1]!, b.values) });
				}
				return json({ key: m[1], fields: isWatch ? readWatchSettings(m[1]!) : readSettings(data, m[1]!) });
			} catch (e) {
				return json({ error: (e as Error).message }, 400);
			}
		}
		if (req.method === "DELETE" && /^\/api\/watches\/[a-z0-9-]+$/.test(p)) { deletes.push(p); return json({ ok: true }); }
		if (p === "/api/message") { sent.push((await req.json()) as Record<string, unknown>); return json({ ok: true }); }
	},
});

const open = (width: number, height: number): Promise<View> => hub.view({ width, height });
afterAll(() => { hub.stop(); rmSync(data, { recursive: true, force: true }); for (const w of allWatches()) removeWatch(w.id); });

const q = async <T = unknown>(v: View, code: string): Promise<T> => JSON.parse((await v.evaluate(`JSON.stringify((() => { ${code} })())`)) as string) as T;
const shot = async (v: View, name: string) => { if (!SHOTS) return; await waitFor(v, `document.getAnimations().every(a => a.playState !== "running")`); await Bun.write(join(SHOTS, name), await v.screenshot()); };
const boot = async (v: View, route: string) => {
	const opened = hub.nextStream();
	await v.navigate(`${hub.origin}/`);
	await opened;
	await waitFor(v, `typeof NT !== "undefined" && NT.loaded && NM.loaded && S`);
	await run(v, `if (dotzTheme.get() === "dark") dotzTheme.toggle()`);
	await run(v, `go("monitoring", ${JSON.stringify(route)})`);
};
// The company webmail's login died long ago (hub/watch-status.ts): the row says so, not "확인할 것 없어요".
let mailDown = false;
const DOWN = "연결 끊김 · 10월 23일 21:29부터 · 다시 로그인 필요";

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
// The conversation is chat only; the panel in the open screen fits the viewport.
const frame = (v: View) => q<{ sw: number; tl: number; swL: number; vw: number; inScreen: boolean }>(v, `const a = document.querySelector("#app-sw").getBoundingClientRect(), b = document.querySelector("#tl").getBoundingClientRect(); return { sw: a.width, tl: b.width, swL: a.left, vw: innerWidth, inScreen: !!document.querySelector(".as-screen #app-sw") }`);
const expectScreenFits = async (v: View) => {
	expect(await q(v, `return document.querySelector("#app-sw")`)).toBe(null);
	await openScreen(v);
	const f = await frame(v);
	expect(f.inScreen).toBe(true);
	expect(f.swL).toBeGreaterThanOrEqual(0);
	expect(f.sw).toBeGreaterThan(0);
	expect(f.sw).toBeLessThanOrEqual(f.vw);
	expect(await q<number>(v, `return document.querySelector("#app-sw").scrollWidth`)).toBeLessThanOrEqual(f.vw);
	await closeScreen(v);
	return f;
};

describe("the control panel has the conversation's width (app and monitor settings)", () => {
	for (const [label, w, h] of [["desktop", 1280, 800], ["fold", 880, 900], ["phone", 390, 844]] as const) {
		test(`${label} ${w}px`, async () => {
			const v = await open(w, h);
			await boot(v, "c:settings:mail");
			await waitFor(v, `target === "settings:mail" && document.querySelector("#tl")`);
			await expectScreenFits(v);
			await run(v, `go("monitoring", "c:settings:w:t-web")`);
			await waitFor(v, `target === "settings:w:t-web" && document.querySelector("#tl .as-card")`);
			const tl = await q<number>(v, `return document.querySelector("#tl").getBoundingClientRect().width`);
			expect(tl).toBeGreaterThan(300);
			await expectScreenFits(v);
			await openScreen(v);
			await waitFor(v, `document.querySelector('#app-sw [data-k="every_minutes"]')`);
			await shot(v, `monitor-settings-${label}-${w}.png`);
			await closeScreen(v);
		});
	}
});

describe("monitor settings at desktop width", async () => {
	const v = await open(1280, 800);

	test("a status block drops a watch's raw command but keeps a plain last result", async () => {
		await boot(v, "m:웹 감시");
		const facts = (out: string) => q<string>(v, `return monStatNode({ name: "t", last_output: ${JSON.stringify(out)} }).textContent`);
		expect(await facts("ssh -o BatchMode=yes host uptime")).not.toContain("BatchMode");
		expect(await facts("재고 3개")).toContain("재고 3개");
	});
	test("a monitor's header has a 설정 button that opens its settings conversation with the controls", async () => {
		await boot(v, "m:웹 감시");
		await waitFor(v, `document.querySelector("#mon-head .as-hd")`);
		expect(await q(v, `return document.querySelectorAll(".as-pin").length`)).toBe(0);
		await shot(v, "monitor-pinned-row-desktop.png");
		await run(v, `document.querySelector("#mon-head .as-hd").click()`);
		await waitFor(v, `target === "settings:w:t-web"`);
		await openScreen(v);
		await waitFor(v, `document.querySelector('#app-sw [data-k="enabled"]')`);
		const names = await q<string[]>(v, `return [...document.querySelectorAll("#app-sw .as-row:not(.as-stat) .as-n")].map(n => n.textContent)`);
		expect(names).toEqual(["알림 방식", "새 소식 알림", "휴대폰 알림", "감시 켜기", "감시 주기(분)", "이름", "감시 삭제"]);
		await shot(v, "monitor-controls-desktop.png");
	});

	test("the switch and the boxes PATCH the one watch settings route with no message to the bot", async () => {
		await run(v, `document.querySelector('#app-sw [data-k="enabled"]').click()`);
		await waitFor(v, `document.querySelector('#app-sw [data-k="enabled"]').getAttribute("aria-checked") === "false"`);
		expect(patches).toEqual([{ app: "w:t-web", values: { enabled: false } }]);
		expect(stored().paused).toBe(true);
		await run(v, `const i = document.querySelector('#app-sw [data-k="every_minutes"]'); i.value = "30"; i.dispatchEvent(new Event("change"))`);
		await waitFor(v, `document.querySelector('#app-sw [data-k="every_minutes"]').value === "30" && AS.by["w:t-web"].find(f => f.key === "every_minutes").value === 30`);
		expect(patches[1]).toEqual({ app: "w:t-web", values: { every_minutes: 30 } });
		expect(stored().every_minutes).toBe(30);
		await run(v, `document.querySelector('#app-sw [data-k="to"]').click()`);
		await waitFor(v, `document.querySelector(".menu .mi")`);
		await run(v, `document.querySelectorAll(".menu .mi")[AS.by["w:t-web"].find(f => f.key === "to").options.indexOf("chat")].click()`);
		await waitFor(v, `AS.by["w:t-web"].find(f => f.key === "to").value === "chat"`);
		expect(stored().to).toBe("chat");
		expect(sent).toEqual([]);
	});

	test("a bad number is refused by the route and the box shows the stored value again", async () => {
		const before = stored().every_minutes;
		await run(v, `const i = document.querySelector('#app-sw [data-k="every_minutes"]'); i.value = "0"; i.dispatchEvent(new Event("change"))`);
		await waitFor(v, `document.querySelector('#app-sw [data-k="every_minutes"]').value === "${before}"`);
		expect(stored().every_minutes).toBe(before);
		await closeScreen(v);
	});

	test("an answer with a dotz-settings block is a change card; nothing is written until 적용", async () => {
		await run(v, `localStorage.removeItem("dotz.settings.cards"); AS.done = {}; renderAll()`);
		await waitFor(v, `document.querySelector('#tl .as-card [data-as="apply"]')`);
		const card = await q<{ rows: string[]; buttons: string[] }>(v, `const c = document.querySelector("#tl .as-card"); return { rows: [...c.querySelectorAll(".as-cr")].map(r => r.textContent), buttons: [...c.querySelectorAll("button")].map(b => b.textContent) }`);
		expect(card.buttons).toEqual(["적용", "취소"]);
		expect(card.rows.some(r => r.includes("감시 주기") && r.includes("30 → 15"))).toBe(true);
		const before = patches.length;
		expect(stored().every_minutes).toBe(30);
		// A proposal that is not applied yet has done nothing: the head must not read 완료 (11-todo-strip.js asks asProposalPending).
		expect(await q(v, `const b = "\`\`\`dotz-settings\\n" + JSON.stringify({ app: "w:t-web", changes: { every_minutes: 15 } }) + "\\n\`\`\`"; return [asProposalPending(b), asProposalPending("그렇게 했어요")]`)).toEqual([true, false]);
		await shot(v, "monitor-settings-desktop.png");
		await run(v, `document.querySelector('#tl .as-card [data-as="apply"]').click()`);
		await waitFor(v, `document.querySelector("#tl .as-done.applied")`);
		expect(patches.length).toBe(before + 1);
		expect(patches.at(-1)).toEqual({ app: "w:t-web", values: PROPOSAL.changes });
		expect(stored()).toMatchObject({ every_minutes: 15, to: "chat" });
	});

	test("a card the owner cancels writes nothing; the composer sends settings:w:<name> to the orchestrator", async () => {
		await run(v, `localStorage.removeItem("dotz.settings.cards"); AS.done = {}; renderAll()`);
		await waitFor(v, `document.querySelector('#tl .as-card [data-as="cancel"]')`);
		const before = patches.length;
		await run(v, `document.querySelector('#tl .as-card [data-as="cancel"]').click()`);
		await waitFor(v, `document.querySelector("#tl .as-done.cancelled")`);
		expect(patches.length).toBe(before);
		await run(v, `ta.value = "밤에는 확인하지 마"; sendChat()`);
		await sent.until(() => !(!sent.length));
		expect(sent[0]).toMatchObject({ text: "밤에는 확인하지 마", settings: "w:t-web" });
	});
});

for (const [w, h] of [[390, 844], [1280, 800]] as const) test(`a disconnected app's row says 연결 끊김 with since when, whatever its counts (${w}px)`, async () => {
	mailDown = true;
	const v = await open(w, h);
	try {
		await boot(v, "list");
		await waitFor(v, `[...document.querySelectorAll("body *")].some(n => !n.childElementCount && n.textContent === ${JSON.stringify(DOWN)})`);
	} finally {
		mailDown = false;
	}
});


test("감시 삭제 in a monitor's settings asks first, then deletes the watch and leaves the screen", async () => {
	const v = await open(1280, 800);
	await boot(v, "m:웹 감시");
	await openScreen(v);
	await waitFor(v, `document.querySelector('#app-sw [data-as-rm="ask"]')`);
	await run(v, `document.querySelector('#app-sw [data-as-rm="ask"]').click()`);
	await waitFor(v, `document.querySelector("#app-sw .as-rm")`);
	expect(await q(v, `return document.querySelector("#app-sw .as-rm .as-n").textContent`)).toBe("웹 감시을(를) 삭제할까요?");
	expect(deletes).toEqual([]);
	await run(v, `document.querySelector('#app-sw [data-as-rm="go"]').click()`);
	await waitFor(v, `!document.querySelector("#app-sw")`);
	expect(deletes).toEqual(["/api/watches/t-web"]);
});
