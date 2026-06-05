package config

import (
	"gopkg.in/yaml.v3"
)

// RcloneConfig is the decrypted in-memory model parsed from the age-encrypted YAML.
type RcloneConfig struct {
	Rclone RcloneSection `yaml:"rclone"`
}

type RcloneSection struct {
	Flags     string              `yaml:"flags"`
	Providers map[string]Provider `yaml:"providers"`
	Jobs      []Job               `yaml:"jobs"`
}

type Provider struct {
	// Type is the rclone backend type (b2, local, s3, sftp, …)
	Type string `yaml:"type"`
	// Extra holds all other key/value pairs for RCLONE_CONFIG_<NAME>_<KEY>
	Extra map[string]string `yaml:",inline"`
}

type Job struct {
	ID             string `yaml:"id"`
	Name           string `yaml:"name"`
	Command        string `yaml:"command"`
	SourceProvider string `yaml:"source_provider"`
	SourcePath     string `yaml:"source_path"`
	DestProvider   string `yaml:"dest_provider"`
	DestPath       string `yaml:"dest_path"`
	ExtraArgs      string `yaml:"extra_args"`
	Enabled        bool   `yaml:"enabled"`
}

func ParseConfig(data []byte) (*RcloneConfig, error) {
	var cfg RcloneConfig
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	if cfg.Rclone.Providers == nil {
		cfg.Rclone.Providers = make(map[string]Provider)
	}
	return &cfg, nil
}

func MarshalConfig(cfg *RcloneConfig) ([]byte, error) {
	return yaml.Marshal(cfg)
}
