# Asset optimizer fixtures - sources and licences

Real recordings and a real photo for `editor-asset-optimizers.spec.js` and
the asset optimizer check page (`asset-optimizer-check.html`), which
imports them by URL. Every file is in the public domain or under CC0, each
verified on its own source page on 2026-11-13. Trims and crops were made
with FFmpeg; the commands are given per file.

Total: 2,963,500 bytes (about 2.8 MiB) for five files.

## speech-de-frau-holle.mp3 (German speech, mono)

- Work: "Frau Holle", Kinder- und Hausmärchen, Jacob and Wilhelm Grimm
  (1785-1863 and 1786-1859), text of the 1812/15 first edition (from
  zeno.org), so the text is in the public domain in Germany as well.
- Recording: LibriVox, "Kinder- und Hausmärchen (1812/15) Teil 1",
  section 12, read by the LibriVox volunteer credited as "Crln Yldz Ksr".
- Source page: https://librivox.org/kinder-und-hausmarchen-181215-teil-1-by-jacob-wilhelm-grimm/
- Archive item: https://archive.org/details/kinder_hausmaerchen_1206_librivox
- File: https://www.archive.org/download/kinder_hausmaerchen_1206_librivox/kinderundhausmaerchen1_12_frauholle_grimm_64kb.mp3
  (MP3, 22,050 Hz, mono, 64 kbps, 339.2 s, 2,714,902 bytes).
- Licence: CC0 1.0 public domain dedication. Evidence: the archive item's
  `licenseurl` is http://creativecommons.org/publicdomain/zero/1.0/;
  LibriVox recordings are public domain.
- Trim: 20 s from 30 s (past the LibriVox introduction), MP3 frames copied
  unchanged, tags removed:
  `ffmpeg -ss 30 -t 20 -i <file> -map 0:a -map_metadata -1 -c copy`.
  160,330 bytes, 20.01 s.

## speech-en-the-raven.mp3 (English speech, mono)

- Work: "The Raven", Edgar Allan Poe (1809-1849), text from Project
  Gutenberg (https://www.gutenberg.org/etext/14082).
- Recording: LibriVox, read by Chris Goringe.
- Source page: https://librivox.org/the-raven-by-edgar-allan-poe/
- Archive item: https://archive.org/details/raven
- File: https://archive.org/download/raven/raven_poe.mp3
  (MP3, 44,100 Hz, mono, 128 kbps, 570.9 s, 9,134,625 bytes).
- Licence: CC0 1.0 public domain dedication. Evidence: the archive item's
  `licenseurl` is http://creativecommons.org/publicdomain/zero/1.0/.
- Trim: 20 s from 40 s, MP3 frames copied unchanged, tags removed:
  `ffmpeg -ss 40 -t 20 -i <file> -map 0:a -map_metadata -1 -c copy`.
  320,618 bytes, 20.01 s.

## music-piano-schubert-d664.flac (piano, stereo)

- Work: Franz Schubert (1797-1828), Piano Sonata No. 13 in A major, D 664,
  II. Andante.
- Recording: Musopen (2012), played by Paul Pitman.
- Source page: https://commons.wikimedia.org/wiki/File:Schubert_-_Piano_Sonata_No._13_in_A_major,_D664_-_II._Andante_(Paul_Pitman).flac
- File: https://upload.wikimedia.org/wikipedia/commons/d/df/Schubert_-_Piano_Sonata_No._13_in_A_major%2C_D664_-_II._Andante_%28Paul_Pitman%29.flac
  (FLAC, 44,100 Hz, stereo, 24-bit, 290.84 s, 15,055,413 bytes).
- Licence: public domain. Evidence, the file page's
  `{{Copyright information}}` template: recording
  `{{PD-author|[https://musopen.org/ Musopen]}}`, musical composition
  `{{PD-old-auto-expired|deathyear=1828}}`; source
  `{{Musopen|https://musopen.org/music/7269-piano-sonata-in-a-major-d-664/}}`.
- Trim: 15 s from 20 s, reduced from 24 to 16 bits per sample (to keep the
  file small), sample rate unchanged, tags removed:
  `ffmpeg -ss 20 -t 15 -i <file> -map_metadata -1 -sample_fmt s16 -compression_level 12`.
  735,842 bytes.

## music-orchestra-egmont.flac (orchestra, stereo)

- Work: Ludwig van Beethoven (1770-1827), Egmont Overture, Op. 84.
- Recording: Musopen (2012), Musopen Symphony.
- Source page: https://commons.wikimedia.org/wiki/File:Beethoven_-_Egmont_Overture,_Op._84_(Musopen_Symphony).flac
- File: https://upload.wikimedia.org/wikipedia/commons/8/85/Beethoven_-_Egmont_Overture%2C_Op._84_%28Musopen_Symphony%29.flac
  (FLAC, 48,000 Hz, stereo, 24-bit, 540.9 s, 94,777,164 bytes).
- Licence: public domain. Evidence, the file page's
  `{{Copyright information}}` template: recording
  `{{PD-author|[https://musopen.org/ Musopen]}}`, musical composition
  `{{PD-old-auto-expired|deathyear=1827}}`; source
  `{{Musopen|https://musopen.org/music/13441}}`.
- Trim: 15 s from 60 s, reduced from 24 to 16 bits per sample, sample rate
  unchanged, tags removed:
  `ffmpeg -ss 60 -t 15 -i <file> -map_metadata -1 -sample_fmt s16 -compression_level 12`.
  928,098 bytes.

## photo-oberammergau-street.jpg (outdoor photo, 2400 x 1800)

- Subject: Dorfstraße 20, Oberammergau, Bavaria, Germany: a painted
  facade, windows, flags, a parked car, signs, foliage and sky.
- Author: Jebulon (Wikimedia Commons user), taken 2013-10-20.
- Source page: https://commons.wikimedia.org/wiki/File:Dorfstrasse_20,_Oberammergau,_Bavaria,_Germany.jpg
- File: https://upload.wikimedia.org/wikipedia/commons/f/f8/Dorfstrasse_20%2C_Oberammergau%2C_Bavaria%2C_Germany.jpg
  (JPEG, 4516 x 3384, 15.3 MP, 14,796,912 bytes).
- Licence: CC0 1.0. Evidence: the file page's licence template is
  `{{self|cc-zero}}`, source `{{own}}`.
- Crop: the full photo is 14.8 MB, far over the fixtures' size budget, so
  a 2400 x 1800 crop of the lower right (camera pixels, not scaled; 4:3 as
  the original) was re-encoded as a JPEG at FFmpeg quality 3, which also
  drops the metadata:
  `ffmpeg -i <file> -vf crop=2400:1800:2116:1584 -q:v 3`.
  818,612 bytes. Its longest side is larger than every side the tests ask
  for, so each of them scales the picture down.
