import { randomBytes } from "node:crypto";
import { log, paths, readJsonOrQuarantine, writeAtomic } from "./config.ts";
import { convTargetOf } from "./session-key.ts";
import { everyMinutes } from "./watch.ts";

export const MIN_EVERY_MINUTES = 5; // shortest repeat a schedule takes

/** "owner": the owner asked to be told or sent this (delivered and notified); "check": the assistant's own system check or follow-up (quiet). No kind = "owner". */
export type ScheduleKind = "owner" | "check";
export const SCHEDULE_KINDS: readonly ScheduleKind[] = ["owner", "check"];
export type Schedule = { id: string; text: string; at: string; every_minutes?: number; created: string; paused?: boolean; last?: string; /** The conversation (ch:/th:/mail:/settings: target) whose session it fires into; none = main, as for items stored before this field. */ conv?: string; kind?: ScheduleKind };

export const GRID_MS = 30 * 60_000; // check items fire on a :00 / :30 grid, so those of one conversation due together become one turn
const SLOT_TOL_MS = 1000; // a timer can fire a few ms before its slot
const kindOf = (value: unknown): ScheduleKind => {
	if (!SCHEDULE_KINDS.includes(value as ScheduleKind)) throw new Error(`kind must be ${SCHEDULE_KINDS.join(" or ")}`);
	return value as ScheduleKind;
};
/** The next :00 or :30 of the hub's clock at or after `ms` (a time already on the grid stays). */
export function roundUpToGrid(ms: number): number {
	const off = new Date(ms).getTimezoneOffset() * 60_000;
	return Math.ceil((ms - off) / GRID_MS) * GRID_MS + off;
}

const items: Schedule[] = readJsonOrQuarantine(paths.schedules, () => []);
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const save = () => writeAtomic(paths.schedules, `${JSON.stringify(items, null, 2)}\n`);
let onFire: (s: Schedule, group?: Schedule[]) => void = () => {};
const MAX_DELAY = 2 ** 31 - 1;

function arm(s: Schedule): void {
	clearTimeout(timers.get(s.id));
	if (s.paused) return;
	const delay = Math.max(0, Date.parse(s.at) - Date.now());
	timers.set(s.id, setTimeout(() => (delay > MAX_DELAY ? arm(s) : fire(s)), Math.min(delay, MAX_DELAY)));
}

function settle(s: Schedule): void {
	clearTimeout(timers.get(s.id));
	timers.delete(s.id);
	s.last = new Date().toISOString();
	if (s.every_minutes) {
		// Always step past this slot: a timer can fire a few ms before s.at, and a plain while would re-arm the same slot and fire twice.
		let next = Date.parse(s.at) + s.every_minutes * 60_000;
		while (next <= Date.now()) next += s.every_minutes * 60_000;
		s.at = new Date(next).toISOString();
		arm(s);
	} else items.splice(items.indexOf(s), 1);
}

/** The other check items of the same conversation due in the same slot as `s`. */
const slotMates = (s: Schedule): Schedule[] =>
	s.kind === "check" ? items.filter(x => x !== s && x.kind === "check" && !x.paused && (x.conv ?? "") === (s.conv ?? "") && Math.abs(Date.parse(x.at) - Date.parse(s.at)) < SLOT_TOL_MS) : [];
/** Ids of the other checks of `s`'s conversation due in its slot (the add result names them). */
export const checksSharingSlot = (s: Schedule): string[] => slotMates(s).map(x => x.id);

function fire(s: Schedule): void {
	// A check fires together with the checks of its conversation due in the same slot: one turn, one handler call with all of them.
	const group = s.kind === "check" ? [s, ...slotMates(s)] : undefined;
	for (const x of group ?? [s]) settle(x);
	save();
	for (const x of group ?? [s]) log(`schedule ${x.id} fired`);
	onFire(s, group);
}

export function startSchedules(handler: (s: Schedule, group?: Schedule[]) => void): void {
	onFire = handler;
	for (const s of items) arm(s);
}

// Shutdown: nothing fires again (the items stay saved in schedules.json).
export function stopSchedules(): void {
	for (const t of timers.values()) clearTimeout(t);
	timers.clear();
}

/** Where a fired schedule is delivered: its conversation, else the gateway's default channel (main's session). */
export const scheduleTarget = (s: Schedule, fallback: string): string => s.conv ?? fallback;

// `conv` / `project`: the conversation it belongs to; `session`: the key of the session that creates it (a conversation session's schedule belongs to that conversation).
export function addSchedule(input: { text?: string; at?: string; in_minutes?: number; every_minutes?: number; conv?: string; project?: string; session?: string; kind?: unknown }): Schedule {
	const text = String(input.text ?? "").trim();
	if (!text) throw new Error("text required");
	const at = input.at ? Date.parse(input.at) : Date.now() + Number(input.in_minutes ?? Number.NaN) * 60_000;
	if (!Number.isFinite(at)) throw new Error("give at (ISO time with offset, e.g. 2026-10-17T09:00:00+09:00) or in_minutes");
	if (input.every_minutes !== undefined && !(Number(input.every_minutes) >= MIN_EVERY_MINUTES)) throw new Error(`every_minutes must be at least ${MIN_EVERY_MINUTES}`);
	const conv = convTargetOf(input);
	const kind = input.kind === undefined ? undefined : kindOf(input.kind);
	// A one-shot check is never earlier than asked: it waits for the next :00 or :30 so checks of one conversation share a turn.
	const when = kind === "check" && !input.every_minutes ? roundUpToGrid(at) : at;
	const s: Schedule = { id: randomBytes(3).toString("hex"), text, at: new Date(when).toISOString(), ...(input.every_minutes ? { every_minutes: Number(input.every_minutes) } : {}), ...(conv ? { conv } : {}), ...(kind ? { kind } : {}), created: new Date().toISOString() };
	items.push(s);
	save();
	arm(s);
	return s;
}

// The owner's edit from the project page (PATCH /api/schedules/<id>): persisted and re-armed. `paused` keeps the entry but
// nothing fires; a recurring one resumes at its next slot after now, a one-shot whose time passed fires at once. `every_minutes: null` makes it one-shot.
export function patchSchedule(id: string, input: { every_minutes?: unknown; at?: unknown; text?: unknown; paused?: unknown; kind?: unknown }): Schedule {
	const s = items.find(x => x.id === id);
	if (!s) throw new Error(`no schedule ${id}`);
	const every = input.every_minutes === undefined ? s.every_minutes : input.every_minutes === null ? undefined : everyMinutes(input.every_minutes);
	const text = input.text === undefined ? s.text : typeof input.text === "string" ? input.text.trim() : "";
	if (!text) throw new Error("text must be a non-empty string");
	const at = input.at === undefined ? Date.parse(s.at) : typeof input.at === "string" ? Date.parse(input.at) : Number.NaN;
	if (!Number.isFinite(at)) throw new Error("at must be an ISO time with offset, e.g. 2026-10-17T09:00:00+09:00");
	if (input.paused !== undefined && typeof input.paused !== "boolean") throw new Error("paused must be true or false");
	const kind = input.kind === undefined ? s.kind : kindOf(input.kind);
	s.text = text;
	s.at = new Date(at).toISOString();
	if (kind) s.kind = kind;
	if (every) s.every_minutes = every;
	else delete s.every_minutes;
	if (input.paused !== undefined) {
		if (input.paused) s.paused = true;
		else delete s.paused;
	}
	if (!s.paused && s.every_minutes && input.at === undefined) {
		let next = Date.parse(s.at);
		while (next <= Date.now()) next += s.every_minutes * 60_000;
		s.at = new Date(next).toISOString();
	}
	save();
	arm(s);
	return s;
}

export function removeSchedule(id: string): boolean {
	const i = items.findIndex(s => s.id === id);
	if (i < 0) return false;
	clearTimeout(timers.get(id));
	timers.delete(id);
	items.splice(i, 1);
	save();
	return true;
}

export const listSchedules = () => [...items];
