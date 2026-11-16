// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { navigate, parseRoute, setAside } from './router.js';

describe('router', () => {
  it('parses the id, the page and the reserved aside key', () => {
    expect(parseRoute('/', '')).toEqual({
      id: '',
      page: '',
      aside: null,
      app: { path: '', query: {} },
    });
    expect(parseRoute('/probe/home/x', '?details=1&tab=2')).toEqual({
      id: 'probe',
      page: 'home/x',
      aside: 'details',
      app: { path: 'home/x', query: { details: '1', tab: '2' } },
    });
    expect(parseRoute('/probe', '?details=0&other=1').aside).toBeNull();
    expect(parseRoute('/probe', '?inbox=1').aside).toBe('inbox');
  });

  it('pushes a path, sets and clears the aside key and keeps other query values', () => {
    navigate('/probe/home?tab=2');
    expect(location.pathname).toBe('/probe/home');
    const length = history.length;
    navigate('/probe/home?tab=2');
    expect(history.length).toBe(length);
    setAside('details');
    expect(location.search).toBe('?tab=2&details=1');
    setAside('inspect');
    expect(location.search).toBe('?tab=2&inspect=1');
    setAside(null);
    expect(location.search).toBe('?tab=2');
    navigate('/fixture');
    setAside(null);
    expect(location.search).toBe('');
  });
});
