import { zh } from '@/utils/i18n'
import { getErrorMessage } from '@/utils/errors'

const jsonHeaders = { 'Content-Type': 'application/json' }
const javIdolResolveInFlight = new Map()
const javSampleImagesResolveInFlight = new Map()
const javSampleImagesResolved = new Map()
export const authExpiredEvent = 'javboss:auth-expired'

async function apiError(res) {
  const payload = await res.json().catch(() => ({}))
  return new Error(
    getErrorMessage(zh(String(payload.error_zh || ''), String(payload.error_en || '')))
  )
}

async function apiFetch(input, init = {}) {
  const res = await fetch(input, init)
  if (res.status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(authExpiredEvent))
  }
  return res
}

async function parseJSONResponse(res) {
  const contentType = String(res.headers.get('content-type') || '').toLowerCase()
  if (!contentType.includes('json')) {
    throw new Error(
      zh(
        '服务端接口返回了网页，请确认后端已更新并重启',
        'The server returned a web page. Make sure the backend is updated and restarted.'
      )
    )
  }
  return res.json()
}

export async function fetchAuthStatus() {
  const res = await fetch('/auth/status', { cache: 'no-store' })
  if (!res.ok) throw await apiError(res)
  return res.json()
}

export async function loginWithPassword(password) {
  const res = await fetch('/auth/login', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ password }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function logoutSession() {
  const res = await fetch('/auth/logout', { method: 'POST' })
  if (!res.ok && res.status !== 401) {
    throw await apiError(res)
  }
}

export async function changePassword(currentPassword, newPassword) {
  const res = await apiFetch('/auth/password', {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
}

export async function fetchVideos({
  limit = 25,
  offset = 0,
  tags = [],
  search = '',
  sort = '',
  seed = null,
  hideJav = false,
} = {}) {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  if (tags.length) params.set('tags', tags.join(','))
  if (search) params.set('search', search)
  if (sort) params.set('sort', sort)
  if (seed != null) params.set('seed', String(seed))
  params.set('hide_jav', hideJav ? '1' : '0')
  const res = await apiFetch(`/videos?${params.toString()}`)
  if (!res.ok) throw await apiError(res)
  const data = await res.json()
  // Support both new shape {items,total} and legacy array for backward compatibility
  if (Array.isArray(data)) {
    return { items: data, total: data.length }
  }
  return data
}

export async function fetchTags({ hideJav = false } = {}) {
  const params = new URLSearchParams()
  params.set('hide_jav', hideJav ? '1' : '0')
  const query = params.toString()
  const res = await apiFetch(`/tags${query ? `?${query}` : ''}`)
  if (!res.ok) throw await apiError(res)
  return res.json()
}

export async function createTag(name) {
  const res = await apiFetch('/tags', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function fetchTagCategories() {
  const res = await apiFetch('/tags/categories')
  if (!res.ok) throw await apiError(res)
  return res.json()
}

export async function createTagCategory(name) {
  const res = await apiFetch('/tags/categories', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw await apiError(res)
  return res.json()
}

export async function reorderTagCategories(categoryIds) {
  const res = await apiFetch('/tags/categories/order', {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify({ category_ids: categoryIds }),
  })
  if (!res.ok) throw await apiError(res)
}

export async function renameTagCategory(id, name) {
  const res = await apiFetch(`/tags/categories/${id}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw await apiError(res)
}

export async function deleteTagCategory(id) {
  const res = await apiFetch(`/tags/categories/${id}`, { method: 'DELETE' })
  if (!res.ok) throw await apiError(res)
}

export async function assignTagsCategory(tagIds, categoryId) {
  const res = await apiFetch('/tags/category', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ tag_ids: tagIds, category_id: categoryId }),
  })
  if (!res.ok) throw await apiError(res)
}

export async function fetchConfig() {
  const res = await apiFetch('/config')
  if (!res.ok) throw await apiError(res)
  return res.json()
}

export async function updateConfig(payload) {
  const res = await apiFetch('/config', {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function fetchTools() {
  const res = await apiFetch('/tools', { cache: 'no-store' })
  if (!res.ok) throw await apiError(res)
  return parseJSONResponse(res)
}

export async function downloadFFmpeg() {
  const res = await apiFetch('/tools/ffmpeg/download', { method: 'POST' })
  if (!res.ok) throw await apiError(res)
  return parseJSONResponse(res)
}

export async function deleteTag(id) {
  const res = await apiFetch(`/tags/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    throw await apiError(res)
  }
}

export async function deleteTagsBatch(tagIds) {
  const res = await apiFetch('/tags/batch_delete', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ tag_ids: tagIds }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
}

export async function renameTag(id, name) {
  const res = await apiFetch(`/tags/${id}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
}

export async function addTagToVideos(tagId, videoIds) {
  const res = await apiFetch('/videos/tags/add', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ tag_id: tagId, video_ids: videoIds }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
}

export async function removeTagFromVideos(tagId, videoIds) {
  const res = await apiFetch('/videos/tags/remove', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ tag_id: tagId, video_ids: videoIds }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
}

export async function replaceTagsForVideos(videoIds, tagIds) {
  const res = await apiFetch('/videos/tags/replace', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ video_ids: videoIds, tag_ids: tagIds }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
}

export async function openVideoFile({ path, dirPath }) {
  const res = await apiFetch('/videos/open', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ path, dir_path: dirPath }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
}

export async function playVideoFile({ id, locationId, path, dirPath, startTime }) {
  const res = await apiFetch('/videos/play', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      video_id: id,
      location_id: locationId,
      path,
      dir_path: dirPath,
      start_time: startTime,
    }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
}

export async function playVideoPlaylist(items) {
  const res = await apiFetch('/videos/playlist', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ items }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function revealVideoLocation({ path, dirPath }) {
  const res = await apiFetch('/videos/reveal', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ path, dir_path: dirPath }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
}

export async function incrementVideoPlayCount(id) {
  const res = await apiFetch(`/videos/${id}/play`, { method: 'POST' })
  if (!res.ok) {
    throw await apiError(res)
  }
}

export async function fetchPlaybackInfo(id, { locationId } = {}) {
  const params = new URLSearchParams()
  if (locationId) params.set('location_id', String(locationId))
  const query = params.toString()
  const res = await apiFetch(`/videos/${id}/streams${query ? `?${query}` : ''}`)
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function fetchVideoScreenshots(id) {
  const res = await apiFetch(`/videos/${id}/screenshots`, { cache: 'no-store' })
  if (!res.ok) {
    throw await apiError(res)
  }
  const data = await res.json()
  return Array.isArray(data?.items) ? data.items : []
}

export async function fetchVideoScreenshotsByIds(videoIds) {
  const params = new URLSearchParams()
  params.set('video_id_list', (videoIds || []).join(','))
  const res = await apiFetch(`/videos/screenshots?${params.toString()}`, { cache: 'no-store' })
  if (!res.ok) {
    throw await apiError(res)
  }
  const data = await res.json()
  return Array.isArray(data?.items) ? data.items : []
}

export async function createVideoScreenshot(id, { second = 0, locationId } = {}) {
  const params = new URLSearchParams()
  if (locationId) params.set('location_id', String(locationId))
  const query = params.toString()
  const res = await apiFetch(`/videos/${id}/screenshots${query ? `?${query}` : ''}`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ second }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function deleteVideoScreenshot(videoId, name) {
  const res = await apiFetch(`/videos/${videoId}/screenshots/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    throw await apiError(res)
  }
}

export async function updateVideoCover(videoId, screenshotName) {
  const res = await apiFetch(`/videos/${videoId}/cover`, {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify({ screenshot_name: screenshotName }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function resetVideoCover(videoId) {
  const res = await apiFetch(`/videos/${videoId}/cover`, { method: 'DELETE' })
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function renameVideoLocation(videoId, locationId, filename) {
  const res = await apiFetch(`/videos/${videoId}/locations/${locationId}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({ filename }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function deleteVideoLocation(videoId, locationId) {
  const res = await apiFetch(`/videos/${videoId}/locations/${locationId}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    throw await apiError(res)
  }
}

export async function updateVideoJavScrapeSettings(videoId, { mode = 'auto', code = '' } = {}) {
  const res = await apiFetch(`/videos/${videoId}/jav-scrape`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({ mode, code }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function fetchVideoJavScrapePossibleCodes(videoId) {
  const res = await apiFetch(`/videos/${videoId}/jav-scrape/possible-codes`)
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function manualVideoJavScrape(videoId, locationId, info) {
  const res = await apiFetch(`/videos/${videoId}/jav-scrape/manual`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ ...(info || {}), location_id: locationId }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function linkVideoToExistingJav(videoId, locationId, code) {
  const res = await apiFetch(`/videos/${videoId}/jav-scrape/link`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ location_id: locationId, code }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

// Directories
export async function fetchDirectories() {
  const res = await apiFetch('/directories', { cache: 'no-store' })
  if (!res.ok) throw await apiError(res)
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('application/json')) {
    console.warn(
      zh('目录接口返回非 JSON，响应类型:', 'Directory API returned non-JSON content type:'),
      ct
    )
    return []
  }
  return res.json()
}

export async function createDirectory({ path }) {
  const res = await apiFetch('/directories', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ path }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function pickDirectory() {
  const res = await apiFetch('/directories/pick', {
    method: 'POST',
  })
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function updateDirectory(id, payload) {
  const res = await apiFetch(`/directories/${id}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function deleteDirectory(id) {
  return updateDirectory(id, { is_delete: true })
}

export async function processDirectory(id, mode, layout = 'prefix') {
  const res = await apiFetch(`/directories/${id}/process`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ mode, layout }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function scanDirectory(id) {
  const res = await apiFetch(`/directories/${id}/scan`, {
    method: 'POST',
  })
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function fetchJavs({
  limit = 25,
  offset = 0,
  search = '',
  idolIds = [],
  tagIds = [],
  studioId = null,
  seriesId = null,
  prefix = '',
  soloOnly = false,
  favoriteRatingEnabled = false,
  favoriteRatingMin = 0.5,
  favoriteRatingMax = 5,
  sort = '',
  seed = null,
  favoriteGroupId = null,
} = {}) {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  if (search) params.set('search', search)
  if (idolIds.length) params.set('idol_ids', idolIds.join(','))
  if (tagIds.length) params.set('tag_ids', tagIds.join(','))
  if (studioId !== null && studioId !== undefined) params.set('studio_id', String(studioId))
  if (seriesId) params.set('series_id', String(seriesId))
  if (prefix) params.set('prefix', prefix)
  if (soloOnly) params.set('solo', '1')
  if (favoriteRatingEnabled) {
    params.set('favorite_rating_min', String(favoriteRatingMin))
    params.set('favorite_rating_max', String(favoriteRatingMax))
  }
  if (sort) params.set('sort', sort)
  if (seed != null) params.set('seed', String(seed))
  if (favoriteGroupId) params.set('favorite_group_id', String(favoriteGroupId))
  const res = await apiFetch(`/jav?${params.toString()}`)
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function fetchJavFilterOptions({
  search = '',
  idolIds = [],
  tagIds = [],
  studioId = null,
  seriesId = null,
  prefix = '',
  soloOnly = false,
  favoriteRatingEnabled = false,
  favoriteRatingMin = 0.5,
  favoriteRatingMax = 5,
  favoriteGroupId = null,
  prefixSearch = '',
  idolSearch = '',
  tagSearch = '',
  studioSearch = '',
  seriesSearch = '',
  optionLimit = 120,
  signal,
} = {}) {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (idolIds.length) params.set('idol_ids', idolIds.join(','))
  if (tagIds.length) params.set('tag_ids', tagIds.join(','))
  if (studioId !== null && studioId !== undefined) params.set('studio_id', String(studioId))
  if (seriesId) params.set('series_id', String(seriesId))
  if (prefix) params.set('prefix', prefix)
  if (soloOnly) params.set('solo', '1')
  if (favoriteRatingEnabled) {
    params.set('favorite_rating_min', String(favoriteRatingMin))
    params.set('favorite_rating_max', String(favoriteRatingMax))
  }
  if (favoriteGroupId) params.set('favorite_group_id', String(favoriteGroupId))
  if (prefixSearch) params.set('prefix_search', prefixSearch)
  if (idolSearch) params.set('idol_search', idolSearch)
  if (tagSearch) params.set('tag_search', tagSearch)
  if (studioSearch) params.set('studio_search', studioSearch)
  if (seriesSearch) params.set('series_search', seriesSearch)
  params.set('option_limit', String(optionLimit))
  const res = await apiFetch(`/jav/filter-options?${params.toString()}`, { signal })
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function fetchDownloaderSettings() {
  const res = await apiFetch('/downloader/settings', { cache: 'no-store' })
  if (!res.ok) throw await apiError(res)
  return parseJSONResponse(res)
}

export async function updateDownloaderSettings(payload) {
  const res = await apiFetch('/downloader/settings', {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw await apiError(res)
  return parseJSONResponse(res)
}

export async function updateCloudDrive2Settings(payload) {
  const res = await apiFetch('/downloader/clouddrive2', {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw await apiError(res)
  return parseJSONResponse(res)
}

export async function fetchCloudDrive2Token() {
  const res = await apiFetch('/downloader/clouddrive2/token', {
    cache: 'no-store',
  })
  if (!res.ok) throw await apiError(res)
  return parseJSONResponse(res)
}

export async function testCloudDrive2() {
  const res = await apiFetch('/downloader/clouddrive2/test', {
    method: 'POST',
  })
  if (!res.ok) throw await apiError(res)
  return parseJSONResponse(res)
}

export async function fetchDownloadJobs({ limit = 100 } = {}) {
  const res = await apiFetch(`/downloads?limit=${encodeURIComponent(limit)}`, {
    cache: 'no-store',
  })
  if (!res.ok) throw await apiError(res)
  return parseJSONResponse(res)
}

export async function createDownloadJob({ magnetUrl }) {
  const res = await apiFetch('/downloads', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      magnet_url: magnetUrl,
    }),
  })
  if (!res.ok) throw await apiError(res)
  return parseJSONResponse(res)
}

export async function retryDownloadJob(id) {
  const res = await apiFetch(`/downloads/${encodeURIComponent(id)}/retry`, {
    method: 'POST',
  })
  if (!res.ok) throw await apiError(res)
}

export async function cancelDownloadJob(id) {
  const res = await apiFetch(`/downloads/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
  })
  if (!res.ok) throw await apiError(res)
}

export async function revealDownloadLocation(id) {
  const res = await apiFetch(`/downloads/${id}/reveal`, { method: 'POST' })
  if (!res.ok) {
    throw await apiError(res)
  }
}

export async function deleteDownloadJob(id) {
  const res = await apiFetch(`/downloads/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw await apiError(res)
}

function javSampleImagesRequest(id) {
  const javId = Number(id)
  return {
    javId,
    requestKey: String(javId),
  }
}

export function getResolvedJavSampleImages(id) {
  const { javId, requestKey } = javSampleImagesRequest(id)
  if (!Number.isFinite(javId) || javId <= 0) return null
  return javSampleImagesResolved.get(requestKey) || null
}

export function resolveJavSampleImages(id) {
  const { javId, requestKey } = javSampleImagesRequest(id)
  if (!Number.isFinite(javId) || javId <= 0) return Promise.resolve([])
  const resolved = javSampleImagesResolved.get(requestKey)
  if (resolved) return Promise.resolve(resolved)

  const existing = javSampleImagesResolveInFlight.get(requestKey)
  if (existing) return existing

  const request = apiFetch(`/jav/items/${encodeURIComponent(javId)}/sample-images`, {
    method: 'POST',
    cache: 'no-store',
  })
    .then(async (res) => {
      if (!res.ok) throw await apiError(res)
      const payload = await res.json()
      const images = Array.isArray(payload?.sample_images) ? payload.sample_images : []
      javSampleImagesResolved.set(requestKey, images)
      return images
    })
    .finally(() => {
      javSampleImagesResolveInFlight.delete(requestKey)
    })
  javSampleImagesResolveInFlight.set(requestKey, request)
  return request
}

export async function fetchJavPrefixes() {
  const res = await apiFetch('/jav/prefixes')
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function fetchJavTags() {
  const res = await apiFetch('/jav/tags')
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function fetchJavTagCategories() {
  const res = await apiFetch('/jav/tag-categories')
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function updateJavCover(code, url) {
  const res = await apiFetch(`/jav/${encodeURIComponent(code)}/cover`, {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify({ url }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function updateJavItem(id, payload) {
  const res = await apiFetch(`/jav/items/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify(payload || {}),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function createJavTag(name) {
  const res = await apiFetch('/jav/tags', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function createJavScrapedTag(name) {
  const res = await apiFetch('/jav/tags/scraped', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function organizeJavTags() {
  const res = await apiFetch('/jav/tags/organize', { method: 'POST' })
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function createJavTagCategory(name) {
  const res = await apiFetch('/jav/tag-categories', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function reorderJavTagCategories(categoryIds) {
  const res = await apiFetch('/jav/tag-categories/order', {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify({ category_ids: categoryIds }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
}

export async function renameJavTagCategory(id, name) {
  const res = await apiFetch(`/jav/tag-categories/${id}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
}

export async function deleteJavTagCategory(id) {
  const res = await apiFetch(`/jav/tag-categories/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    throw await apiError(res)
  }
}

export async function assignJavTagsCategory(tagIds, categoryId) {
  const res = await apiFetch('/jav/tags/category', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ tag_ids: tagIds, category_id: categoryId }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
}

export async function renameJavTag(id, name) {
  const res = await apiFetch(`/jav/tags/${id}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
}

export async function deleteJavTag(id) {
  const res = await apiFetch(`/jav/tags/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    throw await apiError(res)
  }
}

export async function deleteJavTagsBatch(tagIds) {
  const res = await apiFetch('/jav/tags/batch_delete', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ tag_ids: tagIds }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
}

export async function replaceJavTagsForItems(javIds, tagIds) {
  const res = await apiFetch('/jav/tags/replace', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ jav_ids: javIds, tag_ids: tagIds }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
}

export async function addJavTagToJavs(tagId, javIds) {
  const res = await apiFetch('/jav/tags/add', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ tag_id: tagId, jav_ids: javIds }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
}

export async function removeJavTagFromJavs(tagId, javIds) {
  const res = await apiFetch('/jav/tags/remove', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ tag_id: tagId, jav_ids: javIds }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
}

export async function fetchJavIdols({
  limit = 25,
  offset = 0,
  search = '',
  sort = '',
  favoriteGroupId = null,
  profileFilters = {},
} = {}) {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  if (search) params.set('search', search)
  if (sort) params.set('sort', sort)
  if (favoriteGroupId) params.set('favorite_group_id', String(favoriteGroupId))
  for (const key of ['height', 'age', 'cup', 'bust', 'waist', 'hips']) {
    const value = profileFilters?.[key]
    if (!value?.enabled) continue
    params.set(`idol_${key}_min`, String(value.min))
    params.set(`idol_${key}_max`, String(value.max))
  }
  const res = await apiFetch(`/jav/idols?${params.toString()}`)
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function createJavIdol(name) {
  const res = await apiFetch('/jav/idols', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function fetchJavIdolOptions({ limit = 25, offset = 0, search = '' } = {}) {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  if (search) params.set('search', search)
  const res = await apiFetch(`/jav/idols/options?${params.toString()}`)
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function mergeJavIdols({ canonicalId, mergeIds = [] } = {}) {
  const res = await apiFetch('/jav/idols/merge', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      canonical_id: canonicalId,
      merge_ids: mergeIds,
    }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function updateJavIdol(id, payload) {
  const res = await apiFetch(`/jav/idols/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

const JAV_FAVORITE_ENTITY_ROUTES = {
  jav: 'jav',
  idol: 'idol',
  studio: 'studio',
  series: 'series',
}

function javFavoriteEntityRoute(entityType = 'idol') {
  return JAV_FAVORITE_ENTITY_ROUTES[String(entityType || '').trim()] || 'idol'
}

export async function fetchJavFavoriteGroups(entityType = 'idol') {
  const route = javFavoriteEntityRoute(entityType)
  const res = await apiFetch(`/jav/${route}-favorite-groups`)
  if (!res.ok) {
    throw await apiError(res)
  }
  const data = await res.json()
  return Array.isArray(data?.items) ? data.items : []
}

export async function createJavFavoriteGroup(entityType = 'idol', name) {
  const route = javFavoriteEntityRoute(entityType)
  const res = await apiFetch(`/jav/${route}-favorite-groups`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function renameJavFavoriteGroup(entityType = 'idol', id, name) {
  const route = javFavoriteEntityRoute(entityType)
  const res = await apiFetch(`/jav/${route}-favorite-groups/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
}

export async function deleteJavFavoriteGroup(entityType = 'idol', id) {
  const route = javFavoriteEntityRoute(entityType)
  const res = await apiFetch(`/jav/${route}-favorite-groups/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    throw await apiError(res)
  }
}

export async function reorderJavFavoriteGroups(entityType = 'idol', groupIds = []) {
  const route = javFavoriteEntityRoute(entityType)
  const res = await apiFetch(`/jav/${route}-favorite-groups/order`, {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify({ group_ids: groupIds }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
}

export async function fetchJavFavoriteGroupItems(entityType = 'idol', id) {
  const route = javFavoriteEntityRoute(entityType)
  const res = await apiFetch(`/jav/${route}-favorite-groups/${encodeURIComponent(id)}/items`)
  if (!res.ok) {
    throw await apiError(res)
  }
  const data = await res.json()
  return Array.isArray(data?.items) ? data.items : []
}

export async function reorderJavFavoriteGroupItems(entityType = 'idol', id, entityIds = []) {
  const route = javFavoriteEntityRoute(entityType)
  const res = await apiFetch(`/jav/${route}-favorite-groups/${encodeURIComponent(id)}/item-order`, {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify({ entity_ids: entityIds }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
}

export async function removeJavFavoriteGroupItems(entityType = 'idol', id, entityIds = []) {
  const route = javFavoriteEntityRoute(entityType)
  const res = await apiFetch(
    `/jav/${route}-favorite-groups/${encodeURIComponent(id)}/items/remove`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ entity_ids: entityIds }),
    }
  )
  if (!res.ok) {
    throw await apiError(res)
  }
}

export async function fetchJavFavoriteSelection(entityType = 'idol', id) {
  const route = javFavoriteEntityRoute(entityType)
  const itemPath = route === 'jav' ? 'items' : route === 'series' ? 'series' : `${route}s`
  const res = await apiFetch(`/jav/${itemPath}/${encodeURIComponent(id)}/favorite-groups`)
  if (!res.ok) {
    throw await apiError(res)
  }
  const data = await res.json()
  return Array.isArray(data?.selected_group_ids) ? data.selected_group_ids : []
}

export async function replaceJavFavoriteGroups(entityType = 'idol', id, groupIds = []) {
  const route = javFavoriteEntityRoute(entityType)
  const itemPath = route === 'jav' ? 'items' : route === 'series' ? 'series' : `${route}s`
  const res = await apiFetch(`/jav/${itemPath}/${encodeURIComponent(id)}/favorite-groups`, {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify({ group_ids: groupIds }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
}

export async function addJavsToFavoriteGroups(javIds, groupIds) {
  const res = await apiFetch('/jav/items/favorite-groups/add', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ jav_ids: javIds, group_ids: groupIds }),
  })
  if (!res.ok) throw await apiError(res)
  return res.json()
}

export async function fetchJavIdolCoverOptions(id) {
  const res = await apiFetch(`/jav/idols/${encodeURIComponent(id)}/cover-options`)
  if (!res.ok) {
    throw await apiError(res)
  }
  const data = await res.json()
  return Array.isArray(data?.items) ? data.items : []
}

export async function updateJavIdolCover(id, { javId = 0, cropLeft = 0.53 } = {}) {
  const res = await apiFetch(`/jav/idols/${encodeURIComponent(id)}/cover`, {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify({ jav_id: javId, crop_left: cropLeft }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function fetchJavStudios({
  limit = 25,
  offset = 0,
  search = '',
  favoriteGroupId = null,
} = {}) {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  if (search) params.set('search', search)
  if (favoriteGroupId) params.set('favorite_group_id', String(favoriteGroupId))
  const res = await apiFetch(`/jav/studios?${params.toString()}`)
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function fetchJavStudioOptions({ limit = 25, offset = 0, search = '' } = {}) {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  if (search) params.set('search', search)
  const res = await apiFetch(`/jav/studios/options?${params.toString()}`)
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function mergeJavStudios({ canonicalId, mergeIds = [] } = {}) {
  const res = await apiFetch('/jav/studios/merge', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      canonical_id: canonicalId,
      merge_ids: mergeIds,
    }),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function updateJavStudio(id, payload) {
  const res = await apiFetch(`/jav/studios/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function fetchJavStudioJavDBURL({ studioId = null } = {}) {
  const params = new URLSearchParams()
  params.set('studio_id', String(studioId || ''))
  const res = await apiFetch(`/jav/studios/javdb-url?${params.toString()}`)
  if (!res.ok) {
    throw await apiError(res)
  }
  const data = await res.json()
  return data?.url || ''
}

export async function fetchJavStudioPreview(id) {
  const res = await apiFetch(`/jav/studios/${encodeURIComponent(id)}`)
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function fetchJavSeries({
  limit = 25,
  offset = 0,
  search = '',
  favoriteGroupId = null,
} = {}) {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  if (search) params.set('search', search)
  if (favoriteGroupId) params.set('favorite_group_id', String(favoriteGroupId))
  const res = await apiFetch(`/jav/series?${params.toString()}`)
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function fetchJavSeriesJavDBURL({ seriesId = null } = {}) {
  const params = new URLSearchParams()
  params.set('series_id', String(seriesId || ''))
  const res = await apiFetch(`/jav/series/javdb-url?${params.toString()}`)
  if (!res.ok) {
    throw await apiError(res)
  }
  const data = await res.json()
  return data?.url || ''
}

export async function fetchJavSeriesPreview(id) {
  const res = await apiFetch(`/jav/series/${encodeURIComponent(id)}`)
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function fetchJavIdolPreview(id) {
  const res = await apiFetch(`/jav/idols/${encodeURIComponent(id)}`)
  if (!res.ok) {
    throw await apiError(res)
  }
  return res.json()
}

export async function fetchJavIdolJavDBURL({ code = '', name = '' } = {}) {
  const params = new URLSearchParams()
  params.set('code', code)
  params.set('name', name)
  const res = await apiFetch(`/jav/idols/javdb-url?${params.toString()}`)
  if (!res.ok) {
    throw await apiError(res)
  }
  const data = await res.json()
  return data?.url || ''
}

export async function fetchJavJavDBURL({ code = '' } = {}) {
  const params = new URLSearchParams()
  params.set('code', code)
  const res = await apiFetch(`/jav/javdb-url?${params.toString()}`)
  if (!res.ok) {
    throw await apiError(res)
  }
  const data = await res.json()
  return data?.url || ''
}

export async function resolveJavIdols(ids = []) {
  const clean = Array.from(
    new Set(
      (ids || [])
        .map((id) => Number.parseInt(String(id), 10))
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  ).sort((a, b) => a - b)
  if (!clean.length) return []
  const key = clean.join(',')
  if (javIdolResolveInFlight.has(key)) {
    return javIdolResolveInFlight.get(key)
  }
  const params = new URLSearchParams()
  params.set('ids', clean.join(','))
  const request = apiFetch(`/jav/idols/resolve?${params.toString()}`)
    .then(async (res) => {
      if (!res.ok) {
        throw await apiError(res)
      }
      const data = await res.json()
      return Array.isArray(data?.items) ? data.items : []
    })
    .finally(() => {
      javIdolResolveInFlight.delete(key)
    })
  javIdolResolveInFlight.set(key, request)
  return request
}
