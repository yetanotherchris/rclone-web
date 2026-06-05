import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { b2FromEnv, dstRemote, loadEnvLocal, rclone, srcRemote } from './b2';

const REPO_ROOT = path.resolve(__dirname, '..');
export const FIXTURE_PATH = path.join(__dirname, '.fixture.json');

export default async function globalSetup(): Promise<void> {
  // Load opt-in B2 credentials (e2e/.env.local) into the env so both the Go
  // fixture helper and the rclone seed/cleanup below see them.
  loadEnvLocal();

  // Build the server binary (cached by Go's build cache on subsequent runs)
  console.log('[e2e] Building server binary...');
  execSync('go build -o e2e/.server .', { cwd: REPO_ROOT, stdio: 'inherit' });

  // Create test config + fixture dirs via Go helper.
  // Build to a fixed binary instead of `go run`: on Windows the `go run` temp
  // exe is named after its dir (testsetup.exe), and the UAC installer-detection
  // heuristic auto-elevates any exe whose name contains "setup", which fails.
  console.log('[e2e] Creating test fixtures...');
  const fixtureBin = path.join('e2e', '.fixtures' + (process.platform === 'win32' ? '.exe' : ''));
  execSync(`go build -o ${fixtureBin} ./e2e/testsetup`, { cwd: REPO_ROOT, stdio: 'inherit' });
  const setupOut = execSync(path.join(REPO_ROOT, fixtureBin), { cwd: REPO_ROOT }).toString().trim();
  const fixture = JSON.parse(setupOut);

  // If B2 is configured, prepare the buckets BEFORE starting the server so a
  // seed failure can't leak a running server: purge both paths for a clean
  // slate, then seed the source with the same local fixtures. The B2 spec then
  // runs the server's "E2E B2 Copy" job and verifies the destination.
  if (fixture.cloudEnabled) {
    const b2 = b2FromEnv();
    if (b2) {
      console.log(`[e2e] B2 src:  ${srcRemote(b2)}`);
      console.log(`[e2e] B2 dst:  ${dstRemote(b2)}`);
      rclone(b2, ['purge', srcRemote(b2)], { allowFail: true });
      rclone(b2, ['purge', dstRemote(b2)], { allowFail: true });
      rclone(b2, ['copy', fixture.srcDir, srcRemote(b2)]);
    }
  }

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
