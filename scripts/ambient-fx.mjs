/**
 * Ambient FX - Foundry VTT v14
 * Version 1.0.0
 *
 * WHAT THIS FILE DOES
 * -------------------
 * 1. Registers a new Region Behavior named "Ambient FX".
 * 2. Watches Foundry's Region token-enter and token-exit events.
 * 3. Shows a looping image/video while at least one token is inside the Region.
 * 4. Removes the visual when the Region becomes empty.
 * 5. Rebuilds the visual if the Region boundary or Ambient FX settings change.
 *
 * The comments are intentionally detailed so this file can also function as a
 * learning/reference copy while the module grows.
 */

// ---------------------------------------------------------------------------
// MODULE CONSTANTS
// ---------------------------------------------------------------------------

// This MUST match the "id" in module.json.
const MODULE_ID = "ambient-fx";

// Foundry automatically prefixes module-provided document sub-types with the
// module ID. In module.json we declare "ambient-fx", so Foundry stores the full
// RegionBehavior type as "ambient-fx.ambient-fx".
const BEHAVIOR_TYPE = `${MODULE_ID}.ambient-fx`;


// ---------------------------------------------------------------------------
// AMBIENT FX MANAGER
// ---------------------------------------------------------------------------
//
// Region Behaviors decide WHEN something happens. This manager handles the
// canvas side: loading the image/video, placing it over the Region, masking it,
// and destroying it again later.
//
// Keeping canvas rendering separate from the RegionBehavior class makes future
// versions easier to extend with fades, particles, filters, per-player effects,
// and distance falloff without rewriting the Region event logic.
// ---------------------------------------------------------------------------

class AmbientFXManager {
  /**
   * Stores every visual currently being shown on THIS client's canvas.
   *
   * Key   = RegionBehavior UUID
   * Value = PIXI.Container that owns the sprite and optional mask
   */
  static active = new Map();

  /**
   * Revision numbers cancel stale asynchronous texture loads.
   *
   * Example: a token enters, a large WebM begins loading, then the token exits
   * before loading finishes. Without this guard, the old load could finish late
   * and incorrectly display an effect in an empty Region.
   */
  static revisions = new Map();

  /**
   * Build a stable key for one Ambient FX Region Behavior.
   * @param {foundry.data.regionBehaviors.RegionBehaviorType} system
   * @returns {string|null}
   */
  static getKey(system) {
    return system?.behavior?.uuid ?? null;
  }

  /**
   * Decide whether this effect should currently be visible.
   *
   * V1 rule:
   *   - We must be viewing the Region's Scene.
   *   - The Behavior must be active.
   *   - An effect file must be selected.
   *   - At least ONE token must currently be inside the Region.
   *
   * Foundry v14 maintains RegionDocument.tokens for us, so we do not need to
   * constantly calculate distances or poll token positions ourselves.
   */
  static shouldShow(system) {
    const behavior = system?.behavior;
    const region = system?.region;

    if (!canvas?.ready || !behavior || !region) return false;
    if (canvas.scene?.id !== region.parent?.id) return false;
    if (!behavior.active) return false;
    if (!system.src) return false;

    return region.tokens.size > 0;
  }

  /**
   * Synchronize one behavior with the current state of the Scene.
   *
   * Call this whenever a token enters/exits, the Region is viewed/unviewed,
   * or the Region boundary changes.
   */
  static async refresh(system) {
    const key = this.getKey(system);
    if (!key) return;

    if (!this.shouldShow(system)) {
      this.stop(key);
      return;
    }

    // Rebuilding instead of trying to patch an existing sprite keeps V1
    // predictable when a GM changes source, opacity, scale, fit, or Region size.
    this.stop(key);
    await this.start(system);
  }

  /**
   * Create and display the actual visual effect.
   */
  static async start(system) {
    const key = this.getKey(system);
    const region = system?.region;
    if (!key || !region || !canvas?.ready) return;

    // Every start gets a revision number. If another refresh/stop happens while
    // an asset is loading, that later operation changes the revision and this
    // start request quietly abandons itself when loading finishes.
    const revision = (this.revisions.get(key) ?? 0) + 1;
    this.revisions.set(key, revision);

    // The Region document exposes its world-space bounding rectangle.
    const bounds = region.bounds;
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;

    // Foundry's texture loader supports ordinary image textures AND video
    // textures such as WebM/MP4. We let Foundry handle its own texture cache.
    const loaded = await foundry.canvas.loadTexture(system.src);
    if (!loaded) {
      console.warn(`${MODULE_ID} | Could not load FX texture: ${system.src}`);
      return;
    }

    // IMPORTANT ASYNC SAFETY CHECK:
    // The token may have left, the Scene may have changed, or the GM may have
    // edited the behavior while the file was loading. Never display stale work.
    if (this.revisions.get(key) !== revision || !this.shouldShow(system)) return;

    // loadTexture can theoretically return a Spritesheet. Ambient FX V1 wants
    // one texture, so use the first texture if a sheet was supplied.
    let texture = loaded;
    if (loaded instanceof PIXI.Spritesheet) {
      const firstTexture = Object.values(loaded.textures ?? {})[0];
      if (!firstTexture) {
        console.warn(`${MODULE_ID} | Spritesheet contained no usable textures: ${system.src}`);
        return;
      }
      texture = firstTexture;
    }

    // The container owns everything belonging to this one running effect.
    const container = new PIXI.Container();
    container.name = `AmbientFX.${key}`;
    container.eventMode = "none"; // The FX should never intercept mouse clicks.

    // Create the visual sprite from the chosen image/video texture.
    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5, 0.5);
    sprite.alpha = system.opacity;
    sprite.position.set(bounds.x + (bounds.width / 2), bounds.y + (bounds.height / 2));

    // Size the sprite according to the GM's selected fit mode.
    this.sizeSprite(sprite, texture, bounds, system.fit, system.scale);

    container.addChild(sprite);

    // Optional Region-shaped clipping. Without this, the effect still triggers
    // correctly from the Region but displays using the Region's rectangular
    // bounding box. With clipping enabled, arbitrary Region polygons work too.
    if (system.clipToRegion) {
      const mask = this.createRegionMask(region);
      if (mask) {
        container.addChild(mask);
        sprite.mask = mask;
      }
    }

    // The InterfaceCanvasGroup shares the Scene's world transform, so the FX
    // moves/zooms with the map. addChildAt(..., 0) puts it underneath Foundry's
    // normal interface layers while still leaving it visually above the map.
    //
    // V2 can replace this with a dedicated canvas layer if we decide we need
    // more exact ordering relative to tokens, lighting, and fog-of-war.
    canvas.interface.addChildAt(container, 0);

    // If the source is a video, make sure it loops and is muted. Browsers often
    // block autoplaying audio, and environmental FX should not secretly become
    // a second sound system anyway.
    this.configureVideo(texture);

    this.active.set(key, container);
  }

  /**
   * Resize a sprite to the Region's rectangular bounds.
   *
   * stretch = ignore source aspect ratio and exactly fill bounds
   * cover   = preserve aspect ratio, cover the bounds (cropping as necessary)
   * contain = preserve aspect ratio, fit entirely inside the bounds
   */
  static sizeSprite(sprite, texture, bounds, fit, scale = 1) {
    const safeScale = Number.isFinite(scale) ? Math.max(0.1, scale) : 1;
    const sourceWidth = texture.width || 1;
    const sourceHeight = texture.height || 1;

    if (fit === "stretch") {
      sprite.width = bounds.width * safeScale;
      sprite.height = bounds.height * safeScale;
      return;
    }

    const xScale = bounds.width / sourceWidth;
    const yScale = bounds.height / sourceHeight;
    const fitScale = fit === "contain"
      ? Math.min(xScale, yScale)
      : Math.max(xScale, yScale); // "cover" is the default non-stretch mode.

    sprite.scale.set(fitScale * safeScale);
  }

  /**
   * Create a PIXI mask from Foundry's calculated Region polygons.
   *
   * Foundry already converts circles, rectangles, ellipses, and polygons into
   * polygons for Region geometry. Using those polygons means the rendering code
   * does not need a separate branch for every Region shape tool.
   *
   * NOTE FOR V1:
   * Simple and compound shapes are supported. Regions that deliberately use
   * holes may need more sophisticated even/odd mask handling in a later build.
   */
  static createRegionMask(region) {
    const polygons = region.polygons;
    if (!polygons?.length) return null;

    const mask = new PIXI.Graphics();
    mask.name = `AmbientFX.Mask.${region.id}`;

    for (const polygon of polygons) {
      const points = polygon.points ?? polygon;
      if (!points || points.length < 6) continue;

      // beginFill/drawPolygon/endFill remains available in Foundry's PIXI
      // Graphics implementation and keeps this code compatible with Foundry's
      // current SmoothGraphics extensions.
      mask.beginFill(0xFFFFFF, 1);
      mask.drawPolygon(points);
      mask.endFill();
    }

    return mask;
  }

  /**
   * Configure a video-backed PIXI texture for silent looping playback.
   */
  static configureVideo(texture) {
    // PIXI's internal resource path differs between renderer generations, so
    // these fallbacks intentionally check several known locations.
    const source = texture?.baseTexture?.resource?.source
      ?? texture?.source?.resource?.source
      ?? texture?.source?.resource
      ?? null;

    if (!(source instanceof HTMLVideoElement)) return;

    source.loop = true;
    source.muted = true;
    source.playsInline = true;

    // play() can reject because of browser autoplay rules. Muted video is
    // normally allowed, but catching here prevents a harmless browser rule from
    // turning into a loud console error or breaking the Region event handler.
    source.play().catch((error) => {
      console.debug(`${MODULE_ID} | Video autoplay was deferred by the browser.`, error);
    });
  }

  /**
   * Remove one running effect from the current client's canvas.
   */
  static stop(key) {
    // Invalidate any texture load that may still be in progress for this key.
    this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1);

    const container = this.active.get(key);
    if (!container) return;

    this.active.delete(key);

    // Explicitly detach before destruction. This is defensive and keeps the
    // canvas display tree tidy even if PIXI changes destroy behavior later.
    container.parent?.removeChild(container);

    // Destroy the container and its child Sprite/Mask. The cached Foundry
    // texture itself is intentionally NOT destroyed, so another Region can use
    // the same file without forcing Foundry to reload it from disk.
    container.destroy({children: true});
  }

  /**
   * Remove every Ambient FX visual AND invalidate pending asynchronous loads.
   * Used when changing/tearing down Scenes.
   */
  static stopAll() {
    const keys = new Set([...this.active.keys(), ...this.revisions.keys()]);
    for (const key of keys) this.stop(key);
  }
}


// ---------------------------------------------------------------------------
// CUSTOM REGION BEHAVIOR DATA MODEL
// ---------------------------------------------------------------------------
//
// Foundry's RegionBehaviorType is the base class for behaviors that react to
// Region events. Its static "events" object tells Foundry which events this
// behavior always listens for.
// ---------------------------------------------------------------------------

class AmbientFXRegionBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  /**
   * Tells Foundry where to find automatic field labels/hints in lang/en.json.
   */
  static LOCALIZATION_PREFIXES = ["AMBIENTFX.Behavior"];

  /**
   * Define the settings that appear in the Region Behavior configuration UI.
   */
  static defineSchema() {
    const fields = foundry.data.fields;

    return {
      // FilePathField gives us Foundry's normal file picker and server-side
      // validation. TEXTURE includes both image and video formats.
      src: new fields.FilePathField({
        required: false,
        nullable: false,
        blank: true,
        initial: "",
        categories: ["TEXTURE"]
      }),

      // AlphaField constrains the value to Foundry's normal 0..1 alpha range.
      opacity: new fields.AlphaField({
        required: true,
        nullable: false,
        initial: 0.75
      }),

      // Scale is deliberately capped for V1 so accidental values do not create
      // comically gigantic sprites that cover seventeen counties.
      scale: new fields.NumberField({
        required: true,
        nullable: false,
        initial: 1,
        min: 0.1,
        max: 5,
        step: 0.1
      }),

      // StringField choices automatically render as a select input in Foundry's
      // DataModel-backed configuration forms.
      fit: new fields.StringField({
        required: true,
        nullable: false,
        initial: "cover",
        choices: {
          stretch: "AMBIENTFX.Behavior.FIELDS.fit.choices.stretch",
          cover: "AMBIENTFX.Behavior.FIELDS.fit.choices.cover",
          contain: "AMBIENTFX.Behavior.FIELDS.fit.choices.contain"
        }
      }),

      // A polygon mask makes the visible FX respect the Region boundary instead
      // of only its rectangular bounding box.
      clipToRegion: new fields.BooleanField({
        required: true,
        nullable: false,
        initial: true
      })
    };
  }

  /**
   * Region events handled by this Behavior.
   *
   * TOKEN_ENTER / TOKEN_EXIT are the actual V1 proximity trigger.
   * BEHAVIOR_VIEWED lets an effect restore correctly after loading/reloading a
   * Scene when a token is already standing inside the Region.
   * BEHAVIOR_UNVIEWED makes Scene changes cleanly remove the visual.
   * REGION_BOUNDARY rebuilds the sprite/mask if the GM reshapes the Region.
   */
  static events = {
    tokenEnter: async function () {
      await AmbientFXManager.refresh(this);
    },

    tokenExit: async function () {
      await AmbientFXManager.refresh(this);
    },

    behaviorViewed: async function () {
      await AmbientFXManager.refresh(this);
    },

    behaviorUnviewed: async function () {
      const key = AmbientFXManager.getKey(this);
      if (key) AmbientFXManager.stop(key);
    },

    regionBoundary: async function () {
      await AmbientFXManager.refresh(this);
    }
  };

  /**
   * If the GM edits the Ambient FX settings while it is running, redraw it with
   * the new values immediately instead of waiting for a token to leave/re-enter.
   */
  _onUpdate(changed, options, userId) {
    super._onUpdate(changed, options, userId);
    AmbientFXManager.refresh(this);
  }
}


// ---------------------------------------------------------------------------
// FOUNDRY HOOKS / REGISTRATION
// ---------------------------------------------------------------------------

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing Ambient FX v1.0.0`);

  // Register the DataModel for the RegionBehavior subtype declared in
  // module.json. Without this registration, Foundry knows the subtype exists
  // but does not know what settings/data it contains or how it behaves.
  CONFIG.RegionBehavior.dataModels[BEHAVIOR_TYPE] = AmbientFXRegionBehaviorType;

  // These are cosmetic helpers for Region Behavior selection/configuration.
  // The localization key supplies the human-readable name "Ambient FX".
  CONFIG.RegionBehavior.typeLabels[BEHAVIOR_TYPE] = `TYPES.RegionBehavior.${BEHAVIOR_TYPE}`;
  CONFIG.RegionBehavior.typeIcons[BEHAVIOR_TYPE] = "fa-solid fa-wand-magic-sparkles";
});

// Scene teardown destroys Foundry's canvas groups. Clean our references first
// so the manager never holds dead PIXI objects after a Scene change/reload.
Hooks.on("canvasTearDown", () => {
  AmbientFXManager.stopAll();
});

// Expose a tiny debugging API. This is handy while developing in the browser
// console and costs us essentially nothing.
Hooks.once("ready", () => {
  const module = game.modules.get(MODULE_ID);
  if (module) {
    module.api = {
      refresh: (behaviorSystem) => AmbientFXManager.refresh(behaviorSystem),
      stopAll: () => AmbientFXManager.stopAll(),
      active: AmbientFXManager.active
    };
  }
});
