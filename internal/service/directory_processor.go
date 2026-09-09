package service

import (
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"javboss/internal/common"
	"javboss/internal/common/logging"
	"javboss/internal/db"
	"javboss/internal/manager"
	"javboss/internal/models"
	"javboss/internal/util"
)

const (
	DirectoryProcessSidecar             = "sidecar"
	DirectoryProcessOrganize            = "organize"
	DirectoryProcessOrganizeWithSidecar = "organize_with_sidecar"
	DirectoryProcessLayoutPrefix        = "prefix"
	DirectoryProcessLayoutCode          = "code"
	DirectoryProcessLayoutIdol          = "idol"
	directoryOrganizeParent             = "JAV"
	directoryUnknownIdol                = "未知女优"
	directoryMultipleIdols              = "多女优"
	directoryMaxJoinedIdols             = 3
	directoryProcessReportName          = "JavBoss-整理报告.txt"
)

var (
	ErrInvalidDirectoryProcessMode   = errors.New("invalid directory process mode")
	ErrInvalidDirectoryProcessLayout = errors.New("invalid directory process layout")
	ErrDirectoryWorkInProgress       = errors.New("directory work in progress")

	directoryProcessingMu     sync.Mutex
	directoryProcessingStatus = map[int64]string{}
)

// DirectoryProcessSummary records the result of one directory processing job.
type DirectoryProcessSummary struct {
	Locations                int
	Moved                    int
	AlreadyOrganized         int
	Sidecars                 int
	Skipped                  int
	Failed                   int
	EmptyDirectoriesRemoved  int
	MoveFailures             []DirectoryProcessIssue
	SkippedItems             []DirectoryProcessIssue
	SidecarFailures          []DirectoryProcessIssue
	DirectoryCleanupFailures []DirectoryProcessIssue
	emptyDirectoryCandidates []string
}

// DirectoryProcessIssue describes one file that was not fully processed.
type DirectoryProcessIssue struct {
	Code       string
	SourcePath string
	TargetPath string
	Reason     string
}

func directoryProcessMode(raw string) (mode string, status string, ok bool) {
	mode = strings.TrimSpace(raw)
	switch mode {
	case DirectoryProcessSidecar:
		return mode, DirectoryWorkGeneratingSidecar, true
	case DirectoryProcessOrganize:
		return mode, DirectoryWorkOrganizing, true
	case DirectoryProcessOrganizeWithSidecar:
		return mode, DirectoryWorkOrganizingWithSidecar, true
	default:
		return "", "", false
	}
}

func activeDirectoryProcessingStatus(id int64) string {
	directoryProcessingMu.Lock()
	defer directoryProcessingMu.Unlock()
	return directoryProcessingStatus[id]
}

func setDirectoryProcessingStatus(id int64, status string) {
	directoryProcessingMu.Lock()
	defer directoryProcessingMu.Unlock()
	if status == "" {
		delete(directoryProcessingStatus, id)
		return
	}
	directoryProcessingStatus[id] = status
}

// StartDirectoryProcessing reserves the directory and starts an asynchronous filesystem job.
func StartDirectoryProcessing(ctx context.Context, directory models.Directory, mode, layout string) error {
	normalizedMode, status, ok := directoryProcessMode(mode)
	if !ok {
		return ErrInvalidDirectoryProcessMode
	}
	mode = normalizedMode
	layout, ok = directoryProcessLayout(layout)
	if !ok {
		return ErrInvalidDirectoryProcessLayout
	}
	if directory.ID <= 0 || directory.IsDelete {
		return errors.New("invalid directory")
	}

	directoryProcessingMu.Lock()
	if directoryProcessingStatus[directory.ID] != "" {
		directoryProcessingMu.Unlock()
		return ErrDirectoryWorkInProgress
	}
	directoryProcessingStatus[directory.ID] = status
	directoryProcessingMu.Unlock()

	release, err := CancelAndReserveDirectoryScan(ctx, directory.ID)
	if err != nil {
		setDirectoryProcessingStatus(directory.ID, "")
		return err
	}

	go func() {
		defer setDirectoryProcessingStatus(directory.ID, "")
		defer release()

		startedAt := time.Now()
		summary, processErr := ProcessDirectory(context.Background(), directory, mode, layout)
		finishedAt := time.Now()
		if processErr != nil {
			logging.Error("directory processing failed id=%d mode=%s err=%v", directory.ID, mode, processErr)
		} else {
			logging.Info(
				"directory processing complete id=%d mode=%s locations=%d moved=%d already_organized=%d sidecars=%d skipped=%d failed=%d empty_directories_removed=%d cleanup_failed=%d",
				directory.ID,
				mode,
				summary.Locations,
				summary.Moved,
				summary.AlreadyOrganized,
				summary.Sidecars,
				summary.Skipped,
				summary.Failed,
				summary.EmptyDirectoriesRemoved,
				len(summary.DirectoryCleanupFailures),
			)
		}
		if err := writeDirectoryProcessReport(
			directory.Path,
			mode,
			layout,
			summary,
			processErr,
			startedAt,
			finishedAt,
		); err != nil {
			logging.Error("write directory processing report failed id=%d path=%s err=%v", directory.ID, directory.Path, err)
		}

		release()
		setDirectoryProcessingStatus(directory.ID, DirectoryWorkScanning)
		if _, err := ScanDirectory(context.Background(), directory); err != nil &&
			!errors.Is(err, ErrDirectoryScanInProgress) {
			logging.Error("rescan after directory processing failed id=%d err=%v", directory.ID, err)
		}
	}()
	return nil
}

func directoryProcessLayout(layout string) (string, bool) {
	switch strings.TrimSpace(layout) {
	case "", DirectoryProcessLayoutPrefix:
		return DirectoryProcessLayoutPrefix, true
	case DirectoryProcessLayoutCode:
		return DirectoryProcessLayoutCode, true
	case DirectoryProcessLayoutIdol:
		return DirectoryProcessLayoutIdol, true
	default:
		return "", false
	}
}

// ProcessDirectory organizes and/or writes Sidecar files for scraped locations.
func ProcessDirectory(
	ctx context.Context,
	directory models.Directory,
	mode string,
	layout string,
) (*DirectoryProcessSummary, error) {
	normalizedMode, _, ok := directoryProcessMode(mode)
	if !ok {
		return nil, ErrInvalidDirectoryProcessMode
	}
	mode = normalizedMode
	layout, ok = directoryProcessLayout(layout)
	if !ok {
		return nil, ErrInvalidDirectoryProcessLayout
	}
	if strings.TrimSpace(directory.Path) == "" {
		return nil, errors.New("directory path is empty")
	}

	items, err := db.ListJavsForDirectoryProcessing(ctx, directory.ID)
	if err != nil {
		return nil, err
	}

	coverDir := ""
	if common.AppConfig != nil {
		coverDir = common.AppConfig.JavCoverDir
	}
	summary := &DirectoryProcessSummary{}
	for i := range items {
		if err := ctx.Err(); err != nil {
			cleanupEmptySourceDirectories(directory.Path, summary)
			return summary, err
		}
		processJavItem(ctx, directory.Path, &items[i], mode, layout, coverDir, summary)
	}
	cleanupEmptySourceDirectories(directory.Path, summary)
	if err := ctx.Err(); err != nil {
		return summary, err
	}
	return summary, nil
}

func processJavItem(
	ctx context.Context,
	root string,
	item *models.Jav,
	mode string,
	layout string,
	coverDir string,
	summary *DirectoryProcessSummary,
) {
	if item == nil || summary == nil {
		return
	}
	summary.Locations += len(item.Videos)
	code, prefix, ok := organizeCodeParts(item.Code)
	if !ok {
		summary.Skipped += len(item.Videos)
		for i := range item.Videos {
			summary.SkippedItems = append(summary.SkippedItems, DirectoryProcessIssue{
				Code:       strings.TrimSpace(item.Code),
				SourcePath: reportRelativePath(root, item.Videos[i].Path),
				Reason:     "番号为空或无法生成安全的目录名",
			})
		}
		return
	}

	for i := range item.Videos {
		if err := ctx.Err(); err != nil {
			return
		}
		video := &item.Videos[i]
		source, err := safeDirectoryFilePath(root, video.Path)
		if err != nil {
			summary.Failed++
			summary.MoveFailures = append(summary.MoveFailures, DirectoryProcessIssue{
				Code:       code,
				SourcePath: reportRelativePath(root, video.Path),
				Reason:     directoryProcessFailureReason(err),
			})
			logging.Error("resolve directory processing source failed path=%s err=%v", video.Path, err)
			continue
		}
		target := source
		if mode != DirectoryProcessSidecar {
			group := prefix
			if layout == DirectoryProcessLayoutCode {
				target, err = safeDirectoryFilePath(
					root,
					filepath.Join(directoryOrganizeParent, code, filepath.Base(source)),
				)
			} else {
				if layout == DirectoryProcessLayoutIdol {
					group = organizeIdolComponent(item.Idols)
				}
				target, err = safeDirectoryFilePath(
					root,
					filepath.Join(directoryOrganizeParent, group, code, filepath.Base(source)),
				)
			}
			if err != nil {
				summary.Failed++
				summary.MoveFailures = append(summary.MoveFailures, DirectoryProcessIssue{
					Code:       code,
					SourcePath: reportRelativePath(root, source),
					Reason:     directoryProcessFailureReason(err),
				})
				logging.Error("resolve directory processing target failed path=%s err=%v", video.Path, err)
				continue
			}
			moved, moveErr := moveMediaGroup(source, target)
			if moveErr != nil {
				summary.Failed++
				summary.MoveFailures = append(summary.MoveFailures, DirectoryProcessIssue{
					Code:       code,
					SourcePath: reportRelativePath(root, source),
					TargetPath: reportRelativePath(root, target),
					Reason:     directoryProcessFailureReason(moveErr),
				})
				logging.Error("move directory media failed source=%s target=%s err=%v", source, target, moveErr)
				continue
			}
			if moved {
				summary.Moved++
				summary.emptyDirectoryCandidates = append(
					summary.emptyDirectoryCandidates,
					filepath.Dir(source),
				)
			} else {
				summary.AlreadyOrganized++
			}
		}

		if mode == DirectoryProcessSidecar || mode == DirectoryProcessOrganizeWithSidecar {
			if err := writeJavSidecars(target, item, coverDir); err != nil {
				summary.Failed++
				summary.SidecarFailures = append(summary.SidecarFailures, DirectoryProcessIssue{
					Code:       code,
					SourcePath: reportRelativePath(root, target),
					Reason:     directoryProcessFailureReason(err),
				})
				logging.Error("write JAV Sidecar failed path=%s code=%s err=%v", target, item.Code, err)
				continue
			}
			summary.Sidecars++
		}
	}
}

func organizeIdolComponent(idols []models.JavIdol) string {
	names := make([]string, 0, len(idols))
	seen := make(map[string]struct{}, len(idols))
	for i := range idols {
		name := firstNonEmptyString(
			idols[i].ChineseName,
			idols[i].Name,
			idols[i].JapaneseName,
			idols[i].RomanName,
		)
		name = sanitizeOrganizeComponent(name)
		if name == "" {
			continue
		}
		key := strings.ToLower(name)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		names = append(names, name)
	}
	if len(names) == 0 {
		return directoryUnknownIdol
	}
	if len(names) > directoryMaxJoinedIdols {
		return directoryMultipleIdols
	}
	sort.Slice(names, func(i, j int) bool {
		return strings.ToLower(names[i]) < strings.ToLower(names[j])
	})
	return strings.Join(names, "，")
}

func organizeCodeParts(raw string) (code string, prefix string, ok bool) {
	code = sanitizeOrganizeComponent(strings.ToUpper(strings.TrimSpace(raw)))
	if code == "" {
		return "", "", false
	}
	if index := strings.IndexAny(code, "-_"); index > 0 {
		prefix = code[:index]
	} else {
		prefix = "OTHER"
	}
	prefix = sanitizeOrganizeComponent(prefix)
	return code, prefix, prefix != ""
}

func sanitizeOrganizeComponent(value string) string {
	var builder strings.Builder
	lastSeparator := false
	for _, r := range value {
		allowed := unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-' || r == '_' || r == '.'
		if allowed {
			builder.WriteRune(r)
			lastSeparator = false
			continue
		}
		if !lastSeparator {
			builder.WriteByte('_')
			lastSeparator = true
		}
	}
	return strings.Trim(builder.String(), " ._-")
}

func reportRelativePath(root, path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return "（未知）"
	}
	cleaned := filepath.Clean(filepath.FromSlash(path))
	if filepath.IsAbs(cleaned) {
		if relative, err := filepath.Rel(filepath.Clean(root), cleaned); err == nil &&
			relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			cleaned = relative
		}
	}
	return filepath.ToSlash(cleaned)
}

func pathWithinDirectory(root, path string) bool {
	relative, err := filepath.Rel(filepath.Clean(root), filepath.Clean(path))
	return err == nil && relative != ".." &&
		!strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func addDirectoryCleanupFailure(
	root string,
	path string,
	reason string,
	summary *DirectoryProcessSummary,
) {
	if summary == nil {
		return
	}
	summary.DirectoryCleanupFailures = append(
		summary.DirectoryCleanupFailures,
		DirectoryProcessIssue{
			SourcePath: reportRelativePath(root, path),
			Reason:     reason,
		},
	)
}

func cleanupEmptySourceDirectories(root string, summary *DirectoryProcessSummary) {
	if summary == nil || len(summary.emptyDirectoryCandidates) == 0 {
		return
	}
	root = filepath.Clean(strings.TrimSpace(root))
	if !filepath.IsAbs(root) {
		addDirectoryCleanupFailure(root, root, "所选目录不是有效的绝对路径", summary)
		return
	}

	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		addDirectoryCleanupFailure(root, root, directoryProcessFailureReason(err), summary)
		return
	}

	candidates := make(map[string]struct{})
	for _, candidate := range summary.emptyDirectoryCandidates {
		current := filepath.Clean(candidate)
		for current != root && pathWithinDirectory(root, current) {
			candidates[current] = struct{}{}
			parent := filepath.Dir(current)
			if parent == current {
				break
			}
			current = parent
		}
	}
	paths := make([]string, 0, len(candidates))
	for path := range candidates {
		paths = append(paths, path)
	}
	sort.Slice(paths, func(i, j int) bool {
		return len(paths[i]) > len(paths[j])
	})

	for _, path := range paths {
		info, err := os.Lstat(path)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			addDirectoryCleanupFailure(root, path, directoryProcessFailureReason(err), summary)
			continue
		}
		if info.Mode()&os.ModeSymlink != 0 {
			addDirectoryCleanupFailure(root, path, "为避免越过符号链接，未自动删除此目录", summary)
			continue
		}
		if !info.IsDir() {
			continue
		}

		realPath, err := filepath.EvalSymlinks(path)
		if err != nil {
			addDirectoryCleanupFailure(root, path, directoryProcessFailureReason(err), summary)
			continue
		}
		relativePath, err := filepath.Rel(root, path)
		if err != nil {
			addDirectoryCleanupFailure(root, path, directoryProcessFailureReason(err), summary)
			continue
		}
		expectedRealPath := filepath.Join(realRoot, relativePath)
		if !pathWithinDirectory(realRoot, realPath) ||
			filepath.Clean(realPath) != filepath.Clean(expectedRealPath) {
			addDirectoryCleanupFailure(root, path, "为避免越过符号链接，未自动删除此目录", summary)
			continue
		}

		entries, err := os.ReadDir(path)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			addDirectoryCleanupFailure(root, path, directoryProcessFailureReason(err), summary)
			continue
		}
		if len(entries) != 0 {
			continue
		}
		if err := os.Remove(path); err != nil {
			addDirectoryCleanupFailure(root, path, directoryProcessFailureReason(err), summary)
			logging.Error("remove empty source directory failed path=%s err=%v", path, err)
			continue
		}
		summary.EmptyDirectoriesRemoved++
	}
	summary.emptyDirectoryCandidates = nil
}

func directoryProcessFailureReason(err error) string {
	if err == nil {
		return "未知错误"
	}
	message := err.Error()
	switch {
	case strings.Contains(message, "target already exists"):
		return "目标位置已存在同名文件"
	case strings.Contains(message, "existing NFO is not managed by JavBoss"):
		return "已有非 JavBoss 管理的 NFO，未覆盖该文件"
	case errors.Is(err, os.ErrPermission):
		return "没有足够的文件或目录访问权限"
	case errors.Is(err, os.ErrNotExist):
		return "源文件或相关目录不存在"
	default:
		return message
	}
}

func directoryProcessModeDisplay(mode string) string {
	switch mode {
	case DirectoryProcessSidecar:
		return "仅生成 NFO 和封面"
	case DirectoryProcessOrganize:
		return "仅整理目录"
	case DirectoryProcessOrganizeWithSidecar:
		return "整理并生成 NFO 和封面"
	default:
		return mode
	}
}

func directoryProcessLayoutDisplay(layout string) string {
	switch layout {
	case DirectoryProcessLayoutCode:
		return "按完整番号（JAV/番号）"
	case DirectoryProcessLayoutIdol:
		return "按女优（JAV/女优/番号）"
	default:
		return "按番号前缀（JAV/前缀/番号）"
	}
}

func reportLineValue(value string) string {
	return strings.NewReplacer("\r", `\r`, "\n", `\n`, "\t", `\t`).Replace(value)
}

func writeDirectoryProcessIssueSection(
	builder *strings.Builder,
	title string,
	sourceLabel string,
	items []DirectoryProcessIssue,
) {
	if len(items) == 0 {
		return
	}
	fmt.Fprintf(builder, "\n【%s】\n", title)
	for i := range items {
		issue := items[i]
		label := strings.TrimSpace(issue.Code)
		if label == "" {
			label = filepath.Base(filepath.FromSlash(issue.SourcePath))
		}
		fmt.Fprintf(builder, "\n%d. %s\n", i+1, reportLineValue(label))
		fmt.Fprintf(builder, "%s：%s\n", sourceLabel, reportLineValue(issue.SourcePath))
		if issue.TargetPath != "" {
			fmt.Fprintf(builder, "目标文件：%s\n", reportLineValue(issue.TargetPath))
		}
		fmt.Fprintf(builder, "原因：%s\n", reportLineValue(issue.Reason))
	}
}

func writeDirectoryProcessReport(
	root string,
	mode string,
	layout string,
	summary *DirectoryProcessSummary,
	processErr error,
	startedAt time.Time,
	finishedAt time.Time,
) error {
	root = filepath.Clean(strings.TrimSpace(root))
	if root == "" || !filepath.IsAbs(root) {
		return errors.New("directory report root must be absolute")
	}
	if summary == nil {
		summary = &DirectoryProcessSummary{}
	}

	var builder strings.Builder
	builder.WriteString("JavBoss 目录整理报告\n\n")
	fmt.Fprintf(&builder, "开始时间：%s\n", startedAt.Format("2006-01-02 15:04:05"))
	fmt.Fprintf(&builder, "完成时间：%s\n", finishedAt.Format("2006-01-02 15:04:05"))
	fmt.Fprintf(&builder, "处理模式：%s\n", directoryProcessModeDisplay(mode))
	if mode != DirectoryProcessSidecar {
		fmt.Fprintf(&builder, "整理方式：%s\n", directoryProcessLayoutDisplay(layout))
	}
	if processErr != nil {
		fmt.Fprintf(&builder, "任务结果：未完成（%s）\n", reportLineValue(directoryProcessFailureReason(processErr)))
	} else {
		builder.WriteString("任务结果：已完成\n")
	}
	fmt.Fprintf(&builder, "\n参与处理视频：%d\n", summary.Locations)
	fmt.Fprintf(&builder, "成功移动：%d\n", summary.Moved)
	fmt.Fprintf(&builder, "已经位于目标位置：%d\n", summary.AlreadyOrganized)
	fmt.Fprintf(&builder, "未满足整理条件：%d\n", summary.Skipped)
	fmt.Fprintf(&builder, "移动失败并留在原处：%d\n", len(summary.MoveFailures))
	fmt.Fprintf(&builder, "NFO/封面生成成功：%d\n", summary.Sidecars)
	fmt.Fprintf(&builder, "NFO/封面生成失败：%d\n", len(summary.SidecarFailures))
	fmt.Fprintf(&builder, "已删除空目录：%d\n", summary.EmptyDirectoriesRemoved)
	fmt.Fprintf(&builder, "空目录清理失败：%d\n", len(summary.DirectoryCleanupFailures))

	writeDirectoryProcessIssueSection(&builder, "移动失败并留在原处", "源文件", summary.MoveFailures)
	writeDirectoryProcessIssueSection(&builder, "未满足整理条件", "源文件", summary.SkippedItems)
	writeDirectoryProcessIssueSection(&builder, "NFO/封面生成失败", "源文件", summary.SidecarFailures)
	writeDirectoryProcessIssueSection(
		&builder,
		"空目录清理失败",
		"目录",
		summary.DirectoryCleanupFailures,
	)

	reportPath := filepath.Join(root, directoryProcessReportName)
	if err := writeFileAtomically(reportPath, strings.NewReader(builder.String()), 0o644); err != nil {
		return fmt.Errorf("write processing report: %w", err)
	}
	return nil
}

func safeDirectoryFilePath(root, relative string) (string, error) {
	root = filepath.Clean(strings.TrimSpace(root))
	if root == "" || !filepath.IsAbs(root) {
		return "", errors.New("directory root must be absolute")
	}
	relative = filepath.Clean(filepath.FromSlash(strings.TrimSpace(relative)))
	if relative == "" || relative == "." || filepath.IsAbs(relative) {
		return "", errors.New("relative file path is invalid")
	}
	target := filepath.Clean(filepath.Join(root, relative))
	check, err := filepath.Rel(root, target)
	if err != nil || check == ".." || strings.HasPrefix(check, ".."+string(filepath.Separator)) {
		return "", errors.New("file path escapes directory root")
	}
	return target, nil
}

var attachmentExtensions = map[string]struct{}{
	".aac":  {},
	".ass":  {},
	".flac": {},
	".jpg":  {},
	".jpeg": {},
	".mka":  {},
	".mp3":  {},
	".nfo":  {},
	".png":  {},
	".ssa":  {},
	".srt":  {},
	".vtt":  {},
	".webp": {},
}

func moveMediaGroup(source, target string) (bool, error) {
	source = filepath.Clean(source)
	target = filepath.Clean(target)
	if source == target {
		info, err := os.Lstat(source)
		if err != nil {
			return false, fmt.Errorf("inspect source: %w", err)
		}
		if !info.Mode().IsRegular() {
			return false, errors.New("source is not a regular file")
		}
		return false, nil
	}

	info, err := os.Lstat(source)
	if err != nil {
		return false, fmt.Errorf("inspect source: %w", err)
	}
	if !info.Mode().IsRegular() {
		return false, errors.New("source is not a regular file")
	}

	files := []string{source}
	sourceDir := filepath.Dir(source)
	stem := strings.TrimSuffix(filepath.Base(source), filepath.Ext(source))
	entries, err := os.ReadDir(sourceDir)
	if err != nil {
		return false, fmt.Errorf("read source directory: %w", err)
	}
	for _, entry := range entries {
		if entry.IsDir() || entry.Name() == filepath.Base(source) {
			continue
		}
		name := entry.Name()
		if !strings.HasPrefix(name, stem+".") && !strings.HasPrefix(name, stem+"-") {
			continue
		}
		if _, ok := attachmentExtensions[strings.ToLower(filepath.Ext(name))]; !ok {
			continue
		}
		candidate := filepath.Join(sourceDir, name)
		candidateInfo, err := os.Lstat(candidate)
		if err != nil || !candidateInfo.Mode().IsRegular() || util.IsVideo(candidate) {
			continue
		}
		files = append(files, candidate)
	}

	targetDir := filepath.Dir(target)
	for _, file := range files {
		next := filepath.Join(targetDir, filepath.Base(file))
		if _, err := os.Lstat(next); err == nil {
			return false, fmt.Errorf("target already exists: %s", next)
		} else if !errors.Is(err, os.ErrNotExist) {
			return false, fmt.Errorf("inspect target %s: %w", next, err)
		}
	}
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		return false, fmt.Errorf("create target directory: %w", err)
	}

	moved := make([][2]string, 0, len(files))
	for _, file := range files {
		next := filepath.Join(targetDir, filepath.Base(file))
		if err := os.Rename(file, next); err != nil {
			for i := len(moved) - 1; i >= 0; i-- {
				if rollbackErr := os.Rename(moved[i][1], moved[i][0]); rollbackErr != nil {
					logging.Error("rollback media move failed source=%s target=%s err=%v", moved[i][1], moved[i][0], rollbackErr)
				}
			}
			return false, fmt.Errorf("move %s: %w", file, err)
		}
		moved = append(moved, [2]string{file, next})
	}
	return true, nil
}

type jellyfinNFO struct {
	XMLName       xml.Name        `xml:"movie"`
	Generator     string          `xml:"generator"`
	Title         string          `xml:"title"`
	OriginalTitle string          `xml:"originaltitle,omitempty"`
	SortTitle     string          `xml:"sorttitle,omitempty"`
	UniqueID      jellyfinUnique  `xml:"uniqueid"`
	Premiered     string          `xml:"premiered,omitempty"`
	Year          int             `xml:"year,omitempty"`
	Runtime       int             `xml:"runtime,omitempty"`
	Studio        string          `xml:"studio,omitempty"`
	Set           *jellyfinSet    `xml:"set,omitempty"`
	Genres        []string        `xml:"genre,omitempty"`
	Tags          []string        `xml:"tag,omitempty"`
	Actors        []jellyfinActor `xml:"actor,omitempty"`
}

type jellyfinUnique struct {
	Type    string `xml:"type,attr"`
	Default bool   `xml:"default,attr"`
	Value   string `xml:",chardata"`
}

type jellyfinSet struct {
	Name string `xml:"name"`
}

type jellyfinActor struct {
	Name string `xml:"name"`
}

func makeJellyfinNFO(item *models.Jav) jellyfinNFO {
	code := strings.ToUpper(strings.TrimSpace(item.Code))
	originalTitle := strings.TrimSpace(item.Title)
	title := code
	if originalTitle != "" {
		title = strings.TrimSpace(code + " " + originalTitle)
	}
	result := jellyfinNFO{
		Generator:     "JavBoss",
		Title:         title,
		OriginalTitle: originalTitle,
		SortTitle:     code,
		UniqueID: jellyfinUnique{
			Type:    "javboss",
			Default: true,
			Value:   code,
		},
		Runtime: item.DurationMin,
	}
	if item.ReleaseUnix > 0 {
		released := time.Unix(item.ReleaseUnix, 0).UTC()
		result.Premiered = released.Format("2006-01-02")
		result.Year, _ = strconv.Atoi(released.Format("2006"))
	}
	if item.Studio != nil {
		result.Studio = strings.TrimSpace(item.Studio.Name)
	}
	if item.Series != nil && strings.TrimSpace(item.Series.Name) != "" {
		result.Set = &jellyfinSet{Name: strings.TrimSpace(item.Series.Name)}
	}

	seen := map[string]struct{}{}
	for _, tag := range item.Tags {
		name := strings.TrimSpace(tag.Name)
		if name == "" {
			continue
		}
		key := strings.ToLower(name)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		result.Genres = append(result.Genres, name)
	}
	if item.IsUncensored != nil {
		if *item.IsUncensored {
			result.Tags = append(result.Tags, "无码")
		} else {
			result.Tags = append(result.Tags, "有码")
		}
	}
	for _, idol := range item.Idols {
		name := firstNonEmptyString(idol.ChineseName, idol.Name, idol.JapaneseName, idol.RomanName)
		if name != "" {
			result.Actors = append(result.Actors, jellyfinActor{Name: name})
		}
	}
	return result
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func writeJavSidecars(videoPath string, item *models.Jav, coverDir string) error {
	info, err := os.Stat(videoPath)
	if err != nil {
		return fmt.Errorf("inspect video: %w", err)
	}
	if !info.Mode().IsRegular() {
		return errors.New("video is not a regular file")
	}

	base := strings.TrimSuffix(videoPath, filepath.Ext(videoPath))
	nfoPath := base + ".nfo"
	owned, err := canWriteJavBossNFO(nfoPath)
	if err != nil {
		return err
	}
	if err := writeNFOFile(nfoPath, makeJellyfinNFO(item)); err != nil {
		return err
	}

	if coverPath, ok := manager.FindCoverPath(coverDir, item.Code); ok {
		posterPath := base + "-poster" + strings.ToLower(filepath.Ext(coverPath))
		if _, err := os.Stat(posterPath); err == nil && !owned {
			return nil
		} else if err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("inspect poster: %w", err)
		}
		if err := copyFileAtomically(coverPath, posterPath); err != nil {
			return fmt.Errorf("write poster: %w", err)
		}
	} else if common.CoverManager != nil {
		common.CoverManager.Enqueue(item.Code)
	}
	return nil
}

func canWriteJavBossNFO(path string) (bool, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("read existing NFO: %w", err)
	}
	if !strings.Contains(string(data), "<generator>JavBoss</generator>") {
		return false, errors.New("existing NFO is not managed by JavBoss")
	}
	return true, nil
}

func writeNFOFile(path string, value jellyfinNFO) error {
	var builder strings.Builder
	builder.WriteString(xml.Header)
	encoder := xml.NewEncoder(&builder)
	encoder.Indent("", "  ")
	if err := encoder.Encode(value); err != nil {
		return fmt.Errorf("encode NFO: %w", err)
	}
	if err := encoder.Close(); err != nil {
		return fmt.Errorf("finish NFO: %w", err)
	}
	return writeFileAtomically(path, strings.NewReader(builder.String()), 0o644)
}

func copyFileAtomically(source, target string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	return writeFileAtomically(target, input, 0o644)
}

func writeFileAtomically(target string, input io.Reader, mode os.FileMode) error {
	temp, err := os.CreateTemp(filepath.Dir(target), ".javboss-sidecar-*")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)

	if _, err := io.Copy(temp, input); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Chmod(mode); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	renameErr := os.Rename(tempPath, target)
	if renameErr == nil {
		return nil
	}
	if _, err := os.Stat(target); err != nil {
		return renameErr
	}
	if err := os.Remove(target); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return os.Rename(tempPath, target)
}
