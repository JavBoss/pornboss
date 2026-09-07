import assert from 'node:assert/strict'
import test from 'node:test'
import { selectPlaybackSource, startBrowserPlayback } from '../src/utils/browserPlayback.js'

const direct = { kind: 'direct', src: '/videos/42/stream?location_id=7', mime_type: 'video/mp4' }
const hls = {
  kind: 'hls',
  src: '/videos/42/stream.m3u8?location_id=7',
  mime_type: 'application/vnd.apple.mpegurl',
}
const info = {
  preferred_kind: 'hls',
  video_codec: 'hevc',
  audio_codec: 'aac',
  sources: [direct, hls],
}

test('native HEVC support overrides the conservative server preference', () => {
  const media = {
    canPlayType: (type) => (type === 'video/mp4; codecs="hvc1, mp4a.40.2"' ? 'probably' : ''),
  }
  assert.equal(selectPlaybackSource(info, media), direct)
  assert.equal(selectPlaybackSource(info, { canPlayType: () => '' }), hls)
})

test('maybe support gets a direct attempt, including AV1 and alternate HEVC tags', () => {
  for (const [codec, hint] of [
    ['hevc', 'hev1'],
    ['av1', 'av01'],
  ]) {
    assert.equal(
      selectPlaybackSource(
        { ...info, video_codec: codec },
        {
          canPlayType: (type) => (type.includes(`"${hint},`) ? 'maybe' : ''),
        }
      ),
      direct
    )
  }
})

test('uses complete codec hints when a browser rejects bare AV1 and VP9 names', () => {
  for (const [codec, hint] of [
    ['av1', 'av01.0.04M.08'],
    ['vp9', 'vp09.00.10.08'],
  ]) {
    assert.equal(
      selectPlaybackSource(
        { ...info, video_codec: codec },
        {
          canPlayType: (type) =>
            type === `video/mp4; codecs="${hint}, mp4a.40.2"` ? 'probably' : '',
        }
      ),
      direct
    )
  }
})

test('checks the audio codec too and avoids a silent direct playback for unknown audio', () => {
  const media = { canPlayType: () => 'probably' }
  assert.equal(selectPlaybackSource({ ...info, audio_codec: 'dts' }, media), hls)
  assert.equal(selectPlaybackSource({ ...info, audio_codec: '' }, media), direct)
  assert.equal(
    selectPlaybackSource(
      { ...info, audio_codec: 'eac3' },
      {
        canPlayType: (type) => (type.includes('ec-3') ? '' : 'probably'),
      }
    ),
    hls
  )
})

test('MOV uses the MP4 playback hint when Chrome rejects QuickTime MIME', () => {
  const mov = { ...direct, mime_type: 'video/quicktime' }
  const movInfo = { ...info, video_codec: 'h264', sources: [mov, hls] }
  const media = {
    canPlayType: (type) => (type === 'video/mp4; codecs="avc1, mp4a.40.2"' ? 'probably' : ''),
  }
  const selected = selectPlaybackSource(movInfo, media)
  assert.deepEqual(selected, direct)
  assert.equal(mov.mime_type, 'video/quicktime')
  const player = new FakePlayer()
  startBrowserPlayback(player, selected, hls, 0, assert.fail)
  assert.deepEqual(player.sources, [{ src: direct.src, type: 'video/mp4' }])
  player.fail(4)
  assert.equal(player.sources[1].src, hls.src)
  assert.equal(selectPlaybackSource(movInfo, { canPlayType: () => '' }), hls)
  assert.equal(selectPlaybackSource({ ...movInfo, audio_codec: 'dts' }, media), hls)
})

test('MOV retains QuickTime MIME when the browser supports it natively', () => {
  const mov = { ...direct, mime_type: 'video/quicktime' }
  assert.equal(
    selectPlaybackSource(
      { ...info, sources: [mov, hls] },
      {
        canPlayType: (type) => (type.startsWith('video/quicktime;') ? 'probably' : ''),
      }
    ),
    mov
  )
})

test('does not apply the MOV MIME alias to other containers and supports older servers', () => {
  const mkv = { ...direct, mime_type: 'video/x-matroska' }
  assert.equal(
    selectPlaybackSource(
      { ...info, sources: [mkv, hls] },
      {
        canPlayType: (type) => (type.startsWith('video/mp4') ? 'probably' : ''),
      }
    ),
    hls
  )
  assert.equal(
    selectPlaybackSource(
      { preferred_kind: 'direct', sources: [direct, hls] },
      {
        canPlayType: () => 'maybe',
      }
    ),
    direct
  )
  assert.equal(selectPlaybackSource({ sources: [hls] }, {}), hls)
  assert.equal(selectPlaybackSource(null, {}), null)
})

class FakePlayer {
  events = new Map()
  sources = []
  time = 0
  rate = 1
  mediaError = null
  playCount = 0
  on(name, callback) {
    const listeners = this.events.get(name) || new Set()
    listeners.add(callback)
    this.events.set(name, listeners)
  }
  off(name, callback) {
    for (const listener of this.events.get(name) || []) {
      if (listener === callback || listener.original === callback)
        this.events.get(name).delete(listener)
    }
  }
  one(name, callback) {
    const once = () => {
      this.off(name, once)
      callback()
    }
    // Mirror Video.js off(event, originalCallback) for one-time listeners.
    once.original = callback
    this.on(name, once)
  }
  emit(name) {
    for (const callback of [...(this.events.get(name) || [])]) callback()
  }
  src(source) {
    this.sources.push(source)
    this.mediaError = null
    this.time = 0
    this.emit('timeupdate')
  }
  error() {
    return this.mediaError
  }
  currentTime(value) {
    if (value !== undefined) this.time = value
    return this.time
  }
  playbackRate(value) {
    if (value !== undefined) this.rate = value
    return this.rate
  }
  duration() {
    return 300
  }
  autoplay(value) {
    this.auto = value
  }
  play() {
    this.playCount++
    this.emit('play')
    return Promise.resolve()
  }
  fail(code) {
    this.mediaError = { code, message: 'media failed' }
    this.emit('error')
  }
}

test('decoding failure switches once to HLS and restores position and playback rate', () => {
  const player = new FakePlayer()
  const errors = []
  const cleanup = startBrowserPlayback(player, direct, hls, 45, (error) => errors.push(error))
  player.emit('loadedmetadata')
  assert.equal(player.time, 45)
  player.time = 92
  player.emit('timeupdate')
  player.rate = 1.5
  player.emit('ratechange')
  player.fail(3)
  assert.equal(player.sources[1].src, hls.src)
  player.emit('loadedmetadata')
  assert.equal(player.time, 92)
  assert.equal(player.rate, 1.5)
  player.fail(4)
  assert.equal(player.sources.length, 2)
  assert.equal(errors.length, 1)
  cleanup()
  player.fail(3)
  assert.equal(errors.length, 1)
})

test('source rejection before metadata preserves initial seek and pause intent survives fallback', () => {
  const player = new FakePlayer()
  const cleanup = startBrowserPlayback(player, direct, hls, 120, assert.fail)
  player.fail(4)
  player.emit('loadedmetadata')
  assert.equal(player.time, 120)
  cleanup()

  const paused = new FakePlayer()
  startBrowserPlayback(paused, direct, hls, 0, assert.fail)
  paused.emit('loadedmetadata')
  paused.emit('pause')
  paused.fail(3)
  paused.emit('loadedmetadata')
  assert.equal(paused.auto, false)
  assert.equal(paused.playCount, 1)
})

test('network errors and autoplay rejection do not trigger transcoding', async () => {
  const player = new FakePlayer()
  const errors = []
  player.play = () => Promise.reject(new Error('NotAllowedError'))
  startBrowserPlayback(player, direct, hls, 0, (error) => errors.push(error))
  player.emit('loadedmetadata')
  await Promise.resolve()
  player.fail(2)
  assert.equal(player.sources.length, 1)
  assert.equal(errors.length, 1)
})

test('cleanup removes pending source restoration when the player closes', () => {
  const player = new FakePlayer()
  const cleanup = startBrowserPlayback(player, direct, hls, 45, assert.fail)
  cleanup()
  player.emit('loadedmetadata')
  assert.equal(player.playCount, 0)
})
