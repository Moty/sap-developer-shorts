import { resolve } from "node:path";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { projectRoot } from "../paths.js";
import { firebaseRenderPermission, firebaseUserVerifier } from "./auth.js";
import { DiskBlobs, FirebaseBlobs } from "./blobs.js";
import { loadPrivateConfig } from "./config.js";
import { FirebaseDatabase } from "./database.js";
import { createPrivateServer } from "./http.js";
import { WorkspaceService } from "./service.js";

const config = await loadPrivateConfig();
if (config.emulator) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = config.authEmulator;
  process.env.FIRESTORE_EMULATOR_HOST = config.firestoreEmulator;
  process.env.FIREBASE_STORAGE_EMULATOR_HOST = config.storageEmulator;
} else if (
  ["FIREBASE_AUTH_EMULATOR_HOST", "FIRESTORE_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST"].some(
    (key) => process.env[key],
  )
)
  throw new Error("Emulator variables cannot be used with a production configuration.");
const app = initializeApp(
  {
    projectId: config.projectId,
    storageBucket: config.storageBucket,
    ...(config.emulator ? {} : { credential: applicationDefault() }),
  },
  "private-studio",
);
const storageBucket = getStorage(app).bucket();
const [bucketExists] = await storageBucket.exists().catch(() => [false]);
const blobs = bucketExists
  ? new FirebaseBlobs(storageBucket)
  : new DiskBlobs(resolve(projectRoot, ".state/blobs"));
if (!bucketExists) {
  console.log("Notice: GCS bucket not provisioned on GCP. Media assets stored locally in .state/blobs.");
}
const service = new WorkspaceService(
  new FirebaseDatabase(getFirestore(app)),
  blobs,
  {
    pilotEmails: config.pilotEmails,
    isUserActive: firebaseRenderPermission(getAuth(app)),
    ...(config.cloud
      ? {
          cloudEnabled: true,
          cloudRuntime: { engine: "qwen-cuda", digest: config.cloud.runtimeDigest },
          cloudBudgetCents: config.cloud.budgetCents,
          cloudAttemptCents: config.cloud.attemptCents,
        }
      : {}),
  },
);
const server = createPrivateServer(
  service,
  firebaseUserVerifier(getAuth(app)),
  config,
  resolve(projectRoot, "dist/private-studio"),
);
server.listen(
  Number(process.env.PORT ?? config.port),
  config.emulator ? "127.0.0.1" : "0.0.0.0",
  () => console.log(`Private studio: ${config.origin}`),
);
const shutdown = () => server.close(() => process.exit(0));
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
