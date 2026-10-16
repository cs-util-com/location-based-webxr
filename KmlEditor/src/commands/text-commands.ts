import { ICommand } from '../contracts/commands';
import { IKmlDocument } from '../contracts/document-model';
import { IGeoBridge } from '../contracts/geo-bridge';
import { FeatureId } from '../contracts/type';
import { TextCommand } from './shared';

class SetNameCommand extends TextCommand {
    public constructor(featureId: FeatureId, nextName: string) {
        super('set-name', featureId, `Set name ${String(featureId)}`, 'name', nextName);
    }

    public execute(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        this.executeText(document);
    }

    public undo(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        this.undoText(document);
    }
}

class SetDescriptionCommand extends TextCommand {
    public constructor(featureId: FeatureId, nextDescription: string) {
        super('set-description', featureId, `Set description ${String(featureId)}`, 'description', nextDescription);
    }

    public execute(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        this.executeText(document);
    }

    public undo(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        this.undoText(document);
    }
}

export function createSetNameCommand(featureId: FeatureId, nextName: string): ICommand {
    return new SetNameCommand(featureId, nextName);
}

export function createSetDescriptionCommand(featureId: FeatureId, nextDescription: string): ICommand {
    return new SetDescriptionCommand(featureId, nextDescription);
}