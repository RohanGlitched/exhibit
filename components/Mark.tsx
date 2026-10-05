/** Two exhibit stickers, the buyer's yellow under the seller's blue: both sides of a case. */
export default function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round(size * 0.8)} viewBox="0 0 30 24" aria-hidden="true" focusable="false">
      <rect x="2" y="4" width="20" height="14" rx="2.2" fill="#f3cf3a" transform="rotate(-8 12 11)" />
      <rect x="8" y="6" width="20" height="14" rx="2.2" fill="#2b63e8" transform="rotate(5 18 13)" />
      <rect x="11.5" y="10.6" width="11" height="1.8" rx="0.9" fill="#fff" transform="rotate(5 18 13)" />
      <rect x="11.5" y="14.2" width="7" height="1.8" rx="0.9" fill="#fff" opacity="0.75" transform="rotate(5 18 13)" />
    </svg>
  );
}
