// How a new session gets its Claude subscription account when several are logged in.
// Three values are OmO's own and live in its settings.json (`anthropicSubscriptionProvider.accountStrategy`): "cache-affine"
// (OmO's default; the key is left out), "fill-first" and "round-robin". OmO rejects any other value there, so the fourth,
// "usage-balanced", is dotz's and is kept in <DATA_DIR>/accounts/strategy.json: a new session, lane or orchestrator
// conversation is pinned to the logged-in account with the most room left (lowest 5-hour use, then lowest 7-day use, as
// OmO's subscription-usage.json last recorded them). A session that already runs keeps its account, so its prompt cache
// stays. Off unless the owner picks it; 고정 mode always wins.
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { authFile } from "./apikey-policy.ts";
import { DATA_DIR, writeAtomic } from "./config.ts";

// biome-ignore lint/suspicious/noExplicitAny: OmO's files are read as loose JSON
type Json = any;

export const OMO_STRATEGIES = ["cache-affine", "fill-first", "round-robin"] as const;
export const STRATEGIES = [...OMO_STRATEGIES, "usage-balanced"] as const;
export type Strategy = (typeof STRATEGIES)[number];
export const isStrategy = (v: unknown): v is Strategy => (STRATEGIES as readonly unknown[]).includes(v);

export const omoSettingsFile = () => join(dirname(authFile()), "settings.json");
export const strategyFile = () => join(DATA_DIR, "accounts", "strategy.json");
const usageFile = () => join(dirname(authFile()), "subscription-usage.json");

function jsonOf(file: string): Json {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return undefined;
	}
}

export function readStrategy(): Strategy {
	if (jsonOf(strategyFile())?.strategy === "usage-balanced") return "usage-balanced";
	const v = jsonOf(omoSettingsFile())?.anthropicSubscriptionProvider?.accountStrategy;
	return (OMO_STRATEGIES as readonly unknown[]).includes(v) ? v : "cache-affine";
}

// "usage-balanced" touches only dotz's file. An OmO value clears dotz's file and writes OmO's key; "cache-affine" removes
// the key, so the file reads as it did before the setting was ever used. A settings.json that is not valid JSON is not rewritten.
export function writeStrategy(value: Strategy): void {
	if (value === "usage-balanced") {
		mkdirSync(dirname(strategyFile()), { recursive: true });
		writeAtomic(strategyFile(), `${JSON.stringify({ strategy: value }, null, 2)}\n`);
		return;
	}
	rmSync(strategyFile(), { force: true });
	const file = omoSettingsFile();
	const text = existsSync(file) ? readFileSync(file, "utf8") : "";
	let settings: Json = {};
	if (text.trim()) {
		try {
			settings = JSON.parse(text);
		} catch {
			throw new Error("OmO settings.json을 읽지 못해서 바꾸지 않았어요");
		}
	}
	const before = JSON.stringify(settings);
	const section = { ...(settings.anthropicSubscriptionProvider ?? {}) };
	if (value === "cache-affine") delete section.accountStrategy;
	else section.accountStrategy = value;
	if (Object.keys(section).length) settings.anthropicSubscriptionProvider = section;
	else delete settings.anthropicSubscriptionProvider;
	if (JSON.stringify(settings) === before) return;
	mkdirSync(dirname(file), { recursive: true });
	writeAtomic(file, `${JSON.stringify(settings, null, 2)}\n`);
}

// Pure: the account with the most room among `names` (the usable ones, in the owner's order). Lowest 5-hour use first, a tie
// by lowest 7-day use, then the owner's order. A window whose reset time has passed counts as unused. An account with no
// 5-hour reading ranks after every account that has one; when none has one, the first name is returned.
export function balancedAccount(names: string[], usage: Json, now = Date.now()): string | undefined {
	const used = (name: string, id: string): number | undefined => {
		const windows = usage?.accounts?.[`anthropic-subscription/${name}`]?.windows;
		const w = Array.isArray(windows) ? windows.find((x: Json) => x?.id === id) : undefined;
		if (typeof w?.usedPercent !== "number" || !Number.isFinite(w.usedPercent)) return undefined;
		const reset = typeof w.resetsAt === "number" ? w.resetsAt : typeof w.resetsAt === "string" ? Date.parse(w.resetsAt) : Number.NaN;
		return Number.isFinite(reset) && reset <= now ? 0 : w.usedPercent;
	};
	return names
		.map((name, i) => ({ name, i, five: used(name, "claude:5h"), seven: used(name, "claude:7d") ?? 0 }))
		.sort((a, b) => Number(a.five === undefined) - Number(b.five === undefined) || (a.five ?? 0) - (b.five ?? 0) || a.seven - b.seven || a.i - b.i)[0]?.name;
}

// The account a new session should start on under "usage-balanced"; undefined under any other strategy or with nothing usable.
export function balancedPick(names: string[], blocked: Record<string, unknown>, now = Date.now()): string | undefined {
	if (readStrategy() !== "usage-balanced") return undefined;
	return balancedAccount(names.filter(n => !blocked[n]), jsonOf(usageFile()), now);
}
