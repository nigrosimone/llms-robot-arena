import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { AssistantService } from './assistant.service';
import { Icon } from './icons';
import { ToastService } from './toast.service';

/**
 * The "try your LLM" card: connects an outside assistant to this tab, shows
 * the session code and what the assistant is doing, and lets the visitor
 * accept or reject the controller it sends.
 */
@Component({
  selector: 'app-assistant-card',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'info-card assistant-card', '[class.compact]': 'compact()' },
  template: `
    @let status = assistant.status();
    @let offer = assistant.offer();
    <div class="eyebrow">TRY YOUR LLM</div>
    @if (status === 'off' || status === 'unavailable') {
      <h2>Let your assistant build a robot.</h2>
      <p>
        Claude, ChatGPT, Cursor or Codex connect to this arena over MCP, write a controller, test it
        against the catalog and send it to this page. You accept it, it fights.
      </p>
      @if (status === 'unavailable') {
        <p class="assistant-note">The live server is not reachable right now. Try again later.</p>
      }
      <button id="connect-assistant" class="button accent full-width" (click)="assistant.connect()">
        <svg appIcon="bolt" />Connect an assistant
      </button>
    } @else if (status === 'connecting') {
      <p class="gate-running"><span class="loader"></span>Opening a session…</p>
    } @else {
      <div class="assistant-session">
        <span>Session</span>
        <b id="assistant-code">{{ assistant.code() }}</b>
        <button class="button quiet" (click)="assistant.disconnect()">End</button>
      </div>
      <p class="assistant-hint">Paste this into your assistant:</p>
      <div class="assistant-invitation">
        <code id="assistant-invitation">{{ assistant.invitation() }}</code>
        <button id="copy-invitation" class="button outline" (click)="copy(assistant.invitation())">
          <svg appIcon="link" [size]="14" />Copy
        </button>
      </div>
      <details class="assistant-setup">
        <summary>How to add the MCP server</summary>
        <p>
          Claude Desktop, Cursor and Codex take a server entry with the URL below; ChatGPT takes it
          as a connector in developer mode. No key, no account: the session code is the key.
        </p>
        <code>{{ assistant.mcp() }}</code>
      </details>
      @if (offer) {
        <div id="assistant-offer" class="assistant-offer">
          <strong>{{ offer.name }}</strong>
          <span>{{ offer.model || 'model not declared' }} · {{ size(offer.source) }}</span>
          <span [class]="offer.gate.pass ? 'pass' : 'advisory'">
            {{ offer.gate.pass ? 'Gate passed' : 'Gate passed with timing advisory' }}
          </span>
          <p>
            Your assistant sent this controller. It runs only inside the arena sandbox, and only if
            you accept it.
          </p>
          <div class="assistant-decision">
            <button id="accept-controller" class="button accent" (click)="assistant.accept()">
              <svg appIcon="check" />Accept and fight Baseline
            </button>
            <button id="reject-controller" class="button outline" (click)="assistant.reject()">
              Reject
            </button>
          </div>
        </div>
      } @else if (assistant.activity().length) {
        <ul id="assistant-activity" class="assistant-activity">
          @for (item of assistant.activity(); track item.at) {
            <li>{{ item.summary }}</li>
          }
        </ul>
      } @else {
        <p class="assistant-note">
          Waiting for the assistant. Its gate checks and matches show here.
        </p>
      }
    }
  `,
})
export class AssistantCard {
  protected readonly assistant = inject(AssistantService);
  private readonly toast = inject(ToastService);
  /** Shorter copy for the arena column. */
  readonly compact = input(false);
  /** Puts the invitation on the clipboard. */
  protected copy(text: string): void {
    navigator.clipboard.writeText(text).then(
      () => {
        this.toast.show('Copied. Paste it into your assistant.');
      },
      () => {
        this.toast.show('Select the text and copy it.', true);
      },
    );
  }
  /** Source size for the offer line. */
  protected size(source: string): string {
    return `${(new Blob([source]).size / 1024).toFixed(1)} KiB`;
  }
}
