import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type WorkspaceS3Config = {
  bucket: string;
  region: string;
  endpoint?: string | null;
};

export function readWorkspaceS3ConfigFromEnv(): WorkspaceS3Config | null {
  const bucket = process.env.WORKSPACE_S3_BUCKET ?? "";
  const region = process.env.WORKSPACE_S3_REGION ?? "";
  if (!bucket || !region) {
    return null;
  }
  const endpoint = process.env.WORKSPACE_S3_ENDPOINT ?? null;
  return { bucket, region, endpoint };
}

export function createWorkspaceS3Client(config: WorkspaceS3Config): S3Client {
  return new S3Client({
    region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
  });
}

export function buildWorkspaceObjectKey(input: { organizationId: string; workspaceId: string; version: number }): string {
  return `workspaces/${input.organizationId}/${input.workspaceId}/v${input.version}.tar.zst`;
}

export async function presignWorkspaceDownloadUrl(input: { client: S3Client; bucket: string; objectKey: string; expiresInSec: number }): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: input.bucket, Key: input.objectKey });
  return await getSignedUrl(input.client, cmd, { expiresIn: input.expiresInSec });
}

export async function presignWorkspaceUploadUrl(input: {
  client: S3Client;
  bucket: string;
  objectKey: string;
  expiresInSec: number;
}): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: input.bucket,
    Key: input.objectKey,
    // executor uploads a tar.zst blob
    ContentType: "application/zstd",
  });
  return await getSignedUrl(input.client, cmd, { expiresIn: input.expiresInSec });
}

