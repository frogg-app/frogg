/**
 * Code that runs inside a client plugin's sandbox. Kept as a plain-JS string (not bundled) so it
 * runs unchanged in the sandboxed iframe, and so tests can evaluate the exact same text against a
 * Node MessageChannel. `__froggBoot(port, loadModule)` builds `ctx`, loads the plugin module and
 * calls its `activate(ctx)`. The port is the only way out; it never leaves this closure.
 *
 * Wire (over the port):
 *   app → sandbox  {t:"init", code, info}        load + activate; with info.view, render that
 *                                                view into #root instead of activating
 *                  {t:"invoke", id, method, params}  a contribution the plugin handles
 *                  {t:"result", id, ok, value, error} answer to a sandbox "call"
 *                  {t:"event", event, data}     ctx.events delivery
 *                  {t:"audio", chunk}           ctx.media microphone chunk
 *   sandbox → app  {t:"call", id, op, args}      a ctx API call
 *                  {t:"handled", methods}        methods registered with ctx.rpc.handle
 *                  {t:"activated"} | {t:"failed", error}
 *                  {t:"result", id, ok, value, error} answer to an "invoke"
 */
export const CLIENT_PLUGIN_BOOTSTRAP = String.raw`
function __froggBoot(port, loadModule, getRoot) {
  var nextId = 1;
  var pending = new Map();
  var handlers = new Map();
  var eventListeners = new Map();
  var audioListeners = new Set();
  var started = false;
  function errorText(e) { return e && e.message ? String(e.message) : String(e); }
  function call(op, args) {
    var id = nextId++;
    return new Promise(function (resolve, reject) {
      pending.set(id, { resolve: resolve, reject: reject });
      port.postMessage({ t: "call", id: id, op: op, args: args });
    });
  }
  function announce() { port.postMessage({ t: "handled", methods: Array.from(handlers.keys()) }); }
  function makeLog(level) {
    return function (message, data) { void call("log", { level: level, message: String(message), data: data }); };
  }
  function buildCtx(info) {
    var caps = new Set(info.capabilities || []);
    var ctx = {
      apiVersion: 1,
      log: { debug: makeLog("debug"), info: makeLog("info"), warn: makeLog("warn"), error: makeLog("error") },
      plugin: Object.freeze({ id: info.id, version: info.version, dev: !!info.dev, capabilities: Object.freeze((info.capabilities || []).slice()) })
    };
    if (caps.has("settings.store")) {
      ctx.settings = {
        get: function (key) { return call("settings.get", { key: key }).then(function (v) { return v === null ? undefined : v; }); },
        set: function (key, value) { return call("settings.set", { key: key, value: value }).then(function () {}); },
        delete: function (key) { return call("settings.delete", { key: key }).then(function () {}); },
        all: function () { return call("settings.all", {}); }
      };
    }
    if (caps.has("rpc")) {
      ctx.rpc = {
        handle: function (method, fn) {
          if (typeof method !== "string" || typeof fn !== "function") throw new Error("rpc.handle(method, fn)");
          handlers.set(method, fn);
          announce();
          return { dispose: function () { if (handlers.get(method) === fn) { handlers.delete(method); announce(); } } };
        },
        call: function (method, params) { return call("rpc.call", { method: method, params: params }); }
      };
    }
    if (caps.has("ui.contribute")) {
      ctx.ui = { notify: function (message, level) { void call("ui.notify", { message: String(message), level: level }); } };
    }
    if (caps.has("rpc")) {
      ctx.events = {
        on: function (event, fn) {
          if (typeof event !== "string" || typeof fn !== "function") throw new Error("events.on(event, fn)");
          var set = eventListeners.get(event);
          if (!set) { set = new Set(); eventListeners.set(event, set); }
          set.add(fn);
          return { dispose: function () { set.delete(fn); } };
        },
        emit: function (event, data) { void call("events.emit", { event: String(event), data: data === undefined ? null : data }); }
      };
    }
    if (caps.has("media.microphone") || caps.has("media.audio")) {
      ctx.media = {
        startCapture: function () { return call("media.capture.start", {}).then(function () {}); },
        stopCapture: function () { void call("media.capture.stop", {}); },
        onAudio: function (fn) {
          if (typeof fn !== "function") throw new Error("media.onAudio(fn)");
          audioListeners.add(fn);
          return { dispose: function () { audioListeners.delete(fn); } };
        },
        play: function (audio) { return call("media.play", { data: audio && audio.data, format: audio && audio.format }).then(function () {}); },
        stopPlayback: function () { void call("media.stop", {}); }
      };
    }
    if (caps.has("composer")) {
      ctx.composer = { insertText: function (text) { return call("composer.insert", { text: String(text) }).then(function (v) { return v === true; }); } };
    }
    if (info.view) {
      ctx.view = Object.freeze({ id: String(info.view), close: function () { void call("view.close", {}); } });
    }
    return Object.freeze(ctx);
  }
  function reply(id, promise) {
    Promise.resolve().then(function () { return promise(); }).then(
      function (value) {
        var safe;
        try { safe = value === undefined ? null : JSON.parse(JSON.stringify(value)); }
        catch (e) { port.postMessage({ t: "result", id: id, ok: false, error: "result is not JSON" }); return; }
        port.postMessage({ t: "result", id: id, ok: true, value: safe });
      },
      function (e) { port.postMessage({ t: "result", id: id, ok: false, error: errorText(e) }); }
    );
  }
  port.onmessage = function (event) {
    var m = event.data;
    if (!m || typeof m !== "object") return;
    if (m.t === "result") {
      var p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.resolve(m.value); else p.reject(new Error(m.error));
      return;
    }
    if (m.t === "event") {
      var listeners = eventListeners.get(m.event);
      if (listeners) listeners.forEach(function (fn) { try { fn(m.data); } catch (e) { void call("log", { level: "error", message: errorText(e) }); } });
      return;
    }
    if (m.t === "audio") {
      audioListeners.forEach(function (fn) { try { fn(m.chunk); } catch (e) { void call("log", { level: "error", message: errorText(e) }); } });
      return;
    }
    if (m.t === "invoke") {
      reply(m.id, function () {
        var fn = handlers.get(m.method);
        if (!fn) throw new Error("No client handler for " + m.method);
        return fn(m.params);
      });
      return;
    }
    if (m.t === "init" && !started) {
      started = true;
      var ctx = buildCtx(m.info || {});
      Promise.resolve()
        .then(function () { return loadModule(String(m.code)); })
        .then(function (mod) {
          if (ctx.view) {
            var render = mod && mod.views && mod.views[ctx.view.id];
            if (typeof render !== "function") throw new Error("The client entry does not export views[" + JSON.stringify(ctx.view.id) + "]");
            return render(getRoot(), ctx);
          }
          var activate = mod && (typeof mod.default === "function" ? mod.default : mod.activate);
          if (typeof activate !== "function") throw new Error("The client entry does not export activate()");
          return activate(ctx);
        })
        .then(function () { announce(); port.postMessage({ t: "activated" }); },
              function (e) { port.postMessage({ t: "failed", error: errorText(e) }); });
    }
  };
  if (typeof port.start === "function") port.start();
}
`;

/** Content-Security-Policy for the sandbox document. Network only with the `network` capability. */
export function sandboxCsp(capabilities: readonly string[]): string {
  const connect = capabilities.includes("network") ? "http: https: ws: wss:" : "'none'";
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline' blob:",
    `connect-src ${connect}`,
    "img-src data: blob:",
    "style-src 'unsafe-inline'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

/**
 * The srcdoc for one plugin's sandboxed iframe. Boots, then waits for the app's port. A view
 * document fills its frame and gives the plugin a `#root` element to render into.
 */
export function sandboxDocument(
  capabilities: readonly string[],
  options: { view?: boolean } = {},
): string {
  const csp = sandboxCsp(capabilities).replace(/"/g, "&quot;");
  const body = options.view
    ? `<style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style><div id="root"></div>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body>${body}<script>
${CLIENT_PLUGIN_BOOTSTRAP}
(function () {
  function loadModule(code) {
    var url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    return import(url).finally(function () { URL.revokeObjectURL(url); });
  }
  var taken = false;
  window.addEventListener("message", function (event) {
    if (taken || event.source !== window.parent) return;
    var d = event.data;
    if (!d || d.t !== "frogg-plugin-port" || !event.ports || !event.ports[0]) return;
    taken = true;
    __froggBoot(event.ports[0], loadModule, function () { return document.getElementById("root") || document.body; });
  });
  window.parent.postMessage({ t: "frogg-plugin-boot" }, "*");
})();
</script></body></html>`;
}
