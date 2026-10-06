import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, saveUserConfigPatch, validateConfig } from "../src/config.js";
import { DISPLAY_TEMPLATES, PRODUCT_SEGMENT_ORDER } from "../src/display.js";
import { DEFAULT_CONFIG } from "../src/types.js";
import { deferred } from "./helpers/async.js";

const visibility = (layout: typeof DEFAULT_CONFIG.segmentLayout, id: string) =>
	layout.find((entry) => entry.id === id)?.visible;

describe("configuration validation", () => {
	it("defines complete defaults and compatibility templates", () => {
		for (const template of [DEFAULT_CONFIG, ...Object.values(DISPLAY_TEMPLATES)]) {
			expect(template.segmentLayout.map((entry) => entry.id)).toEqual(PRODUCT_SEGMENT_ORDER);
			expect(new Set(template.segmentLayout.map((entry) => entry.id)).size).toBe(9);
			expect(visibility(template.segmentLayout, "metrics")).toBe(true);
			expect(visibility(template.segmentLayout, "context")).toBe(true);
			expect(visibility(template.segmentLayout, "brand")).toBe(false);
			expect(visibility(template.segmentLayout, "performance")).toBe(false);
		}
		expect(DEFAULT_CONFIG.showSidebarToolNames).toBe(false);
		expect(DEFAULT_CONFIG.completionNotifications).toBe(true);
		expect(DEFAULT_CONFIG.shortcut).toBe("alt+a");
		expect(DEFAULT_CONFIG.statusRailPlacement).toBe("footer");
		expect(DEFAULT_CONFIG.sidebarPanelLayout.find((entry) => entry.id === "agent")?.visible).toBe(true);
		expect(DEFAULT_CONFIG.sidebarPanelLayout.map((entry) => entry.id)).toEqual([
			"agent",
			"activity",
			"subagents",
			"alerts",
			"todos",
			"usage",
			"workspace",
			"tools",
		]);
	});

	it("normalizes working labels and supports disabling them", () => {
		expect(DEFAULT_CONFIG.workingLabels).toBeUndefined();
		expect(validateConfig({ workingLabels: false }).config.workingLabels).toBe(false);
		expect(validateConfig({ workingLabels: [" THINKING ", "WORKING"] }).config.workingLabels).toEqual([
			"THINKING",
			"WORKING",
		]);
		const invalid = validateConfig({ workingLabels: ["", 5, "THINKING"] });
		expect(invalid.config.workingLabels).toEqual(["THINKING"]);
		expect(invalid.warnings).toContain("workingLabels entries must be non-empty strings");
		expect(validateConfig({ workingLabels: [] }).warnings).toContain(
			"workingLabels must include at least one non-empty string",
		);
	});

	it("validates named and custom color schemes", () => {
		expect(DEFAULT_CONFIG.colorScheme).toBe("atelier");
		expect(validateConfig({ colorScheme: "inherit" }).config.colorScheme).toBe("inherit");
		expect(
			validateConfig({ colorScheme: { base: "inherit", output: "#cba6f7", cache: 45 } }).config.colorScheme,
		).toEqual({ base: "inherit", output: "#cba6f7", cache: 45 });
		const invalid = validateConfig({ colorScheme: { base: "unknown", output: "nope", mystery: 4 } });
		expect(invalid.config.colorScheme).toBe("atelier");
		expect(invalid.warnings).toEqual(
			expect.arrayContaining([
				"colorScheme.base must be atelier or inherit",
				"colorScheme.output must be a Pi theme token, #RRGGBB, integer 0-255, or empty string",
				"Unknown colorScheme role: mystery",
			]),
		);
	});

	it("preserves Alt+A and trims custom shortcuts", () => {
		expect(validateConfig({ shortcut: "alt+a" }).config.shortcut).toBe("alt+a");
		expect(validateConfig({ shortcut: " ALT+A " }).config.shortcut).toBe("ALT+A");
		expect(validateConfig({ shortcut: " ctrl+shift+a " }).config.shortcut).toBe("ctrl+shift+a");
	});

	it("validates status rail placement without replacing a valid lower value", () => {
		expect(validateConfig({ statusRailPlacement: "composer" }).config.statusRailPlacement).toBe("composer");
		const invalid = validateConfig(
			{ statusRailPlacement: "sidebar" },
			{ ...DEFAULT_CONFIG, statusRailPlacement: "composer" },
		);
		expect(invalid.config.statusRailPlacement).toBe("composer");
		expect(invalid.warnings).toContain("statusRailPlacement must be footer or composer");
	});

	it("keeps legacy Sidebar visibility compatible when no authoritative layout is present", () => {
		const result = validateConfig({ showSidebarAgent: false, showSidebarTodos: false });
		expect(result.config.sidebarPanelLayout.find((entry) => entry.id === "agent")?.visible).toBe(false);
		expect(result.config.sidebarPanelLayout.find((entry) => entry.id === "todos")?.visible).toBe(false);
	});

	it("applies named templates atomically before same-layer deviations", () => {
		const named = validateConfig({ preset: "minimal" });
		expect(named.config).toMatchObject({ preset: "minimal", density: "compact" });
		expect(named.config.segmentLayout).toEqual(DISPLAY_TEMPLATES.minimal.segmentLayout);

		const deviated = validateConfig({ preset: "minimal", density: "comfortable" });
		expect(deviated.config.preset).toBe("custom");
		expect(deviated.config.segmentLayout).toEqual(DISPLAY_TEMPLATES.minimal.segmentLayout);
	});

	it("preserves the public validateConfig base Display values", () => {
		const base = { ...DEFAULT_CONFIG, ...DISPLAY_TEMPLATES.minimal };
		const result = validateConfig({ shortcut: "ctrl+x" }, base);
		expect(result.config).toMatchObject({ preset: "minimal", density: "compact", shortcut: "ctrl+x" });
		expect(result.config.segmentLayout).toEqual(DISPLAY_TEMPLATES.minimal.segmentLayout);
	});

	it("preserves a custom base Sidebar layout when input omits layout", () => {
		const base = {
			...DEFAULT_CONFIG,
			sidebarPanelLayout: [
				{ id: "vendor:queue" as const, visible: true },
				{ id: "agent" as const, visible: false },
				...DEFAULT_CONFIG.sidebarPanelLayout.filter((entry) => !["agent", "todos"].includes(entry.id)),
			],
		};
		const result = validateConfig({ shortcut: "ctrl+x" }, base);
		expect(result.config.sidebarPanelLayout).toEqual(base.sidebarPanelLayout);
		expect(result.config.sidebarPanelLayout.find((entry) => entry.id === "agent")?.visible).toBe(false);
	});

	it("translates legacy Sidebar visibility against a custom base without resetting it", () => {
		const base = {
			...DEFAULT_CONFIG,
			sidebarPanelLayout: [
				{ id: "vendor:queue" as const, visible: true },
				{ id: "agent" as const, visible: false },
				...DEFAULT_CONFIG.sidebarPanelLayout.filter((entry) => entry.id !== "agent"),
			],
		};
		const result = validateConfig({ showSidebarTodos: false }, base);
		expect(result.config.sidebarPanelLayout.find((entry) => entry.id === "vendor:queue")?.visible).toBe(true);
		expect(result.config.sidebarPanelLayout.find((entry) => entry.id === "agent")?.visible).toBe(false);
		expect(result.config.sidebarPanelLayout.find((entry) => entry.id === "todos")?.visible).toBe(false);
	});

	it("makes a usable segmentLayout authoritative over same-layer legacy fields", () => {
		const result = validateConfig({
			segmentLayout: [
				{ id: "brand", visible: true },
				{ id: "statuses", visible: true },
			],
			segments: ["metrics", "context"],
			ornament: "none",
			showExtensionStatuses: false,
		});
		expect(visibility(result.config.segmentLayout, "brand")).toBe(true);
		expect(visibility(result.config.segmentLayout, "statuses")).toBe(true);
	});

	it("repairs malformed layouts deterministically and de-duplicates warnings", () => {
		const result = validateConfig({
			segmentLayout: [
				{ id: "menu", visible: true },
				{ id: "metrics", visible: false },
				{ id: "menu", visible: false },
				{ id: "mystery", visible: true },
				{ id: "brand", visible: "yes" },
				null,
				null,
			],
		});
		expect(result.config.segmentLayout.slice(0, 3)).toEqual([
			{ id: "menu", visible: true },
			{ id: "metrics", visible: true },
			{ id: "brand", visible: false },
		]);
		expect(result.config.segmentLayout.map((entry) => entry.id)).toHaveLength(9);
		expect(result.warnings.some((warning) => warning.includes("duplicate"))).toBe(true);
		expect(result.warnings.filter((warning) => warning.includes("malformed"))).toHaveLength(1);
	});

	it("uses legacy fallback for non-array layouts and retains hidden omissions", () => {
		const result = validateConfig({ segmentLayout: {}, segments: ["activity", "performance"] });
		expect(result.warnings).toContain("segmentLayout must be an array");
		expect(result.config.segmentLayout.map((entry) => entry.id).slice(0, 2)).toEqual([
			"activity",
			"performance",
		]);
		expect(visibility(result.config.segmentLayout, "performance")).toBe(true);
		expect(visibility(result.config.segmentLayout, "git")).toBe(false);
		expect(visibility(result.config.segmentLayout, "metrics")).toBe(true);
	});

	it.each([
		[{ preset: "classic", ornament: "restrained", segments: ["brand"] }, true],
		[{ preset: "editorial", ornament: "restrained", segments: ["brand"] }, false],
		[{ preset: "classic", ornament: "none", segments: ["brand"] }, false],
		[{ preset: "classic", ornament: "restrained", segments: [] }, false],
	] as const)("reproduces legacy Brand compatibility for %j", (input, expected) => {
		expect(visibility(validateConfig(input).config.segmentLayout, "brand")).toBe(expected);
	});

	it("reproduces legacy Statuses compatibility", () => {
		expect(
			visibility(
				validateConfig({ segments: ["statuses"], showExtensionStatuses: false }).config.segmentLayout,
				"statuses",
			),
		).toBe(false);
		expect(
			visibility(
				validateConfig({ segments: ["statuses"], showExtensionStatuses: true }).config.segmentLayout,
				"statuses",
			),
		).toBe(true);
	});

	it("rejects invalid thresholds and validates boolean preferences", () => {
		const result = validateConfig({
			contextWarning: 95,
			contextDanger: 80,
			showSidebarToolNames: "yes",
			showSidebarOnStartup: "yes",
		});
		expect(result.config.contextWarning).toBe(70);
		expect(result.warnings).toEqual(
			expect.arrayContaining([
				expect.stringContaining("threshold"),
				"showSidebarToolNames must be boolean",
				"showSidebarOnStartup must be boolean",
			]),
		);
	});

	it("rejects non-boolean showSidebarAgent with warning", () => {
		const result = validateConfig({ showSidebarAgent: "off" });
		expect(result.config.sidebarPanelLayout.find((entry) => entry.id === "agent")?.visible).toBe(true);
		expect(result.warnings).toContain("showSidebarAgent must be boolean");
	});
});

describe("configuration files", () => {
	let root: string;
	let userPath: string;
	let projectPath: string;
	const writeJson = (path: string, value: unknown) => writeFile(path, JSON.stringify(value), "utf8");

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "pi-atelier-"));
		userPath = join(root, "user.json");
		projectPath = join(root, "project.json");
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it.each<[string, Record<string, unknown>]>([
		["completionNotifications", { completionNotifications: false }],
		["showSidebarOnStartup", { showSidebarOnStartup: false }],
		["showSidebarAgent", { sidebarPanelLayout: expect.arrayContaining([{ id: "agent", visible: false }]) }],
		["showSidebarTodos", { sidebarPanelLayout: expect.arrayContaining([{ id: "todos", visible: false }]) }],
	])("keeps %s as a global user preference", async (key, expected) => {
		await writeJson(userPath, { [key]: false });
		await writeJson(projectPath, { [key]: true });
		const result = await loadConfig({
			userPath,
			projectPath,
			projectTrusted: true,
			session: { [key]: true },
		});
		expect(result.config).toMatchObject(expected);
	});

	it("loads validated contributed collapse state from the user layer only", async () => {
		await writeJson(userPath, {
			contributedPanelCollapsed: {
				"vendor:queue": true,
				"vendor:open": false,
				invalid: true,
				"vendor:bad": "yes",
			},
		});
		await writeJson(projectPath, { contributedPanelCollapsed: { "project:panel": true } });
		const result = await loadConfig({
			userPath,
			projectPath,
			projectTrusted: true,
			session: { contributedPanelCollapsed: { "session:panel": true } },
		});
		expect(result.config.contributedPanelCollapsed).toEqual({
			"vendor:queue": true,
			"vendor:open": false,
		});
		expect(result.warnings).toEqual(
			expect.arrayContaining([
				"Ignoring contributedPanelCollapsed entry: invalid",
				"contributedPanelCollapsed.vendor:bad must be boolean",
			]),
		);
	});

	it("loads an ordered global Sidebar layout with deterministic compatibility precedence", async () => {
		await writeJson(userPath, {
			showSidebarAgent: false,
			showSidebarTodos: false,
			sidebarPanelLayout: [
				{ id: "tools", visible: false },
				{ id: "vendor:queue", visible: false },
				{ id: "tools", visible: true },
			],
		});
		await writeJson(projectPath, { sidebarPanelLayout: [{ id: "agent", visible: false }] });
		const result = await loadConfig({
			userPath,
			projectPath,
			projectTrusted: true,
			session: { sidebarPanelLayout: [] },
		});
		expect(result.config.sidebarPanelLayout.slice(0, 2)).toEqual([
			{ id: "tools", visible: false },
			{ id: "vendor:queue", visible: false },
		]);
		expect(result.config.sidebarPanelLayout.find((entry) => entry.id === "agent")?.visible).toBe(true);
		expect(result.config.sidebarPanelLayout.find((entry) => entry.id === "todos")?.visible).toBe(true);
		expect(result.warnings.filter((warning) => warning.includes("duplicate")).length).toBe(1);
	});

	it("merges user, trusted project, then session with actionable provenance", async () => {
		await writeJson(userPath, { density: "compact" });
		await writeJson(projectPath, {
			segmentLayout: [
				{ id: "context", visible: true },
				{ id: "metrics", visible: true },
			],
		});
		const result = await loadConfig({
			userPath,
			projectPath,
			projectTrusted: true,
			session: { segmentLayout: [{ id: "brand", visible: true }] },
		});
		expect(result.config.density).toBe("compact");
		expect(result.config.segmentLayout[0]).toEqual({ id: "brand", visible: true });
		expect(result.displayProvenance.density).toBe("user");
		expect(result.displayProvenance.order).toBe("session");
		expect(result.displayProvenance.visibility.brand).toBe("session");
		expect(result.config.preset).toBe("custom");
	});

	it("layers color schemes, working labels, and status rail placement across sources", async () => {
		await writeJson(userPath, {
			colorScheme: "inherit",
			workingLabels: ["USER"],
			statusRailPlacement: "footer",
		});
		await writeJson(projectPath, {
			colorScheme: { output: "#ff00ff", cache: 45 },
			workingLabels: false,
			statusRailPlacement: "composer",
		});
		const result = await loadConfig({
			userPath,
			projectPath,
			projectTrusted: true,
			session: {
				colorScheme: { cache: "syntaxType" },
				workingLabels: ["SESSION"],
				statusRailPlacement: "footer",
			},
		});
		expect(result.config.colorScheme).toEqual({
			base: "inherit",
			output: "#ff00ff",
			cache: "syntaxType",
		});
		expect(result.config.workingLabels).toEqual(["SESSION"]);
		expect(result.config.statusRailPlacement).toBe("footer");
		const projectOnly = await loadConfig({ userPath, projectPath, projectTrusted: true });
		expect(projectOnly.config.statusRailPlacement).toBe("composer");
	});

	it("ignores project and session legacy Sidebar visibility when the user omits it", async () => {
		await writeJson(projectPath, { showSidebarAgent: false, showSidebarTodos: false });
		const result = await loadConfig({
			userPath,
			projectPath,
			projectTrusted: true,
			session: { showSidebarAgent: false, showSidebarTodos: false },
		});
		expect(result.config.sidebarPanelLayout.find((entry) => entry.id === "agent")?.visible).toBe(true);
		expect(result.config.sidebarPanelLayout.find((entry) => entry.id === "todos")?.visible).toBe(true);
	});

	it("does not read, warn about, or attribute an untrusted project", async () => {
		await writeFile(projectPath, "{broken", "utf8");
		const result = await loadConfig({ userPath, projectPath, projectTrusted: false });
		expect(result.config).toEqual(DEFAULT_CONFIG);
		expect(result.warnings).toEqual([]);
		expect(result.displayProvenance.order).toBe("product");
	});

	it("loads persisted showSidebarAgent false from user config", async () => {
		await writeJson(userPath, { showSidebarAgent: false });
		const result = await loadConfig({ userPath, projectPath, projectTrusted: false });
		expect(result.config.sidebarPanelLayout.find((entry) => entry.id === "agent")?.visible).toBe(false);
	});

	it("reports malformed JSON once and retains defaults", async () => {
		await writeFile(userPath, "{broken", "utf8");
		const result = await loadConfig({ userPath, projectPath, projectTrusted: false });
		expect(result.config).toEqual(DEFAULT_CONFIG);
		expect(result.warnings).toHaveLength(1);
	});

	it("serializes overlapping distinct patches without losing either field", async () => {
		const entered = deferred<void>();
		const release = deferred<void>();
		const first = saveUserConfigPatch(
			userPath,
			{ completionNotifications: false },
			{
				beforeWrite: async () => {
					entered.resolve();
					await release.promise;
				},
			},
		);
		await entered.promise;
		const second = saveUserConfigPatch(userPath, { showSidebarOnStartup: false });
		release.resolve();
		await Promise.all([first, second]);
		expect(JSON.parse(await readFile(userPath, "utf8"))).toMatchObject({
			completionNotifications: false,
			showSidebarOnStartup: false,
		});
	});

	it("continues the queue after a failed write guard", async () => {
		const failed = saveUserConfigPatch(
			userPath,
			{ completionNotifications: false },
			{
				beforeWrite: () => {
					throw new Error("stale write");
				},
			},
		);
		const next = saveUserConfigPatch(userPath, { showSidebarOnStartup: false });
		await expect(failed).rejects.toThrow("stale write");
		await next;
		expect(JSON.parse(await readFile(userPath, "utf8"))).toEqual({ showSidebarOnStartup: false });
	});

	it("prevents publication when a session retires after the temporary write", async () => {
		await writeJson(userPath, { existing: "keep" });
		let active = true;
		await expect(
			saveUserConfigPatch(
				userPath,
				{ completionNotifications: false },
				{
					beforeWrite: () => {
						if (!active) throw new Error("inactive session");
					},
					beforePublish: () => {
						active = false;
					},
				},
			),
		).rejects.toThrow("inactive session");
		expect(JSON.parse(await readFile(userPath, "utf8"))).toEqual({ existing: "keep" });
		expect((await readdir(root)).filter((name) => name.includes(".tmp"))).toEqual([]);
	});

	it("rechecks a queued session immediately before writing", async () => {
		const entered = deferred<void>();
		const release = deferred<void>();
		let active = true;
		const first = saveUserConfigPatch(
			userPath,
			{ completionNotifications: false },
			{
				beforeWrite: async () => {
					entered.resolve();
					await release.promise;
				},
			},
		);
		await entered.promise;
		const stale = saveUserConfigPatch(
			userPath,
			{ showSidebarOnStartup: false },
			{
				beforeWrite: () => {
					if (!active) throw new Error("inactive session");
				},
			},
		);
		active = false;
		release.resolve();
		await first;
		await expect(stale).rejects.toThrow("inactive session");
		expect(JSON.parse(await readFile(userPath, "utf8"))).toEqual({ completionNotifications: false });
	});

	it("patches one preference without losing unknown fields", async () => {
		await writeJson(userPath, { density: "compact", futureSetting: "keep" });
		await saveUserConfigPatch(userPath, { completionNotifications: false });
		expect(JSON.parse(await readFile(userPath, "utf8"))).toEqual({
			density: "compact",
			futureSetting: "keep",
			completionNotifications: false,
		});
	});

	it("patches a color scheme role without dropping the stored base and roles", async () => {
		await writeJson(userPath, {
			colorScheme: { base: "inherit", cache: 45, futureRole: "keep" },
			futureSetting: "keep",
		});
		await saveUserConfigPatch(userPath, { colorScheme: { output: "#ff00ff" } });
		expect(JSON.parse(await readFile(userPath, "utf8"))).toEqual({
			colorScheme: { base: "inherit", cache: 45, futureRole: "keep", output: "#ff00ff" },
			futureSetting: "keep",
		});
		await saveUserConfigPatch(userPath, { colorScheme: "atelier" });
		expect(JSON.parse(await readFile(userPath, "utf8"))).toEqual({
			colorScheme: "atelier",
			futureSetting: "keep",
		});
		await saveUserConfigPatch(userPath, { colorScheme: { output: "#ff00ff" } });
		expect(JSON.parse(await readFile(userPath, "utf8"))).toMatchObject({
			colorScheme: { base: "atelier", output: "#ff00ff" },
		});
		for (const unusable of [42, "solarized"]) {
			await writeJson(userPath, { colorScheme: unusable });
			await saveUserConfigPatch(userPath, { colorScheme: { output: "#ff00ff" } });
			expect(JSON.parse(await readFile(userPath, "utf8"))).toEqual({
				colorScheme: { output: "#ff00ff" },
			});
		}
	});
});
