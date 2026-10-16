import { IEditorStore } from '../contracts/store';
import { EditorStoreImpl } from './impl';

export { EditorStoreImpl } from './impl';
export { CommandStackDelegator } from './delegator';

export function createEditorStore(): IEditorStore {
    return new EditorStoreImpl();
}
