import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sseResponse } from "./events.ts";
import { appAsset, indexPage } from "./webapp.ts";

// 모니터링 over a fixed gateway: every plain monitor row and its conversation carries a last-run → next-run bar with the result as a tag,
// a disconnected app or watch says so at once with 지금 다시 확인, and 감시 소식 opens with every plain monitor at a glance. The times are
// built from the wall clock (new Date(), untouched by the test clock) so the page's own Date.now() puts the ok bar at about half.
const SHOTS = process.env.MONITORING_SHOTS ?? join(tmpdir(), "dotz-shots", "monitoring");
mkdirSync(SHOTS, { recursive: true });
const T0 = new Date().getTime();
const at = (ms: number) => new Date(ms).toISOString();
const WINDOW = 20 * 60_000;
const base = (name: string, watch: string, extra: Record<string, unknown> = {}) => ({ name, watch, kind: "watch", last_run: at(T0 - WINDOW / 2), next_run: at(T0 + WINDOW / 2), last_result: "ok", connection: "connected", every: "20분마다", ...extra });
const many = Array.from({ length: 45 }, (_, i) => ({ id: `many-${i}`, kind: "watch", tone: "", title: "많은 감시", text: `많은 감시: 결과 ${i + 1}번째 확인이에요`, ts: at(T0 - (45 - i) * 60_000), read: true }));
const initial = (): Record<string, unknown>[] => [
  base("절반 감시", "half-watch", { last_summary: "모두 정상이에요" }),
  base("실패 감시", "fail-watch", { last_result: "fail", fails: 1, last_summary: "로그인이 풀렸어요" }),
  base("끊긴 감시", "down-watch", { connection: "disconnected", since: at(T0 - 2 * 3600_000), conn_reason: "login", last_result: "fail", fails: 3 }),
  base("늦은 감시", "late-watch", { last_run: at(T0 - 40 * 60_000), next_run: at(T0 - 10 * 60_000), last_summary: "새 소식이 없어요" }),
  base("많은 감시", "many-watch", { last_summary: "확인을 마쳤어요" }),
];
let monitors = initial();
const peers: Record<string, unknown>[] = [];
beforeEach(() => { monitors = initial(); runs.length = 0; peers.length = 0; });
const notices: Record<string, unknown>[] = [...many];
const runs: string[] = [];
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
    if (p === "/api/state") return json({ name: "dotz", orchestrator: { status: "idle" }, lanes: [], terminals: {}, channels: { work: [] }, discord: {}, notices_unread: 0, schedules: [], events: [] });
    if (p === "/api/peers") return json([{ name: "맥북", url: `http://127.0.0.1:${server.port}`, self: true, online: true }, ...peers.map(x => ({ name: x.name, url: x.url, self: false, online: x.online }))]);
    if (p === "/api/machine") return json({ name: "맥북", custom: "", default: "맥북" });
    if (p === "/api/monitors") return json({ items: monitors });
    if (p === "/api/notices") return json({ unread: 0, items: notices });
    if (p === "/api/integrations") return json({ items: [], available: [] });
    if (p === "/api/conversations") return json({ items: [] });
    if (p === "/api/monitoring/peers") return json(peers);
    if (p.startsWith("/api/history")) return json({ target: url.searchParams.get("target") ?? "", events: [] });
    const run = /^\/api\/watches\/([a-z0-9-]+)\/run$/.exec(p);
    if (run && req.method === "POST") {
      const name = run[1]!;
      runs.push(name);
      const now = new Date().getTime();
      const item = base(name === "down-watch" ? "끊긴 감시" : "절반 감시", name, { last_run: at(now), next_run: at(now + WINDOW), last_summary: "다시 확인했어요" });
      monitors = monitors.map(m => (m.watch === name ? item : m));
      return json({ ok: true, item });
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
const boot = async (width: number, height: number) => {
  const v = new Bun.WebView({ width, height });
  views.push(v);
  await v.navigate(`http://127.0.0.1:${server.port}/`);
  await waitFor(v, `S && NM.loaded && NT.loaded && PR.fresh && NM.items.length === 5`);
  await run(v, `if (dotzTheme.get() === "dark") dotzTheme.toggle()`);
  await run(v, `go("monitoring")`);
  return v;
};
const row = (name: string) => `[data-k="m:${name}"]`;
const rowProg = (name: string) => `document.querySelector('${row(name)} .mon-prog-wrap')`;

describe("a monitor row and its conversation", () => {
  test("the ok bar is halfway, each result shows as a tag, and an overdue bar is full in the warn tone", async () => {
    const v = await boot(1280, 900);
    await waitFor(v, rowProg("절반 감시"));
    const pct = await q<number>(v, `const f = document.querySelector('${row("절반 감시")} .mon-prog i'); return parseFloat(f.style.width || "")`);
    expect(pct).toBeGreaterThan(48);
    expect(pct).toBeLessThan(53);
    // One result tag per row: the right badge. The bar has none, and its meta line is the short form that fits the left column.
    expect(await q(v, `return document.querySelector('${row("절반 감시")} .cv-m .tag').textContent`)).toBe("정상");
    expect(await q(v, `return document.querySelectorAll('${row("절반 감시")} .mon-prog .mon-ptag').length`)).toBe(0);
    expect(await q(v, `return document.querySelector('${row("절반 감시")} .mon-prog-tx').textContent`)).toMatch(/^\d+분 전 · \d+분 후$/);
    const fit = await q<boolean>(v, `const t = document.querySelector('${row("절반 감시")} .mon-prog-tx'); return t.scrollWidth <= t.clientWidth + 1`);
    expect(fit).toBe(true);
    expect(await q(v, `return document.querySelector('${row("실패 감시")} .cv-m .tag').textContent`)).toBe("실패");
    expect(await q(v, `return document.querySelector('${row("끊긴 감시")} .cv-m .tag').textContent`)).toBe("연결 끊김");
    expect(await q(v, `return document.querySelector('${row("끊긴 감시")}').textContent`)).toContain("연결 끊김");
    const downFit = await q<boolean>(v, `const t = document.querySelector('${row("끊긴 감시")} .cv-p'); return t.scrollWidth <= t.clientWidth + 1 && /^연결 끊김 · .+부터$/.test(t.textContent)`);
    expect(downFit).toBe(true);
    expect(await q(v, `const p = document.querySelector('${row("늦은 감시")} .mon-prog'); return [p.classList.contains("warn"), parseFloat(p.querySelector("i").style.width)]`)).toEqual([true, 100]);
    expect(await q(v, `return document.querySelector('${row("늦은 감시")} .cv-m .tag').textContent`)).toBe("늦어짐");
    await Bun.write(join(SHOTS, "monitoring-1280.png"), await v.screenshot());
  });

  test("a disconnected monitor opens with the banner and its hint, and 지금 다시 확인 runs it and repaints the new state", async () => {
    runs.length = 0;
    const v = await boot(1280, 900);
    await run(v, `go("monitoring", "m:끊긴 감시")`);
    await waitFor(v, `document.querySelector("#mon-head .mon-banner")`);
    expect(await q(v, `return document.querySelector("#mon-head .mon-banner").textContent`)).toMatch(/연결이 끊겼어요.*다시 로그인 필요/);
    expect(await q(v, `return document.querySelector("#mon-head .mon-banner .mon-recheck").textContent`)).toBe("다시 연결");
    expect(await q(v, `return [document.querySelectorAll("#mon-head [data-run]").length, document.querySelectorAll("#mon-tl [data-run]").length, document.querySelectorAll(".mon-recheck").length]`)).toEqual([0, 0, 1]);
    expect(await q(v, `return document.querySelector("#mon-head .mon-banner .mon-banner-tx").textContent`)).toMatch(/^연결이 끊겼어요 · .+부터 · 다시 로그인 필요$/);
    await Bun.write(join(SHOTS, "monitoring-detail-1280.png"), await v.screenshot());
    await run(v, `document.querySelector("#mon-head .mon-banner .mon-recheck").click()`);
    await waitFor(v, `!MON.running.size && !document.querySelector("#mon-head .mon-banner") && document.querySelector("#mon-head .mon-ptag").textContent === "정상"`);
    expect(runs).toEqual(["down-watch"]);
    expect(await q(v, `return document.querySelector("#mon-head .mon-ptag").textContent`)).toBe("정상");
    expect(await q(v, `return document.querySelector("#mon-head .mon-prog-tx").textContent`)).toContain("지난 실행");
    expect(await q(v, `return [document.querySelectorAll("#mon-head [data-run]").length, document.querySelectorAll(".mon-recheck").length]`)).toEqual([1, 0]);
  });

  test("a phone puts the same bar, banner and 지금 확인 at the top of the conversation", async () => {
    const v = await boot(390, 844);
    await waitFor(v, `document.querySelector('${row("절반 감시")} .mon-prog-tx')`);
    const fit = await q<boolean>(v, `const t = document.querySelector('${row("절반 감시")} .mon-prog-tx'); return t.scrollWidth <= t.clientWidth + 1`);
    expect(fit).toBe(true);
    const downFit = await q<boolean>(v, `const t = document.querySelector('${row("끊긴 감시")} .cv-p'); return t.scrollWidth <= t.clientWidth + 1 && /^연결 끊김 · .+부터$/.test(t.textContent)`);
    expect(downFit).toBe(true);
    await Bun.write(join(SHOTS, "monitoring-list-390.png"), await v.screenshot());
    await run(v, `go("monitoring", "m:끊긴 감시")`);
    await waitFor(v, `document.querySelector("#mon-tl .mon-banner") && document.querySelector("#mon-tl .mon-prog")`);
    expect(await q(v, `return document.querySelector("#mon-tl .mon-banner").dataset.kind`)).toBe("down");
    expect(await q(v, `return [document.querySelectorAll("#mon-tl [data-run]").length, document.querySelectorAll("#mon-tl .mon-recheck").length]`)).toEqual([0, 1]);
    await Bun.write(join(SHOTS, "monitoring-390.png"), await v.screenshot());
    await run(v, `go("monitoring", "notice")`);
    // A phone folds the status card to its one summary row (state counts) until it is tapped; a wide screen keeps it open.
    await waitFor(v, `document.querySelector("#mon-tl .mon-ov-h")`);
    expect(await q(v, `const h = document.querySelector("#mon-tl .mon-ov-h"); return [h.getAttribute("aria-expanded"), document.querySelectorAll("#mon-tl .mon-ov-row").length, /\\d/.test(h.querySelector(".mon-ov-sum").textContent)]`)).toEqual(["false", 0, true]);
    await run(v, `document.querySelector("#mon-tl .mon-ov-h").click()`);
    await waitFor(v, `document.querySelectorAll("#mon-tl .mon-ov-row").length === 5`);
    await Bun.write(join(SHOTS, "monitoring-feed-390.png"), await v.screenshot());
    expect(await q<number>(v, `return document.documentElement.scrollWidth`)).toBeLessThanOrEqual(390);
    await run(v, `go("monitoring", "m:절반 감시")`);
    await waitFor(v, `document.querySelector("#mon-tl [data-run]")`);
    expect(await q(v, `return document.querySelector("#mon-tl [data-run]").textContent`)).toBe("지금 확인");
    expect(await q(v, `return document.querySelector("#mon-tl [data-run]").classList.contains("btn")`)).toBe(true);
  });

  test("a connected monitor whose last check failed gets the failure banner, never the disconnected one", async () => {
    const v = await boot(1280, 900);
    await run(v, `go("monitoring", "m:끊긴 감시")`);
    await waitFor(v, `document.querySelector("#mon-head .mon-banner")`);
    const down = await q<{ kind: string; head: string }>(v, `const b = document.querySelector("#mon-head .mon-banner"); return { kind: b.dataset.kind, head: b.querySelector("b").textContent }`);
    await run(v, `go("monitoring", "m:실패 감시")`);
    await waitFor(v, `MON.sel === "m:실패 감시" && document.querySelector("#mon-head .mon-banner")`);
    const fail = await q<{ kind: string; head: string; text: string; role: string; recheck: number }>(v, `const b = document.querySelector("#mon-head .mon-banner"); return { kind: b.dataset.kind, head: b.querySelector("b").textContent, text: b.textContent, role: b.getAttribute("role"), recheck: b.querySelectorAll(".mon-recheck").length }`);
    expect(down.kind).toBe("down");
    expect(fail.kind).toBe("fail");
    expect(fail.head).not.toBe(down.head);
    expect(fail.text).not.toContain("끊");
    expect(fail.role).not.toBe("alert");
    expect(fail.recheck).toBe(1);
  });

  test("the per-second update moves the bar but keeps the result tag the node was built with", async () => {
    monitors = monitors.map(m => (m.watch === "many-watch" ? { ...m, last_result: "changed" } : m));
    const v = await boot(1280, 900);
    await run(v, `go("monitoring", "notice")`);
    await waitFor(v, `document.querySelector('.mon-ov-row[data-ov="m:많은 감시"] .mon-ptag')`);
    const tag = `document.querySelector('.mon-ov-row[data-ov="m:많은 감시"] .mon-ptag')`;
    const before = await q<{ text: string; cls: string }>(v, `const t = ${tag}; return { text: t.textContent, cls: t.className }`);
    expect(before.text).toBe(await q<string>(v, `return MON_PTAG.changed[0]`));
    await run(v, `monTick(); monTick()`);
    const after = await q<{ text: string; cls: string }>(v, `const t = ${tag}; return { text: t.textContent, cls: t.className }`);
    expect(after).toEqual(before);
    // The update runs on a once-a-second timer while 모니터링 is shown, not on every animation frame.
    expect(await q<boolean>(v, `return !!monTickT`)).toBe(true);
    await run(v, `go("home")`);
    await waitFor(v, `!monTickT`, 5_000);
  });
});

describe("감시 소식", () => {
  test("opens with every plain monitor, what needs the owner first, and a tap opens that monitor", async () => {
    const v = await boot(1280, 900);
    await run(v, `go("monitoring", "notice")`);
    await waitFor(v, `document.querySelectorAll(".mon-ov-row").length === 5`);
    await Bun.write(join(SHOTS, "monitoring-feed-1280.png"), await v.screenshot());
    const rows = await q<{ text: string; tag: string; name: string }[]>(v, `return [...document.querySelectorAll(".mon-ov-row")].map(r => ({ text: r.textContent, tag: r.querySelector(".mon-ptag").textContent, name: r.dataset.ov }))`);
    expect(rows[0]!.name).toBe("m:끊긴 감시");
    expect(rows[0]!.tag).toBe("연결 끊김");
    expect(rows[1]!.name).toBe("m:실패 감시");
    expect(rows[2]!.name).toBe("m:늦은 감시");
    for (const r of rows) expect(r.text.length).toBeGreaterThan(0);
    expect(rows.every(r => r.text.includes("·") || r.text.includes("요"))).toBe(true);
    await run(v, `document.querySelector(".mon-ov-row").click()`);
    await waitFor(v, `MON.sel === "m:끊긴 감시"`);
  });
});

describe("a peer monitor in the overview", () => {
	test("is listed beside this computer's monitors with its machine chip, and one without a next run says 다른 컴퓨터 instead of a bar", async () => {
		peers.push({ name: "맥미니", url: "http://mini.test", online: true, stale: false, items: { name: "맥미니", rev: "r1",
			monitors: [
				{ name: "맥미니 알림", watch: "mini-alert", kind: "watch", last_run: at(T0 - 5 * 60_000), next_run: at(T0 + 5 * 60_000), last_result: "ok", last_summary: "알림을 확인했어요" },
				{ name: "맥미니 백업", watch: "mini-backup", kind: "watch", last_run: at(T0 - 60 * 60_000), last_result: "fail", fails: 2, last_summary: "백업이 실패했어요" },
			],
			notices: [], integrations: [], conversations: [] } });
		const v = await boot(1280, 900);
		await waitFor(v, `PQ.loaded && PQ.list.length === 1 && monItems().some(i => i.key === "p:http://mini.test|m:맥미니 알림")`);
		const fit = await q<boolean>(v, `const t = [...document.querySelectorAll("#mon-side .cv-row")].find(r => r.textContent.includes("맥미니 알림")).querySelector(".mon-prog-tx"); return t.scrollWidth <= t.clientWidth + 1 && /^\\d+분 전 · \\d+분 후$/.test(t.textContent)`);
		expect(fit).toBe(true);
		await run(v, `go("monitoring", "notice")`);
		await waitFor(v, `document.querySelectorAll(".mon-ov-row").length === 7`);
		const rows = await q<{ name: string; text: string; prog: number; chip: string }[]>(v, `return [...document.querySelectorAll(".mon-ov-row")].map(r => ({ name: r.querySelector(".mon-ov-n").textContent, text: r.textContent, prog: r.querySelectorAll(".mon-prog").length, chip: r.querySelector(".tag") ? r.querySelector(".tag").textContent : "" }))`);
		const mini = rows.find(r => r.name === "맥미니 알림")!;
		expect(mini.chip).toBe("맥미니");
		expect(mini.prog).toBe(1);
		const backup = rows.find(r => r.name === "맥미니 백업")!;
		expect(backup.text).toContain("다른 컴퓨터");
		expect(backup.prog).toBe(0);
		expect(rows.map(r => r.name)).toContain("절반 감시");
	});
});

describe("older reports", () => {
  test("reaching the bottom loads the older page by itself (a monitor lists newest first), and the button is gone", async () => {
    const v = await boot(1280, 900);
    await run(v, `go("monitoring", "m:많은 감시")`);
    await waitFor(v, `document.querySelector("#mon-tl .mon-sentinel") && document.querySelectorAll("#mon-tl [data-nid]").length === 30`);
    await run(v, `const b = document.querySelector("#mon-timeline"); b.scrollTop = b.scrollHeight; b.dispatchEvent(new Event("scroll"))`);
    await waitFor(v, `document.querySelectorAll("#mon-tl [data-nid]").length === 45`);
    expect(await q(v, `return document.querySelector("#mon-tl .mon-sentinel")`)).toBe(null);
    expect(await q(v, `return document.querySelector("#mon-tl").textContent.includes("이전 소식")`)).toBe(false);
    expect(await q<number>(v, `return document.querySelector("#mon-timeline").scrollTop`)).toBeGreaterThan(0);
  });
});
