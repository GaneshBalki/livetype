// Package web embeds the static frontend so the server ships as one binary.
package web

import "embed"

//go:embed *.html css img js
var FS embed.FS
