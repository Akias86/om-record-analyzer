import type { SVGProps } from 'react'

/* ---------------------------------------------------------------------------
   Icon set. Hand-authored 24×24 stroke glyphs on a shared 1.6px stroke so
   every icon in the app has the same visual weight. They inherit `currentColor`
   and scale with `size`, which keeps icons legible at 14px in dense table
   headers and at 22px in the top bar alike.
--------------------------------------------------------------------------- */

export interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number
}

function Svg({ size = 16, strokeWidth = 1.6, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

/** Brand mark: a hexagonal reaction tile. */
export function IconHexagon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2.6 20.4 7.3v9.4L12 21.4 3.6 16.7V7.3z" />
    </Svg>
  )
}

export function IconSearch(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="10.8" cy="10.8" r="6.6" />
      <path d="m15.7 15.7 4.1 4.1" />
    </Svg>
  )
}

export function IconUpload(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 15.5V4m0 0L7.8 8.2M12 4l4.2 4.2" />
      <path d="M4.2 15v3.6A1.4 1.4 0 0 0 5.6 20h12.8a1.4 1.4 0 0 0 1.4-1.4V15" />
    </Svg>
  )
}

export function IconDownload(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 4v11.5m0 0 4.2-4.2M12 15.5 7.8 11.3" />
      <path d="M4.2 15v3.6A1.4 1.4 0 0 0 5.6 20h12.8a1.4 1.4 0 0 0 1.4-1.4V15" />
    </Svg>
  )
}

export function IconTable(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.2" y="4.2" width="17.6" height="15.6" rx="1.8" />
      <path d="M3.2 9.4h17.6M3.2 14.6h17.6M9.4 9.4v10.4" />
    </Svg>
  )
}

/** Scatter plot: the Pareto view. */
export function IconScatter(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.6 3.6v16.8h16.8" />
      <circle cx="8.4" cy="15.6" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12.2" cy="11.4" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="16.6" cy="7.8" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="18.6" cy="14.4" r="1.5" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function IconSun(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.8v2.4M12 18.8v2.4M4.5 4.5l1.7 1.7M17.8 17.8l1.7 1.7M2.8 12h2.4M18.8 12h2.4M4.5 19.5l1.7-1.7M17.8 6.2l1.7-1.7" />
    </Svg>
  )
}

export function IconMoon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20.2 14.6A8.4 8.4 0 0 1 9.4 3.8a8.6 8.6 0 1 0 10.8 10.8z" />
    </Svg>
  )
}

export function IconMonitor(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.8" y="4.2" width="18.4" height="12.6" rx="1.8" />
      <path d="M9 20.4h6M12 16.8v3.6" />
    </Svg>
  )
}

export function IconChevronRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m9.4 5.2 6.8 6.8-6.8 6.8" />
    </Svg>
  )
}

export function IconChevronDown(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m5.2 9.4 6.8 6.8 6.8-6.8" />
    </Svg>
  )
}

export function IconClose(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.2 6.2 17.8 17.8M17.8 6.2 6.2 17.8" />
    </Svg>
  )
}

export function IconCheck(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m4.8 12.6 4.8 4.8 9.6-10.8" />
    </Svg>
  )
}

export function IconPlay(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8.2 5.4 18.6 12 8.2 18.6z" fill="currentColor" />
    </Svg>
  )
}

/** Alembic — verification / the batch validator. */
export function IconAlembic(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9.2 3.2h5.6M10.4 3.2v6.4L5.9 17.4A2.4 2.4 0 0 0 8 21h8a2.4 2.4 0 0 0 2.1-3.6L13.6 9.6V3.2" />
      <path d="M7.6 15.4h8.8" />
    </Svg>
  )
}

export function IconSliders(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.8 7.2h4.4m3.6 0h8.4M3.8 16.8h8.4m3.6 0h4.4" />
      <circle cx="10" cy="7.2" r="1.9" />
      <circle cx="14" cy="16.8" r="1.9" />
    </Svg>
  )
}

export function IconTarget(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.4" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function IconClock(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.4V12l3.2 2" />
    </Svg>
  )
}

export function IconAlert(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.8 21.2 20.2H2.8z" />
      <path d="M12 9.8v4.2M12 17.2v.1" />
    </Svg>
  )
}

export function IconInfo(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 11v5.2M12 7.9v.1" />
    </Svg>
  )
}

export function IconFolder(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.2 6.6A1.6 1.6 0 0 1 4.8 5h4l2 2.6h8.4a1.6 1.6 0 0 1 1.6 1.6v9.2a1.6 1.6 0 0 1-1.6 1.6H4.8a1.6 1.6 0 0 1-1.6-1.6z" />
    </Svg>
  )
}

export function IconLayers(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m12 3.4 8.6 4.6L12 12.6 3.4 8z" />
      <path d="m3.4 12.6 8.6 4.6 8.6-4.6M3.4 16.8 12 21.4l8.6-4.6" />
    </Svg>
  )
}

export function IconExternal(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14.2 3.8h6v6M20.2 3.8 11.6 12.4" />
      <path d="M18 14.4v4.4a1.8 1.8 0 0 1-1.8 1.8H5.4a1.8 1.8 0 0 1-1.8-1.8V7.8a1.8 1.8 0 0 1 1.8-1.8h4.4" />
    </Svg>
  )
}

export function IconArrowLeft(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M19.6 12H4.4m0 0 6.2-6.2M4.4 12l6.2 6.2" />
    </Svg>
  )
}

export function IconTrash(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.4 6.8h15.2M9.6 6.8V4.6h4.8v2.2M6.6 6.8l.9 12.2A1.8 1.8 0 0 0 9.3 20.7h5.4a1.8 1.8 0 0 0 1.8-1.7l.9-12.2" />
    </Svg>
  )
}

export function IconSparkle(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m12 3.4 1.9 5.9 5.9 1.9-5.9 1.9L12 19l-1.9-5.9-5.9-1.9 5.9-1.9z" />
      <path d="M18.6 3.4v3M20.1 4.9h-3" />
    </Svg>
  )
}

/** Frame/zoom reset: corners pulling back out. */
export function IconExpand(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5" />
    </Svg>
  )
}

export function IconMenu(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  )
}

export function IconGrid(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.6" y="3.6" width="7" height="7" rx="1.4" />
      <rect x="13.4" y="3.6" width="7" height="7" rx="1.4" />
      <rect x="3.6" y="13.4" width="7" height="7" rx="1.4" />
      <rect x="13.4" y="13.4" width="7" height="7" rx="1.4" />
    </Svg>
  )
}
