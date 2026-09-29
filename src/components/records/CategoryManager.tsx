import { useEffect, useMemo, useRef, useState } from 'react'
import { OFFICIAL_CATEGORY_NAMES, formatCategoryChain, normalizeCategoryName, parseCategoryCached } from '../../lib/customCategories'
import type { CustomCategoryDef } from '../../lib/customCategories'
import type { CategorySaveResult } from '../../state/useCustomCategories'

interface CategoryManagerProps {
  position: { top: number; right: number }
  categories: CustomCategoryDef[]
  addCategory: (expression: string, name?: string) => CategorySaveResult
  updateCategory: (id: string, patch: { expression?: string; name?: string; enabled?: boolean }) => CategorySaveResult
  removeCategory: (id: string) => void
  toggleCategory: (id: string) => void
  onClose: () => void
}

const HELP_TEXT = `NAME? @manifold: admission, metric, metric, ...
manifold   @aV @iV @hV @wV @bV @a∞ @i∞ @h∞ @w∞ @b∞
admission  true | O | T | L | !expr | expr & expr | (expr)
metric     g i c a h w b r          @V numbers
           a∞ h∞ w∞ b∞              @∞ numbers
           a0 a' a''                 area@∞ levels
           arithmetic  + - * /, numbers, parentheses:
           g+c+a (sum) | c*a (product) | 2*g+c | (g+c)/a
separator  ',' or '>';  '&&' = '&'

examples   @aV: !O, g, c, a         GC
           @aV: !O&T, i, c, g, a    TIC
           @a∞: !O&T, i, a∞, g, r   TIA
           @aV: true, g+c+a, !O     OSum
           @aV: !O, g, 2*c+a        cost, then cycles*2+area

The name field overrides the name written in the expression; leave it
empty to keep the expression prefix or the derived name. Manifold fields
left out of the chain are appended automatically as tiebreakers, then the
bot's data order (overlap, cost, instructions, cycles, area, height,
width, bounding hex, rate, @∞ values). Only scores identical in every
field share a category.`

export default function CategoryManager({
  position,
  categories,
  addCategory,
  updateCategory,
  removeCategory,
  toggleCategory,
  onClose,
}: CategoryManagerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [input, setInput] = useState('')
  const [nameInput, setNameInput] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ kind: 'error' | 'warning'; text: string } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target
      if (target instanceof Element && target.closest('[data-cat-toggle]')) return
      if (rootRef.current !== null && target instanceof Node && rootRef.current.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  const trimmed = input.trim()
  const preview = useMemo(() => (trimmed === '' ? null : parseCategoryCached(trimmed)), [trimmed])
  const chain = preview !== null && preview.ok ? formatCategoryChain(preview.category) : null

  // The name field overrides the expression-derived name; empty means "keep
  // the `NAME?` prefix or the auto-derived name".
  const trimmedName = nameInput.trim()
  const explicitName = trimmedName === '' ? null : normalizeCategoryName(trimmedName)
  const nameError = trimmedName !== '' && explicitName === null
    ? 'Names are 1-8 characters: A-Z, 0-9, _ (starting with a letter)'
    : null
  const derivedName = preview !== null && preview.ok ? preview.category.name : null
  const effectiveName = explicitName ?? derivedName

  const nameConflict = useMemo(() => {
    if (effectiveName === null) return null
    if (categories.some((c) => c.id !== editingId && c.name === effectiveName)) {
      return `A custom category named ${effectiveName} already exists`
    }
    return null
  }, [effectiveName, categories, editingId])

  const officialNameWarning = effectiveName !== null && nameConflict === null && nameError === null
    && OFFICIAL_CATEGORY_NAMES.includes(effectiveName)
    ? `${effectiveName} is also an official category name`
    : null

  const canSave = preview !== null && preview.ok && nameError === null && nameConflict === null

  const submit = () => {
    if (!canSave) return
    const result = editingId !== null
      ? updateCategory(editingId, { expression: trimmed, name: nameInput })
      : addCategory(trimmed, nameInput)
    if (!result.ok) {
      setFeedback({ kind: 'error', text: result.error ?? 'Invalid expression' })
      return
    }
    setFeedback(result.warning ? { kind: 'warning', text: result.warning } : null)
    setInput('')
    setNameInput('')
    setEditingId(null)
  }

  // Only prefill the name field when the stored name is a real override: if
  // it matches what the expression derives, an empty field keeps the name in
  // sync with future expression edits.
  const startEdit = (def: CustomCategoryDef) => {
    const parsed = parseCategoryCached(def.expression)
    const derived = parsed.ok ? parsed.category.name : null
    setEditingId(def.id)
    setInput(def.expression)
    setNameInput(def.name !== derived ? def.name : '')
    setFeedback(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setInput('')
    setNameInput('')
    setFeedback(null)
  }

  return (
    <div
      ref={rootRef}
      className="category-manager"
      style={{ top: position.top, right: position.right }}
    >
      <div className="category-manager-header">
        <span className="category-manager-title">Custom Categories</span>
        <button type="button" className="category-manager-close" onClick={onClose} aria-label="Close">{'\u00D7'}</button>
      </div>

      <div className="category-manager-list">
        {categories.map((def) => {
          const parsed = parseCategoryCached(def.expression)
          const name = def.name
          const status = parsed.ok ? '' : `\nError: ${parsed.error}`
          return (
            <div
              key={def.id}
              className={[
                'category-manager-row',
                def.enabled ? '' : 'is-disabled',
                editingId === def.id ? 'is-editing' : '',
              ].filter(Boolean).join(' ')}
            >
              <input
                type="checkbox"
                className="category-manager-toggle"
                checked={def.enabled}
                onChange={() => toggleCategory(def.id)}
                title={def.enabled ? 'Enabled — shown in the Category column' : 'Disabled'}
              />
              <span className="category-manager-name" title={name}>{name}</span>
              <span
                className={`category-manager-expr${parsed.ok ? '' : ' is-invalid'}`}
                title={`${def.expression}${status}`}
              >
                {def.expression}
              </span>
              <span className="category-manager-row-actions">
                <button type="button" onClick={() => startEdit(def)} title="Edit expression">Edit</button>
                <button type="button" onClick={() => removeCategory(def.id)} title="Delete category">{'\u00D7'}</button>
              </span>
            </div>
          )
        })}
        {categories.length === 0 && <div className="category-manager-empty">No custom categories yet.</div>}
      </div>

      <div className="category-manager-editor">
        <input
          className="category-manager-input category-manager-name-input"
          value={nameInput}
          placeholder="Name (auto)"
          spellCheck={false}
          maxLength={8}
          title="Optional custom name (1-8 chars: A-Z, 0-9, _); empty keeps the name from the expression"
          onChange={(e) => { setNameInput(e.target.value); setFeedback(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        />
        <input
          className="category-manager-input"
          value={input}
          placeholder="@aV: !O, g, c, a"
          spellCheck={false}
          onChange={(e) => { setInput(e.target.value); setFeedback(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        />
        <button type="button" className="category-manager-save" onClick={submit} disabled={!canSave}>
          {editingId !== null ? 'Save' : 'Add'}
        </button>
        {editingId !== null && (
          <button type="button" className="category-manager-cancel" onClick={cancelEdit}>Cancel</button>
        )}
      </div>

      {preview !== null && (
        <div className={`category-manager-preview${preview.ok ? '' : ' is-error'}`}>
          {preview.ok && chain !== null ? (
            <>
              <div className="category-manager-preview-head">
                <span className="category-manager-preview-name">{effectiveName ?? preview.category.name}</span>
                {explicitName === null && nameError === null && <span className="category-manager-preview-auto">auto name</span>}
                <span className="category-manager-preview-manifold">{preview.category.manifold.label}</span>
              </div>
              <div className="category-manager-preview-chain">
                {chain.entries.map((entry, i) => (
                  <span key={i} className="category-manager-chain-entry">
                    {i > 0 && <span className="category-manager-chain-sep" aria-hidden="true">{'\u203A'}</span>}
                    {entry}
                  </span>
                ))}
              </div>
              {chain.tiebreakers.length > 0 && (
                <div className="category-manager-preview-tiebreak">
                  auto tiebreak: {chain.tiebreakers.join(' ')}
                </div>
              )}
            </>
          ) : (
            <span>{preview.ok ? '' : preview.error}</span>
          )}
        </div>
      )}

      {nameError !== null && <div className="category-manager-note is-error">{nameError}</div>}
      {nameConflict !== null && <div className="category-manager-note is-error">{nameConflict}</div>}
      {officialNameWarning !== null && <div className="category-manager-note is-warning">{officialNameWarning}</div>}
      {feedback !== null && <div className={`category-manager-note is-${feedback.kind}`}>{feedback.text}</div>}

      <details className="category-manager-help">
        <summary>Syntax</summary>
        <pre>{HELP_TEXT}</pre>
      </details>
    </div>
  )
}