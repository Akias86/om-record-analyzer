export const MARGIN = { top: 16, right: 24, bottom: 40, left: 56 }

export interface ParetoPoint {
  x: number
  y: number
  id: string
  score: string | null
  categories: string | null
  recordIndex: number
  overlap: boolean
  trackless: boolean
  isUser?: boolean
  name?: string | null
  fullScore?: string
  green?: boolean
}

export type PointClass = 'overlap' | 'trackless' | 'normal'

export const CLASS_ORDER: PointClass[] = ['overlap', 'trackless', 'normal']

export const CLASS_COLOR: Record<PointClass, string> = {
  normal: 'var(--text)',
  overlap: '#ff7bd7',
  trackless: '#8389fc',
}

export const CLASS_FRONTIER_COLOR: Record<PointClass, string> = {
  normal: 'var(--accent)',
  overlap: '#ff7bd7',
  trackless: '#8389fc',
}

export const FRONTIER_RADIUS = 5
export const NORMAL_RADIUS = 3
export const FRONTIER_OPACITY = 1
export const NORMAL_OPACITY = 0.35

export const USER_DIAMOND_RADIUS = 5
export const USER_GREEN = '#22c55e'
export const USER_RED = '#ef4444'

export type ZoomDomain = { x: [number, number]; y: [number, number] }