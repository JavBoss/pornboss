import JavIdolView from '@/components/JavIdolView'
import JavSeriesView from '@/components/JavSeriesView'
import JavStudioView from '@/components/JavStudioView'
import JavView from '@/components/JavView'

function JavIdolRoute({
  buildJavUrl,
  config,
  hasMore,
  hasNext,
  hasPrev,
  idolGlobalSort,
  idolTempSort,
  items,
  lastPage,
  loading,
  loadingMore,
  onFirst,
  onGoToPage,
  onLast,
  onLoadMore,
  onNext,
  onOpenFavorites,
  onMerged,
  onPrev,
  onSelectIdol,
  onWaterfallModeChange,
  page,
  setIdolTempSort,
  totalItems,
  waterfallMode,
}) {
  return (
    <JavIdolView
      page={page}
      lastPage={lastPage}
      totalItems={totalItems}
      hasPrev={hasPrev}
      hasNext={hasNext}
      loading={loading}
      idolTempSort={idolTempSort}
      idolGlobalSort={idolGlobalSort}
      setIdolTempSort={setIdolTempSort}
      buildPageUrl={({ page: targetPage }) => buildJavUrl({ page: targetPage, tab: 'idol' })}
      buildIdolUrl={(idol) =>
        buildJavUrl({
          page: 1,
          search: '',
          tab: 'list',
          idolIds: [idol.id],
          tagIds: [],
          prefix: '',
          favoriteRatingEnabled: false,
          tempSort: '',
        })
      }
      onFirst={onFirst}
      onPrev={onPrev}
      onGoToPage={onGoToPage}
      onNext={onNext}
      onLast={onLast}
      items={items}
      preferChineseName={configFlag(config?.jav_idol_prefer_chinese_name)}
      onSelectIdol={onSelectIdol}
      onOpenFavorites={onOpenFavorites}
      onMerged={onMerged}
      waterfallMode={waterfallMode}
      onWaterfallModeChange={onWaterfallModeChange}
      onLoadMore={onLoadMore}
      loadingMore={loadingMore}
      hasMore={hasMore}
    />
  )
}

function JavStudioRoute({
  buildJavUrl,
  hasMore,
  hasNext,
  hasPrev,
  items,
  lastPage,
  loading,
  loadingMore,
  onFirst,
  onGoToPage,
  onLast,
  onLoadMore,
  onMerged,
  onNext,
  onOpenFavorites,
  onOpenSeriesFavorites,
  onSelectPrefix,
  onPrev,
  onSelectSeries,
  onSelectStudio,
  onWaterfallModeChange,
  page,
  totalItems,
  waterfallMode,
}) {
  return (
    <JavStudioView
      page={page}
      lastPage={lastPage}
      totalItems={totalItems}
      hasPrev={hasPrev}
      hasNext={hasNext}
      loading={loading}
      buildPageUrl={({ page: targetPage }) => buildJavUrl({ page: targetPage, tab: 'studio' })}
      buildStudioUrl={(studio) =>
        buildJavUrl({
          page: 1,
          search: '',
          tab: 'list',
          idolIds: [],
          tagIds: [],
          studioId: studio.id,
          studioName: studio.name,
          prefix: '',
          favoriteRatingEnabled: false,
          tempSort: '',
        })
      }
      buildSeriesUrl={(series) =>
        buildJavUrl({
          page: 1,
          search: '',
          tab: 'list',
          idolIds: [],
          tagIds: [],
          studioId: null,
          seriesId: series.id,
          seriesName: series.name,
          prefix: '',
          favoriteRatingEnabled: false,
          tempSort: '',
        })
      }
      onFirst={onFirst}
      onPrev={onPrev}
      onGoToPage={onGoToPage}
      onNext={onNext}
      onLast={onLast}
      items={items}
      onSelectStudio={onSelectStudio}
      onSelectSeries={onSelectSeries}
      onSelectPrefix={onSelectPrefix}
      onOpenFavorites={onOpenFavorites}
      onOpenSeriesFavorites={onOpenSeriesFavorites}
      waterfallMode={waterfallMode}
      onWaterfallModeChange={onWaterfallModeChange}
      onLoadMore={onLoadMore}
      loadingMore={loadingMore}
      hasMore={hasMore}
      onMerged={onMerged}
    />
  )
}

function JavSeriesRoute({
  buildJavUrl,
  hasMore,
  hasNext,
  hasPrev,
  items,
  lastPage,
  loading,
  loadingMore,
  onFirst,
  onGoToPage,
  onLast,
  onLoadMore,
  onNext,
  onOpenFavorites,
  onPrev,
  onSelectSeries,
  onSelectStudio,
  onWaterfallModeChange,
  page,
  totalItems,
  waterfallMode,
}) {
  return (
    <JavSeriesView
      page={page}
      lastPage={lastPage}
      totalItems={totalItems}
      hasPrev={hasPrev}
      hasNext={hasNext}
      loading={loading}
      buildPageUrl={({ page: targetPage }) => buildJavUrl({ page: targetPage, tab: 'series' })}
      buildSeriesUrl={(series) =>
        buildJavUrl({
          page: 1,
          search: '',
          tab: 'list',
          idolIds: [],
          tagIds: [],
          studioId: null,
          seriesId: series.id,
          seriesName: series.name,
          prefix: '',
          favoriteRatingEnabled: false,
          tempSort: '',
        })
      }
      onFirst={onFirst}
      onPrev={onPrev}
      onGoToPage={onGoToPage}
      onNext={onNext}
      onLast={onLast}
      items={items}
      onSelectSeries={onSelectSeries}
      onSelectStudio={onSelectStudio}
      onOpenFavorites={onOpenFavorites}
      waterfallMode={waterfallMode}
      onWaterfallModeChange={onWaterfallModeChange}
      onLoadMore={onLoadMore}
      loadingMore={loadingMore}
      hasMore={hasMore}
    />
  )
}

function JavListRoute({
  activeJavLoading,
  alternatePlayerLabel,
  buildJavUrl,
  hasMore,
  javResolvedSort,
  javSortSource,
  javGridColumns,
  javHasNext,
  javHasPrev,
  javIdolTagMaxRows,
  javItems,
  selectedJavIds,
  onToggleSelect,
  onSelectAll,
  onSelectPage,
  onPlayPage,
  onPlayAll,
  bulkActionBusy,
  mpvEnabled,
  javLastPage,
  javPage,
  javRandomMode,
  javTagMaxRows,
  javTitleMaxRows,
  javTotal,
  loadingMore,
  onIdolClick,
  onLoadMore,
  onOpenFavorites,
  onOpenJavFavorites,
  onOpenStudioFavorites,
  onOpenSeriesFavorites,
  onOpenFile,
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
  onPlay,
  onPrefixClick,
  onRevealFile,
  onSeriesClick,
  onStudioClick,
  onTagClick,
  onWaterfallModeChange,
  setJavPage,
  setJavTempSort,
  waterfallMode,
}) {
  return (
    <JavView
      javPage={javPage}
      javLastPage={javLastPage}
      javTotal={javTotal}
      javHasPrev={javHasPrev}
      javHasNext={javHasNext}
      javLoading={activeJavLoading}
      javRandomMode={javRandomMode}
      javResolvedSort={javResolvedSort}
      javSortSource={javSortSource}
      buildJavUrl={buildJavUrl}
      setJavPage={setJavPage}
      setJavTempSort={setJavTempSort}
      javItems={javItems}
      selectedJavIds={selectedJavIds}
      onToggleSelect={onToggleSelect}
      onSelectAll={onSelectAll}
      onSelectPage={onSelectPage}
      onPlayPage={onPlayPage}
      onPlayAll={onPlayAll}
      bulkActionBusy={bulkActionBusy}
      mpvEnabled={mpvEnabled}
      javGridColumns={javGridColumns}
      javTitleMaxRows={javTitleMaxRows}
      javIdolTagMaxRows={javIdolTagMaxRows}
      javTagMaxRows={javTagMaxRows}
      onPlay={onPlay}
      onOpenFile={onOpenFile}
      openFileLabel={alternatePlayerLabel}
      onRevealFile={onRevealFile}
      onOpenScreenshots={onOpenScreenshots}
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
      onIdolClick={onIdolClick}
      onOpenFavorites={onOpenFavorites}
      onOpenJavFavorites={onOpenJavFavorites}
      onOpenStudioFavorites={onOpenStudioFavorites}
      onOpenSeriesFavorites={onOpenSeriesFavorites}
      onPrefixClick={onPrefixClick}
      onStudioClick={onStudioClick}
      onSeriesClick={onSeriesClick}
      onTagClick={onTagClick}
      waterfallMode={waterfallMode}
      onWaterfallModeChange={onWaterfallModeChange}
      onLoadMore={onLoadMore}
      loadingMore={loadingMore}
      hasMore={hasMore}
    />
  )
}

export default function JavRoute({ tab, ...props }) {
  if (tab === 'idol') return <JavIdolRoute {...props.idol} buildJavUrl={props.buildJavUrl} />
  if (tab === 'studio') return <JavStudioRoute {...props.studio} buildJavUrl={props.buildJavUrl} />
  if (tab === 'series') {
    return (
      <JavSeriesRoute
        {...props.series}
        buildJavUrl={props.buildJavUrl}
        onSelectStudio={props.onSelectStudio}
      />
    )
  }
  return <JavListRoute {...props.list} buildJavUrl={props.buildJavUrl} />
}

function configFlag(value, fallback = false) {
  if (value == null || value === '') return fallback
  return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase())
}
