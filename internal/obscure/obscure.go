// Package obscure implements rclone's password obfuscation algorithm so that
// plaintext passwords stored in the config can be converted to the format
// rclone expects for RCLONE_CONFIG_*_PASSWORD environment variables.
//
// The algorithm is identical to rclone's fs/config/obscure package: AES-CTR
// using a fixed published key, with a random 16-byte IV prepended, then
// base64 raw-URL encoded. It is obfuscation, not encryption.
package obscure

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
)

// cryptKey matches rclone's fs/config/obscure.cryptKey exactly.
var cryptKey = []byte{
	0x9c, 0x93, 0x5b, 0x48, 0x73, 0x0a, 0x55, 0x4d,
	0x6b, 0xfd, 0x7c, 0x63, 0xc8, 0x86, 0xa9, 0x2b,
	0xd3, 0x90, 0x19, 0x8e, 0xb8, 0x12, 0x8a, 0xfb,
	0xf4, 0xde, 0x16, 0x2b, 0x8b, 0x95, 0xf6, 0x38,
}

// Obscure converts a plaintext password into rclone's obscured format.
func Obscure(plain string) (string, error) {
	plaintext := []byte(plain)
	buf := make([]byte, aes.BlockSize+len(plaintext))
	iv := buf[:aes.BlockSize]
	if _, err := io.ReadFull(rand.Reader, iv); err != nil {
		return "", fmt.Errorf("obscure: %w", err)
	}
	block, err := aes.NewCipher(cryptKey)
	if err != nil {
		return "", fmt.Errorf("obscure: %w", err)
	}
	cipher.NewCTR(block, iv).XORKeyStream(buf[aes.BlockSize:], plaintext)
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
