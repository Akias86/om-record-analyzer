import { useRef } from 'react'
import { useEscapeKey } from './useEscapeKey'

interface GifViewerProps {
  url: string
  title: string
  onClose: () => void
}

export function GifViewer({ url, title, onClose }: GifViewerProps) {
  const backdropRef = useRef<HTMLDivElement>(null)
  useEscapeKey(backdropRef, onClose)
  const isVideo = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)

  return (
    <div ref={backdropRef} className="gif-viewer-backdrop" onClick={onClose}>
      <div className="gif-viewer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="gif-viewer-header">
          <div className="gif-viewer-title">{title}</div>
          <button type="button" className="gif-viewer-close" onClick={onClose} aria-label="Close">{'\u00D7'}</button>
        </div>
        {isVideo ? (
          <video className="gif-viewer-img" src={url} autoPlay loop muted playsInline />
        ) : (
          <img className="gif-viewer-img" src={url} alt={title} />
        )}
      </div>
    </div>
  )
}
