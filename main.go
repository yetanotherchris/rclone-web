package main

import (
	"bufio"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"filippo.io/age"
	"github.com/spf13/cobra"
	"github.com/yetanotherchris/rclone-web/internal/config"
	"github.com/yetanotherchris/rclone-web/internal/creds"
	"github.com/yetanotherchris/rclone-web/internal/remotes"
	"github.com/yetanotherchris/rclone-web/internal/secret"
	"github.com/yetanotherchris/rclone-web/internal/server"
	"golang.org/x/term"
)

// version is set at build time via -ldflags "-X main.version=...".
var version = "dev"

func appConfigDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "."
	}
	return filepath.Join(home, ".config", "rcloneweb")
}

func defaultAgeConfig() string {
	return filepath.Join(appConfigDir(), "rcloneweb.yml.age")
}

func main() {
	root := &cobra.Command{
		Use:     "rclone-web",
		Short:   "A web UI for managing and running rclone jobs",
		Long:    "A web UI for managing and running rclone jobs, protected by an age-encrypted YAML config file.",
		Version: version,
		RunE:    serveCmd,
	}

	defaults := config.DefaultConfig()
	root.Flags().String("config", defaultAgeConfig(), "Path to age-encrypted config")
	root.Flags().Int("port", defaults.Port, "HTTP port (falls back to a random free port if in use; 0 = always random)")
	root.Flags().String("bind", defaults.BindAddr, "Bind address")
	root.Flags().Int("idle-timeout", defaults.IdleTimeoutSeconds, "Idle timeout in seconds (ignored with --key-file)")
	root.Flags().String("rclone-path", "", "Path to rclone binary (default: assumes rclone is on $PATH)")
	root.Flags().String("key-file", "", "Path to file containing the passphrase; skips browser unlock and disables idle lock")

	initCmd := &cobra.Command{
		Use:   "init",
		Short: "Create or verify the encrypted config file",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfgPath, _ := cmd.Flags().GetString("config")
			keyFile, _ := cmd.Flags().GetString("key-file")
			return runInit(cfgPath, keyFile)
		},
	}
	initCmd.Flags().String("config", defaultAgeConfig(), "Path to age-encrypted config")
	initCmd.Flags().String("key-file", "", "Path to an age identity file (AGE-SECRET-KEY-1…) to use instead of a passphrase")

	runCmd := &cobra.Command{
		Use:   "run",
		Short: "Run a job or queue without starting the server",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfgPath, _ := cmd.Flags().GetString("config")
			keyFile, _ := cmd.Flags().GetString("key-file")
			jobID, _ := cmd.Flags().GetString("job-id")
			queueID, _ := cmd.Flags().GetString("queue-id")
			rclonePath, _ := cmd.Flags().GetString("rclone-path")
			if rclonePath == "" {
				rclonePath = "rclone"
			}
			return runRun(cfgPath, keyFile, jobID, queueID, rclonePath)
		},
	}
	runCmd.Flags().String("config", defaultAgeConfig(), "Path to age-encrypted config")
	runCmd.Flags().String("key-file", "", "Path to file containing the passphrase (required)")
	runCmd.Flags().String("job-id", "", "ID of the job to run")
	runCmd.Flags().String("queue-id", "", "ID of the queue to run")
	runCmd.Flags().String("rclone-path", "", "Path to rclone binary (default: assumes rclone is on $PATH)")

	generateKeyCmd := &cobra.Command{
		Use:   "generate-key",
		Short: "Generate an age key pair and save it to key.age in the current directory",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runGenerateKey()
		},
	}

	root.AddCommand(initCmd, runCmd, generateKeyCmd)

	if err := root.Execute(); err != nil {
		os.Exit(1)
	}
}

// ---- serve (root command) ----

func serveCmd(cmd *cobra.Command, args []string) error {
	ageCfgPath, _ := cmd.Flags().GetString("config")
	port, _ := cmd.Flags().GetInt("port")
	bind, _ := cmd.Flags().GetString("bind")
	idleTimeout, _ := cmd.Flags().GetInt("idle-timeout")
	rclonePath, _ := cmd.Flags().GetString("rclone-path")
	keyFile, _ := cmd.Flags().GetString("key-file")

	if rclonePath == "" {
		rclonePath = "rclone"
	}

	cfg := &config.AppConfig{
		ConfigPath:         ageCfgPath,
		Port:               port,
		BindAddr:           bind,
		IdleTimeoutSeconds: idleTimeout,
		RclonePath:         rclonePath,
	}

	store := creds.New()

	// Detect short-password mode: check if a credential store entry exists and
	// parse the prefix length from the stored "N:suffix" value.
	shortLen := 0
	{
		key := creds.CredKey(ageCfgPath)
		if val, err := store.Get(key); err == nil {
			if idx := strings.IndexByte(val, ':'); idx > 0 {
				if n, err2 := strconv.Atoi(val[:idx]); err2 == nil && n > 0 {
					shortLen = n
				}
			}
			if shortLen == 0 {
				shortLen = 4 // backward compat: old format stored suffix without length prefix
			}
		}
	}

	assemblePassphrase := func(input string) (string, error) {
		key := creds.CredKey(cfg.ConfigPath)
		val, err := store.Get(key)
		if err != nil {
			return input, nil
		}
		// New format: "N:suffix"
		if idx := strings.IndexByte(val, ':'); idx > 0 {
			if _, err2 := strconv.Atoi(val[:idx]); err2 == nil {
				return input + val[idx+1:], nil
			}
		}
		// Old format: raw suffix
		return input + val, nil
	}

	srv := server.New(cfg, webFS(), assemblePassphrase, shortLen)

	if keyFile != "" {
		if bind != "127.0.0.1" && bind != "localhost" && bind != "::1" {
			log.Printf("WARNING: --key-file disables authentication; binding to %s exposes the server to the network with no login required", bind)
		}
		raw, err := os.ReadFile(keyFile)
		if err != nil {
			return fmt.Errorf("read key file %s: %w", keyFile, err)
		}
		passphrase := strings.TrimRight(string(raw), "\r\n")
		if err := srv.AutoUnlock(passphrase); err != nil {
			return fmt.Errorf("auto-unlock with key file: %w", err)
		}
	}

	addr, err := srv.Start()
	if err != nil {
		return fmt.Errorf("start server: %w", err)
	}

	url := fmt.Sprintf("http://%s", addr)
	fmt.Printf("rclone-web listening on %s\n", url)
	// Key-file mode is for daemon/service (and e2e) use — don't pop a browser.
	if keyFile == "" {
		openBrowser(url)
	}

	// Block forever.
	select {}
}

// ---- init subcommand ----

func runInit(ageCfgPath, keyFile string) error {
	if err := os.MkdirAll(filepath.Dir(ageCfgPath), 0700); err != nil {
		return fmt.Errorf("create config dir: %w", err)
	}

	if keyFile != "" {
		return runInitWithKeyFile(ageCfgPath, keyFile)
	}

	fmt.Print("Password: ")
	pw, err := term.ReadPassword(int(os.Stdin.Fd()))
	if err != nil {
		return fmt.Errorf("read password: %w", err)
	}
	fmt.Println()
	passphrase := strings.TrimSpace(string(pw))

	fmt.Print("Confirm password: ")
	pw2, err := term.ReadPassword(int(os.Stdin.Fd()))
	if err != nil {
		return fmt.Errorf("read password: %w", err)
	}
	fmt.Println()
	confirm := strings.TrimSpace(string(pw2))

	if passphrase != confirm {
		return fmt.Errorf("passwords do not match")
	}

	_, statErr := os.Stat(ageCfgPath)
	if errors.Is(statErr, os.ErrNotExist) {
		emptyCfg := config.EmptyRcloneConfig()
		initialYAML, err := config.MarshalConfig(emptyCfg)
		if err != nil {
			return fmt.Errorf("marshal initial config: %w", err)
		}
		if err := secret.Encrypt(ageCfgPath, passphrase, initialYAML); err != nil {
			return fmt.Errorf("create encrypted config: %w", err)
		}
		fmt.Printf("✓ Created encrypted config at %s\n", ageCfgPath)
	} else {
		if _, err := secret.Decrypt(ageCfgPath, passphrase); err != nil {
			return fmt.Errorf("passphrase did not decrypt config: %w", err)
		}
		fmt.Println("✓ Config decrypted successfully.")
	}

	sc := bufio.NewScanner(os.Stdin)

	fmt.Print("Enable short password (type only the first N chars to unlock)? (y/N): ")
	if sc.Scan() {
		if answer := strings.TrimSpace(strings.ToLower(sc.Text())); answer == "y" || answer == "yes" {
			fmt.Print("How many characters do you wish to type? (default 4): ")
			n := 4
			if sc.Scan() {
				if s := strings.TrimSpace(sc.Text()); s != "" {
					parsed, parseErr := strconv.Atoi(s)
					if parseErr != nil || parsed <= 0 {
						return fmt.Errorf("invalid number of characters: %q", s)
					}
					n = parsed
				}
			}
			if n >= len(passphrase) {
				return fmt.Errorf("short password length (%d) must be less than full password length (%d)", n, len(passphrase))
			}
			suffix := passphrase[n:]
			store := creds.New()
			key := creds.CredKey(ageCfgPath)
			if err := store.Set(key, fmt.Sprintf("%d:%s", n, suffix)); err != nil {
				return fmt.Errorf("store suffix in credential store: %w", err)
			}
			fmt.Printf("✓ Short password set to first %d character(s). Suffix saved to credential store.\n", n)
		}
	}

	return nil
}

func runInitWithKeyFile(ageCfgPath, keyFile string) error {
	raw, err := os.ReadFile(keyFile)
	if err != nil {
		return fmt.Errorf("read key file: %w", err)
	}
	credential := string(raw)
	if !secret.IsAgeIdentityContent(credential) {
		return fmt.Errorf("key file %s does not contain an age identity (AGE-SECRET-KEY-1…); use generate-key to create one", keyFile)
	}

	_, statErr := os.Stat(ageCfgPath)
	if errors.Is(statErr, os.ErrNotExist) {
		emptyCfg := config.EmptyRcloneConfig()
		initialYAML, err := config.MarshalConfig(emptyCfg)
		if err != nil {
			return fmt.Errorf("marshal initial config: %w", err)
		}
		if err := secret.EncryptAuto(ageCfgPath, credential, initialYAML); err != nil {
			return fmt.Errorf("create encrypted config: %w", err)
		}
		fmt.Printf("✓ Created encrypted config at %s\n", ageCfgPath)
	} else {
		if _, err := secret.DecryptAuto(ageCfgPath, credential); err != nil {
			return fmt.Errorf("key file did not decrypt config: %w", err)
		}
		fmt.Println("✓ Config decrypted successfully.")
	}
	return nil
}

// ---- run subcommand ----

func runRun(cfgPath, keyFile, jobID, queueID, rclonePath string) error {
	if keyFile == "" {
		return fmt.Errorf("--key-file is required for the run subcommand")
	}
	if jobID == "" && queueID == "" {
		return fmt.Errorf("one of --job-id or --queue-id is required")
	}
	if jobID != "" && queueID != "" {
		return fmt.Errorf("--job-id and --queue-id are mutually exclusive")
	}

	raw, err := os.ReadFile(keyFile)
	if err != nil {
		return fmt.Errorf("read key file: %w", err)
	}
	passphrase := strings.TrimRight(string(raw), "\r\n")

	data, err := secret.DecryptAuto(cfgPath, passphrase)
	if err != nil {
		return fmt.Errorf("decrypt config: %w", err)
	}
	cfg, err := config.ParseConfig(data)
	if err != nil {
		return fmt.Errorf("parse config: %w", err)
	}

	src := &remotes.EnvVarSource{}

	if jobID != "" {
		return headlessRunJob(cfg, src, rclonePath, jobID)
	}
	return headlessRunQueue(cfg, src, rclonePath, queueID)
}

func headlessRunJob(cfg *config.RcloneConfig, src *remotes.EnvVarSource, rclonePath, jobID string) error {
	var job *config.Job
	for i := range cfg.Rclone.Jobs {
		if cfg.Rclone.Jobs[i].ID == jobID {
			job = &cfg.Rclone.Jobs[i]
			break
		}
	}
	if job == nil {
		return fmt.Errorf("job %q not found", jobID)
	}

	argv, err := remotes.AssembleArgv(src, cfg, job, false, false)
	if err != nil {
		return fmt.Errorf("assemble argv: %w", err)
	}

	extraEnv := src.Env(cfg.Rclone.Providers)
	cmd := exec.Command(rclonePath, argv...)
	cmd.Env = append(os.Environ(), extraEnv...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stdout

	fmt.Printf("Running job %q (%s)\n", job.DisplayName(), jobID)
	if err := cmd.Run(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			os.Exit(exitErr.ExitCode())
		}
		return fmt.Errorf("rclone: %w", err)
	}
	return nil
}

func headlessRunQueue(cfg *config.RcloneConfig, src *remotes.EnvVarSource, rclonePath, queueID string) error {
	var queue *config.Queue
	for i := range cfg.Rclone.Queues {
		if cfg.Rclone.Queues[i].ID == queueID {
			queue = &cfg.Rclone.Queues[i]
			break
		}
	}
	if queue == nil {
		return fmt.Errorf("queue %q not found", queueID)
	}

	jobMap := make(map[string]*config.Job, len(cfg.Rclone.Jobs))
	for i := range cfg.Rclone.Jobs {
		jobMap[cfg.Rclone.Jobs[i].ID] = &cfg.Rclone.Jobs[i]
	}

	fmt.Printf("Running queue %q (%s) — %d job(s)\n", queue.Name, queueID, len(queue.JobIDs))

	queueFailed := false
	for _, jid := range queue.JobIDs {
		job, ok := jobMap[jid]
		if !ok {
			fmt.Fprintf(os.Stderr, "warning: job %q not found in config, skipping\n", jid)
			if queue.OnFailure == "stop" {
				queueFailed = true
				break
			}
			queueFailed = true
			continue
		}

		argv, err := remotes.AssembleArgv(src, cfg, job, false, false)
		if err != nil {
			fmt.Fprintf(os.Stderr, "error: assemble argv for job %q: %v\n", jid, err)
			if queue.OnFailure == "stop" {
				queueFailed = true
				break
			}
			queueFailed = true
			continue
		}

		extraEnv := src.Env(cfg.Rclone.Providers)
		cmd := exec.Command(rclonePath, argv...)
		cmd.Env = append(os.Environ(), extraEnv...)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stdout

		fmt.Printf("\n--- Job %q (%s) ---\n", job.DisplayName(), jid)
		if runErr := cmd.Run(); runErr != nil {
			fmt.Fprintf(os.Stderr, "job %q failed: %v\n", jid, runErr)
			queueFailed = true
			if queue.OnFailure == "stop" {
				break
			}
		}
	}

	if queueFailed {
		os.Exit(1)
	}
	return nil
}

// ---- generate-key subcommand ----

func runGenerateKey() error {
	identity, err := age.GenerateX25519Identity()
	if err != nil {
		return fmt.Errorf("generate age key: %w", err)
	}

	outPath := "key.age"
	keyContent := fmt.Sprintf("# public key: %s\n%s\n", identity.Recipient().String(), identity.String())

	if err := os.WriteFile(outPath, []byte(keyContent), 0600); err != nil {
		return fmt.Errorf("write key file: %w", err)
	}

	fmt.Printf("✓ Generated age key saved to %s\n", outPath)
	fmt.Printf("  Public key: %s\n", identity.Recipient().String())
	return nil
}
