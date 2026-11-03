import { LOCK_LABELS } from '@shared/labels.ts';
import type { AppConfig, ReadOnlyConfig } from '@shared/schema.ts';
import type { Project } from '@shared/types.ts';
import { Lock, LockOpen } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useSaveIgnore, useSaveReadOnly, useSaveRoots } from '@/lib/queries';

export type SettingsTab = 'roots' | 'ignore' | 'read-only';

const lines = (text: string) => text.split('\n');
const joinLines = (values: string[]) => values.join('\n');

function SaveRow({
  onSave,
  pending,
  error,
  saved,
}: {
  onSave: () => void;
  pending: boolean;
  error: Error | null;
  saved: boolean;
}) {
  return (
    <div className="flex items-center justify-end gap-3">
      {error && <span className="text-destructive text-sm">{error.message}</span>}
      {saved && !error && <span className="text-muted-foreground text-sm">Salvo.</span>}
      <Button onClick={onSave} disabled={pending}>
        {pending ? 'Salvando…' : 'Salvar'}
      </Button>
    </div>
  );
}

function RootsTab({ config }: { config: AppConfig }) {
  const [text, setText] = useState(joinLines(config.roots));
  const save = useSaveRoots();
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        Uma pasta por linha. O app lista as subpastas diretas que são working copies SVN; as demais
        (git, por exemplo) ficam de fora. Pode usar <code>~</code> para a pasta pessoal.
      </p>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        className="font-mono text-xs"
        placeholder="~/projetos/meu-workspace"
      />
      <SaveRow
        onSave={() => save.mutate(lines(text))}
        pending={save.isPending}
        error={save.error}
        saved={save.isSuccess}
      />
    </div>
  );
}

function IgnoreTab({ config, projects }: { config: AppConfig; projects: Project[] }) {
  const [global, setGlobal] = useState(joinLines(config.ignore.global));
  const [perProject, setPerProject] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(config.ignore.projects).map(([id, p]) => [id, joinLines(p)])),
  );
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const save = useSaveIgnore();

  const submit = () =>
    save.mutate({
      global: lines(global),
      projects: Object.fromEntries(Object.entries(perProject).map(([id, t]) => [id, lines(t)])),
    });

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Um padrão por linha. Sem <code>/</code> (ex.: <code>.classpath</code>) vale em qualquer
        pasta; com <code>/</code> (ex.: <code>build/classes/</code>) parte da raiz do projeto.
        Arquivos ignorados aparecem recolhidos e nunca entram em commit.
      </p>
      <div className="space-y-1.5">
        <Label>Todos os projetos</Label>
        <Textarea
          value={global}
          onChange={(e) => setGlobal(e.target.value)}
          rows={5}
          className="font-mono text-xs"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ignore-project">Só no projeto</Label>
        <select
          id="ignore-project"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="border-input dark:bg-input/30 h-9 w-full rounded-md border bg-transparent px-2 text-sm"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {projectId && (
          <Textarea
            value={perProject[projectId] ?? ''}
            onChange={(e) => setPerProject({ ...perProject, [projectId]: e.target.value })}
            rows={4}
            className="font-mono text-xs"
          />
        )}
      </div>
      <SaveRow onSave={submit} pending={save.isPending} error={save.error} saved={save.isSuccess} />
    </div>
  );
}

const LOCK_DESCRIPTIONS: Record<keyof ReadOnlyConfig, string> = {
  local: 'update, resolver conflito, revert e cleanup: só afetam a sua cópia.',
  commit: 'envia mudanças para o repositório e afeta todo mundo.',
};

function ReadOnlyTab({ config }: { config: AppConfig }) {
  const save = useSaveReadOnly();
  const [confirming, setConfirming] = useState<keyof ReadOnlyConfig | null>(null);

  const setLock = (kind: keyof ReadOnlyConfig, locked: boolean) => {
    save.mutate({ ...config.readOnly, [kind]: locked });
    setConfirming(null);
  };

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        Com a chave ligada, o servidor recusa a operação. Destrave primeiro o que só afeta a sua
        máquina e deixe o commit por último.
      </p>
      {(Object.keys(LOCK_LABELS) as (keyof ReadOnlyConfig)[]).map((kind) => {
        const locked = config.readOnly[kind];
        return (
          <div key={kind} className="rounded-md border p-3">
            <div className="flex items-center gap-3">
              {locked ? (
                <Lock className="size-4 text-amber-600" />
              ) : (
                <LockOpen className="text-muted-foreground size-4" />
              )}
              <div className="flex-1">
                <div className="text-sm font-medium">Travar {LOCK_LABELS[kind]}</div>
                <div className="text-muted-foreground text-xs">{LOCK_DESCRIPTIONS[kind]}</div>
              </div>
              <Switch
                aria-label={`Travar ${LOCK_LABELS[kind]}`}
                checked={locked}
                disabled={save.isPending}
                onCheckedChange={(checked) => (checked ? setLock(kind, true) : setConfirming(kind))}
              />
            </div>
            {confirming === kind && (
              <div className="bg-warning text-warning-foreground mt-3 flex flex-wrap items-center gap-2 rounded-md p-2 text-sm">
                <span className="flex-1">
                  Destravar {LOCK_LABELS[kind]}? O app vai poder executar essas operações (sempre
                  com confirmação).
                </span>
                <Button size="xs" variant="outline" onClick={() => setConfirming(null)}>
                  Cancelar
                </Button>
                <Button size="xs" onClick={() => setLock(kind, false)}>
                  Destravar
                </Button>
              </div>
            )}
          </div>
        );
      })}
      {save.error && <p className="text-destructive text-sm">{save.error.message}</p>}
    </div>
  );
}

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  config: AppConfig;
  configPath: string;
  projects: Project[];
}

export function SettingsDialog({
  open,
  onOpenChange,
  tab,
  onTabChange,
  config,
  configPath,
  projects,
}: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Configurações</DialogTitle>
          <DialogDescription>
            Salvas em <code className="font-mono text-xs">{configPath}</code>
          </DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(value) => onTabChange(value as SettingsTab)}>
          <TabsList>
            <TabsTrigger value="roots">Pastas raiz</TabsTrigger>
            <TabsTrigger value="ignore">Ignorados</TabsTrigger>
            <TabsTrigger value="read-only">Somente leitura</TabsTrigger>
          </TabsList>
          <TabsContent value="roots">
            <RootsTab config={config} />
          </TabsContent>
          <TabsContent value="ignore">
            <IgnoreTab config={config} projects={projects} />
          </TabsContent>
          <TabsContent value="read-only">
            <ReadOnlyTab config={config} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
