package util

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

const maxSTRMFileSize int64 = 64 * 1024

// MediaSource separates the local locator managed by JavBoss from the input
// consumed by media tools. For ordinary videos both values are the same; for
// STRM files Input is the HTTP(S) URL stored in the locator file.
type MediaSource struct {
	LocatorPath string
	Input       string
	IsSTRM      bool
	STRMDigest  string
}

// IsSTRMPath reports whether path names an STRM locator.
func IsSTRMPath(path string) bool {
	return strings.EqualFold(filepath.Ext(strings.TrimSpace(path)), ".strm")
}

// ResolveMediaSource resolves an ordinary video path or reads an STRM locator.
func ResolveMediaSource(locatorPath string) (MediaSource, error) {
	locatorPath = strings.TrimSpace(locatorPath)
	if locatorPath == "" {
		return MediaSource{}, errors.New("media locator path is required")
	}
	if !IsSTRMPath(locatorPath) {
		return MediaSource{LocatorPath: locatorPath, Input: locatorPath}, nil
	}

	target, digest, err := ReadSTRM(locatorPath)
	if err != nil {
		return MediaSource{}, err
	}
	return MediaSource{
		LocatorPath: locatorPath,
		Input:       target,
		IsSTRM:      true,
		STRMDigest:  digest,
	}, nil
}

// ReadSTRM reads a single HTTP(S) media URL and returns its normalized value
// and versioned SHA-256 digest.
func ReadSTRM(path string) (string, string, error) {
	info, err := os.Stat(path)
	if err != nil {
		return "", "", fmt.Errorf("stat strm file: %w", err)
	}
	if !info.Mode().IsRegular() {
		return "", "", errors.New("strm path is not a regular file")
	}
	if info.Size() > maxSTRMFileSize {
		return "", "", fmt.Errorf("strm file exceeds %d bytes", maxSTRMFileSize)
	}

	file, err := os.Open(path)
	if err != nil {
		return "", "", fmt.Errorf("open strm file: %w", err)
	}
	defer file.Close()

	content, err := io.ReadAll(io.LimitReader(file, maxSTRMFileSize+1))
	if err != nil {
		return "", "", fmt.Errorf("read strm file: %w", err)
	}
	if int64(len(content)) > maxSTRMFileSize {
		return "", "", fmt.Errorf("strm file exceeds %d bytes", maxSTRMFileSize)
	}
	if !utf8.Valid(content) {
		return "", "", errors.New("strm file must be UTF-8")
	}

	target, err := parseSTRMContent(string(content))
	if err != nil {
		return "", "", err
	}
	sum := sha256.Sum256([]byte(target))
	return target, "v1:" + hex.EncodeToString(sum[:]), nil
}

func parseSTRMContent(content string) (string, error) {
	content = strings.TrimPrefix(content, "\ufeff")
	scanner := bufio.NewScanner(strings.NewReader(content))
	scanner.Buffer(make([]byte, 1024), int(maxSTRMFileSize)+1)
	var target string
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		if target != "" {
			return "", errors.New("strm file must contain exactly one URL")
		}
		target = line
	}
	if err := scanner.Err(); err != nil {
		return "", fmt.Errorf("scan strm file: %w", err)
	}
	if target == "" {
		return "", errors.New("strm file contains no URL")
	}

	parsed, err := url.Parse(target)
	if err != nil {
		return "", fmt.Errorf("parse strm URL: %w", err)
	}
	if !strings.EqualFold(parsed.Scheme, "http") && !strings.EqualFold(parsed.Scheme, "https") {
		return "", errors.New("strm URL must use http or https")
	}
	if parsed.Hostname() == "" {
		return "", errors.New("strm URL must include a host")
	}
	if parsed.User != nil {
		return "", errors.New("strm URL must not include user information")
	}
	parsed.Scheme = strings.ToLower(parsed.Scheme)
	parsed.Fragment = ""
	return parsed.String(), nil
}
