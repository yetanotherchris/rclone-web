import * as fs from 'fs';
import * as path from 'path';

const FIXTURE_PATH = path.join(__dirname, '.fixture.json');

export default async function globalTeardown(): Promise<void> {
  if (!fs.existsSync(FIXTURE_PATH)) return;

  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'));

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
