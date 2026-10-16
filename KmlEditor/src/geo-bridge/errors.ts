export class GeoBridgeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'GeoBridgeError';
    }
}

export class AnchorNotSetError extends GeoBridgeError {
    constructor() {
        super('Geo anchor has not been set');
        this.name = 'AnchorNotSetError';
    }
}

export class InvalidGeoPositionError extends GeoBridgeError {
    constructor(message = 'Invalid geo position') {
        super(message);
        this.name = 'InvalidGeoPositionError';
    }
}

export class InvalidWorldPositionError extends GeoBridgeError {
    constructor(message = 'Invalid world position') {
        super(message);
        this.name = 'InvalidWorldPositionError';
    }
}