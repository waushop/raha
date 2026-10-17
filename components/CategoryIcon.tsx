import {
  Baby, Car, Clapperboard, Dumbbell, FileText, Fuel, Gift, GraduationCap, HeartPulse, Home,
  Landmark, Lightbulb, Package, PawPrint, Phone, PiggyBank, Plane, Repeat, Scissors, ShieldCheck,
  Shirt, ShoppingCart, UtensilsCrossed, Wifi, Wrench, type LucideIcon,
} from "lucide-react";
import type { CategoryKey } from "@/types/expense";

// One Lucide glyph per standard category. Replaces the emoji in
// CATEGORIES[k].icon everywhere an SVG can render; the emoji stays for
// native <option> text and plain-text contexts.
export const CATEGORY_ICONS: Record<CategoryKey, LucideIcon> = {
  housing: Home,
  utilities: Lightbulb,
  groceries: ShoppingCart,
  dining: UtensilsCrossed,
  fuel: Fuel,
  transport: Car,
  maintenance: Wrench,
  insurance: ShieldCheck,
  health: HeartPulse,
  education: GraduationCap,
  kids: Baby,
  entertainment: Clapperboard,
  subscriptions: Repeat,
  clothing: Shirt,
  gifts: Gift,
  travel: Plane,
  personal: Scissors,
  pets: PawPrint,
  savings: PiggyBank,
  sports: Dumbbell,
  phone: Phone,
  internet: Wifi,
  loan: Landmark,
  tax: FileText,
  other: Package,
};

type Props = {
  category: CategoryKey | string;
  /** Pixel size; defaults to 16. */
  size?: number;
  className?: string;
  title?: string;
};

export default function CategoryIcon({ category, size = 16, className = "", title }: Props) {
  const Icon = CATEGORY_ICONS[category as CategoryKey] ?? Package;
  return (
    <Icon
      size={size}
      strokeWidth={1.75}
      className={`shrink-0 ${className}`}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    />
  );
}
