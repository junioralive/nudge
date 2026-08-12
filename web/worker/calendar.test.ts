import { describe, expect, it } from "vitest";
import { normalizeCalendarUrl, parseCalendar } from "./calendar";

const DAY = 86_400_000;

describe("calendar integration", () => {
  it("accepts provider links and rejects cross-provider or insecure links", () => {
    expect(normalizeCalendarUrl("google", "https://calendar.google.com/calendar/ical/a/basic.ics")).toContain("calendar.google.com");
    expect(normalizeCalendarUrl("icloud", "webcal://p01-caldav.icloud.com/published/a")).toMatch(/^https:/);
    expect(() => normalizeCalendarUrl("google", "http://calendar.google.com/a.ics")).toThrow(/https/);
    expect(() => normalizeCalendarUrl("google", "https://example.com/a.ics")).toThrow(/supported/);
  });

  it("parses single and recurring events inside the requested window", () => {
    const ics = `BEGIN:VCALENDAR\r
VERSION:2.0\r
X-WR-CALNAME:Work\r
BEGIN:VEVENT\r
UID:one\r
DTSTART:20260812T040000Z\r
DTEND:20260812T043000Z\r
SUMMARY:Planning\r
LOCATION:Meet\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:daily\r
DTSTART:20260812T050000Z\r
DTEND:20260812T053000Z\r
RRULE:FREQ=DAILY;COUNT=3\r
SUMMARY:Standup\r
END:VEVENT\r
END:VCALENDAR`;
    const from = Date.parse("2026-08-12T00:00:00Z");
    const result = parseCalendar(ics, from, from + 4 * DAY);
    expect(result.name).toBe("Work");
    expect(result.events.map((event) => event.title)).toEqual(["Planning", "Standup", "Standup", "Standup"]);
    expect(result.events[0]).toMatchObject({ allDay: false, location: "Meet" });
  });

  it("ignores cancelled events", () => {
    const ics = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:cancelled\r
DTSTART:20260812T040000Z\r
DTEND:20260812T043000Z\r
SUMMARY:Cancelled\r
STATUS:CANCELLED\r
END:VEVENT\r
END:VCALENDAR`;
    expect(parseCalendar(ics, Date.parse("2026-08-12T00:00:00Z"), Date.parse("2026-08-13T00:00:00Z")).events).toEqual([]);
  });
});
