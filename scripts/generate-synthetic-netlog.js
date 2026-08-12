#!/usr/bin/env node

const fs = require('fs');
const { once } = require('events');
const path = require('path');

const output = process.argv[2] || path.join(process.cwd(), 'synthetic-netlog.json');
const targetMbIndex = process.argv.indexOf('--target-mb');
const targetBytes = targetMbIndex >= 0
  ? Number(process.argv[targetMbIndex + 1]) * 1024 * 1024
  : undefined;
const requestedCount = targetMbIndex >= 0
  ? undefined
  : Number(process.argv[3] || 10000);

if (
  (targetBytes !== undefined && (!Number.isFinite(targetBytes) || targetBytes <= 0))
  || (requestedCount !== undefined && (!Number.isInteger(requestedCount) || requestedCount <= 0))
) {
  throw new Error('Provide a positive event count or --target-mb <size>.');
}

const constants = {
  logEventTypes: {
    URL_REQUEST_START_JOB: 1,
    PROXY_RESOLUTION_SERVICE_RESOLVED_PROXY_LIST: 2,
    HOST_RESOLVER_MANAGER_JOB: 3,
    HOST_RESOLVER_DNS_TASK: 4,
    SOCKET_CONNECT: 5,
    SSL_CONNECT: 6,
    HTTP2_SESSION_INITIALIZED: 7,
    QUIC_SESSION: 8,
    HTTP_TRANSACTION_READ_RESPONSE_HEADERS: 9,
    URL_REQUEST_ALIVE: 10,
    URL_REQUEST_JOB_BYTES_READ: 11,
  },
  logSourceType: {
    URL_REQUEST: 1,
    PROXY_RESOLUTION_SERVICE: 2,
    HOST_RESOLVER_MANAGER_JOB: 3,
    SOCKET: 4,
    SSL_CONNECT_JOB: 5,
    HTTP2_SESSION: 6,
    QUIC_SESSION: 7,
  },
};

function eventAt(index) {
  const requestIndex = Math.floor(index / 96);
  const step = index % 96;
  const requestId = requestIndex * 10 + 1;
  const proxyId = requestId + 1;
  const dnsId = requestId + 2;
  const socketId = requestId + 3;
  const tlsId = requestId + 4;
  const protocolId = requestId + 5;
  const host = `service-${requestIndex % 1000}.example.invalid`;
  const ip = `203.0.113.${(requestIndex % 250) + 1}`;
  const time = String(index * 0.25);
  const dependency = id => ({ source_dependency: { id } });
  const lifecycleEvents = [
    { time, type: 1, phase: 0, source: { id: requestId, type: 1 }, params: { url: `https://${host}/api/${requestIndex}`, method: 'GET' } },
    { time, type: 2, phase: 2, source: { id: proxyId, type: 2 }, params: { ...dependency(requestId), proxy_list: requestIndex % 37 === 0 ? 'PROXY proxy.example.invalid:8080' : 'DIRECT' } },
    { time, type: 3, phase: 0, source: { id: dnsId, type: 3 }, params: { ...dependency(requestId), host } },
    { time, type: 4, phase: 1, source: { id: dnsId, type: 3 }, params: { ...dependency(requestId), host, results: { aliases: [host], ip_endpoints: [{ endpoint_address: ip, endpoint_port: 0 }] } } },
    { time, type: 5, phase: 0, source: { id: socketId, type: 4 }, params: { ...dependency(requestId), address: `${ip}:443` } },
    { time, type: 5, phase: 1, source: { id: socketId, type: 4 }, params: { ...dependency(requestId), address: `${ip}:443` } },
    { time, type: 6, phase: 0, source: { id: tlsId, type: 5 }, params: { ...dependency(socketId), host } },
    { time, type: 6, phase: 1, source: { id: tlsId, type: 5 }, params: { ...dependency(socketId), host, version: 'TLS1.3' } },
    { time, type: requestIndex % 5 === 0 ? 8 : 7, phase: 2, source: { id: protocolId, type: requestIndex % 5 === 0 ? 7 : 6 }, params: { ...dependency(requestId), host } },
    { time, type: 9, phase: 0, source: { id: requestId, type: 1 }, params: { status_code: 200 } },
    { time, type: 9, phase: 1, source: { id: requestId, type: 1 }, params: { status_code: 200 } },
  ];
  if (step < lifecycleEvents.length) return lifecycleEvents[step];
  if (step < 95) {
    return {
      time,
      type: 11,
      phase: 2,
      source: { id: requestId, type: 1 },
      params: { byte_count: 16_384, sequence: step - lifecycleEvents.length },
    };
  }
  return {
    time,
    type: 10,
    phase: 1,
    source: { id: requestId, type: 1 },
    params: requestIndex % 97 === 0 ? { net_error: -105 } : {},
  };
}

async function write(stream, text) {
  if (!stream.write(text)) await once(stream, 'drain');
}

async function main() {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const stream = fs.createWriteStream(output);
  const header = `{"constants":${JSON.stringify(constants)},"events":[`;
  await write(stream, header);
  let bytes = Buffer.byteLength(header);
  let count = 0;
  while (
    targetBytes !== undefined
      ? bytes < targetBytes - 2
      : count < requestedCount
  ) {
    const serialized = `${count > 0 ? ',' : ''}${JSON.stringify(eventAt(count))}`;
    await write(stream, serialized);
    bytes += Buffer.byteLength(serialized);
    count += 1;
  }
  await write(stream, ']}');
  stream.end();
  await once(stream, 'finish');
  const stat = fs.statSync(output);
  console.log(JSON.stringify({
    output,
    count,
    bytes: stat.size,
    targetBytes: targetBytes ?? null,
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
