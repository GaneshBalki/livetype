package main

import (
	"bytes"
	"html/template"
	"log"
	"net/http"

	"livetype/web"
)

// Tools: small developer tools at /tools/{slug}. Each runs in the browser
// (web/js/tools.js); the server only renders the page so search engines see
// a real title, description and help text for every tool.

type help struct{ B, T string }

type tool struct {
	Slug, Name, Group, Title, Desc, Blurb, Icon string
	Href                                         string // set for tools that live elsewhere (the diff checker)
	Help                                         []help
}

func (t *tool) URL() string {
	if t.Href != "" {
		return t.Href
	}
	return "/tools/" + t.Slug
}

var toolGroups = []string{"Data", "Encode", "Text"}

var tools = []*tool{
	{Slug: "json", Name: "JSON Formatter", Group: "Data", Icon: "M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1",
		Title: "JSON Formatter and Validator – Online, Free | DevShire",
		Desc:  "Format, validate and minify JSON in your browser. Pinpoints the line and column of any error, sorts keys, and never uploads your data.",
		Blurb: "Format, validate and minify JSON. Errors point to the exact line.",
		Help: []help{
			{"Format or minify:", "pretty-print with 2 spaces, 4 spaces or tabs, or squeeze it onto one line."},
			{"Errors:", "invalid JSON shows the line and column of the problem."},
			{"Sort keys:", "orders every object's keys A to Z, handy before comparing two files."},
			{"Private:", "everything runs on your device. Nothing is uploaded."},
		}},
	{Slug: "timestamp", Name: "Timestamp Converter", Group: "Data", Icon: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
		Title: "Unix Timestamp Converter – Epoch to Date, Free | DevShire",
		Desc:  "Convert Unix timestamps (seconds, milliseconds, microseconds) to dates and back. Shows UTC, your local time, ISO 8601 and how long ago.",
		Blurb: "Unix time to date and back, in UTC and your time zone.",
		Help: []help{
			{"Any format:", "paste seconds, milliseconds, microseconds, an ISO date or a date like 2026-11-27 14:30."},
			{"Units:", "the unit is detected from the number of digits."},
			{"Now:", "the current time ticks at the top. Click a value to copy it."},
		}},
	{Slug: "base64", Name: "Base64 Encoder", Group: "Encode", Icon: "M4 7V5h16v2M9 19h6M12 5v14",
		Title: "Base64 Encode and Decode – Online, Free | DevShire",
		Desc:  "Encode text to Base64 or decode Base64 to text, with full UTF-8 and URL-safe support. Runs in your browser.",
		Blurb: "Encode and decode Base64, with UTF-8 and URL-safe mode.",
		Help: []help{
			{"UTF-8:", "emoji and any language encode correctly."},
			{"URL-safe:", "uses - and _ instead of + and /, without = padding (as in JWTs)."},
			{"Forgiving decode:", "spaces, line breaks and missing padding are fine."},
		}},
	{Slug: "url", Name: "URL Encoder", Group: "Encode", Icon: "M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1",
		Title: "URL Encode and Decode – Online, Free | DevShire",
		Desc:  "Percent-encode or decode URLs and query strings, and see a URL split into its parts and parameters. Runs in your browser.",
		Blurb: "Percent-encode or decode URLs and see every query parameter.",
		Help: []help{
			{"Component or full URL:", "encode a single value (everything special is escaped) or a whole URL (keeps : / ? & =)."},
			{"Parts:", "a full URL is split into host, path and each query parameter, decoded."},
			{"+ as space:", "form data uses + for spaces; turn this on to decode it."},
		}},
	{Slug: "jwt", Name: "JWT Decoder", Group: "Encode", Icon: "M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z",
		Title: "JWT Decoder – Decode JSON Web Tokens Online | DevShire",
		Desc:  "Decode a JWT to read its header and payload, with expiry and issue times as real dates. The token never leaves your browser.",
		Blurb: "Read a token's header and payload, with expiry as a real date.",
		Help: []help{
			{"Decoded, not verified:", "checking the signature needs the secret key, which should never leave your server."},
			{"Times:", "exp, iat and nbf are shown as dates, with whether the token has expired."},
			{"Private:", "tokens are decoded on your device and never sent anywhere."},
		}},
	{Slug: "diff", Name: "Diff Checker", Group: "Text", Href: "/diff", Icon: "M9 3v18M15 3v18M4 3h16v18H4z",
		Blurb: "Compare two texts or files and see every change, word by word."},
}

func toolBySlug(slug string) *tool {
	for _, t := range tools {
		if t.Slug == slug && t.Href == "" {
			return t
		}
	}
	return nil
}

type toolGroup struct {
	Name  string
	Tools []*tool
}

type toolPage struct {
	Tool   *tool
	Groups []toolGroup
}

var toolTmpl = template.Must(template.ParseFS(web.FS, "tool.html"))

func toolHandler(w http.ResponseWriter, r *http.Request) {
	var t *tool
	if slug := r.PathValue("slug"); slug != "" {
		if t = toolBySlug(slug); t == nil {
			http.NotFound(w, r)
			return
		}
	}
	data := toolPage{Tool: t}
	for _, g := range toolGroups {
		tg := toolGroup{Name: g}
		for _, x := range tools {
			if x.Group == g {
				tg.Tools = append(tg.Tools, x)
			}
		}
		data.Groups = append(data.Groups, tg)
	}
	var buf bytes.Buffer
	if err := toolTmpl.Execute(&buf, data); err != nil {
		log.Printf("tool page: %v", err)
		http.Error(w, "page error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(buf.Bytes())
}

// sitemapXML lists the public pages, including every tool.
func sitemapXML() string {
	s := `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`
	for _, p := range []string{"/", "/diff", "/tools"} {
		s += "<url><loc>https://devshire.in" + p + "</loc></url>"
	}
	for _, t := range tools {
		if t.Href == "" {
			s += "<url><loc>https://devshire.in/tools/" + t.Slug + "</loc></url>"
		}
	}
	return s + "<url><loc>https://devshire.in/privacy</loc></url></urlset>"
}
