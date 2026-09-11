import { APP_BASE_HREF } from '@angular/common';
import { type ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { UrlSerializer, provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideNgSimpleState } from 'ng-simple-state';
import { routes } from './app.routes';
import { TrailingSlashUrlSerializer } from './core/url';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    provideNgSimpleState({}),
    { provide: UrlSerializer, useClass: TrailingSlashUrlSerializer },
    // The site root is where the bundle came from, whatever page loaded it,
    // so the app works under a path prefix without a <base> tag.
    { provide: APP_BASE_HREF, useValue: new URL('./', import.meta.url).pathname },
  ],
};
