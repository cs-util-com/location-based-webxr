import { GeoPosition, AltitudeMode, WorldPosition } from './type';

export interface IGeoBridge {
    /** Setzt den Welt-Anker (GPS-Position die dem Three.js-Ursprung entspricht) */
    setAnchor(anchor: GeoAnchor): void;

    /** Gibt den aktuellen Welt-Anker zurück */
    getAnchor(): GeoAnchor | null;

    /** Geo → World: Wandelt eine Geo-Position in Three.js-Weltkoordinaten um */
    geoToWorld(position: GeoPosition, altitudeMode?: AltitudeMode): WorldPosition;

    /** World → Geo: Wandelt Three.js-Weltkoordinaten zurück in Geo-Position */
    worldToGeo(position: WorldPosition, altitudeMode?: AltitudeMode): GeoPosition;

    /** Formatiert Koordinaten so, dass unveränderte Werte keinen Diff erzeugen */
    formatCoordinate(value: number, originalString?: string): string;
}

export interface GeoAnchor {
    /** Geo-Position des Weltkoordinaten-Ursprungs */
    position: GeoPosition;
    /** Ausrichtung (Heading in Grad, 0=Nord, im Uhrzeigersinn) */
    heading: number;
}
