import {
    IKmlDocument,
    IFeatureView,
    IMarkerFeature,
    ILineFeature,
    IGroundOverlayFeature,
    IModelFeature,
    FeatureType,
} from '../contracts/document-model';
import {
    FeatureId,
    FeatureSnapshot,
    FeatureTemplate,
    GeoPosition,
    LatLonBox,
    AltitudeMode,
    ModelOrientation,
    ModelScale,
} from '../contracts/type';

type FeatureEntry = {
    feature: IFeatureView;
    tagName: string;
};

function localName(tagName: string): string {
    return tagName.split(':').pop() ?? tagName;
}

function formatCoordinateValue(value: number): string {
    return parseFloat(value.toFixed(10)).toString();
}


function formatGeoPosition(position: GeoPosition): string {
    return `${formatCoordinateValue(position.lon)},${formatCoordinateValue(position.lat)},${formatCoordinateValue(position.alt)}`;
}

function parseCoordinateText(text: string): GeoPosition {
    const values = text.trim().split(/\s+/).flatMap((part) => part.split(',')).filter(Boolean).map(Number);
    const [lon = 0, lat = 0, alt = 0] = values;
    return { lon, lat, alt };
}

function parseCoordinatesText(text: string): GeoPosition[] {
    const parts = text.trim().split(/\s+/).filter(Boolean);
    return parts.map((part) => parseCoordinateText(part));
}


class BaseFeatureView implements IFeatureView {
    public readonly id: FeatureId;
    private _name: string;
    private _description: string;
    public readonly kmlId?: string;
    public readonly type: FeatureType;

    protected readonly document: KmlDocumentImpl;
    protected readonly featureIndex: number;
    protected readonly featureTagName: string;

    constructor(document: KmlDocumentImpl, featureIndex: number, type: FeatureType, id: FeatureId, name: string, description: string, kmlId: string | undefined, featureTagName: string) {
        this.document = document;
        this.featureIndex = featureIndex;
        this.type = type;
        this.id = id;
        this._name = name;
        this._description = description;
        this.kmlId = kmlId;
        this.featureTagName = featureTagName;
    }

    public get name(): string {
        return this._name;
    }

    public set name(value: string) {
        this._name = value;
        this.replaceTagValue('name', this.escapeXml(value));
    }

    public get description(): string {
        return this._description;
    }

    public set description(value: string) {
        this._description = value;
        this.replaceTagValue('description', this.escapeXml(value));
    }

    protected replaceTagValue(tagName: string, newValue: string): void {
        this.document.replaceTagValue(this.featureIndex, tagName, newValue);
    }

    protected escapeXml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}

class MarkerFeatureView extends BaseFeatureView implements IMarkerFeature {
    public readonly type: 'marker' = 'marker';
    private _position: GeoPosition;
    public iconHref: string | null;
    public iconScale: number;
    public altitudeMode: AltitudeMode;

    constructor(document: KmlDocumentImpl, featureIndex: number, id: FeatureId, name: string, description: string, kmlId: string | undefined, position: GeoPosition, iconHref: string | null, iconScale: number, altitudeMode: AltitudeMode = 'clampToGround') {
        super(document, featureIndex, 'marker', id, name, description, kmlId, 'Placemark');
        this._position = position;
        this.iconHref = iconHref;
        this.iconScale = iconScale;
        this.altitudeMode = altitudeMode;
    }

    public set position(value: GeoPosition) {
        this.replaceTagValue('coordinates', formatGeoPosition(value));
        this._position = value;
    }

    public get position(): GeoPosition {
        return this._position;
    }
}

class LineFeatureView extends BaseFeatureView implements ILineFeature {
    public readonly type: 'line' = 'line';
    private _coordinates: GeoPosition[];
    public altitudeMode: AltitudeMode;

    constructor(document: KmlDocumentImpl, featureIndex: number, id: FeatureId, name: string, description: string, kmlId: string | undefined, coordinates: GeoPosition[], altitudeMode: AltitudeMode = 'clampToGround') {
        super(document, featureIndex, 'line', id, name, description, kmlId, 'Placemark');
        this._coordinates = coordinates;
        this.altitudeMode = altitudeMode;
    }

    public set coordinates(value: GeoPosition[]) {
        this.replaceTagValue('coordinates', value.map((coordinate) => formatGeoPosition(coordinate)).join('\n'));
        this._coordinates = value;
    }

    public get coordinates(): GeoPosition[] {
        return this._coordinates;
    }
}

class GroundOverlayFeatureView extends BaseFeatureView implements IGroundOverlayFeature {
    public readonly type: 'ground-overlay' = 'ground-overlay';
    public imageHref: string;
    public latLonBox: LatLonBox;
    public altitude: number;
    public altitudeMode: AltitudeMode;

    constructor(document: KmlDocumentImpl, featureIndex: number, id: FeatureId, name: string, description: string, kmlId: string | undefined, imageHref: string, latLonBox: LatLonBox, altitude: number, altitudeMode: AltitudeMode) {
        super(document, featureIndex, 'ground-overlay', id, name, description, kmlId, 'GroundOverlay');
        this.imageHref = imageHref;
        this.latLonBox = latLonBox;
        this.altitude = altitude;
        this.altitudeMode = altitudeMode;
    }
}

class ModelFeatureView extends BaseFeatureView implements IModelFeature {
    public readonly type: 'model' = 'model';
    private _location: GeoPosition;
    private _orientation: ModelOrientation;
    private _scale: ModelScale;
    public modelHref: string;
    public altitudeMode: AltitudeMode;

    constructor(document: KmlDocumentImpl, featureIndex: number, id: FeatureId, name: string, description: string, kmlId: string | undefined, location: GeoPosition, orientation: ModelOrientation, scale: ModelScale, modelHref: string, altitudeMode: AltitudeMode) {
        super(document, featureIndex, 'model', id, name, description, kmlId, 'Model');
        this._location = location;
        this._orientation = orientation;
        this._scale = scale;
        this.modelHref = modelHref;
        this.altitudeMode = altitudeMode;
    }

    public set location(value: GeoPosition) {
        this._location = value;
        this.replaceTagValue('longitude', String(value.lon));
        this.replaceTagValue('latitude', String(value.lat));
        this.replaceTagValue('altitude', String(value.alt));
    }

    public get location(): GeoPosition {
        return this._location;
    }

    public set orientation(value: ModelOrientation) {
        this._orientation = value;
        this.replaceTagValue('heading', String(value.heading));
        this.replaceTagValue('tilt', String(value.tilt));
        this.replaceTagValue('roll', String(value.roll));
    }

    public get orientation(): ModelOrientation {
        return this._orientation;
    }

    public set scale(value: ModelScale) {
        this._scale = value;
        this.replaceTagValue('x', String(value.x));
        this.replaceTagValue('y', String(value.y));
        this.replaceTagValue('z', String(value.z));
    }

    public get scale(): ModelScale {
        return this._scale;
    }
}

class KmlDocumentImpl implements IKmlDocument {
    private xml = '';
    private features: IFeatureView[] = [];
    private featureEntries: FeatureEntry[] = [];
    private nextFeatureId = 1;

    public parse(kmlString: string): void {
        this.xml = kmlString;
        this.features = [];
        this.featureEntries = [];
        this.nextFeatureId = 1;

        const ranges = this.findFeatureRanges(this.xml);
        ranges.forEach((range, index) => {
            const fragment = this.xml.slice(range.start, range.end);
            const feature = this.createFeatureView(index, fragment, range.tagName);
            if (feature) {
                this.features.push(feature);
                this.featureEntries.push({ feature, tagName: range.tagName });
            }
        });
    }

    public serialize(): string {
        return this.xml;
    }

    public getFeatures(): IFeatureView[] {
        return this.features;
    }

    public getFeatureById(id: FeatureId): IFeatureView | null {
        return this.features.find((feature) => feature.id === id) ?? null;
    }

    public insertFeature(template: FeatureTemplate, afterId?: FeatureId): FeatureId {
        const id = `feature-${this.nextFeatureId++}` as FeatureId;
        const featureXml = this.buildFeatureXml(template, id);
        const insertIndex = this.findInsertIndex(afterId);
        this.xml = this.xml.slice(0, insertIndex) + featureXml + this.xml.slice(insertIndex);
        this.parse(this.xml);
        return id;
    }

    public removeFeature(id: FeatureId): FeatureSnapshot {
        const featureIndex = this.features.findIndex((feature) => feature.id === id);
        if (featureIndex < 0) {
            throw new Error(`Feature ${String(id)} not found`);
        }

        const range = this.findFeatureRange(featureIndex);
        if (!range) {
            throw new Error(`Feature ${String(id)} range not found`);
        }

        const fragment = this.xml.slice(range.start, range.end);
        this.xml = this.xml.slice(0, range.start) + this.xml.slice(range.end);
        const snapshot: FeatureSnapshot = {
            id,
            type: this.features[featureIndex].type,
            kmlFragment: fragment,
            insertionIndex: range.start,
        };
        this.parse(this.xml);
        return snapshot;
    }

    public restoreFeature(snapshot: FeatureSnapshot, afterId?: FeatureId): void {
        const insertIndex = this.findInsertIndex(afterId);
        this.xml = this.xml.slice(0, insertIndex) + snapshot.kmlFragment + this.xml.slice(insertIndex);
        this.parse(this.xml);
    }

    public replaceTagValue(featureIndex: number, tagName: string, newValue: string): void {
        const range = this.findFeatureRange(featureIndex);
        if (!range) {
            return;
        }

        const fragment = this.xml.slice(range.start, range.end);
        const regex = new RegExp(`(<${tagName}\\b[^>]*>)([\\s\\S]*?)(<\\/${tagName}>)`, 'i');
        const match = fragment.match(regex);
        if (!match || match.index === undefined) {
            // Tag is missing, insert it right after the feature's opening tag
            const openTagEnd = fragment.indexOf('>');
            if (openTagEnd !== -1) {
                const insertPos = range.start + openTagEnd + 1;
                this.xml = this.xml.slice(0, insertPos) + `<${tagName}>${newValue}</${tagName}>` + this.xml.slice(insertPos);
            }
            return;
        }

        const localStart = range.start + match.index + match[1].length;
        const localEnd = localStart + match[2].length;
        this.xml = this.xml.slice(0, localStart) + newValue + this.xml.slice(localEnd);
    }


    private createFeatureView(index: number, fragment: string, tagName: string): IFeatureView | null {
        const kmlId = this.extractAttribute(fragment, 'id');
        const id = (kmlId ?? `feature-${index + 1}`) as FeatureId;
        const name = this.extractText(fragment, 'name');
        const description = this.extractText(fragment, 'description');

        if (tagName === 'GroundOverlay') {
            return new GroundOverlayFeatureView(
                this,
                index,
                id,
                name,
                description,
                kmlId,
                this.extractFirstHref(fragment),
                this.parseLatLonBox(fragment),
                this.extractNumber(fragment, 'altitude') ?? 0,
                this.extractText(fragment, 'altitudeMode') as AltitudeMode ?? 'clampToGround',
            );
        }

        if (tagName === 'Model' || this.containsTag(fragment, 'Model')) {
            return new ModelFeatureView(
                this,
                index,
                id,
                name,
                description,
                kmlId,
                this.parseLocation(fragment),
                this.parseOrientation(fragment),
                this.parseScale(fragment),
                this.extractFirstHref(fragment),
                this.extractText(fragment, 'altitudeMode') as AltitudeMode ?? 'clampToGround',
            );
        }

        if (this.containsTag(fragment, 'Point')) {
            const altitudeMode = (this.extractText(fragment, 'altitudeMode') || 'clampToGround') as AltitudeMode;
            return new MarkerFeatureView(
                this,
                index,
                id,
                name,
                description,
                kmlId,
                this.parsePosition(fragment),
                this.extractIconHref(fragment),
                this.extractNumber(fragment, 'scale') ?? 1,
                altitudeMode,
            );
        }

        if (this.containsTag(fragment, 'LineString') || this.containsTag(fragment, 'Polygon')) {
            const altitudeMode = (this.extractText(fragment, 'altitudeMode') || 'clampToGround') as AltitudeMode;
            return new LineFeatureView(
                this,
                index,
                id,
                name,
                description,
                kmlId,
                this.containsTag(fragment, 'Polygon')
                    ? this.parsePolygonCoordinates(fragment)
                    : this.parseLineCoordinates(fragment),
                altitudeMode,
            );
        }

        return null;
    }

    private findFeatureRanges(xml: string): Array<{ start: number; end: number; tagName: string }> {
        const ranges: Array<{ start: number; end: number; tagName: string }> = [];
        const featureTags = new Set(['Placemark', 'GroundOverlay', 'Model']);
        const regex = /<(\/)?([A-Za-z_][\w:.-]*)([^<>]*?)(\/?)>/g;
        let match: RegExpExecArray | null;

        while ((match = regex.exec(xml)) !== null) {
            const tagName = localName(match[2]);
            if (!featureTags.has(tagName)) {
                continue;
            }

            if (match[1] === '/') {
                continue;
            }

            const isSelfClosing = /\/>$/.test(match[0]) || /\/\s*>$/.test(match[0]);
            if (isSelfClosing) {
                continue;
            }

            const end = this.findMatchingTagEnd(xml, match.index, tagName);
            if (end === null) {
                continue;
            }

            ranges.push({ start: match.index, end, tagName });
        }

        // Filter out nested ranges (e.g. <Model> inside <Placemark>)
        return ranges.filter((r1, idx) => {
            return !ranges.some((r2, idx2) => idx2 !== idx && r1.start > r2.start && r1.end <= r2.end);
        });
    }

    private findMatchingTagEnd(xml: string, startIndex: number, tagName: string): number | null {
        const regex = /<(\/)?([A-Za-z_][\w:.-]*)([^<>]*?)(\/?)>/g;
        let depth = 0;
        let match: RegExpExecArray | null;
        regex.lastIndex = startIndex;

        while ((match = regex.exec(xml)) !== null) {
            const currentTagName = localName(match[2]);
            if (currentTagName !== tagName) {
                continue;
            }

            if (match[1] === '/') {
                depth -= 1;
                if (depth === 0) {
                    return match.index + match[0].length;
                }
            } else {
                const isSelfClosing = /\/>$/.test(match[0]) || /\/\s*>$/.test(match[0]);
                if (!isSelfClosing) {
                    depth += 1;
                }
            }
        }

        return null;
    }

    private findFeatureRange(featureIndex: number): { start: number; end: number } | null {
        const ranges = this.findFeatureRanges(this.xml);
        const range = ranges[featureIndex];
        return range ? { start: range.start, end: range.end } : null;
    }

    private findInsertIndex(afterId?: FeatureId): number {
        if (afterId) {
            const featureIndex = this.features.findIndex((feature) => feature.id === afterId);
            if (featureIndex >= 0) {
                const range = this.findFeatureRanges(this.xml)[featureIndex];
                if (range) {
                    return range.end;
                }
            }
        }
        return this.xml.length;
    }

    private buildFeatureXml(template: FeatureTemplate, id: FeatureId): string {
        switch (template.type) {
            case 'marker': {
                const coords = formatGeoPosition(template.position);
                const altModeXml = template.altitudeMode ? `<altitudeMode>${template.altitudeMode}</altitudeMode>` : '';
                return `<Placemark id="${id}"><name>${this.escapeXml(template.name)}</name><Point>${altModeXml}<coordinates>${coords}</coordinates></Point></Placemark>`;
            }
            case 'line': {
                const coords = template.coordinates.map((coordinate) => formatGeoPosition(coordinate)).join('\n');
                const altModeXml = template.altitudeMode ? `<altitudeMode>${template.altitudeMode}</altitudeMode>` : '';
                return `<Placemark id="${id}"><name>${this.escapeXml(template.name)}</name><LineString>${altModeXml}<coordinates>${coords}</coordinates></LineString></Placemark>`;
            }
            case 'ground-overlay': {
                return `<GroundOverlay id="${id}"><name>${this.escapeXml(template.name)}</name><Icon><href>${this.escapeXml(template.imageHref)}</href></Icon><LatLonBox><north>${template.latLonBox.north}</north><south>${template.latLonBox.south}</south><east>${template.latLonBox.east}</east><west>${template.latLonBox.west}</west><rotation>${template.latLonBox.rotation}</rotation></LatLonBox></GroundOverlay>`;
            }
            case 'model': {
                const orientation = template.orientation ?? { heading: 0, tilt: 0, roll: 0 };
                const scale = template.scale ?? { x: 1, y: 1, z: 1 };
                return `<Model id="${id}"><name>${this.escapeXml(template.name)}</name><Location><longitude>${template.location.lon}</longitude><latitude>${template.location.lat}</latitude><altitude>${template.location.alt}</altitude></Location><Orientation><heading>${orientation.heading}</heading><tilt>${orientation.tilt}</tilt><roll>${orientation.roll}</roll></Orientation><Scale><x>${scale.x}</x><y>${scale.y}</y><z>${scale.z}</z></Scale><Link><href>${this.escapeXml(template.modelHref)}</href></Link></Model>`;
            }
        }
    }

    private containsTag(fragment: string, tagName: string): boolean {
        return new RegExp(`<${tagName}\\b`, 'i').test(fragment);
    }

    private extractText(fragment: string, tagName: string): string {
        const match = fragment.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
        if (!match) return '';
        const rawValue = match[1];
        const cdataMatch = rawValue.match(/<!\[CDATA\[([\s\S]*?)\]\]>/i);
        return cdataMatch ? cdataMatch[1].trim() : rawValue.trim();
    }


    private extractAttribute(fragment: string, attributeName: string): string | undefined {
        const match = fragment.match(new RegExp(`\\b${attributeName}="([^"]*)"`, 'i'));
        return match ? match[1] : undefined;
    }

    private extractFirstHref(fragment: string): string {
        const match = fragment.match(/<href\b[^>]*>([\s\S]*?)<\/href>/i);
        return match ? this.stripMarkup(match[1]) : '';
    }

    private extractIconHref(fragment: string): string | null {
        const match = fragment.match(/<Icon\b[^>]*>[\s\S]*?<href\b[^>]*>([\s\S]*?)<\/href>[\s\S]*?<\/Icon>/i);
        return match ? this.stripMarkup(match[1]) : null;
    }

    private extractNumber(fragment: string, tagName: string): number | null {
        const match = fragment.match(new RegExp(`<${tagName}\\b[^>]*>([\\d.-]+)`, 'i'));
        return match ? Number(match[1]) : null;
    }

    private parsePosition(fragment: string): GeoPosition {
        const match = fragment.match(/<coordinates\b[^>]*>([\s\S]*?)<\/coordinates>/i);
        const text = match ? match[1] : '';
        return parseCoordinateText(text);
    }

    private parseLineCoordinates(fragment: string): GeoPosition[] {
        const match = fragment.match(/<coordinates\b[^>]*>([\s\S]*?)<\/coordinates>/i);
        const text = match ? match[1] : '';
        return parseCoordinatesText(text);
    }

    private parsePolygonCoordinates(fragment: string): GeoPosition[] {
        const match = fragment.match(/<LinearRing\b[^>]*>[\s\S]*?<coordinates\b[^>]*>([\s\S]*?)<\/coordinates>[\s\S]*?<\/LinearRing>/i);
        const text = match ? match[1] : '';
        return parseCoordinatesText(text);
    }

    private parseLatLonBox(fragment: string): LatLonBox {
        return {
            north: this.extractNumber(fragment, 'north') ?? 0,
            south: this.extractNumber(fragment, 'south') ?? 0,
            east: this.extractNumber(fragment, 'east') ?? 0,
            west: this.extractNumber(fragment, 'west') ?? 0,
            rotation: this.extractNumber(fragment, 'rotation') ?? 0,
        };
    }

    private parseLocation(fragment: string): GeoPosition {
        return {
            lon: this.extractNumber(fragment, 'longitude') ?? 0,
            lat: this.extractNumber(fragment, 'latitude') ?? 0,
            alt: this.extractNumber(fragment, 'altitude') ?? 0,
        };
    }

    private parseOrientation(fragment: string): ModelOrientation {
        return {
            heading: this.extractNumber(fragment, 'heading') ?? 0,
            tilt: this.extractNumber(fragment, 'tilt') ?? 0,
            roll: this.extractNumber(fragment, 'roll') ?? 0,
        };
    }

    private parseScale(fragment: string): ModelScale {
        return {
            x: this.extractNumber(fragment, 'x') ?? 1,
            y: this.extractNumber(fragment, 'y') ?? 1,
            z: this.extractNumber(fragment, 'z') ?? 1,
        };
    }

    private stripMarkup(value: string): string {
        return value.replace(/<[^>]+>/g, '').trim();
    }

    private escapeXml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}

export function createKmlDocument(): IKmlDocument {
    return new KmlDocumentImpl();
}
