// Command bundle compiles the ES modules in web/js into the single
// web/app.generated.js file that the page loads. It is invoked via
// `go generate ./...` (see the //go:generate directive next to the //go:embed
// in embed.go).
//
// The output is an IIFE (classic <script>, not type="module"), so index.html
// and the static file server need no changes and there is no module-MIME
// concern on Windows. Edit the modules in web/js — never the generated bundle.
package main

import (
	"log"

	"github.com/evanw/esbuild/pkg/api"
)

func main() {
	result := api.Build(api.BuildOptions{
		EntryPoints: []string{"web/js/main.js"},
		Bundle:      true,
		Format:      api.FormatIIFE,
		Target:      api.ES2020,
		Charset:     api.CharsetUTF8,
		Outfile:     "web/app.generated.js",
		Write:       true,
		LogLevel:    api.LogLevelInfo,
		// Shim Node's `global` to `window` for browser-targeted CJS packages.
		Define: map[string]string{"global": "window"},
		Banner: map[string]string{
			"js": "/* GENERATED from web/js/*.js by `go generate ./...` — do not edit by hand. */",
		},
	})
	if len(result.Errors) > 0 {
		log.Fatalf("esbuild: bundling failed with %d error(s)", len(result.Errors))
	}
}
