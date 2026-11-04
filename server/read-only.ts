import type { RequestHandler } from 'express';
import { LOCK_LABELS } from '../shared/labels.ts';
import type { ReadOnlyConfig } from '../shared/schema.ts';
import { getConfig } from './config.ts';

/**
 * Recusa a rota enquanto a operação estiver travada pelo modo somente leitura.
 * Toda rota que grava (update, resolve, revert, cleanup, commit) passa por aqui.
 */
export function requireUnlocked(kind: keyof ReadOnlyConfig): RequestHandler {
  return (_req, res, next) => {
    if (getConfig().readOnly[kind]) {
      res.status(423).json({ error: `modo somente leitura: ${LOCK_LABELS[kind]} travado` });
      return;
    }
    next();
  };
}
