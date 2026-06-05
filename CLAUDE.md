# rclone-web

A web UI for managing and running rclone jobs, protected by an age-encrypted YAML config file.

## What it is

rclone-web is a small Go HTTP server that:
- Stores job definitions and cloud provider credentials in a **YAML file encrypted with [age](https://age-encryption.org/)** (`rcloneweb.yml.age`)
- Serves a browser UI to unlock, manage jobs/providers, and trigger rclone runs
- Locks itself after an idle timeout, zeroing the passphrase from memory

The encrypted file is **not** an rclone native config file. It is a YAML file with rclone-web's own schema (`RcloneConfig` in `internal/config/model.go`) that happens to configure rclone jobs and providers. rclone itself is invoked as a subprocess with env-var credentials.

## Config files

Two files live under `~/.config/rcloneweb/`:

| File | Format | Contents |
|------|--------|----------|
| `rcloneweb.yml` | Plaintext YAML | App settings: bind address, port, idle timeout, rclone binary path, path to the encrypted file |
| `rcloneweb.yml.age` | age-encrypted YAML | Jobs and provider credentials |

The plaintext file contains no secrets. All secrets (provider keys, tokens) live inside the encrypted file.

## Short password (credential store)

During `init`, the user can opt into a short-password mode. They enter their full password, then choose a shorter prefix they'll type each time to unlock. The suffix (`fullPassword[len(short):]`) is stored in the OS credential store (macOS Keychain, Windows Credential Manager, Linux secret service).

At unlock time the server concatenates `userInput + storedSuffix` to reconstruct the full passphrase. If no credential store entry exists, the input is used directly as the full passphrase.

## Subcommands

- `rclone-web init` — interactive setup: creates config dirs, encrypts initial YAML, optionally stores credential store suffix
- `rclone-web` (no args) — starts the HTTP server, opens browser

## Key packages

| Package | Purpose |
|---------|---------|
| `internal/config` | AppConfig (plaintext settings) and RcloneConfig (encrypted YAML schema) |
| `internal/secret` | age encrypt/decrypt helpers |
| `internal/creds` | OS credential store abstraction |
| `internal/server` | HTTP handlers, session management, job/provider API |
| `internal/runner` | Subprocess management for rclone invocations |
| `internal/remotes` | Converts provider map to `RCLONE_CONFIG_*` env vars and assembles argv |
