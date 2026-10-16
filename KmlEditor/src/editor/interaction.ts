import { WorldPosition } from '../contracts/type';

export interface ScreenPoint { x: number; y: number; }
export interface RayLike { origin: WorldPosition; direction: WorldPosition; }

export const DRAG_THRESHOLD_PX = 6;

/** True only once a pointer has moved far enough to be an edit drag. */
export function dragExceededThreshold(start: ScreenPoint, current: ScreenPoint, threshold = DRAG_THRESHOLD_PX): boolean {
    const dx = current.x - start.x;
    const dy = current.y - start.y;
    return dx * dx + dy * dy > threshold * threshold;
}

/** Intersects a ray with y = height without producing unstable/invalid coordinates. */
export function intersectRayWithHorizontalPlane(ray: RayLike, height: number): WorldPosition | null {
    if (!Number.isFinite(height) || !isFiniteVector(ray.origin) || !isFiniteVector(ray.direction)) return null;
    if (Math.abs(ray.direction.y) < 1e-8) return null;
    const distance = (height - ray.origin.y) / ray.direction.y;
    if (!Number.isFinite(distance) || distance < 0) return null;
    const point = { x: ray.origin.x + ray.direction.x * distance, y: height, z: ray.origin.z + ray.direction.z * distance };
    return isFiniteVector(point) ? point : null;
}

function isFiniteVector(value: WorldPosition): boolean {
    return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}
