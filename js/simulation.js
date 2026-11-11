/**
 * simulation.js — The Pizza Shop
 *
 * Pure, DOM-free simulation of a pizza shop as a flow system:
 *
 *     Orders  ->  Kitchen  ->  Delivered
 *
 * Teaching goal: the same flow lessons as a delivery pipeline, but in a
 * setting anyone already understands. Orders arrive on their own schedule,
 * the kitchen has finite capacity, and a pizza that misses closing time is
 * worth nothing — so the player has to manage BOTH sides: how much work is
 * in flight (oven slots, staffing) and how much work they accept at all
 * (open/closed).
 *
 * Time runs in 15-minute slices across a service window, so lead time is
 * measured in MINUTES. "Forty minutes for a pizza" means something to
 * everyone; "4.2 days cycle time" does not.
 *
 * No DOM, no I/O — runs in a browser or under node for testing.
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Shop = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // --- Time ---------------------------------------------------------------
  var MINUTES_PER_TICK = 15;
  var OPENING_HOUR = 11; // 11:00
  var CLOSING_HOUR = 21; // 21:00
  var TICKS_PER_DAY = ((CLOSING_HOUR - OPENING_HOUR) * 60) / MINUTES_PER_TICK; // 40

  // --- Pizza types --------------------------------------------------------
  // Effort is in worker-ticks. One worker delivers 1 effort per tick, so a
  // Classic (3 effort) with one worker's full attention takes 45 minutes.
  var PIZZA_TYPES = {
    S: { key: "S", name: "Margherita", effort: 2.0, price: 14, ingredients: 4 },
    M: { key: "M", name: "Pepperoni", effort: 3.0, price: 18, ingredients: 6 },
    F: { key: "F", name: "The Works", effort: 4.5, price: 24, ingredients: 9 },
  };
  // Rolled on arrival — this is the "how complex is this order" dice.
  var COMPLEXITY_WEIGHTS = [
    { key: "S", weight: 0.4 },
    { key: "M", weight: 0.4 },
    { key: "F", weight: 0.2 },
  ];
  var EFFORT_VARIATION_MIN = 0.8;
  var EFFORT_VARIATION_MAX = 1.3;
  // You cannot put five cooks on one margherita. A single pizza can absorb
  // at most this much effort per tick no matter how many staff are free —
  // which is why too FEW oven slots leaves staff idle, and too many spreads
  // them thin. Without this cap, one slot and three cooks would just mean
  // one very fast pizza, and the WIP lever would have a dominant strategy.
  var MAX_EFFORT_PER_PIZZA_PER_TICK = 1;

  // --- Quality ------------------------------------------------------------
  // Rolled when a pizza comes out of the oven. Fancier pizzas go wrong more
  // often, and disproportionately so: more toppings, more to get wrong. The
  // super-linear exponent is what makes complexity actually matter rather
  // than being flat noise attached to a label.
  var BASE_FAIL_CHANCE = 0.08;
  var COMPLEXITY_RISK_EXPONENT = 1.4;
  var REFERENCE_EFFORT = PIZZA_TYPES.M.effort;
  var CROWDING_RISK = 0.12; // extra risk per unit of kitchen overload
  var MAX_FAIL_CHANCE = 0.65;
  // Of the pizzas that are wrong, how many does the kitchen catch before it
  // leaves? The rest reach the customer and come back — far more expensive.
  var CAUGHT_IN_KITCHEN_SHARE = 0.6;
  var REMAKE_EFFORT_FRACTION = 0.5; // a caught pizza needs this much of its effort again
  var RETURN_DELAY_TICKS_MIN = 2; // how long before an unhappy customer brings it back
  var RETURN_DELAY_TICKS_MAX = 5;

  // --- Money --------------------------------------------------------------
  var WAGE_PER_WORKER_PER_DAY = 60;
  var WALKED_CUSTOMER_GOODWILL = 6; // on top of losing the sale and the ingredients
  var RETURNED_GOODWILL = 8; // on top of refunding and binning it

  // --- Demand -------------------------------------------------------------
  // Orders per tick by hour of day: quiet lunch, dead afternoon, dinner rush.
  // The rush is what makes "should we keep taking orders?" a real question
  // rather than arithmetic.
  // Tuned so the dinner rush genuinely outruns a well-staffed kitchen (peak
  // ~8 orders/hour against roughly 5/hour of capacity). If demand never
  // exceeds capacity there is nothing to decide — you just accept everything.
  var DEMAND_BY_HOUR = {
    11: 0.50, 12: 1.30, 13: 1.20, 14: 0.50, 15: 0.35,
    16: 0.50, 17: 1.10, 18: 1.90, 19: 2.10, 20: 1.30,
  };

  // The two levers worth remembering a mid-day change to. Intake is logged
  // separately, as closedAtTick.
  var TRACKED_PARAMS = ["workers", "ovenSlots"];

  var DEFAULT_PARAMS = {
    workers: 3,
    ovenSlots: 4,
    acceptingOrders: true,
    // How many orders the shop has agreed to take on today. Reached, the
    // shutters come down on their own. Deciding this before the night
    // starts is a plan; pulling a lever at the right second is a reflex
    // test, and the reflex test was crowding out the lesson.
    intakeCap: 30,
  };

  // Rands. One formatter for the whole shop, so the till, the register
  // screen and the write-ups can never disagree about the money.
  var CURRENCY = "R";

  function money(n) {
    var v = Math.round(n);
    var sign = v < 0 ? "-" : "";
    v = Math.abs(v);
    // South African thousands separator is a space: R1 240.
    var digits = String(v).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00A0");
    return sign + CURRENCY + digits;
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function tickToHour(tick) {
    return OPENING_HOUR + Math.floor((tick * MINUTES_PER_TICK) / 60);
  }

  /**
   * 24-hour, to match the clock on the wall. Two clock formats on one
   * screen ("Frozen at 1:15 PM" under a wall clock reading 13:15) makes
   * the player do the conversion before they can trust either.
   */
  function tickToClock(tick) {
    var totalMinutes = OPENING_HOUR * 60 + tick * MINUTES_PER_TICK;
    var h = Math.floor(totalMinutes / 60);
    var m = totalMinutes % 60;
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }

  function rollComplexity() {
    var r = Math.random();
    var acc = 0;
    for (var i = 0; i < COMPLEXITY_WEIGHTS.length; i++) {
      acc += COMPLEXITY_WEIGHTS[i].weight;
      if (r <= acc) return COMPLEXITY_WEIGHTS[i].key;
    }
    return "M";
  }

  function rollEffort(typeKey) {
    var base = PIZZA_TYPES[typeKey].effort;
    return base * (EFFORT_VARIATION_MIN + Math.random() * (EFFORT_VARIATION_MAX - EFFORT_VARIATION_MIN));
  }

  function createShop(params) {
    var p = Object.assign({}, DEFAULT_PARAMS, params || {});
    return {
      day: 1,
      tick: 0,
      dayOver: false,
      params: p,
      cash: 0,
      nextOrderId: 1,
      arrivalAccumulator: 0,
      queue: [], // accepted, waiting to start
      kitchen: [], // being made
      delivered: [], // left the shop happy (so far)
      returned: [], // came back
      walked: [], // never got their pizza before closing
      refusedCount: 0, // orders turned away because we were closed
      pendingReturns: [], // { orderId, dueTick, order }
      events: [], // { tick, kind, message }
      history: [], // per-tick snapshot
      days: [], // completed day summaries
      dayStart: { workers: p.workers, ovenSlots: p.ovenSlots },
      paramChanges: [], // mid-day moves on the levers, with the time of each
      today: newDayTotals(),
    };
  }

  function newDayTotals() {
    return {
      wagesAccrued: 0,
      revenue: 0,
      ingredientCost: 0,
      refunds: 0,
      goodwill: 0,
      deliveredCount: 0,
      returnedCount: 0,
      remadeCount: 0,
      walkedCount: 0,
      refusedCount: 0,
      acceptedCount: 0,
    };
  }

  /**
   * Records a change to staffing or oven slots against the clock, so the
   * day can later account for what it was actually run with. A day summary
   * that only reports the settings as they stood at CLOSING time quietly
   * misreports any day you adjusted halfway through — and adjusting
   * halfway through is one of the moves the game is trying to teach.
   */
  function setParams(state, partial) {
    if ("acceptingOrders" in partial && !partial.acceptingOrders &&
        state.params.acceptingOrders && !state.dayOver) {
      state.closedAtTick = state.tick;
    }
    TRACKED_PARAMS.forEach(function (key) {
      if (!(key in partial)) return;
      var from = state.params[key];
      var to = partial[key];
      if (from === to || state.dayOver) return;
      state.paramChanges.push({ tick: state.tick, param: key, from: from, to: to });
    });
    Object.assign(state.params, partial);
  }

  /**
   * Turn the raw click-by-click log into the moves a person would describe.
   * Setting up before the shutters go up isn't a mid-day change, it's just
   * how the day started; and six clicks on "+" at half past two is one
   * decision, not six.
   */
  function condenseChanges(state) {
    var start = {
      workers: state.dayStart.workers,
      ovenSlots: state.dayStart.ovenSlots,
    };
    var moves = [];
    state.paramChanges.forEach(function (m) {
      if (m.tick === 0) { start[m.param] = m.to; return; }
      var last = null;
      for (var i = moves.length - 1; i >= 0; i--) {
        if (moves[i].param === m.param) { last = moves[i]; break; }
      }
      if (last && last.tick === m.tick) { last.to = m.to; return; }
      moves.push({ tick: m.tick, param: m.param, from: m.from, to: m.to });
    });
    return {
      start: start,
      moves: moves.filter(function (m) { return m.from !== m.to; }),
    };
  }

  function logEvent(state, kind, message) {
    state.events.push({ day: state.day, tick: state.tick, kind: kind, message: message });
    if (state.events.length > 200) state.events.splice(0, state.events.length - 200);
  }

  /**
   * Share capacity across the pizzas being made, giving effort a pizza can't
   * absorb to the ones that can still use it. Returns unused capacity, which
   * is genuine idle time — staff standing around.
   */
  function distributeEffort(items, capacity) {
    var remaining = capacity;
    var absorbers = items.slice();

    while (remaining > 1e-6 && absorbers.length > 0) {
      var share = remaining / absorbers.length;
      var stillHungry = [];
      var consumed = 0;
      for (var i = 0; i < absorbers.length; i++) {
        var item = absorbers[i];
        // Capped both by what's left to do and by how much attention one
        // pizza can physically take in 15 minutes.
        var headroom = MAX_EFFORT_PER_PIZZA_PER_TICK - (item.absorbedThisTick || 0);
        var needed = Math.min(item.effortRequired - item.effortDone, headroom);
        if (needed <= 1e-6) continue;
        var given = Math.min(share, needed);
        if (item.effortRequired - item.effortDone - given <= 1e-6) {
          // Snap to exact completion so float residue can't strand a pizza
          // a hair short of done forever.
          given = item.effortRequired - item.effortDone;
          item.effortDone = item.effortRequired;
        } else {
          item.effortDone += given;
          if (needed - given > 1e-6) stillHungry.push(item);
        }
        item.absorbedThisTick = (item.absorbedThisTick || 0) + given;
        consumed += given;
      }
      remaining -= consumed;
      absorbers = stillHungry;
      if (consumed <= 1e-6) break;
    }

    return remaining;
  }

  function failChanceFor(order, kitchenCount, workers) {
    var sizeRisk = Math.pow(order.effortRequired / REFERENCE_EFFORT, COMPLEXITY_RISK_EXPONENT);
    // More pizzas on the go than hands to make them = more mistakes.
    var crowding = Math.max(0, (kitchenCount - workers) / Math.max(workers, 1));
    return clamp(BASE_FAIL_CHANCE * sizeRisk + CROWDING_RISK * crowding, 0.01, MAX_FAIL_CHANCE);
  }

  function minutesSince(state, tick) {
    return (state.tick - tick) * MINUTES_PER_TICK;
  }

  /** Advance one 15-minute slice. */
  function tick(state) {
    if (state.dayOver) return state;

    var p = state.params;
    state.tick += 1;
    var todayEvents = [];

    // The people on shift get paid for the time they are on shift.
    state.today.wagesAccrued += wagesPerTick(state);

    // 1. Customers who were unhappy bring their pizza back. This is the
    //    expensive failure: we already gave it away, so we refund it, bin
    //    the ingredients and take the goodwill hit.
    for (var r = state.pendingReturns.length - 1; r >= 0; r--) {
      var pending = state.pendingReturns[r];
      if (pending.dueTick > state.tick) continue;
      state.pendingReturns.splice(r, 1);
      var ret = pending.order;
      state.returned.push(ret);
      state.today.goodwill += RETURNED_GOODWILL;
      state.today.returnedCount += 1;

      // The customer brings it back and wants the pizza they ordered. It
      // goes straight back on the board to be made again, at our cost —
      // which is the real sting: a returned pizza doesn't just cost money,
      // it steals oven time from orders that haven't been started yet.
      // It jumps the queue, the way an angry customer does.
      ret.effortDone = 0;
      ret.absorbedThisTick = 0;
      ret.startedTick = null;
      ret.sentBack = true;
      ret.requeuedTick = state.tick;
      ret.queuedTick = state.tick;
      state.queue.unshift(ret);

      todayEvents.push({
        kind: "returned",
        message:
          "#" + ret.id + " " + ret.typeName + " came back — remaking it for nothing, " +
          "and it's jumped ahead of everyone still waiting. Caught in the kitchen it " +
          "would only have cost us the remake.",
      });
    }

    // 2. Orders arrive. They only become OUR problem if we're open — this is
    //    the demand-side lever: you can decline work instead of accepting it
    //    and delivering it late.
    var rate = DEMAND_BY_HOUR[tickToHour(state.tick - 1)] || 0;
    state.arrivalAccumulator += rate;
    while (state.arrivalAccumulator >= 1) {
      state.arrivalAccumulator -= 1;
      var typeKey = rollComplexity();
      var type = PIZZA_TYPES[typeKey];
      var atCap = p.intakeCap != null && state.today.acceptedCount >= p.intakeCap;
      if (atCap && p.acceptingOrders) {
        // The agreed number is reached: stop, and say so once.
        p.acceptingOrders = false;
        state.closedAtTick = state.tick;
        logEvent(
          state,
          "closed",
          "That's the " + p.intakeCap + " orders we agreed to take on. Shutters down."
        );
      }
      if (!p.acceptingOrders) {
        state.refusedCount += 1;
        state.today.refusedCount += 1;
        todayEvents.push({
          kind: "refused",
          message: "Turned away a " + type.name + " order — we're closed to new orders.",
        });
        continue;
      }
      var order = {
        id: state.nextOrderId++,
        typeKey: typeKey,
        typeName: type.name,
        price: type.price,
        ingredients: type.ingredients,
        effortRequired: rollEffort(typeKey),
        effortDone: 0,
        remakes: 0,
        orderedTick: state.tick,
        // The order goes up on the board and waits a beat before anyone
        // picks it up. See the pull step for why.
        queuedTick: state.tick,
        startedTick: null,
      };
      state.queue.push(order);
      state.today.acceptedCount += 1;
    }

    // 3. The kitchen works. Capacity is workers x 1 effort per tick, shared
    //    across everything on the go — so more pizzas at once means slower
    //    progress on each, which is the whole WIP lesson.
    var kitchenCountAtStart = state.kitchen.length;
    var capacity = p.workers;
    state.kitchen.forEach(function (pizza) {
      pizza.absorbedThisTick = 0;
    });
    var leftover = distributeEffort(state.kitchen, capacity);

    // 4. Pizzas that are finished get checked.
    function runQualityPass() {
      for (var k = state.kitchen.length - 1; k >= 0; k--) {
        var pizza = state.kitchen[k];
        if (pizza.effortDone < pizza.effortRequired) continue;

        var failed = Math.random() < failChanceFor(pizza, kitchenCountAtStart, p.workers);

        // A pizza that has already been sent back once gets made properly
        // the third time — nobody loops forever, and an unbounded remake
        // cycle would just be noise rather than a lesson.
        if (failed && (pizza.returnCount || 0) >= 2) failed = false;

        if (failed) {
          var caught = Math.random() < CAUGHT_IN_KITCHEN_SHARE;
          if (caught && pizza.remakes < 1) {
            // Spotted before it left: remake part of it. Costs time, but no
            // customer ever knows.
            pizza.remakes += 1;
            pizza.effortDone = pizza.effortRequired * (1 - REMAKE_EFFORT_FRACTION);
            state.today.remadeCount += 1;
            todayEvents.push({
              kind: "remake",
              message: "#" + pizza.id + " " + pizza.typeName + " wasn't right — caught it and started again.",
            });
            continue;
          }
          // It went out wrong. The customer will be back.
          state.kitchen.splice(k, 1);
          pizza.returnCount = (pizza.returnCount || 0) + 1;
          finishPizza(state, pizza, true);
          state.pendingReturns.push({
            orderId: pizza.id,
            order: pizza,
            dueTick:
              state.tick +
              RETURN_DELAY_TICKS_MIN +
              Math.floor(Math.random() * (RETURN_DELAY_TICKS_MAX - RETURN_DELAY_TICKS_MIN + 1)),
          });
          continue;
        }

        state.kitchen.splice(k, 1);
        finishPizza(state, pizza, false);
      }
    }

    runQualityPass();

    // 5. Start new pizzas in any free oven slot.
    //
    //    An order cannot be started in the same tick it arrives. It goes up
    //    on the board and is picked up on the next pass — which is both how
    //    a kitchen actually works and the only way the waiting column is
    //    visible at all. Without the beat, an order that arrives into a free
    //    oven is placed and started between two frames, so the board appears
    //    to be skipped entirely and a returned pizza jumping the queue is
    //    never seen. Orders that are ready are still taken in order, so an
    //    order waiting its beat at the front does not hold up the ones
    //    behind it.
    var newlyStarted = [];
    while (state.kitchen.length < p.ovenSlots) {
      var idx = -1;
      for (var qi = 0; qi < state.queue.length; qi++) {
        if (state.queue[qi].queuedTick < state.tick) { idx = qi; break; }
      }
      if (idx === -1) break;
      var next = state.queue.splice(idx, 1)[0];
      next.startedTick = state.tick;
      state.kitchen.push(next);
      newlyStarted.push(next);
    }

    // 6. Capacity the finishers left over goes to what just started, rather
    //    than evaporating — a cook who plates one pizza at 6:10 starts the
    //    next at 6:11.
    if (leftover > 1e-6 && newlyStarted.length) {
      leftover = distributeEffort(newlyStarted, leftover);
      runQualityPass();
    }

    todayEvents.forEach(function (e) {
      logEvent(state, e.kind, e.message);
    });

    snapshot(state, leftover, todayEvents);

    // 7. Closing time.
    if (state.tick >= TICKS_PER_DAY) closeDay(state);

    return state;
  }

  function finishPizza(state, pizza, wrong) {
    pizza.deliveredTick = state.tick;
    pizza.leadTimeMinutes = minutesSince(state, pizza.orderedTick);
    pizza.cookTimeMinutes = minutesSince(state, pizza.startedTick);
    pizza.wrong = wrong;

    // Every bake costs ingredients, including a remake — that's the waste.
    state.today.ingredientCost += pizza.ingredients;

    // The customer only pays once, however many times we make it.
    if (!pizza.revenueCounted) {
      pizza.revenueCounted = true;
      state.today.revenue += pizza.price;
      state.today.deliveredCount += 1;
      state.delivered.push(pizza);
    }
  }

  /**
   * How many more we can expect to get out before closing.
   *
   * Deliberately NOT a calculation from hours of staff available: that is
   * resource-hours capacity planning, which is the habit flow metrics
   * exist to replace. This is a forecast from throughput actually
   * observed — today's once there is enough of it, previous nights'
   * before that — which means on the first night it has nothing to say,
   * and says so. Capacity is learned, not computed.
   */
  function capacityForecast(state) {
    var ticksLeft = Math.max(0, TICKS_PER_DAY - state.tick);
    var hoursLeft = (ticksLeft * MINUTES_PER_TICK) / 60;

    var pastRates = state.days
      .map(function (d) { return d.pizzasPerHour; })
      .filter(function (r) { return r > 0; });
    var todayDelivered = state.today.deliveredCount;
    var hoursSoFar = (state.tick * MINUTES_PER_TICK) / 60;
    var todayRate = hoursSoFar > 0 ? todayDelivered / hoursSoFar : 0;

    // Today's evidence takes over as it accumulates; eight pizzas in is
    // enough to trust it over the memory of other nights.
    var weight = Math.min(1, todayDelivered / 8);
    var pastMean = pastRates.length
      ? pastRates.reduce(function (a, b) { return a + b; }, 0) / pastRates.length
      : 0;

    if (!pastRates.length && todayDelivered < 3) {
      return { known: false, hoursLeft: hoursLeft };
    }

    var rate = pastRates.length
      ? weight * todayRate + (1 - weight) * pastMean
      : todayRate;

    // The spread of past nights is the honest error bar. With one night or
    // none to go on, a quarter either way says "we are guessing".
    var spread = 0.25;
    if (pastRates.length > 1) {
      var lo = Math.min.apply(null, pastRates);
      var hi = Math.max.apply(null, pastRates);
      spread = Math.max(0.1, (hi - lo) / 2 / Math.max(0.1, pastMean));
    }

    var mid = rate * hoursLeft;
    return {
      known: true,
      nights: pastRates.length,
      rate: rate,
      hoursLeft: hoursLeft,
      mid: mid,
      low: Math.max(0, mid * (1 - spread)),
      high: mid * (1 + spread),
    };
  }

  function rollingStats(state) {
    var delivered = state.delivered;
    var n = delivered.length;
    var leadSum = 0,
      cookSum = 0;
    for (var i = 0; i < n; i++) {
      leadSum += delivered[i].leadTimeMinutes;
      cookSum += delivered[i].cookTimeMinutes;
    }
    var hoursElapsed = (state.tick * MINUTES_PER_TICK) / 60;
    return {
      avgLeadMinutes: n ? leadSum / n : 0,
      avgCookMinutes: n ? cookSum / n : 0,
      pizzasPerHour: hoursElapsed > 0 ? n / hoursElapsed : 0,
      returnRate: n ? state.today.returnedCount / n : 0,
    };
  }

  function snapshot(state, idleCapacity, todayEvents) {
    var stats = rollingStats(state);
    state.history.push({
      day: state.day,
      tick: state.tick,
      clock: tickToClock(state.tick),
      queueSize: state.queue.length,
      kitchenSize: state.kitchen.length,
      deliveredCount: state.delivered.length,
      acceptedCount: state.today.acceptedCount,
      avgLeadMinutes: stats.avgLeadMinutes,
      avgCookMinutes: stats.avgCookMinutes,
      pizzasPerHour: stats.pizzasPerHour,
      returnRate: stats.returnRate,
      idleCapacity: idleCapacity,
      profitSoFar: dayProfit(state),
      events: todayEvents || [],
    });
  }

  /**
   * Wages are accrued as the day runs rather than charged in full at
   * opening. Charging the lump up front made the till read as a heavy loss
   * all morning and claw back by evening, which buried the signal the
   * player is supposed to read — and it made sending staff home during the
   * afternoon lull worth nothing, when it should be the obvious move.
   */
  function dayProfit(state) {
    var t = state.today;
    return t.revenue - t.refunds - t.ingredientCost - t.goodwill - t.wagesAccrued;
  }

  /** What the staff currently on shift cost per 15-minute slice. */
  function wagesPerTick(state) {
    return (state.params.workers * WAGE_PER_WORKER_PER_DAY) / TICKS_PER_DAY;
  }

  /**
   * Closing time. Anyone still waiting — in the queue or mid-bake — goes
   * home without a pizza. We lose the sale, and for anything already in the
   * oven we've burned the ingredients and the staff time too, which is
   * exactly why accepting an order you can't finish costs more than never
   * accepting it.
   */
  function closeDay(state) {
    var stranded = state.queue.concat(state.kitchen);
    stranded.forEach(function (order) {
      state.walked.push(order);
      state.today.walkedCount += 1;
      state.today.goodwill += WALKED_CUSTOMER_GOODWILL;
      if (order.startedTick != null) {
        // Already started: the ingredients are gone.
        state.today.ingredientCost += order.ingredients;
      }
    });
    if (stranded.length) {
      logEvent(
        state,
        "walked",
        stranded.length + " customer(s) left without a pizza at closing — lost the sale" +
          " and the ingredients on anything already in the oven."
      );
    }
    state.queue = [];
    state.kitchen = [];

    // Pizzas that would have come back tomorrow never do — but we don't get
    // to keep money for a pizza the customer was unhappy with either.
    state.pendingReturns = [];

    var profit = dayProfit(state);
    state.cash += profit;
    var stats = rollingStats(state);
    var settings = condenseChanges(state);

    state.days.push({
      dayNumber: state.day,
      // What the day CLOSED with, and what it opened with. They differ
      // whenever the player adjusted a lever during trading.
      workers: state.params.workers,
      ovenSlots: state.params.ovenSlots,
      startWorkers: settings.start.workers,
      startOvenSlots: settings.start.ovenSlots,
      paramChanges: settings.moves,
      closedEarlyAtTick: state.closedAtTick != null ? state.closedAtTick : null,
      intakeCap: state.params.intakeCap,
      accepted: state.today.acceptedCount,
      refused: state.today.refusedCount,
      delivered: state.today.deliveredCount,
      returned: state.today.returnedCount,
      remade: state.today.remadeCount,
      walked: state.today.walkedCount,
      revenue: state.today.revenue,
      refunds: state.today.refunds,
      ingredientCost: state.today.ingredientCost,
      goodwill: state.today.goodwill,
      wages: state.today.wagesAccrued,
      profit: profit,
      avgLeadMinutes: stats.avgLeadMinutes,
      avgCookMinutes: stats.avgCookMinutes,
      pizzasPerHour: stats.pizzasPerHour,
      // Kept so tomorrow's charts can draw tonight behind them.
      history: state.history.slice(),
    });

    state.dayOver = true;
  }

  /** Roll the shutters into tomorrow: keeps cash and day history. */
  function startNextDay(state) {
    state.day += 1;
    state.tick = 0;
    state.dayOver = false;
    state.arrivalAccumulator = 0;
    state.queue = [];
    state.kitchen = [];
    state.delivered = [];
    state.returned = [];
    state.walked = [];
    state.pendingReturns = [];
    state.refusedCount = 0;
    state.closedAtTick = null;
    state.dayStart = { workers: state.params.workers, ovenSlots: state.params.ovenSlots };
    state.paramChanges = [];
    // Each day starts with the shutters down: opening up is the player's
    // first decision of the morning, and it's what reveals the clock controls.
    state.params.acceptingOrders = false;
    state.today = newDayTotals();
    state.events = [];
    state.history = [];
    return state;
  }

  function latestSnapshot(state) {
    return state.history.length
      ? state.history[state.history.length - 1]
      : {
          day: state.day,
          tick: 0,
          clock: tickToClock(0),
          queueSize: 0,
          kitchenSize: 0,
          deliveredCount: 0,
          acceptedCount: 0,
          avgLeadMinutes: 0,
          avgCookMinutes: 0,
          pizzasPerHour: 0,
          returnRate: 0,
          idleCapacity: 0,
          profitSoFar: 0,
          events: [],
        };
  }

  return {
    MINUTES_PER_TICK: MINUTES_PER_TICK,
    TICKS_PER_DAY: TICKS_PER_DAY,
    OPENING_HOUR: OPENING_HOUR,
    CLOSING_HOUR: CLOSING_HOUR,
    PIZZA_TYPES: PIZZA_TYPES,
    DEFAULT_PARAMS: DEFAULT_PARAMS,
    WAGE_PER_WORKER_PER_DAY: WAGE_PER_WORKER_PER_DAY,
    DEMAND_BY_HOUR: DEMAND_BY_HOUR,
    createShop: createShop,
    setParams: setParams,
    tick: tick,
    closeDay: closeDay,
    startNextDay: startNextDay,
    latestSnapshot: latestSnapshot,
    tickToClock: tickToClock,
    tickToHour: tickToHour,
    dayProfit: dayProfit,
    wagesPerTick: wagesPerTick,
    capacityForecast: capacityForecast,
    CURRENCY: CURRENCY,
    money: money,
  };
});
