import { useLayoutEffect, useRef, useState } from 'react'

export function useRecordsNameWidth(names: readonly string[], tableVisible: boolean) {
  const tableRef = useRef<HTMLTableElement>(null)
  const [longestNameWidth, setLongestNameWidth] = useState(0)

  useLayoutEffect(() => {
    const table = tableRef.current
    if (!tableVisible || !table) return

    const measure = () => {
      let width = 0
      for (const name of table.querySelectorAll<HTMLElement>('.records-table-user-name')) {
        // scrollWidth includes the text hidden by ellipsis. An extra pixel
        // avoids clipping a fractional glyph advance rounded by the DOM API.
        width = Math.max(width, name.scrollWidth + 1)
      }
      setLongestNameWidth(width)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(table)
    const fonts = table.ownerDocument.fonts
    fonts?.addEventListener('loadingdone', measure)
    return () => {
      observer.disconnect()
      fonts?.removeEventListener('loadingdone', measure)
    }
  }, [names, tableVisible])

  return { tableRef, longestNameWidth }
}
