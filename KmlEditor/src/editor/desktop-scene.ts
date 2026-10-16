import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** Browser-owned Three.js shell. Feature renderers are mounted below featureRoot. */
export class DesktopScene {
    public readonly scene = new THREE.Scene();
    public readonly featureRoot = new THREE.Group();
    public readonly overlayRoot = new THREE.Group();
    public readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100_000);
    public readonly renderer: THREE.WebGLRenderer;
    public readonly controls: OrbitControls;
    private frameId: number | null = null;
    private readonly resizeObserver: ResizeObserver;
    private disposed = false;

    public constructor(private readonly host: HTMLElement) {
        this.scene.background = new THREE.Color(0x10131a);
        this.scene.add(this.featureRoot, this.overlayRoot, new THREE.HemisphereLight(0xffffff, 0x263040, 2));
        const key = new THREE.DirectionalLight(0xffffff, 2);
        const grid = new THREE.GridHelper(1000, 500, 0x4e678a, 0x253244);
        grid.position.y = -0.01;
        this.scene.add(key, grid);
        this.camera.position.set(120, 120, 120);
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.domElement.setAttribute('aria-label', '3D KML preview');
        this.host.appendChild(this.renderer.domElement);
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.maxDistance = 50_000;
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(host);
        this.resize();
        this.renderLoop();
    }

    public focusOn(object: THREE.Object3D): void {
        const box = new THREE.Box3().setFromObject(object);
        if (box.isEmpty()) return;

        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z, 5);

        const offset = new THREE.Vector3(maxDim * 1.8, maxDim * 1.8, maxDim * 1.8);
        this.controls.target.copy(center);
        this.camera.position.copy(center).add(offset);
        this.controls.update();
    }

    public setZoomDistance(distance: number): void {
        const direction = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
        if (direction.lengthSq() === 0) direction.set(1, 1, 1);
        direction.normalize();
        const clampedDist = Math.max(2, Math.min(distance, 50_000));
        this.camera.position.copy(this.controls.target).addScaledVector(direction, clampedDist);
        this.controls.update();
    }

    public getZoomDistance(): number {
        return this.camera.position.distanceTo(this.controls.target);
    }

    public resize(): void {
        const width = Math.max(1, this.host.clientWidth);
        const height = Math.max(1, this.host.clientHeight);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height, false);
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        if (this.frameId !== null) cancelAnimationFrame(this.frameId);
        this.resizeObserver.disconnect();
        this.controls.dispose();
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }

    private renderLoop = (): void => {
        if (this.disposed) return;
        this.frameId = requestAnimationFrame(this.renderLoop);
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    };
}
