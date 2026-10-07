import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { npm, npmPackReport } from "./npm-run.mjs";

const repoDir = fileURLToPath(new URL("..", import.meta.url));
const tempDir = mkdtempSync(join(tmpdir(), "pi-atelier-install-"));

try {
	const packed = npmPackReport(["--pack-destination", tempDir], { cwd: repoDir });
	const consumerDir = join(tempDir, "consumer");
	mkdirSync(consumerDir);
	writeFileSync(
		join(consumerDir, "package.json"),
		JSON.stringify({ name: "pi-atelier-install-check", private: true }),
	);
	npm(
		["install", "--legacy-peer-deps=false", "--include=peer", "--no-fund", join(tempDir, packed.filename)],
		{ cwd: consumerDir },
	);
	const lock = JSON.parse(readFileSync(join(consumerDir, "package-lock.json"), "utf8"));
	const unexpected = Object.keys(lock.packages).filter(
		(path) => path !== "" && path !== "node_modules/pi-atelier",
	);
	assert.equal(
		unexpected.length,
		0,
		`Installation pulled in ${unexpected.length} unexpected dependencies: ${unexpected.slice(0, 10).join(", ")}`,
	);
	assert.ok(lock.packages["node_modules/pi-atelier"], "Packed pi-atelier was not installed");
	npm(["audit", "--audit-level=low"], { cwd: consumerDir });

	process.env.PI_CODING_AGENT_DIR = join(tempDir, "agent");
	// Pi's package index does not export the loader; this deep import may need updating on Pi upgrades.
	const { loadExtensions } = await import(
		"../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js"
	);
	const packageDir = join(consumerDir, "node_modules", "pi-atelier");
	const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
	const entries = manifest.pi.extensions.map((path) => join(packageDir, path));
	const result = await loadExtensions(entries, consumerDir);
	assert.deepEqual(result.errors, [], "Packed extension failed to load with host-provided Pi dependencies");
	assert.equal(result.extensions.length, entries.length);
	assert.ok(
		result.extensions.some((extension) => extension.commands.has("atelier")),
		"Atelier did not initialize",
	);
	console.log(
		"Package install verified (no transitive dependencies, audit clean, host loader initialized Atelier)",
	);
} finally {
	rmSync(tempDir, { recursive: true, force: true });
}
