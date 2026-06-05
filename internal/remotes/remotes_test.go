package remotes

import (
	"testing"

	"github.com/yetanotherchris/rclone-web/internal/config"
)

func TestRemote_local(t *testing.T) {
	src := &EnvVarSource{}
	p := config.Provider{Type: "local"}
	got := src.Remote(p, "localdisk", "D:/Photos")
	if got != "D:/Photos" {
		t.Errorf("local remote: got %q, want %q", got, "D:/Photos")
	}
}

func TestRemote_b2(t *testing.T) {
	src := &EnvVarSource{}
	p := config.Provider{Type: "b2"}
	got := src.Remote(p, "b2", "my-bucket/photos")
	if got != "b2:my-bucket/photos" {
		t.Errorf("b2 remote: got %q, want %q", got, "b2:my-bucket/photos")
	}
}

func TestAssembleArgv(t *testing.T) {
	src := &EnvVarSource{}
	cfg := &config.RcloneConfig{}
	cfg.Rclone.Flags = "--fast-list --transfers 8"
	cfg.Rclone.Providers = map[string]config.Provider{
		"localdisk": {Type: "local"},
		"b2":        {Type: "b2"},
	}
	job := &config.Job{
		ID:          "j1",
		Name:        "Test",
		Command:     "copy",
		Source:      "D:/Photos",
		Destination: "b2:my-bucket/photos",
		ExtraArgs:   "--exclude *.tmp",
	}

	argv, err := AssembleArgv(src, cfg, job, false)
	if err != nil {
		t.Fatalf("AssembleArgv: %v", err)
	}
	// copy D:/Photos b2:my-bucket/photos --fast-list --transfers 8 --exclude *.tmp
	want := []string{"copy", "D:/Photos", "b2:my-bucket/photos", "--fast-list", "--transfers", "8", "--exclude", "*.tmp"}
	if len(argv) != len(want) {
		t.Fatalf("len mismatch: got %v, want %v", argv, want)
	}
	for i, v := range want {
		if argv[i] != v {
			t.Errorf("argv[%d]: got %q, want %q", i, argv[i], v)
		}
	}
}

func TestAssembleArgv_defaultsToSync(t *testing.T) {
	src := &EnvVarSource{}
	cfg := &config.RcloneConfig{}
	job := &config.Job{
		Source:      "gdrive:2026",
		Destination: "b2:myuser-drive/2026",
	}
	argv, err := AssembleArgv(src, cfg, job, false)
	if err != nil {
		t.Fatalf("AssembleArgv: %v", err)
	}
	if argv[0] != "sync" {
		t.Errorf("default command: got %q, want sync", argv[0])
	}
}

func TestAssembleArgv_dryRun(t *testing.T) {
	src := &EnvVarSource{}
	cfg := &config.RcloneConfig{}
	job := &config.Job{
		Command:     "copy",
		Source:      "b2:bucket/src",
		Destination: "b2:bucket/dst",
	}
	argv, err := AssembleArgv(src, cfg, job, true)
	if err != nil {
		t.Fatalf("AssembleArgv: %v", err)
	}
	last := argv[len(argv)-1]
	if last != "--dry-run" {
		t.Errorf("last arg: got %q, want %q", last, "--dry-run")
	}
}

func TestAssembleArgv_oneSided(t *testing.T) {
	src := &EnvVarSource{}
	cfg := &config.RcloneConfig{}
	job := &config.Job{
		Command: "lsf",
		Source:  "b2:my-bucket",
	}
	argv, err := AssembleArgv(src, cfg, job, false)
	if err != nil {
		t.Fatalf("AssembleArgv: %v", err)
	}
	if len(argv) != 2 {
		t.Errorf("expected 2 args for lsf, got %v", argv)
	}
}

func TestEnv(t *testing.T) {
	src := &EnvVarSource{}
	providers := map[string]config.Provider{
		"b2": {
			Type:  "b2",
			Extra: map[string]string{"account": "myacc", "key": "mykey"},
		},
	}
	env := src.Env(providers)
	found := make(map[string]bool)
	for _, e := range env {
		found[e] = true
	}
	if !found["RCLONE_CONFIG_B2_TYPE=b2"] {
		t.Errorf("missing TYPE env: got %v", env)
	}
	if !found["RCLONE_CONFIG_B2_ACCOUNT=myacc"] {
		t.Errorf("missing ACCOUNT env: got %v", env)
	}
}
