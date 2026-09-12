import { DefaultUrlSerializer, type UrlTree } from '@angular/router';

/**
 * The panels keep their static addresses (`/lab/`, `/rules/`), which the
 * prerendered pages also answer to.
 */
export class TrailingSlashUrlSerializer extends DefaultUrlSerializer {
  /** Adds the trailing slash to a top level path. */
  override serialize(tree: UrlTree): string {
    return super.serialize(tree).replace(/^\/([a-z-]+)(?=[?#]|$)/, '/$1/');
  }
}

/** The address describes what is on the stage; the channel tag of the visit stays. */
export function updateUrl({ search = '', hash = '' }: { search?: string; hash?: string }): void {
  const url = new URL(location.href);
  const ref = url.searchParams.get('ref');
  url.search = search;
  url.hash = hash;
  if (ref) url.searchParams.set('ref', ref);
  history.replaceState(null, '', url);
}

/** Saves data as a file through a temporary link. */
export function download(name: string, data: BlobPart, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

/** Seconds as mm:ss for the HUD. */
export const clock = (t: number): string =>
  `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/**
 * Assets live next to the bundles, never next to the page that loaded them:
 * the static page at /rules/ still has to reach /standings.json and /replays/.
 */
export const siteUrl = (path: string): string => new URL(path, import.meta.url).href;

/** The value of the input or select behind an event, without `$any` in the templates. */
export const inputValue = (event: Event): string =>
  (event.target as HTMLInputElement | HTMLSelectElement).value;
/** The checked state of the checkbox behind an event. */
export const inputChecked = (event: Event): boolean => (event.target as HTMLInputElement).checked;

/**
 * The live server: `?live=http://127.0.0.1:8787` points a tab at a local one
 * and is remembered for the tab, the site's own otherwise.
 */
export const liveUrl = (fallback: string): string => {
  const requested = new URLSearchParams(location.search).get('live');
  try {
    if (requested) sessionStorage.setItem('live', requested);
    return (sessionStorage.getItem('live') ?? fallback).replace(/\/$/, '');
  } catch {
    return (requested ?? fallback).replace(/\/$/, '');
  }
};
