import type { TaskDuration, TaskType } from '../models/types';

const DURATION_TASK_TYPES = new Set<TaskType>([
  'PATROL',
  'LOITER',
  'STANDBY',
  'DETECT',
  'SURVEY',
  'SCREEN',
]);

export function supportsDuration(taskType: TaskType | undefined): boolean {
  return taskType !== undefined && DURATION_TASK_TYPES.has(taskType);
}

export function validateTaskDuration(duration: TaskDuration): string | undefined {
  const fields: Array<[keyof TaskDuration, number]> = [
    ['hours', duration.hours],
    ['minutes', duration.minutes],
    ['seconds', duration.seconds],
  ];

  for (const [name, value] of fields) {
    if (!Number.isInteger(value) || value < 0) return `${capitalise(name)} must be a non-negative whole number.`;
  }
  if (duration.minutes > 59) return 'Minutes must be between 0 and 59.';
  if (duration.seconds > 59) return 'Seconds must be between 0 and 59.';
  return undefined;
}

export function formatIso8601Duration(duration: TaskDuration | undefined): string | undefined {
  if (!duration) return undefined;
  const validationError = validateTaskDuration(duration);
  if (validationError) throw new Error(validationError);
  if (duration.hours === 0 && duration.minutes === 0 && duration.seconds === 0) return undefined;

  let value = 'PT';
  if (duration.hours > 0) value += `${duration.hours}H`;
  if (duration.minutes > 0) value += `${duration.minutes}M`;
  if (duration.seconds > 0) value += `${duration.seconds}S`;
  return value;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
