package secret

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"filippo.io/age"
	"filippo.io/age/armor"
)

// Decrypt decrypts an age-scrypt (passphrase-encrypted) file and returns the
// plaintext bytes. The passphrase is the fully assembled password (prefix+suffix
// or full, depending on config).
func Decrypt(encPath string, passphrase string) ([]byte, error) {
	f, err := os.Open(encPath)
	if err != nil {
		return nil, fmt.Errorf("open encrypted config: %w", err)
	}
	defer f.Close()

	// Try armored first, then raw binary.
	data, err := io.ReadAll(f)
	if err != nil {
		return nil, err
	}

	identity, err := age.NewScryptIdentity(passphrase)
	if err != nil {
		return nil, fmt.Errorf("create age identity: %w", err)
	}

	var plaintext []byte

	// Try PEM-armored.
	if bytes.HasPrefix(data, []byte("-----BEGIN AGE ENCRYPTED FILE-----")) {
		ar := armor.NewReader(bytes.NewReader(data))
		r, err := age.Decrypt(ar, identity)
		if err != nil {
			return nil, fmt.Errorf("decrypt (armored): %w", err)
		}
		plaintext, err = io.ReadAll(r)
		if err != nil {
			return nil, err
		}
	} else {
		r, err := age.Decrypt(bytes.NewReader(data), identity)
		if err != nil {
			return nil, fmt.Errorf("decrypt (binary): %w", err)
		}
		plaintext, err = io.ReadAll(r)
		if err != nil {
			return nil, err
		}
	}

	return plaintext, nil
}

// Encrypt encrypts plaintext with age scrypt and writes the result to encPath
// atomically. Output is PEM-armored for readability.
func Encrypt(encPath string, passphrase string, plaintext []byte) error {
	recipient, err := age.NewScryptRecipient(passphrase)
	if err != nil {
		return fmt.Errorf("create age recipient: %w", err)
	}

	var buf bytes.Buffer
	aw := armor.NewWriter(&buf)
	w, err := age.Encrypt(aw, recipient)
	if err != nil {
		return fmt.Errorf("age encrypt: %w", err)
	}
	if _, err := w.Write(plaintext); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	if err := aw.Close(); err != nil {
		return err
	}

	dir := filepath.Dir(encPath)
	tmp, err := os.CreateTemp(dir, ".rclone-web-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(buf.Bytes()); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return err
	}
	tmp.Close()
	return os.Rename(tmpName, encPath)
}

// findIdentityLine scans content (which may include comment lines starting with
// "#") and returns the AGE-SECRET-KEY-1 line, if present.
func findIdentityLine(content string) (string, bool) {
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "AGE-SECRET-KEY-1") {
			return line, true
		}
	}
	return "", false
}

// IsAgeIdentityContent reports whether content contains an age X25519 identity key.
func IsAgeIdentityContent(content string) bool {
	_, ok := findIdentityLine(content)
	return ok
}

// DecryptWithIdentity decrypts an age-encrypted file using an X25519 identity.
// identityStr is the raw AGE-SECRET-KEY-1... string (no comment lines).
func DecryptWithIdentity(encPath, identityStr string) ([]byte, error) {
	identity, err := age.ParseX25519Identity(identityStr)
	if err != nil {
		return nil, fmt.Errorf("parse age identity: %w", err)
	}

	data, err := os.ReadFile(encPath)
	if err != nil {
		return nil, fmt.Errorf("open encrypted config: %w", err)
	}

	var r io.Reader
	if bytes.HasPrefix(data, []byte("-----BEGIN AGE ENCRYPTED FILE-----")) {
		r, err = age.Decrypt(armor.NewReader(bytes.NewReader(data)), identity)
	} else {
		r, err = age.Decrypt(bytes.NewReader(data), identity)
	}
	if err != nil {
		return nil, fmt.Errorf("decrypt with identity: %w", err)
	}
	return io.ReadAll(r)
}

// EncryptWithIdentity encrypts plaintext to the X25519 recipient derived from
// identityStr and writes the result atomically to encPath.
func EncryptWithIdentity(encPath, identityStr string, plaintext []byte) error {
	identity, err := age.ParseX25519Identity(identityStr)
	if err != nil {
		return fmt.Errorf("parse age identity: %w", err)
	}

	var buf bytes.Buffer
	aw := armor.NewWriter(&buf)
	w, err := age.Encrypt(aw, identity.Recipient())
	if err != nil {
		return fmt.Errorf("age encrypt: %w", err)
	}
	if _, err := w.Write(plaintext); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	if err := aw.Close(); err != nil {
		return err
	}

	dir := filepath.Dir(encPath)
	tmp, err := os.CreateTemp(dir, ".rclone-web-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(buf.Bytes()); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return err
	}
	tmp.Close()
	return os.Rename(tmpName, encPath)
}

// DecryptAuto decrypts using an age X25519 identity if credential contains an
// AGE-SECRET-KEY-1 line, otherwise falls back to scrypt passphrase.
func DecryptAuto(encPath, credential string) ([]byte, error) {
	if id, ok := findIdentityLine(credential); ok {
		return DecryptWithIdentity(encPath, id)
	}
	return Decrypt(encPath, credential)
}

// EncryptAuto encrypts using an age X25519 identity if credential contains an
// AGE-SECRET-KEY-1 line, otherwise falls back to scrypt passphrase.
func EncryptAuto(encPath, credential string, plaintext []byte) error {
	if id, ok := findIdentityLine(credential); ok {
		return EncryptWithIdentity(encPath, id, plaintext)
	}
	return Encrypt(encPath, credential, plaintext)
}
