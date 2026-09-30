import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import {
  MAX_ARCHIVE_BYTES,
  MAX_ASSET_BYTES,
  type AssetRecord,
} from "./storage";
import { PEDIGREE_COLLECTIONS } from "../shared/pedigree";
const requirePackage = createRequire(import.meta.url);
export const PORTABLE_ARCHIVE_LIMITS = {
  entry: MAX_ASSET_BYTES,
  project: 50 * 1024 * 1024,
  manifest: 5 * 1024 * 1024,
  total: MAX_ARCHIVE_BYTES,
  assets: 5000,
};
/** Shared by the worker and size-boundary tests; limits match openArchive. */
export function assertPortableArchiveSizes(
  sizes: {
    project: number;
    research: number;
    manifest: number;
    assets: number[];
    compressed?: number;
  },
  limits = PORTABLE_ARCHIVE_LIMITS,
): void {
  const entries = [
    sizes.project,
    sizes.research,
    sizes.manifest,
    ...sizes.assets,
  ];
  if (
    entries.some((size) => !Number.isSafeInteger(size) || size < 0) ||
    sizes.assets.length > limits.assets ||
    sizes.project > limits.project ||
    sizes.manifest > limits.manifest ||
    entries.some((size) => size > limits.entry) ||
    entries.reduce((sum, size) => sum + size, 0) > limits.total ||
    (sizes.compressed !== undefined &&
      (!Number.isSafeInteger(sizes.compressed) ||
        sizes.compressed < 0 ||
        sizes.compressed > limits.total))
  )
    throw new Error(
      "This investigation exceeds a portable archive import limit (250 MB per entry, 50 MB project, 5 MB catalog, 5,000 originals, or 1 GB total). No archive was written. Create a whole-library backup in Backup, recovery and updates; retain that backup before splitting the investigation.",
    );
}
/** Table reads, full research serialization, file reads and compression run away
 * from the Electron event loop. A read transaction freezes the research rows;
 * the captured project is the exact board/report revision the caller saved.
 * Keep this schema in parity with ResearchStore.exportResearch (covered by test).
 */
export function buildPortableArchive(
  input: {
    root: string;
    projectJSON: string;
    assets: AssetRecord[];
  } & (
    | { databasePath: string; researchJSON?: never }
    | { researchJSON: string; databasePath?: never }
  ),
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      `
      const {parentPort,workerData}=require('node:worker_threads');
      const {readFileSync}=require('node:fs');
      const {join,basename}=require('node:path');
      const {createHash}=require('node:crypto');
      const AdmZip=require(workerData.module);
      const assertSizes=${assertPortableArchiveSizes.toString()};
      const input=workerData.input, limits=workerData.limits;
      const clean=value=>JSON.parse(JSON.stringify(value,(key,val)=>/^(?:apikey|searchkey|token|accesstoken|refreshtoken|bearertoken|password|authorization|credential|credentials|secret|clientsecret|secretaccesskey)$/i.test(key.replace(/[_-]/g,''))?undefined:val));
      let db;
      try {
        const project=JSON.parse(input.projectJSON),projectId=project.id;
        let research;
        if(input.databasePath) {
          const {DatabaseSync}=require('node:sqlite');
          db=new DatabaseSync(input.databasePath,{readOnly:true});
          db.exec('PRAGMA busy_timeout=5000; BEGIN');
          if(!db.prepare('SELECT id FROM projects WHERE id=?').get(projectId))throw new Error('Investigation is unavailable; archive was not created.');
          const list=table=>db.prepare('SELECT data FROM '+table+' WHERE project_id=? ORDER BY rowid').all(projectId).map(row=>JSON.parse(row.data));
          const sources=list('sources');
          const versions=sources.flatMap(s=>db.prepare('SELECT data FROM versions WHERE source_id=? ORDER BY rowid').all(s.id).map(row=>JSON.parse(row.data)));
          research={schemaVersion:5,sources,versions,claims:list('claims'),tasks:list('tasks'),jobs:[],discoveries:list('discoveries'),runs:list('runs'),
            drafts:db.prepare('SELECT data FROM private_drafts WHERE project_id=? ORDER BY draft_key').all(projectId).map(row=>JSON.parse(row.data)),
            pedigree:Object.fromEntries(Object.entries(workerData.collections).map(([kind,key])=>[key,db.prepare('SELECT data FROM pedigree_entities WHERE project_id=? AND kind=? ORDER BY rowid').all(projectId,kind).map(row=>JSON.parse(row.data))])),
            pedigreeRevisions:list('pedigree_revisions'),pedigreeSnapshots:list('pedigree_snapshots'),
            passages:db.prepare('SELECT p.data FROM passages p JOIN sources s ON s.id=p.source_id WHERE s.project_id=?').all(projectId).map(row=>JSON.parse(row.data))};
          db.exec('COMMIT');db.close();db=undefined;
          research.versions=research.versions.map(version=>['queued','processing'].includes(version.status)?{...version,status:version.processedUnits>0?'partial':'failed',error:'Exported before extraction finished. Reprocess this source to complete coverage.'}:version);
        } else research=JSON.parse(input.researchJSON);
        research=clean(research);
        const ids=[...new Set([...(project.cards||[]).map(c=>c.assetId),...research.sources.map(s=>s.assetId),...research.versions.map(v=>v.assetId)].filter(Boolean))];
        const catalog=new Map(input.assets.map(asset=>[asset.id,asset]));
        const assets=ids.map(id=>{const asset=catalog.get(id);if(!asset)throw new Error('An original attachment is missing. Restore it before exporting; no archive was created.');if(basename(asset.storedName)!==asset.storedName||!/^[-a-f0-9]+$/i.test(asset.id))throw new Error('Invalid attachment catalog.');return asset;});
        const projectBytes=Buffer.from(JSON.stringify({...clean(project),schemaVersion:5}));
        const researchBytes=Buffer.from(JSON.stringify(research));
        const manifestBytes=Buffer.from(JSON.stringify(assets));
        const sizes={project:projectBytes.length,research:researchBytes.length,manifest:manifestBytes.length,assets:assets.map(asset=>asset.size)};
        assertSizes(sizes,limits);
        const zip=new AdmZip();
        for(const asset of assets) {
          const bytes=readFileSync(join(input.root,'assets',asset.storedName));
          if(bytes.length!==asset.size)throw new Error('An original attachment changed size. Archive was not created.');
          const expected=research.versions.filter(v=>v.assetId===asset.id&&['native','ocr'].includes(v.method));
          if(expected.length){const hash=createHash('sha256').update(bytes).digest('hex');if(expected.some(v=>v.hash!==hash))throw new Error('An original attachment no longer matches its historical content hash. Restore the original before exporting; no archive was created.');}
          zip.addFile('assets/'+asset.id,bytes);
        }
        zip.addFile('project.json',projectBytes);
        zip.addFile('research.json',researchBytes);
        zip.addFile('assets.json',manifestBytes);
        const output=zip.toBuffer();
        assertSizes({...sizes,compressed:output.length},limits);
        parentPort.postMessage({bytes:output},[output.buffer]);
      } catch(error) {parentPort.postMessage({error:error.message});}
      finally {if(db)db.close();}
    `,
      {
        eval: true,
        workerData: {
          module: requirePackage.resolve("adm-zip"),
          input,
          limits: PORTABLE_ARCHIVE_LIMITS,
          collections: PEDIGREE_COLLECTIONS,
        },
      },
    );
    let settled = false;
    worker.once("message", (value: { bytes?: Uint8Array; error?: string }) => {
      settled = true;
      if (value.error) reject(new Error(value.error));
      else if (value.bytes)
        resolve(
          Buffer.from(
            value.bytes.buffer,
            value.bytes.byteOffset,
            value.bytes.byteLength,
          ),
        );
      else reject(new Error("Archive worker returned no data."));
    });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (!settled)
        reject(
          new Error(`Archive worker stopped before completion (${code}).`),
        );
    });
  });
}
