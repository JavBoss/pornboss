package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestBrowseDirectories(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("JAVBOSS_DISABLE_DIRECTORY_PICKER", "")
	// Browsing must work without a desktop, including in container mode.
	t.Setenv("JAVBOSS_CONTAINER", "1")
	root := t.TempDir()
	for _, name := range []string{"alpha", "Beta", ".hidden", "中文 & #"} {
		if err := os.Mkdir(filepath.Join(root, name), 0700); err != nil {
			t.Fatal(err)
		}
	}
	file := filepath.Join(root, "video.mp4")
	if err := os.WriteFile(file, []byte("video"), 0600); err != nil {
		t.Fatal(err)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	router.GET("/directories/browse", browseDirectories)
	for _, tt := range []struct {
		name, path, hidden string
		status             int
		names              []string
	}{
		{"directories only", root, "", 200, []string{"alpha", "Beta", "中文 & #"}},
		{"hidden directories", root, "true", 200, []string{".hidden", "alpha", "Beta", "中文 & #"}},
		{"empty directory", filepath.Join(root, "alpha"), "", 200, []string{}},
		{"special characters", filepath.Join(root, "中文 & #"), "", 200, []string{}},
		{"file", file, "", 400, nil},
		{"relative path", "relative", "", 400, nil},
		{"invalid path", root + "\x00", "", 400, nil},
		{"missing directory", filepath.Join(root, "missing"), "", 404, nil},
	} {
		t.Run(tt.name, func(t *testing.T) {
			params := url.Values{"path": {tt.path}, "show_hidden": {tt.hidden}}
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/directories/browse?"+params.Encode(), nil))
			if recorder.Code != tt.status {
				t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
			}
			if recorder.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("filesystem responses must not be cached")
			}
			if tt.status != 200 {
				return
			}
			var data directoryBrowseResponse
			if err := json.Unmarshal(recorder.Body.Bytes(), &data); err != nil {
				t.Fatal(err)
			}
			expectedPath := tt.path
			if expectedPath == "" {
				expectedPath = root
			}
			if data.Path != expectedPath || data.Parent != filepath.Dir(expectedPath) || data.Home != home {
				t.Fatalf("unexpected paths: %+v", data)
			}
			if len(data.Roots) == 0 {
				t.Fatal("missing filesystem roots")
			}
			names := []string{}
			for _, entry := range data.Directories {
				names = append(names, entry.Name)
				if entry.Path != filepath.Join(data.Path, entry.Name) {
					t.Fatalf("unexpected child path: %+v", entry)
				}
			}
			if !reflect.DeepEqual(names, tt.names) {
				t.Fatalf("names = %v, want %v", names, tt.names)
			}
		})
	}
}

func TestBrowseDirectorySymlinksAndRoot(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("JAVBOSS_DISABLE_DIRECTORY_PICKER", "")
	root := t.TempDir()
	target := t.TempDir()
	if err := os.Symlink(target, filepath.Join(root, "linked")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if err := os.Symlink(filepath.Join(root, "missing"), filepath.Join(root, "broken")); err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	router.GET("/directories/browse", browseDirectories)
	browse := func(path string) directoryBrowseResponse {
		t.Helper()
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/directories/browse?path="+url.QueryEscape(path), nil))
		if recorder.Code != 200 {
			t.Fatalf("status = %d: %s", recorder.Code, recorder.Body.String())
		}
		var data directoryBrowseResponse
		if err := json.Unmarshal(recorder.Body.Bytes(), &data); err != nil {
			t.Fatal(err)
		}
		return data
	}
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	defaultRoot := filepath.VolumeName(home) + string(filepath.Separator)
	if data := browse(""); data.Path != defaultRoot || data.Parent != "" {
		t.Fatalf("default path = %q, parent = %q, want root %q without parent", data.Path, data.Parent, defaultRoot)
	}
	data := browse(root)
	if len(data.Directories) != 1 || data.Directories[0].Name != "linked" {
		t.Fatalf("unexpected directories: %+v", data.Directories)
	}
	linked := filepath.Join(root, "linked")
	if data := browse(linked); data.Path != linked || data.Parent != root {
		t.Fatalf("symlink path changed: %+v", data)
	}
	filesystemRoot := filepath.VolumeName(root) + string(filepath.Separator)
	if data := browse(filesystemRoot); data.Parent != "" {
		t.Fatalf("root parent = %q", data.Parent)
	}
}

func TestBrowseDirectoriesDisabledAndAuthentication(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("JAVBOSS_DISABLE_DIRECTORY_PICKER", "1")
	router := gin.New()
	router.GET("/directories/browse", browseDirectories)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/directories/browse", nil))
	if recorder.Code != http.StatusNotImplemented {
		t.Fatalf("disabled status = %d", recorder.Code)
	}
	protected := NewRouter("", testAuthService(t))
	recorder = httptest.NewRecorder()
	protected.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/directories/browse", nil))
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status = %d", recorder.Code)
	}
}

func TestBrowseDirectoryPermissionDenied(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("JAVBOSS_DISABLE_DIRECTORY_PICKER", "")
	path := t.TempDir()
	if err := os.Chmod(path, 0); err != nil {
		t.Skipf("cannot remove directory permissions: %v", err)
	}
	t.Cleanup(func() { _ = os.Chmod(path, 0700) })
	if _, err := os.ReadDir(path); err == nil {
		t.Skip("current user can read directories without permission bits")
	}
	router := gin.New()
	router.GET("/directories/browse", browseDirectories)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/directories/browse?path="+url.QueryEscape(path), nil))
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
}
