package server

import (
	"net/http"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"javboss/internal/common/logging"
	dbpkg "javboss/internal/db"
)

var extensionJavCodePattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9 ._-]*$`)

// lookupExtensionJavOwnership accepts JSON {"codes":["ABC-123", ...]} (1–200
// codes, at most 128 bytes each). No query parameters or library paths are used.
func lookupExtensionJavOwnership(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32*1024)
	var request struct {
		Codes []string `json:"codes"`
	}
	if err := c.ShouldBindJSON(&request); err != nil || len(request.Codes) == 0 || len(request.Codes) > 200 {
		respondLocalizedError(c, http.StatusBadRequest, "请提供 1–200 个影片番号", "Provide 1–200 movie codes")
		return
	}
	for i, code := range request.Codes {
		code = strings.TrimSpace(code)
		if len(code) > 128 || !extensionJavCodePattern.MatchString(code) {
			respondLocalizedError(c, http.StatusBadRequest, "影片番号格式无效", "Invalid movie code")
			return
		}
		request.Codes[i] = code
	}
	items, err := dbpkg.LookupJavOwnership(c.Request.Context(), request.Codes)
	if err != nil {
		logging.Error("extension jav ownership lookup failed: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "查询影片拥有状态失败", "Failed to query movie ownership")
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}
