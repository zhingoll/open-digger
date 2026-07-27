import { spawnSync } from 'child_process';
import path from 'path';

const composeFile = path.resolve('docker-compose.data-gateway.test.yml');
const projectName = 'open-digger-data-gateway-test';
const dockerArgs = ['compose', '--project-name', projectName, '-f', composeFile];
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
  const containers = capture('docker', ['ps', '-a', '--filter', `label=com.docker.compose.project=${projectName}`, '--format', '{{.ID}}']);
  const networks = capture('docker', ['network', 'ls', '--filter', `label=com.docker.compose.project=${projectName}`, '--format', '{{.ID}}']);
  const volumes = capture('docker', ['volume', 'ls', '--filter', `label=com.docker.compose.project=${projectName}`, '--format', '{{.Name}}']);
  process.stdout.write(`CLEANUP containers=${countLines(containers)} networks=${countLines(networks)} volumes=${countLines(volumes)}\n`);
  if (containers.trim() || networks.trim() || volumes.trim()) exitCode = 1;
}
process.exitCode = exitCode;

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? 'unknown status'}`);
}

function capture(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? 'unknown status'}: ${result.stderr}`);
  return result.stdout;
}

function countLines(value: string): number {
  return value.trim() ? value.trim().split(/\r?\n/).length : 0;
}
