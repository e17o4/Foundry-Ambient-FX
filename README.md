# Ambient FX

**Version 1.1.0 development build**

Ambient FX is a Foundry VTT v14 module that adds visual effects to Scene Regions. Effects automatically react to Tokens entering and leaving Regions and can render over the Region itself, over qualifying Tokens, or over the viewer's screen.

> **Development branch:** v1.1.0 is being tested. Stable v1.0.0 remains on `main` until this version is verified.

## What V1.1 adds

- **Fade In / Fade Out** durations in milliseconds.
- **FX Target**:
  - **Region**: the original V1 behavior.
  - **Token(s)**: creates an effect over each qualifying Token currently inside the Region.
  - **Player Screen**: creates a fixed screen-space overlay which does not pan or zoom with the map.
- **Trigger Tokens**:
  - Any Token.
  - Player-Owned Tokens.
  - NPC / Unowned Tokens.
- **Audience**:
  - Everyone.
  - GM Only.
  - Owners of Triggering Token(s).
- Token-targeted FX reconcile independently, so one Token leaving does not restart effects on other Tokens which remain inside.
- Existing V1 Region clipping, opacity, scale, fit modes, scene restoration, and stale-video-load protection remain in place.

## Install for development testing

1. Back up anything important before testing development builds.
2. Extract the `ambient-fx` folder into `FoundryVTT/Data/modules/`, replacing the installed test copy if necessary.
3. Restart Foundry.
4. Enable **Ambient FX** in the world.
5. Create/select a Scene Region and add **Ambient FX** as a Region Behavior.
6. Select an Effect File and test the new Target, Trigger Tokens, Audience, Fade In, and Fade Out settings.

## Settings

- **Effect File**: image or video texture.
- **FX Target**: Region, Token(s), or Player Screen.
- **Trigger Tokens**: Any Token, Player-Owned Tokens, or NPC / Unowned Tokens.
- **Audience**: Everyone, GM Only, or Owners of Triggering Token(s).
- **Opacity**: `0` to `1`.
- **Scale**: `0.1` to `5`.
- **Fit Mode**: Stretch, Cover, or Contain.
- **Fade In (ms)**: transition time when an effect appears.
- **Fade Out (ms)**: transition time when an effect disappears.
- **Clip to Region Shape**: Region target only; masks the effect using the Region polygons.

## Important current limitations

- **Audience / player ownership behavior still needs testing from a separate player client.**
- There is no distance-based falloff yet.
- Region holes may need improved even/odd polygon mask handling.
- Token-targeted effects update to the Token's final location after a within-Region movement animation; truly frame-perfect attachment can be improved later if needed.
- Screen targeting uses Foundry v14's unbound Overlay Canvas Group so the effect stays fixed to the viewer's camera rather than the world map.

## Why module.json has no comments

JSON does not legally support comments. Adding `// comments` to `module.json` would make the manifest invalid and Foundry would refuse to load it. The JavaScript file is therefore heavily commented instead.

## Source layout

```text
ambient-fx/
├─ module.json                Foundry module manifest
├─ README.md                  Setup/testing notes
├─ lang/
│  └─ en.json                 UI labels and hints
└─ scripts/
   └─ ambient-fx.mjs          Region behavior + canvas rendering code
```

## Repository

Source: https://github.com/e17o4/Foundry-Ambient-FX

Stable releases use the manifest and download URLs stored in `module.json`.

## AI Disclaimer

Why yes i did have chat GPT make this for me. why? cause I'm already  learning C, C++, C#, and don't wanna forking learn Javascript on  top of that for a  tool i MOSTLY wanted for my own personal convenience. I couldn't find anything that worked quite the way I wanted. so i asked GPT nicely to make it. keep your anti AI hate to yourself  please. i know. and i don't care. go talk to GPT about it. SPEAKING OF TOOLS if you can make something better then BY ALL MEANS PLEASE FORK THIS AND  DO BETTER! and let me know! i wanna see.
