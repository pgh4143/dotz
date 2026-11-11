import { afterAll, afterEach, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { painted, startDemoServer, waitFor, type View } from "./layout-measure.ts";

// Geometry and value checks for the plain bugs a full golden-rule pass found, one group per shared cause. Each opens the real page on the demo server
// (fake data only) in a headless Bun.WebView and measures rects or computed values, never copy. Screenshots are written only when SURFACE_SHOTS names a
// folder (SURFACE_PREFIX = before | after).
const SHOTS = process.env.SURFACE_SHOTS;
const PREFIX = process.env.SURFACE_PREFIX ?? "after";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const NAME = "서울 한가운데 있는 아주 오래된 가짜 회사 이름을 일부러 한 줄이 넘도록 길게 적은 이름이에요 그래서 줄이 바뀌어야 해요";
const TOKEN = "가나다라마바사아자차카타파하".repeat(7) + "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz";

const server = startDemoServer({ now: Date.UTC(2026, 10, 9, 3) });
const views: View[] = [];
afterEach(() => { for (const v of views.splice(0)) v.close(); });
afterAll(() => { for (const v of views) v.close(); server.stop(); });

const q = async <T = unknown>(v: View, code: string): Promise<T> => JSON.parse((await v.evaluate(`JSON.stringify((() => { ${code} })())`)) as string) as T;
const shot = async (v: View, name: string) => {
	if (!SHOTS) return;
	await painted(v);
	await Bun.write(join(SHOTS, `${PREFIX}-${name}.png`), await v.screenshot());
};
// The demo page at a width and theme, then `open` (a page-side statement) and a `ready` expression to wait on.
const page = async (width: number, theme: "light" | "dark", open: string, ready: string): Promise<View> => {
	const v = new Bun.WebView({ width, height: width < 600 ? 844 : 800 });
	views.push(v);
	await v.navigate(`${server.origin}/?lm=${Math.random().toString(36).slice(2)}#home`);
	await waitFor(v, `typeof S !== "undefined" && S && typeof target === "string" && CV.loaded && NT.loaded`);
	await v.evaluate(`(() => { localStorage.setItem("dotz-theme", ${JSON.stringify(theme)}); document.documentElement.dataset.theme = ${JSON.stringify(theme)}; return 0; })()`);
	await v.evaluate(`void (${open})`);
	await waitFor(v, ready);
	await painted(v);
	return v;
};

/* 1. menu item secondary text (.mi .ml small) */
const MENU_ITEMS = JSON.stringify([{ value: "a", label: NAME, sub: NAME }, { value: "b", label: TOKEN, sub: "설명" }, { value: "c", label: "셋째 항목", sub: TOKEN }, { value: "d", label: "넷째 항목" }]);
const openMenu = (w: number, theme: "light" | "dark") => page(w, theme, `showMenu($("#title"), ${MENU_ITEMS}, { onPick() {} })`, `document.querySelectorAll(".menu .mi").length === 4`);
type MenuGeo = { items: { label: number; smallIn: boolean; overlap: boolean; under: boolean; left: boolean }[] };
const menuGeo = (v: View) => q<MenuGeo>(v, `
	const menu = document.querySelector(".menu"), mr = menu.getBoundingClientRect();
	const items = [...menu.querySelectorAll(".mi")].map(mi => {
		const ml = mi.querySelector(".ml"), small = ml.querySelector("small");
		const rng = document.createRange(); rng.selectNodeContents(ml.firstChild);
		const lines = [...rng.getClientRects()], widest = Math.max(...lines.map(r => r.width));
		if (!small) return { label: widest, smallIn: true, overlap: false, under: false, left: true };
		const s = small.getBoundingClientRect();
		const under = s.top >= Math.max(...lines.map(r => r.bottom)) - 1;   // pushed to a line of its own under the label
		return { label: widest, under, left: !under || Math.abs(s.left - lines[0].left) <= 1, smallIn: s.left >= mr.left - 1 && s.right <= mr.right + 1 && s.right <= innerWidth + 1,
			overlap: lines.some(r => r.left < s.right - 1 && r.right > s.left + 1 && r.top < s.bottom - 1 && r.bottom > s.top + 1) };
	});
	return { items };`);
test("390px: a menu item with long secondary text keeps its label readable, clear of the secondary text and inside the menu", async () => {
	const v = await openMenu(390, "light");
	await shot(v, "1-menu-long");
	const g = await menuGeo(v);
	expect(g.items.map(i => i.smallIn)).toEqual([true, true, true, true]);
	expect(g.items.map(i => i.overlap)).toEqual([false, false, false, false]);
	expect(g.items.map(i => i.label >= 48)).toEqual([true, true, true, true]);
	// secondary text that drops under its label starts where the label starts, not at the far right edge
	expect(g.items.some(i => i.under)).toBe(true);
	expect(g.items.map(i => i.left)).toEqual([true, true, true, true]);
});
const ratio = (v: View) => q<{ small: number; hover: number }>(v, `
	const probe = document.createElement("i"); document.body.append(probe);
	const rgb = c => { probe.style.color = c; const m = getComputedStyle(probe).color.match(/[\\d.]+/g).map(Number); return m; };
	const lum = ([r, g, b]) => { const f = x => { x /= 255; return x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
	const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + .05) / (y + .05); };
	const menu = document.querySelector(".menu"), fg = rgb(getComputedStyle(menu.querySelector(".ml small")).color);
	const row = (bg) => cr(fg, rgb(bg));
	const out = { small: row(getComputedStyle(menu).backgroundColor), hover: row(getComputedStyle(menu).getPropertyValue("--hover")) };
	probe.remove(); return out;`);
test("390px dark: the secondary text of a menu item reaches 4.5:1 on the menu and on a hovered or focused item", async () => {
	const v = await openMenu(390, "dark");
	await shot(v, "1-menu-dark");
	const c = await ratio(v);
	expect(c.small).toBeGreaterThanOrEqual(4.5);
	expect(c.hover).toBeGreaterThanOrEqual(4.5);
});

const openList = (w: number) => page(w, "light", `go("chat", "list")`, `document.querySelectorAll("#v-chat .cv-row .cv-t").length >= 2`);
test("390px: a conversation row whose time cell is very long keeps its title readable and the time cell inside the row", async () => {
	const v = await openList(390);
	await v.evaluate(`void document.querySelectorAll("#v-chat .cv-row .cv-t").forEach(t => { t.textContent = ${JSON.stringify(TOKEN)}; })`);
	await painted(v);
	await shot(v, "2-row-long-time");
	const rows = await q<{ title: number; cellOut: number }[]>(v, `
		return [...document.querySelectorAll("#v-chat .cv-row")].filter(r => r.querySelector(".cv-t") && r.offsetWidth).map(r => {
			const rr = r.getBoundingClientRect(), m = r.querySelector(".cv-m").getBoundingClientRect(), b = r.querySelector(".cv-b").getBoundingClientRect();
			return { title: Math.round(b.width), cellOut: Math.round(Math.max(0, m.right - rr.right)) };
		});`);
	expect(rows.length).toBeGreaterThan(1);
	expect(rows.filter(r => r.title < 96 || r.cellOut > 0).length).toBe(0);
});

const openToast = (theme: "light" | "dark", msg: string) => page(390, theme, `toast(${JSON.stringify(msg)}, true, { label: "다시 시도", onclick() {} })`, `!!document.querySelector(".snack .sa")`);
test("390px: a toast with a very long message stays inside the screen and its text clears the action button", async () => {
	const v = await openToast("light", TOKEN);
	await shot(v, "3-toast-long");
	const g = await q<{ left: number; right: number; textRight: number; btnLeft: number }>(v, `
		const s = document.querySelector(".snack").getBoundingClientRect(), t = document.querySelector(".snack > span").getBoundingClientRect(), b = document.querySelector(".snack .sa").getBoundingClientRect();
		return { left: s.left, right: s.right, textRight: t.right, btnLeft: b.left };`);
	expect(g.left).toBeGreaterThanOrEqual(0);
	expect(g.right).toBeLessThanOrEqual(390);
	expect(g.textRight).toBeLessThanOrEqual(g.btnLeft + 0.5);
});
test("390px dark: a toast is a dark surface with readable text, not a bright patch", async () => {
	const v = await openToast("dark", "저장하지 못했어요");
	await shot(v, "3-toast-dark");
	const g = await q<{ lum: number; cr: number }>(v, `
		const probe = document.createElement("i"); document.body.append(probe);
		const rgb = c => { probe.style.color = c; return getComputedStyle(probe).color.match(/[\\d.]+/g).map(Number); };
		const lum = ([r, g, b]) => { const f = x => { x /= 255; return x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
		const cs = getComputedStyle(document.querySelector(".snack")), bg = lum(rgb(cs.backgroundColor)), fg = lum(rgb(cs.color));
		probe.remove();
		return { lum: bg, cr: (Math.max(bg, fg) + .05) / (Math.min(bg, fg) + .05) };`);
	expect(g.lum).toBeLessThan(0.6);
	expect(g.cr).toBeGreaterThanOrEqual(4.5);
});

const headGeo = (v: View) => q<{ title: number; head: number; closeRight: number; closeBottom: number }>(v, `
	const hd = document.querySelector(".fs-card .fs-hd").getBoundingClientRect(), x = document.querySelector(".fs-card .fs-x").getBoundingClientRect(), t = document.querySelector(".fs-card .fs-tt").getBoundingClientRect();
	return { title: Math.round(t.width), head: Math.round(hd.height), closeRight: Math.round(x.right), closeBottom: Math.round(x.bottom) };`);
const headOk = (g: { title: number; head: number; closeRight: number; closeBottom: number }) => { expect(g.title).toBeGreaterThanOrEqual(96); expect(g.head).toBeLessThan(160); expect(g.closeRight).toBeLessThanOrEqual(390); expect(g.closeBottom).toBeLessThan(844); };
test("390px: a sheet whose header buttons carry very long labels keeps its title readable and its close button on screen (notice sheet)", async () => {
	const v = await page(390, "light", `go("notices")`, `NT.loaded && NT.items && NT.items.length > 0`);
	await v.evaluate(`void ntSheetShow(NT.items[0].id)`);
	await waitFor(v, `!!document.querySelector(".fs-card .fs-ign span")`);
	await v.evaluate(`void document.querySelectorAll(".fs-card .fs-hb > :not(.fs-x) span").forEach(s => { s.textContent = ${JSON.stringify(TOKEN)}; })`);
	await painted(v);
	await shot(v, "4-sheet-notice-long");
	headOk(await headGeo(v));
});
test("390px: the same holds for the triage sheet's list toggle", async () => {
	const v = await page(390, "light", `go("monitoring")`, `NM.loaded && TR.loaded`);
	await v.evaluate(`void (TR.groups = [{ key: "g1", label: "뉴스레터", count: 3, cards: [1, 2, 3].map(i => ({ to: "mail:m" + i, ref: "r" + i, question: "답장할까요?", draft: { body: "네, 알겠습니다" } })) }], trOpen("g1"))`);
	await waitFor(v, `!!document.querySelector(".fs-card .tr-tog span")`);
	await v.evaluate(`void document.querySelectorAll(".fs-card .fs-hb > :not(.fs-x) span").forEach(s => { s.textContent = ${JSON.stringify(TOKEN)}; })`);
	await painted(v);
	await shot(v, "4-sheet-triage-long");
	headOk(await headGeo(v));
});

test("the update state tolerates a last check that carries no version, and no on-screen note shows a <placeholder>", async () => {
	const v = await page(390, "light", `go("home")`, `typeof updState === "function" && typeof FC_NOTE === "object"`);
	const r = await q<{ threw: string; kept: boolean; placeholders: string[] }>(v, `
		let threw = "", kept = false;
		try { kept = updState({ lastCheck: { remoteHead: "abc" }, disk: { commit: { sha: "a" } } }).c !== null; } catch (e) { threw = String(e.message); }
		return { threw, kept, placeholders: Object.values(FC_NOTE).filter(t => /<[^>]+>/.test(t)) };`);
	expect(r.threw).toBe("");
	expect(r.kept).toBe(true);
	expect(r.placeholders).toEqual([]);
});

/* 6. a status shown as a word has its color dot right before it (the tag pattern: 6px --tone, or the .dot span) */
type Dot = { text: string; kind: string; w: number; h: number; round: boolean; painted: boolean; gap: number };
const dotsOf = (v: View, sel: string) => q<Dot[]>(v, `
	const rgba = c => c.match(/[\\d.]+/g).map(Number), clear = c => rgba(c).length > 3 && rgba(c)[3] === 0;
	return [...document.querySelectorAll(${JSON.stringify(sel)})].map(e => {
		const cs = getComputedStyle(e), b = getComputedStyle(e, "::before"), d = e.querySelector(":scope > .dot");
		const text = e.textContent.trim();
		if (d) { const s = getComputedStyle(d), r = d.getBoundingClientRect(), n = d.nextElementSibling ? d.nextElementSibling.getBoundingClientRect() : r;
			return { text, kind: "span", w: r.width, h: r.height, round: s.borderRadius === "50%", painted: !clear(s.backgroundColor), gap: Math.round((n.left - r.right) * 10) / 10 }; }
		if (b.content === "none") return { text, kind: "none", w: 0, h: 0, round: false, painted: false, gap: 99 };
		return { text, kind: "before", w: parseFloat(b.width), h: parseFloat(b.height), round: b.borderRadius === "50%", painted: !clear(b.backgroundColor), gap: parseFloat(cs.columnGap) || 99 };
	});`);
const hasDot = (d: Dot) => { expect(d.kind).not.toBe("none"); expect(d.w).toBeGreaterThanOrEqual(6); expect(d.w).toBeLessThanOrEqual(12); expect(d.h).toBe(d.w); expect(d.round).toBe(true); expect(d.painted).toBe(true); expect(d.gap).toBeLessThanOrEqual(8); };
test("390px: a running home row leads with a round accent dot and ends in its time, inside the screen", async () => {
	const ROW = '#home-cards .hn[data-k="running"] .hr:has(> .dot.pri)';
	const v = await page(390, "light", `go("home")`, `!!document.querySelector(${JSON.stringify(ROW)})`);
	await v.evaluate(`void document.querySelector(${JSON.stringify(ROW)}).scrollIntoView({ block: "center" })`);
	await shot(v, "6-home-pri");
	const dots = await dotsOf(v, ROW);
	expect(dots.length).toBeGreaterThan(0);
	// a row's lead dot sits a row gap before the name, so only its own shape is held here
	for (const d of dots) { expect(d.kind).toBe("span"); expect(d.w).toBeGreaterThanOrEqual(6); expect(d.w).toBeLessThanOrEqual(12); expect(d.h).toBe(d.w); expect(d.round).toBe(true); expect(d.painted).toBe(true); }
	const c = await q<{ dot: string; accent: string; words: string[]; right: number }>(v, `
		const rows = [...document.querySelectorAll(${JSON.stringify(ROW)})], probe = document.createElement("i"); probe.style.color = "var(--accent)"; document.body.append(probe);
		const accent = getComputedStyle(probe).color; probe.remove();
		return { dot: getComputedStyle(rows[0].querySelector(":scope > .dot")).backgroundColor, accent, words: rows.map(r => r.querySelector(":scope > .hs")?.textContent ?? ""),
			right: Math.max(...rows.map(r => Math.round(r.getBoundingClientRect().right))) };`);
	expect(c.dot).toBe(c.accent);
	// the dot says the row is running; the row's end is a time or nothing, never the state word again
	for (const w of c.words) expect(["진행 중", "작업 중"]).not.toContain(w);
	expect(c.right).toBeLessThanOrEqual(390);
});
test("390px: the chat task card's 완료 pill is a green dot plus the word, like 진행 중", async () => {
	const v = await page(390, "light", `go("chat", "main")`, `current === "chat" && CV.placed && document.querySelectorAll(".cv-task .ct-pill").length >= 2`);
	await v.evaluate(`void document.querySelector(".cv-task .ct-pill.ok").scrollIntoView({ block: "center" })`);
	await shot(v, "6-chat-pill");
	const dots = await dotsOf(v, ".cv-task .ct-pill");
	expect(dots.map(d => d.text)).toContain("완료");
	dots.forEach(hasDot);
	expect(await q<number>(v, `return document.querySelectorAll(".cv-task .ct-pill svg").length`)).toBe(0);
});
test("390px: the notices screen's 실패 tag is a word; the red lead dot of the row is the only dot", async () => {
	const v = await page(390, "light", `go("notices")`, `NT.loaded && !!document.querySelector("#v-notices .ln .tag")`);
	await shot(v, "6-notices-fail");
	const dots = (await dotsOf(v, "#v-notices .ln .tag")).filter(d => d.text === "실패");
	expect(dots.length).toBeGreaterThan(0);
	dots.forEach(d => expect(d.kind).toBe("none"));
});

/* 8. type sizes: 11-16 or 20-22px text, and a line at least 1.295 of its size */
const typeBad = (v: View, sel: string) => q<{ n: number; bad: string[] }>(v, `
	const els = [...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => e.getClientRects().length);
	const bad = els.map(e => { const c = getComputedStyle(e), fs = parseFloat(c.fontSize), ratio = c.lineHeight === "normal" ? 1.2 : parseFloat(c.lineHeight) / fs;
		return ((fs >= 11 && fs <= 16) || (fs >= 20 && fs <= 22)) && ratio >= 1.295 ? "" : e.tagName + "." + e.className + " " + fs + "px x" + Math.round(ratio * 100) / 100; }).filter(Boolean);
	return { n: els.length, bad };`);
const typeOk = async (v: View, sel: string) => { const r = await typeBad(v, sel); expect(r.n).toBeGreaterThan(0); expect(r.bad).toEqual([]); };
for (const w of [390, 1280]) {
	test(`${w}px: the apps tab title is a 20px title line, not 18px`, async () => {
		const v = await page(w, "light", `void (APPS_ON = true, go("apps", "memo"))`, `current === "apps" && !!document.querySelector("#v-apps .apps-n")`);
		await shot(v, `8-apps-title-${w}`);
		await typeOk(v, ".apps-n");
	});
}
test("390px: the terminal's 더 보기 button uses a listed size and a readable line", async () => {
	const v = await page(390, "light", `openShell()`, `!!document.querySelector(".sh-more")`);
	await shot(v, "8-shell-more");
	await typeOk(v, ".fs-hb .sh-more");
});
test("390px: the kakao hour and weekday axes use a listed size and a readable line", async () => {
	const k = await page(390, "light", `go("monitoring", "i:kakao")`, `KK.loaded && KK.rooms.length > 0`);
	await k.evaluate(`void (KK.open = "r1", KK.msgs = [{ authorId: "u1", sender: "정우", fromMe: false, text: "안녕" }], api = async () => ({ stats: { hours: Array.from({ length: 24 }, (_, i) => (i === 9 ? 3 : 0)), weekdays: [1, 0, 2, 0, 0, 0, 0] } }), kkPerson("u1"))`);
	await waitFor(k, `!!document.querySelector("dialog[open] .kk-hax")`);
	await shot(k, "8-kakao-axis");
	await typeOk(k, ".kk-hax span");
});
test("390px: the reply card's avatar letter and 초안 tag use a listed size and a readable line", async () => {
	const v = await page(390, "light", `go("monitoring", "i:mail")`, `NM.loaded && MON.sel === "i:mail"`);
	await waitFor(v, `!!document.querySelector(".rq-who .dr-st")`);
	// a mail draft's head carries the app's icon; a comment reply's head carries its writer's letter: the same head, drawn into this card to be measured
	await v.evaluate(`void document.querySelector("#mon-tl .rq.cm").prepend(rqHeadNode({ app: "youtube", who: "한서윤" }))`);
	await shot(v, "8-reply-avatar");
	await typeOk(v, ".rq-who .rq-av");
	await typeOk(v, ".rq-who .dr-st");
});
test("390px: the models add button reads at a listed size and line", async () => {
	const v = await page(390, "light", `go("models")`, `current === "models" && !!document.querySelector("#models .mt-use-row")`);
	await v.evaluate(`void openModels("orchestrator")`);   // the demo's rows name no place to change them; the screen still opens the assistant's editor
	await waitFor(v, `!!document.querySelector("#models .fb-add")`);
	await typeOk(v, "#models .fb-add");
});
test("390px: the update bar's x reads at a listed size and line", async () => {
	const v = await page(390, "light", `go("settings")`, `!!UPD.info`);
	await v.evaluate(`void (UPD.info.flow = { phase: "failed", id: "f1", at: new Date().toISOString(), text: "업데이트하지 못했어요" }, paintUpdBar())`);
	await waitFor(v, `!!document.querySelector("#upd-bar .x")`);
	await typeOk(v, "#upd-bar .x");
});
for (const w of [390, 1280]) {
	test(`${w}px: the triage sheet's question is a listed size`, async () => {
		const v = await page(w, "light", `go("monitoring")`, `NM.loaded && TR.loaded`);
		await v.evaluate(`void (TR.groups = [{ key: "g1", label: "뉴스레터", count: 3, cards: [1, 2, 3].map(i => ({ to: "mail:m" + i, ref: "r" + i, question: "답장할까요?", draft: { body: "네, 알겠습니다" } })) }], trOpen("g1"))`);
		await waitFor(v, `!!document.querySelector(".fs-card .tr-q > span")`);
		await shot(v, `8-triage-question-${w}`);
		await typeOk(v, ".fs-card .tr-q > span");
	});
}

/* settings first screen: two columns from 1100px, one column below with the same gap before every group title */
const SETTINGS_READY = `current === "settings" && document.querySelectorAll("#settings > .set-col").length === 2 && document.querySelectorAll("#settings .list").length >= 4`;
test("1280px: the settings first screen is two columns that start at one height and need no scroll", async () => {
	const v = await page(1280, "light", `go("settings")`, SETTINGS_READY);
	await shot(v, "settings-two-columns");
	const m = await q<{ cols: { top: number; left: number; right: number; secTop: number; n: number }[]; scroll: number[] }>(v, `
		const cols = [...document.querySelectorAll("#settings > .set-col")].map(e => { const b = e.getBoundingClientRect(), s = e.querySelector(".sec").getBoundingClientRect(); return { top: b.top, left: b.left, right: b.right, secTop: s.top, n: e.querySelectorAll(".sec").length }; });
		const v = document.querySelector(".views");
		return { cols, scroll: [v.scrollHeight, v.clientHeight, document.documentElement.scrollWidth, innerWidth] };`);
	expect(m.cols.length).toBe(2);
	expect(m.cols[0].top).toBe(m.cols[1].top);
	expect(m.cols[0].secTop).toBe(m.cols[1].secTop);
	expect(m.cols[1].left).toBeGreaterThanOrEqual(m.cols[0].right);
	expect(m.cols[1].right).toBeLessThanOrEqual(m.scroll[3]);
	expect(m.cols.every(c => c.n >= 2)).toBe(true);
	expect(m.scroll[0]).toBeLessThanOrEqual(m.scroll[1]);
	expect(m.scroll[2]).toBe(m.scroll[3]);
});
for (const w of [390, 1099]) {
	test(`${w}px: the settings first screen stays one column and every group title after the first has the same gap above it`, async () => {
		const v = await page(w, "light", `go("settings")`, SETTINGS_READY);
		const m = await q<{ lefts: number[]; widths: number[]; gaps: number[]; stacked: boolean }>(v, `
			const cols = [...document.querySelectorAll("#settings > .set-col")].map(e => e.getBoundingClientRect());
			const items = [...document.querySelectorAll("#settings .sec, #settings .list")].map(e => ({ sec: e.classList.contains("sec"), b: e.getBoundingClientRect() }));
			const gaps = items.map((x, i) => (x.sec && i > 0 ? x.b.top - items[i - 1].b.bottom : null)).filter(g => g !== null);
			return { lefts: cols.map(c => c.left), widths: cols.map(c => c.width), gaps, stacked: cols[1].top >= cols[0].bottom };`);
		expect(new Set(m.lefts).size).toBe(1);
		expect(new Set(m.widths).size).toBe(1);
		expect(m.stacked).toBe(true);
		expect(m.gaps.length).toBeGreaterThanOrEqual(3);
		expect(new Set(m.gaps).size).toBe(1);
		expect(m.gaps[0]).toBeGreaterThan(0);
	});
}
