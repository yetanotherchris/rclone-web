package config

import (
	"time"

	"github.com/yetanotherchris/rclone-web/internal/bip39"
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
	Queues    []Queue             `yaml:"queues,omitempty"`
}

type Queue struct {
	ID        string   `yaml:"id,omitempty" json:"id,omitempty"`
	Name      string   `yaml:"name,omitempty" json:"name,omitempty"`
	JobIDs    []string `yaml:"job_ids,omitempty" json:"job_ids,omitempty"`
	OnFailure string   `yaml:"on_failure,omitempty" json:"on_failure,omitempty"`
}

type Provider struct {
	// Type is the rclone backend type (b2, drive, s3, sftp, …)
	Type string `yaml:"type"`
	// Extra holds all other key/value pairs for RCLONE_CONFIG_<NAME>_<KEY>
	Extra map[string]string `yaml:",inline"`
}

type Job struct {
	ID             string `yaml:"id,omitempty" json:"id,omitempty"`
	Name           string `yaml:"name,omitempty" json:"name,omitempty"`
	SourceProvider string `yaml:"source_provider,omitempty" json:"source_provider,omitempty"`
	SourcePath     string `yaml:"source_path" json:"source_path"`
	DestProvider   string `yaml:"dest_provider,omitempty" json:"dest_provider,omitempty"`
	DestPath       string `yaml:"dest_path,omitempty" json:"dest_path,omitempty"`
	Command        string `yaml:"command,omitempty" json:"command,omitempty"`
	ExtraArgs      string     `yaml:"extra_args,omitempty" json:"extra_args,omitempty"`
	LastRunAt      *time.Time `yaml:"last_run_at,omitempty" json:"last_run_at,omitempty"`
	LastRunStatus  string     `yaml:"last_run_status,omitempty" json:"last_run_status,omitempty"`
}

// DisplayName returns a human-readable label for the job.
func (j *Job) DisplayName() string {
	if j.Name != "" {
		return j.Name
	}
	src := j.SourcePath
	if j.SourceProvider != "" {
		src = j.SourceProvider + ":" + j.SourcePath
	}
	if j.DestPath != "" {
		dst := j.DestPath
		if j.DestProvider != "" {
			dst = j.DestProvider + ":" + j.DestPath
		}
		return src + " → " + dst
	}
	return j.ID
}

// EmptyRcloneConfig returns a minimal valid config with empty providers and jobs.
func EmptyRcloneConfig() *RcloneConfig {
	return &RcloneConfig{
		Rclone: RcloneSection{
			Providers: map[string]Provider{},
			Jobs:      []Job{},
			Queues:    []Queue{},
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
	takenJobIDs := make(map[string]bool, len(cfg.Rclone.Jobs))
	for _, j := range cfg.Rclone.Jobs {
		if j.ID != "" {
			takenJobIDs[j.ID] = true
		}
	}
	for i := range cfg.Rclone.Jobs {
		if cfg.Rclone.Jobs[i].ID == "" {
			id := bip39.Generate(takenJobIDs)
			cfg.Rclone.Jobs[i].ID = id
			takenJobIDs[id] = true
		}
	}
	if cfg.Rclone.Queues == nil {
		cfg.Rclone.Queues = []Queue{}
	}
	takenQueueIDs := make(map[string]bool, len(cfg.Rclone.Queues))
	for _, q := range cfg.Rclone.Queues {
		if q.ID != "" {
			takenQueueIDs[q.ID] = true
		}
	}
	for i := range cfg.Rclone.Queues {
		if cfg.Rclone.Queues[i].ID == "" {
			id := bip39.Generate(takenQueueIDs)
			cfg.Rclone.Queues[i].ID = id
			takenQueueIDs[id] = true
		}
	}
	return &cfg, nil
}

func MarshalConfig(cfg *RcloneConfig) ([]byte, error) {
	return yaml.Marshal(cfg)
}
