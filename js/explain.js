/**
 * explain.js — The Pizza Shop
 *
 * Turns a pair of trading days into a plain-language account of why the
 * money moved. The table shows THAT a day went better or worse; this says
 * what decision caused it and what mechanism it triggered.
 *
 * It stays honest: when nothing was changed, it says the difference was
 * luck, and when a sound decision produced a worse day it says so rather
 * than inventing a story to fit the numbers.
 */

(function (root) {
  "use strict";

  function plural(n, word) {
    return n + " " + word + (Math.abs(n) === 1 ? "" : "s");
  }

  function people(n) {
    return n + (Math.abs(n) === 1 ? " person" : " people");
  }

  var PARAM_NAMES = { workers: "staff", ovenSlots: "oven slots" };

  /** What a day OPENED with — the setting the between-day comparison is about. */
  function opening(day, key) {
    var start = key === "workers" ? day.startWorkers : day.startOvenSlots;
    return start == null ? day[key] : start;
  }

  /**
   * Mid-day moves, in order, with the time of each. Without this, a day you
   * started with four ovens and finished with three gets reported as a
   * three-oven day, which is not the day you ran.
   */
  function describeMidDay(day) {
    var moves = day.paramChanges || [];
    if (!moves.length) return null;
    var told = moves.map(function (m) {
      return PARAM_NAMES[m.param] + " " + m.from + " \u2192 " + m.to +
        " at " + Shop.tickToClock(m.tick);
    });
    var text = "You changed things during the day: " + told.join(", ") + ". ";
    var last = moves[moves.length - 1];
    text += last.to > last.from
      ? "Adding capacity part-way through only helps the orders still to come — anything already " +
        "waiting has been waiting at the old rate all along, so the wait times take a while to recover."
      : "Taking capacity away part-way through saves the wage, but everything still in the kitchen " +
        "now moves slower, so the orders you had already promised are the ones that pay for it.";
    return text;
  }

  function describeChanges(current, previous) {
    var changes = [];
    var dStaff = opening(current, "workers") - previous.workers;
    var dOven = opening(current, "ovenSlots") - previous.ovenSlots;

    if (dStaff !== 0) {
      changes.push({
        text:
          "You put " + Math.abs(dStaff) + " " + (dStaff > 0 ? "more" : "fewer") +
          " staff on (" + previous.workers + " → " + opening(current, "workers") + "). " +
          (dStaff > 0
            ? "More hands means more pizzas an hour — but wages are paid whether the orders come or not, so the extra only pays for itself if there's enough demand to use it."
            : "Fewer hands saves wages, but the kitchen gets through less, so orders sit waiting longer."),
      });
    }

    if (dOven !== 0) {
      var nowOven = opening(current, "ovenSlots");
      var nowStaff = opening(current, "workers");
      var nowOver = nowOven > nowStaff;
      var nowUnder = nowOven < nowStaff;
      var text = "You moved the oven slots from " + previous.ovenSlots + " to " + nowOven +
        " with " + people(nowStaff) + " on shift. ";
      if (nowUnder) {
        text +=
          "That's fewer pizzas on the go than people to make them, so some staff have nothing to do — " +
          "you're paying for hands you can't use.";
      } else if (nowOver) {
        text +=
          "That's more pizzas on the go than people to make them, so everyone's spread thin. " +
          "Each pizza crawls along, and a rushed kitchen gets more of them wrong.";
      } else {
        text += "That's roughly one pizza on the go per person — the sweet spot where nobody's idle and nobody's juggling.";
      }
      changes.push({ text: text });
    }

    // Intake is the decision the game is really about, so it's described in
    // terms of what it did rather than as a lever setting.
    var dRefused = current.refused - previous.refused;
    if (Math.abs(dRefused) >= 2) {
      changes.push({
        text:
          "You turned away " + Math.abs(dRefused) + " " + (dRefused > 0 ? "more" : "fewer") +
          " orders than the day before. " +
          (dRefused > 0
            ? "Turning an order away costs you the sale, but that's cheaper than taking it and not finishing it — an unfinished pizza costs you the sale AND the ingredients AND the customer's goodwill."
            : "Taking on more work only pays if you can finish it before closing; anything still in the kitchen at close is pure loss."),
      });
    }

    return changes;
  }

  /**
   * @param {Object} current completed-day record
   * @param {Object|null} previous the day before, if any
   * @returns {string[]} paragraphs
   */
  function dayDifference(current, previous) {
    if (!previous) {
      var out = [
        "First day: " + people(opening(current, "workers")) + " on shift, " +
          opening(current, "ovenSlots") + " oven slots. You took " + current.accepted + " orders, " +
          "turned away " + current.refused + ", and delivered " + current.delivered +
          " for " + (current.profit >= 0 ? "a profit of " : "a loss of ") +
          Shop.money(Math.abs(current.profit)) + ".",
      ];
      if (current.walked > 0) {
        out.push(
          current.walked + " customer(s) went home without a pizza. That's the most expensive " +
          "thing that can happen in this shop: you lose the sale, you've already paid for the " +
          "ingredients on anything that was in the oven, and the customer leaves unhappy. " +
          "Turning those orders away at the door would have cost you less."
        );
      }
      var firstMid = describeMidDay(current);
      if (firstMid) out.push(firstMid);
      if (current.ovenSlots < current.workers) {
        out.push(
          "Worth a look: you had fewer oven slots (" + current.ovenSlots + ") than staff (" +
          current.workers + "), so some of the people you paid for had nothing to work on."
        );
      }
      return out;
    }

    var lines = [];
    var dProfit = current.profit - previous.profit;
    var dWalked = current.walked - previous.walked;
    var dDelivered = current.delivered - previous.delivered;

    lines.push(
      "Result: " +
        (Math.abs(dProfit) < 1
          ? "about the same money"
          : Shop.money(Math.abs(dProfit)) + (dProfit > 0 ? " better" : " worse")) +
        ", " +
        (dDelivered === 0
          ? "the same number delivered"
          : Math.abs(dDelivered) + " " + (dDelivered > 0 ? "more" : "fewer") + " delivered") +
        ", " +
        (dWalked === 0
          ? "the same number of customers left empty-handed"
          : Math.abs(dWalked) + " " + (dWalked > 0 ? "more" : "fewer") + " left empty-handed") +
        "."
    );

    var changes = describeChanges(current, previous);
    var midDay = describeMidDay(current);
    if (midDay) changes.push({ text: midDay });

    if (!changes.length) {
      var moved = Math.abs(dProfit) >= 10 || dWalked !== 0;
      lines.push(
        moved
          ? "You ran the shop the same way both days, so none of that came from a decision — it's " +
            "just how the orders happened to fall. One day is a sample, not a measurement, which is " +
            "why you judge a shop on a week rather than a night."
          : "Same setup, same sort of day — this way of running the shop is behaving consistently."
      );
      return lines;
    }

    changes.forEach(function (c) {
      lines.push(c.text);
    });

    // The headline lesson, when it applies.
    if (current.walked === 0 && previous.walked > 0) {
      lines.push(
        "Notice what fixed it: every customer who came in got their pizza. Finishing what you " +
        "take on is worth more than taking on more."
      );
    } else if (current.walked > previous.walked && current.accepted > previous.accepted) {
      lines.push(
        "You took more orders and more people left without a pizza — so the extra orders didn't " +
        "just fail on their own, they slowed down the ones already in the kitchen. That's the trap: " +
        "overloading doesn't only cost you the extra work, it damages the work you'd already promised."
      );
    }

    return lines;
  }

  root.Explain = { dayDifference: dayDifference };
})(typeof window !== "undefined" ? window : this);
