import { useCallback, useEffect, useMemo, useState } from 'react'
import AddOutlinedIcon from '@mui/icons-material/AddOutlined'
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined'
import CheckOutlinedIcon from '@mui/icons-material/CheckOutlined'
import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined'
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined'
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined'
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined'
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined'
import ReplayOutlinedIcon from '@mui/icons-material/ReplayOutlined'
import AppModal from '@/components/AppModal'
import {
  cancelDownloadJob,
  createDownloadJob,
  deleteDownloadJob,
  fetchDownloadJobs,
  revealDownloadLocation,
  retryDownloadJob,
} from '@/api'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'

const statusLabels = {
  queued: ['等待处理', 'Queued'],
  offline_downloading: ['云端离线中', 'Offline downloading'],
  resolving_files: ['正在解析文件', 'Resolving files'],
  waiting_local_download: ['等待本地下载', 'Waiting for local download'],
  local_downloading: ['正在下载到本地', 'Downloading locally'],
  completed: ['已完成', 'Completed'],
  failed: ['失败', 'Failed'],
  canceled: ['已取消', 'Canceled'],
}

const activeStatuses = new Set([
  'queued',
  'offline_downloading',
  'resolving_files',
  'waiting_local_download',
  'local_downloading',
])

function formatBytes(value) {
  let bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let index = 0
  while (bytes >= 1024 && index < units.length - 1) {
    bytes /= 1024
    index += 1
  }
  return `${bytes.toFixed(index >= 3 ? 2 : 1)} ${units[index]}`
}

function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function statusLabel(status) {
  const labels = statusLabels[status] || [status, status]
  return zh(labels[0], labels[1])
}

function parentPath(value) {
  const path = String(value || '').trim()
  const separatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return separatorIndex > 0 ? path.slice(0, separatorIndex) : path
}

function normalizedPath(value) {
  return String(value || '')
    .replaceAll('\\', '/')
    .replace(/\/+$/, '')
    .toLowerCase()
}

function commonParentPath(files) {
  const parents = files.map(parentPath)
  const parts = parents.map((path) => path.replaceAll('\\', '/').split('/'))
  let commonLength = parts[0]?.length || 0
  for (const current of parts.slice(1)) {
    commonLength = Math.min(commonLength, current.length)
    let index = 0
    while (index < commonLength && parts[0][index].toLowerCase() === current[index].toLowerCase()) {
      index += 1
    }
    commonLength = index
  }
  const separator = parents[0]?.includes('\\') ? '\\' : '/'
  return parts[0]?.slice(0, commonLength).join(separator) || ''
}

function downloadLocation(job) {
  const root = String(job?.directory_path || '').trim()
  const files = Array.isArray(job?.local_files)
    ? job.local_files.map((path) => String(path || '').trim()).filter(Boolean)
    : []
  if (files.length === 0) return root
  if (files.length === 1) return files[0]

  const commonParent = commonParentPath(files)
  if (commonParent && normalizedPath(commonParent) !== normalizedPath(root)) {
    return commonParent
  }
  return files.join('、')
}

async function copyText(value) {
  if (!value) throw new Error(zh('磁力链接不可用', 'Magnet link is unavailable'))
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      // Fall back for browsers that expose the API but deny it outside a secure context.
    }
  }
  const input = document.createElement('textarea')
  input.value = value
  input.setAttribute('readonly', '')
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.appendChild(input)
  input.select()
  const copied = document.execCommand('copy')
  input.remove()
  if (!copied) throw new Error(zh('复制磁力链接失败', 'Failed to copy magnet link'))
}

export default function DownloadsView() {
  const [jobs, setJobs] = useState([])
  const [magnetUrl, setMagnetUrl] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createError, setCreateError] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [busyJobIds, setBusyJobIds] = useState(() => new Set())
  const [copiedJobId, setCopiedJobId] = useState(null)
  const [error, setError] = useState('')

  const loadJobs = useCallback(async () => {
    const payload = await fetchDownloadJobs()
    setJobs(Array.isArray(payload?.items) ? payload.items : [])
  }, [])

  useEffect(() => {
    let cancelled = false
    loadJobs()
      .catch((loadError) => {
        if (!cancelled) setError(getErrorMessage(loadError))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [loadJobs])

  useEffect(() => {
    const timer = window.setInterval(() => loadJobs().catch(() => {}), 3000)
    return () => window.clearInterval(timer)
  }, [loadJobs])

  const counts = useMemo(() => {
    let active = 0
    let failed = 0
    let completed = 0
    jobs.forEach((job) => {
      if (activeStatuses.has(job.status)) active += 1
      else if (job.status === 'failed') failed += 1
      else if (job.status === 'completed') completed += 1
    })
    return { active, failed, completed }
  }, [jobs])

  const runJobAction = async (job, action) => {
    setBusyJobIds((current) => new Set(current).add(job.id))
    setError('')
    try {
      await action(job.id)
      await loadJobs()
    } catch (actionError) {
      setError(getErrorMessage(actionError))
    } finally {
      setBusyJobIds((current) => {
        const next = new Set(current)
        next.delete(job.id)
        return next
      })
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    const value = magnetUrl.trim()
    if (!value) return
    setSubmitting(true)
    setCreateError('')
    try {
      await createDownloadJob({ magnetUrl: value })
      setMagnetUrl('')
      setCreateOpen(false)
      await loadJobs().catch((loadError) => setError(getErrorMessage(loadError)))
    } catch (submitError) {
      setCreateError(getErrorMessage(submitError))
    } finally {
      setSubmitting(false)
    }
  }

  const openCreateModal = () => {
    setError('')
    setCreateError('')
    setCreateOpen(true)
  }

  const closeCreateModal = () => {
    if (submitting) return
    setCreateOpen(false)
    setCreateError('')
  }

  const handleCopyMagnet = async (job) => {
    setError('')
    try {
      await copyText(job.magnet_url)
      setCopiedJobId(job.id)
      window.setTimeout(() => {
        setCopiedJobId((current) => (current === job.id ? null : current))
      }, 1500)
    } catch (copyError) {
      setError(getErrorMessage(copyError))
    }
  }

  return (
    <div className="space-y-5">
      {error ? (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <section>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-gray-500">
            {zh(
              `进行中 ${counts.active} · 已完成 ${counts.completed} · 失败 ${counts.failed}`,
              `${counts.active} active · ${counts.completed} completed · ${counts.failed} failed`
            )}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={openCreateModal}
              aria-label={zh('新建下载任务', 'Create download job')}
              title={zh('新建下载任务', 'Create download job')}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-[16px] text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            >
              <AddOutlinedIcon fontSize="inherit" />
            </button>
            <button
              type="button"
              onClick={() => loadJobs().catch((loadError) => setError(getErrorMessage(loadError)))}
              aria-label={zh('刷新下载队列', 'Refresh download queue')}
              title={zh('刷新下载队列', 'Refresh download queue')}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-[16px] text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            >
              <RefreshOutlinedIcon fontSize="inherit" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="mt-4 rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center text-sm text-gray-400">
            {zh('加载下载队列…', 'Loading download queue...')}
          </div>
        ) : jobs.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center text-sm text-gray-400">
            {zh(
              '队列为空，请点击上方的新建按钮创建任务',
              'The queue is empty. Use the create button above to add a job.'
            )}
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {jobs.map((job) => {
              const progress =
                job.status === 'completed'
                  ? 100
                  : job.bytes_total > 0
                    ? Math.max(0, Math.min(100, (job.bytes_downloaded * 100) / job.bytes_total))
                    : 0
              const showLocalProgress = ['local_downloading', 'completed'].includes(job.status)
              const busy = busyJobIds.has(job.id)
              const terminal = ['completed', 'failed', 'canceled'].includes(job.status)
              const localLocation = downloadLocation(job)
              return (
                <article
                  key={job.id}
                  className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm"
                >
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-semibold text-gray-900">
                          {job.magnet_name || zh('未命名磁力任务', 'Unnamed magnet download')}
                        </span>
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-4 ${
                            job.status === 'completed'
                              ? 'bg-emerald-100 text-emerald-700'
                              : job.status === 'failed'
                                ? 'bg-red-100 text-red-700'
                                : job.status === 'canceled'
                                  ? 'bg-gray-100 text-gray-500'
                                  : 'bg-blue-100 text-blue-700'
                          }`}
                        >
                          {statusLabel(job.status)}
                        </span>
                        <span className="text-[10px] font-medium text-gray-500">
                          {formatTime(job.created_at)}
                        </span>
                      </div>
                      <div
                        className="mt-0.5 truncate text-[11px] text-gray-400"
                        title={localLocation}
                      >
                        {zh('下载位置：', 'Download location: ')}
                        {localLocation}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                      <button
                        type="button"
                        disabled={busy || !localLocation}
                        onClick={() => runJobAction(job, revealDownloadLocation)}
                        aria-label={zh('打开所在位置', 'Reveal in folder')}
                        title={zh('打开所在位置', 'Reveal in folder')}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-[16px] text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                      >
                        <FolderOpenOutlinedIcon fontSize="inherit" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCopyMagnet(job)}
                        aria-label={
                          copiedJobId === job.id
                            ? zh('已复制磁力链接', 'Magnet link copied')
                            : zh('复制磁力链接', 'Copy magnet link')
                        }
                        title={
                          copiedJobId === job.id
                            ? zh('已复制磁力链接', 'Magnet link copied')
                            : zh('复制磁力链接', 'Copy magnet link')
                        }
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-md border text-[16px] ${
                          copiedJobId === job.id
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        {copiedJobId === job.id ? (
                          <CheckOutlinedIcon fontSize="inherit" />
                        ) : (
                          <ContentCopyOutlinedIcon fontSize="inherit" />
                        )}
                      </button>
                      {['failed', 'canceled'].includes(job.status) ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => runJobAction(job, retryDownloadJob)}
                          aria-label={zh('重试下载任务', 'Retry download job')}
                          title={zh('重试下载任务', 'Retry download job')}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-blue-200 bg-blue-50 text-[16px] text-blue-700 disabled:opacity-50"
                        >
                          <ReplayOutlinedIcon fontSize="inherit" />
                        </button>
                      ) : null}
                      {activeStatuses.has(job.status) ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => runJobAction(job, cancelDownloadJob)}
                          aria-label={zh('取消下载任务', 'Cancel download job')}
                          title={zh('取消下载任务', 'Cancel download job')}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-amber-200 bg-amber-50 text-[16px] text-amber-700 disabled:opacity-50"
                        >
                          <CancelOutlinedIcon fontSize="inherit" />
                        </button>
                      ) : null}
                      {terminal ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => runJobAction(job, deleteDownloadJob)}
                          aria-label={zh('移除下载记录', 'Remove download record')}
                          title={zh('移除下载记录', 'Remove download record')}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-[16px] text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                        >
                          <DeleteOutlineOutlinedIcon fontSize="inherit" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {showLocalProgress ? (
                    <>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full bg-blue-600 transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <div className="mt-0.5 flex justify-between text-[11px] text-gray-400">
                        <span>{progress.toFixed(1)}%</span>
                        <span>
                          {formatBytes(job.bytes_downloaded)} / {formatBytes(job.bytes_total)}
                        </span>
                      </div>
                    </>
                  ) : null}
                  {job.error_message ? (
                    <div className="mt-1.5 break-words rounded-md bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
                      {job.error_message}
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
        )}
      </section>

      {createOpen ? (
        <AppModal
          ariaLabel={zh('新建下载任务', 'Create download job')}
          className="px-4"
          closeDisabled={submitting}
          contentClassName="w-full max-w-xl rounded-xl bg-white p-5 shadow-xl"
          onClose={closeCreateModal}
        >
          <form onSubmit={handleSubmit}>
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-xl font-bold text-gray-900">
                {zh('新建下载任务', 'Create download job')}
              </h2>
              <button
                type="button"
                disabled={submitting}
                onClick={closeCreateModal}
                aria-label={zh('关闭弹窗', 'Close dialog')}
                title={zh('关闭', 'Close')}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 disabled:opacity-50"
              >
                <CloseOutlinedIcon fontSize="small" />
              </button>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {zh(
                '输入磁力链接后，通过 CloudDrive2 创建离线下载任务并下载到本地。',
                'Enter a magnet link to create an offline download through CloudDrive2 and download the files locally.'
              )}
            </p>
            {createError ? (
              <div
                role="alert"
                className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {createError}
              </div>
            ) : null}
            <label className="mt-4 block text-sm font-medium text-gray-700">
              {zh('磁力链接', 'Magnet link')}
              <textarea
                rows="4"
                value={magnetUrl}
                onChange={(event) => setMagnetUrl(event.target.value)}
                placeholder="magnet:?xt=urn:btih:..."
                className="mt-1 w-full resize-y rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm outline-none focus:border-blue-500"
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={closeCreateModal}
                className="h-10 rounded-lg border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                {zh('取消', 'Cancel')}
              </button>
              <button
                type="submit"
                disabled={submitting || !magnetUrl.trim()}
                className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? zh('创建中…', 'Creating...') : zh('创建任务', 'Create job')}
              </button>
            </div>
          </form>
        </AppModal>
      ) : null}
    </div>
  )
}
