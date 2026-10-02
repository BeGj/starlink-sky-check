export const DEFAULT_SKIP_RADIUS = 8;
/** Starlink's long-standing minimum elevation angle; regulators have since allowed lower in some places. */
export const DEFAULT_MIN_ELEVATION = 25;

export interface SpotSettings {
  lat: number;
  lon: number;
  /** Antenna height above ground (m). */
  height: number;
  kitId: string;
  /** Full cone angle (deg); follows the kit unless kitId is 'custom'. */
  fov: number;
  /** True azimuth the dish faces (deg). */
  azimuth: number;
  /** Tilt from vertical (deg). */
  tilt: number;
  /** Include trees and buildings (surface model) rather than bare terrain. */
  trees: boolean;
  /** Ignore surface cells closer than this (m) so the building the antenna is mounted on doesn't block itself. */
  skipRadius: number;
  /** Lowest elevation (deg) at which Starlink connects; obstructions below it don't count. */
  minElevation: number;
}

export interface Spot extends SpotSettings {
  id: number;
  name: string;
  color: string;
}

/** How the analysis is drawn on the map; see OVERLAY_MODES for descriptions. */
export type OverlayMode = 'fan-ring' | 'area' | 'ring' | 'all';
export const OVERLAY_MODES: readonly { id: OverlayMode; label: string }[] = [
  { id: 'fan-ring', label: 'Fan + ring' },
  { id: 'area', label: 'Horizon area' },
  { id: 'ring', label: 'Ring' },
  { id: 'all', label: 'All' },
];

export const SPOT_COLORS = ['#2563eb', '#d97706', '#7c3aed', '#059669', '#db2777', '#0891b2'];
