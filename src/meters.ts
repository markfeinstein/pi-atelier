import type { AtelierPalette, PaletteRole } from "./palette.js";

const FRACTION_GLYPHS = "▏▎▍▌▋▊▉";

/** Render a bounded eighth-cell meter with an attached track. */
export function subcellMeter(
	percent: number,
	width: number,
	role: PaletteRole,
	palette: AtelierPalette,
	colorEnabled: boolean,
): string {
	const safeWidth = Math.max(0, Math.trunc(width));
	const clamped = Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0));
	const units = Math.min(
		safeWidth * 8,
		Math.max(clamped > 0 ? 1 : 0, Math.round((clamped * safeWidth * 8) / 100)),
	);
	if (safeWidth === 0) return "";
	const full = Math.floor(units / 8);
	const fraction = units % 8;
	const filled = "█".repeat(full) + (fraction ? FRACTION_GLYPHS[fraction - 1] : "");
	const unfilled = Math.max(0, safeWidth - full - (fraction ? 1 : 0));
	return colorEnabled
		? `${filled ? palette.paint(role, filled) : ""}${unfilled ? palette.paint("dim", "░".repeat(unfilled)) : ""}`
		: `${filled}${"░".repeat(unfilled)}`;
}
