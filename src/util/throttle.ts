/** Returns a function that runs tasks one at a time with at least `gapMs` between starts. */
export function makeThrottle(gapMs: number) {
  let queue: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn);
    queue = run.catch(() => undefined).then(() => new Promise((r) => setTimeout(r, gapMs)));
    return run;
  };
}
