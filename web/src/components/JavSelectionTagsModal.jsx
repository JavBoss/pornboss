import { Button } from '@mui/material'
import AppModal from '@/components/AppModal'
import { zh } from '@/utils/i18n'

export default function JavSelectionTagsModal({
  open,
  onClose,
  selectedCount,
  tags,
  selectedIds,
  onToggleChoice,
  onConfirm,
  saving = false,
}) {
  if (!open) return null

  const list = Array.isArray(tags) ? tags : []
  const selected = new Set((selectedIds || []).map(String))
  return (
    <AppModal
      ariaLabel={zh('添加 JAV 标签', 'Add JAV Tags')}
      className="px-4"
      closeDisabled={saving}
      contentClassName="flex max-h-[85vh] w-full max-w-sm flex-col rounded-lg bg-white p-4 shadow-xl"
      onClose={onClose}
      zIndex={1600}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{zh('添加 JAV 标签', 'Add JAV Tags')}</h2>
          <p className="mt-1 text-xs text-gray-500">
            {zh(
              `为已选的 ${selectedCount} 部 JAV 添加自定义标签`,
              `Add custom tags to ${selectedCount} selected JAV items`
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100"
          aria-label={zh('关闭标签选择', 'Close Tag Picker')}
        >
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto rounded border p-2">
        {list.length === 0 ? (
          <p className="px-2 py-1 text-sm text-gray-500">
            {zh('暂无自定义标签', 'No custom tags')}
          </p>
        ) : (
          list.map((tag) => (
            <label
              key={tag.id}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-gray-50"
            >
              <input
                type="checkbox"
                checked={selected.has(String(tag.id))}
                disabled={saving}
                onChange={(event) => onToggleChoice(tag.id, event.target.checked)}
                aria-label={tag.name}
              />
              <span className="min-w-0 flex-1 break-words text-sm text-gray-800">{tag.name}</span>
              <span className="text-xs tabular-nums text-gray-400">
                {Math.max(0, Number(tag.count) || 0)}
              </span>
            </label>
          ))
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-xs text-gray-500">
          {zh(`已选 ${selected.size} 个标签`, `${selected.size} tags selected`)}
        </span>
        <div className="flex gap-2">
          <Button variant="outlined" size="small" onClick={onClose} disabled={saving}>
            {zh('取消', 'Cancel')}
          </Button>
          <Button
            variant="contained"
            size="small"
            onClick={onConfirm}
            disabled={saving || selected.size === 0 || selectedCount === 0}
          >
            {saving ? zh('添加中...', 'Adding...') : zh('添加', 'Add')}
          </Button>
        </div>
      </div>
    </AppModal>
  )
}
