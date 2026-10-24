import { useCallback, useEffect, useRef, useState } from 'react'
import { createPlayerClient, type PlayerClient, type PlayerError, type PlayerState } from '../../lib/player/client.js'
import { fetchPlayerUrl } from '../../api/config'
import { fetchRecordAuthor } from '../../api/recordAuthor'
import type { RecordAuthor } from '../../lib/recordAuthor'
import { loadSolutionBytes } from '../../lib/player/solution'
import { useEscapeKey } from './useEscapeKey'
import { usePlayerLayout } from './usePlayerLayout'
import { PlaybackSpeedControl } from './PlaybackSpeedControl'
import { DEFAULT_PLAYBACK_SPEED } from './playbackSpeed'
import './GifViewer.css'

interface GifViewerProps {
  open: boolean
  url: string | null
  title: string
  solutionUrl: string | null
  solutionKey?: string
  fileName?: string
  puzzleId: string | null
  puzzleName: string | null
  onClose: () => void
  /** Override the complete om-web-simulator player URL for this viewer. */
  playerUrl?: string
}

type MediaStatus = 'loading' | 'streaming' | 'loaded' | 'error'

// Keep the independent omclone preview alongside the embedded simulator.
const REPLAY_VIEWER_URL = 'https://ssk97.github.io/display/demo.html'
const REPLAY_VIEWER_ORIGIN = new URL(REPLAY_VIEWER_URL).origin
const REPLAY_HANDSHAKE_TIMEOUT_MS = 20000

function solutionFilename(puzzleName: string | null, title: string): string {
  const base = `${puzzleName ?? 'solution'}-${title}`.replace(/[^a-zA-Z0-9.()-]+/g, '_')
  return `${base}.solution`
}

async function fetchBytes(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.arrayBuffer()
}

function isPlayerAbort(error: unknown): boolean {
  const code = (error as Partial<PlayerError> | null)?.code
  return code === 'ABORTED' || code === 'DISPOSED' || (error as Error | null)?.name === 'AbortError'
}

export function GifViewer({ open, url, title, solutionUrl, solutionKey, fileName, puzzleId, puzzleName, onClose, playerUrl }: GifViewerProps) {
  const hasSolution = !!(solutionKey || solutionUrl)
  const filename = fileName ?? solutionFilename(puzzleName, title)
  const backdropRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const clientRef = useRef<PlayerClient | null>(null)
  const downloadAbort = useRef<AbortController | null>(null)
  const previewAbort = useRef<AbortController | null>(null)
  const [state, setState] = useState<PlayerState | null>(null)
  const [playerLoaded, setPlayerLoaded] = useState(false)
  const [speed, setSpeed] = useState(DEFAULT_PLAYBACK_SPEED)
  const [fallback, setFallback] = useState(!hasSolution || !puzzleId)
  const [reason, setReason] = useState('')
  const [downloadPending, setDownloadPending] = useState(false)
  const [previewPending, setPreviewPending] = useState(false)
  const [actionError, setActionError] = useState('')
  const [author, setAuthor] = useState<RecordAuthor | null>(null)
  const stateRef = useRef<PlayerState | null>(null)
  const loadAbort = useRef<AbortController | null>(null)
  const loadedSource = useRef<string | null>(null)
  const loadedTitle = useRef('')
  const playerLoadedRef = useRef(false)
  const filenameRef = useRef(filename)
  const puzzleNameRef = useRef(puzzleName)
  const authorCache = useRef(new Map<string, RecordAuthor | null>())
  const bytesCache = useRef(new Map<string, ArrayBuffer>())
  const bytesCacheSize = useRef(0)
  filenameRef.current = filename
  puzzleNameRef.current = puzzleName
  useEscapeKey(backdropRef, onClose, open)
  usePlayerLayout(backdropRef, panelRef, open)

  const rememberBytes = useCallback((key: string, bytes: ArrayBuffer) => {
    if (bytes.byteLength > 8 * 1024 * 1024) return
    const cache = bytesCache.current
    if (cache.has(key)) return
    while (cache.size && bytesCacheSize.current + bytes.byteLength > 32 * 1024 * 1024) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      const previous = cache.get(oldest)
      cache.delete(oldest)
      bytesCacheSize.current -= previous?.byteLength ?? 0
    }
    cache.set(key, bytes)
    bytesCacheSize.current += bytes.byteLength
  }, [])

  const readPuzzle = useCallback(async (signal: AbortSignal) => {
    signal.throwIfAborted()
    if (!puzzleId) throw new Error('No puzzle is available')
    const key = `puzzle:${puzzleId}`
    const cached = bytesCache.current.get(key)
    if (cached) return cached
    const bytes = await fetchBytes(`/puzzles/${encodeURIComponent(puzzleId)}.puzzle`, signal)
    signal.throwIfAborted()
    rememberBytes(key, bytes)
    return bytes
  }, [puzzleId, rememberBytes])

  const readSolution = useCallback(async (signal: AbortSignal) => {
    signal.throwIfAborted()
    const key = solutionKey ? `local:${solutionKey}` : `url:${solutionUrl}`
    const cached = bytesCache.current.get(key)
    if (cached) return cached
    const bytes = await loadSolutionBytes(solutionUrl, solutionKey, signal)
    signal.throwIfAborted()
    rememberBytes(key, bytes)
    return bytes
  }, [solutionUrl, solutionKey, rememberBytes])

  const failClient = useCallback((error: Error) => {
    if (isPlayerAbort(error)) return
    setReason(`Real-time player unavailable: ${error.message}`)
    setFallback(true)
    setPlayerLoaded(false)
    playerLoadedRef.current = false
    loadedSource.current = null
    loadAbort.current?.abort()
    const client = clientRef.current
    clientRef.current = null
    client?.dispose()
  }, [])

  useEffect(() => {
    const solution = solutionKey ? null : solutionUrl
    if (!open || !solution) { setAuthor(null); return }
    const cached = authorCache.current
    if (cached.has(solution)) { setAuthor(cached.get(solution) ?? null); return }
    setAuthor(null)
    const controller = new AbortController()
    fetchRecordAuthor(solution, controller.signal).then((value) => {
      if (controller.signal.aborted) return
      if (cached.size >= 256 && !cached.has(solution)) {
        const oldest = cached.keys().next().value
        if (oldest !== undefined) cached.delete(oldest)
      }
      cached.set(solution, value)
      setAuthor(value)
    }).catch(() => { /* Optional attribution must never interrupt playback. */ })
    return () => { controller.abort() }
  }, [open, solutionUrl, solutionKey])

  useEffect(() => {
    // The iframe stays alive, but speed is never remembered across openings
    // or records (and is never read from or written to browser storage).
    setSpeed(DEFAULT_PLAYBACK_SPEED)
    if (!open) return
    if (!hasSolution || !puzzleId) {
      if (stateRef.current?.ready) void clientRef.current?.pause().catch(() => {})
      setFallback(true)
      setReason('')
      setState(null)
      stateRef.current = null
      setPlayerLoaded(false)
      playerLoadedRef.current = false
      loadedSource.current = null
      return
    }
    const controller = new AbortController()
    loadAbort.current = controller
    let active = true
    const sourceKey = `${puzzleId}\u0000${solutionKey ?? solutionUrl ?? ''}`
    const loadPlayer = async () => {
      setActionError('')
      setReason('')
      setFallback(false)
      setPlayerLoaded(false)
      let client = clientRef.current
      if (!client) {
        const configuredUrl = playerUrl ?? await fetchPlayerUrl(controller.signal)
        controller.signal.throwIfAborted()
        if (!active) return
        const iframe = iframeRef.current
        if (!iframe) throw new Error('Player iframe is unavailable.')
        let created: PlayerClient | null = null
        created = createPlayerClient(iframe, {
          url: configuredUrl,
          onState: (value) => {
            stateRef.current = value
            setState(value)
          },
          onError: (error) => {
            if (clientRef.current === created) failClient(error)
          },
        })
        clientRef.current = created
        client = created
      }
      if (!active || controller.signal.aborted) return
      if (loadedSource.current === sourceKey && playerLoadedRef.current) {
        await client.seek(0)
        if (!active || controller.signal.aborted) return
        await client.setSpeed(DEFAULT_PLAYBACK_SPEED)
        if (!active || controller.signal.aborted) return
        await client.play()
        if (!active || controller.signal.aborted) return
        setPlayerLoaded(true)
        return
      }
      setPlayerLoaded(false)
      playerLoadedRef.current = false
      setState(null)
      stateRef.current = null
      const [puzzle, solution] = await Promise.all([
        readPuzzle(controller.signal),
        readSolution(controller.signal),
      ])
      if (!active || controller.signal.aborted) return
      await client.load({
        puzzle: { name: `${puzzleId}.puzzle`, bytes: puzzle },
        solution: { name: filenameRef.current, bytes: solution },
        title: puzzleNameRef.current || undefined,
        autoplay: false,
        signal: controller.signal,
      })
      if (!active || controller.signal.aborted) return
      await client.setSpeed(DEFAULT_PLAYBACK_SPEED)
      if (!active || controller.signal.aborted) return
      await client.play()
      if (!active || controller.signal.aborted) return
      loadedSource.current = sourceKey
      loadedTitle.current = puzzleNameRef.current || ''
      playerLoadedRef.current = true
      setPlayerLoaded(true)
    }
    loadPlayer().catch((error) => {
      if (!active || controller.signal.aborted || isPlayerAbort(error)) return
      failClient(error instanceof Error ? error : new Error(String(error)))
    })
    return () => {
      active = false
      controller.abort()
      if (loadAbort.current === controller) loadAbort.current = null
    }
  }, [open, playerUrl, solutionUrl, solutionKey, hasSolution, puzzleId, readPuzzle, readSolution, failClient])

  useEffect(() => {
    if (!open) return
    const client = clientRef.current
    const next = puzzleName || ''
    if (!client || !playerLoadedRef.current || loadedTitle.current === next) return
    loadedTitle.current = next
    void client.setTitle(next).catch((error: Error) => {
      if (!isPlayerAbort(error)) setActionError(error.message)
    })
  }, [open, puzzleName])

  // Keep the player alive, but scope downloads/popups to the open record.
  // Aborted completions must not overwrite the next record's action state.
  useEffect(() => {
    setDownloadPending(false)
    setPreviewPending(false)
    setActionError('')
    return () => {
      downloadAbort.current?.abort()
      previewAbort.current?.abort()
      downloadAbort.current = null
      previewAbort.current = null
    }
  }, [open, puzzleId, solutionUrl, solutionKey])

  useEffect(() => {
    if (open) return
    loadAbort.current?.abort()
    if (stateRef.current?.ready) void clientRef.current?.pause().catch(() => {})
  }, [open])

  useEffect(() => () => {
    loadAbort.current?.abort()
    clientRef.current?.dispose()
    clientRef.current = null
  }, [])

  const command = (action: (client: PlayerClient) => Promise<unknown>) => {
    const client = clientRef.current
    if (!client) return
    setActionError('')
    action(client).catch((error: Error) => {
      if (clientRef.current === client && !isPlayerAbort(error)) setActionError(error.message)
    })
  }

  const downloadSolution = async () => {
    if (!open || !hasSolution || downloadPending || previewPending) return
    const controller = new AbortController()
    downloadAbort.current = controller
    setActionError('')
    setDownloadPending(true)
    try {
      const bytes = await readSolution(controller.signal)
      if (controller.signal.aborted) return
      const objectUrl = URL.createObjectURL(new Blob([bytes]))
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = filename
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10000)
    } catch (error) {
      if (!controller.signal.aborted) {
        setActionError(`Download failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    } finally {
      if (!controller.signal.aborted) setDownloadPending(false)
      if (downloadAbort.current === controller) downloadAbort.current = null
    }
  }

  const openReplay = async () => {
    if (!open || !hasSolution || !puzzleId || downloadPending || previewPending) return
    setActionError('')
    const child = window.open(REPLAY_VIEWER_URL, '_blank')
    if (!child) {
      setActionError('Could not open the replay viewer popup — try a standard browser (Chrome/Edge/Firefox).')
      return
    }
    const controller = new AbortController()
    previewAbort.current = controller
    setPreviewPending(true)
    let resolveHello: () => void
    let rejectHello: (error: Error) => void
    const hello = new Promise<void>((resolve, reject) => {
      resolveHello = resolve
      rejectHello = reject
    })
    const onMessage = (event: MessageEvent) => {
      if (event.source === child && event.origin === REPLAY_VIEWER_ORIGIN && event.data === 'Hello') resolveHello()
    }
    const onAbort = () => rejectHello(new DOMException('Preview cancelled.', 'AbortError'))
    const timer = setTimeout(() => rejectHello(new Error('Replay viewer did not accept the solution — try a standard browser.')), REPLAY_HANDSHAKE_TIMEOUT_MS)
    window.addEventListener('message', onMessage)
    controller.signal.addEventListener('abort', onAbort, { once: true })
    try {
      const [, puzzle, solution] = await Promise.all([
        hello,
        readPuzzle(controller.signal),
        readSolution(controller.signal),
      ])
      controller.signal.throwIfAborted()
      if (child.closed) throw new Error('The replay viewer window was closed.')
      child.postMessage({ command: 'load', puzzle: new Uint8Array(puzzle), solution: new Uint8Array(solution) }, REPLAY_VIEWER_ORIGIN)
    } catch (error) {
      if (!controller.signal.aborted) {
        setActionError(`Failed to load solution: ${error instanceof Error ? error.message : String(error)}`)
      }
    } finally {
      clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      controller.signal.removeEventListener('abort', onAbort)
      if (!controller.signal.aborted) setPreviewPending(false)
      if (previewAbort.current === controller) previewAbort.current = null
      controller.abort()
    }
  }

  // Rewinds/seeks are busy too; keep the last frame visible after the initial load.
  const loading = !fallback && !playerLoaded
  const controlsDisabled = !open || !playerLoaded || !state?.ready || state.busy || !!state.stepping
  const stateText = state?.collision ? 'Collision — playback stopped'
    : state?.analysisStatus === 'pending' ? 'Analyzing playback loop…'
    : state?.victoryCycle == null ? `${state?.playing ? 'Playing' : 'Paused'} — completion not reached`
    : `Completed at cycle ${state.victoryCycle}`

  return (
    <div ref={backdropRef} className="gif-viewer-backdrop solution-player-backdrop" hidden={!open} onClick={onClose}>
      <div ref={panelRef} className="gif-viewer-panel solution-player-panel" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="gif-viewer-header">
          <div className="gif-viewer-heading">
            <div className="gif-viewer-title">{title}</div>
            {author && (
              <div className="gif-viewer-author" title={`by ${author.name}`}>
                by <a href={author.url} target="_blank" rel="noopener noreferrer">{author.name}</a>
              </div>
            )}
          </div>
          <button type="button" className="gif-viewer-close" onClick={onClose} aria-label="Close">{'\u00D7'}</button>
        </div>
        <div className="solution-player-body">
          <iframe ref={iframeRef} title={`${title} — real-time solution`} className="solution-player-iframe" hidden={fallback} />
          {loading && (
            <div className="gif-viewer-loading" role="status">
              <div className="gif-viewer-spinner" aria-hidden="true" />
              <span>Loading real-time player…</span>
            </div>
          )}
          {fallback && (url ? <RecordedMedia url={url} title={title} /> : (
            <div className="gif-viewer-error" role="alert">{reason || 'No recorded replay is available for this solution.'}</div>
          ))}
        </div>
        <div className="gif-viewer-footer solution-player-footer">
          {!fallback && <>
            <button type="button" className="gif-viewer-btn" disabled={controlsDisabled} onClick={() => command((client) => client.step(-1))} aria-label="Previous cycle">←</button>
            <button type="button" className="gif-viewer-btn" disabled={controlsDisabled || !!state?.collision} onClick={() => command((client) => state?.playing ? client.pause() : client.play())}>{state?.playing ? 'Pause' : 'Play'}</button>
            <button type="button" className="gif-viewer-btn" disabled={controlsDisabled || !!state?.collision} onClick={() => command((client) => client.step(1))} aria-label="Next cycle">→</button>
            <span className="solution-player-cycle">Cycle {state?.cycle ?? 0}</span>
            <PlaybackSpeedControl
              key={`${open}:${puzzleId}:${solutionKey ?? solutionUrl}`}
              value={speed}
              disabled={controlsDisabled}
              onChange={(next) => {
                setSpeed(next)
                command((client) => client.setSpeed(next))
              }}
            />
          </>}
          {hasSolution && <>
            <button type="button" className="gif-viewer-btn" onClick={downloadSolution} disabled={downloadPending || previewPending}>
              {downloadPending ? 'Downloading…' : 'Download'}
            </button>
            <button type="button" className="gif-viewer-btn" onClick={openReplay} disabled={downloadPending || previewPending || !puzzleId} title="Open the solution replay in the omclone viewer">
              {previewPending ? 'Loading viewer…' : 'Preview'}
            </button>
          </>}
          <span className={`solution-player-status${actionError ? ' solution-player-status--error' : ''}`} role="status">
            {actionError || (fallback ? reason || (url ? 'Showing recorded GIF / video' : 'No recorded replay available') : loading ? 'Loading solution…' : stateText)}
          </span>
        </div>
      </div>
    </div>
  )
}

function RecordedMedia({ url, title }: { url: string; title: string }) {
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [status, setStatus] = useState<MediaStatus>('loading')
  const isVideo = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)

  // Reveal GIFs as soon as the first frame decodes, without waiting for the full file.
  useEffect(() => {
    if (isVideo) return
    const timer = setInterval(() => {
      if (imgRef.current && imgRef.current.naturalWidth > 0) {
        clearInterval(timer)
        setStatus((value) => value === 'loading' ? 'streaming' : value)
      }
    }, 100)
    return () => clearInterval(timer)
  }, [isVideo])

  const attachMediaRef = (node: HTMLImageElement | HTMLVideoElement | null) => {
    if (!node) return
    if (node instanceof HTMLImageElement) {
      if (node.complete && node.naturalWidth > 0) setStatus('loaded')
    } else if (node.readyState >= 2) {
      setStatus('loaded')
    }
  }
  const mediaClassName = status === 'streaming' || status === 'loaded'
    ? 'gif-viewer-img' : 'gif-viewer-img gif-viewer-img--pending'

  return <>
    {status === 'loading' && (
      <div className="gif-viewer-loading" role="status">
        <div className="gif-viewer-spinner" aria-hidden="true" />
        <span>Loading recording…</span>
      </div>
    )}
    {status === 'error' && <div className="gif-viewer-error" role="alert">Failed to load recording</div>}
    {isVideo ? (
      <video ref={attachMediaRef} className={mediaClassName} src={url} autoPlay loop muted playsInline onLoadedData={() => setStatus('loaded')} onError={() => setStatus('error')} />
    ) : (
      <img ref={(node) => { imgRef.current = node; attachMediaRef(node) }} className={mediaClassName} src={url} alt={title} onLoad={() => setStatus('loaded')} onError={() => setStatus('error')} />
    )}
  </>
}
