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
  // The rules card greets the player once; after that it is on request.
  var openedOnce = false;
  // "guided" runs the five scripted nights, each with a question before it.
  var mode = null;
  // What the player committed to before tonight, before they could see it.
  var prediction = null;

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
    capUp: $("capUp"), capDown: $("capDown"), capValue: $("capValue"),
    playPause: $("playPauseBtn"), speed: $("speed"),
    lead: $("leadValue"), cook: $("cookValue"), rate: $("rateValue"), sentBack: $("sentBackValue"),
    eff: $("effValue"), effFill: $("effFill"),
    gauge: $("capacityGauge"), gaugeCommitted: $("gaugeCommitted"),
    gaugeCapacity: $("gaugeCapacity"), gaugeVerdict: $("gaugeVerdict"),
    gaugeCommittedNum: $("gaugeCommittedNum"), gaugeCapacityNum: $("gaugeCapacityNum"),
    tillRows: $("tillRows"), tillProfit: $("tillProfit"),
    daySummary: $("daySummary"), daySummaryTitle: $("daySummaryTitle"),
    daySummaryText: $("daySummaryText"), daySummaryNextBtn: $("daySummaryNextBtn"),
    dayHistory: $("dayHistory"), dayHistoryBody: $("dayHistoryBody"), dayExplain: $("dayExplain"),
    daySummaryNote: $("daySummaryNote"),
    startScreen: $("startScreen"), startGuided: $("startGuided"), startFree: $("startFree"),
    predictCard: $("predictCard"), predictDay: $("predictDay"), predictTitle: $("predictTitle"),
    predictAsk: $("predictAsk"), predictNote: $("predictNote"), predictGo: $("predictGoBtn"),
    predictSetup: $("predictSetup"),
    predictNumber: $("predictNumber"), predictValue: $("predictValue"),
    predictUp: $("predictUp"), predictDown: $("predictDown"), predictUnit: $("predictUnit"),
    predictOptions: $("predictOptions"),
    termsToggle: $("termsToggle"), rulesLink: $("rulesLink"),
    rulesCard: $("rulesCard"), rulesList: $("rulesList"), rulesClose: $("rulesCloseBtn"),
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

  var money = Shop.money;

  // --- Capacity: can we still finish what we've taken on? ------------------
  // Bounded by BOTH hands and oven slots, because one pizza can only absorb
  // one pair of hands at a time.
  /**
   * The night's plan, counted in orders rather than hours.
   *
   * It used to measure both sides in hours of cooking: work owed against
   * staff-hours left. That is resource-hours capacity planning, and it is
   * the habit flow metrics exist to replace — available from the first
   * minute, authoritative-looking, and worth very little. Owed is now a
   * count of orders, and capacity is a forecast from throughput actually
   * observed, which means on the first night it has nothing to say and
   * admits it.
   */
  function capacityPicture(s) {
    var owed = s.dayOver ? s.walked.length : s.queue.length + s.kitchen.length;
    var forecast = Shop.capacityForecast(s);
    return {
      owed: owed,
      forecast: forecast,
      unfinished: s.dayOver ? s.walked.length : 0,
      ratio: forecast.known && forecast.mid > 0 ? owed / forecast.mid : (owed > 0 ? null : 0),
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
    var f = pic.forecast;

    els.capValue.textContent = s.params.intakeCap == null ? "\u221e" : s.params.intakeCap;

    // One scale for both bars, taken from the night's commitment, so they
    // read against each other and across the evening.
    var scale = Math.max(s.params.intakeCap || 0, pic.owed, f.known ? f.high : 0, 1);
    els.gaugeCommitted.style.height = Math.min(100, (pic.owed / scale) * 100).toFixed(1) + "%";
    els.gaugeCapacity.style.height =
      Math.min(100, (f.known ? f.mid / scale : 0) * 100).toFixed(1) + "%";

    els.gaugeCommittedNum.textContent = pic.owed;
    els.gaugeCapacityNum.innerHTML = f.known
      ? '<span class="gauge-range">' + Math.round(f.low) + "\u2013" + Math.round(f.high) + "</span>"
      : "\u2014";

    els.gauge.classList.remove("gauge--ok", "gauge--tight", "gauge--over");
    if (s.dayOver) {
      els.gauge.classList.add(pic.unfinished ? "gauge--over" : "gauge--ok");
      els.gaugeVerdict.textContent = pic.unfinished
        ? pic.unfinished + (pic.unfinished === 1 ? " never got their pizza" : " never got their pizzas")
        : "Everyone got their pizza";
      return;
    }

    // On the first night there is no throughput to forecast from, and
    // saying so IS the lesson: capacity is learned, not calculated.
    if (!f.known) {
      els.gauge.classList.add("gauge--tight");
      els.gaugeVerdict.textContent = state.days.length
        ? "Nothing out of the kitchen yet tonight"
        : "No idea yet \u2014 we've never traded a night";
      return;
    }

    var verdict;
    if (pic.ratio > 1) {
      els.gauge.classList.add("gauge--over");
      verdict = "More owed than we can finish";
    } else if (pic.ratio > 0.8) {
      els.gauge.classList.add("gauge--tight");
      verdict = "Tight \u2014 no room for surprises";
    } else {
      els.gauge.classList.add("gauge--ok");
      verdict = pic.owed === 0 ? "Kitchen's clear" : "Comfortably on track";
    }
    els.gaugeVerdict.textContent = verdict + (f.nights ? "" : " \u2014 on tonight alone");
  }

  function renderTill(s) {
    var t = s.today;
    var wages = t.wagesAccrued;
    var profit = Shop.dayProfit(s);
    var rows = [
      { label: "Pizzas sold (" + t.deliveredCount + ")", value: t.revenue },
      { label: "Ingredients" + (t.returnedCount ? " (incl. " + t.returnedCount + " remade)" : ""), value: -t.ingredientCost },
      { label: "Lost goodwill", value: -t.goodwill },
      { label: (s.dayOver ? "Wages (" : "Wages so far (") + s.params.workers + " on shift)", value: -wages },
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

    // Flow efficiency: the share of the customer's wait in which anyone was
    // actually making their pizza. Both numbers are already on screen, one
    // above the other, and nobody ever divides them — so the shop does it.
    // It is the cheapest way to show that the queue, not the cooking, is
    // where the time goes.
    var eff = snap.avgLeadMinutes > 0 ? snap.avgCookMinutes / snap.avgLeadMinutes : 0;
    var hasData = snap.avgLeadMinutes > 0;
    els.eff.textContent = hasData ? Math.round(eff * 100) + "%" : "\u2014";
    els.effFill.style.width = (hasData ? Math.min(100, eff * 100) : 0).toFixed(1) + "%";
  }

  function renderCharts() {
    // Last night's shape, dashed, behind tonight's. It turns every chart
    // into a comparison instead of a reading, which is the only way a
    // prediction about "longer or shorter" can be answered by looking.
    // Once tonight is closed its own record is on the end of the list, so
    // the night to compare against is the one before it. The comparison
    // matters most at closing, which is when it was disappearing.
    var last = state.days[state.days.length - (state.dayOver ? 2 : 1)];
    var ghostable = last && last.history && last.history.length > 1;

    CHART_SPECS.forEach(function (spec) {
      var points = state.history.map(function (h) {
        return { day: h.tick, value: h[spec.field] };
      });
      Charts.renderLineChart(chartContainers[spec.key], points, {
        ghost: ghostable ? last.history.map(function (h) {
          return { day: h.tick, value: h[spec.field] };
        }) : null,
        ghostLabel: "last night",
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
        money(Shop.WAGE_PER_WORKER_PER_DAY) + " each = " +
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
      scorePrediction();
      recordDay();
      applyLocks();
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

  // --- The guided nights ----------------------------------------------------

  function previousDay() { return state.days[state.days.length - 1] || null; }

  /** The scripted night we are on, if any. Free play never has one. */
  function tonight() {
    return mode === "guided" ? Campaign.forDay(state.day) : null;
  }

  /**
   * The question, asked before the shutters go up so the answer cannot be
   * revised once the night starts going wrong. A number where the quantity
   * is the point; three directions where the concept is, because then
   * being wrong is unambiguous and there is nothing to argue with.
   */
  function askPrediction() {
    var spec = tonight();
    if (!spec) return false;
    var prev = previousDay();
    prediction = null;

    // Set the night up BEFORE the card is read, not when it is dismissed.
    // A card that says "three on shift, three ovens" over panels still
    // reading 3 and 4 is asking the player to believe the text over the
    // shop, and they are right not to.
    if (spec.setup) Shop.setParams(state, spec.setup(state.params, prev));
    applyLocks();
    renderAll();

    els.predictDay.textContent = "Night " + spec.day + " of " + Campaign.lastDay;
    els.predictTitle.textContent = spec.title;
    els.predictAsk.textContent = Campaign.resolve(spec.ask, prev);
    // Every card states tonight's kitchen, so nobody has to look away from
    // the question to find out what they are answering about.
    var fixed = spec.locks && spec.locks.length;
    els.predictSetup.textContent =
      state.params.workers + " on shift \u00b7 " + state.params.ovenSlots + " oven slots \u2014 " +
      (fixed ? "fixed for tonight" : "yours to change");
    els.predictSetup.className = "predict-setup" + (fixed ? " predict-setup--fixed" : "");
    els.predictNote.textContent = Campaign.resolve(spec.note, prev) || "";

    if (spec.kind === "number") {
      var start = Campaign.resolve(spec.start, prev);
      prediction = { value: Math.max(spec.min, Math.min(spec.max, Math.round(start))) };
      els.predictValue.textContent = prediction.value;
      applyAnswer(spec);
      els.predictUnit.textContent = spec.unit;
      els.predictNumber.hidden = false;
      els.predictOptions.hidden = true;
      els.predictGo.disabled = false;
    } else {
      els.predictNumber.hidden = true;
      els.predictOptions.innerHTML = "";
      spec.options.forEach(function (label, i) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "predict-option";
        b.textContent = label;
        b.setAttribute("aria-pressed", "false");
        b.addEventListener("click", function () {
          prediction = { index: i };
          var all = els.predictOptions.querySelectorAll(".predict-option");
          for (var j = 0; j < all.length; j++) {
            all[j].setAttribute("aria-pressed", j === i ? "true" : "false");
          }
          els.predictGo.disabled = false;
        });
        els.predictOptions.appendChild(b);
      });
      els.predictOptions.hidden = false;
      els.predictGo.disabled = true;
    }

    els.predictCard.hidden = false;
    return true;
  }

  /** Commit to the answer, set up whatever the night needs, and open up. */
  function lockPrediction() {
    var spec = tonight();
    // Where a night says so, the answer IS the setting. Committing to a
    // number and then having to enforce it by hand is a reflex test, not
    // a plan.
    if (spec && spec.applies && prediction && prediction.value != null) {
      var change = {};
      change[spec.applies] = prediction.value;
      Shop.setParams(state, change);
    }
    els.predictCard.hidden = true;
    renderAll();
  }

  /**
   * Some nights fix a lever, because an experiment you can undo halfway
   * through is not an experiment.
   */
  function applyLocks() {
    var spec = tonight();
    var locked = spec && spec.locks ? spec.locks : [];
    [["ovenSlots", els.ovenUp, els.ovenDown],
     ["workers", els.workersUp, els.workersDown],
     ["intakeCap", els.capUp, els.capDown]]
      .forEach(function (pair) {
        var isLocked = locked.indexOf(pair[0]) >= 0 && !state.dayOver;
        [pair[1], pair[2]].forEach(function (btn) {
          if (!btn) return;
          btn.disabled = isLocked;
          btn.title = isLocked ? "Fixed for tonight" : "";
        });
      });
  }

  /**
   * What they said, against what happened. Kept on the day record so the
   * history can show their calibration across the week — being roughly
   * right more often is the actual skill.
   */
  function scorePrediction() {
    var spec = mode === "guided" ? Campaign.forDay(state.day) : null;
    var d = previousDay();
    if (!spec || !d || !prediction) return;
    var prev = state.days[state.days.length - 2] || null;
    var actual = spec.actual(d, prev);
    var said = spec.kind === "number" ? prediction.value : prediction.index;
    var hit = spec.judge
      ? spec.judge(said, actual, d)
      : spec.kind === "number"
        ? Math.abs(actual - said) <= Math.max(2, Math.round(actual * 0.1))
        : actual === said;
    d.prediction = {
      kind: spec.kind,
      said: said,
      actual: actual,
      hit: hit,
      saidLabel: spec.kind === "number" ? said : spec.options[said],
      actualLabel: spec.kind === "number" ? actual : spec.options[actual],
      // For a count the label names the quantity ("delivered"), so the
      // number goes in front of it; a direction question writes its own.
      detail: spec.kind === "number"
        ? actual + " " + spec.actualLabel + (d.walked ? ", " + d.walked + " went home" : "")
        : Campaign.resolve(spec.actualLabel, d, prev),
      hitLabel: spec.hitLabel || "Called it",
      missLabel: spec.missLabel || "Not quite",
      lesson: spec.lesson,
    };
    prediction = null;
  }

  /** The reveal: their call and the outcome, side by side, then why. */
  function revealHtml(d) {
    var p = d.prediction;
    if (!p) return "";
    var out = '<div class="reveal">';
    if (p.kind === "number") {
      var scale = Math.max(p.said, p.actual, 1);
      out +=
        '<div class="reveal-row"><span class="reveal-key">You said</span>' +
        '<span class="reveal-bar reveal-bar--said"><span style="width:' +
        ((p.said / scale) * 100).toFixed(0) + '%"></span></span>' +
        '<span class="reveal-num">' + p.said + "</span></div>" +
        '<div class="reveal-row"><span class="reveal-key">It was</span>' +
        '<span class="reveal-bar reveal-bar--was"><span style="width:' +
        ((p.actual / scale) * 100).toFixed(0) + '%"></span></span>' +
        '<span class="reveal-num">' + p.actual + "</span></div>";
    } else {
      out +=
        '<p class="reveal-call">You said <strong>' + p.saidLabel +
        "</strong> \u00b7 it was <strong>" + p.actualLabel + "</strong></p>";
    }
    out += '<p class="reveal-verdict ' + (p.hit ? "reveal-verdict--hit" : "reveal-verdict--miss") +
      '">' + (p.hit ? (p.hitLabel || "Called it") : (p.missLabel || "Not quite")) +
      (p.detail ? " \u2014 " + p.detail : "") + "</p>";
    out += '<p class="reveal-lesson">' + p.lesson + "</p></div>";
    return out;
  }

  /**
   * The shop's agreed rules. Shown once before the first day and reachable
   * all game, so when the player wonders whether a returned pizza starts a
   * new clock, the answer is already pinned up rather than guessed at.
   */
  function renderRules() {
    els.rulesList.innerHTML = "";
    Terms.rules().forEach(function (line) {
      var li = document.createElement("li");
      li.innerHTML = line;
      els.rulesList.appendChild(li);
    });
    els.rulesClose.textContent = openedOnce
      ? "Close"
      : Terms.get("rulesClose");
  }

  function showRules() {
    renderRules();
    els.rulesCard.hidden = false;
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
      els.daySummaryNote.innerHTML = d.prediction
        ? revealHtml(d)
        : "Click along any chart to see what the shop looked like at that moment.";
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
    scorePrediction();
    recordDay();
    applyLocks();
    renderAll();
  }

  function startNextDay() {
    Shop.startNextDay(state);
    tickHistory = [];
    scrubTick = null;
    scrubState = null;
    Scene.rollSkins();
    setRunning(false);
    askPrediction();
    applyLocks();
    renderAll();
  }

  // --- Day history ---------------------------------------------------------
  function recordDay() {
    dayHistory.push(state.days[state.days.length - 1]);
    selectedDayIndex = dayHistory.length - 1;
    renderDayHistory();
  }

  /**
   * Their call against the outcome, night by night. Getting it roughly
   * right more often is the skill the whole loop is for, and it only shows
   * up across a week.
   */
  function calledCell(d) {
    if (!d.prediction) return "<span class=\"called called--none\">\u2013</span>";
    return d.prediction.hit
      ? '<span class="called called--hit" title="' + d.prediction.saidLabel + '">\u2713</span>'
      : '<span class="called called--miss" title="You said ' + d.prediction.saidLabel +
        ', it was ' + d.prediction.actualLabel + '">\u2717</span>';
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
        "<td>" + d.dayNumber + "</td><td>" + calledCell(d) + "</td><td>" + settingCell(d) + "</td>" +
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
        (pic.ratio > 1 ? " · already owing more than the night could finish" : "");
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
  // Raising the agreed number re-opens the shutters: taking on more than
  // you said you would is a decision, and it should read as one.
  els.capUp.addEventListener("click", function () {
    endScrub(false);
    var next = Math.min(80, (state.params.intakeCap || 0) + 2);
    Shop.setParams(state, { intakeCap: next });
    if (!state.dayOver && state.today.acceptedCount < next && state.tick > 0) {
      Shop.setParams(state, { acceptingOrders: true });
    }
    renderAll();
  });
  els.capDown.addEventListener("click", function () {
    endScrub(false);
    Shop.setParams(state, { intakeCap: Math.max(0, (state.params.intakeCap || 0) - 2) });
    renderAll();
  });
  els.ovenDown.addEventListener("click", function () { adjust("ovenSlots", -1, 1, 8); });

  // --- Vocabulary -----------------------------------------------------------

  var flashedTerms = false;

  /**
   * Flipping the switch renames everything at once: tiles, charts, the
   * history columns, the tooltips and the signs on the wall. On the first
   * flip the renamed labels flash, so the mapping is visible AS a mapping
   * rather than as a page that quietly changed while you blinked.
   */
  function applyTerms() {
    Terms.apply(document);
    Scene.repaintSigns();
    renderDayHistory();
    if (!els.rulesCard.hidden) renderRules();
    renderAll();
    if (flashedTerms) return;
    flashedTerms = true;
    var nodes = document.querySelectorAll("[data-term]");
    for (var i = 0; i < nodes.length; i++) nodes[i].classList.add("term-flash");
    setTimeout(function () {
      for (var j = 0; j < nodes.length; j++) nodes[j].classList.remove("term-flash");
    }, 1400);
  }

  els.termsToggle.addEventListener("change", function () {
    // Never disturbs the run: a coach has to be able to flip this
    // mid-session to say "everything you just worked out has a name".
    Terms.set(els.termsToggle.checked);
    applyTerms();
  });

  function begin(chosen) {
    mode = chosen;
    els.startScreen.hidden = true;
    showRules();
  }
  els.startGuided.addEventListener("click", function () { begin("guided"); });
  els.startFree.addEventListener("click", function () { begin("free"); });

  // Numbers are nudged rather than typed: it keeps a guess a guess.
  function nudge(delta) {
    var spec = tonight();
    if (!spec || spec.kind !== "number" || !prediction) return;
    var step = spec.step || 1;
    prediction.value = Math.max(spec.min, Math.min(spec.max, prediction.value + delta * step));
    els.predictValue.textContent = prediction.value;
    applyAnswer(spec);
  }

  /**
   * Where the answer IS a setting, move the setting as they move the
   * number. Leaving the panel on its old value until they pressed the
   * button read as the game quietly ignoring what they typed.
   */
  function applyAnswer(spec) {
    if (!spec || !spec.applies || !prediction || prediction.value == null) return;
    var change = {};
    change[spec.applies] = prediction.value;
    Shop.setParams(state, change);
    renderAll();
  }
  els.predictUp.addEventListener("click", function () { nudge(1); });
  els.predictDown.addEventListener("click", function () { nudge(-1); });
  els.predictGo.addEventListener("click", lockPrediction);

  els.rulesLink.addEventListener("click", function () {
    if (els.rulesCard.hidden) showRules();
    else els.rulesCard.hidden = true;
  });
  els.rulesClose.addEventListener("click", function () {
    els.rulesCard.hidden = true;
    if (!openedOnce) askPrediction();
    openedOnce = true;
  });

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
      // The start screen is already up over all of this; the rules and the
      // first question come once the player has chosen how to play.
      els.startScreen.hidden = false;
    })
    .catch(function (err) {
      els.loading.textContent = "Couldn't load the shop artwork: " + err.message;
      console.error(err);
    });
})();
