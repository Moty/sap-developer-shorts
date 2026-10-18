import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { firebaseRenderPermission } from "../../src/cloud/auth.js";
import { FirebaseBlobs } from "../../src/cloud/blobs.js";
import { dispatchCloud, RunJobsLauncher } from "../../src/cloud/cloud-dispatch.js";
import { loadPrivateConfig } from "../../src/cloud/config.js";
import { FirebaseDatabase } from "../../src/cloud/database.js";
import { WorkspaceService } from "../../src/cloud/service.js";

const config = await loadPrivateConfig();
if (config.emulator || !config.cloud)
  throw new Error(
    "Cloud dispatch needs an explicitly enabled production provider and approved budget.",
  );
const app = initializeApp(
  {
    projectId: config.projectId,
    storageBucket: config.storageBucket,
    credential: applicationDefault(),
  },
  "private-dispatcher",
);
const service = new WorkspaceService(
  new FirebaseDatabase(getFirestore(app)),
  new FirebaseBlobs(getStorage(app).bucket()),
  {
    pilotEmails: config.pilotEmails,
    isUserActive: firebaseRenderPermission(getAuth(app)),
    cloudEnabled: true,
    cloudRuntime: { engine: "qwen-cuda", digest: config.cloud.runtimeDigest },
    cloudBudgetCents: config.cloud.budgetCents,
    cloudAttemptCents: config.cloud.attemptCents,
  },
);
console.log(
  JSON.stringify(
    await dispatchCloud(
      service,
      config.cloud,
      config.origin,
      new RunJobsLauncher(config.cloud.jobName),
    ),
  ),
);
