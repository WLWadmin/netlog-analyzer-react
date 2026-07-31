import { FileFormatRegistry } from './fileFormatRegistry';
import {
  confirmFileParser,
  prepareFileFormat,
  ParserMismatchError,
} from './fileFormatGateway';
import type {
  FileFormatAdapter,
  FileParserId,
  ParseInput,
  ProbeVerdict,
} from './fileFormatTypes';

function adapter(
  parserId: FileParserId,
  probeVerdict: ProbeVerdict['kind'],
  parse: jest.Mock,
  validateOk = true,
): FileFormatAdapter {
  return {
    parserId,
    sourceKind: parserId === 'har@1' ? 'har' : 'netlog',
    family: 'network',
    extensions: ['.json'],
    probe: async () => ({
      kind: probeVerdict,
      parserId,
      evidenceCodes: [`${parserId}:probe`],
    } as ProbeVerdict),
    validate: async () => ({
      ok: validateOk,
      evidenceCodes: [`${parserId}:validate`],
    }),
    parse,
  };
}

const input: ParseInput = {
  taskId: 'task-1',
  fileName: 'sample.json',
  container: 'plain',
  value: { log: { entries: [] } },
  payload: { log: { entries: [] } },
};

describe('two-stage file format gateway', () => {
  it('returns an auto-ready parser for one unique strong recommendation', async () => {
    const harParse = jest.fn();
    const netlogParse = jest.fn();
    const registry = new FileFormatRegistry([
      adapter('har@1', 'definite-match', harParse),
      adapter('chromium-netlog@1', 'no-match', netlogParse),
    ]);

    const prepared = await prepareFileFormat(input, registry);

    expect(prepared).toEqual({
      kind: 'auto-ready',
      input,
      parserId: 'har@1',
    });
    expect(harParse).not.toHaveBeenCalled();
    expect(netlogParse).not.toHaveBeenCalled();
  });

  it('keeps ambiguous candidates waiting for an explicit choice', async () => {
    const harParse = jest.fn();
    const netlogParse = jest.fn();
    const registry = new FileFormatRegistry([
      adapter('har@1', 'possible-match', harParse),
      adapter('chromium-netlog@1', 'possible-match', netlogParse),
    ]);

    const prepared = await prepareFileFormat(input, registry);

    expect(prepared).toEqual({
      kind: 'awaiting-confirmation',
      input,
      resolution: {
        kind: 'needs-choice',
        candidates: expect.arrayContaining([
          expect.objectContaining({ parserId: 'har@1' }),
          expect.objectContaining({ parserId: 'chromium-netlog@1' }),
        ]),
      },
    });
    expect(harParse).not.toHaveBeenCalled();
    expect(netlogParse).not.toHaveBeenCalled();
  });

  it('calls only the confirmed parser after strict validation', async () => {
    const harParse = jest.fn().mockResolvedValue({ kind: 'har' });
    const netlogParse = jest.fn();
    const registry = new FileFormatRegistry([
      adapter('har@1', 'definite-match', harParse),
      adapter('chromium-netlog@1', 'no-match', netlogParse),
    ]);

    const result = await confirmFileParser(input, 'har@1', registry, {
      taskId: input.taskId,
      isCancelled: () => false,
    });

    expect(result).toEqual({ kind: 'har' });
    expect(harParse).toHaveBeenCalledTimes(1);
    expect(netlogParse).not.toHaveBeenCalled();
  });

  it('does not call any parser when strict validation fails', async () => {
    const harParse = jest.fn();
    const netlogParse = jest.fn();
    const registry = new FileFormatRegistry([
      adapter('har@1', 'possible-match', harParse, false),
      adapter('chromium-netlog@1', 'definite-match', netlogParse),
    ]);

    await expect(confirmFileParser(input, 'har@1', registry, {
      taskId: input.taskId,
      isCancelled: () => false,
    })).rejects.toBeInstanceOf(ParserMismatchError);
    expect(harParse).not.toHaveBeenCalled();
    expect(netlogParse).not.toHaveBeenCalled();
  });

  it('does not fall back when the bound parser rejects the complete payload', async () => {
    const harParse = jest.fn().mockRejectedValue(new Error('完整文件结构冲突'));
    const netlogParse = jest.fn();
    const registry = new FileFormatRegistry([
      adapter('har@1', 'definite-match', harParse),
      adapter('chromium-netlog@1', 'no-match', netlogParse),
    ]);

    await expect(confirmFileParser(input, 'har@1', registry, {
      taskId: input.taskId,
      isCancelled: () => false,
    })).rejects.toThrow('完整文件结构冲突');
    expect(harParse).toHaveBeenCalledTimes(1);
    expect(netlogParse).not.toHaveBeenCalled();
  });

  it('expert mismatch returns the actual resolution without switching parsers', async () => {
    const harParse = jest.fn();
    const netlogParse = jest.fn();
    const registry = new FileFormatRegistry([
      adapter('har@1', 'no-match', harParse),
      adapter('chromium-netlog@1', 'definite-match', netlogParse),
    ]);

    const prepared = await prepareFileFormat(input, registry, 'har@1');

    expect(prepared).toEqual({
      kind: 'parser-mismatch',
      input,
      requestedParserId: 'har@1',
      resolution: {
        kind: 'recommended',
        candidate: expect.objectContaining({ parserId: 'chromium-netlog@1' }),
      },
    });
    expect(harParse).not.toHaveBeenCalled();
    expect(netlogParse).not.toHaveBeenCalled();
  });
});
