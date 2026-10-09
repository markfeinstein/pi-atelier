import { homedir } from "node:os";
import { basename } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Component, type OverlayHandle, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ThemeLike } from "./footer.js";
import { hasCapturingOverlay } from "./image-compositor.js";
import type { McpServerSummary } from "./mcp-servers.js";
import { aggregateMetrics, formatTokens } from "./metrics.js";
import { type AtelierPalette, createPalette, type PaletteRole } from "./palette.js";
import {
	EMPTY_RUN_ACTIVITY,
	formatDuration,
	type RunActivitySnapshot,
	responsePerformanceValues,
	type ToolActivity,
} from "./run-activity.js";
import { type SidebarAction, type SidebarFrame, type SidebarHitRegion } from "./sidebar-interaction.js";
import {
	BUILTIN_SIDEBAR_PANEL_IDS,
	isSidebarPanelContributionId,
	SIDEBAR_PANEL_MAX_ROW_CHARS,
	SIDEBAR_PANEL_MAX_ROWS,
	SIDEBAR_PANEL_MAX_TITLE_CHARS,
	type SidebarBarSegment,
	type SidebarPanelData,
	type SidebarPanelNode,
	type SidebarPanelRole,
	sanitizeSidebarPanelText,
} from "./sidebar-panels.js";
import { createSplitPaneController, type SplitPaneController } from "./split-pane.js";
import type { SubagentActivityItem, SubagentActivitySnapshot } from "./subagent-activity.js";
import { subagentCostChart } from "./subagent-cost-chart.js";
import {
	type AtelierConfig,
	type AtelierState,
	DEFAULT_CONFIG,
	type NormalizedTodo,
	type WorkspacePulseState,
} from "./types.js";
import type { WorkspacePulseData } from "./workspace-pulse.js";

export type {
	SidebarBarNode,
	SidebarBarSegment,
	SidebarHeadingNode,
	SidebarKeyValueNode,
	SidebarPanelAvailability,
	SidebarPanelContribution,
	SidebarPanelData,
	SidebarPanelDescriptor,
	SidebarPanelDiscoveryEvent,
	SidebarPanelEvent,
	SidebarPanelEventTransport,
	SidebarPanelNode,
	SidebarPanelRegisterEvent,
	SidebarPanelRegistry,
	SidebarPanelRegistryOptions,
	SidebarPanelRichContent,
	SidebarPanelRole,
	SidebarPanelRow,
	SidebarPanelUnregisterEvent,
	SidebarProgressNode,
	SidebarSpacerNode,
	SidebarSpan,
	SidebarSpansNode,
	SidebarTextNode,
} from "./sidebar-panels.js";
export {
	BUILTIN_SIDEBAR_PANEL_IDS,
	createSidebarPanelRegistry,
	DEFAULT_SIDEBAR_PANEL_LAYOUT,
	isSidebarPanelContributionId,
	isSidebarPanelId,
	isSidebarPanelRequestId,
	isSidebarPanelSource,
	isSidebarPanelTextWithinRawLimit,
	registerSidebarPanel,
	SIDEBAR_PANEL_EVENT_CHANNEL,
	SIDEBAR_PANEL_MAX_ID_CHARS,
	SIDEBAR_PANEL_MAX_PANELS,
	SIDEBAR_PANEL_MAX_RAW_REQUEST_ID_CODE_UNITS,
	SIDEBAR_PANEL_MAX_RAW_ROW_CODE_UNITS,
	SIDEBAR_PANEL_MAX_RAW_TITLE_CODE_UNITS,
	SIDEBAR_PANEL_MAX_REASON_CHARS,
	SIDEBAR_PANEL_MAX_RICH_NODES,
	SIDEBAR_PANEL_MAX_RICH_RAW_CODE_UNITS,
	SIDEBAR_PANEL_MAX_RICH_SEGMENTS,
	SIDEBAR_PANEL_MAX_RICH_SPANS,
	SIDEBAR_PANEL_MAX_RICH_UNITS,
	SIDEBAR_PANEL_MAX_RICH_VISIBLE_CHARS,
	SIDEBAR_PANEL_MAX_ROW_CHARS,
	SIDEBAR_PANEL_MAX_ROWS,
	SIDEBAR_PANEL_MAX_SOURCE_CHARS,
	SIDEBAR_PANEL_MAX_TITLE_CHARS,
	SIDEBAR_PANEL_MAX_TRACKED_SOURCES,
	sanitizeSidebarPanelRich,
	sanitizeSidebarPanelText,
} from "./sidebar-panels.js";

export interface SidebarSnapshotInput {
	state: AtelierState;
	cwd: string;
	sessionName?: string;
	sessionFile?: string;
	branchEntryCount: number;
	activeToolCount: number;
	availableToolCount: number;
	activeToolNames?: readonly string[];
	mcpServers?: readonly McpServerSummary[];
	extensionStatuses: readonly string[];
	runActivity?: RunActivitySnapshot;
	subagents?: SubagentActivitySnapshot;
	todos?: readonly NormalizedTodo[];
	sidebarPanels?: readonly SidebarPanelData[];
}

export interface SidebarSnapshot extends AtelierState {
	projectName: string;
	cwd: string;
	sessionName?: string;
	sessionFile?: string;
	persisted: boolean;
	branchEntryCount: number;
	activeToolCount: number;
	availableToolCount: number;
	activeToolNames: readonly string[];
	mcpServers: readonly McpServerSummary[];
	runActivity: RunActivitySnapshot;
	subagents: SubagentActivitySnapshot;
	todos: readonly NormalizedTodo[];
	sidebarPanels?: readonly SidebarPanelData[];
}

function workspacePulseData(pulse: WorkspacePulseState): WorkspacePulseData | undefined {
	return "data" in pulse ? pulse.data : undefined;
}

export function buildSidebarSnapshot(input: SidebarSnapshotInput): SidebarSnapshot {
	const pulseData = workspacePulseData(input.state.workspacePulse);
	const projectName =
		pulseData?.repositoryName ?? (basename(pulseData?.root ?? input.cwd) || pulseData?.root || input.cwd);
	return {
		...input.state,
		projectName,
		cwd: input.cwd,
		...(input.sessionName ? { sessionName: input.sessionName } : {}),
		...(input.sessionFile ? { sessionFile: input.sessionFile } : {}),
		persisted: Boolean(input.sessionFile),
		branchEntryCount: input.branchEntryCount,
		activeToolCount: input.activeToolCount,
		availableToolCount: input.availableToolCount,
		activeToolNames: [...new Set((input.activeToolNames ?? []).map(sanitize).filter(Boolean))].sort((a, b) =>
			a.localeCompare(b, "en"),
		),
		mcpServers: (input.mcpServers ?? []).map((server) => ({ ...server })),
		extensionStatuses: input.extensionStatuses,
		runActivity: input.runActivity ?? EMPTY_RUN_ACTIVITY,
		subagents: input.subagents ?? EMPTY_SUBAGENT_ACTIVITY,
		todos: input.todos ?? [],
		sidebarPanels: input.sidebarPanels ?? [],
	};
}

const sanitize = (text: string): string =>
	text
		.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
		.replace(/[\u0000-\u001f\u007f]/g, " ")
		.replace(/\s+/g, " ")
		.trim();

const display = (value: string | undefined): string => {
	const safe = value === undefined ? "" : sanitize(value);
	return safe || "—";
};

const finiteCount = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0);

function shortPath(path: string): string {
	const safe = sanitize(path);
	const home = homedir();
	if (safe === home) return "~";
	if (home && safe.startsWith(`${home}/`)) return `~${safe.slice(home.length)}`;
	return safe || "—";
}

function padToWidth(text: string, width: number): string {
	const safeWidth = Math.max(0, Math.trunc(width));
	const content = truncateToWidth(text, safeWidth, "");
	return `${content}${" ".repeat(Math.max(0, safeWidth - visibleWidth(content)))}`;
}

function renderDock(
	rows: string[],
	width: number,
	height: number,
	palette: AtelierPalette,
	resizing = false,
): string[] {
	const safeWidth = Math.max(0, Math.trunc(width));
	const safeHeight = Math.max(0, Math.trunc(height));
	if (safeWidth <= 0 || safeHeight <= 0) return [];
	const contentWidth = Math.max(0, safeWidth - 2);
	const edge = resizing ? `${palette.paint("warning", "│")} ` : "  ";
	return Array.from({ length: safeHeight }, (_, index) => {
		const content = truncateToWidth(rows[index] ?? "", contentWidth, "");
		const padding = " ".repeat(Math.max(0, contentWidth - visibleWidth(content)));
		return truncateToWidth(`${edge}${content}${padding}`, safeWidth, "");
	});
}

function properCase(value: string): string {
	return value.toLowerCase().replace(/[\p{L}\p{N}]+/gu, (word) => {
		if (word === "openai") return "OpenAI";
		return `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;
	});
}

function panelRows(
	title: string,
	rows: readonly string[],
	width: number,
	palette: AtelierPalette,
	theme: ThemeLike,
	role: PaletteRole,
	jewel: "✦" | "✧",
	collapsed = false,
	preserveTitleCase = false,
): string[] {
	const safeWidth = Math.max(4, Math.trunc(width));
	const innerWidth = Math.max(0, safeWidth - 4);
	const sanitizedTitle = sanitizeSidebarPanelText(title, SIDEBAR_PANEL_MAX_TITLE_CHARS);
	const safeTitle = preserveTitleCase ? sanitizedTitle : properCase(sanitizedTitle);
	const crownPrefix = `╭─ ${jewel} `;
	const crownFill = "─".repeat(
		Math.max(0, safeWidth - visibleWidth(crownPrefix) - visibleWidth(safeTitle) - 2),
	);
	const top = `${palette.paint(role, crownPrefix)}${theme.bold(
		palette.paint(role, safeTitle),
	)} ${palette.paint(role, `${crownFill}╮`)}`;
	const body = (collapsed ? rows.slice(0, 1) : rows).map((row) => {
		const content = padToWidth(row, innerWidth);
		return `${palette.paint("dim", "│")} ${content} ${palette.paint("dim", "│")}`;
	});
	return [top, ...body, palette.paint("dim", `╰${"─".repeat(safeWidth - 2)}╯`), ""];
}

function valueRow(value: string | undefined, palette: AtelierPalette, role: PaletteRole): string {
	const text = display(value);
	return palette.paint(text === "—" ? "dim" : role, text);
}

const COMPACT_SIDEBAR_MAX_WIDTH = 39;
const SIDEBAR_DYNAMIC_RENDER_INTERVAL_MS = 400;

interface SidebarLayout {
	showToolNames: boolean;
}

function sidebarLayout(width: number, config: AtelierConfig): SidebarLayout {
	const compact = width <= COMPACT_SIDEBAR_MAX_WIDTH;
	return {
		showToolNames: config.showSidebarToolNames && !compact,
	};
}

function activitySymbol(activity: SidebarSnapshot["activity"]): string {
	if (activity === "error") return "✕";
	if (activity === "warning") return "▲";
	if (activity === "working") return "◆";
	return "●";
}

/** Align names and values consistently across all built-in panels. */
function labeledRow(
	label: string,
	value: string,
	width: number,
	palette: AtelierPalette,
	role: PaletteRole = "primary",
): string {
	const safeWidth = Math.max(0, Math.trunc(width));
	const left = truncateToWidth(label, Math.min(12, Math.max(0, safeWidth - 8)), "…");
	const right = truncateToWidth(value, Math.max(0, safeWidth - visibleWidth(left) - 1), "…");
	return truncateToWidth(
		`${palette.paint("muted", left)}${" ".repeat(Math.max(1, safeWidth - visibleWidth(left) - visibleWidth(right)))}${palette.paint(role, right)}`,
		safeWidth,
		"",
	);
}

function agentRows(
	snapshot: SidebarSnapshot,
	width: number,
	palette: AtelierPalette,
	theme: ThemeLike,
): string[] {
	const compact = width <= COMPACT_SIDEBAR_MAX_WIDTH - 6;
	const activity = `${snapshot.activity.slice(0, 1).toUpperCase()}${snapshot.activity.slice(1)}`;
	const workingLabel =
		snapshot.activity === "working" && snapshot.workingLabel
			? sanitize(snapshot.workingLabel).toLowerCase()
			: "";
	const activityText = workingLabel ? `${activity} · ${workingLabel}` : activity;
	const status = theme.bold(
		palette.paint(snapshot.activity, `${activitySymbol(snapshot.activity)} ${activityText || "—"}`),
	);
	const model = valueRow(snapshot.modelId, palette, "primary");
	const provider = snapshot.provider ? palette.paint("muted", properCase(display(snapshot.provider))) : "";
	const thinking = snapshot.thinkingLevel
		? palette.paint("primary", properCase(display(snapshot.thinkingLevel)))
		: "";
	const access =
		snapshot.modelId || snapshot.provider
			? palette.paint(
					snapshot.metrics.subscription ? "ready" : "muted",
					snapshot.metrics.subscription ? "Subscription" : "Metered",
				)
			: "";
	const separator = ` ${palette.paint("dim", "·")} `;
	if (compact) {
		const rows = [status, model];
		if (provider) rows.push(provider);
		const secondary = [thinking, access].filter(Boolean);
		if (secondary.length > 0) rows.push(secondary.join(separator));
		return rows;
	}
	const metadata = [provider, thinking, access].filter(Boolean);
	return [
		spacedRow(status, model, width),
		metadata.length > 0 ? metadata.join(separator) : palette.paint("dim", "—"),
	];
}

function formatPulseCount(value: number): string {
	const count = finiteCount(value);
	if (count < 1_000) return count.toString();
	if (count < 1_000_000) return `${(count / 1_000).toFixed(count < 10_000 ? 1 : 0)}k`;
	return `${(count / 1_000_000).toFixed(count < 10_000_000 ? 1 : 0)}M`;
}

interface WorkspacePulseRows {
	core: string[];
	details: string[];
}

function pulseIndicator(pulse: WorkspacePulseState): { symbol: string; role: PaletteRole } {
	if (pulse.status === "conflict") return { symbol: "✕", role: "error" };
	if (pulse.status === "changed") return { symbol: "▲", role: "warning" };
	if (pulse.status === "stale") return { symbol: "~", role: "warning" };
	if (pulse.status === "clean") return { symbol: "", role: "ready" };
	return { symbol: "", role: "dim" };
}

function workspacePulseRows(
	pulse: WorkspacePulseState,
	compact: boolean,
	palette: AtelierPalette,
): WorkspacePulseRows {
	if (pulse.status === "inspecting") return { core: [palette.paint("muted", "inspecting…")], details: [] };
	if (pulse.status === "not-repo") return { core: [], details: [] };
	if (pulse.status === "unavailable")
		return { core: [palette.paint("warning", "VCS unavailable")], details: [] };
	if (!("data" in pulse)) return { core: [], details: [] };
	if (pulse.data.bareRepository) return { core: [palette.paint("muted", "bare repository")], details: [] };
	const git = pulse.data.snapshot;
	if (pulse.status === "clean") return { core: [palette.paint("ready", "✓ clean")], details: [] };
	if (pulse.data.vcs === "jj") {
		const core =
			git.trackedFiles > 0
				? [
						palette.paint(
							pulse.status === "stale" ? "warning" : "primary",
							`${formatPulseCount(git.trackedFiles)} changed`,
						),
					]
				: [];
		if (git.conflicts > 0) core.push(palette.paint("error", "conflict"));
		return { core, details: [] };
	}
	const tracked = `${formatPulseCount(git.trackedFiles)} tracked`;
	const lines = `+${formatPulseCount(git.linesAdded)}  −${formatPulseCount(git.linesRemoved)}`;
	const role = pulse.status === "stale" ? "warning" : "primary";
	const prefix = pulse.status === "stale" ? "~ stale · " : "";
	const core = compact
		? [palette.paint(role, `${prefix}${tracked}`), palette.paint(role, lines)]
		: [palette.paint(role, `${prefix}${tracked}  ${lines}`)];
	if (git.conflicts > 0) core.push(palette.paint("error", `${finiteCount(git.conflicts)} conflicts`));
	const details = [
		git.untrackedFiles > 0
			? compact
				? `?${formatPulseCount(git.untrackedFiles)}`
				: `${formatPulseCount(git.untrackedFiles)} untracked`
			: "",
		git.binaryFiles > 0
			? compact
				? `bin${formatPulseCount(git.binaryFiles)}`
				: `${formatPulseCount(git.binaryFiles)} binary`
			: "",
		git.submodules > 0
			? compact
				? `sub${formatPulseCount(git.submodules)}`
				: `${formatPulseCount(git.submodules)} submodule`
			: "",
	].filter(Boolean);
	return { core, details: details.length > 0 ? [palette.paint("muted", details.join(" · "))] : [] };
}

interface WorkspaceRows {
	identity: string[];
	metadata: string[];
	pulseDetails: string[];
	session: string[];
}

function packWorkspaceRows(rows: readonly string[], width: number, palette: AtelierPalette): string[] {
	const packed: string[] = [];
	let current = "";
	for (const row of rows.filter(Boolean)) {
		if (!current) {
			current = row;
			continue;
		}
		const candidate = `${current} ${palette.paint("dim", "·")} ${row}`;
		if (visibleWidth(candidate) <= width) {
			current = candidate;
			continue;
		}
		packed.push(current);
		current = row;
	}
	if (current) packed.push(current);
	return packed;
}

function workspaceRows(
	snapshot: SidebarSnapshot,
	width: number,
	palette: AtelierPalette,
	_theme: ThemeLike,
): WorkspaceRows {
	const compact = width <= COMPACT_SIDEBAR_MAX_WIDTH - 6;
	const pulseData = workspacePulseData(snapshot.workspacePulse);
	const branch = snapshot.branch ? palette.paint("accent", display(snapshot.branch)) : "";
	const indicator = pulseIndicator(snapshot.workspacePulse);
	let identityParts: string[];
	if (pulseData?.vcs === "jj") {
		const workspaceName =
			pulseData.workspaceName && pulseData.workspaceName !== "default"
				? sanitize(pulseData.workspaceName)
				: "";
		const bookmark = pulseData.branch ? sanitize(pulseData.branch) : "";
		const jjIdentity = [
			...new Set([workspaceName, bookmark, sanitize(pulseData.revision ?? "")].filter(Boolean)),
		];
		identityParts = [palette.paint("muted", "jj"), ...jjIdentity];
	} else {
		const divergence = [
			pulseData?.ahead ? palette.paint("warning", `↑${formatPulseCount(pulseData.ahead)}`) : "",
			pulseData?.behind ? palette.paint("warning", `↓${formatPulseCount(pulseData.behind)}`) : "",
		].filter(Boolean);
		const branchState = branch
			? `${branch}${indicator.symbol ? ` ${palette.paint(indicator.role, indicator.symbol)}` : ""}`
			: "";
		identityParts = [branchState, ...divergence].filter(Boolean);
	}
	const identityRows = packWorkspaceRows(identityParts, width, palette);
	const location = pulseData
		? [
				...(pulseData.worktreeName
					? [palette.paint("muted", `worktree ${sanitize(pulseData.worktreeName)}`)]
					: []),
				...(pulseData.relativeCwd ? [palette.paint("muted", `./${sanitize(pulseData.relativeCwd)}`)] : []),
			]
		: [palette.paint("muted", shortPath(snapshot.cwd))];
	const pulse = workspacePulseRows(snapshot.workspacePulse, compact, palette);
	const metadata = packWorkspaceRows([...location, ...pulse.core], width, palette);
	const sessionName = snapshot.sessionName ? sanitize(snapshot.sessionName) : "";
	const session = sessionName ? [palette.paint("primary", sessionName)] : [];
	return { identity: identityRows, metadata, pulseDetails: pulse.details, session };
}

function contextRole(snapshot: SidebarSnapshot, config: AtelierConfig): PaletteRole {
	const percent = snapshot.metrics.contextPercent;
	if (percent === null || !Number.isFinite(percent)) return "dim";
	if (percent >= config.contextDanger) return "error";
	if (percent >= config.contextWarning) return "warning";
	return "context";
}

function spacedRow(left: string, right: string, width: number): string {
	const safeWidth = Math.max(0, Math.trunc(width));
	const rightWidth = visibleWidth(right);
	const leftMax = Math.max(0, safeWidth - rightWidth - 1);
	const safeLeft = truncateToWidth(left, leftMax, "");
	const gap = " ".repeat(Math.max(1, safeWidth - visibleWidth(safeLeft) - rightWidth));
	return truncateToWidth(`${safeLeft}${gap}${right}`, safeWidth, "");
}

function contextRows(
	snapshot: SidebarSnapshot,
	config: AtelierConfig,
	width: number,
	palette: AtelierPalette,
	theme: ThemeLike,
	colorEnabled: boolean,
): string[] {
	const { metrics } = snapshot;
	if (
		metrics.contextTokens === null ||
		!Number.isFinite(metrics.contextTokens) ||
		metrics.contextPercent === null ||
		!Number.isFinite(metrics.contextPercent)
	) {
		return [palette.paint("dim", "Context unavailable")];
	}
	const role = contextRole(snapshot, config);
	const percent = Math.max(0, metrics.contextPercent);
	const severity =
		!colorEnabled && role === "error" ? "DANGER " : !colorEnabled && role === "warning" ? "WARN " : "";
	const percentText = `${severity}${percent.toFixed(1)}%`;
	const percentWidth = Math.max(6, visibleWidth(percentText));
	const meterWidth = Math.max(0, width - percentWidth - 2);
	const units = Math.min(
		meterWidth * 8,
		Math.max(percent > 0 ? 1 : 0, Math.round((percent * meterWidth * 8) / 100)),
	);
	const full = Math.floor(units / 8);
	const fraction = units % 8;
	const fill = "█".repeat(full) + (fraction ? "▏▎▍▌▋▊▉"[fraction - 1] : "");
	// A shared background covers the unused part of the fractional cell too,
	// keeping even 1% usage attached to its track. Reset before the percentage.
	const meter = colorEnabled
		? `\u001b[48;2;48;53;56m${palette.paint(role, fill)}${" ".repeat(meterWidth - full - (fraction ? 1 : 0))}\u001b[49m`
		: `${palette.paint(role, "█".repeat(full))}${palette.paint("dim", "░".repeat(meterWidth - full))}`;
	const percentage = theme.bold(palette.paint(role, percentText.padStart(percentWidth)));
	const usage = `${formatTokens(metrics.contextTokens)} / ${metrics.contextWindow > 0 ? formatTokens(metrics.contextWindow) : "—"}`;
	return [
		meterWidth > 0 ? `${meter}  ${percentage}` : percentage,
		labeledRow("Tokens", usage, width, palette, "muted"),
	];
}

const currencyDecimals = (value: number): number =>
	Number.isFinite(value) ? Math.min(6, Math.max(0, Math.trunc(value))) : 0;

function formatUsageTokens(count: number): string {
	const safe = Number.isFinite(count) ? Math.max(0, count) : 0;
	if (safe < 1_000) return Math.trunc(safe).toString();
	if (safe < 1_000_000) return `${(safe / 1_000).toFixed(1)}k`;
	if (safe < 1_000_000_000) return `${(safe / 1_000_000).toFixed(1)}M`;
	return `${(safe / 1_000_000_000).toFixed(1)}B`;
}

function usageRows(
	snapshot: SidebarSnapshot,
	config: AtelierConfig,
	width: number,
	palette: AtelierPalette,
): string[] {
	const { metrics } = snapshot;
	const rows: string[] = [];
	if (metrics.usageAvailable) {
		const hit =
			metrics.cacheHitPercent !== undefined && Number.isFinite(metrics.cacheHitPercent)
				? `${metrics.cacheHitPercent.toFixed(1)}%`
				: "—";
		rows.push(
			labeledRow("Input", formatUsageTokens(metrics.input), width, palette, "input"),
			labeledRow("Output", formatUsageTokens(metrics.output), width, palette, "output"),
			labeledRow("Cache read", formatUsageTokens(metrics.cacheRead), width, palette, "cache"),
			labeledRow("Cache hit", hit, width, palette, hit === "—" ? "dim" : "primary"),
		);
	}
	if (metrics.costAvailable) {
		const cost = Math.max(0, Number.isFinite(metrics.cost) ? metrics.cost : 0).toFixed(
			currencyDecimals(config.currencyDecimals),
		);
		rows.push(labeledRow("Cost", `$${cost}`, width, palette));
	}
	return rows;
}

interface SidebarChartGraphics {
	imageOwner?: object | undefined;
	suspendPlot?: boolean;
}

function subagentGroups(
	snapshot: SidebarSnapshot,
	config: AtelierConfig,
	width: number,
	palette: AtelierPalette,
	chartGraphics: SidebarChartGraphics = {},
): SidebarGroup[] {
	const usage = snapshot.subagentUsage;
	if (!usage || (!usage.runs.length && !usage.unavailable && !usage.pending && !usage.limited)) return [];
	const decimals = currencyDecimals(config.currencyDecimals);
	const panel = { panel: "SUBAGENTS", panelId: "subagents", panelRole: "output" as const, required: false };
	const chart = subagentCostChart(usage, width, decimals, config.nerdFont, palette, chartGraphics);
	const footer: string[] = [];
	if (usage.pending) footer.push(palette.paint("dim", "Running · curves update on reply"));
	if (usage.unavailable || usage.limited)
		footer.push(palette.paint("warning", "Partial · metadata unavailable"));
	footer.push(palette.paint("dim", "/atelier usage · expand graph"));
	return [{ ...panel, name: "subagentCostChart", rows: [...chart, ...footer], dropRank: 18 }];
}

function toolsStatusRows(snapshot: SidebarSnapshot, width: number, palette: AtelierPalette): string[] {
	return [
		labeledRow(
			"Enabled",
			`${finiteCount(snapshot.activeToolCount)} / ${finiteCount(snapshot.availableToolCount)}`,
			width,
			palette,
		),
	];
}

function mcpServerRows(snapshot: SidebarSnapshot, width: number, palette: AtelierPalette): string[] {
	return snapshot.mcpServers.map((server) =>
		labeledRow(
			`● ${server.name}`,
			`${finiteCount(server.toolCount)} ${server.toolCount === 1 ? "tool" : "tools"}`,
			width,
			palette,
			"ready",
		),
	);
}

function activeToolNameRows(
	snapshot: SidebarSnapshot,
	contentWidth: number,
	palette: AtelierPalette,
): string[] {
	const names = snapshot.activeToolNames.map((name) => palette.paint("primary", name));
	if (names.length === 0) return [];

	const leftColumnWidth = names.reduce(
		(maximum, name, index) => (index % 2 === 0 ? Math.max(maximum, visibleWidth(name)) : maximum),
		0,
	);
	const rightColumnWidth = names.reduce(
		(maximum, name, index) => (index % 2 === 1 ? Math.max(maximum, visibleWidth(name)) : maximum),
		0,
	);
	const columnGap = "  ";
	if (leftColumnWidth + visibleWidth(columnGap) + rightColumnWidth > contentWidth) return names;

	const rows: string[] = [];
	for (let index = 0; index < names.length; index += 2) {
		const left = names[index] ?? "";
		const right = names[index + 1];
		rows.push(right === undefined ? left : `${padToWidth(left, leftColumnWidth)}${columnGap}${right}`);
	}
	return rows;
}

function todosRows(snapshot: SidebarSnapshot, palette: AtelierPalette): string[] {
	const todoList = snapshot.todos;
	if (todoList.length === 0) return [];

	const done = todoList.filter((t) => t.status === "completed").length;
	const total = todoList.length;
	const rows = [palette.paint("muted", `${done}/${total}`)];
	const visible =
		snapshot.runActivity.phase === "running"
			? todoList.filter((todo) => todo.status === "in_progress")
			: todoList;

	for (const todo of visible) {
		let check: string;
		if (todo.status === "completed") check = palette.paint("ready", "✓");
		else if (todo.status === "in_progress") check = palette.paint("warning", "◐");
		else check = palette.paint("dim", "○");
		const id = palette.paint("accent", `#${todo.id}`);
		const text =
			todo.status === "completed"
				? palette.paint("dim", sanitize(todo.text))
				: palette.paint("primary", sanitize(todo.text));
		rows.push(`${check} ${id} ${text}`);
	}
	return rows;
}

const exceptionStatusPattern =
	/\b(error|failed?|failure|warn(?:ing)?|offline|unavailable|blocked|degraded)\b/i;

function statusDetailPanelRole(snapshot: SidebarSnapshot): PaletteRole {
	return snapshot.extensionStatuses.some((status) =>
		/\b(error|failed?|failure|offline|unavailable)\b/i.test(sanitize(status)),
	)
		? "error"
		: "warning";
}

function statusDetailRows(snapshot: SidebarSnapshot, palette: AtelierPalette): string[] {
	const statuses = snapshot.extensionStatuses
		.map(sanitize)
		.filter((status) => status && exceptionStatusPattern.test(status));
	if (statuses.length === 0) return [];
	return [
		...statuses.map((status) => {
			const role: PaletteRole = /\b(error|failed?|failure|offline|unavailable)\b/i.test(status)
				? "error"
				: "warning";
			return palette.paint(role, `${role === "error" ? "✕" : "▲"} ${status}`);
		}),
	];
}

interface ActivityGroups {
	core: string[];
	active: Array<{ id: string; row: string }>;
	recent: Array<{ id: string; row: string }>;
	aggregate: string[];
}

interface SidebarGroup {
	name: string;
	panel?: string;
	panelTitle?: string;
	panelId?: string;
	panelRole?: PaletteRole;
	panelJewel?: "✦" | "✧";
	preservePanelTitleCase?: boolean;
	rows: string[];
	rowActions?: Array<SidebarAction | undefined>;
	required: boolean;
	dropRank: number;
}

function regionForRows(
	action: SidebarAction | undefined,
	width: number,
	y1: number,
	y2 = y1,
): SidebarHitRegion | undefined {
	if (!action) return undefined;
	return { action, x1: 2, x2: width + 2, y1, y2, enabled: true };
}

function renderGroupsFrame(
	groups: readonly SidebarGroup[],
	width: number,
	palette: AtelierPalette,
	theme: ThemeLike,
	collapsedPanelIds: ReadonlySet<string> = new Set(),
): { rows: string[]; hitRegions: SidebarHitRegion[] } {
	const rendered: string[] = [];
	const hitRegions: SidebarHitRegion[] = [];
	for (let index = 0; index < groups.length; ) {
		const group = groups[index];
		if (!group) break;
		if (!group.panel) {
			for (let rowIndex = 0; rowIndex < group.rows.length; rowIndex += 1) {
				rendered.push(group.rows[rowIndex] ?? "");
				const region = regionForRows(group.rowActions?.[rowIndex], width, rendered.length);
				if (region) hitRegions.push(region);
			}
			index += 1;
			continue;
		}

		const rows: string[] = [];
		const rowActions: Array<SidebarAction | undefined> = [];
		let next = index;
		while (groups[next]?.panel === group.panel && groups[next]?.panelId === group.panelId) {
			const nextGroup = groups[next];
			if (nextGroup) {
				rows.push(...nextGroup.rows);
				for (let rowIndex = 0; rowIndex < nextGroup.rows.length; rowIndex += 1)
					rowActions.push(nextGroup.rowActions?.[rowIndex]);
			}
			next += 1;
		}
		if (rows.length > 0) {
			const panelStartY = rendered.length + 1;
			const panelId = group.panelId;
			const collapsed = panelId !== undefined && collapsedPanelIds.has(panelId);
			const panelFrame = panelRows(
				group.panelTitle ?? group.panel,
				rows,
				width,
				palette,
				theme,
				group.panelRole ?? "accent",
				group.panelJewel ?? "✦",
				collapsed,
				group.preservePanelTitleCase ?? false,
			);
			rendered.push(...panelFrame);
			if (!collapsed) {
				for (let rowIndex = 0; rowIndex < rowActions.length; rowIndex += 1) {
					const region = regionForRows(rowActions[rowIndex], width, panelStartY + 1 + rowIndex);
					if (region) hitRegions.push(region);
				}
			}
			if (panelId && panelId !== "__empty__") {
				const panelEndY = panelStartY + Math.max(0, panelFrame.length - 2);
				const region = regionForRows({ type: "toggle-panel-body", panelId }, width, panelStartY, panelEndY);
				if (region) hitRegions.push(region);
			}
		}
		index = next;
	}
	return { rows: rendered, hitRegions };
}

function renderGroups(
	groups: readonly SidebarGroup[],
	width: number,
	palette: AtelierPalette,
	theme: ThemeLike,
	collapsedPanelIds: ReadonlySet<string> = new Set(),
): string[] {
	return renderGroupsFrame(groups, width, palette, theme, collapsedPanelIds).rows;
}

function contributedRows(panel: SidebarPanelData, palette: AtelierPalette): string[] {
	const rows = panel.rows.slice(0, SIDEBAR_PANEL_MAX_ROWS).map((row) => {
		const text = sanitizeSidebarPanelText(
			typeof row === "string" ? row : row.text,
			SIDEBAR_PANEL_MAX_ROW_CHARS,
		);
		const role = typeof row === "string" ? panel.role : (row.role ?? panel.role);
		return palette.paint((role ?? "primary") as SidebarPanelRole, text);
	});
	return rows.filter((row) => visibleWidth(row) > 0);
}

function paintRich(
	palette: AtelierPalette,
	color: string | undefined,
	role: SidebarPanelRole | undefined,
	fallback: PaletteRole,
	text: string,
): string {
	const painted = color ? palette.paintHex?.(color, text) : undefined;
	return painted ?? palette.paint(role ?? fallback, text);
}

function allocateBarCells(segments: readonly SidebarBarSegment[], width: number): number[] {
	const safeWidth = Math.max(0, Math.trunc(width));
	const maximum = segments.reduce(
		(current, segment) =>
			Number.isFinite(segment.value) && segment.value > current ? segment.value : current,
		0,
	);
	if (safeWidth === 0 || maximum <= 0) return segments.map(() => 0);

	// Scaling by the largest value keeps the sum finite even when producers send
	// several values near Number.MAX_VALUE. Largest-remainder allocation then
	// makes every positive bar occupy exactly the requested number of cells.
	const weights = segments.map((segment) =>
		Number.isFinite(segment.value) && segment.value > 0 ? segment.value / maximum : 0,
	);
	const total = weights.reduce((sum, weight) => sum + weight, 0);
	const quotas = weights.map((weight) => (weight / total) * safeWidth);
	const cells = quotas.map((quota) => Math.floor(quota));
	let remaining = safeWidth - cells.reduce((sum, count) => sum + count, 0);
	const order = quotas
		.map((quota, index) => ({ index, remainder: quota - cells[index]! }))
		.sort((left, right) => right.remainder - left.remainder || left.index - right.index);
	for (const entry of order) {
		if (remaining <= 0) break;
		cells[entry.index] = (cells[entry.index] ?? 0) + 1;
		remaining -= 1;
	}
	return cells;
}

function packRichLabels(labels: readonly string[], width: number): string[] {
	const safeWidth = Math.max(1, Math.trunc(width));
	const rows: string[] = [];
	let current = "";
	for (const label of labels) {
		const fitted = truncateToWidth(label, safeWidth, "");
		if (!current) {
			current = fitted;
			continue;
		}
		if (visibleWidth(current) + 1 + visibleWidth(fitted) <= safeWidth) {
			current = `${current} ${fitted}`;
			continue;
		}
		rows.push(current);
		current = fitted;
	}
	if (current) rows.push(current);
	return rows;
}

function contributedRichNodes(
	nodes: readonly SidebarPanelNode[],
	panel: SidebarPanelData,
	palette: AtelierPalette,
	contentWidth: number,
): string[] {
	const fallback: PaletteRole = panel.role ?? "primary";
	return nodes.flatMap((node) => {
		switch (node.kind) {
			case "text":
				return [palette.paint(node.role ?? fallback, node.text)];
			case "spans":
				return [
					node.spans.map((span) => paintRich(palette, span.color, span.role, fallback, span.text)).join(""),
				];
			case "keyValue": {
				const width = Math.min(16, Math.max(1, visibleWidth(node.label)));
				const label = padToWidth(palette.paint(node.labelRole ?? "muted", node.label), width);
				return [`${label} ${paintRich(palette, node.valueColor, node.valueRole, fallback, node.value)}`];
			}
			case "heading":
				return [palette.paint(node.role ?? "accent", node.text)];
			case "bar": {
				const barWidth = 20;
				const shares = allocateBarCells(node.segments, barWidth);
				const blocks = node.segments.flatMap((segment, index) => {
					const share = shares[index] ?? 0;
					return share > 0
						? [paintRich(palette, segment.color, segment.role, fallback, "█".repeat(share))]
						: [];
				});
				const used = shares.reduce((sum, share) => sum + share, 0);
				const empty = Math.max(0, barWidth - used);
				const bar = `${blocks.join("")}${empty ? palette.paint("dim", "░".repeat(empty)) : ""}`;
				const caption = node.label ? palette.paint("muted", node.label) : undefined;
				const labels = node.segments.map((segment) => segment.label?.trim() ?? "");

				// Fully labelled segments represent categories. Pack them into as many
				// bounded rows as needed instead of truncating a single joined line.
				if (labels.every((label) => label.length > 0)) {
					const painted = node.segments.map((segment, index) =>
						paintRich(palette, segment.color, segment.role, fallback, labels[index] ?? ""),
					);
					return [...packRichLabels(painted, contentWidth), ...(caption ? [caption] : [])];
				}

				if (!caption) return [bar];
				return visibleWidth(bar) + 1 + visibleWidth(caption) <= contentWidth
					? [`${bar} ${caption}`]
					: [bar, caption];
			}
			case "progress": {
				const percent =
					node.total !== undefined && node.total > 0
						? Math.min(100, Math.round((node.current / node.total) * 100))
						: undefined;
				const amount =
					node.total === undefined
						? String(node.current)
						: `${node.current}/${node.total}${percent === undefined ? "" : ` (${percent}%)`}`;
				const head = `${palette.paint(node.role ?? fallback, node.label)} ${amount}`;
				return [node.detail ? `${head} ${palette.paint("muted", node.detail)}` : head];
			}
			case "spacer":
				return [""];
		}
	});
}

function contributedContent(
	panel: SidebarPanelData,
	palette: AtelierPalette,
	config: AtelierConfig,
	contentWidth: number,
): string[] {
	if (panel.rich) {
		const collapsed = panel.rich.collapsible === true && config.contributedPanelCollapsed[panel.id] === true;
		const nodes = collapsed && panel.rich.compact ? panel.rich.compact : panel.rich.expanded;
		const rendered = contributedRichNodes(nodes, panel, palette, contentWidth);
		if (rendered.some((row) => visibleWidth(row) > 0)) return rendered;
	}
	return contributedRows(panel, palette);
}

function durationForTool(tool: ToolActivity, now: number): string {
	return formatDuration(tool.durationMs ?? Math.max(0, now - tool.startedAt));
}

function toolStatusRole(status: ToolActivity["status"]): PaletteRole {
	if (status === "failed") return "error";
	if (status === "running") return "working";
	return "ready";
}

function toolStatusLabel(tool: ToolActivity, now: number): string {
	const duration = durationForTool(tool, now);
	if (tool.status === "running") return duration;
	return `${tool.status} ${duration}`;
}

function toolActivityRow(
	tool: ToolActivity,
	contentWidth: number,
	palette: AtelierPalette,
	now: number,
	extraLive = 0,
): string {
	const safeName = sanitize(tool.name) || "tool";
	const safeSummary = sanitize(tool.summary);
	const status =
		extraLive > 0 && tool.status === "running"
			? `${durationForTool(tool, now)} · +${finiteCount(extraLive)}`
			: toolStatusLabel(tool, now);
	const statusWidth = visibleWidth(status);
	const nameWidth = Math.min(Math.max(visibleWidth(safeName), 4), 10, Math.max(0, contentWidth));
	const summaryWidth = Math.max(0, contentWidth - nameWidth - statusWidth - 2);
	const statusText = truncateToWidth(status, Math.max(0, contentWidth - nameWidth - summaryWidth - 2), "");
	const row = `${padToWidth(palette.paint("muted", safeName), nameWidth)} ${padToWidth(
		palette.paint(safeSummary ? "primary" : "dim", safeSummary || "—"),
		summaryWidth,
	)} ${palette.paint(toolStatusRole(tool.status), statusText)}`;
	return truncateToWidth(row, contentWidth, "");
}

function runSummaryRow(activity: RunActivitySnapshot, palette: AtelierPalette, now: number): string {
	if (activity.phase === "idle") return palette.paint("ready", "Ready");
	const duration =
		activity.phase === "settled"
			? formatDuration(activity.durationMs ?? Math.max(0, now - (activity.startedAt ?? now)))
			: formatDuration(Math.max(0, now - (activity.startedAt ?? now)));
	const role: PaletteRole =
		activity.phase === "running" ? "working" : activity.failedCount > 0 ? "error" : "ready";
	if (activity.phase === "settled") return palette.paint(role, `Last run · ${duration}`);

	const label = activity.turnNumber === undefined ? "Run" : `Turn ${finiteCount(activity.turnNumber)}`;
	return palette.paint(role, `${label} · ${activity.phase} ${duration}`);
}

function responsePerformanceRows(
	activity: RunActivitySnapshot,
	width: number,
	palette: AtelierPalette,
): string[] {
	const { ttft, tps } = responsePerformanceValues(activity.performance);
	return [
		labeledRow(
			"First token",
			ttft.available ? ttft.text : "—",
			width,
			palette,
			ttft.available ? "output" : "dim",
		),
		labeledRow(
			width < 25 ? "Speed" : "Output speed",
			tps.available ? `${tps.text} tok/s` : "—",
			width,
			palette,
			tps.available ? "output" : "dim",
		),
	];
}

function activityRows(
	activity: RunActivitySnapshot,
	contentWidth: number,
	palette: AtelierPalette,
	now: number,
): ActivityGroups {
	const liveTurn = activity.phase === "running";
	const activeIds = new Set(activity.activeTools.map((tool) => tool.id));
	const sortedActive = activity.activeTools
		.map((tool, index) => ({ index, tool }))
		.sort((left, right) => left.tool.startedAt - right.tool.startedAt || left.index - right.index)
		.map(({ tool }) => tool);
	const visibleActive = liveTurn ? sortedActive.slice(-1) : sortedActive;
	const extraLive = liveTurn ? Math.max(0, sortedActive.length - visibleActive.length) : 0;
	const active = visibleActive.map((tool) => ({
		id: tool.id,
		row: toolActivityRow(tool, contentWidth, palette, now, extraLive),
	}));
	const recent = liveTurn
		? []
		: activity.recentTools
				.filter((tool) => !activeIds.has(tool.id))
				.slice(0, 3)
				.map((tool) => ({ id: tool.id, row: toolActivityRow(tool, contentWidth, palette, now) }));
	const aggregateText = liveTurn ? "" : aggregateActivityText(activity);
	return {
		core: [
			...(activity.phase === "idle" ? [] : [runSummaryRow(activity, palette, now)]),
			...responsePerformanceRows(activity, contentWidth, palette),
		],
		active,
		recent,
		aggregate: aggregateText
			? [palette.paint(activity.failedCount > 0 ? "error" : "ready", aggregateText)]
			: [],
	};
}

function aggregateActivityText(activity: RunActivitySnapshot): string {
	const completed = finiteCount(activity.completedCount);
	const failed = finiteCount(activity.failedCount);
	if (completed === 0 && failed === 0) return "";
	return `tools ${completed} done · ${failed} failed`;
}

const EMPTY_SUBAGENT_ACTIVITY: SubagentActivitySnapshot = Object.freeze({
	active: Object.freeze([]),
	recent: Object.freeze([]),
});

function subagentStatusRole(status: SubagentActivityItem["status"]): PaletteRole {
	if (status === "failed" || status === "rejected" || status === "stopped") return "error";
	if (status === "partial" || status === "paused" || status === "stopping" || status === "detached")
		return "warning";
	if (status === "running" || status === "queued" || status === "pending") return "working";
	return "ready";
}

function subagentItemRole(item: SubagentActivityItem): PaletteRole {
	if (item.timedOut) return "error";
	if (item.activityState === "needs_attention") return "warning";
	return subagentStatusRole(item.status);
}

function subagentStatusSymbol(status: SubagentActivityItem["status"]): string {
	if (status === "failed" || status === "rejected" || status === "stopped") return "✕";
	if (status === "partial") return "◐";
	if (status === "paused") return "Ⅱ";
	if (status === "stopping") return "…";
	if (status === "detached") return "↗";
	if (status === "queued" || status === "pending") return "◦";
	if (status === "running") return "◆";
	return "✓";
}

function subagentStatusLabel(item: SubagentActivityItem): string {
	if (item.statusUnavailable) return "status unavailable";
	if (item.timedOut) return "timed out";
	if (item.status === "complete") return "done";
	return item.status;
}

function subagentName(item: SubagentActivityItem): string {
	return (
		sanitize(item.agent ?? (item.agents.length > 0 ? item.agents.join("+") : (item.label ?? item.id))) ||
		"subagent"
	);
}

function subagentRuntime(item: SubagentActivityItem, now: number): string {
	if (item.durationMs !== undefined) return formatDuration(item.durationMs);
	const end = item.endedAt ?? now;
	return formatDuration(Math.max(0, end - item.startedAt));
}

function subagentRow(
	item: SubagentActivityItem,
	contentWidth: number,
	palette: AtelierPalette,
	now: number,
): string {
	const role = subagentItemRole(item);
	const name = palette.paint(item.status === "complete" ? "muted" : "primary", subagentName(item));
	const left = `${palette.paint(role, subagentStatusSymbol(item.status))} ${name}`;
	const right = palette.paint(role, `${subagentStatusLabel(item)} ${subagentRuntime(item, now)}`);
	return spacedRow(left, right, contentWidth);
}

function subagentDetailRow(
	item: SubagentActivityItem,
	contentWidth: number,
	palette: AtelierPalette,
	now: number,
): string | undefined {
	const currentTool = sanitize(item.currentTool ?? "");
	const currentPath = sanitize(item.currentPath ?? "");
	const label = sanitize(item.label ?? "");
	const attention =
		item.activityState === "needs_attention"
			? "needs attention"
			: item.activityState === "active_long_running"
				? "long-running"
				: "";
	const process = item.processState && item.processState !== "observed" ? `process ${item.processState}` : "";
	const unavailable = item.statusUnavailable ? "status unavailable" : "";
	const stats = [
		item.turnCount !== undefined ? `⟳ ${finiteCount(item.turnCount)}` : "",
		item.toolCount !== undefined ? `tools ${finiteCount(item.toolCount)}` : "",
	].filter(Boolean);
	const toolRuntime =
		item.currentToolStartedAt !== undefined
			? ` ${formatDuration(Math.max(0, now - item.currentToolStartedAt))}`
			: "";
	const detail = attention
		? [attention, unavailable, currentTool ? `${currentTool}${toolRuntime}` : "", currentPath, process]
				.filter(Boolean)
				.join(" · ")
		: currentTool
			? [unavailable, currentTool + toolRuntime, currentPath, process].filter(Boolean).join(" · ")
			: [unavailable, currentPath, process, stats.length > 0 ? stats.join(" · ") : "", label].filter(
					Boolean,
				)[0];
	if (!detail) return undefined;
	return truncateToWidth(palette.paint("dim", `⎿ ${detail}`), contentWidth, "");
}

function subagentSidebarGroups(
	snapshot: SidebarSnapshot,
	contentWidth: number,
	palette: AtelierPalette,
	now: number,
): SidebarGroup[] {
	const rows: SidebarGroup[] = [];
	for (const [index, item] of snapshot.subagents.active.entries()) {
		const detail = subagentDetailRow(item, contentWidth, palette, now);
		rows.push({
			name: `subagentActive:${item.id}`,
			panel: "SUBAGENTS",
			panelRole: subagentStatusRole(item.status),
			rows: [subagentRow(item, contentWidth, palette, now), ...(detail ? [detail] : [])],
			required: false,
			dropRank: 65 + (snapshot.subagents.active.length - index) / 100,
		});
	}
	for (const [index, item] of snapshot.subagents.recent.slice(0, 4).entries()) {
		rows.push({
			name: `subagentRecent:${item.id}`,
			panel: "SUBAGENTS",
			panelRole: subagentStatusRole(item.status),
			rows: [subagentRow(item, contentWidth, palette, now)],
			required: false,
			dropRank: 18 + (4 - index) / 100,
		});
	}
	return rows;
}

function activitySidebarGroups(
	snapshot: SidebarSnapshot,
	contentWidth: number,
	palette: AtelierPalette,
	now: number,
): SidebarGroup[] {
	const groups = activityRows(snapshot.runActivity, contentWidth, palette, now);
	const recentCount = groups.recent.length;
	const panelRole: PaletteRole =
		snapshot.runActivity.phase === "running"
			? "working"
			: snapshot.runActivity.failedCount > 0
				? "error"
				: "ready";
	return [
		{
			name: "activityCore",
			panel: "ACTIVITY",
			panelId: "activity",
			panelRole,
			rows: groups.core,
			required: true,
			dropRank: Number.POSITIVE_INFINITY,
		},
		...groups.active.map((active, index, rows) => ({
			name: `activityActive:${active.id}`,
			panel: "ACTIVITY",
			panelId: "activity",
			panelRole,
			rows: [active.row],
			required: false,
			dropRank: 35 + (rows.length - index) / 100 + 40,
		})),
		...groups.recent.map((recent, index) => ({
			name: `activityRecent:${recent.id}`,
			panel: "ACTIVITY",
			panelId: "activity",
			panelRole,
			rows: [recent.row],
			required: false,
			dropRank: (index === 0 ? 30 : 10 + (recentCount - index - 1)) + 40,
		})),
		{
			name: "activityAggregate",
			panel: "ACTIVITY",
			panelId: "activity",
			panelRole,
			rows: groups.aggregate,
			required: false,
			dropRank: 60,
		},
	].filter((group) => group.rows.length > 0);
}

/** Content rows do not wrap; each contiguous panel adds a header, bottom border, and spacer. */
function measureGroups(groups: readonly SidebarGroup[]): number {
	let height = 0;
	let previous: SidebarGroup | undefined;
	for (const group of groups) {
		height += group.rows.length;
		if (group.panel && (group.panel !== previous?.panel || group.panelId !== previous?.panelId)) {
			height += 3;
		}
		previous = group;
	}
	return height;
}

interface ComposedSidebarGroups {
	groups: SidebarGroup[];
	hiddenPanelIds: string[];
}

function compactGroups(groups: readonly SidebarGroup[], height: number): SidebarGroup[] {
	let candidate = [...groups];
	// Recount cheap row metadata after removal so newly adjacent groups share panel chrome.
	// Painting happens only after selection, never for the discarded candidates.
	while (measureGroups(candidate) > height) {
		let dropIndex = -1;
		let dropRank = Number.POSITIVE_INFINITY;
		for (const [index, group] of candidate.entries()) {
			if (group.required || group.dropRank >= dropRank) continue;
			dropRank = group.dropRank;
			dropIndex = index;
		}
		if (dropIndex === -1) {
			// Once optional panels are gone, reduce metadata before clipping the
			// required Agent/Activity/Context hierarchy in a very short terminal.
			const compact = [
				{ name: "agent", minimum: 2 },
				{ name: "activityCore", minimum: 1 },
				{ name: "usageContext", minimum: 1 },
			].find(({ name, minimum }) =>
				candidate.some((group) => group.name === name && group.rows.length > minimum),
			);
			if (!compact) return candidate;
			candidate = candidate.map((group) =>
				group.name === compact.name ? { ...group, rows: group.rows.slice(0, -1) } : group,
			);
			continue;
		}
		const dropName = candidate[dropIndex]?.name;
		candidate = candidate.filter((group, index) =>
			dropName ? group.name !== dropName : index !== dropIndex,
		);
	}
	return candidate;
}

function composeGroups(groups: readonly SidebarGroup[], height: number): ComposedSidebarGroups {
	const source = groups.filter((group) => group.rows.length > 0);
	const sourcePanelIds = new Set(source.flatMap((group) => (group.panelId ? [group.panelId] : [])));
	const hiddenPanelIds = (candidate: readonly SidebarGroup[]): string[] => {
		const visible = new Set(candidate.flatMap((group) => (group.panelId ? [group.panelId] : [])));
		return [...sourcePanelIds].filter((panelId) => !visible.has(panelId));
	};
	let candidate = compactGroups(source, height);
	let hidden = hiddenPanelIds(candidate);
	if (hidden.length > 0 && height > 0) {
		candidate = compactGroups(source, Math.max(0, height - 1));
		hidden = hiddenPanelIds(candidate);
	}
	return { groups: candidate, hiddenPanelIds: hidden };
}

export interface SidebarRenderOptions {
	collapsedPanelIds?: ReadonlySet<string>;
	chartGraphics?: SidebarChartGraphics;
}

export function renderSidebarFrame(
	snapshot: SidebarSnapshot,
	config: AtelierConfig,
	theme: ThemeLike,
	width: number,
	height: number,
	colorEnabled = true,
	now = Date.now(),
	resizing = false,
	options: SidebarRenderOptions = {},
): SidebarFrame {
	const palette = createPalette(theme, colorEnabled, config.colorScheme);
	const safeWidth = Math.max(0, Math.trunc(width));
	const safeHeight = Math.max(0, Math.trunc(height));
	if (safeWidth <= 0 || safeHeight <= 0) return { lines: [], hitRegions: [] };
	const contentWidth = Math.max(0, safeWidth - 2);
	const panelContentWidth = Math.max(0, contentWidth - 4);
	const layout = sidebarLayout(safeWidth, config);
	const collapsedPanelIds = options.collapsedPanelIds ?? new Set<string>();
	const chartGraphics = options.chartGraphics ?? {};
	const toolNameRows = layout.showToolNames ? activeToolNameRows(snapshot, panelContentWidth, palette) : [];
	const mcpRows = mcpServerRows(snapshot, panelContentWidth, palette);
	const workspace = workspaceRows(snapshot, panelContentWidth, palette, theme);
	const workspacePanelTitle = sanitize(snapshot.projectName) || "Workspace";
	const groups: SidebarGroup[] = [
		...(resizing
			? [
					{
						name: "resize",
						rows: [palette.paint("warning", "Resize · drag divider"), ""],
						required: true,
						dropRank: Number.POSITIVE_INFINITY,
					},
				]
			: []),
		{
			name: "agent",
			panel: "AGENT",
			panelId: "agent",
			panelRole: snapshot.activity,
			panelJewel:
				snapshot.activity === "working" && Math.floor(now / SIDEBAR_DYNAMIC_RENDER_INTERVAL_MS) % 2 === 1
					? "✧"
					: "✦",
			rows: agentRows(snapshot, panelContentWidth, palette, theme),
			required: true,
			dropRank: Number.POSITIVE_INFINITY,
		},
		...activitySidebarGroups(snapshot, panelContentWidth, palette, now),
		{
			name: "statusDetails",
			panel: "ALERTS",
			panelId: "alerts",
			panelRole: statusDetailPanelRole(snapshot),
			rows: statusDetailRows(snapshot, palette),
			required: false,
			dropRank: 80,
		},
		{
			name: "todos",
			panel: "TODOS",
			panelId: "todos",
			panelRole: "accent",
			rows: todosRows(snapshot, palette),
			required: false,
			dropRank: 90,
		},
		{
			name: "workspaceCore",
			panel: "WORKSPACE",
			panelTitle: workspacePanelTitle,
			preservePanelTitleCase: true,
			panelId: "workspace",
			panelRole: "accent",
			rows: workspace.identity,
			required: false,
			dropRank: 30,
		},
		{
			name: "workspaceMetadata",
			panel: "WORKSPACE",
			panelTitle: workspacePanelTitle,
			preservePanelTitleCase: true,
			panelId: "workspace",
			panelRole: "accent",
			rows: workspace.metadata,
			required: false,
			dropRank: 30,
		},
		{
			name: "workspaceDetails",
			panel: "WORKSPACE",
			panelTitle: workspacePanelTitle,
			preservePanelTitleCase: true,
			panelId: "workspace",
			panelRole: "accent",
			rows: workspace.pulseDetails,
			required: false,
			dropRank: 6,
		},
		{
			name: "workspaceSession",
			panel: "WORKSPACE",
			panelTitle: workspacePanelTitle,
			preservePanelTitleCase: true,
			panelId: "workspace",
			panelRole: "accent",
			rows: workspace.session,
			required: false,
			dropRank: 4,
		},
		{
			name: "usageContext",
			panel: "USAGE",
			panelId: "usage",
			panelRole: "output",
			rows: contextRows(snapshot, config, panelContentWidth, palette, theme, colorEnabled),
			required: true,
			dropRank: Number.POSITIVE_INFINITY,
		},
		{
			name: "usageMetrics",
			panel: "USAGE",
			panelId: "usage",
			panelRole: "output",
			rows: usageRows(snapshot, config, panelContentWidth, palette),
			required: false,
			dropRank: 20,
		},
		...subagentGroups(snapshot, config, panelContentWidth, palette, chartGraphics),
		{
			name: "toolsStatus",
			panel: "TOOLS",
			panelId: "tools",
			panelRole: "cache",
			rows: toolsStatusRows(snapshot, panelContentWidth, palette),
			rowActions: [safeWidth > COMPACT_SIDEBAR_MAX_WIDTH ? { type: "toggle-tool-names" } : undefined],
			required: false,
			dropRank: 10,
		},
		...toolNameRows.map((row, index, rows) => ({
			name: `activeToolNames:${index}`,
			panel: "TOOLS",
			panelId: "tools",
			panelRole: "cache" as const,
			rows: [row],
			required: false,
			dropRank: (rows.length - index) / 100,
		})),
		...(mcpRows.length > 0
			? [
					{
						name: "mcpServers",
						panel: "MCP SERVERS",
						preservePanelTitleCase: true,
						panelId: "mcp",
						panelRole: "ready" as const,
						rows: mcpRows,
						required: false,
						dropRank: 8,
					},
				]
			: []),
	];

	// Keep panel content grouped while making the user-owned order the only
	// source of top-to-bottom composition. Contributed panels are available only
	// when a current registry snapshot exists; their saved entries remain in the
	// layout and are therefore still visible to Settings as unavailable.
	const contributed = new Map((snapshot.sidebarPanels ?? []).map((panel) => [panel.id, panel]));
	const grouped = new Map<string, SidebarGroup[]>();
	for (const group of groups) {
		const id = group.panelId;
		if (!id) continue;
		const list = grouped.get(id) ?? [];
		list.push(group);
		grouped.set(id, list);
	}
	const ordered: SidebarGroup[] = groups.filter((group) => !group.panel);
	let availableVisible = false;
	for (const entry of config.sidebarPanelLayout) {
		if (!entry.visible) continue;
		const builtin = BUILTIN_SIDEBAR_PANEL_IDS.includes(
			entry.id as (typeof BUILTIN_SIDEBAR_PANEL_IDS)[number],
		);
		const panel = isSidebarPanelContributionId(entry.id) ? contributed.get(entry.id) : undefined;
		if (builtin && (entry.id !== "mcp" || grouped.has(entry.id))) {
			availableVisible = true;
			ordered.push(...(grouped.get(entry.id) ?? []));
		} else if (panel) {
			availableVisible = true;
			const rows = contributedContent(panel, palette, config, panelContentWidth);
			ordered.push({
				name: `contributed:${panel.id}`,
				panel: properCase(sanitize(panel.title)) || panel.id,
				panelId: panel.id,
				panelRole: panel.role ?? "accent",
				rows: rows.length > 0 ? rows : [palette.paint("dim", "No data")],
				required: false,
				dropRank: 25,
			});
		}
	}
	if (!availableVisible) {
		ordered.push({
			name: "empty",
			panel: "SIDEBAR",
			panelId: "__empty__",
			panelRole: "muted",
			rows: ["No available panels", "Open /atelier Settings"],
			required: true,
			dropRank: Number.POSITIVE_INFINITY,
		});
	}
	const composed = composeGroups(ordered, safeHeight);
	const hiddenCount = composed.hiddenPanelIds.length;
	const visibleGroups: SidebarGroup[] = hiddenCount
		? [
				{
					name: "hiddenPanels",
					rows: [
						palette.paint(
							"muted",
							`${hiddenCount} ${hiddenCount === 1 ? "panel" : "panels"} hidden · /atelier display`,
						),
					],
					required: true,
					dropRank: Number.POSITIVE_INFINITY,
				},
				...composed.groups,
			]
		: composed.groups;
	const groupFrame = renderGroupsFrame(visibleGroups, contentWidth, palette, theme, collapsedPanelIds);
	return {
		lines: renderDock(groupFrame.rows, safeWidth, safeHeight, palette, resizing),
		hitRegions: groupFrame.hitRegions,
	};
}

export function renderSidebarLines(
	snapshot: SidebarSnapshot,
	config: AtelierConfig,
	theme: ThemeLike,
	width: number,
	height: number,
	colorEnabled = true,
	now = Date.now(),
	resizing = false,
	options: SidebarRenderOptions = {},
): string[] {
	return renderSidebarFrame(snapshot, config, theme, width, height, colorEnabled, now, resizing, options)
		.lines;
}

export interface SidebarComponentOptions {
	getSnapshot(): SidebarSnapshot;
	getConfig(): AtelierConfig;
	getHeight(): number;
	getRevision?(): number;
	isResizing?(): boolean;
	canRenderImages?(): boolean;
	onFrame?(frame: SidebarFrame): void;
	getCollapsedPanelIds?(): ReadonlySet<string>;
	theme: ThemeLike;
	colorEnabled?: boolean;
}

function renderSidebarError(error: unknown, width: number, height: number, resizing = false): string[] {
	let detail = "Unknown error";
	try {
		detail = sanitize(error instanceof Error ? error.message : String(error)) || detail;
	} catch {
		// Keep the fallback render path safe even for unusual thrown values.
	}
	return renderDock(
		["Sidebar unavailable", detail],
		width,
		height,
		{
			paint: (_role, text) => text,
		},
		resizing,
	);
}

export function createSidebarComponent(options: SidebarComponentOptions): Component {
	const imageOwner = {};
	let cached: { key: string; frame: SidebarFrame } | undefined;
	return {
		render(width) {
			const height = options.getHeight();
			let resizing = false;
			try {
				resizing = options.isResizing?.() ?? false;
				const collapsedPanelIds = options.getCollapsedPanelIds?.();
				const canRenderImages = options.canRenderImages?.();
				const revision = options.getRevision?.();
				const cacheable = revision !== undefined && Number.isSafeInteger(revision);
				const now = Date.now();
				const timeBucket = Math.floor(now / SIDEBAR_DYNAMIC_RENDER_INTERVAL_MS);
				const colorEnabled = options.colorEnabled ?? true;
				const collapsedKey = collapsedPanelIds ? [...collapsedPanelIds].sort().join("\u0000") : "";
				const key = `${revision ?? "uncached"}:${timeBucket}:${width}:${height}:${resizing ? 1 : 0}:${canRenderImages === false ? 0 : 1}:${colorEnabled ? 1 : 0}:${options.theme.name ?? ""}:${collapsedKey}`;
				if (cacheable && cached?.key === key) return cached.frame.lines;
				const frame = renderSidebarFrame(
					options.getSnapshot(),
					options.getConfig(),
					options.theme,
					width,
					height,
					colorEnabled,
					now,
					resizing,
					{
						...(collapsedPanelIds ? { collapsedPanelIds } : {}),
						chartGraphics: {
							imageOwner: options.canRenderImages ? imageOwner : undefined,
							suspendPlot: canRenderImages === false,
						},
					},
				);
				cached = cacheable ? { key, frame } : undefined;
				options.onFrame?.(frame);
				return frame.lines;
			} catch (error) {
				cached = undefined;
				const lines = renderSidebarError(error, width, height, resizing);
				options.onFrame?.({ lines, hitRegions: [] });
				return lines;
			}
		},
		invalidate() {
			cached = undefined;
		},
	};
}

export interface SidebarController {
	show(): void;
	hide(): void;
	toggle(): void;
	isVisible(): boolean;
	beginResize(): boolean;
	isResizing(): boolean;
	getWidth(): number;
	setPanelCollapsed(panelId: string, collapsed?: boolean): boolean;
	isPanelCollapsed(panelId: string): boolean;
	requestRender(): void;
	dispose(): void;
}

export interface SidebarControllerOptions {
	ctx: ExtensionContext;
	getSnapshot(): SidebarSnapshot;
	getConfig(): AtelierConfig;
	onSidebarAction?(action: SidebarAction): void;
	colorEnabled?: boolean;
	shouldAnimate?(): boolean;
	animationIntervalMs?: number;
	onWarning?(message: string): void;
	onError?(error: unknown): void;
}

interface RetirableSidebarBinding {
	getSnapshot(): SidebarSnapshot;
	getConfig(): AtelierConfig;
	isResizing(): boolean;
	setResizing(reader: () => boolean): void;
	detach(): void;
}

function createDetachedSidebarSnapshot(cwd: string): SidebarSnapshot {
	return buildSidebarSnapshot({
		state: {
			activity: "ready",
			dirty: false,
			workspacePulse: { status: "unavailable" },
			metrics: aggregateMetrics([], { subscription: false, autoCompact: null }),
			extensionStatuses: [],
		},
		cwd,
		branchEntryCount: 0,
		activeToolCount: 0,
		availableToolCount: 0,
		activeToolNames: [],
		extensionStatuses: [],
		todos: [],
		sidebarPanels: [],
	});
}

function createRetirableSidebarBinding(options: SidebarControllerOptions): RetirableSidebarBinding {
	let readSnapshot: (() => SidebarSnapshot) | undefined = options.getSnapshot;
	let readConfig: (() => AtelierConfig) | undefined = options.getConfig;
	let readResizing: (() => boolean) | undefined;
	let snapshot = createDetachedSidebarSnapshot(typeof options.ctx.cwd === "string" ? options.ctx.cwd : "");
	let config = structuredClone(DEFAULT_CONFIG);
	return {
		getSnapshot: () => (readSnapshot ? readSnapshot() : snapshot),
		getConfig: () => (readConfig ? readConfig() : config),
		isResizing: () => readResizing?.() ?? false,
		setResizing: (reader) => {
			if (readSnapshot) readResizing = reader;
		},
		detach: () => {
			if (readSnapshot) {
				try {
					snapshot = structuredClone(readSnapshot());
				} catch {
					// The inert snapshot is already detached from the retired runtime.
				}
			}
			if (readConfig) {
				try {
					config = structuredClone(readConfig());
				} catch {
					// Keep the last plain configuration snapshot.
				}
			}
			readSnapshot = undefined;
			readConfig = undefined;
			readResizing = undefined;
		},
	};
}

export function createSidebarController(options: SidebarControllerOptions): SidebarController {
	const binding = createRetirableSidebarBinding(options);
	let enabled = false;
	let disposed = false;
	let generation = 0;
	let closeOverlay: (() => void) | undefined;
	let restoreStoppedCursor: (() => void) | undefined;
	let requestOverlayRender: (() => void) | undefined;
	let overlayHandle: OverlayHandle | undefined;
	let animationTimer: ReturnType<typeof setInterval> | undefined;
	let renderRevision = 0;
	const collapsedPanelIds = new Set<string>();
	const animationIntervalMs = Math.max(1, Math.trunc(options.animationIntervalMs ?? 1_000));

	const reportError = (error: unknown) => {
		try {
			options.onError?.(error);
		} catch {
			// External error reporting must not interrupt lifecycle cleanup.
		}
	};

	const safely = (action: () => unknown): boolean => {
		try {
			action();
			return true;
		} catch (error) {
			reportError(error);
			return false;
		}
	};

	const setPanelCollapsed = (panelId: string, collapsed?: boolean): boolean => {
		const next = collapsed ?? !collapsedPanelIds.has(panelId);
		if (next === collapsedPanelIds.has(panelId)) return next;
		if (next) collapsedPanelIds.add(panelId);
		else collapsedPanelIds.delete(panelId);
		renderRevision += 1;
		safely(() => requestOverlayRender?.());
		return next;
	};

	const split: SplitPaneController = createSplitPaneController({
		...(typeof options.ctx.ui.onTerminalInput === "function"
			? { subscribeInput: (handler) => options.ctx.ui.onTerminalInput(handler) }
			: {}),
		onResizeChange: () => {
			renderRevision += 1;
			safely(() => requestOverlayRender?.());
		},
		onSidebarAction: (action) => {
			if (action.type === "toggle-panel-body") {
				setPanelCollapsed(action.panelId);
				return;
			}
			renderRevision += 1;
			options.onSidebarAction?.(action);
		},
		...(options.onWarning ? { onWarning: options.onWarning } : {}),
		...(options.onError ? { onError: options.onError } : {}),
	});

	binding.setResizing(split.isResizing);

	const stopAnimation = () => {
		if (!animationTimer) return;
		clearInterval(animationTimer);
		animationTimer = undefined;
	};

	const syncAnimation = () => {
		if (!enabled || options.shouldAnimate?.() !== true || !requestOverlayRender) {
			stopAnimation();
			return;
		}
		if (animationTimer) return;
		animationTimer = setInterval(() => {
			renderRevision += 1;
			safely(() => requestOverlayRender?.());
		}, animationIntervalMs);
		animationTimer.unref?.();
	};

	const clearOverlayCallbacks = () => {
		closeOverlay = undefined;
		restoreStoppedCursor = undefined;
		requestOverlayRender = undefined;
		overlayHandle = undefined;
	};

	const hide = () => {
		if (!enabled && !closeOverlay && !overlayHandle && !split.isEnabled()) return;
		enabled = false;
		generation += 1;
		stopAnimation();
		split.setSidebarHitRegions([]);
		safely(split.cancelResize);
		const close = closeOverlay;
		const handle = overlayHandle;
		const restoreCursor = restoreStoppedCursor;
		clearOverlayCallbacks();
		if (close) safely(close);
		else if (handle) safely(() => handle.hide());
		safely(split.hide);
		if (restoreCursor) safely(restoreCursor);
	};

	const show = () => {
		if (disposed || enabled) return;
		if (options.ctx.mode !== "tui") {
			reportError(new Error("Pi Atelier sidebar requires TUI mode"));
			return;
		}

		enabled = true;
		const currentGeneration = ++generation;
		if (!safely(split.show)) {
			enabled = false;
			stopAnimation();
			clearOverlayCallbacks();
			safely(split.hide);
			return;
		}
		try {
			const pending = options.ctx.ui.custom<void>(
				(tui, theme, _keybindings, done) => {
					let closed = false;
					const close = () => {
						if (closed) return;
						closed = true;
						done(undefined);
					};
					if (!safely(() => split.attach(tui))) {
						enabled = false;
						generation += 1;
						stopAnimation();
						clearOverlayCallbacks();
						safely(split.hide);
						safely(close);
					} else {
						if (enabled && generation === currentGeneration) {
							closeOverlay = close;
							restoreStoppedCursor = () => {
								// Pi can close overlays after stop() restored the terminal (#72).
								// The internal flag is optional; never change the cursor of a live TUI.
								if ((tui as unknown as { stopped?: boolean }).stopped === true) {
									tui.terminal.showCursor();
								}
							};
							requestOverlayRender = () => tui.requestRender();
							syncAnimation();
						} else {
							close();
						}
					}
					return createSidebarComponent({
						getSnapshot: binding.getSnapshot,
						getConfig: binding.getConfig,
						getHeight: () => tui.terminal.rows,
						getRevision: () => renderRevision,
						isResizing: binding.isResizing,
						canRenderImages: () => !hasCapturingOverlay(tui),
						onFrame: (frame) => split.setSidebarHitRegions(frame.hitRegions),
						getCollapsedPanelIds: () => collapsedPanelIds,
						theme: theme as unknown as ThemeLike,
						...(options.colorEnabled === undefined ? {} : { colorEnabled: options.colorEnabled }),
					});
				},
				{
					overlay: true,
					overlayOptions: () => split.overlayOptions(),
					onHandle: (handle) => {
						if (enabled && generation === currentGeneration) {
							overlayHandle = handle;
							syncAnimation();
						} else {
							safely(() => handle.hide());
						}
					},
				},
			);
			void pending
				.catch((error: unknown) => {
					reportError(error);
				})
				.finally(() => {
					if (generation !== currentGeneration) return;
					enabled = false;
					stopAnimation();
					clearOverlayCallbacks();
					safely(split.hide);
				});
		} catch (error) {
			if (generation === currentGeneration) {
				enabled = false;
				stopAnimation();
				clearOverlayCallbacks();
				safely(split.hide);
			}
			reportError(error);
		}
	};

	return {
		show,
		hide,
		toggle() {
			if (enabled) hide();
			else show();
		},
		isVisible() {
			return enabled;
		},
		beginResize: split.beginResize,
		isResizing: split.isResizing,
		getWidth: split.getSidebarWidth,
		setPanelCollapsed,
		isPanelCollapsed: (panelId) => collapsedPanelIds.has(panelId),
		requestRender() {
			renderRevision += 1;
			// Still refresh the overlay if adapter reconciliation fails.
			if (!safely(split.requestRender)) safely(() => requestOverlayRender?.());
			syncAnimation();
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			hide();
			binding.detach();
			safely(split.dispose);
		},
	};
}
