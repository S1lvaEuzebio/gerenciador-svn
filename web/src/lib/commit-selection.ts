import type { LocalChange, Project, ProjectStatus } from '@shared/types.ts';
import { useState } from 'react';
import { commitKey, isCommittable } from './status';

export interface CheckedItem {
  key: string;
  project: Project;
  change: LocalChange;
}

/** Chaves dos itens que ainda estão na lista e podem entrar no commit. */
function committableKeys(projects: Project[], statuses: Map<string, ProjectStatus>): Set<string> {
  return new Set(
    projects.flatMap((project) =>
      (statuses.get(project.id)?.changes ?? [])
        .filter(isCommittable)
        .map((change) => commitKey(project.id, change.path)),
    ),
  );
}

/**
 * Seleção global do commit, só em memória (some ao recarregar). Quando o status muda, o que saiu
 * da lista ou deixou de poder entrar (virou conflito, passou a ser ignorado) é desmarcado, para
 * não voltar marcado sozinho se reaparecer depois.
 */
export function useCommitSelection(projects: Project[], statuses: Map<string, ProjectStatus>) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [seen, setSeen] = useState(statuses);
  if (seen !== statuses) {
    setSeen(statuses);
    const valid = committableKeys(projects, statuses);
    setChecked((current) => new Set([...current].filter((key) => valid.has(key))));
  }

  const setMany = (keys: string[], value: boolean) =>
    setChecked((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (value) next.add(key);
        else next.delete(key);
      }
      return next;
    });

  const items: CheckedItem[] = projects.flatMap((project) =>
    (statuses.get(project.id)?.changes ?? [])
      .filter((change) => isCommittable(change) && checked.has(commitKey(project.id, change.path)))
      .map((change) => ({ key: commitKey(project.id, change.path), project, change })),
  );

  return { checked, items, setMany, clear: () => setChecked(new Set()) };
}
