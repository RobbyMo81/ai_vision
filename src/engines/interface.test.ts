import {
  AutomationError,
  EngineNotReadyError,
  NavigationError,
} from './interface';

describe('AutomationError', () => {
  it('sets name and engine', () => {
    const err = new AutomationError('boom', 'browser-use');
    expect(err.name).toBe('AutomationError');
    expect(err.engine).toBe('browser-use');
    expect(err.message).toBe('boom');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('EngineNotReadyError', () => {
  it('is an AutomationError with correct message', () => {
    const err = new EngineNotReadyError('stagehand');
    expect(err.name).toBe('EngineNotReadyError');
    expect(err.engine).toBe('stagehand');
    expect(err.message).toContain('stagehand');
    expect(err).toBeInstanceOf(AutomationError);
  });
});

describe('NavigationError', () => {
  it('includes the url in message', () => {
    const err = new NavigationError('browser-use', 'https://example.com');
    expect(err.message).toContain('https://example.com');
    expect(err).toBeInstanceOf(AutomationError);
  });
});
