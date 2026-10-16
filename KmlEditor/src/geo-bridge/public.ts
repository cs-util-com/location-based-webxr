import { IGeoBridge } from '../contracts/geo-bridge';
import { GeoBridgeImpl } from './impl';

export function createGeoBridge(): IGeoBridge {
    return new GeoBridgeImpl();
}