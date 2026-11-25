'use client';

import { useEffect, useState } from 'react';
import { formatGhanaDate } from '@yivents/shared';
import { Badge, Button, Card, EmptyState, LoadingState } from '@yivents/ui';
import { useAnnouncements } from '@/components/organizer/data';
import { isActiveAnnouncement } from '@/components/organizer/utils';

const STORAGE_KEY = 'yv-dismissed-announcements';

export default function AnnouncementsPage() {
  const { announcements, loading } = useAnnouncements();
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      setDismissed(saved ? (JSON.parse(saved) as string[]) : []);
    } catch {
      setDismissed([]);
    }
  }, []);

  const persist = (next: string[]) => {
    setDismissed(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  if (loading) return <LoadingState label="Loading announcements…" />;
  const relevant = announcements.filter((item) => item.target === 'organizers' || item.target === 'both');
  const active = relevant.filter((item) => isActiveAnnouncement(item) && !dismissed.includes(item.id));
  const hidden = relevant.filter((item) => dismissed.includes(item.id));

  return (
    <div className="org-stack">
      <div>
        <h1 style={{ margin: 0 }}>Announcements</h1>
        <p className="yv-muted" style={{ margin: '.35rem 0 0' }}>Important updates for organizers. Dismissed banners stay hidden on this device.</p>
      </div>

      {!active.length && !hidden.length ? (
        <EmptyState title="You're all caught up" message="There are no organizer announcements right now." />
      ) : null}

      {active.map((item) => (
        <Card key={item.id}>
          <div className="org-row" style={{ justifyContent: 'space-between' }}>
            <div>
              <Badge tone={item.type === 'urgent' ? 'danger' : item.type === 'warning' ? 'warning' : 'info'}>{item.type}</Badge>
              <h2 style={{ margin: '.5rem 0 .25rem', fontSize: '1.15rem' }}>{item.title}</h2>
            </div>
            <span className="org-muted">{formatGhanaDate(item.endAt, false)}</span>
          </div>
          <p style={{ whiteSpace: 'pre-wrap' }}>{item.body}</p>
          {item.dismissible ? <Button variant="outline" size="sm" onClick={() => persist([...dismissed, item.id])}>Dismiss</Button> : null}
        </Card>
      ))}

      {hidden.length ? (
        <Card>
          <h2 style={{ marginTop: 0 }}>Dismissed</h2>
          <p className="org-muted">You can bring a banner back at any time.</p>
          {hidden.map((item) => (
            <div key={item.id} className="org-row" style={{ justifyContent: 'space-between' }}>
              <span>{item.title}</span>
              <Button variant="ghost" size="sm" onClick={() => persist(dismissed.filter((id) => id !== item.id))}>Show again</Button>
            </div>
          ))}
        </Card>
      ) : null}
    </div>
  );
}
