import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
});

// O padrão do TanStack Query só reage a `visibilitychange`. Com o app numa janela própria ao lado
// do editor, a janela continua visível ao trocar de foco; por isso também ouvimos `focus`/`blur`.
focusManager.setEventListener((setFocused) => {
  const onFocus = () => setFocused(true);
  const onBlur = () => setFocused(false);
  const onVisibility = () => setFocused(document.visibilityState === 'visible');
  window.addEventListener('focus', onFocus);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVisibility);
  };
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
