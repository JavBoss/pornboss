package server

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"

	"javboss/internal/runtimeconfig"
)

type browsableDirectory struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

type directoryBrowseResponse struct {
	Path        string               `json:"path"`
	Parent      string               `json:"parent"`
	Home        string               `json:"home"`
	Roots       []browsableDirectory `json:"roots"`
	Directories []browsableDirectory `json:"directories"`
}

// browseDirectories handles GET /directories/browse. The optional path is an
// absolute server path (defaults to the root of the user's home volume); show_hidden=true includes
// dot-prefixed directories. Only immediate subdirectories are returned, including
// symlinks to directories. Paths retain symlinks so mounted/host paths stay usable.
func browseDirectories(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if runtimeconfig.DisableDirectoryPicker() {
		respondLocalizedError(c, http.StatusNotImplemented, "当前部署模式已禁用目录选择器", "The directory picker is disabled in this deployment")
		return
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		home, _ = os.Getwd()
	}
	path := c.Query("path")
	if path == "" {
		path = filepath.VolumeName(home) + string(filepath.Separator)
	}
	if strings.ContainsRune(path, 0) || !filepath.IsAbs(path) {
		respondLocalizedError(c, http.StatusBadRequest, "请输入完整的绝对目录路径", "Enter a complete absolute directory path")
		return
	}
	path = filepath.Clean(path)
	info, err := os.Stat(path)
	if err == nil && !info.IsDir() {
		respondLocalizedError(c, http.StatusBadRequest, "该路径不是目录", "The path is not a directory")
		return
	}
	if err != nil {
		respondDirectoryBrowseError(c, err)
		return
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		respondDirectoryBrowseError(c, err)
		return
	}
	showHidden := c.Query("show_hidden") == "true"
	dirs := make([]browsableDirectory, 0, len(entries))
	for _, entry := range entries {
		if c.Request.Context().Err() != nil {
			return
		}
		if !showHidden && strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		childPath := filepath.Join(path, entry.Name())
		isDir := entry.IsDir()
		if entry.Type()&os.ModeSymlink != 0 {
			target, statErr := os.Stat(childPath)
			isDir = statErr == nil && target.IsDir()
		}
		if isDir {
			dirs = append(dirs, browsableDirectory{Name: entry.Name(), Path: childPath})
		}
	}
	sort.Slice(dirs, func(i, j int) bool {
		a, b := strings.ToLower(dirs[i].Name), strings.ToLower(dirs[j].Name)
		if a == b {
			return dirs[i].Name < dirs[j].Name
		}
		return a < b
	})
	parent := filepath.Dir(path)
	if parent == path {
		parent = ""
	}
	roots := []browsableDirectory{}
	if runtime.GOOS == "windows" {
		for drive := 'A'; drive <= 'Z'; drive++ {
			root := string(drive) + ":\\"
			if info, err := os.Stat(root); err == nil && info.IsDir() {
				roots = append(roots, browsableDirectory{Name: root, Path: root})
			}
		}
	} else {
		roots = append(roots, browsableDirectory{Name: "/", Path: "/"})
	}
	c.JSON(http.StatusOK, directoryBrowseResponse{Path: path, Parent: parent, Home: home, Roots: roots, Directories: dirs})
}

func respondDirectoryBrowseError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, os.ErrNotExist):
		respondLocalizedError(c, http.StatusNotFound, "目录不存在或已不可用", "The directory does not exist or is unavailable")
	case errors.Is(err, os.ErrPermission):
		respondLocalizedError(c, http.StatusForbidden, "没有权限读取该目录", "Permission denied when reading this directory")
	default:
		respondLocalizedError(c, http.StatusInternalServerError, "读取目录失败，请检查路径是否可访问", "Failed to read the directory; check that the path is accessible")
	}
}
