import styles from "./stamp.module.css";

/**
 * A rubber stamp in red ink: a double border, a big word and a date line, roughened by an SVG turbulence
 * filter so it reads as ink on paper rather than a badge.
 */
export default function Stamp({ word, line, tone = "due", animate = true, className = "" }: { word: string; line: string; tone?: "due" | "won" | "ink"; animate?: boolean; className?: string }) {
  const id = `ink-${word.toLowerCase().replace(/\W/g, "")}`;
  return (
    <div className={`${styles.stamp} ${animate ? styles.animate : ""} ${className}`} data-tone={tone} role="img" aria-label={`${word}, ${line}`}>
      <svg viewBox="0 0 300 120" width="100%" height="100%" aria-hidden="true">
        <defs>
          <filter id={id} x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="noise" />
            <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.2 1.35" result="mask" />
            <feComposite in="SourceGraphic" in2="mask" operator="in" result="inked" />
            <feTurbulence type="turbulence" baseFrequency="0.035" numOctaves="2" seed="3" result="warp" />
            <feDisplacementMap in="inked" in2="warp" scale="2.2" />
          </filter>
        </defs>
        <g filter={`url(#${id})`} fill="none" stroke="currentColor">
          <rect x="6" y="6" width="288" height="108" rx="10" strokeWidth="5" />
          <rect x="15" y="15" width="270" height="90" rx="6" strokeWidth="1.6" />
          <text x="150" y="72" textAnchor="middle" fill="currentColor" stroke="none" fontSize="50" fontWeight="800" letterSpacing="6" fontFamily="var(--font-sans), sans-serif">
            {word}
          </text>
          <text x="150" y="95" textAnchor="middle" fill="currentColor" stroke="none" fontSize="13.5" fontWeight="700" letterSpacing="2.4" fontFamily="var(--font-sans), sans-serif">
            {line}
          </text>
        </g>
      </svg>
    </div>
  );
}
