import type { TaskSchedule } from '../models/types';

export function validateTaskSchedule(start: string, end: string): string | undefined {
  if (start.length === 0) return 'Start is required.';
  const startMillis = new Date(start).getTime();
  if (!Number.isFinite(startMillis)) return 'Start is not a valid date and time.';
  if (end.length === 0) return undefined;

  const endMillis = new Date(end).getTime();
  if (!Number.isFinite(endMillis)) return 'End is not a valid date and time.';
  if (endMillis <= startMillis) return 'End must be after Start.';
  return undefined;
}

export function buildTaskSchedule(start: string, end: string): TaskSchedule {
  return {
    start: localDateTimeToIsoOffset(start),
    ...(end.length > 0 ? { end: localDateTimeToIsoOffset(end) } : {}),
  };
}

function localDateTimeToIsoOffset(value: string): string {
  const date = new Date(value);
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absoluteOffset / 60)).padStart(2, '0');
  const offsetRemainder = String(absoluteOffset % 60).padStart(2, '0');

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetRemainder}`;
}
