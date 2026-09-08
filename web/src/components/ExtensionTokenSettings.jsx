import { useEffect, useState } from 'react'
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined'
import {
  fetchExtensionTokens,
  createExtensionToken,
  rotateExtensionToken,
  deleteExtensionToken,
} from '@/api'
import AppModal from '@/components/AppModal'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'

export default function ExtensionTokenSettings({ onToast }) {
  const [items, setItems] = useState([])
  const [name, setName] = useState('')
  const [days, setDays] = useState(365)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchExtensionTokens()
      .then((result) => {
        if (!cancelled) setItems(result.items || [])
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const run = async (action) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const openDialog = (action, item = null) => {
    setName('')
    setDays(item?.expires_at === '0001-01-01T00:00:00Z' ? 0 : 365)
    setError('')
    setPending({ action, item })
  }

  const closeDialog = () => {
    if (busy) return
    setPending(null)
    setError('')
  }

  const applyPending = (event) => {
    event.preventDefault()
    run(async () => {
      const { item, action } = pending
      if (action === 'create') {
        const result = await createExtensionToken(name.trim(), days)
        setItems((current) => [result.item, ...current])
      } else if (action === 'rotate') {
        const result = await rotateExtensionToken(item.id, days)
        setItems((current) => current.map((entry) => (entry.id === item.id ? result.item : entry)))
      } else {
        await deleteExtensionToken(item.id)
        setItems((current) => current.filter((entry) => entry.id !== item.id))
      }
      setPending(null)
    })
  }

  const copy = async (item) => {
    try {
      await navigator.clipboard.writeText(item.token)
      onToast?.(zh('API 令牌已复制', 'API token copied'))
    } catch {
      setError(
        zh('无法自动复制，请选中下方 Token 手动复制', 'Select the token below and copy it manually')
      )
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-4">
      <div>
        <h3 className="text-sm font-semibold text-zinc-900">
          {zh('浏览器扩展 API 令牌', 'Browser extension API tokens')}
        </h3>
        <p className="mt-1 text-xs leading-5 text-zinc-500">
          {zh(
            'API 令牌用于浏览器扩展访问 JavBoss 的凭证',
            'API tokens serve as credentials for browser extensions to access JavBoss.'
          )}
        </p>
      </div>
      {error && !pending && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {loading ? (
        <p className="text-sm text-zinc-500">{zh('加载中…', 'Loading...')}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-zinc-500">{zh('暂无 API 令牌', 'No API tokens')}</p>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {items.map((item) => {
            const neverExpires = item.expires_at === '0001-01-01T00:00:00Z'
            return (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-medium text-zinc-800">{item.name}</p>
                  <div className="relative mt-2">
                    <input
                      aria-label={zh(`${item.name} 的 Token`, `Token for ${item.name}`)}
                      readOnly
                      value={item.token}
                      onFocus={(event) => event.target.select()}
                      className="w-full min-w-0 rounded border border-zinc-200 bg-zinc-50 py-2 pl-2 pr-10 font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => copy(item)}
                      title={zh('复制', 'Copy')}
                      aria-label={zh('复制', 'Copy')}
                      className="absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
                    >
                      <ContentCopyOutlinedIcon sx={{ fontSize: 16 }} />
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    {!neverExpires && new Date(item.expires_at) <= new Date()
                      ? zh('已过期', 'Expired')
                      : zh('有效', 'Active')}{' '}
                    · {zh('到期：', 'Expires: ')}
                    {neverExpires
                      ? zh('永不过期', 'Never expires')
                      : new Date(item.expires_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-3 text-sm">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => openDialog('rotate', item)}
                    className="text-blue-700 disabled:opacity-50"
                  >
                    {zh('重新生成', 'Regenerate')}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => openDialog('delete', item)}
                    className="text-red-600 disabled:opacity-50"
                  >
                    {zh('删除', 'Delete')}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          disabled={loading || busy}
          onClick={() => openDialog('create')}
          className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {zh('新建 API 令牌', 'New API token')}
        </button>
      </div>
      {pending && (
        <AppModal
          ariaLabelledby="extension-token-dialog-title"
          className="p-4"
          contentClassName="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white shadow-xl"
          contentComponent="form"
          contentProps={{ onSubmit: applyPending }}
          closeDisabled={busy}
          onClose={closeDialog}
          zIndex={1500}
        >
          <h3
            id="extension-token-dialog-title"
            className="border-b px-5 py-4 text-lg font-semibold text-zinc-900"
          >
            {pending.action === 'create'
              ? zh('新建 API 令牌', 'New API token')
              : pending.action === 'rotate'
                ? zh('重新生成 API 令牌', 'Regenerate token')
                : zh('删除 API 令牌', 'Delete API token')}
          </h3>
          <div className="space-y-4 px-5 py-4">
            {pending.action === 'create' ? (
              <label className="block text-sm text-zinc-600">
                {zh('API 令牌名称', 'Name')}
                <input
                  required
                  maxLength={80}
                  disabled={busy}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={zh('例如：笔记本 Chrome', 'e.g. Laptop Chrome')}
                  className="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm"
                />
              </label>
            ) : (
              <p className="break-words text-sm text-zinc-600">
                {pending.item.name}：
                {pending.action === 'rotate'
                  ? zh(
                      '重新生成后，旧 Token 立即失效，需要更新扩展设置。',
                      'Regenerating immediately invalidates the old token. Update the extension afterward.'
                    )
                  : zh(
                      '删除后，此 API 令牌将立即失效，且无法恢复。',
                      'Deleting immediately invalidates this API token and cannot be undone.'
                    )}
              </p>
            )}
            {pending.action !== 'delete' && (
              <label className="block text-sm text-zinc-600">
                {zh('有效期', 'Lifetime')}
                <select
                  disabled={busy}
                  value={days}
                  onChange={(event) => setDays(Number(event.target.value))}
                  className="mt-1 block w-full rounded border border-zinc-300 px-3 py-2 text-sm"
                >
                  {[30, 90, 365, 0].map((value) => (
                    <option key={value} value={value}>
                      {value === 0
                        ? zh('永不过期', 'Never expires')
                        : zh(`${value} 天`, `${value} days`)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-3 border-t px-5 py-3">
            <button
              type="button"
              disabled={busy}
              onClick={closeDialog}
              className="rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50"
            >
              {zh('取消', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={busy || (pending.action === 'create' && !name.trim())}
              className={`rounded px-3 py-2 text-sm text-white disabled:opacity-50 ${pending.action === 'delete' ? 'bg-red-600' : 'bg-blue-600'}`}
            >
              {busy
                ? zh('处理中…', 'Saving...')
                : pending.action === 'create'
                  ? zh('新建', 'Create')
                  : zh('确认', 'Confirm')}
            </button>
          </div>
        </AppModal>
      )}
    </section>
  )
}
