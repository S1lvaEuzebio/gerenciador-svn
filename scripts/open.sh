#!/usr/bin/env bash
# Abre o gerenciador numa janela própria do Chrome, subindo o serviço se ele não estiver no ar.
# Usado pelo atalho do menu; não depende do Node no PATH.
set -euo pipefail

CONFIG="${GERENCIADOR_SVN_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/gerenciador-svn/config.json}"
PORT="${GERENCIADOR_SVN_PORT:-}"
if [[ -z "$PORT" && -f "$CONFIG" ]]; then
  PORT="$(grep -o '"port": *[0-9]*' "$CONFIG" | grep -o '[0-9]*$' || true)"
fi
# Mesma porta padrão do servidor (DEFAULT_PORT em shared/schema.ts).
PORT="${PORT:-4517}"
URL="http://127.0.0.1:$PORT"

systemctl --user start gerenciador-svn.service
# Espera o servidor aceitar conexão (até ~10 s) para a janela não abrir numa página de erro.
for _ in $(seq 50); do
  if (exec 3<> "/dev/tcp/127.0.0.1/$PORT") 2> /dev/null; then break; fi
  sleep 0.2
done

if command -v google-chrome > /dev/null; then
  exec google-chrome --app="$URL"
fi
exec xdg-open "$URL"
