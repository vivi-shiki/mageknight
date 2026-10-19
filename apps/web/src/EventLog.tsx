import { useState } from 'react';
import type { TutorialContent } from '@mageknight/content';
import type { DomainEvent, EnemyState } from '@mageknight/engine';

type EventLogProps = {
  events: DomainEvent[];
  enemies: Record<string, EnemyState>;
  content: TutorialContent;
};

export function EventLog({ events, enemies, content }: EventLogProps) {
  const [selectedId, setSelectedId] = useState<number>();
  const selected = events.find((event) => event.id === selectedId);
  const enemyIds = selected && Array.isArray(selected.data.enemyIds) ? selected.data.enemyIds.filter((id): id is string => typeof id === 'string') : [];
  return (
    <section aria-labelledby="log-title">
      <h2 id="log-title">事件日志</h2>
      {events.length === 0 ? <p>游戏刚刚开始。</p> : (
        <ol className="event-log">
          {[...events].reverse().slice(0, 30).map((event) => (
            <li key={event.id}><button type="button" className="log-button" onClick={() => setSelectedId(event.id)}>{event.message}</button></li>
          ))}
        </ol>
      )}
      {selected ? (
        <div className="event-detail" aria-live="polite">
          <strong>事件详情</strong>
          {enemyIds.length > 0 ? <p>相关敌人：{enemyIds.map((id) => content.enemies[enemies[id]?.definitionId ?? '']?.name ?? id).join('、')}</p> : null}
          <pre>{JSON.stringify(selected.data, null, 2)}</pre>
        </div>
      ) : null}
    </section>
  );
}
