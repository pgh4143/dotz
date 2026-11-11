import { expect, test } from "bun:test";
import { scheduleKindRefusal } from "./schedule-tool.ts";

test("an add without a valid kind is refused with both kinds explained; other calls and valid kinds go on", () => {
	for (const kind of [undefined, "", "quiet"]) expect(scheduleKindRefusal({ action: "add", kind })).toMatch(/owner.*check/s);
	expect(scheduleKindRefusal({ action: "add", kind: "owner" })).toBeUndefined();
	expect(scheduleKindRefusal({ action: "add", kind: "check" })).toBeUndefined();
	expect(scheduleKindRefusal({ action: "list" })).toBeUndefined();
	expect(scheduleKindRefusal({ action: "remove" })).toBeUndefined();
});
