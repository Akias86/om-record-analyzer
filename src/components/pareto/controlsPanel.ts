interface ControlsPanelState {
  compact: boolean
  desktopCollapsed: boolean
  overlayOpen: boolean
}

type ControlsPanelAction =
  | { type: 'resize'; compact: boolean }
  | { type: 'toggle' }
  | { type: 'close' }

// Leave roughly 620px for the plot after the 208px panel and its gutter.
// The optional solution list already consumes another 210px of workspace.
export function needsControlsOverlay(width: number, hasUserSummary: boolean): boolean {
  return width < 860 + (hasUserSummary ? 210 : 0)
}

export function initialControlsPanel(saved: string): ControlsPanelState {
  return { compact: true, desktopCollapsed: saved === 'true', overlayOpen: false }
}

export function controlsPanelReducer(state: ControlsPanelState, action: ControlsPanelAction): ControlsPanelState {
  if (action.type === 'resize') {
    return action.compact === state.compact ? state : { ...state, compact: action.compact, overlayOpen: false }
  }
  if (state.compact) {
    return { ...state, overlayOpen: action.type === 'toggle' ? !state.overlayOpen : false }
  }
  return { ...state, desktopCollapsed: action.type === 'toggle' ? !state.desktopCollapsed : true }
}
