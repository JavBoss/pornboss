import { useEffect, useMemo, useRef, useState } from 'react'
import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import SearchIcon from '@mui/icons-material/Search'
import { Slider } from '@mui/material'
import { fetchJavFilterOptions } from '@/api'
import AppModal from '@/components/AppModal'
import { isUserJavTag } from '@/constants/jav'
import { zh } from '@/utils/i18n'
import { getErrorMessage } from '@/utils/errors'
import { getIdolDisplayName } from '@/utils/javIdol'
import { withJavTagDisplayName } from '@/utils/javTag'

const EMPTY_FILTER_OPTIONS = {
  total: 0,
  solo_count: 0,
  prefixes: [],
  idols: [],
  tags: [],
  studios: [],
  series: [],
}

const cleanIds = (ids) =>
  Array.from(
    new Set((ids || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))
  )

const cleanJavPrefix = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')

const cleanFavoriteRating = (value, fallback) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(5, Math.max(0.5, Math.round(parsed * 2) / 2))
}

const unknownStudioOption = () => ({ id: 0, name: zh('未知片商', 'Unknown studio') })

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

function buildStudioSearchText(studio) {
  const aliases = Array.isArray(studio?.aliases) ? studio.aliases : []
  return [studio?.name, ...aliases].filter(Boolean).join(' ')
}

function SelectedIdolChip({ idol, preferChineseName, onRemove }) {
  const displayName = getIdolDisplayName(idol, preferChineseName)
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
      <span className="truncate">{displayName}</span>
      <button
        type="button"
        onClick={onRemove}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-blue-100"
        aria-label={zh(`删除女优 ${displayName}`, `Remove idol ${displayName}`)}
      >
        <CloseOutlinedIcon fontSize="inherit" />
      </button>
    </span>
  )
}

export default function JavQueryEditorModal({
  open,
  onClose,
  onApply,
  search = '',
  idolIds = [],
  idolOptions = [],
  tagIds = [],
  tagOptions = [],
  studioId = null,
  studioName = '',
  seriesId = null,
  seriesName = '',
  prefix = '',
  soloOnly = false,
  preferChineseName = false,
  showSimplifiedTags = false,
  favoriteGroupId = null,
  favoriteRatingEnabled = false,
  favoriteRatingMin = 0.5,
  favoriteRatingMax = 5,
}) {
  const prefixInputRef = useRef(null)
  const idolInputRef = useRef(null)
  const tagInputRef = useRef(null)
  const studioInputRef = useRef(null)
  const seriesInputRef = useRef(null)
  const prefixPickerRef = useRef(null)
  const idolPickerRef = useRef(null)
  const tagPickerRef = useRef(null)
  const studioPickerRef = useRef(null)
  const seriesPickerRef = useRef(null)
  const mouseDownTargetRef = useRef(null)
  const [keyword, setKeyword] = useState('')
  const [selectedPrefix, setSelectedPrefix] = useState(null)
  const [prefixSearch, setPrefixSearch] = useState('')
  const [prefixPickerOpen, setPrefixPickerOpen] = useState(false)
  const [selectedIdolIds, setSelectedIdolIds] = useState([])
  const [idolSearch, setIdolSearch] = useState('')
  const [idolPickerOpen, setIdolPickerOpen] = useState(false)
  const [knownIdols, setKnownIdols] = useState([])
  const [selectedTagIds, setSelectedTagIds] = useState([])
  const [tagSearch, setTagSearch] = useState('')
  const [tagPickerOpen, setTagPickerOpen] = useState(false)
  const [selectedStudio, setSelectedStudio] = useState(null)
  const [studioSearch, setStudioSearch] = useState('')
  const [studioPickerOpen, setStudioPickerOpen] = useState(false)
  const [selectedSeries, setSelectedSeries] = useState(null)
  const [selectedSoloOnly, setSelectedSoloOnly] = useState(false)
  const [selectedFavoriteRatingEnabled, setSelectedFavoriteRatingEnabled] = useState(false)
  const [selectedFavoriteRatingRange, setSelectedFavoriteRatingRange] = useState([0.5, 5])
  const [seriesSearch, setSeriesSearch] = useState('')
  const [seriesPickerOpen, setSeriesPickerOpen] = useState(false)
  const [filterOptions, setFilterOptions] = useState(EMPTY_FILTER_OPTIONS)
  const [filterOptionsLoading, setFilterOptionsLoading] = useState(false)
  const [filterOptionsError, setFilterOptionsError] = useState('')

  useEffect(() => {
    if (!open) return
    const trimmedStudioName = String(studioName || '').trim()
    const parsedStudioId = Number(studioId)
    const hasStudioFilter =
      studioId !== null && studioId !== undefined && String(studioId).trim() !== ''
    const trimmedSeriesName = String(seriesName || '').trim()
    const parsedSeriesId = Number(seriesId)
    const cleanedPrefix = cleanJavPrefix(prefix)
    setKeyword(String(search || '').trim())
    setSelectedPrefix(cleanedPrefix ? { prefix: cleanedPrefix, work_count: 0 } : null)
    setPrefixSearch('')
    setPrefixPickerOpen(false)
    setSelectedIdolIds(cleanIds(idolIds))
    setIdolSearch('')
    setIdolPickerOpen(false)
    setKnownIdols(Array.isArray(idolOptions) ? idolOptions : [])
    setSelectedTagIds(cleanIds(tagIds))
    setTagSearch('')
    setTagPickerOpen(false)
    setSelectedStudio(
      hasStudioFilter && Number.isFinite(parsedStudioId) && parsedStudioId >= 0
        ? {
            id: parsedStudioId,
            name:
              trimmedStudioName ||
              (parsedStudioId === 0 ? unknownStudioOption().name : `#${parsedStudioId}`),
          }
        : null
    )
    setStudioSearch('')
    setStudioPickerOpen(false)
    setSelectedSeries(
      Number.isFinite(parsedSeriesId) && parsedSeriesId > 0
        ? { id: parsedSeriesId, name: trimmedSeriesName || `#${parsedSeriesId}` }
        : null
    )
    setSelectedSoloOnly(Boolean(soloOnly))
    setSelectedFavoriteRatingEnabled(Boolean(favoriteRatingEnabled))
    const nextFavoriteRatingMin = cleanFavoriteRating(favoriteRatingMin, 0.5)
    const nextFavoriteRatingMax = cleanFavoriteRating(favoriteRatingMax, 5)
    setSelectedFavoriteRatingRange(
      nextFavoriteRatingMin <= nextFavoriteRatingMax
        ? [nextFavoriteRatingMin, nextFavoriteRatingMax]
        : [0.5, 5]
    )
    setSeriesSearch('')
    setSeriesPickerOpen(false)
    setFilterOptions(EMPTY_FILTER_OPTIONS)
    setFilterOptionsError('')
  }, [
    favoriteRatingEnabled,
    favoriteRatingMax,
    favoriteRatingMin,
    idolIds,
    idolOptions,
    open,
    prefix,
    search,
    seriesId,
    seriesName,
    soloOnly,
    studioId,
    studioName,
    tagIds,
  ])

  useEffect(() => {
    if (!open) return undefined
    const controller = new AbortController()
    setFilterOptionsLoading(true)
    setFilterOptionsError('')
    const timeout = window.setTimeout(() => {
      fetchJavFilterOptions({
        search: keyword.trim(),
        idolIds: selectedIdolIds,
        tagIds: selectedTagIds,
        studioId: selectedStudio?.id ?? null,
        seriesId: selectedSeries?.id ?? null,
        prefix: cleanJavPrefix(selectedPrefix?.prefix),
        soloOnly: selectedSoloOnly,
        favoriteGroupId,
        favoriteRatingEnabled: selectedFavoriteRatingEnabled,
        favoriteRatingMin: selectedFavoriteRatingRange[0],
        favoriteRatingMax: selectedFavoriteRatingRange[1],
        prefixSearch,
        idolSearch,
        tagSearch,
        studioSearch,
        seriesSearch,
        signal: controller.signal,
      })
        .then((payload) => {
          const next = {
            total: Number(payload?.total) || 0,
            solo_count: Number(payload?.solo_count) || 0,
            prefixes: Array.isArray(payload?.prefixes) ? payload.prefixes : [],
            idols: Array.isArray(payload?.idols) ? payload.idols : [],
            tags: Array.isArray(payload?.tags) ? payload.tags : [],
            studios: Array.isArray(payload?.studios) ? payload.studios : [],
            series: Array.isArray(payload?.series) ? payload.series : [],
          }
          setFilterOptions(next)
          setKnownIdols((current) => {
            const byId = new Map()
            ;[...(idolOptions || []), ...(current || []), ...next.idols].forEach((idol) => {
              const id = Number(idol?.id)
              if (Number.isFinite(id) && id > 0) byId.set(id, idol)
            })
            return Array.from(byId.values())
          })
        })
        .catch((err) => {
          if (err?.name !== 'AbortError') setFilterOptionsError(getErrorMessage(err))
        })
        .finally(() => {
          if (!controller.signal.aborted) setFilterOptionsLoading(false)
        })
    }, 180)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [
    favoriteGroupId,
    idolOptions,
    idolSearch,
    keyword,
    open,
    prefixSearch,
    selectedIdolIds,
    selectedPrefix?.prefix,
    selectedFavoriteRatingEnabled,
    selectedFavoriteRatingRange,
    selectedSeries?.id,
    selectedSoloOnly,
    selectedStudio?.id,
    selectedTagIds,
    seriesSearch,
    studioSearch,
    tagSearch,
  ])

  useEffect(() => {
    if (!open) return undefined

    const pickers = [
      [prefixPickerRef, setPrefixPickerOpen],
      [idolPickerRef, setIdolPickerOpen],
      [tagPickerRef, setTagPickerOpen],
      [studioPickerRef, setStudioPickerOpen],
      [seriesPickerRef, setSeriesPickerOpen],
    ]
    const handleMouseDown = (event) => {
      mouseDownTargetRef.current = event.target
      pickers.forEach(([pickerRef, setPickerOpen]) => {
        if (pickerRef.current && !pickerRef.current.contains(event.target)) {
          setPickerOpen(false)
        }
      })
    }
    const handleMouseUp = () => {
      mouseDownTargetRef.current = null
    }

    document.addEventListener('mousedown', handleMouseDown, true)
    document.addEventListener('mouseup', handleMouseUp, true)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true)
      document.removeEventListener('mouseup', handleMouseUp, true)
      mouseDownTargetRef.current = null
    }
  }, [open])

  const tagMap = useMemo(
    () =>
      new Map(
        [...(tagOptions || []), ...(filterOptions.tags || [])].map((tag) => [
          Number(tag.id),
          withJavTagDisplayName(tag, showSimplifiedTags),
        ])
      ),
    [filterOptions.tags, showSimplifiedTags, tagOptions]
  )

  const idolMap = useMemo(() => {
    const map = new Map()
    const addIdol = (idol) => {
      const id = Number(idol?.id)
      if (!Number.isFinite(id) || id <= 0 || map.has(id)) return
      map.set(id, idol)
    }
    ;(idolOptions || []).forEach(addIdol)
    ;(knownIdols || []).forEach(addIdol)
    ;(filterOptions.idols || []).forEach(addIdol)
    return map
  }, [filterOptions.idols, idolOptions, knownIdols])

  const selectedIdols = useMemo(
    () => selectedIdolIds.map((id) => idolMap.get(id) || { id, name: `#${id}` }),
    [idolMap, selectedIdolIds]
  )

  const selectedTags = useMemo(
    () => selectedTagIds.map((id) => tagMap.get(id)).filter(Boolean),
    [selectedTagIds, tagMap]
  )

  const filteredTags = useMemo(() => {
    const query = tagSearch.trim().toLowerCase()
    const selected = new Set(selectedTagIds.map(Number))
    const list = Array.isArray(filterOptions.tags) ? filterOptions.tags : []
    return [...list]
      .map((tag) => withJavTagDisplayName(tag, showSimplifiedTags))
      .filter((tag) => {
        if (selected.has(Number(tag?.id))) return false
        if (!query) return true
        return [tag?.name, tag?.original_name, tag?.simplified_name]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query)
      })
      .sort((a, b) => {
        const typeOrder = Number(isUserJavTag(b)) - Number(isUserJavTag(a))
        if (typeOrder !== 0) return typeOrder
        const countA = Number.isFinite(a?.count) ? a.count : 0
        const countB = Number.isFinite(b?.count) ? b.count : 0
        if (countB !== countA) return countB - countA
        return String(a?.name || '').localeCompare(String(b?.name || ''))
      })
      .slice(0, 120)
  }, [filterOptions.tags, selectedTagIds, showSimplifiedTags, tagSearch])

  const filteredIdols = useMemo(() => {
    const query = idolSearch.trim().toLowerCase()
    const selected = new Set(selectedIdolIds.map(Number))
    return [...(filterOptions.idols || [])]
      .filter((idol) => {
        if (selected.has(Number(idol?.id))) return false
        if (!query) return true
        return buildIdolSearchText(idol, preferChineseName).toLowerCase().includes(query)
      })
      .sort((a, b) => {
        const countA = Number.isFinite(a?.work_count) ? a.work_count : 0
        const countB = Number.isFinite(b?.work_count) ? b.work_count : 0
        if (countB !== countA) return countB - countA
        return getIdolDisplayName(a, preferChineseName).localeCompare(
          getIdolDisplayName(b, preferChineseName)
        )
      })
  }, [filterOptions.idols, idolSearch, preferChineseName, selectedIdolIds])

  const selectedPrefixDisplay = useMemo(() => {
    const prefixValue = cleanJavPrefix(selectedPrefix?.prefix)
    if (!prefixValue) return null
    return (
      (filterOptions.prefixes || []).find((item) => item.prefix === prefixValue) || selectedPrefix
    )
  }, [filterOptions.prefixes, selectedPrefix])

  const filteredPrefixes = useMemo(() => {
    const query = prefixSearch.trim().toLowerCase()
    return [...(filterOptions.prefixes || [])]
      .filter((item) => {
        if (!query) return true
        return [item?.prefix, item?.studio_name]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query)
      })
      .sort((a, b) => {
        const countA = Number.isFinite(a?.work_count) ? a.work_count : 0
        const countB = Number.isFinite(b?.work_count) ? b.work_count : 0
        if (countB !== countA) return countB - countA
        return String(a?.prefix || '').localeCompare(String(b?.prefix || ''))
      })
      .slice(0, 200)
  }, [filterOptions.prefixes, prefixSearch])

  const filteredStudios = useMemo(() => {
    const query = studioSearch.trim().toLowerCase()
    return (filterOptions.studios || [])
      .map((studio) =>
        Number(studio?.id) === 0 ? { ...studio, name: unknownStudioOption().name } : studio
      )
      .filter((studio) => {
        if (!query) return true
        return buildStudioSearchText(studio).toLowerCase().includes(query)
      })
      .sort((a, b) => {
        if (Number(a?.id) === 0) return -1
        if (Number(b?.id) === 0) return 1
        const countA = Number.isFinite(a?.work_count) ? a.work_count : 0
        const countB = Number.isFinite(b?.work_count) ? b.work_count : 0
        if (countB !== countA) return countB - countA
        return String(a?.name || '').localeCompare(String(b?.name || ''))
      })
  }, [filterOptions.studios, studioSearch])

  const filteredSeries = useMemo(() => {
    const query = seriesSearch.trim().toLowerCase()
    return [...(filterOptions.series || [])]
      .filter((series) => {
        if (!query) return true
        return String(series?.name || '')
          .toLowerCase()
          .includes(query)
      })
      .sort((a, b) => {
        const countA = Number.isFinite(a?.work_count) ? a.work_count : 0
        const countB = Number.isFinite(b?.work_count) ? b.work_count : 0
        if (countB !== countA) return countB - countA
        return String(a?.name || '').localeCompare(String(b?.name || ''))
      })
  }, [filterOptions.series, seriesSearch])

  const toggleIdol = (id) => {
    const parsed = Number(id)
    if (!Number.isFinite(parsed) || parsed <= 0) return
    setSelectedIdolIds((prev) => {
      const next = new Set(prev)
      if (next.has(parsed)) next.delete(parsed)
      else next.add(parsed)
      return Array.from(next)
    })
  }

  const removeIdol = (id) => {
    const parsed = Number(id)
    setSelectedIdolIds((prev) => prev.filter((item) => item !== parsed))
  }

  const toggleTag = (id) => {
    const parsed = Number(id)
    if (!Number.isFinite(parsed) || parsed <= 0) return
    setSelectedTagIds((prev) => {
      const next = new Set(prev)
      if (next.has(parsed)) next.delete(parsed)
      else next.add(parsed)
      return Array.from(next)
    })
  }

  const removeTag = (id) => {
    const parsed = Number(id)
    setSelectedTagIds((prev) => prev.filter((item) => item !== parsed))
  }

  const clearAll = () => {
    setKeyword('')
    setSelectedPrefix(null)
    setPrefixSearch('')
    setPrefixPickerOpen(false)
    setSelectedIdolIds([])
    setIdolSearch('')
    setSelectedTagIds([])
    setTagSearch('')
    setSelectedStudio(null)
    setStudioSearch('')
    setStudioPickerOpen(false)
    setSelectedSeries(null)
    setSelectedSoloOnly(false)
    setSelectedFavoriteRatingEnabled(false)
    setSelectedFavoriteRatingRange([0.5, 5])
    setSeriesSearch('')
    setSeriesPickerOpen(false)
  }

  const applyQuery = () => {
    onApply?.({
      search: keyword.trim(),
      prefix: cleanJavPrefix(selectedPrefix?.prefix),
      idolIds: selectedIdolIds,
      tagIds: selectedTagIds,
      studio: selectedStudio,
      series: selectedSeries,
      soloOnly: selectedSoloOnly,
      favoriteRatingEnabled: selectedFavoriteRatingEnabled,
      favoriteRatingMin: selectedFavoriteRatingRange[0],
      favoriteRatingMax: selectedFavoriteRatingRange[1],
    })
  }

  const closePickerOnBlur = (setPickerOpen) => (event) => {
    const currentTarget = event.currentTarget
    if (currentTarget.contains(mouseDownTargetRef.current)) return
    if (!currentTarget.contains(event.relatedTarget)) setPickerOpen(false)
  }

  if (!open) return null

  return (
    <AppModal
      ariaLabel={zh('编辑 JAV 查询条件', 'Edit JAV Filters')}
      className="px-4"
      contentClassName="jav-query-editor-modal flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-slate-200"
      onClose={onClose}
    >
      <div className="flex items-center gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4">
        <h2 className="shrink-0 text-base font-semibold text-slate-900">
          {zh('编辑 JAV 查询条件', 'Edit JAV Filters')}
        </h2>
        <div
          className={`ml-auto min-w-0 rounded-lg border px-3.5 py-2 text-[13px] ${
            filterOptionsError
              ? 'border-rose-200 bg-rose-50 text-rose-700'
              : 'border-blue-100 bg-blue-50 text-blue-700'
          }`}
        >
          <div className="truncate">
            {filterOptionsError
              ? filterOptionsError
              : filterOptionsLoading
                ? zh('正在更新可添加条件…', 'Updating available filters…')
                : zh(
                    `当前条件匹配 ${filterOptions.total} 部，选项右侧数字表示添加该选项后剩余作品数。`,
                    `${filterOptions.total} works match. The number to the right of an option shows how many works remain after adding it.`
                  )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-200"
          aria-label={zh('关闭查询条件编辑', 'Close query editor')}
        >
          <CloseOutlinedIcon fontSize="small" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <section className="min-w-0 space-y-2">
          <div className="text-sm font-semibold text-slate-800">{zh('作品类型', 'Work Type')}</div>
          <label className="flex cursor-pointer items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            <input
              type="checkbox"
              checked={selectedSoloOnly}
              onChange={(event) => setSelectedSoloOnly(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-blue-600"
            />
            <span className="min-w-0 flex-1">{zh('只看单体作品', 'Solo works only')}</span>
            {!selectedSoloOnly ? (
              <span className="shrink-0 text-xs text-slate-400">
                {zh(`${filterOptions.solo_count} 部`, `${filterOptions.solo_count} works`)}
              </span>
            ) : null}
          </label>
        </section>

        <section className="min-w-0 space-y-2">
          <div className="text-sm font-semibold text-slate-800">
            {zh('喜爱度', 'Favorite Rating')}
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            <input
              type="checkbox"
              checked={selectedFavoriteRatingEnabled}
              onChange={(event) => setSelectedFavoriteRatingEnabled(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-blue-600"
            />
            <span>{zh('按喜爱度范围筛选', 'Filter by favorite rating range')}</span>
          </label>
          {selectedFavoriteRatingEnabled ? (
            <div className="rounded border border-slate-200 bg-slate-50 px-5 pb-2 pt-7">
              <Slider
                value={selectedFavoriteRatingRange}
                onChange={(_, value) => {
                  if (Array.isArray(value)) setSelectedFavoriteRatingRange(value)
                }}
                min={0.5}
                max={5}
                step={0.5}
                disableSwap
                valueLabelDisplay="on"
                valueLabelFormat={(value) => Number(value).toFixed(1)}
                getAriaLabel={(index) =>
                  index === 0
                    ? zh('最低喜爱度', 'Minimum favorite rating')
                    : zh('最高喜爱度', 'Maximum favorite rating')
                }
                sx={{
                  color: '#2563eb',
                  py: 1,
                  '& .MuiSlider-valueLabel': {
                    top: -4,
                    padding: 0,
                    background: 'transparent',
                    color: '#475569',
                    fontSize: '0.75rem',
                    fontWeight: 500,
                  },
                  '& .MuiSlider-valueLabel::before': { display: 'none' },
                }}
              />
            </div>
          ) : null}
        </section>

        <div className="grid grid-cols-2 items-start gap-x-5 gap-y-4">
          <section className="min-w-0 space-y-2">
            <label
              className="block text-sm font-semibold leading-5 text-slate-800"
              htmlFor="jav-query-keyword"
            >
              {zh('关键词', 'Keyword')}
            </label>
            <div className="flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
              <SearchIcon fontSize="small" className="text-slate-400" />
              <input
                id="jav-query-keyword"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                className="min-w-0 flex-1 border-0 text-sm outline-none"
                placeholder={zh('番号或标题关键词', 'Code or title keyword')}
              />
              {keyword ? (
                <button
                  type="button"
                  onClick={() => setKeyword('')}
                  className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-slate-100"
                  aria-label={zh('清空关键词', 'Clear keyword')}
                >
                  <CloseOutlinedIcon fontSize="inherit" />
                </button>
              ) : null}
            </div>
          </section>

          <section className="min-w-0 space-y-2">
            <div className="text-sm font-semibold leading-5 text-slate-800">
              {zh('番号', 'Code')}
            </div>
            {selectedPrefixDisplay ? (
              <div className="flex items-center justify-between gap-2 rounded border border-cyan-100 bg-cyan-50 px-3 py-2 text-sm text-cyan-800">
                <span className="min-w-0 flex-1 truncate font-medium">
                  {selectedPrefixDisplay.prefix}
                </span>
                {Number.isFinite(selectedPrefixDisplay?.work_count) &&
                selectedPrefixDisplay.work_count > 0 ? (
                  <span className="shrink-0 text-xs text-cyan-600">
                    {zh(
                      `${selectedPrefixDisplay.work_count} 部`,
                      `${selectedPrefixDisplay.work_count} works`
                    )}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPrefix(null)
                    setPrefixSearch('')
                  }}
                  className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-cyan-100"
                  aria-label={zh('删除番号条件', 'Remove code filter')}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </button>
              </div>
            ) : null}
            <div
              ref={prefixPickerRef}
              className={selectedPrefixDisplay ? 'hidden' : ''}
              onBlur={closePickerOnBlur(setPrefixPickerOpen)}
            >
              <input
                ref={prefixInputRef}
                id="jav-query-prefix"
                value={prefixSearch}
                onFocus={() => setPrefixPickerOpen(true)}
                onChange={(event) => {
                  setPrefixSearch(cleanJavPrefix(event.target.value))
                  setPrefixPickerOpen(true)
                  setSelectedPrefix(null)
                }}
                className="w-full rounded border border-slate-200 px-3 py-2 text-sm uppercase outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                placeholder={zh('搜索并选择番号', 'Search and choose a code')}
              />
              {prefixPickerOpen ? (
                <div className="mt-1 max-h-52 overflow-y-auto rounded border border-slate-200 bg-white p-1 shadow-lg">
                  {filterOptionsLoading ? (
                    <div className="px-2 py-3 text-sm text-slate-500">
                      {zh('加载中…', 'Loading...')}
                    </div>
                  ) : filteredPrefixes.length > 0 ? (
                    filteredPrefixes.map((item) => {
                      const checked = selectedPrefix?.prefix === item.prefix
                      return (
                        <button
                          key={item.prefix}
                          type="button"
                          role="radio"
                          aria-checked={checked}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            setSelectedPrefix(item)
                            setPrefixSearch('')
                            setPrefixPickerOpen(false)
                            prefixInputRef.current?.blur()
                          }}
                          className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50"
                        >
                          <input
                            type="radio"
                            checked={checked}
                            readOnly
                            tabIndex={-1}
                            className="pointer-events-none h-4 w-4 shrink-0 border-slate-300 text-blue-600"
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1 truncate font-medium text-slate-800">
                            {item.prefix}
                          </span>
                          {item.studio_name ? (
                            <span className="min-w-0 max-w-[45%] truncate text-xs text-slate-400">
                              {item.studio_name}
                            </span>
                          ) : null}
                          <span className="shrink-0 text-xs text-slate-400">
                            {zh(`${item.work_count || 0} 部`, `${item.work_count || 0} works`)}
                          </span>
                        </button>
                      )
                    })
                  ) : (
                    <div className="px-2 py-3 text-sm text-slate-500">
                      {zh('没有匹配番号', 'No matching codes')}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </section>

          <section className="min-w-0 space-y-2">
            <div className="text-sm font-semibold text-slate-800">{zh('女优', 'Idols')}</div>
            {selectedIdols.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {selectedIdols.map((idol) => (
                  <SelectedIdolChip
                    key={idol.id}
                    idol={idol}
                    preferChineseName={preferChineseName}
                    onRemove={() => removeIdol(idol.id)}
                  />
                ))}
              </div>
            ) : null}
            <div ref={idolPickerRef} onBlur={closePickerOnBlur(setIdolPickerOpen)}>
              <input
                ref={idolInputRef}
                value={idolSearch}
                onFocus={() => setIdolPickerOpen(true)}
                onChange={(event) => {
                  setIdolSearch(event.target.value)
                  setIdolPickerOpen(true)
                }}
                className="w-full rounded border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                placeholder={zh('搜索女优', 'Search idols')}
              />
              {idolPickerOpen ? (
                <div className="mt-1 max-h-52 overflow-y-auto rounded border border-slate-200 bg-white p-1 shadow-lg">
                  {filterOptionsLoading ? (
                    <div className="px-2 py-3 text-sm text-slate-500">
                      {zh('加载中…', 'Loading...')}
                    </div>
                  ) : filteredIdols.length > 0 ? (
                    filteredIdols.map((idol) => {
                      const checked = selectedIdolIds.includes(Number(idol.id))
                      return (
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={checked}
                          key={idol.id}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            toggleIdol(idol.id)
                            setIdolSearch('')
                            setIdolPickerOpen(false)
                            idolInputRef.current?.blur()
                          }}
                          className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            readOnly
                            tabIndex={-1}
                            className="pointer-events-none h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600"
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1 truncate text-slate-800">
                            {getIdolDisplayName(idol, preferChineseName)}
                          </span>
                          {Number.isFinite(idol?.work_count) ? (
                            <span className="shrink-0 text-xs text-slate-400">
                              {zh(`${idol.work_count} 部`, `${idol.work_count} works`)}
                            </span>
                          ) : null}
                        </button>
                      )
                    })
                  ) : (
                    <div className="px-2 py-3 text-sm text-slate-500">
                      {zh('没有匹配女优', 'No matching idols')}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </section>

          <section className="min-w-0 space-y-2">
            <div className="text-sm font-semibold text-slate-800">{zh('标签', 'Tags')}</div>
            {selectedTags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {selectedTags.map((tag) => (
                  <span
                    key={`${tag.id}-${tag.provider || 0}`}
                    className="inline-flex max-w-full items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"
                    title={
                      isUserJavTag(tag)
                        ? zh('自定义标签', 'Custom tag')
                        : zh('刮削标签', 'Scraped tag')
                    }
                  >
                    <span className="truncate">{tag.name}</span>
                    <button
                      type="button"
                      onClick={() => removeTag(tag.id)}
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-emerald-100"
                      aria-label={zh(`删除标签 ${tag.name}`, `Remove tag ${tag.name}`)}
                    >
                      <CloseOutlinedIcon fontSize="inherit" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <div ref={tagPickerRef} onBlur={closePickerOnBlur(setTagPickerOpen)}>
              <input
                ref={tagInputRef}
                value={tagSearch}
                onFocus={() => setTagPickerOpen(true)}
                onChange={(event) => {
                  setTagSearch(event.target.value)
                  setTagPickerOpen(true)
                }}
                className="w-full rounded border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                placeholder={zh('搜索标签', 'Search tags')}
              />
              {tagPickerOpen ? (
                <div className="mt-1 max-h-52 overflow-y-auto rounded border border-slate-200 bg-white p-1 shadow-lg">
                  {filterOptionsLoading ? (
                    <div className="px-2 py-3 text-sm text-slate-500">
                      {zh('加载中…', 'Loading...')}
                    </div>
                  ) : filteredTags.length > 0 ? (
                    filteredTags.map((tag) => {
                      const checked = selectedTagIds.includes(Number(tag.id))
                      const isUser = isUserJavTag(tag)
                      return (
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={checked}
                          key={`${tag.id}-${tag.provider || 0}`}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            toggleTag(tag.id)
                            setTagSearch('')
                            setTagPickerOpen(false)
                            tagInputRef.current?.blur()
                          }}
                          className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            readOnly
                            tabIndex={-1}
                            className="pointer-events-none h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600"
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1 truncate text-slate-800">{tag.name}</span>
                          <span
                            className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${
                              isUser
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-orange-50 text-orange-700'
                            }`}
                          >
                            {isUser
                              ? zh('自定义标签', 'Custom tag')
                              : zh('刮削标签', 'Scraped tag')}
                          </span>
                          {Number.isFinite(tag?.count) ? (
                            <span className="shrink-0 text-xs text-slate-400">
                              {zh(`${tag.count} 部`, `${tag.count} works`)}
                            </span>
                          ) : null}
                        </button>
                      )
                    })
                  ) : (
                    <div className="px-2 py-3 text-sm text-slate-500">
                      {zh('没有匹配标签', 'No matching tags')}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </section>

          <section className="min-w-0 space-y-2">
            <div className="text-sm font-semibold text-slate-800">{zh('片商', 'Studio')}</div>
            {selectedStudio ? (
              <div className="flex items-center justify-between gap-2 rounded border border-violet-100 bg-violet-50 px-3 py-2 text-sm text-violet-800">
                <span className="min-w-0 truncate font-medium">{selectedStudio.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedStudio(null)
                    setStudioSearch('')
                  }}
                  className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-violet-100"
                  aria-label={zh('删除片商条件', 'Remove studio filter')}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </button>
              </div>
            ) : null}
            <div
              ref={studioPickerRef}
              className={selectedStudio ? 'hidden' : ''}
              onBlur={closePickerOnBlur(setStudioPickerOpen)}
            >
              <input
                ref={studioInputRef}
                value={studioSearch}
                onFocus={() => setStudioPickerOpen(true)}
                onChange={(event) => {
                  setStudioSearch(event.target.value)
                  setStudioPickerOpen(true)
                  setSelectedStudio(null)
                }}
                className="w-full rounded border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                placeholder={zh('搜索并选择片商', 'Search and choose a studio')}
              />
              {studioPickerOpen ? (
                <div className="mt-1 max-h-52 overflow-y-auto rounded border border-slate-200 bg-white p-1 shadow-lg">
                  {filterOptionsLoading ? (
                    <div className="px-2 py-3 text-sm text-slate-500">
                      {zh('加载中…', 'Loading...')}
                    </div>
                  ) : filteredStudios.length > 0 ? (
                    filteredStudios.map((studio) => {
                      const checked = Number(selectedStudio?.id) === Number(studio.id)
                      return (
                        <button
                          key={studio.id}
                          type="button"
                          role="radio"
                          aria-checked={checked}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            setSelectedStudio({ id: studio.id, name: studio.name })
                            setStudioSearch('')
                            setStudioPickerOpen(false)
                            studioInputRef.current?.blur()
                          }}
                          className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50"
                        >
                          <input
                            type="radio"
                            checked={checked}
                            readOnly
                            tabIndex={-1}
                            className="pointer-events-none h-4 w-4 shrink-0 border-slate-300 text-blue-600"
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1 truncate text-slate-800">
                            {studio.name}
                          </span>
                          <span className="shrink-0 text-xs text-slate-400">
                            {zh(`${studio.work_count || 0} 部`, `${studio.work_count || 0} works`)}
                          </span>
                        </button>
                      )
                    })
                  ) : (
                    <div className="px-2 py-3 text-sm text-slate-500">
                      {zh('没有匹配片商', 'No matching studios')}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </section>

          <section className="min-w-0 space-y-2">
            <div className="text-sm font-semibold text-slate-800">{zh('系列', 'Series')}</div>
            {selectedSeries ? (
              <div className="flex items-center justify-between gap-2 rounded border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                <span className="min-w-0 truncate font-medium">{selectedSeries.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSeries(null)
                    setSeriesSearch('')
                  }}
                  className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-emerald-100"
                  aria-label={zh('删除系列条件', 'Remove series filter')}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </button>
              </div>
            ) : null}
            <div
              ref={seriesPickerRef}
              className={selectedSeries ? 'hidden' : ''}
              onBlur={closePickerOnBlur(setSeriesPickerOpen)}
            >
              <input
                ref={seriesInputRef}
                value={seriesSearch}
                onFocus={() => setSeriesPickerOpen(true)}
                onChange={(event) => {
                  setSeriesSearch(event.target.value)
                  setSeriesPickerOpen(true)
                  setSelectedSeries(null)
                }}
                className="w-full rounded border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                placeholder={zh('搜索并选择系列', 'Search and choose a series')}
              />
              {seriesPickerOpen ? (
                <div className="mt-1 max-h-52 overflow-y-auto rounded border border-slate-200 bg-white p-1 shadow-lg">
                  {filterOptionsLoading ? (
                    <div className="px-2 py-3 text-sm text-slate-500">
                      {zh('加载中…', 'Loading...')}
                    </div>
                  ) : filteredSeries.length > 0 ? (
                    filteredSeries.map((series) => {
                      const checked = Number(selectedSeries?.id) === Number(series.id)
                      return (
                        <button
                          key={series.id}
                          type="button"
                          role="radio"
                          aria-checked={checked}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            setSelectedSeries({ id: series.id, name: series.name })
                            setSeriesSearch('')
                            setSeriesPickerOpen(false)
                            seriesInputRef.current?.blur()
                          }}
                          className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50"
                        >
                          <input
                            type="radio"
                            checked={checked}
                            readOnly
                            tabIndex={-1}
                            className="pointer-events-none h-4 w-4 shrink-0 border-slate-300 text-blue-600"
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1 truncate text-slate-800">
                            {series.name}
                          </span>
                          <span className="shrink-0 text-xs text-slate-400">
                            {zh(`${series.work_count || 0} 部`, `${series.work_count || 0} works`)}
                          </span>
                        </button>
                      )
                    })
                  ) : (
                    <div className="px-2 py-3 text-sm text-slate-500">
                      {zh('没有匹配系列', 'No matching series')}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
        <button
          type="button"
          onClick={clearAll}
          className="rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
        >
          {zh('清空条件', 'Clear Filters')}
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
          >
            {zh('取消', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={applyQuery}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            {zh('应用查询', 'Apply Query')}
          </button>
        </div>
      </div>
    </AppModal>
  )
}
