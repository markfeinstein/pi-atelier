/** Live local-model prefill progress read from raw provider stream events. */

export interface PrefillSnapshot {
	/** Share of uncached prompt tokens processed, from 0 through 1. */
	percent: number;
	processed: number;
	total: number;
	uncachedTotal: number;
	uncachedProcessed: number;
	ratePerSec: number | null;
	etaSec: number | null;
}

export type PrefillView = "percent" | "tokens" | "eta";
export const SIDEBAR_PREFILL_VIEWS: readonly PrefillView[] = ["percent", "tokens", "eta"];
export const OPENAI_COMPLETIONS_API = "openai-completions";
export const SIGNIFICANT_TOKENS = 1_024;
export const SIGNIFICANT_MS = 300;
export const RENDER_THROTTLE_MS = 120;

export interface PrefillModel {
	api?: string;
	provider?: string;
}

export interface PrefillStreamSource {
	api?: string;
	provider?: string;
}

export interface PrefillTracker {
	noteRequest(model: PrefillModel | undefined, payload: unknown): boolean;
	noteResponseFailure(status: number): boolean;
	noteChunk(data: unknown, source: PrefillStreamSource): PrefillSnapshot | undefined;
	clear(): void;
	getSnapshot(): PrefillSnapshot | undefined;
}

export interface PrefillTrackerOptions {
	providers: readonly string[];
	now?: () => number;
}

export interface PrefillRow {
	label: string;
	value: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const formatTokens = (value: number): string =>
	value >= 1_000 ? `${(value / 1_000).toFixed(1)}k` : String(Math.max(0, Math.trunc(value)));

export function formatPrefillRows(snapshot: PrefillSnapshot, views: readonly PrefillView[]): PrefillRow[] {
	const rows: PrefillRow[] = [];
	for (const view of views) {
		if (view === "tokens") {
			rows.push({
				label: "Tokens",
				value: `${formatTokens(snapshot.uncachedProcessed)} / ${formatTokens(snapshot.uncachedTotal)}`,
			});
		} else if (view === "eta" && snapshot.etaSec !== null) {
			rows.push({ label: "First token", value: `~${Math.max(1, Math.round(snapshot.etaSec))}s` });
		}
	}
	return rows;
}

interface PromptProgress {
	total?: number;
	cache?: number;
	processed?: number;
	time_ms?: number;
}

function isGenerationStart(data: unknown): boolean {
	const choice = (data as { choices?: { delta?: unknown; finish_reason?: unknown }[] } | undefined)
		?.choices?.[0];
	if (!choice) return false;
	if (choice.finish_reason != null) return true;
	const delta = choice.delta as
		| { content?: unknown; tool_calls?: unknown; reasoning_content?: unknown; reasoning?: unknown }
		| undefined;
	if (!delta) return false;
	return (
		(typeof delta.content === "string" && delta.content.length > 0) ||
		Array.isArray(delta.content) ||
		Array.isArray(delta.tool_calls) ||
		(typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) ||
		(typeof delta.reasoning === "string" && delta.reasoning.length > 0)
	);
}

function readProgress(data: unknown): PromptProgress | undefined {
	const progress = (data as { prompt_progress?: PromptProgress } | undefined)?.prompt_progress;
	return progress && typeof progress.total === "number" ? progress : undefined;
}

export function createPrefillTracker(options: PrefillTrackerOptions): PrefillTracker {
	const now = options.now ?? Date.now;
	const providers = new Set(
		options.providers.map((provider) => provider.trim().toLowerCase()).filter(Boolean),
	);
	const rejectedProviders = new Set<string>();
	let requestedProvider: string | undefined;
	let snapshot: PrefillSnapshot | undefined;
	let previousProcessed = 0;
	let previousTimeMs = 0;
	let firstSeenAt = 0;
	let assessed = false;
	let tracking = false;

	const resetProgress = (): void => {
		snapshot = undefined;
		previousProcessed = 0;
		previousTimeMs = 0;
		firstSeenAt = 0;
		assessed = false;
		tracking = false;
	};
	const clear = (): void => {
		resetProgress();
		requestedProvider = undefined;
	};

	return {
		noteRequest(model, payload): boolean {
			clear();
			if (model?.api !== OPENAI_COMPLETIONS_API || typeof model.provider !== "string") return false;
			const provider = model.provider.trim().toLowerCase();
			if (!providers.has(provider) || rejectedProviders.has(provider) || !isRecord(payload)) return false;
			if (payload.stream !== true) return false;
			requestedProvider = provider;
			return true;
		},
		noteResponseFailure(status): boolean {
			if (requestedProvider === undefined || (status !== 400 && status !== 422)) return false;
			if (rejectedProviders.has(requestedProvider)) return false;
			rejectedProviders.add(requestedProvider);
			clear();
			return true;
		},
		noteChunk(data, source): PrefillSnapshot | undefined {
			if (requestedProvider === undefined) return undefined;
			if (
				source.api !== OPENAI_COMPLETIONS_API ||
				source.provider?.trim().toLowerCase() !== requestedProvider
			)
				return undefined;
			if (isGenerationStart(data)) {
				clear();
				return undefined;
			}
			const progress = readProgress(data);
			if (!progress) return undefined;

			const total = Math.max(0, progress.total ?? 0);
			const cache = Math.min(total, Math.max(0, progress.cache ?? 0));
			const processed = Math.min(total, Math.max(0, progress.processed ?? 0));
			const timeMs = Math.max(0, progress.time_ms ?? 0);
			const uncachedTotal = Math.max(0, total - cache);
			const uncachedProcessed = Math.min(uncachedTotal, Math.max(0, processed - cache));
			if (!assessed) {
				assessed = true;
				firstSeenAt = now();
				tracking = uncachedTotal > SIGNIFICANT_TOKENS;
			} else if (!tracking && now() - firstSeenAt >= SIGNIFICANT_MS) {
				tracking = true;
			}
			if (!tracking) return undefined;

			const deltaProcessed = processed - previousProcessed;
			const deltaMs = timeMs - previousTimeMs;
			const ratePerSec = deltaProcessed > 0 && deltaMs > 0 ? deltaProcessed / (deltaMs / 1_000) : null;
			const remaining = Math.max(0, total - processed);
			snapshot = {
				percent: uncachedTotal > 0 ? uncachedProcessed / uncachedTotal : 1,
				processed,
				total,
				uncachedTotal,
				uncachedProcessed,
				ratePerSec,
				etaSec: ratePerSec !== null && ratePerSec > 0 && remaining > 0 ? remaining / ratePerSec : null,
			};
			previousProcessed = processed;
			previousTimeMs = timeMs;
			return snapshot;
		},
		clear,
		getSnapshot: () => snapshot,
	};
}

export interface PrefillThrottle {
	note(): void;
	cancel(): void;
}

export interface PrefillThrottleOptions {
	requestRender(): void;
	schedule(delayMs: number, run: () => void): () => void;
	now?: () => number;
	minIntervalMs?: number;
}

export function createPrefillThrottle(options: PrefillThrottleOptions): PrefillThrottle {
	const now = options.now ?? Date.now;
	const minIntervalMs = options.minIntervalMs ?? RENDER_THROTTLE_MS;
	let lastRenderAt = Number.NEGATIVE_INFINITY;
	let cancelPending: (() => void) | undefined;
	return {
		note(): void {
			if (cancelPending) return;
			const elapsed = now() - lastRenderAt;
			if (elapsed >= minIntervalMs) {
				lastRenderAt = now();
				options.requestRender();
				return;
			}
			cancelPending = options.schedule(minIntervalMs - elapsed, () => {
				cancelPending = undefined;
				lastRenderAt = now();
				options.requestRender();
			});
		},
		cancel(): void {
			cancelPending?.();
			cancelPending = undefined;
		},
	};
}
