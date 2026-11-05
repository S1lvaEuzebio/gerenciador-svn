#!/usr/bin/env bash
# Instala o gerenciador como serviço systemd do usuário (sobe sozinho ao entrar na sessão) e
# cria o atalho no menu de aplicativos.
#
#   scripts/install-desktop.sh           instala ou atualiza
#   scripts/install-desktop.sh --print   só mostra os arquivos que seriam instalados
#   scripts/install-desktop.sh --remove  desinstala
#
# GERENCIADOR_SVN_CONFIG e GERENCIADOR_SVN_PORT definidas na instalação vão para o serviço e o
# atalho. Rode de novo depois de trocar a versão do Node ou mudar o projeto de pasta.
set -euo pipefail

APP=gerenciador-svn
ROOT="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}"
UNIT="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$APP.service"
DESKTOP="$DATA_DIR/applications/$APP.desktop"
ICON="$DATA_DIR/icons/hicolor/scalable/apps/$APP.svg"

fail() {
  echo "$1" >&2
  exit 1
}

refresh_menu() {
  if command -v update-desktop-database > /dev/null; then
    update-desktop-database "$DATA_DIR/applications" || true
  fi
}

MODE="${1:-install}"
case "$MODE" in
  install | --print | --remove) ;;
  *) fail "uso: $0 [--print | --remove]" ;;
esac

if [[ "$MODE" == "--remove" ]]; then
  systemctl --user disable --now "$APP.service" 2> /dev/null || true
  rm -f "$UNIT" "$DESKTOP" "$ICON"
  systemctl --user daemon-reload
  refresh_menu
  echo "serviço e atalho removidos"
  exit 0
fi

# Caminho real: gerenciadores de versão (fnm, nvm) põem no PATH links que mudam a cada terminal.
NODE="$(readlink -f "$(command -v node)")" || fail "node não encontrado no PATH"
NODE_MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
((NODE_MAJOR >= 24)) || fail "precisa do Node 24 ou mais novo (encontrado: $("$NODE" -v))"
SVN="$(readlink -f "$(command -v svn)")" || fail "svn não encontrado no PATH"

ENV_VARS=()
for name in GERENCIADOR_SVN_CONFIG GERENCIADOR_SVN_PORT; do
  if [[ -n "${!name:-}" ]]; then ENV_VARS+=("$name=${!name}"); fi
done

# Na unit, `%` é especificador do systemd e as aspas protegem espaços.
unit_quote() {
  local value="${1//%/%%}"
  printf '"%s"' "${value//\"/\\\"}"
}

unit_file() {
  echo "[Unit]"
  echo "Description=Gerenciador SVN (interface local para working copies SVN)"
  echo
  echo "[Service]"
  echo "Type=simple"
  echo "WorkingDirectory=${ROOT//%/%%}"
  echo "ExecStart=$(unit_quote "$NODE") $(unit_quote "$ROOT/server/index.ts")"
  echo "Environment=$(unit_quote "PATH=$(dirname "$SVN"):/usr/local/bin:/usr/bin:/bin")"
  for var in "${ENV_VARS[@]}"; do echo "Environment=$(unit_quote "$var")"; done
  echo "Restart=on-failure"
  echo "RestartSec=5"
  echo
  echo "[Install]"
  echo "WantedBy=default.target"
}

# No Exec do atalho, `%` é código de campo; aspas, `$`, crase e barra invertida pediriam escape
# duplo, então ficam de fora.
desktop_quote() {
  [[ "$1" != *[\"\$\`\\]* ]] || fail "caractere especial não suportado no atalho: $1"
  printf '"%s"' "${1//%/%%}"
}

desktop_file() {
  local exec="env"
  for var in "${ENV_VARS[@]}"; do exec+=" $(desktop_quote "$var")"; done
  exec+=" $(desktop_quote "$ROOT/scripts/open.sh")"
  cat << EOF
[Desktop Entry]
Type=Application
Name=Gerenciador SVN
Comment=Mudanças, update, commit e histórico de várias working copies SVN
Exec=$exec
Icon=$APP
Terminal=false
Categories=Development;RevisionControl;
EOF
}

if [[ "$MODE" == "--print" ]]; then
  echo "# $UNIT"
  unit_file
  echo
  echo "# $DESKTOP"
  desktop_file
  exit 0
fi

[[ -f "$ROOT/dist/web/index.html" ]] || fail "rode pnpm build antes de instalar"
mkdir -p "$(dirname "$UNIT")" "$(dirname "$DESKTOP")" "$(dirname "$ICON")"
unit_file > "$UNIT"
desktop_file > "$DESKTOP"
cp "$ROOT/web/src/assets/icon.svg" "$ICON"
systemctl --user daemon-reload
systemctl --user enable "$APP.service"
systemctl --user restart "$APP.service"
refresh_menu
echo "instalado: serviço $APP (systemctl --user status $APP) e atalho Gerenciador SVN no menu"
