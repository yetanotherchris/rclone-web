import * as fs from 'fs';
import * as path from 'path';
import { b2FromEnv, dstRemote, loadEnvLocal, rclone, srcRemote } from './b2';

const FIXTURE_PATH = path.join(__dirname, '.fixture.json');

export default async function globalTeardown(): Promise<void> {
  if (!fs.existsSync(FIXTURE_PATH)) return;

  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'));

  // Clean up the B2 test prefixes so nothing is left in the buckets.
  if (fixture.cloudEnabled) {
    loadEnvLocal();
    const b2 = b2FromEnv();
    if (b2) {
      rclone(b2, ['purge', srcRemote(b2)], { allowFail: true });
      rclone(b2, ['purge', dstRemote(b2)], { allowFail: true });
      console.log('[e2e] Purged B2 test prefixes');
    }
  }

  if (fixture.serverPid) {
    try {
      process.kill(fixture.serverPid, 'SIGTERM');
      console.log(`[e2e] Stopped server (pid ${fixture.serverPid})`);
    } catch {
      // process already gone
    }
  }

  if (fixture.tmpDir && fs.existsSync(fixture.tmpDir)) {
    fs.rmSync(fixture.tmpDir, { recursive: true, force: true });
    console.log(`[e2e] Removed ${fixture.tmpDir}`);
  }

  fs.unlinkSync(FIXTURE_PATH);
}
