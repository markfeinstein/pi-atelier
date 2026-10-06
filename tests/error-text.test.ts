import { describe, expect, it } from "vitest";
import { formatErrorText } from "../src/error-text.js";

describe("formatErrorText", () => {
	it("strips terminal sequences and controls into one bounded line", () => {
		const input = `\u001b[31mprimary\nerror\u001b[0m \u001b]8;;https://example.test\u0007link\u001b]8;;\u0007`;
		expect(formatErrorText(input)).toBe("primary error link");
		expect(Array.from(formatErrorText("界".repeat(200)))).toHaveLength(160);
	});

	it("does not throw for hostile values or non-string Error messages", () => {
		expect(
			formatErrorText({
				toString: () => {
					throw new Error("hostile");
				},
			}),
		).toBe("Unknown error");
		const error = new Error("placeholder");
		Object.defineProperty(error, "message", { value: { toString: () => "safe\nmessage" } });
		expect(formatErrorText(error)).toBe("safe message");
	});
});
