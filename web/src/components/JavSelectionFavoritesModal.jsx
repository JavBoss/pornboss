import { Button } from '@mui/material'
import AppModal from '@/components/AppModal'
import { zh } from '@/utils/i18n'

export default function JavSelectionFavoritesModal({
  open,
  onClose,
  selectedCount,
  groups,
  selectedIds,
  onToggleChoice,
  onConfirm,
  onReload,
  loading = false,
  saving = false,
  loadError,
  error,
}) {
  if (!open) return null

  const list = Array.isArray(groups) ? groups : []
  const selected = new Set((selectedIds || []).map(String))
  return (
    <AppModal
      ariaLabel={zh('加入作品收藏夹', 'Add to JAV favorite groups')}
      className="px-4"
      closeDisabled={saving}
      contentClassName="flex max-h-[85vh] w-full max-w-sm flex-col rounded-lg bg-white p-4 shadow-xl"
      onClose={onClose}
      zIndex={1600}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">
            {zh('加入作品收藏夹', 'Add to JAV favorite groups')}
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            {zh(
              `将已选的 ${selectedCount} 部 JAV 加入以下收藏夹`,
              `Add ${selectedCount} selected JAV items to these favorite groups`
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100"
          aria-label={zh('关闭收藏夹选择', 'Close favorite group picker')}
        >
          ✕
        </button>
      </div>
      {loadError || error ? (
        <div role="alert" className="mb-3 text-sm text-red-600">
          {loadError || error}
          {loadError ? (
            <Button size="small" onClick={onReload} disabled={loading || saving}>
              {zh('重试', 'Retry')}
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto rounded border p-2">
        {loading ? (
          <p className="px-2 py-4 text-center text-sm text-gray-500">
            {zh('加载中…', 'Loading...')}
          </p>
        ) : list.length === 0 ? (
          <p className="px-2 py-4 text-sm text-gray-500">
            {zh(
              '暂无作品收藏夹，请先在收藏夹管理中新建',
              'No JAV favorite groups. Create one in favorite group management first.'
            )}
          </p>
        ) : (
          list.map((group) => (
            <label
              key={group.id}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-gray-50"
            >
              <input
                type="checkbox"
                checked={selected.has(String(group.id))}
                disabled={saving || Boolean(loadError)}
                onChange={(event) => onToggleChoice(group.id, event.target.checked)}
                aria-label={group.name}
              />
              <span className="min-w-0 flex-1 break-words text-sm text-gray-800">{group.name}</span>
              <span className="text-xs tabular-nums text-gray-400">
                {Math.max(0, Number(group.count) || 0)}
              </span>
            </label>
          ))
        )}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="outlined" size="small" onClick={onClose} disabled={saving}>
          {zh('取消', 'Cancel')}
        </Button>
        <Button
          variant="contained"
          size="small"
          onClick={onConfirm}
          disabled={
            loading || saving || Boolean(loadError) || selected.size === 0 || selectedCount === 0
          }
        >
          {saving ? zh('加入中…', 'Adding...') : zh('加入', 'Add')}
        </Button>
      </div>
    </AppModal>
  )
}
