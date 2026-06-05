package config

import (
	"fmt"

	"gopkg.in/yaml.v3"
)

// RcloneConfig is the decrypted in-memory model parsed from the age-encrypted YAML.
type RcloneConfig struct {
	Rclone RcloneSection `yaml:"rclone-web"`
}

type RcloneSection struct {
	Flags     string              `yaml:"flags,omitempty"`
	Providers map[string]Provider `yaml:"providers"`
	Jobs      []Job               `yaml:"jobs"`
}

type Provider struct {
	// Type is the rclone backend type (b2, drive, s3, sftp, …)
	Type string `yaml:"type"`
	// Extra holds all other key/value pairs for RCLONE_CONFIG_<NAME>_<KEY>
	Extra map[string]string `yaml:",inline"`
}

type Job struct {
	ID          string `yaml:"id,omitempty" json:"id,omitempty"`
	Name        string `yaml:"name,omitempty" json:"name,omitempty"`
	Source      string `yaml:"source" json:"source"`
	Destination string `yaml:"destination,omitempty" json:"destination,omitempty"`
	Command     string `yaml:"command,omitempty" json:"command,omitempty"`
	ExtraArgs   string `yaml:"extra_args,omitempty" json:"extra_args,omitempty"`
	Enabled     bool   `yaml:"enabled,omitempty" json:"enabled,omitempty"`
}

// DisplayName returns a human-readable label for the job.
func (j *Job) DisplayName() string {
	if j.Name != "" {
		return j.Name
	}
	if j.Source != "" && j.Destination != "" {
		return j.Source + " → " + j.Destination
	}
	return j.ID
}

// EmptyRcloneConfig returns a minimal valid config with empty providers and jobs.
func EmptyRcloneConfig() *RcloneConfig {
	return &RcloneConfig{
		Rclone: RcloneSection{
			Providers: map[string]Provider{},
			Jobs:      []Job{},
		},
	}
}

func ParseConfig(data []byte) (*RcloneConfig, error) {
	var cfg RcloneConfig
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	if cfg.Rclone.Providers == nil {
		cfg.Rclone.Providers = make(map[string]Provider)
	}
	if cfg.Rclone.Jobs == nil {
		cfg.Rclone.Jobs = []Job{}
	}
	for i := range cfg.Rclone.Jobs {
		if cfg.Rclone.Jobs[i].ID == "" {
			cfg.Rclone.Jobs[i].ID = fmt.Sprintf("j%d", i)
		}
	}
	return &cfg, nil
}

func MarshalConfig(cfg *RcloneConfig) ([]byte, error) {
	return yaml.Marshal(cfg)
}
