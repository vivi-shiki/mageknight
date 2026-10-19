import type { GameView, LegalIntent } from '@mageknight/engine';

type ActionPanelProps = { view: GameView; onIntent: (intent: LegalIntent) => void };

export function ActionPanel({ view, onIntent }: ActionPanelProps) {
  const intents = view.legalIntents.filter((intent) => intent.group !== 'card' && intent.command.type !== 'MOVE_HERO');
  return (
    <section aria-labelledby="action-title">
      <h2 id="action-title">可执行动作</h2>
      <div className="actions">
        {intents.length === 0 ? <p>当前没有额外动作。</p> : intents.map((intent) => (
          <button key={intent.id} type="button" onClick={() => onIntent(intent)}>{intent.label}</button>
        ))}
      </div>
    </section>
  );
}

