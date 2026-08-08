import { describe, expect, it, vi } from "vitest";
import { createSubagentActivityTracker } from "../src/subagent-activity.js";

function snapshotText(snapshot: ReturnType<ReturnType<typeof createSubagentActivityTracker>["getSnapshot"]>) {
	return [...snapshot.active, ...snapshot.recent].map((item) => ({
		id: item.id,
		status: item.status,
		agent: item.agent,
		label: item.label,
		durationMs: item.durationMs,
		currentTool: item.currentTool,
		turnCount: item.turnCount,
		toolCount: item.toolCount,
	}));
}

describe("Subagent activity tracker", () => {
	it("tracks active async steps from start events and status snapshots", () => {
		let now = 10_000;
		const tracker = createSubagentActivityTracker({
			currentSessionId: "session-1",
			now: () => now,
			readStatus: () => ({
				state: "running",
				startedAt: 9_000,
				lastUpdate: 10_000,
				steps: [
					{
						agent: "researcher",
						status: "running",
						startedAt: 9_100,
						currentTool: "read",
						currentToolStartedAt: 9_500,
						turnCount: 2,
						toolCount: 3,
					},
					{ agent: "reviewer", status: "pending" },
				],
			}),
			setInterval: vi.fn() as never,
			clearInterval: vi.fn() as never,
		});

		tracker.handleAsyncStarted({
			id: "run-1",
			sessionId: "session-1",
			asyncDir: "/tmp/run-1",
			agents: ["researcher", "reviewer"],
			goal: "Inspect sidebar",
		});

		expect(snapshotText(tracker.getSnapshot(now))).toEqual([
			expect.objectContaining({
				id: "run-1:0",
				status: "running",
				agent: "researcher",
				currentTool: "read",
				turnCount: 2,
				toolCount: 3,
			}),
			expect.objectContaining({ id: "run-1:1", status: "pending", agent: "reviewer" }),
		]);
		expect(tracker.hasActive()).toBe(true);
	});

	it("keeps completed async children for ten minutes and prunes stale ones", () => {
		let now = 100_000;
		const tracker = createSubagentActivityTracker({ now: () => now, readStatus: () => undefined });
		tracker.handleAsyncStarted({ id: "run-2", agent: "worker", startedAt: 10_000 });
		tracker.handleAsyncComplete({ id: "run-2", success: true, timestamp: 40_000 });

		expect(tracker.getSnapshot(40_000).recent).toEqual([
			expect.objectContaining({ id: "run-2", status: "complete", agent: "worker", durationMs: 30_000 }),
		]);
		now = 40_000 + 10 * 60 * 1_000 + 1;
		expect(tracker.getSnapshot(now).recent).toEqual([]);
	});

	it("tracks foreground subagent tool execution until the completion event arrives", () => {
		let now = 1_000;
		const tracker = createSubagentActivityTracker({ now: () => now });

		tracker.startForegroundTool(
			{ toolCallId: "tool-1", toolName: "subagent", args: { agent: "scout", task: "Map sidebar" } },
			now,
		);
		expect(tracker.getSnapshot(now).active).toEqual([
			expect.objectContaining({ id: "foreground:tool-1", status: "running", agent: "scout" }),
		]);

		now = 4_000;
		tracker.handleForegroundComplete({
			id: "foreground-run:0",
			agent: "scout",
			success: true,
			timestamp: now,
		});
		expect(tracker.getSnapshot(now).active).toEqual([]);
		expect(tracker.getSnapshot(now).recent).toEqual([
			expect.objectContaining({
				id: "foreground:tool-1",
				status: "complete",
				agent: "scout",
				durationMs: 3_000,
			}),
		]);
	});

	it("ignores malformed and stale-session events safely", () => {
		const changed = vi.fn();
		const tracker = createSubagentActivityTracker({ currentSessionId: "current", onChange: changed });

		tracker.handleAsyncStarted(null);
		tracker.handleAsyncStarted({ id: "other", sessionId: "old", agent: "worker" });
		tracker.handleAsyncStarted({ sessionId: "current", agent: "worker" });
		tracker.handleAsyncComplete({ success: true });
		tracker.handleForegroundComplete({ sessionId: "old", id: "fg", success: true });

		expect(tracker.getSnapshot()).toMatchObject({ active: [], recent: [] });
		expect(changed).not.toHaveBeenCalled();
	});
});
