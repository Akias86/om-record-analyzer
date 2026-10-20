import { useEffect, useRef, useState } from 'react'
import { createPlayerClient, type PlayerClient, type PlayerState } from '../../lib/player/client.js'
import { fetchPlayerUrl } from '../../api/config'
import { fetchRecordAuthor } from '../../api/recordAuthor'
import type { RecordAuthor } from '../../lib/recordAuthor'
import { useEscapeKey } from './useEscapeKey'
import { usePlayerLayout } from './usePlayerLayout'
import './GifViewer.css'

interface GifViewerProps {
  url: string
  title: string
  solutionUrl: string | null
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

export function GifViewer(props: GifViewerProps) {
  // Remount for a new record so old downloads, state and iframe resources cannot leak.
  const key = JSON.stringify([props.puzzleId, props.solutionUrl, props.url, props.title, props.puzzleName, props.playerUrl])
  return <RecordViewer key={key} {...props} />
}

function RecordViewer({ url, title, solutionUrl, puzzleId, puzzleName, onClose, playerUrl }: GifViewerProps) {
  const backdropRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const clientRef = useRef<PlayerClient | null>(null)
  const downloadAbort = useRef<AbortController | null>(null)
  const previewAbort = useRef<AbortController | null>(null)
  const [state, setState] = useState<PlayerState | null>(null)
  const [playerLoaded, setPlayerLoaded] = useState(false)
  const [fallback, setFallback] = useState(!solutionUrl || !puzzleId)
  const [reason, setReason] = useState('')
  const [downloadPending, setDownloadPending] = useState(false)
  const [previewPending, setPreviewPending] = useState(false)
  const [actionError, setActionError] = useState('')
  const [author, setAuthor] = useState<RecordAuthor | null>(null)
  useEscapeKey(backdropRef, onClose)
  usePlayerLayout(backdropRef, panelRef)

  useEffect(() => {
    const controller = new AbortController()
    fetchRecordAuthor(solutionUrl, controller.signal).then((value) => {
      if (!controller.signal.aborted) setAuthor(value)
    }).catch(() => { /* Optional attribution must never interrupt playback. */ })
    return () => { controller.abort() }
  }, [solutionUrl])

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe || !solutionUrl || !puzzleId) return
    const controller = new AbortController()
    let active = true
    let client: PlayerClient | null = null
    const failed = (error: Error) => {
      if (!active || controller.signal.aborted || error.name === 'AbortError') return
      setReason(`Real-time player unavailable: ${error.message}`)
      setFallback(true)
      controller.abort()
      client?.dispose()
      clientRef.current = null
    }
    const loadPlayer = async () => {
      const configuredUrl = playerUrl ?? await fetchPlayerUrl(controller.signal)
      if (!active || controller.signal.aborted) return
      client = createPlayerClient(iframe, {
        url: configuredUrl,
        onState: (value) => {
          if (active && !controller.signal.aborted) setState(value)
        },
        onError: failed,
      })
      clientRef.current = client
      const connection = client
      const [puzzle, solution] = await Promise.all([
        fetchBytes(`/puzzles/${encodeURIComponent(puzzleId)}.puzzle`, controller.signal),
        fetchBytes(solutionUrl, controller.signal),
      ])
      if (!active || controller.signal.aborted) return
      await connection.load({
        puzzle: { name: `${puzzleId}.puzzle`, bytes: puzzle },
        solution: { name: solutionFilename(puzzleName, title), bytes: solution },
        title: puzzleName || undefined,
        autoplay: true,
        signal: controller.signal,
      })
      if (active && !controller.signal.aborted) setPlayerLoaded(true)
    }
    loadPlayer().catch((error) => failed(error instanceof Error ? error : new Error(String(error))))
    return () => {
      active = false
      controller.abort()
      client?.dispose()
      clientRef.current = null
    }
  }, [playerUrl, solutionUrl, puzzleId, puzzleName, title])

  useEffect(() => () => {
    downloadAbort.current?.abort()
    previewAbort.current?.abort()
  }, [])

  const command = (action: (client: PlayerClient) => Promise<unknown>) => {
    const client = clientRef.current
    if (!client) return
    setActionError('')
    action(client).catch((error: Error) => {
      if (clientRef.current === client && error.name !== 'AbortError') setActionError(error.message)
    })
  }

  const downloadSolution = async () => {
    if (!solutionUrl || downloadPending || previewPending) return
    const controller = new AbortController()
    downloadAbort.current = controller
    setActionError('')
    setDownloadPending(true)
    try {
      const bytes = await fetchBytes(solutionUrl, controller.signal)
      if (controller.signal.aborted) return
      const objectUrl = URL.createObjectURL(new Blob([bytes]))
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = solutionFilename(puzzleName, title)
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
    if (!solutionUrl || !puzzleId || downloadPending || previewPending) return
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
        fetchBytes(`/puzzles/${encodeURIComponent(puzzleId)}.puzzle`, controller.signal),
        fetchBytes(solutionUrl, controller.signal),
      ])
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
  const controlsDisabled = !state?.ready || state.busy || !!state.stepping
  const stateText = state?.collision ? 'Collision — playback stopped'
    : state?.analysisStatus === 'pending' ? 'Analyzing playback loop…'
    : state?.victoryCycle == null ? `${state?.playing ? 'Playing' : 'Paused'} — completion not reached`
    : `Completed at cycle ${state.victoryCycle}`

  return (
    <div ref={backdropRef} className="gif-viewer-backdrop solution-player-backdrop" onClick={onClose}>
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
          {fallback && <RecordedMedia url={url} title={title} />}
        </div>
        <div className="gif-viewer-footer solution-player-footer">
          {!fallback && <>
            <button type="button" className="gif-viewer-btn" disabled={controlsDisabled} onClick={() => command((client) => client.step(-1))} aria-label="Previous cycle">←</button>
            <button type="button" className="gif-viewer-btn" disabled={controlsDisabled || !!state?.collision} onClick={() => command((client) => state?.playing ? client.pause() : client.play())}>{state?.playing ? 'Pause' : 'Play'}</button>
            <button type="button" className="gif-viewer-btn" disabled={controlsDisabled || !!state?.collision} onClick={() => command((client) => client.step(1))} aria-label="Next cycle">→</button>
            <span className="solution-player-cycle">Cycle {state?.cycle ?? 0}</span>
            <select className="gif-viewer-btn" aria-label="Playback speed" disabled={controlsDisabled} value={state?.speed ?? 5} onChange={(event) => command((client) => client.setSpeed(Number(event.target.value)))}>
              <option value="5">Game speed (5 cycles/s)</option>
              <option value="2">2 cycles/s</option>
              <option value="4">4 cycles/s</option>
              <option value="8">8 cycles/s</option>
              <option value="16">16 cycles/s</option>
            </select>
          </>}
          {solutionUrl && <>
            <button type="button" className="gif-viewer-btn" onClick={downloadSolution} disabled={downloadPending || previewPending}>
              {downloadPending ? 'Downloading…' : 'Download'}
            </button>
            <button type="button" className="gif-viewer-btn" onClick={openReplay} disabled={downloadPending || previewPending || !puzzleId} title="Open the solution replay in the omclone viewer">
              {previewPending ? 'Loading viewer…' : 'Preview'}
            </button>
          </>}
          <span className={`solution-player-status${actionError ? ' solution-player-status--error' : ''}`} role="status">
            {actionError || (fallback ? reason || 'Showing recorded GIF / video' : loading ? 'Loading solution…' : stateText)}
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
