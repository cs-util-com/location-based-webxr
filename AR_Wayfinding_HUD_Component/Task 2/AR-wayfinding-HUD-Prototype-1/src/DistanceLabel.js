import * as THREE from 'three';

/**
 * DistanceLabel generates an XR-safe text sprite using a dynamic CanvasTexture.
 * It provides a performant way to render text in stereoscopic WebXR environments
 * without relying on DOM overlays or CSS3DRenderers.
 */
export class DistanceLabel {
    constructor() {
        // Create an off-screen canvas for rendering text
        this.canvas = document.createElement('canvas');
        this.context = this.canvas.getContext('2d');
        
        // Use a high resolution to ensure crisp text rendering
        this.canvas.width = 256;
        this.canvas.height = 128;

        // Initialize the dynamic texture
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.minFilter = THREE.LinearFilter;
        this.texture.magFilter = THREE.LinearFilter;

        // Create the sprite material, ignoring depth to render on top of the scene
        const material = new THREE.SpriteMaterial({
            map: this.texture,
            depthTest: false,
            depthWrite: false,
            transparent: true
        });

        this.sprite = new THREE.Sprite(material);
        this.sprite.renderOrder = 1000; // Ensure it renders above the HUD indicators
        
        // Scale the sprite appropriately relative to the camera frustum
        this.sprite.scale.set(0.4, 0.2, 1);
        
        this.currentText = '';
    }

    /**
     * Updates the text rendered on the canvas. To optimize performance,
     * the canvas is only redrawn if the text content has changed.
     * * @param {string} text - The formatted string to display (e.g., "15.2 m")
     */
    updateText(text) {
        if (this.currentText === text) {
            return;
        }
        this.currentText = text;

        const ctx = this.context;
        const width = this.canvas.width;
        const height = this.canvas.height;

        // Clear the previous frame
        ctx.clearRect(0, 0, width, height);

        // Draw a semi-transparent background pill for contrast
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.beginPath();
        ctx.roundRect(10, 10, width - 20, height - 20, 30);
        ctx.fill();

        // Configure typography
        ctx.font = 'bold 48px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        
        // Draw the text in the center of the canvas
        ctx.fillText(text, width / 2, height / 2);

        // Flag the texture for a WebGL update in the next render cycle
        this.texture.needsUpdate = true;
    }

    /**
     * Retrieves the underlying THREE.Sprite object for scene integration.
     * * @returns {THREE.Sprite}
     */
    getMesh() {
        return this.sprite;
    }
}