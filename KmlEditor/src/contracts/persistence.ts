import { IKmzContainer } from './kmz-container';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface IPersistenceService {
    /** Öffnet eine Datei (File System Access API oder Fallback) */
    open(file?: File): Promise<IKmzContainer>;

    /** Speichert den aktuellen Stand (debounced, atomar) */
    save(container: IKmzContainer): Promise<void>;

    /** Erzwingt sofortiges Speichern */
    flush(container: IKmzContainer): Promise<void>;

    /** Markiert, dass eine Änderung stattgefunden hat (triggert debounced save) */
    notifyChange(): void;

    /** Aktueller Save-Status */
    readonly status: SaveStatus;

    /** Listener für Status-Änderungen */
    onStatusChange(listener: (status: SaveStatus) => void): () => void;

    /** Ob File System Access API verfügbar ist */
    readonly hasNativeFileAccess: boolean;

    /** Fallback: Download als Datei */
    downloadAs(container: IKmzContainer, filename: string): Promise<void>;

    dispose(): void;
}
