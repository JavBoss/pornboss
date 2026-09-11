package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"javboss/internal/common"
	"javboss/internal/models"
)

func TestExtensionJavOwnership(t *testing.T) {
	router := NewRouter("", testAuthService(t))
	token, err := newExtensionCredential()
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range []any{
		&models.ExtensionToken{Name: "ownership", Token: token, ExpiresAt: time.Now().Add(time.Hour)},
		&models.Jav{ID: 1, Code: "ABC-123"},
		&models.Directory{ID: 1, Path: "/library"},
		&models.Video{ID: 1, Fingerprint: "owned"},
	} {
		if err := common.DB.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	javID := int64(1)
	if err := common.DB.Create(&models.VideoLocation{VideoID: 1, DirectoryID: 1, JavID: &javID, RelativePath: "private.mp4"}).Error; err != nil {
		t.Fatal(err)
	}
	request := func(method, body, credential, origin string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, "/extension/jav/ownership", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if credential != "" {
			req.Header.Set("Authorization", "Bearer "+credential)
		}
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		if method == http.MethodOptions {
			req.Header.Set("Access-Control-Request-Method", http.MethodPost)
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		return response
	}
	valid := `{"codes":["abc_123","ABC-1234"]}`
	for _, tc := range []struct {
		name, body, token, origin string
		status                    int
	}{
		{"owned", valid, token, javBossExtensionOrigin, 200},
		{"no origin", valid, token, "", 200},
		{"anonymous", valid, "", "", 401},
		{"invalid token", valid, "jbe_" + strings.Repeat("b", 43), javBossExtensionOrigin, 401},
		{"site origin", valid, token, "https://javdb.com", 403},
		{"empty", `{"codes":[]}`, token, javBossExtensionOrigin, 400},
		{"wrong type", `{"codes":[123]}`, token, javBossExtensionOrigin, 400},
		{"dotted code", `{"codes":["Milfy.2026.09.09"]}`, token, javBossExtensionOrigin, 200},
		{"invalid code", `{"codes":["ABC%' OR 1=1"]}`, token, javBossExtensionOrigin, 400},
		{"blank code", `{"codes":[" "]}`, token, javBossExtensionOrigin, 400},
		{"long code", `{"codes":["` + strings.Repeat("A", 129) + `"]}`, token, javBossExtensionOrigin, 400},
		{"too many", `{"codes":[` + strings.Repeat(`"ABC-123",`, 200) + `"ABC-123"]}`, token, javBossExtensionOrigin, 400},
		{"large body", `{"padding":"` + strings.Repeat("x", 32768) + `","codes":["ABC-123"]}`, token, javBossExtensionOrigin, 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response := request(http.MethodPost, tc.body, tc.token, tc.origin)
			if response.Code != tc.status {
				t.Fatalf("status = %d, want %d: %s", response.Code, tc.status, response.Body)
			}
			if tc.status == 200 {
				var payload map[string]any
				if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
					t.Fatal(err)
				}
				want := `{"items":[{"code":"abc_123","owned":true},{"code":"ABC-1234","owned":false}]}`
				if tc.name == "dotted code" {
					want = `{"items":[{"code":"Milfy.2026.09.09","owned":false}]}`
				}
				if response.Body.String() != want {
					t.Fatalf("unexpected ownership response: %s", response.Body)
				}
				if response.Header().Get("Cache-Control") != "no-store" {
					t.Fatal("ownership is cacheable")
				}
			}
		})
	}
	preflight := request(http.MethodOptions, "", "", javBossExtensionOrigin)
	if preflight.Code != 204 || preflight.Header().Get("Access-Control-Allow-Methods") != "POST" {
		t.Fatalf("preflight = %d, %v", preflight.Code, preflight.Header())
	}
	if got := request(http.MethodGet, "", token, javBossExtensionOrigin).Code; got != 403 {
		t.Fatalf("unsupported method = %d", got)
	}
	if err := common.DB.Exec("DROP TABLE video_location").Error; err != nil {
		t.Fatal(err)
	}
	if got := request(http.MethodPost, valid, token, javBossExtensionOrigin).Code; got != 500 {
		t.Fatalf("database failure = %d, want 500", got)
	}
}
