package obscure

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestObscure_format(t *testing.T) {
	plain := "hunter2"
	obs, err := Obscure(plain)
	if err != nil {
		t.Fatalf("Obscure: %v", err)
	}
	// Must be valid raw-URL base64 with at least 16 bytes of IV.
	dec, err := base64.RawURLEncoding.DecodeString(obs)
	if err != nil {
		t.Fatalf("result not valid base64: %v", err)
	}
	if len(dec) < 16 {
		t.Fatalf("decoded length %d < 16 (no room for IV)", len(dec))
	}
}

func TestObscure_nondeterministic(t *testing.T) {
	// Two calls with the same input must produce different ciphertext (random IV).
	a, _ := Obscure("secret")
	b, _ := Obscure("secret")
	if a == b {
		t.Error("Obscure produced the same output twice; IV is not random")
	}
}

func TestObscure_empty(t *testing.T) {
	obs, err := Obscure("")
	if err != nil {
		t.Fatalf("Obscure empty: %v", err)
	}
	// Empty plaintext → only the 16-byte IV encoded.
	dec, _ := base64.RawURLEncoding.DecodeString(obs)
	if len(dec) != 16 {
		t.Fatalf("empty plain: want 16 bytes, got %d", len(dec))
	}
}

func TestObscure_noColon(t *testing.T) {
	// rclone's Reveal checks for valid base64; ensure no padding chars that
	// break raw-URL encoding.
	obs, _ := Obscure("password123")
	if strings.ContainsAny(obs, "+/=") {
		t.Errorf("output contains standard base64 chars: %q", obs)
	}
}
