import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

// The other panels are out of the spike: a route each, lazy, with the heading.
@Component({
  selector: 'placeholder-page',
  template: `<div class="page-heading"><div><div class="eyebrow">{{ eyebrow }}</div><h1>{{ title }}<span>.</span></h1></div></div><p class="tournament-note">Not part of the Angular spike yet.</p>`,
})
export class PlaceholderPage {
  private readonly route = inject(ActivatedRoute);
  protected readonly title = this.route.snapshot.data['title'] ?? '';
  protected readonly eyebrow = this.route.snapshot.data['eyebrow'] ?? '';
}
