Remix();
try {
  Terrain.mountFacets(document.getElementById("facets"));
} catch (err) {
  console.warn("terrain disabled", err);
}
document
  .getElementById("scroll")
  .addEventListener("scroll", (e) =>
    document.body.classList.toggle("compact", e.target.scrollTop > 40),
  );
