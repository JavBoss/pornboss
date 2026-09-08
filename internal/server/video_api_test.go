package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"javboss/internal/common"
	dbpkg "javboss/internal/db"
	"javboss/internal/jav"
	"javboss/internal/models"
	"javboss/internal/util"

	"github.com/gin-gonic/gin"
)

func TestListVideosIgnoresDirectoryIDsAndUsesEnabledDirectories(t *testing.T) {
	database, err := dbpkg.Open(filepath.Join(t.TempDir(), "test.db"))
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

	dir := models.Directory{Path: "/media/api-directory-scope"}
	video := models.Video{Fingerprint: "api-directory-scope-video"}
	if err := database.Create(&dir).Error; err != nil {
		t.Fatalf("create directory: %v", err)
	}
	if err := database.Create(&video).Error; err != nil {
		t.Fatalf("create video: %v", err)
	}
	if _, err := dbpkg.UpsertVideoLocation(
		context.Background(),
		video.ID,
		dir.ID,
		"movie.mp4",
		time.Unix(1710000000, 0).UTC(),
	); err != nil {
		t.Fatalf("create video location: %v", err)
	}

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/videos", listVideos)
	requestList := func(query string) struct {
		Items []models.Video `json:"items"`
		Total int64          `json:"total"`
	} {
		t.Helper()
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/videos?"+query, nil)
		router.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusOK {
			t.Fatalf("list videos status = %d body=%s", recorder.Code, recorder.Body.String())
		}
		var payload struct {
			Items []models.Video `json:"items"`
			Total int64          `json:"total"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
			t.Fatalf("decode list videos response: %v", err)
		}
		return payload
	}

	visible := requestList("directory_ids=0")
	if visible.Total != 1 || len(visible.Items) != 1 {
		t.Fatalf("enabled directory should remain visible despite directory_ids=0: %#v", visible)
	}

	enabled := false
	if _, err := dbpkg.UpdateDirectory(context.Background(), dir.ID, nil, nil, &enabled); err != nil {
		t.Fatalf("disable directory: %v", err)
	}
	hidden := requestList("directory_ids=" + strconv.FormatInt(dir.ID, 10))
	if hidden.Total != 0 || len(hidden.Items) != 0 {
		t.Fatalf("disabled directory must remain hidden despite directory_ids: %#v", hidden)
	}
}

func TestRevealVideoLocationRejectsRemoteRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/videos/reveal", revealVideoLocation)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/videos/reveal", strings.NewReader(`{}`))
	request.RemoteAddr = "192.168.1.25:54321"
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("unexpected status: got %d want %d body=%s", recorder.Code, http.StatusForbidden, recorder.Body.String())
	}
	var payload struct {
		ErrorZH string `json:"error_zh"`
		ErrorEN string `json:"error_en"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response body: %v body=%s", err, recorder.Body.String())
	}
	if payload.ErrorZH != "通过局域网访问时无法打开文件所在位置" {
		t.Fatalf("unexpected Chinese error: %q", payload.ErrorZH)
	}
	if payload.ErrorEN != "Cannot reveal file locations when accessing over the local network" {
		t.Fatalf("unexpected English error: %q", payload.ErrorEN)
	}
}

func TestDeleteVideoLocationRejectsMissingDirectory(t *testing.T) {
	database, err := dbpkg.Open(filepath.Join(t.TempDir(), "test.db"))
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

	dir := models.Directory{Path: filepath.Join(t.TempDir(), "offline"), Missing: true}
	if err := database.Create(&dir).Error; err != nil {
		t.Fatalf("create directory: %v", err)
	}
	video := models.Video{Fingerprint: "missing-directory-delete"}
	if err := database.Create(&video).Error; err != nil {
		t.Fatalf("create video: %v", err)
	}
	loc, err := dbpkg.UpsertVideoLocation(
		context.Background(),
		video.ID,
		dir.ID,
		"movie.mp4",
		time.Unix(1710000000, 0).UTC(),
	)
	if err != nil {
		t.Fatalf("create video location: %v", err)
	}

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.DELETE("/videos/:id/locations/:location_id", deleteVideoLocation)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodDelete,
		"/videos/"+strconv.FormatInt(video.ID, 10)+"/locations/"+strconv.FormatInt(loc.ID, 10),
		nil,
	)
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusConflict {
		t.Fatalf("unexpected status: got %d want %d body=%s", recorder.Code, http.StatusConflict, recorder.Body.String())
	}
	var payload struct {
		Error   *string `json:"error"`
		ErrorZH string  `json:"error_zh"`
		ErrorEN string  `json:"error_en"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response body: %v body=%s", err, recorder.Body.String())
	}
	if payload.ErrorZH != "目录缺失，无法删除视频" {
		t.Fatalf("unexpected Chinese error: %q", payload.ErrorZH)
	}
	if payload.ErrorEN != "The directory is missing; video cannot be deleted" {
		t.Fatalf("unexpected English error: %q", payload.ErrorEN)
	}
	if payload.Error != nil {
		t.Fatalf("localized error response must not include legacy error field: %q", *payload.Error)
	}
	var saved models.VideoLocation
	if err := database.First(&saved, loc.ID).Error; err != nil {
		t.Fatalf("reload video location: %v", err)
	}
	if saved.IsDelete {
		t.Fatal("missing directory location must remain visible after rejected delete")
	}
}

func TestRegisterRoutesIncludesVideoScreenshotList(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterRoutes(router)

	foundList := false
	foundUpload := false
	foundScrapeLookup := false
	foundExistingJavLink := false
	foundLegacyJavDBLookup := false
	for _, route := range router.Routes() {
		foundList = foundList || route.Method == "GET" && route.Path == "/videos/screenshots"
		foundUpload = foundUpload || route.Method == "PUT" && route.Path == "/videos/:id/screenshots/:name"
		foundScrapeLookup = foundScrapeLookup || route.Method == "GET" && route.Path == "/videos/:id/jav-scrape/lookup"
		foundExistingJavLink = foundExistingJavLink || route.Method == "POST" && route.Path == "/videos/:id/jav-scrape/link"
		foundLegacyJavDBLookup = foundLegacyJavDBLookup || route.Method == "GET" && route.Path == "/videos/:id/jav-scrape/javdb"
	}
	if !foundList {
		t.Fatal("GET /videos/screenshots route is not registered")
	}
	if !foundUpload {
		t.Fatal("PUT /videos/:id/screenshots/:name route is not registered")
	}
	if !foundScrapeLookup {
		t.Fatal("GET /videos/:id/jav-scrape/lookup route is not registered")
	}
	if !foundExistingJavLink {
		t.Fatal("POST /videos/:id/jav-scrape/link route is not registered")
	}
	if foundLegacyJavDBLookup {
		t.Fatal("legacy GET /videos/:id/jav-scrape/javdb route must not be registered")
	}
}

func TestLinkVideoExistingJavPreservesMetadataAndLinksAllLocations(t *testing.T) {
	database, err := dbpkg.Open(filepath.Join(t.TempDir(), "test.db"))
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

	dirs := []models.Directory{{Path: filepath.Join(t.TempDir(), "a")}, {Path: filepath.Join(t.TempDir(), "b")}}
	if err := database.Create(&dirs).Error; err != nil {
		t.Fatalf("create directories: %v", err)
	}
	video := models.Video{Fingerprint: "link-existing-jav"}
	if err := database.Create(&video).Error; err != nil {
		t.Fatalf("create video: %v", err)
	}
	now := time.Unix(1710000000, 0).UTC()
	locA, err := dbpkg.UpsertVideoLocation(context.Background(), video.ID, dirs[0].ID, "a.mp4", now)
	if err != nil {
		t.Fatalf("create first video location: %v", err)
	}
	locB, err := dbpkg.UpsertVideoLocation(context.Background(), video.ID, dirs[1].ID, "b.mp4", now)
	if err != nil {
		t.Fatalf("create second video location: %v", err)
	}
	existing := models.Jav{Code: "IPX-228", Title: "Existing title", DurationMin: 123, FetchedAt: now}
	if err := database.Create(&existing).Error; err != nil {
		t.Fatalf("create existing JAV: %v", err)
	}

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/videos/:id/jav-scrape/link", linkVideoExistingJav)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/videos/"+strconv.FormatInt(video.ID, 10)+"/jav-scrape/link",
		strings.NewReader(`{"location_id":`+strconv.FormatInt(locA.ID, 10)+`,"code":"ipx-228"}`),
	)
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status: got %d want %d body=%s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	var locations []models.VideoLocation
	if err := database.Where("id IN ?", []int64{locA.ID, locB.ID}).Find(&locations).Error; err != nil {
		t.Fatalf("reload video locations: %v", err)
	}
	for _, loc := range locations {
		if loc.JavID == nil || *loc.JavID != existing.ID {
			t.Fatalf("location %d jav_id = %#v, want %d", loc.ID, loc.JavID, existing.ID)
		}
	}
	var storedJav models.Jav
	if err := database.First(&storedJav, existing.ID).Error; err != nil {
		t.Fatalf("reload existing JAV: %v", err)
	}
	if storedJav.Title != existing.Title || storedJav.DurationMin != existing.DurationMin || !storedJav.FetchedAt.Equal(existing.FetchedAt) {
		t.Fatalf("existing JAV metadata changed: %#v", storedJav)
	}
	var storedVideo models.Video
	if err := database.First(&storedVideo, video.ID).Error; err != nil {
		t.Fatalf("reload video: %v", err)
	}
	if storedVideo.JavScrapeOverride != models.JavScrapeOverrideManualPrefix+existing.Code {
		t.Fatalf("jav scrape override = %q, want %q", storedVideo.JavScrapeOverride, models.JavScrapeOverrideManualPrefix+existing.Code)
	}

	missingRecorder := httptest.NewRecorder()
	missingRequest := httptest.NewRequest(
		http.MethodPost,
		"/videos/"+strconv.FormatInt(video.ID, 10)+"/jav-scrape/link",
		strings.NewReader(`{"location_id":`+strconv.FormatInt(locA.ID, 10)+`,"code":"MISSING-001"}`),
	)
	missingRequest.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(missingRecorder, missingRequest)
	if missingRecorder.Code != http.StatusNotFound {
		t.Fatalf("missing code status: got %d want %d body=%s", missingRecorder.Code, http.StatusNotFound, missingRecorder.Body.String())
	}
	var errorPayload struct {
		ErrorZH string `json:"error_zh"`
		ErrorEN string `json:"error_en"`
	}
	if err := json.Unmarshal(missingRecorder.Body.Bytes(), &errorPayload); err != nil {
		t.Fatalf("decode missing code response: %v", err)
	}
	if errorPayload.ErrorZH != "番号 MISSING-001 在 JAV 库中不存在" {
		t.Fatalf("unexpected missing code error: %q", errorPayload.ErrorZH)
	}
}

func TestParseVideoJavScrapeLookupProvider(t *testing.T) {
	tests := []struct {
		value string
		want  jav.Provider
		ok    bool
	}{
		{value: "avmoo", want: jav.ProviderAvmoo, ok: true},
		{value: " JavBus ", want: jav.ProviderJavBus, ok: true},
		{value: "AVSOX", want: jav.ProviderAvsox, ok: true},
		{value: "javdb", want: jav.ProviderUnknown, ok: false},
		{value: "", want: jav.ProviderUnknown, ok: false},
	}

	for _, tt := range tests {
		got, ok := parseVideoJavScrapeLookupProvider(tt.value)
		if got != tt.want || ok != tt.ok {
			t.Errorf("parseVideoJavScrapeLookupProvider(%q) = (%v, %v), want (%v, %v)", tt.value, got, ok, tt.want, tt.ok)
		}
	}
}

func TestIsScreenshotImageName(t *testing.T) {
	tests := []struct {
		name string
		want bool
	}{
		{name: "mpv_00-12-34.567.jpg", want: true},
		{name: "mpv_example.PNG", want: true},
		{name: "00-12-34.567.jpg", want: false},
		{name: "../mpv_example.jpg", want: false},
		{name: "nested/mpv_example.jpg", want: false},
		{name: "mpv_example.txt", want: false},
		{name: "", want: false},
	}

	for _, tt := range tests {
		if got := isScreenshotImageName(tt.name); got != tt.want {
			t.Fatalf("isScreenshotImageName(%q) = %v, want %v", tt.name, got, tt.want)
		}
	}
}

func TestManualScrapeRequestToJavInfo(t *testing.T) {
	uncensored := true
	duration := 170

	info, err := manualScrapeRequestToJavInfo(videoJavManualScrapeRequest{
		Code:         " ipx-228 ",
		Title:        " Title ",
		Studio:       " Studio ",
		Series:       " Series ",
		ReleaseDate:  "2018-11-13",
		DurationMin:  &duration,
		Tags:         []string{"美少女", "美少女", "", "接吻"},
		Actors:       []string{"岬ななみ", "岬ななみ"},
		CoverURL:     " https://example.test/cover.jpg ",
		IsUncensored: &uncensored,
	})
	if err != nil {
		t.Fatalf("manualScrapeRequestToJavInfo() error = %v", err)
	}

	if info.Code != "IPX-228" {
		t.Fatalf("unexpected code: %q", info.Code)
	}
	if info.Title != "Title" || info.Studio != "Studio" || info.Series != "Series" {
		t.Fatalf("unexpected text fields: %#v", info)
	}
	wantRelease := time.Date(2018, 11, 13, 0, 0, 0, 0, time.UTC).Unix()
	if info.ReleaseUnix != wantRelease {
		t.Fatalf("unexpected release unix: got %d want %d", info.ReleaseUnix, wantRelease)
	}
	if info.DurationMin != 170 {
		t.Fatalf("unexpected duration: %d", info.DurationMin)
	}
	if len(info.Tags) != 2 || info.Tags[0] != "美少女" || info.Tags[1] != "接吻" {
		t.Fatalf("unexpected tags: %#v", info.Tags)
	}
	if info.Provider != jav.ProviderManualScrape {
		t.Fatalf("unexpected provider: %s", info.Provider.String())
	}
	if len(info.Actors) != 1 || info.Actors[0] != "岬ななみ" {
		t.Fatalf("unexpected actors: %#v", info.Actors)
	}
	if info.CoverURL != "https://example.test/cover.jpg" {
		t.Fatalf("unexpected cover url: %q", info.CoverURL)
	}
	if info.IsUncensored == nil || !*info.IsUncensored {
		t.Fatalf("unexpected uncensored state: %#v", info.IsUncensored)
	}
}

func TestManualScrapeRequestToJavInfoRequiresCoreMetadata(t *testing.T) {
	duration := 120
	uncensored := false
	validRequest := func() videoJavManualScrapeRequest {
		return videoJavManualScrapeRequest{
			Code:         "IPX-228",
			Title:        "Title",
			ReleaseDate:  "2018-11-13",
			DurationMin:  &duration,
			IsUncensored: &uncensored,
		}
	}
	tests := []struct {
		name    string
		mutate  func(*videoJavManualScrapeRequest)
		wantErr string
	}{
		{
			name: "missing title",
			mutate: func(req *videoJavManualScrapeRequest) {
				req.Title = "  "
			},
			wantErr: "title is required",
		},
		{
			name: "missing release date",
			mutate: func(req *videoJavManualScrapeRequest) {
				req.ReleaseDate = ""
			},
			wantErr: "release_date is required",
		},
		{
			name: "missing duration",
			mutate: func(req *videoJavManualScrapeRequest) {
				req.DurationMin = nil
			},
			wantErr: "duration_min is required",
		},
		{
			name: "missing censor state",
			mutate: func(req *videoJavManualScrapeRequest) {
				req.IsUncensored = nil
			},
			wantErr: "is_uncensored is required",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			req := validRequest()
			test.mutate(&req)
			_, err := manualScrapeRequestToJavInfo(req)
			if err == nil || err.Error() != test.wantErr {
				t.Fatalf("error = %v, want %q", err, test.wantErr)
			}
		})
	}
}

func TestPlaybackInfoAdvertisesNativeCandidates(t *testing.T) {
	for _, tt := range []struct {
		container string
		codec     string
		mime      string
	}{
		{"mp4", "hevc", "video/mp4"},
		{"mp4", "av1", "video/mp4"},
		{"mkv", "h264", "video/x-matroska"},
		{"mov", "hevc", "video/quicktime"},
		{"webm", "av1", "video/webm"},
		{"avi", "mpeg4", ""},
	} {
		t.Run(tt.container+"_"+tt.codec, func(t *testing.T) {
			info := buildPlaybackInfo(&models.Video{ID: 42}, 7, &util.PlaybackProbeResult{
				Container: tt.container, VideoCodec: tt.codec, AudioCodec: "aac",
			})
			if info.VideoCodec != tt.codec || info.AudioCodec != "aac" || info.PreferredKind != "hls" {
				t.Fatalf("unexpected playback metadata: %+v", info)
			}
			if tt.mime != "" {
				if len(info.Sources) != 2 || info.Sources[0].Kind != "direct" || info.Sources[0].MimeType != tt.mime || info.Sources[0].Src != "/videos/42/stream?location_id=7" {
					t.Fatalf("missing native playback candidate: %+v", info.Sources)
				}
			} else if len(info.Sources) != 1 {
				t.Fatalf("unexpected native candidate: %+v", info.Sources)
			}
			fallback := info.Sources[len(info.Sources)-1]
			if fallback.Kind != "hls" || fallback.Src != "/videos/42/stream.m3u8?location_id=7" {
				t.Fatalf("missing HLS fallback: %+v", fallback)
			}
		})
	}
	info := buildPlaybackInfo(&models.Video{ID: 42}, 0, &util.PlaybackProbeResult{
		Container: "mp4", VideoCodec: "h264", SupportsDirect: true,
	})
	if info.PreferredKind != "direct" || len(info.Sources) != 2 {
		t.Fatalf("changed legacy direct preference: %+v", info)
	}
}

func TestHLSStreamHelpersPreserveLocationID(t *testing.T) {
	video := &models.Video{ID: 42}

	if got, want := buildHLSStreamURL(video, 7), "/videos/42/stream.m3u8?location_id=7"; got != want {
		t.Fatalf("buildHLSStreamURL() = %q, want %q", got, want)
	}
	if got, want := streamCacheKey(42, 7), "42_location_7"; got != want {
		t.Fatalf("streamCacheKey() = %q, want %q", got, want)
	}
	if got, want := buildHLSStreamURL(video, 0), "/videos/42/stream.m3u8"; got != want {
		t.Fatalf("buildHLSStreamURL() without location = %q, want %q", got, want)
	}
	if got, want := streamCacheKey(42, 0), "42"; got != want {
		t.Fatalf("streamCacheKey() without location = %q, want %q", got, want)
	}
}

func TestServeRemoteVideoForwardsRangeResponse(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Range") != "bytes=10-19" {
			t.Errorf("origin Range = %q", r.Header.Get("Range"))
		}
		w.Header().Set("Accept-Ranges", "bytes")
		w.Header().Set("Content-Range", "bytes 10-19/100")
		w.Header().Set("Content-Type", "video/mp4")
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write([]byte("0123456789"))
	}))
	defer origin.Close()

	previousClient := remoteMediaHTTPClient
	remoteMediaHTTPClient = origin.Client()
	t.Cleanup(func() { remoteMediaHTTPClient = previousClient })

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/stream", func(c *gin.Context) { serveRemoteVideo(c, origin.URL+"/movie.mp4") })
	req := httptest.NewRequest(http.MethodGet, "/stream", nil)
	req.Header.Set("Range", "bytes=10-19")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusPartialContent {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusPartialContent)
	}
	if recorder.Header().Get("Content-Range") != "bytes 10-19/100" || recorder.Header().Get("Accept-Ranges") != "bytes" {
		t.Fatalf("unexpected response headers: %#v", recorder.Header())
	}
	if recorder.Body.String() != "0123456789" {
		t.Fatalf("body = %q", recorder.Body.String())
	}
}

func TestPlaybackScreenshotName(t *testing.T) {
	tests := []struct {
		second float64
		want   string
	}{
		{second: 0, want: "mpv_00-00-00.jpg"},
		{second: 1.234, want: "mpv_00-00-01.234.jpg"},
		{second: 65, want: "mpv_00-01-05.jpg"},
		{second: 3661.5, want: "mpv_01-01-01.500.jpg"},
	}

	for _, tt := range tests {
		if got := playbackScreenshotName(tt.second); got != tt.want {
			t.Fatalf("playbackScreenshotName(%v) = %q, want %q", tt.second, got, tt.want)
		}
	}
}

func TestReadVideoScreenshotInfos(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{
		"mpv_00-00-09.jpg",
		"mpv_00-00-03.png",
		"ignored.jpg",
		"mpv_ignored.txt",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(name), 0o600); err != nil {
			t.Fatalf("write screenshot fixture %q: %v", name, err)
		}
	}

	items, err := readVideoScreenshotInfos(42, "mpv_00-00-09.jpg", dir)
	if err != nil {
		t.Fatalf("readVideoScreenshotInfos() error = %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("unexpected screenshot count: got %d want 2", len(items))
	}
	if items[0].Name != "mpv_00-00-03.png" || items[1].Name != "mpv_00-00-09.jpg" {
		t.Fatalf("screenshots are not sorted by name: %#v", items)
	}
	for _, item := range items {
		if item.VideoID != 42 {
			t.Fatalf("unexpected video id: got %d want 42", item.VideoID)
		}
		if !strings.HasPrefix(item.URL, "/videos/42/screenshots/") {
			t.Fatalf("unexpected screenshot URL: %q", item.URL)
		}
	}
	if items[0].IsCover || !items[1].IsCover {
		t.Fatalf("unexpected cover state: %#v", items)
	}
}

func TestReadVideoScreenshotInfosMissingDirectory(t *testing.T) {
	items, err := readVideoScreenshotInfos(42, "", filepath.Join(t.TempDir(), "missing"))
	if err != nil {
		t.Fatalf("readVideoScreenshotInfos() error = %v", err)
	}
	if items == nil || len(items) != 0 {
		t.Fatalf("expected a non-nil empty screenshot list, got %#v", items)
	}
}
