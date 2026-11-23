import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { searchPuzzles } from '../../lib/puzzleSearch'
import { usePuzzleTree } from '../../state/puzzleTree'
import { IconClose, IconSearch } from '../ui/icons'

const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform ?? navigator.userAgent)

interface PuzzleSearchProps {
  onPick: (puzzleId: string) => void
}

/** Top-bar puzzle picker: type to filter, arrows to move, Enter to open. */
export function PuzzleSearch({ onPick }: PuzzleSearchProps) {
  const { puzzles, loading } = usePuzzleTree()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const results = useMemo(() => searchPuzzles(puzzles, query), [puzzles, query])
  const showResults = open && query.trim().length > 0

  const reset = useCallback(() => {
    setQuery('')
    setOpen(false)
    setCursor(0)
  }, [])

  const pick = useCallback((puzzleId: string) => {
    reset()
    inputRef.current?.blur()
    onPick(puzzleId)
  }, [onPick, reset])

  // ⌘K / Ctrl+K jumps here from anywhere; "/" works when nothing is focused.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key
      const target = event.target as HTMLElement | null
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if ((event.metaKey || event.ctrlKey) && key.toLowerCase() === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
        setOpen(true)
      } else if (key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!showResults) return
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [showResults])

  useEffect(() => setCursor(0), [query])

  return (
    <div ref={rootRef} className={`puzzle-search${showResults ? ' is-open' : ''}`} role="search">
      <span className="search">
        <span className="search-icon"><IconSearch size={15} /></span>
        <input
          ref={inputRef}
          className="input"
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-expanded={showResults}
          aria-controls="puzzle-search-results"
          aria-autocomplete="list"
          aria-label="Search puzzles"
          placeholder={loading ? 'Loading puzzles…' : 'Search puzzles…'}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              if (query) reset()
              else inputRef.current?.blur()
              return
            }
            if (!showResults) return
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setCursor((value) => Math.min(value + 1, results.length - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setCursor((value) => Math.max(value - 1, 0))
            } else if (event.key === 'Enter') {
              const match = results[cursor]
              if (match) {
                event.preventDefault()
                pick(match.id)
              }
            }
          }}
        />
        {query ? (
          <button type="button" className="search-clear" onClick={reset} aria-label="Clear search">
            <IconClose size={13} />
          </button>
        ) : (
          <span className="search-hint" aria-hidden="true">
            <kbd>{isMac ? '⌘' : 'Ctrl'}</kbd>
            <kbd>K</kbd>
          </span>
        )}
      </span>
      {showResults && (
        <div className="puzzle-search-results" id="puzzle-search-results" role="listbox" aria-label="Puzzle matches">
          {results.length === 0 ? (
            <div className="puzzle-search-empty">No puzzle matches “{query.trim()}”</div>
          ) : results.map((puzzle, index) => (
            <button
              key={puzzle.id}
              type="button"
              role="option"
              aria-selected={index === cursor}
              className={`puzzle-search-option${index === cursor ? ' is-cursor' : ''}`}
              onMouseEnter={() => setCursor(index)}
              onClick={() => pick(puzzle.id)}
            >
              <span className="puzzle-search-name">{puzzle.displayName}</span>
              <span className="puzzle-search-path">{puzzle.collectionName} · {puzzle.groupName}</span>
              <span className="puzzle-search-id">{puzzle.id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
