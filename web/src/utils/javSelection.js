export function javBulkQuery(state, sort) {
  return {
    search: state.javSearchTerm || '',
    idolIds: state.javIdolIds,
    tagIds: state.javTags,
    studioId: state.javStudioId,
    seriesId: state.javSeriesId,
    prefix: state.javPrefix,
    soloOnly: state.javSoloOnly,
    favoriteRatingEnabled: state.javFavoriteRatingEnabled,
    favoriteRatingMin: state.javFavoriteRatingMin,
    favoriteRatingMax: state.javFavoriteRatingMax,
    favoriteGroupId: state.javFavoriteGroupId,
    sort,
  }
}

export async function fetchAllJavItems(fetcher, { items, total, random, query }) {
  if (random) return items || []

  const result = new Map()
  let expectedTotal = Math.max(0, Number(total) || 0)
  let offset = 0
  while (offset < expectedTotal) {
    const response = await fetcher({ ...query, limit: 500, offset })
    const batch = Array.isArray(response?.items) ? response.items : []
    for (const item of batch) {
      if (Number(item?.id) > 0) result.set(Number(item.id), item)
    }
    if (Number.isFinite(Number(response?.total))) {
      expectedTotal = Math.max(0, Number(response.total))
    }
    if (batch.length === 0) break
    offset += batch.length
  }
  return Array.from(result.values())
}

export function collectJavVideos(items) {
  const videos = new Map()
  let skipped = 0
  for (const item of items || []) {
    const available = (item?.videos || []).filter((video) => Number(video?.id) > 0)
    if (available.length === 0) skipped += 1
    for (const video of available) {
      const key = video.location_id ? `loc:${video.location_id}` : `vid:${video.id}`
      if (!videos.has(key)) videos.set(key, video)
    }
  }
  return { videos: Array.from(videos.values()), skipped }
}
