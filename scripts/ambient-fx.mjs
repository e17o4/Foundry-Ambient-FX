/**
 * Ambient FX - Foundry VTT v14
 * Version 1.1.0-dev
 *
 * WHAT THIS FILE DOES
 * -------------------
 * 1. Registers a custom Region Behavior named "Ambient FX".
 * 2. Uses Foundry's Region token events instead of polling token distance.
 * 3. Can render the chosen image/video over the Region, over Tokens inside it,
 *    or over the viewer's screen.
 * 4. Can limit which Tokens trigger an effect by player ownership.
 * 5. Can limit who sees an effect: everyone, GMs, or owners of triggering Tokens.
 * 6. Fades effects in and out instead of instantly popping them on/off.
 * 7. Keeps the V1 safety checks which cancel stale asynchronous texture loads.
 *
 * Comments are intentionally detailed. The module was built as a practical tool,
 * but the source should still be readable enough to learn from and modify later.
 */

const MODULE_ID = "ambient-fx";
const BEHAVIOR_TYPE = `${MODULE_ID}.ambient-fx`;
const CanvasAnimation = foundry.canvas.animation.CanvasAnimation;

class AmbientFXManager {
  // Running effects on THIS client. Region/Screen normally have one instance;
  // Token targeting can have one instance for every qualifying Token.
  static active = new Map();

  // Revision numbers cancel stale asynchronous texture loads.
  static revisions = new Map();

  static getKey(system) {
    return system?.behavior?.uuid ?? null;
  }

  // Checks which must pass regardless of target/audience mode.
  static isBaseEligible(system) {
    const behavior = system?.behavior;
    const region = system?.region;

    if (!canvas?.ready || !behavior || !region) return false;
    if (canvas.scene?.id !== region.parent?.id) return false;
    if (!behavior.active) return false;
    if (!system.src) return false;
    return true;
  }

  // Decide whether a Token is ALLOWED TO TRIGGER the Region.
  static tokenPassesTrigger(system, token) {
    switch (system.triggerOwnership) {
      case "playerOwned":
        return Boolean(token?.hasPlayerOwner);
      case "unowned":
        return !token?.hasPlayerOwner;
      case "any":
      default:
        return true;
    }
  }

  static getTriggerTokens(system) {
    const tokens = system?.region?.tokens;
    if (!tokens) return [];
    return [...tokens].filter((token) => this.tokenPassesTrigger(system, token));
  }

  // Determine whether THIS BROWSER is allowed to see the effect at all.
  static clientPassesAudience(system, triggerTokens) {
    switch (system.audience) {
      case "gm":
        return Boolean(game.user?.isGM);
      case "owners":
        return triggerTokens.some((token) => Boolean(token?.isOwner));
      case "everyone":
      default:
        return true;
    }
  }

  // Tokens which should actually receive a Token-targeted visual on THIS client.
  static getRenderableTokens(system, triggerTokens) {
    if (system.audience === "gm") {
      return game.user?.isGM ? triggerTokens : [];
    }
    if (system.audience === "owners") {
      return triggerTokens.filter((token) => Boolean(token?.isOwner));
    }
    return triggerTokens;
  }

  static shouldShow(system) {
    if (!this.isBaseEligible(system)) return false;
    const triggerTokens = this.getTriggerTokens(system);
    if (triggerTokens.length === 0) return false;
    return this.clientPassesAudience(system, triggerTokens);
  }

  /** Synchronize one behavior with current Scene state. */
  static async refresh(system, {rebuild = false} = {}) {
    const key = this.getKey(system);
    if (!key) return;

    if (!this.shouldShow(system)) {
      await this.stopBehavior(key, system?.fadeOut ?? 0);
      return;
    }

    let entry = this.active.get(key);
    const needsRebuild = rebuild
      || !entry
      || entry.target !== system.target
      || entry.src !== system.src;

    if (needsRebuild) {
      // Configuration rebuilds are immediate; the replacement performs fade-in.
      if (entry) await this.stopBehavior(key, 0);
      entry = await this.startBehavior(system);
      if (!entry) return;
    }

    // Token mode reconciles children without restarting Tokens that stayed inside.
    if (system.target === "token") {
      await this.syncTokenInstances(entry, system);
      return;
    }

    // Region/Screen use one persistent instance while any qualifying Token remains.
    const instance = entry.instances.get("main");
    if (instance) this.updateInstanceLayout(instance, system);
  }

  /** Load the texture and create the runtime entry for one behavior. */
  static async startBehavior(system) {
    const key = this.getKey(system);
    if (!key || !canvas?.ready) return null;

    const revision = (this.revisions.get(key) ?? 0) + 1;
    this.revisions.set(key, revision);

    const loaded = await foundry.canvas.loadTexture(system.src);
    if (!loaded) {
      console.warn(`${MODULE_ID} | Could not load FX texture: ${system.src}`);
      return null;
    }

    // Do not display work which became stale while loading.
    if (this.revisions.get(key) !== revision || !this.shouldShow(system)) return null;

    let texture = loaded;
    if (loaded instanceof PIXI.Spritesheet) {
      const firstTexture = Object.values(loaded.textures ?? {})[0];
      if (!firstTexture) {
        console.warn(`${MODULE_ID} | Spritesheet contained no usable textures: ${system.src}`);
        return null;
      }
      texture = firstTexture;
    }

    this.configureVideo(texture);

    const entry = {
      system,
      target: system.target,
      src: system.src,
      texture,
      instances: new Map()
    };
    this.active.set(key, entry);

    if (system.target === "token") {
      await this.syncTokenInstances(entry, system);
    }
    else {
      const instance = this.createInstance(system, texture, {instanceKey: "main"});
      if (instance) {
        entry.instances.set("main", instance);
        this.fadeInstance(instance, 1, system.fadeIn);
      }
    }

    return entry;
  }

  /** Reconcile Token-targeted visuals with Tokens currently inside. */
  static async syncTokenInstances(entry, system) {
    const triggerTokens = this.getTriggerTokens(system);
    const renderableTokens = this.getRenderableTokens(system, triggerTokens);
    const desiredIds = new Set(renderableTokens.map((token) => token.id));

    // Fade/remove Tokens which left or no longer satisfy the filters.
    for (const [tokenId, instance] of [...entry.instances.entries()]) {
      if (desiredIds.has(tokenId)) continue;
      entry.instances.delete(tokenId);
      this.destroyInstance(instance, system.fadeOut);
    }

    // Create missing child visuals and reposition existing ones.
    for (const token of renderableTokens) {
      let instance = entry.instances.get(token.id);
      if (!instance) {
        instance = this.createInstance(system, entry.texture, {
          instanceKey: token.id,
          token
        });
        if (!instance) continue;
        entry.instances.set(token.id, instance);
        this.fadeInstance(instance, 1, system.fadeIn);
      }
      else {
        instance.token = token;
        this.updateInstanceLayout(instance, system);
      }
    }
  }

  /** Create one PIXI Sprite container for a Region, Token, or Screen target. */
  static createInstance(system, texture, {instanceKey, token = null}) {
    const behaviorKey = this.getKey(system);
    if (!behaviorKey) return null;

    const container = new PIXI.Container();
    container.name = `AmbientFX.${behaviorKey}.${instanceKey}`;
    container.eventMode = "none";
    container.alpha = 0; // Fade-in starts invisible.

    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5, 0.5);
    sprite.alpha = system.opacity;
    container.addChild(sprite);

    const instance = {key: instanceKey, container, sprite, token};

    // Polygon clipping applies only to Region target mode.
    if (system.target === "region" && system.clipToRegion) {
      const mask = this.createRegionMask(system.region);
      if (mask) {
        container.addChild(mask);
        sprite.mask = mask;
        instance.mask = mask;
      }
    }

    // canvas.overlay is not bound to the map world transform, making it suitable
    // for screen-space FX. Region/Token targets stay in world space.
    if (system.target === "screen") canvas.overlay.addChild(container);
    else canvas.interface.addChildAt(container, 0);

    this.updateInstanceLayout(instance, system);
    return instance;
  }

  /** Update one instance's position/size without recreating its texture. */
  static updateInstanceLayout(instance, system) {
    if (!instance?.sprite) return;

    let bounds;
    if (system.target === "screen") bounds = this.getScreenBounds();
    else if (system.target === "token") bounds = this.getTokenBounds(instance.token);
    else bounds = system?.region?.bounds ?? null;

    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;

    instance.sprite.position.set(
      bounds.x + (bounds.width / 2),
      bounds.y + (bounds.height / 2)
    );
    this.sizeSprite(instance.sprite, instance.sprite.texture, bounds, system.fit, system.scale);
  }

  /** World-space bounds for one Token, with a document-size fallback. */
  static getTokenBounds(token) {
    const placeableBounds = token?.object?.bounds;
    if (placeableBounds) {
      return new PIXI.Rectangle(
        placeableBounds.x,
        placeableBounds.y,
        placeableBounds.width,
        placeableBounds.height
      );
    }

    if (!token) return null;
    const size = token.getSize?.() ?? {width: 0, height: 0};
    return new PIXI.Rectangle(token.x ?? 0, token.y ?? 0, size.width, size.height);
  }

  /** Screen-space bounds for Foundry's current WebGL renderer. */
  static getScreenBounds() {
    const dimensions = canvas?.screenDimensions ?? [];
    const width = Number(dimensions[0]) || canvas?.app?.renderer?.screen?.width || 0;
    const height = Number(dimensions[1]) || canvas?.app?.renderer?.screen?.height || 0;
    return new PIXI.Rectangle(0, 0, width, height);
  }

  /** Resize a sprite to arbitrary rectangular bounds. */
  static sizeSprite(sprite, texture, bounds, fit, scale = 1) {
    const safeScale = Number.isFinite(scale) ? Math.max(0.1, scale) : 1;
    const sourceWidth = texture.width || 1;
    const sourceHeight = texture.height || 1;

    if (fit === "stretch") {
      sprite.scale.set(1);
      sprite.width = bounds.width * safeScale;
      sprite.height = bounds.height * safeScale;
      return;
    }

    const xScale = bounds.width / sourceWidth;
    const yScale = bounds.height / sourceHeight;
    const fitScale = fit === "contain"
      ? Math.min(xScale, yScale)
      : Math.max(xScale, yScale);
    sprite.scale.set(fitScale * safeScale);
  }

  /** Build a PIXI mask from Foundry's calculated Region polygons. */
  static createRegionMask(region) {
    const polygons = region?.polygons;
    if (!polygons?.length) return null;

    const mask = new PIXI.Graphics();
    mask.name = `AmbientFX.Mask.${region.id}`;

    for (const polygon of polygons) {
      const points = polygon.points ?? polygon;
      if (!points || points.length < 6) continue;
      mask.beginFill(0xFFFFFF, 1);
      mask.drawPolygon(points);
      mask.endFill();
    }
    return mask;
  }

  /** Configure a video-backed texture for silent looping playback. */
  static configureVideo(texture) {
    const source = texture?.baseTexture?.resource?.source
      ?? texture?.source?.resource?.source
      ?? texture?.source?.resource
      ?? null;

    if (!(source instanceof HTMLVideoElement)) return;
    source.loop = true;
    source.muted = true;
    source.playsInline = true;
    source.play().catch((error) => {
      console.debug(`${MODULE_ID} | Video autoplay was deferred by the browser.`, error);
    });
  }

  /** Fade one child container. Duration is milliseconds. */
  static async fadeInstance(instance, to, duration = 0) {
    const container = instance?.container;
    if (!container || container.destroyed) return false;

    const safeDuration = Math.max(0, Number(duration) || 0);
    if (safeDuration === 0) {
      container.alpha = to;
      return true;
    }

    const animationName = `${MODULE_ID}.${container.name}.fade`;
    try {
      return await CanvasAnimation.animate(
        [{parent: container, attribute: "alpha", to}],
        {
          duration: safeDuration,
          easing: "easeInOutCosine",
          name: animationName,
          context: container
        }
      );
    }
    catch (error) {
      console.debug(`${MODULE_ID} | Fade animation ended early.`, error);
      return false;
    }
  }

  /** Fade and destroy one child instance. */
  static async destroyInstance(instance, fadeOut = 0) {
    if (!instance?.container || instance.container.destroyed) return;
    await this.fadeInstance(instance, 0, fadeOut);
    if (!instance.container || instance.container.destroyed) return;
    instance.container.parent?.removeChild(instance.container);
    instance.container.destroy({children: true});
  }

  /** Stop every visual belonging to one Region Behavior. */
  static async stopBehavior(key, fadeOut = 0) {
    this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1);

    const entry = this.active.get(key);
    if (!entry) return;

    // Remove immediately so a re-enter can start fresh while old FX fade out.
    this.active.delete(key);
    const instances = [...entry.instances.values()];
    entry.instances.clear();
    await Promise.all(instances.map((instance) => this.destroyInstance(instance, fadeOut)));
  }

  /** Immediate cleanup during Scene teardown. */
  static stopAll() {
    const keys = new Set([...this.active.keys(), ...this.revisions.keys()]);
    for (const key of keys) {
      this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1);
      const entry = this.active.get(key);
      if (!entry) continue;
      this.active.delete(key);

      for (const instance of entry.instances.values()) {
        const container = instance?.container;
        if (!container || container.destroyed) continue;
        container.parent?.removeChild(container);
        container.destroy({children: true});
      }
      entry.instances.clear();
    }
  }

  /** Re-fit fixed screen overlays after viewport changes. */
  static updateScreenTargets() {
    for (const entry of this.active.values()) {
      if (entry.target !== "screen") continue;
      const instance = entry.instances.get("main");
      if (instance) this.updateInstanceLayout(instance, entry.system);
    }
  }
}

class AmbientFXRegionBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static LOCALIZATION_PREFIXES = ["AMBIENTFX.Behavior"];

  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      src: new fields.FilePathField({
        required: false,
        nullable: false,
        blank: true,
        initial: "",
        categories: ["TEXTURE"]
      }),

      target: new fields.StringField({
        required: true,
        nullable: false,
        initial: "region",
        choices: {
          region: "AMBIENTFX.Behavior.FIELDS.target.choices.region",
          token: "AMBIENTFX.Behavior.FIELDS.target.choices.token",
          screen: "AMBIENTFX.Behavior.FIELDS.target.choices.screen"
        }
      }),

      triggerOwnership: new fields.StringField({
        required: true,
        nullable: false,
        initial: "any",
        choices: {
          any: "AMBIENTFX.Behavior.FIELDS.triggerOwnership.choices.any",
          playerOwned: "AMBIENTFX.Behavior.FIELDS.triggerOwnership.choices.playerOwned",
          unowned: "AMBIENTFX.Behavior.FIELDS.triggerOwnership.choices.unowned"
        }
      }),

      audience: new fields.StringField({
        required: true,
        nullable: false,
        initial: "everyone",
        choices: {
          everyone: "AMBIENTFX.Behavior.FIELDS.audience.choices.everyone",
          gm: "AMBIENTFX.Behavior.FIELDS.audience.choices.gm",
          owners: "AMBIENTFX.Behavior.FIELDS.audience.choices.owners"
        }
      }),

      opacity: new fields.AlphaField({
        required: true,
        nullable: false,
        initial: 0.75
      }),

      scale: new fields.NumberField({
        required: true,
        nullable: false,
        initial: 1,
        min: 0.1,
        max: 5,
        step: 0.1
      }),

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

      fadeIn: new fields.NumberField({
        required: true,
        nullable: false,
        initial: 500,
        min: 0,
        max: 60000,
        step: 100
      }),

      fadeOut: new fields.NumberField({
        required: true,
        nullable: false,
        initial: 500,
        min: 0,
        max: 60000,
        step: 100
      }),

      // Region target only. Token/Screen modes intentionally ignore this field.
      clipToRegion: new fields.BooleanField({
        required: true,
        nullable: false,
        initial: true
      })
    };
  }

  static events = {
    tokenEnter: async function () {
      await AmbientFXManager.refresh(this);
    },

    tokenExit: async function () {
      await AmbientFXManager.refresh(this);
    },

    // Reposition Token FX after movement that stays within the Region.
    tokenMoveWithin: async function (event) {
      const ended = event?.data?.movement?.animation?.ended;
      if (ended?.then) await ended;
      await AmbientFXManager.refresh(this);
    },

    behaviorViewed: async function () {
      await AmbientFXManager.refresh(this);
    },

    behaviorUnviewed: async function () {
      const key = AmbientFXManager.getKey(this);
      if (key) await AmbientFXManager.stopBehavior(key, 0);
    },

    regionBoundary: async function () {
      await AmbientFXManager.refresh(this, {rebuild: true});
    }
  };

  _onUpdate(changed, options, userId) {
    super._onUpdate(changed, options, userId);
    AmbientFXManager.refresh(this, {rebuild: true});
  }
}

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing Ambient FX v1.1.0-dev`);
  CONFIG.RegionBehavior.dataModels[BEHAVIOR_TYPE] = AmbientFXRegionBehaviorType;
  CONFIG.RegionBehavior.typeLabels[BEHAVIOR_TYPE] = `TYPES.RegionBehavior.${BEHAVIOR_TYPE}`;
  CONFIG.RegionBehavior.typeIcons[BEHAVIOR_TYPE] = "fa-solid fa-wand-magic-sparkles";
});

Hooks.on("canvasTearDown", () => {
  AmbientFXManager.stopAll();
});

// canvas.overlay stays screen-bound; canvasPan gives us a cheap opportunity to
// refit it after a renderer/window size change.
Hooks.on("canvasPan", () => {
  AmbientFXManager.updateScreenTargets();
});

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
