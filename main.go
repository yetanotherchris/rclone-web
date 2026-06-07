package main

import (
	"bufio"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

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

func newServeFlags() *flag.FlagSet {
	defaults := config.DefaultConfig()
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	fs.String("config", defaultAgeConfig(), "Path to age-encrypted config")
	fs.Int("port", defaults.Port, "HTTP port (falls back to a random free port if in use; 0 = always random)")
	fs.String("bind", defaults.BindAddr, "Bind address")
	fs.Int("idle-timeout", defaults.IdleTimeoutSeconds, "Idle timeout in seconds (ignored with --key-file)")
	fs.String("rclone-path", defaults.RclonePath, "Path to rclone binary (default assumes rclone is on $PATH)")
	fs.String("key-file", "", "Path to file containing the passphrase; skips browser unlock and disables idle lock")
	return fs
}

func newRunFlags() *flag.FlagSet {
	fs := flag.NewFlagSet("run", flag.ExitOnError)
	fs.String("config", defaultAgeConfig(), "Path to age-encrypted config")
	fs.String("key-file", "", "Path to file containing the passphrase (required)")
	fs.String("job-id", "", "ID of the job to run")
	fs.String("queue-id", "", "ID of the queue to run")
	fs.String("rclone-path", config.DefaultConfig().RclonePath, "Path to rclone binary")
	return fs
}

func printFlagDefaults(fs *flag.FlagSet) {
	var buf strings.Builder
	fs.SetOutput(&buf)
	fs.PrintDefaults()
	// flag package prints "  -name" — replace with "  --name"
	out := strings.ReplaceAll(buf.String(), "\n  -", "\n  --")
	if strings.HasPrefix(out, "  -") {
		out = "  --" + out[3:]
	}
	fmt.Print(out)
}

func printHelp() {
	fmt.Printf("rclone-web %s\n", version)
	fmt.Println()
	fmt.Println("A web UI for managing and running rclone jobs, protected by an age-encrypted YAML config file.")
	fmt.Println()
	fmt.Println("Usage:")
	fmt.Println("  rclone-web [serve flags]     Start the HTTP server (default command)")
	fmt.Println("  rclone-web init [flags]      Create or verify the encrypted config file")
	fmt.Println("  rclone-web run [flags]       Run a job or queue without starting the server")
	fmt.Println("  rclone-web version           Print the version and exit")
	fmt.Println()
	fmt.Println("Serve flags:")
	printFlagDefaults(newServeFlags())
	fmt.Println()
	fmt.Println("Run flags:")
	printFlagDefaults(newRunFlags())
}

func main() {
	flag.Usage = func() { printHelp() }

	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "help", "--help", "-h":
			printHelp()
			return
		case "init":
			if err := runInit(os.Args[2:]); err != nil {
				log.Fatalf("init: %v", err)
			}
			return
		case "run":
			if err := runRun(os.Args[2:]); err != nil {
				log.Fatalf("run: %v", err)
			}
			return
		case "version", "--version", "-version":
			fmt.Printf("rclone-web %s\n", version)
			return
		}
	}
	runServe()
}

// ---- init subcommand ----

func runInit(args []string) error {
	fs := flag.NewFlagSet("init", flag.ExitOnError)
	ageCfgFlag := fs.String("config", defaultAgeConfig(), "Path to age-encrypted config")
	fs.Parse(args)

	ageCfgPath := *ageCfgFlag
	if err := os.MkdirAll(filepath.Dir(ageCfgPath), 0700); err != nil {
		return fmt.Errorf("create config dir: %w", err)
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

// ---- serve subcommand ----

func runServe() {
	defaults := config.DefaultConfig()
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	fs.Usage = func() { printHelp() }

	ageCfgFlag := fs.String("config", defaultAgeConfig(), "Path to age-encrypted config")
	portFlag := fs.Int("port", defaults.Port, "HTTP port (falls back to a random free port if in use; 0 = always random)")
	bindFlag := fs.String("bind", defaults.BindAddr, "Bind address")
	idleFlag := fs.Int("idle-timeout", defaults.IdleTimeoutSeconds, "Idle timeout in seconds (ignored with --key-file)")
	rcloneFlag := fs.String("rclone-path", defaults.RclonePath, "Path to rclone binary (default assumes rclone is on $PATH)")
	keyFileFlag := fs.String("key-file", "", "Path to file containing the passphrase; skips browser unlock and disables idle lock")
	fs.Parse(os.Args[1:])

	cfg := &config.AppConfig{
		ConfigPath:         *ageCfgFlag,
		Port:               *portFlag,
		BindAddr:           *bindFlag,
		IdleTimeoutSeconds: *idleFlag,
		RclonePath:         *rcloneFlag,
	}

	store := creds.New()

	// Detect short-password mode: check if a credential store entry exists and
	// parse the prefix length from the stored "N:suffix" value.
	shortLen := 0
	{
		key := creds.CredKey(*ageCfgFlag)
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

	if *keyFileFlag != "" {
		if *bindFlag != "127.0.0.1" && *bindFlag != "localhost" && *bindFlag != "::1" {
			log.Printf("WARNING: --key-file disables authentication; binding to %s exposes the server to the network with no login required", *bindFlag)
		}
		raw, err := os.ReadFile(*keyFileFlag)
		if err != nil {
			log.Fatalf("read key file %s: %v", *keyFileFlag, err)
		}
		passphrase := strings.TrimRight(string(raw), "\r\n")
		if err := srv.AutoUnlock(passphrase); err != nil {
			log.Fatalf("auto-unlock with key file: %v", err)
		}
	}

	addr, err := srv.Start()
	if err != nil {
		log.Fatalf("start server: %v", err)
	}

	url := fmt.Sprintf("http://%s", addr)
	fmt.Printf("rclone-web listening on %s\n", url)
	// Key-file mode is for daemon/service (and e2e) use — don't pop a browser.
	if *keyFileFlag == "" {
		openBrowser(url)
	}

	// Block forever.
	select {}
}

// ---- run subcommand ----

// runRun executes a single job or queue without starting the HTTP server.
// It requires --key-file for authentication and pipes rclone output to stdout.
func runRun(args []string) error {
	fs := flag.NewFlagSet("run", flag.ExitOnError)
	configFlag := fs.String("config", defaultAgeConfig(), "Path to age-encrypted config")
	keyFileFlag := fs.String("key-file", "", "Path to file containing the passphrase (required)")
	jobIDFlag := fs.String("job-id", "", "ID of the job to run")
	queueIDFlag := fs.String("queue-id", "", "ID of the queue to run")
	rcloneFlag := fs.String("rclone-path", config.DefaultConfig().RclonePath, "Path to rclone binary")
	fs.Parse(args)

	if *keyFileFlag == "" {
		return fmt.Errorf("--key-file is required for the run subcommand")
	}
	if *jobIDFlag == "" && *queueIDFlag == "" {
		return fmt.Errorf("one of --job-id or --queue-id is required")
	}
	if *jobIDFlag != "" && *queueIDFlag != "" {
		return fmt.Errorf("--job-id and --queue-id are mutually exclusive")
	}

	raw, err := os.ReadFile(*keyFileFlag)
	if err != nil {
		return fmt.Errorf("read key file: %w", err)
	}
	passphrase := strings.TrimRight(string(raw), "\r\n")

	data, err := secret.Decrypt(*configFlag, passphrase)
	if err != nil {
		return fmt.Errorf("decrypt config: %w", err)
	}
	cfg, err := config.ParseConfig(data)
	if err != nil {
		return fmt.Errorf("parse config: %w", err)
	}

	src := &remotes.EnvVarSource{}

	if *jobIDFlag != "" {
		return headlessRunJob(cfg, src, *rcloneFlag, *jobIDFlag)
	}
	return headlessRunQueue(cfg, src, *rcloneFlag, *queueIDFlag)
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

	argv, err := remotes.AssembleArgv(src, cfg, job, false)
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

		argv, err := remotes.AssembleArgv(src, cfg, job, false)
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
