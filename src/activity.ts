export const WORKING_PHRASES = [
	"KNEADING",
	"PERCOLATING",
	"MARINATING",
	"CARAMELIZING",
	"JULIENNING",
	"FLAMBÉING",
	"CHOREOGRAPHING",
	"MOONWALKING",
	"JITTERBUGGING",
	"SOCK-HOPPING",
	"BOOGIEING",
	"SHIMMYING",
	"EBBING",
	"UNDULATING",
	"PROPAGATING",
	"PHOTOSYNTHESIZING",
	"GERMINATING",
	"POLLINATING",
	"PONDERING",
	"RUMINATING",
	"COGITATING",
	"CEREBRATING",
	"DELIBERATING",
	"MUSING",
	"FROLICKING",
	"LOLLYGAGGING",
	"DILLY-DALLYING",
	"BOONDOGGLING",
	"SHENANIGANING",
	"RAZZLE-DAZZLING",
	"CLAUDING",
	"GITIFYING",
	"RETICULATING",
	"HYPERSPACING",
	"QUANTUMIZING",
	"COMBOBULATING",
] as const;

/** `false` disables working labels; a non-empty list overrides the built-in phrases. */
export function resolveWorkingLabels(
	labels: readonly string[] | false | undefined,
): readonly string[] | undefined {
	if (labels === false) return undefined;
	return labels?.length ? labels : WORKING_PHRASES;
}

/** Selects one label per work cycle. `random` is only consulted when a label is selected. */
export function selectWorkingLabel(
	labels: readonly string[] | false | undefined,
	random: () => number,
): string | undefined {
	const phrases = resolveWorkingLabels(labels);
	if (!phrases) return undefined;
	const randomValue = random();
	const bounded = Number.isFinite(randomValue) ? Math.min(1, Math.max(0, randomValue)) : 0;
	const index = Math.min(phrases.length - 1, Math.floor(bounded * phrases.length));
	return phrases[index]!;
}
