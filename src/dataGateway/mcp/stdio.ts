import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createDataGatewayFromEnv } from '../clickHouseExecutor';
import { createDataGatewayMcpServer } from './server';

export async function startDataGatewayMcpStdio(): Promise<void> {
  const runtime = createDataGatewayFromEnv();
  const server = createDataGatewayMcpServer(runtime.gateway);
  process.once('beforeExit', () => { void runtime.close(); });
  await server.connect(new StdioServerTransport());
}

if (require.main === module) {
  void startDataGatewayMcpStdio().catch(() => {
    process.stderr.write('Data Gateway MCP server failed to start\n');
    process.exitCode = 1;
  });
}
