package main

import (
	"bufio"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/yetanotherchris/rclone-web/internal/config"
	"github.com/yetanotherchris/rclone-web/internal/creds"
	"github.com/yetanotherchris/rclone-web/internal/secret"
	"github.com/yetanotherchris/rclone-web/internal/server"
	"golang.org/x/term"
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
