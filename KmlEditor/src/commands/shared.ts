import { ICommand, CommandType } from '../contracts/commands';
import { IFeatureView, FeatureType } from '../contracts/document-model';
import { FeatureId, GeoPosition, LatLonBox, ModelOrientation, ModelScale, WorldPosition } from '../contracts/type';

export type FeatureOfType<T extends FeatureType> = Extract<IFeatureView, { type: T }>;

export function cloneGeoPosition(position: GeoPosition): GeoPosition {
    return { lon: position.lon, lat: position.lat, alt: position.alt };
}

export function cloneWorldPosition(position: WorldPosition): WorldPosition {
    return { x: position.x, y: position.y, z: position.z };
}

export function cloneLatLonBox(box: LatLonBox): LatLonBox {
    return {
        north: box.north,
        south: box.south,
        east: box.east,
        west: box.west,
        rotation: box.rotation,
    };
}

export function cloneModelOrientation(orientation: ModelOrientation): ModelOrientation {
    return { heading: orientation.heading, tilt: orientation.tilt, roll: orientation.roll };
}

export function cloneModelScale(scale: ModelScale): ModelScale {
    return { x: scale.x, y: scale.y, z: scale.z };
}

export function isFiniteNumber(value: number): boolean {
    return Number.isFinite(value);
}

export abstract class BaseCommand implements ICommand {
    protected constructor(
        private readonly commandType: CommandType,
        protected currentFeatureId: FeatureId,
        private readonly commandDescription: string,
    ) {}

    public get type(): CommandType {
        return this.commandType;
    }

    public get featureId(): FeatureId {
        return this.currentFeatureId;
    }

    public get description(): string {
        return this.commandDescription;
    }

    public abstract execute(document: import('../contracts/document-model').IKmlDocument, geoBridge: import('../contracts/geo-bridge').IGeoBridge): void;

    public abstract undo(document: import('../contracts/document-model').IKmlDocument, geoBridge: import('../contracts/geo-bridge').IGeoBridge): void;
}

export abstract class TextCommand extends BaseCommand {
    private originalValue: string | null = null;

    protected constructor(commandType: CommandType, featureId: FeatureId, description: string, private readonly fieldName: 'name' | 'description', private readonly nextValue: string) {
        super(commandType, featureId, description);
    }

    protected executeText(document: import('../contracts/document-model').IKmlDocument): void {
        const feature = document.getFeatureById(this.currentFeatureId);
        if (!feature) {
            throw new Error(`Feature ${String(this.currentFeatureId)} not found`);
        }

        if (this.originalValue === null) {
            this.originalValue = feature[this.fieldName];
        }

        feature[this.fieldName] = this.nextValue;
    }

    protected undoText(document: import('../contracts/document-model').IKmlDocument): void {
        if (this.originalValue === null) {
            return;
        }

        const feature = document.getFeatureById(this.currentFeatureId);
        if (!feature) {
            throw new Error(`Feature ${String(this.currentFeatureId)} not found`);
        }

        feature[this.fieldName] = this.originalValue;
    }
}

export abstract class SpatialCommand extends BaseCommand {}

export abstract class OverlayCommand extends SpatialCommand {
    private originalLatLonBox: LatLonBox | null = null;
    private originalAltitude: number | null = null;
    private originalAltitudeMode: import('../contracts/type').AltitudeMode | null = null;

    protected rememberOverlayState(feature: import('../contracts/document-model').IGroundOverlayFeature): void {
        if (this.originalLatLonBox === null) {
            this.originalLatLonBox = cloneLatLonBox(feature.latLonBox);
            this.originalAltitude = feature.altitude;
            this.originalAltitudeMode = feature.altitudeMode;
        }
    }

    protected restoreOverlayState(feature: import('../contracts/document-model').IGroundOverlayFeature): void {
        if (this.originalLatLonBox === null || this.originalAltitude === null || this.originalAltitudeMode === null) {
            return;
        }

        feature.latLonBox = cloneLatLonBox(this.originalLatLonBox);
        feature.altitude = this.originalAltitude;
        feature.altitudeMode = this.originalAltitudeMode;
    }
}

export abstract class ModelCommand extends SpatialCommand {
    private originalLocation: GeoPosition | null = null;
    private originalOrientation: ModelOrientation | null = null;
    private originalScale: ModelScale | null = null;
    private originalAltitudeMode: import('../contracts/type').AltitudeMode | null = null;

    protected rememberModelState(feature: import('../contracts/document-model').IModelFeature): void {
        if (this.originalLocation === null) {
            this.originalLocation = cloneGeoPosition(feature.location);
            this.originalOrientation = cloneModelOrientation(feature.orientation);
            this.originalScale = cloneModelScale(feature.scale);
            this.originalAltitudeMode = feature.altitudeMode;
        }
    }

    protected restoreModelState(feature: import('../contracts/document-model').IModelFeature): void {
        if (this.originalLocation === null || this.originalOrientation === null || this.originalScale === null || this.originalAltitudeMode === null) {
            return;
        }

        feature.location = cloneGeoPosition(this.originalLocation);
        feature.orientation = cloneModelOrientation(this.originalOrientation);
        feature.scale = cloneModelScale(this.originalScale);
        feature.altitudeMode = this.originalAltitudeMode;
    }
}