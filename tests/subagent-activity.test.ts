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
		activityState: item.activityState,
		timedOut: item.timedOut,
		processState: item.processState,
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

	it("treats completion notifications as terminal even when optional outcome fields are absent", () => {
		const tracker = createSubagentActivityTracker({ now: () => 5_000 });
		tracker.handleAsyncStarted({ id: "async-complete", agent: "worker", startedAt: 1_000 });
		tracker.handleAsyncComplete({ id: "async-complete", timestamp: 5_000 });

		expect(tracker.hasActive()).toBe(false);
		expect(tracker.getSnapshot().recent).toEqual([
			expect.objectContaining({ id: "async-complete", status: "complete", durationMs: 4_000 }),
		]);

		tracker.handleAsyncStarted({ id: "failed-complete", startedAt: 2_000 });
		tracker.handleAsyncComplete({
			id: "failed-complete",
			state: "complete",
			success: false,
			timestamp: 5_000,
		});
		expect(tracker.getSnapshot().recent).toEqual(
			expect.arrayContaining([expect.objectContaining({ id: "failed-complete", status: "failed" })]),
		);
	});

	it("coerces stale running steps when their authoritative parent is terminal", () => {
		const tracker = createSubagentActivityTracker({
			now: () => 5_000,
			readStatus: () => ({
				state: "complete",
				startedAt: 1_000,
				endedAt: 4_000,
				steps: [{ agent: "worker", status: "running", startedAt: 2_000 }],
			}),
		});
		tracker.handleAsyncStarted({ id: "terminal-parent", asyncDir: "/tmp/terminal-parent" });

		expect(tracker.hasActive()).toBe(false);
		expect(tracker.getSnapshot().recent).toEqual([
			expect.objectContaining({ agent: "worker", status: "complete", durationMs: 2_000 }),
		]);
	});

	it("preserves detached, partial, timeout, attention, process, and nested child states", () => {
		const tracker = createSubagentActivityTracker({
			now: () => 20_000,
			readStatus: () => ({
				state: "paused",
				startedAt: 1_000,
				endedAt: 10_000,
				steps: [
					{
						childId: "outer",
						agent: "lead",
						status: "detached",
						activityState: "needs_attention",
						children: [
							{
								id: "nested-run",
								state: "running",
								steps: [
									{
										agent: "researcher",
										status: "running",
										currentTool: "read",
										processTerminal: { state: "unknown" },
									},
								],
							},
						],
					},
					{ agent: "tester", status: "partial", timedOut: true, endedAt: 9_000 },
				],
			}),
			setInterval: vi.fn() as never,
			clearInterval: vi.fn() as never,
		});
		tracker.handleAsyncStarted({ id: "stateful", asyncDir: "/tmp/stateful" });

		const snapshot = tracker.getSnapshot();
		expect(snapshot.active).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ status: "detached", agent: "lead", activityState: "needs_attention" }),
				expect.objectContaining({ status: "running", agent: "researcher", processState: "unknown" }),
			]),
		);
		expect(snapshot.recent).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ status: "partial", agent: "tester", timedOut: true }),
			]),
		);
		tracker.handleAsyncComplete({ id: "stateful", success: true, timestamp: 12_000 });
		expect(tracker.getSnapshot().active).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ status: "detached", agent: "lead" }),
				expect.objectContaining({ status: "running", agent: "researcher" }),
			]),
		);
		expect(tracker.hasActive()).toBe(true);
	});

	it("does not let foreground completion IDs clobber authoritative async records", () => {
		const tracker = createSubagentActivityTracker({ now: () => 5_000 });
		tracker.handleAsyncStarted({ id: "shared-run", agent: "worker", startedAt: 1_000 });
		tracker.handleForegroundComplete({ id: "shared-run", success: true, timestamp: 4_000 });

		expect(tracker.getSnapshot().active).toEqual([
			expect.objectContaining({ id: "shared-run", source: "async", status: "queued" }),
		]);
		expect(tracker.getSnapshot().recent).toEqual([]);
	});

	it("updates foreground workflow children from tool progress and control events", () => {
		let now = 1_000;
		const tracker = createSubagentActivityTracker({ now: () => now });
		tracker.startForegroundTool(
			{ toolCallId: "workflow-tool", toolName: "subagent", args: { workflowScript: "return runs.run()" } },
			now,
		);
		tracker.updateForegroundTool(
			{
				toolCallId: "workflow-tool",
				toolName: "subagent",
				args: {},
				partialResult: {
					details: {
						workflowChildren: {
							workflowState: "running",
							children: [
								{
									childId: "writer",
									agent: "coder",
									state: "running",
									activity: { currentTool: "edit", toolCount: 2 },
								},
							],
						},
					},
				},
			},
			now,
		);
		tracker.handleControlEvent({
			event: {
				type: "needs_attention",
				to: "needs_attention",
				runId: "missing-run-id",
				toolCallId: "workflow-tool",
				workflowKey: "writer",
				ts: 2_000,
			},
		});

		expect(tracker.getSnapshot().active).toEqual([
			expect.objectContaining({
				agent: "coder",
				status: "running",
				currentTool: "edit",
				activityState: "needs_attention",
			}),
		]);

		now = 4_000;
		tracker.finishForegroundTool(
			{
				toolCallId: "workflow-tool",
				toolName: "subagent",
				isError: false,
				result: {
					details: {
						workflowChildren: {
							workflowState: "completed",
							children: [{ childId: "writer", agent: "coder", state: "completed" }],
						},
					},
				},
			},
			now,
		);
		expect(tracker.getSnapshot().recent).toEqual([
			expect.objectContaining({ agent: "coder", status: "complete", durationMs: 3_000 }),
		]);
	});

	it("keeps a detached foreground child active until its correlated completion arrives", () => {
		let now = 1_000;
		const tracker = createSubagentActivityTracker({ now: () => now });
		tracker.startForegroundTool({
			toolCallId: "detached-tool",
			toolName: "subagent",
			args: { agent: "worker" },
		});
		now = 2_000;
		tracker.finishForegroundTool({
			toolCallId: "detached-tool",
			toolName: "subagent",
			isError: false,
			result: {
				details: {
					runId: "foreground-run",
					results: [{ index: 0, agent: "worker", status: "detached" }],
				},
			},
		});
		expect(tracker.getSnapshot().active).toEqual([
			expect.objectContaining({ agent: "worker", status: "detached" }),
		]);

		now = 5_000;
		tracker.handleForegroundComplete({
			id: "foreground-run:0",
			runId: "foreground-run",
			agent: "worker",
			success: true,
			timestamp: now,
		});
		expect(tracker.hasActive()).toBe(false);
		expect(tracker.getSnapshot().recent).toEqual([
			expect.objectContaining({ agent: "worker", status: "complete", durationMs: 4_000 }),
		]);
	});

	it("restores authoritative async status and suppresses an async launch's foreground fallback", () => {
		const tracker = createSubagentActivityTracker({
			now: () => 10_000,
			readStatus: () => ({ state: "running", startedAt: 8_000, currentTool: "bash" }),
			setInterval: vi.fn() as never,
			clearInterval: vi.fn() as never,
		});
		tracker.startForegroundTool({
			toolCallId: "async-tool",
			toolName: "subagent",
			args: { agent: "tester" },
		});
		tracker.finishForegroundTool({
			toolCallId: "async-tool",
			toolName: "subagent",
			isError: false,
			result: { details: { mode: "single", asyncId: "async-restored", asyncDir: "/tmp/restored" } },
		});

		expect(tracker.getSnapshot().active).toEqual([
			expect.objectContaining({
				id: "async-restored",
				source: "async",
				status: "running",
				currentTool: "bash",
			}),
		]);
		expect(tracker.getSnapshot().recent).toEqual([]);
	});

	it("applies child stopping events immediately while status polling catches up", () => {
		const tracker = createSubagentActivityTracker({
			readStatus: () => ({
				state: "running",
				startedAt: 1_000,
				steps: [{ childId: "worker", agent: "worker", status: "running" }],
			}),
			setInterval: vi.fn() as never,
			clearInterval: vi.fn() as never,
		});
		tracker.handleAsyncStarted({ id: "stop-run", asyncDir: "/tmp/stop-run" });
		tracker.handleChildStatus({
			runId: "stop-run",
			childId: "worker",
			status: "stopping",
			ts: 2_000,
		});

		expect(tracker.getSnapshot(2_000).active).toEqual([
			expect.objectContaining({ agent: "worker", status: "stopping" }),
		]);
	});

	it("reconciles restored branch records when session-tree state changes", () => {
		const tracker = createSubagentActivityTracker({
			readStatus: () => undefined,
			setInterval: vi.fn() as never,
			clearInterval: vi.fn() as never,
		});
		const restored = { mode: "workflow", asyncId: "branch-run", asyncDir: "/tmp/branch-run" };
		tracker.reconcileRestoredAsyncToolResults([restored]);
		expect(tracker.getSnapshot().active).toEqual([
			expect.objectContaining({ id: "branch-run", source: "async" }),
		]);

		tracker.reconcileRestoredAsyncToolResults([]);
		expect(tracker.getSnapshot()).toMatchObject({ active: [], recent: [] });
	});

	it("bounds unreadable async status polling with an explicit unavailable failure", () => {
		const tracker = createSubagentActivityTracker({
			now: () => 5_000,
			maxStatusMisses: 1,
			readStatus: () => undefined,
		});
		tracker.handleAsyncStarted({ id: "missing-status", asyncDir: "/tmp/missing-status", startedAt: 1_000 });

		expect(tracker.hasActive()).toBe(false);
		expect(tracker.getSnapshot().recent).toEqual([
			expect.objectContaining({
				id: "missing-status",
				status: "failed",
				statusUnavailable: true,
				durationMs: 4_000,
			}),
		]);
	});

	it("ignores malformed and stale-session events safely", () => {
		const changed = vi.fn();
		const tracker = createSubagentActivityTracker({ currentSessionId: "current", onChange: changed });

		tracker.handleAsyncStarted(null);
		tracker.handleAsyncStarted({ id: "other", sessionId: "old", agent: "worker" });
		tracker.handleAsyncStarted({ id: "sessionless", agent: "worker" });
		tracker.handleAsyncStarted({ sessionId: "current", agent: "worker" });
		tracker.handleAsyncComplete({ success: true });
		tracker.handleForegroundComplete({ sessionId: "old", id: "fg", success: true });
		tracker.handleControlEvent({ sessionId: "old", event: { runId: "current", to: "needs_attention" } });
		tracker.handleChildStatus({ sessionId: "old", runId: "current", childId: "worker", status: "stopped" });
		tracker.handleProcessTerminal({ sessionId: "old", runId: "current", state: "unknown" });

		expect(tracker.getSnapshot()).toMatchObject({ active: [], recent: [] });
		expect(changed).not.toHaveBeenCalled();
	});
});
