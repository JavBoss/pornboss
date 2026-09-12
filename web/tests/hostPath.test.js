import assert from 'node:assert/strict'
import test from 'node:test'
import { apiHostPath, displayHostPath, hostPathsEnabled } from '../src/utils/hostPath.js'

test('directory pickers default to host paths in containers and respect explicit configuration', () => {
  for (const [config, expected] of [
    [undefined, false],
    [{}, false],
    [{ runtime_container: 'false' }, false],
    [{ runtime_container: 'true' }, true],
    [{ runtime_container: true }, true],
    [{ runtime_container: '1', host_path_prefix_enabled: '' }, true],
    [{ runtime_container: 'true', host_path_prefix_enabled: 'false' }, false],
    [{ runtime_container: true, host_path_prefix_enabled: false }, false],
    [{ runtime_container: 'true', host_path_prefix_enabled: '0' }, false],
    [{ runtime_container: 'false', host_path_prefix_enabled: 'true' }, true],
  ]) {
    assert.equal(hostPathsEnabled(config), expected, JSON.stringify(config))
  }
})

test('selected and manually entered host paths round trip without duplicating the mount prefix', () => {
  for (const [display, server] of [
    ['/', '/host'],
    ['/mnt/c/downloads', '/host/mnt/c/downloads'],
    ['', ''],
  ]) {
    assert.equal(apiHostPath(display, true), server)
    assert.equal(displayHostPath(server, true), display)
    assert.equal(apiHostPath(server, true), server)
  }
})

test('native directory paths remain unchanged', () => {
  for (const path of ['/mnt/downloads', 'C:\\Downloads']) {
    assert.equal(apiHostPath(path, false), path)
    assert.equal(displayHostPath(path, false), path)
  }
})
