package remotes

import (
	"fmt"
	"strings"

	"github.com/yetanotherchris/rclone-web/internal/config"
)

// EnvVarSource implements the env-var provider strategy: each provider key
// becomes RCLONE_CONFIG_<NAME>_<KEY>.
type EnvVarSource struct{}

// Env returns the environment variable slice for a run.
func (e *EnvVarSource) Env(providers map[string]config.Provider) []string {
	var env []string
	for name, p := range providers {
		prefix := fmt.Sprintf("RCLONE_CONFIG_%s_", strings.ToUpper(name))
		env = append(env, prefix+"TYPE="+p.Type)
		for k, v := range p.Extra {
			env = append(env, prefix+strings.ToUpper(k)+"="+v)
		}
	}
	return env
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
func AssembleArgv(
	src *EnvVarSource,
	cfg *config.RcloneConfig,
	job *config.Job,
	dryRun bool,
) ([]string, error) {
	if job.SourcePath == "" {
		return nil, fmt.Errorf("job %q has no source", job.DisplayName())
	}

	cmd := job.Command
	if cmd == "" {
		cmd = "sync"
	}

	argv := []string{cmd, buildRemote(src, cfg, job.SourceProvider, job.SourcePath)}

	if !IsOneSided(cmd) {
		if job.DestPath == "" {
			return nil, fmt.Errorf("job %q has no destination", job.DisplayName())
		}
		argv = append(argv, buildRemote(src, cfg, job.DestProvider, job.DestPath))
	}

	if cfg.Rclone.Flags != "" {
		argv = append(argv, strings.Fields(cfg.Rclone.Flags)...)
	}
	if job.ExtraArgs != "" {
		argv = append(argv, strings.Fields(job.ExtraArgs)...)
	}
	if dryRun {
		argv = append(argv, "--dry-run")
	}

	return argv, nil
}

// IsOneSided reports whether a command takes only a single remote (no destination).
func IsOneSided(cmd string) bool {
	switch cmd {
	case "lsf", "ls", "lsl", "lsjson", "lsd":
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
