import { FeatureId, FeatureSnapshot, FeatureTemplate, GeoPosition, LatLonBox, AltitudeMode, ModelOrientation, ModelScale } from './type';

export interface IKmlDocument {
    /** Parst einen KML-String in das interne Modell */
    parse(kmlString: string): void;

    /** Serialisiert zurück — byte-faithful für unberührte Knoten */
    serialize(): string;

    /** Gibt alle Features als typisierte Views zurück */
    getFeatures(): IFeatureView[];

    /** Feature nach ID finden */
    getFeatureById(id: FeatureId): IFeatureView | null;

    /** Neues Feature einfügen, gibt die zugewiesene ID zurück */
    insertFeature(template: FeatureTemplate, afterId?: FeatureId): FeatureId;

    /** Feature entfernen, gibt den entfernten KML-Knoten-Snapshot zurück (für Undo) */
    removeFeature(id: FeatureId): FeatureSnapshot;

    /** Feature aus Snapshot wiederherstellen (Undo von Delete) */
    restoreFeature(snapshot: FeatureSnapshot, afterId?: FeatureId): void;

    /** In-place Mutation eines Features im XML-Baum */
    updateFeature?(id: FeatureId, patch: Partial<IFeatureView>): void;
}

// Basis-Interface für alle Feature-Typen
export interface IFeatureView {
    readonly id: FeatureId;
    readonly type: FeatureType;
    name: string;
    description: string;
    readonly kmlId?: string;  // Original-KML-Id-Attribut, falls vorhanden
}

// Typ-Diskriminator
export type FeatureType = 'marker' | 'line' | 'ground-overlay' | 'model';

// Marker (Placemark → Point)
export interface IMarkerFeature extends IFeatureView {
    readonly type: 'marker';
    position: GeoPosition;           // lon, lat, alt
    iconHref: string | null;         // KML IconStyle href
    iconScale: number;               // KML IconStyle scale
    altitudeMode: AltitudeMode;
}

// Linie (Placemark → LineString)
export interface ILineFeature extends IFeatureView {
    readonly type: 'line';
    coordinates: GeoPosition[];      // geordnete Vertex-Liste
    altitudeMode: AltitudeMode;
}

// Ground Overlay
export interface IGroundOverlayFeature extends IFeatureView {
    readonly type: 'ground-overlay';
    imageHref: string;
    latLonBox: LatLonBox;
    altitude: number;
    altitudeMode: AltitudeMode;
}

// 3D Model
export interface IModelFeature extends IFeatureView {
    readonly type: 'model';
    location: GeoPosition;
    orientation: ModelOrientation;    // heading, tilt, roll
    scale: ModelScale;                // x, y, z
    modelHref: string;                // Pfad zum .dae / COLLADA
    altitudeMode: AltitudeMode;
}
