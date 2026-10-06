const TERMINAL_ESCAPE_PATTERN =
	/(?:\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u009d[^\u0007\u009c]*(?:\u0007|\u009c)|(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]|\u001b[@-Z\\-_])/g;

/** Format an untrusted thrown value for a single bounded user-facing line. */
export function formatErrorText(error: unknown, maxCodePoints = 160): string {
	let raw: string;
	try {
		raw = error instanceof Error ? String(error.message) : String(error);
	} catch {
		raw = "Unknown error";
	}
	const cleaned = raw
		.replace(TERMINAL_ESCAPE_PATTERN, "")
		.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return Array.from(cleaned || "Unknown error")
		.slice(0, Math.max(0, Math.trunc(maxCodePoints)))
		.join("");
}
