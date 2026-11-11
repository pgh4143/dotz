// Background work on the page (web/js/06-subagents.js, 08-home.js, 41-runstate.js, 14-slash-commands.js): a worker that failed is
// the agent's to take up (owner 2026-10-29), so 홈 and the run line say 이어서 처리 중 in blue with no button and drop it once a turn
// took it up; only work the owner stopped offers 다시 맡기기. A running one offers 중단 there and on the work line, the run
// line's button acts on the conversation it is shown in, and 지금 진행 중 lists only what runs now.
import { afterAll, expect, test } from "bun:test";
import { sseResponse } from "./events.ts";
import { appAsset, indexPage } from "./webapp.ts";

const ago = (min: number) => Date.now() - min * 60_000;
const agoIso = (min: number) => new Date(ago(min)).toISOString();
type Work = Record<string, unknown>;
const RUNNING: Work = { id: "st_run", description: "흐름도 그리기", status: "running", started_at: ago(3), model: "Opus 5.5 medium" };
const FAILED: Work = { id: "st_fail", description: "빌드 고치기", status: "failed", started_at: ago(20), ended_at: ago(10), reason: "작업 폴더를 git 저장소로 읽지 못해 시작하지 못했어요" };
const STOPPED: Work = { id: "st_stop", description: "로그 정리", status: "failed", cancelled: true, started_at: ago(15), ended_at: ago(12), reason: "직접 중단했어요" };
const TAKEN: Work = { id: "st_taken", description: "이미 다룬 실패", status: "failed", handled: true, started_at: ago(40), ended_at: ago(35), reason: "x" };
const DONE: Work = { id: "st_done", description: "요약 쓰기", status: "done", started_at: ago(30), ended_at: ago(25) };
let WORK: Work[] = [RUNNING, FAILED, DONE];
let RUNS: Record<string, Record<string, unknown>> = {};
let ORCH = "idle";
let CONVS: Record<string, unknown>[] = [];
const LANES = [{ name: "fix", title: "기술부채 정리", status: "idle", startedAt: agoIso(60), lastText: "The WebView worker is done", model: "anthropic/claude-opus-5-5" }];
const posts: string[] = [];
// The chat's queue and subagents (web/js/14-slash-commands.js, 06-subagents.js) and the requests the page makes on them.
let QUEUED: Work[] = [];
let SUBS: Record<string, Work[]> = {};
const hits: string[] = [];
// A POST the page sends, awaited by path: subscribed before the click, resolved by the fixture server when it arrives.
const waiters: [string, () => void][] = [];
const posted = (path: string) => new Promise<void>(res => (posts.includes(path) ? res() : waiters.push([path, res])));
const json = (v: unknown) => Response.json(v);
const server = Bun.serve({
	port: 0,
	hostname: "127.0.0.1",
	idleTimeout: 0,
	fetch(req) {
		const url = new URL(req.url), p = url.pathname;
		if (p === "/") return indexPage(req);
		const asset = appAsset(req, p);
		if (asset) return asset;
		if (req.method === "POST" && /^\/api\/(workers|lanes|orchestrator)\//.test(p)) { posts.push(p); for (const [w, res] of waiters) if (w === p) res(); return json({ ok: true }); }
		if (p === "/api/queue" && req.method === "GET") return json({ items: QUEUED });
		if (p.startsWith("/api/queue/")) { hits.push(`${req.method} ${p}`); return json({ ok: true, text: QUEUED.find(i => p.split("/")[3] === i.id)?.text }); }
		if (p === "/api/subagents") return json({ sources: SUBS });
		if (p === "/api/events") return sseResponse(req.headers.get("last-event-id") ?? url.searchParams.get("last"));
		if (p === "/api/state") return json({ name: "dotz", orchestrator: { status: ORCH, lastText: "ok" }, lanes: LANES, terminals: {}, channels: { work: [] }, discord: {}, notices_unread: 0, work: WORK, convs: CONVS, work_now: Date.now(), runs: RUNS });
		if (p === "/api/notices") return json({ unread: 0, items: [] });
		if (p === "/api/monitors") return json({ items: [] });
		if (p === "/api/history") return json({ target: url.searchParams.get("target"), events: [] });
		if (p === "/api/activity") return json({ items: [], more: false, history: false });
		if (p === "/api/todo") return json({ phases: [] });
		return p.startsWith("/api/") ? json({}) : new Response("not found", { status: 404 });
	},
});

type View = InstanceType<typeof Bun.WebView>;
const views: View[] = [];
afterAll(() => { for (const v of views) v.close(); server.stop(true); });
let load = 0;
const waitFor = (v: View, expr: string, ms = 10_000) =>
	v.evaluate(`new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("timeout: " + ${JSON.stringify(expr)})), ${ms}); const tick = () => { let ok = false; try { ok = !!(${expr}); } catch {} if (ok) { clearTimeout(t); res(true); } else requestAnimationFrame(tick); }; tick(); })`);
const q = async <T>(v: View, body: string): Promise<T> => JSON.parse(String(await v.evaluate(`JSON.stringify((() => { ${body} })())`))) as T;
const boot = async (hash: string) => {
	const v = new Bun.WebView({ width: 1280, height: 900 });
	views.push(v);
	await v.navigate(`http://127.0.0.1:${server.port}/?load=${++load}${hash}`);
	await waitFor(v, `S && S.runs && typeof target === "string"`);
	return v;
};
const sections = (v: View) => q<Record<string, string[]>>(v, `const out = {}; for (const box of document.querySelectorAll("#v-home .hn[data-k]")) out[box.dataset.k] = [...box.children].map(r => r.textContent.replace(/\\s+/g, " ").trim()); return out;`);

test("홈: 지금 진행 중 is only what runs; waiting rows say their state in Korean; failed work is taken up, stopped work offers 다시 맡기기, and a lane is drawn once", async () => {
	WORK = [RUNNING, FAILED, STOPPED, TAKEN, DONE];
	RUNS = { main: { kind: "done", since: agoIso(5) }, "lane:fix": { kind: "idle", reason: "unfinished", todos: 2 } };
	ORCH = "idle";
	posts.length = 0;
	const v = await boot("#home");
	await waitFor(v, `current === "home" && document.querySelector('#v-home .hn[data-k="ended-work"]')`);
	const s = await sections(v);
	expect(s.running).toHaveLength(1);
	expect(s.running![0]).toContain("흐름도 그리기");
	expect(s.running![0]).toContain("Opus 5.5 medium");
	expect(s.waiting!.some(r => r.includes("끝났어요"))).toBe(false);
	expect(s.waiting!.some(r => r.includes("중단됨"))).toBe(true);
	expect(s.waiting!.some(r => r.includes("쉬는 중 · 할 일 2개 남음"))).toBe(true);
	expect(s.waiting!.join("|")).not.toContain("The WebView worker");
	expect(s["ended-work"]!.find(r => r.includes("빌드 고치기"))).toContain("이어서 처리 중");
	expect(s["ended-work"]!.find(r => r.includes("빌드 고치기"))).toContain("실패 · 작업 폴더를 git 저장소로 읽지 못해 시작하지 못했어요");
	expect(s["ended-work"]!.some(r => r.includes("이미 다룬 실패"))).toBe(false);
	expect(await v.evaluate(`document.querySelector('#v-home [data-work="st_fail"] .dot').className`)).toBe("dot pri");
	// A running or finished row ends in a time, not in a state word; the word stays in the aria-label (the dot says it to the eye).
	expect(s["ended-work"]!.find(r => r.includes("요약 쓰기"))).not.toContain("완료");
	expect(await v.evaluate(`document.querySelector('#v-home [data-work="st_done"] .hrx-m').getAttribute("aria-label")`)).toContain("완료");
	expect(await v.evaluate(`document.querySelector('#v-home [data-work="st_run"] .hs').textContent`)).toMatch(/째$|^방금 시작$/);
	expect(await v.evaluate(`document.querySelector('#v-home [data-work="st_run"] .hrx-m').getAttribute("aria-label")`)).toContain("작업 중");
	// The session is a row above, not also a card on the board; 알림 and 할일 have nothing to say here, so neither card is drawn.
	await waitFor(v, `document.querySelector('#home-cards [data-id="now:running"]')`);
	expect(await v.evaluate(`!!document.querySelector('#home-cards [data-id="notices:alert"], #home-cards [data-id="now:todo"]')`)).toBe(false);
	expect(await v.evaluate(`!!document.querySelector('#home-cards [data-id="lane:fix"], #home-cards [data-id="group:lane"]')`)).toBe(false);
	expect(await v.evaluate(`document.querySelectorAll('#v-home [data-act="retry"]').length`)).toBe(1);
	const p__api_workers_st_stop_retry = posted("/api/workers/st_stop/retry");
	await v.evaluate(`(document.querySelector('#v-home [data-work="st_stop"] [data-act="retry"]').click(), 0)`);
	await p__api_workers_st_stop_retry;
	// A running row shows only its state (owner 2026-11-01): no 중단 on the list, the conversation's send button stops it.
	expect(await v.evaluate(`document.querySelectorAll('#v-home [data-work="st_run"] button').length`)).toBe(1);
	expect(s.running![0]).not.toContain("중단");
}, 30_000);

test("홈: a session the run line calls 진행 중 (waiting on its own worker) is listed under 지금 진행 중, not 대기 중", async () => {
	LANES.push({ name: "bgw", title: "알림 분류 업데이트 마무리", status: "idle", startedAt: agoIso(30), lastText: "", model: "anthropic/claude-opus-5-5" });
	WORK = [];
	RUNS = { main: { kind: "idle" }, "lane:bgw": { kind: "waiting", reason: "work", since: agoIso(2), detail: "빌드 · Opus 5.5 medium" } };
	try {
		const v = await boot("#home");
		await waitFor(v, `current === "home" && document.querySelector('#v-home .hn[data-k="running"] [data-t="lane:bgw"]')`);
		const s = await sections(v);
		expect(s.running).toHaveLength(1);
		expect(s.running![0]).toContain("알림 분류 업데이트 마무리");
		expect(await v.evaluate(`document.querySelector('#v-home [data-t="lane:bgw"] .hs').textContent`)).toMatch(/째$|^방금 시작$/);
		expect(await v.evaluate(`document.querySelector('#v-home [data-t="lane:bgw"]').getAttribute("aria-label")`)).toContain("진행 중");
		expect(s.waiting).toBeUndefined();
		expect(await v.evaluate(`document.querySelector('#v-home .card:has([data-k="running"]) .hc-n').textContent`)).toBe("1개");
	} finally {
		LANES.pop();
	}
}, 20_000);

test("홈: an app conversation whose own session runs is a row of 지금 진행 중 with its title, run line and worker, opens in its app view, and leaves when idle", async () => {
	WORK = [];
	CONVS = [
		{ target: "mail:acme-67180972", name: "회의록 흐름도 요청", work: [{ id: "st_conv", description: "흐름도 HTML 만들기", status: "running", started_at: ago(4), model: "Opus 5.5 medium" }] },
		{ target: "settings:youtube", work: [] },
	];
	RUNS = { main: { kind: "idle" }, "mail:acme-67180972": { kind: "working", since: agoIso(6), detail: "흐름도 그리기" }, "settings:youtube": { kind: "done", since: agoIso(30) } };
	try {
		const v = await boot("#home");
		await waitFor(v, `current === "home" && document.querySelector('#v-home .hn[data-k="running"] [data-t="mail:acme-67180972"]')`);
		const s = await sections(v);
		expect(s.running).toHaveLength(2);
		expect(s.running![0]).toContain("회의록 흐름도 요청");
		expect(s.running![0]).toContain("작업 중 · 흐름도 그리기 · 6분");
		expect(s.running![0]).not.toContain("acme-67180972");
		expect(s.running![1]).toContain("흐름도 HTML 만들기");
		expect(s.running![1]).toContain("Opus 5.5 medium");
		expect(s.running!.join("|")).not.toContain("settings:youtube");
		// same row shape as the others: no 중단 on the list
		expect(await v.evaluate(`document.querySelectorAll('#v-home .hn[data-k="running"] button').length`)).toBe(2);
		await v.evaluate(`(document.querySelector('#v-home [data-t="mail:acme-67180972"]').click(), 0)`);
		await waitFor(v, `current === "chat" && target === "mail:acme-67180972"`);
		expect(await v.evaluate(`location.hash`)).toBe("#monitoring/c:mail%3Aacme-67180972");
		// the turn ended: the row is gone on the next state refresh
		RUNS = { main: { kind: "idle" }, "mail:acme-67180972": { kind: "done", since: agoIso(0) } };
		CONVS = [{ target: "mail:acme-67180972", name: "회의록 흐름도 요청", work: [] }];
		await v.evaluate(`(go("home"), refreshState().then(() => true))`);
		await waitFor(v, `current === "home" && !document.querySelector('#v-home [data-t="mail:acme-67180972"]')`);
		expect((await sections(v)).running).toEqual(["진행 중인 작업이 없어요"]);
	} finally {
		CONVS = [];
	}
}, 20_000);

test("홈: nothing running says so instead of listing idle conversations under 지금 진행 중", async () => {
	WORK = [];
	RUNS = { main: { kind: "idle" } };
	const v = await boot("#home");
	await waitFor(v, `current === "home" && document.querySelector('#v-home .hn[data-k="running"]')`);
	const s = await sections(v);
	expect(s.running).toEqual(["진행 중인 작업이 없어요"]);
	expect(s.waiting).toBeUndefined();
	expect(s["ended-work"]).toBeUndefined();
}, 20_000);

test("the run line says 이어서 처리 중 for a failed worker, in blue with no button, and the work line's 중단 ends the background worker", async () => {
	WORK = [FAILED];
	RUNS = { main: { kind: "waiting", reason: "recover", since: agoIso(10), detail: "빌드 고치기 · 작업 폴더를 git 저장소로 읽지 못해 시작하지 못했어요", work: "st_fail" } };
	posts.length = 0;
	const v = await boot("#chat");
	await v.evaluate(`(setTarget(MAIN), go("chat"), 0)`);
	await waitFor(v, `!$("#runstate").hidden`);
	expect(await v.evaluate(`$("#runstate-tx").textContent`)).toBe("이어서 처리 중 · 빌드 고치기 실패");
	expect(await v.evaluate(`$("#runstate-act").hidden`)).toBe(true);
	expect(await v.evaluate(`$("#runstate-dot").className`)).toBe("dot pri");

	WORK = [{ ...RUNNING, target: "web" }];
	RUNS = { main: { kind: "waiting", reason: "work", since: agoIso(3), detail: "흐름도 그리기 · Opus 5.5 medium", work: "st_run" } };
	await v.evaluate(`refreshState().then(() => true)`);
	// The send button is the one 중단 (owner 2026-10-28): it turns into stop for the background worker; the run line has no second button.
	await waitFor(v, `!$("#working").hidden && $("#send-btn").classList.contains("stop")`);
	expect(await v.evaluate(`$("#runstate-act").hidden`)).toBe(true);
	await v.evaluate(`(setTimeout(() => $("#send-btn").click()), 0)`);
	await waitFor(v, `document.querySelector("dialog[open] .dact .danger")`);
	const p__api_workers_st_run_cancel = posted("/api/workers/st_run/cancel");
	await v.evaluate(`(setTimeout(() => document.querySelector("dialog[open] .dact .danger").click()), 0)`);
	await p__api_workers_st_run_cancel;
	expect(posts).not.toContain("/api/orchestrator/abort");
}, 30_000);

test("the run line's button acts on its own conversation: a session restarts itself, a mail worker is handed over again, a feed gets nothing", async () => {
	const v = await boot("#chat");
	const act = (r: Record<string, unknown>, t: string) => v.evaluate(`(() => { const a = runAction(${JSON.stringify(r)}, ${JSON.stringify(t)}); return a ? a.label : null; })()`);
	const err = { kind: "error", detail: "모델 오류" };
	expect(await act(err, "main")).toBe("다시 시도");
	expect(await act(err, "lane:fix")).toBe("다시 시작");
	expect(await act({ kind: "stopped" }, "lane:fix")).toBe("다시 시작");
	expect(await act({ kind: "limited", reason: "rate" }, "lane:fix")).toBeNull();
	expect(await act({ kind: "error", reason: "work", cancelled: true, work: "st_stop" }, "mail:k1")).toBe("다시 맡기기");
	expect(await act({ kind: "waiting", reason: "recover", work: "st_fail" }, "mail:k1")).toBeNull();
	expect(await act({ kind: "working", work: "st_run" }, "mail:k1")).toBeNull();   // stopped by the send button, not the run line
	expect(await act(err, "mail:k1")).toBeNull();
	expect(await act(err, "alert")).toBeNull();
	expect(await act({ kind: "stopped" }, "worklog")).toBeNull();
	// A session's 다시 시작 calls that session's restart, never the assistant's.
	posts.length = 0;
	const p__api_lanes_fix_restart = posted("/api/lanes/fix/restart");
	await v.evaluate(`(runAction({ kind: "stopped" }, "lane:fix").run({ currentTarget: null }), 0)`);
	await p__api_lanes_fix_restart;
	expect(posts).not.toContain("/api/orchestrator/restart");
}, 20_000);

// The chat's end (owner 2026-11-10): a queued message is the owner's dimmed bubble at the end of the timeline with 지금 끼워넣기 and 취소 under it, and the
// one status line above the input holds what runs on the left and the subagent count on the right; there is no queue card.
test("a queued message is a bubble at the end of the timeline whose two actions send the same requests, and one status line holds the work and the subagents", async () => {
	WORK = [{ ...RUNNING, target: "web" }];
	RUNS = {};
	QUEUED = [{ id: "q1", target: "main", text: "첫째 대기" }, { id: "q2", target: "main", text: "둘째 대기" }];
	SUBS = { orchestrator: [{ id: "a1", status: "running", started_at: 1, description: "조사" }, { id: "a2", status: "running", started_at: 1, description: "정리" }] };
	hits.length = 0;
	const v = await boot("#chat");
	await v.evaluate(`(setTarget(MAIN), go("chat"), 0)`);
	const qd = `document.querySelectorAll("#tl > .qd").length`;
	await waitFor(v, `${qd} === 2 && !$("#runline").hidden && !$("#runline-subs").hidden`);
	const st = await q<{ card: boolean; texts: string[]; tail: boolean; lines: number; left: string; right: string }>(v, `
		const lines = [...document.querySelectorAll("#composer .runstate")].filter(n => n.getBoundingClientRect().height > 0);
		return { card: !!document.querySelector("#queue"), texts: [...document.querySelectorAll("#tl > .qd > .ub")].map(n => n.textContent), tail: tl.lastElementChild.classList.contains("qd"),
			lines: lines.length, left: $("#runline-tx").textContent, right: $("#runline-subs").textContent };`);
	expect(st.card).toBe(false);
	expect(st.texts).toEqual(["첫째 대기", "둘째 대기"]);
	expect(st.tail).toBe(true);
	expect(st.lines).toBe(1);
	expect(st.left.startsWith("흐름도 그리기")).toBe(true);
	expect(st.left).not.toContain("백그라운드 작업 중");
	expect(st.left).not.toContain("Opus");
	expect(st.right).toBe("서브에이전트 2 ›");
	// the count opens the subagent sheet
	await v.evaluate(`($("#runline-subs").click(), 0)`);
	await waitFor(v, `SUBD && SUBD.sources.join() === "orchestrator" && !sheet.hidden`);
	await v.evaluate(`(closeSheet(), 0)`);
	// conversations never mix: the main chat's two subagents are not counted in a mail conversation or a project (each has its own session, hub/convsessions.ts)
	expect(await q<[string[], number[]]>(v, `const ts = [MAIN, "mail:m1", "ch:12"]; return [ts.map(subsSourceOf), ts.map(t => runningSubs(subsSourceOf(t)).length)];`)).toEqual([["orchestrator", "conv:mail:m1", "conv:ch:12"], [2, 0, 0]]);

	const press = (i: number, label: string) => v.evaluate(`([...document.querySelectorAll("#tl > .qd")][${i}].querySelectorAll("button") .forEach(b => b.textContent === ${JSON.stringify(label)} && b.click()), 0)`);
	await press(0, "지금 끼워넣기");
	await waitFor(v, `${qd} === 1`);
	expect(hits).toEqual(["POST /api/queue/q1/send"]);
	await press(0, "취소");
	await waitFor(v, `${qd} === 0`);
	expect(hits).toEqual(["POST /api/queue/q1/send", "DELETE /api/queue/q2"]);
	expect(await v.evaluate(`ta.value`)).toBe("둘째 대기");
	QUEUED = [];
	SUBS = {};
}, 30_000);
