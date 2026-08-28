import { useEffect, type RefObject } from 'react'

export function useEscapeKey(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const layers = document.querySelectorAll('.gif-viewer-backdrop')
      if (layers.length === 0) return
      if (layers[layers.length - 1] !== ref.current) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ref, onClose])
}