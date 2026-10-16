import { IKmlDocument, IFeatureView } from '../contracts/document-model';
import { IKmzContainer } from '../contracts/kmz-container';
import { IPersistenceService } from '../contracts/persistence';

/** Bridges completed document mutations to the container/persistence boundary. */
export class PersistenceCoordinator {
    private document: IKmlDocument | null = null;
    private container: IKmzContainer | null = null;
    private signature: string | null = null;

    public constructor(private readonly persistence: Pick<IPersistenceService, 'notifyChange'>) {}

    public observe(document: IKmlDocument | null, container: IKmzContainer | null): void {
        if (!document || !container) { this.reset(); return; }
        const nextSignature = featureSignature(document.getFeatures());
        if (document !== this.document || container !== this.container) {
            this.document = document;
            this.container = container;
            this.signature = nextSignature;
            return;
        }
        if (nextSignature === this.signature) return;
        const kml = document.serialize();
        container.setDocKml(kml);
        this.signature = nextSignature;
        this.persistence.notifyChange();
    }

    public reset(): void { this.document = null; this.container = null; this.signature = null; }
}

function featureSignature(features: readonly IFeatureView[]): string {
    // Contract views contain only data values. Stable field ordering detects command mutations without a second model copy.
    return JSON.stringify(features);
}
