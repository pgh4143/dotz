import { afterAll, expect, test } from "bun:test";
import { fakeHub, on } from "./test-web.ts";

// A screen that could not load says so and offers 다시 시도 (emptyNode's retry); a later redraw must not turn it back into 불러오는 중.
const hub = fakeHub({ stream: "fake" });
afterAll(() => hub.stop());
const view = await hub.view({ width: 390, height: 844 });
const { waitFor } = on(view);
const opened = hub.nextStream();
await view.navigate(`${hub.origin}/`);
await opened;
await waitFor(`typeof loadModels === "function" && S && NT.loaded`);

test("모델: a failed load keeps its 다시 시도 through a redraw, and pressing it loads the screen", async () => {
	await view.evaluate(`(window.__api = api, api = (p, ...r) => (p === "/api/models" ? Promise.reject(new Error("연결할 수 없어요")) : __api(p, ...r)), M = null, go("models"), 0)`);
	await waitFor(`current === "models" && !!document.querySelector('#models [data-k="retry"]')`);
	expect(await view.evaluate(`(renderModels(), !!document.querySelector('#models [data-k="retry"]'))`)).toBe(true);
	await view.evaluate(`(api = __api, document.querySelector('#models [data-k="retry"]').click(), 0)`);
	await waitFor(`!!M && !document.querySelector("#models .empty")`);
});

test("터미널: a failed load says so in the body with 다시 시도, and pressing it loads again", async () => {
	await view.evaluate(`(window.__shN = 0, window.__shLib = shLib, shLib = () => (__shN++, Promise.reject(new Error("터미널 구성요소를 불러오지 못했어요"))), openShell({}), 0)`);
	await waitFor(`!!document.querySelector("dialog.shell .sh-fail:not([hidden]) .btn")`);
	expect(JSON.parse(await view.evaluate(`JSON.stringify({ n: __shN, st: document.querySelector(".sh-st").textContent, term: document.querySelector(".sh-term").hidden })`) as string)).toEqual({ n: 1, st: "", term: true });
	await view.evaluate(`(document.querySelector("dialog.shell .sh-fail .btn").click(), 0)`);
	await waitFor(`__shN === 2 && !!document.querySelector("dialog.shell .sh-fail:not([hidden])")`);
	await view.evaluate(`(shLib = __shLib, document.querySelector("dialog.shell").close(), 0)`);
});

// One rule for every list: loading says 불러오는 중…, a failed first read says so with ONE 다시 시도 that loads again, and neither shows the empty line.
const failing = (path: string) => `(window.__api = window.__api || api, api = (p, ...r) => (p.startsWith(${JSON.stringify(path)}) ? Promise.reject(new Error("연결할 수 없어요")) : __api(p, ...r)), 0)`;
const texts = async (sel: string) => JSON.parse((await view.evaluate(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(sel)})].map(n => n.textContent.trim()))`)) as string) as string[];

test("채팅 목록: a failed first read shows one 다시 시도 under the list, and pressing it loads the list", async () => {
	await view.evaluate(failing("/api/conversations"));
	await view.evaluate(`(go("chat"), CV.loaded = false, CV.failed = false, convLoad(), 0)`);
	await waitFor(`CV.failed && !!document.querySelector('#chat-convo [data-k="retry"]')`);
	expect(await texts("#chat-convo .empty")).toEqual([expect.stringContaining("대화 목록을 불러오지 못했어요")]);
	await view.evaluate(`(api = __api, document.querySelector('#chat-convo [data-k="retry"]').click(), 0)`);
	await waitFor(`CV.loaded && !document.querySelector('#chat-convo [data-k="retry"]')`);
});

test("프로젝트: a failed list keeps its 다시 시도, and pressing it loads the list", async () => {
	await view.evaluate(failing("/api/custom"));
	await view.evaluate(`(PRJ = null, PRJ_FAIL = false, prjFlight = null, go("projects"), 0)`);
	await waitFor(`PRJ_FAIL && !!document.querySelector('#v-projects [data-k="retry"]')`);
	await view.evaluate(`(api = __api, document.querySelector('#v-projects [data-k="retry"]').click(), 0)`);
	await waitFor(`!!PRJ && !PRJ_FAIL`);
});

test("모니터링: a failed list says so as a card with 다시 시도 and never claims there is no news", async () => {
	await view.evaluate(failing("/api/monitors"));
	await view.evaluate(`(NM.loaded = false, NM.failed = false, go("monitoring"), loadMonitors(), 0)`);
	await waitFor(`NM.failed && !!document.querySelector('#mon-side [data-k="retry"]')`);
	expect((await texts("#mon-side .empty, #mon-feed .empty")).join("|")).not.toContain("새 감시 소식이 없어요");
	await view.evaluate(`(api = __api, document.querySelector('#mon-side [data-k="retry"]').click(), 0)`);
	await waitFor(`NM.loaded && !document.querySelector('#mon-side [data-k="retry"]')`);
});

test("사용량: a failed read keeps the usual 새로고침 and adds no second retry", async () => {
	await view.evaluate(failing("/api/quota"));
	await view.evaluate(`(go("usage"), 0)`);
	await waitFor(`!!document.querySelector("#usage .tools-bar .btn") && !!document.querySelector("#usage .empty")`);
	expect(await texts("#usage .empty")).toEqual(["사용량을 불러오지 못했어요"]);
	expect(await view.evaluate(`document.querySelectorAll('#usage [data-k="retry"]').length`)).toBe(0);
	await view.evaluate(`(api = __api, document.querySelector("#usage .tools-bar .btn").click(), 0)`);
	await waitFor(`!/불러오지 못했어요/.test(document.querySelector("#usage").textContent)`);
});

test("대화: a failed first read shows 다시 시도, not 불러오는 중 for ever", async () => {
	await waitFor(`ts("worklog").hLoaded`);
	await view.evaluate(failing("/api/history"));
	await view.evaluate(`((() => { const s = ts("worklog"); s.msgs = []; s.acts = []; s.hLoaded = s.aLoaded = false; s.herr = false; s.loading = null; openTarget("worklog", "chat"); })(), 0)`);
	await waitFor(`!!document.querySelector('#timeline [data-k="retry"]')`);
	await view.evaluate(`(api = __api, document.querySelector('#timeline [data-k="retry"]').click(), 0)`);
	await waitFor(`!document.querySelector('#timeline [data-k="retry"]')`);
});
