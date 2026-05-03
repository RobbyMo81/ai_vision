import { SessionState, ScreenshotClass, ScreenshotPayload, ScreenshotRetention, ScreenshotSource } from './types';

export interface SensitiveScreenshotContext {
  stepId?: string;
  selectors?: string[];
  labels?: string[];
  blockedReason?: string;
  nextAction?: string;
}

export interface ScreenshotPolicyRequest {
  source: ScreenshotSource;
  accessPath: 'ui' | 'mcp' | 'workflow' | 'rolling';
  state?: SessionState | null;
  sensitiveContext?: SensitiveScreenshotContext | null;
  evidenceRequested?: boolean;
}

export interface ScreenshotPolicyDecision {
  allowed: boolean;
  class: ScreenshotClass;
  sensitivity: ScreenshotPayload['sensitivity'];
  retention: ScreenshotRetention;
  blockedReason?: string;
  nextAction?: string;
  expiresOnStepAdvance?: boolean;
  redactSelectors?: string[];
  redactionApplied?: boolean;
}

function blockedDecision(
  blockedReason: string,
  nextAction: string,
): ScreenshotPolicyDecision {
  return {
    allowed: false,
    class: 'sensitive_blocked',
    sensitivity: 'blocked',
    retention: 'ephemeral',
    blockedReason,
    nextAction,
  };
}

export function decideScreenshotPolicy(
  request: ScreenshotPolicyRequest,
): ScreenshotPolicyDecision {
  if (request.evidenceRequested || request.source === 'workflow_step') {
    return {
      allowed: true,
      class: 'evidence',
      sensitivity: 'unknown',
      retention: 'keep_until_manual_review',
    };
  }

  if (request.state?.phase === 'pii_wait') {
    return blockedDecision('pii_wait_active', 'retry_after_sensitive_phase');
  }

  const sensitiveContext = request.sensitiveContext;
  if (sensitiveContext) {
    if ((sensitiveContext.selectors ?? []).length > 0) {
      return {
        allowed: true,
        class: 'step_scoped',
        sensitivity: 'sensitive',
        retention: 'step_scoped',
        expiresOnStepAdvance: true,
        redactSelectors: [...(sensitiveContext.selectors ?? [])],
        redactionApplied: true,
      };
    }

    return blockedDecision(
      sensitiveContext.blockedReason ?? 'sensitive_target_active',
      sensitiveContext.nextAction ?? 'complete_sensitive_step_via_hitl',
    );
  }

  if (request.accessPath === 'rolling') {
    return {
      allowed: true,
      class: 'debug_frame',
      sensitivity: 'unknown',
      retention: 'delete_on_success',
    };
  }

  return {
    allowed: true,
    class: 'live_frame',
    sensitivity: 'unknown',
    retention: 'ephemeral',
  };
}