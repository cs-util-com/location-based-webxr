/**
 * The terrain lab's credits (terrain plan 2026-09-27-0605 §3, §4 "Data";
 * research 2026-09-27-0600 §5.4): the AWS Terrain Tiles ask every source to
 * be credited "in a place that is reasonable to the medium", with the texts
 * of tilezen/joerd `docs/attribution.md` (read 2026-09-27), and the
 * registry asks for a dated citation.
 *
 * WHY THE LAB CARRIES ITS OWN LIST: the Osm library's `TERRARIUM_ATTRIBUTION`
 * names none of these sources. That gap is filed as its own fix (plan §8);
 * until it lands, this list is the complete one.
 *
 * @see terrain-credits.js.md
 */

/** The short line shown over the canvas. */
export const TERRAIN_CREDIT_SHORT =
  "Elevation: AWS Terrain Tiles (Mapzen). USGS, NOAA and others: see sources.";

/** The source's own page, and the registry's requested citation. */
export const TERRAIN_CREDIT_LINKS = Object.freeze([
  Object.freeze({
    text: "Terrain Tiles was accessed on 2026-09-27 from https://registry.opendata.aws/terrain-tiles",
    href: "https://registry.opendata.aws/terrain-tiles/",
  }),
  Object.freeze({
    text: "Attribution texts: tilezen/joerd docs/attribution.md",
    href: "https://github.com/tilezen/joerd/blob/master/docs/attribution.md",
  }),
]);

/** The required attribution, as joerd lists it (Mapzen first, hosted tiles). */
export const TERRAIN_CREDITS = Object.freeze([
  "Mapzen",
  "ArcticDEM terrain data DEM(s) were created from DigitalGlobe, Inc., imagery and funded under National Science Foundation awards 1043681, 1559691, and 1542736",
  "Australia terrain data © Commonwealth of Australia (Geoscience Australia) 2017",
  "Austria terrain data © offene Daten Österreichs - Digitales Geländemodell (DGM) Österreich",
  "Canada terrain data contains information licensed under the Open Government Licence - Canada",
  "Europe terrain data produced using Copernicus data and information funded by the European Union - EU-DEM layers",
  "Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration",
  "Mexico terrain data source: INEGI, Continental relief, 2016",
  "New Zealand terrain data Copyright 2011 Crown copyright (c) Land Information New Zealand and the New Zealand Government (All rights reserved)",
  "Norway terrain data © Kartverket",
  "United Kingdom terrain data © Environment Agency copyright and/or database right 2015. All rights reserved",
  "United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey",
]);
