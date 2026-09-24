/** Demo input parsing only. No solar calculation or timezone-offset arithmetic. */
function utcMidnight(day: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = new Date(`${day}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === day
    ? date
    : null;
}

/** Accept an explicit absolute instant, rejecting missing offsets and date rollover. */
export function parseAbsoluteTime(text: string): Date | null {
  const value = text.trim();
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (
    !match ||
    !utcMidnight(match[1]!) ||
    Number(match[2]) > 23 ||
    Number(match[3]) > 59 ||
    Number(match[4] ?? 0) > 59
  )
    return null;
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) ? instant : null;
}

/** Minutes since UTC midnight, not local midnight; every slider day is 1440 minutes. */
export function sliderToInstant(day: string, minute: number): Date | null {
  const midnight = utcMidnight(day);
  if (!midnight || !Number.isInteger(minute) || minute < 0 || minute > 1439)
    return null;
  return new Date(midnight.getTime() + minute * 60_000);
}

export function splitUtcInstant(instant: Date): {
  day: string;
  minute: number;
} {
  return {
    day: instant.toISOString().slice(0, 10),
    minute: instant.getUTCHours() * 60 + instant.getUTCMinutes(),
  };
}
