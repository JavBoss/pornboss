package service

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"javboss/internal/common"
	"javboss/internal/common/logging"
	"javboss/internal/db"
	"javboss/internal/models"
)

var (
	ErrDirectoryScanInProgress = errors.New("directory scan in progress")
	dirScanMu                  sync.Mutex
	dirScanActive              = map[int64]*directoryScanSession{}
)

// directoryScanSession 表示一个正在运行或被目录更新操作暂时占用的扫描会话。
type directoryScanSession struct {
	cancel    context.CancelFunc
	done      chan struct{}
	reserve   bool
	startedAt time.Time
	progress  *directoryScanProgress
}

// DirectoryScanProgress reports elapsed time and file/video counts for one scan.
type DirectoryScanProgress struct {
	ElapsedMS         int64
	ScannedFileCount  int64
	ScannedVideoCount int64
	ScrapedVideoCount int64
}

type directoryScanProgress struct {
	mu sync.Mutex
	DirectoryScanProgress
}

type directoryScanProgressKey struct{}

func (p *directoryScanProgress) recordFile() {
	if p == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.ScannedFileCount++
}

func (p *directoryScanProgress) record(scraped bool) {
	if p == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if scraped {
		p.ScrapedVideoCount++
	} else {
		p.ScannedVideoCount++
	}
}

const (
	DirectoryWorkIdle                  = "idle"
	DirectoryWorkScanning              = "scanning"
	DirectoryWorkOrganizing            = "organizing"
	DirectoryWorkGeneratingSidecar     = "generating_sidecar"
	DirectoryWorkOrganizingWithSidecar = "organizing_with_sidecar"
)

// IsDirectoryScanning 判断指定目录是否正在执行文件扫描；目录更新使用的临时占用不算扫描中。
func IsDirectoryScanning(id int64) bool {
	if id <= 0 {
		return false
	}

	dirScanMu.Lock()
	defer dirScanMu.Unlock()
	session := dirScanActive[id]
	return session != nil && !session.reserve
}

// DirectoryWorkStatus 返回目录当前的处理任务、扫描任务或空闲状态。
func DirectoryWorkStatus(id int64) string {
	status, _ := DirectoryWorkSnapshot(id)
	return status
}

// DirectoryWorkSnapshot returns a consistent scan status and its current counters.
// Filesystem processing tasks do not expose scan counters; their follow-up scans do.
func DirectoryWorkSnapshot(id int64) (string, *DirectoryScanProgress) {
	status := activeDirectoryProcessingStatus(id)
	if status != "" && status != DirectoryWorkScanning {
		return status, nil
	}
	dirScanMu.Lock()
	defer dirScanMu.Unlock()
	if session := dirScanActive[id]; session != nil && !session.reserve {
		session.progress.mu.Lock()
		progress := session.progress.DirectoryScanProgress
		session.progress.mu.Unlock()
		progress.ElapsedMS = time.Since(session.startedAt).Milliseconds()
		return DirectoryWorkScanning, &progress
	}
	// Keep the directory busy while the processing job hands off to/from its scan.
	if status == DirectoryWorkScanning {
		return status, &DirectoryScanProgress{}
	}
	return DirectoryWorkIdle, nil
}

// acquireDirectoryScanSession 获取单目录扫描会话，保证同一目录同一时间只运行一个扫描任务。
func acquireDirectoryScanSession(ctx context.Context, id int64) (context.Context, func(), error) {
	if id <= 0 {
		return nil, nil, errors.New("directory id cannot be zero")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	dirScanMu.Lock()
	defer dirScanMu.Unlock()
	if _, ok := dirScanActive[id]; ok {
		return nil, nil, ErrDirectoryScanInProgress
	}

	scanCtx, cancel := context.WithCancel(ctx)
	progress := &directoryScanProgress{}
	scanCtx = context.WithValue(scanCtx, directoryScanProgressKey{}, progress)
	session := &directoryScanSession{
		cancel:    cancel,
		done:      make(chan struct{}),
		startedAt: time.Now(),
		progress:  progress,
	}
	dirScanActive[id] = session

	var finishOnce sync.Once
	finish := func() {
		finishOnce.Do(func() {
			cancel()
			dirScanMu.Lock()
			if dirScanActive[id] == session {
				delete(dirScanActive, id)
			}
			close(session.done)
			dirScanMu.Unlock()
		})
	}
	return scanCtx, finish, nil
}

// CancelAndReserveDirectoryScan 取消并等待指定目录的活动扫描结束，然后占用扫描会话；
// 调用返回的 release 函数后，其他扫描任务才可再次进入。
func CancelAndReserveDirectoryScan(ctx context.Context, id int64) (func(), error) {
	if id <= 0 {
		return nil, errors.New("directory id cannot be zero")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	for {
		dirScanMu.Lock()
		session := dirScanActive[id]
		if session == nil {
			reservation := &directoryScanSession{done: make(chan struct{}), reserve: true}
			dirScanActive[id] = reservation
			dirScanMu.Unlock()
			var releaseOnce sync.Once
			return func() {
				releaseOnce.Do(func() {
					dirScanMu.Lock()
					if dirScanActive[id] == reservation {
						delete(dirScanActive, id)
					}
					close(reservation.done)
					dirScanMu.Unlock()
				})
			}, nil
		}
		if session.reserve {
			dirScanMu.Unlock()
			return nil, ErrDirectoryScanInProgress
		}
		session.cancel()
		done := session.done
		dirScanMu.Unlock()

		select {
		case <-done:
		case <-ctx.Done():
			return nil, fmt.Errorf("cancel directory scan: %w", ctx.Err())
		}
	}
}

// isAutomaticDirectoryScanDue 根据目录的最新开关、周期和上次完成时间判断是否到期。
func isAutomaticDirectoryScanDue(directory models.Directory, now time.Time) bool {
	if directory.ID <= 0 || directory.IsDelete || !directory.AutoScanEnabled {
		return false
	}
	intervalMinutes := directory.AutoScanIntervalMinutes
	if intervalMinutes <= 0 {
		intervalMinutes = 1
	}
	finishedAt := directory.LastScanSummary.FinishedAtUnixMS
	if finishedAt <= 0 {
		return true
	}
	return !now.Before(time.UnixMilli(finishedAt).Add(time.Duration(intervalMinutes) * time.Minute))
}

// dispatchDueAutomaticDirectoryScans 为每个已到期目录启动独立扫描任务并立即返回。
// 同一目录在 activeScans 中只允许存在一个任务，任务开始前还会重新读取最新目录设置。
func dispatchDueAutomaticDirectoryScans(
	ctx context.Context,
	now time.Time,
	activeScans *sync.Map,
	runningScans *sync.WaitGroup,
) error {
	if common.DB == nil {
		return errors.New("nil db")
	}
	dirs, err := db.ListActiveDirectories(ctx)
	if err != nil {
		return err
	}
	for _, dir := range dirs {
		if !isAutomaticDirectoryScanDue(dir, now) {
			continue
		}
		if _, alreadyActive := activeScans.LoadOrStore(dir.ID, struct{}{}); alreadyActive {
			continue
		}
		runningScans.Add(1)
		go func(id int64, queuedAt time.Time) {
			defer runningScans.Done()
			defer activeScans.Delete(id)

			current, err := loadDirectoryIfAutomaticScanDue(ctx, id, queuedAt)
			if err != nil {
				if !errors.Is(err, context.Canceled) {
					logging.Error("reload automatic scan directory failed id=%d err=%v", id, err)
				}
				return
			}
			if current == nil {
				return
			}
			if _, err := ScanDirectory(ctx, *current); err != nil {
				if !errors.Is(err, ErrDirectoryScanInProgress) && !errors.Is(err, context.Canceled) {
					logging.Error("automatic directory scan failed id=%d path=%s err=%v", current.ID, current.Path, err)
				}
				return
			}
			if err := enqueueMissingCoversForDirectory(ctx, current.ID); err != nil && !errors.Is(err, context.Canceled) {
				logging.Error("jav cover enqueue after automatic scan failed id=%d err=%v", current.ID, err)
			}
		}(dir.ID, now)
	}
	return nil
}

// loadDirectoryIfAutomaticScanDue 重新读取排队目录；若目录已删除、已关闭或尚未到期则返回 nil。
func loadDirectoryIfAutomaticScanDue(ctx context.Context, id int64, notBefore time.Time) (*models.Directory, error) {
	dir, err := db.GetDirectory(ctx, id)
	if err != nil {
		return nil, err
	}
	if dir == nil {
		return nil, nil
	}
	checkAt := time.Now()
	if checkAt.Before(notBefore) {
		checkAt = notBefore
	}
	if !isAutomaticDirectoryScanDue(*dir, checkAt) {
		return nil, nil
	}
	return dir, nil
}

// StartAutomaticDirectoryScanScheduler 启动自动扫描调度器；立即检查一次，之后按轮询周期检查到期目录。
func StartAutomaticDirectoryScanScheduler(ctx context.Context, pollInterval time.Duration) {
	go func() {
		var activeScans sync.Map
		var runningScans sync.WaitGroup
		defer runningScans.Wait()

		ticker := time.NewTicker(pollInterval)
		defer ticker.Stop()
		for {
			if err := dispatchDueAutomaticDirectoryScans(
				ctx,
				time.Now(),
				&activeScans,
				&runningScans,
			); err != nil {
				logging.Error("periodic directory scan failed: %v", err)
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}
