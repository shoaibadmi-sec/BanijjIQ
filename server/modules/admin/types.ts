export interface InvoiceLogoInput {
  base64Data?: string;
  mimeType?: string;
}

export interface BackupRestoreInput {
  confirmation?: string;
  backup?: unknown;
}
