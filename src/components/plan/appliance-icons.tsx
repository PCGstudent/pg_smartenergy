import {
  BatteryCharging,
  CarFront,
  Droplets,
  Fan,
  Plug,
  WashingMachine,
  Waves,
  type LucideIcon,
} from 'lucide-react'
import type { ApplianceType } from '@/lib/db/appliance-queries'

/** Lucide icon per appliance type. `other` falls back to a generic plug. */
export const APPLIANCE_ICONS: Record<ApplianceType, LucideIcon> = {
  ev: CarFront,
  washer: WashingMachine,
  dishwasher: Droplets,
  water_heater: Waves,
  home_battery: BatteryCharging,
  dryer: Fan,
  pool_pump: Waves,
  other: Plug,
}
