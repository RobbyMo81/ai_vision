import { EngineRegistry } from './registry';

describe('EngineRegistry', () => {
  let reg: EngineRegistry;

  beforeEach(() => {
    reg = new EngineRegistry();
  });

  it('lists all two engines', () => {
    expect(reg.availableEngines()).toEqual(
      expect.arrayContaining(['browser-use', 'skyvern'])
    );
  });

  it('returns the same instance on repeated get()', () => {
    const a = reg.get('browser-use');
    const b = reg.get('browser-use');
    expect(a).toBe(b);
  });

  it('returns different instances for different engine ids', () => {
    const a = reg.get('browser-use');
    const b = reg.get('skyvern');
    expect(a).not.toBe(b);
  });

  it('throws for an unknown engine id', () => {
    // @ts-expect-error intentional bad input
    expect(() => reg.get('unknown-engine')).toThrow();
  });

  it('each engine has the correct id', () => {
    for (const id of reg.availableEngines()) {
      expect(reg.get(id).id).toBe(id);
    }
  });

  it('closeAll() does not throw when no engines are initialized', async () => {
    await expect(reg.closeAll()).resolves.toBeUndefined();
  });
});
