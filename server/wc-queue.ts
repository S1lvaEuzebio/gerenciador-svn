const tails = new Map<string, Promise<unknown>>();

/**
 * Roda operações de gravação uma de cada vez por working copy; working copies diferentes
 * rodam em paralelo. Uma falha não trava a fila: a próxima tarefa roda do mesmo jeito.
 */
export function enqueue<T>(projectId: string, task: () => Promise<T>): Promise<T> {
  const previous = tails.get(projectId) ?? Promise.resolve();
  const run = previous.then(task);
  const tail = run.catch(() => undefined);
  tails.set(projectId, tail);
  void tail.then(() => {
    if (tails.get(projectId) === tail) tails.delete(projectId);
  });
  return run;
}
