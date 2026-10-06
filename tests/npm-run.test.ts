import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error Package-check helper is intentionally plain JavaScript.
import { parseNpmPackReport, resolveNpmLaunch } from "../scripts/npm-run.mjs";

const report = { filename: "fixture-1.0.0.tgz", files: [{ path: "package.json" }] };

describe("npm pack report parsing", () => {
	it.each([JSON.stringify([report]), JSON.stringify({ fixture: report })])(
		"accepts one validated npm 11/12 report",
		(output) => expect(parseNpmPackReport(output)).toEqual(report),
	);

	it.each([
		"null",
		"[]",
		JSON.stringify([report, report]),
		JSON.stringify({ first: report, second: report }),
		JSON.stringify([{ filename: "x.tgz" }]),
		JSON.stringify([{ filename: "x.tgz", files: [{ nope: true }] }]),
	])("rejects malformed or ambiguous report %s", (output) => {
		expect(() => parseNpmPackReport(output)).toThrow("exactly one valid package report");
	});
});

describe("npm launch resolution", () => {
	it("uses a Windows npm JavaScript CLI without a shell or argument encoding", () => {
		const cli = "C:\\Node\\node_modules\\npm\\bin\\npm-cli.js";
		const launch = resolveNpmLaunch({
			env: {},
			platform: "win32",
			execPath: "C:\\Node\\node.exe",
			fileExists: (path: string) => path === cli,
		});
		expect(launch).toEqual({ command: "C:\\Node\\node.exe", prefix: [cli], shell: false });
	});

	it("reuses npm_execpath and preserves percent-bearing paths as literal arguments", () => {
		expect(
			resolveNpmLaunch({
				env: { npm_execpath: "C:\\Users\\%USERNAME%\\npm-cli.js" },
				platform: "win32",
				execPath: "C:\\Node\\node.exe",
				fileExists: (path: string) => path === "C:\\Users\\%USERNAME%\\npm-cli.js",
			}),
		).toEqual({
			command: "C:\\Node\\node.exe",
			prefix: ["C:\\Users\\%USERNAME%\\npm-cli.js"],
			shell: false,
		});
	});
});

it.each([false, true])(
	"packs and installs through paths with spaces and shell characters (direct invocation: %s)",
	(direct) => {
		const root = mkdtempSync(join(tmpdir(), "npm check (space) & path "));
		const source = join(root, "source");
		const destination = join(root, "packed files");
		const consumer = join(root, "consumer");

		try {
			for (const directory of [source, destination, consumer]) mkdirSync(directory);
			writeFileSync(
				join(source, "package.json"),
				JSON.stringify({ name: "npm-run-fixture", version: "1.0.0" }),
			);
			writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true }));
			execFileSync(
				process.execPath,
				[
					"--input-type=module",
					"--eval",
					`
						import { join } from "node:path";
						if (${direct}) delete process.env.npm_execpath;
						const [helper, source, destination, consumer] = process.argv.slice(1);
						const { npm, npmPackReport } = await import(helper);
						const report = npmPackReport(["--offline", "--pack-destination", destination], { cwd: source });
						npm(["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund",
							join(destination, report.filename)], { cwd: consumer });
					`,
					new URL("../scripts/npm-run.mjs", import.meta.url).href,
					source,
					destination,
					consumer,
				],
				{ encoding: "utf8", timeout: 25_000 },
			);
			const installed = JSON.parse(
				readFileSync(join(consumer, "node_modules/npm-run-fixture/package.json"), "utf8"),
			);
			expect(installed).toMatchObject({ name: "npm-run-fixture", version: "1.0.0" });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	},
	30_000,
);
