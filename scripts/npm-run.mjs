import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, win32 } from "node:path";

/** Resolve npm without invoking a Windows command shell (which expands `%VAR%`). */
export function resolveNpmLaunch({
	env = process.env,
	platform = process.platform,
	execPath = process.execPath,
	fileExists = existsSync,
} = {}) {
	if (env.npm_execpath && /\.(?:c|m)?js$/i.test(env.npm_execpath) && fileExists(env.npm_execpath)) {
		return { command: execPath, prefix: [env.npm_execpath], shell: false };
	}
	if (platform !== "win32") return { command: "npm", prefix: [], shell: false };
	const pathApi = platform === "win32" ? win32 : { dirname, join };
	const candidates = [
		pathApi.join(pathApi.dirname(execPath), "node_modules", "npm", "bin", "npm-cli.js"),
		pathApi.join(
			pathApi.dirname(pathApi.dirname(execPath)),
			"lib",
			"node_modules",
			"npm",
			"bin",
			"npm-cli.js",
		),
	];
	const cli = candidates.find((candidate) => fileExists(candidate));
	if (!cli) throw new Error("Cannot locate npm's JavaScript CLI on Windows; run this check through npm run");
	return { command: execPath, prefix: [cli], shell: false };
}

/** Run npm and return its stdout, throwing when npm cannot be launched or fails. */
export function npm(args, options = {}) {
	const { command, prefix, shell } = resolveNpmLaunch(options.launch);
	const result = spawnSync(command, [...prefix, ...args], {
		cwd: options.cwd,
		encoding: "utf8",
		shell,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		// npm 12 reports failures as a JSON document on stdout; older versions use stderr.
		const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
		throw new Error(`npm ${args.join(" ")} failed (${result.signal ?? result.status})\n${output}`);
	}
	return result.stdout;
}

function isPackReport(value) {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof value.filename === "string" &&
		value.filename.length > 0 &&
		Array.isArray(value.files) &&
		value.files.every(
			(file) =>
				typeof file === "object" && file !== null && typeof file.path === "string" && file.path.length > 0,
		)
	);
}

/** Validate npm 11's array and npm 12's package-keyed object pack-report shapes. */
export function parseNpmPackReport(output) {
	const parsed = JSON.parse(output);
	const reports = Array.isArray(parsed)
		? parsed
		: typeof parsed === "object" && parsed !== null
			? Object.values(parsed)
			: [];
	if (reports.length !== 1 || !isPackReport(reports[0])) {
		throw new Error("npm pack --json must return exactly one valid package report");
	}
	return reports[0];
}

export function npmPackReport(args, options = {}) {
	return parseNpmPackReport(npm(["pack", "--json", ...args], options));
}
