const PATHS: Record<string, string> = {
  play: 'M7 4.5v15l12.5-7.5z',
  pause: 'M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z',
  start: 'M5 5h2.5v14H5zM19 5v14L8.5 12z',
  back: 'M11.5 6v12L3 12zM21 6v12l-8.5-6z',
  forward: 'M12.5 6v12L21 12zM3 6v12l8.5-6z',
  return: 'M9 7V3.5L3.5 9 9 14.5V11h5a4 4 0 010 8H8v2.5h6a6.5 6.5 0 000-13H9z',
  loop: 'M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z',
  marker: 'M6 3h12v13l-6 5-6-5z',
  zoomIn: 'M10 3a7 7 0 015.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1110 3zm0 2a5 5 0 100 10 5 5 0 000-10zm-1 2h2v2h2v2h-2v2H9v-2H7V9h2z',
  zoomOut: 'M10 3a7 7 0 015.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1110 3zm0 2a5 5 0 100 10 5 5 0 000-10zM7 9h6v2H7z',
  fit: 'M3 3h6v2H5v4H3zm12 0h6v6h-2V5h-4zM3 15h2v4h4v2H3zm16 0h2v6h-6v-2h4z',
  follow: 'M12 4l7 16-7-4-7 4z',
  open: 'M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z',
  download: 'M11 3h2v9.2l3.3-3.3 1.4 1.4L12 16l-5.7-5.7 1.4-1.4 3.3 3.3zM4 18h16v2H4z',
  save: 'M5 3h11l4 4v12a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 011-2zm2 2v5h9V5zm5 9a2.5 2.5 0 100 5 2.5 2.5 0 000-5z',
  help: 'M12 2a10 10 0 110 20 10 10 0 010-20zm0 14a1.3 1.3 0 100 2.6 1.3 1.3 0 000-2.6zm0-10a4 4 0 00-4 4h2a2 2 0 114 0c0 2-3 1.8-3 5h2c0-2.2 3-2.5 3-5a4 4 0 00-4-4z',
  close: 'M6.4 5L12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4L12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z',
  trash: 'M9 3h6l1 2h4v2H4V5h4zm-3 6h12l-1 12H7z',
  roll: 'M3 5h18v2H3zm0 4h12v2H3zm0 4h16v2H3zm0 4h9v2H3z',
  notes: 'M9 3h11v13.5a3 3 0 11-2-2.83V7h-7v11.5a3 3 0 11-2-2.83z',
};

export function Icon({ name, size = 18 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}
