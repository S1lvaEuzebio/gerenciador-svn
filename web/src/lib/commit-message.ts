import { useState } from 'react';
import { readStored, writeStored } from './utils';

const HISTORY_KEY = 'commit-history';
const DRAFT_KEY = 'commit-draft';
const MAX_HISTORY = 20;

interface Draft {
  reference: string;
  text: string;
}

function readJson<T>(key: string, isValid: (value: unknown) => value is T, fallback: T): T {
  try {
    const value: unknown = JSON.parse(readStored(key) ?? 'null');
    return isValid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === 'string');

const isDraft = (value: unknown): value is Draft =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Draft).reference === 'string' &&
  typeof (value as Draft).text === 'string';

/** `tarefa #{n}` + `123` → `tarefa #123`. Sem `{n}` no modelo, o número vai no fim. */
export function formatReference(template: string, value: string): string {
  return template.includes('{n}') ? template.replaceAll('{n}', value) : `${template} ${value}`;
}

/** Mensagem final: referência na primeira linha e o texto embaixo; qualquer um pode faltar. */
export function buildMessage(template: string | null, reference: string, text: string): string {
  const ref =
    template && reference.trim() !== '' ? formatReference(template, reference.trim()) : '';
  return [ref, text.trim()].filter((part) => part !== '').join('\n');
}

/**
 * Rascunho da mensagem e histórico das últimas enviadas, guardados no navegador. A seleção de
 * arquivos não fica guardada: some ao recarregar.
 */
export function useCommitMessage(template: string | null) {
  const [draft, setDraftState] = useState<Draft>(() =>
    readJson(DRAFT_KEY, isDraft, { reference: '', text: '' }),
  );
  const [history, setHistory] = useState<string[]>(() => readJson(HISTORY_KEY, isStringArray, []));

  const setDraft = (next: Draft) => {
    setDraftState(next);
    writeStored(DRAFT_KEY, JSON.stringify(next));
  };

  /** Depois do commit: guarda a mensagem no histórico e limpa o rascunho. */
  const remember = (message: string) => {
    const next = [message, ...history.filter((m) => m !== message)].slice(0, MAX_HISTORY);
    setHistory(next);
    writeStored(HISTORY_KEY, JSON.stringify(next));
    setDraft({ reference: '', text: '' });
  };

  return {
    reference: draft.reference,
    text: draft.text,
    setReference: (reference: string) => setDraft({ ...draft, reference }),
    setText: (text: string) => setDraft({ ...draft, text }),
    /** Usa uma mensagem do histórico inteira no texto, sem referência separada. */
    reuse: (message: string) => setDraft({ reference: '', text: message }),
    message: buildMessage(template, draft.reference, draft.text),
    history,
    remember,
  };
}
