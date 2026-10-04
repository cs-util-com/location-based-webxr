# Third-party notices

The QR demo ships the following third-party code. It is loaded only behind the
`?qrperf=zxing` debug flag (see `src/qrperf/zxing-probe.ts.md`); nothing from it
is in the demo's main chunk.

## zxing-wasm 3.1.4 (reader build)

- **What is shipped:** the JavaScript glue `zxing-wasm/reader` and the binary
  `zxing_reader.wasm`, served from this app's own origin
  (`/qr-demo/assets/zxing_reader-<hash>.wasm`), never from a CDN.
- **Source:** <https://github.com/Sec-ant/zxing-wasm>
- **Licences, as the package's README states them:**
  - zxing-wasm's own code (the JavaScript glue): MIT License, Copyright (c)
    2023 Ze-Zheng Wu.
  - [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp), compiled into the
    `.wasm`: [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).
  - zxing-wasm's `src/cpp/ZXingWasm.cpp` binding, compiled into the `.wasm`:
    Apache License 2.0.
- The npm package ships only its MIT `LICENSE` file; the Apache-2.0 notices
  above are recorded here because the demo redistributes the compiled binary.
- The package also contains zint (BSD 3-Clause), which serves the WRITER build;
  the demo imports the reader build only.
