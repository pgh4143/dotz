// The 프로젝트 list's computer groups (docs/customization.md, Projects by computer): pure shapes and grouping, no network.
import type { Project } from "./custom.ts";

export type RemoteProject = { key: string; name: string; note?: string };
// One other computer as GET /api/custom/computers sees it: offline, online with its projects, or online without them (an older gateway, no token).
export type PeerProjects = { name: string; url: string; online: boolean; projects?: RemoteProject[] };

// The sidebar's computer groups (GET /api/custom/computers): this computer first, then the others by name. A pin that names another
// computer joins that computer's group; a peer adds its own projects (`remote`). One group means no headers in the sidebar.
export type ComputerGroup = { name: string; self: boolean; url?: string; online?: boolean; keys: string[]; remote: RemoteProject[] };
export function computerGroups(self: string, projects: Project[], peers: PeerProjects[]): ComputerGroup[] {
	const me: ComputerGroup = { name: self, self: true, online: true, keys: [], remote: [] };
	const others = new Map<string, ComputerGroup>();
	const other = (name: string) => others.get(name) ?? others.set(name, { name, self: false, keys: [], remote: [] }).get(name)!;
	for (const p of projects) if (!p.builtin) (!p.computer || p.computer === self ? me : other(p.computer)).keys.push(p.key);
	for (const peer of peers) {
		if (peer.name === self) continue; // never mixed into this computer's own list
		const g = other(peer.name);
		g.url = peer.url;
		g.online = peer.online;
		g.remote = peer.online ? (peer.projects ?? []) : [];
	}
	return [me, ...[...others.values()].sort((a, b) => a.name.localeCompare(b.name, "ko", { numeric: true }))];
}
