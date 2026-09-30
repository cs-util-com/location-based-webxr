import * as THREE from 'three';
import * as MeasurementPointViews from '../view/measurement-point-view';
import {
  selectProvisionalMeasurement,
  selectConfirmedMeasurementPoints,
  DEFAULT_QUALITY_THRESHOLDS,
} from '../state/measurement-points-slice';
import type {
  MeasurementRayRecord,
  MeasurementPointEntity,
} from '../storage/measurement-point-loader';
import { WEBXR_TO_NUE } from 'gps-plus-slam-app-framework/ar/webxr-nue-basis';
import type { CombinedRootState } from '../state/recorder-store';
import type { Matrix4 } from 'gps-plus-slam-app-framework/core';

interface ConfirmedMeasurementVisual {
  arDot: THREE.Mesh;
  gpsDot: THREE.Mesh;
}

export class MeasurementPointVisualizer {
  private arParent: THREE.Object3D;
  private arWorldGroup: THREE.Group;
  private scene: THREE.Scene;
  private measurementParent: THREE.Group;

  private measurementRayLines = new Map<string, THREE.LineSegments>();
  private measurementProvisionalSphere: THREE.Mesh | null = null;
  private confirmedMeasurementVisuals = new Map<
    string,
    ConfirmedMeasurementVisual
  >();

  constructor(arWorldGroup: THREE.Group, scene: THREE.Scene) {
    this.arWorldGroup = arWorldGroup;
    this.scene = scene;

    this.measurementParent = new THREE.Group();
    this.measurementParent.name = 'measurement-webxr-basis';
    this.measurementParent.matrixAutoUpdate = false;
    this.measurementParent.matrix.copy(WEBXR_TO_NUE);
    arWorldGroup.add(this.measurementParent);
    this.arParent = this.measurementParent;
  }

  // eslint-disable-next-line complexity
  public update(state: CombinedRootState): void {
    const pendingRays = state.measurementPoints.pendingRays;
    const provisional = selectProvisionalMeasurement(state);

    // 1. Ray Lines
    for (const [id, line] of this.measurementRayLines) {
      if (!pendingRays.some((r: MeasurementRayRecord) => r.id === id)) {
        this.measurementParent.remove(line);
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
        this.measurementRayLines.delete(id);
      }
    }
    for (const ray of pendingRays) {
      let line = this.measurementRayLines.get(ray.id);
      if (!line) {
        const geom = new THREE.BufferGeometry();
        const params = MeasurementPointViews.getRayVisualParams();
        const mat = new THREE.LineBasicMaterial({
          color: params.color,
          linewidth: params.lineWidth,
          depthTest: false,
          depthWrite: false,
        });
        line = new THREE.LineSegments(geom, mat);
        line.renderOrder = 1001;
        this.measurementParent.add(line);
        this.measurementRayLines.set(ray.id, line);
      }
      const pts = MeasurementPointViews.buildRayLinePoints(
        ray.rayOrigin,
        ray.rayDirection
      );
      line.geometry.setFromPoints([
        new THREE.Vector3(pts[0].x, pts[0].y, pts[0].z),
        new THREE.Vector3(pts[1].x, pts[1].y, pts[1].z),
      ]);
    }

    // 2. Provisional Sphere
    if (!this.measurementProvisionalSphere) {
      const params = MeasurementPointViews.getProvisionalVisualParams();
      const geom = new THREE.SphereGeometry(params.dotRadius, 16, 16);
      const mat = new THREE.MeshBasicMaterial({
        color: params.arDotColor,
        transparent: true,
        opacity: 0.5,
        depthTest: false,
        depthWrite: false,
      });
      this.measurementProvisionalSphere = new THREE.Mesh(geom, mat);
      this.measurementParent.add(this.measurementProvisionalSphere);
    }
    MeasurementPointViews.updateProvisionalSphere(
      this.measurementProvisionalSphere,
      provisional?.point
        ? {
            x: provisional.point[0],
            y: provisional.point[1],
            z: provisional.point[2],
          }
        : undefined,
      provisional?.uncertainty,
      DEFAULT_QUALITY_THRESHOLDS.maxUncertaintyHard
    );

    // 3. Confirmed
    this.updateConfirmedMeasurementVisuals(
      selectConfirmedMeasurementPoints(state),
      state.gpsData?.gpsEvents?.alignmentMatrix
    );

    this.measurementParent.updateMatrixWorld(true);
  }

  private createConfirmedMeasurementVisual(): ConfirmedMeasurementVisual {
    const params = MeasurementPointViews.getConfirmedVisualParams();
    const arDot = new THREE.Mesh(
      new THREE.SphereGeometry(params.dotRadius, 12, 12),
      new THREE.MeshBasicMaterial({
        color: params.arDotColor,
        depthTest: false,
        depthWrite: false,
      })
    );
    const gpsDot = new THREE.Mesh(
      new THREE.SphereGeometry(params.dotRadius, 12, 12),
      new THREE.MeshBasicMaterial({
        color: params.gpsDotColor,
        depthTest: false,
        depthWrite: false,
      })
    );
    arDot.renderOrder = 1002;
    gpsDot.renderOrder = 1002;
    this.arParent.add(arDot);
    this.scene.add(gpsDot);
    return { arDot, gpsDot };
  }

  private disposeConfirmedMeasurementVisual(
    visual: ConfirmedMeasurementVisual
  ) {
    this.arParent.remove(visual.arDot);
    this.scene.remove(visual.gpsDot);
    visual.arDot.geometry.dispose();
    (visual.arDot.material as THREE.Material).dispose();
    visual.gpsDot.geometry.dispose();
    (visual.gpsDot.material as THREE.Material).dispose();
  }

  private updateConfirmedMeasurementVisuals(
    confirmed: readonly MeasurementPointEntity[],
    alignmentMatrix: readonly number[] | null | undefined
  ): void {
    const activeIds = new Set(confirmed.map((entity) => entity.id));
    const matrix =
      alignmentMatrix?.length === 16
        ? (alignmentMatrix as unknown as Matrix4)
        : undefined;
    for (const [id, visual] of this.confirmedMeasurementVisuals) {
      if (!activeIds.has(id)) {
        this.disposeConfirmedMeasurementVisual(visual);
        this.confirmedMeasurementVisuals.delete(id);
      }
    }

    for (const entity of confirmed) {
      const visual =
        this.confirmedMeasurementVisuals.get(entity.id) ??
        this.createConfirmedMeasurementVisual();
      this.confirmedMeasurementVisuals.set(entity.id, visual);
      MeasurementPointViews.updateArDotPosition(
        visual.arDot,
        entity.arPosition
      );

      if (entity.gpsPositionSnapshot && matrix) {
        visual.gpsDot.position.set(
          entity.gpsPositionSnapshot[0],
          entity.gpsPositionSnapshot[1],
          entity.gpsPositionSnapshot[2]
        );
        visual.gpsDot.visible = true;
      } else {
        MeasurementPointViews.updateGpsDotPosition(
          visual.gpsDot,
          entity.arPosition,
          matrix
        );
      }
    }
  }

  public dispose() {
    this.arWorldGroup.remove(this.measurementParent);
    for (const visual of this.confirmedMeasurementVisuals.values()) {
      this.disposeConfirmedMeasurementVisual(visual);
    }
    this.confirmedMeasurementVisuals.clear();

    for (const line of this.measurementRayLines.values()) {
      this.measurementParent.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.measurementRayLines.clear();

    if (this.measurementProvisionalSphere) {
      this.measurementParent.remove(this.measurementProvisionalSphere);
      this.measurementProvisionalSphere.geometry.dispose();
      (this.measurementProvisionalSphere.material as THREE.Material).dispose();
      this.measurementProvisionalSphere = null;
    }
  }
}
