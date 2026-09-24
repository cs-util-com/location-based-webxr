// Ports from docs/dev-server-ports.md; explicit overrides resolve stale Vite configs.
export const presentationPort = 5193;
export const demos = [
  { id: 'sun-position', label: 'Sun Position Demo', directory: 'GpsPlusSlamJs_SunPositionDemo', port: 5188, title: 'Sun Position Core Demo' },
  { id: 'sun-disc', label: 'Visible Sun Disc Demo', directory: 'GpsPlusSlamJs_VisibleSunDiscDemo', port: 5189, title: 'Visible Sun Disc Demo' },
  { id: 'lighting', label: 'Sun Altitude Lighting Demo', directory: 'GpsPlusSlamJs_SunAltitudeLightingDemo', port: 5191, title: 'Sun Altitude Lighting Demo' },
  { id: 'shadow', label: 'Shadow Rig Demo', directory: 'GpsPlusSlamJs_SunShadowRigDemo', port: 5190, title: 'Sun Shadow Rig Demo' },
  { id: 'adapter', label: 'Real Data Adapter Demo', directory: 'GpsPlusSlamJs_RealSunDataAdapterDemo', port: 5192, title: 'Real Data Adapter' },
];
export const localUrl = port => `http://127.0.0.1:${port}/`;
