/**
 * Human-in-the-Loop (HITL) coordinator.
 *
 * When a workflow reaches a `human_takeover` step, the engine calls
 * `requestTakeover()`.  This returns a Promise that BLOCKS until the user
 * visits the HITL UI and clicks "Return Control to Claude".
 *
 * The UI server calls `returnControl()` for normal takeovers and
 * `confirmCompletion()` for final-step verification. Both unblock the workflow
 * while preserving the same browser session (auth state preserved).
 *
 * Events emitted (for the UI WebSocket server to forward):
 *   'takeover_requested'  — {reason, instructions}
 *   'control_returned'    — {}
 *   'phase_changed'       — {phase}
 */

import { EventEmitter } from 'events';
import { TaskPhase } from './types';
import { telemetry } from '../telemetry';

export class HitlCoordinator extends EventEmitter {
  private _phase: TaskPhase = 'idle';
  private _reason = '';
  private _instructions = '';
  private _resolve: (() => void) | null = null;
  private _confirmResolve: ((result: { confirmed: boolean; reason?: string }) => void) | null = null;
  private _inputResolve: ((value: string) => void) | null = null;
  private _waitStartedAt: number | null = null;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  get phase(): TaskPhase { return this._phase; }
  get reason(): string { return this._reason; }
  get instructions(): string { return this._instructions; }
  get isAwaiting(): boolean {
    return this._phase === 'awaiting_human' || this._phase === 'pii_wait' || this._phase === 'hitl_qa';
  }

  setPhase(phase: TaskPhase): void {
    this._phase = phase;
    this.emit('phase_changed', { phase });
    telemetry.emit({
      source: 'hitl',
      name: 'hitl.phase.changed',
      details: { phase },
    });
  }

  /**
   * Silently sync the internal phase to match the engine-published state.
   * Called by publishStateTransition in the workflow engine to keep both
   * state surfaces aligned without emitting a second phase_changed event.
   */
  syncPhase(phase: TaskPhase): void {
    this._phase = phase;
  }

  // ---------------------------------------------------------------------------
  // HITL protocol
  // ---------------------------------------------------------------------------

  /**
   * Called by the workflow engine when a human_takeover step is reached.
   * Blocks until `returnControl()` is called from the UI server.
   *
   * @param reason        Short message shown in the UI ("Please log in to your account")
   * @param instructions  Optional longer guidance shown below the reason
   */
  async requestTakeover(reason: string, instructions?: string): Promise<void> {
    this._phase = 'awaiting_human';
    this._reason = reason;
    this._instructions = instructions ?? '';
    this._waitStartedAt = Date.now();
    this.emit('takeover_requested', { reason, instructions });
    telemetry.emit({
      source: 'hitl',
      name: 'hitl.wait.started',
      details: { reason, instructions: instructions ?? '' },
    });

    return new Promise<void>((resolve) => {
      this._resolve = resolve;
    });
  }

  async requestSensitiveValue(label: string, instructions?: string): Promise<string> {
    this._phase = 'pii_wait';
    this._reason = label;
    this._instructions = instructions ?? '';
    this._waitStartedAt = Date.now();
    this.emit('takeover_requested', { reason: label, instructions });
    telemetry.emit({
      source: 'hitl',
      name: 'hitl.secure_input.started',
      details: { label, instructions: instructions ?? '' },
    });

    return new Promise<string>((resolve) => {
      this._inputResolve = resolve;
    });
  }

  async requestCompletionConfirmation(
    reason: string,
    instructions?: string,
  ): Promise<{ confirmed: boolean; reason?: string }> {
    this._phase = 'hitl_qa';
    this._reason = reason;
    this._instructions = instructions ?? '';
    this._waitStartedAt = Date.now();
    this.emit('takeover_requested', { reason, instructions });
    telemetry.emit({
      source: 'hitl',
      name: 'hitl.confirmation.started',
      details: { reason, instructions: instructions ?? '' },
    });

    return new Promise<{ confirmed: boolean; reason?: string }>((resolve) => {
      this._confirmResolve = resolve;
    });
  }

  async requestQaPause(reason: string, instructions?: string): Promise<void> {
    this._phase = 'hitl_qa';
    this._reason = reason;
    this._instructions = instructions ?? '';
    this._waitStartedAt = Date.now();
    this.emit('takeover_requested', { reason, instructions });
    telemetry.emit({
      source: 'hitl',
      name: 'hitl.qa_pause.started',
      details: { reason, instructions: instructions ?? '' },
    });

    return new Promise<void>((resolve) => {
      this._resolve = resolve;
    });
  }

  /**
   * Called by the UI server when the user clicks "Return Control to Claude".
   * Resolves the blocking promise in requestTakeover().
   */
  returnControl(): void {
    if (!this._resolve) return; // nothing waiting
    const resolve = this._resolve;
    this._resolve = null;
    const durationMs = this._waitStartedAt ? Date.now() - this._waitStartedAt : undefined;
    this._waitStartedAt = null;
    this._phase = 'running';
    this._reason = '';
    this._instructions = '';
    this.emit('control_returned', {});
    telemetry.emit({
      source: 'hitl',
      name: 'hitl.wait.completed',
      durationMs,
      details: {},
    });
    resolve();
  }

  confirmCompletion(confirmed: boolean, reason?: string): void {
    if (!this._confirmResolve) return;
    const resolve = this._confirmResolve;
    this._confirmResolve = null;
    const durationMs = this._waitStartedAt ? Date.now() - this._waitStartedAt : undefined;
    this._waitStartedAt = null;
    this._phase = 'running';
    this._reason = '';
    this._instructions = '';
    this.emit('control_returned', {});
    telemetry.emit({
      source: 'hitl',
      name: 'hitl.confirmation.completed',
      level: confirmed ? 'info' : 'warn',
      durationMs,
      details: { confirmed, reason: reason ?? '' },
    });
    resolve({ confirmed, reason });
  }

  submitSensitiveValue(value: string): void {
    if (!this._inputResolve) return;
    const resolve = this._inputResolve;
    this._inputResolve = null;
    const durationMs = this._waitStartedAt ? Date.now() - this._waitStartedAt : undefined;
    this._waitStartedAt = null;
    this._phase = 'running';
    this._reason = '';
    this._instructions = '';
    this.emit('control_returned', {});
    telemetry.emit({
      source: 'hitl',
      name: 'hitl.secure_input.completed',
      durationMs,
      details: {
        supplied: Boolean(value),
      },
    });
    resolve(value);
  }

  /** Stop any pending takeover (e.g. on workflow error or cancellation). */
  cancel(): void {
    if (this._resolve) {
      const resolve = this._resolve;
      this._resolve = null;
      this._phase = 'error';
      this._waitStartedAt = null;
      telemetry.emit({
        source: 'hitl',
        name: 'hitl.wait.cancelled',
        level: 'warn',
        details: {},
      });
      resolve(); // unblock, workflow will handle error state
    }
    if (this._inputResolve) {
      const resolve = this._inputResolve;
      this._inputResolve = null;
      this._phase = 'error';
      this._waitStartedAt = null;
      telemetry.emit({
        source: 'hitl',
        name: 'hitl.secure_input.cancelled',
        level: 'warn',
        details: {},
      });
      resolve('');
    }
    if (this._confirmResolve) {
      const resolve = this._confirmResolve;
      this._confirmResolve = null;
      this._phase = 'error';
      this._waitStartedAt = null;
      telemetry.emit({
        source: 'hitl',
        name: 'hitl.confirmation.cancelled',
        level: 'warn',
        details: {},
      });
      resolve({ confirmed: false, reason: 'HITL confirmation was cancelled.' });
    }
  }
}

/** Singleton used across the serve process. */
export const hitlCoordinator = new HitlCoordinator();
