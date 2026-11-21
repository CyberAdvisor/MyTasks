/**
 * calendar.json (FR-21.2): the app decrypts what the Mac's calendar helper
 * writes. helper/testdata/calendar-envelope.json was written by
 * helper/calendar_sync.py, whose own tests check it still writes that file
 * byte for byte; here the app's own crypto.ts opens it with the same
 * passphrase.
 */
import { describe, expect, it } from 'vitest';
import fixture from '../helper/testdata/calendar-envelope.json?raw';
import { deriveKey, KDF_ITERATIONS, parseEnvelope, unseal, type Envelope } from '../src/lib/sync/crypto';
import { readCalendar } from '../src/lib/calendar/events';

describe('calendar.json from the helper', () => {
  it('decrypts with the gist passphrase and holds the events with their details', async () => {
    const env = JSON.parse(fixture) as Envelope & { app: string };
    expect(env.app).toBe('mytasks-calendar');
    expect(env.kdf.iterations).toBe(KDF_ITERATIONS);
    const key = await deriveKey('correct horse battery staple', env.kdf.salt);
    const payload = JSON.parse(await unseal(key, env));
    expect(payload.format).toBe(1);
    expect(payload.calendars.map((c: { title: string }) => c.title)).toEqual(['Work', 'Home']);
    const [review, dayOff] = payload.events;
    expect(review).toMatchObject({ title: 'Design review', allDay: false, location: 'Room 4', repeat: 'Every 2 weeks on Tue, Thu' });
    expect(new Date(review.start).toISOString()).toBe(review.start);
    expect(dayOff).toMatchObject({ title: 'Day off', allDay: true, start: '2026-11-20', end: '2026-11-20' });
  });

  it('passes the app\'s envelope checks as the calendar file, never as the task list', async () => {
    expect(parseEnvelope(fixture, 'mytasks-calendar')).not.toBeNull();
    expect(parseEnvelope(fixture)).toBeNull();
  });

  it('reads as calendar data, every event kept', async () => {
    const env = parseEnvelope(fixture, 'mytasks-calendar')!;
    const payload = JSON.parse(await unseal(await deriveKey('correct horse battery staple', env.kdf.salt), env));
    const data = readCalendar(payload)!;
    expect(data.events).toHaveLength(payload.events.length);
    expect(data.calendars.map((c) => c.color)).toEqual(payload.calendars.map((c: { color: string }) => c.color));
  });

  it('refuses a wrong passphrase', async () => {
    const env = JSON.parse(fixture) as Envelope;
    await expect(unseal(await deriveKey('a different passphrase', env.kdf.salt), env)).rejects.toThrow();
  });
});
