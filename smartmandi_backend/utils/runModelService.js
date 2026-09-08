const { spawn } = require('child_process');
const path = require('path');

const SCRIPT_PATH = path.join(__dirname, '..', 'python', 'modelService.py');

// `python` is not on PATH everywhere (Debian ships python3; virtualenvs need an
// absolute path). Configurable via .env rather than hardcoded.
const PYTHON_BIN = process.env.PYTHON_BIN || 'python';

class ModelServiceError extends Error {
  constructor(message, { kind, details } = {}) {
    super(message);
    this.name = 'ModelServiceError';
    this.kind = kind || 'failed';
    this.details = details;
  }
}

/**
 * Run python/modelService.py for one operation and resolve with its parsed JSON.
 *
 * The script writes exactly one JSON line to stdout and sends all diagnostics to
 * stderr, so the whole of stdout is the response. Rejects with a
 * ModelServiceError whose `kind` is one of: spawn, timeout, exit, parse.
 */
function runModelService(operation, payload, { timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(PYTHON_BIN, [SCRIPT_PATH, operation], {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false
      });
    } catch (error) {
      return reject(new ModelServiceError(
        `Failed to spawn ${PYTHON_BIN}: ${error.message}`,
        { kind: 'spawn' }
      ));
    }

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(reject, new ModelServiceError(
        `${operation} exceeded ${timeoutMs}ms`,
        { kind: 'timeout', details: { stdoutLength: stdout.length, stderr } }
      ));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    child.on('error', (error) => {
      finish(reject, new ModelServiceError(
        `Failed to start ${PYTHON_BIN}: ${error.message}. Set PYTHON_BIN in .env if the interpreter is named differently.`,
        { kind: 'spawn' }
      ));
    });

    child.on('close', (code) => {
      if (settled) return;

      if (code !== 0) {
        return finish(reject, new ModelServiceError(
          `modelService.py exited with code ${code}`,
          { kind: 'exit', details: { code, stderr } }
        ));
      }

      const output = stdout.trim();
      if (!output) {
        return finish(reject, new ModelServiceError(
          'modelService.py produced no output',
          { kind: 'parse', details: { stderr } }
        ));
      }

      try {
        finish(resolve, JSON.parse(output));
      } catch (parseError) {
        finish(reject, new ModelServiceError(
          `Could not parse model response: ${parseError.message}`,
          { kind: 'parse', details: { rawOutput: output.slice(0, 2000), stderr } }
        ));
      }
    });

    child.stdin.on('error', () => { /* surfaced via the 'error'/'close' handlers */ });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

module.exports = { runModelService, ModelServiceError, PYTHON_BIN };
