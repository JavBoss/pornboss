import SwapVertIcon from '@mui/icons-material/SwapVert'
import { Popover } from '@mui/material'
import { useState } from 'react'
import BulkActionsMenu from '@/components/BulkActionsMenu'
import Pagination from '@/components/Pagination'
import VideoGrid from '@/components/VideoGrid'
import WaterfallLoader from '@/components/WaterfallLoader'
import {
  VIDEO_SORT_OPTIONS,
  findVideoSortOption,
  reverseVideoSortValue,
  videoSortLabelParts,
} from '@/constants/video'
import { videoSelectionKey } from '@/store'
import { zh } from '@/utils/i18n'

function SortText({ option, value, className = '' }) {
  const parts = videoSortLabelParts(option, value, zh)

  return (
    <span className={`truncate font-semibold ${className}`}>
      <span>{parts.label}</span>
      <span className="font-normal text-gray-500">{parts.separator}</span>
      <span className="font-normal text-gray-500">{parts.direction}</span>
    </span>
  )
}

export default function VideoView({
  page,
  lastPage,
  totalItems,
  canPrev,
  canNext,
  loading,
  randomMode,
  videoTempSort,
  videoGlobalSort,
  buildVideoUrl,
  setPage,
  setVideoTempSort,
  goToLastPage,
  videos,
  selectedVideoIds,
  toggleSelectVideo,
  onSelectAll,
  onSelectPage,
  onPlayPage,
  onPlayAll,
  bulkActionBusy,
  mpvEnabled,
  openPlayer,
  openAlternatePlayer,
  revealFile,
  alternatePlayerLabel,
  setTagPickerFor,
  onOpenScreenshots,
  onOpenScrapeSettings,
  onRenameVideo,
  onDeleteVideo,
  onTagClick,
  waterfallMode,
  onWaterfallModeChange,
  onLoadMore,
  loadingMore,
  hasMore,
}) {
  const [sortAnchorEl, setSortAnchorEl] = useState(null)
  const pageIds = videos.map((video) => videoSelectionKey(video)).filter(Boolean)
  const pageSelectable = pageIds.length > 0
  const hasVideos = Number(totalItems) > 0
  const effectiveSort = videoTempSort || videoGlobalSort
  const currentOption = findVideoSortOption(effectiveSort) || VIDEO_SORT_OPTIONS[0]
  const activeWaterfallMode = waterfallMode && !randomMode
  const paginationPage = randomMode ? 1 : page
  const paginationLastPage = randomMode ? 1 : lastPage
  const paginationTotalItems = randomMode ? videos.length : totalItems
  const paginationCanPrev = randomMode ? false : canPrev
  const paginationCanNext = randomMode ? false : canNext

  const isOptionActive = (option) => {
    return findVideoSortOption(effectiveSort)?.base === option.base
  }

  const openSortMenu = (event) => {
    setSortAnchorEl(event.currentTarget)
  }

  const closeSortMenu = () => {
    setSortAnchorEl(null)
  }

  const bulkActionMenu = (
    <BulkActionsMenu
      label={zh('视频批量操作', 'Video bulk actions')}
      hasItems={hasVideos}
      pageSelectable={pageSelectable}
      busy={bulkActionBusy}
      mpvEnabled={mpvEnabled}
      onSelectAll={onSelectAll}
      onSelectPage={onSelectPage}
      onPlayPage={onPlayPage}
      onPlayAll={onPlayAll}
    />
  )

  return (
    <>
      <div className="sticky-pagination mb-4">
        <div className="pagination-toolbar-grid relative grid md:grid-cols-[1fr_auto_1fr] md:items-center">
          <div />
          <div className="flex justify-center">
            <Pagination
              page={paginationPage}
              lastPage={paginationLastPage}
              totalItems={paginationTotalItems}
              hasPrev={paginationCanPrev}
              hasNext={paginationCanNext}
              loading={loading}
              buildPageUrl={({ page: targetPage }) =>
                buildVideoUrl({ page: targetPage, random: false })
              }
              onFirst={() => setPage(1)}
              onPrev={() => {
                if (canPrev) setPage(page - 1)
              }}
              onGoToPage={(p) => setPage(p)}
              onNext={() => {
                if (canNext) setPage(page + 1)
              }}
              onLast={() => {
                goToLastPage()
              }}
              waterfallMode={activeWaterfallMode}
              onWaterfallModeChange={onWaterfallModeChange}
              totalItemsAction={bulkActionMenu}
            />
          </div>
          <div className="flex justify-end">
            {!randomMode && (
              <div className="pagination-sort-group flex items-center">
                <span className="pagination-sort-label text-gray-500">{zh('排序', 'Sort')}</span>
                <button
                  type="button"
                  onClick={openSortMenu}
                  aria-haspopup="dialog"
                  aria-expanded={Boolean(sortAnchorEl)}
                  aria-label={zh('修改当前视频排序方式', 'Change current video sort')}
                  className="pagination-sort-button"
                >
                  <SortText option={currentOption} value={effectiveSort} />
                  <span aria-hidden="true" className="pagination-sort-caret" />
                </button>
              </div>
            )}
            <Popover
              open={Boolean(sortAnchorEl)}
              anchorEl={sortAnchorEl}
              onClose={closeSortMenu}
              disableScrollLock
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
              <div className="pagination-sort-menu">
                {VIDEO_SORT_OPTIONS.map((option) => {
                  const active = isOptionActive(option)
                  const displayValue = active ? effectiveSort : option.defaultValue
                  return (
                    <div
                      key={option.base}
                      className={`pagination-sort-row ${
                        active ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          closeSortMenu()
                          setVideoTempSort?.(displayValue)
                        }}
                        className="pagination-sort-option"
                      >
                        <SortText option={option} value={displayValue} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          closeSortMenu()
                          setVideoTempSort?.(
                            reverseVideoSortValue(displayValue, option.defaultValue)
                          )
                        }}
                        className="pagination-sort-reverse"
                        title={zh('反转排序', 'Reverse sort')}
                        aria-label={zh(
                          `反转${option.label[0]}排序`,
                          `Reverse ${option.label[1]} sort`
                        )}
                      >
                        <SwapVertIcon fontSize="inherit" />
                      </button>
                    </div>
                  )
                })}
              </div>
            </Popover>
          </div>
        </div>
      </div>
      {loading ? (
        <div className="mt-4 flex min-h-[200px] items-center justify-center rounded border border-dashed border-gray-200 text-gray-500">
          {zh('加载中…', 'Loading...')}
        </div>
      ) : (
        <VideoGrid
          videos={videos}
          selectedIds={selectedVideoIds}
          onToggleSelect={toggleSelectVideo}
          onPlay={(video) => openPlayer(video)}
          onOpenFile={(video) => openAlternatePlayer?.(video)}
          onRevealFile={(video) => revealFile?.(video)}
          openFileLabel={alternatePlayerLabel}
          onOpenTagPicker={(vid) => setTagPickerFor(vid)}
          onOpenScreenshots={onOpenScreenshots}
          onOpenScrapeSettings={onOpenScrapeSettings}
          onRenameVideo={onRenameVideo}
          onDeleteVideo={onDeleteVideo}
          onTagClick={onTagClick}
        />
      )}
      <WaterfallLoader
        enabled={activeWaterfallMode && !loading}
        hasMore={hasMore}
        loading={loadingMore}
        onLoadMore={onLoadMore}
      />
    </>
  )
}
