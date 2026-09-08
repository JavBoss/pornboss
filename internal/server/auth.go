package server

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"javboss/internal/common/logging"
	dbpkg "javboss/internal/db"
	"javboss/internal/models"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

const (
	authSessionCookie = "javboss_session"
	authSessionTTL    = 14 * 24 * time.Hour
	authRenewInterval = 24 * time.Hour
	maxLoginFailures  = 5
	loginLockout      = 30 * time.Second
)

var (
	errInvalidCredentials = errors.New("invalid credentials")
	errLoginLocked        = errors.New("login temporarily locked")
	errInvalidSession     = errors.New("invalid session")
)

type authSession struct {
	expiresAt          time.Time
	persistedExpiresAt time.Time
	version            uint64
}

type loginAttempt struct {
	failures    int
	lockedUntil time.Time
}

// AuthService owns the single-user credential and in-memory browser sessions.
type AuthService struct {
	mu             sync.Mutex
	passwordHash   string
	sessionVersion uint64
	sessions       map[[sha256.Size]byte]authSession
	attempts       map[string]loginAttempt
	cookieName     string
	now            func() time.Time
}

func NewAuthService(ctx context.Context) (*AuthService, error) {
	return newAuthService(ctx, authSessionCookie)
}

// NewAuthServiceForInstance namespaces the session cookie by installation directory.
func NewAuthServiceForInstance(ctx context.Context, instanceDir string) (*AuthService, error) {
	cookieName, err := authCookieNameForInstance(instanceDir)
	if err != nil {
		return nil, err
	}
	return newAuthService(ctx, cookieName)
}

func newAuthService(ctx context.Context, cookieName string) (*AuthService, error) {
	account, err := dbpkg.GetAuthAccount(ctx)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	persistedSessions, err := dbpkg.ListActiveAuthSessions(ctx, account.SessionVersion, now)
	if err != nil {
		return nil, err
	}
	sessions := make(map[[sha256.Size]byte]authSession, len(persistedSessions))
	for _, persisted := range persistedSessions {
		key, ok := sessionKeyFromHash(persisted.TokenHash)
		if !ok {
			continue
		}
		sessions[key] = authSession{
			expiresAt:          persisted.ExpiresAt,
			persistedExpiresAt: persisted.ExpiresAt,
			version:            persisted.SessionVersion,
		}
	}
	return &AuthService{
		passwordHash:   account.PasswordHash,
		sessionVersion: account.SessionVersion,
		sessions:       sessions,
		attempts:       make(map[string]loginAttempt),
		cookieName:     cookieName,
		now:            time.Now,
	}, nil
}

func authCookieNameForInstance(instanceDir string) (string, error) {
	if strings.TrimSpace(instanceDir) == "" {
		return "", fmt.Errorf("resolve auth cookie name: empty instance directory")
	}
	normalized, err := filepath.Abs(instanceDir)
	if err != nil {
		return "", fmt.Errorf("resolve auth cookie instance directory: %w", err)
	}
	normalized = filepath.Clean(normalized)
	if resolved, resolveErr := filepath.EvalSymlinks(normalized); resolveErr == nil {
		normalized = filepath.Clean(resolved)
	}
	if runtime.GOOS == "windows" {
		normalized = strings.ToLower(normalized)
	}
	digest := sha256.Sum256([]byte(normalized))
	return authSessionCookie + "_" + hex.EncodeToString(digest[:8]), nil
}

func (a *AuthService) Login(ctx context.Context, client, password string) (string, time.Duration, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	now := a.now()
	attempt := a.attempts[client]
	if now.Before(attempt.lockedUntil) {
		return "", attempt.lockedUntil.Sub(now), errLoginLocked
	}
	if bcrypt.CompareHashAndPassword([]byte(a.passwordHash), []byte(password)) != nil {
		attempt.failures++
		if attempt.failures >= maxLoginFailures {
			attempt.failures = 0
			attempt.lockedUntil = now.Add(loginLockout)
		}
		a.attempts[client] = attempt
		if now.Before(attempt.lockedUntil) {
			return "", loginLockout, errLoginLocked
		}
		return "", 0, errInvalidCredentials
	}
	delete(a.attempts, client)
	return a.newSessionLocked(ctx, now)
}

func (a *AuthService) Logout(ctx context.Context, token string) error {
	key, ok := sessionKey(token)
	if !ok {
		return nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := dbpkg.DeleteAuthSession(ctx, sessionHash(key)); err != nil {
		return err
	}
	delete(a.sessions, key)
	return nil
}

func (a *AuthService) Authenticated(token string) bool {
	key, ok := sessionKey(token)
	if !ok {
		return false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	session, ok := a.sessions[key]
	if !ok {
		return false
	}
	if !a.now().Before(session.expiresAt) || session.version != a.sessionVersion {
		delete(a.sessions, key)
		return false
	}
	return true
}

func (a *AuthService) authenticateRequest(ctx context.Context, token string) (bool, time.Duration, bool, error) {
	key, ok := sessionKey(token)
	if !ok {
		return false, 0, false, nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()

	now := a.now()
	session, ok := a.sessions[key]
	if !ok {
		return false, 0, false, nil
	}
	if !now.Before(session.expiresAt) || session.version != a.sessionVersion {
		delete(a.sessions, key)
		return false, 0, false, nil
	}

	expiresAt := now.Add(authSessionTTL)
	session.expiresAt = expiresAt
	if session.persistedExpiresAt.Sub(now) <= authSessionTTL-authRenewInterval {
		if err := dbpkg.RenewAuthSession(ctx, sessionHash(key), session.version, expiresAt, now); err != nil {
			a.sessions[key] = session
			return true, authSessionTTL, true, err
		}
		session.persistedExpiresAt = expiresAt
	}
	a.sessions[key] = session
	return true, authSessionTTL, true, nil
}

func (a *AuthService) ChangePassword(ctx context.Context, token, currentPassword, newPassword string) (string, error) {
	key, ok := sessionKey(token)
	if !ok {
		return "", errInvalidSession
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	now := a.now()
	session, ok := a.sessions[key]
	if !ok || !now.Before(session.expiresAt) || session.version != a.sessionVersion {
		delete(a.sessions, key)
		return "", errInvalidSession
	}
	if bcrypt.CompareHashAndPassword([]byte(a.passwordHash), []byte(currentPassword)) != nil {
		return "", errInvalidCredentials
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	token, key, expiresAt, err := generateSession(now)
	if err != nil {
		return "", err
	}
	account, err := dbpkg.UpdateAuthPasswordAndReplaceSessions(ctx, string(passwordHash), models.AuthSession{
		TokenHash: sessionHash(key),
		ExpiresAt: expiresAt,
		CreatedAt: now,
	})
	if err != nil {
		return "", err
	}
	a.passwordHash = account.PasswordHash
	a.sessionVersion = account.SessionVersion
	a.sessions = map[[sha256.Size]byte]authSession{
		key: {
			expiresAt:          expiresAt,
			persistedExpiresAt: expiresAt,
			version:            account.SessionVersion,
		},
	}
	return token, nil
}

func (a *AuthService) newSessionLocked(ctx context.Context, now time.Time) (string, time.Duration, error) {
	for key, session := range a.sessions {
		if !now.Before(session.expiresAt) || session.version != a.sessionVersion {
			delete(a.sessions, key)
		}
	}
	token, key, expiresAt, err := generateSession(now)
	if err != nil {
		return "", 0, err
	}
	if err := dbpkg.CreateAuthSession(ctx, models.AuthSession{
		TokenHash:      sessionHash(key),
		SessionVersion: a.sessionVersion,
		ExpiresAt:      expiresAt,
		CreatedAt:      now,
	}, now); err != nil {
		return "", 0, err
	}
	a.sessions[key] = authSession{
		expiresAt:          expiresAt,
		persistedExpiresAt: expiresAt,
		version:            a.sessionVersion,
	}
	return token, authSessionTTL, nil
}

func generateSession(now time.Time) (string, [sha256.Size]byte, time.Time, error) {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", [sha256.Size]byte{}, time.Time{}, err
	}
	token := base64.RawURLEncoding.EncodeToString(raw[:])
	return token, sha256.Sum256([]byte(token)), now.Add(authSessionTTL), nil
}

func sessionKey(token string) ([sha256.Size]byte, bool) {
	if len(token) != 43 {
		return [sha256.Size]byte{}, false
	}
	if _, err := base64.RawURLEncoding.DecodeString(token); err != nil {
		return [sha256.Size]byte{}, false
	}
	return sha256.Sum256([]byte(token)), true
}

func sessionKeyFromHash(value string) ([sha256.Size]byte, bool) {
	decoded, err := hex.DecodeString(value)
	if err != nil || len(decoded) != sha256.Size {
		return [sha256.Size]byte{}, false
	}
	var key [sha256.Size]byte
	copy(key[:], decoded)
	return key, true
}

func sessionHash(key [sha256.Size]byte) string {
	return hex.EncodeToString(key[:])
}

func (a *AuthService) requireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetHeader("Authorization") != "" || isJavBossExtensionOrigin(c) {
			if authenticateExtensionRequest(c) {
				c.Next()
			}
			return
		}
		token := requestSessionToken(c, a.cookieName)
		if !requestOriginAllowed(c.Request) {
			abortLocalizedError(c, http.StatusForbidden, "请求来源无效", "Invalid request origin")
			return
		}
		authenticated, cookieTTL, renewed, err := a.authenticateRequest(c.Request.Context(), token)
		if err != nil {
			logging.Error("renew auth session error: %v", err)
		}
		if !authenticated {
			abortLocalizedError(c, http.StatusUnauthorized, "需要登录后才能继续", "Authentication is required")
			return
		}
		if renewed {
			setAuthCookie(c, a.cookieName, token, cookieTTL)
		}
		c.Next()
	}
}

func requestOriginAllowed(req *http.Request) bool {
	switch req.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	}
	switch strings.ToLower(strings.TrimSpace(req.Header.Get("Sec-Fetch-Site"))) {
	case "same-origin", "none":
		return true
	case "same-site", "cross-site":
		return false
	}
	origin := strings.TrimSpace(req.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return false
	}
	expectedScheme := "http"
	if req.TLS != nil || strings.EqualFold(firstForwardedValue(req.Header.Get("X-Forwarded-Proto")), "https") {
		expectedScheme = "https"
	}
	expectedHost := req.Host
	if forwardedHost := firstForwardedValue(req.Header.Get("X-Forwarded-Host")); forwardedHost != "" {
		expectedHost = forwardedHost
	}
	return strings.EqualFold(parsed.Scheme, expectedScheme) && strings.EqualFold(parsed.Host, expectedHost)
}

func requestClient(req *http.Request) string {
	host, _, err := net.SplitHostPort(req.RemoteAddr)
	if err == nil && host != "" {
		return host
	}
	return req.RemoteAddr
}

func requestSessionToken(c *gin.Context, cookieName string) string {
	token, _ := c.Cookie(cookieName)
	return token
}

func setAuthCookie(c *gin.Context, cookieName, token string, ttl time.Duration) {
	secure := c.Request.TLS != nil || strings.EqualFold(firstForwardedValue(c.GetHeader("X-Forwarded-Proto")), "https")
	maxAge := int(ttl.Seconds())
	if maxAge < 1 {
		maxAge = 1
	}
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     cookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
	})
}

func clearAuthCookie(c *gin.Context, cookieName string) {
	secure := c.Request.TLS != nil || strings.EqualFold(firstForwardedValue(c.GetHeader("X-Forwarded-Proto")), "https")
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     cookieName,
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
	})
}

func firstForwardedValue(value string) string {
	first, _, _ := strings.Cut(value, ",")
	return strings.TrimSpace(first)
}
