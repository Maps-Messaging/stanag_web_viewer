import type { TaskType } from '../models/types';

const DESCRIPTION_TEXT = 'Maps Messaging Demo UI';

export function applyTaskEntityDescriptions(
  payload: unknown,
  droneName: string,
  taskType: TaskType,
): unknown {
  if (!isObject(payload) || !isObject(payload.body) || !isObject(payload.body.description)) {
    throw new Error('Cannot apply entity descriptions to malformed TASK_ADMIN payload');
  }

  const taskField = taskType.toLowerCase();
  const concreteTask = payload.body.description[taskField];
  if (!isObject(concreteTask)) throw new Error(`TASK_ADMIN description is missing ${taskField}`);

  const entityDescription = {
    name: `${droneName} : ${taskType}`,
    description: DESCRIPTION_TEXT,
  };

  return {
    ...payload,
    body: {
      ...payload.body,
      description: {
        ...payload.body.description,
        [taskField]: addDescriptions(concreteTask, entityDescription),
      },
    },
  };
}

function addDescriptions(
  value: Record<string, unknown>,
  description: Record<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  Object.entries(value).forEach(([key, child]) => {
    if (!isObject(child)) {
      result[key] = child;
      return;
    }

    const updated = addDescriptions(child, description);
    if (key === 'location' && isLabeledLocation(child)) updated.description = description;
    if (key === 'volume' && isLabeledVolume(child)) updated.description = description;
    result[key] = updated;
  });

  return result;
}

function isLabeledLocation(value: Record<string, unknown>): boolean {
  return typeof value.identifier === 'string' && isObject(value.location);
}

function isLabeledVolume(value: Record<string, unknown>): boolean {
  return typeof value.identifier === 'string' && isObject(value.volume);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
