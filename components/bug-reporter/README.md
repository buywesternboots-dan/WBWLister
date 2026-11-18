# Bug reporter

Floating button, page snapshot, red markup, and a typed or spoken note. Drop the folder in, render it once in the root layout, and post to your own API.

```jsx
import BugReporter from '../components/bug-reporter/BugReporter';

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}<BugReporter /></body></html>;
}
```

Phones cannot share the screen (`getDisplayMedia` is unavailable on iPhone), so the button snapshots the visible page with html2canvas. That library paints the DOM itself. html-to-image uses an SVG `foreignObject`, which Safari often saves as a blank image.

The button is at least 48px, drags with pointer events, stays inside the viewport and the safe-area insets, and remembers `{ side, y }` in `localStorage` (`bug-reporter-position`). A movement under 8px is a tap. The widget is marked `data-bug-reporter` so the snapshot leaves it out.

Optional props: `endpoint` (default `/api/bug-reports`) and `storageKey`.

## Request

`POST` JSON:

- `image` — JPEG or WebP data URL (PNG is also accepted), quality about 0.7, kept under 1MB on the client
- `transcript` — typed text plus any speech-to-text
- `priority` — `High`, `Medium`, `Low`, or `Question`
- `page_url`, `user_agent`, `viewport`

Speech uses `SpeechRecognition` or `webkitSpeechRecognition` (continuous, interim). The textarea is always there; iOS speech support is uneven.

## This app

`app/api/bug-reports` stores a row in Neon (`bug_reports`, created on first use). Signed-in staff and sellers can report from any page. Logged-out reports are accepted only from `/login`, capped at 1MB, and limited to 5 per 10 minutes per IP. The counter is one atomic database statement, not a read followed by a write. The dashboard is `/admin/bugs` (staff only) and loads one page of screenshots at a time.

The snapshot clears password, email, phone, invite, and contact fields, plus anything marked `data-private` or `data-sensitive`. `page_url` is stored without its fragment or sensitive query (`invite`, `password`, `email`, `phone`, `contact`, and similar).

AI triage stays off unless the reporter is signed in and both `BUG_REPORT_AI=on` and `GEMINI_API_KEY` are set. A missing flag, a logged-out report, or a Gemini failure still saves the report with an empty analysis.
