## zxing-cpp and zxing-wasm C++ glue (Apache-2.0)

zxing-wasm's reader WebAssembly is compiled from zxing-cpp (https://github.com/zxing-cpp/zxing-cpp)
and zxing-wasm's `src/cpp/ZXingWasm.cpp` (https://github.com/Sec-ant/zxing-wasm). Both are licensed
under the Apache License, Version 2.0, whose text follows the Emscripten notice below.

Copyright 2016 Nu-book Inc.
Copyright 2016 ZXing authors
Copyright 2023 Ze-Zheng Wu

## Emscripten runtime and musl libc (MIT)

The same WebAssembly and its JavaScript loader were built with Emscripten (https://emscripten.org),
which links in its runtime and the musl C library. libc++ and libc++abi are also linked in; they are
under Apache-2.0 WITH LLVM-exception, which needs no notice in compiled form.

Copyright (c) 2010-2014 Emscripten authors, see the AUTHORS file in the Emscripten repository.
Copyright (c) 2005-2020 Rich Felker, et al. (musl libc)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Apache License, Version 2.0
