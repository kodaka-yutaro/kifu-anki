# Piece fonts

These self-hosted subsets are used only for the shogi-piece glyphs. They contain
`玉王将飛車龍角行馬金銀桂香歩兵成と全圭杏` and a space. No external font service is contacted at runtime.

Both fonts are distributed under the SIL Open Font License 1.1. Copyright and
license metadata are retained in the WOFF files, and the complete licenses are
included alongside them. The subset family names are changed to **Kifu Rounded**
and **Kifu Brush** to distinguish these modified fonts from the original families.

## M PLUS Rounded 1c Bold → Kifu Rounded

- Copyright 2016 The Rounded M+ Project Authors.
- Weight: 700.
- Original: https://github.com/google/fonts/blob/47d54ca1ebb14fd864695f1d39dc734f39017c33/ofl/mplusrounded1c/MPLUSRounded1c-Bold.ttf
- License: [OFL-Rounded-Mplus.txt](OFL-Rounded-Mplus.txt).
- Official license source: https://github.com/google/fonts/blob/47d54ca1ebb14fd864695f1d39dc734f39017c33/ofl/roundedmplus1c/OFL.txt
- The original binary's internal family name is `Rounded Mplus 1c`; Google Fonts
  presents it as `M PLUS Rounded 1c`. Its embedded copyright and OFL statements
  agree with the license above.
- Original SHA-256: `c358630584e8e2d8fbd6121d0f4693255ffef6d1e6d4f3441fd6e5a963a11f9e`.

## Yuji Syuku Regular → Kifu Brush

- Copyright 2021 The Yuji Project Authors (https://github.com/Kinutafontfactory/Yuji).
- Weight: 400.
- Original: https://github.com/google/fonts/blob/47d54ca1ebb14fd864695f1d39dc734f39017c33/ofl/yujisyuku/YujiSyuku-Regular.ttf
- License: [OFL-Yuji-Syuku.txt](OFL-Yuji-Syuku.txt).
- Official license source: https://github.com/google/fonts/blob/47d54ca1ebb14fd864695f1d39dc734f39017c33/ofl/yujisyuku/OFL.txt
- Original SHA-256: `82728ebafc8c97391e2dab633414a806f344b8e4e2227d307179f07b548fca61`.

## Subsetting

Generated with fontTools. Keep only the character set above, disable unneeded
OpenType layout features (the app renders horizontal glyphs on separate lines),
retain all name and license records, rename family/full/PostScript names to the
Kifu subset names, and save as WOFF. WOFF uses built-in zlib compression and adds
no Brotli build dependency. Both outputs were reopened to verify complete glyph
coverage and unrestricted embedding (`OS/2.fsType = 0`).
