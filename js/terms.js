/**
 * terms.js — The Pizza Shop
 *
 * One switch that re-reads the whole shop in flow-metrics vocabulary.
 *
 * The shop deliberately speaks pizza: "wait for a pizza", "oven slots",
 * "sent back". That is what makes it learnable by someone who has never
 * heard of a WIP limit. But a consultant has to be able to take what they
 * worked out here to a client, and they can only do that if somebody tells
 * them that the thing they were calling "the wait for a pizza" is lead
 * time, and that the oven slots they kept fiddling with were a WIP limit.
 *
 * So the vocabulary is a layer, not a rewrite: every label in the game is
 * registered here in both languages, and flipping the switch swaps all of
 * them at once — including the signs painted on the wall. Nothing else
 * changes. The shop runs exactly the same either way, which is the point:
 * the names were never what was doing the work.
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Terms = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // key: [shop language, flow language]
  var WORDS = {
    // Controls
    // NOT "capacity": the gauge already uses that word for the work the
    // shop can still get through before closing. People are an input to
    // capacity, not capacity itself — and the game's own absorption cap
    // means adding them does not raise it in proportion.
    workers: ["Staff on shift", "Team size"],
    ovenSlots: ["Oven slots", "WIP limit"],

    // Tiles
    leadTime: ["Wait for a pizza", "Lead time"],
    cookTime: ["Time in kitchen", "Cycle time"],
    throughput: ["Pizzas / hour", "Throughput / hour"],
    flowEfficiency: ["Actually cooking", "Flow efficiency"],
    sentBack: ["Sent back", "Escaped defects"],
    earnings: ["Total earnings", "Total earnings"],

    // The capacity gauge
    gaugeTitle: ["Can we still finish<br />our orders?", "Committed vs<br />capacity left"],
    gaugeCommitted: ["Committed", "Committed"],
    gaugeCapacity: ["Time left", "Capacity"],

    // Charts
    chartQueue: ["Orders waiting", "Queue"],
    chartKitchen: ["In the kitchen", "Work in progress"],
    chartLead: ["Wait for a pizza (min)", "Lead time (min)"],
    chartRate: ["Pizzas / hour", "Throughput / hour"],

    // The till
    tillTitle: ["Today's till", "Today's till"],

    // Day history
    historyTitle: ["Previous days", "Previous days"],
    histDay: ["Day", "Day"],
    histCalled: ["Called it?", "Called it?"],
    histSetup: ["Staff/Oven", "People / WIP"],
    histTook: ["Took", "Accepted"],
    histTurned: ["Turned away", "Refused"],
    histDelivered: ["Delivered", "Delivered"],
    histWalked: ["Walked", "Abandoned"],
    histSentBack: ["Sent back", "Escaped"],
    histProfit: ["Profit", "Profit"],

    // The signs painted into the artwork
    signWaiting: ["ORDERS WAITING", "QUEUE"],
    signProgress: ["ORDERS IN PROGRESS", "WORK IN PROGRESS"],
    signDone: ["ORDERS DONE", "DELIVERED"],

    // House rules
    rulesTitle: ["How this shop counts things", "Measurement boundaries"],
    rulesClose: ["Got it — let's open up", "Got it — let's open up"],
    rulesLink: ["House rules", "Measurement rules"],
  };

  /**
   * The shop's agreed rules, in both languages. Read as pizza, this is a
   * note pinned in the kitchen. Read in flow terms, it is the measurement
   * charter a consultant has to agree with a client in week one — the same
   * five decisions, in the same order.
   */
  var RULES = [
    [
      "The clock starts when we take the order, not when we start cooking.",
      "<strong>Commitment point.</strong> The clock starts when an order is accepted, not when work begins on it.",
    ],
    [
      "A pizza is done when the customer has it in their hands.",
      "<strong>Definition of done.</strong> An item is done when the customer has it — not when it leaves the team.",
    ],
    [
      "A pizza sent back keeps its original clock. The customer's wait never stopped.",
      "<strong>Rework.</strong> A returned item keeps its original start time. The customer's lead time never paused.",
    ],
    [
      "Every pizza counts — margherita, pepperoni or The Works.",
      "<strong>Item types.</strong> Every item counts, whatever its size. No category is excluded for being awkward.",
    ],
    [
      "We count the shop, not the chefs. Nobody has their own scoreboard.",
      "<strong>Unit of measure.</strong> The system, not the individual. Personal metrics drive local optimisation and gaming.",
    ],
  ];

  var mode = 0; // 0 = shop language, 1 = flow terms
  var listeners = [];

  function get(key) {
    var pair = WORDS[key];
    if (!pair) return key;
    return pair[mode] || pair[0];
  }

  function rules() {
    return RULES.map(function (pair) { return pair[mode] || pair[0]; });
  }

  function isFlow() { return mode === 1; }

  function set(next) {
    var want = next ? 1 : 0;
    if (want === mode) return;
    mode = want;
    listeners.forEach(function (fn) { fn(mode); });
  }

  function onChange(fn) { listeners.push(fn); }

  /**
   * Rewrites every element carrying data-term. The attribute sits on a
   * span INSIDE a label rather than on the label itself, because most
   * labels also hold an info button that must survive the swap.
   */
  function apply(scope) {
    var nodes = (scope || document).querySelectorAll("[data-term]");
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].innerHTML = get(nodes[i].getAttribute("data-term"));
    }
  }

  return {
    get: get,
    rules: rules,
    isFlow: isFlow,
    set: set,
    onChange: onChange,
    apply: apply,
  };
});
