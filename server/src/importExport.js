const { db, insertPoints } = require('./database');
const { parse } = require('csv-parse');
const { stringify } = require('csv-stringify');
const stream = require('stream');
const zlib = require('zlib');

const BATCH_SIZE = 10000;

async function importFromStream(inputStream, contentType) {
  return new Promise((resolve, reject) => {
    const batch = [];
    let count = 0;
    let lines = 0;
    let parser;

    const flushBatch = async () => {
      if (batch.length > 0) {
        try {
          const result = insertPoints(batch);
          count += result.count;
        } catch (err) {
          reject(err);
          return false;
        }
        batch.length = 0;
      }
      return true;
    };

    const handlePoint = (point) => {
      batch.push(point);
      if (batch.length >= BATCH_SIZE) {
        if (!flushBatch()) return false;
      }
      return true;
    };

    switch (contentType) {
      case 'text/csv':
        parser = parse({
          columns: true,
          skip_empty_lines: true,
          trim: true,
          relax_column_count: true
        });

        parser.on('data', (record) => {
          lines++;
          try {
            const metric = record.metric || record.Metric;
            const timestamp = parseInt(record.timestamp || record.Timestamp || record.ts, 10);
            const value = parseFloat(record.value || record.Value);

            if (!metric || isNaN(timestamp) || isNaN(value)) {
              return;
            }

            const tags = {};
            for (const [key, val] of Object.entries(record)) {
              if (key !== 'metric' && key !== 'Metric' && key !== 'timestamp' && key !== 'Timestamp' && key !== 'ts' && key !== 'value' && key !== 'Value' && val !== undefined && val !== null && val !== '') {
                tags[key] = val;
              }
            }

            const point = { metric, timestamp, value };
            if (Object.keys(tags).length > 0) {
              point.tags = tags;
            }

            if (!handlePoint(point)) {
              inputStream.unpipe(parser);
              inputStream.destroy();
            }
          } catch (e) {}
        });
        break;

      case 'application/influxdb-line-protocol':
        parser = new stream.Transform({
          transform(chunk, encoding, callback) {
            this._buffer = (this._buffer || '') + chunk.toString('utf8');
            let newlineIndex;
            while ((newlineIndex = this._buffer.indexOf('\n')) !== -1) {
              const line = this._buffer.slice(0, newlineIndex).trim();
              this._buffer = this._buffer.slice(newlineIndex + 1);
              if (line) {
                this.push(line);
              }
            }
            callback();
          },
          flush(callback) {
            if (this._buffer && this._buffer.trim()) {
              this.push(this._buffer.trim());
            }
            callback();
          },
          readableObjectMode: true,
          writableObjectMode: false
        });

        parser.on('data', (line) => {
          lines++;
          try {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return;

            const parts = trimmed.split(' ');
            if (parts.length < 2) return;

            const measurementPart = parts[0];
            const fieldPart = parts[1];
            const timestampPart = parts.length > 2 ? parts[2] : null;

            const [measurement, ...tagParts] = measurementPart.split(',');
            if (!measurement) return;

            const tags = {};
            for (const tag of tagParts) {
              const eqIdx = tag.indexOf('=');
              if (eqIdx > 0) {
                const key = tag.slice(0, eqIdx);
                const val = tag.slice(eqIdx + 1);
                if (key && val !== undefined) {
                  tags[key] = val;
                }
              }
            }

            const fields = fieldPart.split(',');
            for (const field of fields) {
              const eqIdx = field.indexOf('=');
              if (eqIdx <= 0) continue;

              const fieldName = field.slice(0, eqIdx);
              let fieldValue = field.slice(eqIdx + 1);

              if (fieldValue.endsWith('i')) {
                fieldValue = fieldValue.slice(0, -1);
              }
              const value = parseFloat(fieldValue);
              if (isNaN(value)) continue;

              let metric = measurement;
              if (fieldName !== 'value') {
                metric = `${measurement}.${fieldName}`;
              }

              let timestamp = timestampPart ? parseInt(timestampPart, 10) : Date.now();
              if (timestampPart) {
                const tsLen = timestampPart.length;
                if (tsLen >= 19) {
                  timestamp = Math.floor(timestamp / 1e6);
                } else if (tsLen >= 16) {
                  timestamp = Math.floor(timestamp / 1e3);
                } else if (tsLen <= 10) {
                  timestamp = timestamp * 1e3;
                }
              }

              const point = { metric, timestamp, value };
              if (Object.keys(tags).length > 0) {
                point.tags = tags;
              }

              if (!handlePoint(point)) {
                inputStream.unpipe(parser);
                inputStream.destroy();
                return;
              }
            }
          } catch (e) {}
        });
        break;

      case 'application/openmetrics-text':
        parser = new stream.Transform({
          transform(chunk, encoding, callback) {
            this._buffer = (this._buffer || '') + chunk.toString('utf8');
            let newlineIndex;
            while ((newlineIndex = this._buffer.indexOf('\n')) !== -1) {
              const line = this._buffer.slice(0, newlineIndex).trim();
              this._buffer = this._buffer.slice(newlineIndex + 1);
              if (line) {
                this.push(line);
              }
            }
            callback();
          },
          flush(callback) {
            if (this._buffer && this._buffer.trim()) {
              this.push(this._buffer.trim());
            }
            callback();
          },
          readableObjectMode: true,
          writableObjectMode: false
        });

        parser._metadata = {};

        parser.on('data', (line) => {
          lines++;
          try {
            const trimmed = line.trim();
            if (!trimmed) return;

            if (trimmed.startsWith('# HELP ')) {
              const rest = trimmed.slice(7);
              const spaceIdx = rest.indexOf(' ');
              if (spaceIdx > 0) {
                const metricName = rest.slice(0, spaceIdx);
                const help = rest.slice(spaceIdx + 1);
                parser._metadata[metricName] = parser._metadata[metricName] || {};
                parser._metadata[metricName].help = help;
              }
              return;
            }

            if (trimmed.startsWith('# TYPE ')) {
              const rest = trimmed.slice(7);
              const spaceIdx = rest.indexOf(' ');
              if (spaceIdx > 0) {
                const metricName = rest.slice(0, spaceIdx);
                const type = rest.slice(spaceIdx + 1);
                parser._metadata[metricName] = parser._metadata[metricName] || {};
                parser._metadata[metricName].type = type;
              }
              return;
            }

            if (trimmed.startsWith('#')) return;

            let metric;
            let labelsStr = '';
            let rest;

            const braceStart = trimmed.indexOf('{');
            if (braceStart !== -1) {
              const braceEnd = trimmed.indexOf('}', braceStart);
              if (braceEnd === -1) return;
              metric = trimmed.slice(0, braceStart);
              labelsStr = trimmed.slice(braceStart + 1, braceEnd);
              rest = trimmed.slice(braceEnd + 1).trim();
            } else {
              const firstSpace = trimmed.indexOf(' ');
              if (firstSpace === -1) return;
              metric = trimmed.slice(0, firstSpace);
              rest = trimmed.slice(firstSpace + 1).trim();
            }

            const valueParts = rest.split(/\s+/);
            if (valueParts.length < 1) return;

            const value = parseFloat(valueParts[0]);
            if (isNaN(value)) return;

            let timestamp;
            if (valueParts.length > 1) {
              const ts = parseInt(valueParts[1], 10);
              if (!isNaN(ts)) {
                const tsLen = valueParts[1].length;
                if (tsLen >= 16) {
                  timestamp = Math.floor(ts / 1e6);
                } else if (tsLen >= 13) {
                  timestamp = ts;
                } else if (tsLen <= 10) {
                  timestamp = ts * 1e3;
                } else {
                  timestamp = Math.floor(ts / 1e3);
                }
              }
            }
            if (!timestamp) timestamp = Date.now();

            const tags = {};
            if (labelsStr) {
              const labelRegex = /(\w+)="([^"]*)"/g;
              let match;
              while ((match = labelRegex.exec(labelsStr)) !== null) {
                tags[match[1]] = match[2];
              }
            }

            const point = { metric, timestamp, value };
            if (Object.keys(tags).length > 0) {
              point.tags = tags;
            }

            if (!handlePoint(point)) {
              inputStream.unpipe(parser);
              inputStream.destroy();
              return;
            }
          } catch (e) {}
        });
        break;

      default:
        reject(new Error(`Unsupported content type: ${contentType}`));
        return;
    }

    parser.on('error', reject);
    parser.on('end', async () => {
      try {
        await flushBatch();
        resolve({ count, lines });
      } catch (err) {
        reject(err);
      }
    });

    inputStream.on('error', reject);
    inputStream.pipe(parser);
  });
}

function exportToStream(res, format, metric, start, end, compress = false) {
  const contentTypeMap = {
    csv: 'text/csv; charset=utf-8',
    influx: 'application/influxdb-line-protocol; charset=utf-8',
    openmetrics: 'application/openmetrics-text; charset=utf-8'
  };

  res.setHeader('Content-Type', contentTypeMap[format] || 'text/plain');

  if (compress) {
    res.setHeader('Content-Encoding', 'gzip');
  }

  const stmt = db.prepare(`
    SELECT metric, ts, value, tags 
    FROM points 
    WHERE metric = ? AND ts >= ? AND ts <= ? 
    ORDER BY ts ASC
  `);

  const iterator = stmt.iterate(metric, start, end);

  let transform;

  switch (format) {
    case 'csv':
      transform = stringify({
        header: true,
        columns: ['metric', 'timestamp', 'value', 'tags'],
        cast: {
          object: (value) => JSON.stringify(value)
        }
      });

      (async () => {
        try {
          for (const row of iterator) {
            const tags = row.tags ? JSON.parse(row.tags) : {};
            transform.write({
              metric: row.metric,
              timestamp: row.ts,
              value: row.value,
              tags: Object.keys(tags).length > 0 ? tags : ''
            });
          }
          transform.end();
        } catch (err) {
          transform.destroy(err);
        }
      })();
      break;

    case 'influx':
      transform = new stream.Readable({
        read() {}
      });

      (async () => {
        try {
          for (const row of iterator) {
            const tags = row.tags ? JSON.parse(row.tags) : {};
            let line = row.metric;
            const tagEntries = Object.entries(tags);
            if (tagEntries.length > 0) {
              line += ',' + tagEntries.map(([k, v]) => `${k}=${v}`).join(',');
            }
            line += ` value=${row.value} ${row.ts * 1e6}`;
            transform.push(line + '\n');
          }
          transform.push(null);
        } catch (err) {
          transform.destroy(err);
        }
      })();
      break;

    case 'openmetrics':
      transform = new stream.Readable({
        read() {}
      });

      (async () => {
        try {
          transform.push(`# HELP ${metric} Exported\n`);
          transform.push(`# TYPE ${metric} gauge\n`);
          for (const row of iterator) {
            const tags = row.tags ? JSON.parse(row.tags) : {};
            let line = metric;
            const tagEntries = Object.entries(tags);
            if (tagEntries.length > 0) {
              line += '{' + tagEntries.map(([k, v]) => `${k}="${v}"`).join(',') + '}';
            }
            line += ` ${row.value} ${row.ts}`;
            transform.push(line + '\n');
          }
          transform.push('# EOF\n');
          transform.push(null);
        } catch (err) {
          transform.destroy(err);
        }
      })();
      break;

    default:
      res.status(400).send(`Unsupported format: ${format}`);
      return;
  }

  transform.on('error', (err) => {
    if (!res.headersSent) {
      res.status(500).send(err.message);
    }
  });

  if (compress) {
    const gzip = zlib.createGzip();
    transform.pipe(gzip).pipe(res);
  } else {
    transform.pipe(res);
  }
}

module.exports = {
  importFromStream,
  exportToStream
};
