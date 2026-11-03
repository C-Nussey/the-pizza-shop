/**
 * render.js — The Pizza Shop
 *
 * DOM rendering for the order board, metric tiles and the till. Takes shop
 * state plus container references and writes into them; no simulation logic
 * lives here.
 */

(function (root) {
  "use strict";

  var MAX_CARDS = 12;
  var TYPE_EMOJI = { S: "🧀", M: "🍕", F: "🫒" };

  function typeBadge(order) {
    return (
      '<span class="type-badge type-badge--' + order.typeKey + '">' +
      (TYPE_EMOJI[order.typeKey] || "🍕") + " " + order.typeName + "</span>"
    );
  }

  function overflowCard(count, noun) {
    var el = document.createElement("div");
    el.className = "order-card order-card--overflow";
    el.textContent = "+" + count + " more " + noun;
    return el;
  }

  /**
   * Orders waiting: the longer one sits here, the worse the customer's wait,
   * so the waiting time is shown right on the card.
   */
  function renderQueue(state, containerEl, countEl, minutesPerTick) {
    containerEl.innerHTML = "";
    var shown = state.queue.slice(0, MAX_CARDS);
    shown.forEach(function (order) {
      var waited = (state.tick - order.orderedTick) * minutesPerTick;
      var card = document.createElement("div");
      card.className = "order-card" + (waited >= 45 ? " order-card--stale" : "");
      card.innerHTML =
        '<span class="order-card-row">' +
        '<span class="order-id">#' + order.id + "</span>" +
        typeBadge(order) +
        '<span class="order-wait">' + waited + " min</span>" +
        "</span>";
      containerEl.appendChild(card);
    });
    if (state.queue.length > shown.length) {
      containerEl.appendChild(overflowCard(state.queue.length - shown.length, "waiting"));
    }
    if (countEl) countEl.textContent = state.queue.length;
  }

  /**
   * In the kitchen: the bar's WIDTH is how big the pizza is and the fill is
   * how far along it is, so a fiddly one is visibly a longer job rather than
   * just a different percentage.
   */
  function renderKitchen(state, containerEl, countEl, minutesPerTick, maxEffortForBar) {
    containerEl.innerHTML = "";
    var shown = state.kitchen.slice(0, MAX_CARDS);
    shown.forEach(function (order) {
      var pct = Math.min(100, Math.round((order.effortDone / order.effortRequired) * 100));
      var widthPct = Math.min(100, (order.effortRequired / maxEffortForBar) * 100);
      var inKitchen = (state.tick - order.startedTick) * minutesPerTick;
      var card = document.createElement("div");
      card.className = "order-card order-card--cooking" + (order.remakes > 0 ? " order-card--remake" : "");
      card.innerHTML =
        '<span class="order-card-row">' +
        '<span class="order-id">#' + order.id + "</span>" +
        typeBadge(order) +
        '<span class="order-wait">' + inKitchen + " min</span>" +
        "</span>" +
        '<span class="effort-track" style="width:' + widthPct.toFixed(1) + '%">' +
        '<span class="effort-fill" style="width:' + pct + '%"></span>' +
        "</span>" +
        (order.remakes > 0 ? '<span class="order-note">↻ being remade</span>' : "");
      containerEl.appendChild(card);
    });
    if (state.kitchen.length > shown.length) {
      containerEl.appendChild(overflowCard(state.kitchen.length - shown.length, "cooking"));
    }
    if (countEl) countEl.textContent = state.kitchen.length;
  }

  /** Delivered: newest first, showing what the customer actually waited. */
  function renderDelivered(state, containerEl, countEl) {
    containerEl.innerHTML = "";
    var returnedIds = {};
    state.returned.forEach(function (r) {
      returnedIds[r.id] = true;
    });

    var recent = state.delivered.slice(-MAX_CARDS).reverse();
    recent.forEach(function (order) {
      var wasReturned = returnedIds[order.id];
      var card = document.createElement("div");
      card.className = "order-card" + (wasReturned ? " order-card--returned" : " order-card--good");
      card.innerHTML =
        '<span class="order-card-row">' +
        '<span class="order-id">#' + order.id + (wasReturned ? " ↩" : " ✓") + "</span>" +
        typeBadge(order) +
        '<span class="order-wait">' + order.leadTimeMinutes + " min</span>" +
        "</span>";
      containerEl.appendChild(card);
    });
    if (state.delivered.length > recent.length) {
      containerEl.appendChild(overflowCard(state.delivered.length - recent.length, "delivered"));
    }
    if (countEl) countEl.textContent = state.delivered.length;
  }

  function money(n) {
    var rounded = Math.round(n);
    return (rounded < 0 ? "-$" : "$") + Math.abs(rounded);
  }

  /** Today's running P&L, so the cost of every decision is visible live. */
  function renderTill(state, rowsEl, profitEl, wagePerWorker) {
    var t = state.today;
    var wages = state.params.workers * wagePerWorker;
    var profit = t.revenue - t.refunds - t.ingredientCost - t.goodwill - wages;

    var rows = [
      { label: "Pizzas sold (" + t.deliveredCount + ")", value: t.revenue, positive: true },
      { label: "Refunds (" + t.returnedCount + " sent back)", value: -t.refunds },
      { label: "Ingredients", value: -t.ingredientCost },
      { label: "Lost goodwill", value: -t.goodwill },
      { label: "Wages (" + state.params.workers + " on shift)", value: -wages },
    ];

    rowsEl.innerHTML = rows
      .map(function (r) {
        var cls = r.value > 0 ? "till-pos" : r.value < 0 ? "till-neg" : "";
        return (
          '<div class="till-row"><span>' + r.label + "</span>" +
          '<span class="' + cls + '">' + money(r.value) + "</span></div>"
        );
      })
      .join("");

    profitEl.textContent = money(profit);
    profitEl.className = "till-profit " + (profit >= 0 ? "till-pos" : "till-neg");
  }

  root.Render = {
    renderQueue: renderQueue,
    renderKitchen: renderKitchen,
    renderDelivered: renderDelivered,
    renderTill: renderTill,
    money: money,
  };
})(typeof window !== "undefined" ? window : this);
