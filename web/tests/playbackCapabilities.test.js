import assert from 'node:assert/strict'
import test from 'node:test'
import { canOpenAlternatePlayer } from '../src/utils/playbackCapabilities.js'

test('client MPV remains available when connected to a Docker server', () => {
  for (const containerMode of [false, true]) {
    assert.equal(
      canOpenAlternatePlayer({ containerMode, clientMode: true, alternatePlayer: 'mpv' }),
      true
    )
  }
})

test('Docker still blocks server-side players and client system-file opening', () => {
  for (const clientMode of [false, true]) {
    for (const alternatePlayer of ['system', '']) {
      assert.equal(
        canOpenAlternatePlayer({ containerMode: true, clientMode, alternatePlayer }),
        false
      )
    }
  }
  assert.equal(
    canOpenAlternatePlayer({
      containerMode: true,
      clientMode: false,
      alternatePlayer: 'mpv',
    }),
    false
  )
})

test('native server playback is not restricted by the Docker guard', () => {
  for (const alternatePlayer of ['system', 'mpv']) {
    assert.equal(
      canOpenAlternatePlayer({ containerMode: false, clientMode: false, alternatePlayer }),
      true
    )
  }
})
