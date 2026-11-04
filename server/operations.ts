import type { Operation, OperationStep } from '../shared/types.ts';
import { HttpError } from './http-error.ts';
import { runSvnRaw, svnCommandLine } from './svn/run.ts';
import { enqueue } from './wc-queue.ts';

const MAX_OPERATIONS = 20;
const MAX_STEP_OUTPUT = 200_000;

let nextId = 1;
const operations = new Map<number, Operation>();

function append(step: OperationStep, text: string): void {
  if (step.output.length < MAX_STEP_OUTPUT) step.output += text;
}

/**
 * Começa uma operação com uma etapa por working copy e devolve logo, sem esperar o svn.
 * Cada etapa entra na fila da sua working copy; a tela acompanha por `getOperation`.
 */
export function startOperation(
  title: string,
  steps: Array<{ projectId: string; args: string[] }>,
): Operation {
  const operation: Operation = {
    id: nextId++,
    title,
    done: false,
    steps: steps.map((s) => ({
      projectId: s.projectId,
      command: svnCommandLine(s.args),
      state: 'queued',
      output: '',
    })),
  };
  operations.set(operation.id, operation);
  if (operations.size > MAX_OPERATIONS) operations.delete(operations.keys().next().value!);

  const runs = steps.map((s, i) => {
    const step = operation.steps[i]!;
    return enqueue(s.projectId, async () => {
      step.state = 'running';
      try {
        await runSvnRaw(s.args, (text) => append(step, text));
        step.state = 'done';
      } catch (error) {
        // O stderr já entrou na saída; só falha de execução (svn ausente) precisa da mensagem.
        if (step.output === '') append(step, (error as Error).message);
        step.state = 'failed';
      }
    });
  });
  void Promise.all(runs).then(() => {
    operation.done = true;
  });
  return operation;
}

export function getOperation(id: number): Operation {
  const operation = operations.get(id);
  if (!operation) throw new HttpError(404, 'operação desconhecida');
  return operation;
}
