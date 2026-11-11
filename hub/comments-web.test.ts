import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fakeHub, json, waitFor, run, type View } from "./test-web.ts";

// 모니터링 > 앱 > 유튜브 (web/js/30-monitoring-comments.js): the app entry's status line, the posts as conversations, the one reply card with
// 보내기 / 고치기 / 보내지 않기, a failed reply's 다시 보내기 / 지우기, run as shipped in a headless browser (Bun.WebView) against a stubbed
// /api/comments/* (docs/comments-api.md).
// Names and texts are placeholders. Screenshots are written only when COMMENTS_SHOTS names a folder.
const SHOTS = process.env.COMMENTS_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

type Req = { method: string; path: string; body: Record<string, unknown> | null };
const at = (d: number, h: number, m: number) => Date.UTC(2026, 9, d, h, m);
const COMMENTS = [
	{ id: "cm:youtube:c1", parent: null, author: "가나", text: "영상 잘 봤어요! 자막은 언제 나와요?", at: at(22, 1, 0), mine: false, needsReply: true },
	{ id: "cm:youtube:c2", parent: null, author: "다라", text: "<b>굵게</b> & <img src=x onerror=alert(1)> 그대로 보여야 해요", at: at(22, 1, 30), mine: false, needsReply: true },
	{ id: "cm:youtube:c3", parent: "c1", author: "나", text: "다음 주에 올릴게요", at: at(22, 2, 0), mine: true, needsReply: false },
];
let drafts: { code: string; commentId: string; text: string; notes: string[]; clean: boolean; created: number }[] = [];
let sends: { id: string; commentId: string; text: string; state: string; reason?: string; at: number }[] = [];
let reqs: Req[] = [];
let threadRows: Record<string, unknown>[] | null = null;
let waiters: { pred: (r: Req) => boolean; res: (r: Req) => void }[] = [];
const reset = () => { drafts = [{ code: "Dabc234", commentId: "cm:youtube:c1", text: "고마워요! 자막은 이번 주 안에 올릴게요.", notes: [], clean: true, created: at(22, 3, 0) }]; sends = []; reqs = []; waiters = []; threadRows = null; };
const record = (r: Req) => { reqs.push(r); waiters = waiters.filter(w => (w.pred(r) ? (w.res(r), false) : true)); };
const expectReq = (pred: (r: Req) => boolean, ms = 3500): Promise<Req> => {
	const have = reqs.find(pred);
	if (have) return Promise.resolve(have);
	return new Promise((res, rej) => {
		const t = setTimeout(() => rej(new Error(`no matching request; got ${JSON.stringify(reqs.map(r => `${r.method} ${r.path}`))}`)), ms);
		waiters.push({ pred, res: r => { clearTimeout(t); res(r); } });
	});
};


const hub = fakeHub({
	stream: "fake",
	api: async (req, url) => {
		const p = url.pathname;
		if (p === "/api/history") return json({ target: url.searchParams.get("target"), events: [] });
		if (p === "/api/activity") return json({ items: [], more: false, history: false });
		if (p === "/api/conversations") return json({ items: [] });
		if (p === "/api/notices") return json({ unread: 0, items: [] });
		if (p === "/api/monitors") return json({ items: [] });
		if (p === "/api/integrations") return json({ items: [{ key: "youtube", label: "유튜브", icon: "youtube", kind: "app", conv: [], notices: [], unread: 2, needs: { drafts: drafts.length, unread: 2, sentToday: 0 } }] });
		if (p === "/api/comments/sources") return json({ on: true, sources: [{ key: "youtube", kind: "youtube", label: "유튜브 댓글", watch: ["*"], autoDraft: false, autoSend: false, error: null, ranAt: at(22, 3, 0) }] });
		if (p === "/api/comments/threads") return json({ threads: threadRows ?? [{ source: "youtube", thread: "v1", title: "첫 번째 영상", link: "https://video.example/v1", lastAt: at(22, 2, 0), lastText: "다음 주에 올릴게요", lastAuthor: "나", unread: 2, drafts: drafts.length }] });
		if (p === "/api/integrations/youtube/settings") return json({ fields: [] });
		const body = req.method === "GET" ? null : ((await req.json().catch(() => ({}))) as Record<string, unknown>);
		if (p === "/api/comments/thread/youtube/v1" && req.method === "GET")
			return json({ source: { key: "youtube", kind: "youtube", label: "유튜브 댓글" }, thread: { id: "v1", title: "첫 번째 영상", link: "https://video.example/v1" }, comments: COMMENTS, read: null, drafts, sends });
		if (p === "/api/comments/thread/youtube/v1/read") { record({ method: "POST", path: p, body }); return json({ ok: true }); }
		const sf = /^\/api\/comments\/sends\/([^/]+)\/(retry|dismiss)$/.exec(p);
		if (sf && req.method === "POST") {
			record({ method: "POST", path: p, body });
			const id = decodeURIComponent(sf[1]!);
			if (sf[2] === "retry") { sends = sends.map(s => (s.id === id ? { ...s, state: "sent", reason: undefined } : s)); return json({ id, state: "sending" }, 202); }
			sends = sends.filter(s => s.id !== id);
			return json({ ok: true });
		}
		const d = /^\/api\/comments\/drafts\/(\w+)\/(send|drop|revise)$/.exec(p);
		if (d && req.method === "POST") {
			record({ method: "POST", path: p, body });
			if (d[2] === "send") { sends = [{ id: "send:cm:youtube:c1", commentId: "cm:youtube:c1", text: drafts[0]!.text, state: "sent", at: Date.now() }]; drafts = []; return json({ id: "send:cm:youtube:c1", state: "sending" }, 202); }
			if (d[2] === "drop") { drafts = []; return json({ ok: true }); }
			drafts = [{ ...drafts[0]!, code: "Dnew999", text: "짧게 답할게요." }];
			return json({ ok: true, code: "Dnew999" });
		}
	},
});

const open = (width: number, height: number): Promise<View> => hub.view({ width, height });
afterAll(() => { hub.stop(); });
beforeEach(reset);

const q = async <T = unknown>(v: View, code: string): Promise<T> => JSON.parse((await v.evaluate(`JSON.stringify((() => { ${code} })())`)) as string) as T;
const shot = async (v: View, name: string) => { if (SHOTS) await Bun.write(join(SHOTS, name), await v.screenshot()); };
const boot = async (v: View) => {
	const opened = hub.nextStream();
	await v.navigate(`${hub.origin}/`);
	await opened;
	await waitFor(v, `typeof NT !== "undefined" && NT.loaded && S`);
	await run(v, `if (dotzTheme.get() === "dark") dotzTheme.toggle()`);
	await waitFor(v, `typeof CM !== "undefined" && CM.apps.has("youtube")`);
	await run(v, `go("monitoring", "i:youtube")`);
	await waitFor(v, `!$("#cm").hidden && CM.loaded && document.querySelector("#cm .kk-row")`);
};

describe("댓글 on a phone (390x844)", async () => {
	const v = await open(390, 844);

	test("the app entry says what waits, the post is a conversation, and the draft sends once", async () => {
		await boot(v);
		const row = await q<{ name: string; badge: string }>(v, `const r = document.querySelector("#cm .kk-row"); return { name: r.querySelector(".cv-n").textContent, badge: r.querySelector(".nb").textContent }`);
		expect(row).toEqual({ name: "첫 번째 영상", badge: "초안 1" });
		await shot(v, "comments-list-390.png");

		await run(v, `document.querySelector("#cm .kk-row").click()`);
		await waitFor(v, `CM.open && !CM.loading && document.querySelector("#cm .kk-draft")`);
		const s = await q<{ names: string[]; texts: string[]; bubbles: number; xss: boolean; draft: string; buttons: string[]; overflow: boolean }>(v, `
			const ts = [...document.querySelectorAll("#cm .kk-bub")].map(b => b.textContent);
			return { names: [...document.querySelectorAll("#cm .kk-name")].map(n => n.textContent), texts: ts, bubbles: ts.length, xss: !!document.querySelector("#cm .kk-bub img, #cm .kk-bub b"),
				draft: document.querySelector("#cm .kk-dt").textContent, buttons: [...document.querySelectorAll("#cm .kk-draft .btn")].map(b => b.textContent), overflow: document.documentElement.scrollWidth > 390 }`);
		expect(s.names).toEqual(["가나", "다라"]);
		expect(s.bubbles).toBe(3);
		expect(s.texts[2]).toContain("<b>굵게</b>");
		expect(s.xss).toBe(false);
		expect(s.draft).toBe("고마워요! 자막은 이번 주 안에 올릴게요.");
		expect(s.buttons).toEqual(["보내기", "고치기", "보내지 않기"]);   // the one reply card's words (10-reply-card.js)
		expect(s.overflow).toBe(false);
		await shot(v, "comments-thread-390.png");

		await run(v, `document.querySelector('#cm [data-k="send"]').click(); document.querySelector('#cm [data-k="send"]').click()`);
		await expectReq(r => r.path === "/api/comments/drafts/Dabc234/send");
		await waitFor(v, `!document.querySelector("#cm .kk-draft") && document.querySelector("#cm .kk-m.me.pend.sent")`);
		expect(reqs.filter(r => r.path.endsWith("/send"))).toHaveLength(1);
		await shot(v, "comments-sent-390.png");
	});

	test("a post row is two lines with at most one marker: failed mail, then unanswered, then draft", async () => {
		const row = (thread: string, extra: Record<string, unknown>) => ({ source: "youtube", thread, title: `글 ${thread}`, link: null, lastAt: at(22, 2, 0), lastText: "마지막 댓글", lastAuthor: "가나", unread: 0, drafts: 0, unreplied: 0, ...extra });
		threadRows = [
			row("a", { unread: 2, drafts: 2, unreplied: 3, mails: { failed: 1, drafted: 1, sent: 1 } }),
			row("b", { unreplied: 2 }),
			row("c", { drafts: 1 }),
			row("d", {}),
			row("e", { drafts: 1, unreplied: 1 }),
		];
		await boot(v);
		const rows = await q<{ lines: number; marks: number; kind: string | null; text: string }[]>(v, `return [...document.querySelectorAll("#cm-rooms .kk-row")].map(r => ({ lines: r.querySelectorAll(".cv-b > *").length, marks: r.querySelectorAll(".kk-rmeta > *").length, kind: (r.querySelector("[data-mark]") || {dataset: {}}).dataset.mark || null, text: (r.querySelector("[data-mark]") || {}).textContent || "" }))`);
		expect(rows.map(r => r.lines)).toEqual([2, 2, 2, 2, 2]);   // title and the last comment, no third line
		expect(rows.map(r => r.marks)).toEqual([1, 1, 1, 0, 1]);
		expect(rows.map(r => r.kind)).toEqual(["failed", "unreplied", "draft", null, "unreplied"]);   // failed > unanswered > draft
		expect(rows.map(r => r.text)).toEqual(["실패 1", "미답장 2", "초안 1", "", "미답장 1"]);
		expect(await q(v, `return document.querySelectorAll("#cm-rooms .cm-tr, #cm-rooms .cm-st").length`)).toBe(0);
		await shot(v, "comments-markers-390.png");
	});

	test("replies stand under the comment they answer (his own marked), the draft sits under its comment, not pinned below, and each comment shows how far its follow-up got", async () => {
		await boot(v);
		await run(v, `document.querySelector("#cm .kk-row").click()`);
		await waitFor(v, `CM.open && !CM.loading && document.querySelector("#cm .kk-draft")`);
		const s = await q<{ roots: string[]; replies: string[]; mine: string; draftIn: string; row: string; quote: boolean; steps: string[]; owed: string[]; pinned: boolean }>(v, `
			const th = id => document.querySelector('#cm .cm-th[data-root="cm:youtube:' + id + '"]');
			return { roots: [...document.querySelectorAll("#cm .cm-th")].map(t => t.dataset.root), replies: [...th("c1").querySelectorAll(".cm-replies .kk-bub")].map(b => b.textContent),
				mine: th("c1").querySelector(".cm-mine").textContent, draftIn: th("c1").querySelector(".kk-draft") ? "c1" : "", row: th("c1").querySelector(".cm-c").textContent, quote: !!document.querySelector("#cm .cm-dq"),
				steps: [...th("c1").querySelectorAll(":scope > .cm-c .cm-st")].map(x => x.dataset.s + ":" + x.textContent), owed: [...th("c2").querySelectorAll(":scope > .cm-c .cm-st")].map(x => x.dataset.s + ":" + x.textContent), pinned: !document.querySelector("#cm-foot").hidden }`);
		expect(s.roots).toEqual(["cm:youtube:c1", "cm:youtube:c2"]);
		expect(s.replies).toEqual(["다음 주에 올릴게요"]);
		expect(s.mine).toBe("나 · 내 답글");
		expect(s.draftIn).toBe("c1");
		expect(s.row).toContain("영상 잘 봤어요! 자막은 언제 나와요?");   // the comment is the row right above its draft, so the draft repeats no quote of it
		expect(s.quote).toBe(false);
		expect(s.steps).toEqual(["done:초안", "ask:확인 대기", "todo:보냄"]);   // a pending draft: written, waits for his OK, not sent yet
		expect(s.owed).toEqual(["ask:초안 필요", "todo:확인", "todo:보냄"]);   // a comment that wants a reply and has no draft yet
		expect(s.pinned).toBe(false);
		// one bold lead per card (QA V11): per card (the conversation, the reply card inside it) at most one bold text; names, the "나 · 내 답글" mark and track names stay regular
		const bold = await q<number[]>(v, `const by = new Map(); for (const e of document.querySelectorAll("#cm-chat *")) { if (![...e.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim()) || !e.getClientRects().length || parseInt(getComputedStyle(e).fontWeight) < 600 || e.closest("button, .btn, .tag, .cm-st, .kk-av, .rq-av")) continue; const k = e.closest(".rq") || document.querySelector("#cm-chat"); by.set(k, (by.get(k) || 0) + 1); } return [...by.values()]`);
		expect(bold.every(n => n <= 1)).toBe(true);
	});

	test("고치기 asks what to change and shows the rewritten draft; 보내지 않기 removes it", async () => {
		await boot(v);
		await run(v, `document.querySelector("#cm .kk-row").click()`);
		await waitFor(v, `CM.open && !CM.loading && document.querySelector("#cm .kk-draft")`);
		await run(v, `document.querySelector('#cm [data-k="edit"]').click()`);
		await waitFor(v, `document.querySelector('#cm [data-k="revise-go"]')`);
		await run(v, `const i = document.querySelector("#cm .rq-edit input"); i.value = "더 짧게"; i.dispatchEvent(new Event("input")); document.querySelector('#cm [data-k="revise-go"]').click()`);
		const req = await expectReq(r => r.path === "/api/comments/drafts/Dabc234/revise");
		expect(req.body).toEqual({ change: "더 짧게" });
		await waitFor(v, `document.querySelector("#cm .kk-dt") && document.querySelector("#cm .kk-dt").textContent === "짧게 답할게요."`);
		await run(v, `document.querySelector('#cm [data-k="drop"]').click()`);
		await expectReq(r => r.path === "/api/comments/drafts/Dnew999/drop");
		await waitFor(v, `!document.querySelector("#cm .kk-draft")`);
	});

	// Owner 2026-11-04: typing what to change, then Backspace or moving the caret, wiped the field. The thread repaints on its own (the timer, a live
	// event, a read mark), and the repaint drew a fresh, empty field. What he typed stays, and so do the focus and the caret.
	test("고치기 keeps what he typed, the focus and the caret through Backspace, the arrow keys and a repaint", async () => {
		await boot(v);
		await run(v, `document.querySelector("#cm .kk-row").click()`);
		await waitFor(v, `CM.open && !CM.loading && document.querySelector("#cm .kk-draft")`);
		await run(v, `document.querySelector('#cm [data-k="edit"]').click()`);
		await waitFor(v, `document.querySelector("#cm .rq-edit input")`);
		await run(v, `document.querySelector("#cm .rq-edit input").focus()`);
		await v.type("shorter please");
		await v.press("Backspace");
		await v.press("ArrowLeft");
		await v.press("ArrowLeft");
		await run(v, `window.__in = document.querySelector("#cm .rq-edit input")`);
		await run(v, `cmPaintAll()`);   // what the timer or a live event does to the open thread
		sends = [{ id: "send:cm:youtube:c2", commentId: "cm:youtube:c2", text: "곧 올릴게요", state: "failed", reason: "403", at: at(22, 4, 0) }];
		await run(v, `cmReload()`);
		await waitFor(v, `CM.view && CM.view.sends.some(s => s.state === "failed")`);
		// the field being typed in is never replaced (a phone would drop and raise its keyboard): the same node keeps text, focus and caret
		const s = await q<{ same: boolean; value: string; focused: boolean; caret: number | null; go: boolean }>(v, `const i = document.querySelector("#cm .rq-edit input");
			return { same: i === window.__in, value: i.value, focused: document.activeElement === i, caret: i.selectionStart, go: !document.querySelector('#cm [data-k="revise-go"]').disabled }`);
		expect(s).toEqual({ same: true, value: "shorter pleas", focused: true, caret: 11, go: true });
		await v.type("X");   // still typing into the same field, at the caret
		expect(await q<string>(v, `return document.querySelector("#cm .rq-edit input").value`)).toBe("shorter pleXas");
		// leaving the field draws what arrived meanwhile (the failed reply's 다시 보내기); the text stays
		await run(v, `document.activeElement.blur()`);
		await waitFor(v, `document.querySelector('#cm [data-k="retry"]')`);
		expect(await q<string>(v, `return document.querySelector("#cm .rq-edit input").value`)).toBe("shorter pleXas");
		await run(v, `document.querySelector('#cm [data-k="revise-cancel"]').click()`);
		await run(v, `document.querySelector('#cm [data-k="edit"]').click()`);
		expect(await q<string>(v, `return document.querySelector("#cm .rq-edit input").value`)).toBe("");   // 취소 lets it go
	});

	test("a reply that did not go out offers 다시 보내기 and 지우기, and each posts once", async () => {
		sends = [{ id: "send:cm:youtube:c2", commentId: "cm:youtube:c2", text: "곧 올릴게요", state: "failed", reason: "403 forbidden", at: at(22, 4, 0) }];
		const v = await open(390, 844);
		await boot(v);
		await run(v, `document.querySelector("#cm .kk-row").click()`);
		await waitFor(v, `CM.view && CM.view.sends.length && document.querySelector('#cm [data-k="retry"]')`);
		const got = await q<{ state: string; buttons: string[] }>(v, `const s = document.querySelector("#cm .kk-m.pend.failed"); return { state: s.querySelector(".kk-state").textContent, buttons: [...s.querySelectorAll("button")].map(b => b.textContent) }`);
		expect(got.state).toBe("실패 · 403 forbidden");
		expect(got.buttons).toEqual(["다시 보내기", "지우기"]);
		await run(v, `document.querySelector('#cm [data-k="retry"]').click()`);
		await expectReq(r => r.path === "/api/comments/sends/send%3Acm%3Ayoutube%3Ac2/retry");
		await waitFor(v, `!document.querySelector("#cm [data-k=\\"retry\\"]")`);
		expect(reqs.filter(r => r.path.endsWith("/retry"))).toHaveLength(1);
		sends = [{ id: "send:cm:youtube:c2", commentId: "cm:youtube:c2", text: "곧 올릴게요", state: "failed", reason: "timeout", at: at(22, 4, 0) }];
		await run(v, `CM.view.sends = [{ id: "send:cm:youtube:c2", commentId: "cm:youtube:c2", text: "곧 올릴게요", state: "failed", reason: "timeout", at: ${at(22, 4, 0)} }]; cmPaintChat(false)`);
		await waitFor(v, `document.querySelector('#cm [data-k="dismiss"]')`);
		await run(v, `document.querySelector('#cm [data-k="dismiss"]').click()`);
		await expectReq(r => r.path === "/api/comments/sends/send%3Acm%3Ayoutube%3Ac2/dismiss");
		await waitFor(v, `!document.querySelector("#cm .kk-m.pend.failed")`);
		expect(reqs.filter(r => r.path.endsWith("/dismiss"))).toHaveLength(1);
		await shot(v, "comments-send-failed-390.png");
	});

	test("지켜볼 글 lives in the app's settings: the row shows the count and opens the picker, the post list has no section for it", async () => {
		await boot(v);
		expect(await q(v, `return document.querySelector("#cm-rooms").textContent.includes("지켜볼 글")`)).toBe(false);
		await run(v, `asScreen("youtube")`);
		await waitFor(v, `document.querySelector('[data-setting="watch-posts"] [data-k="pick-open"]')`);
		expect(await q(v, `return document.querySelector('[data-setting="watch-posts"] .as-v').textContent`)).toBe("전부");
		await run(v, `document.querySelector('[data-setting="watch-posts"] [data-k="pick-open"]').click()`);
		await waitFor(v, `document.querySelector('#cm-pick[open] .kk-pick-src[data-src="youtube"] [data-k="all"]')`);
		// the title is the sibling sheet's own heading (h2.fs-t, same size), and 지켜볼 글 고르기 is the settings list row: a button.li with a chevron
		expect(await q(v, `const d = document.querySelector('#cm-pick'), t = d.querySelector('.fs-t'), b = d.querySelector('[data-k="posts"]'); return { tag: t.tagName, size: getComputedStyle(t).fontSize, row: b.tagName + (b.classList.contains('li') ? '.li' : ''), chev: !!b.querySelector('.li-end svg') }`)).toEqual({ tag: "H2", size: "20px", row: "BUTTON.li", chev: true });
		await run(v, `document.querySelector('#cm-pick .fs-x').click(); ASC.h.close()`);
		await waitFor(v, `!CM.pickD && !ASC.h`);
	});

	test("the app list row says no count in its line: 미답장 and 안 읽음 stay with the row's number", async () => {
		await boot(v);
		await run(v, `go("monitoring", "list")`);
		await waitFor(v, `document.querySelector("#mon-side") && document.querySelector("#mon-side .cv-row")`);
		expect(await q(v, `const t = document.querySelector("#mon-side").textContent; return t.includes("답장 대기 1건") || t.includes("안 읽음 2")`)).toBe(false);
	});
});

describe("댓글 at 1280x800", async () => {
	const v = await open(1280, 800);

	test("the app takes the whole column: no list beside it, no empty pane until a post is picked, and ‹ 모니터링 returns to the list, the entry under the app is the list", async () => {
		const seen = () => q<Record<string, unknown>>(v, `return { list: !!document.querySelector("#mon-side").offsetParent, chat: !!document.querySelector("#cm-chat").offsetParent, rooms: document.querySelector("#cm-rooms").offsetWidth, back: document.querySelector("#back").hidden ? "" : document.querySelector("#back").textContent, hash: location.hash }`);
		await boot(v);
		const app = await seen();
		expect(app).toMatchObject({ list: false, chat: false, back: "모니터링" });
		expect(app.rooms).toBeGreaterThan(600);
		await run(v, `document.querySelector("#cm .kk-row").click()`);
		await waitFor(v, `CM.open && document.querySelector("#cm-chat").offsetParent`);
		expect((await seen()).rooms).toBe(300);
		await run(v, `document.querySelector("#back").click()`);
		await waitFor(v, `MON.list && document.querySelector("#mon-side").offsetParent`);
		expect(await seen()).toMatchObject({ back: "", hash: "#monitoring" });
		await run(v, `go("monitoring", "i:youtube")`);
		await waitFor(v, `!MON.list && !document.querySelector("#mon-side").offsetParent`);
		expect(await q(v, `return history.state.c`)).toEqual(["home", "monitoring", "monitoring/i%3Ayoutube"]);
	});
});
