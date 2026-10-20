/** Bounded undo/redo stacks keyed by document id. */
export class History<T> {
  private undoStacks = new Map<string, T[]>();
  private redoStacks = new Map<string, T[]>();

  constructor(private readonly cap = 50) {}

  /** Records the state before a change; clears the redo stack. */
  push(id: string, before: T) {
    const stack = this.undoStacks.get(id) ?? [];
    stack.push(before);
    if (stack.length > this.cap) stack.shift();
    this.undoStacks.set(id, stack);
    this.redoStacks.delete(id);
  }

  undo(id: string, current: T): T | undefined {
    const prev = this.undoStacks.get(id)?.pop();
    if (prev === undefined) return undefined;
    this.redoStacks.set(id, [...(this.redoStacks.get(id) ?? []), current]);
    return prev;
  }

  redo(id: string, current: T): T | undefined {
    const next = this.redoStacks.get(id)?.pop();
    if (next === undefined) return undefined;
    this.undoStacks.get(id)?.push(current) ?? this.undoStacks.set(id, [current]);
    return next;
  }

  canUndo = (id: string) => (this.undoStacks.get(id)?.length ?? 0) > 0;
  canRedo = (id: string) => (this.redoStacks.get(id)?.length ?? 0) > 0;
  size = (id: string) => this.undoStacks.get(id)?.length ?? 0;
}
