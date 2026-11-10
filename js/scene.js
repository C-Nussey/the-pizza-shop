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
    // The done pile fills the whole green panel (x 1087-1280, y 122-492 in
    // the artwork). Every delivered order goes on it, in three columns:
    // the spacing closes up as the pile grows, so a busy night looks like
    // a busy night instead of six tidy tickets and a hidden remainder.
    done: { cols: [1096, 1154, 1212], top: 166, bottom: 420, h: 62, step: 38 },
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
    captureSigns(bg);
    layers.bg.appendChild(bg);

    rollSkins();
    return svg;
  }

  // The three signs painted into Background.svg, by the words they carry.
  // Held so the vocabulary switch can repaint them: when the game speaks
  // flow metrics, the shop's own walls should too.
  var SIGNS = {
    "ORDERS WAITING": "signWaiting",
    "ORDERS IN PROGRESS": "signProgress",
    "ORDERS DONE": "signDone",
  };
  var signNodes = {};

  /**
   * Find the painted signs, and shift "ORDERS WAITING" to the left margin.
   * The labels are drawn into Background.svg, so they cannot be moved or
   * reworded at source without re-exporting the artwork; taking hold of the
   * text nodes on load is reversible and keeps the artwork the single
   * source of their placement.
   */
  function captureSigns(bg) {
    var texts = bg.querySelectorAll("text");
    for (var i = 0; i < texts.length; i++) {
      var words = (texts[i].textContent || "").trim();
      if (!SIGNS[words]) continue;
      signNodes[SIGNS[words]] = texts[i];
      if (SIGNS[words] !== "signWaiting") continue;
      var t = texts[i].getAttribute("transform") || "";
      var m = /translate\(\s*[-\d.]+\s*[, ]\s*([-\d.]+)/.exec(t);
      texts[i].setAttribute("transform", "translate(" + L.waitingLabelX + " " + (m ? m[1] : "25.1") + ")");
    }
    repaintSigns();
  }

  function repaintSigns() {
    if (typeof Terms === "undefined") return;
    Object.keys(signNodes).forEach(function (key) {
      // The sign is one or more tspans; the first carries the words.
      var node = signNodes[key];
      var span = node.querySelector("tspan") || node;
      span.textContent = Terms.get(key);
    });
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

    // Three columns across the panel, filling left to right and top to
    // bottom. The rows close up as the pile grows, so it stays inside the
    // panel however big the night gets — thirty orders look like thirty
    // orders, just packed tighter.
    var cols = L.done.cols.length;
    var rows = Math.ceil(finished.length / cols);
    var span = L.done.bottom - L.done.top - L.done.h;
    var step = rows > 1 ? Math.max(4, Math.min(L.done.step, span / (rows - 1))) : 0;

    // Oldest first, so each new ticket lands ON TOP of the one before it
    // and the most recent is the one you can read.
    finished.forEach(function (order, i) {
      var set = returnedIds[order.id] ? TICKET_SET.sentBack : TICKET_SET.done;
      var age = ageIndex(order.leadTimeMinutes || 0);
      var x = L.done.cols[i % cols] + wobble(order.id, 14);
      var y = L.done.top + Math.floor(i / cols) * step;
      var g = el("g", {
        transform: "rotate(" + wobble(order.id + 7, 8).toFixed(2) + " " +
          (x + 28) + " " + (y + L.done.h / 2) + ")",
      });
      drawTicket(g, set[age], x, y, L.done.h, order, (order.leadTimeMinutes || 0) + "m");
      layers.tickets.appendChild(g);
    });
  }

  /** Ticket width for a given height, from the artwork's own proportions. */
  var TICKET_RATIO = 114.02 / 127.62;

  function crossOut(x, y, h) {
    var w = h * TICKET_RATIO;
    var pad = h * 0.16;
    [[x + pad, y + pad, x + w - pad, y + h - pad],
     [x + w - pad, y + pad, x + pad, y + h - pad]].forEach(function (p) {
      layers.tickets.appendChild(el("path", {
        d: "M " + p[0] + " " + p[1] + " L " + p[2] + " " + p[3],
        class: "lost-x",
      }));
    });
  }

  /**
   * At closing, the orders nobody got to STAY on the board with a line
   * through them. Clearing them away at the bell is the one thing a shop
   * never does: those are the customers who went home, and they are the
   * most expensive thing that happened all day — they should be the last
   * thing you see, not the first thing that disappears.
   */
  function drawLost(state, ovenBoxes) {
    if (!state.dayOver || !state.walked.length) return;
    var waiting = [], started = [];
    state.walked.forEach(function (o) {
      (o.startedTick == null ? waiting : started).push(o);
    });

    var shown = waiting.slice(0, 11);
    var xs = spread(shown.length, L.rail.x0, L.rail.x1 - 68, 70, true);
    shown.forEach(function (order, i) {
      var waited = (state.tick - order.orderedTick) * Shop.MINUTES_PER_TICK;
      var x = xs[i] - 34;
      drawTicket(layers.tickets, TICKET_SET.waiting[2], x, L.rail.top, L.rail.h, order, waited + "m");
      crossOut(x, L.rail.top, L.rail.h);
    });
    if (waiting.length > shown.length) {
      var more = el("text", {
        x: L.rail.x1 + 16, y: L.rail.top + L.rail.h * 0.6,
        class: "scene-more scene-more--lost", "text-anchor": "middle",
      });
      more.textContent = "+" + (waiting.length - shown.length);
      layers.tickets.appendChild(more);
    }

    // The ones that were actually in an oven when the bell went: the sale
    // AND the ingredients.
    started.slice(0, 10).forEach(function (order, i) {
      var waited = (state.tick - order.orderedTick) * Shop.MINUTES_PER_TICK;
      var x = (ovenBoxes[i] ? ovenBoxes[i].x : L.wip.x0 + i * 70) - 30;
      drawTicket(layers.tickets, TICKET_SET.wip[2], x, L.wip.top, L.wip.h, order, waited + "m");
      crossOut(x, L.wip.top, L.wip.h);
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
    if (v >= 10000) return sign + Shop.CURRENCY + (v / 1000).toFixed(1) + "k";
    return sign + Shop.CURRENCY + v;
  }

  /** 24-hour clock: "16:00" can't be misread as four in the morning. */
  function clock24(tick) {
    var total = Shop.OPENING_HOUR * 60 + tick * Shop.MINUTES_PER_TICK;
    var h = Math.floor(total / 60);
    var m = total % 60;
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }

  /**
   * What somebody in the kitchen says, picked from what is actually
   * happening. The list is in priority order: the most pressing thing
   * wins, and each line is tied to a condition the player can see on the
   * board, so the bubble is a reading of the shop rather than decoration.
   */
  function sceneMessage(state) {
    if (state.dayOver) return closingMessage(state);

    var snap = Shop.latestSnapshot(state);
    var queue = state.queue.length;
    var kitchen = state.kitchen.length;
    var staff = state.params.workers;
    var ovens = state.params.ovenSlots;
    var ticksLeft = Math.max(0, Shop.TICKS_PER_DAY - state.tick);

    // Only a FRESH return is worth saying; the old code kept this bubble
    // up for the rest of the day after a single one, which made the shop
    // look permanently on fire.
    var justBack = state.returned.some(function (o) {
      return o.requeuedTick != null && state.tick - o.requeuedTick <= 3;
    });
    if (justBack) {
      return { bad: true, text: "That one's back — we rushed it" };
    }

    // Owing more cooking than there is time left to do it.
    var owed = 0;
    state.queue.concat(state.kitchen).forEach(function (o) {
      owed += o.effortRequired - o.effortDone;
    });
    var canDo = ticksLeft * Math.min(staff, ovens);
    if (owed > canDo && owed > 0) {
      return { bad: true, text: "We won't get through this lot" };
    }

    if (queue >= 8) return { bad: true, text: "We're drowning out here!" };
    if (snap.avgLeadMinutes >= 90) return { bad: true, text: "People have waited over an hour" };
    if (queue >= 4) return { bad: true, text: "The orders keep coming!" };
    if (kitchen > staff * 1.5 && kitchen > 2) {
      return { bad: true, text: "Too many on the go at once" };
    }
    if (!state.params.acceptingOrders && queue + kitchen > 0) {
      return { bad: false, text: "Shutters down — just these to finish" };
    }
    if (kitchen === 0 && queue === 0 && state.tick > 2) {
      return { bad: false, text: "Nothing to do..." };
    }
    if (staff > ovens) return { bad: false, text: "Not enough ovens for us all" };
    if (ovens > staff && kitchen >= staff) {
      return { bad: false, text: "More ovens than hands tonight" };
    }
    if (state.delivered.length >= 5 && queue <= 1) {
      return { bad: false, text: "Nice and steady, this" };
    }
    return null;
  }

  /**
   * The last word of the night: how the shift felt, not what it earned.
   * The till already says what it earned.
   */
  function closingMessage(state) {
    var d = state.days[state.days.length - 1];
    if (!d) return null;

    if (d.walked > 0 && d.profit < 0) {
      return { bad: true, text: d.walked + " let down, and we still lost money" };
    }
    if (d.walked > 0) {
      return { bad: true, text: d.walked + " went home with nothing" };
    }
    if (d.profit < 0) {
      return { bad: true, text: "Flat out all night and still behind" };
    }
    if (d.returned >= 3) {
      return { bad: true, text: "Too many sent back — we were rushing" };
    }
    if (d.avgLeadMinutes >= 75) {
      return { bad: true, text: "Everyone got one, but they waited" };
    }

    // Idle time, averaged over the day, says the quiet nights apart from
    // the well-judged ones: both end clean, but only one was busy.
    var idle = 0;
    state.history.forEach(function (h) { idle += h.idleCapacity || 0; });
    var perTick = Math.max(1, Math.min(d.workers, d.ovenSlots));
    if (state.history.length && idle / state.history.length > perTick * 0.55) {
      return { bad: false, text: "Quiet one — we could've taken more" };
    }
    if (d.refused > d.delivered * 0.5) {
      return { bad: false, text: "Turned a lot away, but we coped" };
    }
    return { bad: false, text: "Everyone got their pizza. Good night" };
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
    drawLost(state, ovenBoxes);
    drawControls(state, chefs);
  }

  root.Scene = {
    init: init,
    render: render,
    rollSkins: rollSkins,
    repaintSigns: repaintSigns,
    LAYOUT: L,
    SKIN_TONES: SKIN_TONES,
  };
})(typeof window !== "undefined" ? window : this);
