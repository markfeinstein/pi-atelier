import type { AtelierPalette, PaletteRole } from "./palette.js";

const FRACTION_GLYPHS = "▏▎▍▌▋▊▉";
const TRACK_ON = "\u001b[48;2;48;53;56m";
const TRACK_OFF = "\u001b[49m";

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
	const full = Math.floor(units / 8);
	const fraction = units % 8;
	const filled = "█".repeat(full) + (fraction ? FRACTION_GLYPHS[fraction - 1] : "");
	const unfilled = Math.max(0, safeWidth - full - (fraction ? 1 : 0));
	return colorEnabled
		? `${TRACK_ON}${palette.paint(role, filled)}${" ".repeat(unfilled)}${TRACK_OFF}`
		: `${palette.paint(role, "█".repeat(full))}${palette.paint("dim", "░".repeat(Math.max(0, safeWidth - full)))}`;
}
