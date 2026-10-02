export interface Kit {
  id: string;
  name: string;
  /** Full field-of-view cone angle in degrees. */
  fov: number;
  /** Suggested tilt from vertical in degrees. */
  defaultTilt: number;
  note: string;
}

/** Field-of-view values from Starlink's official product specification sheets. */
export const KITS: readonly Kit[] = [
  { id: 'std', name: 'Standard', fov: 110, defaultTilt: 20, note: 'Kickstand / pipe mount, manually aimed with the Starlink app.' },
  { id: 'mini', name: 'Mini', fov: 110, defaultTilt: 20, note: 'Compact kit, manually aimed with the Starlink app.' },
  {
    id: 'perf',
    name: 'Performance (Gen 3)',
    fov: 140,
    defaultTilt: 20,
    note: 'Successor to Flat High Performance, manually aimed with help from the Starlink app. The 20° tilt is a placeholder: Starlink publishes no default, so set the tilt the app shows.',
  },
  {
    id: 'fhp',
    name: 'Flat High Performance (older)',
    fov: 140,
    defaultTilt: 8,
    note: 'Fixed mount, no aiming: about 8° on the Wedge Mount (for rain run-off) or about 2° on the Flat Mount. Set the tilt to match your mount.',
  },
];

export const CUSTOM_KIT_ID = 'custom';

export function findKit(id: string): Kit | undefined {
  return KITS.find((k) => k.id === id);
}
