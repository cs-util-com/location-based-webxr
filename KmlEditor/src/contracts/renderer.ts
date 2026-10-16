import { IFeatureView, FeatureType } from './document-model';
import { FeatureId } from './type';
import { IAssetProvider } from './kmz-container';
import { IGeoBridge } from './geo-bridge';

export interface IFeatureRenderer<T extends IFeatureView = IFeatureView, TNative3D = unknown> {
    /** Erzeugt/aktualisiert das 3D-Objekt für ein Feature */
    update(feature: T, assetProvider: IAssetProvider, geoBridge: IGeoBridge): Promise<void>;

    /** Gibt das native 3D-Objekt (z.B. Three.js Object3D) zurück */
    getNativeObject(): TNative3D;

    /** Feature-ID für Raycast/Pick-Zuordnung */
    readonly featureId: FeatureId;

    /** Räumt Geometrie/Material/Texturen auf */
    dispose(): void;
}

export interface IRendererFactory<TNative3D = unknown> {
    createRenderer(featureType: FeatureType): IFeatureRenderer<IFeatureView, TNative3D>;
}
