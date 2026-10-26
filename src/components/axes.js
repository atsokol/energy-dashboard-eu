// Responsive x-axis configuration for multi-year time series (see docs/CHARTS.md).
// Narrow screens get yearly ticks; wider screens get quarterly ticks in a biaxial
// "%b\n%Y" format that prints the year only on its first appearance.

export function timeAxis(width, d3) {
  if (width < 500) {
    return {line: true, label: null, ticks: d3.utcYear.every(1), tickFormat: d3.utcFormat("%Y")};
  }
  const seen = new Set();
  return {
    line: true,
    label: null,
    ticks: d3.utcMonth.every(3),
    tickFormat: (d) => {
      const year = d.getUTCFullYear();
      if (d.getUTCMonth() === 0 || !seen.has(year)) {
        seen.add(year);
        return d3.utcFormat("%b\n%Y")(d);
      }
      return d3.utcFormat("%b")(d);
    }
  };
}
