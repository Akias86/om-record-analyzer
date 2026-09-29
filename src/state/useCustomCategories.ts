import { useCallback, useEffect, useMemo, useState } from 'react'
import { OFFICIAL_CATEGORY_NAMES, normalizeCategoryName, parseCategoryCached } from '../lib/customCategories'
import type { CustomCategoryDef } from '../lib/customCategories'

// User-defined categories, persisted like the other lightweight settings.
// Parsing/validation is delegated to customCategories.ts; this hook owns the
// list, its localStorage round-trip and the name-uniqueness checks.

const STORAGE_KEY = 'om-custom-categories'

export interface CategorySaveResult {
  ok: boolean
  error?: string
  warning?: string
}

interface CustomCategoriesState {
  categories: CustomCategoryDef[]
  addCategory: (expression: string, name?: string) => CategorySaveResult
  updateCategory: (id: string, patch: { expression?: string; name?: string; enabled?: boolean }) => CategorySaveResult
  removeCategory: (id: string) => void
  toggleCategory: (id: string) => void
}

type Validation = { ok: true; name: string; warning?: string } | { ok: false; error: string }

function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function loadCategories(): CustomCategoryDef[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out: CustomCategoryDef[] = []
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue
      const rec = item as Record<string, unknown>
      if (typeof rec.id !== 'string' || typeof rec.expression !== 'string') continue
      const parsedCategory = parseCategoryCached(rec.expression)
      const name = typeof rec.name === 'string' && rec.name !== ''
        ? rec.name
        : parsedCategory.ok ? parsedCategory.category.name : rec.expression
      out.push({ id: rec.id, name, expression: rec.expression, enabled: rec.enabled !== false })
    }
    return out
  } catch {
    return []
  }
}

// An empty `explicitName` (or none at all) keeps the expression-derived name;
// a non-empty one must be a valid category name and takes precedence.
function validateExpression(
  defs: CustomCategoryDef[],
  excludeId: string | null,
  expression: string,
  explicitName?: string,
): Validation {
  const parsed = parseCategoryCached(expression)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  let name = parsed.category.name
  if (explicitName !== undefined && explicitName.trim() !== '') {
    const normalized = normalizeCategoryName(explicitName)
    if (normalized === null) {
      return { ok: false, error: 'Names are 1-8 characters: A-Z, 0-9, _ (starting with a letter)' }
    }
    name = normalized
  }
  if (defs.some((d) => d.id !== excludeId && d.name === name)) {
    return { ok: false, error: `A custom category named ${name} already exists` }
  }
  if (OFFICIAL_CATEGORY_NAMES.includes(name)) {
    return { ok: true, name, warning: `${name} is also an official category name` }
  }
  return { ok: true, name }
}

export function useCustomCategories(): CustomCategoriesState {
  const [categories, setCategories] = useState<CustomCategoryDef[]>(loadCategories)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(categories))
    } catch { /* storage full or unavailable, ignore */ }
  }, [categories])

  const addCategory = useCallback((expression: string, name?: string): CategorySaveResult => {
    const trimmed = expression.trim()
    const check = validateExpression(categories, null, trimmed, name)
    if (!check.ok) return { ok: false, error: check.error }
    setCategories((prev) => [...prev, { id: genId(), name: check.name, expression: trimmed, enabled: true }])
    return check.warning ? { ok: true, warning: check.warning } : { ok: true }
  }, [categories])

  const updateCategory = useCallback((id: string, patch: { expression?: string; name?: string; enabled?: boolean }): CategorySaveResult => {
    const target = categories.find((c) => c.id === id)
    if (!target) return { ok: false, error: 'Category not found' }
    let next = target
    let warning: string | undefined
    if (patch.expression !== undefined || patch.name !== undefined) {
      const expression = patch.expression !== undefined ? patch.expression.trim() : target.expression
      const check = validateExpression(categories, id, expression, patch.name)
      if (!check.ok) return { ok: false, error: check.error }
      next = { ...next, expression, name: check.name }
      warning = check.warning
    }
    if (patch.enabled !== undefined) next = { ...next, enabled: patch.enabled }
    setCategories((prev) => prev.map((c) => (c.id === id ? next : c)))
    return warning ? { ok: true, warning } : { ok: true }
  }, [categories])

  const removeCategory = useCallback((id: string) => {
    setCategories((prev) => prev.filter((c) => c.id !== id))
  }, [])

  const toggleCategory = useCallback((id: string) => {
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c)))
  }, [])

  return useMemo(
    () => ({ categories, addCategory, updateCategory, removeCategory, toggleCategory }),
    [categories, addCategory, updateCategory, removeCategory, toggleCategory],
  )
}