/**
 * charts.js
 *
 * Minimal, dependency-free SVG line chart renderer for metric history.
 * Re-renders from scratch on each call — fine at this data scale
 * (HISTORY_LIMIT days, 5 small charts).
 */

(function (root) {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";

  function svgEl(tag, attrs) {
    var el = document.createElementNS(SVG_NS, tag);
    for (var key in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, key)) {
        el.setAttribute(key, attrs[key]);
      }
    }
    return el;
  }

  /**
   * @param {HTMLElement} containerEl
   * @param {Array<{day:number,value:number}>} points
   * @param {Object} opts { color, label, unit, decimals, width, height }
   */
  function renderLineChart(containerEl, points, opts) {
    opts = opts || {};
    var color = opts.color || "#4f7cff";
    var decimals = opts.decimals == null ? 1 : opts.decimals;
    var unit = opts.unit || "";
    var width = opts.width || containerEl.clientWidth || 220;
    var height = opts.height || 64;
    var padX = 4;
    var padY = 6;

    containerEl.innerHTML = "";

    if (!points || points.length < 2) {
      var empty = document.createElement("div");
      empty.className = "chart-empty";
      empty.textContent = "Collecting data…";
      containerEl.appendChild(empty);
      return;
    }

    var values = points.map(function (p) {
      return p.value;
    });
    var minV = Math.min.apply(null, values);
    var maxV = Math.max.apply(null, values);
    if (minV === maxV) {
      minV -= 1;
      maxV += 1;
    }
    // A little headroom so the line doesn't touch the edges.
    var spanPad = (maxV - minV) * 0.1;
    minV -= spanPad;
    maxV += spanPad;

    var n = points.length;
    var plotW = width - padX * 2;
    var plotH = height - padY * 2;

    function xFor(i) {
      return padX + (plotW * i) / (n - 1);
    }
    function yFor(v) {
      return padY + plotH - ((v - minV) / (maxV - minV)) * plotH;
    }

    var svg = svgEl("svg", {
      viewBox: "0 0 " + width + " " + height,
      width: "100%",
      height: height,
      class: "chart-svg",
      role: "img",
      "aria-label": (opts.label || "Metric") + " trend",
    });

    // Light horizontal gridlines at 25/50/75%.
    [0.25, 0.5, 0.75].forEach(function (f) {
      var gy = padY + plotH * f;
      svg.appendChild(
        svgEl("line", {
          x1: padX,
          x2: width - padX,
          y1: gy,
          y2: gy,
          class: "chart-grid",
        })
      );
    });

    // Build the polyline path.
    var pathD = "";
    for (var i = 0; i < n; i++) {
      var x = xFor(i);
      var y = yFor(points[i].value);
      pathD += (i === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1) + " ";
    }

    // Soft fill under the line.
    var fillD =
      pathD + "L" + xFor(n - 1).toFixed(1) + "," + (padY + plotH).toFixed(1) +
      " L" + xFor(0).toFixed(1) + "," + (padY + plotH).toFixed(1) + " Z";
    svg.appendChild(
      svgEl("path", { d: fillD, fill: color, "fill-opacity": "0.12", stroke: "none" })
    );

    svg.appendChild(
      svgEl("path", {
        d: pathD.trim(),
        fill: "none",
        stroke: color,
        "stroke-width": "2",
        "stroke-linejoin": "round",
        "stroke-linecap": "round",
      })
    );

    // Current-value dot.
    var lastX = xFor(n - 1);
    var lastY = yFor(points[n - 1].value);
    svg.appendChild(svgEl("circle", { cx: lastX, cy: lastY, r: 3, fill: color }));

    // Scrub marker: a full-height crosshair at the selected day, plus a dot
    // on this series' value for that day. Drawn edge-to-edge (not just
    // across the plot area) so the line reads as continuous through a
    // vertical stack of charts.
    if (opts.markerDay != null) {
      var markerIdx = -1;
      for (var m = 0; m < n; m++) {
        if (points[m].day === opts.markerDay) {
          markerIdx = m;
          break;
        }
      }
      if (markerIdx !== -1) {
        var mx = xFor(markerIdx);
        svg.appendChild(
          svgEl("line", { x1: mx, x2: mx, y1: 0, y2: height, class: "chart-crosshair" })
        );
        svg.appendChild(
          svgEl("circle", {
            cx: mx,
            cy: yFor(points[markerIdx].value),
            r: 4,
            fill: color,
            stroke: "#fff",
            "stroke-width": "1.5",
          })
        );
      }
    }

    containerEl.appendChild(svg);

    // Metadata for hit-testing a pointer position back to a day.
    containerEl.__chartMeta = {
      days: points.map(function (p) {
        return p.day;
      }),
      padX: padX,
      plotW: plotW,
      width: width,
    };

    var meta = document.createElement("div");
    meta.className = "chart-meta";
    var current = points[n - 1].value;
    meta.innerHTML =
      '<span class="chart-current">' + current.toFixed(decimals) + unit + "</span>" +
      '<span class="chart-range">min ' + Math.min.apply(null, values).toFixed(decimals) +
      " / max " + Math.max.apply(null, values).toFixed(decimals) + "</span>";
    containerEl.appendChild(meta);
  }

  /**
   * Overlaid multi-series line chart (e.g. Arrived / Started / Done counts
   * for a simple Cumulative Flow Diagram) with a small legend underneath
   * instead of a single current-value readout.
   * @param {HTMLElement} containerEl
   * @param {Array<{points:Array<{day:number,value:number}>, color:string, label:string}>} seriesList
   * @param {Object} opts { width, height, label }
   */
  function renderMultiLineChart(containerEl, seriesList, opts) {
    opts = opts || {};
    var width = opts.width || containerEl.clientWidth || 220;
    var height = opts.height || 140;
    var padX = 4;
    var padY = 6;

    containerEl.innerHTML = "";

    var usable = (seriesList || []).filter(function (s) {
      return s.points && s.points.length >= 2;
    });
    if (!usable.length) {
      var empty = document.createElement("div");
      empty.className = "chart-empty";
      empty.textContent = "Collecting data…";
      containerEl.appendChild(empty);
      return;
    }

    // Series can have different lengths (a ghost overlay from a previous,
    // shorter or longer run), so x is scaled by DAY across the union of all
    // series rather than by array index.
    var allValues = [];
    var minDay = Infinity;
    var maxDay = -Infinity;
    usable.forEach(function (s) {
      s.points.forEach(function (p) {
        allValues.push(p.value);
        if (p.day < minDay) minDay = p.day;
        if (p.day > maxDay) maxDay = p.day;
      });
    });
    if (maxDay === minDay) maxDay = minDay + 1;
    var minV = Math.min.apply(null, allValues);
    var maxV = Math.max.apply(null, allValues);
    if (minV === maxV) {
      minV -= 1;
      maxV += 1;
    }
    var spanPad = (maxV - minV) * 0.08;
    minV -= spanPad;
    maxV += spanPad;
    if (minV < 0 && allValues.every(function (v) { return v >= 0; })) minV = 0;

    var plotW = width - padX * 2;
    var plotH = height - padY * 2;

    function xFor(day) {
      return padX + (plotW * (day - minDay)) / (maxDay - minDay);
    }
    function yFor(v) {
      return padY + plotH - ((v - minV) / (maxV - minV)) * plotH;
    }

    var svg = svgEl("svg", {
      viewBox: "0 0 " + width + " " + height,
      width: "100%",
      height: height,
      class: "chart-svg",
      role: "img",
      "aria-label": opts.label || "Chart",
    });

    [0.25, 0.5, 0.75].forEach(function (f) {
      var gy = padY + plotH * f;
      svg.appendChild(
        svgEl("line", { x1: padX, x2: width - padX, y1: gy, y2: gy, class: "chart-grid" })
      );
    });

    usable.forEach(function (s) {
      var pathD = "";
      for (var i = 0; i < s.points.length; i++) {
        var x = xFor(s.points[i].day);
        var y = yFor(s.points[i].value);
        pathD += (i === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1) + " ";
      }
      var attrs = {
        d: pathD.trim(),
        fill: "none",
        stroke: s.color || "#4f7cff",
        "stroke-width": s.dashed ? "1.75" : "2.25",
        "stroke-linejoin": "round",
        "stroke-linecap": "round",
      };
      // A dashed series is a reference overlay (e.g. the previous run's
      // delivery curve) rather than live data — no end-point dot for it.
      if (s.dashed) {
        attrs["stroke-dasharray"] = "4 3";
        attrs["stroke-opacity"] = "0.75";
      }
      svg.appendChild(svgEl("path", attrs));
      if (!s.dashed) {
        var lastPoint = s.points[s.points.length - 1];
        var lastX = xFor(lastPoint.day);
        var lastY = yFor(lastPoint.value);
        svg.appendChild(svgEl("circle", { cx: lastX, cy: lastY, r: 3, fill: s.color || "#4f7cff" }));
      }
    });

    containerEl.appendChild(svg);

    var legend = document.createElement("div");
    legend.className = "chart-legend";
    legend.innerHTML = usable
      .map(function (s) {
        var last = s.points[s.points.length - 1].value;
        return (
          '<span class="chart-legend-item"><span class="chart-legend-dot" style="background:' +
          (s.color || "#4f7cff") + '"></span>' + s.label + " (" + Math.round(last) + ")</span>"
        );
      })
      .join("");
    containerEl.appendChild(legend);
  }

  /**
   * Map a pointer position back to the day it sits over, using the metadata
   * the last render left on the container. Returns null if that chart hasn't
   * been rendered with data yet.
   */
  function dayAtClientX(containerEl, clientX) {
    var meta = containerEl && containerEl.__chartMeta;
    if (!meta || !meta.days.length) return null;
    var svg = containerEl.querySelector("svg");
    if (!svg) return null;
    var rect = svg.getBoundingClientRect();
    if (!rect.width) return null;

    // Pointer px -> viewBox units -> fraction along the plot area -> index.
    var vx = ((clientX - rect.left) / rect.width) * meta.width;
    var frac = meta.plotW > 0 ? (vx - meta.padX) / meta.plotW : 0;
    frac = Math.max(0, Math.min(1, frac));
    var idx = Math.round(frac * (meta.days.length - 1));
    return meta.days[idx];
  }

  root.Charts = {
    renderLineChart: renderLineChart,
    renderMultiLineChart: renderMultiLineChart,
    dayAtClientX: dayAtClientX,
  };
})(typeof window !== "undefined" ? window : this);
