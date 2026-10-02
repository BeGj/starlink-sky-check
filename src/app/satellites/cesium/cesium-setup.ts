/**
 * Cesium loads its workers, assets and widget styles at runtime from CESIUM_BASE_URL; angular.json copies them
 * from node_modules/cesium/Build/Cesium to /cesium/. Import this module before anything from 'cesium'.
 */
const base = new URL('cesium/', document.baseURI).href;
(window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = base;

let cssAdded = false;

/** Adds Cesium's widget stylesheet once, only on pages that use Cesium (keeps it out of the initial bundle). */
export function ensureCesiumCss(): void {
  if (cssAdded) return;
  cssAdded = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `${base}Widgets/widgets.css`;
  document.head.appendChild(link);
}
