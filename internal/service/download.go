package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"javboss/internal/common/logging"
	"javboss/internal/db"
	"javboss/internal/downloader"
	downloaderclouddrive2 "javboss/internal/downloader/clouddrive2"
	"javboss/internal/models"
	"javboss/internal/util"
)

const (
	downloadPollInterval   = 10 * time.Second
	downloaderAPITimeout   = 30 * time.Second
	offlineDownloadMaxWait = 7 * 24 * time.Hour
	downloadDispatchEvery  = 3 * time.Second
	downloadMaxActiveJobs  = 20
)

var (
	downloadNameUnsafe    = regexp.MustCompile(`[<>:"/\\|?*\x00-\x1f]+`)
	downloadManagerMu     sync.RWMutex
	activeDownloadManager *downloadManager
	downloadHTTPClient    = newDownloadHTTPClient()
)

type downloadManager struct {
	ctx          context.Context
	wake         chan struct{}
	mu           sync.Mutex
	cancels      map[int64]context.CancelFunc
	localLimiter *localDownloadLimiter
}

func StartDownloadManager(ctx context.Context) {
	manager := &downloadManager{
		ctx: ctx, wake: make(chan struct{}, 1), cancels: make(map[int64]context.CancelFunc),
		localLimiter: newLocalDownloadLimiter(2),
	}
	downloadManagerMu.Lock()
	activeDownloadManager = manager
	downloadManagerMu.Unlock()
	if err := db.ResetInterruptedDownloadJobs(ctx); err != nil && !errors.Is(err, context.Canceled) {
		logging.Error("reset interrupted downloads failed: %v", err)
	}
	go manager.run()
	manager.signal()
}

func WakeDownloadManager() {
	downloadManagerMu.RLock()
	manager := activeDownloadManager
	downloadManagerMu.RUnlock()
	if manager != nil {
		manager.signal()
	}
}

func CancelDownloadJob(id int64) {
	downloadManagerMu.RLock()
	manager := activeDownloadManager
	downloadManagerMu.RUnlock()
	if manager == nil {
		return
	}
	manager.mu.Lock()
	cancel := manager.cancels[id]
	manager.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (m *downloadManager) signal() {
	select {
	case m.wake <- struct{}{}:
	default:
	}
}

func (m *downloadManager) run() {
	ticker := time.NewTicker(downloadDispatchEvery)
	defer ticker.Stop()
	for {
		m.dispatch()
		select {
		case <-m.ctx.Done():
			return
		case <-m.wake:
		case <-ticker.C:
		}
	}
}

func (m *downloadManager) dispatch() {
	settings, err := db.GetDownloaderSettings(m.ctx)
	if err != nil {
		if !errors.Is(err, context.Canceled) {
			logging.Error("load download settings failed: %v", err)
		}
		return
	}
	m.localLimiter.setLimit(settings.LocalConcurrency)
	if settings.ActiveProvider == "" {
		return
	}
	for {
		m.mu.Lock()
		active := len(m.cancels)
		m.mu.Unlock()
		if active >= downloadMaxActiveJobs {
			return
		}
		job, err := db.ClaimNextQueuedDownloadJob(m.ctx, settings.ActiveProvider)
		if err != nil {
			if !errors.Is(err, context.Canceled) {
				logging.Error("claim download queue job failed: %v", err)
			}
			return
		}
		if job == nil {
			return
		}
		jobCtx, cancel := context.WithCancel(m.ctx)
		m.mu.Lock()
		m.cancels[job.ID] = cancel
		m.mu.Unlock()
		current, loadErr := db.GetDownloadJob(m.ctx, job.ID)
		if loadErr != nil || current.Status != models.DownloadOfflineDownloading {
			cancel()
			m.mu.Lock()
			delete(m.cancels, job.ID)
			m.mu.Unlock()
			if loadErr != nil && !errors.Is(loadErr, context.Canceled) {
				logging.Error("verify claimed download job failed id=%d: %v", job.ID, loadErr)
			}
			continue
		}
		go m.process(jobCtx, cancel, job)
	}
}

func (m *downloadManager) process(ctx context.Context, cancel context.CancelFunc, job *models.DownloadJob) {
	err := processDownloadJob(ctx, job, m.localLimiter)
	cancel()
	m.mu.Lock()
	delete(m.cancels, job.ID)
	m.mu.Unlock()
	if err != nil && m.ctx.Err() == nil {
		current, loadErr := db.GetDownloadJob(context.Background(), job.ID)
		if loadErr == nil && current.Status != models.DownloadCanceled {
			message := strings.TrimSpace(err.Error())
			if len(message) > 1000 {
				message = message[:1000]
			}
			_ = db.UpdateDownloadJob(context.Background(), job.ID, map[string]any{
				"status": models.DownloadFailed, "error_message": message,
			})
		}
		if !errors.Is(err, context.Canceled) {
			logging.Error("download job failed id=%d: %v", job.ID, err)
		}
	}
	m.signal()
}

type localDownloadLimiter struct {
	mu      sync.Mutex
	limit   int
	active  int
	changed chan struct{}
}

func newLocalDownloadLimiter(limit int) *localDownloadLimiter {
	return &localDownloadLimiter{limit: normalizedLocalConcurrency(limit), changed: make(chan struct{})}
}

func normalizedLocalConcurrency(limit int) int {
	if limit < 1 || limit > models.MaxLocalDownloadConcurrency {
		return 2
	}
	return limit
}

func (l *localDownloadLimiter) setLimit(limit int) {
	limit = normalizedLocalConcurrency(limit)
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.limit == limit {
		return
	}
	l.limit = limit
	l.notifyLocked()
}

func (l *localDownloadLimiter) acquire(ctx context.Context) error {
	for {
		l.mu.Lock()
		if l.active < l.limit {
			l.active++
			l.mu.Unlock()
			return nil
		}
		changed := l.changed
		l.mu.Unlock()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-changed:
		}
	}
}

func (l *localDownloadLimiter) release() {
	l.mu.Lock()
	if l.active > 0 {
		l.active--
	}
	l.notifyLocked()
	l.mu.Unlock()
}

func (l *localDownloadLimiter) notifyLocked() {
	close(l.changed)
	l.changed = make(chan struct{})
}

func processDownloadJob(ctx context.Context, job *models.DownloadJob, localLimiter *localDownloadLimiter) error {
	localRoot := strings.TrimSpace(job.DownloadDirectory)
	if localRoot == "" {
		return errors.New("local download directory is unavailable")
	}
	client, baseFolder, err := openDownloaderClient(ctx, job.Provider)
	if err != nil {
		return err
	}
	defer client.Close()
	remoteTaskID := strings.TrimSpace(job.RemoteTaskID)
	remoteFinished := false
	defer func() {
		if remoteTaskID == "" || remoteFinished {
			return
		}
		current, loadErr := db.GetDownloadJob(context.Background(), job.ID)
		if loadErr != nil || current.Status != models.DownloadCanceled {
			return
		}
		cancelCtx, cancelRemote := context.WithTimeout(context.Background(), downloaderAPITimeout)
		defer cancelRemote()
		if cancelErr := client.CancelOffline(cancelCtx, remoteTaskID); cancelErr != nil {
			logging.Error("cancel remote download failed id=%d: %v", job.ID, cancelErr)
		}
	}()

	remoteFolder := strings.TrimSpace(job.RemoteFolder)
	if remoteFolder == "" {
		name := downloadJobFolderName(job.MagnetName, job.InfoHash)
		rpcCtx, cancel := context.WithTimeout(ctx, downloaderAPITimeout)
		remoteFolder, err = client.EnsureFolder(rpcCtx, baseFolder, name)
		cancel()
		if err != nil {
			return fmt.Errorf("create remote download job folder: %w", err)
		}
		if err := db.UpdateDownloadJob(ctx, job.ID, map[string]any{"remote_folder": remoteFolder}); err != nil {
			return err
		}
	}

	if err := db.UpdateDownloadJob(ctx, job.ID, map[string]any{
		"status": models.DownloadOfflineDownloading, "error_message": "",
	}); err != nil {
		return err
	}
	status, err := downloaderOfflineStatus(ctx, client, job.RemoteTaskID, remoteFolder, job.InfoHash)
	if err != nil {
		return err
	}
	finished := status.State == downloader.OfflineComplete
	if status.State == downloader.OfflineFailed || status.State == downloader.OfflineCanceled {
		message := strings.TrimSpace(status.Message)
		if message == "" {
			message = "remote offline download failed"
		}
		return errors.New(message)
	}
	if status.State == downloader.OfflineNotFound || status.State == downloader.OfflineUntracked {
		rpcCtx, cancel := context.WithTimeout(ctx, downloaderAPITimeout)
		existingFiles, listErr := client.WalkFiles(rpcCtx, remoteFolder)
		cancel()
		if listErr == nil && len(existingFiles) > 0 {
			finished = true
		}
	}
	if status.State == downloader.OfflineNotFound && !finished {
		rpcCtx, cancel := context.WithTimeout(ctx, downloaderAPITimeout)
		remoteTaskID, err = client.StartOffline(rpcCtx, job.MagnetURL, remoteFolder, job.InfoHash)
		cancel()
		if err != nil {
			return fmt.Errorf("submit remote offline download: %w", err)
		}
		if err := db.UpdateDownloadJob(ctx, job.ID, map[string]any{"remote_task_id": remoteTaskID}); err != nil {
			return err
		}
	}
	if !finished {
		if err := waitForOfflineDownload(ctx, client, remoteTaskID, remoteFolder, job.InfoHash); err != nil {
			return err
		}
	}
	remoteFinished = true

	if err := db.UpdateDownloadJob(ctx, job.ID, map[string]any{
		"status": models.DownloadResolvingFiles,
	}); err != nil {
		return err
	}
	remoteFiles, err := waitForRemoteFiles(ctx, client, remoteFolder)
	if err != nil {
		return err
	}
	if len(remoteFiles) == 0 {
		return errors.New("the offline download contains no files")
	}
	downloadSettings, err := db.GetDownloaderSettings(ctx)
	if err != nil {
		return err
	}
	remoteFiles = filterSmallRemoteVideos(remoteFiles, downloadSettings.MinVideoSizeBytes)
	if len(remoteFiles) == 0 {
		return db.CompleteDownloadJob(ctx, job.ID, nil, 0)
	}
	var total int64
	for _, file := range remoteFiles {
		if file.Size > 0 {
			total += file.Size
		}
	}
	if err := db.UpdateDownloadJob(ctx, job.ID, map[string]any{
		"status": models.DownloadWaitingLocal, "bytes_total": total,
		"bytes_downloaded": 0,
	}); err != nil {
		return err
	}
	if err := localLimiter.acquire(ctx); err != nil {
		return err
	}
	defer localLimiter.release()
	if err := db.UpdateDownloadJob(ctx, job.ID, map[string]any{
		"status": models.DownloadLocalDownloading, "bytes_total": total,
		"bytes_downloaded": 0,
	}); err != nil {
		return err
	}

	if err := os.MkdirAll(localRoot, 0o755); err != nil {
		return fmt.Errorf("create local download directory: %w", err)
	}
	var completedBytes int64
	localFiles := make([]string, 0, len(remoteFiles))
	for _, remoteFile := range remoteFiles {
		remotePath := strings.TrimSpace(remoteFile.Path)
		relative := remoteRelativePath(remoteFolder, remotePath, remoteFile.Name)
		if remotePath == "" {
			remotePath = path.Join(remoteFolder, relative)
		}
		target, err := safeLocalDownloadPath(localRoot, relative)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return fmt.Errorf("create local download subdirectory: %w", err)
		}
		fileBase := completedBytes
		err = downloadRemoteFile(ctx, client, remoteFile, remotePath, target, func(fileDownloaded int64) error {
			downloaded := fileBase + fileDownloaded
			return db.UpdateDownloadJob(ctx, job.ID, map[string]any{
				"bytes_downloaded": downloaded,
			})
		})
		if err != nil {
			return err
		}
		completedBytes += max64(remoteFile.Size, 0)
		localFiles = append(localFiles, target)
	}
	if err := db.CompleteDownloadJob(ctx, job.ID, localFiles, total); err != nil {
		return err
	}
	return nil
}

func openDownloaderClient(ctx context.Context, provider string) (downloader.Client, string, error) {
	settings, err := db.GetDownloaderProviderSettings(ctx, provider)
	if err != nil {
		return nil, "", err
	}
	if settings.Address == "" || settings.APIToken == "" || settings.RemoteFolder == "" {
		return nil, "", errors.New("CloudDrive2 is not fully configured")
	}
	switch provider {
	case models.DownloaderProviderCloudDrive2:
		client, err := downloaderclouddrive2.New(settings.Address, settings.APIToken)
		return client, settings.RemoteFolder, err
	default:
		return nil, "", fmt.Errorf("unsupported download provider %q", provider)
	}
}

func TestDownloader(ctx context.Context, provider string) (*downloader.TestResult, error) {
	client, folder, err := openDownloaderClient(ctx, provider)
	if err != nil {
		return nil, err
	}
	defer client.Close()
	return client.Test(ctx, folder)
}

func downloaderOfflineStatus(
	ctx context.Context,
	client downloader.Client,
	taskID string,
	folder string,
	infoHash string,
) (*downloader.OfflineStatus, error) {
	rpcCtx, cancel := context.WithTimeout(ctx, downloaderAPITimeout)
	status, err := client.OfflineStatus(rpcCtx, taskID, folder, infoHash)
	cancel()
	return status, err
}

func waitForOfflineDownload(ctx context.Context, client downloader.Client, taskID, folder, infoHash string) error {
	deadline := time.Now().Add(offlineDownloadMaxWait)
	ticker := time.NewTicker(downloadPollInterval)
	defer ticker.Stop()
	for {
		if time.Now().After(deadline) {
			return errors.New("remote offline download timed out")
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			status, err := downloaderOfflineStatus(ctx, client, taskID, folder, infoHash)
			if err != nil {
				return err
			}
			switch status.State {
			case downloader.OfflineComplete:
				return nil
			case downloader.OfflineFailed, downloader.OfflineCanceled:
				message := strings.TrimSpace(status.Message)
				if message == "" {
					message = "remote offline download failed"
				}
				return errors.New(message)
			case downloader.OfflineNotFound, downloader.OfflineUntracked:
				filesCtx, filesCancel := context.WithTimeout(ctx, downloaderAPITimeout)
				files, listErr := client.WalkFiles(filesCtx, folder)
				filesCancel()
				if listErr == nil && len(files) > 0 {
					return nil
				}
			}
		}
	}
}

func waitForRemoteFiles(ctx context.Context, client downloader.Client, folder string) ([]downloader.RemoteFile, error) {
	deadline := time.Now().Add(2 * time.Minute)
	for {
		rpcCtx, cancel := context.WithTimeout(ctx, downloaderAPITimeout)
		files, err := client.WalkFiles(rpcCtx, folder)
		cancel()
		if err == nil && len(files) > 0 {
			return files, nil
		}
		if time.Now().After(deadline) {
			if err != nil {
				return nil, fmt.Errorf("list remote offline files: %w", err)
			}
			return nil, errors.New("remote offline files did not appear")
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(5 * time.Second):
		}
	}
}

func filterSmallRemoteVideos(files []downloader.RemoteFile, minSizeBytes int64) []downloader.RemoteFile {
	if minSizeBytes <= 0 {
		return files
	}
	result := make([]downloader.RemoteFile, 0, len(files))
	for _, file := range files {
		isVideo := util.IsVideoCandidate(strings.TrimSpace(file.Name))
		if !isVideo || file.Size <= 0 || file.Size >= minSizeBytes {
			result = append(result, file)
		}
	}
	return result
}

func downloadRemoteFile(
	ctx context.Context,
	client downloader.Client,
	remote downloader.RemoteFile,
	remotePath string,
	target string,
	onBytesWritten func(int64) error,
) error {
	if existing, err := os.Stat(target); err == nil && existing.Mode().IsRegular() && existing.Size() == remote.Size {
		return onBytesWritten(existing.Size())
	}
	part := target + ".part"
	for attempt := 0; attempt < 4; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		rpcCtx, cancel := context.WithTimeout(ctx, downloaderAPITimeout)
		source, err := client.DownloadSource(rpcCtx, remotePath)
		cancel()
		if err != nil {
			return fmt.Errorf("resolve remote download URL for %s: %w", remote.Name, err)
		}
		file, err := os.OpenFile(part, os.O_CREATE|os.O_RDWR, 0o644)
		if err != nil {
			return fmt.Errorf("open partial download: %w", err)
		}
		info, statErr := file.Stat()
		if statErr != nil {
			file.Close()
			return statErr
		}
		offset := info.Size()
		if remote.Size > 0 && offset > remote.Size {
			if err := file.Truncate(0); err != nil {
				file.Close()
				return err
			}
			offset = 0
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, source.URL, nil)
		if err != nil {
			file.Close()
			return err
		}
		req.Header = source.Headers.Clone()
		if offset > 0 {
			req.Header.Set("Range", fmt.Sprintf("bytes=%d-", offset))
		}
		response, err := downloadHTTPClient.Do(req)
		if err != nil {
			file.Close()
			if attempt < 3 {
				continue
			}
			return fmt.Errorf("download %s: %w", remote.Name, err)
		}
		if response.StatusCode == http.StatusRequestedRangeNotSatisfiable && remote.Size > 0 && offset == remote.Size {
			response.Body.Close()
			file.Close()
			return finalizeDownloadedFile(part, target, remote.Size, onBytesWritten)
		}
		if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusPartialContent {
			response.Body.Close()
			file.Close()
			if (response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden) && attempt < 3 {
				continue
			}
			return fmt.Errorf("download %s returned HTTP %d", remote.Name, response.StatusCode)
		}
		if offset > 0 && response.StatusCode == http.StatusOK {
			if err := file.Truncate(0); err != nil {
				response.Body.Close()
				file.Close()
				return err
			}
			offset = 0
		}
		if _, err := file.Seek(offset, io.SeekStart); err != nil {
			response.Body.Close()
			file.Close()
			return err
		}
		copyErr := copyDownloadResponse(ctx, file, response.Body, offset, onBytesWritten)
		response.Body.Close()
		syncErr := file.Sync()
		closeErr := file.Close()
		if copyErr != nil {
			if attempt < 3 && !errors.Is(copyErr, context.Canceled) {
				continue
			}
			return copyErr
		}
		if syncErr != nil {
			return syncErr
		}
		if closeErr != nil {
			return closeErr
		}
		return finalizeDownloadedFile(part, target, remote.Size, onBytesWritten)
	}
	return errors.New("download attempts exhausted")
}

func copyDownloadResponse(ctx context.Context, target *os.File, source io.Reader, offset int64, onBytesWritten func(int64) error) error {
	buffer := make([]byte, 1024*1024)
	written := offset
	lastUpdate := time.Time{}
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		n, readErr := source.Read(buffer)
		if n > 0 {
			if _, err := target.Write(buffer[:n]); err != nil {
				return err
			}
			written += int64(n)
			if time.Since(lastUpdate) >= time.Second {
				if err := onBytesWritten(written); err != nil {
					return err
				}
				lastUpdate = time.Now()
			}
		}
		if errors.Is(readErr, io.EOF) {
			return onBytesWritten(written)
		}
		if readErr != nil {
			return readErr
		}
	}
}

func finalizeDownloadedFile(part, target string, expected int64, onBytesWritten func(int64) error) error {
	info, err := os.Stat(part)
	if err != nil {
		return err
	}
	if expected > 0 && info.Size() != expected {
		return fmt.Errorf("downloaded size mismatch for %s: got %d, want %d", filepath.Base(target), info.Size(), expected)
	}
	if err := os.Rename(part, target); err != nil {
		return fmt.Errorf("finish local download: %w", err)
	}
	return onBytesWritten(info.Size())
}

func newDownloadHTTPClient() *http.Client {
	client := util.NewHTTPClientWithTransport(0, func(transport *http.Transport) {
		transport.MaxIdleConns = 20
		transport.MaxIdleConnsPerHost = 4
		transport.DisableCompression = true
	})
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("too many download redirects")
		}
		if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
			return errors.New("unsupported download redirect")
		}
		return nil
	}
	return client
}

func ParseMagnetInfoHash(raw string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || !strings.EqualFold(parsed.Scheme, "magnet") {
		return "", errors.New("invalid magnet URL")
	}
	for _, xt := range parsed.Query()["xt"] {
		if !strings.HasPrefix(strings.ToLower(xt), "urn:btih:") {
			continue
		}
		hash := normalizeInfoHash(strings.TrimSpace(xt[len("urn:btih:"):]))
		if len(hash) == 32 || len(hash) == 40 {
			for _, char := range hash {
				if !((char >= 'a' && char <= 'z') || (char >= '0' && char <= '9')) {
					return "", errors.New("invalid magnet info hash")
				}
			}
			return hash, nil
		}
	}
	return "", errors.New("magnet URL has no BTIH hash")
}

func ParseMagnetName(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || !strings.EqualFold(parsed.Scheme, "magnet") {
		return ""
	}
	return strings.TrimSpace(parsed.Query().Get("dn"))
}

func normalizeInfoHash(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func downloadJobFolderName(name, infoHash string) string {
	prefix := normalizeInfoHash(infoHash)
	if len(prefix) > 8 {
		prefix = prefix[:8]
	}
	return safeLocalName(name) + "-" + prefix
}

func safeLocalName(value string) string {
	value = downloadNameUnsafe.ReplaceAllString(strings.TrimSpace(value), "-")
	value = strings.Trim(value, ".-_")
	if value == "" {
		return "download"
	}
	return value
}

func remoteRelativePath(root, fullPath, fallback string) string {
	root = strings.TrimSuffix(path.Clean(root), "/")
	fullPath = path.Clean(fullPath)
	relative := strings.TrimPrefix(fullPath, root+"/")
	if relative == fullPath || relative == "." || relative == "" {
		relative = fallback
	}
	return relative
}

func safeLocalDownloadPath(root, relative string) (string, error) {
	parts := strings.FieldsFunc(strings.ReplaceAll(relative, "\\", "/"), func(char rune) bool { return char == '/' })
	cleanParts := make([]string, 0, len(parts))
	for _, part := range parts {
		if part == "." || part == ".." {
			continue
		}
		part = safeLocalName(part)
		if part != "" && part != "." && part != ".." {
			cleanParts = append(cleanParts, part)
		}
	}
	if len(cleanParts) == 0 {
		return "", errors.New("remote video has an invalid filename")
	}
	target := filepath.Join(append([]string{root}, cleanParts...)...)
	rel, err := filepath.Rel(root, target)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", errors.New("local download path escaped the target directory")
	}
	return target, nil
}

func max64(value, fallback int64) int64 {
	if value > fallback {
		return value
	}
	return fallback
}
