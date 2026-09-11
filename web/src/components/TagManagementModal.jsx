import { useEffect, useMemo, useState } from 'react'
import { Button, IconButton, MenuItem, TextField } from '@mui/material'
import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'

import AppModal from '@/components/AppModal'
import SortableList from '@/components/SortableList'
import TagBar from '@/components/TagBar'
import { zh } from '@/utils/i18n'
import { getErrorMessage } from '@/utils/errors'

const compactButtonSx = {
  minHeight: 28,
  px: 1.25,
  py: 0.25,
  fontSize: '0.75rem',
  lineHeight: 1.25,
  '& .MuiButton-startIcon': {
    marginRight: 0.5,
    '& svg': {
      fontSize: 16,
    },
  },
}

const footerButtonSx = {
  ...compactButtonSx,
  color: '#475569',
  backgroundColor: '#fff',
  borderColor: '#cbd5e1',
  '&:hover': {
    color: '#1e293b',
    backgroundColor: '#f8fafc',
    borderColor: '#94a3b8',
  },
}

const DEFAULT_CATEGORY_ID = 0
const DEFAULT_CATEGORY_VALUE = '__default'

const categoryDisplayName = (category) =>
  category?.is_default ? zh('默认分类', 'Default') : String(category?.name || '')

const allTagsEditable = () => true

export default function TagManagementModal({
  open,
  onClose,
  tags,
  categories = [],
  onApplyTagFilter,
  onCreateTag,
  onOrganizeTags,
  onCreateCategory,
  onReorderCategories,
  onRenameCategory,
  onDeleteCategory,
  onAssignCategory,
  onRenameTag,
  onDeleteTag,
  isTagEditable = allTagsEditable,
  tagClassName = () => '',
  tagLegend = [],
  editModeMessage = '',
  categoryEnglishLabels = {},
  formatOrganizeResult = () => '',
  organizeButtonTitle = '',
  organizeConfirmMessage = '',
  organizeButtonLabel = zh('自动整理分类', 'Auto organize categories'),
  organizingButtonLabel = zh('整理分类中…', 'Organizing categories...'),
}) {
  const [createOpen, setCreateOpen] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [newTagCategoryValue, setNewTagCategoryValue] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameTagId, setRenameTagId] = useState(null)
  const [renameOriginalName, setRenameOriginalName] = useState('')
  const [renameTagName, setRenameTagName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [hoverTagId, setHoverTagId] = useState(null)
  const [multiSelect, setMultiSelect] = useState(false)
  const [selectedTagIds, setSelectedTagIds] = useState([])
  const [batchError, setBatchError] = useState('')
  const [deletingId, setDeletingId] = useState(null)
  const [organizing, setOrganizing] = useState(false)
  const [actionMessage, setActionMessage] = useState('')
  const [categoryManageOpen, setCategoryManageOpen] = useState(false)
  const [localCategories, setLocalCategories] = useState([])
  const [newCategoryName, setNewCategoryName] = useState('')
  const [categoryEditingId, setCategoryEditingId] = useState(null)
  const [categoryEditingName, setCategoryEditingName] = useState('')
  const [categoryBusyId, setCategoryBusyId] = useState(null)
  const [categoryError, setCategoryError] = useState('')
  const [batchCategoryValue, setBatchCategoryValue] = useState('')
  const [batchNewCategoryName, setBatchNewCategoryName] = useState('')
  const [batchCreateCategoryOpen, setBatchCreateCategoryOpen] = useState(false)
  const [batchCreateCategoryError, setBatchCreateCategoryError] = useState('')
  const [batchCreatingCategory, setBatchCreatingCategory] = useState(false)
  const [batchCategoryOpen, setBatchCategoryOpen] = useState(false)
  const [assigningCategory, setAssigningCategory] = useState(false)

  const categoriesWithDefault = useMemo(() => {
    const storedCategories = [...categories]
    const occupiedSortOrders = new Set(
      storedCategories
        .map((category) => Number(category?.sort_order))
        .filter((sortOrder) => Number.isInteger(sortOrder) && sortOrder >= 0)
    )
    let defaultSortOrder = 0
    while (occupiedSortOrders.has(defaultSortOrder)) defaultSortOrder += 1
    return [
      ...storedCategories,
      {
        id: DEFAULT_CATEGORY_ID,
        name: '默认分类',
        is_default: true,
        sort_order: defaultSortOrder,
      },
    ].sort((a, b) => {
      const orderA = Number(a?.sort_order) || 0
      const orderB = Number(b?.sort_order) || 0
      if (orderA !== orderB) return orderA - orderB
      return Number(a?.id) - Number(b?.id)
    })
  }, [categories])

  useEffect(() => {
    setLocalCategories(categoriesWithDefault)
  }, [categoriesWithDefault])

  useEffect(() => {
    if (createOpen && !newTagCategoryValue) {
      setNewTagCategoryValue(DEFAULT_CATEGORY_VALUE)
    }
  }, [createOpen, newTagCategoryValue])

  const handleTagClick = (tagId) => {
    onApplyTagFilter?.([tagId])
    onClose()
  }

  useEffect(() => {
    if (!open) {
      setCreateOpen(false)
      setNewTagName('')
      setNewTagCategoryValue('')
      setCreating(false)
      setCreateError('')
      setRenameOpen(false)
      setRenameTagId(null)
      setRenameOriginalName('')
      setRenameTagName('')
      setRenaming(false)
      setRenameError('')
      setEditMode(false)
      setHoverTagId(null)
      setMultiSelect(false)
      setSelectedTagIds([])
      setBatchError('')
      setDeletingId(null)
      setOrganizing(false)
      setActionMessage('')
      setCategoryManageOpen(false)
      setNewCategoryName('')
      setCategoryEditingId(null)
      setCategoryEditingName('')
      setCategoryBusyId(null)
      setCategoryError('')
      setBatchCategoryValue('')
      setBatchNewCategoryName('')
      setBatchCreateCategoryOpen(false)
      setBatchCreateCategoryError('')
      setBatchCreatingCategory(false)
      setBatchCategoryOpen(false)
      setAssigningCategory(false)
    }
  }, [open])

  const handleStartRename = (tag) => {
    if (!isTagEditable(tag)) return
    setRenameOpen(true)
    setRenameTagId(tag.id)
    setRenameOriginalName(tag.name || '')
    setRenameTagName(tag.name || '')
    setRenameError('')
    setRenaming(false)
  }

  const handleCloseRename = () => {
    setRenameOpen(false)
    setRenameTagId(null)
    setRenameOriginalName('')
    setRenameTagName('')
    setRenameError('')
    setRenaming(false)
  }

  const handleToggleEditMode = () => {
    const nextEditMode = !editMode
    setEditMode(nextEditMode)
    setActionMessage(nextEditMode ? editModeMessage : '')
    setBatchError('')
    setHoverTagId(null)
  }

  const displayTags = useMemo(() => {
    return [...tags].sort((a, b) => {
      const editableA = Boolean(isTagEditable(a))
      const editableB = Boolean(isTagEditable(b))
      if (editableA !== editableB) return editableA ? -1 : 1

      const rawCountA = Number(a?.count)
      const rawCountB = Number(b?.count)
      const countA = Number.isFinite(rawCountA) ? rawCountA : 0
      const countB = Number.isFinite(rawCountB) ? rawCountB : 0
      if (countB !== countA) return countB - countA

      const nameOrder = String(a?.name || '').localeCompare(String(b?.name || ''))
      if (nameOrder !== 0) return nameOrder
      return Number(a?.id || 0) - Number(b?.id || 0)
    })
  }, [isTagEditable, tags])

  const categoryGroups = useMemo(() => {
    const groups = new Map()
    for (const tag of displayTags) {
      const category = String(tag?.category || '').trim()
      if (!groups.has(category)) groups.set(category, [])
      groups.get(category).push(tag)
    }
    const categoryOrder = new Map(
      categoriesWithDefault.map((category, index) => [
        category?.is_default ? '' : String(category?.name || '').trim(),
        index,
      ])
    )
    return Array.from(groups.entries())
      .map(([category, groupTags]) => ({ category, tags: groupTags }))
      .sort((a, b) => {
        const orderA = categoryOrder.get(a.category) ?? categoryOrder.size
        const orderB = categoryOrder.get(b.category) ?? categoryOrder.size
        if (orderA !== orderB) return orderA - orderB
        return a.category.localeCompare(b.category)
      })
  }, [categoriesWithDefault, displayTags])

  const selectedIds = useMemo(() => {
    if (selectedTagIds.length === 0) return []
    const set = new Set(selectedTagIds)
    return displayTags.filter((t) => set.has(t.id)).map((t) => t.id)
  }, [displayTags, selectedTagIds])

  const categoryUsageCounts = useMemo(() => {
    const counts = new Map()
    for (const tag of displayTags) {
      const categoryId = Number(tag?.category_id)
      const countCategoryId =
        Number.isFinite(categoryId) && categoryId > 0 ? categoryId : DEFAULT_CATEGORY_ID
      if (!Number.isFinite(countCategoryId) || countCategoryId < 0) continue
      counts.set(countCategoryId, (counts.get(countCategoryId) || 0) + 1)
    }
    return counts
  }, [displayTags])

  const handleOrganizeTags = async () => {
    if (organizing) return
    if (organizeConfirmMessage && !window.confirm(organizeConfirmMessage)) return
    setOrganizing(true)
    setBatchError('')
    setActionMessage('')
    try {
      const result = await onOrganizeTags?.()
      setActionMessage(formatOrganizeResult(result))
    } catch (err) {
      setBatchError(getErrorMessage(err))
    } finally {
      setOrganizing(false)
    }
  }

  const handleAssignCategory = async () => {
    if (assigningCategory || selectedIds.length === 0 || !batchCategoryValue) return
    setAssigningCategory(true)
    setBatchError('')
    setActionMessage('')
    try {
      const categoryId =
        batchCategoryValue === DEFAULT_CATEGORY_VALUE ? null : Number(batchCategoryValue)
      await onAssignCategory?.(selectedIds, categoryId)
      setActionMessage(
        zh(
          `已调整 ${selectedIds.length} 个标签的分类`,
          `Updated the category for ${selectedIds.length} tags`
        )
      )
      setSelectedTagIds([])
      setBatchCategoryValue('')
      setBatchNewCategoryName('')
      setBatchCategoryOpen(false)
    } catch (err) {
      setBatchError(getErrorMessage(err))
    } finally {
      setAssigningCategory(false)
    }
  }

  const handleCategoryReorderCommit = async (reordered) => {
    if (categoryBusyId !== null || reordered.length === 0) return
    setCategoryBusyId('__order')
    setCategoryError('')
    try {
      await onReorderCategories?.(reordered.map((category) => category.id))
    } catch (err) {
      setLocalCategories(categoriesWithDefault)
      setCategoryError(getErrorMessage(err))
    } finally {
      setCategoryBusyId(null)
    }
  }

  const renderTagGroup = (group) => {
    if (multiSelect) {
      return (
        <TagBar
          tags={group}
          onToggle={handleTagClick}
          multiSelect={multiSelect}
          selectedIds={selectedTagIds}
          variant="neumorphic"
          tagClassName={tagClassName}
          onSelect={(id) => {
            setSelectedTagIds((prev) => {
              const next = new Set(prev)
              if (next.has(id)) {
                next.delete(id)
              } else {
                next.add(id)
              }
              return Array.from(next)
            })
          }}
        />
      )
    }

    return (
      <div className="flex flex-wrap gap-2">
        {group.map((t) => {
          const count = Number.isFinite(t.count) ? t.count : null
          const canRename = isTagEditable(t)
          const showRenameHint = editMode && hoverTagId === t.id && canRename
          const showDelete = editMode && hoverTagId === t.id && canRename
          const baseTagClass = tagClassName(t)
          const interactiveTagClass = editMode
            ? canRename
              ? showRenameHint
                ? 'skeuo-tag--active'
                : 'skeuo-tag--editing'
              : ''
            : 'skeuo-tag--button'
          return (
            <div
              key={`${t.id}-${t.provider || 0}`}
              className={`skeuo-tag skeuo-tag--main-button ${baseTagClass} ${interactiveTagClass} ${
                editMode ? 'skeuo-tag--edit-mode' : ''
              }`}
              onMouseEnter={() => {
                if (editMode) setHoverTagId(t.id)
              }}
              onMouseLeave={() => {
                if (editMode) setHoverTagId((prev) => (prev === t.id ? null : prev))
              }}
            >
              <button
                type="button"
                className="skeuo-tag-main flex min-w-0 items-center gap-2 text-left"
                onClick={() => {
                  if (editMode) {
                    if (canRename) handleStartRename(t)
                    return
                  }
                  handleTagClick(t.id)
                }}
                title={t.name}
              >
                <span className="skeuo-tag-label">{t.name}</span>
                {!editMode && count !== null && <span className="skeuo-tag-count">{count}</span>}
                {showRenameHint && (
                  <span className="skeuo-tag-hint">{zh('单击重命名', 'Click to rename')}</span>
                )}
              </button>
              {showDelete && (
                <IconButton
                  size="small"
                  type="button"
                  aria-label={zh('删除标签', 'Delete tag')}
                  disabled={deletingId === t.id}
                  className="skeuo-tag-delete"
                  sx={{
                    borderRadius: 0,
                    padding: 0,
                    width: '1.5rem',
                    height: '1.5rem',
                  }}
                  onClick={async (event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    if (deletingId === t.id) return
                    if (
                      !window.confirm(zh(`确定删除标签“${t.name}”吗？`, `Delete tag "${t.name}"?`))
                    )
                      return
                    setDeletingId(t.id)
                    setBatchError('')
                    try {
                      await onDeleteTag?.(t)
                    } catch (err) {
                      setBatchError(getErrorMessage(err))
                    } finally {
                      setDeletingId(null)
                    }
                  }}
                >
                  <CloseOutlinedIcon fontSize="inherit" className="h-3.5 w-3.5" />
                </IconButton>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  if (!open) return null
  return (
    <AppModal
      ariaLabel={zh('标签管理', 'Tag Management')}
      contentClassName="mx-4 flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-slate-200/70"
      onClose={onClose}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200/70 bg-slate-50/80 px-6 py-4">
        <h2 className="text-lg font-semibold text-slate-900">{zh('标签管理', 'Tag Management')}</h2>
        <IconButton
          type="button"
          size="small"
          onClick={onClose}
          aria-label={zh('关闭标签管理', 'Close tag management')}
          title={zh('关闭', 'Close')}
        >
          <CloseOutlinedIcon fontSize="small" />
        </IconButton>
      </div>
      <div className="tag-management-modal-list min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {tagLegend.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            {tagLegend.map((item) => (
              <span key={item.label} className="inline-flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 rounded-full border ${item.className || ''}`} />
                {item.label}
              </span>
            ))}
          </div>
        )}
        {categoryGroups.length > 0 ? (
          <div className="space-y-6">
            {categoryGroups.map((group) => (
              <div key={group.category || DEFAULT_CATEGORY_VALUE} className="space-y-2">
                <div className="text-base font-semibold text-slate-800">
                  <span>
                    {group.category
                      ? zh(group.category, categoryEnglishLabels[group.category] || group.category)
                      : zh('默认分类', 'Default')}
                  </span>
                </div>
                {renderTagGroup(group.tags)}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-slate-400">{zh('暂无标签', 'No tags')}</div>
        )}
      </div>
      <div className="shrink-0 border-t border-slate-200/70 bg-slate-50/80 px-6 py-4">
        {(actionMessage || batchError) && (
          <div className="mb-3 space-y-1">
            {actionMessage && <div className="text-sm text-emerald-700">{actionMessage}</div>}
            {batchError && <div className="text-sm text-rose-600">{batchError}</div>}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {!multiSelect && !editMode && onOrganizeTags && (
            <Button
              size="small"
              variant="outlined"
              onClick={handleOrganizeTags}
              disabled={organizing}
              title={organizeButtonTitle}
              sx={footerButtonSx}
            >
              {organizing ? organizingButtonLabel : organizeButtonLabel}
            </Button>
          )}
          {!editMode && !multiSelect && (
            <Button
              size="small"
              variant="outlined"
              onClick={() => {
                setCategoryError('')
                setCategoryManageOpen(true)
              }}
              sx={footerButtonSx}
            >
              {zh('分类管理', 'Manage categories')}
            </Button>
          )}
          {!editMode && !multiSelect && (
            <Button
              size="small"
              variant="outlined"
              onClick={() => {
                setCreateError('')
                setNewTagName('')
                setNewTagCategoryValue(DEFAULT_CATEGORY_VALUE)
                setCreateOpen(true)
              }}
              sx={footerButtonSx}
            >
              {zh('新增标签', 'New tag')}
            </Button>
          )}
          {!multiSelect && (
            <Button
              size="small"
              variant="outlined"
              onClick={handleToggleEditMode}
              sx={footerButtonSx}
            >
              {editMode ? zh('退出编辑', 'Exit edit') : zh('编辑', 'Edit')}
            </Button>
          )}
          {!editMode && (
            <Button
              size="small"
              variant="outlined"
              onClick={() => {
                setMultiSelect((prev) => !prev)
                setSelectedTagIds([])
                setBatchCategoryValue('')
                setEditMode(false)
                setHoverTagId(null)
              }}
              sx={footerButtonSx}
            >
              {multiSelect ? zh('退出多选', 'Exit multi-select') : zh('多选', 'Multi-select')}
            </Button>
          )}
          {multiSelect && (
            <>
              <Button
                size="small"
                variant="outlined"
                onClick={() => {
                  setBatchCategoryValue('')
                  setBatchNewCategoryName('')
                  setBatchError('')
                  setBatchCategoryOpen(true)
                }}
                disabled={selectedIds.length === 0}
                sx={footerButtonSx}
              >
                {zh('调整分类', 'Move tags')}
              </Button>
              <Button
                size="small"
                variant="outlined"
                onClick={() => {
                  if (selectedIds.length === 0) return
                  onApplyTagFilter(selectedIds)
                  onClose()
                }}
                disabled={selectedIds.length === 0}
                sx={footerButtonSx}
              >
                {zh('查找视频', 'Find videos')}
              </Button>
            </>
          )}
        </div>
      </div>
      {batchCategoryOpen && (
        <AppModal
          ariaLabel={zh('调整标签分类', 'Move tags to category')}
          className="px-4"
          closeDisabled={assigningCategory}
          contentClassName="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
          onClose={() => {
            setBatchCategoryOpen(false)
            setBatchError('')
          }}
          zIndex={1400}
        >
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                {zh('调整标签分类', 'Move tags to category')}
              </h3>
              <div className="mt-1 text-xs text-slate-400">
                {zh(`已选择 ${selectedIds.length} 个标签`, `${selectedIds.length} tags selected`)}
              </div>
            </div>
            <IconButton
              size="small"
              disabled={assigningCategory}
              onClick={() => {
                setBatchCategoryOpen(false)
                setBatchError('')
              }}
              aria-label={zh('关闭调整分类', 'Close category assignment')}
            >
              <CloseOutlinedIcon fontSize="small" />
            </IconButton>
          </div>
          <div
            role="radiogroup"
            aria-label={zh('目标分类', 'Target category')}
            className="max-h-[48vh] space-y-2 overflow-y-auto pr-1"
          >
            {categoriesWithDefault.map((category) => {
              const value = category.is_default ? DEFAULT_CATEGORY_VALUE : String(category.id)
              const selected = batchCategoryValue === value
              return (
                <label
                  key={category.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition ${
                    selected
                      ? 'border-slate-700 bg-slate-50 text-slate-900'
                      : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="batch-tag-category"
                    value={value}
                    checked={selected}
                    onChange={(event) => setBatchCategoryValue(event.target.value)}
                    className="h-4 w-4 border-slate-300 text-slate-900 focus:ring-slate-400"
                  />
                  <span className="truncate">{categoryDisplayName(category)}</span>
                </label>
              )
            })}
          </div>
          {batchError && <div className="mt-2 text-sm text-rose-600">{batchError}</div>}
          <div className="mt-5 flex items-center justify-between gap-2">
            <Button
              size="small"
              variant="outlined"
              disabled={assigningCategory}
              onClick={() => {
                setBatchNewCategoryName('')
                setBatchCreateCategoryError('')
                setBatchCreateCategoryOpen(true)
              }}
              sx={compactButtonSx}
            >
              {zh('新建分类', 'New category')}
            </Button>
            <div className="flex gap-2">
              <Button
                size="small"
                variant="outlined"
                disabled={assigningCategory}
                onClick={() => {
                  setBatchCategoryOpen(false)
                  setBatchError('')
                }}
                sx={compactButtonSx}
              >
                {zh('取消', 'Cancel')}
              </Button>
              <Button
                size="small"
                variant="contained"
                disabled={assigningCategory || !batchCategoryValue}
                onClick={handleAssignCategory}
                sx={compactButtonSx}
              >
                {assigningCategory ? zh('调整中…', 'Updating...') : zh('确认调整', 'Confirm')}
              </Button>
            </div>
          </div>
        </AppModal>
      )}
      {batchCreateCategoryOpen && (
        <AppModal
          ariaLabel={zh('新建分类', 'New category')}
          className="px-4"
          closeDisabled={batchCreatingCategory}
          contentClassName="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
          onClose={() => setBatchCreateCategoryOpen(false)}
          zIndex={1500}
        >
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-900">
              {zh('新建分类', 'New category')}
            </h3>
            <IconButton
              size="small"
              disabled={batchCreatingCategory}
              onClick={() => setBatchCreateCategoryOpen(false)}
              aria-label={zh('关闭新建分类', 'Close new category')}
            >
              <CloseOutlinedIcon fontSize="small" />
            </IconButton>
          </div>
          <TextField
            fullWidth
            size="small"
            value={batchNewCategoryName}
            onChange={(event) => setBatchNewCategoryName(event.target.value)}
            placeholder={zh('请输入分类名称', 'Enter category name')}
          />
          {batchCreateCategoryError && (
            <div className="mt-2 text-sm text-rose-600">{batchCreateCategoryError}</div>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button
              size="small"
              variant="outlined"
              disabled={batchCreatingCategory}
              onClick={() => setBatchCreateCategoryOpen(false)}
              sx={compactButtonSx}
            >
              {zh('取消', 'Cancel')}
            </Button>
            <Button
              size="small"
              variant="contained"
              disabled={batchCreatingCategory || !batchNewCategoryName.trim()}
              onClick={async () => {
                const name = batchNewCategoryName.trim()
                if (!name) return
                setBatchCreatingCategory(true)
                setBatchCreateCategoryError('')
                try {
                  const created = await onCreateCategory?.(name)
                  const categoryId = Number(created?.id)
                  if (!Number.isFinite(categoryId) || categoryId <= 0) {
                    throw new Error(zh('新建分类失败', 'Failed to create category'))
                  }
                  setBatchCategoryValue(String(categoryId))
                  setBatchCreateCategoryOpen(false)
                  setBatchNewCategoryName('')
                } catch (err) {
                  setBatchCreateCategoryError(getErrorMessage(err))
                } finally {
                  setBatchCreatingCategory(false)
                }
              }}
              sx={compactButtonSx}
            >
              {batchCreatingCategory ? zh('创建中…', 'Creating...') : zh('创建', 'Create')}
            </Button>
          </div>
        </AppModal>
      )}
      {categoryManageOpen && (
        <AppModal
          ariaLabel={zh('分类管理', 'Category management')}
          className="px-4"
          closeDisabled={categoryBusyId !== null}
          contentClassName="flex max-h-[75vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
          onClose={() => setCategoryManageOpen(false)}
          zIndex={1400}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-900">
              {zh('分类管理', 'Category management')}
            </h3>
            <IconButton
              size="small"
              disabled={categoryBusyId !== null}
              onClick={() => setCategoryManageOpen(false)}
              aria-label={zh('关闭分类管理', 'Close category management')}
            >
              <CloseOutlinedIcon fontSize="small" />
            </IconButton>
          </div>
          <div className="shrink-0 border-b border-slate-100 p-4">
            <div className="flex gap-2">
              <TextField
                size="small"
                fullWidth
                value={newCategoryName}
                onChange={(event) => setNewCategoryName(event.target.value)}
                placeholder={zh('新分类名称', 'New category name')}
              />
              <Button
                size="small"
                variant="contained"
                disabled={categoryBusyId !== null || !newCategoryName.trim()}
                onClick={async () => {
                  const name = newCategoryName.trim()
                  if (!name) return
                  setCategoryBusyId('__new')
                  setCategoryError('')
                  try {
                    await onCreateCategory?.(name)
                    setNewCategoryName('')
                  } catch (err) {
                    setCategoryError(getErrorMessage(err))
                  } finally {
                    setCategoryBusyId(null)
                  }
                }}
                sx={compactButtonSx}
              >
                {zh('新增', 'Add')}
              </Button>
            </div>
            {categoryError && <div className="mt-2 text-sm text-rose-600">{categoryError}</div>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {localCategories.length > 0 ? (
              <SortableList
                items={localCategories}
                onReorder={setLocalCategories}
                onReorderCommit={handleCategoryReorderCommit}
                getLabel={categoryDisplayName}
                getMeta={(category) =>
                  categoryEditingId === category.id
                    ? null
                    : zh(
                        `${categoryUsageCounts.get(category.id) || 0} 个标签`,
                        `${categoryUsageCounts.get(category.id) || 0} tags`
                      )
                }
                renderLabel={(category) =>
                  categoryEditingId === category.id ? (
                    <TextField
                      size="small"
                      fullWidth
                      value={categoryEditingName}
                      onChange={(event) => setCategoryEditingName(event.target.value)}
                    />
                  ) : (
                    <div className="truncate text-sm font-medium text-slate-700">
                      {categoryDisplayName(category)}
                    </div>
                  )
                }
                renderActions={(category) => {
                  if (category.is_default) return null
                  const editing = categoryEditingId === category.id
                  const busy = categoryBusyId === category.id
                  return editing ? (
                    <>
                      <Button
                        size="small"
                        variant="contained"
                        disabled={busy || !categoryEditingName.trim()}
                        onClick={async () => {
                          const name = categoryEditingName.trim()
                          if (!name) return
                          setCategoryBusyId(category.id)
                          setCategoryError('')
                          try {
                            await onRenameCategory?.(category.id, name)
                            setCategoryEditingId(null)
                            setCategoryEditingName('')
                          } catch (err) {
                            setCategoryError(getErrorMessage(err))
                          } finally {
                            setCategoryBusyId(null)
                          }
                        }}
                        sx={compactButtonSx}
                      >
                        {zh('保存', 'Save')}
                      </Button>
                      <Button
                        size="small"
                        disabled={busy}
                        onClick={() => {
                          setCategoryEditingId(null)
                          setCategoryEditingName('')
                        }}
                        sx={compactButtonSx}
                      >
                        {zh('取消', 'Cancel')}
                      </Button>
                    </>
                  ) : (
                    <>
                      <IconButton
                        size="small"
                        disabled={categoryBusyId !== null}
                        onClick={() => {
                          setCategoryEditingId(category.id)
                          setCategoryEditingName(category.name || '')
                          setCategoryError('')
                        }}
                        aria-label={zh('修改分类', 'Rename category')}
                      >
                        <EditOutlinedIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        disabled={categoryBusyId !== null}
                        onClick={async () => {
                          if (
                            !window.confirm(
                              zh(
                                `确定删除分类“${category.name}”吗？该分类中的标签将移至默认分类。`,
                                `Delete category "${category.name}"? Its tags will move to the default category.`
                              )
                            )
                          )
                            return
                          setCategoryBusyId(category.id)
                          setCategoryError('')
                          try {
                            await onDeleteCategory?.(category.id)
                          } catch (err) {
                            setCategoryError(getErrorMessage(err))
                          } finally {
                            setCategoryBusyId(null)
                          }
                        }}
                        aria-label={zh('删除分类', 'Delete category')}
                      >
                        <CloseOutlinedIcon fontSize="small" />
                      </IconButton>
                    </>
                  )
                }}
                disabled={categoryBusyId !== null || categoryEditingId !== null}
              />
            ) : (
              <div className="py-6 text-center text-sm text-slate-400">
                {zh('暂无分类', 'No categories')}
              </div>
            )}
          </div>
        </AppModal>
      )}
      {createOpen && (
        <AppModal
          ariaLabel={zh('新增标签', 'New tag')}
          className="px-4"
          closeDisabled={creating}
          contentClassName="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
          onClose={() => setCreateOpen(false)}
          zIndex={1400}
        >
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-900">{zh('新增标签', 'New tag')}</h3>
            <IconButton
              size="small"
              onClick={() => setCreateOpen(false)}
              aria-label={zh('关闭新增标签', 'Close new tag')}
            >
              <CloseOutlinedIcon fontSize="small" />
            </IconButton>
          </div>
          <div className="space-y-3">
            <TextField
              size="small"
              fullWidth
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              placeholder={zh('请输入标签名', 'Enter tag name')}
            />
            <TextField
              select
              size="small"
              fullWidth
              label={zh('分类', 'Category')}
              value={newTagCategoryValue}
              onChange={(event) => setNewTagCategoryValue(event.target.value)}
              SelectProps={{
                MenuProps: {
                  sx: { zIndex: 1500 },
                },
              }}
            >
              {categoriesWithDefault.map((category) => (
                <MenuItem
                  key={category.id}
                  value={category.is_default ? DEFAULT_CATEGORY_VALUE : String(category.id)}
                >
                  {categoryDisplayName(category)}
                </MenuItem>
              ))}
            </TextField>
            {createError && <div className="text-sm text-red-600">{createError}</div>}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              size="small"
              variant="outlined"
              onClick={() => setCreateOpen(false)}
              sx={compactButtonSx}
            >
              {zh('取消', 'Cancel')}
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={async () => {
                const trimmed = newTagName.trim()
                if (!trimmed) {
                  setCreateError(zh('标签名不能为空', 'Tag name cannot be empty'))
                  return
                }
                setCreating(true)
                setCreateError('')
                try {
                  const categoryId =
                    newTagCategoryValue === DEFAULT_CATEGORY_VALUE
                      ? null
                      : Number(newTagCategoryValue)
                  await onCreateTag?.(trimmed, categoryId)
                  setCreateOpen(false)
                  setNewTagName('')
                  setNewTagCategoryValue(DEFAULT_CATEGORY_VALUE)
                } catch (err) {
                  setCreateError(getErrorMessage(err))
                } finally {
                  setCreating(false)
                }
              }}
              disabled={creating || !newTagCategoryValue}
              sx={compactButtonSx}
            >
              {creating ? zh('创建中…', 'Creating...') : zh('创建', 'Create')}
            </Button>
          </div>
        </AppModal>
      )}
      {renameOpen && (
        <AppModal
          ariaLabel={zh('重命名标签', 'Rename tag')}
          className="px-4"
          closeDisabled={renaming}
          contentClassName="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
          onClose={handleCloseRename}
          zIndex={1400}
        >
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-900">
              {zh('重命名标签', 'Rename tag')}
            </h3>
            <IconButton
              size="small"
              onClick={handleCloseRename}
              aria-label={zh('关闭重命名', 'Close rename')}
            >
              <CloseOutlinedIcon fontSize="small" />
            </IconButton>
          </div>
          <div className="space-y-3">
            <TextField
              size="small"
              fullWidth
              value={renameTagName}
              onChange={(e) => setRenameTagName(e.target.value)}
              placeholder={zh('请输入新的标签名', 'Enter a new tag name')}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  handleCloseRename()
                }
              }}
            />
            {renameError && <div className="text-sm text-red-600">{renameError}</div>}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              size="small"
              variant="outlined"
              onClick={handleCloseRename}
              sx={compactButtonSx}
            >
              {zh('取消', 'Cancel')}
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={async () => {
                const trimmed = renameTagName.trim()
                if (!trimmed) {
                  setRenameError(zh('标签名不能为空', 'Tag name cannot be empty'))
                  return
                }
                if (!renameTagId) {
                  setRenameError(zh('标签不存在', 'Tag not found'))
                  return
                }
                if (trimmed === renameOriginalName) {
                  handleCloseRename()
                  return
                }
                setRenaming(true)
                setRenameError('')
                try {
                  await onRenameTag?.(renameTagId, trimmed)
                  handleCloseRename()
                } catch (err) {
                  setRenameError(getErrorMessage(err))
                } finally {
                  setRenaming(false)
                }
              }}
              disabled={renaming}
              sx={compactButtonSx}
            >
              {renaming ? zh('保存中…', 'Saving...') : zh('保存', 'Save')}
            </Button>
          </div>
        </AppModal>
      )}
    </AppModal>
  )
}
