// Disabled stand-in on the admin screen. Not wired: no handler, no request, no saved setting.
export default function EncyclopediaPlaceholder() {
  return (
    <label className="encyclopedia-soon" data-encyclopedia-placeholder>
      <input type="checkbox" disabled aria-disabled="true" />
      send to boot encyclopedia
      <small>coming soon</small>
    </label>
  );
}
