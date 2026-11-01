import { useState } from 'react';
import { Palette } from 'lucide-react';
import '../../styles/image-editor.css';
export type BackgroundChoice = { id: string; label: string; color: string | null };
const PRESET_BACKGROUNDS: BackgroundChoice[] = [
  { id: 'transparent', label: 'Transparent background', color: null },
  { id: 'white', label: 'White background', color: '#ffffff' },
  { id: 'black', label: 'Black background', color: '#111827' },
  { id: 'gray', label: 'Light gray background', color: '#e5e7eb' },
  { id: 'blue', label: 'Blue background', color: '#3975ff' },
  { id: 'sky', label: 'Sky blue background', color: '#8ed8ff' },
  { id: 'mint', label: 'Mint background', color: '#72ddb5' },
  { id: 'yellow', label: 'Yellow background', color: '#ffd54a' },
  { id: 'coral', label: 'Coral background', color: '#ff8a72' },
  { id: 'violet', label: 'Violet background', color: '#9b6de3' },
];
export const TRANSPARENT_BACKGROUND = PRESET_BACKGROUNDS[0]!;


export async function downloadWithBackground(resultUrl: string, color: string): Promise<void> {
  const response = await fetch(resultUrl);
  if (!response.ok) throw new Error('The result could not be prepared for download.');
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not prepare this download.');
  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Your browser could not prepare this download.')), 'image/png');
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'background-removed-image.png';
  anchor.click();
  URL.revokeObjectURL(url);
}


export function BackgroundOptions({ selected, onChange, disabled = false }: { selected: BackgroundChoice; onChange(choice: BackgroundChoice): void; disabled?: boolean }) {
  const [customColor, setCustomColor] = useState('#f3f6ff');
  return <div className="workspace-image-options"><aside className="background-color-panel" aria-labelledby="background-color-heading">
    <div className="background-color-heading"><Palette size={20} aria-hidden="true" /><h3 id="background-color-heading">Change background color</h3></div>
    <label className="custom-color-control"><span>Custom color</span><input type="color" value={customColor} aria-label="Custom background color" disabled={disabled} onChange={event => { setCustomColor(event.target.value); onChange({ id: 'custom', label: 'Custom background', color: event.target.value }); }} /></label>
    <div className="preset-color-group"><span>Preset colors</span><div className="background-swatches">{PRESET_BACKGROUNDS.map(background => <button key={background.id} className={`background-swatch ${background.color === null ? 'is-transparent' : ''} ${selected.id === background.id ? 'is-selected' : ''}`} style={background.color ? { backgroundColor: background.color } : undefined} type="button" aria-label={background.label} aria-pressed={selected.id === background.id} disabled={disabled} onClick={() => onChange(background)} />)}</div></div>
  </aside></div>;
}
