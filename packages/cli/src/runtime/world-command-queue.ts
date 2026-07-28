export class WorldCommandQueue {
  private queue: Promise<void> = Promise.resolve();

  async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.queue;
    let resolve: (value: T) => void;
    let reject: (err: unknown) => void;
    const next = new Promise<T>((res, rej) => { resolve = res; reject = rej; });

    this.queue = (async () => {
      await prev;
      try {
        resolve!(await fn());
      } catch (err) {
        reject!(err);
      }
    })();

    return next;
  }
}
