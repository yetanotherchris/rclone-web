// Package bip39 generates short, human-friendly identifiers using two words
// from the BIP-0039 English word list, joined by a hyphen (e.g. "apple-orange").
package bip39

import (
	"crypto/rand"
	"math/big"

	bip39lib "github.com/luxfi/go-bip39"
)

var words = bip39lib.GetWordList()

// Generate returns a two-word BIP39 identifier ("word1-word2").
// If taken is non-nil, it retries until a name not present in taken is found.
// Panics only if crypto/rand fails, which should never happen in practice.
func Generate(taken map[string]bool) string {
	n := big.NewInt(int64(len(words)))
	for {
		i, err := rand.Int(rand.Reader, n)
		if err != nil {
			panic("bip39: crypto/rand failed: " + err.Error())
		}
		j, err := rand.Int(rand.Reader, n)
		if err != nil {
			panic("bip39: crypto/rand failed: " + err.Error())
		}
		id := words[i.Int64()] + "-" + words[j.Int64()]
		if taken == nil || !taken[id] {
			return id
		}
	}
}
