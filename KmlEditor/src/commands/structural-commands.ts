import { ICommand } from '../contracts/commands';
import { IKmlDocument } from '../contracts/document-model';
import { IGeoBridge } from '../contracts/geo-bridge';
import { FeatureId, FeatureSnapshot, FeatureTemplate } from '../contracts/type';
import { BaseCommand } from './shared';

class CreateFeatureCommand extends BaseCommand {
    public constructor(private readonly template: FeatureTemplate, private readonly afterId?: FeatureId) {
        super('create-feature', '' as FeatureId, `Create feature ${template.type}`);
    }

    public execute(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        this.currentFeatureId = document.insertFeature(this.template, this.afterId);
    }

    public undo(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        if (!this.featureId) {
            return;
        }

        document.removeFeature(this.featureId);
    }
}

class DeleteFeatureCommand extends BaseCommand {
    private snapshot: FeatureSnapshot | null = null;

    public constructor(featureId: FeatureId, private readonly afterId?: FeatureId) {
        super('delete-feature', featureId, `Delete feature ${String(featureId)}`);
    }

    public execute(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        this.snapshot = document.removeFeature(this.featureId);
    }

    public undo(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        if (!this.snapshot) {
            return;
        }

        document.restoreFeature(this.snapshot, this.afterId);
    }
}

export function createCreateFeatureCommand(template: FeatureTemplate, afterId?: FeatureId): ICommand {
    return new CreateFeatureCommand(template, afterId);
}

export function createDeleteFeatureCommand(featureId: FeatureId, afterId?: FeatureId): ICommand {
    return new DeleteFeatureCommand(featureId, afterId);
}