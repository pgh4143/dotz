// Dotz hub entry: bun hub/main.ts. Owns Discord, lanes and the event bus; serves the web app + API on
// 127.0.0.1 only. Tailnet access goes through `tailscale serve`, which adds the Tailscale-User-Login header.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { cfg, DATA_DIR, HOME, HOST, log, NAME, now, paths, PORT, restartCapMs, takeRecoveries, TZ, writeAtomic } from "./config.ts";
import "./lock.ts"; // must stay right after config.ts: takes the single-instance lock before the other modules load
import "../firstrun/first-run-boot.ts"; // a seed install still in its web onboarding serves only that and never gets past this line (firstrun/first-run-boot.ts)
import { parseCommand, setGatewayRestart } from "./control.ts";
import * as discord from "./discord.ts";
import * as livestatus from "./livestatus.ts";
import { setAskAnswer } from "./askbuttons.ts";
import { discordGatewayAnswer, settleSends, webAnswer } from "./approval-wire.ts";
import { installFanout, makeCtx, register, setAskApplier, startAll } from "./messenger.ts";
import { setProjectSource, syncAllRooms } from "./messenger-rooms.ts";
import { discordAdapter } from "./messenger-discord.ts";
import { agentAdapter } from "./messenger-agent.ts";
import { jandiAdapter } from "./messenger-jandi.ts";
import { createSlackAdapter } from "./messenger-slack.ts";
import { createTelegramAdapter } from "./messenger-telegram.ts";
import { projectTarget } from "./projectchat.ts";
import { startPeerStreams } from "./peer-stream.ts";
import { notify as pushNotify, setWatchPushOff, startPush } from "./push.ts";
import { msg, textsToReport } from "./i18n.ts";
import { broadcast, emit, emitDelivery, onEmit, recentEvents, sentFiles, subscriberCount } from "./events.ts";
import { WORK_SWEEP_MS } from "./workrows.ts";
import { startDataCleanup, startLaneHygiene, startOrphanReaper, startWorktreeCleanup } from "./hygiene.ts";
import { startRecallIndexing } from "./recall-idle.ts";
import { startLaneIdleStop } from "./laneidle.ts";
import { startLaneResumeSweep, stopLaneResumeSweep } from "./laneresume.ts";
import { createSessionResume } from "./sessionresume.ts";
import { MAIN } from "./session-key.ts";
import { startMemoryGuard } from "./memguard.ts";
import { setTrashChannels } from "./lanetrash.ts";
import { laneSpot, rememberSpot } from "./lanestate.ts";
import { migratePostSettings, postSettings, setWebLane } from "./discord-post.ts";
import { resolveAllowed, UPLOAD_MAX_BYTES } from "./files.ts";
import { setDiskNotify } from "./diskguard.ts";
import { budgetProblem } from "./routes-lanes.ts";
import { approvesBudget, estimateOf, laneBusy, lanes, restoreLanes, sendToLane, setIdleHandler as setLaneIdleHandler, shutdownLanes, startLaneQueue } from "./lanes.ts";
import { setUsageSource, tick as accountTick } from "./account-rules.ts";
import { onSwitch as onAccountSwitch } from "./account-sticky.ts";
import { announceUsedChanges } from "./accounts-api.ts";
import { activeHarness, runtimeFor } from "./runtime/index.ts";
import { applyAccountChange as holdOrchestratorKeepalive, applyAccountPin, orch, orchBusy, steer as steerOrchestrator, setErrorHandler, setIdleHandler as setOrchIdleHandler, setRestartedHandler, start as startOrchestrator, stop as stopOrchestrator, turnFailed } from "./orchestrator.ts";
import { errorAsk, startResumeWatch, watchSession } from "./orch-error.ts";
import { interruptedLanes } from "./lanereconnect.ts";
import { queuedTargets } from "./queue.ts";
import { createRestartGate, markRestartPending, RESTART_NOTICE_MS, restartCapText } from "./restart.ts";
import { createWaitCheck } from "./waitcheck.ts";
import { ownerMessage } from "./events.ts";
import { forgetAccountUsage, onQuota, QUOTA_REFRESH_MS, refreshQuota, usageSnapshot } from "./providers.ts";
import { sealPlainSecrets } from "./secretbox.ts";
import { allNotices, backfillNotices, draftCardCounts, dropChannelNotices, refreshStoredDrafts, setAppLabelResolver, setDraftHandled, settleExpiredQuestions, settleHandledDrafts, setConvNameResolver, setLaneTitleResolver, setAppBlocker, setAppResolver, setOrchestratorAvailable, setWatchLabelResolver, setWatchSummarizer, tagStoredApps, updateAvailable, updateResolved } from "./notices.ts";
import { startReflection } from "./reflect.ts";
import { recipeBlock } from "./recipes.ts";
import { syncFeatureWatches } from "./features.ts";
import { scheduleTarget, startSchedules, stopSchedules } from "./schedule.ts";
import { syncRoutineSchedules } from "./custom.ts";
import { startHarnessUpdate } from "./update.ts";
import { startOmoEngineWatch } from "./runtime/omo-engine-watch.ts";
import { CARD_AUDIT_ID, type CardAudit, runMigrations } from "./migrations.ts";
import { applyAndSave, defaultExec, onUpdateResolved, startSelfUpdate, updateBoot, diskCommit } from "./selfupdate.ts";
import { createUpdateNow, setUpdateNow, updateNow } from "./update-now.ts";
import { pendingBackups } from "./carryover.ts";
import { clearChannel, endStanding, lapseStandings, nameWatches, setupChannel, wakeOnly, watchLabel, watchWakeEvent } from "./workchannels.ts";
import { watchLine } from "./watchtext.ts";
import { createWatchSummarizer } from "./watchsummary.ts";
import { clearTrackedTimers, runShutdown } from "./shutdown.ts";
import { addWatch, allWatches, approveWatch, isWatchIssue, setWatchGate, startWatches, stopWatches, type Watch, wakeTarget, watchChoice } from "./watch.ts";
import { watchOwner } from "./app-features.ts";
import { blockedByOff, newsMuted, watchOff } from "./app-off.ts";
import { loadPlugins, pluginClaim, pluginMailThread, pluginThread, startPlugins } from "./plugins.ts";
import { startTokenAudit } from "./token-audit.ts";
import { startZele, zeleAccounts, zeleRead } from "./zele.ts";
import { createReconciler } from "./mail-reconcile.ts";
import { createUnansweredWatch } from "./mail-unanswered.ts";
import { backfillMailSummaries, mailSummarizer } from "./mail-summary-live.ts";
import { placeMail } from "./routes-mailbox.ts";
import { mailByKey, mailDraftBrief, mailByThread, mailRecords, mailTarget, migrateStoredMails, postMail, sentReplyRefs, setMailReadOut, setMailReply, setMailSuggest, storedBodyText, type MailDeps } from "./mail.ts";
import { ownAddresses, ownAddressesFor, replyExpected } from "./mail-state.ts";
import { offerMailDraft, requestMailDraft } from "../features/reply-drafts/lib/offer.ts";
import { listDrafts } from "../features/reply-drafts/lib/store.ts";
import { readMailBody, zeleHistory } from "../features/reply-drafts/lib/senders.ts";
import { installSentMail, realRunner, refreshPairs } from "../features/reply-drafts/lib/tone.ts";
import { defaultCall } from "../features/reply-drafts/lib/flow.ts";
import { loadSettings } from "../features/reply-drafts/lib/settings.ts";
import { setFollowupWake } from "./followup.ts";
import { startHostSweep } from "./runtime/omo-hosts.ts";
import { telemetryOff } from "./runtime/omo.ts";
import { installDotzCommand } from "./dotz-command.ts";
import { compressResponse } from "./compress.ts";
import { sends, send, queue, deliver, deliverNow, lastOwner, receiptNote, laneFailed, out, alert, fileRoots, replayPending, replayOpen, installDelivery, clearLeftWebProgress, replies, bgWork, workRows, approvals, convOfTarget, setRefHandled, reconcileMailCards } from "./outbound.ts";
import { runningOmoWorkers } from "./bgwork.ts";
import { convs } from "./convsessions.ts";
import { primaryTarget } from "./session-key.ts";
import { timeoutMs as outlangTimeoutMs } from "./outlang.ts";
import { inboxText, bursts, intake, flush, answerCommand, QUEUE_SWEEP_MS, flushQueue, sendWeb } from "./intake.ts";
import { laneRelay, installLaneHandlers } from "./lanewire.ts";
import { mailAction } from "./mail-sync.ts";
import { recoverOriginalDeletes } from "./mail-delete.ts";
import { applyMailStates, deliverAnswer, mailOriginal, mailSyncDeps, makeRoute, startStallSweep, stateWaitlist, webAccess } from "./routes.ts";
import { waitlistSweep } from "./waitlist.ts";
import { appProxySocket } from "./app-proxy.ts";
import { desk, type DeskWsData } from "./remote-desktop.ts";
import type { ServerWebSocket } from "bun";
import { appEntries, appKeyOf, integrationContext, readAppsFile } from "./integrations.ts";
import { mailFeatureOn } from "./app-feature-flags.ts";
import { applyMemory, mailDiscordOn, setDiscordProbe, unansweredSettings } from "./app-settings.ts";
import { setAuthOpened, setFormLink } from "./auth.ts";
import { openedText } from "./auth-wait.ts";
import { webBase as getWebBase, webLink } from "./weblink.ts";
import { kakaoDraftFacts, startKakaoLive, stopKakaoLive } from "./kakao/gateway.ts";
import { commentDraftFacts } from "./comments/gateway.ts";
import { draftHandled } from "./draft-handled.ts";
import { syncCardFiles } from "./draft-attach.ts";
import { answerDrafts, draftHeads, listDrafts as listMailDrafts, setStatus as setDraftStatus } from "../features/reply-drafts/lib/store.ts";

// 앱 기억 (hub/app-settings.ts applyMemory): a bot answer that keeps an app's attach folder or follow-up rule is stored at once, in whatever
// conversation the owner said it; other setting changes stay a card the owner applies.
onEmit(e => {
	if (e.kind !== "out" || typeof e.text !== "string" || !e.text.includes("dotz-settings")) return;
	try {
		const r = applyMemory(DATA_DIR, e.text);
		if (r) log(`app memory: ${r.app} kept ${r.keys.join(", ")}`);
	} catch (err) {
		log(`app memory not kept: ${(err as Error).message}`);
	}
});

installDelivery();
// Progress lines left from turns that ran before this start (web and Discord): nothing reports or clears them any more.
clearLeftWebProgress();
// The orchestrator's retries gave up: one [ask] per episode (sent again after a Discord reconnect by the send ledger, pushed
// as an ask); after any restart its open prompts replay; once the model host answers again, one automatic resume.
setErrorHandler(e => alert(errorAsk(NAME, e)));
setRestartedHandler(replayOpen);
convs.everyInstance(c => watchSession(c, convs.ensure, log));
startResumeWatch({ interrupted: interruptedLanes, log });
setLaneTitleResolver(name => lanes.get(name)?.title);
setWatchLabelResolver(watchLabel);
setAppResolver(n => (n.kind === "watch" && n.watch ? watchOwner(appEntries(DATA_DIR), allWatches().find(w => w.name === n.watch) ?? { name: n.watch }) : undefined) ?? appKeyOf(n, integrationContext(DATA_DIR, cfg.zele?.enabled !== false && Bun.which("zele") ? ["zele"] : [])));
setWatchGate(name => {
	const w = allWatches().find(x => x.name === name);
	return watchOff(DATA_DIR, name, w?.session, w);
});
// An off app hides all its notices; a 새 소식 알림 switch that is off (an app instance's or a monitor's) keeps its news out of the bell and the phone.
const watchByName = (name: string) => allWatches().find(w => w.name === name);
setAppBlocker(n => blockedByOff(DATA_DIR, n) || newsMuted(DATA_DIR, n, name => watchByName(name)?.notify === false));
setWatchPushOff(name => watchByName(name)?.push === false);
const orchestratorAvailable = () => orch.status !== "stopped" && orch.status !== "rate-limited";
setOrchestratorAvailable(orchestratorAvailable);
setConvNameResolver(conv => (conv === "main" ? NAME : conv.startsWith("ch:") ? discord.channels.work[conv.slice(3)] ?? discord.channels.threads[conv.slice(3)]?.name : conv.startsWith("mail:") ? mailByKey(conv.slice(5))?.subject : conv.startsWith("settings:") ? appEntries(DATA_DIR).find(e => e.key === conv.slice(9))?.label : undefined));
// An empty bell on the first start with the store: fill it once from the persisted outbox / inbox (no-op when notices.json has items).
backfillNotices();
// A dotz_auth value written before it was stored encrypted is encrypted now (hub/secretbox.ts); a Keychain that refuses leaves it for the next start.
try {
	const sealed = sealPlainSecrets(join(DATA_DIR, "secrets"));
	if (sealed.length) log(`secrets: encrypted ${sealed.length} plain value file(s)`);
} catch (error) {
	log(`secrets: plain values not encrypted yet: ${String(error).slice(0, 200)}`);
}
tagStoredApps();
// A change to how cards show files reaches the cards already waiting: each is re-checked against its staged files once on start.
{
	const n = syncCardFiles();
	if (n) log(`notices: ${n} draft card(s) now show their staged files`);
}
// A file that was still downloading (iCloud) when its draft was made is retried in the background; the waiting card updates when it lands.
const cardFilesChanged = () => void syncCardFiles();
setAppLabelResolver(key => appEntries(DATA_DIR).find(e => e.key === key)?.label ?? key);
// One answer for the notices and the approval queue: is the item behind this send-approval ref (in this conversation) already handled?
const refHandled = (ref: string, conv: string) => draftHandled(ref, { mail: { drafts: draftHeads, record: mailByKey }, comment: commentDraftFacts, kakao: kakaoDraftFacts }, conv);
setDraftHandled((d, _n, ref) => refHandled(ref, d.to));
setRefHandled(refHandled);
// Mails that wait are checked against their real thread (zele or a plugin's mailThread, read-only): an answer sent from Gmail or another script makes the mail 답장함 and closes its cards
// and drafts. At most MAIL_RECONCILE_PER_RUN threads per 10 minutes on the sweep timer below; a larger pass at start.
const MAIL_RECONCILE_PER_RUN = 20, MAIL_RECONCILE_EVERY_MS = 10 * 60_000, MAIL_RECONCILE_AT_START = 100;
const mailReconciler = createReconciler({
	mails: mailRecords,
	draftRefs: () => new Set(draftHeads().filter(d => d.status === "pending" || d.status === "held").map(d => d.ref)),
	accounts: zeleAccounts,
	read: zeleRead,
	own: accounts => ownAddresses(accounts),
	pluginThread: pluginMailThread,
	ownOf: ownAddressesFor,
	markReplied: (key, at) => {
		const ok = setMailReply(key, "sent", at);
		if (ok) broadcast({ kind: "mail_unreplied", target: mailTarget(key) });
		return ok;
	},
	answerDrafts,
}, { perRun: MAIL_RECONCILE_PER_RUN, everyMs: MAIL_RECONCILE_EVERY_MS });
// 답 없는 메일 다시 묻기, in the same 10-minute beat: no model call until a sent mail is due, and nothing at all while the setting is off.
const unansweredWatch = createUnansweredWatch({
	settings: () => unansweredSettings(DATA_DIR),
	mails: mailRecords,
	body: storedBodyText,
	accounts: zeleAccounts,
	read: zeleRead,
	own: accounts => ownAddresses(accounts),
	openDraft: key => draftHeads().findLast(d => d.ref === key && (d.status === "pending" || d.status === "held"))?.id,
	closeDraft: id => setDraftStatus(id, "answered"),
	clearChip: key => void setMailSuggest(key, undefined),
	requestDraft: async m => (await mailDeps().requestDraft?.(m)) ?? "off",
	target: mailTarget,
	log,
}, { file: join(DATA_DIR, "mail-unanswered.json"), everyMs: MAIL_RECONCILE_EVERY_MS });
const reconcileLog = (r: { checked: number; replied: number; notChecked: number } | undefined) => void (r && (r.checked || r.notChecked) && log(`mail reconcile: ${r.checked} threads checked, ${r.replied} answered elsewhere, ${r.notChecked} not checked`));
const reconcileMails = (limit: number) => mailReconciler.run(limit).then(r => (reconcileLog(r), r));
const settleSweep = () => {
	settleSends();
	// Questions past their answer time close here, in the pass that already settles handled drafts: no timer of their own.
	const expired = settleExpiredQuestions();
	if (expired) log(`notices: ${expired} questions past their answer time closed`);
	return settleHandledDrafts().then(n => (n && log(`notices: ${n} send approvals closed, their drafts were handled elsewhere`), n), e => (log(`handled-draft sweep failed: ${(e as Error).message}`), 0));
};
// Settle first; then the queue drops held cards that are handled or duplicated, then shows the next one (releaseAll does both, and is a no-op the second time).
const startupSettled = settleSweep();
const HANDLED_SWEEP_MS = 30_000;
const watchUnanswered = () => void unansweredWatch.tick()?.catch(e => log(`mail unanswered failed: ${(e as Error).message}`));
setInterval(() => void mailReconciler.tick().then(reconcileLog).catch(e => log(`mail reconcile failed: ${(e as Error).message}`)).then(watchUnanswered).then(settleSweep).then(() => approvals.releaseAll()).catch(e => log(`approval queue sweep failed: ${(e as Error).message}`)), HANDLED_SWEEP_MS);
// Start: once, after the sweep above settled what it can (the migration of replies sent from outside dotz).
void startupSettled.then(() => reconcileMails(MAIL_RECONCILE_AT_START)).catch(e => log(`mail reconcile failed: ${(e as Error).message}`));
installLaneHandlers();

// Result files ([file] lines, discord.ts) go out only when GET /api/file would serve them (inside the roots, or named in a [file] line of a sent message); a file too big to attach goes
// out as that route's download link on the tailnet address (config web.public_url, else tailscale's name + HTTPS port).
discord.setFileResolver(p => resolveAllowed(p, fileRoots(), sentFiles()));
// How the web app is reached (hub/web-access.ts): web.access in config.json until the settings screen saves a choice, then web-access.json. "cloudflare" starts the
// Cloudflare Tunnel (hub/cloudflared.ts) and the device gate and sets the address; "local" and "tailscale" keep web.public_url or the tailnet lookup.
void webAccess.start();
setFormLink(() => getWebBase());
// The asking session's conversation (and the messenger rooms it fans out to) hears that a form is open, there because "취소" works
// there; Discord already has the button message when it went to that same conversation.
setAuthOpened((w, discordPosted) => {
	const same = convs.keyOf(w.target) === w.session;
	const to = same ? w.target : primaryTarget(w.session);
	const base = getWebBase();
	void out(to, openedText(w, base ? `${base}/` : undefined), undefined, { source: "gateway", ...(discordPosted && same ? { discord_route: false } : {}) }).catch(e => log(`auth open notice to ${to} failed: ${e}`));
});
discord.setFileLink(p => webLink(`/api/file?path=${encodeURIComponent(p)}&dl=1`));
// Apple's push service rejects a VAPID subject it cannot parse as a contact: the app's own https URL is one.
startPush({ subject: () => getWebBase() ?? "mailto:dotz@example.com" });
startPeerStreams();

discord.setLaneRecords({ read: laneSpot, remember: rememberSpot });
migratePostSettings(discord.status.enabled);
setWebLane(name => laneSpot(name)?.web === true);
setTrashChannels({ take: discord.takeLaneChannel, put: discord.putLaneChannel, remove: discord.deleteChannel });
discord.setLaneReleaseHandler((id, deleted) => void dropChannelNotices(`ch:${id}`, !deleted));
discord.setChannelGoneHandler(id => {
	dropChannelNotices(`ch:${id}`);
	if (clearChannel(id)) log(`work channel ${id} is gone; its logins and monitors were released`);
});

await loadPlugins(DATA_DIR, log);
const onOwner = (m: discord.Incoming) => {
	if (m.id) discord.ack(m.ackChannelId, m.id);
	const target = typeof m.channel === "string" ? m.channel : "lane" in m.channel ? `lane:${m.channel.lane}` : "work" in m.channel ? `ch:${m.channel.work}` : `th:${m.channel.thread}`;
	if (m.id) lastOwner.set(target, m.id);
	const event = { ts: now(), source: "discord", channel: target, message_id: m.id, author: m.author, text: m.content, attachments: m.attachments, reply: m.replyTo, ...(m.picks?.length ? { picks: m.picks } : {}) };
	if (parseCommand(m.content)) {
		emit("inbox", { ...event, kind: "message" });
		void answerCommand(target, m.content, m.id);
		return;
	}
	if (typeof m.channel === "object" && "thread" in m.channel) {
		const info = discord.threadInfo(m.channel.thread);
		const extra = pluginThread({ thread: m.channel.thread, text: m.content });
		const mail = mailByThread(m.channel.thread);
		const threadEvent = { ...event, channel: `th:${m.channel.thread}`, kind: "message", thread_name: m.channel.name, parent: info?.parentTarget, parent_name: extra?.parentName ?? info?.parentName, ...(mail ? { conv: mailTarget(mail.key) } : {}) };
		emit("inbox", threadEvent);
		intake(extra?.note ? { ...threadEvent, plugin_note: extra.note } : threadEvent, threadEvent.channel, m.id);
		return;
	}
	if (typeof m.channel === "object" && "work" in m.channel) {
		const workEvent = { ...event, kind: "message", channel_name: m.channel.name, ...(m.channel.first ? { first: true } : {}) };
		emit("inbox", workEvent);
		intake(workEvent, target, m.id);
		return;
	}
	if (typeof m.channel === "object") {
		const lane = m.channel.lane;
		const ref = m.id || undefined;
		emit("inbox", { ...event, kind: "lane_message", lane, mid: ref });
		const extra = [m.replyTo ? msg().replyingTo(m.replyTo.author, m.replyTo.content) : "", ...m.attachments.map(a => `[attachment] ${a.name} ${a.url}`)].filter(Boolean).join("\n");
		try {
			if (approvesBudget(lane, m.content)) sendToLane(lane, "/budget-ok");
			const busy = lanes.get(lane) ? laneBusy(lanes.get(lane)!) : false;
			const how = sendToLane(lane, [`[owner via Discord] ${m.content}`, extra].filter(Boolean).join("\n"), ref);
			emitDelivery(target, ref, how);
			livestatus.begin(target, `lane:${lane}`);
			// A busy lane answers when its current step allows; until then the owner sees at once that the message reached it,
			// in the lane's one progress message (no answer is sent before it is ready).
			const receipt = receiptNote(busy && how === "received" ? "steered" : how);
			if (receipt) void discord.progress(target, "progress", receipt).catch(e => log(`lane receipt note failed: ${e}`));
		} catch (error) {
			laneFailed(target, lane, ref, error, m.id);
		}
		return;
	}
	emit("inbox", { ...event, kind: "message" });
	intake({ ...event, kind: "message" }, target, m.id);
};
discord.setClaimHandler(pluginClaim);
discord.connect(onOwner);
void discord.clearLeftProgress().catch(e => log(`left progress messages not cleared: ${e}`));
// A click on a decision button (hub/askbuttons.ts) is the owner typing the answer in that channel: the same inbound path.
setAskAnswer((target, content, picks) => {
	// 보내기 on a draft the gateway sends itself: no model turn, the next card shows at once (hub/approval-wire.ts).
	if (discordGatewayAnswer(target, convOfTarget(target), content, picks)) return;
	const id = target.slice(target.indexOf(":") + 1);
	const channel = target.startsWith("lane:") ? { lane: id } : target.startsWith("ch:") ? { work: id, name: discord.channels.work[id] ?? id, first: false } : target.startsWith("th:") ? { thread: id, name: discord.channels.threads[id]?.name ?? id } : (target as "chat");
	onOwner({ id: "", channelId: "", ackChannelId: "", channel, author: "owner", content, attachments: [], picks });
});
// Other messengers (hub/messenger.ts): Discord is registered native, so the fan-out leaves its sends to hub/outbound.ts.
register(discordAdapter);
register(jandiAdapter);
// Registered unconditionally so their settings rows exist before a token is entered.
register(createSlackAdapter());
register(createTelegramAdapter());
register(agentAdapter);
setAskApplier((id, body, login) => webAnswer(id, body, login, a => deliverAnswer({ ...a, login })));
installFanout();
setProjectSource(() => Object.entries(discord.channels.work).map(([id, name]) => ({ target: `ch:${id}`, name })));
discord.setWorkChangeHandler(() => void syncAllRooms());
void syncAllRooms().then(() => startAll(
	makeCtx(async m => {
		const id = m.target.slice(m.target.indexOf(":") + 1);
		const thread = m.target.startsWith("th:") ? mailByThread(id) : undefined;
		const mail = m.target.startsWith("mail:") ? mailByKey(id) : thread;
		const conv = m.target === "alert" || m.target === "worklog" ? m.target : undefined;
		await sendWeb({ source: m.adapter, channel: "web", text: m.text, mode: "default", login: m.author, ...(m.target.startsWith("lane:") ? { lane: id } : {}), ...(m.target.startsWith("ch:") ? { project: projectTarget(m.target, discord.channels.work) } : {}), ...(mail ? { mail } : {}), ...(conv ? { conv } : {}), ...(m.replyTo ? { replyTo: m.replyTo } : {}), ...(m.files?.length ? { files: m.files } : {}), ...(m.quoted ? { quoted: true } : {}) });
	}, m => void pushNotify(m), alert),
)).catch(e => log(`messengers failed to start: ${e}`));

await discord.ensureChannels().catch(e => {
	discord.status.error = String(e);
	log(`ensureChannels failed: ${e}`);
});
void discord.syncProfile().catch(e => log(`syncProfile failed: ${e}`));

// Each mail is a conversation (hub/mail.ts): zele here and outside posters through POST /api/mail (hub/routes.ts) share these.
let mailChannelId: string | undefined;
setDiscordProbe(() => discord.status.enabled, () => postSettings().news);
const mailDeps = (): MailDeps => ({
	createThread: discord.createThread,
	send: (target, text) => discord.send(target, text),
	mailChannel: async () => {
		if (!discord.status.enabled) return undefined;
		if (mailChannelId && discord.channels.work[mailChannelId]) return mailChannelId;
		const mailName = msg().channelNames.mail;
		const found = Object.entries(discord.channels.work).find(([, n]) => n === mailName)?.[0];
		const id = found ?? (await discord.createWorkChannel(mailName)).id;
		if (!found) setupChannel({ channel: id, purpose: "메일 수신함: 메일마다 스레드 하나(웹에서는 대화 하나), 답장은 확인받은 뒤에만" }, mailName, "");
		return (mailChannelId = id);
	},
	discordOn: discord.status.enabled,
	summarize: (key, hint) => mailSummarizer.request(key, hint),
	placeMail: placeMail(DATA_DIR),
	// A Discord thread per mail only when the mail's app instance has 디스코드에도 올리기 on (hub/app-settings.ts); web only otherwise.
	threadOn: (_source, key) => mailDiscordOn(DATA_DIR, key),
	newMailOn: (_source, key) => mailFeatureOn(DATA_DIR, key, "new_mail"),
	emit: event => emit("inbox", event as Parameters<typeof emit>[1]),
	wake: (event, target) => deliver(inboxText(event), { target }),
	offerDraft: m =>
		void offerMailDraft(m, { brief: mailDraftBrief, stage: { changed: cardFilesChanged }, send: (target, text) => out(target, text), run: realRunner, history: zeleHistory, refreshPairs: () => refreshPairs(realRunner), readBody: (source, id, account) => readMailBody(source, id, realRunner, account), log, suggest: (key, s) => void setMailSuggest(key, s), analyze: defaultCall(loadSettings().model), sentTexts: () => installSentMail(realRunner), own: source => [...ownAddressesFor(source)] }).then(r => r === "failed" && log(`mail ${m.key}: reply draft not offered`)),
	requestDraft: m => requestMailDraft(m, { brief: mailDraftBrief, stage: { changed: cardFilesChanged }, send: (target, text) => out(target, text), run: realRunner, history: zeleHistory, refreshPairs: () => refreshPairs(realRunner), readBody: (source, id, account) => readMailBody(source, id, realRunner, account), log, suggest: (key, s) => void setMailSuggest(key, s), analyze: defaultCall(loadSettings().model), sentTexts: () => installSentMail(realRunner), own: source => [...ownAddressesFor(source)] }),
});

function classifyStoredMails(): void {
	const n = migrateStoredMails(sentReplyRefs(listDrafts()));
	if (n) log(`mail: ${n} stored mails classified`);
}
classifyStoredMails();
backfillMailSummaries();

// A mail he opened in dotz is read in its mailbox too (zele: `mail read-mark`, a plugin: its mailAction): hub/mail-sync.ts, mailbox side only.
setMailReadOut(r => void mailAction(r.key, "read", mailSyncDeps, { providerOnly: true }));
recoverOriginalDeletes(mailOriginal.pending, text => out("alert", text, undefined, { source: "gateway" }));

void startZele({
	alert,
	// Only a mail that needs his reply (hub/mail-state.ts replyExpected: his address in To, no notice, a request) wakes the orchestrator;
	// a copy (CC / BCC), list mail or a notice is listed in the mail app and nothing more.
	mail: async m => {
		const subject = m.subject.trim() || "(제목 없음)";
		const wake = replyExpected({ from: m.from, to: m.to, cc: m.cc, subject, text: m.snippet });
		await postMail({ source: "zele", id: m.id, messageId: m.message, ...(m.account ? { account: m.account } : {}), from: m.from, to: m.to, ...(m.cc ? { cc: m.cc } : {}), subject, summary: m.snippet, wake }, mailDeps()).catch(e => log(`zele: mail ${m.id} not posted: ${(e as Error).message}`));
	},
	// The owner's own mail: listed as 내가 보냄, never new; a thread he answered becomes 답장함 (hub/mail-state.ts).
	sent: async m => {
		await postMail({ source: "zele", id: m.id, ...(m.account ? { account: m.account } : {}), from: m.from, to: m.to, ...(m.cc ? { cc: m.cc } : {}), subject: m.subject.trim() || "(제목 없음)", summary: m.snippet, direction: "out" }, mailDeps()).catch(e => log(`zele: sent mail ${m.id} not recorded: ${(e as Error).message}`));
	},
	// Gmail's read / replied state of the listed threads, every poll: read there is read here, answered from anywhere is 답장함.
	states: items => void applyMailStates("zele", items),
	// His accounts are known now: stored mails written from them become 내가 보냄, and threads that already have his reply 답장함 (once; a rerun changes nothing).
	accounts: classifyStoredMails,
	brief: text => {
		const target = !discord.status.enabled ? "web" : discord.channels.brief ? "brief" : "chat";
		const event = { ts: now(), kind: "schedule", source: "zele", id: "zele", channel: target, text };
		emit("inbox", event);
		deliver(inboxText(event), { target });
	},
});

// First start of a fresh install: the bot speaks first (greeting) and offers the read-only onboarding, once.
const GREETED = join(DATA_DIR, ".greeted");
const restarted = existsSync(GREETED);
if (!restarted) {
	writeFileSync(GREETED, `${now()}\n`);
	const target = discord.status.enabled ? "chat" : "web";
	deliver(msg().firstStart(target), { target });
}

setOrchIdleHandler(() => {
	queue.settleTurn(turnFailed());
	queue.redeliverSteered();
	laneRelay.flush();
	flushQueue("main");
});
setLaneIdleHandler(name => flushQueue(`lane:${name}`));
// Safety net for what the idle hooks miss: items kept over a gateway restart, a lane that went idle without a turn end.
setInterval(() => queuedTargets().forEach(flushQueue), QUEUE_SWEEP_MS);

const isDeskSocket = (ws: ServerWebSocket<unknown>): ws is ServerWebSocket<DeskWsData> => (ws.data as { kind?: string } | undefined)?.kind === "desk";
const route = makeRoute({ busyNow, restartGateway, restartGatewayNow, mailDeps, mailReconcile: reconcileMails });
// Page, script, styles and JSON answers go out gzipped (hub/compress.ts); /api/file keeps its exact bytes and Content-Length.
const server = Bun.serve({
	hostname: HOST,
	port: PORT,
	idleTimeout: 0,
	// Bun's default of 128MB would cut a body under a higher web.upload_max_mb; uploadsFrom refuses by the limit itself.
	maxRequestBodySize: Math.max(128 * 1024 * 1024, UPLOAD_MAX_BYTES * 2 + 65536),
	// A user app's websocket (/apps/<id>/…, hub/app-proxy.ts) is bridged to the app's own server; every other upgrade is refused.
	// The remote desktop's viewers carry data.kind "desk" (hub/remote-desktop.ts); the rest are apps.
	websocket: {
		open: (ws: ServerWebSocket<any>) => (isDeskSocket(ws) ? desk.socket.open(ws) : appProxySocket.open(ws)),
		message: (ws: ServerWebSocket<any>, msg: string | Buffer) => (isDeskSocket(ws) ? desk.socket.message(ws, msg) : appProxySocket.message(ws, msg)),
		drain: (ws: ServerWebSocket<any>) => void (isDeskSocket(ws) && desk.socket.drain(ws)),
		close: (ws: ServerWebSocket<any>) => (isDeskSocket(ws) ? desk.socket.close(ws) : appProxySocket.close(ws)),
	},
	async fetch(req, srv) {
		const res = await route(req, srv);
		if (!res) return undefined as unknown as Response;
		return new URL(req.url).pathname === "/api/file" ? res : compressResponse(req, res);
	},
});

// The top update bar's tap (hub/update-now.ts): download and test, then the idle restart; new turns wait for it and go in right after.
setUpdateNow(createUpdateNow({
	dataDir: DATA_DIR,
	apply: () => applyAndSave(),
	restartIdle: () => restartGateway(),
	busy: () => busyNow(),
	deliver: deliverNow,
	delivered: (target, ref, steered) => emitDelivery(target, ref, steered ? "steered" : "received"),
	current: diskCommit,
	log,
}));
let replayed = 0;
if (process.env.DOTZ_NO_ORCHESTRATOR !== "1") {
	// OmO updated on disk under the running gateway: restart at the next idle point (hub/runtime/omo-engine-watch.ts, #26).
	if (activeHarness().ids.includes("omo")) startOmoEngineWatch(restartGateway);
	startOrchestrator();
	replayed = replayPending();
	// Messages held for an update go in after the open prompts, in arrival order.
	void updateNow()?.boot().catch(e => log(`held messages not delivered: ${e}`));
}
sends.resume();
// Cards from before a restart: a bot-written mail card gives way to the app draft of the same mail that waits under it (older installs), then a
// conversation with no open card shows its next held one (hub/approval-queue.ts). Both passes change nothing the second time.
const startupCards = startupSettled.then(async closed => {
	const replaced = await reconcileMailCards().catch(e => (log(`mail card reconcile failed: ${(e as Error).message}`), 0));
	if (replaced) log(`approval cards: ${replaced} bot mail card(s) replaced by their waiting draft`);
	try {
		await approvals.releaseAll();
	} catch (e) {
		log(`approval queue release failed: ${(e as Error).message}`);
	}
	return { closed, replaced };
});
const resumedLanes = restoreLanes();
discord.recordLaneChannels();
for (const name of resumedLanes) void send(`lane:${name}`, "게이트웨이가 재시작돼서 멈췄던 작업을 이어서 하고 있어요.").catch(e => log(`lane resume notice failed: ${e}`));
// A restart that picked work back up says so in worklog (a self-run system event, not a chat answer); a quiet one
// (nothing replayed, no lane resumed) stays in hub.log and the web restart banner, since back-to-back code restarts
// flooded worklog (owner 2026-10-20). Failures to start go to alert elsewhere.
if (restarted) {
	const at = new Date().toLocaleTimeString("ko-KR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
	if (replayed || resumedLanes.length) void out(discord.status.enabled ? "worklog" : "web", msg().gatewayRestart(replayed, resumedLanes), undefined, { source: "gateway", update_key: "gateway-restart", wk: "system" }).catch(e => log(`restart notice failed: ${e}`));
	else log(`restart at ${at}: nothing interrupted, worklog notice skipped`);
}
// After an update and restart: local changes the updater backed up (dotz-local/<stamp>) and text overrides that no longer fit this version
// each wake the orchestrator once (hub/carryover.ts, hub/texts.ts), so the bot ports them to the custom layer.
function wakeOnce(id: string, text: string) {
	const channel = discord.status.enabled ? "chat" : "web";
	const event = { ts: now(), kind: "schedule", source: "gateway", channel, id, text };
	emit("inbox", event);
	deliver(inboxText(event), { target: channel });
}
if (process.env.DOTZ_NO_ORCHESTRATOR !== "1") {
	const lines = textsToReport();
	if (lines.length) wakeOnce("texts-override", msg().textsReport(lines.join("\n")));
	void pendingBackups(defaultExec, join(import.meta.dir, ".."), join(DATA_DIR, "logs"), DATA_DIR)
		// several backups of one update are one wake (the Mac mini got two cards for the same edit, 2026-10-29)
		.then(list => list.length && wakeOnce("self-update-local", list.map(b => msg().carryOver(b.where, b.read, b.stat, b.files)).join("\n\n---\n\n")))
		.catch(e => log(`carry-over check failed: ${e}`));
}
// One Claude account for the orchestrator and its lanes (hub/account-sticky.ts, the owner's rules in hub/account-rules.ts).
// A switch needs no restart: every running OmO process (workers included) asks POST /api/accounts/check at the start of its
// next turn and pins the answer in its own environment. Checked each minute, so a limit or a rule's time window is followed
// without waiting for a turn.
onAccountSwitch(s => {
	forgetAccountUsage(s.to);
	void refreshQuota().catch(e => log(`usage refresh failed: ${(e as Error).message}`));
	if (runtimeFor("orchestrator").id === "omo") {
		holdOrchestratorKeepalive();
		log(`account switch ${s.from ?? "-"} -> ${s.to}: orchestrator ${applyAccountPin()}`);
	}
});
// The account requests really use changed (a limit, the OmO pin, a rule): one alert saying from which to which and why; the
// owner's own pick in the web stays quiet.
announceUsedChanges();
setUsageSource(usageSnapshot);
void accountTick().catch(e => log(`account check failed: ${(e as Error).message}`));
setInterval(() => void accountTick().catch(e => log(`account check failed: ${(e as Error).message}`)), 60_000);
// The usage the pages show (top bar, 사용량, 홈): read in the background while a page is connected and pushed when it changes.
onQuota(q => broadcast({ kind: "quota", quota: q }));
setInterval(() => void (subscriberCount() > 0 && refreshQuota().catch(e => log(`usage refresh failed: ${(e as Error).message}`))), QUOTA_REFRESH_MS);
startLaneHygiene();
startWorktreeCleanup();
startDataCleanup();
startRecallIndexing({ busy: busyNow });
startMemoryGuard((key, text) => {
	if (key === "orchestrator") return alert(`${NAME}: ${text}`);
	// A conversation session's notice goes into its own conversation.
	if (key.startsWith("conv:")) return void out(convs.get(key.slice(5))?.primary ?? "alert", text, undefined, { source: "gateway" }).catch(e => log(`memory guard notice to ${key} failed: ${e}`));
	void send(key, text).catch(e => log(`memory guard notice to ${key} failed: ${e}`));
});
startLaneIdleStop();
convs.startIdleSweep();
setDiskNotify(alert);
startLaneQueue();
startStallSweep((conversation, r) => {
	const text = msg().stallNudge(r.todos ?? 0, r.todos ? r.detail ?? "" : "");
	if (conversation === "main") deliver(text);
	else if (conversation.startsWith("lane:")) sendToLane(conversation.slice(5), text, undefined, true);
	else convs.deliverTo(convs.keyOf(conversation), text, { target: conversation });
});
startOrphanReaper();
startHostSweep();
startSchedules((s, group) => {
	const channel = scheduleTarget(s, discord.status.enabled ? "chat" : "web");
	// A check is the assistant's own: its turn is quiet (hub/prompts.ts quiet). Checks due together arrive as one numbered turn.
	if (s.kind === "check") {
		const all = group ?? [s];
		const text = all.length > 1 ? all.map((x, i) => `${i + 1}) [${x.id}] ${x.text}`).join("\n") : s.text;
		// source "gateway" like wakeOnce: no 예약 notice in the bell and no card in the chat, the turn is the assistant's own
		const event = { ts: now(), kind: "schedule", source: "gateway", channel, id: all.map(x => x.id).join(","), ids: all.map(x => x.id), quiet: true, text };
		emit("inbox", event);
		return void deliver(inboxText(event), { target: channel, quiet: true });
	}
	const event = { ts: now(), kind: "schedule", source: "schedule", channel, id: s.id, every: s.every_minutes, text: s.text };
	emit("inbox", event);
	deliver(inboxText(event), { target: channel });
});
syncRoutineSchedules();
startReflection(text => deliver(text), () => orch.sessionFile, text => out("alert", text, undefined, { source: "gateway" }), text => void steerOrchestrator(text), recipeBlock);
for (const l of telemetryOff()) log(l);
for (const l of installDotzCommand({ dir: DATA_DIR, pkg: join(import.meta.dir, ".."), bun: Bun.which("bun") ?? process.execPath, home: HOME, expose: DATA_DIR === join(HOME, ".dotz"), shell: process.env.SHELL })) log(l);
startHarnessUpdate(text => void out("worklog", text, undefined, { source: "gateway", wk: "update" }).catch(e => log(`harness update post failed: ${e}`)), restartGateway, alert);
startTokenAudit(alert);
// Settings → 업데이트: the daily check announces a new dotz version (push + a toast on open pages + one bell item); with self_update.auto_apply
// on it applies it instead (worklog on success, alert with a choice block otherwise) and restarts through the idle restart gate.
onUpdateResolved(updateResolved);
// 이어서 할 일 (hub/followup.ts): one orchestrator turn with the rule and the item ids after an approved reply was posted or sent.
setFollowupWake(text => {
	const channel = discord.status.enabled ? "chat" : "web";
	const event = { ts: now(), kind: "schedule", source: "followup", channel, id: "followup", text };
	emit("inbox", event);
	deliver(inboxText(event), { target: channel });
});
void startSelfUpdate(text => {
	updateAvailable(text);
	pushNotify({ kind: "update", title: `${NAME} 업데이트`, body: text, url: "/#settings", tag: "update" });
	broadcast({ ts: now(), kind: "update_available", source: "gateway", text });
}, undefined, {
	worklog: text => void out("worklog", text, undefined, { source: "gateway", wk: "update" }).catch(e => log(`self-update worklog post failed: ${e}`)),
	alert,
	restartIdle: restartGateway,
}).catch(e => log(`self-update start failed: ${e}`));
// An update applied before this start: marked healthy after a quiet settle (ends the rollback watchdog), or the watchdog's rollback told once.
updateBoot({ alert });
// One-time setup steps the new code needs (hub/migrations.ts) run here, once per install: no command is left for the owner's bot after an update.
// The card audit waits for the start's own card passes and counts their work; it adds nothing to the start, and with no orchestrator it stays for a later start.
const cards: CardAudit = {
	known: () => draftCardCounts().all + approvals.held().length,
	closeSent: async () => (await startupCards).closed + (await settleHandledDrafts()),
	refresh: async () => refreshStoredDrafts() + (await startupCards).replaced,
	open: () => draftCardCounts().open,
	turn: c => wakeOnce(CARD_AUDIT_ID, msg().cardAudit(c.closed, c.refreshed, c.open)),
};
// A state file that did not parse at load (hub/config.ts readJsonOrQuarantine) was set aside; tell the owner what the gateway started from.
for (const r of takeRecoveries()) void out(discord.status.enabled ? "worklog" : "web", msg().fileRecovered(basename(r.file), r.restored), undefined, { source: "gateway", wk: "system" }).catch(e => log(`recovery notice failed: ${e}`));
void runMigrations({ ...(process.env.DOTZ_NO_ORCHESTRATOR === "1" ? {} : { cards }), dataDir: DATA_DIR, ask: alert, notify: text => void out(discord.status.enabled ? "worklog" : "web", text, undefined, { source: "gateway", wk: "system" }).catch(e => log(`migration notice failed: ${e}`)) }).catch(e => log(`migrations failed: ${e}`));
setWatchSummarizer(createWatchSummarizer());
nameWatches();
// A monitor's own 디스코드에도 보내기 (hub/watch-settings.ts), or for an app's watch the app's (hub/app-settings.ts appDiscordField; a mail instance's
// switch is about its mail threads, not its watches), decides its report posts while Discord is connected; unset, the 새 소식 class switch does.
const watchRoute = (w: Watch) => {
	if (!discord.status.enabled) return {};
	const app = watchOwner(appEntries(DATA_DIR), w);
	const own = app ? (app.split("-")[0] === "mail" ? undefined : readAppsFile(DATA_DIR)[app]?.discord) : w.discord;
	return typeof own === "boolean" ? { discord_route: own } : {};
};
startWatches((w, reason, output, prev) => {
	if (w.to === "orchestrator") {
		const event = watchWakeEvent(w, reason, output, prev);
		const quiet = wakeOnly(w, reason, orchestratorAvailable());
		if (!quiet) emit("inbox", event);
		const wake = inboxText(quiet ? { ...event, wakeOnly: true } : event);
		const target = wakeTarget(w);
		if (!w.channels?.length) return deliver(wake, target ? { target } : undefined);
		const [first, ...others] = w.channels;
		endStanding(first, "once");
		if (!quiet) for (const c of others) void out(`ch:${c}`, watchLine(event.label, reason, output, { note: `(처리는 #${discord.channels.work[first] ?? first}에서)`, prev }).slice(0, 1900), undefined, { source: "gateway", news: true, ...watchRoute(w) }).catch(() => undefined);
		return deliver(wake, { target: target ?? `ch:${first}` });
	}
	// A failing, stopped or unapproved check is an issue: it goes to alert with a choice block, whatever `to` the watch has.
	const issue = isWatchIssue(reason);
	const label = watchLabel(w.name);
	void out(issue ? "alert" : w.to, watchLine(label, reason, output, { prev }).slice(0, issue ? 1500 : 1900) + (issue ? `\n${watchChoice(label, reason)}` : ""), undefined, { source: "gateway", news: true, ...(issue ? {} : watchRoute(w)) }).catch(e => log(`watch ${w.name} send failed: ${e}`));
});
setInterval(() => lapseStandings(s => void out(`ch:${s.channel}`, `이 채널의 자동 처리 기한이 끝났어요: ${s.standing}\n모니터링은 계속 돌아요. 앞으로 깨어나면 먼저 여쭤볼게요.`, undefined, { source: "gateway", news: true }).catch(e => log(`standing notice failed: ${e}`))), 60_000);
syncFeatureWatches();
startKakaoLive();
startPlugins({
	dataDir: DATA_DIR,
	log,
	postTo: discord.postTo,
	ack: discord.ack,
	ensureWatch: spec => {
		if (allWatches().find(w => w.name === spec.name)?.command !== String(spec.command ?? "").trim()) addWatch(spec, existsSync(paths.rules) ? readFileSync(paths.rules, "utf8") : "");
	},
	approveWatch: name => void approveWatch(name),
});
writeAtomic(paths.pid, String(process.pid));
log(`hub listening on 127.0.0.1:${server.port} as ${NAME} (discord ${discord.status.enabled ? "on" : discord.dryRunReason ? `off, dry run: ${discord.dryRunReason}; DOTZ_ALLOW_LIVE=1 connects` : "off"})`);
for (const sig of ["SIGTERM", "SIGINT"] as const)
	process.on(sig, () => {
		log(`hub ${sig}`);
		void shutdown();
	});

// Fixed order, one overall 10 s deadline (see shutdown.ts), longer by one output-language timeout while a reply is still in its
// rewrite. Messages still coalescing go into the ledger before exit, so the next start replays them; the orchestrator's session file is saved as it runs, stop() only keeps it from respawning.
function shutdown(): Promise<never> {
	return runShutdown([
		{ name: "block new input", run: () => (server.stop(), discord.stopIntake()) },
		{
			name: "save state",
			run: () => {
				for (const target of [...bursts.keys()]) flush(target);
				stopLaneResumeSweep();
				shutdownLanes();
				stopOrchestrator();
			},
		},
		// A reply still in its rewrite is waited for, then lands with the original text in the outbox or the unsent ledger.
		{ name: "remote desktop", run: () => desk.stop() },
		{ name: "pending replies", run: async () => void (await replies.flush(outlangTimeoutMs() + 1000)) },
		{ name: "discord connection", run: () => discord.disconnect() },
		{ name: "watch and schedule timers", run: () => (stopWatches(), stopSchedules(), stopKakaoLive(), clearTrackedTimers()) },
		{ name: "cloudflare tunnel", run: () => webAccess.stop() },
		{ name: "others", run: () => void 0 },
	], 10_000 + (replies.size() ? outlangTimeoutMs() + 2000 : 0));
}

// Restart the gateway the way the earlier secretary's herdr-restart does: wait until the orchestrator and every lane are idle, task
// workers included, then exit; launchd (KeepAlive) starts the new code. Called during an orchestrator turn, it waits for
// that turn to end, so the answer goes out first. restart.ts: a busy lane is never killed, requests are coalesced.
const DEFER_GRACE_MS = 5 * 60_000;
function busyNow(): string[] {
	// The orchestrator's background task workers die with its process. OmO sends no worker frames, so they are counted from its
	// task store (hub/bgwork.ts), for the orchestrator and every lane; a request deferred to one ([later]) also holds the restart.
	const running = bgWork.running();
	// With no worker running, a deferred request holds the restart only for the few minutes its worker needs to show up in the task store:
	// an older one whose answer went elsewhere held every restart for an hour (2026-10-26, updates received but never applied), and a
	// restart replays the open prompts anyway.
	const justDeferred = queue.deferredOpen().some(d => Date.now() - d.at <= DEFER_GRACE_MS);
	const workers = running ? `orchestrator background workers (${running})` : justDeferred ? "orchestrator background workers" : "";
	const laneWorkers = (l: { sessionFile?: string }) => runningOmoWorkers(l.sessionFile);
	// Each conversation session holds a restart the way main does: its turn or compaction, its workers, a request it just deferred.
	const sessions = convs.conversations().flatMap(c => {
		const n = c.bg.running();
		const deferred = c.queue.deferredOpen().some(d => Date.now() - d.at <= DEFER_GRACE_MS);
		return [orchBusy(c.o.orch) ? `conversation session ${c.key}` : "", n ? `conversation session ${c.key} background workers (${n})` : deferred ? `conversation session ${c.key} background workers` : ""];
	});
	return [
		orchBusy() ?? "",
		workers,
		...sessions,
		replies.size() ? "reply" : "",
		...[...lanes.values()].flatMap(l => {
			const n = laneWorkers(l);
			return laneBusy(l) ? [`lane ${l.name}${n ? ` (${n} background workers)` : ""}`] : n ? [`lane ${l.name} background workers (${n})`] : [];
		}),
	].filter(Boolean);
}
// An open owner request with nothing running that could answer it: one bounded wake, no model call otherwise (hub/waitcheck.ts).
const WAIT_CHECK_MS = 20_000;
const waitCheck = createWaitCheck({
	restarting: () => restartGate.waiting(),
	log,
	sessions: () => convs.all().map(c => ({
		key: c.key,
		open: c.queue.openRequests,
		drop: c.queue.dropOpen,
		busy: () => Boolean(orchBusy(c.o.orch)) || c.o.orch.status === "rate-limited",
		down: () => c.o.orch.error !== undefined && !c.o.orch.error.probed,
		workers: () => c.bg.running(),
		armed: since => allWatches().some(w => w.once && w.to === "orchestrator" && !w.paused && Date.parse(w.created) >= since),
		lastTurnEndAt: () => c.o.lastTurnEndAt(),
		wake: (open, last) => void convs.deliverTo(c.key, msg().openRequests(open.map(r => ({ ...r, asked: r.replyTo ? ownerMessage(r.replyTo)?.text : undefined })), last), { target: open[0]!.target, ...(open[0]!.replyTo ? { replyTo: open[0]!.replyTo } : {}) }),
	})),
});
setInterval(waitCheck.tick, WAIT_CHECK_MS);
// One sweep over the open background-work rows (hub/workrows.ts), for whoever watches: a load reconciles the rest.
for (const e of recentEvents(300)) workRows.seen(e);
onEmit(workRows.seen);
setInterval(() => void (subscriberCount() > 0 && workRows.sweep()), WORK_SWEEP_MS);
const sweepWaitlist = waitlistSweep(stateWaitlist, items => broadcast({ kind: "waitlist", items }));
setInterval(() => void (subscriberCount() > 0 && sweepWaitlist()), WORK_SWEEP_MS);
// A previous process's wait is over: this one starts work again.
markRestartPending(DATA_DIR, false);
const restartGate = createRestartGate({
	busy: busyNow,
	collecting: () => bursts.size > 0,
	startedAt: Date.now(),
	minGapMs: Number(process.env.DOTZ_RESTART_MIN_GAP_MS ?? 5 * 60_000),
	noticeAfterMs: RESTART_NOTICE_MS,
	notice: text => void out(discord.status.enabled ? "worklog" : "web", text, undefined, { source: "gateway", wk: "system" }).catch(e => log(`restart wait notice failed: ${e}`)),
	hold: () => markRestartPending(DATA_DIR, true),
	capAfterMs: restartCapMs(),
	cap: (busy, min) => alert(restartCapText(busy, min)),
	log,
	exit: () => {
		updateNow()?.restarting();
		void shutdown();
	},
});
// After the gate exists: the first pass runs now, and a resume waits out a restart in progress.
const sessionResume = createSessionResume({
	file: join(DATA_DIR, "session-resume.json"),
	log,
	sessions: () =>
		convs.resumeSessions(
			c => allNotices().some(n => n.kind === "decision" && n.decision?.state === "open" && (n.decision.to === c.primary || (c.key === MAIN && (n.decision.to === "main" || n.decision.to.startsWith("auth:"))))),
			(target, text) => void out(target, text, undefined, { source: "gateway" }).catch(e => log(`session resume notice to ${target} failed: ${e}`)),
		),
});
startLaneResumeSweep({ budget: name => budgetProblem(name, estimateOf(undefined, ""), false), restarting: () => restartGate.waiting(), sessions: sessionResume.tick });
function restartGateway(): string {
	return restartGate.request();
}
// The owner chose '지금 재시작' in settings → 업데이트: running turns are cut (unanswered prompts replay on the next start).
// The short delay lets the HTTP answer reach the page first.
function restartGatewayNow(): string {
	log(`gateway restart now (owner, settings → 업데이트; busy: ${busyNow().join(", ") || "none"})`);
	setTimeout(() => void shutdown(), 500);
	return "gateway restarting now";
}
setGatewayRestart(restartGateway);
