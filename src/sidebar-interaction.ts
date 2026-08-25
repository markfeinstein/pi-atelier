export type SidebarAction = { type: "toggle-tool-names" } | { type: "toggle-panel-body"; panelId: string };

export interface SidebarHitRegion {
	action: SidebarAction;
	x1: number;
	x2: number;
	y1: number;
	y2: number;
	enabled: boolean;
}

export interface SidebarFrame {
	lines: string[];
	hitRegions: readonly SidebarHitRegion[];
}

export function sameSidebarAction(
	left: SidebarAction | undefined,
	right: SidebarAction | undefined,
): boolean {
	if (!left || !right || left.type !== right.type) return false;
	if (left.type === "toggle-panel-body" && right.type === "toggle-panel-body") {
		return left.panelId === right.panelId;
	}
	return true;
}
