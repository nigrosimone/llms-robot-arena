import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SPEC_VERSION, ENGINE_VERSION } from '../../../../packages/sim/spec.js';

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  selector: 'app-root',
  template: `
    <header class="header">
      <a class="brand" routerLink="/" aria-label="llms-robot-arena, home"><span class="brand-mark" aria-hidden="true">R<span>↗</span></span><span>llms-<span class="brand-second">robot-arena</span></span></a>
      <nav aria-label="Main navigation">
        @for (tab of tabs; track tab.path) {
          <a class="nav-button" [routerLink]="tab.path" routerLinkActive="selected" [routerLinkActiveOptions]="{ paths: 'exact', queryParams: 'ignored', fragment: 'ignored', matrixParams: 'ignored' }"><span>{{ tab.label }}</span></a>
        }
      </nav>
      <div class="header-end"><span class="version">SPEC {{ spec }}</span></div>
    </header>
    <main><router-outlet /></main>
    <footer class="footer"><span>llms-robot-arena</span><span>Angular spike</span><span>ENGINE {{ engine }}</span></footer>
  `,
})
export class App {
  protected readonly tabs = [
    { path: '/', label: 'Arena' }, { path: '/lab', label: 'Bot Lab' }, { path: '/tournament', label: 'Tournament' }, { path: '/rules', label: 'Rules' },
  ];
  protected readonly spec = SPEC_VERSION.replace('-draft', '');
  protected readonly engine = ENGINE_VERSION;
}
