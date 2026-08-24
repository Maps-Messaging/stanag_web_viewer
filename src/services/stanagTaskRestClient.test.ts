import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrokerConfiguration } from '../models/types';
import { resumeStanagTask } from './stanagTaskRestClient';

describe('STANAG task resume REST client', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('posts to the separate resume endpoint and returns the continuation decision', async () => {
        const result = {
            status: 'ACCEPTED',
            message: 'Task resume requested',
            previousMavlinkSequence: 4,
            selectedLogicalItem: 2,
            selectedMavlinkSequence: 6,
            planFingerprint: 'sha-256',
            missionId: 42,
            missionReused: true,
            missionReuploaded: false,
        };
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(result), {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
        }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(resumeStanagTask(configuration, TASK_ID, DRONE_ID)).resolves.toEqual(result);
        expect(fetchMock).toHaveBeenCalledWith(
            `http://localhost:8080/api/v1/stanag/tasks/${TASK_ID}/resume/${DRONE_ID}`,
            expect.objectContaining({ method: 'POST' }),
        );
    });

    it('surfaces the backend readiness rejection reason', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            status: 'REJECTED',
            message: 'Drone is not armed',
            missionReused: false,
            missionReuploaded: false,
        }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
        })));

        await expect(resumeStanagTask(configuration, TASK_ID, DRONE_ID))
            .rejects.toThrow(`Unable to resume STANAG task ${TASK_ID}: HTTP 409: Drone is not armed`);
    });
});

const TASK_ID = '0b128255-2d93-4d64-8f79-93d5bb3b0485';
const DRONE_ID = 'bd6bfbc4-22b8-5915-90d9-f9e23e7e63e6';

const configuration: BrokerConfiguration = {
    transport: 'mqtt',
    brokerUrl: 'mqtt://localhost:1883',
    restApiUrl: 'http://localhost:8080/api/v1',
    username: '',
    password: '',
    droneTopic: '4817/#',
    taskStatusTopic: '4817/#',
    taskAdminTopic: '4817/{droneId}',
    sourceUuid: '12345678-1234-1234-1234-123456789011',
    stanagVersion: '0.3.0',
};
