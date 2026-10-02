import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, convertToParamMap, provideRouter, Router, UrlTree } from '@angular/router';
import { redirectLegacySkyCheckLinks } from './app.routes';

function snapshot(queryParams: Record<string, string>): ActivatedRouteSnapshot {
  return { queryParams, queryParamMap: convertToParamMap(queryParams) } as ActivatedRouteSnapshot;
}

describe('redirectLegacySkyCheckLinks', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));

  it('sends old /?s=… links to the sky check, keeping the query', () => {
    const result = TestBed.runInInjectionContext(() => redirectLegacySkyCheckLinks(snapshot({ s: '61,9,5,std,0,20,1,8', sel: '1' })));
    expect(result).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/sky-check?s=61,9,5,std,0,20,1,8&sel=1');
  });

  it('lets the front page load otherwise', () => {
    expect(TestBed.runInInjectionContext(() => redirectLegacySkyCheckLinks(snapshot({})))).toBe(true);
  });
});
