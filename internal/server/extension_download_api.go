package server

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

const javBossExtensionOrigin = "chrome-extension://iikdjhkpjihfkehccfmkpkdmenmbaacn"

func registerExtensionDownloadRoutes(router gin.IRoutes) {
	router.POST("/extension/downloads", createExtensionDownloadJob)
}

func createExtensionDownloadJob(c *gin.Context) {
	var request struct {
		MagnetURL string `json:"magnet_url"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "下载请求格式不正确", "Invalid download request")
		return
	}
	enqueueDownloadJob(c, request.MagnetURL)
}

func isJavBossExtensionOrigin(c *gin.Context) bool {
	return strings.TrimSuffix(strings.TrimSpace(c.GetHeader("Origin")), "/") == javBossExtensionOrigin
}
