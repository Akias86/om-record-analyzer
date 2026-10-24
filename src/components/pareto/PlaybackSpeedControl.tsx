import { useCallback, useEffect, useRef, useState } from 'react'
import { clampPlaybackSpeed, MAX_PLAYBACK_SPEED, MIN_PLAYBACK_SPEED, parsePlaybackSpeed, wheelPlaybackSpeed } from './playbackSpeed'

interface PlaybackSpeedControlProps {
  value: number
  disabled: boolean
  onChange: (value: number) => void
}

export function PlaybackSpeedControl({ value, disabled, onChange }: PlaybackSpeedControlProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const current = useRef({ value, disabled, onChange })
  current.current = { value, disabled, onChange }
  const [draft, setDraft] = useState(String(value))

  const apply = useCallback((next: number, text = String(next)) => {
    if (current.current.disabled) return
    const speed = clampPlaybackSpeed(next)
    const previous = current.current.value
    current.current.value = speed
    setDraft(text)
    if (speed !== previous) current.current.onChange(speed)
  }, [])

  useEffect(() => {
    // Preserve partial input such as an empty field or a trailing decimal.
    if (document.activeElement !== inputRef.current) setDraft(String(value))
  }, [value])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onWheel = (event: WheelEvent) => {
      if (current.current.disabled || event.ctrlKey || event.deltaY === 0) return
      // React's delegated wheel listener is passive; use a native listener
      // so speed changes do not also scroll the footer or spin the number input.
      event.preventDefault()
      apply(wheelPlaybackSpeed(current.current.value, event.deltaY))
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => root.removeEventListener('wheel', onWheel)
  }, [apply])

  const commitInput = () => {
    const speed = clampPlaybackSpeed(parsePlaybackSpeed(draft) ?? current.current.value)
    apply(speed)
  }

  return (
    <div ref={rootRef} className="solution-player-speed" role="group" aria-label="Playback speed controls">
      <span className="solution-player-speed-label">Speed</span>
      <div className="solution-player-speed-track">
        <input
          className="solution-player-speed-slider"
          type="range"
          aria-label="Playback speed"
          aria-valuetext={`${value} cycles/s`}
          min={MIN_PLAYBACK_SPEED}
          max={MAX_PLAYBACK_SPEED}
          step="any"
          value={value}
          disabled={disabled}
          onInput={(event) => apply(Math.round(Number(event.currentTarget.value)))}
          onKeyDown={(event) => {
            const speed = current.current.value
            const next = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? Math.floor(speed) + 1
              : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? Math.ceil(speed) - 1
              : event.key === 'PageUp' ? Math.round(speed) + 5
              : event.key === 'PageDown' ? Math.round(speed) - 5
              : event.key === 'Home' ? MIN_PLAYBACK_SPEED
              : event.key === 'End' ? MAX_PLAYBACK_SPEED : null
            if (next === null) return
            event.preventDefault()
            apply(clampPlaybackSpeed(next))
          }}
        />
        <div className="solution-player-speed-ticks" aria-hidden="true">
          {[0, 5, 10, 15, 20, 25, 30].map((tick) => <span key={tick} data-value={tick} />)}
        </div>
      </div>
      <input
        ref={inputRef}
        className="solution-player-speed-input"
        type="number"
        aria-label="Playback speed value"
        min={MIN_PLAYBACK_SPEED}
        max={MAX_PLAYBACK_SPEED}
        step="any"
        inputMode="decimal"
        value={draft}
        disabled={disabled}
        onInput={(event) => {
          const text = event.currentTarget.value
          setDraft(text)
          const parsed = parsePlaybackSpeed(text)
          if (parsed !== null && parsed >= MIN_PLAYBACK_SPEED && parsed <= MAX_PLAYBACK_SPEED) apply(parsed, text)
        }}
        onBlur={commitInput}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); commitInput() }
          if (event.key === 'Escape') { event.stopPropagation(); setDraft(String(current.current.value)) }
        }}
      />
      <span className="solution-player-speed-unit">cycles/s</span>
    </div>
  )
}
