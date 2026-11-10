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

  // A full clone per tick, so pressing and holding a chart can rebuild the
  // shop exactly as it stood at that moment.
  var tickHistory = [];
  var scrubTick = null;
  var scrubState = null;
  var wasRunningBeforeScrub = false;

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
    tillRows: $("tillRows"), tillProfit: $("tillProfit"),
    daySummary: $("daySummary"), daySummaryTitle: $("daySummaryTitle"),
    daySummaryText: $("daySummaryText"), daySummaryNextBtn: $("daySummaryNextBtn"),
    dayHistory: $("dayHistory"), dayHistoryBody: $("dayHistoryBody"), dayExplain: $("dayExplain"),
    scrubBanner: $("scrubBanner"), scrubTooltip: $("scrubTooltip"),
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

  function renderGauge(s) {
    var pic = capacityPicture(s);
    var max = Math.max(pic.committed, pic.capacityLeft, 1) * 1.05;
    els.gaugeCommitted.style.height = ((pic.committed / max) * 100).toFixed(1) + "%";
    els.gaugeCapacity.style.height = ((pic.capacityLeft / max) * 100).toFixed(1) + "%";

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
    if (!scrubState) els.playPause.hidden = !clockIsUseful();
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
      showDaySummary();
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

  function showDaySummary() {
    var d = state.days[state.days.length - 1];
    els.daySummaryTitle.textContent =
      "Day " + d.dayNumber + " — " + money(d.profit) + (d.profit >= 0 ? " profit" : " loss");
    var parts = [
      "Took " + d.accepted + " orders and turned away " + d.refused + ".",
      "Delivered " + d.delivered + ".",
    ];
    if (d.walked) parts.push(d.walked + " customer(s) went home empty-handed.");
    if (d.returned) parts.push(d.returned + " came back to be remade.");
    parts.push("Average wait " + Math.round(d.avgLeadMinutes) + " minutes.");
    els.daySummaryText.textContent = parts.join(" ");
    els.daySummary.hidden = false;
  }

  function startNextDay() {
    Shop.startNextDay(state);
    tickHistory = [];
    scrubTick = null;
    scrubState = null;
    Scene.rollSkins();
    els.daySummary.hidden = true;
    setRunning(false);
    renderAll();
  }

  // --- Day history ---------------------------------------------------------
  function recordDay() {
    dayHistory.push(state.days[state.days.length - 1]);
    selectedDayIndex = dayHistory.length - 1;
    renderDayHistory();
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
        "<td>" + d.dayNumber + "</td><td>" + d.workers + "/" + d.ovenSlots + "</td>" +
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
    if (scrubTick == null) { els.scrubBanner.hidden = true; return; }
    els.scrubBanner.hidden = false;
    els.scrubBanner.textContent =
      "Looking back at " + Shop.tickToClock(scrubTick) +
      " — release to return to " + Shop.tickToClock(state.tick);
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
    if (scrubState) showScrubTooltip(clientX, clientY, scrubState);
  }

  function endScrub() {
    if (scrubTick == null) return;
    scrubTick = null;
    scrubState = null;
    els.scrubTooltip.hidden = true;
    renderAll();
    if (wasRunningBeforeScrub) { wasRunningBeforeScrub = false; setRunning(true); }
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
        wasRunningBeforeScrub = running;
        if (running) setRunning(false);
        applyScrub(t, e.clientX, e.clientY);
      });
      c.addEventListener("pointermove", function (e) {
        if (scrubTick == null) return;
        applyScrub(Charts.dayAtClientX(c, e.clientX), e.clientX, e.clientY);
      });
      ["pointerup", "pointercancel"].forEach(function (evt) {
        c.addEventListener(evt, endScrub);
      });
    });
    window.addEventListener("pointerup", endScrub);
    window.addEventListener("blur", endScrub);
  }

  // --- Controls ------------------------------------------------------------
  function adjust(param, delta, min, max) {
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

  els.playPause.addEventListener("click", function () { setRunning(!running); });
  els.daySummaryNextBtn.addEventListener("click", startNextDay);
  els.speed.addEventListener("input", function () { if (running) setRunning(true); });

  // The lever in the scene toggles intake.
  window.onLeverToggle = function () {
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
