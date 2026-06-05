package config

import (
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

type AppConfig struct {
	ConfigPath         string `yaml:"config_path"`
	PasswordMode       string `yaml:"password_mode"`        // "prefix" | "full"
	PrefixLength       int    `yaml:"prefix_length"`        // min 3
	IdleTimeoutSeconds int    `yaml:"idle_timeout_seconds"`
	BindAddr           string `yaml:"bind_addr"`
	Port               int    `yaml:"port"`
	RclonePath         string `yaml:"rclone_path"`
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
	if err := yaml.NewDecoder(f).Decode(cfg); err != nil {
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
	if err := yaml.NewEncoder(f).Encode(c); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	f.Close()
	return os.Rename(tmp, path)
}
