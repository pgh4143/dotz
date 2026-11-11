// The worker guard and its config: brief checks, output trimming, external-action list, the personal expensive-model
// gate (off by default), budget gate, repeat/cycle block, deferral to an installed original, and the config defaults.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GUARD_DEFAULTS, guardConfigFrom, installedOriginal, loadGuardConfig } from "./guard-config.ts";
import { LOOKUP_MODEL, omoSelector } from "../hub/runtime/omo.ts";
import { stateSummary, addProjectFooter, FOLDER_RULES_MARKER, PROJECT_MARKER, budgetLine, budgetProblem, checkOmoTaskInput, livePin, LOOKUP_PIN, ownWorkerPin, pinOmoTaskModel, checkTaskInput, estimateFrom, expensiveModel, expensiveTaskModel, externalAction, installGuard, laneMergeBlock, relativizeRoots, settleFromText, sharedWriteBlock, shouldIsolate, shellText, stateOwner, trimWaitOutput } from "./guard.ts";

let dir: string;
beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "dotz-guard-"));
	process.env.ORCH_GUARD_STATE_DIR = join(dir, "state");
});
afterAll(() => {
	delete process.env.ORCH_GUARD_STATE_DIR;
	rmSync(dir, { recursive: true, force: true });
});

// A minimal omp `pi`: records handlers and commands; `agent` is the agent directory the install detection looks in.
function fakePi(agent: string) {
	const handlers: Record<string, ((event: any, ctx: any) => any)[]> = {};
	const commands: string[] = [];
	const logs: string[] = [];
	const pi = {
		pi: { getAgentDir: () => agent },
		logger: { warn: (m: string) => logs.push(m) },
		on: (name: string, fn: (event: any, ctx: any) => any) => (handlers[name] ??= []).push(fn),
		registerCommand: (name: string) => commands.push(name),
		registerTool: () => {},
		sendMessage: () => {},
		sendUserMessage: () => {},
	};
	return { pi, handlers, commands, logs };
}

const noGate = { ...GUARD_DEFAULTS, budget_gate: false };
const brief = (task: string) => ({ tasks: [{ agent: "task", task }] });

test("config: every key optional, defaults are the generic behaviour, bad values fall back", () => {
	expect(loadGuardConfig(join(dir, "no-such-dir"))).toEqual(GUARD_DEFAULTS);
	expect(GUARD_DEFAULTS).toMatchObject({ enabled: true, max_brief_chars: 8000, max_fence_lines: 40, budget_gate: true, ask_before_expensive: false, expensive_models: [] });
	const c = guardConfigFrom({ max_brief_chars: 100, max_fence_lines: -5, enabled: "yes", expensive_models: ["fable", 3, " "], external_commands: ["foo"] });
	expect(c.max_brief_chars).toBe(100);
	expect(c.max_fence_lines).toBe(40);
	expect(c.enabled).toBe(true);
	expect(c.expensive_models).toEqual(["fable"]);
	expect(c.external_commands).toEqual(["foo"]);
	mkdirSync(join(dir, "cfg"), { recursive: true });
	writeFileSync(join(dir, "cfg", "config.json"), JSON.stringify({ guard: { enabled: false, worker_answer_chars: 300 } }));
	expect(loadGuardConfig(join(dir, "cfg"))).toMatchObject({ enabled: false, worker_answer_chars: 300, max_brief_chars: 8000 });
});

test("brief: done-condition required, size and fence caps, budget line appended once, limits configurable", () => {
	const noDone = checkTaskInput(brief("do the thing"));
	expect("reason" in noDone && noDone.reason).toContain("done-condition");
	const ok = checkTaskInput(brief("do the thing\nAcceptance: tests pass"));
	expect("input" in ok).toBe(true);
	if (!("input" in ok)) return;
	expect(ok.input.tasks[0].task).toEndWith(budgetLine());
	expect(ok.input.tasks[0].isolated).toBe(true);
	const again = checkTaskInput(ok.input);
	expect("input" in again && again.input.tasks[0].task.match(/\[orchestrator-guard\]/g)?.length).toBe(1);
	expect(budgetLine({ ...GUARD_DEFAULTS, worker_answer_chars: 300, worker_context_tokens: 200_000 })).toContain("at most 300 characters");
	const big = checkTaskInput(brief(`Acceptance: x\n${"y".repeat(9000)}`));
	expect("reason" in big && big.reason).toContain("limit 8000");
	const small = checkTaskInput(brief(`Acceptance: x\n${"y".repeat(200)}`), true, [], { ...GUARD_DEFAULTS, max_brief_chars: 100 });
	expect("reason" in small && small.reason).toContain("limit 100");
	const fence = `\`\`\`\n${"line\n".repeat(41)}\`\`\``;
	const fenced = checkTaskInput(brief(`Acceptance: x\n${fence}`));
	expect("reason" in fenced && fenced.reason).toContain("code block over 40 lines");
	expect("input" in checkTaskInput(brief(`Acceptance: x\n${fence}`), true, [], { ...GUARD_DEFAULTS, max_fence_lines: 60 })).toBe(true);
});

test("brief: checkout roots become cwd-relative in isolated briefs", () => {
	expect(relativizeRoots("edit /a/repo/src/x.ts and /a/repo", ["/a/repo"])).toBe("edit src/x.ts and .");
	const verdict = checkTaskInput(brief("edit /a/repo/src/x.ts\nAcceptance: ok"), true, ["/a/repo"]);
	expect("input" in verdict && verdict.input.tasks[0].task).toContain("edit src/x.ts");
});

test("worker output trimming follows max_output_chars", () => {
	const text = `<task-result id="w1" status="done">\n<output>\n${"z".repeat(3000)}\n</output>\n</task-result>`;
	expect(trimWaitOutput(text)).toContain("output trimmed from 3000 chars; full text at history://w1");
	expect(trimWaitOutput(text, { ...GUARD_DEFAULTS, max_output_chars: 5000 })).toBe(text);
});

test("external actions: built-in list plus configured patterns, no owner-specific default", () => {
	expect(externalAction("git push origin main")).toBe("git push");
	expect(externalAction("gh pr merge 3")).toBe("gh write");
	expect(laneMergeBlock("gh pr merge 3 --squash", "l1")).toContain("dotz_merge");
	expect(laneMergeBlock("gh pr merge 3", "")).toBeUndefined();
	expect(laneMergeBlock("gh pr checks 3", "l1")).toBeUndefined();
	expect(externalAction("ssh host ls")).toBe("remote host");
	expect(externalAction("curl -X POST https://x.test")).toBe("outbound HTTP write");
	expect(externalAction("curl -X POST http://localhost:1/a")).toBeUndefined();
	expect(externalAction("ls -la")).toBeUndefined();
	expect(externalAction("notify-owner --text hi", [])).toBeUndefined();
	expect(externalAction("notify-owner --text hi", ["^notify-owner\\b"])).toContain("configured pattern");
});

test("expensive-model gate is off by default and matches the configured list when on", () => {
	expect(expensiveModel("anthropic/claude-fable-1")).toBeUndefined();
	expect(expensiveTaskModel({ model: "anthropic/fable:max", tasks: [] })).toBeUndefined();
	const on = { ...GUARD_DEFAULTS, ask_before_expensive: true, expensive_models: ["fable", ":max", ":xhigh"] };
	expect(expensiveModel("anthropic/claude-Fable-1", on)).toBeDefined();
	expect(expensiveModel("anthropic/claude-opus:max", on)).toBeDefined();
	expect(expensiveModel(["x", ":xhigh"], on)).toBeDefined();
	expect(expensiveModel("anthropic/claude-opus:maximal", on)).toBeUndefined();
	expect(expensiveModel("anthropic/claude-sonnet:high", on)).toBeUndefined();
	expect(expensiveTaskModel({ tasks: [{ model: "x/fable" }] }, on)).toBe("x/fable");
	// a list without the switch gates nothing
	expect(expensiveModel("fable", { ...GUARD_DEFAULTS, expensive_models: ["fable"] })).toBeUndefined();
});

test("budget gate: 5h only, margin and estimate configurable, silent without 5h data", () => {
	const limits = [{ id: "anthropic:5h", amount: { remaining: 20 } }, { id: "anthropic:7d", amount: { remaining: 3 } }];
	expect(budgetProblem(limits, 2, 15, 10)).toContain("5h window 20% left");
	expect(budgetProblem(limits, 2, 5, 10)).toBeUndefined();
	expect(budgetProblem(limits, 2, 15, 3)).toBeUndefined();
	expect(budgetProblem([{ id: "anthropic:7d", amount: { remaining: 1 } }], 1)).toBeUndefined();
	expect(budgetProblem([], 1)).toBeUndefined();
	expect(estimateFrom(brief("Estimate: 30%\nAcceptance: x"))).toBe(30);
	expect(estimateFrom(brief("Acceptance: x"), { ...GUARD_DEFAULTS, budget_default_estimate_percent: 22 })).toBe(22);
});

test("hooks: a brief without a done-condition is blocked, one with it passes and is rewritten", async () => {
	const { pi, handlers, commands } = fakePi(join(dir, "agent-empty"));
	installGuard(pi, noGate);
	expect(commands).toContain("compact-switch");
	expect(commands).not.toContain("budget-ok");
	expect(commands).not.toContain("fable-ok");
	const ctx = { agent: { kind: "main" }, cwd: dir, sessionManager: { getSessionId: () => "s1" } };
	const [toolCall] = handlers.tool_call;
	const blocked = await toolCall({ toolName: "task", input: brief("do it") }, ctx);
	expect(blocked.block).toBe(true);
	expect(blocked.reason).toContain("done-condition");
	const passed = await toolCall({ toolName: "task", input: brief("do it\nDone when: file exists") }, ctx);
	expect(passed.input.tasks[0].task).toContain(budgetLine(noGate));
});

test("hooks: the owner rule registers /fable-ok and swaps an expensive task model for the worker model; DOTZ_OWNER_ASKED_FABLE lifts it", async () => {
	const { pi, handlers, commands } = fakePi(join(dir, "agent-empty"));
	installGuard(pi, { ...noGate, ask_before_expensive: true, expensive_models: ["fable"] });
	expect(commands).toContain("fable-ok");
	expect(handlers.before_subagent_spawn?.length).toBe(1);
	const ctx = { agent: { kind: "main" }, cwd: dir, sessionManager: { getSessionId: () => "s2" } };
	const input = { model: "anthropic/fable", tasks: [{ agent: "task", task: "x\nAcceptance: y" }] };
	const swapped = await handlers.tool_call[0]({ toolName: "task", input }, ctx);
	expect(swapped.block).toBeUndefined();
	expect(String(swapped.input.tasks[0].model)).not.toContain("fable");
	expect(swapped.input.tasks[0].model).toBeDefined();
	expect(handlers.before_subagent_spawn[0]({ agent: "task", patterns: ["anthropic/fable"] })).toMatchObject({ block: true });
	process.env.DOTZ_OWNER_ASKED_FABLE = "1";
	try {
		expect((await handlers.tool_call[0]({ toolName: "task", input: { model: "anthropic/fable", tasks: [{ agent: "task", task: "x\nAcceptance: y" }] } }, ctx)).input.model).toBe("anthropic/fable");
	} finally {
		delete process.env.DOTZ_OWNER_ASKED_FABLE;
	}
});

test("hooks: an identical call repeated in a loop is blocked", async () => {
	const { pi, handlers } = fakePi(join(dir, "agent-empty"));
	installGuard(pi, noGate);
	const ctx = { agent: { kind: "sub", id: "w1" }, hasUI: false, sessionManager: { getSessionId: () => "loop" } };
	const call = (id: string) => handlers.tool_call[0]({ toolName: "read", toolCallId: id, input: { path: "same.txt" } }, ctx);
	const verdicts = [];
	for (let i = 0; i < 9; i++) verdicts.push(await call(`c${i}`));
	expect(verdicts.slice(0, 7).every(v => v === undefined)).toBe(true);
	expect(verdicts[7]?.block).toBe(true);
	expect(verdicts[7]?.reason).toContain("repeat guard");
	// a different call is let through again
	expect(await handlers.tool_call[0]({ toolName: "read", toolCallId: "d", input: { path: "other.txt" } }, ctx)).toBeUndefined();
});

test("hooks: workers cannot run external-impact commands and a second compaction stops them", async () => {
	const { pi, handlers } = fakePi(join(dir, "agent-empty"));
	installGuard(pi, { ...noGate, external_commands: ["^deploy-tool\\b"] });
	const ctx = { agent: { kind: "sub", id: "w2" }, sessionManager: { getSessionId: () => "ext" } };
	const push = await handlers.tool_call[0]({ toolName: "bash", input: { command: "git push origin x" } }, ctx);
	expect(push.reason).toContain("External actions needed");
	const own = await handlers.tool_call[0]({ toolName: "bash", input: { command: "deploy-tool prod" } }, ctx);
	expect(own.block).toBe(true);
	handlers.session_compact[0]({}, ctx);
	handlers.session_compact[0]({}, ctx);
	const stopped = await handlers.tool_call[0]({ toolName: "bash", input: { command: "echo hi" } }, ctx);
	expect(stopped.reason).toContain("compacted twice");
});

test("hooks: patch apply needs a read first", async () => {
	const { pi, handlers } = fakePi(join(dir, "agent-empty"));
	installGuard(pi, noGate);
	const ctx = { agent: { kind: "main" }, cwd: dir, sessionManager: { getSessionId: () => "apply" } };
	const apply = { toolName: "bash", input: { command: "git apply /tmp/w1.patch" } };
	expect((await handlers.tool_call[0](apply, ctx)).reason).toContain("review before apply");
	await handlers.tool_call[0]({ toolName: "read", input: { path: "/tmp/w1.patch" } }, ctx);
	expect(await handlers.tool_call[0](apply, ctx)).toBeUndefined();
});

test("hooks: a patch read in an eval cell counts however the path is written (variables from an earlier cell, template, Bun.file, spaces around =)", async () => {
	const { pi, handlers } = fakePi(join(dir, "agent-empty"));
	installGuard(pi, noGate);
	const ctx = { agent: { kind: "main" }, cwd: dir, sessionManager: { getSessionId: () => "apply-eval" } };
	const call = (toolName: string, input: Record<string, unknown>) => handlers.tool_call[0]({ toolName, input }, ctx);
	const applyOf = (p: string) => ({ language: "js", code: "print((await tool.bash({command: `git apply " + p + "`})).text)" });

	// not read yet: refused, and the refusal names the path it resolved and how to pass
	const first = await call("eval", { language: "js", code: "const iso = '/tmp/gx/iso';\nprint(await sh(`git apply ${iso}/st_1/root.patch`));" });
	expect(first.reason).toContain("review before apply");
	expect(first.reason).toContain("/tmp/gx/iso/st_1/root.patch");
	// the read tool may name its path file_path
	await call("read", { file_path: "/tmp/gx/iso/st_f/root.patch" });
	expect(await call("eval", applyOf("/tmp/gx/iso/st_f/root.patch"))).toBeUndefined();
	// read() with a template over a variable defined in an earlier cell, apply written with the resolved path in a later cell
	expect(await call("eval", { language: "js", code: "const t = await read(`${iso}/st_1/root.patch`); print(t.slice(0, 20000));" })).toBeUndefined();
	expect(await call("eval", applyOf("/tmp/gx/iso/st_1/root.patch"))).toBeUndefined();
	// the apply may also use the variable from the earlier cell
	expect(await call("eval", applyOf("${iso}/st_1/root.patch"))).toBeUndefined();
	// another patch of the same run is still unread
	expect((await call("eval", applyOf("${iso}/st_2/root.patch"))).reason).toContain("review before apply");
	// Bun.file(p).text() on a variable with spaces around =
	expect(await call("eval", { language: "js", code: "const pm = `${iso}/st_2/root.patch`;\nconst body = await Bun.file(pm).text();\nprint(body)" })).toBeUndefined();
	expect(await call("eval", applyOf("${iso}/st_2/root.patch"))).toBeUndefined();
	// a read of a different file is no review
	await call("eval", { language: "js", code: "print(await read('/tmp/gx/notes.md'))" });
	expect((await call("eval", applyOf("/tmp/gx/other/root.patch"))).reason).toContain("review before apply");
});

test("hooks: a session start names the rules that refuse a call, so the first call already follows them", async () => {
	const { pi, handlers } = fakePi(join(dir, "agent-empty"));
	const sent: any[] = [];
	(pi as any).sendMessage = (m: any) => void sent.push(m);
	installGuard(pi, noGate);
	await handlers.session_start[0]({}, { agent: { kind: "main" }, cwd: join(dir, "rules-cwd"), sessionManager: { getSessionId: () => "rules" } });
	const text = sent.map(m => m.content).join("\n");
	expect(text).toContain("Done when:");
	expect(text).toContain("git apply");
});

test("state: a worker lost with the previous session comes with its session file, last step, kept change and how to continue it", () => {
	const projects = join(dir, "omo-projects");
	const kids = join(projects, "worktree-abc", "senpi-task", "children", "st_lost1", "sessions", "st_lost1");
	mkdirSync(kids, { recursive: true });
	const line = (o: unknown) => `${JSON.stringify(o)}\n`;
	writeFileSync(
		join(kids, "2026-11-05T01-00-00-000Z_aaa.jsonl"),
		line({ type: "message", timestamp: "2026-11-05T01:00:00.000Z", message: { role: "user", content: "brief" } }) +
			line({ type: "message", timestamp: "2026-11-05T01:05:09.000Z", message: { role: "assistant", content: [{ type: "text", text: "Tests for the parser pass; now wiring the CLI." }, { type: "toolCall", name: "edit", arguments: { path: "src/cli.ts" } }] } }) +
			"not json at the torn end",
	);
	const iso = join(projects, "worktree-abc", "senpi-task", "isolation", "st_lost1");
	mkdirSync(iso, { recursive: true });
	writeFileSync(join(iso, "root.patch"), "diff --git a/x b/x\n");
	const state = { cwd: "/repo", workers: { st_lost1: { brief: "wire the CLI", spawnedAt: 1, status: "running" }, st_gone: { brief: "no trail", spawnedAt: 2, status: "running" } } };
	const text = stateSummary(state, true, projects)!;
	expect(text).toContain(join(kids, "2026-11-05T01-00-00-000Z_aaa.jsonl"));
	expect(text).toContain("01:05");
	expect(text).toContain("edit");
	expect(text).toContain("src/cli.ts");
	expect(text).toContain(join(iso, "root.patch"));
	expect(text).toContain("st_gone");
	expect(text).toContain("spawn a new worker");
});

test("install: enabled=false registers nothing; an installed original defers this copy and logs once", () => {
	const off = fakePi(join(dir, "agent-empty"));
	installGuard(off.pi, { ...GUARD_DEFAULTS, enabled: false });
	expect(Object.keys(off.handlers)).toEqual([]);

	const agent = join(dir, "agent-with-original");
	mkdirSync(join(agent, "extensions"), { recursive: true });
	writeFileSync(join(agent, "extensions", "orchestrator-guard.ts"), "export default () => {};\n");
	const a = fakePi(agent);
	installGuard(a.pi);
	installGuard(a.pi);
	expect(Object.keys(a.handlers)).toEqual([]);
	expect(a.commands).toEqual([]);
	expect(a.logs.length).toBe(1);
	expect(a.logs[0]).toContain("orchestrator-guard.ts");

	const forced = fakePi(agent);
	installGuard(forced.pi, { ...GUARD_DEFAULTS, defer_to_installed: false });
	expect(forced.handlers.tool_call?.length).toBe(1);
});

test("install detection: file in the agent dir, not --no-extensions, not disabledExtensions", () => {
	const agent = join(dir, "agent-detect");
	mkdirSync(join(agent, "extensions", "harness-tools"), { recursive: true });
	const pi = fakePi(agent).pi;
	expect(installedOriginal(pi, "harness-tools")).toBeUndefined();
	writeFileSync(join(agent, "extensions", "harness-tools", "index.ts"), "");
	expect(installedOriginal(pi, "harness-tools")).toEndWith("harness-tools/index.ts");
	writeFileSync(join(agent, "config.yml"), "disabledExtensions:\n  - extension-module:harness-tools\n");
	expect(installedOriginal(pi, "harness-tools")).toBeUndefined();
	writeFileSync(join(agent, "config.yml"), "");
	const argv = process.argv;
	process.argv = [...argv, "--no-extensions"];
	try {
		expect(installedOriginal(pi, "harness-tools")).toBeUndefined();
	} finally {
		process.argv = argv;
	}
});

test("OmO task input: brief rules, writers isolated with apply:false in place, read-only agents untouched", () => {
	expect("reason" in checkOmoTaskInput({ category: "quick", prompt: "do the thing" })).toBe(true);
	const one = { category: "quick", prompt: "do the thing\nAcceptance: tests pass" };
	const r = checkOmoTaskInput(one);
	expect("input" in r && r.input).toBe(one);
	expect(one).toMatchObject({ isolated: true, apply: false, merge: "patch" });
	expect(one.prompt).toEndWith(budgetLine());
	const batch = { tasks: [{ subagent_type: "explore", prompt: "find x\nDone when: listed" }, { category: "deep-low", prompt: "fix y\nAcceptance: green" }] };
	checkOmoTaskInput(batch);
	expect(batch.tasks[0]).not.toHaveProperty("isolated");
	expect(batch.tasks[1]).toMatchObject({ isolated: true, apply: false });
	// In place is said explicitly, overriding the orchestrator's own isolation request and any omo.json default.
	const inPlace = { category: "quick", prompt: "x\nAcceptance: y", isolated: true, apply: false, merge: "patch" };
	checkOmoTaskInput(inPlace, false);
	expect(inPlace.isolated).toBe(false);
	expect(inPlace).not.toHaveProperty("apply");
	expect(inPlace).not.toHaveProperty("merge");
	const reader = { subagent_type: "explore", prompt: "x\nDone when: y" };
	checkOmoTaskInput(reader, false);
	expect(reader).not.toHaveProperty("isolated");
});

test("isolation: real repos and lane worktrees yes; no repo, the dotz data folder and an OmO refusal no", () => {
	const home = mkdtempSync(join(tmpdir(), "dotz-home-"));
	try {
		expect(shouldIsolate("/Users/x/Code/proj", false, home)).toBe(true);
		expect(shouldIsolate(join(home, "lanes", "a", "worktree"), false, home)).toBe(true);
		expect(shouldIsolate("", false, home)).toBe(false);
		expect(shouldIsolate(home, false, home)).toBe(false);
		expect(shouldIsolate(`${home}/`, false, home)).toBe(false);
		expect(shouldIsolate("/Users/x/Code/proj", true, home)).toBe(false);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

test("OmO task completion settles the worker and keeps its retained patch; eval code counts as shell text", () => {
	const captured = join(dir, "root.patch");
	writeFileSync(captured, "diff --git a/f b/f\n");
	const state = { cwd: dir, workers: { st_01aa: { brief: "b", spawnedAt: 0, status: "running" } } } as any;
	const text = `task completion name:st_01aa id:st_01aa category:quick(anthropic-subscription/claude-sonnet-5-5:low) status:completed duration:9s\nresult:"done"\nisolation: retained via git-worktree -> ${captured}`;
	expect(settleFromText(state, text)).toBe(true);
	expect(state.workers.st_01aa.status).toBe("completed");
	expect(state.workers.st_01aa.patch).toEndWith("st_01aa.patch");
	expect(shellText({ code: "await tool.bash({ command: 'git apply x.patch' })" })).toContain("git apply x.patch");
});

test("lookup subagents (explore, librarian) run Sonnet 5.5 medium on the subscription; other subagent types keep the live model; on an API-key session lookups follow the pin", () => {
	const batch: any = { tasks: [{ subagent_type: "explore", prompt: "a" }, { subagent_type: "librarian", prompt: "b" }, { subagent_type: "oracle", prompt: "c" }] };
	pinOmoTaskModel(batch, "anthropic-subscription/claude-opus-5-5:high");
	expect(batch.tasks.map((t: any) => t.model)).toEqual([LOOKUP_PIN, LOOKUP_PIN, "anthropic-subscription/claude-opus-5-5:high"]);
	expect(LOOKUP_PIN).toBe(omoSelector(LOOKUP_MODEL));
	const keyed: any = { subagent_type: "explore", prompt: "a" };
	pinOmoTaskModel(keyed, "anthropic-apikey/claude-opus-5-5:high");
	expect(keyed.model).toBe("anthropic-apikey/claude-opus-5-5:high");
});

test("the orchestrator's task workers are pinned to its live model and effort; a category worker's model is left to the profile (OmO refuses both)", async () => {
	expect(livePin({ provider: "anthropic-subscription", id: "claude-opus-5-5" }, "medium")).toBe("anthropic-subscription/claude-opus-5-5:medium");
	expect(livePin({ provider: "anthropic-subscription", id: "claude-opus-5-5" }, "off")).toBe("anthropic-subscription/claude-opus-5-5");
	expect(livePin(undefined, "medium")).toBeUndefined();
	const batch: any = { tasks: [{ subagent_type: "oracle", model: "anthropic-subscription/claude-sonnet-5-5", prompt: "x" }, { category: "quick", model: "anthropic-subscription/claude-sonnet-5-5", prompt: "y" }] };
	pinOmoTaskModel(batch, "anthropic-subscription/claude-opus-5-5:medium");
	expect(batch.tasks[0].model).toBe("anthropic-subscription/claude-opus-5-5:medium");
	expect("model" in batch.tasks[1]).toBe(false);

	// A mail conversation's request the orchestrator defers (the owner's turn in mail:<key> ends with [later] after this call):
	// the spawn goes through the orchestrator's guard with its live session model, whatever the reply model is.
	const { pi, handlers } = fakePi(join(dir, "agent-empty"));
	(pi as any).getThinkingLevel = () => "medium";
	installGuard(pi, noGate);
	const ctx = { agent: { kind: "main" }, cwd: dir, model: { provider: "anthropic-subscription", id: "claude-opus-5-5" }, sessionManager: { getSessionId: () => "mail" } };
	const saved = { ...process.env };
	process.env.DOTZ_ORCHESTRATOR = "1";
	delete process.env.DOTZ_LANE;
	try {
		const one = { subagent_type: "oracle", prompt: "mail:acme-1 요청: 샘플 흐름도 검토\nDone when: 의견 3개" };
		const r = await handlers.tool_call[0]({ toolName: "task", input: one }, ctx);
		expect(r.input.model).toBe("anthropic-subscription/claude-opus-5-5:medium");
		const look = { subagent_type: "librarian", prompt: "mail:acme-1 요청: 샘플 흐름도 자료 찾기\nDone when: 링크 3개" };
		expect((await handlers.tool_call[0]({ toolName: "task", input: look }, ctx)).input.model).toBe(LOOKUP_PIN);
		const cat = { category: "deep-low", model: "anthropic-subscription/claude-sonnet-5-5", prompt: "흐름도 만들기\nAcceptance: html" };
		expect("model" in (await handlers.tool_call[0]({ toolName: "task", input: cat }, ctx)).input).toBe(false);
		// A lane's own spawns are not the orchestrator's: left as they are.
		process.env.DOTZ_LANE = "probe";
		const laneCall = { subagent_type: "explore", prompt: "x\nDone when: y" };
		expect((await handlers.tool_call[0]({ toolName: "task", input: laneCall }, ctx)).input.model).toBeUndefined();
	} finally {
		process.env = saved;
	}
});

// A conversation's own session (DOTZ_CONV) keeps its own worker state, and hands writes of the files every session reads to main.
test("the worker state is keyed by DOTZ_CONV, and shared files are written only by the main session", async () => {
	const saved = { ...process.env };
	try {
		delete process.env.DOTZ_LANE;
		delete process.env.DOTZ_CONV;
		expect(stateOwner()).toBeUndefined();
		process.env.DOTZ_CONV = "mail:acme-1";
		expect(stateOwner()).toBe("mail:acme-1");
		process.env.DOTZ_LANE = "ktx";
		expect(stateOwner()).toBe("ktx");
		delete process.env.DOTZ_LANE;
		const data = join(dir, "data");
		expect(sharedWriteBlock("write", { path: join(data, "state.json") }, data, "mail:acme-1")).toContain("dotz_conv send main");
		expect(sharedWriteBlock("edit", { path: join(data, "RULES.md") }, data, "mail:acme-1")).toBeDefined();
		expect(sharedWriteBlock("write", { path: join(data, "memory", "owner.md") }, data, "mail:acme-1")).toBeDefined();
		expect(sharedWriteBlock("eval", { language: "js", code: `await Bun.write("${join(data, "LESSONS.md")}", "x")` }, data, "mail:acme-1")).toBeDefined();
		// Reading them, and writing anything else, is fine; so is every write from the main session.
		expect(sharedWriteBlock("eval", { language: "js", code: `print(read("${join(data, "state.json")}"))` }, data, "mail:acme-1")).toBeUndefined();
		expect(sharedWriteBlock("write", { path: join(data, "reports", "x.md") }, data, "mail:acme-1")).toBeUndefined();
		expect(sharedWriteBlock("write", { path: join(data, "state.json") }, data, "")).toBeUndefined();
		// Through the installed hook: blocked under DOTZ_CONV, allowed for main.
		const { pi, handlers } = fakePi(join(dir, "agent-empty"));
		installGuard(pi, noGate);
		const ctx = { agent: { kind: "main" }, cwd: dir };
		process.env.DOTZ_CONV = "ch:333";
		const call = { toolName: "write", input: { path: join(process.env.DOTZ_DIR!, "state.json"), content: "{}" } };
		expect((await handlers.tool_call[0](call, ctx))?.block).toBe(true);
		delete process.env.DOTZ_CONV;
		expect((await handlers.tool_call[0](call, ctx))?.block).toBeUndefined();
	} finally {
		process.env = saved;
	}
});

// A lane (DOTZ_LANE) hands the same files to main with its report's "<bot> 몫:" line (2026-11-10: a lane wrote memory/owner.md).
const LANE_KO = "orchestrator-guard: state.json, RULES.md, LESSONS.md와 오너 메모는 메인 세션만 써요. 바꿀 내용을 보고에 '땅콩 몫:' 줄로 적으세요.";
test("a lane's writes to state.json, RULES.md, LESSONS.md and owner memory are refused with its own hand-off text; a conversation keeps its text; main writes them", () => {
	const data = mkdtempSync(join(tmpdir(), "dotz-lane-share-"));
	try {
		writeFileSync(join(data, "config.json"), JSON.stringify({ identity: { name: "땅콩", language: "ko" } }));
		for (const p of [join(data, "state.json"), join(data, "RULES.md"), join(data, "LESSONS.md"), join(data, "memory", "owner.md")]) {
			const calls: [string, any][] = [["write", { path: p, content: "x" }], ["edit", { path: p, edits: [] }], ["bash", { command: `echo x >> ${p}` }]];
			for (const [tool, input] of calls) {
				expect(sharedWriteBlock(tool, input, data, "", "split-panes")).toBe(LANE_KO);
				expect(sharedWriteBlock(tool, input, data, "mail:acme-1", "")).toContain("dotz_conv send main");
				expect(sharedWriteBlock(tool, input, data, "", "")).toBeUndefined();
			}
		}
		// Another install's name and language.
		writeFileSync(join(data, "config.json"), JSON.stringify({ identity: { name: "Pip", language: "en" } }));
		expect(sharedWriteBlock("write", { path: join(data, "RULES.md") }, data, "", "ktx")).toContain('"For Pip:"');
	} finally {
		rmSync(data, { recursive: true, force: true });
	}
});

test("through the installed hook a lane is refused on the shared files but writes its report, project files and worktree", async () => {
	const data = mkdtempSync(join(tmpdir(), "dotz-lane-own-"));
	const worktree = mkdtempSync(join(tmpdir(), "dotz-lane-wt-"));
	const saved = { ...process.env };
	try {
		writeFileSync(join(data, "config.json"), JSON.stringify({ identity: { name: "땅콩", language: "ko" } }));
		process.env.DOTZ_DIR = data;
		delete process.env.DOTZ_CONV;
		process.env.DOTZ_LANE = "split-panes";
		const { pi, handlers } = fakePi(join(dir, "agent-empty"));
		installGuard(pi, noGate);
		const ctx = { agent: { kind: "main" }, cwd: worktree };
		const call = (toolName: string, input: any) => handlers.tool_call[0]({ toolName, input }, ctx);
		const owner = await call("write", { path: join(data, "memory", "owner.md"), content: "x" });
		expect(owner?.block).toBe(true);
		expect(owner?.reason).toBe(LANE_KO);
		expect((await call("bash", { command: `echo '{}' > ${join(data, "state.json")}` }))?.reason).toBe(LANE_KO);
		// Its own files: the report, project folders, and its worktree (a relative path is in the lane's folder, not the data dir).
		expect((await call("write", { path: join(data, "lanes", "split-panes", "report.md"), content: "x" }))?.block).toBeUndefined();
		expect((await call("edit", { path: join(data, "projects", "acme", "README.md"), edits: [] }))?.block).toBeUndefined();
		expect((await call("write", { path: join(worktree, "web", "app.js"), content: "x" }))?.block).toBeUndefined();
		expect((await call("write", { path: "RULES.md", content: "x" }))?.block).toBeUndefined();
		expect((await call("bash", { command: `echo x > ${join(data, "lanes", "split-panes", "report.md")}` }))?.block).toBeUndefined();
		// Main (neither variable set) writes the shared files.
		delete process.env.DOTZ_LANE;
		expect((await call("write", { path: join(data, "memory", "owner.md"), content: "x" }))?.block).toBeUndefined();
	} finally {
		process.env = saved;
		rmSync(data, { recursive: true, force: true });
		rmSync(worktree, { recursive: true, force: true });
	}
});

test("project footer: a channel with a project gets its README and RULES.md paths; chat and unknown folders get none", () => {
	const data = mkdtempSync(join(tmpdir(), "dotz-proj-"));
	try {
		mkdirSync(join(data, "projects", "acme"), { recursive: true });
		writeFileSync(join(data, "projects", "acme", "README.md"), "# acme");
		writeFileSync(join(data, "RULES.md"), "rules");
		writeFileSync(join(data, "channel-setups.json"), JSON.stringify([{ channel: "42", purpose: "analysis in projects/acme (README)" }, { channel: "7", purpose: "projects/none" }]));
		const readme = join(data, "projects", "acme", "README.md");
		const omo = { category: "quick", prompt: "make summary.html\nDone when: file" };
		addProjectFooter(omo, "ch:42", "/tmp", data);
		expect(omo.prompt).toContain(`${PROJECT_MARKER} ${readme}, ${join(data, "RULES.md")}`);
		addProjectFooter(omo, "ch:42", "/tmp", data);
		expect(omo.prompt.split(PROJECT_MARKER).length).toBe(2);
		const omp = { tasks: [{ task: `edit ${data}/projects/acme/a.html\nAcceptance: ok` }] };
		addProjectFooter(omp, undefined, "/tmp", data);
		expect(omp.tasks[0].task).toContain(readme);
		const inCwd = { prompt: "x\nDone when: y" };
		addProjectFooter(inCwd, "web", join(data, "projects", "acme", "out"), data);
		expect(inCwd.prompt).toContain(readme);
		for (const conv of [undefined, "web", "ch:7", "ch:99"]) {
			const chat = { prompt: "look up x\nDone when: y" };
			addProjectFooter(chat, conv, "/tmp", data);
			expect(chat.prompt).not.toContain(PROJECT_MARKER);
		}
	} finally {
		rmSync(data, { recursive: true, force: true });
	}
});

test("addProjectFooter: a brief naming a rule folder carries its AGENTS.md, once, from any cwd", () => {
	const repo = mkdtempSync(join(tmpdir(), "folder-rules-"));
	try {
		mkdirSync(join(repo, "web"));
		writeFileSync(join(repo, "web", "AGENTS.md"), "# web rules\n");
		const fromCwd = { prompt: "fix web/js/a.js\nDone when: y" };
		addProjectFooter(fromCwd, undefined, repo, repo);
		expect(fromCwd.prompt).toContain(`${FOLDER_RULES_MARKER}${join(repo, "web", "AGENTS.md")}):\n# web rules`);
		addProjectFooter(fromCwd, undefined, repo, repo);
		expect(fromCwd.prompt.split(FOLDER_RULES_MARKER).length).toBe(2);
		const elsewhere = { tasks: [{ task: `Repo: ${repo}\nfix web/js/a.js` }, { task: `fix ${repo}/web/js/a.js` }] };
		addProjectFooter(elsewhere, undefined, "/tmp", repo);
		for (const t of elsewhere.tasks) expect(t.task).toContain("# web rules");
		const other = { prompt: "fix hub/a.ts and my-web/b.ts\nDone when: y" };
		addProjectFooter(other, undefined, repo, repo);
		expect(other.prompt).not.toContain(FOLDER_RULES_MARKER);
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});

test("a conversation on its own model pins its task workers on main's, and only then", () => {
	const dir = mkdtempSync(join(tmpdir(), "pin-")), file = join(dir, "worker-pin");
	expect(ownWorkerPin(undefined)).toBeUndefined();
	expect(ownWorkerPin(file)).toBeUndefined();
	writeFileSync(file, "anthropic-subscription/claude-opus-5-5:high\n");
	expect(ownWorkerPin(file)).toBe("anthropic-subscription/claude-opus-5-5:high");
	rmSync(dir, { recursive: true, force: true });
});

test("hooks: a stop line tied to a usage limit is refused on every path that carries orchestrator text, unless the owner's own words are quoted", async () => {
	const { pi, handlers } = fakePi(join(dir, "agent-empty"));
	installGuard(pi, noGate);
	const ctx = { agent: { kind: "main" }, cwd: dir, sessionManager: { getSessionId: () => "limit-stop" } };
	const call = (toolName: string, input: any) => handlers.tool_call[0]({ toolName, input }, ctx);
	const ko = "한도가 5% 이하가 되면 새 일을 시작하지 않아요";
	const en = "stop and report when the weekly limit drops below 10%";
	for (const line of [ko, en, "전체 한도가 5%가 되면 멈추고 보고해요"]) {
		expect((await call("dotz_lane", { action: "launch", brief: `Fix the parser.\n${line}\nDone when: tests pass` }))?.block).toBe(true);
		expect((await call("dotz_lane", { action: "send", name: "a", text: line }))?.block).toBe(true);
		expect((await call("dotz_lane", { action: "handover", name: "a", text: line }))?.block).toBe(true);
		expect((await call("dotz_conv", { action: "send", key: "k", text: line }))?.block).toBe(true);
		expect((await call("task", { prompt: `${line}\nDone when: x` }))?.block).toBe(true);
		expect((await call("task", { tasks: [{ task: "ok\nDone when: x" }, { task: `${line}\nDone when: y` }] }))?.block).toBe(true);
	}
	for (const line of ["7일 한도 20% 남음", "한도가 빠듯해요: 큰 캡처를 프롬프트에 통째로 넣지 마세요", "Estimate: 10%", "coverage가 80% 아래면 멈추고 보고", "컨텍스트가 5% 남으면 멈춰요", "시험이 빨가면 멈추고 보고", "한도는 5%에서 멈추지 않고 0%까지 써요"]) {
		expect([line, await call("dotz_lane", { action: "send", name: "a", text: line })]).toEqual([line, undefined]);
		expect([line, await call("dotz_conv", { action: "send", key: "k", text: line })]).toEqual([line, undefined]);
		expect([line, (await call("task", { prompt: `${line}\nDone when: x` }))?.block]).toEqual([line, undefined]);
	}
	const quoted = `${en}\nOwner words: "stop when the weekly limit is under 10%"`;
	expect(await call("dotz_lane", { action: "send", name: "a", text: quoted })).toBeUndefined();
	expect(await call("dotz_lane", { action: "send", name: "a", text: `${ko}\n오너 말: "한도 5% 밑이면 쉬어 줘"` })).toBeUndefined();
	for (const empty of ['Owner words: ""', "Owner words:", 'Owner words: "  "', '오너 말: ""']) {
		expect([empty, (await call("dotz_lane", { action: "send", name: "a", text: `${en}\n${empty}` }))?.block]).toEqual([empty, true]);
	}
});
