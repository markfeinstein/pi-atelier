import { disposeAfterTest } from "./helpers/cleanup.js";
import { fakeTui, overlayHost } from "./helpers/overlay-host.js";
import { settleMicrotasks } from "./helpers/async.js";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_RUN_ACTIVITY, type RunActivitySnapshot } from "../src/run-activity.js";
import {
	buildSidebarSnapshot,
	createSidebarComponent,
	createSidebarController,
	renderSidebarFrame,
	renderSidebarLines,
} from "../src/sidebar.js";
import { DEFAULT_SIDEBAR_WIDTH } from "../src/split-pane.js";
import { type AtelierState, DEFAULT_CONFIG } from "../src/types.js";

const stripAnsi = (text: string) => text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");

const theme = {
	name: "dark",
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	italic: (text: string) => text,
};

afterEach(() => {
	vi.useRealTimers();
});

const state: AtelierState = {
	activity: "working",
	workingLabel: "GITIFYING",
	modelId: "gpt-5.6-sol",
	provider: "openai-codex",
	thinkingLevel: "medium",
	branch: "feature/sidebar",
	dirty: true,
	workspacePulse: {
		status: "changed",
		data: {
			root: "/Users/example/projects/pi-atelier",
			relativeCwd: "",
			branch: "feature/sidebar",
			snapshot: {
				trackedFiles: 5,
				untrackedFiles: 2,
				linesAdded: 182,
				linesRemoved: 47,
				binaryFiles: 0,
				submodules: 0,
				conflicts: 0,
			},
		},
	},
	metrics: {
		usageAvailable: true,
		costAvailable: true,
		input: 50_000,
		output: 1_900,
		cacheRead: 100_000,
		cacheWrite: 0,
		cacheHitPercent: 96,
		cost: 0.479,
		subscription: true,
		contextTokens: 32_400,
		contextWindow: 400_000,
		contextPercent: 8.1,
		autoCompact: true,
	},
	extensionStatuses: [],
};

function snapshot() {
	return buildSidebarSnapshot({
		state,
		cwd: "/Users/example/projects/pi-atelier",
		sessionName: "Sidebar implementation",
		sessionFile: "/tmp/session.jsonl",
		branchEntryCount: 38,
		activeToolCount: 8,
		availableToolCount: 12,
		extensionStatuses: ["tests passing"],
		runActivity: EMPTY_RUN_ACTIVITY,
	});
}

function withActivity(runActivity: Partial<RunActivitySnapshot>) {
	return { ...snapshot(), runActivity: { ...structuredClone(EMPTY_RUN_ACTIVITY), ...runActivity } };
}

function activeActivity(): RunActivitySnapshot {
	return {
		phase: "running",
		turnNumber: 3,
		startedAt: 1_000,
		activeTools: [
			{
				id: "read-1",
				name: "read",
				summary: "src/state.ts",
				status: "running",
				startedAt: 2_000,
			},
		],
		recentTools: [
			{
				id: "bash-1",
				name: "bash",
				summary: "npm test",
				status: "done",
				startedAt: 12_000,
				durationMs: 4_000,
			},
		],
		completedCount: 2,
		failedCount: 1,
	};
}

function contentRows(lines: string[]) {
	return lines.map((line) => {
		const row = stripAnsi(line).slice(2).trimEnd();
		const title = row.match(/^╭─ [✦✧] (.*?) ─*╮$/u)?.[1];
		if (title) return title;
		if (/^╰─+╯$/.test(row)) return "";
		if (row.startsWith("│ ") && row.endsWith(" │")) return row.slice(2, -2).trimEnd();
		return row;
	});
}

function renderRows(
	value: ReturnType<typeof snapshot>,
	{
		config = DEFAULT_CONFIG,
		width = 44,
		height = 60,
		color = true,
		now,
	}: { config?: typeof DEFAULT_CONFIG; width?: number; height?: number; color?: boolean; now?: number } = {},
) {
	return contentRows(renderSidebarLines(value, config, theme, width, height, color, now));
}

const flushOverlay = settleMicrotasks;

describe("sidebar snapshot and layout", () => {
	it("composes visible panels in persisted order and keeps unavailable entries out of rendering", () => {
		const ordered = {
			...DEFAULT_CONFIG,
			sidebarPanelLayout: [
				{ id: "vendor:queue" as const, visible: true },
				{ id: "tools" as const, visible: true },
				{ id: "activity" as const, visible: true },
				...DEFAULT_CONFIG.sidebarPanelLayout
					.filter((entry) => !["tools", "activity"].includes(entry.id))
					.map((entry) => ({ ...entry, visible: !["agent", "todos"].includes(entry.id) })),
			],
		};
		const lines = renderSidebarLines(
			{
				...snapshot(),
				sidebarPanels: [
					{
						id: "vendor:queue",
						title: "Queue",
						rows: [{ text: "queued 2" }],
						available: true,
						source: "vendor",
					},
				],
			},
			ordered,
			theme,
			44,
			36,
		);
		const text = contentRows(lines).join("\n");
		expect(text.indexOf("Queue")).toBeGreaterThanOrEqual(0);
		expect(text.indexOf("Queue")).toBeLessThan(text.indexOf("Tools"));
		expect(text).not.toContain("Agent");
	});

	it("builds the approved core overview", () => {
		expect(snapshot()).toMatchObject({
			projectName: "pi-atelier",
			branch: "feature/sidebar",
			dirty: true,
			sessionName: "Sidebar implementation",
			persisted: true,
			branchEntryCount: 38,
			activeToolCount: 8,
			availableToolCount: 12,
		});
	});

	it("sanitizes contributed title and structured row text at render time", () => {
		const config = {
			...DEFAULT_CONFIG,
			sidebarPanelLayout: [
				{ id: "vendor:unsafe" as const, visible: true },
				...DEFAULT_CONFIG.sidebarPanelLayout.map((entry) => ({ ...entry, visible: false })),
			],
		};
		const rendered = renderSidebarLines(
			{
				...snapshot(),
				sidebarPanels: [
					{
						id: "vendor:unsafe",
						title: "\u001b[31mUnsafe\nTitle",
						rows: [{ text: "row\nvalue\u001b[33m", role: "warning" }],
						available: true,
						source: "vendor",
					},
				],
			},
			config,
			theme,
			44,
			20,
			false,
			0,
		).join("\n");
		expect(rendered).toContain("Unsafe Title");
		expect(rendered).toContain("row value");
		expect(rendered).not.toContain("[31m");
		expect(rendered).not.toContain("[33m");
	});

	it("renders an explicit empty state when every configured-visible panel is unavailable", () => {
		const hiddenBuiltins = DEFAULT_CONFIG.sidebarPanelLayout.map((entry) => ({ ...entry, visible: false }));
		const emptyConfig = {
			...DEFAULT_CONFIG,
			sidebarPanelLayout: [{ id: "vendor:missing" as const, visible: true }, ...hiddenBuiltins],
		};
		const rows = renderRows(snapshot(), { config: emptyConfig, height: 20 });
		expect(rows).toContain("No available panels");
		expect(rows).toContain("Open /atelier Settings");
	});

	it("renders a full-height dock with elegant terminal-native panels", () => {
		const lines = renderSidebarLines(snapshot(), DEFAULT_CONFIG, theme, 44, 60, false, 0);
		const text = lines.join("\n");
		expect(lines).toHaveLength(60);
		expect(lines.every((line) => visibleWidth(line) <= 44)).toBe(true);
		expect(lines.every((line) => stripAnsi(line).startsWith("  "))).toBe(true);
		expect(lines.every((line) => !stripAnsi(line).startsWith("│ "))).toBe(true);
		expect(text).toContain("╭─ ✦ Agent ");
		expect(text).toContain("╭─ ✦ Usage ");
		expect(text).toContain("╰────────────────");
		expect(text).not.toContain("ATELIER");
		expect(text).not.toMatch(/PI ATELIER|ATELIER|▛▀▜/);
		expect(contentRows(lines)[0]).toBe("Workspace");
		expect(contentRows(lines)).toContain("pi-atelier · feature/sidebar ▲");
		expect(contentRows(lines)).toContainEqual(
			expect.stringMatching(/^◆ Working · gitifying\s+gpt-5\.6-sol$/),
		);
	});

	it("renders a scan-first Workspace Pulse without repeating the repository root path", () => {
		const rows = renderRows(snapshot(), { color: false, now: 0 });

		expect(rows).toContain("5 tracked  +182  −47");
		expect(rows).toContain("2 untracked");
		expect(rows).not.toContain("/Users/example/projects/pi-atelier");
		expect(rows).toContain("Sidebar implementation");
		expect(rows).toContain("38 entries · persisted");
	});

	it.each([
		[{ status: "inspecting" as const }, "inspecting…"],
		[{ status: "not-repo" as const }, "not a Git repository"],
		[{ status: "unavailable" as const }, "Git unavailable"],
	])("renders the %s Pulse state explicitly", (workspacePulse, expected) => {
		const { branch: _branch, ...withoutBranch } = snapshot();
		const rows = renderRows({ ...withoutBranch, workspacePulse, dirty: false }, { color: false, now: 0 });
		expect(rows).toContain(expected);
	});

	it("keeps conflict and stale signals visible without expanding every Git category", () => {
		if (!("data" in state.workspacePulse)) throw new Error("expected fixture Pulse data");
		const data = {
			...state.workspacePulse.data,
			relativeCwd: "packages/api",
			snapshot: {
				...state.workspacePulse.data.snapshot,
				binaryFiles: 1,
				submodules: 1,
				conflicts: 2,
			},
		};
		const conflictRows = renderRows(
			{ ...snapshot(), workspacePulse: { status: "conflict", data } },
			{ color: false, now: 0 },
		);
		expect(conflictRows).toContain("./packages/api");
		expect(conflictRows).toContain("2 conflicts");
		expect(conflictRows).toContain("2 untracked · 1 binary · 1 submodule");

		const staleRows = renderRows(
			{ ...snapshot(), workspacePulse: { status: "stale", data } },
			{ color: false, now: 0 },
		);
		expect(staleRows).toContain("~ stale · 5 tracked  +182  −47");

		const compactRows = renderRows(
			{ ...snapshot(), workspacePulse: { status: "stale", data } },
			{ width: 28, color: false, now: 0 },
		);
		expect(compactRows).toContain("~ stale · 5 tracked");
		expect(compactRows).toContain("+182  −47");
		expect(compactRows).toContain("?2 · bin1 · sub1");
	});

	it("drops Session and optional Pulse detail before the Workspace identity and core summary", () => {
		const rows = renderRows(snapshot(), { height: 27, color: false, now: 0 });

		expect(rows).toContain("Workspace");
		expect(rows).toContain("pi-atelier · feature/sidebar ▲");
		expect(rows).toContain("5 tracked  +182  −47");
		expect(rows).not.toContain("2 untracked");
		expect(rows).not.toContain("Sidebar implementation");
		expect(rows).not.toContain("38 entries · persisted");
	});

	it("pulses only the working Agent jewel while keeping other crowns stable", () => {
		const bright = renderSidebarLines(snapshot(), DEFAULT_CONFIG, theme, 44, 60, false, 0).join("\n");
		const soft = renderSidebarLines(snapshot(), DEFAULT_CONFIG, theme, 44, 60, false, 400).join("\n");
		expect(bright).toContain("╭─ ✦ Agent ");
		expect(soft).toContain("╭─ ✧ Agent ");
		expect(bright).toContain("╭─ ✦ Usage ");
		expect(soft).toContain("╭─ ✦ Usage ");
	});

	it("tints panel crowns with their semantic jewel roles", () => {
		const fg = vi.fn((_color: string, text: string) => text);
		renderSidebarLines(
			snapshot(),
			DEFAULT_CONFIG,
			{ fg, bold: theme.bold, italic: theme.italic },
			44,
			60,
			true,
			0,
		);
		expect(fg).toHaveBeenCalledWith("mdHeading", "╭─ ✦ ");
		expect(fg).toHaveBeenCalledWith("thinkingLow", "╭─ ✦ ");
		expect(fg).toHaveBeenCalledWith("thinkingHigh", "╭─ ✦ ");
		expect(fg).toHaveBeenCalledWith("syntaxType", "╭─ ✦ ");
	});

	it("matches the representative 44x60 no-color docked rail", () => {
		const noSession = buildSidebarSnapshot({
			state: { ...state, extensionStatuses: [] },
			cwd: "/Users/example/projects/pi-atelier",
			branchEntryCount: 6,
			activeToolCount: 8,
			availableToolCount: 12,
			extensionStatuses: [],
		});
		expect(renderRows(noSession, { color: false })).toMatchInlineSnapshot(`
			[
			  "Workspace",
			  "pi-atelier · feature/sidebar ▲",
			  "5 tracked  +182  −47",
			  "2 untracked",
			  "6 entries · ephemeral",
			  "",
			  "",
			  "Agent",
			  "◆ Working · gitifying      gpt-5.6-sol",
			  "OpenAI-Codex · Medium · Subscription",
			  "",
			  "",
			  "Activity",
			  "First token                          —",
			  "Output speed                         —",
			  "",
			  "",
			  "Usage",
			  "██░░░░░░░░░░░░░░░░░░░░░░░░░░░░    8.1%",
			  "Tokens                      32k / 400k",
			  "Input                            50.0k",
			  "Output                            1.9k",
			  "Cache read                      100.0k",
			  "Cache hit                        96.0%",
			  "Cost                            $0.479",
			  "",
			  "",
			  "Tools",
			  "Enabled                         8 / 12",
			  "",
			  "",
			  "",
			  "",
			  "",
			  "",
			  "",
			  "",
			  "",
			  "",
			  "",
			  "",
			  "",
			  "",
			  "",
			  "",
			  "",
			  "",
			  "",
			  "",
			  "",
			  "",
			  "",
			  "",
			  "",
			  "",
			  "",
			  "",
			  "",
			  "",
			  "",
			]
		`);
	});

	it("renders organized sections without exceeding width", () => {
		for (const width of [32, 40, 44]) {
			const rows = renderRows(snapshot(), { width: width, color: false });
			expect(rows.join("\n")).not.toContain("ATELIER");
			expect(rows.join("\n")).toContain("Workspace");
			expect(rows.join("\n")).toContain("Usage");
			expect(rows).toContain("Tools");
			expect(rows.every((row) => !row.startsWith("STATUS "))).toBe(true);
			expect(
				renderSidebarLines(snapshot(), DEFAULT_CONFIG, theme, width, 60, false).every(
					(line) => visibleWidth(line) <= width,
				),
			).toBe(true);
		}
	});

	it("keeps labeled metrics readable in narrow and wide panels", () => {
		const expandedConfig = { ...DEFAULT_CONFIG, showSidebarToolNames: true };
		const compact = renderRows(snapshot(), { config: expandedConfig, width: 28, color: false });
		expect(compact).toContain("◆ Working · gitifying");
		expect(compact).toContain("gpt-5.6-sol");
		expect(compact).toContain("OpenAI-Codex");
		expect(compact).toContain("Medium · Subscription");
		const compactContext = compact.indexOf("Usage");
		expect(compact[compactContext + 1]).toMatch(/^[█░]+\s+8\.1%$/);
		expect(compact[compactContext + 2]).toMatch(/^Tokens\s+32k \/ 400k$/);
		expect(compact).toContain("pi-atelier");
		expect(compact).toContain("feature/sidebar ▲");
		expect(compact).toContainEqual(expect.stringMatching(/^Input\s+50\.0k$/));
		expect(compact).toContainEqual(expect.stringMatching(/^Cache read\s+100\.0k$/));
		expect(compact).toContainEqual(expect.stringMatching(/^Enabled\s+8 \/ 12$/));
		expect(compact).toEqual(expect.not.arrayContaining([expect.stringMatching(/subs$/)]));

		const regular = renderRows(snapshot(), { config: expandedConfig, color: false });
		expect(regular).toContainEqual(expect.stringMatching(/^◆ Working · gitifying\s+gpt-5\.6-sol$/));
		expect(regular).toContain("OpenAI-Codex · Medium · Subscription");
		expect(regular).toContain("pi-atelier · feature/sidebar ▲");
		expect(regular).toContainEqual(expect.stringMatching(/^Enabled\s+8 \/ 12$/));
	});

	it("preserves the labeled hierarchy across the compact threshold", () => {
		const expandedConfig = { ...DEFAULT_CONFIG, showSidebarToolNames: true };
		const compact = renderRows(snapshot(), { config: expandedConfig, width: 39, color: false });
		expect(compact).toContain("◆ Working · gitifying");
		expect(compact).toContain("gpt-5.6-sol");
		expect(compact).not.toContainEqual(expect.stringMatching(/^◆ Working.*gpt-5\.6-sol$/));

		for (const width of [40, 43, 44]) {
			const regular = renderRows(snapshot(), { config: expandedConfig, width: width, color: false });
			expect(regular).toContainEqual(expect.stringMatching(/^◆ Working · gitifying\s+gpt-5\.6-sol$/));
			expect(regular).toContainEqual(expect.stringMatching(/^OpenAI-Codex/));
			expect(regular).toContainEqual(expect.stringMatching(/^Enabled\s+8 \/ 12$/));
		}
	});

	it("renders a context meter and labeled token count that adapt to width", () => {
		const narrow = renderRows(snapshot(), { width: 28, color: false });
		const narrowContext = narrow.indexOf("Usage");
		expect(narrow[narrowContext + 1]).toMatch(/^[█░]+\s+8\.1%$/);
		expect(narrow[narrowContext + 2]).toMatch(/^Tokens\s+32k \/ 400k$/);

		for (const width of [40, 44, 72]) {
			const rows = renderRows(snapshot(), { width: width, color: false });
			const contextIndex = rows.indexOf("Usage");
			expect(rows[contextIndex + 1]).toMatch(/^[█░]+\s+8\.1%$/);
			expect(rows[contextIndex + 2]).toMatch(/^Tokens\s+32k \/ 400k$/);
			expect(visibleWidth(rows[contextIndex + 1] ?? "")).toBeLessThanOrEqual(width - 6);
		}
	});

	it("omits a standalone unavailable marker when session name is missing", () => {
		const missingSession = buildSidebarSnapshot({
			state,
			cwd: "/tmp/project",
			branchEntryCount: 6,
			activeToolCount: 8,
			availableToolCount: 12,
			extensionStatuses: [],
		});
		const rows = renderRows(missingSession, { color: false });
		const workspaceIndex = rows.indexOf("Workspace");
		expect(workspaceIndex).toBe(0);
		const agentIndex = rows.indexOf("Agent");
		const workspaceRows = rows.slice(workspaceIndex + 1, agentIndex);
		expect(workspaceRows).not.toContain("—");
		expect(workspaceRows).toContain("6 entries · ephemeral");
	});

	it("does not render the session file path", () => {
		const text = renderSidebarLines(snapshot(), DEFAULT_CONFIG, theme, 44, 60, false).join("\n");
		expect(text).not.toContain("/tmp/session.jsonl");
		expect(text).not.toContain("session.jsonl");
	});

	it("renders labeled session persistence", () => {
		const persisted = buildSidebarSnapshot({
			state,
			cwd: "/tmp/project",
			sessionName: "Task session",
			sessionFile: "/tmp/session.jsonl",
			branchEntryCount: 6,
			activeToolCount: 8,
			availableToolCount: 12,
			extensionStatuses: [],
		});
		expect(renderRows(persisted, { color: false })).toContain("6 entries · persisted");
	});

	it("renders populated usage as aligned labeled rows", () => {
		const fg = vi.fn((_color: string, text: string) => text);
		const unnamedTheme = { fg, bold: theme.bold, italic: theme.italic };
		const rows = contentRows(renderSidebarLines(snapshot(), DEFAULT_CONFIG, unnamedTheme, 44, 60, true));
		const usageIndex = rows.indexOf("Usage");
		expect(rows[usageIndex + 3]).toMatch(/^Input\s+50\.0k$/);
		expect(rows[usageIndex + 4]).toMatch(/^Output\s+1\.9k$/);
		expect(rows[usageIndex + 5]).toMatch(/^Cache read\s+100\.0k$/);
		for (const label of ["Input", "Output", "Cache read", "Cache hit", "Cost"]) {
			expect(fg).toHaveBeenCalledWith("muted", label);
		}
		for (const width of [44, 56, 72]) {
			const wideRows = renderRows(snapshot(), { width: width, color: false });
			const wideUsage = wideRows.indexOf("Usage");
			expect(wideRows[wideUsage + 3]).toMatch(/^Input\s+50\.0k$/);
			expect(wideRows[wideUsage + 4]).toMatch(/^Output\s+1\.9k$/);
		}
	});

	it("hides unavailable usage while keeping access under Agent", () => {
		const unavailable = {
			...snapshot(),
			metrics: {
				...state.metrics,
				usageAvailable: false,
				costAvailable: false,
				input: 0,
				output: 0,
				cacheRead: 0,
				cost: 0,
			},
		};
		const rows = renderRows(unavailable, { color: false });
		expect(rows).toContain("Usage");
		expect(rows).toContain("OpenAI-Codex · Medium · Subscription");
	});

	it("keeps a live Turn's ACTIVITY to current work without tool history", () => {
		const rows = renderRows(withActivity(activeActivity()), { color: false, now: 20_000 });
		expect(rows).toContain("Activity");
		expect(rows).toContain("Turn 3 · running 19s");
		expect(rows).toEqual(expect.arrayContaining([expect.stringMatching(/^read\s+src\/state\.ts\s+18s$/)]));
		expect(rows).not.toEqual(expect.arrayContaining([expect.stringMatching(/^bash\s+npm test\s+done 4s$/)]));
		expect(rows).not.toContain("tools 2 done · 1 failed");
	});

	it.each([
		{ completedCount: 2, failedCount: 0, expected: "tools 2 done · 0 failed" },
		{ completedCount: 0, failedCount: 1, expected: "tools 0 done · 1 failed" },
	])("renders both aggregate sides for %#", ({ completedCount, failedCount, expected }) => {
		const rows = renderRows(
			withActivity({
				phase: "settled",
				startedAt: 10_000,
				durationMs: 5_000,
				activeTools: [],
				recentTools: [],
				completedCount,
				failedCount,
			}),
			{ color: false, now: 20_000 },
		);
		expect(rows).toContain(expected);
	});

	it("renders labeled response performance in Activity", () => {
		const ttftOnly = renderRows(
			withActivity({
				phase: "running",
				turnNumber: 1,
				startedAt: 1_000,
				performance: { ttftMs: 820 },
				activeTools: [],
				recentTools: [],
				completedCount: 0,
				failedCount: 0,
			}),
			{ color: false, now: 2_000 },
		);
		expect(ttftOnly).toContainEqual(expect.stringMatching(/^First token\s+820ms$/));

		const estimated = renderRows(
			withActivity({
				phase: "running",
				startedAt: 1_000,
				performance: { ttftMs: 820, tokensPerSecond: 42.34, estimated: true },
				activeTools: [],
				recentTools: [],
				completedCount: 0,
				failedCount: 0,
			}),
			{ color: false, now: 2_000 },
		);
		expect(estimated).toContainEqual(expect.stringMatching(/^Output speed\s+~42\.3 tok\/s$/));

		const completed = renderRows(
			withActivity({
				phase: "settled",
				startedAt: 1_000,
				durationMs: 4_000,
				performance: { ttftMs: 1_420, tokensPerSecond: 47.34 },
				activeTools: [],
				recentTools: [],
				completedCount: 0,
				failedCount: 0,
			}),
			{ color: false, now: 5_000 },
		);
		expect(completed).toContainEqual(expect.stringMatching(/^Output speed\s+47\.3 tok\/s$/));
	});

	it("keeps the run summary and response placeholders when height drops tool activity", () => {
		const performanceActivity = withActivity({
			...activeActivity(),
			performance: { ttftMs: 820, tokensPerSecond: 48 },
		});
		let constrainedRows: string[] | undefined;
		for (let height = 60; height > 0; height -= 1) {
			const rows = renderRows(performanceActivity, { height: height, color: false, now: 20_000 });
			if (
				rows.some((row) => /^Output speed\s+48\.0 tok\/s$/.test(row)) &&
				rows.some((row) => row.includes("Turn 3")) &&
				!rows.some((row) => /^read\s+src\/state\.ts/.test(row))
			) {
				constrainedRows = rows;
				break;
			}
		}

		expect(constrainedRows).toBeDefined();
	});

	it.each<{
		name: string;
		activity: Partial<RunActivitySnapshot>;
		present: (string | RegExp)[];
		absent: string[];
	}>([
		{ name: "idle placeholders", activity: {}, present: [/^First token\s+—$/], absent: ["Ready"] },
		{
			name: "settled activity",
			activity: {
				phase: "settled",
				turnNumber: 4,
				startedAt: 1_000,
				durationMs: 6_500,
				failedCount: 1,
				recentTools: [
					{
						id: "edit-1",
						name: "edit",
						summary: "src/sidebar.ts",
						status: "failed",
						startedAt: 2_000,
						durationMs: 2_000,
					},
				],
			},
			present: ["Last run · 6s", /^edit\s+src\/sidebar\.ts\s+failed 2s$/],
			absent: ["Turn 4 · settled 6s"],
		},
		{
			name: "idle recent tools",
			activity: {
				completedCount: 1,
				recentTools: [
					{
						id: "idle-recent",
						name: "bash",
						summary: "npm test",
						status: "done",
						startedAt: 2_000,
						durationMs: 1_000,
					},
				],
			},
			present: [/^bash\s+npm test\s+done 1s$/, "tools 1 done · 0 failed"],
			absent: [],
		},
		{
			name: "idle active tools",
			activity: {
				startedAt: 10_000,
				activeTools: [
					{ id: "idle-active", name: "read", summary: "src/a.ts", status: "running", startedAt: 15_000 },
				],
			},
			present: [/^read\s+src\/a\.ts\s+5s$/],
			absent: [],
		},
		{ name: "idle counts", activity: { failedCount: 2 }, present: ["tools 0 done · 2 failed"], absent: [] },
	])("renders $name", ({ activity, present, absent }) => {
		const rows = renderRows(withActivity(activity), { color: false, now: 20_000 });
		expect(rows).toContain("Activity");
		for (const expected of present) {
			expect(rows).toContainEqual(typeof expected === "string" ? expected : expect.stringMatching(expected));
		}
		for (const unexpected of absent) expect(rows).not.toContain(unexpected);
	});

	it("folds extra live tools into the current work row during a Turn", () => {
		const rows = renderRows(
			withActivity({
				phase: "running",
				turnNumber: 1,
				startedAt: 10_000,
				activeTools: [
					{ id: "second", name: "grep", summary: "later", status: "running", startedAt: 13_000 },
					{ id: "first", name: "read", summary: "same-a", status: "running", startedAt: 12_000 },
					{ id: "third", name: "bash", summary: "same-b", status: "running", startedAt: 12_000 },
				],
				recentTools: [
					{
						id: "old",
						name: "write",
						summary: "recent",
						status: "done",
						startedAt: 3_000,
						durationMs: 1_000,
					},
				],
				completedCount: 1,
				failedCount: 0,
			}),
			{ color: false, now: 20_000 },
		);
		expect(rows).toEqual(expect.arrayContaining([expect.stringMatching(/^grep\s+later\s+7s · \+2$/)]));
		expect(rows).not.toEqual(expect.arrayContaining([expect.stringMatching(/^read\s+same-a/)]));
		expect(rows).not.toEqual(expect.arrayContaining([expect.stringMatching(/^bash\s+same-b/)]));
		expect(rows.findIndex((row) => /^write\s+recent/.test(row))).toBe(-1);
	});

	it("caps recent tools, deduplicates active IDs, and bounds long summaries", () => {
		const rows = renderRows(
			withActivity({
				phase: "settled",
				startedAt: 0,
				activeTools: [{ id: "dupe", name: "read", summary: "active", status: "running", startedAt: 1_000 }],
				recentTools: [
					{
						id: "new",
						name: "bash",
						summary: "n".repeat(80),
						status: "done",
						startedAt: 9_000,
						durationMs: 1_000,
					},
					{
						id: "dupe",
						name: "read",
						summary: "duplicate",
						status: "done",
						startedAt: 8_000,
						durationMs: 1_000,
					},
					{
						id: "middle",
						name: "edit",
						summary: "middle",
						status: "done",
						startedAt: 7_000,
						durationMs: 1_000,
					},
					{
						id: "older",
						name: "write",
						summary: "older",
						status: "done",
						startedAt: 6_000,
						durationMs: 1_000,
					},
					{
						id: "oldest",
						name: "grep",
						summary: "oldest",
						status: "done",
						startedAt: 5_000,
						durationMs: 1_000,
					},
				],
				completedCount: 5,
				failedCount: 0,
			}),
			{ width: 34, color: false, now: 20_000 },
		);
		const recentRows = rows.filter((row) => /^(bash|edit|write)\s+/.test(row));
		expect(recentRows).toHaveLength(3);
		expect(recentRows[0]).toMatch(/^bash\s+n+/);
		expect(recentRows[1]).toMatch(/^edit\s+middle\s+done 1s$/);
		expect(recentRows[2]).toMatch(/^write\s+older\s+done 1s$/);
		expect(rows).not.toEqual(expect.arrayContaining([expect.stringContaining("duplicate")]));
		expect(rows).not.toEqual(expect.arrayContaining([expect.stringContaining("oldest")]));
		expect(rows.every((row) => visibleWidth(row) <= 32)).toBe(true);
	});

	it("uses success, error, and working palette roles for activity status", () => {
		const liveFg = vi.fn((_color: string, text: string) => text);
		renderSidebarLines(
			withActivity({
				phase: "running",
				startedAt: 10_000,
				activeTools: [
					{ id: "active", name: "read", summary: "src/a.ts", status: "running", startedAt: 10_000 },
				],
				recentTools: [],
				completedCount: 0,
				failedCount: 0,
			}),
			DEFAULT_CONFIG,
			{ fg: liveFg, bold: theme.bold, italic: theme.italic },
			44,
			60,
			true,
			20_000,
		);
		expect(liveFg).toHaveBeenCalledWith("mdHeading", "10s");

		const settledFg = vi.fn((_color: string, text: string) => text);
		renderSidebarLines(
			withActivity({
				phase: "settled",
				startedAt: 10_000,
				durationMs: 10_000,
				activeTools: [],
				recentTools: [
					{ id: "ok", name: "bash", summary: "ok", status: "done", startedAt: 9_000, durationMs: 1_000 },
					{ id: "bad", name: "edit", summary: "bad", status: "failed", startedAt: 8_000, durationMs: 1_000 },
				],
				completedCount: 1,
				failedCount: 1,
			}),
			DEFAULT_CONFIG,
			{ fg: settledFg, bold: theme.bold, italic: theme.italic },
			44,
			60,
			true,
			20_000,
		);
		expect(settledFg).toHaveBeenCalledWith("thinkingLow", "done 1s");
		expect(settledFg).toHaveBeenCalledWith("error", "failed 1s");
	});

	it("drops workspace details, tools, then usage as height contracts", () => {
		const ranked = withActivity({
			phase: "running",
			turnNumber: 2,
			startedAt: 1_000,
			activeTools: [
				{ id: "active-a", name: "read", summary: "active-a", status: "running", startedAt: 2_000 },
				{ id: "active-b", name: "bash", summary: "active-b", status: "running", startedAt: 3_000 },
			],
			recentTools: [
				{
					id: "newest",
					name: "write",
					summary: "newest",
					status: "done",
					startedAt: 8_000,
					durationMs: 1_000,
				},
				{
					id: "middle",
					name: "grep",
					summary: "middle",
					status: "done",
					startedAt: 7_000,
					durationMs: 1_000,
				},
				{
					id: "oldest",
					name: "edit",
					summary: "oldest",
					status: "failed",
					startedAt: 6_000,
					durationMs: 1_000,
				},
			],
			completedCount: 3,
			failedCount: 1,
		});

		const fullRows = renderRows(ranked, { color: false, now: 20_000 });
		expect(fullRows).toContain("Sidebar implementation");
		expect(fullRows).toContain("38 entries · persisted");
		expect(fullRows).toContain("Tools");
		expect(fullRows).toContain("Usage");
		expect(fullRows).toContain("Workspace");
		expect(fullRows.findIndex((row) => /^bash\s+active-b/.test(row))).toBeGreaterThanOrEqual(0);
		expect(fullRows.findIndex((row) => /^bash\s+active-b/.test(row))).toBeLessThan(fullRows.indexOf("Usage"));

		const withoutSession = renderRows(ranked, { height: 32, color: false, now: 20_000 });
		expect(withoutSession).toContain("Tools");
		expect(withoutSession).toContain("Usage");
		expect(withoutSession).toContain("Workspace");
		expect(withoutSession).not.toContain("Sidebar implementation");
		expect(withoutSession).not.toContain("38 entries · persisted");

		const withoutTools = renderRows(ranked, { height: 28, color: false, now: 20_000 });
		expect(withoutTools).not.toContain("Tools");
		expect(withoutTools).toContain("Usage");
		expect(withoutTools).toContain("Workspace");

		const coreOnly = renderRows(ranked, { height: 22, color: false, now: 20_000 });
		expect(coreOnly).not.toContain("Tools");
		expect(coreOnly).toContain("Usage");
		expect(coreOnly).toContain("Workspace");
		expect(coreOnly).toContain("5 tracked  +182  −47");
		expect(coreOnly).not.toContain("Sidebar implementation");
		expect(coreOnly).not.toContain("38 entries · persisted");
		expect(coreOnly).toContain("Agent");
		expect(coreOnly).toContain("Usage");
	});

	it("normalizes tools, collapses names by default, and expands them from configuration", () => {
		const toolsSnapshot = buildSidebarSnapshot({
			state: { ...state, extensionStatuses: [] },
			cwd: "/tmp/project",
			branchEntryCount: 6,
			activeToolCount: 3,
			availableToolCount: 7,
			activeToolNames: ["read", "\u001b[31mbash", " edit\n", "read", "   "],
			extensionStatuses: [],
		});
		expect(toolsSnapshot.activeToolNames).toEqual(["bash", "edit", "read"]);

		const collapsed = renderRows(toolsSnapshot, { color: false });
		const collapsedIndex = collapsed.indexOf("Tools");
		expect(collapsed[collapsedIndex + 1]).toMatch(/^Enabled\s+3 \/ 7$/);
		expect(collapsed).not.toContain("bash  edit");

		const expandedConfig = { ...DEFAULT_CONFIG, showSidebarToolNames: true };
		const expanded = renderRows(toolsSnapshot, { config: expandedConfig, color: false });
		const expandedIndex = expanded.indexOf("Tools");
		expect(expanded[expandedIndex + 1]).toMatch(/^Enabled\s+3 \/ 7$/);
		expect(expanded[expandedIndex + 2]).toBe("bash  edit");
		expect(expanded[expandedIndex + 3]).toBe("read");
		expect(expanded.join("\n")).not.toContain("[31m");

		for (const width of [44, 56, 72]) {
			const wide = renderRows(toolsSnapshot, { config: expandedConfig, width: width, color: false });
			const wideIndex = wide.indexOf("Tools");
			expect(wide[wideIndex + 2]).toBe("bash  edit");
			expect(wide[wideIndex + 3]).toBe("read");
		}

		for (const width of [28, 39]) {
			const narrow = renderRows(toolsSnapshot, { config: expandedConfig, width: width, color: false });
			const narrowIndex = narrow.indexOf("Tools");
			expect(narrow[narrowIndex + 1]).toMatch(/^Enabled\s+3 \/ 7$/);
			expect(narrow).not.toContain("bash  edit");
			expect(narrow).not.toContain("read");
		}
		expect(expandedConfig.showSidebarToolNames).toBe(true);
	});

	it("publishes a Tools disclosure hit region from the rendered frame", () => {
		const toolsSnapshot = buildSidebarSnapshot({
			state: { ...state, extensionStatuses: [] },
			cwd: "/tmp/project",
			branchEntryCount: 6,
			activeToolCount: 3,
			availableToolCount: 7,
			activeToolNames: ["read", "bash", "edit"],
			extensionStatuses: [],
		});
		const frame = renderSidebarFrame(toolsSnapshot, DEFAULT_CONFIG, theme, 44, 36, false);
		const rows = contentRows(frame.lines);
		const toolsStatusY = rows.indexOf("Tools") + 2;

		expect(frame.hitRegions).toContainEqual({
			action: { type: "toggle-tool-names" },
			x1: 2,
			x2: 44,
			y1: toolsStatusY,
			y2: toolsStatusY,
			enabled: true,
		});

		const compact = renderSidebarFrame(toolsSnapshot, DEFAULT_CONFIG, theme, 39, 36, false);
		expect(compact.hitRegions).not.toContainEqual(
			expect.objectContaining({ action: { type: "toggle-tool-names" } }),
		);
	});

	it("omits stale hit regions when Tools is dropped by the height budget", () => {
		const frame = renderSidebarFrame(snapshot(), DEFAULT_CONFIG, theme, 44, 12, false);

		expect(contentRows(frame.lines)).not.toContain("Tools");
		expect(frame.hitRegions).not.toContainEqual(
			expect.objectContaining({ action: { type: "toggle-tool-names" } }),
		);
		expect(frame.hitRegions).not.toContainEqual(
			expect.objectContaining({ action: { type: "toggle-panel-body", panelId: "tools" } }),
		);
	});

	it("publishes panel crown hit regions and hides collapsed widget bodies", () => {
		const frame = renderSidebarFrame(snapshot(), DEFAULT_CONFIG, theme, 44, 64, false, 0);
		const rows = contentRows(frame.lines);
		const workspaceY = rows.indexOf("Workspace") + 1;

		expect(frame.hitRegions).toContainEqual({
			action: { type: "toggle-panel-body", panelId: "workspace" },
			x1: 2,
			x2: 44,
			y1: workspaceY,
			y2: workspaceY,
			enabled: true,
		});

		const collapsed = renderSidebarFrame(snapshot(), DEFAULT_CONFIG, theme, 44, 64, false, 0, false, {
			collapsedPanelIds: new Set(["workspace"]),
		});
		const collapsedRows = contentRows(collapsed.lines);
		expect(collapsedRows).toContain("Workspace");
		expect(collapsedRows).not.toContain("pi-atelier · feature/sidebar ▲");
		expect(collapsed.hitRegions).toContainEqual({
			action: { type: "toggle-panel-body", panelId: "workspace" },
			x1: 2,
			x2: 44,
			y1: collapsedRows.indexOf("Workspace") + 1,
			y2: collapsedRows.indexOf("Workspace") + 1,
			enabled: true,
		});
	});

	it("drops activated tool-name rows before the tool count", () => {
		const toolsSnapshot = buildSidebarSnapshot({
			state: { ...state, extensionStatuses: [] },
			cwd: "/tmp/project",
			branchEntryCount: 6,
			activeToolCount: 4,
			availableToolCount: 7,
			activeToolNames: ["write", "read", "edit", "bash"],
			extensionStatuses: [],
		});
		const expandedConfig = { ...DEFAULT_CONFIG, showSidebarToolNames: true };
		const fullRows = renderRows(toolsSnapshot, { config: expandedConfig, color: false });
		const fullHeight = fullRows.findLastIndex((row) => row !== "") + 3;
		const constrained = renderRows(toolsSnapshot, {
			config: expandedConfig,
			height: fullHeight - 1,
			color: false,
		});
		expect(constrained).toContainEqual(expect.stringMatching(/^Enabled\s+4 \/ 7$/));
		expect(constrained).toContain("bash  edit");
		expect(constrained).not.toContain("read  write");
	});

	it("renders no tool-name placeholder when none are active", () => {
		const toolsSnapshot = buildSidebarSnapshot({
			state: { ...state, extensionStatuses: [] },
			cwd: "/tmp/project",
			branchEntryCount: 0,
			activeToolCount: 0,
			availableToolCount: 7,
			activeToolNames: [],
			extensionStatuses: [],
		});
		const rows = renderRows(toolsSnapshot, { color: false });
		const toolsIndex = rows.indexOf("Tools");
		expect(rows[toolsIndex + 1]).toMatch(/^Enabled\s+0 \/ 7$/);
		expect(rows[toolsIndex + 2]).toBe("");
	});

	it("renders tool count without standalone status placeholder when extension statuses are empty", () => {
		const emptyStatuses = buildSidebarSnapshot({
			state: { ...state, extensionStatuses: [] },
			cwd: "/tmp/project",
			branchEntryCount: 6,
			activeToolCount: 8,
			availableToolCount: 12,
			extensionStatuses: [],
		});
		const rows = renderRows(emptyStatuses, { color: false });
		const toolsIndex = rows.indexOf("Tools");
		expect(toolsIndex).toBeGreaterThan(-1);
		expect(rows[toolsIndex + 1]).toMatch(/^Enabled\s+8 \/ 12$/);
		expect(rows.slice(toolsIndex + 2)).not.toContain("—");
		expect(rows).toEqual(expect.not.arrayContaining([expect.stringMatching(/^STATUS /)]));
	});

	it("shows only sanitized warning and error extension statuses", () => {
		const statusSnapshot = buildSidebarSnapshot({
			state: { ...state, extensionStatuses: [] },
			cwd: "/tmp/project",
			branchEntryCount: 6,
			activeToolCount: 8,
			availableToolCount: 12,
			extensionStatuses: ["tests \u001b[31mpassing", "api\nready", "sync warning", "index failed", "   "],
		});
		const rows = renderRows(statusSnapshot, { color: false });
		expect(rows).toContain("Alerts");
		expect(rows).toContain("▲ sync warning");
		expect(rows).toContain("✕ index failed");
		expect(rows).not.toContain("tests passing");
		expect(rows).not.toContain("api ready");
		expect(rows.join("\n")).not.toContain("[31m");
	});

	it("suppresses routine healthy extension statuses", () => {
		const rows = renderRows(snapshot(), { color: false });
		expect(rows).toContainEqual(expect.stringMatching(/^Enabled\s+8 \/ 12$/));
		expect(rows).not.toContain("tests passing");
		expect(rows).not.toContain("Alerts");
	});

	it("keeps only the required hierarchy in a compact 12 row rail", () => {
		const text = renderSidebarLines(snapshot(), DEFAULT_CONFIG, theme, 44, 12, false).join("\n");
		expect(text).not.toContain("▛▀▜");
		expect(text).toContain("Agent");
		expect(text).not.toContain("Workspace");
		expect(text).not.toContain("Tools");
		expect(text).not.toContain("tests passing");
	});

	it("renders missing metadata as unavailable and the session as ephemeral", () => {
		const {
			modelId: _model,
			provider: _provider,
			thinkingLevel: _thinking,
			branch: _branch,
			...base
		} = state;
		const missing = buildSidebarSnapshot({
			state: {
				...base,
				metrics: { ...state.metrics, contextTokens: null, contextPercent: null },
			},
			cwd: "/tmp/project",
			branchEntryCount: 0,
			activeToolCount: 0,
			availableToolCount: 0,
			extensionStatuses: [],
		});
		const lines = renderSidebarLines(missing, DEFAULT_CONFIG, theme, 32, 60, false);
		expect(lines.join("\n")).toContain("—");
		expect(lines.join("\n")).toContain("ephemeral");
		expect(lines.every((line) => visibleWidth(line) <= 32)).toBe(true);
	});

	it("sanitizes and truncates long values without breaking the frame", () => {
		const long = {
			...snapshot(),
			modelId: `model\u001b[31m${"界".repeat(60)}`,
			branch: `feature/${"x".repeat(100)}`,
			sessionName: `release\n${"y".repeat(100)}`,
			extensionStatuses: [`status\t${"z".repeat(100)}`],
		};
		const lines = renderSidebarLines(long, DEFAULT_CONFIG, theme, 34, 36, false);
		expect(lines.join("")).not.toContain("[31m");
		expect(lines.every((line) => visibleWidth(line) <= 34)).toBe(true);
	});

	it.each([50, 75, 95] as const)(
		"renders context at %s%% without foreground paint when disabled",
		(percent) => {
			const fg = vi.fn((_color: string, text: string) => text);
			const lines = renderSidebarLines(
				{ ...snapshot(), metrics: { ...state.metrics, contextPercent: percent } },
				DEFAULT_CONFIG,
				{ ...theme, fg },
				44,
				36,
				false,
			);
			expect(lines.join("\n")).toContain(`${percent.toFixed(1)}%`);
			expect(fg).not.toHaveBeenCalled();
			expect(lines.join("\n")).not.toMatch(/\u001b\[[0-?]*[ -/]*[@-~]/);
		},
	);

	it("hides Agent while retaining every populated sibling panel", () => {
		const configWithoutAgent = {
			...DEFAULT_CONFIG,
			sidebarPanelLayout: DEFAULT_CONFIG.sidebarPanelLayout.map((entry) => ({
				...entry,
				visible: entry.id !== "agent",
			})),
		};
		const populated = {
			...snapshot(),
			todos: [
				{ id: 1, text: "Visible TODO", status: "pending" as const },
				{ id: 2, text: "Completed TODO", status: "completed" as const },
			],
		};
		const rows = renderRows(populated, { config: configWithoutAgent, height: 64, color: false, now: 0 });
		expect(rows).not.toContain("Agent");
		for (const panel of ["Activity", "Todos", "Workspace", "Usage", "Tools"]) {
			expect(rows).toContain(panel);
		}
		expect(rows.some((row) => row.includes("Visible TODO"))).toBe(true);
	});
});

describe("sidebar component and overlay", () => {
	it("does not capture editor input or render modal close help", () => {
		const component = createSidebarComponent({
			getSnapshot: snapshot,
			getConfig: () => DEFAULT_CONFIG,
			getHeight: () => 36,
			theme,
		});
		expect(component.handleInput).toBeUndefined();
		expect(component.render(44).join("\n")).not.toContain("esc/q close");
	});

	it("shows a visible Sidebar interaction state and active divider styling", () => {
		const fg = vi.fn((_color: string, text: string) => text);
		const component = createSidebarComponent({
			getSnapshot: snapshot,
			getConfig: () => DEFAULT_CONFIG,
			getHeight: () => 36,
			isResizing: () => true,
			theme: { fg, bold: theme.bold, italic: theme.italic },
		});

		expect(component.render(44).join("\n")).toContain("Resize");
		expect(fg).toHaveBeenCalledWith("warning", "│");
	});

	it("reads live terminal height on every render without recreation", () => {
		let height = 24;
		const component = createSidebarComponent({
			getSnapshot: snapshot,
			getConfig: () => DEFAULT_CONFIG,
			getHeight: () => height,
			theme,
		});
		expect(component.render(44)).toHaveLength(24);
		height = 31;
		expect(component.render(44)).toHaveLength(31);
	});

	it.each(["snapshot", "config", "render"] as const)(
		"renders a bounded error state after a %s failure",
		(source) => {
			const component = createSidebarComponent({
				getSnapshot: () => {
					if (source === "snapshot") throw new Error("snapshot failed");
					return snapshot();
				},
				getConfig: () => {
					if (source === "config") throw new Error("config failed");
					return DEFAULT_CONFIG;
				},
				getHeight: () => 7,
				theme:
					source === "render"
						? {
								...theme,
								bold: () => {
									throw new Error("render failed");
								},
							}
						: theme,
			});
			const lines = component.render(24);
			expect(lines).toHaveLength(7);
			expect(lines.every((line) => stripAnsi(line).startsWith("  "))).toBe(true);
			expect(contentRows(lines)[0]).toBe("Sidebar unavailable");
			expect(lines.join("\n")).not.toMatch(/PI ATELIER|ATELIER/);
			expect(lines.join("\n")).not.toContain("esc/q close");
			expect(lines.join("\n")).not.toMatch(/[╭╮╰╯]/);
			expect(lines.every((line) => visibleWidth(line) <= 24)).toBe(true);
		},
	);

	it("keeps one overlay alive and supports repeated lifecycle operations", async () => {
		const requestRender = vi.fn();
		const tui = fakeTui(requestRender);
		const { custom, overlays } = overlayHost(() => tui);
		const controller = disposeAfterTest(
			createSidebarController({
				ctx: { mode: "tui", ui: { custom } } as never,
				getSnapshot: snapshot,
				getConfig: () => DEFAULT_CONFIG,
			}),
		);

		expect(controller.isVisible()).toBe(false);
		controller.show();
		expect(controller.isVisible()).toBe(true);
		expect(custom).toHaveBeenCalledOnce();
		expect(custom.mock.calls[0]?.[1]).toMatchObject({
			overlay: true,
			overlayOptions: expect.any(Function),
			onHandle: expect.any(Function),
		});
		expect(overlays).toHaveLength(1);
		expect(overlays[0]!.layout()).toMatchObject({
			anchor: "top-right",
			width: DEFAULT_SIDEBAR_WIDTH,
			nonCapturing: true,
		});
		expect(tui.render(120)).toEqual(["main:120"]);
		controller.show();
		expect(custom).toHaveBeenCalledOnce();

		requestRender.mockClear();
		controller.requestRender();
		expect(requestRender).toHaveBeenCalled();
		controller.hide();
		expect(controller.isVisible()).toBe(false);
		expect(overlays[0]!.done).toHaveBeenCalledOnce();
		expect(overlays[0]!.handle.hide).not.toHaveBeenCalled();
		controller.hide();
		expect(overlays[0]!.done).toHaveBeenCalledOnce();

		controller.toggle();
		expect(controller.isVisible()).toBe(true);
		expect(custom).toHaveBeenCalledTimes(2);
		expect(overlays).toHaveLength(2);

		// Cross the overlay promise and its catch/finally chain while the replacement is active.
		await flushOverlay();
		expect(controller.isVisible()).toBe(true);
		requestRender.mockClear();
		controller.requestRender();
		expect(requestRender).toHaveBeenCalled();

		controller.dispose();
		expect(controller.isVisible()).toBe(false);
		expect(overlays[1]!.done).toHaveBeenCalledOnce();
	});

	it("animates live activity on one timer only while visible", async () => {
		vi.useFakeTimers();
		let running = true;
		const requestRender = vi.fn();
		const tui = fakeTui(requestRender);
		const { custom, overlays } = overlayHost(() => tui);
		const controller = disposeAfterTest(
			createSidebarController({
				ctx: { mode: "tui", ui: { custom } } as never,
				getSnapshot: snapshot,
				getConfig: () => DEFAULT_CONFIG,
				shouldAnimate: () => running,
				animationIntervalMs: 10,
			}),
		);
		vi.advanceTimersByTime(30);
		expect(requestRender).not.toHaveBeenCalled();

		controller.show();
		await flushOverlay();
		controller.show();
		requestRender.mockClear();
		vi.advanceTimersByTime(30);
		expect(requestRender).toHaveBeenCalledTimes(3);

		controller.requestRender();
		requestRender.mockClear();
		vi.advanceTimersByTime(10);
		expect(requestRender).toHaveBeenCalledOnce();

		running = false;
		controller.requestRender();
		requestRender.mockClear();
		vi.advanceTimersByTime(30);
		expect(requestRender).not.toHaveBeenCalled();
	});

	it("stops animation on hide, overlay closure, dispose, and stale generation", async () => {
		vi.useFakeTimers();
		const requestRender = vi.fn();
		const tui = fakeTui(requestRender);
		const { custom, overlays } = overlayHost(() => tui);
		const controller = disposeAfterTest(
			createSidebarController({
				ctx: { mode: "tui", ui: { custom } } as never,
				getSnapshot: snapshot,
				getConfig: () => DEFAULT_CONFIG,
				shouldAnimate: () => true,
				animationIntervalMs: 10,
			}),
		);

		controller.show();
		await flushOverlay();
		requestRender.mockClear();
		vi.advanceTimersByTime(10);
		expect(requestRender).toHaveBeenCalledOnce();
		controller.hide();
		requestRender.mockClear();
		vi.advanceTimersByTime(30);
		expect(requestRender).not.toHaveBeenCalled();

		controller.show();
		await flushOverlay();
		requestRender.mockClear();
		vi.advanceTimersByTime(10);
		expect(requestRender).toHaveBeenCalledOnce();
		overlays[1]!.done(undefined);
		await flushOverlay();
		requestRender.mockClear();
		vi.advanceTimersByTime(30);
		expect(requestRender).not.toHaveBeenCalled();

		controller.show();
		await flushOverlay();
		controller.hide();
		controller.show();
		await flushOverlay();
		overlays[2]!.done(undefined);
		await flushOverlay();
		requestRender.mockClear();
		vi.advanceTimersByTime(10);
		expect(requestRender).toHaveBeenCalledOnce();
		controller.dispose();
		requestRender.mockClear();
		vi.advanceTimersByTime(30);
		expect(requestRender).not.toHaveBeenCalled();
	});

	it("enters Resize mode through the composed sidebar controller", () => {
		let input: ((data: string) => unknown) | undefined;
		const tui = fakeTui();
		const { custom, overlays } = overlayHost(() => tui);
		const controller = disposeAfterTest(
			createSidebarController({
				ctx: {
					mode: "tui",
					ui: {
						custom,
						onTerminalInput: vi.fn((handler) => {
							input = handler;
							return vi.fn();
						}),
					},
				} as never,
				getSnapshot: snapshot,
				getConfig: () => DEFAULT_CONFIG,
			}),
		);

		controller.show();
		expect(controller.beginResize()).toBe(true);
		expect(controller.isResizing()).toBe(true);
		expect(controller.getWidth()).toBe(DEFAULT_SIDEBAR_WIDTH);
		expect(input).toBeTypeOf("function");
	});

	it("toggles widget bodies from panel crown mouse clicks without persisting layout", () => {
		let input: ((data: string) => unknown) | undefined;
		const tui = fakeTui();
		const custom = vi.fn((factory, customOptions) => {
			const component = factory(tui as never, theme as never, {} as never, vi.fn());
			customOptions.onHandle?.({ hide: vi.fn() });
			return Object.assign(new Promise(() => undefined), { component });
		});
		const controller = createSidebarController({
			ctx: {
				mode: "tui",
				ui: {
					custom,
					onTerminalInput: vi.fn((handler) => {
						input = handler;
						return vi.fn();
					}),
				},
			} as never,
			getSnapshot: snapshot,
			getConfig: () => DEFAULT_CONFIG,
		});

		controller.show();
		const component = (custom.mock.results[0]?.value as { component: { render(width: number): string[] } })
			.component;
		const rows = contentRows(component.render(44));
		const workspaceY = rows.indexOf("Workspace") + 1;
		expect(rows).toContain("pi-atelier · feature/sidebar ▲");
		expect(controller.beginResize()).toBe(true);

		const sidebarStartX = 120 - DEFAULT_SIDEBAR_WIDTH + 1;
		input?.(`\u001b[<0;${sidebarStartX + 8};${workspaceY}M`);
		input?.(`\u001b[<0;${sidebarStartX + 8};${workspaceY}m`);

		const collapsedRows = contentRows(component.render(44));
		expect(collapsedRows).toContain("Workspace");
		expect(collapsedRows).not.toContain("pi-atelier · feature/sidebar ▲");
		expect(DEFAULT_CONFIG.sidebarPanelLayout.find((entry) => entry.id === "workspace")?.visible).toBe(true);
	});

	it("cleans composed Resize state and restores full-width rendering on hide", () => {
		let input: ((data: string) => unknown) | undefined;
		const tui = fakeTui();
		const { custom, overlays } = overlayHost(() => tui);
		const controller = disposeAfterTest(
			createSidebarController({
				ctx: {
					mode: "tui",
					ui: {
						custom,
						onTerminalInput: vi.fn((handler) => {
							input = handler;
							return vi.fn();
						}),
					},
				} as never,
				getSnapshot: snapshot,
				getConfig: () => DEFAULT_CONFIG,
			}),
		);

		controller.show();
		expect(controller.beginResize()).toBe(true);
		input?.("\u001b[D");
		expect(controller.getWidth()).toBe(DEFAULT_SIDEBAR_WIDTH + 1);
		expect(tui.render(120)).toEqual(["main:120"]);

		controller.hide();

		expect(controller.isResizing()).toBe(false);
		expect(tui.render(120)).toEqual(["main:120"]);
	});

	it("continues overlay cleanup when the external TUI render request throws", async () => {
		vi.useFakeTimers();
		const renderError = new Error("request render failed");
		const requestRender = vi.fn();
		const tui = fakeTui(requestRender);
		const { custom, overlays } = overlayHost(() => tui);
		const onError = vi.fn();
		const controller = disposeAfterTest(
			createSidebarController({
				ctx: { mode: "tui", ui: { custom } } as never,
				getSnapshot: snapshot,
				getConfig: () => DEFAULT_CONFIG,
				shouldAnimate: () => true,
				animationIntervalMs: 10,
				onError,
			}),
		);

		controller.show();
		expect(vi.getTimerCount()).toBe(1);
		requestRender.mockImplementation(() => {
			throw renderError;
		});
		overlays[0]!.done();
		await flushOverlay();

		expect(controller.isVisible()).toBe(false);
		expect(controller.isResizing()).toBe(false);
		expect(tui.render(120)).toEqual(["main:120"]);
		expect(vi.getTimerCount()).toBe(0);
		expect(onError).toHaveBeenCalledWith(renderError);

		expect(() => controller.show()).not.toThrow();
		expect(controller.isVisible()).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("makes show after dispose a no-op", async () => {
		const tui = fakeTui();
		const { custom, overlays } = overlayHost(() => tui);
		const controller = disposeAfterTest(
			createSidebarController({
				ctx: { mode: "tui", ui: { custom } } as never,
				getSnapshot: snapshot,
				getConfig: () => DEFAULT_CONFIG,
			}),
		);

		controller.show();
		expect(tui.render(120)).toEqual(["main:120"]);
		controller.dispose();
		await flushOverlay();

		controller.show();

		expect(controller.isVisible()).toBe(false);
		expect(custom).toHaveBeenCalledOnce();
		expect(overlays[0]!.done).toHaveBeenCalledOnce();
		expect(tui.render(120)).toEqual(["main:120"]);
	});

	it("aborts overlay activation when a replacement TUI cannot attach", async () => {
		vi.useFakeTimers();
		const firstTui = fakeTui();
		const replacementTui = fakeTui();
		const tuis = [firstTui, replacementTui];
		const onError = vi.fn();
		const { custom, overlays } = overlayHost(() => tuis.shift()!);
		const controller = disposeAfterTest(
			createSidebarController({
				ctx: { mode: "tui", ui: { custom } } as never,
				getSnapshot: snapshot,
				getConfig: () => DEFAULT_CONFIG,
				shouldAnimate: () => true,
				animationIntervalMs: 10,
				onError,
			}),
		);

		controller.show();
		controller.hide();
		await flushOverlay();
		controller.show();
		await flushOverlay();

		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ message: expect.stringContaining("another TUI") }),
		);
		expect(controller.isVisible()).toBe(false);
		expect(overlays[1]!.done).toHaveBeenCalledOnce();
		expect(overlays[1]!.handle.hide).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
		expect(firstTui.render(120)).toEqual(["main:120"]);
		expect(replacementTui.render(120)).toEqual(["main:120"]);
	});

	it("reports unsupported modes without enabling the sidebar", () => {
		const onError = vi.fn();
		const custom = vi.fn();
		const controller = disposeAfterTest(
			createSidebarController({
				ctx: { mode: "rpc", ui: { custom } } as never,
				getSnapshot: snapshot,
				getConfig: () => DEFAULT_CONFIG,
				onError,
			}),
		);
		controller.show();
		expect(controller.isVisible()).toBe(false);
		expect(custom).not.toHaveBeenCalled();
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ message: expect.stringContaining("TUI") }),
		);
	});
});

describe("todos panel", () => {
	it("omits todos panel when list is empty", () => {
		const rows = renderRows(snapshot(), { height: 36, color: false });
		expect(rows).not.toContain("Todos");
	});

	it("keeps only the in-progress todo during a live Turn", () => {
		const snapWithTodos = buildSidebarSnapshot({
			state,
			cwd: "/Users/example/projects/pi-atelier",
			sessionName: "Sidebar implementation",
			sessionFile: "/tmp/session.jsonl",
			branchEntryCount: 38,
			activeToolCount: 8,
			availableToolCount: 12,
			extensionStatuses: ["tests passing"],
			runActivity: activeActivity(),
			todos: [
				{ id: 1, text: "Review diff", status: "completed" },
				{ id: 2, text: "Write tests", status: "in_progress" },
				{ id: 3, text: "Commit changes", status: "pending" },
			],
		});
		const rows = renderRows(snapWithTodos, { height: 48, color: false, now: 20_000 });
		expect(rows).toContain("Todos");
		expect(rows).toContain("1/3");
		expect(rows).toContain("◐ #2 Write tests");
		expect(rows).not.toContain("✓ #1 Review diff");
		expect(rows).not.toContain("○ #3 Commit changes");
	});

	it("renders todos with all 3 status states", () => {
		const snapWithTodos = buildSidebarSnapshot({
			state,
			cwd: "/Users/example/projects/pi-atelier",
			sessionName: "Sidebar implementation",
			sessionFile: "/tmp/session.jsonl",
			branchEntryCount: 38,
			activeToolCount: 8,
			availableToolCount: 12,
			extensionStatuses: ["tests passing"],
			runActivity: EMPTY_RUN_ACTIVITY,
			todos: [
				{ id: 1, text: "Review diff", status: "completed" },
				{ id: 2, text: "Write tests", status: "in_progress" },
				{ id: 3, text: "Commit changes", status: "pending" },
			],
		});
		const rows = renderRows(snapWithTodos, { height: 36, color: false });
		expect(rows).toContain("Todos");
		expect(rows).toContain("1/3");
		expect(rows).toContain("✓ #1 Review diff");
		expect(rows).toContain("◐ #2 Write tests");
		expect(rows).toContain("○ #3 Commit changes");
	});

	it("hides todos panel when disabled in the layout", () => {
		const snapWithTodos = buildSidebarSnapshot({
			state,
			cwd: "/Users/example/projects/pi-atelier",
			sessionName: "Sidebar implementation",
			sessionFile: "/tmp/session.jsonl",
			branchEntryCount: 38,
			activeToolCount: 8,
			availableToolCount: 12,
			extensionStatuses: ["tests passing"],
			runActivity: EMPTY_RUN_ACTIVITY,
			todos: [{ id: 1, text: "Task", status: "pending" }],
		});
		const config = {
			...DEFAULT_CONFIG,
			sidebarPanelLayout: DEFAULT_CONFIG.sidebarPanelLayout.map((entry) => ({
				...entry,
				visible: entry.id !== "todos",
			})),
		};
		const rows = renderRows(snapWithTodos, { config: config, height: 36, color: false });
		expect(rows).not.toContain("Todos");
	});

	it("sanitizes ansi codes in todo text", () => {
		const snapWithTodos = buildSidebarSnapshot({
			state,
			cwd: "/Users/example/projects/pi-atelier",
			sessionName: "Sidebar implementation",
			sessionFile: "/tmp/session.jsonl",
			branchEntryCount: 38,
			activeToolCount: 8,
			availableToolCount: 12,
			extensionStatuses: ["tests passing"],
			runActivity: EMPTY_RUN_ACTIVITY,
			todos: [{ id: 1, text: "Task\u001b[31mred", status: "pending" }],
		});
		const lines = renderSidebarLines(snapWithTodos, DEFAULT_CONFIG, theme, 44, 36, false);
		expect(lines.join("")).not.toContain("[31m");
		const rows = contentRows(lines);
		expect(rows).toContain("○ #1 Taskred");
	});
});
