// A handled mail reply draft leaves the 메일 list in every filter and is folded under the mail it answers, inside that mail's conversation
// (owner 2026-10-27: "보내고 나면 해당 메일 안으로 이동시켜서 접어놔"); 지우기 on it hides it on the computer that holds it, and 지우기 on a waiting
// draft is 보내지 않기, answered once on its computer. This computer's mail and the other computer's mail behave the same.
// Headless (Bun.WebView) against a fake hub that also plays the peer behind /api/peer/proxy.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { sseResponse } from "./events.ts";
import { appAsset, indexPage } from "./webapp.ts";

const SHOTS = process.env.MAIL_SENT_SHOTS ?? "/tmp/dotz-mail-sent";
mkdirSync(SHOTS, { recursive: true });
const MINI = "http://mini.test";
const json = (v: unknown) => Response.json(v);
const iso = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 27, h, m)).toISOString();

const OPTS = [{ n: 1, label: "보내기", desc: "", rec: true }, { n: 2, label: "고치기", desc: "", rec: false, detail: true }, { n: 3, label: "보내지 않기", desc: "", rec: false }];
type Dec = { id: string; to: string; at: string; subject: string; body: string; state: string; answer?: string; dismissed?: boolean };
const notice = (d: Dec) => ({ id: d.id, ts: d.at, updated: d.at, kind: "decision", tone: "ask", title: "이 답장 보낼까요?", text: "이 답장 보낼까요?", open: d.to, src: d.to, at: d.at, read: d.state !== "open",
	decision: { options: OPTS, to: d.to, reply_to: d.at, group: 1, state: d.state, ...(d.answer ? { answer: d.answer, answered_at: iso(6, 53) } : {}), draft: { toLabel: "받는이", to: "Kim <kim@example.com>", subject: d.subject, body: d.body } } });
const mail = (subject: string, h: number, reply: string) => ({ subject, from: "Kim <kim@example.com>", to: "me@example.com", source: "acme", at: iso(h), summary: `${subject} 요약이에요.`, reply, unreplied: reply !== "replied" });
const conv = (key: string, subject: string, h: number, reply: string) => ({ target: `mail:${key}`, unread: 0, read: iso(h), mail: mail(subject, h, reply), last: { ts: iso(h), text: subject, from: "bot" } });
const mailEvent = (t: string, subject: string, h: number) => ({ ts: iso(h), kind: "mail", source: "acme", channel: t, conv: t, mail: t.slice(5), subject, from: "Kim <kim@example.com>", to: "me@example.com", text: `Kim <kim@example.com> · ${subject}\n\n${subject} 요약이에요.\n\n원문\n견적서를 보내 주세요.` });
const app = (decs: Dec[]) => ({ key: "mail", label: "메일", icon: "mail", kind: "app", conv: ["mail:"], notices: decs.filter(d => !d.dismissed).map(d => d.id), unread: 0, unreplied: 1, needs: { drafts: decs.filter(d => d.state === "open").length, unread: 0, sentToday: 0, unreplied: 1 } });
const shown = (decs: Dec[]) => decs.filter(d => !d.dismissed).map(notice);

// Each computer: one mail whose reply was sent (its draft answered 보내기), one mail whose draft waits.
type Side = { decs: Dec[]; convs: ReturnType<typeof conv>[]; posts: { path: string; body: unknown }[] };
const fresh = (p: string): Side => ({
	decs: [
		{ id: `${p}sent`, to: `mail:${p}a`, at: iso(6, 40), subject: "Re: 견적 요청", body: "안녕하세요.\n\n견적서를 첨부해 보내 드립니다.", state: "answered", answer: "1) 보내기" },
		{ id: `${p}pend`, to: `mail:${p}b`, at: iso(7), subject: "Re: 일정 조율", body: "목요일 오후 괜찮습니다.", state: "open" }],
	convs: [conv(`${p}a`, "견적 요청", 6, "replied"), conv(`${p}b`, "일정 조율", 5, "draft")],
	posts: [],
});
let local = fresh("l-"), peer = fresh("p-");
// Resolves when the fake hub has handled the next action POST (answer or dismiss) of either computer.
let posted: (() => void) | null = null;
const nextPost = () => new Promise<void>(res => { posted = res; });
const record = (s: Side, path: string, body: unknown) => { s.posts.push({ path, body }); const r = posted; posted = null; queueMicrotask(() => r?.()); };
const subjectOf = (s: Side, t: string) => s.convs.find(c => c.target === t)?.mail.subject ?? "";
const history = (s: Side, t: string, h: number) => json({ target: t, events: subjectOf(s, t) ? [mailEvent(t, subjectOf(s, t), h)] : [] });
function apply(s: Side, id: string, op: { n?: number; dismiss?: boolean }) {
	const d = s.decs.find(x => x.id === id);
	if (!d) return null;
	if (op.dismiss) { if (d.state === "open") return null; d.dismissed = true; return d; }
	const o = OPTS.find(x => x.n === op.n);
	if (!o || d.state !== "open") return null;
	d.state = "answered"; d.answer = `${o.n}) ${o.label}`;
	return d;
}
const peerView = () => ({ name: "맥미니", url: MINI, online: true, stale: false, items: { name: "맥미니", rev: JSON.stringify(peer.decs), monitors: [], available: [], notices: shown(peer.decs), integrations: [app(peer.decs)], conversations: peer.convs } });

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
		if (p === "/api/state") return json({ name: "dotz", orchestrator: { status: "idle" }, lanes: [], terminals: {}, channels: { work: [] }, discord: {}, notices_unread: 0 });
		if (p === "/api/notices") return json({ items: shown(local.decs), unread: 0 });
		if (p === "/api/monitors") return json({ items: [] });
		if (p === "/api/machine") return json({ name: "맥북", custom: "", default: "맥북" });
		if (p === "/api/peers") return json([{ name: "맥북", url: `http://127.0.0.1:${server.port}`, self: true, online: true }]);
		if (p === "/api/monitoring/peers") return json([peerView()]);
		if (p === "/api/integrations") return json({ items: [app(local.decs)], available: [] });
		if (p === "/api/conversations") return json({ items: local.convs });
		if (p === "/api/history") return history(local, url.searchParams.get("target") ?? "", 6);
		if (p === "/api/activity") return json({ items: [] });
		const m = req.method === "POST" ? /^\/api\/notices\/([^/]+)\/(answer|dismiss)$/.exec(p) : null;
		if (m) {
			const body = (await req.json()) as { n?: number };
			const d = apply(local, decodeURIComponent(m[1]!), m[2] === "dismiss" ? { dismiss: true } : { n: body.n });
			record(local, p, body);
			return d ? json({ ok: true, item: notice(d), unread: 0 }) : json({ ok: false, error: "refused" }, 400);
		}
		if (p === "/api/peer/proxy") {
			if (req.method === "POST") {
				const body = (await req.json()) as { action: string; args: { id: string; n?: number; op?: string } };
				const d = body.action === "answer" ? apply(peer, body.args.id, { n: body.args.n }) : body.action === "notice" && body.args.op === "dismiss" ? apply(peer, body.args.id, { dismiss: true }) : null;
				record(peer, body.action, body.args);
				return d ? json({ ok: true, ...(body.action === "answer" ? { item: notice(d) } : {}), unread: 0 }) : json({ error: "refused" }, 400);
			}
			const inner = new URL(url.searchParams.get("p") ?? "/", "http://x");
			if (inner.pathname === "/api/history") return history(peer, inner.searchParams.get("target") ?? "", 6);
			return json({});
		}
		return p.startsWith("/api/") ? json({}) : new Response("not found", { status: 404 });
	},
});

type View = InstanceType<typeof Bun.WebView>;
const views: View[] = [];
afterAll(() => { for (const v of views) v.close(); server.stop(true); });
const waitFor = (v: View, expr: string, ms = 10_000) =>
	v.evaluate(`new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("timeout: " + ${JSON.stringify(expr)})), ${ms}); const tick = () => { let ok = false; try { ok = !!(${expr}); } catch {} if (ok) { clearTimeout(t); res(true); } else requestAnimationFrame(tick); }; tick(); })`);
const q = async <T = unknown>(v: View, code: string): Promise<T> => JSON.parse((await v.evaluate(`JSON.stringify((() => { ${code} })())`)) as string) as T;
const run = (v: View, code: string) => v.evaluate(`(() => { ${code} })(), 0`);
const pick = async (v: View, f: string) => {
	await run(v, `const at = k => document.querySelector('#mon-tl [data-filter="' + k + '"]'); if (!at(${JSON.stringify(f)})) at("in").click()`);
	await waitFor(v, `!!document.querySelector('#mon-tl [data-filter="${f}"]')`);
	await run(v, `document.querySelector('#mon-tl [data-filter="${f}"]').click()`);
	await waitFor(v, `document.querySelector('#mon-tl .mr-place .on:not([data-filter="in"]), #mon-tl .mr-f.on').dataset.filter === ${JSON.stringify(f)}`);
};
async function open(v: View, item: string) {
	await v.navigate(`http://127.0.0.1:${server.port}/`);
	await waitFor(v, `typeof NT !== "undefined" && NT.loaded && S`);
	await run(v, `if (dotzTheme.get() === "dark") dotzTheme.toggle()`);
	await waitFor(v, `typeof INTG !== "undefined" && INTG.items.length === 1 && PQ.loaded`);
	await run(v, `go("monitoring", ${JSON.stringify(item)})`);
	await waitFor(v, `document.querySelector("#mon-tl .mr-f")`);
}
async function openConv(v: View, t: string) {
	await run(v, `go("monitoring", ${JSON.stringify(`c:${t}`)})`);
	await waitFor(v, `target === ${JSON.stringify(t)} && document.querySelector("#tl .mhd-wrap")`);
}
const FILTERS = ["all", "unread", "owed", "pending", "replied", "sent"];

const MACHINES = [["this computer", "l-", "i:mail", () => local], ["the other computer", "p-", `p:${MINI}|i:mail`, () => peer]] as const;
describe.each(MACHINES)("mail drafts of %s", (_label, px, item, side) => {
	test.each([[390, 844], [1280, 900]] as const)("at %ipx: sent draft folded in its mail, 지우기 on pending and sent", async (width, height) => {
		local = fresh("l-"); peer = fresh("p-");
		const tag = `${px}${width}`, v = new Bun.WebView({ width, height });
		views.push(v);
		await open(v, item);

		// the sent draft is in no filter of the list; the waiting one only under 확인 대기
		for (const f of FILTERS) {
			await pick(v, f);
			if (f === "pending") await waitFor(v, `document.querySelector('#mon-tl [data-nid="${px}pend"]')`);
			expect(await q<number>(v, `return document.querySelectorAll('#mon-tl [data-nid="${px}sent"]').length`)).toBe(0);
			if (f !== "pending") expect(await q<number>(v, `return document.querySelectorAll("#mon-tl .bm.dr").length`)).toBe(0);
		}
		await pick(v, "all");
		await Bun.write(join(SHOTS, `list-${tag}.png`), await v.screenshot());

		// 보내지 않기 on the waiting draft, pressed twice: one answer to the computer that holds it
		await pick(v, "pending");
		await waitFor(v, `document.querySelector('#mon-tl [data-nid="${px}pend"] .rq-acts [data-k="drop"]')`);
		expect(await q<number>(v, `return document.querySelectorAll('#mon-tl [data-nid="${px}pend"] .dr-rm').length`)).toBe(0);   // the button row has 보내지 않기: no second way in the head
		await Bun.write(join(SHOTS, `pending-${tag}.png`), await v.screenshot());
		const dropped = nextPost();
		await run(v, `const b = document.querySelector('#mon-tl [data-nid="${px}pend"] .rq-acts [data-k="drop"]'); b.click(); b.click()`);   // a double press
		await dropped;
		await waitFor(v, `!document.querySelector('#mon-tl [data-nid="${px}pend"]')`);
		const answers = side().posts.filter(x => (px === "l-" ? x.path.endsWith("/answer") : x.path === "answer"));
		expect(answers).toHaveLength(1);
		expect((answers[0]!.body as { n: number }).n).toBe(3);
		expect(side().decs.find(d => d.id === `${px}pend`)!.answer).toBe("3) 보내지 않기");

		// inside the mail's conversation: one collapsed line under the mail, a tap shows the mail as it went out
		await openConv(v, `mail:${px}a`);
		await waitFor(v, `document.querySelector('#tl .ms-card[data-nid="${px}sent"]')`);
		const folded = await q<{ exp: string | null; body: boolean; line: string; afterMail: boolean }>(v, `const c = document.querySelector('#tl .ms-card[data-nid="${px}sent"]'), slot = c.parentElement;
			return { exp: c.querySelector(".ms-line").getAttribute("aria-expanded"), body: !!c.querySelector(".ms-body"), line: c.querySelector(".ms-line").textContent,
				afterMail: !!slot.previousElementSibling && !!slot.previousElementSibling.querySelector(".mhd-wrap") }`);
		expect({ ...folded, line: "" }).toEqual({ exp: "false", body: false, line: "", afterMail: true });
		expect(folded.line).toMatch(/^보낸 답장 · .+받는이 Kim <kim@example\.com>$/);
		expect(await q<boolean>(v, `return document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
		await Bun.write(join(SHOTS, `conv-folded-${tag}.png`), await v.screenshot());

		await run(v, `document.querySelector('#tl .ms-card[data-nid="${px}sent"] .ms-line').click()`);
		await waitFor(v, `document.querySelector('#tl .ms-card[data-nid="${px}sent"] .ms-body')`);
		const open1 = await q<{ exp: string | null; sub: string; to: string; body: string; files: string }>(v, `const c = document.querySelector('#tl .ms-card[data-nid="${px}sent"]');
			return { exp: c.querySelector(".ms-line").getAttribute("aria-expanded"), sub: c.querySelector(".dr-sub").textContent, to: c.querySelector(".dr-chip").textContent, body: c.querySelector(".dr-body").textContent, files: c.querySelector(".dr-files").textContent }`);
		expect(open1).toEqual({ exp: "true", sub: "Re: 견적 요청", to: "Kim <kim@example.com>", body: "안녕하세요.견적서를 첨부해 보내 드립니다.", files: "" });
		expect(await q<boolean>(v, `return document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
		await run(v, `document.querySelector('#tl .ms-card[data-nid="${px}sent"]').scrollIntoView({ block: "center" })`);
		await Bun.write(join(SHOTS, `conv-open-${tag}.png`), await v.screenshot());

		// 지우기 on the sent card hides it on its computer; nothing is answered or sent
		const before = side().posts.length, hidden = nextPost();
		await run(v, `document.querySelector('#tl .ms-card[data-nid="${px}sent"] .ms-rm').click()`);
		await hidden;
		await waitFor(v, `!document.querySelector('#tl .ms-card[data-nid="${px}sent"]')`);
		const after = side().posts.slice(before);
		expect(after).toHaveLength(1);
		expect(px === "l-" ? after[0]!.path : (after[0]!.body as { op: string }).op).toBe(px === "l-" ? `/api/notices/${px}sent/dismiss` : "dismiss");
		expect(side().decs.find(d => d.id === `${px}sent`)!.dismissed).toBe(true);

		// after a reload the card stays gone, and the list still has no draft card
		await open(v, item);
		await openConv(v, `mail:${px}a`);
		expect(await q<number>(v, `return mailSentList(target).length + document.querySelectorAll("#tl .ms-card").length`)).toBe(0);
		v.close(); views.splice(views.indexOf(v), 1);
	}, 60_000);

	test("모두 지우기 hides every folded draft of the mail at once, one dismiss each on the computer that holds it", async () => {
		local = fresh("l-"); peer = fresh("p-");
		side().decs.push({ id: `${px}sent2`, to: `mail:${px}a`, at: iso(6, 45), subject: "Re: 견적 요청", body: "추가로 보내 드려요.", state: "answered", answer: "1) 보내기" });
		const v = new Bun.WebView({ width: 390, height: 844 });
		views.push(v);
		await open(v, item);
		await openConv(v, `mail:${px}a`);
		await waitFor(v, `document.querySelectorAll("#tl .ms-card").length === 2 && document.querySelector("#tl .ms-slot .ms-clear")`);
		await Bun.write(join(SHOTS, `clear-${px}.png`), await v.screenshot());
		const before = side().posts.length;
		await run(v, `document.querySelector("#tl .ms-slot .ms-clear").click()`);
		await waitFor(v, `!document.querySelector("#tl .ms-slot")`);
		await waitFor(v, `document.querySelector(".snack") && document.querySelector(".snack").textContent === "초안 2개를 지웠어요"`);
		const ops = side().posts.slice(before).map(x => (px === "l-" ? x.path : `${x.path}:${(x.body as { op: string; id: string }).op}:${(x.body as { id: string }).id}`)).sort();
		expect(ops).toEqual(px === "l-" ? [`/api/notices/${px}sent/dismiss`, `/api/notices/${px}sent2/dismiss`] : [`notice:dismiss:${px}sent`, `notice:dismiss:${px}sent2`]);
		expect(side().decs.filter(d => d.to === `mail:${px}a`).every(d => d.dismissed)).toBe(true);
		v.close(); views.splice(views.indexOf(v), 1);
	}, 60_000);
});
