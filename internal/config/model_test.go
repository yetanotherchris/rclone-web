package config

import (
	"testing"
)

func TestParseConfig(t *testing.T) {
	yaml := `
rclone:
  flags: "--fast-list --transfers 8"
  providers:
    b2:
      type: b2
      account: myaccount
      key: mykey
    localdisk:
      type: local
  jobs:
    - id: j1
      name: "Photos to B2"
      command: copy
      source_provider: localdisk
      source_path: D:/Photos
      dest_provider: b2
      dest_path: my-bucket/photos
      extra_args: "--exclude *.tmp"
      enabled: true
`
	cfg, err := ParseConfig([]byte(yaml))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if cfg.Rclone.Flags != "--fast-list --transfers 8" {
		t.Errorf("flags: got %q", cfg.Rclone.Flags)
	}
	if _, ok := cfg.Rclone.Providers["b2"]; !ok {
		t.Error("b2 provider missing")
	}
	if len(cfg.Rclone.Jobs) != 1 {
		t.Errorf("jobs: got %d", len(cfg.Rclone.Jobs))
	}
	if cfg.Rclone.Jobs[0].Name != "Photos to B2" {
		t.Errorf("job name: got %q", cfg.Rclone.Jobs[0].Name)
	}
}
