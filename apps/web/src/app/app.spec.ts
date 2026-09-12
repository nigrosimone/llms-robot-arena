import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SITE, TABS } from '../../../../packages/site/content.js';
import { storeProviders } from '../testing/fakes';
import { App } from './app';
import { ToastService } from './core/toast.service';

describe('App', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), ...storeProviders],
    });
  });

  it('renders the tabs, the repository link and the toast', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const tabs = [...el.querySelectorAll('nav a.nav-button')];
    expect(tabs.map((a) => a.getAttribute('data-tab'))).toEqual(TABS.map((t) => t.id));
    expect(el.querySelector('a.github-link')?.getAttribute('href')).toBe(SITE.repository);
    expect(el.querySelector('.version')?.textContent).toContain('SPEC');
    const toast = el.querySelector<HTMLElement>('#toast')!;
    expect(toast.hidden).toBe(true);
    TestBed.inject(ToastService).show('Saved.', true);
    await fixture.whenStable();
    expect(toast.hidden).toBe(false);
    expect(toast.textContent.trim()).toBe('Saved.');
    expect(toast.classList.contains('error')).toBe(true);
  });
});
