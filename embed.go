package main

import (
	"embed"
	"io/fs"
	"log"
)

//go:embed web
var webEmbed embed.FS

func webFS() fs.FS {
	sub, err := fs.Sub(webEmbed, "web")
	if err != nil {
		log.Fatal(err)
	}
	return sub
}
