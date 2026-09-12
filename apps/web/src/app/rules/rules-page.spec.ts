import { TestBed } from '@angular/core/testing';
import { HAZARD_CARDS, RULES_NOTE, RULE_CARDS } from '../../../../../packages/site/content.js';
import { RulesPage } from './rules-page';

describe('RulesPage', () => {
  it('renders the same cards as the static page', async () => {
    TestBed.configureTestingModule({ imports: [RulesPage] });
    const fixture = TestBed.createComponent(RulesPage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const grids = el.querySelectorAll('.rules-grid');
    expect(grids).toHaveLength(2);
    expect(grids[0]?.textContent).toContain(RULE_CARDS[0]!.title);
    expect(grids[1]?.textContent).toContain(HAZARD_CARDS[0]!.title);
    expect(el.querySelector('.review-note strong')?.textContent).toBe(RULES_NOTE.title);
    expect(el.querySelector('.eyebrow')?.textContent).toMatch(/SPEC \d/);
  });
});
