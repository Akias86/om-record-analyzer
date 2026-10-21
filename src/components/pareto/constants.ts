export const MARGIN = { top: 16, right: 24, bottom: 40, left: 56 }

export interface ParetoPoint {
  x: number
  y: number
  id: string
  score: string | null
  categories: string | null
  recordIndex?: number
  overlap: boolean
  trackless: boolean
  looping: boolean
  canPlay?: boolean
  userRecordId?: string
  isUser?: boolean
  name?: string | null
  fullScore?: string | null
  green?: boolean
}

export type PointClass = 'overlap' | 'trackless' | 'looping' | 'normal'

export const CLASS_ORDER: PointClass[] = ['overlap', 'trackless', 'looping', 'normal']

export const CLASS_COLOR: Record<PointClass, string> = {
  normal: 'var(--text)',
  overlap: '#ff7bd7',
  trackless: '#8389fc',
  looping: '#76BBF9',
}

export const CLASS_FRONTIER_COLOR: Record<PointClass, string> = {
  ...CLASS_COLOR,
  normal: 'var(--accent)',
}

export const FRONTIER_RADIUS = 5
export const NORMAL_RADIUS = 3
export const FRONTIER_OPACITY = 1
export const NORMAL_OPACITY = 0.35

export const USER_DIAMOND_RADIUS = 5
export const USER_GREEN = '#22c55e'
export const USER_RED = '#ef4444'

export type ZoomDomain = { x: [number, number]; y: [number, number] }