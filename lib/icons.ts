import {
  Baby, Bike, BookOpen, Briefcase, Bus, Camera, Car, Cat, ClipboardList, Coffee, Dog, Drama, Dumbbell,
  Flower2, Fuel, Gamepad2, Gem, Gift, Globe, GraduationCap, Guitar, Heart, Hospital, House, Landmark,
  Laptop, Map, Music, Package, PartyPopper, PawPrint, PiggyBank, Plane, Receipt, Shield, Shirt,
  ShoppingCart, Smartphone, Sparkles, Star, Sun, Target, TreePalm, TreePine, Tv, UserRound, Users,
  Utensils, Volleyball, Wallet, Wrench, Zap, type LucideIcon,
} from "lucide-react";
import type { IconName } from "./icon-names";

export const ICONS: Record<IconName, LucideIcon> = {
  house: House, car: Car, bus: Bus, bike: Bike, fuel: Fuel, baby: Baby, users: Users, "user-round": UserRound,
  briefcase: Briefcase, "graduation-cap": GraduationCap, "book-open": BookOpen, hospital: Hospital, heart: Heart,
  dumbbell: Dumbbell, volleyball: Volleyball, "paw-print": PawPrint, dog: Dog, cat: Cat, plane: Plane,
  "tree-palm": TreePalm, map: Map, globe: Globe, camera: Camera, drama: Drama, music: Music, guitar: Guitar,
  "gamepad-2": Gamepad2, tv: Tv, laptop: Laptop, smartphone: Smartphone, "shopping-cart": ShoppingCart,
  utensils: Utensils, coffee: Coffee, shirt: Shirt, gem: Gem, gift: Gift, "party-popper": PartyPopper,
  sparkles: Sparkles, star: Star, sun: Sun, "flower-2": Flower2, "tree-pine": TreePine, wrench: Wrench, zap: Zap,
  shield: Shield, target: Target, "piggy-bank": PiggyBank, wallet: Wallet, landmark: Landmark, receipt: Receipt,
  "clipboard-list": ClipboardList, package: Package,
};
