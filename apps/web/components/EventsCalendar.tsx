"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { CalendarEvent } from "../lib/api";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function dateKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function EventsCalendar({ events }: { events: CalendarEvent[] }) {
  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState<string | null>(null);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const key = dateKey(new Date(event.start));
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    }
    return map;
  }, [events]);

  const monthLabel = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const startWeekday = firstOfMonth.getDay();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), day));
  }

  const selectedEvents = selected ? (eventsByDay.get(selected) ?? []) : [];

  function changeMonth(delta: number) {
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1));
    setSelected(null);
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "0.6rem",
        }}
      >
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => changeMonth(-1)}
          aria-label="Previous month"
        >
          ‹
        </button>
        <strong>{monthLabel}</strong>
        <button type="button" className="btn btn-ghost" onClick={() => changeMonth(1)} aria-label="Next month">
          ›
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "0.2rem", textAlign: "center" }}>
        {WEEKDAY_LABELS.map((label, i) => (
          <div key={i} className="text-faint" style={{ fontSize: "0.75rem", padding: "0.15rem 0" }}>
            {label}
          </div>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={i} />;
          const key = dateKey(date);
          const dayEvents = eventsByDay.get(key) ?? [];
          const isToday = key === dateKey(today);
          const isSelected = key === selected;
          return (
            <button
              key={i}
              type="button"
              disabled={dayEvents.length === 0}
              onClick={() => setSelected(isSelected ? null : key)}
              style={{
                aspectRatio: "1",
                width: "100%",
                padding: 0,
                border: isToday ? "1px solid var(--accent)" : "1px solid transparent",
                borderRadius: "50%",
                background: isSelected ? "var(--primary)" : "transparent",
                color: "inherit",
                cursor: dayEvents.length > 0 ? "pointer" : "default",
                position: "relative",
                fontSize: "0.85rem",
              }}
            >
              {date.getDate()}
              {dayEvents.length > 0 && (
                <span
                  style={{
                    position: "absolute",
                    bottom: 3,
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: 4,
                    height: 4,
                    borderRadius: "50%",
                    background: isSelected ? "var(--accent)" : "var(--primary-bright)",
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      {selected && selectedEvents.length > 0 && (
        <div style={{ marginTop: "0.85rem", borderTop: "1px solid var(--border)", paddingTop: "0.6rem" }}>
          {selectedEvents.map((event, i) => (
            <div key={i} style={{ marginBottom: "0.5rem" }}>
              <p style={{ margin: 0, fontWeight: 600 }}>
                {event.postId ? (
                  <Link href={`/posts/${event.postId}`} style={{ color: "inherit" }}>
                    {event.summary}
                  </Link>
                ) : (
                  event.summary
                )}
              </p>
              <p className="text-faint" style={{ margin: "0.1rem 0 0", fontSize: "0.85rem" }}>
                {new Date(event.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                {event.location ? ` · ${event.location}` : ""}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
