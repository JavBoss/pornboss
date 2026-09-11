package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"javboss/internal/common"
	dbpkg "javboss/internal/db"
	"javboss/internal/models"

	"github.com/gin-gonic/gin"
)

func TestCloudDrive2TokenSaveAndReload(t *testing.T) {
	database, err := dbpkg.Open(filepath.Join(t.TempDir(), "provider-token.db"))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	previousDB := common.DB
	common.DB = database
	t.Cleanup(func() {
		common.DB = previousDB
		if sqlDB, dbErr := database.DB(); dbErr == nil {
			_ = sqlDB.Close()
		}
	})

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.PUT("/downloader/clouddrive2", updateCloudDrive2Settings)
	router.GET("/downloader/clouddrive2/token", getCloudDrive2Token)

	for _, tc := range []struct {
		name string
		body string
		want string
	}{
		{name: "omitted token preserves existing value", body: `{}`, want: "stored-token"},
		{name: "unchanged token is preserved", body: `{"api_token":"stored-token"}`, want: "stored-token"},
		{name: "empty token clears existing value", body: `{"api_token":""}`, want: ""},
		{name: "whitespace token clears existing value", body: `{"api_token":"   "}`, want: ""},
		{name: "replacement is trimmed", body: `{"api_token":" new-token "}`, want: "new-token"},
		{name: "explicit clear remains supported", body: `{"api_token":"new-token","clear_api_token":true}`, want: ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := dbpkg.SaveDownloaderProviderSettings(t.Context(), &models.DownloaderProviderSettings{
				Provider: models.DownloaderProviderCloudDrive2, APIToken: "stored-token",
			}); err != nil {
				t.Fatalf("save initial token: %v", err)
			}
			request := httptest.NewRequest(http.MethodPut, "/downloader/clouddrive2", strings.NewReader(tc.body))
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != http.StatusOK {
				t.Fatalf("save status = %d; body=%s", response.Code, response.Body.String())
			}
			var settings downloaderSettingsResponse
			if err := json.Unmarshal(response.Body.Bytes(), &settings); err != nil {
				t.Fatal(err)
			}
			if settings.TokenConfigured != (tc.want != "") {
				t.Fatalf("token_configured = %t, want %t", settings.TokenConfigured, tc.want != "")
			}
			stored, err := dbpkg.GetDownloaderProviderSettings(t.Context(), models.DownloaderProviderCloudDrive2)
			if err != nil {
				t.Fatal(err)
			}
			if stored.APIToken != tc.want {
				t.Fatalf("stored token = %q, want %q", stored.APIToken, tc.want)
			}
			reloaded := httptest.NewRecorder()
			router.ServeHTTP(reloaded, httptest.NewRequest(http.MethodGet, "/downloader/clouddrive2/token", nil))
			if reloaded.Code != http.StatusOK {
				t.Fatalf("reload status = %d", reloaded.Code)
			}
			var token struct {
				APIToken string `json:"api_token"`
			}
			if err := json.Unmarshal(reloaded.Body.Bytes(), &token); err != nil {
				t.Fatal(err)
			}
			if token.APIToken != tc.want {
				t.Fatalf("reloaded token = %q, want %q", token.APIToken, tc.want)
			}
		})
	}
}

func TestCreateDownloadJobAcceptsManualMagnetOnly(t *testing.T) {
	database, err := dbpkg.Open(filepath.Join(t.TempDir(), "download-api.db"))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	previousDB := common.DB
	common.DB = database
	t.Cleanup(func() {
		common.DB = previousDB
		if sqlDB, dbErr := database.DB(); dbErr == nil {
			_ = sqlDB.Close()
		}
	})

	downloadDirectory := t.TempDir()
	if err := dbpkg.SaveDownloaderSettings(t.Context(), &models.DownloaderSettings{
		ActiveProvider:    models.DownloaderProviderCloudDrive2,
		DownloadDirectory: downloadDirectory, LocalConcurrency: 2,
	}); err != nil {
		t.Fatalf("save downloader settings: %v", err)
	}

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(extensionAPIAccess())
	router.GET("/downloads", listDownloadJobs)
	router.POST("/downloads", createDownloadJob)
	auth, err := NewAuthService(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	// CORS is installed before routes, just as in NewRouter.
	protected := router.Group("/")
	protected.Use(auth.requireAuth())
	registerExtensionRoutes(protected)
	body := `{"magnet_url":"magnet:?xt=urn:btih:0123456789ABCDEF0123456789ABCDEF01234567&dn=Manual+Task"}`
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/downloads", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("create status = %d body=%s", response.Code, response.Body.String())
	}
	var job models.DownloadJob
	if err := database.First(&job).Error; err != nil {
		t.Fatalf("load download job: %v", err)
	}
	if job.MagnetName != "Manual Task" || job.DownloadDirectory != downloadDirectory {
		t.Fatalf("stored download job = %#v", job)
	}
	if job.Provider != models.DownloaderProviderCloudDrive2 {
		t.Fatalf("stored provider = %q", job.Provider)
	}

	repeatedResponse := httptest.NewRecorder()
	repeatedRequest := httptest.NewRequest(http.MethodPost, "/downloads", strings.NewReader(body))
	repeatedRequest.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(repeatedResponse, repeatedRequest)
	if repeatedResponse.Code != http.StatusCreated {
		t.Fatalf("repeated create status = %d body=%s", repeatedResponse.Code, repeatedResponse.Body.String())
	}
	var count int64
	if err := database.Model(&models.DownloadJob{}).
		Where("download_directory = ? AND info_hash = ?", downloadDirectory, job.InfoHash).
		Count(&count).Error; err != nil {
		t.Fatalf("count repeated download jobs: %v", err)
	}
	if count != 2 {
		t.Fatalf("repeated download job count = %d, want 2", count)
	}

	listResponse := httptest.NewRecorder()
	listRequest := httptest.NewRequest(http.MethodGet, "/downloads", nil)
	router.ServeHTTP(listResponse, listRequest)
	if listResponse.Code != http.StatusOK {
		t.Fatalf("list status = %d body=%s", listResponse.Code, listResponse.Body.String())
	}
	var payload struct {
		Items []struct {
			MagnetURL string `json:"magnet_url"`
		} `json:"items"`
	}
	if err := json.Unmarshal(listResponse.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode list response: %v", err)
	}
	if len(payload.Items) != 2 || payload.Items[0].MagnetURL != job.MagnetURL {
		t.Fatalf("listed magnet URLs = %#v", payload.Items)
	}

	pagedResponse := httptest.NewRecorder()
	router.ServeHTTP(pagedResponse, httptest.NewRequest(http.MethodGet, "/downloads?limit=1&offset=1", nil))
	if pagedResponse.Code != http.StatusOK {
		t.Fatalf("pagination status = %d: %s", pagedResponse.Code, pagedResponse.Body.String())
	}
	var page dbpkg.DownloadJobPage
	if err := json.Unmarshal(pagedResponse.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if page.Total != 2 || page.Counts.Active != 2 || len(page.Items) != 1 || page.Items[0].ID != job.ID {
		t.Fatalf("unexpected paginated response: %+v", page)
	}
	if pagedResponse.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("task pages must not be cached")
	}

	preflightResponse := httptest.NewRecorder()
	preflightRequest := httptest.NewRequest(http.MethodOptions, "/extension/downloads", nil)
	preflightRequest.Header.Set("Origin", javBossExtensionOrigin)
	preflightRequest.Header.Set("Access-Control-Request-Method", "POST")
	router.ServeHTTP(preflightResponse, preflightRequest)
	if preflightResponse.Code != http.StatusNoContent ||
		preflightResponse.Header().Get("Access-Control-Allow-Origin") != javBossExtensionOrigin {
		t.Fatalf("extension preflight status=%d headers=%v", preflightResponse.Code, preflightResponse.Header())
	}

	invalidExtensionResponse := httptest.NewRecorder()
	invalidExtensionRequest := httptest.NewRequest(http.MethodPost, "/extension/downloads", strings.NewReader(body))
	invalidExtensionRequest.Header.Set("Content-Type", "application/json")
	invalidExtensionRequest.Header.Set("Origin", "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	router.ServeHTTP(invalidExtensionResponse, invalidExtensionRequest)
	if invalidExtensionResponse.Code != http.StatusForbidden {
		t.Fatalf("invalid extension status = %d body=%s", invalidExtensionResponse.Code, invalidExtensionResponse.Body.String())
	}

	credential, err := newExtensionCredential()
	if err != nil {
		t.Fatal(err)
	}
	if err := dbpkg.CreateExtensionToken(t.Context(), &models.ExtensionToken{
		Name: "test browser", Token: credential,
		CreatedAt: time.Now().UTC(), ExpiresAt: time.Now().UTC().Add(time.Hour),
	}); err != nil {
		t.Fatal(err)
	}
	extensionResponse := httptest.NewRecorder()
	extensionRequest := httptest.NewRequest(http.MethodPost, "/extension/downloads", strings.NewReader(body))
	extensionRequest.Header.Set("Content-Type", "application/json")
	extensionRequest.Header.Set("Origin", javBossExtensionOrigin)
	extensionRequest.Header.Set("Authorization", "Bearer "+credential)
	router.ServeHTTP(extensionResponse, extensionRequest)
	if extensionResponse.Code != http.StatusCreated ||
		extensionResponse.Header().Get("Access-Control-Allow-Origin") != javBossExtensionOrigin {
		t.Fatalf("extension create status=%d headers=%v body=%s", extensionResponse.Code, extensionResponse.Header(), extensionResponse.Body.String())
	}
}

func TestDownloadRevealTargetUsesDownloadedFileWithinConfiguredDirectory(t *testing.T) {
	root := t.TempDir()
	downloadedDirectory := filepath.Join(root, "Movie Name")
	if err := os.Mkdir(downloadedDirectory, 0o755); err != nil {
		t.Fatalf("create downloaded directory: %v", err)
	}
	downloadedFile := filepath.Join(downloadedDirectory, "movie.mp4")
	if err := os.WriteFile(downloadedFile, []byte("video"), 0o644); err != nil {
		t.Fatalf("create downloaded file: %v", err)
	}
	job := &models.DownloadJob{
		DownloadDirectory: root,
		LocalFilesJSON:    `["` + filepath.ToSlash(downloadedFile) + `"]`,
	}

	if target := downloadRevealTarget(job); target != filepath.Clean(downloadedFile) {
		t.Fatalf("reveal target = %q, want %q", target, downloadedFile)
	}
}

func TestDownloadRevealTargetFallsBackToConfiguredDirectory(t *testing.T) {
	root := t.TempDir()
	job := &models.DownloadJob{
		DownloadDirectory: root,
		LocalFilesJSON:    `["/outside/missing.mp4"]`,
	}

	if target := downloadRevealTarget(job); target != filepath.Clean(root) {
		t.Fatalf("reveal target = %q, want %q", target, root)
	}
}

func TestUpdateDownloaderSettingsConcurrencyRange(t *testing.T) {
	database, err := dbpkg.Open(filepath.Join(t.TempDir(), "concurrency-api.db"))
	if err != nil {
		t.Fatal(err)
	}
	previousDB := common.DB
	common.DB = database
	t.Cleanup(func() {
		common.DB = previousDB
		if sqlDB, err := database.DB(); err == nil {
			_ = sqlDB.Close()
		}
	})
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.PUT("/downloader/settings", updateDownloaderSettings)
	directory := t.TempDir()
	for _, concurrency := range []int{-1, 0, 1, 2, 3, 4, 5} {
		body, err := json.Marshal(map[string]any{
			"download_directory": directory, "local_concurrency": concurrency, "min_video_size_mb": 50,
		})
		if err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest(http.MethodPut, "/downloader/settings", strings.NewReader(string(body)))
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		wantStatus := http.StatusOK
		if concurrency < 1 || concurrency > 3 {
			wantStatus = http.StatusBadRequest
		}
		if response.Code != wantStatus {
			t.Fatalf("concurrency %d: status = %d, want %d, body = %s", concurrency, response.Code, wantStatus, response.Body.String())
		}
	}
}
