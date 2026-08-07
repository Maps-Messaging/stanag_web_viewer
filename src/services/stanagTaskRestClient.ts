import type { BrokerConfiguration, DroneTask } from '../models/types';
import { parseTaskAdmin } from './stanagAdapter';

const TASK_PATH = 'stanag/tasks';

export async function getAllStanagTasks(configuration: BrokerConfiguration): Promise<DroneTask[]> {
    const response = await fetch(buildTaskUrl(configuration), {
        method: 'GET',
        headers: buildHeaders(configuration),
    });
    if (!response.ok) throw new Error(await responseError(response, 'Unable to load STANAG tasks'));

    const payload = await parseJsonResponse(response);
    const entries = Array.isArray(payload) ? payload : [payload];
    const now = Date.now();

    return entries.flatMap((entry) => {
        const value = typeof entry === 'string' ? JSON.parse(entry) : entry;
        const parsed = parseTaskAdmin(value);
        if (parsed.action !== 'PUSH' || !parsed.task) return [];

        const task = parsed.task;
        return [{
            ...task,
            state: task.schedule && Date.parse(task.schedule.start) > now ? 'SCHEDULED' : 'ACTIVE',
            updatedAt: now,
        }];
    });
}


export async function getStanagTask(configuration: BrokerConfiguration, taskId: string): Promise<DroneTask | undefined> {
    const response = await fetch(buildTaskUrl(configuration, taskId), {
        method: 'GET',
        headers: buildHeaders(configuration),
    });

    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(await responseError(response, `Unable to load STANAG task ${taskId}`));

    const payload = await parseJsonResponse(response);
    const value = typeof payload === 'string' ? JSON.parse(payload) : payload;
    const parsed = parseTaskAdmin(value);
    if (parsed.action !== 'PUSH' || !parsed.task) return undefined;

    const now = Date.now();
    const task = parsed.task;
    return {
        ...task,
        state: task.schedule && Date.parse(task.schedule.start) > now ? 'SCHEDULED' : 'ACTIVE',
        updatedAt: now,
    };
}

export async function deleteStanagTask(configuration: BrokerConfiguration, taskId: string): Promise<void> {
    const response = await fetch(buildTaskUrl(configuration, taskId), {
        method: 'DELETE',
        headers: buildHeaders(configuration),
    });
    if (response.status === 202 || response.status === 200 || response.status === 204) return;
    throw new Error(await responseError(response, `Unable to cancel STANAG task ${taskId}`));
}

export async function resendStanagTask(configuration: BrokerConfiguration, taskId: string, droneId: string): Promise<void> {
    const response = await fetch(buildTaskUrl(configuration, taskId, 'resend', droneId), {
        method: 'POST',
        headers: buildHeaders(configuration),
    });
    if (response.status === 202 || response.status === 200 || response.status === 204) return;
    throw new Error(await responseError(response, `Unable to resend STANAG task ${taskId}`));
}

function buildTaskUrl(configuration: BrokerConfiguration, ...pathSegments: string[]): string {
    const baseUrl = configuration.restApiUrl.replace(/\/+$/, '');
    const path = [TASK_PATH, ...pathSegments.map((segment) => encodeURIComponent(segment))].join('/');
    return `${baseUrl}/${path}`;
}

function buildHeaders(configuration: BrokerConfiguration): HeadersInit {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (configuration.username) {
        headers.Authorization = `Basic ${globalThis.btoa(`${configuration.username}:${configuration.password}`)}`;
    }
    return headers;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
    const body = await response.text();
    if (!body.trim()) return [];
    try {
        return JSON.parse(body) as unknown;
    } catch (error) {
        throw new Error(`STANAG task REST response was not valid JSON: ${String(error)}`);
    }
}

async function responseError(response: Response, prefix: string): Promise<string> {
    const body = await response.text();
    if (!body.trim()) return `${prefix}: HTTP ${response.status}`;
    try {
        const payload = JSON.parse(body) as { message?: unknown; status?: unknown };
        const message = typeof payload.message === 'string'
            ? payload.message
            : typeof payload.status === 'string'
                ? payload.status
                : body;
        return `${prefix}: HTTP ${response.status}: ${message}`;
    } catch {
        return `${prefix}: HTTP ${response.status}: ${body}`;
    }
}
