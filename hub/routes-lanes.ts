// HTTP routes of the work channels, watches, schedules and lanes (the last part of the route chain). Split out of main.ts.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, log, NAME, now, paths } from "./config.ts";
import { deferForLimit, limitWaitStarted } from "./limitwait.ts";
import * as discord from "./discord.ts";
import { emit } from "./events.ts";
import { deleteLanes, restoreLanes as restoreTrashedLanes, trashList } from "./lanetrash.ts";
import { abortLane, BUDGET_WINDOW_HOURS, budgetLine, budgetVerdict, estimateOf, handoverLane, isExpensive, laneJustification, lanes, laneList, launch, restartLane, resumeByName, sendToLane, stopLane, titleProblem, verifyLane } from "./lanes.ts";
import { anthropicUsage } from "./providers.ts";
import { keepHome, persist } from "./lanestate.ts";
import { closeLaneCards, laneVerified } from "./notices.ts";
import { convs } from "./convsessions.ts";
import { MAIN } from "./session-key.ts";
import { doneProblem } from "./donesignals.ts";
import { stripHandoff } from "./tone.ts";
import { answerMovesToLane, lanePlace, startedIn } from "./threads.ts";
import { addSchedule, checksSharingSlot, listSchedules, patchSchedule, removeSchedule } from "./schedule.ts";
import { clearChannel, endStanding, listSetups, setupChannel, standingLabelKo } from "./workchannels.ts";
import { readWatchSettings, writeWatchSettings } from "./watch-settings.ts";
import { readScheduleSettings, writeScheduleSettings } from "./schedule-settings.ts";
import { addWatch, allWatches, approveWatch, listWatches, patchWatch, putWatchScript, removeWatch, runWatch, watchScript } from "./watch.ts";
import { queue, out, progress } from "./outbound.ts";
import { postSettings } from "./discord-post.ts";
import { json, body } from "./routes-util.ts";

// Lanes are the expensive work, and the omp budget gate only sees task-tool workers, so lane launches check the quota here.
// Every decision (go / blocked / forced / unknown) leaves exactly one hub.log line.
// A refusal carries the 5h window's reset time when the usage report has it (the deferred work's resume_at).
export async function budgetProblem(name: string, est: number, force: boolean): Promise<{ text: string; resetAt?: number } | undefined> {
	if (force) {
		log(budgetLine(name, est, undefined, undefined, "forced"));
		return undefined;
	}
	// The account lanes really run on (OmO's pinned account may not be omp's login).
	const r = await anthropicUsage("lane").catch(() => undefined);
	const fiveLimit = r?.limits.find(l => l.id === `anthropic:${BUDGET_WINDOW_HOURS}h`);
	const five = fiveLimit?.amount.remaining;
	const week = r?.limits.find(l => l.id === "anthropic:7d")?.amount.remaining;
	// The 5h window gates (est % assumed use, default 15, and 10% kept); the week is shown, never gates.
	const verdict = budgetVerdict(five, week, est);
	log(`${budgetLine(name, est, five, week, verdict ? "blocked" : typeof five === "number" ? "go" : "unknown")} (account ${r?.account ?? "?"}${r?.problem ? `, ${r.problem}` : ""})`);
	if (!verdict) return undefined;
	return { text: r ? `${verdict} (account ${r.account})` : verdict, resetAt: fiveLimit?.window.resetsAt };
}
const STATE_FILE = () => join(DATA_DIR, "state.json");

const readLastReport = (name: string): string => {
	try {
		return stripHandoff(readFileSync(join(paths.lanes, name, "report.md"), "utf8"));
	} catch {
		return "";
	}
};

export async function routeLanes(req: Request, url: URL, parts: string[]): Promise<Response | undefined> {
	if (parts[0] === "api" && parts[1] === "channels") {
		try {
			if (req.method === "GET") return json({ work_channels: Object.entries(discord.channels.work).map(([id, name]) => ({ channel: `ch:${id}`, name })), setups: listSetups() });
			if (req.method === "POST" && parts[2] === "create") {
				const wanted = String((await body(req)).name ?? "");
				const plain = titleProblem(wanted);
				if (plain) return json({ error: plain.replace(/^title/, "channel name") }, 409);
				const c = await discord.createWorkChannel(wanted);
				return json({ ok: true, channel: `ch:${c.id}`, name: c.name });
			}
			if (req.method === "POST" && parts[2] === "thread_status") {
				const b = await body(req);
				const state = String(b.status);
				if (state !== "working" && state !== "waiting" && state !== "done") return json({ error: "status must be working, waiting or done" }, 400);
				const name = await discord.threadStatus(String(b.thread ?? ""), state);
				const parent = state === "done" ? discord.threadInfo(String(b.thread).replace(/^th:/, ""))?.parentTarget : undefined;
				if (parent?.startsWith("ch:")) endStanding(parent, "task");
				return json({ ok: true, name });
			}
			if (req.method === "POST" && parts[2] === "thread") {
				const b = await body(req);
				// The first paragraph is the parent-channel message the thread hangs from; the rest goes inside the thread.
				const text = String(b.text ?? "").trim();
				const cut = text.indexOf("\n\n");
				const starter = cut < 0 ? text : text.slice(0, cut);
				const rest = cut < 0 ? "" : text.slice(cut + 2).trim();
				const t = await discord.createThread(String(b.channel ?? "chat"), String(b.name ?? "").trim(), starter || undefined);
				if (rest) await out(`th:${t.id}`, rest, undefined, { source: "orchestrator" });
				return json({ ok: true, thread: `th:${t.id}`, name: t.name });
			}
			if (req.method === "POST" && parts[2] === "setup") {
				const b = await body(req);
				const id = String(b.channel ?? "").replace(/^ch:/, "");
				const name = discord.channels.work[id];
				if (!name) return json({ error: `ch:${id} is not a work channel (only channels under the ${NAME} category)` }, 400);
				const setup = setupChannel(b, name, existsSync(paths.rules) ? readFileSync(paths.rules, "utf8") : "");
				const kept = [setup.logins.length ? `로그인 유지: ${setup.logins.join(", ")}` : "", setup.monitors.length ? `모니터링 ${setup.monitors.length}개` : "", setup.standing ? `자동 처리: ${setup.standing} (${standingLabelKo(setup)})` : ""].filter(Boolean).join(" · ");
				void out(`ch:${id}`, `이 채널 자동 관리: ${setup.purpose}${kept ? `\n${kept}` : ""}`, undefined, { source: "gateway" }).catch(e => log(`setup note failed: ${e}`));
				return json({ ok: true, setup });
			}
			if (req.method === "DELETE" && parts[2]) return json({ ok: clearChannel(parts[2]) });
		} catch (error) {
			return json({ error: (error as Error).message }, 400);
		}
	}
	if (parts[0] === "api" && parts[1] === "watches") {
		try {
			if (parts[2] && parts[3] === "script" && parts.length === 4) {
				if (req.method === "GET") return json(watchScript(parts[2]));
				if (req.method === "PUT") return json({ ok: true, ...putWatchScript(parts[2], (await body(req)).text) });
			}
			// A monitor's settings (hub/watch-settings.ts): GET reads, PATCH is the one write path, shared by the switches, a change card and a peer.
			if (parts[2] && parts[3] === "settings" && parts.length === 4 && (req.method === "GET" || req.method === "PATCH")) {
				if (!allWatches().some(w => w.id === parts[2] || w.name === parts[2])) return json({ error: `no watch ${parts[2]}` }, 404);
				return json({ key: `w:${parts[2]}`, fields: req.method === "GET" ? readWatchSettings(parts[2]) : writeWatchSettings(parts[2], (await body(req)).values) });
			}
			if (req.method === "GET") return json(listWatches());
			if (req.method === "POST" && parts[2] && parts[3] === "approve") return json({ ok: true, watch: approveWatch(parts[2]) });
			if (req.method === "PATCH" && parts[2]) return json(patchWatch(parts[2], await body(req)));
			// Run one watch now (the peer action `watch run`, hub/peer-monitor.ts); the round runs behind the request.
			if (req.method === "POST" && parts[2] && parts[3] === "run") {
				if (!allWatches().some(w => w.id === parts[2] || w.name === parts[2])) return json({ error: `no watch ${parts[2]}` }, 404);
				void runWatch(parts[2]).catch(e => log(`watch run failed: ${(e as Error).message}`));
				return json({ ok: true });
			}
			if (req.method === "POST") return json({ ok: true, watch: addWatch(await body(req), existsSync(paths.rules) ? readFileSync(paths.rules, "utf8") : "") });
			if (req.method === "DELETE" && parts[2]) {
				const owned = allWatches().find(w => (w.id === parts[2] || w.name === parts[2]) && w.channels?.length);
				if (owned) return json({ error: `watch ${owned.name} belongs to a work channel setup (${owned.channels!.map(c => `ch:${c}`).join(", ")}); change that setup instead` }, 409);
				return json({ ok: removeWatch(parts[2]) });
			}
		} catch (error) {
			return json({ error: (error as Error).message }, 400);
		}
	}
	if (parts[0] === "api" && parts[1] === "schedules") {
		try {
			// A schedule's settings screen (hub/schedule-settings.ts): the same GET / PATCH shape as a monitor's.
			if (parts[2] && parts[3] === "settings" && parts.length === 4 && (req.method === "GET" || req.method === "PATCH")) {
				if (!listSchedules().some(s => s.id === parts[2])) return json({ error: `no schedule ${parts[2]}` }, 404);
				return json({ key: `s:${parts[2]}`, fields: req.method === "GET" ? readScheduleSettings(parts[2]) : writeScheduleSettings(parts[2], (await body(req)).values) });
			}
			if (req.method === "GET") return json(listSchedules());
			if (req.method === "POST") {
				const schedule = addSchedule(await body(req));
				// A check fires on the :00 / :30 grid: the answer names its slot and the checks it shares the turn with.
				return json({ ok: true, schedule, ...(schedule.kind === "check" ? { slot: schedule.at, shares_turn_with: checksSharingSlot(schedule) } : {}) });
			}
			if (req.method === "PATCH" && parts[2]) return json(patchSchedule(parts[2], await body(req)));
			if (req.method === "DELETE" && parts[2]) return json({ ok: removeSchedule(parts[2]) });
		} catch (error) {
			return json({ error: (error as Error).message }, 400);
		}
	}
	if (parts[0] === "api" && parts[1] === "lanes") {
		try {
			if (req.method === "GET" && parts.length === 2) return json(laneList());
			// Ended lanes only, into the trash (lanetrash.ts); 409 when nothing could be deleted, with the reason per lane.
			if (req.method === "GET" && parts[2] === "trash" && parts.length === 3) return json({ items: trashList() });
			if (req.method === "POST" && (parts[2] === "delete" || parts[2] === "restore") && parts.length === 3) {
				const b = await body(req);
				const given = parts[2] === "delete" ? b.names : b.ids;
				const list = (Array.isArray(given) ? given : []).map(String);
				if (!list.length) return json({ error: parts[2] === "delete" ? "names required" : "ids required" }, 400);
				const results = parts[2] === "delete" ? deleteLanes(list) : restoreTrashedLanes(list);
				const ok = results.some(r => r.ok);
				return json({ ok, results, ...(ok ? {} : { error: results.map(r => (r.ok ? "" : r.error)).join("; ") }) }, ok ? 200 : 409);
			}
			if (req.method === "DELETE" && parts[3] === "data" && parts.length === 4) {
				const [r] = deleteLanes([parts[2]]);
				return r!.ok ? json(r) : json({ error: r!.error }, 409);
			}
			if (req.method === "POST" && parts.length === 2) {
				const b = await body(req);
				const asked = Boolean(b.owner_asked_for_fable);
				const dear = [b.model, b.worker_model].filter(m => m && isExpensive(String(m)));
				if (dear.length && !asked) return json({ error: `Fable and max/xhigh-effort models (${dear.join(", ")}) run only when the owner explicitly asks for them. Use the defaults, or relaunch with owner_asked_for_fable=true after they ask.` }, 409);
				const unjustified = laneJustification(b.why, b.hours, Boolean(b.owner_asked_for_lane));
				if (unjustified) {
					log(`lane ${String(b.name)} refused: ${unjustified}`);
					return json({ error: unjustified }, 409);
				}
				const unchecked = doneProblem(String(b.brief ?? ""), Boolean(b.owner_asked_for_lane));
				if (unchecked) {
					log(`lane ${String(b.name)} refused: ${unchecked}`);
					return json({ error: unchecked }, 409);
				}
				const unnamed = titleProblem(b.title, { key: String(b.name), cwd: String(b.cwd ?? "") });
				if (unnamed) {
					log(`lane ${String(b.name)} refused: ${unnamed}`);
					return json({ error: unnamed }, 409);
				}
				const est = estimateOf(b.est, String(b.brief ?? ""));
				const tight = await budgetProblem(String(b.name), est, Boolean(b.force));
				if (tight) {
					// Unknown reset: the window is at most BUDGET_WINDOW_HOURS long, so that is the latest it can be.
					const resumeAt = new Date(tight.resetAt && tight.resetAt > Date.now() ? tight.resetAt : Date.now() + BUDGET_WINDOW_HOURS * 3600_000).toISOString();
					deferForLimit(STATE_FILE(), String(b.name), String(b.title ?? "").trim(), resumeAt, progress, log);
					return json({ error: `budget gate: ${tight.text}. Ask the owner (now / after reset / smaller); relaunch with force=true only after they say now, or with a smaller est.`, resume_at: resumeAt }, 409);
				}
				const home = b.home ? String(b.home) : undefined;
				if (home && discord.status.enabled) discord.homeChannel(home);
				const asking = queue.current();
				const origin = { home, asking: asking?.target, askingMessage: asking?.replyTo, isWork: (id: string) => Boolean(discord.channels.work[id]), threadParent: (id: string) => discord.channels.threads[id]?.parent };
				const place = lanePlace({ ...origin, discordForWeb: postSettings().web_lanes });
				const lane = launch(String(b.name), String(b.cwd), String(b.brief ?? ""), b.model, b.worker_model ? String(b.worker_model) : undefined, asked, String(b.title).trim(), typeof b.session === "string" && b.session && b.session !== MAIN ? b.session : undefined);
				// Started from the web: it lives in the web (its session conversation, notices and push), with no Discord channel.
				if (place.kind === "web") {
					lane.web = true;
					persist(lane);
				}
				// The goal line of the brief ("목표...: ...") is the thread's starter message in the home channel.
				const goal = /^(?:목표|Goal)[^:：]*[:：]\s*(.+)$/im.exec(String(b.brief ?? ""))?.[1]?.slice(0, 300);
				const starter = goal ? `[run] ${b.title ? String(b.title) : lane.name}: ${goal}` : undefined;
				const channel = await discord.laneChannel(lane.name, b.title ? String(b.title) : undefined, place, starter, goal).catch(e => {
					log(`lane channel failed: ${e}`);
					return undefined;
				});
				// The parent project outlives the channel map: releaseLane drops homes[lane] on stop/end, the lane record keeps it.
				// It is where the lane was started, so a web-only lane or a failed Discord thread keeps it too.
				const parent = discord.channels.homes[lane.name] ?? startedIn(origin);
				if (parent) {
					lane.home = parent;
					const homeName = discord.channels.work[parent];
					if (homeName) lane.homeName = homeName;
					persist(lane);
				}
				// Work started from a work channel or a thread is answered in the lane's thread, where its reports will come.
				if (channel && asking?.target && answerMovesToLane(place, asking.target)) queue.retarget(asking.target, `lane:${lane.name}`);
				log(`lane ${lane.name} why (${b.owner_asked_for_lane ? "owner asked" : `${Number(b.hours)}h`}): ${String(b.why).trim().slice(0, 300)}`);
				limitWaitStarted(STATE_FILE(), lane.name, lane.title ?? "", progress, log);
				emit("outbox", { ts: now(), kind: "lane_start", source: "hub", lane: lane.name, ...(lane.title ? { title: lane.title } : {}), text: `lane ${lane.name} started in ${lane.cwd}` });
				return json({ ok: true, lane: lane.name, channel, ...(lane.waiting ? { waiting: lane.waiting } : {}) });
			}
			if (req.method === "POST" && parts[3] === "send") {
				const b = await body(req);
				sendToLane(parts[2], String(b.text ?? ""));
				// Sent in a turn the owner started, this carries his word to the session: its card waits on him no longer. Any other turn's message leaves it open.
				const turn = (convs.get(String(b.session))?.queue ?? queue).current();
				if (turn?.target && !turn.done) closeLaneCards(parts[2]);
				return json({ ok: true });
			}
			if (req.method === "POST" && parts[3] === "restart") {
				await restartLane(parts[2], undefined, true);
				return json({ ok: true });
			}
			if (req.method === "POST" && parts[3] === "resume") {
				const text = String((await body(req)).text ?? "").trim();
				resumeByName(parts[2], text || undefined);
				return json({ ok: true });
			}
			if (req.method === "POST" && parts[3] === "handover") {
				const text = String((await body(req)).text ?? "").trim();
				handoverLane(parts[2], text || undefined);
				return json({ ok: true });
			}
			if (req.method === "POST" && parts[3] === "verify") {
				const b = await body(req);
				verifyLane(parts[2], String(b.text ?? ""), b.force === true);
				laneVerified(parts[2], readLastReport(parts[2]));
				return json({ ok: true });
			}
			if (req.method === "POST" && parts[3] === "abort") {
				abortLane(parts[2]);
				return json({ ok: true });
			}
			if (req.method === "DELETE" && parts.length === 3) {
				stopLane(parts[2]);
				keepHome(lanes.get(parts[2]), discord.homeOf(parts[2]));
				void discord.releaseLane(parts[2], lanes.get(parts[2])).catch(e => log(`lane ${parts[2]} thread release failed: ${e}`));
				return json({ ok: true });
			}
		} catch (error) {
			return json({ error: (error as Error).message }, 400);
		}
	}
}
