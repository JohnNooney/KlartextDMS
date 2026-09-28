import { describe, expect, it } from 'vitest';
import { MAX_DOCUMENT_BYTES } from './document';
import { InvalidDocumentFileError, validateDocumentFile } from './document-input';

function pdfFile(sizeBytes = 4): File {
  return new File([new Uint8Array(sizeBytes)], 'doc.pdf', { type: 'application/pdf' });
}

describe('validateDocumentFile (issue #18 input boundary)', () => {
  it('accepts an application/pdf File up to 10 MB', () => {
    expect(() => validateDocumentFile(pdfFile())).not.toThrow();
    expect(() => validateDocumentFile(pdfFile(MAX_DOCUMENT_BYTES))).not.toThrow();
  });

  it('rejects any other type loudly with "Only PDF files are supported"', () => {
    for (const type of ['image/png', 'text/plain', '']) {
      const file = new File([new Uint8Array(4)], 'doc.pdf', { type });
      expect(() => validateDocumentFile(file)).toThrow(InvalidDocumentFileError);
      expect(() => validateDocumentFile(file)).toThrow('Only PDF files are supported');
    }
  });

  it('rejects PDFs over 10 MB with the same loud message', () => {
    expect(() => validateDocumentFile(pdfFile(MAX_DOCUMENT_BYTES + 1))).toThrow(
      InvalidDocumentFileError,
    );
    expect(() => validateDocumentFile(pdfFile(MAX_DOCUMENT_BYTES + 1))).toThrow(
      'Only PDF files are supported',
    );
  });
});
