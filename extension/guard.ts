// Worker guard (ported from the owner's orchestrator-guard extension): enforces the worker-brief rules on the main
// agent's task/wait/read calls. Blocks briefs without a done-condition or with pasted contents, appends the answer/context
// budget to every brief, and trims oversized worker outputs in every message sent to the provider (wait results and
// auto-delivered results alike; persisted history keeps the full text).
// In workers: drops the 1h cache TTL so worker prefixes use the 5-minute cache (1.25x write instead of 2x; workers
// re-read within 5 minutes). Context blow-up: the first worker compaction steers it to wrap up; the second blocks every
// further tool call so it must hand back partial findings. External-impact commands (push, PR, publish, deploy, ssh,
// outbound writes) are blocked in workers and handed back: the orchestrator judges and runs them.
// Review before apply: writing workers are forced isolated (task.isolation.apply=false keeps their <id>.patch; on OmO each
// task call gets isolated + apply:false + merge:"patch", which keeps root.patch), and the orchestrator's `git apply <patch>`
// (in bash, or in an OmO eval cell) is blocked until that patch file has been read in this session.
// Budget gate: a task call is blocked when the Anthropic 5h quota is too low for the requested workers (the job is assumed
// to use `budget_default_estimate_percent` of the 5h window, or the "Estimate: N%" line of the brief), until the user runs
// /budget-ok. Silent when omp has no Anthropic usage data.
// Expensive-model gate (personal, off unless `guard.ask_before_expensive` is true): task workers on a model matching
// `guard.expensive_models` are blocked, and such a main session is flagged, unless the owner asked (/fable-ok, or
// DOTZ_OWNER_ASKED_FABLE=1 set by the dotz gateway for owner_asked_for_fable lanes).
// State: spawned workers, results, and unapplied patches are kept per project under
// ~/.omp/agent/orchestrator-state (ORCH_GUARD_STATE_DIR overrides) and re-injected after compaction or a new session.
// Workers that finished or whose patch was applied (reverse check, a named `git [-C dir] apply`, or the 30-day git-log
// fallback) leave a tombstone in `settled` for 30 days so old task-result blocks in the history do not resurrect them.
// /compact-switch compacts on the current model (its cache is still warm) before changing models.
// Config: `guard` in <DOTZ_DIR>/config.json (extension/guard-config.ts). When the owner's original orchestrator-guard.ts
// is installed in the agent directory, installGuard() leaves every hook to it and logs once.

import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { broadSearchProblem, expandShellVars, shellText } from "./guard-shell.ts";
import { grantedHere, ownerPickedHere, swapExpensiveModels, workerPin } from "./guard-expensive.ts";
export { shellText };
import { limitStopProblem } from "./guard-limit.ts";
import { callRules, expandCellVars, OMO_PROJECTS, readPaths, workerTrail } from "./guard-notes.ts";
import { dataDir, expensiveMatch, type GuardConfig, GUARD_DEFAULTS, installedOriginal, isMain, laneShareReason, loadGuardConfig, logOnce, stateDir, statePath as stateFile, SUB_COMPACT_STOP, SUB_COMPACT_WRAP_UP } from "./guard-config.ts";

// Active configuration: the defaults until installGuard() loads <DOTZ_DIR>/config.json. The exported checks take their
// limits as a parameter that defaults to it, so tests pass their own.
let G: GuardConfig = GUARD_DEFAULTS;
// The host `pi` object, for the agent directory the state files live under.
let host: unknown;
const WRITING_AGENTS = new Set(["task", "sonic"]);
const WRAP_UP_STEER = "[orchestrator-guard] Your context was just compacted: this assignment is larger than one worker should hold. Finish only the step in progress, then return your final answer now: what is done (with changed paths), what remains, and how you verified. Do not start new steps.";
const STOP_REASON = "[orchestrator-guard] Context compacted twice: tools are disabled for this worker. Write your final answer now with partial findings: done (changed paths), remaining work, verification state.";
const EXTERNAL_COMMANDS: [RegExp, string][] = [
	[/\bgit\s+push\b/, "git push"],
	[/\bgh\s+(pr|release|issue|repo)\s+(create|merge|edit|close|comment|delete|reopen)\b/, "gh write"],
	[/\bgh\s+api\b[^|;&]*(-X|--method)\s*(POST|PUT|PATCH|DELETE)\b/i, "gh api write"],
	[/\b(npm|bun|pnpm|yarn)\s+publish\b/, "package publish"],
	[/\bwrangler\b[^|;&]*\b(deploy|publish)\b/, "wrangler deploy"],
	[/\bcurl\b(?![^|;&]*(localhost|127\.0\.0\.1))[^|;&]*(-X\s*(POST|PUT|PATCH|DELETE)\b|--data\b|\s-d\s|--form\b|-F\s)/i, "outbound HTTP write"],
	[/\b(ssh|scp|rsync)\s+(?!-V\b)[^|;&]*\S+:/, "remote host"],
	[/\bssh\s+(-\S+\s+)*[A-Za-z0-9._-]+(\s|$)/, "remote host"],
];

// `extra`: the owner's own patterns (`guard.external_commands`), regex sources matched case-insensitively.
export function externalAction(command: string, extra: readonly string[] = G.external_commands): string | undefined {
	const builtin = EXTERNAL_COMMANDS.find(([pattern]) => pattern.test(command))?.[1];
	if (builtin) return builtin;
	for (const source of extra) {
		try {
			if (new RegExp(source, "i").test(command)) return `configured pattern ${source}`;
		} catch {
			continue;
		}
	}
	return undefined;
}

// A lane lands a PR through dotz_merge, which checks the reviewed commit and CI; a direct `gh pr merge` would skip both.
export function laneMergeBlock(command: string, lane = process.env.DOTZ_LANE): string | undefined {
	if (!lane || !/\bgh\s+pr\s+merge\b/.test(command)) return undefined;
	return "orchestrator-guard: a lane merges a PR only through dotz_merge (action=review records the verdict for the head you read, then action=merge checks that head and CI).";
}

const DONE_MARKER = /acceptance|done when|done-condition|end state|success criteria|완료 조건|완료 기준|끝 조건/i;
// Shared with the owner's original extension and the harness doctor, so a brief marked by either copy is never marked twice.
const BUDGET_MARKER = "[orchestrator-guard]";
export const budgetLine = (g: GuardConfig = G) =>
	`${BUDGET_MARKER} Final answer: at most ${g.worker_answer_chars} characters - outcome, changed paths, verification, blockers. Context budget ${Math.round(g.worker_context_tokens / 1000)}K tokens; if you near it, stop and hand back partial findings. Never end a turn to wait for a background run (a text-only turn ends your run and the wake-up can fail to start): wait inside one blocking call, e.g. an eval cell that polls up to 280s, then report.`;
// Per-job estimate in a brief: "Estimate: N%" = share of the 5h window the worker is expected to use (absent -> budget_default_estimate_percent).
const ESTIMATE_RE = /^\s*Estimate:\s*(\d+(?:\.\d+)?)\s*%?/im;
const USAGE_CACHE_MS = 120_000;
const STATE_MAX_AGE_MS = 7 * 24 * 3600_000;
const SETTLED_MAX_AGE_MS = 30 * 24 * 3600_000;
const OMP_BIN = /(^|\/)(bun|node)$/.test(process.execPath) ? "omp" : process.execPath;
const DEBUG_LOG = process.env.ORCH_GUARD_DEBUG;

function debug(entry: Record<string, unknown>): void {
	if (!DEBUG_LOG) return;
	appendFileSync(DEBUG_LOG, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

function longestFence(text: string): number {
	let longest = 0;
	for (const block of text.match(/```[\s\S]*?```/g) ?? []) longest = Math.max(longest, block.split("\n").length - 2);
	return longest;
}

// The git toplevel of `cwd`, "" outside a repo.
function gitTop(cwd: string): string {
	try {
		return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 }).trim();
	} catch {
		return "";
	}
}
const real = (p: string) => {
	try {
		return realpathSync(p);
	} catch {
		return resolve(p);
	}
};

// Whether writing workers started from a folder whose git toplevel is `top` get an isolated copy. Not outside a repo, not
// where OmO already answered isolation_unavailable, and not in the dotz data folder: ~/.dotz is a git repo only for the
// nightly settings snapshot (.gitignore `*` with a few files let back in), so a copy of it holds none of the files a worker
// touches, and OmO's baseline capture of it failed every first worker of a mail conversation on the Mac mini
// (st_01a17c03, st_01a17c1a, 2026-10-27: "isolation_unavailable: baseline capture failed: ... rev-parse --verify --quiet HEAD
// failed (128)"). A lane worktree under ~/.dotz/lanes is its own toplevel and stays isolated.
export function shouldIsolate(top: string, unavailable: boolean, home = dataDir()): boolean {
	return Boolean(top) && !unavailable && real(top) !== real(home);
}

// Checkout roots an isolated worker must not reach by absolute path: the cwd's own toplevel and the repo's main checkout
// (a lane worktree's brief still names the main checkout). omp copies the repo but does not remap absolute paths, so a
// brief with /abs/repo/file makes the worker edit the real repo (onboard-perms lane, 2026-10-17).
function checkoutRoots(cwd: string): string[] {
	try {
		const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", timeout: 5_000 }).trim();
		const list = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd, encoding: "utf8", timeout: 5_000 });
		const main = list.split("\n").find(line => line.startsWith("worktree "))?.slice(9) ?? "";
		return [...new Set([top, main].filter(Boolean))].sort((a, b) => b.length - a.length);
	} catch {
		return [];
	}
}

export function relativizeRoots(text: string, roots: string[]): string {
	let out = text;
	for (const root of roots) {
		const esc = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		out = out.replace(new RegExp(`${esc}/`, "g"), "").replace(new RegExp(`${esc}(?![\\w./-])`, "g"), ".");
	}
	return out;
}

// Isolation needs a git repo; outside one an isolated worker cannot start, so writing workers run in place there.
// `roots`: checkout paths rewritten to cwd-relative in isolated briefs, so the worker edits its own copy.
export function checkTaskInput(input: any, isolate = true, roots: string[] = [], g: GuardConfig = G): { reason: string } | { input: any } {
	const context = typeof input?.context === "string" ? input.context : "";
	const items: any[] = Array.isArray(input?.tasks) ? input.tasks : [];
	if (!items.length) return { input };
	const problems: string[] = [];
	items.forEach((item, i) => {
		const brief = typeof item?.task === "string" ? item.task : "";
		const label = `tasks[${i}]`;
		if (!DONE_MARKER.test(`${brief}\n${context}`)) problems.push(`${label} has no observable done-condition (add an "Acceptance:" or "Done when:" line)`);
		if (brief.length + context.length > g.max_brief_chars) problems.push(`${label} brief is ${brief.length + context.length} chars; pass paths instead of pasted contents (limit ${g.max_brief_chars})`);
		if (longestFence(`${brief}\n${context}`) > g.max_fence_lines) problems.push(`${label} pastes a code block over ${g.max_fence_lines} lines; pass the path and line range instead`);
	});
	if (problems.length) return { reason: `Worker brief rejected by the guard (worker-brief rules):\n- ${problems.join("\n- ")}\nRewrite the task call and retry.` };
	let anyIsolated = false;
	const tasks = items.map(item => {
		const next = typeof item?.task === "string" && !item.task.includes(BUDGET_MARKER) ? { ...item, task: `${item.task}\n\n${budgetLine(g)}` } : { ...item };
		if (isolate && WRITING_AGENTS.has(String(item?.agent ?? "task"))) next.isolated = true;
		if (next.isolated && roots.length && typeof next.task === "string") {
			next.task = relativizeRoots(next.task, roots);
			anyIsolated = true;
		}
		return next;
	});
	return { input: { ...input, ...(anyIsolated && context ? { context: relativizeRoots(context, roots) } : {}), tasks } };
}

// A worker sees only its brief, so a task spawned for a project's work is pointed at the project's rules (owner 2026-11-02: a
// summary page delegated with only "reuse the CSS" ignored the full version's layout and the README's analysis rule). A project
// is a folder <data>/projects/<p> with a README.md, named by the conversation's channel setup (bare `projects/<p>`), by the
// brief (`~/.dotz/projects/<p>` or the absolute path) or by the task's cwd. No project, no footer.
export const PROJECT_MARKER = "Read first (project rules):";
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function projectFooter(brief: string, conv = process.env.DOTZ_CONV, cwd = "", data = dataDir()): string | undefined {
	const names = new Set<string>();
	const ch = /^ch:(\d+)$/.exec(conv ?? "")?.[1];
	if (ch) {
		try {
			const s = (JSON.parse(readFileSync(join(data, "channel-setups.json"), "utf8")) as any[]).find(x => x?.channel === ch);
			for (const m of `${s?.purpose ?? ""} ${s?.standing ?? ""}`.matchAll(/(?:^|[^\w./-])(?:~\/\.dotz\/)?projects\/([\w.-]+)/g)) names.add(m[1]);
		} catch {} // no setups file (or unreadable): the brief and cwd still name the project
	}
	const under = `(?:${escRe(data)}|~/\\.dotz)/projects/([\\w.-]+)`;
	for (const m of `${brief}\n${cwd}/`.matchAll(new RegExp(under, "g"))) names.add(m[1]);
	const readmes = [...names].map(p => join(data, "projects", p, "README.md")).filter(f => existsSync(f));
	if (!readmes.length) return undefined;
	const rules = join(data, "RULES.md");
	return `${PROJECT_MARKER} ${[...readmes, ...(existsSync(rules) ? [rules] : [])].join(", ")}. A derivative of an existing artifact starts from a copy of it.`;
}
// OmO injects a folder's AGENTS.md only on the `read` tool; a worker that reads through eval or a shell gets nothing (measured
// 2026-11-05, /tmp/lessons-proof). A brief that names one of these folders carries the rules itself. Roots: the task's cwd and
// every absolute path in the brief, walked upward, so "Repo: /x/dotz ... web/a.js" works from another cwd.
export const FOLDER_RULES_MARKER = "Folder rules (";
const RULE_FOLDERS = /(?<![\w.-])(web|site)\//g;
function folderRules(brief: string, cwd: string): string[] {
	const folders = new Set([...brief.matchAll(RULE_FOLDERS)].map(m => m[1]));
	const found = new Set<string>();
	if (folders.size)
		for (const start of [cwd, ...(brief.match(/(?:~\/|\/)[\w./-]+/g) ?? [])]) {
			for (let dir = start.replace(/^~/, homedir()); dir.length > 1; dir = dirname(dir))
				for (const folder of folders) {
					const file = join(dir, folder, "AGENTS.md");
					if (existsSync(file)) found.add(file);
				}
		}
	return [...found].map(file => `${FOLDER_RULES_MARKER}${file}):\n${readFileSync(file, "utf8").trim()}`);
}

// Appends the footers to each brief in place (both task shapes: OmO `prompt`, omp `tasks[].task`), once.
export function addProjectFooter(input: any, conv = process.env.DOTZ_CONV, cwd = "", data = dataDir()): void {
	const context = typeof input?.context === "string" ? input.context : "";
	for (const item of Array.isArray(input?.tasks) ? input.tasks : [input]) {
		const field = typeof item?.prompt === "string" ? "prompt" : typeof item?.task === "string" ? "task" : undefined;
		if (!field) continue;
		const brief = `${item[field]}\n${context}`;
		const project = item[field].includes(PROJECT_MARKER) ? undefined : projectFooter(brief, conv, cwd, data);
		const folders = item[field].includes(FOLDER_RULES_MARKER) ? [] : folderRules(brief, cwd);
		for (const footer of [...(project ? [project] : []), ...folders]) item[field] = `${item[field]}\n\n${footer}`;
	}
}

// OmO's task tool (omo-task) takes one worker as `{prompt, category | subagent_type, ...}` or several as `{tasks: [{prompt, ...}]}`,
// with isolation per call or item: `isolated`, `apply` (false = keep the change as a patch and merge nothing) and `merge`
// ("patch"). The same brief rules apply; writing workers are isolated with apply:false, so their change comes back as
// `isolation: retained via <backend> -> <dir>/root.patch` in the task completion. Read-only agents run in place.
const OMO_READ_ONLY = /^(explore|librarian|oracle|plan-|.*review|.*qa-)/;
const isOmoTaskInput = (input: any) => typeof input?.prompt === "string" || (Array.isArray(input?.tasks) && input.tasks.some((t: any) => typeof t?.prompt === "string"));
// senpi applies a tool_call handler's changes only when `event.input` is mutated in place, so the items are edited where they are.
export function checkOmoTaskInput(input: any, isolate = true, roots: string[] = [], g: GuardConfig = G): { reason: string } | { input: any } {
	const items: any[] = Array.isArray(input?.tasks) ? input.tasks : [input];
	const problems: string[] = [];
	items.forEach((item, i) => {
		const brief = typeof item?.prompt === "string" ? item.prompt : "";
		const label = Array.isArray(input?.tasks) ? `tasks[${i}]` : "the task";
		if (!DONE_MARKER.test(brief)) problems.push(`${label} has no observable done-condition (add an "Acceptance:" or "Done when:" line)`);
		if (brief.length > g.max_brief_chars) problems.push(`${label} brief is ${brief.length} chars; pass paths instead of pasted contents (limit ${g.max_brief_chars})`);
		if (longestFence(brief) > g.max_fence_lines) problems.push(`${label} pastes a code block over ${g.max_fence_lines} lines; pass the path and line range instead`);
	});
	if (problems.length) return { reason: `Worker brief rejected by the guard (worker-brief rules):\n- ${problems.join("\n- ")}\nRewrite the task call and retry.` };
	for (const item of items) {
		if (typeof item?.prompt === "string" && !item.prompt.includes(BUDGET_MARKER)) item.prompt = `${item.prompt}\n\n${budgetLine(g)}`;
		if (OMO_READ_ONLY.test(String(item?.subagent_type ?? ""))) continue;
		// Said explicitly, so neither the orchestrator's own `isolated: true` nor an omo.json `task.isolation.enabled` isolates
		// a worker where isolation cannot start (OmO refuses apply/merge without isolation).
		if (!isolate) {
			item.isolated = false;
			delete item.apply;
			delete item.merge;
			continue;
		}
		item.isolated = true;
		item.apply = false;
		item.merge = "patch";
		if (roots.length && typeof item.prompt === "string") item.prompt = relativizeRoots(item.prompt, roots);
	}
	return { input };
}

// The orchestrator's task workers run on its own live model and effort (owner 2026-10-27: work asked for in a mail, kakao or
// monitor conversation runs on the main orchestrator's model, never the reply model or a smaller worker model). OmO takes a
// `model` only beside `subagent_type` and refuses it beside `category` (category_with_model), so a subagent_type worker is
// pinned here and a category worker's model is dropped: its category runs on the same model through the
// dotz-orchestrator-workers profile (hub/runtime/omo.ts). Edited in place, as checkOmoTaskInput.
// Lookups run lighter (owner 2026-10-27): explore and librarian take Sonnet 5.5 medium on the subscription login (hub/runtime/omo.ts
// LOOKUP_MODEL in OmO's provider names; the quick category gets it through the profile). On an API-key session they follow the pin.
export const LOOKUP_PIN = "anthropic-subscription/claude-sonnet-5-5:medium";
const LOOKUP_AGENTS = /^(explore|librarian)$/;
export function pinOmoTaskModel(input: any, pin: string, keep: (model: unknown) => boolean = () => false): void {
	for (const item of Array.isArray(input?.tasks) ? input.tasks : [input]) {
		if (!item || typeof item !== "object") continue;
		const agent = typeof item.subagent_type === "string" ? item.subagent_type.trim() : "";
		if (agent && keep(item.model)) continue; // an expensive model the owner allowed for this job (grant) stays
		if (agent) item.model = LOOKUP_AGENTS.test(agent) && pin.startsWith("anthropic-subscription/") ? LOOKUP_PIN : pin;
		else delete item.model;
	}
	if (Array.isArray(input?.tasks)) delete input.model;
}
// A conversation on its own model keeps its workers on main's: the hub writes that pin to DOTZ_WORKER_PIN_FILE (hub/convsessions.ts) only then.
export const ownWorkerPin = (file: string | undefined): string | undefined => (file && existsSync(file) ? readFileSync(file, "utf8").trim() || undefined : undefined);
// The live session's model as a task pin (`provider/model[:effort]`, OmO's own provider names), or undefined before one is known.
export function livePin(model: { provider?: string; id?: string } | undefined, effort: unknown): string | undefined {
	if (!model?.provider || !model.id) return undefined;
	const level = typeof effort === "string" && effort && effort !== "off" ? `:${effort}` : "";
	return `${model.provider}/${model.id}${level}`;
}

type TaskInput = { context?: unknown; model?: unknown; tasks?: { task?: unknown; model?: unknown }[] };

export function estimateFrom(input: TaskInput | undefined, g: GuardConfig = G): number {
	const pick = (text: unknown) => {
		const found = ESTIMATE_RE.exec(typeof text === "string" ? text : "")?.[1];
		return found === undefined ? undefined : Number(found);
	};
	const own = (Array.isArray(input?.tasks) ? input.tasks : []).map(item => pick(item?.task)).filter((n): n is number => n !== undefined);
	const total = own.length ? own.reduce((a, b) => a + b, 0) : pick(input?.context);
	return total === undefined ? g.budget_default_estimate_percent : Math.min(total, 100);
}

export function expensiveModel(value: unknown, g: GuardConfig = G): string | undefined {
	return expensiveMatch(value, g);
}

// The worker model a task call asks for in its own arguments (a `model` on the call or on an item). Models that come from
// modelRoles / agentModelOverrides are caught at dispatch by the before_subagent_spawn hook.
export function expensiveTaskModel(input: TaskInput | undefined, g: GuardConfig = G): string | undefined {
	for (const holder of [input, ...(Array.isArray(input?.tasks) ? input.tasks : [])]) {
		const found = expensiveModel(holder?.model, g);
		if (found) return found;
	}
	return undefined;
}

export function trimWaitOutput(text: string, g: GuardConfig = G): string {
	return text.replace(
		/(<task-result\b[^>]*\bid="([^"]+)"[^>]*>\s*<output>\n?)([\s\S]*?)(\n?<\/output>)/g,
		(whole, open: string, id: string, body: string, close: string) =>
			body.length <= g.max_output_chars
				? whole
				: `${open}${body.slice(0, g.max_output_chars)}\n[orchestrator-guard: output trimmed from ${body.length} chars; full text at history://${id}]${close}`,
	);
}

export function dropLongTtl(value: any): number {
	if (Array.isArray(value)) return value.reduce((n, item) => n + dropLongTtl(item), 0);
	if (!value || typeof value !== "object") return 0;
	let dropped = 0;
	const cache = value.cache_control;
	if (cache && typeof cache === "object" && cache.ttl === "1h") {
		delete cache.ttl;
		dropped++;
	}
	for (const key of Object.keys(value)) if (key !== "cache_control") dropped += dropLongTtl(value[key]);
	return dropped;
}

type Limit = { id: string; window?: { resetsAt?: number }; amount?: { remaining?: number } };
type WorkerState = { brief: string; spawnedAt: number; status: string; patch?: string; applied?: boolean };
type ProjectState = { cwd: string; lane?: string; workers: Record<string, WorkerState>; settled?: Record<string, number> };

let usageCache: { at: number; limits: Limit[] } | undefined;

function anthropicLimits(): Promise<Limit[] | undefined> {
	if (usageCache && Date.now() - usageCache.at < USAGE_CACHE_MS) return Promise.resolve(usageCache.limits);
	const { promise, resolve } = Promise.withResolvers<Limit[] | undefined>();
	execFile(OMP_BIN, ["usage", "--json", "-p", "anthropic"], { timeout: 15_000 }, (error, stdout) => {
		if (error) {
			debug({ phase: "usage-error", message: String(error) });
			return resolve(undefined);
		}
		try {
			const limits: Limit[] = JSON.parse(stdout).reports?.find((r: any) => r.provider === "anthropic")?.limits ?? [];
			usageCache = { at: Date.now(), limits };
			resolve(limits);
		} catch (parseError) {
			debug({ phase: "usage-parse-error", message: String(parseError) });
			resolve(undefined);
		}
	});
	return promise;
}

export function budgetProblem(limits: Limit[], workers: number, est = G.budget_default_estimate_percent, margin = G.budget_margin_percent): string | undefined {
	const clock = (ms?: number) => (ms ? new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "?");
	const five = limits.find(l => l.id === "anthropic:5h");
	const week = limits.find(l => l.id === "anthropic:7d");
	if (typeof five?.amount?.remaining !== "number" || five.amount.remaining - est >= margin) return undefined;
	const weekNote = typeof week?.amount?.remaining === "number" ? `; 7d window ${week.amount.remaining}% left (info only)` : "";
	return `5h window ${five.amount.remaining}% left; this fan-out (${workers} worker(s)) is assumed to use ~${est}%, leaving under ${margin}% (resets ${clock(five.window?.resetsAt)})${weekNote}; add an "Estimate: N%" line to the brief if it is smaller`;
}

function contextTokens(ctx: any): number {
	const usage = ctx?.getContextUsage?.();
	return Number(usage?.tokens ?? usage?.usedTokens ?? usage?.contextTokens ?? 0) || 0;
}

// Worker state is per project folder and, for dotz lanes (several omp sessions in one folder), per lane, so one lane's
// workers are never reported in another lane's channel. A conversation's own session (DOTZ_CONV) shares the data dir with
// the main one, so it keys its state the same way.
export const stateOwner = (): string | undefined => process.env.DOTZ_LANE || process.env.DOTZ_CONV || undefined;

// The files every session reads at start and only the main session writes (state.json, owner rules, lessons, owner memory):
// a conversation's session hands a change to them to main, and a lane (DOTZ_LANE) puts it in its report's "<bot> 몫:" line
// (hub/forline.ts), so two sessions never write one at once (2026-11-10: a lane wrote memory/owner.md).
const SHARED_FILES = ["state.json", "RULES.md", "LESSONS.md"];
const WRITE_TOOLS = new Set(["write", "edit", "multiedit", "apply_patch", "ast_edit", "notebook_edit"]);
const SHELL_WRITES = /\b(write(File|FileSync)?|appendFile(Sync)?|Bun\.write|writeAtomic|rename(Sync)?|unlink(Sync)?|rm|mv|cp|tee|sed\s+-i|truncate)\b|>{1,2}/;
// A relative path resolves in the session's folder (cwd): a lane's worktree may hold its own RULES.md or state.json.
export function sharedWriteBlock(tool: string, input: any, data = dataDir(), conv = process.env.DOTZ_CONV, lane = process.env.DOTZ_LANE, cwd = data): string | undefined {
	if (!conv && !lane) return undefined;
	const shared = [...SHARED_FILES.map(f => join(data, f)), join(data, "memory") + "/"];
	const hits = (p: string) => {
		const abs = p.startsWith("~/") ? join(homedir(), p.slice(2)) : resolve(cwd, p);
		return shared.some(s => (s.endsWith("/") ? abs.startsWith(s) : abs === s));
	};
	let writes = false;
	if (WRITE_TOOLS.has(tool)) {
		const paths = [input?.path, input?.file_path, ...(Array.isArray(input?.paths) ? input.paths : [])].filter((p): p is string => typeof p === "string");
		writes = paths.some(hits) || (tool === "apply_patch" && typeof input?.input === "string" && shared.some(s => input.input.includes(s)));
	} else if (tool === "bash" || tool === "eval") {
		const text = shellText(input);
		const named = shared.some(s => text.includes(s)) || SHARED_FILES.some(f => text.includes(`.dotz/${f}`)) || text.includes(".dotz/memory/");
		writes = named && SHELL_WRITES.test(text);
	}
	if (!writes) return undefined;
	if (lane) return laneShareReason(data);
	return `orchestrator-guard: this session answers only its own conversation (${conv}); state.json, RULES.md, LESSONS.md and owner memory are written by the main session. Hand the change over with dotz_conv send main.`;
}

function statePath(cwd: string, lane?: string): string {
	return stateFile(stateDir(host), cwd, lane);
}

function loadState(cwd: string): ProjectState {
	const lane = stateOwner();
	try {
		return { ...JSON.parse(readFileSync(statePath(cwd, lane), "utf8")), cwd, lane };
	} catch {
		return { cwd, lane, workers: {} };
	}
}

function saveState(state: ProjectState): void {
	const now = Date.now();
	const cutoff = now - STATE_MAX_AGE_MS;
	for (const [id, worker] of Object.entries(state.workers)) {
		const finished = worker.status !== "running" && (!worker.patch || worker.applied);
		if (finished || worker.spawnedAt < cutoff) {
			delete state.workers[id];
			// Tombstone: old task-result blocks in the session history would otherwise recreate the worker as unapplied.
			// A lost worker never produced a result block, so it gets none: if it does finish after all, its result is tracked.
			if (worker.status !== "lost") (state.settled ??= {})[id] = now;
		}
	}
	// Another omp process (a second session in this lane) may have written tombstones since this one loaded the file.
	try {
		const onDisk: ProjectState = JSON.parse(readFileSync(statePath(state.cwd, state.lane), "utf8"));
		for (const [id, at] of Object.entries(onDisk.settled ?? {})) if (!state.workers[id]) (state.settled ??= {})[id] ??= at;
	} catch {}
	if (state.settled) {
		for (const [id, at] of Object.entries(state.settled)) if (at < now - SETTLED_MAX_AGE_MS) delete state.settled[id];
	}
	mkdirSync(stateDir(host), { recursive: true });
	writeFileSync(statePath(state.cwd, state.lane), `${JSON.stringify(state, null, 2)}\n`);
}

export function stateSummary(state: ProjectState, previousSession: boolean, projects = OMO_PROJECTS): string | undefined {
	const lines = Object.entries(state.workers).map(([id, w]) => {
		if (w.status === "running" && !previousSession) return `- ${id}: still running - ${w.brief}`;
		if (w.status === "lost" || w.status === "running")
			return `- ${id}: ${w.status === "lost" ? "lost" : "was running when the previous omp session ended (its process is gone; a message cannot continue it)"} - ${w.brief}\n  ${workerTrail(id, projects)}`;
		if (w.patch && !w.applied)
			return `- ${id}: ${w.status}, patch NOT applied: ${w.patch}${existsSync(w.patch) ? "" : " (file missing)"} - ${w.brief}`;
		return `- ${id}: ${w.status} - ${w.brief}`;
	});
	return lines.length ? `[orchestrator-guard] Open worker state for this project (${state.cwd}):\n${lines.join("\n")}` : undefined;
}

// `git` with any number of `-C <dir>` options (quoted or bare), then `apply`: the one matcher for every place that
// recognises an applying orchestrator command.
const GIT_APPLY = String.raw`\bgit(?:\s+-C\s+(?:"[^"]*"|'[^']*'|[^\s;&|)]+))*\s+apply\b`;
const GIT_APPLY_RE = new RegExp(GIT_APPLY);
// Patch files an applying command names; --stat/--check/--reverse/--summary/--numstat runs apply nothing.
const GIT_APPLY_NAMED = new RegExp(`${GIT_APPLY}(?![^|;&]*--(?:stat|check|reverse|summary|numstat))[^|;&]*?(\\S+\\.patch)`, "g");

function reverseChecks(cwd: string, patch: string): boolean {
	try {
		execFileSync("git", ["apply", "--reverse", "--check", patch], { cwd, stdio: "ignore", timeout: 5_000 });
		return true;
	} catch {
		return false;
	}
}

// Worktree paths of the repo containing `dir` (empty when `dir` is no repo). `cache` lives for one refresh.
function worktreesOf(dir: string, cache: Map<string, string[]>): string[] {
	const hit = cache.get(dir);
	if (hit) return hit;
	let found: string[] = [];
	try {
		const out = execFileSync("git", ["-C", dir, "worktree", "list", "--porcelain"], { stdio: ["ignore", "pipe", "ignore"], timeout: 3_000, encoding: "utf8" });
		found = out.split("\n").filter(line => line.startsWith("worktree ")).map(line => line.slice(9)).filter(path => existsSync(path));
	} catch {}
	cache.set(dir, found);
	for (const path of found) if (!cache.has(path)) cache.set(path, found);
	return found;
}

// Directories a shell command ran `git apply` in: the tool cwd, then each `cd <dir>` / `git -C <dir>` it names, resolved in order.
function applyDirsOf(command: string, toolCwd: string): string[] {
	const dirs = [toolCwd];
	let at = toolCwd;
	const unquote = (raw: string) => raw.replace(/^['"]|['"]$/g, "");
	const target = (raw: string) => {
		const dir = unquote(raw);
		return resolve(at, dir === "~" || dir.startsWith("~/") ? join(homedir(), dir.slice(1)) : dir);
	};
	for (const m of command.matchAll(/(?:^|[;&|(]\s*|&&\s*)cd\s+("[^"]+"|'[^']+'|[^\s;&|)]+)|\bgit\s+-C\s+("[^"]+"|'[^']+'|[^\s;&|)]+)/g)) {
		if (m[1]) at = target(m[1]);
		else dirs.push(target(m[2]));
		if (m[1]) dirs.push(at);
	}
	return dirs;
}

// A patch counts as applied when it reverses cleanly in any of `dirs` or any worktree of their repos
// (a lane worktree or another cwd is where it may actually have gone in).
function patchIsApplied(dirs: string[], patch: string, cache: Map<string, string[]> = new Map()): boolean {
	const tried = new Set<string>();
	const attempt = (dir: string) => {
		const key = resolve(dir);
		if (tried.has(key) || !existsSync(key)) return false;
		tried.add(key);
		return reverseChecks(key, patch);
	};
	for (const dir of dirs) if (attempt(dir)) return true;
	for (const dir of dirs) for (const tree of worktreesOf(dir, cache)) if (attempt(tree)) return true;
	return false;
}

// History fallback (session start only) for patches that were merged with --3way or edited by hand (so the reverse check
// fails) or whose lines were touched by later commits: the patch has landed when at least 80% of its distinctive changed
// lines (sign + trimmed text, at least 8 chars, not punctuation-only) appear as same-sign changed lines in the last 30 days
// of `git log --branches -p` over the files it touches, in any repo containing one of `dirs`. Files no commit ever touched
// (throwaway smoke scripts a lane leaves out) are ignored; fewer than 3 distinctive lines left is too weak to decide.
function changedLines(diff: string): Map<string, Set<string>> {
	const byFile = new Map<string, Set<string>>();
	let lines: Set<string> | undefined;
	let inHunk = false;
	for (const row of diff.split("\n")) {
		const header = row.match(/^diff --git a\/(.+?) b\/(.+)$/);
		if (header) {
			inHunk = false;
			lines = byFile.get(header[2]) ?? new Set();
			byFile.set(header[2], lines);
		} else if (row.startsWith("@@")) {
			inHunk = true;
		} else if (lines && inHunk && (row[0] === "+" || row[0] === "-")) {
			const text = row.slice(1).trim();
			if (text.length >= 8 && /[A-Za-z0-9]/.test(text)) lines.add(row[0] + text);
		}
	}
	return byFile;
}

function patchLanded(dirs: string[], patch: string): boolean {
	let wanted: Map<string, Set<string>>;
	try {
		wanted = changedLines(readFileSync(patch, "utf8"));
	} catch {
		return false;
	}
	if (!wanted.size) return false;
	const seen = new Set<string>();
	for (const dir of dirs) {
		if (!existsSync(dir)) continue;
		let top: string;
		try {
			top = execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 }).trim();
		} catch {
			continue;
		}
		if (!top || seen.has(top)) continue;
		seen.add(top);
		try {
			const log = execFileSync("git", ["-C", top, "log", "--branches", "--since=30.days", "-p", "--format=", "--", ...wanted.keys()], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000, maxBuffer: 512 * 1024 * 1024 });
			const history = changedLines(log);
			const changed = new Set<string>();
			for (const lines of history.values()) for (const line of lines) changed.add(line);
			let total = 0;
			let hits = 0;
			for (const [file, lines] of wanted) {
				if (!history.has(file)) continue;
				total += lines.size;
				for (const line of lines) if (changed.has(line)) hits++;
			}
			if (total >= 3 && hits >= Math.ceil(total * 0.8)) return true;
		} catch (error) {
			debug({ phase: "patch-landed-error", dir: top, message: String(error) });
		}
	}
	return false;
}

function keepPatch(cwd: string, id: string, captured: string): string {
	const dir = join(stateDir(host), "patches", createHash("sha1").update(cwd).digest("hex").slice(0, 16));
	const kept = join(dir, `${id}.patch`);
	if (existsSync(kept)) return kept;
	try {
		mkdirSync(dir, { recursive: true });
		copyFileSync(captured, kept);
		return kept;
	} catch (error) {
		debug({ phase: "patch-keep-error", captured, message: String(error) });
		return captured;
	}
}

function briefLabel(task: unknown): string {
	return String(task ?? "")
		.split("\n")
		.filter(line => line.trim() && !/^\s*#/.test(line) && !line.includes(BUDGET_MARKER))
		.join(" ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 160);
}

// Settles known workers from any tool result: `<task-result id status>` blocks (task, wait, read of agent://) and the
// `### <id> [<agent>] — <status>` headers of job listings, which is the only record of a worker cancelled through
// proc://<id>/kill. Unknown ids are only created from task-result blocks, and never for a tombstoned id (`state.settled`):
// a worker that finished is deleted from the state, and its old task-result block in the history must not resurrect it.
export function settleFromText(state: ProjectState, text: string): boolean {
	let changed = false;
	for (const match of text.matchAll(/<task-result\b[^>]*\bid="([^"]+)"[^>]*\bstatus="([^"]+)"[^>]*>([\s\S]*?)<\/task-result>/g)) {
		const [, id, status, body] = match;
		const worker = state.workers[id] ?? (state.settled?.[id] ? undefined : (state.workers[id] = { brief: "(spawned before tracking)", spawnedAt: Date.now(), status: "running" }));
		if (!worker) continue;
		const captured = body.match(/changes captured at `([^`]+\.patch)`/)?.[1];
		const patch = captured ? keepPatch(state.cwd, id, captured) : undefined;
		if (worker.status !== status || (patch && worker.patch !== patch)) {
			worker.status = status;
			if (patch) worker.patch = patch;
			changed = true;
		}
	}
	// OmO: "task completion name:<n> id:<st_…> … status:<s> …", then result lines and, for an isolated worker,
	// "isolation: <kind> via <backend> -> <root.patch>" (kind "retained" = apply:false, nothing merged).
	for (const match of text.matchAll(/^task completion(?: \([^)]*\))? .*?\bid:(st_\w+)\b.*?\bstatus:(\w+)[^\n]*((?:\n(?!task completion)[^\n]*)*)/gm)) {
		const [, id, status, rest] = match;
		const worker = state.workers[id] ?? (state.settled?.[id] ? undefined : (state.workers[id] = { brief: "(spawned before tracking)", spawnedAt: Date.now(), status: "running" }));
		if (!worker) continue;
		const isolation = /^isolation: ([\w-]+) via \S+ -> (\S+\.patch)\s*$/m.exec(rest);
		const patch = isolation && isolation[1] === "retained" ? keepPatch(state.cwd, id, isolation[2]) : undefined;
		if (worker.status !== status || (patch && worker.patch !== patch)) {
			worker.status = status;
			if (patch) worker.patch = patch;
			changed = true;
		}
	}
	for (const [, id, status] of text.matchAll(/^###\s+(\S+)\s+\[[^\]]+\]\s+[—-]\s+(cancelled|completed|failed|aborted)\b/gm)) {
		const worker = state.workers[id];
		if (worker?.status === "running") {
			worker.status = status;
			changed = true;
		}
	}
	return changed;
}

// Repeat guard, ported from oh-my-hermes tool_bursts.py: a model that reads a refusal and re-issues the same call 100+ times
// burns the session. Per session we keep digests of the last calls (tool + canonical args) and of what each returned, so
// the same call whose output changes (a poll: `gh pr checks`) is not a loop. A cycle of period 1..4 at the history end
// engages stage 1 (block) when the call about to run would complete the required laps; after REPEAT_ESCALATION_ATTEMPTS
// ignored blocks stage 2 asks a human (ctx.ui.confirm) or, with nobody to ask, tells the model to stop and report.
const REPEAT_MAX_PERIOD = 4;
const REPEAT_MIN_LAPS = 3;
const REPEAT_ESCALATION_ATTEMPTS = 4;
const REPEAT_HISTORY = 16;
const REPEAT_MAX_SESSIONS = 64;
const REPEAT_WINDOW_MS = 300_000;
const REPEAT_ARGS_MAX_CHARS = 1024 * 1024;
const REPEAT_RESULT_PREFIX = 8192;

interface RepeatCall { tool: string; args: string; result: string; id: string }
interface RepeatEngaged { sig: string; elements: RepeatCall[]; ran: number; compared: boolean }
interface RepeatRow { calls: RepeatCall[]; blocked: number; engaged?: RepeatEngaged; seen: number }

// Laps of a `period`-long cycle before stage 1: period 1 -> 8 laps, 2 -> 4, 3 -> 3, 4 -> 3 (8, 8, 9, 12 calls). The laps floor keeps a coincidental A,B,A,B from reading as a loop.
const requiredLaps = (period: number) => Math.max(REPEAT_MIN_LAPS, Math.ceil(G.repeat_block_threshold / period));
// Tools that are legitimately re-invoked with identical args (waiting on background jobs).
const isPollerTool = (tool: string) => tool === "wait" || /_(get_result|poll)$/.test(tool);
const digestOf = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

function canonicalJson(value: unknown): string {
	// Sorted keys: the same call must hash the same however the model ordered its arguments.
	return JSON.stringify(value, (_key, v) =>
		v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v) ?? "";
}

// "" = unknown identity (circular, unserializable or oversized input): such a call is never counted as a repeat.
function repeatArgsDigest(tool: string, input: unknown): string {
	try {
		const canonical = canonicalJson(input);
		return canonical.length > REPEAT_ARGS_MAX_CHARS ? "" : digestOf(`${tool}\0${canonical}`);
	} catch {
		return "";
	}
}

// Length plus a bounded prefix: a growing log changes length even when its first 8 KiB does not.
function repeatResultDigest(content: unknown): string {
	if (!Array.isArray(content)) return "";
	const text = content.map((b: { text?: string }) => (typeof b?.text === "string" ? b.text : "")).join("\n");
	return digestOf(`${text.length}:${text.slice(0, REPEAT_RESULT_PREFIX)}`);
}

// An unknown result (not yet back, or never observed) is no evidence of change: compare on arguments alone.
const sameCall = (a: RepeatCall, b: RepeatCall) =>
	a.tool === b.tool && a.args === b.args && (!a.result || !b.result || a.result === b.result);

// Shortest repeating cycle at the END of the history as [period, laps], or undefined. Laps count back-to-back repeats.
function detectCycle(history: RepeatCall[]): [number, number] | undefined {
	const size = history.length;
	for (let period = 1; period <= REPEAT_MAX_PERIOD && size >= period * 2; period++) {
		let laps = 1;
		let start = size - period;
		while (start - period >= 0 && history.slice(start, start + period).every((call, i) => sameCall(history[start - period + i], call))) {
			laps++;
			start -= period;
		}
		if (laps < 2) continue;
		// A cycle made only of pollers is not a loop; try a longer period.
		if (history.slice(-period).every(call => isPollerTool(call.tool))) continue;
		return [period, laps];
	}
}

const repeatSubject = (elements: RepeatCall[], ran: number) => {
	const tools = elements.map(call => `\`${call.tool}\``);
	return elements.length === 1 ? `${tools[0]} ran ${ran} times in a row with identical arguments` : `the same cycle of ${elements.length} calls (${tools.join(", ")}) ran ${ran} calls in a row with identical arguments`;
};
const repeatBlockReason = (engaged: RepeatEngaged) =>
	`orchestrator-guard repeat guard: ${repeatSubject(engaged.elements, engaged.ran)}${engaged.compared ? ", and every one returned the same result" : ""}. Running it again will not produce anything new. Change the arguments or the approach (read the file directly, list what exists, use a different tool), or stop and report what blocks you. If you are waiting on something that changes, do other work between checks.`;
const repeatStopReason = (engaged: RepeatEngaged, blocked: number) =>
	`[ask] orchestrator-guard repeat guard: ${repeatSubject(engaged.elements, engaged.ran)}, and ${blocked} further attempts were blocked. Stop now and do not retry it: report the loop to the owner in your final answer (the call, what you were trying to achieve, what you tried instead) and wait for direction.`;

export function installGuard(pi: any, config: GuardConfig = loadGuardConfig()): void {
	if (!config.enabled) return;
	const installed = config.defer_to_installed ? installedOriginal(pi, "orchestrator-guard") : undefined;
	if (installed) {
		logOnce(pi, "guard-deferred", `dotz guard: ${installed} is installed, so dotz's copy of the worker guard stays off (every hook would run twice). Set guard.defer_to_installed to false in <DOTZ_DIR>/config.json to run it anyway.`);
		return;
	}
	G = config;
	host = pi;
	let state: ProjectState | undefined;
	let budgetOkUntil = 0;
	let fableOkUntil = 0;
	let sessionFlagged = false;
	const overrideMs = config.override_minutes * 60_000;
	// Owner rule, off by default: models in `expensive_models` run only after the owner asked. A dotz lane launched with owner_asked_for_fable gets DOTZ_OWNER_ASKED_FABLE=1; otherwise the user runs /fable-ok.
	const gateExpensive = config.ask_before_expensive && config.expensive_models.length > 0;
	// The gateway's grants (<DOTZ_DIR>/state/expensive-grants.json) count while `until` lies ahead; the key is this process's conversation.
	const fableOk = () => !gateExpensive || process.env.DOTZ_OWNER_ASKED_FABLE === "1" || Date.now() < fableOkUntil || grantedHere();
	const fableReason = (what: string, found: string) => `orchestrator-guard: ${what} uses an expensive model (${found}). Models listed in guard.expensive_models run only when the owner explicitly asked for it. Use the default worker model. If the owner asked for it, get a grant on that message (POST /api/expensive-grant {conversation, owner_message: <mid>}) or have them type /fable-ok (${config.override_minutes} min).`;
	const projectState = (ctx: any) => (state ??= loadState(String(ctx?.cwd ?? process.cwd())));
	const refreshApplied = (current: ProjectState, extraDirs: string[] = [], history = false): boolean => {
		let changed = false;
		const dirs = [...new Set([...extraDirs, current.cwd])];
		const cache = new Map<string, string[]>();
		for (const worker of Object.values(current.workers)) {
			if (!worker.patch || worker.applied || !existsSync(worker.patch)) continue;
			if (patchIsApplied(dirs, worker.patch, cache) || (history && patchLanded(dirs, worker.patch))) {
				worker.applied = true;
				changed = true;
			}
		}
		return changed;
	};
	const injectState = (ctx: any, previousSession: boolean) => {
		const current = projectState(ctx);
		if (refreshApplied(current, [], true)) saveState(current);
		const state = stateSummary(current, previousSession), summary = [callRules(config), state].filter(Boolean).join("\n");
		debug({ phase: "state-inject", previousSession, summary });
		pi.sendMessage({ customType: "orchestrator-state", content: summary, display: Boolean(state) }, { deliverAs: "nextTurn" });
		// A worker still "running" from an earlier omp process died with it: report it once above, then settle it so it
		// does not reappear as an open worker at every later session start.
		if (previousSession) {
			let lost = false;
			for (const worker of Object.values(current.workers)) {
				if (worker.status === "running") lost = Boolean((worker.status = "lost"));
			}
			if (lost) saveState(current);
		}
	};

	pi.on("session_start", (_event: any, ctx: any) => {
		if (!isMain(ctx)) return;
		state = undefined;
		injectState(ctx, true);
	});

	const repeatRows = new Map<string, RepeatRow>();
	const isolationUnavailable = new Set<string>();
	const repeatKey = (ctx: any) => String(ctx?.sessionManager?.getSessionId?.() ?? ctx?.agent?.id ?? "");

	pi.on("tool_result", (event: any, ctx: any) => {
		// Fill in what the call returned, so an identical call whose output changes (a poll) is not counted as a loop. Before the main-only return: workers are guarded too.
		try {
			const id = String(event?.toolCallId ?? "");
			const call = [...(repeatRows.get(repeatKey(ctx))?.calls ?? [])].reverse().find(c => (id ? c.id === id : !c.result && c.tool === event?.toolName && c.args === repeatArgsDigest(c.tool, event?.input)));
			if (call) call.result = repeatResultDigest(event?.content);
		} catch (error) {
			debug({ phase: "repeat-result-error", message: String(error) });
		}
		if (!isMain(ctx)) return;
		const current = projectState(ctx);
		const text = (event.content ?? []).map((b: { text?: string }) => b?.text ?? "").join("\n");
		// A `git apply` that went in (or a --3way apply whose conflicts are then resolved by hand) settles the patches it
		// names at once; the reverse check below cannot recognise a patch that was edited while it was merged. Variables
		// (`P=x.patch; git apply $P`) are expanded first, and `git -C <dir> apply` counts like plain `git apply`.
		const command = expandShellVars(shellText(event.input));
		const shell = event.toolName === "bash" || event.toolName === "eval";
		if (shell && GIT_APPLY_RE.test(command) && (!event.isError || /--3way/.test(command) && /with conflicts/i.test(text))) {
			const named = [...command.matchAll(GIT_APPLY_NAMED)].map(m => basename(m[1].replace(/^['"]|['"]$/g, "")));
			let marked = false;
			for (const worker of Object.values(current.workers)) {
				if (worker.patch && !worker.applied && named.includes(basename(worker.patch))) marked = worker.applied = true;
			}
			if (marked) saveState(current);
		}
		if (event.toolName === "task" && /isolation_unavailable/.test(text)) isolationUnavailable.add(current.cwd);
		if (event?.isError) return;
		if (event.toolName === "task") {
			const fromDetails = (event.details?.progress ?? []).map((p: { id?: string; agentId?: string }) => p?.id ?? p?.agentId).filter(Boolean);
			// OmO: details.task_id (one worker) or task_id fields of a batch's details; "Started task … (st_…, running)" in the text.
			const omo = [...new Set([...JSON.stringify(event.details ?? {}).matchAll(/"task_id":"(st_\w+)"/g), ...text.matchAll(/\((st_\w+), running\)/g)].map(m => m[1]))];
			const ids: string[] = fromDetails.length
				? fromDetails
				: omo.length
					? omo
					: [...new Set([...text.matchAll(/Spawned agent `([^`]+)`/g), ...text.matchAll(/^\s*- `([^`]+)` \(job `[^`]+`\)/gm)].map(m => m[1]))];
			const items: { task?: string; prompt?: string }[] = Array.isArray(event.input?.tasks) ? event.input.tasks : [event.input ?? {}];
			ids.forEach((id, i) => {
				if (current.settled) delete current.settled[id];
				current.workers[id] ??= { brief: briefLabel(items[i]?.task ?? items[i]?.prompt), spawnedAt: Date.now(), status: "running" };
			});
			debug({ phase: "state-spawn", ids });
		}
		if (settleFromText(current, text) || event.toolName === "task") saveState(current);
		if (shell && GIT_APPLY_RE.test(command) && refreshApplied(current, applyDirsOf(command, resolve(current.cwd, String(event.input?.cwd ?? ""))))) {
			debug({ phase: "state-applied" });
			saveState(current);
		}
	});

	if (config.budget_gate) {
		pi.registerCommand("budget-ok", {
			description: `Allow worker spawns for ${config.override_minutes} minutes despite a low Anthropic quota (guard budget gate).`,
			handler: async (_args: unknown, ctx: any) => {
				budgetOkUntil = Date.now() + overrideMs;
				ctx.ui.notify(`orchestrator-guard: worker spawns allowed for ${config.override_minutes} minutes despite low quota.`, "info");
			},
		});
	}

	if (gateExpensive) {
		pi.registerCommand("fable-ok", {
			description: `Allow expensive-model workers (guard.expensive_models) for ${config.override_minutes} minutes (guard expensive-model gate).`,
			handler: async (_args: unknown, ctx: any) => {
				fableOkUntil = Date.now() + overrideMs;
				ctx.ui.notify(`orchestrator-guard: expensive-model workers allowed for ${config.override_minutes} minutes.`, "info");
			},
		});

		// Dispatch-time check: sees the model the child would really use, whether it came from modelRoles, agentModelOverrides or the call.
		pi.on("before_subagent_spawn", (event: any) => {
			const found = fableOk() ? undefined : expensiveModel(event?.patterns);
			debug({ phase: "spawn-model", agent: event?.agent, patterns: event?.patterns, found });
			if (found) return { block: true, reason: fableReason(`worker ${event?.agent ?? "task"}`, found) };
		});
	}

	pi.registerCommand("compact-switch", {
		description: "Compact on the current model first (its cache is still warm), then switch: /compact-switch provider/model[:thinking]",
		handler: async (args: unknown, ctx: any) => {
			const selector = String(args ?? "").trim();
			const parts = selector.match(/^([^/\s]+)\/([^:\s]+)(?::(\w+))?$/);
			debug({ phase: "switch-start", selector, parsed: Boolean(parts), tokens: contextTokens(ctx), usage: ctx?.getContextUsage?.() });
			if (!parts) return ctx.ui.notify("usage: /compact-switch provider/model[:thinking], e.g. /compact-switch anthropic/claude-opus-5-5:medium", "warning");
			const model = ctx.modelRegistry?.find(parts[1], parts[2]);
			if (!model) return ctx.ui.notify(`orchestrator-guard: model ${parts[1]}/${parts[2]} not found`, "warning");
			const tokens = contextTokens(ctx);
			try {
				if (tokens >= config.switch_compact_min_tokens) {
					try {
						await ctx.compact({ suppressContinuation: true });
					} catch (error) {
						if (!/Nothing to compact|NoOp/i.test(`${(error as Error)?.name} ${(error as Error)?.message}`)) throw error;
						debug({ phase: "switch-compact-noop" });
					}
				}
				if (!(await pi.setModel(model))) return ctx.ui.notify(`orchestrator-guard: could not switch to ${selector}`, "warning");
				if (parts[3]) pi.setThinkingLevel(parts[3]);
				debug({ phase: "switch", selector, tokensBefore: tokens, tokensAfter: contextTokens(ctx) });
				ctx.ui.notify(`orchestrator-guard: switched to ${selector} (context ${Math.round(tokens / 1000)}K -> ${Math.round(contextTokens(ctx) / 1000)}K)`, "info");
			} catch (error) {
				debug({ phase: "switch-error", message: String(error) });
				ctx.ui.notify(`orchestrator-guard: switch aborted, model unchanged (${error instanceof Error ? error.message : String(error)})`, "warning");
			}
		},
	});
	const reviewedPatches = new Set<string>(), cellVars = new Map<string, string>();
	let compactions = 0;

	pi.on("session_compact", (_event: any, ctx: any) => {
		if (isMain(ctx)) return injectState(ctx, false);
		if (ctx?.agent?.kind !== "sub") return;
		compactions++;
		debug({ phase: "sub-compact", agent: ctx.agent.id, compactions });
		if (compactions === SUB_COMPACT_WRAP_UP) pi.sendUserMessage(WRAP_UP_STEER, { deliverAs: "steer" });
		else if (compactions === SUB_COMPACT_STOP) pi.sendUserMessage(STOP_REASON, { deliverAs: "steer" });
	});

	pi.on("before_provider_request", (event: any, ctx: any) => {
		if (isMain(ctx) && !sessionFlagged && !fableOk()) {
			const effort = String(pi.getThinkingLevel?.() ?? "");
			const found = expensiveModel([event?.payload?.model, /^(max|xhigh)$/i.test(effort) ? `:${effort}` : undefined]);
			if (found && !ownerPickedHere(event?.payload?.model, effort, config)) {
				sessionFlagged = true;
				debug({ phase: "session-expensive", found });
				ctx.ui?.notify?.(`orchestrator-guard: this session runs on an expensive model (${found}). Fable and max/xhigh effort are for explicit owner requests only. Do not change the model yourself: ask the owner whether it should stay (/fable-ok silences this).`, "warning");
			}
		}
		if (ctx?.agent?.kind !== "sub" || !event?.payload) return;
		const payload = structuredClone(event.payload);
		const dropped = dropLongTtl(payload);
		debug({ phase: "sub-cache", agent: ctx.agent.id, dropped });
		return dropped ? payload : undefined;
	});

	// Evaluated after every other block in the tool_call handler so existing blocks win. Blocked calls are never recorded (the history freezes, so ignored blocks are counted instead of laps). Any failure here allows the call: a guard bug must not veto work.
	const repeatGuard = async (event: any, ctx: any): Promise<{ block: true; reason: string } | undefined> => {
		try {
			const tool = String(event?.toolName ?? "");
			const args = repeatArgsDigest(tool, event?.input);
			if (!args) return;
			const now = Date.now();
			const key = repeatKey(ctx);
			let row = repeatRows.get(key);
			// Past the window the session was idle (or the id was reused): a streak that old no longer describes a loop.
			if (!row || now - row.seen > REPEAT_WINDOW_MS) row = { calls: [], blocked: 0, seen: now };
			row.seen = now;
			repeatRows.delete(key);
			repeatRows.set(key, row);
			if (repeatRows.size > REPEAT_MAX_SESSIONS) repeatRows.delete(repeatRows.keys().next().value as string);
			const cand: RepeatCall = { tool, args, result: "", id: String(event?.toolCallId ?? "") };
			const tentative = [...row.calls, cand];
			const cycle = detectCycle(tentative);
			let engaged = row.engaged;
			if (cycle && cycle[1] >= requiredLaps(cycle[0])) {
				const [period, laps] = cycle;
				const elements = tentative.slice(-period);
				const sig = elements.map(c => `${c.tool}\0${c.args}`).sort().join("\n");
				if (engaged?.sig !== sig) row.blocked = 0;
				engaged = row.engaged = { sig, elements, ran: period * laps - 1, compared: tentative.slice(-period * laps, -1).every(c => c.result) };
			} else if (!engaged?.elements.some(c => c.tool === tool && c.args === args)) {
				// Not a loop call: it runs, joins the history and leaves no engaged cycle behind it. Another element of a blocked cycle stays blocked: the history did not advance, so it is the same loop one step along.
				row.calls = tentative.slice(-REPEAT_HISTORY);
				row.engaged = undefined;
				row.blocked = 0;
				return;
			}
			if (!engaged) return;
			const ignored = row.blocked++;
			debug({ phase: "repeat-block", agent: ctx?.agent?.id, tool, ignored, ran: engaged.ran });
			if (ignored < REPEAT_ESCALATION_ATTEMPTS) return { block: true, reason: repeatBlockReason(engaged) };
			// dotz gateway sessions run `omp --mode rpc`: hasUI is true there but nobody answers extension UI requests, so a
			// confirm would hang the call forever. They (and any session without a UI) get the stop block instead.
			const headless = !ctx?.hasUI || typeof ctx.ui?.confirm !== "function" || !!process.env.DOTZ_LANE || process.env.DOTZ_ORCHESTRATOR === "1";
			if (headless) return { block: true, reason: repeatStopReason(engaged, ignored) };
			// A dialog nobody answers within a minute counts as a deny.
			const allowed = await ctx.ui.confirm("Repeat guard", `${repeatSubject(engaged.elements, engaged.ran)}, and ${ignored} further attempts were blocked. Allow this call once more? Denying ends the repetition.`, { timeout: 60_000 });
			if (allowed !== true) return { block: true, reason: `orchestrator-guard repeat guard: the owner denied (or did not answer) this repeated call. ${repeatBlockReason(engaged)}` };
			// A person said go on: they get a fresh budget of laps rather than a prompt on every call.
			row.calls = [cand];
			row.engaged = undefined;
			row.blocked = 0;
		} catch (error) {
			debug({ phase: "repeat-error", message: String(error) });
		}
	};

	const guardToolCall = async (event: any, ctx: any): Promise<any> => {
		const tool = String(event?.toolName ?? "");
		if (ctx?.agent?.kind === "sub" && compactions >= SUB_COMPACT_STOP) {
			debug({ phase: "sub-stop-block", agent: ctx.agent.id, tool });
			return { block: true, reason: STOP_REASON };
		}
		const broad = broadSearchProblem(tool, event?.input);
		if (broad) {
			debug({ phase: "broad-search-block", agent: ctx?.agent?.id, tool });
			return { block: true, reason: broad };
		}
		if (ctx?.agent?.kind === "sub" && tool === "bash") {
			const kind = externalAction(expandShellVars(String(event?.input?.command ?? "")));
			if (kind) {
				debug({ phase: "sub-external-block", agent: ctx.agent.id, kind });
				return { block: true, reason: `orchestrator-guard: workers do not run external-impact commands (${kind}). Finish the rest of the task, and list the exact command under "External actions needed" in your final answer; the orchestrator decides whether to run it.` };
			}
		}
		const laneMerge = tool === "bash" ? laneMergeBlock(expandShellVars(String(event?.input?.command ?? ""))) : undefined;
		if (laneMerge) return { block: true, reason: laneMerge };
		const shared = sharedWriteBlock(tool, event?.input, dataDir(), process.env.DOTZ_CONV, process.env.DOTZ_LANE, ctx?.cwd);
		if (shared) {
			debug({ phase: "shared-write-block", tool });
			return { block: true, reason: shared };
		}
		const limitStop = limitStopProblem(tool, event?.input);
		if (limitStop) return { block: true, reason: limitStop };
		if (!isMain(ctx)) return;
		// A message to a finished worker revives it with its whole history, and it tends to redo its earlier steps.
		const target = /^agent:\/\/([^/?#]+)/.exec(String(event?.input?.path ?? ""))?.[1];
		if (tool === "write" && target && target !== "all") {
			const worker = projectState(ctx).workers[target];
			if (worker && worker.status !== "running") {
				debug({ phase: "finished-worker-message-block", target, status: worker.status });
				return { block: true, reason: `orchestrator-guard: worker ${target} already ${worker.status}; a message would revive it and it may redo its earlier work. Spawn a new worker for the follow-up (task) with only the new step.` };
			}
		}
		if (tool === "task") {
			const taskCwd = String(ctx?.cwd ?? process.cwd());
			// A repo OmO cannot snapshot for isolation (isolation_unavailable, e.g. over its size budget) gets in-place workers.
			const isolate = shouldIsolate(gitTop(taskCwd), isolationUnavailable.has(taskCwd));
			const roots = isolate ? checkoutRoots(taskCwd) : [];
			const verdict = isOmoTaskInput(event.input) ? checkOmoTaskInput(event.input, isolate, roots) : checkTaskInput(event.input, isolate, roots);
			debug({ phase: "task", verdict });
			if ("reason" in verdict) return { block: true, reason: verdict.reason };
			addProjectFooter(verdict.input, process.env.DOTZ_CONV, taskCwd);
			const gated = gateExpensive && !fableOk();
			if (gated && swapExpensiveModels(verdict.input, config)) debug({ phase: "task-model-swap", worker: workerPin() });
			const wanted = process.env.DOTZ_ORCHESTRATOR === "1" && !process.env.DOTZ_LANE && isOmoTaskInput(event.input) ? (ownWorkerPin(process.env.DOTZ_WORKER_PIN_FILE) ?? livePin(ctx?.model, pi.getThinkingLevel?.())) : undefined;
			const pin = wanted && gated && expensiveModel(wanted) ? workerPin() : wanted;
			if (pin) {
				pinOmoTaskModel(event.input, pin, model => gateExpensive && !gated && Boolean(expensiveModel(model)));
				debug({ phase: "task-model-pin", pin });
			}
			// Last net: only a worker model that is itself on the expensive list gets here.
			const dear = gated ? expensiveTaskModel(verdict.input) : undefined;
			if (dear) return { block: true, reason: fableReason("this task call", dear) };
			// The quota comes from `omp usage`, i.e. omp's own login; an OmO process may run on another account, so the gate
			// would block on a quota that is not the one it spends. No gate on OmO until OmO's own usage can be read.
			if (config.budget_gate && process.env.DOTZ_RUNTIME !== "omo" && Date.now() >= budgetOkUntil) {
				const workers = Array.isArray(event.input?.tasks) ? event.input.tasks.length : 1;
				const limits = await anthropicLimits();
				const est = estimateFrom(event.input, config);
				const problem = limits ? budgetProblem(limits, workers, est) : undefined;
				debug({ phase: "budget", workers, est, problem, haveLimits: Boolean(limits) });
				if (problem)
					return { block: true, reason: `orchestrator-guard budget gate: ${problem}. Stop and ask the user, showing the 5h and 7d remaining %, whether to run now, wait for the reset, or shrink the job: "run now" -> they run /budget-ok (${config.override_minutes} min); "shrink" -> fewer workers or a smaller "Estimate: N%" line.` };
			}
			return { input: verdict.input };
		}
		// One key per patch file however it was named: quotes, a read selector (x.patch:1-200), ~/ or a relative path.
		const patchKey = (raw: string, base = ".") => {
			const p = raw.replace(/^['"]|['"]$/g, "").replace(/(\.patch):.*$/, "$1");
			return p.startsWith("~/") ? join(homedir(), p.slice(2)) : resolve(base, p);
		};
		const path = String(event?.input?.path ?? event?.input?.file_path ?? "");
		if (tool === "read" && /\.patch(:|$)/.test(path)) reviewedPatches.add(patchKey(path));
		// OmO has no bash tool: shell commands run inside `eval` cells (tool.bash, Bun.$, subprocess), and read() reads a file.
		if (tool === "bash" || tool === "eval") {
			const command = expandCellVars(shellText(event?.input), cellVars, tool === "eval");
			const base = String(event?.input?.cwd ?? ".");
			if (tool === "eval") for (const shown of readPaths(command, cellVars)) if (/\.patch$/.test(shown)) reviewedPatches.add(patchKey(shown, base));
			for (const shown of command.matchAll(/\b(?:cat|bat|less|head|diff)\b[^|;&]*?(\S+\.patch)/g)) reviewedPatches.add(patchKey(shown[1], base));
			const unreviewed = [...command.matchAll(new RegExp(`${GIT_APPLY}(?![^|;&]*--(?:stat|check))[^|;&]*?(\\S+\\.patch)`, "g"))]
				.map(match => match[1])
				.filter(patch => !reviewedPatches.has(patchKey(patch, base)));
			if (unreviewed.length) {
				debug({ phase: "apply-block", unreviewed });
				return { block: true, reason: `orchestrator-guard: review before apply. Read ${unreviewed.join(", ")} first with the read tool on that same path (or read('<that path>') in an eval cell; a path built from a variable counts when the variable is a plain string set in this session), check it matches the brief, then apply. For large or risky patches spawn the reviewer agent.` };
			}
		}
	};

	pi.on("tool_call", async (event: any, ctx: any) => {
		const verdict = await guardToolCall(event, ctx);
		if (verdict?.block) return verdict;
		return (await repeatGuard(event, ctx)) ?? verdict;
	});

	pi.on("context", (event: any, ctx: any) => {
		if (!isMain(ctx) || !Array.isArray(event?.messages)) return;
		const current = projectState(ctx);
		let settled = false;
		for (const m of event.messages) {
			const text = typeof m?.content === "string" ? m.content : Array.isArray(m?.content) ? m.content.map((b: any) => b?.text ?? "").join("\n") : "";
			if ((text.includes("<task-result") || text.includes("task completion")) && settleFromText(current, text)) settled = true;
		}
		if (settled) saveState(current);
		let trimmed = 0;
		const trim = (text: string) => {
			const next = trimWaitOutput(text);
			if (next !== text) trimmed++;
			return next;
		};
		const messages = event.messages.map((message: any) => {
			if (typeof message?.content === "string") return { ...message, content: trim(message.content) };
			if (!Array.isArray(message?.content)) return message;
			return {
				...message,
				content: message.content.map((block: any) =>
					block?.type === "text" && typeof block.text === "string" ? { ...block, text: trim(block.text) } : block,
				),
			};
		});
		if (trimmed) debug({ phase: "context-trim", trimmed });
		return trimmed ? { messages } : undefined;
	});
}
