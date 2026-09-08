package service

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"javboss/internal/common"
	"javboss/internal/common/logging"
	"javboss/internal/db"
	"javboss/internal/models"
	"javboss/internal/util"
)

// FileEntry 表示扫描过程中发现的一个视频文件及其可持久化元数据。
type FileEntry struct {
	DirectoryID   int64
	DirectoryPath string
	RelativePath  string
	AbsolutePath  string
	Filename      string
	Size          int64
	ModifiedAt    time.Time
	Fingerprint   string
	PathKey       string
	DurationSec   int64
	StrmDigest    string
}

var probeVideoContext = util.ProbeVideoContext

// Summary 汇总一次目录扫描产生的文件与目录变更数量。
type Summary struct {
	FilesSeen   int
	Inserted    int
	Updated     int
	Removed     int
	Duration    time.Duration
	Directories int
}

// makePathKey 生成目录内相对路径的唯一索引键。
func makePathKey(directoryID int64, relativePath string) string {
	return strconv.FormatInt(directoryID, 10) + ":" + relativePath
}

type syncState struct {
	existingByID           map[int64]*models.Video
	existingLocationByPath map[string]*models.VideoLocation
	processedLocationIDs   map[int64]struct{}
	javLinks               *javLinkBatch
}

// loadDirectorySyncState 加载单个目录已有的视频与文件位置，供本次扫描增量对账使用。
func loadDirectorySyncState(ctx context.Context, directoryID int64, javLinks *javLinkBatch) (*syncState, error) {
	existingLocations, err := db.VideoLocationsByDirectory(ctx, directoryID)
	if err != nil {
		return nil, err
	}
	existingByID := make(map[int64]*models.Video, len(existingLocations))
	existingLocationByPath := make(map[string]*models.VideoLocation, len(existingLocations))
	processedLocationIDs := make(map[int64]struct{}, len(existingLocations))
	for i := range existingLocations {
		loc := &existingLocations[i]
		existingLocationByPath[makePathKey(loc.DirectoryID, loc.RelativePath)] = loc
		if loc.Video.ID == 0 {
			continue
		}
		video := &loc.Video
		existingByID[video.ID] = video
	}

	return &syncState{
		existingByID:           existingByID,
		existingLocationByPath: existingLocationByPath,
		processedLocationIDs:   processedLocationIDs,
		javLinks:               javLinks,
	}, nil
}

// ScanDirectory 同步扫描一个目录并与数据库对账，同时等待本次 JAV 关联队列处理完成。
func ScanDirectory(ctx context.Context, directory models.Directory) (*Summary, error) {
	if common.DB == nil {
		return nil, errors.New("nil database")
	}
	if directory.ID == 0 || directory.IsDelete {
		return &Summary{}, nil
	}
	scanCtx, finish, err := acquireDirectoryScanSession(ctx, directory.ID)
	if err != nil {
		return nil, err
	}
	defer finish()

	javLinks := newJavLinkBatch(scanCtx)
	summary, err := runDirectoryScanWithSession(scanCtx, directory, javLinks)
	return summary, err
}

// runDirectoryScanWithSession 在已取得目录扫描会话的前提下执行文件对账、等待 JAV 关联，最后保存扫描摘要。
func runDirectoryScanWithSession(scanCtx context.Context, directory models.Directory, javLinks *javLinkBatch) (*Summary, error) {
	start := time.Now()
	summary := &Summary{}
	javLinksFinished := false
	defer func() {
		if !javLinksFinished {
			finishJavLinkBatch(javLinks)
		}
	}()
	logging.Info("sync directory start: id=%d path=%s", directory.ID, directory.Path)

	state, err := loadDirectorySyncState(scanCtx, directory.ID, javLinks)
	if err != nil {
		return nil, err
	}
	scanned, err := reconcileDirectoryContents(scanCtx, directory, state, summary)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			logging.Info("sync directory canceled: id=%d path=%s", directory.ID, directory.Path)
		} else {
			logging.Error("sync directory failed: id=%d path=%s err=%v", directory.ID, directory.Path, err)
		}
		return nil, err
	}
	if scanned {
		if err := hideUnprocessedVideoLocations(scanCtx, state.processedLocationIDs, summary, directory.ID); err != nil {
			return nil, err
		}
		summary.Directories = 1
	}

	// JAV 关联属于本次目录扫描的一部分。必须等待该目录自己的批次完成后，
	// 才记录完成时间并允许外层释放扫描会话。
	finishJavLinkBatch(javLinks)
	javLinksFinished = true
	summary.Duration = time.Since(start)
	if scanned {
		lastScanSummary := models.DirectoryScanSummary{
			FilesSeen:        summary.FilesSeen,
			Inserted:         summary.Inserted,
			Updated:          summary.Updated,
			Removed:          summary.Removed,
			DurationMS:       summary.Duration.Milliseconds(),
			FinishedAtUnixMS: time.Now().UnixMilli(),
		}
		if err := db.UpdateDirectoryLastScanSummary(scanCtx, directory.ID, lastScanSummary); err != nil {
			return nil, err
		}
	}
	logging.Info(
		"sync directory summary: id=%d path=%s scanned=%t files_seen=%d inserted=%d updated=%d removed=%d duration=%s",
		directory.ID,
		directory.Path,
		scanned,
		summary.FilesSeen,
		summary.Inserted,
		summary.Updated,
		summary.Removed,
		summary.Duration,
	)
	return summary, nil
}

// StartManualDirectoryScan 先占用目录扫描会话，再异步执行一次手动扫描。
// 在返回前完成会话占用，可确保并发手动请求得到确定的冲突响应。
func StartManualDirectoryScan(directory models.Directory) error {
	if common.DB == nil {
		return errors.New("nil database")
	}
	if directory.ID <= 0 || directory.IsDelete {
		return errors.New("invalid directory")
	}

	scanCtx, finish, err := acquireDirectoryScanSession(context.Background(), directory.ID)
	if err != nil {
		return err
	}
	go func() {
		defer finish()
		javLinks := newJavLinkBatch(scanCtx)
		_, scanErr := runDirectoryScanWithSession(scanCtx, directory, javLinks)
		// 封面补漏是扫描完成后的目录级维护任务，不应继续占用扫描会话。
		finish()
		if scanErr != nil && !errors.Is(scanErr, context.Canceled) {
			logging.Error("manual directory scan failed: id=%d path=%s err=%v", directory.ID, directory.Path, scanErr)
			return
		}
		if scanErr == nil {
			if err := enqueueMissingCoversForDirectory(context.Background(), directory.ID); err != nil {
				logging.Error("jav cover enqueue after manual scan failed: id=%d err=%v", directory.ID, err)
			}
		}
	}()
	return nil
}

// reconcileDirectoryContents 校验目录可用性，并将磁盘内容与数据库文件位置进行对账。
func reconcileDirectoryContents(ctx context.Context, dir models.Directory, state *syncState, summary *Summary) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}

	info, statErr := os.Stat(dir.Path)
	if statErr != nil {
		if util.IsPathUnavailable(statErr) {
			if err := db.SetDirectoryMissing(ctx, dir.ID, true); err != nil {
				logging.Error("mark directory missing failed id=%d path=%s err=%v", dir.ID, dir.Path, err)
			}
			return false, nil
		}
		return false, fmt.Errorf("stat directory %s: %w", dir.Path, statErr)
	}
	if !info.IsDir() {
		if err := db.SetDirectoryMissing(ctx, dir.ID, true); err != nil {
			logging.Error("mark directory missing failed id=%d path=%s err=%v", dir.ID, dir.Path, err)
		}
		return false, nil
	}
	if dir.Missing {
		if err := db.SetDirectoryMissing(ctx, dir.ID, false); err != nil {
			logging.Error("clear directory missing failed id=%d path=%s err=%v", dir.ID, dir.Path, err)
		}
	}

	if err := walkAndReconcileVideoFiles(ctx, dir, state, summary); err != nil {
		return false, err
	}
	return true, nil
}

// walkAndReconcileVideoFiles 遍历单个目录，实时写入视频位置并记录统计、缩略图和 JAV 关联任务。
func walkAndReconcileVideoFiles(ctx context.Context, directory models.Directory, state *syncState, summary *Summary) error {
	// 边遍历文件边做指纹计算和 DB 更新，避免一次性构建全量快照
	normalizedRoot := filepath.Clean(directory.Path)
	return filepath.WalkDir(normalizedRoot, func(candidatePath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			logging.Error("walk directory entry failed, skip: root=%s path=%s err=%v", normalizedRoot, candidatePath, walkErr)
			return nil
		}

		if err := ctx.Err(); err != nil {
			return err
		}

		if entry.IsDir() {
			return nil
		}
		isSTRM := util.IsSTRMPath(candidatePath)
		if !isSTRM && !util.IsVideoCandidate(candidatePath) {
			return nil
		}

		info, err := entry.Info()
		if err != nil {
			if errors.Is(err, fs.ErrPermission) {
				return nil
			}
			return err
		}

		// 计算相对路径，确保只处理目录内的文件（防止符号链接等越界）
		normalizedPath := filepath.Clean(candidatePath)
		relativePath, err := filepath.Rel(normalizedRoot, normalizedPath)
		if err != nil {
			return err
		}
		if strings.HasPrefix(relativePath, "..") {
			return nil
		}

		relativePath = filepath.ToSlash(cleanRelativePath(relativePath))
		modTime := info.ModTime().UTC()
		summary.FilesSeen++
		pathKey := makePathKey(directory.ID, relativePath)
		existingLoc := state.existingLocationByPath[pathKey]
		existingVideo := (*models.Video)(nil)
		if existingLoc != nil {
			existingVideo = state.existingByID[existingLoc.VideoID]
		}

		if isSTRM {
			return reconcileSTRMLocation(
				ctx,
				directory,
				normalizedPath,
				relativePath,
				info,
				modTime,
				existingLoc,
				existingVideo,
				state,
				summary,
			)
		}

		// If file unchanged (size + mtime), skip probe and DB touches but mark as seen.
		if existingLoc != nil {
			if existingVideo != nil && existingVideo.Size == info.Size() && existingLoc.ModifiedAt.Equal(modTime) {
				state.processedLocationIDs[existingLoc.ID] = struct{}{}
				if existingLoc.IsDelete {
					saved, err := db.UpsertVideoLocation(ctx, existingLoc.VideoID, directory.ID, relativePath, modTime)
					if err != nil {
						logging.Error("unhide video location failed, skip: path=%s err=%v", normalizedPath, err)
						return nil
					}
					existingLoc.IsDelete = false
					existingLoc.ModifiedAt = modTime
					if saved != nil {
						state.processedLocationIDs[saved.ID] = struct{}{}
						state.existingLocationByPath[makePathKey(saved.DirectoryID, saved.RelativePath)] = saved
						state.javLinks.Enqueue(saved.ID)
					}
					summary.Updated++
				} else {
					state.javLinks.Enqueue(existingLoc.ID)
				}
				return nil
			}
		}

		logging.Info("scan file: root=%s path=%s size=%d", normalizedRoot, relativePath, info.Size())

		meta, err := probeVideoContext(ctx, normalizedPath)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return err
			}
			logging.Error("probe video metadata error: %v", err)
			return nil
		}
		fingerprint := meta.FingerprintV2(info.Size())
		durationSec := int64(math.Round(meta.DurationSeconds))

		fileEntry := &FileEntry{
			DirectoryID:   directory.ID,
			DirectoryPath: normalizedRoot,
			RelativePath:  relativePath,
			AbsolutePath:  normalizedPath,
			Filename:      info.Name(),
			Size:          info.Size(),
			ModifiedAt:    modTime,
			Fingerprint:   fingerprint,
			DurationSec:   durationSec,
		}

		return upsertVideo(ctx, fileEntry, state, summary)
	})
}

// reconcileSTRMLocation reads the locator on every scan. Only a changed target
// digest triggers remote probing; an mtime-only change updates the location.
func reconcileSTRMLocation(
	ctx context.Context,
	directory models.Directory,
	absolutePath string,
	relativePath string,
	info fs.FileInfo,
	modifiedAt time.Time,
	existingLoc *models.VideoLocation,
	existingVideo *models.Video,
	state *syncState,
	summary *Summary,
) error {
	source, err := util.ResolveMediaSource(absolutePath)
	if err != nil {
		logging.Error("read strm locator failed, skip: path=%s err=%v", absolutePath, err)
		preserveExistingSTRMLocation(existingLoc, state)
		return nil
	}

	if existingLoc != nil && existingVideo != nil && source.STRMDigest == existingLoc.StrmDigest {
		state.processedLocationIDs[existingLoc.ID] = struct{}{}
		if existingLoc.ModifiedAt.Equal(modifiedAt) && !existingLoc.IsDelete {
			state.javLinks.Enqueue(existingLoc.ID)
			return nil
		}
		saved, err := db.UpsertVideoLocationWithSTRMDigest(
			ctx,
			existingLoc.VideoID,
			directory.ID,
			relativePath,
			modifiedAt,
			source.STRMDigest,
		)
		if err != nil {
			logging.Error("update unchanged strm location failed, skip: path=%s err=%v", absolutePath, err)
			return nil
		}
		trackSavedLocation(saved, state)
		summary.Updated++
		return nil
	}

	logging.Info("probe strm target: root=%s path=%s", directory.Path, relativePath)
	meta, err := probeVideoContext(ctx, source.Input)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return err
		}
		logging.Error("probe strm target error, skip: path=%s err=%v", absolutePath, err)
		preserveExistingSTRMLocation(existingLoc, state)
		return nil
	}
	if meta == nil {
		logging.Error("probe strm target returned no metadata, skip: path=%s", absolutePath)
		preserveExistingSTRMLocation(existingLoc, state)
		return nil
	}
	durationSec := int64(math.Round(meta.DurationSeconds))
	if durationSec <= 0 || meta.Size <= 0 {
		logging.Error(
			"probe strm target missing duration or size, skip: path=%s duration=%f size=%d",
			absolutePath,
			meta.DurationSeconds,
			meta.Size,
		)
		preserveExistingSTRMLocation(existingLoc, state)
		return nil
	}

	entry := &FileEntry{
		DirectoryID:   directory.ID,
		DirectoryPath: directory.Path,
		RelativePath:  relativePath,
		AbsolutePath:  absolutePath,
		Filename:      info.Name(),
		Size:          meta.Size,
		ModifiedAt:    modifiedAt,
		Fingerprint:   meta.FingerprintV2(meta.Size),
		DurationSec:   durationSec,
		StrmDigest:    source.STRMDigest,
	}
	return upsertVideo(ctx, entry, state, summary)
}

func preserveExistingSTRMLocation(existingLoc *models.VideoLocation, state *syncState) {
	if existingLoc == nil {
		return
	}
	state.processedLocationIDs[existingLoc.ID] = struct{}{}
	if !existingLoc.IsDelete {
		state.javLinks.Enqueue(existingLoc.ID)
	}
}

func trackSavedLocation(loc *models.VideoLocation, state *syncState) {
	if loc == nil {
		return
	}
	state.processedLocationIDs[loc.ID] = struct{}{}
	state.existingLocationByPath[makePathKey(loc.DirectoryID, loc.RelativePath)] = loc
	state.javLinks.Enqueue(loc.ID)
}

// upsertVideo 根据文件指纹复用或创建视频，并写入当前目录中的文件位置。
func upsertVideo(ctx context.Context, entry *FileEntry, state *syncState, summary *Summary) error {
	if err := ctx.Err(); err != nil {
		return err
	}

	// 已存在：检测元信息/文件是否变化，必要时更新
	var video *models.Video
	if entry.Fingerprint != "" {
		existingVideo, err := db.GetVideoByFingerprint(ctx, entry.Fingerprint)
		if err != nil {
			logging.Error("lookup video by fingerprint failed, skip: path=%s err=%v", entry.AbsolutePath, err)
			return nil
		}
		if existingVideo != nil {
			video = existingVideo
			state.existingByID[video.ID] = video
		}
	}

	if video != nil {
		if err := upsertLocationForEntry(ctx, video, entry, state); err != nil {
			logging.Error("save video location failed, skip: path=%s err=%v", entry.AbsolutePath, err)
			return nil
		}
		return nil
	}

	video = &models.Video{
		DirectoryID: entry.DirectoryID,
		Size:        entry.Size,
		Fingerprint: entry.Fingerprint,
		DurationSec: entry.DurationSec,
	}

	if err := db.CreateVideo(ctx, video); err != nil {
		// Another directory scan may have inserted the same globally unique fingerprint between
		// our lookup and create. Reuse that row so this directory's location is not skipped.
		existingVideo, lookupErr := db.GetVideoByFingerprint(ctx, entry.Fingerprint)
		if lookupErr != nil || existingVideo == nil {
			logging.Error("create video failed, skip: path=%s err=%v", entry.AbsolutePath, err)
			return nil
		}
		video = existingVideo
		state.existingByID[video.ID] = video
		if err := upsertLocationForEntry(ctx, video, entry, state); err != nil {
			logging.Error("save video location after concurrent insert failed, skip: path=%s err=%v", entry.AbsolutePath, err)
		}
		return nil
	}
	summary.Inserted++
	state.existingByID[video.ID] = video
	if err := upsertLocationForEntry(ctx, video, entry, state); err != nil {
		logging.Error("save video location failed, skip: path=%s err=%v", entry.AbsolutePath, err)
		return nil
	}
	video.ModifiedAt = entry.ModifiedAt
	common.ScreenshotManager.EnqueueForVideo(video)
	return nil
}

// upsertLocationForEntry 保存视频文件位置，并加入本次 JAV 关联队列。
func upsertLocationForEntry(ctx context.Context, video *models.Video, entry *FileEntry, state *syncState) error {
	loc, err := db.UpsertVideoLocationWithSTRMDigest(
		ctx,
		video.ID,
		entry.DirectoryID,
		entry.RelativePath,
		entry.ModifiedAt,
		entry.StrmDigest,
	)
	if err != nil {
		return err
	}
	trackSavedLocation(loc, state)
	state.existingByID[video.ID] = video
	return nil
}

// hideUnprocessedVideoLocations 隐藏本次成功扫描中未再次发现的旧文件位置。
func hideUnprocessedVideoLocations(ctx context.Context, processedLocationIDs map[int64]struct{}, summary *Summary, directoryID int64) error {
	locations, err := db.VideoLocationsByDirectory(ctx, directoryID)
	if err != nil {
		return err
	}
	if len(locations) == 0 {
		return nil
	}

	staleIDs := make([]int64, 0, len(locations))
	for _, loc := range locations {
		if loc.IsDelete {
			continue
		}
		if _, ok := processedLocationIDs[loc.ID]; ok {
			continue
		}
		staleIDs = append(staleIDs, loc.ID)
	}

	if len(staleIDs) == 0 {
		return nil
	}

	logging.Info("hiding stale video locations: count=%d", len(staleIDs))
	if err := db.HideVideoLocationsByIDs(ctx, staleIDs); err != nil {
		return err
	}
	summary.Removed += len(staleIDs)
	return nil
}

// cleanRelativePath 规范化用于数据库存储的目录内相对路径。
func cleanRelativePath(p string) string {
	if p == "" {
		return ""
	}
	cleaned := filepath.Clean(p)
	if cleaned == "." {
		return ""
	}
	return filepath.ToSlash(cleaned)
}
