/**
 * tooltips.js — The Pizza Shop
 *
 * Click (or keyboard focus + Enter/Space) an info icon for a plain-language
 * explanation. Click/focus driven rather than hover, since hover tooltips
 * are an accessibility problem and unusable on touch.
 */

(function () {
  "use strict";

  var DEFINITIONS = {
    workers: {
      title: "Staff on shift",
      body:
        "How many people are making pizzas. Each person gets through about one pizza's worth of work at a time — you can't put three people on one margherita and have it done three times faster. You pay their wages whether or not any orders come in, so staff you don't need eat the day's profit.",
    },
    ovenSlots: {
      title: "Oven slots",
      body:
        "How many pizzas can be on the go at once. Fewer slots than staff means people standing around with nothing to work on. More slots than staff means everyone's spread across too many pizzas at once, so each one takes longer and more of them come out wrong. Roughly one slot per person is the sweet spot.",
    },
    intake: {
      title: "Taking new orders",
      body:
        "Flip this to CLOSED and new orders are turned away at the door instead of joining the queue. Turning an order away costs you that sale — but taking an order you can't finish before closing costs you the sale AND the ingredients AND an unhappy customer. Knowing when to stop saying yes is the whole job.",
    },
    capacityGauge: {
      title: "Can we still finish it?",
      body:
        "The top bar is how much cooking you've already promised — everything waiting plus everything half-made. The bottom bar is how much cooking time is left before closing. While the bottom bar is longer, you can still finish what you've taken. Once the top bar overtakes it, somebody in that queue is not getting their pizza, no matter what you do next.",
    },
    leadTime: {
      title: "Wait for a pizza",
      body:
        "How long a customer waits from ordering to getting their pizza — including the time it sat in the queue before anyone touched it. This is the number the customer actually experiences. It's usually much longer than the time spent cooking, and the gap is all queueing.",
    },
    cookTime: {
      title: "Time in kitchen",
      body:
        "How long a pizza takes once someone actually starts making it. Compare it with the total wait: if the wait is 60 minutes and the cooking is 20, then two thirds of your customer's experience was them sitting there while nothing happened to their order.",
    },
    throughput: {
      title: "Pizzas per hour",
      body:
        "How fast finished pizzas are leaving the shop. Worth watching alongside the wait time: piling more orders into the kitchen makes everyone wait longer without making this number go up, because it's limited by hands and ovens, not by how many orders you've accepted.",
    },
    sentBack: {
      title: "Sent back",
      body:
        "Pizzas a customer received and returned. These are the expensive mistakes — you've refunded the money, binned the food and annoyed the customer. The kitchen catches most problems before they go out, and those only cost a remake. The ones that slip through cost far more, and a crowded kitchen lets more slip through.",
    },
    speed: {
      title: "Speed",
      body:
        "How fast the clock runs while the shop is open. It doesn't change anything about the shop itself — stepping forward 15 minutes at a time gives exactly the same result as letting it run.",
    },
    dayHistory: {
      title: "Previous days",
      body:
        "Every day you've traded, so you can compare instead of relying on memory. Click any day to see why it went the way it did. The most useful habit: change one thing between days, so when the money moves you know what moved it.",
    },
  };

  var popover = null;
  var openButton = null;

  function buildPopover() {
    popover = document.createElement("div");
    popover.className = "tooltip-popover";
    popover.setAttribute("role", "tooltip");
    popover.id = "tooltipPopover";
    popover.hidden = true;
    document.body.appendChild(popover);
  }

  function closeTooltip() {
    if (!popover) return;
    popover.hidden = true;
    if (openButton) {
      openButton.setAttribute("aria-expanded", "false");
      openButton = null;
    }
  }

  function positionPopover(button) {
    var rect = button.getBoundingClientRect();
    var popWidth = 280;
    var left = rect.left + window.scrollX;
    var top = rect.bottom + window.scrollY + 8;
    var maxLeft = window.scrollX + document.documentElement.clientWidth - popWidth - 12;
    if (left > maxLeft) left = Math.max(12, maxLeft);
    popover.style.left = left + "px";
    popover.style.top = top + "px";
    popover.style.width = popWidth + "px";
  }

  function openTooltip(button) {
    var def = DEFINITIONS[button.getAttribute("data-tip")];
    if (!def) return;
    popover.innerHTML =
      '<div class="tooltip-title">' + def.title + "</div>" +
      '<div class="tooltip-body">' + def.body + "</div>";
    popover.hidden = false;
    positionPopover(button);
    button.setAttribute("aria-expanded", "true");
    openButton = button;
  }

  function init() {
    buildPopover();
    document.querySelectorAll(".info-icon").forEach(function (btn) {
      btn.setAttribute("aria-expanded", "false");
      btn.setAttribute("aria-describedby", "tooltipPopover");
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (openButton === btn) closeTooltip();
        else {
          closeTooltip();
          openTooltip(btn);
        }
      });
    });
    document.addEventListener("click", function (e) {
      if (popover && !popover.hidden && !popover.contains(e.target)) closeTooltip();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeTooltip();
    });
    window.addEventListener("resize", function () {
      if (openButton) positionPopover(openButton);
    });
    window.addEventListener("scroll", function () {
      if (openButton) positionPopover(openButton);
    }, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
