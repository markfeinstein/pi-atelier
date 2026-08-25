import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const SUBAGENT_ASYNC_STARTED_EVENT = "subagent:async-started" as const;
export const SUBAGENT_ASYNC_COMPLETE_EVENT = "subagent:async-complete" as const;
export const SUBAGENT_FOREGROUND_COMPLETE_EVENT = "subagent:foreground-complete" as const;

export type SubagentActivityStatus =
	| "queued"
	| "pending"
	| "running"
	| "complete"
	| "failed"
	| "paused"
	| "stopped"
	| "rejected";

export type SubagentActivitySource = "async" | "foreground";

export interface SubagentActivityItem {
	id: string;
	source: SubagentActivitySource;
	status: SubagentActivityStatus;
	agent?: string;
	agents: readonly string[];
	label?: string;
	startedAt: number;
	endedAt?: number;
	durationMs?: number;
	currentTool?: string;
	currentToolStartedAt?: number;
	turnCount?: number;
	toolCount?: number;
}

export interface SubagentActivitySnapshot {
	active: readonly SubagentActivityItem[];
	recent: readonly SubagentActivityItem[];
}

export interface SubagentActivityTracker {
	handleAsyncStarted(data: unknown): void;
	handleAsyncComplete(data: unknown): void;
	handleForegroundComplete(data: unknown): void;
	startForegroundTool(event: { toolCallId: string; toolName: string; args: unknown }, now?: number): void;
	finishForegroundTool(event: { toolCallId: string; toolName: string; isError: boolean }, now?: number): void;
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
	asyncDir?: string;
	agent?: string;
	agents: string[];
	label?: string;
	startedAt: number;
	endedAt?: number;
	durationMs?: number;
	currentTool?: string;
	currentToolStartedAt?: number;
	turnCount?: number;
	toolCount?: number;
	updatedAt: number;
	foregroundFallback?: boolean;
	steps?: SubagentActivityStep[];
}

interface SubagentActivityStep {
	index: number;
	status: SubagentActivityStatus;
	agent?: string;
	label?: string;
	startedAt?: number;
	endedAt?: number;
	durationMs?: number;
	currentTool?: string;
	currentToolStartedAt?: number;
	turnCount?: number;
	toolCount?: number;
}

const DEFAULT_RETENTION_MS = 10 * 60 * 1_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_MAX_STATUS_BYTES = 256 * 1_024;
const MAX_ITEMS = 40;
const FOREGROUND_COMPLETE_MATCH_WINDOW_MS = 5_000;
const EMPTY_SNAPSHOT: SubagentActivitySnapshot = Object.freeze({
	active: Object.freeze([]),
	recent: Object.freeze([]),
});

const terminalStatuses = new Set<SubagentActivityStatus>([
	"complete",
	"failed",
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
		case "complete":
		case "failed":
		case "paused":
		case "stopped":
		case "rejected":
			return value;
		case "completed":
			return "complete";
		case "detached":
			return "running";
		default:
			return fallback;
	}
}

function terminal(status: SubagentActivityStatus): boolean {
	return terminalStatuses.has(status);
}

function activeStatusRank(status: SubagentActivityStatus): number {
	if (status === "running") return 0;
	if (status === "queued") return 1;
	if (status === "pending") return 2;
	return 3;
}

function statusFromSuccess(success: unknown, fallback: SubagentActivityStatus): SubagentActivityStatus {
	if (success === true) return "complete";
	if (success === false) return "failed";
	return fallback;
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
	const label = firstString(args.action, args.workflowScript ? "workflow" : undefined, args.task, args.name);
	const agents = agent ? [agent] : [];
	return { ...(agent ? { agent } : {}), ...(label ? { label } : {}), agents };
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
	return Object.freeze({
		...item,
		agents: Object.freeze([...item.agents]),
	});
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

export function createSubagentActivityTracker(
	options: SubagentActivityTrackerOptions = {},
): SubagentActivityTracker {
	const retentionMs = Math.max(0, Math.trunc(options.retentionMs ?? DEFAULT_RETENTION_MS));
	const pollIntervalMs = Math.max(1, Math.trunc(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS));
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
	const syncOne = (record: SubagentActivityRecord): boolean => {
		if (!record.asyncDir || record.source !== "async" || disposed) return false;
		let status: unknown;
		try {
			status = readStatus(record.asyncDir);
		} catch {
			return false;
		}
		if (!isRecord(status)) return false;
		let mutated = false;
		const nextStatus = normalizeStatus(status.state, record.status);
		if (nextStatus !== record.status) {
			record.status = nextStatus;
			mutated = true;
		}
		const currentTool = stringValue(status.currentTool);
		if (currentTool !== undefined && record.currentTool !== currentTool) {
			record.currentTool = currentTool;
			mutated = true;
		}
		const currentToolStartedAt = numberValue(status.currentToolStartedAt);
		if (currentToolStartedAt !== undefined && record.currentToolStartedAt !== currentToolStartedAt) {
			record.currentToolStartedAt = currentToolStartedAt;
			mutated = true;
		}
		const turnCount = numberValue(status.turnCount);
		if (turnCount !== undefined && record.turnCount !== turnCount) {
			record.turnCount = turnCount;
			mutated = true;
		}
		const toolCount = numberValue(status.toolCount);
		if (toolCount !== undefined && record.toolCount !== toolCount) {
			record.toolCount = toolCount;
			mutated = true;
		}
		const startedAt = numberValue(status.startedAt);
		if (startedAt !== undefined && record.startedAt !== startedAt) {
			record.startedAt = startedAt;
			mutated = true;
		}
		const endedAt = numberValue(status.endedAt);
		if (endedAt !== undefined && record.endedAt !== endedAt) {
			record.endedAt = endedAt;
			mutated = true;
		}
		const updatedAt = numberValue(status.lastUpdate);
		if (updatedAt !== undefined && record.updatedAt !== updatedAt) {
			record.updatedAt = updatedAt;
			mutated = true;
		}
		if (terminal(record.status) && record.endedAt === undefined) {
			record.endedAt = normalizeNow();
			record.durationMs = Math.max(0, record.endedAt - record.startedAt);
			mutated = true;
		}
		if (Array.isArray(status.steps)) {
			const steps = status.steps
				.map((step, index): SubagentActivityStep | undefined => {
					if (!isRecord(step)) return undefined;
					const stepStartedAt = numberValue(step.startedAt);
					const stepEndedAt = numberValue(step.endedAt);
					const stepStatus = normalizeStatus(step.status, "pending");
					const durationMs =
						numberValue(step.durationMs) ??
						(stepStartedAt !== undefined && stepEndedAt !== undefined
							? Math.max(0, stepEndedAt - stepStartedAt)
							: undefined);
					const agent = stringValue(step.agent);
					const label = firstString(step.label, step.phase, step.description);
					const currentTool = stringValue(step.currentTool);
					const currentToolStartedAt = numberValue(step.currentToolStartedAt);
					const turnCount = numberValue(step.turnCount);
					const toolCount = numberValue(step.toolCount);
					return {
						index,
						status: stepStatus,
						...(agent ? { agent } : {}),
						...(label ? { label } : {}),
						...(stepStartedAt !== undefined ? { startedAt: stepStartedAt } : {}),
						...(stepEndedAt !== undefined ? { endedAt: stepEndedAt } : {}),
						...(durationMs !== undefined ? { durationMs } : {}),
						...(currentTool ? { currentTool } : {}),
						...(currentToolStartedAt !== undefined ? { currentToolStartedAt } : {}),
						...(turnCount !== undefined ? { turnCount } : {}),
						...(toolCount !== undefined ? { toolCount } : {}),
					};
				})
				.filter((step): step is SubagentActivityStep => step !== undefined);
			const before = JSON.stringify(record.steps ?? []);
			record.steps = steps;
			if (JSON.stringify(steps) !== before) mutated = true;
		}
		return mutated;
	};
	const syncActive = (): void => {
		if (disposed) return;
		let mutated = false;
		for (const record of records.values()) {
			if (record.source === "async" && !terminal(record.status)) mutated = syncOne(record) || mutated;
		}
		if (mutated) changed();
		if (![...records.values()].some((record) => record.source === "async" && !terminal(record.status)))
			stopPoller();
	};
	const ensurePoller = (): void => {
		if (timer || disposed) return;
		timer = setTimer(syncActive, pollIntervalMs);
		timer?.unref?.();
	};
	const upsert = (record: SubagentActivityRecord): void => {
		records.set(record.id, record);
		if (record.source === "async" && !terminal(record.status)) {
			syncOne(record);
			ensurePoller();
		}
		changed();
	};
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
			if (terminal(record.status) && recordEndedAt > 0 && at - recordEndedAt > retentionMs)
				records.delete(record.id);
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
	function flattenRecord(record: SubagentActivityRecord): SubagentActivityItem[] {
		if (record.steps && record.steps.length > 0) {
			return record.steps.map((step) => {
				const startedAt = step.startedAt ?? record.startedAt;
				const endedAt = step.endedAt ?? (terminal(step.status) ? record.endedAt : undefined);
				const durationMs =
					step.durationMs ?? (endedAt === undefined ? undefined : Math.max(0, endedAt - startedAt));
				const agent = step.agent ?? record.agents[step.index] ?? record.agent;
				return {
					id: `${record.id}:${step.index}`,
					source: record.source,
					status: step.status,
					...(agent ? { agent } : {}),
					agents: agent ? [agent] : record.agents,
					...((step.label ?? record.label) ? { label: step.label ?? record.label } : {}),
					startedAt,
					...(endedAt !== undefined ? { endedAt } : {}),
					...(durationMs !== undefined ? { durationMs } : {}),
					...((step.currentTool ?? record.currentTool)
						? { currentTool: step.currentTool ?? record.currentTool }
						: {}),
					...((step.currentToolStartedAt ?? record.currentToolStartedAt)
						? { currentToolStartedAt: step.currentToolStartedAt ?? record.currentToolStartedAt }
						: {}),
					...((step.turnCount ?? record.turnCount) ? { turnCount: step.turnCount ?? record.turnCount } : {}),
					...((step.toolCount ?? record.toolCount) ? { toolCount: step.toolCount ?? record.toolCount } : {}),
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
				...(record.currentTool ? { currentTool: record.currentTool } : {}),
				...(record.currentToolStartedAt !== undefined
					? { currentToolStartedAt: record.currentToolStartedAt }
					: {}),
				...(record.turnCount !== undefined ? { turnCount: record.turnCount } : {}),
				...(record.toolCount !== undefined ? { toolCount: record.toolCount } : {}),
			},
		];
	}
	return {
		handleAsyncStarted(data) {
			if (disposed || !isRecord(data) || !sameSession(data, options.currentSessionId)) return;
			const id = stringValue(data.id);
			if (!id) return;
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
			const endedAt = numberValue(data.timestamp) ?? normalizeNow();
			const existing = records.get(id);
			const status = statusFromSuccess(
				data.success,
				normalizeStatus(data.state, existing?.status ?? "complete"),
			);
			const agents = stringArray(data.agents);
			const agent = firstString(data.agent, agents[0], existing?.agent);
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
				endedAt,
				durationMs: Math.max(0, endedAt - (existing?.startedAt ?? endedAt)),
				updatedAt: endedAt,
				...(existing?.steps
					? {
							steps: existing.steps.map((step) => (terminal(step.status) ? step : { ...step, status })),
						}
					: {}),
			};
			records.set(id, next);
			changed();
		},
		handleForegroundComplete(data) {
			if (disposed || !isRecord(data) || !sameSession(data, options.currentSessionId)) return;
			const eventId = firstString(data.id, data.runId);
			const endedAt = numberValue(data.timestamp) ?? normalizeNow();
			const match = eventId ? records.get(eventId) : undefined;
			const fallback =
				match ??
				[...records.values()]
					.filter(
						(record) =>
							record.source === "foreground" &&
							record.foregroundFallback &&
							endedAt - record.updatedAt <= FOREGROUND_COMPLETE_MATCH_WINDOW_MS,
					)
					.sort((left, right) => right.updatedAt - left.updatedAt)[0];
			const id = fallback?.id ?? eventId;
			if (!id) return;
			const status = statusFromSuccess(
				data.success,
				normalizeStatus(data.state, fallback?.status ?? "complete"),
			);
			const agent = firstString(data.agent, fallback?.agent);
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
				endedAt,
				durationMs: Math.max(0, endedAt - (fallback?.startedAt ?? endedAt)),
				updatedAt: endedAt,
				...(fallback?.foregroundFallback === undefined
					? {}
					: { foregroundFallback: fallback.foregroundFallback }),
			};
			records.set(id, next);
			changed();
		},
		startForegroundTool(event, eventNow) {
			if (disposed || event.toolName !== "subagent") return;
			const startedAt = normalizeNow(eventNow);
			const label = labelFromArgs(event.args);
			records.set(`foreground:${sanitizeText(event.toolCallId)}`, {
				id: `foreground:${sanitizeText(event.toolCallId)}`,
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
		finishForegroundTool(event, eventNow) {
			if (disposed || event.toolName !== "subagent") return;
			const id = `foreground:${sanitizeText(event.toolCallId)}`;
			const record = records.get(id);
			if (!record) return;
			const endedAt = normalizeNow(eventNow);
			record.status = event.isError ? "failed" : "complete";
			record.endedAt = endedAt;
			record.durationMs = Math.max(0, endedAt - record.startedAt);
			record.updatedAt = endedAt;
			changed();
		},
		hasActive() {
			return !disposed && [...records.values()].some((record) => !terminal(record.status));
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
