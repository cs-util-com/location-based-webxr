import * as THREE from 'three';

interface CacheEntry {
    promise: Promise<THREE.Texture>;
    texture: THREE.Texture | null;
    refCount: number;
}

export class TexturePromiseCache {
    private static cache = new Map<string, CacheEntry>();

    public static acquire(resolvedAssetUrl: string, loader: THREE.TextureLoader): Promise<THREE.Texture> {
        let entry = this.cache.get(resolvedAssetUrl);
        if (!entry) {
            const promise = new Promise<THREE.Texture>((resolve, reject) => {
                loader.load(
                    resolvedAssetUrl,
                    (texture) => {
                        const ent = this.cache.get(resolvedAssetUrl);
                        if (ent) {
                            ent.texture = texture;
                        }
                        resolve(texture);
                    },
                    undefined,
                    (err) => {
                        this.cache.delete(resolvedAssetUrl);
                        reject(err);
                    }
                );
            });
            entry = { promise, texture: null, refCount: 0 };
            this.cache.set(resolvedAssetUrl, entry);
        }
        entry.refCount++;
        return entry.promise;
    }

    public static release(resolvedAssetUrl: string): void {
        const entry = this.cache.get(resolvedAssetUrl);
        if (!entry) return;
        entry.refCount--;
        if (entry.refCount <= 0) {
            if (entry.texture) {
                entry.texture.dispose();
            }
            this.cache.delete(resolvedAssetUrl);
        }
    }

    public static clear(): void {
        for (const [_, entry] of this.cache) {
            if (entry.texture) {
                entry.texture.dispose();
            }
        }
        this.cache.clear();
    }
}
