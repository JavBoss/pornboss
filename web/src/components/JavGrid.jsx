import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IconButton, Popper, Rating, Tooltip } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined'
import CheckBoxOutlineBlankRoundedIcon from '@mui/icons-material/CheckBoxOutlineBlankRounded'
import CheckBoxRoundedIcon from '@mui/icons-material/CheckBoxRounded'
import { MovieEdit } from '@mui/icons-material'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import FavoriteBorderRoundedIcon from '@mui/icons-material/FavoriteBorderRounded'
import FavoriteRoundedIcon from '@mui/icons-material/FavoriteRounded'
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined'
import MovieCreationIcon from '@mui/icons-material/MovieCreation'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import PhotoLibraryOutlinedIcon from '@mui/icons-material/PhotoLibraryOutlined'
import RemoveCircleOutlineRoundedIcon from '@mui/icons-material/RemoveCircleOutlineRounded'
import SearchIcon from '@mui/icons-material/Search'
import StarBorderRoundedIcon from '@mui/icons-material/StarBorderRounded'
import StarRoundedIcon from '@mui/icons-material/StarRounded'
import VideocamOutlinedIcon from '@mui/icons-material/VideocamOutlined'
import VideoLibraryOutlinedIcon from '@mui/icons-material/VideoLibraryOutlined'

import {
  createJavIdol,
  createJavScrapedTag,
  createJavTag,
  fetchJavIdolPreview,
  fetchJavIdolOptions,
  fetchJavSeriesPreview,
  fetchJavSeries,
  fetchJavStudioPreview,
  fetchJavStudios,
  updateJavItem,
} from '@/api'
import JavDetailModal from '@/components/JavDetailModal'
import AppModal from '@/components/AppModal'
import JavIdolCoverModal from '@/components/JavIdolCoverModal'
import { IdolCard, JavIdolEditModal, getIdolCardLayoutProps } from '@/components/JavIdolGrid'
import { SeriesCard } from '@/components/JavSeriesView'
import { StudioCard } from '@/components/JavStudioView'
import { openJavDBWithAssist } from '@/utils/javdb'
import VideoGrid from '@/components/VideoGrid'
import { isUserJavTag } from '@/constants/jav'
import { getJavDisplayTitle } from '@/utils/jav'
import { findJavEditOptionByName } from '@/utils/javEdit'
import { getIdolDisplayName, getIdolDisplayNames } from '@/utils/javIdol'
import { getJavTagDisplayName, withJavTagDisplayName } from '@/utils/javTag'
import { useStore, videoSelectionKey } from '@/store'
import { zh } from '@/utils/i18n'
import { getErrorMessage } from '@/utils/errors'

function DurationIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 shrink-0">
      <circle cx="10" cy="10" r="7" fill="#F59E0B" />
      <circle cx="10" cy="10" r="5.4" fill="#FEF3C7" />
      <path
        d="M10 6.7v3.5l2.5 1.6"
        fill="none"
        stroke="#7C3AED"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M7.4 2.8h5.2" fill="none" stroke="#EF4444" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function ReleaseIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 shrink-0">
      <rect x="3.1" y="4.1" width="13.8" height="12.8" rx="2.4" fill="#A78BFA" />
      <rect x="3.9" y="7" width="12.2" height="8.9" rx="1.7" fill="#FFF7ED" />
      <rect
        x="3.1"
        y="4.1"
        width="13.8"
        height="12.8"
        rx="2.4"
        fill="none"
        stroke="#7C3AED"
        strokeWidth="0.8"
      />
      <path
        d="M6.4 3.2v2.8M13.6 3.2v2.8"
        fill="none"
        stroke="#EC4899"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M5.8 8.8h8.4" fill="none" stroke="#F97316" strokeWidth="1.4" strokeLinecap="round" />
      <rect x="6.7" y="10.2" width="2.5" height="2.3" rx="0.5" fill="#22C55E" />
      <rect x="10.7" y="10.2" width="2.5" height="2.3" rx="0.5" fill="#3B82F6" />
      <rect x="6.7" y="13.4" width="2.5" height="2.3" rx="0.5" fill="#F43F5E" />
      <rect x="10.7" y="13.4" width="2.5" height="2.3" rx="0.5" fill="#14B8A6" />
    </svg>
  )
}

export default function JavGrid({
  items,
  selectedIds,
  onToggleSelect,
  selectionDisabled = false,
  columns = 0,
  titleMaxRows = 2,
  idolTagMaxRows = 2,
  tagMaxRows = 2,
  buildJavUrl,
  onPlay,
  onIdolClick,
  onOpenFavorites,
  onOpenJavFavorites,
  onOpenStudioFavorites,
  onOpenSeriesFavorites,
  onPrefixClick,
  onStudioClick,
  onSeriesClick,
  onTagClick,
  onOpenFile,
  openFileLabel,
  onOpenScreenshots,
  onManageVideoPlay,
  onManageVideoPlayAtTime,
  onManageVideoCoverChanged,
  onManageVideoOpenFile,
  onManageVideoRevealFile,
  onManageVideoOpenTagPicker,
  onManageVideoOpenScreenshots,
  onManageVideoOpenScrapeSettings,
  onManageVideoRename,
  onManageVideoDelete,
  onManageVideoTagClick,
}) {
  const directoryVisibilityKey = useStore((state) =>
    (state.directories || [])
      .map((directory) => `${directory.id}:${directory.enabled !== false ? '1' : '0'}`)
      .join(',')
  )
  const preferChineseName = useStore((state) =>
    configFlag(state.config?.jav_idol_prefer_chinese_name)
  )
  const hideSeries = useStore((state) => configFlag(state.config?.jav_hide_series))
  const hideIdols = useStore((state) => configFlag(state.config?.jav_hide_idols))
  const hideTags = useStore((state) => configFlag(state.config?.jav_hide_tags))
  const hideActions = useStore((state) => configFlag(state.config?.jav_hide_actions))
  const showFullFavoriteRating = useStore((state) =>
    configFlag(state.config?.jav_favorite_rating_show_full, false)
  )
  const showSimplifiedTags = useStore((state) => configFlag(state.config?.jav_tag_show_simplified))
  const displayItems = useMemo(() => {
    if (!showSimplifiedTags) return items
    return (items || []).map((item) => ({
      ...item,
      tags: Array.isArray(item?.tags)
        ? item.tags.map((tag) => withJavTagDisplayName(tag, true))
        : item?.tags,
    }))
  }, [items, showSimplifiedTags])
  const idolPreviewCacheRef = useRef(new Map())
  const idolPreviewInflightRef = useRef(new Map())
  const studioPreviewCacheRef = useRef(new Map())
  const studioPreviewInflightRef = useRef(new Map())
  const seriesPreviewCacheRef = useRef(new Map())
  const seriesPreviewInflightRef = useRef(new Map())
  const [coverPreview, setCoverPreview] = useState(null)
  const [videoManagerItem, setVideoManagerItem] = useState(null)
  const activeVideoManagerItem = useMemo(() => {
    if (!videoManagerItem) return null
    const managerID = Number(videoManagerItem?.id)
    const managerCode = String(videoManagerItem?.code || '').trim()
    return (
      (items || []).find((item) => {
        if (Number.isFinite(managerID) && managerID > 0 && Number(item?.id) === managerID) {
          return true
        }
        return managerCode && String(item?.code || '').trim() === managerCode
      }) || videoManagerItem
    )
  }, [items, videoManagerItem])
  const hasItems = Array.isArray(displayItems) && displayItems.length > 0
  const columnCount = Number.isFinite(Number(columns)) ? Math.floor(Number(columns)) : 0
  const fixedColumnCount = columnCount > 0 ? Math.min(columnCount, 12) : 0
  const gridClassName = 'grid gap-4'
  const gridStyle = fixedColumnCount
    ? { gridTemplateColumns: `repeat(${fixedColumnCount}, minmax(0, 1fr))` }
    : { gridTemplateColumns: 'repeat(auto-fill, minmax(21rem, 1fr))' }

  const loadIdolPreview = async (idol) => {
    const idolId = Number(idol?.id)
    if (!Number.isFinite(idolId) || idolId <= 0) {
      return idol || null
    }

    const cacheKey = `${idolId}|${directoryVisibilityKey}`
    const cached = idolPreviewCacheRef.current.get(cacheKey)
    if (cached) {
      return cached
    }

    const inflight = idolPreviewInflightRef.current.get(cacheKey)
    if (inflight) {
      return inflight
    }

    const request = fetchJavIdolPreview(idolId)
      .then((preview) => {
        idolPreviewCacheRef.current.set(cacheKey, preview)
        return preview
      })
      .finally(() => {
        idolPreviewInflightRef.current.delete(cacheKey)
      })
    idolPreviewInflightRef.current.set(cacheKey, request)
    return request
  }

  const loadStudioPreview = async (studio) => {
    const studioId = Number(studio?.id)
    if (!Number.isFinite(studioId) || studioId <= 0) {
      return studio || null
    }

    const cacheKey = `${studioId}|${directoryVisibilityKey}`
    const cached = studioPreviewCacheRef.current.get(cacheKey)
    if (cached) {
      return cached
    }

    const inflight = studioPreviewInflightRef.current.get(cacheKey)
    if (inflight) {
      return inflight
    }

    const request = fetchJavStudioPreview(studioId)
      .then((preview) => {
        studioPreviewCacheRef.current.set(cacheKey, preview)
        return preview
      })
      .finally(() => {
        studioPreviewInflightRef.current.delete(cacheKey)
      })
    studioPreviewInflightRef.current.set(cacheKey, request)
    return request
  }

  const loadSeriesPreview = async (series) => {
    const seriesId = Number(series?.id)
    if (!Number.isFinite(seriesId) || seriesId <= 0) {
      return series || null
    }

    const cacheKey = `${seriesId}|${directoryVisibilityKey}`
    const cached = seriesPreviewCacheRef.current.get(cacheKey)
    if (cached) {
      return cached
    }

    const inflight = seriesPreviewInflightRef.current.get(cacheKey)
    if (inflight) {
      return inflight
    }

    const request = fetchJavSeriesPreview(seriesId)
      .then((preview) => {
        seriesPreviewCacheRef.current.set(cacheKey, preview)
        return preview
      })
      .finally(() => {
        seriesPreviewInflightRef.current.delete(cacheKey)
      })
    seriesPreviewInflightRef.current.set(cacheKey, request)
    return request
  }

  const handleIdolPreviewUpdated = (updated) => {
    const idolId = Number(updated?.id)
    if (!Number.isFinite(idolId) || idolId <= 0) return
    for (const [key, cached] of idolPreviewCacheRef.current.entries()) {
      if (String(key).startsWith(`${idolId}|`)) {
        idolPreviewCacheRef.current.set(key, { ...cached, ...updated })
      }
    }
  }

  if (!hasItems) {
    return (
      <div className="mt-4 flex min-h-[200px] items-center justify-center rounded border border-dashed border-gray-200 text-gray-500">
        {zh('暂无 JAV 数据', 'No JAV data')}
      </div>
    )
  }

  return (
    <>
      <div className={gridClassName} style={gridStyle}>
        {displayItems.map((item) => (
          <JavCard
            key={item.id || item.code}
            item={item}
            checked={selectedIds?.has(Number(item.id)) || false}
            onToggleSelect={onToggleSelect}
            selectionDisabled={selectionDisabled}
            onPlay={onPlay}
            buildJavUrl={buildJavUrl}
            onIdolClick={onIdolClick}
            onOpenFavorites={onOpenFavorites}
            onOpenJavFavorites={onOpenJavFavorites}
            onOpenStudioFavorites={onOpenStudioFavorites}
            onOpenSeriesFavorites={onOpenSeriesFavorites}
            onPrefixClick={onPrefixClick}
            onStudioClick={onStudioClick}
            onSeriesClick={onSeriesClick}
            onTagClick={onTagClick}
            onOpenFile={onOpenFile}
            openFileLabel={openFileLabel}
            onOpenScreenshots={onOpenScreenshots}
            onOpenVideoManager={setVideoManagerItem}
            onManageVideoPlay={onManageVideoPlay}
            onManageVideoPlayAtTime={onManageVideoPlayAtTime}
            onManageVideoCoverChanged={onManageVideoCoverChanged}
            onManageVideoOpenFile={onManageVideoOpenFile}
            onManageVideoRevealFile={onManageVideoRevealFile}
            onManageVideoOpenTagPicker={onManageVideoOpenTagPicker}
            onManageVideoOpenScreenshots={onManageVideoOpenScreenshots}
            onManageVideoOpenScrapeSettings={onManageVideoOpenScrapeSettings}
            onManageVideoRename={onManageVideoRename}
            onManageVideoDelete={onManageVideoDelete}
            onManageVideoTagClick={onManageVideoTagClick}
            loadIdolPreview={loadIdolPreview}
            loadStudioPreview={loadStudioPreview}
            loadSeriesPreview={loadSeriesPreview}
            onIdolPreviewUpdated={handleIdolPreviewUpdated}
            onOpenCoverPreview={setCoverPreview}
            preferChineseName={preferChineseName}
            titleMaxRows={titleMaxRows}
            idolTagMaxRows={idolTagMaxRows}
            tagMaxRows={tagMaxRows}
            hideSeries={hideSeries}
            hideIdols={hideIdols}
            hideTags={hideTags}
            hideActions={hideActions}
            showFullFavoriteRating={showFullFavoriteRating}
          />
        ))}
      </div>
      {coverPreview ? (
        <CoverPreviewModal preview={coverPreview} onClose={() => setCoverPreview(null)} />
      ) : null}
      <JavVideoManagerModal
        open={Boolean(videoManagerItem)}
        item={activeVideoManagerItem}
        openFileLabel={openFileLabel}
        onClose={() => setVideoManagerItem(null)}
        onPlay={onManageVideoPlay}
        onOpenFile={onManageVideoOpenFile}
        onRevealFile={onManageVideoRevealFile}
        onOpenTagPicker={onManageVideoOpenTagPicker}
        onOpenScreenshots={onManageVideoOpenScreenshots}
        onOpenScrapeSettings={onManageVideoOpenScrapeSettings}
        onRenameVideo={onManageVideoRename}
        onDeleteVideo={onManageVideoDelete}
        onTagClick={onManageVideoTagClick}
      />
    </>
  )
}

function CoverPreviewModal({ preview, onClose }) {
  const [scale, setScale] = useState(1)

  useEffect(() => {
    if (!preview?.src) return undefined

    const handleWheel = (event) => {
      event.preventDefault()
      event.stopPropagation()
      const direction = event.deltaY < 0 ? 1 : -1
      setScale((current) => Math.min(5, Math.max(0.5, current + direction * 0.2)))
    }

    window.addEventListener('wheel', handleWheel, { passive: false, capture: true })

    return () => {
      window.removeEventListener('wheel', handleWheel, true)
    }
  }, [preview?.src])

  if (!preview?.src) return null

  return (
    <AppModal
      ariaLabel={zh('封面预览', 'Cover preview')}
      className="p-4"
      contentClassName="relative flex max-h-[92vh] max-w-[94vw] items-center justify-center"
      onClose={onClose}
      zIndex={1500}
    >
      <button
        type="button"
        onClick={onClose}
        className="fixed right-4 top-4 z-10 rounded bg-black/50 px-3 py-1 text-xl leading-none text-white hover:bg-black/70"
        aria-label={zh('关闭封面预览', 'Close cover preview')}
      >
        ×
      </button>
      <img
        src={preview.src}
        alt={preview.alt || zh('JAV 封面', 'JAV cover')}
        className="max-h-[92vh] max-w-[94vw] transform-gpu cursor-zoom-in object-contain shadow-2xl"
        style={{ transform: `scale(${scale})` }}
      />
    </AppModal>
  )
}

function formatDateInputFromUnix(value) {
  const unix = Number(value)
  if (!Number.isFinite(unix) || unix <= 0) return ''
  return new Date(unix * 1000).toISOString().slice(0, 10)
}

const JAV_EDIT_FETCH_LIMIT = 500

async function fetchAllJavEditOptions(fetcher) {
  const all = []
  let offset = 0
  let total = null
  while (total == null || offset < total) {
    const resp = await fetcher({
      limit: JAV_EDIT_FETCH_LIMIT,
      offset,
      search: '',
    })
    const items = Array.isArray(resp?.items) ? resp.items : []
    all.push(...items)
    total = Number.isFinite(Number(resp?.total)) ? Number(resp.total) : all.length
    if (items.length === 0) break
    offset += items.length
  }
  return all
}

function mergeOptionsById(options, selectedOptions) {
  const map = new Map()
  for (const option of [...(selectedOptions || []), ...(options || [])]) {
    const id = Number(option?.id)
    if (Number.isFinite(id) && id > 0) {
      map.set(id, option)
    }
  }
  return Array.from(map.values())
}

function configFlag(value, fallback = false) {
  if (value == null || value === '') return fallback
  return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase())
}

function filterOptionsByName(options, search, getSearchText = (option) => option?.name) {
  const q = String(search || '')
    .trim()
    .toLowerCase()
  if (!q) return options
  return (options || []).filter((option) =>
    String(getSearchText(option) || '')
      .toLowerCase()
      .includes(q)
  )
}

function buildIdolSearchText(idol, preferChineseName) {
  const aliases = Array.isArray(idol?.aliases) ? idol.aliases : []
  return [
    getIdolDisplayName(idol, preferChineseName),
    idol?.name,
    idol?.roman_name,
    idol?.japanese_name,
    idol?.chinese_name,
    ...aliases,
  ]
    .filter(Boolean)
    .join(' ')
}

function javEditIdolNames(idol, preferChineseName) {
  return [
    getIdolDisplayName(idol, preferChineseName),
    idol?.name,
    idol?.roman_name,
    idol?.japanese_name,
    idol?.chinese_name,
    ...(Array.isArray(idol?.aliases) ? idol.aliases : []),
  ]
}

function javEditScrapedTagNames(tag, showSimplifiedTags) {
  return [
    tag?.original_name,
    tag?.name,
    tag?.simplified_name,
    getJavTagDisplayName(tag, showSimplifiedTags),
  ]
}

function javEditWorkCountLabel(value) {
  const count = Math.max(0, Number(value) || 0)
  return zh(`${count} 部作品`, `${count} works`)
}

function buildStudioSearchText(studio) {
  const aliases = Array.isArray(studio?.aliases) ? studio.aliases : []
  return [studio?.name, ...aliases].filter(Boolean).join(' ')
}

function includeSelectedOptions(options, allOptions, selectedIds) {
  const selectedSet = new Set((selectedIds || []).map((id) => String(id)))
  if (selectedSet.size === 0) return options
  const map = new Map((options || []).map((option) => [String(option?.id), option]))
  for (const option of allOptions || []) {
    const id = String(option?.id)
    if (selectedSet.has(id) && !map.has(id)) {
      map.set(id, option)
    }
  }
  return Array.from(map.values())
}

function optionById(options, id) {
  const key = String(id || '')
  if (!key) return null
  return (options || []).find((option) => String(option?.id) === key) || null
}

function optionsByIds(options, ids) {
  const lookup = new Map((options || []).map((option) => [String(option?.id), option]))
  return (ids || []).map((id) => lookup.get(String(id))).filter(Boolean)
}

function useCloseOnOutsidePointer(open, rootRef, onOpenChange) {
  useEffect(() => {
    if (!open) return undefined

    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        onOpenChange?.(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [onOpenChange, open, rootRef])
}

function JavEditDropdown({
  label,
  selectedId,
  options,
  search,
  onSearchChange,
  onSelect,
  open,
  onOpenChange,
  emptyLabel,
  searchPlaceholder,
  disabled,
}) {
  const rootRef = useRef(null)
  const selected = optionById(options, selectedId)
  useCloseOnOutsidePointer(open, rootRef, onOpenChange)

  return (
    <div ref={rootRef} className="relative">
      <div className="block text-[13px] font-semibold text-black">{label}</div>
      <button
        type="button"
        className="mt-2 flex w-full items-center justify-between rounded-md border border-gray-300 bg-white px-3 py-2 text-left text-sm text-gray-900 outline-none hover:border-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
        onClick={() => onOpenChange?.(!open)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="min-w-0 truncate">{selected?.name || emptyLabel}</span>
        <span
          aria-hidden="true"
          className={`ml-2 h-1.5 w-1.5 shrink-0 rotate-45 border-b border-r border-gray-400 transition-transform ${
            open ? 'rotate-[225deg]' : ''
          }`}
        />
      </button>
      {open ? (
        <div className="absolute left-0 right-0 z-20 mt-1 rounded-md border border-gray-200 bg-white p-2 shadow-xl">
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange?.(event.target.value)}
            placeholder={searchPlaceholder}
            className="mb-2 w-full rounded border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
          <div className="max-h-52 overflow-y-auto" role="listbox">
            <button
              type="button"
              className={`block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-gray-50 ${
                selectedId ? 'text-gray-700' : 'bg-blue-50 text-blue-700'
              }`}
              onClick={() => {
                onSelect?.('')
                onOpenChange?.(false)
              }}
            >
              {emptyLabel}
            </button>
            {options.map((option) => {
              const active = String(option.id) === String(selectedId || '')
              return (
                <button
                  key={option.id}
                  type="button"
                  className={`block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-gray-50 ${
                    active ? 'bg-blue-50 text-blue-700' : 'text-gray-800'
                  }`}
                  onClick={() => {
                    onSelect?.(String(option.id))
                    onOpenChange?.(false)
                  }}
                  role="option"
                  aria-selected={active}
                >
                  {option.name}
                </button>
              )
            })}
            {options.length === 0 ? (
              <div className="px-2 py-1.5 text-sm text-gray-500">
                {zh('没有匹配结果', 'No matches')}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function SelectedChip({ label, onRemove, disabled, compact = false }) {
  return (
    <span
      className={`inline-flex min-w-0 items-center rounded-full bg-gray-100 text-gray-800 ${
        compact ? 'gap-0.5 px-1.5 py-0.5 text-xs' : 'gap-1 px-2 py-1 text-sm'
      }`}
    >
      <span className="truncate">{label}</span>
      <button
        type="button"
        className={`inline-flex shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-200 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50 ${
          compact ? 'h-3.5 w-3.5' : 'h-4 w-4'
        }`}
        onClick={onRemove}
        disabled={disabled}
        aria-label={zh(`移除 ${label}`, `Remove ${label}`)}
      >
        <CloseOutlinedIcon sx={{ fontSize: compact ? 11 : 13 }} />
      </button>
    </span>
  )
}

function editableJavTitle(item) {
  return String(item?.title || '')
}

function JavCustomTagModal({ open, item, onClose, onSaved }) {
  const tagOptions = useStore((state) => state.javTagOptions || [])
  const loadJavTags = useStore((state) => state.loadJavTags)
  const [selectedTagIds, setSelectedTagIds] = useState([])
  const [createdTags, setCreatedTags] = useState([])
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const code = String(item?.code || '').trim()
  const currentUserTags = useMemo(
    () => (Array.isArray(item?.tags) ? item.tags.filter((tag) => isUserJavTag(tag)) : []),
    [item?.tags]
  )
  const userTagOptions = useMemo(() => tagOptions.filter((tag) => isUserJavTag(tag)), [tagOptions])
  const mergedTagOptions = useMemo(
    () => mergeOptionsById(userTagOptions, [...currentUserTags, ...createdTags]),
    [createdTags, currentUserTags, userTagOptions]
  )
  const visibleTagOptions = useMemo(
    () => filterOptionsByName(mergedTagOptions, search),
    [mergedTagOptions, search]
  )
  const selectedTags = useMemo(
    () => optionsByIds(mergedTagOptions, selectedTagIds),
    [mergedTagOptions, selectedTagIds]
  )
  const exactMatch = useMemo(() => {
    const name = search.trim()
    if (!name) return null
    return mergedTagOptions.find((tag) => String(tag?.name || '').trim() === name) || null
  }, [mergedTagOptions, search])

  useEffect(() => {
    if (!open) return
    setSelectedTagIds(currentUserTags.map((tag) => String(tag.id)))
    setCreatedTags([])
    setSearch('')
    setSaving(false)
    setCreating(false)
    setError('')
    void loadJavTags?.({ skipUnchanged: true })
  }, [currentUserTags, loadJavTags, open])

  if (!open) return null

  const toggleTag = (tagId) => {
    const id = String(tagId)
    setSelectedTagIds((current) =>
      current.includes(id) ? current.filter((currentId) => currentId !== id) : [...current, id]
    )
    if (error) setError('')
  }

  const addCustomTag = async () => {
    const name = search.trim()
    if (!name || creating || saving) return
    if (exactMatch?.id) {
      const id = String(exactMatch.id)
      setSelectedTagIds((current) => (current.includes(id) ? current : [...current, id]))
      setSearch('')
      return
    }

    setCreating(true)
    setError('')
    try {
      const created = await createJavTag(name)
      if (!created?.id) throw new Error(zh('创建自定义标签失败', 'Failed to create custom tag'))
      setCreatedTags((current) => mergeOptionsById(current, [created]))
      setSelectedTagIds((current) => [...new Set([...current, String(created.id)])])
      setSearch('')
      void loadJavTags?.({ force: true })
    } catch (createError) {
      setError(getErrorMessage(createError))
    } finally {
      setCreating(false)
    }
  }

  const handleSave = async () => {
    const javID = Number(item?.id)
    if (!Number.isFinite(javID) || javID <= 0) {
      setError(zh('缺少 JAV ID', 'Missing JAV ID'))
      return
    }

    setSaving(true)
    setError('')
    try {
      const updated = await updateJavItem(javID, {
        tag_ids: selectedTagIds.map((id) => Number(id)).filter((id) => id > 0),
      })
      void loadJavTags?.({ force: true })
      onSaved?.(updated)
    } catch (saveError) {
      setError(getErrorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppModal
      ariaLabel={zh('编辑自定义标签', 'Edit custom tags')}
      className="p-4"
      closeDisabled={saving || creating}
      contentClassName="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg bg-white shadow-2xl"
      onClose={onClose}
      zIndex={1600}
    >
      <div className="flex items-start justify-between gap-3 p-5 pb-3">
        <div className="min-w-0">
          <div className="text-base font-semibold text-gray-900">
            {zh('编辑自定义标签', 'Edit custom tags')}
          </div>
          {code ? <div className="mt-1 truncate text-xs text-gray-500">{code}</div> : null}
        </div>
        <button
          type="button"
          className="rounded px-2 py-1 text-xl leading-none text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          onClick={onClose}
          disabled={saving || creating}
          aria-label={zh('关闭', 'Close')}
        >
          ×
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-5">
        {selectedTags.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {selectedTags.map((tag) => (
              <SelectedChip
                key={tag.id}
                label={tag.name}
                disabled={saving || creating}
                onRemove={() => toggleTag(tag.id)}
              />
            ))}
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              if (error) setError('')
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
              event.preventDefault()
              void addCustomTag()
            }}
            placeholder={zh('搜索或输入新的自定义标签', 'Search or enter a new custom tag')}
            className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            disabled={saving || creating}
          />
          {search.trim() ? (
            <button
              type="button"
              className="shrink-0 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700 hover:bg-blue-100 disabled:cursor-wait disabled:opacity-60"
              onClick={() => void addCustomTag()}
              disabled={saving || creating}
            >
              {creating
                ? zh('创建中...', 'Creating...')
                : exactMatch
                  ? zh('选择', 'Select')
                  : zh('创建', 'Create')}
            </button>
          ) : null}
        </div>
        <div className="max-h-64 overflow-y-auto rounded-md border border-gray-200 p-1">
          {visibleTagOptions.length > 0 ? (
            visibleTagOptions.map((tag) => {
              const checked = selectedTagIds.includes(String(tag.id))
              return (
                <button
                  key={tag.id}
                  type="button"
                  className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-gray-50 ${
                    checked ? 'bg-blue-50 text-blue-800' : 'text-gray-800'
                  }`}
                  onClick={() => toggleTag(tag.id)}
                  disabled={saving || creating}
                  aria-pressed={checked}
                >
                  <span
                    aria-hidden="true"
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[11px] ${
                      checked
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-gray-300 bg-white text-transparent'
                    }`}
                  >
                    ✓
                  </span>
                  <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-gray-400">
                    {Math.max(0, Number(tag?.count) || 0)}
                  </span>
                </button>
              )
            })
          ) : (
            <div className="px-2 py-4 text-center text-sm text-gray-500">
              {search.trim()
                ? zh('没有匹配标签，可直接创建', 'No matching tags; create it directly')
                : zh('暂无自定义标签', 'No custom tags')}
            </div>
          )}
        </div>
        {error ? <div className="text-sm text-red-600">{error}</div> : null}
      </div>
      <div className="flex justify-end gap-2 border-t border-gray-200 p-5">
        <button
          type="button"
          className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onClose}
          disabled={saving || creating}
        >
          {zh('取消', 'Cancel')}
        </button>
        <button
          type="button"
          className={`rounded-md px-4 py-2 text-sm font-medium text-white ${
            saving ? 'cursor-wait bg-blue-400' : 'bg-blue-600 hover:bg-blue-700'
          }`}
          onClick={() => void handleSave()}
          disabled={saving || creating}
        >
          {saving ? zh('保存中...', 'Saving...') : zh('保存', 'Save')}
        </button>
      </div>
    </AppModal>
  )
}

function JavEditModal({ open, item, preferChineseName = false, onClose, onSaved }) {
  const tagOptions = useStore((state) => state.javTagOptions || [])
  const loadJavTags = useStore((state) => state.loadJavTags)
  const showSimplifiedTags = useStore((state) => configFlag(state.config?.jav_tag_show_simplified))
  const [title, setTitle] = useState('')
  const [coverUrl, setCoverUrl] = useState('')
  const [selectedTagIds, setSelectedTagIds] = useState([])
  const [selectedIdolIds, setSelectedIdolIds] = useState([])
  const [selectedScrapedTagIds, setSelectedScrapedTagIds] = useState([])
  const [createdUserTags, setCreatedUserTags] = useState([])
  const [createdScrapedTags, setCreatedScrapedTags] = useState([])
  const [createdIdols, setCreatedIdols] = useState([])
  const [selectedStudioId, setSelectedStudioId] = useState('')
  const [selectedSeriesId, setSelectedSeriesId] = useState('')
  const [idolOptions, setIdolOptions] = useState([])
  const [studioOptions, setStudioOptions] = useState([])
  const [seriesOptions, setSeriesOptions] = useState([])
  const [idolSearch, setIdolSearch] = useState('')
  const [tagSearch, setTagSearch] = useState('')
  const [scrapedTagSearch, setScrapedTagSearch] = useState('')
  const [studioSearch, setStudioSearch] = useState('')
  const [seriesSearch, setSeriesSearch] = useState('')
  const [idolPickerOpen, setIdolPickerOpen] = useState(false)
  const [tagPickerOpen, setTagPickerOpen] = useState(false)
  const [scrapedTagPickerOpen, setScrapedTagPickerOpen] = useState(false)
  const [studioDropdownOpen, setStudioDropdownOpen] = useState(false)
  const [seriesDropdownOpen, setSeriesDropdownOpen] = useState(false)
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [tagOptionsLoading, setTagOptionsLoading] = useState(false)
  const [optionsError, setOptionsError] = useState('')
  const [releaseDate, setReleaseDate] = useState('')
  const [durationMin, setDurationMin] = useState('')
  const [saving, setSaving] = useState(false)
  const [creatingUserTag, setCreatingUserTag] = useState(false)
  const [creatingScrapedTag, setCreatingScrapedTag] = useState(false)
  const [creatingIdol, setCreatingIdol] = useState(false)
  const [error, setError] = useState('')
  const idolPickerRef = useRef(null)
  const scrapedTagPickerRef = useRef(null)
  const tagPickerRef = useRef(null)
  useCloseOnOutsidePointer(idolPickerOpen, idolPickerRef, setIdolPickerOpen)
  useCloseOnOutsidePointer(scrapedTagPickerOpen, scrapedTagPickerRef, setScrapedTagPickerOpen)
  useCloseOnOutsidePointer(tagPickerOpen, tagPickerRef, setTagPickerOpen)
  const code = String(item?.code || '').trim()
  const userTagOptions = useMemo(() => tagOptions.filter((tag) => isUserJavTag(tag)), [tagOptions])
  const scrapedTagOptions = useMemo(
    () => tagOptions.filter((tag) => !isUserJavTag(tag)),
    [tagOptions]
  )
  const currentScrapedTags = useMemo(
    () => (Array.isArray(item?.tags) ? item.tags.filter((tag) => !isUserJavTag(tag)) : []),
    [item?.tags]
  )
  const currentUserTags = useMemo(
    () => (Array.isArray(item?.tags) ? item.tags.filter((tag) => isUserJavTag(tag)) : []),
    [item?.tags]
  )
  const currentSeries = item?.series
  const mergedUserTagOptions = useMemo(
    () => mergeOptionsById(userTagOptions, [...currentUserTags, ...createdUserTags]),
    [createdUserTags, currentUserTags, userTagOptions]
  )
  const mergedScrapedTagOptions = useMemo(
    () => mergeOptionsById(scrapedTagOptions, [...currentScrapedTags, ...createdScrapedTags]),
    [createdScrapedTags, currentScrapedTags, scrapedTagOptions]
  )
  const mergedStudioOptions = useMemo(
    () => mergeOptionsById(studioOptions, item?.studio ? [item.studio] : []),
    [item?.studio, studioOptions]
  )
  const mergedSeriesOptions = useMemo(
    () => mergeOptionsById(seriesOptions, currentSeries ? [currentSeries] : []),
    [currentSeries, seriesOptions]
  )
  const mergedIdolOptions = useMemo(
    () =>
      mergeOptionsById(idolOptions, [
        ...(Array.isArray(item?.idols) ? item.idols : []),
        ...createdIdols,
      ]),
    [createdIdols, idolOptions, item?.idols]
  )
  const visibleStudioOptions = useMemo(
    () =>
      includeSelectedOptions(
        filterOptionsByName(mergedStudioOptions, studioSearch, buildStudioSearchText),
        mergedStudioOptions,
        [selectedStudioId]
      ),
    [mergedStudioOptions, selectedStudioId, studioSearch]
  )
  const visibleSeriesOptions = useMemo(
    () =>
      includeSelectedOptions(
        filterOptionsByName(mergedSeriesOptions, seriesSearch),
        mergedSeriesOptions,
        [selectedSeriesId]
      ),
    [mergedSeriesOptions, selectedSeriesId, seriesSearch]
  )
  const visibleIdolOptions = useMemo(
    () =>
      includeSelectedOptions(
        filterOptionsByName(mergedIdolOptions, idolSearch, (idol) =>
          buildIdolSearchText(idol, preferChineseName)
        ),
        mergedIdolOptions,
        selectedIdolIds
      ),
    [idolSearch, mergedIdolOptions, preferChineseName, selectedIdolIds]
  )
  const visibleTagOptions = useMemo(
    () =>
      includeSelectedOptions(
        filterOptionsByName(mergedUserTagOptions, tagSearch),
        mergedUserTagOptions,
        selectedTagIds
      ),
    [mergedUserTagOptions, selectedTagIds, tagSearch]
  )
  const visibleScrapedTagOptions = useMemo(
    () =>
      filterOptionsByName(mergedScrapedTagOptions, scrapedTagSearch, (tag) =>
        [tag?.original_name, tag?.name, tag?.simplified_name, getJavTagDisplayName(tag, true)]
          .filter(Boolean)
          .join(' ')
      ),
    [mergedScrapedTagOptions, scrapedTagSearch]
  )
  const selectedIdolOptions = useMemo(
    () => optionsByIds(mergedIdolOptions, selectedIdolIds),
    [mergedIdolOptions, selectedIdolIds]
  )
  const selectedTagOptions = useMemo(
    () => optionsByIds(mergedUserTagOptions, selectedTagIds),
    [mergedUserTagOptions, selectedTagIds]
  )
  const selectedScrapedTagOptions = useMemo(
    () => optionsByIds(mergedScrapedTagOptions, selectedScrapedTagIds),
    [mergedScrapedTagOptions, selectedScrapedTagIds]
  )
  const matchingIdolOption = useMemo(
    () =>
      findJavEditOptionByName(mergedIdolOptions, idolSearch, (idol) =>
        javEditIdolNames(idol, preferChineseName)
      ),
    [idolSearch, mergedIdolOptions, preferChineseName]
  )
  const matchingScrapedTagOption = useMemo(
    () =>
      findJavEditOptionByName(mergedScrapedTagOptions, scrapedTagSearch, (tag) =>
        javEditScrapedTagNames(tag, showSimplifiedTags)
      ),
    [mergedScrapedTagOptions, scrapedTagSearch, showSimplifiedTags]
  )
  const matchingUserTagOption = useMemo(
    () => findJavEditOptionByName(mergedUserTagOptions, tagSearch),
    [mergedUserTagOptions, tagSearch]
  )
  const availableIdolOptions = useMemo(
    () => visibleIdolOptions.filter((idol) => !selectedIdolIds.includes(String(idol.id))),
    [selectedIdolIds, visibleIdolOptions]
  )
  const availableTagOptions = useMemo(
    () => visibleTagOptions.filter((tag) => !selectedTagIds.includes(String(tag.id))),
    [selectedTagIds, visibleTagOptions]
  )
  const availableScrapedTagOptions = useMemo(
    () => visibleScrapedTagOptions.filter((tag) => !selectedScrapedTagIds.includes(String(tag.id))),
    [selectedScrapedTagIds, visibleScrapedTagOptions]
  )

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    setTitle(editableJavTitle(item))
    setCoverUrl('')
    setSelectedTagIds(
      Array.isArray(item?.tags)
        ? item.tags.filter((tag) => isUserJavTag(tag)).map((tag) => String(tag.id))
        : []
    )
    setSelectedIdolIds(
      Array.isArray(item?.idols)
        ? item.idols
            .map((idol) => Number(idol?.id))
            .filter((id) => Number.isFinite(id) && id > 0)
            .map((id) => String(id))
        : []
    )
    setSelectedScrapedTagIds(currentScrapedTags.map((tag) => String(tag.id)))
    setCreatedUserTags([])
    setCreatedScrapedTags([])
    setCreatedIdols([])
    setSelectedStudioId(item?.studio?.id ? String(item.studio.id) : '')
    setSelectedSeriesId(currentSeries?.id ? String(currentSeries.id) : '')
    setIdolSearch('')
    setTagSearch('')
    setScrapedTagSearch('')
    setStudioSearch('')
    setSeriesSearch('')
    setIdolPickerOpen(false)
    setTagPickerOpen(false)
    setScrapedTagPickerOpen(false)
    setStudioDropdownOpen(false)
    setSeriesDropdownOpen(false)
    setOptionsError('')
    setReleaseDate(formatDateInputFromUnix(item?.release_unix))
    setDurationMin(item?.duration_min ? String(item.duration_min) : '')
    setError('')
    setSaving(false)
    setCreatingUserTag(false)
    setCreatingScrapedTag(false)
    setCreatingIdol(false)
    setTagOptionsLoading(true)
    Promise.resolve(loadJavTags?.({ skipUnchanged: true })).finally(() => {
      if (!cancelled) setTagOptionsLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [currentScrapedTags, currentSeries?.id, item, loadJavTags, open])

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    setOptionsLoading(true)
    setOptionsError('')
    Promise.all([
      fetchAllJavEditOptions(fetchJavStudios),
      fetchAllJavEditOptions(fetchJavSeries),
      fetchAllJavEditOptions(fetchJavIdolOptions),
    ])
      .then(([studios, series, idols]) => {
        if (cancelled) return
        setStudioOptions(studios)
        setSeriesOptions(series)
        setIdolOptions(idols)
      })
      .catch((err) => {
        if (cancelled) return
        setOptionsError(getErrorMessage(err))
        setStudioOptions([])
        setSeriesOptions([])
        setIdolOptions([])
      })
      .finally(() => {
        if (!cancelled) setOptionsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  if (!open) return null

  const toggleTag = (tagId, checked) => {
    const id = String(tagId)
    setSelectedTagIds((current) => {
      const next = new Set(current)
      if (checked) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return Array.from(next)
    })
  }

  const toggleIdol = (idolId, checked) => {
    const id = String(idolId)
    setSelectedIdolIds((current) => {
      const next = new Set(current)
      if (checked) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return Array.from(next)
    })
  }

  const addIdol = async () => {
    const name = idolSearch.trim()
    if (!name || creatingIdol || optionsLoading) return
    if (matchingIdolOption?.id) {
      toggleIdol(matchingIdolOption.id, true)
      setIdolSearch('')
      return
    }
    setCreatingIdol(true)
    setError('')
    try {
      const created = await createJavIdol(name)
      if (!created?.id) throw new Error(zh('创建女优失败', 'Failed to create idol'))
      setCreatedIdols((current) => mergeOptionsById(current, [created]))
      toggleIdol(created.id, true)
      setIdolSearch('')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setCreatingIdol(false)
    }
  }

  const addScrapedTag = async () => {
    const name = scrapedTagSearch.trim()
    if (!name || creatingScrapedTag || tagOptionsLoading) return
    if (matchingScrapedTagOption?.id) {
      setSelectedScrapedTagIds((current) =>
        Array.from(new Set([...current, String(matchingScrapedTagOption.id)]))
      )
      setScrapedTagSearch('')
      return
    }
    setCreatingScrapedTag(true)
    setError('')
    try {
      const created = await createJavScrapedTag(name)
      if (!created?.id) {
        throw new Error(zh('创建刮削标签失败', 'Failed to create scraped tag'))
      }
      setCreatedScrapedTags((current) => mergeOptionsById(current, [created]))
      setSelectedScrapedTagIds((current) => Array.from(new Set([...current, String(created.id)])))
      setScrapedTagSearch('')
      void loadJavTags?.({ force: true })
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setCreatingScrapedTag(false)
    }
  }

  const addCustomTag = async (value = tagSearch) => {
    const name = value.trim()
    if (!name || creatingUserTag) return
    if (matchingUserTagOption?.id) {
      toggleTag(matchingUserTagOption.id, true)
      setTagSearch('')
      return
    }
    setCreatingUserTag(true)
    setError('')
    try {
      const created = await createJavTag(name)
      if (!created?.id) throw new Error(zh('创建自定义标签失败', 'Failed to create custom tag'))
      setCreatedUserTags((current) => mergeOptionsById(current, [created]))
      toggleTag(created.id, true)
      setTagSearch('')
      void loadJavTags?.({ force: true })
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setCreatingUserTag(false)
    }
  }

  const handleSave = async () => {
    if (!item?.id) {
      setError(zh('缺少 JAV ID', 'Missing JAV ID'))
      return
    }
    const duration = durationMin === '' ? 0 : Math.floor(Number(durationMin))
    if (!Number.isFinite(duration) || duration < 0) {
      setError(zh('时长必须是非负数字', 'Duration must be a non-negative number'))
      return
    }
    setSaving(true)
    setError('')
    const trimmedCoverUrl = coverUrl.trim()
    try {
      const payload = {
        title: title.trim(),
        ...(trimmedCoverUrl ? { cover_url: trimmedCoverUrl } : {}),
        tag_ids: selectedTagIds.map((id) => Number(id)).filter(Boolean),
        idol_ids: selectedIdolIds.map((id) => Number(id)).filter(Boolean),
        scraped_tag_ids: selectedScrapedTagIds.map((id) => Number(id)).filter(Boolean),
        studio_id: selectedStudioId ? Number(selectedStudioId) : 0,
        series_id: selectedSeriesId ? Number(selectedSeriesId) : 0,
        release_date: releaseDate,
        duration_min: duration,
      }
      const updated = await updateJavItem(item.id, payload)
      void loadJavTags?.({ force: true })
      const normalizedUpdated = {
        ...updated,
        ...(payload.idol_ids.length === 0 ? { idols: [] } : {}),
        ...(payload.tag_ids.length === 0 &&
        payload.scraped_tag_ids.length === 0 &&
        !Array.isArray(updated?.tags)
          ? { tags: [] }
          : {}),
        ...(payload.studio_id ? {} : { studio_id: null, studio: null }),
        ...(payload.series_id ? {} : { series_id: null, series: null }),
      }
      onSaved?.(normalizedUpdated, Boolean(trimmedCoverUrl))
    } catch (err) {
      const message = getErrorMessage(err)
      setError(
        trimmedCoverUrl ? zh(`${message}。请重试。`, `${message}. Please try again.`) : message
      )
    } finally {
      setSaving(false)
    }
  }

  const creatingOption = creatingIdol || creatingScrapedTag || creatingUserTag

  return (
    <AppModal
      ariaLabel={zh('编辑 JAV 信息', 'Edit JAV info')}
      className="p-4"
      closeDisabled={saving || creatingOption}
      contentClassName="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-2xl"
      onClose={onClose}
      zIndex={1600}
    >
      <div className="mb-4 flex items-center gap-2 px-5 pt-5">
        <div className="shrink-0">
          <div className="text-base font-semibold text-gray-900">{zh('编辑 JAV', 'Edit JAV')}</div>
        </div>
        {code ? (
          <div className="max-w-[50%] truncate text-xs font-medium text-gray-700">{code}</div>
        ) : null}
        <button
          type="button"
          className="ml-auto rounded px-2 py-1 text-xl leading-none text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          onClick={onClose}
          disabled={saving || creatingOption}
          aria-label={zh('关闭', 'Close')}
        >
          ×
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5">
        <div>
          <label
            className="block text-[13px] font-semibold text-black"
            htmlFor={`jav-title-${item?.id || 'new'}`}
          >
            {zh('标题', 'Title')}
          </label>
          <textarea
            id={`jav-title-${item?.id || 'new'}`}
            rows={2}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value)
              if (error) setError('')
            }}
            className="mt-2 w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            disabled={saving}
          />
        </div>
        <div>
          <label
            className="block text-[13px] font-semibold text-black"
            htmlFor={`jav-cover-url-${item?.id || 'new'}`}
          >
            {zh('封面链接', 'Cover URL')}
          </label>
          <input
            id={`jav-cover-url-${item?.id || 'new'}`}
            type="url"
            value={coverUrl}
            onChange={(event) => {
              setCoverUrl(event.target.value)
              if (error) setError('')
            }}
            placeholder="https://..."
            className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            disabled={saving}
          />
          <div className="mt-1 text-xs text-gray-500">
            {zh(
              '当封面缺失或显示错误时，可手动输入封面图片链接；保存后会自动下载到本地并完成更新。',
              'If the cover is missing or incorrect, enter an image URL; saving downloads it locally and updates the cover.'
            )}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-[13px] font-semibold text-black">
            {zh('发行日期', 'Release date')}
            <input
              type="date"
              value={releaseDate}
              onChange={(event) => setReleaseDate(event.target.value)}
              className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              disabled={saving}
            />
          </label>
          <label className="block text-[13px] font-semibold text-black">
            {zh('时长（分钟）', 'Duration (min)')}
            <input
              type="number"
              min="0"
              step="1"
              value={durationMin}
              onChange={(event) => setDurationMin(event.target.value)}
              className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              disabled={saving}
            />
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <JavEditDropdown
            label={zh('片商', 'Studio')}
            selectedId={selectedStudioId}
            options={visibleStudioOptions}
            search={studioSearch}
            onSearchChange={setStudioSearch}
            onSelect={setSelectedStudioId}
            open={studioDropdownOpen}
            onOpenChange={setStudioDropdownOpen}
            emptyLabel={zh('无片商', 'No studio')}
            searchPlaceholder={zh('搜索已有片商', 'Search existing studios')}
            disabled={saving || optionsLoading}
          />
          <JavEditDropdown
            label={zh('系列', 'Series')}
            selectedId={selectedSeriesId}
            options={visibleSeriesOptions}
            search={seriesSearch}
            onSearchChange={setSeriesSearch}
            onSelect={setSelectedSeriesId}
            open={seriesDropdownOpen}
            onOpenChange={setSeriesDropdownOpen}
            emptyLabel={zh('无系列', 'No series')}
            searchPlaceholder={zh('搜索已有系列', 'Search existing series')}
            disabled={saving || optionsLoading}
          />
        </div>
        <div ref={idolPickerRef}>
          <div className="text-[13px] font-semibold text-black">{zh('女优', 'Idols')}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {selectedIdolOptions.map((idol) => (
              <SelectedChip
                key={idol.id}
                label={getIdolDisplayName(idol, preferChineseName)}
                disabled={saving}
                compact
                onRemove={() => toggleIdol(idol.id, false)}
              />
            ))}
            <button
              type="button"
              className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => {
                setIdolPickerOpen((current) => !current)
                setScrapedTagPickerOpen(false)
                setTagPickerOpen(false)
                setScrapedTagSearch('')
                setTagSearch('')
              }}
              disabled={saving || creatingIdol}
              title={zh('新增女优', 'Add idol')}
              aria-label={zh('新增女优', 'Add idol')}
            >
              <AddIcon sx={{ fontSize: 13 }} />
            </button>
          </div>
          {idolPickerOpen ? (
            <div className="mt-2 rounded-md border border-gray-200 p-2">
              <div className="mb-2 flex items-center gap-2">
                <input
                  type="text"
                  value={idolSearch}
                  onChange={(event) => setIdolSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                    event.preventDefault()
                    void addIdol()
                  }}
                  placeholder={zh('搜索或输入女优名称', 'Search or enter an idol name')}
                  className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  disabled={saving || creatingIdol || optionsLoading}
                />
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                  onClick={() => {
                    setIdolSearch('')
                    setIdolPickerOpen(false)
                  }}
                >
                  <CloseOutlinedIcon sx={{ fontSize: 14 }} />
                  {zh('完成', 'Done')}
                </button>
              </div>
              <div className="max-h-44 overflow-y-auto">
                {!optionsLoading && idolSearch.trim() && !matchingIdolOption ? (
                  <button
                    type="button"
                    className="mb-1 flex w-full items-center gap-1 rounded bg-blue-50 px-2 py-1.5 text-left text-sm text-blue-700 hover:bg-blue-100"
                    onClick={() => void addIdol()}
                    disabled={saving || creatingIdol}
                  >
                    <AddIcon sx={{ fontSize: 15 }} />
                    {creatingIdol
                      ? zh('创建中...', 'Creating...')
                      : zh(`新建“${idolSearch.trim()}”`, `Create “${idolSearch.trim()}”`)}
                  </button>
                ) : null}
                {optionsLoading ? (
                  <div className="px-2 py-1 text-sm text-gray-500">
                    {zh('加载中...', 'Loading...')}
                  </div>
                ) : availableIdolOptions.length === 0 && !idolSearch.trim() ? (
                  <div className="px-2 py-1 text-sm text-gray-500">
                    {zh('暂无可添加女优', 'No idols to add')}
                  </div>
                ) : (
                  availableIdolOptions.map((idol) => {
                    const { primaryName, secondaryName } = getIdolDisplayNames(idol, false)
                    return (
                      <button
                        key={idol.id}
                        type="button"
                        className="flex w-full items-center gap-3 rounded px-2 py-1.5 text-left text-sm text-gray-800 hover:bg-gray-50"
                        onClick={() => toggleIdol(idol.id, true)}
                        disabled={saving}
                      >
                        <span className="flex min-w-0 flex-1 items-baseline gap-2">
                          <span className="truncate">{primaryName}</span>
                          {secondaryName ? (
                            <span className="truncate text-xs text-gray-500">{secondaryName}</span>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-gray-400">
                          {javEditWorkCountLabel(idol?.work_count)}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          ) : null}
        </div>
        {optionsError ? <div className="text-sm text-red-600">{optionsError}</div> : null}
        <div ref={scrapedTagPickerRef}>
          <div className="text-[13px] font-semibold text-black">
            {zh('刮削标签', 'Scraped tags')}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {selectedScrapedTagOptions.map((tag) => (
              <SelectedChip
                key={tag.id}
                label={getJavTagDisplayName(tag, showSimplifiedTags)}
                disabled={saving}
                compact
                onRemove={() =>
                  setSelectedScrapedTagIds((current) =>
                    current.filter((id) => id !== String(tag.id))
                  )
                }
              />
            ))}
            <button
              type="button"
              className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => {
                setScrapedTagPickerOpen((current) => !current)
                setIdolPickerOpen(false)
                setTagPickerOpen(false)
                setIdolSearch('')
                setTagSearch('')
              }}
              disabled={saving || creatingScrapedTag}
              title={zh('新增刮削标签', 'Add scraped tag')}
              aria-label={zh('新增刮削标签', 'Add scraped tag')}
            >
              <AddIcon sx={{ fontSize: 13 }} />
            </button>
          </div>
          {scrapedTagPickerOpen ? (
            <div className="mt-2 rounded-md border border-gray-200 p-2">
              <div className="mb-2 flex items-center gap-2">
                <input
                  type="text"
                  value={scrapedTagSearch}
                  onChange={(event) => setScrapedTagSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                    event.preventDefault()
                    void addScrapedTag()
                  }}
                  placeholder={zh('搜索或输入刮削标签', 'Search or enter a scraped tag')}
                  className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  disabled={saving || creatingScrapedTag || tagOptionsLoading}
                />
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                  onClick={() => {
                    setScrapedTagSearch('')
                    setScrapedTagPickerOpen(false)
                  }}
                >
                  <CloseOutlinedIcon sx={{ fontSize: 14 }} />
                  {zh('完成', 'Done')}
                </button>
              </div>
              <div className="max-h-40 overflow-y-auto">
                {!tagOptionsLoading && scrapedTagSearch.trim() && !matchingScrapedTagOption ? (
                  <button
                    type="button"
                    className="mb-1 flex w-full items-center gap-1 rounded bg-blue-50 px-2 py-1.5 text-left text-sm text-blue-700 hover:bg-blue-100"
                    onClick={() => void addScrapedTag()}
                    disabled={saving || creatingScrapedTag}
                  >
                    <AddIcon sx={{ fontSize: 15 }} />
                    {creatingScrapedTag
                      ? zh('创建中...', 'Creating...')
                      : zh(
                          `新建“${scrapedTagSearch.trim()}”`,
                          `Create “${scrapedTagSearch.trim()}”`
                        )}
                  </button>
                ) : null}
                {tagOptionsLoading ? (
                  <div className="px-2 py-1 text-sm text-gray-500">
                    {zh('加载中...', 'Loading...')}
                  </div>
                ) : availableScrapedTagOptions.length === 0 && !scrapedTagSearch.trim() ? (
                  <div className="px-2 py-1 text-sm text-gray-500">
                    {zh('暂无可添加刮削标签', 'No scraped tags to add')}
                  </div>
                ) : (
                  availableScrapedTagOptions.map((tag) => (
                    <button
                      key={`${tag.id}-${tag.name}`}
                      type="button"
                      className="flex w-full items-center gap-3 rounded px-2 py-1.5 text-left text-sm text-gray-800 hover:bg-gray-50"
                      onClick={() =>
                        setSelectedScrapedTagIds((current) =>
                          Array.from(new Set([...current, String(tag.id)]))
                        )
                      }
                      disabled={saving}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {getJavTagDisplayName(tag, showSimplifiedTags)}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-gray-400">
                        {javEditWorkCountLabel(tag?.count)}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </div>
        <div ref={tagPickerRef}>
          <div className="text-[13px] font-semibold text-black">
            {zh('自定义标签', 'Custom tags')}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {selectedTagOptions.map((tag) => (
              <SelectedChip
                key={`${tag.id}-${tag.provider || 0}`}
                label={tag.name}
                disabled={saving}
                compact
                onRemove={() => toggleTag(tag.id, false)}
              />
            ))}
            <button
              type="button"
              className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => {
                setTagPickerOpen((current) => !current)
                setIdolPickerOpen(false)
                setScrapedTagPickerOpen(false)
                setIdolSearch('')
                setScrapedTagSearch('')
              }}
              disabled={saving || creatingUserTag}
              title={zh('新增自定义标签', 'Add custom tag')}
              aria-label={zh('新增自定义标签', 'Add custom tag')}
            >
              <AddIcon sx={{ fontSize: 13 }} />
            </button>
          </div>
          {tagPickerOpen ? (
            <div className="mt-2 rounded-md border border-gray-200 p-2">
              <div className="mb-2 flex items-center gap-2">
                <input
                  type="text"
                  value={tagSearch}
                  onChange={(event) => setTagSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                    event.preventDefault()
                    void addCustomTag()
                  }}
                  placeholder={zh('搜索或输入自定义标签', 'Search or enter a custom tag')}
                  className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  disabled={saving || creatingUserTag}
                />
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                  onClick={() => {
                    setTagSearch('')
                    setTagPickerOpen(false)
                  }}
                >
                  <CloseOutlinedIcon sx={{ fontSize: 14 }} />
                  {zh('完成', 'Done')}
                </button>
              </div>
              <div className="max-h-40 overflow-y-auto">
                {tagSearch.trim() && !matchingUserTagOption ? (
                  <button
                    type="button"
                    className="mb-1 flex w-full items-center gap-1 rounded bg-blue-50 px-2 py-1.5 text-left text-sm text-blue-700 hover:bg-blue-100 disabled:cursor-wait disabled:opacity-60"
                    onClick={() => void addCustomTag()}
                    disabled={saving || creatingUserTag}
                  >
                    <AddIcon sx={{ fontSize: 15 }} />
                    {creatingUserTag
                      ? zh('创建中...', 'Creating...')
                      : zh(`新建“${tagSearch.trim()}”`, `Create “${tagSearch.trim()}”`)}
                  </button>
                ) : null}
                {availableTagOptions.length === 0 && !tagSearch.trim() ? (
                  <div className="px-2 py-1 text-sm text-gray-500">
                    {zh('暂无可添加标签', 'No tags to add')}
                  </div>
                ) : (
                  availableTagOptions.map((tag) => (
                    <button
                      key={`${tag.id}-${tag.provider || 0}`}
                      type="button"
                      className="flex w-full items-center gap-3 rounded px-2 py-1.5 text-left text-sm text-gray-800 hover:bg-gray-50"
                      onClick={() => toggleTag(tag.id, true)}
                      disabled={saving}
                    >
                      <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                      <span className="shrink-0 text-xs tabular-nums text-gray-400">
                        {javEditWorkCountLabel(tag?.count)}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </div>
        {error ? <div className="text-sm text-red-600">{error}</div> : null}
      </div>
      <div className="flex justify-end gap-2 border-t border-gray-200 p-5">
        <button
          type="button"
          className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          onClick={onClose}
          disabled={saving || creatingOption}
        >
          {zh('取消', 'Cancel')}
        </button>
        <button
          type="button"
          className={`rounded-md px-4 py-2 text-sm font-medium text-white ${
            saving ? 'cursor-wait bg-blue-400' : 'bg-blue-600 hover:bg-blue-700'
          }`}
          onClick={handleSave}
          disabled={saving || creatingOption}
        >
          {saving ? zh('保存中...', 'Saving...') : zh('保存', 'Save')}
        </button>
      </div>
    </AppModal>
  )
}

function JavCoverImage({ src, alt }) {
  return (
    <img src={src} alt={alt} className="h-full w-full object-contain object-top" loading="lazy" />
  )
}

function normalizeIdolTagMaxRows(value) {
  const rows = Math.floor(Number(value))
  return Number.isFinite(rows) && rows > 0 ? Math.min(rows, 12) : 0
}

function normalizeJavTagMaxRows(value) {
  const rows = Math.floor(Number(value))
  return Number.isFinite(rows) && rows > 0 ? Math.min(rows, 12) : 0
}

function normalizeJavTitleMaxRows(value) {
  const rows = Math.floor(Number(value))
  return Number.isFinite(rows) && rows >= 0 ? Math.min(rows, 12) : 2
}

function TagCollapseToggleButton({
  expanded,
  count,
  title,
  expandedClassName,
  collapsedClassName,
  onToggle,
}) {
  const [tooltipOpen, setTooltipOpen] = useState(false)
  const [activeTooltipTitle, setActiveTooltipTitle] = useState(title)
  const className = expanded ? expandedClassName : collapsedClassName

  const button = (
    <button
      type="button"
      onClick={() => {
        setTooltipOpen(false)
        onToggle?.()
      }}
      aria-label={title}
      className={className}
    >
      {expanded ? (
        <ExpandLessIcon sx={{ fontSize: 15 }} />
      ) : (
        <>
          <span>{count}</span>
          <ExpandMoreIcon sx={{ fontSize: 15 }} />
        </>
      )}
    </button>
  )

  return (
    <Tooltip
      title={activeTooltipTitle}
      open={tooltipOpen}
      onOpen={() => {
        setActiveTooltipTitle(title)
        setTooltipOpen(true)
      }}
      onClose={() => setTooltipOpen(false)}
      TransitionProps={{ timeout: 0 }}
    >
      {button}
    </Tooltip>
  )
}

function IdolTagList({
  idols,
  maxRows,
  preferChineseName = false,
  buildIdolFilterHref,
  onIdolClick,
  onFilterLinkClick,
  onIdolHoverStart,
  onIdolHoverEnd,
}) {
  const measureRef = useRef(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const [visibleCount, setVisibleCount] = useState(idols.length)
  const rowLimit = normalizeIdolTagMaxRows(maxRows)
  const identity = useMemo(
    () =>
      (idols || [])
        .map(
          (idol) => `${idol?.id || idol?.name || ''}:${getIdolDisplayName(idol, preferChineseName)}`
        )
        .join('|'),
    [idols, preferChineseName]
  )

  useEffect(() => {
    setExpanded(false)
    setVisibleCount(idols.length)
  }, [identity, idols.length, rowLimit])

  useEffect(() => {
    if (rowLimit <= 0) {
      setOverflowing(false)
      setVisibleCount(idols.length)
      return undefined
    }

    const measureList = measureRef.current
    if (!measureList) return undefined

    const measure = () => {
      const containerWidth = measureList.clientWidth
      const tagNodes = Array.from(measureList.querySelectorAll('[data-idol-tag-measure]'))
      const toggleNode = measureList.querySelector('[data-idol-toggle-measure]')

      if (containerWidth <= 0 || tagNodes.length === 0 || !toggleNode) {
        setOverflowing(false)
        setVisibleCount(idols.length)
        return
      }

      const tagWidths = tagNodes.map((node) => node.offsetWidth)
      const toggleWidth = toggleNode.offsetWidth
      const gap = Number.parseFloat(window.getComputedStyle(measureList).columnGap) || 0
      const fullRows = countFlexRows(tagWidths, 0, containerWidth, gap)
      const isOverflowing = fullRows > rowLimit
      setOverflowing(isOverflowing)
      if (!isOverflowing) {
        setVisibleCount(idols.length)
        return
      }

      let low = 0
      let high = tagWidths.length
      let best = 0
      while (low <= high) {
        const mid = Math.floor((low + high) / 2)
        const rows = countFlexRows(tagWidths.slice(0, mid), toggleWidth, containerWidth, gap)
        if (rows <= rowLimit) {
          best = mid
          low = mid + 1
        } else {
          high = mid - 1
        }
      }
      setVisibleCount(best)
    }

    measure()
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    resizeObserver?.observe(measureList)
    window.addEventListener('resize', measure)
    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [identity, idols.length, rowLimit])

  const showToggle = rowLimit > 0 && overflowing
  const renderedIdols = showToggle && !expanded ? idols.slice(0, visibleCount) : idols
  const toggleTitle = expanded
    ? zh('点击收回', 'Click to collapse')
    : zh(`共 ${idols.length} 位女优，点击展开`, `${idols.length} actresses total, click to expand`)

  return (
    <div className="relative">
      <div className="flex min-w-0 flex-1 flex-wrap gap-1">
        {renderedIdols.map((idol) => (
          <a
            key={idol.id || idol.name}
            href={buildIdolFilterHref(idol)}
            className="rounded-full bg-purple-100 px-2 py-1 text-xs font-medium text-purple-700 transition hover:bg-purple-200"
            onMouseEnter={(event) => onIdolHoverStart(idol, event)}
            onMouseLeave={onIdolHoverEnd}
            onClick={(event) => onFilterLinkClick(event, () => onIdolClick?.(idol))}
          >
            {getIdolDisplayName(idol, preferChineseName)}
          </a>
        ))}
        {showToggle ? (
          <TagCollapseToggleButton
            expanded={expanded}
            count={idols.length}
            title={toggleTitle}
            expandedClassName="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-gray-300 bg-gray-50 text-gray-600 shadow-sm transition hover:border-gray-400 hover:bg-gray-100"
            collapsedClassName="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-purple-300 bg-white px-1.5 text-[11px] font-semibold text-purple-700 shadow-sm transition hover:border-purple-500 hover:bg-purple-50"
            onToggle={() => setExpanded((current) => !current)}
          />
        ) : null}
      </div>
      {rowLimit > 0 ? (
        <div
          ref={measureRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap gap-1 opacity-0"
        >
          {idols.map((idol) => (
            <span
              key={idol.id || idol.name}
              data-idol-tag-measure
              className="rounded-full bg-purple-100 px-2 py-1 text-xs font-medium"
            >
              {getIdolDisplayName(idol, preferChineseName)}
            </span>
          ))}
          <span
            data-idol-toggle-measure
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[11px] font-semibold"
          >
            <span>{idols.length}</span>
            <ExpandMoreIcon sx={{ fontSize: 15 }} />
          </span>
        </div>
      ) : null}
    </div>
  )
}

function countFlexRows(itemWidths, trailingWidth, containerWidth, gap) {
  const widths = trailingWidth > 0 ? [...itemWidths, trailingWidth] : itemWidths
  if (widths.length === 0) return 0

  let rows = 1
  let rowWidth = 0
  for (const width of widths) {
    const nextWidth = rowWidth === 0 ? width : rowWidth + gap + width
    if (rowWidth > 0 && nextWidth > containerWidth) {
      rows += 1
      rowWidth = width
    } else {
      rowWidth = nextWidth
    }
  }
  return rows
}

function JavTagList({ tags, maxRows, buildTagFilterHref, onTagClick, onFilterLinkClick }) {
  const measureRef = useRef(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const [visibleCount, setVisibleCount] = useState(tags.length)
  const rowLimit = normalizeJavTagMaxRows(maxRows)
  const identity = useMemo(
    () => (tags || []).map((tag) => tag?.id || tag?.name || '').join('|'),
    [tags]
  )

  useEffect(() => {
    setExpanded(false)
    setVisibleCount(tags.length)
  }, [identity, tags.length, rowLimit])

  useEffect(() => {
    if (rowLimit <= 0) {
      setOverflowing(false)
      setVisibleCount(tags.length)
      return undefined
    }

    const measureList = measureRef.current
    if (!measureList) return undefined

    const measure = () => {
      const containerWidth = measureList.clientWidth
      const tagNodes = Array.from(measureList.querySelectorAll('[data-jav-tag-measure]'))
      const toggleNode = measureList.querySelector('[data-jav-tag-toggle-measure]')

      if (containerWidth <= 0 || tagNodes.length === 0 || !toggleNode) {
        setOverflowing(false)
        setVisibleCount(tags.length)
        return
      }

      const tagWidths = tagNodes.map((node) => node.offsetWidth)
      const toggleWidth = toggleNode.offsetWidth
      const gap = Number.parseFloat(window.getComputedStyle(measureList).columnGap) || 0
      const fullRows = countFlexRows(tagWidths, 0, containerWidth, gap)
      const isOverflowing = fullRows > rowLimit
      setOverflowing(isOverflowing)
      if (!isOverflowing) {
        setVisibleCount(tags.length)
        return
      }

      let low = 0
      let high = tagWidths.length
      let best = 0
      while (low <= high) {
        const mid = Math.floor((low + high) / 2)
        const rows = countFlexRows(tagWidths.slice(0, mid), toggleWidth, containerWidth, gap)
        if (rows <= rowLimit) {
          best = mid
          low = mid + 1
        } else {
          high = mid - 1
        }
      }
      setVisibleCount(best)
    }

    measure()
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    resizeObserver?.observe(measureList)
    window.addEventListener('resize', measure)
    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [identity, rowLimit, tags.length])

  const showToggle = rowLimit > 0 && overflowing
  const renderedTags = showToggle && !expanded ? tags.slice(0, visibleCount) : tags
  const toggleTitle = expanded
    ? zh('点击收回', 'Click to collapse')
    : zh(`共 ${tags.length} 个标签，点击展开`, `${tags.length} tags total, click to expand`)

  return (
    <div className="relative">
      <div className="flex min-w-0 flex-1 flex-wrap gap-1">
        {renderedTags.map((tag) => {
          const isUser = isUserJavTag(tag)
          const tagClass = isUser
            ? 'bg-emerald-500 hover:bg-emerald-600'
            : 'bg-orange-500 hover:bg-orange-600'
          return (
            <a
              key={`${tag.id || tag.name}-${tag.provider || 0}`}
              href={buildTagFilterHref(tag)}
              className={`rounded-full px-2 py-1 text-xs font-medium text-white transition ${tagClass}`}
              onClick={(event) => onFilterLinkClick(event, () => onTagClick?.(tag))}
            >
              {tag.name}
            </a>
          )
        })}
        {showToggle ? (
          <TagCollapseToggleButton
            expanded={expanded}
            count={tags.length}
            title={toggleTitle}
            expandedClassName="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-gray-300 bg-gray-50 text-gray-600 shadow-sm transition hover:border-gray-400 hover:bg-gray-100"
            collapsedClassName="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-orange-300 bg-white px-1.5 text-[11px] font-semibold text-orange-700 shadow-sm transition hover:border-orange-500 hover:bg-orange-50"
            onToggle={() => setExpanded((current) => !current)}
          />
        ) : null}
      </div>
      {rowLimit > 0 ? (
        <div
          ref={measureRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap gap-1 opacity-0"
        >
          {tags.map((tag) => (
            <span
              key={`${tag.id || tag.name}-${tag.provider || 0}`}
              data-jav-tag-measure
              className="rounded-full px-2 py-1 text-xs font-medium"
            >
              {tag.name}
            </span>
          ))}
          <span
            data-jav-tag-toggle-measure
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[11px] font-semibold"
          >
            <span>{tags.length}</span>
            <ExpandMoreIcon sx={{ fontSize: 15 }} />
          </span>
        </div>
      ) : null}
    </div>
  )
}

function JavCard({
  item,
  checked = false,
  onToggleSelect,
  selectionDisabled = false,
  onPlay,
  buildJavUrl,
  onIdolClick,
  onOpenFavorites,
  onOpenJavFavorites,
  onOpenStudioFavorites,
  onOpenSeriesFavorites,
  onPrefixClick,
  onStudioClick,
  onSeriesClick,
  onTagClick,
  onOpenFile,
  openFileLabel,
  onOpenScreenshots,
  onOpenVideoManager,
  onManageVideoPlay,
  onManageVideoPlayAtTime,
  onManageVideoCoverChanged,
  onManageVideoOpenFile,
  onManageVideoRevealFile,
  onManageVideoOpenTagPicker,
  onManageVideoOpenScreenshots,
  onManageVideoOpenScrapeSettings,
  onManageVideoRename,
  onManageVideoDelete,
  onManageVideoTagClick,
  loadIdolPreview,
  loadStudioPreview,
  loadSeriesPreview,
  onIdolPreviewUpdated,
  onOpenCoverPreview,
  preferChineseName = false,
  titleMaxRows,
  idolTagMaxRows,
  tagMaxRows,
  hideSeries = false,
  hideIdols = false,
  hideTags = false,
  hideActions = false,
  showFullFavoriteRating = false,
}) {
  const primaryVideo = useMemo(() => (item?.videos || [])[0], [item])
  const { coverAspectPercent } = useMemo(() => getIdolCardLayoutProps(), [])
  const code = item?.code?.trim()
  const [coverVersion, setCoverVersion] = useState(0)
  const [editorOpen, setEditorOpen] = useState(false)
  const [customTagEditorOpen, setCustomTagEditorOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const coverBase = code ? `/jav/${encodeURIComponent(code)}/cover` : null
  const cover = coverBase ? `${coverBase}${coverVersion ? `?v=${coverVersion}` : ''}` : null

  const release =
    item?.release_unix && Number.isFinite(item.release_unix)
      ? new Date(item.release_unix * 1000)
      : null
  const releaseText = release ? release.toISOString().slice(0, 10) : zh('未知', 'Unknown')
  const durationText = item?.duration_min
    ? zh(`${item.duration_min} 分钟`, `${item.duration_min} min`)
    : ''
  const studioText = String(item?.studio?.name || '').trim()
  const canFilterStudio = studioText && typeof onStudioClick === 'function'
  const preferredSeries = item?.series
  const seriesText = String(preferredSeries?.name || '').trim()
  const canFilterSeries = seriesText && typeof onSeriesClick === 'function'
  const codeText = code
  const mainTitle = getJavDisplayTitle(item)
  const titleText = [codeText, mainTitle].filter(Boolean).join(' ')
  const normalizedTitleMaxRows = normalizeJavTitleMaxRows(titleMaxRows)
  const titleClampStyle =
    normalizedTitleMaxRows > 0
      ? {
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: normalizedTitleMaxRows,
          overflow: 'hidden',
        }
      : undefined
  const videos = item?.videos || []
  const openableVideos = videos.filter((video) =>
    Boolean(video?.path && (video?.directory?.path || video?.directory_path))
  )
  const canOpen = openableVideos.length > 0
  const encodedCode = code ? encodeURIComponent(code) : ''
  const javdbSearchURL = encodedCode ? `https://javdb.com/search?q=${encodedCode}&f=all` : ''
  const favoriteCount = Number(item?.favorite_count) || 0
  const itemFavoriteRating = Number(item?.favorite_rating) || 0
  const [favoriteRating, setFavoriteRating] = useState(itemFavoriteRating)
  const [favoriteRatingSaving, setFavoriteRatingSaving] = useState(false)
  const [favoriteRatingError, setFavoriteRatingError] = useState('')
  const [favoriteRatingEditing, setFavoriteRatingEditing] = useState(false)
  const [favoriteRatingPreview, setFavoriteRatingPreview] = useState(null)
  const favoriteRatingTooltipValue = favoriteRatingPreview ?? favoriteRating
  const hasFavoriteRatingTooltipValue = favoriteRatingPreview !== null || favoriteRating > 0
  const favoriteRatingDisplayCount = showFullFavoriteRating
    ? Math.ceil(favoriteRating)
    : favoriteRating > 0
      ? 1
      : 0
  const favoriteRatingWidth = !favoriteRatingEditing
    ? Math.max(favoriteRatingDisplayCount, 1) * 21
    : 5 * 21

  useEffect(() => {
    setFavoriteRating(itemFavoriteRating)
  }, [item?.id, itemFavoriteRating])

  const handleExternalLinkClick = (event, site) => {
    if (site.onClick) {
      site.onClick(event)
      return
    }
    event.stopPropagation()
  }

  const handleOpenJavDB = (event) => {
    event.preventDefault()
    event.stopPropagation()
    openJavDBWithAssist(javdbSearchURL, { target: 'movie', code })
  }

  const externalLinks = encodedCode
    ? item?.is_uncensored === true
      ? [
          {
            key: 'javbus',
            name: 'JavBus',
            href: `https://www.javbus.com/${encodedCode}`,
            icon: '/ico/javbus.ico',
          },
          {
            key: 'avsox',
            name: 'AVSOX',
            href: `/jav/avsox-redirect?code=${encodedCode}`,
            icon: '/ico/avsox.ico',
          },
        ]
      : [
          {
            key: 'javlibrary',
            name: 'JavLibrary',
            href: `https://www.javlibrary.com/cn/vl_searchbyid.php?keyword=${encodedCode}`,
            icon: '/ico/javlibrary.ico',
          },
          {
            key: 'javbus',
            name: 'JavBus',
            href: `https://www.javbus.com/${encodedCode}`,
            icon: '/ico/javbus.ico',
          },
          {
            key: 'javdb',
            name: 'JavDB',
            href: javdbSearchURL,
            icon: '/ico/javdb.png',
            onClick: handleOpenJavDB,
          },
          {
            key: 'javmenu',
            name: 'JavMenu',
            href: `https://javmenu.com/${encodedCode}`,
            icon: '/ico/javmenu.png',
          },
          {
            key: 'missav',
            name: 'MissAV',
            href: `https://missav.ws/${encodedCode}`,
            icon: '/ico/missav.ico',
          },
        ]
    : []

  const handleOpenFile = (event) => {
    event.stopPropagation()
    if (!canOpen) return
    onOpenFile?.(openableVideos[0] || primaryVideo, item)
  }

  const handleOpenScreenshots = (event) => {
    event.stopPropagation()
    if (!canOpen) return
    onOpenScreenshots?.(openableVideos[0] || primaryVideo, item)
  }

  const handleOpenVideoManager = (event) => {
    event.stopPropagation()
    onOpenVideoManager?.(item)
  }

  const handleOpenCoverPreview = (event) => {
    event.stopPropagation()
    if (!cover) return
    onOpenCoverPreview?.({ src: cover, alt: titleText })
  }

  const handleOpenDetail = () => {
    clearHoverPreview()
    setDetailOpen(true)
  }

  const handleOpenEditor = (event) => {
    event.stopPropagation()
    setEditorOpen(true)
  }

  const handleOpenJavFavorites = (event) => {
    event.preventDefault()
    event.stopPropagation()
    onOpenJavFavorites?.(item)
  }

  const handleOpenCustomTags = (event) => {
    event.preventDefault()
    event.stopPropagation()
    setCustomTagEditorOpen(true)
  }

  const handleFavoriteRatingChange = async (event, value) => {
    event?.stopPropagation()
    const javID = Number(item?.id)
    const numericValue = value == null ? 0 : Number(value)
    const nextRating = Math.round(numericValue * 2) / 2
    if (
      favoriteRatingSaving ||
      !Number.isFinite(javID) ||
      javID <= 0 ||
      !Number.isFinite(nextRating) ||
      nextRating < 0 ||
      nextRating > 5
    ) {
      return
    }

    const previousRating = favoriteRating
    setFavoriteRating(nextRating)
    setFavoriteRatingSaving(true)
    setFavoriteRatingError('')
    try {
      const updated = await updateJavItem(javID, { favorite_rating: nextRating })
      const savedRating = Number(updated?.favorite_rating) || nextRating
      setFavoriteRating(savedRating)
      useStore.setState((state) => {
        if (!Array.isArray(state.javItems)) return {}
        return {
          javItems: state.javItems.map((current) =>
            Number(current?.id) === javID ? { ...current, ...updated } : current
          ),
        }
      })
    } catch (error) {
      const message = getErrorMessage(error)
      setFavoriteRating(previousRating)
      setFavoriteRatingError(message)
      useStore.setState({ javError: message })
    } finally {
      setFavoriteRatingSaving(false)
    }
  }

  const handleEditorSaved = (updated, coverUpdated) => {
    if (updated?.id) {
      useStore.setState((state) => {
        if (!Array.isArray(state.javItems)) return {}
        return {
          javItems: state.javItems.map((current) =>
            Number(current?.id) === Number(updated.id) ? { ...current, ...updated } : current
          ),
        }
      })
    }
    if (coverUpdated) {
      setCoverVersion(Date.now())
    }
    setEditorOpen(false)
  }

  const handleCustomTagsSaved = (updated) => {
    if (updated?.id) {
      useStore.setState((state) => {
        if (!Array.isArray(state.javItems)) return {}
        return {
          javItems: state.javItems.map((current) =>
            Number(current?.id) === Number(updated.id) ? { ...current, ...updated } : current
          ),
        }
      })
    }
    setCustomTagEditorOpen(false)
  }

  const canPlay = Boolean(primaryVideo && primaryVideo.id)
  const handlePlay = (event) => {
    event?.stopPropagation()
    if (!canPlay) return
    onPlay?.(primaryVideo, item)
  }
  const tags = useMemo(() => {
    const rawTags = Array.isArray(item?.tags) ? item.tags : []
    const userTags = rawTags.filter((tag) => isUserJavTag(tag))
    const scrapedTags = rawTags.filter((tag) => !isUserJavTag(tag))
    return [...userTags, ...scrapedTags]
  }, [item?.tags])
  const [previewIdol, setPreviewIdol] = useState(null)
  const [idolHoverAnchorEl, setIdolHoverAnchorEl] = useState(null)
  const [previewStudio, setPreviewStudio] = useState(null)
  const [studioHoverAnchorEl, setStudioHoverAnchorEl] = useState(null)
  const [previewSeries, setPreviewSeries] = useState(null)
  const [seriesHoverAnchorEl, setSeriesHoverAnchorEl] = useState(null)
  const [idolCoverEditorItem, setIdolCoverEditorItem] = useState(null)
  const [idolEditorItem, setIdolEditorItem] = useState(null)
  const closeTimerRef = useRef(null)
  const hoverPreviewLockedRef = useRef(false)
  const activeIdolHoverIdRef = useRef(null)
  const activeStudioHoverIdRef = useRef(null)
  const activeSeriesHoverIdRef = useRef(null)

  const isModifiedClick = (event) =>
    event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0

  const handleFilterLinkClick = (event, action) => {
    event.stopPropagation()
    if (isModifiedClick(event)) return
    event.preventDefault()
    action?.()
  }

  const buildIdolFilterHref = (idol) => {
    const id = Number(idol?.id)
    if (!Number.isFinite(id) || id <= 0) return '#'
    return (
      buildJavUrl?.({
        tab: 'list',
        page: 1,
        search: '',
        idolIds: [id],
        tagIds: [],
        studioId: null,
        studioName: '',
        seriesId: null,
        seriesName: '',
        prefix: '',
        favoriteRatingEnabled: false,
        random: false,
        tempSort: '',
      }) || '#'
    )
  }

  const buildStudioFilterHref = (studio) => {
    const id = Number(studio?.id)
    if (!Number.isFinite(id) || id <= 0) return '#'
    return (
      buildJavUrl?.({
        tab: 'list',
        page: 1,
        search: '',
        idolIds: [],
        tagIds: [],
        studioId: id,
        studioName: studio?.name || '',
        seriesId: null,
        seriesName: '',
        prefix: '',
        favoriteRatingEnabled: false,
        random: false,
        tempSort: '',
      }) || '#'
    )
  }

  const buildSeriesFilterHref = (series) => {
    const id = Number(series?.id)
    if (!Number.isFinite(id) || id <= 0) return '#'
    return (
      buildJavUrl?.({
        tab: 'list',
        page: 1,
        search: '',
        idolIds: [],
        tagIds: [],
        studioId: null,
        studioName: '',
        seriesId: id,
        seriesName: series?.name || '',
        prefix: '',
        favoriteRatingEnabled: false,
        random: false,
        tempSort: '',
      }) || '#'
    )
  }

  const buildTagFilterHref = (tag) => {
    const id = Number(tag?.id)
    if (!Number.isFinite(id) || id <= 0) return '#'
    return (
      buildJavUrl?.({
        tab: 'list',
        page: 1,
        search: '',
        idolIds: [],
        tagIds: [id],
        studioId: null,
        studioName: '',
        seriesId: null,
        seriesName: '',
        prefix: '',
        favoriteRatingEnabled: false,
        random: false,
        tempSort: '',
      }) || '#'
    )
  }

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current)
      }
    }
  }, [])

  const clearHoverCloseTimer = () => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }

  const clearHoverPreview = () => {
    activeIdolHoverIdRef.current = null
    activeStudioHoverIdRef.current = null
    activeSeriesHoverIdRef.current = null
    setPreviewIdol(null)
    setIdolHoverAnchorEl(null)
    setPreviewStudio(null)
    setStudioHoverAnchorEl(null)
    setPreviewSeries(null)
    setSeriesHoverAnchorEl(null)
  }

  const scheduleHoverClose = () => {
    clearHoverCloseTimer()
    if (hoverPreviewLockedRef.current) return
    closeTimerRef.current = window.setTimeout(() => {
      clearHoverPreview()
      closeTimerRef.current = null
    }, 120)
  }

  const handleStudioSeriesListOpenChange = useCallback((open) => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    hoverPreviewLockedRef.current = Boolean(open)
    if (open) {
      return
    }
    closeTimerRef.current = window.setTimeout(() => {
      activeIdolHoverIdRef.current = null
      activeStudioHoverIdRef.current = null
      activeSeriesHoverIdRef.current = null
      setPreviewIdol(null)
      setIdolHoverAnchorEl(null)
      setPreviewStudio(null)
      setStudioHoverAnchorEl(null)
      setPreviewSeries(null)
      setSeriesHoverAnchorEl(null)
      closeTimerRef.current = null
    }, 120)
  }, [])

  const handleIdolHoverStart = (idol, event) => {
    clearHoverCloseTimer()
    const idolId = Number(idol?.id)
    activeIdolHoverIdRef.current = Number.isFinite(idolId) ? idolId : null
    activeStudioHoverIdRef.current = null
    activeSeriesHoverIdRef.current = null
    setPreviewIdol(idol || null)
    setIdolHoverAnchorEl(event.currentTarget)
    setPreviewStudio(null)
    setStudioHoverAnchorEl(null)
    setPreviewSeries(null)
    setSeriesHoverAnchorEl(null)

    void loadIdolPreview?.(idol)
      .then((loadedIdol) => {
        if (!loadedIdol) return
        if (activeIdolHoverIdRef.current !== Number(loadedIdol.id)) return
        setPreviewIdol((current) =>
          current && current.id === loadedIdol.id ? { ...current, ...loadedIdol } : current
        )
      })
      .catch((error) => {
        console.warn('load idol preview failed', error)
      })
  }

  const handleOpenIdolCoverEditor = (idol) => {
    clearHoverCloseTimer()
    setIdolCoverEditorItem(idol)
  }

  const updateStoredIdol = (updated) => {
    const updatedId = Number(updated?.id)
    if (!Number.isFinite(updatedId) || updatedId <= 0) return
    useStore.setState((state) => {
      if (!Array.isArray(state.javItems)) return {}
      return {
        javItems: state.javItems.map((current) => {
          if (!Array.isArray(current?.idols)) return current
          let changed = false
          const idols = current.idols.map((idol) => {
            if (Number(idol?.id) !== updatedId) return idol
            changed = true
            return { ...idol, ...updated }
          })
          return changed ? { ...current, idols } : current
        }),
      }
    })
  }

  const handleOpenIdolEditor = (idol) => {
    clearHoverCloseTimer()
    setIdolEditorItem(idol)
  }

  const handleIdolSaved = (updated) => {
    const updatedId = Number(updated?.id)
    if (!Number.isFinite(updatedId) || updatedId <= 0) return
    updateStoredIdol(updated)
    onIdolPreviewUpdated?.(updated)
    setPreviewIdol((current) =>
      current && Number(current.id) === updatedId ? { ...current, ...updated } : current
    )
    setIdolEditorItem(null)
  }

  const handleIdolCoverSaved = (updated) => {
    const updatedId = Number(updated?.id)
    if (!Number.isFinite(updatedId) || updatedId <= 0) return
    updateStoredIdol(updated)
    onIdolPreviewUpdated?.(updated)
    setPreviewIdol((current) =>
      current && Number(current.id) === updatedId ? { ...current, ...updated } : current
    )
  }

  const handleStudioHoverStart = (studio, event) => {
    clearHoverCloseTimer()
    const studioId = Number(studio?.id)
    activeStudioHoverIdRef.current = Number.isFinite(studioId) ? studioId : null
    activeIdolHoverIdRef.current = null
    activeSeriesHoverIdRef.current = null
    setPreviewStudio(studio || null)
    setStudioHoverAnchorEl(event.currentTarget)
    setPreviewIdol(null)
    setIdolHoverAnchorEl(null)
    setPreviewSeries(null)
    setSeriesHoverAnchorEl(null)

    void loadStudioPreview?.(studio)
      .then((loadedStudio) => {
        if (!loadedStudio) return
        if (activeStudioHoverIdRef.current !== Number(loadedStudio.id)) return
        setPreviewStudio((current) =>
          current && current.id === loadedStudio.id ? { ...current, ...loadedStudio } : current
        )
      })
      .catch((error) => {
        console.warn('load studio preview failed', error)
      })
  }

  const handleSeriesHoverStart = (series, event) => {
    clearHoverCloseTimer()
    const seriesId = Number(series?.id)
    activeSeriesHoverIdRef.current = Number.isFinite(seriesId) ? seriesId : null
    activeIdolHoverIdRef.current = null
    activeStudioHoverIdRef.current = null
    setPreviewSeries(series || null)
    setSeriesHoverAnchorEl(event.currentTarget)
    setPreviewIdol(null)
    setIdolHoverAnchorEl(null)
    setPreviewStudio(null)
    setStudioHoverAnchorEl(null)

    void loadSeriesPreview?.(series)
      .then((loadedSeries) => {
        if (!loadedSeries) return
        if (activeSeriesHoverIdRef.current !== Number(loadedSeries.id)) return
        setPreviewSeries((current) =>
          current && current.id === loadedSeries.id ? { ...current, ...loadedSeries } : current
        )
      })
      .catch((error) => {
        console.warn('load series preview failed', error)
      })
  }

  const showIdolWorkCount =
    typeof previewIdol?.work_count === 'number' && previewIdol.work_count > 0

  return (
    <>
      <div
        className={`jav-card flex flex-col overflow-hidden rounded-lg border bg-white shadow-sm transition hover:shadow-lg ${checked ? 'border-sky-400 ring-2 ring-sky-200' : ''}`}
      >
        <div className="card-hover-scope group relative aspect-[800/538] overflow-hidden bg-white">
          {cover ? (
            <JavCoverImage src={cover} alt={item?.code || zh('JAV 封面', 'JAV cover')} />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200 text-lg font-semibold text-gray-600">
              {item?.code || zh('未知番号', 'Unknown code')}
            </div>
          )}
          <button
            type="button"
            className="absolute inset-0 z-[1] cursor-pointer"
            onClick={handleOpenDetail}
            aria-label={zh(`查看 ${code || 'JAV'} 详情`, `View ${code || 'JAV'} details`)}
          />
          <div className="card-hover-focus-visible pointer-events-none absolute inset-0 z-[2] flex items-center justify-center bg-black/0 text-white opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={handlePlay}
              disabled={!canPlay}
              className={`pointer-events-auto rounded-full p-3 ${
                canPlay ? 'bg-black/60 hover:bg-black/80' : 'cursor-not-allowed bg-black/30'
              }`}
              aria-label={zh('播放', 'Play')}
              title={zh('播放', 'Play')}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-10 w-10"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
          </div>
          <div
            className="absolute left-2 top-2 z-10 flex items-center gap-1"
            onMouseLeave={() => {
              setFavoriteRatingEditing(false)
              setFavoriteRatingPreview(null)
            }}
            onBlur={(event) => {
              if (event.currentTarget.contains(event.relatedTarget)) return
              setFavoriteRatingEditing(false)
              setFavoriteRatingPreview(null)
            }}
          >
            <Tooltip
              title={
                favoriteRatingError ||
                (favoriteRatingPreview === 0
                  ? zh('清空喜爱度', 'Clear favorite rating')
                  : hasFavoriteRatingTooltipValue
                    ? zh(
                        `喜爱度：${favoriteRatingTooltipValue.toFixed(1)} 分`,
                        `Favorite rating: ${favoriteRatingTooltipValue.toFixed(1)}`
                      )
                    : zh('设置喜爱度评分', 'Set favorite rating'))
              }
              placement="top"
              arrow
            >
              <span
                role="group"
                aria-label={zh('喜爱度评分', 'Favorite rating')}
                className={`flex items-center rounded-full bg-black/70 px-1.5 py-0.5 shadow-lg shadow-black/50 transition-opacity ${
                  favoriteRatingSaving
                    ? 'opacity-60'
                    : favoriteRating > 0
                      ? 'opacity-100'
                      : 'card-hover-focus-visible opacity-0 group-hover:opacity-100'
                }`}
              >
                <span
                  className="flex overflow-hidden transition-[width] duration-150"
                  style={{ width: favoriteRatingWidth }}
                >
                  <Rating
                    name={`jav-favorite-rating-${item?.id || code || 'unknown'}`}
                    value={favoriteRating}
                    precision={0.5}
                    size="small"
                    icon={<FavoriteRoundedIcon fontSize="inherit" />}
                    emptyIcon={<FavoriteBorderRoundedIcon fontSize="inherit" />}
                    disabled={favoriteRatingSaving || !item?.id}
                    onChange={handleFavoriteRatingChange}
                    onClick={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onMouseEnter={() => setFavoriteRatingEditing(true)}
                    onFocus={() => setFavoriteRatingEditing(true)}
                    onChangeActive={(_, value) =>
                      setFavoriteRatingPreview(value >= 0.5 ? value : null)
                    }
                    sx={{
                      flexShrink: 0,
                      color: '#fbbf24',
                      fontSize: 21,
                      '& .MuiRating-iconEmpty': {
                        color: 'rgba(255,255,255,0.85)',
                      },
                    }}
                  />
                </span>
                {favoriteRatingEditing && favoriteRating > 0 ? (
                  <button
                    type="button"
                    className="ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white transition hover:bg-white/20"
                    disabled={favoriteRatingSaving || !item?.id}
                    aria-label={zh('清除喜爱度评分', 'Clear favorite rating')}
                    onMouseEnter={() => setFavoriteRatingPreview(0)}
                    onMouseLeave={() => setFavoriteRatingPreview(null)}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => handleFavoriteRatingChange(event, 0)}
                  >
                    <RemoveCircleOutlineRoundedIcon sx={{ fontSize: 15 }} />
                  </button>
                ) : null}
                {favoriteRating > 0 && !favoriteRatingEditing ? (
                  <span className="ml-1 shrink-0 text-xs font-semibold tabular-nums leading-none text-white">
                    {favoriteRating.toFixed(1)}
                  </span>
                ) : null}
              </span>
            </Tooltip>
            {onToggleSelect && Number(item?.id) > 0 ? (
              <Tooltip
                title={checked ? zh('取消选择', 'Deselect') : zh('选择', 'Select')}
                placement="top"
                arrow
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  aria-label={zh(`选择 ${code || item.title}`, `Select ${code || item.title}`)}
                  disabled={selectionDisabled}
                  onKeyDown={(event) => {
                    if (event.key === ' ' || event.key === 'Enter') event.stopPropagation()
                  }}
                  onClick={(event) => {
                    event.stopPropagation()
                    onToggleSelect(item)
                  }}
                  className={`card-hover-focus-visible flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/65 shadow-lg shadow-black/40 transition hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-60 [@media(hover:none)]:opacity-100 ${
                    checked
                      ? 'text-sky-300 opacity-100'
                      : 'text-white opacity-0 group-hover:opacity-100'
                  }`}
                >
                  {checked ? (
                    <CheckBoxRoundedIcon sx={{ fontSize: 18 }} />
                  ) : (
                    <CheckBoxOutlineBlankRoundedIcon sx={{ fontSize: 18 }} />
                  )}
                </button>
              </Tooltip>
            ) : null}
          </div>
          {externalLinks.length > 0 ? (
            <div className="card-hover-focus-visible absolute bottom-2 left-2 z-10 flex max-w-[calc(100%-1rem)] items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
              {externalLinks.map((site) => (
                <Tooltip
                  key={site.key}
                  title={zh(`在 ${site.name} 中打开`, `Open in ${site.name}`)}
                  placement="top"
                  arrow
                >
                  <a
                    href={site.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/70 shadow-lg shadow-black/60 transition hover:bg-black/85"
                    aria-label={zh(`在 ${site.name} 中打开`, `Open in ${site.name}`)}
                    onClick={(event) => handleExternalLinkClick(event, site)}
                  >
                    <img
                      src={site.icon}
                      alt={site.name}
                      className={`${site.key === 'javmenu' ? 'h-5 w-5' : 'h-4 w-4'} ${site.loading ? 'animate-pulse' : ''}`}
                      loading="lazy"
                    />
                  </a>
                </Tooltip>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            className="card-hover-focus-visible absolute right-12 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/65 text-white opacity-0 shadow-lg shadow-black/40 transition hover:bg-black/80 group-hover:opacity-100"
            title={zh('编辑自定义标签', 'Edit custom tags')}
            aria-label={zh('编辑自定义标签', 'Edit custom tags')}
            onClick={handleOpenCustomTags}
          >
            <LocalOfferOutlinedIcon sx={{ fontSize: 18 }} />
          </button>
          <button
            type="button"
            className={`card-hover-focus-visible absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full shadow-lg shadow-black/40 transition ${
              favoriteCount > 0
                ? 'bg-amber-400 text-amber-950 hover:bg-amber-300'
                : 'bg-black/65 text-white opacity-0 hover:bg-black/80 group-hover:opacity-100'
            }`}
            title={zh('加入作品收藏夹', 'Add to JAV favorite groups')}
            aria-label={zh('加入作品收藏夹', 'Add to JAV favorite groups')}
            onClick={handleOpenJavFavorites}
          >
            {favoriteCount > 0 ? (
              <StarRoundedIcon sx={{ fontSize: 18 }} />
            ) : (
              <StarBorderRoundedIcon sx={{ fontSize: 18 }} />
            )}
          </button>
          {cover || canOpen ? (
            <div className="card-hover-focus-visible absolute bottom-2 right-2 z-10 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
              {cover ? (
                <button
                  type="button"
                  onClick={handleOpenCoverPreview}
                  title={zh('查看封面', 'View cover')}
                  aria-label={zh('查看封面', 'View cover')}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-black/70 text-white shadow-lg shadow-black/60 hover:bg-black/85"
                >
                  <SearchIcon className="h-5 w-5 text-white" fontSize="inherit" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={handleOpenScreenshots}
                disabled={!canOpen}
                title={zh('查看截图', 'View screenshots')}
                aria-label={zh('查看截图', 'View screenshots')}
                className={`flex h-8 w-8 items-center justify-center rounded-full text-white shadow-lg shadow-black/60 ${
                  canOpen ? 'bg-black/70 hover:bg-black/85' : 'cursor-not-allowed bg-black/30'
                }`}
              >
                <PhotoLibraryOutlinedIcon className="h-5 w-5 text-white" fontSize="inherit" />
              </button>
            </div>
          ) : null}
        </div>
        <div className="flex flex-1 flex-col gap-2 p-3">
          <div className="text-sm leading-tight" title={titleText} style={titleClampStyle}>
            {codeText ? <span className="font-semibold text-gray-800">{codeText}</span> : null}
            {codeText ? ' ' : null}
            <span className="font-medium text-gray-800">{mainTitle}</span>
          </div>
          <div className="flex min-w-0 flex-nowrap items-center gap-x-3 overflow-hidden text-xs text-gray-600">
            <span className="inline-flex shrink-0 items-center gap-1">
              <Tooltip title={zh('时长', 'Duration')} arrow>
                <span className="inline-flex">
                  <DurationIcon />
                </span>
              </Tooltip>
              <span>{durationText || zh('时长未知', 'Unknown duration')}</span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1">
              <Tooltip title={zh('发行日期', 'Release date')} arrow>
                <span className="inline-flex">
                  <ReleaseIcon />
                </span>
              </Tooltip>
              <span>{releaseText}</span>
            </span>
            {studioText ? (
              <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                <Tooltip title={zh('片商', 'Studio')} arrow>
                  <span className="inline-flex">
                    <VideocamOutlinedIcon sx={{ fontSize: 16 }} className="shrink-0 text-sky-600" />
                  </span>
                </Tooltip>
                <a
                  href={buildStudioFilterHref(item.studio)}
                  className={`block min-w-0 truncate text-left ${
                    canFilterStudio ? 'cursor-pointer hover:text-blue-700 hover:underline' : ''
                  }`}
                  onClick={(event) =>
                    handleFilterLinkClick(event, () => {
                      if (canFilterStudio) onStudioClick(item.studio)
                    })
                  }
                  onMouseEnter={(event) => handleStudioHoverStart(item.studio, event)}
                  onMouseLeave={scheduleHoverClose}
                >
                  {studioText}
                </a>
              </span>
            ) : null}
          </div>
          {!hideSeries && seriesText ? (
            <div className="flex min-w-0 items-start gap-1 text-xs text-gray-600">
              <Tooltip title={zh('系列', 'Series')} arrow>
                <span className="inline-flex">
                  <MovieCreationIcon sx={{ fontSize: 16 }} className="shrink-0 text-emerald-600" />
                </span>
              </Tooltip>
              <a
                href={buildSeriesFilterHref(preferredSeries)}
                className={`min-w-0 whitespace-normal break-words text-left leading-snug ${
                  canFilterSeries ? 'cursor-pointer hover:text-blue-700 hover:underline' : ''
                }`}
                onClick={(event) =>
                  handleFilterLinkClick(event, () => {
                    if (canFilterSeries) onSeriesClick(preferredSeries)
                  })
                }
                onMouseEnter={(event) => handleSeriesHoverStart(preferredSeries, event)}
                onMouseLeave={scheduleHoverClose}
              >
                {seriesText}
              </a>
            </div>
          ) : null}
          <Popper
            open={Boolean(previewStudio && studioHoverAnchorEl)}
            anchorEl={studioHoverAnchorEl}
            placement="right-start"
            className="z-[1400]"
            modifiers={[
              {
                name: 'offset',
                options: {
                  offset: [10, 0],
                },
              },
            ]}
          >
            <div
              className="w-[320px]"
              onMouseEnter={clearHoverCloseTimer}
              onMouseLeave={scheduleHoverClose}
            >
              {previewStudio ? (
                <StudioCard
                  item={previewStudio}
                  href={buildStudioFilterHref(previewStudio)}
                  onSelectStudio={(studio) => onStudioClick?.(studio)}
                  onSelectSeries={(series) => onSeriesClick?.(series)}
                  onSelectPrefix={(prefix) => onPrefixClick?.(prefix)}
                  onOpenFavorites={onOpenStudioFavorites}
                  buildSeriesUrl={buildSeriesFilterHref}
                  onOpenSeriesFavorites={onOpenSeriesFavorites}
                  onSeriesListOpenChange={handleStudioSeriesListOpenChange}
                />
              ) : null}
            </div>
          </Popper>
          <Popper
            open={Boolean(previewSeries && seriesHoverAnchorEl)}
            anchorEl={seriesHoverAnchorEl}
            placement="right-start"
            className="z-[1400]"
            modifiers={[
              {
                name: 'offset',
                options: {
                  offset: [10, 0],
                },
              },
            ]}
          >
            <div
              className="w-[260px]"
              onMouseEnter={clearHoverCloseTimer}
              onMouseLeave={scheduleHoverClose}
            >
              {previewSeries ? (
                <SeriesCard
                  item={previewSeries}
                  href={buildSeriesFilterHref(previewSeries)}
                  onSelectSeries={(series) => onSeriesClick?.(series)}
                  onSelectStudio={(studio) => onStudioClick?.(studio)}
                  onOpenFavorites={onOpenSeriesFavorites}
                />
              ) : null}
            </div>
          </Popper>
          {!hideIdols && Array.isArray(item?.idols) && item.idols.length > 0 && (
            <>
              <IdolTagList
                idols={item.idols}
                maxRows={idolTagMaxRows}
                preferChineseName={preferChineseName}
                buildIdolFilterHref={buildIdolFilterHref}
                onIdolClick={onIdolClick}
                onFilterLinkClick={handleFilterLinkClick}
                onIdolHoverStart={handleIdolHoverStart}
                onIdolHoverEnd={scheduleHoverClose}
              />
              <Popper
                open={Boolean(previewIdol && idolHoverAnchorEl)}
                anchorEl={idolHoverAnchorEl}
                placement="right-start"
                className="z-[1400]"
                modifiers={[
                  {
                    name: 'offset',
                    options: {
                      offset: [10, 0],
                    },
                  },
                ]}
              >
                <div
                  className="w-[220px]"
                  onMouseEnter={clearHoverCloseTimer}
                  onMouseLeave={scheduleHoverClose}
                >
                  {previewIdol ? (
                    <IdolCard
                      item={previewIdol}
                      onSelectIdol={(idol) => onIdolClick?.(idol)}
                      onOpenFavorites={onOpenFavorites}
                      onOpenCoverEditor={handleOpenIdolCoverEditor}
                      onOpenEditor={handleOpenIdolEditor}
                      href={buildIdolFilterHref(previewIdol)}
                      coverAspectPercent={coverAspectPercent}
                      showWorkCount={showIdolWorkCount}
                      preferChineseName={preferChineseName}
                    />
                  ) : null}
                </div>
              </Popper>
              <JavIdolCoverModal
                key={`idol-cover-${idolCoverEditorItem?.id || 'closed'}`}
                open={Boolean(idolCoverEditorItem)}
                item={idolCoverEditorItem}
                preferChineseName={preferChineseName}
                onClose={() => setIdolCoverEditorItem(null)}
                onSaved={handleIdolCoverSaved}
              />
              <JavIdolEditModal
                key={`idol-editor-${idolEditorItem?.id || 'closed'}`}
                open={Boolean(idolEditorItem)}
                item={idolEditorItem}
                preferChineseName={preferChineseName}
                onClose={() => setIdolEditorItem(null)}
                onSaved={handleIdolSaved}
                onMerged={() => {
                  setIdolEditorItem(null)
                  setPreviewIdol(null)
                }}
              />
            </>
          )}
          {!hideTags && tags.length > 0 && (
            <JavTagList
              tags={tags}
              maxRows={tagMaxRows}
              buildTagFilterHref={buildTagFilterHref}
              onTagClick={onTagClick}
              onFilterLinkClick={handleFilterLinkClick}
            />
          )}
          {!hideActions ? (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Tooltip title={openFileLabel || zh('用默认程序打开', 'Open with default app')}>
                  <IconButton
                    size="small"
                    onClick={handleOpenFile}
                    disabled={!canOpen}
                    aria-label={openFileLabel || zh('打开文件', 'Open file')}
                    className="h-6 w-6"
                  >
                    <PlayArrowIcon fontSize="inherit" />
                  </IconButton>
                </Tooltip>
                <Tooltip title={zh('编辑 JAV', 'Edit JAV')}>
                  <IconButton
                    size="small"
                    onClick={handleOpenEditor}
                    aria-label={zh('编辑 JAV', 'Edit JAV')}
                    className="h-6 w-6"
                  >
                    <MovieEdit fontSize="inherit" />
                  </IconButton>
                </Tooltip>
                <Tooltip title={zh('视频管理', 'Manage videos')}>
                  <IconButton
                    size="small"
                    onClick={handleOpenVideoManager}
                    disabled={!Array.isArray(item?.videos) || item.videos.length === 0}
                    aria-label={zh('视频管理', 'Manage videos')}
                    className="h-6 w-6"
                  >
                    <VideoLibraryOutlinedIcon fontSize="inherit" />
                  </IconButton>
                </Tooltip>
              </div>
              {Array.isArray(item?.videos) && item.videos.length > 1 && (
                <span className="text-xs text-gray-500">
                  {zh(`${item.videos.length} 个视频`, `${item.videos.length} video files`)}
                </span>
              )}
            </div>
          ) : null}
        </div>
      </div>
      <JavEditModal
        open={editorOpen}
        item={item}
        preferChineseName={preferChineseName}
        onClose={() => setEditorOpen(false)}
        onSaved={handleEditorSaved}
      />
      <JavCustomTagModal
        open={customTagEditorOpen}
        item={item}
        onClose={() => setCustomTagEditorOpen(false)}
        onSaved={handleCustomTagsSaved}
      />
      {detailOpen ? (
        <JavDetailModal
          item={item}
          cover={cover}
          title={titleText}
          releaseText={releaseText}
          durationText={durationText}
          studio={item?.studio}
          series={preferredSeries}
          tags={tags}
          externalLinks={externalLinks}
          preferChineseName={preferChineseName}
          canPlay={canPlay}
          onClose={() => setDetailOpen(false)}
          onPlay={() => {
            if (onManageVideoPlay) onManageVideoPlay(primaryVideo)
            else onPlay?.(primaryVideo, item)
          }}
          onOpenFavorites={() => onOpenJavFavorites?.(item)}
          onEdit={() => setEditorOpen(true)}
          favoriteRating={favoriteRating}
          favoriteRatingSaving={favoriteRatingSaving}
          favoriteRatingError={favoriteRatingError}
          onFavoriteRatingChange={handleFavoriteRatingChange}
          onSelectStudio={onStudioClick}
          onSelectSeries={onSeriesClick}
          onSelectIdol={onIdolClick}
          onSelectPrefix={onPrefixClick}
          loadIdolPreview={loadIdolPreview}
          loadStudioPreview={loadStudioPreview}
          loadSeriesPreview={loadSeriesPreview}
          buildIdolUrl={buildIdolFilterHref}
          buildStudioUrl={buildStudioFilterHref}
          buildSeriesUrl={buildSeriesFilterHref}
          buildTagUrl={buildTagFilterHref}
          onOpenIdolFavorites={onOpenFavorites}
          onOpenStudioFavorites={onOpenStudioFavorites}
          onOpenSeriesFavorites={onOpenSeriesFavorites}
          onOpenIdolCoverEditor={handleOpenIdolCoverEditor}
          onOpenIdolEditor={handleOpenIdolEditor}
          onVideoPlay={onManageVideoPlay}
          onVideoPlayAtTime={onManageVideoPlayAtTime}
          onVideoCoverChanged={onManageVideoCoverChanged}
          onVideoOpenFile={onManageVideoOpenFile}
          onVideoRevealFile={onManageVideoRevealFile}
          openFileLabel={openFileLabel}
          onVideoOpenTagPicker={onManageVideoOpenTagPicker}
          onVideoOpenScreenshots={onManageVideoOpenScreenshots}
          onVideoOpenScrapeSettings={onManageVideoOpenScrapeSettings}
          onVideoRename={onManageVideoRename}
          onVideoDelete={onManageVideoDelete}
          onVideoTagClick={onManageVideoTagClick}
        />
      ) : null}
    </>
  )
}

function JavVideoManagerModal({
  open,
  item,
  openFileLabel,
  onClose,
  onPlay,
  onOpenFile,
  onRevealFile,
  onOpenTagPicker,
  onOpenScreenshots,
  onOpenScrapeSettings,
  onRenameVideo,
  onDeleteVideo,
  onTagClick,
}) {
  const [selectedIds, setSelectedIds] = useState(() => new Set())

  useEffect(() => {
    if (open) setSelectedIds(new Set())
  }, [item?.id, open])

  if (!open) return null

  const videos = Array.isArray(item?.videos) ? item.videos : []
  const title = getJavDisplayTitle(item)
  const toggleSelectVideo = (video) => {
    const key = videoSelectionKey(video)
    if (!key) return
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <AppModal
      ariaLabel={zh('视频管理', 'Manage videos')}
      className="px-4"
      contentClassName="flex max-h-[90vh] w-full max-w-6xl flex-col rounded-lg bg-white p-4 shadow-xl"
      onClose={onClose}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{zh('视频管理', 'Manage videos')}</h2>
          <div className="mt-1 truncate text-xs text-gray-500">
            {item?.code || zh('未知番号', 'Unknown code')}
            {title && title !== item?.code ? ` · ${title}` : ''}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100"
          aria-label={zh('关闭视频管理', 'Close video manager')}
        >
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {videos.length > 0 ? (
          <VideoGrid
            videos={videos}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelectVideo}
            showSelection={false}
            onPlay={onPlay}
            onOpenFile={onOpenFile}
            onRevealFile={onRevealFile}
            openFileLabel={openFileLabel}
            onOpenTagPicker={onOpenTagPicker}
            showTagEditor={false}
            onOpenScreenshots={onOpenScreenshots}
            onOpenScrapeSettings={onOpenScrapeSettings}
            onRenameVideo={onRenameVideo}
            onDeleteVideo={onDeleteVideo}
            onTagClick={onTagClick}
          />
        ) : (
          <div className="flex min-h-[160px] items-center justify-center rounded border border-dashed border-gray-200 text-sm text-gray-500">
            {zh('暂无关联视频', 'No linked videos')}
          </div>
        )}
      </div>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          {zh('关闭', 'Close')}
        </button>
      </div>
    </AppModal>
  )
}
