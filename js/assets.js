/**
 * assets.js — The Pizza Shop
 *
 * Loads the illustrated SVG assets and makes them safe and predictable to
 * compose into one scene. Three problems it solves, all of them caused by
 * the artwork being drawn as separate Illustrator exports:
 *
 * 1. CLASS AND ID COLLISIONS. Every export uses generic `.cls-1`…`.cls-N`
 *    and ids like `drop-shadow-24`, with different meanings per file —
 *    `.cls-5` is skin in Busy_chef but cream in Relaxed_chef. Inlined into
 *    one document they overwrite each other. Everything gets namespaced on
 *    load.
 *
 * 2. CANVAS PADDING VARIES. A "roughen" effect grew the artboard around the
 *    aged tickets, and smoke grew it around the cooking ovens, so the same
 *    card or oven occupies a different share of each file. Drawn naively,
 *    a ticket shrinks ~30% as it ages and an oven swells as it heats. We
 *    measure what is actually INKED and scale to that instead of to the
 *    canvas.
 *
 * 3. RECOLOURING. Chef skin is a single hex (#ac917c) used for face and
 *    both hands, so one substitution restyles a whole chef.
 */

(function (root) {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";
  var BASE = "assets/svg/";

  // Skin tone used throughout the chef artwork — the one colour we swap.
  var SOURCE_SKIN = "#ac917c";

  var store = {}; // name -> { el, viewBox, ink, body }
  var uid = 0;

  function parseSvg(text) {
    var doc = new DOMParser().parseFromString(text, "image/svg+xml");
    var err = doc.querySelector("parsererror");
    if (err) throw new Error("Bad SVG: " + err.textContent.slice(0, 120));
    return doc.documentElement;
  }

  /**
   * Rewrite every class name and every id in one asset so two assets can
   * live in the same document without trampling each other's styles.
   */
  function namespaceSvg(svgEl, prefix) {
    // Collect ids first so references can be rewritten to match.
    var idMap = {};
    svgEl.querySelectorAll("[id]").forEach(function (el) {
      var old = el.getAttribute("id");
      var next = prefix + "-" + old;
      idMap[old] = next;
      el.setAttribute("id", next);
    });

    // url(#...) references: fill, filter, clip-path, mask, and style text.
    var URL_ATTRS = ["fill", "stroke", "filter", "clip-path", "mask", "style"];
    svgEl.querySelectorAll("*").forEach(function (el) {
      URL_ATTRS.forEach(function (attr) {
        var v = el.getAttribute && el.getAttribute(attr);
        if (!v || v.indexOf("url(#") === -1) return;
        el.setAttribute(attr, v.replace(/url\(#([^)]+)\)/g, function (m, id) {
          return "url(#" + (idMap[id] || id) + ")";
        }));
      });
    });

    // Class names, in the <style> block and on every element.
    svgEl.querySelectorAll("style").forEach(function (styleEl) {
      var css = styleEl.textContent;
      css = css.replace(/\.(cls-[\w-]+)/g, function (m, cls) {
        return "." + prefix + "-" + cls;
      });
      css = css.replace(/url\(#([^)]+)\)/g, function (m, id) {
        return "url(#" + (idMap[id] || id) + ")";
      });
      styleEl.textContent = css;
    });

    svgEl.querySelectorAll("[class]").forEach(function (el) {
      var cls = el.getAttribute("class");
      if (!cls) return;
      el.setAttribute(
        "class",
        cls.split(/\s+/).filter(Boolean).map(function (c) {
          return /^cls-/.test(c) ? prefix + "-" + c : c;
        }).join(" ")
      );
    });

    return svgEl;
  }

  /**
   * Prepare every asset from the embedded bundle.
   *
   * The artwork is embedded (js/asset-data.js) rather than fetched so the
   * shop opens straight from a file:// URL — browsers refuse fetch() on
   * local files, and a teaching tool that needs a web server to start is a
   * teaching tool nobody starts. Ink bounds come baked in from the same
   * bundle, because measuring them means reading pixels back off a canvas,
   * which a file:// page is not permitted to do either.
   */
  function loadAll() {
    return new Promise(function (resolve, reject) {
      var data = root.ASSET_DATA;
      if (!data) {
        reject(new Error("asset-data.js is missing — run: node tools/build-assets.js"));
        return;
      }
      try {
        Object.keys(data).forEach(function (name) {
          var entry = data[name];
          store[name] = {
            el: namespaceSvg(parseSvg(entry.src), "a" + (++uid)),
            viewBox: entry.viewBox,
            ink: entry.ink || entry.viewBox,
            body: entry.body || entry.ink || entry.viewBox,
          };
        });
        resolve(store);
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Build a positioned instance of an asset as a nested <svg>.
   *
   * Sizing is driven by the asset's measured ink (or its body, for things
   * with smoke or a thought bubble above them) rather than its canvas, so
   * every ticket lands the same size however much roughening padded it out
   * and every oven keeps the same footprint however much smoke it is
   * producing.
   *
   * @param {string} name
   * @param {Object} o  { x, y, w, h, anchor: "bottom"|"topleft"|"center", by: "ink"|"body" }
   */
  function sprite(name, o) {
    var a = store[name];
    if (!a) throw new Error("Asset not loaded: " + name);

    var ref = o.by === "body" ? a.body : a.ink;
    var full = a.ink;

    // Scale so the reference region matches the requested size.
    var scale;
    if (o.w != null) scale = o.w / ref.w;
    else if (o.h != null) scale = o.h / ref.h;
    else scale = 1;

    // The viewport has to cover the whole inked artwork, not just the
    // reference region, or the smoke gets clipped off the top.
    var vx = full.x;
    var vy = full.y;
    var vw = full.w;
    var vh = full.h;

    var outW = vw * scale;
    var outH = vh * scale;

    // Position: place the REFERENCE region at (x, y) per the anchor, then
    // work back to where the full artwork's corner has to sit.
    var refOffsetX = (ref.x - full.x) * scale;
    var refOffsetY = (ref.y - full.y) * scale;
    var refW = ref.w * scale;
    var refH = ref.h * scale;

    var left, top;
    var anchor = o.anchor || "topleft";
    if (anchor === "bottom") {
      left = o.x - refW / 2 - refOffsetX;
      top = o.y - refH - refOffsetY;
    } else if (anchor === "center") {
      left = o.x - refW / 2 - refOffsetX;
      top = o.y - refH / 2 - refOffsetY;
    } else {
      left = o.x - refOffsetX;
      top = o.y - refOffsetY;
    }

    var nested = document.createElementNS(SVG_NS, "svg");
    nested.setAttribute("x", left.toFixed(2));
    nested.setAttribute("y", top.toFixed(2));
    nested.setAttribute("width", outW.toFixed(2));
    nested.setAttribute("height", outH.toFixed(2));
    nested.setAttribute("viewBox", [vx, vy, vw, vh].join(" "));
    nested.setAttribute("overflow", "visible");
    if (o.class) nested.setAttribute("class", o.class);

    // Copy the asset's children (defs carry its namespaced styles).
    var src = a.el.cloneNode(true);
    while (src.firstChild) nested.appendChild(src.firstChild);

    // Report where the reference region landed, for callers that need to
    // draw to it (the dotted lines need an oven's mouth).
    nested.__box = { x: left + refOffsetX, y: top + refOffsetY, w: refW, h: refH };
    return nested;
  }

  /**
   * Swap the chef skin colour. Face and both hands share one hex, so one
   * substitution restyles the whole chef.
   *
   * This has to be done with INLINE styles, not by editing the clone's
   * <style> block. Every clone of an asset carries the same class names, and
   * CSS is document-global — so three chefs on screen, each with their own
   * stylesheet defining `.a5-cls-5`, would all take whichever one the
   * browser saw last, and the whole row would come out one colour. An inline
   * style beats a stylesheet rule, so it stays per-chef.
   */
  function setSkin(el, hex) {
    // Work out which classes carry the skin colour in this asset.
    var skinClasses = [];
    el.querySelectorAll("style").forEach(function (styleEl) {
      var re = /\.([\w-]+)\s*\{[^}]*fill:\s*([#\w]+)[^}]*\}/gi;
      var m;
      while ((m = re.exec(styleEl.textContent))) {
        if (m[2].toLowerCase() === SOURCE_SKIN) skinClasses.push(m[1]);
      }
    });

    skinClasses.forEach(function (cls) {
      el.querySelectorAll('[class~="' + cls + '"]').forEach(function (node) {
        node.style.fill = hex;
      });
    });

    // And anything that carried the colour as a presentation attribute.
    el.querySelectorAll("[fill]").forEach(function (node) {
      if ((node.getAttribute("fill") || "").toLowerCase() === SOURCE_SKIN) {
        node.style.fill = hex;
      }
    });
  }

  /**
   * Rewrite the order text on a ticket. The artwork ships with placeholder
   * copy ("Order #1 / 1x Lrg / 2x Sml") as live <text>, so it can simply be
   * retyped rather than redrawn. The "SENT BACK!" stamp is a second text
   * node and is left alone.
   */
  function setTicketText(el, lines) {
    var texts = Array.prototype.slice.call(el.querySelectorAll("text"));
    var main = texts[0];
    if (!main) return;
    var spans = main.querySelectorAll("tspan");
    for (var i = 0; i < spans.length; i++) {
      spans[i].textContent = lines[i] != null ? lines[i] : "";
    }
  }

  root.Assets = {
    loadAll: loadAll,
    sprite: sprite,
    setSkin: setSkin,
    setTicketText: setTicketText,
    get: function (name) { return store[name]; },
    SOURCE_SKIN: SOURCE_SKIN,
  };
})(typeof window !== "undefined" ? window : this);
