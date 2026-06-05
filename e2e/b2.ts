// Shared helpers for the opt-in Backblaze B2 bucket-to-bucket e2e test.
//
// One B2 account (one application key) backs both buckets, so a single rclone
// remote named "b2" is used; the two "buckets" are just different remote paths.
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export const ENV_LOCAL_PATH = path.join(__dirname, '.env.local');

export interface B2Config {
  account: string;
  key: string;
  srcBucket: string;
  dstBucket: string;
  prefix: string;
}

// loadEnvLocal parses e2e/.env.local (simple KEY=VALUE lines) into process.env.
// Existing process.env values win, so real shell env can override the file.
// No-op (returns false) when the file is absent.
export function loadEnvLocal(): boolean {
  if (!fs.existsSync(ENV_LOCAL_PATH)) return false;
  for (const raw of fs.readFileSync(ENV_LOCAL_PATH, 'utf-8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
  return true;
}

// b2FromEnv returns the B2 config if all required vars are present, else null.
export function b2FromEnv(): B2Config | null {
  const account = process.env.RCLONEWEB_E2E_B2_ACCOUNT;
  const key = process.env.RCLONEWEB_E2E_B2_KEY;
  const srcBucket = process.env.RCLONEWEB_E2E_B2_SRC_BUCKET;
  const dstBucket = process.env.RCLONEWEB_E2E_B2_DST_BUCKET;
  if (!account || !key || !srcBucket || !dstBucket) return null;
  return {
    account,
    key,
    srcBucket,
    dstBucket,
    prefix: process.env.RCLONEWEB_E2E_B2_PREFIX || 'e2e',
  };
}

// rcloneEnv builds the env for invoking rclone directly (seed/verify/cleanup),
// mirroring the RCLONE_CONFIG_B2_* vars the server itself generates.
export function rcloneEnv(b2: B2Config): NodeJS.ProcessEnv {
  return {
    ...process.env,
    RCLONE_CONFIG_B2_TYPE: 'b2',
    RCLONE_CONFIG_B2_ACCOUNT: b2.account,
    RCLONE_CONFIG_B2_KEY: b2.key,
  };
}

// Source and destination use distinct sub-paths (/src, /dst) under the prefix so
// the test still works when srcBucket === dstBucket (a single shared bucket) —
// otherwise the copy job would have identical source and destination.
export function srcRemote(b2: B2Config): string {
  return `b2:${b2.srcBucket}/${b2.prefix}/src`;
}

export function dstRemote(b2: B2Config): string {
  return `b2:${b2.dstBucket}/${b2.prefix}/dst`;
}

// rclone runs the rclone binary with B2 env. Throws on non-zero exit unless
// allowFail is set (used for purge of possibly-absent paths).
export function rclone(
  b2: B2Config,
  args: string[],
  opts: { allowFail?: boolean } = {},
): string {
  const bin = process.env.RCLONEWEB_E2E_RCLONE || 'rclone';
  try {
    return execFileSync(bin, args, {
      env: rcloneEnv(b2),
      encoding: 'utf-8',
    });
  } catch (err) {
    if (opts.allowFail) return '';
    throw err;
  }
}
