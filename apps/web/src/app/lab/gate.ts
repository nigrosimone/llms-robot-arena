import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { type GateVerdict } from '../../../../../packages/tournament/exhibition.js';
import { Icon } from '../core/icons';

/** The verdict of a gate check in words. */
export const gateLabel = (gate: GateVerdict): string =>
  gate.pass ? 'Passed' : (gate.eligible ?? gate.pass) ? 'Ready for exhibition' : 'Check failed';

/** A gate verdict with its checks, in the Bot Lab and per controller in a tournament. */
@Component({
  selector: 'app-gate-result',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let eligible = this.eligible();
    <div
      class="gate-verdict"
      [class.pass]="gate().pass"
      [class.advisory]="!gate().pass && eligible"
      [class.fail]="!eligible"
    >
      <svg [appIcon]="eligible ? 'check' : 'close'" /> {{ label(gate()) }}
    </div>
    @if (eligible && !gate().pass) {
      <p class="gate-advisory">
        The 2 ms timing check failed on this device. This exhibition uses a deterministic
        instruction budget, so timing is advisory.
      </p>
    }
    @for (c of gate().checks; track c.name) {
      <div
        class="gate-check"
        [class.pass]="c.pass"
        [class.advisory]="!c.pass && c.required === false"
        [class.fail]="!c.pass && c.required !== false"
      >
        @if (!c.pass && c.required === false) {
          <span aria-hidden="true">!</span>
        } @else {
          <svg [appIcon]="c.pass ? 'check' : 'close'" [size]="14" />
        }
        <span
          >{{ c.name }}
          @if (c.detail) {
            <small>{{ c.detail }}{{ c.required === false ? ' · timing advisory' : '' }}</small>
          }
        </span>
      </div>
    }
  `,
})
export class GateResult {
  readonly gate = input.required<GateVerdict>();
  protected readonly eligible = computed(() => this.gate().eligible ?? this.gate().pass);
  protected readonly label = gateLabel;
}
