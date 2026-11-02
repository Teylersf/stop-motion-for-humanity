/* SPDX-License-Identifier: GPL-3.0-or-later */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { AnimationFrame, AssetRecord } from '../core/types';

interface Props {
  frames: AnimationFrame[]; assets: AssetRecord[]; selection: string[];
  playingFrame: string | null; onChoose: (frame: AnimationFrame, multi: boolean) => void;
  onMove: (id: string, before: string) => void; onAdd: () => void;
}

/** Keep long shoots bounded: only a viewport plus a small overscan enters the DOM. */
export default function FrameStrip({ frames, assets, selection, playingFrame, onChoose, onMove, onAdd }: Props) {
  const strip = useRef<HTMLDivElement>(null), dragged = useRef<string | null>(null);
  const [range, setRange] = useState({ start: 0, end: 80, pitch: 117 });
  const assetMap = useMemo(() => new Map(assets.map(asset => [asset.id, asset])), [assets]);
  const selected = useMemo(() => new Set(selection), [selection]);
  const updateWindow = () => {
    const element = strip.current; if (!element) return;
    const pitch = Number.parseFloat(getComputedStyle(element).getPropertyValue('--frame-pitch')) || 117;
    const start = Math.max(0, Math.floor(element.scrollLeft / pitch) - 8);
    const end = Math.min(frames.length, start + Math.ceil(element.clientWidth / pitch) + 20);
    setRange(old => old.start === start && old.end === end && old.pitch === pitch ? old : { start, end, pitch });
  };
  useEffect(() => {
    const observer = new ResizeObserver(updateWindow);
    if (strip.current) observer.observe(strip.current);
    updateWindow(); return () => observer.disconnect();
  }, [frames.length]);
  useEffect(() => {
    if (!playingFrame || !strip.current) return;
    const index = frames.findIndex(frame => frame.id === playingFrame);
    const element = strip.current, left = index * range.pitch;
    if (left < element.scrollLeft || left + range.pitch > element.scrollLeft + element.clientWidth) element.scrollTo({ left: Math.max(0, left - range.pitch * 2), behavior: 'instant' });
  }, [playingFrame, range.pitch, frames]);
  return <div className="frame-strip" ref={strip} onScroll={updateWindow}>
    {range.start > 0 && <div className="timeline-spacer" aria-hidden="true" style={{ width: range.start * range.pitch - 7 }} />}
    {frames.slice(range.start, range.end).map((frame, offset) => {
      const i = range.start + offset, asset = assetMap.get(frame.assetId);
      return <button key={frame.id} className={`frame-thumb ${selected.has(frame.id) ? 'selected' : ''} ${playingFrame === frame.id ? 'playhead' : ''}`} onClick={event => onChoose(frame, event.metaKey || event.ctrlKey || event.shiftKey)} draggable
        onDragStart={() => { dragged.current = frame.id; }} onDragEnd={() => { dragged.current = null; }} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (dragged.current) onMove(dragged.current, frame.id); dragged.current = null; }}
        aria-label={`Frame ${i + 1}, hold ${frame.hold}${frame.note ? `, ${frame.note}` : ''}`} aria-pressed={selected.has(frame.id)}>
        <span className="frame-number">{String(i + 1).padStart(3, '0')}</span>
        {asset && <img src={asset.url} alt="" loading="lazy" decoding="async" width={110} height={67} />}
        <span className="frame-bottom"><span>{frame.hold > 1 ? `×${frame.hold}` : ''}</span><span>{frame.cue ? '♪' : frame.note ? '•' : ''}</span></span>
      </button>;
    })}
    {range.end < frames.length && <div className="timeline-spacer" aria-hidden="true" style={{ width: (frames.length - range.end) * range.pitch - 7 }} />}
    <button className="add-frame-tile" onClick={onAdd}><Plus size={23} /><span>{frames.length ? 'Next little move' : 'Your first frame'}</span></button>
    {!frames.length && <div className="timeline-empty"><span className="drawn-arrow">↶</span><p>This is where your story takes shape.<br /><strong>Capture a frame or import your own images.</strong></p></div>}
  </div>;
}
