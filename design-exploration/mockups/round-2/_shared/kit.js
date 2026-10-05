/* Round-2 glue on top of round-1 core.js: selection, quick-approve, j/k, palette, ambient.
   Each direction supplies render(current) and head(current); markup hooks are
   [data-id] (open a session), [data-qa] (approve inline), #chat/#scroll/#composer. */
window.Kit = function boot(o) {
  const F = window.Frogg;
  const $ = (s) => document.querySelector(s);
  const st = { current: F.sessions.find((s) => s.id === (o.start || "s1")) };
  const ctx = { container: $("#chat"), scroller: $("#scroll") };
  ctx.onState = (s) => o.onState && o.onState(s, st.current);
  const paint = () => {
    o.render(st.current);
    o.head && o.head(st.current);
  };
  function select(id) {
    st.current = F.sessions.find((s) => s.id === id);
    st.current.unread = 0;
    F.swap(() => {
      paint();
      F.mountChat($("#chat"), st.current, ctx);
      document.body.dataset.mview = "chat";
    });
  }
  document.addEventListener("click", (e) => {
    const qa = e.target.closest("[data-qa]");
    if (qa) {
      e.stopPropagation();
      F.sessions.find((x) => x.id === qa.dataset.qa).status = "running";
      paint();
      return;
    }
    const r = e.target.closest("[data-id]");
    if (r) select(r.dataset.id);
    if (e.target.closest("[data-back]")) document.body.dataset.mview = "list";
    if (e.target.closest("[data-pal]")) pal.open();
    const tool = e.target.closest(".tool-head");
    if (tool) tool.parentElement.classList.toggle("open");
  });
  document.addEventListener("keydown", (e) => {
    if (e.target.isContentEditable || e.target.tagName === "INPUT") return;
    const ids = [...new Set([...document.querySelectorAll("[data-id]")].map((r) => r.dataset.id))];
    const i = ids.indexOf(st.current.id);
    if (e.key === "j") select(ids[Math.min(ids.length - 1, i + 1)]);
    if (e.key === "k") select(ids[Math.max(0, i - 1)]);
  });
  $("#composer").innerHTML = F.composerHTML({ placeholder: o.placeholder });
  F.wireComposer(document.body, ctx);
  const pal = F.palette((s) => select(s.id));
  paint();
  F.mountChat($("#chat"), st.current, ctx);
  document.body.dataset.mview = new URLSearchParams(location.search).get("m") ? "list" : "chat";
  F.ambient((s, kind) => {
    paint();
    o.onEvent && o.onEvent(s, kind);
  });
  return { select, st, F };
};
