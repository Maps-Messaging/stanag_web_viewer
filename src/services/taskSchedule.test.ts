import { describe, expect, it } from 'vitest';
import type { BrokerConfiguration, DroneTask } from '../models/types';
import { buildTaskAdminPush, parseTaskAdmin } from './stanagAdapter';
import { buildTaskSchedule, validateTaskSchedule } from './taskSchedule';

describe('task schedule', () => {
  it('builds a start-only schedule when no end is supplied', () => {
    const schedule = buildTaskSchedule('2026-08-24T12:30', '');

    expect(new Date(schedule.start).getTime()).toBe(new Date('2026-08-24T12:30').getTime());
    expect(schedule.end).toBeUndefined();
  });

  it('includes a start-only schedule in the TASK_ADMIN payload', () => {
    const schedule = buildTaskSchedule('2026-08-24T12:30', '');
    const payload = buildTaskAdminPush(configuration, { ...repositionTask, schedule }) as {
      body: { description: { reposition: { time: { start: string; end?: string } } } };
    };

    expect(payload.body.description.reposition.time).toEqual({ start: schedule.start });
  });

  it('parses a start-only schedule received from MQTT or REST', () => {
    const schedule = buildTaskSchedule('2026-08-24T12:30', '');
    const payload = buildTaskAdminPush(configuration, { ...repositionTask, schedule });

    expect(parseTaskAdmin(payload).task?.schedule).toEqual({ start: schedule.start });
  });

  it('builds both bounds when an end is supplied', () => {
    const schedule = buildTaskSchedule('2026-08-24T12:30', '2026-08-24T13:45');

    expect(new Date(schedule.start).getTime()).toBe(new Date('2026-08-24T12:30').getTime());
    expect(new Date(schedule.end!).getTime()).toBe(new Date('2026-08-24T13:45').getTime());
  });

  it('parses a schedule with both bounds received from MQTT or REST', () => {
    const schedule = buildTaskSchedule('2026-08-24T12:30', '2026-08-24T13:45');
    const payload = buildTaskAdminPush(configuration, { ...repositionTask, schedule });

    expect(parseTaskAdmin(payload).task?.schedule).toEqual(schedule);
  });

  it('accepts a valid start without an end', () => {
    expect(validateTaskSchedule('2026-08-24T12:30', '')).toBeUndefined();
  });

  it('rejects an end that is not after the start', () => {
    expect(validateTaskSchedule('2026-08-24T12:30', '2026-08-24T12:30')).toBe('End must be after Start.');
  });
});

const configuration: BrokerConfiguration = {
  transport: 'MQTT',
  brokerUrl: 'mqtt://localhost:1883',
  restApiUrl: 'http://localhost:8080',
  username: '',
  password: '',
  droneTopic: '4817/#',
  taskStatusTopic: '4817/#',
  taskAdminTopic: '4817/{droneId}',
  sourceUuid: '12345678-1234-1234-1234-123456789011',
  stanagVersion: '0.3.0',
};

const repositionTask: DroneTask = {
  id: '1d650e51-f010-4769-9365-30ae6f4714be',
  droneId: 'ddb6fd5c-77ec-5b58-9011-ff985875931b',
  authorityGuid: configuration.sourceUuid,
  type: 'REPOSITION',
  geometry: { type: 'POINT', point: { latitude: 38.4178, longitude: -9.1071, altitude: 100 } },
  geometryType: 'POINT',
  point: { latitude: 38.4178, longitude: -9.1071, altitude: 100 },
  state: 'SUBMITTED',
  createdAt: 0,
  updatedAt: 0,
};
