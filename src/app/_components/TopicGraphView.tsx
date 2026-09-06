'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { TopicGraph, TopicNode } from '@/lib/types';

/**
 * Interactive topic mind map (TAV-66, option I).
 *
 * A dependency-free force-directed layout: nodes repel, edges (topic
 * co-occurrence) act as springs, and a weak gravity keeps the graph centered.
 * The simulation settles over a few hundred ticks in a rAF loop; after it
 * settles the user can drag nodes to rearrange. Click a node to open a detail
 * panel listing the videos behind it.
 */

const WIDTH = 960;
const HEIGHT = 560;
const TICKS = 300;

interface PositionedNode extends TopicNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hue: number;
}

export function TopicGraphView({ graph }: { graph: TopicGraph }) {
  const [nodes, setNodes] = useState<PositionedNode[]>([]);
  const [selected, setSelected] = useState<TopicNode | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [settled, setSettled] = useState(false);

  const edges = useMemo(
    () => graph.edges
      .map(e => ({
        a: e.a,
        b: e.b,
        weight: e.weight,
        ai: graph.nodes.findIndex(n => n.topic === e.a),
        bi: graph.nodes.findIndex(n => n.topic === e.b),
      }))
      .filter(e => e.ai >= 0 && e.bi >= 0),
    [graph],
  );

  // Initialize + run the layout simulation.
  useEffect(() => {
    const maxCount = Math.max(1, ...graph.nodes.map(n => n.videoCount));
    const initial: PositionedNode[] = graph.nodes.map((n, i) => {
      // Deterministic ring seed — keeps layouts stable across reloads.
      const angle = (i / Math.max(1, graph.nodes.length)) * Math.PI * 2;
      const r = Math.min(WIDTH, HEIGHT) * 0.35;
      return {
        ...n,
        x: WIDTH / 2 + Math.cos(angle) * r,
        y: HEIGHT / 2 + Math.sin(angle) * r,
        vx: 0,
        vy: 0,
        radius: 8 + 22 * Math.sqrt(n.videoCount / maxCount),
        hue: hashHue(n.topic),
      };
    });

    let tick = 0;
    let raf = 0;

    if (initial.length === 0) {
      raf = requestAnimationFrame(() => {
        setNodes([]);
        setSettled(true);
      });
      return () => cancelAnimationFrame(raf);
    }

    const index = new Map(initial.map((n, i) => [n.topic, i]));
    const simEdges = edges
      .map(e => ({ i: index.get(e.a) ?? -1, j: index.get(e.b) ?? -1, w: e.weight }))
      .filter(e => e.i >= 0 && e.j >= 0);

    const step = () => {
      // Repulsion (Coulomb-like), softened.
      for (let i = 0; i < initial.length; i++) {
        for (let j = i + 1; j < initial.length; j++) {
          const a = initial[i];
          const b = initial[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let dist2 = dx * dx + dy * dy;
          if (dist2 < 1) { dx = (Math.random() - 0.5); dy = (Math.random() - 0.5); dist2 = 1; }
          const dist = Math.sqrt(dist2);
          const minDist = a.radius + b.radius + 12;
          const force = 6000 / dist2 + (dist < minDist ? (minDist - dist) * 0.5 : 0);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.vx -= fx; a.vy -= fy;
          b.vx += fx; b.vy += fy;
        }
      }
      // Spring attraction along edges.
      for (const e of simEdges) {
        const a = initial[e.i];
        const b = initial[e.j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const rest = 120 + 30 * (a.radius + b.radius) / 30;
        const force = (dist - rest) * 0.01 * Math.min(3, Math.sqrt(e.w));
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }
      // Integrate with gravity + damping; clamp to bounds.
      for (const n of initial) {
        n.vx += (WIDTH / 2 - n.x) * 0.002;
        n.vy += (HEIGHT / 2 - n.y) * 0.002;
        n.vx *= 0.85; n.vy *= 0.85;
        n.x += Math.max(-20, Math.min(20, n.vx));
        n.y += Math.max(-20, Math.min(20, n.vy));
        n.x = Math.max(n.radius + 4, Math.min(WIDTH - n.radius - 4, n.x));
        n.y = Math.max(n.radius + 4, Math.min(HEIGHT - n.radius - 4, n.y));
      }
      tick += 1;
      setNodes(initial.map(n => ({ ...n })));
      if (tick < TICKS) {
        raf = requestAnimationFrame(step);
      } else {
        setSettled(true);
      }
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  // Pointer drag (mouse or touch) on the SVG.
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging || !settled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * WIDTH;
    const y = ((e.clientY - rect.top) / rect.height) * HEIGHT;
    setNodes(prev => prev.map(n => (n.topic === dragging ? { ...n, x, y } : n)));
  };

  if (graph.nodes.length === 0) {
    return (
      <div style={{
        background: '#111116', borderRadius: 10, border: '1px solid #2a2a33',
        padding: '48px 24px', textAlign: 'center', color: '#8b8b94', fontSize: 13,
      }}>
        No topics yet. Summarize some videos first — each summary contributes its topic tags to this map.
      </div>
    );
  }

  const maxWeight = Math.max(1, ...edges.map(e => e.weight));

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{
        flex: '1 1 640px', minWidth: 320, background: '#111116', borderRadius: 10,
        border: '1px solid #2a2a33', overflow: 'hidden',
      }}>
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          style={{ width: '100%', height: 'auto', display: 'block', touchAction: 'none' }}
          onPointerMove={onPointerMove}
          onPointerUp={() => setDragging(null)}
          onPointerLeave={() => setDragging(null)}
          role="img"
          aria-label={`Topic graph with ${nodes.length} topics and ${edges.length} connections`}
        >
          {/* Edges */}
          {edges.map(e => {
            const a = nodes[e.ai];
            const b = nodes[e.bi];
            if (!a || !b) return null;
            return (
              <line
                key={`${e.a}-${e.b}`}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke="#2f2f3a"
                strokeWidth={0.5 + 2.5 * (e.weight / maxWeight)}
                strokeOpacity={selected && (selected.topic === e.a || selected.topic === e.b) ? 0.9 : 0.5}
              />
            );
          })}
          {/* Nodes */}
          {nodes.map(n => {
            const isSel = selected?.topic === n.topic;
            return (
              <g
                key={n.topic}
                transform={`translate(${n.x},${n.y})`}
                style={{ cursor: dragging === n.topic ? 'grabbing' : 'pointer' }}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                  setDragging(n.topic);
                  setSelected(selected?.topic === n.topic ? null : n);
                }}
              >
                <circle
                  r={n.radius}
                  fill={`hsl(${n.hue} 45% ${isSel ? 55 : 42}%)`}
                  stroke={isSel ? '#fff' : '#0e0e12'}
                  strokeWidth={isSel ? 2 : 1}
                />
                <text
                  y={n.radius + 12}
                  textAnchor="middle"
                  fontSize={11}
                  fill="#c2c2cb"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {n.topic.length > 18 ? n.topic.slice(0, 17) + '…' : n.topic}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Detail panel */}
      <div style={{ flex: '1 1 260px', minWidth: 260, background: '#111116', borderRadius: 10, border: '1px solid #2a2a33', padding: 16 }}>
        {!selected && (
          <div style={{ color: '#8b8b94', fontSize: 13 }}>
            <p style={{ marginTop: 0 }}>Click a topic to inspect it.</p>
            <p>Built from {graph.summarizedVideos} summarized videos · {nodes.length} topics · {edges.length} connections.</p>
            <p style={{ marginBottom: 0 }}>Drag nodes to rearrange the map once the layout settles.</p>
          </div>
        )}
        {selected && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ width: 12, height: 12, borderRadius: 6, background: `hsl(${hashHue(selected.topic)} 45% 45%)`, display: 'inline-block' }} />
              <h3 style={{ margin: 0, fontSize: 16, color: '#e7e7ea' }}>{selected.topic}</h3>
            </div>
            <p style={{ color: '#8b8b94', fontSize: 12, margin: '4px 0 12px' }}>
              {selected.videoCount} videos across {selected.channelCount} channels
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {selected.videos.map(v => (
                <Link
                  key={v.videoId}
                  href={`https://www.youtube.com/watch?v=${v.videoId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#7db5ff', fontSize: 13, textDecoration: 'none', lineHeight: 1.4 }}
                >
                  ▶ {v.title}
                  <span style={{ color: '#8b8b94', fontSize: 11 }}> — {v.channelTitle}</span>
                </Link>
              ))}
            </div>
            <Link
              href={`/search?q=${encodeURIComponent(selected.topic)}`}
              style={{ display: 'inline-block', marginTop: 12, fontSize: 12, color: '#5cd9a3' }}
            >
              Search transcripts for “{selected.topic}” →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

/** Stable pseudo-random hue from the topic label. */
function hashHue(topic: string): number {
  let h = 0;
  for (let i = 0; i < topic.length; i++) {
    h = (h * 31 + topic.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}
