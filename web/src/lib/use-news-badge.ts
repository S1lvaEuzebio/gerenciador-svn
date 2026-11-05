import { useEffect } from 'react';
import icon from '@/assets/icon.svg?raw';

const TITLE = 'Gerenciador SVN';

const toDataUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

/** Ícone do app com o número num círculo vermelho no canto. */
function badgeIcon(count: number): string {
  const text = count > 99 ? '99+' : String(count);
  const fontSize = [10, 8, 6][text.length - 1];
  const badge =
    `<circle cx="17" cy="7" r="7" fill="#dc2626" stroke="none"/>` +
    `<text x="17" y="7" fill="#fff" stroke="none" font-family="sans-serif" font-size="${fontSize}" ` +
    `font-weight="700" text-anchor="middle" dominant-baseline="central">${text}</text>`;
  return toDataUrl(icon.replace('</svg>', `${badge}</svg>`));
}

/**
 * Novidades do servidor no título da janela e no ícone (sem notificação do sistema). Na janela
 * do `google-chrome --app`, os dois aparecem também na barra de tarefas.
 */
export function useNewsBadge(count: number) {
  useEffect(() => {
    document.title = count > 0 ? `(${count}) ${TITLE}` : TITLE;
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (link) link.href = count > 0 ? badgeIcon(count) : toDataUrl(icon);
  }, [count]);
}
