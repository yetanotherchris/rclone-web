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
