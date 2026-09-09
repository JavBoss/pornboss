import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Popper } from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import StarBorderRoundedIcon from '@mui/icons-material/StarBorderRounded'
import StarRoundedIcon from '@mui/icons-material/StarRounded'

import {
  fetchJavSeriesPreview,
  fetchJavStudioOptions,
  mergeJavStudios,
  updateJavStudio,
} from '@/api'
import AppModal from '@/components/AppModal'
import Pagination from '@/components/Pagination'
import { SeriesCard } from '@/components/JavSeriesView'
import WaterfallLoader from '@/components/WaterfallLoader'
import { useStore } from '@/store'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'
import { openJavDBWithAssist } from '@/utils/javdb'

export default function JavStudioView({
  page,
  lastPage,
  totalItems,
  hasPrev,
  hasNext,
  loading,
  buildPageUrl,
  buildStudioUrl,
  buildSeriesUrl,
  onFirst,
  onPrev,
  onGoToPage,
  onNext,
  onLast,
  items,
  onSelectStudio,
  onSelectSeries,
  onSelectPrefix,
  onOpenFavorites,
  onOpenSeriesFavorites,
  waterfallMode,
  onWaterfallModeChange,
  onLoadMore,
  loadingMore,
  hasMore,
  onMerged,
}) {
  return (
    <>
      <div className="sticky-pagination mb-4 flex justify-center">
        <Pagination
          page={page}
          lastPage={lastPage}
          totalItems={totalItems}
          hasPrev={hasPrev}
          hasNext={hasNext}
          loading={loading}
          buildPageUrl={buildPageUrl}
          onFirst={onFirst}
          onPrev={onPrev}
          onGoToPage={onGoToPage}
          onNext={onNext}
          onLast={onLast}
          waterfallMode={waterfallMode}
          onWaterfallModeChange={onWaterfallModeChange}
        />
      </div>
      {loading ? (
        <div className="mt-4 flex min-h-[200px] items-center justify-center rounded border border-dashed border-gray-200 text-gray-500">
          {zh('加载中…', 'Loading...')}
        </div>
      ) : (
        <JavStudioGrid
          items={items}
          onSelectStudio={onSelectStudio}
          onSelectPrefix={onSelectPrefix}
          onOpenFavorites={onOpenFavorites}
          onOpenSeriesFavorites={onOpenSeriesFavorites}
          buildStudioUrl={buildStudioUrl}
          buildSeriesUrl={buildSeriesUrl}
          onSelectSeries={onSelectSeries}
          onMerged={onMerged}
        />
      )}
      <WaterfallLoader
        enabled={waterfallMode && !loading}
        hasMore={hasMore}
        loading={loadingMore}
        onLoadMore={onLoadMore}
      />
    </>
  )
}

function JavStudioGrid({
  items,
  onSelectStudio,
  onSelectSeries,
  onSelectPrefix,
  onOpenFavorites,
  onOpenSeriesFavorites,
  buildStudioUrl,
  buildSeriesUrl,
  onMerged,
}) {
  const [editItem, setEditItem] = useState(null)
  const [overrides, setOverrides] = useState(() => new Map())
  const displayItems = useMemo(() => {
    if (!Array.isArray(items)) return []
    return items.map((item) => {
      const id = Number(item?.id)
      const override = Number.isFinite(id) ? overrides.get(id) : null
      return override ? { ...item, ...override } : item
    })
  }, [items, overrides])
  const hasItems = displayItems.length > 0
  if (!hasItems) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded border border-dashed border-gray-200 text-gray-500">
        {zh('暂无片商数据', 'No studio data')}
      </div>
    )
  }

  return (
    <>
      <div
        className="grid gap-4 bg-white"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(16rem, 1fr))' }}
      >
        {displayItems.map((item) => (
          <StudioCard
            key={item.id || item.name}
            item={item}
            href={buildStudioUrl?.(item)}
            onSelectStudio={onSelectStudio}
            onSelectSeries={onSelectSeries}
            onSelectPrefix={onSelectPrefix}
            onOpenFavorites={onOpenFavorites}
            onOpenSeriesFavorites={onOpenSeriesFavorites}
            onOpenEditor={setEditItem}
            buildSeriesUrl={buildSeriesUrl}
          />
        ))}
      </div>
      <JavStudioEditModal
        key={`studio-edit-${editItem?.id || 'closed'}`}
        open={Boolean(editItem)}
        item={editItem}
        onClose={() => setEditItem(null)}
        onSaved={(updated) => {
          const id = Number(updated?.id)
          if (!Number.isFinite(id) || id <= 0) return
          setOverrides((current) => {
            const next = new Map(current)
            next.set(id, updated)
            return next
          })
          setEditItem(updated)
        }}
        onMerged={(updated) => {
          setEditItem(null)
          onMerged?.(updated)
        }}
      />
    </>
  )
}

export function StudioCard({
  item,
  href,
  onSelectStudio,
  onSelectSeries,
  onSelectPrefix,
  onOpenFavorites,
  onOpenSeriesFavorites,
  onSeriesListOpenChange,
  onOpenEditor,
  buildSeriesUrl,
  seriesListModalZIndex = 1500,
}) {
  const directoryVisibilityKey = useStore((state) =>
    (state.directories || [])
      .map((directory) => `${directory.id}:${directory.enabled !== false ? '1' : '0'}`)
      .join(',')
  )
  const sampleCode = String(item?.sample_code || '').trim()
  const cover = sampleCode ? `/jav/${encodeURIComponent(sampleCode)}/cover` : null
  const name = item?.name || zh('未知片商', 'Unknown studio')
  const studioId = Number(item?.id)
  const workCount = Number(item?.work_count)
  const showWorkCount = Number.isFinite(workCount) && workCount > 0
  const codePrefixes = Array.isArray(item?.code_prefixes)
    ? item.code_prefixes
        .map((prefixItem) => {
          if (typeof prefixItem === 'string') {
            const prefix = prefixItem.trim()
            return prefix ? { prefix, work_count: null } : null
          }
          const prefix = String(prefixItem?.prefix || '').trim()
          if (!prefix) return null
          const prefixWorkCount = Number(prefixItem?.work_count)
          return {
            prefix,
            work_count:
              Number.isFinite(prefixWorkCount) && prefixWorkCount > 0 ? prefixWorkCount : null,
          }
        })
        .filter(Boolean)
    : []
  const seriesItems = useMemo(
    () =>
      Array.isArray(item?.series)
        ? item.series.filter(
            (series) => Number(series?.id) > 0 && String(series?.name || '').trim()
          )
        : [],
    [item?.series]
  )
  const favoriteCount = Number(item?.favorite_count) || 0
  const aliases = Array.isArray(item?.aliases)
    ? item.aliases.map((alias) => String(alias || '').trim()).filter(Boolean)
    : []
  const searchName = String(item?.name || '').trim()
  const javDBSearchURL = searchName
    ? `https://javdb.com/search?f=maker&q=${encodeURIComponent(searchName)}`
    : ''
  const [previewSeries, setPreviewSeries] = useState(null)
  const [seriesHoverAnchorEl, setSeriesHoverAnchorEl] = useState(null)
  const [seriesListOpen, setSeriesListOpen] = useState(false)
  const [visibleSeriesCount, setVisibleSeriesCount] = useState(null)
  const [forcedFirstRowSeries, setForcedFirstRowSeries] = useState(null)
  const seriesPreviewCacheRef = useRef(new Map())
  const seriesListRef = useRef(null)
  const seriesMeasureRef = useRef(null)
  const closeTimerRef = useRef(null)
  const activeSeriesHoverIdRef = useRef(null)
  const hasReportedSeriesListOpenRef = useRef(false)
  const canOpenJavDB = Boolean(javDBSearchURL)
  const displayedSeriesItems =
    visibleSeriesCount == null ? seriesItems : seriesItems.slice(0, visibleSeriesCount)
  const hasHiddenSeries = displayedSeriesItems.length < seriesItems.length

  const handleClick = (e) => {
    const selection = window.getSelection?.()
    if (selection && String(selection).trim() !== '') {
      e.preventDefault()
      return
    }
    const isModified = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0
    if (isModified) {
      return
    }
    e.preventDefault()
    onSelectStudio?.(item)
  }

  const handleOpenJavDB = (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (!canOpenJavDB) return
    openJavDBWithAssist(javDBSearchURL, {
      target: 'studio',
      code: sampleCode,
      name: searchName,
    })
  }

  const handleOpenFavorites = (event) => {
    event.preventDefault()
    event.stopPropagation()
    onOpenFavorites?.(item)
  }

  const handleOpenEditor = (event) => {
    event.preventDefault()
    event.stopPropagation()
    onOpenEditor?.(item)
  }

  const clearSeriesHoverTimer = () => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }

  const closeSeriesPreview = () => {
    activeSeriesHoverIdRef.current = null
    setPreviewSeries(null)
    setSeriesHoverAnchorEl(null)
  }

  const closeSeriesList = () => {
    setSeriesListOpen(false)
  }

  const scheduleSeriesPreviewClose = () => {
    clearSeriesHoverTimer()
    closeTimerRef.current = window.setTimeout(() => {
      closeSeriesPreview()
      closeTimerRef.current = null
    }, 120)
  }

  const handleSeriesHoverStart = (series, event) => {
    clearSeriesHoverTimer()
    const seriesId = Number(series?.id)
    if (!Number.isFinite(seriesId) || seriesId <= 0) return
    activeSeriesHoverIdRef.current = seriesId
    setPreviewSeries(series)
    setSeriesHoverAnchorEl(event.currentTarget)

    const cacheKey = `${seriesId}|${directoryVisibilityKey}`
    const cached = seriesPreviewCacheRef.current.get(cacheKey)
    if (cached) {
      setPreviewSeries(cached)
      return
    }
    fetchJavSeriesPreview(seriesId)
      .then((loadedSeries) => {
        seriesPreviewCacheRef.current.set(cacheKey, loadedSeries)
        if (activeSeriesHoverIdRef.current === Number(loadedSeries?.id)) {
          setPreviewSeries(loadedSeries)
        }
      })
      .catch((error) => {
        console.warn('load studio series preview failed', error)
      })
  }

  const handleSeriesClick = (series, event) => {
    event.preventDefault()
    event.stopPropagation()
    onSelectSeries?.(series)
  }

  const handlePrefixClick = (prefixItem, event) => {
    event.preventDefault()
    event.stopPropagation()
    const prefix = String(prefixItem?.prefix || '').trim()
    if (!prefix) return
    onSelectPrefix?.({
      prefix,
      work_count: prefixItem?.work_count || 0,
      include_studio_filter: true,
      studio_id: Number.isFinite(studioId) && studioId > 0 ? studioId : null,
      studio_name: name,
    })
  }

  const openSeriesList = (event) => {
    event.preventDefault()
    event.stopPropagation()
    setSeriesListOpen(true)
  }

  useEffect(() => {
    if (seriesListOpen) {
      hasReportedSeriesListOpenRef.current = true
      onSeriesListOpenChange?.(true)
      return () => {
        hasReportedSeriesListOpenRef.current = false
        onSeriesListOpenChange?.(false)
      }
    }
    if (hasReportedSeriesListOpenRef.current) onSeriesListOpenChange?.(false)
    return undefined
  }, [onSeriesListOpenChange, seriesListOpen])

  useEffect(() => {
    if (!seriesListOpen) return undefined
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') closeSeriesList()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [seriesListOpen])

  useLayoutEffect(() => {
    const el = seriesListRef.current
    const measureEl = seriesMeasureRef.current
    if (!el || !measureEl) {
      setVisibleSeriesCount(null)
      setForcedFirstRowSeries(null)
      return undefined
    }
    const updateVisibleCount = () => {
      const countChip = measureEl.querySelector('[data-series-count-chip="true"]')
      const chips = Array.from(measureEl.querySelectorAll('[data-series-measure-chip="true"]'))
      const moreButton = measureEl.querySelector('[data-series-more-button="true"]')
      const containerWidth = el.getBoundingClientRect().width
      if (!countChip || chips.length === 0 || !moreButton || containerWidth <= 0) {
        setVisibleSeriesCount(0)
        setForcedFirstRowSeries(null)
        return
      }

      const styles = window.getComputedStyle(measureEl)
      const gap = Number.parseFloat(styles.columnGap || styles.gap || '0') || 0
      const countWidth = countChip.getBoundingClientRect().width
      const chipWidths = chips.map((chip) => chip.getBoundingClientRect().width)
      const moreWidth = moreButton.getBoundingClientRect().width

      const measureRows = (reserveMoreButton) => {
        let row = 0
        let rowWidth = 0
        let visibleCount = 0
        let forcedSeries = null
        const itemWidths = [countWidth, ...chipWidths]

        for (let index = 0; index < itemWidths.length; index += 1) {
          const itemWidth = itemWidths[index]
          const rowLimit =
            row === 1 && reserveMoreButton
              ? Math.max(0, containerWidth - moreWidth - gap)
              : containerWidth
          const itemGap = rowWidth === 0 ? 0 : gap
          const nextWidth = rowWidth + itemGap + itemWidth
          if (nextWidth <= rowLimit || rowWidth === 0) {
            rowWidth = nextWidth <= rowLimit ? nextWidth : itemWidth
            if (index > 0) visibleCount += 1
            continue
          }

          if (row === 0 && index > 0) {
            const remainingWidth = rowLimit - rowWidth - gap
            if (remainingWidth >= 32) {
              forcedSeries = {
                index: index - 1,
                width: Math.max(0, remainingWidth - 0.5),
              }
              visibleCount += 1
              row = 1
              rowWidth = 0
              continue
            }
          }

          row += 1
          if (row > 1) break
          rowWidth = itemWidth
          if (index > 0) visibleCount += 1
        }

        return { visibleCount, forcedSeries }
      }

      const fullLayout = measureRows(false)
      if (fullLayout.visibleCount >= seriesItems.length) {
        setVisibleSeriesCount(seriesItems.length)
        setForcedFirstRowSeries(fullLayout.forcedSeries)
        return
      }

      const reservedLayout = measureRows(true)
      setVisibleSeriesCount(reservedLayout.visibleCount)
      setForcedFirstRowSeries(reservedLayout.forcedSeries)
    }
    updateVisibleCount()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateVisibleCount)
      return () => window.removeEventListener('resize', updateVisibleCount)
    }
    const observer = new ResizeObserver(updateVisibleCount)
    observer.observe(el)
    return () => observer.disconnect()
  }, [seriesItems])

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current)
      }
    }
  }, [])

  return (
    <a
      href={href || '#'}
      className="card-hover-scope group flex cursor-pointer flex-col overflow-hidden rounded-lg border bg-white shadow-sm transition hover:shadow-lg"
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === ' ') {
          e.preventDefault()
          onSelectStudio?.(item)
        }
      }}
    >
      <div className="relative aspect-[800/538] w-full overflow-hidden bg-gray-100">
        {cover ? (
          <img
            src={cover}
            alt={name}
            className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.03]"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex h-full w-full items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200 p-4 text-center text-lg font-semibold text-gray-600">
            {name}
          </div>
        )}
        {showWorkCount ? (
          <div className="absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-xs text-white">
            {zh(`作品 ${workCount}`, `${workCount} works`)}
          </div>
        ) : null}
        <button
          type="button"
          className={`card-hover-focus-visible absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full shadow-lg shadow-black/40 transition ${
            favoriteCount > 0
              ? 'bg-amber-400 text-amber-950 hover:bg-amber-300'
              : 'bg-black/65 text-white opacity-0 hover:bg-black/80 group-hover:opacity-100'
          }`}
          title={zh('加入片商收藏夹', 'Add to studio favorite groups')}
          aria-label={zh('加入片商收藏夹', 'Add to studio favorite groups')}
          onClick={handleOpenFavorites}
        >
          {favoriteCount > 0 ? (
            <StarRoundedIcon sx={{ fontSize: 18 }} />
          ) : (
            <StarBorderRoundedIcon sx={{ fontSize: 18 }} />
          )}
        </button>
        <button
          type="button"
          className={`card-hover-focus-visible absolute bottom-2 left-2 flex h-7 w-7 items-center justify-center rounded-full text-white opacity-0 shadow-lg shadow-black/60 transition-opacity group-hover:opacity-100 ${
            canOpenJavDB ? 'bg-black/70 hover:bg-black/85' : 'cursor-not-allowed bg-black/30'
          }`}
          title={zh('在 JavDB 中搜索片商', 'Search for studio in JavDB')}
          aria-label={zh('在 JavDB 中搜索片商', 'Search for studio in JavDB')}
          disabled={!canOpenJavDB}
          onClick={handleOpenJavDB}
        >
          <img src="/ico/javdb.png" alt="JavDB" className="h-4 w-4" loading="lazy" />
        </button>
        {onOpenEditor ? (
          <button
            type="button"
            className="card-hover-focus-visible absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white opacity-0 shadow-lg shadow-black/60 transition-opacity hover:bg-black/85 group-hover:opacity-100"
            title={zh('编辑片商信息', 'Edit studio info')}
            aria-label={zh('编辑片商信息', 'Edit studio info')}
            onClick={handleOpenEditor}
          >
            <EditRoundedIcon sx={{ fontSize: 16 }} />
          </button>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="flex min-w-0 items-baseline gap-1.5 leading-tight">
          <span
            className={`min-w-0 truncate text-sm font-semibold ${
              aliases.length > 0 ? 'max-w-[65%]' : 'flex-1'
            }`}
            title={name}
          >
            {name}
          </span>
          {aliases.length > 0 ? (
            <span
              className="min-w-0 flex-1 truncate text-[10px] text-gray-500"
              title={aliases.join(', ')}
            >
              {zh(aliases.join('、'), aliases.join(', '))}
            </span>
          ) : null}
        </div>
        {codePrefixes.length > 0 ? (
          <div
            className="mt-1 flex max-h-20 flex-wrap gap-0.5 overflow-y-auto"
            title={codePrefixes
              .map((prefixItem) => {
                const count = Number(prefixItem.work_count)
                return count > 0 ? `${prefixItem.prefix} (${count})` : prefixItem.prefix
              })
              .join(', ')}
          >
            <span className="rounded bg-gray-900 px-1 py-0.5 text-[9px] font-semibold leading-3 text-white">
              {zh(`${codePrefixes.length}个番号`, `${codePrefixes.length} codes`)}
            </span>
            {codePrefixes.map((prefixItem) => (
              <button
                type="button"
                key={prefixItem.prefix}
                className="rounded border border-gray-200 bg-gray-50 px-1 py-0.5 text-[9px] font-medium leading-3 text-gray-700 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                title={zh(
                  `查看 ${prefixItem.prefix} 的全部作品`,
                  `Show all ${prefixItem.prefix} works`
                )}
                onClick={(event) => handlePrefixClick(prefixItem, event)}
              >
                <span>{prefixItem.prefix}</span>
                {prefixItem.work_count ? (
                  <span className="ml-1 text-[8px] font-semibold leading-3 text-gray-500">
                    {prefixItem.work_count}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
        {seriesItems.length > 0 ? (
          <div className="relative mt-1">
            <div
              ref={seriesMeasureRef}
              aria-hidden="true"
              className="pointer-events-none invisible absolute left-0 top-0 -z-10 flex w-full flex-wrap gap-0.5 overflow-visible"
            >
              <span
                data-series-count-chip="true"
                className="rounded bg-emerald-700 px-1 py-0.5 text-[9px] font-semibold leading-3 text-white"
              >
                {zh(`${seriesItems.length}个系列`, `${seriesItems.length} series`)}
              </span>
              {seriesItems.map((series) => {
                const seriesName = String(series?.name || '').trim()
                return (
                  <span
                    key={series.id}
                    data-series-measure-chip="true"
                    className="max-w-[5rem] truncate rounded border border-emerald-100 bg-emerald-50 px-1 py-0.5 text-[9px] font-medium leading-3 text-emerald-700"
                  >
                    {seriesName}
                  </span>
                )
              })}
              <span
                data-series-more-button="true"
                className="rounded border border-emerald-200 bg-white px-1 py-0.5 text-[9px] font-semibold leading-3 text-emerald-700 shadow-sm"
              >
                {zh('展开全部', 'All')}
              </span>
            </div>
            <div
              ref={seriesListRef}
              className="relative flex max-h-[2.625rem] flex-wrap gap-0.5 overflow-hidden"
            >
              <span className="rounded bg-emerald-700 px-1 py-0.5 text-[9px] font-semibold leading-3 text-white">
                {zh(`${seriesItems.length}个系列`, `${seriesItems.length} series`)}
              </span>
              {displayedSeriesItems.map((series, index) => {
                const seriesName = String(series?.name || '').trim()
                const forcedWidth =
                  forcedFirstRowSeries?.index === index ? forcedFirstRowSeries.width : null
                return (
                  <button
                    type="button"
                    key={series.id}
                    data-series-chip="true"
                    className="min-w-0 max-w-[5rem] truncate rounded border border-emerald-100 bg-emerald-50 px-1 py-0.5 text-[9px] font-medium leading-3 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100"
                    style={
                      forcedWidth == null
                        ? undefined
                        : { width: `${forcedWidth}px`, maxWidth: `${forcedWidth}px` }
                    }
                    title={seriesName}
                    onClick={(event) => handleSeriesClick(series, event)}
                    onMouseEnter={(event) => handleSeriesHoverStart(series, event)}
                    onMouseLeave={scheduleSeriesPreviewClose}
                    onFocus={(event) => handleSeriesHoverStart(series, event)}
                    onBlur={scheduleSeriesPreviewClose}
                  >
                    {seriesName}
                  </button>
                )
              })}
              {hasHiddenSeries ? (
                <button
                  type="button"
                  className="absolute bottom-0 right-0 rounded border border-emerald-200 bg-white px-1 py-0.5 text-[9px] font-semibold leading-3 text-emerald-700 shadow-sm hover:bg-emerald-50"
                  onClick={openSeriesList}
                >
                  {zh('展开全部', 'All')}
                </button>
              ) : null}
            </div>
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
                onMouseEnter={clearSeriesHoverTimer}
                onMouseLeave={scheduleSeriesPreviewClose}
              >
                {previewSeries ? (
                  <SeriesCard
                    item={previewSeries}
                    href={buildSeriesUrl?.(previewSeries)}
                    onSelectSeries={(series) => onSelectSeries?.(series)}
                    onSelectStudio={(studio) => onSelectStudio?.(studio)}
                    onOpenFavorites={onOpenSeriesFavorites}
                  />
                ) : null}
              </div>
            </Popper>
            {seriesListOpen ? (
              <AppModal
                ariaLabel={zh('片商系列', 'Studio series')}
                className="p-4"
                contentClassName="flex max-h-[84vh] w-[min(72rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl"
                contentProps={{ onClick: (event) => event.stopPropagation() }}
                onClose={(event) => {
                  event?.preventDefault()
                  event?.stopPropagation()
                  closeSeriesList()
                }}
                zIndex={seriesListModalZIndex}
              >
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-100 bg-white px-3 py-2">
                  <div className="text-xs font-semibold text-gray-700">
                    {zh(
                      `片商：${name}，共${seriesItems.length}个系列`,
                      `Studio: ${name}, ${seriesItems.length} series`
                    )}
                  </div>
                  <button
                    type="button"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                    aria-label={zh('关闭片商系列', 'Close studio series')}
                    title={zh('关闭', 'Close')}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      closeSeriesList()
                    }}
                  >
                    <CloseRoundedIcon sx={{ fontSize: 20 }} />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <div className="grid grid-cols-3 gap-3 p-3 md:grid-cols-4 xl:grid-cols-5">
                    {seriesItems.map((series) => {
                      return (
                        <SeriesCard
                          key={series.id}
                          item={series}
                          href={buildSeriesUrl?.(series)}
                          onSelectSeries={(selectedSeries) => {
                            closeSeriesList()
                            onSelectSeries?.(selectedSeries)
                          }}
                          onSelectStudio={(studio) => onSelectStudio?.(studio)}
                          onOpenFavorites={onOpenSeriesFavorites}
                        />
                      )
                    })}
                  </div>
                </div>
              </AppModal>
            ) : null}
          </div>
        ) : null}
      </div>
    </a>
  )
}

function JavStudioEditModal({ open, item, onClose, onSaved, onMerged }) {
  const [form, setForm] = useState(() => buildStudioEditForm(item))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [mergeOpen, setMergeOpen] = useState(false)
  const studioId = Number(item?.id)

  useEffect(() => {
    if (!open) return
    setForm(buildStudioEditForm(item))
    setSaving(false)
    setError('')
    setMergeOpen(false)
  }, [item, open])

  if (!open || !item) return null

  const setField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }))
  }
  const addAliases = (value) => {
    const incoming = studioAliasTextToList(value)
    if (!incoming.length) return
    setForm((current) => ({
      ...current,
      aliases: mergeStudioAliases(current.aliases, incoming),
      alias_input: '',
    }))
  }
  const removeAlias = (alias) => {
    setForm((current) => ({
      ...current,
      aliases: current.aliases.filter((value) => value !== alias),
    }))
  }
  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!Number.isFinite(studioId) || studioId <= 0 || saving) return
    setSaving(true)
    setError('')
    try {
      const updated = await updateJavStudio(studioId, {
        name: String(form.name || '').trim(),
        aliases: mergeStudioAliases(form.aliases, studioAliasTextToList(form.alias_input)),
      })
      onSaved?.({
        ...updated,
        aliases: Array.isArray(updated?.aliases) ? updated.aliases : [],
      })
      onClose?.()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <AppModal
        ariaLabel={zh('编辑片商信息', 'Edit studio info')}
        className="p-4"
        closeDisabled={saving}
        contentClassName="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
        contentComponent="form"
        contentProps={{ onSubmit: handleSubmit }}
        onClose={onClose}
        zIndex={1600}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="min-w-0">
            <div className="text-base font-semibold text-gray-950">
              {zh('编辑片商信息', 'Edit studio info')}
            </div>
            <div className="truncate text-xs text-gray-500">{item.name}</div>
          </div>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-900"
            aria-label={zh('关闭', 'Close')}
            onClick={onClose}
          >
            <CloseRoundedIcon sx={{ fontSize: 20 }} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            <span>{zh('名称', 'Name')}</span>
            <input
              value={form.name}
              required
              onChange={(event) => setField('name', event.target.value)}
              className="rounded border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900"
            />
          </label>
          <StudioAliasEditor
            aliases={form.aliases}
            inputValue={form.alias_input}
            onInputChange={(value) => setField('alias_input', value)}
            onAdd={addAliases}
            onRemove={removeAlias}
          />
          <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
            <button
              type="button"
              className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              onClick={() => setMergeOpen(true)}
            >
              {zh('合并到其它片商', 'Merge into another studio')}
            </button>
          </div>
          {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
        </div>
        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <button
            type="button"
            className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            onClick={onClose}
            disabled={saving}
          >
            {zh('取消', 'Cancel')}
          </button>
          <button
            type="submit"
            className="rounded bg-gray-950 px-3 py-1.5 text-sm text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
            disabled={saving || !String(form.name || '').trim()}
          >
            {saving ? zh('保存中…', 'Saving...') : zh('保存', 'Save')}
          </button>
        </div>
      </AppModal>
      <JavStudioMergeModal
        open={mergeOpen}
        item={item}
        onClose={() => setMergeOpen(false)}
        onMerged={onMerged}
      />
    </>
  )
}

function StudioAliasEditor({ aliases = [], inputValue = '', onInputChange, onAdd, onRemove }) {
  const commitInput = () => {
    if (String(inputValue || '').trim()) onAdd?.(inputValue)
  }
  return (
    <div className="mt-3 flex flex-col gap-1 text-sm font-medium text-gray-700">
      <div className="flex flex-wrap items-center gap-2">
        <span>{zh('别名：', 'Aliases:')}</span>
        <span className="text-xs font-normal text-gray-400">
          {zh('输入后按 Enter 添加', 'Press Enter to add')}
        </span>
      </div>
      <div className="flex min-h-[2.75rem] flex-wrap items-center gap-2 rounded border border-gray-300 bg-white px-2 py-2 focus-within:border-gray-900">
        {aliases.map((alias) => (
          <span
            key={alias}
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-gray-200 bg-gray-100 px-2 py-1 text-xs font-medium text-gray-800"
          >
            <span className="max-w-[12rem] truncate">{alias}</span>
            <button
              type="button"
              className="flex h-4 w-4 items-center justify-center rounded-full text-gray-500 hover:bg-gray-300 hover:text-gray-900"
              aria-label={zh(`移除别名 ${alias}`, `Remove alias ${alias}`)}
              onClick={() => onRemove?.(alias)}
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={inputValue}
          onChange={(event) => {
            const value = event.target.value
            if (/[,\n]/.test(value)) {
              onAdd?.(value)
              return
            }
            onInputChange?.(value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitInput()
            } else if (event.key === 'Backspace' && !inputValue && aliases.length > 0) {
              event.preventDefault()
              onRemove?.(aliases[aliases.length - 1])
            }
          }}
          onBlur={commitInput}
          className="min-w-[9rem] flex-1 border-0 bg-transparent px-1 py-1 text-sm outline-none"
        />
      </div>
    </div>
  )
}

function JavStudioMergeModal({ open, item, onClose, onMerged }) {
  const [search, setSearch] = useState('')
  const [options, setOptions] = useState([])
  const [selectedId, setSelectedId] = useState(0)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const sourceId = Number(item?.id)
  const sourceName = String(item?.name || '').trim() || zh('未知片商', 'Unknown studio')

  useEffect(() => {
    if (!open) {
      setSearch('')
      setOptions([])
      setSelectedId(0)
      setError('')
      setSaving(false)
    }
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError('')
      fetchJavStudioOptions({ limit: 30, search })
        .then((response) => {
          if (cancelled) return
          const items = Array.isArray(response?.items) ? response.items : []
          setOptions(items.filter((option) => Number(option?.id) !== sourceId))
        })
        .catch((err) => {
          if (!cancelled) setError(getErrorMessage(err))
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, search, sourceId])

  if (!open || !item) return null

  const selected = options.find((option) => Number(option?.id) === selectedId)
  const selectedName = String(selected?.name || '').trim()
  const canSubmit =
    Number.isFinite(sourceId) && sourceId > 0 && Number.isFinite(selectedId) && selectedId > 0
  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!canSubmit || saving) return
    setSaving(true)
    setError('')
    try {
      const updated = await mergeJavStudios({
        canonicalId: selectedId,
        mergeIds: [sourceId],
      })
      onMerged?.(updated)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppModal
      ariaLabel={zh('合并片商', 'Merge studio')}
      className="p-4"
      closeDisabled={saving}
      contentClassName="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
      contentComponent="form"
      contentProps={{ onSubmit: handleSubmit }}
      onClose={onClose}
      zIndex={1700}
    >
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="min-w-0">
          <div className="text-base font-semibold text-gray-950">
            {zh('合并片商', 'Merge studio')}
          </div>
          <div className="truncate text-xs text-gray-500">
            {zh(`将 ${sourceName} 合并到目标片商`, `Merge ${sourceName} into target studio`)}
          </div>
        </div>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          aria-label={zh('关闭', 'Close')}
          onClick={onClose}
        >
          <CloseRoundedIcon sx={{ fontSize: 20 }} />
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-hidden p-4">
        <label className="relative block">
          <SearchRoundedIcon
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            sx={{ fontSize: 18 }}
          />
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setSelectedId(0)
            }}
            className="w-full rounded border border-gray-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-gray-900"
            placeholder={zh('搜索要合并到的目标片商', 'Search target studio to merge into')}
          />
        </label>
        <div className="min-h-[12rem] overflow-y-auto rounded border border-gray-200">
          {loading ? (
            <div className="flex h-32 items-center justify-center text-sm text-gray-500">
              {zh('加载中…', 'Loading...')}
            </div>
          ) : options.length > 0 ? (
            <div className="divide-y divide-gray-100">
              {options.map((option) => {
                const id = Number(option?.id)
                const aliases = Array.isArray(option?.aliases) ? option.aliases.join(', ') : ''
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={`flex w-full flex-col gap-1 px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                      id === selectedId ? 'bg-gray-100 text-gray-950' : 'text-gray-800'
                    }`}
                    onClick={() => setSelectedId(id)}
                  >
                    <span className="truncate font-medium">{option.name}</span>
                    {aliases ? (
                      <span className="truncate text-xs text-gray-500">
                        {zh(`别名：${aliases}`, `Aliases: ${aliases}`)}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="flex h-32 items-center justify-center text-sm text-gray-500">
              {zh('没有可合并的目标片商', 'No target studio found')}
            </div>
          )}
        </div>
        {selected ? (
          <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {zh(
              `"${sourceName}" 将作为 "${selectedName}" 的别名存在，当前片商记录会被删除，作品、系列及收藏夹数据会自动迁移。此操作无法撤回，请仔细核实后操作。`,
              `"${sourceName}" will exist as an alias of "${selectedName}". The current studio record will be deleted, and its works, series, and favorites will be migrated automatically. This action cannot be undone; verify carefully before continuing.`
            )}
          </div>
        ) : null}
        {error ? <div className="text-sm text-red-600">{error}</div> : null}
      </div>
      <div className="flex justify-end gap-2 border-t px-4 py-3">
        <button
          type="button"
          className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          onClick={onClose}
          disabled={saving}
        >
          {zh('取消', 'Cancel')}
        </button>
        <button
          type="submit"
          className="rounded bg-gray-950 px-3 py-1.5 text-sm text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
          disabled={!canSubmit || saving}
        >
          {saving ? zh('合并中…', 'Merging...') : zh('确认合并', 'Merge')}
        </button>
      </div>
    </AppModal>
  )
}

function buildStudioEditForm(item) {
  return {
    name: String(item?.name || ''),
    aliases: mergeStudioAliases([], Array.isArray(item?.aliases) ? item.aliases : []),
    alias_input: '',
  }
}

function studioAliasTextToList(value) {
  return String(value || '')
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function mergeStudioAliases(current = [], incoming = []) {
  const seen = new Set()
  const aliases = []
  for (const value of [...current, ...incoming]) {
    const alias = String(value || '').trim()
    if (!alias || seen.has(alias)) continue
    seen.add(alias)
    aliases.push(alias)
  }
  return aliases
}
