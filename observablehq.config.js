export default {
  root: "src",
  title: "EU Power Markets",
  style: "style.css",
  // src/index.md is the landing page and is not listed here. Every other page goes in this
  // array — it drives the left sidebar nav.
  pages: [
    {name: "Generation mix", path: "/generation"},
    {name: "Day-ahead prices", path: "/prices"},
    {name: "Day-ahead spreads", path: "/spreads"},
    {name: "Capture factors", path: "/capture"}
  ],
  footer: "Built with Observable Framework. Data: ENTSO-E Transparency Platform via entsoemcp.com; gas and carbon prices: Energy-Charts (Fraunhofer ISE)."
};
