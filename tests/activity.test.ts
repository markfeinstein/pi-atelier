import { describe, expect, it, vi } from "vitest";
import { selectWorkingLabel } from "../src/activity.js";

describe("working phrases", () => {
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
