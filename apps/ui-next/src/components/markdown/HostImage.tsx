import { Buffer } from "buffer";
import { ImageOff } from "lucide-react-native";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Image, StyleSheet, View } from "react-native";
import { getClient, onHostSwitch } from "../../daemon/store";
import { anim, color, frames, glide, web } from "../../theme/tokens";
import { useReducedMotion } from "../Meter";
import { T } from "../Text";
import { resolveImage, type ImageSource } from "./syntax";

/** Directory relative image paths resolve from: the session's working directory. */
export const ImageRoot = createContext<string | undefined>(undefined);

const MAX_BYTES = 12 * 1024 * 1024;
const MAX_H = 420;
const curve = Easing.bezier(...glide.curve);

interface Loaded {
  uri: string;
  w: number;
  h: number;
}

/** Host reads are cached per path for the connection: a reply re-renders on every chunk. */
const cache = new Map<string, Promise<string>>();
onHostSwitch(() => cache.clear());

async function readHostImage(cwd: string, path: string): Promise<string> {
  const client = getClient();
  if (!client) throw new Error("Not connected");
  const res = await client.readFile(cwd, path, undefined, MAX_BYTES);
  if (res.kind !== "image" && !res.mime.startsWith("image/")) throw new Error("Not an image");
  if (res.size > MAX_BYTES) throw new Error("Image too large to preview");
  return `data:${res.mime};base64,${Buffer.from(res.bytes).toString("base64")}`;
}

function uriFor(src: ImageSource): Promise<string> {
  if (src.kind === "uri") return Promise.resolve(src.uri);
  const key = `${src.cwd}\n${src.path}`;
  let p = cache.get(key);
  if (!p) {
    p = readHostImage(src.cwd, src.path);
    cache.set(key, p);
    // A failed read (offline, not yet written) retries on the next mount.
    p.catch(() => cache.delete(key));
  }
  return p;
}

function sizeOf(uri: string): Promise<{ w: number; h: number }> {
  return new Promise((ok, fail) => Image.getSize(uri, (w, h) => ok({ w, h }), fail));
}

function useImage(src: string) {
  const cwd = useContext(ImageRoot);
  const target = useMemo(() => resolveImage(src, cwd), [src, cwd]);
  const [state, setState] = useState<Loaded | { error: string } | null>(null);
  useEffect(() => {
    if (!target) {
      setState({ error: "Unsupported image location" });
      return undefined;
    }
    let live = true;
    setState(null);
    uriFor(target)
      .then(async (uri) => {
        const { w, h } = await sizeOf(uri);
        if (live) setState({ uri, w, h });
        return uri;
      })
      .catch((e: unknown) => {
        if (live) setState({ error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      live = false;
    };
  }, [target]);
  return state;
}

/**
 * A markdown image. URLs load directly; host files (`file://`, absolute or session-relative
 * paths) are read through the daemon, so a remote host's screenshots render on any client.
 * Holds a shimmer slot while loading, fades the picture in, and names the file if it fails.
 */
export function HostImage({ src, alt }: { src: string; alt: string }) {
  const state = useImage(src);
  if (!state) return <View style={s.slot} accessibilityLabel="Loading image" />;
  if ("error" in state)
    return (
      <View style={s.failed} accessibilityRole="image" accessibilityLabel={alt || "Image"}>
        <ImageOff size={14} color={color.faint} />
        <View style={s.failedText}>
          <T style={s.failedTitle} numberOfLines={1}>
            {alt && alt !== "Image" ? alt : "Image could not be shown"}
            <T style={s.failedWhy}>{` · ${state.error}`}</T>
          </T>
          <T v="mono" numberOfLines={1} ellipsizeMode="middle" style={s.failedPath}>
            {src}
          </T>
        </View>
      </View>
    );
  return <Picture {...state} alt={alt} />;
}

function Picture({ uri, w, h, alt }: Loaded & { alt: string }) {
  const reduced = useReducedMotion();
  const fade = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) return undefined;
    const a = Animated.timing(fade, {
      toValue: 1,
      duration: glide.ms,
      easing: curve,
      useNativeDriver: true,
    });
    a.start();
    return () => a.stop();
  }, [fade, reduced]);
  const source = useMemo(() => ({ uri }), [uri]);
  const box = useMemo(
    () => [
      s.pic,
      { aspectRatio: w / Math.max(1, h), maxWidth: Math.min(w, (MAX_H * w) / Math.max(1, h)) },
      { opacity: fade },
    ],
    [w, h, fade],
  );
  return (
    <Animated.View style={box} accessibilityRole="image" accessibilityLabel={alt || "Image"}>
      <Image source={source} style={s.fill} resizeMode="contain" />
    </Animated.View>
  );
}

const s = StyleSheet.create({
  slot: {
    height: 140,
    maxWidth: 360,
    backgroundColor: color.wash2,
    ...web({
      backgroundImage: `linear-gradient(90deg, ${color.wash2} 0%, ${color.wash2} 35%, ${color.wash3} 50%, ${color.wash2} 65%, ${color.wash2} 100%)`,
      backgroundSize: "200% 100%",
    }),
    ...anim(frames.shimmer, "1.6s", "linear", "infinite", "none"),
  },
  pic: {
    width: "100%",
    backgroundColor: color.bg,
    borderWidth: 1,
    borderColor: color.line,
  },
  fill: { width: "100%", height: "100%" },
  failed: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    alignSelf: "flex-start",
    maxWidth: "100%",
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: color.panel,
    borderWidth: 1,
    borderColor: color.line,
  },
  failedText: { flexShrink: 1, gap: 2 },
  failedTitle: { fontSize: 12.5, color: color.muted },
  failedWhy: { color: color.faint },
  failedPath: { fontSize: 10.5, color: color.faint },
});
