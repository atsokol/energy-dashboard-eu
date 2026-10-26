// Shared Plot.tip `render` function for charts with multiple series sharing the same x
// position (e.g. one line per country). The browser's default pointer tooltip only shows
// whichever series is nearest the cursor; this instead renders a small inset panel listing
// every series' value at the hovered x, coloured to match the plotted lines.
//
// d3 and Plot are passed in explicitly (not imported) — see components/axes.js for the same
// convention, since these globals are only auto-injected inside page ```js cells.

export function multiSeriesTip(d3, Plot, {
  y,
  value,
  valueFormat = d3.format(".1f"),
  header,
  rowHeight = 14,
  width = 195,
} = {}) {
  return function renderMultiSeriesTip(index, scales, values, dimensions, context) {
    const g = d3.select(context.ownerSVGElement).append("g");
    const [i] = index;
    if (i === undefined) return g.node();

    const rows = values.title[i];
    // Anchor the panel on the bin's own `x` channel, which the `{x: "min"}` output in every
    // pointer binX here supplies (see CHARTS.md): it is the x of the data in the bin, so the panel
    // lands on the plotted point, its axis tick and the ruleX guide line all at once. Without that
    // output binX emits only x1/x2 and every mark falls back to the bin's midpoint — half an
    // interval to the right of the data it describes, which is 45px on quarterly bins. The
    // midpoint stays as the fallback for a bin that supplies no `x`, matching Plot's own anchorX.
    let anchor = values.x
      ? values.x[i]
      : values.x1 && values.x2
        ? (values.x1[i] + values.x2[i]) / 2
        : values.x1[i];
    // A band scale positions a value at the band's left edge and every mark shifts itself right by
    // half a band (applyTransform in style.js); do the same so the panel tracks the band's centre.
    if (scales.x?.bandwidth) anchor += scales.x.bandwidth() / 2;

    // In a faceted plot the scaled values above are facet-local, and Plot re-applies the facet's
    // own translate to whatever this function returns (facetTranslator in facet.js). `dimensions`
    // is then the facet's box, not the plot's: clamping against it pins the panel inside a single
    // column — and a panel wider than the column collapses onto its left margin and stops tracking
    // the pointer entirely. So shift into plot coordinates, clamp against the whole frame
    // (`dimensions.facet` carries the outer width), then shift back out, since Plot adds the facet
    // translate on top of the transform set here.
    const tx = scales.fx && index.fx !== undefined ? scales.fx(index.fx) - dimensions.marginLeft : 0;
    const frameWidth = dimensions.facet?.width ?? dimensions.width;
    // Centre on that anchor, then keep the whole panel inside the plot frame near either edge.
    const left = Math.max(
      dimensions.marginLeft + 5,
      Math.min(anchor + tx - width / 2, frameWidth - dimensions.marginRight - width - 5)
    ) - tx;
    g.attr("transform", `translate(${left}, 20)`)
      .append(() =>
        Plot.plot({
          marginTop: 14,
          height: 20 + rows.length * rowHeight,
          width,
          axis: null,
          y: {domain: scales.scales.color.domain},
          marks: [
            Plot.frame({fill: "var(--theme-background)", stroke: "currentColor"}),
            Plot.dot(rows, {y, fill: (d) => scales.color(d[y]), r: 5, frameAnchor: "left", symbol: "square2", dx: 7}),
            Plot.text(rows, {y, text: y, frameAnchor: "left", dx: 14}),
            Plot.text(rows, {y, text: (d) => valueFormat(d[value]), frameAnchor: "right", dx: -2}),
            Plot.text([rows[0]], {frameAnchor: "top-left", dy: -13, text: header})
          ]
        })
      );
    return g.node();
  };
}
