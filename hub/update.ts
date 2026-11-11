// Nightly update of the harness dotz runs its agents on (the earlier secretary's nightly.ts, extended). At omp_update.at ("04:20") the gateway
// checks each harness in use: omp via `omp update --check`; omo (OmO on senpi) by comparing `omo --version` with the omo-ai
// version npm calls latest (the senpi engine is pinned by omo-ai and moves with it, so one install covers both).
// omp_update.mode (the key keeps its old name): "install" (default) installs a newer version, checks that the harness really
// reports it, then asks the restart gate for one restart once everything is idle; "check" posts one worklog line per new
// version and never installs; "off" does nothing. A failed install keeps the old version and goes to the alert conversation.
// `bun hub/update.ts --check-now` runs the check path once per harness in use and prints the result without posting.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { cfg, DATA_DIR, DEFAULTS, log, writeAtomic } from "./config.ts";
import { issueBlock } from "./choices.ts";
import { activeHarness } from "./runtime/index.ts";
import { BUN_GLOBAL_OMO, OMO } from "./runtime/omo-hosts.ts";
import { telemetryOff } from "./runtime/omo.ts";
import { trackTimer } from "./shutdown.ts";
import { HARNESS_ASK_TAIL, HARNESS_BLOCKED_TAIL, HARNESS_FAILED_MID, HARNESS_RESTART_TAIL } from "./worklog-kind.ts";

export type Mode = "check" | "install" | "off";
export type Check =
	| { status: "current"; current: string }
	| { status: "new"; current: string; latest: string }
	// omp is installed and kept up to date by another program (Tern); `omp update` prints that and no versions.
	| { status: "managed"; current: string; by: string }
	| { status: "error"; current: string; detail: string };
// Runs a whole command line (the binary is the first element).
export type Run = (cmd: string[], timeoutMs: number) => Promise<{ code: number; out: string }>;
export type Latest = () => Promise<string | undefined>;
// The real path of a binary on PATH, or undefined when it is not there.
export type Locate = (bin: string) => string | undefined;
type Tools = { run: Run; latest: Latest; locate: Locate };
type Out = { code: number; out: string };

const ANSI = /\x1b\[[0-9;]*m/g;
const VERSION = /(\d+\.\d+\.\d+[^\s)]*)/;

const defaultLocate: Locate = bin => {
	const p = Bun.which(bin);
	try {
		return p ? realpathSync(p) : undefined;
	} catch {
		return p;
	}
};

const defaultRun: Run = async (cmd, timeoutMs) => {
	const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore", timeout: timeoutMs });
	const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
	return { code, out: `${out}\n${err}`.replace(ANSI, "").trim() };
};

// The version npm calls latest for omo-ai, or undefined when the registry does not answer in time.
const npmLatest: Latest = async () => {
	try {
		const r = await fetch("https://registry.npmjs.org/omo-ai/latest", { signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" } });
		const v: unknown = r.ok ? (await r.json() as { version?: unknown }).version : undefined;
		return typeof v === "string" && VERSION.test(v) ? v : undefined;
	} catch {
		return undefined;
	}
};

// `omp --version` prints "omp/18.12.1", `omo --version` "omo 5.1.38 (engine: senpi 2026.10.19)".
const versionOf = (bin: string) => async ({ run }: Tools): Promise<string> => {
	const r = await run([bin, "--version"], 30_000).catch(() => undefined);
	return r?.out.match(VERSION)?.[1] ?? "?";
};

const nums = (v: string) => v.split(/[.-]/).slice(0, 3).map(n => parseInt(n, 10) || 0);
export function newer(a: string, b: string): boolean {
	const [x, y] = [nums(a), nums(b)];
	for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
	return false;
}

// Output shapes (omp 18.12): "Current version: X" then "New version available: Y" or "<mark> Already up to date";
// "<name> is installed and kept up to date by <manager>; update it from <manager>." when another program owns the install.
async function checkOmp(t: Tools): Promise<Check> {
	const r = await t.run(["omp", "update", "--check"], 120_000).catch(e => ({ code: -1, out: String(e) }));
	const current = r.out.match(/Current version:\s*(\S+)/)?.[1] ?? (await versionOf("omp")(t));
	const by = r.out.match(/kept up to date by (\S+?);/)?.[1];
	if (by) return { status: "managed", current, by };
	const latest = r.out.match(/New version available:\s*(\S+)/)?.[1];
	if (latest) return { status: "new", current, latest };
	if (r.code === 0 && /Already up to date/i.test(r.out)) return { status: "current", current };
	return { status: "error", current, detail: r.out.split("\n").pop()?.slice(0, 200) || `exit ${r.code}` };
}

async function checkOmo(t: Tools): Promise<Check> {
	const current = await versionOf(OMO)(t);
	if (current === "?") return { status: "error", current, detail: `${OMO} --version failed` };
	const latest = await t.latest();
	if (!latest) return { status: "error", current, detail: "npm 레지스트리에서 최신 버전을 가져오지 못했어요" };
	return newer(latest, current) ? { status: "new", current, latest } : { status: "current", current };
}

type Spec = {
	label: string;
	check: (t: Tools) => Promise<Check>;
	version: (t: Tools) => Promise<string>;
	install: (t: Tools) => Promise<Out>;
	// Did the install leave the harness on the new version?
	landed: (now: string, c: { current: string; latest: string }) => boolean;
	// Puts the previous version back after an install that did not verify.
	rollback?: (t: Tools, version: string) => Promise<Out>;
	// Why `install` cannot reach the copy on PATH (undefined: it can).
	blocked?: (t: Tools) => string | undefined;
};
const bunAdd = (pkg: string, t: Tools) => t.run([process.execPath, "add", "-g", pkg], 10 * 60_000).catch(e => ({ code: -1, out: String(e) }));
const SPECS: Record<string, Spec> = {
	omp: {
		label: "omp",
		check: checkOmp,
		version: versionOf("omp"),
		install: t => t.run(["omp", "update"], 15 * 60_000).catch(e => ({ code: -1, out: String(e) })),
		landed: (now, c) => now === c.latest,
	},
	omo: {
		label: "작업 프로그램",
		check: checkOmo,
		version: versionOf(OMO),
		install: t => bunAdd("omo-ai@latest", t),
		landed: (now, c) => newer(now, c.current),
		rollback: (t, version) => bunAdd(`omo-ai@${version}`, t),
		// `bun add -g` only moves bun's global copy; an `omo` on PATH from anywhere else (a project's node_modules) stays put.
		blocked: t => {
			const real = t.locate(OMO);
			return real && BUN_GLOBAL_OMO.test(real) ? undefined : `${OMO}가 bun 전역 설치가 아니라서(${real ?? "경로 없음"}) 여기서 올리지 않아요`;
		},
	},
};

export const describe = (c: Check, label = "omp"): string =>
	c.status === "new" ? `${label} 새 버전이 있어요 (${c.current} → ${c.latest}).`
		: c.status === "current" ? `${label}는 최신이에요 (${c.current}).`
		: c.status === "managed" ? `${label} ${c.current}는 ${c.by}가 관리해서 업데이트 확인으로는 새 버전을 알 수 없어요.`
		: `${label} 업데이트를 확인하지 못했어요 (지금 ${c.current}): ${c.detail}`;

type State = { notified?: string };
const readState = (file: string): State => {
	try {
		return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
	} catch {
		return {};
	}
};

// `post`: the one-line worklog entry; `alert`: an issue (a failed install) with its choice block, which goes to the alert conversation.
// `harnesses`: runtime ids to update (default: the ones dotz runs on); `restart` is called at most once per pass.
type Deps = { mode: Mode; post: (text: string) => void; alert?: (text: string) => void; restart: () => string; run?: Run; latest?: Latest; locate?: Locate; harnesses?: string[]; stateDir?: string };

// One harness: the worklog line it posted, if any, and whether it installed something that needs a restart.
async function updateOne(id: string, spec: Spec, { mode, post, alert = post, run = defaultRun, latest = npmLatest, locate = defaultLocate, stateDir = DATA_DIR }: Deps): Promise<{ line?: string; installed?: boolean }> {
	const t = { run, latest, locate };
	const c = await spec.check(t);
	if (c.status === "error") log(`${id} update: ${describe(c, spec.label)}`);
	if (c.status !== "new") return {};
	const blocked = mode === "install" ? spec.blocked?.(t) : undefined;
	if (mode === "check" || blocked) {
		const stateFile = join(stateDir, `${id}-update.json`);
		if (readState(stateFile).notified === c.latest) return {};
		const line = blocked ? `${describe(c, spec.label)} ${blocked}${HARNESS_BLOCKED_TAIL}` : `${describe(c, spec.label)}${HARNESS_ASK_TAIL}`;
		if (blocked) log(`${id} update: ${line}`);
		writeAtomic(stateFile, JSON.stringify({ notified: c.latest }));
		post(line);
		return { line };
	}
	const u = await spec.install(t);
	const now = await spec.version(t);
	if (u.code !== 0 || !spec.landed(now, c)) {
		// A half-done install must not leave the harness on a version that does not verify.
		const back = now !== c.current && spec.rollback ? await spec.rollback(t, c.current) : undefined;
		const kept = back ? `${back.code === 0 ? "이전 버전으로 되돌렸어요" : "이전 버전으로 되돌리지 못했어요"}(${await spec.version(t)})` : `지금 ${now}`;
		const line = `${spec.label} ${c.current} → ${c.latest}${HARNESS_FAILED_MID}${kept}): ${u.out.split("\n").pop()?.slice(0, 160) || `exit ${u.code}`}`;
		log(`${id} update: ${line}`);
		alert(`${line}\n${issueBlock("업데이트를 어떻게 할까요?", [{ name: "다시 설치해 봐요", result: "지금 한 번 더 설치하고 결과를 알려드려요." }, { name: "다음 점검까지 둬요", result: "내일 새벽 점검 때 다시 시도해요." }])}`);
		return { line };
	}
	const line = `${spec.label} ${c.current} → ${now}${HARNESS_RESTART_TAIL}`;
	log(`${id} update: ${line}`);
	for (const l of telemetryOff()) log(l);
	post(line);
	return { line, installed: true };
}

// One pass of the nightly job over every harness in use. Several installs share a single restart request, and the restart
// gate joins it to any other restart already waiting (self-update applied by the owner). Returns the lines it posted.
export async function runHarnessUpdate(deps: Deps): Promise<string[]> {
	if (deps.mode === "off") return [];
	const lines: string[] = [];
	let installed = false;
	for (const id of deps.harnesses ?? activeHarness().ids) {
		const spec = SPECS[id];
		if (!spec) continue;
		try {
			const r = await updateOne(id, spec, deps);
			if (r.line) lines.push(r.line);
			installed ||= Boolean(r.installed);
		} catch (e) {
			log(`${id} update failed: ${e}`);
		}
	}
	if (installed) log(`harness update: ${deps.restart()}`);
	return lines;
}

export function startHarnessUpdate(post: (text: string) => void, restart: () => string, alert: (text: string) => void = post): void {
	const raw: unknown = "omp_update" in cfg ? cfg.omp_update : undefined;
	const o = raw && typeof raw === "object" ? raw : {};
	const mode: Mode = "mode" in o && (o.mode === "check" || o.mode === "off") ? o.mode : "install";
	const at = "at" in o && typeof o.at === "string" ? o.at : DEFAULTS.update_at;
	if (mode === "off" || at === "off") return;
	const [h, m] = at.split(":").map(Number);
	const next = () => {
		const d = new Date();
		d.setHours(h, m, 0, 0);
		if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
		return d.getTime() - Date.now();
	};
	const run = async () => {
		await runHarnessUpdate({ mode, post, alert, restart }).catch(e => log(`harness update failed: ${e}`));
		trackTimer("harness update", setTimeout(run, next()));
	};
	trackTimer("harness update", setTimeout(run, next()));
}

if (import.meta.main) {
	if (process.argv.includes("--check-now")) {
		const t = { run: defaultRun, latest: npmLatest };
		const ids = activeHarness().ids.filter(id => SPECS[id]);
		for (const id of ids) console.log(describe(await SPECS[id].check(t), SPECS[id].label));
		if (!ids.length) console.log("업데이트를 확인할 작업 프로그램이 없어요.");
		process.exit(0);
	} else if (process.argv.includes("--telemetry-off")) {
		for (const l of telemetryOff()) console.log(l);
		process.exit(0);
	} else console.log("usage: bun hub/update.ts --check-now | --telemetry-off");
}
