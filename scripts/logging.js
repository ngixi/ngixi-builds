import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pino from 'pino';
import pinoPretty from 'pino-pretty';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BUILD_ROOT = path.resolve(__dirname, '..');
const LOGS_ROOT = path.join(BUILD_ROOT, '.logs');

ensureLogsDirectory(LOGS_ROOT);

const runSequence = computeNextRunSequence(LOGS_ROOT);
const runId = runSequence.toString().padStart(4, '0');
const logFileName = `run-${runId}.log`;
const LOG_FILE_PATH = path.join(LOGS_ROOT, logFileName);
const runMetadataPath = path.join(LOGS_ROOT, 'latest-run.json');

truncateLogFile(LOG_FILE_PATH);

function pinoPrettyStream({ colorize, destination, singleLine = false }) {
  const pretty = pinoPretty({
    colorize,
    destination,
    ignore: 'pid,hostname',
    singleLine,
    translateTime: 'yyyy-MM-dd HH:mm:ss,l',
    messageFormat: '"{scope}" {msg}',
    hideObject: false,
    customLevels: 'trace:10,debug:20,info:30,warn:40,error:50,fatal:60',
    customColors: 'trace:gray,debug:blue,info:green,warn:yellow,error:red,fatal:magenta',
    sync: true,
  });
  return pretty;
}

function ensureLogsDirectory(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }
}

function truncateLogFile(filePath) {
  try {
    fs.writeFileSync(filePath, '', 'utf8');
  } catch (error) {
    pendingTruncateError = error;
  }
}

function computeNextRunSequence(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    return 1;
  }

  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  let maxSequence = 0;

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const match = /^run-(\d+)\.log$/i.exec(entry.name);
    if (!match) {
      continue;
    }
    const value = Number.parseInt(match[1], 10);
    if (Number.isFinite(value)) {
      maxSequence = Math.max(maxSequence, value);
    }
  }

  return maxSequence + 1;
}

function writeRunMetadata() {
  const metadata = {
    runId,
    logFile: logFileName,
    logFilePath: LOG_FILE_PATH,
    startedAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(runMetadataPath, JSON.stringify(metadata, null, 2), 'utf8');
  } catch (error) {
    logger.warn({ err: error, path: runMetadataPath }, 'failed to persist run metadata');
  }
}

function finishStreams() {
  if (typeof logger.flush === 'function') {
    try {
      logger.flush();
    } catch (error) {
      // Best effort flush failure; no further logging to avoid recursion
    }
  }
  if (prettyConsole && typeof prettyConsole.end === 'function') {
    try {
      prettyConsole.end();
    } catch (error) {
      // Ignore stream close failures during shutdown
    }
  }
  if (prettyFile && typeof prettyFile.end === 'function') {
    try {
      prettyFile.end();
    } catch (error) {
      // Ignore stream close failures during shutdown
    }
  }
}

const prettyConsole = pinoPrettyStream({ colorize: process.stdout.isTTY, singleLine: false });
const prettyFile = pinoPrettyStream({ colorize: false, destination: LOG_FILE_PATH, singleLine: true });

const logger = createLogger();
writeRunMetadata();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    finishStreams();
  });
}
process.once('beforeExit', () => {
  finishStreams();
});

function createLogger() {
  const level = process.env.BUILD_LOG_LEVEL ?? 'info';

  const baseLogger = pino(
    {
      level,
      base: { runId },
      formatters: {
        level(label) {
          return { level: label };
        },
      },
    },
    pino.multistream([
      { stream: prettyConsole, level },
      { stream: prettyFile, level },
    ]),
  );

  baseLogger.info({ logFile: logFileName, logsRoot: LOGS_ROOT }, 'build logging initialized');
  return baseLogger;
}

function getCallerInfo() {
  const err = new Error();
  const stack = err.stack.split('\n');
  // stack[0] is 'Error', stack[1] is getCallerInfo, stack[2] is scopedLogger, stack[3] is caller of scopedLogger
  const callerLine = stack[3];
  if (!callerLine) {
    return { file: 'unknown', func: 'unknown' };
  }
  // Match: at functionName (file:///path/to/file.js:line:col)
  const match = callerLine.match(/at\s+([^\s(]+)\s+\(([^)]+)\)/);
  if (match) {
    const func = match[1] === '<anonymous>' ? 'anonymous' : match[1];
    const filePath = match[2].split(':')[0];
    const fileName = path.basename(filePath, path.extname(filePath)); // remove extension
    return { file: fileName, func };
  }
  // Fallback for different formats
  const fileMatch = callerLine.match(/([^/\\]+\.[a-z]+):/);
  if (fileMatch) {
    const fileName = path.basename(fileMatch[1], path.extname(fileMatch[1]));
    return { file: fileName, func: 'unknown' };
  }
  return { file: 'unknown', func: 'unknown' };
}

export function scopedLogger(scope) {
  const caller = getCallerInfo();
  const baseScope = scope ? `${caller.file}:${scope}` : caller.file;

  const logMethods = ['info', 'error', 'debug', 'warn', 'trace', 'fatal', 'silent'];

  const wrappedLogger = {};

  for (const method of logMethods) {
    wrappedLogger[method] = function (msg, ...args) {
      const callCaller = getCallerInfo();
      const func = callCaller.func !== 'unknown' ? callCaller.func : '';
      const fullScope = func ? `${caller.file}.${func}.${scope || ''}` : `${caller.file}.${scope || ''}`;
      const trimmedScope = fullScope.replace(/\.+$/, ''); // remove trailing .
      const tempLogger = logger.child({ scope: trimmedScope });
      tempLogger[method](msg, ...args);
    };
  }

  // Also add other properties like child, etc., but for simplicity, just the methods
  wrappedLogger.child = logger.child.bind(logger);
  wrappedLogger.level = logger.level;
  // etc.

  return wrappedLogger;
}

export function getRunId() {
  return runId;
}

export const logFilePath = LOG_FILE_PATH;
export const logsRoot = LOGS_ROOT;
export { logger };
