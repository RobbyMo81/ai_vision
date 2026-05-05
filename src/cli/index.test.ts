jest.mock('../telemetry', () => ({ telemetry: { emit: jest.fn() } }));
jest.mock('../engines/registry', () => ({
  registry: {
    closeAll: jest.fn().mockResolvedValue(undefined),
    availableEngines: jest.fn(() => ['browser-use', 'skyvern']),
    get: jest.fn(),
  },
}));

import { gracefulServeShutdown, program } from './index';
import { telemetry } from '../telemetry';

const mockTelemetryEmit = telemetry.emit as jest.Mock;

describe('gracefulServeShutdown', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('closes servers and resources best-effort and emits completion telemetry', async () => {
    const uiServer = {
      close: jest.fn((callback: (error?: Error) => void) => callback()),
    };
    const webhookServer = {
      close: jest.fn((callback: (error?: Error) => void) => callback()),
    };
    const closeRegistry = jest.fn().mockResolvedValue(undefined);
    const closeSessionManager = jest.fn().mockResolvedValue(undefined);

    await gracefulServeShutdown({
      uiServer,
      webhookServer,
      closeRegistry,
      closeSessionManager,
    });

    expect(uiServer.close).toHaveBeenCalled();
    expect(webhookServer.close).toHaveBeenCalled();
    expect(closeRegistry).toHaveBeenCalled();
    expect(closeSessionManager).toHaveBeenCalled();
    expect(mockTelemetryEmit).toHaveBeenCalledWith(expect.objectContaining({ name: 'serve.shutdown.started' }));
    expect(mockTelemetryEmit).toHaveBeenCalledWith(expect.objectContaining({ name: 'serve.shutdown.completed' }));
  });

  it('records failed shutdown attempts without throwing', async () => {
    const uiServer = {
      close: jest.fn((callback: (error?: Error) => void) => callback(new Error('close failed'))),
    };

    await expect(gracefulServeShutdown({
      uiServer,
      closeRegistry: jest.fn().mockResolvedValue(undefined),
      closeSessionManager: jest.fn().mockResolvedValue(undefined),
    })).resolves.toBeUndefined();

    expect(mockTelemetryEmit).toHaveBeenCalledWith(expect.objectContaining({ name: 'serve.shutdown.failed' }));
  });

  it('rejects the removed stagehand engine from the CLI surface', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation(((code?: number) => {
        throw new Error(`process.exit:${code ?? 0}`);
      }) as never);

    await expect(
      program.parseAsync(['node', 'ai-vision', 'run', 'test prompt', '--engine', 'stagehand'])
    ).rejects.toThrow('process.exit:1');

    expect(errorSpy).toHaveBeenCalledWith(
      "Unknown engine 'stagehand'. Available: browser-use, skyvern"
    );

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});