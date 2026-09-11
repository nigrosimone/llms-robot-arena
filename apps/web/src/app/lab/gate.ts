import { Component, input } from '@angular/core';
import { Icon } from '../core/icons';

export interface Gate {
  pass: boolean;
  eligible?: boolean;
  checks: { name: string; pass: boolean; required?: boolean; detail?: string }[];
}
export const gateLabel = (gate: Gate) => (gate.pass ? 'Passed' : (gate.eligible ?? gate.pass) ? 'Ready for exhibition' : 'Check failed');

// A gate verdict with its checks, in the Bot Lab and per controller in a tournament.
@Component({
  selector: 'gate-result',
  imports: [Icon],
  template: `
    @let eligible = gate().eligible ?? gate().pass;
    <div class="gate-verdict" [class.pass]="gate().pass" [class.advisory]="!gate().pass && eligible" [class.fail]="!eligible"><svg [icon]="eligible ? 'check' : 'close'"></svg> {{ label(gate()) }}</div>
    @if (eligible && !gate().pass) {<p class="gate-advisory">The 2 ms timing check failed on this device. This exhibition uses a deterministic instruction budget, so timing is advisory.</p>}
    @for (c of gate().checks; track c.name) {
      <div class="gate-check" [class.pass]="c.pass" [class.advisory]="!c.pass && c.required === false" [class.fail]="!c.pass && c.required !== false">@if (!c.pass && c.required === false) {<span aria-hidden="true">!</span>} @else {<svg [icon]="c.pass ? 'check' : 'close'" [size]="14"></svg>}<span>{{ c.name }}@if (c.detail) {<small>{{ c.detail }}{{ c.required === false ? ' · timing advisory' : '' }}</small>}</span></div>
    }
  `,
})
export class GateResult {
  readonly gate = input.required<Gate>();
  protected readonly label = gateLabel;
}
