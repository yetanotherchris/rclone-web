package main

import (
	"bufio"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/yetanotherchris/rclone-web/internal/config"
	"github.com/yetanotherchris/rclone-web/internal/creds"
	"github.com/yetanotherchris/rclone-web/internal/secret"
	"github.com/yetanotherchris/rclone-web/internal/server"
)


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
	if len(os.Args) > 1 && os.Args[1] == "init" {
		if err := runInit(os.Args[2:]); err != nil {
			log.Fatalf("init: %v", err)
		}
		return
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

	sc := bufio.NewScanner(os.Stdin)

	fmt.Print("Password: ")
	var passphrase string
	if sc.Scan() {
		passphrase = strings.TrimSpace(sc.Text())
	}
	fmt.Print("Confirm password: ")
	var confirm string
	if sc.Scan() {
		confirm = strings.TrimSpace(sc.Text())
	}
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

	fmt.Print("Enable short password (type only the first N chars to unlock)? (y/N): ")
	if sc.Scan() {
		if answer := strings.TrimSpace(strings.ToLower(sc.Text())); answer == "y" || answer == "yes" {
			fmt.Print("Short password: ")
			var short string
			if sc.Scan() {
				short = strings.TrimSpace(sc.Text())
			}
			if !strings.HasPrefix(passphrase, short) || len(short) == 0 {
				return fmt.Errorf("short password must be a non-empty prefix of the full password")
			}
			suffix := passphrase[len(short):]
			store := creds.New()
			key := creds.CredKey(ageCfgPath)
			if err := store.Set(key, suffix); err != nil {
				return fmt.Errorf("store suffix in credential store: %w", err)
			}
			fmt.Println("✓ Suffix saved to credential store.")
		}
	}

	return nil
}

// ---- serve subcommand ----

func runServe() {
	defaults := config.DefaultConfig()

	ageCfgFlag := flag.String("config", defaultAgeConfig(), "Path to age-encrypted config")
	portFlag := flag.Int("port", defaults.Port, "HTTP port (0 = random free port)")
	bindFlag := flag.String("bind", defaults.BindAddr, "Bind address")
	idleFlag := flag.Int("idle-timeout", defaults.IdleTimeoutSeconds, "Idle timeout in seconds (ignored with --key-file)")
	rcloneFlag := flag.String("rclone-path", defaults.RclonePath, "Path to rclone binary (default assumes rclone is on $PATH)")
	keyFileFlag := flag.String("key-file", "", "Path to file containing the passphrase; skips browser unlock and disables idle lock")
	flag.Parse()

	cfg := &config.AppConfig{
		ConfigPath:         *ageCfgFlag,
		Port:               *portFlag,
		BindAddr:           *bindFlag,
		IdleTimeoutSeconds: *idleFlag,
		RclonePath:         *rcloneFlag,
	}

	store := creds.New()

	assemblePassphrase := func(input string) (string, error) {
		key := creds.CredKey(cfg.ConfigPath)
		suffix, err := store.Get(key)
		if err != nil {
			return input, nil
		}
		return input + suffix, nil
	}

	srv := server.New(cfg, webFS(), assemblePassphrase)

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
	openBrowser(url)

	// Block forever.
	select {}
}
