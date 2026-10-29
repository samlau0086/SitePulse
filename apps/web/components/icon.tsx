const paths = {
  mail: 'M3 5h18v14H3z M3 5l9 7 9-7',
  overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  globe:
    'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3c4 5 4 13 0 18-4-5-4-13 0-18',
  pulse: 'M2 12h5l3-8 4 16 3-8h5',
  alert: 'M12 3 2 21h20L12 3 M12 9v5 M12 17v.1',
  workspace: 'M3 7h18v14H3z M8 7V3h8v4 M3 12h18 M10 12v3h4v-3',
  shield: 'M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7l-9-4 M8 12l3 3 5-6',
  plus: 'M12 5v14 M5 12h14',
  refresh: 'M20 7v5h-5 M4 17v-5h5 M6 6a8 8 0 0 1 13 2 M18 18A8 8 0 0 1 5 16',
  arrow: 'M5 12h14 M13 6l6 6-6 6',
  up: 'M12 20V4 M5 11l7-7 7 7',
  down: 'M12 4v16 M5 13l7 7 7-7',
  check: 'M5 12l4 4L19 6',
  close: 'M6 6l12 12 M18 6 6 18',
  hourglass: 'M5 3h14 M5 21h14 M7 3v4l10 10v4 M17 3v4L7 17v4',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 7v5l3 2',
  inventory: 'M4 3h16v18H4z M8 7h8 M8 12h8 M8 17h5',
  connection: 'M8 3v5 M16 3v5 M5 8h14v3a7 7 0 0 1-14 0V8 M12 18v4',
  info: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 11v6 M12 7v.1',
} as const;

export type IconName = keyof typeof paths;

export function Icon({
  name,
  className = '',
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      className={`ui-icon ${className}`}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}
