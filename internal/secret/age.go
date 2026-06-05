package secret

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"path/filepath"

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
