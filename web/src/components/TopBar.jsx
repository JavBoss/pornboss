import { useEffect, useMemo, useRef, useState } from 'react'
import BookmarksOutlinedIcon from '@mui/icons-material/BookmarksOutlined'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import FavoriteBorderRoundedIcon from '@mui/icons-material/FavoriteBorderRounded'
import FavoriteRoundedIcon from '@mui/icons-material/FavoriteRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import SearchIcon from '@mui/icons-material/Search'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import ShuffleOutlinedIcon from '@mui/icons-material/ShuffleOutlined'
import { Button, IconButton, Popper, Slider } from '@mui/material'
import {
  formatIdolProfileFilterRange,
  IDOL_PROFILE_FILTER_DEFINITIONS,
  normalizeIdolProfileFilters,
} from '@/constants/jav'
import { zh } from '@/utils/i18n'

const FAVORITE_MENU_RIGHT_SHIFT = 32

function isModifiedClick(event) {
  return Boolean(
    event &&
      (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
  )
}

function FilterChip({ label, onRemove }) {
  return (
    <span className="filter-chip" title={label}>
      <span className="filter-chip__label">{label}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="filter-chip__remove"
          aria-label={zh(`删除筛选条件 ${label}`, `Remove filter ${label}`)}
        >
          <CloseRoundedIcon fontSize="inherit" />
        </button>
      ) : null}
    </span>
  )
}

function FavoriteRatingFilter({ enabled, min, max, onEnabledChange, onRangeChange }) {
  const normalizedMin = Number.isFinite(Number(min)) ? Number(min) : 0.5
  const normalizedMax = Number.isFinite(Number(max)) ? Number(max) : 5
  const range = normalizedMin <= normalizedMax ? [normalizedMin, normalizedMax] : [0.5, 5]
  const formatValue = (value) => (Number.isInteger(value) ? String(value) : value.toFixed(1))
  const toggleLabel = enabled
    ? zh('关闭喜爱度筛选', 'Disable favorite rating filter')
    : zh('启用喜爱度筛选', 'Enable favorite rating filter')

  return (
    <div className={`favorite-rating-filter ${enabled ? 'favorite-rating-filter--active' : ''}`}>
      <button
        type="button"
        className="favorite-rating-filter__toggle"
        onClick={() => onEnabledChange?.(!enabled)}
        title={toggleLabel}
        aria-label={toggleLabel}
        aria-pressed={Boolean(enabled)}
      >
        {enabled ? (
          <FavoriteRoundedIcon fontSize="inherit" />
        ) : (
          <FavoriteBorderRoundedIcon fontSize="inherit" />
        )}
      </button>
      <Slider
        value={range}
        onChange={(_, value) => {
          if (Array.isArray(value)) onRangeChange?.(value)
        }}
        min={0.5}
        max={5}
        step={0.5}
        disableSwap
        disabled={!enabled}
        getAriaLabel={(index) =>
          index === 0
            ? zh('最低喜爱度', 'Minimum favorite rating')
            : zh('最高喜爱度', 'Maximum favorite rating')
        }
        sx={{
          gridColumn: 3,
          width: '100%',
          minWidth: 0,
          alignSelf: 'center',
          transform: 'translateY(-1px)',
          p: 0,
          height: 3,
          '& .MuiSlider-rail, & .MuiSlider-track': { height: 3 },
          '& .MuiSlider-thumb': { width: 10, height: 10 },
          '& .MuiSlider-thumb::after': { width: 16, height: 16 },
        }}
      />
      <span className="favorite-rating-filter__value">
        {formatValue(range[0])}–{formatValue(range[1])}
      </span>
    </div>
  )
}

function IdolProfileFilter({ definition, value, onChange }) {
  const anchorRef = useRef(null)
  const closeTimerRef = useRef(null)
  const draggingRef = useRef(false)
  const pointerInsideRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [draftEnabled, setDraftEnabled] = useState(value.enabled)
  const [draftRange, setDraftRange] = useState([value.min, value.max])
  const label = zh(definition.label[0], definition.label[1])
  const rangeLabel = formatIdolProfileFilterRange(
    definition,
    { enabled: draftEnabled, min: draftRange[0], max: draftRange[1] },
    zh
  )

  const cancelClose = () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
    setOpen(true)
  }
  const scheduleClose = () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      if (draggingRef.current || pointerInsideRef.current) return
      setOpen(false)
    }, 0)
  }
  const handleMouseEnter = () => {
    pointerInsideRef.current = true
    cancelClose()
  }
  const handleMouseLeave = () => {
    pointerInsideRef.current = false
    scheduleClose()
  }

  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
    },
    []
  )

  useEffect(() => {
    if (draggingRef.current) return
    setDraftEnabled(value.enabled)
    setDraftRange([value.min, value.max])
  }, [value.enabled, value.max, value.min])

  useEffect(() => {
    if (!open) return undefined
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !draggingRef.current) setOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open])

  return (
    <div
      className="idol-profile-filter"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocusCapture={cancelClose}
      onBlurCapture={scheduleClose}
    >
      <button
        ref={anchorRef}
        type="button"
        className={`filter-action-button ${draftEnabled ? 'filter-action-button--active' : ''}`}
        onClick={cancelClose}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="idol-profile-filter__label">{label}</span>
        {draftEnabled ? <span className="idol-profile-filter__range">{rangeLabel}</span> : null}
      </button>
      <Popper
        open={open}
        anchorEl={anchorRef.current}
        placement="bottom-start"
        modifiers={[{ name: 'offset', options: { offset: [0, 0] } }]}
        sx={{ zIndex: 60 }}
      >
        <div
          className="idol-profile-filter__popover-hitbox"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onFocusCapture={cancelClose}
          onBlurCapture={scheduleClose}
        >
          <div
            className="idol-profile-filter__popover"
            role="dialog"
            aria-label={zh(`${label}筛选`, `${label} filter`)}
          >
            <div className="idol-profile-filter__popover-header">
              <span>{rangeLabel}</span>
              {draftEnabled ? (
                <button
                  type="button"
                  className="idol-profile-filter__clear"
                  onClick={() => {
                    draggingRef.current = false
                    setDraftEnabled(false)
                    setDraftRange([definition.min, definition.max])
                    setOpen(false)
                    onChange?.(definition.key, {
                      enabled: false,
                      min: definition.min,
                      max: definition.max,
                    })
                  }}
                >
                  {zh('清除', 'Clear')}
                </button>
              ) : null}
            </div>
            <Slider
              value={draftRange}
              onPointerDown={() => {
                draggingRef.current = true
                setDraftEnabled(true)
              }}
              onChange={(_, range) => {
                if (Array.isArray(range)) {
                  setDraftEnabled(true)
                  setDraftRange(range)
                }
              }}
              onChangeCommitted={(_, range) => {
                const wasDragging = draggingRef.current
                draggingRef.current = false
                if (Array.isArray(range)) {
                  setDraftEnabled(true)
                  setDraftRange(range)
                  onChange?.(definition.key, {
                    enabled: true,
                    min: range[0],
                    max: range[1],
                  })
                }
                if (wasDragging && !pointerInsideRef.current) scheduleClose()
              }}
              min={definition.min}
              max={definition.max}
              step={definition.step}
              disableSwap
              getAriaLabel={(index) =>
                index === 0
                  ? zh(`最低${label}`, `Minimum ${label}`)
                  : zh(`最高${label}`, `Maximum ${label}`)
              }
              sx={{
                width: '100%',
                color: draftEnabled ? 'primary.main' : '#94a3b8',
                p: 0,
                height: 4,
                '& .MuiSlider-rail, & .MuiSlider-track': { height: 4 },
                '& .MuiSlider-thumb': { width: 12, height: 12 },
                '& .MuiSlider-thumb::after': { width: 20, height: 20 },
              }}
            />
          </div>
        </div>
      </Popper>
    </div>
  )
}

function IdolProfileFilters({ filters, onChange, showClear, onClear }) {
  const normalized = useMemo(() => normalizeIdolProfileFilters(filters), [filters])

  return (
    <div className="idol-profile-filters" aria-label={zh('女优资料筛选', 'Idol profile filters')}>
      {IDOL_PROFILE_FILTER_DEFINITIONS.map((definition) => (
        <IdolProfileFilter
          key={definition.key}
          definition={definition}
          value={normalized[definition.key]}
          onChange={onChange}
        />
      ))}
      {showClear ? (
        <button
          type="button"
          className="filter-clear-button idol-profile-filters__clear"
          onClick={onClear}
        >
          {zh('清空', 'Clear')}
        </button>
      ) : null}
    </div>
  )
}

export default function TopBar({
  favoriteEntityType = 'idol',
  favoriteGroups = [],
  favoriteGroupsError = null,
  favoriteGroupsLoading = false,
  favoriteManagerOpen = false,
  favoriteRatingEnabled = false,
  favoriteRatingMin = 0.5,
  favoriteRatingMax = 5,
  idolProfileFilters = {},
  buildFavoriteGroupUrl,
  filterItems = [],
  hasActiveControlFilter = false,
  isJavMode,
  javSearchHref,
  javSearchInput,
  javTab,
  onClearFilters,
  onFavoriteGroupSelect,
  onFavoriteRatingEnabledChange,
  onFavoriteRatingRangeChange,
  onIdolProfileFilterChange,
  onHome,
  onRandomClick,
  onOpenFavoriteGroups,
  onOpenFilterEditor,
  onOpenFavoriteManager,
  onSearchInputChange,
  onSubmitSearch,
  onOpenSelectionOps,
  onClearSelection,
  searchHref,
  searchInput,
  selectedCount = 0,
  selectedFavoriteGroupId = null,
}) {
  const headerRef = useRef(null)
  const favoriteMenuRef = useRef(null)
  const [favoriteMenuOpen, setFavoriteMenuOpen] = useState(false)

  const selectedFavoriteGroup = useMemo(() => {
    const selectedId = Number(selectedFavoriteGroupId)
    if (!Number.isFinite(selectedId) || selectedId <= 0) return null
    return favoriteGroups.find((group) => Number(group?.id) === selectedId) || null
  }, [favoriteGroups, selectedFavoriteGroupId])

  const favoriteLabel = useMemo(() => {
    switch (favoriteEntityType) {
      case 'jav':
        return zh('作品收藏夹', 'Work favorites')
      case 'studio':
        return zh('片商收藏夹', 'Studio favorites')
      case 'series':
        return zh('系列收藏夹', 'Series favorites')
      default:
        return zh('女优收藏夹', 'Idol favorites')
    }
  }, [favoriteEntityType])

  const favoriteAllLabel = useMemo(() => {
    switch (favoriteEntityType) {
      case 'jav':
        return zh('全部作品', 'All JAV')
      case 'studio':
        return zh('全部片商', 'All studios')
      case 'series':
        return zh('全部系列', 'All series')
      default:
        return zh('全部女优', 'All idols')
    }
  }, [favoriteEntityType])

  useEffect(() => {
    const updateHeight = () => {
      const height = headerRef.current?.getBoundingClientRect().height || 0
      document.documentElement.style.setProperty('--topbar-height', `${Math.round(height)}px`)
    }
    updateHeight()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(updateHeight) : null
    if (headerRef.current) observer?.observe(headerRef.current)
    window.addEventListener('resize', updateHeight)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', updateHeight)
    }
  }, [])

  useEffect(() => {
    if (!favoriteMenuOpen || favoriteManagerOpen) return undefined
    const handlePointerDown = (event) => {
      if (favoriteMenuRef.current?.contains(event.target)) return
      setFavoriteMenuOpen(false)
    }
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return
      setFavoriteMenuOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [favoriteManagerOpen, favoriteMenuOpen])

  const activeSearchInput = isJavMode ? javSearchInput : searchInput
  const activeSearchHref = isJavMode ? javSearchHref : searchHref
  const isJavDownload = isJavMode && javTab === 'download'
  const activeSelectedCount = Number(selectedCount)
  const hasSelection =
    (!isJavMode || javTab === 'list') &&
    Number.isFinite(activeSelectedCount) &&
    activeSelectedCount > 0
  const placeholder = isJavMode
    ? javTab === 'idol'
      ? zh('搜索女优名称', 'Search idol name')
      : javTab === 'studio'
        ? zh('搜索片商名称', 'Search studio name')
        : javTab === 'series'
          ? zh('搜索系列名称', 'Search series name')
          : zh('搜索番号或标题', 'Search code or title')
    : zh('搜索文件名', 'Search filename')
  const showFilterCluster =
    !isJavDownload &&
    (filterItems.length > 0 ||
      Boolean(onOpenFilterEditor) ||
      ((!isJavMode || javTab !== 'idol') && hasActiveControlFilter))

  return (
    <header ref={headerRef} className="filter-topbar">
      <div className="filter-topbar__body">
        <button
          type="button"
          onClick={onHome}
          className="filter-topbar__brand"
          aria-label={zh('返回当前页面首页', 'Return to current section home')}
        >
          JavBoss
        </button>
        <div className="filter-topbar__controls">
          {!isJavDownload ? (
            <form onSubmit={onSubmitSearch} className="filter-search">
              <input
                value={activeSearchInput}
                onChange={(event) => onSearchInputChange?.(event.target.value)}
                placeholder={placeholder}
                aria-label={placeholder}
              />
              <Button
                component="a"
                href={activeSearchHref}
                type="submit"
                variant="contained"
                size="small"
                onClick={(event) => {
                  if (isModifiedClick(event)) return
                  event.preventDefault()
                  onSubmitSearch?.(event)
                }}
                sx={{ minWidth: 34, width: 34, height: 30, p: 0, borderRadius: '8px' }}
                aria-label={zh('应用搜索', 'Apply search')}
              >
                <SearchIcon sx={{ fontSize: 17 }} />
              </Button>
            </form>
          ) : null}

          {isJavMode && javTab === 'list' ? (
            <FavoriteRatingFilter
              enabled={favoriteRatingEnabled}
              min={favoriteRatingMin}
              max={favoriteRatingMax}
              onEnabledChange={onFavoriteRatingEnabledChange}
              onRangeChange={onFavoriteRatingRangeChange}
            />
          ) : null}

          {isJavMode && javTab === 'idol' ? (
            <IdolProfileFilters
              filters={idolProfileFilters}
              onChange={onIdolProfileFilterChange}
              showClear={hasActiveControlFilter}
              onClear={onClearFilters}
            />
          ) : null}

          {onRandomClick ? (
            <button type="button" className="filter-action-button" onClick={onRandomClick}>
              <ShuffleOutlinedIcon fontSize="small" />
              <span>{zh('随机', 'Random')}</span>
            </button>
          ) : null}

          {showFilterCluster ? (
            <div className="filter-topbar__filter-cluster">
              {filterItems.length > 0 ? (
                <div
                  className="filter-topbar__conditions"
                  aria-label={zh('当前筛选条件', 'Active filters')}
                >
                  {filterItems.map((item) => (
                    <FilterChip key={item.key} label={item.label} onRemove={item.onRemove} />
                  ))}
                </div>
              ) : null}

              {onOpenFilterEditor ? (
                <button
                  type="button"
                  className="filter-clear-button"
                  onClick={onOpenFilterEditor}
                  title={zh('编辑筛选条件', 'Edit filters')}
                  aria-label={zh('编辑筛选条件', 'Edit filters')}
                >
                  {zh('编辑', 'Edit')}
                </button>
              ) : null}

              {hasActiveControlFilter || filterItems.length > 0 ? (
                <button type="button" className="filter-clear-button" onClick={onClearFilters}>
                  {zh('清空', 'Clear')}
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="filter-topbar__actions">
            {hasSelection ? (
              <div className="inline-flex items-center gap-1 rounded-full border border-sky-100 bg-sky-50 px-1.5 py-1">
                <span className="whitespace-nowrap px-1.5 text-xs font-medium text-sky-700">
                  {zh(`已选 ${activeSelectedCount} 项`, `${activeSelectedCount} selected`)}
                </span>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={onOpenSelectionOps}
                  className="topbar-selection-action"
                >
                  {zh('操作', 'Actions')}
                </Button>
                <Button
                  variant="text"
                  size="small"
                  onClick={onClearSelection}
                  className="topbar-selection-action"
                >
                  {zh('清空', 'Clear')}
                </Button>
              </div>
            ) : null}

            {isJavMode && !isJavDownload ? (
              <div ref={favoriteMenuRef} className="relative">
                <button
                  type="button"
                  className={`filter-action-button ${selectedFavoriteGroup ? 'filter-action-button--active' : ''}`}
                  onClick={() => {
                    setFavoriteMenuOpen((open) => !open)
                    if (!favoriteMenuOpen) onOpenFavoriteGroups?.()
                  }}
                  aria-label={favoriteLabel}
                  aria-haspopup="dialog"
                  aria-expanded={favoriteMenuOpen}
                >
                  <BookmarksOutlinedIcon fontSize="small" />
                  <span className="max-w-28 truncate">
                    {selectedFavoriteGroup?.name || zh('收藏夹', 'Favorites')}
                  </span>
                </button>
                {favoriteMenuOpen ? (
                  <FavoriteGroupMenu
                    title={favoriteLabel}
                    allLabel={favoriteAllLabel}
                    groups={favoriteGroups}
                    selectedGroupId={selectedFavoriteGroupId}
                    loading={favoriteGroupsLoading}
                    error={favoriteGroupsError}
                    buildGroupUrl={buildFavoriteGroupUrl}
                    onSelect={(groupId) => {
                      onFavoriteGroupSelect?.(groupId)
                      setFavoriteMenuOpen(false)
                    }}
                    onOpenManager={(group) => onOpenFavoriteManager?.(group)}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  )
}

function FavoriteGroupMenu({
  title,
  allLabel,
  groups,
  selectedGroupId,
  loading,
  error,
  buildGroupUrl,
  onSelect,
  onOpenManager,
}) {
  const list = Array.isArray(groups) ? groups : []
  const selected = Number(selectedGroupId) || null

  return (
    <div
      role="dialog"
      aria-label={title || zh('女优收藏夹', 'Idol favorites')}
      className="absolute top-full z-50 mt-2.5 flex max-h-[70vh] w-[34rem] max-w-[calc(100vw-2rem)] flex-col overflow-visible rounded border border-gray-200 bg-white text-left shadow-xl"
      style={{ right: `${-FAVORITE_MENU_RIGHT_SHIFT}px` }}
    >
      <span
        className="absolute top-0 h-0 w-0 -translate-y-full border-x-[10px] border-b-[10px] border-x-transparent border-b-gray-200"
        style={{ right: `${16 + FAVORITE_MENU_RIGHT_SHIFT}px` }}
        aria-hidden="true"
      />
      <span
        className="absolute top-px h-0 w-0 -translate-y-full border-x-[9px] border-b-[9px] border-x-transparent border-b-gray-50"
        style={{ right: `${17 + FAVORITE_MENU_RIGHT_SHIFT}px` }}
        aria-hidden="true"
      />
      <div className="flex items-center justify-between gap-2 border-b bg-gray-50 px-3 py-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-gray-700">
            {title || zh('女优收藏夹', 'Idol favorites')}
          </div>
          <div className="truncate text-xs text-gray-500">
            {loading
              ? zh('加载中…', 'Loading...')
              : zh(`${list.length} 个收藏夹`, `${list.length} favorites`)}
          </div>
        </div>
        <IconButton
          type="button"
          size="small"
          onClick={() => onOpenManager?.()}
          title={zh('管理收藏夹', 'Manage favorites')}
          aria-label={zh('管理收藏夹', 'Manage favorites')}
          sx={{ width: 30, height: 30 }}
        >
          <SettingsOutlinedIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/80 p-2">
        {error ? (
          <div className="mb-2 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
            {String(error)}
          </div>
        ) : null}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(5.75rem,1fr))] gap-2">
          <FavoriteGroupTile
            active={!selected}
            href={buildGroupUrl?.(null)}
            label={allLabel || zh('全部女优', 'All idols')}
            onClick={() => onSelect?.(null)}
          />
          {list.map((group) => {
            const id = Number(group?.id)
            if (!Number.isFinite(id) || id <= 0) return null
            const count = Number(group?.count)
            return (
              <FavoriteGroupTile
                key={id}
                active={selected === id}
                href={buildGroupUrl?.(id)}
                group={group}
                label={group?.name || zh('未命名收藏夹', 'Untitled favorite group')}
                count={Number.isFinite(count) ? count : 0}
                onClick={() => onSelect?.(id)}
                onEdit={() => onOpenManager?.(group)}
              />
            )
          })}
        </div>
        {!loading && !error && list.length === 0 ? (
          <div className="px-3 py-4 text-center text-sm text-gray-500">
            {zh('暂无收藏夹', 'No favorites')}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function FavoriteGroupTile({ active, href, group = null, label, count, onClick, onEdit }) {
  return (
    <div
      className={`group relative block aspect-square overflow-hidden rounded-lg border focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
        active ? 'border-blue-300 shadow-md' : 'border-amber-200/80 shadow-sm'
      }`}
    >
      <a
        href={href || '#'}
        onClick={(event) => {
          if (isModifiedClick(event)) return
          event.preventDefault()
          onClick?.()
        }}
        className="relative block h-full focus:outline-none"
      >
        <span
          className={`absolute left-2 top-1.5 h-3 w-10 rounded-t-md border border-b-0 ${
            active
              ? 'border-blue-300 bg-gradient-to-b from-blue-200 to-blue-300'
              : 'border-amber-200 bg-gradient-to-b from-amber-100 to-amber-200'
          }`}
          aria-hidden="true"
        />
        <span
          className={`absolute inset-x-1.5 bottom-1.5 top-3.5 rounded-md border shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_6px_10px_rgba(15,23,42,0.11)] ${
            active
              ? 'border-blue-300 bg-gradient-to-br from-blue-100 via-blue-200 to-blue-300'
              : 'border-amber-200 bg-gradient-to-br from-amber-50 via-amber-100 to-amber-200'
          }`}
          aria-hidden="true"
        />
        <span
          className={`absolute inset-x-2 bottom-0.5 h-1.5 rounded-b-md ${
            active ? 'bg-blue-400/40' : 'bg-amber-300/45'
          }`}
          aria-hidden="true"
        />
        <span className="relative flex h-full px-2 pt-5">
          <span className="flex items-start gap-1">
            <FolderRoundedIcon
              sx={{ fontSize: 14 }}
              className={active ? 'shrink-0 text-blue-700' : 'shrink-0 text-amber-700'}
            />
            <span
              className={`min-w-0 flex-1 truncate text-[11px] font-semibold leading-4 ${
                active ? 'text-blue-950' : 'text-amber-950'
              }`}
            >
              {label}
            </span>
          </span>
        </span>
      </a>
      {Number.isFinite(count) ? (
        <span
          className={`absolute right-1.5 top-1.5 rounded-full border px-1.5 text-[10px] leading-4 shadow-sm ${
            active
              ? 'border-blue-200 bg-white/80 text-blue-700'
              : 'border-amber-200 bg-white/80 text-amber-800'
          }`}
        >
          {count}
        </span>
      ) : null}
      {group ? (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onEdit?.()
          }}
          className={`absolute bottom-1.5 right-1.5 inline-flex h-5 w-5 items-center justify-center rounded border bg-white/85 shadow-sm backdrop-blur-sm transition-colors ${
            active
              ? 'border-blue-200 text-blue-700 hover:bg-blue-50'
              : 'border-amber-200 text-amber-800 hover:bg-amber-50'
          }`}
          aria-label={zh(`编辑收藏夹 ${label}`, `Edit favorite ${label}`)}
        >
          <EditRoundedIcon sx={{ fontSize: 14 }} />
        </button>
      ) : null}
    </div>
  )
}
