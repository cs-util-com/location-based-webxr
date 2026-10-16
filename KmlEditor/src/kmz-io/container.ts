import type { AssetEntry, IAssetProvider, IKmzContainer } from '../contracts/kmz-container';
import { KmzContainerError } from './errors';
import { SimpleZipAdapter } from './zip-adapter';

export class KmzContainer implements IKmzContainer {
  private docKml = '';
  private assets = new Map<string, Uint8Array>();
  private assetEntries: AssetEntry[] = [];
  private hrefReferences: string[] = [];
  private docEntryPath = 'doc.kml';
  private provider: AssetProvider;
  private kind: 'kmz' | 'kml' = 'kml';
  private readonly zipAdapter = new SimpleZipAdapter();

  constructor() {
    this.provider = new AssetProvider(this);
  }

  async open(source: File | ArrayBuffer): Promise<void> {
    const bytes = source instanceof File ? new Uint8Array(await source.arrayBuffer()) : new Uint8Array(source);
    this.kind = this.detectFormat(bytes);

    if (this.kind === 'kmz') {
      const archive = await this.zipAdapter.readArchive(bytes);
      const docEntry = this.resolveDocEntry(archive);
      if (!docEntry) {
        throw new KmzContainerError('doc.kml missing');
      }

      this.docKml = this.decodeText(docEntry.data);
      this.docEntryPath = docEntry.path;
      this.assets = new Map();
      this.assetEntries = [];
      this.hrefReferences = this.extractHrefReferences(this.docKml);

      for (const [path, data] of archive.entries()) {
        if (path === docEntry.path) {
          continue;
        }
        this.assets.set(path, data);
        this.assetEntries.push({
          path,
          size: data.byteLength,
          modified: false,
        });
      }
      return;
    }

    this.docKml = this.decodeText(bytes);
    this.docEntryPath = 'doc.kml';
    this.assets = new Map();
    this.assetEntries = [];
    this.hrefReferences = this.extractHrefReferences(this.docKml);
  }

  getDocKml(): string {
    return this.docKml;
  }

  setDocKml(content: string): void {
    this.docKml = content;
  }

  listAssets(): AssetEntry[] {
    return this.assetEntries.map((entry) => ({ ...entry }));
  }

  async save(): Promise<ArrayBuffer> {
    if (this.kind === 'kmz') {
      const entries = [{ path: this.docEntryPath, data: this.encodeText(this.docKml) }];
      for (const asset of this.assetEntries) {
        const data = this.assets.get(asset.path);
        if (data) {
          entries.push({ path: asset.path, data });
        }
      }
      const archiveBytes = await this.zipAdapter.writeArchive(entries);
      const archiveBuffer = archiveBytes.buffer.slice(archiveBytes.byteOffset, archiveBytes.byteOffset + archiveBytes.byteLength) as ArrayBuffer;
      return archiveBuffer;
    }

    const xmlBytes = this.encodeText(this.docKml);
    const xmlBuffer = xmlBytes.buffer.slice(xmlBytes.byteOffset, xmlBytes.byteOffset + xmlBytes.byteLength) as ArrayBuffer;
    return xmlBuffer;
  }

  getAssetProvider(): IAssetProvider {
    return this.provider;
  }

  dispose(): void {
    this.provider.dispose();
  }

  getAssetBytesInternal(href: string): Uint8Array | undefined {
    for (const candidate of this.resolveAssetCandidates(href)) {
      const bytes = this.assets.get(candidate);
      if (bytes) {
        return bytes;
      }
    }
    return undefined;
  }

  hasAssetInternal(href: string): boolean {
    return this.resolveAssetCandidates(href).some((candidate) => this.assets.has(candidate));
  }

  getHrefReferences(): string[] {
    return [...this.hrefReferences];
  }

  private detectFormat(bytes: Uint8Array): 'kmz' | 'kml' {
    if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
      return 'kmz';
    }
    return 'kml';
  }

  private decodeText(value: Uint8Array): string {
    return new TextDecoder('utf-8', { fatal: false }).decode(value);
  }

  private encodeText(value: string): Uint8Array {
    return new TextEncoder().encode(value);
  }

  private extractHrefReferences(kml: string): string[] {
    return Array.from(kml.matchAll(/<href>([^<]+)<\/href>/gi), (match) => this.normalizeHref(match[1]));
  }

  private resolveDocEntry(archive: Map<string, Uint8Array>): { path: string; data: Uint8Array } | undefined {
    const candidates = ['doc.kml', 'Doc.kml', 'doc.KML', 'kml/doc.kml', 'doc.kml/'];
    for (const candidate of candidates) {
      const data = archive.get(candidate);
      if (data) {
        return { path: candidate, data };
      }
    }

    for (const [path, data] of archive.entries()) {
      const normalized = path.toLowerCase();
      if (normalized.endsWith('/doc.kml') || normalized === 'doc.kml') {
        return { path, data };
      }
    }

    return undefined;
  }

  private normalizeHref(href: string): string {
    const trimmed = href.trim();
    if (trimmed.startsWith('./')) {
      return trimmed.slice(2);
    }
    return trimmed.replace(/^\/+/, '');
  }

  private resolveAssetCandidates(href: string): string[] {
    const normalizedHref = this.normalizeHref(href);
    if (this.isRemoteHref(normalizedHref)) {
      return [];
    }

    const candidates = [normalizedHref, this.stripLeadingSlash(normalizedHref)];
    const docDirectory = this.docEntryPath.includes('/')
      ? this.docEntryPath.slice(0, this.docEntryPath.lastIndexOf('/') + 1)
      : '';

    if (docDirectory && !normalizedHref.startsWith(docDirectory)) {
      candidates.push(`${docDirectory}${normalizedHref}`);
    }

    return Array.from(new Set(candidates.filter(Boolean)));
  }

  private stripLeadingSlash(href: string): string {
    return href.replace(/^\/+/, '');
  }

  private isRemoteHref(href: string): boolean {
    return /^(https?:\/\/|data:|blob:)/i.test(href.trim());
  }
}

class AssetProvider implements IAssetProvider {
  private readonly container: KmzContainer;
  private readonly objectUrls = new Map<string, string>();

  constructor(container: KmzContainer) {
    this.container = container;
  }

  async getAssetUrl(href: string): Promise<string> {
    if (this.isRemoteHref(href)) {
      return href;
    }

    if (!this.hasAsset(href)) {
      throw new KmzContainerError(`requested asset missing: ${href}`);
    }

    const bytes = await this.getAssetBytes(href);
    const blob = new Blob([bytes as Uint8Array<ArrayBuffer>]);
    const url = URL.createObjectURL(blob);
    this.objectUrls.set(href, url);
    return url;
  }

  async getAssetBytes(href: string): Promise<Uint8Array> {
    if (this.isRemoteHref(href)) {
      throw new KmzContainerError(`remote asset bytes are not packaged: ${href}`);
    }

    if (!this.hasAsset(href)) {
      throw new KmzContainerError(`requested asset missing: ${href}`);
    }

    const bytes = this.container.getAssetBytesInternal(href);
    if (!bytes) {
      throw new KmzContainerError(`requested asset missing: ${href}`);
    }
    return bytes.slice();
  }

  hasAsset(href: string): boolean {
    if (this.isRemoteHref(href)) {
      return false;
    }
    return this.container.hasAssetInternal(href);
  }

  release(href: string): void {
    const url = this.objectUrls.get(href);
    if (url) {
      URL.revokeObjectURL(url);
      this.objectUrls.delete(href);
    }
  }

  dispose(): void {
    for (const url of this.objectUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.objectUrls.clear();
  }

  private isRemoteHref(href: string): boolean {
    return /^(https?:\/\/|data:|blob:)/i.test(href.trim());
  }
}

export function createKmzContainer(): IKmzContainer {
  return new KmzContainer();
}
