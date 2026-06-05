package config

import (
	"testing"
)

func TestParseConfig(t *testing.T) {
	yml := `
rclone-web:
  flags: "--fast-list --transfers 8"
  providers:
    b2:
      type: b2
      account: myaccount
      key: mykey
    localdisk:
      type: local
  jobs:
    - name: "Photos to B2"
      source: "localdisk:D:/Photos"
      destination: "b2:my-bucket/photos"
      command: copy
      extra_args: "--exclude *.tmp"
      enabled: true
`
	cfg, err := ParseConfig([]byte(yml))
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
	j := cfg.Rclone.Jobs[0]
	if j.Name != "Photos to B2" {
		t.Errorf("job name: got %q", j.Name)
	}
	if j.Source != "localdisk:D:/Photos" {
		t.Errorf("source: got %q", j.Source)
	}
	if j.Destination != "b2:my-bucket/photos" {
		t.Errorf("destination: got %q", j.Destination)
	}
	// ID should be auto-assigned when absent
	if j.ID == "" {
		t.Error("expected auto-assigned ID")
	}
}
