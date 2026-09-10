package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"javboss/internal/db"
	"javboss/internal/models"
	"javboss/internal/runtimeconfig"
	"javboss/internal/service"
	"javboss/internal/util"

	"github.com/gin-gonic/gin"
)

type downloaderSettingsResponse struct {
	DownloadDirectory string `json:"download_directory"`
	LocalConcurrency  int    `json:"local_concurrency"`
	MinVideoSizeMB    int64  `json:"min_video_size_mb"`
	Address           string `json:"address"`
	RemoteFolder      string `json:"remote_folder"`
	TokenConfigured   bool   `json:"token_configured"`
}

func getDownloaderSettings(c *gin.Context) {
	payload, err := loadDownloaderSettingsPayload(c.Request.Context())
	if err != nil {
		respondLocalizedError(c, http.StatusInternalServerError, "读取下载器配置失败", "Failed to load downloader settings")
		return
	}
	c.JSON(http.StatusOK, payload)
}

func updateDownloaderSettings(c *gin.Context) {
	var request struct {
		DownloadDirectory string `json:"download_directory"`
		LocalConcurrency  int    `json:"local_concurrency"`
		MinVideoSizeMB    int64  `json:"min_video_size_mb"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "下载器配置格式不正确", "Invalid downloader settings")
		return
	}
	if request.LocalConcurrency < 1 || request.LocalConcurrency > models.MaxLocalDownloadConcurrency {
		respondLocalizedError(c, http.StatusBadRequest, "本地下载并发数必须在 1 到 3 之间", "Local download concurrency must be between 1 and 3")
		return
	}
	if request.MinVideoSizeMB < 1 || request.MinVideoSizeMB > 102400 {
		respondLocalizedError(c, http.StatusBadRequest, "视频最小下载体积必须在 1 MB 到 102400 MB 之间", "The minimum video download size must be between 1 MB and 102400 MB")
		return
	}
	downloadDirectory, err := normalizeDownloadDirectory(request.DownloadDirectory)
	if err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "下载目录必须是已存在的本地绝对路径", "The download directory must be an existing absolute local path")
		return
	}
	settings := models.DownloaderSettings{
		ID: 1, ActiveProvider: models.DownloaderProviderCloudDrive2,
		DownloadDirectory: downloadDirectory,
		LocalConcurrency:  request.LocalConcurrency,
		MinVideoSizeBytes: request.MinVideoSizeMB * 1024 * 1024,
	}
	if err := db.SaveDownloaderSettings(c.Request.Context(), &settings); err != nil {
		respondLocalizedError(c, http.StatusInternalServerError, "保存下载器配置失败", "Failed to save downloader settings")
		return
	}
	service.WakeDownloadManager()
	payload, err := loadDownloaderSettingsPayload(c.Request.Context())
	if err != nil {
		respondLocalizedError(c, http.StatusInternalServerError, "读取下载器配置失败", "Failed to load downloader settings")
		return
	}
	c.JSON(http.StatusOK, payload)
}

func updateCloudDrive2Settings(c *gin.Context) {
	var request struct {
		Address       string  `json:"address"`
		APIToken      *string `json:"api_token"`
		ClearAPIToken bool    `json:"clear_api_token"`
		RemoteFolder  string  `json:"remote_folder"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "下载器配置格式不正确", "Invalid provider settings")
		return
	}
	address := strings.TrimSpace(request.Address)
	remoteFolder := strings.TrimSpace(request.RemoteFolder)
	if len(address) > 500 || len(remoteFolder) > 2000 {
		respondLocalizedError(c, http.StatusBadRequest, "下载器地址或目录过长", "Downloader address or folder is too long")
		return
	}
	if request.APIToken != nil && len(*request.APIToken) > 16384 {
		respondLocalizedError(c, http.StatusBadRequest, "API Token 过长", "The API token is too long")
		return
	}
	current, err := db.GetDownloaderProviderSettings(c.Request.Context(), models.DownloaderProviderCloudDrive2)
	if err == nil {
		err = db.SaveDownloaderProviderSettings(c.Request.Context(), &models.DownloaderProviderSettings{
			Provider: models.DownloaderProviderCloudDrive2, Address: address,
			APIToken:     updatedProviderToken(current.APIToken, request.APIToken, request.ClearAPIToken),
			RemoteFolder: remoteFolder,
		})
	}
	if err != nil {
		respondLocalizedError(c, http.StatusInternalServerError, "保存下载器配置失败", "Failed to save provider settings")
		return
	}
	payload, err := loadDownloaderSettingsPayload(c.Request.Context())
	if err != nil {
		respondLocalizedError(c, http.StatusInternalServerError, "读取下载器配置失败", "Failed to load downloader settings")
		return
	}
	c.JSON(http.StatusOK, payload)
}

func getCloudDrive2Token(c *gin.Context) {
	settings, err := db.GetDownloaderProviderSettings(c.Request.Context(), models.DownloaderProviderCloudDrive2)
	if err != nil {
		respondLocalizedError(c, http.StatusInternalServerError, "读取 API Token 失败", "Failed to load the API token")
		return
	}
	c.JSON(http.StatusOK, gin.H{"api_token": settings.APIToken})
}

func testCloudDrive2(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()
	result, err := service.TestDownloader(ctx, models.DownloaderProviderCloudDrive2)
	if err != nil {
		respondLocalizedError(c, http.StatusBadGateway, "下载器连接测试失败："+err.Error(), "Downloader connection test failed: "+err.Error())
		return
	}
	c.JSON(http.StatusOK, result)
}

func loadDownloaderSettingsPayload(ctx context.Context) (*downloaderSettingsResponse, error) {
	settings, err := db.GetDownloaderSettings(ctx)
	if err != nil {
		return nil, err
	}
	cloudDrive2, err := db.GetDownloaderProviderSettings(ctx, models.DownloaderProviderCloudDrive2)
	if err != nil {
		return nil, err
	}
	return &downloaderSettingsResponse{
		DownloadDirectory: settings.DownloadDirectory, LocalConcurrency: settings.LocalConcurrency,
		MinVideoSizeMB: settings.MinVideoSizeBytes / (1024 * 1024),
		Address:        cloudDrive2.Address, RemoteFolder: cloudDrive2.RemoteFolder,
		TokenConfigured: strings.TrimSpace(cloudDrive2.APIToken) != "",
	}, nil
}

func updatedProviderToken(current string, requested *string, clear bool) string {
	if clear {
		return ""
	}
	if requested != nil && strings.TrimSpace(*requested) != "" {
		return strings.TrimSpace(*requested)
	}
	return current
}

// listDownloadJobs supports limit (default 20, max 500) and offset (default 0).
// Counts describe all tasks, independent of the requested page.
func listDownloadJobs(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	jobs, err := db.ListDownloadJobs(c.Request.Context(), queryInt(c, "limit", 20), queryInt(c, "offset", 0))
	if err != nil {
		respondLocalizedError(c, http.StatusInternalServerError, "读取下载队列失败", "Failed to load the download queue")
		return
	}
	c.JSON(http.StatusOK, jobs)
}

func createDownloadJob(c *gin.Context) {
	var request struct {
		MagnetURL string `json:"magnet_url"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "下载请求格式不正确", "Invalid download request")
		return
	}
	enqueueDownloadJob(c, request.MagnetURL)
}

func enqueueDownloadJob(c *gin.Context, magnetURL string) {
	magnetURL = strings.TrimSpace(magnetURL)
	infoHash, err := service.ParseMagnetInfoHash(magnetURL)
	if err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "磁力链接格式不正确", "Invalid magnet link")
		return
	}
	settings, err := db.GetDownloaderSettings(c.Request.Context())
	if err != nil {
		respondLocalizedError(c, http.StatusConflict, "尚未激活下载器", "No downloader is active")
		return
	}
	downloadDirectory, err := normalizeDownloadDirectory(settings.DownloadDirectory)
	if err != nil || downloadDirectory == "" {
		respondLocalizedError(c, http.StatusBadRequest, "请选择本地下载目录", "Select a local download directory")
		return
	}
	job := models.DownloadJob{
		DownloadDirectory: downloadDirectory, InfoHash: infoHash, MagnetURL: magnetURL,
		MagnetName: service.ParseMagnetName(magnetURL), Provider: models.DownloaderProviderCloudDrive2,
	}
	if err := db.CreateDownloadJob(c.Request.Context(), &job); err != nil {
		respondLocalizedError(c, http.StatusInternalServerError, "创建下载任务失败", "Failed to create the download job")
		return
	}
	service.WakeDownloadManager()
	c.JSON(http.StatusCreated, job)
}

func normalizeDownloadDirectory(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	value = filepath.Clean(value)
	if !filepath.IsAbs(value) {
		return "", errors.New("download directory is not absolute")
	}
	info, err := os.Stat(value)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", errors.New("download directory is not a directory")
	}
	return value, nil
}

func retryDownloadJob(c *gin.Context) {
	id, ok := downloadJobID(c)
	if !ok {
		return
	}
	job, err := db.GetDownloadJob(c.Request.Context(), id)
	if err != nil {
		respondLocalizedError(c, http.StatusNotFound, "下载任务不存在", "Download job not found")
		return
	}
	if job.Provider != models.DownloaderProviderCloudDrive2 {
		respondLocalizedError(c, http.StatusConflict, "该下载任务的下载器不受支持", "The download provider for this job is unsupported")
		return
	}
	if err := db.RetryDownloadJob(c.Request.Context(), id); err != nil {
		respondLocalizedError(c, http.StatusConflict, "该任务当前不能重试", "The job cannot be retried in its current state")
		return
	}
	service.WakeDownloadManager()
	c.Status(http.StatusNoContent)
}

func cancelDownloadJob(c *gin.Context) {
	id, ok := downloadJobID(c)
	if !ok {
		return
	}
	if err := db.CancelDownloadJob(c.Request.Context(), id); err != nil {
		respondLocalizedError(c, http.StatusConflict, "该任务当前不能取消", "The job cannot be canceled in its current state")
		return
	}
	service.CancelDownloadJob(id)
	c.Status(http.StatusNoContent)
}

func revealDownloadLocation(c *gin.Context) {
	if isRemoteRequest(c.Request.RemoteAddr) {
		respondLocalizedError(c, http.StatusForbidden, "通过局域网访问时无法打开下载位置", "Cannot reveal download locations when accessing over the local network")
		return
	}
	if runtimeconfig.DisableDesktopIntegration() {
		respondLocalizedError(c, http.StatusNotImplemented, "当前部署模式已禁用打开下载位置", "Desktop folder revealing is disabled")
		return
	}
	id, ok := downloadJobID(c)
	if !ok {
		return
	}
	job, err := db.GetDownloadJob(c.Request.Context(), id)
	if err != nil {
		respondLocalizedError(c, http.StatusNotFound, "下载任务不存在", "Download job not found")
		return
	}
	target := downloadRevealTarget(job)
	info, err := os.Stat(target)
	if err != nil {
		respondLocalizedError(c, http.StatusNotFound, "下载位置不存在", "Download location does not exist")
		return
	}
	if info.IsDir() {
		err = util.OpenFile(target)
	} else {
		err = util.RevealFile(target)
	}
	if err != nil {
		respondLocalizedError(c, http.StatusInternalServerError, "打开下载位置失败", "Failed to reveal download location")
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func downloadRevealTarget(job *models.DownloadJob) string {
	if job == nil {
		return ""
	}
	root := filepath.Clean(strings.TrimSpace(job.DownloadDirectory))
	var files []string
	_ = json.Unmarshal([]byte(job.LocalFilesJSON), &files)
	for _, candidate := range files {
		candidate = filepath.Clean(strings.TrimSpace(candidate))
		relative, err := filepath.Rel(root, candidate)
		if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			continue
		}
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	return root
}

func deleteDownloadJob(c *gin.Context) {
	id, ok := downloadJobID(c)
	if !ok {
		return
	}
	if err := db.DeleteDownloadJob(c.Request.Context(), id); err != nil {
		respondLocalizedError(c, http.StatusConflict, "只能删除已结束的下载任务", "Only finished download jobs can be deleted")
		return
	}
	c.Status(http.StatusNoContent)
}

func downloadJobID(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		respondLocalizedError(c, http.StatusBadRequest, "下载任务 ID 不正确", "Invalid download job ID")
		return 0, false
	}
	return id, true
}
