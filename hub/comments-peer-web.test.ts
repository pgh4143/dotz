import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sseResponse } from "./events.ts";
import { appAsset, indexPage } from "./webapp.ts";

// The comment pane of another computer (web/js/30-monitoring-comments.js CM.pc): its sources, posts and thread are read through /api/peer/proxy, and every
// action of its draft and failed reply maps to one act for that computer (hub/peer-monitor.ts act "comments", web/js/34-peer-monitoring.js pqAct), so the
// pane and its one reply card work the same wherever the comments live. Headless; the other computer is a fixture.
const SHOTS = process.env.COMMENTS_PEER_SHOTS ?? join(tmpdir(), "comments-peer-shots");
mkdirSync(SHOTS, { recursive: true });
const MINI = "http://mini.test";
const at = (h: number, m: number) => Date.UTC(2026, 9, 22, h, m);
const COMMENTS = [
	{ id: "cm:youtube:c1", parent: null, author: "가나", text: "자막은 언제 나와요?", at: at(1, 0), mine: false, needsReply: true },
	{ id: "cm:youtube:c3", parent: "c1", author: "나", text: "곧 올릴게요", at: at(2, 0), mine: true, needsReply: false },
];
const DRAFTS = [{ code: "D1", commentId: "cm:youtube:c1", text: "고마워요! 이번 주 안에 올릴게요.", notes: [], clean: true, created: at(3, 0) }];
const SENDS = [{ id: "send:cm:youtube:c3", commentId: "cm:youtube:c3", text: "곧 올릴게요", state: "failed", reason: "403 forbidden", at: at(2, 5) }];
const YT = { key: "youtube", app: "youtube", label: "유튜브", icon: "chat", kind: "app", unread: 1, notices: [], needs: { drafts: 1, unread: 1, sentToday: 0 } };
const snapshot = () => ({ name: "맥미니", rev: "r1", monitors: [], notices: [], integrations: [YT], available: [], conversations: [], replies: [] });

const acts: { action: string; args: Record<string, unknown> }[] = [];
const gets: string[] = [];
const localPosts: { path: string; body: unknown }[] = [];
const json = (v: unknown, status = 200) => Response.json(v, { status });
const peerGet = (p: string): Response | null => {
	if (p === "/api/comments/sources") return json({ on: true, sources: [{ key: "youtube", kind: "youtube", label: "유튜브 댓글", watch: ["*"], autoDraft: false, autoSend: false, error: null, ranAt: at(3, 0) }] });
	if (p === "/api/comments/threads?app=youtube") return json({ threads: [{ source: "youtube", thread: "v1", title: "첫 번째 영상", link: "https://video.example/v1", lastAt: at(2, 0), lastText: "곧 올릴게요", lastAuthor: "나", unread: 1, drafts: 1 }] });
	if (p === "/api/comments/thread/youtube/v1") return json({ source: { key: "youtube", kind: "youtube", label: "유튜브 댓글" }, thread: { id: "v1", title: "첫 번째 영상", link: "https://video.example/v1" }, comments: COMMENTS, read: 1, drafts: DRAFTS, sends: SENDS });
	return null;
};
const server = Bun.serve({
	port: 0,
	hostname: "127.0.0.1",
	idleTimeout: 0,
	async fetch(req) {
		const url = new URL(req.url), p = url.pathname;
		if (p === "/") return indexPage(req);
		const asset = appAsset(req, p);
		if (asset) return asset;
		if (p === "/api/events") return sseResponse(req.headers.get("last-event-id") ?? url.searchParams.get("last"));
		if (p === "/api/state") return json({ name: "dotz", orchestrator: { status: "idle" }, lanes: [], terminals: {}, channels: { work: [] }, discord: {}, notices_unread: 1 });
		if (p === "/api/peers") return json([{ name: "맥북", url: `http://127.0.0.1:${server.port}`, self: true, online: true }, { name: "맥미니", url: MINI, self: false, online: true }]);
		if (p === "/api/machine") return json({ name: "맥북", custom: "", default: "맥북" });
		if (p === "/api/monitors") return json({ items: [] });
		if (p === "/api/notices") return json({ unread: 1, items: [] });
		if (p === "/api/integrations") return json({ items: [], available: [] });
		if (p === "/api/conversations") return json({ items: [] });
		if (p === "/api/replies") return json({ items: [] });
		if (p === "/api/monitoring/peers") return json([{ name: "맥미니", url: MINI, online: true, stale: false, items: snapshot() }]);
		if (p === "/api/peer/proxy") {
			if (req.method === "POST") { acts.push((await req.json()) as (typeof acts)[number]); return json({ ok: true }); }
			const pp = url.searchParams.get("p") ?? "";
			gets.push(pp);
			return peerGet(pp) ?? json({});
		}
		if (req.method !== "GET") { localPosts.push({ path: p, body: await req.json().catch(() => null) }); return json({ ok: true }); }
		return p.startsWith("/api/") ? json({}) : new Response("not found", { status: 404 });
	},
});

type View = InstanceType<typeof Bun.WebView>;
const views: View[] = [];
afterAll(() => { for (const v of views) v.close(); server.stop(true); });
const waitFor = (v: View, expr: string, ms = 10_000) =>
	v.evaluate(`new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("timeout: " + ${JSON.stringify(expr)})), ${ms}); const tick = () => { let ok = false; try { ok = !!(${expr}); } catch {} if (ok) { clearTimeout(t); res(true); } else requestAnimationFrame(tick); }; tick(); })`);
const q = async <R = unknown>(v: View, code: string): Promise<R> => JSON.parse((await v.evaluate(`JSON.stringify((() => { ${code} })())`)) as string) as R;
const run = (v: View, code: string) => v.evaluate(`(() => { ${code} })(), 0`);
const KEY = `p:${MINI}|i:youtube`;
const boot = async (width: number, height: number) => {
	gets.length = 0; localPosts.length = 0; acts.length = 0;
	const v = new Bun.WebView({ width, height });
	views.push(v);
	await v.navigate(`http://127.0.0.1:${server.port}/`);
	await waitFor(v, `S && NM.loaded && NT.loaded && PR.fresh && PQ.loaded && monItems().some(i => i.key === ${JSON.stringify(KEY)})`);
	await run(v, `if (dotzTheme.get() === "dark") dotzTheme.toggle()`);
	await run(v, `go("monitoring", ${JSON.stringify(KEY)})`);
	await waitFor(v, `!$("#cm").hidden && CM.pc && CM.pc.url === ${JSON.stringify(MINI)} && CM.loaded && document.querySelector("#cm .kk-row")`);
	return v;
};

describe.each([[390, 844], [1280, 900]])("another computer's comment app at %ipx", (width, height) => {
	test("its sources, post and draft come through the proxy, and its draft card is the one reply card", async () => {
		const v = await boot(width, height);
		expect(gets).toContain("/api/comments/sources");
		expect(gets).toContain("/api/comments/threads?app=youtube");
		await run(v, `document.querySelector("#cm .kk-row").click()`);
		await waitFor(v, `CM.open && !CM.loading && document.querySelector("#cm .kk-draft")`);
		const got = await q<{ head: string; pc: string; chip: string; attach: string; acts: string[]; tabs: number; overflow: boolean; pcWhole: string[] }>(v, `
			const c = document.querySelector("#cm .kk-draft"), txt = e => e ? e.textContent.trim() : "";
			return { head: txt(c.querySelector(".rq-meta")), pc: txt(c.querySelector(".mon-pc")), chip: txt(c.querySelector(".dr-chip")), attach: txt(c.querySelector(".rq-att")),
				acts: [...c.querySelectorAll(".rq-acts button")].map(txt), tabs: document.querySelectorAll("#cm .cm-tabs").length,
				overflow: document.documentElement.scrollWidth > innerWidth,
				pcWhole: [0, 1].map(narrow => { const mt = c.querySelector(".rq-meta"); mt.style.maxWidth = narrow ? "120px" : ""; const m = mt.getBoundingClientRect(), p = c.querySelector(".mon-pc").getBoundingClientRect(); mt.style.maxWidth = ""; return p.top >= m.bottom - 0.5 ? "hidden" : p.right <= m.right + 0.5 && p.bottom <= m.bottom + 2 ? "whole" : "cut"; }) };`);
		expect(got.head).toBe("유튜브 · 유튜브 댓글 · 맥미니");
		expect(got.pcWhole).not.toContain("cut"); expect(got.pcWhole[1]).toBe("hidden");   // the computer in a card's head shows whole or not at all, never cut mid-word
		expect(got.pc).toBe("· 맥미니");
		expect(got.chip).toBe("가나");
		expect(got.attach).toBe("");   // text only and no file left behind: no 첨부 line at all
		expect(got.acts).toEqual(["보내기", "고치기", "보내지 않기"]);
		expect(got.tabs).toBe(0);
		expect(got.overflow).toBe(false);
		await Bun.write(join(SHOTS, `comment-peer-${width}.png`), await v.screenshot());
	}, 20000);

	test("every action of its draft and failed reply is one act for that computer", async () => {
		const v = await boot(width, height);
		await run(v, `document.querySelector("#cm .kk-row").click()`);
		await waitFor(v, `CM.open && !CM.loading && document.querySelector("#cm .kk-draft")`);
		const got = await q<{ routes: string[][]; sends: string[]; buttons: string[] }>(v, `
			const r = (p, b = {}) => pqRoute(p, "POST", b);
			const id = encodeURIComponent("send:cm:youtube:c3"), cid = encodeURIComponent("cm:youtube:c1");
			return { routes: [r("/api/comments/drafts/D1/send"), r("/api/comments/drafts/D1/drop"), r("/api/comments/drafts/D1/restore"), r("/api/comments/drafts/D1/revise", { change: "더 짧게" }),
				r("/api/comments/sends/" + id + "/retry"), r("/api/comments/sends/" + id + "/dismiss"), r("/api/comments/comment/" + cid + "/draft"), r("/api/comments/thread/youtube/v1/read")],
				sends: [...document.querySelectorAll("#cm .kk-m.pend.failed button")].map(b => b.textContent),
				buttons: [...document.querySelectorAll("#cm .kk-draft .rq-acts button")].map(b => b.textContent) };`);
		expect(got.sends).toEqual(["다시 보내기", "지우기"]);
		expect(got.buttons).toEqual(["보내기", "고치기", "보내지 않기"]);
		expect(got.routes.map(r => r[1])).toEqual(Array(8).fill("POST"));
		expect(got.routes.every(r => /^\/api\/peer\/proxy\?pc=[^&]+&p=%2Fapi%2Fpeer%2Fact$/.test(r[0]))).toBe(true);
		expect(got.routes.map(r => r[2])).toEqual([
			{ action: "comments", args: { op: "draft-send", code: "D1" } },
			{ action: "comments", args: { op: "draft-drop", code: "D1" } },
			{ action: "comments", args: { op: "draft-restore", code: "D1" } },
			{ action: "comments", args: { op: "draft-revise", code: "D1", change: "더 짧게" } },
			{ action: "comments", args: { op: "send-retry", id: "send:cm:youtube:c3" } },
			{ action: "comments", args: { op: "send-dismiss", id: "send:cm:youtube:c3" } },
			{ action: "comments", args: { op: "draft", commentId: "cm:youtube:c1" } },
			{ action: "comments", args: { op: "read", source: "youtube", thread: "v1" } },
		]);
		expect(localPosts).toEqual([]);
	}, 20000);

});
