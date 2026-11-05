Vendored barcode decoder (used when the browser has no native BarcodeDetector, e.g. iPhone Safari).

- barcode-detector.js  = barcode-detector@3.2.3 dist/iife/ponyfill.js (MIT, https://github.com/Sec-ant/barcode-detector)
- zxing_reader.wasm    = zxing-wasm@3.1.6 dist/reader (MIT, https://github.com/Sec-ant/zxing-wasm; ZXing-C++ Apache-2.0)

To update: npm i barcode-detector, copy those two files, and keep the zxing-wasm version the polyfill expects.
