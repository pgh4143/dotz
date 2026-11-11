import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sseResponse } from "./events.ts";
import { appAsset, indexPage } from "./webapp.ts";

// 답장 대기 (web/js/30-replies.js): every reply that waits on the owner, of every app and every computer, as the prototype's #queue: tabs with counts, a sticky head,
// sections 실패 / 답 필요 / 보낸 것, rows that open ONE sheet holding the reply card (web/js/10-reply-card.js). Failed sends of one app and reason fold into one row.
// Reached from 홈 답장 대기 and an app row's 답장 대기; a peer's draft is acted on its own computer once, and this one reads the queue again.
const SHOTS = process.env.REPLIES_SHOTS ?? join(tmpdir(), "replies-shots");
mkdirSync(SHOTS, { recursive: true });
const MINI = "http://mini.test";
const iso = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const Q = "이 답장 보낼까요?";
const OPTS = [{ n: 1, label: "보내기", desc: "", rec: true }, { n: 2, label: "고치기", desc: "", rec: false, detail: true }, { n: 3, label: "보내지 않기", desc: "", rec: false }];
// A mail send approval quoting its draft, with the files that go (draft-approval.ts "> 첨부: name (size)" lines read back into d.attachments).
const mailDraft = (id: string, t: string, at: string, attachments?: { name: string; size: string }[]) => ({
	id, ts: at, updated: at, kind: "decision", tone: "ask", title: `${Q} (RSE1)`, text: `[ask] 답장 초안을 만들었어요.\n\n> 받는이: Kim <kim@example.com>\n\n${Q}`, open: t, src: t, at, read: false,
	decision: { options: OPTS, to: t, reply_to: at, group: 1, state: "open", draft: { toLabel: "받는이", to: "Kim <kim@example.com>", subject: "Re: 견적 요청", body: "안녕하세요.\n\n견적서를 보내 드려요.", ...(attachments ? { attachments } : {}) } },
});
const LONG = ["안녕하세요!", "오늘 시간 괜찮으세요?", "저는 오후에는 괜찮아요.", "세 시쯤 어떨까요?", "장소는 늘 가던 곳으로 해요.", "제가 조금 일찍 가 있을게요.", "혹시 늦으시면 알려 주세요.", "그럼 이따 봬요."].join("\n");
const kakaoDraft = (code: string, at: string, extra: object = {}) => ({
	kind: "kakao", app: "kakao", code, chatId: "100", room: "가나다 모임", text: LONG, parts: ["안녕하세요!", "오늘 시간 괜찮으세요?"], created: at, at: Date.parse(at), attachmentsNone: true, cannotAttach: [],
	original: { who: "가나", text: "내일 점심 어때요?", at: Date.parse(at) }, model: "Sonnet 5.5 · 보통", ...extra,
});
const commentDraft = (at: string) => ({
	kind: "comment", app: "youtube", via: "youtube", code: "C1", thread: "p1", to: "가나", title: "첫 번째 영상", source: "youtube", sourceLabel: "유튜브 댓글",
	text: LONG, created: at, at: Date.parse(at), attachmentsNone: true, cannotAttach: ["견적서.pdf"], original: { who: "가나", text: "자막 언제 나와요?", at: Date.parse(at) },
});
const app = (key: string, label: string, icon: string, notices: string[], needs: object) => ({ key, app: key, label, icon, kind: "app", unread: 0, notices, needs });
const LOCAL_MAIL = { ...app("mail", "회사 메일", "mail", ["dl"], { drafts: 1, unread: 0, sentToday: 0 }), conv: ["mail:"] };
const LOCAL_KAKAO = app("kakao", "카카오톡", "chat", [], { drafts: 1, unread: 0, sentToday: 0 });
const LOCAL_YOUTUBE = app("youtube", "유튜브", "chat", [], { drafts: 1, unread: 0, sentToday: 0 });
const PEER_MAIL = { ...app("mail", "회사 메일", "mail", ["dp"], { drafts: 1, unread: 0, sentToday: 0 }), conv: ["mail:"] };
const PEER_KAKAO = app("kakao", "카카오톡", "chat", [], { drafts: 1, unread: 0, sentToday: 0 });

const T = { peerMail: iso(0), peerKakao: iso(1), localKakao: iso(2), localMail: iso(3), localComment: iso(5) };
let localReplies = [kakaoDraft("K1", T.localKakao), commentDraft(T.localComment)];
let peerReplies = [kakaoDraft("PK1", T.peerKakao, { room: "공부 모임" })];
let peerNote = mailDraft("dp", "mail:acme-peer", T.peerMail);
const localNote = mailDraft("dl", "mail:acme-local", T.localMail, [{ name: "견적서.pdf", size: "2.1MB" }]);
localNote.decision.draft = { ...localNote.decision.draft, warning: "받는이 주소가 처음이에요" };
// What the hub's GET /api/replies adds: failed sends (three mail ones of one reason, one comment reply without a reason, two KakaoTalk sends of one reason), today's sent ones,
// and why a rule did not send a draft.
const mkFail = (key: string, extra: object) => ({ key, kind: "mail", app: "mail", who: "Kim", what: "견적 요청", at: Date.now() - 9 * 60_000, text: "견적서를 보내 드려요.", ...extra });
const FAILED = () => [
	mkFail("F1", { ref: "r1", conv: "mail:acme-a", why: "서버가 응답하지 않았어요" }), mkFail("F2", { ref: "r2", conv: "mail:acme-b", why: "서버가 응답하지 않았어요", at: Date.now() - 10 * 60_000 }),
	mkFail("F3", { ref: "r3", conv: "mail:acme-c", why: "서버가 응답하지 않았어요", at: Date.now() - 11 * 60_000 }),
	mkFail("FC", { kind: "comment", app: "youtube", who: "가나", what: "첫 번째 영상", sendId: "cs1", at: Date.now() - 12 * 60_000 }),
	mkFail("FK1", { kind: "kakao", app: "kakao", who: "가나다 모임", what: "카카오톡 답장", chatId: "100", sendId: "s1", ref: "kr1", why: "카카오톡 창이 닫혀 있어요", at: Date.now() - 13 * 60_000 }),
	mkFail("FK2", { kind: "kakao", app: "kakao", who: "가나다 모임", what: "카카오톡 답장", chatId: "100", sendId: "s2", ref: "kr2", why: "카카오톡 창이 닫혀 있어요", at: Date.now() - 14 * 60_000 }),
];
const SENT = () => [
	{ key: "S1", kind: "mail", app: "mail", who: "Kim", what: "견적 요청", at: Date.now() - 20 * 60_000, how: "owner", text: "보냈어요" },
	{ key: "S2", kind: "kakao", app: "kakao", who: "가나다 모임", what: "카카오톡 답장", at: Date.now() - 30 * 60_000, how: "rule", text: "보냈어요" },
];
const STOP_K1 = "상대가 처음 보내는 사람이에요";
let failedList: ReturnType<typeof FAILED> = FAILED(), sentList: object[] = SENT();
const conv = (t: string) => ({ target: t, mail: { key: t.slice(5), subject: "견적 요청", from: "Kim <kim@example.com>", source: "acme", at: T.localMail, summary: "다음 주까지 견적을 받고 싶어요.", reply: "draft", unreplied: true }, last: { ts: T.localMail, text: "견적 요청 메일", via: "acme" }, unread: 0 });
const snapshot = () => ({ name: "맥미니", rev: `r${peerReplies.length}${peerNote.decision.state}`, monitors: [], notices: [peerNote], integrations: [PEER_MAIL, PEER_KAKAO], available: [], conversations: [conv("mail:acme-peer")], replies: peerReplies, failed: [], sent: [], stops: {} });

const acts: { action: string; args: Record<string, unknown> }[] = [];
const localPosts: { path: string; body: unknown }[] = [];
let peerReads = 0, repliesReads = 0;
const json = (v: unknown, status = 200) => Response.json(v, { status });
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
		if (p === "/api/notices") return json({ unread: 1, items: [localNote] });
		if (p === "/api/integrations") return json({ items: [LOCAL_MAIL, LOCAL_KAKAO, LOCAL_YOUTUBE], available: [] });
		if (p === "/api/conversations") return json({ items: [conv("mail:acme-local")] });
		if (p === "/api/drafts/og1/original") return json({ kind: "mail", key: "acme-og", from: "Kim <kim@example.com>", date: T.localMail, subject: "견적 요청", text: "안녕하세요.\n\n다음 주까지 견적을 받고 싶어요. 수량은 100개예요.", html: false, attachments: [] });
		if (p === "/api/drafts/og2/original") return json({ kind: "comment", key: "og2", author: "가나", date: T.localComment, text: "자막 언제 나와요? 기다리고 있어요.", post: { kind: "youtube", title: "첫 번째 영상" } });
		if (p === "/api/replies") { repliesReads++; return json({ items: localReplies, failed: failedList, sent: sentList, stops: { K1: STOP_K1 } }); }
		if (p === "/api/monitoring/peers") { peerReads++; return json([{ name: "맥미니", url: MINI, online: true, stale: false, items: snapshot() }]); }
		if (p === "/api/peer/proxy") {
			const pp = url.searchParams.get("p") ?? "";
			if (req.method === "POST") {
				const a = (await req.json()) as (typeof acts)[number];
				acts.push(a);
				if (a.action === "kakao" && (a.args.op === "draft-send" || a.args.op === "draft-drop")) peerReplies = peerReplies.filter(d => d.code !== a.args.code);
				return json({ ok: true });
			}
			if (pp === "/api/replies") return json({ items: peerReplies });
			return json({});
		}
		if (req.method === "POST") {
			const b = await req.json().catch(() => null);
			localPosts.push({ path: p, body: b });
			// a retry hands the send back: the failed row leaves (what the hub does once the send is queued)
			const cs = /^\/api\/comments\/sends\/(\w+)\/(?:retry|done)$/.exec(p), ks = /^\/api\/kakao\/chat\/\w+\/send\/(\w+)\/retry$/.exec(p);
			if (cs || ks) failedList = failedList.filter(x => (x as { sendId?: string }).sendId !== (cs || ks)![1]);
			if (p === "/api/approvals/failed") {
				const items = ((b as { items?: { ref: string }[] } | null)?.items ?? []);
				failedList = failedList.filter(x => !items.some(i => i.ref === (x as { ref?: string }).ref));
				return json({ results: items.map(() => ({ ok: true })) });
			}
			if (p.endsWith("/drop")) localReplies = localReplies.filter(d => !p.includes(d.code));
			return json({ ok: true });
		}
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
const boot = async (width: number, height: number) => {
	localReplies = [kakaoDraft("K1", T.localKakao), commentDraft(T.localComment)];
	peerReplies = [kakaoDraft("PK1", T.peerKakao, { room: "공부 모임" })];
	peerNote = mailDraft("dp", "mail:acme-peer", T.peerMail);
	failedList = FAILED(); sentList = SENT();
	acts.length = 0; localPosts.length = 0;
	const v = new Bun.WebView({ width, height });
	views.push(v);
	await v.navigate(`http://127.0.0.1:${server.port}/`);
	await waitFor(v, `S && NM.loaded && NT.loaded && PR.fresh && PQ.loaded && typeof rqAll === "function"`);
	await run(v, `if (dotzTheme.get() === "dark") dotzTheme.toggle()`);
	return v;
};
const openQueue = async (v: View) => {
	await run(v, `go("monitoring")`);
	await waitFor(v, `monItems().some(i => i.key === "replies") && RQ.loaded`);
	await run(v, `go("monitoring", "replies")`);
	await waitFor(v, `document.querySelectorAll("#mon-tl .rq-r").length`);
};
const ASK_KEYS = ["n:http://mini.test|dp", "kakao:http://mini.test|PK1", "kakao:|K1", "n:|dl", "comment:|C1"];   // newest first
const rowOf = (key: string) => `document.querySelector('[data-qr="${key}"]')`;

describe.each([[390, 844], [1280, 900]])("답장 대기 at %ipx", (width, height) => {
	test("the tab counts, the sections and the nav badge are one number; asks are newest first; 빠른 처리 sits beside the tabs on a wide screen and under them on a phone", async () => {
		const v = await boot(width, height);
		await openQueue(v);
		await waitFor(v, `document.querySelector("#nav-mon").textContent === "11"`);
		const got = await q<{ tabs: string[]; secs: string[]; ask: string[]; meta: string; fast: boolean; nav: string; waiting: number; over: boolean; tab: string; beside: boolean }>(v, `
			const txt = e => e ? e.textContent.trim() : "", mid = e => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; };
			return { tabs: [...document.querySelectorAll(".rq-tabs .nsc-fb")].map(b => txt(b.querySelector(".n"))), secs: [...document.querySelectorAll(".rq-ls .sec")].map(txt),
				ask: [...document.querySelectorAll(".rq-r.ask")].map(r => r.dataset.qr), meta: txt(document.querySelector(".rq-qm .meta")), fast: !document.querySelector(".rq-fast").hidden,
				nav: txt(document.querySelector("#nav-mon")), waiting: rqWaiting(), over: document.documentElement.scrollWidth > innerWidth, tab: txt(document.querySelector(".rq-tabs .nsc-fb.on")),
				beside: Math.abs(mid(document.querySelector(".rq-fast")) - mid(document.querySelector(".rq-tabs .nsc-fb"))) < 2 };`);
		// 답 필요 5 + 실패 6 = the number on the nav, the home row and the list row; 보낸 것 2 stays out of it
		expect(got.tabs).toEqual(["", "5", "6", "2"]);
		expect(got.nav).toBe("11");
		expect(got.waiting).toBe(11);
		expect(got.secs).toEqual(["실패", "답 필요", "보낸 것"]);   // the count is said once, on the tabs
		expect(got.ask).toEqual(ASK_KEYS);
		expect(got.meta).toBe("");
		expect(got.fast).toBe(true);
		expect(got.beside).toBe(width >= 640);   // one row with the tabs when wide; a phone stacks them so the button does not move with the counts
		expect(got.over).toBe(false);
		expect(got.tab.startsWith("전체")).toBe(true);
		// the list row of 모니터링 reads the same number, and its line is the count per source (the home row's line), which adds up to it
		expect(await q<number>(v, `return monItems().find(i => i.key === "replies").unread`)).toBe(11);
		expect(await q<number>(v, `return monItems().find(i => i.key === "replies").hint.split(" · ").reduce((c, p) => c + Number(p.split(" ").pop()), 0)`)).toBe(11);
		await Bun.write(join(SHOTS, `replies-${width}.png`), await v.screenshot());
	});

	test("a row's tag is the real stop reason or nothing: a rule's refusal, the draft's own warning, how a sent one went; a row without a reason has no tag", async () => {
		const v = await boot(width, height);
		await openQueue(v);
		await run(v, `RQ.tab = "all"; RQ.fold.add("|youtube|"); MON.sig = ""; renderMonitoring()`);
		const tags = await q<Record<string, string | null>>(v, `const o = {}; for (const r of document.querySelectorAll(".rq-r[data-qr]")) { const t = r.querySelector(".tag"); o[r.dataset.qr] = t ? t.textContent : null; } return o;`);
		expect(tags["kakao:|K1"]).toBe(STOP_K1);   // GET /api/replies stops
		expect(tags["n:|dl"]).toBe("받는이 주소가 처음이에요");   // the draft's own warning
		for (const k of ["n:http://mini.test|dp", "kakao:http://mini.test|PK1", "comment:|C1", "f:|FC"]) expect(tags[k]).toBeNull();   // nothing recorded: no tag, no slot
		expect(tags["s:|S1"]).toBe("확인 후 발송");
		expect(tags["s:|S2"]).toBe("자동 발송");
		// the failure group carries its reason under the title instead of a tag
		expect(await q<string[]>(v, `return [...document.querySelectorAll(".rq-g")].map(g => g.textContent)`)).toEqual([expect.stringContaining("서버가 응답하지 않았어요"), expect.stringContaining("카카오톡 창이 닫혀 있어요")]);
	});

	test("the same app and reason fold into one row, 2 or more only; the chevron unfolds the items", async () => {
		const v = await boot(width, height);
		await openQueue(v);
		await run(v, `document.querySelector('.rq-tabs [data-f="fail"]').click()`);
		await waitFor(v, `document.querySelectorAll(".rq-r.fail").length === 3 && !document.querySelector(".rq-ls .sec")`);
		const folded = await q<{ titles: string[]; kids: number; plain: string[] }>(v, `return { titles: [...document.querySelectorAll(".rq-g .hd")].map(e => e.textContent), kids: document.querySelectorAll("[data-kid]").length, plain: [...document.querySelectorAll(".rq-r.fail:not(.rq-g)")].map(r => r.dataset.qr) }`);
		expect(folded.titles.map(t => t.replace(/^\S+ /, ""))).toEqual(["3건을 못 보냈어요", "2건을 못 보냈어요"]);
		expect(folded.kids).toBe(0);
		expect(folded.plain).toEqual(["f:|FC"]);   // the lone failure stays a plain row
		await run(v, `document.querySelector('.rq-g[data-qg*="mail"] .nsc-tx').click()`);
		await waitFor(v, `document.querySelectorAll("[data-kid]").length === 3`);
		expect(await q<string[]>(v, `return [...document.querySelectorAll("[data-kid]")].map(r => r.dataset.qr)`)).toEqual(["f:|F1", "f:|F2", "f:|F3"]);
		await run(v, `document.querySelector('.rq-g[data-qg*="mail"] .nsc-tx').click()`);
		await waitFor(v, `!document.querySelector("[data-kid]")`);
	});

	test("모두 다시 보내기 hands back only the failed items, each by its own route, and never answers an approval", async () => {
		const v = await boot(width, height);
		await openQueue(v);
		await run(v, `document.querySelector('.rq-tabs [data-f="fail"]').click()`);
		await waitFor(v, `document.querySelectorAll(".rq-g").length === 2`);
		await run(v, `document.querySelector('.rq-g[data-qg*="mail"] .rq-retry').click()`);
		await waitFor(v, `!document.querySelector('.rq-g[data-qg*="mail"]')`);
		await run(v, `document.querySelector('.rq-g[data-qg*="kakao"] .rq-retry').click()`);
		await waitFor(v, `!document.querySelector('.rq-g[data-qg*="kakao"]')`);
		// the lone comment failure: its sheet's 다시 보내기
		await run(v, `document.querySelector('[data-qr="f:|FC"] .tx').click()`);
		await waitFor(v, `document.querySelector('.rq-sheet [data-k="retry"]')`);
		await run(v, `document.querySelector('.rq-sheet [data-k="retry"]').click()`);
		await waitFor(v, `!document.querySelector(".rq-r.fail") && !document.querySelector(".rq-sheet")`);
		expect(localPosts.map(x => x.path)).toEqual(["/api/approvals/failed", "/api/kakao/chat/100/send/s1/retry", "/api/kakao/chat/100/send/s2/retry", "/api/comments/sends/cs1/retry"]);
		const mail = localPosts[0]!.body as { op: string; items: { ref: string; to: string }[] };
		expect(mail.op).toBe("retry");
		expect(mail.items.map(i => [i.ref, i.to]).sort()).toEqual([["r1", "mail:acme-a"], ["r2", "mail:acme-b"], ["r3", "mail:acme-c"]]);
		expect(localPosts.some(x => x.path === "/api/approvals")).toBe(false);   // nothing was answered with a pick
		expect(acts).toEqual([]);
		expect(await q<string>(v, `return document.querySelector("#nav-mon").textContent`)).toBe("5");   // the failures left the number
	});

	test("a comment nobody can say went up says 확인 필요, is never bundled into 모두 다시 보내기, and offers 다시 보내기 and 완료", async () => {
		const v = await boot(width, height);
		const unsure = (id: string) => ({ key: id, kind: "comment", app: "youtube", who: "가나", what: "첫 번째 영상", why: "올라갔는지 알 수 없어요", at: Date.now(), ref: id, sendId: id, text: "답글", unsure: true });
		failedList = [unsure("U1"), unsure("U2")];
		await run(v, `rqLoad()`);
		await openQueue(v);
		await run(v, `document.querySelector('.rq-tabs [data-f="fail"]').click()`);
		await waitFor(v, `${rowOf("f:|U1")} && ${rowOf("f:|U2")}`);
		expect(await q<number>(v, `return document.querySelectorAll(".rq-g").length`)).toBe(0);
		expect(await q<string>(v, `return ${rowOf("f:|U1")}.textContent`)).toContain("확인 필요");
		await run(v, `${rowOf("f:|U1")}.querySelector(".tx").click()`);
		await waitFor(v, `document.querySelector('.rq-sheet [data-k="done"]')`);
		expect(await q<string[]>(v, `return [...document.querySelectorAll(".rq-sheet .rq-acts button")].map(b => b.textContent.trim())`)).toEqual(["다시 보내기", "완료"]);
		await run(v, `document.querySelector('.rq-sheet [data-k="done"]').click()`);
		await waitFor(v, `!${rowOf("f:|U1")}`);
		expect(localPosts.map(x => x.path)).toEqual(["/api/comments/sends/U1/done"]);
	});

	test("a row opens ONE sheet with the why line on top and the reply card under it; a failed item offers 다시 보내기 and 보내지 않기, a sent one only 보냈어요", async () => {
		const v = await boot(width, height);
		await openQueue(v);
		await run(v, `${rowOf("kakao:|K1")}.querySelector(".tx").click()`);
		await waitFor(v, `document.querySelector('.rq-sheet .rq[data-kind="kakao"]')`);
		const sheet = await q<{ why: string; label: string; acts: string[]; count: number }>(v, `const s = document.querySelector(".rq-sheet"); return { why: s.querySelector(".rq-why").textContent, label: s.querySelector(".fs-t").textContent, acts: [...s.querySelectorAll(".rq-acts button")].map(b => b.textContent.trim()), count: document.querySelectorAll(".rq-sheet").length }`);
		expect(sheet).toEqual({ why: STOP_K1, label: "답장 확인", acts: ["보내기", "고치기", "보내지 않기"], count: 1 });
		await run(v, `RQ.sheet.close()`);
		await waitFor(v, `!document.querySelector(".rq-sheet")`);
		await run(v, `${rowOf("f:|FC")}.querySelector(".tx").click()`);
		await waitFor(v, `document.querySelector(".rq-sheet .rq-acts")`);
		expect(await q<string[]>(v, `return [...document.querySelectorAll(".rq-sheet .rq-acts button")].map(b => b.textContent.trim())`)).toEqual(["다시 보내기", "보내지 않기"]);
		await run(v, `RQ.sheet.close()`);
		await waitFor(v, `!document.querySelector(".rq-sheet")`);
		await run(v, `${rowOf("s:|S1")}.querySelector(".tx").click()`);
		await waitFor(v, `document.querySelector(".rq-sheet .rq-sent")`);
		expect(await q<number>(v, `return document.querySelectorAll(".rq-sheet .rq-acts").length`)).toBe(0);
		expect(localPosts).toEqual([]);
	});

	test("a long draft fits the sheet in the window: the head stays, the body scrolls down to the attachment line", async () => {
		const body = localNote.decision.draft.body;
		localNote.decision.draft.body = Array.from({ length: 60 }, (_, i) => `${i + 1}번째 줄: 견적서와 일정 안내를 함께 보내 드려요.`).join("\n");
		try {
			const v = await boot(width, Math.min(height, 800));
			await openQueue(v);
			await run(v, `${rowOf("n:|dl")}.querySelector(".tx").click()`);
			await waitFor(v, `document.querySelector(".rq-sheet .dr-files")`);
			await waitFor(v, `!document.querySelector(".rq-sheet").getAnimations().length`);   // the sheet has slid in
			await run(v, `document.querySelector('.rq-sheet [data-k="more"]').click()`);   // 펼치기: the whole draft
			await waitFor(v, `!document.querySelector(".rq-sheet .rq-body.clamp")`);
			await run(v, `const b = document.querySelector(".rq-sheet .rq-sb"); b.scrollTop = b.scrollHeight`);
			expect(await q<number>(v, `return document.querySelector(".rq-sheet .rq-sb").scrollTop`)).toBeGreaterThan(0);
			const g = await q<{ sheetTop: number; sheetBottom: number; vh: number; hdTop: number; attBottom: number; sbBottom: number }>(v, `const s = document.querySelector(".rq-sheet").getBoundingClientRect(), hd = document.querySelector(".rq-sheet .fs-hd").getBoundingClientRect();
				const a = document.querySelector(".rq-sheet .dr-files").getBoundingClientRect(), sb = document.querySelector(".rq-sheet .rq-sb").getBoundingClientRect();
				return { sheetTop: s.top, sheetBottom: s.bottom, vh: innerHeight, hdTop: hd.top, attBottom: a.bottom, sbBottom: sb.bottom };`);
			expect(g.sheetTop).toBeGreaterThanOrEqual(0);
			expect(g.sheetBottom).toBeLessThanOrEqual(g.vh + 1);
			expect(g.hdTop).toBeGreaterThanOrEqual(g.sheetTop - 1);   // the title and close button did not scroll away
			expect(g.attBottom).toBeLessThanOrEqual(g.sbBottom + 1);   // the attachment line is inside the visible body
			const top = await q<number>(v, `return document.querySelector(".rq-sheet .rq-sb").scrollTop`);
			await run(v, `RQ.shSig = ""; rqSheetPaint()`);   // a redraw of the same draft (its state changed, a poll) keeps the reader where he was
			expect(await q<number>(v, `return document.querySelector(".rq-sheet .rq-sb").scrollTop`)).toBe(top);
			await Bun.write(join(SHOTS, `replies-long-draft-${width}.png`), await v.screenshot());
		} finally {
			localNote.decision.draft.body = body;
		}
	});

	test("the head stays at the top of the scroll area after 40 rows are scrolled past", async () => {
		const v = await boot(width, height);
		sentList = [...SENT(), ...Array.from({ length: 40 }, (_, i) => ({ key: `X${i}`, kind: "mail", app: "mail", who: `받는이 ${i}`, what: "견적 요청", at: Date.now() - (40 + i) * 60_000, how: "owner", text: "보냈어요" }))];
		await run(v, `rqLoad()`);
		await openQueue(v);
		await waitFor(v, `document.querySelectorAll(".rq-r").length >= 50`);
		await run(v, `$("#mon-timeline").scrollTop = 900`);
		await waitFor(v, `$("#mon-timeline").scrollTop > 300`);
		const g = await q<{ top: number; boxTop: number; h: number; hit: boolean }>(v, `const box = $("#mon-timeline"), hd = document.querySelector(".rq-hd2"), r = hd.getBoundingClientRect(), t = hd.querySelector(".nsc-fb").getBoundingClientRect();
			const at = document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2);
			return { top: r.top, boxTop: box.getBoundingClientRect().top, h: r.height, hit: !!at && hd.contains(at) };`);
		expect(Math.abs(g.top - g.boxTop)).toBeLessThanOrEqual(1);
		expect(g.hit).toBe(true);   // the tabs are on top of the scrolled rows and can be tapped
		await Bun.write(join(SHOTS, `replies-scrolled-${width}.png`), await v.screenshot());
	});

	test("the home 답장 대기 row counts the one number and opens the screen of every computer; an app row's 답장 대기 button the app's own", async () => {
		const v = await boot(width, height);
		await run(v, `go("home")`);
		await waitFor(v, `document.querySelector('#home-now .hr[data-k="replies"]') && RQ.loaded`);
		// one row for every draft that waits, its total the badge at the right
		expect(await q<string[]>(v, `return [...document.querySelectorAll('#home-now .hr[data-k="replies"] .nb')].map(b => b.textContent)`)).toEqual(["11"]);
		await run(v, `document.querySelector('#home-now .hr[data-k="replies"]').click()`);
		await waitFor(v, `current === "monitoring" && MON.sel === "replies" && document.querySelectorAll("#mon-tl .rq-r.ask").length === 5`);
		// an app's row opens the screen on that app's items of that computer
		await run(v, `go("monitoring", "i:kakao")`);
		await waitFor(v, `document.querySelector('#mon-head .rq-go')`);
		expect(await q<string>(v, `return document.querySelector('#mon-head .rq-go').textContent`)).toBe("답장 대기 1");
		await run(v, `document.querySelector('#mon-head .rq-go').click()`);
		await waitFor(v, `MON.sel === "replies" && document.querySelectorAll("#mon-tl .rq-r.ask").length === 1`);
		expect(await q<string[]>(v, `return [...document.querySelectorAll("#mon-tl .rq-r.ask .hd")].map(e => e.textContent)`)).toEqual(["가나다 모임"]);
	});

	test("a peer's draft is sent on its computer once from the sheet, and the screen reads both computers again", async () => {
		const v = await boot(width, height);
		await openQueue(v);
		const reads = peerReads;
		await run(v, `${rowOf("kakao:http://mini.test|PK1")}.querySelector(".tx").click()`);
		await waitFor(v, `document.querySelector('.rq-sheet .rq[data-rq^="kakao:http://mini.test|PK1"] .dr-send')`);
		// two taps: the card is busy after the first, so exactly one act leaves this computer
		await run(v, `const b = document.querySelector('.rq-sheet .dr-send'); b.click(); b.click()`);
		// the sent card stays where it was: 보냈어요 in the action row's place, no toast
		await waitFor(v, `document.querySelector('.rq-sheet .rq-sent')`);
		expect(await q<number[]>(v, `return [document.querySelectorAll(".snack").length, document.querySelectorAll('.rq-sheet .rq-acts').length]`)).toEqual([0, 0]);
		expect(acts).toEqual([{ action: "kakao", args: { op: "draft-send", code: "PK1" } }]);
		expect(localPosts).toEqual([]);
		await waitFor(v, `true`, 200).catch(() => {});
		await waitFor(v, `${peerReads} > ${reads}`).catch(() => {});
		expect(peerReads).toBeGreaterThan(reads);   // the screen reads the Mac mini again (its own screen does the same from its own store)
	});

	test("보내지 않기 of a local draft offers 되돌리기, the sheet closes with its item, and the undo brings it back once", async () => {
		const v = await boot(width, height);
		await openQueue(v);
		await run(v, `${rowOf("comment:|C1")}.querySelector(".tx").click()`);
		await waitFor(v, `document.querySelector('.rq-sheet [data-k="drop"]')`);
		await run(v, `document.querySelector('.rq-sheet [data-k="drop"]').click()`);
		await waitFor(v, `document.querySelector(".snack.act .sa") && !${rowOf("comment:|C1")} && !document.querySelector(".rq-sheet")`);
		const snack = await q<string>(v, `return document.querySelector(".snack").textContent`);
		expect(snack).toContain("보내지 않았어요");
		expect(snack).toContain("되돌리기");
		expect(localPosts.map(x => x.path)).toEqual(["/api/comments/drafts/C1/drop"]);
		// the undo is one request and the item waits again
		localReplies = [kakaoDraft("K1", T.localKakao), commentDraft(T.localComment)];
		await run(v, `document.querySelector(".snack.act .sa").click(); document.querySelectorAll(".snack.act .sa").forEach(b => b.remove())`);
		await waitFor(v, `${rowOf("comment:|C1")}`);
		expect(localPosts.map(x => x.path)).toEqual(["/api/comments/drafts/C1/drop", "/api/comments/drafts/C1/restore"]);
	});

	test("a failed send whose draft still waits shows once as the failure; a draft that came back after the failure shows as the ask", async () => {
		const v = await boot(width, height);
		await openQueue(v);
		const states = (at: string) => q<string[]>(v, `RQ.failed = [{ key: "FK", kind: "kakao", app: "kakao", who: "Kim", what: "답장", at: ${at}, ref: "K1" }];
			return rqRows().filter(r => r.key === "f:|FK" || r.key === "kakao:|K1").map(r => r.state);`);
		expect(await states("rqAll().find(x => x.key === 'kakao:|K1').at + 1")).toEqual(["fail"]);
		expect(await states("rqAll().find(x => x.key === 'kakao:|K1').at - 1")).toEqual(["ask"]);
	});

	test("the old banner is gone: no #trban, no trBanner", async () => {
		const v = await boot(width, height);
		expect(await q<[boolean, string]>(v, `return [!!document.getElementById("trban"), typeof trBanner]`)).toEqual([false, "undefined"]);
	});
});

// 원문 보기 on a card whose draft has a ref opens the full original under the short quote: a mail's sender, subject, date and whole body, or the comment.
test("원문 보기 opens the full original mail or comment", async () => {
	const v = await boot(1280, 900);
	const ref = await q<{ ref: string; t: string }>(v, `const o = rqOriginalOf({ kind: "notice", n: { decision: { to: "mail:x", draft: { ref: "og1", origin: { text: "답장 상태" } } } } }); return { ref: o.ref, t: o.t };`);
	expect(ref).toEqual({ ref: "og1", t: "mail:x" });
	await run(v, `const h = document.createElement("div"); h.id = "og-test"; h.append(rqOrigNode("og:m", { who: "", text: "답장 상태", ref: "og1", t: "mail:x" }), rqOrigNode("og:c", { who: "가나", text: "자막", ref: "og2" })); document.body.append(h);`);
	const before = await q<{ btns: string[]; panes: boolean[] }>(v, `const w = [...document.querySelectorAll("#og-test .rq-og-wrap")]; return { btns: w.map(x => x.querySelector(".rq-og").textContent), panes: w.map(x => x.querySelector(".rq-op").hidden) };`);
	expect(before).toEqual({ btns: ["원문 보기", "원문 보기"], panes: [true, true] });
	await run(v, `document.querySelectorAll("#og-test .rq-og").forEach(b => b.click())`);
	await waitFor(v, `[...document.querySelectorAll("#og-test .rq-op")].every(p => !p.hidden && p.querySelector(".od-body"))`);
	const after = await q<string[]>(v, `return [...document.querySelectorAll("#og-test .rq-op")].map(p => p.textContent)`);
	for (const s of ["kim@example.com", "견적 요청", "수량은 100개예요.", "날짜"]) expect(after[0]).toContain(s);
	for (const s of ["가나", "자막 언제 나와요? 기다리고 있어요.", "첫 번째 영상"]) expect(after[1]).toContain(s);
	// 원문 접기 hides it again
	await run(v, `document.querySelector("#og-test .rq-og").click()`);
	expect(await q<boolean>(v, `return document.querySelector("#og-test .rq-op").hidden`)).toBe(true);
});
