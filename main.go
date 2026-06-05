package main

import (
	"bufio"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/yetanotherchris/rclone-web/internal/config"
	"github.com/yetanotherchris/rclone-web/internal/creds"
	"github.com/yetanotherchris/rclone-web/internal/secret"
	"github.com/yetanotherchris/rclone-web/internal/server"
)

const defaultConfigFile = "rclone-web.json"

func main() {
	if len(os.Args) > 1 && os.Args[1] == "init" {
		if err := runInit(); err != nil {
			log.Fatalf("init: %v", err)
		}
		return
	}
	runServe()
}

// ---- init subcommand ----

func runInit() error {
	cfg := config.DefaultConfig()
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

	cfg.ConfigPath = prompt("Age-encrypted config path", cfg.ConfigPath)
	if _, err := os.Stat(cfg.ConfigPath); errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("config file not found: %s", cfg.ConfigPath)
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

	fmt.Print("Full age passphrase (verify decryption): ")
	var passphrase string
	if sc.Scan() {
		passphrase = strings.TrimSpace(sc.Text())
	}

	// Verify the passphrase decrypts the config.
	if _, err := secret.Decrypt(cfg.ConfigPath, passphrase); err != nil {
		return fmt.Errorf("passphrase did not decrypt config: %w", err)
	}
	fmt.Println("✓ Config decrypted successfully.")

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

	if err := cfg.Save(defaultConfigFile); err != nil {
		return fmt.Errorf("write %s: %w", defaultConfigFile, err)
	}
	fmt.Printf("✓ Wrote %s\n", defaultConfigFile)
	return nil
}

// ---- serve subcommand ----

func runServe() {
	portFlag := flag.Int("port", 0, "HTTP port (0 = random free port)")
	configFlag := flag.String("config", defaultConfigFile, "Path to rclone-web.json")
	flag.Parse()

	cfg, err := config.Load(*configFlag)
	if err != nil {
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
