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
      flowTitle: "Team size",
      flowBody:
        "The people available to do the work. Team size is an input to capacity, not capacity itself: capacity is how much the team can actually get through in the time available, and adding people raises it less than in proportion \u2014 nobody can make three pizzas at once.",
      body:
        "How many people are making pizzas. Each person gets through about one pizza's worth of work at a time — you can't put three people on one margherita and have it done three times faster. You pay their wages whether or not any orders come in, so staff you don't need eat the day's profit.",
    },
    ovenSlots: {
      title: "Oven slots",
      flowTitle: "WIP limit",
      flowBody:
        "The cap on how many items may be in progress at once. This is the most directly controllable flow metric and usually the highest-leverage change available to a team — and the one that feels most like going slower while it makes you faster.",
      body:
        "How many pizzas can be on the go at once. Fewer slots than staff means people standing around with nothing to work on. More slots than staff means everyone's spread across too many pizzas at once, so each one takes longer and more of them come out wrong. Roughly one slot per person is the sweet spot.",
    },
    intake: {
      title: "Taking new orders",
      flowTitle: "Commitment point",
      flowBody:
        "Where work is accepted into the system, and where the lead-time clock starts. Refusing work costs the sale; accepting work you cannot finish costs the sale, the cost of the work and the customer.",
      body:
        "Flip this to CLOSED and new orders are turned away at the door instead of joining the queue. Turning an order away costs you that sale — but taking an order you can't finish before closing costs you the sale AND the ingredients AND an unhappy customer. Knowing when to stop saying yes is the whole job.",
    },
    capacityGauge: {
      title: "Can we still finish it?",
      flowTitle: "Committed work vs capacity remaining",
      flowBody:
        "Committed work is everything accepted but not yet delivered. Capacity remaining is what the system can still produce before the deadline. When the first exceeds the second, the only remaining question is who gets disappointed.",
      body:
        "The top bar is how much cooking you've already promised — everything waiting plus everything half-made. The bottom bar is how much cooking time is left before closing. While the bottom bar is longer, you can still finish what you've taken. Once the top bar overtakes it, somebody in that queue is not getting their pizza, no matter what you do next.",
    },
    leadTime: {
      title: "Wait for a pizza",
      flowTitle: "Lead time",
      flowBody:
        "Elapsed time from the commitment point to delivery, including every minute spent queueing. This is the customer-facing measure of flow performance, and the one a client actually feels.",
      body:
        "How long a customer waits from ordering to getting their pizza — including the time it sat in the queue before anyone touched it. This is the number the customer actually experiences. It's usually much longer than the time spent cooking, and the gap is all queueing.",
    },
    cookTime: {
      title: "Time in kitchen",
      flowTitle: "Cycle time",
      flowBody:
        "Elapsed time from work starting to delivery. Cycle time shows where capacity is consumed in the active workflow. The gap between cycle time and lead time is queue — and in most systems the queue is the larger half.",
      body:
        "How long a pizza takes once someone actually starts making it. Compare it with the total wait: if the wait is 60 minutes and the cooking is 20, then two thirds of your customer's experience was them sitting there while nothing happened to their order.",
    },
    flowEfficiency: {
      title: "Actually cooking",
      flowTitle: "Flow efficiency",
      flowBody:
        "Cycle time as a share of lead time: the proportion of elapsed time in which work was actually being done on the item. A kitchen scores well, because the work is short and the queue is in plain sight on the board. Most knowledge-work systems measure between 5% and 25% \u2014 the waiting is the same, it is just invisible. Either way, the number moves by attacking queues and wait states, not by working faster.",
      body:
        "Of the time a customer spends waiting, this is the share where somebody was actually making their pizza. The rest of it was their order sitting on the board while other pizzas were made. It is almost always lower than people expect — and the way to raise it is hardly ever to cook faster.",
    },
    throughput: {
      title: "Pizzas per hour",
      flowTitle: "Throughput",
      flowBody:
        "Delivered items per unit of time. A planning input, not a productivity target: it tells you what the system can be asked to take on, not how hard anyone is working. Pushing more work in does not raise it.",
      body:
        "How fast finished pizzas are leaving the shop. Worth watching alongside the wait time: piling more orders into the kitchen makes everyone wait longer without making this number go up, because it's limited by hands and ovens, not by how many orders you've accepted.",
    },
    sentBack: {
      title: "Sent back",
      flowTitle: "Escaped defects",
      flowBody:
        "Defects that reached the customer, as against those caught in process. Escaped defects cost far more than caught ones, and both rise as work in progress rises.",
      body:
        "Pizzas a customer received and returned. These are the expensive mistakes — you've refunded the money, binned the food and annoyed the customer. The kitchen catches most problems before they go out, and those only cost a remake. The ones that slip through cost far more, and a crowded kitchen lets more slip through.",
    },
    speed: {
      title: "Speed",
      flowTitle: "Speed",
      body:
        "How fast the clock runs while the shop is open. It doesn't change anything about the shop itself — stepping forward 15 minutes at a time gives exactly the same result as letting it run.",
    },
    dayHistory: {
      title: "Previous days",
      flowTitle: "Previous days",
      flowBody:
        "Trends over time rather than point-in-time numbers. A single bad day is a sample, not a signal. Change one thing between runs so that when the result moves you know what moved it.",
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
    // With the vocabulary switch on, the formal definition leads and the
    // plain-language explanation follows it. Both are always true of the
    // same thing; only the order of who needs which changes.
    var flow = typeof Terms !== "undefined" && Terms.isFlow();
    var title = flow && def.flowTitle ? def.flowTitle : def.title;
    var body = flow && def.flowBody
      ? '<p class="tooltip-flow">' + def.flowBody + "</p>" + def.body
      : def.body;
    popover.innerHTML =
      '<div class="tooltip-title">' + title + "</div>" +
      '<div class="tooltip-body">' + body + "</div>";
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
