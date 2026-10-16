import { IKmlDocument, IFeatureView } from '../contracts/document-model';
import { FeatureId, GeoPosition, LatLonBox, ModelOrientation, ModelScale, WorldPosition } from '../contracts/type';
import { FeatureOfType, isFiniteNumber } from './shared';
import { FeatureType } from '../contracts/document-model';

export function requireFeature<T extends FeatureType>(document: IKmlDocument, featureId: FeatureId, expectedType?: T): FeatureOfType<T> {
    const feature = document.getFeatureById(featureId);
    if (!feature) {
        throw new Error(`Feature ${String(featureId)} not found`);
    }

    if (expectedType && feature.type !== expectedType) {
        throw new Error(`Feature ${String(featureId)} is not a ${expectedType}`);
    }

    return feature as FeatureOfType<T>;
}

export function validateWorldPosition(position: WorldPosition): void {
    if (!isFiniteNumber(position.x) || !isFiniteNumber(position.y) || !isFiniteNumber(position.z)) {
        throw new Error('World position must contain only finite numbers');
    }
}

export function validateFinitePosition(position: GeoPosition, context: string): void {
    if (!isFiniteNumber(position.lon) || !isFiniteNumber(position.lat) || !isFiniteNumber(position.alt)) {
        throw new Error(`${context} must contain only finite numbers`);
    }
}

export function validateFiniteLatLonBox(box: LatLonBox): void {
    if (!isFiniteNumber(box.north) || !isFiniteNumber(box.south) || !isFiniteNumber(box.east) || !isFiniteNumber(box.west) || !isFiniteNumber(box.rotation)) {
        throw new Error('LatLonBox must contain only finite numbers');
    }
}

export function validateFiniteModelOrientation(orientation: ModelOrientation): void {
    if (!isFiniteNumber(orientation.heading) || !isFiniteNumber(orientation.tilt) || !isFiniteNumber(orientation.roll)) {
        throw new Error('Model orientation must contain only finite numbers');
    }
}

export function validateFiniteModelScale(scale: ModelScale): void {
    if (!isFiniteNumber(scale.x) || !isFiniteNumber(scale.y) || !isFiniteNumber(scale.z)) {
        throw new Error('Model scale must contain only finite numbers');
    }
}

export function validateVertexIndex(index: number, length: number, allowEnd: boolean): void {
    if (!Number.isInteger(index)) {
        throw new Error('Vertex index must be an integer');
    }

    const upperBound = allowEnd ? length : length - 1;
    if (index < 0 || index > upperBound) {
        throw new Error('Vertex index is out of range');
    }
}