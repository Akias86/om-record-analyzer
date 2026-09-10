import { useEffect, useRef, useState } from 'react'
import { useEscapeKey } from './useEscapeKey'

interface GifViewerProps {
  url: string
  title: string
  solutionUrl: string | null
  puzzleId: string | null
  puzzleName: string | null
  onClose: () => void
}

type MediaStatus = 'loading' | 'streaming' | 'loaded' | 'error'
type ActionPending = 'download' | 'preview' | null

// Replay viewer (omclone wasm) opened in a popup. Per its demo.html
// protocol it announces itself with a "Hello" postMessage once the wasm
// runtime is up, then accepts a single `{ command: 'load', puzzle, solution }`
// message carrying both files as byte arrays, and hides its file inputs.
const REPLAY_VIEWER_URL = 'https://ssk97.github.io/display/demo.html'
const REPLAY_HANDSHAKE_TIMEOUT_MS = 20000

function solutionFilename(puzzleName: string | null, title: string): string {
  const base = `${puzzleName ?? 'solution'}-${title}`.replace(/[^a-zA-Z0-9.()-]+/g, '_')
  return `${base}.solution`
}

async function fetchBytes(url: string, notFoundMessage: string): Promise<ArrayBuffer> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(res.status === 404 ? notFoundMessage : `HTTP ${res.status}`)
  }
  return res.arrayBuffer()
}

export function GifViewer({ url, title, solutionUrl, puzzleId, puzzleName, onClose }: GifViewerProps) {
  const backdropRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  useEscapeKey(backdropRef, onClose)
  const isVideo = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)
  const [status, setStatus] = useState<MediaStatus>('loading')
  const [pending, setPending] = useState<ActionPending>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    setStatus('loading')
  }, [url])

  useEffect(() => {
    setActionError(null)
    setPending(null)
  }, [solutionUrl])

  // Browsers stream-decode GIFs: frames animate as bytes arrive, and the
  // dimensions are known from the header long before onLoad (full file).
  // Reveal the image on first decoded data so slow GIFs play while loading.
  // The img is keyed by url so a record switch remounts it — a reused element
  // would keep the previous image's naturalWidth and reveal immediately.
  useEffect(() => {
    if (isVideo) return
    const timer = setInterval(() => {
      const node = imgRef.current
      if (node && node.naturalWidth > 0) {
        clearInterval(timer)
        setStatus((s) => (s === 'loading' ? 'streaming' : s))
      }
    }, 100)
    return () => clearInterval(timer)
  }, [isVideo, url])

  // Cached media can finish before React attaches onLoad/onLoadedData.
  const attachMediaRef = (node: HTMLImageElement | HTMLVideoElement | null) => {
    if (!node) return
    if (node instanceof HTMLImageElement) {
      if (node.complete && node.naturalWidth > 0) setStatus('loaded')
    } else if (node.readyState >= 2) {
      setStatus('loaded')
    }
  }

  const mediaVisible = status === 'streaming' || status === 'loaded'
  const mediaClassName = mediaVisible ? 'gif-viewer-img' : 'gif-viewer-img gif-viewer-img--pending'

  // The zlbb short link 301-redirects to the raw .solution file on
  // raw.githubusercontent.com; both hops send `Access-Control-Allow-Origin: *`
  // so a plain fetch works from any origin.
  const downloadSolution = async () => {
    if (!solutionUrl || pending) return
    setActionError(null)
    setPending('download')
    try {
      const res = await fetch(solutionUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const objectUrl = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = solutionFilename(puzzleName, title)
      a.click()
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10000)
    } catch (err) {
      setActionError(`Download failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setPending(null)
    }
  }

  const openReplay = async () => {
    if (!solutionUrl || !puzzleId || pending) return
    setActionError(null)
    const child = window.open(REPLAY_VIEWER_URL, '_blank')
    if (!child) {
      setActionError('Could not open the replay viewer popup — try a standard browser (Chrome/Edge/Firefox).')
      return
    }
    setPending('preview')
    // Fetch puzzle/solution bytes in parallel with the viewer booting; only
    // post them once the child announces readiness.
    let resolveHello: (() => void) | null = null
    const hello = new Promise<void>((resolve) => { resolveHello = resolve })
    const onMessage = (e: MessageEvent) => {
      if (e.source === child && e.data === 'Hello') resolveHello?.()
    }
    window.addEventListener('message', onMessage)
    try {
      const [puzzleBuf, solutionBuf] = await Promise.all([
        fetchBytes(`/puzzles/${encodeURIComponent(puzzleId)}.puzzle`, `puzzle file not found: ${puzzleId}`),
        fetchBytes(solutionUrl, 'solution not found'),
      ])
      const timeout = new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), REPLAY_HANDSHAKE_TIMEOUT_MS))
      const outcome = await Promise.race([hello.then(() => 'ready' as const), timeout])
      if (outcome !== 'ready') {
        setActionError('Replay viewer did not accept the solution (its opener channel is unavailable in this browser) — try a standard browser.')
        return
      }
      child.postMessage(
        { command: 'load', puzzle: new Uint8Array(puzzleBuf), solution: new Uint8Array(solutionBuf) },
        '*',
      )
    } catch (err) {
      setActionError(`Failed to load solution: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      window.removeEventListener('message', onMessage)
      setPending(null)
    }
  }

  return (
    <div ref={backdropRef} className="gif-viewer-backdrop" onClick={onClose}>
      <div className="gif-viewer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="gif-viewer-header">
          <div className="gif-viewer-title">{title}</div>
          <button type="button" className="gif-viewer-close" onClick={onClose} aria-label="Close">{'\u00D7'}</button>
        </div>
        <div className="gif-viewer-body">
          {status === 'loading' && (
            <div className="gif-viewer-loading">
              <div className="gif-viewer-spinner" aria-hidden="true" />
              <span>Loading...</span>
            </div>
          )}
          {status === 'error' && <div className="gif-viewer-error">Failed to load</div>}
          {isVideo ? (
            <video
              ref={attachMediaRef}
              className={mediaClassName}
              src={url}
              autoPlay
              loop
              muted
              playsInline
              onLoadedData={() => setStatus('loaded')}
              onError={() => setStatus('error')}
            />
          ) : (
            <img
              key={url}
              ref={(node) => {
                imgRef.current = node
                attachMediaRef(node)
              }}
              className={mediaClassName}
              src={url}
              alt={title}
              onLoad={() => setStatus('loaded')}
              onError={() => setStatus('error')}
            />
          )}
        </div>
        {solutionUrl && (
          <div className="gif-viewer-footer">
            <button
              type="button"
              className="gif-viewer-btn"
              onClick={downloadSolution}
              disabled={pending !== null}
            >
              {pending === 'download' ? 'Downloading...' : 'Download'}
            </button>
            <button
              type="button"
              className="gif-viewer-btn"
              onClick={openReplay}
              disabled={pending !== null}
              title="Open the solution replay in the omclone viewer"
            >
              {pending === 'preview' ? 'Loading viewer...' : 'Preview'}
            </button>
            {actionError && <span className="gif-viewer-action-error">{actionError}</span>}
          </div>
        )}
      </div>
    </div>
  )
}
