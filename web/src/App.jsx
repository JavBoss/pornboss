import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { generateRandomSeed, normalizeUrlStateFromStore } from '@/utils/urlState'
import {
  addTagToVideos,
  removeTagFromVideos,
  replaceTagsForVideos,
  renameVideoLocation,
  deleteVideoLocation,
  updateConfig,
  playVideoFile,
  playVideoPlaylist,
  openVideoFile,
  revealVideoLocation,
  updateVideoJavScrapeSettings,
  fetchVideoJavScrapePossibleCodes,
  manualVideoJavScrape,
  linkVideoToExistingJav,
  fetchTagCategories,
  createTagCategory,
  reorderTagCategories,
  renameTagCategory,
  deleteTagCategory,
  assignTagsCategory,
  createJavTag,
  organizeJavTags,
  fetchJavTagCategories,
  createJavTagCategory,
  reorderJavTagCategories,
  renameJavTagCategory,
  deleteJavTagCategory,
  assignJavTagsCategory,
  addJavTagToJavs,
  renameJavTag,
  deleteJavTag,
  resolveJavIdols,
  createJavFavoriteGroup,
  deleteJavFavoriteGroup,
  fetchJavFavoriteGroupItems,
  fetchJavFavoriteSelection,
  renameJavFavoriteGroup,
  removeJavFavoriteGroupItems,
  reorderJavFavoriteGroupItems,
  reorderJavFavoriteGroups,
  replaceJavFavoriteGroups,
  processDirectory,
  scanDirectory,
  fetchVideos,
} from '@/api'
import GlobalSettingsModal from '@/components/GlobalSettingsModal'
import DownloadView from '@/components/DownloadView'
import JavFavoriteManageModal from '@/components/JavFavoriteManageModal'
import JavFavoriteModal from '@/components/JavFavoriteModal'
import JavQueryEditorModal from '@/components/JavQueryEditorModal'
import JavSettingsModal from '@/components/JavSettingsModal'
import JavTagModal from '@/components/JavTagModal'
import JavVideoPickerModal from '@/components/JavVideoPickerModal'
import SelectionOpsModal from '@/components/SelectionOpsModal'
import JavSelectionOpsModal from '@/components/JavSelectionOpsModal'
import JavSelectionTagsModal from '@/components/JavSelectionTagsModal'
import JavSelectionFavoritesModal from '@/components/JavSelectionFavoritesModal'
import SelectionJavTagsModal from '@/components/SelectionJavTagsModal'
import SelectionTagsModal from '@/components/SelectionTagsModal'
import TagPickerModal from '@/components/TagPickerModal'
import Toast from '@/components/Toast'
import CenterToast from '@/components/CenterToast'
import SideTabs from '@/components/SideTabs'
import TopBar from '@/components/TopBar'
import PlayerModal from '@/components/PlayerModal'
import VideoSettingsModal from '@/components/VideoSettingsModal'
import VideoScrapeSettingsModal from '@/components/VideoScrapeSettingsModal'
import VideoScreenshotsModal from '@/components/VideoScreenshotsModal'
import VideoTagModal from '@/components/VideoTagModal'
import {
  createDefaultIdolProfileFilters,
  IDOL_FAVORITE_ORDER_SORT,
  IDOL_PROFILE_FILTER_DEFINITIONS,
  javSortRulesConfig,
  normalizeIdolProfileFilters,
  normalizeIdolSort,
  normalizeJavSort,
  normalizeJavSortRules,
  resolveJavSort,
  isUserJavTag,
} from '@/constants/jav'
import { normalizeVideoSort } from '@/constants/video'
import useScrollRestoration from '@/hooks/useScrollRestoration'
import useJavSelection from '@/hooks/useJavSelection'
import useUrlStateSync from '@/hooks/useUrlStateSync'
import JavRoute from '@/routes/JavRoute'
import VideoRoute from '@/routes/VideoRoute'
import { zh } from '@/utils/i18n'
import { getErrorMessage } from '@/utils/errors'
import { buildVideoFullPath } from '@/utils/display'
import { getIdolDisplayName } from '@/utils/javIdol'
import { withJavTagDisplayName } from '@/utils/javTag'
import {
  isWebHotkeyEditingTarget,
  parseWebHotkeys,
  webHotkeyFromKeyboardEvent,
  webHotkeyKeyId,
} from '@/utils/webHotkeys'
import { useStore, videoSelectionKey } from '@/store'
import { useAuth } from '@/auth'

const JAV_SCRAPE_OVERRIDE_SKIP = ':skip'
const JAV_SCRAPE_OVERRIDE_MANUAL_PREFIX = ':manual:'
const MPV_BULK_PLAY_CONFIRM_THRESHOLD = 500

const confirmLargeMPVPlaylist = (count) => {
  if (count <= MPV_BULK_PLAY_CONFIRM_THRESHOLD) return true
  return window.confirm(
    zh(
      `即将使用 MPV 播放 ${count} 个视频。视频数量较多，可能造成 MPV 加载卡顿，是否继续？`,
      `You are about to play ${count} videos with MPV. A large playlist may cause MPV to load slowly. Continue?`
    )
  )
}

const normalizeDefaultPlayer = (value) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  if (normalized === 'browser' || normalized === 'system') return normalized
  return 'mpv'
}

const configFlag = (value, fallback = false) => {
  if (value == null || value === '') return fallback
  return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase())
}

const normalizeInitialViewMode = (value) =>
  String(value || '')
    .trim()
    .toLowerCase() === 'jav'
    ? 'jav'
    : 'video'

function applyScrapeOverrideToVideo(video, override) {
  const nextOverride = String(override || '').trim()
  const next = { ...video, jav_scrape_override: nextOverride }
  if (!nextOverride) return next
  const effectiveOverride = nextOverride.toLowerCase().startsWith(JAV_SCRAPE_OVERRIDE_MANUAL_PREFIX)
    ? nextOverride.slice(JAV_SCRAPE_OVERRIDE_MANUAL_PREFIX.length).trim()
    : nextOverride
  const linkedCode = String(video?.jav?.code || video?.locations?.[0]?.jav?.code || '')
    .trim()
    .toUpperCase()
  if (nextOverride !== JAV_SCRAPE_OVERRIDE_SKIP && linkedCode === effectiveOverride.toUpperCase()) {
    return next
  }
  return {
    ...next,
    jav_id: null,
    jav: null,
    locations: Array.isArray(video?.locations)
      ? video.locations.map((location) => ({ ...location, jav_id: null, jav: null }))
      : video?.locations,
  }
}

export default function App() {
  const { changePassword, logout } = useAuth()
  const pendingVideoTagIdsRef = useRef(null)
  const {
    page,
    pageSize,
    setPage,
    videos,
    config,
    tags,
    selectedTags,
    selectedVideoIds,
    selectedVideoMeta,
    loadVideos,
    loadMoreVideos,
    loadTags,
    toggleTagFilter,
    createTag,
    deleteTag,
    renameTag,
    toggleSelectVideo,
    loading,
    videoLoadingMore,
    error,
    hasNext,
    total,
    setSelectedTags,
    clearSelection,
    searchTerm,
    setSearchTerm,
    sortOrder,
    videoTempSort,
    videoHideJav,
    setVideoTempSort,
    loadJavRandom,
    randomMode,
    randomSeed,
    viewMode,
    javTab,
    javPage,
    setJavPage,
    javPageSize,
    javGridColumns,
    javTitleMaxRows,
    javIdolTagMaxRows,
    javTagMaxRows,
    javSearchTerm,
    javIdolIds,
    javTags,
    javStudioId,
    javStudioName,
    javSeriesId,
    javSeriesName,
    javPrefix,
    javSoloOnly,
    javFavoriteRatingEnabled,
    javFavoriteRatingMin,
    javFavoriteRatingMax,
    javFavoriteGroupId,
    setJavFavoriteGroupId,
    javSort,
    javSortRules,
    javTempSort,
    javRandomMode,
    javRandomSeed,
    idolSort,
    setJavTempSort,
    idolTempSort,
    setIdolTempSort,
    loadJavs,
    loadMoreJavs,
    javItems,
    javTotal,
    javLoading,
    javLoadingMore,
    javError,
    javTagOptions,
    loadJavTags,
    loadConfig,
    idolPage,
    setIdolPage,
    idolPageSize,
    idolFavoriteGroupId,
    idolProfileFilters,
    setIdolFavoriteGroupId,
    idolItems,
    idolTotal,
    idolLoading,
    idolLoadingMore,
    idolError,
    loadJavIdols,
    loadMoreJavIdols,
    studioPage,
    setStudioPage,
    studioPageSize,
    studioFavoriteGroupId,
    setStudioFavoriteGroupId,
    studioItems,
    studioTotal,
    studioLoading,
    studioLoadingMore,
    studioError,
    loadJavStudios,
    loadMoreJavStudios,
    seriesPage,
    setSeriesPage,
    seriesPageSize,
    seriesFavoriteGroupId,
    setSeriesFavoriteGroupId,
    seriesItems,
    seriesTotal,
    seriesLoading,
    seriesLoadingMore,
    seriesError,
    loadJavSeries,
    loadMoreJavSeries,
    favoriteGroupsByType,
    favoriteGroupsLoadingByType,
    favoriteGroupsErrorByType,
    loadJavFavoriteGroups,
    directories,
    loadDirectories,
    createDirectory,
    updateDirectory,
    deleteDirectory,
  } = useStore()

  const [tagModalOpen, setTagModalOpen] = useState(false)
  const [tagModalApplyMode, setTagModalApplyMode] = useState('replace')
  const [tagCategories, setTagCategories] = useState([])
  const [videoSettingsOpen, setVideoSettingsOpen] = useState(false)
  const [javSettingsOpen, setJavSettingsOpen] = useState(false)
  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false)
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [javTagModalOpen, setJavTagModalOpen] = useState(false)
  const [javTagCategories, setJavTagCategories] = useState([])
  const [javQueryEditorOpen, setJavQueryEditorOpen] = useState(false)
  const [javVideoPickerOpen, setJavVideoPickerOpen] = useState(false)
  const [javVideoPickerItem, setJavVideoPickerItem] = useState(null)
  const [javVideoPickerAction, setJavVideoPickerAction] = useState('play')
  const [idolFavoriteModalOpen, setIdolFavoriteModalOpen] = useState(false)
  const [idolFavoriteModalItem, setIdolFavoriteModalItem] = useState(null)
  const [favoriteModalEntityType, setFavoriteModalEntityType] = useState('idol')
  const [idolFavoriteSelectedIds, setIdolFavoriteSelectedIds] = useState([])
  const [idolFavoriteModalLoading, setIdolFavoriteModalLoading] = useState(false)
  const [idolFavoriteModalSaving, setIdolFavoriteModalSaving] = useState(false)
  const [idolFavoriteModalError, setIdolFavoriteModalError] = useState('')
  const [idolFavoriteManageOpen, setIdolFavoriteManageOpen] = useState(false)
  const [idolFavoriteManageEditGroupId, setIdolFavoriteManageEditGroupId] = useState(null)
  const [favoriteManageEntityType, setFavoriteManageEntityType] = useState('idol')
  const [locationPickerOpen, setLocationPickerOpen] = useState(false)
  const [locationPickerVideo, setLocationPickerVideo] = useState(null)
  const [locationPickerChoices, setLocationPickerChoices] = useState([])
  const [locationPickerAction, setLocationPickerAction] = useState('play')
  const [playerVideo, setPlayerVideo] = useState(null)
  const [playerStartTime, setPlayerStartTime] = useState(0)
  const [screenshotsVideo, setScreenshotsVideo] = useState(null)
  const [screenshotsAllowSetCover, setScreenshotsAllowSetCover] = useState(true)
  const [scrapeSettingsVideo, setScrapeSettingsVideo] = useState(null)
  const [scrapeSettingsSaving, setScrapeSettingsSaving] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [javSearchInput, setJavSearchInput] = useState('')
  const [waterfallModes, setWaterfallModes] = useState({
    video: false,
    jav: false,
    idol: false,
    studio: false,
    series: false,
  })
  const [hydrated, setHydrated] = useState(false)
  const [configLoaded, setConfigLoaded] = useState(false)
  const isJavMode = viewMode === 'jav'

  useEffect(() => {
    if (javTab !== 'download') return
    setDownloadOpen(true)
    useStore.setState({ javTab: 'list' })
  }, [javTab])
  const selectedTagIds = useMemo(
    () =>
      tags
        .filter((t) => selectedTags.includes(t.name))
        .map((t) => t.id)
        .filter((id) => id > 0),
    [tags, selectedTags]
  )
  const tagsByName = useMemo(() => new Map(tags.map((t) => [t.name, t.id])), [tags])
  const directoryStateKey = useMemo(
    () =>
      directories
        .filter((directory) => !directory?.is_delete)
        .map((directory) => `${directory.id}:${directory.enabled !== false ? '1' : '0'}`)
        .join(','),
    [directories]
  )
  const [tagPickerFor, setTagPickerFor] = useState(null)
  const [tagPickerSelected, setTagPickerSelected] = useState([])
  const [selectionOpsOpen, setSelectionOpsOpen] = useState(false)
  const [selectionTagsOpen, setSelectionTagsOpen] = useState(false)
  const [selectionTagAction, setSelectionTagAction] = useState('add')
  const [selectionTagChoices, setSelectionTagChoices] = useState([])
  const [selectionJavTagsOpen, setSelectionJavTagsOpen] = useState(false)
  const [selectionJavTagChoices, setSelectionJavTagChoices] = useState([])
  const [selectionJavTagSaving, setSelectionJavTagSaving] = useState(false)
  const [selectionPlaying, setSelectionPlaying] = useState(false)
  const [selectionDeleting, setSelectionDeleting] = useState(false)
  const [videoBulkActionBusy, setVideoBulkActionBusy] = useState(false)
  const [videoPageSizeInput, setVideoPageSizeInput] = useState(pageSize)
  const [videoSortInput, setVideoSortInput] = useState(sortOrder)
  const [videoHideJavInput, setVideoHideJavInput] = useState(videoHideJav)
  const [videoWaterfallDefaultInput, setVideoWaterfallDefaultInput] = useState(
    configFlag(config?.video_waterfall_default)
  )
  const [javPageSizeInput, setJavPageSizeInput] = useState(javPageSize)
  const [javGridColumnsInput, setJavGridColumnsInput] = useState(javGridColumns)
  const [javTitleMaxRowsInput, setJavTitleMaxRowsInput] = useState(javTitleMaxRows)
  const [javIdolTagMaxRowsInput, setJavIdolTagMaxRowsInput] = useState(javIdolTagMaxRows)
  const [javTagMaxRowsInput, setJavTagMaxRowsInput] = useState(javTagMaxRows)
  const [javHideSeriesInput, setJavHideSeriesInput] = useState(configFlag(config?.jav_hide_series))
  const [javHideIdolsInput, setJavHideIdolsInput] = useState(configFlag(config?.jav_hide_idols))
  const [javHideTagsInput, setJavHideTagsInput] = useState(configFlag(config?.jav_hide_tags))
  const [javHideActionsInput, setJavHideActionsInput] = useState(
    configFlag(config?.jav_hide_actions)
  )
  const [javFavoriteRatingShowFullInput, setJavFavoriteRatingShowFullInput] = useState(
    configFlag(config?.jav_favorite_rating_show_full, false)
  )
  const [javWaterfallDefaultInput, setJavWaterfallDefaultInput] = useState(
    configFlag(config?.jav_waterfall_default)
  )
  const [idolPageSizeInput, setIdolPageSizeInput] = useState(idolPageSize)
  const [idolWaterfallDefaultInput, setIdolWaterfallDefaultInput] = useState(
    configFlag(config?.idol_waterfall_default)
  )
  const [studioPageSizeInput, setStudioPageSizeInput] = useState(studioPageSize)
  const [studioWaterfallDefaultInput, setStudioWaterfallDefaultInput] = useState(
    configFlag(config?.studio_waterfall_default)
  )
  const [seriesPageSizeInput, setSeriesPageSizeInput] = useState(seriesPageSize)
  const [seriesWaterfallDefaultInput, setSeriesWaterfallDefaultInput] = useState(
    configFlag(config?.series_waterfall_default)
  )
  const [javSortInput, setJavSortInput] = useState(javSort)
  const [javSortRulesInput, setJavSortRulesInput] = useState(javSortRules)
  const [idolSortInput, setIdolSortInput] = useState(idolSort)
  const [javIdolPreferChineseNameInput, setJavIdolPreferChineseNameInput] = useState(
    configFlag(config?.jav_idol_prefer_chinese_name)
  )
  const [javTagShowSimplifiedInput, setJavTagShowSimplifiedInput] = useState(
    configFlag(config?.jav_tag_show_simplified)
  )
  const [javResolvedIdols, setJavResolvedIdols] = useState({})
  const [toastMessage, setToastMessage] = useState('')
  const [centerToastMessage, setCenterToastMessage] = useState('')
  const javSortResolution = resolveJavSort({
    javSearchTerm,
    javIdolIds,
    javTags,
    javStudioId,
    javSeriesId,
    javPrefix,
    javSoloOnly,
    javFavoriteRatingEnabled,
    javFavoriteGroupId,
    javSort,
    javSortRules,
    javTempSort,
    javRandomMode,
  })

  useEffect(() => {
    const updateScrolledState = () => {
      document.body.classList.toggle('has-page-scroll', window.scrollY > 0)
    }

    updateScrolledState()
    window.addEventListener('scroll', updateScrolledState, { passive: true })
    return () => {
      window.removeEventListener('scroll', updateScrolledState)
      document.body.classList.remove('has-page-scroll')
    }
  }, [])

  const javVideoChoices = javVideoPickerItem?.videos || []
  const locationPickerItem = locationPickerVideo
    ? {
        code:
          locationPickerVideo.filename ||
          locationPickerVideo.path ||
          zh('选择文件位置', 'Choose file location'),
        title: zh('选择文件位置', 'Choose file location'),
      }
    : null
  const browserPlaybackOnly = configFlag(config?.browser_playback_only)
  const remoteAccess = configFlag(config?.runtime_remote_request)
  const clientMode = configFlag(config?.runtime_client)
  const containerMode = configFlag(config?.runtime_container)
  const hostPathPrefixEnabled = configFlag(config?.host_path_prefix_enabled, containerMode)
  const desktopIntegrationEnabled = configFlag(config?.desktop_integration_enabled, true)
  const directoryPickerEnabled = configFlag(config?.directory_picker_enabled, true)
  const mpvEnabled = configFlag(config?.mpv_enabled, true)
  const defaultPlayer = browserPlaybackOnly
    ? 'browser'
    : normalizeDefaultPlayer(config?.default_player)
  const initialViewMode = normalizeInitialViewMode(config?.initial_view_mode)
  const alternatePlayer = browserPlaybackOnly
    ? ''
    : defaultPlayer === 'system'
      ? mpvEnabled
        ? 'mpv'
        : ''
      : defaultPlayer === 'browser'
        ? clientMode
          ? mpvEnabled
            ? 'mpv'
            : desktopIntegrationEnabled
              ? 'system'
              : ''
          : desktopIntegrationEnabled
            ? 'system'
            : ''
        : desktopIntegrationEnabled
          ? 'system'
          : ''
  const alternatePlayerLabel =
    alternatePlayer === 'mpv'
      ? zh('使用MPV播放器播放', 'Play with MPV player')
      : alternatePlayer === 'system'
        ? zh('用默认程序打开', 'Open with default app')
        : ''
  const showToast = useCallback((message) => {
    setToastMessage(String(message || '').trim())
  }, [])
  const closeToast = useCallback(() => {
    setToastMessage('')
  }, [])
  const showCenterToast = useCallback((message) => {
    setCenterToastMessage(String(message || '').trim())
  }, [])
  const closeCenterToast = useCallback(() => {
    setCenterToastMessage('')
  }, [])
  const ensureRevealAvailable = useCallback(() => {
    if (!remoteAccess) return true
    showCenterToast(
      zh(
        '通过局域网访问时无法打开文件所在位置',
        'Cannot reveal file locations when accessing over the local network'
      )
    )
    return false
  }, [remoteAccess, showCenterToast])
  const loadTagCategories = useCallback(async () => {
    const categories = await fetchTagCategories()
    setTagCategories(Array.isArray(categories) ? categories : [])
    return categories
  }, [])
  const handleOpenTagModal = useCallback(() => {
    loadTags()
    setTagModalApplyMode('replace')
    setTagModalOpen(true)
  }, [loadTags])
  const handleOpenTagFilterEditor = useCallback(() => {
    loadTags()
    setTagModalApplyMode('append')
    setTagModalOpen(true)
  }, [loadTags])

  const mapTagIdsToNames = useCallback(
    (ids) => {
      if (!Array.isArray(ids) || ids.length === 0) return []
      const idSet = new Set(ids)
      return tags.filter((t) => idSet.has(t.id)).map((t) => t.name)
    },
    [tags]
  )

  const getVideoDirPath = useCallback(
    (video) => String(video?.directory?.path || video?.directory_path || '').trim(),
    []
  )

  const getVideoRelPath = useCallback((video) => String(video?.path || '').trim(), [])

  const isVideoOpenable = useCallback(
    (video) => Boolean(getVideoDirPath(video) && getVideoRelPath(video)),
    [getVideoDirPath, getVideoRelPath]
  )

  const getVideoLocationChoices = useCallback(
    (video) => {
      const locations = Array.isArray(video?.locations) ? video.locations : []
      const choices = locations
        .map((location) => {
          const relPath = String(location?.relative_path || '').trim()
          const directory = location?.directory || location?.directory_ref || null
          const dirPath = String(directory?.path || location?.directory_path || '').trim()
          if (!relPath || !dirPath) return null
          return {
            ...video,
            id: video.id,
            location_id: location.id,
            path: relPath,
            directory,
            directory_path: dirPath,
            filename: location?.filename || relPath.split(/[\\/]/).pop() || video.filename,
          }
        })
        .filter(Boolean)
        .filter(isVideoOpenable)
      if (choices.length > 0) return choices
      return isVideoOpenable(video) ? [video] : []
    },
    [isVideoOpenable]
  )

  const openLocationPicker = useCallback((video, action, choices) => {
    setLocationPickerVideo(video)
    setLocationPickerAction(action)
    setLocationPickerChoices(Array.isArray(choices) ? choices : [])
    setLocationPickerOpen(true)
  }, [])

  const closeLocationPicker = useCallback(() => {
    setLocationPickerOpen(false)
    setLocationPickerVideo(null)
    setLocationPickerChoices([])
    setLocationPickerAction('play')
  }, [])

  const playVideoWith = useCallback(
    (video, player) => {
      if (!video) return
      if (player === 'browser') {
        setPlayerStartTime(0)
        setPlayerVideo(video)
        return
      }
      const payload = {
        id: video.id,
        locationId: video.location_id,
        path: getVideoRelPath(video),
        dirPath: getVideoDirPath(video),
      }
      const useSystemPlayer = player === 'system'
      const action = useSystemPlayer ? openVideoFile : playVideoFile
      action(payload).catch((err) => {
        console.error(
          useSystemPlayer
            ? zh('打开文件失败', 'Failed to open file')
            : zh('播放文件失败', 'Failed to play file'),
          err
        )
        showCenterToast(getErrorMessage(err))
      })
    },
    [getVideoDirPath, getVideoRelPath, showCenterToast]
  )

  const revealVideoFile = useCallback(
    (video) => {
      if (!ensureRevealAvailable()) return Promise.resolve()
      if (!video || !isVideoOpenable(video)) return Promise.resolve()
      return revealVideoLocation({
        path: getVideoRelPath(video),
        dirPath: getVideoDirPath(video),
      })
    },
    [ensureRevealAvailable, getVideoDirPath, getVideoRelPath, isVideoOpenable]
  )

  const playVideoFromTime = useCallback(
    (video, startTime) => {
      if (!video) return
      if (browserPlaybackOnly || defaultPlayer === 'browser') {
        setPlayerStartTime(startTime || 0)
        setPlayerVideo(video)
        return
      }
      playVideoFile({
        id: video.id,
        locationId: video.location_id,
        path: getVideoRelPath(video),
        dirPath: getVideoDirPath(video),
        startTime,
      }).catch((err) => {
        console.error(zh('播放文件失败', 'Failed to play file'), err)
        showCenterToast(getErrorMessage(err))
      })
    },
    [browserPlaybackOnly, defaultPlayer, getVideoDirPath, getVideoRelPath, showCenterToast]
  )

  const handleOpenPlayer = useCallback(
    (video) => {
      const choices = getVideoLocationChoices(video)
      if (choices.length > 1) {
        openLocationPicker(video, 'play', choices)
        return
      }
      playVideoWith(choices[0] || video, defaultPlayer)
    },
    [defaultPlayer, getVideoLocationChoices, openLocationPicker, playVideoWith]
  )

  const handleOpenAlternatePlayer = useCallback(
    (video) => {
      if (!alternatePlayer) return
      const choices = getVideoLocationChoices(video)
      if (choices.length > 1) {
        openLocationPicker(video, 'open', choices)
        return
      }
      playVideoWith(choices[0] || video, alternatePlayer)
    },
    [alternatePlayer, getVideoLocationChoices, openLocationPicker, playVideoWith]
  )

  const handleRevealVideoFile = useCallback(
    (video) => {
      if (!ensureRevealAvailable()) return
      const choices = getVideoLocationChoices(video)
      if (choices.length > 1) {
        openLocationPicker(video, 'reveal', choices)
        return
      }
      revealVideoFile(choices[0] || video).catch((err) => {
        console.error(zh('打开所在位置失败', 'Failed to reveal file'), err)
        showCenterToast(getErrorMessage(err))
      })
    },
    [
      ensureRevealAvailable,
      getVideoLocationChoices,
      openLocationPicker,
      revealVideoFile,
      showCenterToast,
    ]
  )

  const handleRenameVideo = useCallback(
    async (video) => {
      const locationId = Number(video?.location_id)
      if (!video?.id || !Number.isFinite(locationId) || locationId <= 0) {
        showCenterToast(zh('无法重命名：缺少文件位置', 'Cannot rename: missing file location'))
        return
      }
      const currentName =
        String(video?.filename || '')
          .trim()
          .split(/[\\/]/)
          .pop() ||
        String(video?.path || '')
          .split(/[\\/]/)
          .pop()
      const nextName = window.prompt(zh('重命名视频文件', 'Rename video file'), currentName)
      if (nextName == null) return
      const filename = nextName.trim()
      if (!filename || filename === currentName) return
      try {
        const updated = await renameVideoLocation(video.id, locationId, filename)
        useStore.setState((state) => {
          const targetKey = videoSelectionKey(video)
          const nextVideos = Array.isArray(state.videos)
            ? state.videos.map((item) =>
                videoSelectionKey(item) === targetKey ? { ...item, ...updated } : item
              )
            : state.videos
          const nextMeta = { ...(state.selectedVideoMeta || {}) }
          if (targetKey && nextMeta[targetKey]) {
            nextMeta[targetKey] = {
              ...nextMeta[targetKey],
              label: updated.filename || updated.path || nextMeta[targetKey].label,
            }
          }
          return { videos: nextVideos, selectedVideoMeta: nextMeta }
        })
      } catch (err) {
        console.error(zh('重命名视频失败', 'Failed to rename video'), err)
        showCenterToast(getErrorMessage(err))
      }
    },
    [showCenterToast]
  )

  const handleDeleteVideo = useCallback(
    async (video) => {
      const locationId = Number(video?.location_id)
      if (!video?.id || !Number.isFinite(locationId) || locationId <= 0) {
        showCenterToast(zh('无法删除：缺少文件位置', 'Cannot delete: missing file location'))
        return
      }
      const label = String(video?.filename || video?.path || `#${video.id}`)
      if (!window.confirm(zh(`确定删除视频文件“${label}”吗？`, `Delete video file "${label}"?`))) {
        return
      }
      try {
        await deleteVideoLocation(video.id, locationId)
        const targetKey = videoSelectionKey(video)
        useStore.setState((state) => {
          const nextIds = new Set(state.selectedVideoIds || [])
          const nextMeta = { ...(state.selectedVideoMeta || {}) }
          if (targetKey) {
            nextIds.delete(targetKey)
            delete nextMeta[targetKey]
          }
          const nextVideos = Array.isArray(state.videos)
            ? state.videos.filter((item) => videoSelectionKey(item) !== targetKey)
            : state.videos
          return {
            videos: nextVideos,
            selectedVideoIds: nextIds,
            selectedVideoMeta: nextMeta,
            total: Math.max(0, Number(state.total || 0) - 1),
          }
        })
        await loadVideos({ force: true })
      } catch (err) {
        console.error(zh('删除视频失败', 'Failed to delete video'), err)
        showCenterToast(getErrorMessage(err))
      }
    },
    [loadVideos, showCenterToast]
  )

  const handleOpenScrapeSettings = useCallback((video) => {
    setScrapeSettingsVideo(video)
  }, [])

  const handleSaveScrapeSettings = useCallback(
    async ({ mode, code }) => {
      const video = scrapeSettingsVideo
      if (!video?.id) return
      setScrapeSettingsSaving(true)
      try {
        const updated = await updateVideoJavScrapeSettings(video.id, { mode, code })
        let override = ''
        if (typeof updated?.jav_scrape_override === 'string') {
          override = updated.jav_scrape_override
        } else if (mode === 'skip') {
          override = JAV_SCRAPE_OVERRIDE_SKIP
        } else if (mode === 'code') {
          override = String(code || '')
            .trim()
            .toUpperCase()
        }
        useStore.setState((state) => ({
          videos: Array.isArray(state.videos)
            ? state.videos.map((item) =>
                item?.id === video.id ? applyScrapeOverrideToVideo(item, override) : item
              )
            : state.videos,
        }))
        setScrapeSettingsVideo(null)
        showToast(zh('刮削设置已保存', 'Scrape settings saved'))
      } catch (err) {
        console.error(zh('保存刮削设置失败', 'Failed to save scrape settings'), err)
        showCenterToast(getErrorMessage(err))
      } finally {
        setScrapeSettingsSaving(false)
      }
    },
    [scrapeSettingsVideo, showCenterToast, showToast]
  )

  const handleFetchScrapePossibleCodes = useCallback(async () => {
    const video = scrapeSettingsVideo
    if (!video?.id) throw new Error(zh('缺少视频 ID', 'Missing video ID'))
    return fetchVideoJavScrapePossibleCodes(video.id)
  }, [scrapeSettingsVideo])

  const handleManualScrape = useCallback(
    async (info) => {
      const video = scrapeSettingsVideo
      if (!video?.id) return
      const locationId = Number(video?.location_id || video?.locations?.[0]?.id || 0)
      if (!Number.isFinite(locationId) || locationId <= 0) {
        showCenterToast(zh('缺少视频位置 ID', 'Missing video location ID'))
        return
      }
      setScrapeSettingsSaving(true)
      try {
        const updated = await manualVideoJavScrape(video.id, locationId, info)
        const override = String(updated?.jav_scrape_override || info?.code || '')
          .trim()
          .toUpperCase()
        const targetKey = videoSelectionKey(video)
        useStore.setState((state) => ({
          videos: Array.isArray(state.videos)
            ? state.videos.map((item) =>
                videoSelectionKey(item) === targetKey && updated
                  ? { ...updated, jav_scrape_override: override }
                  : item
              )
            : state.videos,
        }))
        setScrapeSettingsVideo(null)
        showToast(zh('手动刮削已保存', 'Manual scrape saved'))
      } catch (err) {
        console.error(zh('手动刮削失败', 'Manual scrape failed'), err)
        showCenterToast(getErrorMessage(err))
      } finally {
        setScrapeSettingsSaving(false)
      }
    },
    [scrapeSettingsVideo, showCenterToast, showToast]
  )

  const handleLinkExistingJav = useCallback(
    async (code) => {
      const video = scrapeSettingsVideo
      if (!video?.id) return
      const locationId = Number(video?.location_id || video?.locations?.[0]?.id || 0)
      if (!Number.isFinite(locationId) || locationId <= 0) {
        throw new Error(zh('缺少视频位置 ID', 'Missing video location ID'))
      }
      setScrapeSettingsSaving(true)
      try {
        const updated = await linkVideoToExistingJav(video.id, locationId, code)
        const override = String(updated?.jav_scrape_override || `:manual:${code}`)
          .trim()
          .toUpperCase()
        const targetKey = videoSelectionKey(video)
        useStore.setState((state) => ({
          videos: Array.isArray(state.videos)
            ? state.videos.map((item) =>
                videoSelectionKey(item) === targetKey && updated
                  ? { ...updated, jav_scrape_override: override }
                  : item
              )
            : state.videos,
        }))
        setScrapeSettingsVideo(null)
        showToast(zh('已关联已有番号', 'Linked to existing JAV'))
      } finally {
        setScrapeSettingsSaving(false)
      }
    },
    [scrapeSettingsVideo, showToast]
  )

  const closeJavVideoPicker = useCallback(() => {
    setJavVideoPickerOpen(false)
    setJavVideoPickerItem(null)
    setJavVideoPickerAction('play')
  }, [])

  const handleJavPlay = useCallback(
    (video, item) => {
      const videos = item?.videos || []
      if (videos.length > 1) {
        setJavVideoPickerAction('play')
        setJavVideoPickerItem(item)
        setJavVideoPickerOpen(true)
        return
      }
      const target = video || videos[0]
      if (target) {
        handleOpenPlayer(target)
      }
    },
    [handleOpenPlayer]
  )

  const handleJavOpenFile = useCallback(
    (video, item) => {
      const videos = item?.videos || (video ? [video] : [])
      if (videos.length > 1) {
        setJavVideoPickerAction('open')
        setJavVideoPickerItem(item)
        setJavVideoPickerOpen(true)
        return
      }
      const target = video && isVideoOpenable(video) ? video : videos.find(isVideoOpenable)
      if (!target) return
      handleOpenAlternatePlayer(target)
    },
    [handleOpenAlternatePlayer, isVideoOpenable]
  )

  const handleJavRevealFile = useCallback(
    (video, item) => {
      if (!ensureRevealAvailable()) return
      const videos = item?.videos || (video ? [video] : [])
      if (videos.length > 1) {
        setJavVideoPickerAction('reveal')
        setJavVideoPickerItem(item)
        setJavVideoPickerOpen(true)
        return
      }
      const target = video && isVideoOpenable(video) ? video : videos.find(isVideoOpenable)
      if (!target) return
      handleRevealVideoFile(target)
    },
    [ensureRevealAvailable, handleRevealVideoFile, isVideoOpenable]
  )

  const openVideoScreenshots = useCallback((video) => {
    setScreenshotsAllowSetCover(true)
    setScreenshotsVideo(video)
  }, [])

  const openJavScreenshots = useCallback((video) => {
    setScreenshotsAllowSetCover(false)
    setScreenshotsVideo(video)
  }, [])

  const handleJavOpenScreenshots = useCallback(
    (video, item) => {
      const videos = item?.videos || (video ? [video] : [])
      if (videos.length > 1) {
        setJavVideoPickerAction('screenshots')
        setJavVideoPickerItem(item)
        setJavVideoPickerOpen(true)
        return
      }
      const target = video && isVideoOpenable(video) ? video : videos.find(isVideoOpenable)
      if (!target) return
      openJavScreenshots(target)
    },
    [isVideoOpenable, openJavScreenshots]
  )

  const handleSelectJavVideo = useCallback(
    async (video) => {
      if (!video) return
      if (javVideoPickerAction === 'play') {
        handleOpenPlayer(video)
        closeJavVideoPicker()
        return
      }
      if (javVideoPickerAction === 'open') {
        handleOpenAlternatePlayer(video)
        closeJavVideoPicker()
        return
      }
      if (javVideoPickerAction === 'screenshots') {
        if (isVideoOpenable(video)) {
          openJavScreenshots(video)
          closeJavVideoPicker()
        }
        return
      }
      try {
        if (javVideoPickerAction === 'reveal') {
          handleRevealVideoFile(video)
        }
      } catch (err) {
        console.error(
          javVideoPickerAction === 'open'
            ? zh('打开文件失败', 'Failed to open file')
            : zh('打开所在位置失败', 'Failed to reveal file'),
          err
        )
        showCenterToast(getErrorMessage(err))
      } finally {
        closeJavVideoPicker()
      }
    },
    [
      closeJavVideoPicker,
      handleOpenAlternatePlayer,
      handleOpenPlayer,
      handleRevealVideoFile,
      isVideoOpenable,
      javVideoPickerAction,
      openJavScreenshots,
      showCenterToast,
    ]
  )

  const handleSelectVideoLocation = useCallback(
    async (video) => {
      if (!video) return
      if (locationPickerAction === 'play') {
        playVideoWith(video, defaultPlayer)
        closeLocationPicker()
        return
      }
      if (locationPickerAction === 'open') {
        playVideoWith(video, alternatePlayer)
        closeLocationPicker()
        return
      }
      try {
        if (locationPickerAction === 'reveal') {
          await revealVideoFile(video)
        }
      } catch (err) {
        console.error(zh('打开所在位置失败', 'Failed to reveal file'), err)
        showCenterToast(getErrorMessage(err))
      } finally {
        closeLocationPicker()
      }
    },
    [
      alternatePlayer,
      closeLocationPicker,
      defaultPlayer,
      locationPickerAction,
      playVideoWith,
      revealVideoFile,
      showCenterToast,
    ]
  )
  useEffect(() => {
    let mounted = true
    loadConfig().finally(() => {
      if (mounted) setConfigLoaded(true)
    })
    return () => {
      mounted = false
    }
  }, [loadConfig])

  useEffect(() => {
    if (!configLoaded) return
    setWaterfallModes((current) => ({
      ...current,
      video: configFlag(config?.video_waterfall_default),
      jav: configFlag(config?.jav_waterfall_default),
      idol: configFlag(config?.idol_waterfall_default),
      studio: configFlag(config?.studio_waterfall_default),
      series: configFlag(config?.series_waterfall_default),
    }))
  }, [
    configLoaded,
    config?.video_waterfall_default,
    config?.jav_waterfall_default,
    config?.idol_waterfall_default,
    config?.studio_waterfall_default,
    config?.series_waterfall_default,
  ])

  const applyUrlState = useCallback(
    (parsed) => {
      const mapTagIdsToNamesFromStore = (ids) => {
        if (!Array.isArray(ids) || ids.length === 0) return []
        const { tags: storeTags } = useStore.getState()
        const idSet = new Set(ids)
        return (storeTags || []).filter((t) => idSet.has(t.id)).map((t) => t.name)
      }
      if (parsed.view === 'jav') {
        const { jav } = parsed
        const current = useStore.getState()
        const sameIdolFavoriteGroup =
          jav.tab === 'idol' &&
          Number(jav.favoriteGroupId || 0) > 0 &&
          current.javTab === 'idol' &&
          Number(current.idolFavoriteGroupId || 0) === Number(jav.favoriteGroupId || 0)
        useStore.setState({
          viewMode: 'jav',
          videoTempSort: '',
          javTab: jav.tab,
          javRandomMode: jav.tab === 'list' ? jav.random : false,
          javRandomSeed: jav.tab === 'list' && jav.random ? jav.seed : null,
          javSearchTerm: jav.search,
          javIdolIds: jav.tab === 'list' ? jav.idolIds : [],
          javTags: jav.tab === 'list' ? jav.tagIds : [],
          javStudioId: jav.tab === 'list' ? jav.studioId : null,
          javStudioName:
            jav.tab === 'list' && jav.studioId !== null && jav.studioId !== undefined
              ? jav.studioName
              : '',
          javSeriesId: jav.tab === 'list' ? jav.seriesId : null,
          javSeriesName: jav.tab === 'list' && jav.seriesId ? jav.seriesName : '',
          javPrefix: jav.tab === 'list' ? jav.prefix : '',
          javSoloOnly: jav.tab === 'list' ? jav.soloOnly : false,
          javFavoriteRatingEnabled: jav.tab === 'list' ? jav.favoriteRatingEnabled : false,
          javFavoriteRatingMin: jav.tab === 'list' ? jav.favoriteRatingMin : 0.5,
          javFavoriteRatingMax: jav.tab === 'list' ? jav.favoriteRatingMax : 5,
          javFavoriteGroupId: jav.tab === 'list' ? jav.favoriteGroupId : null,
          javPage: jav.random ? 1 : jav.page,
          idolPage: jav.tab === 'idol' ? jav.page : 1,
          idolFavoriteGroupId: jav.tab === 'idol' ? jav.favoriteGroupId : null,
          idolProfileFilters:
            jav.tab === 'idol'
              ? normalizeIdolProfileFilters(jav.idolProfileFilters)
              : createDefaultIdolProfileFilters(),
          studioPage: jav.tab === 'studio' ? jav.page : 1,
          studioFavoriteGroupId: jav.tab === 'studio' ? jav.favoriteGroupId : null,
          seriesPage: jav.tab === 'series' ? jav.page : 1,
          seriesFavoriteGroupId: jav.tab === 'series' ? jav.favoriteGroupId : null,
          javTempSort: jav.tab !== 'list' || jav.random ? '' : jav.tempSort,
          idolTempSort:
            jav.tab === 'idol' && (!jav.favoriteGroupId || sameIdolFavoriteGroup || jav.tempSort)
              ? jav.tempSort
              : '',
        })
        setJavSearchInput(jav.search)
        if (jav.tab === 'list' && jav.random) {
          useStore.getState().loadJavRandom(jav.seed ?? undefined)
        }
        setHydrated(true)
        return
      }

      const { video } = parsed
      useStore.setState({
        viewMode: 'video',
        javTempSort: '',
        idolTempSort: '',
        videoTempSort: video.random ? '' : video.tempSort,
        randomMode: video.random,
        randomSeed: video.random ? video.seed : null,
        searchTerm: video.search,
        page: video.random ? 1 : video.page,
      })
      setSearchInput(video.search)
      const names = mapTagIdsToNamesFromStore(video.tagIds)
      if (names.length || video.tagIds.length === 0) {
        useStore.getState().setSelectedTags(names, { resetPage: false, preserveTempSort: true })
      } else {
        pendingVideoTagIdsRef.current = video.tagIds
      }
      if (video.random) {
        useStore.getState().loadRandom(video.seed ?? undefined)
      }
      setHydrated(true)
    },
    [setJavSearchInput, setSearchInput]
  )

  const currentUrlState = useMemo(
    () =>
      normalizeUrlStateFromStore(
        {
          viewMode,
          page,
          searchTerm,
          videoTempSort,
          selectedTags,
          randomMode,
          randomSeed,
          javTab,
          javPage,
          javSearchTerm,
          javIdolIds,
          javTags,
          javStudioId,
          javStudioName,
          javSeriesId,
          javSeriesName,
          javPrefix,
          javSoloOnly,
          javFavoriteRatingEnabled,
          javFavoriteRatingMin,
          javFavoriteRatingMax,
          javFavoriteGroupId,
          javTempSort,
          idolTempSort,
          javRandomMode,
          javRandomSeed,
          idolPage,
          idolFavoriteGroupId,
          idolProfileFilters,
          studioFavoriteGroupId,
          seriesFavoriteGroupId,
          studioPage,
          seriesPage,
        },
        tagsByName
      ),
    [
      idolFavoriteGroupId,
      idolProfileFilters,
      idolTempSort,
      javFavoriteGroupId,
      idolPage,
      studioPage,
      seriesPage,
      javIdolIds,
      javStudioId,
      javSeriesId,
      javPrefix,
      javSoloOnly,
      javFavoriteRatingEnabled,
      javFavoriteRatingMin,
      javFavoriteRatingMax,
      studioFavoriteGroupId,
      seriesFavoriteGroupId,
      javPage,
      javRandomMode,
      javRandomSeed,
      javSearchTerm,
      javTempSort,
      javTab,
      javTags,
      page,
      randomMode,
      randomSeed,
      searchTerm,
      selectedTags,
      videoTempSort,
      tagsByName,
      viewMode,
      javStudioName,
      javSeriesName,
    ]
  )

  const handleParsedUrlView = useCallback((parsedView) => {
    useStore.setState({ viewMode: parsedView === 'jav' ? 'jav' : 'video' })
  }, [])

  const {
    browserNavigation,
    handleBrowserBack,
    handleBrowserForward,
    pathname,
    pendingScrollRestoreRef,
    saveScrollBeforeUrlStateChange,
    schedulePendingScrollRestore,
  } = useUrlStateSync({
    applyUrlState,
    configLoaded,
    currentUrlState,
    hydrated,
    initialViewMode,
    onParsedView: handleParsedUrlView,
  })

  const handleVideoTagClick = useCallback(
    (name) => {
      if (!name) return
      saveScrollBeforeUrlStateChange()
      setSearchTerm('', { resetPage: false, triggerLoad: false })
      setSelectedTags([name])
    },
    [saveScrollBeforeUrlStateChange, setSearchTerm, setSelectedTags]
  )

  const buildVideoUrl = useCallback(
    (options = {}) => {
      const {
        page: pageOverride,
        search: searchOverride,
        random: randomOverride,
        seed: seedOverride,
        tagIds: tagIdsOverride,
        tempSort: tempSortOverride,
      } = options
      const sp = new URLSearchParams()
      sp.set('view', 'video')
      const searchVal = (searchOverride ?? searchTerm).trim()
      if (searchVal) {
        sp.set('search', searchVal)
      }
      const hasTempSortOverride = Object.prototype.hasOwnProperty.call(options, 'tempSort')
      const tempSortVal = hasTempSortOverride
        ? normalizeVideoSort(tempSortOverride, '')
        : videoTempSort
      const tagIds = tagIdsOverride ?? selectedTagIds
      if (tagIds.length > 0) {
        sp.set('tag_ids', [...tagIds].sort((a, b) => a - b).join(','))
      }
      const randomFlag = randomOverride ?? randomMode
      if (randomFlag) {
        sp.set('random', '1')
        const seedValue = seedOverride ?? randomSeed
        if (seedValue) {
          sp.set('seed', String(seedValue))
        }
      } else {
        if (tempSortVal) {
          sp.set('temp_sort', tempSortVal)
        }
        sp.delete('random')
        sp.delete('seed')
        const targetPage = pageOverride ?? page
        sp.set('page', String(targetPage))
      }
      const query = sp.toString()
      return `${pathname}${query ? `?${query}` : ''}`
    },
    [page, pathname, randomMode, randomSeed, searchTerm, selectedTagIds, videoTempSort]
  )

  const buildJavUrl = useCallback(
    (options = {}) => {
      const {
        page: pageOverride,
        search: searchOverride,
        tab: tabOverride,
        idolIds: idolIdsOverride,
        studioId: studioIdOverride,
        studioName: studioNameOverride,
        seriesId: seriesIdOverride,
        seriesName: seriesNameOverride,
        prefix: prefixOverride,
        soloOnly: soloOnlyOverride,
        favoriteRatingEnabled: favoriteRatingEnabledOverride,
        favoriteRatingMin: favoriteRatingMinOverride,
        favoriteRatingMax: favoriteRatingMaxOverride,
        favoriteGroupId: favoriteGroupIdOverride,
        idolProfileFilters: idolProfileFiltersOverride,
        tagIds: tagIdsOverride,
        random: randomOverride,
        seed: seedOverride,
        tempSort: tempSortOverride,
      } = options
      const sp = new URLSearchParams()
      sp.set('view', 'jav')
      const tab = tabOverride ?? javTab
      if (tab === 'idol' || tab === 'studio' || tab === 'series' || tab === 'download') {
        sp.set('tab', tab)
      }
      const searchVal = (searchOverride ?? javSearchTerm).trim()
      if (searchVal) {
        sp.set('search', searchVal)
      }
      const idolIdList = idolIdsOverride ?? javIdolIds
      if (tab === 'list' && idolIdList && idolIdList.length > 0) {
        sp.set('idol_ids', idolIdList.join(','))
      }
      const tagList = tagIdsOverride ?? javTags
      if (tab === 'list' && tagList && tagList.length > 0) {
        sp.set('tag_ids', tagList.join(','))
      }
      const hasStudioIdOverride = Object.prototype.hasOwnProperty.call(options, 'studioId')
      const studioId = hasStudioIdOverride ? studioIdOverride : javStudioId
      if (tab === 'list' && studioId !== null && studioId !== undefined) {
        sp.set('studio_id', String(studioId))
        const studioName =
          studioNameOverride ?? (hasStudioIdOverride ? '' : String(javStudioName || '').trim())
        if (studioName) {
          sp.set('studio_name', studioName)
        }
      }
      const hasSeriesIdOverride = Object.prototype.hasOwnProperty.call(options, 'seriesId')
      const seriesId = hasSeriesIdOverride ? seriesIdOverride : javSeriesId
      if (tab === 'list' && seriesId) {
        sp.set('series_id', String(seriesId))
        const seriesName =
          seriesNameOverride ?? (hasSeriesIdOverride ? '' : String(javSeriesName || '').trim())
        if (seriesName) {
          sp.set('series_name', seriesName)
        }
      }
      const hasPrefixOverride = Object.prototype.hasOwnProperty.call(options, 'prefix')
      const prefix = String(hasPrefixOverride ? prefixOverride || '' : javPrefix || '')
        .trim()
        .toUpperCase()
      if (tab === 'list' && prefix) {
        sp.set('prefix', prefix)
      }
      const hasSoloOnlyOverride = Object.prototype.hasOwnProperty.call(options, 'soloOnly')
      const soloOnly = hasSoloOnlyOverride ? Boolean(soloOnlyOverride) : Boolean(javSoloOnly)
      if (tab === 'list' && soloOnly) {
        sp.set('solo', '1')
      }
      const hasFavoriteRatingEnabledOverride = Object.prototype.hasOwnProperty.call(
        options,
        'favoriteRatingEnabled'
      )
      const favoriteRatingEnabled = hasFavoriteRatingEnabledOverride
        ? Boolean(favoriteRatingEnabledOverride)
        : Boolean(javFavoriteRatingEnabled)
      if (tab === 'list' && favoriteRatingEnabled) {
        const favoriteRatingMin = favoriteRatingMinOverride ?? javFavoriteRatingMin
        const favoriteRatingMax = favoriteRatingMaxOverride ?? javFavoriteRatingMax
        sp.set('favorite_rating_min', String(favoriteRatingMin))
        sp.set('favorite_rating_max', String(favoriteRatingMax))
      }
      const hasFavoriteGroupIdOverride = Object.prototype.hasOwnProperty.call(
        options,
        'favoriteGroupId'
      )
      const favoriteGroupId = hasFavoriteGroupIdOverride
        ? favoriteGroupIdOverride
        : tab === 'idol'
          ? idolFavoriteGroupId
          : tab === 'studio'
            ? studioFavoriteGroupId
            : tab === 'series'
              ? seriesFavoriteGroupId
              : javFavoriteGroupId
      if (
        (tab === 'list' || tab === 'idol' || tab === 'studio' || tab === 'series') &&
        favoriteGroupId
      ) {
        sp.set('favorite_group_id', String(favoriteGroupId))
      }
      if (tab === 'idol') {
        const profileFilters = normalizeIdolProfileFilters(
          idolProfileFiltersOverride ?? idolProfileFilters
        )
        for (const definition of IDOL_PROFILE_FILTER_DEFINITIONS) {
          const value = profileFilters[definition.key]
          if (!value.enabled) continue
          sp.set(`idol_${definition.key}_min`, String(value.min))
          sp.set(`idol_${definition.key}_max`, String(value.max))
        }
      }
      const hasTempSortOverride = Object.prototype.hasOwnProperty.call(options, 'tempSort')
      const tempSortVal = hasTempSortOverride
        ? tab === 'idol'
          ? normalizeIdolSort(tempSortOverride, '')
          : normalizeJavSort(tempSortOverride, '')
        : tab === 'idol'
          ? idolTempSort
          : javTempSort
      const randomFlag = randomOverride ?? javRandomMode
      if (tab === 'list' && randomFlag) {
        sp.set('random', '1')
        const seedValue = seedOverride ?? javRandomSeed
        if (seedValue) {
          sp.set('seed', String(seedValue))
        }
      } else {
        if ((tab === 'list' || tab === 'idol') && tempSortVal) {
          sp.set('temp_sort', tempSortVal)
        }
        sp.delete('random')
        sp.delete('seed')
        const targetPage =
          pageOverride ??
          (tab === 'idol'
            ? idolPage
            : tab === 'studio'
              ? studioPage
              : tab === 'series'
                ? seriesPage
                : javPage)
        sp.set('page', String(targetPage))
      }
      const query = sp.toString()
      return `${pathname}${query ? `?${query}` : ''}`
    },
    [
      idolPage,
      idolFavoriteGroupId,
      idolProfileFilters,
      idolTempSort,
      javFavoriteGroupId,
      pathname,
      studioFavoriteGroupId,
      seriesFavoriteGroupId,
      studioPage,
      seriesPage,
      javIdolIds,
      javStudioId,
      javStudioName,
      javSeriesId,
      javSeriesName,
      javPrefix,
      javSoloOnly,
      javFavoriteRatingEnabled,
      javFavoriteRatingMin,
      javFavoriteRatingMax,
      javPage,
      javTempSort,
      javSearchTerm,
      javTab,
      javTags,
      javRandomMode,
      javRandomSeed,
    ]
  )

  const applyJavTagFilter = useCallback(
    (tagIds) => {
      const clean = Array.from(
        new Set(
          (tagIds || [])
            .map((id) => Number.parseInt(String(id), 10))
            .filter((value) => Number.isFinite(value) && value > 0)
        )
      )
      saveScrollBeforeUrlStateChange()
      useStore.setState({
        viewMode: 'jav',
        videoTempSort: '',
        javTab: 'list',
        javTempSort: '',
        idolTempSort: '',
        javRandomMode: false,
        javRandomSeed: null,
        javIdolIds: [],
        javStudioId: null,
        javStudioName: '',
        javSeriesId: null,
        javSeriesName: '',
        javPrefix: '',
        javSoloOnly: false,
        javFavoriteRatingEnabled: false,
        javFavoriteRatingMin: 0.5,
        javFavoriteRatingMax: 5,
        idolFavoriteGroupId: null,
        javTags: clean,
        javSearchTerm: '',
        javPage: 1,
        idolPage: 1,
        studioPage: 1,
        seriesPage: 1,
      })
    },
    [saveScrollBeforeUrlStateChange]
  )

  useEffect(() => {
    setSearchInput(searchTerm)
  }, [searchTerm])

  useEffect(() => {
    setJavSearchInput(javSearchTerm)
  }, [javSearchTerm])

  useEffect(() => {
    loadDirectories()
  }, [loadDirectories])

  useEffect(() => {
    loadTags({ skipUnchanged: true })
    loadJavTags({ skipUnchanged: true })
  }, [loadTags, loadJavTags, directoryStateKey, videoHideJav])

  useEffect(() => {
    if (!pendingVideoTagIdsRef.current || !tags.length) return
    const names = mapTagIdsToNames(pendingVideoTagIdsRef.current)
    setSelectedTags(names, { resetPage: false, preserveTempSort: true })
    pendingVideoTagIdsRef.current = null
  }, [mapTagIdsToNames, setSelectedTags, tags])

  useEffect(() => {
    if (hydrated && configLoaded && !isJavMode) {
      loadVideos()
    }
  }, [
    configLoaded,
    hydrated,
    isJavMode,
    loadVideos,
    page,
    pageSize,
    randomMode,
    randomSeed,
    searchTerm,
    selectedTags,
    directoryStateKey,
    sortOrder,
    videoTempSort,
    videoHideJav,
  ])

  useEffect(() => {
    if (!hydrated || !configLoaded || !isJavMode) return
    if (javTab === 'download') {
      return
    } else if (javTab === 'idol') {
      loadJavIdols()
      loadJavFavoriteGroups('idol')
    } else if (javTab === 'studio') {
      loadJavStudios()
      loadJavFavoriteGroups('studio')
    } else if (javTab === 'series') {
      loadJavSeries()
      loadJavFavoriteGroups('series')
    } else {
      loadJavs()
      loadJavFavoriteGroups('jav')
    }
  }, [
    hydrated,
    isJavMode,
    javTab,
    javPage,
    javPageSize,
    javSearchTerm,
    javIdolIds,
    javTags,
    javStudioId,
    javSeriesId,
    javPrefix,
    javSoloOnly,
    javFavoriteRatingEnabled,
    javFavoriteRatingMin,
    javFavoriteRatingMax,
    javFavoriteGroupId,
    javSort,
    javSortRules,
    javTempSort,
    javRandomMode,
    javRandomSeed,
    idolSort,
    idolTempSort,
    idolPage,
    idolPageSize,
    idolFavoriteGroupId,
    idolProfileFilters,
    studioFavoriteGroupId,
    seriesFavoriteGroupId,
    studioPage,
    studioPageSize,
    seriesPage,
    seriesPageSize,
    directoryStateKey,
    loadJavs,
    loadJavIdols,
    loadJavFavoriteGroups,
    loadJavStudios,
    loadJavSeries,
    configLoaded,
  ])

  const forceReloadVideos = useCallback(() => {
    if (!hydrated || !configLoaded) return
    loadVideos({ force: true })
  }, [configLoaded, hydrated, loadVideos])

  const handleVideoCoverChanged = useCallback(
    (updated) => {
      const targetID = Number(updated?.id || screenshotsVideo?.id || 0)
      if (!targetID) return
      const coverScreenshotName =
        typeof updated?.cover_screenshot_name === 'string' ? updated.cover_screenshot_name : ''
      const updatedAt = updated?.updated_at || new Date().toISOString()

      if (screenshotsVideo?.id === targetID) {
        setScreenshotsVideo((current) =>
          current?.id === targetID
            ? {
                ...current,
                ...(updated || {}),
                cover_screenshot_name: coverScreenshotName,
                updated_at: updatedAt,
              }
            : current
        )
      }
      useStore.setState((state) => ({
        videos: Array.isArray(state.videos)
          ? state.videos.map((video) =>
              video?.id === targetID
                ? {
                    ...video,
                    ...(updated || {}),
                    cover_screenshot_name: coverScreenshotName,
                    updated_at: updatedAt,
                  }
                : video
            )
          : state.videos,
        javItems: Array.isArray(state.javItems)
          ? state.javItems.map((item) => {
              if (!Array.isArray(item?.videos)) return item
              let changed = false
              const nextVideos = item.videos.map((video) => {
                if (video?.id !== targetID) return video
                changed = true
                return {
                  ...video,
                  ...(updated || {}),
                  cover_screenshot_name: coverScreenshotName,
                  updated_at: updatedAt,
                }
              })
              return changed ? { ...item, videos: nextVideos } : item
            })
          : state.javItems,
      }))
    },
    [screenshotsVideo?.id]
  )

  const forceReloadJavByTab = useCallback(
    (tab) => {
      if (!hydrated || !configLoaded) return
      if (tab === 'download') {
        return
      } else if (tab === 'idol') {
        loadJavIdols({ force: true })
        loadJavFavoriteGroups('idol', { force: true })
      } else if (tab === 'studio') {
        loadJavStudios({ force: true })
        loadJavFavoriteGroups('studio', { force: true })
      } else if (tab === 'series') {
        loadJavSeries({ force: true })
        loadJavFavoriteGroups('series', { force: true })
      } else {
        loadJavs({ force: true })
        loadJavFavoriteGroups('jav', { force: true })
      }
    },
    [
      configLoaded,
      hydrated,
      loadJavFavoriteGroups,
      loadJavIdols,
      loadJavSeries,
      loadJavStudios,
      loadJavs,
    ]
  )

  const setWaterfallMode = useCallback(
    (key, enabled) => {
      setWaterfallModes((current) => ({ ...current, [key]: enabled }))
      if (enabled || !hydrated || !configLoaded) return
      if (key === 'video') {
        loadVideos({ force: true })
      } else if (key === 'jav') {
        loadJavs({ force: true })
      } else if (key === 'idol') {
        loadJavIdols({ force: true })
      } else if (key === 'studio') {
        loadJavStudios({ force: true })
      } else if (key === 'series') {
        loadJavSeries({ force: true })
      }
    },
    [configLoaded, hydrated, loadJavIdols, loadJavSeries, loadJavStudios, loadJavs, loadVideos]
  )

  const canPrev = page > 1
  const canNext = hasNext
  const lastPage = Math.max(1, Math.ceil((total || 0) / pageSize))

  const navigateVideoPage = useCallback(
    (targetPage) => {
      if (!targetPage || targetPage === page) return
      setPage(targetPage)
    },
    [page, setPage]
  )
  const selectedCount = useMemo(() => selectedVideoIds.size, [selectedVideoIds])
  const selectedList = useMemo(() => {
    const keys = Array.from(selectedVideoIds)
    return keys.map((key) => {
      const v = videos.find((item) => videoSelectionKey(item) === String(key))
      const meta = selectedVideoMeta?.[key]
      const labelFromMeta = meta && typeof meta === 'object' ? meta.label : meta
      const videoId = Number(meta && typeof meta === 'object' ? meta.video_id : v?.id)
      const locationId = Number(
        meta && typeof meta === 'object' ? meta.location_id : v?.location_id
      )
      const javId = Number(
        meta && typeof meta === 'object' ? (meta.jav_id ?? v?.jav_id) : v?.jav_id
      )
      const javCode = String(
        (meta && typeof meta === 'object' ? meta.jav_code : '') ||
          v?.jav?.code ||
          v?.locations?.[0]?.jav?.code ||
          ''
      ).trim()
      return {
        id: key,
        label: labelFromMeta || v?.filename || v?.path || `#${key}`,
        video: v,
        video_id: Number.isFinite(videoId) && videoId > 0 ? videoId : null,
        location_id: Number.isFinite(locationId) && locationId > 0 ? locationId : null,
        jav_id: Number.isFinite(javId) && javId > 0 ? javId : null,
        jav_code: javCode,
      }
    })
  }, [selectedVideoIds, videos, selectedVideoMeta])
  const selectedJavIds = useMemo(
    () =>
      Array.from(
        new Set(
          selectedList
            .map((item) => Number(item?.jav_id || item?.video?.jav_id))
            .filter((id) => Number.isFinite(id) && id > 0)
        )
      ),
    [selectedList]
  )
  const selectedJavVideoCount = useMemo(
    () => selectedList.filter((item) => Number(item?.jav_id) > 0).length,
    [selectedList]
  )
  const javLastPage = Math.max(1, Math.ceil((javTotal || 0) / javPageSize))
  const javHasPrev = javPage > 1
  const javHasNext = javPage < javLastPage
  const idolLastPage = Math.max(1, Math.ceil((idolTotal || 0) / idolPageSize))
  const idolHasPrev = idolPage > 1
  const idolHasNext = idolPage < idolLastPage
  const studioLastPage = Math.max(1, Math.ceil((studioTotal || 0) / studioPageSize))
  const studioHasPrev = studioPage > 1
  const studioHasNext = studioPage < studioLastPage
  const seriesLastPage = Math.max(1, Math.ceil((seriesTotal || 0) / seriesPageSize))
  const seriesHasPrev = seriesPage > 1
  const seriesHasNext = seriesPage < seriesLastPage
  const webHotkeys = useMemo(() => parseWebHotkeys(config?.web_hotkeys), [config?.web_hotkeys])
  const navigateActivePageBy = useCallback(
    (direction) => {
      if (!isJavMode) {
        if (randomMode || waterfallModes.video || loading) return
        if (direction < 0 && canPrev) {
          navigateVideoPage(page - 1)
        } else if (direction > 0 && canNext) {
          navigateVideoPage(page + 1)
        }
        return
      }

      const waterfallKey = javTab === 'list' ? 'jav' : javTab
      const activeWaterfallMode = Boolean(waterfallModes[waterfallKey])
      if (activeWaterfallMode) return
      if (javTab === 'idol') {
        if (idolLoading) return
        if (direction < 0 && idolHasPrev) setIdolPage(idolPage - 1)
        else if (direction > 0 && idolHasNext) setIdolPage(idolPage + 1)
      } else if (javTab === 'studio') {
        if (studioLoading) return
        if (direction < 0 && studioHasPrev) setStudioPage(studioPage - 1)
        else if (direction > 0 && studioHasNext) setStudioPage(studioPage + 1)
      } else if (javTab === 'series') {
        if (seriesLoading) return
        if (direction < 0 && seriesHasPrev) setSeriesPage(seriesPage - 1)
        else if (direction > 0 && seriesHasNext) setSeriesPage(seriesPage + 1)
      } else {
        if (javRandomMode || javLoading) return
        if (direction < 0 && javHasPrev) setJavPage(javPage - 1)
        else if (direction > 0 && javHasNext) setJavPage(javPage + 1)
      }
    },
    [
      canNext,
      canPrev,
      idolHasNext,
      idolHasPrev,
      idolLoading,
      idolPage,
      isJavMode,
      javHasNext,
      javHasPrev,
      javLoading,
      javPage,
      javRandomMode,
      javTab,
      loading,
      navigateVideoPage,
      page,
      randomMode,
      seriesHasNext,
      seriesHasPrev,
      seriesLoading,
      seriesPage,
      setIdolPage,
      setJavPage,
      setSeriesPage,
      setStudioPage,
      studioHasNext,
      studioHasPrev,
      studioLoading,
      studioPage,
      waterfallModes,
    ]
  )

  useEffect(() => {
    const actionByKey = new Map(webHotkeys.map((item) => [webHotkeyKeyId(item.key), item.action]))
    const modifierKeys = new Set(['Alt', 'AltGraph', 'Control', 'Meta', 'OS', 'Shift'])
    let continuousAction = ''
    let continuousBaseKeyId = ''
    let continuousFrameId = null
    let previousFrameTime = 0

    const hasShortcutBlockingOverlay = (action = '') => {
      if (document.documentElement.classList.contains('app-modal-open')) {
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]'))
        const topDialog = dialogs[dialogs.length - 1]
        const imageNavigationAllowed =
          (action === 'previous_page' || action === 'next_page') &&
          topDialog?.classList.contains('image-preview-modal')
        const onlyJavQueryEditorOpen =
          action === 'edit_jav_query' &&
          dialogs.length === 1 &&
          dialogs[0].classList.contains('jav-query-editor-modal')
        if (!onlyJavQueryEditorOpen && !imageNavigationAllowed) return true
      }
      return Array.from(document.querySelectorAll('.MuiPopover-root, .MuiMenu-root')).some(
        (overlay) =>
          action !== 'open_page_jump' || !overlay.querySelector('.pagination-jump-popover')
      )
    }

    const blurActiveControl = () => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }
    }

    const stopContinuousScroll = () => {
      if (continuousFrameId != null) window.cancelAnimationFrame(continuousFrameId)
      continuousAction = ''
      continuousBaseKeyId = ''
      continuousFrameId = null
      previousFrameTime = 0
    }

    const runContinuousScroll = (frameTime) => {
      if (!continuousAction || hasShortcutBlockingOverlay()) {
        stopContinuousScroll()
        return
      }
      if (previousFrameTime > 0) {
        const elapsed = Math.min(50, frameTime - previousFrameTime)
        const direction = continuousAction === 'continuous_scroll_up' ? -1 : 1
        window.scrollBy({ top: direction * elapsed * 0.4, left: 0, behavior: 'auto' })
      }
      previousFrameTime = frameTime
      continuousFrameId = window.requestAnimationFrame(runContinuousScroll)
    }

    const startContinuousScroll = (action, baseKey) => {
      if (continuousAction === action && continuousFrameId != null) return
      stopContinuousScroll()
      continuousAction = action
      continuousBaseKeyId = webHotkeyKeyId(baseKey)
      continuousFrameId = window.requestAnimationFrame(runContinuousScroll)
    }

    const handleKeyDown = (event) => {
      if (continuousAction && modifierKeys.has(event.key)) stopContinuousScroll()
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        isWebHotkeyEditingTarget(event.target)
      ) {
        return
      }

      const pressedKey = webHotkeyFromKeyboardEvent(event)
      const action = actionByKey.get(webHotkeyKeyId(pressedKey))
      if (!action) return
      if (hasShortcutBlockingOverlay(action)) return
      if (action === 'edit_jav_query' && (!isJavMode || javTab !== 'list')) return
      const pageJumpTrigger =
        action === 'open_page_jump'
          ? document.querySelector('[data-page-jump-trigger="true"]:not(:disabled)')
          : null
      if (action === 'open_page_jump' && !pageJumpTrigger) return
      const imagePreviewOpen = Boolean(document.querySelector('.image-preview-modal'))
      const imageNavigationTrigger =
        imagePreviewOpen && (action === 'previous_page' || action === 'next_page')
          ? document.querySelector(
              `[data-image-navigation="${action === 'previous_page' ? 'previous' : 'next'}"]`
            )
          : null
      event.preventDefault()
      blurActiveControl()

      if (imagePreviewOpen && (action === 'previous_page' || action === 'next_page')) {
        imageNavigationTrigger?.click()
      } else if (action === 'edit_jav_query') {
        stopContinuousScroll()
        if (!event.repeat) {
          setJavQueryEditorOpen((current) => {
            if (!current) loadJavTags()
            return !current
          })
        }
      } else if (action === 'open_page_jump') {
        if (!event.repeat) pageJumpTrigger.click()
      } else if (action === 'continuous_scroll_up' || action === 'continuous_scroll_down') {
        startContinuousScroll(action, event.key)
      } else if (action === 'content_page_up' || action === 'content_page_down') {
        const viewportHeight = document.scrollingElement?.clientHeight || window.innerHeight || 1
        window.scrollBy({
          top: (action === 'content_page_up' ? -1 : 1) * Math.max(1, viewportHeight * 0.9),
          left: 0,
          behavior: 'smooth',
        })
      } else if (action === 'previous_page') {
        navigateActivePageBy(-1)
      } else if (action === 'next_page') {
        navigateActivePageBy(1)
      } else if (action === 'browser_back') {
        window.history.back()
      } else if (action === 'browser_forward') {
        window.history.forward()
      }
    }

    const handleKeyUp = (event) => {
      if (!continuousAction) return
      if (modifierKeys.has(event.key) || webHotkeyKeyId(event.key) === continuousBaseKeyId) {
        stopContinuousScroll()
      }
    }

    const handleVisibilityChange = () => {
      if (document.hidden) stopContinuousScroll()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', stopContinuousScroll)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      stopContinuousScroll()
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', stopContinuousScroll)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [isJavMode, javTab, loadJavTags, navigateActivePageBy, webHotkeys])

  const videoWaterfallHasMore =
    !randomMode && (page - 1) * pageSize + (videos?.length || 0) < (total || 0)
  const javWaterfallHasMore =
    !javRandomMode && (javPage - 1) * javPageSize + (javItems?.length || 0) < (javTotal || 0)
  const idolWaterfallHasMore =
    (idolPage - 1) * idolPageSize + (idolItems?.length || 0) < (idolTotal || 0)
  const studioWaterfallHasMore =
    (studioPage - 1) * studioPageSize + (studioItems?.length || 0) < (studioTotal || 0)
  const seriesWaterfallHasMore =
    (seriesPage - 1) * seriesPageSize + (seriesItems?.length || 0) < (seriesTotal || 0)
  const displayJavTagOptions = useMemo(
    () =>
      (javTagOptions || []).map((tag) =>
        withJavTagDisplayName(tag, configFlag(config?.jav_tag_show_simplified))
      ),
    [config?.jav_tag_show_simplified, javTagOptions]
  )
  const javTagNameMap = useMemo(
    () => new Map(displayJavTagOptions.map((tag) => [tag.id, tag.name])),
    [displayJavTagOptions]
  )
  const javIdolOptionMap = useMemo(() => {
    const map = new Map()
    const addIdol = (idol) => {
      const id = Number(idol?.id)
      if (!Number.isFinite(id) || id <= 0 || map.has(id)) return
      map.set(id, idol)
    }
    Object.values(javResolvedIdols || {}).forEach(addIdol)
    ;(idolItems || []).forEach(addIdol)
    ;(javItems || []).forEach((item) => {
      ;(item?.idols || []).forEach(addIdol)
    })
    return map
  }, [idolItems, javItems, javResolvedIdols])
  const javIdolFilterOptions = useMemo(
    () => Array.from(javIdolOptionMap.values()),
    [javIdolOptionMap]
  )
  useEffect(() => {
    setJavResolvedIdols({})
  }, [directoryStateKey])

  useEffect(() => {
    if (!isJavMode || javTab !== 'list' || javIdolIds.length === 0) return undefined
    const missingIds = javIdolIds
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0 && !javIdolOptionMap.has(id))
    if (missingIds.length === 0) return undefined

    let cancelled = false
    resolveJavIdols(missingIds)
      .then((items) => {
        if (cancelled) return
        const loaded = {}
        for (const idol of items || []) {
          const id = Number(idol?.id)
          if (Number.isFinite(id) && id > 0) loaded[id] = idol
        }
        if (Object.keys(loaded).length > 0) {
          setJavResolvedIdols((current) => ({ ...current, ...loaded }))
        }
      })
      .catch((err) => {
        console.warn('resolve jav idol names failed', err)
      })

    return () => {
      cancelled = true
    }
  }, [isJavMode, javTab, javIdolIds, javIdolOptionMap, directoryStateKey])

  const searchHref = buildVideoUrl({
    search: searchInput,
    page: 1,
    tempSort: '',
  })
  const javSearchHref = buildJavUrl({
    search: javSearchInput,
    page: 1,
    tab: javTab,
    tempSort: '',
  })
  const handleJavRandomClick = useCallback(() => {
    const nextSeed = generateRandomSeed()
    useStore.setState({
      viewMode: 'jav',
      videoTempSort: '',
      javTab: 'list',
      idolTempSort: '',
      idolFavoriteGroupId: null,
      idolPage: 1,
      studioPage: 1,
      seriesPage: 1,
    })
    loadJavRandom(nextSeed)
  }, [loadJavRandom])

  const handleVideoRandomClick = useCallback(() => {
    const nextSeed = generateRandomSeed()
    useStore.setState({ viewMode: 'video' })
    useStore.getState().loadRandom(nextSeed)
  }, [])
  const updateVideoFilters = useCallback(
    (updates) => {
      saveScrollBeforeUrlStateChange()
      useStore.setState({
        videoTempSort: '',
        page: 1,
        ...updates,
      })
    },
    [saveScrollBeforeUrlStateChange]
  )

  const updateJavFilters = useCallback(
    (updates) => {
      saveScrollBeforeUrlStateChange()
      useStore.setState({
        javTempSort: '',
        idolTempSort: '',
        javPage: 1,
        ...updates,
      })
    },
    [saveScrollBeforeUrlStateChange]
  )

  const handleFavoriteRatingEnabledChange = useCallback(
    (enabled) => {
      updateJavFilters({ javFavoriteRatingEnabled: Boolean(enabled) })
    },
    [updateJavFilters]
  )

  const handleFavoriteRatingRangeChange = useCallback(
    (range) => {
      if (!Array.isArray(range) || range.length !== 2) return
      const min = Number(range[0])
      const max = Number(range[1])
      if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return
      updateJavFilters({
        javFavoriteRatingMin: min,
        javFavoriteRatingMax: max,
      })
    },
    [updateJavFilters]
  )

  const handleIdolProfileFilterChange = useCallback(
    (key, updates) => {
      if (!IDOL_PROFILE_FILTER_DEFINITIONS.some((definition) => definition.key === key)) return
      const current = normalizeIdolProfileFilters(useStore.getState().idolProfileFilters)
      const next = normalizeIdolProfileFilters({
        ...current,
        [key]: { ...current[key], ...(updates || {}) },
      })
      updateJavFilters({ idolProfileFilters: next, idolPage: 1 })
    },
    [updateJavFilters]
  )

  const activeFilterItems = useMemo(() => {
    if (!isJavMode) {
      const items = []
      const activeSearch = String(searchTerm || '').trim()
      if (activeSearch) {
        items.push({
          key: 'video-search',
          label: zh(`搜索: ${activeSearch}`, `Search: ${activeSearch}`),
          onRemove: () => {
            setSearchInput('')
            updateVideoFilters({ searchTerm: '' })
          },
        })
      }
      selectedTags.forEach((name) => {
        items.push({
          key: `video-tag-${name}`,
          label: zh(`标签: ${name}`, `Tag: ${name}`),
          onRemove: () =>
            updateVideoFilters({ selectedTags: selectedTags.filter((tag) => tag !== name) }),
        })
      })
      if (randomMode) {
        items.push({
          key: 'video-random',
          label: zh('随机', 'Random'),
          onRemove: () => updateVideoFilters({ randomMode: false, randomSeed: null }),
        })
      }
      return items
    }

    const items = []
    if (javTab === 'idol') return items
    const activeSearch = String(javSearchTerm || '').trim()
    if (activeSearch) {
      items.push({
        key: 'jav-search',
        label: zh(`搜索: ${activeSearch}`, `Search: ${activeSearch}`),
        onRemove: () => {
          setJavSearchInput('')
          updateJavFilters({
            javSearchTerm: '',
            ...(javTab === 'idol'
              ? { idolPage: 1 }
              : javTab === 'studio'
                ? { studioPage: 1 }
                : javTab === 'series'
                  ? { seriesPage: 1 }
                  : {}),
          })
        },
      })
    }
    if (javTab !== 'list') return items

    javIdolIds.forEach((id) => {
      const idol = javIdolOptionMap.get(Number(id))
      const name = idol
        ? getIdolDisplayName(idol, configFlag(config?.jav_idol_prefer_chinese_name))
        : `#${id}`
      items.push({
        key: `jav-idol-${id}`,
        label: zh(`女优: ${name}`, `Idol: ${name}`),
        onRemove: () =>
          updateJavFilters({
            javIdolIds: javIdolIds.filter((item) => Number(item) !== Number(id)),
          }),
      })
    })
    javTags.forEach((id) => {
      const name = javTagNameMap.get(id) || `#${id}`
      items.push({
        key: `jav-tag-${id}`,
        label: zh(`标签: ${name}`, `Tag: ${name}`),
        onRemove: () =>
          updateJavFilters({ javTags: javTags.filter((item) => Number(item) !== Number(id)) }),
      })
    })
    if (javStudioId !== null) {
      const name =
        javStudioName || (javStudioId === 0 ? zh('未知片商', 'Unknown studio') : `#${javStudioId}`)
      items.push({
        key: 'jav-studio',
        label: zh(`片商: ${name}`, `Studio: ${name}`),
        onRemove: () => updateJavFilters({ javStudioId: null, javStudioName: '' }),
      })
    }
    if (javSeriesId) {
      const name = javSeriesName || `#${javSeriesId}`
      items.push({
        key: 'jav-series',
        label: zh(`系列: ${name}`, `Series: ${name}`),
        onRemove: () => updateJavFilters({ javSeriesId: null, javSeriesName: '' }),
      })
    }
    if (javPrefix) {
      items.push({
        key: 'jav-prefix',
        label: zh(`番号: ${javPrefix}`, `Code: ${javPrefix}`),
        onRemove: () => updateJavFilters({ javPrefix: '' }),
      })
    }
    if (javSoloOnly) {
      items.push({
        key: 'jav-solo',
        label: zh('单体作品', 'Solo works'),
        onRemove: () => updateJavFilters({ javSoloOnly: false }),
      })
    }
    if (javFavoriteRatingEnabled) {
      const formatRating = (value) => {
        const rating = Number(value)
        return Number.isInteger(rating) ? String(rating) : rating.toFixed(1)
      }
      const range = `${formatRating(javFavoriteRatingMin)}–${formatRating(javFavoriteRatingMax)}`
      items.push({
        key: 'jav-favorite-rating',
        label: zh(`喜爱度: ${range}`, `Favorite rating: ${range}`),
        onRemove: () => updateJavFilters({ javFavoriteRatingEnabled: false }),
      })
    }
    if (javRandomMode) {
      items.push({
        key: 'jav-random',
        label: zh('随机', 'Random'),
        onRemove: () => updateJavFilters({ javRandomMode: false, javRandomSeed: null }),
      })
    }
    return items
  }, [
    config?.jav_idol_prefer_chinese_name,
    isJavMode,
    javFavoriteRatingEnabled,
    javFavoriteRatingMax,
    javFavoriteRatingMin,
    javIdolIds,
    javIdolOptionMap,
    javPrefix,
    javRandomMode,
    javSearchTerm,
    javSeriesId,
    javSeriesName,
    javSoloOnly,
    javStudioId,
    javStudioName,
    javTab,
    javTagNameMap,
    javTags,
    randomMode,
    searchTerm,
    selectedTags,
    updateJavFilters,
    updateVideoFilters,
  ])

  const handleClearActiveFilters = useCallback(() => {
    if (!isJavMode) {
      setSearchInput('')
      updateVideoFilters({
        selectedTags: [],
        searchTerm: '',
        randomMode: false,
        randomSeed: null,
      })
      return
    }
    setJavSearchInput('')
    const updates = { javSearchTerm: '' }
    if (javTab === 'list') {
      Object.assign(updates, {
        javIdolIds: [],
        javTags: [],
        javStudioId: null,
        javStudioName: '',
        javSeriesId: null,
        javSeriesName: '',
        javPrefix: '',
        javSoloOnly: false,
        javFavoriteRatingEnabled: false,
        javFavoriteRatingMin: 0.5,
        javFavoriteRatingMax: 5,
        javRandomMode: false,
        javRandomSeed: null,
      })
    } else if (javTab === 'idol') {
      Object.assign(updates, {
        idolPage: 1,
        idolProfileFilters: createDefaultIdolProfileFilters(),
      })
    } else if (javTab === 'studio') {
      Object.assign(updates, { studioPage: 1 })
    } else {
      Object.assign(updates, { seriesPage: 1 })
    }
    updateJavFilters(updates)
  }, [isJavMode, javTab, updateJavFilters, updateVideoFilters])

  const openVideoSettings = useCallback(() => {
    setVideoPageSizeInput(pageSize)
    setVideoSortInput(sortOrder)
    setVideoHideJavInput(videoHideJav)
    setVideoWaterfallDefaultInput(configFlag(config?.video_waterfall_default))
    setVideoSettingsOpen(true)
  }, [config?.video_waterfall_default, pageSize, sortOrder, videoHideJav])

  const openJavSettings = useCallback(() => {
    setJavPageSizeInput(javPageSize)
    setJavGridColumnsInput(javGridColumns)
    setJavTitleMaxRowsInput(javTitleMaxRows)
    setJavIdolTagMaxRowsInput(javIdolTagMaxRows)
    setJavTagMaxRowsInput(javTagMaxRows)
    setJavHideSeriesInput(configFlag(config?.jav_hide_series))
    setJavHideIdolsInput(configFlag(config?.jav_hide_idols))
    setJavHideTagsInput(configFlag(config?.jav_hide_tags))
    setJavHideActionsInput(configFlag(config?.jav_hide_actions))
    setJavFavoriteRatingShowFullInput(configFlag(config?.jav_favorite_rating_show_full, false))
    setJavWaterfallDefaultInput(configFlag(config?.jav_waterfall_default))
    setIdolPageSizeInput(idolPageSize)
    setIdolWaterfallDefaultInput(configFlag(config?.idol_waterfall_default))
    setStudioPageSizeInput(studioPageSize)
    setStudioWaterfallDefaultInput(configFlag(config?.studio_waterfall_default))
    setSeriesPageSizeInput(seriesPageSize)
    setSeriesWaterfallDefaultInput(configFlag(config?.series_waterfall_default))
    setJavSortInput(javSort)
    setJavSortRulesInput(javSortRules)
    setIdolSortInput(idolSort)
    setJavSettingsOpen(true)
  }, [
    javPageSize,
    javGridColumns,
    javTitleMaxRows,
    javIdolTagMaxRows,
    javTagMaxRows,
    config?.jav_hide_series,
    config?.jav_hide_idols,
    config?.jav_hide_tags,
    config?.jav_hide_actions,
    config?.jav_favorite_rating_show_full,
    config?.jav_waterfall_default,
    config?.idol_waterfall_default,
    config?.studio_waterfall_default,
    config?.series_waterfall_default,
    idolPageSize,
    studioPageSize,
    seriesPageSize,
    javSort,
    javSortRules,
    idolSort,
  ])

  const submitSearch = (e) => {
    e?.preventDefault()
    const nextSearch = (searchInput || '').trim()
    useStore.setState({
      viewMode: 'video',
      searchTerm: nextSearch,
      videoTempSort: '',
      page: 1,
    })
  }

  const submitJavSearch = (e) => {
    e?.preventDefault()
    useStore.setState({
      viewMode: 'jav',
      videoTempSort: '',
      javTempSort: '',
      idolTempSort: '',
      javSearchTerm: (javSearchInput || '').trim(),
      javPage: 1,
      idolPage: 1,
      studioPage: 1,
      seriesPage: 1,
    })
  }

  const handleSaveVideoSettings = async () => {
    const size = Math.max(1, parseInt(videoPageSizeInput, 10) || pageSize)
    const normalizedSort = normalizeVideoSort(videoSortInput)
    const waterfallDefault = Boolean(videoWaterfallDefaultInput)
    try {
      const cfg = await updateConfig({
        video_page_size: size,
        video_sort: normalizedSort,
        video_hide_jav: videoHideJavInput,
        video_waterfall_default: waterfallDefault,
      })
      const prevPage = page
      // ensure current page does not exceed last page after page size change
      const lastPage = Math.max(1, Math.ceil((total || 0) / size))
      const filterChanged = videoHideJavInput !== videoHideJav
      const nextPage = filterChanged ? 1 : prevPage > lastPage ? lastPage : prevPage

      if (waterfallModes.video !== waterfallDefault) {
        setWaterfallMode('video', waterfallDefault)
      }

      useStore.setState({
        pageSize: size,
        sortOrder: normalizedSort,
        videoHideJav: videoHideJavInput,
        videoTempSort: '',
        page: nextPage,
        randomMode: false,
        randomSeed: null,
        config: cfg,
      })
      setVideoSettingsOpen(false)
    } catch (err) {
      showCenterToast(getErrorMessage(err))
    }
  }

  const handleSaveJavSettings = async () => {
    const javSize = Math.max(1, parseInt(javPageSizeInput, 10) || javPageSize)
    const javGridColumnsRaw = parseInt(javGridColumnsInput, 10)
    const javColumns =
      Number.isFinite(javGridColumnsRaw) && javGridColumnsRaw > 0
        ? Math.min(javGridColumnsRaw, 12)
        : 0
    const javIdolTagRowsRaw = parseInt(javIdolTagMaxRowsInput, 10)
    const javIdolTagRows =
      Number.isFinite(javIdolTagRowsRaw) && javIdolTagRowsRaw > 0
        ? Math.min(javIdolTagRowsRaw, 12)
        : 0
    const javTitleRowsRaw = parseInt(javTitleMaxRowsInput, 10)
    const javTitleRows =
      Number.isFinite(javTitleRowsRaw) && javTitleRowsRaw >= 0 ? Math.min(javTitleRowsRaw, 12) : 2
    const javTagRowsRaw = parseInt(javTagMaxRowsInput, 10)
    const javTagRows =
      Number.isFinite(javTagRowsRaw) && javTagRowsRaw >= 0 ? Math.min(javTagRowsRaw, 12) : 2
    const idolSize = Math.max(1, parseInt(idolPageSizeInput, 10) || idolPageSize)
    const studioSize = Math.max(1, parseInt(studioPageSizeInput, 10) || studioPageSize)
    const seriesSize = Math.max(1, parseInt(seriesPageSizeInput, 10) || seriesPageSize)
    const normalizedSort = normalizeJavSort(javSortInput)
    const normalizedIdolSort = normalizeIdolSort(idolSortInput)
    const waterfallDefaults = {
      jav: Boolean(javWaterfallDefaultInput),
      idol: Boolean(idolWaterfallDefaultInput),
      studio: Boolean(studioWaterfallDefaultInput),
      series: Boolean(seriesWaterfallDefaultInput),
    }
    try {
      const cfg = await updateConfig({
        jav_page_size: javSize,
        jav_grid_columns: javColumns,
        jav_title_max_rows: javTitleRows,
        jav_idol_tag_max_rows: javIdolTagRows,
        jav_tag_max_rows: javTagRows,
        jav_hide_series: Boolean(javHideSeriesInput),
        jav_hide_idols: Boolean(javHideIdolsInput),
        jav_hide_tags: Boolean(javHideTagsInput),
        jav_hide_actions: Boolean(javHideActionsInput),
        jav_favorite_rating_show_full: Boolean(javFavoriteRatingShowFullInput),
        jav_waterfall_default: waterfallDefaults.jav,
        idol_page_size: idolSize,
        idol_waterfall_default: waterfallDefaults.idol,
        studio_page_size: studioSize,
        studio_waterfall_default: waterfallDefaults.studio,
        series_page_size: seriesSize,
        series_waterfall_default: waterfallDefaults.series,
        jav_sort: normalizedSort,
        jav_sort_rules: javSortRulesConfig(javSortRulesInput),
        idol_sort: normalizedIdolSort,
        jav_idol_prefer_chinese_name: Boolean(javIdolPreferChineseNameInput),
        jav_tag_show_simplified: Boolean(javTagShowSimplifiedInput),
      })
      const prevJavPage = javPage
      const prevIdolPage = idolPage
      const prevStudioPage = studioPage
      const prevSeriesPage = seriesPage
      const javLast = Math.max(1, Math.ceil((javTotal || 0) / javSize))
      const idolLast = Math.max(1, Math.ceil((idolTotal || 0) / idolSize))
      const studioLast = Math.max(1, Math.ceil((studioTotal || 0) / studioSize))
      const seriesLast = Math.max(1, Math.ceil((seriesTotal || 0) / seriesSize))
      Object.entries(waterfallDefaults).forEach(([key, enabled]) => {
        if (waterfallModes[key] !== enabled) {
          setWaterfallMode(key, enabled)
        }
      })
      useStore.setState({
        javPageSize: javSize,
        javGridColumns: javColumns,
        javTitleMaxRows: javTitleRows,
        javIdolTagMaxRows: javIdolTagRows,
        javTagMaxRows: javTagRows,
        idolPageSize: idolSize,
        studioPageSize: studioSize,
        seriesPageSize: seriesSize,
        javSort: normalizedSort,
        javSortRules: normalizeJavSortRules(cfg?.jav_sort_rules),
        javTempSort: '',
        idolSort: normalizedIdolSort,
        idolTempSort: '',
        javPage: Math.min(prevJavPage, javLast),
        idolPage: Math.min(prevIdolPage, idolLast),
        studioPage: Math.min(prevStudioPage, studioLast),
        seriesPage: Math.min(prevSeriesPage, seriesLast),
        javRandomMode: false,
        javRandomSeed: null,
        config: cfg,
      })
      setJavSettingsOpen(false)
    } catch (err) {
      showCenterToast(getErrorMessage(err))
    }
  }

  useEffect(() => {
    if (videoSettingsOpen) {
      setVideoPageSizeInput(pageSize)
      setVideoSortInput(sortOrder)
      setVideoHideJavInput(videoHideJav)
      setVideoWaterfallDefaultInput(configFlag(config?.video_waterfall_default))
    }
  }, [videoSettingsOpen, config?.video_waterfall_default, pageSize, sortOrder, videoHideJav])

  useEffect(() => {
    if (javSettingsOpen) {
      setJavPageSizeInput(javPageSize)
      setJavGridColumnsInput(javGridColumns)
      setJavTitleMaxRowsInput(javTitleMaxRows)
      setJavIdolTagMaxRowsInput(javIdolTagMaxRows)
      setJavTagMaxRowsInput(javTagMaxRows)
      setJavHideSeriesInput(configFlag(config?.jav_hide_series))
      setJavHideIdolsInput(configFlag(config?.jav_hide_idols))
      setJavHideTagsInput(configFlag(config?.jav_hide_tags))
      setJavHideActionsInput(configFlag(config?.jav_hide_actions))
      setJavFavoriteRatingShowFullInput(configFlag(config?.jav_favorite_rating_show_full, false))
      setJavWaterfallDefaultInput(configFlag(config?.jav_waterfall_default))
      setIdolPageSizeInput(idolPageSize)
      setIdolWaterfallDefaultInput(configFlag(config?.idol_waterfall_default))
      setStudioPageSizeInput(studioPageSize)
      setStudioWaterfallDefaultInput(configFlag(config?.studio_waterfall_default))
      setSeriesPageSizeInput(seriesPageSize)
      setSeriesWaterfallDefaultInput(configFlag(config?.series_waterfall_default))
      setJavSortInput(javSort)
      setJavSortRulesInput(javSortRules)
      setIdolSortInput(idolSort)
      setJavIdolPreferChineseNameInput(configFlag(config?.jav_idol_prefer_chinese_name))
      setJavTagShowSimplifiedInput(configFlag(config?.jav_tag_show_simplified))
    }
  }, [
    javSettingsOpen,
    config?.jav_idol_prefer_chinese_name,
    config?.jav_tag_show_simplified,
    config?.jav_hide_series,
    config?.jav_hide_idols,
    config?.jav_hide_tags,
    config?.jav_hide_actions,
    config?.jav_favorite_rating_show_full,
    config?.jav_waterfall_default,
    config?.idol_waterfall_default,
    config?.studio_waterfall_default,
    config?.series_waterfall_default,
    javPageSize,
    javGridColumns,
    javTitleMaxRows,
    javIdolTagMaxRows,
    javTagMaxRows,
    idolPageSize,
    studioPageSize,
    seriesPageSize,
    javSort,
    javSortRules,
    idolSort,
  ])

  useEffect(() => {
    if (selectedCount !== 0) return
    setSelectionOpsOpen(false)
    setSelectionTagsOpen(false)
    setSelectionJavTagsOpen(false)
    setSelectionTagAction('add')
    setSelectionTagChoices([])
    setSelectionJavTagChoices([])
    setSelectionJavTagSaving(false)
  }, [selectedCount])

  const handleRemoveSelectedVideo = useCallback((key) => {
    if (!key) return
    useStore.setState((state) => {
      const normalizedKey = String(key)
      const nextIds = new Set(state.selectedVideoIds || [])
      const nextMeta = { ...(state.selectedVideoMeta || {}) }
      nextIds.delete(normalizedKey)
      delete nextMeta[normalizedKey]
      return {
        selectedVideoIds: nextIds,
        selectedVideoMeta: nextMeta,
      }
    })
  }, [])

  const handlePlaySelection = useCallback(async () => {
    if (selectionPlaying || !mpvEnabled) return
    const targets = selectedList
      .map((item) => {
        const videoId = Number(item?.video_id || item?.video?.id)
        const locationId = Number(item?.location_id || item?.video?.location_id || 0)
        if (!Number.isFinite(videoId) || videoId <= 0) return null
        return {
          video_id: videoId,
          location_id: Number.isFinite(locationId) && locationId > 0 ? locationId : 0,
          title: item?.label || item?.video?.filename || `Video #${videoId}`,
        }
      })
      .filter(Boolean)
    if (targets.length !== selectedList.length || targets.length === 0) {
      showCenterToast(
        zh(
          '无法播放：部分所选视频缺少文件信息',
          'Cannot play: some selected videos are missing file information'
        )
      )
      return
    }
    if (!confirmLargeMPVPlaylist(targets.length)) return

    setSelectionPlaying(true)
    try {
      const result = await playVideoPlaylist(targets)
      const count = Number(result?.count) || targets.length
      setSelectionOpsOpen(false)
      showToast(
        zh(`已将 ${count} 个视频加入 MPV 播放列表`, `Added ${count} videos to the MPV playlist`)
      )
    } catch (err) {
      console.error(zh('加入 MPV 播放列表失败', 'Failed to add to MPV playlist'), err)
      showCenterToast(getErrorMessage(err))
    } finally {
      setSelectionPlaying(false)
    }
  }, [mpvEnabled, selectedList, selectionPlaying, showCenterToast, showToast])

  const handleDeleteSelection = useCallback(async () => {
    if (selectionDeleting) return
    const targets = selectedList
      .map((item) => {
        const videoId = Number(item?.video_id || item?.video?.id)
        const locationId = Number(item?.location_id || item?.video?.location_id)
        if (
          !Number.isFinite(videoId) ||
          videoId <= 0 ||
          !Number.isFinite(locationId) ||
          locationId <= 0
        ) {
          return null
        }
        return {
          key: item.id,
          label: item.label || `#${videoId}`,
          videoId,
          locationId,
        }
      })
      .filter(Boolean)
    const skipped = Math.max(0, selectedList.length - targets.length)
    if (targets.length === 0) {
      showCenterToast(
        zh('无法删除：所选视频缺少文件位置', 'Cannot delete: selected videos have no file location')
      )
      return
    }
    const confirmMessage =
      skipped > 0
        ? zh(
            `确定删除 ${targets.length} 个可删除视频文件吗？${skipped} 项缺少文件位置，将跳过。`,
            `Delete ${targets.length} deletable video files? ${skipped} selected items have no file location and will be skipped.`
          )
        : zh(
            `确定删除所选 ${targets.length} 个视频文件吗？`,
            `Delete the selected ${targets.length} video files?`
          )
    if (!window.confirm(confirmMessage)) return

    setSelectionDeleting(true)
    const deletedKeys = []
    const failed = []
    try {
      for (const target of targets) {
        try {
          await deleteVideoLocation(target.videoId, target.locationId)
          deletedKeys.push(target.key)
        } catch (err) {
          failed.push({ target, err })
        }
      }

      if (deletedKeys.length > 0) {
        const deletedSet = new Set(deletedKeys)
        useStore.setState((state) => {
          const nextIds = new Set(state.selectedVideoIds || [])
          const nextMeta = { ...(state.selectedVideoMeta || {}) }
          deletedSet.forEach((key) => {
            nextIds.delete(key)
            delete nextMeta[key]
          })
          const nextVideos = Array.isArray(state.videos)
            ? state.videos.filter((item) => !deletedSet.has(videoSelectionKey(item)))
            : state.videos
          return {
            videos: nextVideos,
            selectedVideoIds: nextIds,
            selectedVideoMeta: nextMeta,
            total: Math.max(0, Number(state.total || 0) - deletedKeys.length),
          }
        })
        await loadVideos({ force: true })
      }

      if (failed.length > 0) {
        console.error('batch delete videos failed', failed)
        showCenterToast(getErrorMessage(failed[0]?.err))
      } else if (skipped > 0) {
        showCenterToast(
          zh(
            `已删除 ${deletedKeys.length} 个视频，跳过 ${skipped} 项`,
            `Deleted ${deletedKeys.length} videos, skipped ${skipped} items`
          )
        )
      } else {
        setSelectionOpsOpen(false)
        showToast(zh(`已删除 ${deletedKeys.length} 个视频`, `Deleted ${deletedKeys.length} videos`))
      }
    } finally {
      setSelectionDeleting(false)
    }
  }, [loadVideos, selectedList, selectionDeleting, showCenterToast, showToast])

  const openTagEditor = useCallback(
    (videoId) => {
      setTagPickerFor(videoId)
      const target = videos.find((v) => v.id === videoId)
      const initial = Array.isArray(target?.tags) ? target.tags.map((t) => String(t.id)) : []
      setTagPickerSelected(initial)
    },
    [videos]
  )

  const tagPickerExisting = useMemo(() => {
    if (!tagPickerFor) return []
    const target = videos.find((v) => v.id === tagPickerFor)
    return Array.isArray(target?.tags) ? target.tags.map((t) => String(t.id)) : []
  }, [tagPickerFor, videos])

  const tagPickerDirty = useMemo(() => {
    if (!tagPickerFor) return false
    const current = new Set(tagPickerExisting)
    const selected = new Set(tagPickerSelected)
    if (current.size !== selected.size) return true
    for (const id of current) {
      if (!selected.has(id)) return true
    }
    return false
  }, [tagPickerExisting, tagPickerFor, tagPickerSelected])

  const handleApplyTags = async () => {
    if (!tagPickerFor) {
      setTagPickerFor(null)
      setTagPickerSelected([])
      return
    }
    const selectedIds = tagPickerSelected.map((t) => Number(t)).filter(Boolean)
    if (!tagPickerDirty) {
      setTagPickerFor(null)
      setTagPickerSelected([])
      return
    }
    try {
      await replaceTagsForVideos([tagPickerFor], selectedIds)
      useStore.setState((state) => {
        if (!Array.isArray(state.videos)) return {}
        const tagLookup = new Map((tags || []).map((tag) => [tag.id, tag]))
        const nextVideos = state.videos.map((video) => {
          if (video.id !== tagPickerFor) return video
          const nextTags = selectedIds.map((id) => tagLookup.get(id)).filter(Boolean)
          return { ...video, tags: nextTags }
        })
        return { videos: nextVideos }
      })
    } catch (err) {
      console.error('update tags failed', err)
      showCenterToast(getErrorMessage(err))
    } finally {
      setTagPickerFor(null)
      setTagPickerSelected([])
    }
  }

  const handleTagPickerClose = () => {
    setTagPickerFor(null)
    setTagPickerSelected([])
  }

  const handleTagPickerToggle = (tagId, checked) => {
    setTagPickerSelected((prev) => {
      const set = new Set(prev)
      if (checked) set.add(String(tagId))
      else set.delete(String(tagId))
      return Array.from(set)
    })
  }

  const handleSelectionTagsClose = () => {
    setSelectionTagsOpen(false)
    setSelectionTagAction('add')
    setSelectionTagChoices([])
  }

  const handleSelectionTagChoiceToggle = (tagId, checked) => {
    setSelectionTagChoices((prev) => {
      const set = new Set(prev)
      if (checked) set.add(String(tagId))
      else set.delete(String(tagId))
      return Array.from(set)
    })
  }

  const handleApplySelectionTags = async () => {
    const ids = selectionTagChoices.map((t) => Number(t)).filter(Boolean)
    const selectedKeys = Array.from(selectedVideoIds)
    const vidIds = Array.from(
      new Set(
        selectedKeys
          .map((key) => {
            const meta = selectedVideoMeta?.[key]
            const raw = meta && typeof meta === 'object' ? meta.video_id : key
            const parsed = Number(raw)
            return Number.isFinite(parsed) && parsed > 0 ? parsed : null
          })
          .filter(Boolean)
      )
    )
    try {
      if (selectionTagAction === 'remove') {
        await Promise.all(ids.map((tid) => removeTagFromVideos(tid, vidIds)))
        const removedIds = new Set(ids)
        useStore.setState(({ videos }) => {
          const next = videos.map((v) => {
            if (!vidIds.includes(v.id)) return v
            const existing = Array.isArray(v.tags) ? v.tags : []
            const nextTags = existing.filter((tag) => !removedIds.has(tag.id))
            return nextTags.length === existing.length ? v : { ...v, tags: nextTags }
          })
          return { videos: next }
        })
      } else {
        await Promise.all(ids.map((tid) => addTagToVideos(tid, vidIds)))
        const addedTags = tags.filter((t) => ids.includes(t.id))
        useStore.setState(({ videos }) => {
          const next = videos.map((v) => {
            if (!vidIds.includes(v.id)) return v
            const existing = Array.isArray(v.tags) ? v.tags : []
            const mergedById = new Map()
            for (const tag of existing) mergedById.set(tag.id, tag)
            for (const tag of addedTags) mergedById.set(tag.id, tag)
            return { ...v, tags: Array.from(mergedById.values()) }
          })
          return { videos: next }
        })
      }
    } catch (err) {
      console.error(`${selectionTagAction} tags for selection failed`, err)
      showCenterToast(getErrorMessage(err))
    } finally {
      setSelectionTagsOpen(false)
      setSelectionTagAction('add')
      setSelectionTagChoices([])
      setSelectionOpsOpen(false)
      clearSelection()
    }
  }

  const handleSelectionJavTagsClose = () => {
    if (selectionJavTagSaving) return
    setSelectionJavTagsOpen(false)
    setSelectionJavTagChoices([])
  }

  const handleSelectionJavTagChoiceToggle = (tagId, checked) => {
    setSelectionJavTagChoices((current) => {
      const next = new Set(current)
      if (checked) next.add(String(tagId))
      else next.delete(String(tagId))
      return Array.from(next)
    })
  }

  const handleApplySelectionJavTags = async () => {
    const tagIds = selectionJavTagChoices
      .map((tagId) => Number(tagId))
      .filter((tagId) => Number.isFinite(tagId) && tagId > 0)
    if (tagIds.length === 0 || selectedJavIds.length === 0) return

    setSelectionJavTagSaving(true)
    try {
      await Promise.all(tagIds.map((tagId) => addJavTagToJavs(tagId, selectedJavIds)))
      await loadJavTags({ force: true })
      const skipped = Math.max(0, selectedCount - selectedJavVideoCount)
      showToast(
        skipped > 0
          ? zh(
              `已给 ${selectedJavIds.length} 个 JAV 添加标签，跳过 ${skipped} 个未关联 JAV 的视频`,
              `Added tags to ${selectedJavIds.length} JAV items; skipped ${skipped} videos without JAV links`
            )
          : zh(
              `已给 ${selectedJavIds.length} 个 JAV 添加标签`,
              `Added tags to ${selectedJavIds.length} JAV items`
            )
      )
      setSelectionJavTagsOpen(false)
      setSelectionJavTagChoices([])
      setSelectionOpsOpen(false)
      clearSelection()
    } catch (err) {
      console.error('add JAV tags for selection failed', err)
      showCenterToast(getErrorMessage(err))
    } finally {
      setSelectionJavTagSaving(false)
    }
  }

  const handleHomeClick = () => {
    setTagModalOpen(false)
    setVideoSettingsOpen(false)
    setJavSettingsOpen(false)
    setGlobalSettingsOpen(false)
    if (isJavMode) {
      const updates = {
        viewMode: 'jav',
        javTab,
        videoTempSort: '',
        javTempSort: '',
        idolTempSort: '',
        javRandomMode: false,
        javRandomSeed: null,
        javIdolIds: [],
        javTags: [],
        javStudioId: null,
        javStudioName: '',
        javSeriesId: null,
        javSeriesName: '',
        javPrefix: '',
        javSoloOnly: false,
        javFavoriteRatingEnabled: false,
        javFavoriteRatingMin: 0.5,
        javFavoriteRatingMax: 5,
        idolProfileFilters: createDefaultIdolProfileFilters(),
        javSearchTerm: '',
        javPage: 1,
        idolPage: 1,
        studioPage: 1,
        seriesPage: 1,
      }
      if (javTab === 'idol') updates.idolFavoriteGroupId = null
      else if (javTab === 'studio') updates.studioFavoriteGroupId = null
      else if (javTab === 'series') updates.seriesFavoriteGroupId = null
      else updates.javFavoriteGroupId = null
      useStore.setState(updates)
      setJavSearchInput('')
      forceReloadJavByTab(javTab)
    } else {
      useStore.setState({
        viewMode: 'video',
        videoTempSort: '',
        randomMode: false,
        randomSeed: null,
        selectedTags: [],
        searchTerm: '',
        page: 1,
      })
      setSearchInput('')
      forceReloadVideos()
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleSwitchJavTab = (tab) => {
    const nextTab =
      tab === 'idol'
        ? 'idol'
        : tab === 'studio'
          ? 'studio'
          : tab === 'series'
            ? 'series'
            : tab === 'download'
              ? 'download'
              : 'list'
    const shouldResetRandomList = nextTab === 'list' && javRandomMode
    const shouldClearSearch = nextTab === 'list' || nextTab !== javTab || shouldResetRandomList
    const nextRandomMode = nextTab === 'list' && !shouldResetRandomList ? javRandomMode : false
    const nextRandomSeed = nextTab === 'list' && !shouldResetRandomList ? javRandomSeed : null
    const updates = {
      viewMode: 'jav',
      videoTempSort: '',
      javTab: nextTab,
      javTempSort: '',
      idolTempSort: '',
      javIdolIds: [],
      javTags: [],
      javStudioId: null,
      javStudioName: '',
      javSeriesId: null,
      javSeriesName: '',
      javPrefix: '',
      javSoloOnly: false,
      javFavoriteRatingEnabled: false,
      javFavoriteRatingMin: 0.5,
      javFavoriteRatingMax: 5,
      idolFavoriteGroupId: null,
      idolProfileFilters: createDefaultIdolProfileFilters(),
      javRandomMode: nextRandomMode,
      javRandomSeed: nextRandomSeed,
      javPage: 1,
      idolPage: 1,
      studioPage: 1,
      seriesPage: 1,
    }
    if (shouldClearSearch) {
      updates.javSearchTerm = ''
      setJavSearchInput('')
    }
    saveScrollBeforeUrlStateChange()
    useStore.setState(updates)
    forceReloadJavByTab(nextTab)
  }

  const handleSelectSideTab = (tab) => {
    if (tab === 'video') {
      if (!isJavMode) return
      saveScrollBeforeUrlStateChange()
      useStore.setState({ viewMode: 'video', javTempSort: '', idolTempSort: '' })
      forceReloadVideos()
      return
    }
    const nextTab =
      tab === 'idol'
        ? 'idol'
        : tab === 'studio'
          ? 'studio'
          : tab === 'series'
            ? 'series'
            : tab === 'download'
              ? 'download'
              : 'list'
    if (isJavMode && nextTab === javTab) return
    handleSwitchJavTab(nextTab)
  }

  const handleSelectIdol = (idol) => {
    const id = Number(idol?.id)
    if (!Number.isFinite(id) || id <= 0) return
    saveScrollBeforeUrlStateChange()
    useStore.setState({
      viewMode: 'jav',
      videoTempSort: '',
      javTab: 'list',
      javTempSort: '',
      idolTempSort: '',
      javRandomMode: false,
      javRandomSeed: null,
      javIdolIds: [id],
      javTags: [],
      javStudioId: null,
      javStudioName: '',
      javSeriesId: null,
      javSeriesName: '',
      javSoloOnly: false,
      javFavoriteRatingEnabled: false,
      javFavoriteRatingMin: 0.5,
      javFavoriteRatingMax: 5,
      idolFavoriteGroupId: null,
      idolProfileFilters: createDefaultIdolProfileFilters(),
      javSearchTerm: '',
      javPage: 1,
      idolPage: 1,
      studioPage: 1,
      seriesPage: 1,
    })
  }

  const handleOpenFavoriteModal = useCallback(
    async (entityType, item) => {
      const type = ['jav', 'idol', 'studio', 'series'].includes(entityType) ? entityType : 'idol'
      const id = Number(item?.id)
      if (!Number.isFinite(id) || id <= 0) return
      setFavoriteModalEntityType(type)
      setIdolFavoriteModalItem(item)
      setIdolFavoriteSelectedIds([])
      setIdolFavoriteModalError('')
      setIdolFavoriteModalOpen(true)
      setIdolFavoriteModalLoading(true)
      try {
        const [selectedIds] = await Promise.all([
          fetchJavFavoriteSelection(type, id),
          loadJavFavoriteGroups(type, { force: true }),
        ])
        setIdolFavoriteSelectedIds(
          (selectedIds || []).map((value) => Number(value)).filter((value) => value > 0)
        )
      } catch (err) {
        setIdolFavoriteModalError(getErrorMessage(err))
      } finally {
        setIdolFavoriteModalLoading(false)
      }
    },
    [loadJavFavoriteGroups]
  )

  const handleOpenIdolFavoriteModal = useCallback(
    (idol) => handleOpenFavoriteModal('idol', idol),
    [handleOpenFavoriteModal]
  )

  const handleCloseIdolFavoriteModal = useCallback(() => {
    if (idolFavoriteModalSaving) return
    setIdolFavoriteModalOpen(false)
    setIdolFavoriteModalItem(null)
    setFavoriteModalEntityType('idol')
    setIdolFavoriteSelectedIds([])
    setIdolFavoriteModalError('')
    setIdolFavoriteModalLoading(false)
  }, [idolFavoriteModalSaving])

  const reloadFavoriteData = useCallback(
    async (entityType) => {
      const type = ['jav', 'idol', 'studio', 'series'].includes(entityType) ? entityType : 'idol'
      const tabByType = { jav: 'list', idol: 'idol', studio: 'studio', series: 'series' }
      const reloadByType = {
        jav: loadJavs,
        idol: loadJavIdols,
        studio: loadJavStudios,
        series: loadJavSeries,
      }
      const shouldReloadCurrentList = isJavMode && javTab === tabByType[type]
      const reloadCurrentList = shouldReloadCurrentList ? reloadByType[type] : null
      await Promise.all([
        loadJavFavoriteGroups(type, { force: true }),
        reloadCurrentList ? reloadCurrentList({ force: true }) : Promise.resolve(),
      ])
    },
    [
      isJavMode,
      javTab,
      loadJavFavoriteGroups,
      loadJavIdols,
      loadJavSeries,
      loadJavStudios,
      loadJavs,
    ]
  )

  const activeFavoriteGroupId = useCallback(
    (entityType) => {
      switch (entityType) {
        case 'jav':
          return javFavoriteGroupId
        case 'studio':
          return studioFavoriteGroupId
        case 'series':
          return seriesFavoriteGroupId
        case 'idol':
        default:
          return idolFavoriteGroupId
      }
    },
    [idolFavoriteGroupId, javFavoriteGroupId, seriesFavoriteGroupId, studioFavoriteGroupId]
  )

  const setActiveFavoriteGroupId = useCallback(
    (entityType, groupId) => {
      switch (entityType) {
        case 'jav':
          setJavFavoriteGroupId(groupId)
          break
        case 'studio':
          setStudioFavoriteGroupId(groupId)
          break
        case 'series':
          setSeriesFavoriteGroupId(groupId)
          break
        case 'idol':
        default:
          setIdolFavoriteGroupId(groupId)
          break
      }
    },
    [
      setIdolFavoriteGroupId,
      setJavFavoriteGroupId,
      setSeriesFavoriteGroupId,
      setStudioFavoriteGroupId,
    ]
  )

  const handleFavoriteGroupSelect = useCallback(
    (entityType, groupId) => {
      const type = ['jav', 'idol', 'studio', 'series'].includes(entityType) ? entityType : 'idol'
      const parsedGroupId = Number(groupId)
      const nextGroupId = Number.isFinite(parsedGroupId) && parsedGroupId > 0 ? parsedGroupId : null
      const parsedCurrentGroupId = Number(activeFavoriteGroupId(type))
      const currentGroupId =
        Number.isFinite(parsedCurrentGroupId) && parsedCurrentGroupId > 0
          ? parsedCurrentGroupId
          : null
      if (currentGroupId === nextGroupId) return

      saveScrollBeforeUrlStateChange()
      setJavSearchInput('')
      useStore.setState({
        javSearchTerm: '',
        javIdolIds: [],
        javTags: [],
        javStudioId: null,
        javStudioName: '',
        javSeriesId: null,
        javSeriesName: '',
        javPrefix: '',
        javSoloOnly: false,
        javFavoriteRatingEnabled: false,
        javFavoriteRatingMin: 0.5,
        javFavoriteRatingMax: 5,
        idolProfileFilters: createDefaultIdolProfileFilters(),
        javRandomMode: false,
        javRandomSeed: null,
      })
      setActiveFavoriteGroupId(type, nextGroupId)
    },
    [activeFavoriteGroupId, saveScrollBeforeUrlStateChange, setActiveFavoriteGroupId]
  )

  const patchFavoriteCountInCurrentList = useCallback(
    (entityType, entityID, groupIds) => {
      const type = ['jav', 'idol', 'studio', 'series'].includes(entityType) ? entityType : 'idol'
      const id = Number(entityID)
      if (!Number.isFinite(id) || id <= 0) return

      const nextGroupIds = Array.from(
        new Set((groupIds || []).map((value) => Number(value)).filter((value) => value > 0))
      )
      const nextGroupSet = new Set(nextGroupIds)
      const activeGroupID = Number(activeFavoriteGroupId(type))
      const removeFromCurrentList =
        Number.isFinite(activeGroupID) && activeGroupID > 0
          ? !nextGroupSet.has(activeGroupID)
          : false
      const listKey =
        type === 'jav'
          ? 'javItems'
          : type === 'studio'
            ? 'studioItems'
            : type === 'series'
              ? 'seriesItems'
              : 'idolItems'
      const totalKey =
        type === 'jav'
          ? 'javTotal'
          : type === 'studio'
            ? 'studioTotal'
            : type === 'series'
              ? 'seriesTotal'
              : 'idolTotal'

      useStore.setState((state) => {
        const items = Array.isArray(state[listKey]) ? state[listKey] : []
        let changed = false
        const nextItems = removeFromCurrentList
          ? items.filter((item) => {
              const keep = Number(item?.id) !== id
              if (!keep) changed = true
              return keep
            })
          : items.map((item) => {
              if (Number(item?.id) !== id) return item
              changed = true
              return { ...item, favorite_count: nextGroupIds.length }
            })
        if (!changed) return {}
        return {
          [listKey]: nextItems,
          ...(removeFromCurrentList
            ? { [totalKey]: Math.max(0, Number(state[totalKey] || 0) - 1) }
            : {}),
        }
      })
    },
    [activeFavoriteGroupId]
  )

  const handleCreateFavoriteGroup = useCallback(
    async (name, entityType = favoriteModalEntityType) => {
      const type = ['jav', 'idol', 'studio', 'series'].includes(entityType) ? entityType : 'idol'
      const group = await createJavFavoriteGroup(type, name)
      useStore.setState((state) => {
        const current = Array.isArray(state.favoriteGroupsByType?.[type])
          ? state.favoriteGroupsByType[type]
          : []
        const exists = current.some((item) => Number(item?.id) === Number(group?.id))
        const next = exists ? current : [...current, { ...group, count: group?.count || 0 }]
        next.sort((a, b) => {
          const orderA = Number(a?.sort_order) || 0
          const orderB = Number(b?.sort_order) || 0
          if (orderA !== orderB) return orderA - orderB
          return String(a?.name || '').localeCompare(String(b?.name || ''))
        })
        return {
          favoriteGroupsByType: { ...(state.favoriteGroupsByType || {}), [type]: next },
        }
      })
      return group
    },
    [favoriteModalEntityType]
  )

  const handleSaveFavoriteGroups = useCallback(
    async (groupIds) => {
      const entityID = Number(idolFavoriteModalItem?.id)
      const type = favoriteModalEntityType
      if (!Number.isFinite(entityID) || entityID <= 0) return
      setIdolFavoriteModalSaving(true)
      setIdolFavoriteModalError('')
      try {
        await replaceJavFavoriteGroups(type, entityID, groupIds)
        patchFavoriteCountInCurrentList(type, entityID, groupIds)
        setIdolFavoriteModalOpen(false)
        setIdolFavoriteModalItem(null)
        setFavoriteModalEntityType('idol')
        setIdolFavoriteSelectedIds([])
        await loadJavFavoriteGroups(type, { force: true })
      } catch (err) {
        setIdolFavoriteModalError(getErrorMessage(err))
      } finally {
        setIdolFavoriteModalSaving(false)
      }
    },
    [
      favoriteModalEntityType,
      idolFavoriteModalItem,
      loadJavFavoriteGroups,
      patchFavoriteCountInCurrentList,
    ]
  )

  const handleSaveIdolFavoriteGroups = handleSaveFavoriteGroups

  const handleReorderIdolFavoriteGroups = useCallback(
    async (groupIds) => {
      const type = favoriteManageEntityType || 'idol'
      await reorderJavFavoriteGroups(type, groupIds)
      await loadJavFavoriteGroups(type, { force: true })
    },
    [favoriteManageEntityType, loadJavFavoriteGroups]
  )

  const handleRenameIdolFavoriteGroup = useCallback(
    async (groupId, name) => {
      const type = favoriteManageEntityType || 'idol'
      await renameJavFavoriteGroup(type, groupId, name)
      useStore.setState((state) => ({
        favoriteGroupsByType: {
          ...(state.favoriteGroupsByType || {}),
          [type]: (state.favoriteGroupsByType?.[type] || []).map((group) =>
            Number(group.id) === Number(groupId) ? { ...group, name } : group
          ),
        },
      }))
      await loadJavFavoriteGroups(type, { force: true })
    },
    [favoriteManageEntityType, loadJavFavoriteGroups]
  )

  const handleDeleteIdolFavoriteGroup = useCallback(
    async (groupId) => {
      const type = favoriteManageEntityType || 'idol'
      await deleteJavFavoriteGroup(type, groupId)
      if (Number(activeFavoriteGroupId(type)) === Number(groupId)) {
        setActiveFavoriteGroupId(type, null)
      }
      await reloadFavoriteData(type)
    },
    [favoriteManageEntityType, activeFavoriteGroupId, reloadFavoriteData, setActiveFavoriteGroupId]
  )

  const handleLoadIdolFavoriteGroupIdols = useCallback(
    (groupId) => {
      const type = favoriteManageEntityType || 'idol'
      return fetchJavFavoriteGroupItems(type, groupId)
    },
    [favoriteManageEntityType]
  )

  const handleReorderIdolFavoriteGroupIdols = useCallback(
    async (groupId, idolIds) => {
      const type = favoriteManageEntityType || 'idol'
      await reorderJavFavoriteGroupItems(type, groupId, idolIds)
      if (Number(activeFavoriteGroupId(type)) === Number(groupId)) await reloadFavoriteData(type)
    },
    [favoriteManageEntityType, activeFavoriteGroupId, reloadFavoriteData]
  )

  const handleRemoveIdolFavoriteGroupIdols = useCallback(
    async (groupId, idolIds) => {
      const type = favoriteManageEntityType || 'idol'
      await removeJavFavoriteGroupItems(type, groupId, idolIds)
      await reloadFavoriteData(type)
    },
    [favoriteManageEntityType, reloadFavoriteData]
  )

  const handleJavIdolClick = useCallback(
    (idol) => {
      const id = Number(idol?.id ?? idol)
      if (!Number.isFinite(id) || id <= 0) return
      saveScrollBeforeUrlStateChange()
      useStore.setState({
        viewMode: 'jav',
        videoTempSort: '',
        javTab: 'list',
        javTempSort: '',
        idolTempSort: '',
        javRandomMode: false,
        javRandomSeed: null,
        javIdolIds: [id],
        javTags: [],
        javStudioId: null,
        javStudioName: '',
        javSeriesId: null,
        javSeriesName: '',
        javSoloOnly: false,
        javFavoriteRatingEnabled: false,
        javFavoriteRatingMin: 0.5,
        javFavoriteRatingMax: 5,
        idolFavoriteGroupId: null,
        javSearchTerm: '',
        javPage: 1,
        idolPage: 1,
        studioPage: 1,
        seriesPage: 1,
      })
    },
    [saveScrollBeforeUrlStateChange]
  )

  const handleSelectStudio = (studio) => {
    const id = Number(studio?.id)
    if (!Number.isFinite(id) || id <= 0) return
    saveScrollBeforeUrlStateChange()
    useStore.setState({
      viewMode: 'jav',
      videoTempSort: '',
      javTab: 'list',
      javTempSort: '',
      idolTempSort: '',
      javRandomMode: false,
      javRandomSeed: null,
      javIdolIds: [],
      javTags: [],
      javStudioId: id,
      javStudioName: String(studio?.name || '').trim(),
      javSeriesId: null,
      javSeriesName: '',
      javPrefix: '',
      javSoloOnly: false,
      javFavoriteRatingEnabled: false,
      javFavoriteRatingMin: 0.5,
      javFavoriteRatingMax: 5,
      idolFavoriteGroupId: null,
      javSearchTerm: '',
      javPage: 1,
      idolPage: 1,
      studioPage: 1,
      seriesPage: 1,
    })
  }

  const handleSelectSeries = (series) => {
    const id = Number(series?.id)
    if (!Number.isFinite(id) || id <= 0) return
    saveScrollBeforeUrlStateChange()
    useStore.setState({
      viewMode: 'jav',
      videoTempSort: '',
      javTab: 'list',
      javTempSort: '',
      idolTempSort: '',
      javRandomMode: false,
      javRandomSeed: null,
      javIdolIds: [],
      javTags: [],
      javStudioId: null,
      javStudioName: '',
      javSeriesId: id,
      javSeriesName: String(series?.name || '').trim(),
      javPrefix: '',
      javSoloOnly: false,
      javFavoriteRatingEnabled: false,
      javFavoriteRatingMin: 0.5,
      javFavoriteRatingMax: 5,
      idolFavoriteGroupId: null,
      javSearchTerm: '',
      javPage: 1,
      idolPage: 1,
      studioPage: 1,
      seriesPage: 1,
    })
  }

  const handleSelectJavPrefix = (prefixItem) => {
    const prefix = String(prefixItem?.prefix || prefixItem || '')
      .trim()
      .toUpperCase()
    if (!prefix) return
    const shouldIncludeStudio =
      typeof prefixItem === 'object' && prefixItem !== null && prefixItem.include_studio_filter
    const studioId = shouldIncludeStudio ? Number(prefixItem?.studio_id) : null
    const hasStudio = Number.isFinite(studioId) && studioId > 0
    saveScrollBeforeUrlStateChange()
    useStore.setState({
      viewMode: 'jav',
      videoTempSort: '',
      javTab: 'list',
      javTempSort: '',
      idolTempSort: '',
      javRandomMode: false,
      javRandomSeed: null,
      javIdolIds: [],
      javTags: [],
      javStudioId: hasStudio ? studioId : shouldIncludeStudio ? 0 : null,
      javStudioName: shouldIncludeStudio ? String(prefixItem?.studio_name || '').trim() : '',
      javSeriesId: null,
      javSeriesName: '',
      javPrefix: prefix,
      javSoloOnly: false,
      javFavoriteRatingEnabled: false,
      javFavoriteRatingMin: 0.5,
      javFavoriteRatingMax: 5,
      javFavoriteGroupId: null,
      idolFavoriteGroupId: null,
      javSearchTerm: '',
      javPage: 1,
      idolPage: 1,
      studioPage: 1,
      seriesPage: 1,
    })
  }

  const handleJavTagClick = useCallback(
    (tag) => {
      const raw = typeof tag === 'object' ? tag?.id : tag
      const parsed = Number.parseInt(String(raw), 10)
      if (!Number.isFinite(parsed) || parsed <= 0) return
      applyJavTagFilter([parsed])
    },
    [applyJavTagFilter]
  )

  const loadJavTagCategories = useCallback(async () => {
    const categories = await fetchJavTagCategories()
    setJavTagCategories(Array.isArray(categories) ? categories : [])
    return categories
  }, [])

  const handleOpenJavTagModal = useCallback(() => {
    loadJavTags()
    setJavTagModalOpen(true)
  }, [loadJavTags])

  useEffect(() => {
    loadTagCategories().catch(() => setTagCategories([]))
    loadJavTagCategories().catch(() => setJavTagCategories([]))
  }, [loadJavTagCategories, loadTagCategories])

  const handleApplyJavQuery = useCallback(
    (query) => {
      const nextSearch = String(query?.search || '').trim()
      const nextIdolIds = Array.from(
        new Set(
          (query?.idolIds || [])
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id) && id > 0)
        )
      )
      const nextTags = Array.from(
        new Set(
          (query?.tagIds || [])
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id) && id > 0)
        )
      )
      const nextStudioId = Number(query?.studio?.id)
      const hasStudio = Number.isFinite(nextStudioId) && nextStudioId >= 0
      const nextStudioName = hasStudio ? String(query?.studio?.name || '').trim() : ''
      const nextSeriesId = Number(query?.series?.id)
      const hasSeries = Number.isFinite(nextSeriesId) && nextSeriesId > 0
      const nextSeriesName = hasSeries ? String(query?.series?.name || '').trim() : ''
      const nextPrefix = String(query?.prefix || '')
        .trim()
        .toUpperCase()
      const nextFavoriteRatingEnabled = Boolean(query?.favoriteRatingEnabled)
      const normalizeFavoriteRating = (value, fallback) => {
        const parsed = Number(value)
        if (!Number.isFinite(parsed)) return fallback
        return Math.min(5, Math.max(0.5, Math.round(parsed * 2) / 2))
      }
      let nextFavoriteRatingMin = normalizeFavoriteRating(query?.favoriteRatingMin, 0.5)
      let nextFavoriteRatingMax = normalizeFavoriteRating(query?.favoriteRatingMax, 5)
      if (nextFavoriteRatingMin > nextFavoriteRatingMax) {
        nextFavoriteRatingMin = 0.5
        nextFavoriteRatingMax = 5
      }
      saveScrollBeforeUrlStateChange()
      useStore.setState({
        viewMode: 'jav',
        videoTempSort: '',
        javTab: 'list',
        javTempSort: '',
        idolTempSort: '',
        javSearchTerm: nextSearch,
        javIdolIds: nextIdolIds,
        javTags: nextTags,
        javStudioId: hasStudio ? nextStudioId : null,
        javStudioName: nextStudioName,
        javSeriesId: hasSeries ? nextSeriesId : null,
        javSeriesName: nextSeriesName,
        javPrefix: nextPrefix,
        javSoloOnly: Boolean(query?.soloOnly),
        javFavoriteRatingEnabled: nextFavoriteRatingEnabled,
        javFavoriteRatingMin: nextFavoriteRatingMin,
        javFavoriteRatingMax: nextFavoriteRatingMax,
        idolFavoriteGroupId: null,
        javPage: 1,
        idolPage: 1,
        studioPage: 1,
        seriesPage: 1,
      })
      setJavSearchInput(nextSearch)
      setJavQueryEditorOpen(false)
    },
    [saveScrollBeforeUrlStateChange]
  )

  const addVideosToSelection = useCallback((items) => {
    const entries = (Array.isArray(items) ? items : [])
      .map((video) => {
        const key = videoSelectionKey(video)
        const videoId = Number(video?.id)
        if (!key || !Number.isFinite(videoId) || videoId <= 0) return null
        return {
          key,
          meta: {
            label: video.filename || video.path || `#${videoId}`,
            video_id: videoId,
            location_id: video.location_id || null,
            jav_id: video.jav_id || null,
            jav_code: video.jav?.code || video.locations?.[0]?.jav?.code || '',
          },
        }
      })
      .filter(Boolean)

    if (entries.length === 0) return 0
    useStore.setState((state) => {
      const nextIds = new Set(state.selectedVideoIds)
      const nextMeta = { ...state.selectedVideoMeta }
      entries.forEach(({ key, meta }) => {
        nextIds.add(key)
        nextMeta[key] = meta
      })
      return { selectedVideoIds: nextIds, selectedVideoMeta: nextMeta }
    })
    return entries.length
  }, [])

  const fetchAllMatchingVideos = useCallback(async () => {
    if (randomMode) {
      return Array.isArray(videos) ? videos : []
    }

    const batchSize = 500
    let expectedTotal = Math.max(0, Number(total) || 0)
    let offset = 0
    const items = []
    const effectiveSort = videoTempSort || sortOrder

    while (offset < expectedTotal) {
      const limit = Math.min(batchSize, expectedTotal - offset)
      const response = await fetchVideos({
        limit,
        offset,
        tags: selectedTags,
        search: searchTerm || '',
        sort: effectiveSort,
        hideJav: videoHideJav,
      })
      const batch = Array.isArray(response?.items) ? response.items : []
      items.push(...batch)
      const responseTotal = Number(response?.total)
      if (Number.isFinite(responseTotal) && responseTotal >= 0) {
        expectedTotal = responseTotal
      }
      if (batch.length === 0) break
      offset += limit
    }

    return items
  }, [randomMode, searchTerm, selectedTags, sortOrder, total, videoHideJav, videoTempSort, videos])

  const playVideosWithMPV = useCallback(
    async (items) => {
      const list = Array.isArray(items) ? items : []
      const targets = list
        .map((video) => {
          const videoId = Number(video?.id)
          const locationId = Number(video?.location_id || 0)
          if (!Number.isFinite(videoId) || videoId <= 0) return null
          return {
            video_id: videoId,
            location_id: Number.isFinite(locationId) && locationId > 0 ? locationId : 0,
            title: video?.filename || `Video #${videoId}`,
          }
        })
        .filter(Boolean)
      if (targets.length !== list.length || targets.length === 0) {
        showCenterToast(
          zh(
            '无法播放：部分视频缺少文件信息',
            'Cannot play: some videos are missing file information'
          )
        )
        return
      }
      if (!confirmLargeMPVPlaylist(targets.length)) return

      const result = await playVideoPlaylist(targets)
      const count = Number(result?.count) || targets.length
      showToast(
        zh(`已将 ${count} 个视频加入 MPV 播放列表`, `Added ${count} videos to the MPV playlist`)
      )
      return true
    },
    [showCenterToast, showToast]
  )

  const javSelection = useJavSelection({
    items: javItems,
    mpvEnabled,
    playVideos: playVideosWithMPV,
    showToast,
    showError: showCenterToast,
  })

  const handleSelectVideoPage = useCallback(() => {
    const count = addVideosToSelection(videos)
    if (count > 0) {
      showToast(zh(`已选择本页 ${count} 个视频`, `Selected ${count} videos on this page`))
    }
  }, [addVideosToSelection, showToast, videos])

  const handleSelectAllVideos = useCallback(async () => {
    if (videoBulkActionBusy) return
    setVideoBulkActionBusy(true)
    try {
      const items = await fetchAllMatchingVideos()
      const count = addVideosToSelection(items)
      if (count > 0) {
        showToast(zh(`已选择全部 ${count} 个视频`, `Selected all ${count} videos`))
      }
    } catch (err) {
      showCenterToast(getErrorMessage(err))
    } finally {
      setVideoBulkActionBusy(false)
    }
  }, [
    addVideosToSelection,
    fetchAllMatchingVideos,
    showCenterToast,
    showToast,
    videoBulkActionBusy,
  ])

  const handlePlayVideoPage = useCallback(async () => {
    if (selectionPlaying || videoBulkActionBusy || !mpvEnabled) return
    setSelectionPlaying(true)
    try {
      await playVideosWithMPV(videos)
    } catch (err) {
      showCenterToast(getErrorMessage(err))
    } finally {
      setSelectionPlaying(false)
    }
  }, [
    mpvEnabled,
    playVideosWithMPV,
    selectionPlaying,
    showCenterToast,
    videoBulkActionBusy,
    videos,
  ])

  const handlePlayAllVideos = useCallback(async () => {
    if (selectionPlaying || videoBulkActionBusy || !mpvEnabled) return
    setSelectionPlaying(true)
    setVideoBulkActionBusy(true)
    try {
      const items = await fetchAllMatchingVideos()
      await playVideosWithMPV(items)
    } catch (err) {
      showCenterToast(getErrorMessage(err))
    } finally {
      setVideoBulkActionBusy(false)
      setSelectionPlaying(false)
    }
  }, [
    fetchAllMatchingVideos,
    mpvEnabled,
    playVideosWithMPV,
    selectionPlaying,
    showCenterToast,
    videoBulkActionBusy,
  ])

  const activeError = isJavMode
    ? javTab === 'download'
      ? null
      : javTab === 'idol'
        ? idolError
        : javTab === 'studio'
          ? studioError
          : javTab === 'series'
            ? seriesError
            : javError
    : error
  const showDirectorySetupHint =
    hydrated &&
    configLoaded &&
    !loading &&
    !activeError &&
    Array.isArray(directories) &&
    directories.length === 0 &&
    Array.isArray(videos) &&
    videos.length === 0

  const activeJavLoading =
    javTab === 'download'
      ? false
      : javTab === 'idol'
        ? idolLoading
        : javTab === 'studio'
          ? studioLoading
          : javTab === 'series'
            ? seriesLoading
            : javLoading
  const activeLoadingMore = isJavMode
    ? javTab === 'download'
      ? false
      : javTab === 'idol'
        ? idolLoadingMore
        : javTab === 'studio'
          ? studioLoadingMore
          : javTab === 'series'
            ? seriesLoadingMore
            : javLoadingMore
    : videoLoadingMore
  useScrollRestoration({
    activeJavLoading,
    activeLoadingMore,
    configLoaded,
    hydrated,
    idolItems,
    idolWaterfallHasMore,
    isJavMode,
    javItems,
    javTab,
    javWaterfallHasMore,
    loadMoreJavIdols,
    loadMoreJavSeries,
    loadMoreJavStudios,
    loadMoreJavs,
    loadMoreVideos,
    loading,
    pendingScrollRestoreRef,
    schedulePendingScrollRestore,
    seriesItems,
    seriesWaterfallHasMore,
    studioItems,
    studioWaterfallHasMore,
    videoWaterfallHasMore,
    videos,
    waterfallModes,
  })
  const javVideoPickerTitle =
    javVideoPickerAction === 'open'
      ? alternatePlayer === 'mpv'
        ? zh('选择使用MPV播放器播放的文件', 'Choose a file to play with MPV player')
        : alternatePlayer === 'system'
          ? zh('选择使用系统播放器播放的文件', 'Choose a file to play with system player')
          : zh('选择使用浏览器播放的文件', 'Choose a file to play in the browser')
      : javVideoPickerAction === 'screenshots'
        ? zh('选择查看截图的文件', 'Choose a file to view screenshots')
        : javVideoPickerAction === 'reveal'
          ? zh('选择定位文件', 'Choose a file to reveal')
          : defaultPlayer === 'system'
            ? zh('选择使用系统播放器播放的文件', 'Choose a file to play with system player')
            : defaultPlayer === 'browser'
              ? zh('选择使用浏览器播放的文件', 'Choose a file to play in the browser')
              : zh('选择使用MPV播放器播放的文件', 'Choose a file to play with MPV player')
  const javVideoPickerEmptyText =
    javVideoPickerAction === 'play'
      ? zh('暂无可播放文件', 'No playable files')
      : javVideoPickerAction === 'screenshots'
        ? zh('暂无可查看截图的文件', 'No files with screenshots available')
        : zh('暂无可用文件', 'No available files')
  const activeFavoriteEntityType =
    javTab === 'studio'
      ? 'studio'
      : javTab === 'series'
        ? 'series'
        : javTab === 'idol'
          ? 'idol'
          : 'jav'
  const activeFavoriteGroups = favoriteGroupsByType?.[activeFavoriteEntityType] || []
  const activeFavoriteGroupsLoading = Boolean(
    favoriteGroupsLoadingByType?.[activeFavoriteEntityType]
  )
  const activeFavoriteGroupsError = favoriteGroupsErrorByType?.[activeFavoriteEntityType] || null
  const activeSelectedFavoriteGroupId = activeFavoriteGroupId(activeFavoriteEntityType)

  return (
    <div className="app-shell min-h-screen">
      <SideTabs
        activeTab={isJavMode ? javTab : 'video'}
        buildJavPrefixUrl={(item) =>
          buildJavUrl({
            page: 1,
            tab: 'list',
            search: '',
            idolIds: [],
            tagIds: [],
            studioId: item?.include_studio_filter ? item?.studio_id || 0 : null,
            studioName: item?.include_studio_filter ? item?.studio_name || '' : '',
            seriesId: null,
            prefix: item?.prefix || '',
            soloOnly: false,
            favoriteRatingEnabled: false,
            favoriteGroupId: null,
            random: false,
            tempSort: '',
          })
        }
        canGoBack={browserNavigation.canGoBack}
        canGoForward={browserNavigation.canGoForward}
        isJavMode={isJavMode}
        javPrefix={javPrefix}
        onBrowserBack={handleBrowserBack}
        onBrowserForward={handleBrowserForward}
        onOpenDownload={() => setDownloadOpen(true)}
        onOpenGlobalSettings={() => setGlobalSettingsOpen(true)}
        onOpenJavSettings={openJavSettings}
        onOpenJavTagModal={handleOpenJavTagModal}
        onJavPrefixClick={handleSelectJavPrefix}
        onOpenTagModal={handleOpenTagModal}
        onOpenVideoSettings={openVideoSettings}
        onSelectTab={handleSelectSideTab}
        showDirectorySetupHint={showDirectorySetupHint}
      />
      <TopBar
        buildFavoriteGroupUrl={(groupId) => {
          const parsedGroupId = Number(groupId)
          const targetGroupId =
            Number.isFinite(parsedGroupId) && parsedGroupId > 0 ? parsedGroupId : null
          const parsedCurrentGroupId = Number(activeSelectedFavoriteGroupId)
          const currentGroupId =
            Number.isFinite(parsedCurrentGroupId) && parsedCurrentGroupId > 0
              ? parsedCurrentGroupId
              : null
          if (targetGroupId === currentGroupId) {
            return buildJavUrl({
              page: 1,
              tab: javTab,
              favoriteGroupId: targetGroupId,
            })
          }
          return buildJavUrl({
            page: 1,
            tab: javTab,
            search: '',
            idolIds: [],
            tagIds: [],
            studioId: null,
            studioName: '',
            seriesId: null,
            seriesName: '',
            prefix: '',
            soloOnly: false,
            favoriteRatingEnabled: false,
            idolProfileFilters: createDefaultIdolProfileFilters(),
            favoriteGroupId: targetGroupId,
            random: false,
            tempSort: '',
          })
        }}
        favoriteEntityType={activeFavoriteEntityType}
        favoriteGroups={activeFavoriteGroups}
        favoriteGroupsLoading={activeFavoriteGroupsLoading}
        favoriteGroupsError={activeFavoriteGroupsError}
        favoriteManagerOpen={idolFavoriteManageOpen}
        favoriteRatingEnabled={javFavoriteRatingEnabled}
        favoriteRatingMin={javFavoriteRatingMin}
        favoriteRatingMax={javFavoriteRatingMax}
        idolProfileFilters={idolProfileFilters}
        filterItems={activeFilterItems}
        hasActiveControlFilter={
          isJavMode &&
          ((javTab === 'list' && javFavoriteRatingEnabled) ||
            (javTab === 'idol' &&
              (Boolean(String(javSearchTerm || '').trim()) ||
                Object.values(normalizeIdolProfileFilters(idolProfileFilters)).some(
                  (value) => value.enabled
                ))))
        }
        isJavMode={isJavMode}
        javSearchHref={javSearchHref}
        javSearchInput={javSearchInput}
        javTab={javTab}
        onClearFilters={handleClearActiveFilters}
        onFavoriteGroupSelect={(groupId) =>
          handleFavoriteGroupSelect(activeFavoriteEntityType, groupId)
        }
        onFavoriteRatingEnabledChange={handleFavoriteRatingEnabledChange}
        onFavoriteRatingRangeChange={handleFavoriteRatingRangeChange}
        onIdolProfileFilterChange={handleIdolProfileFilterChange}
        onHome={handleHomeClick}
        onOpenFavoriteGroups={() =>
          loadJavFavoriteGroups(activeFavoriteEntityType, { force: true })
        }
        onOpenFavoriteManager={(group) => {
          const groupId = Number(group?.id)
          setFavoriteManageEntityType(activeFavoriteEntityType)
          setIdolFavoriteManageEditGroupId(Number.isFinite(groupId) && groupId > 0 ? groupId : null)
          setIdolFavoriteManageOpen(true)
        }}
        onOpenFilterEditor={
          isJavMode
            ? javTab === 'list'
              ? () => {
                  setJavQueryEditorOpen(true)
                  loadJavTags()
                }
              : null
            : handleOpenTagFilterEditor
        }
        onOpenSelectionOps={isJavMode ? javSelection.openOps : () => setSelectionOpsOpen(true)}
        onClearSelection={isJavMode ? javSelection.clear : clearSelection}
        onRandomClick={
          !isJavMode ? handleVideoRandomClick : javTab === 'list' ? handleJavRandomClick : null
        }
        onSearchInputChange={isJavMode ? setJavSearchInput : setSearchInput}
        onSubmitSearch={isJavMode ? submitJavSearch : submitSearch}
        searchHref={searchHref}
        searchInput={searchInput}
        selectedCount={isJavMode ? javSelection.count : selectedCount}
        selectedFavoriteGroupId={activeSelectedFavoriteGroupId}
      />

      <main className="page-main w-full pb-6 pt-0">
        {activeError && (
          <div
            role="alert"
            className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-red-700"
          >
            {String(activeError)}
          </div>
        )}

        {isJavMode ? (
          <JavRoute
            tab={javTab}
            buildJavUrl={buildJavUrl}
            onSelectStudio={handleSelectStudio}
            idol={{
              page: idolPage,
              lastPage: idolLastPage,
              totalItems: idolTotal,
              hasPrev: idolHasPrev,
              hasNext: idolHasNext,
              loading: idolLoading,
              idolTempSort,
              idolGlobalSort: idolFavoriteGroupId ? IDOL_FAVORITE_ORDER_SORT : idolSort,
              setIdolTempSort,
              onFirst: () => setIdolPage(1),
              onPrev: () => idolHasPrev && setIdolPage(idolPage - 1),
              onGoToPage: (p) => setIdolPage(p),
              onNext: () => idolHasNext && setIdolPage(idolPage + 1),
              onLast: () => setIdolPage(idolLastPage),
              items: idolItems,
              config,
              onSelectIdol: handleSelectIdol,
              onOpenFavorites: handleOpenIdolFavoriteModal,
              onMerged: () => {
                loadJavIdols({ force: true })
                loadJavFavoriteGroups('idol', { force: true })
              },
              waterfallMode: waterfallModes.idol,
              onWaterfallModeChange: (enabled) => setWaterfallMode('idol', enabled),
              onLoadMore: loadMoreJavIdols,
              loadingMore: idolLoadingMore,
              hasMore: idolWaterfallHasMore,
            }}
            studio={{
              page: studioPage,
              lastPage: studioLastPage,
              totalItems: studioTotal,
              hasPrev: studioHasPrev,
              hasNext: studioHasNext,
              loading: studioLoading,
              onFirst: () => setStudioPage(1),
              onPrev: () => studioHasPrev && setStudioPage(studioPage - 1),
              onGoToPage: (p) => setStudioPage(p),
              onNext: () => studioHasNext && setStudioPage(studioPage + 1),
              onLast: () => setStudioPage(studioLastPage),
              items: studioItems,
              onSelectStudio: handleSelectStudio,
              onSelectSeries: handleSelectSeries,
              onSelectPrefix: handleSelectJavPrefix,
              onOpenFavorites: (studio) => handleOpenFavoriteModal('studio', studio),
              onOpenSeriesFavorites: (series) => handleOpenFavoriteModal('series', series),
              onMerged: () => {
                loadJavStudios({ force: true })
                loadJavSeries({ force: true })
                loadJavFavoriteGroups('studio', { force: true })
              },
              waterfallMode: waterfallModes.studio,
              onWaterfallModeChange: (enabled) => setWaterfallMode('studio', enabled),
              onLoadMore: loadMoreJavStudios,
              loadingMore: studioLoadingMore,
              hasMore: studioWaterfallHasMore,
            }}
            series={{
              page: seriesPage,
              lastPage: seriesLastPage,
              totalItems: seriesTotal,
              hasPrev: seriesHasPrev,
              hasNext: seriesHasNext,
              loading: seriesLoading,
              onFirst: () => setSeriesPage(1),
              onPrev: () => seriesHasPrev && setSeriesPage(seriesPage - 1),
              onGoToPage: (p) => setSeriesPage(p),
              onNext: () => seriesHasNext && setSeriesPage(seriesPage + 1),
              onLast: () => setSeriesPage(seriesLastPage),
              items: seriesItems,
              onSelectSeries: handleSelectSeries,
              onOpenFavorites: (series) => handleOpenFavoriteModal('series', series),
              waterfallMode: waterfallModes.series,
              onWaterfallModeChange: (enabled) => setWaterfallMode('series', enabled),
              onLoadMore: loadMoreJavSeries,
              loadingMore: seriesLoadingMore,
              hasMore: seriesWaterfallHasMore,
            }}
            list={{
              javPage,
              javLastPage,
              javHasPrev,
              javHasNext,
              activeJavLoading,
              javRandomMode,
              javResolvedSort: javSortResolution.sort,
              javSortSource: javSortResolution.source,
              javPrefix,
              setJavPage,
              setJavTempSort,
              javItems,
              javTotal,
              javGridColumns,
              javTitleMaxRows,
              javIdolTagMaxRows,
              javTagMaxRows,
              selectedJavIds: javSelection.selectedIds,
              onToggleSelect: javSelection.toggle,
              onSelectAll: javSelection.selectAll,
              onSelectPage: javSelection.selectPage,
              onPlayPage: javSelection.playPage,
              onPlayAll: javSelection.playAll,
              bulkActionBusy: javSelection.busy,
              mpvEnabled,
              onPlay: handleJavPlay,
              onOpenFile: handleJavOpenFile,
              alternatePlayerLabel,
              onRevealFile: handleJavRevealFile,
              onOpenScreenshots: handleJavOpenScreenshots,
              onManageVideoPlay: handleOpenPlayer,
              onManageVideoPlayAtTime: playVideoFromTime,
              onManageVideoCoverChanged: handleVideoCoverChanged,
              onManageVideoOpenFile: handleOpenAlternatePlayer,
              onManageVideoRevealFile: handleRevealVideoFile,
              onManageVideoOpenTagPicker: openTagEditor,
              onManageVideoOpenScreenshots: openJavScreenshots,
              onManageVideoOpenScrapeSettings: handleOpenScrapeSettings,
              onManageVideoRename: handleRenameVideo,
              onManageVideoDelete: handleDeleteVideo,
              onManageVideoTagClick: handleVideoTagClick,
              onIdolClick: handleJavIdolClick,
              onOpenFavorites: handleOpenIdolFavoriteModal,
              onOpenJavFavorites: (item) => handleOpenFavoriteModal('jav', item),
              onOpenStudioFavorites: (studio) => handleOpenFavoriteModal('studio', studio),
              onOpenSeriesFavorites: (series) => handleOpenFavoriteModal('series', series),
              onStudioClick: handleSelectStudio,
              onSeriesClick: handleSelectSeries,
              onPrefixClick: handleSelectJavPrefix,
              onTagClick: handleJavTagClick,
              waterfallMode: waterfallModes.jav,
              onWaterfallModeChange: (enabled) => setWaterfallMode('jav', enabled),
              onLoadMore: loadMoreJavs,
              loadingMore: javLoadingMore,
              hasMore: javWaterfallHasMore,
            }}
          />
        ) : (
          <VideoRoute
            page={page}
            lastPage={lastPage}
            totalItems={total}
            canPrev={canPrev}
            canNext={canNext}
            loading={loading}
            randomMode={randomMode}
            videoTempSort={videoTempSort}
            videoGlobalSort={sortOrder}
            buildVideoUrl={buildVideoUrl}
            setPage={navigateVideoPage}
            setVideoTempSort={setVideoTempSort}
            goToLastPage={() => navigateVideoPage(lastPage)}
            videos={videos}
            selectedVideoIds={selectedVideoIds}
            toggleSelectVideo={toggleSelectVideo}
            onSelectAll={handleSelectAllVideos}
            onSelectPage={handleSelectVideoPage}
            onPlayPage={handlePlayVideoPage}
            onPlayAll={handlePlayAllVideos}
            bulkActionBusy={videoBulkActionBusy || selectionPlaying}
            mpvEnabled={mpvEnabled}
            openPlayer={handleOpenPlayer}
            openAlternatePlayer={alternatePlayer ? handleOpenAlternatePlayer : null}
            revealFile={desktopIntegrationEnabled ? handleRevealVideoFile : null}
            alternatePlayerLabel={alternatePlayerLabel}
            setTagPickerFor={openTagEditor}
            onOpenScreenshots={openVideoScreenshots}
            onOpenScrapeSettings={handleOpenScrapeSettings}
            onRenameVideo={handleRenameVideo}
            onDeleteVideo={handleDeleteVideo}
            onTagClick={handleVideoTagClick}
            waterfallMode={waterfallModes.video}
            onWaterfallModeChange={(enabled) => setWaterfallMode('video', enabled)}
            onLoadMore={loadMoreVideos}
            loadingMore={videoLoadingMore}
            hasMore={videoWaterfallHasMore}
          />
        )}
      </main>

      <DownloadView open={downloadOpen} onClose={() => setDownloadOpen(false)} />

      <JavQueryEditorModal
        open={javQueryEditorOpen}
        onClose={() => setJavQueryEditorOpen(false)}
        onApply={handleApplyJavQuery}
        search={javSearchTerm}
        idolIds={javIdolIds}
        idolOptions={javIdolFilterOptions}
        tagIds={javTags}
        tagOptions={displayJavTagOptions}
        studioId={javStudioId}
        studioName={javStudioName}
        seriesId={javSeriesId}
        seriesName={javSeriesName}
        prefix={javPrefix}
        soloOnly={javSoloOnly}
        preferChineseName={configFlag(config?.jav_idol_prefer_chinese_name)}
        favoriteGroupId={javFavoriteGroupId}
        favoriteRatingEnabled={javFavoriteRatingEnabled}
        favoriteRatingMin={javFavoriteRatingMin}
        favoriteRatingMax={javFavoriteRatingMax}
      />

      <VideoSettingsModal
        open={videoSettingsOpen}
        onClose={() => setVideoSettingsOpen(false)}
        pageSizeInput={videoPageSizeInput}
        onPageSizeChange={setVideoPageSizeInput}
        sortInput={videoSortInput}
        onSortChange={setVideoSortInput}
        hideJavInput={videoHideJavInput}
        onHideJavChange={setVideoHideJavInput}
        waterfallDefaultInput={videoWaterfallDefaultInput}
        onWaterfallDefaultChange={setVideoWaterfallDefaultInput}
        onSave={handleSaveVideoSettings}
      />

      <VideoScreenshotsModal
        video={screenshotsVideo}
        playerHotkeys={config?.player_hotkeys}
        allowSetCover={screenshotsAllowSetCover}
        onClose={() => setScreenshotsVideo(null)}
        onPlayAtTime={playVideoFromTime}
        onCoverChanged={handleVideoCoverChanged}
      />

      <PlayerModal
        video={playerVideo}
        startTime={playerStartTime}
        hotkeys={config?.player_hotkeys}
        showHotkeyHint={configFlag(config?.browser_player_show_hotkey_hint, true)}
        onPlaybackError={showCenterToast}
        onClose={() => {
          setPlayerVideo(null)
          setPlayerStartTime(0)
        }}
      />

      <VideoScrapeSettingsModal
        open={Boolean(scrapeSettingsVideo)}
        video={scrapeSettingsVideo}
        saving={scrapeSettingsSaving}
        onClose={() => {
          if (!scrapeSettingsSaving) setScrapeSettingsVideo(null)
        }}
        onSave={handleSaveScrapeSettings}
        onFetchPossibleCodes={handleFetchScrapePossibleCodes}
        onManualScrape={handleManualScrape}
        onLinkExistingJav={handleLinkExistingJav}
      />

      <JavSettingsModal
        key={`${javSettingsOpen ? 'open' : 'closed'}-${javTab === 'list' ? 'jav' : javTab}`}
        open={javSettingsOpen}
        initialTab={javTab === 'list' ? 'jav' : javTab}
        onClose={() => setJavSettingsOpen(false)}
        javPageSizeInput={javPageSizeInput}
        onJavPageSizeChange={setJavPageSizeInput}
        javGridColumnsInput={javGridColumnsInput}
        onJavGridColumnsChange={setJavGridColumnsInput}
        javTitleMaxRowsInput={javTitleMaxRowsInput}
        onJavTitleMaxRowsChange={setJavTitleMaxRowsInput}
        javIdolTagMaxRowsInput={javIdolTagMaxRowsInput}
        onJavIdolTagMaxRowsChange={setJavIdolTagMaxRowsInput}
        javTagMaxRowsInput={javTagMaxRowsInput}
        onJavTagMaxRowsChange={setJavTagMaxRowsInput}
        javHideSeriesInput={javHideSeriesInput}
        onJavHideSeriesChange={setJavHideSeriesInput}
        javHideIdolsInput={javHideIdolsInput}
        onJavHideIdolsChange={setJavHideIdolsInput}
        javHideTagsInput={javHideTagsInput}
        onJavHideTagsChange={setJavHideTagsInput}
        javHideActionsInput={javHideActionsInput}
        onJavHideActionsChange={setJavHideActionsInput}
        javFavoriteRatingShowFullInput={javFavoriteRatingShowFullInput}
        onJavFavoriteRatingShowFullChange={setJavFavoriteRatingShowFullInput}
        javWaterfallDefaultInput={javWaterfallDefaultInput}
        onJavWaterfallDefaultChange={setJavWaterfallDefaultInput}
        idolPageSizeInput={idolPageSizeInput}
        onIdolPageSizeChange={setIdolPageSizeInput}
        idolWaterfallDefaultInput={idolWaterfallDefaultInput}
        onIdolWaterfallDefaultChange={setIdolWaterfallDefaultInput}
        studioPageSizeInput={studioPageSizeInput}
        onStudioPageSizeChange={setStudioPageSizeInput}
        studioWaterfallDefaultInput={studioWaterfallDefaultInput}
        onStudioWaterfallDefaultChange={setStudioWaterfallDefaultInput}
        seriesPageSizeInput={seriesPageSizeInput}
        onSeriesPageSizeChange={setSeriesPageSizeInput}
        seriesWaterfallDefaultInput={seriesWaterfallDefaultInput}
        onSeriesWaterfallDefaultChange={setSeriesWaterfallDefaultInput}
        javSortInput={javSortInput}
        onJavSortChange={setJavSortInput}
        javSortRulesInput={javSortRulesInput}
        onJavSortRulesChange={setJavSortRulesInput}
        idolSortInput={idolSortInput}
        onIdolSortChange={setIdolSortInput}
        javIdolPreferChineseNameInput={javIdolPreferChineseNameInput}
        onJavIdolPreferChineseNameChange={setJavIdolPreferChineseNameInput}
        javTagShowSimplifiedInput={javTagShowSimplifiedInput}
        onJavTagShowSimplifiedChange={setJavTagShowSimplifiedInput}
        onSave={handleSaveJavSettings}
      />

      <JavVideoPickerModal
        open={javVideoPickerOpen}
        title={javVideoPickerTitle}
        onClose={closeJavVideoPicker}
        item={javVideoPickerItem}
        choices={javVideoChoices}
        emptyText={javVideoPickerEmptyText}
        action={javVideoPickerAction}
        buildVideoFullPath={buildVideoFullPath}
        isVideoOpenable={isVideoOpenable}
        onSelectVideo={handleSelectJavVideo}
      />

      <JavFavoriteModal
        open={idolFavoriteModalOpen}
        entityType={favoriteModalEntityType}
        idol={idolFavoriteModalItem}
        groups={favoriteGroupsByType?.[favoriteModalEntityType] || []}
        selectedIds={idolFavoriteSelectedIds}
        loading={
          idolFavoriteModalLoading ||
          Boolean(favoriteGroupsLoadingByType?.[favoriteModalEntityType])
        }
        saving={idolFavoriteModalSaving}
        error={idolFavoriteModalError || favoriteGroupsErrorByType?.[favoriteModalEntityType] || ''}
        onClose={handleCloseIdolFavoriteModal}
        onCreateGroup={(name) => handleCreateFavoriteGroup(name, favoriteModalEntityType)}
        onSave={handleSaveIdolFavoriteGroups}
        preferChineseName={configFlag(config?.jav_idol_prefer_chinese_name)}
      />

      <JavFavoriteManageModal
        open={idolFavoriteManageOpen}
        entityType={favoriteManageEntityType}
        groups={favoriteGroupsByType?.[favoriteManageEntityType] || []}
        selectedGroupId={activeFavoriteGroupId(favoriteManageEntityType)}
        initialEditGroupId={idolFavoriteManageEditGroupId}
        loading={Boolean(favoriteGroupsLoadingByType?.[favoriteManageEntityType])}
        onClose={() => {
          setIdolFavoriteManageOpen(false)
          setIdolFavoriteManageEditGroupId(null)
        }}
        onCreateGroup={(name) => handleCreateFavoriteGroup(name, favoriteManageEntityType)}
        onReorderGroups={handleReorderIdolFavoriteGroups}
        onRenameGroup={handleRenameIdolFavoriteGroup}
        onDeleteGroup={handleDeleteIdolFavoriteGroup}
        onLoadGroupIdols={handleLoadIdolFavoriteGroupIdols}
        onReorderGroupIdols={handleReorderIdolFavoriteGroupIdols}
        onRemoveGroupIdols={handleRemoveIdolFavoriteGroupIdols}
        preferChineseName={configFlag(config?.jav_idol_prefer_chinese_name)}
      />

      <JavVideoPickerModal
        open={locationPickerOpen}
        title={
          locationPickerAction === 'reveal'
            ? zh('选择定位文件', 'Choose a file to reveal')
            : locationPickerAction === 'open'
              ? alternatePlayer === 'mpv'
                ? zh('选择使用MPV播放器播放的文件', 'Choose a file to play with MPV player')
                : alternatePlayer === 'system'
                  ? zh('选择使用系统播放器播放的文件', 'Choose a file to play with system player')
                  : zh('选择使用浏览器播放的文件', 'Choose a file to play in the browser')
              : defaultPlayer === 'system'
                ? zh('选择使用系统播放器播放的文件', 'Choose a file to play with system player')
                : defaultPlayer === 'browser'
                  ? zh('选择使用浏览器播放的文件', 'Choose a file to play in the browser')
                  : zh('选择使用MPV播放器播放的文件', 'Choose a file to play with MPV player')
        }
        onClose={closeLocationPicker}
        item={locationPickerItem}
        choices={locationPickerChoices}
        emptyText={zh('暂无可用文件', 'No available files')}
        action={locationPickerAction}
        buildVideoFullPath={buildVideoFullPath}
        isVideoOpenable={isVideoOpenable}
        onSelectVideo={handleSelectVideoLocation}
      />

      <JavSelectionOpsModal
        open={javSelection.opsOpen}
        busy={javSelection.busy}
        onClose={javSelection.closeOps}
        items={javSelection.selectedList}
        mpvEnabled={mpvEnabled}
        playing={javSelection.playing}
        onRemoveSelected={javSelection.remove}
        onPlaySelected={javSelection.playSelected}
        onOpenTags={javSelection.openTags}
        onOpenFavorites={javSelection.openFavorites}
      />

      <JavSelectionFavoritesModal
        open={javSelection.favoritesOpen}
        selectedCount={javSelection.count}
        groups={favoriteGroupsByType?.jav || []}
        selectedIds={javSelection.favoriteChoices}
        onToggleChoice={javSelection.toggleFavorite}
        onCreateGroup={(name) => handleCreateFavoriteGroup(name, 'jav')}
        onClose={javSelection.closeFavorites}
        onConfirm={javSelection.applyFavorites}
        onReload={() => loadJavFavoriteGroups('jav', { force: true })}
        loading={Boolean(favoriteGroupsLoadingByType?.jav)}
        saving={javSelection.favoritesSaving}
        loadError={favoriteGroupsErrorByType?.jav}
        error={javSelection.favoriteError}
      />

      <JavSelectionTagsModal
        open={javSelection.tagsOpen}
        selectedCount={javSelection.count}
        tags={displayJavTagOptions.filter(isUserJavTag)}
        selectedIds={javSelection.tagChoices}
        onToggleChoice={javSelection.toggleTag}
        onClose={javSelection.closeTags}
        onConfirm={javSelection.applyTags}
        saving={javSelection.saving}
      />

      <SelectionOpsModal
        open={selectionOpsOpen}
        onClose={() => setSelectionOpsOpen(false)}
        selectedList={selectedList}
        selectedCount={selectedCount}
        selectedJavCount={selectedJavIds.length}
        mpvEnabled={mpvEnabled}
        playing={selectionPlaying}
        deleting={selectionDeleting}
        onRemoveSelected={handleRemoveSelectedVideo}
        onPlaySelected={handlePlaySelection}
        onOpenTags={() => {
          loadTags()
          setSelectionTagAction('add')
          setSelectionTagChoices([])
          setSelectionTagsOpen(true)
        }}
        onOpenJavTags={() => {
          loadJavTags()
          setSelectionJavTagChoices([])
          setSelectionJavTagsOpen(true)
        }}
        onOpenRemoveTags={() => {
          loadTags()
          setSelectionTagAction('remove')
          setSelectionTagChoices([])
          setSelectionTagsOpen(true)
        }}
        onDeleteSelected={handleDeleteSelection}
      />

      <SelectionTagsModal
        open={selectionTagsOpen}
        onClose={handleSelectionTagsClose}
        tags={tags}
        action={selectionTagAction}
        selectedChoices={selectionTagChoices}
        onToggleChoice={handleSelectionTagChoiceToggle}
        onConfirm={handleApplySelectionTags}
        confirmDisabled={!selectionTagChoices.length || selectedVideoIds.size === 0}
      />

      <SelectionJavTagsModal
        open={selectionJavTagsOpen}
        items={selectedList}
        tags={displayJavTagOptions.filter((tag) => isUserJavTag(tag))}
        selectedIds={selectionJavTagChoices}
        onToggleChoice={handleSelectionJavTagChoiceToggle}
        onCreateTag={async (name) => {
          const tag = await createJavTag(name)
          await loadJavTags({ force: true })
          return tag
        }}
        onClose={handleSelectionJavTagsClose}
        onConfirm={handleApplySelectionJavTags}
        saving={selectionJavTagSaving}
      />

      <TagPickerModal
        open={Boolean(tagPickerFor)}
        tags={tags}
        selectedIds={tagPickerSelected}
        onToggleChoice={handleTagPickerToggle}
        onCreateTag={createTag}
        onClose={handleTagPickerClose}
        onSave={handleApplyTags}
        saveDisabled={!tagPickerDirty}
      />

      <VideoTagModal
        open={tagModalOpen}
        onClose={() => setTagModalOpen(false)}
        tags={tags}
        categories={tagCategories}
        onToggleFilter={(name) => toggleTagFilter(name)}
        onCreateTag={async (name, categoryId) => {
          const tag = await createTag(name)
          await assignTagsCategory([tag.id], categoryId)
          await loadTags()
          return tag
        }}
        onCreateCategory={async (name) => {
          const category = await createTagCategory(name)
          await loadTagCategories()
          return category
        }}
        onReorderCategories={async (categoryIds) => {
          await reorderTagCategories(categoryIds)
          await loadTagCategories()
        }}
        onRenameCategory={async (id, name) => {
          await renameTagCategory(id, name)
          await Promise.all([loadTags(), loadTagCategories()])
        }}
        onDeleteCategory={async (id) => {
          await deleteTagCategory(id)
          await Promise.all([loadTags(), loadTagCategories()])
        }}
        onAssignCategory={async (tagIds, categoryId) => {
          await assignTagsCategory(tagIds, categoryId)
          await Promise.all([loadTags(), loadTagCategories()])
        }}
        onRenameTag={async (id, name) => {
          const oldName = tags.find((t) => t.id === id)?.name || ''
          await renameTag(id, name)
          useStore.setState((state) => {
            const nextTags = Array.isArray(state.tags)
              ? state.tags.map((tag) => (tag.id === id ? { ...tag, name } : tag))
              : state.tags
            const nextVideos = Array.isArray(state.videos)
              ? state.videos.map((video) => {
                  if (!Array.isArray(video.tags)) return video
                  const nextVideoTags = video.tags.map((tag) =>
                    tag.id === id ? { ...tag, name } : tag
                  )
                  return nextVideoTags === video.tags ? video : { ...video, tags: nextVideoTags }
                })
              : state.videos
            const nextSelectedTags =
              oldName && Array.isArray(state.selectedTags)
                ? state.selectedTags.map((tagName) => (tagName === oldName ? name : tagName))
                : state.selectedTags
            return { tags: nextTags, videos: nextVideos, selectedTags: nextSelectedTags }
          })
          await loadTags()
        }}
        onDeleteTag={async (tag) => {
          const id = typeof tag === 'object' ? tag?.id : tag
          if (!id) return
          const name =
            typeof tag === 'object' ? tag?.name : tags.find((item) => item.id === id)?.name || ''
          await deleteTag(id)
          if (name) {
            useStore.setState((state) => ({
              selectedTags: state.selectedTags.filter((tagName) => tagName !== name),
            }))
          }
          await loadTags()
        }}
        onApplyTagFilter={(names) => {
          if (tagModalApplyMode === 'append') {
            setSelectedTags([...selectedTags, ...names])
            return
          }
          setSearchTerm('', { resetPage: false, triggerLoad: false })
          setSelectedTags(names)
        }}
      />
      <JavTagModal
        open={javTagModalOpen}
        onClose={() => setJavTagModalOpen(false)}
        tags={displayJavTagOptions}
        categories={javTagCategories}
        onApplyTagFilter={applyJavTagFilter}
        onCreateTag={async (name, categoryId) => {
          const tag = await createJavTag(name)
          await assignJavTagsCategory([tag.id], categoryId)
          await loadJavTags({ force: true })
          return tag
        }}
        onOrganizeTags={async () => {
          const result = await organizeJavTags()
          await Promise.all([loadJavTags({ force: true }), loadJavTagCategories()])
          return result
        }}
        onCreateCategory={async (name) => {
          const category = await createJavTagCategory(name)
          await loadJavTagCategories()
          return category
        }}
        onReorderCategories={async (categoryIds) => {
          await reorderJavTagCategories(categoryIds)
          await loadJavTagCategories()
        }}
        onRenameCategory={async (id, name) => {
          await renameJavTagCategory(id, name)
          await Promise.all([loadJavTags({ force: true }), loadJavTagCategories()])
        }}
        onDeleteCategory={async (id) => {
          await deleteJavTagCategory(id)
          await Promise.all([loadJavTags({ force: true }), loadJavTagCategories()])
        }}
        onAssignCategory={async (tagIds, categoryId) => {
          await assignJavTagsCategory(tagIds, categoryId)
          await Promise.all([loadJavTags({ force: true }), loadJavTagCategories()])
        }}
        onRenameTag={async (id, name) => {
          await renameJavTag(id, name)
          useStore.setState((state) => {
            const options = Array.isArray(state.javTagOptions) ? state.javTagOptions : []
            const items = Array.isArray(state.javItems) ? state.javItems : []
            const nextOptions = options.map((tag) => (tag.id === id ? { ...tag, name } : tag))
            const nextItems = items.map((item) => {
              if (!Array.isArray(item.tags)) return item
              const nextTags = item.tags.map((tag) => (tag.id === id ? { ...tag, name } : tag))
              return nextTags === item.tags ? item : { ...item, tags: nextTags }
            })
            return { javTagOptions: nextOptions, javItems: nextItems }
          })
          await loadJavTags()
        }}
        onDeleteTag={async (tag) => {
          const id = typeof tag === 'object' ? tag?.id : tag
          if (!id) return
          await deleteJavTag(id)
          useStore.setState((state) => {
            const nextOptions = Array.isArray(state.javTagOptions)
              ? state.javTagOptions.filter((item) => item.id !== id)
              : state.javTagOptions
            const nextItems = Array.isArray(state.javItems)
              ? state.javItems.map((item) => {
                  if (!Array.isArray(item.tags)) return item
                  const nextTags = item.tags.filter((tagItem) => tagItem.id !== id)
                  return nextTags === item.tags ? item : { ...item, tags: nextTags }
                })
              : state.javItems
            const nextFilters = Array.isArray(state.javTags)
              ? state.javTags.filter((tagId) => tagId !== id)
              : state.javTags
            return { javTagOptions: nextOptions, javItems: nextItems, javTags: nextFilters }
          })
          await loadJavTags()
        }}
      />
      <GlobalSettingsModal
        open={globalSettingsOpen}
        onClose={() => setGlobalSettingsOpen(false)}
        directories={directories}
        browserPlaybackOnly={browserPlaybackOnly}
        desktopIntegrationEnabled={desktopIntegrationEnabled}
        containerMode={containerMode}
        directoryPickerEnabled={directoryPickerEnabled}
        hostPathPrefixEnabled={hostPathPrefixEnabled}
        mpvEnabled={mpvEnabled}
        onCreateDirectory={async (payload) => {
          const created = await createDirectory(payload)
          await loadDirectories()
          showToast(
            zh(
              '目录添加成功，首次扫描目录里的视频需要一定时间，请耐心等待，您可手动刷新页面查看扫描进度',
              'Directory added. The first scan may take some time. You can refresh manually to check progress.'
            )
          )
          return created
        }}
        onUpdateDirectory={async (id, payload) => {
          const updated = await updateDirectory(id, payload)
          await loadDirectories()
          return updated
        }}
        onDeleteDirectory={async (id) => {
          const deleted = await deleteDirectory(id)
          await loadDirectories()
          return deleted
        }}
        onProcessDirectory={async (id, mode, layout) => {
          const result = await processDirectory(id, mode, layout)
          await loadDirectories()
          showToast(zh('目录任务已启动', 'Directory task started'))
          return result
        }}
        onScanDirectory={async (id) => {
          const result = await scanDirectory(id)
          await loadDirectories()
          showToast(zh('目录扫描已启动', 'Directory scan started'))
          return result
        }}
        onRefreshDirectories={loadDirectories}
        proxyHost={config?.proxy_host || ''}
        proxyPort={Number.parseInt(config?.proxy_port, 10) || 0}
        onSaveProxySettings={async ({ host, port }) => {
          const cfg = await updateConfig({ proxy_host: host, proxy_port: port })
          useStore.setState({ config: cfg })
        }}
        allowLANAccess={configFlag(config?.allow_lan_access)}
        onSaveAllowLANAccess={async (enabled) => {
          const cfg = await updateConfig({ allow_lan_access: Boolean(enabled) })
          useStore.setState({ config: cfg })
        }}
        defaultPlayer={defaultPlayer}
        onSaveDefaultPlayer={async (player) => {
          const cfg = await updateConfig({ default_player: normalizeDefaultPlayer(player) })
          useStore.setState({ config: cfg })
        }}
        initialViewMode={initialViewMode}
        onSaveInitialViewMode={async (mode) => {
          const cfg = await updateConfig({ initial_view_mode: normalizeInitialViewMode(mode) })
          useStore.setState({ config: cfg })
        }}
        playerWindowWidth={
          Number.parseInt(config?.player_window_width, 10) ||
          Number.parseInt(config?.player_window_size, 10) ||
          80
        }
        playerWindowHeight={
          Number.parseInt(config?.player_window_height, 10) ||
          Number.parseInt(config?.player_window_size, 10) ||
          80
        }
        playerOntop={
          config?.player_ontop == null
            ? false
            : !['0', 'false', 'no', 'off'].includes(
                String(config.player_ontop).trim().toLowerCase()
              )
        }
        playerReuseWindow={
          config?.player_reuse_window == null
            ? true
            : !['0', 'false', 'no', 'off'].includes(
                String(config.player_reuse_window).trim().toLowerCase()
              )
        }
        playerResumePlayback={
          config?.player_resume_playback == null
            ? true
            : !['0', 'false', 'no', 'off'].includes(
                String(config.player_resume_playback).trim().toLowerCase()
              )
        }
        playerVolume={
          config?.player_volume === '0' ? 0 : Number.parseInt(config?.player_volume, 10) || 70
        }
        playerShowHotkeyHint={
          config?.player_show_hotkey_hint == null
            ? true
            : !['0', 'false', 'no', 'off'].includes(
                String(config.player_show_hotkey_hint).trim().toLowerCase()
              )
        }
        onSavePlayerBasicSettings={async (payload) => {
          const cfg = await updateConfig(payload)
          useStore.setState({ config: cfg })
        }}
        browserPlayerShowHotkeyHint={configFlag(config?.browser_player_show_hotkey_hint, true)}
        onSaveBrowserPlayerSettings={async (payload) => {
          const cfg = await updateConfig(payload)
          useStore.setState({ config: cfg })
        }}
        playerHotkeys={config?.player_hotkeys}
        onSavePlayerHotkeys={async (hotkeys) => {
          const cfg = await updateConfig({ player_hotkeys: hotkeys })
          useStore.setState({ config: cfg })
        }}
        webHotkeys={config?.web_hotkeys}
        onSaveWebHotkeys={async (hotkeys) => {
          const cfg = await updateConfig({ web_hotkeys: hotkeys })
          useStore.setState({ config: cfg })
        }}
        onChangePassword={changePassword}
        onLogout={logout}
      />
      <Toast open={Boolean(toastMessage)} message={toastMessage} onClose={closeToast} />
      <CenterToast
        open={Boolean(centerToastMessage)}
        message={centerToastMessage}
        onClose={closeCenterToast}
      />
    </div>
  )
}
