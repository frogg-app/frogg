Remix();
const $ = (s) => document.querySelector(s);
$("#logoS").innerHTML = R3.facet("frogg-focus", ["#7fd9e6", "#045b9d"], 16);
const drawer = (open) => document.body.classList.toggle("drawer-open", open);
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-drawer]")) drawer(!document.body.classList.contains("drawer-open"));
  else if (e.target.closest(".drawer [data-id]") && !e.target.closest("[data-qa]")) drawer(false);
});
document.addEventListener("keydown", (e) => {
  if (e.target.isContentEditable || e.target.tagName === "INPUT") return;
  if (e.key === "Tab") {
    e.preventDefault();
    drawer(!document.body.classList.contains("drawer-open"));
  }
  if (e.key === "Escape") drawer(false);
});
