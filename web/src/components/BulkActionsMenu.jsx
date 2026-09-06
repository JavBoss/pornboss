import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import { IconButton, Menu, MenuItem, Tooltip } from '@mui/material'
import { useState } from 'react'
import { zh } from '@/utils/i18n'

export default function BulkActionsMenu({
  label,
  hasItems,
  pageSelectable,
  busy,
  mpvEnabled,
  onSelectAll,
  onSelectPage,
  onPlayPage,
  onPlayAll,
}) {
  const [anchorEl, setAnchorEl] = useState(null)
  const runAction = (action) => {
    setAnchorEl(null)
    action?.()
  }

  return (
    <>
      <Tooltip title={label} arrow>
        <span className="inline-flex">
          <IconButton
            size="small"
            onClick={(event) => setAnchorEl(event.currentTarget)}
            disabled={!hasItems || busy}
            aria-label={label}
            aria-haspopup="menu"
            aria-expanded={Boolean(anchorEl)}
            className="pagination-bulk-action"
          >
            <SettingsRoundedIcon fontSize="inherit" />
          </IconButton>
        </span>
      </Tooltip>
      <Menu
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        disableScrollLock
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        MenuListProps={{ dense: true, 'aria-label': label }}
      >
        <MenuItem disabled={!hasItems || busy} onClick={() => runAction(onSelectAll)}>
          {zh('全选', 'Select all')}
        </MenuItem>
        <MenuItem disabled={!pageSelectable || busy} onClick={() => runAction(onSelectPage)}>
          {zh('全选本页', 'Select page')}
        </MenuItem>
        <MenuItem
          disabled={!pageSelectable || !mpvEnabled || busy}
          onClick={() => runAction(onPlayPage)}
        >
          {zh('使用 MPV 播放本页', 'Play page with MPV')}
        </MenuItem>
        <MenuItem disabled={!hasItems || !mpvEnabled || busy} onClick={() => runAction(onPlayAll)}>
          {zh('使用 MPV 播放全部', 'Play all with MPV')}
        </MenuItem>
      </Menu>
    </>
  )
}
