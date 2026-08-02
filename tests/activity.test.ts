import { describe, expect, it, vi } from "vitest";
import { selectWorkingLabel, WORKING_PHRASES } from "../src/activity.js";

const expectedPhrases = [
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

describe("working phrases", () => {
	it("contains exactly the approved reference-image phrases", () => {
		expect(WORKING_PHRASES).toEqual(expectedPhrases);
		expect(new Set(WORKING_PHRASES).size).toBe(36);
	});

	it.each([
		[0, "KNEADING"],
		[0.5, "PONDERING"],
		[0.999_999, "COMBOBULATING"],
		[1, "COMBOBULATING"],
		[-1, "KNEADING"],
		[Number.NaN, "KNEADING"],
	] as const)("selects a bounded phrase for random value %s", (randomValue, expected) => {
		expect(selectWorkingLabel(undefined, () => randomValue)).toBe(expected);
	});

	it.each([
		["an empty list", [], "PONDERING", 1],
		["a custom list", ["THINKING", "WORKING", "PROCESSING"], "WORKING", 1],
		["false", false, undefined, 0],
	] as const)("selects from %s", (_case, labels, expected, calls) => {
		const random = vi.fn().mockReturnValue(0.5);

		expect(selectWorkingLabel(labels, random)).toBe(expected);
		expect(random).toHaveBeenCalledTimes(calls);
	});
});
