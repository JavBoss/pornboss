// These are advisory family probes, not the file's RFC 6381 codec string.
// Some browsers require a complete profile/level even for a capability query.
// Actual media errors still trigger HLS if the file's profile cannot decode.
const VIDEO_CODECS = {
  h264: ['avc1', 'avc1.42E01E'],
  hevc: ['hvc1', 'hev1', 'hvc1.1.6.L93.B0', 'hvc1.2.4.L153.B0', 'hev1.1.6.L93.B0'],
  av1: ['av01', 'av01.0.04M.08', 'av01.0.04M.10'],
  vp8: ['vp8'],
  vp9: ['vp9', 'vp09.00.10.08', 'vp09.02.10.10'],
  theora: ['theora'],
}
const AUDIO_CODECS = {
  aac: ['mp4a.40.2'],
  mp3: ['mp3', 'mp4a.69'],
  opus: ['opus'],
  vorbis: ['vorbis'],
  flac: ['flac'],
  ac3: ['ac-3'],
  eac3: ['ec-3'],
}

export function selectPlaybackSource(info, media) {
  const sources = info?.sources || []
  const direct = sources.find((source) => source.kind === 'direct')
  const hls = sources.find((source) => source.kind === 'hls')
  if (!direct) return hls || sources[0] || null
  if (typeof media?.canPlayType !== 'function') {
    return info.preferred_kind === 'direct' ? direct : hls || direct
  }

  const videoCodecs = VIDEO_CODECS[info.video_codec]
  const audioCodecs = info.audio_codec ? AUDIO_CODECS[info.audio_codec] : ['']
  // Retain compatibility with older servers that do not send codec metadata.
  if (!info.video_codec && info.preferred_kind === 'direct') {
    return media.canPlayType(direct.mime_type) ? direct : hls || direct
  }
  if (videoCodecs && audioCodecs) {
    // Chromium rejects the QuickTime MIME even for MOV files its native MP4
    // demuxer can read. Probe that path too, and give Video.js the same MIME
    // so its source handler does not reject the file before trying playback.
    // This changes only the playback hint; unsupported MOV contents still
    // fall back to HLS on a real media error.
    const candidates =
      direct.mime_type === 'video/quicktime'
        ? [direct, { ...direct, mime_type: 'video/mp4' }]
        : [direct]
    for (const candidate of candidates) {
      for (const videoCodec of videoCodecs) {
        for (const audioCodec of audioCodecs) {
          const codecs = [videoCodec, audioCodec].filter(Boolean).join(', ')
          const support = media.canPlayType(`${candidate.mime_type}; codecs="${codecs}"`)
          if (support === 'probably' || support === 'maybe') return candidate
        }
      }
    }
  }
  return hls || direct
}

// Keep a single Video.js instance through fallback. Register error handling
// before setting src, since source selection itself may fail asynchronously.
export function startBrowserPlayback(player, source, fallback, startTime, onError) {
  let activeSource = source
  let position = Math.max(0, Number(startTime) || 0)
  let shouldPlay = true
  let playbackRate = player.playbackRate()
  let restorePosition = null

  const rememberPosition = () => {
    if (!restorePosition) {
      const current = player.currentTime()
      if (Number.isFinite(current)) position = current
    }
  }
  const rememberPlay = () => {
    shouldPlay = true
  }
  const rememberPause = () => {
    if (!player.error() && !restorePosition) shouldPlay = false
  }
  const rememberRate = () => {
    if (!restorePosition) playbackRate = player.playbackRate()
  }
  const load = (nextSource) => {
    if (restorePosition) player.off('loadedmetadata', restorePosition)
    restorePosition = () => {
      restorePosition = null
      const duration = player.duration()
      const target = Number.isFinite(duration) ? Math.min(position, duration) : position
      if (target > 0) player.currentTime(target)
      player.playbackRate(playbackRate)
      if (shouldPlay) {
        // Autoplay rejection is not a decoding failure. Let the user press play.
        player.play()?.catch(() => {})
      }
    }
    player.one('loadedmetadata', restorePosition)
    player.src({ src: nextSource.src, type: nextSource.mime_type })
  }
  const handleError = () => {
    const error = player.error()
    if (!error) return
    if (activeSource.kind === 'direct' && fallback && [3, 4].includes(error.code)) {
      activeSource = fallback
      // src() clears the previous media error. Switch only once per video.
      player.autoplay(shouldPlay)
      load(fallback)
      return
    }
    onError(error)
  }

  player.on('error', handleError)
  player.on('timeupdate', rememberPosition)
  player.on('seeking', rememberPosition)
  player.on('play', rememberPlay)
  player.on('pause', rememberPause)
  player.on('ratechange', rememberRate)
  load(source)

  return () => {
    player.off('error', handleError)
    player.off('timeupdate', rememberPosition)
    player.off('seeking', rememberPosition)
    player.off('play', rememberPlay)
    player.off('pause', rememberPause)
    player.off('ratechange', rememberRate)
    if (restorePosition) player.off('loadedmetadata', restorePosition)
  }
}
