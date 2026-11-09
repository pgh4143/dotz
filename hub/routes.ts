// HTTP routing of the hub: the install files, the identity check and the first part of the route chain; the rest is routes-settings.ts and routes-lanes.ts.
// Split out of main.ts; the restart hooks come from main as plumbing, so this module never imports it.
import { readFileSync } from "node:fs";
import { dropAnsweredMailDraft } from "./draft-drop.ts";
import { approvalRoute, TRIAGE_MIN_DEFAULT, webAnswer } from "./approval-wire.ts";
import { join } from "node:path";
import { cloudflareGate } from "./devices.ts";
import { type Confirm, nativeConfirm } from "./local-login-dialog.ts";
import { createLocalLogin } from "./local-login.ts";
import { createWebAccess, localBrowser, WebAccessError, webAccessRoute } from "./web-access.ts";
import type { Server } from "bun";
import { ADDRESS, cfg, DATA_DIR, HUB_TOKEN, log, NAME, now, PORT, setMachineName } from "./config.ts";
import { limitWaits } from "./limitwait.ts";
import { buildWaitlist } from "./waitlist.ts";
import { keyedSelector, keyFileOk, spendOnKey } from "./fallback.ts";
import { changeTarget, ControlError, targetView, ForceRequired, parseCommand } from "./control.ts";
import * as discord from "./discord.ts";
import { authRoute, pendingAuth } from "./auth.ts";
import { pushRoute } from "./push.ts";
import { conversationList } from "./conversations.ts";
import { INTEGRATIONS, readAppOff } from "./integrations.ts";
import { allWatches, approveWatch, runWatch } from "./watch.ts";
import { watchConnection } from "./watch-status.ts";
import { fieldsOf, isSettingsTarget } from "./app-settings.ts";
import { watchOfSubject } from "./watch-settings.ts";
import { conversationPage } from "./conversations-page.ts";
import { lazyMailCard } from "./conversations-mail-card.ts";
import { markRead, markUnread } from "./reads.ts";
import { shownEvent } from "./owner-text.ts";
import { activityItems, broadcast, historyEvents, historyPage, ownerMessage, recentEvents, sentFiles, sseResponse } from "./events.ts";
import { subagentLists } from "./activity.ts";
import { cancelOmoWorker, retryText, runningOmoWork, workConversation } from "./bgwork.ts";
import { lastTurnActed, lastTurnEnd, lastTurnFailed, mailConversation, openTodos, runIntent, runState, stallStep, workConversationRuns, type RunState, type StallMemo } from "./runstate.ts";
import { isProjectTarget, projectTarget } from "./projectchat.ts";
import { askedFile, draftAttachRoute, syncCardFiles } from "./draft-attach.ts";
import { parseFollowup, triggerFollowup } from "./followup.ts";
import { draftFileRoute } from "./draft-files.ts";
import { draftRecipientsRoute } from "./draft-recipients.ts";
import { stagedFiles } from "../features/reply-drafts/lib/staged.ts";
import { composeMail, deleteMail, mailTargets, sentReplyRefs, unrepliedMails, mailKey, recordSentByDotz, mailOpened, MailError, syncMailStates, type MailSourceState, mailBodyRoute, settleMailDrafts, mailCard, mailStateOf, mailByKey, mailByThread, mailFileRoute, mailTarget, postMail, setMailFyi, setMailNoReply, setMailsFyi, mailKeep, setMailSuggest, sentMailEvent, setMailReply, type MailDeps } from "./mail.ts";
import { moveMailRoute } from "./mail-move.ts";
import { applyMailboxFlags, isMailAction, mailAction, mailActions, spawnExec, type SyncDeps } from "./mail-sync.ts";
import { originalDeletable, originalDeleteRoute, originalDeps } from "./mail-delete.ts";
import { manualDraft } from "./mail-manual.ts";
import { askText } from "../features/reply-drafts/lib/flow.ts";
import { pluginMailAction, pluginMailActions } from "./plugins.ts";
import { webmailSite } from "../features/reply-drafts/lib/senders.ts";
import { getDraft, holdDrafts, holdDraftsOf, listDrafts, restoreDrafts, restoreDraftsOf } from "../features/reply-drafts/lib/store.ts";
import { attachmentLines, canvasRoute, fileRoute, FileError, messageFiles, ownerFiles, serveFile, UPLOAD_MAX_BYTES, uploadsFrom } from "./files.ts";
import { ownerElements, pickedLines } from "./picked.ts";
import { ownerRefs, refLines } from "./mentions.ts";
import { laneCapacity, laneClosed, lanes, liveLanes, laneSummary } from "./lanes.ts";
import { withHomes } from "./laneviews.ts";
import { main as mainOrch, orch } from "./orchestrator.ts";
import { enqueue, queueItems, restore, take } from "./queue.ts";
import { listMonitors } from "./monitors.ts";
import { type DecisionSend, type Notice, allNotices, settleHandledDrafts, listNotices, dismissedAlertAts, readConversationNotices, reopenDraftNotices, resolveNotices, unreadCount } from "./notices.ts";
import { loadProjects, saveProject } from "./projects.ts";
import { deleteProject, planDelete, ProjectDeleteError } from "./projectdelete.ts";
import { listSchedules } from "./schedule.ts";
import { openMonitor, readTodo } from "./todo.ts";
import { customRoute } from "./custom.ts";
import { deleteKey, importOmoKey, keysView, saveKey } from "./apikey-store.ts";
import { updateRoute } from "./selfupdate.ts";
import { updateNow } from "./update-now.ts";
import { harnessUpdateRoute } from "./harness-update.ts";
import { appAsset, committedText, indexPage, setAppName, webBuild } from "./webapp.ts";
import { forgetRoute, listPeers, ownLogin } from "./peers.ts";
import { ambientWrite, entryHost, ownTailnetName, refuse, tokenOk } from "./entry-check.ts";
import { peerProjects } from "./peer-projects.ts";
import { relayRoute, relayRows } from "./relay-route.ts";
import { handlePair, PAIR_PATH } from "./peer-pair.ts";
import { checkPeer } from "./peer-auth.ts";
import { activatePeerMonitor, createPeerMonitor } from "./peer-monitor.ts";
import { handleLease, type LeaseReq } from "./send-lease.ts";
import { cleanName, friendlyName, resolveName } from "./machine-name.ts";
import { machineHost } from "./hostname.ts";
import { queue, bgWork, workRows, out, progress, fileRoots } from "./outbound.ts";
import { convs, maxLiveView } from "./convsessions.ts";
import { repostRefusal } from "./lanewire.ts";
import { MAIN, primaryTarget } from "./session-key.ts";
import { authHeld, parseReply, replyLine, sendWeb } from "./intake.ts";
import { isTaskTarget, openTaskOf, openTasks, taskRoute, withTask } from "./task-conversation.ts";
import { json, body, terminals, BodyError } from "./routes-util.ts";
import { ptyRoute } from "./pty.ts";
import { desk } from "./remote-desktop.ts";
import { projectFiles } from "./projectinfo.ts";
import { routeApps } from "./routes-apps.ts";
import { routeLanes } from "./routes-lanes.ts";
import { routeNotices } from "./routes-notices.ts";
import { routeSettings } from "./routes-settings.ts";
import { commentsRoute } from "./comments/gateway.ts";
import { userApp } from "./user-apps.ts";
import { proxyMatch, proxyRequest } from "./app-proxy.ts";
import { igDmRoute } from "./ig-dm-gateway.ts";
import { kakaoRoute } from "./kakao/gateway.ts";
import { defaultOnboardDeps, onboardingService, setOnboardDeps } from "./onboarding.ts";
import { saveWebAccessInput } from "./onboarding-web-access.ts";
import { createSetupGate } from "../firstrun/setup-gate.ts";
import { chartRoute } from "./chart.ts";

const BOOT_ID = Date.now().toString(36);
setAppName(NAME);
// Installable-app files next to index.html: manifest, service worker (never cached by HTTP, so an update is seen at once), icons.
const APP_FILES: Record<string, [string, string]> = {
	"/manifest.webmanifest": ["manifest.webmanifest", "application/manifest+json"],
	"/sw.js": ["sw.js", "text/javascript; charset=utf-8"],
	"/icons/icon-192.png": ["icons/icon-192.png", "image/png"],
	"/icons/icon-512.png": ["icons/icon-512.png", "image/png"],
	"/icons/maskable-512.png": ["icons/maskable-512.png", "image/png"],
	"/icons/apple-touch-icon.png": ["icons/apple-touch-icon.png", "image/png"],
	"/icons/dotz.svg": ["icons/dotz.svg", "image/svg+xml"],
	"/icons/badge-96.png": ["icons/badge-96.png", "image/png"],
	"/icons/monochrome-192.png": ["icons/monochrome-192.png", "image/png"],
	"/icons/monochrome-512.png": ["icons/monochrome-512.png", "image/png"],
	// xterm.js for the web terminal (web/js/36-shell.js loads it on first open); library code, no secrets.
	"/vendor/xterm.js": ["vendor/xterm.js", "text/javascript; charset=utf-8"],
	"/vendor/addon-fit.js": ["vendor/addon-fit.js", "text/javascript; charset=utf-8"],
	"/vendor/xterm.css": ["vendor/xterm.css", "text/css; charset=utf-8"],
};
export const ALLOW = new Set((cfg.web?.allow_logins ?? []).map(s => s.toLowerCase()));


// Runtime web access (hub/web-access.ts, 설정 → 웹 접속): web.access = "cloudflare" is switched on and off live, so the gates below are read through it per request.
// In that mode a valid Cloudflare Access token (hub/cf-access.ts) is checked once at the route entry (it needs the key fetch), then passed in as cfOk,
// and only paired devices (hub/devices.ts) get in; Access, when set up, is required on top of the device session.
// The Tailscale-User-Login header is trusted only in "tailscale" mode: elsewhere nothing vouches for it, so whoever reaches the port could write it.
// In "local" (이 컴퓨터만) a browser on this computer logs in once: a button on the login page makes the gateway ask on the owner's screen (or the bot hands out a
// link, hub/web-login-cli.ts). In every mode the `dotz` command logs a browser on this computer in with that same link; changing the mode voids such sessions (hub/local-login.ts).
let confirmLogin: Confirm = nativeConfirm;
/** Tests replace the native confirmation dialog of the login page (hub/local-login-dialog.ts) with a fake whose answer they control. */
export const setLoginConfirm = (c: Confirm): void => { confirmLogin = c; };
export const localLogin = createLocalLogin({ dir: DATA_DIR, confirm: number => confirmLogin(number) });
export const webAccess = createWebAccess({ dir: DATA_DIR, allow: ALLOW, notify: text => out("alert", text, undefined, { source: "gateway" }), onModeChange: () => localLogin.clear() });
localLogin.keepMode(webAccess.mode());

function authorized(req: Request, cfOk = false, devOk = false, peerIp?: string, tailnet = false): boolean {
	if (tokenOk(req)) return true;
	if (localBrowser(req, peerIp) && localLogin.verify(req, webAccess.mode())) return true;
	if (webAccess.devices() ? cloudflareGate({ device: devOk, accessConfigured: !!webAccess.cfAccess(), access: cfOk }) : cfOk) return true;
	const login = (req.headers.get("tailscale-user-login") ?? "").toLowerCase();
	if (login && tailnet && ALLOW.has(login) && webAccess.mode() === "tailscale") return true;
	const seen = [...req.headers.keys()].filter(k => k.startsWith("tailscale-")).map(k => `${k}=${req.headers.get(k)}`).join(" ");
	log(`denied ${new URL(req.url).pathname} ${seen || "(no tailscale identity headers)"} from ${req.headers.get("x-forwarded-for") ?? "unknown"}`);
	return false;
}

const compactingNow = (ctx: { compaction?: { state?: string } } | undefined): boolean => ctx?.compaction?.state === "queued" || ctx?.compaction?.state === "compacting";
// Every 30 s: a conversation (main, a conversation session or a session) resting with plan tasks left and nothing to wait for is told to go on
// (runstate.ts stallStep); `nudge` delivers the prompt into that conversation's own session.
export function startStallSweep(nudge: (conversation: string, r: RunState) => void): void {
	const told = new Map<string, StallMemo>();
	const timer = setInterval(() => {
		try {
			const runs = stateRuns(), now = Date.now();
			// sessions too: acme-loss-review on the Mac mini (2026-10-29 01:53Z) ended a turn with a [run] report and 13 tasks open, and
			// nothing woke it (a [run] report stays on disk)
			const keys = ["main", ...convs.conversations().filter(c => convs.live(c)).map(c => c.primary), ...[...lanes.values()].filter(l => !!l.proc && !laneClosed(l)).map(l => `lane:${l.name}`)];
			for (const k of keys) {
				const r = runs[k], step = r && stallStep(r, now, told.get(k) ?? { at: [] });
				if (step) told.set(k, step.memo);
				if (!r || !step?.nudge) continue;
				log(`stall: ${k} rested (${r.todos ? `${r.todos} task(s) left` : "promised work not done"}) since ${r.since}; told to go on`);
				nudge(k, r);
			}
		} catch (e) {
			log(`stall sweep failed: ${e}`);
		}
	}, 30_000);
	timer.unref();
}
// The run state of every conversation (/api/state `runs`): what each session is doing, and when it is idle with plan tasks left, why.
function stateRuns(): Record<string, RunState> {
	const nowMs = Date.now();
	const works = bgWork.list();
	const running = works.filter(w => w.status === "running");
	const deferred = queue.deferredOpen();
	const asks = allNotices()
		.filter(n => n.kind === "decision" && n.decision?.state === "open")
		.sort((a, b) => String(a.at ?? "").localeCompare(String(b.at ?? "")));
	const askFor = (target: string) => {
		const n = asks.find(x => { const to = x.decision!.to; return to === target || (target === "main" && to.startsWith("auth:")); });
		return n ? { text: n.text || n.title, at: n.at } : undefined;
	};
	const turnStart = (source: string, fallback: string) => lastTurnStart(activityItems(source)) ?? fallback;
	const mainItems = activityItems("orchestrator");
	const main = runState({
		status: orch.status,
		since: (orch.status === "stopped" ? orch.stoppedAt || orch.startedAt : turnStart("orchestrator", orch.startedAt)) || undefined,
		intent: runIntent(mainItems),
		rateLimitedUntil: orch.rateLimitedUntil,
		pauseKind: orch.pauseKind,
		stoppedBy: orch.stoppedBy || undefined,
		error: orch.error ? { text: orch.error.text, since: orch.error.since } : undefined,
		ask: askFor("main"),
		work: running.filter(w => mainWork(w.target)),
		// a failure a later turn took up (bgwork.ts handled) is over: the line no longer shows it
		failed: (w => (w && !w.handled ? w : undefined))(works.find(w => w.status !== "running" && mainWork(w.target))),
		children: runningChildren("orchestrator"),
		later: deferred.filter(d => d.target === "web" || d.target === "terminal").length,
		lastTurnEnd: lastTurnEnd(mainItems),
		turnFailed: lastTurnFailed(mainItems),
		resuming: orch.resuming,
		lastAnswer: orch.lastText, acted: lastTurnActed(mainItems),
		compacting: compactingNow(orch.ctx),
		queued: mainOrch.heldCount(),
		watching: openMonitor(orch.sessionFile),
		todos: openTodos(readTodo(orch.sessionFile)),
		now: nowMs,
	});
	const lanesOut: Record<string, RunState> = {};
	for (const lane of lanes.values()) {
		const source = `lane:${lane.name}`, items = activityItems(source), workers = runningOmoWork(lane.sessionFile);
		lanesOut[source] = runState({
			status: lane.status,
			since: turnStart(source, lane.startedAt),
			intent: runIntent(items),
			ask: lane.pendingAsk ? { text: lane.pendingAsk.text, at: lane.pendingAsk.at } : undefined,
			work: workers,
			children: runningChildren(source),
			later: deferred.filter(d => d.target === source).length,
			capacity: lane.waiting, resumeDue: lane.resumeDue,
			lastTurnEnd: lastTurnEnd(items),
			turnFailed: lastTurnFailed(items),
			resuming: lane.resuming,
			lastAnswer: lane.lastText, acted: lastTurnActed(items),
			compacting: compactingNow(lane.ctx),
			watching: openMonitor(lane.sessionFile),
			todos: openTodos(readTodo(lane.sessionFile)),
			now: nowMs,
		});
	}
	// A conversation with a session of its own (hub/convsessions.ts) shows that session's line, so its window shows its turn, its
	// waiting worker and its own 중단; its state wins over the worker-only line below.
	const convOut: Record<string, RunState> = {};
	for (const c of convs.conversations()) {
		if (!convs.live(c)) continue;
		const source = `conv:${c.key}`, items = activityItems(source), own = c.bg.list();
		convOut[c.primary] = runState({
			status: c.o.orch.status,
			since: (c.o.orch.status === "stopped" ? c.o.orch.stoppedAt || c.o.orch.startedAt : turnStart(source, c.o.orch.startedAt)) || undefined,
			intent: runIntent(items),
			rateLimitedUntil: c.o.orch.rateLimitedUntil,
			pauseKind: c.o.orch.pauseKind,
			stoppedBy: c.o.orch.stoppedBy || undefined,
			error: c.o.orch.error ? { text: c.o.orch.error.text, since: c.o.orch.error.since } : undefined,
			ask: askFor(c.primary),
			work: own.filter(w => w.status === "running"),
			failed: (w => (w && !w.handled ? w : undefined))(own.find(w => w.status !== "running")),
			children: runningChildren(source),
			later: c.queue.deferredOpen().length,
			lastTurnEnd: lastTurnEnd(items),
			turnFailed: lastTurnFailed(items),
			resuming: c.o.orch.resuming,
			lastAnswer: c.o.orch.lastText, acted: lastTurnActed(items),
			compacting: compactingNow(c.o.orch.ctx),
			queued: c.o.heldCount(),
			watching: openMonitor(c.o.orch.sessionFile),
			todos: openTodos(readTodo(c.o.orch.sessionFile)),
			now: nowMs,
		});
	}
	// A mail conversation with no session of its own: the worker its owner message was deferred to is its run state (a thread target
	// and the mail key name the same conversation). Peer snapshots show the same lines, so the other computer's mail is not silent.
	const mailRuns = workConversationRuns(works, t => mailConversation(t, thread => mailByThread(thread)?.key));
	return { main, ...lanesOut, ...mailRuns, ...convOut };
}
// The app conversations whose own session runs (/api/state `convs`, 홈 지금 진행 중 in 08-home.js): the mail's subject as its title
// (the page may not have loaded the mail list) and the background workers that session runs now, listed under its row.
function stateConvs(): { target: string; name?: string; work: ReturnType<typeof bgWork.list> }[] {
	return convs.conversations().filter(c => convs.live(c)).map(c => {
		const mail = c.primary.startsWith("mail:") ? mailByKey(c.primary.slice(5)) : undefined;
		return { target: c.primary, ...(mail?.subject ? { name: mail.subject } : {}), work: c.bg.list().filter(w => w.status === "running").map(w => ({ ...w, target: c.primary })) };
	});
}
export const stateWaitlist = () => buildWaitlist({
	deferred: limitWaits(join(DATA_DIR, "state.json")),
	lanes: laneSummary(),
	work: [...bgWork.queuedWork(), ...convs.conversations().filter(c => convs.live(c)).flatMap(c => c.bg.queuedWork().map(w => ({ ...w, target: c.primary })))],
});
const mainWork = (t: string | undefined) => t === "web" || t === "terminal" || !t;
const lastTurnStart = (items: ReturnType<typeof activityItems>): string | undefined => {
	for (let i = items.length - 1; i >= 0; i--) if (items[i]!.type === "turn_start") return items[i]!.ts;
	return undefined;
};
const runningChildren = (source: string) =>
	(subagentLists()[source] || []).filter(s => s.status === "running").map(s => ({ name: s.id, description: s.description || s.agent }));

type RestartHooks = { /** This node's tailnet name (tests); default `tailscale status`. */ tailnetName?: () => Promise<string | undefined>; busyNow: () => string[]; restartGateway: () => string; restartGatewayNow: () => string; mailDeps?: () => MailDeps; /** One mail reconcile round of at most `limit` mails (hub/mail-reconcile.ts); absent = not wired in this process. */ mailReconcile?: (limit: number) => Promise<{ checked: number; replied: number; notChecked: number; skipped: number }> };
const isMailTarget = (t: string) => /^mail:[a-z0-9._-]+$/.test(t);
// Where a forwarded action came from (a machine name), as one short line; the event it makes carries it as `via`.
const viaOf = (v: unknown): string | undefined => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 40) || undefined : undefined);
// A card's answer to where its question came from (chat, session, project chat, mail or login request): the bot's turn.
export async function deliverAnswer(a: Parameters<DecisionSend>[0] & { login: string; via?: ReturnType<typeof viaOf> }): Promise<void> {
	if (a.to.startsWith("auth:")) {
		const path = `/api/auth/${a.to.slice(5)}`;
		const res = await authRoute(new Request(`http://local${path}`, { method: "POST", body: JSON.stringify({ action: a.action }) }), new URL(`http://local${path}`));
		if (!res?.ok) throw new Error("로그인 요청을 처리하지 못했어요");
		return;
	}
	const lane = a.to.startsWith("lane:") ? a.to.slice(5) : undefined;
	const project = a.to.startsWith("ch:") ? projectTarget(a.to, discord.channels.work) : undefined;
	const conv = a.to === "alert" || a.to === "worklog" ? a.to : undefined;
	const mail = a.to.startsWith("mail:") ? mailByKey(a.to.slice(5)) : undefined;
	if (a.to.startsWith("mail:") && !mail) throw new Error("이 메일 대화를 찾을 수 없어요");
	await sendWeb({ lane, project, mail, conv, channel: "web", text: a.text, mode: "default", login: a.login, replyTo: a.replyTo, decision: a.notice, picks: a.picks, files: a.files, via: a.via });
}

// The pending reply drafts of one mail are dropped (the same store step as 보내지 않기) and their approval cards settled at once.
const dropMailDrafts = async (key: string) => {
	const pending = listDrafts().filter(d => d.ref === key && (d.status === "pending" || d.status === "held"));
	if (pending.length) {
		const { dropDraft } = await import("../features/reply-drafts/lib/flow.ts");
		for (const d of pending) { const r = dropDraft(d.id); if (!r.ok) log(`draft ${d.id}: not dropped with its mail: ${r.text}`); }
	}
	await settleHandledDrafts().catch(e => log(`mail ${key}: handled-draft settle failed: ${(e as Error).message}`));
};
/** 삭제 / 휴지통 on a mail: it leaves dotz (record, list entry, counts, its notices and pending drafts); the real mailbox is not touched here. */
const removeMailLocal = async (key: string): Promise<boolean> => {
	if (!deleteMail(key)) return false;
	await dropMailDrafts(key);
	readConversationNotices(mailTarget(key), new Date().toISOString());
	broadcast({ kind: "mail_unreplied", target: mailTarget(key) });
	return true;
};
/** hub/mail-sync.ts wired to the real parts: zele and plugins for the mailbox, the read position, deleting. */
export const mailSyncDeps: SyncDeps = {
	exec: spawnExec,
	plugin: pluginMailAction,
	pluginCan: pluginMailActions,
	webmail: s => !!webmailSite(s),
	setRead: (target, ts, direction) => {
		if (direction === "read") {
			const x = markRead({ target, ts });
			if (x.ok) readConversationNotices(x.target, x.ts);
		} else markUnread({ target, ts });
		broadcast({ kind: "mail_unreplied", target });
	},
	remove: removeMailLocal,
	changed: key => broadcast({ kind: "mail_unreplied", target: mailTarget(key) }),
	log,
};
export const mailOriginal = originalDeps(DATA_DIR, mailSyncDeps);
const keyOfSource = (source: string, id: string): string | undefined => {
	try {
		return mailKey(source, id);
	} catch {
		return undefined;
	}
};

// POST /api/mail/compose without a ref: the draft he wrote in the mail app (web/js/30-mail-box.js), its uploads staged for it, and the
// send-approval card posted to the conversation of the mail it answers (or the new mail's own row gains one). Nothing is sent here.
async function draftFromApp(b: Record<string, unknown>, deps: MailDeps): Promise<Response> {
	let files: { path: string; name: string }[];
	try {
		files = ownerFiles(b.attachments).map(f => ({ path: f.path, name: f.original ?? f.name }));
	} catch (error) {
		return json({ error: (error as Error).message }, error instanceof FileError ? error.status : 400);
	}
	const made = manualDraft({
		body: b.body as string | undefined,
		to: b.to as string | undefined,
		cc: b.cc as string | undefined,
		subject: b.subject as string | undefined,
		replyTo: b.reply_to as string | undefined,
		app: b.app as string | undefined,
		files,
	});
	if (!made.ok) return json({ error: made.error }, made.code);
	const { rec } = made;
	// A new mail is listed like any other draft of the app (hub/mail.ts composeMail); a reply rides on the mail it answers.
	const key = rec.compose ? composeMail({ ref: rec.id, source: rec.source, app: made.app, to: rec.to, subject: rec.subject ?? "" }, deps).key : rec.ref;
	if (!rec.compose) setMailSuggest(rec.ref, { kind: "reply-draft", label: "메일 초안", ref: rec.id });
	await out(mailTarget(key), askText(rec, []));
	return json({ ok: true, key, ref: rec.id, files: made.attachments.map(f => ({ name: f.name, size: f.size })) });
}

/** A mailbox's read / replied state of its mails (POST /api/mail/state, the zele poll in hub/main.ts): read in dotz once read there (its bell items
 *  too, as when he opens it here), 답장함 once answered there; every device redraws the mails that changed. Returns how many changed. */
export async function applyMailStates(source: string, items: readonly MailSourceState[]): Promise<number> {
	const changed = syncMailStates(source, items, (target, ts) => {
		const r = markRead({ target, ts });
		if (r.ok) readConversationNotices(r.target, r.ts);
		return r.ok && r.moved;
	});
	// Then what changed in the mailbox since its last report: unread / starred / archived / trashed (hub/mail-sync.ts applyMailboxFlags).
	const flags = await applyMailboxFlags(source, items, { ...mailSyncDeps, keyOf: keyOfSource });
	for (const target of new Set([...changed, ...flags])) broadcast({ kind: "mail_unreplied", target });
	return new Set([...changed, ...flags]).size;
}
// The last web sends by client id, with the answer each got (POST /api/message `cid`). Set before the send so a double tap in flight is a retry too.
const sentCids = new Map<string, unknown>();
const rememberCid = (cid: string, answer: unknown): void => {
	sentCids.set(cid, answer);
	if (sentCids.size > 500) sentCids.delete(sentCids.keys().next().value as string);
};
const parseMailStates = (raw: unknown): { source: string; items: MailSourceState[] } | undefined => {
	const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
	if (typeof b.source !== "string" || !b.source.trim() || !Array.isArray(b.items)) return undefined;
	const items = b.items.slice(0, 2000).flatMap(x => {
		const i = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
		return typeof i.id === "string" && i.id ? [{ id: i.id.slice(0, 200), ...(typeof i.read === "boolean" ? { read: i.read } : {}), ...(typeof i.unread === "boolean" ? { unread: i.unread } : {}), ...(i.replied === true ? { replied: true } : {}), ...(typeof i.archived === "boolean" ? { archived: i.archived } : {}), ...(i.trashed === true ? { trashed: true } : {}), ...(typeof i.starred === "boolean" ? { starred: i.starred } : {}) }] : [];
	});
	return { source: b.source.trim().slice(0, 60), items };
};

export function makeRoute({ tailnetName = ownTailnetName, busyNow, restartGateway, restartGatewayNow, mailDeps, mailReconcile }: RestartHooks): (req: Request, srv?: Server<unknown>) => Promise<Response> {
	const setupGate = createSetupGate({ dir: DATA_DIR, localHeaders: () => localLogin.sessionHeaders(), restart: () => void restartGatewayNow(), providers: routeSettings, log });
	// Before any onboarding route can run: the real browser/exec, a gateway restart only after a flow changed config, and the live web-access switch.
	setOnboardDeps(
		defaultOnboardDeps(DATA_DIR, {
			restart: async () => void restartGateway(),
			applyWebAccess: async input => {
				await webAccess.change(input);
			},
		}),
	);
	const handle = async (req: Request, srv?: Server<unknown>): Promise<Response> => {
		const url = new URL(req.url);
		const tailnet = await entryHost(req, srv?.port ?? PORT, tailnetName, webAccess.hostname()); if (tailnet instanceof Response) return tailnet; // entry check (hub/entry-check.ts); true: this came through tailscale serve, so a tailnet login counts
		// The install files (manifest, service worker, icons) are public and secret-free, like any app store listing: a browser
		// or OS fetch that carries no tailnet identity (icon or manifest fetch, SW update check) must still get them, or the
		// phone falls back to a plain shortcut. Everything else stays behind the identity check.
		const appFile = req.method === "GET" || req.method === "HEAD" ? APP_FILES[url.pathname] : undefined;
		// The install name is the owner's assistant name, not the project's; `gateway` is what another computer recognises a gateway by (hub/peers.ts).
		if (appFile && url.pathname === "/manifest.webmanifest") {
			const m = JSON.parse(committedText(appFile[0]) ?? readFileSync(join(import.meta.dir, "..", "web", appFile[0]), "utf8"));
			const body = JSON.stringify({ ...m, name: NAME, short_name: NAME, description: `${NAME} · 항상 켜져 있는 개인 비서`, gateway: "dotz" });
			return new Response(req.method === "HEAD" ? null : body, { headers: { "Content-Type": appFile[1], "Cache-Control": "no-cache" } });
		}
		if (appFile) return new Response(req.method === "HEAD" ? null : committedText(appFile[0]) ?? Bun.file(join(import.meta.dir, "..", "web", appFile[0])), { headers: { "Content-Type": appFile[1], "Cache-Control": url.pathname === "/sw.js" || url.pathname.endsWith(".webmanifest") ? "no-cache" : "public, max-age=86400" } });
		// The other gateways read this computer's chosen name here (hub/peers.ts); it is a display name, no secret, so it is public like the manifest.
		if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/api/peer-info") return json({ name: resolveName(cfg.web?.machine_name, machineHost()) });
		// Pairing gates itself: only a request from this node's own tailscale login gets a token (hub/peer-pair.ts), so it needs no owner check first.
		if (req.method === "POST" && url.pathname === PAIR_PATH) return tailnet ? handlePair(req, { ownLogin }) : refuse("pairing outside the tailnet", req);
		// A request with the peer header gets only the peer paths (hub/peer-auth.ts); a good one skips the owner check, a bad one never reaches it.
		const devices = webAccess.devices();
		const cfAccess = webAccess.cfAccess();
		const pairing = await devices?.pairRoute(req, url, cfAccess ? r => cfAccess.verifyRequest(r) : undefined);
		if (pairing) return pairing;
		const peer = checkPeer(req);
		if (peer === "denied") return new Response("forbidden", { status: 403 });
		// The login link and the login page's request are answered before the owner check (they are how a browser becomes the owner); a peer request never gets here (checkPeer above).
		if (peer === "none" && req.method === "GET" && url.pathname === "/local-login") return localLogin.page(req, url, webAccess.mode(), srv?.requestIP(req)?.address);
		if (peer === "none" && req.method === "POST" && url.pathname === "/local-login/request") return localLogin.request(req, url, webAccess.mode(), srv?.requestIP(req)?.address);
		if (peer === "none" && req.method === "GET" && url.pathname === "/local-login/status") return localLogin.status(req, url, webAccess.mode(), srv?.requestIP(req)?.address);
		if (peer === "none") { const r = await setupGate.route(req, url, srv?.requestIP(req)?.address); if (r) return r; }
		if (peer === "none" && !authorized(req, !!cfAccess && (await cfAccess.verifyRequest(req)), !!devices && (await devices.verifySession(req)), srv?.requestIP(req)?.address, tailnet)) return devices ? devices.denied(req, url) : webAccess.mode() === "local" ? localLogin.hint(req, srv?.requestIP(req)?.address) : new Response("forbidden", { status: 403 });
		if (peer === "none") { const r = ambientWrite(req, url.pathname); if (r) return r; } // a cookie or tailnet login writes only from its own page
		const deviceApi = peer === "none" ? await devices?.apiRoute(req, url) : undefined;
		if (deviceApi) return deviceApi;
		const accessApi = peer === "none" ? await webAccessRoute(req, url, webAccess) : undefined;
		if (accessApi) return accessApi;
		const loginLink = peer === "none" ? localLogin.loginLink(req, url, { port: PORT, tokenOk: tokenOk(req), local: localBrowser(req, srv?.requestIP(req)?.address) }) : undefined;
		if (loginLink) return loginLink;
		// 설정 → 웹 접속: Cloudflare starts the onboarding flow, 이 컴퓨터만 records the mode and is done at once. Neither answer carries a secret.
		if (peer === "none" && url.pathname === "/api/web-access/onboard") {
			if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
			const b = await body(req);
			if (b.mode === "local") {
				try {
					await webAccess.change({ mode: "local" });
				} catch (error) {
					if (error instanceof WebAccessError) return json({ error: error.message }, 400);
					throw error;
				}
				return json(onboardingService().markDone("web-access"));
			}
			if (b.mode !== "cloudflare") return json({ error: "mode must be cloudflare or local" }, 400);
			const hostname = typeof b.hostname === "string" ? b.hostname.trim() : "";
			if (hostname) saveWebAccessInput(DATA_DIR, { hostname });
			return json(onboardingService().start("web-access"));
		}
		const peerResponse = await peers.route(req, url);
		if (peerResponse) return peerResponse;
		// 화면 공유 (hub/remote-desktop.ts): /desk/, /api/desk/*, the peer's Chrome opener; null = upgraded to a websocket.
		const deskResponse = await desk.route(req, url, srv, webAccess.mode());
		if (deskResponse !== undefined) return deskResponse as Response;
		// A computer reached only through a messenger (the adapter's relay): its chat JSON and the old chat page's redirect, behind the same gate (hub/relay-route.ts).
		const relayed = peer === "none" ? await relayRoute(req, url) : undefined;
		if (relayed) return relayed;
		// A user app's own web UI (hub/user-apps.ts, hub/app-proxy.ts): /apps/<id>/… -> its loopback server, same gate as the API.
		const proxied = proxyMatch(url.pathname);
		if (proxied) {
			const app = userApp(DATA_DIR, proxied.id, INTEGRATIONS.map(i => i.key));
			if (!app) return new Response("not found", { status: 404 });
			if (app.off) return new Response("이 앱은 꺼 두었어요", { status: 409 });
			return (await proxyRequest(req, url, app, proxied, srv)) as Response;
		}
		const parts = url.pathname.split("/").filter(Boolean);
		const authResponse = authRoute(req, url);
		if (authResponse) return authResponse;
		const ptyResponse = await ptyRoute(req, url);
		if (ptyResponse) return ptyResponse;
		if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/") return indexPage(req);
		const asset = appAsset(req, url.pathname);
		if (asset) return asset;
		if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/custom.js") {
			const file = Bun.file(join(import.meta.dir, "..", "web", "custom.js"));
			// No file is an empty script, not a 404: the service worker caches it with the shell, and one failed file would stop the whole cache.
			const body = req.method === "HEAD" ? null : (await file.exists()) ? file : "";
			return new Response(body, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" } });
		}
		const pushResponse = await pushRoute(req, url);
		if (pushResponse) return pushResponse;
		const updateResponse = await updateRoute(req, url, { boot: BOOT_ID, busy: busyNow, restartIdle: restartGateway, restartNow: restartGatewayNow, now: updateNow() });
		if (updateResponse) return updateResponse;
		// Settings → 업데이트 → 실행 하네스 (hub/harness-update.ts): the harness binary itself, from the package registry.
		const harnessUpdateResponse = await harnessUpdateRoute(req, url, { busy: busyNow, restartIdle: restartGateway });
		if (harnessUpdateResponse) return harnessUpdateResponse;
		const customResponse = await customRoute(req, url, { lanes: () => withHomes(laneSummary(), discord.channels), channels: () => discord.channels, work: () => bgWork.list(), send: (target, text, login) => sendWeb({ ...(target === "main" ? {} : { lane: target.slice(5) }), channel: "web", text, mode: "default", login }), machine: () => resolveName(cfg.web?.machine_name, machineHost()), peerProjects });
		if (customResponse) return customResponse;
		// Project records (hub/projects.ts) and the todo strip (hub/todo.ts), docs/layers.md §4.
		if (url.pathname === "/api/projects" && req.method === "PUT") {
			try {
				return json(saveProject(await body(req)).record);
			} catch (error) {
				return json({ error: (error as Error).message }, 400);
			}
		}
		if (url.pathname === "/api/projects" && req.method === "GET") return json({ projects: loadProjects() });
		// Deleting a project (hub/projectdelete.ts): GET .../delete-plan lists what would go, DELETE {archive?: false} does it.
		const projectDelete = /^\/api\/projects\/([^/]+)(\/delete-plan)?$/.exec(url.pathname);
		if (projectDelete && ((projectDelete[2] && req.method === "GET") || (!projectDelete[2] && req.method === "DELETE"))) {
			const key = decodeURIComponent(projectDelete[1]!);
			try {
				if (projectDelete[2]) return json(planDelete(key));
				return json(await deleteProject(key, { archive: (await body(req)).archive !== false }));
			} catch (error) {
				return json({ error: (error as Error).message }, error instanceof ProjectDeleteError ? error.status : 400);
			}
		}
		if (url.pathname === "/api/todo" && req.method === "GET") {
			const target = url.searchParams.get("target") ?? "main";
			if (target !== "main" && !target.startsWith("lane:") && !isProjectTarget(target)) return json({ error: "target must be main, lane:<name> or ch:<id>" }, 400);
			const lane = target.startsWith("lane:") ? lanes.get(target.slice(5)) : undefined;
			if (target.startsWith("lane:") && !lane) return json({ error: `no lane ${target.slice(5)}` }, 404);
			return json(readTodo(lane ? lane.sessionFile : orch.sessionFile));
		}
		// API keys for fallback entries (hub/apikey-store.ts): GET shows masks only; PUT {provider, key} or {from: "omo"}; DELETE /api/apikeys/<provider>.
		if (parts[0] === "api" && parts[1] === "apikeys") {
			try {
				if (req.method === "GET" && parts.length === 2) return json(keysView());
				if (req.method === "PUT" && parts.length === 2) {
					const b = await body(req);
					return json(b.from === "omo" ? await importOmoKey() : await saveKey(String(b.provider ?? ""), String(b.key ?? "")));
				}
				if (req.method === "DELETE" && parts.length === 3) return json(deleteKey(parts[2]));
				return json({ error: "not found" }, 404);
			} catch (error) {
				return json({ error: (error as Error).message }, error instanceof ControlError ? error.status : 400);
			}
		}
		if (url.pathname === "/api/health") return json({ ok: true });
		if (req.method === "POST" && url.pathname === "/api/chart") return chartRoute(req);
		if (url.pathname === "/api/peers" && (req.method === "GET" || req.method === "DELETE")) return req.method === "GET" ? json([...(await listPeers()), ...(await relayRows())]) : forgetRoute(url);
		// Send lease of another gateway (hub/send-lease.ts): claim, release or record a sent id before an app message goes out.
		if (req.method === "POST" && url.pathname === "/api/peer/lease") return json(handleLease((await body(req)) as LeaseReq, Date.now()));
		// This computer's name for the settings screen: the one in use, the one the owner set (empty = none), and the hostname default.
		if (url.pathname === "/api/machine" && req.method === "GET") return json({ name: resolveName(cfg.web?.machine_name, machineHost()), custom: cleanName(cfg.web?.machine_name), default: friendlyName(machineHost()) });
		if (url.pathname === "/api/machine" && req.method === "PUT") {
			const name = cleanName((await body(req)).name);
			setMachineName(name);
			return json({ name: resolveName(name, machineHost()), custom: name, default: friendlyName(machineHost()) });
		}
		if (req.method === "GET" && url.pathname === "/api/workers") return json({ items: bgWork.list() });
		// 중단 (the worker's process ends; a lane's worker too) and 다시 맡기기 (its request goes to the orchestrator again, in its own conversation).
		const workerAct = req.method === "POST" ? /^\/api\/workers\/([\w.-]{1,80})\/(cancel|retry)$/.exec(url.pathname) : null;
		if (workerAct) {
			const id = workerAct[1]!;
			if (workerAct[2] === "cancel") {
				let r = await bgWork.cancel(id);
				for (const lane of lanes.values()) if (!r.ok && r.status === 404) r = await cancelOmoWorker(id, lane.sessionFile);
				if (r.ok) workRows.stopped(id);
				return r.ok ? json({ ok: true, item: bgWork.list().find(w => w.id === id) }) : json({ error: r.error }, r.status);
			}
			const w = bgWork.list().find(x => x.id === id);
			if (!w) return json({ error: "이 작업을 찾을 수 없어요" }, 404);
			if (w.status !== "failed") return json({ error: w.status === "running" ? "아직 하고 있는 작업이에요" : "이미 끝난 작업이에요" }, 409);
			const to = workConversation(w.target, thread => mailByThread(thread)?.key);
			const mail = to.startsWith("mail:") ? mailByKey(to.slice(5)) : undefined;
			try {
				const project = to.startsWith("ch:") ? projectTarget(to, discord.channels.work) : undefined;
				await sendWeb({ mail, project, settings: to.startsWith("settings:") ? to.slice(9) : undefined, channel: "web", text: retryText(w, w.reply_to ? ownerMessage(w.reply_to)?.text : undefined), mode: "default", login: req.headers.get("tailscale-user-login") ?? "local" });
			} catch (error) {
				return json({ error: (error as Error).message }, 409);
			}
			return json({ ok: true, to });
		}
		if (req.method === "POST" && url.pathname === "/api/gateway/restart") return json({ ok: true, output: restartGateway() });
		if (url.pathname === "/api/state")
			return json({ name: NAME, address: ADDRESS, upload_max: UPLOAD_MAX_BYTES, discord: discord.status, channels: discord.channels, orchestrator: { ...orch, lastText: orch.lastText.slice(0, 600), key_fallback: keyedSelector(orch.activeModel) }, terminals: Object.fromEntries(terminals), lanes: withHomes(laneSummary(), discord.channels), runs: stateRuns(), capacity: laneCapacity(), schedules: listSchedules(), auth: pendingAuth(), events: recentEvents(Number(url.searchParams.get("limit") ?? 100)).map(shownEvent), notices_unread: unreadCount(), work: bgWork.list(), convs: stateConvs(), waitlist: stateWaitlist(), work_now: Date.now(), web_build: webBuild(), desk: desk.summary() });
		if (req.method === "GET" && url.pathname === "/api/notices") syncCardFiles();
		if (req.method === "GET" && url.pathname === "/api/notices") return json({ ...listNotices(Number(url.searchParams.get("limit") ?? 100), true), gone: dismissedAlertAts() });
		if (req.method === "GET" && url.pathname === "/api/monitors") return json({ items: listMonitors() });
		// Run one watch now (the web's 지금 확인 / 지금 다시 확인): the same runner the timer uses, awaited so the answer carries the new result.
		const watchRun = req.method === "POST" ? /^\/api\/watches\/([a-z0-9-]{1,40})\/run$/.exec(url.pathname) : null;
		if (watchRun) {
			const name = watchRun[1]!;
			const w = allWatches().find(x => x.name === name || x.id === name);
			if (!w) return json({ error: `no watch ${name}` }, 404);
			// A disconnected watch behind an approval gate (a login that sends a push to the owner's phone) reconnects only with his yes; the tap
			// on 다시 연결 is that yes, so it is approved (approveWatch runs it) instead of a plain run that would only report it still waits.
			if (w.approval_minutes && watchConnection(w).state === "disconnected") {
				approveWatch(w.id);
				const item = listMonitors().find(m => m.kind === "watch" && m.watch === name);
				return json({ ok: true, approved: true, ...(item ? { item } : {}) });
			}
			await runWatch(name);
			const item = listMonitors().find(m => m.kind === "watch" && m.watch === name);
			return json({ ok: true, ...(item ? { item } : {}) });
		}
		const sentMailRefs = () => sentReplyRefs(listDrafts());
		const unrepliedMailList = () => unrepliedMails(sentMailRefs());
		const appsResponse = await routeApps(req, url, unrepliedMailList);
		if (appsResponse) return appsResponse;
		const noticesResponse = await routeNotices(req, url);
		if (noticesResponse) return noticesResponse;
		// The waiting send-approval cards of a conversation, their batch answer and the owner's own edit of a draft (hub/approval-wire.ts).
		if (url.pathname === "/api/approvals" || url.pathname === "/api/approvals/failed" || /^\/api\/drafts\/[^/]+\/body$/.test(url.pathname)) {
			const login = req.headers.get("tailscale-user-login") ?? "local";
			const res = await approvalRoute(req, url, { login, triageMin: cfg.web.triage_min ?? TRIAGE_MIN_DEFAULT, deliver: (to, text, picks, decision) => deliverAnswer({ to, text, picks, notice: decision ?? "", login }) });
			if (res) return res;
		}
		// A button of a decision notice: the answer goes where the question came from (chat, session, project chat or login request).
		const decide = req.method === "POST" ? /^\/api\/notices\/([^/]+)\/answer$/.exec(url.pathname) : null;
		if (decide) {
			const login = req.headers.get("tailscale-user-login") ?? "local";
			const answer = await body(req);
			const via = viaOf(answer.via);
			let files: ReturnType<typeof ownerFiles>;
			try {
				files = ownerFiles(answer.files);
			} catch (error) {
				return json({ error: (error as Error).message }, error instanceof FileError ? error.status : 400);
			}
			// 보내기 on a draft the gateway sends itself takes its path (hub/approval-wire.ts webAnswer); every other answer goes to the bot.
			const r = await webAnswer(decodeURIComponent(decide[1]!), { ...answer, files }, login, a => deliverAnswer({ ...a, login, via }));
			// 보내지 않기 on a mail reply draft drops it in the reply-drafts store at once (not only when the bot gets to it), so every count and
			// list, here and on the other computer, sees it gone.
			if (r.status === 200 && !r.body.already) await dropAnsweredMailDraft(r.body.item as Notice | undefined, Number(answer.n), log);
			return json(r.body, r.status);
		}
		if (req.method === "POST" && url.pathname === "/api/read") {
			const r = markRead(await body(req));
			// Reading a conversation reads its unread answer up to there (and a mail's new-mail notice), whether or not the position moved; every other
			// notice is read by the owner's tap, ✕ or read-all (/api/notices/read).
			if (r.ok) readConversationNotices(r.target, r.ts, "viewed");
			// A mail he opened here is read in its mailbox too, where that is one cheap call (hub/mail.ts mailOpened).
			if (r.ok && r.moved) mailOpened(r.target);
			return json(r, r.ok ? 200 : 400);
		}
		if (req.method === "GET" && url.pathname === "/api/conversations") {
			settleMailDrafts(listDrafts());   // a dropped draft takes its 초안 있음 off before the rows are drawn
			const owed = new Set(unrepliedMailList().map(m => m.key)), sent = sentMailRefs();
			// Ended sessions are listed too: 답변 필요 stays on their row (their unread is 0, conversations.ts unreadOf) in the folded 끝난 세션 group (web/js/04-state.js endedGroup).
			// A mail conversation is listed only while its mail is: a deleted mail (mail-deleted.json) keeps its log but leaves every list and count here and on the other computer (hub/peer-monitor.ts).
			const lv = liveLanes();   // the page is decided from the cheap fields of a mail; its full card is built only for the rows that go out (conversationPage `build`)
			const items = conversationList([...[...lv.live, ...lv.ended].map(n => `lane:${n}`), ...Object.keys(discord.channels.work).map(id => `ch:${id}`), ...mailTargets(), ...openTasks().map(t => `task:${t.id}`)]).flatMap(c => {
				if (!c.target.startsWith("mail:")) return [withTask(c)];
				const m = mailByKey(c.target.slice(5));
				return m ? [{ ...c, mail: { ...mailStateOf(m, sent.has(m.key)), read: c.unread === 0, ...(m.archived ? { archived: true as const } : {}), source: m.source, ...(owed.has(m.key) ? { unreplied: true as const } : {}) } }] : [];
			});
			const page = conversationPage(items, url.searchParams, lazyMailCard({ owed, sent, dataDir: DATA_DIR, syncDeps: mailSyncDeps })); return json(page.body, page.status);
		}
		// One attached file of a mail: only files the mail's own record names, only inside the mail files folder (hub/mail.ts).
		const mailFile = (req.method === "GET" || req.method === "HEAD") && /^\/api\/mail\/([a-z0-9._-]+)\/files\/(\d+)$/.exec(url.pathname);
		if (mailFile) return mailFileRoute(req, url, mailFile[1]!, mailFile[2]!);
		// One file a draft sends along (the `> 첨부:` lines of a send approval): only files staged for that draft (hub/draft-files.ts).
		const draftFile = (req.method === "GET" || req.method === "HEAD") && /^\/api\/drafts\/([A-Za-z0-9._-]+)\/files\/(\d+)$/.exec(url.pathname);
		if (draftFile) return draftFileRoute(req, url, draftFile[1]!, draftFile[2]!, undefined, askedFile);
		// Add or remove a file of a mail reply draft, and the 첨부 파일 폴더 listing (hub/draft-attach.ts).
		const draftAttach = /^\/api\/drafts\/([A-Za-z0-9._-]+)\/(files|library|original)$/.exec(url.pathname);
		if (draftAttach) return draftAttachRoute(req, url, draftAttach[1]!, draftAttach[2]!);
		// 답장 | 전체 답장 and the 받는 사람·참조 of a waiting mail draft (hub/draft-recipients.ts).
		const draftRecipients = /^\/api\/drafts\/([A-Za-z0-9._-]+)\/recipients$/.exec(url.pathname);
		if (draftRecipients) return draftRecipientsRoute(req, draftRecipients[1]!);
		// 답장 안 함 (no-reply = skipped, fyi; one label to the owner) on a mail (POST) or 답장 필요로 표시 (DELETE): the owner's mark that this mail needs no reply (hub/mail-state.ts).
		// Its reply draft waiting for approval is held in the drafts store (not dropped) and its card leaves 확인 대기 before the answer; taking the
		// mark back restores the newest held draft and reopens its card. A peer's 되돌리기 arrives here too (hub/peer-monitor.ts act fyi / no-reply).
		const mailNoReply = (req.method === "POST" || req.method === "DELETE") && /^\/api\/mail\/([a-z0-9._-]+)\/(no-reply|fyi)$/.exec(url.pathname);
		if (mailNoReply) {
			const key = mailNoReply[1]!;
			if (!(mailNoReply[2] === "fyi" ? setMailFyi : setMailNoReply)(key, req.method === "POST")) return json({ error: "이 메일을 찾지 못했어요" }, 404);
			if (req.method === "POST") {
				holdDrafts(key);
				await settleHandledDrafts().catch(e => log(`mail ${key}: handled-draft settle failed: ${(e as Error).message}`));
			} else {
				const back = restoreDrafts(key);
				if (back) reopenDraftNotices([back]);
			}
			broadcast({ kind: "mail_unreplied", target: mailTarget(key) });
			return json({ ok: true });
		}
		// The same marks on many mails, {keys, on}: one write of each store and one broadcast (open pages only reload on it, the target is not read), however many mails.
		if (req.method === "POST" && url.pathname === "/api/mail/fyi") {
			const b = await body(req).catch(error => { if (error instanceof BodyError) throw error; return {}; }) as { keys?: unknown; on?: unknown };
			if (typeof b.on !== "boolean") return json({ error: "on must be true or false" }, 400);
			if (!Array.isArray(b.keys) || !b.keys.length || b.keys.length > mailKeep() || b.keys.some(k => typeof k !== "string" || !/^[a-z0-9._-]+$/.test(k))) return json({ error: "keys must be an array of mail keys" }, 400);
			const keys = [...new Set(b.keys as string[])], found = new Set(setMailsFyi(keys, b.on));
			if (b.on) {
				holdDraftsOf(found);
				await settleHandledDrafts().catch(e => log(`mail batch: handled-draft settle failed: ${(e as Error).message}`));
			} else reopenDraftNotices(restoreDraftsOf(found));
			if (found.size) broadcast({ kind: "mail_unreplied", target: mailTarget(found.values().next().value!) });
			return json({ ok: true, results: keys.map(key => ({ key, ok: found.has(key) })) });
		}
		if (req.method === "POST" && url.pathname === "/api/mail/delete-original") return originalDeleteRoute(req, peer, await body(req), mailOriginal);   // the owner's 삭제 with the switch on
		// 읽음 / 안 읽음 / 보관 / 별표 on a mail: dotz changes at once and the real mailbox follows; 휴지통 stays in dotz (hub/mail-sync.ts has the contract).
		if (req.method === "POST" && url.pathname === "/api/mail/actions") {
			const b = await body(req).catch(error => { if (error instanceof BodyError) throw error; return {}; }) as { keys?: unknown; action?: unknown };
			if (!isMailAction(b.action)) return json({ error: "action must be read, unread, archive, unarchive, trash, star or unstar" }, 400);
			if (!Array.isArray(b.keys) || b.keys.some(k => typeof k !== "string")) return json({ error: "keys must be an array of mail keys" }, 400);
			return json({ ok: true, results: await mailActions((b.keys as string[]).slice(0, 200), b.action, mailSyncDeps) });
		}
		const mailActOne = req.method === "POST" && /^\/api\/mail\/([a-z0-9._-]+)\/action$/.exec(url.pathname);
		if (mailActOne) {
			const b = await body(req).catch(error => { if (error instanceof BodyError) throw error; return {}; }) as { action?: unknown };
			if (!isMailAction(b.action)) return json({ error: "action must be read, unread, archive, unarchive, trash, star or unstar" }, 400);
			const res = await mailAction(mailActOne[1]!, b.action, mailSyncDeps);
			return res.ok ? json(res) : json({ error: res.note }, 404);
		}
		// 삭제 on a mail card: the mail leaves dotz (record, list entry, counts, its notices and pending drafts); the real mailbox is not touched.
		const mailDelete = req.method === "DELETE" && /^\/api\/mail\/([a-z0-9._-]+)$/.exec(url.pathname);
		if (mailDelete) {
			if (!(await removeMailLocal(mailDelete[1]!))) return json({ error: "이 메일을 찾지 못했어요" }, 404);
			return json({ ok: true });
		}
		// 초안 작성 on a mail: the owner asks for a reply draft himself. It is made behind the request (a model call takes a while, and a peer's
		// forwarded act has a short timeout); the draft lands as the send-approval card in the mail's conversation, a failure as a line there.
		const mailDraft = req.method === "POST" && /^\/api\/mail\/([a-z0-9._-]+)\/draft$/.exec(url.pathname);
		if (mailDraft) {
			const key = mailDraft[1]!, r = mailByKey(key), deps = mailDeps?.();
			if (!r || r.dir === "out") return json({ error: "이 메일을 찾지 못했어요" }, 404);
			if (!deps?.requestDraft) return json({ error: "이 설치에는 답장 초안 기능이 없어요" }, 503);
			const target = mailTarget(key);
			// What the owner typed in the 초안 작성 box (empty: the draft is made on its own).
			const instruction = String((await body(req).catch(error => { if (error instanceof BodyError) throw error; return {}; }) as { instruction?: unknown }).instruction ?? "").trim().slice(0, 500);
			void deps.requestDraft({ ...(r.account ? { account: r.account } : {}), key, ...(instruction ? { instruction } : {}), target, ...(r.thread ? { thread: r.thread } : {}), ...(r.msg ? { messageId: r.msg } : {}), source: r.source, id: r.id, subject: r.subject, from: r.from, ...(r.to ? { to: r.to } : {}), ...(r.cc ? { cc: r.cc } : {}), ...(r.summary ? { summary: r.summary } : {}), ...(r.attachments?.some(a => !a.inline) ? { attachments: r.attachments.filter(a => !a.inline).map(a => ({ name: a.name, size: a.size })) } : {}), ...(r.replyFiles ? { replyFiles: r.replyFiles } : {}) })
				.then(res => { if (res !== "offered") return deps.send(target, "답장 초안을 만들지 못했어요. 잠시 뒤 다시 눌러 주세요"); })
				.catch(e => log(`mail ${key}: requested draft failed: ${(e as Error).message}`));
			return json({ ok: true, started: true }, 202);
		}
		const mailBody = req.method === "GET" && /^\/api\/mail\/([a-z0-9._-]+)\/body$/.exec(url.pathname);
		if (mailBody) return mailBodyRoute(mailBody[1]!);
		// A mail from an outside poster (a webmail watcher, a custom plugin): one conversation per mail (hub/mail.ts, docs/custom-plugins.md).
		// The reply and KakaoTalk CLIs report an approved send here; the gateway wakes the bot once when that app has a 이어서 할 일 rule (hub/followup.ts).
		if (req.method === "POST" && url.pathname === "/api/followup") {
			const input = parseFollowup(await body(req));
			// The approved reply went out: the mail is 답장함 (hub/mail-state.ts), whether or not the app has a 이어서 할 일 rule.
			if (input?.kind === "mail" && input.ids.mail && setMailReply(input.ids.mail, "sent")) {
				// What he sent is listed as a sent mail now, with its text and files, in the thread of the mail it answered.
				const d = input.ids.draft ? getDraft(input.ids.draft) : undefined;
				if (d) await recordSentByDotz({ id: d.id, source: d.source, to: d.to, cc: d.cc, subject: d.subject, body: d.body, files: stagedFiles(d.id) }, { answers: input.ids.mail }).catch(e => log(`mail ${input.ids.mail}: sent reply not listed: ${(e as Error).message}`));
				broadcast({ kind: "mail_unreplied", target: mailTarget(input.ids.mail) });
			}
			return input ? json({ ok: true, result: triggerFollowup(input) }) : json({ error: "app, kind (comment|mail|kakao), key required" }, 400);
		}
		if (req.method === "POST" && url.pathname === "/api/mail/compose") {
			if (!mailDeps) return json({ error: "mail is not wired in this process" }, 503);
			try {
				const b = await body(req) as Record<string, unknown>;
				// The owner wrote this himself in the mail app (메일 쓰기 / the reply box): a draft with his text and files, then its send-approval card.
				if (b.ref === undefined) return await draftFromApp(b, mailDeps());
				const made = composeMail(b, mailDeps());
				// The new mail went out: its row becomes the sent mail, with the text and the files it carried.
				const d = (b as { state?: unknown }).state === "sent" ? getDraft(String((b as { ref?: unknown }).ref)) : undefined;
				if (d) await recordSentByDotz({ id: d.id, source: d.source, to: d.to, cc: d.cc, subject: d.subject, body: d.body, files: stagedFiles(d.id) }, { compose: made.key });
				return json(made);
			} catch (error) {
				if (error instanceof BodyError) throw error;
				return json({ error: (error as Error).message }, error instanceof MailError ? error.status : 500);
			}
		}
		// Mails that still wait are checked against their real thread; the ones the owner answered elsewhere become 답장함 (idempotent, read-only in the mailbox). `skipped` counts mails of a source no plugin can read.
		if (req.method === "POST" && url.pathname === "/api/mail/reconcile") {
			if (!mailReconcile) return json({ error: "mail is not wired in this process" }, 503);
			const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 200));
			return json(await mailReconcile(limit).catch(error => ({ error: (error as Error).message })));
		}
		if (req.method === "POST" && url.pathname === "/api/mail/state") {
			const input = parseMailStates(await body(req));
			return input ? json({ ok: true, changed: await applyMailStates(input.source, input.items) }) : json({ error: "source and items [{id, read?, replied?}] required" }, 400);
		}
		if (req.method === "POST" && url.pathname === "/api/mail") {
			if (!mailDeps) return json({ error: "mail is not wired in this process" }, 503);
			if (readAppOff(DATA_DIR).has("mail")) return json({ error: "mail is off on this install" }, 409);
			try {
				return json(await postMail(await body(req), mailDeps()));
			} catch (error) {
				if (error instanceof BodyError) throw error;
				return json({ error: (error as Error).message }, error instanceof MailError ? error.status : 500);
			}
		}
		if (req.method === "POST" && url.pathname === "/api/mail/move" && mailDeps) return moveMailRoute(await body(req), mailDeps());
		if (url.pathname === "/api/events") return sseResponse(req.headers.get("last-event-id") ?? url.searchParams.get("last"));
		if (req.method === "GET" && url.pathname === "/api/history") {
			const target = url.searchParams.get("target") ?? "main";
			if (target !== "main" && target !== "alert" && target !== "worklog" && !target.startsWith("lane:") && !isProjectTarget(target) && !isMailTarget(target) && !isSettingsTarget(target) && !isTaskTarget(target)) return json({ error: "target must be main, alert, worklog, lane:<name>, ch:<id>, mail:<key>, settings:<app> or task:<id>" }, 400);
			const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 150) || 150, 500));
			const around = url.searchParams.get("around"), after = url.searchParams.get("after");
			// A quote's original outside what the page holds (web/js/39-reply.js rpJump), and the messages of the gap that leaves.
			if (around || after) {
				const page = historyPage(target, limit, around ? { around } : { after: after as string });
				return json({ target, ...page, events: workRows.stamp(page.events) });
			}
			const before = url.searchParams.get("before") ?? undefined, events: unknown[] = workRows.stamp(historyEvents(target, limit, before));
			// A sent mail has no conversation event of its own: its conversation opens on the mail itself (hub/mail.ts sentMailEvent).
			const sent = !before && isMailTarget(target) && !events.some(e => (e as { kind?: string }).kind === "mail") ? sentMailEvent(target.slice(5)) : undefined;
			return json({ target, events: sent ? [sent, ...events] : events });
		}
		if (req.method === "POST" && url.pathname === "/api/attach") {
			const b = await body(req);
			if (b.detach) terminals.delete(String(b.session));
			else terminals.set(String(b.session), { cwd: b.cwd, at: now() });
			return json({ ok: true });
		}
		if (req.method === "POST" && url.pathname === "/api/upload") {
			try {
				return json({ ok: true, files: await uploadsFrom(req) });
			} catch (error) {
				return json({ error: (error as Error).message }, error instanceof FileError ? error.status : 400);
			}
		}
		if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/api/file") {
			return fileRoute(req, url, fileRoots(), new Set([...sentFiles(), ...projectFiles()]));
		}
		if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/api/canvas") {
			return canvasRoute(req, url, fileRoots(), sentFiles());
		}
		// A file of a conversation of this computer, opened from the other one: an upload the owner attached (the chip in the sent bubble),
		// or a result file the bot posted or wrote ([file] lines, paths), under the same rules as this computer's own /api/file.
		if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/api/peer/file") {
			const [f] = messageFiles([{ path: url.searchParams.get("path") ?? "" }]);
			if (!f) return fileRoute(req, url, fileRoots(), sentFiles());
			const res = serveFile(f.path, req, url.searchParams.get("download") === "1");
			return req.method === "HEAD" ? new Response(null, { status: res.status, headers: res.headers }) : res;
		}
		if (req.method === "GET" && url.pathname === "/api/lanes/live") return json(liveLanes());
		if (url.pathname === "/api/target") {
			const fail = (error: unknown) => json({ error: (error as Error).message, ...(error instanceof ForceRequired ? { requires_force: true, context_tokens: error.contextTokens } : {}) }, error instanceof ControlError ? error.status : 400);
			try {
				if (req.method === "GET") return json(await targetView(url.searchParams.get("target") ?? "main"));
				if (req.method === "PUT") {
					const b = await body(req);
					return json(await changeTarget(String(b.target ?? "main"), { model: b.model ? String(b.model) : undefined, thinking: b.thinking ? String(b.thinking) : undefined, compact: b.compact === true, force: b.force === true, inherit: b.inherit === true, workerModel: b.worker_model ? String(b.worker_model) : undefined, byLane: b.by === "lane" }));
				}
			} catch (error) {
				return fail(error);
			}
		}
		if (req.method === "POST" && url.pathname === "/api/message") {
			const b = await body(req);
			// The web's id for one send (`cid`): the same id again is a retry, answered as the first was, stored once.
			const cid = typeof b.cid === "string" && b.cid ? b.cid.slice(0, 80) : "";
			if (cid && sentCids.has(cid)) return json(sentCids.get(cid));
			let files: ReturnType<typeof ownerFiles>;
			try {
				files = ownerFiles(b.files);
			} catch (error) {
				return json({ error: (error as Error).message }, error instanceof FileError ? error.status : 400);
			}
			const elements = ownerElements(b.elements);
			// What the owner named with @ (hub/mentions.ts), resolved against what runs now: one [지칭] line each in the turn.
			const refs = refLines(ownerRefs(b.refs), {
				task: id => [...bgWork.list(), ...convs.conversations().flatMap(c => c.bg.list())].find(w => w.id === id),
				lane: name => lanes.get(name),
				conv: key => { const c = convs.conversations().find(x => x.primary === key); return c && { name: c.meta.name, live: convs.live(c) }; },
			});
			if (!String(b.text ?? "").trim() && !files.length && !elements.length) return json({ error: "text required" }, 400);
			const text = String(b.text ?? "");
			const login = req.headers.get("tailscale-user-login") ?? "local";
			// mode: none (main takes it as the next message, a working lane is steered), "steer" (into the running turn
			// now), "interrupt" (abort the running turn, then send as a new prompt), "queue" (a working target gets it
			// when its turn ends, see queue.ts; an idle target gets it now).
			const mode = b.mode === "steer" || b.mode === "interrupt" || b.mode === "queue" ? b.mode : "default";
			const lane = b.lane ? String(b.lane) : undefined;
			const conv = b.conv === "alert" || b.conv === "worklog" ? b.conv : undefined;
			const channel = b.channel === "terminal" ? "terminal" : "web";
			// A reply to a message (swipe / reply button in the web): the quoted message reaches the model like a Discord reply (intake.ts parseReply).
			const reply = parseReply(b.reply, login);
			let project: { target: string; name: string } | undefined;
			const settings = typeof b.settings === "string" && (fieldsOf(b.settings).length || watchOfSubject(b.settings)) ? b.settings : undefined;
			if ([lane, b.project, b.mail, settings, b.task].filter(Boolean).length > 1) return json({ error: "lane, project, mail and task are exclusive" }, 400);
			if (b.task && !openTaskOf(String(b.task))) return json({ error: `no open task conversation ${String(b.task)}` }, 404);
			const mail = b.mail ? mailByKey(String(b.mail)) : undefined;
			if (b.mail && !mail) return json({ error: `no mail conversation ${String(b.mail)}` }, 404);
			if (b.project) {
				try {
					project = projectTarget(String(b.project), discord.channels.work);
				} catch (error) {
					return json({ error: (error as Error).message }, 404);
				}
			}
			// The queue sends to the main conversation when the turn ends; a project message goes in now (intake merges a burst).
			if (mode === "queue" && !project && !mail && !b.task && !conv && (lane ? lanes.has(lane) : !parseCommand(text) && !authHeld("web")) && (lane ? lanes.get(lane)?.status === "working" : orch.status === "working")) {
				const item = enqueue(lane ? `lane:${lane}` : "main", [reply ? replyLine(reply) : "", text, files.length ? attachmentLines(files) : "", elements.length ? pickedLines(elements) : "", ...refs].filter(Boolean).join("\n"), login);
				if (cid) rememberCid(cid, { ok: true, queued: item });
				return json({ ok: true, queued: item });
			}
			if (cid) rememberCid(cid, { ok: true });
			try {
				// A decision answer from the chat card: the asking message (its ts) and the chosen option per block (intake.ts decisionLines).
				const picks = Array.isArray(b.picks) ? b.picks.slice(0, 10).flatMap((p: any) => (p && Number.isFinite(Number(p.n)) ? [{ q: String(p.q ?? "").slice(0, 200), n: Number(p.n), label: String(p.label ?? "").slice(0, 120), ...(typeof p.note === "string" && p.note.trim() ? { note: p.note.replace(/\s+/g, " ").trim().slice(0, 500) } : {}) }] : [])) : [];
				await sendWeb({ lane, project, mail, settings, task: b.task ? String(b.task) : undefined, conv: lane || project || mail || settings || b.task ? undefined : conv, channel, text, mode: mode === "queue" ? "default" : mode, login, files, ...(elements.length ? { elements } : {}), ...(refs.length ? { refs } : {}), ...(typeof b.reply_to === "string" && b.reply_to ? { replyTo: b.reply_to.slice(0, 40) } : {}), ...(reply ? { reply } : {}), ...(picks.length ? { picks } : {}), via: viaOf(b.via) });
			} catch (error) {
				sentCids.delete(cid);
				return json({ error: (error as Error).message }, 409);
			}
			return json({ ok: true });
		}
		if (url.pathname === "/api/queue" && req.method === "GET") return json({ items: queueItems() });
		if (parts[0] === "api" && parts[1] === "queue" && parts.length >= 3) {
			const id = decodeURIComponent(parts[2]);
			if (req.method === "DELETE" && parts.length === 3) {
				const item = take(id);
				return item ? json({ text: item.text }) : json({ error: "not queued (already sent)" }, 404);
			}
			if (req.method === "POST" && parts[3] === "send" && parts.length === 4) {
				const item = take(id);
				if (!item) return json({ error: "not queued (already sent)" }, 404);
				try {
					await sendWeb({ lane: item.target.startsWith("lane:") ? item.target.slice(5) : undefined, channel: "web", text: item.text, mode: "steer", sendNow: true, login: item.author ?? "local" });
				} catch (error) {
					restore([item]);
					return json({ error: (error as Error).message }, 409);
				}
				return json({ ok: true });
			}
		}
		// A task worker on an API key reports what a request cost, so its entry's cap counts the workers too (extension keyProvider).
		if (req.method === "POST" && url.pathname === "/api/fallback-spend") {
			const b = await body(req);
			const tokens = Number(b.tokens);
			if (!keyFileOk(String(b.key_file ?? "")) || !(tokens > 0)) return json({ error: "key_file (an existing key file) and tokens are required" }, 400);
			spendOnKey(String(b.key_file), tokens, Number(b.usd) > 0 ? Number(b.usd) : undefined);
			return json({ ok: true });
		}
		// The conversations main oversees (hub/convsessions.ts) for the dotz_conv tool: which have a session of their own, what it is doing,
		// and the exchange a read asks for. A conversation session may write only into main; main may send into any conversation.
		if (req.method === "GET" && url.pathname === "/api/conv-sessions") {
			return json({
				capacity: maxLiveView(),
				items: convs.conversations().map(c => ({ key: c.key, name: c.meta.name || c.primary, primary: c.primary, live: convs.live(c), state: convs.stateOf(c.primary), status: c.o.orch.status, model: c.o.orch.activeModel, ctx: { tokens: c.o.orch.ctx.tokens }, lastOwnerAt: c.meta.lastOwnerAt })),
			});
		}
		{
			const m = /^\/api\/conv-sessions\/([^/]+)\/(history|send)$/.exec(url.pathname);
			const key = m ? decodeURIComponent(m[1]!) : "";
			if (m && m[2] === "history" && req.method === "GET") {
				const c = convs.get(key);
				if (!c) return json({ error: `no conversation session ${key}` }, 404);
				const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 20) || 20, 1), 40);
				return json({ key, primary: c.primary, events: historyEvents(c.primary, limit) });
			}
			if (m && m[2] === "send" && req.method === "POST") {
				const b = await body(req);
				const text = String(b.text ?? "").trim();
				const from = String(b.from ?? "").trim() || MAIN;
				if (!text) return json({ error: "text required" }, 400);
				const sender = convs.get(from);
				if (!sender) return json({ error: `unknown session ${from}` }, 400);
				// One round only: a turn a session was handed another session's work for must not hand it back or onward.
				const cur = sender.queue.current();
				if (cur && !cur.done && cur.text.startsWith(MAIN === from ? "[conversation " : "[main session] ")) return json({ error: "handed work: answer it here, do not pass it on" }, 409);
				const toMain = from !== MAIN;
				if (!toMain && !convs.get(key)) return json({ error: `no conversation session ${key}` }, 404);
				// Into main: its answer goes to the conversation that asked, where its own window shows it.
				if (toMain) {
					queue.deliver(`[conversation ${from}] ${text}`, { target: sender.primary, replyTo: cur?.replyTo });
					return json({ ok: true, to: MAIN, answers_in: sender.primary });
				}
				const c = convs.get(key)!;
				// Main's request goes in as that conversation's next turn with no reply_to: its answer is posted into the conversation.
				convs.deliverTo(key, `[main session] ${text}`, undefined);
				return json({ ok: true, to: key, answers_in: c.primary });
			}
		}
		if (req.method === "POST" && url.pathname === "/api/send") {
			const b = await body(req);
			const target = String(b.target ?? "chat");
			// A conversation's own session answers only there (hub/convsessions.ts): a post of it anywhere else, an early text, a progress note or a send with no reply_to alike, is refused, so another window's answer never lands in this one.
			const session = typeof b.session === "string" && b.session ? b.session : MAIN;
			if (session !== MAIN && convs.keyOf(target) !== session) return json({ delivered: false, reason: `this session answers only ${primaryTarget(session)}; hand other work to main with dotz_conv send main` }, 403);
			const sender = convs.get(session)?.queue ?? queue;
			const refused = session === MAIN && !b.update_key && repostRefusal(target, String(b.text ?? ""));
			if (refused) return json({ delivered: false, reason: refused });
			// `resolves` (text in the title / text of the open questions it settles, or "*" for all): this post says their matter is over.
			if (typeof b.resolves === "string" && b.resolves.trim()) resolveNotices(b.resolves.trim() === "*" ? { all: true } : { match: b.resolves });
			if (b.update_key) {
				try {
					return json(await progress(target, String(b.update_key), String(b.text ?? ""), b.reply_to));
				} catch (error) {
					return json({ delivered: false, reason: (error as Error).message }, 502);
				}
			}
			// Answer only when it is ready: an early text to the asking channel waits for the turn's final answer. Meanwhile the owner sees it at once on that conversation's progress line (owner 2026-10-28: 중간 말을 바로 보여 주기), which the answer replaces.
			if (sender.holdEarly(target, String(b.text ?? ""), b.reply_to ? String(b.reply_to) : undefined)) {
				void progress(target, "progress", String(b.text ?? ""), b.reply_to).catch(e => log(`early text not shown on the progress line: ${(e as Error).message}`));
				return json({ delivered: true, held: true, note: "held: it is shown on the progress line now and goes out together with your final answer for this request; do not send it again" });
			}
			const answers = sender.sent(target, String(b.text ?? ""), b.reply_to ? String(b.reply_to) : undefined);
			try {
				return json(await out(target, String(b.text ?? ""), b.reply_to ?? answers));
			} catch (error) {
				return json({ delivered: false, reason: (error as Error).message }, 502);
			}
		}
		// The routers of their own files, in this order: the first that answers wins.
		for (const sub of [() => commentsRoute(req, url, parts), () => igDmRoute(req, url, parts), () => kakaoRoute(req, url, parts), () => routeSettings(req, url, parts), () => routeLanes(req, url, parts), () => taskRoute(req, url)]) {
			const res = await sub();
			if (res) return res;
		}
		return new Response("not found", { status: 404 });
	};
	// A body that is not JSON is refused here, whichever route read it (hub/routes-util.ts body).
	const route = (req: Request, srv?: Server<unknown>): Promise<Response> => handle(req, srv).catch(error => { if (error instanceof BodyError) return json({ error: error.message }, 400); throw error; });
	const peers = createPeerMonitor({ name: () => resolveName(cfg.web?.machine_name, machineHost()), bot: () => NAME, local: route, localHeaders: { "x-dotz-token": HUB_TOKEN }, orchestrator: () => ({ status: orch.status, pauseKind: orch.pauseKind }), runs: () => Object.fromEntries(Object.entries(stateRuns()).filter(([k]) => k.startsWith("mail:"))) });
	activatePeerMonitor(peers);
	return route;
}
