//go:build !windows

package creds

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

func newStore() Store {
	return &fileStore{}
}

// fileStore stores credentials in a chmod-600 file under $HOME/.config/rclone-web/.
// This is a fallback for non-Windows platforms; production use would add a
// macOS Keychain or libsecret backend behind a build tag.
type fileStore struct{}

func credDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(home, ".config", "rclone-web", "creds")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	return dir, nil
}

func (f *fileStore) Get(key string) (string, error) {
	dir, err := credDir()
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(filepath.Join(dir, key))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", fmt.Errorf("no stored credential for key %q", key)
		}
		return "", err
	}
	return string(data), nil
}

func (f *fileStore) Set(key, secret string) error {
	dir, err := credDir()
	if err != nil {
		return err
	}
	path := filepath.Join(dir, key)
	return os.WriteFile(path, []byte(secret), 0600)
}

func (f *fileStore) Delete(key string) error {
	dir, err := credDir()
	if err != nil {
		return err
	}
	err = os.Remove(filepath.Join(dir, key))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
