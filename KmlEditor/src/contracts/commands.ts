import { FeatureId } from './type';
import { IKmlDocument } from './document-model';
import { IGeoBridge } from './geo-bridge';

export interface ICommand {
    readonly type: CommandType;
    readonly featureId: FeatureId;
    readonly description: string;  // Für UI/Log ("Move marker 'Rathaus'")

    /** Führt den Command aus, mutiert das KML-Dokument */
    execute(document: IKmlDocument, geoBridge: IGeoBridge): void;

    /** Macht den Command rückgängig */
    undo(document: IKmlDocument, geoBridge: IGeoBridge): void;
}

export type CommandType =
    | 'move-marker'
    | 'move-line-vertex'
    | 'add-line-vertex'
    | 'remove-line-vertex'
    | 'move-overlay'
    | 'scale-overlay'
    | 'rotate-overlay'
    | 'move-model'
    | 'scale-model'
    | 'rotate-model'
    | 'set-name'
    | 'set-description'
    | 'create-feature'
    | 'delete-feature';

export interface ICommandStack {
    /** Führt einen Command aus und legt ihn auf den Undo-Stack */
    execute(command: ICommand): void;

    /** Undo — gibt den rückgängig gemachten Command zurück */
    undo(): ICommand | null;

    /** Redo — gibt den wiederholten Command zurück */
    redo(): ICommand | null;

    /** Ob Undo möglich ist */
    canUndo(): boolean;

    /** Ob Redo möglich ist */
    canRedo(): boolean;

    /** Listener für Stack-Änderungen (UI-Update) */
    onChange(listener: () => void): () => void;
}
