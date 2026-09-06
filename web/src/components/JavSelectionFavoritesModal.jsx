import { useEffect, useMemo, useState } from 'react'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import { Button, IconButton } from '@mui/material'
import AppModal from '@/components/AppModal'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'

export default function JavSelectionFavoritesModal({
  open,
  onClose,
  selectedCount,
  groups,
  selectedIds,
  onToggleChoice,
  onCreateGroup,
  onConfirm,
  onReload,
  loading = false,
  saving = false,
  loadError,
  error,
}) {
  const [newGroupName, setNewGroupName] = useState('')
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (open) return
    setNewGroupName('')
    setCreateError('')
    setCreating(false)
  }, [open])

  const groupList = useMemo(() => {
    return [...(Array.isArray(groups) ? groups : [])].sort((a, b) =>
      String(a?.name || '').localeCompare(String(b?.name || ''))
    )
  }, [groups])

  if (!open) return null

  const selected = new Set((selectedIds || []).map(String))
  const busy = saving || creating

  const handleCreate = async (event) => {
    event.preventDefault()
    const name = newGroupName.trim()
    if (!name || busy || loading) return
    setCreating(true)
    setCreateError('')
    try {
      const group = await onCreateGroup(name)
      const groupId = Number(group?.id)
      if (!Number.isFinite(groupId) || groupId <= 0) {
        throw new Error(zh('创建收藏夹失败', 'Failed to create favorite group'))
      }
      onToggleChoice(groupId, true)
      setNewGroupName('')
    } catch (createFailure) {
      setCreateError(getErrorMessage(createFailure))
    } finally {
      setCreating(false)
    }
  }

  return (
    <AppModal
      ariaLabel={zh('选择收藏夹', 'Choose favorite groups')}
      className="px-4"
      closeDisabled={busy}
      contentClassName="flex max-h-[82vh] w-full max-w-md flex-col rounded-lg bg-white shadow-xl"
      onClose={onClose}
      zIndex={1800}
    >
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-gray-950">
            {zh('选择收藏夹', 'Choose favorite groups')}
          </h2>
          <div className="mt-0.5 truncate text-sm text-gray-500">
            {zh(`已选择 ${selectedCount} 部 JAV`, `${selectedCount} JAV items selected`)}
          </div>
        </div>
        <IconButton
          type="button"
          size="small"
          onClick={onClose}
          disabled={busy}
          aria-label={zh('关闭收藏夹选择', 'Close favorite group picker')}
        >
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {loadError || error ? (
          <div
            role="alert"
            className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {loadError || error}
            {loadError ? (
              <Button size="small" onClick={onReload} disabled={loading || busy}>
                {zh('重试', 'Retry')}
              </Button>
            ) : null}
          </div>
        ) : null}

        <form onSubmit={handleCreate} className="flex gap-2">
          <input
            value={newGroupName}
            onChange={(event) => setNewGroupName(event.target.value)}
            placeholder={zh('新建作品收藏夹', 'New JAV favorite group')}
            aria-label={zh('新建作品收藏夹', 'New JAV favorite group')}
            className="min-w-0 flex-1 rounded border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            disabled={loading || busy}
          />
          <Button
            type="submit"
            variant="outlined"
            startIcon={<AddRoundedIcon fontSize="small" />}
            disabled={!newGroupName.trim() || loading || busy}
          >
            {zh('新建', 'Create')}
          </Button>
        </form>
        {createError ? (
          <div role="alert" className="text-sm text-red-600">
            {createError}
          </div>
        ) : null}

        <div className="rounded border border-gray-200">
          {loading ? (
            <div className="px-3 py-8 text-center text-sm text-gray-500">
              {zh('加载中…', 'Loading...')}
            </div>
          ) : groupList.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-gray-500">
              {zh('暂无收藏夹', 'No favorite groups')}
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto p-1">
              {groupList.map((group) => (
                <label
                  key={group.id}
                  className="flex cursor-pointer items-center gap-3 rounded px-3 py-2 hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(String(group.id))}
                    disabled={busy || Boolean(loadError)}
                    onChange={(event) => onToggleChoice(group.id, event.target.checked)}
                    aria-label={group.name || zh('未命名收藏夹', 'Untitled favorite group')}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-900">
                    {group.name || zh('未命名收藏夹', 'Untitled favorite group')}
                  </span>
                  <span className="shrink-0 text-xs text-gray-500">
                    {Number.isFinite(group.count) ? group.count : 0}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t px-4 py-3">
        <Button variant="outlined" onClick={onClose} disabled={busy}>
          {zh('取消', 'Cancel')}
        </Button>
        <Button
          variant="contained"
          onClick={onConfirm}
          disabled={
            loading || busy || Boolean(loadError) || selected.size === 0 || selectedCount === 0
          }
        >
          {saving ? zh('保存中…', 'Saving...') : zh('保存', 'Save')}
        </Button>
      </div>
    </AppModal>
  )
}
