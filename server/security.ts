import type { RequestHandler } from 'express';
import type { ReadOnlyConfig } from '../shared/schema.ts';
import { getConfig } from './config.ts';

const VITE_DEV_PORT = 5173;

function allowedHosts(port: number, dev: boolean): Set<string> {
  const ports = dev ? [port, VITE_DEV_PORT] : [port];
  return new Set(ports.flatMap((p) => [`127.0.0.1:${p}`, `localhost:${p}`]));
}

/**
 * Barra DNS rebinding (Host) e requisições vindas de outros sites (Origin).
 * Requisições com corpo precisam ser JSON, o que força preflight de CORS em
 * qualquer site de fora, e o servidor nunca responde a preflight.
 */
export function localOnly(port: number, dev: boolean): RequestHandler {
  const hosts = allowedHosts(port, dev);
  const origins = new Set([...hosts].map((h) => `http://${h}`));

  return (req, res, next) => {
    if (!hosts.has(req.headers.host ?? '')) {
      res.status(403).json({ error: 'host não permitido' });
      return;
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !origins.has(origin)) {
      res.status(403).json({ error: 'origem não permitida' });
      return;
    }
    const hasBody = !['GET', 'HEAD', 'DELETE'].includes(req.method);
    if (hasBody && !req.is('application/json')) {
      res.status(415).json({ error: 'corpo precisa ser application/json' });
      return;
    }
    next();
  };
}

/** Recusa a rota enquanto a operação estiver travada pelo modo somente leitura. */
export function requireUnlocked(kind: keyof ReadOnlyConfig): RequestHandler {
  return (_req, res, next) => {
    if (getConfig().readOnly[kind]) {
      const label = kind === 'local' ? 'operações locais' : 'commit';
      res.status(423).json({ error: `modo somente leitura: ${label} travado` });
      return;
    }
    next();
  };
}
