import { ShortTermMemoryManager } from './short-term';

describe('ShortTermMemoryManager', () => {
  const previousSecret = process.env.AI_VISION_CRYPTO_SECRET;

  beforeAll(() => {
    process.env.AI_VISION_CRYPTO_SECRET = 'short-term-test-secret';
  });

  afterAll(() => {
    process.env.AI_VISION_CRYPTO_SECRET = previousSecret;
  });

  it('keeps scratch pad context while excluding plaintext pre-flight values', () => {
    const manager = new ShortTermMemoryManager();
    manager.begin('session-1', 'workflow-1');
    manager.setScratchPlan('Inspect the portal first, then proceed.');
    manager.addInvestigationNote('Portal uses a multi-step modal flow.');
    manager.storePreFlightValue({
      fieldId: 'applicant_dob',
      label: 'Date of Birth',
      kind: 'dob',
      sensitivity: 'spi',
      value: '1990-01-01',
    });
    manager.recordStep({
      stepId: 'contact',
      completedAt: new Date().toISOString(),
      summary: 'Contact step complete',
      completedFields: [
        {
          label: 'Date of Birth',
          value: '[REDACTED]',
          section: 'contact',
          confirmedAt: new Date().toISOString(),
        },
      ],
      currentUrl: 'https://example.com/form',
      screenshotPaths: [],
      agentStepsUsed: 1,
      notes: ['Do not revisit the contact form.'],
    });

    const prompt = manager.getContextPrompt();
    expect(manager.getPreFlightValue('applicant_dob')).toBe('1990-01-01');
    expect(prompt).toContain('PRE-FLIGHT PLAN');
    expect(prompt).toContain('Portal uses a multi-step modal flow.');
    expect(prompt).toContain('[REDACTED]');
    expect(prompt).not.toContain('1990-01-01');
  });
});
