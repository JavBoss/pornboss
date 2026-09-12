import { useState } from 'react'
import { IconButton, Popover, Tooltip } from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import DriveFileRenameOutlineIcon from '@mui/icons-material/DriveFileRenameOutline'
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import ManageSearchIcon from '@mui/icons-material/ManageSearch'
import { revealVideoLocation } from '@/api'
import { useStore } from '@/store'
import { displayHostPath, hostPathsEnabled } from '@/utils/hostPath'
import {
  buildVideoFullPath,
  formatBytes,
  getVideoDisplayName,
  parseVideoFingerprint,
} from '@/utils/display'
import { zh } from '@/utils/i18n'
import PhotoLibraryOutlinedIcon from '@mui/icons-material/PhotoLibraryOutlined'
import { MovieEdit } from '@mui/icons-material'

export default function VideoCard({
  video,
  checked,
  onToggle,
  showSelection = true,
  onPlay,
  onOpenFile,
  onRevealFile,
  openFileLabel,
  onOpenTagPicker,
  showTagEditor = true,
  onOpenScreenshots,
  onOpenScrapeSettings,
  onRenameVideo,
  onDeleteVideo,
  onTagClick,
}) {
  const useHostPaths = useStore((state) => hostPathsEnabled(state.config))
  const [editAnchorEl, setEditAnchorEl] = useState(null)
  const displayName = getVideoDisplayName(video)
  const durationSec = Number(video?.duration_sec)
  const durationMinutes =
    Number.isFinite(durationSec) && durationSec > 0
      ? Math.max(1, Math.round(durationSec / 60))
      : null
  const meta = parseVideoFingerprint(video?.fingerprint)
  const resolution =
    meta.width && meta.height && meta.width > 0 && meta.height > 0
      ? `${meta.width}x${meta.height}`
      : ''
  const sizeText = formatBytes(meta.size || video?.size)
  const directoryPath = video?.directory?.path || video?.directory_path || ''
  const videoPath = video?.path || ''
  const fullPath = buildVideoFullPath(video)
  const displayPath = displayHostPath(fullPath, useHostPaths)
  const canOpen = Boolean(directoryPath && videoPath)
  const inputId = `check-${video?.location_id || video.id}`
  const javCode = String(video?.jav?.code || video?.locations?.[0]?.jav?.code || '').trim()
  const hasScrapeOverride = Boolean(String(video?.jav_scrape_override || '').trim())
  const canOpenFile = Boolean(onOpenFile)
  const canRevealFile = Boolean(onRevealFile)
  const thumbnailVersion = encodeURIComponent(
    [video?.cover_screenshot_name || '', video?.updated_at || ''].join('|')
  )
  const thumbnailSrc = `/videos/${video.id}/thumbnail${thumbnailVersion ? `?v=${thumbnailVersion}` : ''}`

  const handleOpenFile = async (event) => {
    event.stopPropagation()
    if (!canOpen) return
    try {
      await onOpenFile?.(video)
    } catch (err) {
      console.error(zh('打开文件失败', 'Open file failed'), err)
    }
  }

  const handleRevealFile = async (event) => {
    event.stopPropagation()
    if (!canOpen) return
    try {
      if (onRevealFile) {
        await onRevealFile(video)
      } else {
        await revealVideoLocation({ path: videoPath, dirPath: directoryPath })
      }
    } catch (err) {
      console.error(zh('打开所在位置失败', 'Reveal file failed'), err)
    }
  }

  const handleOpenScreenshots = (event) => {
    event.stopPropagation()
    onOpenScreenshots?.(video)
  }

  const handleOpenScrapeSettings = (event) => {
    event.stopPropagation()
    onOpenScrapeSettings?.(video)
  }

  const openEditMenu = (event) => {
    event.stopPropagation()
    setEditAnchorEl(event.currentTarget)
  }

  const closeEditMenu = () => {
    setEditAnchorEl(null)
  }

  const handleRename = (event) => {
    event.stopPropagation()
    closeEditMenu()
    onRenameVideo?.(video)
  }

  const handleDelete = (event) => {
    event.stopPropagation()
    closeEditMenu()
    onDeleteVideo?.(video)
  }

  return (
    <div
      className={`card-hover-scope video-card group relative overflow-hidden rounded-xl border bg-white shadow transition-all ${
        checked ? 'border-sky-400 ring-2 ring-sky-200' : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      {showSelection ? (
        <div className={`video-card-select ${checked ? 'is-visible' : ''}`}>
          <input
            id={inputId}
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            className="video-select-check"
            onClick={(e) => e.stopPropagation()}
            onPointerUp={(e) => {
              e.currentTarget.blur()
            }}
            aria-label={zh(`选择 ${displayName}`, `Select ${displayName}`)}
          />
        </div>
      ) : null}
      <div className="relative aspect-video w-full overflow-hidden bg-gray-200">
        <img
          src={thumbnailSrc}
          alt={displayName}
          className="h-full w-full object-cover"
          loading="lazy"
          onLoad={(e) => {
            e.currentTarget.style.display = ''
          }}
          onError={(e) => {
            e.currentTarget.style.display = 'none'
          }}
        />
        {javCode ? (
          <div
            className="absolute right-2 top-2 z-10 max-w-[calc(100%-1rem)] truncate rounded bg-black/70 px-2 py-1 text-xs text-white"
            title={zh(`已刮削：${javCode}`, `Scraped: ${javCode}`)}
          >
            {zh(`已刮削 ${javCode}`, `Scraped ${javCode}`)}
          </div>
        ) : null}
        <div className="card-hover-focus-visible absolute bottom-2 left-2 z-10 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={handleOpenScreenshots}
            title={zh('查看截图', 'View screenshots')}
            aria-label={zh('查看截图', 'View screenshots')}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-black/70 text-white shadow-lg shadow-black/60 hover:bg-black/85"
          >
            <PhotoLibraryOutlinedIcon className="h-5 w-5 text-white" fontSize="inherit" />
          </button>
        </div>
      </div>

      <div className="p-3">
        <div className="flex items-center gap-2">
          <div
            className="line-clamp-2 text-[11px] font-medium leading-snug sm:text-xs"
            title={displayName}
          >
            {displayName}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <span className="inline-flex h-4 items-center rounded bg-gray-100 px-1 text-[10px] font-medium text-gray-700">
            {durationMinutes
              ? zh(`${durationMinutes} 分钟`, `${durationMinutes} min`)
              : zh('时长未知', 'Unknown duration')}
          </span>
          {resolution ? (
            <span className="inline-flex h-4 items-center rounded bg-gray-100 px-1 text-[10px] font-medium text-gray-700">
              {resolution}
            </span>
          ) : null}
          {sizeText ? (
            <span className="inline-flex h-4 items-center rounded bg-gray-100 px-1 text-[10px] font-medium text-gray-700">
              {sizeText}
            </span>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {video.tags?.length
            ? video.tags.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="inline-flex h-4 items-center justify-center rounded bg-orange-300 px-1 text-[10px] font-semibold text-black"
                  onClick={(e) => {
                    e.stopPropagation()
                    onTagClick?.(t.name)
                  }}
                >
                  {t.name}
                </button>
              ))
            : null}
          {showTagEditor ? (
            <Tooltip title={zh('修改标签', 'Edit tags')}>
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenTagPicker()
                }}
                aria-label={zh('修改标签', 'Edit tags')}
                className="h-6 w-6"
              >
                <LocalOfferOutlinedIcon fontSize="inherit" />
              </IconButton>
            </Tooltip>
          ) : null}
          {canOpenFile ? (
            <Tooltip title={openFileLabel || zh('用默认程序打开', 'Open with default app')}>
              <IconButton
                size="small"
                onClick={handleOpenFile}
                disabled={!canOpen}
                aria-label={openFileLabel || zh('打开文件', 'Open file')}
                className="h-6 w-6"
              >
                <PlayArrowIcon fontSize="inherit" />
              </IconButton>
            </Tooltip>
          ) : null}
          {canRevealFile ? (
            <Tooltip
              title={
                <span className="whitespace-normal break-all">
                  {zh(`打开所在位置：${displayPath}`, `Reveal in folder: ${displayPath}`)}
                </span>
              }
            >
              <IconButton
                size="small"
                onClick={handleRevealFile}
                disabled={!canOpen}
                aria-label={zh('打开所在位置', 'Reveal in folder')}
                className="h-6 w-6"
              >
                <FolderOpenIcon fontSize="inherit" />
              </IconButton>
            </Tooltip>
          ) : null}
          <Tooltip title={zh('编辑视频', 'Edit video')}>
            <IconButton
              size="small"
              onClick={openEditMenu}
              aria-label={zh('编辑视频', 'Edit video')}
              className="h-6 w-6"
            >
              <MovieEdit fontSize="inherit" />
            </IconButton>
          </Tooltip>
          <Tooltip title={zh('刮削设置', 'Scrape settings')}>
            <IconButton
              size="small"
              onClick={handleOpenScrapeSettings}
              aria-label={zh('刮削设置', 'Scrape settings')}
              className={`h-6 w-6 ${hasScrapeOverride ? 'text-blue-700' : ''}`}
            >
              <ManageSearchIcon fontSize="inherit" />
            </IconButton>
          </Tooltip>
          <Popover
            open={Boolean(editAnchorEl)}
            anchorEl={editAnchorEl}
            onClose={closeEditMenu}
            disableScrollLock
            anchorOrigin={{ vertical: 'center', horizontal: 'right' }}
            transformOrigin={{ vertical: 'center', horizontal: 'left' }}
          >
            <div className="flex min-w-[112px] flex-col p-1">
              <button
                type="button"
                onClick={handleRename}
                className="inline-flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50"
              >
                <DriveFileRenameOutlineIcon className="h-4 w-4" fontSize="inherit" />
                <span>{zh('重命名', 'Rename')}</span>
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="inline-flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-red-600 hover:bg-red-50"
              >
                <DeleteOutlineIcon className="h-4 w-4" fontSize="inherit" />
                <span>{zh('删除', 'Delete')}</span>
              </button>
            </div>
          </Popover>
        </div>
      </div>

      <div className="card-hover-focus-visible pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={(e) => {
            e.stopPropagation()
            e.currentTarget.blur()
            onPlay(video)
          }}
          onPointerUp={(e) => {
            e.currentTarget.blur()
          }}
          className="pointer-events-auto rounded-full bg-black/60 p-3 hover:bg-black/80"
          aria-label={zh('播放', 'Play')}
          title={zh('播放', 'Play')}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-10 w-10"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
      </div>
    </div>
  )
}
