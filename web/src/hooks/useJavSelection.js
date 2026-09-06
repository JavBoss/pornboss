import { useEffect, useMemo, useRef, useState } from 'react'
import { addJavTagToJavs, addJavsToFavoriteGroups, fetchJavs } from '@/api'
import { resolveJavSort } from '@/constants/jav'
import { useStore } from '@/store'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'
import { collectJavVideos, fetchAllJavItems, javBulkQuery } from '@/utils/javSelection'

export default function useJavSelection({ items, mpvEnabled, playVideos, showToast, showError }) {
  const [selection, setSelection] = useState(() => new Map())
  const [opsOpen, setOpsOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [tagChoices, setTagChoices] = useState([])
  const [favoritesOpen, setFavoritesOpen] = useState(false)
  const [favoriteChoices, setFavoriteChoices] = useState([])
  const [favoriteError, setFavoriteError] = useState('')
  const [action, setAction] = useState('')
  const actionRef = useRef(false)
  useEffect(() => {
    if (selection.size > 0) return
    setOpsOpen(false)
    setTagsOpen(false)
    setTagChoices([])
    setFavoritesOpen(false)
    setFavoriteChoices([])
    setFavoriteError('')
  }, [selection.size])
  const selectedIds = useMemo(() => new Set(selection.keys()), [selection])
  const selectedItems = useMemo(() => {
    const currentItems = new Map((items || []).map((item) => [Number(item.id), item]))
    return Array.from(selection, ([id, item]) => currentItems.get(id) || item)
  }, [items, selection])
  const selectedList = selectedItems.map((item) => ({
    id: Number(item.id),
    jav_id: Number(item.id),
    jav_code: item.code,
    label: item.title || item.code || `#${item.id}`,
  }))

  const runAction = async (name, callback) => {
    if (actionRef.current) return
    actionRef.current = true
    setAction(name)
    try {
      await callback()
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      actionRef.current = false
      setAction('')
    }
  }

  const clear = () => {
    if (actionRef.current) return
    setSelection(new Map())
    setOpsOpen(false)
    setTagsOpen(false)
    setTagChoices([])
  }

  const remove = (id) => {
    if (actionRef.current) return
    setSelection((current) => {
      const next = new Map(current)
      next.delete(Number(id))
      return next
    })
  }

  const toggle = (item) => {
    const id = Number(item?.id)
    if (actionRef.current || !Number.isFinite(id) || id <= 0) return
    setSelection((current) => {
      const next = new Map(current)
      if (next.has(id)) next.delete(id)
      else next.set(id, item)
      return next
    })
  }

  const selectItems = (list) => {
    setSelection((current) => {
      const next = new Map(current)
      for (const item of list) {
        if (Number(item?.id) > 0) next.set(Number(item.id), item)
      }
      return next
    })
  }

  const fetchAll = () => {
    const state = useStore.getState()
    return fetchAllJavItems(fetchJavs, {
      items: state.javItems,
      total: state.javTotal,
      random: state.javRandomMode,
      query: javBulkQuery(state, resolveJavSort(state).sort),
    })
  }

  const playItems = async (list) => {
    const { videos, skipped } = collectJavVideos(list)
    if (videos.length === 0) {
      showError(zh('所选 JAV 暂无可播放的视频', 'No playable videos in the selected JAV items'))
      return
    }
    if (await playVideos(videos)) {
      setOpsOpen(false)
      if (skipped > 0) {
        showToast(
          zh(
            `已将 ${videos.length} 个视频加入 MPV 播放列表，跳过 ${skipped} 部无视频的 JAV`,
            `Added ${videos.length} videos to MPV; skipped ${skipped} JAV items without videos`
          )
        )
      }
    }
  }

  const play = (getItems) => {
    if (!mpvEnabled) return
    return runAction('play', async () => playItems(await getItems()))
  }

  const applyTags = () =>
    runAction('tags', async () => {
      const ids = Array.from(selectedIds)
      if (ids.length === 0 || tagChoices.length === 0) return
      try {
        for (const tagId of tagChoices) {
          await addJavTagToJavs(Number(tagId), ids)
          const tag = useStore
            .getState()
            .javTagOptions.find((item) => Number(item.id) === Number(tagId))
          if (!tag) continue
          const updateItem = (item) => {
            if (!selectedIds.has(Number(item.id))) return item
            const tags = item.tags || []
            if (tags.some((current) => Number(current.id) === Number(tag.id))) return item
            return { ...item, tags: [...tags, tag] }
          }
          useStore.setState((state) => ({ javItems: state.javItems.map(updateItem) }))
          setSelection(
            (current) => new Map(Array.from(current, ([id, item]) => [id, updateItem(item)]))
          )
        }
        setTagsOpen(false)
        setOpsOpen(false)
        setTagChoices([])
        setSelection(new Map())
        showToast(zh(`已给 ${ids.length} 部 JAV 添加标签`, `Added tags to ${ids.length} JAV items`))
      } finally {
        await useStore.getState().loadJavTags({ force: true })
      }
    })

  const applyFavorites = () =>
    runAction('favorites', async () => {
      const ids = Array.from(selectedIds)
      const groupIds = favoriteChoices.map(Number).filter((id) => Number.isFinite(id) && id > 0)
      if (ids.length === 0 || groupIds.length === 0) return
      setFavoriteError('')
      try {
        const result = await addJavsToFavoriteGroups(ids, groupIds)
        const counts = new Map(
          (result.items || []).map((item) => [Number(item.id), item.favorite_count])
        )
        useStore.setState((state) => ({
          javItems: state.javItems.map((item) =>
            counts.has(Number(item.id))
              ? { ...item, favorite_count: counts.get(Number(item.id)) }
              : item
          ),
        }))
        setFavoritesOpen(false)
        setOpsOpen(false)
        setFavoriteChoices([])
        setSelection(new Map())
        showToast(
          zh(
            `已将 ${ids.length} 部 JAV 加入 ${groupIds.length} 个收藏夹`,
            `Added ${ids.length} JAV items to ${groupIds.length} favorite groups`
          )
        )
        await useStore.getState().loadJavFavoriteGroups('jav', { force: true })
      } catch (error) {
        setFavoriteError(getErrorMessage(error))
      }
    })

  return {
    selectedIds,
    selectedList,
    count: selectedIds.size,
    busy: Boolean(action),
    playing: action === 'play',
    saving: action === 'tags',
    opsOpen: opsOpen && selectedIds.size > 0,
    tagsOpen: tagsOpen && selectedIds.size > 0,
    favoritesOpen: favoritesOpen && selectedIds.size > 0,
    favoritesSaving: action === 'favorites',
    favoriteChoices,
    favoriteError,
    tagChoices,
    clear,
    remove,
    toggle,
    openOps: () => setOpsOpen(true),
    closeOps: () => {
      if (!actionRef.current) setOpsOpen(false)
    },
    openTags: () => {
      if (actionRef.current) return
      useStore.getState().loadJavTags()
      setTagChoices([])
      setTagsOpen(true)
    },
    closeTags: () => {
      if (actionRef.current) return
      setTagsOpen(false)
      setTagChoices([])
    },
    toggleTag: (id, checked) =>
      setTagChoices((current) => {
        const next = new Set(current)
        if (checked) next.add(String(id))
        else next.delete(String(id))
        return Array.from(next)
      }),
    applyTags,
    openFavorites: () => {
      if (actionRef.current) return
      setFavoriteChoices([])
      setFavoriteError('')
      setFavoritesOpen(true)
      useStore.getState().loadJavFavoriteGroups('jav', { force: true })
    },
    closeFavorites: () => {
      if (actionRef.current) return
      setFavoritesOpen(false)
      setFavoriteChoices([])
      setFavoriteError('')
    },
    toggleFavorite: (id, checked) =>
      setFavoriteChoices((current) => {
        const next = new Set(current)
        if (checked) next.add(String(id))
        else next.delete(String(id))
        return Array.from(next)
      }),
    applyFavorites,
    selectPage: () => runAction('select', () => selectItems(items)),
    selectAll: () => runAction('select', async () => selectItems(await fetchAll())),
    playPage: () => play(() => items),
    playAll: () => play(fetchAll),
    playSelected: () => play(() => selectedItems),
  }
}
