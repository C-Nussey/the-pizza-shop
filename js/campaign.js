/**
 * campaign.js — The Pizza Shop
 *
 * The guided five days: one question before each day, one reveal after it.
 *
 * The question is never a generic "how do you think you'll do?". It is the
 * lesson of that day, asked in a form where being wrong is unambiguous —
 * a count you can be out by, or a direction you either called or didn't.
 * A guess the player cannot reason about is a coin flip, and comparing
 * yourself against a coin flip teaches nothing.
 *
 * Day 3 is the one that does the work. Nobody predicts that more ovens
 * make the wait longer, and nobody forgets being wrong about it.
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Campaign = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function pct(day) {
    if (!day || !day.avgLeadMinutes) return 0;
    return Math.round((day.avgCookMinutes / day.avgLeadMinutes) * 100);
  }

  var DAYS = [
    {
      day: 1,
      kind: "number",
      title: "Opening night",
      ask: "How many pizzas will you get out before 21:00?",
      note: "You have never traded a day here. Have a guess — being wrong is the point.",
      unit: "pizzas",
      min: 0, max: 80, start: 25, step: 5,
      actual: function (d) { return d.delivered; },
      actualLabel: "delivered",
      lesson:
        "Capacity is not ambition. What a shop can deliver is set by how many hands and " +
        "ovens it has and how long the night is — not by how many orders you take. " +
        "Tonight you found out what this kitchen can actually do.",
    },
    {
      day: 2,
      kind: "number",
      title: "Now you know something",
      ask: function (prev) {
        return "Last night you delivered " + prev.delivered +
          ". How many orders will you take on tonight?";
      },
      note: "The shop stops taking orders by itself when it reaches your number \u2014 so this is a promise, not a reflex.",
      unit: "orders",
      min: 0, max: 80, start: function (prev) { return prev.delivered; }, step: 2,
      // The answer IS the setting: what they commit to is what the shop
      // takes on. A plan you then have to enforce by hand is a reflex test.
      applies: "intakeCap",
      setup: function () { return { workers: 3, ovenSlots: 3 }; },
      locks: ["workers", "ovenSlots"],
      actual: function (d) { return d.delivered; },
      actualLabel: "delivered",
      // Not "did you guess the number" — did you finish what you promised.
      judge: function (said, actual, d) { return d.walked === 0; },
      hitLabel: "You finished everything you took on",
      missLabel: "You took on more than you finished",
      lesson:
        "Throughput is a planning input, not a target. Last night's delivered count is the " +
        "best forecast you have for tonight, and what you take on is the one lever that " +
        "decides whether the promise holds. Promise less than you can deliver and you leave " +
        "money on the counter; promise more and it costs you the sale, the ingredients and " +
        "the customer. The number to commit to is the one your own throughput supports \u2014 " +
        "which is why you had to trade a night before you could pick it.",
    },
    {
      day: 3,
      kind: "direction",
      title: "The owner lights more ovens",
      // Asked about the KITCHEN, not the wait, and not by accident. Measured
      // over 600 paired nights, three extra slots on the same staff make the
      // wait longer only 66% of the time -- the night-to-night noise is
      // bigger than the effect, so a question about the wait would have been
      // a coin flip, and half the room would have been told their wrong
      // answer was right. The same change makes each pizza's time in the
      // kitchen longer 97% of the time. The wait is where the player FEELS
      // it; the kitchen is where it can be reliably shown.
      ask: "Twice as many ovens tonight, the same three staff. What happens to the time each pizza spends in the kitchen?",
      note: "Same shift as last night, twice the ovens. This one is an experiment, so nothing else moves.",
      options: ["Shorter", "About the same", "Longer"],
      setup: function (params, prev) {
        return { workers: 3, ovenSlots: 6 };
      },
      locks: ["workers", "ovenSlots"],
      actual: function (d, prev) {
        if (!prev) return 1;
        var change = (d.avgCookMinutes - prev.avgCookMinutes) / Math.max(1, prev.avgCookMinutes);
        if (change < -0.08) return 0;
        if (change > 0.08) return 2;
        return 1;
      },
      actualLabel: function (d, prev) {
        return Math.round(d.avgCookMinutes) + " min in the kitchen against " +
          Math.round(prev.avgCookMinutes) + " min yesterday, for " +
          d.delivered + " pizzas against " + prev.delivered;
      },
      lesson:
        "More work in progress does not mean more work finished. The same three pairs of " +
        "hands are now spread across six pizzas instead of three, so every pizza takes far " +
        "longer to make \u2014 while the number delivered barely moves, because the ovens were " +
        "never what limited it. That is Little's Law doing its work: at a given throughput, " +
        "lead time rises with work in progress. It is why a WIP limit is the highest-leverage " +
        "change most teams can make, and why it always feels like going slower.",
    },
    {
      day: 4,
      kind: "direction",
      title: "Where does the time go?",
      ask: "Of the time a customer spends waiting, how much is someone actually making their pizza?",
      note: "The kitchen is yours again. Watch the flow efficiency tile as the night goes on.",
      options: ["Nearly all \u2014 70%+", "About half", "A quarter or less"],
      actual: function (d) {
        var p = pct(d);
        if (p >= 66) return 0;
        if (p >= 40) return 1;
        return 2;
      },
      actualLabel: function (d) { return pct(d) + "% of the wait was cooking"; },
      lesson:
        "The gap between cycle time and lead time is queue. A kitchen scores well here, " +
        "because the work is short and the board is on the wall where you can see it. " +
        "Most knowledge-work systems measure between 5% and 25% — the waiting is the " +
        "same, it is just invisible. Which is why the way to shorten a wait is almost " +
        "never to ask people to work faster.",
    },
    {
      day: 5,
      kind: "direction",
      title: "The same night twice",
      ask: "Exactly the settings you ran yesterday. Will tonight come out the same?",
      note: "Nothing has changed but the dice.",
      options: ["Much the same", "Noticeably better", "Noticeably worse"],
      setup: function (params, prev) {
        return { workers: prev.workers, ovenSlots: prev.ovenSlots };
      },
      // Both levers fixed: "nothing has changed but the dice" has to be true.
      locks: ["workers", "ovenSlots"],
      actual: function (d, prev) {
        var change = (d.profit - prev.profit);
        if (Math.abs(change) < 25) return 0;
        return change > 0 ? 1 : 2;
      },
      actualLabel: function (d, prev) {
        var money = typeof Shop !== "undefined" ? Shop.money : function (n) { return n; };
        return money(d.profit) + " against " + money(prev.profit) + " yesterday";
      },
      lesson:
        "Same staff, same ovens, same intake — a different night. One day is a sample, " +
        "not a measurement. This is why a bad week is rarely something to act on, and why " +
        "flow metrics are read as trends across many days rather than as a score for one. " +
        "Change one thing at a time and give it long enough to show.",
    },
  ];

  function forDay(n) {
    for (var i = 0; i < DAYS.length; i++) if (DAYS[i].day === n) return DAYS[i];
    return null;
  }

  /** Resolve a field that may be a function of the previous day. */
  function resolve(value, a, b) {
    return typeof value === "function" ? value(a, b) : value;
  }

  return {
    DAYS: DAYS,
    forDay: forDay,
    resolve: resolve,
    lastDay: DAYS[DAYS.length - 1].day,
  };
});
