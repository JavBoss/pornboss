import { useEffect, useMemo, useRef, useState } from 'react'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import videojs from 'video.js'
import 'video.js/dist/video-js.css'
import { createVideoScreenshot, fetchPlaybackInfo } from '@/api'
import { getVideoDisplayName } from '@/utils/display'
import {
  PLAYER_HOTKEY_ACTIONS,
  formatPlayerHotkeyKey,
  normalizePlayerHotkeyKey,
  parsePlayerHotkeys,
} from '@/utils/playerHotkeys'
import { zh } from '@/utils/i18n'
import AppModal from '@/components/AppModal'
import { getErrorMessage } from '@/utils/errors'
import { selectPlaybackSource, startBrowserPlayback } from '@/utils/browserPlayback'

const VOLUME_STORAGE_KEY = 'javboss.player.volume'
const HOTKEY_HINT_DURATION_MS = 5000

function formatSignedAmount(amount) {
  return amount > 0 ? `+${amount}` : String(amount)
}

export default function PlayerModal({
  video,
  startTime = 0,
  onClose,
  hotkeys = null,
  showHotkeyHint = true,
  onPlaybackError,
}) {
  const videoContainerRef = useRef(null)
  const playerRef = useRef(null)
  const onCloseRef = useRef(onClose)
  const onPlaybackErrorRef = useRef(onPlaybackError)
  const hotkeyMapRef = useRef(new Map())
  const screenshotInFlightRef = useRef(false)
  const screenshotNoticeTimerRef = useRef(null)
  const [playbackInfo, setPlaybackInfo] = useState(null)
  const [playbackError, setPlaybackError] = useState('')
  const [loadingPlayback, setLoadingPlayback] = useState(false)
  const [screenshotNotice, setScreenshotNotice] = useState(false)
  const [hotkeyHintVisible, setHotkeyHintVisible] = useState(false)
  const normalizedHotkeys = useMemo(() => parsePlayerHotkeys(hotkeys), [hotkeys])
  const hotkeyHintLines = useMemo(() => {
    const lines = normalizedHotkeys.map((item) => {
      const key = formatPlayerHotkeyKey(item.key)
      const amount = formatSignedAmount(item.amount)
      if (item.action === PLAYER_HOTKEY_ACTIONS.SEEK) {
        return zh(`${key}：进度 ${amount} 秒`, `${key}: Seek ${amount} seconds`)
      }
      if (item.action === PLAYER_HOTKEY_ACTIONS.VOLUME) {
        return zh(`${key}：音量 ${amount}%`, `${key}: Volume ${amount}%`)
      }
      return zh(`${key}：截图`, `${key}: Screenshot`)
    })
    lines.push(zh('空格：暂停/继续', 'Space: Pause/Resume'))
    lines.push(zh('ESC：退出播放器', 'ESC: Close player'))
    lines.push(
      zh(
        '你可在「设置 → 播放器 → 浏览器播放器」里关闭此信息显示',
        'You can hide this message under Settings → Player → Browser Player.'
      )
    )
    return lines
  }, [normalizedHotkeys])
  const selectedSource = useMemo(() => {
    return selectPlaybackSource(playbackInfo, document.createElement('video'))
  }, [playbackInfo])

  useEffect(() => {
    setHotkeyHintVisible(false)
    if (!showHotkeyHint || !video?.id || !selectedSource?.src) return undefined

    setHotkeyHintVisible(true)
    const timer = window.setTimeout(() => setHotkeyHintVisible(false), HOTKEY_HINT_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [selectedSource?.src, showHotkeyHint, video?.id])

  useEffect(() => {
    hotkeyMapRef.current = new Map(normalizedHotkeys.map((item) => [item.key, item]))
  }, [normalizedHotkeys])

  useEffect(() => {
    onCloseRef.current = onClose
    onPlaybackErrorRef.current = onPlaybackError
  }, [onClose, onPlaybackError])

  useEffect(() => {
    return () => {
      if (screenshotNoticeTimerRef.current !== null) {
        window.clearTimeout(screenshotNoticeTimerRef.current)
        screenshotNoticeTimerRef.current = null
      }
    }
  }, [video?.id, video?.location_id])

  useEffect(() => {
    if (!video?.id) {
      setPlaybackInfo(null)
      setPlaybackError('')
      setLoadingPlayback(false)
      setScreenshotNotice(false)
      return
    }

    let cancelled = false
    setLoadingPlayback(true)
    setPlaybackError('')
    setPlaybackInfo(null)
    setScreenshotNotice(false)

    fetchPlaybackInfo(video.id, { locationId: video.location_id })
      .then((info) => {
        if (cancelled) return
        setPlaybackInfo(info)
      })
      .catch((err) => {
        if (cancelled) return
        const message = getErrorMessage(err)
        setPlaybackError(message)
        onPlaybackErrorRef.current?.(message)
      })
      .finally(() => {
        if (cancelled) return
        setLoadingPlayback(false)
      })

    return () => {
      cancelled = true
    }
  }, [video])

  useEffect(() => {
    if (loadingPlayback || !video || !videoContainerRef.current || !selectedSource?.src) return

    // Video.js removes its element on dispose; let React own only the container.
    const videoElement = document.createElement('video-js')
    videoElement.classList.add('video-js', 'vjs-big-play-centered', 'h-full', 'w-full')
    videoElement.setAttribute('playsinline', '')
    videoContainerRef.current.appendChild(videoElement)
    const player = videojs(videoElement, {
      controls: true,
      autoplay: true,
      preload: 'auto',
    })

    playerRef.current = player

    const playerEl = player.el()
    const savedVolume = (() => {
      try {
        const raw = localStorage.getItem(VOLUME_STORAGE_KEY)
        if (raw == null) return null
        const value = Number.parseFloat(raw)
        return Number.isFinite(value) ? value : null
      } catch {
        return null
      }
    })()

    if (savedVolume != null) {
      player.volume(Math.min(1, Math.max(0, savedVolume)))
    }

    const seekBy = (offsetSeconds) => {
      const current = player.currentTime() || 0
      const duration = player.duration()
      let next = current + offsetSeconds
      if (Number.isFinite(duration)) {
        next = Math.min(Math.max(0, next), duration)
      } else {
        next = Math.max(0, next)
      }
      player.currentTime(next)
    }

    const adjustVolume = (delta) => {
      const current = player.volume()
      const next = Math.min(1, Math.max(0, current + delta))
      player.volume(next)
    }

    const captureScreenshot = () => {
      if (!video?.id || screenshotInFlightRef.current) return
      const second = Math.max(0, Number(player.currentTime()) || 0)
      screenshotInFlightRef.current = true
      createVideoScreenshot(video.id, { second, locationId: video.location_id })
        .then(() => {
          // A response from a closed player must not recreate its notice timer.
          if (player.isDisposed()) return
          if (screenshotNoticeTimerRef.current) {
            window.clearTimeout(screenshotNoticeTimerRef.current)
          }
          setScreenshotNotice(true)
          screenshotNoticeTimerRef.current = window.setTimeout(() => {
            setScreenshotNotice(false)
            screenshotNoticeTimerRef.current = null
          }, 1600)
        })
        .catch((err) => {
          console.error(zh('截图失败', 'Failed to capture screenshot'), err)
        })
        .finally(() => {
          screenshotInFlightRef.current = false
        })
    }

    const handleKeyDown = (event) => {
      const target = event.target
      if (
        target instanceof Element &&
        (target.isContentEditable ||
          target.closest('input, textarea, select, [contenteditable="true"]'))
      ) {
        return
      }
      const key = normalizePlayerHotkeyKey(event.key || '')
      const configured = hotkeyMapRef.current.get(key)
      const markHandled = () => {
        event.preventDefault()
        event.stopPropagation()
      }
      if (
        configured &&
        (configured.action === PLAYER_HOTKEY_ACTIONS.SEEK ||
          configured.action === PLAYER_HOTKEY_ACTIONS.VOLUME ||
          configured.action === PLAYER_HOTKEY_ACTIONS.SCREENSHOT)
      ) {
        markHandled()
        if (configured.action === PLAYER_HOTKEY_ACTIONS.SEEK) {
          seekBy(configured.amount)
        } else if (configured.action === PLAYER_HOTKEY_ACTIONS.VOLUME) {
          adjustVolume(configured.amount / 100)
        } else if (configured.action === PLAYER_HOTKEY_ACTIONS.SCREENSHOT) {
          captureScreenshot()
        }
        return
      }
      switch (key) {
        case ' ':
        case 'Spacebar': {
          markHandled()
          if (player.paused()) {
            player.play()
          } else {
            player.pause()
          }
          break
        }
        case 'Escape':
          markHandled()
          onCloseRef.current?.()
          break
        default:
          return
      }
    }

    const focusPlayer = () => {
      playerEl?.focus({ preventScroll: true })
    }

    if (playerEl && !playerEl.hasAttribute('tabindex')) {
      playerEl.setAttribute('tabindex', '-1')
    }

    window.addEventListener('keydown', handleKeyDown, true)

    const handleVolumeChange = () => {
      try {
        localStorage.setItem(VOLUME_STORAGE_KEY, String(player.volume()))
      } catch {
        return
      }
    }

    const stopPlayback = startBrowserPlayback(
      player,
      selectedSource,
      playbackInfo.sources.find((source) => source.kind === 'hls'),
      startTime,
      (error) => {
        const message = error.message || zh('视频播放失败', 'Video playback failed')
        setPlaybackError(message)
        onPlaybackErrorRef.current?.(message)
      }
    )
    player.ready(focusPlayer)
    player.on('fullscreenchange', focusPlayer)
    player.on('volumechange', handleVolumeChange)

    return () => {
      stopPlayback()
      window.removeEventListener('keydown', handleKeyDown, true)
      player.off('fullscreenchange', focusPlayer)
      player.off('volumechange', handleVolumeChange)
      player.dispose()
      playerRef.current = null
    }
  }, [video, startTime, selectedSource, playbackInfo, loadingPlayback])

  if (!video) return null

  const displayName = getVideoDisplayName(video)

  return (
    <AppModal
      ariaLabel={displayName || zh('视频播放', 'Video playback')}
      backdropColor="rgba(0, 0, 0, 0.7)"
      className="px-4"
      contentClassName="relative w-full max-w-6xl rounded-lg bg-white shadow-lg"
      onClose={onClose}
      zIndex={1700}
    >
      <div className="flex flex-col gap-1.5 p-2">
        <header className="flex min-w-0 items-center gap-2">
          <h2
            className="min-w-0 flex-1 truncate text-xs font-semibold leading-4"
            title={displayName}
          >
            {displayName}
          </h2>
          <button
            type="button"
            aria-label={zh('关闭', 'Close')}
            title={zh('关闭', 'Close')}
            onClick={onClose}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <CloseRoundedIcon sx={{ fontSize: 14 }} />
          </button>
        </header>
        <div className="player-shell relative w-full bg-black">
          {screenshotNotice || hotkeyHintVisible ? (
            <div className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-col items-start gap-2">
              {screenshotNotice ? (
                <div className="rounded bg-black/75 px-3 py-1.5 text-sm font-medium text-white shadow">
                  {zh('截图成功', 'Screenshot saved')}
                </div>
              ) : null}
              {hotkeyHintVisible ? (
                <div className="max-h-[calc(100vh-12rem)] overflow-hidden rounded bg-black/75 px-3 py-2 text-xs leading-5 text-white shadow">
                  {hotkeyHintLines.map((line, index) => (
                    <div key={`${index}-${line}`}>{line}</div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {loadingPlayback ? (
            <div className="flex aspect-video items-center justify-center text-sm text-white">
              {zh('加载播放信息中…', 'Loading playback info...')}
            </div>
          ) : (
            <>
              <div ref={videoContainerRef} data-vjs-player className="h-full w-full" />
              {playbackError ? (
                <div role="alert" className="px-6 py-4 text-center text-sm text-red-200">
                  {playbackError}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </AppModal>
  )
}
