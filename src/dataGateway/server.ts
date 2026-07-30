import { createDataGatewayFromEnv } from './clickHouseExecutor';
import { createDataGatewayHttpSecurityFromEnv } from './auth';
import { createDataGatewayHttpServer } from './http';

export async function startDataGatewayServer(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const security = createDataGatewayHttpSecurityFromEnv(env);
  const runtime = createDataGatewayFromEnv(env);
  const port = parsePort(env.DATA_GATEWAY_PORT ?? '3000');
  const host = env.DATA_GATEWAY_HOST ?? '127.0.0.1';
  const server = createDataGatewayHttpServer(runtime.gateway, security);
  const shutdown = (): void => { server.close(() => { void runtime.close().finally(() => process.exit(0)); }); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.removeListener('error', reject); resolve(); });
  });
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DATA_GATEWAY_PORT must be between 1 and 65535');
  return port;
}

if (require.main === module) {
  void startDataGatewayServer().catch(() => { process.stderr.write('Data Gateway failed to start\n'); process.exitCode = 1; });
}
