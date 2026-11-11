import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fakeHub, json, waitFor, run, type View } from "./test-web.ts";

// 모니터링 > 앱 > 카카오톡 (web/js/30-kakao.js): the room choice, the chosen rooms as conversation rows and the per-room chat, run as shipped in a headless
// browser (Bun.WebView) against a stubbed /api/kakao/* (docs/kakao-rooms-api.md). Names and texts are placeholders. Screenshots are written only when KAKAO_SHOTS names a folder.
const SHOTS = process.env.KAKAO_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

type Msg = { logId: string; authorId: string; sender: string; text: string; type: number; sentAt: number; fromMe: boolean; unread: number; media?: Record<string, unknown> };
type Room = { chatId: string; name: string; kind: string; watched: boolean; autoDraft: boolean; unread: number; lastAt: number; hint?: string; unreplied?: boolean };
type Draft = { code: string; text: string; basisLogId: string; created: number; parts?: string[] };
type Send = { id: string; text: string; state: string; reason?: string; at: number };
type Req = { method: string; path: string; body: Record<string, unknown> | null };

const at = (d: number, h: number, m: number, s = 0) => Date.UTC(2026, 9, d, h, m, s);
const who = { 가나: { authorId: "u1", sender: "가나" }, 다라: { authorId: "u2", sender: "다라" }, me: { authorId: "me", sender: "나" } };
// KakaoTalk's read counters (members who have not read the message yet) of a few messages; everything else is read by all (0).
const UNREAD: Record<string, number> = { "3001": 2, "3002": 2, "3003": 1, "3007": 1 };
const mk = (logId: string, w: keyof typeof who, text: string, sentAt: number, type = 1, media?: Record<string, unknown>): Msg => ({ logId, ...who[w], text, type, sentAt, fromMe: w === "me", unread: UNREAD[logId] ?? 0, ...(media ? { media } : {}) });
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), c => c.charCodeAt(0));
const OLD = Array.from({ length: 30 }, (_, i) => mk(String(2001 + i), i % 3 === 2 ? "me" : "가나", `예전 대화 ${i}`, at(20, 1, i * 2)));
const MID = [
	mk("3001", "가나", "안녕하세요 가나다 모임입니다", at(21, 3, 0)),
	mk("3002", "가나", "오늘 모임은 일곱 시예요", at(21, 3, 0, 20)),
	mk("3003", "me", "네 알겠어요", at(21, 3, 2)),
	mk("3004", "다라", "", at(21, 3, 5), 2),
	mk("3005", "다라", "", at(21, 3, 6), 20),
	mk("3006", "가나", "<b>굵게</b> & <img src=x onerror=alert(1)> 그대로 보여야 해요", at(21, 3, 8)),
	mk("3007", "가나", "아주긴문장".repeat(40), at(21, 3, 9)),
];
const FRESH = Array.from({ length: 30 }, (_, i) => mk(String(4001 + i), "다라", `새 메시지 ${i}`, at(22, 1, i)));
const DRAFTS = (): Draft[] => [
	{ code: "d1", text: "초안 하나예요", basisLogId: "4030", created: at(22, 2, 0) },
	{ code: "d2", text: "초안 둘이에요", basisLogId: "4030", created: at(22, 2, 1) },
	{ code: "d3", text: "초안 셋이에요", basisLogId: "4030", created: at(22, 2, 2) },
];
const ROOMS = (): Room[] => [
	{ chatId: "100", name: "가나다 모임", kind: "group", watched: true, autoDraft: false, unread: 30, lastAt: at(22, 1, 29) },
	{ chatId: "200", name: "사아자 방", kind: "group", watched: false, autoDraft: false, unread: 0, lastAt: at(19, 5, 0) },
	{ chatId: "300", name: "라마바", kind: "direct", watched: true, autoDraft: false, unread: 0, lastAt: at(21, 5, 0) },
];

let rooms = ROOMS(), msgs: Msg[] = [], drafts: Draft[] = [], sends: Send[] = [], roomsAnswer: Record<string, unknown> | null = null;
let ask: { question: string; choices: string[] } | null = null;
let reqs: Req[] = [];
let waiters: { pred: (r: Req) => boolean; res: (r: Req) => void }[] = [];
const reset = () => { rooms = ROOMS(); msgs = [...OLD, ...MID, ...FRESH]; drafts = DRAFTS(); sends = []; roomsAnswer = null; ask = null; reqs = []; waiters = []; };
const record = (r: Req) => { reqs.push(r); waiters = waiters.filter(w => (w.pred(r) ? (w.res(r), false) : true)); };
const expectReq = (pred: (r: Req) => boolean, ms = 3500): Promise<Req> => {
	const have = reqs.find(pred);
	if (have) return Promise.resolve(have);
	return new Promise((res, rej) => {
		const t = setTimeout(() => rej(new Error(`no matching request; got ${JSON.stringify(reqs.map(r => `${r.method} ${r.path}`))}`)), ms);
		waiters.push({ pred, res: r => { clearTimeout(t); res(r); } });
	});
};
const isReq = (method: string, path: string) => (r: Req) => r.method === method && r.path === path;
let dropped: typeof drafts = [];   // what 보내지 않기 / 답장 안 함 took away, for 되돌리기

const emit = (e: object) => hub.push(e);

const hub = fakeHub({
	stream: "fake",
	api: async (req, url) => {
		const p = url.pathname;
		if (p === "/api/history") return json({ target: url.searchParams.get("target"), events: [] });
		if (p === "/api/activity") return json({ items: [], more: false, history: false });
		if (p === "/api/conversations") return json({ items: [] });
		if (p === "/api/notices") return json({ unread: 0, items: [] });
		if (p === "/api/monitors") return json({ items: [] });
		if (p === "/api/integrations") return json({ items: [{ key: "kakao", label: "카카오톡", icon: "chat", kind: "app", conv: [], notices: [], needs: { drafts: drafts.length, unread: 30, sentToday: 0 } }] });
		if (p === "/api/kakao/rooms") return json(roomsAnswer ?? { on: true, rooms });
		const per = /^\/api\/kakao\/person\/(\w+)(\/analyze)?$/.exec(p);
		if (per) {
			const personBody = req.method === "GET" ? null : ((await req.json().catch(() => ({}))) as Record<string, unknown>);
			record({ method: req.method, path: `${p}${url.search}`, body: personBody });
			if (per[2]) return json({ analysis: { text: "가나와는 일정을 자주 맞추는 사이예요.", at: at(26, 3, 0) } });
			return json({ stats: { userId: per[1], name: "가나", room: String(url.searchParams.get("room") || ""), windowDays: 30, roomMessages: 42, watchedMessages: 120, watchedRooms: 4, firstAt: at(1, 1, 0), lastAt: at(22, 1, 0), hours: Array.from({ length: 24 }, (_, i) => (i === 9 ? 30 : i === 18 ? 8 : 0)), weekdays: [1, 2, 3, 4, 5, 6, 7], replyToOwnerMs: 390_000, ownerReplyMs: 120_000, mentionShare: 0.25, mentions: 10, recentUnanswered: [{ logId: "3007", at: at(21, 3, 9), text: "아주긴문장" }] } });
		}
		const latest = /^\/api\/kakao\/rooms\/(\w+)\/latest$/.exec(p);
		if (latest && req.method === "GET") {
			record({ method: "GET", path: p, body: null });
			const room = rooms.find(x => x.chatId === latest[1]);
			if (!room) return json({ error: "대화방을 찾지 못했어요" }, 404);
			const last = [...msgs].sort((a, b) => (BigInt(a.logId) > BigInt(b.logId) ? 1 : -1)).at(-1);
			return json({ logId: last?.logId ?? "", text: last ? last.text || "(사진)" : "", at: last?.sentAt ?? 0, unread: (room.unread | 0) + 1 });
		}
		if (p === "/api/link-preview") {
			record({ method: "GET", path: `${p}${url.search}`, body: null });
			const target = url.searchParams.get("url") ?? "";
			if (target.includes("nopreview")) return json({ ok: false, url: target, error: "미리 볼 수 있는 페이지가 아니에요" });
			return json({ ok: true, url: target, site: "Google Maps", title: "강남 맛집 모음", description: "지도에서 확인해 보세요", image: `/api/link-preview/image?url=${encodeURIComponent(`${target}/card.png`)}` });
		}
		if (p === "/api/link-preview/image") {
			record({ method: "GET", path: `${p}${url.search}`, body: null });
			return new Response(PNG, { headers: { "Content-Type": "image/png" } });
		}
		const media = /^\/api\/kakao\/media\/(\w+)\/(\w+)(\/file)?$/.exec(p);
		if (media) {
			record({ method: "GET", path: `${p}${url.search}`, body: null });
			if (media[2] === "5008") return json({ error: "기간이 지나 볼 수 없어요" }, 410);
			// the full video never finishes loading: the viewer's <video> stays as it is (a PNG body would fire `error` at a load-dependent moment)
			if (media[2] === "5003" && url.searchParams.get("v") === "full") return new Response(new ReadableStream({}), { headers: { "Content-Type": "video/mp4" } });
			return new Response(PNG, { headers: { "Content-Type": "image/png" } });
		}
		const body = req.method === "GET" ? null : ((await req.json().catch(() => ({}))) as Record<string, unknown>);
		const m = /^\/api\/kakao\/rooms\/(\w+)$/.exec(p);
		if (m && req.method === "PUT") {
			record({ method: "PUT", path: p, body });
			const r = rooms.find(x => x.chatId === m[1]);
			if (r) { if ("watched" in body!) r.watched = !!body!.watched; if ("autoDraft" in body!) r.autoDraft = !!body!.autoDraft; }
			return json({ ok: true, watched: rooms.filter(x => x.watched).map(x => x.chatId) });
		}
		if (/^\/api\/kakao\/chat\/\w+\/no-reply$/.test(p) && (req.method === "POST" || req.method === "DELETE")) { record({ method: req.method, path: p, body }); return json({ ok: true }); }
		const ad = /^\/api\/kakao\/chat\/(\w+)\/ask\/drop$/.exec(p);
		if (ad && req.method === "POST") { record({ method: "POST", path: p, body }); ask = null; return json({ ok: true }); }
		// 다시 보내기: the gateway resends what the failed send was (a draft's remaining parts, or the typed text); the old record leaves the list.
		const rt = /^\/api\/kakao\/chat\/(\w+)\/send\/(\w+)\/retry$/.exec(p);
		if (rt && req.method === "POST") {
			record({ method: "POST", path: p, body });
			const old = sends.find(s => s.id === rt[2]);
			if (!old) return json({ error: "다시 보낼 전송을 찾지 못했어요" }, 404);
			const s = { id: `s${sends.length + 1}`, text: old.text, state: "sending", at: Date.now() };
			sends.splice(sends.indexOf(old), 1, s);
			return json({ id: s.id, state: "sending" }, 202);
		}
		const c = /^\/api\/kakao\/chat\/(\w+)(?:\/(reads?|send|draft))?$/.exec(p);
		if (c) {
			const room = rooms.find(x => x.chatId === c[1]);
			// Like hub/kakao/web.ts: any listed room is readable; sending and drafts need a watched room.
			if (!room) return json({ error: "대화방을 찾지 못했어요" }, 404);
			if (!room.watched && (c[2] === "send" || c[2] === "draft")) return json({ error: "지켜보는 대화방이 아니에요" }, 403);
			if (c[2] === "reads" && req.method === "GET") {
				record({ method: "GET", path: `${p}${url.search}`, body: null });
				const from = BigInt(url.searchParams.get("from") ?? "0");
				return json({ counts: Object.fromEntries(msgs.filter(x => BigInt(x.logId) >= from).map(x => [x.logId, x.unread])) });
			}
			if (req.method === "GET") {
				record({ method: "GET", path: `${p}${url.search}`, body: null });
				const after = url.searchParams.get("after"), before = url.searchParams.get("before"), around = url.searchParams.get("around");
				const sorted = [...msgs].sort((a, b) => (BigInt(a.logId) > BigInt(b.logId) ? 1 : -1)), lim = Number(url.searchParams.get("limit") ?? 80);
				const list = around
					? [...sorted.filter(x => BigInt(x.logId) <= BigInt(around)).slice(-lim), ...sorted.filter(x => BigInt(x.logId) > BigInt(around)).slice(0, lim)]
					: after ? sorted.filter(x => BigInt(x.logId) > BigInt(after)).slice(0, lim)
					: before ? sorted.filter(x => BigInt(x.logId) < BigInt(before)).slice(-lim)
					: sorted.slice(-lim);
				return json({ room: { chatId: room.chatId, name: room.name, kind: room.kind, group: room.kind === "group" || room.kind === "open", watched: room.watched }, messages: list, read: after ? undefined : "3007", kakaoUnread: 30, drafts: room.watched ? drafts : [], sends, ...(ask ? { ask } : {}) });
			}
			record({ method: "POST", path: p, body });
			if (c[2] === "draft" && typeof body!.intent === "string") {
				const parts = ["내일 7시로 미루는 게 어떨까요?", "일정 조정해 주세요"];
				drafts = [{ code: "di", text: parts.join("\n\n"), parts, intent: String(body!.intent), basisLogId: "4030", created: Date.now() }];
				emit({ kind: "kakao_draft", chatId: c[1] });
				return json({ state: "drafting" }, 202);
			}
			if (c[2] === "draft" && typeof body!.choice === "string") {
				ask = null;
				drafts = [{ code: "dp", text: `답장: ${body!.choice}`, basisLogId: "4033", created: Date.now() }];
				emit({ kind: "kakao_draft", chatId: c[1] });
				return json({ state: "drafting" }, 202);
			}
			if (c[2] === "read") room.unread = 0;
			if (c[2] === "send") { const s = { id: `s${sends.length + 1}`, text: String(body!.text), state: "sending", at: Date.now() }; sends.push(s); return json({ id: s.id, state: "sending" }, 202); }
			return json({ ok: true });
		}
		const d = /^\/api\/kakao\/drafts\/(\w+)\/(send|drop|restore)$/.exec(p);
		if (d && req.method === "POST") {
			record({ method: "POST", path: p, body });
			if (d[2] === "restore") { drafts = [...drafts, ...dropped.filter(x => x.code === d[1])]; return json({ ok: true }); }
			dropped = drafts.filter(x => x.code === d[1]);
			drafts = drafts.filter(x => x.code !== d[1]);
			if (d[2] === "send") { const s = { id: `s${sends.length + 1}`, text: String(body!.text ?? "초안"), state: "sending", at: Date.now() }; sends.push(s); return json({ id: s.id, state: "sending" }, 202); }
			return json({ ok: true });
		}
	},
});

const open = (width: number, height: number): Promise<View> => hub.view({ width, height });
afterAll(() => { hub.stop(); });
beforeEach(reset);

const q = async <T = unknown>(v: View, code: string): Promise<T> => JSON.parse((await v.evaluate(`JSON.stringify((() => { ${code} })())`)) as string) as T;
const boot = async (v: View) => {
	const opened = hub.nextStream();
	await v.navigate(`${hub.origin}/`);
	await opened;
	await waitFor(v, `typeof NT !== "undefined" && NT.loaded && S`);
	await light(v);
	await run(v, `go("monitoring", "i:kakao")`);
	await waitFor(v, `!$("#kk").hidden && KK.loaded && document.querySelector(".kk-rooms .kk-lh")`);
};
const openRoom = async (v: View, id = "100") => {
	await run(v, `document.querySelector('.kk-row[data-chat="${id}"]').click()`);
	await waitFor(v, `KK.open === "${id}" && !KK.loading && KK.placed`);
};
// Types a query into the room search (an input event, like the keyboard).
const search = (v: View, text: string) => run(v, `const i = document.querySelector("#kk-q"); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event("input", { bubbles: true }))`);
const shot = async (v: View, name: string) => { if (SHOTS) await Bun.write(join(SHOTS, name), await v.screenshot()); };
const dark = (v: View) => run(v, `if (dotzTheme.get() !== "dark") dotzTheme.toggle()`);
const light = (v: View) => run(v, `if (dotzTheme.get() === "dark") dotzTheme.toggle()`);

// The newest message is wholly inside the timeline, which ends at or above the composer, and the timeline is scrolled to its end.
const newestInSight = (v: View, logId: string) =>
	q<boolean>(v, `const t = document.querySelector("#kk-tl"), tr = t.getBoundingClientRect(), m = document.querySelector('[data-log="${logId}"]').getBoundingClientRect(), f = document.querySelector("#kk-foot").getBoundingClientRect();
		return m.bottom <= tr.bottom + 1 && m.top >= tr.top && tr.bottom <= f.top + 1 && t.scrollHeight - t.scrollTop - t.clientHeight <= 1`);
type Geo = { markTop: number; scrollTop: number; stick: boolean; markNext: string | null };
const geo = (v: View) => q<Geo>(v, `const m = document.querySelector(".kk-new"), t = document.querySelector("#kk-tl"); return { markTop: m ? Math.round(m.getBoundingClientRect().top - t.getBoundingClientRect().top) : -999, scrollTop: Math.round(t.scrollTop), stick: KK.stick, markNext: m && m.nextElementSibling ? m.nextElementSibling.dataset.log : null }`);

describe("카카오톡 at desktop width (1280x800)", async () => {
	const v = await open(1280, 800);

	test("only the watched rooms are rows (name, initial, time, unread) with no watch control; 추가 opens the full list as checkbox rows", async () => {
		await boot(v);
		const s = await q<{ rows: { name: string; initial: string; time: string; badge: string; controls: number }[]; switches: number; dialog: boolean }>(v, `
			const rows = [...document.querySelectorAll(".kk-row")].map(r => ({ name: r.querySelector(".cv-n").textContent, initial: r.querySelector(".kk-av").textContent, time: (r.querySelector(".kk-t") || {}).textContent || "", badge: (r.querySelector(".nb") || {}).textContent || "", controls: r.parentElement.querySelectorAll(":scope > :not(.kk-row), .ib").length }));
			return { rows, switches: document.querySelectorAll('.kk-rooms [role="switch"]').length, dialog: !!document.querySelector("#kk-add") }`);
		expect(s.rows.map(r => r.name)).toEqual(["가나다 모임", "라마바"]);
		expect(s.rows[0]).toMatchObject({ initial: "가", badge: "30", controls: 0 });
		expect(s.rows[0]!.time.length).toBeGreaterThan(0);
		expect(s.switches).toBe(0);
		expect(s.dialog).toBe(false);
		await run(v, `document.querySelector("#kk-add-btn").click()`);
		await waitFor(v, `document.querySelector("#kk-add")`);
		const sw = await q<string[][]>(v, `return [...document.querySelectorAll("#kk-add .kk-pr")].map(p => [p.dataset.chat, p.getAttribute("aria-checked")])`);
		expect(sw).toEqual([["100", "true"], ["200", "false"], ["300", "true"]]);
		await shot(v, "01-desktop-rooms.png");
		// The sheet and the rows are the app's parts: a flat card row, the watched row selected with a check and the other bare, the sheets' close button.
		expect(await q(v, `const c = s => getComputedStyle(document.querySelector(s)); const r = [...document.querySelectorAll("#kk-add .kk-pr")].map(p => [p.getAttribute("role"), p.classList.contains("on"), !!p.querySelector(".kk-ck")]); return [r.slice(0, 2), c("#kk-add .fs-x").borderTopWidth, c(".kk-row").borderTopLeftRadius]`)).toEqual([[["checkbox", true, true], ["checkbox", false, false]], "0px", "0px"]);
		await run(v, `document.querySelector('#kk-add .fs-x').click()`);
		await waitFor(v, `!document.querySelector("#kk-add")`);
	});

	test("a tap on a sheet row PUTs {watched} and the room joins the rows, a second tap takes it off without opening it; the open room's 자동 초안 switch PUTs {autoDraft}", async () => {
		await run(v, `document.querySelector("#kk-add-btn").click()`);
		await run(v, `document.querySelector('.kk-pr[data-chat="200"]').click()`);
		expect((await expectReq(isReq("PUT", "/api/kakao/rooms/200"))).body).toEqual({ watched: true });
		await waitFor(v, `document.querySelector('.kk-row[data-chat="200"]') && document.querySelector('.kk-pr[data-chat="200"]').getAttribute("aria-checked") === "true"`);
		await run(v, `document.querySelector('#kk-add .fs-x').click()`);
		await waitFor(v, `!document.querySelector("#kk-add")`);
		await openRoom(v);
		expect(await q(v, `return [document.querySelector('#kk-auto [data-k="auto"]').getAttribute("aria-checked")]`)).toEqual(["false"]);
		await run(v, `document.querySelector('#kk-auto [data-k="auto"]').click()`);
		expect((await expectReq(isReq("PUT", "/api/kakao/rooms/100"))).body).toEqual({ autoDraft: true });
		await waitFor(v, `document.querySelector('#kk-auto [data-k="auto"]').getAttribute("aria-checked") === "true"`);
		await run(v, `document.querySelector("#kk-add-btn").click()`);
		await waitFor(v, `document.querySelector('.kk-pr[data-chat="200"]')`);
		await run(v, `document.querySelector('.kk-pr[data-chat="200"]').click()`);
		expect((await expectReq(r => r.method === "PUT" && r.path === "/api/kakao/rooms/200" && r.body?.watched === false)).body).toEqual({ watched: false });
		await waitFor(v, `!document.querySelector('.kk-row[data-chat="200"]') && document.querySelector('.kk-pr[data-chat="200"]').getAttribute("aria-checked") === "false"`);
		expect(await q(v, `return KK.open`)).toBe("100");
		await run(v, `document.querySelector('#kk-add .fs-x').click()`);
		await waitFor(v, `!document.querySelector("#kk-add")`);
	});

	test("opening a room: bubbles left and right, names and times per run, date dividers, placeholders, escaped text, the unread line", async () => {
		await boot(v);
		await openRoom(v);
		const g = await geo(v);
		expect(g.markNext).toBe("4001");
		expect((await expectReq(isReq("POST", "/api/kakao/chat/100/read"))).body).toEqual({ logId: "4030" });
		const lay = await q<Record<string, number>>(v, `
			const r = s => document.querySelector(s).getBoundingClientRect(), t = r("#kk-tl");
			return { inL: r('[data-log="3001"] .kk-bub').left, inR: r('[data-log="3001"] .kk-bub').right, meL: r('[data-log="3003"] .kk-bub').left, meR: r('[data-log="3003"] .kk-bub').right, tl: t.left, tr: t.left + document.querySelector("#kk-tl").clientLeft + document.querySelector("#kk-tl").clientWidth, longR: r('[data-log="3007"] .kk-bub').right, hScroll: document.querySelector("#kk-tl").scrollWidth - document.querySelector("#kk-tl").clientWidth }`);
		expect(lay.inL).toBeLessThan(lay.tl + 80);
		expect(lay.meR).toBeGreaterThan(lay.tr - 24);
		expect(lay.meL).toBeGreaterThan(lay.inL + 100);
		expect(lay.longR).toBeLessThanOrEqual(lay.tr);
		expect(lay.hScroll).toBeLessThanOrEqual(0);
		const runs = await q<Record<string, unknown>>(v, `
			const has = (id, s) => !!document.querySelector('[data-log="' + id + '"] ' + s);
			return { name1: has("3001", ".kk-name"), name2: has("3002", ".kk-name"), time1: has("3001", ".kk-time"), time2: has("3002", ".kk-time"), av1: has("3001", ".kk-av:not(.sp)"), av2: has("3002", ".kk-av.sp"), meTime: has("3003", ".kk-time"), meName: has("3003", ".kk-name"),
				ph1: document.querySelector('[data-log="3004"] .kk-bub').textContent, ph2: document.querySelector('[data-log="3005"] .kk-bub').textContent,
				raw: document.querySelector('[data-log="3006"] .kk-bub').textContent, tags: document.querySelectorAll('[data-log="3006"] .kk-bub *').length,
				dates: [...document.querySelectorAll(".kk-date")].map(d => d.textContent), mark: document.querySelector(".kk-new").textContent }`);
		expect(runs).toMatchObject({ name1: true, name2: false, time1: false, time2: true, av1: true, av2: true, meTime: true, meName: false, ph1: "(사진)", ph2: "(이모티콘)", tags: 0, mark: "여기까지 읽었어요" });
		expect(runs.raw).toBe("<b>굵게</b> & <img src=x onerror=alert(1)> 그대로 보여야 해요");
		const dates = runs.dates as string[];
		expect(dates.length).toBeGreaterThanOrEqual(3);
		for (const d of dates) expect(d).toMatch(/^\d{4}년 \d{1,2}월 \d{1,2}일 .요일$/);
		await shot(v, "02-desktop-unread.png");
	});

	test("the room opens at the newest message, fully above the composer; /read carries the last logId; the unread line stays in the list", async () => {
		const g = await geo(v);
		expect(g.stick).toBe(true);
		expect(g.scrollTop).toBeGreaterThan(0);
		expect(g.markTop).toBeLessThan(0);
		expect(await newestInSight(v, "4030")).toBe(true);
		await waitFor(v, `!document.querySelector('.kk-row[data-chat="100"] .nb')`);
	});

	test("a new message while scrolled up shows the 새 메시지 pill and keeps the place; at the bottom it follows", async () => {
		// Mid-list, not the very top: the top itself now loads the older page by itself.
		await run(v, `const t = document.querySelector("#kk-tl"); t.scrollTop = Math.floor(t.scrollHeight * 0.4)`);
		await waitFor(v, `KK.stick === false`);
		const kept = await q<number>(v, `return document.querySelector("#kk-tl").scrollTop`);
		msgs.push(mk("4031", "다라", "위에 있을 때 온 메시지", at(22, 2, 0)));
		emit({ kind: "kakao", chatId: "100", logId: "4031" });
		await waitFor(v, `document.querySelector('[data-log="4031"]')`);
		const s = await q<{ pill: boolean; top: number; text: string }>(v, `return { pill: !document.querySelector("#kk-pill").hidden, top: document.querySelector("#kk-tl").scrollTop, text: document.querySelector("#kk-pill").textContent }`);
		expect(s.pill).toBe(true);
		expect(Math.abs(s.top - kept)).toBeLessThanOrEqual(2);
		expect(s.text).toContain("새 메시지");
		await run(v, `document.querySelector("#kk-pill").click()`);
		await waitFor(v, `KK.stick && document.querySelector("#kk-pill").hidden`);
		expect((await expectReq(r => r.path.endsWith("/read") && r.body?.logId === "4031")).body).toEqual({ logId: "4031" });
		msgs.push(mk("4032", "다라", "맨 아래에 있을 때 온 메시지", at(22, 2, 1)));
		emit({ kind: "kakao", chatId: "100", logId: "4032" });
		await waitFor(v, `document.querySelector('[data-log="4032"]') && KK.stick && document.querySelector("#kk-tl").scrollTop + document.querySelector("#kk-tl").clientHeight >= document.querySelector("#kk-tl").scrollHeight - 4`);
	});

	test("a row that lands below the newest logId we hold (a late sync) is merged in logId order, not skipped", async () => {
		msgs.push(mk("3500", "다라", "늦게 들어온 메시지", at(21, 5, 0)));
		emit({ kind: "kakao", chatId: "100", logId: "4032" });
		await waitFor(v, `document.querySelector('[data-log="3500"]')`);
		const order = await q<string[]>(v, `return [...document.querySelectorAll("#kk-tl [data-log]")].map(n => n.dataset.log)`);
		expect(order.indexOf("3500")).toBe(order.indexOf("3007") + 1);
		expect(order.indexOf("3500")).toBe(order.lastIndexOf("3500"));
		expect(await newestInSight(v, "4032")).toBe(true);
	});

	test("a burst of more than one page after the last held row is read to the end and the view stays pinned", async () => {
		for (let i = 0; i < 150; i++) msgs.push(mk(String(5001 + i), "다라", `몰려온 메시지 ${i}`, at(22, 3, 0, i)));
		emit({ kind: "kakao", chatId: "100", logId: "5150" });
		await waitFor(v, `document.querySelector('[data-log="5150"]')`);
		expect(await q<number>(v, `return document.querySelectorAll('#kk-tl [data-log]').length`)).toBe(50 + 2 + 1 + 150);
		expect(await newestInSight(v, "5150")).toBe(true);
	});

	test("a message in another room adds to its unread badge", async () => {
		emit({ kind: "kakao", chatId: "300", logId: "9" });
		await waitFor(v, `(document.querySelector('.kk-row[data-chat="300"] .nb') || {}).textContent === "1"`);
		// the unread count is the same badge as every other list's (blue in light), not the 확인 필요 orange
		expect(await q<boolean>(v, `const b = document.querySelector('.kk-row[data-chat="300"] .nb'), ref = document.body.appendChild(Object.assign(document.createElement("span"), { className: "nb" })), same = getComputedStyle(b).backgroundColor === getComputedStyle(ref).backgroundColor; ref.remove(); return same && !b.classList.contains("warn")`)).toBe(true);
	});

	test("read counters: a small bold yellow number on the time side of a bubble, above the time, own and incoming alike, none at 0", async () => {
		const s = await q<Record<string, any>>(v, `
			const r = s => document.querySelector(s).getBoundingClientRect();
			const rd = id => (document.querySelector('[data-log="' + id + '"] .kk-rd') || {}).textContent ?? null;
			const cs = getComputedStyle(document.querySelector('[data-log="3002"] .kk-rd'));
			return { all: [...document.querySelectorAll(".kk-rd")].map(n => n.closest("[data-log]").dataset.log + ":" + n.textContent), r1: rd("3001"), r2: rd("3002"), r3: rd("3003"), r4: rd("3004"), r6: rd("3006"),
				weight: Number(cs.fontWeight), size: parseFloat(cs.fontSize), color: cs.color, label: document.querySelector('[data-log="3003"] .kk-rd').getAttribute("aria-label"),
				inAbove: r('[data-log="3002"] .kk-rd').bottom <= r('[data-log="3002"] .kk-time').top + 1, inSide: r('[data-log="3002"] .kk-meta').left >= r('[data-log="3002"] .kk-bub').right - 1,
				meAbove: r('[data-log="3003"] .kk-rd').bottom <= r('[data-log="3003"] .kk-time').top + 1, meSide: r('[data-log="3003"] .kk-meta').right <= r('[data-log="3003"] .kk-bub').left + 1,
				timeless: !document.querySelector('[data-log="3001"] .kk-time') && !!document.querySelector('[data-log="3001"] .kk-meta'), hScroll: document.querySelector("#kk-tl").scrollWidth - document.querySelector("#kk-tl").clientWidth }`);
		expect(s.all).toEqual(["3001:2", "3002:2", "3003:1", "3007:1"]);
		expect(s).toMatchObject({ r1: "2", r2: "2", r3: "1", r4: null, r6: null, inAbove: true, inSide: true, meAbove: true, meSide: true, timeless: true, label: "아직 안 읽은 사람 1명" });
		expect(s.weight).toBeGreaterThanOrEqual(700);
		expect(s.size).toBeLessThanOrEqual(12);
		expect(s.color).not.toBe("rgba(0, 0, 0, 0)");
		expect(s.hScroll).toBeLessThanOrEqual(0);
		await run(v, `document.querySelector('[data-log="3001"]').scrollIntoView({ block: "center" })`);
		await shot(v, "08-desktop-counts.png");
	});

	test("kakao_read for the open room asks /reads?from=<oldest shown> and repaints the counters without refetching bodies", async () => {
		const bodies = reqs.filter(r => r.method === "GET" && /^\/api\/kakao\/chat\/100\?/.test(r.path)).length;
		for (const m of msgs) if (m.logId === "3001" || m.logId === "3007") m.unread = 0; else if (m.logId === "3002") m.unread = 1;
		emit({ kind: "kakao_read", chatId: "300" });
		emit({ kind: "kakao_read", chatId: "100" });
		await expectReq(isReq("GET", "/api/kakao/chat/100/reads?from=2018"));
		await waitFor(v, `[...document.querySelectorAll(".kk-rd")].map(n => n.closest("[data-log]").dataset.log + ":" + n.textContent).join() === "3002:1,3003:1"`);
		expect(reqs.filter(r => r.path.startsWith("/api/kakao/chat/300"))).toEqual([]);
		expect(reqs.filter(r => r.method === "GET" && /^\/api\/kakao\/chat\/100\?/.test(r.path)).length).toBe(bodies);
	});

	test("the request bar sends the typed words to the assistant: with a draft waiting the newest one is revised ({revise}); nothing goes to the room", async () => {
		await run(v, `const t = document.querySelector("#kk-text"); t.value = "좀 더 짧게"; t.dispatchEvent(new Event("input", { bubbles: true })); document.querySelector("#kk-send-btn").click()`);
		expect((await expectReq(r => r.method === "POST" && r.path === "/api/kakao/chat/100/draft" && !!r.body?.revise)).body).toEqual({ revise: { code: "d3", change: "좀 더 짧게" } });
		expect(await q(v, `const c = document.querySelector('.kk-draft[data-code="d3"]'); return [document.querySelector("#kk-text").value, c.querySelector(".kk-st").textContent, c.querySelectorAll(".btn").length]`)).toEqual(["", "고치는 중…", 0]);
		emit({ kind: "kakao_draft", chatId: "100" });
		await waitFor(v, `KK.drafting === "" && document.querySelector('.kk-draft[data-code="d3"] [data-k="send"]')`);
		expect(reqs.filter(r => r.path === "/api/kakao/chat/100/send")).toHaveLength(0);
	});

	test("직접 보내기 shows with text and sends it to the room as typed, past the assistant", async () => {
		expect(await q<boolean>(v, `return document.querySelector("#kk-direct-btn").hidden`)).toBe(true);
		await run(v, `const t = document.querySelector("#kk-text"); t.value = "지금 갈게요"; t.dispatchEvent(new Event("input", { bubbles: true }));`);
		await waitFor(v, `!document.querySelector("#kk-direct-btn").hidden`);
		await run(v, `document.querySelector("#kk-direct-btn").click()`);
		expect((await expectReq(isReq("POST", "/api/kakao/chat/100/send"))).body).toEqual({ text: "지금 갈게요" });
		await waitFor(v, `document.querySelector("#kk-text").value === "" && document.querySelector("#kk-direct-btn").hidden`);
	}, 30_000);

	test("Shift+Enter is a new line and sends nothing", async () => {
		const before = reqs.filter(r => r.path.endsWith("/send")).length;
		const prevented = await q<boolean>(v, `const t = document.querySelector("#kk-text"); const e = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }); t.dispatchEvent(e); return e.defaultPrevented`);
		expect(prevented).toBe(false);
		expect(reqs.filter(r => r.path.endsWith("/send")).length).toBe(before);
	});

	test("drafts of the room: a card with 보내기 / 고치기 / 버리기; 보내기 posts the draft route as is, 고치기 sends the edited text, 버리기 drops", async () => {
		const cards = await q<string[]>(v, `return [...document.querySelectorAll(".kk-draft .kk-dt")].map(d => d.textContent)`);
		expect(cards).toEqual(["초안 하나예요", "초안 둘이에요", "초안 셋이에요"]);
		await shot(v, "03-desktop-drafts.png");
		await run(v, `document.querySelector('.kk-draft[data-code="d1"] [data-k="send"]').click()`);
		expect((await expectReq(isReq("POST", "/api/kakao/drafts/d1/send"))).body).toEqual({});
		await waitFor(v, `!document.querySelector('.kk-draft[data-code="d1"]')`);

		await run(v, `document.querySelector('.kk-draft[data-code="d2"] [data-k="edit"]').click()`);
		// 고치기 asks what to change; the manual editor is the small 직접 수정 action beside it
		expect(await q(v, `const c = document.querySelector('.kk-draft[data-code="d2"]'); return [c.querySelector(".kk-rq").textContent, c.querySelector(".kk-rv").placeholder, c.querySelector('[data-k="manual"]').textContent, document.querySelector("#kk-edit").hidden]`)).toEqual(["어떻게 고칠까요?", "더 짧게, 존댓말로, 견적서도 첨부한다고 써 줘", "직접 수정", true]);
		await run(v, `document.querySelector('.kk-draft[data-code="d2"] [data-k="manual"]').click()`);
		const ed = await q<{ value: string; bar: boolean; card: boolean }>(v, `return { value: document.querySelector("#kk-text").value, bar: !document.querySelector("#kk-edit").hidden, card: !!document.querySelector('.kk-draft[data-code="d2"]') }`);
		expect(ed).toEqual({ value: "초안 둘이에요", bar: true, card: false });
		await run(v, `const t = document.querySelector("#kk-text"); t.value = "고친 글"; t.dispatchEvent(new Event("input", { bubbles: true })); document.querySelector("#kk-send-btn").click()`);
		expect((await expectReq(isReq("POST", "/api/kakao/drafts/d2/send"))).body).toEqual({ text: "고친 글" });
		await waitFor(v, `document.querySelector("#kk-edit").hidden && document.querySelector("#kk-text").value === ""`);

		// 고치기 with an instruction: POST /draft { revise }, the old draft stays with 고치는 중… until the new one lands
		await run(v, `document.querySelector('.kk-draft[data-code="d3"] [data-k="edit"]').click()`);
		await run(v, `const i = document.querySelector('.kk-draft[data-code="d3"] .kk-rv'); i.value = "더 짧게"; i.dispatchEvent(new Event("input", { bubbles: true })); document.querySelector('.kk-draft[data-code="d3"] [data-k="revise-go"]').click()`);
		expect((await expectReq(r => r.method === "POST" && r.path === "/api/kakao/chat/100/draft" && !!r.body?.revise)).body).toEqual({ revise: { code: "d3", change: "더 짧게" } });
		expect(await q(v, `const c = document.querySelector('.kk-draft[data-code="d3"]'); return [c.querySelector(".kk-dt").textContent, c.querySelector(".kk-st").textContent, c.querySelectorAll(".btn").length]`)).toEqual(["초안 셋이에요", "고치는 중…", 0]);
		drafts.splice(drafts.findIndex(d => d.code === "d3"), 1, { code: "d5", text: "짧은 초안", basisLogId: "4033", created: Date.now() });
		emit({ kind: "kakao_draft", chatId: "100" });
		await waitFor(v, `document.querySelector('.kk-draft[data-code="d5"]') && !document.querySelector('.kk-draft[data-code="d3"]')`);
		await run(v, `document.querySelector('.kk-draft[data-code="d5"] [data-k="drop"]').click()`);
		await expectReq(isReq("POST", "/api/kakao/drafts/d5/drop"));
		await waitFor(v, `!document.querySelector(".kk-draft")`);
	});

	test("an empty request field has the switched-off send arrow, the same look as the chat composer", async () => {
		expect(await q(v, `const t = document.querySelector("#kk-text"); t.value = ""; t.dispatchEvent(new Event("input", { bubbles: true })); const b = document.querySelector("#kk-send-btn"), look = () => { const c = getComputedStyle(b); return [c.opacity, c.pointerEvents]; }, e = look(); t.value = "가"; t.dispatchEvent(new Event("input", { bubbles: true })); const f = look(); t.value = ""; return [...e, ...f]`)).toEqual(["0.4", "none", "1", "auto"]);
	});

	test("a request with no draft waiting makes a new draft ({intent}); 보내기 on its card shows a 보내는 중 bubble on the right; sent clears it once read back; failed shows the reason and retries", async () => {
		const ask = async (text: string) => run(v, `const t = document.querySelector("#kk-text"); t.value = ${JSON.stringify(text)}; t.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))`);
		await ask("가나다 답장");
		expect((await expectReq(r => r.method === "POST" && r.path === "/api/kakao/chat/100/draft" && r.body?.intent === "가나다 답장")).body).toEqual({ intent: "가나다 답장" });
		await waitFor(v, `document.querySelector('.kk-draft[data-code="di"] [data-k="send"]')`);
		await run(v, `document.querySelector('.kk-draft[data-code="di"] [data-k="send"]').click()`);
		expect((await expectReq(isReq("POST", "/api/kakao/drafts/di/send"))).body).toEqual({});
		await waitFor(v, `document.querySelector(".kk-m.me.pend .kk-state")`);
		// the view stays at the newest message: the card leaving does not throw the timeline to the top of the room
		expect(await q(v, `const t = document.querySelector("#kk-tl"); return t.scrollTop > 0 && t.scrollHeight - t.scrollTop - t.clientHeight <= 1`)).toBe(true);
		expect(await q(v, `return !!document.querySelector(".kk-m.pend .kk-rd")`)).toBe(false);
		const pend = await q<{ state: string; right: number; tr: number }>(v, `const b = document.querySelector(".kk-m.me.pend .kk-bub").getBoundingClientRect(); return { state: document.querySelector(".kk-m.me.pend .kk-state").textContent, right: b.right, tr: (tl => tl.getBoundingClientRect().left + tl.clientLeft + tl.clientWidth)(document.querySelector("#kk-tl")) }`);
		expect(pend.state).toBe("보내는 중");
		expect(pend.right).toBeGreaterThan(pend.tr - 24);
		msgs.push({ ...mk("4033", "me", "초안", Date.now()) });
		emit({ kind: "kakao_send", chatId: "100", id: "s1", state: "sent" });
		await waitFor(v, `document.querySelector('[data-log="4033"]') && !document.querySelector(".kk-m.me.pend")`);

		await ask("두번째 글");
		await waitFor(v, `document.querySelector('.kk-draft[data-code="di"] [data-k="send"]')`);
		await run(v, `document.querySelector('.kk-draft[data-code="di"] [data-k="send"]').click()`);
		await waitFor(v, `document.querySelector(".kk-m.me.pend .kk-state")`);
		Object.assign(sends.find(s => s.id === "s2")!, { state: "failed", reason: "전송에 실패했어요" });
		emit({ kind: "kakao_send", chatId: "100", id: "s2", state: "failed", reason: "전송에 실패했어요" });
		await waitFor(v, `(document.querySelector(".kk-m.me.pend.failed .kk-state") || {}).textContent === "실패 · 전송에 실패했어요"`);
		await run(v, `document.querySelector("#kk-tl").scrollTop = 1e9`);
		await shot(v, "07-desktop-send-failed.png");
		await run(v, `document.querySelector('.kk-m.pend [data-k="retry"]').click()`);
		await waitFor(v, `document.querySelectorAll(".kk-m.me.pend").length === 1 && document.querySelector(".kk-m.me.pend .kk-state").textContent === "보내는 중"`);
		// The retry is the gateway's (it knows a draft's unsent parts); the web never posts the text itself, and the bar never posts to the room.
		expect(reqs.filter(r => r.path === "/api/kakao/chat/100/send/s2/retry")).toHaveLength(1);
		expect(reqs.filter(r => r.path === "/api/kakao/chat/100/send")).toHaveLength(0);
	});

	test("답장 초안 POSTs /draft, shows 초안 만드는 중… until the room's kakao_draft arrives, then the new draft card", async () => {
		await run(v, `document.querySelector("#kk-draft-btn").click()`);
		await expectReq(isReq("POST", "/api/kakao/chat/100/draft"));
		const busy = await q<{ text: string; disabled: boolean }>(v, `const b = document.querySelector("#kk-draft-btn"); return { text: b.textContent, disabled: b.disabled }`);
		expect(busy).toEqual({ text: "초안 만드는 중…", disabled: true });
		drafts.push({ code: "d4", text: "새로 만든 초안이에요", basisLogId: "4033", created: Date.now() });
		emit({ kind: "kakao_draft", chatId: "100" });
		await waitFor(v, `document.querySelector('.kk-draft[data-code="d4"]') && !document.querySelector("#kk-draft-btn").disabled`);
		expect(await q(v, `return document.querySelector("#kk-draft-btn").textContent`)).toBe("답장 초안");
		await run(v, `document.querySelector("#kk-tl").scrollTop = 1e9`);
		await shot(v, "04-desktop-bottom.png");
	});

	test("an open question of the room: the card shows it with one button per choice; a pick POSTs {choice} and the draft card follows; 직접 쓸게 drops it and opens the composer", async () => {
		ask = { question: "티켓 취소할까요?", choices: ["취소해", "다른 날 물어봐", "그냥 가자"] };
		emit({ kind: "kakao_draft", chatId: "100" });
		await waitFor(v, `document.querySelector(".kk-ask")`);
		const card = await q<{ q: string; buttons: string[]; first: boolean }>(v, `const c = document.querySelector(".kk-ask"); return { q: c.querySelector(".kk-dt").textContent, buttons: [...c.querySelectorAll(".btn")].map(b => b.textContent), first: document.querySelector("#kk-drafts").firstElementChild === c }`);
		expect(card).toEqual({ q: "티켓 취소할까요?", buttons: ["취소해", "다른 날 물어봐", "그냥 가자", "직접 쓸게"], first: true });
		await shot(v, "06-desktop-ask.png");
		await run(v, `document.querySelector('.kk-ask [data-k="pick"][data-i="0"]').click()`);
		expect((await expectReq(r => r.method === "POST" && r.path === "/api/kakao/chat/100/draft" && r.body?.choice === "취소해")).body).toEqual({ choice: "취소해" });
		await waitFor(v, `!document.querySelector(".kk-ask") && document.querySelector('.kk-draft[data-code="dp"] .kk-dt')`);
		expect(await q(v, `return [...document.querySelectorAll('.kk-draft[data-code="dp"] .btn')].map(b => b.textContent)`)).toEqual(["보내기", "고치기", "답장 안 함"]);
		expect(await q(v, `return document.querySelector('.kk-draft[data-code="dp"] .kk-dt').textContent`)).toBe("답장: 취소해");

		ask = { question: "다시 묻습니다", choices: ["응", "아니"] };
		emit({ kind: "kakao_draft", chatId: "100" });
		await waitFor(v, `document.querySelector(".kk-ask")`);
		await run(v, `document.querySelector('.kk-ask [data-k="own"]').click()`);
		await expectReq(isReq("POST", "/api/kakao/chat/100/ask/drop"));
		await waitFor(v, `!document.querySelector(".kk-ask") && document.activeElement && document.activeElement.id === "kk-text"`);
	});

	test("dark", async () => {
		await dark(v);
		await shot(v, "05-desktop-dark.png");
		await light(v);
	});
	test("a system line holding KakaoTalk's own feed record reads as words, never as JSON; an unknown record is not drawn", async () => {
		msgs.push(mk("4040", "가나", JSON.stringify({ feedType: 25, logId: "1", hidden: true, targetRevision: 1 }), at(22, 3, 0), 0));
		msgs.push(mk("4041", "가나", JSON.stringify({ feedType: 4, members: [{ userId: 9, nickName: "마바" }] }), at(22, 3, 1), 0));
		msgs.push(mk("4042", "가나", JSON.stringify({ feedType: 77 }), at(22, 3, 2), 0));
		emit({ kind: "kakao", chatId: "100", logId: "4042" });
		await waitFor(v, `document.querySelector('[data-log="4041"]')`);
		const s = await q<{ hidden: string; join: string; unknown: boolean; json: boolean }>(v, `return { hidden: document.querySelector('[data-log="4040"]')?.textContent ?? "", join: document.querySelector('[data-log="4041"]')?.textContent ?? "", unknown: !!document.querySelector('[data-log="4042"]'), json: document.querySelector("#kk-tl").textContent.includes('{"feedType') }`);
		expect(s).toEqual({ hidden: "가려진 메시지예요", join: "마바님이 들어왔어요", unknown: false, json: false });
	});
});

describe("카카오톡 on a phone (390x844)", async () => {
	const v = await open(390, 844);

	test("the room list and the chat are separate screens with a back button; the composer stays on screen", async () => {
		await boot(v);
		const disp = (s: string) => `getComputedStyle(document.querySelector("${s}")).display`;
		expect(await q(v, `return [${disp(".kk-rooms")}, ${disp(".kk-chat")}]`)).toEqual(["block", "none"]);
		await shot(v, "10-mobile-rooms.png");
		await openRoom(v);
		expect(await q(v, `return [${disp(".kk-rooms")}, ${disp(".kk-chat")}, document.querySelector("#title").textContent, !document.querySelector("#back").hidden]`)).toEqual(["none", "flex", "가나다 모임", true]);
		const g = await geo(v);
		expect(g.markNext).toBe("4001");
		expect(g.stick).toBe(true);
		expect(await newestInSight(v, "4030")).toBe(true);
		await shot(v, "11-mobile-unread.png");
		await shot(v, "12-mobile-drafts.png");
		const foot = await q<{ bottom: number; h: number; right: number; w: number }>(v, `const f = document.querySelector("#kk-form").getBoundingClientRect(); return { bottom: f.bottom, h: innerHeight, right: f.right, w: innerWidth }`);
		expect(foot.bottom).toBeLessThanOrEqual(foot.h);
		expect(foot.right).toBeLessThanOrEqual(foot.w);

		await v.resize(390, 544);
		await run(v, `visualViewport.dispatchEvent(new Event("resize"))`);
		expect(await q<boolean>(v, `const f = document.querySelector("#kk-form").getBoundingClientRect(); return f.bottom <= innerHeight && f.top >= 0`)).toBe(true);
		await v.resize(390, 844);

		await run(v, `const t = document.querySelector("#kk-text"); t.value = "줄바꿈"; const e = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }); t.dispatchEvent(e); window.__enterPrevented = e.defaultPrevented`);
		expect(await q(v, `return window.__enterPrevented`)).toBe(false);
		expect(reqs.some(r => r.path.endsWith("/send"))).toBe(false);

		await run(v, `document.querySelector("#back").click()`);
		await waitFor(v, `!KK.open`);
		expect(await q(v, `return [${disp(".kk-rooms")}, ${disp(".kk-chat")}]`)).toEqual(["block", "none"]);
		await run(v, `document.querySelector("#back").click()`);
		await waitFor(v, `MON.list`);
	});

	test("room search at 390px: the input sits on top of the room choice, fits the width, and filters the choice list", async () => {
		await boot(v);
		await run(v, `document.querySelector("#kk-add-btn").click()`);
		await waitFor(v, `document.querySelector("#kk-q")`);
		await search(v, "모임");
		const s = await q<Record<string, any>>(v, `const i = document.querySelector("#kk-q").getBoundingClientRect(), p = document.querySelector(".kk-rooms");
			return { rows: [...document.querySelectorAll('.kk-pr')].map(r => r.dataset.chat), h: i.height, left: i.left, right: i.right, w: innerWidth, hScroll: p.scrollWidth - p.clientWidth, font: parseFloat(getComputedStyle(document.querySelector("#kk-q")).fontSize) }`);
		expect(s.rows).toEqual(["100"]);
		expect(s.h).toBeGreaterThanOrEqual(40);   // docs/ui-spec.md 입력창: 터치 40px
		expect(s.left).toBeGreaterThanOrEqual(0);
		expect(s.right).toBeLessThanOrEqual(s.w);
		expect(s.hScroll).toBeLessThanOrEqual(0);
		expect(s.font).toBeGreaterThanOrEqual(16);
		await shot(v, "14-mobile-search.png");
	});

	test("dark chat", async () => {
		await boot(v);
		await openRoom(v);
		await dark(v);
		await shot(v, "13-mobile-dark.png");
		await light(v);
	});
});

describe("대화방 검색 (room search)", async () => {
	const v = await open(1280, 800);
	const rowsOf = (v: View) => q<string[]>(v, `return [...document.querySelectorAll(".kk-pr")].map(r => r.dataset.chat)`);

	test("a search input tops the 지켜볼 대화방 list; it filters by name (substring, case-insensitive, initial consonants) and says so when nothing matches", async () => {
		reset();
		await boot(v);
		await run(v, `document.querySelector("#kk-add-btn").click()`);
		const top = await q<Record<string, any>>(v, `const i = document.querySelector("#kk-q"); return { ph: i.placeholder, first: i.closest(".pl-search").parentElement.firstElementChild === i.closest(".pl-search") && !!i.closest("#kk-add"), label: i.getAttribute("aria-label") }`);
		expect(top).toEqual({ ph: "대화방 검색", first: true, label: "대화방 검색" });
		expect(await rowsOf(v)).toEqual(["100", "200", "300"]);
		await search(v, "라마");
		expect(await rowsOf(v)).toEqual(["300"]);
		await search(v, "ㄱㄴㄷ");
		expect(await rowsOf(v)).toEqual(["100"]);
		await search(v, " ㅅㅇㅈ ");
		expect(await rowsOf(v)).toEqual(["200"]);
		await search(v, "모임");
		expect(await rowsOf(v)).toEqual(["100"]);
		await search(v, "zzz");
		expect(await rowsOf(v)).toEqual([]);
		expect(await q(v, `return document.querySelector("#kk-nomatch").textContent`)).toBe("찾는 대화방이 없어요");
		await shot(v, "09-desktop-search-empty.png");
		await search(v, "");
		expect(await rowsOf(v)).toEqual(["100", "200", "300"]);
		expect(await q(v, `return !document.querySelector("#kk-nomatch")`)).toBe(true);
		expect(await q(v, `return [kkMatch("Book Club", "bOOK"), kkMatch("가나다 모임", "나다"), kkMatch("가나다", "ㄴ"), kkMatch("가나다", "ㄹ"), kkMatch("가나다", "가ㄴ")]`)).toEqual([true, true, true, false, false]);
	});

	test("the rows keep toggling while filtered, and the query survives the repaint; the watched rows behind the dialog are not filtered", async () => {
		await search(v, "라마");
		await run(v, `document.querySelector('.kk-pr[data-chat="300"]').focus(); document.querySelector('.kk-pr[data-chat="300"]').click()`);
		expect((await expectReq(isReq("PUT", "/api/kakao/rooms/300"))).body).toEqual({ watched: false });
		await waitFor(v, `document.querySelector('.kk-pr[data-chat="300"]').getAttribute("aria-checked") === "false"`);
		expect(await rowsOf(v)).toEqual(["300"]);
		expect(await q(v, `return document.activeElement.dataset.chat`)).toBe("300");   // the repaint keeps the keyboard on the row
		expect(await q(v, `return [document.querySelector("#kk-q").value, [...document.querySelectorAll(".kk-row")].map(r => r.dataset.chat)]`)).toEqual(["라마", ["100"]]);
		await search(v, "사아");
		await run(v, `document.querySelector('.kk-pr[data-chat="200"]').click()`);
		await expectReq(isReq("PUT", "/api/kakao/rooms/200"));
		await waitFor(v, `document.querySelector('.kk-row[data-chat="200"]')`);
		expect(await rowsOf(v)).toEqual(["200"]);
	});
});

describe("empty and error states", async () => {
	const v = await open(1280, 800);

	test("no room chosen: one line asks to add one; 추가 lists every room", async () => {
		reset();
		for (const r of rooms) r.watched = false;
		await boot(v);
		expect(await q(v, `return [!!document.querySelector("#kk-empty"), document.querySelectorAll(".kk-row").length, !!document.querySelector("#kk-add")]`)).toEqual([true, 0, false]);
		await run(v, `document.querySelector("#kk-add-btn").click()`);
		await waitFor(v, `document.querySelector("#kk-add")`);
		expect(await q(v, `return document.querySelectorAll(".kk-pr").length`)).toBe(3);
		await shot(v, "06-desktop-empty.png");
	});

	test("an error from the rooms route is one plain line", async () => {
		reset();
		roomsAnswer = { on: true, rooms: [], error: "카카오톡 데이터베이스를 읽을 수 없어요" };
		await boot(v);
		expect(await q(v, `return [...document.querySelectorAll(".kk-rooms .kk-note")].map(n => n.textContent)`)).toEqual(["카카오톡 데이터베이스를 읽을 수 없어요"]);
	});

	test("integration off is one plain line", async () => {
		reset();
		roomsAnswer = { on: false, rooms: [] };
		await boot(v);
		expect(await q(v, `return [...document.querySelectorAll(".kk-rooms .kk-note")].map(n => n.textContent)`)).toEqual(["카카오톡 연동이 꺼져 있어요"]);
	});
});

const MEDIA = (): Msg[] => [
	mk("5001", "가나", "", at(23, 3, 0), 2, { kind: "photo", w: 320, h: 240, count: 1, expired: false }),
	mk("5002", "가나", "", at(23, 3, 0, 20), 27, { kind: "photo", w: 200, h: 300, count: 8, expired: false }),
	mk("5003", "다라", "", at(23, 3, 1), 3, { kind: "video", w: 640, h: 360, d: 75, expired: false }),
	mk("5004", "가나", "", at(23, 3, 2), 5, { kind: "voice", d: 8, expired: false }),
	mk("5005", "me", "", at(23, 3, 3), 18, { kind: "file", name: "보고서.pdf", size: 2048, local: true, expired: false }),
	mk("5006", "가나", "", at(23, 3, 4), 18, { kind: "file", name: "<b>큰파일</b>.zip", size: 5 * 1048576, local: false, expired: true }),
	mk("5007", "다라", "", at(23, 3, 5), 2, { kind: "photo", w: 320, h: 240, count: 1, expired: true }),
	mk("5008", "가나", "", at(23, 3, 6), 2, { kind: "photo", w: 320, h: 240, count: 1, expired: false }),
	mk("5009", "가나", "", at(23, 3, 7), 20, { kind: "emoticon", alt: "(이모티콘) 하트" }),
	mk("5010", "다라", "나도 좋아", at(23, 3, 8), 26, { kind: "reply", quote: "점심 뭐 먹을까", quoteSender: "가나", srcLogId: "3002" }),
	mk("5011", "가나", "", at(23, 3, 9), 16, { kind: "location", label: "서울 강남구", lat: 37.5, lng: 127.03 }),
	mk("5012", "가나", "다라님이 들어왔어요", at(23, 3, 10), 0),
	mk("5013", "가나", "알림 메시지", at(23, 3, 11), 71),
	mk("5014", "다라", "", at(23, 3, 12), 99),
	mk("5015", "가나", "", at(23, 3, 13), 12, { kind: "emoticon", alt: "(이모티콘) 카카오 이모티콘", text: "고마워 <b>x</b>" }),
];
const useMedia = () => { reset(); msgs = MEDIA(); drafts = []; };

describe("카카오톡 media at desktop width", async () => {
	const v = await open(1280, 800);

	test("a photo is a lazy rounded thumbnail from the media route, no colored bubble, at most 240px wide", async () => {
		useMedia();
		await boot(v);
		await openRoom(v);
		await run(v, `document.querySelector('#kk-tl').scrollTop = 0`);
		const s = await q<Record<string, any>>(v, `
			const b = document.querySelector('[data-log="5001"] .kk-photo'), img = b.querySelector("img"), r = b.getBoundingClientRect();
			return { src: img.getAttribute("src"), loading: img.getAttribute("loading"), alt: img.alt, w: r.width, h: r.height, bubble: !!document.querySelector('[data-log="5001"] .kk-bub'), bg: getComputedStyle(document.querySelector('[data-log="5001"] .kk-media')).backgroundColor, radius: parseFloat(getComputedStyle(b).borderTopLeftRadius), text: document.querySelector('[data-log="5001"]').textContent.includes("(사진)") }`);
		expect(s).toMatchObject({ src: "/api/kakao/media/100/5001?i=0&v=thumb", loading: "lazy", alt: "사진", bubble: false, text: false });
		expect(s.w).toBeLessThanOrEqual(240);
		expect(s.w).toBeGreaterThan(150);
		expect(Math.abs(s.w / s.h - 320 / 240)).toBeLessThan(0.05);
		expect(s.radius).toBeGreaterThanOrEqual(8);
		expect(s.bg).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
		await expectReq(isReq("GET", "/api/kakao/media/100/5001?i=0&v=thumb"));
	});

	test("an album is a 3-column grid of at most 6 tiles with +N on the last; a tile opens the viewer at its index and the arrows page through", async () => {
		const g = await q<Record<string, any>>(v, `
			const a = document.querySelector('[data-log="5002"] .kk-album'), tiles = [...a.querySelectorAll(".kk-photo")];
			return { cols: a.className, n: tiles.length, more: tiles[5].querySelector(".kk-more-n").textContent, srcs: tiles.map(t => t.querySelector("img").getAttribute("src")), w: a.getBoundingClientRect().width, tw: tiles[0].getBoundingClientRect().width, th: tiles[0].getBoundingClientRect().height, cw: getComputedStyle(a).gridTemplateColumns.split(" ").length }`);
		expect(g.n).toBe(6);
		expect(g.cols).toContain("c3");
		expect(g.cw).toBe(3);
		expect(g.more).toBe("+3");
		expect(g.srcs[1]).toBe("/api/kakao/media/100/5002?i=1&v=thumb");
		expect(g.w).toBeLessThanOrEqual(240);
		expect(g.tw).toBeLessThan(90);
		expect(Math.abs(g.tw - g.th)).toBeLessThan(2);
		await run(v, `document.querySelectorAll('[data-log="5002"] .kk-photo')[1].click()`);
		await waitFor(v, `document.querySelector('dialog.kk-vwd[open] img')`);
		const w = () => q<Record<string, any>>(v, `const d = document.querySelector("dialog.kk-vwd"); return { title: d.querySelector(".lb-n").textContent, src: d.querySelector("img").getAttribute("src"), prev: d.querySelector('[data-k="prev"]').hidden, next: d.querySelector('[data-k="next"]').hidden, video: !!d.querySelector("video") }`);
		expect(await w()).toEqual({ title: "사진 2 / 8", src: "/api/kakao/media/100/5002?i=1&v=full", prev: false, next: false, video: false });
		await run(v, `document.querySelector('dialog.kk-vwd [data-k="next"]').click()`);
		expect((await w()).src).toBe("/api/kakao/media/100/5002?i=2&v=full");
		await run(v, `document.querySelector('dialog.kk-vwd [data-k="close"]').click()`);
		await waitFor(v, `!document.querySelector('dialog.kk-vwd')`);
	});

	test("a video shows its thumbnail with a play icon and the length; tapping plays it with controls in the viewer", async () => {
		await waitFor(v, `document.querySelector('[data-log="5003"] .kk-video .kk-dur') && !document.querySelector("dialog.kk-vwd")`);
		const s = await q<Record<string, any>>(v, `const b = document.querySelector('[data-log="5003"] .kk-video'); return { play: !!b.querySelector(".kk-play"), dur: b.querySelector(".kk-dur").textContent, src: b.querySelector("img").getAttribute("src"), label: b.getAttribute("aria-label") }`);
		expect(s).toEqual({ play: true, dur: "1:15", src: "/api/kakao/media/100/5003?i=0&v=thumb", label: "동영상 재생" });
		await run(v, `document.querySelector('[data-log="5003"] .kk-video').click()`);
		await waitFor(v, `document.querySelector('dialog.kk-vwd[open] video[controls]')?.getAttribute("src") === "/api/kakao/media/100/5003?i=0&v=full"`);
		await run(v, `document.querySelector('dialog.kk-vwd [data-k="close"]').click()`);
		await waitFor(v, `!document.querySelector('dialog.kk-vwd')`);
	});

	test("voice is a compact audio control that loads nothing until played; files are cards: 열기 when downloaded here, else PC에 없음", async () => {
		const s = await q<Record<string, any>>(v, `
			const a = document.querySelector('[data-log="5004"] audio'), f1 = document.querySelector('[data-log="5005"] .kk-bub.file'), f2 = document.querySelector('[data-log="5006"] .kk-bub.file'), open = f1.querySelector("a.kk-open");
			return { audio: [a.controls, a.getAttribute("preload"), a.getAttribute("src")], f1: [f1.querySelector(".kk-fn").textContent, f1.querySelector(".kk-sub").textContent, open.textContent, open.getAttribute("href"), open.getAttribute("target"), !!f1.querySelector("svg")],
				f2: [f2.querySelector(".kk-fn").textContent, f2.querySelector("a"), f2.querySelector(".kk-nopc").textContent, f2.querySelector(".kk-sub").textContent], tags: f2.querySelectorAll(".kk-fn *").length }`);
		expect(s.audio).toEqual([true, "none", "/api/kakao/media/100/5004?i=0&v=full"]);
		expect(s.f1).toEqual(["보고서.pdf", "2KB", "열기", "/api/kakao/media/100/5005/file", "_blank", true]);
		expect(s.f2[0]).toBe("<b>큰파일</b>.zip");
		expect(s.f2[1]).toBeNull();
		expect(s.f2[2]).toBe("PC에 없음");
		expect(s.f2[3]).toContain("5.0MB");
		expect(s.tags).toBe(0);
		expect(reqs.some(r => r.path.startsWith("/api/kakao/media/100/5004"))).toBe(false);
	});

	test("an expired photo is a muted 기간이 지나 볼 수 없어요 card without a request; a thumbnail the server answers 410 for turns into one", async () => {
		expect(await q(v, `const c = document.querySelector('[data-log="5007"] .kk-bub.gone'); return [c.textContent, !!document.querySelector('[data-log="5007"] img')]`)).toEqual(["기간이 지나 볼 수 없어요", false]);
		expect(reqs.some(r => r.path.startsWith("/api/kakao/media/100/5007"))).toBe(false);
		await run(v, `document.querySelector('[data-log="5008"]').scrollIntoView()`);
		await waitFor(v, `document.querySelector('[data-log="5008"] .kk-photo.gone .kk-gonet')`);
		expect(await q(v, `return document.querySelector('[data-log="5008"] .kk-gonet').textContent`)).toBe("기간이 지나 볼 수 없어요");
	});

	test("emoticon shows its alt, a reply quotes the source above its text, a location links to a map search, a feed line is a centered system line, other types fall back to text or (기타 메시지)", async () => {
		const s = await q<Record<string, any>>(v, `
			const t = id => document.querySelector('[data-log="' + id + '"]'), loc = t("5011").querySelector("a.kk-bub.loc"), sys = t("5012").querySelector(".kk-sys") || t("5012"), r = t("5012").getBoundingClientRect(), tl = document.querySelector("#kk-tl").getBoundingClientRect();
			return { emo: t("5009").querySelector(".kk-bub").textContent, qn: t("5010").querySelector(".kk-qn").textContent, qt: t("5010").querySelector(".kk-qt").textContent, rt: t("5010").querySelector(".kk-rt").textContent,
				loc: [loc.textContent, loc.getAttribute("href"), loc.getAttribute("target"), loc.getAttribute("rel")], sys: [sys.textContent, Math.abs((r.left + r.right) / 2 - (tl.left + tl.right) / 2) < 20, !!t("5012").querySelector(".kk-bub")],
				n71: t("5013").querySelector(".kk-bub").textContent, n99: t("5014").querySelector(".kk-bub").textContent }`);
		expect(s.emo).toBe("(이모티콘) 하트");
		// a sticker with text: the sticker placeholder on top, the text (as text, not markup) in its own bubble under it; a bare sticker has one bubble
		const e = await q<Record<string, any>>(v, `const t = id => document.querySelector('[data-log="' + id + '"]'), b = [...t("5015").querySelectorAll(".kk-emo .kk-bub")], bare = t("5009").querySelectorAll(".kk-bub");
			return { texts: b.map(x => x.textContent), cls: b.map(x => x.classList.contains("ph")), under: b.length === 2 && b[0].getBoundingClientRect().bottom <= b[1].getBoundingClientRect().top + 1, markup: !!t("5015").querySelector("b"), bare: bare.length, bareEmo: !!t("5009").querySelector(".kk-emo") }`);
		expect(e).toEqual({ texts: ["(이모티콘) 카카오 이모티콘", "고마워 <b>x</b>"], cls: [true, false], under: true, markup: false, bare: 1, bareEmo: false });
		expect([s.qn, s.qt, s.rt]).toEqual(["가나에게 답장원문 보기", "점심 뭐 먹을까", "나도 좋아"]);
		expect(s.loc[0]).toContain("위치: 서울 강남구");
		expect(s.loc[1]).toBe("https://map.kakao.com/link/map/" + encodeURIComponent("서울 강남구") + ",37.5,127.03");
		expect(s.loc.slice(2)).toEqual(["_blank", "noopener"]);
		expect(s.sys).toEqual(["다라님이 들어왔어요", true, false]);
		expect([s.n71, s.n99]).toEqual(["알림 메시지", "(지원하지 않는 메시지)"]);
		await shot(v, "10-desktop-media.png");
		await run(v, `document.querySelector("#kk-tl").scrollTop = 0`);
		await shot(v, "10-desktop-media-top.png");
	});
});

for (const [w, h] of [[1280, 800], [390, 844]] as const)
	describe(`카카오톡 사용자별 분석 at ${w}px`, async () => {
		const v = await open(w, h);

		test("tapping a sender's name opens the panel with the counted stats; 요약 분석 asks the model and shows the summary with its time", async () => {
			reset();
			await boot(v);
			await openRoom(v);
			await run(v, `document.querySelector('[data-log="3001"] .kk-name').click()`);
			await waitFor(v, `document.querySelector("dialog.kk-pd") && document.querySelector(".kk-prow")`);
			const s = await q<Record<string, any>>(v, `const d = document.querySelector("dialog.kk-pd"), r = d.getBoundingClientRect();
				return { name: d.querySelector(".cv-n").textContent, rows: [...d.querySelectorAll(".kk-prow")].map(x => x.textContent),
				hours: d.querySelectorAll(".kk-hist")[0].children.length, weekdays: d.querySelectorAll(".kk-hist")[1].children.length,
				unanswered: d.querySelector(".kk-put")?.textContent ?? null, btn: d.querySelector('[data-k="analyze"]').textContent,
				w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), vw: innerWidth, vh: innerHeight }`);
			expect(s.name).toBe("가나");
			expect(s.rows.join(" | ")).toContain("이 방 42개 · 지켜보는 방 120개 (4곳)");
			expect(s.rows.join(" | ")).toContain("상대 → 나 7분 · 나 → 상대 2분");
			expect(s.rows.join(" | ")).toContain("25% (10개)");
			expect([s.hours, s.weekdays, s.unanswered, s.btn]).toEqual([24, 7, "아주긴문장", "요약 분석"]);
			if (w === 390) {
				expect(s.w).toBe(s.vw);
				expect(Math.abs(s.h - s.vh)).toBeLessThanOrEqual(1);
			} else {
				expect(s.w).toBe(400);
				expect(s.right).toBe(s.vw);
			}
			await shot(v, `21-person-${w}.png`);

			await run(v, `document.querySelector('[data-k="analyze"]').click()`);
			expect((await expectReq(r => r.method === "POST" && r.path === "/api/kakao/person/u1/analyze")).body).toEqual({ room: "100" });
			await waitFor(v, `document.querySelector(".kk-sum .kk-dt")?.textContent.includes("일정을 자주")`);
			const sum = await q<Record<string, any>>(v, `const s = document.querySelector(".kk-sum"); return { text: s.querySelector(".kk-dt").textContent, at: s.querySelector(".kk-sub").textContent, btn: s.querySelector('[data-k="analyze"]').textContent }`);
			expect(sum.text).toBe("가나와는 일정을 자주 맞추는 사이예요.");
			expect(sum.at).toContain("에 만든 요약");
			expect(sum.btn).toBe("다시 분석");
			await shot(v, `22-person-summary-${w}.png`);
			await run(v, `document.querySelector('dialog.kk-pd [data-k="close"]').click()`);
			await waitFor(v, `!document.querySelector("dialog.kk-pd")`);
		});

		test("a person with nothing counted draws no empty section: no chart, no zero row, and the summary part is only its button", async () => {
			reset();
			await boot(v);
			const s = await q<Record<string, any>>(v, `const d = document.createElement("dialog"), b = document.createElement("div"); kkPersonPaint(d, b, { stats: {} });
				return { hist: b.querySelectorAll(".kk-hist").length, rows: b.querySelectorAll(".kk-prow").length, heads: b.querySelectorAll(".kk-dh").length, btn: b.querySelector('[data-k="analyze"]')?.tagName ?? null, stray: [...b.childNodes].filter(n => n.nodeType !== 1).length }`);
			expect(s).toEqual({ hist: 0, rows: 0, heads: 1, btn: "BUTTON", stray: 0 });   // a section left out leaves nothing behind, not the word "null"
		});
	});

describe("카카오톡 방 목록 실시간 갱신", async () => {
	const v = await open(1280, 800);

	test("a kakao event updates another room's preview, time and unread at once; the open room's row follows the message just appended", async () => {
		reset();
		msgs = [...msgs, mk("9100", "다라", "라마바 새 말", at(26, 2, 0))];
		await boot(v);
		await openRoom(v, "100");
		const t0 = performance.now();
		emit({ kind: "kakao", chatId: "300", logId: "9100" });
		await waitFor(v, `document.querySelector('.kk-row[data-chat="300"] .cv-p').textContent === "라마바 새 말"`);
		const latency = performance.now() - t0;
		expect(await q(v, `const r = document.querySelector('.kk-row[data-chat="300"]'); return { hint: r.querySelector(".cv-p").textContent, badge: r.querySelector(".nb")?.textContent ?? "", time: r.querySelector(".kk-t").textContent }`)).toMatchObject({ hint: "라마바 새 말", badge: "1" });
		expect(latency).toBeLessThan(1000);

		msgs.push(mk("9101", "다라", "열린 방 새 말", at(26, 2, 1)));
		emit({ kind: "kakao", chatId: "100", logId: "9101" });
		await waitFor(v, `document.querySelector('.kk-row[data-chat="100"] .cv-p').textContent === "열린 방 새 말"`);
		await waitFor(v, `document.querySelector('[data-log="9101"]')`);
		expect(await q(v, `return document.querySelector('.kk-row[data-chat="100"] .cv-p').textContent`)).toBe("열린 방 새 말");
		await shot(v, "19-desktop-live-list.png");
	});
});

describe("카카오톡 지원하지 않는 메시지와 빈 줄", async () => {
	const v = await open(1280, 800);

	test("a JSON record is never a bubble (neutral label), an empty system line leaves no row, and no large blank gaps remain", async () => {
		reset();
		msgs = [
			mk("9201", "가나", "첫 말", at(27, 1, 0)),
			mk("9202", "가나", "", at(27, 1, 0, 20), 17),
			mk("9203", "가나", "", at(27, 1, 0, 30), 0),
			mk("9204", "다라", '{"attachment":{"type":17}}', at(27, 1, 1), 17),
			mk("9205", "다라", "마지막 말", at(27, 1, 2)),
		];
		drafts = [];
		await boot(v);
		await openRoom(v);
		const s = await q<Record<string, any>>(v, `const texts = id => document.querySelector('[data-log="' + id + '"] .kk-bub')?.textContent ?? null;
			return { n9201: texts("9201"), n9202: texts("9202"), n9204: texts("9204"), n9203: !!document.querySelector('[data-log="9203"]'), raw: document.querySelector("#kk-tl").textContent.includes('{"attachment"') }`);
		expect(s).toMatchObject({ n9201: "첫 말", n9202: "(지원하지 않는 메시지)", n9204: "(지원하지 않는 메시지)", n9203: false, raw: false });
		const gaps = await q<{ max: number; tall: number; rows: number }>(v, `const rs = [...document.querySelectorAll("#kk-tl .kk-m")].map(n => n.getBoundingClientRect()); let max = 0; for (let i = 1; i < rs.length; i++) max = Math.max(max, rs[i].top - rs[i - 1].bottom); return { max, tall: Math.max(...rs.map(r => r.height)), rows: rs.length }`);
		expect(gaps.rows).toBe(4);
		expect(gaps.max).toBeLessThan(40);
		expect(gaps.tall).toBeLessThan(160);
		await run(v, `document.querySelector("#kk-tl").scrollTop = 0`);
		await shot(v, "20-desktop-unsupported.png");
	});
});

describe("카카오톡 이전 메시지 자동 불러오기", async () => {
	const v = await open(1280, 800);

	test("reaching the top loads the older page once and keeps the anchor message at its offset; the button stays, and loading stops at the room's beginning", async () => {
		reset();
		msgs = Array.from({ length: 120 }, (_, i) => mk(String(9001 + i), i % 2 ? "다라" : "가나", `옛 대화 ${i}`, at(26, 1, 0, i)));
		drafts = [];
		await boot(v);
		await openRoom(v);
		const pages = () => reqs.filter(r => r.method === "GET" && r.path.startsWith("/api/kakao/chat/100?")).length;
		expect(await q(v, `return !!document.querySelector("#kk-top") && document.querySelector("#kk-top button").textContent === "이전 메시지 더 보기"`)).toBe(true);
		expect(pages()).toBe(1);

		const before = await q<{ top: number; scroll: number }>(v, `const t = document.querySelector("#kk-tl").getBoundingClientRect().top; document.querySelector("#kk-tl").scrollTop = 0; return { top: document.querySelector('[data-log="9071"]').getBoundingClientRect().top - t, scroll: document.querySelector("#kk-tl").scrollTop }`);
		expect(before.scroll).toBe(0);
		await expectReq(r => r.method === "GET" && r.path.includes("before=9071"));
		await waitFor(v, `document.querySelector('[data-log="9021"]')`);
		const after = await q<{ top: number; first: string; scroll: number }>(v, `const t = document.querySelector("#kk-tl").getBoundingClientRect().top, tl = document.querySelector("#kk-tl"); return { top: document.querySelector('[data-log="9071"]').getBoundingClientRect().top - t, first: [...tl.querySelectorAll("[data-log]")][0].dataset.log, scroll: tl.scrollTop }`);
		expect(after.first).toBe("9021");
		expect(Math.round(Math.abs(after.top - before.top))).toBeLessThanOrEqual(2);   // layout positions are fractional
		expect(after.scroll).toBeGreaterThan(0);
		expect(pages()).toBe(2);
		await shot(v, "18-desktop-autoolder.png");

		await run(v, `document.querySelector("#kk-tl").scrollTop = 0`);
		await expectReq(r => r.method === "GET" && r.path.includes("before=9021"));
		await waitFor(v, `!document.querySelector("#kk-top")`);
		expect(pages()).toBe(3);
		await run(v, `document.querySelector("#kk-tl").scrollTop = 0`);
		await v.evaluate("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(0))))");
		expect(pages()).toBe(3);
	});
});

describe("카카오톡 link previews at 390px", async () => {
	const v = await open(390, 844);

	test("the preview card fits the phone width without a sideways scroll", async () => {
		reset();
		msgs = [mk("8101", "가나", "지도 https://maps.app.goo.gl/abc", at(25, 2, 0))];
		drafts = [];
		await boot(v);
		await openRoom(v);
		await waitFor(v, `document.querySelector('[data-log="8101"] .kk-lp .kk-lp-t')`);
		const s = await q<Record<string, number>>(v, `const c = document.querySelector('[data-log="8101"] .kk-lp').getBoundingClientRect(), t = document.querySelector("#kk-tl"); return { right: c.right, vw: innerWidth, w: c.width, h: t.scrollWidth - t.clientWidth }`);
		expect(s.right).toBeLessThanOrEqual(s.vw);
		expect(s.w).toBeLessThanOrEqual(260);
		expect(s.h).toBeLessThanOrEqual(0);
		await shot(v, "16-mobile-link-preview.png");
	});
});

describe("카카오톡 요청 입력창", async () => {
	const v = await open(1280, 800);

	test("the reply card sits under the chat window and above the bar (status line, chat, card, bar); with no draft waiting a request makes a 새 메시지 초안 through the same draft route", async () => {
		reset();
		drafts = [];
		await boot(v);
		await openRoom(v);
		const g = await q<{ gap: number; formAfterWindow: boolean }>(v, `const w = document.querySelector(".kk-box").getBoundingClientRect(), f = document.querySelector("#kk-form").getBoundingClientRect(); return { gap: Math.round(f.top - w.bottom), formAfterWindow: f.top >= w.bottom }`);
		expect(g.formAfterWindow).toBe(true);
		expect(g.gap).toBeLessThanOrEqual(16);
		expect(await q(v, `return [...document.querySelectorAll("#kk-owed, #kk-chat > .kk-box, #kk-drafts, #kk-form")].map(e => e.id || "box")`)).toEqual(["kk-owed", "box", "kk-drafts", "kk-form"]);
		await run(v, `const t = document.querySelector("#kk-text"); t.value = "내일 7시로 미루자고 정중하게"; t.dispatchEvent(new Event("input", { bubbles: true })); document.querySelector("#kk-send-btn").click()`);
		expect((await expectReq(r => r.method === "POST" && r.path === "/api/kakao/chat/100/draft")).body).toEqual({ intent: "내일 7시로 미루자고 정중하게" });
		await waitFor(v, `document.querySelector('.kk-draft[data-code="di"] .kk-dp') && !document.querySelector("#kk-draft-btn").disabled`);
		const card = await q<Record<string, any>>(v, `const c = document.querySelector('.kk-draft[data-code="di"]'), f = document.querySelector("#kk-form").getBoundingClientRect(), bs = [...c.querySelectorAll(".rq-acts .btn")]; return { head: c.querySelector(".kk-dh").textContent, parts: [...c.querySelectorAll(".kk-dp")].map(p => p.textContent), buttons: bs.map(b => b.textContent), heights: [...new Set(bs.map(b => b.getBoundingClientRect().height))], pill: bs.some(b => parseFloat(getComputedStyle(b).borderRadius) >= b.getBoundingClientRect().height / 2), above: c.getBoundingClientRect().bottom <= f.top }`);
		expect(card).toEqual({ head: "새 메시지 초안 · 메시지 2개", parts: ["내일 7시로 미루는 게 어떨까요?", "일정 조정해 주세요"], buttons: ["보내기", "고치기", "보내지 않기"], heights: [32], pill: false, above: true });   // a new message answers nothing, so its card keeps 보내지 않기
		await shot(v, "17-desktop-compose.png");
	});

	const pv = await open(390, 844);
	test("on a phone the request bar fits the width and the card sits above it", async () => {
		reset();
		drafts = [];
		await boot(pv);
		await openRoom(pv);
		await run(pv, `const t = document.querySelector("#kk-text"); t.value = "내일 7시로 미루자고 정중하게"; t.dispatchEvent(new Event("input", { bubbles: true })); document.querySelector("#kk-send-btn").click()`);
		await waitFor(pv, `document.querySelector('.kk-draft[data-code="di"] .kk-dp')`);
		const s = await q<Record<string, number>>(pv, `const c = document.querySelector('.kk-draft[data-code="di"]').getBoundingClientRect(), f = document.querySelector("#kk-form").getBoundingClientRect(); return { right: Math.max(c.right, f.right), vw: innerWidth, cardBottom: c.bottom, formTop: f.top }`);
		expect(s.right).toBeLessThanOrEqual(s.vw);
		expect(s.cardBottom).toBeLessThanOrEqual(s.formTop);
		await shot(pv, "17-mobile-compose.png");
	});
});

describe("카카오톡 이전 메시지 자동 불러오기 at 390px", async () => {
	const v = await open(390, 844);

	test("reaching the top on a phone loads the older page once and keeps the anchor message at its offset", async () => {
		reset();
		msgs = Array.from({ length: 120 }, (_, i) => mk(String(9301 + i), i % 2 ? "다라" : "가나", `옛 대화 ${i}`, at(26, 2, 0, i)));
		drafts = [];
		await boot(v);
		await openRoom(v);
		const before = await q<number>(v, `const t = document.querySelector("#kk-tl").getBoundingClientRect().top; document.querySelector("#kk-tl").scrollTop = 0; return document.querySelector('[data-log="9371"]').getBoundingClientRect().top - t`);
		await expectReq(r => r.method === "GET" && r.path.includes("before=9371"));
		await waitFor(v, `document.querySelector('[data-log="9321"]')`);
		const after = await q<{ top: number; first: string }>(v, `const t = document.querySelector("#kk-tl").getBoundingClientRect().top, tl = document.querySelector("#kk-tl"); return { top: document.querySelector('[data-log="9371"]').getBoundingClientRect().top - t, first: [...tl.querySelectorAll("[data-log]")][0].dataset.log }`);
		expect(after.first).toBe("9321");
		expect(Math.round(Math.abs(after.top - before))).toBeLessThanOrEqual(2);   // layout positions are fractional
		await shot(v, "18-mobile-autoolder.png");
	});
});

describe("카카오톡 link previews", async () => {
	const v = await open(1280, 800);

	test("an address is a link with a lazy preview card under the bubble; one request per address; a failed preview keeps only the link", async () => {
		reset();
		msgs = [
			mk("8001", "가나", "지도 https://maps.app.goo.gl/abc 확인해 줘", at(25, 1, 0)),
			mk("8002", "다라", "같은 지도 https://maps.app.goo.gl/abc", at(25, 1, 1)),
			mk("8003", "가나", "https://nopreview.example/x", at(25, 1, 2)),
		];
		drafts = [];
		await boot(v);
		await openRoom(v);
		const link = await q<Record<string, any>>(v, `const b = document.querySelector('[data-log="8001"] .kk-bub'), a = b.querySelector("a.kk-link"); return { href: a.getAttribute("href"), target: a.getAttribute("target"), rel: a.getAttribute("rel"), text: a.textContent, bubble: b.textContent, tags: b.querySelectorAll("a").length }`);
		expect(link).toMatchObject({ href: "https://maps.app.goo.gl/abc", target: "_blank", rel: "noopener noreferrer", text: "https://maps.app.goo.gl/abc", tags: 1 });
		expect(link.bubble).toBe("지도 https://maps.app.goo.gl/abc 확인해 줘");
		await waitFor(v, `document.querySelector('[data-log="8001"] .kk-lp .kk-lp-t')?.textContent === "강남 맛집 모음"`);
		const card = await q<Record<string, any>>(v, `const c = document.querySelector('[data-log="8001"] .kk-lp'); return { href: c.getAttribute("href"), site: c.querySelector(".kk-lp-s").textContent, desc: c.querySelector(".kk-lp-d").textContent, img: c.querySelector("img").getAttribute("src"), loading: c.querySelector("img").getAttribute("loading") }`);
		expect(card).toMatchObject({ href: "https://maps.app.goo.gl/abc", site: "Google Maps", desc: "지도에서 확인해 보세요", loading: "lazy" });
		expect(card.img).toContain("/api/link-preview/image?url=");
		await waitFor(v, `document.querySelector('[data-log="8002"] .kk-lp .kk-lp-t')`);
		// This page asks once per address: both addresses are cached, resolved, and no card is still waiting.
		const cache = await q<{ size: number; pending: number; keys: string[] }>(v, `return { size: KK.lp.size, pending: [...KK.lp.values()].filter(x => x && typeof x.then === "function").length, keys: [...KK.lp.keys()] }`);
		expect(cache).toEqual({ size: 2, pending: 0, keys: ["https://maps.app.goo.gl/abc", "https://nopreview.example/x"] });
		expect(new Set(reqs.filter(r => r.path.startsWith("/api/link-preview?url=")).map(r => new URL(`http://x${r.path}`).searchParams.get("url")))).toEqual(new Set(["https://maps.app.goo.gl/abc", "https://nopreview.example/x"]));
		await waitFor(v, `!document.querySelector('[data-log="8003"] .kk-lp')`);
		expect(await q(v, `return !!document.querySelector('[data-log="8003"] a.kk-link') && !document.querySelector('[data-log="8003"] .kk-lp')`)).toBe(true);
		await shot(v, "16-desktop-link-preview.png");
	});
});

describe("카카오톡 reply quotes", async () => {
	const v = await open(1280, 800);

	test("the quote names the original's author; a tap jumps to the original (loading the page around it when not shown); a source the room lacks says so", async () => {
		useMedia();
		msgs = [
			...OLD,
			...MEDIA(),
			...Array.from({ length: 12 }, (_, i) => mk(String(7001 + i), "가나", `채움 ${i}`, at(23, 4, 0, i))),
			mk("7100", "다라", "예전 얘기 답장", at(23, 5, 0), 26, { kind: "reply", quote: "예전 대화 2", quoteSender: "가나", srcLogId: "2003" }),
			mk("7101", "다라", "없는 얘기 답장", at(23, 5, 1), 26, { kind: "reply", quote: "사라진 글", quoteSender: "가나", srcLogId: "777777" }),
		];
		drafts = [];
		await boot(v);
		await openRoom(v);
		expect(await q(v, `return !!document.querySelector('[data-log="2003"]')`)).toBe(false);
		const quote = await q<Record<string, any>>(v, `const b = document.querySelector('[data-log="7100"] .kk-bub.reply'), c = b.querySelector(".kk-quote"); return { head: c.querySelector(".kk-qn").textContent, qt: c.querySelector(".kk-qt").textContent, src: c.getAttribute("data-src"), tag: c.tagName, disabled: c.disabled, label: c.getAttribute("aria-label"), w: Math.round(b.getBoundingClientRect().width), pos: getComputedStyle(c).position, inside: (() => { const r = c.getBoundingClientRect(), o = b.getBoundingClientRect(); return r.top >= o.top - 4 && r.bottom <= o.bottom + 4; })() }`);
		// the quote is part of its bubble (a global ".jump" rule once pulled it out to the bottom of the timeline) and says it leads to the original
		expect(quote).toMatchObject({ head: "가나에게 답장원문 보기", qt: "예전 대화 2", src: "2003", tag: "BUTTON", disabled: false, label: "원래 메시지로 이동", pos: "static", inside: true });
		expect(quote.w).toBeGreaterThanOrEqual(150);
		await run(v, `document.querySelector('[data-log="7100"] .kk-quote').click()`);
		await expectReq(r => r.method === "GET" && r.path.includes("around=2003"));
		await waitFor(v, `document.querySelector('[data-log="2003"]')?.classList.contains("kk-hl")`);
		const pos = await q<{ top: number; h: number }>(v, `const t = document.querySelector("#kk-tl").getBoundingClientRect(), m = document.querySelector('[data-log="2003"]').getBoundingClientRect(); return { top: m.top - t.top, h: t.height }`);
		expect(pos.top).toBeGreaterThanOrEqual(0);
		expect(pos.top).toBeLessThan(pos.h);
		await shot(v, "15-desktop-quote-jump.png");

		await run(v, `document.querySelector('[data-log="7101"] .kk-quote').click()`);
		await waitFor(v, `document.querySelector(".snack")?.textContent.includes("원래 메시지를 찾지 못했어요")`);
		expect(await q(v, `return !!document.querySelector('[data-log="7101"]') && KK.open === "100"`)).toBe(true);
	});

	test("a jump to a far older page marks the messages between as a gap (never drawn adjacent) and the gap fills page by page", async () => {
		useMedia();
		msgs = [
			...Array.from({ length: 200 }, (_, i) => mk(String(9001 + i), "가나", `긴 대화 ${i}`, at(22, 1, 0, i))),
			mk("9300", "다라", "아주 예전 얘기 답장", at(23, 5, 0), 26, { kind: "reply", quote: "긴 대화 9", quoteSender: "가나", srcLogId: "9010" }),
		];
		drafts = [];
		await boot(v);
		await openRoom(v);
		await run(v, `document.querySelector('[data-log="9300"] .kk-quote').click()`);
		await waitFor(v, `document.querySelector('[data-log="9010"]')?.classList.contains("kk-hl")`);
		// The around page ends at 9060 and the view starts at 9152: one gap, right after 9060, before 9152.
		const gap = () => q<string[]>(v, `return [...document.querySelectorAll(".kk-gap")].map(g => g.previousElementSibling?.dataset.log + ">" + (() => { let n = g.nextElementSibling; while (n && !n.dataset.log) n = n.nextElementSibling; return n?.dataset.log; })())`);
		expect(await gap()).toEqual(["9060>9152"]);
		await run(v, `document.querySelector('.kk-gap [data-k="gap"]').click()`);
		await expectReq(r => r.method === "GET" && r.path.includes("after=9060"));
		await waitFor(v, `!!document.querySelector('[data-log="9110"]')`);
		expect(await gap()).toEqual(["9110>9152"]);
		await run(v, `document.querySelector('.kk-gap [data-k="gap"]').click()`);
		await expectReq(r => r.method === "GET" && r.path.includes("after=9110"));
		await waitFor(v, `!document.querySelector(".kk-gap")`);
		expect(await q(v, `return [...document.querySelectorAll("[data-log]")].map(n => n.dataset.log).filter(id => id >= "9001" && id <= "9200").length`)).toBe(200);
	});
});

describe("카카오톡 media at 390px", async () => {
	const v = await open(390, 844);

	test("a photo is at most 200px wide and the timeline does not scroll sideways", async () => {
		useMedia();
		msgs = MEDIA().slice(0, 1);
		await boot(v);
		await openRoom(v);
		const s = await q<Record<string, number>>(v, `const r = document.querySelector('[data-log="5001"] .kk-photo').getBoundingClientRect(), t = document.querySelector("#kk-tl"); return { w: r.width, right: r.right, vw: innerWidth, h: t.scrollWidth - t.clientWidth }`);
		expect(s.w).toBeLessThanOrEqual(200);
		expect(s.w).toBeGreaterThan(120);
		expect(s.right).toBeLessThanOrEqual(s.vw);
		expect(s.h).toBeLessThanOrEqual(0);
		await shot(v, "11-mobile-photo.png");
	});

	test("the mix (album, file, reply, location) fits the phone width", async () => {
		useMedia();
		await boot(v);
		await openRoom(v);
		const h = await q<number>(v, `const t = document.querySelector('#kk-tl'); return t.scrollWidth - t.clientWidth`);
		expect(h).toBeLessThanOrEqual(0);
		await run(v, `document.querySelector('[data-log="5002"]').scrollIntoView()`);
		await shot(v, "12-mobile-media-mix.png");
		await run(v, `document.querySelector('[data-log="5005"]').scrollIntoView()`);
		await shot(v, "12-mobile-media-mix2.png");
	});
});

// One open chat room as KakaoTalk shows it: each sender's open profile name and avatar over his run, an emoticon as its image (a chip when
// there is none), a reply naming the original's author over the quote; an unwatched room opens read-only; 답장 안 함 clears the pill at the tap.
const OPEN_ROOM = (): Msg[] => {
	const o = (logId: string, authorId: string, sender: string, text: string, m: number, type = 1, media?: Record<string, unknown>): Msg => ({ logId, authorId, sender, text, type, sentAt: at(24, 1, m), fromMe: authorId === "me", unread: 0, ...(media ? { media } : {}) });
	return [
		o("6001", "u3", "전s", "오늘 세차 예약 되나요?", 0),
		o("6002", "u4", "출장세차는 빠루빠루맨 (상도동)", "네 가능합니다", 1),
		o("6003", "u4", "출장세차는 빠루빠루맨 (상도동)", "", 1, 20, { kind: "emoticon", alt: "카카오 이모티콘", image: true }),
		o("6004", "u5", "라라", "", 2, 12, { kind: "emoticon", alt: "카카오 이모티콘" }),
		o("6005", "me", "나", "저도 예약할게요", 3),
		o("6006", "u3", "전s", "나중에 연락드릴게요", 4, 26, { kind: "reply", quote: "네 가능합니다", quoteSender: "출장세차는 빠루빠루맨 (상도동)" }),
	];
};
const useOpen = () => {
	reset();
	msgs = OPEN_ROOM();
	drafts = [];
	rooms = [
		{ chatId: "400", name: "보컬 스터디 오픈채팅", kind: "open", watched: true, autoDraft: false, unread: 0, lastAt: at(24, 1, 4), hint: "나중에 연락드릴게요" },
		{ chatId: "300", name: "라마바", kind: "direct", watched: true, autoDraft: false, unread: 0, lastAt: at(21, 5, 0), unreplied: true },
		{ chatId: "200", name: "사아자 방", kind: "group", watched: false, autoDraft: false, unread: 0, lastAt: at(19, 5, 0) },
	];
};
for (const [w, h] of [[390, 844], [1280, 800]] as const)
	describe(`오픈채팅 room at ${w}px`, async () => {
		const v = await open(w, h);
		test("senders are named over their runs, the emoticon is an image (or one chip), the reply names the original's author", async () => {
			useOpen();
			await boot(v);
			await openRoom(v, "400");
			await waitFor(v, `document.querySelector('[data-log="6003"] .kk-sticker img')?.complete`);
			const s = await q<Record<string, any>>(v, `
				const t = id => document.querySelector('[data-log="' + id + '"]'), img = t("6003").querySelector(".kk-sticker img"), r = img.getBoundingClientRect(), tl = document.querySelector("#kk-tl");
				return { names: [...document.querySelectorAll("#kk-tl .kk-name")].map(n => n.textContent), avatars: document.querySelectorAll("#kk-tl .kk-av:not(.sp)").length, meName: !!t("6005").querySelector(".kk-name"),
					img: [img.getAttribute("src"), img.alt, img.naturalWidth > 0, Math.round(r.width) <= 120], chip: [...t("6004").querySelectorAll(".kk-bub")].map(b => b.textContent),
					qn: t("6006").querySelector(".kk-qn").textContent, qt: t("6006").querySelector(".kk-qt").textContent, rt: t("6006").querySelector(".kk-rt").textContent, hScroll: tl.scrollWidth - tl.clientWidth }`);
			expect(s.names).toEqual(["전s", "출장세차는 빠루빠루맨 (상도동)", "라라", "전s"]);
			expect(s.avatars).toBe(4);
			expect(s.meName).toBe(false);
			expect(s.img).toEqual(["/api/kakao/media/400/6003?i=0&v=full", "카카오 이모티콘", true, true]);
			expect(s.chip).toEqual(["카카오 이모티콘"]);
			expect([s.qn, s.qt, s.rt]).toEqual(["출장세차는 빠루빠루맨 (상도동)에게 답장", "네 가능합니다", "나중에 연락드릴게요"]);
			expect(s.hScroll).toBeLessThanOrEqual(0);
			await shot(v, `30-open-chat-${w}.png`);
			await dark(v);
			await shot(v, `30-open-chat-${w}-dark.png`);
			await light(v);
		});

		test("inside the 미답장 filter a row does not repeat the word 미답장; the other views still show it", async () => {
			useOpen();
			await boot(v);
			const pill = (view: string) => q<boolean>(v, `KK.view = "${view}"; return !!kkRow(KK.rooms.find(r => r.chatId === "300")).querySelector(".tag.unreplied")`);
			expect(await pill("all")).toBe(true);
			expect(await pill("unreplied")).toBe(false);
			await run(v, `KK.view = "all"`);
		});

		test("a room that is not watched opens read-only: no composer, a 감시 시작 bar that starts watching it", async () => {
			useOpen();
			await boot(v);
			await run(v, `kkOpen("200")`);
			await waitFor(v, `KK.open === "200" && !KK.loading && KK.placed`);
			const s = await q<Record<string, any>>(v, `const ro = document.querySelector("#kk-ro"); return { foot: document.querySelector("#kk-foot").hidden, ro: ro.hidden, text: ro.querySelector(".kk-ro-t").textContent, btn: ro.querySelector('[data-k="watch"]').textContent, h: Math.round(ro.querySelector('[data-k="watch"]').getBoundingClientRect().height), msgs: document.querySelectorAll("#kk-tl [data-log]").length }`);
			expect(s).toMatchObject({ foot: true, ro: false, text: "감시하지 않는 방이에요. 읽기만 할 수 있어요", btn: "감시 시작", msgs: 6 });
			expect(s.h).toBeGreaterThanOrEqual(32);   // docs/ui-spec.md 버튼: 작은 단계 32px
			await shot(v, `31-unwatched-${w}.png`);
			await run(v, `document.querySelector('#kk-ro [data-k="watch"]').click()`);
			expect((await expectReq(isReq("PUT", "/api/kakao/rooms/200"))).body).toEqual({ watched: true });
			await waitFor(v, `document.querySelector("#kk-ro").hidden && !document.querySelector("#kk-foot").hidden`);
			expect(await q(v, `return KK.open`)).toBe("200");
		});

		test("a draft of several messages shows one bubble per message in send order, and the header counts them", async () => {
			useOpen();
			drafts = [{ code: "dm", text: "내일 7시 괜찮아\n\n장소는 강남역 어때?\n\n늦으면 연락할게", parts: ["내일 7시 괜찮아", "장소는 강남역 어때?", "늦으면 연락할게"], basisLogId: "6006", created: at(24, 1, 5) }];
			await boot(v);
			await openRoom(v, "400");
			await waitFor(v, `document.querySelector('.kk-draft[data-code="dm"] .kk-dp')`);
			const s = await q<Record<string, any>>(v, `const c = document.querySelector('.kk-draft[data-code="dm"]'), r = c.getBoundingClientRect(); return { head: c.querySelector(".kk-dh").textContent, parts: [...c.querySelectorAll(".kk-dp")].map(p => p.textContent), right: r.right, vw: innerWidth }`);
			expect(s.head).toBe("답장 초안 · 메시지 3개");
			expect(s.parts).toEqual(["내일 7시 괜찮아", "장소는 강남역 어때?", "늦으면 연락할게"]);
			expect(s.right).toBeLessThanOrEqual(s.vw);
			await shot(v, `32-draft-parts-${w}.png`);
		});

		if (w === 1280)
			test("답장 안 함 takes the 미답장 pill off the line under the head and the room row at the tap, before any reload", async () => {
				useOpen();
				await boot(v);
				await openRoom(v, "300");
				await waitFor(v, `document.querySelector('#kk-owed .unrep-no')`);
				const s = await q<Record<string, boolean>>(v, `const before = !!document.querySelector('.kk-row[data-chat="300"] .tag.unreplied'); document.querySelector('#kk-owed .unrep-no').click();
					return { before, row: !!document.querySelector('.kk-row[data-chat="300"] .tag.unreplied'), line: !!document.querySelector("#kk-owed .tag.unreplied"), button: !!document.querySelector('#kk-owed .unrep-no') }`);
				expect(s).toEqual({ before: true, row: false, line: false, button: false });
				await expectReq(isReq("POST", "/api/kakao/chat/300/no-reply"));
			});

		if (w === 1280)
			test("the reply card's 답장 안 함 drops the draft and ends the room's 미답장 with it; 되돌리기 brings both back", async () => {
				useOpen();
				drafts = [{ code: "dw", text: "나중에 연락드릴게요", basisLogId: "6001", created: Date.now() }];
				await boot(v);
				await openRoom(v, "300");
				await waitFor(v, `document.querySelector('.kk-draft[data-code="dw"] [data-k="drop"]') && document.querySelector("#kk-owed .tag.unreplied")`);
				expect(await q(v, `return [document.querySelector('.kk-draft[data-code="dw"] [data-k="drop"]').textContent, document.querySelectorAll("#kk-owed .unrep-no").length]`)).toEqual(["답장 안 함", 0]);
				await run(v, `document.querySelector('.kk-draft[data-code="dw"] [data-k="drop"]').click()`);
				await expectReq(isReq("POST", "/api/kakao/drafts/dw/drop"));
				await expectReq(isReq("POST", "/api/kakao/chat/300/no-reply"));
				await waitFor(v, `!document.querySelector(".kk-draft") && !document.querySelector("#kk-owed .tag.unreplied") && !document.querySelector('.kk-row[data-chat="300"] .tag.unreplied')`);
				await run(v, `[...document.querySelectorAll(".snack button")].find(b => b.textContent === "되돌리기").click()`);
				await expectReq(isReq("DELETE", "/api/kakao/chat/300/no-reply"));
				await expectReq(isReq("POST", "/api/kakao/drafts/dw/restore"));
				await waitFor(v, `!!document.querySelector('.kk-draft[data-code="dw"]') && !!document.querySelector('.kk-row[data-chat="300"] .tag.unreplied') && !!document.querySelector("#kk-owed .tag.unreplied") && !document.querySelector("#kk-owed .unrep-no")`);
			});
	});

// 오픈채팅 rooms and the hint line: its newest message (or member count) under its name, the kind as a small mark after it, in the choice and in the rows.
for (const [w, h] of [[390, 844], [1280, 800]] as const)
	describe(`오픈채팅 and room hints at ${w}px`, async () => {
		const v = await open(w, h);
		test("an open chat room is listed with 오픈채팅 and its hint; similar rooms are told apart by their hints; nothing overflows", async () => {
			rooms = [
				{ chatId: "100", name: "가나다 모임", kind: "group", watched: true, autoDraft: false, unread: 0, lastAt: at(22, 1, 29), hint: "오늘 모임은 일곱 시예요" },
				{ chatId: "500", name: "보컬 스터디 오픈채팅", kind: "open", watched: true, autoDraft: true, unread: 3, lastAt: at(22, 1, 30), hint: "오늘 발성 연습 몇 시에 해요?" },
				{ chatId: "600", name: "가나, 다라 외 3명", kind: "group", watched: false, autoDraft: false, unread: 0, lastAt: at(21, 1, 0), hint: "회의 자료 올렸어요" },
				{ chatId: "601", name: "가나, 다라 외 3명", kind: "group", watched: false, autoDraft: false, unread: 0, lastAt: at(20, 1, 0), hint: "6명" },
			];
			await boot(v);
			const row = await q<string>(v, `return document.querySelector('.kk-row[data-chat="500"] .cv-p').textContent`);
			expect(row).toBe("오늘 발성 연습 몇 시에 해요?");
			expect(await q(v, `return document.querySelector('.kk-row[data-chat="500"] .kk-grp').textContent`)).toBe("오픈채팅");
			await run(v, `document.querySelector("#kk-add-btn").click()`);
			await waitFor(v, `document.querySelector('.kk-pr[data-chat="601"]')`);
			const pick = await q<Record<string, any>>(v, `const sub = id => document.querySelector('.kk-pr[data-chat="' + id + '"] .cv-p').textContent;
				const p = document.querySelector(".kk-rooms"), r = document.querySelector('.kk-pr[data-chat="500"]').getBoundingClientRect();
				return { open: sub("500"), a: sub("600"), b: sub("601"), hScroll: p.scrollWidth - p.clientWidth, right: r.right, w: innerWidth }`);
			expect(pick).toMatchObject({ open: "오늘 발성 연습 몇 시에 해요?", a: "회의 자료 올렸어요", b: "6명" });
			expect(pick.hScroll).toBeLessThanOrEqual(0);
			expect(pick.right).toBeLessThanOrEqual(pick.w);
			await shot(v, `20-open-hints-${w}.png`);
			await dark(v);
			await shot(v, `20-open-hints-${w}-dark.png`);
			await light(v);
		});
	});

// A room in a split pane (docs/split-panes.md 입력창): the request bar stays wholly inside the pane, on its floor and uncovered, with the chat and the reply
// cards scrolled to their ends, both while the pane is active and in its copy while another pane is.
describe("카카오톡 in a split pane (1280x800)", async () => {
	const v = await open(1280, 800);
	const bar = (scope: string) => q<Record<string, unknown>>(v, `const p = document.querySelector(${JSON.stringify(scope)}), f = p.querySelector(".kk-composer form"), pr = p.getBoundingClientRect();
		for (const e of p.querySelectorAll("*")) if (/(auto|scroll)/.test(getComputedStyle(e).overflowY)) e.scrollTop = 1e9;
		const r = f.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
		return { inside: r.top >= pr.top && r.bottom <= pr.bottom, floor: pr.bottom - r.bottom <= 24, below: [...p.querySelectorAll(".kk-chat > *")].some(x => x.getBoundingClientRect().height > 0 && x.getBoundingClientRect().top >= r.bottom), shown: !!hit && f.contains(hit) }`);
	test("the request bar stays on the pane's floor, active and inactive", async () => {
		await boot(v);
		await openRoom(v);
		// a split is the chat tab's (owner 8f7c8c3d): the room goes into a pane from there, the way its row of the chat list does
		await run(v, `go("chat", "main")`);
		await waitFor(v, `current === "chat" && target === "main" && CV.placed`);
		await run(v, `paneSplit(paneKkT("100"), "app", "right")`);
		await waitFor(v, `paneCount() === 2 && paneList().some(p => p.kind === "app" && p.active)`);
		try {
			await waitFor(v, `current === "monitoring" && KK.open === "100" && KK.placed && document.querySelector(".kk-drafts .kk-draft")`);
			expect(await bar("#split .pane.on")).toEqual({ inside: true, floor: true, below: false, shown: true });
			await run(v, `paneFocus(paneList().find(p => p.kind === "chat").id)`);
			await waitFor(v, `current === "chat" && document.querySelector("#split .pane:not(.on) .kk-composer form")`);
			expect(await bar("#split .pane:not(.on)")).toEqual({ inside: true, floor: true, below: false, shown: true });
			await shot(v, "21-split-pane.png");
		} finally {
			await run(v, `paneClose(paneList().find(p => p.kind === "app").id)`);
		}
	});
});
