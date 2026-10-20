import { useId } from 'react'
import { BOOL_SCORE_KEYS } from '../../types'
import type { useParetoChartState } from './useParetoChartState'
import type { useChartControlsPanel } from './useChartControlsPanel'

interface ChartControlsProps {
  state: ReturnType<typeof useParetoChartState>
  panel: ReturnType<typeof useChartControlsPanel>
}

function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M4 7h5m4 0h7M4 17h9m4 0h3" strokeLinecap="round" />
      <circle cx="11" cy="7" r="2" />
      <circle cx="15" cy="17" r="2" />
    </svg>
  )
}

export function ChartControls({ state: s, panel }: ChartControlsProps) {
  const id = useId()
  const panelId = `${id}-settings`
  const ready = s.xMetric !== '' && s.yMetric !== ''
  const axes = [
    { key: 'x', label: 'X Axis', metric: s.xMetric, onMetric: s.setXMetricFromEvent, scale: s.xScale, onScale: s.setXScale },
    { key: 'y', label: 'Y Axis', metric: s.yMetric, onMetric: s.setYMetricFromEvent, scale: s.yScale, onScale: s.setYScale },
  ]

  return (
    <>
      {panel.overlay && panel.open && (
        <button className="pareto-chart-controls-backdrop" type="button" tabIndex={-1} aria-label="Dismiss chart settings" onClick={panel.close} />
      )}
      <div className="pareto-chart-settings">
        <button
          ref={panel.launcherRef}
          type="button"
          className="pareto-chart-controls-launcher"
          hidden={panel.open}
          onClick={panel.toggle}
          aria-label="Open chart settings"
          aria-expanded={panel.open}
          aria-controls={panelId}
          title="Open chart settings"
        >
          <SettingsIcon />
          <span aria-hidden="true">Settings</span>
          <span className="pareto-chart-controls-chevron" aria-hidden="true">›</span>
        </button>
        <aside
          ref={panel.panelRef}
          id={panelId}
          className="pareto-chart-controls"
          hidden={!panel.open}
          role={panel.overlay ? 'dialog' : undefined}
          aria-modal={panel.overlay ? true : undefined}
          aria-labelledby={`${id}-title`}
        >
          <header className="pareto-chart-controls-header">
            <SettingsIcon />
            <h2 id={`${id}-title`}>Chart settings</h2>
            <button
              type="button"
              className="pareto-chart-controls-close"
              onClick={panel.close}
              aria-label={panel.overlay ? 'Close chart settings' : 'Collapse chart settings'}
              aria-expanded={panel.open}
              aria-controls={panelId}
              title={panel.overlay ? 'Close chart settings' : 'Collapse chart settings'}
            >
              <span aria-hidden="true">{panel.overlay ? '×' : '‹'}</span>
            </button>
          </header>
          <div className="pareto-chart-controls-content">
            <section className="pareto-chart-control-section" aria-labelledby={`${id}-manifold`}>
              <h3 id={`${id}-manifold`}>Manifold</h3>
              <select
                aria-labelledby={`${id}-manifold`}
                value={s.manifoldId}
                onChange={s.setManifoldIdFromEvent}
                className="pareto-chart-select"
              >
                <option value="">All (no frontier)</option>
                {s.availableManifolds.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </section>
            <section className="pareto-chart-control-section" aria-labelledby={`${id}-axes`}>
              <h3 id={`${id}-axes`}>Axes</h3>
              {axes.map((axis) => (
                <div key={axis.key} className="pareto-chart-axis-control">
                  <div className="pareto-chart-field-heading">
                    <label htmlFor={`${id}-${axis.key}`}>{axis.label}</label>
                    <div className="pareto-chart-segmented" role="group" aria-label={`${axis.label} scale`}>
                      {(['linear', 'log'] as const).map((scale) => (
                        <button
                          key={scale}
                          type="button"
                          className="pareto-chart-segment-btn"
                          aria-pressed={axis.scale === scale}
                          aria-label={scale === 'linear' ? 'Linear' : 'Logarithmic'}
                          title={scale === 'linear' ? 'Linear scale' : 'Logarithmic scale'}
                          onClick={() => axis.onScale(scale)}
                        >
                          {scale === 'linear' ? 'lin' : 'log'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <select id={`${id}-${axis.key}`} value={axis.metric} onChange={axis.onMetric} className="pareto-chart-select">
                    <option value="">Select metric…</option>
                    {s.metricOptions.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
                  </select>
                </div>
              ))}
            </section>
            <section className="pareto-chart-control-section" aria-labelledby={`${id}-filters`}>
              <h3 id={`${id}-filters`}>Filters</h3>
              {BOOL_SCORE_KEYS.map((key) => (
                <div key={key} className="pareto-chart-filter-control" role="group" aria-labelledby={`${id}-${key}`}>
                  <span id={`${id}-${key}`}>{s.getLabel(key)}</span>
                  <div className="pareto-chart-segmented pareto-chart-filter-options">
                    {(['any', 'true', 'false'] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        className="pareto-chart-segment-btn"
                        aria-pressed={s.boolFilters[key] === value}
                        onClick={() => s.setBoolFilter(key, value)}
                      >
                        {value === 'any' ? 'Any' : value === 'true' ? 'Yes' : 'No'}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          </div>
          <footer className="pareto-chart-info" role="status" aria-live="polite" aria-atomic="true">
            {ready ? (
              <>
                <span className="pareto-chart-record-count"><strong>{s.allPoints.length}</strong> records</span>
                <span>{s.manifold ? `On ${s.manifold.label} frontier` : 'No frontier selected'}</span>
                {s.manifold && <span>{s.boundaryPoints.length} on 2D boundary</span>}
              </>
            ) : <span>Select both axes to display the chart.</span>}
          </footer>
        </aside>
      </div>
    </>
  )
}
