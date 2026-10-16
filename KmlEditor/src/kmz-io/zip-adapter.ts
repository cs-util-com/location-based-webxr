import {
  BlobReader,
  BlobWriter,
  Uint8ArrayReader,
  ZipReader,
  ZipWriter,
} from '@zip.js/zip.js';
import type { ZipArchiveEntry } from '../contracts/type';

export interface ZipAdapter {
  readArchive(bytes: Uint8Array): Promise<Map<string, Uint8Array>>;
  writeArchive(entries: readonly ZipArchiveEntry[]): Promise<Uint8Array>;
}

export class SimpleZipAdapter implements ZipAdapter {
  async readArchive(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
    const reader = new ZipReader(new BlobReader(new Blob([bytes as Uint8Array<ArrayBuffer>])));
    try {
      const archive = new Map<string, Uint8Array>();
      const entries = await reader.getEntries();

      for (const entry of entries) {
        if (entry.directory) {
          continue;
        }

        const blob = await entry.getData(new BlobWriter());
        const filename = entry.filename.replace(/\\/g, '/');
        archive.set(filename, new Uint8Array(await blob.arrayBuffer()));
      }

      return archive;
    } finally {
      await reader.close();
    }
  }

  async writeArchive(entries: readonly ZipArchiveEntry[]): Promise<Uint8Array> {
    const writer = new ZipWriter(new BlobWriter('application/zip'));
    try {
      for (const entry of entries) {
        await writer.add(entry.path, new Uint8ArrayReader(entry.data));
      }

      const blob = await writer.close();
      return new Uint8Array(await blob.arrayBuffer());
    } catch (error) {
      await writer.close().catch(() => undefined);
      throw error;
    }
  }
}
