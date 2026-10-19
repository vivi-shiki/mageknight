type Props = {
  canUndo: boolean;
  status: string;
  onUndo: () => void;
  onSave: () => void;
  onLoad: () => void;
  onExport: () => void;
};

export function StorageControls({ canUndo, status, onUndo, onSave, onLoad, onExport }: Props) {
  return (
    <section aria-label="存档与撤销">
      <h2>存档</h2>
      <p className="controls">
        <button type="button" onClick={onUndo} disabled={!canUndo}>撤销</button>
        <button type="button" onClick={onSave}>手动存档</button>
        <button type="button" onClick={onLoad}>载入手动存档</button>
        <button type="button" onClick={onExport}>导出日志</button>
      </p>
      <p aria-live="polite">{status}</p>
    </section>
  );
}
