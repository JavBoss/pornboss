package server

import (
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"javboss/internal/common/logging"
)

// NewRouter constructs a gin router with API routes and optional static file serving.
func NewRouter(staticDir string, auth *AuthService) *gin.Engine {
	router := gin.New()
	router.Use(ginLogger(), gin.Recovery(), extensionAPIAccess())
	router.GET("/healthz", handleHealth)
	registerAuthRoutes(router, auth)
	protected := router.Group("/")
	protected.Use(auth.requireAuth())
	registerExtensionDownloadRoutes(protected)
	protected.POST("/extension/jav/ownership", lookupExtensionJavOwnership)
	protected.GET("/extension/status", func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		c.JSON(http.StatusOK, gin.H{"authenticated": true})
	})
	registerProtectedAuthRoutes(protected, auth)
	registerExtensionTokenRoutes(protected)
	RegisterRoutes(protected)

	if staticDir != "" {
		if fi, err := os.Stat(staticDir); err == nil && fi.IsDir() {
			staticRoot, rootErr := filepath.Abs(staticDir)
			if rootErr != nil {
				logging.Error("resolve frontend static path error: %v", rootErr)
				staticRoot = staticDir
			}
			if resolvedRoot, resolveErr := filepath.EvalSymlinks(staticRoot); resolveErr == nil {
				staticRoot = resolvedRoot
			}
			indexPath := filepath.Join(staticDir, "index.html")
			indexHandler := func(c *gin.Context) {
				serveIndexHTML(c, indexPath)
			}
			router.GET("/", indexHandler)
			router.HEAD("/", indexHandler)
			router.GET("/index.html", indexHandler)
			router.HEAD("/index.html", indexHandler)

			router.NoRoute(func(c *gin.Context) {
				path := c.Request.URL.Path
				if isAPIPath(path) {
					respondLocalizedError(c, http.StatusNotFound, "接口不存在", "API endpoint was not found")
					return
				}
				if serveFrontendStaticFile(c, staticRoot) {
					return
				}
				if strings.Contains(c.GetHeader("Accept"), "text/html") {
					serveIndexHTML(c, indexPath)
					return
				}
				respondLocalizedError(c, http.StatusNotFound, "请求的资源不存在", "The requested resource was not found")
			})

			logging.Info("serving frontend from %s", staticDir)
		} else if err == nil {
			logging.Error("static path %s is not a directory; frontend serving disabled", staticDir)
		} else if !errors.Is(err, os.ErrNotExist) {
			logging.Error("static path check error: %v", err)
		}
	}

	return router
}

func isAPIPath(path string) bool {
	for _, prefix := range []string{
		"/auth",
		"/config",
		"/directories",
		"/downloader",
		"/downloads",
		"/extension",
		"/healthz",
		"/jav",
		"/sync",
		"/tags",
		"/tools",
		"/videos",
	} {
		if path == prefix || strings.HasPrefix(path, prefix+"/") {
			return true
		}
	}
	return false
}

func serveFrontendStaticFile(c *gin.Context, staticRoot string) bool {
	if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
		return false
	}

	relativePath := strings.TrimPrefix(c.Request.URL.Path, "/")
	if !fs.ValidPath(relativePath) || strings.Contains(relativePath, `\`) {
		return false
	}

	filePath, err := filepath.EvalSymlinks(filepath.Join(staticRoot, filepath.FromSlash(relativePath)))
	if err != nil {
		return false
	}
	relativeToRoot, err := filepath.Rel(staticRoot, filePath)
	if err != nil || relativeToRoot == ".." || strings.HasPrefix(relativeToRoot, ".."+string(filepath.Separator)) {
		return false
	}
	info, err := os.Stat(filePath)
	if err != nil || !info.Mode().IsRegular() {
		return false
	}

	if strings.EqualFold(filepath.Ext(filePath), ".webmanifest") {
		c.Header("Content-Type", "application/manifest+json")
	}
	c.File(filePath)
	return true
}

func serveIndexHTML(c *gin.Context, indexPath string) {
	data, err := os.ReadFile(indexPath)
	if err != nil {
		logging.Error("read frontend index error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "前端页面暂不可用", "The frontend is unavailable")
		return
	}
	c.Header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
	c.Header("Pragma", "no-cache")
	c.Header("Expires", "0")
	if c.Request.Method == http.MethodHead {
		c.Header("Content-Type", "text/html; charset=utf-8")
		c.Status(http.StatusOK)
		return
	}
	c.Data(http.StatusOK, "text/html; charset=utf-8", data)
}

func ginLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		logging.Info("%s %s %d %dB %s", c.Request.Method, c.Request.URL.Path, c.Writer.Status(), c.Writer.Size(), time.Since(start))
	}
}
