interface IconProps {
  name: string
  size?: number
}

export function Icon({ name, size = 18 }: IconProps): JSX.Element {
  const paths: Record<string, JSX.Element> = {
    home: <><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></>,
    book: <><path d="M4 4h10a4 4 0 014 4v12H8a4 4 0 01-4-4V4z"/><path d="M4 4v12a4 4 0 014 4"/></>,
    bookmark: <path d="M6 3h12v18l-6-4-6 4V3z"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></>,
    send: <path d="M4 12l16-8-6 16-3-7-7-1z"/>,
    share: <><circle cx="6" cy="12" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M8 11l8-4M8 13l8 4"/></>,
    check: <path d="M5 12l5 5L20 7"/>,
    x: <path d="M5 5l14 14M19 5L5 19"/>,
    arrow: <path d="M5 12h14M13 6l6 6-6 6"/>,
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>,
    close: <path d="M5 5l14 14M19 5L5 19"/>,
    tune: <><path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h14M18 18h2"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/></>,
    fire: <path d="M12 3c1 3-1 4-1 7s2 4 2 7a4 4 0 01-8 0c0-3 2-5 2-7s-1-4 2-7z"/>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    sparkle: <><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M19 15l.7 2 2 .7-2 .7L19 21l-.7-2-2-.7 2-.7L19 15z"/></>,
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name] ?? null}
    </svg>
  )
}
