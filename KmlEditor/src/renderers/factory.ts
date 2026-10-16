import { IRendererFactory, IFeatureRenderer } from '../contracts/renderer';
import { IFeatureView, FeatureType } from '../contracts/document-model';
import { MarkerRenderer } from './marker';
import { LineRenderer } from './line';
import { GroundOverlayRenderer } from './overlay';
import { ModelRenderer } from './model';
import * as THREE from 'three';

export class RendererFactory implements IRendererFactory<THREE.Object3D> {
    public createRenderer(featureType: FeatureType): IFeatureRenderer<IFeatureView, THREE.Object3D> {
        switch (featureType) {
            case 'marker':
                return new MarkerRenderer() as IFeatureRenderer<any, THREE.Object3D>;
            case 'line':
                return new LineRenderer() as IFeatureRenderer<any, THREE.Object3D>;
            case 'ground-overlay':
                return new GroundOverlayRenderer() as IFeatureRenderer<any, THREE.Object3D>;
            case 'model':
                return new ModelRenderer() as IFeatureRenderer<any, THREE.Object3D>;
            default:
                throw new Error(`Unsupported feature type: ${featureType}`);
        }
    }
}
