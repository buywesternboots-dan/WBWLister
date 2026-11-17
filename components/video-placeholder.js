import { VIDEO_TOOL_LABEL, VIDEO_TOOL_NOTE } from '../lib/video-placeholder';

// Disabled until the video tool is plugged in. Does nothing.
export default function VideoPlaceholder() {
  return (
    <div data-video-placeholder>
      <button type="button" disabled aria-disabled="true">{VIDEO_TOOL_LABEL}</button>
      <small> {VIDEO_TOOL_NOTE}</small>
    </div>
  );
}
