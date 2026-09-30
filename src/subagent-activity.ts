import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const SUBAGENT_ASYNC_STARTED_EVENT = "subagent:async-started" as const;
export const SUBAGENT_ASYNC_COMPLETE_EVENT = "subagent:async-complete" as const;
export const SUBAGENT_FOREGROUND_COMPLETE_EVENT = "subagent:foreground-complete" as const;
export const SUBAGENT_CONTROL_EVENT = "subagent:control-event" as const;
export const SUBAGENT_CHILD_STATUS_EVENT = "subagent:child-status" as const;
export const SUBAGENT_PROCESS_TERMINAL_EVENT = "subagent:process-terminal" as const;

export type SubagentActivityStatus =
	| "queued"
	| "pending"
	| "running"
	| "stopping"
	| "detached"
	| "complete"
	| "failed"
	| "partial"
	| "paused"
	| "stopped"
	| "rejected";

export type SubagentControlState = "active_long_running" | "needs_attention";
export type SubagentProcessState = "pending" | "not-started" | "observed" | "unknown";
export type SubagentActivitySource = "async" | "foreground";

export interface SubagentActivityItem {
	id: string;
	source: SubagentActivitySource;
	status: SubagentActivityStatus;
	agent?: string | undefined;
	agents: readonly string[];
	label?: string | undefined;
	startedAt: number;
	endedAt?: number | undefined;
	durationMs?: number | undefined;
	activityState?: SubagentControlState | undefined;
	timedOut?: boolean | undefined;
	currentTool?: string | undefined;
	currentToolStartedAt?: number | undefined;
	currentPath?: string | undefined;
	turnCount?: number | undefined;
	toolCount?: number | undefined;
	processState?: SubagentProcessState | undefined;
	statusUnavailable?: boolean | undefined;
}

export interface SubagentActivitySnapshot {
	active: readonly SubagentActivityItem[];
	recent: readonly SubagentActivityItem[];
}

interface SubagentToolEvent {
	toolCallId: string;
	toolName: string;
	args: unknown;
}

interface SubagentToolUpdateEvent extends SubagentToolEvent {
	partialResult: unknown;
}

interface SubagentToolEndEvent {
	toolCallId: string;
	toolName: string;
	args?: unknown;
	result?: unknown;
	isError: boolean;
}

export interface SubagentActivityTracker {
	handleAsyncStarted(data: unknown): void;
	handleAsyncComplete(data: unknown): void;
	handleForegroundComplete(data: unknown): void;
	handleControlEvent(data: unknown): void;
	handleChildStatus(data: unknown): void;
	handleProcessTerminal(data: unknown): void;
	reconcileRestoredAsyncToolResults(details: readonly unknown[]): void;
	restoreAsyncToolResult(details: unknown): void;
	startForegroundTool(event: SubagentToolEvent, now?: number): void;
	updateForegroundTool(event: SubagentToolUpdateEvent, now?: number): void;
	finishForegroundTool(event: SubagentToolEndEvent, now?: number): void;
	hasActive(): boolean;
	getSnapshot(now?: number): SubagentActivitySnapshot;
	reset(): void;
	dispose(): void;
}

export interface SubagentActivityTrackerOptions {
	currentSessionId?: string;
	retentionMs?: number;
	pollIntervalMs?: number;
	maxStatusBytes?: number;
	maxStatusMisses?: number;
	now?: () => number;
	onChange?: (snapshot: SubagentActivitySnapshot) => void;
	readStatus?: (asyncDir: string) => unknown;
	setInterval?: typeof setInterval;
	clearInterval?: typeof clearInterval;
}

interface SubagentActivityRecord {
	id: string;
	source: SubagentActivitySource;
	status: SubagentActivityStatus;
	asyncDir?: string | undefined;
	runId?: string | undefined;
	agent?: string | undefined;
	agents: string[];
	label?: string | undefined;
	startedAt: number;
	endedAt?: number | undefined;
	durationMs?: number | undefined;
	activityState?: SubagentControlState | undefined;
	timedOut?: boolean | undefined;
	currentTool?: string | undefined;
	currentToolStartedAt?: number | undefined;
	currentPath?: string | undefined;
	turnCount?: number | undefined;
	toolCount?: number | undefined;
	processState?: SubagentProcessState | undefined;
	statusUnavailable?: boolean | undefined;
	statusMisses?: number | undefined;
	restored?: boolean | undefined;
	updatedAt: number;
	foregroundFallback?: boolean | undefined;
	steps?: SubagentActivityStep[] | undefined;
}

interface SubagentActivityStep {
	key: string;
	index: number;
	status: SubagentActivityStatus;
	agent?: string | undefined;
	label?: string | undefined;
	startedAt?: number | undefined;
	endedAt?: number | undefined;
	durationMs?: number | undefined;
	activityState?: SubagentControlState | undefined;
	timedOut?: boolean | undefined;
	currentTool?: string | undefined;
	currentToolStartedAt?: number | undefined;
	currentPath?: string | undefined;
	turnCount?: number | undefined;
	toolCount?: number | undefined;
	processState?: SubagentProcessState | undefined;
}

const DEFAULT_RETENTION_MS = 10 * 60 * 1_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_MAX_STATUS_BYTES = 256 * 1_024;
const DEFAULT_MAX_STATUS_MISSES = 30;
const MAX_ITEMS = 40;
const MAX_NESTED_STEPS = 80;
const FOREGROUND_COMPLETE_MATCH_WINDOW_MS = 5_000;
const EMPTY_SNAPSHOT: SubagentActivitySnapshot = Object.freeze({
	active: Object.freeze([]),
	recent: Object.freeze([]),
});

const terminalStatuses = new Set<SubagentActivityStatus>([
	"complete",
	"failed",
	"partial",
	"paused",
	"stopped",
	"rejected",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const safe = sanitizeText(value);
	return safe || undefined;
}

function stringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.map(stringValue).filter((item): item is string => item !== undefined);
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : undefined;
}

function sanitizeText(value: string): string {
	return value
		.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "")
		.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function normalizeStatus(value: unknown, fallback: SubagentActivityStatus): SubagentActivityStatus {
	switch (value) {
		case "queued":
		case "pending":
		case "running":
		case "stopping":
		case "detached":
		case "complete":
		case "failed":
		case "partial":
		case "paused":
		case "stopped":
		case "rejected":
			return value;
		case "completed":
			return "complete";
		default:
			return fallback;
	}
}

function controlState(value: unknown): SubagentControlState | undefined {
	return value === "active_long_running" || value === "needs_attention" ? value : undefined;
}

function processState(value: unknown): SubagentProcessState | undefined {
	return value === "pending" || value === "not-started" || value === "observed" || value === "unknown"
		? value
		: undefined;
}

function terminal(status: SubagentActivityStatus): boolean {
	return terminalStatuses.has(status);
}

function live(status: SubagentActivityStatus): boolean {
	return !terminal(status);
}

function activeStatusRank(status: SubagentActivityStatus): number {
	if (status === "running") return 0;
	if (status === "detached") return 1;
	if (status === "stopping") return 2;
	if (status === "queued") return 3;
	if (status === "pending") return 4;
	return 5;
}

function completionStatus(
	data: Record<string, unknown>,
	fallback: SubagentActivityStatus,
	preserveAuthoritativeFallback = false,
): SubagentActivityStatus {
	if (
		preserveAuthoritativeFallback &&
		fallback !== "complete" &&
		(terminal(fallback) || fallback === "detached")
	)
		return fallback;
	const normalized = normalizeStatus(data.state, fallback);
	if (data.success === true) return "complete";
	if (data.success === false) {
		return normalized === "partial" ||
			normalized === "paused" ||
			normalized === "stopped" ||
			normalized === "rejected" ||
			normalized === "detached"
			? normalized
			: "failed";
	}
	return terminal(normalized) || normalized === "detached" ? normalized : "complete";
}

function sameSession(record: Record<string, unknown>, currentSessionId: string | undefined): boolean {
	const eventSessionId = stringValue(record.sessionId);
	return (
		currentSessionId === undefined || eventSessionId === undefined || eventSessionId === currentSessionId
	);
}

function firstString(...values: unknown[]): string | undefined {
	for (const value of values) {
		const text = stringValue(value);
		if (text) return text;
	}
	return undefined;
}

function labelFromArgs(args: unknown): { agent?: string; label?: string; agents: string[] } {
	if (!isRecord(args)) return { agents: [] };
	const agent = firstString(args.agent);
	const label = firstString(
		args.workflow ? `workflow: ${String(args.workflow)}` : undefined,
		args.workflowScript ? "workflow" : undefined,
		args.task,
		args.name,
	);
	const agents = agent ? [agent] : [];
	return { ...(agent ? { agent } : {}), ...(label ? { label } : {}), agents };
}

function detailsFromToolResult(value: unknown): Record<string, unknown> | undefined {
	if (!isRecord(value)) return undefined;
	return isRecord(value.details) ? value.details : value;
}

function asyncIdentity(details: Record<string, unknown>): { id: string; asyncDir: string } | undefined {
	const id = firstString(details.asyncId, details.background === true ? details.runId : undefined);
	const asyncDir = stringValue(details.asyncDir);
	return id && asyncDir ? { id, asyncDir } : undefined;
}

function defaultReadStatus(maxStatusBytes: number): (asyncDir: string) => unknown {
	return (asyncDir) => {
		const statusPath = join(asyncDir, "status.json");
		if (!existsSync(statusPath)) return undefined;
		const stat = statSync(statusPath);
		if (!stat.isFile() || stat.size > maxStatusBytes) return undefined;
		return JSON.parse(readFileSync(statusPath, "utf8"));
	};
}

function cloneItem(item: SubagentActivityItem): SubagentActivityItem {
	return Object.freeze({ ...item, agents: Object.freeze([...item.agents]) });
}

function freezeSnapshot(
	active: SubagentActivityItem[],
	recent: SubagentActivityItem[],
): SubagentActivitySnapshot {
	return Object.freeze({
		active: Object.freeze(active.map(cloneItem)),
		recent: Object.freeze(recent.map(cloneItem)),
	});
}

function snapshotKey(snapshot: SubagentActivitySnapshot): string {
	return JSON.stringify(snapshot);
}

function optionalBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function optionalProcessState(value: unknown): SubagentProcessState | undefined {
	return isRecord(value) ? processState(value.state) : processState(value);
}

function parseStep(
	value: unknown,
	index: number,
	key: string,
	fallbackStartedAt: number,
): SubagentActivityStep | undefined {
	if (!isRecord(value)) return undefined;
	const startedAt = numberValue(value.startedAt);
	const endedAt = numberValue(value.endedAt);
	const status = normalizeStatus(value.status ?? value.state, "pending");
	const durationMs =
		numberValue(value.durationMs) ??
		(startedAt !== undefined && endedAt !== undefined ? Math.max(0, endedAt - startedAt) : undefined);
	const externalJob = isRecord(value.externalJob) ? value.externalJob : undefined;
	const externalState = firstString(externalJob?.state);
	const activityState =
		controlState(value.activityState) ?? (externalState === "blocked" ? "needs_attention" : undefined);
	const agent = firstString(value.agent, ...(stringArray(value.agents) as unknown[]));
	const label = firstString(value.label, value.phase, value.description, externalJob?.provider);
	const currentTool = firstString(
		value.currentTool,
		externalJob?.operation,
		externalState ? `external job ${externalState}` : undefined,
	);
	const currentToolStartedAt = numberValue(value.currentToolStartedAt);
	const currentPath = stringValue(value.currentPath);
	const turnCount = numberValue(value.turnCount);
	const toolCount = numberValue(value.toolCount);
	const process = optionalProcessState(value.processTerminal);
	const timedOut = optionalBoolean(value.timedOut);
	return {
		key,
		index,
		status,
		...(agent ? { agent } : {}),
		...(label ? { label } : {}),
		...(startedAt !== undefined ? { startedAt } : { startedAt: fallbackStartedAt }),
		...(endedAt !== undefined ? { endedAt } : {}),
		...(durationMs !== undefined ? { durationMs } : {}),
		...(activityState ? { activityState } : {}),
		...(timedOut !== undefined ? { timedOut } : {}),
		...(currentTool ? { currentTool } : {}),
		...(currentToolStartedAt !== undefined ? { currentToolStartedAt } : {}),
		...(currentPath ? { currentPath } : {}),
		...(turnCount !== undefined ? { turnCount } : {}),
		...(toolCount !== undefined ? { toolCount } : {}),
		...(process ? { processState: process } : {}),
	};
}

function parseNestedSteps(
	values: readonly unknown[],
	prefix: string,
	fallbackStartedAt: number,
	output: SubagentActivityStep[],
): void {
	for (const [index, value] of values.entries()) {
		if (output.length >= MAX_NESTED_STEPS) return;
		if (!isRecord(value)) continue;
		const ownKey = firstString(value.childId, value.workflowKey, value.id) ?? String(index);
		const key = prefix ? `${prefix}/${ownKey}` : ownKey;
		const nestedSteps = Array.isArray(value.steps) ? value.steps : [];
		if (nestedSteps.length > 0) {
			parseNestedSteps(nestedSteps, key, numberValue(value.startedAt) ?? fallbackStartedAt, output);
		} else {
			const step = parseStep(value, output.length, key, fallbackStartedAt);
			if (step) output.push(step);
		}
		if (Array.isArray(value.children)) {
			parseNestedSteps(value.children, key, numberValue(value.startedAt) ?? fallbackStartedAt, output);
		}
	}
}

function stepsFromStatus(
	status: Record<string, unknown>,
	fallbackStartedAt: number,
): SubagentActivityStep[] | undefined {
	if (!Array.isArray(status.steps)) return undefined;
	const output: SubagentActivityStep[] = [];
	parseNestedSteps(status.steps, "", fallbackStartedAt, output);
	return output;
}

function stepsFromForegroundDetails(
	details: Record<string, unknown>,
	fallbackStartedAt: number,
): SubagentActivityStep[] | undefined {
	const workflowChildren = isRecord(details.workflowChildren) ? details.workflowChildren : undefined;
	if (workflowChildren && Array.isArray(workflowChildren.children)) {
		const output: SubagentActivityStep[] = [];
		for (const [index, child] of workflowChildren.children.entries()) {
			if (!isRecord(child)) continue;
			const activity = isRecord(child.activity) ? child.activity : {};
			const combined = {
				...activity,
				agent: child.agent,
				label: child.childId,
				state: child.state,
			};
			const step = parseStep(combined, index, firstString(child.childId) ?? String(index), fallbackStartedAt);
			if (step) output.push(step);
		}
		return output;
	}
	for (const field of ["progress", "results"] as const) {
		if (!Array.isArray(details[field])) continue;
		return details[field]
			.map((progress, index) => {
				if (!isRecord(progress)) return undefined;
				const stepIndex = numberValue(progress.index) ?? index;
				return parseStep(progress, stepIndex, String(stepIndex), fallbackStartedAt);
			})
			.filter((step): step is SubagentActivityStep => step !== undefined);
	}
	return undefined;
}

function finalizeSteps(record: SubagentActivityRecord): void {
	if (!record.steps || !terminal(record.status) || record.status === "paused") return;
	for (const step of record.steps) {
		if (!live(step.status)) continue;
		step.status = record.status;
		if (step.endedAt === undefined && record.endedAt !== undefined) step.endedAt = record.endedAt;
		if (step.endedAt !== undefined) {
			step.durationMs ??= Math.max(0, step.endedAt - (step.startedAt ?? record.startedAt));
		}
	}
}

function hasLiveSteps(record: SubagentActivityRecord): boolean {
	return record.steps?.some((step) => live(step.status)) ?? false;
}

export function createSubagentActivityTracker(
	options: SubagentActivityTrackerOptions = {},
): SubagentActivityTracker {
	const retentionMs = Math.max(0, Math.trunc(options.retentionMs ?? DEFAULT_RETENTION_MS));
	const pollIntervalMs = Math.max(1, Math.trunc(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS));
	const maxStatusMisses = Math.max(1, Math.trunc(options.maxStatusMisses ?? DEFAULT_MAX_STATUS_MISSES));
	const readStatus =
		options.readStatus ?? defaultReadStatus(options.maxStatusBytes ?? DEFAULT_MAX_STATUS_BYTES);
	const now = options.now ?? Date.now;
	const setTimer = options.setInterval ?? setInterval;
	const clearTimer = options.clearInterval ?? clearInterval;
	const records = new Map<string, SubagentActivityRecord>();
	let disposed = false;
	let timer: ReturnType<typeof setInterval> | undefined;
	let lastSnapshotKey = snapshotKey(EMPTY_SNAPSHOT);

	const normalizeNow = (value?: number) => numberValue(value) ?? now();
	const changed = (): void => {
		const snapshot = getSnapshot();
		const key = snapshotKey(snapshot);
		if (key === lastSnapshotKey) return;
		lastSnapshotKey = key;
		options.onChange?.(snapshot);
	};
	const stopPoller = (): void => {
		if (!timer) return;
		clearTimer(timer);
		timer = undefined;
	};
	const shouldPoll = (record: SubagentActivityRecord): boolean =>
		record.source === "async" &&
		Boolean(record.asyncDir) &&
		(!terminal(record.status) || hasLiveSteps(record));
	const missStatus = (record: SubagentActivityRecord): boolean => {
		const before = JSON.stringify(record);
		record.statusMisses = (record.statusMisses ?? 0) + 1;
		if (record.statusMisses >= maxStatusMisses) {
			const endedAt = normalizeNow();
			record.status = "failed";
			record.statusUnavailable = true;
			record.endedAt = endedAt;
			record.durationMs = Math.max(0, endedAt - record.startedAt);
			record.updatedAt = endedAt;
			finalizeSteps(record);
		}
		return JSON.stringify(record) !== before;
	};
	const syncOne = (record: SubagentActivityRecord): boolean => {
		if (!record.asyncDir || record.source !== "async" || disposed) return false;
		let status: unknown;
		try {
			status = readStatus(record.asyncDir);
		} catch {
			return missStatus(record);
		}
		if (!isRecord(status)) return missStatus(record);
		const before = JSON.stringify(record);
		record.statusMisses = 0;
		record.statusUnavailable = false;
		record.status = normalizeStatus(status.state, record.status);
		record.currentTool = stringValue(status.currentTool);
		record.currentToolStartedAt = numberValue(status.currentToolStartedAt);
		record.currentPath = stringValue(status.currentPath);
		record.activityState = controlState(status.activityState);
		record.timedOut = optionalBoolean(status.timedOut);
		record.turnCount = numberValue(status.turnCount);
		record.toolCount = numberValue(status.toolCount);
		record.processState = optionalProcessState(status.processTerminal);
		record.startedAt = numberValue(status.startedAt) ?? record.startedAt;
		record.endedAt = numberValue(status.endedAt);
		record.updatedAt = numberValue(status.lastUpdate) ?? record.updatedAt;
		record.steps = stepsFromStatus(status, record.startedAt) ?? record.steps;
		if (terminal(record.status) && record.endedAt === undefined) record.endedAt = normalizeNow();
		record.durationMs =
			record.endedAt === undefined ? undefined : Math.max(0, record.endedAt - record.startedAt);
		finalizeSteps(record);
		return JSON.stringify(record) !== before;
	};
	const syncActive = (): void => {
		if (disposed) return;
		let mutated = false;
		for (const record of records.values()) {
			if (shouldPoll(record)) mutated = syncOne(record) || mutated;
		}
		if (mutated) changed();
		if (![...records.values()].some(shouldPoll)) stopPoller();
	};
	const ensurePoller = (): void => {
		if (timer || disposed || ![...records.values()].some(shouldPoll)) return;
		timer = setTimer(syncActive, pollIntervalMs);
		timer?.unref?.();
	};
	const upsert = (record: SubagentActivityRecord): void => {
		records.set(record.id, record);
		if (record.source === "async" && record.asyncDir) syncOne(record);
		ensurePoller();
		changed();
	};
	const knownRecord = (id: string | undefined): SubagentActivityRecord | undefined => {
		if (!id) return undefined;
		return records.get(id) ?? [...records.values()].find((record) => record.id === id || record.runId === id);
	};
	const foregroundRecord = (toolCallId: string): SubagentActivityRecord | undefined =>
		records.get(`foreground:${sanitizeText(toolCallId)}`);
	const applyForegroundDetails = (
		record: SubagentActivityRecord,
		details: Record<string, unknown>,
		at: number,
	): void => {
		const steps = stepsFromForegroundDetails(details, record.startedAt);
		if (steps) record.steps = steps;
		record.runId = firstString(details.runId, record.runId);
		const workflowChildren = isRecord(details.workflowChildren) ? details.workflowChildren : undefined;
		if (workflowChildren) record.status = normalizeStatus(workflowChildren.workflowState, record.status);
		else if (steps?.length) {
			if (steps.some((step) => step.status === "detached")) record.status = "detached";
			else if (steps.some((step) => step.status === "paused")) record.status = "paused";
			else if (steps.some((step) => step.status === "stopped")) record.status = "stopped";
			else if (steps.some((step) => step.status === "rejected")) record.status = "rejected";
			else if (steps.some((step) => step.status === "failed")) record.status = "failed";
			else if (steps.some((step) => step.status === "partial")) record.status = "partial";
			else if (steps.every((step) => step.status === "complete")) record.status = "complete";
		}
		const progress = Array.isArray(details.progress) ? details.progress.find(isRecord) : undefined;
		if (progress) {
			record.activityState = controlState(progress.activityState);
			record.currentTool = stringValue(progress.currentTool);
			record.currentToolStartedAt = numberValue(progress.currentToolStartedAt);
			record.currentPath = stringValue(progress.currentPath);
			record.turnCount = numberValue(progress.turnCount);
			record.toolCount = numberValue(progress.toolCount);
		}
		record.updatedAt = at;
	};
	const targetStep = (
		record: SubagentActivityRecord,
		data: Record<string, unknown>,
	): SubagentActivityStep | undefined => {
		const key = firstString(data.workflowKey, data.childId, data.nestedRunId);
		if (key) {
			const exact = record.steps?.find((step) => step.key === key || step.key.endsWith(`/${key}`));
			if (exact) return exact;
		}
		const index = numberValue(data.stepIndex ?? data.index);
		if (index !== undefined) return record.steps?.find((step) => step.index === index);
		const agent = stringValue(data.agent);
		return agent ? record.steps?.find((step) => step.agent === agent && live(step.status)) : undefined;
	};

	function flattenRecord(record: SubagentActivityRecord): SubagentActivityItem[] {
		if (record.steps && record.steps.length > 0) {
			return record.steps.map((step) => {
				const startedAt = step.startedAt ?? record.startedAt;
				const endedAt = step.endedAt ?? (terminal(step.status) ? record.endedAt : undefined);
				const durationMs =
					step.durationMs ?? (endedAt === undefined ? undefined : Math.max(0, endedAt - startedAt));
				const agent = step.agent ?? record.agents[step.index] ?? record.agent;
				return {
					id: `${record.id}:${step.key}`,
					source: record.source,
					status: step.status,
					...(agent ? { agent } : {}),
					agents: agent ? [agent] : record.agents,
					...((step.label ?? record.label) ? { label: step.label ?? record.label } : {}),
					startedAt,
					...(endedAt !== undefined ? { endedAt } : {}),
					...(durationMs !== undefined ? { durationMs } : {}),
					...((step.activityState ?? record.activityState)
						? { activityState: step.activityState ?? record.activityState }
						: {}),
					...((step.timedOut ?? record.timedOut) !== undefined
						? { timedOut: step.timedOut ?? record.timedOut }
						: {}),
					...((step.currentTool ?? record.currentTool)
						? { currentTool: step.currentTool ?? record.currentTool }
						: {}),
					...((step.currentToolStartedAt ?? record.currentToolStartedAt) !== undefined
						? { currentToolStartedAt: step.currentToolStartedAt ?? record.currentToolStartedAt }
						: {}),
					...((step.currentPath ?? record.currentPath)
						? { currentPath: step.currentPath ?? record.currentPath }
						: {}),
					...((step.turnCount ?? record.turnCount) !== undefined
						? { turnCount: step.turnCount ?? record.turnCount }
						: {}),
					...((step.toolCount ?? record.toolCount) !== undefined
						? { toolCount: step.toolCount ?? record.toolCount }
						: {}),
					...((step.processState ?? record.processState)
						? { processState: step.processState ?? record.processState }
						: {}),
					...(record.statusUnavailable ? { statusUnavailable: true } : {}),
				};
			});
		}
		return [
			{
				id: record.id,
				source: record.source,
				status: record.status,
				...(record.agent ? { agent: record.agent } : {}),
				agents: record.agents,
				...(record.label ? { label: record.label } : {}),
				startedAt: record.startedAt,
				...(record.endedAt !== undefined ? { endedAt: record.endedAt } : {}),
				...(record.durationMs !== undefined ? { durationMs: record.durationMs } : {}),
				...(record.activityState ? { activityState: record.activityState } : {}),
				...(record.timedOut !== undefined ? { timedOut: record.timedOut } : {}),
				...(record.currentTool ? { currentTool: record.currentTool } : {}),
				...(record.currentToolStartedAt !== undefined
					? { currentToolStartedAt: record.currentToolStartedAt }
					: {}),
				...(record.currentPath ? { currentPath: record.currentPath } : {}),
				...(record.turnCount !== undefined ? { turnCount: record.turnCount } : {}),
				...(record.toolCount !== undefined ? { toolCount: record.toolCount } : {}),
				...(record.processState ? { processState: record.processState } : {}),
				...(record.statusUnavailable ? { statusUnavailable: true } : {}),
			},
		];
	}
	function getSnapshot(at = now()): SubagentActivitySnapshot {
		if (disposed) return EMPTY_SNAPSHOT;
		const active: SubagentActivityItem[] = [];
		const recent: SubagentActivityItem[] = [];
		for (const record of records.values()) {
			const items = flattenRecord(record);
			for (const item of items) {
				if (terminal(item.status)) {
					const endedAt = item.endedAt ?? item.startedAt;
					if (at - endedAt <= retentionMs) recent.push(item);
				} else {
					active.push(item);
				}
			}
			const recordEndedAt =
				record.endedAt ?? record.steps?.reduce((latest, step) => Math.max(latest, step.endedAt ?? 0), 0) ?? 0;
			if (
				terminal(record.status) &&
				!hasLiveSteps(record) &&
				recordEndedAt > 0 &&
				at - recordEndedAt > retentionMs
			) {
				records.delete(record.id);
			}
		}
		active.sort(
			(left, right) =>
				activeStatusRank(left.status) - activeStatusRank(right.status) ||
				left.startedAt - right.startedAt ||
				left.id.localeCompare(right.id, "en"),
		);
		recent.sort(
			(left, right) => (right.endedAt ?? 0) - (left.endedAt ?? 0) || left.id.localeCompare(right.id, "en"),
		);
		return freezeSnapshot(active.slice(0, MAX_ITEMS), recent.slice(0, MAX_ITEMS));
	}

	return {
		handleAsyncStarted(data) {
			if (disposed || !isRecord(data) || !sameSession(data, options.currentSessionId)) return;
			const id = stringValue(data.id);
			if (!id) return;
			if (options.currentSessionId !== undefined && data.sessionId === undefined && !records.has(id)) return;
			const agents = stringArray(data.agents);
			const agent = firstString(data.agent, agents[0]);
			const asyncDir = stringValue(data.asyncDir);
			const label = firstString(data.goal, data.task, data.mode);
			upsert({
				id,
				source: "async",
				status: normalizeStatus(data.state, "queued"),
				...(asyncDir ? { asyncDir } : {}),
				...(agent ? { agent } : {}),
				agents: agents.length > 0 ? agents : agent ? [agent] : [],
				...(label ? { label } : {}),
				startedAt: numberValue(data.startedAt) ?? normalizeNow(),
				updatedAt: normalizeNow(),
			});
		},
		handleAsyncComplete(data) {
			if (disposed || !isRecord(data) || !sameSession(data, options.currentSessionId)) return;
			const id = firstString(data.id, data.runId);
			if (!id) return;
			const existing = knownRecord(id);
			if (options.currentSessionId !== undefined && data.sessionId === undefined && !existing) return;
			if (existing) syncOne(existing);
			const endedAt = numberValue(data.timestamp) ?? normalizeNow();
			const status = completionStatus(data, existing?.status ?? "complete", existing !== undefined);
			const agents = stringArray(data.agents);
			const agent = firstString(data.agent, agents[0], existing?.agent);
			const timedOut = optionalBoolean(data.timedOut);
			const next: SubagentActivityRecord = {
				...(existing ?? {
					id,
					source: "async" as const,
					startedAt: endedAt,
					updatedAt: endedAt,
					agents: [],
				}),
				status,
				...(agent ? { agent } : {}),
				agents: agents.length > 0 ? agents : (existing?.agents ?? (agent ? [agent] : [])),
				...(timedOut !== undefined ? { timedOut } : {}),
				...(terminal(status)
					? { endedAt, durationMs: Math.max(0, endedAt - (existing?.startedAt ?? endedAt)) }
					: {}),
				updatedAt: endedAt,
			};
			finalizeSteps(next);
			records.set(existing?.id ?? id, next);
			ensurePoller();
			changed();
		},
		handleForegroundComplete(data) {
			if (disposed || !isRecord(data) || !sameSession(data, options.currentSessionId)) return;
			const eventId = firstString(data.id, data.runId);
			const endedAt = numberValue(data.timestamp) ?? normalizeNow();
			const direct = knownRecord(firstString(data.id)) ?? knownRecord(firstString(data.runId));
			const candidates = [...records.values()]
				.filter((record) => {
					const age = endedAt - record.updatedAt;
					return (
						record.source === "foreground" &&
						record.foregroundFallback === true &&
						live(record.status) &&
						age >= 0 &&
						age <= FOREGROUND_COMPLETE_MATCH_WINDOW_MS
					);
				})
				.sort((left, right) => right.updatedAt - left.updatedAt);
			const fallback =
				direct?.source === "foreground" ? direct : candidates.length === 1 ? candidates[0] : undefined;
			if (direct?.source === "async" && !fallback) return;
			const id = fallback?.id ?? (eventId ? `foreground:${eventId}` : undefined);
			if (!id) return;
			const status = completionStatus(data, fallback?.status ?? "complete");
			const agent = firstString(data.agent, fallback?.agent);
			const timedOut = optionalBoolean(data.timedOut);
			const next: SubagentActivityRecord = {
				...(fallback ?? {
					id,
					source: "foreground" as const,
					startedAt: endedAt,
					agents: [],
					updatedAt: endedAt,
				}),
				status,
				...(agent ? { agent } : {}),
				agents: agent ? [agent] : (fallback?.agents ?? []),
				...(timedOut !== undefined ? { timedOut } : {}),
				...(terminal(status)
					? { endedAt, durationMs: Math.max(0, endedAt - (fallback?.startedAt ?? endedAt)) }
					: {}),
				updatedAt: endedAt,
				foregroundFallback: false,
			};
			finalizeSteps(next);
			records.set(next.id, next);
			changed();
		},
		handleControlEvent(data) {
			if (disposed || !isRecord(data) || !sameSession(data, options.currentSessionId)) return;
			const event = isRecord(data.event) ? data.event : data;
			if (!sameSession(event, options.currentSessionId)) return;
			const runId = firstString(event.runId);
			const toolCallId = firstString(event.toolCallId);
			const record = knownRecord(runId) ?? (toolCallId ? foregroundRecord(toolCallId) : undefined);
			if (!record) return;
			const state = controlState(event.to) ?? controlState(event.type);
			if (!state) return;
			const step = targetStep(record, event);
			const target = step ?? record;
			target.activityState = state;
			target.currentTool = stringValue(event.currentTool) ?? target.currentTool;
			target.currentPath = stringValue(event.currentPath) ?? target.currentPath;
			if (step && numberValue(event.toolCount) !== undefined) step.toolCount = numberValue(event.toolCount);
			record.updatedAt = numberValue(event.ts) ?? normalizeNow();
			changed();
		},
		handleChildStatus(data) {
			if (disposed || !isRecord(data) || !sameSession(data, options.currentSessionId)) return;
			const runId = firstString(data.runId);
			const record = knownRecord(runId);
			if (!record || (data.status !== "stopping" && data.status !== "stopped")) return;
			let step = targetStep(record, data);
			if (!step) {
				const key = firstString(data.workflowKey, data.childId) ?? String(record.steps?.length ?? 0);
				step = parseStep(
					{
						agent: data.agent,
						label: data.label ?? data.phase,
						status: data.status,
						startedAt: record.startedAt,
					},
					record.steps?.length ?? 0,
					key,
					record.startedAt,
				);
				if (!step) return;
				record.steps = [...(record.steps ?? []), step];
			} else {
				step.status = data.status;
			}
			const at = numberValue(data.ts) ?? normalizeNow();
			if (data.status === "stopped") {
				step.endedAt = at;
				step.durationMs = Math.max(0, at - (step.startedAt ?? record.startedAt));
			}
			record.updatedAt = at;
			changed();
		},
		handleProcessTerminal(data) {
			if (disposed || !isRecord(data) || !sameSession(data, options.currentSessionId)) return;
			const runId = firstString(data.runId);
			const record = knownRecord(runId);
			const state = processState(data.state);
			if (!record || !state) return;
			const childIndex = numberValue(data.childIndex);
			const step =
				childIndex === undefined ? undefined : record.steps?.find((item) => item.index === childIndex);
			if (step) step.processState = state;
			else record.processState = state;
			record.updatedAt = numberValue(data.observedAt) ?? normalizeNow();
			changed();
		},
		reconcileRestoredAsyncToolResults(detailsValues) {
			if (disposed) return;
			const retainedIds = new Set<string>();
			for (const value of detailsValues) {
				const details = detailsFromToolResult(value);
				if (!details) continue;
				const identity = asyncIdentity(details);
				if (identity) retainedIds.add(identity.id);
			}
			let removed = false;
			for (const [id, record] of records) {
				if (record.restored && !retainedIds.has(id)) {
					records.delete(id);
					removed = true;
				}
			}
			for (const value of detailsValues) this.restoreAsyncToolResult(value);
			if (removed) changed();
		},
		restoreAsyncToolResult(detailsValue) {
			if (disposed) return;
			const details = detailsFromToolResult(detailsValue);
			if (!details) return;
			const identity = asyncIdentity(details);
			if (!identity || records.has(identity.id)) return;
			const label = firstString(details.goal, details.task, details.mode);
			upsert({
				id: identity.id,
				source: "async",
				status: "queued",
				asyncDir: identity.asyncDir,
				restored: true,
				agents: stringArray(details.agents),
				...(label ? { label } : {}),
				startedAt: normalizeNow(),
				updatedAt: normalizeNow(),
			});
		},
		startForegroundTool(event, eventNow) {
			if (disposed || event.toolName !== "subagent" || !isRecord(event.args)) return;
			if (event.args.action !== undefined || event.args.async === true) return;
			const startedAt = normalizeNow(eventNow);
			const label = labelFromArgs(event.args);
			const id = `foreground:${sanitizeText(event.toolCallId)}`;
			records.set(id, {
				id,
				source: "foreground",
				status: "running",
				...(label.agent ? { agent: label.agent } : {}),
				agents: label.agents,
				...(label.label ? { label: label.label } : {}),
				startedAt,
				updatedAt: startedAt,
				foregroundFallback: true,
			});
			changed();
		},
		updateForegroundTool(event, eventNow) {
			if (disposed || event.toolName !== "subagent") return;
			const record = foregroundRecord(event.toolCallId);
			const details = detailsFromToolResult(event.partialResult);
			if (!record || !details) return;
			applyForegroundDetails(record, details, normalizeNow(eventNow));
			changed();
		},
		finishForegroundTool(event, eventNow) {
			if (disposed || event.toolName !== "subagent") return;
			const id = `foreground:${sanitizeText(event.toolCallId)}`;
			const record = records.get(id);
			const details = detailsFromToolResult(event.result);
			if (details) {
				const identity = asyncIdentity(details);
				if (identity) {
					records.delete(id);
					this.restoreAsyncToolResult(details);
					changed();
					return;
				}
			}
			if (!record) return;
			const endedAt = normalizeNow(eventNow);
			if (details) applyForegroundDetails(record, details, endedAt);
			if (!event.isError && record.status === "detached") {
				record.updatedAt = endedAt;
				record.foregroundFallback = false;
				changed();
				return;
			}
			record.status = event.isError ? "failed" : terminal(record.status) ? record.status : "complete";
			record.endedAt = endedAt;
			record.durationMs = Math.max(0, endedAt - record.startedAt);
			record.updatedAt = endedAt;
			record.foregroundFallback = false;
			finalizeSteps(record);
			changed();
		},
		hasActive() {
			return (
				!disposed &&
				[...records.values()].some((record) => flattenRecord(record).some((item) => live(item.status)))
			);
		},
		getSnapshot,
		reset() {
			records.clear();
			stopPoller();
			changed();
		},
		dispose() {
			disposed = true;
			records.clear();
			stopPoller();
		},
	};
}
