// Task conversations (config `conversations.task_split`, off by default). The owner mixes unrelated tasks in the main chat; when a
// task repeats, the orchestrator splits it out: it becomes its own conversation `task:<id>`, all its earlier main-chat messages
// move in, and later replies follow. Saving turns it into a project; closing returns its messages to main or deletes them.
//
// The logs are never rewritten. One overlay (hub/events.ts setTargetOverlay) decides where an event shows: this module keeps the
// records (DATA_DIR/task-conversations.json) and an in-memory index of the moved ids, rebuilt from the file.
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DATA_DIR, log, now, paths, taskSplitOn, writeAtomic } from "./config.ts";
import { digest } from "./convdigest.ts";
import { resetConversationIndex } from "./conversations.ts";
import { convs } from "./convsessions.ts";
import * as discord from "./discord.ts";
import { broadcast, emit, eventTarget, setTargetOverlay, tailEvents, type HubEvent } from "./events.ts";
import { orchBusy } from "./orchestrator.ts";
import { MAX_TITLE, saveProject } from "./projects.ts";
import { body, json } from "./routes-util.ts";

export type TaskState = "open" | "saved" | "returned" | "deleted";
/** `moved`: ids of the events pulled out of main: the owner's message ids (mid or message_id) and, for an answer a later reply quotes, the answer's ts. */
export type TaskRecord = { id: string; title: string; state: TaskState; createdAt: string; updatedAt: string; moved: string[]; project?: string };
export type TaskResult = { status: number; body: Record<string, unknown> };

const TASK = /^task:([a-z0-9]+)$/;
export const isTaskTarget = (t: string): boolean => TASK.test(t);
const MAX_REFS = 200;
const file = () => join(DATA_DIR, "task-conversations.json");

const records = new Map<string, TaskRecord>();
const index = new Map<string, string>(); // moved id -> task id

function reindex(): void {
	index.clear();
	for (const r of records.values()) for (const id of r.moved) index.set(id, r.id);
}
/** Reads the records again from the file (boot, and a test that checks they survive a reload). */
export function reloadTasks(): void {
	records.clear();
	try {
		const j = existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : {};
		for (const r of Object.values(j?.tasks ?? {}) as TaskRecord[]) if (r && TASK.test(`task:${r.id}`) && Array.isArray(r.moved)) records.set(r.id, r);
	} catch {
		// An unreadable file is no task conversation: the main chat shows everything as it was logged.
	}
	reindex();
}
const persist = (): void => {
	writeAtomic(file(), `${JSON.stringify({ tasks: Object.fromEntries(records) }, null, 2)}\n`);
	reindex();
};

const destination = (r: TaskRecord): string | undefined =>
	r.state === "open" ? `task:${r.id}` : r.state === "saved" ? r.project : r.state === "returned" ? "main" : undefined;

// A project, lane, mail, settings, alert or worklog event is never asked about (events.ts asks only for a base target "main"). The pointer line stays in main.
// A deleted task's messages leave every list and history like a deleted mail's: the log line stays on disk, nothing shows it.
setTargetOverlay((e: HubEvent) => {
	if (!records.size || e.task_ref) return undefined;
	const named = [e.conv, e.channel, e.target].find((v): v is string => typeof v === "string" && TASK.test(v));
	let id = named?.slice(5);
	if (!id) {
		const reply = e.reply as { id?: unknown } | undefined;
		for (const k of [e.mid, e.message_id, e.ts, e.ref, e.reply_to, reply?.id]) {
			const t = typeof k === "string" ? index.get(k) : undefined;
			if (t) {
				id = t;
				break;
			}
		}
	}
	const r = id ? records.get(id) : undefined;
	return r ? { to: destination(r) } : undefined;
});

const idOf = (e: HubEvent): string | undefined => (typeof e.mid === "string" && e.mid ? e.mid : typeof e.message_id === "string" && e.message_id ? e.message_id : undefined);
const isOwner = (e: HubEvent): boolean => e.kind === "message" && idOf(e) !== undefined;
const inMain = (e: HubEvent): boolean => eventTarget(e) === "main";
const mainEvents = (): HubEvent[] =>
	[...tailEvents(paths.inbox), ...tailEvents(paths.outbox)].filter(e => typeof e.ts === "string" && !e.task_ref).sort((a, b) => a.ts.localeCompare(b.ts));

/**
 * What the refs pull out of main, from what the gateway knows (no text matching), over the events in ts order: a seed (an owner
 * message of main), the answers whose reply_to is in the set, and the owner messages whose reply_to or reply.id points into it.
 * Delivery and progress events follow their message through the overlay (`ref`, `reply_to`). Returns the new moved ids.
 */
function closure(refs: string[], members: readonly string[] = []): string[] {
	const events = mainEvents();
	const seeds = new Set(refs);
	const set = new Set(members); // owner message ids and the ts of answers: what a reply can point at
	const moved: string[] = [];
	for (const e of events) {
		const id = idOf(e);
		if (e.kind === "out" && typeof e.reply_to === "string" && set.has(e.reply_to) && e.source !== "gateway") set.add(e.ts);
		else if (isOwner(e) && id && inMain(e) && !set.has(id)) {
			const reply = e.reply as { id?: unknown } | undefined;
			const quoted = [e.reply_to, reply?.id].filter((v): v is string => typeof v === "string" && set.has(v));
			if (!seeds.has(id) && !quoted.length) continue;
			set.add(id);
			moved.push(id);
			for (const q of quoted) if (!index.has(q) && !members.includes(q) && !moved.includes(q) && /^\d{4}-\d\d-\d\dT/.test(q)) moved.push(q);
		}
	}
	return moved;
}

function badRefs(refs: unknown): string | undefined {
	if (!Array.isArray(refs) || !refs.length || refs.length > MAX_REFS || refs.some(r => typeof r !== "string" || !r)) return "refs: 옮길 메시지 id가 필요해요";
	const mine = new Set(mainEvents().filter(e => isOwner(e) && inMain(e)).map(e => idOf(e)!));
	const bad = (refs as string[]).find(r => !mine.has(r));
	return bad ? `메인 대화에 있는 내 메시지가 아니에요: ${bad.slice(0, 40)}` : undefined;
}
const titleOf = (v: unknown): string | undefined => (typeof v === "string" && v.trim() && v.trim().length <= MAX_TITLE ? v.trim() : undefined);
const fail = (status: number, error: string): TaskResult => ({ status, body: { error } });

const pointer = (r: TaskRecord, text: string): void =>
	emit("outbox", { ts: now(), kind: "out", source: "gateway", target: "web", text, system: true, task_ref: `task:${r.id}` });
/** Every state change: the counts and previews are made again from the log, the pages are told. */
function changed(): void {
	resetConversationIndex();
	broadcast({ kind: "tasks" });
}

export const taskOf = (id: string): TaskRecord | undefined => records.get(id);
export const openTaskOf = (id: string): TaskRecord | undefined => {
	const r = records.get(id);
	return r?.state === "open" ? r : undefined;
};
export const openTasks = (): TaskRecord[] => [...records.values()].filter(r => r.state === "open");
export const taskLine = (r: TaskRecord) => ({ id: r.id, target: `task:${r.id}`, title: r.title, createdAt: r.createdAt, moved: r.moved.length });
export const listTasks = (): { enabled: boolean; items: ReturnType<typeof taskLine>[] } => ({ enabled: taskSplitOn(), items: openTasks().map(taskLine) });

const OFF = "작업 대화는 꺼져 있어요. 설정에서 conversations.task_split을 켜면 쓸 수 있어요";

export function openTask(title: unknown, refs: unknown): TaskResult {
	if (!taskSplitOn()) return fail(403, OFF);
	const t = titleOf(title);
	if (!t) return fail(400, `title: 1~${MAX_TITLE}자로 적어 주세요`);
	const bad = badRefs(refs);
	if (bad) return fail(400, bad);
	const at = now();
	const r: TaskRecord = { id: randomUUID().replace(/-/g, "").slice(0, 8), title: t, state: "open", createdAt: at, updatedAt: at, moved: [] };
	r.moved = closure(refs as string[]);
	records.set(r.id, r);
	persist();
	changed();
	pointer(r, `'${r.title}' 작업은 따로 옮겼어요`);
	return { status: 200, body: { ok: true, id: r.id, target: `task:${r.id}`, moved: r.moved.length } };
}

export function addToTask(id: string, refs: unknown): TaskResult {
	if (!taskSplitOn()) return fail(403, OFF);
	const r = openTaskOf(id);
	if (!r) return fail(404, "열려 있는 작업 대화가 아니에요");
	const bad = badRefs(refs);
	if (bad) return fail(400, bad);
	const more = closure(refs as string[], r.moved);
	r.moved = [...r.moved, ...more.filter(m => !r.moved.includes(m))];
	r.updatedAt = now();
	persist();
	changed();
	return { status: 200, body: { ok: true, id: r.id, target: `task:${r.id}`, moved: r.moved.length } };
}

/** Why the task's session cannot be ended now: it owes a turn, an answer or a background worker. */
function owes(id: string): string | undefined {
	const c = convs.get(`task:${id}`);
	if (!c) return undefined;
	const o = c.o.orch;
	const cur = c.queue.current();
	if (o.status === "working" || o.status === "starting" || orchBusy(o)) return "turn";
	if (cur && !cur.done) return "turn";
	if (c.queue.queued().some(p => !p.cancelled && !p.done && !c.queue.isAnswered(p.replyTo))) return "request";
	if (c.queue.deferredOpen().length || c.o.heldCount() > 0) return "request";
	if (c.bg.list().some(w => w.status === "running" || w.status === "stalled")) return "worker";
	return undefined;
}
const BUSY = "이 작업 대화가 아직 일하는 중이에요. 끝난 뒤에 다시 해 주세요";

export async function saveTask(id: string, title?: unknown): Promise<TaskResult> {
	const r = openTaskOf(id);
	if (!r) return fail(404, "열려 있는 작업 대화가 아니에요");
	const t = title === undefined ? r.title : titleOf(title);
	if (!t) return fail(400, `title: 1~${MAX_TITLE}자로 적어 주세요`);
	if (owes(id)) return fail(409, BUSY);
	let ch: { id: string };
	try {
		ch = await discord.createWorkChannel(t);
	} catch (e) {
		log(`task ${id}: project channel failed: ${(e as Error).message}`);
		return fail(502, "프로젝트를 만들지 못했어요. 작업 대화는 그대로 있어요");
	}
	saveProject({ key: `ch:${ch.id}`, title: t });
	r.title = t;
	r.project = `ch:${ch.id}`;
	r.state = "saved";
	r.updatedAt = now();
	persist();
	convs.drop(`task:${id}`);
	changed();
	pointer(r, `'${r.title}' 작업을 프로젝트로 저장했어요`);
	return { status: 200, body: { ok: true, id: r.id, project: r.project } };
}

export function closeTask(id: string, to: unknown): TaskResult {
	if (to !== "main" && to !== "delete") return fail(400, "to: main 또는 delete");
	const r = openTaskOf(id);
	if (!r) return fail(404, "열려 있는 작업 대화가 아니에요");
	if (owes(id)) return fail(409, BUSY);
	r.state = to === "main" ? "returned" : "deleted";
	r.updatedAt = now();
	persist();
	convs.drop(`task:${id}`);
	changed();
	if (to === "main") {
		pointer(r, `'${r.title}' 작업을 다시 이 대화로 돌려놨어요`);
		digest.note(`task:${r.id}`, "bot", `'${r.title}' 작업 대화가 닫혀 메시지 ${r.moved.length}개가 메인 대화로 돌아왔어요`);
	} else pointer(r, `'${r.title}' 작업을 지웠어요`);
	return { status: 200, body: { ok: true, id: r.id, state: r.state } };
}

/** A conversation-list row, with the title when it is an open task's. */
export function withTask<T extends { target: string }>(c: T): T | (T & { task: { title: string } }) {
	const t = isTaskTarget(c.target) ? openTaskOf(c.target.slice(5)) : undefined;
	return t ? { ...c, task: { title: t.title } } : c;
}

/** /api/tasks and /api/tasks/:id/{add,save,close}; undefined for any other path. The functions above check the switch, the refs and the state and pick the status. */
export async function taskRoute(req: Request, url: URL): Promise<Response | undefined> {
	if (url.pathname !== "/api/tasks" && !url.pathname.startsWith("/api/tasks/")) return undefined;
	if (req.method === "GET" && url.pathname === "/api/tasks") return json(listTasks());
	if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
	const act = /^\/api\/tasks(?:\/([a-z0-9]+)\/(add|save|close))?$/.exec(url.pathname);
	if (!act) return json({ error: "unknown task route" }, 404);
	const b = await body(req);
	const [, id, verb] = act;
	const r = !id ? openTask(b.title, b.refs) : verb === "add" ? addToTask(id, b.refs) : verb === "save" ? await saveTask(id, b.title) : closeTask(id, b.to);
	return json(r.body, r.status);
}

reloadTasks();
