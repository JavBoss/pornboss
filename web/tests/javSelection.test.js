import assert from 'node:assert/strict'
import test from 'node:test'
import { collectJavVideos, fetchAllJavItems, javBulkQuery } from '../src/utils/javSelection.js'

test('bulk selection retains every JAV filter and the resolved sort', () => {
  assert.deepEqual(
    javBulkQuery(
      {
        javSearchTerm: 'example',
        javIdolIds: [1, 2],
        javTags: [3],
        javStudioId: 0,
        javSeriesId: 4,
        javPrefix: 'ABC',
        javSoloOnly: true,
        javFavoriteRatingEnabled: true,
        javFavoriteRatingMin: 2.5,
        javFavoriteRatingMax: 4,
        javFavoriteGroupId: 5,
      },
      'release_date_asc'
    ),
    {
      search: 'example',
      idolIds: [1, 2],
      tagIds: [3],
      studioId: 0,
      seriesId: 4,
      prefix: 'ABC',
      soloOnly: true,
      favoriteRatingEnabled: true,
      favoriteRatingMin: 2.5,
      favoriteRatingMax: 4,
      favoriteGroupId: 5,
      sort: 'release_date_asc',
    }
  )
})

test('fetches all pages in order even when the server caps the requested page size', async () => {
  const calls = []
  const query = { tagIds: [3], sort: 'code_asc' }
  const result = await fetchAllJavItems(
    async (params) => {
      calls.push(params)
      return {
        total: 5,
        items: Array.from({ length: Math.min(2, 5 - params.offset) }, (_, index) => ({
          id: params.offset + index + 1,
        })),
      }
    },
    { total: 4, query }
  )

  assert.deepEqual(
    result.map((item) => item.id),
    [1, 2, 3, 4, 5]
  )
  assert.deepEqual(
    calls,
    [0, 2, 4].map((offset) => ({ ...query, limit: 500, offset }))
  )
})

test('random bulk actions only use the displayed random sample', async () => {
  const items = [{ id: 4 }, { id: 2 }]
  assert.equal(
    await fetchAllJavItems(() => assert.fail('unexpected request'), {
      items,
      total: 100,
      random: true,
    }),
    items
  )
})

test('stops on an empty page and deduplicates JAV items across pages', async () => {
  const batches = [[{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }], []]
  const result = await fetchAllJavItems(async () => ({ items: batches.shift(), total: 10 }), {
    total: 10,
  })
  assert.deepEqual(
    result.map((item) => item.id),
    [1, 2, 3]
  )
  assert.equal(batches.length, 0)
})

test('does not return a partial selection when a later page fails', async () => {
  await assert.rejects(
    fetchAllJavItems(
      async ({ offset }) => {
        if (offset) throw new Error('network failure')
        return { items: [{ id: 1 }], total: 2 }
      },
      { total: 2 }
    ),
    /network failure/
  )
})

test('collects every linked file in order and deduplicates locations without merging distinct files', () => {
  const first = { id: 1, location_id: 10, filename: 'part-a.mp4' }
  const second = { id: 1, location_id: 11, filename: 'part-b.mp4' }
  const third = { id: 2, filename: 'other.mp4' }
  assert.deepEqual(
    collectJavVideos([
      { videos: [first, second] },
      { videos: [first, third] },
      { videos: [third] },
      {},
      { videos: [{ id: 0 }] },
    ]),
    { videos: [first, second, third], skipped: 2 }
  )
  assert.deepEqual(collectJavVideos([]), { videos: [], skipped: 0 })
})
