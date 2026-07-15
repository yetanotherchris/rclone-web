package remotes

import (
	"fmt"
	"log"
	"strings"

	"github.com/yetanotherchris/rclone-web/internal/config"
	"github.com/yetanotherchris/rclone-web/internal/obscure"
)

// EnvVarSource implements the env-var provider strategy: each provider key
// becomes RCLONE_CONFIG_<NAME>_<KEY>.
type EnvVarSource struct {
	// PasswordFields maps backend type → field names that need obscuring.
	// Populated from rclone's backend schema (IsPassword / Sensitive flags).
	PasswordFields map[string]map[string]bool
}

// Env returns the environment variable slice for a run.
// Fields marked as password/sensitive in the backend schema are automatically
// obscured to match the format rclone expects for RCLONE_CONFIG_* env vars.
func (e *EnvVarSource) Env(providers map[string]config.Provider) []string {
	var env []string
	for name, p := range providers {
		prefix := fmt.Sprintf("RCLONE_CONFIG_%s_", strings.ToUpper(name))
		env = append(env, prefix+"TYPE="+p.Type)
		pwFields := e.PasswordFields[p.Type]
		for k, v := range p.Extra {
			if v != "" && pwFields[k] {
				obs, err := obscure.Obscure(v)
				if err != nil {
					log.Printf("obscure field %s.%s: %v", name, k, err)
				} else {
					v = obs
				}
			}
			env = append(env, prefix+strings.ToUpper(k)+"="+v)
		}
	}
	return env
}

// ParsePasswordFields builds a PasswordFields map from the JSON returned by
// "rclone config providers". Only fields with IsPassword set to true are
// included: rclone stores those obscured and reveals them itself at read time,
// so they must be obscured when passed as RCLONE_CONFIG_* env vars.
//
// Fields marked only Sensitive must NOT be obscured. Sensitive is purely a
// "redact in logs/`config show`" hint and says nothing about the on-disk or
// on-wire encoding; rclone consumes those values raw. Obscuring them breaks the
// backend — e.g. drive's "token" is Sensitive (not IsPassword) and is
// json.Unmarshal'd directly, so an obscured blob yields
// "invalid character ... looking for beginning of value".
func ParsePasswordFields(backends []map[string]interface{}) map[string]map[string]bool {
	result := make(map[string]map[string]bool)
	for _, b := range backends {
		name, _ := b["Name"].(string)
		if name == "" {
			continue
		}
		opts, _ := b["Options"].([]interface{})
		for _, o := range opts {
			opt, _ := o.(map[string]interface{})
			fieldName, _ := opt["Name"].(string)
			isPassword, _ := opt["IsPassword"].(bool)
			if fieldName != "" && isPassword {
				if result[name] == nil {
					result[name] = make(map[string]bool)
				}
				result[name][fieldName] = true
			}
		}
	}
	return result
}

// Remote formats the rclone remote argument for one side of a job.
// Providers of type "local" emit the bare path; all others use "<name>:<path>".
func (e *EnvVarSource) Remote(p config.Provider, name, path string) string {
	if p.Type == "local" || p.Type == "" {
		return path
	}
	return name + ":" + path
}

// buildRemote resolves one side of a job into a rclone remote argument.
// If providerName is empty the path is used as-is (bare local path).
// If the named provider is not found it falls back to "name:path".
func buildRemote(src *EnvVarSource, cfg *config.RcloneConfig, providerName, path string) string {
	if providerName == "" {
		return path
	}
	p, ok := cfg.Rclone.Providers[providerName]
	if !ok {
		return providerName + ":" + path
	}
	return src.Remote(p, providerName, path)
}

// AssembleArgv builds the full rclone argument list for a job run (not a shell
// string — each token is a discrete argv element). Command defaults to "sync"
// when not set.
//
// resync requests "--resync" for a "bisync" job (establishing/re-establishing
// the baseline on the first run). It is a per-run choice, not part of the
// job's persisted config, and is ignored for any other command.
func AssembleArgv(
	src *EnvVarSource,
	cfg *config.RcloneConfig,
	job *config.Job,
	dryRun bool,
	resync bool,
) ([]string, error) {
	// A blank path is only invalid for a bare local path (no provider) — there's
	// nothing to run rclone against. For a named provider, a blank path is valid
	// and means the remote's root (e.g. "b2notescrypt:").
	if job.SourceProvider == "" && job.SourcePath == "" {
		return nil, fmt.Errorf("job %q has no source", job.DisplayName())
	}

	cmd := job.Command
	if cmd == "" {
		cmd = "sync"
	}

	argv := []string{cmd, buildRemote(src, cfg, job.SourceProvider, job.SourcePath)}

	if !IsOneSided(cmd) {
		if job.DestProvider == "" && job.DestPath == "" {
			return nil, fmt.Errorf("job %q has no destination", job.DisplayName())
		}
		argv = append(argv, buildRemote(src, cfg, job.DestProvider, job.DestPath))
	}

	if cmd == "bisync" {
		if resync {
			argv = append(argv, "--resync")
			if job.ResyncMode != "" {
				argv = append(argv, "--resync-mode", job.ResyncMode)
			}
		}
		if job.ConflictResolve != "" {
			argv = append(argv, "--conflict-resolve", job.ConflictResolve)
		}
	}

	if job.BackupDir != "" && supportsBackupDir(cmd) {
		argv = append(argv, "--backup-dir", job.BackupDir)
	}

	if cfg.Rclone.Flags != "" {
		argv = append(argv, strings.Fields(cfg.Rclone.Flags)...)
	}
	if job.ExtraArgs != "" {
		argv = append(argv, strings.Fields(job.ExtraArgs)...)
	}

	// rclone's transfer commands (copy/sync/move/…) print nothing on success
	// unless asked to. Inject a default "-v" so every run produces a visible log,
	// but never override an explicit verbosity choice the user already supplied.
	if !argvHasVerbosityFlag(argv) {
		argv = append(argv, "-v")
	}

	if dryRun {
		argv = append(argv, "--dry-run")
	}

	return argv, nil
}

// argvHasVerbosityFlag reports whether the assembled args already control
// rclone's log output (verbosity, quiet, progress, stats, or log-level), in
// which case the default "-v" should not be added.
func argvHasVerbosityFlag(argv []string) bool {
	for _, arg := range argv {
		switch {
		case arg == "-P",
			strings.HasPrefix(arg, "--verbose"),
			strings.HasPrefix(arg, "--quiet"),
			strings.HasPrefix(arg, "--progress"),
			strings.HasPrefix(arg, "--stats"),
			strings.HasPrefix(arg, "--log-level"):
			return true
		}
		// Short flags: a single-dash token like "-v", "-vv", "-q", or a bundle
		// such as "-Pv" that contains v or q. Long "--" flags are excluded so
		// "--verbose" isn't matched here (it's handled above).
		if strings.HasPrefix(arg, "-") && !strings.HasPrefix(arg, "--") {
			if strings.ContainsAny(arg, "vq") {
				return true
			}
		}
	}
	return false
}

// IsOneSided reports whether a command takes only a single remote (no destination).
func IsOneSided(cmd string) bool {
	switch cmd {
	case "lsf", "ls", "lsl", "lsjson", "lsd":
		return true
	}
	return false
}

// supportsBackupDir reports whether cmd accepts rclone's --backup-dir flag.
func supportsBackupDir(cmd string) bool {
	switch cmd {
	case "sync", "move", "bisync":
		return true
	}
	return false
}

// RedactedCmdline returns the assembled command as a human-readable string
// safe to display (no secret values — only remote names and paths).
func RedactedCmdline(rclonePath string, argv []string) string {
	parts := append([]string{rclonePath}, argv...)
	return strings.Join(parts, " ")
}
