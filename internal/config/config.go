package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type AppConfig struct {
	ConfigPath           string `json:"configPath"`
	PasswordMode         string `json:"passwordMode"`    // "prefix" | "full"
	PrefixLength         int    `json:"prefixLength"`    // min 3
	IdleTimeoutSeconds   int    `json:"idleTimeoutSeconds"`
	BindAddr             string `json:"bindAddr"`
	Port                 int    `json:"port"`
	RclonePath           string `json:"rclonePath"`
}

func DefaultConfig() *AppConfig {
	return &AppConfig{
		PasswordMode:       "prefix",
		PrefixLength:       4,
		IdleTimeoutSeconds: 300,
		BindAddr:           "127.0.0.1",
		Port:               0,
		RclonePath:         "rclone",
	}
}

func Load(path string) (*AppConfig, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	cfg := DefaultConfig()
	if err := json.NewDecoder(f).Decode(cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

func (c *AppConfig) Save(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".rclone-web-*.tmp")
	if err != nil {
		return err
	}
	tmp := f.Name()
	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	if err := enc.Encode(c); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	f.Close()
	return os.Rename(tmp, path)
}
