// The custom layer (hub/custom.ts): cards and pins read from <DATA_DIR>/custom, data commands with a cache, the pure
// projects view, routine schedules and the HTTP routes. The fake clock (test-setup) moves time; no real waiting.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "bun:test";
import { DATA_DIR } from "./config.ts";
import { featureCatalog } from "./features.ts";
import { saveProject } from "./projects.ts";
import { BUILTIN_KEY, type CustomDeps, customRoute, type DetailInput, projectDetailView, projectsView, readCards, readPins, settleRefreshes, syncRoutineSchedules } from "./custom.ts";
import { computerGroups } from "./custom-computers.ts";
import { PEER_GET } from "./peer-auth.ts";
import { createPeerProjects } from "./peer-projects.ts";
import { newestRules, reportHead, ruleTitle } from "./custom-text.ts";
import { advance, clock } from "./runtime/test-clock.ts";
import { addSchedule, listSchedules, removeSchedule } from "./schedule.ts";

const CUSTOM = join(DATA_DIR, "custom");
const WORK = join(process.env.DOTZ_TEST_DIR!, "custom-work");
let sent: Array<{ target: string; text: string; login: string }>;
const deps: CustomDeps = { lanes: () => [], channels: () => ({}), send: async (target, text, login) => void sent.push({ target, text, login }) };

const card = (id: string, spec: unknown) => {
	mkdirSync(join(CUSTOM, "cards"), { recursive: true });
	writeFileSync(join(CUSTOM, "cards", `${id}.json`), typeof spec === "string" ? spec : JSON.stringify(spec));
};
const pins = (p: unknown) => {
	mkdirSync(CUSTOM, { recursive: true });
	writeFileSync(join(CUSTOM, "pins.json"), typeof p === "string" ? p : JSON.stringify(p));
};
const call = async (method: string, path: string, body?: unknown, d: CustomDeps = deps) => {
	const url = new URL(`http://hub${path}`);
	return customRoute(new Request(url, { method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) }), url, d);
};
const json = async (res: Response | undefined) => (await res!.json()) as any;
const cardOf = async (id: string) => (await json(await call("GET", "/api/custom"))).cards.find((c: any) => c.id === id);

beforeEach(() => {
	sent = [];
	rmSync(CUSTOM, { recursive: true, force: true });
	rmSync(WORK, { recursive: true, force: true });
	mkdirSync(WORK, { recursive: true });
	for (const s of listSchedules()) if (s.text.startsWith("[routine:") || s.text === "plain-untouched") removeSchedule(s.id);
});

// ---- cards ----
test("a valid card keeps its fields and defaults", async () => {
	card("disk", { title: "디스크", note: "맥 내장", view: "stat", text: "1T", link: "#lanes", order: 2, extra: "ignored" });
	const res = await json(await call("GET", "/api/custom"));
	expect(res.dir).toEndWith("/custom");
	expect(res.cards).toEqual([{ id: "disk", file: "cards/disk.json", title: "디스크", note: "맥 내장", view: "stat", link: "#lanes", order: 2, render: false, rev: "0", actions: [], data: "1T" }]);
	expect(res.errors).toEqual([]);
});

test("a missing custom folder is an empty layer, apart from the built-in 커스텀 project", async () => {
	const res = await json(await call("GET", "/api/custom"));
	expect(res).toMatchObject({ cards: [], routines: [], links: [], errors: [] });
	expect(res.projects.map((p: any) => [p.key, p.name, p.pinned, p.builtin, p.channel])).toEqual([[BUILTIN_KEY, "커스텀", true, true, undefined]]);
});

test("커스텀 is listed first on an install with projects, survives hide_projects and cannot be saved over", async () => {
	pins({ projects: [{ name: "내 일", path: "~/Code/mine" }], hide_projects: [BUILTIN_KEY, "dir:~/Code/mine"] });
	const keys = (await json(await call("GET", "/api/custom"))).projects.map((p: any) => p.key);
	expect(keys).toEqual([BUILTIN_KEY, "dir:~/Code/mine"]);
	expect(() => saveProject({ key: BUILTIN_KEY, title: "바꾼 이름" })).toThrow();
});

test("내 기능 lists the owner's own features: a shipped feature he only switched on stays in the catalog as shipped, and asks never name the shipped file", async () => {
	const shipped = readFileSync(join(import.meta.dir, "..", "features", "reply-drafts", "feature.md"), "utf8");
	const put = (id: string, text: string) => {
		mkdirSync(join(DATA_DIR, "features", id), { recursive: true });
		writeFileSync(join(DATA_DIR, "features", id, "feature.md"), text);
	};
	try {
		put("my-own", "---\nname: 내가 만든 것\nwhat: 내 기능이에요\ntrigger: 턴 끝\nstage: rules\n---\n본문\n");
		put("reply-drafts", shipped.replace(/^enabled:.*$/m, "enabled: true")); // what onboarding writes
		put("remote-desktop", readFileSync(join(import.meta.dir, "..", "features", "remote-desktop", "feature.md"), "utf8").replace(/^enabled:.*$/m, "enabled: true\ncustom: true")); // a real override
		const groups = (await json(await call("GET", `/api/custom/project?key=${BUILTIN_KEY}`))).groups;
		expect(groups.find((g: any) => g.id === "features").items.map((i: any) => i.title).sort()).toEqual(["내가 만든 것", "화면 공유"]);
		const f = (await featureCatalog()).features.find(x => x.id === "dir-reply-drafts")!;
		expect(f).toMatchObject({ origin: "shipped", enabled: true });
		expect(f.source.label).toEndWith("/features/reply-drafts/feature.md");
		expect(f.source.label).not.toStartWith("features/");
	} finally {
		rmSync(join(DATA_DIR, "features"), { recursive: true, force: true });
	}
});

test("GET /api/custom/project?key=builtin:custom shows what is customized, each group with plain empty text on a fresh install", async () => {
	const empty = await json(await call("GET", `/api/custom/project?key=${BUILTIN_KEY}`));
	expect(empty.builtin).toBe(true);
	expect(empty.groups.map((g: any) => [g.id, g.items.length])).toEqual([["cards", 0], ["pins", 0], ["routines", 0], ["rules", 0], ["features", 0], ["identity", empty.groups[5].items.length]]);
	card("disk", { title: "디스크", note: "맥 내장", text: "1T" });
	pins({ projects: [{ name: "내 일", path: "~/Code/mine", note: "직접 만든 프로젝트" }], links: [{ name: "클라우드플레어", url: "https://dash.cloudflare.com" }], routines: [{ id: "morning", name: "아침 점검", prompt: "x", target: "main", schedule: { at: "09:00" } }] });
	const full = await json(await call("GET", `/api/custom/project?key=${BUILTIN_KEY}`));
	const by = (id: string) => full.groups.find((g: any) => g.id === id).items;
	expect(by("cards")).toEqual([{ title: "디스크", line: "맥 내장" }]);
	expect(by("pins").map((i: any) => i.title)).toEqual(["내 일", "클라우드플레어"]);
	expect(by("routines")).toEqual([{ title: "아침 점검", line: "매일 09:00에 해요" }]);
});

test("ruleTitle: the sidecar phrase wins, else the first clause without the date, cut on a word to 25 characters", () => {
	expect(ruleTitle("[10-21] 답을 매번 '형,' 같은 호칭으로 시작하지 않아요", { "[10-21] 답을 매번 '형,' 같은 호칭으로 시작하지 않아요": "  답을 호칭으로 시작하지 않기 " })).toBe("답을 호칭으로 시작하지 않기");
	expect(ruleTitle("[10-21] 매번 확인해요. 이유는 여기에 적어요")).toBe("매번 확인해요");
	expect(ruleTitle("[10-22] 야간 작업(정리, 교훈)에서 문제가 생기면 알림으로 보고해요")).toBe("야간 작업");
	expect(ruleTitle("[10-22] 가나다라마바사아자차카타파하가나다라마바사아자차카타파하", {})).toBe("가나다라마바사아자차카타파하가나다라마바사아자차카타파하".slice(0, 25));
	expect(ruleTitle("[10-22] 야간 작업에서 문제가 생기면 알림 대화창에 보고해요")).toBe("야간 작업에서 문제가 생기면 알림 대화창에");
	expect(ruleTitle("[10-22] 매번 확인해요", { "매번 확인해요": "날짜 없는 열쇠" })).toBe("날짜 없는 열쇠");
	expect(ruleTitle("x", { x: 5 })).toBe("x");
});

test("newestRules: newest stamp first, last year's after this year's, lower in the file first on the same day, no stamp last", () => {
	const rules = ["원문만", "[10-21] 가", "[12-30] 작년", "[11-02] 나", "[11-02] 다"];
	expect(newestRules(rules, new Date(2026, 10, 4))).toEqual(["[11-02] 다", "[11-02] 나", "[10-21] 가", "[12-30] 작년", "원문만"]);
});

test("GET /api/custom/project?key=builtin:custom: a rule row has a short title and its full text, no fixed subline", async () => {
	const text = "[10-22] 야간 작업에서 문제가 생기면 알림 대화창에 보고해요";
	const other = "[10-22] 매번 확인해요. 이유는 여기에 적어요";
	const rulesFile = join(DATA_DIR, "RULES.md"), titlesFile = join(DATA_DIR, "rule-titles.json");
	const kept = existsSync(rulesFile) ? readFileSync(rulesFile) : undefined;
	try {
		writeFileSync(rulesFile, `# rules\n\n## Rules\n- ${text}\n- ${other}\n`);
		writeFileSync(titlesFile, JSON.stringify({ [text]: "야간 작업 문제는 알림으로" }));
		const items = (await json(await call("GET", `/api/custom/project?key=${BUILTIN_KEY}`))).groups.find((g: any) => g.id === "rules").items;
		expect(items).toEqual([{ title: "매번 확인해요", full: other }, { title: "야간 작업 문제는 알림으로", full: text }]);
		writeFileSync(titlesFile, "{nope");
		const bad = (await json(await call("GET", `/api/custom/project?key=${BUILTIN_KEY}`))).groups.find((g: any) => g.id === "rules").items;
		expect(bad.map((i: any) => i.title).sort()).toEqual(["매번 확인해요", "야간 작업에서 문제가 생기면 알림 대화창에"]);
	} finally {
		if (kept) writeFileSync(rulesFile, kept);
		else rmSync(rulesFile, { force: true });
		rmSync(titlesFile, { force: true });
	}
});

test("broken JSON, a bad id and a missing title come back as {id,file,error}", async () => {
	card("broken", "{nope");
	card("Bad_ID", { title: "x" });
	card("notitle", { note: "n" });
	card("longview", { title: "x", view: "chart" });
	const bad = (await json(await call("GET", "/api/custom"))).cards;
	expect(bad.map((c: any) => c.id).sort()).toEqual(["Bad_ID", "broken", "longview", "notitle"]);
	for (const c of bad) expect(Object.keys(c).sort()).toEqual(["error", "file", "id"]);
	expect(bad.find((c: any) => c.id === "broken").file).toBe("cards/broken.json");
});

test("cards sort by order then id; more than 30 are cut with an error", async () => {
	card("b", { title: "b", order: 1 });
	card("a", { title: "a", order: 1 });
	card("z", { title: "z", order: -1 });
	expect((await json(await call("GET", "/api/custom"))).cards.map((c: any) => c.id)).toEqual(["z", "a", "b"]);
	for (let i = 0; i < 31; i++) card(`m${String(i).padStart(2, "0")}`, { title: "m" });
	const errors: { file: string; error: string }[] = [];
	expect(readCards(errors)).toHaveLength(30);
	expect(errors).toHaveLength(4);
});

test("a folder card with render.js reports render true and the file mtime as rev", async () => {
	mkdirSync(join(CUSTOM, "cards", "fancy"), { recursive: true });
	writeFileSync(join(CUSTOM, "cards", "fancy", "card.json"), JSON.stringify({ title: "fancy", text: "hi" }));
	writeFileSync(join(CUSTOM, "cards", "fancy", "render.js"), "export default () => 'x';\n");
	const c = await cardOf("fancy");
	expect(c.render).toBe(true);
	expect(c.rev).toMatch(/^\d{9,}$/);
	const res = await call("GET", "/api/custom/render?id=fancy");
	expect(res!.status).toBe(200);
	expect(res!.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
	expect(res!.headers.get("cache-control")).toBe("no-cache");
	expect(await res!.text()).toBe("export default () => 'x';\n");
});

test("render route is 404 without a render.js or with a path-like id", async () => {
	card("plain", { title: "p" });
	expect((await call("GET", "/api/custom/render?id=plain"))!.status).toBe(404);
	expect((await call("GET", "/api/custom/render?id=../pins"))!.status).toBe(404);
	expect((await call("GET", "/api/custom/render"))!.status).toBe(404);
});

// ---- data commands ----
test("the data command output is parsed as JSON, else kept as text", async () => {
	card("j", { title: "j", command: `echo '{"value": 42}'` });
	card("t", { title: "t", command: "echo '  hello  '" });
	expect((await cardOf("j")).data).toEqual({ value: 42 });
	const t = await cardOf("t");
	expect(t.data).toBe("hello");
	expect(t.updated).toMatch(/^\d{4}-\d\d-\d\dT/);
	expect(t.error).toBeUndefined();
});

test("a non-zero exit keeps the last good data as stale and reports the output tail", async () => {
	card("flaky", { title: "f", cwd: WORK, command: "if [ -f flag ]; then echo boom; exit 3; fi; echo good" });
	expect((await cardOf("flaky")).data).toBe("good");
	writeFileSync(join(WORK, "flag"), "");
	const res = await json(await call("POST", "/api/custom/refresh", { id: "flaky" }));
	expect(res).toMatchObject({ id: "flaky", data: "good", stale: true, error: "boom" });
});

test("a failing first run has an error and no data", async () => {
	card("dead", { title: "d", command: "echo nope >&2; exit 1" });
	const c = await cardOf("dead");
	expect(c.error).toBe("nope");
	expect(c.data).toBeUndefined();
	expect(c.stale).toBeUndefined();
});

test("a command that runs past timeout_seconds is killed and reported", async () => {
	card("slow", { title: "s", command: "sleep 30", timeout_seconds: 1 });
	const pending = call("GET", "/api/custom");
	await advance(1500);
	const c = (await json(await pending)).cards[0];
	expect(c.error).toContain("killed after 1 s");
	expect(c.data).toBeUndefined();
});

test("the command runs once within every_minutes and again after it (background), and POST refresh forces a run", async () => {
	const start = clock.now;
	card("count", { title: "c", cwd: WORK, command: "echo x >> n.txt; wc -l < n.txt", every_minutes: 10 });
	const runs = () => readFileSync(join(WORK, "n.txt"), "utf8").trim().split("\n").length;
	await cardOf("count");
	expect((await cardOf("count")).data).toBe(1);
	expect(runs()).toBe(1);
	try {
		clock.now = start + 11 * 60_000;
		expect((await cardOf("count")).data).toBe(1);
		await settleRefreshes();
		expect(runs()).toBe(2);
		expect((await cardOf("count")).data).toBe(2);
		expect((await json(await call("POST", "/api/custom/refresh", { id: "count" }))).data).toBe(3);
		expect((await call("POST", "/api/custom/refresh", { id: "nope" }))!.status).toBe(404);
	} finally {
		clock.now = start;
	}
});

test("two concurrent GETs share one run", async () => {
	card("once", { title: "o", cwd: WORK, command: "echo x >> n.txt; echo ok" });
	await Promise.all([call("GET", "/api/custom"), call("GET", "/api/custom")]);
	expect(readFileSync(join(WORK, "n.txt"), "utf8").trim().split("\n")).toHaveLength(1);
});

// ---- card actions ----
test("actions are listed without their command text; a bad action invalidates the card", async () => {
	card("act", { title: "a", actions: [{ label: "정리", command: "rm -rf /nope", confirm: true }, { label: "묻기", prompt: "왜 찼어?" }] });
	card("both", { title: "b", actions: [{ label: "x", command: "true", prompt: "p" }] });
	card("none", { title: "n", actions: [{ label: "x" }] });
	card("many", { title: "m", actions: Array.from({ length: 5 }, () => ({ label: "x", command: "true" })) });
	card("label", { title: "l", actions: [{ label: "", command: "true" }] });
	const cards = (await json(await call("GET", "/api/custom"))).cards;
	const by = (id: string) => cards.find((c: any) => c.id === id);
	expect(by("act").actions).toEqual([{ label: "정리", kind: "command", confirm: true }, { label: "묻기", kind: "prompt" }]);
	expect(JSON.stringify(by("act"))).not.toContain("rm -rf");
	for (const id of ["both", "none", "many", "label"]) expect(Object.keys(by(id)).sort()).toEqual(["error", "file", "id"]);
});

test("a command action runs in the card cwd, then the card data is re-run", async () => {
	card("act", { title: "a", cwd: WORK, command: "cat count 2>/dev/null || echo 0", actions: [{ label: "올리기", command: "echo 1 > count; echo done" }, { label: "실패", command: "echo bad; exit 2" }] });
	expect((await cardOf("act")).data).toBe(0);
	const ok = await json(await call("POST", "/api/custom/action", { id: "act", index: 0 }));
	expect(ok).toMatchObject({ ok: true, code: 0, output: "done" });
	expect(ok.card.data).toBe(1);
	expect(await json(await call("POST", "/api/custom/action", { id: "act", index: 1 }))).toMatchObject({ ok: false, code: 2, output: "bad" });
});

test("a prompt action goes to the orchestrator as '[카드 <title>] <prompt>'; unknown id or index is 404", async () => {
	card("ask", { title: "디스크", actions: [{ label: "묻기", prompt: "왜 찼어?" }] });
	expect(await json(await call("POST", "/api/custom/action", { id: "ask", index: 0 }))).toEqual({ ok: true });
	expect(sent).toEqual([{ target: "main", text: "[카드 디스크] 왜 찼어?", login: "local" }]);
	expect((await call("POST", "/api/custom/action", { id: "ask", index: 1 }))!.status).toBe(404);
	expect((await call("POST", "/api/custom/action", { id: "ask", index: "0" }))!.status).toBe(404);
	expect((await call("POST", "/api/custom/action", { id: "nope", index: 0 }))!.status).toBe(404);
});

// ---- pins ----
test("pins validation drops a bad entry with its own error and keeps the rest", () => {
	pins({
		projects: [{ name: "ok", path: "~/Code/ok" }, { path: "~/x" }, { name: "empty" }, { name: "chan", channel: "123" }],
		hide_projects: ["dir:~/Code/old", 5],
		routines: [
			{ id: "good", name: "g", prompt: "p", schedule: { at: "09:00" } },
			{ id: "Bad Id", name: "b", prompt: "p" },
			{ id: "both", name: "b", prompt: "p", schedule: { at: "09:00", every_minutes: 10 } },
			{ id: "fast", name: "b", prompt: "p", schedule: { every_minutes: 1 } },
			{ id: "good", name: "dup", prompt: "p" },
		],
		links: [{ name: "cf", url: "https://dash.cloudflare.com" }, { name: "ftp", url: "ftp://x" }],
	});
	const { pins: p, errors } = readPins({ sync: false });
	expect(p.projects.map(x => x.name)).toEqual(["ok", "chan"]);
	expect(p.hide_projects).toEqual(["dir:~/Code/old"]);
	expect(p.routines).toEqual([{ id: "good", name: "g", prompt: "p", target: "main", schedule: { at: "09:00" } }]);
	expect(p.links).toEqual([{ name: "cf", url: "https://dash.cloudflare.com" }]);
	expect(errors).toHaveLength(8);
	expect(errors.every(e => e.file === "pins.json" && e.error)).toBe(true);
});

test("a pins.json that does not parse gives one error and empty pins; auto projects still list", async () => {
	pins("{oops");
	const lanes = [{ name: "a", cwd: "/Users/zed/Code/auto", status: "idle", startedAt: "2026-10-01T00:00:00Z" }];
	const res = await json(await call("GET", "/api/custom", undefined, { ...deps, lanes: () => lanes }));
	expect(res.errors).toHaveLength(1);
	expect(res.errors[0].file).toBe("pins.json");
	expect([res.routines, res.links]).toEqual([[], []]);
	expect(res.projects.map((p: any) => p.name)).toEqual(["커스텀", "auto"]);
});

// ---- projects ----
const HOME = "/Users/h";
const lane = (name: string, cwd: string, startedAt?: string, extra: Record<string, unknown> = {}) => ({ name, cwd, status: "idle", live: false, reports: 0, lastText: "", ...(startedAt ? { startedAt } : {}), ...extra });
const view = (input: Parameters<typeof projectsView>[0]) => projectsView({ home: HOME, tmpDirs: ["/tmp", "/private/tmp", "/var/folders"], ...input });
const noPins = { projects: [], hide_projects: [], routines: [], links: [] };

test("projectsView groups lanes by cwd, homes channel, orphan work channel, pins merge, hide and order", () => {
	const out = view({
		lanes: [
			lane("a", `${HOME}/Code/dotz`, "2026-10-01T00:00:00Z", { live: true, reports: 2, lastText: "x".repeat(400) }),
			lane("b", `${HOME}/Code/dotz/`, "2026-10-03T00:00:00Z"),
			lane("c", `${HOME}/Code/old`, "2026-10-02T00:00:00Z"),
			lane("d", `${HOME}/Code/solo`, "2026-10-04T00:00:00Z"),
			lane("t1", "/tmp/scratch", "2026-10-05T00:00:00Z"),
			lane("t2", "/var/folders/zz/y", "2026-10-05T00:00:00Z"),
		],
		channels: { work: { "100": "solo-ch", "200": "orphan" }, homes: { d: "100" }, lanes: { a: "900" } },
		pins: { ...noPins, projects: [{ name: "Pinned dotz", path: "~/Code/dotz", note: "n" }, { name: "Manual", path: "~/Code/manual" }, { name: "Chan only", channel: "300" }], hide_projects: ["dir:~/Code/old"] },
	});
	expect(out.map(p => p.key)).toEqual(["dir:~/Code/dotz", "dir:~/Code/manual", "ch:300", "dir:~/Code/solo", "ch:200"]);
	const [dotz, manual, chan, solo, orphan] = out;
	expect(dotz).toMatchObject({ name: "Pinned dotz", path: "~/Code/dotz", note: "n", pinned: true });
	expect(dotz.lanes.map(l => l.name)).toEqual(["b", "a"]);
	expect(dotz.lanes[1]).toEqual({ name: "a", status: "idle", live: true, startedAt: "2026-10-01T00:00:00Z", lastText: "x".repeat(300), reports: 2, channel: "900" });
	expect(manual).toMatchObject({ pinned: true, lanes: [] });
	expect(chan).toMatchObject({ name: "Chan only", pinned: true, channel: { id: "300", name: "300" } });
	expect(solo).toMatchObject({ name: "solo-ch", pinned: false, channel: { id: "100", name: "solo-ch" } });
	expect(orphan).toMatchObject({ name: "orphan", pinned: false, channel: { id: "200", name: "orphan" }, lanes: [] });
});

test("projectsView puts a worktree lane under the checkout it works for", () => {
	const out = view({ lanes: [lane("w", `${HOME}/.dotz/lanes/w/worktree`, "2026-10-01T00:00:00Z", { repo: `${HOME}/Code/dotz` })], channels: {}, pins: noPins });
	expect(out.map(p => [p.key, p.name, p.lanes.map(l => l.name)])).toEqual([["dir:~/Code/dotz", "dotz", ["w"]]]);
});

test("projectsView merges a pin by channel id, folds an orphan channel into a path pin, never hides pinned", () => {
	const lanes = [lane("d", `${HOME}/Code/solo`, "2026-10-04T00:00:00Z")];
	const channels = { work: { "100": "solo-ch", "200": "orphan" }, homes: { d: "100" } };
	const byChannel = view({ lanes, channels, pins: { ...noPins, projects: [{ name: "Solo!", channel: "100" }], hide_projects: ["dir:~/Code/solo"] } });
	expect(byChannel.map(p => [p.key, p.name, p.pinned])).toEqual([["dir:~/Code/solo", "Solo!", true], ["ch:200", "orphan", false]]);
	const folded = view({ lanes: [lane("x", `${HOME}/Code/x`, "2026-10-01T00:00:00Z")], channels, pins: { ...noPins, projects: [{ name: "X", path: "~/Code/x", channel: "200" }] } });
	expect(folded.map(p => p.key)).toEqual(["dir:~/Code/x", "ch:100"]);
	expect(folded[0]).toMatchObject({ name: "X", path: "~/Code/x", channel: { id: "200", name: "orphan" } });
	const chanOnly = view({ lanes: [], channels, pins: { ...noPins, projects: [{ name: "Y", path: "~/Code/y", channel: "200" }] } });
	expect(chanOnly[0]).toMatchObject({ key: "ch:200", name: "Y", path: "~/Code/y", pinned: true });
});

test("projectsView lists at most 12 auto projects, newest first, home as ~", () => {
	const lanes = Array.from({ length: 15 }, (_, i) => lane(`l${i}`, `${HOME}/p${String(i).padStart(2, "0")}`, `2026-10-${String(i + 1).padStart(2, "0")}T00:00:00Z`));
	const out = view({ lanes: [...lanes, lane("home", HOME, "2026-10-30T00:00:00Z")], channels: {}, pins: noPins });
	expect(out).toHaveLength(12);
	expect(out[0]).toMatchObject({ key: "dir:~", path: "~" });
	expect(out[1].key).toBe("dir:~/p14");
});

// ---- routine schedules ----
const routineEntries = () => listSchedules().filter(s => s.text.startsWith("[routine:"));
const nextKst = (now: number, hh: number, mm: number) => {
	const day = 86_400_000;
	const t = Math.floor((now + 9 * 3_600_000) / day) * day + (hh * 60 + mm) * 60_000 - 9 * 3_600_000;
	return t <= now ? t + day : t;
};

// ---- computers ----
test("a pin's computer is kept trimmed; an empty, too long or non-text computer drops that pin with its own error", () => {
	pins({ projects: [{ name: "ok", path: "~/a", computer: " office-pc " }, { name: "none", path: "~/b" }, { name: "empty", path: "~/c", computer: "  " }, { name: "long", path: "~/d", computer: "x".repeat(41) }, { name: "num", path: "~/e", computer: 7 }] });
	const { pins: p, errors } = readPins({ sync: false });
	expect(p.projects).toEqual([{ name: "ok", path: "~/a", computer: "office-pc" }, { name: "none", path: "~/b" }]);
	expect(errors.map(e => e.error)).toEqual(["projects[2]: computer는 1~40자 글이어야 해요", "projects[3]: computer는 1~40자 글이어야 해요", "projects[4]: computer는 1~40자 글이어야 해요"]);
});

test("projectsView: every project belongs to this computer unless its pin names another; without a machine name none is set", () => {
	const input = { lanes: [lane("a", `${HOME}/Code/auto`, "2026-10-01T00:00:00Z")], channels: {}, pins: { ...noPins, projects: [{ name: "There", path: "~/Code/there", computer: "office-pc" }, { name: "Here", path: "~/Code/here" }] } };
	expect(view({ ...input, computer: "home-pc" }).map(p => [p.key, p.computer])).toEqual([["dir:~/Code/there", "office-pc"], ["dir:~/Code/here", "home-pc"], ["dir:~/Code/auto", "home-pc"]]);
	expect(view(input).map(p => p.computer)).toEqual(["office-pc", undefined, undefined]);
});

test("computerGroups: this computer first, the others by name; a pin joins its computer's group, an offline peer has no projects", () => {
	const projects = view({ lanes: [lane("a", `${HOME}/Code/auto`, "2026-10-01T00:00:00Z")], channels: {}, pins: { ...noPins, projects: [{ name: "There", path: "~/Code/there", computer: "office-pc" }, { name: "Lab", path: "~/Code/lab", computer: "작업실" }] }, computer: "home-pc" });
	const peers = [
		{ name: "office-pc", url: "https://office-pc.example:7420", online: true, projects: [{ key: "dir:~/Code/report", name: "report" }] },
		{ name: "laptop", url: "https://laptop.example:7420", online: false, projects: [{ key: "dir:~/x", name: "stale" }] },
		{ name: "home-pc", url: "https://twin.example:7420", online: true, projects: [{ key: "dir:~/y", name: "twin" }] },
	];
	const groups = computerGroups("home-pc", [{ key: BUILTIN_KEY, name: "커스텀", pinned: true, builtin: true, lanes: [] }, ...projects], peers);
	expect(groups.map(g => [g.name, g.self, g.online, g.keys, g.remote.map(r => r.name)])).toEqual([
		["home-pc", true, true, ["dir:~/Code/auto"], []],
		["작업실", false, undefined, ["dir:~/Code/lab"], []],
		["laptop", false, false, [], []],
		["office-pc", false, true, ["dir:~/Code/there"], ["report"]],
	]);
	expect(computerGroups("home-pc", view({ lanes: [], channels: {}, pins: { ...noPins, projects: [{ name: "Here", path: "~/h" }] }, computer: "home-pc" }), [])).toHaveLength(1);
});

test("GET /api/custom/computers groups this gateway's projects with the peers'; GET /api/peer/projects gives its own projects only, by key and name", async () => {
	pins({ projects: [{ name: "There", path: "~/Code/there", computer: "office-pc" }, { name: "Here", path: "~/Code/here", note: "집에서 하는 일이에요" }] });
	const d: CustomDeps = { ...deps, machine: () => "home-pc", peerProjects: async () => [{ name: "office-pc", url: "https://office-pc.example:7420", online: true, projects: [{ key: "dir:~/r", name: "report" }] }] };
	const groups = await json(await call("GET", "/api/custom/computers", undefined, d));
	expect(groups.map((g: any) => [g.name, g.keys, g.remote.length])).toEqual([["home-pc", ["dir:~/Code/here"], 0], ["office-pc", ["dir:~/Code/there"], 1]]);
	expect((await json(await call("GET", "/api/custom", undefined, d))).projects.map((p: any) => p.computer)).toEqual([undefined, "office-pc", "home-pc"]);
	expect(await json(await call("GET", "/api/peer/projects", undefined, d))).toEqual({ name: "home-pc", projects: [{ key: "dir:~/Code/here", name: "Here", note: "집에서 하는 일이에요" }] });
	expect(PEER_GET.some(r => r.test("/api/peer/projects"))).toBe(true);
	const failing: CustomDeps = { ...d, peerProjects: async () => { throw new Error("down"); } };
	expect((await json(await call("GET", "/api/custom/computers", undefined, failing))).map((g: any) => g.name)).toEqual(["home-pc", "office-pc"]);
});

test("peer projects: an online peer is read with its token and checked at the boundary; offline is not asked; a refused or old peer lists no projects", async () => {
	const asked: string[] = [];
	const answers: Record<string, Response> = {
		"https://a.example": Response.json({ projects: [{ key: "dir:~/r", name: "report", note: 5 }, { key: 3, name: "bad" }, { name: "no key" }] }),
		"https://old.example": new Response("nf", { status: 404 }),
	};
	const load = createPeerProjects({
		peers: async () => [
			{ name: "me", url: "https://me.example", self: true, online: true },
			{ name: "a", url: "https://a.example", self: false, online: true },
			{ name: "old", url: "https://old.example", self: false, online: true },
			{ name: "off", url: "https://off.example", self: false, online: false },
			{ name: "relay", url: "jandi:x", self: false, online: true, via: "jandi" },
		],
		token: () => "t".repeat(20),
		pair: async () => ({ ok: false }),
		fetch: async (u, init) => {
			asked.push(`${u} ${(init?.headers as Record<string, string>)["x-dotz-peer"] ? "token" : "none"}`);
			return answers[u.replace("/api/peer/projects", "")]!;
		},
	});
	expect(await load()).toEqual([
		{ name: "a", url: "https://a.example", online: true, projects: [{ key: "dir:~/r", name: "report" }] },
		{ name: "old", url: "https://old.example", online: true },
		{ name: "off", url: "https://off.example", online: false },
	]);
	expect(asked.sort()).toEqual(["https://a.example/api/peer/projects token", "https://old.example/api/peer/projects token"]);
});

test("routine sync adds one entry per scheduled routine with the contract tag, text and times", () => {
	const at = { id: "morning", name: "아침 점검", prompt: "훑어줘", target: "main", schedule: { at: "09:00" } };
	pins({ routines: [{ ...at }, { id: "poll", name: "폴링", prompt: "봐줘", schedule: { every_minutes: 30 } }, { id: "manual", name: "수동", prompt: "p" }] });
	syncRoutineSchedules();
	const now = Date.now();
	const [a, b] = routineEntries();
	expect(routineEntries()).toHaveLength(2);
	const hash = createHash("sha1").update(JSON.stringify(at)).digest("hex").slice(0, 6);
	expect(a.text).toBe(`[routine:morning:${hash}] 아침 점검\n훑어줘`);
	expect(Date.parse(a.at)).toBe(nextKst(now, 9, 0));
	expect(a.every_minutes).toBe(1440);
	expect(b.text).toMatch(/^\[routine:poll:[0-9a-f]{6}\] 폴링\n봐줘$/);
	expect(Date.parse(b.at)).toBe(now + 30 * 60_000);
	expect(b.every_minutes).toBe(30);
});

test("routine sync is idempotent, replaces on a hash change and removes what is no longer wanted", () => {
	const r = { id: "r1", name: "n", prompt: "one", schedule: { at: "09:00" } };
	pins({ routines: [r] });
	syncRoutineSchedules();
	const first = routineEntries();
	syncRoutineSchedules();
	expect(routineEntries()).toEqual(first);
	pins({ routines: [{ ...r, prompt: "two" }] });
	syncRoutineSchedules();
	const changed = routineEntries();
	expect(changed).toHaveLength(1);
	expect(changed[0].id).not.toBe(first[0].id);
	expect(changed[0].text).toContain("\ntwo");
	pins({ routines: [{ id: "r1", name: "n", prompt: "two" }] });
	syncRoutineSchedules();
	expect(routineEntries()).toEqual([]);
	pins({ routines: [{ ...r }] });
	syncRoutineSchedules();
	expect(routineEntries()).toHaveLength(1);
	rmSync(join(CUSTOM, "pins.json"));
	syncRoutineSchedules();
	expect(routineEntries()).toEqual([]);
});

test("routine sync never touches schedules that do not start with [routine:", () => {
	const plain = addSchedule({ text: "plain-untouched", in_minutes: 60 });
	const lookalike = addSchedule({ text: "routine:x is just text", in_minutes: 60 });
	pins({ routines: [{ id: "r1", name: "n", prompt: "p", schedule: { every_minutes: 5 } }] });
	syncRoutineSchedules();
	pins({});
	syncRoutineSchedules();
	const ids = listSchedules().map(s => s.id);
	expect(ids).toContain(plain.id);
	expect(ids).toContain(lookalike.id);
	removeSchedule(lookalike.id);
	expect(routineEntries()).toEqual([]);
});

test("GET /api/custom syncs when pins.json changed and lists routines with their next run", async () => {
	pins({ routines: [{ id: "daily", name: "매일", prompt: "p", schedule: { at: "09:00" } }], links: [{ name: "cf", url: "https://x.example" }] });
	const res = await json(await call("GET", "/api/custom"));
	expect(res.links).toEqual([{ name: "cf", url: "https://x.example" }]);
	expect(res.routines).toEqual([{ id: "daily", name: "매일", prompt: "p", target: "main", schedule: { at: "09:00" }, next: routineEntries()[0].at }]);
	expect(existsSync(join(CUSTOM, "pins.json"))).toBe(true);
});

// ---- routine run ----
test("POST /api/custom/routine sends '[루틴 <name>] <prompt>' to main or the lane; unknown id is 404", async () => {
	pins({ routines: [{ id: "m", name: "점검", prompt: "훑어줘" }, { id: "l", name: "레인", prompt: "상태", target: "lane:alpha" }] });
	expect(await json(await call("POST", "/api/custom/routine", { id: "m" }))).toEqual({ ok: true });
	expect(await json(await call("POST", "/api/custom/routine", { id: "l" }))).toEqual({ ok: true });
	expect(sent).toEqual([{ target: "main", text: "[루틴 점검] 훑어줘", login: "local" }, { target: "lane:alpha", text: "[루틴 레인] 상태", login: "local" }]);
	expect((await call("POST", "/api/custom/routine", { id: "ghost" }))!.status).toBe(404);
	const failing: CustomDeps = { ...deps, send: async () => Promise.reject(new Error("no lane")) };
	const res = await call("POST", "/api/custom/routine", { id: "l" }, failing);
	expect([res!.status, (await json(res)).error]).toEqual([409, "no lane"]);
});

test("customRoute ignores paths and methods that are not its own", async () => {
	expect(await call("GET", "/api/state")).toBeUndefined();
	expect(await call("DELETE", "/api/custom/refresh")).toBeUndefined();
	expect(await call("POST", "/api/custom/unknown", {})).toBeUndefined();
});

// ---- project page detail ----
test("reportHead picks the marker line even after an OmO handoff block", () => {
	expect(reportHead("Ask: x - wanted: y\n\n[done] 머지했어요(abc123).\n- 바뀐 것")).toEqual({ tone: "done", line: "머지했어요(abc123).", body: "- 바뀐 것" });
	expect(reportHead("**[fail]** 빌드가 안 돼요")).toMatchObject({ tone: "fail", line: "빌드가 안 돼요" });
	expect(reportHead("그냥 글")).toEqual({ line: "그냥 글", body: "" });
});

test("project detail: ended lanes' report.md fill results newest first, with receipts, commits, tasks and links", () => {
	const lanes = [
		{ name: "a", cwd: "/h/.dotz/lanes/a/worktree", repo: "/h/Code/proj", status: "exited", live: false, startedAt: "2026-10-01T00:00:00Z", reports: 1, lastText: "", resumable: true, claim: { state: "verified" } },
		{ name: "b", cwd: "/h/.dotz/lanes/b/worktree", repo: "/h/Code/proj", status: "working", live: true, startedAt: "2026-10-02T00:00:00Z", reports: 0, lastText: "하는 중", pendingAsk: { text: "?", at: "x" } },
		{ name: "z", cwd: "/h/Code/other", status: "exited", live: false, startedAt: "2026-10-01T00:00:00Z", reports: 1, lastText: "" },
	];
	const all = projectsView({ lanes, channels: { work: { "9": "작업" }, homes: { a: "9" }, threads: { t1: { parent: "9", name: "스레드" }, t2: { parent: "8", name: "남의 것" } } }, pins: { projects: [], hide_projects: [], routines: [], links: [] }, home: "/h", tmpDirs: [] });
	const project = all.find(p => p.key === "dir:~/Code/proj")!;
	const input: DetailInput = {
		project, others: all, lanes, home: "/h",
		reports: { a: { text: "[done] 끝냈어요\n세부", at: "2026-10-03T00:00:00Z" } },
		receipts: [
			{ command: "bun test", cwd: "/h/.dotz/lanes/a/worktree", exitCode: 0, ranAt: Date.parse("2026-10-04T00:00:00Z") },
			{ command: "bun test", cwd: "/h/Code/proj", exitCode: 1, ranAt: Date.parse("2026-10-01T00:00:00Z") },
			{ command: "ls", cwd: "/h/Code/other", exitCode: 0, ranAt: Date.parse("2026-10-05T00:00:00Z") },
		],
		tasks: [{ id: "t-p", what: "proj 저장소 정리" }, { id: "t-other", what: "other 쪽 일" }, { id: "t-none", what: "어디에도 안 속함" }],
		routines: [{ id: "r", name: "점검", prompt: "x", target: "lane:a" }, { id: "r2", name: "남", prompt: "y", target: "main" }],
		schedules: [{ id: "s", text: "lane:b 확인", at: "2026-10-06T00:00:00Z", created: "x" }],
		watches: [], channels: { work: { "9": "작업" }, threads: { t1: { parent: "9", name: "스레드" }, t2: { parent: "8", name: "남의 것" } } },
		git: { branch: "main", base: "main", dirty: 2, commits: [{ hash: "c1", at: "2026-10-02T00:00:00Z", subject: "커밋" }], unmerged: [] },
	};
	const d = projectDetailView(input);
	expect(d.summary).toEqual({ lanes: 2, running: 1, waiting: 1, lastActivity: "2026-10-04T00:00:00.000Z" });
	expect(d.lanes.find(l => l.name === "a")).toMatchObject({ line: "끝냈어요", tone: "done", claim: "verified", resumable: true, finishedAt: "2026-10-03T00:00:00Z" });
	expect(d.lanes.find(l => l.name === "b")).toMatchObject({ line: "하는 중", waiting: true, resumable: false });
	expect(d.results.map(r => [r.kind, r.title])).toEqual([["verify", "bun test"], ["report", "끝냈어요"], ["commit", "커밋"]]);
	expect(d.results[0]).toMatchObject({ ok: true, lane: "a" });
	expect(d.tasks.map(t => t.id)).toEqual(["t-p"]);
	expect(projectDetailView({ ...input, self: true }).tasks.map(t => t.id)).toEqual(["t-p", "t-none"]);
	expect(d.linked).toMatchObject({ channel: { id: "9", name: "작업" }, threads: [{ id: "t1", name: "스레드" }], routines: [{ id: "r" }], schedules: [{ id: "s" }] });
	expect(d.repo).toMatchObject({ dirty: 2 });
});

test("project titles: record, pin, work channel name, first session's title, folder basename, in that order", () => {
	const lanes = [lane("late", `${HOME}/Code/dotz`, "2026-10-05T00:00:00Z", { title: "나중 세션" }), lane("first", `${HOME}/Code/dotz`, "2026-10-01T00:00:00Z", { title: "디스코드 설정" })];
	const only = (input: Partial<Parameters<typeof projectsView>[0]> = {}) => view({ lanes, channels: {}, pins: noPins, ...input })[0]!;
	expect(only().name).toBe("디스코드 설정");
	expect(only({ lanes: [lane("x", `${HOME}/Code/dotz`, "2026-10-01T00:00:00Z")] }).name).toBe("dotz");
	expect(only({ channels: { work: { "100": "채널 이름" }, homes: { first: "100" } } }).name).toBe("채널 이름");
	const pins = { ...noPins, projects: [{ name: "고정 이름", path: "~/Code/dotz" }] };
	expect(only({ pins, channels: { work: { "100": "채널 이름" }, homes: { first: "100" } } }).name).toBe("고정 이름");
	const record = { title: "기록 제목", purpose: "목적", updated: "2026-10-21T00:00:00Z" };
	const withRecord = only({ pins, records: { "dir:~/Code/dotz": record, "ch:1": { title: "다른 것", updated: "x" } } });
	expect(withRecord).toMatchObject({ name: "기록 제목", record });
	expect(only({ records: { "dir:~/Code/dotz": { purpose: "제목 없음", updated: "x" } } }).name).toBe("디스코드 설정");
	expect(only().lanes.map(l => l.title)).toEqual(["나중 세션", "디스코드 설정"]);
});

test("project detail adds the record, the monitors of its channel and the routines and schedules scoped to it", () => {
	const channels = { work: { "9": "작업" }, homes: { a: "9" } };
	const lanes = [lane("a", "/h/Code/proj", "2026-10-01T00:00:00Z")];
	const record = { title: "기록", goal: "목표", milestones: [{ text: "하나", done: true }], updated: "2026-10-21T00:00:00Z" };
	const all = projectsView({ lanes, channels, pins: noPins, records: { "dir:~/Code/proj": record }, home: "/h", tmpDirs: [] });
	const watch = (id: string, channelsOf: string[], extra: Record<string, unknown> = {}) => ({ id, name: `w-${id}`, command: "curl -s https://x\nsecond line", every_minutes: 10, on: "change", channels: channelsOf, fails: 0, ...extra });
	const d = projectDetailView({
		project: all[0]!, record, others: all, lanes, reports: {}, receipts: [], tasks: [], home: "/h", channels,
		watches: [watch("m1", ["9"], { on: "match", pattern: "fail", lastRun: "2026-10-21T00:00:00Z", nextAt: "2026-10-21T00:10:00Z", fails: 2, paused: true }), watch("m2", ["9", "8"]), watch("o1", ["8"])],
		routines: [{ id: "r1", name: "채널 루틴", prompt: "x", target: "ch:9", schedule: { every_minutes: 60 } }, { id: "r2", name: "남의 루틴", prompt: "y", target: "main" }],
		schedules: [{ id: "s1", text: "[routine:r1:abc123] x", at: "2026-10-22T00:00:00Z", every_minutes: 60, paused: true, created: "x" }, { id: "s2", text: "[routine:r2:abc123] y", at: "2026-10-22T00:00:00Z", created: "x" }, { id: "s3", text: "ch:9 에 보고", at: "2026-10-22T00:00:00Z", created: "x" }],
	});
	expect(d.record).toEqual(record);
	expect(d.monitors.map(m => m.id)).toEqual(["m1", "m2"]);
	expect(d.monitors[0]).toEqual({ id: "m1", name: "w-m1", command: "curl -s https://x", every_minutes: 10, on: "match", pattern: "fail", lastRun: "2026-10-21T00:00:00Z", nextAt: "2026-10-21T00:10:00Z", fails: 2, paused: true });
	expect(d.monitors[1]).toMatchObject({ paused: false });
	expect(d.routines.map(r => r.id)).toEqual(["r1"]);
	expect(d.schedules.map(s => [s.id, s.routine ?? null, s.paused ?? false])).toEqual([["s3", null, false], ["s1", "r1", true]]);
	expect(projectDetailView({ project: { ...all[0]!, channel: undefined }, others: all, lanes, reports: {}, receipts: [], tasks: [], home: "/h", channels: {}, watches: [watch("m1", ["9"])], routines: [], schedules: [] }).monitors).toEqual([]);
});

test("project detail of a fresh project (no sessions, no record) keeps every list an array, so the page can render its empty states", () => {
	const all = projectsView({ lanes: [], channels: {}, pins: { ...noPins, projects: [{ name: "새 프로젝트", path: "~/fresh" }] }, home: "/h", tmpDirs: [] });
	const d = projectDetailView({ project: all[0]!, others: all, lanes: [], reports: {}, receipts: [], tasks: [], home: "/h", channels: {}, watches: [], routines: [], schedules: [] });
	for (const k of ["monitors", "routines", "schedules", "lanes", "results", "tasks"] as const) expect(d[k]).toEqual([]);
	expect(d.record).toBeUndefined();
	expect(d.summary).toEqual({ lanes: 0, running: 0, waiting: 0 });
	expect(d.linked).toEqual({ threads: [], laneChannels: [], routines: [], schedules: [], watches: [] });
});

test("GET /api/custom/project answers 404 for an unknown key", async () => {
	expect((await call("GET", "/api/custom/project?key=dir:~/nope"))!.status).toBe(404);
});

test("a work channel named like a session folder joins that folder's project, and the project page lists its background work", () => {
	const lanes = [{ name: "a", cwd: "/h/Code/dotz", status: "exited", live: false, startedAt: "2026-10-01T00:00:00Z", reports: 0, lastText: "" }];
	const channels = { work: { "9": "dotz-개선", "8": "다른 일" } };
	const all = projectsView({ lanes, channels, pins: noPins, home: "/h", tmpDirs: [] });
	expect(all.map(p => [p.key, p.name, p.channel?.id, p.lanes.length])).toEqual([["dir:~/Code/dotz", "dotz-개선", "9", 1], ["ch:8", "다른 일", "8", 0]]);
	const work = (id: string, over: Record<string, unknown>) => ({ id, description: id, status: "running" as const, started_at: 1, ...over });
	const d = projectDetailView({ project: all[0]!, others: all, lanes, reports: {}, receipts: [], tasks: [], home: "/h", channels, watches: [], routines: [], schedules: [],
		work: [work("by-folder", { folder: "/h/Code/dotz" }), work("by-channel", { target: "ch:9" }), work("elsewhere", { folder: "/h/Code/other", target: "ch:8" }), work("main", { target: "web" })] });
	expect(d.work.map(w => w.id)).toEqual(["by-folder", "by-channel"]);
});

// ---- card files from the web (POST / PUT / DELETE /api/custom/cards) ----
test("POST /api/custom/cards writes a card file from the title and returns it as the list shows it", async () => {
	const r = await json(await call("POST", "/api/custom/cards", { title: "Disk Free", view: "stat", text: "1T", note: "", every_minutes: "", actions: [{ label: "묻기", prompt: "정리해줘" }] }));
	expect(r).toMatchObject({ id: "disk-free", file: "cards/disk-free.json", title: "Disk Free", view: "stat", data: "1T", actions: [{ label: "묻기", kind: "prompt" }] });
	expect(JSON.parse(readFileSync(join(CUSTOM, "cards", "disk-free.json"), "utf8"))).toEqual({ title: "Disk Free", view: "stat", text: "1T", actions: [{ label: "묻기", prompt: "정리해줘" }] });
	expect((await json(await call("POST", "/api/custom/cards", { title: "Disk Free", text: "2" }))).id).toBe("disk-free-1");
	expect((await json(await call("POST", "/api/custom/cards", { title: "한글 제목", text: "x" }))).id).toBe("card-1");
});

test("a card the parser would reject is not written: 400 with the parser's message, 409 for a taken id", async () => {
	const bad = await call("POST", "/api/custom/cards", { title: "", text: "x" });
	expect(bad!.status).toBe(400);
	expect((await json(bad)).error).toStartWith("title");
	expect(existsSync(join(CUSTOM, "cards"))).toBe(false);
	card("taken", { title: "있음", text: "1" });
	const dup = await call("POST", "/api/custom/cards", { id: "taken", title: "또", text: "2" });
	expect(dup!.status).toBe(409);
	expect((await call("POST", "/api/custom/cards", { id: "Bad Id", title: "x", text: "1" }))!.status).toBe(400);
});

test("GET and PUT edit the card's own file; the folder form keeps its render.js; DELETE removes it", async () => {
	card("memo", "{ not json");
	const raw = await json(await call("GET", "/api/custom/cards/memo"));
	expect(raw).toMatchObject({ id: "memo", file: "cards/memo.json", raw: "{ not json" });
	expect(raw.error).toContain("JSON");
	const put = await json(await call("PUT", "/api/custom/cards/memo", { title: "메모", text: "고침", order: "3" }));
	expect(put).toMatchObject({ id: "memo", title: "메모", data: "고침", order: 3 });
	expect((await json(await call("GET", "/api/custom/cards/memo"))).spec).toEqual({ title: "메모", text: "고침", order: 3 });
	mkdirSync(join(CUSTOM, "cards", "chart"), { recursive: true });
	writeFileSync(join(CUSTOM, "cards", "chart", "card.json"), JSON.stringify({ title: "그림", text: "1" }));
	writeFileSync(join(CUSTOM, "cards", "chart", "render.js"), "export default () => 'x'");
	expect(await json(await call("PUT", "/api/custom/cards/chart", { title: "그림 2", text: "2" }))).toMatchObject({ id: "chart", title: "그림 2", render: true });
	expect(existsSync(join(CUSTOM, "cards", "chart", "render.js"))).toBe(true);
	expect((await call("PUT", "/api/custom/cards/none", { title: "x", text: "1" }))!.status).toBe(404);
	expect(await json(await call("DELETE", "/api/custom/cards/chart"))).toEqual({ ok: true, id: "chart" });
	expect(existsSync(join(CUSTOM, "cards", "chart"))).toBe(false);
	expect((await call("DELETE", "/api/custom/cards/chart"))!.status).toBe(404);
	expect((await json(await call("GET", "/api/custom"))).cards.map((c: any) => c.id)).toEqual(["memo"]);
});

describe("a session's project", () => {
	const noPins = { projects: [], hide_projects: [], routines: [], links: [] };
	const at = (name: string, day: number, extra: object = {}) => ({ name, cwd: "/h/shared", status: "idle", startedAt: `2026-10-0${day}T00:00:00Z`, ...extra });
	const work = { "1": "기획팀", "2": "지원팀" };
	const all = (lanes: Array<Record<string, unknown>>, channels: object = { work }) => projectsView({ lanes, channels, pins: noPins, home: "/h", tmpDirs: ["/tmp"] });
	const holder = (ps: ReturnType<typeof all>, lane: string) => ps.filter(p => p.lanes.some(l => l.name === lane)).map(p => p.name);

	test("a lane with home sits under that project even when another project shares its folder, and its worktree does not matter", () => {
		const ps = all([at("a", 1, { home: "ch:1" }), at("b", 2, { home: "ch:2" }), at("c", 3, { home: "ch:1", cwd: "/h/.dotz/lanes/c/worktree", repo: "/h/shared" })]);
		expect(holder(ps, "a")).toEqual(["기획팀"]);
		expect(holder(ps, "c")).toEqual(["기획팀"]);
		expect(holder(ps, "b")).toEqual(["지원팀"]);
		expect(ps.filter(p => p.name === "기획팀" || p.name === "지원팀")).toHaveLength(2);
	});
	test("an ended lane keeps its project from the lane record alone, and the channel takes its folder", () => {
		const ps = all([at("old", 1, { title: "오래된 일" }), at("done", 2, { home: "ch:1" })]);
		expect(holder(ps, "done")).toEqual(["기획팀"]);
		expect(ps.filter(p => p.channel?.id === "1")).toHaveLength(1);
		expect(holder(ps, "old")).toEqual(["기획팀"]);
	});
	test("a lane with no home falls back to its folder, and a homed lane in a temp folder still has its project", () => {
		const ps = all([at("plain", 1, { title: "폴더 일" }), at("t", 2, { home: "ch:2", cwd: "/tmp/x" }), at("gone", 3, { cwd: "/tmp/y" })]);
		expect(ps.find(p => p.key === "dir:~/shared")?.lanes.map(l => l.name)).toEqual(["plain"]);
		expect(holder(ps, "t")).toEqual(["지원팀"]);
		expect(holder(ps, "gone")).toEqual([]);
	});
});
