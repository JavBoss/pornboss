package mpv

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const modernZEnvDir = "JAVBOSS_MODERNZ_DIR"

var modernZRequiredFiles = []struct {
	source string
	target string
}{
	{source: "modernz.lua", target: filepath.Join("scripts", "modernz.lua")},
	{source: "modernz.conf", target: filepath.Join("script-opts", "modernz.conf")},
	{source: "modernz-icons.ttf", target: filepath.Join("fonts", "modernz-icons.ttf")},
	{source: "thumbfast.lua", target: filepath.Join("scripts", "thumbfast.lua")},
	{source: "thumbfast.conf", target: filepath.Join("script-opts", "thumbfast.conf")},
	{source: "playlist_sidebar.lua", target: filepath.Join("scripts", "playlist_sidebar.lua")},
	{source: "playlist_sidebar.conf", target: filepath.Join("script-opts", "playlist_sidebar.conf")},
	{source: "window_geometry.lua", target: filepath.Join("scripts", "window_geometry.lua")},
}

type modernZAssets struct {
	ConfigDir                string
	ScriptPath               string
	ThumbfastScriptPath      string
	PlaylistScriptPath       string
	WindowGeometryScriptPath string
}

func ensureModernZAssets() (modernZAssets, error) {
	sourceDir, err := findModernZSourceDir()
	if err != nil {
		return modernZAssets{}, err
	}

	configDir, err := sessionPath("config")
	if err != nil {
		return modernZAssets{}, err
	}
	for _, file := range modernZRequiredFiles {
		if err := syncModernZAsset(
			filepath.Join(sourceDir, file.source),
			filepath.Join(configDir, file.target),
		); err != nil {
			return modernZAssets{}, err
		}
	}

	return modernZAssets{
		ConfigDir:                configDir,
		ScriptPath:               filepath.Join(configDir, "scripts", "modernz.lua"),
		ThumbfastScriptPath:      filepath.Join(configDir, "scripts", "thumbfast.lua"),
		PlaylistScriptPath:       filepath.Join(configDir, "scripts", "playlist_sidebar.lua"),
		WindowGeometryScriptPath: filepath.Join(configDir, "scripts", "window_geometry.lua"),
	}, nil
}

func syncModernZAsset(sourcePath, targetPath string) error {
	sourceInfo, err := os.Stat(sourcePath)
	if err != nil {
		return fmt.Errorf("stat ModernZ asset %s: %w", sourcePath, err)
	}

	if targetInfo, err := os.Stat(targetPath); err == nil &&
		filepath.Base(sourcePath) == filepath.Base(targetPath) &&
		targetInfo.Size() == sourceInfo.Size() {
		return nil
	}

	content, err := os.ReadFile(sourcePath)
	if err != nil {
		return fmt.Errorf("read ModernZ asset %s: %w", sourcePath, err)
	}

	if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
		return fmt.Errorf("create ModernZ asset dir: %w", err)
	}
	if err := os.WriteFile(targetPath, content, 0o644); err != nil {
		return fmt.Errorf("write ModernZ asset %s: %w", targetPath, err)
	}
	return nil
}

func findModernZSourceDir() (string, error) {
	if dir := os.Getenv(modernZEnvDir); dir != "" {
		return validateModernZSourceDir(dir)
	}

	var bases []string
	if cwd, err := os.Getwd(); err == nil {
		bases = append(bases, cwd)
	}
	if exe, err := os.Executable(); err == nil {
		bases = append(bases, filepath.Dir(exe))
	}

	seen := make(map[string]struct{}, len(bases))
	for _, base := range bases {
		for _, candidate := range modernZCandidateDirs(base) {
			abs, err := filepath.Abs(candidate)
			if err == nil {
				candidate = abs
			}
			if _, ok := seen[candidate]; ok {
				continue
			}
			seen[candidate] = struct{}{}
			if dir, err := validateModernZSourceDir(candidate); err == nil {
				return dir, nil
			}
		}
	}

	return "", errors.New("ModernZ assets not found; expected ModernZ, thumbfast, and playlist sidebar assets")
}

func modernZCandidateDirs(base string) []string {
	var candidates []string
	dir := base
	for i := 0; i < 5; i++ {
		candidates = append(candidates, filepath.Join(dir, "modernz"))
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return candidates
}

func validateModernZSourceDir(dir string) (string, error) {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return "", err
	}
	for _, file := range modernZRequiredFiles {
		if _, err := os.Stat(filepath.Join(abs, file.source)); err != nil {
			return "", err
		}
	}
	return abs, nil
}
