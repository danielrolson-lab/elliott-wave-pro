# App Icon Specification — Elliott Wave Pro

## Design

- **Background**: True OLED black (#000000)
- **Foreground**: White wave symbol (Elliott Wave 1-2-3-4-5 simplified zigzag)
- **Text**: "EW PRO" in white, Helvetica Neue Bold, bottom quarter of icon
- **Size**: 1024×1024 px master (required for App Store)

## Required iOS Sizes

| Usage | Size |
|-------|------|
| App Store | 1024×1024 |
| iPhone @3x | 180×180 |
| iPhone @2x | 120×120 |
| iPad @2x | 152×152 |
| iPad Pro @2x | 167×167 |
| Settings @3x | 87×87 |
| Notification @3x | 60×60 |

Expo auto-generates all required sizes from `assets/icon.png` (1024×1024).

## Required Android Sizes

| Usage | Size |
|-------|------|
| Play Store | 512×512 |
| hdpi | 72×72 |
| mdpi | 48×48 |
| xhdpi | 96×96 |
| xxhdpi | 144×144 |
| xxxhdpi | 192×192 |

Adaptive icon:
- Foreground (with safe zone): `assets/android-icon-foreground.png` 1024×1024
- Background: solid black `assets/android-icon-background.png`

## Splash Screen

- Background color: #000000
- Image: wave logo (no text) centered, 512×512 px
- `assets/splash-icon.png` — referenced in `app.json`

## Generation

Run `npx expo install expo-image` then use the Expo icon generation tool:
```bash
npx expo-optimize --quality 80
```

Or generate with ImageMagick:
```bash
# Master icon (placeholder — replace with designer asset)
convert -size 1024x1024 xc:black \
  -fill white \
  -draw "polyline 100,700 250,400 400,550 550,250 700,450 850,150" \
  -strokewidth 18 -stroke white -fill none \
  -draw "polyline 100,700 250,400 400,550 550,250 700,450 850,150" \
  -pointsize 80 -gravity South -annotate +0+60 "EW PRO" \
  assets/icon.png
```
