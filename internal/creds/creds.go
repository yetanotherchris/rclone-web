package creds

import (
	"crypto/sha256"
	"fmt"
	"path/filepath"
	"strings"
)

// NormalizeConfigPath returns a canonical key for the credential store:
// filepath.Clean, forward slashes, lower-cased drive letter.
func NormalizeConfigPath(p string) string {
	p = filepath.Clean(p)
	p = filepath.ToSlash(p)
	// lower-case drive letter on Windows paths  e.g. "D:/foo" → "d:/foo"
	if len(p) >= 2 && p[1] == ':' {
		p = strings.ToLower(p[:1]) + p[1:]
	}
	return p
}

// CredKey returns the SHA-256 hex of the normalised config path, used as the
// credential-store key so slash/drive-case differences still match.
func CredKey(configPath string) string {
	h := sha256.Sum256([]byte(NormalizeConfigPath(configPath)))
	return fmt.Sprintf("%x", h)
}

// Store is the OS credential-store interface.
type Store interface {
	// Get retrieves the stored secret for the given key.
	Get(key string) (string, error)
	// Set stores a secret.
	Set(key, secret string) error
	// Delete removes a stored secret.
	Delete(key string) error
}

// New returns the platform credential store.
func New() Store {
	return newStore()
}
