package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"javboss/internal/common"
	dbpkg "javboss/internal/db"
	"javboss/internal/models"
)

func TestExtensionTokenLifecycle(t *testing.T) {
	auth := testAuthService(t)
	router := NewRouter("", auth)
	login := performRequest(router, http.MethodPost, "/auth/login", []byte(`{"password":"admin"}`), "http://example.com", nil)
	cookie := responseCookie(t, login, auth.cookieName)
	admin := func(method, path, body string) *httptest.ResponseRecorder {
		return performRequest(router, method, path, []byte(body), "http://example.com", cookie)
	}
	for _, route := range []struct{ method, path, body string }{
		{"GET", "/auth/extension-tokens", ""}, {"POST", "/auth/extension-tokens", `{"name":"browser"}`},
		{"POST", "/auth/extension-tokens/1/rotate", `{}`}, {"DELETE", "/auth/extension-tokens/1", ""},
	} {
		if got := performRequest(router, route.method, route.path, []byte(route.body), "", nil).Code; got != 401 {
			t.Fatalf("anonymous %s %s: %d", route.method, route.path, got)
		}
	}
	create := func(name string) (models.ExtensionToken, string) {
		t.Helper()
		response := admin("POST", "/auth/extension-tokens", fmt.Sprintf(`{"name":%q,"expires_in_days":30}`, name))
		if response.Code != 201 {
			t.Fatalf("create status=%d", response.Code)
		}
		if response.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("credential response is cacheable")
		}
		var payload struct {
			Item  models.ExtensionToken `json:"item"`
			Token string                `json:"token"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		if payload.Item.Token != payload.Token || len(payload.Token) != 47 {
			t.Fatal("invalid token response")
		}
		return payload.Item, payload.Token
	}
	first, credential := create("laptop")
	second, other := create("desktop")
	if first.ID == second.ID || credential == other {
		t.Fatal("tokens are not independent")
	}
	var persisted models.ExtensionToken
	if err := common.DB.First(&persisted, first.ID).Error; err != nil {
		t.Fatal(err)
	}
	if persisted.Token != credential {
		t.Fatal("credential was not persisted")
	}
	listed := admin("GET", "/auth/extension-tokens", "")
	if listed.Code != 200 || !strings.Contains(listed.Body.String(), credential) || strings.Contains(listed.Body.String(), "token_hash") || strings.Contains(listed.Body.String(), `"scope"`) {
		t.Fatal("list did not return plaintext token")
	}

	check := func(token string, want int) {
		t.Helper()
		req := httptest.NewRequest("POST", "/extension/downloads", strings.NewReader(`{}`))
		req.Header.Set("Origin", javBossExtensionOrigin)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		if response.Code != want {
			t.Fatalf("download status=%d, want %d", response.Code, want)
		}
	}
	// Invalid download payload reaches the handler only after successful authentication.
	check(credential, 400)
	if err := common.DB.First(&persisted, first.ID).Error; err != nil {
		t.Fatal(err)
	}
	if persisted.LastUsedAt == nil {
		t.Fatal("last use not recorded")
	}
	// Rebuilding the router does not lose persisted extension authorization.
	router = NewRouter("", auth)
	check(credential, 400)
	rotated := admin("POST", fmt.Sprintf("/auth/extension-tokens/%d/rotate", first.ID), `{"expires_in_days":90}`)
	if rotated.Code != 200 {
		t.Fatalf("rotate status=%d", rotated.Code)
	}
	var result struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(rotated.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Token == credential {
		t.Fatal("rotation reused credential")
	}
	check(credential, 401)
	check(result.Token, 400)
	check(other, 400)
	deleted := admin("DELETE", fmt.Sprintf("/auth/extension-tokens/%d", first.ID), "")
	if deleted.Code != 204 {
		t.Fatalf("delete status=%d", deleted.Code)
	}
	check(result.Token, 401)
	check(other, 400)
	var count int64
	if err := common.DB.Unscoped().Model(&models.ExtensionToken{}).Where("id = ?", first.ID).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("token record remains after deletion: count=%d err=%v", count, err)
	}
	listed = admin("GET", "/auth/extension-tokens", "")
	var list struct {
		Items []models.ExtensionToken `json:"items"`
	}
	if err := json.Unmarshal(listed.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if listed.Code != 200 || len(list.Items) != 1 || list.Items[0].ID != second.ID {
		t.Fatal("deleted token still listed or other token affected")
	}
	if got := admin("DELETE", fmt.Sprintf("/auth/extension-tokens/%d", first.ID), "").Code; got != 404 {
		t.Fatalf("delete missing token=%d", got)
	}
	if got := admin("POST", fmt.Sprintf("/auth/extension-tokens/%d/rotate", first.ID), `{}`).Code; got != 404 {
		t.Fatalf("deleted rotate=%d", got)
	}
	// Token management remains available only to browser login sessions.
	req := httptest.NewRequest("GET", "/auth/extension-tokens", nil)
	req.Header.Set("Authorization", "Bearer "+other)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, req)
	if response.Code != 403 {
		t.Fatalf("extension token accessed admin API: %d", response.Code)
	}
}

func TestExtensionTokenEnforcement(t *testing.T) {
	auth := testAuthService(t)
	router := NewRouter("", auth)
	makeToken := func(expired, deleted bool) string {
		token, err := newExtensionCredential()
		if err != nil {
			t.Fatal(err)
		}
		now := time.Now().UTC()
		record := models.ExtensionToken{Name: "test", Token: token, CreatedAt: now, ExpiresAt: now.Add(time.Hour)}
		if expired {
			record.ExpiresAt = now.Add(-time.Second)
		}
		if err := dbpkg.CreateExtensionToken(t.Context(), &record); err != nil {
			t.Fatal(err)
		}
		if deleted {
			if err := dbpkg.DeleteExtensionToken(t.Context(), record.ID); err != nil {
				t.Fatal(err)
			}
		}
		return token
	}
	valid := makeToken(false, false)
	expired := makeToken(true, false)
	deleted := makeToken(false, true)
	unknown, err := newExtensionCredential()
	if err != nil {
		t.Fatal(err)
	}
	login := performRequest(router, "POST", "/auth/login", []byte(`{"password":"admin"}`), "", nil)
	cookie := responseCookie(t, login, auth.cookieName)
	for _, tc := range []struct {
		name, origin, header, query string
		cookie                      bool
		want                        int
	}{
		{"missing", javBossExtensionOrigin, "", "", false, 401},
		{"unknown", javBossExtensionOrigin, "Bearer " + unknown, "", false, 401},
		{"malformed", javBossExtensionOrigin, "Bearer broken", "", false, 401},
		{"wrong scheme", javBossExtensionOrigin, "Basic " + valid, "", false, 401},
		{"expired", javBossExtensionOrigin, "Bearer " + expired, "", false, 401},
		{"deleted", javBossExtensionOrigin, "Bearer " + deleted, "", false, 401},
		{"no origin", "", "Bearer " + valid, "", false, 400},
		{"other origin", "https://example.org", "Bearer " + valid, "", false, 403},
		{"cookie only", javBossExtensionOrigin, "", "", true, 401},
		{"browser session", javBossExtensionOrigin, "Bearer " + cookie.Value, "", false, 401},
		{"URL token ignored", javBossExtensionOrigin, "", "?token=" + valid, false, 401},
		{"valid", javBossExtensionOrigin, "Bearer " + valid, "", false, 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest("POST", "/extension/downloads"+tc.query, strings.NewReader(`{}`))
			req.Header.Set("Origin", tc.origin)
			req.Header.Set("Authorization", tc.header)
			req.Header.Set("Content-Type", "application/json")
			if tc.cookie {
				req.AddCookie(cookie)
			}
			res := httptest.NewRecorder()
			router.ServeHTTP(res, req)
			if res.Code != tc.want {
				t.Fatalf("status=%d, want %d", res.Code, tc.want)
			}
			if tc.origin == javBossExtensionOrigin && res.Header().Get("Access-Control-Allow-Origin") != javBossExtensionOrigin {
				t.Fatal("missing CORS on error response")
			}
		})
	}
	req := httptest.NewRequest("OPTIONS", "/extension/downloads", nil)
	req.Header.Set("Origin", javBossExtensionOrigin)
	req.Header.Set("Access-Control-Request-Headers", "authorization,content-type")
	req.Header.Set("Access-Control-Request-Method", "POST")
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)
	if res.Code != 204 || !strings.Contains(res.Header().Get("Access-Control-Allow-Headers"), "Authorization") {
		t.Fatal("bearer preflight rejected")
	}
	var count int64
	if err := common.DB.Model(&models.DownloadJob{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("unauthorized request created a job")
	}
}

func TestExtensionTokenManagementValidation(t *testing.T) {
	auth := testAuthService(t)
	router := NewRouter("", auth)
	login := performRequest(router, "POST", "/auth/login", []byte(`{"password":"admin"}`), "", nil)
	cookie := responseCookie(t, login, auth.cookieName)
	for _, body := range []string{`{`, `{}`, `{"name":" "}`, `{"name":"browser","expires_in_days":-1}`, `{"name":"browser","expires_in_days":366}`} {
		response := performRequest(router, "POST", "/auth/extension-tokens", []byte(body), "http://example.com", cookie)
		if response.Code != 400 {
			t.Fatalf("invalid request accepted: %d", response.Code)
		}
	}
	response := performRequest(router, "POST", "/auth/extension-tokens", []byte(`{"name":"browser"}`), "http://example.com", cookie)
	if response.Code != 201 {
		t.Fatalf("default expiry create: %d", response.Code)
	}
	var created struct {
		Item models.ExtensionToken `json:"item"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	remaining := time.Until(created.Item.ExpiresAt)
	if remaining < 364*24*time.Hour || remaining > 365*24*time.Hour {
		t.Fatalf("unexpected expiry: %v", remaining)
	}
	if created.Item.Token == "" || strings.Contains(response.Body.String(), `"scope"`) {
		t.Fatal("unexpected token payload")
	}
	response = performRequest(router, "POST", "/auth/extension-tokens", []byte(`{"name":"csrf"}`), "https://untrusted.example", cookie)
	if response.Code != 403 {
		t.Fatalf("cross-origin token creation: %d", response.Code)
	}
	for _, id := range []string{"0", "-1", "invalid", "4294967296"} {
		response := performRequest(router, "DELETE", "/auth/extension-tokens/"+id, nil, "http://example.com", cookie)
		if response.Code != 400 {
			t.Fatalf("invalid ID %s accepted: %d", id, response.Code)
		}
	}
}

func TestExtensionTokenAPIPolicy(t *testing.T) {
	auth := testAuthService(t)
	router := NewRouter("", auth)
	credential, err := newExtensionCredential()
	if err != nil {
		t.Fatal(err)
	}
	record := models.ExtensionToken{Name: "browser", Token: credential, CreatedAt: time.Now().UTC()}
	if err := dbpkg.CreateExtensionToken(t.Context(), &record); err != nil {
		t.Fatal(err)
	}
	login := performRequest(router, "POST", "/auth/login", []byte(`{"password":"admin"}`), "", nil)
	cookie := responseCookie(t, login, auth.cookieName)
	// Every registered route except the explicit opt-in must reject Bearer auth,
	// including public login/status/logout routes and all token management routes.
	for _, route := range router.Routes() {
		if extensionTokenAPIAllowed(route.Method, route.Path) {
			continue
		}
		t.Run(route.Method+" "+route.Path, func(t *testing.T) {
			for _, origin := range []string{"", javBossExtensionOrigin} {
				req := httptest.NewRequest(route.Method, route.Path, strings.NewReader(`{}`))
				req.Header.Set("Authorization", "Bearer "+credential)
				req.Header.Set("Origin", origin)
				req.AddCookie(cookie)
				res := httptest.NewRecorder()
				router.ServeHTTP(res, req)
				if res.Code != 403 {
					t.Fatalf("non-enabled API status=%d", res.Code)
				}
			}
		})
	}
	for _, tc := range []struct {
		path, method string
		want         int
	}{
		{"/extension/downloads", "POST", 204},
		{"/extension/status", "GET", 204},
		{"/extension/status", "POST", 403},
		{"/extension/downloads", "GET", 403},
		{"/extension/downloads", "DELETE", 403},
		{"/extension/downloads", "", 403},
		{"/auth/extension-tokens", "POST", 403},
		{"/auth/status", "GET", 403},
		{"/auth/logout", "POST", 403},
		{"/videos", "GET", 403},
		{"/config", "PUT", 403},
	} {
		req := httptest.NewRequest("OPTIONS", tc.path, nil)
		req.Header.Set("Origin", javBossExtensionOrigin)
		req.Header.Set("Access-Control-Request-Method", tc.method)
		req.Header.Set("Access-Control-Request-Headers", "authorization,content-type")
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		if res.Code != tc.want {
			t.Fatalf("preflight %s %s=%d", tc.method, tc.path, res.Code)
		}
		if tc.want == 204 && res.Header().Get("Access-Control-Allow-Methods") != tc.method {
			t.Fatal("preflight allows extra methods")
		}
	}
	// A denied logout must not delete the token or disturb the browser session.
	if got := performRequest(router, "GET", "/auth/extension-tokens", nil, "", cookie).Code; got != 200 {
		t.Fatalf("cookie access=%d", got)
	}
	valid, err := dbpkg.UseExtensionToken(t.Context(), credential, time.Now())
	if err != nil || !valid {
		t.Fatalf("denied request changed token: %v", err)
	}
}

func TestExtensionTokenNeverExpires(t *testing.T) {
	auth := testAuthService(t)
	router := NewRouter("", auth)
	login := performRequest(router, "POST", "/auth/login", []byte(`{"password":"admin"}`), "", nil)
	cookie := responseCookie(t, login, auth.cookieName)
	request := func(path, body string, status int) models.ExtensionToken {
		t.Helper()
		response := performRequest(router, "POST", path, []byte(body), "http://example.com", cookie)
		if response.Code != status {
			t.Fatalf("status=%d want=%d", response.Code, status)
		}
		var payload struct {
			Item models.ExtensionToken `json:"item"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		return payload.Item
	}
	token := request("/auth/extension-tokens", `{"name":"permanent","expires_in_days":0}`, 201)
	if !token.ExpiresAt.IsZero() {
		t.Fatal("token should never expire")
	}
	req := httptest.NewRequest("POST", "/extension/downloads", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token.Token)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, req)
	if response.Code != 400 {
		t.Fatalf("non-expiring token authentication=%d", response.Code)
	}
	path := fmt.Sprintf("/auth/extension-tokens/%d/rotate", token.ID)
	for _, days := range []int{30, 0} {
		rotated := request(path, fmt.Sprintf(`{"expires_in_days":%d}`, days), 200)
		if rotated.ExpiresAt.IsZero() != (days == 0) {
			t.Fatalf("incorrect expiry for days=%d", days)
		}
		var persisted models.ExtensionToken
		if err := common.DB.First(&persisted, token.ID).Error; err != nil {
			t.Fatal(err)
		}
		if !persisted.ExpiresAt.Equal(rotated.ExpiresAt) {
			t.Fatal("rotation expiry did not persist")
		}
		valid, err := dbpkg.UseExtensionToken(t.Context(), token.Token, time.Now())
		if err != nil || valid {
			t.Fatalf("old credential still valid: %v", err)
		}
		token = rotated
	}
	if err := dbpkg.DeleteExtensionToken(t.Context(), token.ID); err != nil {
		t.Fatal(err)
	}
	valid, err := dbpkg.UseExtensionToken(t.Context(), token.Token, time.Now())
	if err != nil || valid {
		t.Fatalf("deleted non-expiring token accepted: %v", err)
	}
}

func TestExtensionConnectionStatus(t *testing.T) {
	auth := testAuthService(t)
	router := NewRouter("", auth)
	now := time.Now().UTC()
	for _, tc := range []struct {
		name    string
		expiry  time.Time
		deleted bool
		want    int
	}{
		{"valid", now.Add(time.Hour), false, http.StatusOK},
		{"never expires", time.Time{}, false, http.StatusOK},
		{"expired", now.Add(-time.Hour), false, http.StatusUnauthorized},
		{"deleted", time.Time{}, true, http.StatusUnauthorized},
	} {
		t.Run(tc.name, func(t *testing.T) {
			token, err := newExtensionCredential()
			if err != nil {
				t.Fatal(err)
			}
			record := models.ExtensionToken{Name: tc.name, Token: token, CreatedAt: now, ExpiresAt: tc.expiry}
			if err := dbpkg.CreateExtensionToken(t.Context(), &record); err != nil {
				t.Fatal(err)
			}
			if tc.deleted {
				if err := dbpkg.DeleteExtensionToken(t.Context(), record.ID); err != nil {
					t.Fatal(err)
				}
			}
			req := httptest.NewRequest("GET", "/extension/status", nil)
			req.Header.Set("Authorization", "Bearer "+token)
			req.Header.Set("Origin", javBossExtensionOrigin)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, req)
			if response.Code != tc.want {
				t.Fatalf("status=%d want=%d", response.Code, tc.want)
			}
			if tc.want == http.StatusOK {
				if response.Body.String() != `{"authenticated":true}` {
					t.Fatal("unexpected status response")
				}
				if response.Header().Get("Cache-Control") != "no-store" {
					t.Fatal("test response can be cached")
				}
			}
		})
	}
	if got := performRequest(router, "GET", "/extension/status", nil, javBossExtensionOrigin, nil).Code; got != 401 {
		t.Fatalf("anonymous status=%d", got)
	}
	var count int64
	if err := common.DB.Model(&models.DownloadJob{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("connection test created jobs: count=%d err=%v", count, err)
	}
}
