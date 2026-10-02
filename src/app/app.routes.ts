import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, Router, Routes } from '@angular/router';

/** Sky-check links shared before the front page existed point at /?s=…; send them on to the tool. */
export function redirectLegacySkyCheckLinks(route: ActivatedRouteSnapshot) {
  return route.queryParamMap.has('s') ? inject(Router).createUrlTree(['/sky-check'], { queryParams: route.queryParams }) : true;
}

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Starlink sky check',
    canActivate: [redirectLegacySkyCheckLinks],
    loadComponent: () => import('./pages/home/home').then((m) => m.Home),
  },
  {
    path: 'sky-check',
    title: 'Sky check · Starlink sky check',
    loadComponent: () => import('./pages/sky-check/sky-check').then((m) => m.SkyCheck),
  },
  {
    path: 'satellites',
    title: 'Live satellites · Starlink sky check',
    loadComponent: () => import('./pages/satellites/satellites').then((m) => m.Satellites),
  },
  { path: '**', redirectTo: '' },
];
