// Dotz mode extension; behaviour depends on which session loads it:
// - gateway orchestrator (DOTZ_ORCHESTRATOR=1): dotz_send / dotz_lane / dotz_schedule / dotz_auth tools, recall after compaction.
// - lane session (DOTZ_LANE set): dotz_auth tool; 5-minute prompt cache (1h is for the orchestrator only; idle warming covers waits).
// - an OmO task worker of a lane or the orchestrator (DOTZ_LANE or DOTZ_ORCHESTRATOR=1, + OMO_SENPI_TASK_DEPTH): owner rules,
//   output caps, 5-minute cache, the token cap and the in-place compaction past a context threshold (task-cap.ts).
// - any other session: "<name>모드 켜" (dotz_mode tool, /dotz on) makes this terminal a thin client of the
//   gateway: typed input is forwarded to the gateway orchestrator instead of the local model, replies addressed to
//   the terminal are shown here. "<name>모드 꺼" or /dotz off stops forwarding. No terminal needs to stay open.
// - orchestrator, lanes and their workers: the thinking of finished turns kept across a compaction is left out of
//   later requests (compact-kept.ts).
// - orchestrator, lanes and their workers also get the deferred dotz_recall tool (recall-tool.ts), a search of the owner's past conversations.
// - every session above also gets the worker guard (guard.ts) and the /doctor, /handover, /token-audit commands (harness-tools.ts);
//   config key `guard`, see README. Each skips itself when the owner's original ~/.omp extension of that name is installed.

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative } from "node:path";
import { FIELD_TYPES } from "../hub/authfields.ts";
import { baseLanguage, detectLanguage, languageName } from "../hub/language.ts";
import { renderState } from "../hub/recall-parts.ts";
import { blockedByFeatures, featurePrompt } from "../hub/featuredirs.ts";
import { runWithReceipt, summarize } from "../hub/receipts.ts";
import { mergeGate, recordReview, Refusal, type Scope } from "../hub/mergegate.ts";
import { MAIL_TURN_MARK, mailTurnDeny, publicPostDeny, systemDeny } from "../hub/systemdeny.ts";
import { codeLockReason } from "../hub/codeguard.ts";
import { lockedCodeDir } from "../hub/selfupdate-local.ts";
import { loadPlugins, pluginDeny } from "../hub/plugins.ts";
import { createRefusals } from "./refusals.ts";
import { installMailTurn } from "./mail-turn.ts";
import { connectText, type ConnectView } from "./connect-view.ts";
import { staysInTerminal } from "./terminal-input.ts";
import { installCompactKept } from "./compact-kept.ts";
import { defaultDataDir, dryRun, hubPid, liveDataDir, liveWrite, throwawayReason } from "../hub/live-guard.ts";
import { dropLongTtl, installGuard } from "./guard.ts";
import { installHarnessTools } from "./harness-tools.ts";
import { installOutputCap } from "./output-cap.ts";
import { installOwnerValues } from "./owner-values.ts";
import { installTaskCap } from "./task-cap.ts";
import { installEffortBound } from "./effort-bound.ts";
import { installBgGuard } from "./bg-guard.ts";
import { jsonZod, params } from "./schema.ts";
import { secretIn } from "./peer-secrets.ts";
import { recallTool } from "./recall-tool.ts";
import { scheduleKindRefusal } from "./schedule-tool.ts";

// The claude.ai connectors (Gmail, Calendar, Drive, Docs) reach a fresh Claude Code process only after its first request, so
// its second request adds their 48 tools mid-conversation, and every such request lost the whole message cache: 126 of 126
// over 60K against 6 of 4394 without, 9.5M tokens rewritten in 24h (2026-11-03). No session has ever called them. Children
// read process.env at spawn; an owner-set value wins.
process.env.ENABLE_CLAUDEAI_MCP_SERVERS ??= "false";

const DATA = process.env.DOTZ_DIR ?? join(homedir(), ".dotz");
const PKG = join(import.meta.dir, "..");
const NAME = (() => {
	try {
		return String(JSON.parse(readFileSync(join(DATA, "config.json"), "utf8")).identity?.name ?? "").trim() || "dotz";
	} catch {
		return "dotz";
	}
})();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
const OFF = new RegExp(`^\\s*((${escape(NAME)}|dotz)\\s*모드\\s*(꺼|끄기|종료|off)|\\/dotz\\s+off)\\s*$`, "i");

export function blockedBy(command: string, rulesText: string): string | undefined {
	const section = rulesText.split(/^## Blocked commands\s*$/m)[1]?.split(/^## /m)[0] ?? "";
	for (const m of section.matchAll(/^- deny:\s*(.+)\s+\|\s+(.+?)\s*$/gm)) {
		try {
			if (new RegExp(m[1], "i").test(command)) return m[2].trim();
		} catch {
			continue;
		}
	}
	return undefined;
}

// The text a deny line is matched against: omp's `bash` command, or the code of OmO's `eval` cell (OmO has no bash
// tool; shell commands run inside eval as Bun.$ / subprocess / tool.bash, so the whole cell is checked).
export function shellText(event: any): string | undefined {
	const tool = String(event?.toolName ?? "");
	if (tool === "bash") return String(event?.input?.command ?? "");
	if (tool === "eval") return String(event?.input?.code ?? "");
	return undefined;
}

// A test, probe or hand-started copy (hub/live-guard.ts): read once per call, since hub.pid changes with the gateway.
const throwaway = () => throwawayReason({ hubPid: hubPid(DATA) });

function enforceRules(pi: any): void {
	let ready = false;
	const refusals = createRefusals();
	installMailTurn(pi, MAIL_TURN_MARK, mailTurnDeny);
	// Plugin load and reload lines (a failed reload keeps the old guard) go to hub.log, where the owner reads the gateway's.
	const pluginLog = (line: string) => {
		try {
			appendFileSync(join(DATA, "hub.log"), `${new Date().toISOString()} agent ${process.pid}: ${line}\n`);
		} catch (error) {
			console.error(`dotz: ${line} (hub.log not written: ${error})`);
		}
	};
	const loading = loadPlugins(DATA, pluginLog).then(() => void (ready = true));
	const check = (event: any) => {
		const copy = throwaway();
		const live = copy ? liveWrite(event, [...new Set([liveDataDir(DATA), defaultDataDir()].filter((d): d is string => Boolean(d)))]) : undefined;
		if (live) return { block: true, reason: `Blocked by dotz: this session is a throwaway (${copy}) and may not change the owner's live state: ${live}. Set DOTZ_ALLOW_LIVE=1 for a deliberate live run.` };
		// Orchestrator, lanes and their workers never change the code of an install that is not a developer checkout.
		if (process.env.DOTZ_ORCHESTRATOR === "1" || process.env.DOTZ_LANE) {
			const locked = lockedCodeDir(DATA);
			const refused = locked && codeLockReason(String(event?.toolName ?? ""), event?.input, process.cwd(), locked);
			if (refused) return { block: true, reason: refused };
		}
		const command = shellText(event);
		if (command === undefined) return;
		const system = systemDeny(command);
		if (system) return { block: true, reason: `Blocked by dotz: ${system}.` };
		const post = publicPostDeny(command, DATA, process.cwd());
		if (post) return { block: true, reason: refusals.say(`Blocked by dotz: ${post}.`) };
		const plugin = pluginDeny(command, DATA);
		if (plugin) return { block: true, reason: refusals.say(plugin) };
		const file = join(DATA, "RULES.md");
		const reason = existsSync(file) ? blockedBy(command, readFileSync(file, "utf8")) : undefined;
		if (reason) return { block: true, reason: refusals.say(`Blocked by the owner's rule (${file}): ${reason}. Do not work around it; report it if the task needs it.`) };
		const feature = blockedByFeatures(DATA, command);
		if (feature) return { block: true, reason: refusals.say(`Blocked by the owner's feature (${join(DATA, "features", feature.id, "feature.md")}): ${feature.reason}. Do not work around it; report it if the task needs it.`) };
	};
	pi.on("tool_call", (event: any) => (ready ? check(event) : loading.then(() => check(event))));
	pi.on("input", () => void refusals.reset());
	pi.on("agent_end", () => void refusals.reset());
}

function hub(): { url: string; token: string } | undefined {
	try {
		const cfg = JSON.parse(readFileSync(join(DATA, "config.json"), "utf8"));
		return { url: `http://127.0.0.1:${process.env.DOTZ_PORT ?? cfg.web?.port ?? 7420}`, token: readFileSync(join(DATA, "secrets", "hub-token"), "utf8").trim() };
	} catch {
		return undefined;
	}
}

async function call(path: string, init: RequestInit = {}): Promise<any> {
	const h = hub();
	if (!h) throw new Error("dotz is not set up yet: run `bun <plugin>/setup.ts`");
	const copy = (init.method ?? "GET") !== "GET" ? throwaway() : undefined;
	if (copy) return dryRun(path, init as { method?: string; body?: unknown }, copy);
	const r = await fetch(h.url + path, { ...init, headers: { "x-dotz-token": h.token, "Content-Type": "application/json", ...(init.headers ?? {}) } });
	const text = await r.text();
	const data = text ? JSON.parse(text) : {};
	if (!r.ok) throw Object.assign(new Error(data.error ?? data.reason ?? `${r.status}`), { status: r.status });
	return data;
}

type AuthParams = { site: string; kind: "secret" | "otp" | "approve" | "form"; fields?: string[]; form?: { type: string; label?: string; optional?: boolean; mask?: boolean }[]; remember?: boolean; purpose: string; target?: string; timeout_minutes?: number };

// Web-login credentials typed by the owner in the web app only (Discord carries a link button, never a value). The value goes only to the gateway: the
// secret kind lands in a 0600 file, the otp kind is fetched once with `take`; this tool never sees or returns a value.
function authTool(pi: any, lane?: string): void {
	const z = pi.zod;
	const where = lane ? `It is posted to this session's Discord channel (when Discord is set up) and shown in the web app.` : `target: chat (default), alert, lane:<name>, ch:<id>, th:<id>.`;
	pi.registerTool({
		name: "dotz_auth",
		label: "Dotz auth",
		description: `Ask the owner for a web-login credential or any personal or security data through the web app. ALWAYS use this for personal or security data (password, code, card, address, phone, ID or account number, birth date and the like): never ask for it, or accept it, in chat; if the owner pastes such data into chat anyway, do not repeat or store it, say it was not used and ask again through this tool. Ask the owner for a web-login credential: the gateway shows a form in the web app (always, so it works before Discord is connected, e.g. during the Discord bot setup itself) and, when Discord is set up, posts a message there whose button opens the web app; the owner types the value only in the web app (never in Discord or another messenger), and the value never enters the prompt, logs or chat. Use it when a login needs a password, an OTP code, or a push/FIDO approval, or when the account has no stored credentials. Asking through this tool is the owner's OK for the second factor (still trigger it only once, never retry). kind=secret {fields? [username,password] (default both; or any of username|password|code)}: stored as a JSON object {field: value} in a 0600 file under the secrets dir, whose path is returned. kind=form {form: [{type, label?, optional?, mask?}], remember?}: a personal-data form; type is one of ${FIELD_TYPES.join(", ")} (card_number is checked with Luhn, card_expiry as MM/YY, card_cvc, id_number and account_number are masked; 'other' needs a label; address2 is optional). Stored as a JSON object {type: value} (an 'other' field is keyed other_<label>) in a 0600 file whose path is returned together with the field names; you never get the values. remember=true (default false; the owner can change it in the form) keeps the file as secrets/<site> for reuse (read it before asking again); otherwise it is one-time under secrets/once: read it, use it, delete it right after, never copy a value into a prompt, brief, report, log or message. kind=otp: a one-time code you fetch once with the returned command. kind=approve: the owner confirms they approved the push/FIDO prompt on their device. site = a short key [a-z0-9._-] naming the service (the secrets file name). purpose = one line shown to the owner saying what it is for. ${where} timeout_minutes 1-30 (default 10). The call waits until the owner answers, cancels, or it times out; do the login step after it returns.`,
		parameters: z.object({
			site: z.string(),
			kind: z.enum(["secret", "otp", "approve", "form"]),
			fields: z.array(z.enum(["username", "password", "code"])).optional(),
			form: z.array(z.object({ type: z.enum(FIELD_TYPES), label: z.string().optional(), optional: z.boolean().optional(), mask: z.boolean().optional() })).optional(),
			remember: z.boolean().optional(),
			purpose: z.string(),
			...(lane ? {} : { target: z.string().optional() }),
			timeout_minutes: z.number().min(1).max(30).optional(),
		}),
		async execute(_id: string, p: AuthParams, signal?: AbortSignal) {
			const text = (t: string) => ({ content: [{ type: "text", text: t }] });
			const body: Record<string, unknown> = { site: p.site, kind: p.kind, purpose: p.purpose, target: lane ? `lane:${lane}` : (p.target ?? "chat"), ...(lane ? {} : { session: process.env.DOTZ_CONV ?? "main" }) };
			if (p.fields) body.fields = p.fields;
			if (p.form) body.form = p.form;
			if (p.remember !== undefined) body.remember = p.remember;
			if (p.timeout_minutes) body.timeout_minutes = p.timeout_minutes;
			const { id }: { id: string } = await call("/api/auth", { method: "POST", body: JSON.stringify(body), signal });
			const cancel = async () => {
				await call(`/api/auth/${id}`, { method: "DELETE" }).catch(() => undefined);
				return text(`Auth request for ${p.site} cancelled (this call was aborted).`);
			};
			for (;;) {
				if (signal?.aborted) return cancel();
				let r: { status: string; path?: string; take?: string; keys?: string[]; once?: boolean; error?: string };
				try {
					r = await call(`/api/auth/${id}?wait=50`, { signal });
				} catch (e: unknown) {
					if (signal?.aborted) return cancel();
					if (e instanceof Error && "status" in e && e.status === 404) return text(`Auth request for ${p.site} was lost (the gateway restarted). Ask again if it is still needed.`);
					throw e;
				}
				if (r.status === "pending") continue;
				if (r.status === "entered" && p.kind === "form") {
					return text(`The owner filled in the ${p.site} form. Stored encrypted at ${r.path}, a JSON object {${(r.keys ?? []).join(", ")}}${r.once ? "; one-time: the gateway removes it within an hour, you delete it right after use" : "; kept for reuse"}. Read it at run time with \`bun ${join(PKG, "hub", "secrets-cli.ts")} get ${relative(join(DATA, "secrets"), r.path ?? "")} [field]\` piped straight into what needs it; never put the values in prompts, briefs, reports, logs or chat.`);
				}
				if (r.status === "entered" && p.kind !== "otp") {
					const fields = (p.fields ?? (p.kind === "secret" ? ["username", "password"] : [])).join(", ");
					return text(`The owner entered the ${p.site} credentials. Stored encrypted at ${r.path}, a JSON object {${fields}}. Read it at run time with \`bun ${join(PKG, "hub", "secrets-cli.ts")} get ${relative(join(DATA, "secrets"), r.path ?? "")} [field]\` piped straight into what needs it; never put the values in prompts, briefs, reports or logs.`);
				}
				if (r.status === "entered") {
					const h = hub();
					return text(`The owner entered the ${p.site} OTP code. Take it once, within 5 minutes, and pipe it straight into the consumer without printing it: curl -s -H "x-dotz-token: $(cat ${join(DATA, "secrets", "hub-token")})" ${h?.url ?? ""}${r.take ?? `/api/auth/${id}/take`}`);
				}
				if (r.status === "failed") return text(`The owner answered the ${p.site} request, but the gateway could not store it (${r.error ?? "store failed"}). Nothing was saved; tell the owner, and ask again once that is fixed.`);
				return text(`Auth request for ${p.site}: ${r.status}.`);
			}
		},
	});
}

async function ensureGateway(): Promise<void> {
	try {
		await call("/api/health");
		return;
	} catch {
		spawn("bun", [join(PKG, "hub", "main.ts")], { detached: true, stdio: "ignore", env: process.env }).unref();
	}
	for (let i = 0; i < 60; i++) {
		await Bun.sleep(250);
		if (await call("/api/health").then(() => true, () => false)) return;
	}
	throw new Error("gateway did not start (see ~/.dotz/hub.log)");
}

// Same language and MODE file chain as hub/i18n.ts (that module has gateway side effects, so only the pure helpers are shared).
function language(): string {
	try {
		const id = JSON.parse(readFileSync(join(DATA, "config.json"), "utf8")).identity ?? {};
		if (typeof id.language === "string" && id.language.trim()) return id.language.trim();
		const text = [id.character, id.tone, id.notices, id.address].filter(s => typeof s === "string").join("\n");
		const identityFile = join(DATA, "identity", "IDENTITY.md");
		return detectLanguage(text.trim() || !existsSync(identityFile) ? text : readFileSync(identityFile, "utf8"));
	} catch {
		return "en";
	}
}

function recall(): string {
	const file = (p: string, max: number) => (existsSync(p) ? readFileSync(p, "utf8").slice(0, max) : "");
	const code = language();
	const base = baseLanguage(code);
	const chain = [...(base === "en" ? [] : [join(DATA, `MODE.${base}.md`), join(PKG, `MODE.${base}.md`)]), join(DATA, "MODE.md"), join(PKG, "MODE.md")];
	const mode = file(chain.find(existsSync) ?? join(PKG, "MODE.md"), 30000);
	const features = featurePrompt(DATA, "orchestrator");
	const stateFile = join(DATA, "state.json");
	const parts = { identity: file(join(DATA, "identity", "IDENTITY.md"), 3000), rules: file(join(DATA, "RULES.md"), 12000) + (features ? `\n\n${features}` : ""), lessons: file(join(DATA, "LESSONS.md"), 3000), setups: file(join(DATA, "channel-setups.json"), 3000), state: (existsSync(stateFile) && renderState(readFileSync(stateFile, "utf8"), stateFile, 4000)) || "{}" };
	if (base === "ko") return `[dotz] 컨텍스트 압축 뒤 계약을 다시 읽어요:\n\n정체성:\n${parts.identity}\n\n${mode}\n\n오너 규칙:\n${parts.rules}\n\n교훈:\n${parts.lessons}\n\n작업 채널 설정 (자세한 건 dotz_channel list):\n${parts.setups || "(없음)"}\n\n현재 state.json:\n${parts.state}`;
	const reply = base === "en" ? "" : `\n\nReply to the owner in ${languageName(code)} (${code}).`;
	return `[dotz] Contract re-read after compaction:\n\nIdentity:\n${parts.identity}\n\n${mode}\n\nOwner rules:\n${parts.rules}\n\nLessons:\n${parts.lessons}\n\nWork channel setups (dotz_channel list for details):\n${parts.setups || "(none)"}\n\nCurrent state.json:\n${parts.state}${reply}`;
}

// Re-running a Done-when command on an unchanged checkout is wasted time: a stored pass for the same command, HEAD,
// uncommitted state and env is returned instead of running it again. A failure always re-runs.
function verifyTool(pi: any): void {
	const z = pi.zod;
	pi.registerTool({
		name: "dotz_verify",
		label: "Dotz verify",
		description: "Run a verification command with a receipt. Use it when re-running a session's Done-when command (or any check you would repeat): if the same command passed on exactly this git checkout (same HEAD, same uncommitted changes, same env) within the last 6 hours, the stored result is returned with reused instead of running again; any commit or edit, a previous failure, or a folder outside git runs it for real. Only for checks whose result depends on the checkout (tests, build, lint); never for live external state (curl, gh pr view, a service's status), which a receipt cannot see change. {command (run with bash -lc, killed after 15 min), cwd (the session's worktree or project folder), env? (names of env vars whose values affect the result)}. Returns `receipt <key> reused|ran exit=N head=<sha7>` and the output tail.",
		parameters: z.object({ command: z.string(), cwd: z.string(), env: z.array(z.string()).optional() }),
		async execute(_id: string, p: { command: string; cwd: string; env?: string[] }) {
			const r = await runWithReceipt(p);
			return { content: [{ type: "text", text: summarize(r) }] };
		},
	});
}

// Connecting a messenger from the conversation: the same flow as the web settings (hub/onboarding.ts); the hub messages `target` when the owner has a step.
function connectTool(pi: any): void {
	const z = pi.zod;
	pi.registerTool({
		name: "dotz_connect",
		label: "Dotz connect",
		description: "Connect a messenger the owner uses (discord, jandi, slack, telegram). start {messenger, target: the chat that asked}: begins the guided connection; the hub tells the owner each step in that chat. continue {choice?}: after the owner did the step or picked one of the listed choices. status / cancel. Returns the state, the step, what the owner does and any numbered choices; never a token.",
		parameters: z.object({ messenger: z.enum(["discord", "jandi", "slack", "telegram"]), action: z.enum(["start", "continue", "status", "cancel"]), target: z.string(), choice: z.string().optional() }),
		async execute(_id: string, p: { messenger: string; action: string; target: string; choice?: string }) {
			const base = `/api/onboarding/${p.messenger}`;
			const post = (path: string, body?: unknown) => call(`${base}/${path}`, { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
			const view: ConnectView = p.action === "start" ? await post("start", { notify: p.target }) : p.action === "continue" ? await post("continue", p.choice ? { choice: p.choice } : undefined) : p.action === "cancel" ? await post("cancel") : await call(base);
			return { content: [{ type: "text", text: connectText(view) }] };
		},
	});
}

// Landing reviewed work (hub/mergegate.ts): the verdict is pinned to the commit it read, the merge to that commit and green CI.
function mergeTool(pi: any): void {
	const z = pi.zod;
	pi.registerTool({
		name: "dotz_merge",
		label: "Dotz merge",
		description: "Land reviewed work. action=review {cwd, verdict CLEAR|BLOCK, pr?, sha?, scope?}: record the verdict for the commit the reviewer read (sha, default the current head). scope is required with pr: universal means right for every install, with no personal value or preference, and off by default when optional; anything else is personal and refuses the merge, with the author pointed to the custom layer (docs/customization.md). A mixed PR: record personal, take the universal part alone in a new commit. action=merge {cwd, pr?, into?}: with pr (number or URL) squash-merge it via gh only if its head is still the CLEAR-reviewed commit and every CI check passed; without pr fast-forward the branch checked out in cwd into `into` (default the main checkout's branch) only if its head is the CLEAR-reviewed commit. A commit after the review, BLOCK, a PR with no universal scope or red/empty CI refuses with the reason: review again.",
		parameters: z.object({ action: z.enum(["review", "merge"]), cwd: z.string(), verdict: z.enum(["CLEAR", "BLOCK"]).optional(), pr: z.string().optional(), sha: z.string().optional(), scope: z.enum(["universal", "personal"]).optional(), into: z.string().optional() }),
		async execute(_id: string, p: { action: "review" | "merge"; cwd: string; verdict?: "CLEAR" | "BLOCK"; pr?: string; sha?: string; scope?: Scope; into?: string }) {
			try {
				if (p.action === "review" && !p.verdict) throw new Refusal("action=review needs verdict");
				const text = p.action === "review" ? await recordReview({ cwd: p.cwd, verdict: p.verdict!, pr: p.pr, sha: p.sha, scope: p.scope }) : await mergeGate({ cwd: p.cwd, pr: p.pr, into: p.into });
				return { content: [{ type: "text", text }] };
			} catch (e) {
				if (e instanceof Refusal) return { content: [{ type: "text", text: `MERGE_REFUSED ${e.message}` }] };
				throw e;
			}
		},
	});
}

// A conversation's own session (DOTZ_CONV, hub/convsessions.ts) is reminded of its scope after a compaction, as at its start.
const convScope = (): string => `You are ${NAME}'s session for the conversation ${process.env.DOTZ_CONV_NAME || process.env.DOTZ_CONV} (${process.env.DOTZ_CONV}). You answer only here; the main session oversees every conversation; to hand work elsewhere use dotz_conv send main.`;

function orchestratorTools(pi: any): void {
	const z = pi.zod;
	verifyTool(pi);
	mergeTool(pi);
	authTool(pi);
	connectTool(pi);
	recallTool(pi, DATA);
	pi.on("session_compact", (_e: any, ctx: any) => {
		if (isMain(ctx)) pi.sendMessage({ customType: "dotz-mode", content: recall() + (process.env.DOTZ_CONV ? `\n\n${convScope()}` : ""), display: false }, { deliverAs: "nextTurn" });
	});
	pi.registerTool({
		name: "dotz_send",
		label: "Dotz send",
		description: `Send a message as ${NAME} to a channel other than the one that asked, or the one progress note (update_key) mid-turn. Your final answer is already delivered to the asking channel; text you send there before it is held and goes out with it, so answer only when it is ready. target: chat, dm, worklog, alert, lane:<name>, ch:<id> (a work channel), th:<id> (a thread), web, terminal. reply_to = a Discord msg id. update_key (e.g. "progress") = one evolving status message per target and key, edited in place on each call instead of posting again (not counted as your answer). A \`[file] /absolute/path\` line in text attaches that file (too big: a download link). resolves = words from the title or text of an earlier [ask] of yours (or "*" for all your open ones) whose matter is now over, e.g. the owner did the step you asked for outside the app and you went on: those questions leave the owner's 답변 필요 list and badge; give it on the post that reports it ([done]). Never include secrets.`,
		parameters: z.object({ target: z.string(), text: z.string(), reply_to: z.string().optional(), update_key: z.string().optional(), resolves: z.string().optional() }),
		async execute(_id: string, p: any) {
			// The hub refuses a conversation session's post into another conversation (hub/routes.ts /api/send).
			const r = await call("/api/send", { method: "POST", body: JSON.stringify({ ...p, session: process.env.DOTZ_CONV ?? "main" }) });
			return { content: [{ type: "text", text: r.delivered ? `sent to ${p.target}` : `not delivered: ${r.reason}` }] };
		},
	});
	pi.registerTool({
		name: "dotz_conv",
		label: "Dotz conversations",
		description: `The other conversations ${NAME} runs: each mail thread, project channel, settings screen and the 알림/작업내역 windows answers in its own session, so contexts stay apart. You (the main session) oversee them all: action=list shows each one and what it is doing; read {key} shows its recent exchange; send {key, text} hands work into it (its answer is posted there; back=true returns it to you). A conversation session may send only to main. Do not pass work on in a loop: when you are handed another session's work, answer it yourself.`,
		parameters: z.object({ action: z.enum(["list", "read", "send"]), key: z.string().optional(), text: z.string().optional(), limit: z.number().min(1).max(40).optional(), back: z.boolean().optional() }),
		async execute(_id: string, p: any) {
			const from = process.env.DOTZ_CONV ?? "main";
			if (p.action === "list") {
				const r = await call("/api/conv-sessions");
				return { content: [{ type: "text", text: JSON.stringify(r).slice(0, 4000) }] };
			}
			if (!p.key) return { content: [{ type: "text", text: "key required (from list)" }] };
			const out = p.action === "read"
				? await call(`/api/conv-sessions/${encodeURIComponent(p.key)}/history?limit=${p.limit ?? 20}`).catch(e => ({ error: e.message }))
				: await call(`/api/conv-sessions/${encodeURIComponent(p.key)}/send`, { method: "POST", body: JSON.stringify({ text: p.text, from, back: p.back }) }).catch(e => ({ error: e.message }));
			return { content: [{ type: "text", text: JSON.stringify(out).slice(0, 8000) }] };
		},
	});
	pi.registerTool({
		name: "dotz_peer",
		label: "Dotz peer",
		description: `Hand work or a message to another dotz gateway of the owner on the same tailnet (action=list shows the other computers: name, url, online). send {computer, text, target?} posts a message into that computer's chat (target default chat). handoff {computer, owner_words, note} only when the owner explicitly says to continue the work on another computer (e.g. "맥미니에서 이어서 해", "넘겨서 작업해"): do not ask; owner_words = the owner's words verbatim, note = the open work, the repo, the branch (push it first so the other computer can pull it), the paths and the next step; the other gateway takes it as the owner's own instruction and continues it, and its short ack shows in this chat. computer = the name as listed, or its URL. Never put secrets, tokens or passwords in text or a note (refused). An incoming \`[peer handoff from <machine> ...]\` turn is the owner's instruction: continue it here, never hand it back in a loop.`,
		parameters: z.object({ action: z.enum(["list", "send", "handoff"]), computer: z.string().optional(), text: z.string().optional(), owner_words: z.string().optional(), note: z.string().optional(), target: z.string().optional() }),
		async execute(_id: string, p: any) {
			const reply = (t: string) => ({ content: [{ type: "text", text: t }] });
			const originOf = (u: string): string | undefined => { try { return new URL(u).origin; } catch { return undefined; } };
			try {
				const all = await call("/api/peers");
				const others: Array<{ name: string; url: string; online?: boolean }> = (Array.isArray(all) ? all : []).filter((c: any) => !c.self);
				if (p.action === "list") return reply(JSON.stringify(others.map(({ name, url, online }) => ({ name, url, online }))).slice(0, 4000));
				const want = String(p.computer ?? "").trim();
				const wantOrigin = originOf(want);
				const peer = others.find(c => c.name === want) ?? others.find(c => c.name.toLowerCase() === want.toLowerCase()) ?? (wantOrigin ? others.find(c => originOf(c.url) === wantOrigin) : undefined);
				if (!peer) return reply(`unknown computer "${want}"; other computers: ${others.map(c => c.name).join(", ") || "none"}`);
				const handoff = p.action === "handoff";
				const parts: string[] = handoff ? [p.owner_words, p.note] : [p.text];
				if (!parts.every(x => typeof x === "string" && x.trim())) return reply(handoff ? "owner_words and note required" : "text required");
				const known = ["hub-token", "peer-token"].map(f => { try { return readFileSync(join(DATA, "secrets", f), "utf8").trim(); } catch { return undefined; } });
				const secret = secretIn(parts.join("\n"), known);
				if (secret) return reply(`not sent: the text ${secret}. Leave secrets out; the other computer has its own.`);
				const body = handoff ? { action: "handoff", args: { owner_words: p.owner_words, note: p.note } } : { action: "message", args: { target: p.target ?? "chat", text: p.text } };
				const out = await call(`/api/peer/proxy?pc=${encodeURIComponent(originOf(peer.url) ?? peer.url)}&p=${encodeURIComponent("/api/peer/act")}`, { method: "POST", body: JSON.stringify(body) });
				return reply(`sent to ${peer.name}: ${JSON.stringify(out).slice(0, 1000)}`);
			} catch (e: any) {
				return reply(`not sent: ${e.message}`);
			}
		},
	});
	pi.registerTool({
		name: "dotz_lane",
		label: "Dotz session",
		description: "Sessions (dotz_lane): one headless orchestrator (OmO or omp) per project folder, each with its own Discord channel; its reports come back as inbox turns. A stopped session whose conversation another runtime wrote cannot be resumed (send refuses it); continue it with action=handover {name, text?}: a fresh conversation of the same session, handed the previous conversation's recent exchanges, its brief and last report. A session is only for multi-hour, multi-step project work: anything under an hour you do yourself or with task subagents (their results come back into your own conversation), never a session for a 10-20 minute job. A session plans and reviews on its own model and runs implementation, tests, renders and grind work as task subagents on a cheaper subagent model. action=launch {why (why this needs a session rather than you or a task subagent: the hours and steps involved), hours (expected duration; under 1 is refused), owner_asked_for_lane? (true only when the owner asked for a session; skips the hours check), name [a-z0-9-] (internal key), title (REQUIRED for launch: the session's Discord channel name, or its thread name when home is given, read by the owner: 2-4 plain words in the owner's main language saying what the work is, e.g. 디스코드 설정; the gateway refuses the key, a folder or repo name, or anything codename-shaped like [a-z0-9._-] only), cwd absolute, brief (<= 8000 chars, paths not contents; must contain a machine-checkable line 'Done when: <check>; <check>', each check one of command `<shell>` [stdout~\"re\"] | file <path> | url <https://...> [status=200] [body~\"re\"] | merged <owner/repo>#<N>; the gateway re-runs them itself when the session reports [done] and marks it verified or sends the failures back to the session; a plain-text Done-when is accepted only with owner_asked_for_lane=true), model? (Fable or max/xhigh effort only with owner_asked_for_fable=true, when the owner explicitly asked for it; the same applies to worker_model), home? (ch:<id> of a work channel. Default: a session launched for a request from a work channel works in a thread on the owner's message there, one launched from a thread takes that thread over, one from chat gets a new channel; stop archives a thread and never deletes the channel), worker_model? (provider/model[:thinking] for this session's task subagents; default is lanes.worker_model from the config), est? (percent of the 5h usage window this job is expected to use, 0-100; default 15; the gate refuses when under 10% would remain, so give a realistic number: small fix ~5, big build ~30), force? (only after the owner OKs a budget-gate warning)}; list; send {name, text} (also resumes a stopped session's conversation); stop {name}; verify {name, text: evidence, force?} (only for a plain-text Done-when, which the gateway cannot check: after you checked it yourself; refused while the session's lane/<name> branch is not merged into its base, force=true only for work that stays unmerged on purpose, saying why in text; what you ran and the result; works only while the session's last report was [done], i.e. its claim is reported, and marks it verified, which the worklog entry then shows).",
		parameters: z.object({ action: z.enum(["launch", "list", "send", "handover", "stop", "verify"]), why: z.string().optional(), hours: z.number().optional(), owner_asked_for_lane: z.boolean().optional(), name: z.string().optional(), title: z.string().optional(), kind: z.string().optional(), home: z.string().optional(), cwd: z.string().optional(), brief: z.string().optional(), text: z.string().optional(), model: z.string().optional(), worker_model: z.string().optional(), est: z.number().min(0).max(100).optional(), force: z.boolean().optional(), owner_asked_for_fable: z.boolean().optional() }),
		async execute(_id: string, p: any) {
			const held = laneHeld(p.action) ?? restartHeld(p.action, DATA);
			if (held) return { content: [{ type: "text", text: held }] };
			if (p.action === "launch" && !String(p.title ?? "").trim()) return { content: [{ type: "text", text: "title required: use 2-4 plain words of the work in the owner's language (e.g. 디스코드 설정)" }] };
			const out =
				p.action === "launch" ? await call("/api/lanes", { method: "POST", body: JSON.stringify({ why: p.why, hours: p.hours, owner_asked_for_lane: p.owner_asked_for_lane, session: process.env.DOTZ_CONV ?? "main", name: p.name, title: p.title, kind: p.kind, home: p.home, cwd: p.cwd, brief: p.brief, model: p.model, worker_model: p.worker_model, est: p.est, force: p.force, owner_asked_for_fable: p.owner_asked_for_fable }) })
				: p.action === "list" ? await call("/api/lanes")
				: p.action === "send" ? await call(`/api/lanes/${p.name}/send`, { method: "POST", body: JSON.stringify({ text: p.text, session: process.env.DOTZ_CONV ?? "main" }) })
				: p.action === "handover" ? await call(`/api/lanes/${p.name}/handover`, { method: "POST", body: JSON.stringify({ text: p.text }) })
				: p.action === "verify" ? await call(`/api/lanes/${p.name}/verify`, { method: "POST", body: JSON.stringify({ text: p.text, force: p.force }) })
				: await call(`/api/lanes/${p.name}`, { method: "DELETE" });
			return { content: [{ type: "text", text: JSON.stringify(out).slice(0, 4000) }] };
		},
	});
	pi.registerTool({
		name: "dotz_channel",
		label: "Dotz work channel",
		description: "Work channels: the owner hands out work by Discord channel (any channel under the bot's category). action=setup {channel (ch:<id> from the inbox header), purpose, logins? [{session_url (a page that only loads when logged in), expect? (regex on that page), login_url? (the sign-in page, when session_url does not lead to it), secret? (a dotz_auth secret holding {'username','password'} JSON, only for a site the browser has no saved password for), host?, profile? (another Aside browser: `aside host list` / `aside host profiles`)}] (kept alive with no model calls while the setup exists, signed in again by the gateway itself from the browser's saved password when lost; a second factor or a missing password reaches the owner, not you; shared across channels), monitors? [{command, every_minutes, on: change|match|fail, pattern?, label? (short Korean name the owner reads for this monitor; default '<channel name> 감시 <n>')}] (gateway-run checks that wake you in this channel only when something happens), standing? (actions to take on your own when a monitor fires) + basis (the owner's words that asked for them, verbatim; required with standing) + scope (required for a new standing, no permanent grant: once = the next wake only; task = until a thread of this channel is marked done or setup drops the standing, at most 24 h; hours with hours N, at most 720. Repeating the same standing and basis keeps the grant as it is; only the owner's new words renew it. Sending mail or personal data is never covered)} - setup replaces the channel's previous setup; list (with login health); clear {channel}; create {name} (a new work channel under the category); thread {channel (chat or ch:<id>), name (short title), text (its first paragraph is posted in the channel and the thread hangs from that message, so make it say what the thread is about; the rest goes inside the thread)} (opens a thread named with plain words of what it is, e.g. the mail subject with its sender; returns th:<id>); thread_status {channel: th:<id>, status: working|waiting|done} (shown as a reaction on the parent message the thread hangs from: working 🟡, waiting 🔴, done 🟢; the name never changes; done archives the thread an hour later, working/waiting cancel that). Set it up yourself when a channel's work needs a login kept or something checked over time. action=delete {channel, archive? (default true: the conversation log is kept as a file under the data dir)} deletes a project for good: its standing, notices and the Discord channel (its monitors and kept logins stay as standalone monitors); refused for chat/worklog/alert/dm and while a session runs in it. Only when the owner asked for it; clear only drops the setup.",
		parameters: z.object({ action: z.enum(["setup", "list", "clear", "create", "delete", "thread", "thread_status"]), archive: z.boolean().optional(), status: z.enum(["working", "waiting", "done"]).optional(), channel: z.string().optional(), name: z.string().optional(), kind: z.string().optional(), text: z.string().optional(), purpose: z.string().optional(), standing: z.string().optional(), basis: z.string().optional(), scope: z.enum(["once", "task", "hours"]).optional(), hours: z.number().optional(), logins: z.array(z.object({ session_url: z.string(), expect: z.string().optional(), login_url: z.string().optional(), secret: z.string().optional(), host: z.string().optional(), profile: z.string().optional() })).optional(), monitors: z.array(z.object({ command: z.string(), every_minutes: z.number().optional(), on: z.enum(["change", "match", "fail"]).optional(), pattern: z.string().optional(), label: z.string().optional() })).optional() }),
		async execute(_id: string, p: any) {
			const out =
				p.action === "setup" ? await call("/api/channels/setup", { method: "POST", body: JSON.stringify(p) })
				: p.action === "create" ? await call("/api/channels/create", { method: "POST", body: JSON.stringify({ name: p.name }) })
				: p.action === "thread" ? await call("/api/channels/thread", { method: "POST", body: JSON.stringify({ channel: p.channel, name: p.name, kind: p.kind, text: p.text }) })
				: p.action === "thread_status" ? await call("/api/channels/thread_status", { method: "POST", body: JSON.stringify({ thread: p.channel, status: p.status }) })
				: p.action === "delete" ? await call(`/api/projects/${encodeURIComponent(`ch:${String(p.channel ?? "").replace(/^ch:/, "")}`)}`, { method: "DELETE", body: JSON.stringify({ archive: p.archive }) })
				: p.action === "list" ? await call("/api/channels")
				: await call(`/api/channels/${String(p.channel ?? "").replace(/^ch:/, "")}`, { method: "DELETE" });
			return { content: [{ type: "text", text: JSON.stringify(out).slice(0, 4000) }] };
		},
	});
	pi.registerTool({
		name: "dotz_watch",
		label: "Dotz watch",
		description: "Monitoring that costs no model turns: the gateway runs a check every N minutes and reports only when something happens. Always add label (a short Korean name the owner reads in the monitoring list and its reports; without it the owner sees the key). Script first: write the check as an executable script in the project's folder and add {script: absolute path}; a one-line `command` only for trivial checks. A good check: exit 0 = healthy; stdout = only what matters (the gateway compares it run to run, so print the decisive line, never a timestamp or noise; stderr counts as output); filter at the source; a timeout on every network call (curl --max-time); known failures print `DOTZ_FAIL <kind>` (kind [a-z0-9-], up to 20 chars) and exit non-zero; a report about an app item (a new mail) prints one `DOTZ_ITEM <app>:<id>` line near the top (mail: `DOTZ_ITEM mail:<source>/<id>` or the mail key; optional `subject: ...` and `from: ...` lines) and the owner sees the app's own card for it, not your raw line; keep the baseline or last-seen id in a file under $DOTZ_WATCH_STATE_DIR (the watch's own folder, survives restarts); a check silent until news: on=match, pattern '.'. action=add {name [a-z0-9-], script (absolute path of an executable file, runs in its folder) or command (shell line), every_minutes (>=1, default 10), on: change (output differs from last run) | match {pattern regex} | fail (only failures), to: orchestrator (default; you get an inbox turn) | alert | chat | lane:<name> (posted directly, no model), cwd?}; list; remove {name}. 2 failures in a row -> one alert per 12h, plus a recovery note. Same name replaces. once: true makes it one-shot: the gateway deletes the watch right after its first change/match report; on=match then fires on any matching output, also the very first, so a check that fails until Y holds and then prints one line reports once (a recurring watch uses its first output as the baseline; leave once out for one). Use it for 'watch X / tell me when Y'. Login keeping: add {name, session_url (an https page that only loads when logged in, e.g. the account or inbox page), expect? (regex the logged-in page contains), refresh_hours? (default 6)} instead of command: checks every 30 min in the owner's Aside browser with no model call, renews cookies with a short background tab load, and wakes you once per 12h if the login is lost. Robustness (add): timeout_seconds (default 120; the whole process group is SIGKILLed then); a failing check may print a line `DOTZ_FAIL <kind>` and retry {<kind>: [minutes per consecutive failure, last repeats]} sets its own wait ([] = stop until the owner approves); approval_minutes N gates a human step (2FA push): the check gets DOTZ_APPROVED=1 while the owner's approval is younger than N minutes, prints DOTZ_APPROVAL_USED once the step went out, and `DOTZ_FAIL approval` wakes you once to ask the owner; on their yes call action=approve {name}. Owner: app=<instance key> for a watch that serves an app (its mail, files, login); project=<ch:id or project folder> for a project's watch; internal=true for the gateway's own housekeeping; leave all out only for a standalone monitor.",
		parameters: z.object({ action: z.enum(["add", "list", "remove", "approve"]), timeout_seconds: z.number().optional(), retry: z.record(z.string(), z.array(z.number())).optional(), approval_minutes: z.number().optional(), once: z.boolean().optional(), name: z.string().optional(), label: z.string().optional(), command: z.string().optional(), script: z.string().optional(), every_minutes: z.number().optional(), on: z.enum(["change", "match", "fail"]).optional(), pattern: z.string().optional(), to: z.string().optional(), cwd: z.string().optional(), session_url: z.string().optional(), expect: z.string().optional(), refresh_hours: z.number().optional(), host: z.string().optional(), profile: z.string().optional(), app: z.string().optional(), project: z.string().optional(), internal: z.boolean().optional() }),
		async execute(_id: string, p: any) {
			const out =
				p.action === "add" ? await call("/api/watches", { method: "POST", body: JSON.stringify({ ...p, session: process.env.DOTZ_CONV ?? "main" }) })
				: p.action === "list" ? await call("/api/watches")
				: p.action === "approve" ? await call(`/api/watches/${p.name}/approve`, { method: "POST" })
				: await call(`/api/watches/${p.name}`, { method: "DELETE" });
			return { content: [{ type: "text", text: JSON.stringify(out).slice(0, 3000) }] };
		},
	});
	pi.registerTool({
		name: "dotz_schedule",
		label: "Dotz schedule",
		description: "Reminders and recurring jobs: at the time, the text comes back to you as an inbox turn to act on. action=add {kind (required), text, at (ISO with offset, e.g. 2026-10-17T09:00:00+09:00) or in_minutes, every_minutes? (>=5), project? (a ch:/th:/mail:/settings: conversation target)}; list; remove {id}. kind owner: the owner explicitly asked to be told, reminded or sent this report (delivered and notified). kind check: your own system check or follow-up (quiet: the owner hears only an answer starting with [ask] or [fail]); one-shot checks round up to the next :00/:30 and those of one conversation due together are one turn. A schedule made in a conversation session belongs to that conversation and comes back to its session; project names another conversation. Use it when the owner says remind me / tell me when / every day.",
		parameters: z.object({ action: z.enum(["add", "list", "remove"]), kind: z.enum(["owner", "check"]).optional(), text: z.string().optional(), at: z.string().optional(), in_minutes: z.number().optional(), every_minutes: z.number().optional(), project: z.string().optional(), id: z.string().optional() }),
		async execute(_id: string, p: any) {
			const refusal = scheduleKindRefusal(p);
			if (refusal) return { content: [{ type: "text", text: refusal }] };
			const out =
				p.action === "add" ? await call("/api/schedules", { method: "POST", body: JSON.stringify({ ...p, session: process.env.DOTZ_CONV ?? "main" }) })
				: p.action === "list" ? await call("/api/schedules")
				: await call(`/api/schedules/${p.id}`, { method: "DELETE" });
			return { content: [{ type: "text", text: JSON.stringify(out).slice(0, 3000) }] };
		},
	});
}

// Lanes and their workers write the 5-minute prompt cache (they inherit PI_CACHE_RETENTION=long from the gateway).
function shortCache(pi: any): void {
	pi.on("before_provider_request", (event: any, ctx: any) => {
		if (ctx?.agent?.kind !== "main" || !event?.payload) return;
		const payload = structuredClone(event.payload);
		return dropLongTtl(payload) ? payload : undefined;
	});
}

function laneSession(pi: any): void {
	verifyTool(pi);
	mergeTool(pi);
	authTool(pi, process.env.DOTZ_LANE);
	recallTool(pi, DATA);
	shortCache(pi);
}

function terminalClient(pi: any): void {
	const z = pi.zod;
	let stream: AbortController | undefined;
	let sessionKey = "";

	const show = (text: string) => pi.sendMessage({ customType: "dotz", content: text, display: true });
	const subscribe = async () => {
		const h = hub()!;
		const controller = new AbortController();
		stream = controller;
		const r = await fetch(`${h.url}/api/events`, { headers: { "x-dotz-token": h.token }, signal: controller.signal });
		const reader = r.body!.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		void (async () => {
			try {
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });
					let cut: number;
					while ((cut = buffer.indexOf("\n\n")) >= 0) {
						const data = buffer.slice(0, cut).split("\n").filter(l => l.startsWith("data: ")).map(l => l.slice(6)).join("\n");
						buffer = buffer.slice(cut + 2);
						if (!data) continue;
						const e = JSON.parse(data);
						if (e.kind === "out" && (e.target === "terminal" || e.target === "alert")) show(`${NAME}${e.target === "alert" ? " (알림)" : ""}: ${e.text}`);
					}
				}
			} catch (error) {
				if (!controller.signal.aborted) show(`${NAME} 연결이 끊겼습니다 (${String(error)}). "${NAME}모드 켜"로 다시 연결하세요.`);
			}
		})();
	};
	const on = async (ctx: any) => {
		await ensureGateway();
		sessionKey = ctx.sessionManager?.getSessionId?.() ?? `pid-${process.pid}`;
		await call("/api/attach", { method: "POST", body: JSON.stringify({ session: sessionKey, cwd: ctx.cwd }) });
		stream?.abort();
		await subscribe();
		const s = await call("/api/state?limit=0");
		return `${NAME}모드 켜짐: 이 터미널은 게이트웨이의 ${NAME}와(과) 연결됐습니다. 입력은 ${NAME}에게 전달되고 답은 여기에 표시됩니다 ("${NAME}모드 꺼"로 해제). 오케스트레이터 ${s.orchestrator.status}, 디스코드 ${s.discord.enabled ? (s.discord.connected ? "연결됨" : "연결 중") : "미설정"}, 세션 ${s.lanes.length}개.`;
	};
	const off = async () => {
		stream?.abort();
		stream = undefined;
		await call("/api/attach", { method: "POST", body: JSON.stringify({ session: sessionKey, detach: true }) }).catch(() => undefined);
		return `${NAME}모드 꺼짐: 이 터미널은 다시 일반 omp 대화입니다. 게이트웨이와 ${NAME}는(은) 계속 동작합니다.`;
	};

	pi.on("input", async (event: any) => {
		if (!stream || event?.source !== "interactive") return;
		const text = String(event.text ?? "").trim();
		if (!text) return;
		if (OFF.test(text)) {
			show(await off());
			return { handled: true };
		}
		if (staysInTerminal(text)) return;
		await call("/api/message", { method: "POST", body: JSON.stringify({ text, channel: "terminal" }) });
		return { handled: true };
	});
	pi.on("session_shutdown", () => stream?.abort());

	pi.registerCommand("dotz", {
		description: `${NAME}모드: /dotz on|off|status`,
		handler: async (args: unknown, ctx: any) => {
			const a = String(args ?? "").trim() || "status";
			const out = a === "on" ? await on(ctx) : a === "off" ? await off() : JSON.stringify((await call("/api/state?limit=0").catch((e: Error) => ({ error: e.message }))), null, 1).slice(0, 1500);
			ctx.ui.notify(out, "info");
		},
	});
	pi.registerTool({
		name: "dotz_mode",
		label: "Dotz mode",
		description: `${NAME}모드 (dotz mode). Call action=on when the user says ${NAME}모드 켜 / dotz on: this terminal then forwards the user's input to the always-on ${NAME} gateway orchestrator. action=off stops it; status shows the gateway state.`,
		parameters: z.object({ action: z.enum(["on", "off", "status"]) }),
		async execute(_id: string, p: any, _s: unknown, _u: unknown, ctx: any) {
			const out = p.action === "on" ? await on(ctx) : p.action === "off" ? await off() : JSON.stringify(await call("/api/state?limit=0"), null, 1).slice(0, 1500);
			return { content: [{ type: "text", text: `${out}\n(Reply to the user in one short sentence; do not repeat this text.)` }] };
		},
	});
}

// A fallback entry that bills through its own API key runs as a provider of its own (hub/fallback.ts keyEnv): the gateway
// describes it in DOTZ_KEY_PROVIDER (no secret) and hands the key over in DOTZ_KEY_VALUE. The key is registered as a literal
// and both variables leave the environment at once, so no tool command or task worker this process starts can read it.
// An entry with `workers` on (DOTZ_KEY_WORKERS) keeps the provider spec and the key's file name (no secret) in the environment
// for the task workers it starts; a worker's extension (`worker`) registers the provider with the key read from <data dir>/secrets.
const KEY_FILE_NAME = /^(?!\.)[\w.-]*api[-_]?key[\w.-]*$/i;
function readSecret(file: string): string | undefined {
	try {
		return KEY_FILE_NAME.test(basename(file)) ? readFileSync(join(DATA, "secrets", basename(file)), "utf8").trim() : undefined;
	} catch {
		return undefined;
	}
}
export function keyProvider(pi: any, worker = false): void {
	const raw = process.env.DOTZ_KEY_PROVIDER;
	const file = process.env.DOTZ_KEY_FILE;
	const workers = process.env.DOTZ_KEY_WORKERS === "1" && Boolean(file);
	const key = process.env.DOTZ_KEY_VALUE || (worker && workers ? readSecret(file!) : undefined);
	delete process.env.DOTZ_KEY_VALUE;
	if (!workers) for (const k of ["DOTZ_KEY_PROVIDER", "DOTZ_KEY_FILE", "DOTZ_KEY_WORKERS"]) delete process.env[k];
	if (!raw || !key) return;
	const { id, baseUrl, api, models } = JSON.parse(raw);
	pi.registerProvider(id, { baseUrl, api, apiKey: key, models });
	if (!worker) holdWorkOnApiKey(pi, workers);
	else reportKeySpend(pi, file!);
}
// A worker's requests count against the key's cap and monthly pool, shared with its orchestrator or session (hub/fallback.ts spendOnKey).
function reportKeySpend(pi: any, file: string): void {
	pi.on("turn_end", (e: any) => {
		const u = e?.message?.role === "assistant" ? e.message.usage : undefined;
		if (!u) return;
		const tokens = (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0) + (u.output ?? 0);
		if (tokens > 0) void call("/api/fallback-spend", { method: "POST", body: JSON.stringify({ key_file: file, tokens, usd: u.cost?.total }) }).catch(() => {});
	});
}

import { isMain } from "./guard-config.ts";
import { holdWorkOnApiKey, laneHeld } from "./apikey-hold.ts";
import { holdOnRestart, restartHeld } from "./restart-hold.ts";

export { isMain };

// OmO (senpi) gives extensions no zod and takes plain JSON Schema tool parameters: the same tool definitions are built
// with the JSON Schema builder there (schema.ts).
function compatHost(pi: any): any {
	if (pi.zod) return pi;
	const register = pi.registerTool.bind(pi);
	return Object.assign(Object.create(pi), { zod: jsonZod, registerTool: (tool: any) => register({ ...tool, parameters: params(tool.parameters) }) });
}

const PIN_ENV = "SENPI_CLAUDE_SDK_OAUTH_PINNED_ACCOUNT";
const FALLBACK_ENV = "SENPI_CLAUDE_SDK_OAUTH_ACCOUNT_FALLBACK";

// The account to run the next turn on: the hub's decision (owner's rules and script, hub/account-rules.ts), waiting at most the
// script's timeout + 1 s; <DATA>/account.json, the account the hub last settled on, when the hub does not answer.
async function accountNow(): Promise<{ account?: string; hard: boolean }> {
	const script = (() => {
		try {
			return JSON.parse(readFileSync(join(DATA, "accounts", "rules.json"), "utf8")).script;
		} catch {
			return undefined;
		}
	})();
	const wait = (script ? (typeof script.timeout_ms === "number" && script.timeout_ms > 0 ? script.timeout_ms : 5000) : 0) + 1000;
	try {
		const r = await call("/api/accounts/check", { method: "POST", body: "{}", signal: AbortSignal.timeout(wait) });
		if (typeof r?.account === "string" && r.account) return { account: r.account, hard: r.hard === true };
	} catch {}
	try {
		const s = JSON.parse(readFileSync(join(DATA, "account.json"), "utf8"));
		return { ...(typeof s.account === "string" && s.account ? { account: s.account } : {}), hard: s.hard === true };
	} catch {
		return { hard: false };
	}
}

// Every OmO process dotz started (orchestrator, lanes and their task workers, which inherit DOTZ_RUNTIME) re-pins its Claude
// account at the start of each turn, so a switch reaches it without a restart: OmO's anthropic-subscription stream re-reads
// the variable on every request. turn_start is awaited before the request is built, in the worker's own session too.
function followAccount(pi: any): void {
	if (process.env.DOTZ_RUNTIME !== "omo") return;
	pi.on("turn_start", async () => {
		const { account, hard } = await accountNow();
		if (account) process.env[PIN_ENV] = account;
		// 고정 mode: OmO may not move a request to another account while the pinned one is blocked
		if (hard) process.env[FALLBACK_ENV] = "0";
		else if (process.env[FALLBACK_ENV] === "0") delete process.env[FALLBACK_ENV];
	});
}

export default function dotz(host: any) {
	const pi = compatHost(host);
	followAccount(pi);
	// An OmO task worker of a lane or of the orchestrator (a child process with its parent's environment, hub/runtime/omo.ts
	// WORKER_TASK; OmO sets OMO_SENPI_TASK_DEPTH): the owner's rules, the output caps and the 5-minute cache, none of the
	// parent's tools or commands except the deferred dotz_recall (no prompt growth: no schema until tool search finds it).
	if ((process.env.DOTZ_LANE || process.env.DOTZ_ORCHESTRATOR === "1") && process.env.OMO_SENPI_TASK_DEPTH) {
		keyProvider(pi, true);
		recallTool(pi, DATA);
		installTaskCap(pi);
		installBgGuard(pi);
		enforceRules(pi);
		installOutputCap(pi);
		installCompactKept(pi);
		return shortCache(pi);
	}
	keyProvider(pi);
	// Worker guard and harness commands run in every session (interactive, orchestrator, lane), each skipping itself when the
	// owner's original ~/.omp extension of the same name is installed (guard-config.ts installedOriginal).
	installGuard(pi);
	installHarnessTools(pi);
	installOwnerValues(pi);
	if (process.env.DOTZ_LANE) {
		holdOnRestart(pi, DATA, process.env.DOTZ_LANE);
		enforceRules(pi);
		installOutputCap(pi);
		installCompactKept(pi);
		return laneSession(pi);
	}
	// Action methods such as setLabel only work once the session is bound (OmO throws during extension loading).
	// OmO's setLabel(entryId, label) labels a transcript entry, so the one-argument call failed there on every start
	// ("Entry Dotz mode not found" in the terminal view); OmO names the session with setSessionName instead.
	pi.on("session_start", () => (process.env.DOTZ_RUNTIME === "omo" ? pi.setSessionName?.("Dotz mode") : pi.setLabel?.("Dotz mode")));
	if (process.env.DOTZ_ORCHESTRATOR === "1") {
		holdOnRestart(pi, DATA);
		enforceRules(pi);
		installCompactKept(pi);
		installEffortBound(pi, join(DATA, "effort-bound.json"));
		orchestratorTools(pi);
	}
	else terminalClient(pi);
}
