# Browser Mocks

Provides mock implementations for browser APIs that aren't available in Node.js test environments.

## Purpose

Testing WebXR, Geolocation, Device Orientation, and File System Access API code requires mocking these browser-only APIs. This module provides reusable, well-typed mocks that integrate with Vitest.

## Available Mocks

### WebXR

| Factory Function                | Description                                                |
| ------------------------------- | ---------------------------------------------------------- |
| `createMockPose(pos, orient)`   | Create an XRViewerPose with specified position/orientation |
| `createMockFrame(pose)`         | Create an XRFrame that returns the given pose              |
| `createMockDepthInfo(fn?)`      | Create depth info with custom depth function               |
| `createMockXRSession()`         | Create a mock XRSession with event listener tracking       |
| `createMockXR(supported?)`      | Create navigator.xr with isSessionSupported                |
| `installWebXRMocks(supported?)` | Install mocks globally, returns cleanup function           |

### Geolocation

| Factory Function                              | Description                                           |
| --------------------------------------------- | ----------------------------------------------------- |
| `createMockGeoPosition(lat, lon, alt?, acc?)` | Create a GeolocationPosition                          |
| `createMockGeolocation()`                     | Create navigator.geolocation with watch/clear support |
| `installGeolocationMocks()`                   | Install mocks globally, returns cleanup function      |

`createMockGeoPosition()` returns a DOM-compatible mock including `toJSON()` on both the position object and its nested `coords` object. Those serializers return plain data objects so they behave more like native geolocation objects during logging, snapshotting, and explicit `toJSON()` assertions.

### Device Orientation

| Factory Function                                  | Description                         |
| ------------------------------------------------- | ----------------------------------- |
| `createMockOrientationEvent(alpha, beta, gamma)`  | Create DeviceOrientationEvent data  |
| `createMockDeviceOrientationEventClass(granted?)` | Create class with requestPermission |

### File System Access API

| Factory Function                                    | Description                          |
| --------------------------------------------------- | ------------------------------------ |
| `createMockFileHandle(name, content?)`              | Create FileSystemFileHandle          |
| `createMockDirectoryHandle(name, files?, subdirs?)` | Create FileSystemDirectoryHandle     |
| `installFileSystemMocks(rootDir?)`                  | Install showDirectoryPicker globally |

### Class-based File System Mocks

For tests requiring programmatic file manipulation (adding/removing files), use the class-based mocks:

| Class                   | Description                                             |
| ----------------------- | ------------------------------------------------------- |
| `MockFSFileHandle`      | Mutable FileHandle with writable content                |
| `MockFSDirectoryHandle` | Directory with `addFile()` and `addDirectory()` methods |

```ts
import {
  MockFSDirectoryHandle,
  MockFSFileHandle,
} from './test-utils/browser-mocks';

// Create a directory structure programmatically
const root = new MockFSDirectoryHandle('recordings');
root.addFile('session.json', '{"name": "test"}');
root.addFile('points.json', '[]');
root.addDirectory('images', new MockFSDirectoryHandle('images'));

// Iterate over contents
for await (const [name, handle] of root) {
  console.log(name, handle.kind);
}

// Get specific handles
const file = await root.getFileHandle('session.json');
const subdir = await root.getDirectoryHandle('images');
```

## Usage Examples

### Testing WebXR Code

```ts
import { describe, it, expect, afterEach } from 'vitest';
import {
  createMockPose,
  createMockFrame,
  installWebXRMocks,
} from './test-utils/browser-mocks';
import { extractPoseFromViewer } from './ar/webxr-session';

describe('WebXR tests', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('extracts pose from frame', () => {
    const pose = createMockPose(
      { x: 1, y: 2, z: 3 },
      { x: 0, y: 0, z: 0, w: 1 }
    );
    const frame = createMockFrame(pose);

    const result = extractPoseFromViewer(frame.getViewerPose({}));

    expect(result?.position).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('checks WebXR support', async () => {
    const cleanup = installWebXRMocks(true);

    const supported = await navigator.xr?.isSessionSupported('immersive-ar');
    expect(supported).toBe(true);

    cleanup();
  });
});
```

### Testing Geolocation Code

```ts
import {
  createMockGeoPosition,
  createMockGeolocation,
} from './test-utils/browser-mocks';

it('handles GPS position', () => {
  const geo = createMockGeolocation();
  const callback = vi.fn();

  geo.watchPosition(callback);

  // Simulate position update
  const pos = createMockGeoPosition(50.0, 8.27, 100);
  (geo as any).simulatePosition(pos);

  expect(callback).toHaveBeenCalledWith(pos);
});
```

### Testing File System Code

```ts
import {
  createMockDirectoryHandle,
  createMockFileHandle,
} from './test-utils/browser-mocks';

it('reads files from directory', async () => {
  const files = new Map([
    ['config.json', '{"version": 1}'],
    ['data.json', '{"items": []}'],
  ]);
  const dir = createMockDirectoryHandle('root', files);

  const handle = await dir.getFileHandle('config.json');
  const file = await handle.getFile();
  const content = await file.text();

  expect(JSON.parse(content)).toEqual({ version: 1 });
});
```

### Combined Setup

```ts
import { installAllBrowserMocks } from './test-utils/browser-mocks';

describe('Full integration test', () => {
  let cleanup: () => void;

  beforeEach(() => {
    cleanup = installAllBrowserMocks({
      webxrSupported: true,
      geolocation: true,
      fileSystem: true,
    });
  });

  afterEach(() => cleanup());

  it('runs with all browser APIs mocked', async () => {
    // All browser APIs are now available
    expect(navigator.xr).toBeDefined();
    expect(navigator.geolocation).toBeDefined();
  });
});
```

## Tests

Unit tests are in [browser-mocks.test.ts](browser-mocks.test.ts) and cover the geolocation serializer contract, including plain-object `toJSON()` output for stable serialization.

## Notes

- All mocks use Vitest's `vi.fn()` for spying and assertions
- Use `vi.unstubAllGlobals()` in `afterEach` to clean up global stubs
- Mocks are designed to be minimal but extensible
- For full WebXR emulation in E2E tests, consider using the `webxr-polyfill` package (already installed)
- `MockOPFSDirectoryHandle.getDirectoryHandle`/`getFileHandle` are spec-faithful on **kind mismatch** (PR #158 review): when the name is taken by an entry of the other kind they reject with a `TypeMismatchError` `DOMException` — with AND without `create: true` — instead of silently replacing the entry. Production code branches on this error name (e.g. `opfs-storage`'s `createSession` collision probe treats it as "name taken").
