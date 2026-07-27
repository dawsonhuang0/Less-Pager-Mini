import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { search } from '../../src/features/searching';

import { initSecure, secureAllow } from '../../src/features/secure';

import { setSessionEnv } from '../../src/startup/environment';

beforeEach(() => {
  search.message = '';
});

afterEach(() => {
  delete process.env.LESSSECURE;
  delete process.env.LESSSECURE_ALLOW;
  delete process.env.LESSSECURE_DISALLOW;
  initSecure();
});

describe('a caller may tighten LESSSECURE, never loosen it', () => {
  afterEach(() => setSessionEnv(null));

  it('refuses to re-allow what the environment took away', () => {
    // og is a program its user ran, so whoever writes
    // LESSSECURE_ALLOW also wrote LESSSECURE. A library call has two
    // parties, and a deployment's hardening outranks the application
    process.env.LESSSECURE = '1';
    setSessionEnv({ LESSSECURE_ALLOW: 'shell,lessopen,edit' });
    initSecure();

    expect(secureAllow('shell')).toBe(false);
    expect(secureAllow('lessopen')).toBe(false);
    expect(secureAllow('edit')).toBe(false);
  });

  it('still lets a caller harden itself', () => {
    setSessionEnv({ LESSSECURE: '1' });
    initSecure();

    expect(secureAllow('shell')).toBe(false);

    // and pick what it hands back, since nothing above forbade it
    setSessionEnv({ LESSSECURE: '1', LESSSECURE_ALLOW: 'lessopen' });
    initSecure();

    expect(secureAllow('lessopen')).toBe(true);
    expect(secureAllow('shell')).toBe(false);
  });

  it('keeps a caller\'s DISALLOW, which only subtracts', () => {
    setSessionEnv({ LESSSECURE_DISALLOW: 'shell' });
    initSecure();

    expect(secureAllow('shell')).toBe(false);
    expect(secureAllow('tags')).toBe(true);
  });
});

describe('LESSSECURE', () => {
  it('allows everything by default', () => {
    initSecure();

    expect(secureAllow('shell')).toBe(true);
    expect(secureAllow('tags')).toBe(true);
    expect(secureAllow('history')).toBe(true);
  });

  it('allows nothing when LESSSECURE is set', () => {
    process.env.LESSSECURE = '1';
    initSecure();

    expect(secureAllow('shell')).toBe(false);
    expect(secureAllow('examine')).toBe(false);
    expect(secureAllow('glob')).toBe(false);
    expect(secureAllow('stop')).toBe(false);
  });

  it('re-allows features named in LESSSECURE_ALLOW', () => {
    process.env.LESSSECURE = '1';
    process.env.LESSSECURE_ALLOW = 'history,tags';
    initSecure();

    expect(secureAllow('history')).toBe(true);
    expect(secureAllow('tags')).toBe(true);
    expect(secureAllow('shell')).toBe(false);
  });

  it('subtracts LESSSECURE_DISALLOW from the open default', () => {
    process.env.LESSSECURE_DISALLOW = 'shell,pipe';
    initSecure();

    expect(secureAllow('shell')).toBe(false);
    expect(secureAllow('pipe')).toBe(false);
    expect(secureAllow('edit')).toBe(true);
  });

  it('prefix-matches names like csl_bitmap', () => {
    process.env.LESSSECURE_DISALLOW = 'sh,ed';
    initSecure();

    expect(secureAllow('shell')).toBe(false);
    expect(secureAllow('edit')).toBe(false);
  });

  it('reports invalid and ambiguous names', () => {
    process.env.LESSSECURE_DISALLOW = 'bogus';
    initSecure();
    expect(search.message).toBe('LESSSECURE_DISALLOW: invalid name "bogus"');

    // 'le' matches both lesskey and lessopen
    search.message = '';
    process.env.LESSSECURE_DISALLOW = 'le';
    initSecure();
    expect(search.message).toBe('LESSSECURE_DISALLOW: ambiguous name "le"');
  });
});
