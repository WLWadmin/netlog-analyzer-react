import { downloadTextFile } from './downloadTextFile';

describe('downloadTextFile', () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    URL.createObjectURL = jest.fn(() => 'blob:download');
    URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    jest.restoreAllMocks();
  });

  it('downloads the supplied text with the requested filename and MIME', () => {
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation();

    downloadTextFile('report.md', '# report', 'text/markdown;charset=utf-8');

    const blob = (URL.createObjectURL as jest.Mock).mock.calls[0][0] as Blob;
    expect(blob.type).toBe('text/markdown;charset=utf-8');
    expect(click).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:download');
    expect(document.querySelector('a[download="report.md"]')).toBeNull();
  });

  it('cleans up the anchor and object URL when clicking fails', () => {
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('click failed');
    });

    expect(() => downloadTextFile('report.txt', 'report')).toThrow('click failed');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:download');
    expect(document.querySelector('a[download="report.txt"]')).toBeNull();
  });
});
