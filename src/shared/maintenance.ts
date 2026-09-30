export interface BackupInfo {
  path: string;
  createdAt: string;
  files: number;
  bytes: number;
}
export interface CredentialStatus {
  analysis: "secure" | "session" | "absent";
  search: "secure" | "session" | "absent";
  secureStorageAvailable: boolean;
}
export interface UpdateCheck {
  currentVersion: string;
  latestVersion: string;
  available: boolean;
  releaseUrl: string;
  downloadUrl?: string;
  message: string;
}
export interface DiagnosticReport {
  schemaVersion: 1;
  appVersion: string;
  platform: string;
  architecture: string;
  generatedAt: string;
  events: { time: string; operation: string; code: string }[];
  privacy: string;
}
export interface MaintenanceAPI {
  listBackups(): Promise<BackupInfo[]>;
  createBackup(): Promise<BackupInfo | null>;
  restoreBackup(): Promise<boolean>;
  credentialStatus(): Promise<CredentialStatus>;
  removeCredential(kind: "analysis" | "search"): Promise<CredentialStatus>;
  testAIGeneration(
    settings: import("./types").AISettings,
  ): Promise<import("./desktop").AIConnectionResult>;
  checkForUpdates(): Promise<UpdateCheck>;
  diagnosticReport(): Promise<DiagnosticReport>;
  exportDiagnostics(): Promise<string | null>;
  createPassageCitation(
    passageId: string,
  ): Promise<import("./research").Citation>;
  getSourcePagePreview(
    sourceId: string,
    versionId: string,
    page: number,
  ): Promise<{ dataUrl: string; page: number; totalPages: number }>;
}
