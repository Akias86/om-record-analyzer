import { useId } from 'react'
import { Divider } from '@astryxdesign/core/Divider'
import { IconButton } from '@astryxdesign/core/IconButton'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { Text } from '@astryxdesign/core/Text'
import { ChevronLeft, ChevronRight, SlidersHorizontal, X } from 'lucide-react'
import { BOOL_SCORE_KEYS } from '../../types'
import type { useParetoChartState } from './useParetoChartState'
import type { useChartControlsPanel } from './useChartControlsPanel'

interface ChartControlsProps {
  state: ReturnType<typeof useParetoChartState>
  panel: ReturnType<typeof useChartControlsPanel>
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
        <button
          className="pareto-chart-controls-backdrop"
          type="button"
          tabIndex={-1}
          aria-label="Dismiss chart settings"
          onClick={panel.close}
        />
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
          <SlidersHorizontal size={15} aria-hidden="true" />
          <span aria-hidden="true">Settings</span>
          <ChevronRight size={14} className="pareto-chart-controls-chevron" aria-hidden="true" />
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
            <SlidersHorizontal size={15} className="pareto-chart-controls-header-icon" aria-hidden="true" />
            <h2 id={`${id}-title`}>Chart settings</h2>
            <IconButton
              variant="ghost"
              size="sm"
              label={panel.overlay ? 'Close chart settings' : 'Collapse chart settings'}
              tooltip={panel.overlay ? 'Close chart settings' : 'Collapse chart settings'}
              icon={panel.overlay ? <X size={14} /> : <ChevronLeft size={15} />}
              onClick={panel.close}
            />
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
                {s.availableManifolds.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </section>
            <Divider />
            <section className="pareto-chart-control-section" aria-labelledby={`${id}-axes`}>
              <h3 id={`${id}-axes`}>Axes</h3>
              {axes.map((axis) => (
                <div key={axis.key} className="pareto-chart-axis-control">
                  <div className="pareto-chart-field-heading">
                    <label htmlFor={`${id}-${axis.key}`}>{axis.label}</label>
                    <SegmentedControl
                      size="sm"
                      label={`${axis.label} scale`}
                      value={axis.scale}
                      onChange={(next) => axis.onScale(next as 'linear' | 'log')}
                    >
                      <SegmentedControlItem value="linear" label="lin" />
                      <SegmentedControlItem value="log" label="log" />
                    </SegmentedControl>
                  </div>
                  <select
                    id={`${id}-${axis.key}`}
                    value={axis.metric}
                    onChange={axis.onMetric}
                    className="pareto-chart-select"
                  >
                    <option value="">Select metric…</option>
                    {s.metricOptions.map(({ key, label }) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </section>
            <Divider />
            <section className="pareto-chart-control-section" aria-labelledby={`${id}-filters`}>
              <h3 id={`${id}-filters`}>Filters</h3>
              {BOOL_SCORE_KEYS.map((key) => (
                <div key={key} className="pareto-chart-filter-control" role="group" aria-labelledby={`${id}-${key}`}>
                  <span id={`${id}-${key}`} className="pareto-chart-filter-label">{s.getLabel(key)}</span>
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
                <span className="pareto-chart-record-count">
                  <strong>{s.allPoints.length}</strong> records
                </span>
                <Text type="supporting" size="xsm">
                  {s.manifold ? `On ${s.manifold.label} frontier` : 'No frontier selected'}
                </Text>
                {s.manifold && (
                  <Text type="supporting" size="xsm" hasTabularNumbers>
                    {s.boundaryPoints.length} on 2D boundary
                  </Text>
                )}
              </>
            ) : (
              <Text type="supporting" size="xsm">
                Select both axes to display the chart.
              </Text>
            )}
          </footer>
        </aside>
      </div>
    </>
  )
}
