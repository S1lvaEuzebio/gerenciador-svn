# gerenciador-svn

Interface web local para trabalhar com várias working copies SVN ao mesmo tempo: ver o que mudou na sua máquina e no servidor, comparar arquivos, atualizar, resolver conflitos e comitar arquivos de vários projetos numa única revision.

Feito para quem mantém projetos antigos em SVN e quer uma ferramenta leve (um processo Node e uma aba do navegador), sem depender de IDE.

> Em desenvolvimento. O que já funciona está em [Estado atual](#estado-atual).

## Estado atual

- Descobre as working copies SVN dentro de uma ou mais pastas raiz (só as subpastas diretas; o resto, como projetos git, fica de fora).
- Mostra as mudanças locais de cada projeto, com contadores na barra lateral, e atualiza sozinho quando a janela ganha foco.
- Mostra o que vai chegar do servidor (aba **Servidor**), consultado ao abrir e pelo botão Recarregar, com aviso quando o arquivo também tem mudança local ou casa com um padrão de ignorados.
- Três diffs, lado a lado ou unificado: "minhas mudanças" (cópia local × base), "o que vai chegar" (base × servidor) e cópia local × servidor. Opção de ignorar espaços, aviso de troca de fim de linha, diff de propriedades e proteção para arquivos grandes e binários.
- Update por projeto, grupo ou tudo, com prévia (revisões, arquivos, avisos e o comando exato) antes de confirmar. Vai sempre até a revisão mostrada na prévia, deixa os conflitos para resolver na tela (`--accept postpone`) e mostra a saída do svn em tempo real. Cada working copy roda numa fila própria, em paralelo com as outras.
- Resolução de conflitos:
  - texto: manter a sua versão ou a do servidor nos trechos em conflito, escolher o arquivo inteiro de um lado, ou mesclar trecho a trecho (minha, do servidor, as duas ou texto editado), preservando o fim de linha do arquivo;
  - binário: escolher a versão inteira de um lado;
  - propriedade: ficar com o seu valor ou o do servidor;
  - árvore: o app mostra o que aconteceu e os comandos para resolver no terminal.
- Grupos de projetos (um projeto pode estar em vários) para filtrar a tela.
- Padrões de arquivos ignorados, globais ou por projeto. Ignorados aparecem recolhidos e nunca vão entrar em commit.
- Modo somente leitura, ligado por padrão, com chaves separadas para operações locais e para commit. Com a chave ligada, o servidor recusa a operação.
- Toda operação que grava mostra antes o comando svn exato e pede confirmação.
- Console com todos os comandos svn que o app executou.

Ainda não há commit, revert nem cleanup. Eles vêm nas próximas etapas.

## Requisitos

- Node.js 24 ou mais novo
- pnpm 10
- Cliente `svn` 1.8 ou mais novo no `PATH`, com as credenciais já guardadas em cache. O app roda o svn com `--non-interactive` e nunca pede nem guarda senha. Se a credencial expirar, rode qualquer comando svn no terminal (por exemplo `svn info <url>`) para autenticar de novo.

## Uso

```bash
pnpm install
pnpm build
pnpm start
```

Abra `http://127.0.0.1:4517`. Para uma janela sem barra de endereço:

```bash
google-chrome --app=http://127.0.0.1:4517
```

Na primeira execução, configure as pastas raiz em **Configurações → Pastas raiz**.

## Desenvolvimento

```bash
pnpm dev
```

Sobe o servidor com recarga automática e o Vite em `http://127.0.0.1:5173`, que repassa as chamadas `/api` para o servidor.

Outros comandos: `pnpm typecheck`, `pnpm lint`, `pnpm format`.

O servidor é TypeScript executado direto pelo Node (remoção de tipos nativa), sem etapa de build. Por isso o código do servidor usa só sintaxe que pode ser apagada: nada de `enum`, `namespace` ou parameter properties.

## Configuração

Fica em `~/.config/gerenciador-svn/config.json` (ou `$XDG_CONFIG_HOME/gerenciador-svn/config.json`) e é criada com os valores padrão na primeira execução. Dá para editar pela tela ou à mão:

```json
{
  "port": 4517,
  "roots": ["~/projetos/meu-workspace"],
  "groups": [
    { "id": "1", "name": "vendas", "projects": ["/home/eu/projetos/meu-workspace/vendas-web"] }
  ],
  "ignore": {
    "global": [".classpath", ".project", ".settings/"],
    "projects": {}
  },
  "readOnly": { "local": true, "commit": true }
}
```

Variáveis de ambiente:

| Variável                 | Para quê                                    |
| ------------------------ | ------------------------------------------- |
| `GERENCIADOR_SVN_CONFIG` | caminho de outro arquivo de configuração    |
| `GERENCIADOR_SVN_PORT`   | porta, no lugar da definida na configuração |

### Padrões de ignorados

Um padrão por linha, no estilo do `.gitignore`:

- sem `/` (ex.: `.classpath`): casa em qualquer pasta do projeto;
- com `/` (ex.: `build/classes/`): parte da raiz do projeto;
- casar uma pasta inclui tudo que está dentro dela.

Servem também para arquivos versionados, que o `svn:ignore` não cobre.

## Segurança

- O servidor escuta só em `127.0.0.1`.
- Recusa requisições com cabeçalho `Host` ou `Origin` diferentes do próprio app (proteção contra DNS rebinding e contra outros sites abertos no navegador) e não libera CORS.
- O svn é sempre chamado com os argumentos em lista, sem shell, e só dentro das working copies descobertas.

## Próximas etapas

1. Commit de arquivos de vários projetos numa única revision.
2. Histórico por projeto, grupo e arquivo.
3. Revert, cleanup, consulta periódica ao servidor e inicialização pelo systemd.

## Licença

[MIT](LICENSE)
