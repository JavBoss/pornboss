package server

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// extensionTokenAPIs explicitly enables token authentication per method and route.
// All other APIs require their normal authentication, regardless of token validity.
var extensionTokenAPIs = map[string]map[string]bool{
	"/extension/downloads": {http.MethodPost: true},
	"/extension/status":    {http.MethodGet: true},
}

func extensionTokenAPIAllowed(method, path string) bool {
	return extensionTokenAPIs[path][method]
}

func rejectExtensionTokenAPI(c *gin.Context) {
	abortLocalizedError(c, http.StatusForbidden, "此接口不支持扩展 API 令牌", "This API does not accept extension API tokens")
}

// extensionAPIAccess applies the same route policy to requests and CORS preflights.
// It never enables cross-origin cookies or falls back to a cookie for Bearer requests.
func extensionAPIAccess() gin.HandlerFunc {
	return func(c *gin.Context) {
		extensionOrigin := isJavBossExtensionOrigin(c)
		if extensionOrigin {
			c.Header("Access-Control-Allow-Origin", javBossExtensionOrigin)
			c.Header("Vary", "Origin")
		}
		if c.Request.Method == http.MethodOptions && c.GetHeader("Origin") != "" {
			if !extensionOrigin {
				abortLocalizedError(c, http.StatusForbidden, "扩展来源无效", "Invalid extension origin")
				return
			}
			method := c.GetHeader("Access-Control-Request-Method")
			if !extensionTokenAPIAllowed(method, c.Request.URL.Path) {
				rejectExtensionTokenAPI(c)
				return
			}
			c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")
			c.Header("Access-Control-Allow-Methods", method)
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		if (extensionOrigin || c.GetHeader("Authorization") != "") && !extensionTokenAPIAllowed(c.Request.Method, c.FullPath()) {
			rejectExtensionTokenAPI(c)
			return
		}
		c.Next()
	}
}
