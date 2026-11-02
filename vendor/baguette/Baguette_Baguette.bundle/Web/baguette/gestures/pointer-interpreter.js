// PointerInterpreter — composes the five independent input modalities
// (matches Apple Simulator.app) into one `attach`/`detach` surface:
//   - MouseGestureSource      tap / drag / pinch / pan / edge (mouse)
//   - TouchGestureSource      real multi-touch (iOS WebView)
//   - WheelGestureSource      wheel → synthesized 2-finger pinch/pan
//   - SafariGestureEventSource  native gesturestart/change/end pinch
//   - OptionHoverPreview      Option-held HUD preview, no click needed
// Each source knows its own DOM event shapes and calls Screen verbs
// (`tap`, `swipe`, `touchDown`, `touchMove`, `touchUp`) directly; this
// class does not know wire formats either. The only state shared across
// sources — whether a mouse gesture is currently active, which
// OptionHoverPreview must not repaint over — is threaded explicitly via
// `onDragChange`/`setDragActive` rather than any source reaching into
// another's internals. See each source's own file for its details
// (edge-band zones, long-press timing, the pinch/pan modifier keys, …).
(function (root) {
  'use strict';

  class PointerInterpreter {
    /**
     * @param {Screen} screen   the SDK Screen part to dispatch into
     * @param {object} [opts]
     * @param {PinchOverlay} [opts.overlay]  visual HUD
     * @param {() => string} [opts.getOrientation]  device orientation
     * @param {(msg:string, isErr?:boolean)=>void} [opts.log]
     * @param {(clientX:number, clientY:number) => {x:number,y:number,
     *   xNorm:number,yNorm:number,inside:boolean}} [opts.mapClientPoint]
     *   Overrides the default element-rect-relative mapping — used by
     *   the 3D Interact mode, where the bound element is the whole
     *   canvas and the actual screen sits inside it as a rotated,
     *   perspective-foreshortened quad. `inside` is false when the
     *   point falls outside that quad (bezel/body/background).
     */
    constructor(screen, { overlay, getOrientation, log, mapClientPoint } = {}) {
      this._optionHoverPreview = new root.Baguette._OptionHoverPreview(screen, { overlay });
      const mouseSource = new root.Baguette._MouseGestureSource(screen, {
        overlay, getOrientation, log, mapClientPoint,
        // The one piece of state MouseGestureSource and OptionHoverPreview
        // share — threaded explicitly instead of having either reach into
        // the other. See option-hover-preview.js for why.
        onDragChange: (active) => this._optionHoverPreview.setDragActive(active),
      });
      this._sources = [
        mouseSource,
        this._optionHoverPreview,
        new root.Baguette._TouchGestureSource(screen, { overlay, getOrientation, mapClientPoint }),
        new root.Baguette._WheelGestureSource(screen, { overlay }),
        new root.Baguette._SafariGestureEventSource(screen, { overlay }),
      ];
    }

    attach(el) {
      for (const source of this._sources) source.attach(el);
    }

    detach() {
      for (const source of this._sources) source.detach();
    }
  }

  root.Baguette = root.Baguette || {};
  root.Baguette._PointerInterpreter = PointerInterpreter;
})(window);
