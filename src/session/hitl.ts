/**
 * Human-in-the-Loop (HITL) coordinator.
 *
 * When a workflow reaches a `human_takeover` step, the engine calls
 * `requestTakeover()`.  This returns a Promise that BLOCKS until the user
 * visits the HITL UI and clicks "Return Control to Claude".
 *
 * The UI server calls `returnControl()` when the button is pressed, which
 * resolves the blocking promise and allows the workflow to continue with the
 * same browser session (auth state preserved).
 *
 * Events emitted (for the UI WebSocket server to forward):
 *   'takeover_requested'  — {reason, instructions}
 *   'control_returned'    — {}
 *   'phase_changed'       — {phase}
 */

import { EventEmitter } from 'events';
import { TaskPhase } from './types';

export class HitlCoordinator extends EventEmitter {
  private _phase: TaskPhase = 'idle';
  private _reason = '';
  private _instructions = '';
  private _resolve: (() => void) | null = null;
  private _screenshotInterval: ReturnType<typeof setInterval> | null = null;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  get phase(): TaskPhase { return this._phase; }
  get reason(): string { return this._reason; }
  get instructions(): string { return this._instructions; }
  get isAwaiting(): boolean { return this._phase === 'awaiting_human'; }

  setPhase(phase: TaskPhase): void {
    this._phase = phase;
    this.emit('phase_changed', { phase });
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
    this.emit('takeover_requested', { reason, instructions });

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
    this._phase = 'running';
    this._reason = '';
    this._instructions = '';
    this.emit('control_returned', {});
    resolve();
  }

  /** Stop any pending takeover (e.g. on workflow error or cancellation). */
  cancel(): void {
    if (this._resolve) {
      const resolve = this._resolve;
      this._resolve = null;
      this._phase = 'error';
      resolve(); // unblock, workflow will handle error state
    }
  }
}

/** Singleton used across the serve process. */
export const hitlCoordinator = new HitlCoordinator();
