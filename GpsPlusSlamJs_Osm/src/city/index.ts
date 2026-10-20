/**
 * City module: a city's data planned and loaded once for every consumer
 * (round-4 plan 2026-10-11-0122 §5), and how far a load has come.
 */

export type {
  CityData,
  CityDataPlan,
  CityDataPlanOptions,
  CityHeights,
  CityLoad,
  CityLoadOptions,
  CityLoadReport,
  CityRing,
} from "./city-data.js";
export {
  cityDataPlan,
  createCityTileSource,
  loadCityData,
} from "./city-data.js";
export type { CityJobCounts, CityLoadCounts } from "./city-progress.js";
export {
  CITY_JOB_WEIGHTS,
  cityLoadProgress,
  cityLoadSettled,
} from "./city-progress.js";
