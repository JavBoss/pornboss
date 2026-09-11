package server

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func registerExtensionRoutes(router gin.IRoutes) {
	router.POST("/extension/downloads", createExtensionDownloadJob)
	router.POST("/extension/jav/ownership", lookupExtensionJavOwnership)
	router.GET("/extension/status", func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		c.JSON(http.StatusOK, gin.H{"authenticated": true})
	})
}
