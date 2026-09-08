package util

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadSTRMNormalizesAndDigestsHTTPURL(t *testing.T) {
	path := filepath.Join(t.TempDir(), "movie.STRM")
	if err := os.WriteFile(path, []byte("\ufeff\n https://media.example/movie.mp4?token=abc#player \r\n"), 0o600); err != nil {
		t.Fatalf("write strm: %v", err)
	}

	target, digest, err := ReadSTRM(path)
	if err != nil {
		t.Fatalf("ReadSTRM() error = %v", err)
	}
	if target != "https://media.example/movie.mp4?token=abc" {
		t.Fatalf("target = %q", target)
	}
	if !strings.HasPrefix(digest, "v1:") || len(digest) != len("v1:")+64 {
		t.Fatalf("digest = %q", digest)
	}

	source, err := ResolveMediaSource(path)
	if err != nil {
		t.Fatalf("ResolveMediaSource() error = %v", err)
	}
	if !source.IsSTRM || source.Input != target || source.STRMDigest != digest || source.LocatorPath != path {
		t.Fatalf("unexpected source: %#v", source)
	}
}

func TestReadSTRMRejectsUnsupportedContent(t *testing.T) {
	tests := []struct {
		name    string
		content string
	}{
		{name: "empty", content: "\n\r\n"},
		{name: "multiple URLs", content: "https://example.test/a\nhttps://example.test/b\n"},
		{name: "local path", content: "/videos/movie.mp4"},
		{name: "unsupported scheme", content: "rtsp://example.test/movie"},
		{name: "missing host", content: "https:///movie.mp4"},
		{name: "user info", content: "https://user:pass@example.test/movie.mp4"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "movie.strm")
			if err := os.WriteFile(path, []byte(test.content), 0o600); err != nil {
				t.Fatalf("write strm: %v", err)
			}
			if _, _, err := ReadSTRM(path); err == nil {
				t.Fatal("ReadSTRM() should reject invalid content")
			}
		})
	}
}

func TestResolveMediaSourceLeavesOrdinaryVideoPathUnchanged(t *testing.T) {
	path := "/videos/movie.mp4"
	source, err := ResolveMediaSource(path)
	if err != nil {
		t.Fatalf("ResolveMediaSource() error = %v", err)
	}
	if source.IsSTRM || source.Input != path || source.LocatorPath != path || source.STRMDigest != "" {
		t.Fatalf("unexpected source: %#v", source)
	}
}
