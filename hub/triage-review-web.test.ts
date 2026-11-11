import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { fakeHub, json, run, waitFor, type View } from "./test-web.ts";

// The review queue (web/js/30-triage.js, key "*"): every waiting draft of every comment app and mail app, one card at a time, answered with
// Enter/1, 2/E, 3/X and moved with the arrows, run in a headless browser against a stubbed /api/approvals. Names and texts are placeholders.
type Req = { method: string; path: string; body: Record<string, unknown> | null };
const at = Date.UTC(2026, 9, 22, 3, 0);
const COMMENT = { source: "유튜브 댓글", post: "첫 번째 영상", link: null, who: "김민영-x9b", text: "문서 파일을 보내 주실 수 있을까요?", at, mailMark: { state: "drafted", label: "메일 초안 작성됨" } };
const CARDS = [
	{ ref: "Dxyz789", to: "main", group: "i:youtube", sendable: true, notice: "n1", kind: "comment", comment: COMMENT, info: [], question: "이 답글을 올리고 메일도 보낼까요? (Dxyz789)",
		draft: { toLabel: "대상", to: "김민영-x9b 댓글", body: "메일로 보내 드렸어요.", mail: { to: "kim@example.com", subject: "문서 파일", body: "첨부합니다.", attachments: [{ name: "독서3부.pdf", size: "1.2MB" }] } } },
	{ ref: "Rxyz234", to: "main", group: "i:mail", sendable: true, kind: "mail", info: [], question: "이 메일 답장을 보낼까요? (Rxyz234)",
		draft: { toLabel: "받는이", to: "teacher@example.com", subject: "Re: 회의 수업 문의", body: "문서를 확인해 주세요.", attachments: [{ name: "문서.pdf", size: "820KB" }] } },
	{ ref: "Dabc234", to: "main", group: "i:youtube", sendable: true, kind: "comment", comment: { ...COMMENT, who: "마바", text: "영어 자막도 있나요?", mailMark: undefined }, info: [], question: "이 답글 올릴까요? (Dabc234)",
		draft: { toLabel: "대상", to: "마바 댓글", body: "준비 중이에요." } },
];
const GROUPS = [{ key: "i:youtube", label: "유튜브", count: 2, cards: [CARDS[0], CARDS[2]] }, { key: "i:mail", label: "메일", count: 1, cards: [CARDS[1]] }];
let reqs: Req[] = [];
let hold: Promise<void> | null = null;   // a POST waits for this before it answers
let failNext = false;
let waiters: { n: number; res: () => void }[] = [];
const arrived = (n: number): Promise<void> => {
	if (reqs.length >= n) return Promise.resolve();
	return new Promise((res, rej) => {
		const t = setTimeout(() => rej(new Error(`only ${reqs.length} of ${n} answers arrived`)), 3500);
		waiters.push({ n, res: () => { clearTimeout(t); res(); } });
	});
};
const hub = fakeHub({
	stream: "fake",
	api: async (req, url) => {
		const p = url.pathname;
		if (p === "/api/approvals" && req.method === "GET") return json({ groups: GROUPS, results: [], triageMin: 3 });
		if (p === "/api/approvals" && req.method === "POST") {
			reqs.push({ method: "POST", path: p, body: (await req.json()) as Record<string, unknown> });
			waiters = waiters.filter(w => (reqs.length >= w.n ? (w.res(), false) : true));
			if (hold) await hold;
			if (failNext) { failNext = false; return json({ error: "fail-text" }); }
			return json({ ok: true, sending: 1, toBot: 0 });
		}
		if (p === "/api/drafts/Rxyz234/original") return json({ kind: "mail", from: "teacher@example.com", subject: "회의 수업 문의", text: "문서를 받을 수 있을까요?" });
		if (p === "/api/history") return json({ target: url.searchParams.get("target"), events: [] });
		if (p === "/api/activity") return json({ items: [], more: false, history: false });
		if (p === "/api/notices") return json({ unread: 0, items: [] });
	},
});
afterAll(() => { hub.stop(); });
beforeEach(() => { reqs = []; waiters = []; hold = null; failNext = false; });

const q = async <T = unknown>(v: View, code: string): Promise<T> => JSON.parse((await v.evaluate(`JSON.stringify((() => { ${code} })())`)) as string) as T;
const key = (v: View, k: string) => run(v, `document.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, bubbles: true }))`);
const pos = (v: View) => q<string>(v, `return document.querySelector(".tr-pos").firstChild.textContent`);
const boot = async (v: View) => {
	const opened = hub.nextStream();
	await v.navigate(`${hub.origin}/`);
	await opened;
	await waitFor(v, `typeof TR !== "undefined" && S`);
	await run(v, `trLoad()`);
	await waitFor(v, `TR.groups.length === 2`);
	await run(v, `trOpen("*")`);
	await waitFor(v, `TR.h && document.querySelector(".tr .tr-body")`);
};

describe("review queue", async () => {
	const v = await hub.view({ width: 390, height: 844 });

	test("a comment card shows the post, the quoted comment with who and when, the linked mail and its files above the draft", async () => {
		await boot(v);
		expect(await pos(v)).toBe("1/3");
		const s = await q<{ ctx: string; mark: string; mail: string; files: string; order: boolean; buttons: string[] }>(v, `
			const ctx = document.querySelector(".tr-cmt"), ta = document.querySelector(".tr-ta");
			return { ctx: ctx.textContent, mark: ctx.querySelector(".tag").textContent, mail: document.querySelector(".tr-mail").textContent, files: document.querySelector(".tr-mail .tr-file").textContent,
				order: !!(ctx.compareDocumentPosition(ta) & Node.DOCUMENT_POSITION_FOLLOWING), buttons: [...document.querySelectorAll(".tr-acts .tr-b")].map(b => b.textContent) }`);
		expect(s.ctx).toContain("첫 번째 영상");
		expect(s.ctx).toContain("김민영-x9b");
		expect(s.ctx).toContain("10. 22. 오후 12:00");
		expect(s.ctx).toContain("문서 파일을 보내 주실 수 있을까요?");
		expect(s.mark).toBe("메일 초안 작성됨");
		expect(s.mail).toContain("kim@example.com");
		expect(s.files).toBe("독서3부.pdf (1.2MB)");
		expect(s.order).toBe(true);
		expect(s.buttons).toEqual(["보내기", "고치기", "보내지 않기"]);
		expect(await q<string>(v, `return document.querySelector(".tr-ft").textContent`)).not.toContain("null");   // a missing hint is no node, not the word null
	});

	test("1 sends and moves on at once, X drops, the mail card shows the incoming mail, and the end shows what happened", async () => {
		await boot(v);
		await key(v, "1");
		await waitFor(v, `document.querySelector(".tr-pos").firstChild.textContent === "2/3"`);
		await arrived(1);
		expect(reqs.map(r => r.body)).toEqual([{ items: [{ ref: "Dxyz789", to: "main", n: 1, label: "보내기" }] }]);
		await key(v, "x");
		await waitFor(v, `document.querySelector(".tr-pos").firstChild.textContent === "3/3"`);
		await arrived(2);
		expect(reqs[1]!.body).toEqual({ items: [{ ref: "Dabc234", to: "main", n: 3, label: "보내지 않기" }] });
		await waitFor(v, `document.querySelector(".tr-org .tr-otx") && document.querySelector(".tr-org .tr-otx").textContent.includes("문서를 받을 수 있을까요?")`);
		await key(v, "Enter");
		await waitFor(v, `document.querySelector(".tr-sumlist")`);
		await arrived(3);
		expect(reqs[2]!.body).toEqual({ items: [{ ref: "Rxyz234", to: "main", n: 1, label: "보내기" }] });
		const rows = await q<string[]>(v, `return [...document.querySelectorAll(".tr-sumlist li")].map(li => li.textContent)`);
		expect(rows).toEqual(["보내지 않았어요1건", "보내는 중2건"]);
	});

	test("2 asks what to change and sends the note; the arrows only move between cards", async () => {
		await boot(v);
		await key(v, "ArrowRight");
		expect(await pos(v)).toBe("2/3");
		await key(v, "k");
		expect(await pos(v)).toBe("1/3");
		await key(v, "2");
		await waitFor(v, `document.querySelector(".tr-note")`);
		await run(v, `const t = document.querySelector(".tr-note"); t.value = "더 짧게"; t.dispatchEvent(new Event("input")); document.querySelector(".tr-go").click()`);
		await waitFor(v, `document.querySelector(".tr-pos").firstChild.textContent === "2/3"`);
		await arrived(1);
		expect(reqs).toHaveLength(1);
		expect(reqs[0]!.body).toEqual({ items: [{ ref: "Dxyz789", to: "main", n: 2, label: "고치기", note: "더 짧게" }] });
	});

	test("a press waits for the answer: buttons stay in place disabled, one request on a double press, the next card only after it", async () => {
		await boot(v);
		let release = () => {};
		hold = new Promise<void>(res => { release = res; });
		const before = await q<number[]>(v, `return [...document.querySelectorAll(".tr-acts .tr-b")].map(b => Math.round(b.getBoundingClientRect().top))`);
		await run(v, `const b = document.querySelector(".tr-go"); b.click(); b.click()`);
		await waitFor(v, `document.querySelector(".tr-go").disabled`);
		const mid = await q<{ pos: string; tops: number[]; off: boolean[]; done: string }>(v, `return { pos: document.querySelector(".tr-pos").firstChild.textContent, tops: [...document.querySelectorAll(".tr-acts .tr-b")].map(b => Math.round(b.getBoundingClientRect().top)), off: [...document.querySelectorAll(".tr-acts .tr-b")].map(b => b.disabled), done: document.querySelector(".tr-sum").textContent }`);
		expect(mid.pos).toBe("1/3");
		expect(mid.tops).toEqual(before);
		expect(mid.off).toEqual([true, true, true]);
		expect(mid.done).toContain("0건");
		release();
		await waitFor(v, `document.querySelector(".tr-pos").firstChild.textContent === "2/3"`);
		expect(reqs).toHaveLength(1);
	});

	test("a failed answer keeps the owner on that card, uncounted, with the reason in the footer and the buttons usable again", async () => {
		await boot(v);
		failNext = true;
		await run(v, `document.querySelector(".tr-go").click()`);
		await waitFor(v, `document.querySelector(".tr-fail")`);
		const s = await q<{ pos: string; done: string; off: boolean; chip: boolean; fail: string }>(v, `return { pos: document.querySelector(".tr-pos").firstChild.textContent, done: document.querySelector(".tr-sum").textContent, off: document.querySelector(".tr-go").disabled, chip: !!document.querySelector(".tr-q .tr-st.err"), fail: document.querySelector(".tr-ft .tr-fail").textContent }`);
		expect(s.pos).toBe("1/3");
		expect(s.done).toContain("0건");
		expect(s.off).toBe(false);
		expect(s.chip).toBe(true);
		expect(s.fail).toContain("fail-text");
		await run(v, `document.querySelector(".tr-go").click()`);
		await waitFor(v, `document.querySelector(".tr-pos").firstChild.textContent === "2/3"`);
		expect(reqs).toHaveLength(2);
	});

	// A repaint is held while a field is typed in, but never one that moves to another card: the next press must answer the card on screen.
	test("Cmd+Enter in a card's text sends it and draws the next card, so the next press answers the card on screen", async () => {
		await boot(v);
		const press = () => run(v, `const t = document.querySelector(".tr-ta"); t.focus(); t.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }))`);
		await press();
		await waitFor(v, `document.querySelector(".tr-pos").firstChild.textContent === "2/3" && document.querySelector(".tr-ta").value === "준비 중이에요."`);
		await arrived(1);
		await press();
		await waitFor(v, `document.querySelector(".tr-pos").firstChild.textContent === "3/3"`);
		await arrived(2);
		expect(reqs.map(r => (r.body!.items as { ref: string }[])[0]!.ref)).toEqual(["Dxyz789", "Dabc234"]);
	});
});
