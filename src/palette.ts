import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import type { AtelierColorScheme, ColorSchemeBase, PaletteColorSpec } from "./types.js";

export const PALETTE_ROLES = [
	"accent",
	"primary",
	"muted",
	"dim",
	"ready",
	"working",
	"input",
	"output",
	"cache",
	"cost",
	"context",
	"menu",
	"warning",
	"error",
	"chartPink",
	"chartGreen",
] as const;

export type PaletteRole = (typeof PALETTE_ROLES)[number];

interface PaletteTheme {
	readonly name?: string;
	fg(color: ThemeColor, text: string): string;
}

type Rgb = readonly [number, number, number];

const FIXED_DARK: Record<PaletteRole, Rgb> = {
	accent: [177, 140, 255],
	primary: [212, 212, 212],
	muted: [128, 128, 128],
	dim: [102, 102, 102],
	ready: [110, 168, 254],
	working: [255, 159, 67],
	input: [110, 168, 254],
	output: [177, 140, 255],
	cache: [125, 211, 252],
	cost: [255, 159, 67],
	context: [110, 168, 254],
	menu: [177, 140, 255],
	warning: [255, 159, 67],
	error: [255, 93, 115],
	chartPink: [244, 114, 182],
	chartGreen: [74, 222, 128],
};

const THEME_TOKENS: Record<PaletteRole, ThemeColor> = {
	accent: "accent",
	primary: "text",
	muted: "muted",
	dim: "dim",
	ready: "thinkingLow",
	working: "warning",
	input: "thinkingLow",
	output: "thinkingHigh",
	cache: "syntaxType",
	cost: "mdHeading",
	context: "thinkingLow",
	menu: "accent",
	warning: "warning",
	error: "error",
	chartPink: "syntaxString",
	chartGreen: "success",
};

const LEGACY_UNNAMED_THEME: Record<PaletteRole, ThemeColor> = {
	...THEME_TOKENS,
	working: "mdHeading",
	menu: "thinkingHigh",
};

export const PI_THEME_COLOR_TOKENS = [
	"accent",
	"border",
	"borderAccent",
	"borderMuted",
	"success",
	"error",
	"warning",
	"muted",
	"dim",
	"text",
	"thinkingText",
	"userMessageText",
	"customMessageText",
	"customMessageLabel",
	"toolTitle",
	"toolOutput",
	"mdHeading",
	"mdLink",
	"mdLinkUrl",
	"mdCode",
	"mdCodeBlock",
	"mdCodeBlockBorder",
	"mdQuote",
	"mdQuoteBorder",
	"mdHr",
	"mdListBullet",
	"toolDiffAdded",
	"toolDiffRemoved",
	"toolDiffContext",
	"syntaxComment",
	"syntaxKeyword",
	"syntaxFunction",
	"syntaxVariable",
	"syntaxString",
	"syntaxNumber",
	"syntaxType",
	"syntaxOperator",
	"syntaxPunctuation",
	"thinkingOff",
	"thinkingMinimal",
	"thinkingLow",
	"thinkingMedium",
	"thinkingHigh",
	"thinkingXhigh",
	"thinkingMax",
	"bashMode",
] as const satisfies readonly ThemeColor[];

const piThemeColorTokens = new Set<ThemeColor>(PI_THEME_COLOR_TOKENS);

type AssertNever<T extends never> = T;
type _MissingPiThemeColorTokens = AssertNever<Exclude<ThemeColor, (typeof PI_THEME_COLOR_TOKENS)[number]>>;

export interface AtelierPalette {
	readonly colorEnabled?: boolean;
	paint(role: PaletteRole, text: string): string;
	/** Paint a validated literal color, or return undefined when color is disabled/invalid. */
	paintHex?(hex: string, text: string): string | undefined;
}

/** NO_COLOR disables color only when it is present with a non-empty value. */
export function isColorEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
	return !environment.NO_COLOR;
}

/** Suppress foreground paint at Atelier-owned direct theme call sites. */
export function colorAwareTheme<T extends PaletteTheme>(theme: T, colorEnabled: boolean): T {
	if (colorEnabled) return theme;
	return new Proxy(theme, {
		get(target, property, receiver) {
			if (property === "fg") return (_color: ThemeColor, text: string): string => text;
			return Reflect.get(target, property, receiver);
		},
	});
}

function rgb([red, green, blue]: Rgb, text: string): string {
	return `\u001b[38;2;${red};${green};${blue}m${text}\u001b[39m`;
}

function indexed(color: number, text: string): string {
	return `\u001b[38;5;${color}m${text}\u001b[39m`;
}

function defaultColor(text: string): string {
	return `\u001b[39m${text}\u001b[39m`;
}

function themeColor(theme: PaletteTheme, color: ThemeColor, text: string): string {
	return theme.fg(color, text);
}

type ResolvedColor =
	| { readonly kind: "rgb"; readonly value: Rgb }
	| { readonly kind: "indexed"; readonly value: number }
	| { readonly kind: "token"; readonly value: ThemeColor }
	| { readonly kind: "default" };

const HEX_COLOR = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i;

export function normalizePaletteColorSpec(value: unknown): PaletteColorSpec | undefined {
	if (typeof value === "number")
		return Number.isInteger(value) && value >= 0 && value <= 255 ? value : undefined;
	if (typeof value !== "string") return undefined;
	if (value === "" || HEX_COLOR.test(value) || piThemeColorTokens.has(value as ThemeColor))
		return value as PaletteColorSpec;
	return undefined;
}

function isColorSchemeObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function resolveColorSpec(value: unknown): ResolvedColor {
	const spec = normalizePaletteColorSpec(value);
	if (spec === undefined) return { kind: "default" };
	if (typeof spec === "number") return { kind: "indexed", value: spec };
	if (spec === "") return { kind: "default" };
	const parsed = HEX_COLOR.exec(spec);
	if (parsed)
		return {
			kind: "rgb",
			value: [
				Number.parseInt(parsed[1]!, 16),
				Number.parseInt(parsed[2]!, 16),
				Number.parseInt(parsed[3]!, 16),
			],
		};
	return { kind: "token", value: spec as ThemeColor };
}

function resolveOverrides(colorScheme: unknown): ReadonlyMap<PaletteRole, ResolvedColor> {
	const overrides = new Map<PaletteRole, ResolvedColor>();
	if (!isColorSchemeObject(colorScheme)) return overrides;
	for (const role of PALETTE_ROLES) {
		if (!Object.hasOwn(colorScheme, role)) continue;
		overrides.set(role, resolveColorSpec(colorScheme[role]));
	}
	return overrides;
}

function paintResolved(theme: PaletteTheme, color: ResolvedColor, text: string): string {
	switch (color.kind) {
		case "rgb":
			return rgb(color.value, text);
		case "indexed":
			return indexed(color.value, text);
		case "token":
			return themeColor(theme, color.value, text);
		default:
			return defaultColor(text);
	}
}

function schemeBase(colorScheme: unknown): ColorSchemeBase {
	if (colorScheme === "inherit") return "inherit";
	if (!isColorSchemeObject(colorScheme)) return "atelier";
	return Object.hasOwn(colorScheme, "base") && colorScheme.base === "inherit" ? "inherit" : "atelier";
}

export function createPalette(
	theme: PaletteTheme,
	colorEnabled: boolean,
	colorScheme: AtelierColorScheme = "atelier",
): AtelierPalette {
	const overrides = resolveOverrides(colorScheme);
	const base = schemeBase(colorScheme);
	const paintBase = (role: PaletteRole, text: string): string => {
		if (base === "inherit") return themeColor(theme, THEME_TOKENS[role], text);
		if (!theme.name) return themeColor(theme, LEGACY_UNNAMED_THEME[role], text);
		return rgb(FIXED_DARK[role], text);
	};

	return {
		colorEnabled,
		paint(role, text) {
			if (!colorEnabled) return text;
			const override = overrides.get(role);
			return override ? paintResolved(theme, override, text) : paintBase(role, text);
		},
		paintHex(hex, text) {
			if (!colorEnabled) return undefined;
			const parsed = HEX_COLOR.exec(hex);
			if (!parsed) return undefined;
			return rgb(
				[Number.parseInt(parsed[1]!, 16), Number.parseInt(parsed[2]!, 16), Number.parseInt(parsed[3]!, 16)],
				text,
			);
		},
	};
}
