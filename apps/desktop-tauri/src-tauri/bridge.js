"use strict";
(() => {
  function s(n, e, t, r) {
    if (t === "a" && !r) throw new TypeError("Private accessor was defined without a getter");
    if (typeof e == "function" ? n !== e || !r : !e.has(n))
      throw new TypeError(
        "Cannot read private member from an object whose class did not declare it",
      );
    return t === "m" ? r : t === "a" ? r.call(n) : r ? r.value : e.get(n);
  }
  function p(n, e, t, r, a) {
    if (r === "m") throw new TypeError("Private method is not writable");
    if (r === "a" && !a) throw new TypeError("Private accessor was defined without a setter");
    if (typeof e == "function" ? n !== e || !a : !e.has(n))
      throw new TypeError(
        "Cannot write private member to an object whose class did not declare it",
      );
    return (r === "a" ? a.call(n, t) : a ? (a.value = t) : e.set(n, t), t);
  }
  var f,
    d,
    b,
    L,
    C,
    o = "__TAURI_TO_IPC_KEY__";
  function P(n, e = !1) {
    return window.__TAURI_INTERNALS__.transformCallback(n, e);
  }
  var W = class {
    constructor(e) {
      (f.set(this, void 0),
        d.set(this, 0),
        b.set(this, []),
        L.set(this, void 0),
        p(this, f, e || (() => {}), "f"),
        (this.id = P((t) => {
          let r = t.index;
          if ("end" in t) {
            r == s(this, d, "f") ? this.cleanupCallback() : p(this, L, r, "f");
            return;
          }
          let a = t.message;
          if (r == s(this, d, "f")) {
            for (
              s(this, f, "f").call(this, a), p(this, d, s(this, d, "f") + 1, "f");
              s(this, d, "f") in s(this, b, "f");
            ) {
              let u = s(this, b, "f")[s(this, d, "f")];
              (s(this, f, "f").call(this, u),
                delete s(this, b, "f")[s(this, d, "f")],
                p(this, d, s(this, d, "f") + 1, "f"));
            }
            s(this, d, "f") === s(this, L, "f") && this.cleanupCallback();
          } else s(this, b, "f")[r] = a;
        })));
    }
    cleanupCallback() {
      window.__TAURI_INTERNALS__.unregisterCallback(this.id);
    }
    set onmessage(e) {
      p(this, f, e, "f");
    }
    get onmessage() {
      return s(this, f, "f");
    }
    [((f = new WeakMap()), (d = new WeakMap()), (b = new WeakMap()), (L = new WeakMap()), o)]() {
      return `__CHANNEL__:${this.id}`;
    }
    toJSON() {
      return this[o]();
    }
  };
  async function i(n, e = {}, t) {
    return window.__TAURI_INTERNALS__.invoke(n, e, t);
  }
  var I = class {
    get rid() {
      return s(this, C, "f");
    }
    constructor(e) {
      (C.set(this, void 0), p(this, C, e, "f"));
    }
    async close() {
      return i("plugin:resources|close", { rid: this.rid });
    }
  };
  C = new WeakMap();
  var c;
  (function (n) {
    ((n.WINDOW_RESIZED = "tauri://resize"),
      (n.WINDOW_MOVED = "tauri://move"),
      (n.WINDOW_CLOSE_REQUESTED = "tauri://close-requested"),
      (n.WINDOW_DESTROYED = "tauri://destroyed"),
      (n.WINDOW_FOCUS = "tauri://focus"),
      (n.WINDOW_BLUR = "tauri://blur"),
      (n.WINDOW_SCALE_FACTOR_CHANGED = "tauri://scale-change"),
      (n.WINDOW_THEME_CHANGED = "tauri://theme-changed"),
      (n.WINDOW_CREATED = "tauri://window-created"),
      (n.WINDOW_SUSPENDED = "tauri://suspended"),
      (n.WINDOW_RESUMED = "tauri://resumed"),
      (n.WEBVIEW_CREATED = "tauri://webview-created"),
      (n.DRAG_ENTER = "tauri://drag-enter"),
      (n.DRAG_OVER = "tauri://drag-over"),
      (n.DRAG_DROP = "tauri://drag-drop"),
      (n.DRAG_LEAVE = "tauri://drag-leave"));
  })(c || (c = {}));
  async function z(n, e) {
    (window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(n, e),
      await i("plugin:event|unlisten", { event: n, eventId: e }));
  }
  async function y(n, e, t) {
    var r;
    let a =
      typeof t?.target == "string"
        ? { kind: "AnyLabel", label: t.target }
        : (r = t?.target) !== null && r !== void 0
          ? r
          : { kind: "Any" };
    return i("plugin:event|listen", { event: n, target: a, handler: P(e) }).then(
      (u) => async () => z(n, u),
    );
  }
  async function M(n, e, t) {
    return y(
      n,
      (r) => {
        (z(n, r.id), e(r));
      },
      t,
    );
  }
  async function U(n, e) {
    await i("plugin:event|emit", { event: n, payload: e });
  }
  async function B(n, e, t) {
    await i("plugin:event|emit_to", {
      target: typeof n == "string" ? { kind: "AnyLabel", label: n } : n,
      event: e,
      payload: t,
    });
  }
  var m = class {
      constructor(...e) {
        ((this.type = "Logical"),
          e.length === 1
            ? "Logical" in e[0]
              ? ((this.width = e[0].Logical.width), (this.height = e[0].Logical.height))
              : ((this.width = e[0].width), (this.height = e[0].height))
            : ((this.width = e[0]), (this.height = e[1])));
      }
      toPhysical(e) {
        return new g(this.width * e, this.height * e);
      }
      [o]() {
        return { width: this.width, height: this.height };
      }
      toJSON() {
        return this[o]();
      }
    },
    g = class {
      constructor(...e) {
        ((this.type = "Physical"),
          e.length === 1
            ? "Physical" in e[0]
              ? ((this.width = e[0].Physical.width), (this.height = e[0].Physical.height))
              : ((this.width = e[0].width), (this.height = e[0].height))
            : ((this.width = e[0]), (this.height = e[1])));
      }
      toLogical(e) {
        return new m(this.width / e, this.height / e);
      }
      [o]() {
        return { width: this.width, height: this.height };
      }
      toJSON() {
        return this[o]();
      }
    },
    h = class {
      constructor(e) {
        this.size = e;
      }
      toLogical(e) {
        return this.size instanceof m ? this.size : this.size.toLogical(e);
      }
      toPhysical(e) {
        return this.size instanceof g ? this.size : this.size.toPhysical(e);
      }
      [o]() {
        return { [`${this.size.type}`]: { width: this.size.width, height: this.size.height } };
      }
      toJSON() {
        return this[o]();
      }
    },
    v = class {
      constructor(...e) {
        ((this.type = "Logical"),
          e.length === 1
            ? "Logical" in e[0]
              ? ((this.x = e[0].Logical.x), (this.y = e[0].Logical.y))
              : ((this.x = e[0].x), (this.y = e[0].y))
            : ((this.x = e[0]), (this.y = e[1])));
      }
      toPhysical(e) {
        return new w(this.x * e, this.y * e);
      }
      [o]() {
        return { x: this.x, y: this.y };
      }
      toJSON() {
        return this[o]();
      }
    },
    w = class {
      constructor(...e) {
        ((this.type = "Physical"),
          e.length === 1
            ? "Physical" in e[0]
              ? ((this.x = e[0].Physical.x), (this.y = e[0].Physical.y))
              : ((this.x = e[0].x), (this.y = e[0].y))
            : ((this.x = e[0]), (this.y = e[1])));
      }
      toLogical(e) {
        return new v(this.x / e, this.y / e);
      }
      [o]() {
        return { x: this.x, y: this.y };
      }
      toJSON() {
        return this[o]();
      }
    },
    _ = class {
      constructor(e) {
        this.position = e;
      }
      toLogical(e) {
        return this.position instanceof v ? this.position : this.position.toLogical(e);
      }
      toPhysical(e) {
        return this.position instanceof w ? this.position : this.position.toPhysical(e);
      }
      [o]() {
        return { [`${this.position.type}`]: { x: this.position.x, y: this.position.y } };
      }
      toJSON() {
        return this[o]();
      }
    };
  var R = class n extends I {
    constructor(e) {
      super(e);
    }
    static async new(e, t, r) {
      return i("plugin:image|new", { rgba: k(e), width: t, height: r }).then((a) => new n(a));
    }
    static async fromBytes(e) {
      return i("plugin:image|from_bytes", { bytes: k(e) }).then((t) => new n(t));
    }
    static async fromPath(e) {
      return i("plugin:image|from_path", { path: e }).then((t) => new n(t));
    }
    async rgba() {
      return i("plugin:image|rgba", { rid: this.rid }).then((e) => new Uint8Array(e));
    }
    async size() {
      return i("plugin:image|size", { rid: this.rid });
    }
  };
  function k(n) {
    return n == null ? null : typeof n == "string" ? n : n instanceof R ? n.rid : n;
  }
  var E;
  (function (n) {
    ((n[(n.Critical = 1)] = "Critical"), (n[(n.Informational = 2)] = "Informational"));
  })(E || (E = {}));
  var S = class {
      constructor(e) {
        ((this._preventDefault = !1), (this.event = e.event), (this.id = e.id));
      }
      preventDefault() {
        this._preventDefault = !0;
      }
      isPreventDefault() {
        return this._preventDefault;
      }
    },
    F;
  (function (n) {
    ((n.None = "none"),
      (n.Normal = "normal"),
      (n.Indeterminate = "indeterminate"),
      (n.Paused = "paused"),
      (n.Error = "error"));
  })(F || (F = {}));
  function D() {
    return new x(window.__TAURI_INTERNALS__.metadata.currentWindow.label, { skip: !0 });
  }
  async function T() {
    return i("plugin:window|get_all_windows").then((n) => n.map((e) => new x(e, { skip: !0 })));
  }
  var O = ["tauri://created", "tauri://error"],
    x = class {
      constructor(e, t = {}) {
        var r;
        ((this.label = e),
          (this.listeners = Object.create(null)),
          t?.skip ||
            i("plugin:window|create", {
              options: {
                ...t,
                parent:
                  typeof t.parent == "string"
                    ? t.parent
                    : (r = t.parent) === null || r === void 0
                      ? void 0
                      : r.label,
                label: e,
              },
            })
              .then(async () => this.emit("tauri://created"))
              .catch(async (a) => this.emit("tauri://error", a)));
      }
      static async getByLabel(e) {
        var t;
        return (t = (await T()).find((r) => r.label === e)) !== null && t !== void 0 ? t : null;
      }
      static getCurrent() {
        return D();
      }
      static async getAll() {
        return T();
      }
      static async getFocusedWindow() {
        for (let e of await T()) if (await e.isFocused()) return e;
        return null;
      }
      async listen(e, t) {
        return this._handleTauriEvent(e, t)
          ? () => {
              let r = this.listeners[e];
              r.splice(r.indexOf(t), 1);
            }
          : y(e, t, { target: { kind: "Window", label: this.label } });
      }
      async once(e, t) {
        return this._handleTauriEvent(e, t)
          ? () => {
              let r = this.listeners[e];
              r.splice(r.indexOf(t), 1);
            }
          : M(e, t, { target: { kind: "Window", label: this.label } });
      }
      async emit(e, t) {
        if (O.includes(e)) {
          for (let r of this.listeners[e] || []) r({ event: e, id: -1, payload: t });
          return;
        }
        return U(e, t);
      }
      async emitTo(e, t, r) {
        if (O.includes(t)) {
          for (let a of this.listeners[t] || []) a({ event: t, id: -1, payload: r });
          return;
        }
        return B(e, t, r);
      }
      _handleTauriEvent(e, t) {
        return O.includes(e)
          ? (e in this.listeners ? this.listeners[e].push(t) : (this.listeners[e] = [t]), !0)
          : !1;
      }
      async scaleFactor() {
        return i("plugin:window|scale_factor", { label: this.label });
      }
      async innerPosition() {
        return i("plugin:window|inner_position", { label: this.label }).then((e) => new w(e));
      }
      async outerPosition() {
        return i("plugin:window|outer_position", { label: this.label }).then((e) => new w(e));
      }
      async innerSize() {
        return i("plugin:window|inner_size", { label: this.label }).then((e) => new g(e));
      }
      async outerSize() {
        return i("plugin:window|outer_size", { label: this.label }).then((e) => new g(e));
      }
      async isFullscreen() {
        return i("plugin:window|is_fullscreen", { label: this.label });
      }
      async isMinimized() {
        return i("plugin:window|is_minimized", { label: this.label });
      }
      async isMaximized() {
        return i("plugin:window|is_maximized", { label: this.label });
      }
      async isFocused() {
        return i("plugin:window|is_focused", { label: this.label });
      }
      async isDecorated() {
        return i("plugin:window|is_decorated", { label: this.label });
      }
      async isResizable() {
        return i("plugin:window|is_resizable", { label: this.label });
      }
      async isMaximizable() {
        return i("plugin:window|is_maximizable", { label: this.label });
      }
      async isMinimizable() {
        return i("plugin:window|is_minimizable", { label: this.label });
      }
      async isClosable() {
        return i("plugin:window|is_closable", { label: this.label });
      }
      async isVisible() {
        return i("plugin:window|is_visible", { label: this.label });
      }
      async title() {
        return i("plugin:window|title", { label: this.label });
      }
      async theme() {
        return i("plugin:window|theme", { label: this.label });
      }
      async isAlwaysOnTop() {
        return i("plugin:window|is_always_on_top", { label: this.label });
      }
      async activityName() {
        return i("plugin:window|activity_name", { label: this.label });
      }
      async sceneIdentifier() {
        return i("plugin:window|scene_identifier", { label: this.label });
      }
      async center() {
        return i("plugin:window|center", { label: this.label });
      }
      async requestUserAttention(e) {
        let t = null;
        return (
          e && (e === E.Critical ? (t = { type: "Critical" }) : (t = { type: "Informational" })),
          i("plugin:window|request_user_attention", { label: this.label, value: t })
        );
      }
      async setResizable(e) {
        return i("plugin:window|set_resizable", { label: this.label, value: e });
      }
      async setEnabled(e) {
        return i("plugin:window|set_enabled", { label: this.label, value: e });
      }
      async isEnabled() {
        return i("plugin:window|is_enabled", { label: this.label });
      }
      async setMaximizable(e) {
        return i("plugin:window|set_maximizable", { label: this.label, value: e });
      }
      async setMinimizable(e) {
        return i("plugin:window|set_minimizable", { label: this.label, value: e });
      }
      async setClosable(e) {
        return i("plugin:window|set_closable", { label: this.label, value: e });
      }
      async setTitle(e) {
        return i("plugin:window|set_title", { label: this.label, value: e });
      }
      async maximize() {
        return i("plugin:window|maximize", { label: this.label });
      }
      async unmaximize() {
        return i("plugin:window|unmaximize", { label: this.label });
      }
      async toggleMaximize() {
        return i("plugin:window|toggle_maximize", { label: this.label });
      }
      async minimize() {
        return i("plugin:window|minimize", { label: this.label });
      }
      async unminimize() {
        return i("plugin:window|unminimize", { label: this.label });
      }
      async show() {
        return i("plugin:window|show", { label: this.label });
      }
      async hide() {
        return i("plugin:window|hide", { label: this.label });
      }
      async close() {
        return i("plugin:window|close", { label: this.label });
      }
      async destroy() {
        return i("plugin:window|destroy", { label: this.label });
      }
      async setDecorations(e) {
        return i("plugin:window|set_decorations", { label: this.label, value: e });
      }
      async setShadow(e) {
        return i("plugin:window|set_shadow", { label: this.label, value: e });
      }
      async setEffects(e) {
        return i("plugin:window|set_effects", { label: this.label, value: e });
      }
      async clearEffects() {
        return i("plugin:window|set_effects", { label: this.label, value: null });
      }
      async setAlwaysOnTop(e) {
        return i("plugin:window|set_always_on_top", { label: this.label, value: e });
      }
      async setAlwaysOnBottom(e) {
        return i("plugin:window|set_always_on_bottom", { label: this.label, value: e });
      }
      async setContentProtected(e) {
        return i("plugin:window|set_content_protected", { label: this.label, value: e });
      }
      async setSize(e) {
        return i("plugin:window|set_size", {
          label: this.label,
          value: e instanceof h ? e : new h(e),
        });
      }
      async setMinSize(e) {
        return i("plugin:window|set_min_size", {
          label: this.label,
          value: e instanceof h ? e : e ? new h(e) : null,
        });
      }
      async setMaxSize(e) {
        return i("plugin:window|set_max_size", {
          label: this.label,
          value: e instanceof h ? e : e ? new h(e) : null,
        });
      }
      async setSizeConstraints(e) {
        function t(r) {
          return r ? { Logical: r } : null;
        }
        return i("plugin:window|set_size_constraints", {
          label: this.label,
          value: {
            minWidth: t(e?.minWidth),
            minHeight: t(e?.minHeight),
            maxWidth: t(e?.maxWidth),
            maxHeight: t(e?.maxHeight),
          },
        });
      }
      async setPosition(e) {
        return i("plugin:window|set_position", {
          label: this.label,
          value: e instanceof _ ? e : new _(e),
        });
      }
      async setFullscreen(e) {
        return i("plugin:window|set_fullscreen", { label: this.label, value: e });
      }
      async setSimpleFullscreen(e) {
        return i("plugin:window|set_simple_fullscreen", { label: this.label, value: e });
      }
      async setFocus() {
        return i("plugin:window|set_focus", { label: this.label });
      }
      async setFocusable(e) {
        return i("plugin:window|set_focusable", { label: this.label, value: e });
      }
      async setIcon(e) {
        return i("plugin:window|set_icon", { label: this.label, value: k(e) });
      }
      async setSkipTaskbar(e) {
        return i("plugin:window|set_skip_taskbar", { label: this.label, value: e });
      }
      async setCursorGrab(e) {
        return i("plugin:window|set_cursor_grab", { label: this.label, value: e });
      }
      async setCursorVisible(e) {
        return i("plugin:window|set_cursor_visible", { label: this.label, value: e });
      }
      async setCursorIcon(e) {
        return i("plugin:window|set_cursor_icon", { label: this.label, value: e });
      }
      async setBackgroundColor(e) {
        return i("plugin:window|set_background_color", { color: e });
      }
      async setCursorPosition(e) {
        return i("plugin:window|set_cursor_position", {
          label: this.label,
          value: e instanceof _ ? e : new _(e),
        });
      }
      async setIgnoreCursorEvents(e) {
        return i("plugin:window|set_ignore_cursor_events", { label: this.label, value: e });
      }
      async startDragging() {
        return i("plugin:window|start_dragging", { label: this.label });
      }
      async startResizeDragging(e) {
        return i("plugin:window|start_resize_dragging", { label: this.label, value: e });
      }
      async setBadgeCount(e) {
        return i("plugin:window|set_badge_count", { label: this.label, value: e });
      }
      async setBadgeLabel(e) {
        return i("plugin:window|set_badge_label", { label: this.label, value: e });
      }
      async setOverlayIcon(e) {
        return i("plugin:window|set_overlay_icon", { label: this.label, value: e ? k(e) : void 0 });
      }
      async setProgressBar(e) {
        return i("plugin:window|set_progress_bar", { label: this.label, value: e });
      }
      async setVisibleOnAllWorkspaces(e) {
        return i("plugin:window|set_visible_on_all_workspaces", { label: this.label, value: e });
      }
      async setTitleBarStyle(e) {
        return i("plugin:window|set_title_bar_style", { label: this.label, value: e });
      }
      async setTheme(e) {
        return i("plugin:window|set_theme", { label: this.label, value: e });
      }
      async onResized(e) {
        return this.listen(c.WINDOW_RESIZED, (t) => {
          ((t.payload = new g(t.payload)), e(t));
        });
      }
      async onMoved(e) {
        return this.listen(c.WINDOW_MOVED, (t) => {
          ((t.payload = new w(t.payload)), e(t));
        });
      }
      async onCloseRequested(e) {
        return this.listen(c.WINDOW_CLOSE_REQUESTED, async (t) => {
          let r = new S(t);
          (await e(r), r.isPreventDefault() || (await this.destroy()));
        });
      }
      async onDragDropEvent(e) {
        let t = await this.listen(c.DRAG_ENTER, (l) => {
            e({
              ...l,
              payload: {
                type: "enter",
                paths: l.payload.paths,
                position: new w(l.payload.position),
              },
            });
          }),
          r = await this.listen(c.DRAG_OVER, (l) => {
            e({ ...l, payload: { type: "over", position: new w(l.payload.position) } });
          }),
          a = await this.listen(c.DRAG_DROP, (l) => {
            e({
              ...l,
              payload: {
                type: "drop",
                paths: l.payload.paths,
                position: new w(l.payload.position),
              },
            });
          }),
          u = await this.listen(c.DRAG_LEAVE, (l) => {
            e({ ...l, payload: { type: "leave" } });
          });
        return () => {
          (t(), a(), r(), u());
        };
      }
      async onFocusChanged(e) {
        let t = await this.listen(c.WINDOW_FOCUS, (a) => {
            e({ ...a, payload: !0 });
          }),
          r = await this.listen(c.WINDOW_BLUR, (a) => {
            e({ ...a, payload: !1 });
          });
        return () => {
          (t(), r());
        };
      }
      async onScaleChanged(e) {
        return this.listen(c.WINDOW_SCALE_FACTOR_CHANGED, e);
      }
      async onThemeChanged(e) {
        return this.listen(c.WINDOW_THEME_CHANGED, e);
      }
    },
    H;
  (function (n) {
    ((n.Disabled = "disabled"), (n.Throttle = "throttle"), (n.Suspend = "suspend"));
  })(H || (H = {}));
  var G;
  (function (n) {
    ((n.Default = "default"), (n.FluentOverlay = "fluentOverlay"));
  })(G || (G = {}));
  var j;
  (function (n) {
    ((n.AppearanceBased = "appearanceBased"),
      (n.Light = "light"),
      (n.Dark = "dark"),
      (n.MediumLight = "mediumLight"),
      (n.UltraDark = "ultraDark"),
      (n.Titlebar = "titlebar"),
      (n.Selection = "selection"),
      (n.Menu = "menu"),
      (n.Popover = "popover"),
      (n.Sidebar = "sidebar"),
      (n.HeaderView = "headerView"),
      (n.Sheet = "sheet"),
      (n.WindowBackground = "windowBackground"),
      (n.HudWindow = "hudWindow"),
      (n.FullScreenUI = "fullScreenUI"),
      (n.Tooltip = "tooltip"),
      (n.ContentBackground = "contentBackground"),
      (n.UnderWindowBackground = "underWindowBackground"),
      (n.UnderPageBackground = "underPageBackground"),
      (n.Mica = "mica"),
      (n.Blur = "blur"),
      (n.Acrylic = "acrylic"),
      (n.Tabbed = "tabbed"),
      (n.TabbedDark = "tabbedDark"),
      (n.TabbedLight = "tabbedLight"));
  })(j || (j = {}));
  var V;
  (function (n) {
    ((n.FollowsWindowActiveState = "followsWindowActiveState"),
      (n.Active = "active"),
      (n.Inactive = "inactive"));
  })(V || (V = {}));
  function ae(n) {
    if (n !== void 0) {
      if (typeof n == "string") return n;
      if ("ok" in n && "cancel" in n) return { OkCancelCustom: [n.ok, n.cancel] };
      if ("yes" in n && "no" in n && "cancel" in n)
        return { YesNoCancelCustom: [n.yes, n.no, n.cancel] };
      if ("ok" in n) return { OkCustom: n.ok };
    }
  }
  async function $(n = {}) {
    return (
      typeof n == "object" && Object.freeze(n), await i("plugin:dialog|open", { options: n })
    );
  }
  async function se(n, e) {
    return await i("plugin:dialog|message", {
      message: n,
      title: e?.title,
      kind: e?.kind,
      buttons: ae(e?.buttons),
    });
  }
  async function A(n, e) {
    let t = typeof e == "string" ? { title: e } : e,
      r = t?.okLabel || t?.cancelLabel,
      a = t?.okLabel ?? "Yes";
    return (
      (await se(n, {
        title: t?.title,
        kind: t?.kind,
        buttons: r ? { ok: a, cancel: t.cancelLabel ?? "No" } : "YesNo",
      })) === a
    );
  }
  var q;
  (function (n) {
    ((n.Year = "year"),
      (n.Month = "month"),
      (n.TwoWeeks = "twoWeeks"),
      (n.Week = "week"),
      (n.Day = "day"),
      (n.Hour = "hour"),
      (n.Minute = "minute"),
      (n.Second = "second"));
  })(q || (q = {}));
  var J;
  (function (n) {
    ((n[(n.None = 0)] = "None"),
      (n[(n.Min = 1)] = "Min"),
      (n[(n.Low = 2)] = "Low"),
      (n[(n.Default = 3)] = "Default"),
      (n[(n.High = 4)] = "High"));
  })(J || (J = {}));
  var Y;
  (function (n) {
    ((n[(n.Secret = -1)] = "Secret"),
      (n[(n.Private = 0)] = "Private"),
      (n[(n.Public = 1)] = "Public"));
  })(Y || (Y = {}));
  async function K() {
    return window.Notification.permission !== "default"
      ? await Promise.resolve(window.Notification.permission === "granted")
      : await i("plugin:notification|is_permission_granted");
  }
  async function Z() {
    return await window.Notification.requestPermission();
  }
  function Q(n) {
    typeof n == "string" ? new window.Notification(n) : new window.Notification(n.title, n);
  }
  async function X(n, e) {
    await i("plugin:opener|open_url", { url: n, with: e });
  }
  function ee() {
    return window.__TAURI_OS_PLUGIN_INTERNALS__.platform;
  }
  var ne = "data-tauri-drag-region",
    le = [
      "button",
      "a[href]",
      "input",
      "textarea",
      "select",
      "[contenteditable]:not([contenteditable='false'])",
      '[role="button"]',
      '[role="textbox"]',
      '[role="menuitem"]',
      '[role="tab"]',
      '[role="slider"]',
      '[role="link"]',
      '[role="checkbox"]',
      '[role="switch"]',
      '[role="combobox"]',
    ].join(",");
  function oe(n, e) {
    let t = e.getComputedStyle(n);
    return (
      t.getPropertyValue("-webkit-app-region") ||
      t.getPropertyValue("app-region") ||
      t.webkitAppRegion ||
      t.appRegion ||
      ""
    ).trim();
  }
  function ue(n) {
    if (!n || typeof n != "object") return null;
    let e = n;
    return e.nodeType === 1 ? e : (e.parentElement ?? null);
  }
  function ce(n, e) {
    let t = ue(n);
    for (; t; ) {
      if (t.getAttribute(ne) === "false" || t.matches(le)) return "interactive";
      let r = oe(t, e);
      if (r === "no-drag") return "interactive";
      if (t.hasAttribute(ne) || r === "drag") return "drag";
      t = t.parentElement;
    }
    return "none";
  }
  function te(n, e = () => D()) {
    let t = !1,
      r = () => {
        e()
          .isFullscreen()
          .then((u) => ((t = u), u))
          .catch(() => !1);
      },
      a = (u) => {
        if (
          u.button !== 0 ||
          u.defaultPrevented ||
          ce(u.target, n) !== "drag" ||
          (u.preventDefault(), r(), t)
        )
          return;
        let l = e();
        (u.detail === 2 ? l.toggleMaximize() : l.startDragging()).catch((re) =>
          console.warn("[Frogg] window drag failed", re),
        );
      };
    return (
      n.addEventListener("mousedown", a, !0),
      () => {
        n.removeEventListener("mousedown", a, !0);
      }
    );
  }
  var de = new Set(["http:", "https:"]),
    N = window.__FROGG_DESKTOP_HOST__ ?? {};
  function we() {
    if (N.platform) return N.platform;
    try {
      let n = ee();
      return n === "macos" ? "darwin" : n === "windows" ? "win32" : n;
    } catch {
      return "linux";
    }
  }
  function he(n) {
    return N.windowChromeMode
      ? N.windowChromeMode
      : n === "darwin"
        ? "native-mac"
        : n === "linux"
          ? "custom-linux"
          : "custom-windows";
  }
  function ge(n) {
    let e = /^#?([0-9a-f]{6})$/i.exec(n.trim());
    if (!e) return null;
    let t = e[1];
    return [parseInt(t.slice(0, 2), 16), parseInt(t.slice(2, 4), 16), parseInt(t.slice(4, 6), 16)];
  }
  function pe(n) {
    let e = Math.max(n.lastIndexOf("/"), n.lastIndexOf("\\"));
    return e === -1 ? n : n.slice(e + 1);
  }
  var ie = [];
  function fe(n) {
    n.type === "drop" && (ie = n.paths);
  }
  function _e() {
    let n = N.windowLabel ?? "main";
    return {
      getCurrentWindow: () => {
        let e = D();
        return {
          label: n,
          minimize: () => e.minimize(),
          close: () => e.close(),
          toggleMaximize: () => e.toggleMaximize(),
          isMaximized: () => e.isMaximized(),
          setFullscreen: (t) => e.setFullscreen(t),
          isFullscreen: () => e.isFullscreen(),
          updateChrome: async (t) => {
            let r = t?.backgroundColor ? ge(t.backgroundColor) : null;
            r && (await e.setBackgroundColor(r));
          },
          onResized: (t) => e.onResized((r) => t(r)),
          setBadgeCount: async (t) => {
            let r = typeof t == "number" && t > 0 ? Math.floor(t) : void 0;
            await e.setBadgeCount(r);
          },
          onDragDropEvent: (t) =>
            e.onDragDropEvent((r) => {
              (fe(r.payload), t(r));
            }),
        };
      },
    };
  }
  function be() {
    return {
      ask: async (n, e) =>
        A(n, {
          title: e?.title ?? "Confirm",
          kind: e?.kind ?? "info",
          okLabel: e?.okLabel ?? "OK",
          cancelLabel: e?.cancelLabel ?? "Cancel",
        }),
      askWithCheckbox: async (n, e) => {
        let t = await A(n, {
            title: e.title ?? "Confirm",
            kind: e.kind ?? "info",
            okLabel: e.okLabel ?? "OK",
            cancelLabel: e.cancelLabel ?? "Cancel",
          }),
          r = await A(e.checkboxLabel, {
            title: e.title ?? "Confirm",
            kind: "info",
            okLabel: "Yes",
            cancelLabel: "No",
          });
        return { confirmed: t, dontAskAgain: r };
      },
      open: async (n) =>
        (await $({
          title: n?.title,
          defaultPath: n?.defaultPath,
          directory: n?.directory ?? !1,
          canCreateDirectories: n?.createDirectory ?? !1,
          multiple: n?.multiple ?? !1,
          filters: n?.filters,
        })) ?? null,
    };
  }
  function ye() {
    async function n() {
      return (await K()) ? !0 : (await Z()) === "granted";
    }
    return {
      isSupported: () => n().catch(() => !1),
      sendNotification: async (e) => {
        let t = typeof e == "string" ? { title: e } : e,
          r = t?.title?.trim();
        if (!r || !(await n())) return !1;
        let a = t.body?.trim();
        return (Q(a ? { title: r, body: a } : { title: r }), !0);
      },
    };
  }
  function me() {
    return {
      localAddresses: async () => {
        let n = await i("desktop_invoke", { command: "network_local_addresses", args: {} });
        return (Array.isArray(n) ? n : [])
          .filter((e) => typeof e?.ip == "string" && typeof e.prefixLength == "number")
          .map((e) => `${e.ip}/${e.prefixLength}`);
      },
      reverseLookup: async (n) => {
        let e = await i("desktop_invoke", { command: "network_reverse_lookup", args: { ip: n } });
        return typeof e == "string" && e.length > 0 ? e : null;
      },
      probeIdentity: async (n) => {
        let e = await i("desktop_invoke", { command: "network_probe_identity", args: { url: n } });
        if (!e || typeof e.status != "number")
          throw new Error("network_probe_identity returned no status");
        return { status: e.status, body: e.body ?? null };
      },
    };
  }
  function ve() {
    let n = we();
    return {
      platform: n,
      windowChromeMode: he(n),
      invoke: (e, t) => i("desktop_invoke", { command: e, args: t ?? {} }),
      getPendingOpenProject: () => i("get_pending_open_project"),
      agentNavigation: { ready: () => i("agent_navigation_ready") },
      events: { on: (e, t) => y(`frogg:event:${e}`, (r) => t(r.payload)) },
      window: _e(),
      dialog: be(),
      notification: ye(),
      opener: {
        openUrl: async (e) => {
          let t;
          try {
            t = new URL(e);
          } catch {
            throw new Error("Only HTTP(S) URLs can open externally.");
          }
          if (!de.has(t.protocol)) throw new Error("Only HTTP(S) URLs can open externally.");
          await X(t.href);
        },
      },
      webUtils: {
        getPathForFile: (e) => {
          let t = ie.find((r) => pe(r) === e.name);
          if (!t) throw new Error("No filesystem path is known for this file.");
          return t;
        },
      },
      network: me(),
    };
  }
  window.froggDesktop = ve();
  window.froggDesktop.windowChromeMode !== "native-mac" && te(window);
})();
