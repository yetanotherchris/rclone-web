package main

import (
	"embed"
	"io/fs"
	"log"
)

//go:generate go run ./tools/bundle

// Only the served artifacts are embedded. The ES-module source under web/js and
// the Tailwind input are build-time inputs, not shipped: app.generated.js is the
// esbuild bundle (see the //go:generate above). Naming files (not the whole dir)
// also makes a missing/renamed asset a build error instead of a silent 404.
//go:embed web/index.html web/app.css web/app.generated.js
var webEmbed embed.FS

func webFS() fs.FS {
	sub, err := fs.Sub(webEmbed, "web")
	if err != nil {
		log.Fatal(err)
	}
	return sub
}
