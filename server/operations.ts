import { createHash } from 'node:crypto';
import type { Operation, OperationStep } from '../shared/types.ts';
import { HttpError } from './http-error.ts';
import { runSvnRaw, svnCommandLine } from './svn/run.ts';
import { enqueue } from './wc-queue.ts';

const MAX_OPERATIONS = 20;
const MAX_STEP_OUTPUT = 200_000;

let nextId = 1;
const operations = new Map<number, Operation>();

export interface StepSpec {
  /** Nome mostrado na tela (projeto, ou o que a etapa faz). */
  label: string;
  /** Working copies em que a etapa grava; a etapa espera a fila de todas. */
  projectIds: string[];
  args: string[];
}

function append(step: OperationStep, text: string): void {
  if (step.output.length < MAX_STEP_OUTPUT) step.output += text;
}

/** Roda uma etapa e devolve se deu certo; a saída do svn vai para a etapa ao vivo. */
async function runStep(step: OperationStep, args: string[]): Promise<boolean> {
  step.state = 'running';
  try {
    await runSvnRaw(args, (text) => append(step, text));
    step.state = 'done';
    return true;
  } catch (error) {
    // O stderr já entrou na saída; só falha de execução (svn ausente) precisa da mensagem.
    if (step.output === '') append(step, (error as Error).message);
    step.state = 'failed';
    return false;
  }
}

/**
 * Começa uma operação e devolve logo, sem esperar o svn; a tela acompanha por `getOperation`.
 * `parallel`: cada etapa entra na fila das suas working copies (update de vários projetos).
 * `sequence`: as etapas rodam em ordem, segurando a fila de todas as working copies, e param
 * na primeira falha (add → delete → commit).
 */
export function startOperation(
  title: string,
  specs: StepSpec[],
  mode: 'parallel' | 'sequence',
): Operation {
  const operation: Operation = {
    id: nextId++,
    title,
    done: false,
    steps: specs.map((s) => ({
      label: s.label,
      command: svnCommandLine(s.args),
      state: 'queued',
      output: '',
    })),
  };
  operations.set(operation.id, operation);
  if (operations.size > MAX_OPERATIONS) operations.delete(operations.keys().next().value!);

  const finished =
    mode === 'parallel'
      ? Promise.all(
          specs.map((s, i) => enqueue(s.projectIds, () => runStep(operation.steps[i]!, s.args))),
        )
      : enqueue(
          specs.flatMap((s) => s.projectIds),
          async () => {
            for (const [i, s] of specs.entries()) {
              if (!(await runStep(operation.steps[i]!, s.args))) {
                for (const rest of operation.steps.slice(i + 1)) rest.state = 'skipped';
                return;
              }
            }
          },
        );
  void finished.then(() => {
    operation.done = true;
  });
  return operation;
}

/**
 * Identifica um plano pelos comandos que ele roda. A execução refaz o plano e só segue se a
 * impressão for a mesma da prévia: nada roda sem ter aparecido na confirmação.
 */
export function planFingerprint(commands: string[]): string {
  return createHash('sha256').update(commands.join('\n')).digest('hex');
}

export function getOperation(id: number): Operation {
  const operation = operations.get(id);
  if (!operation) throw new HttpError(404, 'operação desconhecida');
  return operation;
}
