import { useEffect, useId, useState } from 'react'
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined'
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import { CircularProgress, IconButton, Tooltip } from '@mui/material'
import { browseDirectories } from '@/api'
import AppModal from '@/components/AppModal'
import { useStore } from '@/store'
import { apiHostPath, displayHostPath, hostPathsEnabled } from '@/utils/hostPath'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'

// Mount when opening; onSelect returns an absolute path understood by the server.
export default function DirectoryPickerModal({ initialPath = '', onSelect, onClose }) {
  const useHostPaths = useStore((state) => hostPathsEnabled(state.config))
  const titleId = useId()
  const pathId = useId()
  const [request, setRequest] = useState(() => ({
    path: initialPath,
  }))
  const [pathInput, setPathInput] = useState(displayHostPath(request.path, useHostPaths))
  const [listing, setListing] = useState(null)
  const [showHidden, setShowHidden] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    const path = apiHostPath(request.path, useHostPaths) || (useHostPaths ? '/host' : '')
    browseDirectories(path, { showHidden, signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return
        setListing(data)
        setPathInput(displayHostPath(data.path, useHostPaths))
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setListing(null)
          setError(getErrorMessage(err))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [request, showHidden, useHostPaths])

  const navigate = (path) => {
    setLoading(true)
    setPathInput(displayHostPath(path, useHostPaths))
    setRequest({ path })
  }
  const parent = useHostPaths && listing?.path === '/host' ? '' : listing?.parent
  const roots = useHostPaths ? [{ name: '/', path: '/host' }] : listing?.roots || []
  const directories = listing?.directories || []
  const inputChanged = pathInput !== displayHostPath(listing?.path, useHostPaths)
  const iconButton = (label, icon, onClick, disabled = false) => (
    <Tooltip title={label}>
      <span>
        <IconButton
          type="button"
          size="small"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
        >
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  )

  return (
    <AppModal
      ariaLabelledby={titleId}
      onClose={onClose}
      zIndex={1500}
      className="max-w-full p-3 sm:p-6"
      contentClassName="flex h-[600px] max-h-[85dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b px-5 py-4">
        <div>
          <h2 id={titleId} className="flex items-center gap-2 text-lg font-semibold text-gray-900">
            <FolderOpenOutlinedIcon className="text-blue-600" />
            {zh('选择目录', 'Choose directory')}
          </h2>
        </div>
        {iconButton(zh('关闭', 'Close'), <CloseRoundedIcon />, onClose)}
      </div>
      <div className="shrink-0 space-y-3 border-b px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {iconButton(
            zh('返回上级', 'Parent directory'),
            <ArrowUpwardRoundedIcon fontSize="small" />,
            () => navigate(parent),
            loading || !parent
          )}
          {iconButton(zh('根目录', 'Root directory'), <HomeOutlinedIcon fontSize="small" />, () =>
            navigate(useHostPaths ? '/host' : '')
          )}
          {iconButton(
            zh('刷新', 'Refresh'),
            <RefreshRoundedIcon fontSize="small" />,
            () => navigate(request.path),
            loading
          )}
          {roots.map((root) => (
            <button
              key={root.path}
              type="button"
              onClick={() => navigate(root.path)}
              className="rounded-md border px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
            >
              {root.name}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-2 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(event) => {
                setLoading(true)
                setShowHidden(event.target.checked)
              }}
            />
            {zh('显示隐藏目录', 'Show hidden directories')}
          </label>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            navigate(apiHostPath(pathInput, useHostPaths))
          }}
          className="flex gap-2"
        >
          <label htmlFor={pathId} className="sr-only">
            {zh('目录路径', 'Directory path')}
          </label>
          <input
            id={pathId}
            value={pathInput}
            onChange={(event) => setPathInput(event.target.value)}
            placeholder={zh('输入完整目录路径', 'Enter an absolute directory path')}
            className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={!pathInput.trim()}
            className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            {zh('前往', 'Go')}
          </button>
        </form>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2" aria-busy={loading}>
        {loading ? (
          <div
            role="status"
            className="flex h-full items-center justify-center gap-3 text-sm text-gray-500"
          >
            <CircularProgress size={20} />
            {zh('正在读取目录…', 'Loading directories…')}
          </div>
        ) : error ? (
          <div
            role="alert"
            className="flex h-full flex-col items-center justify-center gap-3 px-3 text-sm text-red-600"
          >
            <p>{error}</p>
            <button
              type="button"
              onClick={() => navigate(request.path)}
              className="rounded-lg border px-3 py-2 hover:bg-gray-50"
            >
              {zh('重试', 'Retry')}
            </button>
          </div>
        ) : directories.length === 0 ? (
          <div
            role="status"
            className="flex h-full items-center justify-center text-sm text-gray-500"
          >
            {zh(
              '此目录下没有子目录，可直接选择当前目录',
              'No subdirectories. You can select the current directory.'
            )}
          </div>
        ) : (
          <ul className="space-y-1">
            {directories.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  onClick={() => navigate(entry.path)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-blue-50 focus-visible:bg-blue-50"
                  title={displayHostPath(entry.path, useHostPaths)}
                >
                  <FolderOpenOutlinedIcon className="shrink-0 text-blue-500" fontSize="small" />
                  <span className="min-w-0 flex-1 break-all">{entry.name}</span>
                  <ChevronRightRoundedIcon fontSize="small" className="shrink-0 text-gray-400" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="shrink-0 space-y-3 border-t bg-gray-50 px-5 py-4">
        <p className="break-all text-xs text-gray-500" aria-live="polite">
          {zh('当前目录：', 'Current directory: ')}
          {loading ? '…' : displayHostPath(listing?.path, useHostPaths) || '—'}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border bg-white px-4 py-2 text-sm hover:bg-gray-100"
          >
            {zh('取消', 'Cancel')}
          </button>
          <button
            type="button"
            disabled={loading || !listing || !!error || inputChanged}
            onClick={() => onSelect(listing.path)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {zh('选择此目录', 'Select this directory')}
          </button>
        </div>
      </div>
    </AppModal>
  )
}
