import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { listMonitors } from "./monitors.ts";
import { readScheduleSettings, writeScheduleSettings } from "./schedule-settings.ts";
import { addSchedule, listSchedules, removeSchedule, startSchedules } from "./schedule.ts";
import { readWatchSettings, writeWatchSettings } from "./watch-settings.ts";
import { addWatch, allWatches, removeWatch, startWatches } from "./watch.ts";
import { fakeHub, inbox, json, run, waitFor, type View } from "./test-web.ts";

// A schedule row of 일반 모니터링 gets the watch row's ⋯ and the same settings screen (web/js/32-app-settings.js asScreen), in a headless
// Bun.WebView against a stub gateway whose monitor and settings routes call the real hub code. Screenshots only when SETTINGS_SHOTS names a folder.
const SHOTS = process.env.SETTINGS_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
startWatches(() => {});
startSchedules(() => {});
addWatch({ name: "t-cmp", command: "true", every_minutes: 60, on: "change", to: "alert", label: "비교 감시" }, "");
const sched = addSchedule({ text: "ch:123 아침 보고 써 줘", in_minutes: 90, every_minutes: 1440 });

const patches = inbox<{ app: string; values: unknown }>();
const deletes: string[] = [];
const nth = (n: number) => patches.until(x => x.length >= n, 10_000, `PATCH ${n}`).then(x => x[n - 1]);
const hub = fakeHub({
	stream: "fake",
	api: async (req, url) => {
		const p = url.pathname;
		if (p === "/api/history") return json({ target: url.searchParams.get("target"), events: [] });
		if (p === "/api/activity") return json({ items: [], more: false, history: false });
		if (p === "/api/conversations") return json({ items: [] });
		if (p === "/api/notices") return json({ unread: 0, items: [] });
		if (p === "/api/monitors") return json({ items: listMonitors() });
		if (p === "/api/integrations") return json({ items: [] });
		const m = /^\/api\/(watches|schedules)\/([a-z0-9-]+)\/settings$/.exec(p);
		if (m) {
			const [, kind, id] = m as unknown as [string, string, string], w = kind === "watches";
			try {
				if (req.method === "PATCH") {
					const { values } = (await req.json()) as { values: unknown };
					patches.push({ app: `${w ? "w" : "s"}:${id}`, values });
					return json({ fields: w ? writeWatchSettings(id, values) : writeScheduleSettings(id, values) });
				}
				return json({ fields: w ? readWatchSettings(id) : readScheduleSettings(id) });
			} catch (e) {
				return json({ error: (e as Error).message }, 400);
			}
		}
		if (req.method === "DELETE" && p.startsWith("/api/schedules/")) { deletes.push(p); removeSchedule(p.split("/").pop()!); return json({ ok: true }); }
	},
});
afterAll(() => { hub.stop(); for (const w of allWatches()) removeWatch(w.id); for (const s of listSchedules()) removeSchedule(s.id); });

const q = async <T = unknown>(v: View, code: string): Promise<T> => JSON.parse((await v.evaluate(`JSON.stringify((() => { ${code} })())`)) as string) as T;
// A screen slides in: the picture waits until no animation runs.
const shot = async (v: View, name: string) => { if (!SHOTS) return; await waitFor(v, `document.getAnimations().every(a => a.playState !== "running")`); await Bun.write(join(SHOTS, name), await v.screenshot()); };
const boot = async (v: View, route: string) => {
	const opened = hub.nextStream();
	await v.navigate(`${hub.origin}/`);
	await opened;
	await waitFor(v, `typeof NT !== "undefined" && NT.loaded && NM.loaded && S`);
	await run(v, `if (dotzTheme.get() === "dark") dotzTheme.toggle()`);
	await run(v, `go("monitoring", ${JSON.stringify(route)})`);
};
const more = (app: string) => `[...document.querySelectorAll("[data-as-more]")].find(b => b.offsetParent && !b.hidden && b.dataset.asMore === ${JSON.stringify(app)})`;
const openScreen = async (v: View, app: string) => {
	await waitFor(v, more(app));
	await run(v, `${more(app)}.click()`);
	await waitFor(v, `document.querySelector("#app-sw .as-row:not(.as-stat)")`);
};
const closeScreen = async (v: View) => {
	await run(v, `const b = document.querySelector('[data-k="as-back"]'); if (b) b.click()`);
	await waitFor(v, `!document.querySelector("#app-sw")`);
};
const rowNames = (v: View) => q<string[]>(v, `return [...document.querySelectorAll("#app-sw .as-row:not(.as-stat) .as-n")].map(n => n.textContent)`);
const sections = (v: View) => q<string[]>(v, `return [...document.querySelectorAll("#app-sw .as-sec")].map(n => n.textContent)`);
const S_APP = `s:${sched.id}`;

describe("a schedule row has the watch row's ⋯ and settings screen", () => {
	for (const [label, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
		test(`${label} ${w}px: ⋯ only (no inline 일시정지 / 삭제, no 대화), the same screen and sections as a watch`, async () => {
			const v = await hub.view({ width: w, height: h });
			await boot(v, "m:비교 감시");
			await waitFor(v, more("w:t-cmp"));
			await shot(v, `watch-row-${label}-${w}.png`);
			await openScreen(v, "w:t-cmp");
			const watchSecs = await sections(v);
			await shot(v, `watch-settings-${label}-${w}.png`);
			await closeScreen(v);

			await run(v, `go("monitoring", "m:아침 보고 써 줘")`);
			await waitFor(v, more(S_APP));
			expect(await q(v, `return document.querySelectorAll(".mon-sched").length`)).toBe(0);
			expect(await q(v, `return [...document.querySelectorAll("[data-as-open]")].filter(b => b.offsetParent && !b.hidden).length`)).toBe(0);
			await shot(v, `schedule-row-${label}-${w}.png`);
			await openScreen(v, S_APP);
			expect(await rowNames(v)).toEqual(["예약 켜기", "다음 실행", "반복 주기", "내용", "예약 삭제"]);
			expect(await sections(v)).toEqual(watchSecs.filter(s => s !== "알림"));
			const stat = await q<string>(v, `return document.querySelector("#app-sw .as-stat").textContent`);
			expect(stat).toContain("아침 보고 써 줘");
			expect(stat).toContain("반복 1일마다");
			expect(stat).toContain("보낼 곳");
			expect(await q(v, `return document.querySelector('#app-sw [data-k="text"]').value`)).toBe("아침 보고 써 줘");
			expect(await q<number>(v, `return document.querySelector("#app-sw").scrollWidth`)).toBeLessThanOrEqual(w);
			await shot(v, `schedule-settings-${label}-${w}.png`);
			await closeScreen(v);
		});
	}
});

describe("the screen edits the schedule through its one settings route", async () => {
	const v = await hub.view({ width: 1280, height: 800 });
	test("예약 켜기, 반복 주기 and 내용 PATCH s:<id>; the internal target stays", async () => {
		await boot(v, "m:아침 보고 써 줘");
		await openScreen(v, S_APP);
		const got = nth(1);
		await run(v, `document.querySelector('#app-sw [data-k="enabled"]').click()`);
		expect(await got).toEqual({ app: S_APP, values: { enabled: false } });
		expect(listSchedules()[0]!.paused).toBe(true);
		await waitFor(v, `!AS.busy[${JSON.stringify(S_APP)}] && document.querySelector('#app-sw [data-k="every_minutes"]')`);
		const every = nth(2);
		await run(v, `const i = document.querySelector('#app-sw [data-k="every_minutes"]'); i.value = "60"; i.dispatchEvent(new Event("change"))`);
		expect(await every).toEqual({ app: S_APP, values: { every_minutes: 60 } });
		await waitFor(v, `!AS.busy[${JSON.stringify(S_APP)}] && document.querySelector('#app-sw [data-k="every_minutes"]')`);
		const text = nth(3);
		await run(v, `const i = document.querySelector('#app-sw [data-k="text"]'); i.value = "저녁 보고 써 줘"; i.dispatchEvent(new Event("change"))`);
		expect(await text).toEqual({ app: S_APP, values: { text: "저녁 보고 써 줘" } });
		expect(listSchedules()[0]).toMatchObject({ text: "ch:123 저녁 보고 써 줘", every_minutes: 60 });
	});
	test("예약 삭제 asks first with the watch's confirm, then DELETE /api/schedules/<id>", async () => {
		await waitFor(v, `document.querySelector('#app-sw [data-as-rm="ask"]')`);
		await run(v, `document.querySelector('#app-sw [data-as-rm="ask"]').click()`);
		await waitFor(v, `document.querySelector('#app-sw [data-as-rm="go"]')`);
		expect(deletes).toEqual([]);
		await shot(v, "schedule-delete-confirm-desktop-1280.png");
		await run(v, `document.querySelector('#app-sw [data-as-rm="go"]').click()`);
		await waitFor(v, `!document.querySelector("#app-sw")`);
		expect(deletes).toEqual([`/api/schedules/${sched.id}`]);
	});
});
