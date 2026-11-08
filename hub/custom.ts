// The owner's custom layer ("웹 맞춤"): home cards, sidebar pins and routines kept as plain files in <DATA_DIR>/custom.
// Everything is read fresh on each request (hot reload); a missing folder is an empty layer. A bad file never throws: it
// comes back as an error entry. Data commands run through watch.ts exec with an in-memory cache; routines are kept as
// `[routine:<id>:<hash6>] ` entries of hub/schedule.ts. customRoute() takes its gateway state as deps so tests can call it.
import { type ComputerGroup, computerGroups, type PeerProjects, type RemoteProject } from "./custom-computers.ts";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { BgWork } from "./bgwork.ts";
import { cfg, DATA_DIR, expand, HOME, log, paths, TEMPLATES, TZ, writeAtomic } from "./config.ts";
import { loadFeatureDirs } from "./featuredirs.ts";
import { loadProjectInfo, type ProjectInfo } from "./projectinfo.ts";
import { loadProjects, type ProjectRecord } from "./projects.ts";
import { addSchedule, listSchedules, removeSchedule, type Schedule } from "./schedule.ts";
import { newestRules, reportHead, ruleTitle } from "./custom-text.ts";
import { exec, listWatches } from "./watch.ts";
import { getSetup, homeChannel } from "./workchannels.ts";

const VIEWS = ["text", "stat", "list", "kv"] as const;
export type View = (typeof VIEWS)[number];
type CardAction = { label: string; command?: string; prompt?: string; confirm?: boolean };
type CardSpec = { title: string; note?: string; view: View; text?: string; command?: string; cwd?: string; every_minutes: number; timeout_seconds: number; link?: string; order: number; actions: CardAction[] };
type CardEntry = { id: string; file: string; error: string } | { id: string; file: string; spec: CardSpec; renderFile?: string; rev: string };
type PinProject = { name: string; path?: string; channel?: string; note?: string; computer?: string };
type Routine = { id: string; name: string; prompt: string; target: string; schedule?: { every_minutes: number } | { at: string } };
export type Link = { name: string; url: string };
type Pins = { projects: PinProject[]; hide_projects: string[]; routines: Routine[]; links: Link[] };
type CustomError = { file: string; error: string };
type ProjectLane = { name: string; title?: string; status: string; live: boolean; startedAt?: string; lastReportAt?: string; waiting?: boolean; lastText: string; reports: number; channel?: string };
export type Project = { key: string; name: string; path?: string; note?: string; computer?: string; pinned: boolean; builtin?: boolean; channel?: { id: string; name: string }; record?: ProjectRecord; recordKey?: string; lanes: ProjectLane[] };
type ChannelsIn = { work?: Record<string, string>; homes?: Record<string, string>; lanes?: Record<string, string>; threads?: Record<string, { parent?: string; name?: string }> };
export type CustomDeps = {
	lanes: () => Array<Record<string, unknown>>;
	channels: () => ChannelsIn;
	/** The main assistant's background work (hub/bgwork.ts); a project page lists what is tied to it. */
	work?: () => BgWork[];
	send: (target: "main" | `lane:${string}`, text: string, login: string) => Promise<void>;
	machine?: () => string; // this gateway's machine name (hub/machine-name.ts), the computer its projects belong to
	peerProjects?: () => Promise<PeerProjects[]>; // the other computers with their projects (hub/peer-projects.ts)
};

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_CARDS = 30;
const MAX_CARD_BYTES = 16 * 1024;
const MAX_ACTIONS = 4;
const MAX_AUTO_PROJECTS = 12;
const ROUTINE_TAG = /^\[routine:([a-z0-9-]+):([0-9a-f]{6})\] /;

const customDir = () => join(DATA_DIR, "custom");
export const customDirLabel = () => (customDir().startsWith(`${HOME}/`) ? `~${customDir().slice(HOME.length)}` : customDir());
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, min: number, max: number): string | undefined => (typeof v === "string" && v.trim().length >= min && v.trim().length <= max ? v.trim() : undefined);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---- cards -----------------------------------------------------------------------------------------------------------
function parseCard(raw: string): CardSpec | string {
	let j: unknown;
	try {
		j = JSON.parse(raw);
	} catch (e) {
		return `JSON을 읽을 수 없어요: ${msg(e)}`;
	}
	if (!isObj(j)) return "카드는 JSON 객체여야 해요";
	const title = str(j.title, 1, 40);
	if (!title) return "title은 1~40자여야 해요";
	const spec: CardSpec = { title, view: "text", every_minutes: 10, timeout_seconds: 10, order: 0, actions: [] };
	if (j.note !== undefined) {
		if (typeof j.note !== "string" || j.note.length > 120) return "note는 120자 이하 글이어야 해요";
		spec.note = j.note;
	}
	if (j.view !== undefined) {
		if (!(VIEWS as readonly unknown[]).includes(j.view)) return `view는 ${VIEWS.join(" | ")} 중 하나여야 해요`;
		spec.view = j.view as View;
	}
	for (const k of ["text", "command", "cwd"] as const) {
		if (j[k] === undefined) continue;
		if (typeof j[k] !== "string") return `${k}는 글이어야 해요`;
		if (k !== "text" && !(j[k] as string).trim()) return `${k}가 비어 있어요`;
		spec[k] = j[k] as string;
	}
	if (j.every_minutes !== undefined) {
		if (typeof j.every_minutes !== "number" || !(j.every_minutes >= 1)) return "every_minutes는 1 이상 숫자여야 해요";
		spec.every_minutes = j.every_minutes;
	}
	if (j.timeout_seconds !== undefined) {
		if (typeof j.timeout_seconds !== "number" || !(j.timeout_seconds >= 1 && j.timeout_seconds <= 60)) return "timeout_seconds는 1~60 사이 숫자여야 해요";
		spec.timeout_seconds = j.timeout_seconds;
	}
	if (j.link !== undefined) {
		if (typeof j.link !== "string" || !/^(https?:\/\/\S+|#\S+)$/.test(j.link)) return "link는 http(s) 주소나 #화면 이어야 해요";
		spec.link = j.link;
	}
	if (j.order !== undefined) {
		if (typeof j.order !== "number" || !Number.isFinite(j.order)) return "order는 숫자여야 해요";
		spec.order = j.order;
	}
	if (j.actions !== undefined) {
		if (!Array.isArray(j.actions) || j.actions.length > MAX_ACTIONS) return `actions는 ${MAX_ACTIONS}개까지 배열이어야 해요`;
		for (const [i, a] of j.actions.entries()) {
			const label = isObj(a) ? str(a.label, 1, 20) : undefined;
			if (!isObj(a) || !label) return `actions[${i}]: label은 1~20자여야 해요`;
			if ((a.command === undefined) === (a.prompt === undefined)) return `actions[${i}]: command나 prompt 중 하나만 써요`;
			if (a.command !== undefined && (typeof a.command !== "string" || !a.command.trim())) return `actions[${i}]: command가 비어 있어요`;
			if (a.prompt !== undefined && (typeof a.prompt !== "string" || !a.prompt.trim() || a.prompt.length > 4000)) return `actions[${i}]: prompt는 1~4000자여야 해요`;
			if (a.confirm !== undefined && typeof a.confirm !== "boolean") return `actions[${i}]: confirm은 true/false여야 해요`;
			spec.actions.push({ label, ...(a.command !== undefined ? { command: a.command as string } : { prompt: a.prompt as string }), ...(a.confirm ? { confirm: true } : {}) });
		}
	}
	return spec;
}

// Cards in id order (cards/<id>.json or cards/<id>/card.json [+ render.js]); more than MAX_CARDS goes to `errors`.
export function readCards(errors: CustomError[] = []): CardEntry[] {
	const dir = join(customDir(), "cards");
	let names: { name: string; dir: boolean }[];
	try {
		names = readdirSync(dir, { withFileTypes: true }).filter(d => !d.name.startsWith(".") && (d.isDirectory() || d.name.endsWith(".json"))).map(d => ({ name: d.name, dir: d.isDirectory() })).sort((a, b) => a.name.localeCompare(b.name));
	} catch {
		return [];
	}
	const out: CardEntry[] = [];
	const seen = new Set<string>();
	for (const n of names) {
		const id = n.dir ? n.name : n.name.slice(0, -5);
		const rel = n.dir ? `cards/${n.name}/card.json` : `cards/${n.name}`;
		if (out.length >= MAX_CARDS) {
			errors.push({ file: rel, error: `카드는 ${MAX_CARDS}개까지만 보여요` });
			continue;
		}
		if (!ID.test(id)) {
			out.push({ id, file: rel, error: "id는 영문 소문자·숫자·하이픈 40자 이하여야 해요" });
			continue;
		}
		if (seen.has(id)) {
			out.push({ id, file: rel, error: `id ${id}가 겹쳐요 (파일과 폴더 중 하나만 두세요)` });
			continue;
		}
		seen.add(id);
		const file = join(dir, n.dir ? join(n.name, "card.json") : n.name);
		let raw: string;
		try {
			if (statSync(file).size > MAX_CARD_BYTES) {
				out.push({ id, file: rel, error: "카드 파일이 16KB를 넘어요" });
				continue;
			}
			raw = readFileSync(file, "utf8");
		} catch (e) {
			out.push({ id, file: rel, error: n.dir ? "card.json을 읽을 수 없어요" : msg(e) });
			continue;
		}
		const spec = parseCard(raw);
		if (typeof spec === "string") {
			out.push({ id, file: rel, error: spec });
			continue;
		}
		const renderFile = n.dir && existsSync(join(dir, n.name, "render.js")) ? join(dir, n.name, "render.js") : undefined;
		out.push({ id, file: rel, spec, ...(renderFile ? { renderFile } : {}), rev: renderFile ? String(Math.floor(statSync(renderFile).mtimeMs)) : "0" });
	}
	return out;
}

// ---- card files written from the web (POST / PUT / DELETE /api/custom/cards) -----------------------------------------
// A card the owner adds from 홈 is the same plain file a hand-written one is: cards/<id>.json, or cards/<id>/card.json when
// the folder form already exists (its render.js stays). Only the keys a card file may carry are written, validated by the
// same parser that reads them, so a saved card never comes back as an error entry.
const CARD_KEYS = ["title", "note", "view", "text", "command", "cwd", "every_minutes", "timeout_seconds", "link", "order", "actions"] as const;
const ACTION_KEYS = ["label", "command", "prompt", "confirm"] as const;
export type CardFile = { id: string; file: string; dir: boolean };

// Where a card's file is now: the folder form wins over a loose file of the same id, as readCards() lists them.
export function cardFile(id: string): CardFile | undefined {
	if (!ID.test(id)) return undefined;
	const dir = join(customDir(), "cards");
	if (existsSync(join(dir, id, "card.json")) || (existsSync(join(dir, id)) && statSync(join(dir, id)).isDirectory())) return { id, file: join(dir, id, "card.json"), dir: true };
	if (existsSync(join(dir, `${id}.json`))) return { id, file: join(dir, `${id}.json`), dir: false };
	return undefined;
}

// The file's own JSON, for the editor; a file that does not parse comes back as `raw` text.
export function readCardFile(id: string): { id: string; file: string; spec?: Record<string, unknown>; raw?: string; error?: string } | undefined {
	const f = cardFile(id);
	if (!f) return undefined;
	const rel = f.dir ? `cards/${id}/card.json` : `cards/${id}.json`;
	let raw: string;
	try {
		raw = readFileSync(f.file, "utf8");
	} catch (e) {
		return { id, file: rel, error: msg(e) };
	}
	try {
		const j = JSON.parse(raw);
		return isObj(j) ? { id, file: rel, spec: j } : { id, file: rel, raw, error: "카드는 JSON 객체여야 해요" };
	} catch (e) {
		return { id, file: rel, raw, error: `JSON을 읽을 수 없어요: ${msg(e)}` };
	}
}

// The card file's content from a web form: only the known keys, empty strings dropped, numbers as numbers.
function cardFileBody(body: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const k of CARD_KEYS) {
		let v = body[k];
		if (v === undefined || v === null) continue;
		if (k === "actions") {
			if (!Array.isArray(v)) continue;
			const acts = v.map(a => {
				const o: Record<string, unknown> = {};
				if (isObj(a)) for (const ak of ACTION_KEYS) if (a[ak] !== undefined && a[ak] !== null && !(typeof a[ak] === "string" && !(a[ak] as string).trim() && ak !== "label")) o[ak] = a[ak];
				return o;
			});
			if (acts.length) out.actions = acts;
			continue;
		}
		if (typeof v === "string") {
			if (k === "every_minutes" || k === "timeout_seconds" || k === "order") {
				if (!v.trim()) continue;
				v = Number(v);
			} else if (!v.trim() && k !== "text") continue;
		}
		out[k] = v;
	}
	return out;
}

// An id from the title (its latin letters and digits), else card-<n>; never one that is taken.
function freeCardId(title: string): string {
	const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
	const base = slug && /^[a-z0-9]/.test(slug) ? slug : "card";
	if (base !== "card" && !cardFile(base)) return base;
	for (let n = 1; ; n++) if (!cardFile(`${base}-${n}`)) return `${base}-${n}`;
}

export function saveCardFile(id: string | undefined, body: Record<string, unknown>, create: boolean): { ok: true; id: string } | { ok: false; status: number; error: string } {
	const content = cardFileBody(body);
	const spec = parseCard(JSON.stringify(content));
	if (typeof spec === "string") return { ok: false, status: 400, error: spec };
	if (id !== undefined && !ID.test(id)) return { ok: false, status: 400, error: "id는 영문 소문자·숫자·하이픈 40자 이하여야 해요" };
	const cur = id ? cardFile(id) : undefined;
	if (create && cur) return { ok: false, status: 409, error: `id ${id}는 이미 있어요` };
	if (!create && !cur) return { ok: false, status: 404, error: `card ${id} not found` };
	if (create && !id && readCards().length >= MAX_CARDS) return { ok: false, status: 400, error: `카드는 ${MAX_CARDS}개까지만 둘 수 있어요` };
	const finalId = id ?? freeCardId(spec.title);
	const file = cur ? cur.file : join(customDir(), "cards", `${finalId}.json`);
	mkdirSync(join(customDir(), "cards"), { recursive: true });
	writeAtomic(file, `${JSON.stringify(content, null, 2)}\n`);
	for (const k of [...cache.keys()]) if (k.startsWith(`${finalId}\0`)) cache.delete(k);
	return { ok: true, id: finalId };
}

export function deleteCardFile(id: string): boolean {
	const f = cardFile(id);
	if (!f) return false;
	rmSync(f.dir ? join(customDir(), "cards", id) : f.file, { recursive: true, force: true });
	for (const k of [...cache.keys()]) if (k.startsWith(`${id}\0`)) cache.delete(k);
	return true;
}

// ---- data commands (cache + one refresh per card at a time) ----------------------------------------------------------
type Entry = { hasData: boolean; data?: unknown; updated?: number; error?: string; ranAt: number; running?: Promise<void> };
const cache = new Map<string, Entry>();
const cacheKey = (id: string, s: CardSpec) => `${id}\0${s.command}\0${s.cwd ?? ""}`;
const parseOutput = (out: string): unknown => {
	try {
		return JSON.parse(out);
	} catch {
		return out.slice(0, 4000);
	}
};

async function runAction(command: string, spec: CardSpec): Promise<{ code: number; output: string; timedOut: boolean }> {
	try {
		return await exec(["/bin/sh", "-c", command], spec.cwd ? expand(spec.cwd) : undefined, spec.timeout_seconds * 1000, undefined, 500);
	} catch (err) {
		return { code: -1, output: msg(err).slice(-500), timedOut: false };
	}
}

function refresh(id: string, spec: CardSpec): Promise<void> {
	const key = cacheKey(id, spec);
	let e = cache.get(key);
	if (!e) cache.set(key, (e = { hasData: false, ranAt: 0 }));
	if (e.running) return e.running;
	const entry = e;
	entry.running = (async () => {
		let r: { code: number; output: string; timedOut: boolean };
		try {
			r = await exec(["/bin/sh", "-c", spec.command!], spec.cwd ? expand(spec.cwd) : undefined, spec.timeout_seconds * 1000, undefined, 4000);
		} catch (err) {
			r = { code: -1, output: msg(err), timedOut: false };
		}
		entry.ranAt = Date.now();
		if (r.code === 0 && !r.timedOut) {
			entry.data = parseOutput(r.output);
			entry.hasData = true;
			entry.updated = Date.now();
			entry.error = undefined;
		} else entry.error = r.output.slice(-500) || `종료 코드 ${r.code}`;
	})().finally(() => {
		entry.running = undefined;
	});
	return entry.running;
}

export const settleRefreshes = () => Promise.all([...cache.values()].map(e => e.running));

async function cardView(c: Exclude<CardEntry, { error: string }>, force: boolean): Promise<Record<string, unknown>> {
	const { spec } = c;
	const base: Record<string, unknown> = { id: c.id, file: c.file, title: spec.title, ...(spec.note ? { note: spec.note } : {}), view: spec.view, ...(spec.link ? { link: spec.link } : {}), order: spec.order, render: Boolean(c.renderFile), rev: c.rev, actions: spec.actions.map(a => ({ label: a.label, kind: a.command !== undefined ? "command" : "prompt", ...(a.confirm ? { confirm: true } : {}) })) };
	if (!spec.command) return spec.text !== undefined ? { ...base, data: spec.text } : base;
	const key = cacheKey(c.id, spec);
	const e = cache.get(key);
	if (force) {
		await e?.running;
		await refresh(c.id, spec);
	} else if (!e || !e.ranAt) await refresh(c.id, spec);
	else if (!e.running && Date.now() - e.ranAt >= spec.every_minutes * 60_000) void refresh(c.id, spec);
	const cur = cache.get(key)!;
	return {
		...base,
		...(cur.hasData ? { data: cur.data, updated: new Date(cur.updated!).toISOString() } : {}),
		...(cur.error ? { error: cur.error, ...(cur.hasData ? { stale: true } : {}) } : {}),
	};
}

// ---- pins.json -------------------------------------------------------------------------------------------------------
const nonEmpty = (v: unknown, max: number) => str(v, 1, max);

function parseRoutine(v: unknown): Routine | string {
	if (!isObj(v)) return "루틴은 객체여야 해요";
	if (typeof v.id !== "string" || !ID.test(v.id)) return "id는 영문 소문자·숫자·하이픈 40자 이하여야 해요";
	const name = nonEmpty(v.name, 40);
	if (!name) return `루틴 ${v.id}: name은 1~40자여야 해요`;
	if (typeof v.prompt !== "string" || !v.prompt.trim() || v.prompt.length > 4000) return `루틴 ${v.id}: prompt는 1~4000자여야 해요`;
	const target = v.target === undefined ? "main" : v.target;
	if (typeof target !== "string" || !(target === "main" || /^lane:\S+$/.test(target))) return `루틴 ${v.id}: target은 main 또는 lane:<이름>이어야 해요`;
	const r: Routine = { id: v.id, name, prompt: v.prompt, target };
	if (v.schedule !== undefined) {
		const s = v.schedule;
		if (!isObj(s) || (s.every_minutes === undefined) === (s.at === undefined)) return `루틴 ${v.id}: schedule 에는 every_minutes나 at 중 하나만 써요`;
		if (s.at !== undefined) {
			if (typeof s.at !== "string" || !HHMM.test(s.at)) return `루틴 ${v.id}: at은 HH:MM이어야 해요`;
			r.schedule = { at: s.at };
		} else {
			if (typeof s.every_minutes !== "number" || !(s.every_minutes >= 5)) return `루틴 ${v.id}: every_minutes는 5 이상 숫자여야 해요`;
			r.schedule = { every_minutes: s.every_minutes };
		}
	}
	return r;
}

let syncedKey: string | undefined;
const pinsKey = (file: string) => {
	try {
		const st = statSync(file);
		return `${st.mtimeMs}:${st.size}`;
	} catch {
		return "none";
	}
};

function parsePins(): { pins: Pins; errors: CustomError[] } {
	const pins: Pins = { projects: [], hide_projects: [], routines: [], links: [] };
	const errors: CustomError[] = [];
	const bad = (error: string) => errors.push({ file: "pins.json", error });
	const file = join(customDir(), "pins.json");
	if (!existsSync(file)) return { pins, errors };
	let j: unknown;
	try {
		j = JSON.parse(readFileSync(file, "utf8"));
	} catch (e) {
		bad(`JSON을 읽을 수 없어요: ${msg(e)}`);
		return { pins, errors };
	}
	if (!isObj(j)) {
		bad("pins.json은 JSON 객체여야 해요");
		return { pins, errors };
	}
	const list = (k: string): unknown[] => {
		if (j[k] === undefined) return [];
		if (Array.isArray(j[k])) return j[k] as unknown[];
		bad(`${k}는 배열이어야 해요`);
		return [];
	};
	list("projects").forEach((p, i) => {
		const name = isObj(p) ? nonEmpty(p.name, 40) : undefined;
		if (!isObj(p) || !name) return bad(`projects[${i}]: name은 1~40자여야 해요`);
		const path = p.path === undefined ? undefined : nonEmpty(p.path, 300);
		if (p.path !== undefined && !path) return bad(`projects[${i}]: path는 글이어야 해요`);
		if (p.channel !== undefined && (typeof p.channel !== "string" || !/^\d+$/.test(p.channel))) return bad(`projects[${i}]: channel은 디스코드 채널 id 문자열이어야 해요`);
		if (p.note !== undefined && typeof p.note !== "string") return bad(`projects[${i}]: note는 글이어야 해요`);
		if (!path && p.channel === undefined) return bad(`projects[${i}]: path나 channel이 필요해요`);
		const computer = p.computer === undefined ? undefined : nonEmpty(p.computer, 40);
		if (p.computer !== undefined && !computer) return bad(`projects[${i}]: computer는 1~40자 글이어야 해요`);
		pins.projects.push({ name, ...(path ? { path } : {}), ...(p.channel !== undefined ? { channel: p.channel as string } : {}), ...(p.note ? { note: String(p.note) } : {}), ...(computer ? { computer } : {}) });
	});
	list("hide_projects").forEach((h, i) => (typeof h === "string" && h.trim() ? pins.hide_projects.push(h.trim()) : bad(`hide_projects[${i}]: 글이어야 해요`)));
	list("routines").forEach((r, i) => {
		const parsed = parseRoutine(r);
		if (typeof parsed === "string") return bad(`routines[${i}]: ${parsed}`);
		if (pins.routines.some(x => x.id === parsed.id)) return bad(`routines[${i}]: id ${parsed.id}가 겹쳐요`);
		pins.routines.push(parsed);
	});
	list("links").forEach((l, i) => {
		const name = isObj(l) ? nonEmpty(l.name, 40) : undefined;
		if (!isObj(l) || !name) return bad(`links[${i}]: name은 1~40자여야 해요`);
		if (typeof l.url !== "string" || !/^https?:\/\/\S+$/.test(l.url)) return bad(`links[${i}]: url은 http(s) 주소여야 해요`);
		pins.links.push({ name, url: l.url });
	});
	return { pins, errors };
}

// `sync: false` reads without touching the schedules (the feature list only looks).
export function readPins(opts: { sync?: boolean } = {}): { pins: Pins; errors: CustomError[] } {
	const key = pinsKey(join(customDir(), "pins.json"));
	const r = parsePins();
	if (opts.sync !== false && key !== syncedKey) {
		syncedKey = key;
		syncRoutines(r.pins.routines);
	}
	return r;
}

// ---- routine schedules -----------------------------------------------------------------------------------------------
const hashOf = (r: Routine) => createHash("sha1").update(JSON.stringify(r)).digest("hex").slice(0, 6);

function tzOffsetMs(t: number): number {
	const p: Record<string, string> = {};
	for (const x of new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(new Date(t))) p[x.type] = x.value;
	return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
}

// The next HH:MM on the TZ clock after `now`.
export function nextAt(hhmm: string, now = Date.now()): number {
	const [h, m] = hhmm.split(":").map(Number);
	const local = new Date(now + tzOffsetMs(now));
	for (let k = 0; k < 3; k++) {
		const wall = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + k, h, m);
		const utc = wall - tzOffsetMs(wall - tzOffsetMs(now));
		if (utc > now) return utc;
	}
	return now + 86_400_000;
}

function syncRoutines(routines: Routine[]): void {
	try {
		const wanted = new Map(routines.filter(r => r.schedule).map(r => [r.id, r]));
		const kept = new Set<string>();
		for (const s of listSchedules()) {
			if (!s.text.startsWith("[routine:")) continue;
			const m = ROUTINE_TAG.exec(s.text);
			const r = m ? wanted.get(m[1]) : undefined;
			if (m && r && m[2] === hashOf(r) && !kept.has(r.id)) kept.add(r.id);
			else removeSchedule(s.id);
		}
		for (const r of wanted.values()) {
			if (kept.has(r.id)) continue;
			const text = `[routine:${r.id}:${hashOf(r)}] ${r.name}\n${r.prompt}`;
			if ("at" in r.schedule!) addSchedule({ text, at: new Date(nextAt(r.schedule.at)).toISOString(), every_minutes: 1440 });
			else addSchedule({ text, at: new Date(Date.now() + r.schedule!.every_minutes * 60_000).toISOString(), every_minutes: r.schedule!.every_minutes });
		}
	} catch (e) {
		log(`custom: routine schedule sync failed: ${msg(e)}`);
	}
}

// Brings the `[routine:` schedules in line with pins.json now (gateway start, and tests).
export function syncRoutineSchedules(): void {
	const key = pinsKey(join(customDir(), "pins.json"));
	syncedKey = key;
	syncRoutines(parsePins().pins.routines);
}

// ---- projects (pure) -------------------------------------------------------------------------------------------------
type Auto = Project & { newest: number };

// The title of a project, first hit wins (docs/layers.md §2): the stored record, the pinned name, the work channel name,
// the title of its first session, the folder basename. `computer` (this machine's name) is set on every project its pin does not move.
export function projectsView(input: { lanes: Array<Record<string, unknown>>; channels: ChannelsIn; pins: Pins; records?: Record<string, ProjectRecord>; home?: string; tmpDirs?: string[]; computer?: string }): Project[] {
	const home = input.home ?? HOME;
	const tmp = input.tmpDirs ?? ["/tmp", "/private/tmp", "/var/folders", tmpdir()];
	const work = input.channels.work ?? {};
	const homes = input.channels.homes ?? {};
	const laneCh = input.channels.lanes ?? {};
	const norm = (p: string) => {
		const full = p.replace(/^~(?=\/|$)/, home).replace(/(.)\/+$/, "$1");
		return full === home ? "~" : full.startsWith(`${home}/`) ? `~${full.slice(home.length)}` : full;
	};
	const chan = (id: string) => ({ id, name: work[id] ?? id });
	const projects = new Map<string, Auto>();
	const make = (key: string, name: string, path?: string): Auto => {
		const p: Auto = { key, name, ...(path ? { path } : {}), pinned: false, lanes: [], newest: 0 };
		projects.set(key, p);
		return p;
	};
	const lanes = input.lanes.filter(l => typeof l.cwd === "string" && l.cwd && typeof l.name === "string").map(l => ({ l, at: Date.parse(String(l.startedAt ?? "")) || 0 })).sort((a, b) => b.at - a.at);
	const byChannel = (id: string) => [...projects.values()].find(p => p.channel?.id === id);
	const folder = (path: string) => projects.get(`dir:${path}`) ?? make(`dir:${path}`, basename(path), path);
	const isTmp = (p: string) => tmp.some(t => p === t || p.startsWith(`${t.replace(/\/+$/, "")}/`));
	// A worktree lane belongs to the checkout it works for, not to its own ~/.dotz/lanes/<name>/worktree folder; a temp folder is no project.
	const folderOf = (l: Record<string, unknown>, cwd = String(typeof l.repo === "string" && l.repo ? l.repo : l.cwd)) => (isTmp(cwd.replace(/^~(?=\/|$)/, home)) ? undefined : norm(cwd));
	// The one rule for a session's project, every surface reads it from here (docs/layers.md §1): its home channel, the folder only without one.
	for (const { l, at } of lanes) {
		const name = String(l.name), id = homeChannel(name, l.home, homes), path = folderOf(l);
		let p = id ? byChannel(id) : path ? folder(path) : undefined;
		if (id && !p) {
			// A new home channel takes its session's folder as its own; a second channel in the same folder stands alone.
			p = path && !folder(path).channel ? folder(path) : make(`ch:${id}`, work[id] ?? id);
			p.channel = chan(id);
		}
		if (!p) continue;
		p.lanes.push({ name, ...(typeof l.title === "string" && l.title ? { title: l.title } : {}), status: String(l.status ?? ""), live: Boolean(l.live), ...(l.startedAt ? { startedAt: String(l.startedAt) } : {}), ...(l.lastReportAt ? { lastReportAt: String(l.lastReportAt) } : {}), ...(l.pendingAsk ? { waiting: true } : {}), lastText: String(l.lastText ?? "").slice(0, 300), reports: Number(l.reports ?? 0) || 0, ...(laneCh[name] ? { channel: laneCh[name] } : {}) });
		p.newest = Math.max(p.newest, at);
	}
	// A work channel no session is homed in belongs to the folder project named like it ("dotz-개선" -> ~/Code/dotz), else it stands alone.
	for (const [id, name] of Object.entries(work)) {
		if ([...projects.values()].some(p => p.channel?.id === id)) continue;
		const word = name.toLowerCase().split(/[\s\-_.·]+/)[0] ?? "";
		const folders = [...projects.values()].filter(p => p.key.startsWith("dir:") && !p.channel && word.length >= 3 && basename(p.path ?? "").toLowerCase() === word);
		if (folders.length === 1) folders[0]!.channel = chan(id);
		else make(`ch:${id}`, name).channel = chan(id);
	}

	const pinned: Auto[] = [];
	for (const pin of input.pins.projects) {
		const np = pin.path ? norm(pin.path) : undefined;
		const byPath = np ? projects.get(`dir:${np}`) : undefined;
		const byCh = pin.channel ? [...projects.values()].find(p => p.channel?.id === pin.channel) : undefined;
		let p = byPath ?? byCh;
		if (byPath && byCh && byPath !== byCh && !byCh.lanes.length) {
			projects.delete(byCh.key);
			if (pinned.includes(byCh)) pinned.splice(pinned.indexOf(byCh), 1);
		}
		if (!p) p = np ? make(`dir:${np}`, pin.name, np) : make(`ch:${pin.channel}`, pin.name);
		p.name = pin.name;
		p.pinned = true;
		if (pin.note) p.note = pin.note;
		if (pin.computer) p.computer = pin.computer;
		if (np && !p.path) p.path = np;
		if (pin.channel && !p.channel) p.channel = chan(pin.channel);
		if (!pinned.includes(p)) pinned.push(p);
	}
	for (const p of projects.values()) {
		if (!p.pinned) p.name = (p.channel && work[p.channel.id]) || [...p.lanes].reverse().find(l => l.title)?.title || p.name;
		// A project with a work channel keeps its record under the channel (ch:<id>), so it survives the sessions moving
		// between folders; edits go there (recordKey). A record saved under the folder key is still read.
		p.recordKey = p.channel ? `ch:${p.channel.id}` : p.key;
		const record = input.records?.[p.recordKey] ?? input.records?.[p.key];
		if (!record) continue;
		p.record = record;
		if (record.title) p.name = record.title;
	}
	const hidden = new Set(input.pins.hide_projects.map(h => (h.startsWith("dir:") ? `dir:${norm(h.slice(4))}` : h)));
	const auto = [...projects.values()].filter(p => !p.pinned && !hidden.has(p.key)).sort((a, b) => b.newest - a.newest).slice(0, MAX_AUTO_PROJECTS);
	return [...pinned, ...auto].map(({ newest, ...p }) => (input.computer && !p.computer ? { ...p, computer: input.computer } : p));
}

// ---- built-in project: 커스텀 ------------------------------------------------------------------------------------------
// Present on every install, first in the list, no Discord channel and no stored record. It is not a pin and not derived from
// sessions, so hide_projects, PUT /api/projects (key must be ch:/dir:) and the session grouping never touch it. Its page shows
// what the owner has customized; requests made from it are personal (custom layer, features, RULES.md, identity), never the repo.
export const BUILTIN_KEY = "builtin:custom";
export const builtinProject = (): Project => ({ key: BUILTIN_KEY, name: "커스텀", note: "내 취향대로 바꾼 것을 한곳에서 보고, 바꾸고 싶은 건 말로 부탁해요", pinned: true, builtin: true, lanes: [] });

type OverviewItem = { title: string; line?: string; full?: string; bad?: boolean };
type OverviewGroup = { id: string; label: string; empty: string; items: OverviewItem[] };
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const routineWhen = (r: Routine) => (!r.schedule ? "눌러서 실행해요" : "at" in r.schedule ? `매일 ${r.schedule.at}에 해요` : `${r.schedule.every_minutes}분마다 해요`);
const VIEW_KO: Record<View, string> = { text: "글", stat: "숫자", list: "목록", kv: "항목별 값" };
export function builtinDetail() {
	const errors: CustomError[] = [];
	const cards = readCards(errors);
	const { pins } = readPins({ sync: false });
	// Only the owner's own list lines: the file's explanatory text and the rule lines it ships with are not theirs.
	const shipped = new Set((TEMPLATES[paths.rules] ?? "").split("\n").map(l => l.trim()));
	let rules: string[] = [];
	try {
		rules = readFileSync(paths.rules, "utf8").split("\n").map(l => l.trim()).filter(l => /^(?:[-*]|\d+[.)])\s+\S/.test(l) && !shipped.has(l)).map(l => l.replace(/^(?:[-*]|\d+[.)])\s+/, "").replace(/^deny:\s*.*?\s\|\s+/, "막아 둔 명령: "));
	} catch {}
	let ruleTitles: Record<string, unknown> = {};
	try {
		const raw = JSON.parse(readFileSync(paths.ruleTitles, "utf8"));
		if (raw && typeof raw === "object" && !Array.isArray(raw)) ruleTitles = raw;
	} catch {}
	const feats = loadFeatureDirs(DATA_DIR).features.filter(f => f.origin === "personal" && !f.switchFile);
	const id = cfg.identity ?? {};
	const said: OverviewItem[] = [];
	if (id.name?.trim()) said.push({ title: "이름", line: id.name.trim() });
	if (id.tone?.trim()) said.push({ title: "말투", line: clip(id.tone.trim().replace(/\s+/g, " "), 80) });
	if (id.character?.trim()) said.push({ title: "성격", line: clip(id.character.trim().replace(/\s+/g, " "), 80) });
	const groups: OverviewGroup[] = [
		{ id: "cards", label: "홈 카드", empty: "아직 만든 카드가 없어요", items: cards.map(c => ("error" in c ? { title: c.id, line: "파일에 문제가 있어서 카드가 안 보여요", bad: true } : { title: c.spec.title, line: c.spec.note || `홈에 ${VIEW_KO[c.spec.view]}로 보여 줘요` })) },
		{ id: "pins", label: "고정 항목", empty: "사이드바에 고정한 게 없어요", items: [...pins.projects.map(p => ({ title: p.name, line: p.note || "사이드바에 고정한 프로젝트예요" })), ...pins.links.map(l => ({ title: l.name, line: "사이드바에 고정한 링크예요" }))] },
		{ id: "routines", label: "루틴", empty: "아직 만든 루틴이 없어요", items: pins.routines.map(r => ({ title: r.name, line: routineWhen(r) })) },
		{ id: "rules", label: "내 규칙", empty: "아직 정한 규칙이 없어요", items: newestRules(rules).map(r => ({ title: ruleTitle(r, ruleTitles), full: r })) },
		{ id: "features", label: "내 기능", empty: "아직 만든 기능이 없어요", items: feats.map(f => ({ title: f.name, line: f.enabled ? clip(f.what || "내가 만든 기능이에요", 80) : "꺼져 있어요", ...(f.enabled ? {} : { bad: true }) })) },
		{ id: "identity", label: "말투와 성격", empty: "기본 말투와 성격 그대로예요", items: said },
	];
	return { key: BUILTIN_KEY, builtin: true, dir: customDirLabel(), groups };
}

// ---- project page (GET /api/custom/project?key=) --------------------------------------------------------------------
// What one project's page shows beyond the sidebar list: each lane's last report (report.md, which survives a gateway
// restart; a restored lane's lastText is empty, so the old page showed "결과 없음" for lanes that all reported), the
// verification receipts and commits of its folder, the repo state, the open tasks naming it, and what is tied to it.
type GitState = { branch: string; base: string; dirty: number; commits: Array<{ hash: string; at: string; subject: string }>; unmerged: Array<{ branch: string; at: string; ahead: number }> };
type ReceiptIn = { command: string; cwd: string; exitCode: number; ranAt: number };
export type DetailInput = {
	project: Project;
	others: Project[];
	lanes: Array<Record<string, unknown>>;
	reports: Record<string, { text: string; at?: string }>;
	receipts: ReceiptIn[];
	tasks: Array<Record<string, unknown>>;
	routines: Routine[];
	schedules: Schedule[];
	watches: Array<Record<string, unknown>>;
	work?: BgWork[];
	record?: ProjectRecord;
	info?: ProjectInfo;
	channels: ChannelsIn;
	git?: GitState;
	// the gateway's own source checkout: an open task that names no other project is about it
	self?: boolean;
	home?: string;
};
export function projectDetailView(d: DetailInput) {
	const home = d.home ?? HOME;
	const p = d.project;
	const full = (x: string) => x.replace(/^~(?=\/|$)/, home).replace(/(.)\/+$/, "$1");
	const within = (x: string, root: string) => x === root || x.startsWith(`${root}/`);
	const laneNames = new Set(p.lanes.map(l => l.name));
	const rows = d.lanes.filter(l => laneNames.has(String(l.name)));
	const roots = [...(p.path ? [full(p.path)] : []), ...rows.map(l => String(l.cwd ?? "")).filter(Boolean)];
	const lanes = p.lanes.map(pl => {
		const raw = rows.find(r => r.name === pl.name) ?? {};
		const rep = d.reports[pl.name];
		const head = reportHead(rep?.text || pl.lastText);
		const claim = (raw.claim as { state?: string } | undefined)?.state;
		const branch = d.git?.unmerged.find(u => u.branch === `lane/${pl.name}`);
		return {
			name: pl.name, status: pl.status, live: pl.live, waiting: Boolean(pl.waiting), resumable: Boolean(raw.resumable) && !pl.live,
			...(pl.channel ? { channel: pl.channel } : {}),
			...(pl.lastReportAt || rep?.at ? { finishedAt: pl.lastReportAt ?? rep!.at } : {}),
			line: head.line, ...(head.tone ? { tone: head.tone } : {}), body: head.body,
			...(claim === "verified" || claim === "reported" ? { claim } : {}),
			// its lane/<name> branch has commits the base branch does not
			...(branch ? { unmerged: branch.ahead } : {}),
		};
	});
	const at = (x?: string) => Date.parse(x ?? "") || 0;
	const results: Array<Record<string, unknown> & { at: string }> = [];
	for (const l of lanes) if ((l.tone === "done" || l.tone === "fail") && l.finishedAt) results.push({ kind: "report", at: l.finishedAt, lane: l.name, tone: l.tone, title: l.line, text: l.body, verified: l.claim === "verified" });
	const seen = new Set<string>();
	for (const r of [...d.receipts].sort((a, b) => b.ranAt - a.ranAt)) {
		if (!roots.some(root => within(r.cwd, root)) || seen.has(r.command) || seen.size >= 3) continue;
		seen.add(r.command);
		const lane = rows.find(l => within(r.cwd, String(l.cwd ?? "")))?.name;
		results.push({ kind: "verify", at: new Date(r.ranAt).toISOString(), title: r.command.slice(0, 160), ok: r.exitCode === 0, ...(lane ? { lane } : {}) });
	}
	for (const c of d.git?.commits ?? []) results.push({ kind: "commit", at: c.at, title: c.subject, hash: c.hash });
	for (const r of d.info?.results ?? []) results.push({ kind: "note", at: r.at, title: r.text });
	results.sort((a, b) => at(b.at) - at(a.at));

	const lower = (s: string) => s.toLowerCase();
	const termsOf = (x: Project) => [x.name, ...(x.path ? [x.path, basename(x.path)] : []), ...x.lanes.map(l => l.name), ...(x.channel ? [x.channel.name] : [])].filter(t => t.length >= 3).map(lower);
	const mine = termsOf(p);
	const theirs = d.others.filter(o => o.key !== p.key).flatMap(termsOf).filter(t => !mine.includes(t));
	const names = (s: string, terms: string[]) => terms.some(t => lower(s).includes(t));
	const tasks = d.tasks.filter(t => {
		const s = [t.id, t.what, t.next, t.project].filter(x => typeof x === "string").join(" ");
		return names(s, mine) || (d.self && !names(s, theirs));
	}).map(t => ({ id: String(t.id ?? ""), what: String(t.what ?? ""), ...(t.next ? { next: String(t.next) } : {}), ...(t.since ? { since: String(t.since) } : {}) }));

	const laneRef = (s: string) => [...laneNames].some(n => s.includes(`lane:${n}`));
	const threads = p.channel ? Object.entries(d.channels.threads ?? {}).filter(([, t]) => t.parent === p.channel!.id).map(([id, t]) => ({ id, name: String(t.name ?? id) })).slice(0, 10) : [];
	const chTarget = p.channel ? `ch:${p.channel.id}` : undefined;
	const routineRows = d.routines.filter(r => r.target === chTarget || (r.target.startsWith("lane:") && laneNames.has(r.target.slice(5))) || names(r.prompt, mine));
	const routines = routineRows.map(r => ({ id: r.id, name: r.name, target: r.target, ...(r.schedule ? { schedule: r.schedule } : {}) }));
	const scheduleRow = (s: Schedule, routine?: string) => ({ id: s.id, text: s.text.split("\n")[0]!.slice(0, 120), at: s.at, ...(s.every_minutes ? { every_minutes: s.every_minutes } : {}), ...(s.paused ? { paused: true } : {}), ...(routine ? { routine } : {}) });
	const plainSchedules = d.schedules.filter(s => !s.text.startsWith("[routine:") && (laneRef(s.text) || names(s.text, mine) || Boolean(chTarget && s.text.includes(chTarget)))).map(s => scheduleRow(s));
	const routineSchedules = routineRows.flatMap(r => d.schedules.filter(s => s.text.startsWith(`[routine:${r.id}:`)).map(s => scheduleRow(s, r.id)));
	const schedules = plainSchedules;
	const monitors = d.watches.filter(w => p.channel && Array.isArray(w.channels) && w.channels.includes(p.channel.id)).map(w => ({
		id: String(w.id), name: String(w.name ?? w.id), command: String(w.command ?? "").split("\n")[0]!.slice(0, 120), ...(w.script ? { script: String(w.script) } : {}), every_minutes: Number(w.every_minutes) || 0, on: String(w.on ?? "change"),
		...(w.pattern ? { pattern: String(w.pattern) } : {}), ...(w.lastRun ? { lastRun: String(w.lastRun) } : {}), ...(w.lastOk ? { lastOk: String(w.lastOk) } : {}), ...(w.nextAt ? { nextAt: String(w.nextAt) } : {}),
		fails: Number(w.fails) || 0, paused: Boolean(w.paused),
	}));
	const watches = d.watches.filter(w => (typeof w.cwd === "string" && roots.some(r => within(full(w.cwd as string), r))) || names(`${w.name ?? ""} ${w.command ?? ""}`, mine)).map(w => ({ id: String(w.id), name: String(w.name ?? w.id), every_minutes: Number(w.every_minutes) || 0, ...(w.paused ? { paused: true } : {}) }));

	// Background work tied to the project: asked in its channel, or briefed for its folder.
	const work = (d.work ?? []).filter(w => (chTarget && w.target === chTarget) || (w.folder && roots.some(r => within(full(w.folder!), r)))).slice(0, 20);
	const lastActivity = Math.max(0, ...lanes.map(l => at(l.finishedAt)), ...rows.map(l => (l.live ? at(String(l.startedAt ?? "")) : 0)), ...results.map(r => at(r.at)));
	return {
		key: p.key,
		...(d.record ? { record: d.record } : {}),
		...(d.info ? { info: d.info } : {}),
		monitors,
		routines,
		schedules: [...plainSchedules, ...routineSchedules],
		summary: { lanes: lanes.length, running: lanes.filter(l => l.live && l.status !== "idle").length, waiting: lanes.filter(l => l.waiting).length, ...(lastActivity ? { lastActivity: new Date(lastActivity).toISOString() } : {}) },
		lanes,
		work,
		results: results.slice(0, 15),
		...(d.git ? { repo: d.git } : {}),
		tasks,
		linked: { ...(p.channel ? { channel: p.channel } : {}), threads, laneChannels: lanes.filter(l => l.channel).map(l => ({ lane: l.name, id: l.channel! })), routines, schedules, watches },
	};
}

const gitCache = new Map<string, { at: number; v?: GitState }>();
async function gitState(dir: string): Promise<GitState | undefined> {
	const hit = gitCache.get(dir);
	if (hit && Date.now() - hit.at < 15_000) return hit.v;
	const run = async (cmd: string) => {
		const r = await exec(["/bin/sh", "-c", cmd], dir, 5000, undefined, 8000).catch(() => undefined);
		return r && r.code === 0 && !r.timedOut ? r.output.trim() : undefined;
	};
	let v: GitState | undefined;
	const branch = existsSync(dir) ? await run("git rev-parse --abbrev-ref HEAD 2>/dev/null") : undefined;
	if (branch) {
		const base = (await run("git rev-parse --verify -q main >/dev/null && echo main")) || branch;
		const [dirty, log5, refs] = await Promise.all([
			run("git status --porcelain 2>/dev/null | wc -l"),
			run("git log -5 --format='%h%x1f%cI%x1f%s'"),
			run(`git for-each-ref --no-merged=${base} --sort=-committerdate --count=8 --format='%(refname:short) %(committerdate:iso-strict)' refs/heads/lane/`),
		]);
		const split = (s?: string) => (s ? s.split("\n").filter(Boolean).map(l => l.split("\x1f")) : []);
		const unmerged = await Promise.all((refs ? refs.split("\n").filter(Boolean).map(l => l.split(" ")) : []).map(async ([b, at]) => ({ branch: b!, at: at!, ahead: Number(await run(`git rev-list --count ${base}..'${b!.replace(/'/g, "")}'`)) || 0 })));
		v = { branch, base, dirty: Number(dirty) || 0, commits: split(log5).map(([hash, at, subject]) => ({ hash: hash!, at: at!, subject: (subject ?? "").slice(0, 200) })), unmerged };
	}
	gitCache.set(dir, { at: Date.now(), v });
	return v;
}

function readReceipts(): ReceiptIn[] {
	const dir = join(DATA_DIR, "receipts");
	try {
		return readdirSync(dir).filter(f => f.endsWith(".json")).map(f => join(dir, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs).slice(0, 200).flatMap(f => {
			try {
				const r = JSON.parse(readFileSync(f, "utf8"));
				return typeof r.command === "string" && typeof r.cwd === "string" ? [{ command: r.command, cwd: r.cwd, exitCode: Number(r.exitCode), ranAt: Number(r.ranAt) || 0 }] : [];
			} catch {
				return [];
			}
		});
	} catch {
		return [];
	}
}

function readReport(name: string): { text: string; at?: string } | undefined {
	const file = join(DATA_DIR, "lanes", name, "report.md");
	try {
		return { text: readFileSync(file, "utf8").slice(0, 4000), at: new Date(statSync(file).mtimeMs).toISOString() };
	} catch {
		return undefined;
	}
}

function openTasks(): Array<Record<string, unknown>> {
	try {
		const j = JSON.parse(readFileSync(join(DATA_DIR, "state.json"), "utf8"));
		return Array.isArray(j?.open_tasks) ? j.open_tasks.filter(isObj) : [];
	} catch {
		return [];
	}
}

const real = (p: string) => {
	try {
		return realpathSync(p);
	} catch {
		return p;
	}
};

// What the project does, in one sentence: the owner's edit (record), else its work channel setup's purpose (docs/layers.md §4).
const withPurpose = (p: Project): Project & { purpose?: string } => {
	const purpose = p.record?.purpose || (p.channel ? getSetup(p.channel.id)?.purpose : undefined);
	return purpose ? { ...p, purpose } : p;
};

async function projectDetail(key: string, deps: CustomDeps) {
	if (key === BUILTIN_KEY) return builtinDetail();
	const { pins } = readPins({ sync: false });
	const lanes = deps.lanes();
	const channels = deps.channels();
	const all = projectsView({ lanes, channels, pins, records: loadProjects() }).map(withPurpose);
	const project = all.find(p => p.key === key) ?? all.find(p => p.recordKey === key);
	if (!project) return undefined;
	const dir = project.path ? project.path.replace(/^~(?=\/|$)/, HOME) : undefined;
	const reports: Record<string, { text: string; at?: string }> = {};
	for (const l of project.lanes) {
		const r = readReport(l.name);
		if (r) reports[l.name] = r;
	}
	return projectDetailView({
		project, record: project.record, ...(project.channel ? { info: loadProjectInfo()[`ch:${project.channel.id}`] } : {}), others: all, lanes, reports, receipts: readReceipts(), tasks: openTasks(), routines: pins.routines, schedules: listSchedules(), watches: listWatches(), channels, work: deps.work?.() ?? [],
		...(dir ? { git: await gitState(dir), self: real(dir) === real(join(import.meta.dir, "..")) } : {}),
	});
}

// ---- HTTP ------------------------------------------------------------------------------------------------------------
const NO_CACHE = { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" };
const jsonOf = (v: unknown, status = 200) => Response.json(v, { status });

async function listAll(deps: CustomDeps) {
	const errors: CustomError[] = [];
	const orderOf = (c: CardEntry) => ("spec" in c ? c.spec.order : Number.POSITIVE_INFINITY);
	const entries = readCards(errors).sort((a, b) => orderOf(a) - orderOf(b) || a.id.localeCompare(b.id));
	const { pins, errors: pinErrors } = readPins();
	errors.push(...pinErrors);
	const cards = await Promise.all(entries.map(c => ("error" in c ? { id: c.id, file: c.file, error: c.error } : cardView(c, false))));
	const sched = listSchedules();
	const routines = pins.routines.map(r => {
		const s = sched.find(x => x.text.startsWith(`[routine:${r.id}:`));
		return { ...r, ...(s ? { next: s.at } : {}) };
	});
	return { dir: customDirLabel(), cards, projects: [builtinProject(), ...projectsView({ lanes: deps.lanes(), channels: deps.channels(), pins, records: loadProjects(), ...(deps.machine ? { computer: deps.machine() } : {}) }).map(withPurpose)], routines, links: pins.links, errors };
}

// What a peer reads (GET /api/peer/projects, hub/peer-auth.ts): this computer's own projects, by key, name and purpose only.
function ownProjects(deps: CustomDeps): { name: string; projects: RemoteProject[] } {
	const name = deps.machine?.() ?? "";
	const list = projectsView({ lanes: deps.lanes(), channels: deps.channels(), pins: readPins({ sync: false }).pins, records: loadProjects(), computer: name }).map(withPurpose);
	return { name, projects: list.filter(p => p.computer === name).slice(0, 30).map(p => ({ key: p.key, name: p.name, ...(p.purpose || p.note ? { note: String(p.purpose || p.note).slice(0, 200) } : {}) })) };
}

async function computersView(deps: CustomDeps): Promise<ComputerGroup[]> {
	const self = deps.machine?.() ?? "";
	const projects = projectsView({ lanes: deps.lanes(), channels: deps.channels(), pins: readPins({ sync: false }).pins, records: loadProjects(), computer: self });
	return computerGroups(self, projects, (await deps.peerProjects?.().catch(() => [])) ?? []);
}

export async function customRoute(req: Request, url: URL, deps: CustomDeps): Promise<Response | undefined> {
	const p = url.pathname;
	if (req.method === "GET" && p === "/api/peer/projects") return jsonOf(ownProjects(deps));
	if (!p.startsWith("/api/custom")) return undefined;
	if (req.method === "GET" && p === "/api/custom") return jsonOf(await listAll(deps));
	if (req.method === "GET" && p === "/api/custom/computers") return jsonOf(await computersView(deps));
	if (req.method === "GET" && p === "/api/custom/project") {
		const d = await projectDetail(url.searchParams.get("key") ?? "", deps);
		return d ? jsonOf(d) : jsonOf({ error: "project not found" }, 404);
	}
	if (req.method === "GET" && p === "/api/custom/render") {
		const id = url.searchParams.get("id") ?? "";
		const file = ID.test(id) ? join(customDir(), "cards", id, "render.js") : "";
		if (!file || !existsSync(file)) return new Response("not found", { status: 404 });
		return new Response(Bun.file(file), { headers: NO_CACHE });
	}
	const cardsPath = /^\/api\/custom\/cards(?:\/([^/]+))?$/.exec(p);
	if (cardsPath) {
		const cid = cardsPath[1] === undefined ? undefined : decodeURIComponent(cardsPath[1]);
		if (req.method === "GET" && cid !== undefined) {
			const r = readCardFile(cid);
			return r ? jsonOf(r) : jsonOf({ error: `card ${cid} not found` }, 404);
		}
		if (req.method === "DELETE" && cid !== undefined) return deleteCardFile(cid) ? jsonOf({ ok: true, id: cid }) : jsonOf({ error: `card ${cid} not found` }, 404);
		if ((req.method === "POST" && cid === undefined) || (req.method === "PUT" && cid !== undefined)) {
			const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
			if (!isObj(b)) return jsonOf({ error: "카드는 JSON 객체여야 해요" }, 400);
			const wantId = cid ?? (typeof b.id === "string" && b.id.trim() ? b.id.trim() : undefined);
			const r = saveCardFile(wantId, b, req.method === "POST");
			if (!r.ok) return jsonOf({ error: r.error }, r.status);
			const c = readCards().find(x => x.id === r.id);
			return jsonOf(!c ? { error: `card ${r.id} not found` } : "error" in c ? { id: c.id, file: c.file, error: c.error } : await cardView(c, true), c ? 200 : 500);
		}
		return undefined;
	}
	if (req.method !== "POST" || (p !== "/api/custom/refresh" && p !== "/api/custom/routine" && p !== "/api/custom/action")) return undefined;
	const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
	const id = String(body.id ?? "");
	if (p === "/api/custom/refresh") {
		const c = readCards().find(x => x.id === id);
		if (!c) return jsonOf({ error: `card ${id} not found` }, 404);
		return jsonOf("error" in c ? { id: c.id, file: c.file, error: c.error } : await cardView(c, true));
	}
	const login = req.headers.get("tailscale-user-login") ?? "local";
	const sent = async (target: "main" | `lane:${string}`, text: string) => {
		try {
			await deps.send(target, text, login);
		} catch (e) {
			return jsonOf({ error: msg(e) }, 409);
		}
		return jsonOf({ ok: true });
	};
	if (p === "/api/custom/action") {
		const c = readCards().find(x => x.id === id);
		const action = c && !("error" in c) && Number.isInteger(body.index) ? c.spec.actions[body.index as number] : undefined;
		if (!c || "error" in c || !action) return jsonOf({ error: `card ${id} action ${String(body.index)} not found` }, 404);
		if (action.prompt !== undefined) return sent("main", `[카드 ${c.spec.title}] ${action.prompt}`);
		const r = await runAction(action.command!, c.spec);
		return jsonOf({ ok: r.code === 0 && !r.timedOut, code: r.code, output: r.output, card: await cardView(c, true) });
	}
	const r = readPins().pins.routines.find(x => x.id === id);
	if (!r) return jsonOf({ error: `routine ${id} not found` }, 404);
	return sent(r.target as "main" | `lane:${string}`, `[루틴 ${r.name}] ${r.prompt}`);
}
