import { useCallback, useEffect, useRef, useState } from 'react'
import { Tooltip } from '@mui/material'
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined'
import HelpOutlineRoundedIcon from '@mui/icons-material/HelpOutlineRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined'
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined'
import {
  fetchCloudDrive2Token,
  fetchDownloaderSettings,
  testCloudDrive2,
  updateCloudDrive2Settings,
  updateDownloaderSettings,
} from '@/api'
import DirectoryPickerModal from '@/components/DirectoryPickerModal'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'

const defaultForm = {
  address: 'http://127.0.0.1:19798',
  apiToken: '',
  remoteFolder: '',
  downloadDirectory: '',
  localConcurrency: 2,
  minVideoSizeMB: 50,
}

export default function DownloaderSettingsView() {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [settings, setSettings] = useState(null)
  const [form, setForm] = useState(defaultForm)
  const [behaviorEditing, setBehaviorEditing] = useState(false)
  const [connectionEditing, setConnectionEditing] = useState(false)
  const [tokenVisible, setTokenVisible] = useState(false)
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [cloudDrive2Status, setCloudDrive2Status] = useState('checking')
  const [cloudDrive2StatusError, setCloudDrive2StatusError] = useState('')
  const cloudDrive2CheckIDRef = useRef(0)
  const behaviorSnapshotRef = useRef(null)
  const connectionSnapshotRef = useRef(null)

  const checkCloudDrive2 = useCallback(async () => {
    const checkID = cloudDrive2CheckIDRef.current + 1
    cloudDrive2CheckIDRef.current = checkID
    setCloudDrive2Status('checking')
    setCloudDrive2StatusError('')
    try {
      await testCloudDrive2()
      if (cloudDrive2CheckIDRef.current !== checkID) return
      setCloudDrive2Status('available')
    } catch (checkError) {
      if (cloudDrive2CheckIDRef.current !== checkID) return
      setCloudDrive2Status('unavailable')
      setCloudDrive2StatusError(getErrorMessage(checkError))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchDownloaderSettings(), fetchCloudDrive2Token()])
      .then(([nextSettings, token]) => {
        if (cancelled) return
        setSettings(nextSettings)
        setForm({
          address: nextSettings?.address || defaultForm.address,
          apiToken: token?.api_token || '',
          remoteFolder: nextSettings?.remote_folder || '',
          downloadDirectory: nextSettings?.download_directory || '',
          localConcurrency: Number(nextSettings?.local_concurrency) || 2,
          minVideoSizeMB: Number(nextSettings?.min_video_size_mb) || 50,
        })
      })
      .catch((loadError) => {
        if (!cancelled) setError(getErrorMessage(loadError))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    void checkCloudDrive2()
    return () => {
      cancelled = true
      cloudDrive2CheckIDRef.current += 1
    }
  }, [checkCloudDrive2])

  const updateForm = (field, value) => setForm((current) => ({ ...current, [field]: value }))

  const startBehaviorEditing = () => {
    const { downloadDirectory, localConcurrency, minVideoSizeMB } = form
    behaviorSnapshotRef.current = { downloadDirectory, localConcurrency, minVideoSizeMB }
    setBehaviorEditing(true)
  }

  const exitBehaviorEditing = () => {
    const snapshot = behaviorSnapshotRef.current
    setForm((current) => ({ ...current, ...snapshot }))
    behaviorSnapshotRef.current = null
    setPickerOpen(false)
    setBehaviorEditing(false)
  }

  const startConnectionEditing = () => {
    const { address, remoteFolder, apiToken } = form
    connectionSnapshotRef.current = { address, remoteFolder, apiToken }
    setConnectionEditing(true)
  }

  const exitConnectionEditing = () => {
    const snapshot = connectionSnapshotRef.current
    setForm((current) => ({ ...current, ...snapshot }))
    connectionSnapshotRef.current = null
    setTokenVisible(false)
    setConnectionEditing(false)
  }

  const saveConnection = async () => {
    const payload = {
      address: form.address.trim(),
      remote_folder: form.remoteFolder.trim(),
      api_token: form.apiToken.trim(),
    }
    const saved = await updateCloudDrive2Settings(payload)
    setSettings(saved)
    setTokenVisible(false)
    connectionSnapshotRef.current = null
    setConnectionEditing(false)
    void checkCloudDrive2()
    return saved
  }

  const saveBehavior = async () => {
    const saved = await updateDownloaderSettings({
      download_directory: form.downloadDirectory.trim(),
      local_concurrency: Number(form.localConcurrency),
      min_video_size_mb: Number(form.minVideoSizeMB),
    })
    setSettings(saved)
    behaviorSnapshotRef.current = null
    setBehaviorEditing(false)
    return saved
  }

  const runAction = async (name, callback, successMessage) => {
    setAction(name)
    setError('')
    setNotice('')
    try {
      await callback()
      setNotice(successMessage)
    } catch (actionError) {
      setError(getErrorMessage(actionError))
    } finally {
      setAction('')
    }
  }

  const handleBehaviorSave = (event) => {
    event.preventDefault()
    if (!behaviorEditing || busy) return
    void runAction(
      'behavior-save',
      () => saveBehavior(),
      zh('基础设置已保存', 'Basic settings saved')
    )
  }

  const handleConnectionSave = (event) => {
    event?.preventDefault()
    if (!connectionEditing || busy) return
    void runAction(
      'connection-save',
      () => saveConnection(),
      zh('CloudDrive2 设置已保存', 'CloudDrive2 settings saved')
    )
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
        {zh('加载设置…', 'Loading settings...')}
      </div>
    )
  }

  const busy = Boolean(action) || !settings
  const cloudDrive2StatusDisplay =
    cloudDrive2Status === 'available'
      ? {
          label: zh('可用', 'Available'),
          className: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
          dotClassName: 'bg-emerald-500',
        }
      : cloudDrive2Status === 'unavailable'
        ? {
            label: zh('不可用', 'Unavailable'),
            className: 'bg-red-50 text-red-700 ring-red-200',
            dotClassName: 'bg-red-500',
          }
        : {
            label: zh('检测中', 'Checking'),
            className: 'bg-slate-50 text-slate-600 ring-slate-200',
            dotClassName: 'animate-pulse bg-slate-400',
          }

  return (
    <div className="space-y-3">
      {error ? (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div role="status" className="rounded-lg bg-green-50 px-3 py-1.5 text-xs text-green-700">
          {notice}
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{zh('基础设置', 'Basic settings')}</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {zh(
                '配置本地保存位置、并发数和文件过滤。',
                'Configure local storage, concurrency, and file filtering.'
              )}
            </p>
          </div>

          <form onSubmit={handleBehaviorSave} className="mt-3">
            <div className="flex flex-col gap-2 border-b border-gray-100 py-3 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
              <label htmlFor="download-directory" className="text-xs font-medium text-gray-700">
                {zh('本地下载目录', 'Local download directory')}
              </label>
              <div className="flex w-full gap-2 sm:w-3/4">
                <input
                  id="download-directory"
                  disabled={!behaviorEditing || busy}
                  value={form.downloadDirectory}
                  onChange={(event) => updateForm('downloadDirectory', event.target.value)}
                  placeholder={zh('请选择或输入本地目录', 'Choose or enter a local directory')}
                  className="h-9 min-w-0 flex-1 rounded-lg border border-gray-300 px-3 text-xs outline-none focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
                />
                <button
                  type="button"
                  disabled={!behaviorEditing || busy}
                  onClick={() => setPickerOpen(true)}
                  aria-label={zh('选择目录', 'Choose directory')}
                  title={zh('选择目录', 'Choose directory')}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  <FolderOpenOutlinedIcon fontSize="small" />
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-2 border-b border-gray-100 py-3 sm:flex-row sm:items-center sm:justify-between">
              <label htmlFor="local-concurrency" className="text-xs font-medium text-gray-700">
                {zh('本地下载并发数', 'Concurrent local downloads')}
              </label>
              <select
                id="local-concurrency"
                disabled={!behaviorEditing || busy}
                value={form.localConcurrency}
                onChange={(event) => updateForm('localConcurrency', Number(event.target.value))}
                className="h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-xs outline-none focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-500 sm:w-24"
              >
                {[1, 2, 3].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <label htmlFor="minimum-video-size" className="text-xs font-medium text-gray-700">
                  {zh('视频最小下载体积', 'Minimum video download size')}
                </label>
                <p className="mt-1 text-xs text-gray-400">
                  {zh(
                    '小于此体积的视频下载时会被忽略',
                    'Videos smaller than this size are skipped during download.'
                  )}
                </p>
              </div>
              <div className="relative w-full sm:w-32">
                <input
                  id="minimum-video-size"
                  disabled={!behaviorEditing || busy}
                  type="number"
                  min="1"
                  max="102400"
                  value={form.minVideoSizeMB}
                  onChange={(event) => updateForm('minVideoSizeMB', Number(event.target.value))}
                  className="h-9 w-full rounded-lg border border-gray-300 py-2 pl-3 pr-10 text-xs outline-none focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                  MB
                </span>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
              {!behaviorEditing && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={startBehaviorEditing}
                  className="h-9 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {zh('编辑', 'Edit')}
                </button>
              )}
              {behaviorEditing && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={exitBehaviorEditing}
                    className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {zh('退出编辑', 'Exit editing')}
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="h-9 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {action === 'behavior-save'
                      ? zh('保存中…', 'Saving...')
                      : zh('保存设置', 'Save settings')}
                  </button>
                </>
              )}
            </div>
          </form>
        </section>

        <section className="flex flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                {zh('CloudDrive2 设置', 'CloudDrive2 settings')}
              </h2>
              <p className="mt-0.5 text-xs text-gray-500">
                {zh(
                  '配置 CloudDrive2 连接和云端离线目录。',
                  'Configure the CloudDrive2 connection and remote offline folder.'
                )}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <span
                role="status"
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold ring-1 ring-inset ${cloudDrive2StatusDisplay.className}`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${cloudDrive2StatusDisplay.dotClassName}`}
                  aria-hidden="true"
                />
                {cloudDrive2StatusDisplay.label}
              </span>
              <button
                type="button"
                disabled={busy || cloudDrive2Status === 'checking'}
                onClick={() => void checkCloudDrive2()}
                aria-label={zh('重新检测 CloudDrive2', 'Check CloudDrive2 again')}
                title={zh('重新检测', 'Check again')}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-[16px] text-gray-500 transition hover:bg-gray-50 hover:text-gray-800 disabled:opacity-50"
              >
                <RefreshRoundedIcon
                  fontSize="inherit"
                  className={cloudDrive2Status === 'checking' ? 'animate-spin' : ''}
                />
              </button>
            </div>
          </div>
          {cloudDrive2Status === 'unavailable' && cloudDrive2StatusError ? (
            <div
              role="alert"
              className="mt-2 break-words rounded-md bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700"
            >
              <span className="font-semibold">{zh('不可用原因：', 'Unavailable reason: ')}</span>
              {cloudDrive2StatusError}
            </div>
          ) : null}
          <form onSubmit={handleConnectionSave} className="mt-3 flex flex-1 flex-col">
            <div className="grid gap-3 lg:grid-cols-2">
              <label className="text-xs font-medium text-gray-600">
                {zh('CloudDrive2 地址', 'CloudDrive2 address')}
                <input
                  value={form.address}
                  disabled={!connectionEditing || busy}
                  onChange={(event) => updateForm('address', event.target.value)}
                  placeholder={defaultForm.address}
                  className="mt-1 h-9 w-full rounded-lg border border-gray-300 px-3 text-xs outline-none focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
                />
              </label>
              <label className="text-xs font-medium text-gray-600">
                {zh('云端离线目录', 'Remote offline folder')}
                <input
                  value={form.remoteFolder}
                  disabled={!connectionEditing || busy}
                  onChange={(event) => updateForm('remoteFolder', event.target.value)}
                  placeholder="/115open/..."
                  className="mt-1 h-9 w-full rounded-lg border border-gray-300 px-3 text-xs outline-none focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
                />
              </label>
              <div className="text-xs font-medium text-gray-600 lg:col-span-2">
                <div className="flex items-center gap-1">
                  <label htmlFor="clouddrive2-api-token">API Token</label>
                  <Tooltip
                    arrow
                    describeChild
                    title={zh(
                      '在 CloudDrive2 中创建 API 令牌，至少需要开启以下权限：列出文件、创建目录、读取文件、添加离线下载、查看离线下载',
                      'Create an API token in CloudDrive2 and enable at least the following permissions: list files, create folders, read files, add offline downloads, and list offline downloads'
                    )}
                  >
                    <button
                      type="button"
                      aria-label={zh('API 令牌所需权限', 'Required API token permissions')}
                      className="inline-flex rounded-full text-gray-400 hover:text-gray-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
                    >
                      <HelpOutlineRoundedIcon sx={{ fontSize: 14 }} />
                    </button>
                  </Tooltip>
                </div>
                <div className="relative mt-1">
                  <input
                    id="clouddrive2-api-token"
                    disabled={!connectionEditing || busy}
                    type={tokenVisible ? 'text' : 'password'}
                    value={form.apiToken}
                    onChange={(event) => updateForm('apiToken', event.target.value)}
                    autoComplete="new-password"
                    className="h-9 w-full rounded-lg border border-gray-300 py-2 pl-3 pr-11 text-xs outline-none focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setTokenVisible((visible) => !visible)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-50"
                    aria-label={
                      tokenVisible ? zh('隐藏 Token', 'Hide token') : zh('显示 Token', 'Show token')
                    }
                  >
                    {tokenVisible ? (
                      <VisibilityOutlinedIcon fontSize="small" />
                    ) : (
                      <VisibilityOffOutlinedIcon fontSize="small" />
                    )}
                  </button>
                </div>
              </div>
            </div>
            <div className="mt-auto flex justify-end gap-2 border-t border-gray-100 pt-3">
              {!connectionEditing && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={startConnectionEditing}
                  className="h-9 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {zh('编辑', 'Edit')}
                </button>
              )}
              {connectionEditing && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={exitConnectionEditing}
                    className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {zh('退出编辑', 'Exit editing')}
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="h-9 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {action === 'connection-save'
                      ? zh('保存中…', 'Saving...')
                      : zh('保存设置', 'Save settings')}
                  </button>
                </>
              )}
            </div>
          </form>
        </section>
      </div>
      {pickerOpen && (
        <DirectoryPickerModal
          initialPath={form.downloadDirectory}
          onClose={() => setPickerOpen(false)}
          onSelect={(selectedPath) => {
            updateForm('downloadDirectory', selectedPath)
            setPickerOpen(false)
          }}
        />
      )}
    </div>
  )
}
