# rclone-web

A web UI for managing and running rclone jobs, protected by an age-encrypted YAML config file.

## What it is

rclone-web is a small Go HTTP server that:
- Stores job definitions and cloud provider credentials in a **YAML file encrypted with [age](https://age-encryption.org/)** (`rcloneweb.yml.age`)
- Serves a browser UI to unlock, manage jobs/providers, and trigger rclone runs
- Locks itself after an idle timeout, zeroing the passphrase from memory

The encrypted file is **not** an rclone native config file. It is a YAML file with rclone-web's own schema (`RcloneConfig` in `internal/config/model.go`) that configures rclone jobs and providers. rclone itself is invoked as a subprocess with env-var credentials.

## Config file

There is exactly **one** persisted file: the age-encrypted YAML at `~/.config/rcloneweb/rcloneweb.yml.age` (default path, overridable with `--config`).

All other settings (bind address, port, idle timeout, rclone binary path) are **command-line flags** passed to the `serve` command. There is no plaintext config file.

## Password workflow

**Full passphrase (no short password)**

1. `init` prompts for a password (hidden), encrypts the YAML config with it via age, and saves the `.age` file.
2. Each time `rclone-web serve` runs, the browser shows an unlock screen. You type the full password; the server decrypts the config into memory and holds it there until the idle timeout fires, then zeroes it out.

**Short password**

1. During `init`, after setting the full password, you choose how many characters to type at unlock time (default 4).
2. The passphrase is split at position `n`: `short = passphrase[:n]`, `suffix = passphrase[n:]`.
3. The `suffix` is saved to the OS credential store (Keychain / Windows Credential Manager / Linux secret service). The full password is not stored anywhere — only the suffix.
4. At unlock time you type just the first `n` characters. The server fetches the suffix from the credential store, concatenates `userInput + suffix`, and uses that to decrypt the config. If no credential store entry exists, the raw input is used as the full passphrase.

**Key-file mode**

An alternative to the browser unlock screen — pass `--key-file /path/to/file` and the server reads the passphrase from that file at startup, auto-unlocks, and never prompts. Intended for daemon/service use.

---

## Init UX

All password prompts in `init` use `golang.org/x/term.ReadPassword` so characters are hidden (not echoed to the terminal).

## Short password (credential store)

During `init`, the user can opt into a short-password mode. They enter their full password, then are asked **how many characters** they wish to type at unlock time (default: 4). The first N characters become the short password; the remainder (`fullPassword[n:]`) is stored in the OS credential store (macOS Keychain, Windows Credential Manager, Linux secret service).

At unlock time the server concatenates `userInput + storedSuffix` to reconstruct the full passphrase. If no credential store entry exists, the input is used directly as the full passphrase.

## Key-file mode

Passing `--key-file /path/to/file` to the serve command reads the passphrase from that file and auto-unlocks at startup. In this mode:
- The browser unlock screen is never shown
- No browser is launched on startup (daemon-friendly; also avoids focus-stealing in e2e)
- Session cookies and CSRF tokens are not required
- The idle timeout and lock button have no effect

This is intended for daemon/service use where the server should start ready without manual interaction.

## Subcommands

- `rclone-web init [--config PATH]` — interactive setup: creates the encrypted age config and optionally stores a credential-store suffix for short-password mode
- `rclone-web [flags]` — starts the HTTP server, opens browser

### Serve flags

| Flag | Default | Description |
|------|---------|-------------|
| `--config` | `~/.config/rcloneweb/rcloneweb.yml.age` | Path to age-encrypted config |
| `--port` | 0 (random) | HTTP port |
| `--bind` | `127.0.0.1` | Bind address |
| `--idle-timeout` | 300 | Idle timeout in seconds |
| `--rclone-path` | `rclone` | Path to rclone binary (default assumes rclone is on $PATH) |
| `--key-file` | *(none)* | Path to file containing passphrase (enables key-file mode) |

## Key packages

| Package | Purpose |
|---------|---------|
| `internal/config` | AppConfig (CLI-flag settings) and RcloneConfig (encrypted YAML schema) |
| `internal/secret` | age encrypt/decrypt helpers |
| `internal/creds` | OS credential store abstraction |
| `internal/server` | HTTP handlers, session management, job/provider API |
| `internal/runner` | Subprocess management for rclone invocations |
| `internal/remotes` | Converts provider map to `RCLONE_CONFIG_*` env vars and assembles argv |

## Running the unit tests

```
go test ./...
```

## Running the e2e tests

**Prerequisites:** `rclone` on `$PATH`, Node.js ≥ 18, Go.

```bash
cd e2e
npm install
npm run install-browsers   # first time only — downloads Chromium
npm test
```

The harness (`global-setup.ts`) will:
1. Build the server binary (`e2e/.server`)
2. Generate a temporary age-encrypted config with one local copy job, one job per
   rclone command, and (if configured) a B2 job
3. Start the server in `--key-file` mode (no unlock screen, no browser launched)
4. Run the Playwright tests below against it
5. Kill the server and clean up the temp directory (`global-teardown.ts`)

#### Tests

By default `npm test` runs the 8 hermetic local tests. The B2 test only runs
when `e2e/.env.local` is present (see below); otherwise it is skipped.

| Spec file | Test | What it checks |
|-----------|------|----------------|
| `copy-job.spec.ts` | unlocked in key-file mode | No lock screen is shown when started with `--key-file` |
| `copy-job.spec.ts` | dashboard lists the job | The "E2E Copy" job appears on the dashboard |
| `copy-job.spec.ts` | copy job runs | Running the local copy job reaches `success · exit 0` and the files land in the destination dir |
| `commands.spec.ts` | copy | Transfers files; the `-v` run log shows `Copied` and the filenames |
| `commands.spec.ts` | sync | Mirrors source to destination, deleting an extra file in the destination (handles the confirm dialog) |
| `commands.spec.ts` | move | Moves files into the destination and leaves the source empty (handles the confirm dialog) |
| `commands.spec.ts` | check | Exits `0` when source and destination already match |
| `commands.spec.ts` | lsf | One-sided listing; the run log shows the source filenames |
| `b2-copy-job.spec.ts` *(opt-in)* | B2 copy | Copies a folder to another folder in one B2 bucket and verifies the destination listing |

Run with a visible browser for debugging:

```bash
npm run test:headed
```

### Optional B2 bucket copy test

`e2e/tests/b2-copy-job.spec.ts` exercises a real Backblaze B2 copy (folder →
folder within one bucket). It is **opt-in** and **skipped** unless credentials
are present, so the default `npm test` stays hermetic (local-only).

To enable it, copy `e2e/.env.local.example` to `e2e/.env.local` (gitignored) and
fill in a B2 application key plus a throwaway bucket (`RCLONEWEB_` is just a
namespace prefix — it stands for rclone-web):

```
RCLONEWEB_E2E_B2_ACCOUNT=<b2 keyID>
RCLONEWEB_E2E_B2_KEY=<b2 applicationKey>
RCLONEWEB_E2E_B2_SRC_BUCKET=rclone-web-e2e-tests
RCLONEWEB_E2E_B2_DST_BUCKET=rclone-web-e2e-tests
# RCLONEWEB_E2E_B2_PREFIX is optional and defaults to "e2e"
```

Source and destination use the same bucket but distinct sub-paths
(`<bucket>/<prefix>/src` and `<bucket>/<prefix>/dst`), so set both bucket vars to
the same name. When `.env.local` is present, global-setup adds a `b2` provider +
"E2E B2 Copy" job to the generated config, **purges** both sub-paths, and
**seeds** the src path with the fixture files. The spec runs the job via the UI,
asserts `success · exit 0`, then verifies the dst path lists the copied files.
Global-teardown purges both sub-paths afterward. The test only ever touches the
`<bucket>/<prefix>/{src,dst}` paths.
