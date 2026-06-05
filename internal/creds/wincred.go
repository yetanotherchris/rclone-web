//go:build windows

package creds

import (
	"fmt"
	"syscall"
	"unsafe"
)

var (
	credAdvAPI = syscall.NewLazyDLL("advapi32.dll")
	procRead   = credAdvAPI.NewProc("CredReadW")
	procWrite  = credAdvAPI.NewProc("CredWriteW")
	procFree   = credAdvAPI.NewProc("CredFree")
	procDelete = credAdvAPI.NewProc("CredDeleteW")
)

const (
	credTypeGeneric         = 1
	credPersistLocalMachine = 2
)

type windowsCredential struct {
	Flags              uint32
	Type               uint32
	TargetName         *uint16
	Comment            *uint16
	LastWritten        [2]uint32
	CredentialBlobSize uint32
	CredentialBlob     *byte
	Persist            uint32
	AttributeCount     uint32
	Attributes         uintptr
	TargetAlias        *uint16
	UserName           *uint16
}

type windowsStore struct{}

func (w *windowsStore) Get(key string) (string, error) {
	target, err := syscall.UTF16PtrFromString("rclone-web/" + key)
	if err != nil {
		return "", err
	}
	var pCred uintptr
	r, _, err := procRead.Call(
		uintptr(unsafe.Pointer(target)),
		uintptr(credTypeGeneric),
		0,
		uintptr(unsafe.Pointer(&pCred)),
	)
	if r == 0 {
		return "", fmt.Errorf("CredReadW: %w", err)
	}
	defer procFree.Call(pCred)
	cred := (*windowsCredential)(unsafe.Pointer(pCred))
	blob := unsafe.Slice(cred.CredentialBlob, cred.CredentialBlobSize)
	return string(blob), nil
}

func (w *windowsStore) Set(key, secret string) error {
	target, err := syscall.UTF16PtrFromString("rclone-web/" + key)
	if err != nil {
		return err
	}
	blob := []byte(secret)
	cred := windowsCredential{
		Type:               credTypeGeneric,
		TargetName:         target,
		CredentialBlobSize: uint32(len(blob)),
		CredentialBlob:     &blob[0],
		Persist:            credPersistLocalMachine,
	}
	r, _, err := procWrite.Call(uintptr(unsafe.Pointer(&cred)), 0)
	if r == 0 {
		return fmt.Errorf("CredWriteW: %w", err)
	}
	return nil
}

func (w *windowsStore) Delete(key string) error {
	target, err := syscall.UTF16PtrFromString("rclone-web/" + key)
	if err != nil {
		return err
	}
	r, _, err := procDelete.Call(
		uintptr(unsafe.Pointer(target)),
		uintptr(credTypeGeneric),
		0,
	)
	if r == 0 {
		return fmt.Errorf("CredDeleteW: %w", err)
	}
	return nil
}
