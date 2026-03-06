import { getMcpToolCount } from "@/lib/mcp-tool-count";

export function InterfaceOverviewTable() {
  const mcpToolCount = getMcpToolCount();

  return (
    <table>
      <thead>
        <tr>
          <th>Interface</th>
          <th>Use Case</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <strong>CLI</strong>
          </td>
          <td>Scripts, terminal workflows, agent loops</td>
        </tr>
        <tr>
          <td>
            <strong>MCP Server</strong>
          </td>
          <td>Claude Code integration ({mcpToolCount} tools)</td>
        </tr>
        <tr>
          <td>
            <strong>REST API</strong>
          </td>
          <td>Custom dashboards, external integrations</td>
        </tr>
        <tr>
          <td>
            <strong>TypeScript SDK</strong>
          </td>
          <td>Programmatic access from your agents</td>
        </tr>
        <tr>
          <td>
            <strong>Dashboard</strong>
          </td>
          <td>Visual monitoring and management</td>
        </tr>
      </tbody>
    </table>
  );
}
