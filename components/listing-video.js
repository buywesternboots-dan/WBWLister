'use client';
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_ASPECT, recordListingVideo, selectPhotos, videoFileName } from '../lib/listing-video';

const afterPaint = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

// "Make video" on a listing: Ken Burns slides from the listing's own photos, recorded in the browser.
export default function ListingVideo({ item, aspect = DEFAULT_ASPECT }) {
  const canvasRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [clip, setClip] = useState(null); // { url, mime, fileName }
  const [progress, setProgress] = useState(0);

  useEffect(() => () => { if (clip?.url) URL.revokeObjectURL(clip.url); }, [clip]);

  if (!selectPhotos(item?.photos).length) return null;

  const make = async e => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setErr('');
    setProgress(0);
    setBusy(true);
    try {
      await afterPaint();
      const result = await recordListingVideo({
        item, aspect, canvas: canvasRef.current,
        origin: typeof location !== 'undefined' ? location.origin : '',
        onProgress: setProgress,
      });
      const url = URL.createObjectURL(result.blob);
      setClip(c => {
        if (c?.url) URL.revokeObjectURL(c.url);
        return { url, mime: result.mime, fileName: result.fileName || videoFileName(item, result.mime) };
      });
    } catch (er) {
      setErr(er.message || 'Could not make the video.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="listing-video" data-listing-video onClick={e => e.stopPropagation()}>
      <button type="button" data-make-video disabled={busy} onClick={make}>{busy ? 'Making video…' : 'Make video'}</button>
      {busy && <small>{Math.round(progress * 100)}%</small>}
      {err && <small className="err">{err}</small>}
      <canvas ref={canvasRef} className={busy ? '' : 'off'} aria-hidden={!busy} />
      {clip && !busy && <>
        <video src={clip.url} controls playsInline preload="metadata" />
        <a className="src" href={clip.url} download={clip.fileName}>Download</a>
      </>}
    </div>
  );
}
