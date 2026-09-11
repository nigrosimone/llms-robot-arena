import { DefaultUrlSerializer, UrlTree } from '@angular/router';

// The panels keep their static addresses (`/lab/`, `/rules/`), which the
// prerendered pages also answer to.
export class TrailingSlashUrlSerializer extends DefaultUrlSerializer {
  override serialize(tree: UrlTree): string {
    return super.serialize(tree).replace(/^\/([a-z-]+)(?=[?#]|$)/, '/$1/');
  }
}

// The address describes what is on the stage; the channel tag of the visit stays.
export function updateUrl({ search = '', hash = '' }: { search?: string; hash?: string }) {
  const url = new URL(location.href);
  const ref = url.searchParams.get('ref');
  url.search = search;
  url.hash = hash;
  if (ref) url.searchParams.set('ref', ref);
  history.replaceState(null, '', url);
}

export function download(name: string, data: BlobPart, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const clock = (t: number) =>
  `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// Assets live next to the bundles, never next to the page that loaded them:
// the static page at /rules/ still has to reach /standings.json and /replays/.
export const siteUrl = (path: string) => new URL(path, import.meta.url).href;
