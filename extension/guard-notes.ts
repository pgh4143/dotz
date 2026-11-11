// Notes the guard hands to the parent session: the call rules at session start and the trail of a worker that was cut.
import { closeSync, existsSync, fstatSync, openSync, readdirSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { GuardConfig } from "./guard-config.ts";

export { expandCellVars, readPaths } from "./patch-reads.ts";

// What the guard refuses, said once at session start: a refused call costs a full re-read of the context, so the first call follows the rule.
export const callRules = (g: GuardConfig): string =>
	`[orchestrator-guard] Call rules (a refused call is not run): a worker brief (task) has a line starting "Done when:" or "Acceptance:" with a check that can fail, stays under ${g.max_brief_chars} chars and pastes no code block over ${g.max_fence_lines} lines (give paths) and no line that stops or pauses work at a low usage limit (the gateway handles a real limit; only \`Owner words: "…"\` passes); \`git apply <x>.patch\` runs only after that patch was read with the read tool on the same path, or read('<path>') in an eval cell.`;

// What a parent needs to continue a worker that was cut (its process died with the previous session; a message to it cannot revive it):
// OmO keeps the worker's session at <projects>/<repo>/senpi-task/children/<id>/sessions/<id>/*.jsonl (its first user message is the brief)
// and a retained change at <projects>/<repo>/senpi-task/isolation/<id>/root.patch. The last step is read from the file's tail.
export const OMO_PROJECTS = join(homedir(), ".omo", "agent", "projects");
export function workerTrail(id: string, projects = OMO_PROJECTS): string {
	let session: string | undefined;
	let patch: string | undefined;
	try {
		for (const repo of readdirSync(projects)) {
			const kids = join(projects, repo, "senpi-task", "children", id, "sessions", id);
			if (!session && existsSync(kids)) {
				const file = readdirSync(kids).filter(f => f.endsWith(".jsonl")).sort().at(-1);
				if (file) session = join(kids, file);
			}
			const retained = join(projects, repo, "senpi-task", "isolation", id, "root.patch");
			if (!patch && existsSync(retained)) patch = retained;
		}
	} catch {
		/* no OmO projects folder: the trail below says so */
	}
	let last = "";
	if (session) {
		try {
			const fd = openSync(session, "r");
			const size = fstatSync(fd).size;
			const buf = Buffer.alloc(Math.min(size, 65_536));
			readSync(fd, buf, 0, buf.length, size - buf.length);
			closeSync(fd);
			for (const row of buf.toString("utf8").split("\n").reverse()) {
				let event: any;
				try {
					event = JSON.parse(row);
				} catch {
					continue; // a torn first or last line
				}
				const m = event?.message;
				if (m?.role !== "assistant" || !Array.isArray(m.content)) continue;
				const text = m.content.find((b: any) => b?.type === "text" && b.text?.trim())?.text?.trim().replace(/\s+/g, " ").slice(0, 160);
				const call = m.content.filter((b: any) => b?.type === "toolCall").at(-1);
				const time = String(event.timestamp ?? "").slice(11, 16);
				last = `${time} ${[text, call ? `then ${call.name} ${JSON.stringify(call.arguments ?? {}).slice(0, 100)}` : ""].filter(Boolean).join(" ")}`;
				break;
			}
		} catch {
			/* unreadable: the file path alone still lets the parent open it */
		}
	}
	const parts = [session ? `session file ${session} (first user message = its brief)` : "no session file found", last ? `last step: ${last}` : "", patch ? `kept change: ${patch}` : "no kept change (check git status in the worker's checkout)"];
	return `${parts.filter(Boolean).join("; ")}. To continue: spawn a new worker whose brief carries the original Done when: line and says "continue from <session file>: read its end for what is done, do not redo it"`;
}
