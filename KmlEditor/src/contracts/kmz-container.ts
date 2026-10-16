// Interfaces für KMZ/KML-Datei-I/O und Asset-Auflösung

export interface IKmzContainer {
    /** Öffnet eine .kmz oder .kml Datei */
    open(source: File | ArrayBuffer): Promise<void>;

    /** Gibt den rohen doc.kml-Inhalt zurück (als String) */
    getDocKml(): string;

    /** Setzt den doc.kml-Inhalt (nach Mutation durch kml-model) */
    setDocKml(content: string): void;

    /** Listet alle Asset-Einträge im Archiv */
    listAssets(): AssetEntry[];

    /** Schreibt das (ggf. modifizierte) Archiv als ArrayBuffer */
    save(): Promise<ArrayBuffer>;

    /** Gibt den Asset Provider für diesen Container zurück */
    getAssetProvider(): IAssetProvider;

    /** Custom flag indicating if input was a bare .kml file without ZIP wrapper */
    readonly isBareKml?: boolean;

    /** Räumt Blob-URLs etc. auf */
    dispose(): void;
}

export interface IAssetProvider {
    /** Löst einen KML-href zu einer Blob-URL auf (für <img>, ColladaLoader, etc.) */
    getAssetUrl(href: string): Promise<string>;

    /** Gibt eine geladene Blob-URL für einen href frei */
    release(href: string): void;

    /** Gibt die rohen Bytes eines Assets zurück */
    getAssetBytes(href: string): Promise<Uint8Array>;

    /** Prüft ob ein href im Container existiert */
    hasAsset(href: string): boolean;

    /** Räumt alle erzeugten Blob-URLs auf */
    dispose(): void;
}

export interface AssetEntry {
    /** Pfad relativ zum KMZ-Root (z.B. "images/icon.png") */
    path: string;
    /** Dateigröße in Bytes */
    size: number;
    /** Ob das Asset seit dem Öffnen verändert wurde */
    modified: boolean;
}
