/** Line-art toggle: hamburger when sidebar closed, panel-with-rail when open (matches reference UI). */
const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export function HamburgerIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <line x1="4" y1="7" x2="20" y2="7" {...stroke} />
      <line x1="4" y1="12" x2="20" y2="12" {...stroke} />
      <line x1="4" y1="17" x2="20" y2="17" {...stroke} />
    </svg>
  );
}

export function SidebarPanelIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" ry="3" {...stroke} />
      <line x1="9.5" y1="7" x2="9.5" y2="17" {...stroke} />
    </svg>
  );
}
