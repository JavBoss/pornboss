import { useEffect, useState } from 'react'
import BuildRoundedIcon from '@mui/icons-material/BuildRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import { CircularProgress, IconButton, Switch, Tooltip } from '@mui/material'

import DirectoryPickerModal from '@/components/DirectoryPickerModal'
import AppModal from '@/components/AppModal'
import { useStore } from '@/store'
import { apiHostPath, displayHostPath, hostPathsEnabled } from '@/utils/hostPath'
import { zh } from '@/utils/i18n'
import { getErrorMessage } from '@/utils/errors'

const DIRECTORY_PROCESS_SIDECAR = 'sidecar'
const DIRECTORY_PROCESS_ORGANIZE = 'organize'
const DIRECTORY_PROCESS_ORGANIZE_WITH_SIDECAR = 'organize_with_sidecar'
const DIRECTORY_PROCESS_LAYOUT_PREFIX = 'prefix'
const DIRECTORY_PROCESS_LAYOUT_CODE = 'code'
const DIRECTORY_PROCESS_LAYOUT_IDOL = 'idol'

const directoryProcessOptions = () => [
  {
    mode: DIRECTORY_PROCESS_SIDECAR,
    title: zh('仅生成 NFO 和封面', 'Generate NFO and covers only'),
    description: zh(
      '在视频旁生成媒体库可用的 NFO 和封面，不移动视频。',
      'Generate media-library-compatible NFO files and covers beside each video without moving it.'
    ),
  },
  {
    mode: DIRECTORY_PROCESS_ORGANIZE,
    title: zh('仅整理目录', 'Organize only'),
    description: zh(
      '按照选择的整理方式移动视频，保留原文件名，不生成 NFO 和封面。',
      'Move videos using the selected layout, preserve filenames, and do not generate NFO files or covers.'
    ),
  },
  {
    mode: DIRECTORY_PROCESS_ORGANIZE_WITH_SIDECAR,
    title: zh('整理并生成 NFO 和封面', 'Organize and generate NFO and covers'),
    description: zh(
      '移动视频及同名附属文件，保留原文件名，然后生成媒体库可用的 NFO 和封面。',
      'Move videos and matching companion files while preserving filenames, then generate media-library-compatible NFO files and covers.'
    ),
  },
]

const directoryProcessLayoutOptions = () => [
  {
    layout: DIRECTORY_PROCESS_LAYOUT_PREFIX,
    title: zh('按番号前缀', 'By code prefix'),
    example: 'JAV/IPX/IPX-001/...',
  },
  {
    layout: DIRECTORY_PROCESS_LAYOUT_CODE,
    title: zh('按完整番号', 'By complete code'),
    example: 'JAV/IPX-001/...',
  },
  {
    layout: DIRECTORY_PROCESS_LAYOUT_IDOL,
    title: zh('按女优', 'By idol'),
    example: zh('JAV/女优名/IPX-001/...', 'JAV/IDOL NAME/IPX-001/...'),
  },
]

const formatScanFinishedAt = (summary) => {
  const timestamp = Number(summary?.finished_at_unix_ms)
  if (!Number.isFinite(timestamp) || timestamp <= 0) return ''
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(zh('zh-CN', 'en-US'), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

const formatScanDuration = (summary) => {
  const durationMS = Number(summary?.duration_ms)
  if (!Number.isFinite(durationMS) || durationMS < 1000) {
    return zh('不足 1 秒', 'Less than 1 second')
  }
  const totalSeconds = Math.max(1, Math.round(durationMS / 1000))
  if (totalSeconds < 60) {
    return zh(`${totalSeconds} 秒`, `${totalSeconds} sec`)
  }
  const totalMinutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (totalMinutes < 60) {
    return zh(`${totalMinutes} 分 ${seconds} 秒`, `${totalMinutes} min ${seconds} sec`)
  }
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return zh(`${hours} 小时 ${minutes} 分`, `${hours} hr ${minutes} min`)
}

const formatScanElapsedTime = (elapsedMS) => {
  const value = Number(elapsedMS)
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value / 1000)) : 0
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')
}

const directoryWorkStatus = (directory) =>
  directory?.work_status || (directory?.is_scanning ? 'scanning' : 'idle')

const directoryWorkStatusDisplay = (status) => {
  switch (status) {
    case 'scanning':
      return {
        label: zh('当前状态：扫描中', 'Status: Scanning'),
        badge: 'bg-blue-50 text-blue-700',
        dot: 'animate-pulse bg-blue-500',
      }
    case 'organizing':
      return {
        label: zh('当前状态：整理中', 'Status: Organizing'),
        badge: 'bg-amber-50 text-amber-700',
        dot: 'animate-pulse bg-amber-500',
      }
    case 'generating_sidecar':
      return {
        label: zh('当前状态：生成 NFO 和封面中', 'Status: Generating NFO and covers'),
        badge: 'bg-violet-50 text-violet-700',
        dot: 'animate-pulse bg-violet-500',
      }
    case 'organizing_with_sidecar':
      return {
        label: zh(
          '当前状态：整理并生成 NFO 和封面中',
          'Status: Organizing and generating NFO and covers'
        ),
        badge: 'bg-amber-50 text-amber-700',
        dot: 'animate-pulse bg-amber-500',
      }
    default:
      return {
        label: zh('当前状态：空闲', 'Status: Idle'),
        badge: 'bg-zinc-100 text-zinc-600',
        dot: 'bg-zinc-400',
      }
  }
}

function DirectoryRowIconButton({ label, disabled = false, children, ...props }) {
  return (
    <Tooltip title={label} arrow>
      <span className="inline-flex">
        <IconButton
          {...props}
          type="button"
          size="small"
          disabled={disabled}
          aria-label={label}
          className="!h-7 !w-7 !rounded-md !p-1 disabled:!opacity-60"
          sx={{
            border: '1px solid',
            borderColor: 'grey.300',
            backgroundColor: 'common.white',
            color: 'grey.800',
            '& .MuiSvgIcon-root': { fontSize: 18 },
            '&:hover': {
              borderColor: 'grey.500',
              backgroundColor: 'grey.100',
              color: 'common.black',
            },
            '&.Mui-disabled': {
              borderColor: 'grey.200',
              backgroundColor: 'common.white',
            },
          }}
        >
          {children}
        </IconButton>
      </span>
    </Tooltip>
  )
}

export default function DirectoryManager({
  open,
  directories,
  onCreate,
  onUpdate,
  onDelete,
  onProcess,
  onScan,
  onRefresh,
  directoryPickerEnabled = true,
  serverOS = '',
}) {
  const useHostPaths = useStore((state) => hostPathsEnabled(state.config))
  const [path, setPath] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [pickerTarget, setPickerTarget] = useState(null)
  const picking = pickerTarget !== null
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)

  const [editId, setEditId] = useState(null)
  const [editPath, setEditPath] = useState('')
  const [rowErrorId, setRowErrorId] = useState(null)
  const [rowErrorMsg, setRowErrorMsg] = useState('')
  const [savingId, setSavingId] = useState(null)
  const [savingEnabledId, setSavingEnabledId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [processingId, setProcessingId] = useState(null)
  const [scanningId, setScanningId] = useState(null)
  const [scanSettingsDirectory, setScanSettingsDirectory] = useState(null)
  const [scanSettingsEnabled, setScanSettingsEnabled] = useState(true)
  const [scanSettingsIntervalMinutes, setScanSettingsIntervalMinutes] = useState('1')
  const [savingScanSettingsId, setSavingScanSettingsId] = useState(null)
  const [scanSettingsError, setScanSettingsError] = useState('')
  const [toolDirectory, setToolDirectory] = useState(null)
  const [toolMode, setToolMode] = useState(DIRECTORY_PROCESS_SIDECAR)
  const [toolLayout, setToolLayout] = useState(DIRECTORY_PROCESS_LAYOUT_PREFIX)
  const pathExample = {
    windows: 'D:\\Videos',
    darwin: '/Volumes/Videos',
    linux: '/mnt/videos',
  }[serverOS]
  const pathPlaceholder = useHostPaths
    ? zh(
        '输入宿主机目录路径，例如 /mnt/disk1/videos',
        'Enter a host folder path, e.g. /mnt/disk1/videos'
      )
    : pathExample
      ? zh(`输入目录路径，例如 ${pathExample}`, `Enter a folder path, e.g. ${pathExample}`)
      : zh('输入服务端的完整目录路径', 'Enter the full folder path on the server')
  const pathHelperText = zh(
    directoryPickerEnabled
      ? '建议优先使用“选择目录”，也可以手动输入完整目录路径。'
      : useHostPaths
        ? '请输入宿主机上的完整目录路径，Docker 部署会自动映射到容器内路径。'
        : '请输入容器内可访问的完整目录路径，例如 /media。',
    directoryPickerEnabled
      ? 'Use "Choose directory" when possible, or enter the full folder path manually.'
      : useHostPaths
        ? 'Enter the full host path. Docker deployments map it to the container path automatically.'
        : 'Enter a full path that is accessible inside the container, for example /media.'
  )
  const displayPath = (value) => displayHostPath(value, useHostPaths)
  const apiPath = (value) => apiHostPath(value, useHostPaths)

  useEffect(() => {
    if (open) {
      setPickerTarget(null)
      setPath('')
      setError('')
      setAdding(false)
      setEditId(null)
      setEditPath('')
      setRowErrorId(null)
      setRowErrorMsg('')
      setScanSettingsDirectory(null)
      setScanSettingsError('')
      setToolDirectory(null)
      setToolMode(DIRECTORY_PROCESS_SIDECAR)
      setToolLayout(DIRECTORY_PROCESS_LAYOUT_PREFIX)
    }
  }, [open])

  useEffect(() => {
    if (!toolDirectory) return undefined
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setToolDirectory(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toolDirectory])

  useEffect(() => {
    if (!scanSettingsDirectory) return undefined
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && savingScanSettingsId == null) {
        setScanSettingsDirectory(null)
        setScanSettingsError('')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [savingScanSettingsId, scanSettingsDirectory])

  useEffect(() => {
    if (!open || !onRefresh) return undefined

    let refreshing = false
    const refresh = async () => {
      if (refreshing) return
      refreshing = true
      try {
        await onRefresh()
      } catch {
        // Keep the last successful counts visible and retry on the next interval.
      } finally {
        refreshing = false
      }
    }

    refresh()
    const timer = window.setInterval(refresh, 1000)
    return () => window.clearInterval(timer)
  }, [onRefresh, open])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!path.trim()) {
      setError(zh('路径不能为空', 'Path cannot be empty'))
      return
    }
    setSubmitting(true)
    try {
      await onCreate?.({ path: apiPath(path) })
      setPath('')
      setAdding(false)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  const startEdit = (dir) => {
    setEditId(dir.id)
    setEditPath(displayPath(dir.path))
    setRowErrorId(null)
    setRowErrorMsg('')
  }

  const cancelEdit = () => {
    setEditId(null)
    setEditPath('')
    setRowErrorId(null)
    setRowErrorMsg('')
  }

  const handleEditSubmit = async (e) => {
    if (e?.preventDefault) e.preventDefault()
    if (!editId) return
    const trimmed = editPath.trim()
    if (!trimmed) {
      setRowErrorId(editId)
      setRowErrorMsg(zh('路径不能为空', 'Path cannot be empty'))
      return
    }
    setSavingId(editId)
    setRowErrorId(null)
    setRowErrorMsg('')
    try {
      const original = directories.find((directory) => directory.id === editId)
      const nextPath = apiPath(trimmed)
      if (original && nextPath === original.path) {
        cancelEdit()
        return
      }
      await onUpdate?.(editId, { path: nextPath })
      cancelEdit()
    } catch (err) {
      setRowErrorId(editId)
      setRowErrorMsg(getErrorMessage(err))
    } finally {
      setSavingId(null)
    }
  }

  const handleDelete = async (dir) => {
    if (!dir?.id || dir.is_delete) return
    const ok = window.confirm(
      zh(
        '删除后将不再扫描该目录，该目录下的文件位置会不可用。确认删除？',
        'This directory will no longer be scanned and file locations under it will become unavailable. Delete it?'
      )
    )
    if (!ok) return
    setRowErrorId(null)
    setRowErrorMsg('')
    setDeletingId(dir.id)
    try {
      await onDelete?.(dir.id)
      if (editId === dir.id) {
        cancelEdit()
      }
    } catch (err) {
      setRowErrorId(dir.id)
      setRowErrorMsg(getErrorMessage(err))
    } finally {
      setDeletingId(null)
    }
  }

  const handleEnabledChange = async (dir, enabled) => {
    if (!dir?.id || dir.is_delete) return
    setSavingEnabledId(dir.id)
    setRowErrorId(null)
    setRowErrorMsg('')
    try {
      await onUpdate?.(dir.id, { enabled })
    } catch (err) {
      setRowErrorId(dir.id)
      setRowErrorMsg(getErrorMessage(err))
    } finally {
      setSavingEnabledId(null)
    }
  }

  const handleProcess = async (dir, mode, layout) => {
    if (!dir?.id || directoryWorkStatus(dir) !== 'idle') return

    setToolDirectory(null)
    setProcessingId(dir.id)
    setRowErrorId(null)
    setRowErrorMsg('')
    try {
      await onProcess?.(dir.id, mode, layout)
    } catch (err) {
      setRowErrorId(dir.id)
      setRowErrorMsg(getErrorMessage(err))
    } finally {
      setProcessingId(null)
    }
  }

  const handleScan = async (dir) => {
    if (!dir?.id || directoryWorkStatus(dir) !== 'idle') return

    setScanningId(dir.id)
    setRowErrorId(null)
    setRowErrorMsg('')
    try {
      await onScan?.(dir.id)
    } catch (err) {
      setRowErrorId(dir.id)
      setRowErrorMsg(getErrorMessage(err))
    } finally {
      setScanningId(null)
    }
  }

  const openScanSettings = (dir) => {
    if (!dir?.id || dir.is_delete) return
    setScanSettingsDirectory(dir)
    setScanSettingsEnabled(dir.auto_scan_enabled !== false)
    setScanSettingsIntervalMinutes(String(Number(dir.auto_scan_interval_minutes) || 1))
    setScanSettingsError('')
    setRowErrorId(null)
    setRowErrorMsg('')
  }

  const handleScanSettingsSubmit = async (event) => {
    event?.preventDefault?.()
    const id = scanSettingsDirectory?.id
    if (!id) return
    const intervalMinutes = Number(scanSettingsIntervalMinutes)
    if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 525600) {
      setScanSettingsError(
        zh(
          '自动扫描周期必须是 1 到 525600 之间的整数分钟',
          'The automatic scan interval must be a whole number between 1 and 525600 minutes'
        )
      )
      return
    }

    setSavingScanSettingsId(id)
    setScanSettingsError('')
    try {
      await onUpdate?.(id, {
        auto_scan_enabled: scanSettingsEnabled,
        auto_scan_interval_minutes: intervalMinutes,
      })
      setScanSettingsDirectory(null)
    } catch (err) {
      setScanSettingsError(getErrorMessage(err))
    } finally {
      setSavingScanSettingsId(null)
    }
  }

  const currentToolDirectory = directories.find((directory) => directory.id === toolDirectory?.id)
  const toolDirectoryWorking =
    processingId === toolDirectory?.id ||
    (currentToolDirectory != null && directoryWorkStatus(currentToolDirectory) !== 'idle')
  const currentScanSettingsDirectory =
    directories.find((directory) => directory.id === scanSettingsDirectory?.id) ||
    scanSettingsDirectory
  const scanSettingsWorkStatus = directoryWorkStatus(currentScanSettingsDirectory)
  const scanSettingsRunning = scanSettingsWorkStatus === 'scanning'

  return (
    <div className="space-y-3">
      {directories.length > 0 && (
        <div className="divide-y rounded border">
          {directories.map((d) => {
            const isEditing = editId === d.id
            const status = directoryWorkStatus(d)
            const statusDisplay = directoryWorkStatusDisplay(status)
            const lastScanFinishedAt = formatScanFinishedAt(d.last_scan_summary)
            const autoScanIntervalMinutes = Math.max(1, Number(d.auto_scan_interval_minutes) || 1)
            const autoScanDisplay =
              d.auto_scan_enabled !== false
                ? zh(
                    `自动扫描：每 ${autoScanIntervalMinutes} 分钟`,
                    `Automatic scan: Every ${autoScanIntervalMinutes} min`
                  )
                : zh('自动扫描：已关闭', 'Automatic scan: Off')
            const working =
              savingId === d.id ||
              savingEnabledId === d.id ||
              deletingId === d.id ||
              processingId === d.id ||
              scanningId === d.id ||
              status !== 'idle'
            return (
              <div
                key={d.id}
                className={`relative flex flex-col gap-2 p-3 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-x-4 ${
                  isEditing ? 'rounded border bg-gray-50' : ''
                }`}
              >
                <div className="min-w-0 space-y-1 pr-12 md:pr-0">
                  {!isEditing ? (
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="min-w-0 truncate text-sm font-medium">
                        {displayPath(d.path)}
                      </div>
                    </div>
                  ) : (
                    <form onSubmit={handleEditSubmit} className="space-y-2">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <input
                          value={editPath}
                          onChange={(e) => setEditPath(e.target.value)}
                          className="w-full rounded border px-3 py-2 text-sm sm:min-w-[420px] sm:flex-1"
                          placeholder={pathPlaceholder}
                        />
                        {directoryPickerEnabled ? (
                          <button
                            type="button"
                            onClick={() => {
                              setRowErrorId(null)
                              setRowErrorMsg('')
                              setPickerTarget('edit')
                            }}
                            disabled={picking || working}
                            className="rounded border px-3 py-2 text-sm hover:bg-gray-100 disabled:opacity-60"
                          >
                            {picking
                              ? zh('选择中…', 'Picking...')
                              : zh('选择目录', 'Choose directory')}
                          </button>
                        ) : null}
                      </div>
                      <div className="text-xs text-blue-700">{pathHelperText}</div>
                    </form>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    {!isEditing && (
                      <div className="flex items-center divide-x divide-zinc-200 text-xs text-zinc-500">
                        {status === 'scanning' && (
                          <span
                            className="pr-3"
                            title={zh(
                              '本轮已遍历的文件数，包含非视频文件，不含文件夹',
                              'Files visited in this scan, including non-video files and excluding folders'
                            )}
                          >
                            {zh('已扫描文件', 'Scanned files')}{' '}
                            <strong className="font-semibold tabular-nums text-zinc-800">
                              {Number(d.scanned_file_count) || 0}
                            </strong>
                          </span>
                        )}
                        <span className={status === 'scanning' ? 'px-3' : 'pr-3'}>
                          {zh('已扫描视频', 'Scanned videos')}{' '}
                          <strong className="font-semibold tabular-nums text-zinc-800">
                            {Number(d.scanned_video_count) || 0}
                          </strong>
                        </span>
                        <span className="pl-3">
                          {zh('已刮削视频', 'Scraped videos')}{' '}
                          <strong className="font-semibold tabular-nums text-zinc-800">
                            {Number(d.scraped_video_count) || 0}
                          </strong>
                        </span>
                      </div>
                    )}
                    {!isEditing && (
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusDisplay.badge}`}
                      >
                        <span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${statusDisplay.dot}`} />
                        {statusDisplay.label}
                        {status === 'scanning' && (
                          <span className="ml-1.5 tabular-nums">
                            {formatScanElapsedTime(d.scan_elapsed_ms)}
                          </span>
                        )}
                      </span>
                    )}
                    {d.missing && (
                      <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                        {zh('目录缺失', 'Missing')}
                      </span>
                    )}
                    {d.is_delete && (
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                        {zh('已删除', 'Deleted')}
                      </span>
                    )}
                  </div>
                  {!isEditing && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
                      <div className="flex items-center">
                        <span>{zh('上次扫描：', 'Last scan:')}</span>
                        <Tooltip
                          arrow
                          describeChild
                          slotProps={{ tooltip: { sx: { maxWidth: 'none' } } }}
                          title={
                            lastScanFinishedAt ? (
                              <div className="whitespace-nowrap py-1 text-xs">
                                {zh('结束时间：', 'Finished at: ')}
                                <span className="tabular-nums">{lastScanFinishedAt}</span>
                                <span className="mx-2" aria-hidden="true">
                                  ·
                                </span>
                                {zh('耗时：', 'Duration: ')}
                                {formatScanDuration(d.last_scan_summary)}
                              </div>
                            ) : (
                              zh('暂无扫描记录', 'No scan record')
                            )
                          }
                        >
                          <IconButton
                            type="button"
                            size="small"
                            aria-label={zh('上次扫描详情', 'Last scan details')}
                            className="!-ml-1.5 !h-6 !w-6 !p-0.5 !text-zinc-500 hover:!bg-zinc-100 hover:!text-zinc-900"
                          >
                            <InfoOutlinedIcon sx={{ fontSize: 15 }} />
                          </IconButton>
                        </Tooltip>
                      </div>
                      <div className="flex shrink-0 items-center gap-1 text-xs font-normal text-zinc-500">
                        <span>{autoScanDisplay}</span>
                        <Tooltip title={zh('编辑扫描设置', 'Edit scan settings')} arrow>
                          <span className="inline-flex">
                            <IconButton
                              type="button"
                              size="small"
                              onClick={() => openScanSettings(d)}
                              disabled={d.is_delete || savingScanSettingsId === d.id}
                              aria-label={zh('编辑扫描设置', 'Edit scan settings')}
                              className="!h-6 !w-6 !p-0.5 !text-zinc-500 hover:!bg-zinc-100 hover:!text-zinc-900 disabled:!opacity-60"
                            >
                              {savingScanSettingsId === d.id ? (
                                <CircularProgress size={13} color="inherit" />
                              ) : (
                                <SettingsRoundedIcon sx={{ fontSize: 15 }} />
                              )}
                            </IconButton>
                          </span>
                        </Tooltip>
                      </div>
                    </div>
                  )}
                  {rowErrorId === d.id && rowErrorMsg && (
                    <div className="text-xs text-red-600">{rowErrorMsg}</div>
                  )}
                </div>
                <div className="contents md:flex md:flex-col md:items-end md:gap-2">
                  <label
                    className="absolute right-2 top-2 flex items-center gap-1 text-xs text-zinc-600 md:static"
                    title={zh(
                      '是否显示此目录里的内容',
                      'Whether to show content from this directory'
                    )}
                  >
                    <span>{zh('启用', 'Enabled')}</span>
                    <Switch
                      size="small"
                      checked={d.enabled !== false}
                      onChange={(event) => handleEnabledChange(d, event.target.checked)}
                      disabled={d.is_delete || savingEnabledId === d.id}
                      inputProps={{
                        'aria-label': zh(
                          '是否显示此目录里的内容',
                          'Whether to show content from this directory'
                        ),
                      }}
                    />
                  </label>
                  <div className="mt-2 flex w-full flex-nowrap items-center justify-end gap-2 overflow-x-auto whitespace-nowrap pb-1 md:w-auto md:overflow-visible [&>button]:shrink-0 [&>span]:shrink-0">
                    {!isEditing ? (
                      <>
                        {scanningId !== d.id && status !== 'scanning' && (
                          <DirectoryRowIconButton
                            label={zh(
                              '手动扫描（点击立刻进行一次目录扫描和 JAV 刮削）',
                              'Manual scan (click to immediately scan the directory and scrape JAV metadata)'
                            )}
                            onClick={() => handleScan(d)}
                            disabled={d.is_delete || working}
                          >
                            <PlayArrowRoundedIcon fontSize="small" />
                          </DirectoryRowIconButton>
                        )}
                        <DirectoryRowIconButton
                          label={zh('工具', 'Tools')}
                          onClick={() => {
                            setToolDirectory(d)
                            setToolMode(DIRECTORY_PROCESS_SIDECAR)
                            setToolLayout(DIRECTORY_PROCESS_LAYOUT_PREFIX)
                            setRowErrorId(null)
                            setRowErrorMsg('')
                          }}
                          disabled={d.is_delete || working}
                        >
                          {processingId === d.id ? (
                            <CircularProgress size={16} color="inherit" />
                          ) : (
                            <BuildRoundedIcon fontSize="small" />
                          )}
                        </DirectoryRowIconButton>
                        <DirectoryRowIconButton
                          label={zh('编辑', 'Edit')}
                          onClick={() => startEdit(d)}
                          disabled={d.is_delete || working}
                        >
                          <EditRoundedIcon fontSize="small" />
                        </DirectoryRowIconButton>
                        <DirectoryRowIconButton
                          label={
                            deletingId === d.id
                              ? zh('删除中…', 'Deleting...')
                              : zh('删除', 'Delete')
                          }
                          onClick={() => handleDelete(d)}
                          disabled={d.is_delete || working}
                        >
                          {deletingId === d.id ? (
                            <CircularProgress size={16} color="inherit" />
                          ) : (
                            <DeleteOutlineRoundedIcon fontSize="small" />
                          )}
                        </DirectoryRowIconButton>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={handleEditSubmit}
                          disabled={working}
                          className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white disabled:opacity-60"
                        >
                          {savingId === d.id ? zh('保存中…', 'Saving...') : zh('保存', 'Save')}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={working}
                          className="rounded border px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                        >
                          {zh('取消', 'Cancel')}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {adding && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-2 rounded border bg-gray-50 p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              id="dir-path-input"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder={pathPlaceholder}
              className="flex-1 rounded border px-3 py-2"
            />
            {directoryPickerEnabled ? (
              <button
                type="button"
                onClick={() => {
                  setError('')
                  setPickerTarget('add')
                }}
                disabled={picking || submitting}
                className="rounded border px-3 py-2 text-sm hover:bg-gray-100 disabled:opacity-60"
              >
                {picking ? zh('选择中…', 'Picking...') : zh('选择目录', 'Choose directory')}
              </button>
            ) : null}
          </div>
          <div className="text-xs text-blue-700">{pathHelperText}</div>
          {error && <div className="text-sm text-red-600">{error}</div>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setAdding(false)
                setPath('')
                setError('')
              }}
              className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              {zh('取消', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting || picking}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-60"
            >
              {submitting ? zh('创建中…', 'Creating...') : zh('保存', 'Save')}
            </button>
          </div>
        </form>
      )}
      {!adding && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              setAdding(true)
              setError('')
            }}
            className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            {zh('添加目录', 'Add Directory')}
          </button>
        </div>
      )}
      {toolDirectory && (
        <AppModal
          ariaLabelledby="directory-tools-title"
          className="p-4"
          closeDisabled={toolDirectoryWorking}
          contentClassName="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl"
          onClose={() => setToolDirectory(null)}
          zIndex={1400}
        >
          <div id="directory-tools-title" className="text-base font-semibold text-zinc-900">
            {zh('目录工具', 'Directory Tools')}
          </div>
          <div className="mt-1 truncate text-xs text-zinc-500">
            {displayPath(toolDirectory.path)}
          </div>
          <div className="mt-4 space-y-2">
            {directoryProcessOptions().map((option) => (
              <label
                key={option.mode}
                htmlFor={`directory-process-${option.mode}`}
                aria-label={option.title}
                className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition ${
                  toolMode === option.mode
                    ? 'border-blue-400 bg-blue-50'
                    : 'border-zinc-200 hover:bg-zinc-50'
                }`}
              >
                <input
                  id={`directory-process-${option.mode}`}
                  type="radio"
                  name="directory-process-mode"
                  value={option.mode}
                  checked={toolMode === option.mode}
                  onChange={() => setToolMode(option.mode)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm font-medium text-zinc-900">{option.title}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-zinc-600">
                    {option.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {toolMode !== DIRECTORY_PROCESS_SIDECAR && (
            <div className="mt-4">
              <div className="text-sm font-medium text-zinc-900">
                {zh('整理方式', 'Organization layout')}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {directoryProcessLayoutOptions().map((option) => (
                  <label
                    key={option.layout}
                    htmlFor={`directory-process-layout-${option.layout}`}
                    className={`min-w-0 cursor-pointer rounded-xl border p-3 transition ${
                      toolLayout === option.layout
                        ? 'border-blue-400 bg-blue-50'
                        : 'border-zinc-200 hover:bg-zinc-50'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        id={`directory-process-layout-${option.layout}`}
                        type="radio"
                        name="directory-process-layout"
                        value={option.layout}
                        checked={toolLayout === option.layout}
                        onChange={() => setToolLayout(option.layout)}
                      />
                      <span className="text-sm font-medium text-zinc-900">{option.title}</span>
                    </span>
                    <span className="mt-1 block whitespace-nowrap text-[10px] text-zinc-500">
                      {option.example}
                    </span>
                  </label>
                ))}
              </div>
              {toolLayout === DIRECTORY_PROCESS_LAYOUT_IDOL && (
                <div className="mt-2 text-xs leading-5 text-zinc-500">
                  {zh(
                    '最多拼接 3 位女优名；超过 3 位时统一归入“多女优”，没有女优信息时归入“未知女优”。',
                    'Up to 3 sorted idol names are joined with "，". Works with more than 3 idols go under "多女优", and works without idol metadata go under "未知女优".'
                  )}
                </div>
              )}
            </div>
          )}
          {toolMode !== DIRECTORY_PROCESS_SIDECAR && (
            <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
              {zh(
                '整理后的文件统一位于 “所选目录/JAV” 中。任务完成后，会生成 “所选目录/JavBoss-整理报告.txt”，可查看未整理文件及失败原因。',
                'Organized files are stored in “selected directory/JAV”. When the task finishes, “selected directory/JavBoss-整理报告.txt” is generated so you can review files that were not organized and the reasons.'
              )}
            </div>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setToolDirectory(null)}
              className="rounded border px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              {zh('取消', 'Cancel')}
            </button>
            <button
              type="button"
              onClick={() => handleProcess(toolDirectory, toolMode, toolLayout)}
              disabled={toolDirectoryWorking}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {zh('执行', 'Run')}
            </button>
          </div>
        </AppModal>
      )}
      {scanSettingsDirectory && (
        <AppModal
          ariaLabelledby="directory-scan-settings-title"
          className="p-4"
          closeDisabled={savingScanSettingsId != null}
          contentClassName="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
          contentComponent="form"
          contentProps={{ onSubmit: handleScanSettingsSubmit }}
          onClose={() => {
            setScanSettingsDirectory(null)
            setScanSettingsError('')
          }}
          zIndex={1410}
        >
          <div id="directory-scan-settings-title" className="text-base font-semibold text-zinc-900">
            {zh('扫描设置', 'Scan Settings')}
          </div>
          <div
            title={displayPath(currentScanSettingsDirectory.path)}
            className="mt-2 truncate rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500"
          >
            {displayPath(currentScanSettingsDirectory.path)}
          </div>
          <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200">
            <label
              aria-label={zh('自动扫描', 'Automatic scan')}
              className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3"
            >
              <span>
                <span className="block text-sm font-medium text-zinc-900">
                  {zh('自动扫描', 'Automatic scan')}
                </span>
                <span className="mt-0.5 block text-xs text-zinc-500">
                  {scanSettingsEnabled
                    ? zh(
                        '按指定间隔进行目录扫描和 JAV 刮削',
                        'Scan the directory and scrape JAV metadata at the specified interval'
                      )
                    : zh('已关闭，可使用手动扫描', 'Off; manual scans remain available')}
                </span>
              </span>
              <input
                type="checkbox"
                checked={scanSettingsEnabled}
                onChange={(event) => setScanSettingsEnabled(event.target.checked)}
                className="peer sr-only"
              />
              <span className="relative h-6 w-11 shrink-0 rounded-full bg-zinc-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-blue-600 peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500 peer-focus-visible:ring-offset-2" />
            </label>
            {scanSettingsEnabled && (
              <label className="flex items-center gap-2 border-t border-zinc-200 px-4 py-3 text-sm text-zinc-700">
                <span>{zh('扫描间隔：', 'Scan interval:')}</span>
                <input
                  type="number"
                  min="1"
                  max="525600"
                  step="1"
                  value={scanSettingsIntervalMinutes}
                  onChange={(event) => setScanSettingsIntervalMinutes(event.target.value)}
                  className="w-24 rounded-lg border border-zinc-300 px-3 py-1.5 text-center font-medium tabular-nums text-zinc-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
                <span>{zh('分钟', 'minutes')}</span>
              </label>
            )}
          </div>
          {scanSettingsRunning && (
            <div className="mt-3 flex items-center gap-2 text-xs text-blue-700">
              <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-blue-500" />
              <span>
                {zh(
                  '当前进行中的扫描会持续到结束，不受此次修改影响。',
                  'The scan currently in progress will continue until completion and will not be affected by this change.'
                )}
              </span>
            </div>
          )}
          {scanSettingsError && (
            <div className="mt-3 text-sm text-red-600">{scanSettingsError}</div>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setScanSettingsDirectory(null)
                setScanSettingsError('')
              }}
              disabled={savingScanSettingsId != null}
              className="rounded border px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
            >
              {zh('取消', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={savingScanSettingsId != null}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {savingScanSettingsId != null ? zh('保存中…', 'Saving...') : zh('保存', 'Save')}
            </button>
          </div>
        </AppModal>
      )}
      {open && pickerTarget && (
        <DirectoryPickerModal
          initialPath={pickerTarget === 'edit' ? editPath : path}
          onClose={() => setPickerTarget(null)}
          onSelect={(selectedPath) => {
            if (pickerTarget === 'edit') setEditPath(displayPath(selectedPath))
            else setPath(displayPath(selectedPath))
            setPickerTarget(null)
          }}
        />
      )}
    </div>
  )
}
