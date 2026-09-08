package server

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"javboss/internal/common"
	"javboss/internal/common/logging"
	dbpkg "javboss/internal/db"
	"javboss/internal/jav"
	"javboss/internal/manager"
	"javboss/internal/models"
	"javboss/internal/mpv"
	"javboss/internal/runtimeconfig"
	"javboss/internal/util"
)

var remoteMediaHTTPClient = util.NewHTTPClient(0)

func listVideos(c *gin.Context) {
	limit := queryInt(c, "limit", 100)
	offset := queryInt(c, "offset", 0)
	tagFilter := parseTagQuery(c.Query("tags"))
	search := strings.TrimSpace(c.Query("search"))
	sort := strings.TrimSpace(c.Query("sort"))
	hideJav := queryBool(c, "hide_jav", false)
	seedParam := strings.TrimSpace(c.Query("seed"))
	var seed *int64
	if seedParam != "" {
		parsed, err := strconv.ParseInt(seedParam, 10, 64)
		if err != nil || parsed <= 0 {
			respondLocalizedError(c, http.StatusBadRequest, "随机种子无效", "Invalid random seed")
			return
		}
		seed = &parsed
	}

	videos, err := dbpkg.ListVideos(c.Request.Context(), limit, offset, tagFilter, search, sort, seed, nil, hideJav)
	if err != nil {
		logging.Error("list videos error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "加载视频列表失败", "Failed to load videos")
		return
	}

	total, err := dbpkg.CountVideos(c.Request.Context(), tagFilter, search, nil, hideJav)
	if err != nil {
		logging.Error("count videos error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "统计视频数量失败", "Failed to count videos")
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"items": videos,
		"total": total,
	})
}

func getVideo(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "视频 ID 无效", "Invalid video ID")
		return
	}

	video, err := dbpkg.GetVideo(c.Request.Context(), id)
	if err != nil {
		logging.Error("get video error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "加载视频信息失败", "Failed to load video information")
		return
	}
	if video == nil {
		respondLocalizedError(c, http.StatusNotFound, "视频不存在", "Video does not exist")
		return
	}
	c.JSON(http.StatusOK, video)
}

func incrementVideoPlayCount(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		respondLocalizedError(c, http.StatusBadRequest, "视频 ID 无效", "Invalid video ID")
		return
	}
	if err := dbpkg.IncrementVideoPlayCount(c.Request.Context(), id); err != nil {
		logging.Error("increment play count error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "更新视频播放次数失败", "Failed to update video play count")
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

type playbackSource struct {
	Kind     string `json:"kind"`
	Src      string `json:"src"`
	MimeType string `json:"mime_type"`
	Label    string `json:"label"`
}

type playbackInfo struct {
	VideoID       int64            `json:"video_id"`
	PreferredKind string           `json:"preferred_kind"`
	Sources       []playbackSource `json:"sources"`
	VideoCodec    string           `json:"video_codec"`
	AudioCodec    string           `json:"audio_codec"`
}

type videoScreenshotInfo struct {
	VideoID    int64     `json:"video_id"`
	Name       string    `json:"name"`
	URL        string    `json:"url"`
	Size       int64     `json:"size"`
	ModifiedAt time.Time `json:"modified_at"`
	IsCover    bool      `json:"is_cover"`
}

type videoCoverRequest struct {
	ScreenshotName string `json:"screenshot_name"`
}

type renameVideoLocationRequest struct {
	Filename string `json:"filename"`
}

type videoJavScrapeSettingsRequest struct {
	Mode string `json:"mode"`
	Code string `json:"code"`
}

type videoJavManualScrapeRequest struct {
	LocationID   int64    `json:"location_id"`
	Code         string   `json:"code"`
	Title        string   `json:"title"`
	Studio       string   `json:"studio"`
	Series       string   `json:"series"`
	ReleaseDate  string   `json:"release_date"`
	DurationMin  *int     `json:"duration_min"`
	Tags         []string `json:"tags"`
	Actors       []string `json:"actors"`
	CoverURL     string   `json:"cover_url"`
	IsUncensored *bool    `json:"is_uncensored"`
}

type videoJavExistingLinkRequest struct {
	LocationID int64  `json:"location_id"`
	Code       string `json:"code"`
}

type videoJavScrapeInfoResponse struct {
	Code         string   `json:"code"`
	Title        string   `json:"title"`
	Studio       string   `json:"studio"`
	Series       string   `json:"series"`
	ReleaseDate  string   `json:"release_date"`
	ReleaseUnix  int64    `json:"release_unix"`
	DurationMin  int      `json:"duration_min"`
	Tags         []string `json:"tags"`
	Actors       []string `json:"actors"`
	CoverURL     string   `json:"cover_url"`
	IsUncensored *bool    `json:"is_uncensored"`
}

type videoJavPossibleCodesResponse struct {
	Filename      string   `json:"filename"`
	PossibleCodes []string `json:"possible_codes"`
}

func getVideoStreams(c *gin.Context) {
	video, fullPath, locationID, err := resolveVideoStreamTarget(c)
	if err != nil {
		respondPlaybackError(c, err)
		return
	}

	probe, err := util.ProbePlaybackSupport(fullPath)
	if err != nil {
		logging.Error("probe playback support error: %v", err)
		respondPlaybackError(c, err)
		return
	}

	c.JSON(http.StatusOK, buildPlaybackInfo(video, locationID, probe))
}

func buildPlaybackInfo(video *models.Video, locationID int64, probe *util.PlaybackProbeResult) playbackInfo {
	info := playbackInfo{
		VideoID:       video.ID,
		PreferredKind: "hls",
		Sources:       []playbackSource{},
		VideoCodec:    probe.VideoCodec,
		AudioCodec:    probe.AudioCodec,
	}
	if probe.SupportsDirect && !isRemoteMediaInput(fullPath) {
		info.PreferredKind = "direct"
	}
	// Advertise the original file even when the conservative server policy
	// rejects it. The browser decides whether its native decoder can try it.
	if mimeType := directMimeType(probe.Container); mimeType != "" {
		info.Sources = append(info.Sources, playbackSource{
			Kind:     "direct",
			Src:      buildDirectStreamURL(video, locationID),
			MimeType: mimeType,
			Label:    "Direct",
		})
	}
	info.Sources = append(info.Sources, playbackSource{
		Kind:     "hls",
		Src:      buildHLSStreamURL(video, locationID),
		MimeType: manager.MimeHLS,
		Label:    "HLS",
	})

	return info
}

func streamVideo(c *gin.Context) {
	var fullPath string
	var err error
	if strings.TrimSpace(c.Query("location_id")) != "" {
		fullPath, err = resolveStreamPathFromLocationQuery(c)
	} else {
		fullPath, err = resolveStreamPathFromQuery(c)
	}
	if err == nil {
		fullPath, err = resolveMediaInputFromLocator(fullPath)
	}
	if err != nil {
		_, fullPath, _, err = resolveVideoStreamTarget(c)
		if err != nil {
			respondPlaybackError(c, err)
			return
		}
	}
	if isRemoteMediaInput(fullPath) {
		serveRemoteVideo(c, fullPath)
		return
	}
	serveVideoFile(c, fullPath)
}

func streamHLSManifest(c *gin.Context) {
	video, fullPath, _, err := resolveVideoStreamTarget(c)
	if err != nil {
		respondPlaybackError(c, err)
		return
	}
	if common.StreamManager == nil {
		respondLocalizedError(c, http.StatusServiceUnavailable, "浏览器播放服务不可用", "Browser playback service is unavailable")
		return
	}

	resolution := strings.TrimSpace(c.Query("resolution"))
	c.Header("Cache-Control", "no-cache")
	common.StreamManager.ServeManifest(c.Writer, c.Request, fullPath, float64(video.DurationSec), resolution)
}

func streamHLSSegment(c *gin.Context) {
	video, fullPath, locationID, err := resolveVideoStreamTarget(c)
	if err != nil {
		respondPlaybackError(c, err)
		return
	}
	if common.StreamManager == nil {
		respondLocalizedError(c, http.StatusServiceUnavailable, "浏览器播放服务不可用", "Browser playback service is unavailable")
		return
	}

	segment := strings.TrimSpace(c.Param("segment"))
	resolution := strings.TrimSpace(c.Query("resolution"))
	c.Header("Cache-Control", "no-cache")
	common.StreamManager.ServeSegment(c.Writer, c.Request, manager.StreamOptions{
		StreamType: manager.StreamTypeHLS,
		SourcePath: fullPath,
		Duration:   float64(video.DurationSec),
		Resolution: resolution,
		Key:        streamCacheKey(video.ID, locationID),
		Segment:    segment,
	})
}

func resolveStreamPathFromLocationQuery(c *gin.Context) (string, error) {
	videoID, err := strconv.ParseInt(strings.TrimSpace(c.Param("id")), 10, 64)
	if err != nil || videoID <= 0 {
		return "", errors.New("invalid id")
	}
	locationID, err := parseLocationIDQuery(c)
	if err != nil || locationID <= 0 {
		return "", err
	}
	loc, err := dbpkg.GetActiveVideoLocation(c.Request.Context(), videoID, locationID)
	if err != nil {
		return "", err
	}
	if loc == nil {
		return "", os.ErrNotExist
	}
	fullPath, _, err := resolveVideoPath(loc.RelativePath, loc.DirectoryRef.Path)
	return fullPath, err
}

func resolveStreamPathFromQuery(c *gin.Context) (string, error) {
	rawPath := strings.TrimSpace(c.Query("path"))
	rawDirPath := strings.TrimSpace(c.Query("dir_path"))
	fullPath, _, err := resolveVideoPath(rawPath, rawDirPath)
	return fullPath, err
}

func resolveVideoStreamTarget(c *gin.Context) (*models.Video, string, int64, error) {
	id, err := strconv.ParseInt(strings.TrimSpace(c.Param("id")), 10, 64)
	if err != nil || id <= 0 {
		return nil, "", 0, errors.New("invalid id")
	}

	video, err := dbpkg.GetVideo(c.Request.Context(), id)
	if err != nil {
		return nil, "", 0, err
	}
	if video == nil {
		return nil, "", 0, os.ErrNotExist
	}

	locationID, err := parseLocationIDQuery(c)
	if err != nil {
		return nil, "", 0, err
	}

	var fullPath string
	if locationID > 0 {
		fullPath, err = resolveStreamPathFromLocationQuery(c)
	} else {
		fullPath, err = resolveVideoPrimaryPath(c.Request.Context(), video)
	}
	if err != nil {
		return nil, "", 0, err
	}
	fullPath, err = resolveMediaInputFromLocator(fullPath)
	if err != nil {
		return nil, "", 0, err
	}

	return video, fullPath, locationID, nil
}

func parseLocationIDQuery(c *gin.Context) (int64, error) {
	raw := strings.TrimSpace(c.Query("location_id"))
	if raw == "" {
		return 0, nil
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		return 0, errors.New("invalid location_id")
	}
	return id, nil
}

func respondPlaybackError(c *gin.Context, err error) {
	switch {
	case err == nil:
		return
	case errors.Is(err, os.ErrNotExist):
		respondLocalizedError(c, http.StatusNotFound, "视频文件或所在目录不存在", "Video file or directory does not exist")
	case errors.Is(err, context.Canceled):
		c.Status(499)
	case strings.Contains(err.Error(), "ffmpeg not found"), strings.Contains(err.Error(), "ffprobe not found"):
		respondLocalizedError(c, http.StatusServiceUnavailable, "缺少浏览器播放所需组件", err.Error())
	case strings.Contains(err.Error(), "browser playback is not supported"):
		respondLocalizedError(c, http.StatusUnprocessableEntity, "当前视频不支持浏览器播放", err.Error())
	case strings.Contains(err.Error(), "invalid segment"), strings.Contains(err.Error(), "invalid id"), strings.Contains(err.Error(), "invalid location_id"), strings.Contains(err.Error(), "invalid path"):
		respondLocalizedError(c, http.StatusBadRequest, "播放请求参数无效", "Invalid playback request")
	default:
		respondLocalizedError(c, http.StatusInternalServerError, "加载播放信息失败", "Failed to load playback information")
	}
}

func directMimeType(container string) string {
	switch strings.ToLower(strings.TrimSpace(container)) {
	case "mp4":
		return "video/mp4"
	case "webm":
		return "video/webm"
	case "mov":
		return "video/quicktime"
	case "mkv", "matroska":
		return "video/x-matroska"
	case "ogg", "ogv":
		return "video/ogg"
	default:
		return ""
	}
}

func buildDirectStreamURL(video *models.Video, locationID int64) string {
	if video == nil {
		return ""
	}
	streamURL := "/videos/" + strconv.FormatInt(video.ID, 10) + "/stream"
	if locationID > 0 {
		streamURL += "?location_id=" + strconv.FormatInt(locationID, 10)
	}
	return streamURL
}

func buildHLSStreamURL(video *models.Video, locationID int64) string {
	if video == nil {
		return ""
	}
	streamURL := "/videos/" + strconv.FormatInt(video.ID, 10) + "/stream.m3u8"
	if locationID > 0 {
		streamURL += "?location_id=" + strconv.FormatInt(locationID, 10)
	}
	return streamURL
}

func streamCacheKey(videoID int64, locationID int64) string {
	if locationID > 0 {
		return fmt.Sprintf("%d_location_%d", videoID, locationID)
	}
	return strconv.FormatInt(videoID, 10)
}

func resolveVideoPrimaryPath(ctx context.Context, video *models.Video) (string, error) {
	if video == nil {
		return "", errors.New("video is nil")
	}
	loc, err := dbpkg.GetPrimaryVideoLocation(ctx, video.ID)
	if err != nil {
		return "", err
	}
	if loc != nil {
		fullPath, _, err := resolveVideoPath(loc.RelativePath, loc.DirectoryRef.Path)
		return fullPath, err
	}
	return "", errors.New("video location missing")
}

func serveVideoFile(c *gin.Context, fullPath string) {
	if _, err := os.Stat(fullPath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			respondLocalizedError(c, http.StatusNotFound, "视频文件不存在", "Video file does not exist")
			return
		}
		logging.Error("stat stream file error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "读取视频文件失败", "Failed to inspect video file")
		return
	}
	if err := http.NewResponseController(c.Writer).SetWriteDeadline(time.Time{}); err != nil && !errors.Is(err, http.ErrNotSupported) {
		logging.Error("disable video stream write deadline error: %v", err)
	}
	c.File(fullPath)
}

func serveRemoteVideo(c *gin.Context, mediaURL string) {
	req, err := http.NewRequestWithContext(c.Request.Context(), c.Request.Method, mediaURL, nil)
	if err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "STRM 媒体地址无效", "Invalid STRM media URL")
		return
	}
	for _, name := range []string{"Range", "If-Range", "If-Modified-Since", "If-None-Match", "User-Agent"} {
		if value := c.GetHeader(name); value != "" {
			req.Header.Set(name, value)
		}
	}
	resp, err := remoteMediaHTTPClient.Do(req)
	if err != nil {
		logging.Error("proxy strm media error: %v", err)
		respondLocalizedError(c, http.StatusBadGateway, "连接 STRM 媒体失败", "Failed to connect to STRM media")
		return
	}
	defer resp.Body.Close()
	for _, name := range []string{
		"Accept-Ranges",
		"Cache-Control",
		"Content-Disposition",
		"Content-Length",
		"Content-Range",
		"Content-Type",
		"ETag",
		"Last-Modified",
	} {
		for _, value := range resp.Header.Values(name) {
			c.Writer.Header().Add(name, value)
		}
	}
	if err := http.NewResponseController(c.Writer).SetWriteDeadline(time.Time{}); err != nil && !errors.Is(err, http.ErrNotSupported) {
		logging.Error("disable strm proxy write deadline error: %v", err)
	}
	c.Status(resp.StatusCode)
	if c.Request.Method != http.MethodHead {
		if _, err := io.CopyBuffer(c.Writer, resp.Body, make([]byte, 256*1024)); err != nil && !errors.Is(err, context.Canceled) {
			logging.Error("proxy strm media response error: %v", err)
		}
	}
}

func openVideoFile(c *gin.Context) {
	if runtimeconfig.DisableDesktopIntegration() {
		respondLocalizedError(c, http.StatusNotImplemented, "当前部署模式已禁用系统播放器", "Desktop file opening is disabled")
		return
	}
	fullPath, dirPath, err := resolveVideoPathFromBody(c)
	if err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "视频文件路径无效", "Invalid video file path")
		return
	}
	if err := ensureVideoFileExists(c, fullPath); err != nil {
		return
	}
	source, err := util.ResolveMediaSource(fullPath)
	if err != nil {
		respondLocalizedError(c, http.StatusUnprocessableEntity, "读取 STRM 文件失败", "Failed to read STRM file")
		return
	}
	if err := util.OpenFile(source.Input); err != nil {
		logging.Error("open video file error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "使用系统播放器打开文件失败", "Failed to open file with the system player")
		return
	}
	incrementPlayCountByPath(c.Request.Context(), dirPath, fullPath)
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func playVideoFile(c *gin.Context) {
	if runtimeconfig.DisableMPVPlayback() {
		respondLocalizedError(c, http.StatusNotImplemented, "当前部署模式已禁用 MPV 播放", "MPV playback is disabled")
		return
	}
	req, fullPath, dirPath, err := resolveVideoPathRequestFromBody(c)
	if err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "视频文件路径无效", "Invalid video file path")
		return
	}
	if err := ensureVideoFileExists(c, fullPath); err != nil {
		return
	}
	videoID := resolvePlaybackVideoID(c.Request.Context(), req.VideoID, dirPath, fullPath)
	source, err := util.ResolveMediaSource(fullPath)
	if err != nil {
		respondLocalizedError(c, http.StatusUnprocessableEntity, "读取 STRM 文件失败", "Failed to read STRM file")
		return
	}
	dataDir := ""
	if common.AppConfig != nil {
		dataDir = filepath.Dir(common.AppConfig.DatabasePath)
	}
	if err := mpv.PlayVideo(source.Input, mpv.PlayOptions{
		DataDir:      dataDir,
		VideoID:      videoID,
		StartTimeSec: req.StartTimeSec,
	}); err != nil {
		logging.Error("play video file error: %v", err)
		if strings.Contains(err.Error(), "mpv not found") {
			respondLocalizedError(c, http.StatusServiceUnavailable, "未找到 MPV 播放器", err.Error())
			return
		}
		respondLocalizedError(c, http.StatusInternalServerError, "播放文件失败", "Failed to play file")
		return
	}
	if videoID > 0 {
		if err := dbpkg.IncrementVideoPlayCount(c.Request.Context(), videoID); err != nil {
			logging.Error("increment play count error: %v", err)
		}
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func playVideoPlaylist(c *gin.Context) {
	if runtimeconfig.DisableMPVPlayback() {
		respondLocalizedError(c, http.StatusNotImplemented, "当前部署模式已禁用 MPV 播放", "MPV playback is disabled")
		return
	}

	var req videoPlaylistRequest
	if err := c.ShouldBindJSON(&req); err != nil || len(req.Items) == 0 {
		respondLocalizedError(c, http.StatusBadRequest, "播放列表请求无效", "Invalid playlist request")
		return
	}

	dataDir := ""
	if common.AppConfig != nil {
		dataDir = filepath.Dir(common.AppConfig.DatabasePath)
	}
	items := make([]mpv.PlaylistItem, 0, len(req.Items))
	for _, requested := range req.Items {
		if requested.VideoID <= 0 || requested.LocationID < 0 {
			respondLocalizedError(c, http.StatusBadRequest, "播放列表包含无效视频", "Playlist contains an invalid video")
			return
		}

		var location *models.VideoLocation
		var err error
		if requested.LocationID > 0 {
			location, err = dbpkg.GetActiveVideoLocation(c.Request.Context(), requested.VideoID, requested.LocationID)
		} else {
			location, err = dbpkg.GetPrimaryVideoLocation(c.Request.Context(), requested.VideoID)
		}
		if err != nil {
			logging.Error("resolve playlist video location error: %v", err)
			respondLocalizedError(c, http.StatusInternalServerError, "加载播放列表失败", "Failed to load playlist")
			return
		}
		if location == nil {
			respondLocalizedError(c, http.StatusNotFound, "播放列表中的视频文件位置不存在", "A video location in the playlist does not exist")
			return
		}

		fullPath, _, err := resolveVideoPath(location.RelativePath, location.DirectoryRef.Path)
		if err != nil {
			respondLocalizedError(c, http.StatusBadRequest, "播放列表中的视频文件路径无效", "A video path in the playlist is invalid")
			return
		}
		if _, err := os.Stat(fullPath); err != nil {
			if errors.Is(err, os.ErrNotExist) {
				respondLocalizedError(c, http.StatusNotFound, "播放列表中的视频文件不存在", "A video file in the playlist does not exist")
			} else {
				logging.Error("stat playlist video file error: %v", err)
				respondLocalizedError(c, http.StatusInternalServerError, "读取播放列表中的视频文件失败", "Failed to inspect a video file in the playlist")
			}
			return
		}

		videoID := requested.VideoID
		items = append(items, mpv.PlaylistItem{
			Path:  fullPath,
			Title: location.Filename,
			OnStarted: func() {
				ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				defer cancel()
				if err := dbpkg.IncrementVideoPlayCount(ctx, videoID); err != nil {
					logging.Error("increment playlist video play count error: %v", err)
				}
			},
			Options: mpv.PlayOptions{
				DataDir: dataDir,
				VideoID: requested.VideoID,
			},
		})
	}

	if err := mpv.PlayPlaylist(items); err != nil {
		logging.Error("play video playlist error: %v", err)
		if strings.Contains(err.Error(), "mpv not found") {
			respondLocalizedError(c, http.StatusServiceUnavailable, "未找到 MPV 播放器", err.Error())
			return
		}
		respondLocalizedError(c, http.StatusInternalServerError, "播放列表启动失败", "Failed to start playlist")
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok", "count": len(items)})
}

func revealVideoLocation(c *gin.Context) {
	if isRemoteRequest(c.Request.RemoteAddr) {
		respondLocalizedError(c, http.StatusForbidden, "通过局域网访问时无法打开文件所在位置", "Cannot reveal file locations when accessing over the local network")
		return
	}
	if runtimeconfig.DisableDesktopIntegration() {
		respondLocalizedError(c, http.StatusNotImplemented, "当前部署模式已禁用打开文件位置", "Desktop file revealing is disabled")
		return
	}
	fullPath, _, err := resolveVideoPathFromBody(c)
	if err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "视频文件路径无效", "Invalid video file path")
		return
	}
	if err := ensureVideoFileExists(c, fullPath); err != nil {
		return
	}
	if err := util.RevealFile(fullPath); err != nil {
		logging.Error("reveal video file error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "打开文件所在位置失败", "Failed to reveal file")
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func renameVideoLocation(c *gin.Context) {
	videoID, locationID, ok := parseVideoLocationParams(c)
	if !ok {
		return
	}

	var req renameVideoLocationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "重命名请求无效", "Invalid rename request")
		return
	}
	filename := strings.TrimSpace(req.Filename)
	if !isSafeVideoFilename(filename) {
		respondLocalizedError(c, http.StatusBadRequest, "文件名无效", "Invalid filename")
		return
	}

	loc, err := dbpkg.GetActiveVideoLocation(c.Request.Context(), videoID, locationID)
	if err != nil {
		logging.Error("get video location for rename error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "读取视频位置失败", "Failed to load video location")
		return
	}
	if loc == nil {
		respondLocalizedError(c, http.StatusNotFound, "视频位置不存在", "Video location does not exist")
		return
	}

	currentRel := filepath.ToSlash(filepath.Clean(filepath.FromSlash(loc.RelativePath)))
	parentRel := filepath.ToSlash(filepath.Dir(filepath.FromSlash(currentRel)))
	nextRel := filename
	if parentRel != "." && parentRel != "" {
		nextRel = filepath.ToSlash(filepath.Join(parentRel, filename))
	}
	nextRel = filepath.ToSlash(filepath.Clean(filepath.FromSlash(nextRel)))
	if nextRel == "." || strings.HasPrefix(nextRel, "../") || nextRel == ".." {
		respondLocalizedError(c, http.StatusBadRequest, "文件名无效", "Invalid filename")
		return
	}
	if nextRel == currentRel {
		video, err := dbpkg.GetVideoForLocation(c.Request.Context(), videoID, locationID)
		if err != nil {
			logging.Error("load unchanged video location error: %v", err)
			respondLocalizedError(c, http.StatusInternalServerError, "读取视频信息失败", "Failed to load video information")
			return
		}
		if video == nil {
			respondLocalizedError(c, http.StatusNotFound, "视频不存在", "Video does not exist")
			return
		}
		c.JSON(http.StatusOK, video)
		return
	}

	exists, err := dbpkg.VideoLocationPathExists(c.Request.Context(), loc.DirectoryID, nextRel)
	if err != nil {
		logging.Error("check video location path error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "检查目标文件失败", "Failed to check target file")
		return
	}
	if exists {
		respondLocalizedError(c, http.StatusConflict, "目标文件已存在", "Target file already exists")
		return
	}

	oldFullPath, dirPath, err := resolveVideoPath(currentRel, loc.DirectoryRef.Path)
	if err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "原视频文件路径无效", "Invalid source video path")
		return
	}
	newFullPath, _, err := resolveVideoPath(nextRel, dirPath)
	if err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "目标视频文件路径无效", "Invalid target video path")
		return
	}
	info, err := os.Stat(oldFullPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			respondLocalizedError(c, http.StatusNotFound, "视频文件或所在目录不存在", "Video file or directory does not exist")
			return
		}
		logging.Error("stat video before rename error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "读取视频文件失败", "Failed to inspect video file")
		return
	}
	if info.IsDir() {
		respondLocalizedError(c, http.StatusBadRequest, "目标路径不是文件", "Path is not a file")
		return
	}
	if targetInfo, err := os.Stat(newFullPath); err == nil {
		if !os.SameFile(info, targetInfo) {
			respondLocalizedError(c, http.StatusConflict, "目标文件已存在", "Target file already exists")
			return
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		logging.Error("stat video rename target error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "检查目标文件失败", "Failed to inspect target file")
		return
	}

	if err := os.Rename(oldFullPath, newFullPath); err != nil {
		logging.Error("rename video file error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "重命名视频文件失败", "Failed to rename video file")
		return
	}
	modifiedAt := info.ModTime()
	if renamedInfo, err := os.Stat(newFullPath); err == nil {
		modifiedAt = renamedInfo.ModTime()
	}
	if _, err := dbpkg.UpdateVideoLocationPath(c.Request.Context(), locationID, nextRel, modifiedAt); err != nil {
		if rollbackErr := os.Rename(newFullPath, oldFullPath); rollbackErr != nil {
			logging.Error("rollback video file rename failed: %v", rollbackErr)
		}
		if errors.Is(err, dbpkg.ErrVideoLocationPathConflict) {
			respondLocalizedError(c, http.StatusConflict, "目标文件已存在", "Target file already exists")
			return
		}
		logging.Error("update video location after rename error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "保存重命名结果失败", "Failed to save renamed video location")
		return
	}

	video, err := dbpkg.GetVideoForLocation(c.Request.Context(), videoID, locationID)
	if err != nil {
		logging.Error("load renamed video location error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "重新加载视频失败", "Failed to reload video")
		return
	}
	if video == nil {
		respondLocalizedError(c, http.StatusNotFound, "视频不存在", "Video does not exist")
		return
	}
	c.JSON(http.StatusOK, video)
}

func updateVideoJavScrapeSettings(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		respondLocalizedError(c, http.StatusBadRequest, "视频 ID 无效", "Invalid video ID")
		return
	}

	var req videoJavScrapeSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "刮削设置请求无效", "Invalid scrape settings request")
		return
	}
	override, ok := normalizeVideoJavScrapeOverride(req)
	if !ok {
		respondLocalizedError(c, http.StatusBadRequest, "JAV 刮削设置无效", "Invalid JAV scrape settings")
		return
	}

	video, err := dbpkg.UpdateVideoJavScrapeOverride(c.Request.Context(), id, override)
	if err != nil {
		logging.Error("update video jav scrape settings error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "保存刮削设置失败", "Failed to save scrape settings")
		return
	}
	if video == nil {
		respondLocalizedError(c, http.StatusNotFound, "视频不存在", "Video does not exist")
		return
	}
	c.JSON(http.StatusOK, video)
}

func getVideoJavScrapePossibleCodes(c *gin.Context) {
	id, ok := parsePositiveVideoID(c)
	if !ok {
		return
	}

	video, err := dbpkg.GetVideo(c.Request.Context(), id)
	if err != nil {
		logging.Error("load video for jav scrape possible codes error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "提取番号失败", "Failed to extract JAV codes")
		return
	}
	if video == nil {
		respondLocalizedError(c, http.StatusNotFound, "视频不存在", "Video does not exist")
		return
	}

	filename := filepath.Base(filepath.FromSlash(video.Filename))
	c.JSON(http.StatusOK, videoJavPossibleCodesResponse{
		Filename:      filename,
		PossibleCodes: util.ExtractCodeFromName(filename),
	})
}

func lookupVideoJavScrape(c *gin.Context) {
	provider, ok := parseVideoJavScrapeLookupProvider(c.Query("provider"))
	if !ok {
		respondLocalizedError(c, http.StatusBadRequest, "自动填充来源无效", "Invalid autofill provider")
		return
	}
	lookupVideoJavScrapeByProvider(c, provider)
}

func lookupVideoJavScrapeByProvider(c *gin.Context, provider jav.Provider) {
	if _, ok := parsePositiveVideoID(c); !ok {
		return
	}
	code := strings.TrimSpace(c.Query("code"))
	if code == "" {
		respondLocalizedError(c, http.StatusBadRequest, "番号不能为空", "JAV code is required")
		return
	}

	providerLabel := videoJavScrapeLookupProviderLabel(provider)
	info, err := jav.LookupJavByCode(code, provider)
	if err != nil {
		if errors.Is(err, jav.ResourceNotFonud) {
			respondLocalizedError(
				c,
				http.StatusNotFound,
				fmt.Sprintf("%s 中未找到对应元数据", providerLabel),
				fmt.Sprintf("%s metadata was not found", providerLabel),
			)
			return
		}
		logging.Error("lookup %s metadata code=%s: %v", provider.String(), code, err)
		respondLocalizedError(
			c,
			http.StatusInternalServerError,
			fmt.Sprintf("从 %s 获取元数据失败", providerLabel),
			fmt.Sprintf("Failed to fetch metadata from %s", providerLabel),
		)
		return
	}
	if info == nil {
		respondLocalizedError(
			c,
			http.StatusNotFound,
			fmt.Sprintf("%s 中未找到对应元数据", providerLabel),
			fmt.Sprintf("%s metadata was not found", providerLabel),
		)
		return
	}
	c.JSON(http.StatusOK, javInfoToVideoScrapeResponse(info))
}

func parseVideoJavScrapeLookupProvider(value string) (jav.Provider, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "avmoo":
		return jav.ProviderAvmoo, true
	case "javbus":
		return jav.ProviderJavBus, true
	case "avsox":
		return jav.ProviderAvsox, true
	default:
		return jav.ProviderUnknown, false
	}
}

func videoJavScrapeLookupProviderLabel(provider jav.Provider) string {
	switch provider {
	case jav.ProviderAvmoo:
		return "AvMoo"
	case jav.ProviderJavBus:
		return "JavBus"
	case jav.ProviderAvsox:
		return "AVSOX"
	default:
		return provider.String()
	}
}

func linkVideoExistingJav(c *gin.Context) {
	id, ok := parsePositiveVideoID(c)
	if !ok {
		return
	}

	var req videoJavExistingLinkRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "关联番号请求无效", "Invalid JAV link request")
		return
	}
	code, valid := normalizeForcedJavScrapeCode(req.Code)
	if !valid {
		respondLocalizedError(c, http.StatusBadRequest, "番号无效", "Invalid JAV code")
		return
	}
	if req.LocationID <= 0 {
		respondLocalizedError(c, http.StatusBadRequest, "视频位置 ID 不能为空", "Video location ID is required")
		return
	}

	loc, err := dbpkg.GetActiveVideoLocation(c.Request.Context(), id, req.LocationID)
	if err != nil {
		logging.Error("load video location for existing jav link video=%d location=%d: %v", id, req.LocationID, err)
		respondLocalizedError(c, http.StatusInternalServerError, "读取视频位置失败", "Failed to load video location")
		return
	}
	if loc == nil {
		respondLocalizedError(c, http.StatusNotFound, "视频位置不存在", "Video location does not exist")
		return
	}

	javRec, err := dbpkg.LinkVideoLocationsToExistingJav(c.Request.Context(), code, id)
	if err != nil {
		logging.Error("link video to existing jav failed video=%d code=%s: %v", id, code, err)
		respondLocalizedError(c, http.StatusInternalServerError, "关联已有番号失败", "Failed to link existing JAV")
		return
	}
	if javRec == nil {
		respondLocalizedError(
			c,
			http.StatusNotFound,
			fmt.Sprintf("番号 %s 在 JAV 库中不存在", code),
			fmt.Sprintf("JAV code %s does not exist in the library", code),
		)
		return
	}

	video, err := dbpkg.GetVideoForLocation(c.Request.Context(), id, loc.ID)
	if err != nil {
		logging.Error("existing jav link reload failed video=%d location=%d code=%s: %v", id, loc.ID, code, err)
		respondLocalizedError(c, http.StatusInternalServerError, "重新加载视频失败", "Failed to reload video")
		return
	}
	if video == nil {
		respondLocalizedError(c, http.StatusNotFound, "视频不存在", "Video does not exist")
		return
	}
	c.JSON(http.StatusOK, video)
}

func manualVideoJavScrape(c *gin.Context) {
	id, ok := parsePositiveVideoID(c)
	if !ok {
		return
	}

	var req videoJavManualScrapeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "手动刮削请求无效", "Invalid manual scrape request")
		return
	}
	info, err := manualScrapeRequestToJavInfo(req)
	if err != nil {
		messageZH := "手动刮削信息无效"
		messageEN := "Invalid manual scrape metadata"
		switch err.Error() {
		case "code is required":
			messageZH = "番号不能为空"
			messageEN = "JAV code is required"
		case "title is required":
			messageZH = "标题不能为空"
			messageEN = "Title is required"
		case "release_date is required":
			messageZH = "发行日期不能为空"
			messageEN = "Release date is required"
		case "release_date must be YYYY-MM-DD":
			messageZH = "发行日期格式必须为 YYYY-MM-DD"
			messageEN = "Release date must use the YYYY-MM-DD format"
		case "duration_min is required":
			messageZH = "时长不能为空"
			messageEN = "Duration is required"
		case "duration_min must be non-negative":
			messageZH = "时长不能为负数"
			messageEN = "Duration cannot be negative"
		case "is_uncensored is required":
			messageZH = "请选择有码状态"
			messageEN = "Censor state is required"
		}
		respondLocalizedError(c, http.StatusBadRequest, messageZH, messageEN)
		return
	}

	if req.LocationID <= 0 {
		respondLocalizedError(c, http.StatusBadRequest, "视频位置 ID 不能为空", "Video location ID is required")
		return
	}

	loc, err := dbpkg.GetActiveVideoLocation(c.Request.Context(), id, req.LocationID)
	if err != nil {
		logging.Error("load video location for manual jav scrape video=%d location=%d: %v", id, req.LocationID, err)
		respondLocalizedError(c, http.StatusInternalServerError, "读取视频位置失败", "Failed to load video location")
		return
	}
	if loc == nil {
		respondLocalizedError(c, http.StatusNotFound, "视频位置不存在", "Video location does not exist")
		return
	}

	javRec, err := dbpkg.SaveManualJavInfoAndLinkVideoLocations(c.Request.Context(), info, id)
	if err != nil {
		logging.Error("manual jav scrape save failed video=%d code=%s: %v", id, info.Code, err)
		respondLocalizedError(c, http.StatusBadRequest, "保存手动刮削信息失败", "Failed to save manual scrape metadata")
		return
	}
	if javRec == nil {
		respondLocalizedError(c, http.StatusNotFound, "未生成 JAV 元数据", "JAV metadata was not created")
		return
	}

	video, err := dbpkg.GetVideoForLocation(c.Request.Context(), id, loc.ID)
	if err != nil {
		logging.Error("manual jav scrape reload failed video=%d location=%d code=%s: %v", id, loc.ID, info.Code, err)
		respondLocalizedError(c, http.StatusInternalServerError, "重新加载视频失败", "Failed to reload video")
		return
	}
	if video == nil {
		respondLocalizedError(c, http.StatusNotFound, "视频不存在", "Video does not exist")
		return
	}

	downloadManualJavCover(c.Request.Context(), info)
	c.JSON(http.StatusOK, video)
}

func parsePositiveVideoID(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(strings.TrimSpace(c.Param("id")), 10, 64)
	if err != nil || id <= 0 {
		respondLocalizedError(c, http.StatusBadRequest, "视频 ID 无效", "Invalid video ID")
		return 0, false
	}
	return id, true
}

func manualScrapeRequestToJavInfo(req videoJavManualScrapeRequest) (*jav.JavInfo, error) {
	code := strings.ToUpper(strings.TrimSpace(req.Code))
	if code == "" {
		return nil, errors.New("code is required")
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		return nil, errors.New("title is required")
	}
	if strings.TrimSpace(req.ReleaseDate) == "" {
		return nil, errors.New("release_date is required")
	}
	releaseUnix, err := parseJavEditReleaseUnix(req.ReleaseDate)
	if err != nil {
		return nil, err
	}
	if req.DurationMin == nil {
		return nil, errors.New("duration_min is required")
	}
	durationMin := *req.DurationMin
	if durationMin < 0 {
		return nil, errors.New("duration_min must be non-negative")
	}
	if req.IsUncensored == nil {
		return nil, errors.New("is_uncensored is required")
	}
	info := &jav.JavInfo{
		Code:         code,
		Title:        title,
		Studio:       strings.TrimSpace(req.Studio),
		Series:       strings.TrimSpace(req.Series),
		ReleaseUnix:  releaseUnix,
		DurationMin:  durationMin,
		Tags:         normalizeTextList(req.Tags),
		Actors:       normalizeTextList(req.Actors),
		CoverURL:     strings.TrimSpace(req.CoverURL),
		IsUncensored: req.IsUncensored,
		Provider:     jav.ProviderManualScrape,
	}
	return info, nil
}

func normalizeTextList(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func javInfoToVideoScrapeResponse(info *jav.JavInfo) videoJavScrapeInfoResponse {
	if info == nil {
		return videoJavScrapeInfoResponse{}
	}
	return videoJavScrapeInfoResponse{
		Code:         info.Code,
		Title:        info.Title,
		Studio:       info.Studio,
		Series:       info.Series,
		ReleaseDate:  formatUnixDate(info.ReleaseUnix),
		ReleaseUnix:  info.ReleaseUnix,
		DurationMin:  info.DurationMin,
		Tags:         append([]string(nil), info.Tags...),
		Actors:       append([]string(nil), info.Actors...),
		CoverURL:     info.CoverURL,
		IsUncensored: info.IsUncensored,
	}
}

func formatUnixDate(unix int64) string {
	if unix <= 0 {
		return ""
	}
	return time.Unix(unix, 0).UTC().Format("2006-01-02")
}

func downloadManualJavCover(ctx context.Context, info *jav.JavInfo) {
	if info == nil || strings.TrimSpace(info.Code) == "" || strings.TrimSpace(info.CoverURL) == "" {
		return
	}
	cfg := common.AppConfig
	if cfg == nil || strings.TrimSpace(cfg.JavCoverDir) == "" {
		return
	}
	coverCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	if err := manager.DownloadCoverFromURL(coverCtx, cfg.JavCoverDir, info.Code, info.CoverURL); err != nil {
		logging.Error("manual jav cover download failed code=%s: %v", info.Code, err)
	}
}

func normalizeVideoJavScrapeOverride(req videoJavScrapeSettingsRequest) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(req.Mode)) {
	case "", "auto":
		return "", true
	case "skip":
		return models.JavScrapeOverrideSkip, true
	case "code":
		code, ok := normalizeForcedJavScrapeCode(req.Code)
		return code, ok
	default:
		return "", false
	}
}

func normalizeForcedJavScrapeCode(raw string) (string, bool) {
	code := strings.ToUpper(strings.TrimSpace(raw))
	if code == "" || len(code) > 64 {
		return "", false
	}
	for _, r := range code {
		switch {
		case r >= 'A' && r <= 'Z':
		case r >= '0' && r <= '9':
		case r == '-' || r == '_':
		default:
			return "", false
		}
	}
	return code, true
}

func deleteVideoLocation(c *gin.Context) {
	videoID, locationID, ok := parseVideoLocationParams(c)
	if !ok {
		return
	}

	loc, err := dbpkg.GetActiveVideoLocation(c.Request.Context(), videoID, locationID)
	if err != nil {
		logging.Error("get video location for delete error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "读取视频位置失败", "Failed to load video location")
		return
	}
	if loc == nil {
		respondLocalizedError(c, http.StatusNotFound, "视频位置不存在", "Video location does not exist")
		return
	}
	if loc.DirectoryRef.Missing {
		respondLocalizedError(c, http.StatusConflict, "目录缺失，无法删除视频", "The directory is missing; video cannot be deleted")
		return
	}

	fullPath, _, err := resolveVideoPath(loc.RelativePath, loc.DirectoryRef.Path)
	if err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "视频文件路径无效", "Invalid video file path")
		return
	}
	info, err := os.Stat(fullPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			respondLocalizedError(c, http.StatusNotFound, "视频文件不存在，无法删除", "The video file does not exist and cannot be deleted")
			return
		}
		logging.Error("stat video before delete error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "读取视频文件失败", "Failed to inspect video file")
		return
	} else if info.IsDir() {
		respondLocalizedError(c, http.StatusBadRequest, "目标路径不是文件", "Path is not a file")
		return
	} else if err := util.MoveFileToTrash(fullPath); err != nil {
		logging.Error("delete video file error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "删除视频文件失败", "Failed to delete video file")
		return
	}

	if err := dbpkg.HideVideoLocationsByIDs(c.Request.Context(), []int64{locationID}); err != nil {
		logging.Error("hide deleted video location error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "更新视频记录失败", "Failed to update video record")
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func parseVideoLocationParams(c *gin.Context) (int64, int64, bool) {
	videoID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || videoID <= 0 {
		respondLocalizedError(c, http.StatusBadRequest, "视频 ID 无效", "Invalid video ID")
		return 0, 0, false
	}
	locationID, err := strconv.ParseInt(c.Param("location_id"), 10, 64)
	if err != nil || locationID <= 0 {
		respondLocalizedError(c, http.StatusBadRequest, "视频位置 ID 无效", "Invalid video location ID")
		return 0, 0, false
	}
	return videoID, locationID, true
}

func isSafeVideoFilename(name string) bool {
	if name == "" || name == "." || name == ".." {
		return false
	}
	if strings.ContainsAny(name, `/\`) {
		return false
	}
	return filepath.Base(name) == name
}

type videoPathRequest struct {
	VideoID      int64   `json:"video_id"`
	Path         string  `json:"path"`
	DirPath      string  `json:"dir_path"`
	StartTimeSec float64 `json:"start_time"`
}

type videoPlaylistItemRequest struct {
	VideoID    int64 `json:"video_id"`
	LocationID int64 `json:"location_id"`
}

type videoPlaylistRequest struct {
	Items []videoPlaylistItemRequest `json:"items"`
}

func resolveVideoPathFromBody(c *gin.Context) (string, string, error) {
	_, fullPath, dirPath, err := resolveVideoPathRequestFromBody(c)
	return fullPath, dirPath, err
}

func resolveVideoPathRequestFromBody(c *gin.Context) (videoPathRequest, string, string, error) {
	var req videoPathRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		return req, "", "", errors.New("invalid payload")
	}
	if req.StartTimeSec < 0 {
		return req, "", "", errors.New("invalid start_time")
	}
	fullPath, dirPath, err := resolveVideoPath(req.Path, req.DirPath)
	return req, fullPath, dirPath, err
}

func resolveVideoPath(rawPath, rawDirPath string) (string, string, error) {
	if strings.TrimSpace(rawPath) == "" || strings.TrimSpace(rawDirPath) == "" {
		return "", "", errors.New("path and dir_path are required")
	}

	dirPath := filepath.Clean(rawDirPath)
	if dirPath == "." || !filepath.IsAbs(dirPath) {
		return "", "", errors.New("invalid dir_path")
	}

	cleanPath := filepath.Clean(filepath.FromSlash(rawPath))
	if cleanPath == "." {
		return "", "", errors.New("invalid path")
	}

	fullPath := cleanPath
	if !filepath.IsAbs(cleanPath) {
		fullPath = filepath.Join(dirPath, cleanPath)
	}

	relCheck, err := filepath.Rel(dirPath, fullPath)
	if err != nil || relCheck == ".." || strings.HasPrefix(relCheck, ".."+string(os.PathSeparator)) {
		return "", "", errors.New("invalid path")
	}
	return fullPath, dirPath, nil
}

func ensureVideoFileExists(c *gin.Context, fullPath string) error {
	if _, err := os.Stat(fullPath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			respondLocalizedError(c, http.StatusNotFound, "视频文件或所在目录不存在", "Video file or directory does not exist")
			return err
		}
		logging.Error("stat stream file error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "读取视频文件失败", "Failed to inspect video file")
		return err
	}
	return nil
}

func resolveMediaInputFromLocator(locatorPath string) (string, error) {
	if _, err := os.Stat(locatorPath); err != nil {
		return "", err
	}
	source, err := util.ResolveMediaSource(locatorPath)
	if err != nil {
		return "", err
	}
	return source.Input, nil
}

func isRemoteMediaInput(input string) bool {
	parsed, err := url.Parse(strings.TrimSpace(input))
	return err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Hostname() != ""
}

func incrementPlayCountByPath(ctx context.Context, dirPath, fullPath string) {
	if strings.TrimSpace(dirPath) == "" || strings.TrimSpace(fullPath) == "" {
		return
	}
	relPath, err := filepath.Rel(dirPath, fullPath)
	if err != nil {
		logging.Error("resolve relative path for play count: %v", err)
		return
	}
	relPath = filepath.ToSlash(filepath.Clean(relPath))
	if relPath == "." || strings.HasPrefix(relPath, "..") {
		return
	}
	if err := dbpkg.IncrementVideoPlayCountByPath(ctx, dirPath, relPath); err != nil {
		logging.Error("increment play count by path error: %v", err)
	}
}

func resolvePlaybackVideoID(ctx context.Context, requestedID int64, dirPath, fullPath string) int64 {
	if requestedID > 0 {
		video, err := dbpkg.GetVideo(ctx, requestedID)
		if err != nil {
			logging.Error("get playback video error: %v", err)
		} else if video != nil {
			if candidate, err := resolveVideoPrimaryPath(ctx, video); err == nil && sameCleanPath(candidate, fullPath) {
				return video.ID
			}
		}
	}

	if strings.TrimSpace(dirPath) == "" || strings.TrimSpace(fullPath) == "" {
		return 0
	}
	relPath, err := filepath.Rel(dirPath, fullPath)
	if err != nil {
		logging.Error("resolve relative path for playback video id: %v", err)
		return 0
	}
	relPath = filepath.ToSlash(filepath.Clean(relPath))
	if relPath == "." || strings.HasPrefix(relPath, "..") {
		return 0
	}
	videoID, err := dbpkg.GetVideoIDByPath(ctx, dirPath, relPath)
	if err != nil {
		logging.Error("lookup playback video id by path error: %v", err)
		return 0
	}
	return videoID
}

func sameCleanPath(a, b string) bool {
	return filepath.Clean(a) == filepath.Clean(b)
}

func getThumbnail(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "视频 ID 无效", "Invalid video ID")
		return
	}

	video, err := dbpkg.GetVideo(c.Request.Context(), id)
	if err != nil {
		logging.Error("get screenshot error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "加载视频缩略图信息失败", "Failed to load video thumbnail information")
		return
	}
	if video == nil {
		respondLocalizedError(c, http.StatusNotFound, "视频不存在", "Video does not exist")
		return
	}

	if common.AppConfig == nil {
		respondLocalizedError(c, http.StatusInternalServerError, "应用配置尚未加载", "Application configuration is not loaded")
		return
	}
	dataDir := filepath.Dir(common.AppConfig.DatabasePath)

	if !defaultVideoThumbnailRequested(c) {
		if path, ok := customVideoCoverPath(dataDir, video); ok {
			c.File(path)
			return
		}
	}

	second, ok := manager.PickScreenshotSecond(video.DurationSec)
	if !ok {
		respondLocalizedError(c, http.StatusNotFound, "视频没有可用的缩略图时间点", "No thumbnail timestamp is available for this video")
		return
	}

	screenshotPath := manager.ScreenshotPath(dataDir, video.ID, second)
	if screenshotPath == "" {
		respondLocalizedError(c, http.StatusInternalServerError, "生成缩略图路径失败", "Failed to build the thumbnail path")
		return
	}

	if _, err := os.Stat(screenshotPath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			common.ScreenshotManager.EnqueueForVideo(video)
			respondLocalizedError(c, http.StatusNotFound, "视频缩略图尚未生成", "Video thumbnail has not been generated yet")
			return
		}
		logging.Error("stat screenshot error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "读取视频缩略图失败", "Failed to inspect the video thumbnail")
		return
	}

	c.File(screenshotPath)
}

func defaultVideoThumbnailRequested(c *gin.Context) bool {
	return c.Query("default") == "1"
}

func updateVideoCover(c *gin.Context) {
	var req videoCoverRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "更新视频封面请求无效", "Invalid video cover update request")
		return
	}

	name := filepath.Base(strings.TrimSpace(req.ScreenshotName))
	if !isScreenshotImageName(name) || name != strings.TrimSpace(req.ScreenshotName) {
		respondLocalizedError(c, http.StatusBadRequest, "截图文件名无效", "Invalid screenshot filename")
		return
	}

	id, screenshotDir, ok := resolveVideoScreenshotDir(c)
	if !ok {
		return
	}
	screenshotPath := filepath.Join(screenshotDir, name)
	if _, err := os.Stat(screenshotPath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			respondLocalizedError(c, http.StatusNotFound, "用于封面的截图不存在", "The screenshot selected as cover does not exist")
			return
		}
		logging.Error("stat video cover screenshot error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "读取封面截图失败", "Failed to inspect the cover screenshot")
		return
	}

	updated, err := dbpkg.UpdateVideoCoverScreenshotName(c.Request.Context(), id, name)
	if err != nil {
		logging.Error("update video cover error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "保存视频封面失败", "Failed to save video cover")
		return
	}
	if updated == nil {
		respondLocalizedError(c, http.StatusNotFound, "视频不存在", "Video does not exist")
		return
	}
	c.JSON(http.StatusOK, updated)
}

func resetVideoCover(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		respondLocalizedError(c, http.StatusBadRequest, "视频 ID 无效", "Invalid video ID")
		return
	}
	updated, err := dbpkg.UpdateVideoCoverScreenshotName(c.Request.Context(), id, "")
	if err != nil {
		logging.Error("reset video cover error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "恢复默认视频封面失败", "Failed to restore the default video cover")
		return
	}
	if updated == nil {
		respondLocalizedError(c, http.StatusNotFound, "视频不存在", "Video does not exist")
		return
	}
	c.JSON(http.StatusOK, updated)
}

func listVideoScreenshots(c *gin.Context) {
	id, screenshotDir, ok := resolveVideoScreenshotDir(c)
	if !ok {
		return
	}
	video, err := dbpkg.GetVideo(c.Request.Context(), id)
	if err != nil {
		logging.Error("get video for screenshot cover state error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "读取视频封面状态失败", "Failed to load video cover state")
		return
	}
	coverName := ""
	if video != nil {
		coverName = strings.TrimSpace(video.CoverScreenshotName)
	}

	items, err := readVideoScreenshotInfos(id, coverName, screenshotDir)
	if err != nil {
		logging.Error("read video screenshots error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "加载视频截图失败", "Failed to load video screenshots")
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func listVideosScreenshots(c *gin.Context) {
	videoIDs := parseInt64CSV(c.Query("video_id_list"))
	if len(videoIDs) == 0 {
		respondLocalizedError(c, http.StatusBadRequest, "视频 ID 列表不能为空", "Video ID list is required")
		return
	}
	if len(videoIDs) > 100 {
		respondLocalizedError(c, http.StatusBadRequest, "一次最多查询 100 个视频的截图", "At most 100 videos can be queried at once")
		return
	}
	if common.AppConfig == nil {
		respondLocalizedError(c, http.StatusInternalServerError, "应用配置尚未加载", "Application configuration is not loaded")
		return
	}

	coverNames, err := dbpkg.ListVideoCoverScreenshotNames(c.Request.Context(), videoIDs)
	if err != nil {
		logging.Error("list video cover screenshot names error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "加载视频封面截图信息失败", "Failed to load video cover screenshot information")
		return
	}

	dataDir := filepath.Dir(common.AppConfig.DatabasePath)
	items := make([]videoScreenshotInfo, 0)
	for _, videoID := range videoIDs {
		coverName, exists := coverNames[videoID]
		if !exists {
			continue
		}
		screenshotDir := filepath.Join(
			dataDir,
			"video",
			strconv.FormatInt(videoID, 10),
			"screenshot",
		)
		videoItems, err := readVideoScreenshotInfos(videoID, coverName, screenshotDir)
		if err != nil {
			logging.Error("read video screenshots error (video_id=%d): %v", videoID, err)
			respondLocalizedError(c, http.StatusInternalServerError, "加载视频截图失败", "Failed to load video screenshots")
			return
		}
		items = append(items, videoItems...)
	}

	c.JSON(http.StatusOK, gin.H{"items": items})
}

func readVideoScreenshotInfos(id int64, coverName, screenshotDir string) ([]videoScreenshotInfo, error) {
	entries, err := os.ReadDir(screenshotDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []videoScreenshotInfo{}, nil
		}
		return nil, fmt.Errorf("read screenshot directory: %w", err)
	}

	items := make([]videoScreenshotInfo, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !isScreenshotImageName(entry.Name()) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			logging.Error("stat video screenshot error: %v", err)
			continue
		}
		name := entry.Name()
		imageURL := "/videos/" + strconv.FormatInt(id, 10) + "/screenshots/" + url.PathEscape(name)
		imageURL += "?mtime=" + strconv.FormatInt(info.ModTime().UnixNano(), 10)
		items = append(items, videoScreenshotInfo{
			VideoID:    id,
			Name:       name,
			URL:        imageURL,
			Size:       info.Size(),
			ModifiedAt: info.ModTime(),
			IsCover:    name == coverName,
		})
	}

	sort.Slice(items, func(i, j int) bool {
		if items[i].Name != items[j].Name {
			return items[i].Name < items[j].Name
		}
		return items[i].ModifiedAt.Before(items[j].ModifiedAt)
	})

	return items, nil
}

func createVideoScreenshot(c *gin.Context) {
	if common.ScreenshotManager == nil {
		respondLocalizedError(c, http.StatusServiceUnavailable, "截图服务不可用", "Screenshot service is unavailable")
		return
	}
	video, fullPath, _, err := resolveVideoStreamTarget(c)
	if err != nil {
		respondPlaybackError(c, err)
		return
	}
	if common.AppConfig == nil {
		respondLocalizedError(c, http.StatusInternalServerError, "应用配置尚未加载", "Application configuration is not loaded")
		return
	}

	var req struct {
		Second float64 `json:"second"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "创建视频截图请求无效", "Invalid video screenshot request")
		return
	}
	if req.Second < 0 {
		respondLocalizedError(c, http.StatusBadRequest, "截图时间不能为负数", "Screenshot time cannot be negative")
		return
	}
	if video.DurationSec > 0 && req.Second > float64(video.DurationSec)+1 {
		respondLocalizedError(c, http.StatusBadRequest, "截图时间超出视频时长", "Screenshot time exceeds the video duration")
		return
	}

	dataDir := filepath.Dir(common.AppConfig.DatabasePath)
	screenshotDir := filepath.Join(dataDir, "video", strconv.FormatInt(video.ID, 10), "screenshot")
	name := playbackScreenshotName(req.Second)
	screenshotPath := filepath.Join(screenshotDir, name)
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Minute)
	defer cancel()
	if err := common.ScreenshotManager.CaptureFile(ctx, fullPath, req.Second, screenshotPath); err != nil {
		logging.Error("create video screenshot error: %v", err)
		if strings.Contains(err.Error(), "ffmpeg not found") || strings.Contains(err.Error(), "mpv not found") {
			respondLocalizedError(c, http.StatusServiceUnavailable, "缺少截图所需的 FFmpeg 或 MPV 组件", "FFmpeg or MPV required for screenshots was not found")
			return
		}
		respondLocalizedError(c, http.StatusInternalServerError, "创建视频截图失败", "Failed to create video screenshot")
		return
	}

	info, err := os.Stat(screenshotPath)
	if err != nil {
		logging.Error("stat created video screenshot error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "读取新建的视频截图失败", "Failed to inspect the created video screenshot")
		return
	}
	imageURL := "/videos/" + strconv.FormatInt(video.ID, 10) + "/screenshots/" + url.PathEscape(name)
	imageURL += "?mtime=" + strconv.FormatInt(info.ModTime().UnixNano(), 10)
	c.JSON(http.StatusCreated, videoScreenshotInfo{
		VideoID:    video.ID,
		Name:       name,
		URL:        imageURL,
		Size:       info.Size(),
		ModifiedAt: info.ModTime(),
	})
}

func getVideoScreenshot(c *gin.Context) {
	_, screenshotDir, ok := resolveVideoScreenshotDir(c)
	if !ok {
		return
	}

	name := filepath.Base(strings.TrimSpace(c.Param("name")))
	if !isScreenshotImageName(name) || name != strings.TrimSpace(c.Param("name")) {
		respondLocalizedError(c, http.StatusBadRequest, "截图文件名无效", "Invalid screenshot filename")
		return
	}

	screenshotPath := filepath.Join(screenshotDir, name)
	if _, err := os.Stat(screenshotPath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			respondLocalizedError(c, http.StatusNotFound, "视频截图不存在", "Video screenshot does not exist")
			return
		}
		logging.Error("stat video screenshot error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "读取视频截图失败", "Failed to inspect video screenshot")
		return
	}

	c.File(screenshotPath)
}

func deleteVideoScreenshot(c *gin.Context) {
	id, screenshotDir, ok := resolveVideoScreenshotDir(c)
	if !ok {
		return
	}

	name := filepath.Base(strings.TrimSpace(c.Param("name")))
	if !isScreenshotImageName(name) || name != strings.TrimSpace(c.Param("name")) {
		respondLocalizedError(c, http.StatusBadRequest, "截图文件名无效", "Invalid screenshot filename")
		return
	}

	screenshotPath := filepath.Join(screenshotDir, name)
	if err := util.MoveFileToTrash(screenshotPath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			respondLocalizedError(c, http.StatusNotFound, "视频截图不存在", "Video screenshot does not exist")
			return
		}
		logging.Error("delete video screenshot error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "删除视频截图失败", "Failed to delete video screenshot")
		return
	}

	if err := dbpkg.ClearVideoCoverScreenshotNameIfMatch(c.Request.Context(), id, name); err != nil {
		logging.Error("clear deleted video cover screenshot error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "更新视频封面状态失败", "Failed to update video cover state")
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func resolveVideoScreenshotDir(c *gin.Context) (int64, string, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		respondLocalizedError(c, http.StatusBadRequest, "视频 ID 无效", "Invalid video ID")
		return 0, "", false
	}

	video, err := dbpkg.GetVideo(c.Request.Context(), id)
	if err != nil {
		logging.Error("get video for screenshots error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "加载视频截图信息失败", "Failed to load video screenshot information")
		return 0, "", false
	}
	if video == nil {
		respondLocalizedError(c, http.StatusNotFound, "视频不存在", "Video does not exist")
		return 0, "", false
	}
	if common.AppConfig == nil {
		respondLocalizedError(c, http.StatusInternalServerError, "应用配置尚未加载", "Application configuration is not loaded")
		return 0, "", false
	}

	dataDir := filepath.Dir(common.AppConfig.DatabasePath)
	return id, filepath.Join(dataDir, "video", strconv.FormatInt(id, 10), "screenshot"), true
}

func playbackScreenshotName(second float64) string {
	totalMillis := int64(second*1000 + 0.5)
	if totalMillis < 0 {
		totalMillis = 0
	}
	totalSeconds := totalMillis / 1000
	millis := totalMillis % 1000
	hours := totalSeconds / 3600
	minutes := (totalSeconds % 3600) / 60
	seconds := totalSeconds % 60
	if millis > 0 {
		return fmt.Sprintf("mpv_%02d-%02d-%02d.%03d.jpg", hours, minutes, seconds, millis)
	}
	return fmt.Sprintf("mpv_%02d-%02d-%02d.jpg", hours, minutes, seconds)
}

func isScreenshotImageName(name string) bool {
	if strings.TrimSpace(name) == "" || filepath.Base(name) != name {
		return false
	}
	if !strings.HasPrefix(name, "mpv_") {
		return false
	}
	switch strings.ToLower(filepath.Ext(name)) {
	case ".jpg", ".jpeg", ".png", ".webp":
		return true
	default:
		return false
	}
}

func customVideoCoverPath(dataDir string, video *models.Video) (string, bool) {
	if video == nil || video.ID <= 0 {
		return "", false
	}
	name := strings.TrimSpace(video.CoverScreenshotName)
	if !isScreenshotImageName(name) {
		return "", false
	}
	screenshotPath := filepath.Join(dataDir, "video", strconv.FormatInt(video.ID, 10), "screenshot", name)
	if _, err := os.Stat(screenshotPath); err != nil {
		return "", false
	}
	return screenshotPath, true
}
