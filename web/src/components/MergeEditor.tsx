import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { MergeView, unifiedMergeView } from '@codemirror/merge';
import { EditorState, type Extension } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, highlightSpecialChars, lineNumbers } from '@codemirror/view';
import { useEffect, useRef } from 'react';
import { useDarkMode } from '@/lib/use-dark-mode';
import { whitespaceInsensitiveDiff } from '@/lib/whitespace-diff';

export type DiffMode = 'split' | 'unified';

function languageFor(path: string): Extension {
  const name = path.toLowerCase();
  const ext = name.slice(name.lastIndexOf('.') + 1);
  switch (ext) {
    case 'java':
      return java();
    case 'js':
    case 'mjs':
    case 'cjs':
    case 'jsx':
      return javascript({ jsx: ext === 'jsx' });
    case 'ts':
    case 'tsx':
      return javascript({ typescript: true, jsx: ext === 'tsx' });
    case 'json':
      return json();
    case 'xml':
    case 'xsd':
    case 'wsdl':
    case 'xhtml':
    case 'classpath':
    case 'project':
      return xml();
    case 'html':
    case 'htm':
    case 'jsp':
      return html();
    case 'css':
    case 'scss':
      return css();
    default:
      return [];
  }
}

const COLLAPSE = { margin: 3, minSize: 6 };

const PHRASES = EditorState.phrases.of({ '$ unchanged lines': '$ linhas sem mudança' });

interface MergeEditorProps {
  original: string;
  modified: string;
  path: string;
  mode: DiffMode;
  ignoreWhitespace: boolean;
}

/** Visualizador de diff somente leitura (CodeMirror), lado a lado ou unificado. */
export function MergeEditor({
  original,
  modified,
  path,
  mode,
  ignoreWhitespace,
}: MergeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const dark = useDarkMode();

  useEffect(() => {
    const parent = hostRef.current;
    if (!parent) return;

    const extensions: Extension[] = [
      lineNumbers(),
      highlightSpecialChars(),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      PHRASES,
      dark ? oneDark : syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      languageFor(path),
    ];
    const diffConfig = ignoreWhitespace ? { override: whitespaceInsensitiveDiff } : undefined;

    if (mode === 'split') {
      const view = new MergeView({
        a: { doc: original, extensions },
        b: { doc: modified, extensions },
        parent,
        collapseUnchanged: COLLAPSE,
        diffConfig,
      });
      return () => view.destroy();
    }

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: modified,
        extensions: [
          ...extensions,
          unifiedMergeView({
            original,
            mergeControls: false,
            collapseUnchanged: COLLAPSE,
            diffConfig,
          }),
        ],
      }),
    });
    return () => view.destroy();
  }, [original, modified, path, mode, ignoreWhitespace, dark]);

  return <div ref={hostRef} className="diff-host h-full min-h-0" />;
}
