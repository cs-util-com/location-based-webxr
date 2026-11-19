/**
 * A tour open on the page, as a creator's AR start needs (only an open
 * tour keeps a draft on this phone, so a start with none is refused):
 * its zip holds no codes and nothing is read from it. A test that needs
 * the hosted file opens one over it.
 */
export function openTourWithNothingRead(): never {
  return {
    archive: { url: "https://example.test/tour.zip", size: 0 },
    hostedFileName: () => null,
    entries: [],
    loadEntryText: () => Promise.reject(new Error("no such entry")),
    readWholeArchive: () => Promise.reject(new Error("not read here")),
  } as never;
}
