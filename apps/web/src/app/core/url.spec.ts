import { UrlTree } from '@angular/router';
import { TrailingSlashUrlSerializer, clock, inputChecked, inputValue, updateUrl } from './url';

describe('TrailingSlashUrlSerializer', () => {
  const serializer = new TrailingSlashUrlSerializer();
  const serialize = (url: string): string => serializer.serialize(serializer.parse(url));

  it('gives the panels their static addresses', () => {
    expect(serialize('/lab')).toBe('/lab/');
    expect(serialize('/rules?x=1#m=abc')).toBe('/rules/?x=1#m=abc');
  });
  it('leaves the root and deeper paths alone', () => {
    expect(serialize('/')).toBe('/');
    expect(serialize('/bots/baseline')).toBe('/bots/baseline');
    expect(serializer.serialize(new UrlTree())).toBe('/');
  });
});

describe('updateUrl', () => {
  it('replaces the search and hash but keeps the channel tag', () => {
    history.replaceState(null, '', '/?ref=clip&a=1#m=old');
    updateUrl({ search: '?seed=7' });
    expect(location.search).toBe('?seed=7&ref=clip');
    expect(location.hash).toBe('');
    updateUrl({ hash: '#m=new' });
    expect(location.search).toBe('?ref=clip');
    expect(location.hash).toBe('#m=new');
  });
});

describe('form helpers', () => {
  it('formats the clock and reads inputs', () => {
    expect(clock(0)).toBe('00:00');
    expect(clock(83.6)).toBe('01:23');
    const input = document.createElement('input');
    input.value = 'seven';
    input.checked = true;
    const event = new Event('input');
    input.dispatchEvent(event);
    expect(inputValue(event)).toBe('seven');
    expect(inputChecked(event)).toBe(true);
  });
});
