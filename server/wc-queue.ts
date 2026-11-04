const tails = new Map<string, Promise<unknown>>();

/**
 * Roda operações de gravação uma de cada vez por working copy; working copies diferentes
 * rodam em paralelo. Uma tarefa que mexe em várias working copies (commit) espera a fila de
 * todas e segura todas até terminar. Uma falha não trava a fila: a próxima roda do mesmo jeito.
 */
export function enqueue<T>(projectIds: string | string[], task: () => Promise<T>): Promise<T> {
  const ids = [...new Set(typeof projectIds === 'string' ? [projectIds] : projectIds)];
  const previous = Promise.all(ids.map((id) => tails.get(id)));
  const run = previous.then(task);
  const tail = run.catch(() => undefined);
  for (const id of ids) tails.set(id, tail);
  void tail.then(() => {
    for (const id of ids) if (tails.get(id) === tail) tails.delete(id);
  });
  return run;
}
