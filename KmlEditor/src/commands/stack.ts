import { ICommand, ICommandStack } from '../contracts/commands';
import { IKmlDocument } from '../contracts/document-model';
import { IGeoBridge } from '../contracts/geo-bridge';

type Listener = () => void;

class CommandStack implements ICommandStack {
    private readonly history: ICommand[] = [];
    private cursor = 0;
    private readonly listeners = new Set<Listener>();

    public constructor(private readonly document: IKmlDocument, private readonly geoBridge: IGeoBridge) {}

    public execute(command: ICommand): void {
        command.execute(this.document, this.geoBridge);
        this.history.splice(this.cursor);
        this.history.push(command);
        this.cursor = this.history.length;
        this.notify();
    }

    public undo(): ICommand | null {
        if (!this.canUndo()) {
            return null;
        }

        const command = this.history[this.cursor - 1];
        command.undo(this.document, this.geoBridge);
        this.cursor -= 1;
        this.notify();
        return command;
    }

    public redo(): ICommand | null {
        if (!this.canRedo()) {
            return null;
        }

        const command = this.history[this.cursor];
        command.execute(this.document, this.geoBridge);
        this.cursor += 1;
        this.notify();
        return command;
    }

    public canUndo(): boolean {
        return this.cursor > 0;
    }

    public canRedo(): boolean {
        return this.cursor < this.history.length;
    }

    public onChange(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private notify(): void {
        for (const listener of this.listeners) {
            listener();
        }
    }
}

export function createCommandStack(document: IKmlDocument, geoBridge: IGeoBridge): ICommandStack {
    return new CommandStack(document, geoBridge);
}