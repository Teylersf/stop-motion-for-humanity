/** GPL-3.0-or-later. Original code-drawn paper-cut animation, no stock artwork. */
import type { CaptureSource } from './types.ts';
import { canvasPNG } from './camera.ts';
export interface DemoFrame { png: Uint8Array; name: string; source: CaptureSource }
function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number, fill: string): void { ctx.fillStyle = fill; ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fill(); }
function circle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, fill: string): void { ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); }
export function drawDemoFrame(ctx: CanvasRenderingContext2D, index: number, count = 24): void {
  const width = ctx.canvas.width, height = ctx.canvas.height; ctx.save(); ctx.scale(width / 1280, height / 720);
  const phase = index / count * Math.PI * 2, jitter = Math.sin(index * 12.9898) * 1.1;
  ctx.fillStyle = '#ede8db'; ctx.fillRect(0, 0, 1280, 720);
  // Deterministic cardstock grain and soft, layered shapes remain identical on repeat render.
  ctx.fillStyle = 'rgba(47,60,58,.035)'; for (let i = 0; i < 900; i++) { const x = (i * 137.508) % 1280, y = (i * i * 0.7723) % 720; ctx.fillRect(x, y, 1.5, 1.5); }
  circle(ctx, 1070, 155, 78, '#e6b966'); circle(ctx, 1047, 137, 78, '#ede8db');
  ctx.fillStyle = '#cfdbcc'; ctx.beginPath(); ctx.moveTo(0, 495); ctx.bezierCurveTo(270, 350, 380, 590, 700, 450); ctx.bezierCurveTo(940, 300, 1130, 385, 1280, 410); ctx.lineTo(1280, 720); ctx.lineTo(0, 720); ctx.fill();
  ctx.fillStyle = '#98b6a8'; ctx.beginPath(); ctx.moveTo(0, 575); ctx.bezierCurveTo(270, 475, 430, 600, 780, 535); ctx.bezierCurveTo(1000, 450, 1150, 490, 1280, 520); ctx.lineTo(1280, 720); ctx.lineTo(0, 720); ctx.fill();
  ctx.fillStyle = '#668c80'; ctx.fillRect(0, 621, 1280, 99);
  // Paper fern.
  ctx.strokeStyle = '#3c625a'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(114, 645); ctx.lineTo(147, 430); ctx.stroke();
  for (let i = 0; i < 5; i++) { const y = 590 - i * 35; ctx.fillStyle = i % 2 ? '#487768' : '#527f70'; ctx.beginPath(); ctx.ellipse(114 + i * 4, y, 34, 11, -0.5, 0, Math.PI * 2); ctx.ellipse(161 + i * 3, y - 12, 34, 11, 0.5, 0, Math.PI * 2); ctx.fill(); }
  const x = 640 + Math.sin(phase) * 70, y = 455 - Math.abs(Math.sin(phase * 2)) * 18;
  ctx.fillStyle = 'rgba(27,51,45,.2)'; ctx.beginPath(); ctx.ellipse(x + 4, 631, 115 - Math.abs(Math.sin(phase * 2)) * 12, 14, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save(); ctx.translate(x + jitter, y); ctx.rotate(Math.sin(phase) * 0.035);
  // Moving feet, a jointed waving arm and a curious antenna.
  rounded(ctx, -64 + Math.sin(phase * 2) * 13, 122, 44, 50, 8, '#304b52'); rounded(ctx, 20 - Math.sin(phase * 2) * 13, 122, 44, 50, 8, '#304b52');
  ctx.strokeStyle = '#b46f57'; ctx.lineWidth = 28; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-78, 17); ctx.lineTo(-111, 75); ctx.stroke();
  ctx.save(); ctx.translate(79, 10); ctx.rotate(-1.1 + Math.sin(phase * 2) * 0.32); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(9, 83); ctx.stroke(); circle(ctx, 9, 88, 19, '#d9a38a'); ctx.restore();
  rounded(ctx, -81, -12, 162, 145, 22, '#cb896c'); rounded(ctx, -69, -5, 138, 125, 16, '#d69b7f');
  rounded(ctx, -44, 34, 88, 55, 9, '#f1ddba'); circle(ctx, -18, 61, 7, '#537a70'); circle(ctx, 7, 61, 7, '#d4a052');
  ctx.strokeStyle = '#304b52'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(0, -116); ctx.lineTo(10 + Math.sin(phase) * 8, -153); ctx.stroke(); circle(ctx, 10 + Math.sin(phase) * 8, -160, 12, '#d4a052');
  rounded(ctx, -100, -124, 200, 116, 25, '#304b52'); rounded(ctx, -87, -112, 174, 90, 17, '#3e5d61');
  const blink = index % count === Math.floor(count * 0.55);
  if (blink) { rounded(ctx, -55, -75, 29, 5, 2, '#f2d8a0'); rounded(ctx, 26, -75, 29, 5, 2, '#f2d8a0'); }
  else { circle(ctx, -40, -73, 13, '#f2d8a0'); circle(ctx, 40, -73, 13, '#f2d8a0'); circle(ctx, -36, -77, 4, '#fff7df'); circle(ctx, 44, -77, 4, '#fff7df'); }
  ctx.strokeStyle = '#f2d8a0'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, -57, 15, 0.15, Math.PI - 0.15); ctx.stroke(); ctx.restore();
  ctx.fillStyle = '#324f4b'; ctx.font = '600 20px system-ui, sans-serif'; ctx.letterSpacing = '5px'; ctx.fillText('A LITTLE ROOM TO MOVE', 80, 92); ctx.letterSpacing = '0px';
  ctx.font = '16px system-ui, sans-serif'; ctx.fillStyle = '#59736a'; ctx.fillText('Original procedural demo · drawn one frame at a time', 80, 122);
  ctx.restore();
}
export async function createDemoFrame(index: number, width = 1280, height = 720, count = 24): Promise<Uint8Array> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 16_777_216) throw new Error('Demo generation supports output up to 16 megapixels.');
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('The demo image renderer could not start.');
  drawDemoFrame(ctx, index, count); try { return await canvasPNG(canvas); } finally { canvas.width = 1; canvas.height = 1; }
}
export async function generateDemoFrames(count = 24, width = 1280, height = 720, onProgress?: (done: number, total: number) => void): Promise<DemoFrame[]> {
  if (!Number.isInteger(count) || count < 1 || count > 240) throw new Error('Choose between 1 and 240 demo frames.');
  const result: DemoFrame[] = [];
  for (let index = 0; index < count; index++) {
    result.push({ png: await createDemoFrame(index, width, height, count), name: `Paper robot ${String(index + 1).padStart(4, '0')}.png`, source: { type: 'demo', deviceLabel: 'Original procedural paper-cut demo', width, height } });
    onProgress?.(index + 1, count); await new Promise<void>(resolve => setTimeout(resolve, 0));
  } return result;
}
