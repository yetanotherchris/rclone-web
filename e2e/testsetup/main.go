// testsetup creates a temporary age-encrypted config with a local copy job and
// fixture directories, then prints a JSON object to stdout for global-setup.ts.
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
					Enabled:        true,
				},
			},
		},
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

	data, _ := json.Marshal(output{
		TmpDir:         tmpDir,
		ConfigPath:     cfgPath,
		PassphrasePath: passFile,
		SrcDir:         srcDir,
		DstDir:         dstDir,
	})
	fmt.Println(string(data))
}
