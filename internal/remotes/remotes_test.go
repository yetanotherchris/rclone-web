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
		ID:             "j1",
		Name:           "Test",
		Command:        "copy",
		SourceProvider: "localdisk",
		SourcePath:     "D:/Photos",
		DestProvider:   "b2",
		DestPath:       "my-bucket/photos",
		ExtraArgs:      "--exclude *.tmp",
	}

	argv, err := AssembleArgv(src, cfg, job, false, false)
	if err != nil {
		t.Fatalf("AssembleArgv: %v", err)
	}
	// copy D:/Photos b2:my-bucket/photos --fast-list --transfers 8 --exclude *.tmp -v
	// (-v is injected by default because the job sets no verbosity flag of its own)
	want := []string{"copy", "D:/Photos", "b2:my-bucket/photos", "--fast-list", "--transfers", "8", "--exclude", "*.tmp", "-v"}
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
	cfg.Rclone.Providers = map[string]config.Provider{
		"gdrive": {Type: "drive"},
		"b2":     {Type: "b2"},
	}
	job := &config.Job{
		SourceProvider: "gdrive",
		SourcePath:     "2026",
		DestProvider:   "b2",
		DestPath:       "myuser-drive/2026",
	}
	argv, err := AssembleArgv(src, cfg, job, false, false)
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
	cfg.Rclone.Providers = map[string]config.Provider{
		"b2": {Type: "b2"},
	}
	job := &config.Job{
		Command:      "copy",
		SourceProvider: "b2",
		SourcePath:   "bucket/src",
		DestProvider: "b2",
		DestPath:     "bucket/dst",
	}
	argv, err := AssembleArgv(src, cfg, job, true, false)
	if err != nil {
		t.Fatalf("AssembleArgv: %v", err)
	}
	last := argv[len(argv)-1]
	if last != "--dry-run" {
		t.Errorf("last arg: got %q, want %q", last, "--dry-run")
	}
}

// TestAssembleArgv_blankPathIsRemoteRoot ensures a blank source/dest path is
// only rejected for a bare local path. When a provider is set, a blank path
// is valid rclone syntax for the remote's root (e.g. "b2notescrypt:").
func TestAssembleArgv_blankPathIsRemoteRoot(t *testing.T) {
	src := &EnvVarSource{}
	cfg := &config.RcloneConfig{}
	cfg.Rclone.Providers = map[string]config.Provider{
		"b2notescrypt": {Type: "crypt"},
	}
	job := &config.Job{
		Command:        "copy",
		SourceProvider: "",
		SourcePath:     "D:/Photos",
		DestProvider:   "b2notescrypt",
		DestPath:       "",
	}
	argv, err := AssembleArgv(src, cfg, job, false, false)
	if err != nil {
		t.Fatalf("AssembleArgv: %v", err)
	}
	want := "b2notescrypt:"
	if argv[2] != want {
		t.Errorf("dest remote: got %q, want %q", argv[2], want)
	}
}

// TestAssembleArgv_blankLocalPathErrors ensures a bare local path (no
// provider) with no path is still rejected — there's nothing to run against.
func TestAssembleArgv_blankLocalPathErrors(t *testing.T) {
	src := &EnvVarSource{}
	cfg := &config.RcloneConfig{}
	job := &config.Job{
		Command:        "copy",
		SourceProvider: "",
		SourcePath:     "",
		DestProvider:   "",
		DestPath:       "D:/backup",
	}
	if _, err := AssembleArgv(src, cfg, job, false, false); err == nil {
		t.Errorf("expected error for blank local source path, got nil")
	}
}

func TestAssembleArgv_oneSided(t *testing.T) {
	src := &EnvVarSource{}
	cfg := &config.RcloneConfig{}
	cfg.Rclone.Providers = map[string]config.Provider{
		"b2": {Type: "b2"},
	}
	job := &config.Job{
		Command:        "lsf",
		SourceProvider: "b2",
		SourcePath:     "my-bucket",
	}
	argv, err := AssembleArgv(src, cfg, job, false, false)
	if err != nil {
		t.Fatalf("AssembleArgv: %v", err)
	}
	// lsf (one-sided) plus the injected default "-v".
	want := []string{"lsf", "b2:my-bucket", "-v"}
	if len(argv) != len(want) {
		t.Fatalf("expected %v for lsf, got %v", want, argv)
	}
	for i, v := range want {
		if argv[i] != v {
			t.Errorf("argv[%d]: got %q, want %q", i, argv[i], v)
		}
	}
}

func TestAssembleArgv_respectsExplicitVerbosity(t *testing.T) {
	src := &EnvVarSource{}
	cfg := &config.RcloneConfig{}
	cfg.Rclone.Providers = map[string]config.Provider{"b2": {Type: "b2"}}
	job := &config.Job{
		Command:        "copy",
		SourceProvider: "b2",
		SourcePath:     "bucket/src",
		DestProvider:   "b2",
		DestPath:       "bucket/dst",
		ExtraArgs:      "--progress",
	}
	argv, err := AssembleArgv(src, cfg, job, false, false)
	if err != nil {
		t.Fatalf("AssembleArgv: %v", err)
	}
	for _, a := range argv {
		if a == "-v" {
			t.Errorf("default -v should not be added when --progress is set: %v", argv)
		}
	}
}

func TestAssembleArgv_bisync(t *testing.T) {
	src := &EnvVarSource{}
	cfg := &config.RcloneConfig{}
	cfg.Rclone.Providers = map[string]config.Provider{
		"b2": {Type: "b2"},
	}
	job := &config.Job{
		Command:        "bisync",
		SourceProvider: "",
		SourcePath:     "D:/Photos",
		DestProvider:   "b2",
		DestPath:       "my-bucket/photos",
	}

	// Steady-state run: no --resync, no --resync-mode.
	argv, err := AssembleArgv(src, cfg, job, false, false)
	if err != nil {
		t.Fatalf("AssembleArgv: %v", err)
	}
	for _, a := range argv {
		if a == "--resync" || a == "--resync-mode" {
			t.Errorf("steady-state bisync run should not include %q: %v", a, argv)
		}
	}

	// First run: resync=true adds --resync (and --resync-mode if set).
	job.ResyncMode = "path2"
	argv, err = AssembleArgv(src, cfg, job, false, true)
	if err != nil {
		t.Fatalf("AssembleArgv: %v", err)
	}
	want := []string{"bisync", "D:/Photos", "b2:my-bucket/photos", "--resync", "--resync-mode", "path2", "-v"}
	if len(argv) != len(want) {
		t.Fatalf("len mismatch: got %v, want %v", argv, want)
	}
	for i, v := range want {
		if argv[i] != v {
			t.Errorf("argv[%d]: got %q, want %q", i, argv[i], v)
		}
	}
}

func TestAssembleArgv_bisyncConflictResolve(t *testing.T) {
	src := &EnvVarSource{}
	cfg := &config.RcloneConfig{}
	cfg.Rclone.Providers = map[string]config.Provider{"b2": {Type: "b2"}}
	job := &config.Job{
		Command:         "bisync",
		SourcePath:      "D:/Photos",
		DestProvider:    "b2",
		DestPath:        "my-bucket/photos",
		ConflictResolve: "path2",
	}
	argv, err := AssembleArgv(src, cfg, job, false, false)
	if err != nil {
		t.Fatalf("AssembleArgv: %v", err)
	}
	found := false
	for i, a := range argv {
		if a == "--conflict-resolve" && i+1 < len(argv) && argv[i+1] == "path2" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected --conflict-resolve path2 in argv, got %v", argv)
	}
}

func TestAssembleArgv_backupDir(t *testing.T) {
	src := &EnvVarSource{}
	cfg := &config.RcloneConfig{}
	cfg.Rclone.Providers = map[string]config.Provider{"b2": {Type: "b2"}}

	sync := &config.Job{
		Command:      "sync",
		SourcePath:   "D:/Photos",
		DestProvider: "b2",
		DestPath:     "my-bucket/photos",
		BackupDir:    "D:/backups",
	}
	argv, err := AssembleArgv(src, cfg, sync, false, false)
	if err != nil {
		t.Fatalf("AssembleArgv: %v", err)
	}
	found := false
	for i, a := range argv {
		if a == "--backup-dir" && i+1 < len(argv) && argv[i+1] == "D:/backups" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected --backup-dir D:/backups in argv, got %v", argv)
	}

	// check doesn't support --backup-dir, so it must not be added even if set.
	check := &config.Job{
		Command:      "check",
		SourcePath:   "D:/Photos",
		DestProvider: "b2",
		DestPath:     "my-bucket/photos",
		BackupDir:    "D:/backups",
	}
	argv, err = AssembleArgv(src, cfg, check, false, false)
	if err != nil {
		t.Fatalf("AssembleArgv: %v", err)
	}
	for _, a := range argv {
		if a == "--backup-dir" {
			t.Errorf("check should not receive --backup-dir: %v", argv)
		}
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

// TestParsePasswordFields_onlyIsPassword guards the obscuring rule: only
// IsPassword fields may be obscured. Sensitive-only fields (e.g. drive's
// "token", which rclone json.Unmarshal's raw) must pass through untouched.
func TestParsePasswordFields_onlyIsPassword(t *testing.T) {
	backends := []map[string]interface{}{
		{
			"Name": "drive",
			"Options": []interface{}{
				map[string]interface{}{"Name": "token", "Sensitive": true},
				map[string]interface{}{"Name": "client_secret", "Sensitive": true},
			},
		},
		{
			"Name": "crypt",
			"Options": []interface{}{
				map[string]interface{}{"Name": "password", "IsPassword": true},
			},
		},
	}
	pw := ParsePasswordFields(backends)
	if pw["drive"]["token"] {
		t.Errorf("drive.token is Sensitive-only and must not be obscured")
	}
	if pw["drive"]["client_secret"] {
		t.Errorf("drive.client_secret is Sensitive-only and must not be obscured")
	}
	if !pw["crypt"]["password"] {
		t.Errorf("crypt.password is IsPassword and must be obscured")
	}
}

// TestEnv_sensitiveTokenNotObscured ensures a Sensitive-only field is emitted
// verbatim even when PasswordFields is populated from the backend schema.
func TestEnv_sensitiveTokenNotObscured(t *testing.T) {
	src := &EnvVarSource{
		PasswordFields: ParsePasswordFields([]map[string]interface{}{
			{
				"Name": "drive",
				"Options": []interface{}{
					map[string]interface{}{"Name": "token", "Sensitive": true},
				},
			},
		}),
	}
	tok := `{"access_token":"ya29.x","token_type":"Bearer"}`
	providers := map[string]config.Provider{
		"gdrive": {Type: "drive", Extra: map[string]string{"token": tok}},
	}
	want := "RCLONE_CONFIG_GDRIVE_TOKEN=" + tok
	for _, e := range src.Env(providers) {
		if e == want {
			return
		}
	}
	t.Errorf("token was not passed through verbatim; want %q in %v", want, src.Env(providers))
}
