# Ambient FX

**Version 1.0.0**

Ambient FX is a Foundry VTT v14 module that adds visual effects to Scene Regions. Effects automatically activate when a token enters a Region and stop when the last token leaves, allowing for localized fog, particles, magical effects, environmental animations, and more.

> **Work in progress:** V1 is an early prototype intended for testing.

## What V1 does

- Add **Ambient FX** to a Scene Region.
- Choose an image or video texture.
- When the first token enters the Region, the visual appears.
- It stays active while one or more tokens remain inside.
- When the final token exits, the visual disappears.
- The visual can be clipped to the actual Region polygon.
- Images and looping video textures such as transparent `.webm` are supported.

## Install for local testing

1. Extract the `ambient-fx` folder into `FoundryVTT/Data/modules/`.
2. Restart Foundry if it is running.
3. Enable **Ambient FX** in your world's Manage Modules window.
4. Open a Scene and create/select a **Region**.
5. Add a Region Behavior and choose **Ambient FX**.
6. Pick an Effect File and save the behavior.
7. Move a token into the Region.

## V1 settings

- **Effect File**: image or video texture.
- **Opacity**: `0` to `1`.
- **Scale**: `0.1` to `5`.
- **Fit Mode**:
  - **Stretch**: exactly matches the Region bounds.
  - **Cover**: keeps aspect ratio and fills the Region bounds.
  - **Contain**: keeps aspect ratio and fits inside the Region bounds.
- **Clip to Region Shape**: masks the effect using the Region polygons.

## Important V1 limitations

- The visual activates for everyone viewing the Scene when **any token** is in the Region.
- There is no fade-in/fade-out yet.
- There is no per-player visibility yet.
- There is no distance falloff yet.
- Region holes may need improved even/odd polygon mask handling.
- The visual currently lives in Foundry's Interface canvas group. V2 can introduce a dedicated rendering layer if we want more exact ordering with tokens, lighting, and fog-of-war.

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

The release manifest and download URLs in `module.json` point at GitHub Releases. They will become usable by Foundry once a release containing `module.json` and `module.zip` is published.

## AI Disclaimer

Why yes i did have chat GPT make this for me. why? cause I'm already  learning C, C++, C#, and don't wanna forking learn Javascript on  top of that for a  tool i MOSTLY wanted for my own personal convenience. no one else made it as far as I'm aware. so i asked GPT nicely to make it. keep your anti AI hate to yourself  please. i know. and i don't care. go talk to GPT about it. SPEAKING OF TOOLS if you can make something better then BY ALL MEANS PLEASE FORK THIS AND  DO BETTER! and let me know! i wanna see.
