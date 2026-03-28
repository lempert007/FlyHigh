import SvgIcon, { SvgIconProps } from "@mui/material/SvgIcon";

/**
 * Top-down quadcopter drone icon.
 * Drop-in replacement for MUI icons — accepts all SvgIconProps (sx, fontSize, color, etc.)
 */
export default function DroneIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props} viewBox="0 0 24 24">
      <g stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {/* Arms */}
        <line x1="9.5"  y1="9.5"  x2="5"  y2="5"  strokeWidth="1.6" />
        <line x1="14.5" y1="9.5"  x2="19" y2="5"  strokeWidth="1.6" />
        <line x1="9.5"  y1="14.5" x2="5"  y2="19" strokeWidth="1.6" />
        <line x1="14.5" y1="14.5" x2="19" y2="19" strokeWidth="1.6" />
        {/* Central body */}
        <rect x="9.5" y="9.5" width="5" height="5" rx="1.2" strokeWidth="1.6" />
        {/* Motor housings */}
        <circle cx="4"  cy="4"  r="2.4" strokeWidth="1.5" />
        <circle cx="20" cy="4"  r="2.4" strokeWidth="1.5" />
        <circle cx="4"  cy="20" r="2.4" strokeWidth="1.5" />
        <circle cx="20" cy="20" r="2.4" strokeWidth="1.5" />
        {/* Camera lens */}
        <circle cx="12" cy="12" r="1.1" strokeWidth="1.2" />
      </g>
    </SvgIcon>
  );
}
