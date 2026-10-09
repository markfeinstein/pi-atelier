import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
	ContributedSidebarPanelId,
	SidebarPanelId,
	SidebarPanelLayout,
	SidebarPanelLayoutEntry,
} from "./types.js";

/** The event channel used by the public sidebar contribution protocol. */
export const SIDEBAR_PANEL_EVENT_CHANNEL = "pi-atelier:sidebar-panels" as const;
export const SIDEBAR_PANEL_PROTOCOL_VERSION = 1 as const;

/** Maximum visible characters retained for a contributed panel title. */
export const SIDEBAR_PANEL_MAX_TITLE_CHARS = 48;
/** Maximum structured rows retained for one contributed panel. */
export const SIDEBAR_PANEL_MAX_ROWS = 24;
/** Maximum visible characters retained for one contributed row. */
export const SIDEBAR_PANEL_MAX_ROW_CHARS = 160;
/**
 * Maximum raw UTF-16 code units inspected for a contributed panel title.
 *
 * Raw input is bounded before ANSI/control sanitization and Unicode iteration;
 * the allowance above the visible limit covers modest formatting overhead.
 */
export const SIDEBAR_PANEL_MAX_RAW_TITLE_CODE_UNITS = SIDEBAR_PANEL_MAX_TITLE_CHARS * 8;
/** Maximum raw UTF-16 code units inspected for a contributed row string or row.text. */
export const SIDEBAR_PANEL_MAX_RAW_ROW_CODE_UNITS = SIDEBAR_PANEL_MAX_ROW_CHARS * 8;
/** Maximum characters accepted for a namespaced contributed panel ID. */
export const SIDEBAR_PANEL_MAX_ID_CHARS = 128;
/** Maximum raw UTF-16 code units accepted for a discovery correlation token. */
export const SIDEBAR_PANEL_MAX_RAW_REQUEST_ID_CODE_UNITS = 256;
/** Maximum characters accepted for a contributed panel source name. */
export const SIDEBAR_PANEL_MAX_SOURCE_CHARS = 128;
/** Maximum contributed panels retained by one registry. */
export const SIDEBAR_PANEL_MAX_PANELS = 64;
/** Maximum distinct event sources tracked by one registry. */
export const SIDEBAR_PANEL_MAX_TRACKED_SOURCES = SIDEBAR_PANEL_MAX_PANELS;
/** Maximum nodes retained in one rich representation. */
export const SIDEBAR_PANEL_MAX_RICH_NODES = 48;
/** Maximum spans retained in one spans node. */
export const SIDEBAR_PANEL_MAX_RICH_SPANS = 16;
/** Maximum segments retained in one bar node. */
export const SIDEBAR_PANEL_MAX_RICH_SEGMENTS = 16;
/** Shared complexity budget across expanded and compact rich representations. */
export const SIDEBAR_PANEL_MAX_RICH_UNITS = 96;
/** Shared raw UTF-16 input budget across all rich text fields. */
export const SIDEBAR_PANEL_MAX_RICH_RAW_CODE_UNITS = 8192;
/** Shared sanitized Unicode output budget across all rich text fields. */
export const SIDEBAR_PANEL_MAX_RICH_VISIBLE_CHARS = 4096;
/** Maximum visible characters retained for an unavailable reason. */
export const SIDEBAR_PANEL_MAX_REASON_CHARS = 160;

/** Built-in panels remain available even when their optional content is empty. */
export const BUILTIN_SIDEBAR_PANEL_IDS = [
	"workspace",
	"agent",
	"activity",
	"subagents",
	"alerts",
	"todos",
	"usage",
	"prefill",
	"tools",
	"mcp",
] as const;

const RETIRED_BUILTIN_SIDEBAR_PANEL_IDS = ["context"] as const;

export const DEFAULT_SIDEBAR_PANEL_LAYOUT: SidebarPanelLayout = BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({
	id,
	visible: true,
}));

const BUILTIN_IDS = new Set<string>(BUILTIN_SIDEBAR_PANEL_IDS);
const RETIRED_BUILTIN_IDS = new Set<string>(RETIRED_BUILTIN_SIDEBAR_PANEL_IDS);
// Use a strict end-of-input assertion; JavaScript's `$` also matches before a final line terminator.
const NAMESPACED_ID = /^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*(?![\s\S])/;
const PANEL_ROLE_VALUES = [
	"primary",
	"accent",
	"muted",
	"dim",
	"ready",
	"working",
	"warning",
	"error",
	"input",
	"output",
	"cache",
	"context",
] as const;
const SIDEBAR_PANEL_MAX_ROLE_CHARS = Math.max(...PANEL_ROLE_VALUES.map((role) => role.length));
const PANEL_ROLES = new Set<string>(PANEL_ROLE_VALUES);

export type SidebarPanelRole = (typeof PANEL_ROLE_VALUES)[number];

export interface SidebarPanelRow {
	text: string;
	role?: SidebarPanelRole;
}

export interface SidebarTextNode {
	kind: "text";
	text: string;
	role?: SidebarPanelRole;
}
export interface SidebarSpansNode {
	kind: "spans";
	spans: readonly SidebarSpan[];
}
export interface SidebarSpan {
	text: string;
	role?: SidebarPanelRole;
	color?: `#${string}`;
}
export interface SidebarKeyValueNode {
	kind: "keyValue";
	label: string;
	value: string;
	labelRole?: SidebarPanelRole;
	valueRole?: SidebarPanelRole;
	valueColor?: `#${string}`;
}
export interface SidebarHeadingNode {
	kind: "heading";
	text: string;
	role?: SidebarPanelRole;
}
export interface SidebarBarNode {
	kind: "bar";
	segments: readonly SidebarBarSegment[];
	label?: string;
}
export interface SidebarBarSegment {
	key: string;
	value: number;
	role?: SidebarPanelRole;
	color?: `#${string}`;
	label?: string;
}
export interface SidebarProgressNode {
	kind: "progress";
	label: string;
	current: number;
	total?: number;
	role?: SidebarPanelRole;
	detail?: string;
}
export interface SidebarSpacerNode {
	kind: "spacer";
}

/** Flat, bounded presentation primitives. They cannot nest or invoke callbacks. */
export type SidebarPanelNode =
	| SidebarTextNode
	| SidebarSpansNode
	| SidebarKeyValueNode
	| SidebarHeadingNode
	| SidebarBarNode
	| SidebarProgressNode
	| SidebarSpacerNode;

/** Optional additive rich representation; protocol-v1 rows remain mandatory fallback. */
export interface SidebarPanelRichContent {
	version: 1;
	expanded: SidebarPanelNode[];
	compact?: SidebarPanelNode[];
	collapsible?: boolean;
}

/** Structured, presentation-only data accepted from another extension. */
export interface SidebarPanelAvailability {
	available: boolean;
	reason?: string;
}

export interface SidebarPanelContribution {
	id: ContributedSidebarPanelId;
	title: string;
	rows: readonly (string | SidebarPanelRow)[];
	role?: SidebarPanelRole;
	rich?: SidebarPanelRichContent;
	availability?: SidebarPanelAvailability;
}

interface SanitizedSidebarPanelContribution {
	id: ContributedSidebarPanelId;
	title: string;
	rows: SidebarPanelRow[];
	role?: SidebarPanelRole;
	rich?: SidebarPanelRichContent;
	availability: SidebarPanelAvailability;
}

export interface SidebarPanelDescriptor extends Omit<SidebarPanelContribution, "rows" | "availability"> {
	rows: readonly SidebarPanelRow[];
	available: boolean;
	reason?: string;
	source: string;
}

export interface SidebarPanelData extends SidebarPanelDescriptor {
	available: true;
}

export type { SidebarPanelLayout, SidebarPanelLayoutEntry };

export interface SidebarPanelRegisterEvent {
	version: typeof SIDEBAR_PANEL_PROTOCOL_VERSION;
	type: "register";
	source: string;
	revision: number;
	panel: SidebarPanelContribution;
	/** Optional correlation token used by load-order discovery. */
	requestId?: string;
}

export interface SidebarPanelUnregisterEvent {
	version: typeof SIDEBAR_PANEL_PROTOCOL_VERSION;
	type: "unregister";
	source: string;
	revision: number;
	id: ContributedSidebarPanelId;
}

export interface SidebarPanelDiscoveryEvent {
	version: typeof SIDEBAR_PANEL_PROTOCOL_VERSION;
	type: "discover";
	requestId: string;
}

export type SidebarPanelEvent =
	| SidebarPanelRegisterEvent
	| SidebarPanelUnregisterEvent
	| SidebarPanelDiscoveryEvent;

export interface SidebarPanelEventTransport {
	on(channel: string, handler: (data: unknown) => void): () => void;
	emit(channel: string, data: unknown): void;
}

export interface SidebarPanelRegistry {
	register(panel: SidebarPanelContribution, source?: string): boolean;
	unregister(id: ContributedSidebarPanelId, source?: string): boolean;
	getAvailable(): readonly SidebarPanelData[];
	/** All currently registered descriptors, including producer-declared unavailable panels. */
	getAll(): readonly SidebarPanelDescriptor[];
	get(id: string): SidebarPanelData | undefined;
	/** Handle a public event directly; useful for runtime and public-seam tests. */
	handleEvent(data: unknown): void;
	requestDiscovery(): void;
	dispose(): void;
}

export interface SidebarPanelRegistryOptions {
	events?: SidebarPanelEventTransport;
	onChange?: () => void;
	/**
	 * Prefix used only in discovery request IDs; it does not identify this
	 * registry or filter contributor event sources.
	 */
	instanceId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSidebarPanelContributionId(value: unknown): value is ContributedSidebarPanelId {
	return typeof value === "string" && value.length <= SIDEBAR_PANEL_MAX_ID_CHARS && NAMESPACED_ID.test(value);
}

export function isSidebarPanelId(value: unknown): value is SidebarPanelId {
	return typeof value === "string" && (BUILTIN_IDS.has(value) || isSidebarPanelContributionId(value));
}

/** Validate the source name retained with a contributed panel and its events. */
export function isSidebarPanelSource(value: unknown): value is string {
	return typeof value === "string" && value.length <= SIDEBAR_PANEL_MAX_SOURCE_CHARS && value.trim() !== "";
}

/** Validate a discovery correlation token before it is echoed across the event bus. */
export function isSidebarPanelRequestId(value: unknown): value is string {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > SIDEBAR_PANEL_MAX_RAW_REQUEST_ID_CODE_UNITS ||
		value.trim() === ""
	)
		return false;
	for (let index = 0; index < value.length; index += 1) {
		const codeUnit = value.charCodeAt(index);
		if (codeUnit < 0x20 || (codeUnit >= 0x7f && codeUnit <= 0x9f)) return false;
		if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return false;
			index += 1;
		} else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
			return false;
		}
	}
	return true;
}

function isSafeRevision(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value);
}

export function isSidebarPanelRole(value: unknown): value is SidebarPanelRole {
	return typeof value === "string" && value.length <= SIDEBAR_PANEL_MAX_ROLE_CHARS && PANEL_ROLES.has(value);
}

/**
 * Normalizes persisted layout while retaining valid namespaced IDs that are not
 * currently available. Built-ins omitted by an older config are appended in
 * product order; newly discovered contributed panels are intentionally not
 * appended here and therefore remain hidden until explicitly enabled.
 */
export function normalizeSidebarPanelLayout(
	entries: readonly SidebarPanelLayoutEntry[],
	warnings: string[] = [],
): SidebarPanelLayout {
	const normalized: SidebarPanelLayout = [];
	const seen = new Set<string>();
	let retiredContextVisible = false;
	for (const entry of entries) {
		const entryId = String(entry?.id);
		if (entry && RETIRED_BUILTIN_IDS.has(entryId)) {
			retiredContextVisible ||= entryId === "context" && entry.visible === true;
			continue;
		}
		if (!entry || !isSidebarPanelId(entry.id)) {
			warnings.push(`Unknown sidebar panel: ${String(entry?.id)}`);
			continue;
		}
		if (seen.has(entry.id)) {
			warnings.push(`Ignoring duplicate sidebar panel: ${entry.id}`);
			continue;
		}
		seen.add(entry.id);
		normalized.push({ id: entry.id, visible: entry.visible === true });
	}
	for (const id of BUILTIN_SIDEBAR_PANEL_IDS) {
		if (!seen.has(id)) normalized.push({ id, visible: true });
	}
	if (retiredContextVisible) {
		const usage = normalized.find((entry) => entry.id === "usage");
		if (usage) usage.visible = true;
	}
	if (!normalized.some((entry) => entry.visible)) {
		warnings.push("sidebarPanelLayout must include at least one visible panel; restoring agent");
		const first = normalized.find((entry) => entry.id === "agent");
		if (first) first.visible = true;
	}
	return normalized;
}

const ANSI_ESCAPE =
	/(?:\u001b\][^\u0007]*(?:\u0007|\u001b\\)|\u001b\[[0-?]*[ -/]*[@-~]|\u009b[0-?]*[ -/]*[@-~])/g;

/** Cheap precondition used before any regex sanitization or Unicode iteration. */
export function isSidebarPanelTextWithinRawLimit(value: unknown, maxCodeUnits: number): value is string {
	return typeof value === "string" && value.length <= maxCodeUnits;
}

function rawCodeUnitLimitFor(maxChars: number): number {
	return maxChars <= SIDEBAR_PANEL_MAX_TITLE_CHARS
		? SIDEBAR_PANEL_MAX_RAW_TITLE_CODE_UNITS
		: SIDEBAR_PANEL_MAX_RAW_ROW_CODE_UNITS;
}

function boundedRawText(value: string, maxChars: number): string {
	const limit = rawCodeUnitLimitFor(maxChars);
	if (value.length <= limit) return value;
	const bounded = value.slice(0, limit);
	return /[\ud800-\udbff]$/.test(bounded) ? bounded.slice(0, -1) : bounded;
}

function cleanSidebarPanelText(value: string, trim = true): string {
	const cleaned = value
		.replace(ANSI_ESCAPE, "")
		.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
		.replace(/\s+/g, " ");
	return trim ? cleaned.trim() : cleaned;
}

/** Defensively sanitize text before any Settings or Sidebar interpolation. */
export function sanitizeSidebarPanelText(value: string, maxChars = SIDEBAR_PANEL_MAX_ROW_CHARS): string {
	return Array.from(cleanSidebarPanelText(boundedRawText(value, maxChars)))
		.slice(0, maxChars)
		.join("");
}

const SIDEBAR_PANEL_RICH_COLOR = /^#[0-9a-fA-F]{6}$/;

interface RichBudget {
	units: number;
	rawCodeUnits: number;
	visibleChars: number;
}

function consumeRichUnit(budget: RichBudget, count = 1): boolean {
	budget.units += count;
	return budget.units <= SIDEBAR_PANEL_MAX_RICH_UNITS;
}

function sanitizeRichText(value: unknown, budget: RichBudget, trim = true): string | undefined {
	if (typeof value !== "string" || value.length > SIDEBAR_PANEL_MAX_RAW_ROW_CODE_UNITS) return undefined;
	budget.rawCodeUnits += value.length;
	if (budget.rawCodeUnits > SIDEBAR_PANEL_MAX_RICH_RAW_CODE_UNITS) return undefined;
	const cleaned = cleanSidebarPanelText(value, trim);
	const visible = Array.from(cleaned).length;
	budget.visibleChars += visible;
	if (visible > SIDEBAR_PANEL_MAX_ROW_CHARS || budget.visibleChars > SIDEBAR_PANEL_MAX_RICH_VISIBLE_CHARS)
		return undefined;
	return cleaned;
}

function sanitizeRichColor(value: unknown): `#${string}` | undefined {
	return typeof value === "string" && value.length === 7 && SIDEBAR_PANEL_RICH_COLOR.test(value)
		? (value as `#${string}`)
		: undefined;
}

function strictRole(value: unknown): SidebarPanelRole | undefined | false {
	return value === undefined ? undefined : isSidebarPanelRole(value) ? value : false;
}

function sanitizeRichNode(value: unknown, budget: RichBudget): SidebarPanelNode | undefined {
	if (!isRecord(value) || !consumeRichUnit(budget)) return undefined;
	const role = strictRole(value.role);
	if (role === false) return undefined;
	switch (value.kind) {
		case "text":
		case "heading": {
			const text = sanitizeRichText(value.text, budget);
			return text === undefined ? undefined : { kind: value.kind, text, ...(role ? { role } : {}) };
		}
		case "spans": {
			if (!Array.isArray(value.spans) || value.spans.length > SIDEBAR_PANEL_MAX_RICH_SPANS) return undefined;
			const spans: SidebarSpan[] = [];
			for (const raw of value.spans) {
				if (!isRecord(raw) || !consumeRichUnit(budget)) return undefined;
				const text = sanitizeRichText(raw.text, budget, false);
				const spanRole = strictRole(raw.role);
				const color = raw.color === undefined ? undefined : sanitizeRichColor(raw.color);
				if (text === undefined || spanRole === false || (raw.color !== undefined && color === undefined))
					return undefined;
				spans.push({ text, ...(spanRole ? { role: spanRole } : {}), ...(color ? { color } : {}) });
			}
			return { kind: "spans", spans };
		}
		case "keyValue": {
			const labelRole = strictRole(value.labelRole);
			const valueRole = strictRole(value.valueRole);
			const label = sanitizeRichText(value.label, budget);
			const rawValue = sanitizeRichText(value.value, budget);
			const valueColor = value.valueColor === undefined ? undefined : sanitizeRichColor(value.valueColor);
			if (
				label === undefined ||
				rawValue === undefined ||
				labelRole === false ||
				valueRole === false ||
				(value.valueColor !== undefined && !valueColor)
			)
				return undefined;
			return {
				kind: "keyValue",
				label,
				value: rawValue,
				...(labelRole ? { labelRole } : {}),
				...(valueRole ? { valueRole } : {}),
				...(valueColor ? { valueColor } : {}),
			};
		}
		case "bar": {
			if (
				!Array.isArray(value.segments) ||
				value.segments.length === 0 ||
				value.segments.length > SIDEBAR_PANEL_MAX_RICH_SEGMENTS
			)
				return undefined;
			const segments: SidebarBarSegment[] = [];
			for (const raw of value.segments) {
				if (!isRecord(raw) || !consumeRichUnit(budget)) return undefined;
				const segmentRole = strictRole(raw.role);
				const key = sanitizeRichText(raw.key, budget);
				const color = raw.color === undefined ? undefined : sanitizeRichColor(raw.color);
				const label = raw.label === undefined ? undefined : sanitizeRichText(raw.label, budget);
				if (
					key === undefined ||
					segmentRole === false ||
					typeof raw.value !== "number" ||
					!Number.isFinite(raw.value) ||
					raw.value < 0 ||
					(raw.color !== undefined && !color) ||
					(raw.label !== undefined && label === undefined)
				)
					return undefined;
				segments.push({
					key,
					value: raw.value,
					...(segmentRole ? { role: segmentRole } : {}),
					...(color ? { color } : {}),
					...(label ? { label } : {}),
				});
			}
			const label = value.label === undefined ? undefined : sanitizeRichText(value.label, budget);
			if (value.label !== undefined && label === undefined) return undefined;
			return { kind: "bar", segments, ...(label ? { label } : {}) };
		}
		case "progress": {
			const label = sanitizeRichText(value.label, budget);
			const detail = value.detail === undefined ? undefined : sanitizeRichText(value.detail, budget);
			if (
				label === undefined ||
				typeof value.current !== "number" ||
				!Number.isFinite(value.current) ||
				value.current < 0 ||
				(value.total !== undefined &&
					(typeof value.total !== "number" || !Number.isFinite(value.total) || value.total < 0)) ||
				(value.detail !== undefined && detail === undefined)
			)
				return undefined;
			return {
				kind: "progress",
				label,
				current: value.current,
				...(value.total !== undefined ? { total: value.total } : {}),
				...(role ? { role } : {}),
				...(detail ? { detail } : {}),
			};
		}
		case "spacer":
			return { kind: "spacer" };
		default:
			return undefined;
	}
}

function sanitizeRichNodes(value: unknown, budget: RichBudget): SidebarPanelNode[] | undefined {
	if (!Array.isArray(value) || value.length === 0 || value.length > SIDEBAR_PANEL_MAX_RICH_NODES)
		return undefined;
	const nodes: SidebarPanelNode[] = [];
	for (const raw of value) {
		const node = sanitizeRichNode(raw, budget);
		if (!node) return undefined;
		nodes.push(node);
	}
	return nodes;
}

/** Validate optional rich content while retaining mandatory legacy-row fallback on failure. */
export function sanitizeSidebarPanelRich(value: unknown): SidebarPanelRichContent | undefined {
	if (!isRecord(value) || value.version !== 1) return undefined;
	const budget: RichBudget = { units: 0, rawCodeUnits: 0, visibleChars: 0 };
	const expanded = sanitizeRichNodes(value.expanded, budget);
	if (!expanded) return undefined;
	const compact = value.compact === undefined ? undefined : sanitizeRichNodes(value.compact, budget);
	if (value.compact !== undefined && !compact) return undefined;
	if (value.collapsible !== undefined && typeof value.collapsible !== "boolean") return undefined;
	if (compact && JSON.stringify(compact) === JSON.stringify(expanded)) return undefined;
	if (value.collapsible !== undefined && !compact) return undefined;
	return {
		version: 1,
		expanded,
		...(compact ? { compact } : {}),
		...(typeof value.collapsible === "boolean" ? { collapsible: value.collapsible } : {}),
	};
}

function sanitizeAvailability(value: unknown): SidebarPanelAvailability | undefined {
	if (value === undefined) return { available: true };
	if (!isRecord(value) || typeof value.available !== "boolean") return undefined;
	if (value.reason !== undefined && typeof value.reason !== "string") return undefined;
	const reason =
		value.reason === undefined
			? undefined
			: sanitizeSidebarPanelText(value.reason, SIDEBAR_PANEL_MAX_REASON_CHARS);
	if (value.reason !== undefined && (!reason || Array.from(reason).length > SIDEBAR_PANEL_MAX_REASON_CHARS))
		return undefined;
	return { available: value.available, ...(reason ? { reason } : {}) };
}

function sanitizeContribution(value: unknown): SanitizedSidebarPanelContribution | undefined {
	if (
		!isRecord(value) ||
		!isSidebarPanelContributionId(value.id) ||
		typeof value.title !== "string" ||
		!isSidebarPanelTextWithinRawLimit(value.title, SIDEBAR_PANEL_MAX_RAW_TITLE_CODE_UNITS) ||
		!Array.isArray(value.rows) ||
		value.rows.length > SIDEBAR_PANEL_MAX_ROWS
	)
		return undefined;
	const title = cleanSidebarPanelText(value.title);
	if (Array.from(title).length > SIDEBAR_PANEL_MAX_TITLE_CHARS) return undefined;
	const rows: SidebarPanelRow[] = [];
	for (const row of value.rows) {
		const text =
			typeof row === "string" ? row : isRecord(row) && typeof row.text === "string" ? row.text : undefined;
		if (text === undefined || !isSidebarPanelTextWithinRawLimit(text, SIDEBAR_PANEL_MAX_RAW_ROW_CODE_UNITS))
			return undefined;
		const cleaned = cleanSidebarPanelText(text);
		if (Array.from(cleaned).length > SIDEBAR_PANEL_MAX_ROW_CHARS) return undefined;
		rows.push({
			text: cleaned,
			...(isRecord(row) && isSidebarPanelRole(row.role) ? { role: row.role } : {}),
		});
	}
	const rich = sanitizeSidebarPanelRich(value.rich);
	const availability = sanitizeAvailability(value.availability);
	if (!availability) return undefined;
	return {
		id: value.id,
		title,
		rows,
		...(isSidebarPanelRole(value.role) ? { role: value.role } : {}),
		...(rich ? { rich } : {}),
		availability,
	};
}

function sourceFor(id: string): string {
	return id.includes(":") ? id.slice(0, id.indexOf(":")) : "pi-atelier";
}

function isEvent(value: unknown): value is Record<string, unknown> {
	return (
		isRecord(value) && value.version === SIDEBAR_PANEL_PROTOCOL_VERSION && typeof value.type === "string"
	);
}

// Revision numbers are part of the event protocol's per-source ordering, not
// of an individual publisher. Keep the allocator scoped to each transport so
// separate Pi runtimes (and test buses) cannot affect one another, while the
// weak key avoids retaining an event bus after its runtime is gone.
//
// Source entries are bounded tombstones: disposed publishers keep their last
// revision so a later publisher reusing that source cannot reset to one and
// resurrect stale events. A new source beyond the cap becomes an inert
// publisher because this API cannot report allocation failure to its caller.
const sidebarPanelRevisionAllocators = new WeakMap<object, Map<string, number>>();

function nextSidebarPanelRevision(events: SidebarPanelEventTransport, source: string): number | undefined {
	if (!isSidebarPanelSource(source)) return undefined;
	let revisions = sidebarPanelRevisionAllocators.get(events);
	if (!revisions) {
		revisions = new Map<string, number>();
		sidebarPanelRevisionAllocators.set(events, revisions);
	}
	const previous = revisions.get(source);
	if (previous === undefined && revisions.size >= SIDEBAR_PANEL_MAX_TRACKED_SOURCES) return undefined;
	const next = (previous ?? 0) + 1;
	revisions.set(source, next);
	return next;
}

const DISCOVERY_REQUEST_SEPARATOR = "-";
const MAX_SAFE_SEQUENCE_CODE_UNITS = String(Number.MAX_SAFE_INTEGER).length;
const DEFAULT_DISCOVERY_PREFIX = "atelier";

function boundedRawCodeUnits(value: string, maxCodeUnits: number): string {
	const bounded = value.slice(0, maxCodeUnits);
	return /[\ud800-\udbff]$/.test(bounded) ? bounded.slice(0, -1) : bounded;
}

function discoveryPrefix(instanceId: unknown): string {
	const candidate = isSidebarPanelRequestId(instanceId) ? instanceId : DEFAULT_DISCOVERY_PREFIX;
	const maxPrefixCodeUnits =
		SIDEBAR_PANEL_MAX_RAW_REQUEST_ID_CODE_UNITS -
		DISCOVERY_REQUEST_SEPARATOR.length -
		MAX_SAFE_SEQUENCE_CODE_UNITS;
	const bounded = boundedRawCodeUnits(candidate, maxPrefixCodeUnits);
	return isSidebarPanelRequestId(bounded) ? bounded : DEFAULT_DISCOVERY_PREFIX;
}

function sidebarPanelDataEqual(first: SidebarPanelDescriptor, second: SidebarPanelDescriptor): boolean {
	return (
		first.id === second.id &&
		first.title === second.title &&
		first.role === second.role &&
		first.available === second.available &&
		first.reason === second.reason &&
		first.source === second.source &&
		first.rows.length === second.rows.length &&
		first.rows.every(
			(row, index) => row.text === second.rows[index]?.text && row.role === second.rows[index]?.role,
		) &&
		JSON.stringify(first.rich ?? null) === JSON.stringify(second.rich ?? null)
	);
}

function cloneSidebarPanelData(panel: SidebarPanelDescriptor): SidebarPanelDescriptor {
	return {
		...panel,
		rows: panel.rows.map((row) => ({ text: row.text, ...(row.role ? { role: row.role } : {}) })),
		...(panel.rich ? { rich: structuredClone(panel.rich) } : {}),
	};
}

/** Create a lifecycle-safe registry backed only by Pi's public event bus. */
export function createSidebarPanelRegistry(options: SidebarPanelRegistryOptions = {}): SidebarPanelRegistry {
	const panels = new Map<string, SidebarPanelDescriptor>();
	const revisions = new Map<string, number>();
	let disposed = false;
	let requestSequence = 0;
	const requestPrefix = discoveryPrefix(options.instanceId);
	let unsubscribe: (() => void) | undefined;

	const changed = (): void => {
		try {
			options.onChange?.();
		} catch {
			// Rendering invalidation is best effort and must not break event handling.
		}
	};
	const canAcceptRevision = (source: string, revision: number): boolean => {
		const previous = revisions.get(source) ?? 0;
		return Number.isSafeInteger(revision) && revision > previous;
	};
	const trackRevision = (source: string, revision: number): void => {
		revisions.set(source, revision);
	};
	const canTrackSource = (source: string): boolean =>
		revisions.has(source) || revisions.size < SIDEBAR_PANEL_MAX_TRACKED_SOURCES;
	const canRegister = (panel: SidebarPanelContribution, source: string): boolean => {
		const owner = panels.get(panel.id)?.source;
		if (owner !== undefined && owner !== source) return false;
		return panels.has(panel.id) || panels.size < SIDEBAR_PANEL_MAX_PANELS;
	};
	const applyRegister = (safe: SanitizedSidebarPanelContribution, resolvedSource: string): boolean => {
		const { availability, ...content } = safe;
		const next: SidebarPanelDescriptor = {
			...content,
			available: availability.available,
			...(availability.reason ? { reason: availability.reason } : {}),
			source: resolvedSource,
		};
		const previous = panels.get(safe.id);
		if (previous && sidebarPanelDataEqual(previous, next)) return false;
		panels.set(safe.id, next);
		changed();
		return true;
	};
	const register = (panel: SidebarPanelContribution, source?: string): boolean => {
		if (disposed) return false;
		const safe = sanitizeContribution(panel);
		if (!safe) return false;
		const resolvedSource = source ?? sourceFor(safe.id);
		if (!isSidebarPanelSource(resolvedSource) || !canRegister(safe, resolvedSource)) return false;
		return applyRegister(safe, resolvedSource);
	};
	const canUnregister = (id: ContributedSidebarPanelId, source: string): boolean =>
		panels.get(id)?.source === source;
	const applyUnregister = (id: ContributedSidebarPanelId): boolean => {
		const removed = panels.delete(id);
		changed();
		return removed;
	};
	const unregister = (id: ContributedSidebarPanelId, source?: string): boolean => {
		if (disposed || !isSidebarPanelContributionId(id)) return false;
		const resolvedSource = source ?? sourceFor(id);
		if (!isSidebarPanelSource(resolvedSource) || !canUnregister(id, resolvedSource)) return false;
		return applyUnregister(id);
	};
	const handleEvent = (data: unknown): void => {
		if (disposed || !isEvent(data)) return;
		if (data.type === "discover") return;
		if (
			!isSidebarPanelSource(data.source) ||
			!isSafeRevision(data.revision) ||
			(data.type === "register" && data.requestId !== undefined && !isSidebarPanelRequestId(data.requestId))
		)
			return;
		const source = data.source;
		const revision = data.revision;
		let panel: SanitizedSidebarPanelContribution | undefined;
		let id: ContributedSidebarPanelId | undefined;
		if (data.type === "register") {
			panel = sanitizeContribution(data.panel);
			if (!panel) return;
		} else {
			if (data.type !== "unregister" || !isSidebarPanelContributionId(data.id)) return;
			id = data.id;
		}
		if (!canTrackSource(source) || !canAcceptRevision(source, revision)) return;
		if (panel) {
			if (!canRegister(panel, source)) return;
			trackRevision(source, revision);
			applyRegister(panel, source);
		} else if (id !== undefined) {
			if (!canUnregister(id, source)) return;
			trackRevision(source, revision);
			applyUnregister(id);
		}
	};
	if (options.events) {
		unsubscribe = options.events.on(SIDEBAR_PANEL_EVENT_CHANNEL, handleEvent);
	}
	const requestDiscovery = (): void => {
		if (disposed || !options.events) return;
		// Keep the sequence in Number's safe-integer range. A wrapped ID is
		// preferable to emitting an imprecise correlation token after exhaustion.
		requestSequence = requestSequence === Number.MAX_SAFE_INTEGER ? 1 : requestSequence + 1;
		const requestId = `${requestPrefix}${DISCOVERY_REQUEST_SEPARATOR}${requestSequence}`;
		if (!isSidebarPanelRequestId(requestId)) return;
		options.events.emit(SIDEBAR_PANEL_EVENT_CHANNEL, {
			version: SIDEBAR_PANEL_PROTOCOL_VERSION,
			type: "discover",
			requestId,
		});
	};
	requestDiscovery();
	return {
		register,
		unregister,
		handleEvent,
		requestDiscovery,
		getAvailable: () =>
			[...panels.values()]
				.filter((panel): panel is SidebarPanelData => panel.available)
				.map((panel) => cloneSidebarPanelData(panel) as SidebarPanelData),
		getAll: () => [...panels.values()].map(cloneSidebarPanelData),
		get: (id) => {
			const panel = panels.get(id);
			return panel?.available ? (cloneSidebarPanelData(panel) as SidebarPanelData) : undefined;
		},
		dispose: () => {
			if (disposed) return;
			disposed = true;
			const off = unsubscribe;
			unsubscribe = undefined;
			panels.clear();
			revisions.clear();
			off?.();
		},
	};
}

/**
 * Convenience publisher for contributing extensions. It replays registration
 * when Atelier asks for discovery, so loading either extension first works.
 */
export function registerSidebarPanel(
	pi: Pick<ExtensionAPI, "events">,
	panel: SidebarPanelContribution,
	options: { source?: string } = {},
): { update(panel: SidebarPanelContribution): void; dispose(): void } {
	const initial = sanitizeContribution(panel);
	const stableId: ContributedSidebarPanelId | undefined = initial?.id;
	const requestedSource = options.source ?? (stableId ? sourceFor(stableId) : undefined);
	const source =
		stableId && requestedSource !== undefined && isSidebarPanelSource(requestedSource)
			? requestedSource
			: undefined;
	let current = source && stableId && initial ? initial : undefined;
	let disposed = false;
	const emitRegister = (requestId?: string): void => {
		if (disposed || !source || !current || (requestId !== undefined && !isSidebarPanelRequestId(requestId)))
			return;
		const revision = nextSidebarPanelRevision(pi.events, source);
		if (revision === undefined) return;
		pi.events.emit(SIDEBAR_PANEL_EVENT_CHANNEL, {
			version: SIDEBAR_PANEL_PROTOCOL_VERSION,
			type: "register",
			source,
			revision,
			panel: current,
			...(requestId ? { requestId } : {}),
		});
	};
	const unsubscribe = source
		? pi.events.on(SIDEBAR_PANEL_EVENT_CHANNEL, (data) => {
				if (!isEvent(data) || data.type !== "discover" || !isSidebarPanelRequestId(data.requestId)) return;
				emitRegister(data.requestId);
			})
		: () => undefined;
	if (current) emitRegister();
	return {
		update(next) {
			if (disposed || !source || !stableId) return;
			const safe = sanitizeContribution(next);
			// A publisher owns one stable ID for its whole lifetime. Ignore an
			// invalid payload, but preserve the historical behavior of treating
			// an attempted ID change as an update to that stable ID.
			if (!safe) return;
			current = { ...safe, id: stableId };
			emitRegister();
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			let failure: unknown;
			try {
				unsubscribe();
			} catch (error) {
				failure = error;
			}
			if (source && current) {
				try {
					const revision = nextSidebarPanelRevision(pi.events, source);
					if (revision !== undefined)
						pi.events.emit(SIDEBAR_PANEL_EVENT_CHANNEL, {
							version: SIDEBAR_PANEL_PROTOCOL_VERSION,
							type: "unregister",
							source,
							revision,
							id: current.id,
						});
				} catch (error) {
					failure ??= error;
				}
			}
			current = undefined;
			if (failure) throw failure;
		},
	};
}
