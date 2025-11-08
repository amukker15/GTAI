import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const baseProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export const AlertCircle = (props: IconProps) => (
  <svg {...baseProps} {...props}>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" x2="12" y1="8" y2="12" />
    <line x1="12" x2="12.01" y1="16" y2="16" />
  </svg>
);

export const AlertTriangle = (props: IconProps) => (
  <svg {...baseProps} {...props}>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" x2="12" y1="9" y2="13" />
    <line x1="12" x2="12.01" y1="17" y2="17" />
  </svg>
);

export const CheckCircle = (props: IconProps) => (
  <svg {...baseProps} {...props}>
    <path d="M9 12 11 14 15 10" />
    <circle cx="12" cy="12" r="10" />
  </svg>
);

export const Shield = (props: IconProps) => (
  <svg {...baseProps} {...props}>
    <path d="M12 22s7-4 7-10V5L12 2 5 5v7c0 6 7 10 7 10z" />
  </svg>
);

export const Sun = (props: IconProps) => (
  <svg {...baseProps} {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </svg>
);

export const Moon = (props: IconProps) => (
  <svg {...baseProps} {...props}>
    <path d="M21 12.79A9 9 0 0 1 11.21 3 7 7 0 1 0 21 12.79z" />
  </svg>
);

export const Home = (props: IconProps) => (
  <svg {...baseProps} {...props}>
    <path d="M3 11 12 3l9 8" />
    <path d="M5 12v8h14v-8" />
    <path d="M9 21V9h6v12" />
  </svg>
);
