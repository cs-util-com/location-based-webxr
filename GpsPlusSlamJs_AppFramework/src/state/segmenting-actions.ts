/**
 * The actions whose presence in a recording means the ODOMETRY FRAME moved.
 *
 * A tracking restart wipes the frame; a loop closure deforms the stored
 * trajectory. Either way, anything recorded in raw WebXR/odometry space —
 * captured photos, QR poses — keeps its old coordinates while the frame it
 * was measured in has changed underneath it. Comparing or averaging across
 * such a boundary produces a plausible-looking answer that is simply wrong,
 * which is why every consumer either declines or segments there.
 *
 * ONE list, because two consumers now depend on it and they must agree: the
 * tour viewer's capture-time geo join (which declines) and the recorder's QR
 * sighting fold (which segments). A copy that drifted would make one of them
 * silently accept what the other refuses.
 */
export const SEGMENTING_ACTION_TYPES = [
  'gpsData/odometryTrackingRestarted',
  'gpsData/arLoopClosureDetected',
] as const;

/** Does this action type move the odometry frame? */
export function isSegmentingActionType(type: string): boolean {
  return (SEGMENTING_ACTION_TYPES as readonly string[]).includes(type);
}
