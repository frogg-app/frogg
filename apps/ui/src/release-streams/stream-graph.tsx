import { useCallback, useMemo, useRef } from "react";
import { ScrollView, View } from "react-native";
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from "react-native-svg";
import { withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import type { GraphNode, StreamGraphLayout } from "./model";

const LANE_HEIGHT = 92;
const COLUMN_WIDTH = 96;
/** Lane names sit in a fixed column beside the scrolling graph. */
const LABEL_WIDTH = 104;
const GUTTER = 8;
const TOP = 18;
const RIGHT = 140;
const NODE_RADIUS = 7;
const ROW_STYLE = { flexDirection: "row" } as const;
const FILL_STYLE = { flex: 1 } as const;

export interface StreamGraphLabels {
  channel: (channel: string) => string;
  unreleased: (count: number) => string;
  upToDate: string;
  missing: string;
  edge: (kind: string, count: number) => string;
  waiting: (count: number) => string;
}

interface GraphPalette {
  stable: string;
  beta: string;
  upstream: string;
  promote: string;
  backport: string;
  sync: string;
  pending: string;
  text: string;
  muted: string;
  surface: string;
  border: string;
}

const paletteMapping = (theme: Theme): { palette: GraphPalette } => ({
  palette: {
    stable: theme.colors.statusSuccess,
    beta: theme.colors.palette.amber[500],
    upstream: theme.colors.statusMerged,
    promote: theme.colors.statusSuccess,
    backport: theme.colors.statusWarning,
    sync: theme.colors.statusMerged,
    pending: theme.colors.foregroundMuted,
    text: theme.colors.foreground,
    muted: theme.colors.foregroundMuted,
    surface: theme.colors.surface0,
    border: theme.colors.border,
  },
});

function x(column: number): number {
  return GUTTER + column * COLUMN_WIDTH + COLUMN_WIDTH / 2;
}
function y(lane: number): number {
  return TOP + lane * LANE_HEIGHT + 20;
}

function laneColor(palette: GraphPalette, streamId: string, channel: string): string {
  if (streamId.startsWith("upstream")) return palette.upstream;
  return channel === "stable" ? palette.stable : palette.beta;
}

function curve(from: GraphNode, to: GraphNode, lift = 0): string {
  const x1 = x(from.column) + lift;
  const y1 = y(from.lane);
  const x2 = x(to.column) + lift;
  const y2 = y(to.lane);
  const mid = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
}

/**
 * A Perforce-style stream graph: one lane per stream, most stable at the top, releases as nodes
 * in time order, and connectors for what moved between streams (promotions, backports, upstream
 * syncs, contributions). Dashed connectors at the tips are changes still waiting to move.
 */
function StreamGraphSvg({
  layout,
  labels,
  palette,
}: {
  layout: StreamGraphLayout;
  labels: StreamGraphLabels;
  palette: GraphPalette;
}) {
  const width = GUTTER + layout.columns * COLUMN_WIDTH + RIGHT;
  const height = TOP + layout.lanes.length * LANE_HEIGHT + 8;
  const colorOf = useMemo(() => {
    const map = new Map(
      layout.lanes.map((lane) => [
        lane.stream.id,
        laneColor(palette, lane.stream.id, lane.stream.channel),
      ]),
    );
    return (streamId: string) => map.get(streamId) ?? palette.muted;
  }, [layout.lanes, palette]);
  // Open on the newest end: the tips and what is waiting matter more than old releases.
  const scrollRef = useRef<ScrollView>(null);
  const scrollToNewest = useCallback(() => scrollRef.current?.scrollToEnd({ animated: false }), []);
  const edgeColor = (kind: string) => {
    if (kind === "promote") return palette.promote;
    if (kind === "backport" || kind === "forward-port") return palette.backport;
    return palette.sync;
  };
  const contentStyle = useMemo(() => ({ minWidth: width }), [width]);

  return (
    <View style={ROW_STYLE}>
      <Svg width={LABEL_WIDTH} height={height}>
        {layout.lanes.map((lane) => {
          const laneY = y(lane.index);
          return (
            <G key={lane.stream.id}>
              <SvgText x={12} y={laneY - 2} fontSize={12} fontWeight="600" fill={palette.text}>
                {lane.stream.label}
              </SvgText>
              <SvgText x={12} y={laneY + 13} fontSize={10} fill={colorOf(lane.stream.id)}>
                {labels.channel(lane.stream.channel)}
                {lane.stream.exists ? "" : ` · ${labels.missing}`}
              </SvgText>
            </G>
          );
        })}
      </Svg>
      <ScrollView
        style={FILL_STYLE}
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator
        onContentSizeChange={scrollToNewest}
        contentContainerStyle={contentStyle}
      >
        <Svg width={width} height={height} accessibilityRole="image" testID="release-streams-graph">
          {layout.lanes.map((lane) => {
            const color = colorOf(lane.stream.id);
            const laneY = y(lane.index);
            return (
              <Line
                key={lane.stream.id}
                x1={x(lane.firstColumn)}
                y1={laneY}
                x2={x(lane.lastColumn)}
                y2={laneY}
                stroke={color}
                strokeWidth={3}
                strokeOpacity={0.55}
                strokeDasharray={lane.stream.exists ? undefined : "4 4"}
              />
            );
          })}

          {layout.edges.map((edge) => {
            const color = edgeColor(edge.kind);
            const label = labels.edge(edge.kind, edge.count);
            const midX = (x(edge.from.column) + x(edge.to.column)) / 2;
            // Version labels sit just under each lane; keep connector labels in the gap between.
            const midY = (y(edge.from.lane) + y(edge.to.lane)) / 2 + 12;
            return (
              <G key={edge.key}>
                <Path
                  d={curve(edge.from, edge.to)}
                  stroke={color}
                  strokeWidth={2}
                  fill="none"
                  strokeDasharray={
                    edge.kind === "backport" || edge.kind === "contribute" ? "5 3" : undefined
                  }
                />
                {edge.from.version === null ? (
                  <Circle cx={x(edge.from.column)} cy={y(edge.from.lane)} r={3} fill={color} />
                ) : null}
                <SvgText x={midX + 6} y={midY + 3} fontSize={9} fill={color}>
                  {label}
                </SvgText>
              </G>
            );
          })}

          {layout.pending.map((arrow) => {
            const lift = 48;
            const midY = (y(arrow.from.lane) + y(arrow.to.lane)) / 2;
            const text = labels.waiting(arrow.flow.pending);
            return (
              <G key={`${arrow.flow.kind}:${arrow.flow.from}:${arrow.flow.to}`}>
                <Path
                  d={curve(arrow.from, arrow.to, lift)}
                  stroke={palette.pending}
                  strokeWidth={1.5}
                  fill="none"
                  strokeDasharray="3 3"
                />
                <Circle
                  cx={x(arrow.to.column) + lift}
                  cy={y(arrow.to.lane)}
                  r={3}
                  fill={palette.pending}
                />
                <Rect
                  x={x(arrow.from.column) + lift + 4}
                  y={midY - 8}
                  width={text.length * 5.6 + 10}
                  height={16}
                  rx={8}
                  fill={palette.surface}
                  stroke={palette.border}
                />
                <SvgText
                  x={x(arrow.from.column) + lift + 9}
                  y={midY + 3}
                  fontSize={9}
                  fill={palette.muted}
                >
                  {text}
                </SvgText>
              </G>
            );
          })}

          {layout.nodes.map((node) => {
            const color = colorOf(node.stream);
            const cx = x(node.column);
            const cy = y(node.lane);
            if (node.head) {
              return (
                <G key={node.key}>
                  <Circle
                    cx={cx}
                    cy={cy}
                    r={NODE_RADIUS}
                    fill={palette.surface}
                    stroke={color}
                    strokeWidth={2}
                    strokeDasharray={node.unreleased > 0 ? "3 2" : undefined}
                  />
                  <SvgText
                    x={cx}
                    y={cy + 22}
                    fontSize={10}
                    textAnchor="middle"
                    fill={palette.muted}
                  >
                    {node.unreleased > 0 ? labels.unreleased(node.unreleased) : labels.upToDate}
                  </SvgText>
                </G>
              );
            }
            return (
              <G key={node.key}>
                <Circle cx={cx} cy={cy} r={NODE_RADIUS} fill={color} />
                <SvgText x={cx} y={cy + 22} fontSize={10} textAnchor="middle" fill={palette.text}>
                  {node.version}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      </ScrollView>
    </View>
  );
}

export const StreamGraph = withUnistyles(StreamGraphSvg, paletteMapping);
