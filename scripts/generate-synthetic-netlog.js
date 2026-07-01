#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const output = process.argv[2] || path.join(process.cwd(), 'synthetic-netlog.json');
const count = Number(process.argv[3] || 10000);

const constants = {
  logEventTypes: {
    URL_REQUEST_START_JOB: 1,
    HOST_RESOLVER_MANAGER_CACHE_HIT: 2,
    SOCKET_CONNECT: 3,
    HTTP_TRANSACTION_READ_RESPONSE_HEADERS: 4,
  },
  logSourceType: {
    URL_REQUEST: 1,
    HOST_RESOLVER_IMPL_JOB: 2,
    SOCKET: 3,
  },
};

function eventAt(index) {
  const sourceId = Math.floor(index / 4) + 1;
  const base = {
    time: String(index),
    phase: index % 3,
    source: { id: sourceId, type: (index % 3) + 1 },
  };
  if (index % 4 === 0) {
    return {
      ...base,
      type: 1,
      params: { url: `https://example-${sourceId}.test/path?q=${index}` },
    };
  }
  if (index % 4 === 1) {
    return {
      ...base,
      type: 2,
      params: {
        results: {
          aliases: [`example-${sourceId}.test`],
          ip_endpoints: [{ endpoint_address: `203.0.113.${sourceId % 250}`, endpoint_port: 0 }],
        },
      },
    };
  }
  if (index % 4 === 2) {
    return {
      ...base,
      type: 3,
      params: { address: `203.0.113.${sourceId % 250}:443` },
    };
  }
  return {
    ...base,
    type: 4,
    params: index % 97 === 0 ? { net_error: -105, net_error_string: 'ERR_NAME_NOT_RESOLVED' } : { status_code: 200 },
  };
}

fs.mkdirSync(path.dirname(output), { recursive: true });
const stream = fs.createWriteStream(output);
stream.write('{"constants":');
stream.write(JSON.stringify(constants));
stream.write(',"events":[');
for (let i = 0; i < count; i += 1) {
  if (i > 0) stream.write(',');
  stream.write(JSON.stringify(eventAt(i)));
}
stream.write(']}');
stream.end(() => {
  const stat = fs.statSync(output);
  console.log(JSON.stringify({ output, count, bytes: stat.size }, null, 2));
});
