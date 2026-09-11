package server

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"javboss/internal/common/logging"
	dbpkg "javboss/internal/db"
	"javboss/internal/models"
)

const extensionTokenPrefix = "jbe_"

func newExtensionCredential() (string, error) {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return extensionTokenPrefix + base64.RawURLEncoding.EncodeToString(raw[:]), nil
}

func listExtensionTokens(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	items, err := dbpkg.ListExtensionTokens(c.Request.Context())
	if err != nil {
		extensionTokenError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func tokenExpiry(c *gin.Context, requireName bool) (string, time.Time, bool) {
	var req struct {
		Name          string `json:"name"`
		ExpiresInDays *int   `json:"expires_in_days"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "API 令牌请求格式无效", "Invalid token request")
		return "", time.Time{}, false
	}
	req.Name = strings.TrimSpace(req.Name)
	if requireName && (req.Name == "" || utf8.RuneCountInString(req.Name) > 80) {
		respondLocalizedError(c, http.StatusBadRequest, "API 令牌名称需为 1-80 个字符", "Token name must contain 1-80 characters")
		return "", time.Time{}, false
	}
	days := 365
	if req.ExpiresInDays != nil {
		days = *req.ExpiresInDays
	}
	if days < 0 || days > 365 {
		respondLocalizedError(c, http.StatusBadRequest, "API 令牌有效期需为 1-365 天，或 0 表示永不过期", "Token lifetime must be 1-365 days, or 0 for no expiration")
		return "", time.Time{}, false
	}
	if days == 0 {
		return req.Name, time.Time{}, true
	}
	return req.Name, time.Now().UTC().Add(time.Duration(days) * 24 * time.Hour), true
}

func createExtensionToken(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	name, expires, ok := tokenExpiry(c, true)
	if !ok {
		return
	}
	credential, err := newExtensionCredential()
	if err != nil {
		extensionTokenError(c, err)
		return
	}
	token := models.ExtensionToken{Name: name, Token: credential, CreatedAt: time.Now().UTC(), ExpiresAt: expires}
	if err := dbpkg.CreateExtensionToken(c.Request.Context(), &token); err != nil {
		extensionTokenError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"item": token, "token": credential})
}

func extensionTokenID(c *gin.Context) (uint, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil || id == 0 {
		respondLocalizedError(c, http.StatusBadRequest, "API 令牌 ID 无效", "Invalid token ID")
		return 0, false
	}
	return uint(id), true
}

func rotateExtensionToken(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	id, ok := extensionTokenID(c)
	if !ok {
		return
	}
	_, expires, ok := tokenExpiry(c, false)
	if !ok {
		return
	}
	credential, err := newExtensionCredential()
	if err != nil {
		extensionTokenError(c, err)
		return
	}
	token, err := dbpkg.RotateExtensionToken(c.Request.Context(), id, credential, expires)
	if err != nil {
		extensionTokenError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"item": token, "token": credential})
}

func deleteExtensionToken(c *gin.Context) {
	id, ok := extensionTokenID(c)
	if !ok {
		return
	}
	if err := dbpkg.DeleteExtensionToken(c.Request.Context(), id); err != nil {
		extensionTokenError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func extensionTokenError(c *gin.Context, err error) {
	if errors.Is(err, dbpkg.ErrExtensionTokenNotFound) {
		respondLocalizedError(c, http.StatusNotFound, "API 令牌不存在", "Token not found")
		return
	}
	logging.Error("extension token operation failed: %v", err)
	respondLocalizedError(c, http.StatusInternalServerError, "API 令牌操作失败", "API token operation failed")
}

// authenticateExtensionRequest is shared by every backend API accepting Bearer auth.
func authenticateExtensionRequest(c *gin.Context) bool {
	if !extensionTokenAPIAllowed(c.Request.Method, c.FullPath()) {
		rejectExtensionTokenAPI(c)
		return false
	}
	if !requestOriginAllowed(c.Request) && !isJavBossExtensionOrigin(c) {
		abortLocalizedError(c, http.StatusForbidden, "请求来源无效", "Invalid request origin")
		return false
	}
	parts := strings.Fields(c.GetHeader("Authorization"))
	valid := len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") && strings.HasPrefix(parts[1], extensionTokenPrefix)
	if valid {
		raw, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(parts[1], extensionTokenPrefix))
		valid = err == nil && len(raw) == 32 && len(parts[1]) == len(extensionTokenPrefix)+43
	}
	if !valid {
		rejectExtensionToken(c)
		return false
	}
	authenticated, err := dbpkg.UseExtensionToken(c.Request.Context(), parts[1], time.Now().UTC())
	if err != nil {
		c.Abort()
		extensionTokenError(c, err)
		return false
	}
	if !authenticated {
		rejectExtensionToken(c)
		return false
	}
	return true
}

func rejectExtensionToken(c *gin.Context) {
	c.Header("WWW-Authenticate", `Bearer realm="JavBoss extension"`)
	abortLocalizedError(c, http.StatusUnauthorized, "API 令牌无效或已过期，请在扩展中重新配置 Token", "Extension token is invalid or expired; configure a new token")
}
