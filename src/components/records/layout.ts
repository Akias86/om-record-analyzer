import { FLAG_ORDER } from './flags'

export function getRecordsTableLayout(metricCount: number, longestNameWidth = 0) {
  // Header border-box widths: 100px per metric, 64px per flag, plus O's border.
  const fixedWidth = metricCount * 100 + FLAG_ORDER.length * 64 + 1
  const minRankWidth = 76
  // Name text plus the 12px diamond, 6px gap, and 10px cell padding per side.
  const preferredRankWidth = Math.max(minRankWidth, Math.min(240, Math.ceil(longestNameWidth) + 38))
  // Borrow from Category's existing allowance, not a wider table minimum.
  const minTableWidth = fixedWidth + minRankWidth + 200

  return {
    minTableWidth,
    // Table-cell percentages can be treated as auto by fixed table layout.
    // Use the inner sizing container to exclude scrollbars and reserve Category.
    rankWidth: preferredRankWidth > minRankWidth
      ? `clamp(${minRankWidth}px, calc(max(100cqw, ${minTableWidth}px) - ${fixedWidth + 120}px), ${preferredRankWidth}px)`
      : minRankWidth,
  }
}
