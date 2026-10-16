import { ICommand, ICommandStack } from '../contracts/commands';

export class CommandStackDelegator implements ICommandStack {
    private _activeStack: ICommandStack | null = null;
    private readonly _listeners = new Set<() => void>();
    private _activeStackUnsubscribe: (() => void) | null = null;

    public setStack(stack: ICommandStack | null): void {
        if (this._activeStackUnsubscribe) {
            this._activeStackUnsubscribe();
            this._activeStackUnsubscribe = null;
        }
        this._activeStack = stack;
        if (stack) {
            this._activeStackUnsubscribe = stack.onChange(() => this.notify());
        }
        this.notify();
    }

    public execute(command: ICommand): void {
        if (!this._activeStack) {
            console.warn("No active command stack to execute command.");
            return;
        }
        this._activeStack.execute(command);
    }

    public undo(): ICommand | null {
        return this._activeStack ? this._activeStack.undo() : null;
    }

    public redo(): ICommand | null {
        return this._activeStack ? this._activeStack.redo() : null;
    }

    public canUndo(): boolean {
        return this._activeStack ? this._activeStack.canUndo() : false;
    }

    public canRedo(): boolean {
        return this._activeStack ? this._activeStack.canRedo() : false;
    }

    public onChange(listener: () => void): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    private notify(): void {
        for (const listener of this._listeners) {
            listener();
        }
    }
}
