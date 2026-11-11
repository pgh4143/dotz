// The prompt queue's shapes and limits: types and constants that capture no state (the queue itself is prompts.ts).

export type Prompt = { key: string; text: string; at: number; target?: string; replyTo?: string; refs?: string[]; sent: { target: string; text: string }[]; done?: boolean; steered?: boolean; noted?: string; seen?: boolean; gathered?: boolean; owner?: boolean; held?: string[]; last?: string; unmatched?: boolean; deferred?: boolean; cancelled?: boolean; told?: string[]; retry?: boolean; from?: string; handback?: true; quiet?: true };
/** An owner message the gateway delivered (or, from the inbox log, delivered before this process started). */
export type OwnerMessage = { target: string; replyTo?: string; at: number; prompt?: Prompt };
export type Pending = { text: string; at?: number; target?: string; replyTo?: string; refs?: string[]; deferred?: boolean; from?: string; handback?: true; quiet?: true };
/** A worker and the request it was spawned for. `also`: follow-ups deferred to it; `receipted`: its line was posted; `delivered`: an answer from its result went out; `read`: its result was read in a run that did not answer it. */
export type WorkLink = { id: string; target: string; replyTo?: string; at: number; description?: string; also?: string[]; receipted?: boolean; delivered?: boolean; read?: boolean; cancelled?: boolean };
/** A request waiting on background work, for the gateway's silent-wait check (hub/waitcheck.ts). */
export type OpenRequest = { target: string; replyTo?: string; at: number; workers: { id: string; description?: string }[] };
/** One of this session's background workers, as hub/bgwork.ts lists it (running oldest first, then recently finished newest first). */
export type WorkRow = { id: string; description?: string; status: "running" | "stalled" | "done" | "failed"; target?: string; replyTo?: string; startedAt: number; endedAt?: number };
export type Reply = { target: string; replyTo?: string; refs?: string[]; owner?: boolean; from?: string; handback?: true; quiet?: true }; // quiet: a system check, see deps.quietNote; refs: every message merged into this prompt

export type PromptDeps = {
	/** Keeps the answer of a quiet check (a plain one that does not begin with [ask] or [fail]) as one worklog line; it is posted nowhere else and notifies no one. */
	quietNote?: (target: string, text: string) => void;
	/** Starts a normal orchestrator turn with this prompt. */
	deliver: (text: string, owner?: boolean) => void;
	/** The conversation an answer with no label goes to (the session's own primary target); "web" when unset. */
	home?: string;
	/** Gives the answer to work another session handed over (`from`) back to that session instead of posting it. */
	handBack?: (from: string, text: string, replyTo?: string) => void;
	/** Steers a note into the running turn; false when no turn was running to take it. */
	steer: (text: string) => boolean | void;
	/** Is the orchestrator mid-turn (so a new message is steered)? */
	working: () => boolean;
	/** The steered note for a new message. */
	note: (target: string, replyTo: string | undefined, text: string) => string;
	/** Is this prompt text a gateway note steered into a turn (not a new request)? */
	isNote: (text: string) => boolean;
	regenerated?: (text: string) => boolean; // a gateway nudge the silent-wait check (hub/waitcheck.ts) sends again while due: never replayed
	/** Posts a turn's final answer to the channel that asked. */
	post: (target: string, text: string, replyTo?: string) => Promise<{ delivered: boolean }>;
	/** A gateway note in a conversation that answers nothing (the deferral acknowledgement must not settle the open prompt). */
	announce?: (target: string, text: string, worker?: string) => void;
	interim?: (target: string, text: string) => void;   // what a [later] turn wrote around the word: a message that answers nothing
	noAnswerNote?: () => string;   // what the owner is told when a turn ended without writing any text
	/** The background worker now running for a conversation (the oldest one), when it is already listed. */
	workFor?: (target: string) => { id: string; description: string } | undefined;
	/** The gateway note (one line) that points a new owner message at the worker already running for its conversation. */
	joinNote?: (worker: { id: string; description: string }) => string;
	/** Does this text already carry that note (a restart replay stored it with the prompt)? */
	hasJoinNote?: (text: string) => boolean;
	/** This session's background workers; read only at delivery and at turn end (bgwork.ts caches the store). */
	work?: () => WorkRow[];
	/** The note that keeps another conversation's running worker answer out of this prompt's conversation. */
	foreignNote?: (worker: WorkRow, target: string) => string;
	/** Does this text already carry that note (a restart replay stored it with the prompt)? */
	hasForeignNote?: (text: string) => boolean;
	/** The note that asks a conversation again because its worker's result was read in a turn for another conversation. */
	readElsewhereNote?: (worker: WorkRow, readIn: string) => string;
	/** The note that asks a request again because its worker's result was read in a turn that did not answer it. */
	readHereNote?: (id: string) => string;
	/** The note naming the send-approval cards that wait in this conversation (hub/approval-queue.ts pendingCardsNote), if any. */
	cardsNote?: (target: string) => string | undefined;
	/** Does this text already carry that note (a restart replay stored it with the prompt)? */
	hasCardsNote?: (text: string) => boolean;
	clearProgress: (target: string) => void;
	/** Writes the open prompts to disk. */
	persist: (open: Pending[]) => void;
	/** The worker links read from disk at start, and how they are written back (only when one changes). */
	links?: WorkLink[];
	persistLinks?: (links: WorkLink[]) => void;
	/** A finished worker's real report when OmO's delivered result is only its trailing housekeeping line (bgwork.ts reportOf). */
	report?: (id: string) => string | undefined;
	log: (message: string) => void;
	/** reply_to ids of messages answered before this process started (the outbox tail). */
	answered?: Iterable<string>;
	/** An answer to this message is on its way (sendlog.ts) and counts as answered. */
	pending?: (replyTo: string) => boolean;
	/** Owner messages from before this process started (the inbox tail), for an answer that has no prompt. */
	recent?: () => OwnerMessage[];
	/** Did the orchestrator answer in `target` after `at`? Settles stored prompts that carry no message id (written before web messages had one). */
	answeredSince?: (target: string, at: number) => boolean;
	/** These messages of `target` were answered by an answer that names another one of the burst. */
	settled?: (target: string, ids: string[]) => void;
};

// Near-identical answers: the first NEAR_CHARS letters and digits (lowercased, no spaces or punctuation) match, at least NEAR_MIN long.
export const NEAR_CHARS = 40;
export const NEAR_MIN = 20;
export const head = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").slice(0, NEAR_CHARS);
export const MAX_PROMPTS = 200;
export const MAX_ANSWERED = 5000;
export const REPLAY_MAX_AGE_MS = 12 * 3600_000;
// How old an owner message may be to receive an answer that has no prompt of its own.
export const ORPHAN_MAX_AGE_MS = 30 * 60_000;
export const MAX_RECENT = 20;
export const DEFER_MAX_AGE_MS = 3 * 3600_000;
// A restart waits for a deferred prompt this young (its worker dies with the orchestrator process); older ones do not block.
export const DEFER_BLOCKS_RESTART_MS = 60 * 60_000;
// Turns kept for tying a background worker to the turn that spawned it, and the clock rounding allowed after a turn's end.
export const MAX_TURNS = 200;
export const TURN_SLACK_MS = 1000;

export const CANCEL_NOTE_MS = 10 * 60_000;
// Links are kept a day (a request stays open at most DEFER_MAX_AGE_MS, a restart replay reads them up to REPLAY_MAX_AGE_MS).
export const LINK_MAX_AGE_MS = 24 * 3600_000;
export const MAX_LINKS = 300;
export const REPORT_NOTE_CHARS = 3000;
