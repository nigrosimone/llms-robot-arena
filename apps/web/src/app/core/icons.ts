import { ChangeDetectionStrategy, Component, input } from '@angular/core';

// The same strokes as the current viewer, one path each.
export const ICONS: Record<string, string> = {
  arena: 'M4 7 12 3l8 4v10l-8 4-8-4V7Zm0 0 8 4 8-4M12 11v10',
  code: 'm8 5-6 7 6 7m8-14 6 7-6 7m-3-16-2 18',
  trophy: 'M8 3h8v8a4 4 0 0 1-8 0V3Zm0 2H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 3v6m-4 0h8',
  book: 'M4 3h13a3 3 0 0 1 3 3v15H7a3 3 0 0 1-3-3V3Zm0 14h16M8 7h8m-8 4h6',
  play: 'm8 4 12 8-12 8V4Z',
  pause: 'M8 4v16M16 4v16',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  upload: 'M12 16V4m-5 5 5-5 5 5M4 17v4h16v-4',
  reset: 'M3 10a9 9 0 1 1 1 7M3 4v6h6',
  expand: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  bolt: 'm13 2-9 12h7l-1 8 10-13h-8l1-7Z',
  check: 'm4 12 5 5L20 6',
  close: 'm5 5 14 14M19 5 5 19',
  plus: 'M12 4v16M4 12h16',
  settings: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  swap: 'M4 7h16l-4-4M20 17H4l4 4',
  record: 'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z',
  sound: 'M4 9h4l5-4v14l-5-4H4V9Zm12 0a4 4 0 0 1 0 6m3-9a8 8 0 0 1 0 12',
  mute: 'M4 9h4l5-4v14l-5-4H4V9Zm12 1 6 6m0-6-6 6',
  stop: 'M6 6h12v12H6Z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5m-1.5 3.2a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5',
};

@Component({
  selector: 'svg[icon]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.width]': 'size()', '[attr.height]': 'size()', 'viewBox': '0 0 24 24', 'fill': 'none', 'stroke': 'currentColor',
    'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  },
  template: `<svg:path [attr.d]="path()" />`,
})
export class Icon {
  readonly icon = input.required<string>();
  readonly size = input(18);
  protected path = () => ICONS[this.icon()] ?? ICONS['arena'];
}
