package service

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"sync"

	"javboss/internal/common"
	"javboss/internal/common/logging"
	"javboss/internal/db"
	"javboss/internal/jav"
	"javboss/internal/models"
	"javboss/internal/util"
)

const (
	javLinkWorkerCount = 4 // 增加worker数可能会导致首次扫描目录时jav相关查询接口严重阻塞
	javLinkQueueSize   = 4096
)

type javLinkBatch struct {
	ctx     context.Context
	tasks   chan int64
	seen    map[int64]struct{}
	mu      sync.Mutex
	closed  bool
	workers sync.WaitGroup
}

func newJavLinkBatch(ctx context.Context) *javLinkBatch {
	if ctx == nil {
		ctx = context.Background()
	}
	batch := &javLinkBatch{
		ctx:   ctx,
		tasks: make(chan int64, javLinkQueueSize),
		seen:  make(map[int64]struct{}),
	}
	for i := 0; i < javLinkWorkerCount; i++ {
		batch.workers.Add(1)
		go batch.worker()
	}
	return batch
}

func (b *javLinkBatch) Enqueue(locationID int64) {
	if b == nil || locationID <= 0 {
		return
	}

	b.mu.Lock()
	if b.closed {
		b.mu.Unlock()
		return
	}
	if _, ok := b.seen[locationID]; ok {
		b.mu.Unlock()
		return
	}
	b.seen[locationID] = struct{}{}
	progress, _ := b.ctx.Value(directoryScanProgressKey{}).(*directoryScanProgress)
	progress.record(false)
	b.mu.Unlock()

	select {
	case b.tasks <- locationID:
	case <-b.ctx.Done():
	}
}

func (b *javLinkBatch) Wait() {
	if b == nil {
		return
	}

	b.mu.Lock()
	if !b.closed {
		b.closed = true
		close(b.tasks)
	}
	b.mu.Unlock()
	b.workers.Wait()
}

func (b *javLinkBatch) worker() {
	defer b.workers.Done()
	for locationID := range b.tasks {
		if err := b.ctx.Err(); err != nil {
			return
		}
		if err := processVideoLocationJavLink(b.ctx, locationID); err != nil {
			if errors.Is(err, context.Canceled) {
				return
			}
			logging.Error("video location jav link failed location=%d err=%v", locationID, err)
		}
		if progress, _ := b.ctx.Value(directoryScanProgressKey{}).(*directoryScanProgress); progress != nil {
			// Read the persisted result: skipped/unmatched work is not a successful scrape,
			// while files whose metadata was already linked still count in this scan.
			v, err := db.GetVideoForJavScan(b.ctx, locationID)
			if err != nil {
				if b.ctx.Err() == nil {
					logging.Error("read directory scrape progress failed location=%d err=%v", locationID, err)
				}
			} else if v != nil && v.JavID != nil {
				progress.record(true)
			}
		}
	}
}

func finishJavLinkBatch(batch *javLinkBatch) {
	batch.Wait()
}

func processVideoLocationJavLink(ctx context.Context, locationID int64) error {
	v, err := db.GetVideoForJavScan(ctx, locationID)
	if err != nil || v == nil {
		return err
	}

	override := normalizeJavScrapeOverride(v.JavScrapeOverride)
	if override == models.JavScrapeOverrideSkip {
		return nil
	}

	filename := filepath.Base(filepath.FromSlash(v.Filename))
	forcedCode := forcedJavScrapeCode(override)
	if forcedCode == "" {
		if v.JavID != nil {
			return nil
		}
		if v.DurationSec > 0 && v.DurationSec < 900 {
			return nil
		}
	} else if v.JavID != nil {
		if strings.EqualFold(strings.TrimSpace(v.JavCode), forcedCode) {
			return nil
		}
		if err := db.ClearVideoLocationJavIDForVideo(ctx, v.LocationID, v.VideoID, v.UpdatedAt); err != nil {
			logging.Error("clear video location jav before forced scrape failed location=%d code=%s err=%v", v.LocationID, forcedCode, err)
			return err
		}
		v.JavID = nil
		v.JavCode = ""
	}

	possibleCodes := javScrapeCodesForVideo(filename, forcedCode)
	if len(possibleCodes) == 0 {
		return nil
	}

	if linked := linkExistingJav(ctx, v, possibleCodes); linked {
		return nil
	}

	for _, code := range possibleCodes {
		for _, provider := range javLinkProvidersForCode(code) {
			if linked, err := lookupAndLinkVideoLocationJav(ctx, v, filename, []string{code}, provider); err != nil || linked {
				return err
			}
		}
	}

	uncensoredPossibleCodes := util.ExtractUncensoredCodesFromName(filename)
	if forcedCode != "" {
		uncensoredPossibleCodes = possibleCodes
	}
	if linked, err := lookupAndLinkVideoLocationJav(ctx, v, filename, uncensoredPossibleCodes, jav.ProviderAvsox); err != nil || linked {
		return err
	}
	return nil
}

func linkExistingJav(ctx context.Context, v *db.JavScanVideo, possibleCodes []string) bool {
	for _, code := range possibleCodes {
		existJav, err := db.GetJavByCode(ctx, code)
		if err != nil {
			logging.Error("jav lookup existing failed location=%d code=%s err=%v", v.LocationID, code, err)
			continue
		}
		if existJav == nil {
			continue
		}
		if err := db.SetVideoLocationJavIDForVideo(ctx, v.LocationID, v.VideoID, existJav.ID, v.UpdatedAt); err != nil {
			logging.Error("set video location jav failed location=%d code=%s err=%v", v.LocationID, code, err)
		} else {
			enqueueCover(existJav.Code)
		}
		return true
	}
	return false
}

func javScrapeCodesForVideo(filename, forcedCode string) []string {
	forcedCode = strings.TrimSpace(forcedCode)
	if forcedCode != "" {
		return []string{forcedCode}
	}
	return util.ExtractCodeFromName(filename)
}

func javLinkProvidersForCode(code string) []jav.Provider {
	code = strings.ToUpper(strings.TrimSpace(code))
	switch {
	case strings.HasPrefix(code, "GANA-"):
		return []jav.Provider{jav.ProviderJavMenu, jav.ProviderJavBus}
	case strings.HasPrefix(code, "STARS-"):
		return []jav.Provider{jav.ProviderJavBus, jav.ProviderAvmoo}
	case strings.HasPrefix(code, "AP-"):
		return []jav.Provider{jav.ProviderAvmoo}
	default:
		return []jav.Provider{jav.ProviderJavBus}
	}
}

func normalizeJavScrapeOverride(raw string) string {
	raw = strings.TrimSpace(raw)
	if strings.EqualFold(raw, models.JavScrapeOverrideSkip) {
		return models.JavScrapeOverrideSkip
	}
	if strings.HasPrefix(strings.ToLower(raw), models.JavScrapeOverrideManualPrefix) {
		code := strings.TrimSpace(raw[len(models.JavScrapeOverrideManualPrefix):])
		if code == "" {
			return ""
		}
		return models.JavScrapeOverrideManualPrefix + strings.ToUpper(code)
	}
	return strings.ToUpper(raw)
}

func forcedJavScrapeCode(override string) string {
	override = normalizeJavScrapeOverride(override)
	if override == "" || override == models.JavScrapeOverrideSkip {
		return ""
	}
	if strings.HasPrefix(strings.ToLower(override), models.JavScrapeOverrideManualPrefix) {
		return strings.TrimSpace(override[len(models.JavScrapeOverrideManualPrefix):])
	}
	return override
}

func lookupAndLinkVideoLocationJav(ctx context.Context, v *db.JavScanVideo, filename string, possibleCodes []string, provider jav.Provider) (bool, error) {
	for _, code := range possibleCodes {
		info, err := jav.LookupJavByCode(code, provider)
		if err != nil {
			if errors.Is(err, jav.ResourceNotFonud) {
				continue
			}
			logging.Error("jav lookup failed provider=%s location=%s code=%s err=%v", provider.String(), filename, code, err)
			continue
		}
		if info == nil {
			continue
		}

		if _, err := db.SaveJavInfoAndLinkLocationForVideo(ctx, info, v.LocationID, v.VideoID, v.UpdatedAt); err != nil {
			logging.Error("link video location->jav failed provider=%s location=%s code=%s err=%v", provider.String(), filename, info.Code, err)
		} else {
			logging.Info("link video location->jav success provider=%s location=%s code=%s", provider.String(), filename, info.Code)
			enqueueCover(info.Code)
		}
		return true, nil
	}
	return false, nil
}

func enqueueCover(code string) {
	mgr := common.CoverManager
	if mgr == nil {
		return
	}
	code = strings.TrimSpace(code)
	if code == "" {
		return
	}
	mgr.Enqueue(code)
}

// enqueueMissingCoversForDirectory 只补充指定目录中已关联 JAV 的缺失封面。
func enqueueMissingCoversForDirectory(ctx context.Context, directoryID int64) error {
	mgr := common.CoverManager
	if common.DB == nil || mgr == nil {
		return nil
	}
	codes, err := db.ListJavCodesForDirectory(ctx, directoryID)
	if err != nil {
		return err
	}
	for _, c := range codes {
		code := strings.TrimSpace(c)
		if code == "" {
			continue
		}
		if mgr.Exists(code) {
			continue
		}
		mgr.Enqueue(code)
	}
	return nil
}
