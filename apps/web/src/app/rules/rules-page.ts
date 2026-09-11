import { Component } from '@angular/core';
import { SPEC_VERSION } from '../../../../../packages/sim/spec.js';
import { HAZARD_CARDS, RULE_CARDS, RULES_NOTE, ruleCards } from '../../../../../packages/site/content.js';

// The same cards as the static /rules/ page: markup shared with the prerender.
@Component({
  selector: 'rules-page',
  host: { id: 'panel-rules', class: 'panel' },
  template: `
    <div class="page-heading"><div><div class="eyebrow">SPEC {{ spec }} <span>/ 04</span></div><h1>Same hardware. Different minds<span>.</span></h1></div></div>
    <div class="rules-grid" [innerHTML]="rules"></div>
    <div class="rules-grid hazard-rules" [innerHTML]="hazards"></div>
    <div class="review-note"><strong>{{ note.title }}</strong><p>{{ note.body }}</p></div>
  `,
})
export class RulesPage {
  protected readonly spec = SPEC_VERSION.replace('-draft', '');
  protected readonly rules = ruleCards(RULE_CARDS);
  protected readonly hazards = ruleCards(HAZARD_CARDS);
  protected readonly note = RULES_NOTE;
}
