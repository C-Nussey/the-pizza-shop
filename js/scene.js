/**
 * scene.js — The Pizza Shop
 *
 * Draws the shop as an illustrated scene that is an honest read-out of the
 * simulation: the number of ovens IS the oven-slot setting, the number of
 * chefs IS the staffing, a ticket's condition IS how long that customer has
 * been waiting, and an oven's contents ARE that pizza's progress.
 *
 * The governing rule is that ovens and chefs are counted and drawn
 * INDEPENDENTLY, in separate rows. Pairing them one-to-one would make the
 * two levers look like one lever and hide the trade-off the whole game is
 * about: too few slots and staff stand idle, too many and they are spread
 * thin across pizzas that all crawl.
 */

(function (root) {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";

  // Measured off Background.svg, which is authored at 1280x800.
  var W = 1280;
  var H = 800;

  var L = {
    rail: { top: 30, h: 76, x0: 32, x1: 930 },       // waiting tickets
    // "ORDERS WAITING" is painted into the background out at x=103, which
    // left a dead strip of wall to its left and pushed the rail in behind
    // it. The label is moved to the margin on load so the rail can start
    // where the shop starts.
    waitingLabelX: 28,
    counterTop: 312,                                   // ovens stand on this line
    oven: { x0: 215, x1: 1010, h: 124 },
    // Chefs stand BEHIND the counter: their base sits well below the counter
    // line and the layer is clipped at it, so the counter hides their lower
    // half exactly as a real pass would. Without the clip they float, because
    // the counter is painted into the background and cannot overlap them.
    chef: { base: 330, h: 136, x0: 250, x1: 975 },
    wip: { top: 344, h: 72, x0: 200, x1: 1045 },       // tickets on the counter front
    // The done pile fills the whole green panel (which is x 1087-1280,
    // y 122-492 in the artwork). Every delivered order goes on it: the
    // spacing closes up as the pile grows, so a busy night looks like a
    // busy night instead of six tidy tickets and a hidden remainder.
    done: { x: 1102, top: 166, bottom: 420, h: 62, step: 38, stagger: 30 },
    clock: { x: 1128, y: 44, w: 84, h: 38 },
    // The little screen on the cash register painted into the background.
    registerScreen: { x: 995, y: 491, w: 41, h: 22 },
    lever: { x: 980, y: 11, w: 53 },    // beside the clock in the artwork
  };

  // Her palette, applied per chef so a row doesn't look cloned.
  var SKIN_TONES = [
    "#ac917c", "#dea9aa", "#a67c52", "#533e29",
    "#f2dddd", "#c6a98c", "#2a1f15", "#78532f",
  ];

  // How long a customer has been waiting before their ticket starts to look
  // the part. Cooking alone runs 30-60 minutes, so "late" has to sit well
  // beyond that to mean something.
  var AGE_FRESH_MAX = 30;
  var AGE_AGING_MAX = 60;

  var TICKET_SET = {
    waiting: ["Fresh_Order_To_Do", "Aging_Order_To_do", "Late_Order_To_Do"],
    wip: ["Fresh_Order_In_Progress", "Aging_Order_In_Progress", "Late_Order_In_Progress"],
    done: ["Fresh_Order_Done", "Aging_Order_Done", "Late_Order_Done"],
    sentBack: ["Fresh_Order_Sent_Back", "Aging_Order_Sent_Back", "Late_Order_Sent_Back"],
  };

  var svg = null;
  var layers = {};
  var skinForChef = [];

  function el(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      node.setAttribute(k, attrs[k]);
    });
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /** Stable per-chef skin, reshuffled only when the shop resets. */
  function rollSkins() {
    skinForChef = [];
    var pool = SKIN_TONES.slice();
    for (var i = 0; i < 12; i++) {
      if (!pool.length) pool = SKIN_TONES.slice();
      var idx = Math.floor(Math.random() * pool.length);
      skinForChef.push(pool.splice(idx, 1)[0]);
    }
  }

  function ageIndex(minutes) {
    if (minutes < AGE_FRESH_MAX) return 0;
    if (minutes < AGE_AGING_MAX) return 1;
    return 2;
  }

  /**
   * Spread n items across a span. Centred by default; left-aligned for the
   * ticket rails, which should fill up from one end the way a real rail
   * does rather than drifting around their midpoint as orders arrive.
   */
  function spread(n, x0, x1, itemW, fromLeft) {
    var out = [];
    if (n <= 0) return out;
    var span = x1 - x0;
    var gap = n > 1 ? Math.min(span / (n - 1), itemW * 1.3) : 0;
    var start = fromLeft ? x0 + itemW / 2 : x0 + (span - gap * (n - 1)) / 2;
    if (n === 1 && !fromLeft) start = x0 + span / 2;
    for (var i = 0; i < n; i++) out.push(start + gap * i);
    return out;
  }

  function init(container) {
    svg = el("svg", {
      viewBox: "0 0 " + W + " " + H,
      class: "scene-svg",
      preserveAspectRatio: "xMidYMid meet",
    });
    // Clip the chefs at the counter line so they read as standing behind
    // the pass rather than floating in front of it.
    var defs = el("defs");
    var clip = el("clipPath", { id: "behind-counter" });
    clip.appendChild(el("rect", { x: 0, y: 0, width: W, height: L.counterTop }));
    defs.appendChild(clip);
    svg.appendChild(defs);

    // Order matters: chefs are drawn before the ovens so the ovens occlude
    // them, leaving hats and heads visible above the oven tops.
    ["bg", "chefs", "ovens", "lines", "tickets", "ui"].forEach(function (name) {
      layers[name] = el("g", { class: "layer-" + name });
      if (name === "chefs") layers[name].setAttribute("clip-path", "url(#behind-counter)");
      svg.appendChild(layers[name]);
    });
    container.appendChild(svg);

    // The background is static, so it is built once.
    var bg = Assets.sprite("Background", { x: 0, y: 0, w: W, anchor: "topleft" });
    moveWaitingLabel(bg);
    layers.bg.appendChild(bg);

    rollSkins();
    return svg;
  }

  /**
   * Shift the "ORDERS WAITING" label to the left margin. It is drawn into
   * Background.svg, so it cannot be repositioned at source without
   * re-exporting the artwork; nudging the one text node on load is both
   * reversible and keeps the artwork the single source of the wording.
   */
  function moveWaitingLabel(bg) {
    var texts = bg.querySelectorAll("text");
    for (var i = 0; i < texts.length; i++) {
      if ((texts[i].textContent || "").trim() !== "ORDERS WAITING") continue;
      var t = texts[i].getAttribute("transform") || "";
      var m = /translate\(\s*[-\d.]+\s*[, ]\s*([-\d.]+)/.exec(t);
      var y = m ? m[1] : "25.1";
      texts[i].setAttribute("transform", "translate(" + L.waitingLabelX + " " + y + ")");
      return;
    }
  }

  // --- Ovens ---------------------------------------------------------------
  function ovenAssetFor(pizza) {
    if (!pizza) return "Pizza_Oven_idle";
    var p = pizza.effortDone / pizza.effortRequired;
    if (p < 0.34) return "Pizza_oven_just_started";
    if (p < 0.75) return "Pizza_oven_cooking";
    return "Pizza_oven_almost_cooked";
  }

  function drawOvens(state) {
    var slots = state.params.ovenSlots;
    var xs = spread(slots, L.oven.x0, L.oven.x1, 104);
    var boxes = [];
    xs.forEach(function (x, i) {
      var pizza = state.kitchen[i] || null;
      var node = Assets.sprite(ovenAssetFor(pizza), {
        x: x,
        y: L.counterTop,
        h: L.oven.h,
        anchor: "bottom",
        by: "body",
      });
      layers.ovens.appendChild(node);
      boxes.push({ pizza: pizza, x: x, mouthY: L.counterTop - L.oven.h * 0.33 });
    });
    return boxes;
  }

  // --- Chefs ---------------------------------------------------------------
  function drawChefs(state) {
    var staff = state.params.workers;
    var busyCount = Math.min(state.kitchen.length, staff);
    var xs = spread(staff, L.chef.x0, L.chef.x1, 96);
    var positions = [];
    xs.forEach(function (x, i) {
      var busy = i < busyCount;
      // The busy chef is sized by their body; the idle one by their whole
      // artwork, because their daydream balloon sits above their head and
      // would otherwise float off the top of the shop.
      var node = Assets.sprite(busy ? "Busy_chef" : "Relaxed_chef", {
        x: x,
        y: L.chef.base,
        h: busy ? L.chef.h : L.chef.h * 1.55,
        anchor: "bottom",
        by: busy ? "body" : "ink",
      });
      Assets.setSkin(node, skinForChef[i % skinForChef.length]);
      layers.chefs.appendChild(node);
      positions.push({ x: x, busy: busy, top: L.chef.base - L.chef.h });
    });
    return positions;
  }

  // --- Tickets -------------------------------------------------------------
  function ticketLines(order, label) {
    return ["Order #" + order.id, order.typeName, label || ""];
  }

  function drawTicket(group, assetName, x, y, h, order, label, klass) {
    var node = Assets.sprite(assetName, {
      x: x, y: y, h: h, anchor: "topleft",
    });
    Assets.setTicketText(node, ticketLines(order, label));
    if (klass) node.setAttribute("class", klass);
    group.appendChild(node);
    return node;
  }

  function drawWaiting(state) {
    var q = state.queue;
    var max = 11;
    var shown = q.slice(0, max);
    // spread() places CENTRES, so the span has to be pulled in by a ticket
    // width or the last one hangs off the end of the rail and under the
    // lever.
    var xs = spread(shown.length, L.rail.x0, L.rail.x1 - 68, 70, true);
    shown.forEach(function (order, i) {
      var waited = (state.tick - order.orderedTick) * Shop.MINUTES_PER_TICK;
      var set = order.sentBack ? TICKET_SET.sentBack : TICKET_SET.waiting;
      drawTicket(
        layers.tickets,
        set[ageIndex(waited)],
        xs[i] - 34,
        L.rail.top,
        L.rail.h,
        order,
        waited + "m"
      );
    });
    if (q.length > shown.length) {
      var more = el("text", {
        x: L.rail.x1 + 16, y: L.rail.top + L.rail.h * 0.6,
        class: "scene-more", "text-anchor": "middle",
      });
      more.textContent = "+" + (q.length - shown.length);
      layers.tickets.appendChild(more);
    }
  }

  function drawInProgress(state, ovenBoxes) {
    var items = state.kitchen.slice(0, 10);
    // Each ticket sits directly under the oven its pizza is in, so the
    // dotted line between the paperwork and the cooking reads at a glance
    // instead of fanning across the counter.
    var xs = items.map(function (_, i) {
      return ovenBoxes[i] ? ovenBoxes[i].x : L.wip.x0 + i * 70;
    });
    items.forEach(function (order, i) {
      var inKitchen = order.startedTick != null
        ? (state.tick - order.startedTick) * Shop.MINUTES_PER_TICK : 0;
      var waited = (state.tick - order.orderedTick) * Shop.MINUTES_PER_TICK;
      var set = order.sentBack ? TICKET_SET.sentBack : TICKET_SET.wip;
      var tx = xs[i] - 30;
      drawTicket(
        layers.tickets, set[ageIndex(waited)], tx, L.wip.top, L.wip.h, order, inKitchen + "m"
      );

      // Dotted line from the ticket up to the oven that pizza is in, so the
      // link between the paperwork and the actual cooking is visible.
      var oven = ovenBoxes[i];
      if (oven) {
        var path = el("path", {
          d: "M " + xs[i] + " " + L.wip.top + " L " + oven.x + " " + oven.mouthY,
          class: "flow-line",
          fill: "none",
        });
        layers.lines.appendChild(path);
      }
    });
  }

  /**
   * A repeatable wobble per ticket, so the pile looks thrown together
   * rather than ruled. Keyed on the order's id, so a ticket doesn't jump
   * about between renders or while scrubbing back through the day.
   */
  function wobble(id, spread) {
    var n = Math.sin(id * 12.9898) * 43758.5453;
    return (n - Math.floor(n) - 0.5) * spread;
  }

  function drawDone(state) {
    var returnedIds = {};
    state.returned.forEach(function (r) { returnedIds[r.id] = true; });

    var inFlight = {};
    state.queue.concat(state.kitchen).forEach(function (o) { inFlight[o.id] = true; });
    var finished = state.delivered.filter(function (o) { return !inFlight[o.id]; });
    if (!finished.length) return;

    // Every delivered order is on the spike. The gap between them shrinks as
    // the night goes on, so the pile stays inside its panel however big the
    // day gets — thirty orders look like thirty orders, just closer packed.
    var span = L.done.bottom - L.done.top - L.done.h;
    var step = finished.length > 1
      ? Math.max(4, Math.min(L.done.step, span / (finished.length - 1)))
      : 0;

    // Oldest first, so each new ticket lands ON TOP of the one before it and
    // the most recent is the one you can read — the way a real spike fills.
    finished.forEach(function (order, i) {
      var set = returnedIds[order.id] ? TICKET_SET.sentBack : TICKET_SET.done;
      var age = ageIndex(order.leadTimeMinutes || 0);
      var x = L.done.x + (i % 2) * L.done.stagger + wobble(order.id, 14);
      var y = L.done.top + i * step;
      var g = el("g", {
        transform: "rotate(" + wobble(order.id + 7, 9).toFixed(2) + " " +
          (x + 28) + " " + (y + L.done.h / 2) + ")",
      });
      drawTicket(g, set[age], x, y, L.done.h, order, (order.leadTimeMinutes || 0) + "m");
      layers.tickets.appendChild(g);
    });
  }

  // --- Lever, clock, speech ------------------------------------------------
  function drawControls(state, chefs) {
    var lever = Assets.sprite(
      state.params.acceptingOrders ? "Lever_open" : "Lever_closed",
      { x: L.lever.x, y: L.lever.y, w: L.lever.w, anchor: "topleft", class: "lever-hit" }
    );
    lever.style.cursor = "pointer";
    lever.addEventListener("click", function () {
      if (typeof root.onLeverToggle === "function") root.onLeverToggle();
    });
    layers.ui.appendChild(lever);

    // Digits over the clock housing that is painted into the background.
    var t = el("text", {
      x: L.clock.x + L.clock.w / 2,
      y: L.clock.y + L.clock.h * 0.72,
      class: "clock-digits",
      "text-anchor": "middle",
    });
    t.textContent = clock24(state.tick);
    layers.ui.appendChild(t);

    // Running total on the register's own screen, the way a real till
    // shows it — rather than only in a panel beside it.
    var takings = el("text", {
      x: L.registerScreen.x + L.registerScreen.w / 2,
      y: L.registerScreen.y + L.registerScreen.h * 0.72,
      class: "register-digits",
      "text-anchor": "middle",
    });
    takings.textContent = formatMoney(
      state.dayOver ? state.cash : state.cash + Shop.dayProfit(state)
    );
    layers.ui.appendChild(takings);

    // A chef says what is going wrong, when something is.
    var line = sceneMessage(state);
    if (line && chefs.length) {
      var target = chefs.find(function (c) { return !c.busy; }) || chefs[0];
      var bubbleX = Math.min(target.x + 78, L.oven.x1 - 40);
      var bubbleY = 146;
      var bubble = Assets.sprite(line.bad ? "Speechbubble_bad" : "speechbubble_good-neutral", {
        x: bubbleX, y: bubbleY, w: 124, anchor: "center",
      });
      layers.ui.appendChild(bubble);

      var words = line.text.split(" ");
      var rows = [];
      var row = "";
      words.forEach(function (w) {
        if ((row + " " + w).trim().length > 14) { rows.push(row.trim()); row = w; }
        else row += " " + w;
      });
      if (row.trim()) rows.push(row.trim());
      rows = rows.slice(0, 3);

      var tx = el("text", {
        x: bubbleX,
        y: bubbleY - (rows.length - 1) * 6 - 2,
        class: "bubble-text",
        "text-anchor": "middle",
      });
      rows.forEach(function (r, i) {
        var ts = el("tspan", { x: bubbleX, dy: i === 0 ? 0 : 13 });
        ts.textContent = r;
        tx.appendChild(ts);
      });
      layers.ui.appendChild(tx);
    }
  }

  /** Short money for the register screen, which is only ~40 units wide. */
  function formatMoney(n) {
    var v = Math.round(n);
    var sign = v < 0 ? "-" : "";
    v = Math.abs(v);
    if (v >= 10000) return sign + "$" + (v / 1000).toFixed(1) + "k";
    return sign + "$" + v;
  }

  /** 24-hour clock: "16:00" can't be misread as four in the morning. */
  function clock24(tick) {
    var total = Shop.OPENING_HOUR * 60 + tick * Shop.MINUTES_PER_TICK;
    var h = Math.floor(total / 60);
    var m = total % 60;
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }

  /** What the chef is wondering about, picked from what's actually wrong. */
  function sceneMessage(state) {
    var snap = Shop.latestSnapshot(state);
    if (state.today.returnedCount > 0 && state.returned.length) {
      return { bad: true, text: "Why are orders coming back?" };
    }
    if (snap.queueSize >= 6) {
      return { bad: true, text: "We're drowning out here!" };
    }
    if (state.kitchen.length === 0 && state.queue.length === 0 && state.tick > 2) {
      return { bad: false, text: "Nothing to do..." };
    }
    if (state.params.workers > state.params.ovenSlots) {
      return { bad: false, text: "Not enough ovens for us all" };
    }
    return null;
  }

  // --- Public --------------------------------------------------------------
  function render(state) {
    if (!svg) return;
    clear(layers.chefs);
    clear(layers.ovens);
    clear(layers.lines);
    clear(layers.tickets);
    clear(layers.ui);

    var ovenBoxes = drawOvens(state);
    var chefs = drawChefs(state);
    drawWaiting(state);
    drawInProgress(state, ovenBoxes);
    drawDone(state);
    drawControls(state, chefs);
  }

  root.Scene = {
    init: init,
    render: render,
    rollSkins: rollSkins,
    LAYOUT: L,
    SKIN_TONES: SKIN_TONES,
  };
})(typeof window !== "undefined" ? window : this);
