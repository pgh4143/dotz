import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createIgDmWeb } from "./ig-dm-web.ts";
import { PERMISSION_LINE, type DmState } from "../features/youtube-instagram/lib/ig-dm.ts";
import { fakeHub, json, waitFor, run, type View } from "./test-web.ts";

// 모니터링 > 유튜브 (comments grouped by video: title, thumbnail, 영상 열기) and 모니터링 > 인스타그램 > DM (read only), run as shipped in a
// headless browser (Bun.WebView) against stubbed /api/comments/* and the real DM routes (hub/ig-dm-web.ts). Names and texts are placeholders.
// Screenshots are written only when YTIG_SHOTS names a folder.
const SHOTS = process.env.YTIG_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const at = (d: number, h: number, m: number) => Date.UTC(2026, 9, d, h, m);
const pic = (hue: number) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="hsl(${hue} 60% 55%)"/><circle cx="160" cy="90" r="30" fill="white" opacity=".8"/></svg>`)}`;
const THREADS = [
	{ source: "youtube", thread: "v1", kind: "youtube", title: "겨울 캠핑 장비 총정리", link: "https://www.youtube.com/watch?v=v1", thumb: pic(210), lastAt: at(22, 2, 0), lastText: "다음 주에 올릴게요", lastAuthor: "나", unread: 2, drafts: 1 },
	{ source: "youtube", thread: "v2", kind: "youtube", title: "라면 5분 완성 레시피", link: "https://www.youtube.com/watch?v=v2", thumb: pic(20), lastAt: at(22, 1, 0), lastText: "맛있어 보여요", lastAuthor: "가나", unread: 1, drafts: 0 },
	{ source: "youtube", thread: "v3", kind: "youtube", title: "브이로그 #12 제주 여행", link: "https://www.youtube.com/watch?v=v3", thumb: pic(140), lastAt: at(21, 5, 0), lastText: "또 가고 싶네요", lastAuthor: "다라", unread: 0, drafts: 0 },
];
const THREAD_VIEW = {
	source: { key: "youtube", kind: "youtube", label: "유튜브 댓글" },
	thread: { id: "v1", title: THREADS[0]!.title, link: THREADS[0]!.link, thumb: THREADS[0]!.thumb },
	comments: [
		{ id: "cm:youtube:c1", parent: null, author: "가나", text: "영상 잘 봤어요! 텐트는 어디 제품이에요?", at: at(22, 1, 0), mine: false, needsReply: true },
		{ id: "cm:youtube:c3", parent: "c1", author: "나", text: "다음 주에 올릴게요", at: at(22, 2, 0), mine: true, needsReply: false },
	],
	read: null,
	drafts: [],
	sends: [],
};

let dm: DmState;
let enabled = true;
let refreshes = 0;
let refreshWaiters: (() => void)[] = [];
const nextRefresh = (): Promise<void> => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("no refresh request")), 3500); refreshWaiters.push(() => { clearTimeout(t); res(); }); });
const msgs = (list: [string, boolean, string, number, string[]?][]) => list.map(([id, mine, text, t, attach]) => ({ id, mine, text, from: mine ? "owner_ig" : "fan", at: t, attach: attach ?? [] }));
const reset = () => {
	enabled = true;
	refreshes = 0;
	refreshWaiters = [];
	dm = {
		perm: "ok",
		convs: {
			c1: { id: "c1", peer: "camp_lover", updated: "1", lastAt: at(22, 4, 0), last: "(사진)", messages: msgs([["m1", false, "안녕하세요 <b>협찬</b> 문의드려요", at(22, 3, 0)], ["m2", true, "메일로 자세히 알려 주세요", at(22, 3, 30)], ["m3", false, "", at(22, 4, 0), ["image"]]]) },
			c2: { id: "c2", peer: "ramen_fan", updated: "1", lastAt: at(21, 9, 0), last: "레시피 감사합니다!", messages: msgs([["m4", false, "레시피 감사합니다!", at(21, 9, 0)]]) },
		},
	};
};
const dmWeb = createIgDmWeb({
	enabled: () => enabled,
	account: () => ({ id: "17841", username: "owner_ig" }),
	read: () => dm,
	sync: async () => { refreshes++; for (const w of refreshWaiters.splice(0)) w(); return { perm: dm.perm, fetched: 0 }; },
});

let app = "youtube";

const hub = fakeHub({
	stream: "fake",
	api: async (req, url) => {
		const p = url.pathname;
		if (p === "/api/history") return json({ target: url.searchParams.get("target"), events: [] });
		if (p === "/api/activity") return json({ items: [], more: false, history: false });
		if (p === "/api/conversations") return json({ items: [] });
		if (p === "/api/notices") return json({ unread: 0, items: [] });
		if (p === "/api/monitors") return json({ items: [] });
		if (p === "/api/integrations") return json({ items: [{ key: app, label: app === "youtube" ? "유튜브" : "인스타그램", icon: app, kind: "app", conv: [], notices: [], unread: 0, needs: { drafts: 0, unread: 0, sentToday: 0 } }] });
		if (p === "/api/comments/sources")
			return json({ on: true, sources: [{ key: app, kind: app, label: app === "youtube" ? "유튜브 댓글" : "인스타 댓글", watch: ["*"], autoDraft: false, autoSend: false, error: null, ranAt: at(22, 3, 0) }] });
		if (p === "/api/comments/threads") return json({ threads: app === "youtube" ? THREADS : [] });
		if (p === "/api/comments/thread/youtube/v1" && req.method === "GET") return json(THREAD_VIEW);
		if (p === "/api/comments/thread/youtube/v1/read") return json({ ok: true });
		const r = await dmWeb.route(req, url, p.split("/").filter(Boolean));
		if (r) return r;
	},
});

const open = (width: number, height: number): Promise<View> => hub.view({ width, height });
afterAll(() => { hub.stop(); });
beforeEach(reset);

const q = async <T = unknown>(v: View, code: string): Promise<T> => JSON.parse((await v.evaluate(`JSON.stringify((() => { ${code} })())`)) as string) as T;
const shot = async (v: View, name: string) => { if (SHOTS) await Bun.write(join(SHOTS, name), await v.screenshot()); };
const boot = async (v: View, which: "youtube" | "instagram") => {
	app = which;
	const opened = hub.nextStream();
	await v.navigate(`${hub.origin}/`);
	await opened;
	await waitFor(v, `typeof NT !== "undefined" && NT.loaded && S`);
	await run(v, `if (dotzTheme.get() === "dark") dotzTheme.toggle()`);
	await waitFor(v, `typeof CM !== "undefined" && CM.apps.has("${which}")`);
	await run(v, `go("monitoring", "i:${which}")`);
	await waitFor(v, `!$("#cm").hidden && document.querySelector("#cm .kk-row, #cm .kk-note")`);
};

describe("유튜브 댓글 grouped by video on a phone (390x844)", async () => {
	const v = await open(390, 844);

	test("each video is a row with its title and thumbnail, and its conversation starts with the video and 영상 열기", async () => {
		await boot(v, "youtube");
		await waitFor(v, `document.querySelectorAll("#cm .kk-row").length === 3`);
		const rows = await q<{ titles: string[]; thumbs: number; text: string }>(v, `return { titles: [...document.querySelectorAll("#cm .kk-row .cv-n")].map(n => n.textContent), thumbs: document.querySelectorAll("#cm .kk-row img.kk-thumb").length, text: document.querySelector("#cm-rooms").textContent }`);
		expect(rows.titles).toEqual(THREADS.map(t => t.title));
		expect(rows.thumbs).toBe(3);
		expect(rows.text).not.toContain("유튜브 영상");
		await shot(v, "youtube-comments-by-video-390.png");

		await run(v, `document.querySelector("#cm .kk-row").click()`);
		await waitFor(v, `CM.open && !CM.loading && document.querySelector("#cm .cm-post")`);
		const post = await q<{ title: string; link: string; href: string; img: boolean; overflow: boolean }>(v, `const p = document.querySelector("#cm .cm-post"); const a = p.querySelector("a"); return { title: p.querySelector(".cm-pt").textContent, link: a.textContent, href: a.href, img: !!p.querySelector("img.kk-thumb"), overflow: document.documentElement.scrollWidth > 390 }`);
		expect(post).toEqual({ title: THREADS[0]!.title, link: "영상 열기", href: THREADS[0]!.link, img: true, overflow: false });
		await shot(v, "youtube-comments-thread-390.png");
	});
});

describe("인스타 DM on a phone (390x844)", async () => {
	const v = await open(390, 844);

	test("the DM tab lists the conversations, opens the messages as text, and has no way to send", async () => {
		await boot(v, "instagram");
		await waitFor(v, `document.querySelector("#cm .cm-tabs")`);
		const refreshed = nextRefresh();
		await run(v, `document.querySelector('#cm .cm-tabs [data-tab="dm"]').click()`);
		await refreshed;
		await waitFor(v, `document.querySelectorAll("#cm .kk-row[data-conv]").length === 2 && !DM.busy`);
		expect(refreshes).toBe(1);
		const list = await q<{ peers: string[]; note: string }>(v, `return { peers: [...document.querySelectorAll("#cm .kk-row .cv-n")].map(n => n.textContent), note: document.querySelector("#cm .dm-note").textContent }`);
		expect(list.peers).toEqual(["camp_lover", "ramen_fan"]);
		expect(list.note).toContain("답장할 수 없어요");
		await shot(v, "instagram-dm-list-390.png");

		await run(v, `document.querySelector('#cm .kk-row[data-conv="c1"]').click()`);
		await waitFor(v, `DM.open && !DM.loading && document.querySelector("#cm .kk-m")`);
		// The messages are the KakaoTalk room's own bubbles; the title is the other person; the one line at the bottom replaces the composer.
		const chat = await q<{ bubbles: string[]; mine: number; xss: boolean; composer: boolean; overflow: boolean; ro: string; title: string }>(v, `return { bubbles: [...document.querySelectorAll("#cm .kk-bub")].map(b => b.textContent), mine: document.querySelectorAll("#cm .kk-m.me").length, xss: !!document.querySelector("#cm .kk-bub b"), composer: !document.querySelector("#cm-foot").hidden, overflow: document.documentElement.scrollWidth > 390, ro: document.querySelector("#dm-ro").hidden ? "" : document.querySelector("#dm-ro").textContent, title: document.querySelector("#cm-head .cv-n").textContent }`);
		expect(chat.bubbles).toEqual(["안녕하세요 <b>협찬</b> 문의드려요", "메일로 자세히 알려 주세요", "(사진)"]);
		expect(chat.mine).toBe(1);
		expect(chat.ro).toContain("답장할 수 없어요");
		expect(chat.title).toBe("camp_lover");
		expect(chat.xss).toBe(false);
		expect(chat.composer).toBe(false);
		expect(chat.overflow).toBe(false);
		await shot(v, "instagram-dm-chat-390.png");
	});

	test("a missing permission shows the Korean line instead of an empty list", async () => {
		dm = { perm: "missing", error: PERMISSION_LINE, convs: {} };
		await boot(v, "instagram");
		await waitFor(v, `document.querySelector("#cm .cm-tabs")`);
		await run(v, `document.querySelector('#cm .cm-tabs [data-tab="dm"]').click()`);
		await waitFor(v, `document.querySelector("#dm-perm")`);
		expect(await q<string>(v, `return document.querySelector("#dm-perm").textContent`)).toBe(PERMISSION_LINE);
		expect(await q<boolean>(v, `return !!document.querySelector("#dm-empty")`)).toBe(false);
	});
});

describe("DM routes", () => {
	test("with the feature off nothing is listed, read or refreshed", async () => {
		enabled = false;
		const get = (path: string, method = "GET") => dmWeb.route(new Request(`http://x${path}`, { method }), new URL(`http://x${path}`), path.split("/").filter(Boolean));
		expect(await (await get("/api/ig-dm"))!.json()).toEqual({ on: false, connected: false, perm: "unknown", convs: [] });
		expect((await get("/api/ig-dm/c1"))!.status).toBe(409);
		expect((await get("/api/ig-dm/refresh", "POST"))!.status).toBe(409);
		expect(refreshes).toBe(0);
	});

	test("nothing but reading is routed: a send or a delete is not answered", async () => {
		const call = (path: string, method: string) => dmWeb.route(new Request(`http://x${path}`, { method, body: method === "GET" ? undefined : "{}" }), new URL(`http://x${path}`), path.split("/").filter(Boolean));
		expect(await call("/api/ig-dm/c1", "POST")).toBeUndefined();
		expect(await call("/api/ig-dm/c1", "DELETE")).toBeUndefined();
		expect(await call("/api/ig-dm/c1/send", "POST")).toBeUndefined();
		expect((await call("/api/ig-dm/nope", "GET"))!.status).toBe(404);
	});
});
