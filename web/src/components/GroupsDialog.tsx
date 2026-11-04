import type { Group } from '@shared/schema.ts';
import type { Project } from '@shared/types.ts';
import { Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSaveGroups } from '@/lib/queries';
import { cn } from '@/lib/utils';

interface GroupsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: Group[];
  projects: Project[];
}

/**
 * Criar, renomear e apagar grupos e escolher os projetos de cada um. Salva a cada mudança.
 * Cada mudança parte de `latest`, não das props, para que cliques seguidos não se sobrescrevam
 * enquanto o salvamento anterior ainda não voltou.
 */
export function GroupsDialog({ open, onOpenChange, groups, projects }: GroupsDialogProps) {
  const save = useSaveGroups();
  const [draft, setDraft] = useState(groups);
  const latest = useRef(groups);
  const [selectedId, setSelectedId] = useState<string | null>(groups[0]?.id ?? null);
  const [newName, setNewName] = useState('');
  const selected = draft.find((g) => g.id === selectedId) ?? null;

  const applyChange = (change: (current: Group[]) => Group[]) => {
    const next = change(latest.current);
    latest.current = next;
    setDraft(next);
    save.mutate(next);
  };

  const create = () => {
    const name = newName.trim();
    if (!name) return;
    const group: Group = { id: crypto.randomUUID(), name, projects: [] };
    applyChange((current) => [...current, group]);
    setSelectedId(group.id);
    setNewName('');
  };

  const update = (id: string, change: (group: Group) => Group) => {
    applyChange((current) => current.map((g) => (g.id === id ? change(g) : g)));
  };

  const remove = () => {
    if (!selected) return;
    applyChange((current) => current.filter((g) => g.id !== selected.id));
    setSelectedId(null);
  };

  const toggleProject = (projectId: string, checked: boolean) => {
    if (!selected) return;
    update(selected.id, (group) => {
      const set = new Set(group.projects);
      if (checked) set.add(projectId);
      else set.delete(projectId);
      return { ...group, projects: [...set] };
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Grupos</DialogTitle>
          <DialogDescription>
            Um projeto pode estar em vários grupos. Grupo só filtra a tela, não muda nada no svn.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
          <div className="space-y-2">
            <form
              className="flex gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                create();
              }}
            >
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Novo grupo"
                className="h-8"
              />
              <Button type="submit" size="icon-sm" variant="outline" title="Criar grupo">
                <Plus />
              </Button>
            </form>
            <div className="space-y-0.5">
              {draft.length === 0 && (
                <p className="text-muted-foreground text-sm">Nenhum grupo ainda.</p>
              )}
              {draft.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => setSelectedId(group.id)}
                  className={cn(
                    'flex w-full justify-between rounded-md px-2 py-1 text-left text-sm',
                    group.id === selectedId ? 'bg-accent font-medium' : 'hover:bg-accent/50',
                  )}
                >
                  <span className="truncate">{group.name}</span>
                  <span className="text-muted-foreground text-xs">{group.projects.length}</span>
                </button>
              ))}
            </div>
          </div>

          {selected ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  key={selected.id}
                  defaultValue={selected.name}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== selected.name)
                      update(selected.id, (g) => ({ ...g, name }));
                  }}
                  aria-label="Nome do grupo"
                />
                <Button variant="outline" size="icon" onClick={remove} title="Apagar grupo">
                  <Trash2 />
                </Button>
              </div>
              <div className="max-h-80 space-y-1.5 overflow-y-auto">
                {projects.map((project) => (
                  <Label key={project.id} className="font-normal">
                    <Checkbox
                      aria-label={project.name}
                      checked={selected.projects.includes(project.id)}
                      onCheckedChange={(checked) => toggleProject(project.id, checked === true)}
                    />
                    <span>{project.name}</span>
                    <span className="text-muted-foreground font-mono text-xs">
                      {project.relativeUrl}
                    </span>
                  </Label>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              Crie um grupo ou escolha um na lista para definir os projetos dele.
            </p>
          )}
        </div>
        {save.error && <p className="text-destructive text-sm">{save.error.message}</p>}
      </DialogContent>
    </Dialog>
  );
}
