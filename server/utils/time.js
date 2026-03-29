// Converts a 12-hour time value + period ("A"/"P") to minutes from midnight.
// Returns null if the input is out of range or cannot be parsed.
function toMinutes(hourText, period) {
  const rawHourText = String(hourText ?? '').trim();
  const hourPart = rawHourText.includes(':') ? rawHourText.split(':')[0] : rawHourText;
  const minutePart = rawHourText.includes(':') ? rawHourText.split(':')[1] : '00';

  const hour = Number(hourPart);
  const minute = Number(minutePart);

  if (!Number.isFinite(hour) || hour < 1 || hour > 12) {
    return null;
  }

  if (!Number.isFinite(minute) || minute < 0 || minute > 59) {
    return null;
  }

  const normalizedPeriod = String(period ?? '')
    .trim()
    .toUpperCase();

  if (normalizedPeriod === 'A' || normalizedPeriod === 'AM') {
    return hour % 12 * 60 + minute;
  }

  if (normalizedPeriod === 'P' || normalizedPeriod === 'PM') {
    return ((hour % 12) + 12) * 60 + minute;
  }

  return null;
}

// Converts a minutes-from-midnight value back to a "H:MM A/P" display string.
// Used when building the startTime/endTime fields on each itinerary stop.
function formatHour(minutesFromMidnight) {
  const total = ((minutesFromMidnight % 1440) + 1440) % 1440;
  const hour24 = Math.floor(total / 60);
  const minute = total % 60;
  const period = hour24 >= 12 ? 'P' : 'A';
  const hour12 = hour24 % 12 || 12;
  const minuteText = String(minute).padStart(2, '0');
  return `${hour12}:${minuteText} ${period}`;
}

// Parses a Routes API duration string (e.g. "1800s") to whole minutes.
// Falls back to 30 minutes if the value is missing or malformed.
function parseDurationToMinutes(durationText) {
  if (!durationText || typeof durationText !== 'string' || !durationText.endsWith('s')) {
    return 30;
  }
  const seconds = Number(durationText.slice(0, -1));
  if (!Number.isFinite(seconds)) {
    return 30;
  }
  return Math.max(1, Math.round(seconds / 60));
}

module.exports = { toMinutes, formatHour, parseDurationToMinutes };
