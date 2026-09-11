import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ENGINE_VERSION, SPEC_VERSION } from '../../../../packages/sim/spec.js';
import { CONTROLLERS, TABS } from '../../../../packages/site/content.js';
import { trackPage } from '../../../../packages/viewer/analytics.js';
import { Icon } from './core/icons';
import { ToastService } from './core/toast.service';

/** The shell: header with the tabs, the routed panel, footer and toast. */
@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon],
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="header">
      <a class="brand" routerLink="/" aria-label="llms-robot-arena, home"
        ><span class="brand-mark" aria-hidden="true">R<span>↗</span></span
        ><span>llms-<span class="brand-second">robot-arena</span></span></a
      >
      <nav aria-label="Main navigation">
        @for (tab of tabs; track tab.id) {
          <a
            class="nav-button"
            [attr.data-tab]="tab.id"
            [routerLink]="'/' + tab.route"
            routerLinkActive="selected"
            #active="routerLinkActive"
            [attr.aria-current]="active.isActive ? 'page' : 'false'"
            [routerLinkActiveOptions]="activeOptions"
            (click)="trackPage('/' + tab.route)"
            ><svg [appIcon]="tab.icon" /><span>{{ tab.label }}</span></a
          >
        }
      </nav>
      <div class="header-end">
        <span class="version">SPEC {{ spec }} </span>
      </div>
    </header>
    <main><router-outlet /></main>
    <footer class="footer">
      <span
        ><a
          href="https://github.com/nigrosimone/llms-robot-arena"
          title="View llms-robot-arena on GitHub"
          >llms-robot-arena</a
        ></span
      >
      <nav class="footer-links" aria-label="Reference pages">
        <a [href]="'/' + controllers.route">{{ controllers.label }}</a>
      </nav>
      <span>Code makes the difference.</span><span>ENGINE {{ engine }}</span
      ><span>Cookie-free analytics</span>
    </footer>
    <div
      id="toast"
      role="status"
      aria-live="polite"
      [class.error]="toast.error()"
      [hidden]="!toast.visible()"
    >
      {{ toast.message() }}
    </div>
  `,
})
export class App {
  protected readonly tabs = TABS;
  protected readonly controllers = CONTROLLERS;
  protected readonly spec = SPEC_VERSION.replace('-draft', '');
  protected readonly engine = ENGINE_VERSION;
  protected readonly toast = inject(ToastService);
  protected readonly trackPage = trackPage;
  // A match URL keeps the arena link active whatever its query and fragment.
  protected readonly activeOptions = {
    paths: 'exact',
    queryParams: 'ignored',
    fragment: 'ignored',
    matrixParams: 'ignored',
  } as const;
}
