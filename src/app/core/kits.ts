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
  { id: 'fhp', name: 'Flat High Performance', fov: 140, defaultTilt: 8, note: 'Fixed mount, installed at about 8° for rain run-off.' },
];

export const CUSTOM_KIT_ID = 'custom';

export function findKit(id: string): Kit | undefined {
  return KITS.find((k) => k.id === id);
}
