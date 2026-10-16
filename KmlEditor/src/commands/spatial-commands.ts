import { ICommand } from '../contracts/commands';
import { IGroundOverlayFeature, ILineFeature, IMarkerFeature, IModelFeature, IKmlDocument } from '../contracts/document-model';
import { IGeoBridge } from '../contracts/geo-bridge';
import { AltitudeMode, FeatureId, GeoPosition, LatLonBox, ModelOrientation, ModelScale, WorldPosition } from '../contracts/type';
import { cloneGeoPosition, cloneLatLonBox, cloneModelOrientation, cloneModelScale, cloneWorldPosition, OverlayCommand, SpatialCommand, ModelCommand } from './shared';
import {
    requireFeature,
    validateFiniteLatLonBox,
    validateFiniteModelOrientation,
    validateFiniteModelScale,
    validateFinitePosition,
    validateWorldPosition,
    validateVertexIndex,
} from './validation';

class MoveMarkerCommand extends SpatialCommand {
    private originalPosition: GeoPosition | null = null;

    public constructor(
        featureId: FeatureId,
        private readonly targetWorldPosition: WorldPosition,
        private readonly projectionOverride?: IGeoBridge
    ) {
        super('move-marker', featureId, `Move marker ${String(featureId)}`);
    }

    public execute(document: IKmlDocument, geoBridge: IGeoBridge): void {
        validateWorldPosition(this.targetWorldPosition);
        const feature = requireFeature(document, this.currentFeatureId, 'marker') as IMarkerFeature;
        if (this.originalPosition === null) {
            this.originalPosition = cloneGeoPosition(feature.position);
        }

        const projection = this.projectionOverride ?? geoBridge;
        feature.position = projection.worldToGeo(cloneWorldPosition(this.targetWorldPosition), 'absolute');
    }

    public undo(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        if (this.originalPosition === null) {
            return;
        }

        const feature = requireFeature(document, this.currentFeatureId, 'marker') as IMarkerFeature;
        feature.position = cloneGeoPosition(this.originalPosition);
    }
}

class MoveLineVertexCommand extends SpatialCommand {
    private originalCoordinates: GeoPosition[] | null = null;

    public constructor(featureId: FeatureId, private readonly vertexIndex: number, private readonly targetWorldPosition: WorldPosition) {
        super('move-line-vertex', featureId, `Move line vertex ${String(featureId)}`);
    }

    public execute(document: IKmlDocument, geoBridge: IGeoBridge): void {
        validateWorldPosition(this.targetWorldPosition);
        const feature = requireFeature(document, this.currentFeatureId, 'line') as ILineFeature;
        validateVertexIndex(this.vertexIndex, feature.coordinates.length, false);

        if (this.originalCoordinates === null) {
            this.originalCoordinates = feature.coordinates.map((coordinate) => cloneGeoPosition(coordinate));
        }

        const nextCoordinates = feature.coordinates.map((coordinate) => cloneGeoPosition(coordinate));
        nextCoordinates[this.vertexIndex] = geoBridge.worldToGeo(cloneWorldPosition(this.targetWorldPosition), 'absolute');
        feature.coordinates = nextCoordinates;
    }

    public undo(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        if (this.originalCoordinates === null) {
            return;
        }

        const feature = requireFeature(document, this.currentFeatureId, 'line') as ILineFeature;
        feature.coordinates = this.originalCoordinates.map((coordinate) => cloneGeoPosition(coordinate));
    }
}

class AddLineVertexCommand extends SpatialCommand {
    private originalCoordinates: GeoPosition[] | null = null;

    public constructor(featureId: FeatureId, private readonly vertexIndex: number, private readonly targetWorldPosition: WorldPosition) {
        super('add-line-vertex', featureId, `Add line vertex ${String(featureId)}`);
    }

    public execute(document: IKmlDocument, geoBridge: IGeoBridge): void {
        validateWorldPosition(this.targetWorldPosition);
        const feature = requireFeature(document, this.currentFeatureId, 'line') as ILineFeature;
        validateVertexIndex(this.vertexIndex, feature.coordinates.length, true);

        if (this.originalCoordinates === null) {
            this.originalCoordinates = feature.coordinates.map((coordinate) => cloneGeoPosition(coordinate));
        }

        const nextCoordinates = feature.coordinates.map((coordinate) => cloneGeoPosition(coordinate));
        nextCoordinates.splice(this.vertexIndex, 0, geoBridge.worldToGeo(cloneWorldPosition(this.targetWorldPosition), 'absolute'));
        feature.coordinates = nextCoordinates;
    }

    public undo(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        if (this.originalCoordinates === null) {
            return;
        }

        const feature = requireFeature(document, this.currentFeatureId, 'line') as ILineFeature;
        feature.coordinates = this.originalCoordinates.map((coordinate) => cloneGeoPosition(coordinate));
    }
}

class RemoveLineVertexCommand extends SpatialCommand {
    private originalCoordinates: GeoPosition[] | null = null;

    public constructor(featureId: FeatureId, private readonly vertexIndex: number) {
        super('remove-line-vertex', featureId, `Remove line vertex ${String(featureId)}`);
    }

    public execute(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        const feature = requireFeature(document, this.currentFeatureId, 'line') as ILineFeature;
        validateVertexIndex(this.vertexIndex, feature.coordinates.length, false);

        if (this.originalCoordinates === null) {
            this.originalCoordinates = feature.coordinates.map((coordinate) => cloneGeoPosition(coordinate));
        }

        const nextCoordinates = feature.coordinates.map((coordinate) => cloneGeoPosition(coordinate));
        nextCoordinates.splice(this.vertexIndex, 1);
        feature.coordinates = nextCoordinates;
    }

    public undo(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        if (this.originalCoordinates === null) {
            return;
        }

        const feature = requireFeature(document, this.currentFeatureId, 'line') as ILineFeature;
        feature.coordinates = this.originalCoordinates.map((coordinate) => cloneGeoPosition(coordinate));
    }
}

class MoveOverlayCommand extends OverlayCommand {
    public constructor(
        featureId: FeatureId,
        private readonly targetLatLonBox: LatLonBox,
        private readonly targetAltitude: number,
        private readonly targetAltitudeMode: AltitudeMode,
    ) {
        super('move-overlay', featureId, `Move overlay ${String(featureId)}`);
    }

    public execute(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        validateFiniteLatLonBox(this.targetLatLonBox);
        if (!Number.isFinite(this.targetAltitude)) {
            throw new Error('Overlay altitude must be finite');
        }

        const feature = requireFeature(document, this.currentFeatureId, 'ground-overlay') as IGroundOverlayFeature;
        this.rememberOverlayState(feature);
        feature.latLonBox = cloneLatLonBox(this.targetLatLonBox);
        feature.altitude = this.targetAltitude;
        feature.altitudeMode = this.targetAltitudeMode;
    }

    public undo(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        const feature = requireFeature(document, this.currentFeatureId, 'ground-overlay') as IGroundOverlayFeature;
        this.restoreOverlayState(feature);
    }
}

class ScaleOverlayCommand extends OverlayCommand {
    public constructor(featureId: FeatureId, private readonly targetLatLonBox: LatLonBox) {
        super('scale-overlay', featureId, `Scale overlay ${String(featureId)}`);
    }

    public execute(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        validateFiniteLatLonBox(this.targetLatLonBox);
        const feature = requireFeature(document, this.currentFeatureId, 'ground-overlay') as IGroundOverlayFeature;
        this.rememberOverlayState(feature);
        feature.latLonBox = cloneLatLonBox(this.targetLatLonBox);
    }

    public undo(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        const feature = requireFeature(document, this.currentFeatureId, 'ground-overlay') as IGroundOverlayFeature;
        this.restoreOverlayState(feature);
    }
}

class RotateOverlayCommand extends OverlayCommand {
    public constructor(featureId: FeatureId, private readonly targetRotation: number) {
        super('rotate-overlay', featureId, `Rotate overlay ${String(featureId)}`);
    }

    public execute(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        if (!Number.isFinite(this.targetRotation)) {
            throw new Error('Overlay rotation must be finite');
        }

        const feature = requireFeature(document, this.currentFeatureId, 'ground-overlay') as IGroundOverlayFeature;
        this.rememberOverlayState(feature);
        feature.latLonBox = { ...feature.latLonBox, rotation: this.targetRotation };
    }

    public undo(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        const feature = requireFeature(document, this.currentFeatureId, 'ground-overlay') as IGroundOverlayFeature;
        this.restoreOverlayState(feature);
    }
}

class MoveModelCommand extends ModelCommand {
    public constructor(featureId: FeatureId, private readonly targetLocation: GeoPosition) {
        super('move-model', featureId, `Move model ${String(featureId)}`);
    }

    public execute(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        validateFinitePosition(this.targetLocation, 'Model location');
        const feature = requireFeature(document, this.currentFeatureId, 'model') as IModelFeature;
        this.rememberModelState(feature);
        feature.location = cloneGeoPosition(this.targetLocation);
    }

    public undo(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        const feature = requireFeature(document, this.currentFeatureId, 'model') as IModelFeature;
        this.restoreModelState(feature);
    }
}

class ScaleModelCommand extends ModelCommand {
    public constructor(featureId: FeatureId, private readonly targetScale: ModelScale) {
        super('scale-model', featureId, `Scale model ${String(featureId)}`);
    }

    public execute(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        validateFiniteModelScale(this.targetScale);
        const feature = requireFeature(document, this.currentFeatureId, 'model') as IModelFeature;
        this.rememberModelState(feature);
        feature.scale = cloneModelScale(this.targetScale);
    }

    public undo(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        const feature = requireFeature(document, this.currentFeatureId, 'model') as IModelFeature;
        this.restoreModelState(feature);
    }
}

class RotateModelCommand extends ModelCommand {
    public constructor(featureId: FeatureId, private readonly targetOrientation: ModelOrientation) {
        super('rotate-model', featureId, `Rotate model ${String(featureId)}`);
    }

    public execute(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        validateFiniteModelOrientation(this.targetOrientation);
        const feature = requireFeature(document, this.currentFeatureId, 'model') as IModelFeature;
        this.rememberModelState(feature);
        feature.orientation = cloneModelOrientation(this.targetOrientation);
    }

    public undo(document: IKmlDocument, _geoBridge: IGeoBridge): void {
        const feature = requireFeature(document, this.currentFeatureId, 'model') as IModelFeature;
        this.restoreModelState(feature);
    }
}

export function createMoveMarkerCommand(
    featureId: FeatureId,
    targetWorldPosition: WorldPosition,
    projectionOverride?: IGeoBridge
): ICommand {
    return new MoveMarkerCommand(featureId, targetWorldPosition, projectionOverride);
}

export function createMoveLineVertexCommand(featureId: FeatureId, vertexIndex: number, targetWorldPosition: WorldPosition): ICommand {
    return new MoveLineVertexCommand(featureId, vertexIndex, targetWorldPosition);
}

export function createAddLineVertexCommand(featureId: FeatureId, vertexIndex: number, targetWorldPosition: WorldPosition): ICommand {
    return new AddLineVertexCommand(featureId, vertexIndex, targetWorldPosition);
}

export function createRemoveLineVertexCommand(featureId: FeatureId, vertexIndex: number): ICommand {
    return new RemoveLineVertexCommand(featureId, vertexIndex);
}

export function createMoveOverlayCommand(featureId: FeatureId, targetLatLonBox: LatLonBox, targetAltitude: number, targetAltitudeMode: AltitudeMode): ICommand {
    return new MoveOverlayCommand(featureId, targetLatLonBox, targetAltitude, targetAltitudeMode);
}

export function createScaleOverlayCommand(featureId: FeatureId, targetLatLonBox: LatLonBox): ICommand {
    return new ScaleOverlayCommand(featureId, targetLatLonBox);
}

export function createRotateOverlayCommand(featureId: FeatureId, targetRotation: number): ICommand {
    return new RotateOverlayCommand(featureId, targetRotation);
}

export function createMoveModelCommand(featureId: FeatureId, targetLocation: GeoPosition): ICommand {
    return new MoveModelCommand(featureId, targetLocation);
}

export function createScaleModelCommand(featureId: FeatureId, targetScale: ModelScale): ICommand {
    return new ScaleModelCommand(featureId, targetScale);
}

export function createRotateModelCommand(featureId: FeatureId, targetOrientation: ModelOrientation): ICommand {
    return new RotateModelCommand(featureId, targetOrientation);
}
