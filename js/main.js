/**
 * main.js — The Pizza Shop
 *
 * Wires the shop simulation to the DOM: controls, the open/closed intake
 * toggle, the capacity gauge, the board, the till, charts (with press-and-
 * hold scrubbing) and the end-of-day summary.
 */

(function () {
  "use strict";

  var SPEED_INTERVALS_MS = [1400, 900, 550, 300, 140];
  var SPEED_LABELS = ["Very slow", "Slow", "Normal", "Fast", "Very fast"];
  var MAX_EFFORT_FOR_BAR = Shop.PIZZA_TYPES.F.effort * 1.3;

  var state = Shop.createShop();
  var running = false;
  var intervalId = null;

  // Full state clones per tick, so a past moment can be reconstructed exactly
  // while scrubbing a chart.
  var tickHistory = [];
  var scrubTick = null;
  var scrubState = null;
  var wasRunningBeforeScrub = false;

  var dayHistory = [];
  var selectedDayIndex = null;

  // --- DOM ---
  var dayValueEl = document.getElementById("dayValue");
  var clockValueEl = document.getElementById("clockValue");
  var cashValueEl = document.getElementById("cashValue");

  var workersInput = document.getElementById("workers");
  var workersValueEl = document.getElementById("workersValue");
  var ovenSlotsInput = document.getElementById("ovenSlots");
  var ovenSlotsValueEl = document.getElementById("ovenSlotsValue");
  var speedInput = document.getElementById("speed");
  var speedValueEl = document.getElementById("speedValue");

  var runBtn = document.getElementById("runBtn");
  var stepBtn = document.getElementById("stepBtn");
  var nextDayBtn = document.getElementById("nextDayBtn");
  var intakeToggle = document.getElementById("intakeToggle");

  var gaugeCommittedEl = document.getElementById("gaugeCommitted");
  var gaugeCapacityEl = document.getElementById("gaugeCapacity");
  var gaugeCommittedNumEl = document.getElementById("gaugeCommittedNum");
  var gaugeCapacityNumEl = document.getElementById("gaugeCapacityNum");
  var gaugeVerdictEl = document.getElementById("gaugeVerdict");
  var capacityGaugeEl = document.getElementById("capacityGauge");

  var eventListEl = document.getElementById("eventList");
  var eventPanelEl = document.getElementById("eventPanel");

  var queueListEl = document.getElementById("queueList");
  var kitchenListEl = document.getElementById("kitchenList");
  var deliveredListEl = document.getElementById("deliveredList");
  var queueCountEl = document.getElementById("queueCount");
  var kitchenCountEl = document.getElementById("kitchenCount");
  var deliveredCountEl = document.getElementById("deliveredCount");

  var leadValueEl = document.getElementById("leadValue");
  var cookValueEl = document.getElementById("cookValue");
  var rateValueEl = document.getElementById("rateValue");
  var sentBackValueEl = document.getElementById("sentBackValue");

  var tillRowsEl = document.getElementById("tillRows");
  var tillProfitEl = document.getElementById("tillProfit");

  var daySummaryEl = document.getElementById("daySummary");
  var daySummaryTitleEl = document.getElementById("daySummaryTitle");
  var daySummaryTextEl = document.getElementById("daySummaryText");
  var daySummaryNextBtn = document.getElementById("daySummaryNextBtn");

  var dayHistoryEl = document.getElementById("dayHistory");
  var dayHistoryBodyEl = document.getElementById("dayHistoryBody");
  var dayExplainEl = document.getElementById("dayExplain");

  var scrubBannerEl = document.getElementById("scrubBanner");
  var scrubTooltipEl = document.getElementById("scrubTooltip");

  var chartContainers = {
    queue: document.getElementById("chartQueue"),
    kitchen: document.getElementById("chartKitchen"),
    lead: document.getElementById("chartLead"),
    rate: document.getElementById("chartRate"),
  };

  var CHART_SPECS = [
    { key: "queue", field: "queueSize", color: "#e2863d", decimals: 0, unit: "", label: "Orders waiting" },
    { key: "kitchen", field: "kitchenSize", color: "#c1452f", decimals: 0, unit: "", label: "In the kitchen" },
    { key: "lead", field: "avgLeadMinutes", color: "#7b4bc9", decimals: 0, unit: "m", label: "Wait" },
    { key: "rate", field: "pizzasPerHour", color: "#2f9e5e", decimals: 1, unit: "/h", label: "Pizzas per hour" },
  ];

  // --- Capacity gauge -------------------------------------------------------
  // The heart of the game: can the kitchen still finish everything it has
  // taken on before closing? Capacity is bounded by BOTH hands and oven
  // slots, since one pizza can only absorb one pair of hands at a time.
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
      ratio: capacityLeft > 0 ? committed / capacityLeft : committed > 0 ? Infinity : 0,
      ticksLeft: ticksLeft,
    };
  }

  function renderGauge(s) {
    var pic = capacityPicture(s);
    var max = Math.max(pic.committed, pic.capacityLeft, 1) * 1.05;

    gaugeCommittedEl.style.width = ((pic.committed / max) * 100).toFixed(1) + "%";
    gaugeCapacityEl.style.width = ((pic.capacityLeft / max) * 100).toFixed(1) + "%";
    gaugeCommittedNumEl.textContent = Math.round(pic.committed);
    gaugeCapacityNumEl.textContent = Math.round(pic.capacityLeft);

    capacityGaugeEl.classList.remove("gauge--ok", "gauge--tight", "gauge--over");
    var verdict;
    if (pic.ratio > 1) {
      capacityGaugeEl.classList.add("gauge--over");
      verdict = "Too much — someone won't get their pizza";
    } else if (pic.ratio > 0.8) {
      capacityGaugeEl.classList.add("gauge--tight");
      verdict = "Tight — no room for surprises";
    } else {
      capacityGaugeEl.classList.add("gauge--ok");
      verdict = pic.committed === 0 ? "Kitchen's clear" : "Comfortably on track";
    }
    gaugeVerdictEl.textContent = verdict;
  }

  // --- Rendering ------------------------------------------------------------
  function renderBoard(s) {
    Render.renderQueue(s, queueListEl, queueCountEl, Shop.MINUTES_PER_TICK);
    Render.renderKitchen(s, kitchenListEl, kitchenCountEl, Shop.MINUTES_PER_TICK, MAX_EFFORT_FOR_BAR);
    Render.renderDelivered(s, deliveredListEl, deliveredCountEl);
  }

  function renderTiles(s) {
    var snap = Shop.latestSnapshot(s);
    leadValueEl.textContent = Math.round(snap.avgLeadMinutes) + " min";
    cookValueEl.textContent = Math.round(snap.avgCookMinutes) + " min";
    rateValueEl.textContent = snap.pizzasPerHour.toFixed(1);
    sentBackValueEl.textContent = s.today.returnedCount;
  }

  function renderCharts() {
    CHART_SPECS.forEach(function (spec) {
      var points = state.history.map(function (h) {
        return { day: h.tick, value: h[spec.field] };
      });
      Charts.renderLineChart(chartContainers[spec.key], points, {
        color: spec.color,
        unit: spec.unit,
        decimals: spec.decimals,
        label: spec.label,
        height: 54,
        markerDay: scrubTick,
      });
    });
  }

  function renderEvents(s) {
    eventListEl.innerHTML = "";
    var recent = s.events.slice(-5).reverse();
    if (!recent.length) {
      var hint = document.createElement("li");
      hint.className = "insight-hint";
      hint.textContent = s.tick === 0
        ? "Press “Open up” to start the day. Orders will start coming in."
        : "All quiet — nothing has gone wrong yet.";
      eventListEl.appendChild(hint);
      eventPanelEl.classList.remove("insight-panel--alert");
      return;
    }
    var hasBad = recent.some(function (e) {
      return e.kind === "returned" || e.kind === "walked";
    });
    eventPanelEl.classList.toggle("insight-panel--alert", hasBad);
    recent.forEach(function (e) {
      var li = document.createElement("li");
      li.textContent = Shop.tickToClock(e.tick) + " — " + e.message;
      eventListEl.appendChild(li);
    });
  }

  function renderAll() {
    var view = scrubState || state;
    dayValueEl.textContent = view.day;
    clockValueEl.textContent = Shop.tickToClock(view.tick);
    cashValueEl.textContent = Render.money(view.cash);
    renderBoard(view);
    renderTiles(view);
    Render.renderTill(view, tillRowsEl, tillProfitEl, Shop.WAGE_PER_WORKER_PER_DAY);
    renderGauge(view);
    renderEvents(view);
    renderCharts();
    updateScrubBanner();
  }

  // --- Day loop -------------------------------------------------------------
  function cloneState(s) {
    return JSON.parse(JSON.stringify(s));
  }

  function doTick() {
    if (state.dayOver) return;
    tickHistory.push(cloneState(state));
    if (tickHistory.length > Shop.TICKS_PER_DAY + 5) tickHistory.shift();
    Shop.tick(state);
    if (state.dayOver) {
      setRunning(false);
      recordDay();
      showDaySummary();
    }
    renderAll();
  }

  function setRunning(next) {
    if (state.dayOver) next = false;
    running = next;
    runBtn.textContent = running ? "Pause" : state.tick === 0 ? "Open up" : "Resume";
    runBtn.classList.toggle("is-running", running);
    runBtn.disabled = state.dayOver;
    stepBtn.disabled = state.dayOver;
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (running) intervalId = setInterval(doTick, SPEED_INTERVALS_MS[Number(speedInput.value) - 1]);
  }

  function showDaySummary() {
    var day = state.days[state.days.length - 1];
    daySummaryTitleEl.textContent =
      "Day " + day.dayNumber + " — closing time · " + Render.money(day.profit) +
      (day.profit >= 0 ? " profit" : " loss");

    var parts = [
      "Took " + day.accepted + " orders and turned away " + day.refused + ".",
      "Delivered " + day.delivered + ".",
    ];
    if (day.walked) parts.push(day.walked + " customer(s) went home empty-handed.");
    if (day.returned) parts.push(day.returned + " came back wrong.");
    parts.push("Average wait " + Math.round(day.avgLeadMinutes) + " minutes.");
    daySummaryTextEl.textContent = parts.join(" ");

    daySummaryEl.hidden = false;
    nextDayBtn.hidden = false;
    nextDayBtn.textContent = "Start Day " + (state.day + 1) + " ▶";
  }

  function startNextDay() {
    Shop.startNextDay(state);
    tickHistory = [];
    scrubTick = null;
    scrubState = null;
    daySummaryEl.hidden = true;
    nextDayBtn.hidden = true;
    syncIntakeToggle();
    setRunning(false);
    renderAll();
  }

  // --- Day history ----------------------------------------------------------
  function recordDay() {
    var day = state.days[state.days.length - 1];
    dayHistory.push(day);
    selectedDayIndex = dayHistory.length - 1;
    renderDayHistory();
  }

  function renderDayHistory() {
    if (!dayHistory.length) {
      dayHistoryEl.hidden = true;
      return;
    }
    dayHistoryEl.hidden = false;
    dayHistoryBodyEl.innerHTML = dayHistory
      .map(function (d, i) {
        var classes = [];
        if (i === dayHistory.length - 1) classes.push("run-row--latest");
        if (i === selectedDayIndex) classes.push("run-row--selected");
        return (
          '<tr class="' + classes.join(" ") + '" data-day-index="' + i +
          '" tabindex="0" role="button" aria-label="Explain day ' + d.dayNumber + '">' +
          "<td>" + d.dayNumber + "</td>" +
          "<td>" + d.workers + "/" + d.ovenSlots + "</td>" +
          "<td>" + d.accepted + "</td>" +
          "<td>" + d.refused + "</td>" +
          "<td>" + d.delivered + "</td>" +
          "<td>" + d.walked + "</td>" +
          "<td>" + d.returned + "</td>" +
          '<td class="' + (d.profit >= 0 ? "till-pos" : "till-neg") + '">' + Render.money(d.profit) + "</td>" +
          "</tr>"
        );
      })
      .join("");

    dayHistoryBodyEl.querySelectorAll("tr[data-day-index]").forEach(function (tr) {
      function select() {
        selectedDayIndex = Number(tr.getAttribute("data-day-index"));
        renderDayHistory();
      }
      tr.addEventListener("click", select);
      tr.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          select();
        }
      });
    });

    var current = dayHistory[selectedDayIndex];
    var previous = selectedDayIndex > 0 ? dayHistory[selectedDayIndex - 1] : null;
    dayExplainEl.innerHTML =
      '<div class="run-explain-title">Why day ' + current.dayNumber +
      (previous ? " differs from day " + previous.dayNumber : " went the way it did") + "</div>" +
      Explain.dayDifference(current, previous)
        .map(function (p) {
          return "<p>" + p + "</p>";
        })
        .join("");
  }

  // --- Scrubbing ------------------------------------------------------------
  function stateForTick(t) {
    if (t == null) return null;
    if (t === state.tick) return state;
    for (var i = 0; i < tickHistory.length; i++) {
      if (tickHistory[i].tick === t) return tickHistory[i];
    }
    return null;
  }

  function updateScrubBanner() {
    if (!scrubBannerEl) return;
    if (scrubTick == null) {
      scrubBannerEl.hidden = true;
      return;
    }
    scrubBannerEl.hidden = false;
    scrubBannerEl.textContent =
      "Looking back at " + Shop.tickToClock(scrubTick) +
      " — release to return to " + Shop.tickToClock(state.tick);
  }

  function showScrubTooltip(clientX, clientY, view) {
    if (!scrubTooltipEl) return;
    var snap = Shop.latestSnapshot(view);
    var pic = capacityPicture(view);
    var lines = [
      Shop.tickToClock(view.tick),
      snap.queueSize + " waiting · " + snap.kitchenSize + " in the kitchen · " +
        snap.deliveredCount + " delivered",
      "Wait " + Math.round(snap.avgLeadMinutes) + " min · " +
        snap.pizzasPerHour.toFixed(1) + " pizzas/hour",
      view.params.workers + " staff · " + view.params.ovenSlots + " oven slots · " +
        (view.params.acceptingOrders ? "taking orders" : "closed to new orders"),
      pic.ratio > 1
        ? "— More committed than there was time to cook it."
        : "— Committed " + Math.round(pic.committed) + " against " +
          Math.round(pic.capacityLeft) + " of capacity left.",
    ];
    if (snap.events && snap.events.length) lines.push("— " + snap.events[0].message);

    scrubTooltipEl.innerHTML = lines
      .map(function (line, i) {
        return '<div class="' + (i === 0 ? "scrub-tip-title" : "scrub-tip-line") + '">' + line + "</div>";
      })
      .join("");
    scrubTooltipEl.hidden = false;

    var width = 270;
    var left = clientX + 14;
    var maxLeft = document.documentElement.clientWidth - width - 12;
    if (left > maxLeft) left = Math.max(12, clientX - width - 14);
    var top = clientY + 14;
    var maxTop = document.documentElement.clientHeight - scrubTooltipEl.offsetHeight - 12;
    if (top > maxTop) top = Math.max(12, maxTop);
    scrubTooltipEl.style.left = left + window.scrollX + "px";
    scrubTooltipEl.style.top = top + window.scrollY + "px";
    scrubTooltipEl.style.width = width + "px";
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
    if (scrubTooltipEl) scrubTooltipEl.hidden = true;
    renderAll();
    if (wasRunningBeforeScrub) {
      wasRunningBeforeScrub = false;
      setRunning(true);
    }
  }

  function bindScrubbing() {
    Object.keys(chartContainers).forEach(function (key) {
      var container = chartContainers[key];
      if (!container) return;
      container.classList.add("chart-scrubbable");

      container.addEventListener("pointerdown", function (e) {
        var t = Charts.dayAtClientX(container, e.clientX);
        if (t == null) return;
        e.preventDefault();
        if (container.setPointerCapture) container.setPointerCapture(e.pointerId);
        wasRunningBeforeScrub = running;
        if (running) setRunning(false);
        applyScrub(t, e.clientX, e.clientY);
      });
      container.addEventListener("pointermove", function (e) {
        if (scrubTick == null) return;
        applyScrub(Charts.dayAtClientX(container, e.clientX), e.clientX, e.clientY);
      });
      ["pointerup", "pointercancel"].forEach(function (evt) {
        container.addEventListener(evt, endScrub);
      });
    });
    window.addEventListener("pointerup", endScrub);
    window.addEventListener("blur", endScrub);
  }

  // --- Controls -------------------------------------------------------------
  function syncLabels() {
    workersValueEl.textContent = workersInput.value;
    ovenSlotsValueEl.textContent = ovenSlotsInput.value;
    speedValueEl.textContent = SPEED_LABELS[Number(speedInput.value) - 1];
  }

  function syncIntakeToggle() {
    var open = state.params.acceptingOrders;
    intakeToggle.classList.toggle("is-open", open);
    intakeToggle.classList.toggle("is-closed", !open);
    intakeToggle.setAttribute("aria-pressed", open ? "true" : "false");
    intakeToggle.querySelector(".intake-state").textContent = open ? "OPEN" : "CLOSED";
  }

  function onSliderChange() {
    Shop.setParams(state, {
      workers: Number(workersInput.value),
      ovenSlots: Number(ovenSlotsInput.value),
    });
    syncLabels();
    if (!running) renderAll();
  }

  workersInput.addEventListener("input", onSliderChange);
  ovenSlotsInput.addEventListener("input", onSliderChange);
  speedInput.addEventListener("input", function () {
    syncLabels();
    if (running) setRunning(true);
  });

  intakeToggle.addEventListener("click", function () {
    Shop.setParams(state, { acceptingOrders: !state.params.acceptingOrders });
    if (!state.params.acceptingOrders) state.closedAtTick = state.tick;
    syncIntakeToggle();
    renderAll();
  });

  runBtn.addEventListener("click", function () {
    setRunning(!running);
  });
  stepBtn.addEventListener("click", function () {
    setRunning(false);
    doTick();
  });
  nextDayBtn.addEventListener("click", startNextDay);
  daySummaryNextBtn.addEventListener("click", startNextDay);

  // Initial paint.
  bindScrubbing();
  syncLabels();
  syncIntakeToggle();
  onSliderChange();
  renderAll();
})();
