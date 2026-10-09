export interface McpServerSummary {
	name: string;
	toolCount: number;
}

interface ToolDescriptor {
	name: string;
	exposure?: unknown;
	namespace?: { name?: unknown };
}

const MCP_TOOL_NAME = /^mcp__(.+?)__(.+)$/;
const MCP_NAMESPACE_PREFIX = "mcp__";

function mcpServerName(tool: ToolDescriptor): string | undefined {
	const namespace = tool.namespace?.name;
	if (typeof namespace === "string" && namespace.startsWith(MCP_NAMESPACE_PREFIX)) {
		const name = namespace.slice(MCP_NAMESPACE_PREFIX.length);
		if (name) return name;
	}
	return MCP_TOOL_NAME.exec(tool.name)?.[1];
}

/** Summarize connected MCP namespaces exposed through Pi's public tool registry. */
export function summarizeMcpServers(tools: readonly ToolDescriptor[]): McpServerSummary[] {
	const counts = new Map<string, Set<string>>();
	for (const tool of tools) {
		if (tool.exposure === "hidden") continue;
		const server = mcpServerName(tool);
		if (!server) continue;
		const names = counts.get(server) ?? new Set<string>();
		names.add(tool.name);
		counts.set(server, names);
	}
	return [...counts.entries()]
		.map(([name, names]) => ({ name, toolCount: names.size }))
		.sort((left, right) => left.name.localeCompare(right.name, "en"));
}
