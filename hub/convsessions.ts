// One agent session per conversation (config `conversations.sessions`, on unless false; read once, at boot). The owner's message in
// a conversation goes to that conversation's own orchestrator instance (hub/orchestrator.ts createOrchestrator), started on the
// first such message and parked after it sat idle; everything the gateway starts itself stays on `main`, the session that also
// oversees the others. This module is the registry and the only one that knows the flag: with it off, every key is `main` and
// nothing is ever spawned here. outbound.ts wires each instance's prompt queue and background-work view (setWiring).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { createBgWork } from "./bgwork.ts";
import { quietOmoWork, runningOmoWorkers } from "./bgwork.ts";
import { convIdleStopMin, convKinds, convMaxLive, convSessionsOn, DATA_DIR, log as hubLog, NAME, orchestratorModel, selectorOf, writeAtomic } from "./config.ts";
import { historyEvents, type HubEvent } from "./events.ts";
import { mailByThread } from "./mail.ts";
import { createOrchestrator, orchBusy, type OrchOpts, type Orchestrator } from "./orchestrator.ts";
import { createCapacity } from "./convcapacity.ts";
import { omoSelector } from "./runtime/omo.ts";
import type { createPrompts, Pending, Reply } from "./prompts.ts";
import { CONV_KINDS, MAIN, primaryTarget, safeDir, sessionKeyOf } from "./session-key.ts";
import type { ResumeSession } from "./sessionresume.ts";
import { trackTimer } from "./shutdown.ts";

export type Prompts = ReturnType<typeof createPrompts>;
export type BgWork = ReturnType<typeof createBgWork>;
// Kept in the session's state.json next to the orchestrator's own fields (both writers merge). ownModel: the selector the owner
// picked for this conversation (hub/control.ts); without it the session inherits main's. Named apart from the orchestrator's `model`.
export type ConvMeta = { key: string; primary: string; aliases: string[]; name?: string; createdAt: string; lastOwnerAt?: string; parked?: true; ownModel?: string };
export type Conv = { key: string; primary: string; o: Orchestrator; queue: Prompts; bg: BgWork; meta: ConvMeta; dir?: string };
export type ConvState = "new" | "parked" | "live";

export type ConvDeps = {
	on: () => boolean;
	kinds: () => readonly string[] | undefined;
	maxLive: () => number;
	idleMin: () => number;
	mailOf: (thread: string) => string | undefined;
	make: (o: OrchOpts) => Orchestrator;
	wire: (c: Conv) => { queue: Prompts; bg: BgWork };
	dataDir: string;
	history: (target: string, limit: number) => HubEvent[];
	workers: (c: Conv, file?: string) => number;
	/** Main's model as a task pin: the workers of a conversation on its own model stay on it (extension/guard.ts ownWorkerPin). */
	workerPin: () => string;
	log: (line: string) => void;
	now?: () => number;
};

const SEED_EVENTS = 20;
const SEED_CHARS = 6000;
const SWEEP_MS = 60_000;

const readJson = (file: string): Record<string, unknown> => {
	try {
		return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
	} catch {
		return {};
	}
};

// The conversation's recent exchanges, handed to a brand-new session with its first prompt (it starts with no context of its own).
// Context only: this first run has no prompt, so what it answers goes nowhere and what it starts belongs to no request. The message that
// started the session is logged before it is delivered, so it is left out here and comes as its own turn (2026-11-05 web:worklog: it was
// acted on from this history and then again as its turn, and the worker's answer closed nothing, so the owner got it twice).
export function seedText(primary: string, events: HubEvent[], max = SEED_CHARS): string {
	const lines = events
		.filter(e => (e.kind === "message" || (e.kind === "out" && !e.update_key)) && typeof e.text === "string" && e.text.trim())
		.map(e => `[${String(e.ts).slice(0, 16)}] ${e.kind === "message" ? `owner${e.author ? ` (${e.author})` : ""}` : NAME}: ${String(e.text).replace(/\s+/g, " ").trim()}`);
	const wait = "This is context, not a request: reply with exactly - now. Any new message from the owner comes next as its own turn.";
	if (!lines.length) return `[dotz gateway] This conversation (${primary}) is new. ${wait}`;
	let body = lines.join("\n");
	if (body.length > max) body = `…${body.slice(body.length - max)}`;
	return `[dotz gateway] This conversation (${primary}) before this session started, oldest first. Its earlier turns were answered by the main session. ${wait}\n${body}`;
}

/** Every message the session still owes a turn or an answer: its starting history leaves them out, their own delivery carries them. */
function owedIds(q: Prompts): Set<string> {
	const running = q.current();
	const owed: { replyTo?: string; refs?: string[] }[] = [...q.deferredOpen(), ...(running && !running.done ? [running] : []), ...q.queued()];
	return new Set(owed.flatMap(p => [...(p.refs ?? []), ...(p.replyTo ? [p.replyTo] : [])]));
}

export const scopeText = (m: ConvMeta): string =>
	`You are ${NAME}'s session for the conversation ${m.name || m.primary} (${m.primary}). You answer only here; the main session oversees every conversation; to hand work elsewhere use dotz_conv send main.`;

// Under the memory cap a session resting this long is parked at once (a session between two quick messages keeps running).
export const PRESSURE_IDLE_MS = 60_000;
export function createConvSessions(d: ConvDeps) {
	const now = d.now ?? Date.now;
	const convs = new Map<string, Conv>();
	let mainConv: Conv | undefined;
	const hooks: ((c: Conv) => void)[] = [];
	const rules = () => ({ on: d.on(), kinds: d.kinds(), mailOf: d.mailOf });
	const keyOf = (target: string | undefined): string => sessionKeyOf(target, rules());
	const live = (c: Conv): boolean => c.o.orchestratorPid() !== undefined;
	const metaFile = (c: Conv) => join(c.dir!, "state.json");
	const saveMeta = (c: Conv) => writeAtomic(metaFile(c), `${JSON.stringify({ ...readJson(metaFile(c)), ...c.meta, parked: c.meta.parked }, null, 2)}\n`);
	const syncPin = (c: Conv): void => {
		const file = join(c.dir!, "worker-pin");
		if (c.meta.ownModel) writeAtomic(file, `${d.workerPin()}\n`);
		else rmSync(file, { force: true });
	};

	function setMain(c: Omit<Conv, "meta" | "primary"> & Partial<Pick<Conv, "meta" | "primary">>): Conv {
		mainConv = { primary: "web", meta: { key: MAIN, primary: "web", aliases: [], createdAt: new Date(now()).toISOString() }, ...c } as Conv;
		for (const h of hooks) h(mainConv);
		return mainConv;
	}
	const get = (key: string): Conv | undefined => (key === MAIN ? mainConv : convs.get(key));
	/** The session that answers `target`, when it exists (main always does). */
	const forTarget = (target: string | undefined): Conv | undefined => get(keyOf(target));

	function create(key: string, stored?: ConvMeta): Conv {
		const dir = join(d.dataDir, "conv-sessions", safeDir(key));
		mkdirSync(dir, { recursive: true });
		const meta: ConvMeta = stored ?? { key, primary: primaryTarget(key), aliases: [], createdAt: new Date(now()).toISOString() };
		const c = { key, primary: meta.primary, meta, dir } as Conv;
		c.o = d.make({
			key,
			stateFile: join(dir, "state.json"),
			source: `conv:${key}`,
			keepalive: false,
			asks: false,
			model: () => c.meta.ownModel,
			env: { DOTZ_CONV: key, DOTZ_WORKER_PIN_FILE: join(dir, "worker-pin"), ...(meta.name ? { DOTZ_CONV_NAME: meta.name } : {}) },
			scope: () => scopeText(c.meta),
			seed: () => {
				const owed = owedIds(c.queue);
				return seedText(c.primary, d.history(key, SEED_EVENTS).filter(e => !owed.has(String(e.mid ?? e.message_id))));
			},
		});
		Object.assign(c, d.wire(c));
		convs.set(key, c);
		saveMeta(c);
		syncPin(c);
		for (const h of hooks) h(c);
		return c;
	}

	// Parkable: idle with nothing it still owes (no compaction, no background worker, no deferred request, nothing held), and quiet
	// for at least `idleMs`.
	function parkable(c: Conv, idleMs: number): boolean {
		if (!live(c) || c.o.orch.status !== "idle" || orchBusy(c.o.orch)) return false;
		if (d.workers(c) > 0 || c.queue.deferredOpen().length > 0 || c.o.heldCount() > 0) return false;
		const cur = c.queue.current();
		if (cur && !cur.done) return false;
		// A request it still owes (delivered, not answered) or a usage-limit pause keeps it running: parked, nothing would retry them
		// (2026-10-28 13:46Z on the Mac mini: the alert session was parked 4 min before its limit lifted, and its message waited unanswered).
		if (c.queue.queued().some(p => !p.cancelled && !p.done && !c.queue.isAnswered(p.replyTo))) return false;
		if (Date.parse(c.o.orch.rateLimitedUntil || "") > now()) return false;
		return now() - c.o.lastTurnEndAt() >= idleMs;
	}
	// A parked session's process never reported its file this run: state.json holds it.
	const fileOf = (c: Conv): string | undefined => c.o.orch.sessionFile || (c.dir ? (readJson(metaFile(c)).sessionFile as string | undefined) : undefined);
	/** The resume sweep may look at it: nothing runs, is held or is paused, the owner did not stop it, and main is up. A parked session counts. */
	function resting(c: Conv): boolean {
		const o = c.o.orch;
		if (o.status === "working" || o.status === "starting" || o.status === "rate-limited" || o.error || o.stoppedBy === "owner" || orchBusy(o)) return false;
		if (Date.parse(o.rateLimitedUntil || "") > now() || c.o.heldCount() > 0) return false;
		if (live(c) ? o.status !== "idle" : c.key === MAIN) return false;
		return d.workers(c, fileOf(c)) === 0;
	}
	/** Past the cap with nothing that can make room, a resume waits (only an owner message starts over the cap). */
	function full(c: Conv): string | undefined {
		if (live(c)) return undefined;
		const running = [...convs.values()].filter(x => x !== c && live(x));
		return running.length < d.maxLive() || running.some(x => parkable(x, 0)) ? undefined : `${running.length} of ${d.maxLive()} sessions running`;
	}
	function park(c: Conv, why: string): void {
		if (!c.o.park()) return;
		c.meta.parked = true;
		saveMeta(c);
		d.log(`conversation session ${c.key} parked (${why})`);
	}
	// The live-process cap counts conversation sessions only. Past it the least recently used one that can stop is parked first;
	// when none can, the new one starts anyway (an owner message is never held for capacity; the memory guard is the backstop).
	function makeRoom(except: Conv): void {
		const running = [...convs.values()].filter(c => c !== except && live(c));
		if (running.length < d.maxLive()) return;
		const lru = running.filter(c => parkable(c, 0)).sort((a, b) => a.o.lastTurnEndAt() - b.o.lastTurnEndAt())[0];
		if (lru) park(lru, `cap of ${d.maxLive()} live sessions, least recently used`);
		else d.log(`conversation session ${except.key} starts over the cap of ${d.maxLive()}: none of the ${running.length} live ones can stop now`);
	}

	/** The session for `key`, created (not spawned) when it does not exist; room is made when it is about to spawn. */
	function ensure(key: string): Conv {
		if (key === MAIN) return mainConv!;
		const c = convs.get(key) ?? create(key);
		if (!live(c)) {
			makeRoom(c);
			if (c.meta.parked) {
				c.meta.parked = undefined;
				saveMeta(c);
			}
		}
		return c;
	}
	const queueOf = (key: string): Prompts => ensure(key).queue;

	/** Saves this conversation's own model (undefined: back to main's); the session follows now, after its turn, or at its next start. Nothing spawns. */
	function setOwnModel(key: string, selector: string | undefined): ReturnType<Orchestrator["applyModelChange"]> {
		const c = convs.get(key) ?? create(key);
		c.meta.ownModel = selector;
		saveMeta(c);
		syncPin(c);
		return c.o.applyModelChange();
	}
	/** Main's model changed: sessions that inherit follow it, the others only re-pin their workers on it. */
	function followMain(): void {
		for (const c of convs.values()) {
			if (c.meta.ownModel) syncPin(c);
			else c.o.applyModelChange();
		}
	}

	/** Delivers a prompt into the session `key` (spawning or resuming it); true when it was steered into its running turn. */
	function deliverTo(key: string, text: string, reply?: Reply): boolean {
		const c = ensure(key);
		if (reply?.owner && c.key !== MAIN) {
			c.meta.lastOwnerAt = new Date(now()).toISOString();
			saveMeta(c);
		}
		return c.queue.deliver(text, reply);
	}

	/** new: no session yet; parked: one whose process is not running (the next message resumes it); live: running. Main is always live. */
	function stateOf(target: string): ConvState {
		const c = forTarget(target);
		if (!c) return "new";
		if (c.key === MAIN || live(c)) return "live";
		return "parked";
	}

	function sweep(): void {
		const min = d.idleMin();
		if (min > 0) for (const c of convs.values()) if (parkable(c, min * 60_000)) park(c, `idle ${min} min`);
		// Short of memory (the cap fell below what runs): the longest-resting sessions are parked now instead of after the idle time, so
		// the memory goes back while nothing is lost (a parked session resumes on its next message).
		const over = () => [...convs.values()].filter(live).length - d.maxLive();
		for (const c of [...convs.values()].filter(c => parkable(c, PRESSURE_IDLE_MS)).sort((a, b) => a.o.lastTurnEndAt() - b.o.lastTurnEndAt())) {
			if (over() <= 0) break;
			park(c, `memory: cap of ${d.maxLive()} live sessions, resting longest`);
		}
	}

	/**
	 * Boot: every stored session comes back parked (nothing is spawned). Their open prompts are returned with them: the caller replays
	 * them into that session. With the feature off no session is restored and every stored session's open prompts are returned for
	 * main, their files cleared, so turning the feature off loses no prompt.
	 */
	function restore(): { conv?: Conv; key: string; pending: Pending[] }[] {
		const root = join(d.dataDir, "conv-sessions");
		if (!existsSync(root)) return [];
		const out: { conv?: Conv; key: string; pending: Pending[] }[] = [];
		for (const name of readdirSync(root)) {
			const dir = join(root, name);
			const stored = readJson(join(dir, "state.json")) as Partial<ConvMeta>;
			const pendingFile = join(dir, "pending.json");
			let pending: Pending[] = [];
			try {
				if (existsSync(pendingFile)) pending = JSON.parse(readFileSync(pendingFile, "utf8"));
			} catch {}
			if (typeof stored.key !== "string" || !stored.key) continue;
			if (!d.on()) {
				if (pending.length) writeFileSync(pendingFile, "[]\n");
				if (pending.length) out.push({ key: MAIN, pending });
				continue;
			}
			if (convs.has(stored.key)) continue;
			const c = create(stored.key, { key: stored.key, primary: stored.primary ?? primaryTarget(stored.key), aliases: stored.aliases ?? [], name: stored.name, createdAt: stored.createdAt ?? new Date(now()).toISOString(), lastOwnerAt: stored.lastOwnerAt, ownModel: stored.ownModel, parked: true });
			out.push({ conv: c, key: c.key, pending });
		}
		return out;
	}

	const all = (): Conv[] => [...(mainConv ? [mainConv] : []), ...convs.values()];
	return {
		keyOf,
		/** The conversation kinds that have a session of their own; the others run on main. */
		ownKinds: (): readonly string[] => (d.on() ? (d.kinds() ?? CONV_KINDS) : []),
		get,
		forTarget,
		ensure,
		queueOf,
		deliverTo,
		setOwnModel,
		followMain,
		stateOf,
		setMain,
		restore,
		sweep,
		park: (key: string) => {
			const c = convs.get(key);
			if (c) park(c, "asked");
		},
		parkable,
		/** Ends a conversation for good (a task conversation saved or closed): parked, forgotten, and its session folder removed. */
		drop: (key: string) => {
			const c = convs.get(key);
			if (c) park(c, "dropped");
			convs.delete(key);
			rmSync(join(d.dataDir, "conv-sessions", safeDir(key)), { recursive: true, force: true });
		},
		/** Every session as the resume sweep sees it (hub/sessionresume.ts). */
		resumeSessions: (asked: (c: Conv) => boolean, tell: (target: string, text: string) => void): ResumeSession[] =>
			all().map(c => ({
				key: c.key,
				target: c.primary,
				file: () => fileOf(c),
				live: () => live(c),
				resting: () => resting(c),
				dead: () => {
					const file = fileOf(c);
					return file ? c.bg.deadWork(file) : [];
				},
				asked: () => asked(c),
				taken: id => c.bg.handed.has(id),
				full: () => full(c),
				wake: (note, to, ids) => {
					for (const id of ids) c.bg.handed.add(id);
					deliverTo(c.key, note, to);
				},
				tell: text => tell(c.primary, text),
			})),
		all,
		conversations: (): Conv[] => [...convs.values()],
		live,
		/** Runs `fn` on every instance: the ones that exist now and each one created later. */
		everyInstance: (fn: (c: Conv) => void): void => {
			hooks.push(fn);
			for (const c of all()) fn(c);
		},
		/** An owner message was answered: every queue settles it (cheap set inserts; a burst may span queues after a restart). */
		markAnsweredAll: (ref: string | undefined | null): void => {
			if (!ref) return;
			for (const c of all()) c.queue.markAnswered(ref);
		},
		bgList: () => all().flatMap(c => c.bg.list()),
		/** The owner's 중단 in `target`: only that conversation's session ends its turn. */
		cancelFor: (target: string): void => (forTarget(target) ?? mainConv)!.o.cancelByOwner(),
		startIdleSweep: (): void => {
			const timer = setInterval(sweep, SWEEP_MS);
			timer.unref?.();
			trackTimer("conversation sessions idle stop", timer);
			void capacity.sample();
			const sampler = setInterval(() => void capacity.sample(), CAPACITY_MS);
			sampler.unref?.();
			trackTimer("conversation sessions capacity", sampler);
		},
	};
}

let on: boolean | undefined;
let wiring: ((c: Conv) => { queue: Prompts; bg: BgWork }) | undefined;
/** outbound.ts builds each instance's prompt queue and background-work view (it owns the delivery state they use). */
export const setWiring = (fn: (c: Conv) => { queue: Prompts; bg: BgWork }): void => {
	wiring = fn;
};
// How many may run at once: the owner's fixed `conversations.max_live`, else what this computer's free memory and load allow now.
const CAPACITY_MS = 30_000;
export const capacity = createCapacity(() => convs.conversations().flatMap(c => c.o.orchestratorPid() ?? []), hubLog);
export const maxLiveView = () => {
	const fixed = convMaxLive();
	return fixed ? { max: fixed, reason: "설정(conversations.max_live)으로 고정" } : capacity.view();
};
export const convs = createConvSessions({
	on: () => (on ??= convSessionsOn()),
	kinds: convKinds,
	maxLive: () => convMaxLive() ?? capacity.max(),
	idleMin: convIdleStopMin,
	mailOf: thread => mailByThread(thread)?.key,
	make: createOrchestrator,
	wire: c => wiring!(c),
	dataDir: DATA_DIR,
	history: historyEvents,
	// Silent workers count: a long wait writes nothing, and the park would end it (the lanes' reply-voice stop, laneidle.ts).
	workers: (c, file = c.o.orch.sessionFile) => runningOmoWorkers(file) + quietOmoWork(file).length,
	workerPin: () => omoSelector(selectorOf(orchestratorModel())),
	log: hubLog,
});
