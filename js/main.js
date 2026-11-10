/**
 * main.js — The Pizza Shop
 *
 * Drives the simulation and keeps the illustrated scene and the instruments
 * in step with it. The scene (scene.js) is an honest read-out of state; this
 * file owns the clock, the levers, the day loop and the overlaid panels.
 */

(function () {
  "use strict";

  var SPEED_INTERVALS_MS = [1500, 950, 600, 320, 150];

  var state = Shop.createShop();
  var running = false;
  var intervalId = null;

  // A full clone per tick, so clicking back along a chart can rebuild the
  // shop exactly as it stood at that moment.
  var tickHistory = [];
  var scrubTick = null;
  var scrubState = null;
  var resumeAfterScrub = false;
  var dragging = false;

  var dayHistory = [];
  var selectedDayIndex = null;

  var $ = function (id) { return document.getElementById(id); };

  var els = {
    stage: $("stage"), scene: $("scene"), loading: $("loading"),
    day: $("dayValue"), cash: $("cashValue"),
    workersValue: $("workersValue"), ovenSlotsValue: $("ovenSlotsValue"),
    wageCost: $("wageCost"),
    workersUp: $("workersUp"), workersDown: $("workersDown"),
    ovenUp: $("ovenUp"), ovenDown: $("ovenDown"),
    playPause: $("playPauseBtn"), speed: $("speed"),
    lead: $("leadValue"), cook: $("cookValue"), rate: $("rateValue"), sentBack: $("sentBackValue"),
    gauge: $("capacityGauge"), gaugeCommitted: $("gaugeCommitted"),
    gaugeCapacity: $("gaugeCapacity"), gaugeVerdict: $("gaugeVerdict"),
    gaugeCommittedNum: $("gaugeCommittedNum"), gaugeCapacityNum: $("gaugeCapacityNum"),
    tillRows: $("tillRows"), tillProfit: $("tillProfit"),
    daySummary: $("daySummary"), daySummaryTitle: $("daySummaryTitle"),
    daySummaryText: $("daySummaryText"), daySummaryNextBtn: $("daySummaryNextBtn"),
    dayHistory: $("dayHistory"), dayHistoryBody: $("dayHistoryBody"), dayExplain: $("dayExplain"),
    daySummaryNote: $("daySummaryNote"),
    scrubBanner: $("scrubBanner"), scrubTooltip: $("scrubTooltip"),
    scrubBannerText: $("scrubBannerText"), scrubBack: $("scrubBackBtn"),
  };

  var chartContainers = {
    queue: $("chartQueue"), kitchen: $("chartKitchen"),
    lead: $("chartLead"), rate: $("chartRate"),
  };
  var CHART_SPECS = [
    { key: "queue", field: "queueSize", color: "#e2863d", decimals: 0, unit: "", label: "Orders waiting" },
    { key: "kitchen", field: "kitchenSize", color: "#c1452f", decimals: 0, unit: "", label: "In the kitchen" },
    { key: "lead", field: "avgLeadMinutes", color: "#7b4bc9", decimals: 0, unit: "m", label: "Wait" },
    { key: "rate", field: "pizzasPerHour", color: "#2f9e5e", decimals: 1, unit: "/h", label: "Pizzas per hour" },
  ];

  function money(n) {
    var r = Math.round(n);
    return (r < 0 ? "-$" : "$") + Math.abs(r);
  }

  // --- Capacity: can we still finish what we've taken on? ------------------
  // Bounded by BOTH hands and oven slots, because one pizza can only absorb
  // one pair of hands at a time.
  function capacityPicture(s) {
    var ticksLeft = Math.max(0, Shop.TICKS_PER_DAY - s.tick);
    var perTick = Math.min(s.params.workers, s.params.ovenSlots);
    var capacityLeft = ticksLeft * perTick;
    var committed = 0;
    s.queue.concat(s.kitchen).forEach(function (o) {
      committed += o.effortRequired - o.effortDone;
    });
    return {
      committed: committed,
      capacityLeft: capacityLeft,
      ratio: capacityLeft > 0 ? committed / capacityLeft : (committed > 0 ? Infinity : 0),
    };
  }

  /** Kitchen-minutes, in words. The gauge's units are cooking time. */
  function asDuration(minutes) {
    var m = Math.max(0, Math.round(minutes));
    if (m < 60) return m + "m";
    return Math.floor(m / 60) + "h " + (m % 60) + "m";
  }

  function renderGauge(s) {
    var pic = capacityPicture(s);

    // Both bars are drawn against a FIXED scale — a whole day's cooking at
    // this staffing — so they can be compared over time. Scaling to the
    // current values instead (as this did) pinned whichever bar was larger
    // at full height every render, so "time left" never appeared to move
    // even as the day ran out.
    var perTick = Math.max(1, Math.min(s.params.workers, s.params.ovenSlots));
    var dayCapacity = Shop.TICKS_PER_DAY * perTick;
    var scale = Math.max(dayCapacity, pic.committed, 1);

    els.gaugeCommitted.style.height =
      Math.min(100, (pic.committed / scale) * 100).toFixed(1) + "%";
    els.gaugeCapacity.style.height =
      Math.min(100, (pic.capacityLeft / scale) * 100).toFixed(1) + "%";

    // Said in minutes of cooking, which is far more use than an abstract
    // unit: "40m of cooking owed against 3h of kitchen left" explains
    // itself in a way that two unlabelled bars never will.
    if (els.gaugeCommittedNum) {
      els.gaugeCommittedNum.textContent = asDuration((pic.committed / perTick) * Shop.MINUTES_PER_TICK);
    }
    if (els.gaugeCapacityNum) {
      els.gaugeCapacityNum.textContent = asDuration((pic.capacityLeft / perTick) * Shop.MINUTES_PER_TICK);
    }

    els.gauge.classList.remove("gauge--ok", "gauge--tight", "gauge--over");
    var verdict;
    if (pic.ratio > 1) {
      els.gauge.classList.add("gauge--over");
      verdict = "Too much — someone won't get their pizza";
    } else if (pic.ratio > 0.8) {
      els.gauge.classList.add("gauge--tight");
      verdict = "Tight — no room for surprises";
    } else {
      els.gauge.classList.add("gauge--ok");
      verdict = pic.committed === 0 ? "Kitchen's clear" : "Comfortably on track";
    }
    els.gaugeVerdict.textContent = verdict;
  }

  function renderTill(s) {
    var t = s.today;
    var wages = t.wagesAccrued;
    var profit = Shop.dayProfit(s);
    var rows = [
      { label: "Pizzas sold (" + t.deliveredCount + ")", value: t.revenue },
      { label: "Ingredients" + (t.returnedCount ? " (incl. " + t.returnedCount + " remade)" : ""), value: -t.ingredientCost },
      { label: "Lost goodwill", value: -t.goodwill },
      { label: "Wages so far (" + s.params.workers + " on shift)", value: -wages },
    ];
    els.tillRows.innerHTML = rows.map(function (r) {
      var cls = r.value > 0 ? "till-pos" : r.value < 0 ? "till-neg" : "";
      return '<div class="till-row"><span>' + r.label + '</span><span class="' + cls + '">' +
        money(r.value) + "</span></div>";
    }).join("");
    els.tillProfit.textContent = money(profit);
    els.tillProfit.className = "till-profit " + (profit >= 0 ? "till-pos" : "till-neg");
  }

  function renderTiles(s) {
    var snap = Shop.latestSnapshot(s);
    els.lead.textContent = Math.round(snap.avgLeadMinutes) + " min";
    els.cook.textContent = Math.round(snap.avgCookMinutes) + " min";
    els.rate.textContent = snap.pizzasPerHour.toFixed(1);
    els.sentBack.textContent = s.today.returnedCount;
  }

  function renderCharts() {
    CHART_SPECS.forEach(function (spec) {
      var points = state.history.map(function (h) {
        return { day: h.tick, value: h[spec.field] };
      });
      Charts.renderLineChart(chartContainers[spec.key], points, {
        color: spec.color, unit: spec.unit, decimals: spec.decimals,
        label: spec.label, height: 44, markerDay: scrubTick,
      });
    });
  }

  /**
   * Banked cash plus what today has made so far — where the shop stands
   * right now. Once the day has closed the profit is already banked, so
   * adding it again would count it twice.
   */
  function runningTotal(s) {
    return s.dayOver ? s.cash : s.cash + Shop.dayProfit(s);
  }

  function renderAll() {
    var view = scrubState || state;
    els.day.textContent = "Day " + view.day;
    els.cash.textContent = money(runningTotal(view));
    els.workersValue.textContent = view.params.workers;
    if (els.wageCost) {
      els.wageCost.textContent =
        "$" + Shop.WAGE_PER_WORKER_PER_DAY + " each = " +
        money(view.params.workers * Shop.WAGE_PER_WORKER_PER_DAY) + "/day";
    }
    els.ovenSlotsValue.textContent = view.params.ovenSlots;
    Scene.render(view);
    renderTiles(view);
    renderTill(view);
    renderGauge(view);
    renderCharts();
    updateScrubBanner();
    els.playPause.hidden = !clockIsUseful();
    updateDayPanel();
  }

  // --- Day loop ------------------------------------------------------------
  function cloneState(s) { return JSON.parse(JSON.stringify(s)); }

  function doTick() {
    if (state.dayOver) return;
    tickHistory.push(cloneState(state));
    if (tickHistory.length > Shop.TICKS_PER_DAY + 4) tickHistory.shift();
    Shop.tick(state);
    if (state.dayOver) {
      setRunning(false);
      recordDay();
    }
    renderAll();
  }

  /**
   * Whether running the clock would actually do anything. Hidden before the
   * shutters go up, so opening the shop is the first thing a player does and
   * the control appears as a result; hidden again once the day is over and
   * there is nothing left to cook.
   */
  function clockIsUseful() {
    if (state.dayOver) return false;
    if (state.params.acceptingOrders) return true;       // open: orders are coming
    return state.queue.length + state.kitchen.length > 0; // closed, but still cooking
  }

  function setRunning(next) {
    if (state.dayOver || !clockIsUseful()) next = false;
    running = next;
    els.playPause.classList.toggle("is-running", running);
    els.playPause.setAttribute("aria-label", running ? "Pause" : "Start the clock");
    els.playPause.hidden = !clockIsUseful();
    if (intervalId) { clearInterval(intervalId); intervalId = null; }
    if (running) {
      intervalId = setInterval(doTick, SPEED_INTERVALS_MS[Number(els.speed.value) - 1]);
    }
  }

  function startOf(d, key) {
    var v = key === "workers" ? d.startWorkers : d.startOvenSlots;
    return v == null ? d[key] : v;
  }

  /**
   * How the day was actually run, including anything moved part-way
   * through. Reporting only the settings as they stood at closing time
   * quietly misreports every day you adjusted — and adjusting is the point.
   */
  function settingsSentence(d) {
    var base = "Ran with " + startOf(d, "workers") + " staff and " +
      startOf(d, "ovenSlots") + " oven slots";
    var moves = d.paramChanges || [];
    if (!moves.length) return base + " all day.";
    // Listed in full up to three; past that the detail belongs in the
    // history below, not in a card that would grow off the counter.
    var shown = moves.slice(0, 3).map(function (m) {
      return (m.param === "workers" ? "staff" : "oven slots") +
        " to " + m.to + " at " + Shop.tickToClock(m.tick);
    });
    var tail = moves.length > 3 ? ", and " + (moves.length - 3) + " more change" +
      (moves.length - 3 === 1 ? "" : "s") : "";
    return base + ", then " + shown.join(", then ") + tail +
      " — finishing on " + d.workers + " staff and " + d.ovenSlots + " oven slots.";
  }

  /** Closed to new orders, nothing left to cook, and the clock not yet out. */
  function dayCanBeWrappedUp() {
    return !state.dayOver && !state.params.acceptingOrders &&
      state.queue.length + state.kitchen.length === 0 && state.tick > 0;
  }

  /**
   * The day's card. It is docked above the till rather than thrown across
   * the middle of the shop, because the end of a day is exactly when you
   * want to scrub back through the charts and look at what happened — and
   * a panel in the way of that is a panel in the way of the lesson.
   */
  function updateDayPanel() {
    if (state.dayOver) {
      var d = state.days[state.days.length - 1];
      if (!d) { els.daySummary.hidden = true; return; }
      els.daySummaryTitle.textContent =
        "Day " + d.dayNumber + " — " + money(Math.abs(d.profit)) +
        (d.profit >= 0 ? " profit" : " loss");
      var parts = [
        "Took " + d.accepted + ", turned away " + d.refused + ", delivered " + d.delivered + ".",
      ];
      if (d.walked) parts.push(d.walked + " went home empty-handed.");
      if (d.returned) parts.push(d.returned + " came back to be remade.");
      parts.push("Average wait " + Math.round(d.avgLeadMinutes) + " min.");
      parts.push(settingsSentence(d));
      els.daySummaryText.textContent = parts.join(" ");
      els.daySummaryNote.textContent = "Click along any chart to see what the shop looked like at that moment.";
      els.daySummaryNextBtn.textContent = "Start the next day \u25B8";
      els.daySummary.dataset.mode = "over";
      els.daySummary.hidden = false;
      return;
    }

    if (dayCanBeWrappedUp()) {
      els.daySummaryTitle.textContent = "Nothing left to cook";
      els.daySummaryText.textContent =
        "It's " + Shop.tickToClock(state.tick) + ", the kitchen is clear and you're not taking orders. " +
        "Pull the lever to open up again, or call it a night.";
      els.daySummaryNote.textContent = "Staff go home when you close, so the wages stop here.";
      els.daySummaryNextBtn.textContent = "Close up for the night \u25B8";
      els.daySummary.dataset.mode = "ready";
      els.daySummary.hidden = false;
      return;
    }

    els.daySummary.hidden = true;
  }

  /** Shut up shop early. Nothing is in flight, so nothing is lost. */
  function closeUpEarly() {
    if (!dayCanBeWrappedUp()) return;
    setRunning(false);
    Shop.closeDay(state);
    recordDay();
    renderAll();
  }

  function startNextDay() {
    Shop.startNextDay(state);
    tickHistory = [];
    scrubTick = null;
    scrubState = null;
    Scene.rollSkins();
    setRunning(false);
    renderAll();
  }

  // --- Day history ---------------------------------------------------------
  function recordDay() {
    dayHistory.push(state.days[state.days.length - 1]);
    selectedDayIndex = dayHistory.length - 1;
    renderDayHistory();
  }

  /** "3/4\u21923" — staffing and ovens, with any mid-day move shown as a move. */
  function settingCell(d) {
    var w = startOf(d, "workers");
    var o = startOf(d, "ovenSlots");
    return (w === d.workers ? w : w + "\u2192" + d.workers) + " / " +
      (o === d.ovenSlots ? o : o + "\u2192" + d.ovenSlots);
  }

  function renderDayHistory() {
    if (!dayHistory.length) { els.dayHistory.hidden = true; return; }
    els.dayHistory.hidden = false;
    els.dayHistoryBody.innerHTML = dayHistory.map(function (d, i) {
      var cls = [];
      if (i === dayHistory.length - 1) cls.push("run-row--latest");
      if (i === selectedDayIndex) cls.push("run-row--selected");
      return '<tr class="' + cls.join(" ") + '" data-day-index="' + i +
        '" tabindex="0" role="button" aria-label="Explain day ' + d.dayNumber + '">' +
        "<td>" + d.dayNumber + "</td><td>" + settingCell(d) + "</td>" +
        "<td>" + d.accepted + "</td><td>" + d.refused + "</td><td>" + d.delivered + "</td>" +
        "<td>" + d.walked + "</td><td>" + d.returned + "</td>" +
        '<td class="' + (d.profit >= 0 ? "till-pos" : "till-neg") + '">' + money(d.profit) + "</td></tr>";
    }).join("");

    els.dayHistoryBody.querySelectorAll("tr[data-day-index]").forEach(function (tr) {
      function select() {
        selectedDayIndex = Number(tr.getAttribute("data-day-index"));
        renderDayHistory();
      }
      tr.addEventListener("click", select);
      tr.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); }
      });
    });

    var cur = dayHistory[selectedDayIndex];
    var prev = selectedDayIndex > 0 ? dayHistory[selectedDayIndex - 1] : null;
    els.dayExplain.innerHTML =
      '<div class="run-explain-title">Why day ' + cur.dayNumber +
      (prev ? " differs from day " + prev.dayNumber : " went the way it did") + "</div>" +
      Explain.dayDifference(cur, prev).map(function (p) { return "<p>" + p + "</p>"; }).join("");
  }

  // --- Scrubbing -----------------------------------------------------------
  function stateForTick(t) {
    if (t == null) return null;
    if (t === state.tick) return state;
    for (var i = 0; i < tickHistory.length; i++) {
      if (tickHistory[i].tick === t) return tickHistory[i];
    }
    return null;
  }

  function updateScrubBanner() {
    els.stage.classList.toggle("is-frozen", scrubTick != null);
    if (scrubTick == null) { els.scrubBanner.hidden = true; return; }
    els.scrubBanner.hidden = false;
    var note = "";
    if (scrubState) {
      var pic = capacityPicture(scrubState);
      var snap = Shop.latestSnapshot(scrubState);
      note = " · " + snap.queueSize + " waiting, " + snap.kitchenSize + " cooking" +
        (pic.ratio > 1 ? " · already more owed than there was time to cook it" : "");
    }
    els.scrubBannerText.textContent =
      "Frozen at " + Shop.tickToClock(scrubTick) + note;
    els.scrubBack.textContent = state.dayOver
      ? "Back to closing time"
      : "Back to " + Shop.tickToClock(state.tick);
  }

  function showScrubTooltip(clientX, clientY, view) {
    var snap = Shop.latestSnapshot(view);
    var pic = capacityPicture(view);
    var lines = [
      Shop.tickToClock(view.tick),
      snap.queueSize + " waiting · " + snap.kitchenSize + " cooking · " + snap.deliveredCount + " delivered",
      "Wait " + Math.round(snap.avgLeadMinutes) + " min · " + snap.pizzasPerHour.toFixed(1) + " pizzas/hour",
      view.params.workers + " staff · " + view.params.ovenSlots + " oven slots · " +
        (view.params.acceptingOrders ? "taking orders" : "closed to new orders"),
      pic.ratio > 1
        ? "— More committed than there was time to cook it."
        : "— Committed " + Math.round(pic.committed) + " against " + Math.round(pic.capacityLeft) + " left.",
    ];
    if (snap.events && snap.events.length) lines.push("— " + snap.events[0].message);

    els.scrubTooltip.innerHTML = lines.map(function (l, i) {
      return '<div class="' + (i === 0 ? "scrub-tip-title" : "scrub-tip-line") + '">' + l + "</div>";
    }).join("");
    els.scrubTooltip.hidden = false;

    var width = 265;
    var left = clientX + 14;
    if (left > document.documentElement.clientWidth - width - 12) left = Math.max(12, clientX - width - 14);
    var top = clientY + 14;
    var maxTop = document.documentElement.clientHeight - els.scrubTooltip.offsetHeight - 12;
    if (top > maxTop) top = Math.max(12, maxTop);
    els.scrubTooltip.style.left = left + window.scrollX + "px";
    els.scrubTooltip.style.top = top + window.scrollY + "px";
    els.scrubTooltip.style.width = width + "px";
  }

  function applyScrub(t, clientX, clientY) {
    if (t == null) return;
    if (t !== scrubTick) {
      scrubTick = t;
      scrubState = stateForTick(t);
      renderAll();
    }
    // The hovering card is for picking a moment out of the line. Once a
    // moment is chosen the whole shop is showing it, so the card would
    // only be sitting on top of the thing it was describing.
    if (scrubState && dragging) showScrubTooltip(clientX, clientY, scrubState);
    else els.scrubTooltip.hidden = true;
  }

  /**
   * Let the clock go again, back at the present. A frozen moment sticks
   * until it is dismissed — holding the mouse still to keep a chart open
   * means you can't point at anything you're looking at.
   */
  function endScrub(resume) {
    if (scrubTick == null) return;
    scrubTick = null;
    scrubState = null;
    dragging = false;
    els.scrubTooltip.hidden = true;
    var wanted = resumeAfterScrub;
    resumeAfterScrub = false;
    renderAll();
    if (resume || wanted) setRunning(true);
  }

  function bindScrubbing() {
    Object.keys(chartContainers).forEach(function (key) {
      var c = chartContainers[key];
      if (!c) return;
      c.classList.add("chart-scrubbable");
      c.addEventListener("pointerdown", function (e) {
        var t = Charts.dayAtClientX(c, e.clientX);
        if (t == null) return;
        e.preventDefault();
        if (c.setPointerCapture) c.setPointerCapture(e.pointerId);
        dragging = true;
        // Freezing the shop pauses it; letting the clock run on behind a
        // frozen picture would make the picture a lie within a second.
        if (running) { resumeAfterScrub = true; setRunning(false); }
        applyScrub(t, e.clientX, e.clientY);
      });
      // Dragging sweeps through the day; releasing leaves it where you let go.
      c.addEventListener("pointermove", function (e) {
        if (!dragging) return;
        applyScrub(Charts.dayAtClientX(c, e.clientX), e.clientX, e.clientY);
      });
      ["pointerup", "pointercancel"].forEach(function (evt) {
        c.addEventListener(evt, function () {
          dragging = false;
          els.scrubTooltip.hidden = true;
          updateScrubBanner();
        });
      });
    });
    window.addEventListener("pointerup", function () { dragging = false; });
    els.scrubBack.addEventListener("click", function () { endScrub(false); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") endScrub(false);
    });
  }

  // --- Controls ------------------------------------------------------------
  function adjust(param, delta, min, max) {
    // Changing a lever while looking at the past would apply to the present
    // and show nothing, so come back to now first.
    endScrub(false);
    var next = Math.max(min, Math.min(max, state.params[param] + delta));
    var patch = {};
    patch[param] = next;
    Shop.setParams(state, patch);
    renderAll();
  }

  els.workersUp.addEventListener("click", function () { adjust("workers", 1, 1, 8); });
  els.workersDown.addEventListener("click", function () { adjust("workers", -1, 1, 8); });
  els.ovenUp.addEventListener("click", function () { adjust("ovenSlots", 1, 1, 8); });
  els.ovenDown.addEventListener("click", function () { adjust("ovenSlots", -1, 1, 8); });

  els.playPause.addEventListener("click", function () {
    // Starting the clock again means coming back to the present.
    if (scrubTick != null) { endScrub(true); return; }
    setRunning(!running);
  });
  els.daySummaryNextBtn.addEventListener("click", function () {
    if (state.dayOver) startNextDay();
    else closeUpEarly();
  });
  els.speed.addEventListener("input", function () { if (running) setRunning(true); });

  // The lever in the scene toggles intake.
  window.onLeverToggle = function () {
    endScrub(false);
    Shop.setParams(state, { acceptingOrders: !state.params.acceptingOrders });
    // Closing up with an empty kitchen retires the clock; opening reveals it.
    setRunning(running && clockIsUseful());
    renderAll();
  };

  // --- Boot ----------------------------------------------------------------
  // Test hook: the 15-minute button is gone from the interface, but tests
  // still need to advance the clock deterministically.
  window.PizzaShop = {
    step: function () { setRunning(false); doTick(); },
    getState: function () { return state; },
  };

  Assets.loadAll()
    .then(function () {
      els.loading.remove();
      Scene.init(els.scene);
      bindScrubbing();
      // Start with the shutters down so opening up is the first decision.
      Shop.setParams(state, { acceptingOrders: false });
      setRunning(false);
      renderAll();
    })
    .catch(function (err) {
      els.loading.textContent = "Couldn't load the shop artwork: " + err.message;
      console.error(err);
    });
})();
