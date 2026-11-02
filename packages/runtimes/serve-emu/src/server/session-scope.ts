export class StaleSessionError extends Error {
  constructor() {
    super("session changed during replay");
    this.name = "StaleSessionError";
  }
}

export function sessionScoped<TArgs extends unknown[], TResult>(
  generation: number,
  currentGeneration: () => number,
  action: (...args: TArgs) => TResult,
): (...args: TArgs) => TResult {
  return (...args) => {
    if (currentGeneration() !== generation) throw new StaleSessionError();
    return action(...args);
  };
}

export async function sessionScopedResult<TResult>(
  generation: number,
  currentGeneration: () => number,
  action: () => TResult | Promise<TResult>,
): Promise<TResult> {
  if (currentGeneration() !== generation) throw new StaleSessionError();
  const result = await action();
  if (currentGeneration() !== generation) throw new StaleSessionError();
  return result;
}

export async function sessionScopedCommit<TResult, TCommitted>(
  generation: number,
  currentGeneration: () => number,
  action: () => TResult | Promise<TResult>,
  commit: (result: TResult) => TCommitted,
): Promise<TCommitted> {
  if (currentGeneration() !== generation) throw new StaleSessionError();
  const result = await action();
  if (currentGeneration() !== generation) throw new StaleSessionError();
  // The commit is deliberately synchronous with the post-await generation
  // check, leaving no microtask gap in which a device switch can intervene.
  return commit(result);
}
