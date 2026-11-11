// What the owner sees and does about the Claude subscription accounts, from the HTTP API (GET /api/accounts, PUT
// /api/accounts/alias, PUT /api/accounts/rules, POST /api/accounts/use), the /account command (hub/control.ts) and short chat
// requests the gateway answers itself ("계정 바꿔줘", main.ts). Every account is shown by its alias (hub/account-alias.ts label);
// the raw id appears only in API fields named `name`/`key` and on "-# " detail lines.
import { aliasesFile, label, readAliases, resolveAccount, setAlias } from "./account-alias.ts";
import { blockedKind, checkNow, DEFAULT_EVERY_MINUTES, DEFAULT_SCRIPT_TIMEOUT_MS, decisionsFile, describeRule, type Decision, getScriptOpinion, getUsage, josa, lastDecision, type Manual, readRules, rulesFile, type ScriptErrorKind, setManual, setOnLimit, setOrder, validateRules, writeRules } from "./account-rules.ts";
import { type AccountSwitch, accountView, clearSwitches, deleteSwitch, hardPinned, inOrder, MAX_LOG_LINES, onUsedChange, type Pool, quietly, readPool, stickyAccount, type SwitchKind, type UsedChange } from "./account-sticky.ts";
import { deletePoolAccount, providerGroups, readProviderStore, windowsOf, writeProviderPin } from "./accounts-providers.ts";
import { issueBlock } from "./choices.ts";
import { TZ } from "./config.ts";
import { msg } from "./i18n.ts";
import { deleteOmoAccount, writeOmoPin } from "./omo-pin.ts";
import { accountUsedChanged } from "./notices.ts";
import { ACCOUNT_CHANGED, ACCOUNT_LEAD, ACCOUNT_PICKED } from "./worklog-kind.ts";
import { type AccountReport, limitsText, usedAccount } from "./usage-account.ts";

export class AccountsError extends Error {
	constructor(message: string, readonly status = 400) {
		super(message);
	}
}

const SOURCE_TEXT: Record<Decision["source"], string> = { manual: "직접 고름", script: "스크립트", rule: "규칙", auto: "자동" };
export const KIND_TEXT: Record<SwitchKind, string> = { start: "처음 선택", limit: "한도", owner: "직접 변경", gone: "계정 사라짐", rule: "규칙", script: "스크립트", manual: "직접 고름" };
const SCRIPT_ERROR_TEXT: Record<ScriptErrorKind, string> = { timeout: "시간이 초과됐어요", exit: "오류로 끝났어요", spawn: "실행하지 못했어요", unknown_account: "모르는 계정을 골랐어요" };

const clock = (ms: number) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
const dayKey = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(ms));
// "18:00" today, "내일 01:00" tomorrow, "10월 25일 18:00" otherwise.
function clockText(ms: number, now: number): string {
	if (dayKey(ms) === dayKey(now)) return clock(ms);
	if (dayKey(ms) === dayKey(now + 86_400_000)) return `내일 ${clock(ms)}`;
	const part = (type: "month" | "day") => new Intl.DateTimeFormat("en-US", { timeZone: TZ, [type]: "numeric" }).format(new Date(ms));
	return `${part("month")}월 ${part("day")}일 ${clock(ms)}`;
}

// The bell alert for a change of the account requests really use: from which to which, and why.
export function usedChangeNotice(c: UsedChange, aliases = readAliases()): string {
	const from = label(c.from, undefined, aliases);
	const to = label(c.to, undefined, aliases);
	const head = `요청 계정을 ${from}에서 ${to}${josa(to, "으로", "로")} 바꿨어요.`;
	const until = c.until ? ` ${from}의 한도는 ${clockText(c.until, Date.parse(c.at))}에 풀려요.` : "";
	const switched: Record<SwitchKind, string> = { start: "처음 골랐기 때문이에요.", limit: "이전 계정이 한도에 걸렸기 때문이에요.", owner: "OmO에서 계정을 직접 고정했기 때문이에요.", gone: "이전 계정이 사라졌기 때문이에요.", rule: c.rule ? `규칙 "${c.rule}" 때문이에요.` : "규칙 때문이에요.", script: "스크립트가 골랐기 때문이에요.", manual: "직접 골랐기 때문이에요." };
	const because = { limit: `${from}${josa(from, "이", "가")} 한도에 걸렸기 때문이에요.${until}`, auth_error: `${from}의 로그인이 풀렸기 때문이에요.`, gone: `${from}${josa(from, "이", "가")} 사라졌기 때문이에요.`, restored: `막혀 있던 ${to}${josa(to, "이", "가")} 다시 쓸 수 있게 됐기 때문이에요.`, switch: switched[c.switchKind ?? "start"] }[c.cause];
	return `${head} ${because}`;
}

// Called once at start: every change of the account in use that the owner did not make in the web is posted as an alert.
export function announceUsedChanges(): void {
	onUsedChange(c => accountUsedChanged(usedChangeNotice(c), `account-used:${c.at}`));
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pct = (n: number) => `${Math.round(n)}%`;

// Raw account ids inside a free-text reason become their aliases.
function relabel(text: string, names: string[], aliases: Record<string, string>): string {
	let out = text;
	for (const n of [...names].sort((a, b) => b.length - a.length)) {
		const l = label(n, undefined, aliases);
		if (l !== n) out = out.replace(new RegExp(`(?<![\\w@.-])${escape(n)}(?![\\w@.-])`, "g"), l);
	}
	return out;
}

// A switch's cause in a few Korean words, without raw ids.
function switchWhy(s: AccountSwitch): string {
	switch (s.kind) {
		case "start":
			return "처음 선택";
		case "limit":
			return "한도";
		case "owner":
			return "OmO에서 직접 고정";
		case "gone":
			return "계정이 사라짐";
		case "rule":
			return s.rule ? `규칙 "${s.rule}"` : s.reason;
		default:
			return s.reason;
	}
}

// One Korean line: "개인 계정 → 회사 계정 (규칙 "근무 시간")".
export function switchText(s: AccountSwitch, aliases = readAliases()): string {
	const to = label(s.to, undefined, aliases);
	return `${s.from ? `${label(s.from, undefined, aliases)} → ` : ""}${to} (${switchWhy(s)})`;
}

// The worklog sentence for a switch other than the first pick.
export function switchNotice(s: AccountSwitch, aliases = readAliases()): string {
	const to = label(s.to, undefined, aliases);
	const head = s.from ? `${ACCOUNT_LEAD}${label(s.from, undefined, aliases)}에서 ${to}${josa(to, "으로", "로")} ${ACCOUNT_CHANGED}` : `${ACCOUNT_LEAD}${to}${josa(to, "으로", "로")} ${ACCOUNT_PICKED}`;
	const because: Record<SwitchKind, string> = {
		start: "처음 골랐기 때문이에요.",
		limit: "이전 계정이 한도에 걸렸기 때문이에요.",
		owner: "OmO에서 직접 고정했기 때문이에요.",
		gone: "이전 계정이 사라졌기 때문이에요.",
		rule: `${s.rule ? `규칙 "${s.rule}"` : s.reason} 때문이에요.`,
		script: "스크립트가 골랐기 때문이에요.",
		manual: "직접 골랐기 때문이에요.",
	};
	return `${head} ${because[s.kind]}`;
}

type LabeledSwitch = AccountSwitch & { from_label?: string; to_label: string; kind_text: string };
const labeledSwitch = (s: AccountSwitch, aliases = readAliases()): LabeledSwitch => ({
	...s,
	...(s.from ? { from_label: label(s.from, undefined, aliases) } : {}),
	to_label: label(s.to, undefined, aliases),
	kind_text: KIND_TEXT[s.kind],
});

// accountView() (the usage screen's account block) plus the owner's names.
export function labeledAccountView(limit = MAX_LOG_LINES) {
	const v = accountView(limit);
	const aliases = readAliases();
	// the account requests really use, not the pick OmO skips while it is blocked
	const pool = readPool();
	const account = v.account && pool ? (hardPinned() ? v.account : usedAccount(v.account, pool.names, n => Boolean(pool.blocked[n]), n => pool.lastSuccess[n] ?? 0)) : v.account;
	const moved = account !== v.account;
	// pinned: the owner's 고정 mode, so the usage screen does not promise a switch on a limit that will not happen
	return { ...v, ...(moved ? { since: undefined } : {}), ...(account ? { account, account_label: label(account, undefined, aliases) } : {}), pinned: hardPinned(), switches: v.switches.map(s => labeledSwitch(s, aliases)) };
}

// A manual pick whose account is blocked is skipped (evaluate()), so the text says so plainly, with the resume time in local
// time and the account requests really use; otherwise the pick would read as active while it is not.
const blockedTag = (kind: string, until: number | undefined, now: number): string => `${kind === "rate_limit" ? "한도 걸림" : kind === "auth_error" ? "로그인 풀림" : "쓸 수 없음"}${until ? ` · ${clockText(until, now)}까지` : ""}`;
const manualText = (m: Manual | undefined, now: number, names: string[], aliases: Record<string, string>, pool?: Pool, current?: string): string | null => {
	if (!m || (m.until && Date.parse(m.until) <= now)) return null;
	const id = resolveAccount(m.account, names, aliases);
	const l = id ? label(id, undefined, aliases) : m.account;
	const base = `${l}${josa(l, "으로", "로")} 직접 고정${m.until ? ` · ${clockText(Date.parse(m.until), now)}까지` : ""}`;
	const b = id ? pool?.blocked[id] : undefined;
	if (!id || !b) return base;
	const by = blockedKind(b.reason) === "auth_error" ? "로그인이 풀려서" : "한도에 걸려서";
	// 고정 holds: requests do not move, the work waits
	if (current === id) return `${base} · ${by} ${b.until ? `${clockText(b.until, now)}까지` : "지금은"} 멈춰 있어요`;
	const cur = current ? label(current, undefined, aliases) : undefined;
	return `${base} · ${by} ${b.until ? `${clockText(b.until, now)}까지` : "지금은"} 못 써요${cur ? `, 지금은 ${cur}${josa(cur, "으로", "로")} 요청해요` : ""}`;
};

// The chosen account in words: where requests go instead while it is blocked, else who chose it.
function chosenText(chosen: string, used: string | undefined, source: Decision["source"], rule: string | undefined, until: string | undefined, pool: Pool | undefined, now: number, aliases: Record<string, string>): string {
	const b = pool?.blocked[chosen];
	if (b) {
		if (source === "manual" && used === chosen) return `${blockedKind(b.reason) === "auth_error" ? "로그인이 풀려서" : "한도에 걸려서"} ${b.until ? `${clockText(b.until, now)}까지` : "지금은"} 멈춰 있어요. 고정했으니 다른 계정으로 넘어가지 않아요`;
		if (!used || used === chosen) return "지금은 못 써요. 쓸 수 있는 다른 계정이 없어요";
		const u = label(used, undefined, aliases);
		const to = `${u}${josa(u, "으로", "로")} 요청해요`;
		if (blockedKind(b.reason) === "auth_error") return `로그인이 풀려서 ${to}`;
		return b.until ? `한도가 풀리는 ${clockText(b.until, now)}까지 ${to}` : `지금은 한도에 걸려서 ${to}`;
	}
	if (source === "manual") return `직접 골랐어요${until ? ` · ${clockText(Date.parse(until), now)}까지` : ""}`;
	if (source === "script") return "스크립트가 골랐어요";
	if (source === "rule") return rule ? `규칙 "${rule}"으로 골랐어요` : "규칙으로 골랐어요";
	return "자동으로 골랐어요";
}

// `catalog`: the login providers this install offers (providers.ts loginProviders); a provider there can gain an account, and
// only those appear in the 계정 추가 picker. accountsRoute fills it, since reading it may start an OmO process.
export function accountsBody(now = Date.now(), catalog: { id: string; name: string }[] = []) {
	const sticky = stickyAccount(now);
	const pool = readPool(undefined, now);
	const names = pool?.names ?? [];
	// OmO skips a blocked account: this is where requests really go.
	// 고정 mode: requests stay on the pinned account even while it is blocked
	const current = pool ? (hardPinned(now) ? sticky : usedAccount(sticky, names, n => Boolean(pool.blocked[n]), n => pool.lastSuccess[n] ?? 0)) : sticky;
	const aliases = readAliases();
	const usage = getUsage();
	// every logged-in account's windows as OmO's poller last wrote them, not only the one requests use (getUsage is filled
	// only while rules or a script read it); a window whose reset time has passed is an old reading, so it is left out
	const store = readProviderStore();
	const claudeWindows = (name: string) => windowsOf(store.usage, "anthropic-subscription", name).filter(w => w.resets_at === null || w.resets_at > now);
	const fileLeft = (name: string, id: string) => claudeWindows(name).find(w => w.id === id)?.left ?? null;
	const rules = readRules();
	const lab = (n: string) => label(n, undefined, aliases);
	const manual = rules.manual && (!rules.manual.until || Date.parse(rules.manual.until) > now) ? rules.manual : undefined;
	const manualId = manual ? resolveAccount(manual.account, names, aliases) : undefined;
	// a rule names its account by id or alias
	const labAny = (t: string) => {
		const id = resolveAccount(t, names, aliases);
		return id ? lab(id) : t;
	};
	const d = lastDecision();
	const opinion = getScriptOpinion();
	// the owner's pick (a manual pin, even a blocked one), else what dotz decided
	const chosenId = manualId ?? sticky;
	const chosenBlock = chosenId ? pool?.blocked[chosenId] : undefined;
	const chosenSource: Decision["source"] = manualId ? "manual" : d.source;
	const accounts = inOrder(names, rules.order).map((name, i) => {
		const b = pool?.blocked[name];
		return {
			name,
			order: i + 1,
			alias: aliases[name] ?? null,
			label: lab(name),
			current: name === current,
			blocked: b ? blockedKind(b.reason) : null,
			blocked_until: b?.until ? new Date(b.until).toISOString() : null,
			blocked_tag: b ? blockedTag(blockedKind(b.reason), b.until, now) : null,
			five_hour_left: usage[name]?.five_hour_left ?? fileLeft(name, "claude:5h"),
			seven_day_left: usage[name]?.seven_day_left ?? fileLeft(name, "claude:7d"),
		};
	});
	// The Claude subscription group: the same accounts as `accounts` (dotz's own order and labels), shaped like every other
	// provider's group so the card can render all of them the same way.
	const claude = {
		id: "anthropic",
		name: "Claude 구독",
		auth: "oauth" as const,
		multi: true,
		can_add: catalog.some(p => p.id === "anthropic"),
		can_pin: true,
		can_delete: accounts.length > 1,
		accounts: accounts.map(a => ({
			name: a.name,
			label: a.label,
			order: a.order,
			current: a.current,
			pinned: pool?.pinned === a.name,
			blocked: a.blocked,
			blocked_until: a.blocked_until,
			blocked_tag: a.blocked_tag,
			windows: claudeWindows(a.name).length ? claudeWindows(a.name) : [...(a.five_hour_left !== null ? [{ id: "anthropic:5h", label: "5시간", left: a.five_hour_left, resets_at: null }] : []), ...(a.seven_day_left !== null ? [{ id: "anthropic:7d", label: "7일", left: a.seven_day_left, resets_at: null }] : [])],
		})),
	};
	const generic = providerGroups({ ...store, aliases, catalog, now });
	for (const g of generic.providers) for (const a of g.accounts) if (a.blocked) a.blocked_tag = blockedTag(blockedKind(a.blocked), a.blocked_until ? Date.parse(a.blocked_until) : undefined, now);
	return {
		providers: [...(names.length ? [claude] : []), ...generic.providers],
		login_providers: generic.login_providers,
		// "pinned" (고정: manual pick, never moves) or "auto" (자동 전환: rules, and a switch when the account is blocked)
		mode: manualId ? ("pinned" as const) : ("auto" as const),
		// `current` is the account requests really use; `chosen` the one picked (they differ while the pick is blocked)
		chosen: chosenId
			? { name: chosenId, label: lab(chosenId), source: chosenSource, blocked: chosenBlock ? blockedKind(chosenBlock.reason) : null, blocked_until: chosenBlock?.until ? new Date(chosenBlock.until).toISOString() : null, used_instead: current && current !== chosenId ? { name: current, label: lab(current) } : null, text: chosenText(chosenId, current, chosenSource, d.rule, manualId ? manual?.until : undefined, pool, now, aliases) }
			: null,
		// in the owner's order (the fallback order of 자동 전환); `order` is the number shown on the row
		accounts,
		decision: {
			...(d.account ? { account: d.account, label: lab(d.account) } : {}),
			source: d.source,
			source_text: SOURCE_TEXT[d.source],
			...(d.hard ? { hard: true } : {}),
			...(d.rule ? { rule: d.rule } : {}),
			reason: relabel(d.reason, names, aliases),
			at: d.at,
		},
		rules,
		rules_text: (rules.rules ?? []).map((r, index) => ({ index, text: describeRule(r, labAny) })),
		manual_text: manualText(rules.manual, now, names, aliases, pool, current),
		used: current ? { name: current, label: lab(current) } : null,
		script: {
			path: rules.script?.path ?? null,
			timeout_ms: rules.script?.timeout_ms ?? DEFAULT_SCRIPT_TIMEOUT_MS,
			every_minutes: rules.script?.every_minutes ?? DEFAULT_EVERY_MINUTES,
			last: opinion
				? {
						...(opinion.account ? { account: opinion.account, label: lab(opinion.account) } : {}),
						...(opinion.error ? { error: opinion.error, error_text: SCRIPT_ERROR_TEXT[opinion.error] } : {}),
						...(opinion.reason ? { reason: opinion.reason } : {}),
						at: opinion.at,
					}
				: null,
		},
		files: { rules: rulesFile(), aliases: aliasesFile(), decisions: decisionsFile() },
		switches: accountView(MAX_LOG_LINES).switches.map(s => labeledSwitch(s, aliases)),
	};
}
type AccountsBody = ReturnType<typeof accountsBody>;

// ---- changes ----

// OmO's own pin follows the pick, so settings and OmO agree. A write that fails stops the change before dotz's own state moves.
function syncOmoPin(account: string | undefined): void {
	try {
		writeOmoPin(account);
	} catch (e) {
		throw new AccountsError(`OmO의 고정 계정을 바꾸지 못했어요: ${(e as Error).message}`, 500);
	}
}

// The bell/chat text when a 고정 account hits its limit and the work pauses until `until` (ms): which account, until when, and the
// choice to switch to 자동 전환 (its label is answered by the gateway itself, accountAsk). Undefined outside 고정 mode.
export function pinnedLimitAlert(until: number, now = Date.now()): string | undefined {
	if (!hardPinned(now)) return undefined;
	const id = stickyAccount(now);
	if (!id || !readPool(undefined, now)?.blocked[id]) return undefined;
	const l = label(id);
	const at = clockText(until, now);
	const t = msg().accountLimit;
	return [t.question(`${l}${josa(l, "이", "가")}`, at), issueBlock(t.questionTitle, [{ name: t.switchChoice, result: t.switchChoiceNote }, { name: t.waitChoice, result: t.waitChoiceNote(at) }])].join("\n");
}

// What the owner hears when a 고정 account hits its limit: the one-time question while the answer is unset, else the saved answer
// carried out silently — "wait" keeps the pin and posts a plain notice, "switch" turns on 자동 전환 and says it moved. Undefined
// outside 고정 mode, so the orchestrator and the lanes behave the same.
export async function pinnedLimitNotice(until: number, now = Date.now()): Promise<string | undefined> {
	if (!hardPinned(now)) return undefined;
	const id = stickyAccount(now);
	if (!id || !readPool(undefined, now)?.blocked[id]) return undefined;
	const pref = readRules().on_limit;
	if (!pref) return pinnedLimitAlert(until, now);
	const l = label(id);
	const at = clockText(until, now);
	const t = msg().accountLimit;
	if (pref === "wait") return t.wait(l, at);
	await useAccount("auto");
	const next = stickyAccount();
	const to = next && next !== id ? label(next) : undefined;
	return t.switched(to ? `${to}${josa(to, "으로", "로")}` : t.anotherAccount);
}

// One account out: OmO's store first, then everything dotz keeps about it (the manual pick, the order, the alias).
export function removeAccount(name: string): "deleted" | "missing" | "last" {
	if (!name.trim()) return "missing";
	const r = deleteOmoAccount(name);
	if (r !== "deleted") return r;
	const rules = readRules();
	if (rules.manual?.account === name) setManual(undefined);
	if (rules.order?.includes(name)) setOrder(rules.order.filter(n => n !== name));
	if (readAliases()[name]) setAlias(name, "");
	return "deleted";
}

// A manual pick by id or alias; "auto" (or "자동") clears it. Re-evaluates right away.
async function useAccount(text: string, until?: string): Promise<{ auto: true } | { auto?: false; id: string; label: string; applied: boolean }> {
	const t = text.trim();
	if (!t) throw new AccountsError("어느 계정인지 알려 주세요", 400);
	if (/^(auto|자동)$/i.test(t)) {
		await quietly(async () => {
			syncOmoPin(undefined);
			setManual(undefined);
			await checkNow();
		});
		return { auto: true };
	}
	const id = resolveAccount(t, readPool()?.names ?? []);
	if (!id) throw new AccountsError(`그런 계정이 없어요: ${t}`, 400);
	if (until !== undefined && (typeof until !== "string" || Number.isNaN(Date.parse(until)))) throw new AccountsError("until은 ISO 시각이어야 해요 (예: 2026-10-21T18:00:00+09:00)", 400);
	const d = await quietly(async () => {
		syncOmoPin(id);
		setManual(id, undefined, until || undefined);
		return checkNow();
	});
	return { id, label: label(id), applied: d.account === id };
}

function putRules(raw: unknown): void {
	try {
		validateRules(raw);
	} catch (e) {
		throw new AccountsError((e as Error).message, 400);
	}
	writeRules(raw);
}

const readBody = async (req: Request): Promise<Record<string, any>> => {
	try {
		const b = await req.json();
		return b && typeof b === "object" ? (b as Record<string, any>) : {};
	} catch {
		return {};
	}
};

// The /api/accounts routes (the caller has already checked the token). Undefined: not one of them.
export async function accountsRoute(req: Request, url: URL): Promise<Response | undefined> {
	const p = url.pathname;
	if (p !== "/api/accounts" && !["/api/accounts/alias", "/api/accounts/rules", "/api/accounts/use", "/api/accounts/mode", "/api/accounts/on-limit", "/api/accounts/order", "/api/accounts/pin", "/api/accounts/switches"].includes(p)) return undefined;
	// the login providers this install offers, for the 계정 추가 picker (one OmO/omp process, then cached by providers.ts)
	const catalog = async () => (await import("./providers.ts")).loginProviders().catch(() => []);
	try {
		// DELETE /api/accounts/switches?at=<time of the entry> removes one history entry; without `at` it clears the whole history.
		if (req.method === "DELETE" && p === "/api/accounts/switches") {
			const at = url.searchParams.get("at");
			return Response.json({ removed: at === null ? clearSwitches() : deleteSwitch(at) });
		}
		if (req.method === "GET" && p === "/api/accounts") return Response.json(accountsBody(Date.now(), await catalog()));
		// DELETE /api/accounts?provider=<id>&name=<slot>: one account of any provider's pool (Claude keeps its own route below).
		if (req.method === "DELETE" && p === "/api/accounts" && !(url.searchParams.get("provider") ?? "anthropic").startsWith("anthropic")) {
			const provider = url.searchParams.get("provider")!;
			const name = url.searchParams.get("name") ?? "";
			const r = deletePoolAccount(provider, name);
			if (r === "missing") throw new AccountsError(`그런 계정이 없어요: ${name}`, 404);
			if (r === "last") throw new AccountsError("마지막 남은 계정은 지울 수 없어요. 계정 화면에서 로그아웃해 주세요", 409);
			return Response.json(accountsBody(Date.now(), await catalog()));
		}
		// DELETE /api/accounts?name=<id>: removes a subscription account from OmO's store and from dotz's pick, order and alias.
		if (req.method === "DELETE" && p === "/api/accounts") {
			const name = url.searchParams.get("name") ?? "";
			await quietly(async () => {
				const r = removeAccount(name);
				if (r === "missing") throw new AccountsError(`그런 계정이 없어요: ${name}`, 404);
				if (r === "last") throw new AccountsError("마지막 남은 계정은 지울 수 없어요. 계정 화면에서 로그아웃해 주세요", 409);
				await checkNow();
			});
			return Response.json(accountsBody(Date.now(), await catalog()));
		}
		// {provider, account}: OmO's own pinned account for that provider's pool (null clears it). Claude also moves dotz's pick,
		// so its rules and the 고정 mode agree with what OmO runs on.
		if (req.method === "PUT" && p === "/api/accounts/pin") {
			const b = await readBody(req);
			const provider = typeof b.provider === "string" ? b.provider.trim() : "";
			if (!provider) throw new AccountsError("provider가 필요해요", 400);
			const account = typeof b.account === "string" && b.account.trim() ? b.account.trim() : undefined;
			if (provider === "anthropic") await useAccount(account ?? "auto");
			else {
				const r = writeProviderPin(provider, account);
				if (r === "missing") throw new AccountsError(`그런 공급자가 없어요: ${provider}`, 404);
			}
			return Response.json(accountsBody(Date.now(), await catalog()));
		}
		if (req.method === "PUT" && p === "/api/accounts/alias") {
			const b = await readBody(req);
			if (typeof b.key !== "string" || !b.key.trim()) throw new AccountsError("key(계정 id 또는 이메일)가 필요해요", 400);
			if (b.alias !== undefined && b.alias !== null && typeof b.alias !== "string") throw new AccountsError("alias는 글자여야 해요", 400);
			setAlias(b.key.trim(), b.alias ?? "");
			return Response.json(accountsBody(Date.now(), await catalog()));
		}
		if (req.method === "PUT" && p === "/api/accounts/rules") {
			putRules((await readBody(req)).rules);
			return Response.json(accountsBody(Date.now(), await catalog()));
		}
		// 계정 선택 모드: {mode:"auto"} = 자동 전환 (clears the pick), {mode:"pinned", account?} = 고정 (account, else the one requests use now)
		if (req.method === "PUT" && p === "/api/accounts/mode") {
			const b = await readBody(req);
			if (b.mode === "auto") await useAccount("auto");
			else if (b.mode === "pinned") {
				const account = typeof b.account === "string" && b.account.trim() ? b.account : accountsBody().used?.name;
				if (!account) throw new AccountsError("고정할 계정을 골라 주세요", 400);
				await useAccount(account);
			} else throw new AccountsError('mode는 "auto" 또는 "pinned"여야 해요', 400);
			return Response.json(accountsBody(Date.now(), await catalog()));
		}
		// 한도에 걸렸을 때의 선택: {on_limit:"switch"|"wait"} — 고정/자동 전환 모드 자체는 그대로 두고 다음부터 조용히 따라요
		if (req.method === "PUT" && p === "/api/accounts/on-limit") {
			const v = (await readBody(req)).on_limit;
			if (v !== "switch" && v !== "wait") throw new AccountsError('on_limit은 "switch" 또는 "wait"여야 해요', 400);
			setOnLimit(v);
			return Response.json(accountsBody(Date.now(), await catalog()));
		}
		// {order:[id, ...]}: the account order (the fallback order of 자동 전환); every id must be an account in OmO's pool
		if (req.method === "PUT" && p === "/api/accounts/order") {
			const order = (await readBody(req)).order;
			const names = readPool()?.names ?? [];
			if (!Array.isArray(order) || order.some(x => typeof x !== "string" || !names.includes(x))) throw new AccountsError("order는 계정 id 목록이어야 해요", 400);
			await quietly(async () => {
				setOrder(order);
				await checkNow();
			});
			return Response.json(accountsBody(Date.now(), await catalog()));
		}
		if (req.method === "POST" && p === "/api/accounts/use") {
			const b = await readBody(req);
			await useAccount(String(b.account ?? ""), b.until === undefined || b.until === null ? undefined : String(b.until));
			return Response.json(accountsBody(Date.now(), await catalog()));
		}
		return undefined;
	} catch (e) {
		if (e instanceof AccountsError) return Response.json({ error: e.message }, { status: e.status });
		return Response.json({ error: (e as Error).message }, { status: 500 });
	}
}

// ---- chat text ----

function stateText(a: AccountsBody["accounts"][number], now: number): string {
	if (!a.blocked) return "쓸 수 있어요";
	const until = a.blocked_until ? ` (${clockText(Date.parse(a.blocked_until), now)}까지)` : "";
	if (a.blocked === "rate_limit") return `한도에 걸렸어요${until}`;
	if (a.blocked === "auth_error") return `다시 로그인해야 해요${until}`;
	return `막혀 있어요: ${a.blocked}${until}`;
}
const leftText = (a: AccountsBody["accounts"][number]): string => {
	const parts = [a.five_hour_left !== null ? `5시간 ${pct(a.five_hour_left)}` : "", a.seven_day_left !== null ? `주간 ${pct(a.seven_day_left)}` : ""].filter(Boolean);
	return parts.length ? `${parts.join(" · ")} 남음` : "남은 한도는 아직 몰라요";
};
// Why the current account, with no raw ids: only the owner-driven layers have a reason worth quoting.
const whyText = (d: AccountsBody["decision"]): string => (d.source === "auto" ? "자동으로 골랐어요 (직접 고정·스크립트·규칙에 걸리는 게 없어요)" : d.reason.startsWith(d.source_text) ? d.reason : `${d.source_text} · ${d.reason}`);

// "/account": the whole picture in Korean, labels first.
export function accountText(now = Date.now()): string {
	const b = accountsBody(now);
	if (!b.accounts.length) return "쓰는 Claude 구독 계정이 없어요. 다른 공급자 계정은 설정 → 계정에서 봐요.";
	const cur = b.accounts.find(a => a.current);
	const lines = [`지금 계정: ${cur ? cur.label : "아직 안 골랐어요"}`, `이유: ${whyText(b.decision)}`];
	if (b.manual_text) lines.push(`직접 고정: ${b.manual_text} (고정을 풀려면 /account auto)`);
	if (b.chosen && b.chosen.used_instead) lines.push(`고른 계정: ${b.chosen.label} · ${b.chosen.text}`);
	lines.push("계정:", ...b.accounts.map(a => `- ${a.label}${a.current ? " (지금)" : ""} · ${stateText(a, now)} · ${leftText(a)}`));
	lines.push(b.rules_text.length ? "규칙:" : "규칙: 없음", ...b.rules_text.map(r => `${r.index + 1}. ${r.text}`));
	lines.push(b.script.path ? `스크립트: ${b.script.path}${b.script.last?.error_text ? ` (마지막: ${b.script.last.error_text})` : ""}` : "스크립트: 없음");
	const differ = b.accounts.filter(a => a.label !== a.name);
	if (differ.length) lines.push(`-# 계정 id: ${b.accounts.map(a => (a.label !== a.name ? `${a.label} = ${a.name}` : a.name)).join(", ")}`);
	return lines.join("\n");
}

const pickedText = (r: Awaited<ReturnType<typeof useAccount>>): string => {
	if (r.auto) return "자동 전환으로 바꾸었어요. 이제 규칙과 한도에 따라 계정을 골라요.";
	const josaTo = josa(r.label, "으로", "로");
	if (r.applied) return `${r.label}${josaTo} 고정했어요. 한도에 걸리면 다른 계정으로 넘어가지 않고 대체 모델 순서를 따라요(답장 초안은 풀릴 때까지 멈춰요). 자동 전환으로 돌리려면 "계정 자동으로"라고 해 주세요.`;
	const cur = accountsBody().accounts.find(a => a.current);
	return `${r.label}${josaTo} 고정해 뒀지만 지금은 쓸 수 없어서(한도 등) ${cur ? cur.label : "다른 계정"}을 쓰고 있어요.`;
};

// "/account", "/account auto", "/account alias <id> <별칭>", "/account <id|alias>".
export async function accountCommand(rest: string): Promise<string> {
	const t = rest.trim();
	if (!t) return accountText();
	const alias = t.match(/^(?:alias|별칭)\s+(\S+)(?:\s+([\s\S]+))?$/i);
	if (alias) {
		const names = readPool()?.names ?? [];
		const id = resolveAccount(alias[1], names) ?? (alias[1].includes("@") ? alias[1] : undefined);
		if (!id) throw new AccountsError(`그런 계정이 없어요: ${alias[1]}`, 400);
		const name = alias[2]?.trim() ?? "";
		setAlias(id, name);
		return name ? `별칭을 정했어요: ${id} → ${name}` : `별칭을 지웠어요: ${id}`;
	}
	return pickedText(await useAccount(t));
}

// ---- chat requests answered by the gateway itself ----

type AccountAsk = { kind: "show" } | { kind: "auto" } | { kind: "wait" } | { kind: "use"; account: string } | { kind: "other" };

const TAIL = /\s*(?:해\s*줘|해\s*주세요|해\s*줄래요?|해\s*봐|해요|해라|해|줘|주세요|줄래요?|봐|부탁(?:해요|해|드려요)?|할래요?|하자)$/;
const VERB = "(?:바꿔|바꾸자?|바꿀래|전환|변경|갈아타|옮겨|돌려|써|쓰자|쓸래|사용|고정|선택|골라)";
const SHOW = [/^(?:(?:지금|현재)\s*)?(?:무슨|어떤|뭔|어느)\s*계정(?:이야|이에요|이지|이니|인가요|인지|써|쓰고\s*있어요?|쓰고\s*있니)?$/, /^(?:지금|현재)\s*계정(?:\s*(?:뭐야|뭐에요|뭐예요|뭐지|알려|보여|확인|상태))?$/, /^계정\s*(?:확인|상태|알려|보여)$/];
const AUTO = /^(?:자동\s*전환(?:으로)?(?:\s*바꾸기)?|자동\s*계정(?:으로)?|계정(?:을|은)?\s*자동(?:으로)?|계정\s*자동\s*(?:전환|선택)?|switch\s*to\s*automatic)(?:\s*(?:바꿔|전환|돌려|돌려놔|설정|맞춰|선택))?$/i;
// The other answer to the pinned-limit question: keep waiting (saved so the question is asked once).
const WAIT = /^(?:(?:그대로\s*)?기다리기|keep\s+waiting)$/i;
const OTHER = [new RegExp(`^(?:(?:지금|현재)\\s*)?계정(?:을)?\\s*${VERB}$`), new RegExp(`^(?:다른|딴|반대|다음)\\s*계정(?:으로|로)?(?:\\s*${VERB})?$`)];

// Pure: a short owner message that asks about or changes the account, else undefined (the message goes to the orchestrator).
// A target counts only when it is a known account id or alias, so "깃허브 계정으로 로그인하는 법 알려줘" is not a request.
export function accountAsk(text: string, names: string[], aliases: Record<string, string> = {}): AccountAsk | undefined {
	const raw = text.trim();
	if (!raw || raw.length > 40 || /[\n\r]/.test(raw)) return undefined;
	const t = raw.replace(/^\d{1,2}\)\s*/, "").replace(/[?？!！.。~…,]+$/g, "").replace(/\s+/g, " ").trim().replace(TAIL, "").trim();
	if (!t) return undefined;
	if (SHOW.some(r => r.test(t))) return { kind: "show" };
	if (AUTO.test(t)) return { kind: "auto" };
	if (WAIT.test(t)) return { kind: "wait" };
	const cands = names.flatMap(n => [{ id: n, text: n }, ...(aliases[n] ? [{ id: n, text: aliases[n] }] : [])]).sort((a, b) => b.text.length - a.text.length);
	for (const c of cands) {
		const cand = c.text.trim().split(/\s+/).map(escape).join("\\s*");
		if (new RegExp(`^(?:(?:지금|이제)\\s*)?(?:계정(?:을|은)?\\s+)?${cand}(?:\\s*계정)?(?:(?:으로|로)(?:\\s*${VERB})?|\\s+${VERB})$`, "i").test(t)) return { kind: "use", account: c.id };
	}
	if (OTHER.some(r => r.test(t))) return { kind: "other" };
	return undefined;
}

// The gateway's answer to an AccountAsk (may change the manual pick).
export async function accountAnswer(ask: AccountAsk): Promise<string> {
	// Answering the pinned-limit question remembers the answer, so it is asked once (both choices).
	if (ask.kind === "auto") {
		setOnLimit("switch");
		return pickedText(await useAccount("auto"));
	}
	if (ask.kind === "wait") {
		setOnLimit("wait");
		return msg().accountLimit.waitAnswer;
	}
	if (ask.kind === "use") return pickedText(await useAccount(ask.account));
	const b = accountsBody();
	if (!b.accounts.length) return "쓰는 Claude 구독 계정이 없어요. 다른 공급자 계정은 설정 → 계정에서 봐요.";
	const cur = b.accounts.find(a => a.current);
	if (ask.kind === "show") return `지금은 ${cur ? `${cur.label}${josa(cur.label, "을", "를")} 쓰고 있어요` : "계정을 아직 안 골랐어요"}. ${whyText(b.decision)}`;
	const others = b.accounts.filter(a => !a.current);
	const usable = others.filter(a => !a.blocked);
	if (usable.length === 1) return pickedText(await useAccount(usable[0].name));
	if (!others.length) return `쓸 수 있는 계정이 ${cur ? cur.label : "하나"}뿐이라 바꿀 수 없어요.`;
	return `어느 계정으로 바꿀까요? ${others.map(a => `${a.label}${a.blocked ? "(지금은 막힘)" : ""}`).join(", ")} 중에서 골라 주세요. 예: "${others[0].label}${josa(others[0].label, "으로", "로")}"`;
}
