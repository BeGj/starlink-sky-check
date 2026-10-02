import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  template: `
    <div class="page">
      <section class="intro">
        <h1>Will Starlink work here?</h1>
        <p>
          Free tools for checking Starlink reception in Norway: see how much of the sky a dish would have from any spot,
          using Kartverket's laser elevation data, and watch where Starlink's satellites are right now.
        </p>
      </section>

      <ul class="cards">
        <li>
          <a class="card" routerLink="/sky-check">
            <svg class="icon" viewBox="0 0 48 48" aria-hidden="true">
              <path d="M4 40 L16 22 L24 32 L32 18 L44 40 Z" fill="#8a9a7b" />
              <path d="M10 40 A 14 14 0 0 1 38 40" fill="none" stroke="#1d4ed8" stroke-width="2.5" stroke-dasharray="4 3" />
              <circle cx="24" cy="40" r="3" fill="#1d4ed8" />
            </svg>
            <h2>Sky check</h2>
            <p>
              Place a dish on the map, set its height and aim, and see how much of its view hills, trees and buildings
              block. Works anywhere in Norway, with an optional 3D terrain view.
            </p>
            <span class="go">Open sky check <span aria-hidden="true">→</span></span>
          </a>
        </li>
        <li>
          <a class="card" routerLink="/satellites">
            <svg class="icon" viewBox="0 0 48 48" aria-hidden="true">
              <circle cx="24" cy="24" r="12" fill="#bfdbfe" stroke="#1d4ed8" stroke-width="2" />
              <ellipse cx="24" cy="24" rx="21" ry="8" fill="none" stroke="#475569" stroke-width="1.5" transform="rotate(-25 24 24)" />
              <circle cx="42" cy="17" r="2.5" fill="#dc2626" />
              <circle cx="7" cy="31" r="2.5" fill="#dc2626" />
            </svg>
            <h2>Live satellites</h2>
            <p>
              Every Starlink satellite on a 2D map or 3D globe, updated live. Rewind or fast-forward up to three days, or
              look up at the sky from your own spot with the terrain around you.
            </p>
            <span class="go">Open live satellites <span aria-hidden="true">→</span></span>
          </a>
        </li>
      </ul>

      <footer>
        <p>
          Elevation data and maps © <a href="https://www.kartverket.no/" target="_blank" rel="noopener">Kartverket</a>.
          Orbit data from <a href="https://celestrak.org/" target="_blank" rel="noopener">CelesTrak</a>.
          Not affiliated with Starlink or SpaceX. Results are estimates; confirm with the Starlink app before mounting.
        </p>
      </footer>
    </div>
  `,
  styles: `
    :host { display: block; }
    .page { max-width: 960px; margin: 0 auto; padding: 2.5rem 1.5rem 2rem; }
    .intro h1 { font-size: clamp(1.6rem, 4vw, 2.3rem); margin: 0 0 0.75rem; }
    .intro p { font-size: 1.05rem; line-height: 1.55; color: var(--muted); max-width: 62ch; margin: 0; }
    .cards { list-style: none; padding: 0; margin: 2rem 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.25rem; }
    .card {
      display: flex;
      flex-direction: column;
      height: 100%;
      box-sizing: border-box;
      padding: 1.25rem 1.25rem 1rem;
      border: 1px solid var(--border);
      border-radius: 12px;
      color: var(--text);
      text-decoration: none;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .card:hover { border-color: var(--accent); box-shadow: 0 4px 16px rgb(15 23 42 / 0.08); }
    .icon { width: 48px; height: 48px; }
    .card h2 { font-size: 1.2rem; margin: 0.75rem 0 0.4rem; }
    .card p { margin: 0 0 1rem; line-height: 1.5; color: var(--muted); flex: 1; }
    .go { color: var(--accent-text); font-weight: 600; }
    footer { border-top: 1px solid var(--border); padding-top: 1rem; font-size: 0.8rem; color: var(--muted); }
    footer a { color: inherit; }

    @media (max-width: 767px) {
      .page { padding: 1.5rem 16px; }
    }
  `,
})
export class Home {}
