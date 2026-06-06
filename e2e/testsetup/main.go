// testsetup creates a temporary age-encrypted config with a local copy job, one
// job per rclone command (and optionally a B2 job) plus fixture directories,
// then prints a JSON object to stdout for global-setup.ts.
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/yetanotherchris/rclone-web/internal/config"
	"github.com/yetanotherchris/rclone-web/internal/secret"
)

type output struct {
	TmpDir         string `json:"tmpDir"`
	ConfigPath     string `json:"configPath"`
	PassphrasePath string `json:"passphrasePath"`
	SrcDir         string `json:"srcDir"`
	DstDir         string `json:"dstDir"`

	// CommandJobs is one local job per rclone command (copy/sync/move/check/lsf).
	CommandJobs []cmdJob `json:"commandJobs"`

	// Queue fixture.
	QueueID   string `json:"queueId"`
	QueueName string `json:"queueName"`
	QueueDst1 string `json:"queueDst1"`
	QueueDst2 string `json:"queueDst2"`

	// B2 fixture (only populated when RCLONEWEB_E2E_B2_* env is set).
	CloudEnabled bool   `json:"cloudEnabled"`
	B2SrcBucket  string `json:"b2SrcBucket,omitempty"`
	B2DstBucket  string `json:"b2DstBucket,omitempty"`
	B2Prefix     string `json:"b2Prefix,omitempty"`
	B2JobID      string `json:"b2JobId,omitempty"`
	B2JobName    string `json:"b2JobName,omitempty"`
}

// cmdJob describes one local per-command job so the spec can drive it by id and
// verify its source/destination dirs on the filesystem.
type cmdJob struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Command     string `json:"command"`
	SrcDir      string `json:"srcDir"`
	DstDir      string `json:"dstDir,omitempty"`
	Destructive bool   `json:"destructive"`
}

// writeFiles creates dir (even when files is empty) and writes each file.
func writeFiles(dir string, files map[string]string) {
	if err := os.MkdirAll(dir, 0755); err != nil {
		log.Fatal(err)
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0644); err != nil {
			log.Fatal(err)
		}
	}
}

func main() {
	tmpDir, err := os.MkdirTemp("", "rclone-web-e2e-*")
	if err != nil {
		log.Fatal(err)
	}

	srcDir := filepath.Join(tmpDir, "src")
	dstDir := filepath.Join(tmpDir, "dst")
	for _, d := range []string{srcDir, dstDir} {
		if err := os.MkdirAll(d, 0755); err != nil {
			log.Fatal(err)
		}
	}

	fixtures := map[string]string{
		"hello.txt": "hello from rclone-web e2e\n",
		"world.txt": "world\n",
	}
	for name, content := range fixtures {
		if err := os.WriteFile(filepath.Join(srcDir, name), []byte(content), 0644); err != nil {
			log.Fatal(err)
		}
	}

	cfg := &config.RcloneConfig{
		Rclone: config.RcloneSection{
			Providers: map[string]config.Provider{
				"local": {Type: "local"},
			},
			Jobs: []config.Job{
				{
					ID:             "j1",
					Name:           "E2E Copy",
					SourceProvider: "local",
					SourcePath:     srcDir,
					DestProvider:   "local",
					DestPath:       dstDir,
					Command:        "copy",
				},
			},
		},
	}

	out := output{
		TmpDir: tmpDir,
		SrcDir: srcDir,
		DstDir: dstDir,
	}

	// One local job per rclone command (hermetic — no credentials needed). Each
	// command gets its own job and isolated dirs so tests can run in parallel
	// without interfering. Jobs are appended after j1, so j1 stays the first row.
	cmdRoot := filepath.Join(tmpDir, "cmd")
	addCmdJob := func(id, name, command string, srcFiles, dstFiles map[string]string, extraArgs string, destructive, oneSided bool) {
		src := filepath.Join(cmdRoot, id, "src")
		writeFiles(src, srcFiles)
		job := config.Job{
			ID:             id,
			Name:           name,
			SourceProvider: "local",
			SourcePath:     src,
			Command:        command,
			ExtraArgs:      extraArgs,
		}
		cj := cmdJob{ID: id, Name: name, Command: command, SrcDir: src, Destructive: destructive}
		if !oneSided {
			dst := filepath.Join(cmdRoot, id, "dst")
			writeFiles(dst, dstFiles)
			job.DestProvider = "local"
			job.DestPath = dst
			cj.DstDir = dst
		}
		cfg.Rclone.Jobs = append(cfg.Rclone.Jobs, job)
		out.CommandJobs = append(out.CommandJobs, cj)
	}

	// copy: -v so the run log emits "Copied" lines naming the files.
	addCmdJob("copy-test", "Command: copy", "copy",
		map[string]string{"hello.txt": "hello\n", "world.txt": "world\n"},
		map[string]string{}, "-v", false, false)
	// sync: dst has a stale file that sync must delete to mirror src.
	addCmdJob("sync-test", "Command: sync", "sync",
		map[string]string{"keep.txt": "keep\n"},
		map[string]string{"stale.txt": "stale\n"}, "", true, false)
	// move: files leave src (which ends up empty) and land in dst.
	addCmdJob("move-test", "Command: move", "move",
		map[string]string{"m1.txt": "one\n", "m2.txt": "two\n"},
		map[string]string{}, "", true, false)
	// check: src and dst are identical, so check exits 0.
	addCmdJob("check-test", "Command: check", "check",
		map[string]string{"same.txt": "same\n"},
		map[string]string{"same.txt": "same\n"}, "", false, false)
	// lsf: one-sided listing; the run log shows the source filenames.
	addCmdJob("lsf-test", "Command: lsf", "lsf",
		map[string]string{"l1.txt": "a\n", "l2.txt": "b\n"},
		nil, "", false, true)

	// Add a queue with two local copy jobs so queue e2e tests can run hermetically.
	qDst1 := filepath.Join(tmpDir, "qdst1")
	qDst2 := filepath.Join(tmpDir, "qdst2")
	if err := os.MkdirAll(qDst1, 0755); err != nil {
		log.Fatal(err)
	}
	if err := os.MkdirAll(qDst2, 0755); err != nil {
		log.Fatal(err)
	}
	cfg.Rclone.Jobs = append(cfg.Rclone.Jobs,
		config.Job{
			ID:             "qjob1",
			Name:           "Queue Copy 1",
			SourceProvider: "local",
			SourcePath:     srcDir,
			DestProvider:   "local",
			DestPath:       qDst1,
			Command:        "copy",
		},
		config.Job{
			ID:             "qjob2",
			Name:           "Queue Copy 2",
			SourceProvider: "local",
			SourcePath:     srcDir,
			DestProvider:   "local",
			DestPath:       qDst2,
			Command:        "copy",
		},
	)
	cfg.Rclone.Queues = []config.Queue{
		{
			ID:     "q1",
			Name:   "E2E Queue",
			JobIDs: []string{"qjob1", "qjob2"},
		},
	}
	out.QueueID = "q1"
	out.QueueName = "E2E Queue"
	out.QueueDst1 = qDst1
	out.QueueDst2 = qDst2

	// Optionally add a B2 bucket-to-bucket job. One B2 account backs both
	// buckets, so a single "b2" provider is used with two bucket paths.
	if acct, key := os.Getenv("RCLONEWEB_E2E_B2_ACCOUNT"), os.Getenv("RCLONEWEB_E2E_B2_KEY"); acct != "" && key != "" {
		srcBucket := os.Getenv("RCLONEWEB_E2E_B2_SRC_BUCKET")
		dstBucket := os.Getenv("RCLONEWEB_E2E_B2_DST_BUCKET")
		if srcBucket != "" && dstBucket != "" {
			prefix := os.Getenv("RCLONEWEB_E2E_B2_PREFIX")
			if prefix == "" {
				prefix = "e2e"
			}
			cfg.Rclone.Providers["b2"] = config.Provider{
				Type:  "b2",
				Extra: map[string]string{"account": acct, "key": key},
			}
			// Distinct /src and /dst sub-paths so a single shared bucket
			// (srcBucket == dstBucket) doesn't copy onto itself.
			cfg.Rclone.Jobs = append(cfg.Rclone.Jobs, config.Job{
				ID:             "b2-test",
				Name:           "E2E B2 Copy",
				SourceProvider: "b2",
				SourcePath:     srcBucket + "/" + prefix + "/src",
				DestProvider:   "b2",
				DestPath:       dstBucket + "/" + prefix + "/dst",
				Command:        "copy",
			})
			out.CloudEnabled = true
			out.B2SrcBucket = srcBucket
			out.B2DstBucket = dstBucket
			out.B2Prefix = prefix
			out.B2JobID = "b2-test"
			out.B2JobName = "E2E B2 Copy"
		}
	}

	cfgData, err := config.MarshalConfig(cfg)
	if err != nil {
		log.Fatal(err)
	}

	const passphrase = "e2e-test-pass"
	cfgPath := filepath.Join(tmpDir, "test.yml.age")
	if err := secret.Encrypt(cfgPath, passphrase, cfgData); err != nil {
		log.Fatal(err)
	}

	passFile := filepath.Join(tmpDir, "passphrase")
	if err := os.WriteFile(passFile, []byte(passphrase), 0600); err != nil {
		log.Fatal(err)
	}

	out.ConfigPath = cfgPath
	out.PassphrasePath = passFile

	data, _ := json.Marshal(out)
	fmt.Println(string(data))
}
