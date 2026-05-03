export type ScreenshotRequestPriority =
  | 'workflow_evidence'
  | 'mcp'
  | 'ui_on_demand'
  | 'ui_live'
  | 'rolling_debug';

export interface ScreenshotSchedulerTaskInput<T> {
  priority: ScreenshotRequestPriority;
  collapseKey?: string;
  run: () => Promise<T>;
  onQueued?: (queueDepth: number) => void;
  onCollapsed?: (queueDepth: number) => void;
  onExecuted?: (queueDepth: number) => void;
}

interface QueuedScreenshotTask<T> {
  priority: ScreenshotRequestPriority;
  collapseKey?: string;
  run: () => Promise<T>;
  onQueued?: (queueDepth: number) => void;
  onCollapsed?: (queueDepth: number) => void;
  onExecuted?: (queueDepth: number) => void;
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

const PRIORITY_ORDER: Record<ScreenshotRequestPriority, number> = {
  workflow_evidence: 0,
  mcp: 1,
  ui_on_demand: 2,
  ui_live: 3,
  rolling_debug: 4,
};

export class ScreenshotScheduler {
  private activeTask: QueuedScreenshotTask<unknown> | null = null;
  private readonly queue: QueuedScreenshotTask<unknown>[] = [];

  schedule<T>(input: ScreenshotSchedulerTaskInput<T>): Promise<T> {
    const matchingTask = this.findMatchingTask<T>(input.collapseKey);
    if (matchingTask) {
      input.onCollapsed?.(this.queue.length + (this.activeTask ? 1 : 0));
      return matchingTask.promise;
    }

    let resolveTask!: (value: T | PromiseLike<T>) => void;
    let rejectTask!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolve, reject) => {
      resolveTask = resolve;
      rejectTask = reject;
    });

    const task: QueuedScreenshotTask<T> = {
      ...input,
      promise,
      resolve: resolveTask,
      reject: rejectTask,
    };

    const insertAt = this.queue.findIndex(existing => this.comparePriority(task.priority, existing.priority) < 0);
    if (insertAt === -1) {
      this.queue.push(task as QueuedScreenshotTask<unknown>);
    } else {
      this.queue.splice(insertAt, 0, task as QueuedScreenshotTask<unknown>);
    }

    input.onQueued?.(this.queue.length + (this.activeTask ? 1 : 0));
    void this.drain();
    return promise;
  }

  private findMatchingTask<T>(collapseKey?: string): QueuedScreenshotTask<T> | null {
    if (!collapseKey) return null;
    if (this.activeTask?.collapseKey === collapseKey) {
      return this.activeTask as QueuedScreenshotTask<T>;
    }
    const queued = this.queue.find(task => task.collapseKey === collapseKey);
    return (queued as QueuedScreenshotTask<T> | undefined) ?? null;
  }

  private comparePriority(left: ScreenshotRequestPriority, right: ScreenshotRequestPriority): number {
    return PRIORITY_ORDER[left] - PRIORITY_ORDER[right];
  }

  private async drain(): Promise<void> {
    if (this.activeTask || this.queue.length === 0) return;

    const task = this.queue.shift()!;
    this.activeTask = task;
    task.onExecuted?.(this.queue.length + 1);

    try {
      const result = await task.run();
      task.resolve(result);
    } catch (error) {
      task.reject(error);
    } finally {
      this.activeTask = null;
      if (this.queue.length > 0) {
        void this.drain();
      }
    }
  }
}