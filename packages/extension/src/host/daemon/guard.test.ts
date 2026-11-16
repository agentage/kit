import { describe, expect, it } from 'vitest';
import { loopbackPorts } from './guard.js';

describe('loopbackPorts', () => {
  it('the port of an http origin on 127.0.0.1 or localhost; none for any other', () => {
    expect(loopbackPorts('http://127.0.0.1:4243')).toEqual([4243]);
    expect(loopbackPorts('http://localhost:4243')).toEqual([4243]);
    expect(loopbackPorts('http://127.0.0.1')).toEqual([]);
    expect(loopbackPorts('https://127.0.0.1:4243')).toEqual([]);
    expect(loopbackPorts('https://probe.next.agentage.io')).toEqual([]);
    expect(loopbackPorts('not a url')).toEqual([]);
    expect(loopbackPorts(undefined)).toEqual([]);
  });
});
