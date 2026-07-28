const NAMED_VALUE_FLOAT_MESSAGE_ID = 251;
const NAMED_VALUE_FLOAT_PAYLOAD_LENGTH = 18;
const NAMED_VALUE_FLOAT_NAME_LENGTH = 10;

let sequence = 0;

export interface MavlinkJsonEvent {
  mavlink: {
    version: 'V2';
    messageId: number;
    systemId: number;
    componentId: number;
    sequence: number;
    payloadLength: number;
    signed: false;
    payload: {
      rawBase64: string;
      decoded: {
        time_boot_ms: number;
        name: string;
        value: number;
      };
    };
  };
}

export function namedValueFloatTopic(systemId: number): string {
  return `/mavlink/${systemId}/NAMED_VALUE_FLOAT`;
}

export function buildNamedValueFloatEvent(
  systemId: number,
  componentId: number,
  name: string,
  value: number,
): MavlinkJsonEvent {
  const timeBootMs = Math.floor(globalThis.performance.now()) >>> 0;
  const normalisedName = name.slice(0, NAMED_VALUE_FLOAT_NAME_LENGTH);
  const payload = encodeNamedValueFloatPayload(timeBootMs, normalisedName, value);
  const eventSequence = sequence;

  sequence = (sequence + 1) & 0xff;

  return {
    mavlink: {
      version: 'V2',
      messageId: NAMED_VALUE_FLOAT_MESSAGE_ID,
      systemId,
      componentId,
      sequence: eventSequence,
      payloadLength: NAMED_VALUE_FLOAT_PAYLOAD_LENGTH,
      signed: false,
      payload: {
        rawBase64: encodeBase64(payload),
        decoded: {
          time_boot_ms: timeBootMs,
          name: normalisedName,
          value,
        },
      },
    },
  };
}

function encodeNamedValueFloatPayload(
  timeBootMs: number,
  name: string,
  value: number,
): Uint8Array {
  const payload = new Uint8Array(NAMED_VALUE_FLOAT_PAYLOAD_LENGTH);
  const view = new DataView(payload.buffer);

  view.setUint32(0, timeBootMs, true);
  view.setFloat32(4, value, true);
  payload.set(
    new TextEncoder().encode(name).slice(0, NAMED_VALUE_FLOAT_NAME_LENGTH),
    8,
  );

  return payload;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return globalThis.btoa(binary);
}
