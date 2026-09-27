/**
 * Code that runs inside a client plugin's sandbox. Kept as a plain-JS string (not bundled) so it
 * runs unchanged in the sandboxed iframe, and so tests can evaluate the exact same text against a
 * Node MessageChannel. `__froggBoot(port, loadModule)` builds `ctx`, loads the plugin module and
 * calls its `activate(ctx)`. The port is the only way out; it never leaves this closure.
 *
 * Wire (over the port):
 *   app → sandbox  {t:"init", code, info}        load + activate
 *                  {t:"invoke", id, method, params}  a contribution the plugin handles
 *                  {t:"result", id, ok, value, error} answer to a sandbox "call"
 *   sandbox → app  {t:"call", id, op, args}      a ctx API call
 *                  {t:"handled", methods}        methods registered with ctx.rpc.handle
 *                  {t:"activated"} | {t:"failed", error}
 *                  {t:"result", id, ok, value, error} answer to an "invoke"
 */
export const CLIENT_PLUGIN_BOOTSTRAP = String.raw`
function __froggBoot(port, loadModule) {
  var nextId = 1;
  var pending = new Map();
  var handlers = new Map();
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

/** The srcdoc for one plugin's sandboxed iframe. Boots, then waits for the app's port. */
export function sandboxDocument(capabilities: readonly string[]): string {
  const csp = sandboxCsp(capabilities).replace(/"/g, "&quot;");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body><script>
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
    __froggBoot(event.ports[0], loadModule);
  });
  window.parent.postMessage({ t: "frogg-plugin-boot" }, "*");
})();
</script></body></html>`;
}
