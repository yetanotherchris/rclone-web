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

func defaultConfigFile() string {
	return filepath.Join(appConfigDir(), "rclone-web.yml")
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
	configDir := appConfigDir()
	defaultRcloneConfig := filepath.Join(configDir, "rclone.conf.age")
	rcloneConfigFlag := fs.String("rclone-config", defaultRcloneConfig, "Path to age-encrypted rclone config")
	fs.Parse(args)

	if err := os.MkdirAll(configDir, 0700); err != nil {
		return fmt.Errorf("create config dir %s: %w", configDir, err)
	}

	cfg := config.DefaultConfig()
	cfg.ConfigPath = *rcloneConfigFlag
	sc := bufio.NewScanner(os.Stdin)

	prompt := func(label, def string) string {
		if def != "" {
			fmt.Printf("%s [%s]: ", label, def)
		} else {
			fmt.Printf("%s: ", label)
		}
		if !sc.Scan() {
			return def
		}
		v := strings.TrimSpace(sc.Text())
		if v == "" {
			return def
		}
		return v
	}

	appConfigFile := defaultConfigFile()
	if _, err := os.Stat(appConfigFile); err == nil {
		fmt.Printf("Config already exists at %s.\nRunning init will overwrite it. Continue? (y/N): ", appConfigFile)
		if sc.Scan() {
			answer := strings.TrimSpace(strings.ToLower(sc.Text()))
			if answer != "y" && answer != "yes" {
				return fmt.Errorf("init cancelled")
			}
		} else {
			return fmt.Errorf("init cancelled")
		}
	}

	mode := prompt("Password mode (prefix/full)", cfg.PasswordMode)
	if mode != "prefix" && mode != "full" {
		mode = "prefix"
	}
	cfg.PasswordMode = mode

	if mode == "prefix" {
		pl := cfg.PrefixLength
		fmt.Printf("Prefix length (min 3) [%d]: ", pl)
		if sc.Scan() {
			var n int
			if cnt, _ := fmt.Sscanf(strings.TrimSpace(sc.Text()), "%d", &n); cnt == 1 && n >= 3 {
				pl = n
			}
		}
		cfg.PrefixLength = pl
	}

	idle := cfg.IdleTimeoutSeconds
	fmt.Printf("Idle timeout in seconds (min 30) [%d]: ", idle)
	if sc.Scan() {
		var n int
		if cnt, _ := fmt.Sscanf(strings.TrimSpace(sc.Text()), "%d", &n); cnt == 1 && n >= 30 {
			idle = n
		}
	}
	cfg.IdleTimeoutSeconds = idle

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

	_, statErr := os.Stat(cfg.ConfigPath)
	if errors.Is(statErr, os.ErrNotExist) {
		emptyCfg := config.EmptyRcloneConfig()
		initialYAML, err := config.MarshalConfig(emptyCfg)
		if err != nil {
			return fmt.Errorf("marshal initial config: %w", err)
		}
		if err := secret.Encrypt(cfg.ConfigPath, passphrase, initialYAML); err != nil {
			return fmt.Errorf("create encrypted config: %w", err)
		}
		fmt.Printf("✓ Created encrypted config at %s\n", cfg.ConfigPath)
	} else {
		if _, err := secret.Decrypt(cfg.ConfigPath, passphrase); err != nil {
			return fmt.Errorf("passphrase did not decrypt config: %w", err)
		}
		fmt.Println("✓ Config decrypted successfully.")
	}

	if mode == "prefix" {
		if len(passphrase) <= cfg.PrefixLength {
			return fmt.Errorf("passphrase must be longer than prefixLength (%d)", cfg.PrefixLength)
		}
		suffix := passphrase[cfg.PrefixLength:]
		store := creds.New()
		key := creds.CredKey(cfg.ConfigPath)
		if err := store.Set(key, suffix); err != nil {
			return fmt.Errorf("store suffix in credential store: %w", err)
		}
		fmt.Println("✓ Suffix saved to credential store.")
	}

	if err := cfg.Save(appConfigFile); err != nil {
		return fmt.Errorf("write %s: %w", appConfigFile, err)
	}
	fmt.Printf("✓ Wrote %s\n", appConfigFile)
	return nil
}

// ---- serve subcommand ----

func runServe() {
	portFlag := flag.Int("port", 0, "HTTP port (0 = random free port)")
	configFlag := flag.String("config", defaultConfigFile(), "Path to rclone-web.yml")
	flag.Parse()

	cfg, err := config.Load(*configFlag)
	if err != nil {
		if os.IsNotExist(err) {
			log.Fatalf("please run init (%s not found)", *configFlag)
		}
		log.Fatalf("load config %s: %v", *configFlag, err)
	}
	if *portFlag != 0 {
		cfg.Port = *portFlag
	}

	store := creds.New()

	assemblePassphrase := func(prefix string) (string, error) {
		if cfg.PasswordMode == "full" {
			return prefix, nil
		}
		key := creds.CredKey(cfg.ConfigPath)
		suffix, err := store.Get(key)
		if err != nil {
			// Fall back to treating prefix as the full passphrase.
			log.Printf("credential store unavailable (%v), treating input as full passphrase", err)
			return prefix, nil
		}
		return prefix + suffix, nil
	}

	srv := server.New(cfg, webFS(), assemblePassphrase)
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
