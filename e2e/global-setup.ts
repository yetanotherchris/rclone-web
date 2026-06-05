import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
export const FIXTURE_PATH = path.join(__dirname, '.fixture.json');

export default async function globalSetup(): Promise<void> {
  // Build the server binary (cached by Go's build cache on subsequent runs)
  console.log('[e2e] Building server binary...');
  execSync('go build -o e2e/.server .', { cwd: REPO_ROOT, stdio: 'inherit' });

  // Create test config + fixture dirs via Go helper
  console.log('[e2e] Creating test fixtures...');
  const setupOut = execSync('go run ./e2e/testsetup', { cwd: REPO_ROOT }).toString().trim();
  const fixture = JSON.parse(setupOut);

  // Start the server in key-file mode (no lock screen, no auth required)
  const serverBin = path.join(REPO_ROOT, 'e2e', '.server');
  const server = spawn(serverBin, [
    '--config', fixture.configPath,
    '--key-file', fixture.passphrasePath,
    '--port', '0',
    '--bind', '127.0.0.1',
  ]);

  const url = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Server did not start within 30s')),
      30_000,
    );
    server.stdout.on('data', (data: Buffer) => {
      const match = data.toString().match(/listening on (http:\/\/\S+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    server.stderr.on('data', (data: Buffer) => {
      process.stderr.write('[server] ' + data.toString());
    });
    server.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  console.log(`[e2e] Server: ${url}`);
  console.log(`[e2e] Src:    ${fixture.srcDir}`);
  console.log(`[e2e] Dst:    ${fixture.dstDir}`);

  fs.writeFileSync(FIXTURE_PATH, JSON.stringify(
    { ...fixture, url, serverPid: server.pid },
    null, 2,
  ));
}
