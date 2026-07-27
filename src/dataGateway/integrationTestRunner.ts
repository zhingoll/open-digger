import { spawnSync } from 'child_process';
import path from 'path';

const composeFile = path.resolve('docker-compose.data-gateway.test.yml');
const dockerArgs = ['compose', '-f', composeFile];
let exitCode = 1;
try {
  run('docker', [...dockerArgs, 'up', '-d', '--wait']);
  const mocha = require.resolve('mocha/bin/mocha.js');
  const testFile = path.resolve('.data-gateway-test-dist/test/dataGatewayClickHouse.test.js');
  run(process.execPath, [mocha, testFile, '--reporter', 'spec']);
  exitCode = 0;
} finally {
  const down = spawnSync('docker', [...dockerArgs, 'down', '-v'], { stdio: 'inherit', shell: false });
  if (down.status !== 0) exitCode = down.status ?? 1;
}
process.exitCode = exitCode;

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? 'unknown status'}`);
}
