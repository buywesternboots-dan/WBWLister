'use client';
import { useEffect, useRef, useState } from 'react';
import { captureViewport, compressCanvas } from './capture';
import { BUTTON, clampPosition, movedPastThreshold, parseStoredPosition, placePosition, snapPosition } from './position';
import { redactPageUrl } from '../../lib/report-url';

const ENDPOINT = '/api/bug-reports';
const STORAGE_KEY = 'bug-reporter-position';
const INK = '#FF0000';
const PRIORITIES = [
  ['High', '#dc2626'],
  ['Medium', '#f97316'],
  ['Low', '#16a34a'],
  ['Question', '#2563eb'],
];

function readInsets() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.appendChild(probe);
  const s = getComputedStyle(probe);
  const n = k => parseFloat(s[k]) || 0;
  const inset = { top: n('paddingTop'), right: n('paddingRight'), bottom: n('paddingBottom'), left: n('paddingLeft') };
  probe.remove();
  return inset;
}

function metrics() {
  const vv = window.visualViewport;
  return { vw: vv?.width || window.innerWidth, vh: vv?.height || window.innerHeight, size: BUTTON, inset: readInsets() };
}

function speechApi() {
  return typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
}

export default function BugReporter({ endpoint = ENDPOINT, storageKey = STORAGE_KEY }) {
  const [pos, setPos] = useState(null);
  const [phase, setPhase] = useState('idle');
  const [shot, setShot] = useState('');
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim] = useState('');
  const [listening, setListening] = useState(false);
  const [speechNote, setSpeechNote] = useState('');
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [ready, setReady] = useState(false);
  const [frame, setFrame] = useState(null);
  const phaseRef = useRef('idle');
  const posRef = useRef(null);
  const drag = useRef(null);
  const skipClick = useRef(false);
  const canvasRef = useRef(null);
  const imageRef = useRef(null);
  const strokes = useRef([]);
  const drawing = useRef(null);
  const recRef = useRef(null);
  const wantMic = useRef(false);
  const loadedShot = useRef('');
  const rootRef = useRef(null);
  const [ink, setInk] = useState(0);
  const attempt = useRef(0);

  const setPhaseBoth = next => { phaseRef.current = next; setPhase(next); };

  useEffect(() => {
    const apply = () => {
      const m = metrics();
      setPos(prev => {
        let raw = null;
        if (!prev) { try { raw = localStorage.getItem(storageKey); } catch { /* private mode */ } }
        const next = prev?.side
          ? placePosition({ side: prev.side, y: prev.y }, m)
          : prev
            ? { ...clampPosition(prev.x, prev.y, m), side: prev.side }
            : parseStoredPosition(raw, m);
        posRef.current = next;
        return next;
      });
    };
    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    window.visualViewport?.addEventListener('resize', apply);
    return () => {
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
      window.visualViewport?.removeEventListener('resize', apply);
    };
  }, [storageKey]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (phase === 'idle' || phase === 'capturing') { setFrame(null); return; }
    const read = () => {
      const vv = window.visualViewport;
      setFrame(vv
        ? { top: vv.offsetTop, left: vv.offsetLeft, width: vv.width, height: vv.height }
        : { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight });
    };
    read();
    window.visualViewport?.addEventListener('resize', read);
    window.visualViewport?.addEventListener('scroll', read);
    return () => {
      window.visualViewport?.removeEventListener('resize', read);
      window.visualViewport?.removeEventListener('scroll', read);
    };
  }, [phase]);

  function paint() {
    const canvas = canvasRef.current, image = imageRef.current;
    if (!canvas || !image) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const width = 5 * (rect.width ? canvas.width / rect.width : 1);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineWidth = width;
    const all = drawing.current ? [...strokes.current, drawing.current] : strokes.current;
    for (const stroke of all) {
      if (!stroke.length) continue;
      if (stroke.length === 1) {
        ctx.beginPath();
        ctx.arc(stroke[0].x, stroke[0].y, width / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i].x, stroke[i].y);
      ctx.stroke();
    }
  }

  useEffect(() => {
    if (phase !== 'draw' || !shot || !frame || !canvasRef.current) return;
    if (loadedShot.current === shot && imageRef.current) { paint(); return; }
    const image = new Image();
    image.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      loadedShot.current = shot;
      imageRef.current = image;
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      paint();
      setReady(true);
    };
    image.onerror = () => setSpeechNote('Could not open the snapshot. Cancel and try again.');
    image.src = shot;
  }, [phase, shot, frame]);

  function stopSpeech() {
    wantMic.current = false;
    const rec = recRef.current;
    recRef.current = null;
    if (rec) { try { rec.onend = null; rec.abort(); } catch { /* already stopped */ } }
    setListening(false);
  }

  function reset() {
    attempt.current += 1;
    stopSpeech();
    strokes.current = [];
    drawing.current = null;
    imageRef.current = null;
    loadedShot.current = '';
    setShot('');
    setTranscript('');
    setInterim('');
    setSpeechNote('');
    setError('');
    setSending(false);
    setReady(false);
    setInk(0);
    setPhaseBoth('idle');
  }

  async function open() {
    if (phaseRef.current !== 'idle') return;
    setPhaseBoth('capturing');
    setToast('');
    setError('');
    try {
      const url = await captureViewport();
      setShot(url);
      setSpeechNote(speechApi() ? '' : "Voice input isn't available in this browser. Type the note below.");
      setPhaseBoth('draw');
    } catch {
      setPhaseBoth('idle');
      setToast('Could not capture this page. Try again.');
    }
  }

  function onPointerDown(e) {
    if (e.button != null && e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, ox: posRef.current.x, oy: posRef.current.y, moved: false, last: posRef.current };
  }
  function onPointerMove(e) {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && !movedPastThreshold(dx, dy)) return;
    d.moved = true;
    const next = clampPosition(d.ox + dx, d.oy + dy, metrics());
    d.last = next;
    posRef.current = next;
    setPos(next);
  }
  function onPointerUp(e) {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    skipClick.current = true;
    if (!d.moved) { open(); return; }
    const snapped = snapPosition(d.last.x, d.last.y, metrics());
    posRef.current = snapped;
    setPos(snapped);
    try { localStorage.setItem(storageKey, JSON.stringify({ side: snapped.side, y: snapped.y })); } catch { /* private mode */ }
  }

  function point(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }
  function drawDown(e) {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    canvasRef.current.setPointerCapture?.(e.pointerId);
    drawing.current = [point(e)];
    paint();
  }
  function drawMove(e) {
    if (!drawing.current) return;
    e.preventDefault();
    drawing.current.push(point(e));
    paint();
  }
  function drawUp() {
    if (!drawing.current) return;
    strokes.current = [...strokes.current, drawing.current];
    drawing.current = null;
    setInk(strokes.current.length);
    paint();
  }

  function undo() {
    strokes.current = strokes.current.slice(0, -1);
    setInk(strokes.current.length);
    paint();
  }
  function clearInk() {
    strokes.current = [];
    drawing.current = null;
    setInk(0);
    paint();
  }

  function toggleMic() {
    const Ctor = speechApi();
    if (!Ctor) { setSpeechNote("Voice input isn't available in this browser. Type the note below."); return; }
    if (wantMic.current) { stopSpeech(); return; }
    wantMic.current = true;
    setSpeechNote('');
    const start = () => {
      if (!wantMic.current) return;
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = ev => {
        let finalText = '', live = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const bit = ev.results[i][0]?.transcript || '';
          if (ev.results[i].isFinal) finalText += bit;
          else live += bit;
        }
        if (finalText) setTranscript(t => (t + finalText).slice(0, 8000));
        setInterim(live);
      };
      rec.onerror = () => { setSpeechNote("Microphone isn't available. Type the note below."); stopSpeech(); };
      rec.onend = () => { if (wantMic.current) setTimeout(start, 250); else setListening(false); };
      recRef.current = rec;
      try { rec.start(); setListening(true); }
      catch { setSpeechNote("Microphone isn't available. Type the note below."); stopSpeech(); }
    };
    start();
  }

  function finishNote() {
    try { if (canvasRef.current) setShot(compressCanvas(canvasRef.current)); } catch { /* keep the plain snapshot */ }
    setTranscript(t => (t + interim).trim().slice(0, 8000));
    setInterim('');
    stopSpeech();
    setError('');
    setPhaseBoth('priority');
  }

  function backToNote() {
    setError('');
    setSending(false);
    setReady(false);
    loadedShot.current = '';
    setPhaseBoth('draw');
  }

  async function send(priority) {
    if (sending) return;
    const ticket = attempt.current;
    setSending(true);
    setError('');
    try {
      const image = shot;
      const note = (transcript + interim).trim().slice(0, 8000);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image, transcript: note, priority,
          page_url: redactPageUrl(location.href, location.origin),
          user_agent: navigator.userAgent,
          viewport: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio || 1}`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (ticket !== attempt.current) return;
      if (!res.ok) throw new Error(data.error || 'Could not send the report.');
      reset();
      setToast('Bug report sent.');
    } catch (e) {
      if (ticket !== attempt.current) return;
      setError(e.message);
      setSending(false);
    }
  }

  useEffect(() => {
    const root = rootRef.current;
    if (!root || phase === 'idle' || phase === 'capturing') return;
    const changed = [];
    for (const el of document.body.children) {
      if (el === root || el.hasAttribute('inert')) continue;
      el.setAttribute('inert', '');
      changed.push(el);
    }
    return () => { for (const el of changed) el.removeAttribute('inert'); };
  }, [phase]);

  useEffect(() => () => { wantMic.current = false; try { recRef.current?.abort(); } catch { /* ignore */ } }, []);

  const btn = {
    width: BUTTON, height: BUTTON, minWidth: BUTTON, minHeight: BUTTON, padding: 0, border: 0, borderRadius: 999,
    background: '#a3261b', color: '#fff', font: '700 13px system-ui, sans-serif', boxShadow: '0 2px 10px #0006',
    touchAction: 'none', cursor: 'grab', position: 'fixed', zIndex: 2147483000, userSelect: 'none',
  };
  const openUi = phase === 'draw' || phase === 'priority';

  return <div ref={rootRef} data-bug-reporter="" data-html2canvas-ignore="true" style={{ position: 'fixed', width: 0, height: 0, overflow: 'visible', zIndex: 2147483000, pointerEvents: 'none' }}>
    {pos && phase !== 'draw' && phase !== 'priority' && <button
      type="button" aria-label="Report a bug" disabled={phase === 'capturing'}
      style={{ ...btn, left: pos.x, top: pos.y, pointerEvents: 'auto' }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onClick={e => { if (skipClick.current) { skipClick.current = false; e.preventDefault(); return; } open(); }}
    >{phase === 'capturing' ? '…' : 'Bug'}</button>}
    {openUi && frame && <div role="dialog" aria-modal="true" aria-label="Report a bug" style={{
      position: 'fixed', top: frame.top, left: frame.left, width: frame.width, height: frame.height, pointerEvents: 'auto',
      background: '#0b1220', color: '#e5e7eb', display: 'flex', flexDirection: 'column', zIndex: 2147483001,
      padding: 'max(8px, env(safe-area-inset-top)) 10px max(8px, env(safe-area-inset-bottom))', boxSizing: 'border-box',
      font: '16px system-ui, sans-serif',
    }}>
      {phase === 'draw' && <>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          <Tool onClick={reset} bg="#dc2626">Cancel</Tool>
          <Tool onClick={undo} disabled={!ink}>Undo</Tool>
          <Tool onClick={clearInk} disabled={!ink}>Clear</Tool>
          <Tool onClick={toggleMic} bg={listening ? '#dc2626' : '#374151'}>{listening ? 'Stop mic' : 'Start mic'}</Tool>
          <Tool onClick={finishNote} bg="#16a34a" disabled={!ready}>Submit</Tool>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'none' }}>
          <canvas ref={canvasRef} aria-label="Mark the bug in red"
            style={{ maxWidth: '100%', maxHeight: '100%', touchAction: 'none', background: '#000' }}
            onPointerDown={drawDown} onPointerMove={drawMove} onPointerUp={drawUp} onPointerCancel={drawUp} />
        </div>
        <p style={{ margin: '8px 0 4px', color: '#9ca3af', fontSize: 13 }}>Draw on the problem in red. Speak or type what happened.</p>
        <textarea value={transcript} onChange={e => setTranscript(e.target.value.slice(0, 8000))} placeholder="What went wrong?"
          aria-label="Bug note" style={{ width: '100%', minHeight: 88, boxSizing: 'border-box', font: '16px system-ui, sans-serif', padding: 8, borderRadius: 8, border: '1px solid #374151', background: '#111827', color: '#e5e7eb' }} />
        <div aria-live="polite" style={{ minHeight: 22, color: '#9ca3af', fontStyle: 'italic' }}>{interim}</div>
        {speechNote && <p style={{ margin: 0, color: '#fca5a5', fontSize: 14 }}>{speechNote}</p>}
      </>}
      {phase === 'priority' && <>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Tool onClick={backToNote} disabled={sending}>Back</Tool>
          <Tool onClick={reset} bg="#dc2626">Cancel</Tool>
        </div>
        {error && <p style={{ color: '#fca5a5', margin: '8px 0 0' }}>{error}</p>}
        <div data-priority-choices="" style={{ margin: 'auto 0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {PRIORITIES.map(([label, color]) => <button key={label} type="button" disabled={sending} onClick={() => send(label)}
            style={{ minHeight: 48, border: 0, borderRadius: 10, background: color, color: '#fff', font: '700 18px system-ui, sans-serif' }}>{label}</button>)}
        </div>
      </>}
    </div>}
    {toast && <div role="status" style={{ position: 'fixed', left: 16, right: 16, bottom: 'max(16px, env(safe-area-inset-bottom))', pointerEvents: 'none', background: '#1f6f6b', color: '#fff', textAlign: 'center', padding: '12px 16px', borderRadius: 10, font: '16px system-ui, sans-serif', zIndex: 2147483002 }}>{toast}</div>}
  </div>;
}

function Tool({ children, onClick, disabled, bg = '#374151' }) {
  return <button type="button" onClick={onClick} disabled={disabled} style={{ minHeight: 44, minWidth: 44, padding: '8px 12px', border: 0, borderRadius: 8, background: bg, color: '#fff', font: '600 15px system-ui, sans-serif' }}>{children}</button>;
}
