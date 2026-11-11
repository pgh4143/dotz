// A notice as the owner reads it, and the frame the pages are sent. A part of the notice store split out of hub/notices.ts, code unchanged.
import { broadcast as broadcastRaw } from "./events.ts";
import { classOfNotice } from "./notice-class.ts";
import { noticeKo } from "./notice-ko.ts";
import { watchLine, watchReasonKo } from "./watchtext.ts";
import type { Notice } from "./notices-types.ts";
import { laneTitleOf, watchLabelOf } from "./notices-wiring.ts";
import { waitsOf, type Waits } from "./notices-rules.ts";
import { channelTitle, recordedTitle } from "./notices-lanes.ts";
import { worklogKind } from "./worklog-kind.ts";

export const withClass = (n: Notice, shown: Notice = n): Notice & { cls: string; waits?: Waits } => {
	const waits = waitsOf(n);
	return { ...shown, cls: classOfNotice(n).cls, ...(waits ? { waits } : {}), ...(n.kind === "worklog" ? worklogKind({ ...n, update_key: n.key, source: n.by }) : {}) };
};
export const broadcast = (e: Record<string, unknown>): void => broadcastRaw(e.kind === "notice" && e.item && typeof e.item === "object" ? { ...e, item: withClass(e.item as Notice, readable(e.item as Notice)) } : e);
// First three meaningful lines (no blank lines, rules or fences).
export function summary(text: string): string {
	return text
		.split("\n")
		.map(l => l.trim())
		.filter(l => l && !/^(?:[-*_=]{3,}|```.*)$/.test(l))
		.slice(0, 3)
		.map(l => (l.length > 160 ? `${l.slice(0, 159)}…` : l))
		.join("\n");
}

// A notice as the owner reads it (the stored one keeps what the bot wrote): everyday Korean, no tool names, commands, ids or paths (hub/notice-ko.ts).
export const say = (s: string): string => noticeKo(s, { lane: name => laneTitleOf(name)?.trim() || recordedTitle(name), keepFiles: true });
export function readable(n: Notice): Notice {
	const r = readableStored(n);
	const title = say(r.title), text = r.decision?.draft ? r.text : say(r.text);
	return title === r.title && text === r.text ? r : { ...r, title, text };
}
// A watch notice stored before labels and Korean reasons: its title is the watch name and its text starts with the raw reason.
function readableStored(n: Notice): Notice {
	if (n.kind === "message" && n.key?.startsWith("msg:settings:")) {   // stored before settings conversations had a name: titled "대화"
		const title = channelTitle(n.key.slice(4));
		return title === n.title ? n : { ...n, title };
	}
	if (n.kind !== "watch") return n;
	const title = watchLabelOf(n.title);
	const [first = "", ...rest] = n.text.split("\n");
	const named = title !== n.title && n.text.startsWith(`${n.title}:`) ? `${title}${n.text.slice(n.title.length)}` : n.text;
	const text = watchReasonKo(first) !== first ? watchLine(title, first, rest.join("\n"), { raw: false }) : named;
	return title === n.title && text === n.text ? n : { ...n, title, text };
}
