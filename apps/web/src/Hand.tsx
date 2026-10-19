import type { TutorialContent } from '@mageknight/content';
import type { GameView, LegalIntent } from '@mageknight/engine';
import { CardArt } from './game-icons';

type HandProps = {
  view: GameView;
  content: TutorialContent;
  onIntent: (intent: LegalIntent) => void;
};

export function Hand({ view, content, onIntent }: HandProps) {
  return (
    <section aria-labelledby="hand-title">
      <h2 id="hand-title">手牌</h2>
      <div className="hand">
        {view.player.hand.map((instance) => {
          const card = content.cards[instance.definitionId];
          const intents = view.legalIntents.filter((intent) => intent.command.type === 'PLAY_CARD' && intent.command.cardId === instance.id);
          return (
            <article className="card" key={instance.id} data-card-id={instance.id} data-definition-id={instance.definitionId}>
              <strong>{card?.name ?? instance.definitionId}</strong>
              {card ? <CardArt card={card} /> : null}
              <small>{card?.kind === 'wound' ? '不能打出' : `${card?.basic?.amount ?? '-'} / ${card?.strong?.amount ?? '-'}`}</small>
              {intents.map((intent) => <button key={intent.id} type="button" onClick={() => onIntent(intent)}>{intent.label.replace(`${card?.name}：`, '')}</button>)}
            </article>
          );
        })}
      </div>
    </section>
  );
}
