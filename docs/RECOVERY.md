# Backup and recovery

Open **Backup, recovery and updates** from Acadia's guide or project tools. Create a backup in a directory outside the live workspace, preferably on another drive. The backup includes a consistent SQLite snapshot, attachment catalog, original files and private drafts, with SHA-256 checks. Credentials are excluded. Keep the entire backup folder together; `backup.json` is its integrity manifest.

Acadia checks the editor save acknowledgement before creating a backup or restoring one. A failed save stops the maintenance operation. Incomplete backup directories are not reported as successful backups. Before a database schema upgrade, a consistent complete backup is created under the application's `backups` directory; the existing SQLite migration backup remains additional recovery evidence.

To restore, choose the checked backup folder. Acadia validates its database, manifest and originals before offering restoration. It stops active jobs, blocks new requests, and checks the copied staging files again before replacing anything. The current workspace is preserved in a sibling `workspace-preserved-*` folder, then Acadia installs the selected snapshot and restarts. A failure closes the stopped editor with recovery guidance rather than continuing against a closed database. Credentials from a backup are never imported. If the normal library cannot open, the startup recovery dialog offers backup restoration or access to the preserved workspace folder. Renderer error screens also expose recovery tools.

Private drafts are distinct from saved research assessments. Recovering a draft does not accept AI advice, mark evidence supported, resolve a gap, or release a report. Save the underlying record explicitly after reviewing the recovered draft. Conflicting draft revisions require deliberate recovery or discard rather than silently overwriting another edit.

If a save or backup fails because the disk is full or a folder is inaccessible, retain the existing workspace and backup directories, resolve the storage problem, and retry. Never manually delete the live SQLite WAL files. A backup on the same disk does not protect against disk loss. Research backups are not encrypted vaults.

The diagnostics preview contains application/platform identifiers, timestamps, operation names and error codes only. It excludes document text, prompts, provider responses, credentials, project titles and local paths. Save it locally and inspect it before sharing; Acadia does not send it automatically.

The update check contacts the official GitHub release API only when selected. It shows release notes and a compatible download, with backup and manual installation guidance. It does not install an update or restart an application for an upgrade.

Portable projects have limits of 250 MB per archive entry (including complete research history), 50 MB for the board/report record, 5 MB for the catalog, 5,000 original files and 1 GB total. Export refuses a package that its importer could not read. Use a whole-library backup when a project exceeds those limits; preserve the backup before splitting an investigation. Full research serialization and ZIP compression run in a worker. Recovery archives are also created for empty boards containing saved sources or private research drafts.
