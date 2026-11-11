// English message catalog (see hub/i18n.ts). Moved out of i18n.ts unchanged; the types come from i18n.ts as type-only imports.
import { join } from "node:path";
import { IDENTITY_FILE, NAME, paths, tzLabel } from "./config.ts";
import { LESSONS_MAX_BYTES } from "./prompt-budget.ts";
import type { FileText, HelpText, LaneFooterArgs, RecallArgs, SettingText, WorktreeArgs } from "./i18n.ts";

const TOPIC_LABELS: Record<string, string> = { linebreak: "line breaks", copy: "copy and tone", "no-card": "questions without a card", duplicate: "duplicate features", stalled: "stalls and lost reports", misread: "misread instructions", "missing-output": "output not visible", ui: "screens and design", "ignored-setting": "ignored settings", "not-applied": "not applied or half verified", other: "other" };

// Prefixes (leads) of notes that are matched later; every note that has a lead starts with it.
export const enLeads = {
	youAre: "[dotz gateway] You are",
	replayLead: "[dotz gateway] The gateway restarted before you answered this",
	newMessageLead: "[dotz gateway] A new message arrived while you are working",
	handbackLead: "[dotz gateway] The session you handed work to answered:",
	laneReportLead: "[dotz gateway] A session report arrived while you are working",
	joinLead: "[dotz gateway] A background worker is already running for this conversation",
	otherConvLead: "[dotz gateway] A background worker of another conversation may report during this turn",
	waitedLead: "[dotz gateway] The owner has waited",
	rateLead: "[dotz gateway] The rate limit has passed",
	providerLead: "[dotz gateway] The provider problem (billing/auth) may have been fixed",
	transientLead: "[dotz gateway] The provider had a temporary error (overloaded or network) and your last turn failed",
	openLead: "[dotz gateway] Nothing is running, yet these owner requests are unanswered",
};
export type Leads = typeof enLeads;

// One sentence reused by every handover and, once after a compaction, by the next prompt: a fresh or compacted session
// loses what the old context held, so facts worth keeping are saved to memory before the work goes on.
const enRetainNudge = "Before continuing, save any durable owner, project or preference fact from the conversation so far that is not in memory yet with the memory tool if this runtime has one (omp: `retain`), else in the dotz data directory (owner facts in memory/owner.md, the owner's verbatim don'ts in memory/boundaries.md, rules in RULES.md, lessons in LESSONS.md, open work in state.json); skip this if there is none.";

// How a nightly or monitoring run reports an issue (hub/reflect.ts, hub/watch.ts wake turn): one line plus a choice block that the web's
// decision buttons and decision notices read (web/js/10-decision-card.js, hub/choices.ts).
// The output language of a lane, first in its footer and last in every turn: a Korean owner read English reports and
// progress notes from a lane whose brief was in English (2026-11-03); the line only covered tool-call intents.
const enLaneLanguage = (language: string) => `Write every report, progress note, todo item and tool-call intent in ${language}, whatever language the brief, the code or the tool output is in.`;

const enIssue = `report it with dotz_send alert: one line for the issue that starts with the [ask] marker (a message with a choice block gets buttons whatever its marker), then a choice block of 2-4 options in this shape:
Decision: <question>
**1) <name>**
<one-line consequence>
**2) <name>**
<one-line consequence>`;
export const NIGHT_LEAD = "Nightly review:";
export const SCHEDULE_CHECK_LEAD = "Scheduled check:";

export const en = {
	...enLeads,

	// A pinned account at its usage limit (hub/accounts-api.ts): the one-time question, the saved answers and the plain notices.
	accountLimit: {
		question: (account: string, at: string) => `The pinned account ${account} hit its usage limit, so work pauses until ${at}. It stays pinned, so requests do not move to another account.`,
		questionTitle: "What should I do?",
		switchChoice: "Switch to automatic",
		switchChoiceNote: "When a limit hits, it moves to another account and continues right away",
		waitChoice: "Keep waiting",
		waitChoiceNote: (at: string) => `It continues once the limit clears at ${at}`,
		wait: (account: string, at: string) => `Waiting while the limit lasts. The limit on ${account} clears at ${at}, and the work continues then.`,
		switched: (to: string) => `The limit was reached, so it moved to ${to} and continues on automatic.`,
		anotherAccount: "another account",
		waitAnswer: "I will keep waiting. Work continues as soon as the limit clears.",
	},

	// Owner-facing text of the slash-command cards (hub/control.ts runCommand); lane -> session, worker -> subagent.
	// A computer with no address of its own, reached through a messenger: the app's computer list, its chat and the messenger's settings screen.
	relay: {
		note: "Talks through JANDI",
		gone: "This computer is no longer on the list",
		label: "Computers reached through JANDI",
		hint: "Add another computer that uses the same self-chat room. It joins the computer list, and you talk to it in the normal chat screen. With its switch on, new replies reach your phone.",
		notify: "New reply alerts",
		add: "Add computer",
		name: "Name",
		nameHint: "How it shows in the list. Left empty, the keyword is used.",
		keyword: "Keyword",
		keywordHint: "The word that calls that computer, with no spaces.",
		prefix: "Reply prefix",
		prefixHint: "What that computer puts at the very start of its replies.",
		invalid: "Check the keyword and the reply prefix. Neither can match another computer's, and the list holds up to 8.",
	},

	// Messenger connect flows (hub/onboarding*.ts, hub/messenger-login.ts): owner-facing lines, plain and short.
	connect: {
		say: {
			waiting: (label: string, hint: string) => `${label}: ${hint}`,
			failed: (error: string, hint: string) => `Could not connect. ${error} ${hint}`.replace(/\s+/g, " ").trim(),
			done: "Connected.",
		},
		login: {
			unavailable: "Aside could not be opened, so the login window was not read. Start Aside and restart the connection.",
			gaveUp: "The login did not finish within 10 minutes, so this stopped. Restart the connection to begin again.",
			unreadable: "The login window could not be read. Restart the connection.",
		},
		jandi: {
			mainRoom: "Main",
			reuse: { title: "Check saved JANDI rooms", detail: "Rooms already connected with webhooks are used as they are.", label: "Check saved settings", hint: "Check the webhook values under Settings → JANDI, then press Continue." },
			notice: { title: "Notice", detail: "What this connection reads, before it starts.", label: "Read it and continue", hint: "This uses JANDI's web login, which JANDI does not document. It reads only your chat with yourself and never the chats you have with other members. If that is fine, press Continue." },
			login: { title: "JANDI login", detail: "If Aside is already logged in to JANDI, this goes on by itself.", label: "Log in to JANDI", hint: "Open the Aside app and log in on the JANDI tab. It goes on by itself once you are in." },
			team: { title: "Pick the team", detail: "Reads the JANDI teams of the logged-in account.", label: "Pick the team", hint: "Pick the team to connect." },
			room: { title: "Find the chat with yourself", detail: "Finds your chat with the JANDI bot and checks it is the right one.", label: "Restart the connection", hint: "Restart the connection. If it keeps failing, open your chat with yourself once in the JANDI app." },
			save: { title: "Save the connection", detail: "Saves the login and the room, then starts reading.", label: "Restart the connection", hint: "Restart the connection." },
			done: { title: "Connected", detail: "Your JANDI chat with yourself is connected.", label: "Check again", hint: "Restarting the connection checks the current state again." },
			noTeams: "No JANDI team was found for this account.",
			noRoom: "The chat with yourself was not found. Nothing was saved.",
			notMine: "The room found could not be confirmed as your chat with yourself. Nothing was saved.",
			denied: "JANDI did not accept the login. Log in again.",
			unreadable: "JANDI's answer could not be read. Nothing was saved.",
			noToken: "No JANDI login was found. Log in, then start again.",
		},
		expiry: {
			alert: "The JANDI login ended, so the chat with yourself cannot be read. Reconnect under Settings → Messengers → JANDI.",
			ok: { label: "Chat with yourself connected", hint: "Connected with your JANDI login." },
			lost: { label: "The JANDI login ended", hint: "The chat with yourself cannot be read. Reconnecting picks up right away." },
			off: { label: "JANDI chat with yourself", hint: "Log in to JANDI and you can talk to the gateway from your chat with yourself." },
			reconnect: "Reconnect",
			connect: "Connect with login",
		},
	},
	cmd: {
		failed: "That did not work",
		applyAnyway: "Apply anyway",
		forceNote: "This session is running, so changing its model or effort rewrites its prompt cache. Apply it anyway?",
		cancel: "Cancel",
		none: "-",
		notRunning: "Not running",
		thisConversation: "This conversation",
		model: "Model",
		effort: "Effort",
		sessions: "Sessions",
		newSessions: "New sessions",
		subagents: "Subagents",
		account: "Account",
		accountId: "Account id",
		accountTitle: "Claude account",
		lastSwitch: "Last account switch",
		link: "Link",
		statusTitle: "Status",
		contextTitle: "Context",
		sessionsTitle: "Sessions",
		modelsTitle: "Models",
		modelsNote: "The buttons switch the main agent. For another target: /model <target> <model>.",
		noSessions: "No sessions yet.",
		discord: { connected: "Connected", disconnected: "Disconnected", off: "Off" },
		compaction: { queued: "Compaction queued", compacting: "Compacting", done: "Compacted", error: "Compaction failed" },
		compactTitle: {
			queued: (who: string) => `${who} compacts right after this turn`,
			compacting: (who: string) => `${who} is compacting`,
			done: (who: string) => `${who} compacted`,
			error: (who: string) => `${who} could not compact`,
		},
		compactNote: "Compacting rewrites the conversation into a summary, so the next turn writes the prompt cache once more.",
		until: (time: string) => `until ${time}`,
		sessionsValue: (count: number, activeLabel: string, active: number) => `${count} · ${activeLabel} ${active}`,
		usage: (percent: string, used: string, window: string) => `${percent} (${used} / ${window})`,
		modelTitle: (who: string) => `${who} model`,
		effortTitle: (who: string) => `${who} effort`,
		updated: (who: string) => `${who} updated`,
		unchanged: (who: string) => `${who} unchanged`,
		applied: { live: "Applied now", restarted: "Restarted on it", "next-start": "From the next start", "next-turn": "From the next turn" } as Record<string, string>,
		inheritMain: "Same as main",
		restartGateway: "Gateway restart queued",
		restartGatewayNote: (minutes: number) => `It restarts once the main agent and every session have nothing left to do; you get a notice if that takes longer than ${minutes} minutes.`,
		restartMain: (who: string) => `${who} is restarting`,
		restartSession: (who: string) => `Session ${who} restarted`,
		stopping: (who: string) => `Session ${who} is stopping`,
		fableOkTitle: (conv: string) => `Expensive models are allowed in ${conv}`,
		fableOkUntil: "Until",
		resumed: (who: string) => `Session ${who} resumed`,
		aborted: (who: string) => `${who} turn aborted`,
		providersTitle: "Providers",
		noProviders: "No providers.",
		signedIn: (account?: string) => `Signed in${account ? ` (${account})` : ""}`,
		apiKey: "API key",
		disconnected: "Not connected",
		models: (count: number) => `${count} models`,
		inUse: "in use",
		addable: (list: string) => `Can be added: ${list}`,
		loginPick: "Which provider do you want to sign in to?",
		loginNone: "No sign-in in progress",
		loginCancelled: (provider: string) => `${provider} sign-in cancelled`,
		loginDone: (provider: string) => `${provider} signed in`,
		loginAdded: (account: string) => `Account added (${account})`,
		loginRefreshed: (account: string) => `That account is already registered (${account}); its login was refreshed`,
		loginOpen: "Open the link to sign in",
		loginMore: (provider: string) => `One more value is needed. Send it as /login ${provider} <value>.`,
		loginCode: (provider: string) => `On another device, send the full address you land on (or the code) as /login ${provider} <address or code>.`,
		loginAfter: "Once you approve, it shows up in /providers.",
		logoutDone: (provider: string) => `${provider} signed out`,
		logoutNote: "Work that is already running keeps the old login until it restarts.",
		quotaTitle: "Usage limits",
		noQuota: "No usage information.",
		left: (value: string) => `${value} left`,
		resets: (time: string) => `resets ${time}`,
		windows: { "anthropic:5h": "5 hours", "anthropic:7d": "7 days", "anthropic:7d:opus": "7 days · Opus", "anthropic:7d:sonnet": "7 days · Sonnet" } as Record<string, string>,
		problem: { expired: "The login expired; it renews on the next request.", rate_limited: "Reading usage is rate-limited right now.", failed: "Could not read usage." } as Record<string, string>,
		readFailed: "Could not read usage (no Anthropic account found).",
		noLimits: "No limit information.",
		help: (levels: string, minutes: number): HelpText => ({
			title: "Commands",
			groups: [
				{ label: "View", items: [["/status", "State of the main agent, sessions and Discord"], ["/context", "Context usage per process"], ["/lanes", "Sessions and their models"], ["/quota", "Usage limits per provider"], ["/providers", "Signed-in providers and their models"]] },
				{ label: "Models", items: [["/model [target] [model] [effort]", "Show or change a model. Targets: orchestrator, lanes (new sessions), workers (subagents) or a session. In a project conversation, no target changes that conversation only; inherit goes back to main's"], ["/effort <target> <level>", `Change the effort (${levels})`], ["/compact <target>", "Compact a context"], ["/fable-ok", "Allow an expensive model (Fable) in this conversation for a while"]] },
				{ label: "Sessions", items: [["/stop <session>", "Pause a session (continue it later)"], ["/resume <session> [text]", "Continue a paused session, or send text to a live one"], ["/abort [target]", "Cancel the current turn (default: orchestrator)"], ["/restart <target>", `Restart a process. gateway waits until all work is done (notice after ${minutes} min)`]] },
				{ label: "Accounts", items: [["/login [provider]", "Sign in; /login cancel aborts"], ["/logout <provider>", "Sign out and remove the key"], ["/account [id|alias|auto]", "The Claude account in use and why; pick one, or back to automatic"], ["/account alias <id> <alias>", "Name an account (just <id> clears it)"]] },
			],
			note: "Changing the model or effort of a running session needs --force, because its prompt cache is rewritten. Discord also takes ! instead of /. A model can be a unique part of its name (\"opus\").",
		}),
	},

	recall: (a: RecallArgs) => `[dotz gateway] You are ${NAME}, the dotz orchestrator hosted headless by the gateway.\n\nIdentity (who you are and how you talk):\n${a.identity}\n\nContract:\n\n${a.mode}\n\nOwner rules (${paths.rules}; they override the contract):\n${a.rules}\n\nLessons (${paths.lessons}):\n${a.lessons}\n\nOwner memory (${paths.memory}; before asking the owner anything, check here and grep ${paths.observations}):\n${a.memory}\n\nWork channel setups (dotz_channel list for login health):\n${a.setups}\n\nCurrent state.json:\n${a.state}`,
	identityFallback: (character: string, tone: string) => `Name: ${NAME}\nCharacter: ${character}\nTone: ${tone}\nSpeak in this character and tone in every reply.`,
	handover: (previous: string, tail: string) => `\n\n[handover] The previous conversation (${previous}) was rotated to keep the context small. Its most recent exchanges, oldest first; continue any open thread from here:\n${tail}\n\n${enRetainNudge}`,
	laneHandover: (previous: string, tail: string | undefined) => `[handover] The previous conversation (${previous}) was rotated.${tail ? ` Its most recent exchanges, oldest first:\n${tail}\n\n${enRetainNudge}` : ""}`,
	retainNudge: enRetainNudge,
	workerSwitched: (model: string) => `[dotz] The owner set your subagent model to ${model}: start new task subagents on it (running ones keep theirs).`,
	limitStopAskNote: "[dotz gateway] Your last message looks like it stops to ask whether to go on because the remaining usage limit is low. Do not stop early or ask on a low limit: at a real limit the gateway applies the owner's setting and resumes the session. Keep working.",
	personalAskNote: "[dotz gateway] Your last message looks like it asks for personal or security data (card, address, phone, ID number, password and the like) in chat. Ask for such values only through dotz_auth kind=form (or secret), never in chat. Correct the message you sent and ask again through the form.",
	// The gateway's own replies while a session waits on a dotz_auth request (hub/auth-wait.ts), posted to the owner's conversation.
	authWaitNotice: (what: string, until: string) => `The "${what}" input form is open, so I'm waiting until ${until}. Fill it in or send "cancel" and I'll carry on.`,
	authOpenNotice: (what: string, until: string, where: string) => `An input form for "${what}" is open in the web app (until ${until}). ${where} Send "cancel" here to close it.`,
	authOpenWhereLink: (link: string) => `Open it at ${link}`,
	authOpenWhereApp: "Open the web app to fill it in.",
	authCancelledNotice: (what: string) => `Closed the "${what}" input form.`,
	pendingAsksHead: "Session questions waiting for the owner's answer",
	pendingAskEntry: (lane: string, at: string, text: string, cutFile?: string) => `- session ${lane} (asked ${at}):\n${text}${cutFile ? `\n... (cut; the full question is in ${cutFile})` : ""}`,
	keepalive: "[keepalive] Cache keepalive from the gateway. Reply only: ok. No tools, no sends, no state edits.",

	orchRate: (held: number) => `${enLeads.rateLead}. Continue the request you were handling when it stopped.${held ? ` ${held} message(s) that arrived while you were paused come next, oldest first.` : ""}`,
	orchProvider: (held: number) => `${enLeads.providerLead}. Continue the request you were handling when it stopped.${held ? ` ${held} message(s) that arrived while you were paused come next, oldest first.` : ""}`,
	orchTransient: `${enLeads.transientLead}. Continue the request you were handling when it stopped.`,

	laneStopped: "[dotz gateway] Your process was restarted after it stopped responding. Continue the last request.",
	laneSteered: (texts: string[]) => `Messages you received during the stuck turn. Handle them too if you have not yet:\n${texts.map(t => `- ${t}`).join("\n")}`,
	laneRate: `${enLeads.rateLead}. Continue the work you were doing when it stopped.`,
	laneProvider: `${enLeads.providerLead}. Continue the work you were doing when it stopped.`,
	laneTransient: `${enLeads.transientLead}. Continue the work you were doing when it stopped.`,
	// The one worklog / lane line when a fallback chain moves a process (or one of its task workers) to its next model.
	modelFallback: (from: string, to: string, reason?: string, worker?: boolean) => `${worker ? "Task subagent model fallback" : "Model fallback"}: ${from} → ${to}${reason ? ` (${reason.replace(/\s+/g, " ").trim().slice(0, 120)})` : ""}`,
	// Hub-driven chain (conditional entries): a switch, a return to an earlier entry, and every entry spent.
	fallbackMove: (from: string, to: string, why: "quota" | "error" | "cap" | "revert", back?: string) => `${why === "revert" ? "Model back" : "Model fallback"}: ${from} → ${to} (${{ quota: "usage limit reached", error: "provider error", cap: "spend cap reached", revert: "limit reset" }[why]}${back ? `; back on the subscription around ${back}` : ""})`,
	fallbackExhausted: (model: string, until: string) => `Model fallback: ${model} reached its spend cap and no fallback model is left. Paused until ${until}.`,
	// The runtime's own fallback walk is undone: the process goes back to its configured model (or this runtime cannot).
	modelReverted: (model: string) => `Back on the original model (${model})`,
	fallbackFresh: (to: string, keyed: boolean, again: boolean, workers = false) => `\n\n[dotz gateway] You now run on ${to} in a fresh conversation (a model switch never continues the old conversation: its whole prompt cache would be written again).${keyed ? ` This is the API-key fallback: the subscription hit its usage limit. ${workers ? "Task subagents and sessions run on the same API key too (billed per token, sharing its monthly cap): hand off only the heavy work that needs it." : "Answer and do light work yourself; task subagents and sessions do not run on the API key, so put heavier work in state.json open_tasks and tell the owner it starts after the reset."} dotz moves you back to the subscription in a fresh conversation as soon as the limit lifts.` : " The subscription is usable again: pick up the work deferred in state.json open_tasks."}${again ? " The owner's last request above failed on the limit and was not answered: answer it now." : ""}`,
	apiStart: (model: string) => `API key in use: the subscription hit its usage limit, so the orchestrator answers on ${model}; no sessions or subagents until the reset.`,
	apiEnd: (model: string) => `API key no longer in use: the orchestrator is back on ${model} (subscription).`,
	modelNoRevert: "This runtime cannot switch models, so it stays on the fallback until restarted.",
	ownerAnswerNudge: "(Owner message: answer it at your next tool boundary with one short note before that tool call, what you will do and when; the final report is not the first answer.)",
	laneOwnerResumed: "[dotz gateway] The owner resumed you. Continue the work you were doing.",
	laneRuntimeRefused: (lane: string, from: string, to: string) => `Session ${lane} cannot be resumed: its conversation was made by ${from}, and sessions now run on ${to}, which cannot take it over (the process would die at once, and the conversation and its prompt cache would break). Reply "handover" (or "인계") to continue it as a new conversation of the same session, handed the previous conversation's recent exchanges, its brief and its last report; the message just sent goes along.`,
	laneRuntimeHandover: (from: string, to: string, cwd: string, brief: string, lastReport: string) => `[dotz gateway] Your previous conversation was made by ${from}; sessions now run on ${to}, which cannot resume it, so you continue in a fresh conversation. You keep your folder (${cwd}), model and goal. Read your brief (${brief}) and your last report (${lastReport}), check the current state of the work (git status, the files the brief names), then handle the owner's message below.`,
	laneOwnerRestarted: "[dotz gateway] Your process was restarted by the owner (settings changed). Continue the work you were doing.",
	laneMemory: (used: string, limit: string) => `[dotz gateway] Your process used ${used} GB of memory (limit ${limit} GB), so the gateway restarted it on the same conversation; any task subagents you had running stopped too. omp's grep, cat and find run inside your own process: do not point them at huge trees (~, ~/Library, /) or multi-GB files, and quote paths with spaces. Check what your subagents finished, relaunch the rest, and continue the work you were doing.`,
	laneGatewayRestarted: "[dotz gateway] The gateway restarted while you were working, which also stopped any task subagents and background commands you had running. Check what they finished (patches, files, commits), relaunch the rest, and continue; if an owner message was cut off mid-turn, handle it too.",
	laneShellJob: "a background command",
	laneIdleHeld: (jobs: string[], minutes: number) => `[lane stuck] This idle lane stays up for: ${jobs.join(", ")}. Nothing was heard of it for ${minutes}+ minutes and it keeps about 1 GB in use. If it is still needed, leave it; if not, stop this lane.`,
	laneRestartStuck: (n: number) => `[lane stuck] This session's work was cut off and it was brought back ${n} times, but its plan did not move, so it is left alone. To go on, send it a message; to drop the work, stop the session.`,
	sessionRestartStuck: (n: number) => `This conversation's work was cut off and it was brought back ${n} times without finishing, so it is left alone. To go on, send a message here.`,
	laneRestartResume: "[dotz gateway] The gateway restart is done and task workers can start again. Continue where you stopped.",
	laneResumeContinue: (open: number, current: string) => `[dotz gateway] Your process stopped with work unfinished and you are back on this conversation. Check what was left (result files, logs), rerun what is missing, and go on${open ? ` with your ${open} open task(s)${current ? ` (now: ${current})` : ""}` : ""}. If nothing is left, say so with [done]; if it waits on the owner, say so with [ask] or [wait].`,
	laneWorkersCut: (workers: string[]) => `These workers died with it and will not report back, so rerun them: ${workers.join(", ")}.`,
	checkPassed: (n: number, landed: boolean) => `Checks passed: all ${n} checks passed${landed ? ", and the work branch is landed in main" : ""}`,
	askRefused: (text: string) => `[gateway check] Your last [ask] did not reach the owner: without choices he cannot answer it on the spot. Say in one line which project and work it is about, then put a \`결정: <one plain question>\` block with 2-4 options and what each one leads to, and send it as [ask] again. If you are only waiting and have nothing to ask, send nothing and end the turn.\n\nThe text sent back:\n${text}`,
	unverifiedRefused: (lines: string[]) => `[gateway check] Your report did not reach the owner: these lines say something is unchecked without saying why:\n- ${lines.join("\n- ")}\nFirst check everything this machine can check (run it, render it headless, read it back). For what still cannot be checked here, say why on that line and add \`instead checked:\` (or \`대신 확인:\`) with what you checked in its place. Then send the report again.`,
	checkBounced: (n: number, failed: number) => `Some checks have not passed yet, so it went back to the session (${failed} of ${n} checks)`,
	turnNoAnswer: "I could not write a reply this time. Please send your message again.",
	checkFailed: (n: number, failed: number) => `${failed} of ${n} checks did not pass, so this is not verified`,
	checkContradicted: (n: number) => `The report contradicts the session record in ${n} place${n === 1 ? "" : "s"}, so it is not verified`,
	gatewayRestart: (replayed: number, lanes: string[]) => `The gateway restarted and is picking the work back up${replayed ? ` · ${replayed} message(s) that had no answer` : ""}${lanes.length ? ` · sessions ${lanes.join(", ")}` : ""}`,
	fileRecovered: (name: string, restored: boolean) => `${name} was damaged, so the gateway started from ${restored ? "its last good copy" : "defaults"}. The damaged file is kept in the same folder with a .corrupt name.`,
	workStalled: (items: { description: string; id: string; reason?: string; workdir?: string }[]) => `[dotz gateway] ${items.length > 1 ? "These background tasks are" : "This background task is"} still marked running but no longer working: ${items.map(w => `"${w.description}" (${w.id}; ${w.reason || "no reason recorded"}${w.workdir ? `; working folder ${w.workdir}` : ""})`).join(", ")}. The gateway did not stop ${items.length > 1 ? "them" : "it"}. Check what it already produced (commits, files), then finish the work yourself or relaunch it (after a usage limit, once the limit has reset), and cancel the stuck task (task_cancel) once you have taken it over.`,
	openRequests: (items: { target: string; replyTo?: string; asked?: string; workers: { id: string; description?: string }[] }[], last: boolean) => `${enLeads.openLead}${last ? " (last reminder)" : ""}: ${items.map(r => `msg=${r.replyTo ?? "-"} in ${r.target}${r.asked ? ` ("${r.asked.replace(/\s+/g, " ").slice(0, 80)}")` : ""}${r.workers.length ? `, workers ${r.workers.map(w => w.id).join(", ")}` : ", no worker"}`).join("; ")}. Finish each now: answer it from what its worker produced (task_output reads the result), or say what stopped it. This turn's final answer goes to the first one; answer the others with dotz_send reply_to. If real work remains, start it and end with [later].`,
	workFailed: (desc: string, id: string, reason: string) => `[dotz gateway] Your background task "${desc}" (${id}) failed: ${reason}. No turn of yours has taken it up. It is yours to finish: check what it already produced (commits, files, its result), fix the cause (a transient error: run it again; a wrong category, model or brief: correct it and relaunch), and finish the owner's request. Do not ask the owner whether to retry; report the result, and ask only for a decision or a credential only he can give.`,
	stallNudge: (open: number, current: string) => `[dotz gateway] Your turn ended ${open ? `with ${open} plan task(s) still open` : "without doing the work it said it would do"}${current ? ` (now: ${current})` : ""} and nothing to wait for. Go on with what is left now. If something really waits on the owner or on outside work, say so in one line and mark it so in your plan instead of leaving it open.`,
	laneRotated: (why: string, cwd: string, brief: string, lastReport: string) => `[dotz gateway] Your conversation was rotated to a fresh one (${why}) to keep the context small. You keep your folder (${cwd}), model and goal. Read your brief (${brief}) and your last report (${lastReport}), check the current state of the work (git status, the files the brief names), and continue from there. Do not start new work and do not report: if nothing is open, reply with the single word "ready".`,
	heldMessages: (text: string, held: string[]) => `${text}\n\n${held.length} owner message(s) arrived while you were paused; handle each, oldest first:\n\n${held.join("\n\n---\n\n")}`,

	footer: (a: LaneFooterArgs) => `\n\n---\n[dotz lane ${a.lane}] ${enLaneLanguage(a.language)} You are a session of ${NAME}: a full omp orchestrator for this folder with one goal. The final message of each turn is your report: ${NAME} relays it and the owner reads it in the session channel. Keep it to ~800 characters in the report shape of ${a.mode} (Reporting): the first line is the outcome, led by a tone marker [done]/[run]/[wait]/[ask]/[fail] ([ask] only when the owner must choose, with a choice block: the gateway sends one without it back, and "still waiting" is never an [ask]; a request to ${NAME} is a [done]/[run]/[fail] report with the "For ${NAME}:" line, never [ask]); then, only when the owner must answer something, a choice block: a \`결정: <question>\` line, then 2-4 options, each \`**1) name**\` and one line of what it does (one block per decision); then at most 3-4 bullets of what changed and how you checked it (paths, the Done-when check you ran yourself, the merged commit); last, one "For ${NAME}:" line for what the orchestrator handles, never mixed with the owner's questions. The owner may write to you directly. While you only wait (a video, a build, a monitor) and nothing changed since your last report, end the turn with a one-line [run] report, never an untagged one: [run] stays in the session channel and does not wake ${NAME}. When your work is done and only the owner's next message can move it, end with a one-line [wait] report instead of [run]: nothing wakes or nudges you, and the owner sees that you wait for him. Do not message Discord or other people yourself, and never put secrets in a report. An owner message ("[owner via web]" / "[owner via Discord]") can reach you mid-turn: answer it at your next tool boundary with one short note before that tool call (what you will do about it, and when), not only in the final report; the gateway shows that note to the owner where he wrote, at once. Before you start, read and follow ${a.mode} (sections Sessions and subagents, Reporting, Browser and testing), ${IDENTITY_FILE} (voice) and the owner's standing rules in ${paths.rules} (they override your defaults). Plan and review yourself; run implementation and grind work as task subagents (subagent model ${a.workerModel} via modelRoles.task; if the owner switches it, record it with \`bun ${import.meta.dir}/lane-cli.ts worker <model:effort> --owner-message <mid of the owner's message that asked for it>\`; the gateway refuses it without that message), and review a subagent's diff yourself before applying or merging it. Do not queue independent slices behind one subagent: this machine runs up to ${a.slots} task subagents at once, so fan independent slices (different files, or separable sections merged one by one) out in one batch; keep one subagent only for work that must be sequential. Size the work once at the start (heavy: new module, security or permissions, external integration, DB schema, concurrency, cross-domain refactor; unsure is heavy; never downgrade): light = 1-2 success criteria and one proof, heavy = 3+ (happy, edge, regression) with a proof each and a reviewer pass. Passing tests is not done: prove the changed behavior on its real surface (command, screen, API). Check everything this machine can check before you report (run it, render it headless, read it back); a report line about something left unchecked says why it cannot be checked here and carries \`instead checked:\` (or \`대신 확인:\`) with what you checked in its place, never a bare "unverified" line: the gateway sends one without it back once. Run the full test suite once, right before merge; on a failure run only that file; a failure unrelated to the branch that passes alone is reported, not chased. Take reversible choices inside the request and budget yourself and note them in the report; ask the owner only at the confirmation gates (secrets, payments, external blast radius, destructive steps) or for taste. Computer steps on this machine (permissions, Settings switches, Allow prompts, app restarts) are yours (${a.mode}, Browser and testing): hand the owner only what a person must do, once, after trying. Write tool-call intents in the owner's language, 2-6 words, and tell your subagents the same. Numbers that read better as a picture (a trend, a share) may go in a \`\`\`chart block of ztd-charts JSON; the web and Discord show it drawn. Keep your todo list true as you go: mark a task done the moment it is, start the next one, and drop or reword one that changed; the owner watches it as your progress.${a.worktree}`,
	worktree: (w: WorktreeArgs) => `\n\nYou work in your own git worktree ${w.path} on branch ${w.branch}, split from ${w.repo} (${w.base}); paths under ${w.repo} in your brief mean the same files under ${w.path}. In subagent briefs write repo files as paths relative to the worktree: an isolated subagent gets its own copy, and an absolute ${w.repo} or ${w.path} path makes it edit the real checkout. Other sessions and the owner work in ${w.repo}: never edit files there. Commit your work on ${w.branch} as you go. Untracked setup (node_modules, .env, build output) is not in the worktree: install or link what you need. When the Done-when check passes, land it the way this project lands work (a PR if it uses them); otherwise rebase onto ${w.base} (\`git rebase ${w.base}\`), then \`git -C ${w.repo} merge --ff-only ${w.branch}\`. On a conflict, resolve it in your worktree and retry; never force, never reset ${w.repo}. Report the merged commit. The gateway removes your worktree when the session is closed after the merge.`,
	noGit: `\n\nThis folder is not a git repository, so isolated task subagents cannot start here: run subagents without isolation (read-only work needs none), and if a subagent must edit files, keep its slice to files no other subagent touches.`,

	replay: `${enLeads.replayLead}. Handle it now; it may be partly done already, so check before repeating an action.`,
	joinWorker: (id: string, description: string) => `${enLeads.joinLead}: "${description.replace(/\s+/g, " ")}" (task ${id}). If this message is about the same work (the same approval, the same posting), do not spawn a new worker: pass it to the running one with task_send and end with [later]. Otherwise handle it normally.`,
	otherWorker: (id: string, conversation: string, replyTo?: string) => `${enLeads.otherConvLead}. This turn's final answer goes to this conversation only. If the result of task ${id} (${conversation}) arrives during this turn, send that answer with dotz_send target "${conversation}"${replyTo ? ` reply_to "${replyTo}"` : " reply_to <that conversation's message id>"}, never here.`,
	workReadElsewhere: (id: string, conversation: string, readIn: string) => `${enLeads.otherConvLead}. The result of task ${id} (${conversation}) was read in a turn for ${readIn}. It is the answer to the request in ${conversation}: answer it here.`,
	workReadHere: (id: string) => `[dotz gateway] The result of task ${id} was read in a turn that did not answer this request. Answer it now from that result.`,
	newMessage: (target: string, replyTo: string | undefined, text: string) => `${enLeads.newMessageLead}. If its full answer is ready now (a quick question), send it with dotz_send target "${target}"${replyTo ? ` reply_to "${replyTo}"` : ""}. Otherwise send nothing separately: keep working and include its answer in this turn's final answer. Either way that answers the message.\n\n${text}`,
	// The one leading line of an owner prompt that says what runs now (workers named by the hub from its own state; no model call).
	nowRunning: "[running now]",
	nowLanes: (n: number, body: string) => `sessions ${n}(${body})`,
	nowLaneBusy: "working",
	nowWorkers: (n: number, names: string) => `subagents ${n}${names ? ` ${names}` : ""}`,
	nowOrchestrator: (n: number, names: string) => `orchestrator subagents ${n}${names ? `(${names})` : ""}`,
	firstStart: (target: string) => `[dotz gateway] First start of this install. Speak first in ${target}: greet the owner in a few short messages as ${NAME} (who you are, what you can do: channels per project, monitoring, sessions, schedules). Then ask once whether you may learn their setup, read-only: Aside's memory of them (aside memory list / search: who they are, people, projects, sites) and the sites they are signed in to, coding agent conversations and their projects, tools and CLIs in use, logs and schedules on this machine. On yes, do it with read-only subagents, keep one progress message updated in place (dotz_send update_key "onboarding"), record what you learn in memory as you go, and end with a short summary of what you learned and what is still missing. On no, just say how to start. Also offer to connect the messengers the owner uses (discord, jandi, slack, telegram) with the dotz_connect tool.`,

	inboxLaneReport: (lane: string) => `[dotz inbox] session report from ${lane}:`,
	inboxLaneReports: (n: number) => `[dotz inbox] ${n === 1 ? "session report" : `${n} session reports`} (routine progress stays in report.md and the what-runs-now line):`,
	laneReportSteer: (body: string) => `${enLeads.laneReportLead}. Act on it now if it needs you (a result or failure to pass on, a question you can answer): pass it on with dotz_send or answer the session with dotz_lane, then continue the current work; it does not come back later. A session's [ask] already reached the owner: never post it again.\n\n${body}`,
	laneAskWaiting: (lanes: string) => `Not posted: the question of session ${lanes} already waits as a card in the owner's 답변 필요, and his answer there reaches the session. A second card only repeats it, so do not post it again in any words. A different question of yours goes in a later turn.`,
	// A progress report of a running turn every 5 minutes (hub/livestatus.ts); never rewritten by a model.
	liveStatus: (minutes: number, now: string, lanes: string, workers: string, steps: string[], rest: number) => `[run] Still working, ${minutes} min so far.${now ? `\nNow: ${now}` : ""}${lanes ? `\nSessions: ${lanes}` : ""}${workers ? `\nSubagents: ${workers}` : ""}${steps.length ? `\nRecently:${steps.map(s => `\n- ${s}`).join("")}${rest ? `\n- and ${rest} more` : ""}` : ""}`,
	liveTool: { run: "Running a command", read: "Reading a file", edit: "Editing a file", search: "Searching files", web: "Searching the web", fetch: "Reading a web page", task: "Running a subtask", note: "Updating notes", other: "Working" },
	liveMore: (n: number) => `+${n} more`,
	inboxWatchNoChannel: (watch: string, reason: string) => `[dotz inbox] watch ${watch} ${reason} (no one is waiting for this turn). If it is a failure, an anomaly or flapping, ${enIssue}\nIf it is not an issue, post nothing to alert; one dotz_send worklog line only:`,
	inboxWatchOnce: (watch: string, reason: string, ch?: string) => `[dotz inbox] one-shot watch ${watch} ${reason}: the result you were waiting for. Nothing has reached the owner yet, so do what follows from it and tell the owner what happened once, in plain words, ${ch ? `in your final answer to work channel ch:${ch}` : "with dotz_send alert"}. Never copy the raw output or a sentinel. Output:`,
	inboxWatch: (watch: string, reason: string, ch: string) => `[dotz inbox] watch ${watch} ${reason} for work channel ch:${ch} (your final answer goes there; reply "-" alone to post nothing). If it is a failure, an anomaly or flapping, ${enIssue}\nIf it is not an issue, post nothing to alert; one dotz_send worklog line only:`,
	inboxMail: (to: string) => `[dotz inbox] new mail; its conversation already exists (${to}) and your final answer goes there (open no thread). Summarize it there. If a reply is warranted, ask with the send-approval block: quoted lines "> 받는이: ...", "> 제목: ..." (a mail always carries its 첨부 line: "> 첨부: name (size)" for each file that goes out, else "> 첨부: 없음"), the quoted body, then "결정: 보낼까요? (<mail id>)" with 1) 보내기 / 2) 고치기 / 3) 보내지 않기. If something must be decided first (for example which file to send), ask that as a choice first and show the draft after the answer. If the gateway already posted a reply draft ([ask]) in this conversation, do not write another. Read or act with zele, sending only after the owner picks 1) 보내기 there. If no reply is needed, just summarize; reply "-" alone to post nothing:`,
	mailNote: (source: string, id: string, subject: string) => `(This conversation is one mail: ${source} ${id}, "${subject}". Any reply, send, forward or trash: draft first as the send-approval block (1) 보내기 / 2) 고치기 / 3) 보내지 않기) and act only after the owner's explicit OK here.)`,
	textsReport: (lines: string) => `[dotz gateway] Some of this install's text overrides (<data dir>/custom/texts.json) no longer fit this version:\n${lines}\nRe-check each one against the new shipped text (bun hub/texts-cli.ts show <key>), then rewrite it with \`bun hub/texts-cli.ts set <key> --file <file>\` or delete the entry. This notice comes once per problem. Tell the owner in one line what you changed.`,
	carryOver: (where: string, read: string, stat: string, files: string) => `[dotz update] Changes made directly in this install's dotz code were saved before the update (this notice comes once per backup). Saved: ${where}\nChanged: ${stat}\n${files}\nDo this: 1) Read the diff with \`${read}\`. 2) Move each change to the custom layer where it fits: texts to <data dir>/custom/texts.json (bun hub/texts-cli.ts), features to <data dir>/features, rules to RULES.md. 3) For a change that only makes sense in dotz core, write a Korean report for the dotz maintainer in the worklog, with all personal and sensitive content removed, de-identified and generalised but still detailed (symptom, steps, expected, actual, version), and offer to open a GitHub issue on ddotz/dotz. 4) Then tell the owner in one message what was carried over and what was not. Never edit the dotz code.`,
	cardAudit: (closed: number, refreshed: number, open: number) => `[dotz update] This update audits this install's cards once. The gateway closed ${closed} card(s) the send records prove went out and refreshed ${refreshed}. ${open} card(s) are open.\nRead mail, reply drafts, comments, website direct messages, KakaoTalk, sns jobs, the approval queue and notices, and compare them with the send records. How to read each app is in features/<app>/feature.md; read cards with GET /api/notices and GET /api/approvals.\n- Send nothing outside. Do not resend, approve or discard. Run no send command.\n- Close only cards the send records prove went out (ids of POST /api/notices/resolve).\n- Keep every other card open. When one no longer matches its draft, refresh only the card so 보내기 works.\n- At the end give the owner a short summary in this conversation: cards closed, cards left, what they should look at. This audit does not come again.`,
	inboxSchedule: (id: string, every: number | undefined, channel: string) => `[dotz inbox] scheduled (${id}${every ? `, every ${every} min` : ""}) - do it now; your final answer goes to ${channel}:`,
	inboxCheck: (ids: string[], channel: string) => `[dotz inbox] quiet check (${ids.join(", ")}) - not something the owner asked for but a system check you set yourself${ids.length > 1 ? `. ${ids.length} fall at the same time, so they come as one turn: go through them in order and write one answer` : ""}. If everything is normal, answer one plain line (it is kept quietly in the worklog only). Start the answer with [ask] or [fail] only when the owner must decide or must know. If there is nothing to say, answer \"-\" alone. Your final answer goes to ${channel}:`,
	scheduleCheckLine: (text: string) => `${SCHEDULE_CHECK_LEAD} ${text}`,
	inboxThread: (thread: string, parent: string) => ` (thread "${thread}" in #${parent}; your answer goes into the thread)`,
	inboxFirst: (channel: string) => `(new work channel #${channel}: the owner hands out work by channel. Keep this channel's work and reports here. If its work needs a login kept alive or something checked over time, set that up for this channel with dotz_channel setup yourself.)`,
	inboxBurst: (n: number) => `(sent as ${n} messages in a row; read them together as one request)`,
	replyingTo: (author: string, content: string) => `(replying to ${author}: "${content}")`,
	// A decision answer: each block's question with the chosen option, and the start of the message that asked (hub/intake.ts).
	decisionAnswer: (picks: { q: string; n: number; label: string; note?: string }[]) => `Decision answer: ${picks.map((p, i) => `${picks.length > 1 ? `${i + 1}) ` : ""}${p.q || "-"} -> ${p.n}) ${p.label}${p.note ? ` - ${p.note}` : ""}`).join("; ")}`,
	decisionAsked: (quote: string) => `(this answers your question: "${quote}")`,
	openQuestions: (titles: string[]) => `(still open for the owner in this conversation: ${titles.map(t => `"${t}"`).join(", ")}. First judge whether this message answers one. If so (even in part), close it in your first send, not at the end: dotz_send's resolves, or end a lone final answer with <resolves>words of the title</resolves>. Otherwise leave it open and handle the other subject.)`,
	workChannels: (list: string[]) => `(work channel list, not this message's channel: ${list.length ? list.join("; ") : "none yet"})`,
	// Discord channel names the gateway creates, and the done marker of a lane thread.
	channelNames: { chat: "chat", alert: "alerts", worklog: "worklog", mail: "mail", workCategory: (name: string) => `${name} work` },
	threadDone: "Done. This thread is archived in an hour.",
	laneParked: "Stopped. Write here to pick this session back up from where it left off.",
	laneLanguage: (language: string) => `(${enLaneLanguage(language)})`,
	replyIn: (language: string, drifted: boolean) => drifted ? `(Your last text for the owner was not in ${language}. Write everything for the owner in ${language} only.)` : `(Answer the owner in ${language}.)`,
	handoffNote: "(Your last reply carried the For you / Now / Next handoff labels. Replies go to the owner as chat messages: no routing line and no Ask / For you / Now / Next block.)",

	reflect: (digest: string, lessons: string) => `[dotz reflect] Nightly self-review of the last 24h. Data from the gateway:\n${digest}\n
Do this, briefly:
1. Find what went wrong or cost too much: owner corrections or repeated asks, failed or stuck lanes, alerts, cache rewrites.
2. For each real lesson add or update one dated line in ${lessons} (keep the file under ${LESSONS_MAX_BYTES} bytes; the gateway refuses lines past that; delete lessons that no longer apply or that a rule already covers). For each owner correction or reaction above, add one sourced line to ${paths.observations}; move a durable owner preference or context (stated plainly, or seen twice there) to ${paths.owner}, and a "don't" in the owner's own words to ${paths.boundaries}, verbatim with its source. Only what the owner said or did; never write about other people there.
3. If there is an issue (a failure, an anomaly, a repeated mistake, a token leak, something that recurred although RULES.md or LESSONS.md already covers it), once, ${enIssue}
4. Never edit RULES.md here; offer a rule change as an option and wait for the owner's answer.
5. If the schedules above overlap, merge them (dotz_schedule remove + add), and remove those whose task is over.
6. Finish with one dotz_send worklog line in the identity's language and Notices style, starting "${NIGHT_LEAD} ...". If nothing was wrong, that one line is all you send: nothing to alert.`,

	// Gateway-written: the lessons gate and the repeat card (hub/reflect.ts admitLessons, sendRepeatAlerts).
	lessonGate: (topics: string[]) => `\n\nThese lesson topics hold prose and nothing enforced, so the gateway removes any further prose line in them: ${topics.join(", ")}. A new line there needs "(enforced: <guard, test or check>)". Name a line's topic with "(topic: <name>)" when its words do not show it.`,
	lessonsRefused: (rows: { line: string; topic: string; why: "prose" | "cap" }[], cap: number) => `[dotz gate] Removed from LESSONS.md, do not add them back as prose:\n${rows.map(r => `- ${r.line} (${r.why === "cap" ? `over the ${cap} byte cap: merge or delete a line first` : `topic ${r.topic} has no enforced lesson: fix it in code and end the line with (enforced: <guard, test or check>)`})`).join("\n")}`,
	repeatAlert: (a: { topic: string; count: number; broken: number; examples: string[] }) => [`The same correction keeps coming back: ${TOPIC_LABELS[a.topic] ?? a.topic} (${[a.count ? `${a.count} in 7 days` : "", a.broken ? `a lesson broken on ${a.broken} nights` : ""].filter(Boolean).join(", ")})`, ...a.examples.map(e => `- ${e}`)].join("\n"),
	repeatAlertQuestion: "Open a structural fix instead of another lesson?",
	// Appended to `reflect` with tonight's one recipe candidate, and the card and answers around it (hub/recipes.ts).
	recipeCandidate: (id: string, titles: string[], briefs: string[], script: string) => `\n\nOne recipe candidate (sessions that passed the gateway's check): ${titles.join(" / ")}. Briefs: ${briefs.join(", ")}. Propose it only if the same work will come again and steps can shorten it. Write the body (the steps, the commands they need) to a temp file, a script too if it helps, run \`${script} propose ${id} --slug <lowercase-ascii> --name "<short name>" --when "<when to use it, one line>" --body-file <file> [--script-file <file>]\` once and send its whole output to alert unchanged (this overrides step 5's no-alert line). Otherwise do nothing. The gateway saves on the owner's answer: do not write to custom/recipes, run it or create a watch. No secret values or other people's personal data.`,
	recipeCard: (d: { name: string; when: string; script?: { file: string } }, preview: string, titles: string[]) => [`Keep work that went well as a recipe: ${d.name}`, `Use when: ${d.when}`, `From: ${titles.join(" / ")}`, preview, ...(d.script ? [`Script: ${d.script.file}`] : [])].join("\n"),
	recipeQuestion: "Save this recipe?",
	recipeOptions: [{ name: "Save recipe", result: "Stored only in this install's custom/recipes, found by name when similar work comes. It never runs by itself." }, { name: "Skip recipe", result: "Nothing is stored and the same work is not proposed again." }],
	recipeSaved: (name: string, dir: string) => `Recipe saved: ${name} (${dir})`,
	recipeSkipped: (name: string) => `Skipped. The same work will not be proposed again: ${name}`,
	recipeFailed: (why: string) => `The recipe could not be saved: ${why}`,
	repeatAlertOptions: [{ name: "Open a structural fix", result: "A guard, check or test that stops this; it starts only after this answer." }, { name: "Leave it this week", result: "No card on this topic for 7 days." }],
	// Appended to `reflect` only when LESSONS.md has stale or near-duplicate lines or is over its byte cap (hub/reflect.ts lessonCandidates).
	// Appended to `reflect` with the lessons no "(enforced: ...)" carries: all of them on a day with corrections, else those broken on 2+ nights (hub/reflect.ts lessonChecks).
	lessonRepeats: (rows: { line: string; score: number; broken: number; likely: boolean }[], today: string) => `\n\nLessons nothing enforces yet, checked against today's corrections. Judge by meaning, not by the words: the score is only how many of a lesson's words a correction repeats ("likely" = 0.4 or more), and "broken N" counts the nights it was already found broken. For each lesson that was really broken today: add ${today} to its "(broken: ...)" list (start one if missing), then fix it at the highest level that works: remove the cause in the code or this contract, then a guard or check whose message names the right way, then a test; reword only a pure judgment call (and add the failure as an example). After a structural fix end the line with "(enforced: <the guard, check or test>)"; delete a lesson once its mistake cannot happen. A lesson broken on two or more nights is not reworded again: it gets the structural fix now. Leave the others as they are:\n${rows.map(r => `${r.line}${r.broken ? ` [broken ${r.broken}]` : ""}${r.likely ? ` [likely ${r.score}]` : ""}`).join("\n")}`,
	// Appended to `reflect` when observations.md has lines older than 90 days (hub/reflect.ts).
	staleObservations: (stale: string[]) => `\n\nObservations older than 90 days in ${paths.observations}: delete them (move a pattern that still holds to owner.md or LESSONS.md first):\n${stale.join("\n")}`,
	lessonCandidates: (stale: string[], duplicates: string[], over: string) => `\n\nLESSONS.md cleanup candidates picked by code; you decide which to delete or merge (keep the newer or more specific wording):${over ? `\n- ${over}` : ""}${stale.length ? `\n- Older than 90 days:\n${stale.join("\n")}` : ""}${duplicates.length ? `\n- Near-duplicates (token overlap >= 0.6):\n${duplicates.join("\n")}` : ""}`,

	// Owner-facing strings of the Discord login-auth prompts (hub/auth.ts).
	auth: {
		titles: { secret: "Login details needed", otp: "Verification code needed", approve: "Login approval needed", form: "Personal details needed" },
		site: "Site",
		expires: (time: string) => `Until ${time} ${tzLabel()}`,
		approve: "I approved",
		cancel: "Cancel",
		labels: { username: "Username", password: "Password", code: "Verification code" },
		formLabels: { name: "Name", phone: "Phone number", email: "Email", postal_code: "Postal code", address1: "Address", address2: "Address line 2", card_holder: "Name on card", card_number: "Card number", card_expiry: "Expiry (MM/YY)", card_cvc: "CVC", birth_date: "Date of birth", id_number: "ID number", account_number: "Account number", other: "Other" } as Record<string, string>,
		openForm: "Open the form in the app",
		formHint: "Values are taken only in the app's form, never in chat. Open the app with the button below.",
		formHintNoLink: "Values are taken only in the app's form, never in chat. Open the app.",
		webOnly: "Please enter it in the web app.",
		statuses: { entered: "Received.", approved: "Approved.", cancelled: "Cancelled.", timeout: "Expired without an answer.", failed: "Could not be saved; the bot was told why." },
		notOwner: "Only the owner can answer this.",
		finished: "This request is already finished or expired.",
		storeFailed: "Could not save it. The bot was told why and can ask again.",
		answerFailed: "Could not pass your answer on. Type it in the channel instead.",
		noteLabel: "Tell us more",
		noteMissing: "The text was empty. Press the button again and write it.",
	},

	// Owner-facing strings of the 구성 map (hub/harness.ts); `locale` formats its dates and numbers.
	harness: {
		locale: "en-US",
		common: { state: "State", disabled: "Turned off", off: "Off", set: "Set", none: "None", count: (n: number) => `${n}`, daily: (time: string) => `daily ${time}`, na: "Not applicable", unit: { s: (n: number) => `${n} s`, min: (n: number) => `${n} min`, h: (n: number) => `${n} h` } },
		status: { working: "Working", idle: "Idle", starting: "Starting", stopped: "Stopped", "rate-limited": "Rate-limited", exited: "Exited" } as Record<string, string>,
		ago: { now: "just now", min: (m: number) => `${m} min`, hourMin: (h: number, m: number) => `${h} h ${m} min`, day: (d: number) => `${d} d`, before: (d: string) => `${d} ago` },
		fileFact: { label: "File", missing: "Not there yet", size: "Size", chars: (n: string) => `${n} chars`, modified: "Last modified" },
		files: {
			"MODE.md": { label: "Behaviour rules (MODE)", note: "Ships with the repository, so it is read-only here." },
			"RULES.md": { label: "My rules", note: "Blocked commands apply at once; the rest is picked up the next time it is read, after a new conversation or compaction." },
			"LESSONS.md": { label: "Lessons", note: "Picked up the next time it is read, after a new conversation or compaction." },
			"identity/IDENTITY.md": { label: "Identity", note: "Picked up the next time it is read, after a new conversation or compaction." },
		} as Record<string, FileText>,
		notOpenable: (name: string) => `"${name}" is not a file you can open (MODE.md, RULES.md, LESSONS.md, identity/IDENTITY.md)`,
		settings: {
			"orchestrator.model": { label: "Model" },
			"orchestrator.thinking": { label: "Thinking effort" },
			"orchestrator.rotate_tokens": { label: "Switch-to-new-conversation threshold", unit: "tokens", hint: "When the conversation gets this long, it moves to a new conversation with a handover while idle" },
			"lanes.model": { label: "Default model for new sessions" },
			"lanes.thinking": { label: "Thinking effort for new sessions" },
			"lanes.max_active": { label: "Sessions working at once", unit: "sessions", hint: "Unset, it is computed from this computer's free memory and cores. A number here is a hard cap" },
			"lanes.compact_at": { label: "Auto-compaction starts at", unit: "tokens", hint: "When a session's context fills this far, it is summarized and shrunk" },
			"lanes.keep_recent": { label: "Recent conversation kept when compacting", unit: "tokens" },
			"lanes.worker_model": { label: "Subagent model" },
			"lanes.worker_effort": { label: "Subagent thinking effort" },
			"lanes.nightly_at": { label: "Nightly cleanup time", hint: "HH:MM or off" },
			"lanes.nightly_compact_at": { label: "Nightly compaction threshold", unit: "tokens" },
			"lanes.rotate_mb": { label: "Conversation file rotation size", unit: "MB" },
			"lanes.max_rss_gb": { label: "Process memory limit", unit: "GB", hint: "Above this, the process restarts on the same conversation. To turn it off, set 0 in config.json" },
			"gateway.coalesce_ms": { label: "Time to merge consecutive messages", unit: "ms", hint: "A lone message waits this long before it goes in. A message sent while the previous one is still unanswered waits longer, so they are handled together. Messages arriving during a turn are gathered into that turn either way" },
			"gateway.restart_cap_min": { label: "Restart wait alert", unit: "min", hint: "When a restart after an update has waited this long for running work, you get one alert. While it waits no new worker starts, and running work is never cut off" },
			"reflect_at": { label: "Nightly review time", hint: "HH:MM or off" },
			"token_audit_at": { label: "Token audit time", hint: "HH:MM or off" },
			"omp_update.mode": { label: "Update mode", options: { check: "Notify of new versions only", install: "Install automatically and restart", off: "Off" } },
			"omp_update.at": { label: "Update check time", hint: "HH:MM or off" },
			"backup.remote": { label: "Backup repository address", hint: "If empty, snapshots stay on this computer only. Files containing secrets are never uploaded" },
			"output_language.mode": { label: "Output language check", options: { rewrite: "Rewrite if in another language", off: "Off" } },
			"output_language.model": { label: "Model for rewriting", hint: "If empty, omp's default small model" },
			"output_language.timeout_s": { label: "Rewrite time limit", unit: "s" },
			"zele.enabled": { label: "Mail and calendar check" },
			"zele.poll_sec": { label: "Check interval", unit: "s" },
			"zele.brief_hour": { label: "Morning briefing hour", unit: "h" },
			"identity.name": { label: "Name" },
			"identity.language": { label: "Reply language", hint: "ko, en, ja … If empty, detected from the identity text" },
			"identity.character": { label: "Character", hint: "If the identity file (IDENTITY.md) exists, it takes precedence" },
			"identity.tone": { label: "Tone", hint: "Also the tone reference for output-language rewriting" },
		} as Record<string, SettingText>,
		nodes: {
			discord: {
				summary: { connected: (n: number) => `Connected · work channels: ${n}`, disconnected: "Disconnected" },
				desc: "Receives what is written in chat rooms, work channels and session threads, passes it to the gateway, and posts the reply in the same place. Received messages are marked with 👀 first. Connection details (token, server, owner) cannot be changed from this screen for security.",
				state: { off: "Off (token, server or owner is missing)", connected: "Connected", disconnected: (err: string) => `Disconnected${err ? ` · ${err}` : ""}` },
				workChannels: "Work channels", laneThreads: "Session threads", token: "Bot token", owner: "Owner", guild: "Server",
			},
			web: {
				label: "Web app", summary: (tailnet: boolean) => (tailnet ? "This screen · reachable only inside the tailnet" : "This screen · this computer only"),
				desc: (host: string, tailnet: boolean) => `The screen you are looking at. See chats, projects, sessions and settings; a message you send goes through the gateway to the orchestrator. The server listens only on this computer (${host})${tailnet ? "; from outside, Tailscale attaches the login identity and lets you in." : ". Tailscale is not set up, so it does not open from other devices."}`,
				access: "Access", accessValue: (tailnet: boolean, logins: number) => (tailnet ? `Only logins allowed through Tailscale (${logins})` : "This computer only"),
				port: "Port", tailscalePort: "Tailscale HTTPS port", logins: "Allowed logins", loginCount: (n: number) => `${n}`,
			},
			terminal: {
				label: "Terminal", summary: (n: number) => `Connected terminals: ${n}`, none: "No terminals connected",
				desc: (_name: string) => `Run /dotz on in a terminal and that terminal becomes an input box: what you type goes to the gateway orchestrator. Run /dotz off and it is a normal terminal again.`,
				connected: "Connected terminals",
			},
			schedule: {
				label: "Schedules", summary: (n: number, next: string) => `${n} scheduled${next}`, none: "No schedules", next: (d: string, future: boolean) => ` · next ${future ? `in ${d}` : `was ${d} ago`}`,
				desc: (min: number) => `Sends a prepared sentence to the orchestrator at a set time (once, or repeating at intervals of ${min} minutes or more). The orchestrator can create and delete schedules.`,
				schedules: "Schedules", nextRun: "Next run", repeating: "Repeating schedules",
			},
			watch: {
				label: "Monitoring", summary: (n: number, failing: number) => `Monitoring: ${n}${failing ? ` · failing in a row: ${failing}` : ""}`, none: "No monitoring",
				desc: (after: number, every: string) => `Runs a check script at a set interval without waking the model, and tells you only when the value changed, a condition matched, or it failed. Keeping logins alive (expiry checks) is done here too. After ${after} failures in a row it notifies once per ${every}, and once more when it recovers.`,
				watches: "Monitoring", setups: "Per-work-channel setups", failing: "Failing in a row",
			},
			mail: {
				label: "Mail and calendar", summary: (sec: number, hour: number) => `Checks every ${sec} s · morning briefing at ${hour}:00`,
				desc: "Checks Google mail and calendar with zele: new mail goes to a thread in the mail channel, upcoming events become notifications, and a daily briefing arrives in the morning. Promotional and notification mail is filtered out.",
				on: (retry: string) => `On (rechecks every ${retry} if there is no account)`, missing: "Not applicable (not installed on this computer)",
			},
			gateway: {
				label: "Gateway", summary: "Merge messages · handle commands · deliver replies",
				desc: (after: string) => `The door every input goes through. Consecutive messages in the same channel are merged into one; commands like /model and /restart and the \"limits\" question are answered directly without waking the orchestrator. Replies go back to the channel that asked; while the work runs the owner sees 👀, typing and, after ${after}, one progress message edited in place, and the answer goes out only when it is complete. Messages left unanswered at a restart are handled again.`,
				merge: "Merge window", mergeValue: (ms: number, max: string) => `${ms}ms (up to ${max})`, direct: "Answered directly", directValue: `/commands, "limits"`,
				route: "Reply route", routeValue: "The channel the question came from (Discord, web, terminal)", restart: "Restart", restartValue: (wait: string) => `After all work is done, restarts with the new code (a notice if the wait passes ${wait})`,
			},
			orchestrator: {
				label: (name: string) => `Orchestrator (${name})`,
				desc: (h: string, retries: number, restarts: number, window: string) => `The always-on assistant that receives every message (one ${h} conversation). It does light work itself and hands longer work to projects and sessions. When a usage limit hits, it holds messages and handles them in order right after the reset; server errors are retried up to ${retries} times. If it dies it is restarted automatically (up to ${restarts} times in ${window}), and when the conversation grows long it moves to a new conversation with a handover.`,
				context: "Context", resumes: "Resumes at", cache: "Cache keep-alive", cacheValue: (from: number, to: number, max: number) => `One ping at ${from}-${to} minutes while idle (up to ${max})`, cacheNa: "Not applicable (this runtime does not use it)",
				startPrompt: "Start prompt", startPromptValue: "Behaviour rules + identity + my rules + lessons + work-channel summary",
			},
			mode: {
				label: "Behaviour rules (MODE)", summary: (file: string) => `${file} · read-only`,
				desc: "The base contract that decides how the orchestrator and sessions work. It ships with the repository, so it is read-only here.",
				file: "File in use", language: "Language",
			},
			identity: {
				label: "Identity", summary: (name: string, language: string) => `Name ${name} · reply language ${language}`,
				desc: "Name, character and tone. If IDENTITY.md exists its content goes into the start prompt, otherwise the character and tone from settings do. The reply language is also the reference for the output-language check.",
			},
			rules: {
				label: "My rules (RULES)", summary: (n: number) => `Rules file · blocked commands: ${n}`,
				desc: "The standing rules and prohibitions I set. They take precedence over the behaviour rules and sessions read them too. Lines under \"Blocked commands\" are blocked before the orchestrator, sessions and subagents run them.",
				blocked: "Blocked commands",
			},
			lessons: {
				label: "Lessons (LESSONS)", summary: "Notes built by the nightly review",
				desc: "Notes the orchestrator tidies itself in the nightly review. My rules always win. You can edit or delete them.",
			},
			lanes: {
				label: "Sessions", summary: (n: number, working: number, max: number) => `${n} · ${working} working · up to ${max} at once`, none: (max: number) => `None · up to ${max} at once`,
				desc: (restarts: number, window: string) => `Independent jobs that take on small and medium work, one goal each (one session per channel). In a git repository each session works in its own worktree and branch, so my working folder is untouched, and it is cleaned up once merged. Each start applies the subagent model and the auto-compaction threshold. A stopped session is restarted automatically (up to ${restarts} times in ${window}).`,
				lanes: "Sessions", lanesValue: (n: number, working: number) => `${n} (${working} working)`, workDir: "Work folder", workDirValue: "In a git repository, a worktree just for the session",
				compaction: "Compaction", compactionValue: (tokens: string) => `Automatic at ${tokens} tokens of context`,
			},
			workers: {
				label: "Subagents", running: (n: number) => ` · ${n} running`,
				desc: "Hands that sessions split implementation, testing and exploration across. A session plans and reviews with its own model while subagents run in parallel on a cheaper one. How writing subagents are isolated is under Isolation.",
				kinds: "Kinds", kindsValue: (omo: boolean) => (omo ? "task categories (implement, test), explore and librarian (look up)" : "task (implement, test, render), scout (explore)"), limit: "Concurrency limit", limitValue: (n: number) => `${n} per session (based on this computer's specs)`,
				runningFact: "Running", isolation: "Isolation", isolationValue: (on: boolean) => (on ? "Writing subagents: isolated copy + patch applied after review (in place outside a git repository)" : "Not enforced (the work guard is off)"),
				expensive: "Expensive model", expensiveValue: (models: string) => `${models} only when I ask for it myself`,
			},
			outlang: {
				label: "Output language check", summary: (language: string) => `Rewritten and sent if not in ${language}`,
				desc: "If text going to me differs from the identity language (e.g. leaked while thinking in English), it is translated with one call to a small model. Language detection is local, so it is free, and if it fails the original goes out as is.",
				reference: "Reference language",
			},
			update: {
				label: "Harness update", install: "automatic install", check: "new versions only", na: (h: string) => `Not applicable · the runtime is ${h}`,
				desc: "Checks nightly whether the harness (OmO or omp) has a new version. With 'automatic install' (the default) it installs and restarts the gateway when everything is idle; 'new versions only' just tells the work-log channel.",
			},
			audit: {
				label: "Token usage audit",
				desc: "Scans OmO and omp conversation records daily for waste, such as a cache that broke for no reason or a conversation with an abnormally large context. If something is off, it tells the alert channel.",
			},
			reflect: {
				label: "Nightly review", summary: (when: string) => `${when} · lessons tidy-up + backup`,
				desc: "Each night it summarizes the previous day's conversations for the orchestrator to look back on and has it write what it learned to the lessons file. Before that it leaves a git snapshot of the settings folder. Quiet days are skipped.",
			},
			backup: {
				label: "Backup", remote: "Snapshot + external repository", local: "Snapshot on this computer only",
				desc: "Snapshots settings, rules and lessons with git every night. If you enter a repository address it also uploads them, but nothing is uploaded if even one file looks like a secret.",
				external: "External repository", credentialed: "Set (contains credentials)", credentialedHint: "Contains credentials, so it cannot be changed from this screen",
			},
			providers: {
				label: "Providers and limits", summary: (n: number, low: number | undefined) => (low === undefined ? `${n} in use` : `${n} in use · lowest limit ${low}% left`),
				desc: (hours: number, margin: number, est: number) => `Login/keys and usage for model providers (Anthropic etc.). Before starting a session it looks at the ${hours}-hour limit and asks first if less than ${margin}% would remain after this work's share (default ${est}%). The weekly limit is shown only.`,
				used: "Providers in use", remaining: (pct: number) => `${pct}% left`,
			},
			hygiene: {
				label: "Session nightly cleanup", summary: (when: string) => `${when} · compact and rotate long sessions`,
				desc: (every: string) => `At a set time each day it checks idle sessions: if the conversation file is big it moves to a new conversation (handover), and if the context is big it compacts. Sessions that were working are left alone. It also deletes leftover temporary folders of finished subagents every ${every}.`,
			},
			memguard: {
				label: "Memory guard", summary: (gb: number) => `Restarts above ${gb} GB per process`,
				desc: (every: string, max: number, window: string) => `Every ${every} it checks the memory of the orchestrator and session processes and restarts them on the same conversation when over the limit (it stops a stray grep from eating tens of GB). If that happens more than ${max} times in ${window} it only sends an alert and stops.`,
			},
			guard: {
				label: (h: string) => `Work guard (${h})`, summary: "Checks briefs, patches, budget and external commands", missing: "Not loaded",
				desc: (h: string, file: string) => `The subagent guard ${h} loads (${file}). It enforces the rules below when a subagent is called and while it runs. Read-only here.`,
				expensiveOff: "Off (config.json guard.ask_before_expensive is not on)",
				installed: "Installed", notInstalled: "Not installed (the rules are not enforced)",
				briefing: "Briefing", briefingValue: (chars: number, lines: number, answer: number) => `Done-when required · ${chars}-character and ${lines}-line code limits · answers within ${answer} characters`,
				patch: "Patches", patchValue: "Writing subagents isolated + patch must be read before it can be applied",
				budget: "Budget", budgetValue: (hours: number, margin: number) => `Blocks and asks permission if under ${margin}% of the ${hours}-hour limit would remain`, budgetOff: "Off (config.json guard.budget_gate)",
				expensive: "Expensive model", expensiveValue: (models: string) => `${models} only when I ask`,
				external: "External commands", externalValue: "Subagents cannot push, deploy, ssh or send externally, and hand them back",
				context: "Context", contextValue: (wrap: number, stop: number) => `Subagent compaction no. ${wrap}: nudge to wrap up, no. ${stop}: block tools`,
				blocked: "Blocked commands in my rules",
			},
		},
		edges: {
			discord: "Message", web: "Chat", terminal: "Terminal input", schedule: "Scheduled time", watch: "Change detected", mail: "New mail and events",
			batch: "Passed on merged", delegate: "Delegate work", parallel: "Parallel run", mode: "Behaviour rules", identity: "Name and tone", rules: "My rules", rulesLanes: "Sessions read it too",
			lessons: "Lessons", lessonsWrite: "Write lessons", snapshot: "Snapshot", review: "Review request", outlang: "Reply language check", update: "New version notice", audit: "Waste alert",
			providers: "Model and limits", budget: "Budget gate", hygiene: "Nightly cleanup", memguard: "Memory monitoring", guard: "Enforce rules",
		},
		// The per-project maps (hub/harnessprojects.ts): one lane tied to a work or home channel.
		project: {
			channelKind: { work: "Work channel", home: "Home channel", thread: "Session thread" } as Record<string, string>,
			edgeIn: "Message", edgeFiles: "Read as instructions", edgeFeatures: "Applies here",
			globalNote: "This is a global setting. Change it on the main map; it is not set per project.",
			fallbackStep: (model: string, when?: string, cap?: string, revert?: string) => `${model}${when ? ` when ${when}` : ""}${cap ? ` · cap ${cap}` : ""}${revert ? ` · revert ${revert}` : ""}`,
			channel: {
				summary: (kind: string, purpose: string) => (purpose ? `${kind} · ${purpose}` : kind),
				desc: "A channel this project's session answers in. Messages written here reach the session's project with this channel's context.",
				kind: "Kind", purpose: "Purpose", logins: "Kept logins", monitors: "Monitors", standing: "Standing behaviour", terms: { none: "no limit", once: "once", task: "this task", lapsed: "ended" }, until: (t: string) => `until ${t}`, updated: "Setup updated", noSetup: "No setup for this channel yet",
			},
			lane: {
				label: (name: string) => `Session ${name}`,
				desc: "The session that works on this project. Its model, effort and runtime can differ from the global session defaults; the settings below show which ones do.",
				state: "State", cwd: "Folder", repo: "Repository", thread: "Thread", runtime: "Runtime", fallback: "Fallback chain", none: "None",
			},
			workers: {
				label: (name: string) => `Subagents (${name})`,
				desc: "The task subagents this session starts. Their model and effort can differ from the global subagent defaults.",
				fallback: "Fallback chain", model: "Model", effort: "Effort",
			},
			files: { desc: "A project instruction file found in the session's folder. Only its name, size, modified time and first heading are shown.", size: "Size", modified: "Last modified", heading: "First heading", bytes: (n: string) => `${n} bytes`, folder: "Folder" },
			features: {
				label: "Project features", summary: (n: number) => `${n} item${n === 1 ? "" : "s"}`, none: "Nothing project-only found",
				desc: "Skills kept in the project folder and monitoring tied to this project's channels. They apply only here.",
				skill: "Skill", watch: "Monitoring", watchValue: (every: number, on: string) => `every ${every} min · on ${on}`,
			},
			deny: { label: "Project blocked commands", summary: (n: number) => `${n} line${n === 1 ? "" : "s"}`, desc: "'- deny:' lines under '## Blocked commands' in the project's instruction files. They are written for this project only." },
			settings: {
				model: { label: "Session model", hint: "Applies at once; a running session restarts on the new model" },
				effort: { label: "Session effort" },
				workerModel: { label: "Subagent model", hint: "Applies to subagents this session starts next" },
				workerEffort: { label: "Subagent effort" },
				runtime: { label: "Runtime", hint: "Applies the next time the session starts" },
			},
		},
	},
	// Texts the gateway sends to the web onboarding (firstrun/setup-*.ts): job rows, owner steps, errors. {name} marks a value filled in on the server.
	setup: {
		jobs: { "install-omo": "Install OmO", "aside-app": "Install the Aside app", "aside-cli": "Install the Aside CLI", tailscale: "Install Tailscale", zele: "Install the mail and calendar tool (zele)", "tailscale-start": "Open Tailscale", permissions: "macOS permissions", apply: "Save and apply" },
		terms: { "aside-login": "Aside sign-in", "zele-login": "Connect a mail and calendar account", "claude-login": "Claude Code sign-in", "omp-login": "omp sign-in" },
		states: { done: "Done", skipped: "Not needed on this computer, skipped", failed: "Could not finish", running: "Working on it" },
		steps: { secrets: "Saving secrets", tailnet: "Opening the web app on Tailscale", config: "Writing settings and identity", plugin: "Linked the omp plugin", permissions: "Checking macOS permissions", discord: "Setting up the Discord bot", finish: "Finishing up" },
		owner: {
			noBrew: "Homebrew is missing. Install it from brew.sh, then try again.",
			sudo: "This needs your computer password, so it cannot finish here. Run {name} yourself in a terminal.",
			asideDownload: "Download and install the Aside app from aside.com/download.",
			tailscaleDownload: "Download and install Tailscale from tailscale.com/download.",
			tailscaleUp: "Run sudo tailscale up in a terminal and sign in.",
			tailscaleLogin: "Sign in in the Tailscale window that opened, then press this again.",
			discord2fa: "Approve the Discord two-step verification request on your phone.",
			missing: "{name} is not installed yet. Install it first.",
		},
		notes: { stayLocal: "Could not open the web app on Tailscale, so it stays on this computer only. {name}", planned: "{name}" },
		errors: { unknownJob: "Unknown job", unknownTerm: "Unknown sign-in", termBody: "This request may only carry a size (cols, rows)", termNotRunning: "The terminal is not running", badSecret: "That secret cannot be saved", badDraft: "Check the values you entered", applyFailed: "Could not apply. {name}", busy: "Already running" },
		// The screens of the web onboarding (web/setup/setup.js); {name}, {n}, {url}, {guild}, {bot}, {v} are filled in by the page.
		ui: {
			wait: "Checking this computer",
			steps: { harness: "Work program", tools: "Tools", bot: "Bot", discord: "Discord", web: "Web app", review: "Review" },
			titles: { start: "Let's set up dotz", harness: "Pick the work program your bot uses", tools: "Get the tools your bot uses", bot: "Introduce your bot", discord: "Connect Discord", web: "Set up the web app", review: "Set it up like this?", applying: "Setting things up", done: "{name} is ready" },
			sups: { start: "What is already ready is skipped; you are only asked for the rest.", harness: "The bot and its sessions work through this program.", tools: "Only what is missing gets installed. Anything you skip here can be done later in Settings.", bot: "It talks like this on Discord, the web and the terminal.", discord: "Lets you talk to it from Discord when you are away.", web: "", review: "", applying: "Keep this page open until it finishes." },
			nav: "Onboarding steps", next: "Next", back: "Back", close: "Close", fix: "Change", later: "Later", retry: "Try again", install: "Install", login: "Sign in", connect: "Connect", running: "Running", ready: "Ready", yourTurn: "Your turn",
			start: { found: "Found on this computer", installed: "Installed", missing: "Not installed", asideMissing: "The app or the command is missing", signedInAs: "Signed in as {name}", notSignedIn: "Not signed in", noAccounts: "No account connected", language: "Language", languageHint: "Language for the screens and the bot", go: "Get started" },
			harness: { noAdapter: "dotz cannot use this one yet", defaultTag: "default", notInstalled: "Not installed", installOwn: "Install {name} in a terminal first, then reload this page.", loginTitle: "Sign in to {name}", loginSupOmo: "The bot works with this account", loginSupTerm: "You sign in inside a terminal window", accounts: "{n} account(s) connected" },
			tools: { secAside: "Aside browser", secMail: "Mail and calendar", asideApp: "Aside app", asideAppSup: "Keeps logins and does web work", asideCli: "Aside command", asideCliSup: "Used when the bot drives the browser", asideLogin: "Aside sign-in", asideLoginSup: "Approve the code in the app", tsSup: "Lets you open the web app from your phone", tsLogin: "Tailscale sign-in", tsLoginSup: "Sign in in the window that opens", zeleSup: "The tool that reads mail and calendars", mailTitle: "Connect mail and calendar accounts", mailSup: "Google, Outlook, or IMAP such as Naver", needFirst: "Finish the install above first" },
			bot: {
				name: "Name", namePh: "Lumi, Momo, Assistant", nameHint: "2 to 32 characters. The Discord bot and its category use this name too.", character: "Character", tone: "Way of talking", notices: "Style of work logs and notices", custom: "Write my own", customPh: "Write it however you like", later: "You can change these later in a chat.",
				address: "What the bot calls you", addressPh: "boss, a name", addressHint: "Leave it empty and the bot uses no form of address.", avatar: "Profile image", avatarPh: "/Users/me/Pictures/bot.png", avatarHint: "The path of a png or jpg file. Leave it empty to start without an image.",
				// v is the text kept in the identity; t and s are what the page shows.
				opts: {
					character: [
						{ t: "A calm, dependable personal assistant", s: "Gives the result first and asks only what it needs", v: "A calm, dependable personal assistant. Gives the result first and asks only what it needs." },
						{ t: "A playful but reliable helper, like a friend", s: "Light in tone, exact on facts", v: "A playful but reliable helper, like a friend. Light in tone, exact on facts." },
						{ t: "A careful engineer", s: "Checks evidence first and says so when unsure", v: "A careful engineer. Checks evidence and verification first, and says so when unsure." },
					],
					tone: [
						{ t: "Relaxed and conversational", s: "Checked it. Tomorrow's meeting moved to 11, so I moved the event too.", v: "Relaxed, conversational English. Answers right after what was said in natural sentences, with no fixed openers or 'one-line conclusion + bullets' template. Lists only for reports and choices. Concrete evidence and numbers. No emoji (e.g. \"Checked it. Tomorrow's meeting moved from 10 to 11, so I moved the event too.\")" },
						{ t: "Casual and short", s: "Yep, done. Sent the mail too.", v: "Casual, friendly and short (e.g. \"Yep, done. Sent the mail too\")" },
						{ t: "Polite and brief", s: "Done. The mail is sent too.", v: "Polite and brief (e.g. \"Done. The mail is sent too\")" },
						{ t: "Formal", s: "Completed. The mail has also been sent.", v: "Formal and courteous (e.g. \"Completed. The mail has also been sent\")" },
					],
					notices: [
						{ t: "Everyday", s: "Sorted the files. Nothing missing, nothing left.", v: "Everyday: normal speech, the relevant facts in a few words (e.g. \"Sorted the files. Nothing missing, nothing left.\")" },
						{ t: "Brief", s: "Finished sorting the files. No file is missing.", v: "Brief: plain statements, one fact per sentence, no filler (e.g. \"Finished sorting the files. No file is missing. Nothing is left.\")" },
						{ t: "STE 80%", s: "File sorting is complete. No file is missing.", v: "STE 80%: ASD-STE100 rules (short sentences, active voice, fixed terms, numbered steps for procedures) at 80% strength, formal register. The strength can be changed, for example 'STE 100%' (e.g. \"File sorting is complete. No file is missing. No work is left.\")" },
					],
				},
			},
			discord: { offTitle: "Using it without Discord", offSup: "You can use the web and the terminal. Connect Discord later in Settings.", turnOn: "Turn back on", tokenSaved: "The bot token is saved", replace: "Replace", token: "Bot token", tokenHint: "It is not kept on screen or in any log. It goes straight to the secret store.", guild: "Server ID", idPh: "17 to 20 digits", guildHint: "In Discord, turn on Settings > Advanced > Developer Mode, then right-click the server name and choose Copy ID. Leave it empty to skip Discord.", owner: "My Discord ID", ownerHint: "Only this account's words are taken as commands. Right-click your profile and copy the ID.", bot: "Bot", botHow: "How should the bot be made?", tokenSup: "Paste a token you made in the developer portal", autoSup: "Aside makes it. You only approve the two-step verification", auto: "Automatic", tokenWord: "Token", skip: "Skip Discord" },
			web: { peerSaved: "The shared key is saved", peer: "Shared key", peerHint: "Paste the shared key of your other computer. Leave it empty the first time.", machine: "Name of this computer", machineHint: "Shown under this name in the web app's list of computers.", logins: "Tailscale logins that may come in", loginsHint: "Separate several with commas. Empty means this computer only.", peerMore: "Use with other computers", advanced: "Ports and models", webPort: "Local port", tsPort: "Tailnet port", botModel: "Bot model", laneModel: "Session model", default: "Default" },
			review: { harness: "Work program", tools: "Tools", bot: "Bot", web: "Web app", loggedIn: " · signed in", loginLater: " · sign in later", laterWord: "later", noName: "No name", discordSum: "Server {guild} · bot {bot}", botTokenWord: "pasted token", botAutoWord: "made automatically", noDiscord: "Not used", onlyHere: "This computer only", go: "Set it up" },
			errors: { harness: "Install the work program you picked before going on", name: "Give the bot a name of 2 to 32 characters", guild: "The server ID is 17 to 20 digits", owner: "Your Discord ID is 17 to 20 digits", token: "Paste the bot token", peer: "The shared key needs 16 or more characters and no spaces", port: "A port is a number from 1 to 65535", waitJob: "You can go on when the running job finishes", closed: "The setup is finished or the address expired. Get a new one in a terminal with bun setup.ts --web-link." },
			term: { lib: "Could not load the terminal component", sub: "A window that runs one fixed command. It tells you when it ends.", starting: "Opening", live: "Connected", done: "Finished. You can close this.", lost: "The connection dropped" },
			loginSheet: { title: "Claude subscription sign-in", intro: "Sign in in the new tab, then paste the code it gives you.", open: "Open the sign-in page", code: "Code or address", go: "Done", empty: "Paste the code or address", fail: "Sign-in failed" },
			done: { here: "This computer", open: "Open", phone: "Phone or another computer", phoneSup: "{url} · sign in with the same Tailscale account", connected: "Connected", discordSup: "Talk to {name} in the chat channel of its category", openApp: "Open the web app", opening: "Opening the web app" },
		},
	},
	// Refusals of the routes the web calls (status codes and the `error` field stay; only the words follow the install language).
	refuse: { mailNotReady: "mail is not ready in this process yet", mailOff: "mail is turned off on this install", queueGone: "it was already delivered, so it can no longer be cancelled or sent now", subagentGone: "that subagent was not found; finished ones are kept for 10 minutes" },
	sendFail: { login: "the mail login expired; sign in again", offline: "could not reach the mail service", other: "the mail tool reported an error (details are in the log)" },
	cmdError: {
		unknownTarget: (x: string) => `"${x}" is not a lane or target. Write the target first: /model <target> <model>, /effort <target> <level>; /lanes lists the lanes`,
		noLane: (x: string) => `There is no lane named "${x}"; /lanes lists them`,
		unknownModel: (x: string) => `No model matches "${x}"; /model lists them`,
		thinking: (x: string) => `The effort level is one of: ${x}`,
		usage: (x: string) => `Write it like this: ${x}`,
		unknownCommand: (x: string) => `"${x}" is not a command; /help lists them`,
		other: "The command failed. The details are in the log",
	},
};
export type Catalog = typeof en;
