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

// AssembleArgv builds the full rclone argument list for a job run (not a shell
// string — each token is a discrete argv element).
func AssembleArgv(
	src *EnvVarSource,
	cfg *config.RcloneConfig,
	job *config.Job,
	dryRun bool,
) ([]string, error) {
	if job.Command == "" {
		return nil, fmt.Errorf("job %q has no command", job.Name)
	}

	argv := []string{job.Command}

	// Source side
	srcProv, ok := cfg.Rclone.Providers[job.SourceProvider]
	if !ok && job.SourceProvider != "" {
		return nil, fmt.Errorf("source provider %q not found", job.SourceProvider)
	}
	argv = append(argv, src.Remote(srcProv, job.SourceProvider, job.SourcePath))

	// Destination side (omitted for one-sided verbs)
	if !IsOneSided(job.Command) {
		if job.DestProvider != "" {
			dstProv, ok := cfg.Rclone.Providers[job.DestProvider]
			if !ok {
				return nil, fmt.Errorf("destination provider %q not found", job.DestProvider)
			}
			argv = append(argv, src.Remote(dstProv, job.DestProvider, job.DestPath))
		} else {
			argv = append(argv, job.DestPath)
		}
	}

	// Global flags
	if cfg.Rclone.Flags != "" {
		argv = append(argv, strings.Fields(cfg.Rclone.Flags)...)
	}

	// Per-job extra args
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
