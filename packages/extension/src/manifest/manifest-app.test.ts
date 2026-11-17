import { describe, expect, it } from 'vitest';
import { API_MANIFEST } from '../test-support/packages.js';
import { PackageSchema, type ExtensionPackage } from './manifest.schema.js';
import { appOf, imageParts, normalizeParts } from './parts.js';

const APP = { title: 'Probe', icon: 'radar', order: 10 };

const withApp = (parts: Record<string, unknown>, app?: unknown) => ({
  ...API_MANIFEST,
  agentage: { id: 'probe', parts, ...(app !== undefined && { app }) },
});

const issuesOf = (value: unknown) =>
  PackageSchema.safeParse(value).error?.issues.map((i) => `${i.path.join('.')}: ${i.message}`) ??
  [];

describe('the app part (S1.2.2 row 1)', () => {
  it('takes parts.app with agentage.app; an app alone is a routed part', () => {
    expect(issuesOf(withApp({ app: true }, APP))).toEqual([]);
    expect(issuesOf(withApp({ api: true, app: true }, { title: 'Probe' }))).toEqual([]);
  });

  it('refuses one without the other, and a part that is not a boolean', () => {
    expect(issuesOf(withApp({ api: true, app: true }))).toEqual([
      'agentage.parts.app: the app part and agentage.app come together',
    ]);
    expect(issuesOf(withApp({ api: true }, APP))).toEqual([
      'agentage.app: the app part and agentage.app come together',
    ]);
    expect(issuesOf(withApp({ app: { entry: './x.js' } }, APP))).not.toEqual([]);
  });

  it('refuses a bad title, icon or order and a key it does not know', () => {
    for (const app of [
      { title: '' },
      { title: 'x'.repeat(41) },
      { title: 'P', icon: 'Radar' },
      { title: 'P', icon: 'radar/../x' },
      { title: 'P', order: 1.5 },
      { title: 'P', order: -1 },
      { title: 'P', entry: './x.js' },
    ])
      expect(issuesOf(withApp({ app: true }, app)), JSON.stringify(app)).not.toEqual([]);
  });

  it('reserves the ids app, shell and host: they are first path segments of the daemon', () => {
    for (const id of ['app', 'shell', 'host']) {
      const pkg = { ...API_MANIFEST, agentage: { ...API_MANIFEST.agentage, id } };
      expect(issuesOf(pkg)).toEqual(['agentage.id: lowercase id, never a name the platform owns']);
    }
  });

  it('is no image and no host part; appOf reads its row', () => {
    const pkg = PackageSchema.parse(withApp({ api: true, app: true }, APP)) as ExtensionPackage;
    expect(imageParts(pkg)).toEqual(['api']);
    expect(Object.keys(normalizeParts(pkg.agentage.parts).code)).toEqual(['api']);
    expect(appOf(pkg)).toEqual(APP);
    expect(appOf(PackageSchema.parse(API_MANIFEST) as ExtensionPackage)).toBeUndefined();
  });
});
