// The shapes of a stored notice and its decision. A part of the notice store split out of hub/notices.ts, code unchanged.
import type { DecisionOption } from "./choices.ts";
import type { DraftApproval } from "./draft-approval.ts";
import type { WatchItem } from "./watchitem.ts";
import type { ResultFile, ResultLink } from "./result-refs.ts";
import { say } from "./notices-read.ts";

// The web notification store: every worklog / alert / session result / watch / schedule post, kept in notices.json so the
// bell survives a restart. Fed by what the hub already emits (onEmit), so main.ts only wires the API and the resolver.
export type NoticeKind = "result" | "alert" | "worklog" | "watch" | "decision" | "message";
export type NoticeTone = "done" | "run" | "wait" | "ask" | "fail" | "";
export type Notice = {
	id: string;
	ts: string;
	updated: string;
	kind: NoticeKind;
	tone: NoticeTone;
	title: string;
	text: string;
	// The conversation to open on tap: "main", "lane:<name>" or "ch:<id>".
	open: string;
	// The source message: the conversation it lives in ("main", "lane:<name>", "ch:<id>") and its event ts, which the web finds
	// on the rendered message (data-ts). Older items have neither: the web falls back to open + updated.
	src?: string;
	at?: string;
	// The conversation holding the `at` message when it is not `src`: a session's line posted to 작업내역 belongs to the session (src) but lives there.
	msg?: string;
	key?: string;
	// kind "worklog": what the post is and its state (hub/worklog-kind.ts); the web draws its row from them.
	wk?: string;
	wst?: string;
	// Who raised it: "orchestrator", "lane:<name>" or "gateway" (older items have none: originOf falls back to the decision target / lane key).
	by?: string;
	// The owner message (or earlier post) the asking post replied to: what lets a later [done] to that same request tell it is about the same matter.
	ref?: string;
	// kind "watch": the key of the app integration (hub/integrations.ts) the report belongs to. It stays in that app's view and out of 감시 소식.
	app?: string;
	// kind "watch": the watch's own name, so a report of a watch an app owns (a login keeper, a sync) is stamped with that app whatever its words say.
	watch?: string;
	// kind "watch": the app item the check pointed at (a `DOTZ_ITEM <app>:<id>` line) with the card to draw for it. A report that names an item stays in 감시 소식 whatever its words say.
	item?: WatchItem;
	read: boolean;
	// The results its report names (hub/result-refs.ts): files, commits and links the row shows as chips.
	files?: ResultFile[];
	links?: ResultLink[];
	// Swiped away / x in the bell: kept (so a session's next progress line does not bring it back) but never listed or counted.
	dismissed?: boolean;
	// The owner's x on a question (ignoreNotice): off the badge and 답변 필요 but kept in the history, marked as ignored; undoable.
	// Nothing is sent to the bot. The value is when it was ignored.
	ignored?: string;
	// A failure or lost login waits on the owner until this is a time (✕ on it, a rerun that passed, the login back); null = waiting. Absent on a notice stored before it:
	// unread = waiting, read = a past notice (reading an unread one sets null). Never migrated in the file.
	handled?: string | null;
	// Earlier occurrences folded into this row, newest first: a repeated alert it overwrote, a monitor's earlier report within a day (REPEATS_MAX, REPEAT_TEXT).
	repeats?: { at: string; text: string }[];
	// kind "decision": a question that waits on the owner (title = the decision line, text = the whole asking message).
	decision?: Decision;
};

// `say` is the text sent when the button is chosen (default "<n>) <label>"); `action` marks a login request's button (approve / cancel /
// form = the page's own input form, never answered through the hub).
export type DecisionOpt = DecisionOption & { say?: string; action?: string };
export type Decision = {
	options: DecisionOpt[];
	// Where the answer goes: "main", "lane:<name>", "ch:<id>" (a project chat) or "auth:<request id>".
	to: string;
	// The asking message (its event ts): the answer is sent as a reply to it.
	reply_to?: string;
	// How many decisions the asking message held; with more than one the answer names its decision.
	group: number;
	// "ignored": the owner waved it off with the x (Notice.ignored); the matter was not answered.
	state: "open" | "answered" | "ignored";
	// True when no answer came but the matter was resolved by other means (resolveAsks): the bot finished it, the owner acted outside the app.
	resolved?: boolean;
	// When the question stops waiting on the owner (ANSWER_WINDOW_MS / ALERT_ANSWER_WINDOW_MS): set when it opens or re-opens. Absent on a
	// send-approval card and a login request, whose own state closes them.
	expires_at?: string;
	// The question's time was up (settleExpiredQuestions): closed as resolved, with no answer. The web shows it as 기한 지남.
	expired?: true;
	answer?: string;
	answered_at?: string;
	// A draft waiting for send approval (hub/draft-approval.ts): the sheet shows it above the options.
	draft?: DraftApproval;
	// The options are the gateway's defaults for a question without a choice block (ask-options.ts): buttons for the owner, but the matter still
	// ends like a plain question (the resolving signals may close it).
	assumed?: true;
	// An approved draft the gateway sends itself (hub/approval-send.ts): how that send went, shown on the answered card.
	send?: { state: "undo" | "queued" | "sending" | "sent" | "failed" | "unsure" | "back"; text?: string; at: string; /** `undo`: when the cancel window ends (ms). */ until?: number; /** Which try this is, set when a failed send was queued again (absent = the first). */ attempts?: number };
	// Where the send-approval card went on Discord (outbound.ts markDraftPosted): kept so the message is closed when the card is, also after a restart.
	card?: { target: string; ids: string[] };
};
