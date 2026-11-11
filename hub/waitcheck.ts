// The silent-wait check: an owner request stays open, yet nothing runs that could ever answer it (a turn that ended with `[later]`
// and nothing behind it; 2026-11-04 03:08, the owner: "왜 또 멈춰있냐"). The gateway reads its own state, with no model call; after
// QUIET_MS of that it wakes the session with one short turn naming the open requests. Tokens are spent only then. Like OmO's
// todo-owed reminder (TODO_OWED_CHAIN_LIMIT 2) the nudge is bounded: MAX_WAKES per request, RETRY_MS apart, never a loop.
//
// What counts as running: a turn or compaction, a usage-limit pause, a background worker, a restart under way, and a one-shot dotz_watch
// armed for the orchestrator after the request. OmO's own monitors and detached cells cannot be read cheaply from here, so they do
// not count: they get at most this bounded nudge.
import type { OpenRequest } from "./prompts.ts";

export const QUIET_MS = 2 * 60_000;
export const RETRY_MS = 15 * 60_000;
export const MAX_WAKES = 2;

export type WaitSession = {
	key: string;
	open: () => OpenRequest[];
	/** A turn, a compaction or a usage-limit pause. */
	busy: () => boolean;
	workers: () => number;
	/** Stopped on errors, its one resume still owed once the model host answers (orch-error.ts): a wake now is a turn that cannot run. */
	down: () => boolean;
	/** A one-shot watch for the orchestrator armed at or after `since` (ms). */
	armed: (since: number) => boolean;
	lastTurnEndAt: () => number;
	wake: (open: OpenRequest[], last: boolean) => void;
	/**
	 * Requests with no message id and no worker that are still open RETRY_MS after their last reminder: the check gives up on them, so no
	 * reminder ever follows the last one. A request with a message id stays: its answer must still reach that message, also after a restart.
	 */
	drop?: (open: OpenRequest[]) => void;
};

type WaitCheckDeps = {
	sessions: () => WaitSession[];
	restarting: () => boolean;
	log: (message: string) => void;
	now?: () => number;
};

export function createWaitCheck(deps: WaitCheckDeps) {
	const now = deps.now ?? Date.now;
	// Since when each session has been seen with nothing running.
	const quiet = new Map<string, number>();
	const wakes = new Map<string, { count: number; at: number }>();
	const idOf = (s: WaitSession, r: OpenRequest) => `${s.key}\u0000${r.target}\u0000${r.replyTo ?? r.at}`;

	function tick(): void {
		const t = now();
		const restarting = deps.restarting();
		const open = new Set<string>();
		for (const s of deps.sessions()) {
			const listed = s.open();
			const spent = listed.filter(r => {
				const w = wakes.get(idOf(s, r));
				return r.replyTo === undefined && r.workers.length === 0 && w !== undefined && w.count >= MAX_WAKES && t - w.at >= RETRY_MS;
			});
			if (spent.length && s.drop) {
				deps.log(`${spent.length} open request(s) still unanswered after the last reminder: session ${s.key} drops them`);
				s.drop(spent);
			}
			const requests = s.drop ? listed.filter(r => !spent.includes(r)) : listed;
			for (const r of requests) open.add(idOf(s, r));
			if (!requests.length) {
				quiet.delete(s.key);
				continue;
			}
			// The cheap checks first; workers() reads the task store and runs only while a request is open.
			if (restarting || s.busy() || s.down() || requests.some(r => s.armed(r.at)) || s.workers() > 0) {
				quiet.set(s.key, t);
				continue;
			}
			const since = Math.max(quiet.get(s.key) ?? t, s.lastTurnEndAt());
			if (!quiet.has(s.key)) quiet.set(s.key, t);
			const due = requests.filter(r => {
				const w = wakes.get(idOf(s, r));
				return t - Math.max(since, r.at) >= QUIET_MS && (!w || (w.count < MAX_WAKES && t - w.at >= RETRY_MS));
			});
			if (!due.length) continue;
			for (const r of due) {
				const id = idOf(s, r);
				wakes.set(id, { count: (wakes.get(id)?.count ?? 0) + 1, at: t });
			}
			quiet.set(s.key, t);
			deps.log(`${due.length} open request(s) with nothing running for ${Math.round(QUIET_MS / 1000)} s: session ${s.key} is woken`);
			s.wake(due, due.every(r => wakes.get(idOf(s, r))!.count >= MAX_WAKES));
		}
		for (const id of wakes.keys()) if (!open.has(id)) wakes.delete(id);
	}

	return { tick };
}
