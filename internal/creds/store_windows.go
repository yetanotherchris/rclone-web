//go:build windows

package creds

func newStore() Store {
	return &windowsStore{}
}
