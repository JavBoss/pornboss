import { Button, IconButton, Tooltip } from '@mui/material'
import PlaylistPlayRoundedIcon from '@mui/icons-material/PlaylistPlayRounded'
import StarBorderRoundedIcon from '@mui/icons-material/StarBorderRounded'
import RemoveCircleOutlineRoundedIcon from '@mui/icons-material/RemoveCircleOutlineRounded'
import AppModal from '@/components/AppModal'
import { zh } from '@/utils/i18n'

export default function JavSelectionOpsModal({
  open,
  onClose,
  items,
  onRemoveSelected,
  onOpenTags,
  onOpenFavorites,
  onPlaySelected,
  mpvEnabled = true,
  playing = false,
  busy = false,
}) {
  if (!open) return null

  const list = Array.isArray(items) ? items : []
  const disabled = busy || playing

  return (
    <AppModal
      ariaLabel={zh('已选择 JAV', 'Selected JAV items')}
      className="px-4"
      closeDisabled={disabled}
      contentClassName="w-full max-w-lg rounded-lg bg-white p-4 shadow-xl"
      onClose={onClose}
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">
          {zh(`已选择 ${list.length} 部 JAV`, `${list.length} JAV items selected`)}
        </h2>
        <button
          type="button"
          onClick={onClose}
          disabled={disabled}
          className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100"
          aria-label={zh('关闭', 'Close')}
        >
          ✕
        </button>
      </div>
      <ul className="max-h-[60vh] space-y-1 overflow-y-auto rounded border bg-gray-50 p-2 text-sm">
        {list.map((item) => (
          <li key={item.id} className="flex min-w-0 items-center gap-2 rounded px-2 py-1">
            <span className="min-w-0 flex-1 truncate text-gray-800" title={item.label}>
              {item.jav_code ? <span className="mr-2 font-medium">{item.jav_code}</span> : null}
              {item.label !== item.jav_code ? item.label : null}
            </span>
            <Tooltip title={zh('移除所选', 'Remove from selection')} arrow>
              <span>
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => onRemoveSelected(item.id)}
                  disabled={disabled}
                  aria-label={zh('移除所选', 'Remove from selection')}
                  className="!h-6 !w-6 !p-0"
                >
                  <RemoveCircleOutlineRoundedIcon fontSize="inherit" />
                </IconButton>
              </span>
            </Tooltip>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button
          variant="outlined"
          size="small"
          onClick={onOpenTags}
          disabled={list.length === 0 || disabled}
        >
          {zh('添加标签', 'Add Tags')}
        </Button>
        <Button
          variant="outlined"
          size="small"
          onClick={onOpenFavorites}
          disabled={list.length === 0 || disabled}
          startIcon={<StarBorderRoundedIcon fontSize="inherit" />}
        >
          {zh('加入收藏夹', 'Add to favorites')}
        </Button>
        <Button
          variant="contained"
          size="small"
          onClick={onPlaySelected}
          disabled={list.length === 0 || !mpvEnabled || disabled}
          startIcon={<PlaylistPlayRoundedIcon fontSize="inherit" />}
        >
          {playing ? zh('正在播放…', 'Playing...') : zh('使用 MPV 播放全部', 'Play all with MPV')}
        </Button>
      </div>
    </AppModal>
  )
}
