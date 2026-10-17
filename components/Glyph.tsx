import { ICONS } from "@/lib/icons";
import { DEFAULT_GROUP_ICON, iconFromLegacy, type IconName } from "@/lib/icon-names";

type Props = {
  /** Icon name from ICON_NAMES; legacy emoji or unknown values fall back. */
  name: string | null | undefined;
  fallback?: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
};

// Renders a user-picked group/goal icon by name.
export default function Glyph({ name, fallback = DEFAULT_GROUP_ICON, size = 16, className = "", strokeWidth = 1.75 }: Props) {
  const Icon = ICONS[iconFromLegacy(name) ?? fallback];
  return <Icon size={size} strokeWidth={strokeWidth} className={`shrink-0 ${className}`} aria-hidden />;
}
